import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { audit, requireAuth, requireAdmin, requirePeople, notifyAdmins } from '../security.mts';
import { htmlEscape } from '../mailer.mts';
import { enqueueHrNotificationEmail } from '../email-outbox.mts';
import { dispatchWorkflowRequestEmails } from '../email-routing.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { indiaDate, isScheduledWorkday } from '../policy.mts';
import { saveObject, deleteObject, readObject } from '../object-storage.mts';

const router = Router();
router.use(['/files', '/wfh', '/calendar'], requireAuth);
const uploadLimiter = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => {
  const allowed = ['application/pdf','image/jpeg','image/png'];
  cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('Only PDF, JPG, or PNG files are accepted.'), { status: 400 }), allowed.includes(file.mimetype));
} });

router.post('/files', requirePeople, uploadLimiter, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw Object.assign(new Error('Choose a PDF, JPG, or PNG file up to 4 MB.'), { status: 400 });
  const signatures: Record<string, Buffer> = {
    'application/pdf': Buffer.from('%PDF-'),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  };
  const expectedSig = signatures[req.file.mimetype];
  if (!expectedSig || req.file.buffer.length < expectedSig.length || !req.file.buffer.subarray(0, expectedSig.length).equals(expectedSig)) {
    throw Object.assign(new Error('The file contents do not match the selected document type.'), { status: 400 });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const allowedExts: Record<string, string[]> = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png']
  };
  if (!allowedExts[req.file.mimetype]?.includes(ext)) {
    throw Object.assign(new Error('The file extension does not match its detected MIME type.'), { status: 400 });
  }
  const id = crypto.randomUUID();
  const suffix = req.file.mimetype === 'application/pdf' ? '.pdf' : req.file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
  const key = `${req.user.id}/${id}${suffix}`;
  const safeFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 255) || 'attachment';
  try {
    await saveObject(key, req.file.buffer, req.file.mimetype);
    await query(`INSERT INTO attachments (id, uploaded_by, original_filename, object_key, content_type, size_bytes)
      VALUES (:id, :owner, :name, :key, :type, :size)`, { id, owner: req.user.id, name: safeFilename, key, type: req.file.mimetype, size: req.file.size });
  } catch (error) {
    try {
      await deleteObject(key);
    } catch (cleanupError) {
      console.error(JSON.stringify({type:'attachment_cleanup_error',request_id:req.requestId,attachment_id:id,error:String(cleanupError?.message||cleanupError)}));
    }
    throw error;
  }
  await audit({ actorId: req.user.id, action: 'PRIVATE_ATTACHMENT_UPLOADED', entityType: 'attachment', entityId: id, details: { content_type: req.file.mimetype, size_bytes: req.file.size }, ipAddress: req.ip });
  res.status(201).json({ id, filename: safeFilename });
}));

