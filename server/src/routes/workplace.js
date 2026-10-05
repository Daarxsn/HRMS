import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { audit, requireAuth, notifyAdmins } from '../security.js';
import { asyncRoute, dateSchema, validate } from '../validate.js';
import { indiaDate, isScheduledWorkday } from '../policy.js';

const router = Router();
router.use(requireAuth);
const storage = process.env.GCS_BUCKET ? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT }) : null;
const uploadLimiter = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,keyGenerator:(req)=>`user:${req.user.id}`});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => {
  const allowed = ['application/pdf','image/jpeg','image/png'];
  cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('Only PDF, JPG, or PNG files are accepted.'), { status: 400 }), allowed.includes(file.mimetype));
} });

router.post('/files', uploadLimiter, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw Object.assign(new Error('Choose a PDF, JPG, or PNG file up to 10 MB.'), { status: 400 });
  const signatures={
    'application/pdf':Buffer.from('%PDF-'),
    'image/jpeg':Buffer.from([0xff,0xd8,0xff]),
    'image/png':Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
  };
  if(!req.file.buffer.subarray(0,signatures[req.file.mimetype].length).equals(signatures[req.file.mimetype]))throw Object.assign(new Error('The file contents do not match the selected document type.'),{status:400});
  const id = crypto.randomUUID();
  const suffix = req.file.mimetype === 'application/pdf' ? '.pdf' : req.file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
  const key = `${req.user.id}/${id}${suffix}`;
  const localPath = path.resolve(process.cwd(), 'private-uploads', key);
  try {
    if (storage) {
      await storage.bucket(process.env.GCS_BUCKET).file(key).save(req.file.buffer, {
        resumable: false,
        metadata: { contentType: req.file.mimetype, cacheControl: 'private, no-store' },
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 }
      });
    } else {
      await fs.mkdir(path.dirname(localPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(localPath, req.file.buffer, { mode: 0o600, flag: 'wx' });
    }
    await query(`INSERT INTO attachments (id, uploaded_by, original_filename, object_key, content_type, size_bytes)
      VALUES (:id, :owner, :name, :key, :type, :size)`, { id, owner: req.user.id, name: path.basename(req.file.originalname).slice(0,255), key, type: req.file.mimetype, size: req.file.size });
  } catch (error) {
    try {
      if (storage) await storage.bucket(process.env.GCS_BUCKET).file(key).delete({ ignoreNotFound: true });
      else await fs.unlink(localPath);
    } catch (cleanupError) {
      console.error(JSON.stringify({type:'attachment_cleanup_error',request_id:req.requestId,attachment_id:id,error:String(cleanupError?.message||cleanupError)}));
    }
    throw error;
  }
  await audit({ actorId: req.user.id, action: 'PRIVATE_ATTACHMENT_UPLOADED', entityType: 'attachment', entityId: id, details: { content_type: req.file.mimetype, size_bytes: req.file.size }, ipAddress: req.ip });
  res.status(201).json({ id, filename: path.basename(req.file.originalname) });
}));

