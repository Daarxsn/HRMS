import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { pool, query, transaction } from '../db.mts';
import { audit, isSuperAdmin, notify, notifyAdmins, requireAdmin, requireAuth, requireSuperAdmin } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { attendanceStatus, hasPassedAbsenceCutoff, indiaDate, indiaTime, isAttendanceAllowed, isOfficeNetworkIpAllowed, netWorkedMinutes, normalizeClientIp, parseOfficeNetworkIps, POLICY } from '../policy.mts';
import { deleteProfilePhoto, profilePhotoUpload, readProfilePhoto, saveProfilePhoto, verifyImageSignature } from '../profile-photo.mts';
import { htmlEscape, sendEmail, sendHrNotificationEmail, smtpConfigured, getHrNotificationEmail } from '../mailer.mts';
import { getEmailOutboxSummary, retryFailedEmail } from '../email-outbox.mts';
import { dispatchWorkflowStatusEmail } from '../email-routing.mts';

const router = Router();
router.use(requireAuth, requireAdmin);
const adminMutationLimiter = rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`admin:${req.user.id}`});
const emailTestLimiter = rateLimit({windowMs:15*60*1000,limit:2,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`admin-email-test:${req.user.id}`});

async function effectiveAttendance(from, to) {
  const fromDate = new Date(`${from}T12:00:00Z`);
  const toDate = new Date(`${to}T12:00:00Z`);
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || from > to || (toDate.getTime() - fromDate.getTime()) / 86400000 > 366) {
    throw Object.assign(new Error('Choose a valid date range of no more than one year.'), { status:400 });
  }
  const [records, people, leaves, wfh, customHolidays, scheduleExceptions] = await Promise.all([
    query(`SELECT a.id,a.employee_id,a.attendance_date,a.check_in_at,a.check_out_at,a.check_in_method,a.check_out_method,a.check_in_latitude,a.check_in_longitude,a.check_in_accuracy_m,a.check_in_distance_m,a.status,a.correction_pending,
      e.full_name,e.employee_code,e.user_type,(SELECT COUNT(*) FROM temporary_exits x WHERE x.attendance_id=a.id) AS exit_count
      FROM attendance_records a JOIN employees e ON e.id=a.employee_id WHERE a.attendance_date BETWEEN :from AND :to ORDER BY a.attendance_date DESC,a.check_in_at DESC`, { from, to }),
    query(`SELECT id,full_name,employee_code,user_type,DATE_FORMAT(joined_on,'%Y-%m-%d') AS joined_on FROM employees WHERE role='EMPLOYEE' AND status='ACTIVE' AND joined_on<=:to ORDER BY full_name`, { to }),
    query(`SELECT employee_id,DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date FROM leave_requests WHERE status='APPROVED' AND start_date<=:to AND end_date>=:from`, { from, to }),
    query(`SELECT employee_id,DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date FROM wfh_requests WHERE status='APPROVED' AND request_date BETWEEN :from AND :to`, { from, to }),
    query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :from AND :to`, { from, to }),
    query(`SELECT employee_id,DATE_FORMAT(exception_date,'%Y-%m-%d') AS exception_date,TIME_FORMAT(approved_start_time,'%H:%i') AS approved_start_time FROM employee_schedule_exceptions WHERE exception_date BETWEEN :from AND :to`, { from, to })
  ]);
  const holidays = new Set(customHolidays.map((x)=>x.date));
  for (let y=Number(from.slice(0,4));y<=Number(to.slice(0,4));y++) for (const [month,day] of [[1,26],[8,15],[10,2]]) holidays.add(`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const result=[...records];
  const present=new Set(records.map((r)=>`${r.employee_id}:${String(r.attendance_date).slice(0,10)}`));
  const approvedStartByEmployeeDate=new Map(scheduleExceptions.map((x)=>[`${x.employee_id}:${x.exception_date}`,x.approved_start_time]));
  const today=indiaDate();
  const currentTime=indiaTime().slice(0,5);
  for(let d=new Date(fromDate);d<=toDate;d.setUTCDate(d.getUTCDate()+1)){
    const date=d.toISOString().slice(0,10);
    if(date>today||holidays.has(date))continue;
    const isPast=date<today;
    for(const person of people){
      if(date<person.joined_on||present.has(`${person.id}:${date}`))continue;
      const scheduledStart=approvedStartByEmployeeDate.get(`${person.id}:${date}`)||POLICY.standardStart;
      const absenceCutoff=isPast||hasPassedAbsenceCutoff(String(currentTime),String(scheduledStart));
      const onLeave=leaves.some((item)=>item.employee_id===person.id&&item.start_date<=date&&item.end_date>=date);
      const remote=wfh.some((item)=>item.employee_id===person.id&&item.request_date===date);
      const status=onLeave?'ON_LEAVE':remote?'WFH':absenceCutoff?'ABSENT':null;
      if(!status)continue;
      result.push({id:`${person.id}-${date}`,employee_id:person.id,attendance_date:date,check_in_at:null,check_out_at:null,check_in_method:status==='WFH'?'WFH':null,check_out_method:null,check_in_latitude:null,check_in_longitude:null,check_in_accuracy_m:null,check_in_distance_m:null,status,correction_pending:false,full_name:person.full_name,employee_code:person.employee_code,user_type:person.user_type,exit_count:0});
    }
  }
  return result.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))||String(a.full_name).localeCompare(String(b.full_name)));
}

router.post('/announcements', adminMutationLimiter, asyncRoute(async (req,res)=>{
  const input=validate(z.object({title:z.string().trim().min(3).max(120),body:z.string().trim().min(8).max(1000)}),req.body);
  const people=await query("SELECT id FROM employees WHERE status='ACTIVE' AND role='EMPLOYEE'");
  await Promise.all(people.map((person)=>query(`INSERT INTO notifications (id,employee_id,title,body,kind,entity_json,created_at) VALUES (:id,:employee,:title,:body,'ANNOUNCEMENT',NULL,UTC_TIMESTAMP())`,{id:crypto.randomUUID(),employee:person.id,title:input.title,body:input.body})));
  await audit({actorId:req.user.id,action:'ANNOUNCEMENT_PUBLISHED',entityType:'announcement',details:{title:input.title,recipientCount:people.length},ipAddress:req.ip});
  res.status(201).json({ok:true,recipientCount:people.length});
}));