router.get('/files/:id', asyncRoute(async (req, res) => {
  const rows = await query(`SELECT a.*, EXISTS(SELECT 1 FROM leave_requests l WHERE l.attachment_id=a.id AND l.employee_id=:employee) AS attached_to_user
    FROM attachments a WHERE a.id=:id`, { employee: req.user.id, id: req.params.id });
  const file = rows[0];
  if (!file || (req.user.role !== 'ADMIN' && file.uploaded_by !== req.user.id && !file.attached_to_user)) throw Object.assign(new Error('File not found.'), { status: 404 });
  res.setHeader('Content-Type', file.content_type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  const object = await readObject(file.object_key);
  if (object.kind === 'buffer') {
    Readable.from(object.buffer).pipe(res);
  } else {
    object.stream
      .on('error', () => {
        if (!res.headersSent) res.status(404).end();
      })
      .pipe(res);
  }
}));

router.get('/wfh', requirePeople, asyncRoute(async (req, res) => {
  const employee = req.user.id;
  const today = indiaDate();
  // Serialize MySQL DATE values as a stable yyyy-mm-dd key rather than relying
  // on browser or driver timezone parsing for daily approval detection.
  const requests = await query(`SELECT id, DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date, request_kind, reason, status, reviewer_note, created_at FROM wfh_requests WHERE employee_id=:employee ORDER BY request_date DESC LIMIT 100`, { employee });
  const todayApproval = await query(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status='APPROVED' LIMIT 1`, { employee, date: today });
  const setting = await query(`SELECT setting_value FROM system_settings WHERE setting_key='wfh_monthly_cap'`);
  const enabled = req.user.wfh_enabled === true || Number(req.user.wfh_enabled) === 1;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ enabled, today, approvedToday: Boolean(todayApproval[0]), monthlyCap: Number(setting[0]?.setting_value || 4), requests });
}));
router.post('/wfh', requirePeople, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, kind: z.enum(['PLANNED','EMERGENCY']), reason: z.string().trim().min(8).max(1000) }), req.body);
  if (!(req.user.wfh_enabled === true || Number(req.user.wfh_enabled) === 1)) throw Object.assign(new Error('WFH has not been enabled for this employee. Ask an administrator if your eligibility needs to change.'), { status: 403 });
  if (input.date < indiaDate()) throw Object.assign(new Error('Choose today or a future date.'), { status: 400 });
  if (input.kind === 'EMERGENCY' && input.date !== indiaDate()) throw Object.assign(new Error('Emergency WFH is for an unexpected same-day need. Use a planned request for a future date.'), { status:400 });
  const holidayRows=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date AND holiday_kind='FIXED'`,{date:input.date});
  if(!isScheduledWorkday(input.date,new Set(holidayRows.map((x)=>x.date)))) throw Object.assign(new Error('Choose a scheduled workday for your WFH request.'),{status:400});
  const settings = await query(`SELECT setting_value FROM system_settings WHERE setting_key='wfh_monthly_cap'`);
  const cap = Number(settings[0]?.setting_value || 4);
  const monthStart = `${input.date.slice(0,7)}-01`;
  const [year, month] = input.date.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0,10);
  if (input.kind === 'PLANNED') {
    const target = new Date(`${input.date}T00:00:00+05:30`).getTime();
    if (target - Date.now() < 24 * 60 * 60 * 1000) throw Object.assign(new Error('Planned WFH requests should be submitted at least 24 hours ahead. Choose emergency if this is unexpected.'), { status: 400 });
  }
  const id = crypto.randomUUID();
  await transaction(async(connection)=>{
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE',{employee:req.user.id});
    const [activeRequest] = await connection.execute(`SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1 FOR UPDATE`, { employee:req.user.id, date:input.date });
    if (activeRequest[0]) throw Object.assign(new Error('A pending or approved WFH request already exists for this date.'), { status:409 });
    const [leaveOverlap] = await connection.execute(`SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1`, { employee:req.user.id, date:input.date });
    if (leaveOverlap[0]) throw Object.assign(new Error('A pending or approved leave request already covers this date. Resolve it before requesting WFH.'), { status:409 });
    const [flexOverlap] = await connection.execute(`SELECT id FROM flex_start_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1`, {employee:req.user.id,date:input.date});
    if (flexOverlap[0]) throw Object.assign(new Error('A pending or approved flex-start request already exists for this date. Resolve it before requesting WFH.'), {status:409});
    const [correctionOverlap] = await connection.execute(`SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1`, {employee:req.user.id,date:input.date});
    if (correctionOverlap[0]) throw Object.assign(new Error('A pending attendance correction exists for this date. Resolve it before requesting WFH.'), {status:409});
    const [attendanceExists] = await connection.execute(`SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1`, { employee:req.user.id, date:input.date });
    if (attendanceExists[0]) throw Object.assign(new Error('Attendance has already been recorded for this date. Contact HR if the record needs correction.'), { status:409 });
    const [count] = await connection.execute(`SELECT COUNT(*) AS count FROM wfh_requests WHERE employee_id=:employee AND request_date BETWEEN :start AND :end AND status IN ('APPROVED','PENDING')`, { employee: req.user.id, start: monthStart, end: monthEnd });
    if (Number(count[0].count) >= cap) throw Object.assign(new Error(`You have reached the usual limit of ${cap} WFH day(s) for this month. Ask a manager to approve an exception.`), { status: 400 });
    await connection.execute(`INSERT INTO wfh_requests (id, employee_id, request_date, request_kind, reason) VALUES (:id, :employee, :date, :kind, :reason)`, {
      id, employee: req.user.id, date: input.date, kind: input.kind, reason: input.reason
    });
  });
  await audit({ actorId: req.user.id, action: 'WFH_REQUESTED', entityType: 'wfh_request', entityId: id, details: { date: input.date, kind: input.kind }, ipAddress: req.ip });
  await notifyAdmins('WFH request needs review', `${req.user.full_name} requested WFH on ${input.date}.`, 'REQUEST', { type:'wfh', id });
  const emailDelivery = await (async () => {
    try {
      const delivery = await dispatchWorkflowRequestEmails({
        requestId: id,
        requestType: 'wfh',
        employeeId: req.user.id,
        title: 'Work From Home Request', // New WFH request notification
        summaryDetails: [
          { label: 'Remote Date', value: input.date },
          { label: 'Request Type', value: input.kind === 'EMERGENCY' ? 'Emergency / Same-Day' : 'Planned' }
        ],
        reason: input.reason,
        portalRoute: '/wfh'
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
      console.error(JSON.stringify({ type: 'wfh_request_email_enqueue_failed', request_id: id, error: String((error as any)?.message || error) }));
      return { configured: false, sent: 0, queued: false, status: 'ENQUEUE_FAILED', outboxId: null, recipients: 0 };
    }
  })();
  res.status(201).json({ ok: true, id, emailDelivery });
}));

router.get('/calendar', asyncRoute(async (req, res) => {
  const year = Number(req.query.year || indiaDate().slice(0,4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw Object.assign(new Error('Choose a valid year.'), { status: 400 });
  const rows = await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date, name, holiday_kind AS kind FROM company_holidays WHERE YEAR(holiday_date)=:year`, { year });
  const holidays = new Map<string, {name:string,kind:'FIXED'|'FLOATING',isPolicy?:boolean}>(rows.map((row: any) => [String(row.date), {name:String(row.name), kind:row.kind==='FLOATING'?'FLOATING':'FIXED', isPolicy:false}]));
  const nationalHolidays: Array<[number,number,string]> = [[1,26,'Republic Day'],[8,15,'Independence Day'],[10,2,'Gandhi Jayanti']];
  for (const [month, day, name] of nationalHolidays) holidays.set(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`, {name,kind:'FIXED',isPolicy:true});
  res.json({ year, holidays: [...holidays.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([date,item]) => ({ date, name:item.name, kind:item.kind, isPolicy:Boolean(item.isPolicy) })) });
}));

router.delete('/calendar/:date', requireAdmin, asyncRoute(async (req, res) => {
  const date = String(req.params.date || '').slice(0, 10);
  if (!dateSchema.safeParse(date).success) throw Object.assign(new Error('Choose a valid date to delete.'), { status: 400 });
  const year = Number(date.slice(0, 4));
  const nationalHolidays = [[1,26],[8,15],[10,2]].map(([m,d]) => `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  if (nationalHolidays.includes(date)) throw Object.assign(new Error('National statutory holidays cannot be deleted.'), { status: 400 });
  const result: any = await query('DELETE FROM company_holidays WHERE holiday_date = :date', { date });
  if (!result.affectedRows) throw Object.assign(new Error('Holiday record not found.'), { status: 404 });
  await audit({ actorId: req.user.id, action: 'HOLIDAY_DELETED', entityType: 'holiday', details: { date }, ipAddress: req.ip });
  res.json({ ok: true, date });
}));
router.delete('/wfh/:id', requirePeople, asyncRoute(async (req, res) => {
  const cancelled = await transaction(async (connection) => {
    await connection.execute('SELECT id FROM employees WHERE id=:employee FOR UPDATE', {employee:req.user.id});
    const [rows] = await connection.execute(`SELECT id,DATE_FORMAT(request_date,'%Y-%m-%d') AS request_date,status FROM wfh_requests WHERE id=:id AND employee_id=:employee FOR UPDATE`, {id:req.params.id,employee:req.user.id});
    if (!rows[0] || !['PENDING','APPROVED'].includes(String(rows[0].status))) throw Object.assign(new Error('Only pending or approved WFH requests can be cancelled.'), {status:409});
    const requestDate=String(rows[0].request_date).slice(0,10);
    if (requestDate < indiaDate()) throw Object.assign(new Error('Past WFH records cannot be cancelled. Contact HR if a historical record needs correction.'), {status:409});
    const [attendance] = await connection.execute('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1', {employee:req.user.id,date:requestDate});
    if (attendance[0]) throw Object.assign(new Error('Attendance is already recorded for this date. Contact HR instead of cancelling an in-use WFH approval.'), {status:409});
    const [updated] = await connection.execute(`UPDATE wfh_requests SET status='CANCELLED' WHERE id=:id AND employee_id=:employee AND status IN ('PENDING','APPROVED')`, {id:req.params.id,employee:req.user.id});
    if (!updated.affectedRows) throw Object.assign(new Error('The WFH request changed before cancellation. Refresh and try again.'), {status:409});
    return {id:String(rows[0].id),date:requestDate,previousStatus:String(rows[0].status)};
  });
  await audit({actorId:req.user.id,action:'WFH_REQUEST_CANCELLED',entityType:'wfh_request',entityId:cancelled.id,details:cancelled,ipAddress:req.ip});
  try { await notifyAdmins('WFH request cancelled', req.user.full_name+' cancelled a WFH request for '+cancelled.date+'.', 'UPDATE', {type:'wfh_cancelled',id:cancelled.id}); }
  catch (error) { console.warn(JSON.stringify({type:'wfh_cancellation_notification_failed',request_id:cancelled.id,error:String(error?.message||error)})); }
  res.json({ok:true,id:cancelled.id,status:'CANCELLED'});
}));
router.post('/calendar', requireAdmin, asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, name: z.string().trim().min(2).max(160), kind: z.enum(['FIXED','FLOATING']).default('FLOATING') }), req.body);
  await query(`INSERT INTO company_holidays (holiday_date, name, holiday_kind, created_by) VALUES (:date, :name, :kind, :actor)
    ON DUPLICATE KEY UPDATE name=VALUES(name), holiday_kind=VALUES(holiday_kind), created_by=VALUES(created_by)`, { date: input.date, name: input.name, kind: input.kind, actor: req.user.id });
  await audit({ actorId: req.user.id, action: 'HOLIDAY_ADDED', entityType: 'holiday', details: input, ipAddress: req.ip });
  res.status(201).json({ ok: true });
}));

export default router;
