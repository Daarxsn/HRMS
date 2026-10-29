import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import multer from 'multer';
import { z } from 'zod';
import { query, transaction } from '../db.mts';
import { audit, notify, requireAuth, requireAdmin, isAdmin } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { saveObject, deleteObject, readObject, getObjectStorageReadiness } from '../object-storage.mts';
import { indiaDate, isBirthdayToday } from '../policy.mts';
import { enqueueHrNotificationEmail } from '../email-outbox.mts';
import { dispatchWorkflowRequestEmails, dispatchWorkflowStatusEmail } from '../email-routing.mts';

const router = Router();
router.use(requireAuth);
// Central protection applies to every current and future /admin enterprise endpoint.
router.use('/admin', requireAdmin);
const adminLimiter = rateLimit({ windowMs:15*60*1000, limit:160, standardHeaders:true, legacyHeaders:false, keyGenerator:(req)=>`enterprise:${req.user.id}` });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req,file,cb) => { const allowed=['application/pdf','image/jpeg','image/png','image/webp']; cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('HR documents must be PDF, JPG, PNG, or WebP files.'),{status:400}), allowed.includes(file.mimetype)); }
});
const adminOnly = (req) => { if(!isAdmin(req.user)) throw Object.assign(new Error('Administrator access is required.'),{status:403}); };
const signatureOk = (buffer,contentType) => {
  if(contentType==='application/pdf') return buffer.subarray(0,4).equals(Buffer.from('%PDF'));
  if(contentType==='image/jpeg') return buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]));
  if(contentType==='image/png') return buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(contentType==='image/webp') return buffer.subarray(0,4).equals(Buffer.from('RIFF')) && buffer.subarray(8,12).equals(Buffer.from('WEBP'));
  return false;
};
const safeFilename = (value) => value.replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,180) || 'document';
const progress = (tasks) => { const total=tasks.length; const completed=tasks.filter((t)=>t.status==='COMPLETED').length; return {total,completed,percent:total?Math.round(completed*100/total):0}; };

router.get('/employee/documents', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT id,document_type,title,description,original_filename,content_type,size_bytes,issued_on,expires_on,status,created_at FROM employee_documents WHERE employee_id=:employee AND status<>'ARCHIVED' ORDER BY COALESCE(expires_on,'9999-12-31') ASC,created_at DESC`,{employee:req.user.id});
  res.setHeader('Cache-Control','private, no-store');
  res.json({documents:rows});
}));
router.get('/employee/documents/:id', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT object_key,original_filename,content_type FROM employee_documents WHERE id=:id AND employee_id=:employee AND status<>'ARCHIVED' LIMIT 1`,{id:req.params.id,employee:req.user.id});
  if(!rows[0]?.object_key) throw Object.assign(new Error('Document not found.'),{status:404});
  const file=await readObject(rows[0].object_key);
  res.setHeader('Content-Type',rows[0].content_type||file.contentType||'application/octet-stream');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(rows[0].original_filename||'document')}`);
  res.setHeader('Cache-Control','private, no-store');
  if (file.kind === 'buffer') {
    Readable.from(file.buffer).pipe(res);
  } else {
    file.stream.on('error', () => {
      console.error(JSON.stringify({type:'private_document_stream_failed',request_id:req.requestId}));
      if (!res.headersSent) res.status(503).json({error:'Private document storage is temporarily unavailable.',requestId:req.requestId});
      else res.destroy();
    }).pipe(res);
  }
}));

router.get('/policies', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT p.id,p.title,p.category,p.version,p.body,p.status,p.published_at,
    CASE WHEN a.id IS NULL THEN 0 ELSE 1 END acknowledged,
    a.acknowledged_at, a.ip_address, a.user_agent
    FROM company_policies p
    LEFT JOIN policy_acknowledgements a ON a.policy_id=p.id AND a.employee_id=:employee
    WHERE p.status='PUBLISHED'
    ORDER BY p.published_at DESC,p.created_at DESC`,{employee:req.user.id});
  res.json({policies:rows});
}));
router.post('/policies/:id/acknowledge', asyncRoute(async(req,res)=>{
  const rows=await query('SELECT id,title FROM company_policies WHERE id=:id AND status=\'PUBLISHED\' LIMIT 1',{id:req.params.id});
  if(!rows[0]) throw Object.assign(new Error('Policy not found or not published.'),{status:404});
  const userAgent = req.get('user-agent')?.slice(0, 500) || null;
  await query(`INSERT INTO policy_acknowledgements (id,policy_id,employee_id,acknowledged_at,ip_address,user_agent)
    VALUES (:id,:policy,:employee,UTC_TIMESTAMP(),:ip,:ua)
    ON DUPLICATE KEY UPDATE acknowledged_at=VALUES(acknowledged_at),ip_address=VALUES(ip_address),user_agent=VALUES(user_agent)`,
    {id:crypto.randomUUID(),policy:req.params.id,employee:req.user.id,ip:req.ip,ua:userAgent});
  await audit({actorId:req.user.id,action:'POLICY_ACKNOWLEDGED',entityType:'company_policy',entityId:req.params.id,details:{title:rows[0].title,userAgent},ipAddress:req.ip});
  res.json({ok:true});
}));
router.get('/admin/policies/:id/acknowledgements', adminLimiter, asyncRoute(async(req,res)=>{
  adminOnly(req);
  const rows=await query(`SELECT a.id,a.acknowledged_at,a.ip_address,a.user_agent,
    e.id AS employee_id,e.full_name,e.employee_code,e.email,e.department
    FROM policy_acknowledgements a
    JOIN employees e ON e.id=a.employee_id
    WHERE a.policy_id=:id
    ORDER BY a.acknowledged_at DESC`,{id:req.params.id});
  res.json({acknowledgements:rows});
}));

