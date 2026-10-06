import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, query, transaction } from '../db.ts';
import { audit, notify, requireAdmin, requireAuth } from '../security.ts';
import { asyncRoute, dateSchema, validate } from '../validate.ts';
import { attendanceStatus, indiaDate, indiaTime, isOfficeNetworkIpAllowed, isScheduledWorkday, netWorkedMinutes, normalizeClientIp, parseOfficeNetworkIps, POLICY } from '../policy.ts';

const router = Router();
router.use(requireAuth, requireAdmin);
const adminMutationLimiter = rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`admin:${req.user.id}`});

async function effectiveAttendance(from, to) {
  const fromDate = new Date(`${from}T12:00:00Z`);
  const toDate = new Date(`${to}T12:00:00Z`);
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || from > to || (toDate.getTime() - fromDate.getTime()) / 86400000 > 366) {
    throw Object.assign(new Error('Choose a valid date range of no more than one year.'), { status:400 });
  }
  const [records, people, leaves, wfh, customHolidays] = await Promise.all([
    query(`SELECT a.id,a.employee_id,a.attendance_date,a.check_in_at,a.check_out_at,a.check_in_method,a.check_out_method,a.check_in_latitude,a.check_in_longitude,a.check_in_accuracy_m,a.check_in_distance_m,a.status,a.correction_pending,
      e.full_name,e.employee_code,e.user_type,(SELECT COUNT(*) FROM temporary_exits x WHERE x.attendance_id=a.id) AS exit_count
      FROM attendance_records a JOIN employees e ON e.id=a.employee_id WHERE a.attendance_date BETWEEN :from AND :to ORDER BY a.attendance_date DESC,a.check_in_at DESC`, { from, to }),
    query(`SELECT id,full_name,employee_code,user_type,DATE_FORMAT(joined_on,'%Y-%m-%d') AS joined_on FROM employees WHERE role='EMPLOYEE' AND status='ACTIVE' AND joined_on<=:to ORDER BY full_name`, { to }),
    query(`SELECT employee_id,DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date FROM leave_requests WHERE status='APPROVED' AND start_date<=:to AND end_date>=:from`, { from, to }),
    query(`SELECT employee_id,DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date FROM wfh_requests WHERE status='APPROVED' AND request_date BETWEEN :from AND :to`, { from, to }),
    query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date BETWEEN :from AND :to`, { from, to })
  ]);
  const holidays = new Set(customHolidays.map((x)=>x.date));
  for (let y=Number(from.slice(0,4));y<=Number(to.slice(0,4));y++) for (const [month,day] of [[1,26],[8,15],[10,2]]) holidays.add(`${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const result=[...records];
  const present=new Set(records.map((r)=>`${r.employee_id}:${r.attendance_date}`));
  const today=indiaDate();
  const currentTime=indiaTime().slice(0,5);
  for(let d=new Date(fromDate);d<=toDate;d.setUTCDate(d.getUTCDate()+1)){
    const date=d.toISOString().slice(0,10);
    if(date>today||d.getUTCDay()===0||holidays.has(date))continue;
    const isPast=date<today;
    const absenceCutoff=isPast||currentTime>'10:30';
    for(const person of people){
      if(date<person.joined_on||present.has(`${person.id}:${date}`))continue;
      const onLeave=leaves.some((item)=>item.employee_id===person.id&&item.start_date<=date&&item.end_date>=date);
      const remote=wfh.some((item)=>item.employee_id===person.id&&item.request_date===date);
      const status=onLeave?'ON_LEAVE':remote?'WFH':absenceCutoff?'ABSENT':null;
      if(!status)continue;
      result.push({id:`${person.id}-${date}`,employee_id:person.id,attendance_date:date,check_in_at:null,check_out_at:null,check_in_method:status==='WFH'?'WFH':null,check_out_method:null,check_in_latitude:null,check_in_longitude:null,check_in_accuracy_m:null,check_in_distance_m:null,status,correction_pending:false,full_name:person.full_name,employee_code:person.employee_code,user_type:person.user_type,exit_count:0});
    }
  }
  return result.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))||String(a.full_name).localeCompare(String(b.full_name)));
}