router.get('/dashboard', asyncRoute(async (req, res) => {
  const today = indiaDate();
  const [people, attendance, pending, out, effectiveToday, peopleDetail] = await Promise.all([
    query(`SELECT COUNT(*) AS total, SUM(status='ACTIVE') AS active FROM employees WHERE role='EMPLOYEE'`),
    query(`SELECT COUNT(*) AS total, SUM(status='ON_TIME') AS on_time, SUM(status='LATE_ENTRY') AS late, SUM(check_out_at IS NULL) AS still_in
      FROM attendance_records WHERE attendance_date=:today`, { today }),
    query(`SELECT (SELECT COUNT(*) FROM leave_requests WHERE status='PENDING') + (SELECT COUNT(*) FROM wfh_requests WHERE status='PENDING') +
      (SELECT COUNT(*) FROM attendance_correction_requests WHERE status='PENDING') + (SELECT COUNT(*) FROM flex_start_requests WHERE status='PENDING') AS total`),
    query(`SELECT x.id,x.left_at,x.reason,e.full_name,e.employee_code FROM temporary_exits x
      JOIN attendance_records a ON a.id=x.attendance_id JOIN employees e ON e.id=x.employee_id
      WHERE a.attendance_date=:today AND x.returned_at IS NULL ORDER BY x.left_at DESC`, { today }),
    effectiveAttendance(today,today),
    query(`SELECT id,full_name,employee_code,user_type,title FROM employees WHERE role='EMPLOYEE' AND status='ACTIVE' ORDER BY full_name`)
  ]);
  const holidayRows=await query(`SELECT name FROM company_holidays WHERE holiday_date=:today AND holiday_kind='FIXED' LIMIT 1`,{today});
  const year=today.slice(0,4);
  const nationalNames=new Map([[year+'-01-26','Republic Day'],[year+'-08-15','Independence Day'],[year+'-10-02','Gandhi Jayanti']]);
  const officeHoliday=!isAttendanceAllowed(today,new Set(holidayRows.length?[today]:[]));
  const holidayName=holidayRows[0]?.name||nationalNames.get(today)||'';
  const absenceCount=effectiveToday.filter((row)=>row.status==='ABSENT').length;
  const leaveCount=effectiveToday.filter((row)=>row.status==='ON_LEAVE').length;
  const approvedWfhCount=effectiveToday.filter((row)=>row.status==='WFH').length;
  const attendanceMap=new Map(effectiveToday.map((row)=>[row.employee_id,row]));
  const recent=peopleDetail.map((person)=>{
    const row=attendanceMap.get(person.id);
    return {
      id:row?.id||person.id,
      employee_id:person.id,
      attendance_date:today,
      check_in_at:row?.check_in_at||null,
      check_out_at:row?.check_out_at||null,
      check_in_method:row?.check_in_method||null,
      check_out_method:row?.check_out_method||null,
      status:row?.status||null,
      full_name:person.full_name,
      employee_code:person.employee_code,
      user_type:person.user_type,
      title:person.title,
      worked_minutes:row?.check_in_at&&row?.check_out_at?netWorkedMinutes(row.check_in_at,row.check_out_at,POLICY.fixedLunchMinutes):null
    };
  });
  res.json({ date: today, officeHoliday, holidayName, stats: { employees: Number(people[0].active || 0), present: Number(attendance[0].total || 0), onTime: Number(attendance[0].on_time || 0), late: Number(attendance[0].late || 0), stillIn: Number(attendance[0].still_in || 0), pending: Number(pending[0].total || 0), outNow: out.length, absent:absenceCount, onLeave:leaveCount, approvedWfh:approvedWfhCount }, temporaryExits:out, recent });
}));
router.get('/email-outbox', adminMutationLimiter, asyncRoute(async (req,res) => {
  const summary=await getEmailOutboxSummary();
  const failed=await query(`SELECT id,dedupe_key,subject,attempts,max_attempts,last_error,created_at,updated_at
    FROM email_outbox WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 50`);
  res.setHeader('Cache-Control','private, no-store');
  res.json({summary,failed});
}));

router.post('/email-outbox/:id/retry', adminMutationLimiter, asyncRoute(async (req,res) => {
  const retried=await retryFailedEmail(String(req.params.id));
  if(!retried)throw Object.assign(new Error('A failed outbox message with this ID was not found.'),{status:404});
  await audit({actorId:req.user.id,action:'EMAIL_OUTBOX_RETRY_REQUESTED',entityType:'email_outbox',entityId:String(req.params.id),details:{reset_attempts:true},ipAddress:req.ip});
  res.status(202).json({ok:true,id:String(req.params.id),status:'PENDING'});
}));

