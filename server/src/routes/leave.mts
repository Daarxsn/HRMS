import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { audit, requireAuth, notify, notifyAdmins, requirePeople, isAdmin } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { calculateTenureMonths, earnedLeaveAccrualForEmployment, indiaDate, internLeaveEntitlement, workingDaysInclusive } from '../policy.mts';
import { htmlEscape } from '../mailer.mts';
import { enqueueHrNotificationEmail } from '../email-outbox.mts';
import { dispatchWorkflowRequestEmails, dispatchWorkflowStatusEmail } from '../email-routing.mts';

const router = Router();
router.use(requireAuth, (req, res, next) => {
  if (req.path.startsWith('/admin/')) return next();
  return requirePeople(req, res, next);
});
const leaveMutationLimiter = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});

async function emailLeaveRequestToAdmin(request) {
  const attachmentNote = request.attachmentId ? 'Supporting document attached in request record' : 'No supporting document attached';
  try {
    const delivery = await dispatchWorkflowRequestEmails({
      requestId: request.id,
      requestType: 'leave',
      employeeId: request.employeeId,
      title: 'Leave Request',
      summaryDetails: [
        { label: 'Leave Type', value: request.leaveType },
        { label: 'Dates', value: `${request.startDate} → ${request.endDate}` },
        { label: 'Working Days', value: `${request.days} day(s)` }
      ],
      reason: request.reason,
      attachmentNote,
      portalRoute: '/leave'
    });
    return {
      configured: true,
      sent: 0,
      queued: Boolean(delivery.managerEmail?.queued || delivery.confirmationEmail?.queued),
      status: delivery.managerEmail?.status || 'QUEUED',
      outboxId: delivery.managerEmail?.id || delivery.confirmationEmail?.id || null,
      recipients: (delivery.managerEmail?.recipientCount || 0) + (delivery.confirmationEmail?.recipientCount || 0)
    };
  } catch (error) {
    console.error(JSON.stringify({
      type: 'leave_request_email_enqueue_failed',
      request_id: request.id,
      error: String(error?.message || error)
    }));
    return { configured: false, sent: 0, queued: false, status: 'ENQUEUE_FAILED', outboxId: null, recipients: 0 };
  }
}

