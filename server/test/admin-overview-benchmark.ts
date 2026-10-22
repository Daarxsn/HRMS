import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import mysql from 'mysql2/promise';

if(process.env.HRMS_BENCHMARK!=='true'||process.env.CI!=='true'||process.env.NODE_ENV==='production'||!['127.0.0.1','localhost','::1'].includes(String(process.env.DB_HOST||''))||!/_ci$/.test(String(process.env.DB_NAME||''))) {
  throw new Error('Admin summary benchmark is restricted to explicitly enabled local CI disposable databases.');
}
const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:Number(process.env.BENCH_POOL_SIZE||10),waitForConnections:true,queueLimit:50});
const samples=Number(process.env.BENCH_ITERATIONS||30);
const quantile=(xs,q)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*q)-1)];
async function measured(label,sql,args=[]){
 const times=[];let rows=0;
 for(let i=0;i<samples;i++){const t=performance.now();const [result]=await pool.execute(sql,args);times.push(performance.now()-t);rows=Array.isArray(result)?result.length:0;}
 return {label,iterations:samples,p50Ms:Number(quantile(times,.5).toFixed(2)),p95Ms:Number(quantile(times,.95).toFixed(2)),maxMs:Number(Math.max(...times).toFixed(2)),lastRows:rows};
}
try{
 const [employees]=await pool.query("SELECT COUNT(*) total FROM employees");
 const [attendance]=await pool.query("SELECT COUNT(*) total FROM attendance_records");
 const [policies]=await pool.query("SELECT COUNT(*) total FROM company_policies");
 assert.ok(Number(employees[0].total)>0,'CI fixture must seed at least one employee');
 const results=[];
 results.push(await measured('headcount', "SELECT COUNT(*) total,SUM(status='ACTIVE') active,SUM(role='ADMIN' AND status='ACTIVE') admins FROM employees"));
 results.push(await measured('departments', "SELECT COALESCE(NULLIF(department,''),'Unassigned') department,COUNT(*) total FROM employees WHERE status='ACTIVE' GROUP BY COALESCE(NULLIF(department,''),'Unassigned') ORDER BY total DESC,department LIMIT 12"));
 results.push(await measured('attendance-30d', "SELECT COUNT(DISTINCT employee_id) present,SUM(status='LATE_ENTRY') late,SUM(status='ABSENT') absent FROM attendance_records WHERE attendance_date BETWEEN DATE_SUB(CURDATE(),INTERVAL 29 DAY) AND CURDATE()"));
 results.push(await measured('attendance-trend', "SELECT DATE_FORMAT(attendance_date,'%Y-%m') month,COUNT(DISTINCT employee_id) present,SUM(status='LATE_ENTRY') late,SUM(status='ABSENT') absent FROM attendance_records WHERE attendance_date>=DATE_SUB(CURDATE(),INTERVAL 5 MONTH) GROUP BY month ORDER BY month"));
 results.push(await measured('leave-summary', "SELECT leave_type,SUM(CASE WHEN status='APPROVED' THEN days ELSE 0 END) approved,SUM(CASE WHEN status='PENDING' THEN days ELSE 0 END) pending,SUM(CASE WHEN status IN ('APPROVED','PENDING') THEN days ELSE 0 END) committed FROM leave_requests WHERE start_date>=DATE_FORMAT(CURDATE(),'%Y-01-01') GROUP BY leave_type ORDER BY leave_type"));
 results.push(await measured('onboarding-summary', "SELECT status,COUNT(*) total FROM onboarding_tasks GROUP BY status"));
 results.push(await measured('asset-summary', "SELECT status,COUNT(*) total FROM company_assets GROUP BY status"));
 results.push(await measured('policies', "SELECT p.id,p.title,p.category,p.version,p.status,p.published_at,(SELECT COUNT(*) FROM employees e WHERE e.status='ACTIVE' AND e.role='EMPLOYEE') active_people,(SELECT COUNT(*) FROM policy_acknowledgements a WHERE a.policy_id=p.id) acknowledgements FROM company_policies p ORDER BY p.updated_at DESC LIMIT 12"));
 results.push(await measured('open-separations', "SELECT s.id,s.employee_id,s.separation_type,s.last_working_date,s.status,e.full_name,e.employee_code FROM separation_cases s JOIN employees e ON e.id=s.employee_id WHERE s.status IN ('OPEN','IN_PROGRESS') ORDER BY s.last_working_date ASC LIMIT 10"));
 results.push(await measured('probation', "SELECT id,full_name,employee_code,joined_on,probation_end_date FROM employees WHERE status='ACTIVE' AND probation_end_date IS NOT NULL AND probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 60 DAY) ORDER BY probation_end_date LIMIT 12"));
 results.push(await measured('missing-documents', "SELECT e.id,e.full_name,e.employee_code FROM employees e LEFT JOIN employee_documents d ON d.employee_id=e.id AND d.status IN ('ACTIVE','EXPIRING') WHERE e.status='ACTIVE' GROUP BY e.id HAVING COUNT(d.id)=0 ORDER BY e.full_name LIMIT 20"));
 console.log(JSON.stringify({scenario:'admin-overview-query-baseline',sampleCounts:{employees:Number(employees[0].total),attendanceRecords:Number(attendance[0].total),policies:Number(policies[0].total)},results,notes:'Measures the current overview SQL individually. This is not an HTTP endpoint benchmark or realistic large-tenant load test; populate a representative staging dataset and capture endpoint p95/query count before optimizing.'},null,2));
}finally{await pool.end();}