router.get('/email-status', asyncRoute(async (req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({
    configured:smtpConfigured(),
    host:process.env.SMTP_HOST ? String(process.env.SMTP_HOST).trim() : null,
    port:Number(process.env.SMTP_PORT || 587),
    secure:String(process.env.SMTP_SECURE || 'false').toLowerCase()==='true',
    from:process.env.SMTP_FROM ? String(process.env.SMTP_FROM).trim() : (process.env.SMTP_USER ? String(process.env.SMTP_USER).trim() : null),
    required:String(process.env.SMTP_REQUIRED || 'false').toLowerCase()==='true',
    hrNotificationEmail:getHrNotificationEmail()
  });
}));
router.post('/email-test', emailTestLimiter, asyncRoute(async (req,res)=>{
  const recipient=getHrNotificationEmail();
  if(!recipient) throw Object.assign(new Error('HR notification mailbox is not configured.'),{status:503});
  try {
    const result=await sendHrNotificationEmail({
      subject:'Falchion Xeniaa HRMS · SMTP test',
      text:'SMTP is configured correctly for Falchion Xeniaa HRMS administrator notifications.',
      html:'<p style="font-family:Arial,sans-serif"><strong>Falchion Xeniaa HRMS</strong><br>SMTP is configured correctly for the configured HR notification mailbox.</p>'
    });
    if(result.skipped) throw Object.assign(new Error('SMTP email is not configured.'),{status:503});
    await audit({actorId:req.user.id,action:'SMTP_TEST_EMAIL_SENT',entityType:'system',details:{recipient},ipAddress:req.ip});
    res.json({ok:true,recipient});
  } catch (error) {
    console.warn(JSON.stringify({type:'smtp_test_failed',request_id:req.requestId,recipient,error:String(error?.message || error)}));
    if (error?.status) throw error;
    throw Object.assign(new Error('SMTP delivery failed. Check the production SMTP host, port, sender, username, and provider app password.'),{status:502});
  }
}));
router.get('/system-health', asyncRoute(async (req, res) => {
  const started = process.hrtime.bigint();
  const [rows] = await pool.query('SELECT VERSION() AS mysql_version, UTC_TIMESTAMP() AS database_time');
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  const configuredNetwork = String(process.env.OFFICE_NETWORK_IPS || (process.env.NODE_ENV === 'development' ? '127.0.0.1,::1' : '')).trim();
  const configuredNetworkIps = parseOfficeNetworkIps(configuredNetwork);
  const currentNetworkIp = normalizeClientIp(req.ip);
  let pendingEmails = 0;
  try {
    const [outboxRows]: any = await pool.query("SELECT COUNT(*) AS pending FROM email_outbox WHERE status = 'PENDING'");
    pendingEmails = Number(outboxRows[0]?.pending || 0);
  } catch {}
  res.json({
    status: 'ok',
    service: 'falchion-xeniaa-api',
    version: process.env.APP_VERSION || '1.0.0',
    build: process.env.BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || (process.env.NODE_ENV === 'production' ? 'production-unversioned' : 'development'),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    mysqlVersion: rows[0]?.mysql_version || null,
    databaseLatencyMs: latencyMs,
    emailOutbox: {
      pendingCount: pendingEmails,
      stalled: pendingEmails > 10
    },
    officeNetwork: {
      configured: configuredNetworkIps.length > 0,
      matchedCurrentRequest: configuredNetworkIps.length > 0 && isOfficeNetworkIpAllowed(currentNetworkIp, configuredNetwork),
      currentClientIp: currentNetworkIp,
      configuredIpCount: configuredNetworkIps.length
    }
  });
}));

