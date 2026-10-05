import 'dotenv/config';
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
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null,true); callback(new Error('This website is not an allowed application origin.')); }, credentials:true }));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:true,legacyHeaders:false}));
app.use('/api',(req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  const origin=req.get('Origin');
  if(origin&&!allowedOrigins.has(origin))return res.status(403).json({error:'This request did not come from the Falchion Xeniaa portal.'});
  next();
});
app.use(express.json({ limit:'1mb' }));
app.use(cookieParser());
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:true,legacyHeaders:false}));
app.get('/api/health', async(req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',service:'falchion-xeniaa-api'}); }
  catch { res.status(503).json({status:'unavailable',service:'falchion-xeniaa-api'}); }
});
app.use('/api/auth',authRoutes);
app.use('/api/attendance',attendanceRoutes);
app.use('/api/leave',leaveRoutes);
app.use('/api',workplaceRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/account',accountRoutes);
app.use((req,res)=>res.status(404).json({error:'That API route was not found.'}));
app.use(errorHandler);

const port=Number(process.env.PORT || 8080);
const server=app.listen(port,()=>console.log(`Falchion Xeniaa API listening on ${port}`));
const stop=async()=>{server.close(async()=>{await pool.end();process.exit(0);});};
process.on('SIGTERM',stop); process.on('SIGINT',stop);
