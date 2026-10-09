import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../db.mts';
import { audit, notify, requireAuth } from '../security.mts';
import { asyncRoute, dateSchema, validate } from '../validate.mts';
import { saveObject, deleteObject, readObject } from '../object-storage.mts';

const router = Router();
router.use(requireAuth);
const adminLimiter = rateLimit({ windowMs:15*60*1000, limit:160, standardHeaders:true, legacyHeaders:false, keyGenerator:(req)=>`enterprise:${req.user.id}` });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req,file,cb) => { const allowed=['application/pdf','image/jpeg','image/png','image/webp']; cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('HR documents must be PDF, JPG, PNG, or WebP files.'),{status:400}), allowed.includes(file.mimetype)); }
});
const adminOnly = (req) => { if(req.user?.role!=='ADMIN'||req.user?.user_type!=='ADMIN') throw Object.assign(new Error('Administrator access is required.'),{status:403}); };
const signatureOk = (buffer,contentType) => {
  if(contentType==='application/pdf') return buffer.subarray(0,4).equals(Buffer.from('%PDF'));
  if(contentType==='image/jpeg') return buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]));
  if(contentType==='image/png') return buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(contentType==='image/webp') return buffer.subarray(0,4).equals(Buffer.from('RIFF')) && buffer.subarray(8,12).equals(Buffer.from('WEBP'));
  return false;
};
const safeFilename = (value) => value.replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,180) || 'document';
const progress = (tasks) => { const total=tasks.length; const completed=tasks.filter((t)=>t.status==='COMPLETED').length; return {total,completed,percent:total?Math.round(completed*100/total):0}; };