router.get('/users', asyncRoute(async (req, res) => {
  const users = await query(`SELECT e.id, e.employee_code, e.full_name, e.email, e.role, e.user_type, e.status, e.title, e.position, e.branch, e.department, e.phone, e.profile_photo_key, e.wfh_enabled, e.joined_on,
    e.probation_end_date, (SELECT COUNT(*) FROM attendance_records a WHERE a.employee_id=e.id AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND a.status='LATE_ENTRY') AS late_count
    FROM employees e ORDER BY FIELD(e.role, 'SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'INTERN'), e.full_name`);
  res.json({ users });
}));
router.post('/users', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ employeeCode: z.string().trim().min(2).max(24), fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254),
    userType: z.enum(['SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN']).default('EMPLOYEE'), title: z.string().trim().max(120).default('Employee'), position: z.string().trim().min(2).max(120).default('Employee'), branch: z.string().trim().min(2).max(100).default('Pune'), department: z.string().trim().min(2).max(120).default('General'), phone: z.string().trim().max(32).optional(),
    wfhEnabled: z.boolean().default(false), joinedOn: dateSchema.optional(), probationEndDate: dateSchema.nullable().optional()
  }), req.body);
  if (input.userType === 'SUPER_ADMIN' && !isSuperAdmin(req.user)) {
    throw Object.assign(new Error('Only a Super Administrator can provision a Super Administrator account.'), { status: 403 });
  }
  const id = crypto.randomUUID();
  const userType = input.userType;
  const role = userType;
  const joined = input.joinedOn || indiaDate();
  const probation = input.probationEndDate ?? (() => { const d = new Date(`${joined}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 4); return d.toISOString().slice(0,10); })();
  await query(`INSERT INTO employees (id, employee_code, full_name, email, role, user_type, title, position, branch, department, phone, joined_on, probation_end_date, wfh_enabled)
    VALUES (:id,:code,:name,:email,:role,:userType,:title,:position,:branch,:department,:phone,:joined,:probation,:wfh)`, {
    id, code: input.employeeCode, name: input.fullName, email: input.email.toLowerCase(), role, userType,
    title: input.title || input.position || 'Employee', position: input.position || input.title || 'Employee', branch: input.branch, department: input.department, phone: input.phone || null, joined, probation, wfh: input.wfhEnabled
  });
  await transaction(async (connection) => {
    await connection.execute(`INSERT INTO employment_history (id,employee_id,event_type,effective_date,title,department,branch,notes,created_by)
      VALUES (?,?,?,?,?,?,?, ?,?)`, [
      crypto.randomUUID(), id, 'JOINED', joined, input.title || input.position || 'Employee',
      input.department, input.branch, 'Initial employee lifecycle record.', req.user.id
    ]);
    for (const [title, category] of [['Verify identity documents','DOCUMENTS'],['Complete HR profile','PROFILE'],['Confirm company policies','POLICIES']]) {
      await connection.execute(`INSERT INTO onboarding_tasks (id,employee_id,title,category,due_date,status,created_by)
        VALUES (?,?,?,?,DATE_ADD(?,INTERVAL 7 DAY),'PENDING',?)`, [
        crypto.randomUUID(), id, title, category, joined, req.user.id
      ]);
    }
  });
  await audit({ actorId: req.user.id, action: 'EMPLOYEE_CREATED', entityType: 'employee', entityId: id, details: { employee_code: input.employeeCode, role }, ipAddress: req.ip });
  res.status(201).json({ ok: true, id });
}));
router.patch('/users/:id', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(254).optional(), title: z.string().trim().max(120).optional(), position: z.string().trim().min(2).max(120).optional(), branch: z.string().trim().min(2).max(100).optional(), department: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(32).nullable().optional(), userType: z.enum(['SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN']).optional(), status: z.enum(['ACTIVE','INACTIVE']).optional(),
    wfhEnabled: z.boolean().optional(), joinedOn: dateSchema.optional(), probationEndDate: dateSchema.nullable().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Make at least one change.'), req.body);
  await transaction(async (connection) => {
    const [userRows]: any = await connection.execute('SELECT id, employee_code, full_name, email, role, user_type, status, session_version FROM employees WHERE id=:id FOR UPDATE', { id: req.params.id });
    if (!userRows[0]) throw Object.assign(new Error('Employee not found.'), { status: 404 });
    const target = userRows[0];
    const targetIsSuperAdmin = target.role === 'SUPER_ADMIN' || target.user_type === 'SUPER_ADMIN';
    const actorIsSuperAdmin = isSuperAdmin(req.user);

    if (req.params.id === req.user.id) {
      if (input.status === 'INACTIVE') throw Object.assign(new Error('You cannot deactivate your own administrator account.'), { status: 400 });
      if (input.userType !== undefined) {
        if (!actorIsSuperAdmin) throw Object.assign(new Error('You cannot change the role of your own administrator account.'), { status: 400 });
        if (input.userType !== 'SUPER_ADMIN') {
          const [superCountRows]: any = await connection.execute(
            "SELECT COUNT(*) AS count FROM employees WHERE (role = 'SUPER_ADMIN' OR user_type = 'SUPER_ADMIN') AND status = 'ACTIVE'"
          );
          if (Number(superCountRows[0]?.count || 0) <= 1) {
            throw Object.assign(new Error('Cannot demote the last active Super Administrator in the organization.'), { status: 400 });
          }
        }
      }
    } else {
      if (targetIsSuperAdmin && !actorIsSuperAdmin) {
        throw Object.assign(new Error('Only a Super Administrator can modify another Super Administrator account.'), { status: 403 });
      }
      if (input.userType === 'SUPER_ADMIN' && !actorIsSuperAdmin) {
        throw Object.assign(new Error('Only a Super Administrator can promote a user to Super Administrator.'), { status: 403 });
      }
    }

    if (input.email && input.email.toLowerCase() !== String(target.email).toLowerCase()) {
      const [existingEmail]: any = await connection.execute('SELECT id FROM employees WHERE email=:email AND id!=:id LIMIT 1', { email: input.email.toLowerCase(), id: req.params.id });
      if (existingEmail[0]) throw Object.assign(new Error('This email address is already assigned to another employee.'), { status: 409 });
    }
    const fields = {
      fullName:['full_name',input.fullName], email:['email',input.email?.toLowerCase()], title:['title',input.title], position:['position',input.position], branch:['branch',input.branch], department:['department',input.department], phone:['phone',input.phone],
      userType:['user_type',input.userType], status:['status',input.status], wfhEnabled:['wfh_enabled',input.wfhEnabled], joinedOn:['joined_on',input.joinedOn], probationEndDate:['probation_end_date',input.probationEndDate]
    };
    const values: any[] = [];
    const sets: string[] = [];
    for (const [key, [column, value]] of Object.entries(fields)) if (value !== undefined) { sets.push(`${column}=?`); values.push(value); }
    if (input.userType !== undefined) {
      sets.push('role=?');
      values.push(input.userType);
      sets.push('session_version = session_version + 1');
    }
    values.push(req.params.id);
    await connection.execute(`UPDATE employees SET ${sets.join(',')} WHERE id=?`, values);
    if (input.userType !== undefined) {
      try {
        await connection.execute('UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE employee_id = :id AND revoked_at IS NULL', { id: req.params.id });
      } catch {}
    }
  });
  await audit({ actorId: req.user.id, action: 'EMPLOYEE_UPDATED', entityType: 'employee', entityId: req.params.id, details: { fields: Object.keys(input) }, ipAddress: req.ip });
  res.json({ ok: true });
}));

router.put(['/employees/:id/role', '/users/:id/role'], adminMutationLimiter, asyncRoute(async (req, res) => {
  const schema = z.object({
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'INTERN'])
  });
  const input = validate(schema, req.body);
  const targetId = req.params.id;
  const newRole = input.role;

  await transaction(async (connection) => {
    // Guard 1: Target existence and active status
    const [rows]: any = await connection.execute(
      'SELECT id, employee_code, full_name, email, role, user_type, status, session_version FROM employees WHERE id = :id FOR UPDATE',
      { id: targetId }
    );
    const target = rows[0];
    if (!target) {
      throw Object.assign(new Error('Employee not found.'), { status: 404 });
    }
    if (target.status !== 'ACTIVE') {
      throw Object.assign(new Error('Cannot change the role of an inactive account.'), { status: 400 });
    }

    const targetIsSuperAdmin = target.role === 'SUPER_ADMIN' || target.user_type === 'SUPER_ADMIN';
    const actorIsSuperAdmin = isSuperAdmin(req.user);

    // Guard 2: Protecting Super Admins (Only Super Admins can alter or demote a Super Admin)
    if (targetIsSuperAdmin && !actorIsSuperAdmin) {
      throw Object.assign(new Error('Only a Super Administrator can modify another Super Administrator account.'), { status: 403 });
    }

    // Guard 3: Blocking unauthorized promotions (Standard Admins cannot grant SUPER_ADMIN)
    if (newRole === 'SUPER_ADMIN' && !actorIsSuperAdmin) {
      throw Object.assign(new Error('Only a Super Administrator can promote a user to Super Administrator.'), { status: 403 });
    }

    // Guard 4: Self-demotion lockout prevention (Last active Super Admin in the organization cannot demote themselves)
    if (req.user.id === target.id && actorIsSuperAdmin && newRole !== 'SUPER_ADMIN') {
      const [superCountRows]: any = await connection.execute(
        "SELECT COUNT(*) AS count FROM employees WHERE (role = 'SUPER_ADMIN' OR user_type = 'SUPER_ADMIN') AND status = 'ACTIVE'"
      );
      const activeSuperCount = Number(superCountRows[0]?.count || 0);
      if (activeSuperCount <= 1) {
        throw Object.assign(new Error('Cannot demote the last active Super Administrator in the organization.'), { status: 400 });
      }
    }

    // Guard 5: Self-promotion prevention (Standard Admins cannot alter or elevate their own privileges)
    if (req.user.id === target.id && !actorIsSuperAdmin) {
      throw Object.assign(new Error('Administrators cannot alter or elevate their own privileges.'), { status: 403 });
    }

    // Invalidate sessions immediately via session_version = session_version + 1
    await connection.execute(
      'UPDATE employees SET role = :newRole, user_type = :newRole, session_version = session_version + 1 WHERE id = :id',
      { newRole, id: targetId }
    );

    // Revoke any active session tokens in employee_sessions
    try {
      await connection.execute(
        'UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE employee_id = :id AND revoked_at IS NULL',
        { id: targetId }
      );
    } catch {
      // Table may not exist in mock or pre-012 environments
    }

    // Dispatch audit log
    await audit({
      actorId: req.user.id,
      action: 'ROLE_CHANGED',
      entityType: 'employee',
      entityId: targetId,
      details: {
        targetEmail: target.email,
        targetCode: target.employee_code,
        previousRole: target.role,
        previousUserType: target.user_type,
        newRole
      },
      ipAddress: req.ip
    });

    // In-app notifications
    const displayRole = newRole === 'SUPER_ADMIN' ? 'Super Administrator' : newRole === 'ADMIN' ? 'Administrator' : newRole === 'INTERN' ? 'Intern' : 'Employee';
    await notify(
      targetId,
      'Organizational Role Updated',
      `Your account role has been updated to ${displayRole}. Active sessions have been refreshed.`,
      'UPDATE',
      { type: 'role_changed', newRole }
    );
    await notifyAdmins(
      'Workforce Role Updated',
      `${req.user.full_name} updated ${target.full_name}'s role to ${displayRole}.`,
      'UPDATE',
      { type: 'role_changed', targetId, newRole }
    );
  });

  res.json({ ok: true, id: targetId, role: newRole, userType: newRole });
}));

