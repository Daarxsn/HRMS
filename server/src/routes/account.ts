import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.ts';
import { audit, requireAuth, publicUser } from '../security.ts';
import { asyncRoute, validate } from '../validate.ts';
import { profilePhotoUpload, saveProfilePhoto, deleteProfilePhoto, readProfilePhoto, verifyImageSignature } from '../profile-photo.ts';

const router = Router();
router.use(requireAuth);

router.post('/profile/photo', profilePhotoUpload.single('photo'), asyncRoute(async (req,res)=>{
  if (!req.file) throw Object.assign(new Error('Choose a JPG, PNG, or WebP profile photo up to 5 MB.'), { status:400 });
  verifyImageSignature(req.file.buffer, req.file.mimetype);
  const currentRows=await query('SELECT profile_photo_key FROM employees WHERE id=:id FOR UPDATE',{id:req.user.id});
  const current=currentRows[0];
  const saved=await saveProfilePhoto(req.user.id, req.file);
  try {
    await query('UPDATE employees SET profile_photo_key=:key, profile_photo_content_type=:type, profile_photo_filename=:filename WHERE id=:id',{
      key:saved.key,type:saved.contentType,filename:saved.filename,id:req.user.id
    });
  } catch(error) {
    await deleteProfilePhoto(saved.key);
    throw error;
  }
  await deleteProfilePhoto(current?.profile_photo_key);
  await audit({actorId:req.user.id,action:'PROFILE_PHOTO_UPDATED',entityType:'employee',entityId:req.user.id,details:{content_type:req.file.mimetype},ipAddress:req.ip});
  res.status(201).json({ok:true});
}));

router.delete('/profile/photo', asyncRoute(async (req,res)=>{
  const rows=await query('SELECT profile_photo_key FROM employees WHERE id=:id FOR UPDATE',{id:req.user.id});
  const key=rows[0]?.profile_photo_key;
  if(!key) return res.json({ok:true});
  await query('UPDATE employees SET profile_photo_key=NULL, profile_photo_content_type=NULL, profile_photo_filename=NULL WHERE id=:id',{id:req.user.id});
  await deleteProfilePhoto(key);
  await audit({actorId:req.user.id,action:'PROFILE_PHOTO_REMOVED',entityType:'employee',entityId:req.user.id,ipAddress:req.ip});
  res.json({ok:true});
}));

router.get('/profile/photo', asyncRoute(async (req,res)=>{
  const rows=await query('SELECT profile_photo_key, profile_photo_content_type, profile_photo_filename FROM employees WHERE id=:id LIMIT 1',{id:req.user.id});
  const photo=rows[0];
  if(!photo?.profile_photo_key) return res.status(404).end();
  const file=await readProfilePhoto(photo.profile_photo_key);
  res.setHeader('Content-Type',photo.profile_photo_content_type||'image/jpeg');
  res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(photo.profile_photo_filename||'profile-photo')}`);
  res.setHeader('Cache-Control','private, no-store');
  if (file.kind === 'buffer') {
    res.send(file.buffer);
  } else {
    file.stream
      .on('error', () => {
        if (!res.headersSent) res.status(404).end();
      })
      .pipe(res);
  }
}));

router.get('/profile', asyncRoute(async (req,res)=>{
  const managers=await query(`SELECT full_name FROM employees WHERE id=(SELECT reporting_manager_id FROM employees WHERE id=:id)`,{id:req.user.id});
  res.json({profile:{...publicUser(req.user),manager:managers[0]?.full_name || null}});
}));
router.patch('/profile', asyncRoute(async(req,res)=>{
  const input=validate(z.object({phone:z.string().trim().max(32).nullable().optional()}),req.body);
  if(input.phone===undefined)throw Object.assign(new Error('Update at least one profile detail.'),{status:400});
  await query('UPDATE employees SET phone=:phone WHERE id=:id',{phone:input.phone || null,id:req.user.id});
  await audit({actorId:req.user.id,action:'PROFILE_UPDATED',entityType:'employee',entityId:req.user.id,details:{fields:Object.keys(input)},ipAddress:req.ip});
  res.json({ok:true});
}));
router.get('/notifications', asyncRoute(async(req,res)=>{
  const rows=await query(`SELECT id,title,body,kind,entity_json,read_at,created_at FROM notifications WHERE employee_id=:employee ORDER BY created_at DESC LIMIT 50`,{employee:req.user.id});
  res.json({notifications:rows.map((r)=>({...r,entity:typeof r.entity_json==='string'?JSON.parse(r.entity_json):r.entity_json})),unread:rows.filter((r)=>!r.read_at).length});
}));
router.post('/notifications/:id/read', asyncRoute(async(req,res)=>{
  await query('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=:id AND employee_id=:employee',{id:req.params.id,employee:req.user.id});
  res.json({ok:true});
}));
router.post('/notifications/read-all', asyncRoute(async(req,res)=>{
  await query('UPDATE notifications SET read_at=UTC_TIMESTAMP() WHERE employee_id=:employee AND read_at IS NULL',{employee:req.user.id});
  res.json({ok:true});
}));
export default router;