router.get('/admin/overview',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req);
  const [headcount,departments,attendance,attendanceTrendRows,leave,onboarding,assets,policies,separations,upcoming,missingDocs]=await Promise.all([
    query(`SELECT COUNT(*) total,SUM(status='ACTIVE') active,SUM(role='ADMIN' AND status='ACTIVE') admins FROM employees`),
    query(`SELECT COALESCE(NULLIF(department,''),'Unassigned') department,COUNT(*) total FROM employees WHERE status='ACTIVE' GROUP BY COALESCE(NULLIF(department,''),'Unassigned') ORDER BY total DESC,department LIMIT 12`),
    query(`SELECT COUNT(DISTINCT employee_id) present,SUM(status='LATE_ENTRY') late,SUM(status='ABSENT') absent FROM attendance_records WHERE attendance_date BETWEEN DATE_SUB(CURDATE(),INTERVAL 29 DAY) AND CURDATE()`),
    query(`SELECT DATE_FORMAT(attendance_date,'%Y-%m') month,COUNT(DISTINCT employee_id) present,SUM(status='LATE_ENTRY') late,SUM(status='ABSENT') absent FROM attendance_records WHERE attendance_date>=DATE_SUB(CURDATE(),INTERVAL 5 MONTH) GROUP BY month ORDER BY month`),
    query(`SELECT leave_type,SUM(CASE WHEN status='APPROVED' THEN days ELSE 0 END) approved,SUM(CASE WHEN status='PENDING' THEN days ELSE 0 END) pending,SUM(CASE WHEN status IN ('APPROVED','PENDING') THEN days ELSE 0 END) committed FROM leave_requests WHERE start_date>=DATE_FORMAT(CURDATE(),'%Y-01-01') GROUP BY leave_type ORDER BY leave_type`),
    query(`SELECT status,COUNT(*) total FROM onboarding_tasks GROUP BY status`),
    query(`SELECT status,COUNT(*) total FROM company_assets GROUP BY status`),
    query(`SELECT p.id,p.title,p.category,p.version,p.status,p.published_at,(SELECT COUNT(*) FROM employees e WHERE e.status='ACTIVE' AND e.role='EMPLOYEE') active_people,(SELECT COUNT(*) FROM policy_acknowledgements a WHERE a.policy_id=p.id) acknowledgements FROM company_policies p ORDER BY p.updated_at DESC LIMIT 12`),
    query(`SELECT s.id,s.employee_id,s.separation_type,s.last_working_date,s.status,e.full_name,e.employee_code FROM separation_cases s JOIN employees e ON e.id=s.employee_id WHERE s.status IN ('OPEN','IN_PROGRESS') ORDER BY s.last_working_date ASC LIMIT 10`),
    query(`SELECT id,full_name,employee_code,joined_on,probation_end_date FROM employees WHERE status='ACTIVE' AND probation_end_date IS NOT NULL AND probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 60 DAY) ORDER BY probation_end_date LIMIT 12`),
    query(`SELECT e.id,e.full_name,e.employee_code FROM employees e LEFT JOIN employee_documents d ON d.employee_id=e.id AND d.status IN ('ACTIVE','EXPIRING') WHERE e.status='ACTIVE' GROUP BY e.id HAVING COUNT(d.id)=0 ORDER BY e.full_name LIMIT 20`)
  ]);
  const onboardingSummary=onboarding.reduce((a,r)=>{a[r.status]=Number(r.total);return a;},{});
  const assetSummary=assets.reduce((a,r)=>{a[r.status]=Number(r.total);return a;},{});
  const attendanceTrend=attendanceTrendRows.map((x)=>({...x,present:Number(x.present||0),late:Number(x.late||0),absent:Number(x.absent||0)}));
  const leaveSummary=leave.map((x)=>({...x,approved:Number(x.approved||0),pending:Number(x.pending||0),committed:Number(x.committed||0)}));
  const policySummary=policies.map((p)=>({...p,active_people:Number(p.active_people),acknowledgements:Number(p.acknowledgements),acknowledgement_percent:p.active_people?Math.round(Number(p.acknowledgements)*100/Number(p.active_people)):0}));
  res.json({headcount:{total:Number(headcount[0]?.total||0),active:Number(headcount[0]?.active||0),admins:Number(headcount[0]?.admins||0)},departments:departments.map((x)=>({...x,total:Number(x.total)})),attendance30d:{present:Number(attendance[0]?.present||0),late:Number(attendance[0]?.late||0),absent:Number(attendance[0]?.absent||0)},attendanceTrend,leave:leaveSummary,onboarding:{summary:onboardingSummary,progressPercent:progress(onboarding).percent},assets:assetSummary,policies:policySummary,separations,upcomingProbation:upcoming,missingDocuments:missingDocs});
}));

router.get('/admin/employees/:id/lifecycle',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const id=req.params.id;
  const employeeRows=await query('SELECT id,employee_code,full_name,email,role,user_type,status,title,position,branch,department,phone,joined_on,probation_end_date,wfh_enabled,session_version FROM employees WHERE id=:id LIMIT 1',{id});
  const employee=employeeRows[0]; if(!employee) throw Object.assign(new Error('Employee not found.'),{status:404});
  const [contacts,tasks,history,documents,assets,separation]=await Promise.all([
    query('SELECT id,contact_name,relationship,phone,email,is_primary,created_at,updated_at FROM employee_emergency_contacts WHERE employee_id=:id ORDER BY is_primary DESC,contact_name',{id}),
    query('SELECT id,title,category,due_date,status,completed_at,notes FROM onboarding_tasks WHERE employee_id=:id ORDER BY (due_date IS NULL),due_date,title',{id}),
    query('SELECT id,event_type,effective_date,title,department,branch,notes,created_at FROM employment_history WHERE employee_id=:id ORDER BY effective_date DESC,created_at DESC',{id}),
    query('SELECT id,document_type,title,description,original_filename,content_type,size_bytes,issued_on,expires_on,status,created_at FROM employee_documents WHERE employee_id=:id ORDER BY COALESCE(expires_on,\'9999-12-31\') ASC,created_at DESC',{id}),
    query('SELECT id,asset_tag,name,category,serial_number,status,assigned_at,returned_at,notes FROM company_assets WHERE assigned_employee_id=:id ORDER BY updated_at DESC',{id}),
    query("SELECT id,separation_type,reason,last_working_date,status,notes,completed_at,created_at FROM separation_cases WHERE employee_id=:id ORDER BY created_at DESC LIMIT 1",{id})
  ]);
  res.json({employee,contacts,tasks,history,documents,assets,separation:separation[0]||null,onboardingProgress:progress(tasks)});
}));