router.post('/users/:id/photo', adminMutationLimiter, profilePhotoUpload.single('photo'), asyncRoute(async (req,res)=>{
  if(!req.file) throw Object.assign(new Error('Choose a JPG, PNG, or WebP profile photo up to 4 MB.'),{status:400});
  verifyImageSignature(req.file.buffer,req.file.mimetype);
  const rows=await query('SELECT id,profile_photo_key FROM employees WHERE id=:id LIMIT 1',{id:req.params.id});
  if(!rows[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const saved=await saveProfilePhoto(req.params.id,req.file);
  try { await query('UPDATE employees SET profile_photo_key=:key,profile_photo_content_type=:type,profile_photo_filename=:filename WHERE id=:id',{key:saved.key,type:saved.contentType,filename:saved.filename,id:req.params.id}); }
  catch(error) { await deleteProfilePhoto(saved.key); throw error; }
  await deleteProfilePhoto(rows[0].profile_photo_key);
  await audit({actorId:req.user.id,action:'EMPLOYEE_PROFILE_PHOTO_UPDATED',entityType:'employee',entityId:req.params.id,details:{content_type:req.file.mimetype},ipAddress:req.ip});
  res.status(201).json({ok:true});
}));

router.delete('/users/:id/photo', adminMutationLimiter, asyncRoute(async (req,res)=>{
  const rows=await query('SELECT profile_photo_key FROM employees WHERE id=:id LIMIT 1',{id:req.params.id});
  if(!rows[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  await query('UPDATE employees SET profile_photo_key=NULL,profile_photo_content_type=NULL,profile_photo_filename=NULL WHERE id=:id',{id:req.params.id});
  await deleteProfilePhoto(rows[0].profile_photo_key);
  await audit({actorId:req.user.id,action:'EMPLOYEE_PROFILE_PHOTO_REMOVED',entityType:'employee',entityId:req.params.id,ipAddress:req.ip});
  res.json({ok:true});
}));

router.get('/users/:id/photo', asyncRoute(async (req,res)=>{
  const rows=await query('SELECT profile_photo_key,profile_photo_content_type,profile_photo_filename FROM employees WHERE id=:id LIMIT 1',{id:req.params.id});
  const photo=rows[0];
  if(!photo?.profile_photo_key) return res.status(404).end();
  const file=await readProfilePhoto(photo.profile_photo_key);
  res.setHeader('Content-Type',photo.profile_photo_content_type||'image/jpeg');
  res.setHeader('Content-Disposition',"inline; filename*=UTF-8''"+encodeURIComponent(photo.profile_photo_filename||'profile-photo'));
  res.setHeader('Cache-Control','private, no-store');
  if (file.kind === 'buffer') Readable.from(file.buffer).pipe(res);
  else file.stream.on('error', () => {
    console.error(JSON.stringify({type:'admin_profile_photo_stream_failed',request_id:req.requestId}));
    if (!res.headersSent) res.status(503).json({error:'Private document storage is temporarily unavailable.',requestId:req.requestId});
    else res.destroy();
  }).pipe(res);
}));
router.get('/attendance', asyncRoute(async (req, res) => {
  const from = String(req.query.from || indiaDate());
  const to = String(req.query.to || from);
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to) throw Object.assign(new Error('Choose a valid date range.'), { status: 400 });
  const rows = await effectiveAttendance(from,to);
  res.json({ records: rows });
}));

router.get('/approvals', asyncRoute(async (req, res) => {
  const [leave, wfh, correction, flex] = await Promise.all([
    query(`SELECT r.id,'leave' AS type,r.employee_id,e.full_name,e.employee_code,r.leave_type AS category,r.start_date AS date,r.end_date,r.days,r.reason,r.created_at,r.attachment_id,a.original_filename AS attachment_name,
      NULL AS requested_check_in_at, NULL AS requested_check_out_at, NULL AS current_check_in_at, NULL AS current_check_out_at
      FROM leave_requests r JOIN employees e ON e.id=r.employee_id LEFT JOIN attachments a ON a.id=r.attachment_id WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'wfh' AS type,r.employee_id,e.full_name,e.employee_code,r.request_kind AS category,r.request_date AS date,NULL AS end_date,1 AS days,r.reason,r.created_at,NULL AS attachment_name,
      NULL AS requested_check_in_at, NULL AS requested_check_out_at, NULL AS current_check_in_at, NULL AS current_check_out_at
      FROM wfh_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'correction' AS type,r.employee_id,e.full_name,e.employee_code,'Attendance correction' AS category,r.attendance_date AS date,NULL AS end_date,NULL AS days,r.reason,r.created_at,NULL AS attachment_name,
      r.requested_check_in_at, r.requested_check_out_at,
      ar.check_in_at AS current_check_in_at, ar.check_out_at AS current_check_out_at
      FROM attendance_correction_requests r
      JOIN employees e ON e.id=r.employee_id
      LEFT JOIN attendance_records ar ON ar.employee_id=r.employee_id AND ar.attendance_date=r.attendance_date
      WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'flex' AS type,r.employee_id,e.full_name,e.employee_code,CONCAT('Flex start · ',TIME_FORMAT(r.requested_start_time,'%h:%i %p')) AS category,r.request_date AS date,NULL AS end_date,NULL AS days,r.reason,r.created_at,NULL AS attachment_name,
      NULL AS requested_check_in_at, NULL AS requested_check_out_at, NULL AS current_check_in_at, NULL AS current_check_out_at
      FROM flex_start_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDING' ORDER BY r.created_at`)
  ]);
  res.json({ approvals: [...leave,...wfh,...correction,...flex].sort((a,b) => new Date(a.created_at).getTime()-new Date(b.created_at).getTime()) });
}));

router.post('/approvals/:type/:id', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({
    decision: z.enum(['APPROVED','REJECTED']),
    note: z.string().trim().max(1000).optional(),
    checkIn: z.string().optional().nullable(),
    checkOut: z.string().optional().nullable()
  }), req.body);
  const kind = req.params.type;
  if (!['leave','wfh','correction','flex'].includes(kind)) throw Object.assign(new Error('Unknown approval type.'), { status: 400 });
  let employeeId = null;
  let recordDate = null;
  let itemRecord: any = null;
  await transaction(async (connection) => {
    const table = { leave:'leave_requests', wfh:'wfh_requests', correction:'attendance_correction_requests', flex:'flex_start_requests' }[kind];
    // Consistent employee-first lock order serializes approvals against submissions.
    const [ownerRows] = await connection.execute(`SELECT employee_id FROM ${table} WHERE id=:id`, {id:req.params.id});
    if (!ownerRows[0]) throw Object.assign(new Error('This request was not found.'), {status:404});
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', {employee:ownerRows[0].employee_id});
    const [rows] = await connection.execute(`SELECT * FROM ${table} WHERE id=:id AND status='PENDING' FOR UPDATE`, { id: req.params.id });
    if (!rows[0]) throw Object.assign(new Error('This request is no longer pending.'), { status: 409 });
    const item = rows[0];
    itemRecord = item;
    employeeId = item.employee_id;
    recordDate = item.start_date || item.request_date || item.attendance_date;
    if (input.decision === 'APPROVED' && kind === 'leave') {
      const [employmentRows] = await connection.execute(`SELECT status,
        (SELECT DATE_FORMAT(MAX(s.last_working_date),'%Y-%m-%d') FROM separation_cases s WHERE s.employee_id=employees.id AND s.status IN ('OPEN','IN_PROGRESS','COMPLETED')) AS last_working_date
        FROM employees WHERE id=:employee`, {employee:item.employee_id});
      const employment = employmentRows[0];
      if (String(employment?.status || '').toUpperCase() === 'INACTIVE') {
        const lastWorkingDate = String(employment?.last_working_date || '').slice(0,10);
        if (!lastWorkingDate) throw Object.assign(new Error('Cannot approve leave for an inactive employee without a recorded last working date. Resolve the employment record with HR first.'), {status:409});
        if (String(item.end_date).slice(0,10) > lastWorkingDate) throw Object.assign(new Error('This leave extends beyond the employee’s recorded last working date.'), {status:409});
      }
      const [wfhConflict] = await connection.execute(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1`, { employee:item.employee_id, start:item.start_date, end:item.end_date });
      if (wfhConflict[0]) throw Object.assign(new Error('This leave overlaps a pending or approved WFH request. Resolve the WFH request before approving leave.'), {status:409});
      const [attendanceConflict] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date BETWEEN :start AND :end LIMIT 1`, { employee:item.employee_id, start:item.start_date, end:item.end_date });
      if (attendanceConflict[0]) throw Object.assign(new Error('Attendance already exists during this leave period. Review the attendance record before approving leave.'), {status:409});
      const [flexConflict] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1`, {employee:item.employee_id,start:item.start_date,end:item.end_date});
      if (flexConflict[0]) throw Object.assign(new Error('This leave overlaps a pending or approved flex-start request. Resolve the flex-start request before approving leave.'), {status:409});
      const [correctionConflict] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND status='PENDING' AND attendance_date BETWEEN :start AND :end LIMIT 1`, {employee:item.employee_id,start:item.start_date,end:item.end_date});
      if (correctionConflict[0]) throw Object.assign(new Error('A pending attendance correction overlaps this leave. Resolve it before approving leave.'), {status:409});
    }
    if (input.decision === 'APPROVED' && kind === 'wfh') {
      const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, { employee:item.employee_id, date:item.request_date });
      if (leaveConflict[0]) throw Object.assign(new Error('This WFH request overlaps a pending or approved leave request. Resolve the leave request before approving WFH.'), {status:409});
      const [attendanceConflict] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1`, { employee:item.employee_id, date:item.request_date });
      if (attendanceConflict[0]) throw Object.assign(new Error('Attendance already exists for this date. Review the attendance record before approving WFH.'), {status:409});
      const [flexConflict] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (flexConflict[0]) throw Object.assign(new Error('This WFH request overlaps a pending or approved flex-start request. Resolve the flex-start request before approving WFH.'), {status:409});
      const [correctionConflict] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (correctionConflict[0]) throw Object.assign(new Error('A pending attendance correction exists for this date. Resolve it before approving WFH.'), {status:409});
    }
    if (kind === 'correction' && input.decision === 'APPROVED') {
      const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, {employee:item.employee_id,date:item.attendance_date});
      if (leaveConflict[0]) throw Object.assign(new Error('This correction overlaps pending or approved leave. Resolve the leave request before adding attendance to this date.'), {status:409});
      const [existing] = await connection.execute('SELECT * FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE', { employee: item.employee_id, date: item.attendance_date });

      let checkIn = input.checkIn ? new Date(input.checkIn) : (item.requested_check_in_at ? new Date(item.requested_check_in_at) : (existing[0]?.check_in_at ? new Date(existing[0].check_in_at) : null));
      let checkOut = input.checkOut !== undefined ? (input.checkOut ? new Date(input.checkOut) : null) : (item.requested_check_out_at ? new Date(item.requested_check_out_at) : (existing[0]?.check_out_at ? new Date(existing[0].check_out_at) : null));

      if (!checkIn) {
        const [schedule] = await connection.execute('SELECT approved_start_time FROM employee_schedule_exceptions WHERE employee_id=:employee AND exception_date=:date', { employee: item.employee_id, date: item.attendance_date });
        const shiftTime = schedule[0]?.approved_start_time || '09:30:00';
        const dateStr = String(item.attendance_date).slice(0, 10);
        checkIn = new Date(`${dateStr}T${shiftTime.length === 5 ? shiftTime + ':00' : shiftTime}+05:30`);
      }
      if (checkOut && checkOut < checkIn) throw Object.assign(new Error('Check-out must be after check-in. Please verify the timestamps.'), { status: 400 });
      const [schedule] = await connection.execute('SELECT approved_start_time FROM employee_schedule_exceptions WHERE employee_id=:employee AND exception_date=:date', { employee: item.employee_id, date: item.attendance_date });
      const settingsRows = await connection.execute('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (\'late_threshold\')');
      const settings = Object.fromEntries(settingsRows[0].map((row:any) => [row.setting_key, row.setting_value]));
      const status = attendanceStatus(checkIn, schedule[0]?.approved_start_time || null, String(settings.late_threshold || POLICY.lateThreshold));
      if (existing[0]) {
        await connection.execute(`UPDATE attendance_records SET check_in_at=:checkIn,check_out_at=:checkOut,status=:status,correction_pending=FALSE,check_in_method=COALESCE(check_in_method,'ADMIN'),check_out_method=IF(:checkOut IS NULL,check_out_method,'ADMIN') WHERE id=:id`, { checkIn, checkOut: checkOut || null, status, id: existing[0].id });
      } else {
        await connection.execute(`INSERT INTO attendance_records (id,employee_id,attendance_date,check_in_at,check_out_at,check_in_method,check_out_method,status,approved_start_time)
          VALUES (:id,:employee,:date,:checkIn,:checkOut,'ADMIN',IF(:checkOut IS NULL,NULL,'ADMIN'),:status,:approvedStart)`, { id: crypto.randomUUID(), employee:item.employee_id, date:item.attendance_date, checkIn, checkOut:checkOut || null, status, approvedStart:schedule[0]?.approved_start_time || null });
      }
    }
    const next = input.decision;
    await connection.execute(`UPDATE ${table} SET status=:status,reviewed_by=:actor,reviewer_note=:note,reviewed_at=UTC_TIMESTAMP() WHERE id=:id`, { status:next, actor:req.user.id, note:input.note || null, id:req.params.id });
    if (kind === 'correction' && item.attendance_id) await connection.execute('UPDATE attendance_records SET correction_pending=FALSE WHERE id=:id', { id:item.attendance_id });
    if (kind === 'flex' && next === 'APPROVED') {
      const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (leaveConflict[0]) throw Object.assign(new Error('This flex-start request overlaps pending or approved leave. Resolve leave before approving the flex start.'), {status:409});
      const [attendanceConflict] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (attendanceConflict[0]) throw Object.assign(new Error('Attendance is already recorded for this date. A flex-start approval cannot change it retroactively.'), {status:409});
      const [correctionConflict] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (correctionConflict[0]) throw Object.assign(new Error('A pending attendance correction exists for this date. Resolve it before approving a flex start.'), {status:409});
      const [wfhConflict] = await connection.execute(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1`, {employee:item.employee_id,date:item.request_date});
      if (wfhConflict[0]) throw Object.assign(new Error('This flex-start request overlaps pending or approved WFH.'), {status:409});
      await connection.execute(`INSERT INTO employee_schedule_exceptions (id,employee_id,exception_date,approved_start_time,approved_by,reason)
        VALUES (:id,:employee,:date,:time,:actor,:reason) ON DUPLICATE KEY UPDATE approved_start_time=VALUES(approved_start_time),approved_by=VALUES(approved_by),reason=VALUES(reason)`, {
        id:crypto.randomUUID(), employee:item.employee_id, date:item.request_date, time:item.requested_start_time, actor:req.user.id, reason:item.reason
      });
    }
  });
  const requestLabel = kind === 'correction' ? 'Attendance correction' : kind === 'flex' ? 'Flex-start request' : kind === 'wfh' ? 'WFH request' : 'Leave request';
  await notify(employeeId, `${requestLabel} ${input.decision === 'APPROVED' ? 'approved' : 'declined'}`,
    input.decision === 'APPROVED' ? 'Your request has been approved.' : `Your request was declined.${input.note ? ` Note: ${input.note}` : ''}`, 'APPROVAL', { type:kind, id:req.params.id, decision:input.decision });
  await audit({ actorId:req.user.id, action:`${kind.toUpperCase()}_${input.decision}`, entityType:`${kind}_request`, entityId:req.params.id, details:{ decision:input.decision, date:recordDate }, ipAddress:req.ip });

  if (employeeId) {
    const summaryDetails: Array<{ label: string; value: string }> = [];
    if (kind === 'leave' && itemRecord) {
      summaryDetails.push(
        { label: 'Leave Type', value: itemRecord.leave_type || 'Leave' },
        { label: 'Duration', value: `${itemRecord.days || 1} day(s) (${String(itemRecord.start_date || '').slice(0, 10)} to ${String(itemRecord.end_date || '').slice(0, 10)})` }
      );
    } else if (kind === 'wfh' && itemRecord) {
      summaryDetails.push(
        { label: 'Category', value: itemRecord.request_kind || 'Work From Home' },
        { label: 'Date', value: String(itemRecord.request_date || '').slice(0, 10) }
      );
    } else if (kind === 'correction' && itemRecord) {
      summaryDetails.push(
        { label: 'Attendance Date', value: String(itemRecord.attendance_date || '').slice(0, 10) },
        { label: 'Reason', value: itemRecord.reason || 'N/A' }
      );
    } else if (kind === 'flex' && itemRecord) {
      summaryDetails.push(
        { label: 'Requested Date', value: String(itemRecord.request_date || '').slice(0, 10) },
        { label: 'Requested Start Time', value: String(itemRecord.requested_start_time || '').slice(0, 5) }
      );
    } else if (recordDate) {
      summaryDetails.push({ label: 'Date', value: String(recordDate).slice(0, 10) });
    }

    try {
      await dispatchWorkflowStatusEmail({
        requestId: req.params.id,
        requestType: kind as any,
        employeeId,
        title: requestLabel,
        decision: input.decision,
        summaryDetails,
        reviewerNote: input.note || null,
        portalRoute: kind === 'leave' ? '/leave' : kind === 'wfh' ? '/wfh' : '/attendance'
      });
    } catch (e: any) {
      console.error(JSON.stringify({
        type: 'approval_status_email_dispatch_failed',
        request_id: req.params.id,
        kind,
        error: String(e?.message || e)
      }));
    }
  }

  res.json({ ok:true });
}));