router.get('/dashboard', asyncRoute(async (req, res) => {
  const today = indiaDate();
  const [people, attendance, pending, recent] = await Promise.all([
    query(`SELECT COUNT(*) AS total, SUM(status='ACTIVE') AS active FROM employees WHERE role='EMPLOYEE'`),
    query(`SELECT COUNT(*) AS total, SUM(status='ON_TIME') AS on_time, SUM(status='LATE_ENTRY') AS late, SUM(check_out_at IS NULL) AS still_in
      FROM attendance_records WHERE attendance_date=:today`, { today }),
    query(`SELECT (SELECT COUNT(*) FROM leave_requests WHERE status='PENDING') + (SELECT COUNT(*) FROM wfh_requests WHERE status='PENDING') +
      (SELECT COUNT(*) FROM attendance_correction_requests WHERE status='PENDING') + (SELECT COUNT(*) FROM flex_start_requests WHERE status='PENDING') AS total`),
    query(`SELECT a.id, a.attendance_date, a.check_in_at, a.check_out_at, a.check_in_distance_m, a.status, a.check_in_method,
      e.full_name, e.employee_code FROM attendance_records a JOIN employees e ON e.id=a.employee_id
      WHERE a.attendance_date=:today ORDER BY a.check_in_at DESC LIMIT 8`, { today })
  ]);
  const [out, effectiveToday] = await Promise.all([
    query(`SELECT x.id,x.left_at,x.reason,e.full_name,e.employee_code FROM temporary_exits x
      JOIN attendance_records a ON a.id=x.attendance_id JOIN employees e ON e.id=x.employee_id
      WHERE a.attendance_date=:today AND x.returned_at IS NULL ORDER BY x.left_at DESC`, { today }),
    effectiveAttendance(today,today)
  ]);
  const holidayRows=await query(`SELECT name FROM company_holidays WHERE holiday_date=:today LIMIT 1`,{today});
  const nationalNames=new Map([[`${today.slice(0,4)}-01-26`,'Republic Day'],[`${today.slice(0,4)}-08-15`,'Independence Day'],[`${today.slice(0,4)}-10-02`,'Gandhi Jayanti']]);
  const officeHoliday=!isScheduledWorkday(today,new Set(holidayRows.length?[today]:[]));
  const holidayName=holidayRows[0]?.name||nationalNames.get(today)||(new Date(`${today}T12:00:00Z`).getUTCDay()===0?'Sunday':'');
  const absenceCount=effectiveToday.filter((row)=>row.status==='ABSENT').length;
  const leaveCount=effectiveToday.filter((row)=>row.status==='ON_LEAVE').length;
  const approvedWfhCount=effectiveToday.filter((row)=>row.status==='WFH').length;
  res.json({ date: today, officeHoliday, holidayName, stats: { employees: Number(people[0].active || 0), present: Number(attendance[0].total || 0), onTime: Number(attendance[0].on_time || 0), late: Number(attendance[0].late || 0), stillIn: Number(attendance[0].still_in || 0), pending: Number(pending[0].total || 0), outNow: out.length, absent:absenceCount, onLeave:leaveCount, approvedWfh:approvedWfhCount }, temporaryExits:out, recent });
}));

router.get('/system-health', asyncRoute(async (req, res) => {
  const started = process.hrtime.bigint();
  const [rows] = await pool.query('SELECT VERSION() AS mysql_version, UTC_TIMESTAMP() AS database_time');
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  const configuredNetwork = String(process.env.OFFICE_NETWORK_IPS || (process.env.NODE_ENV === 'development' ? '127.0.0.1,::1' : '')).trim();
  const configuredNetworkIps = parseOfficeNetworkIps(configuredNetwork);
  const currentNetworkIp = normalizeClientIp(req.ip);
  res.json({
    status: 'ok',
    service: 'falchion-xeniaa-api',
    version: process.env.APP_VERSION || '1.0.0',
    build: process.env.BUILD_SHA || 'development',
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    mysqlVersion: rows[0]?.mysql_version || null,
    databaseLatencyMs: latencyMs,
    officeNetwork: {
      configured: configuredNetworkIps.length > 0,
      matchedCurrentRequest: configuredNetworkIps.length > 0 && isOfficeNetworkIpAllowed(currentNetworkIp, configuredNetwork),
      currentClientIp: currentNetworkIp,
      configuredIpCount: configuredNetworkIps.length
    }
  });
}));

