import crypto from 'node:crypto';
import { query, transaction } from './db.mts';
import { getHrNotificationEmail, sendEmail, smtpConfigured, type EmailMessage } from './mailer.mts';

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 8;
export const EMAIL_OUTBOX_BATCH_SIZE = 10;
export const EMAIL_OUTBOX_LEASE_SECONDS = 120;
export const EMAIL_OUTBOX_MAX_BACKOFF_MS = 15 * 60 * 1000;

export function retryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(EMAIL_OUTBOX_MAX_ATTEMPTS, Math.floor(Number(attempt) || 1)));
  return Math.min(30_000 * (2 ** (safeAttempt - 1)), EMAIL_OUTBOX_MAX_BACKOFF_MS);
}

function safeError(error: unknown): string {
  return String((error as any)?.message || error || 'Unknown email delivery failure')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(password|authorization|token)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]')
    .slice(0, 1000);
}

function messageIdFor(id: string): string {
  return '<' + id + '@hrms.fxcoworks.com>';
}

export async function enqueueEmail(message: EmailMessage, dedupeKey: string) {
  const key = String(dedupeKey || '').trim();
  if (!key || key.length > 191) throw Object.assign(new Error('A stable email outbox deduplication key is required.'), { status:400 });
  const recipients = [...new Set((message.to || []).map((recipient) => String(recipient).trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { queued:false, skipped:true, id:null, status:'SKIPPED', recipientCount:0 };
  if (!message.subject?.trim() || typeof message.text !== 'string' || typeof message.html !== 'string') {
    throw Object.assign(new Error('Email subject and bodies are required for durable enqueueing.'), { status:400 });
  }
  const candidateId = crypto.randomUUID();
  await query(\`INSERT INTO email_outbox
    (id,dedupe_key,recipients_json,subject,text_body,html_body,reply_to,from_name,status,attempts,max_attempts,available_at)
    VALUES (:id,:dedupeKey,:recipients,:subject,:text,:html,:replyTo,:fromName,'PENDING',0,:maxAttempts,UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE dedupe_key=VALUES(dedupe_key)\`, {
    id:candidateId, dedupeKey:key, recipients:JSON.stringify(recipients), subject:message.subject.slice(0,255),
    text:message.text, html:message.html, replyTo:message.replyTo || null,
    fromName:message.fromName ? String(message.fromName).slice(0,120) : null,
    maxAttempts:EMAIL_OUTBOX_MAX_ATTEMPTS
  });
  const rows = await query('SELECT id,status,attempts FROM email_outbox WHERE dedupe_key=:dedupeKey LIMIT 1', {dedupeKey:key});
  if (!rows[0]) throw new Error('The email outbox entry could not be verified after enqueueing.');
  return {queued:true, skipped:false, id:String(rows[0].id), status:String(rows[0].status), attempts:Number(rows[0].attempts || 0), recipientCount:recipients.length};
}

export async function enqueueHrNotificationEmail(message: Omit<EmailMessage,'to'>, dedupeKey: string) {
  const recipient = getHrNotificationEmail();
  if (!recipient) return {queued:false, skipped:true, id:null, status:'SKIPPED', recipient:null, recipients:0};
  const result = await enqueueEmail({...message,to:[recipient]},dedupeKey);
  return {...result, configured:smtpConfigured(), recipient, recipients:result.recipientCount};
}

type ClaimedMessage = {
  id:string;
  dedupe_key:string;
  recipients_json:string | string[];
  subject:string;
  text_body:string;
  html_body:string;
  reply_to:string | null;
  from_name:string | null;
  attempts:number;
  lock_token:string;
};

async function claimBatch(batchSize: number): Promise<ClaimedMessage[]> {
  const size=Math.max(1,Math.min(EMAIL_OUTBOX_BATCH_SIZE,Math.floor(batchSize || EMAIL_OUTBOX_BATCH_SIZE)));
  return transaction(async (connection) => {
    await connection.execute(\`UPDATE email_outbox
      SET status=IF(attempts>=max_attempts,'FAILED','PENDING'),lock_token=NULL,locked_at=NULL,lease_until=NULL,
          available_at=IF(attempts>=max_attempts,available_at,UTC_TIMESTAMP(3)),
          last_error=IF(attempts>=max_attempts,COALESCE(last_error,'Delivery lease expired after the final attempt'),last_error)
      WHERE status='PROCESSING' AND lease_until<UTC_TIMESTAMP(3)\`);
    const [rows] = await connection.execute(\`SELECT id,dedupe_key,recipients_json,subject,text_body,html_body,reply_to,from_name,attempts
      FROM email_outbox
      WHERE status='PENDING' AND available_at<=UTC_TIMESTAMP(3) AND attempts<max_attempts
      ORDER BY available_at,created_at
      LIMIT :limit FOR UPDATE SKIP LOCKED\`, {limit:size});
    const claimed:ClaimedMessage[]=[];
    for (const row of rows as any[]) {
      const token=crypto.randomUUID();
      const [update] = await connection.execute(\`UPDATE email_outbox
        SET status='PROCESSING',attempts=attempts+1,lock_token=:token,locked_at=UTC_TIMESTAMP(3),
            lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL :lease SECOND),updated_at=UTC_TIMESTAMP(3)
        WHERE id=:id AND status='PENDING'\`, {token,lease:EMAIL_OUTBOX_LEASE_SECONDS,id:row.id});
      if (Number(update.affectedRows)!==1) continue;
      claimed.push({...row,attempts:Number(row.attempts)+1,lock_token:token} as ClaimedMessage);
    }
    return claimed;
  });
}

export async function processEmailOutboxBatch(options: {batchSize?:number; send?:typeof sendEmail} = {}) {
  const batchSize=options.batchSize ?? EMAIL_OUTBOX_BATCH_SIZE;
  const sender=options.send || sendEmail;
  const jobs=await claimBatch(batchSize);
  const summary={claimed:jobs.length,sent:0,retried:0,failed:0,lostLease:0};
  for (const job of jobs) {
    try {
      let recipients:string[];
      try { recipients=Array.isArray(job.recipients_json)?job.recipients_json:JSON.parse(job.recipients_json); }
      catch { throw new Error('Outbox recipient data is invalid.'); }
      const result=await sender({
        to:recipients,subject:job.subject,text:job.text_body,html:job.html_body,
        replyTo:job.reply_to,fromName:job.from_name,messageId:messageIdFor(job.id)
      });
      if (result.skipped || !result.sent) throw new Error('SMTP delivery is not configured or did not confirm message acceptance.');
      const resultRows=await query(\`UPDATE email_outbox SET status='SENT',sent_at=UTC_TIMESTAMP(3),last_error=NULL,
        lock_token=NULL,locked_at=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3)
        WHERE id=:id AND status='PROCESSING' AND lock_token=:token\`,{id:job.id,token:job.lock_token});
      if(Number(resultRows.affectedRows)===1) summary.sent+=1;
      else summary.lostLease+=1;
    } catch(error) {
      const lastError=safeError(error);
      const terminal=job.attempts>=EMAIL_OUTBOX_MAX_ATTEMPTS;
      const availableAt=new Date(Date.now()+(terminal?0:retryBackoffMs(job.attempts)));
      const updated=await query(\`UPDATE email_outbox SET
        status=:status,available_at=:availableAt,last_error=:lastError,lock_token=NULL,locked_at=NULL,lease_until=NULL,
        updated_at=UTC_TIMESTAMP(3)
        WHERE id=:id AND status='PROCESSING' AND lock_token=:token\`,{
          status:terminal?'FAILED':'PENDING',availableAt,lastError,id:job.id,token:job.lock_token
        });
      if(Number(updated.affectedRows)===1) {
        if(terminal) summary.failed+=1;
        else summary.retried+=1;
      } else summary.lostLease+=1;
      console.warn(JSON.stringify({type:'email_outbox_delivery_failed',outbox_id:job.id,attempt:job.attempts,terminal,error:lastError}));
    }
  }
  return summary;
}

export async function getEmailOutboxSummary() {
  const rows=await query(\`SELECT status,COUNT(*) AS total,MIN(created_at) AS oldest_created_at
    FROM email_outbox GROUP BY status\`);
  const counts={PENDING:0,PROCESSING:0,SENT:0,FAILED:0};
  for(const row of rows) if(Object.prototype.hasOwnProperty.call(counts,String(row.status))) counts[row.status]=Number(row.total||0);
  return counts;
}

export async function retryFailedEmail(outboxId:string) {
  const result=await query(\`UPDATE email_outbox SET status='PENDING',attempts=0,available_at=UTC_TIMESTAMP(3),
    last_error=NULL,lock_token=NULL,locked_at=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3)
    WHERE id=:id AND status='FAILED'\`,{id:outboxId});
  return Number(result.affectedRows)===1;
}