router.get('/settings', asyncRoute(async (req,res) => {
  const rows = await query('SELECT setting_key,setting_value,updated_at FROM system_settings ORDER BY setting_key');
  res.json({ settings:Object.fromEntries(rows.map((r)=>[r.setting_key, Number.isFinite(Number(r.setting_value)) && r.setting_value.trim() !== '' ? Number(r.setting_value) : r.setting_value])), updatedAt:rows[0]?.updated_at || null });
}));
router.put('/settings', adminMutationLimiter, requireSuperAdmin, asyncRoute(async (req,res) => {
  const schema = z.object({ office_name:z.string().trim().min(2).max(120).optional(), office_latitude:z.number().min(-90).max(90).optional(), office_longitude:z.number().min(-180).max(180).optional(),
    geofence_meters:z.number().int().min(20).max(1000).optional(), wfh_monthly_cap:z.number().int().min(1).max(15).optional(),
    gps_max_accuracy_meters:z.number().int().min(20).max(250).optional(), late_threshold:z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).optional(),
    fixed_lunch_minutes:z.number().int().min(0).max(180).optional(), leave_casual_sl_entitlement:z.number().int().min(0).max(30).optional(),
    leave_earned_entitlement:z.number().int().min(0).max(30).optional(), leave_floating_entitlement:z.number().int().min(0).max(15).optional() }).refine((x)=>Object.keys(x).length>0,'Change at least one setting.');
  const input = validate(schema,req.body);
  await transaction(async (connection) => {
    for (const [key,value] of Object.entries(input)) await connection.execute(`INSERT INTO system_settings (setting_key,setting_value,updated_by) VALUES (:key,:value,:actor) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)`, { key,value:String(value),actor:req.user.id });
  });
  await audit({ actorId:req.user.id, action:'SYSTEM_SETTINGS_UPDATED', entityType:'system_settings', details:{ fields:Object.keys(input) }, ipAddress:req.ip });
  res.json({ok:true});
}));

