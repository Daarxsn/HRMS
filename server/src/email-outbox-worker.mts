import 'dotenv/config';
import { pool } from './db.mts';
import { processEmailOutboxBatch } from './email-outbox.mts';

const pollMs=Number(process.env.EMAIL_OUTBOX_POLL_MS||5000);
if(!Number.isInteger(pollMs)||pollMs<1000||pollMs>60000)throw new Error('EMAIL_OUTBOX_POLL_MS must be between 1000 and 60000.');
if(process.env.EMAIL_OUTBOX_WORKER_ENABLED!=='true')throw new Error('Set EMAIL_OUTBOX_WORKER_ENABLED=true before starting the persistent email worker.');

let stopping=false;
let active=false;
const delay=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));

async function shutdown(signal:string){
  if(stopping)return;
  stopping=true;
  console.log(JSON.stringify({type:'email_outbox_worker_shutdown',signal}));
  const deadline=Date.now()+10_000;
  while(active&&Date.now()<deadline)await delay(100);
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM',()=>void shutdown('SIGTERM'));
process.on('SIGINT',()=>void shutdown('SIGINT'));

console.log(JSON.stringify({type:'email_outbox_worker_started',poll_interval_ms:pollMs}));
while(!stopping){
  active=true;
  try {
    const result=await processEmailOutboxBatch();
    if(result.claimed)console.log(JSON.stringify({type:'email_outbox_batch_complete',...result}));
  } catch(error) {
    console.error(JSON.stringify({type:'email_outbox_worker_error',error:String((error as any)?.message||error)}));
  } finally {
    active=false;
  }
  if(!stopping)await delay(pollMs);
}