async function getLeaveBalances(employee, connection = null) {
  const execute = async (sql: string, values: any = {}): Promise<any> => connection ? (await connection.execute(sql, values))[0] : query(sql, values);
  const today = indiaDate();
  const year = Number(today.slice(0, 4));
  const holidays = await execute(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_kind='FIXED' AND YEAR(holiday_date)=:year`, { year });
  const holidaySet = new Set(holidays.map((row) => row.date));
  const [requests, policyRows] = await Promise.all([
    execute(`SELECT leave_type, status, SUM(days) AS days FROM leave_requests WHERE employee_id=:employee AND YEAR(start_date)=:year GROUP BY leave_type, status`, { employee, year }),
    execute(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('leave_casual_sl_entitlement','leave_earned_entitlement','leave_floating_entitlement')`)
  ]);
  const byKey = new Map<string, number>();
  for (const row of requests as any[]) byKey.set(`${row.leave_type}:${row.status}`, Number(row.days));
  const userRows = await execute(`SELECT joined_on, probation_end_date, status, role, user_type,
    (SELECT DATE_FORMAT(MAX(s.last_working_date),'%Y-%m-%d') FROM separation_cases s WHERE s.employee_id=employees.id AND s.status IN ('OPEN','IN_PROGRESS','COMPLETED')) AS last_working_date
    FROM employees WHERE id=:employee`, { employee });
  const isIntern = userRows[0]?.user_type === 'INTERN' || userRows[0]?.role === 'INTERN';
  const probation = userRows[0]?.probation_end_date;
  // A NULL probation end date means no probation end date was configured, not
  // that the employee is permanently ineligible for earned leave. In that case
  // accrue from the employee's join date using the same completed-month rule.
  // A NULL probation end date uses joining date as the accrual reference.
  const policy = Object.fromEntries((policyRows as any[]).map((row) => [row.setting_key, Number(row.setting_value)]));
  const baseCasualEntitlement = Number.isFinite(policy.leave_casual_sl_entitlement) ? policy.leave_casual_sl_entitlement : 8;
  const casualEntitlement = isIntern ? internLeaveEntitlement(userRows[0]?.joined_on, today) : baseCasualEntitlement;
  const earnedEntitlement = isIntern ? 0 : (Number.isFinite(policy.leave_earned_entitlement) ? policy.leave_earned_entitlement : 15);
  const floatingEntitlement = Number.isFinite(policy.leave_floating_entitlement) ? policy.leave_floating_entitlement : 4;
  const earnedAccrual = isIntern
    ? { accrued: 0, reviewRequired: false, accrualAsOf: today }
    : earnedLeaveAccrualForEmployment(today, userRows[0]?.joined_on, probation, userRows[0]?.status, userRows[0]?.last_working_date, earnedEntitlement);
  const earnedAccrued = earnedAccrual.accrued;
  const sharedUsed = (byKey.get('CASUAL:APPROVED') || 0) + (byKey.get('SICK:APPROVED') || 0);
  const sharedPending = (byKey.get('CASUAL:PENDING') || 0) + (byKey.get('SICK:PENDING') || 0);
  const definitions: Array<[string,string,number]> = [
    ['CASUAL','Casual leave',casualEntitlement], ['SICK','Sick leave',casualEntitlement], ['EARNED','Earned leave',earnedEntitlement], ['FLOATING','Floating leave',floatingEntitlement], ['LEARNING','Learning time off',8]
  ];
  return definitions.map(([type, label, entitlement]) => {
    const accrued = type === 'EARNED' ? earnedAccrued : entitlement;
    const used = type === 'CASUAL' || type === 'SICK' ? sharedUsed : byKey.get(`${type}:APPROVED`) || 0;
    const pending = type === 'CASUAL' || type === 'SICK' ? sharedPending : byKey.get(`${type}:PENDING`) || 0;
    const remaining = Math.max(0, accrued - used - pending);
    const reviewRequired = type === 'EARNED' && earnedAccrual.reviewRequired;
    const note = reviewRequired
      ? 'HR review required: this employee is inactive but has no recorded last working date. The displayed accrual is provisional.'
      : type === 'EARNED'
        ? (isIntern ? 'Interns are not eligible for Earned Leave accrual.' : `Accrues 1 day/month after probation, up to ${earnedEntitlement} days/year.`)
        : type === 'CASUAL' || type === 'SICK'
          ? (isIntern ? 'Intern leave accrues at 1 day per month worked (up to 12 days/year).' : 'Casual and sick leave share one 8-day annual balance.')
          : type === 'LEARNING'
            ? 'Up to 2 days per calendar quarter for professional development, courses, or certifications.'
            : null;
    return { type, label, entitlement, accrued, used, pending, remaining, reviewRequired, note };
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
    type: z.enum(['CASUAL','SICK','EARNED','FLOATING','LEARNING']), startDate: dateSchema,
    endDate: dateSchema, reason: z.string().trim().min(8).max(1000), attachmentId: z.string().uuid().optional()
  }), req.body);
  if (input.startDate > input.endDate) throw Object.assign(new Error('End date must be the same as or after the start date.'), { status: 400 });
  if (input.startDate.slice(0,4) !== input.endDate.slice(0,4)) throw Object.assign(new Error('Submit separate leave requests for each calendar year.'), { status: 400 });
  if (input.startDate < indiaDate()) throw Object.assign(new Error('Leave requests cannot start in the past. Use attendance correction for a missed record.'), { status: 400 });
  const holidayRows = await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :from AND :to`, { from: input.startDate, to: input.endDate });
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
    if (overlap[0]) throw Object.assign(new Error('You already have a pending or approved leave request during those dates.'), { status: 409 });
    const [wfhOverlap] = await connection.execute(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1`, {
      employee: req.user.id, start: input.startDate, end: input.endDate
    });
    if (wfhOverlap[0]) throw Object.assign(new Error('A pending or approved WFH request already exists during those dates. Cancel or resolve it before requesting leave.'), { status: 409 });
    const [flexOverlap] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1`, {
      employee:req.user.id, start:input.startDate, end:input.endDate
    });
    if (flexOverlap[0]) throw Object.assign(new Error('A pending or approved flex-start request exists during those dates. Resolve it before requesting leave.'), {status:409});
    const [correctionOverlap] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND status='PENDING' AND attendance_date BETWEEN :start AND :end LIMIT 1`, {
      employee:req.user.id, start:input.startDate, end:input.endDate
    });
    if (correctionOverlap[0]) throw Object.assign(new Error('A pending attendance correction exists during those dates. Resolve it before requesting leave.'), {status:409});
    const [attendanceOverlap] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date BETWEEN :start AND :end LIMIT 1`, {
      employee: req.user.id, start: input.startDate, end: input.endDate
    });
    if (attendanceOverlap[0]) throw Object.assign(new Error('Attendance has already been recorded during those dates. Submit an attendance correction or contact HR instead.'), { status: 409 });
    if (input.type === 'EARNED' && (req.user.user_type === 'INTERN' || req.user.role === 'INTERN')) {
      throw Object.assign(new Error('Interns are not eligible for Earned Leave.'), { status: 400 });
    }
    if (input.type === 'LEARNING') {
      const [quarterUsage] = await connection.execute(
        `SELECT COALESCE(SUM(days), 0) AS used_days
         FROM leave_requests
         WHERE employee_id = :employee
           AND leave_type = 'LEARNING'
           AND status IN ('PENDING', 'APPROVED')
           AND YEAR(start_date) = YEAR(:start)
           AND QUARTER(start_date) = QUARTER(:start)`,
        { employee: req.user.id, start: input.startDate }
      );
      const usedQuarterDays = Number((quarterUsage as any)[0]?.used_days || 0);
      if (usedQuarterDays + days > 2) {
        throw Object.assign(new Error(`Learning Time Off is capped at 2 days per calendar quarter. You have already used or requested ${usedQuarterDays} day(s) this quarter.`), { status: 400 });
      }
    } else {
      const balances = await getLeaveBalances(req.user.id,connection);
      const balanceType = input.type === 'CASUAL' || input.type === 'SICK' ? 'CASUAL' : input.type;
      const balance = balances.find((item) => item.type === balanceType);
      const balanceLabel = input.type === 'SICK' ? 'Sick leave' : balance?.label || 'leave';
      if (input.type === 'EARNED' && balance?.reviewRequired) throw Object.assign(new Error('Earned-leave accrual needs HR review because this employee is inactive and no last working date is recorded.'), {status:409});
      if (!balance || days > balance.remaining) throw Object.assign(new Error(`This request exceeds your available ${balanceLabel} balance (${balance?.remaining || 0} day(s)).`), { status: 400 });
    }
    await connection.execute(`INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, days, reason, attachment_id)
      VALUES (:id, :employee, :type, :start, :end, :days, :reason, :attachment)`, {
      id, employee: req.user.id, type: input.type, start: input.startDate, end: input.endDate, days, reason: input.reason, attachment: input.attachmentId || null
    });
  });
  await audit({ actorId: req.user.id, action: 'LEAVE_REQUESTED', entityType: 'leave_request', entityId: id, details: { type: input.type, from: input.startDate, to: input.endDate, days }, ipAddress: req.ip });
  await notifyAdmins('Leave request needs review', `${req.user.full_name} requested ${days} day(s) of ${input.type.toLowerCase()} leave.`, 'REQUEST', { type:'leave', id });
  const emailDelivery = await emailLeaveRequestToAdmin({
    id,
    employeeId: req.user.id,
    employeeName: req.user.full_name,
    employeeCode: req.user.employee_code,
    employeeEmail: req.user.email,
    leaveType: input.type,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    reason: input.reason,
    attachmentId: input.attachmentId || null
  });
  res.status(201).json({ ok: true, id, days, emailDelivery });
}));

router.delete('/:id', leaveMutationLimiter, asyncRoute(async (req, res) => {
  await transaction(async (connection) => {
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', { employee: req.user.id });
    const [result]: any = await connection.execute(`UPDATE leave_requests SET status='CANCELLED' WHERE id=:id AND employee_id=:employee AND status='PENDING'`, { id: req.params.id, employee: req.user.id });
    if (!result.affectedRows) throw Object.assign(new Error('Only pending requests can be withdrawn.'), { status: 409 });
  });
  await audit({ actorId: req.user.id, action: 'LEAVE_REQUEST_CANCELLED', entityType: 'leave_request', entityId: req.params.id, ipAddress: req.ip });
  res.json({ ok: true });
}));

// ==========================================
// Phase 7: Earned Leave Encashment
// ==========================================
router.get('/encashment/eligibility', asyncRoute(async (req, res) => {
  const [emp] = await query('SELECT joined_on FROM employees WHERE id=:id LIMIT 1', { id: req.user.id });
  const tenureMonths = calculateTenureMonths(emp?.joined_on);
  const balances = await getLeaveBalances(req.user.id);
  const earned = balances.find((b) => b.type === 'EARNED');
  const earnedBalance = earned?.remaining || 0;
  const [pendingRows] = await query('SELECT COALESCE(SUM(days), 0) AS pending FROM leave_encashments WHERE employee_id=:employee AND status=\'PENDING\'', { employee: req.user.id });
  const pendingDays = Number(pendingRows[0]?.pending || 0);
  const maxEncashableDays = Math.max(0, Math.floor(earnedBalance - pendingDays));
  const isEligible = tenureMonths >= 12 && maxEncashableDays >= 1;
  res.json({
    isEligible,
    tenureMonths,
    earnedBalance,
    pendingDays,
    maxEncashableDays,
    minimumTenureMonths: 12
  });
}));

router.post('/encashment', leaveMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({
    days: z.number().int().min(1).max(30),
    reason: z.string().trim().max(1000).optional()
  }), req.body);

  const [emp] = await query('SELECT joined_on FROM employees WHERE id=:id LIMIT 1', { id: req.user.id });
  const tenureMonths = calculateTenureMonths(emp?.joined_on);
  if (tenureMonths < 12) {
    throw Object.assign(new Error('Leave encashment requires a minimum of 12 months continuous service at Falchion Xeniaa.'), { status: 400 });
  }

  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    const balances = await getLeaveBalances(req.user.id, connection);
    const earned = balances.find((b) => b.type === 'EARNED');
    const earnedBalance = earned?.remaining || 0;
    const [pendingRows] = await connection.execute('SELECT COALESCE(SUM(days), 0) AS pending FROM leave_encashments WHERE employee_id=:employee AND status=\'PENDING\' FOR UPDATE', { employee: req.user.id });
    const pendingDays = Number((pendingRows as any)[0]?.pending || 0);
    const available = Math.max(0, Math.floor(earnedBalance - pendingDays));

    if (input.days > available) {
      throw Object.assign(new Error(`Requested encashment of ${input.days} day(s) exceeds your available Earned Leave balance (${available} day(s) encashable).`), { status: 400 });
    }

    await connection.execute(
      `INSERT INTO leave_encashments (id, employee_id, days, reason, status)
       VALUES (:id, :employee, :days, :reason, 'PENDING')`,
      { id, employee: req.user.id, days: input.days, reason: input.reason || null }
    );
  });

  await audit({ actorId: req.user.id, action: 'LEAVE_ENCASHMENT_REQUESTED', entityType: 'leave_encashment', entityId: id, details: { days: input.days, reason: input.reason }, ipAddress: req.ip });
  await notifyAdmins('Leave encashment request', `${req.user.full_name} submitted an encashment request for ${input.days} day(s) of Earned Leave.`, 'REQUEST', { type: 'encashment', id });

  try {
    await dispatchWorkflowRequestEmails({
      requestId: id,
      requestType: 'encashment',
      employeeId: req.user.id,
      title: 'Earned Leave Encashment',
      summaryDetails: [
        { label: 'Encashment Days', value: `${input.days} EL day(s)` },
        { label: 'Accrual Category', value: 'Earned Leave (EL)' }
      ],
      reason: input.reason || null,
      portalRoute: '/leave'
    });
  } catch (err) {
    console.error(JSON.stringify({ type: 'encashment_email_enqueue_failed', request_id: id, error: String((err as any)?.message || err) }));
  }

  res.status(201).json({ ok: true, id, days: input.days });
}));

router.get('/encashments', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT id, days, reason, status, rejection_reason, reviewed_at, created_at
     FROM leave_encashments
     WHERE employee_id=:employee
     ORDER BY created_at DESC`,
    { employee: req.user.id }
  );
  res.json({ encashments: rows });
}));