router.get('/leave-report', asyncRoute(async (req,res)=>{
  const from=String(req.query.from || `${indiaDate().slice(0,4)}-01-01`);
  const to=String(req.query.to || indiaDate());
  if(!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from>to) throw Object.assign(new Error('Choose a valid leave-report date range.'),{status:400});
  const rows=await query(`SELECT r.id,r.leave_type,DATE_FORMAT(r.start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(r.end_date,'%Y-%m-%d') AS end_date,r.days,r.reason,r.status,r.created_at,e.employee_code,e.full_name,e.user_type
    FROM leave_requests r JOIN employees e ON e.id=r.employee_id
    WHERE r.start_date<=:to AND r.end_date>=:from
    ORDER BY r.start_date DESC,r.created_at DESC`,{from,to});
  const summary={requested:rows.length,approved:rows.filter((r)=>r.status==='APPROVED').length,pending:rows.filter((r)=>r.status==='PENDING').length,rejected:rows.filter((r)=>r.status==='REJECTED').length,approvedDays:rows.filter((r)=>r.status==='APPROVED').reduce((sum,r)=>sum+Number(r.days||0),0)};
  res.json({from,to,summary,requests:rows});
}));
router.get('/reports.csv', asyncRoute(async (req,res) => {
  const from=String(req.query.from || `${indiaDate().slice(0,7)}-01`); const to=String(req.query.to || indiaDate());
  if(!dateSchema.safeParse(from).success||!dateSchema.safeParse(to).success||from>to) throw Object.assign(new Error('Choose a valid date range.'),{status:400});
  const rows=await effectiveAttendance(from,to);
  const lunchRows=await query("SELECT setting_value FROM system_settings WHERE setting_key='fixed_lunch_minutes'");
  const lunch=Number(lunchRows[0]?.setting_value || POLICY.fixedLunchMinutes);
  const columns=['employee_code','full_name','user_type','date','check_in_utc','check_out_utc','status','check_in_method','check_out_method','work_minutes_after_fixed_lunch','check_in_distance_m','check_in_accuracy_m'];
  const safe=(value)=>{let text=String(value ?? '');if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  const lines=[columns.map(safe).join(','),...rows.map((r)=>[r.employee_code,r.full_name,r.user_type,r.attendance_date,r.check_in_at,r.check_out_at,r.status,r.check_in_method,r.check_out_method,r.check_in_at&&r.check_out_at?netWorkedMinutes(r.check_in_at,r.check_out_at,lunch):null,r.check_in_distance_m,r.check_in_accuracy_m].map(safe).join(','))];
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="falchion-attendance-${from}-${to}.csv"`); res.setHeader('Cache-Control','private, no-store');
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.get('/recent-activity', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT l.id,l.action,l.entity_type,l.entity_id,l.created_at,e.full_name AS actor_name,e.employee_code
    FROM audit_logs l LEFT JOIN employees e ON e.id=l.actor_id ORDER BY l.created_at DESC LIMIT 10`);
  res.json({logs:rows});
}));

