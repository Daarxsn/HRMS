import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { errorHandler } from './validate.js';
import authRoutes from './routes/auth.js';
import attendanceRoutes from './routes/attendance.js';
import leaveRoutes from './routes/leave.js';
import workplaceRoutes from './routes/workplace.js';
import adminRoutes from './routes/admin.js';
import accountRoutes from './routes/account.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
if(process.env.NODE_ENV==='production'&&(!process.env.JWT_SECRET||Buffer.byteLength(process.env.JWT_SECRET)<32))throw new Error('Set a private JWT_SECRET of at least 32 bytes in production.');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
const allowedOrigins = new Set((process.env.APP_ORIGIN || 'http://localhost:5173').split(',').map((x)=>x.trim()).filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null,true);
    return callback(null,false);
  },
  credentials:true
}));
app.use((req,res,next)=>{
  const supplied=req.get('X-Request-ID');
  const requestId=supplied&&/^[A-Za-z0-9._:-]{1,100}$/.test(supplied)?supplied:crypto.randomUUID();
  req.requestId=requestId;
  res.setHeader('X-Request-ID',requestId);
  const started=process.hrtime.bigint();
  res.on('finish',()=>{
    const durationMs=Number(process.hrtime.bigint()-started)/1e6;
    console.log(JSON.stringify({type:'http_request',request_id:requestId,method:req.method,path:req.path,status:res.statusCode,duration_ms:Number(durationMs.toFixed(2))}));
  });
  next();
});
app.use('/api',rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:true,legacyHeaders:false}));
app.use('/api',(req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  const origin=req.get('Origin');
  if(origin&&!allowedOrigins.has(origin))return res.status(403).json({error:'This request did not come from the Falchion Xeniaa portal.'});
  next();
});
app.use(express.json({ limit:'100kb', strict:true }));
app.use(cookieParser());
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:true,legacyHeaders:false}));
const healthPayload=(res,payload,status=200)=>{res.setHeader('Cache-Control','no-store');res.status(status).json(payload);};
app.get('/api/health/live',(req,res)=>healthPayload(res,{status:'ok',service:'falchion-xeniaa-api'}));
app.get('/api/health/ready',async(req,res)=>{
  try { await pool.query('SELECT 1'); healthPayload(res,{status:'ok',service:'falchion-xeniaa-api',database:'ok'}); }
  catch { healthPayload(res,{status:'unavailable',service:'falchion-xeniaa-api',database:'unavailable'},503); }
});
app.get('/api/health',async(req,res)=>{
  try { await pool.query('SELECT 1'); healthPayload(res,{status:'ok',service:'falchion-xeniaa-api'}); }
  catch { healthPayload(res,{status:'unavailable',service:'falchion-xeniaa-api'},503); }
});
app.use('/api/auth',authRoutes);
app.use('/api/attendance',attendanceRoutes);
app.use('/api/leave',leaveRoutes);
app.use('/api',workplaceRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/account',accountRoutes);
app.use((req,res)=>res.status(404).json({error:'That API route was not found.',requestId:req.requestId}));
app.use(errorHandler);

const port=Number(process.env.PORT || 8080);
const server=app.listen(port,()=>console.log(`Falchion Xeniaa API listening on ${port}`));
let shuttingDown=false;
const stop=async(signal)=>{
  if(shuttingDown)return;
  shuttingDown=true;
  console.log(JSON.stringify({type:'server_shutdown',signal}));
  const force=setTimeout(()=>process.exit(1),10000);
  force.unref();
  server.close(async()=>{
    try { await pool.end(); clearTimeout(force); process.exit(0); }
    catch(error){ console.error(JSON.stringify({type:'server_shutdown_error',error:String(error?.message||error)})); process.exit(1); }
  });
};
process.on('SIGTERM',()=>stop('SIGTERM')); process.on('SIGINT',()=>stop('SIGINT'));
