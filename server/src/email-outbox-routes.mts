import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { processEmailOutboxBatch } from './email-outbox.mts';

const router=Router();
const limiter=rateLimit({windowMs:60_000,limit:6,standardHeaders:true,legacyHeaders:false});

function secretMatches(req):boolean {
  const secret=String(process.env.EMAIL_OUTBOX_CRON_SECRET||'');
  const authorization=String(req.get('Authorization')||'');
  if(secret.length<32||!authorization.startsWith('Bearer '))return false;
  const supplied=Buffer.from(authorization.slice(7));
  const expected=Buffer.from(secret);
  return supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
}

router.post('/',limiter,async(req,res,next)=>{
  if(!secretMatches(req))return res.status(401).json({error:'Outbox worker authorization failed.'});
  try {
    const result=await processEmailOutboxBatch({batchSize:10});
    res.setHeader('Cache-Control','no-store');
    return res.json({ok:true,...result,processedAt:new Date().toISOString()});
  } catch(error) {
    console.error(JSON.stringify({type:'email_outbox_batch_failed',request_id:req.requestId,error:String((error as any)?.message||error)}));
    return next(Object.assign(new Error('The email outbox worker could not complete this batch.'),{status:503}));
  }
});

export default router;