router.get('/users', asyncRoute(async (req, res) => {
  const users = await query(`SELECT e.id, e.employee_code, e.full_name, e.email, e.role, e.user_type, e.status, e.title, e.phone, e.wfh_enabled, e.joined_on,
    e.probation_end_date, (SELECT COUNT(*) FROM attendance_records a WHERE a.employee_id=e.id AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND a.status='LATE_ENTRY') AS late_count
    FROM employees e ORDER BY e.role DESC, e.full_name`);
  res.json({ users });
}));
router.post('/users', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ employeeCode: z.string().trim().min(2).max(24), fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254),
    userType: z.enum(['EMPLOYEE','INTERN','ADMIN']).default('EMPLOYEE'), title: z.string().trim().max(120).default('Employee'), phone: z.string().trim().max(32).optional(),
    wfhEnabled: z.boolean().default(false), joinedOn: dateSchema.optional(), probationEndDate: dateSchema.nullable().optional()
  }), req.body);
  const id = crypto.randomUUID();
  const userType = input.userType;
  await query(`INSERT INTO employees (id, employee_code, full_name, email, role, user_type, title, phone, joined_on, probation_end_date, wfh_enabled)
    VALUES (:id,:code,:name,:email,:role,:userType,:title,:phone,:joined,:probation,:wfh)`, {
    id, code: input.employeeCode, name: input.fullName, email: input.email.toLowerCase(), role: userType === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE', userType,
    title: input.title || 'Employee', phone: input.phone || null, joined: input.joinedOn || indiaDate(), probation: input.probationEndDate || null, wfh: input.wfhEnabled
  });
  await audit({ actorId: req.user.id, action: 'EMPLOYEE_CREATED', entityType: 'employee', entityId: id, details: { employee_code: input.employeeCode, role: userType === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE' }, ipAddress: req.ip });
  res.status(201).json({ ok: true, id });
}));
router.patch('/users/:id', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(254).optional(), title: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).nullable().optional(), userType: z.enum(['EMPLOYEE','INTERN','ADMIN']).optional(), status: z.enum(['ACTIVE','INACTIVE']).optional(),
    wfhEnabled: z.boolean().optional(), joinedOn: dateSchema.optional(), probationEndDate: dateSchema.nullable().optional()
  }).refine((body) => Object.keys(body).length > 0, 'Make at least one change.'), req.body);
  if (req.params.id === req.user.id && input.status === 'INACTIVE') throw Object.assign(new Error('You cannot deactivate your own administrator account.'), { status: 400 });
  const [user] = await query('SELECT id FROM employees WHERE id=:id', { id: req.params.id });
  if (!user) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  const fields = {
    fullName:['full_name',input.fullName], email:['email',input.email?.toLowerCase()], title:['title',input.title], phone:['phone',input.phone],
    userType:['user_type',input.userType], status:['status',input.status], wfhEnabled:['wfh_enabled',input.wfhEnabled], joinedOn:['joined_on',input.joinedOn], probationEndDate:['probation_end_date',input.probationEndDate]
  };
  const values: any[] = [];
  const sets: string[] = []
  for (const [key, [column, value]] of Object.entries(fields)) if (value !== undefined) { sets.push(`${column}=?`); values.push(value); }
  if (input.userType !== undefined) { sets.push('role=?'); values.push(input.userType === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE'); }
  values.push(req.params.id);
  await query(`UPDATE employees SET ${sets.join(',')} WHERE id=?`, values);
  await audit({ actorId: req.user.id, action: 'EMPLOYEE_UPDATED', entityType: 'employee', entityId: req.params.id, details: { fields: Object.keys(input) }, ipAddress: req.ip });
  res.json({ ok: true });
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
    query(`SELECT r.id,'leave' AS type,r.employee_id,e.full_name,e.employee_code,r.leave_type AS category,r.start_date AS date,r.end_date,r.days,r.reason,r.created_at,r.attachment_id,a.original_filename AS attachment_name FROM leave_requests r JOIN employees e ON e.id=r.employee_id LEFT JOIN attachments a ON a.id=r.attachment_id WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'wfh' AS type,r.employee_id,e.full_name,e.employee_code,r.request_kind AS category,r.request_date AS date,NULL AS end_date,1 AS days,r.reason,r.created_at,NULL AS attachment_name FROM wfh_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'correction' AS type,r.employee_id,e.full_name,e.employee_code,'Attendance correction' AS category,r.attendance_date AS date,NULL AS end_date,NULL AS days,r.reason,r.created_at,NULL AS attachment_name FROM attendance_correction_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDING' ORDER BY r.created_at`),
    query(`SELECT r.id,'flex' AS type,r.employee_id,e.full_name,e.employee_code,CONCAT('Flex start · ',TIME_FORMAT(r.requested_start_time,'%h:%i %p')) AS category,r.request_date AS date,NULL AS end_date,NULL AS days,r.reason,r.created_at,NULL AS attachment_name FROM flex_start_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDING' ORDER BY r.created_at`)
  ]);
  res.json({ approvals: [...leave,...wfh,...correction,...flex].sort((a,b) => new Date(a.created_at).getTime()-new Date(b.created_at).getTime()) });
}));