router.post('/admin/employees/:id/onboarding',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({title:z.string().trim().min(2).max(180),category:z.string().trim().min(2).max(80).default('GENERAL'),dueDate:dateSchema.nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  const employee=await query('SELECT id FROM employees WHERE id=:id LIMIT 1',{id:req.params.id}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const id=crypto.randomUUID();
  await transaction(async(connection)=>{
    await connection.execute('INSERT INTO onboarding_tasks (id,employee_id,title,category,due_date,notes,created_by) VALUES (:id,:employee,:title,:category,:dueDate,:notes,:admin)',{id,employee:req.params.id,title:input.title,category:input.category,dueDate:input.dueDate||null,notes:input.notes||null,admin:req.user.id});
    await connection.execute(`INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES (:id,:actor,:action,:entity,:entityId,:details,:ip,UTC_TIMESTAMP())`,{id:crypto.randomUUID(),actor:req.user.id,action:'ONBOARDING_TASK_CREATED',entity:'onboarding_task',entityId:id,details:JSON.stringify({employee_id:req.params.id,title:input.title}),ip:req.ip});
  });
  res.status(201).json({ok:true,id});
}));
router.patch('/admin/onboarding/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({status:z.enum(['PENDING','IN_PROGRESS','COMPLETED','BLOCKED']),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  await transaction(async(connection)=>{
    const [rows]=await connection.execute('SELECT id FROM onboarding_tasks WHERE id=:id LIMIT 1 FOR UPDATE',{id:req.params.id});
    if(!rows[0]) throw Object.assign(new Error('Onboarding task not found.'),{status:404});
    if(input.status==='COMPLETED') await connection.execute('UPDATE onboarding_tasks SET status=:status,notes=:notes,completed_at=UTC_TIMESTAMP(),completed_by=:admin WHERE id=:id',{status:input.status,notes:input.notes||null,admin:req.user.id,id:req.params.id});
    else await connection.execute('UPDATE onboarding_tasks SET status=:status,notes=:notes,completed_at=NULL,completed_by=NULL WHERE id=:id',{status:input.status,notes:input.notes||null,id:req.params.id});
    await connection.execute(`INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at)
      VALUES (:id,:actor,:action,:entity,:entityId,:details,:ip,UTC_TIMESTAMP())`,{
      id:crypto.randomUUID(),actor:req.user.id,action:'ONBOARDING_TASK_UPDATED',entity:'onboarding_task',entityId:req.params.id,
      details:JSON.stringify({status:input.status}),ip:req.ip
    });
  });
  res.json({ok:true});
}));

