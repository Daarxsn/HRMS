import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { audit, requireAuth, notifyAdmins, requirePeople } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { indiaDate, workingDaysInclusive } from '../policy.mts';
import { htmlEscape, sendEmail, smtpConfigured } from '../mailer.mts';

const router = Router();
router.use(requireAuth, requirePeople);
const leaveMutationLimiter = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});

async function emailLeaveRequestToAdmins(request) {
  const admins = await query("SELECT email FROM employees WHERE role='ADMIN' AND user_type='ADMIN' AND status='ACTIVE' AND email IS NOT NULL");
  if (!admins.length) return { configured:smtpConfigured(), sent:0, recipients:0 };
  const origin = String(process.env.APP_ORIGIN || '').replace(/\/$/, '');
  const approvalUrl = origin ? origin + '/admin/approvals' : '';
  const attachmentNote = request.attachmentId ? 'Supporting document: attached in the HRMS request record.' : 'Supporting document: none.';
  let sentCount = 0;
  await Promise.allSettled(admins.map(async (admin) => {
    try {
      const subject = 'Leave request · ' + request.employeeName + ' · ' + request.leaveType;
      const text = [
        'Falchion Xeniaa HRMS',
        '',
        'A new leave request has been submitted.',
        'Employee: ' + request.employeeName + ' (' + request.employeeCode + ')',
        'Email: ' + request.employeeEmail,
        'Leave type: ' + request.leaveType,
        'From: ' + request.startDate,
        'To: ' + request.endDate,
        'Working days: ' + request.days,
        'Reason: ' + request.reason,
        attachmentNote,
        approvalUrl ? 'Review: ' + approvalUrl : ''
      ].filter(Boolean).join('\n');
      const html = '<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111"><div style="max-width:640px;margin:0 auto;padding:24px">'
        + '<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#931314;font-weight:700">FALCHION XENIAA · HRMS</p>'
        + '<h1 style="margin:0 0 8px;font-size:28px">New leave request</h1>'
        + '<p style="color:#555">A new leave request has been submitted for administrator review.</p>'
        + '<div style="border:1px solid #e5e5e5;border-radius:14px;padding:18px;margin-top:18px">'
        + '<p><strong>Employee</strong><br>' + htmlEscape(request.employeeName) + ' · ' + htmlEscape(request.employeeCode) + '</p>'
        + '<p><strong>Email</strong><br>' + htmlEscape(request.employeeEmail) + '</p>'
        + '<p><strong>Leave</strong><br>' + htmlEscape(request.leaveType) + '</p>'
        + '<p><strong>Dates</strong><br>' + htmlEscape(request.startDate) + ' → ' + htmlEscape(request.endDate) + '</p>'
        + '<p><strong>Working days</strong><br>' + request.days + '</p>'
        + '<p><strong>Reason</strong><br>' + htmlEscape(request.reason) + '</p>'
        + '<p><strong>Record</strong><br>' + htmlEscape(attachmentNote) + '</p>'
        + '</div>'
        + (approvalUrl ? '<p style="margin-top:20px"><a href="' + htmlEscape(approvalUrl) + '" style="display:inline-block;background:#931314;color:#fff;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700">Open approval queue</a></p>' : '')
        + '<p style="font-size:12px;color:#777;margin-top:26px">This email is a record of the leave request. Final approval remains inside HRMS.</p>'
        + '</div></body></html>';
      const result = await sendEmail({ to:[String(admin.email)], subject, text, html, replyTo:request.employeeEmail });
      if (result.sent) sentCount += 1;
    } catch (error) {
      console.warn(JSON.stringify({ type:'leave_request_email_failed', request_id:request.id, recipient:String(admin.email), error:String(error?.message || error) }));
    }
  }));
  return { configured:smtpConfigured(), sent:sentCount, recipients:admins.length };
}