router.get('/audit', requireSuperAdmin, asyncRoute(async(req,res)=>{
  const before=String(req.query.before || '');
  const rows=await query(`SELECT l.id,l.action,l.entity_type,l.entity_id,l.details_json,l.ip_address,l.created_at,e.full_name AS actor_name,e.employee_code
    FROM audit_logs l LEFT JOIN employees e ON e.id=l.actor_id ${before?'WHERE l.created_at<:before':''} ORDER BY l.created_at DESC LIMIT 150`, before?{before}:{});
  res.json({logs:rows.map((row)=>({...row,details:typeof row.details_json==='string'?JSON.parse(row.details_json):row.details_json}))});
}));

router.get('/temporary-exits', asyncRoute(async(req,res)=>{
  const date=String(req.query.date || indiaDate());
  if(!dateSchema.safeParse(date).success)throw Object.assign(new Error('Choose a valid date.'),{status:400});
  const rows=await query(`SELECT x.id,x.left_at,x.returned_at,x.reason,e.full_name,e.employee_code,a.attendance_date FROM temporary_exits x
    JOIN employees e ON e.id=x.employee_id JOIN attendance_records a ON a.id=x.attendance_id WHERE a.attendance_date=:date ORDER BY x.left_at DESC`,{date});
  res.json({exits:rows});
}));

export default router;