router.get('/admin/encashments', asyncRoute(async (req, res) => {
  if (!isAdmin(req.user)) {
    throw Object.assign(new Error('Administrator access is required.'), { status: 403 });
  }
  const rows = await query(
    `SELECT e.id, e.employee_id, e.days, e.reason, e.status, e.rejection_reason, e.reviewed_at, e.created_at,
      emp.full_name, emp.employee_code, emp.email, emp.department
     FROM leave_encashments e
     JOIN employees emp ON emp.id=e.employee_id
     ORDER BY e.created_at DESC LIMIT 100`
  );
  res.json({ encashments: rows });
}));

router.post('/admin/encashments/:id/review', asyncRoute(async (req, res) => {
  if (!isAdmin(req.user)) {
    throw Object.assign(new Error('Administrator access is required.'), { status: 403 });
  }
  const input = validate(z.object({
    status: z.enum(['APPROVED','REJECTED']),
    rejection_reason: z.string().trim().max(1000).optional()
  }), req.body);

  const [encashment] = await query('SELECT id, employee_id, days, status FROM leave_encashments WHERE id=:id LIMIT 1', { id: req.params.id });
  if (!encashment) throw Object.assign(new Error('Encashment request not found.'), { status: 404 });
  if (encashment.status !== 'PENDING') throw Object.assign(new Error('Only pending encashments can be reviewed.'), { status: 409 });

  const today = indiaDate();
  await transaction(async (connection) => {
    await connection.execute(
      `UPDATE leave_encashments
       SET status=:status, reviewed_by=:admin, reviewed_at=UTC_TIMESTAMP(), rejection_reason=:reason
       WHERE id=:id`,
      { id: req.params.id, status: input.status, admin: req.user.id, reason: input.rejection_reason || null }
    );
    if (input.status === 'APPROVED') {
      const deductionId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, days, reason, status)
         VALUES (:id, :employee, 'EARNED', :today, :today, :days, 'Approved Earned Leave Encashment', 'APPROVED')`,
        { id: deductionId, employee: encashment.employee_id, today, days: encashment.days }
      );
    }
  });

  await audit({ actorId: req.user.id, action: `LEAVE_ENCASHMENT_${input.status}`, entityType: 'leave_encashment', entityId: req.params.id, details: { status: input.status, reason: input.rejection_reason }, ipAddress: req.ip });
  await notify(encashment.employee_id, `Leave encashment ${input.status.toLowerCase()}`, `Your request to encash ${encashment.days} day(s) of Earned Leave was ${input.status.toLowerCase()}.`, 'UPDATE', { type: 'encashment', id: req.params.id });

  try {
    await dispatchWorkflowStatusEmail({
      requestId: req.params.id,
      requestType: 'encashment',
      employeeId: encashment.employee_id,
      title: 'Earned Leave Encashment',
      decision: input.status,
      summaryDetails: [
        { label: 'Encashment Days', value: `${encashment.days} EL day(s)` }
      ],
      reviewerNote: input.rejection_reason || null,
      reviewerName: req.user.full_name,
      portalRoute: '/leave'
    });
  } catch (err) {
    console.error(JSON.stringify({ type: 'encashment_status_email_failed', request_id: req.params.id, error: String((err as any)?.message || err) }));
  }

  res.json({ ok: true });
}));

export default router;
