import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import mysql from 'mysql2/promise';

const enabled=process.env.HRMS_BENCHMARK==='true' && process.env.CI==='true' && process.env.NODE_ENV!=='production';
const host=String(process.env.DB_HOST||'');
const database=String(process.env.DB_NAME||'');
if(!enabled || !['127.0.0.1','localhost','::1'].includes(host) || !/_ci$/.test(database)) {
  throw new Error('Benchmark requires HRMS_BENCHMARK=true, CI=true, and a local disposable *_ci database. Refusing non-CI or remote targets.');
}
const port=Number(process.env.DB_PORT||3306),user=String(process.env.DB_USER||''),password=String(process.env.DB_PASSWORD||'');
const poolSize=Number(process.env.BENCH_POOL_SIZE||10);
const concurrency=Number(process.env.BENCH_CONCURRENCY||32);
const iterations=Number(process.env.BENCH_ITERATIONS||120);
const p95=(values)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*.95)-1)];
const pool=mysql.createPool({host,port,user,password,database,connectionLimit:poolSize,maxIdle:poolSize,waitForConnections:true,queueLimit:Math.max(100,concurrency*2),connectTimeout:5000});
try {
  const [[before]] = await pool.query('SHOW GLOBAL STATUS LIKE "Threads_connected"').then(([rows])=>[rows]);
  const start=performance.now();
  const latencies=[];
  let next=0;
  const worker=async()=>{while(true){const n=next++;if(n>=iterations)return;const t=performance.now();await pool.execute('SELECT COUNT(*) AS total FROM employees WHERE status=?',['ACTIVE']);latencies.push(performance.now()-t);}};
  await Promise.all(Array.from({length:concurrency},worker));
  const elapsed=performance.now()-start;
  const [[connectionStatus]] = await pool.query('SHOW GLOBAL STATUS LIKE "Threads_connected"').then(([rows])=>[rows]);
  const [poolConnections]=await pool.query('SELECT 1 AS ok');
  assert.equal(poolConnections[0].ok,1);
  const report={scenario:'mysql-pool-read-contention',database,configuredPoolSize:poolSize,concurrency,iterations,elapsedMs:Math.round(elapsed),throughputPerSecond:Number((iterations/(elapsed/1000)).toFixed(2)),latencyMs:{p50:Number(latencies.slice().sort((a,b)=>a-b)[Math.floor(latencies.length*.5)].toFixed(2)),p95:Number(p95(latencies).toFixed(2)),max:Number(Math.max(...latencies).toFixed(2))},globalThreadsConnectedBefore:Number(before?.Value||0),globalThreadsConnectedAfter:Number(connectionStatus?.Value||0),notes:'Synthetic read contention only; compare pool sizes against the actual provider max_connections and per-instance deployment concurrency before tuning.'};
  console.log(JSON.stringify(report,null,2));
} finally { await pool.end(); }