router.get('/policies', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT p.id,p.title,p.category,p.version,p.body,p.status,p.published_at,CASE WHEN a.id IS NULL THEN 0 ELSE 1 END acknowledged FROM company_policies p LEFT JOIN policy_acknowledgements a ON a.policy_id=p.id AND a.employee_id=:employee WHERE p.status='PUBLISHED' ORDER BY p.published_at DESC,p.created_at DESC`,{employee:req.user.id});
  res.json({policies:rows});
}));
router.post('/policies/:id/acknowledge', asyncRoute(async(req,res)=>{
  const rows=await query('SELECT id,title FROM company_policies WHERE id=:id AND status=\'PUBLISHED\' LIMIT 1',{id:req.params.id});
  if(!rows[0]) throw Object.assign(new Error('Policy not found or not published.'),{status:404});
  await query(`INSERT INTO policy_acknowledgements (id,policy_id,employee_id,acknowledged_at,ip_address) VALUES (:id,:policy,:employee,UTC_TIMESTAMP(),:ip) ON DUPLICATE KEY UPDATE acknowledged_at=VALUES(acknowledged_at),ip_address=VALUES(ip_address)`,{id:crypto.randomUUID(),policy:req.params.id,employee:req.user.id,ip:req.ip});
  await audit({actorId:req.user.id,action:'POLICY_ACKNOWLEDGED',entityType:'company_policy',entityId:req.params.id,details:{title:rows[0].title},ipAddress:req.ip});
  res.json({ok:true});
}));

router.get('/admin/overview',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req);
  const [headcount,departments,attendance,leave,onboarding,assets,policies,separations,upcoming,missingDocs]=await Promise.all([
    query(`SELECT COUNT(*) total,SUM(status='ACTIVE') active,SUM(role='ADMIN' AND status='ACTIVE') admins FROM employees`),
    query(`SELECT COALESCE(NULLIF(department,''),'Unassigned') department,COUNT(*) total FROM employees WHERE status='ACTIVE' GROUP BY COALESCE(NULLIF(department,''),'Unassigned') ORDER BY total DESC,department LIMIT 12`),
    query(`SELECT COUNT(DISTINCT employee_id) present,SUM(status='LATE_ENTRY') late,SUM(status='ABSENT') absent FROM attendance_records WHERE attendance_date BETWEEN DATE_SUB(CURDATE(),INTERVAL 29 DAY) AND CURDATE()`),
    query(`SELECT leave_type,SUM(CASE WHEN status='APPROVED' THEN days ELSE 0 END) approved,SUM(CASE WHEN status='PENDING' THEN days ELSE 0 END) pending FROM leave_requests WHERE start_date>=DATE_FORMAT(CURDATE(),'%Y-01-01') GROUP BY leave_type ORDER BY leave_type`),
    query(`SELECT status,COUNT(*) total FROM onboarding_tasks GROUP BY status`),
    query(`SELECT status,COUNT(*) total FROM company_assets GROUP BY status`),
    query(`SELECT p.id,p.title,p.category,p.version,p.status,p.published_at,(SELECT COUNT(*) FROM employees e WHERE e.status='ACTIVE' AND e.role='EMPLOYEE') active_people,(SELECT COUNT(*) FROM policy_acknowledgements a WHERE a.policy_id=p.id) acknowledgements FROM company_policies p ORDER BY p.updated_at DESC LIMIT 12`),
    query(`SELECT s.id,s.employee_id,s.separation_type,s.last_working_date,s.status,e.full_name,e.employee_code FROM separation_cases s JOIN employees e ON e.id=s.employee_id WHERE s.status IN ('OPEN','IN_PROGRESS') ORDER BY s.last_working_date ASC LIMIT 10`),
    query(`SELECT id,full_name,employee_code,joined_on,probation_end_date FROM employees WHERE status='ACTIVE' AND probation_end_date IS NOT NULL AND probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 60 DAY) ORDER BY probation_end_date LIMIT 12`),
    query(`SELECT e.id,e.full_name,e.employee_code FROM employees e LEFT JOIN employee_documents d ON d.employee_id=e.id AND d.status IN ('ACTIVE','EXPIRING') WHERE e.status='ACTIVE' GROUP BY e.id HAVING COUNT(d.id)=0 ORDER BY e.full_name LIMIT 20`)
  ]);
  const onboardingSummary=onboarding.reduce((a,r)=>{a[r.status]=Number(r.total);return a;},{});
  const assetSummary=assets.reduce((a,r)=>{a[r.status]=Number(r.total);return a;},{});
  const policySummary=policies.map((p)=>({...p,active_people:Number(p.active_people),acknowledgements:Number(p.acknowledgements),acknowledgement_percent:p.active_people?Math.round(Number(p.acknowledgements)*100/Number(p.active_people)):0}));
  res.json({headcount:{total:Number(headcount[0]?.total||0),active:Number(headcount[0]?.active||0),admins:Number(headcount[0]?.admins||0)},departments:departments.map((x)=>({...x,total:Number(x.total)})),attendance30d:{present:Number(attendance[0]?.present||0),late:Number(attendance[0]?.late||0),absent:Number(attendance[0]?.absent||0)},leave:leave.map((x)=>({...x,approved:Number(x.approved||0),pending:Number(x.pending||0)})),onboarding:{summary:onboardingSummary,progressPercent:progress(onboarding).percent},assets:assetSummary,policies:policySummary,separations,upcomingProbation:upcoming,missingDocuments:missingDocs});
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
  const id=crypto.randomUUID(); await query('INSERT INTO onboarding_tasks (id,employee_id,title,category,due_date,notes,created_by) VALUES (:id,:employee,:title,:category,:dueDate,:notes,:admin)',{id,employee:req.params.id,title:input.title,category:input.category,dueDate:input.dueDate||null,notes:input.notes||null,admin:req.user.id});
  await audit({actorId:req.user.id,action:'ONBOARDING_TASK_CREATED',entityType:'onboarding_task',entityId:id,details:{employee_id:req.params.id,title:input.title},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));
router.patch('/admin/onboarding/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const input=validate(z.object({status:z.enum(['PENDING','IN_PROGRESS','COMPLETED','BLOCKED']),notes:z.string().trim().max(1000).nullable().optional()}),req.body);
  const rows=await query('SELECT id FROM onboarding_tasks WHERE id=:id LIMIT 1',{id:req.params.id}); if(!rows[0]) throw Object.assign(new Error('Onboarding task not found.'),{status:404});
  if(input.status==='COMPLETED') await query('UPDATE onboarding_tasks SET status=:status,notes=:notes,completed_at=UTC_TIMESTAMP(),completed_by=:admin WHERE id=:id',{status:input.status,notes:input.notes||null,admin:req.user.id,id:req.params.id});
  else await query('UPDATE onboarding_tasks SET status=:status,notes=:notes,completed_at=NULL,completed_by=NULL WHERE id=:id',{status:input.status,notes:input.notes||null,id:req.params.id});
  await audit({actorId:req.user.id,action:'ONBOARDING_TASK_UPDATED',entityType:'onboarding_task',entityId:req.params.id,details:{status:input.status},ipAddress:req.ip}); res.json({ok:true});
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
  const employee=await query('SELECT id FROM employees WHERE id=:id LIMIT 1',{id:req.params.id}); if(!employee[0]) throw Object.assign(new Error('Employee not found.'),{status:404});
  const id=crypto.randomUUID(); const key=req.params.id+'/hr-documents/'+id+'-'+safeFilename(req.file.originalname); await saveObject(key,req.file.buffer,req.file.mimetype);
  try { await query('INSERT INTO employee_documents (id,employee_id,document_type,title,description,object_key,original_filename,content_type,size_bytes,issued_on,expires_on,uploaded_by) VALUES (:id,:employee,:type,:title,:description,:key,:filename,:contentType,:size,:issuedOn,:expiresOn,:admin)',{id,employee:req.params.id,type:input.documentType,title:input.title,description:input.description||null,key,filename:req.file.originalname.slice(0,255),contentType:req.file.mimetype,size:req.file.size,issuedOn:input.issuedOn||null,expiresOn:input.expiresOn||null,admin:req.user.id}); } catch(error) { await deleteObject(key); throw error; }
  await audit({actorId:req.user.id,action:'HR_DOCUMENT_UPLOADED',entityType:'employee_document',entityId:id,details:{employee_id:req.params.id,document_type:input.documentType},ipAddress:req.ip}); res.status(201).json({ok:true,id});
}));
router.get('/admin/documents/:id',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const rows=await query('SELECT object_key,original_filename,content_type FROM employee_documents WHERE id=:id LIMIT 1',{id:req.params.id}); if(!rows[0]?.object_key) return res.status(404).end();
  const file=await readObject(rows[0].object_key); res.setHeader('Content-Type',rows[0].content_type||file.contentType||'application/octet-stream'); res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(rows[0].original_filename||'document')}`); res.setHeader('Cache-Control','private, no-store');
  if(file.kind==='buffer') res.send(file.buffer); else file.stream.pipe(res);
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
  const status=input.status||(assigned?'ASSIGNED':'AVAILABLE'); const assignedChanged=assigned && !rows[0].assigned_employee_id; const returnedChanged=!assigned && rows[0].assigned_employee_id;
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
  const sets=[]; const values=[]; const fields={title:['title',input.title],category:['category',input.category],version:['version',input.version],body:['body',input.body],status:['status',input.status]};
  for(const [,pair] of Object.entries(fields)){const column=pair[0],value=pair[1]; if(value!==undefined){sets.push(column+'=?');values.push(value);}}
  if(input.status==='PUBLISHED') sets.push('published_at=COALESCE(published_at,UTC_TIMESTAMP())');
  if(input.status==='DRAFT'||input.status==='ARCHIVED') sets.push('published_at=NULL');
  values.push(req.params.id); const result=await query('UPDATE company_policies SET '+sets.join(',')+' WHERE id=?',values); if(!result.affectedRows) throw Object.assign(new Error('Policy not found.'),{status:404});
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
  const result=await query('UPDATE separation_cases SET status=:status,notes=COALESCE(:notes,notes),completed_at=CASE WHEN :status=\'COMPLETED\' THEN UTC_TIMESTAMP() ELSE NULL END WHERE id=:id',{status:input.status,notes:input.notes===undefined?null:input.notes,id:req.params.id}); if(!result.affectedRows) throw Object.assign(new Error('Separation case not found.'),{status:404});
  await audit({actorId:req.user.id,action:'SEPARATION_UPDATED',entityType:'separation_case',entityId:req.params.id,details:{status:input.status},ipAddress:req.ip}); res.json({ok:true});
}));

