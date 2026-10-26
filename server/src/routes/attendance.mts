import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { requireAuth, audit, notifyAdmins, requirePeople } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { htmlEscape } from '../mailer.mts';
import { enqueueHrNotificationEmail } from '../email-outbox.mts';
import { dispatchWorkflowRequestEmails } from '../email-routing.mts';
import { attendanceStatus, distanceMeters, hasPassedAbsenceCutoff, indiaDate, indiaTime, isAttendanceAllowed, isOfficeNetworkIpAllowed, isScheduledWorkday, netWorkedMinutes, normalizeClientIp, parseOfficeNetworkIps, POLICY } from '../policy.mts';

const router = Router();
router.use(requireAuth, (req, res, next) => {
  if (req.user?.role === 'ADMIN' && req.user?.user_type === 'ADMIN') return next();
  return requirePeople(req, res, next);
});
const attendanceMutationLimiter = rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});

function officeNetworkConfig() {
  const configured = String(process.env.OFFICE_NETWORK_IPS || (process.env.NODE_ENV === 'development' ? '127.0.0.1;::1' : '')).trim();
  return { configured, allowed: parseOfficeNetworkIps(configured) };
}

async function emailAdminRequest({ id, title, description, type, details, employee, employeeId }: any) {
  try {
    const summaryDetails = details.map((item: string) => {
      const parts = String(item).split(': ');
      return { label: parts.shift() || 'Detail', value: parts.join(': ') };
    });
    const delivery = await dispatchWorkflowRequestEmails({
      requestId: id,
      requestType: type as any,
      employeeId: employeeId || employee.id,
      title,
      summaryDetails,
      portalRoute: '/attendance'
    });
    return {
      configured: true,
      sent: 0,
      queued: Boolean(delivery.managerEmail?.queued || delivery.confirmationEmail?.queued),
      status: delivery.managerEmail?.status || 'QUEUED',
      outboxId: delivery.managerEmail?.id || delivery.confirmationEmail?.id || null,
      recipients: (delivery.managerEmail?.recipientCount || 0) + (delivery.confirmationEmail?.recipientCount || 0),
      type
    };
  } catch (error) {
    console.error(JSON.stringify({ type: 'admin_request_email_enqueue_failed', request_id: id, request_type: type, error: String((error as any)?.message || error) }));
    return { configured: false, sent: 0, queued: false, status: 'ENQUEUE_FAILED', outboxId: null, recipients: 0, type };
  }
}

function verifyOfficeNetwork(req) {
  const { configured, allowed } = officeNetworkConfig();
  if (!configured || allowed.length === 0) throw Object.assign(new Error('Office network verification is not configured. Ask an administrator to complete the office network setup.'), { status: 503 });
  const clientIp = normalizeClientIp(req.ip);
  if (!isOfficeNetworkIpAllowed(clientIp, configured)) throw Object.assign(new Error('This connection’s public IP is not on the approved office-network list. If you are already on Falchion Xeniaa office Wi-Fi, ask an administrator to verify the production OFFICE_NETWORK_IPS allow-list.'), { status: 403 });
  return clientIp;
}