async function getLeaveBalances(employee, connection = null) {
  const execute = async (sql: string, values: any = {}): Promise<any> => connection ? (await connection.execute(sql, values))[0] : query(sql, values);
  const today = indiaDate();
  const year = Number(today.slice(0, 4));
  const holidays = await execute(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE YEAR(holiday_date)=:year`, { year });
  const holidaySet = new Set(holidays.map((row) => row.date));
  const [requests, policyRows] = await Promise.all([
    execute(`SELECT leave_type, status, SUM(days) AS days FROM leave_requests WHERE employee_id=:employee AND YEAR(start_date)=:year GROUP BY leave_type, status`, { employee, year }),
    execute(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('leave_casual_sl_entitlement','leave_earned_entitlement','leave_floating_entitlement')`)
  ]);
  const byKey = new Map<string, number>();
  for (const row of requests as any[]) byKey.set(`${row.leave_type}:${row.status}`, Number(row.days));
  const userRows = await execute('SELECT joined_on, probation_end_date FROM employees WHERE id=:employee', { employee });
  const probation = userRows[0]?.probation_end_date;
  const currentMonth = Number(today.slice(5, 7));
  const currentDay = Number(today.slice(8, 10));
  const policy = Object.fromEntries((policyRows as any[]).map((row) => [row.setting_key, Number(row.setting_value)]));
  const casualEntitlement = Number.isFinite(policy.leave_casual_sl_entitlement) ? policy.leave_casual_sl_entitlement : 8;
  const earnedEntitlement = Number.isFinite(policy.leave_earned_entitlement) ? policy.leave_earned_entitlement : 15;
  const floatingEntitlement = Number.isFinite(policy.leave_floating_entitlement) ? policy.leave_floating_entitlement : 4;
  let earnedAccrued = 0;
  if (probation && probation <= today) {
    const probationYear = Number(String(probation).slice(0, 4));
    const probationMonth = Number(String(probation).slice(5, 7));
    const firstEligibleMonth = probationYear < year ? 1 : probationYear > year ? 13 : probationMonth + 1;
    const lastAccrualMonth = currentDay === new Date(year,currentMonth,0).getDate() ? currentMonth : currentMonth - 1;
    earnedAccrued = Math.max(0, Math.min(earnedEntitlement, (lastAccrualMonth - firstEligibleMonth + 1)));
  }
  const sharedUsed = (byKey.get('CASUAL:APPROVED') || 0) + (byKey.get('SICK:APPROVED') || 0);
  const sharedPending = (byKey.get('CASUAL:PENDING') || 0) + (byKey.get('SICK:PENDING') || 0);
  const definitions: Array<[string,string,number]> = [
    ['CASUAL','Casual leave',casualEntitlement], ['SICK','Sick leave',casualEntitlement], ['EARNED','Earned leave',earnedEntitlement], ['FLOATING','Floating leave',floatingEntitlement]
  ];
  return definitions.map(([type, label, entitlement]) => {
    const accrued = type === 'EARNED' ? earnedAccrued : entitlement;
    const used = type === 'CASUAL' || type === 'SICK' ? sharedUsed : byKey.get(`${type}:APPROVED`) || 0;
    const pending = type === 'CASUAL' || type === 'SICK' ? sharedPending : byKey.get(`${type}:PENDING`) || 0;
    const remaining = Math.max(0, accrued - used - pending);
    return { type, label, entitlement, accrued, used, pending, remaining, note: type === 'EARNED' ? `Accrues 1 day/month after probation, up to ${earnedEntitlement} days/year.` : type === 'CASUAL' || type === 'SICK' ? 'Casual and sick leave share one 8-day annual balance.' : null };
  });
}

router.get('/balances', asyncRoute(async (req, res) => res.json({ balances: await getLeaveBalances(req.user.id) })));
router.get('/', asyncRoute(async (req, res) => {
  const requests = await query(`SELECT r.id, r.leave_type, r.start_date, r.end_date, r.days, r.reason, r.status, r.reviewer_note, r.created_at,
      a.original_filename AS attachment_name
    FROM leave_requests r LEFT JOIN attachments a ON a.id=r.attachment_id
    WHERE r.employee_id=:employee ORDER BY r.created_at DESC LIMIT 100`, { employee: req.user.id });
  res.json({ requests });
}));