router.post('/approvals/:type/:id', adminMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ decision: z.enum(['APPROVED','REJECTED']), note: z.string().trim().max(1000).optional() }), req.body);
  const kind = req.params.type;
  if (!['leave','wfh','correction','flex'].includes(kind)) throw Object.assign(new Error('Unknown approval type.'), { status: 400 });
  let employeeId = null;
  let recordDate = null;
  await transaction(async (connection) => {
    const table = { leave:'leave_requests', wfh:'wfh_requests', correction:'attendance_correction_requests', flex:'flex_start_requests' }[kind];
    const [rows] = await connection.execute(`SELECT * FROM ${table} WHERE id=:id AND status='PENDING' FOR UPDATE`, { id: req.params.id });
    if (!rows[0]) throw Object.assign(new Error('This request is no longer pending.'), { status: 409 });
    const item = rows[0];
    employeeId = item.employee_id;
    recordDate = item.start_date || item.request_date || item.attendance_date;
    if (kind === 'correction' && input.decision === 'APPROVED') {
      const [existing] = await connection.execute('SELECT * FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE', { employee: item.employee_id, date: item.attendance_date });
      const checkIn = item.requested_check_in_at || existing[0]?.check_in_at;
      const checkOut = item.requested_check_out_at || existing[0]?.check_out_at;
      if (!checkIn) throw Object.assign(new Error('The correction needs a check-in time before it can be approved.'), { status: 400 });
      if (checkOut && new Date(checkOut) < new Date(checkIn)) throw Object.assign(new Error('Check-out must be after check-in.'), { status: 400 });
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
      await connection.execute(`INSERT INTO employee_schedule_exceptions (id,employee_id,exception_date,approved_start_time,approved_by,reason)
        VALUES (:id,:employee,:date,:time,:actor,:reason) ON DUPLICATE KEY UPDATE approved_start_time=VALUES(approved_start_time),approved_by=VALUES(approved_by),reason=VALUES(reason)`, {
        id:crypto.randomUUID(), employee:item.employee_id, date:item.request_date, time:item.requested_start_time, actor:req.user.id, reason:item.reason
      });
    }
  });
  await notify(employeeId, `${kind === 'correction' ? 'Attendance correction' : kind === 'flex' ? 'Flex-start request' : kind === 'wfh' ? 'WFH request' : 'Leave request'} ${input.decision === 'APPROVED' ? 'approved' : 'reviewed'}`,
    input.decision === 'APPROVED' ? 'Your request has been approved.' : `Your request was not approved.${input.note ? ` Note: ${input.note}` : ''}`, 'APPROVAL', { type:kind, id:req.params.id });
  await audit({ actorId:req.user.id, action:`${kind.toUpperCase()}_${input.decision}`, entityType:`${kind}_request`, entityId:req.params.id, details:{ decision:input.decision, date:recordDate }, ipAddress:req.ip });
  res.json({ ok:true });
}));

router.get('/settings', asyncRoute(async (req,res) => {
  const rows = await query('SELECT setting_key,setting_value,updated_at FROM system_settings ORDER BY setting_key');
  res.json({ settings:Object.fromEntries(rows.map((r)=>[r.setting_key, Number.isFinite(Number(r.setting_value)) && r.setting_value.trim() !== '' ? Number(r.setting_value) : r.setting_value])), updatedAt:rows[0]?.updated_at || null });
}));
router.put('/settings', adminMutationLimiter, asyncRoute(async (req,res) => {
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

router.get('/audit', asyncRoute(async(req,res)=>{
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