async function getSettings() {
  const rows = await query('SELECT setting_key, setting_value FROM system_settings');
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
}
router.get('/', asyncRoute(async (req, res) => {
  const date = String(req.query.from || indiaDate());
  const to = String(req.query.to || date);
  if (!dateSchema.safeParse(date).success || !dateSchema.safeParse(to).success || date>to || (new Date(`${to}T12:00:00Z`).getTime()-new Date(`${date}T12:00:00Z`).getTime())/86400000>366) throw Object.assign(new Error('Choose a valid date range of no more than one year.'),{status:400});
  const [rows, leaves, remoteDays, holidays, person, scheduleExceptions] = await Promise.all([
    query(`SELECT id, attendance_date, check_in_at, check_out_at, check_in_method, check_out_method, status, approved_start_time, correction_pending
    FROM attendance_records WHERE employee_id=:employee AND attendance_date BETWEEN :from AND :to ORDER BY attendance_date DESC`, {
    employee: req.user.id, from: date, to
    }),
    query(`SELECT DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date FROM leave_requests WHERE employee_id=:employee AND status='APPROVED' AND start_date<=:to AND end_date>=:from`,{employee:req.user.id,from:date,to}),
    query(`SELECT DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date FROM wfh_requests WHERE employee_id=:employee AND status='APPROVED' AND request_date BETWEEN :from AND :to`,{employee:req.user.id,from:date,to}),
    query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :from AND :to`,{from:date,to}),
    query(`SELECT DATE_FORMAT(joined_on,'%Y-%m-%d') AS joined_on FROM employees WHERE id=:employee`,{employee:req.user.id}),
    query(`SELECT DATE_FORMAT(exception_date,'%Y-%m-%d') AS exception_date,TIME_FORMAT(approved_start_time,'%H:%i') AS approved_start_time FROM employee_schedule_exceptions WHERE employee_id=:employee AND exception_date BETWEEN :from AND :to`,{employee:req.user.id,from:date,to})
  ]);
  const holidaySet=new Set(holidays.map((x)=>x.date));
  for(let year=Number(date.slice(0,4));year<=Number(to.slice(0,4));year++)for(const [month,day] of [[1,26],[8,15],[10,2]])holidaySet.add(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const display=[...rows];const existing=new Set(rows.map((x)=>String(x.attendance_date).slice(0,10)));const today=indiaDate();const currentTime=indiaTime().slice(0,5);
  const approvedStartByDate=new Map(scheduleExceptions.map((x)=>[x.exception_date,x.approved_start_time]));
  for(let d=new Date(`${date}T12:00:00Z`),end=new Date(`${to}T12:00:00Z`);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10);if(day>today||holidaySet.has(day)||day<(person[0]?.joined_on||'' )||existing.has(day))continue;
    const onLeave=leaves.some((x)=>x.start_date<=day&&x.end_date>=day);const wfh=remoteDays.some((x)=>x.request_date===day);
    const scheduledStart=approvedStartByDate.get(day)||POLICY.standardStart;
    const absent=day<today||hasPassedAbsenceCutoff(String(currentTime),String(scheduledStart));const status=onLeave?'ON_LEAVE':wfh?'WFH':absent?'ABSENT':null;
    if(status)display.push({id:`${req.user.id}-${day}`,attendance_date:day,check_in_at:null,check_out_at:null,check_in_method:status==='WFH'?'WFH':null,check_out_method:null,status,approved_start_time:null,correction_pending:false});
  }
  const lunchRows = await query('SELECT setting_value FROM system_settings WHERE setting_key=\'fixed_lunch_minutes\'');
  const lunch = Number(lunchRows[0]?.setting_value || POLICY.fixedLunchMinutes);
  res.json({ records: display.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))).map((r) => {
    return { ...r, worked_minutes: r.check_in_at && r.check_out_at ? netWorkedMinutes(r.check_in_at,r.check_out_at,lunch) : null, lunch_minutes: lunch };
  }) });
}));

router.post('/check-in', attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const schema = z.object({
    method: z.enum(['GPS','WIFI','WFH']),
    workLocation: z.enum(['OFFICE']).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).optional(),
  });
  const input = validate(schema, req.body);
  const date = indiaDate();
  const dateHolidays=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date AND holiday_kind='FIXED'`,{date});
  if(!isAttendanceAllowed(date,new Set(dateHolidays.map((x)=>x.date)))) throw Object.assign(new Error('Attendance check-in is unavailable on fixed holidays.'),{status:403});
  const settings = await getSettings();
  // The approved employee/date WFH request is the source of truth. A stale
  // browser build may still submit method=GPS; do not make WFH staff depend on
  // the browser correctly inferring the approved mode before checking in.
  const approvedWfhToday = await query(
    `SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status='APPROVED' LIMIT 1`,
    { employee: req.user.id, date }
  );
  // WFH access is an explicit administrator permission. Promote stale clients that still submit GPS
  // to the remote path before any GPS/IP verification, unless the employee chose the office path.
  const wfhEnabled = req.user.wfh_enabled === true || Number(req.user.wfh_enabled) === 1;
  let method = input.workLocation !== 'OFFICE' && (approvedWfhToday[0] || wfhEnabled) ? 'WFH' : input.method;
  let distance = null;
  let locationAccuracy = null;
  if (method === 'GPS') {
    const gpsProvided = input.latitude !== undefined && input.longitude !== undefined && input.accuracy !== undefined;
    if (gpsProvided && input.accuracy <= Number(settings.gps_max_accuracy_meters || POLICY.gpsMaxAccuracyMeters)) {
      distance = distanceMeters(input.latitude, input.longitude, Number(settings.office_latitude || POLICY.latitude), Number(settings.office_longitude || POLICY.longitude));
      if (distance <= Number(settings.geofence_meters || POLICY.geofenceMeters)) {
        // Browser coordinates are client-controlled. Corroborate the geofence
        // with the server-observed approved office egress IP before accepting GPS.
        verifyOfficeNetwork(req);
        method = 'GPS';
        locationAccuracy = input.accuracy;
      } else {
        try { verifyOfficeNetwork(req); method = 'WIFI'; distance = null; }
        catch { throw Object.assign(new Error(`You are about ${Math.round(distance)} m from the office, outside the ${settings.geofence_meters || POLICY.geofenceMeters} m radius. Connect to the approved office Wi-Fi or check in from inside the office.`), { status: 422 }); }
      }
    } else {
      // Laptop location can be inaccurate or unavailable. Do not block staff if
      // their public IP is on the administrator-approved office network list.
      try { verifyOfficeNetwork(req); method = 'WIFI'; distance = null; }
      catch {
        if (!gpsProvided) throw Object.assign(new Error('Location could not be verified. Allow browser location or connect to the approved office Wi-Fi, then retry.'), { status: 422 });
        throw Object.assign(new Error('GPS accuracy is too low and this network is not on the approved office Wi-Fi list. Connect to office Wi-Fi or retry location access.'), { status: 422 });
      }
    }
  }
  if (method === 'WIFI') verifyOfficeNetwork(req);
  if (method === 'WFH' && !wfhEnabled && !approvedWfhToday[0]) {
    throw Object.assign(new Error('WFH access is not enabled for this employee. Ask an administrator to enable WFH before checking in remotely.'), { status: 403 });
  }
  const approved = await query(`SELECT approved_start_time FROM employee_schedule_exceptions WHERE employee_id=:employee AND exception_date=:date LIMIT 1`, { employee: req.user.id, date });
  const approvedStart = approved[0]?.approved_start_time || null;
  const status = attendanceStatus(new Date(), approvedStart, String(settings.late_threshold || POLICY.lateThreshold));
  const id = crypto.randomUUID();
  let previousOpenShifts: Array<{id:string; attendance_date:string}> = [];
  await transaction(async (connection) => {
    // Serialize check-in against leave/WFH request creation and approval.
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', { employee:req.user.id });
    const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1 FOR UPDATE`, { employee:req.user.id, date });
    if (leaveConflict[0]) throw Object.assign(new Error('You have a pending or approved leave request for today. Resolve it with HR before recording attendance.'), { status:409 });
    const [existing] = await connection.execute('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE', { employee: req.user.id, date });
    if (existing[0]) throw Object.assign(new Error('Today’s attendance is already started.'), { status: 409 });

    // Historical missing checkouts are HR exceptions, not a reason to deny a
    // new date's attendance. Lock and preserve previous rows without modifying them.
    const [previousOpen] = await connection.execute(
      "SELECT id, DATE_FORMAT(attendance_date,'%Y-%m-%d') AS attendance_date FROM attendance_records WHERE employee_id=:employee AND attendance_date<:date AND check_out_at IS NULL ORDER BY attendance_date DESC FOR UPDATE",
      { employee:req.user.id, date }
    );
    previousOpenShifts = previousOpen.map((row:any) => ({
      id:String(row.id),
      attendance_date:String(row.attendance_date).slice(0,10)
    }));

    await connection.execute(`INSERT INTO attendance_records (id, employee_id, attendance_date, check_in_at, check_in_method, check_in_latitude, check_in_longitude, check_in_accuracy_m, check_in_distance_m, status, approved_start_time)
      VALUES (:id, :employee, :date, UTC_TIMESTAMP(), :method, :lat, :lon, :accuracy, :distance, :status, :approvedStart)`, {
      id, employee: req.user.id, date, method, lat: method === 'GPS' ? input.latitude : null, lon: method === 'GPS' ? input.longitude : null,
      accuracy: method === 'GPS' ? locationAccuracy : null, distance: method === 'GPS' ? distance : null, status, approvedStart
    });

    // Keep the attendance row and audit event atomic so a post-commit audit
    // error cannot make a saved check-in look like a failed request.
    await connection.execute(`INSERT INTO audit_logs
      (id, actor_id, action, entity_type, entity_id, details_json, ip_address, created_at)
      VALUES (:logId, :actorId, 'ATTENDANCE_CHECK_IN', 'attendance', :attendanceId, :details, :ipAddress, UTC_TIMESTAMP())`, {
      logId:crypto.randomUUID(),
      actorId:req.user.id,
      attendanceId:id,
      details:JSON.stringify({
        method,
        date,
        distance_m:distance===null?null:Math.round(distance),
        prior_open_shift_count:previousOpenShifts.length,
        prior_open_shifts:previousOpenShifts
      }),
      ipAddress:req.ip
    });
  });
  let hrNotified = false;
  if (previousOpenShifts.length) {
    try {
      await notifyAdmins(
        'Historical attendance shift needs review',
        req.user.full_name + ' (' + req.user.employee_code + ') recorded attendance for ' + date +
          ' while ' + previousOpenShifts.length + ' earlier attendance shift(s) remain open. Review the private attendance record and supporting evidence; do not infer checkout times.',
        'UPDATE',
        {
          type:'attendance_open_shift_review',
          employeeId:req.user.id,
          currentAttendanceId:id,
          priorOpenShifts:previousOpenShifts
        }
      );
      hrNotified = true;
    } catch (error) {
      // A notification outage must not turn a committed punch into an apparent
      // failure. The atomic attendance audit event retains the review evidence.
      console.error(JSON.stringify({
        type:'attendance_prior_open_shift_notification_failed',
        employeeId:req.user.id,
        currentAttendanceId:id,
        count:previousOpenShifts.length,
        error:String(error?.message || error)
      }));
    }
  }
  const warning = previousOpenShifts.length ? {
    code:'PRIOR_OPEN_SHIFT_REQUIRES_REVIEW',
    count:previousOpenShifts.length,
    hrNotified,
    message:'Today’s attendance was recorded. One or more earlier attendance records remain open and require HR review; their timestamps were not changed.'
  } : undefined;
  res.status(201).json({ ok:true, status, method, attendanceId:id, ...(warning ? {warning} : {}) });
}));

router.post('/check-out', attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ method: z.enum(['GPS','WIFI','WFH','OFF_PREMISES']).default('GPS'), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).optional() }), req.body || {});
  const today = indiaDate();
  const settings = await getSettings();
  // Find the most recent open shift, not only a row dated today. This allows
  // employees to close a legitimate overnight shift after midnight.
  const priorAttendance = await query(
    `SELECT id,DATE_FORMAT(attendance_date,'%Y-%m-%d') AS attendance_date,check_in_method,check_out_at FROM attendance_records WHERE employee_id=:employee AND attendance_date<=:today AND check_out_at IS NULL ORDER BY attendance_date DESC LIMIT 1`,
    { employee:req.user.id, today }
  );
  let method = priorAttendance[0]?.check_in_method === 'WFH' ? 'WFH' : input.method;
  let distance = null;
  if (method === 'GPS') {
    const gpsProvided = input.latitude !== undefined && input.longitude !== undefined && input.accuracy !== undefined;
    let gpsVerified = false;
    if (gpsProvided && input.accuracy <= Number(settings.gps_max_accuracy_meters || POLICY.gpsMaxAccuracyMeters)) {
      distance = distanceMeters(input.latitude, input.longitude, Number(settings.office_latitude || POLICY.latitude), Number(settings.office_longitude || POLICY.longitude));
      gpsVerified = distance <= Number(settings.geofence_meters || POLICY.geofenceMeters);
    }
    if (!gpsVerified) {
      try { verifyOfficeNetwork(req); method = 'WIFI'; distance = null; }
      catch {
        // Check-out closes an existing shift; unlike check-in, it must not
        // require the employee to still be inside the office geofence.
        method = 'OFF_PREMISES';
        distance = null;
      }
    }
  } else if (method === 'WIFI') {
    verifyOfficeNetwork(req);
  }
  let result;
  await transaction(async (connection) => {
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE',{employee:req.user.id});
    const [rows] = await connection.execute(`SELECT id,attendance_date,check_in_at,check_in_method,check_out_at,TIMESTAMPDIFF(MINUTE,check_in_at,UTC_TIMESTAMP()) AS elapsed_minutes FROM attendance_records WHERE employee_id=:employee AND attendance_date<=:today AND check_out_at IS NULL ORDER BY attendance_date DESC LIMIT 1 FOR UPDATE`, { employee:req.user.id, today });
    if (!rows[0]) throw Object.assign(new Error('No open attendance shift was found. Check in first or contact HR if a previous shift needs correction.'), { status:409 });
    if (method === 'WFH' && rows[0].check_in_method !== 'WFH') throw Object.assign(new Error('WFH check-out is available only for an approved WFH attendance record.'), { status:403 });
    const elapsedMinutes = Math.max(0, Number(rows[0].elapsed_minutes || 0));
    const configuredLunch = Number(settings.fixed_lunch_minutes);
    const lunchMinutes = Number.isFinite(configuredLunch) && configuredLunch >= 0 ? configuredLunch : POLICY.fixedLunchMinutes;
    const workedMinutes = Math.max(0, elapsedMinutes - lunchMinutes);
    // Flag only shifts shorter than the configured lunch deduction; this avoids inventing a new minimum-shift policy.
    const shortShiftReviewRequired = elapsedMinutes < lunchMinutes;
    const [bpass]: any = await connection.execute(
      `SELECT id, status FROM birthday_passes WHERE employee_id=:employee AND pass_date=:today LIMIT 1 FOR UPDATE`,
      { employee: req.user.id, today }
    );
    const birthdayPassApplied = Boolean(bpass[0]);
    if (bpass[0] && bpass[0].status === 'AVAILABLE') {
      await connection.execute(`UPDATE birthday_passes SET status='CLAIMED', claimed_at=UTC_TIMESTAMP() WHERE id=:id`, { id: bpass[0].id });
    }
    await connection.execute(`UPDATE attendance_records SET check_out_at=UTC_TIMESTAMP(), check_out_method=:method, check_out_latitude=:lat, check_out_longitude=:lon, check_out_accuracy_m=:accuracy WHERE id=:id`, {
      id:rows[0].id, method, lat:method==='GPS'?input.latitude:null, lon:method==='GPS'?input.longitude:null, accuracy:method==='GPS'?input.accuracy:null
    });
    const details = {
      method,date:String(rows[0].attendance_date).slice(0,10),
      distance_m:distance===null?null:Math.round(distance),
      elapsed_minutes:elapsedMinutes,worked_minutes:workedMinutes,lunch_minutes:lunchMinutes,
      short_shift_review_required:shortShiftReviewRequired,
      birthday_pass_applied:birthdayPassApplied
    };
    await connection.execute(`INSERT INTO audit_logs
      (id,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at)
      VALUES (:logId,:actorId,'ATTENDANCE_CHECK_OUT','attendance',:attendanceId,:details,:ipAddress,UTC_TIMESTAMP())`, {
      logId:crypto.randomUUID(),actorId:req.user.id,attendanceId:rows[0].id,
      details:JSON.stringify(details),ipAddress:req.ip
    });
    result = {id:rows[0].id,method,date:String(rows[0].attendance_date).slice(0,10),elapsedMinutes,workedMinutes,shortShiftReviewRequired,birthdayPassApplied};
  });
  if (result.shortShiftReviewRequired) {
    try {
      await notifyAdmins('Short attendance shift requires review',
        req.user.full_name+' ('+req.user.employee_code+') checked out after '+result.elapsedMinutes+' minute(s) on '+result.date+'. Timestamps are preserved; net time follows the lunch-deduction rule.',
        'UPDATE',{type:'short_attendance_shift',attendanceId:result.id,date:result.date,elapsedMinutes:result.elapsedMinutes,workedMinutes:result.workedMinutes});
    } catch (error) {
      console.warn(JSON.stringify({type:'short_shift_review_notification_failed',attendance_id:result.id,error:String(error?.message||error)}));
    }
  }
  res.json({ok:true,method:result.method,elapsedMinutes:result.elapsedMinutes,workedMinutes:result.workedMinutes,shortShiftReviewRequired:result.shortShiftReviewRequired});

}));

router.post('/corrections', requirePeople, attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, requestedCheckIn: z.string().datetime().optional(), requestedCheckOut: z.string().datetime().optional(), reason: z.string().trim().min(8).max(1000) }).refine((v) => v.requestedCheckIn || v.requestedCheckOut, 'Add the missing check-in or check-out time.'), req.body);
  if (input.date > indiaDate()) throw Object.assign(new Error('Choose today or an earlier date for an attendance correction.'), { status: 400 });
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    // Lock the employee row to serialize simultaneous correction submissions
    // even when no attendance row exists yet for the requested date.
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', { employee:req.user.id });
    const [pending] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1 FOR UPDATE`, { employee:req.user.id, date:input.date });
    if (pending[0]) throw Object.assign(new Error('A pending attendance correction already exists for this date.'), { status:409 });
    const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, {employee:req.user.id,date:input.date});
    if (leaveConflict[0]) throw Object.assign(new Error('A pending or approved leave request covers this date. Resolve it before submitting an attendance correction.'), {status:409});
    const [locked] = await connection.execute('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE', { employee:req.user.id, date:input.date });
    const attendanceId = locked[0]?.id || null;
    await connection.execute(`INSERT INTO attendance_correction_requests (id, employee_id, attendance_id, attendance_date, requested_check_in_at, requested_check_out_at, reason)
      VALUES (:id, :employee, :attendance, :date, :checkIn, :checkOut, :reason)`, {
      id, employee: req.user.id, attendance: attendanceId, date: input.date,
      checkIn: input.requestedCheckIn ? new Date(input.requestedCheckIn) : null,
      checkOut: input.requestedCheckOut ? new Date(input.requestedCheckOut) : null, reason: input.reason
    });
    if (attendanceId) await connection.execute('UPDATE attendance_records SET correction_pending=TRUE WHERE id=:id', { id:attendanceId });
  });
  await audit({ actorId: req.user.id, action: 'ATTENDANCE_CORRECTION_REQUESTED', entityType: 'attendance_correction', entityId: id, details: { date: input.date }, ipAddress: req.ip });
  await notifyAdmins('Attendance correction needs review', `${req.user.full_name} requested an attendance correction for ${input.date}.`, 'REQUEST', { type:'correction', id });
  const emailDelivery = await emailAdminRequest({
    id,
    title:'Attendance correction request',
    description:'A new attendance correction request has been submitted for administrator review.',
    type:'correction',
    details:['Date: ' + input.date, 'Requested check-in: ' + (input.requestedCheckIn || 'Not provided'), 'Requested check-out: ' + (input.requestedCheckOut || 'Not provided'), 'Reason: ' + input.reason],
    employee:{name:req.user.full_name,code:req.user.employee_code,email:req.user.email,id:req.user.id},
    employeeId: req.user.id
  });
  res.status(201).json({ ok: true, id, emailDelivery });
}));

