import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.ts';
import { errorHandler } from './validate.ts';
import authRoutes from './routes/auth.ts';
import attendanceRoutes from './routes/attendance.ts';
import leaveRoutes from './routes/leave.ts';
import workplaceRoutes from './routes/workplace.ts';
import adminRoutes from './routes/admin.ts';
import accountRoutes from './routes/account.ts';

const app = express();
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const BUILD_SHA = process.env.BUILD_SHA || 'development';
const startedAt = Date.now();
const logProcessFailure = (type: string, error: unknown) => {
  console.error(JSON.stringify({ type, error: String((error as any)?.stack || (error as any)?.message || error) }));
};
process.on('uncaughtException', (error) => logProcessFailure('uncaught_exception', error));
process.on('unhandledRejection', (error) => logProcessFailure('unhandled_rejection', error));
app.disable('x-powered-by');
app.set('trust proxy', 1);
if(process.env.NODE_ENV==='production'){if(!process.env.JWT_SECRET||Buffer.byteLength(process.env.JWT_SECRET)<32)throw new Error('Set a private JWT_SECRET of at least 32 bytes in production.');if(!process.env.APP_ORIGIN)throw new Error('Set APP_ORIGIN to the exact production portal origin.');if(!process.env.GOOGLE_CLIENT_ID)throw new Error('Set GOOGLE_CLIENT_ID in production.');}
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
const allowedOrigins = new Set((process.env.APP_ORIGIN || 'http://localhost:3000').split(',').map((x)=>x.trim()).filter(Boolean));
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
app.get('/api/health/live',(req,res)=>healthPayload(res,{status:'ok',service:'falchion-xeniaa-api',version:APP_VERSION,build:BUILD_SHA,uptime_seconds:Math.floor((Date.now()-startedAt)/1000)}));
app.get('/api/health/ready',async(req,res)=>{
  try { await pool.query('SELECT 1'); healthPayload(res,{status:'ok',service:'falchion-xeniaa-api',version:APP_VERSION,build:BUILD_SHA,database:'ok',uptime_seconds:Math.floor((Date.now()-startedAt)/1000)}); }
  catch { healthPayload(res,{status:'unavailable',service:'falchion-xeniaa-api',version:APP_VERSION,build:BUILD_SHA,database:'unavailable'},503); }
});
app.get('/api/health',async(req,res)=>{
  try { await pool.query('SELECT 1'); healthPayload(res,{status:'ok',service:'falchion-xeniaa-api',version:APP_VERSION,build:BUILD_SHA,database:'ok',uptime_seconds:Math.floor((Date.now()-startedAt)/1000)}); }
  catch { healthPayload(res,{status:'unavailable',service:'falchion-xeniaa-api',version:APP_VERSION,build:BUILD_SHA,database:'unavailable'},503); }
});
app.use('/api/auth',authRoutes);
app.use('/api/attendance',attendanceRoutes);
app.use('/api/leave',leaveRoutes);
app.use('/api',workplaceRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/account',accountRoutes);
app.use((req,res)=>res.status(404).json({error:'That API route was not found.',requestId:req.requestId}));
app.use(errorHandler);

export default app;

// Vercel imports the Express application as a function. Local development and
// container deployments retain the listener and graceful shutdown behavior.
if (process.env.VERCEL !== '1') {
  const port=Number(process.env.PORT || 8080);
  const server=app.listen(port,()=>console.log(JSON.stringify({type:'server_started',service:'falchion-xeniaa-api',port,node_env:process.env.NODE_ENV||'development'})));
  server.requestTimeout=30000;
  server.headersTimeout=35000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;
  let shuttingDown=false;
  const stop=async(signal)=>{
    if(shuttingDown)return;
    shuttingDown=true;
    console.log(JSON.stringify({type:'server_shutdown',signal}));
    const force=setTimeout(()=>process.exit(1),10000);
    (force as any).unref?.();
    server.close(async()=>{
      try { await pool.end(); clearTimeout(force); process.exit(0); }
      catch(error){ console.error(JSON.stringify({type:'server_shutdown_error',error:String(error?.message||error)})); process.exit(1); }
    });
  };
  process.on('SIGTERM',()=>stop('SIGTERM')); process.on('SIGINT',()=>stop('SIGINT'));
}