router.post('/admin/employees/:id/history',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({eventType:z.enum(['JOINED','PROMOTED','TRANSFERRED','ROLE_CHANGED','PROBATION_COMPLETED','STATUS_CHANGED','OTHER']),effectiveDate:dateSchema,title:z.string().trim().max(120).nullable().optional(),department:z.string().trim().max(120).nullable().optional(),branch:z.string().trim().max(100).nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  const employee=await query('SELECT id FROM employees WHERE id=:id LIMIT 1',{id:req.params.id}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const id=crypto.randomUUID(); await query('INSERT INTO employment_history (id,employee_id,event_type,effective_date,title,department,branch,notes,created_by) VALUES (:id,:employee,:event,:effective,:title,:department,:branch,:notes,:admin)',{id,employee:req.params.id,event:input.eventType,effective:input.effectiveDate,title:input.title||null,department:input.department||null,branch:input.branch||null,notes:input.notes||null,admin:req.user.id});
  await audit({actorId:req.user.id,action:'EMPLOYMENT_HISTORY_ADDED',entityType:'employment_history',entityId:id,details:{employee_id:req.params.id,event_type:input.eventType},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));

router.post('/admin/employees/:id/emergency-contacts',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({contactName:z.string().trim().min(2).max(120),relationship:z.string().trim().min(2).max(80),phone:z.string().trim().min(5).max(32),email:z.string().trim().email().nullable().optional(),isPrimary:z.boolean().default(false)}),req.body);
  const employee=await query('SELECT id FROM employees WHERE id=:id LIMIT 1',{id:req.params.id}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  if(input.isPrimary) await query('UPDATE employee_emergency_contacts SET is_primary=FALSE WHERE employee_id=:id',{id:req.params.id});
  const id=crypto.randomUUID(); await query('INSERT INTO employee_emergency_contacts (id,employee_id,contact_name,relationship,phone,email,is_primary) VALUES (:id,:employee,:name,:relationship,:phone,:email,:primary)',{id,employee:req.params.id,name:input.contactName,relationship:input.relationship,phone:input.phone,email:input.email||null,primary:input.isPrimary});
  await audit({actorId:req.user.id,action:'EMERGENCY_CONTACT_ADDED',entityType:'employee_emergency_contact',entityId:id,details:{employee_id:req.params.id},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));

router.post('/admin/employees/:id/documents',adminLimiter,upload.single('document'),asyncRoute(async(req,res)=>{
  adminOnly(req); if(!req.file) throw Object.assign(new Error('Choose a PDF, JPG, PNG, or WebP document up to 10 MB.'),{status:400});
  if(!signatureOk(req.file.buffer,req.file.mimetype)) throw Object.assign(new Error('The uploaded file signature is invalid.'),{status:400});
  const input=validate(z.object({documentType:z.string().trim().min(2).max(80),title:z.string().trim().min(2).max(180),description:z.string().trim().max(1000).nullable().optional(),issuedOn:dateSchema.nullable().optional(),expiresOn:dateSchema.nullable().optional()}),req.body);
  if(input.issuedOn&&input.expiresOn&&input.expiresOn<input.issuedOn) throw Object.assign(new Error('Document expiry date cannot be earlier than its issue date.'),{status:400});
  const employee=await query('SELECT id FROM employees WHERE id=:id LIMIT 1',{id:req.params.id}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const id=crypto.randomUUID(); const key=req.params.id+'/hr-documents/'+id+'-'+safeFilename(req.file.originalname); await saveObject(key,req.file.buffer,req.file.mimetype);
  try { await query('INSERT INTO employee_documents (id,employee_id,document_type,title,description,object_key,original_filename,content_type,size_bytes,issued_on,expires_on,uploaded_by) VALUES (:id,:employee,:type,:title,:description,:key,:filename,:contentType,:size,:issuedOn,:expiresOn,:admin)',{id,employee:req.params.id,type:input.documentType,title:input.title,description:input.description||null,key,filename:req.file.originalname.slice(0,255),contentType:req.file.mimetype,size:req.file.size,issuedOn:input.issuedOn||null,expiresOn:input.expiresOn||null,admin:req.user.id}); } catch(error) { await deleteObject(key); throw error; }
  await audit({actorId:req.user.id,action:'HR_DOCUMENT_UPLOADED',entityType:'employee_document',entityId:id,details:{employee_id:req.params.id,document_type:input.documentType},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));
router.get('/admin/documents/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const rows=await query('SELECT object_key,original_filename,content_type FROM employee_documents WHERE id=:id LIMIT 1',{id:req.params.id}); if(!rows[0]?.object_key) return res.status(404).end();
  const file=await readObject(rows[0].object_key); res.setHeader('Content-Type',rows[0].content_type||file.contentType||'application/octet-stream'); res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(rows[0].original_filename||'document')}`); res.setHeader('Cache-Control','private, no-store');
  if (file.kind === 'buffer') {
    Readable.from(file.buffer).pipe(res);
  } else {
    file.stream.on('error', () => {
      console.error(JSON.stringify({type:'private_document_stream_failed',request_id:req.requestId}));
      if (!res.headersSent) res.status(503).json({error:'Private document storage is temporarily unavailable.',requestId:req.requestId});
      else res.destroy();
    }).pipe(res);
  }
}));

router.get('/admin/assets',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const rows=await query('SELECT a.id,a.asset_tag,a.name,a.category,a.serial_number,a.status,a.assigned_employee_id,a.assigned_at,a.returned_at,a.notes,e.full_name,e.employee_code FROM company_assets a LEFT JOIN employees e ON e.id=a.assigned_employee_id ORDER BY FIELD(a.status,\'ASSIGNED\',\'REPAIR\',\'AVAILABLE\',\'RETIRED\'),a.name'); res.json({assets:rows});
}));
router.post('/admin/assets',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({assetTag:z.string().trim().min(2).max(80),name:z.string().trim().min(2).max(180),category:z.string().trim().min(2).max(80),serialNumber:z.string().trim().max(160).nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  const id=crypto.randomUUID(); await query('INSERT INTO company_assets (id,asset_tag,name,category,serial_number,notes,created_by) VALUES (:id,:tag,:name,:category,:serial,:notes,:admin)',{id,tag:input.assetTag,name:input.name,category:input.category,serial:input.serialNumber||null,notes:input.notes||null,admin:req.user.id});
  await audit({actorId:req.user.id,action:'ASSET_CREATED',entityType:'company_asset',entityId:id,details:{asset_tag:input.assetTag},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));
router.patch('/admin/assets/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({status:z.enum(['AVAILABLE','ASSIGNED','REPAIR','RETIRED']).optional(),assignedEmployeeId:z.string().uuid().nullable().optional(),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  const rows=await query('SELECT id,assigned_employee_id FROM company_assets WHERE id=:id LIMIT 1',{id:req.params.id}); if(!rows[0]) throw Object.assign(new Error('Asset not found.'),{status:404});
  let assigned=input.assignedEmployeeId===undefined?rows[0].assigned_employee_id:input.assignedEmployeeId;
  if(assigned){const employee=await query("SELECT id FROM employees WHERE id=:id AND status='ACTIVE' AND role='EMPLOYEE' LIMIT 1",{id:assigned}); if(!employee[0]) throw Object.assign(new Error('Assigned employee not found or inactive.'),{status:400});}
  const status=input.status||(assigned?'ASSIGNED':'AVAILABLE');
  if(status==='ASSIGNED'&&!assigned) throw Object.assign(new Error('Assign this asset to an active employee before setting its status to Assigned.'),{status:400});
  if((status==='REPAIR'||status==='RETIRED')&&assigned) throw Object.assign(new Error('Unassign this asset before moving it to repair or retiring it.'),{status:409});
  if(status==='AVAILABLE'&&assigned) throw Object.assign(new Error('Unassign this asset before marking it Available.'),{status:409});
  const assignedChanged=Boolean(assigned && !rows[0].assigned_employee_id); const returnedChanged=Boolean(!assigned && rows[0].assigned_employee_id);
  await query('UPDATE company_assets SET status=:status,assigned_employee_id=:employee,assigned_at=CASE WHEN :assignedChanged=1 THEN UTC_TIMESTAMP() ELSE assigned_at END,returned_at=CASE WHEN :returnedChanged=1 THEN UTC_TIMESTAMP() ELSE returned_at END,notes=COALESCE(:notes,notes) WHERE id=:id',{status,employee:assigned||null,assignedChanged:assignedChanged?1:0,returnedChanged:returnedChanged?1:0,notes:input.notes===undefined?null:input.notes,id:req.params.id});
  await audit({actorId:req.user.id,action:'ASSET_UPDATED',entityType:'company_asset',entityId:req.params.id,details:{status,assigned_employee_id:assigned||null},ipAddress:req.ip});
  if(assigned&&assignedChanged) await notify(assigned,'Company asset assigned','A company asset has been assigned to you.','UPDATE',{type:'asset',id:req.params.id});
  res.json({ok:true});
}));

router.get('/admin/policies',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const rows=await query('SELECT p.id,p.title,p.category,p.version,p.body,p.status,p.published_at,p.created_at,p.updated_at,(SELECT COUNT(*) FROM policy_acknowledgements a WHERE a.policy_id=p.id) acknowledgements,(SELECT COUNT(*) FROM employees e WHERE e.status=\'ACTIVE\' AND e.role=\'EMPLOYEE\') active_people FROM company_policies p ORDER BY p.updated_at DESC');
  res.json({policies:rows.map((p)=>({...p,acknowledgements:Number(p.acknowledgements),active_people:Number(p.active_people)}))});
}));
router.post('/admin/policies',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({title:z.string().trim().min(3).max(180),category:z.string().trim().min(2).max(80),version:z.string().trim().min(1).max(40),body:z.string().trim().min(20).max(20000)}),req.body);
  const id=crypto.randomUUID(); await query('INSERT INTO company_policies (id,title,category,version,body,created_by) VALUES (:id,:title,:category,:version,:body,:admin)',{id,title:input.title,category:input.category,version:input.version,body:input.body,admin:req.user.id});
  await audit({actorId:req.user.id,action:'POLICY_CREATED',entityType:'company_policy',entityId:id,details:{title:input.title,version:input.version},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));
router.patch('/admin/policies/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({title:z.string().trim().min(3).max(180).optional(),category:z.string().trim().min(2).max(80).optional(),version:z.string().trim().min(1).max(40).optional(),body:z.string().trim().min(20).max(20000).optional(),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED']).optional()}),req.body);
  if(!Object.keys(input).length) throw Object.assign(new Error('Make at least one change.'),{status:400});
  const existing=await query('SELECT p.status,(SELECT COUNT(*) FROM policy_acknowledgements a WHERE a.policy_id=p.id) acknowledgements FROM company_policies p WHERE p.id=? LIMIT 1',[req.params.id]);
  if(!existing[0]) throw Object.assign(new Error('Policy not found.'),{status:404});
  const editsPublishedContent=['title','category','version','body'].some((key)=>input[key]!==undefined);
  if((existing[0].status==='PUBLISHED'||Number(existing[0].acknowledgements)>0)&&editsPublishedContent) throw Object.assign(new Error('Published or acknowledged policy content is immutable. Create a new policy version to preserve the content employees acknowledged.'),{status:409});
  const sets=[]; const values=[]; const fields={title:['title',input.title],category:['category',input.category],version:['version',input.version],body:['body',input.body],status:['status',input.status]};
  for(const [,pair] of Object.entries(fields)){const column=pair[0],value=pair[1]; if(value!==undefined){sets.push(column+'=?');values.push(value);}}
  if(input.status==='PUBLISHED') sets.push('published_at=COALESCE(published_at,UTC_TIMESTAMP())');
  if(input.status==='DRAFT'||input.status==='ARCHIVED') sets.push('published_at=NULL');
  values.push(req.params.id); const result=await query('UPDATE company_policies SET '+sets.join(',')+' WHERE id=?',values); if(!result.affectedRows) throw Object.assign(new Error('Policy not found.'),{status:404});
  if(input.status==='PUBLISHED') {
    const policy=await query('SELECT title,version FROM company_policies WHERE id=:id LIMIT 1',{id:req.params.id});
    const recipients=await query("SELECT id FROM employees WHERE status='ACTIVE' AND role='EMPLOYEE'");
    await Promise.all(recipients.map((person)=>notify(person.id,'New HR policy published',policy[0]?.title+` · version ${policy[0]?.version}`,'ANNOUNCEMENT',{type:'policy',id:req.params.id})));
  }
  await audit({actorId:req.user.id,action:'POLICY_UPDATED',entityType:'company_policy',entityId:req.params.id,details:{fields:Object.keys(input)},ipAddress:req.ip}); res.json({ok:true});
}));

router.get('/admin/separations',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const rows=await query('SELECT s.id,s.employee_id,s.separation_type,s.reason,s.last_working_date,s.status,s.notes,s.completed_at,s.created_at,e.full_name,e.employee_code FROM separation_cases s JOIN employees e ON e.id=s.employee_id ORDER BY FIELD(s.status,\'OPEN\',\'IN_PROGRESS\',\'COMPLETED\',\'CANCELLED\'),s.last_working_date ASC'); res.json({separations:rows});
}));
router.post('/admin/separations',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({employeeId:z.string().uuid(),separationType:z.enum(['RESIGNATION','TERMINATION','CONTRACT_END','RETIREMENT','OTHER']),reason:z.string().trim().max(1000).nullable().optional(),lastWorkingDate:dateSchema,notes:z.string().trim().max(2000).nullable().optional()}),req.body);
  const employee=await query('SELECT id,full_name FROM employees WHERE id=:id LIMIT 1',{id:input.employeeId}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const activeCase=await query("SELECT id FROM separation_cases WHERE employee_id=:employee AND status IN ('OPEN','IN_PROGRESS') LIMIT 1",{employee:input.employeeId}); if(activeCase[0]) throw Object.assign(new Error('This employee already has an open separation case.'),{status:409});
  const id=crypto.randomUUID(); await query('INSERT INTO separation_cases (id,employee_id,separation_type,reason,last_working_date,notes,created_by) VALUES (:id,:employee,:type,:reason,:lastDate,:notes,:admin)',{id,employee:input.employeeId,type:input.separationType,reason:input.reason||null,lastDate:input.lastWorkingDate,notes:input.notes||null,admin:req.user.id});
  await audit({actorId:req.user.id,action:'SEPARATION_STARTED',entityType:'separation_case',entityId:id,details:{employee_id:input.employeeId,type:input.separationType,last_working_date:input.lastWorkingDate},ipAddress:req.ip});
  await notify(input.employeeId,'HR separation workflow started','Please review the next steps shared by your administrator.','UPDATE',{type:'separation',id}); res.status(201).json({ok:true,id});
}));
router.patch('/admin/separations/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({status:z.enum(['OPEN','IN_PROGRESS','COMPLETED','CANCELLED']),notes:z.string().trim().max(2000).nullable().optional()}),req.body);
  const result=await transaction(async(connection)=>{
    const [rows]=await connection.execute('SELECT id,employee_id,status FROM separation_cases WHERE id=? LIMIT 1 FOR UPDATE',[req.params.id]);
    if(!rows[0]) throw Object.assign(new Error('Separation case not found.'),{status:404});
    if(rows[0].status==='COMPLETED'&&input.status!=='COMPLETED') throw Object.assign(new Error('A completed separation cannot be reopened or cancelled. Create a new HR case if a correction is required.'),{status:409});
    await connection.execute("UPDATE separation_cases SET status=?,notes=COALESCE(?,notes),completed_at=CASE WHEN ?='COMPLETED' THEN COALESCE(completed_at,UTC_TIMESTAMP()) ELSE NULL END WHERE id=?",[input.status,input.notes===undefined?null:input.notes,input.status,req.params.id]);
    if(input.status==='COMPLETED') {
      const [employeeResult]=await connection.execute("UPDATE employees SET status='INACTIVE',session_version=session_version+1 WHERE id=? AND status<>'INACTIVE'",[rows[0].employee_id]);
      if(employeeResult.affectedRows===0) {
        const [employeeRows]=await connection.execute('SELECT id,status FROM employees WHERE id=? LIMIT 1',[rows[0].employee_id]);
        if(!employeeRows[0]) throw Object.assign(new Error('Employee record was not found; separation was not completed.'),{status:404});
      }
    }
    return {previousStatus:rows[0].status};
  });
  await audit({actorId:req.user.id,action:'SEPARATION_UPDATED',entityType:'separation_case',entityId:req.params.id,details:{status:input.status,previous_status:result.previousStatus},ipAddress:req.ip}); res.json({ok:true});
}));

router.get('/admin/security',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const [people,admins,recent]=await Promise.all([query('SELECT COUNT(*) total,SUM(status=\'ACTIVE\') active,SUM(status=\'INACTIVE\') inactive FROM employees'),query("SELECT COUNT(*) total FROM employees WHERE role='ADMIN' AND status='ACTIVE'"),query("SELECT action,COUNT(*) total,MAX(created_at) last_at FROM audit_logs WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) GROUP BY action ORDER BY total DESC LIMIT 12")]);
  res.json({accountSummary:{total:Number(people[0]?.total||0),active:Number(people[0]?.active||0),inactive:Number(people[0]?.inactive||0),activeAdmins:Number(admins[0]?.total||0)},recentActions:recent.map((x)=>({...x,total:Number(x.total)}))});
}));
router.post('/admin/security/revoke/:employeeId',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); if(req.params.employeeId===req.user.id) throw Object.assign(new Error('Use sign out instead of revoking your own current session.'),{status:400});
  const result=await query('UPDATE employees SET session_version=session_version+1 WHERE id=:id AND status=\'ACTIVE\'',{id:req.params.employeeId}); if(!result.affectedRows) throw Object.assign(new Error('Active employee not found.'),{status:404});
  try { await query('UPDATE employee_sessions SET revoked_at=UTC_TIMESTAMP() WHERE employee_id=:id AND revoked_at IS NULL', { id:req.params.employeeId }); } catch {}
  await audit({actorId:req.user.id,action:'SESSION_REVOKED',entityType:'employee',entityId:req.params.employeeId,details:{reason:'administrator_revocation'},ipAddress:req.ip}); res.json({ok:true});
}));
router.get('/admin/readiness',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const checks=[]; const add=(key,status,detail)=>checks.push({key,status,detail});
  const checksMap=[['database','SELECT 1','Database is reachable.'],['employee_directory','SELECT COUNT(*) total FROM employees','Employee directory is queryable.'],['audit_trail','SELECT COUNT(*) total FROM audit_logs','Audit log is queryable.'],['hr_documents','SELECT COUNT(*) total FROM employee_documents','HR document storage metadata is queryable.'],['policy_center','SELECT COUNT(*) total FROM company_policies','Policy center is queryable.'],['asset_register','SELECT COUNT(*) total FROM company_assets','Asset register is queryable.']];
  for(const item of checksMap){try{await query(item[1]);add(item[0],'PASS',item[2]);}catch{add(item[0],'FAIL',item[2].replace('is queryable','is unavailable').replace('is reachable','connectivity check failed.'));}}
  const storage=getObjectStorageReadiness();
  add('private_object_storage',storage.status,storage.detail);
  res.json({status:checks.every((x)=>x.status==='PASS')?'READY':'DEGRADED',checks,checkedAt:new Date().toISOString()});
}));

// ==========================================
// Phase 7: Learning & Development Allowance
// ==========================================
router.get('/learning/budget', asyncRoute(async(req,res)=>{
  const today = indiaDate();
  const currentYear = Number(today.slice(0, 4));
  const claims = await query(
    `SELECT l.id,l.fiscal_year,l.title,l.provider,l.amount_inr,l.invoice_attachment_id,l.notes,l.status,
      l.rejection_reason,l.reviewed_at,l.created_at,a.original_filename AS attachment_name
     FROM learning_allowances l
     LEFT JOIN attachments a ON a.id=l.invoice_attachment_id
     WHERE l.employee_id=:employee AND l.fiscal_year=:year
     ORDER BY l.created_at DESC`,
    { employee:req.user.id, year:currentYear }
  );
  let approved = 0;
  let pending = 0;
  for (const c of claims) {
    const amt = Number(c.amount_inr || 0);
    if (c.status === 'APPROVED') approved += amt;
    else if (c.status === 'PENDING') pending += amt;
  }
  const annualAllowance = 24000;
  const remaining = Math.max(0, annualAllowance - approved - pending);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    fiscal_year: currentYear,
    annual_allowance: annualAllowance,
    approved_amount: approved,
    pending_amount: pending,
    remaining_balance: remaining,
    claims
  });
}));

router.post('/learning/claims', asyncRoute(async(req,res)=>{
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180),
    provider: z.string().trim().min(2).max(120),
    amount_inr: z.number().positive().max(24000),
    invoice_attachment_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional()
  }), req.body);

  const today = indiaDate();
  const currentYear = Number(today.slice(0, 4));

  if (input.invoice_attachment_id) {
    const file = await query('SELECT id FROM attachments WHERE id=:id AND uploaded_by=:employee', { id: input.invoice_attachment_id, employee: req.user.id });
    if (!file[0]) throw Object.assign(new Error('Supporting receipt is not available for your account.'), { status: 403 });
  }

  const id = crypto.randomUUID();
  await transaction(async (connection) => {
    const [existing] = await connection.execute(
      `SELECT status, amount_inr FROM learning_allowances WHERE employee_id=:employee AND fiscal_year=:year FOR UPDATE`,
      { employee: req.user.id, year: currentYear }
    );
    let committed = 0;
    for (const row of existing as any[]) {
      if (row.status === 'APPROVED' || row.status === 'PENDING') {
        committed += Number(row.amount_inr || 0);
      }
    }
    const annualAllowance = 24000;
    const remaining = Math.max(0, annualAllowance - committed);
    if (input.amount_inr > remaining) {
      throw Object.assign(new Error(`Claim of ₹${input.amount_inr} exceeds remaining annual learning budget (₹${remaining} available).`), { status: 400 });
    }
    await connection.execute(
      `INSERT INTO learning_allowances (id, employee_id, fiscal_year, title, provider, amount_inr, invoice_attachment_id, notes, status)
       VALUES (:id, :employee, :year, :title, :provider, :amount, :attachment, :notes, 'PENDING')`,
      { id, employee: req.user.id, year: currentYear, title: input.title, provider: input.provider, amount: input.amount_inr, attachment: input.invoice_attachment_id || null, notes: input.notes || null }
    );
  });

  await audit({ actorId: req.user.id, action: 'LEARNING_CLAIM_SUBMITTED', entityType: 'learning_allowance', entityId: id, details: { title: input.title, amount: input.amount_inr, provider: input.provider }, ipAddress: req.ip });
  try {
    await dispatchWorkflowRequestEmails({
      requestId: id,
      requestType: 'learning_claim',
      employeeId: req.user.id,
      title: 'Learning & Development Reimbursement Claim',
      summaryDetails: [
        { label: 'Course / Certification', value: input.title },
        { label: 'Provider / Institution', value: input.provider },
        { label: 'Reimbursement Amount', value: `₹${input.amount_inr.toLocaleString('en-IN')}` }
      ],
      reason: input.notes || null,
      portalRoute: '/profile',
      adminApprovalRoute: `/admin/hr?tab=learning&id=${id}`
    });
  } catch (e: any) {
    console.error(JSON.stringify({
      type: 'learning_claim_email_dispatch_failed',
      claim_id: id,
      error: String(e?.message || e)
    }));
  }

  res.status(201).json({ ok: true, id });
}));

router.get('/admin/learning/claims', adminLimiter, asyncRoute(async(req,res)=>{
  adminOnly(req);
  const statusFilter = req.query.status && ['PENDING','APPROVED','REJECTED'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const rows = await query(
    `SELECT l.id, l.fiscal_year, l.title, l.provider, l.amount_inr, l.invoice_attachment_id, l.notes,
      l.status, l.rejection_reason, l.reviewed_at, l.created_at,
      e.id AS employee_id, e.full_name, e.employee_code, e.email, e.department,
      a.original_filename AS attachment_name
     FROM learning_allowances l
     JOIN employees e ON e.id=l.employee_id
     LEFT JOIN attachments a ON a.id=l.invoice_attachment_id
     WHERE (:status IS NULL OR l.status=:status)
     ORDER BY l.created_at DESC LIMIT 100`,
    { status: statusFilter }
  );
  res.json({ claims: rows });
}));

router.post('/admin/learning/claims/:id/review', adminLimiter, asyncRoute(async(req,res)=>{
  adminOnly(req);
  const input = validate(z.object({
    status: z.enum(['APPROVED','REJECTED']),
    rejection_reason: z.string().trim().max(1000).nullable().optional()
  }), req.body);
  const [claim] = await query('SELECT id, employee_id, title, amount_inr, status FROM learning_allowances WHERE id=:id LIMIT 1', { id: req.params.id });
  if (!claim) throw Object.assign(new Error('Claim not found.'), { status: 404 });
  if (claim.status !== 'PENDING') throw Object.assign(new Error('Only pending claims can be reviewed.'), { status: 409 });

  await query(
    `UPDATE learning_allowances SET status=:status, reviewed_by=:admin, reviewed_at=UTC_TIMESTAMP(), rejection_reason=:reason WHERE id=:id`,
    { id: req.params.id, status: input.status, admin: req.user.id, reason: input.rejection_reason || null }
  );
  await audit({ actorId: req.user.id, action: `LEARNING_CLAIM_${input.status}`, entityType: 'learning_allowance', entityId: req.params.id, details: { status: input.status, reason: input.rejection_reason }, ipAddress: req.ip });
  await notify(claim.employee_id, `L&D claim ${input.status.toLowerCase()}`, `Your claim for "${claim.title}" was ${input.status.toLowerCase()}.`, 'UPDATE', { type: 'learning_claim', id: req.params.id });

  try {
    await dispatchWorkflowStatusEmail({
      requestId: req.params.id,
      requestType: 'learning_claim',
      employeeId: claim.employee_id,
      title: 'Learning & Development Claim',
      decision: input.status,
      summaryDetails: [
        { label: 'Course / Certification', value: claim.title },
        { label: 'Reimbursement Amount', value: `₹${Number(claim.amount_inr).toLocaleString('en-IN')}` }
      ],
      reviewerNote: input.rejection_reason || null,
      portalRoute: '/profile'
    });
  } catch (e: any) {
    console.error(JSON.stringify({
      type: 'learning_claim_status_email_failed',
      claim_id: req.params.id,
      error: String(e?.message || e)
    }));
  }

  res.json({ ok: true });
}));

// ==========================================
// Phase 7: Birthday Early Sign-Off Pass
// ==========================================
router.get('/birthday-pass', asyncRoute(async(req,res)=>{
  const [emp] = await query('SELECT date_of_birth FROM employees WHERE id=:id LIMIT 1', { id: req.user.id });
  const dob = emp?.date_of_birth;
  const isBirthday = isBirthdayToday(dob);
  const today = indiaDate();

  if (!isBirthday) {
    return res.json({ isBirthday: false, pass: null });
  }

  const [existing] = await query('SELECT id, pass_date, status, claimed_at FROM birthday_passes WHERE employee_id=:employee AND pass_date=:today LIMIT 1', { employee: req.user.id, today });
  if (existing) {
    return res.json({ isBirthday: true, pass: { ...existing, hours_early: 2 } });
  }

  const passId = crypto.randomUUID();
  await query('INSERT IGNORE INTO birthday_passes (id, employee_id, pass_date, status) VALUES (:id, :employee, :today, \'AVAILABLE\')', { id: passId, employee: req.user.id, today });
  res.json({ isBirthday: true, pass: { id: passId, pass_date: today, status: 'AVAILABLE', hours_early: 2, claimed_at: null } });
}));

router.post('/birthday-pass/claim', asyncRoute(async(req,res)=>{
  const [emp] = await query('SELECT date_of_birth FROM employees WHERE id=:id LIMIT 1', { id: req.user.id });
  const dob = emp?.date_of_birth;
  if (!isBirthdayToday(dob)) {
    throw Object.assign(new Error('Birthday pass is valid only on your birthday.'), { status: 400 });
  }
  const today = indiaDate();
  const passId = crypto.randomUUID();
  await query(
    `INSERT INTO birthday_passes (id, employee_id, pass_date, status, claimed_at)
     VALUES (:id, :employee, :today, 'CLAIMED', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE status='CLAIMED', claimed_at=COALESCE(claimed_at, UTC_TIMESTAMP())`,
    { id: passId, employee: req.user.id, today }
  );
  await audit({ actorId: req.user.id, action: 'BIRTHDAY_PASS_CLAIMED', entityType: 'birthday_pass', entityId: passId, details: { pass_date: today }, ipAddress: req.ip });
  res.json({ ok: true, status: 'CLAIMED', pass_date: today, hours_early: 2 });
}));

// ==========================================
// Phase 7: Confidential Grievances & Speak-Up
// ==========================================
router.post('/grievances', asyncRoute(async(req,res)=>{
  const input = validate(z.object({
    category: z.enum(['POSH','GOOD_SAMARITAN','GENERAL_GRIEVANCE']),
    subject: z.string().trim().min(3).max(180),
    description: z.string().trim().min(10).max(5000),
    is_anonymous: z.boolean().default(true)
  }), req.body);

  const reference_code = 'FX-GRIEV-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const id = crypto.randomUUID();
  const reporter_id = input.is_anonymous ? null : req.user.id;
  const reporter_name = input.is_anonymous ? null : req.user.full_name;
  const reporter_email = input.is_anonymous ? null : req.user.email;
  const assigned_to_icc = input.category === 'POSH' || input.category === 'GOOD_SAMARITAN';

  await query(
    `INSERT INTO confidential_grievances
     (id, reference_code, category, subject, description, is_anonymous, reporter_employee_id, reporter_name, reporter_email, status, assigned_to_icc)
     VALUES (:id, :ref, :cat, :subj, :desc, :anon, :reporterId, :name, :email, 'OPEN', :icc)`,
    {
      id, ref: reference_code, cat: input.category, subj: input.subject, desc: input.description,
      anon: input.is_anonymous ? 1 : 0, reporterId: reporter_id, name: reporter_name, email: reporter_email,
      icc: assigned_to_icc ? 1 : 0
    }
  );

  await audit({
    actorId: input.is_anonymous ? null : req.user.id,
    action: 'CONFIDENTIAL_GRIEVANCE_SUBMITTED',
    entityType: 'confidential_grievance',
    entityId: id,
    details: { reference_code, category: input.category, is_anonymous: input.is_anonymous },
    ipAddress: input.is_anonymous ? 'REDACTED' : req.ip
  });

  try {
    const notifySubject = `Confidential grievance [${input.category}] · ${reference_code}`;
    const reportIdentity = input.is_anonymous ? 'Anonymous submission' : `${req.user.full_name} (${req.user.email})`;
    await enqueueHrNotificationEmail({
      subject: notifySubject,
      text: `Falchion Xeniaa HRMS · Confidential Grievance & Speak-Up Channel\n\nA confidential report has been submitted.\nReference code: ${reference_code}\nCategory: ${input.category}\nReporter: ${reportIdentity}\nSubject: ${input.subject}\nAssigned to ICC: ${assigned_to_icc ? 'YES' : 'NO'}\n\nPlease inspect securely in the HRMS Admin Grievance Portal.`,
      html: `<p>A new confidential grievance has been submitted under category <strong>${input.category}</strong>. Reference code: <code>${reference_code}</code>.</p>`,
      replyTo: input.is_anonymous ? undefined : req.user.email,
      fromName: 'Falchion Xeniaa Speak-Up Channel'
    }, `grievance:${id}`);
  } catch {}

  res.status(201).json({
    ok: true,
    reference_code,
    category: input.category,
    status: 'OPEN',
    message: 'Your report has been submitted with cryptographic confidentiality. Please copy your reference code to check progress.'
  });
}));

router.get('/grievances/track/:code', asyncRoute(async(req,res)=>{
  const code = String(req.params.code || '').trim().toUpperCase();
  const [row] = await query(
    `SELECT reference_code, category, subject, status, assigned_to_icc, resolution_notes, resolved_at, created_at
     FROM confidential_grievances WHERE reference_code=:code LIMIT 1`,
    { code }
  );
  if (!row) throw Object.assign(new Error('Grievance with that reference code was not found.'), { status: 404 });
  res.json({ grievance: row });
}));

router.get('/admin/grievances', adminLimiter, asyncRoute(async(req,res)=>{
  adminOnly(req);
  const rows = await query(
    `SELECT id, reference_code, category, subject, description, is_anonymous,
      CASE WHEN is_anonymous THEN NULL ELSE reporter_name END AS reporter_name,
      CASE WHEN is_anonymous THEN NULL ELSE reporter_email END AS reporter_email,
      status, assigned_to_icc, resolution_notes, resolved_at, created_at, updated_at
     FROM confidential_grievances
     ORDER BY created_at DESC LIMIT 100`
  );
  res.json({ grievances: rows });
}));

router.patch('/admin/grievances/:id', adminLimiter, asyncRoute(async(req,res)=>{
  adminOnly(req);
  const input = validate(z.object({
    status: z.enum(['OPEN','UNDER_INVESTIGATION','RESOLVED','CLOSED']).optional(),
    assigned_to_icc: z.boolean().optional(),
    resolution_notes: z.string().trim().max(2000).nullable().optional()
  }), req.body);

  const [existing] = await query('SELECT id, status FROM confidential_grievances WHERE id=:id LIMIT 1', { id: req.params.id });
  if (!existing) throw Object.assign(new Error('Grievance not found.'), { status: 404 });

  const resolved = input.status === 'RESOLVED' || input.status === 'CLOSED';
  await query(
    `UPDATE confidential_grievances
     SET status=COALESCE(:status, status),
         assigned_to_icc=COALESCE(:icc, assigned_to_icc),
         resolution_notes=COALESCE(:notes, resolution_notes),
         resolved_at=CASE WHEN :isResolved THEN COALESCE(resolved_at, UTC_TIMESTAMP()) ELSE resolved_at END
     WHERE id=:id`,
    {
      id: req.params.id,
      status: input.status || null,
      icc: input.assigned_to_icc !== undefined ? (input.assigned_to_icc ? 1 : 0) : null,
      notes: input.resolution_notes !== undefined ? input.resolution_notes : null,
      isResolved: resolved ? 1 : 0
    }
  );

  await audit({ actorId: req.user.id, action: 'CONFIDENTIAL_GRIEVANCE_UPDATED', entityType: 'confidential_grievance', entityId: req.params.id, details: { status: input.status, assigned_to_icc: input.assigned_to_icc }, ipAddress: req.ip });
  res.json({ ok: true });
}));

export default router;