router.post('/', leaveMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({
    type: z.enum(['CASUAL','SICK','EARNED','FLOATING']), startDate: dateSchema,
    endDate: dateSchema, reason: z.string().trim().min(8).max(1000), attachmentId: z.string().uuid().optional()
  }), req.body);
  if (input.startDate > input.endDate) throw Object.assign(new Error('End date must be the same as or after the start date.'), { status: 400 });
  if (input.startDate.slice(0,4) !== input.endDate.slice(0,4)) throw Object.assign(new Error('Submit separate leave requests for each calendar year.'), { status: 400 });
  if (input.startDate < indiaDate()) throw Object.assign(new Error('Leave requests cannot start in the past. Use attendance correction for a missed record.'), { status: 400 });
  const holidayRows = await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date BETWEEN :from AND :to`, { from: input.startDate, to: input.endDate });
  const holidaySet = new Set(holidayRows.map((row) => row.date));
  const holidayYear = Number(input.startDate.slice(0,4));
  for (const [month,day] of [[1,26],[8,15],[10,2]]) holidaySet.add(`${holidayYear}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const days = workingDaysInclusive(input.startDate, input.endDate, holidaySet);
  if (days < 1) throw Object.assign(new Error('The selected dates do not include a scheduled workday.'), { status: 400 });
  const calendarDays = Math.round((new Date(`${input.endDate}T12:00:00Z`).getTime() - new Date(`${input.startDate}T12:00:00Z`).getTime()) / 86400000) + 1;
  if (input.type === 'SICK' && calendarDays >= 3 && !input.attachmentId) throw Object.assign(new Error('A doctor’s note is required for sick leave of three or more consecutive days.'), { status: 400 });
  if (input.attachmentId) {
    const file = await query('SELECT id FROM attachments WHERE id=:id AND uploaded_by=:employee', { id: input.attachmentId, employee: req.user.id });
    if (!file[0]) throw Object.assign(new Error('That attachment is not available for your account.'), { status: 403 });
  }
  const id = crypto.randomUUID();
  await transaction(async(connection)=>{
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE',{employee:req.user.id});
    const [overlap] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:end AND end_date>=:start LIMIT 1`, {
      employee: req.user.id, start: input.startDate, end: input.endDate
    });
    if (overlap[0]) throw Object.assign(new Error('You already have a pending or approved request during those dates.'), { status: 409 });
    const balances = await getLeaveBalances(req.user.id,connection);
    const balanceType = input.type === 'CASUAL' || input.type === 'SICK' ? 'CASUAL' : input.type;
    const balance = balances.find((item) => item.type === balanceType);
    if (!balance || days > balance.remaining) throw Object.assign(new Error(`This request exceeds your available ${balance?.label || 'leave'} balance (${balance?.remaining || 0} day(s)).`), { status: 400 });
    await connection.execute(`INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, days, reason, attachment_id)
      VALUES (:id, :employee, :type, :start, :end, :days, :reason, :attachment)`, {
      id, employee: req.user.id, type: input.type, start: input.startDate, end: input.endDate, days, reason: input.reason, attachment: input.attachmentId || null
    });
  });
  await audit({ actorId: req.user.id, action: 'LEAVE_REQUESTED', entityType: 'leave_request', entityId: id, details: { type: input.type, from: input.startDate, to: input.endDate, days }, ipAddress: req.ip });
  await notifyAdmins('Leave request needs review', `${req.user.full_name} requested ${days} day(s) of ${input.type.toLowerCase()} leave.`, 'REQUEST', { type:'leave', id });
  await emailLeaveRequestToAdmins({
    id,
    employeeName:req.user.full_name,
    employeeCode:req.user.employee_code,
    employeeEmail:req.user.email,
    leaveType:input.type,
    startDate:input.startDate,
    endDate:input.endDate,
    days,
    reason:input.reason,
    attachmentId:input.attachmentId || null
  });
  res.status(201).json({ ok: true, id, days });
}));

router.delete('/:id', leaveMutationLimiter, asyncRoute(async (req, res) => {
  const result = await query(`UPDATE leave_requests SET status='CANCELLED' WHERE id=:id AND employee_id=:employee AND status='PENDING'`, { id: req.params.id, employee: req.user.id });
  if (!result.affectedRows) throw Object.assign(new Error('Only pending requests can be withdrawn.'), { status: 409 });
  await audit({ actorId: req.user.id, action: 'LEAVE_REQUEST_CANCELLED', entityType: 'leave_request', entityId: req.params.id, ipAddress: req.ip });
  res.json({ ok: true });
}));

export default router;