router.get('/admin/security',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const [people,admins,recent]=await Promise.all([query('SELECT COUNT(*) total,SUM(status=\'ACTIVE\') active,SUM(status=\'INACTIVE\') inactive FROM employees'),query("SELECT COUNT(*) total FROM employees WHERE role='ADMIN' AND status='ACTIVE'"),query("SELECT action,COUNT(*) total,MAX(created_at) last_at FROM audit_logs WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY) GROUP BY action ORDER BY total DESC LIMIT 12")]);
  res.json({accountSummary:{total:Number(people[0]?.total||0),active:Number(people[0]?.active||0),inactive:Number(people[0]?.inactive||0),activeAdmins:Number(admins[0]?.total||0)},recentActions:recent.map((x)=>({...x,total:Number(x.total)}))});
}));
router.post('/admin/security/revoke/:employeeId',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); if(req.params.employeeId===req.user.id) throw Object.assign(new Error('Use sign out instead of revoking your own current session.'),{status:400});
  const result=await query('UPDATE employees SET session_version=session_version+1 WHERE id=:id AND status=\'ACTIVE\'',{id:req.params.employeeId}); if(!result.affectedRows) throw Object.assign(new Error('Active employee not found.'),{status:404});
  await audit({actorId:req.user.id,action:'SESSION_REVOKED',entityType:'employee',entityId:req.params.employeeId,details:{reason:'administrator_revocation'},ipAddress:req.ip}); res.json({ok:true});
}));
router.get('/admin/readiness',adminLimiter,asyncRoute(async(req,res)=>{
  adminOnly(req); const checks=[]; const add=(key,status,detail)=>checks.push({key,status,detail});
  const checksMap=[['database','SELECT 1','Database is reachable.'],['employee_directory','SELECT COUNT(*) total FROM employees','Employee directory is queryable.'],['audit_trail','SELECT COUNT(*) total FROM audit_logs','Audit log is queryable.'],['hr_documents','SELECT COUNT(*) total FROM employee_documents','HR document storage metadata is queryable.'],['policy_center','SELECT COUNT(*) total FROM company_policies','Policy center is queryable.'],['asset_register','SELECT COUNT(*) total FROM company_assets','Asset register is queryable.']];
  for(const item of checksMap){try{await query(item[1]);add(item[0],'PASS',item[2]);}catch{add(item[0],'FAIL',item[2].replace('is queryable','is unavailable').replace('is reachable','connectivity check failed.'));}}
  res.json({status:checks.every((x)=>x.status==='PASS')?'READY':'DEGRADED',checks,checkedAt:new Date().toISOString()});
}));

export default router;