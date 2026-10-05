import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { audit, requireAuth } from '../security.js';
import { asyncRoute, validate } from '../validate.js';

const router = Router();
router.use(requireAuth);
router.get('/profile', asyncRoute(async (req,res)=>{
  const managers=await query(`SELECT full_name FROM employees WHERE id=(SELECT reporting_manager_id FROM employees WHERE id=:id)`,{id:req.user.id});
  res.json({profile:{...req.user,manager:managers[0]?.full_name || null}});
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
