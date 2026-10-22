import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here=path.dirname(fileURLToPath(import.meta.url));
const serverDir=path.resolve(here,'..');
const migrationsDir=path.join(serverDir,'migrations');
const host=String(process.env.DB_HOST||'');
const port=Number(process.env.DB_PORT||3306);
const user=String(process.env.DB_USER||'');
const password=String(process.env.DB_PASSWORD||'');
const baseName=String(process.env.DB_NAME||'');
if(process.env.CI!=='true'||process.env.HRMS_BACKUP_RESTORE_REHEARSAL!=='true'||process.env.NODE_ENV==='production'||
  !['127.0.0.1','localhost','::1'].includes(host)||!/_ci$/.test(baseName)||!user) {
  throw new Error('Backup/restore rehearsal is restricted to an explicitly enabled local CI MySQL database; production and non-CI targets are refused.');
}
const suffix=Date.now().toString(36)+'_'+process.pid.toString(36)+'_'+crypto.randomBytes(3).toString('hex');
const source=('hrms_restore_src_'+suffix).slice(0,60);
const restored=('hrms_restore_dst_'+suffix).slice(0,60);
const created=[];
const migrationFiles=(await readdir(migrationsDir)).filter(x=>x.endsWith('.sql')).sort();
const migrations=new Map();
for(const file of migrationFiles)migrations.set(file,await readFile(path.join(migrationsDir,file),'utf8'));
function connect(database) {
  return mysql.createConnection({host,port,user,password,...(database?{database}:{}),connectTimeout:10000,multipleStatements:false});
}
function run(command,args,env={}) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:120000,env:{...process.env,...env}});
  if(result.status!==0)throw new Error(command+' failed ('+result.status+'):\n'+String(result.stdout||'')+'\n'+String(result.stderr||''));
  return String(result.stdout||'');
}
function checksum(sql){return crypto.createHash('sha256').update(sql).digest('hex');}
async function createDatabase(name){
  assert.match(name,/^[a-zA-Z0-9_]+$/);
  const c=await connect(undefined);
  try{await c.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');created.push(name);}
  finally{await c.end();}
}
function sqlClientArgs(database){
  return ['--host='+host,'--port='+port,'--user='+user,'--password='+password,'--default-character-set=utf8mb4',database];
}
async function seedAndMigrate(name){
  const env={NODE_ENV:'test',DB_HOST:host,DB_PORT:String(port),DB_NAME:name,DB_USER:user,DB_PASSWORD:password};
  run(process.execPath,['--experimental-strip-types','src/migrate.ts'],env);
  const c=await connect(name);
  try{
    const employeeId=crypto.randomUUID();
    const adminId=crypto.randomUUID();
    await c.execute("INSERT INTO employees (id,employee_code,full_name,email,role,user_type,status,title,joined_on,wfh_enabled) VALUES (?,?,? ,?,'ADMIN','ADMIN','ACTIVE','Restore admin','2025-01-06',FALSE)",[adminId,'BA'+suffix.slice(-10),'Backup Restore Admin','restore-admin-'+suffix+'@example.test']);
    await c.execute("INSERT INTO employees (id,employee_code,full_name,email,role,user_type,status,title,joined_on,wfh_enabled) VALUES (?,?,?,?,'EMPLOYEE','EMPLOYEE','ACTIVE','Restore employee','2025-01-07',FALSE)",[employeeId,'BE'+suffix.slice(-10),'Backup Restore Employee','restore-employee-'+suffix+'@example.test']);
    await c.execute("INSERT INTO attendance_records (id,employee_id,attendance_date,check_in_at,check_out_at,check_in_method,check_out_method,status) VALUES (?,?, '2026-02-03','2026-02-03 03:00:00','2026-02-03 11:00:00','WFH','WFH','ON_TIME')",[crypto.randomUUID(),employeeId]);
    await c.execute("INSERT INTO leave_requests (id,employee_id,leave_type,start_date,end_date,days,reason,status) VALUES (?,?, 'CASUAL','2026-02-04','2026-02-04',1,'Backup restore fixture','REJECTED')",[crypto.randomUUID(),employeeId]);
    await c.execute("INSERT INTO wfh_requests (id,employee_id,request_date,request_kind,reason,status) VALUES (?,?, '2026-02-05','PLANNED','Backup restore fixture','REJECTED')",[crypto.randomUUID(),employeeId]);
    await c.execute("INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES (?,?, 'BACKUP_RESTORE_FIXTURE','test','fixture',JSON_OBJECT('marker',?),UTC_TIMESTAMP())",[crypto.randomUUID(),adminId,suffix]);
    return {employeeId,adminId};
  }finally{await c.end();}
}
async function snapshot(name){
  const c=await connect(name);
  try{
    const counts={};
    for(const table of ['employees','attendance_records','leave_requests','wfh_requests','audit_logs','email_outbox']){
      const [rows]=await c.query('SELECT COUNT(*) AS count FROM `'+table+'`');
      counts[table]=Number(rows[0].count);
    }
    const [ledger]=await c.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
    const [columns]=await c.query("SELECT TABLE_NAME AS t,COLUMN_NAME AS c,COLUMN_TYPE AS ty,IS_NULLABLE AS n,EXTRA AS x,GENERATION_EXPRESSION AS g FROM information_schema.columns WHERE table_schema=DATABASE() AND ((TABLE_NAME='wfh_requests' AND COLUMN_NAME='active_request_date') OR (TABLE_NAME='employment_history' AND COLUMN_NAME='created_by')) ORDER BY TABLE_NAME,COLUMN_NAME");
    const [indexes]=await c.query("SELECT TABLE_NAME AS t,INDEX_NAME AS n,NON_UNIQUE AS u,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.statistics WHERE table_schema=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE ORDER BY TABLE_NAME,INDEX_NAME");
    const [fks]=await c.query("SELECT TABLE_NAME AS t,CONSTRAINT_NAME AS n FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_type='FOREIGN KEY' ORDER BY TABLE_NAME,CONSTRAINT_NAME");
    const [marker]=await c.execute("SELECT e.id,e.employee_code,a.check_in_method,l.reason,w.status,JSON_UNQUOTE(JSON_EXTRACT(log.details_json,'$.marker')) AS marker FROM employees e JOIN attendance_records a ON a.employee_id=e.id JOIN leave_requests l ON l.employee_id=e.id JOIN wfh_requests w ON w.employee_id=e.id JOIN audit_logs log ON log.actor_id=(SELECT id FROM employees WHERE role='ADMIN' AND email LIKE 'restore-admin-%' ORDER BY created_at DESC LIMIT 1) WHERE e.email LIKE 'restore-employee-%' ORDER BY e.created_at DESC LIMIT 1");
    return {counts,ledger,columns,indexes,fks,marker};
  }finally{await c.end();}
}
try{
  await createDatabase(source);
  await createDatabase(restored);
  await seedAndMigrate(source);
  const before=await snapshot(source);
  assert.ok(before.counts.employees>=2);
  assert.ok(before.marker.length===1,'Seed marker must be queryable before backup.');
  const dump=run('mysqldump',[...sqlClientArgs(source),'--single-transaction','--routines','--triggers','--events','--hex-blob','--no-tablespaces']);
  assert.match(dump,/CREATE TABLE/,'Logical backup should contain schema definitions.');
  assert.match(dump,/BACKUP_RESTORE_FIXTURE/,'Logical backup should contain the marker audit data.');
  const dumpPath=path.join('/tmp','hrms-restore-'+suffix+'.sql');
  const fs=await import('node:fs/promises');
  await fs.writeFile(dumpPath,dump,{mode:0o600});
  // Restore into the isolated target only; no production database is reachable from this test.
  const restore=spawnSync('mysql',sqlClientArgs(restored),{input:dump,encoding:'utf8',timeout:120000,env:{...process.env,MYSQL_PWD:password}});
  if(restore.status!==0)throw new Error('mysql restore failed ('+restore.status+'):\n'+String(restore.stdout||'')+'\n'+String(restore.stderr||''));
  const after=await snapshot(restored);
  assert.deepEqual(after.counts,before.counts,'Restore must preserve all critical table counts.');
  assert.deepEqual(after.ledger,before.ledger,'Restore must preserve the complete migration ledger and checksums.');
  assert.deepEqual(after.columns,before.columns,'Restore must preserve critical generated/nullable columns.');
  assert.deepEqual(after.indexes,before.indexes,'Restore must preserve the complete index definitions.');
  assert.deepEqual(after.fks,before.fks,'Restore must preserve the complete foreign-key definitions.');
  assert.deepEqual(after.marker,before.marker,'Restore must preserve representative application marker data.');
  const c=await connect(restored);
  try{
    const [applicationRead]=await c.execute("SELECT COUNT(*) AS count FROM employees e JOIN attendance_records a ON a.employee_id=e.id JOIN leave_requests l ON l.employee_id=e.id JOIN wfh_requests w ON w.employee_id=e.id WHERE e.email LIKE 'restore-employee-%' AND a.check_in_method='WFH' AND l.reason='Backup restore fixture' AND w.status='REJECTED'");
    assert.ok(Number(applicationRead[0].count)>=1,'Restored schema/data must support a representative HRMS application query.');
  }finally{await c.end();}
  console.log('Backup restore rehearsal PASS: isolated dump/restore, migration ledger, critical counts, columns, indexes, foreign keys, marker data, and representative HRMS query.');
}finally{
  const fs=await import('node:fs/promises');
  try{await fs.unlink(path.join('/tmp','hrms-restore-'+suffix+'.sql'));}catch{}
  const c=await connect(undefined);
  try{for(const name of created.reverse())await c.query('DROP DATABASE IF EXISTS `'+name+'`');}
  finally{await c.end();}
}