router.get('/files/:id', asyncRoute(async (req, res) => {
  const rows = await query(`SELECT a.*, EXISTS(SELECT 1 FROM leave_requests l WHERE l.attachment_id=a.id AND l.employee_id=:employee) AS attached_to_user
    FROM attachments a WHERE a.id=:id`, { employee: req.user.id, id: req.params.id });
  const file = rows[0];
  if (!file || (req.user.role !== 'ADMIN' && file.uploaded_by !== req.user.id && !file.attached_to_user)) throw Object.assign(new Error('File not found.'), { status: 404 });
  res.setHeader('Content-Type', file.content_type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  if (storage) return storage.bucket(process.env.GCS_BUCKET).file(file.object_key).createReadStream().on('error', (e) => { if (!res.headersSent) res.status(404).end(); }).pipe(res);
  const localPath = path.resolve(process.cwd(), 'private-uploads', file.object_key);
  const buffer = await fs.readFile(localPath);
  res.send(buffer);
}));

router.get('/wfh', asyncRoute(async (req, res) => {
  const requests = await query(`SELECT id, request_date, request_kind, reason, status, reviewer_note, created_at FROM wfh_requests WHERE employee_id=:employee ORDER BY request_date DESC LIMIT 100`, { employee: req.user.id });
  const setting = await query(`SELECT setting_value FROM system_settings WHERE setting_key='wfh_monthly_cap'`);
  res.json({ enabled: Boolean(req.user.wfh_enabled), monthlyCap: Number(setting[0]?.setting_value || 4), requests });
}));
router.post('/wfh', asyncRoute(async (req, res) => {
  const input = validate(z.object({ date: dateSchema, kind: z.enum(['PLANNED','EMERGENCY']), reason: z.string().trim().min(8).max(1000) }), req.body);
  if (!req.user.wfh_enabled) throw Object.assign(new Error('WFH has not been enabled for this employee. Ask an administrator if your eligibility needs to change.'), { status: 403 });
  if (input.date < indiaDate()) throw Object.assign(new Error('Choose today or a future date.'), { status: 400 });
  if (input.kind === 'EMERGENCY' && input.date !== indiaDate()) throw Object.assign(new Error('Emergency WFH is for an unexpected same-day need. Use a planned request for a future date.'), { status:400 });
  const holidayRows=await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date FROM company_holidays WHERE holiday_date=:date`,{date:input.date});
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
    const [count] = await connection.execute(`SELECT COUNT(*) AS count FROM wfh_requests WHERE employee_id=:employee AND request_date BETWEEN :start AND :end AND status IN ('APPROVED','PENDING')`, { employee: req.user.id, start: monthStart, end: monthEnd });
    if (Number(count[0].count) >= cap) throw Object.assign(new Error(`You have reached the usual limit of ${cap} WFH day(s) for this month. Ask a manager to approve an exception.`), { status: 400 });
    await connection.execute(`INSERT INTO wfh_requests (id, employee_id, request_date, request_kind, reason) VALUES (:id, :employee, :date, :kind, :reason)`, {
      id, employee: req.user.id, date: input.date, kind: input.kind, reason: input.reason
    });
  });
  await audit({ actorId: req.user.id, action: 'WFH_REQUESTED', entityType: 'wfh_request', entityId: id, details: { date: input.date, kind: input.kind }, ipAddress: req.ip });
  await notifyAdmins('WFH request needs review', `${req.user.full_name} requested WFH on ${input.date}.`, 'REQUEST', { type:'wfh', id });
  res.status(201).json({ ok: true, id });
}));

router.get('/calendar', asyncRoute(async (req, res) => {
  const year = Number(req.query.year || indiaDate().slice(0,4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw Object.assign(new Error('Choose a valid year.'), { status: 400 });
  const rows = await query(`SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS date, name FROM company_holidays WHERE YEAR(holiday_date)=:year`, { year });
  const holidays = new Map(rows.map((row) => [row.date, row.name]));
  for (const [month, day, name] of [[1,26,'Republic Day'],[8,15,'Independence Day'],[10,2,'Gandhi Jayanti']]) holidays.set(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`, name);
  res.json({ year, holidays: [...holidays.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([date,name]) => ({ date, name })) });
}));
router.post('/calendar', asyncRoute(async (req, res) => {
  if (req.user.role !== 'ADMIN') throw Object.assign(new Error('Administrator access is required.'), { status: 403 });
  const input = validate(z.object({ date: dateSchema, name: z.string().trim().min(2).max(160) }), req.body);
  await query(`INSERT INTO company_holidays (holiday_date, name, created_by) VALUES (:date, :name, :actor)
    ON DUPLICATE KEY UPDATE name=VALUES(name), created_by=VALUES(created_by)`, { date: input.date, name: input.name, actor: req.user.id });
  await audit({ actorId: req.user.id, action: 'HOLIDAY_ADDED', entityType: 'holiday', details: input, ipAddress: req.ip });
  res.status(201).json({ ok: true });
}));

export default router;
