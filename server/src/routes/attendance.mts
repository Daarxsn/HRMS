import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { requireAuth, audit, notifyAdmins, requirePeople } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { attendanceStatus, distanceMeters, indiaDate, indiaTime, isOfficeNetworkIpAllowed, isScheduledWorkday, netWorkedMinutes, normalizeClientIp, parseOfficeNetworkIps, POLICY } from '../policy.mts';

const router = Router();
router.use(requireAuth, requirePeople);
const attendanceMutationLimiter = rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});

function officeNetworkConfig() {
  const configured = String(process.env.OFFICE_NETWORK_IPS || (process.env.NODE_ENV === 'development' ? '127.0.0.1;::1' : '')).trim();
  return { configured, allowed: parseOfficeNetworkIps(configured) };
}
function verifyOfficeNetwork(req) {
  const { configured, allowed } = officeNetworkConfig();
  if (!configured || allowed.length === 0) throw Object.assign(new Error('Office network verification is not configured. Ask an administrator to complete the office network setup.'), { status: 503 });
  const clientIp = normalizeClientIp(req.ip);
  if (!isOfficeNetworkIpAllowed(clientIp, configured)) throw Object.assign(new Error('Connect to the Falchion Xeniaa office Wi-Fi and try again.'), { status: 403 });
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
  const [rows, leaves, remoteDays, holidays, person] = await Promise.all([
    query(`SELECT id, attendance_date, check_in_at, check_out_at, check_in_method, check_out_method, status, approved_start_time, correction_pending
    FROM attendance_records WHERE employee_id=:employee AND attendance_date BETWEEN :from AND :to ORDER BY attendance_date DESC`, {
    employee: req.user.id, from: date, to
    }),
    query(`SELECT DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date FROM leave_requests WHERE employee_id=:employee AND status='APPROVED' AND start_date<=:to AND end_date>=:from`,{employee:req.user.id,from:date,to}),
    query(`SELECT DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date FROM wfh_requests WHERE employee_id=:employee AND status='APPROVED' AND request_date BETWEEN :from AND :to`,{employee:req.user.id,from:date,to}),
    query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date BETWEEN :from AND :to`,{from:date,to}),
    query(`SELECT DATE_FORMAT(joined_on,'%Y-%m-%d') AS joined_on FROM employees WHERE id=:employee`,{employee:req.user.id})
  ]);
  const holidaySet=new Set(holidays.map((x)=>x.date));
  for(let year=Number(date.slice(0,4));year<=Number(to.slice(0,4));year++)for(const [month,day] of [[1,26],[8,15],[10,2]])holidaySet.add(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const display=[...rows];const existing=new Set(rows.map((x)=>x.attendance_date));const today=indiaDate();const currentTime=indiaTime().slice(0,5);
  for(let d=new Date(`${date}T12:00:00Z`),end=new Date(`${to}T12:00:00Z`);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10);if(day>today||d.getUTCDay()===0||holidaySet.has(day)||day<(person[0]?.joined_on||'' )||existing.has(day))continue;
    const onLeave=leaves.some((x)=>x.start_date<=day&&x.end_date>=day);const wfh=remoteDays.some((x)=>x.request_date===day);
    const absent=day<today||currentTime>'10:30';const status=onLeave?'ON_LEAVE':wfh?'WFH':absent?'ABSENT':null;
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
    method: z.enum(['GPS','WFH']),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).optional(),
  });
  const input = validate(schema, req.body);
  const date = indiaDate();
  const dateHolidays=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date`,{date});
  if(!isScheduledWorkday(date,new Set(dateHolidays.map((x)=>x.date)))) throw Object.assign(new Error('Attendance check-in is available Monday–Saturday, excluding company holidays.'),{status:403});
  const settings = await getSettings();
  let method = input.method;
  let distance = null;
  if (method === 'GPS') {
    if (input.latitude === undefined || input.longitude === undefined || input.accuracy === undefined) throw Object.assign(new Error('Allow location access and try again.'), { status: 400 });
    if (input.accuracy > Number(settings.gps_max_accuracy_meters || POLICY.gpsMaxAccuracyMeters)) throw Object.assign(new Error('Location accuracy is too low. Move to an open area and try again.'), { status: 422 });
    distance = distanceMeters(input.latitude, input.longitude, Number(settings.office_latitude || POLICY.latitude), Number(settings.office_longitude || POLICY.longitude));
    if (distance > Number(settings.geofence_meters || POLICY.geofenceMeters)) throw Object.assign(new Error(`You are about ${Math.round(distance)} m from the office, outside the ${settings.geofence_meters || POLICY.geofenceMeters} m check-in radius.`), { status: 422 });
    verifyOfficeNetwork(req);
  }
  if (method === 'WFH') {
    if (!req.user.wfh_enabled) throw Object.assign(new Error('WFH is not enabled for this employee. Request approval or contact an administrator.'), { status: 403 });
    const approved = await query(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status='APPROVED' LIMIT 1`, { employee: req.user.id, date });
    if (!approved[0]) throw Object.assign(new Error('An approved WFH request is required for today.'), { status: 403 });
  }
  const approved = await query(`SELECT approved_start_time FROM employee_schedule_exceptions WHERE employee_id=:employee AND exception_date=:date LIMIT 1`, { employee: req.user.id, date });
  const approvedStart = approved[0]?.approved_start_time || null;
  const status = attendanceStatus(new Date(), approvedStart, String(settings.late_threshold || POLICY.lateThreshold));
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    const [existing] = await connection.execute('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE', { employee: req.user.id, date });
    if (existing[0]) throw Object.assign(new Error('Today’s attendance is already started.'), { status: 409 });
    await connection.execute(`INSERT INTO attendance_records (id, employee_id, attendance_date, check_in_at, check_in_method, check_in_latitude, check_in_longitude, check_in_accuracy_m, check_in_distance_m, status, approved_start_time)
      VALUES (:id, :employee, :date, UTC_TIMESTAMP(), :method, :lat, :lon, :accuracy, :distance, :status, :approvedStart)`, {
      id, employee: req.user.id, date, method, lat: method === 'GPS' ? input.latitude : null, lon: method === 'GPS' ? input.longitude : null,
      accuracy: method === 'GPS' ? input.accuracy : null, distance: method === 'GPS' ? distance : null, status, approvedStart
    });
  });
  await audit({ actorId: req.user.id, action: 'ATTENDANCE_CHECK_IN', entityType: 'attendance', entityId: id, details: { method, date, distance_m: distance === null ? null : Math.round(distance) }, ipAddress: req.ip });
  res.status(201).json({ ok: true, status, method, attendanceId: id });
}));

router.post('/check-out', attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ method: z.enum(['GPS','WFH']).default('GPS'), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).optional() }), req.body || {});
  const date = indiaDate();
  const settings = await getSettings();
  let distance = null;
  if (input.method === 'GPS') {
    if (input.latitude === undefined || input.longitude === undefined || input.accuracy === undefined) throw Object.assign(new Error('Allow location access and try again.'), { status: 400 });
    if (input.accuracy > Number(settings.gps_max_accuracy_meters || POLICY.gpsMaxAccuracyMeters)) throw Object.assign(new Error('Location accuracy is too low. Move to an open area and try again.'), { status: 422 });
    distance = distanceMeters(input.latitude, input.longitude, Number(settings.office_latitude || POLICY.latitude), Number(settings.office_longitude || POLICY.longitude));
    if (distance > Number(settings.geofence_meters || POLICY.geofenceMeters)) throw Object.assign(new Error('You are outside the office radius.'), { status: 422 });
    verifyOfficeNetwork(req);
  }
  let result;
  await transaction(async (connection) => {
    const [rows] = await connection.execute(`SELECT id, check_in_method, check_out_at FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date FOR UPDATE`, { employee: req.user.id, date });
    if (!rows[0]) throw Object.assign(new Error('Check in first to finish today’s attendance.'), { status: 409 });
    if (rows[0].check_out_at) throw Object.assign(new Error('You have already checked out today.'), { status: 409 });
    if (input.method === 'WFH' && rows[0].check_in_method !== 'WFH') throw Object.assign(new Error('WFH check-out is available only for an approved WFH attendance record.'), { status: 403 });
    const method = input.method;
    await connection.execute(`UPDATE attendance_records SET check_out_at=UTC_TIMESTAMP(), check_out_method=:method, check_out_latitude=:lat, check_out_longitude=:lon, check_out_accuracy_m=:accuracy WHERE id=:id`, {
      id: rows[0].id, method, lat: input.method === 'GPS' ? input.latitude : null, lon: input.method === 'GPS' ? input.longitude : null, accuracy: input.method === 'GPS' ? input.accuracy : null
    });
    result = { id: rows[0].id, method };
  });
  await audit({ actorId: req.user.id, action: 'ATTENDANCE_CHECK_OUT', entityType: 'attendance', entityId: result.id, details: { method: result.method, date, distance_m: distance === null ? null : Math.round(distance) }, ipAddress: req.ip });
  res.json({ ok: true, method: result.method });
}));

router.post('/corrections', attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, requestedCheckIn: z.string().datetime().optional(), requestedCheckOut: z.string().datetime().optional(), reason: z.string().trim().min(8).max(1000) }).refine((v) => v.requestedCheckIn || v.requestedCheckOut, 'Add the missing check-in or check-out time.'), req.body);
  if (input.date > indiaDate()) throw Object.assign(new Error('Choose today or an earlier date for an attendance correction.'), { status: 400 });
  const matching = await query('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1', { employee: req.user.id, date: input.date });
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
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
  res.status(201).json({ ok: true, id });
}));

router.post('/flex-requests', attendanceMutationLimiter, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), reason: z.string().trim().min(8).max(1000) }), req.body);
  if (input.startTime < '09:00' || input.startTime > '10:30') throw Object.assign(new Error('A flex start must be between 9:00 AM and 10:30 AM.'), { status: 400 });
  if (input.date < indiaDate()) throw Object.assign(new Error('Choose today or a future date.'), { status: 400 });
  const holidays=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date`,{date:input.date});
  if(!isScheduledWorkday(input.date,new Set(holidays.map((x)=>x.date)))) throw Object.assign(new Error('Choose a scheduled workday for your flex-start request.'),{status:400});
  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    const [existing] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1 FOR UPDATE`, { employee:req.user.id, date:input.date });
    if (existing[0]) throw Object.assign(new Error('You already have a pending or approved flex-start request for this date.'), { status:409 });
    await connection.execute(`INSERT INTO flex_start_requests (id, employee_id, request_date, requested_start_time, reason) VALUES (:id, :employee, :date, :time, :reason)`, {
      id, employee: req.user.id, date: input.date, time: input.startTime, reason: input.reason
    });
  });
  await audit({ actorId: req.user.id, action: 'FLEX_START_REQUESTED', entityType: 'flex_start_request', entityId: id, details: { date: input.date, start_time: input.startTime }, ipAddress: req.ip });
  await notifyAdmins('Flexible start needs review', `${req.user.full_name} requested a ${input.startTime} start on ${input.date}.`, 'REQUEST', { type:'flex', id });
  res.status(201).json({ ok: true, id });
}));

router.get('/exits/current', asyncRoute(async (req, res) => {
  const rows = await query(`SELECT x.id, x.left_at, x.reason FROM temporary_exits x JOIN attendance_records a ON a.id=x.attendance_id WHERE x.employee_id=:employee AND x.returned_at IS NULL AND a.attendance_date=:date ORDER BY x.left_at DESC LIMIT 1`, { employee: req.user.id, date: indiaDate() });
  res.json({ exit: rows[0] || null });
}));
router.post('/exits', asyncRoute(async (req, res) => {
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
router.patch('/exits/:id/return', asyncRoute(async (req, res) => {
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