router.post('/flex-requests', requirePeople, attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), reason: z.string().trim().min(8).max(1000) }), req.body);
  if (input.startTime < '09:00' || input.startTime > '10:30') throw Object.assign(new Error('A flex start must be between 9:00 AM and 10:30 AM.'), { status: 400 });
  if (input.date < indiaDate()) throw Object.assign(new Error('Choose today or a future date.'), { status: 400 });
  const holidays=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date AND holiday_kind='FIXED'`,{date:input.date});
  if(!isScheduledWorkday(input.date,new Set(holidays.map((x)=>x.date)))) throw Object.assign(new Error('Choose a scheduled workday for your flex-start request.'),{status:400});
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', {employee:req.user.id});
    const [leaveConflict] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, {employee:req.user.id,date:input.date});
    if (leaveConflict[0]) throw Object.assign(new Error('A flex-start request cannot overlap pending or approved leave.'), {status:409});
    const [wfhConflict] = await connection.execute(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1`, {employee:req.user.id,date:input.date});
    if (wfhConflict[0]) throw Object.assign(new Error('A flex-start request cannot overlap pending or approved WFH.'), {status:409});
    const [attendanceConflict] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1`, {employee:req.user.id,date:input.date});
    if (attendanceConflict[0]) throw Object.assign(new Error('Attendance is already recorded for this date; a flex-start request cannot change it retroactively.'), {status:409});
    const [correctionConflict] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1`, {employee:req.user.id,date:input.date});
    if (correctionConflict[0]) throw Object.assign(new Error('A pending attendance correction already exists for this date. Resolve it before requesting a flex start.'), {status:409});
    const [existing] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1 FOR UPDATE`, { employee:req.user.id, date:input.date });
    if (existing[0]) throw Object.assign(new Error('You already have a pending or approved flex-start request for this date.'), { status:409 });
    await connection.execute(`INSERT INTO flex_start_requests (id, employee_id, request_date, requested_start_time, reason) VALUES (:id, :employee, :date, :time, :reason)`, {
      id, employee: req.user.id, date: input.date, time: input.startTime, reason: input.reason
    });
  });
  await audit({ actorId: req.user.id, action: 'FLEX_START_REQUESTED', entityType: 'flex_start_request', entityId: id, details: { date: input.date, start_time: input.startTime }, ipAddress: req.ip });
  await notifyAdmins('Flexible start needs review', `${req.user.full_name} requested a ${input.startTime} start on ${input.date}.`, 'REQUEST', { type:'flex', id });
  const emailDelivery = await emailAdminRequest({
    id,
    title:'Flexible start request',
    description:'A new flexible-start request has been submitted for administrator review.',
    type:'flex',
    details:['Date: ' + input.date, 'Requested start: ' + input.startTime, 'Reason: ' + input.reason],
    employee:{name:req.user.full_name,code:req.user.employee_code,email:req.user.email,id:req.user.id},
    employeeId: req.user.id
  });
  res.status(201).json({ ok: true, id, emailDelivery });
}));

router.get('/exits/current', requirePeople, asyncRoute(async (req, res) => {
  const rows = await query(`SELECT x.id, x.left_at, x.reason FROM temporary_exits x JOIN attendance_records a ON a.id=x.attendance_id WHERE x.employee_id=:employee AND x.returned_at IS NULL AND a.attendance_date=:date ORDER BY x.left_at DESC LIMIT 1`, { employee: req.user.id, date: indiaDate() });
  res.json({ exit: rows[0] || null });
}));
router.post('/exits', requirePeople, asyncRoute(async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().trim().max(500).optional() }), req.body || {});
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    const [active] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date AND check_out_at IS NULL FOR UPDATE`, { employee:req.user.id, date:indiaDate() });
    if (!active[0]) throw Object.assign(new Error('Start attendance before recording a temporary exit.'), { status:409 });
    const [open] = await connection.execute(`SELECT id FROM temporary_exits WHERE employee_id=:employee AND attendance_id=:attendance AND returned_at IS NULL FOR UPDATE`, { employee:req.user.id, attendance:active[0].id });
    if (open[0]) throw Object.assign(new Error('You already have an open temporary-exit record.'), { status:409 });
    await connection.execute(`INSERT INTO temporary_exits (id, employee_id, attendance_id, left_at, reason) VALUES (:id, :employee, :attendance, UTC_TIMESTAMP(), :reason)`, { id, employee:req.user.id, attendance:active[0].id, reason:reason || null });
  });
  await audit({ actorId: req.user.id, action: 'TEMPORARY_EXIT_STARTED', entityType: 'temporary_exit', entityId: id, ipAddress: req.ip });
  res.status(201).json({ ok: true, id });
}));
router.patch('/exits/:id/return', requirePeople, asyncRoute(async (req, res) => {
  const rows = await transaction(async (connection) => {
    const [locked] = await connection.execute('SELECT id, returned_at FROM temporary_exits WHERE id=:id AND employee_id=:employee FOR UPDATE', { id:req.params.id, employee:req.user.id });
    if (!locked[0] || locked[0].returned_at) throw Object.assign(new Error('This exit record is already closed or was not found.'), { status:404 });
    const [result] = await connection.execute('UPDATE temporary_exits SET returned_at=UTC_TIMESTAMP() WHERE id=:id AND employee_id=:employee AND returned_at IS NULL', { id:req.params.id, employee:req.user.id });
    return result;
  });
  if (!rows.affectedRows) throw Object.assign(new Error('This exit record is already closed or was not found.'), { status:404 });
  await audit({ actorId: req.user.id, action: 'TEMPORARY_EXIT_RETURNED', entityType: 'temporary_exit', entityId: req.params.id, ipAddress: req.ip });
  res.json({ ok: true });
}));

export default router;
