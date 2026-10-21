import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { deleteObject } from '../src/object-storage.mts';
import { enqueueEmail, processEmailOutboxBatch, retryFailedEmail } from '../src/email-outbox.mts';
import { pool, query } from '../src/db.mts';

const port = 8090;
const baseUrl = `http://127.0.0.1:${port}/api`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  DEMO_AUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'ci-oauth-client.apps.googleusercontent.com',
  VERCEL: '0',
  BLOB_READ_WRITE_TOKEN: '',
  OFFICE_NETWORK_IPS: '198.51.100.10',
  JWT_SECRET: 'ci-integration-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
};

const server = spawn(process.execPath, ['--experimental-strip-types', 'src/index.mts'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`API did not start in time. Output:\n${output}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

function cookieFrom(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  assert.ok(cookies.length > 0, 'Expected the demo sign-in response to set a session cookie.');
  return cookies[0].split(';', 1)[0];
}

async function signIn(email) {
  const result = await request('/auth/demo', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.data?.user?.id);
  return { user: result.data.user, cookie: cookieFrom(result.response) };
}

try {
  await waitForServer();

  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.status, 'ok');
  assert.equal(health.data.database, 'ok');
  assert.ok(health.data.version);
  assert.ok(health.data.build);
  assert.match(health.response.headers.get('permissions-policy') || '', /geolocation=\(self\)/i);
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');

  const demoUsers = await request('/auth/demo-users');
  assert.equal(demoUsers.response.status, 200);
  assert.equal(demoUsers.data.enabled, true);
  const admin = demoUsers.data.users.find((user) => user.role === 'ADMIN');
  const employee = demoUsers.data.users.find((user) => user.role === 'EMPLOYEE');
  assert.ok(admin?.email, 'Seed must provide an administrator demo account.');
  assert.ok(employee?.email, 'Seed must provide an employee demo account.');

  const employeeSession = await signIn(employee.email);
  const employeeMe = await request('/auth/me', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeeMe.response.status, 200);
  assert.equal(employeeMe.data.user.id, employeeSession.user.id);
  assert.equal(employeeMe.data.user.role, 'EMPLOYEE');
  assert.equal(employeeMe.data.user.user_type, 'EMPLOYEE');
  assert.equal(employeeMe.data.user.platform, 'PEOPLE');
  assert.equal(employeeMe.data.user.landingPath, '/');

  const employeeDocuments = await request('/enterprise/employee/documents', {
    headers:{ Cookie:employeeSession.cookie }
  });
  assert.equal(employeeDocuments.response.status,200,'Employees must be able to list their own HR documents.');
  assert.ok(Array.isArray(employeeDocuments.data.documents));

  const employeeAdminAttempt = await request('/admin/system-health', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeeAdminAttempt.response.status, 403);

  const employeeAdminReportAttempt = await request('/admin/reports.csv', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeeAdminReportAttempt.response.status, 403);

  const attendanceValidation = await request('/attendance/check-in', {
    method: 'POST',
    headers: { Cookie: employeeSession.cookie },
    body: JSON.stringify({})
  });
  assert.equal(attendanceValidation.response.status, 400);

  // Spoof both the HQ GPS coordinates and the allow-listed office IP in a
  // client-supplied forwarding header. Direct/local deployments must ignore it.
  const spoofedGpsAttempt = await request('/attendance/check-in', {
    method:'POST',
    headers:{ Cookie:employeeSession.cookie, 'X-Forwarded-For':'198.51.100.10' },
    body:JSON.stringify({method:'GPS',workLocation:'OFFICE',latitude:18.506633,longitude:73.857692,accuracy:10})
  });
  assert.equal(spoofedGpsAttempt.response.status,403,'Client-supplied X-Forwarded-For and GPS coordinates must not bypass the office IP allow-list.');

  const gpsInsideWithoutOfficeNetwork = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'GPS',workLocation:'OFFICE',latitude:18.506633,longitude:73.857692,accuracy:10})
  });
  assert.equal(gpsInsideWithoutOfficeNetwork.response.status,403,'Client GPS coordinates alone must not authorize a punch when the server-observed IP is not on the office allow-list.');

  const gpsOutsideOffice = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'GPS',workLocation:'OFFICE',latitude:18.516633,longitude:73.857692,accuracy:10})
  });
  assert.equal(gpsOutsideOffice.response.status,422,'An outside-geofence check-in must be rejected when office-network verification also fails.');

  const offPremisesCheckIn = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'OFF_PREMISES'})
  });
  assert.equal(offPremisesCheckIn.response.status,400,'OFF_PREMISES must be checkout-only.');


  const unauthenticatedOutboxRun = await request('/internal/email-outbox', {method:'POST',body:JSON.stringify({})});
  assert.equal(unauthenticatedOutboxRun.response.status,401,'The background email worker endpoint must require its private bearer secret.');

  const adminSession = await signIn(admin.email);

  // Step 5 / 27-28: durable enqueue, dedupe, SMTP failure retries, recovery and concurrent delivery.
  const emailDedupeKey = 'integration-email-outbox:' + crypto.randomUUID();
  const queuedFirst = await enqueueEmail({
    to:['outbox-test@example.test'],
    subject:'Outbox retry regression test',
    text:'Synthetic message for integration recovery checks.',
    html:'<p>Synthetic message for integration recovery checks.</p>',
    fromName:'HRMS Integration'
  }, emailDedupeKey);
  assert.equal(queuedFirst.queued,true);
  assert.equal(queuedFirst.status,'PENDING');
  const queuedDuplicate = await enqueueEmail({
    to:['outbox-test@example.test'],
    subject:'A duplicate with a changed body must not replace the first message',
    text:'second body',
    html:'<p>second body</p>'
  }, emailDedupeKey);
  assert.equal(queuedDuplicate.id,queuedFirst.id,'A duplicate event key must return the original durable outbox item.');
  let outboxRows = await query('SELECT status,attempts,last_error,max_attempts FROM email_outbox WHERE id=:id LIMIT 1',{id:queuedFirst.id});
  assert.equal(Number(outboxRows[0]?.attempts),0);
  assert.equal(Number(outboxRows[0]?.max_attempts),8);

  const failureCases = [
    {message:'SMTP server response timed out.',kind:'timeout'},
    {message:'connect ECONNREFUSED 127.0.0.1:2525',kind:'connection'},
    {message:'SMTP authentication failed (535 invalid credentials)',kind:'credentials'}
  ];
  for (const failure of failureCases) {
    await query('UPDATE email_outbox SET available_at=UTC_TIMESTAMP(3) WHERE id=:id',{id:queuedFirst.id});
    const result = await processEmailOutboxBatch({outboxId:queuedFirst.id,send:async()=>{throw new Error(failure.message);}});
    assert.equal(result.claimed,1,'The selected test outbox entry must be claimed for the '+failure.kind+' failure.');
    assert.equal(result.retried,1,'Transient SMTP '+failure.kind+' errors must be recorded and retried.');
    outboxRows = await query('SELECT status,attempts,last_error FROM email_outbox WHERE id=:id LIMIT 1',{id:queuedFirst.id});
    assert.equal(outboxRows[0]?.status,'PENDING');
    assert.equal(Number(outboxRows[0]?.attempts),failureCases.indexOf(failure)+1);
    assert.match(String(outboxRows[0]?.last_error||''),new RegExp(failure.kind==='credentials'?'535':failure.kind==='connection'?'ECONNREFUSED':'timed out','i'));
  }

  await query('UPDATE email_outbox SET available_at=UTC_TIMESTAMP(3) WHERE id=:id',{id:queuedFirst.id});
  let actualSendCount=0;
  const sentMessageIds:string[]=[];
  const recoveredSender=async(message)=> {
    actualSendCount+=1;
    sentMessageIds.push(String(message.messageId||''));
    await new Promise((resolve)=>setTimeout(resolve,50));
    return {sent:true,skipped:false};
  };
  const concurrentResults=await Promise.all([
    processEmailOutboxBatch({outboxId:queuedFirst.id,send:recoveredSender}),
    processEmailOutboxBatch({outboxId:queuedFirst.id,send:recoveredSender})
  ]);
  assert.equal(actualSendCount,1,'Concurrent worker claims must not deliver the same pending outbox item twice.');
  assert.equal(concurrentResults.reduce((total,result)=>total+result.sent,0),1);
  assert.ok(sentMessageIds[0]?.startsWith('<')&&sentMessageIds[0]?.endsWith('@hrms.fxcoworks.com>'),'Delivered retries must preserve a stable Message-ID.');
  outboxRows=await query('SELECT status,attempts,sent_at,last_error FROM email_outbox WHERE id=:id LIMIT 1',{id:queuedFirst.id});
  assert.equal(outboxRows[0]?.status,'SENT','The worker must record eventual recovery.');
  assert.equal(Number(outboxRows[0]?.attempts),4);
  assert.ok(outboxRows[0]?.sent_at);
  assert.equal(outboxRows[0]?.last_error,null);

  const exhaustedKey='integration-email-outbox-terminal:'+crypto.randomUUID();
  const exhausted=await enqueueEmail({
    to:['outbox-test@example.test'],subject:'Terminal retry test',text:'terminal',html:'<p>terminal</p>'
  },exhaustedKey);
  await query('UPDATE email_outbox SET attempts=max_attempts-1,available_at=UTC_TIMESTAMP(3) WHERE id=:id',{id:exhausted.id});
  const exhaustedResult=await processEmailOutboxBatch({outboxId:exhausted.id,send:async()=>{throw new Error('SMTP authentication failed (535 invalid credentials)');}});
  assert.equal(exhaustedResult.failed,1,'Exhausted notification deliveries must become visible FAILED records.');
  outboxRows=await query('SELECT status,attempts,last_error FROM email_outbox WHERE id=:id LIMIT 1',{id:exhausted.id});
  assert.equal(outboxRows[0]?.status,'FAILED');
  assert.equal(Number(outboxRows[0]?.attempts),8);
  assert.match(String(outboxRows[0]?.last_error||''),/535/);
  assert.equal(await retryFailedEmail(exhausted.id),true,'An administrator retry action must reset an exhausted message.');
  outboxRows=await query('SELECT status,attempts,last_error FROM email_outbox WHERE id=:id LIMIT 1',{id:exhausted.id});
  assert.equal(outboxRows[0]?.status,'PENDING');
  assert.equal(Number(outboxRows[0]?.attempts),0);

  await query('DELETE FROM email_outbox WHERE id IN (:first,:second)',{first:queuedFirst.id,second:exhausted.id});

  // Step 4 / 22: document self-service, IDOR denial, and administrative access are tested independently.
  const otherEmployee = demoUsers.data.users.find((user) => user.role === 'EMPLOYEE' && user.email !== employee.email);
  assert.ok(otherEmployee?.email, 'Seed must provide a second employee for document ownership tests.');
  const pdfBytes = Buffer.from('%PDF-1.4\nHRMS Step 4 document ownership test\n%%EOF\n');
  const documentForm = () => {
    const form = new FormData();
    form.append('document', new Blob([pdfBytes], {type:'application/pdf'}), 'step4-ownership.pdf');
    form.append('documentType', 'TEST');
    form.append('title', 'Step 4 document ownership test');
    return form;
  };
  const uploadResponse = await fetch(baseUrl + '/enterprise/admin/employees/' + employeeSession.user.id + '/documents', {
    method:'POST', headers:{Cookie:adminSession.cookie}, body:documentForm()
  });
  const uploadText = await uploadResponse.text();
  const uploaded = uploadText ? JSON.parse(uploadText) : null;
  assert.equal(uploadResponse.status, 201, 'Admin upload of a valid private PDF must succeed: ' + uploadText);
  assert.ok(uploaded?.id);

  const ownList = await request('/enterprise/employee/documents', {headers:{Cookie:employeeSession.cookie}});
  assert.equal(ownList.response.status, 200);
  assert.ok(ownList.data.documents.some((doc) => doc.id === uploaded.id));
  const ownDownload = await fetch(baseUrl + '/enterprise/employee/documents/' + uploaded.id, {headers:{Cookie:employeeSession.cookie}});
  assert.equal(ownDownload.status, 200);
  assert.match(ownDownload.headers.get('content-disposition') || '', /attachment/i);
  assert.match(ownDownload.headers.get('cache-control') || '', /private, no-store/i);
  assert.equal(ownDownload.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await ownDownload.arrayBuffer()), pdfBytes);

  const otherSession = await signIn(otherEmployee.email);
  const idor = await request('/enterprise/employee/documents/' + uploaded.id, {headers:{Cookie:otherSession.cookie}});
  assert.equal(idor.response.status, 404, 'Changing document ID cannot disclose another employee document.');
  const employeeAdminDownload = await request('/enterprise/admin/documents/' + uploaded.id, {headers:{Cookie:employeeSession.cookie}});
  assert.equal(employeeAdminDownload.response.status, 403, 'Employees must not use the admin document route.');
  const adminDownload = await fetch(baseUrl + '/enterprise/admin/documents/' + uploaded.id, {headers:{Cookie:adminSession.cookie}});
  assert.equal(adminDownload.status, 200, 'Authorized administrator can access the HR document.');
  assert.match(adminDownload.headers.get('cache-control') || '', /private, no-store/i);

  const invalidMime = new FormData();
  invalidMime.append('document', new Blob(['not a PDF'], {type:'text/plain'}), 'invalid.txt');
  invalidMime.append('documentType', 'TEST');
  invalidMime.append('title', 'Invalid MIME regression');
  const invalidMimeResponse = await fetch(baseUrl + '/enterprise/admin/employees/' + employeeSession.user.id + '/documents', {
    method:'POST', headers:{Cookie:adminSession.cookie}, body:invalidMime
  });
  assert.equal(invalidMimeResponse.status, 400);

  const fakePdf = new FormData();
  fakePdf.append('document', new Blob(['not a PDF despite MIME'], {type:'application/pdf'}), 'fake.pdf');
  fakePdf.append('documentType', 'TEST');
  fakePdf.append('title', 'Fake PDF regression');
  const fakePdfResponse = await fetch(baseUrl + '/enterprise/admin/employees/' + employeeSession.user.id + '/documents', {
    method:'POST', headers:{Cookie:adminSession.cookie}, body:fakePdf
  });
  assert.equal(fakePdfResponse.status, 400, 'MIME labels must be backed by a valid file signature.');

  const oversized = new FormData();
  oversized.append('document', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {type:'application/pdf'}), 'oversized.pdf');
  oversized.append('documentType', 'TEST');
  oversized.append('title', 'Oversized document regression');
  const oversizedResponse = await fetch(baseUrl + '/enterprise/admin/employees/' + employeeSession.user.id + '/documents', {
    method:'POST', headers:{Cookie:adminSession.cookie}, body:oversized
  });
  assert.equal(oversizedResponse.status, 413, 'Files above 10 MiB must return HTTP 413.');

  const employeeUpload = await fetch(baseUrl + '/enterprise/admin/employees/' + employeeSession.user.id + '/documents', {
    method:'POST', headers:{Cookie:employeeSession.cookie}, body:documentForm()
  });
  assert.equal(employeeUpload.status, 403, 'Employees must not upload HR-controlled documents.');

  const objectRows = await query('SELECT object_key FROM employee_documents WHERE id=:id LIMIT 1', {id:uploaded.id});
  await query('DELETE FROM employee_documents WHERE id=:id', {id:uploaded.id});
  if (objectRows[0]?.object_key) await deleteObject(objectRows[0].object_key);

  // Step 4 / 24: calendar mutation must remain administrator-only.
  const employeeCalendarCreate = await request('/calendar', {
    method:'POST', headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({date:'2099-12-31',name:'Step 4 employee denial fixture',kind:'FLOATING'})
  });
  assert.equal(employeeCalendarCreate.response.status,403,'Employees cannot create or alter company holidays.');
  const testHolidayName = 'Step 4 admin calendar authorization fixture';
  await query('DELETE FROM company_holidays WHERE holiday_date=:date AND name=:name',{date:'2099-12-31',name:testHolidayName});
  const adminCalendarCreate = await request('/calendar', {
    method:'POST', headers:{Cookie:adminSession.cookie},
    body:JSON.stringify({date:'2099-12-31',name:testHolidayName,kind:'FLOATING'})
  });
  assert.equal(adminCalendarCreate.response.status,201,'A properly authorized ADMIN/ADMIN account can create a holiday.');
  const createdHoliday = await query('SELECT holiday_date FROM company_holidays WHERE holiday_date=:date AND name=:name AND created_by=:admin LIMIT 1',{date:'2099-12-31',name:testHolidayName,admin:adminSession.user.id});
  assert.ok(createdHoliday[0],'Authorized calendar creation should persist its record.');
  await query('DELETE FROM company_holidays WHERE holiday_date=:date AND name=:name',{date:'2099-12-31',name:testHolidayName});

  // Both role and user_type must be compatible to reach protected administration.
  for (const invalid of [{role:'ADMIN',user_type:'EMPLOYEE'}, {role:'EMPLOYEE',user_type:'ADMIN'}]) {
    await query('UPDATE employees SET role=:role,user_type=:type WHERE id=:id', {role:invalid.role,type:invalid.user_type,id:employeeSession.user.id});
    try {
      const invalidMe = await request('/auth/me', {headers:{Cookie:employeeSession.cookie}});
      assert.equal(invalidMe.response.status, 403, 'Mismatched role/type must fail closed.');
      const invalidAdmin = await request('/enterprise/admin/overview', {headers:{Cookie:employeeSession.cookie}});
      assert.equal(invalidAdmin.response.status, 403, 'Mismatched accounts cannot enter the enterprise admin namespace.');
      const invalidCalendar = await request('/calendar', {method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:'2099-12-30',name:'Invalid role calendar attempt',kind:'FLOATING'})});
      assert.equal(invalidCalendar.response.status,403,'Mismatched accounts cannot create company holidays.');
    } finally {
      await query("UPDATE employees SET role='EMPLOYEE',user_type='EMPLOYEE' WHERE id=:id", {id:employeeSession.user.id});
    }
  }

  const adminMe = await request('/auth/me', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminMe.response.status, 200);
  assert.equal(adminMe.data.user.role, 'ADMIN');
  assert.equal(adminMe.data.user.user_type, 'ADMIN');
  assert.equal(adminMe.data.user.platform, 'ADMIN');
  assert.equal(adminMe.data.user.landingPath, '/admin');

  // Concurrent correction submissions for the same employee/date must create one
  // pending request and return a conflict for the other attempt, never ER_DUP_ENTRY.
  const indiaTodayForCorrection = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const correctionBase = new Date(indiaTodayForCorrection+'T12:00:00Z');
  let correctionDate='';
  for(let offset=2;offset<=365&&!correctionDate;offset+=1){
    const candidate = new Date(correctionBase.getTime()-offset*86400000).toISOString().slice(0,10);
    const [pending, existingAttendance, leaveConflict, flexConflict, activeWfh] = await Promise.all([
      query("SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM flex_start_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM wfh_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate})
    ]);
    if(!pending[0]&&!existingAttendance[0]&&!leaveConflict[0]&&!flexConflict[0]&&!activeWfh[0]) correctionDate=candidate;
  }
  assert.ok(correctionDate,'Integration test must find a date without an existing pending correction.');
  const correctionBody = {
    date:correctionDate,
    requestedCheckIn:new Date(correctionDate+'T03:00:00.000Z').toISOString(),
    reason:'Concurrent correction submission regression'
  };
  const concurrentCorrections = await Promise.all([
    request('/attendance/corrections',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify(correctionBody)}),
    request('/attendance/corrections',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify(correctionBody)})
  ]);
  assert.equal(concurrentCorrections.filter((x)=>x.response.status===201).length,1,'Exactly one concurrent correction submission must succeed.');
  assert.equal(concurrentCorrections.filter((x)=>x.response.status===409).length,1,'The duplicate concurrent correction must receive HTTP 409.');
  const createdCorrection=concurrentCorrections.find((x)=>x.response.status===201);
  assert.ok(createdCorrection?.data?.id);
  const rejectCorrection=await request('/admin/approvals/correction/'+createdCorrection.data.id,{
    method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'REJECTED',note:'Integration-test cleanup'})
  });
  assert.equal(rejectCorrection.response.status,200,'The test correction must be reviewable without changing attendance.');

  const approvalRaceRequest=await request('/attendance/corrections',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({...correctionBody,reason:'Concurrent correction approval regression'})});
  assert.equal(approvalRaceRequest.response.status,201,'A new correction can be filed after the prior request was rejected.');
  const concurrentCorrectionApprovals=await Promise.all([
    request('/admin/approvals/correction/'+approvalRaceRequest.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Concurrent approval A'})}),
    request('/admin/approvals/correction/'+approvalRaceRequest.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Concurrent approval B'})})
  ]);
  assert.equal(concurrentCorrectionApprovals.filter((x)=>x.response.status===200).length,1,'Exactly one concurrent correction approval may succeed.');
  assert.equal(concurrentCorrectionApprovals.filter((x)=>x.response.status===409).length,1,'A retried/concurrent approval must return 409, not ER_DUP_ENTRY.');
  const approvedCorrectionRecords=await query('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date',{employee:employeeSession.user.id,date:correctionDate});
  assert.equal(approvedCorrectionRecords.length,1,'Concurrent approval must result in exactly one attendance record.');
  await query('DELETE FROM audit_logs WHERE entity_type=\'attendance\' AND entity_id=:id',{id:approvedCorrectionRecords[0].id});
  await query('DELETE FROM audit_logs WHERE entity_id=:id AND entity_type IN (\'attendance_correction\',\'correction_request\')',{id:approvalRaceRequest.data.id});
  await query('DELETE FROM attendance_correction_requests WHERE id=:id',{id:approvalRaceRequest.data.id});
  await query('DELETE FROM attendance_records WHERE id=:id',{id:approvedCorrectionRecords[0].id});

  const testedBalances=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(testedBalances.response.status,200);
  const earnedBalance=(testedBalances.data.balances||[]).find((balance)=>balance.type==='EARNED');
  assert.ok(earnedBalance&&Number.isFinite(earnedBalance.accrued)&&Number.isFinite(earnedBalance.remaining),'Earned balance must expose numeric accrued and remaining fields.');

  // API-level regression: a NULL probation end date accrues earned leave from
  // joining date, and this test restores the original employee fields afterwards.
  const earnedAsOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const earnedYear=Number(earnedAsOf.slice(0,4));
  const earnedMonth=Number(earnedAsOf.slice(5,7));
  const earnedDay=Number(earnedAsOf.slice(8,10));
  const earnedLastMonth=earnedDay===new Date(Date.UTC(earnedYear,earnedMonth,0)).getUTCDate()?earnedMonth:earnedMonth-1;
  const savedEmployeeFields=(await query(`SELECT DATE_FORMAT(joined_on,'%Y-%m-%d') AS joined_on,
    DATE_FORMAT(probation_end_date,'%Y-%m-%d') AS probation_end_date,status
    FROM employees WHERE id=:employee`,{employee:employeeSession.user.id}))[0];
  assert.ok(savedEmployeeFields,'Integration employee must exist for the earned-leave API regression.');
  try {
    await query("UPDATE employees SET joined_on=:joined,probation_end_date=NULL,status='ACTIVE' WHERE id=:employee",{
      employee:employeeSession.user.id,joined:(earnedYear-1)+'-01-01'
    });
    const nullProbationResponse=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
    assert.equal(nullProbationResponse.response.status,200);
    const nullProbationBalance=(nullProbationResponse.data.balances||[]).find((balance)=>balance.type==='EARNED');
    assert.ok(nullProbationBalance,'Earned-leave balance must be returned when probation end date is NULL.');
    assert.equal(Number(nullProbationBalance.accrued),Math.max(0,earnedLastMonth),'A NULL probation end date must use joining date and completed-month accrual.');
    assert.equal(nullProbationBalance.reviewRequired,false,'An active employee with NULL probation end date should not require inactive-employment review.');
  } finally {
    await query("UPDATE employees SET joined_on=:joined,probation_end_date=:probation,status=:status WHERE id=:employee",{
      employee:employeeSession.user.id,joined:savedEmployeeFields.joined_on,probation:savedEmployeeFields.probation_end_date,status:savedEmployeeFields.status
    });
  }

  // Validate actual balance transitions over a two-day leave range: pending request
  // reserves balance, withdrawal restores it, and approval moves it from pending
  // to used without a second deduction.
  const leaveToday = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const leaveBase = new Date(leaveToday+'T12:00:00Z');
  let leaveRange = null;
  for(let offset=1;offset<=30&&!leaveRange;offset+=1){
    const start=new Date(leaveBase.getTime()+offset*86400000).toISOString().slice(0,10);
    const end=new Date(leaveBase.getTime()+(offset+1)*86400000).toISOString().slice(0,10);
    if(start.slice(0,4)!==leaveToday.slice(0,4)||end.slice(0,4)!==leaveToday.slice(0,4))continue;
    const startWeekday=new Date(start+'T12:00:00Z').getUTCDay();
    if(startWeekday===0||startWeekday===6)continue;
    if(['01-26','08-15','10-02'].some((fixed)=>start.slice(5)===fixed||end.slice(5)===fixed))continue;
    const fixedRows=await query("SELECT holiday_date FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :start AND :end LIMIT 1",{start,end});
    if(fixedRows[0])continue;
    const attendanceConflict=await query("SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date BETWEEN :start AND :end LIMIT 1",{employee:employeeSession.user.id,start,end});
    if(attendanceConflict[0])continue;
    const leaveConflict=await query("SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:end AND end_date>=:start LIMIT 1",{employee:employeeSession.user.id,start,end});
    if(leaveConflict[0])continue;
    const wfhConflict=await query("SELECT id FROM wfh_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1",{employee:employeeSession.user.id,start,end});
    if(wfhConflict[0])continue;
    const flexConflict=await query("SELECT id FROM flex_start_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND request_date BETWEEN :start AND :end LIMIT 1",{employee:employeeSession.user.id,start,end});
    if(flexConflict[0])continue;
    leaveRange={start,end};
  }
  if(leaveRange){
    const eligibleLeaveBalance=(testedBalances.data.balances||[])
      .filter((balance)=>['CASUAL','FLOATING','EARNED'].includes(balance.type)&&Number(balance.remaining)>=2&&!balance.reviewRequired)
      .sort((a,b)=>['CASUAL','FLOATING','EARNED'].indexOf(a.type)-['CASUAL','FLOATING','EARNED'].indexOf(b.type))[0];
    assert.ok(eligibleLeaveBalance,'Integration fixture needs at least one two-day leave balance for balance-transition testing.');
    const leaveType=eligibleLeaveBalance.type;
    const balanceBefore=eligibleLeaveBalance;
    const requestBody={type:leaveType,startDate:leaveRange.start,endDate:leaveRange.end,reason:'Balance transition regression test'};
    const createdLeave=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify(requestBody)});
    assert.equal(createdLeave.response.status,201,'A valid two-day leave request should be accepted.');
    assert.equal(createdLeave.data.days,2,'The two consecutive workdays should calculate as two days.');
    const pendingBalanceResponse=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
    const pendingBalance=(pendingBalanceResponse.data.balances||[]).find((balance)=>balance.type===leaveType);
    assert.equal(Number(pendingBalance.remaining),Number(balanceBefore.remaining)-2,'Pending leave must reserve its full calculated duration.');
    const cancelledLeave=await request('/leave/'+createdLeave.data.id,{method:'DELETE',headers:{Cookie:employeeSession.cookie}});
    assert.equal(cancelledLeave.response.status,200,'A pending leave request must be withdrawable.');
    const restoredBalanceResponse=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
    const restoredBalance=(restoredBalanceResponse.data.balances||[]).find((balance)=>balance.type===leaveType);
    assert.equal(Number(restoredBalance.remaining),Number(balanceBefore.remaining),'Withdrawing pending leave must restore the reserved balance.');
    const approvedLeaveRequest=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify(requestBody)});
    assert.equal(approvedLeaveRequest.response.status,201,'The leave date range should be re-applicable after withdrawal.');
    const approvedLeave=await request('/admin/approvals/leave/'+approvedLeaveRequest.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Balance transition integration test'})});
    assert.equal(approvedLeave.response.status,200,'Administrator should be able to approve the valid leave request.');
    const finalBalanceResponse=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
    const finalBalance=(finalBalanceResponse.data.balances||[]).find((balance)=>balance.type===leaveType);
    assert.equal(Number(finalBalance.remaining),Number(balanceBefore.remaining)-2,'Approval should retain exactly one balance deduction.');
    assert.equal(Number(finalBalance.pending),Number(restoredBalance.pending),'Approval should move the request out of pending without double-deducting.');
    assert.equal(Number(finalBalance.used),Number(restoredBalance.used)+2,'Approval should move the requested duration into used leave.');
  } else {
    console.log('Leave balance transition regression skipped: no conflict-free two-day work range remains in the current calendar year.');
  }

  // Regression: approved WFH must override the stale client mode "GPS" on the
  // server. This simulates the production browser build still asking for GPS,
  // so a laptop/phone with unavailable or inaccurate location can check in.
  const enableWfh = await request('/admin/users/' + employeeSession.user.id, {
    method: 'PATCH',
    headers: { Cookie: adminSession.cookie },
    body: JSON.stringify({ wfhEnabled: true })
  });
  assert.equal(enableWfh.response.status, 200, 'Administrator must be able to enable WFH for the integration employee.');

  const wfhState = await request('/wfh', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(wfhState.response.status, 200);
  assert.equal(wfhState.data.enabled, true, 'Authenticated user lookup must preserve the employee WFH eligibility flag.');
  const wfhDate = String(wfhState.data.today);
  const calendarForWfh = await request('/calendar?year=' + wfhDate.slice(0,4), {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(calendarForWfh.response.status, 200);
  const dayNumber = new Date(wfhDate + 'T12:00:00Z').getUTCDay();
  const holidayToday = (calendarForWfh.data.holidays || []).some((item) => item.date === wfhDate);
  const existingTodayAttendance = await request('/attendance?from=' + wfhDate + '&to=' + wfhDate, {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(existingTodayAttendance.response.status, 200);
  const alreadyCheckedIn = (existingTodayAttendance.data.records || []).some((item) => item.attendance_date === wfhDate && item.check_in_at);
  if (dayNumber !== 0 && !holidayToday && !alreadyCheckedIn) {
    // WFH eligibility alone must be sufficient for a remote punch, including stale browsers still sending GPS.
    // No daily request approval, GPS coordinates, or office network should be required.
    const enabledRemoteCheckIn = await request('/attendance/check-in', {
      method:'POST', headers:{Cookie:employeeSession.cookie}, body:JSON.stringify({method:'GPS'})
    });
    assert.equal(enabledRemoteCheckIn.response.status,201,'A stale GPS-mode client must be promoted to remote check-in for WFH-enabled employees without an approved day request: '+JSON.stringify(enabledRemoteCheckIn.data));
    assert.equal(enabledRemoteCheckIn.data.method,'WFH');
    const enabledRemoteCheckOut = await request('/attendance/check-out', {
      method:'POST', headers:{Cookie:employeeSession.cookie}, body:JSON.stringify({method:'WFH'})
    });
    assert.equal(enabledRemoteCheckOut.response.status,200,'WFH-enabled employee must check out remotely without location or office network.');
    assert.equal(enabledRemoteCheckOut.data.method,'WFH');
    await query("DELETE FROM audit_logs WHERE entity_type='attendance' AND entity_id=:id",{id:enabledRemoteCheckIn.data.attendanceId});
    await query('DELETE FROM attendance_records WHERE id=:id',{id:enabledRemoteCheckIn.data.attendanceId});

    const createWfh = await request('/wfh', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ date: wfhDate, kind: 'EMERGENCY', reason: 'CI regression: approved WFH must not require GPS' })
    });
    assert.equal(createWfh.response.status, 201, 'Employee must be able to request same-day WFH in the isolated integration database: ' + JSON.stringify(createWfh.data));
    assert.ok(createWfh.data?.id);

    const duplicateActiveWfh = await request('/wfh', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ date: wfhDate, kind: 'EMERGENCY', reason: 'CI regression: duplicate active request must be blocked' })
    });
    assert.equal(duplicateActiveWfh.response.status, 409, 'A second pending/approved WFH request for the same employee and date must be rejected.');

    const approvalQueue = await request('/admin/approvals', {
      headers: { Cookie: adminSession.cookie }
    });
    assert.equal(approvalQueue.response.status, 200);
    const wfhQueueItem = (approvalQueue.data.approvals || []).find((item) => item.type === 'wfh' && item.id === createWfh.data.id);
    assert.ok(wfhQueueItem, 'Submitted WFH request must appear in the administrator approval queue.');

    const approveWfh = await request('/admin/approvals/wfh/' + createWfh.data.id, {
      method: 'POST',
      headers: { Cookie: adminSession.cookie },
      body: JSON.stringify({ decision: 'APPROVED', note: 'Approved by integration regression test' })
    });
    assert.equal(approveWfh.response.status, 200, 'Administrator must be able to approve the WFH request.');

    const approvedWfhState = await request('/wfh', {
      headers: { Cookie: employeeSession.cookie }
    });
    assert.equal(approvedWfhState.response.status, 200);
    assert.equal(approvedWfhState.data.approvedToday, true, 'Approved WFH must be reflected by the employee WFH endpoint.');

    // Place one intentionally unresolved prior-date row in the disposable CI database.
    // A historical exception must be preserved but must not prevent today's valid check-in.
    const basePreviousDate = new Date(wfhDate + 'T12:00:00Z');
    let previousShiftDate = '';
    for (let offset = 1; offset <= 3650 && !previousShiftDate; offset += 1) {
      const candidate = new Date(basePreviousDate.getTime() - offset * 86400000).toISOString().slice(0,10);
      const occupied = await query('SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1', {
        employee:employeeSession.user.id, date:candidate
      });
      if (!occupied[0]) previousShiftDate = candidate;
    }
    assert.ok(previousShiftDate, 'Test must find a free historical attendance date.');
    const previousOpenFixtureId = crypto.randomUUID();
    await query(`INSERT INTO attendance_records (id,employee_id,attendance_date,check_in_at,check_in_method,status)
      VALUES (:id,:employee,:date,:checkIn,'GPS','ON_TIME')`, {
      id:previousOpenFixtureId, employee:employeeSession.user.id, date:previousShiftDate,
      checkIn:new Date(previousShiftDate + 'T03:00:00.000Z')
    });

    // Deliberately omit coordinates and submit GPS, as a stale frontend can do.
    const remoteCheckIn = await request('/attendance/check-in', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ method: 'GPS' })
    });
    assert.equal(remoteCheckIn.response.status, 201, 'An unresolved previous-date shift must not block today’s approved WFH check-in.');
    assert.equal(remoteCheckIn.data.warning?.code, 'PRIOR_OPEN_SHIFT_REQUIRES_REVIEW', 'Historical open shifts must be surfaced as a warning.');
    assert.equal(Number(remoteCheckIn.data.warning?.count) >= 1, true);
    assert.equal(remoteCheckIn.data.warning?.hrNotified, true, 'Active HR administrators must receive a review notification.');
    assert.equal(remoteCheckIn.data.method, 'WFH', 'Server must promote an old GPS-mode request to WFH when today is approved.');

    // Check-out must follow the saved WFH mode even when an older client submits GPS.
    const remoteCheckOut = await request('/attendance/check-out', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ method: 'GPS' })
    });
    assert.equal(remoteCheckOut.response.status, 200, 'WFH check-out must not require office geolocation.');
    assert.equal(remoteCheckOut.data.method, 'WFH');
    assert.equal(remoteCheckOut.data.shortShiftReviewRequired,true,'An unusually short shift must remain check-outable and be flagged for review.');
    assert.equal(remoteCheckOut.data.workedMinutes,0,'The lunch deduction must never create negative net work minutes.');
    const preservedHistoricalShift = await query('SELECT check_out_at FROM attendance_records WHERE id=:id', {id:previousOpenFixtureId});
    assert.equal(preservedHistoricalShift[0]?.check_out_at, null, 'Today’s check-out must not fabricate a timestamp for the historical shift.');
    await query('DELETE FROM attendance_records WHERE id=:id', {id:previousOpenFixtureId});
    await query('DELETE FROM audit_logs WHERE entity_type=\'attendance\' AND entity_id=:id', {id:remoteCheckIn.data.attendanceId});
  } else {
    console.log('WFH GPS-fallback integration scenario skipped: today is a non-working day, company holiday, or attendance already exists.');
  }

  // End-to-end WFH lifecycle in future, isolated business dates: concurrent create,
  // approval, conflicts against leave/flex, cancellation, reapplication, rejection.
  const lifecycleCandidates=[];
  const lifecycleMonths=new Set();
  const wfhBase=new Date(wfhDate+'T12:00:00Z');
  for(let offset=35;offset<=400&&lifecycleCandidates.length<4;offset+=1){
    const candidate=new Date(wfhBase.getTime()+offset*86400000).toISOString().slice(0,10);
    const weekday=new Date(candidate+'T12:00:00Z').getUTCDay();
    if(weekday===0)continue;
    if(['01-26','08-15','10-02'].includes(candidate.slice(5)))continue;
    if(lifecycleMonths.has(candidate.slice(0,7)))continue;
    const fixedHoliday=await query("SELECT holiday_date FROM company_holidays WHERE holiday_date=:date AND holiday_kind='FIXED' LIMIT 1",{date:candidate});
    if(fixedHoliday[0])continue;
    const monthStart=candidate.slice(0,7)+'-01';
    const [yy,mm]=candidate.split('-').map(Number);
    const monthEnd=new Date(Date.UTC(yy,mm,0)).toISOString().slice(0,10);
    const monthlyCount=await query("SELECT COUNT(*) AS count FROM wfh_requests WHERE employee_id=:employee AND request_date BETWEEN :start AND :end AND status IN ('PENDING','APPROVED')",{employee:employeeSession.user.id,start:monthStart,end:monthEnd});
    if(Number(monthlyCount[0]?.count||0)>=Number(wfhState.data.monthlyCap||4))continue;
    const [existingActive, existingAttendance, existingLeave, existingFlex, existingCorrection] = await Promise.all([
      query("SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM leave_requests WHERE employee_id=:employee AND status IN ('PENDING','APPROVED') AND start_date<=:date AND end_date>=:date LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM flex_start_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1",{employee:employeeSession.user.id,date:candidate}),
      query("SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1",{employee:employeeSession.user.id,date:candidate})
    ]);
    if(existingActive[0]||existingAttendance[0]||existingLeave[0]||existingFlex[0]||existingCorrection[0])continue;
    lifecycleCandidates.push(candidate);
    lifecycleMonths.add(candidate.slice(0,7));
  }
  assert.equal(lifecycleCandidates.length,4,'Must find four future non-fixed-holiday business dates in different months for WFH/flex/leave conflict tests.');

  const concurrentWfhRequests=await Promise.all([
    request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[0],kind:'PLANNED',reason:'Concurrent WFH lifecycle request A'})}),
    request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[0],kind:'PLANNED',reason:'Concurrent WFH lifecycle request B'})})
  ]);
  assert.equal(concurrentWfhRequests.filter((x)=>x.response.status===201).length,1,'Only one concurrent active WFH request may be created.');
  assert.equal(concurrentWfhRequests.filter((x)=>x.response.status===409).length,1,'Concurrent duplicate WFH submission must receive HTTP 409.');
  const createdLifecycleWfh=concurrentWfhRequests.find((x)=>x.response.status===201);
  assert.ok(createdLifecycleWfh?.data?.id);
  const approveLifecycleWfh=await request('/admin/approvals/wfh/'+createdLifecycleWfh.data.id,{
    method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Step 3 integration lifecycle'})
  });
  assert.equal(approveLifecycleWfh.response.status,200);
  const leaveAgainstWfh=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({type:'CASUAL',startDate:lifecycleCandidates[0],endDate:lifecycleCandidates[0],reason:'Leave conflicts with approved WFH'})});
  assert.equal(leaveAgainstWfh.response.status,409,'Leave submission must not contradict approved WFH.');
  const flexAgainstWfh=await request('/attendance/flex-requests',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[0],startTime:'10:00',reason:'Flex conflicts with approved WFH'})});
  assert.equal(flexAgainstWfh.response.status,409,'Flex-start submission must not contradict approved WFH.');

  const cancelApprovedWfh=await request('/wfh/'+createdLifecycleWfh.data.id,{method:'DELETE',headers:{Cookie:employeeSession.cookie}});
  assert.equal(cancelApprovedWfh.response.status,200,'A future approved WFH request with no attendance can be cancelled.');
  const reapplyWfh=await request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[0],kind:'PLANNED',reason:'Reapply after WFH cancellation'})});
  assert.equal(reapplyWfh.response.status,201,'Cancellation must release active-date uniqueness for reapplication.');
  const cancelReappliedWfh=await request('/wfh/'+reapplyWfh.data.id,{method:'DELETE',headers:{Cookie:employeeSession.cookie}});
  assert.equal(cancelReappliedWfh.response.status,200);

  const createRejectedWfh=await request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[1],kind:'PLANNED',reason:'WFH rejection lifecycle'})});
  assert.equal(createRejectedWfh.response.status,201);
  const rejectLifecycleWfh=await request('/admin/approvals/wfh/'+createRejectedWfh.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'REJECTED',note:'Step 3 rejection lifecycle'})});
  assert.equal(rejectLifecycleWfh.response.status,200);
  const reapplyRejectedWfh=await request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[1],kind:'PLANNED',reason:'Reapply after WFH rejection'})});
  assert.equal(reapplyRejectedWfh.response.status,201,'Rejected WFH must release active-date uniqueness for reapplication.');
  const cancelAfterRejection=await request('/wfh/'+reapplyRejectedWfh.data.id,{method:'DELETE',headers:{Cookie:employeeSession.cookie}});
  assert.equal(cancelAfterRejection.response.status,200);

  // Cross-entity submission conflicts: active flex-start is mutually exclusive with WFH and leave.
  const flexBeforeWfh=await request('/attendance/flex-requests',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[2],startTime:'10:00',reason:'Flex conflicts with WFH and leave'})});
  assert.equal(flexBeforeWfh.response.status,201);
  const wfhAgainstPendingFlex=await request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[2],kind:'PLANNED',reason:'WFH conflicts with pending flex'})});
  assert.equal(wfhAgainstPendingFlex.response.status,409,'WFH submission must recheck active flex-start requests.');
  const leaveAgainstPendingFlex=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({type:'CASUAL',startDate:lifecycleCandidates[2],endDate:lifecycleCandidates[2],reason:'Leave conflicts with pending flex'})});
  assert.equal(leaveAgainstPendingFlex.response.status,409,'Leave submission must recheck active flex-start requests.');
  const rejectFlexForSubmission=await request('/admin/approvals/flex/'+flexBeforeWfh.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'REJECTED',note:'Cross-conflict test cleanup'})});
  assert.equal(rejectFlexForSubmission.response.status,200);

  // Approval-time backstop: a flex request appears after a WFH request was filed.
  const wfhAgainstFlexApproval=await request('/wfh',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:lifecycleCandidates[3],kind:'PLANNED',reason:'WFH approval conflict regression'})});
  assert.equal(wfhAgainstFlexApproval.response.status,201);
  const flexFixtureForWfh=crypto.randomUUID();
  await query(`INSERT INTO flex_start_requests (id,employee_id,request_date,requested_start_time,reason)
    VALUES (:id,:employee,:date,'10:00',:reason)`,{id:flexFixtureForWfh,employee:employeeSession.user.id,date:lifecycleCandidates[3],reason:'Injected to verify approval-time conflict handling'});
  const approveConflictingWfh=await request('/admin/approvals/wfh/'+wfhAgainstFlexApproval.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Should be blocked by flex start'})});
  assert.equal(approveConflictingWfh.response.status,409,'WFH approval must recheck flex-start state inside the approval transaction.');
  const rejectConflictingWfh=await request('/admin/approvals/wfh/'+wfhAgainstFlexApproval.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'REJECTED',note:'Conflict test cleanup'})});
  assert.equal(rejectConflictingWfh.response.status,200);
  await query('DELETE FROM flex_start_requests WHERE id=:id',{id:flexFixtureForWfh});

  // Leave approval must independently recheck active flex requests.
  const leaveAgainstFlexApproval=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({type:'CASUAL',startDate:lifecycleCandidates[3],endDate:lifecycleCandidates[3],reason:'Leave approval conflict regression'})});
  assert.equal(leaveAgainstFlexApproval.response.status,201);
  const flexFixtureForLeave=crypto.randomUUID();
  await query(`INSERT INTO flex_start_requests (id,employee_id,request_date,requested_start_time,reason)
    VALUES (:id,:employee,:date,'10:00',:reason)`,{id:flexFixtureForLeave,employee:employeeSession.user.id,date:lifecycleCandidates[3],reason:'Injected to verify leave approval-time conflict handling'});
  const approveConflictingLeave=await request('/admin/approvals/leave/'+leaveAgainstFlexApproval.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'APPROVED',note:'Should be blocked by flex start'})});
  assert.equal(approveConflictingLeave.response.status,409,'Leave approval must recheck flex-start state inside the approval transaction.');
  const rejectConflictingLeave=await request('/admin/approvals/leave/'+leaveAgainstFlexApproval.data.id,{method:'POST',headers:{Cookie:adminSession.cookie},body:JSON.stringify({decision:'REJECTED',note:'Conflict test cleanup'})});
  assert.equal(rejectConflictingLeave.response.status,200);
  await query('DELETE FROM flex_start_requests WHERE id=:id',{id:flexFixtureForLeave});

  // Sick-leave validation must identify the correct type and rule when documentation is missing.
  let sickStart='';
  for(let offset=7;offset<=60&&!sickStart;offset+=1){
    const candidate=new Date(wfhBase.getTime()+offset*86400000).toISOString().slice(0,10);
    if(new Date(candidate+'T12:00:00Z').getUTCDay()!==1)continue;
    const sickEndDate=new Date(new Date(candidate+'T12:00:00Z').getTime()+2*86400000).toISOString().slice(0,10);
    if(candidate.slice(0,4)!==sickEndDate.slice(0,4))continue;
    const fixedRows=await query("SELECT holiday_date FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :start AND :end LIMIT 1",{start:candidate,end:sickEndDate});
    if(fixedRows[0])continue;
    if(['01-26','08-15','10-02'].some((fixed)=>candidate.slice(5)===fixed||sickEndDate.slice(5)===fixed))continue;
    sickStart=candidate;
  }
  assert.ok(sickStart,'Must find a Monday for the three-calendar-day sick-leave policy test.');
  const sickEnd=new Date(new Date(sickStart+'T12:00:00Z').getTime()+2*86400000).toISOString().slice(0,10);
  const sickWithoutNote=await request('/leave',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({type:'SICK',startDate:sickStart,endDate:sickEnd,reason:'Sick leave documentation regression'})});
  assert.equal(sickWithoutNote.response.status,400);
  assert.match(sickWithoutNote.data?.error||' ',/doctor.*note.*sick leave/i,'Sick leave error must name the right leave type and document requirement.');

  const employeePolicies = await request('/enterprise/policies', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeePolicies.response.status, 200, 'Employee policy center must load published policies.');
  assert.ok(Array.isArray(employeePolicies.data.policies), 'Employee policy response must contain a policies array.');

  const employeeAdminPoliciesAttempt = await request('/enterprise/admin/policies', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeeAdminPoliciesAttempt.response.status, 403, 'Employees must not access administrator policy management.');

  const adminPolicies = await request('/enterprise/admin/policies', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminPolicies.response.status, 200, 'Administrator policy management must load.');
  assert.ok(Array.isArray(adminPolicies.data.policies));

  const draftPolicy = await request('/enterprise/admin/policies', {
    method: 'POST',
    headers: { Cookie: adminSession.cookie },
    body: JSON.stringify({
      title: 'Phase 2 integration policy ' + Date.now(),
      category: 'TESTING',
      version: '1.0',
      body: 'This policy exists only to verify publishing and acknowledgement in the isolated test database.'
    })
  });
  assert.equal(draftPolicy.response.status, 201, 'Administrator must be able to create a policy draft.');
  assert.ok(draftPolicy.data?.id, 'Created policy must have an identifier.');

  const publishPolicy = await request('/enterprise/admin/policies/' + draftPolicy.data.id, {
    method: 'PATCH',
    headers: { Cookie: adminSession.cookie },
    body: JSON.stringify({ status: 'PUBLISHED' })
  });
  assert.equal(publishPolicy.response.status, 200, 'Administrator must be able to publish a policy.');

  const publishedPolicies = await request('/enterprise/policies', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(publishedPolicies.response.status, 200);
  const publishedPolicy = publishedPolicies.data.policies.find((policy) => policy.id === draftPolicy.data.id);
  assert.ok(publishedPolicy, 'Newly published policy must appear in the employee policy center.');
  assert.equal(Number(publishedPolicy.acknowledged), 0, 'Newly published policy must start unacknowledged.');

  const acknowledgePolicy = await request('/enterprise/policies/' + draftPolicy.data.id + '/acknowledge', {
    method: 'POST',
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(acknowledgePolicy.response.status, 200, 'Employee must be able to acknowledge a published policy.');
  assert.equal(acknowledgePolicy.data?.ok, true);

  const acknowledgedPolicies = await request('/enterprise/policies', {
    headers: { Cookie: employeeSession.cookie }
  });
  const acknowledgedPolicy = acknowledgedPolicies.data.policies.find((policy) => policy.id === draftPolicy.data.id);
  assert.equal(Number(acknowledgedPolicy?.acknowledged), 1, 'Acknowledgement status must persist after a fresh request.');

  // Step 6 / 30: exercise runtime API reads for settings, reports, calendar, audit, and onboarding lifecycle.
  const employeeCalendarRead = await request('/calendar?year=2099',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(employeeCalendarRead.response.status,200,'Employee calendar access must work against MySQL.');
  assert.ok(Array.isArray(employeeCalendarRead.data.holidays));
  const employeeLeaveBalances = await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(employeeLeaveBalances.response.status,200);
  assert.ok(Array.isArray(employeeLeaveBalances.data.balances));
  const employeeLeaveHistory = await request('/leave',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(employeeLeaveHistory.response.status,200);
  assert.ok(Array.isArray(employeeLeaveHistory.data.requests));
  const employeeWfh = await request('/wfh',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(employeeWfh.response.status,200);
  assert.ok(Array.isArray(employeeWfh.data.requests));
  const employeeCalendarMutation = await request('/calendar',{method:'POST',headers:{Cookie:employeeSession.cookie},body:JSON.stringify({date:'2099-12-30',name:'Employee calendar denial',kind:'FLOATING'})});
  assert.equal(employeeCalendarMutation.response.status,403);
  const adminSettingsBefore = await request('/admin/settings',{headers:{Cookie:adminSession.cookie}});
  assert.equal(adminSettingsBefore.response.status,200);
  assert.ok(adminSettingsBefore.data.settings);
  const settingsUpdate = await request('/admin/settings',{method:'PUT',headers:{Cookie:adminSession.cookie},body:JSON.stringify({fixed_lunch_minutes:35})});
  assert.equal(settingsUpdate.response.status,200,'Settings updates must persist through the real API: '+JSON.stringify(settingsUpdate.data));
  const persistedSetting = await query("SELECT setting_value FROM system_settings WHERE setting_key='fixed_lunch_minutes'");
  assert.equal(persistedSetting[0]?.setting_value,'35');
  const restoreSetting = await request('/admin/settings',{method:'PUT',headers:{Cookie:adminSession.cookie},body:JSON.stringify({fixed_lunch_minutes:30})});
  assert.equal(restoreSetting.response.status,200);
  const report = await request('/admin/leave-report?from=2026-01-01&to=2099-12-31',{headers:{Cookie:adminSession.cookie}});
  assert.equal(report.response.status,200);
  assert.ok(report.data.summary);
  assert.ok(Array.isArray(report.data.requests));
  const auditBefore = await request('/admin/audit',{headers:{Cookie:adminSession.cookie}});
  assert.equal(auditBefore.response.status,200);
  assert.ok(Array.isArray(auditBefore.data.logs));

  // Onboarding task creation is also atomic with its audit row.
  const createRollbackTaskId=crypto.randomUUID();
  const createRollbackTrigger='hrms_step6_fail_onboarding_create_audit';
  try {
    await query(`CREATE TRIGGER ${createRollbackTrigger} BEFORE INSERT ON audit_logs FOR EACH ROW
      BEGIN
        IF NEW.action='ONBOARDING_TASK_CREATED' AND NEW.entity_id='${createRollbackTaskId}' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Step 6 injected onboarding-create audit failure';
        END IF;
      END`);
    const failedCreate=await request('/enterprise/admin/employees/'+employeeSession.user.id+'/onboarding',{
      method:'POST',headers:{Cookie:adminSession.cookie},
      body:JSON.stringify({title:'Injected create rollback',category:'PROFILE'})
    });
    assert.equal(failedCreate.response.status,500,'Onboarding task creation should fail when its audit insert fails.');
    const partialTask=await query("SELECT id FROM onboarding_tasks WHERE employee_id=:employee AND title='Injected create rollback'",{employee:employeeSession.user.id});
    assert.equal(partialTask.length,0,'Onboarding task insert must roll back when audit insertion fails.');
  } finally {
    await query('DROP TRIGGER IF EXISTS '+createRollbackTrigger);
    await query("DELETE FROM onboarding_tasks WHERE employee_id=:employee AND title='Injected create rollback'",{employee:employeeSession.user.id});
  }

  // Onboarding updates and their audit rows must commit or roll back together.
  const onboardingTaskId=crypto.randomUUID();
  await query("INSERT INTO onboarding_tasks (id,employee_id,title,category,status,created_by) VALUES (:id,:employee,'Step 6 rollback fixture','PROFILE','PENDING',:admin)",{id:onboardingTaskId,employee:employeeSession.user.id,admin:adminSession.user.id});
  const rollbackTriggerName='hrms_step6_fail_onboarding_audit';
  try {
    await query(`CREATE TRIGGER ${rollbackTriggerName} BEFORE INSERT ON audit_logs FOR EACH ROW
      BEGIN
        IF NEW.action='ONBOARDING_TASK_UPDATED' AND NEW.entity_id='${onboardingTaskId}' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Step 6 injected audit failure';
        END IF;
      END`);
    const failedTaskUpdate=await request('/enterprise/admin/onboarding/'+onboardingTaskId,{
      method:'PATCH',headers:{Cookie:adminSession.cookie},
      body:JSON.stringify({status:'COMPLETED',notes:'This update must roll back when audit insertion fails.'})
    });
    assert.equal(failedTaskUpdate.response.status,500,'Injected audit failure should fail the onboarding update.');
    const taskAfterFailure=await query('SELECT status,completed_at,completed_by FROM onboarding_tasks WHERE id=:id',{id:onboardingTaskId});
    assert.equal(taskAfterFailure[0]?.status,'PENDING','Task status must roll back when the audit insert fails.');
    assert.equal(taskAfterFailure[0]?.completed_at,null,'Completion timestamp must roll back with the task.');
    const auditAfterFailure=await query("SELECT id FROM audit_logs WHERE action='ONBOARDING_TASK_UPDATED' AND entity_id=:id",{id:onboardingTaskId});
    assert.equal(auditAfterFailure.length,0,'A failed onboarding mutation must not leave an audit row.');
  } finally {
    await query('DROP TRIGGER IF EXISTS '+rollbackTriggerName);
    await query('DELETE FROM onboarding_tasks WHERE id=:id',{id:onboardingTaskId});
  }
  const successfulTaskId=crypto.randomUUID();
  await query("INSERT INTO onboarding_tasks (id,employee_id,title,category,status,created_by) VALUES (:id,:employee,'Step 6 success fixture','PROFILE','PENDING',:admin)",{id:successfulTaskId,employee:employeeSession.user.id,admin:adminSession.user.id});
  const successfulTaskUpdate=await request('/enterprise/admin/onboarding/'+successfulTaskId,{
    method:'PATCH',headers:{Cookie:adminSession.cookie},
    body:JSON.stringify({status:'COMPLETED',notes:'Successful transaction must record task and audit together.'})
  });
  assert.equal(successfulTaskUpdate.response.status,200);
  const successfulTask=await query('SELECT status,completed_at,completed_by FROM onboarding_tasks WHERE id=:id',{id:successfulTaskId});
  assert.equal(successfulTask[0]?.status,'COMPLETED');
  assert.ok(successfulTask[0]?.completed_at);
  const successfulAudit=await query("SELECT id FROM audit_logs WHERE action='ONBOARDING_TASK_UPDATED' AND entity_id=:id",{id:successfulTaskId});
  assert.equal(successfulAudit.length,1,'Successful onboarding updates must persist exactly one audit event.');
  await query("DELETE FROM audit_logs WHERE action='ONBOARDING_TASK_UPDATED' AND entity_id=:id",{id:successfulTaskId});
  await query('DELETE FROM onboarding_tasks WHERE id=:id',{id:successfulTaskId});

  const adminHealth = await request('/admin/system-health', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminHealth.response.status, 200);
  assert.equal(adminHealth.data.status, 'ok');
  assert.equal(adminHealth.data.databaseLatencyMs >= 0, true);
  assert.ok(adminHealth.data.mysqlVersion);

  const adminAttendanceAccess = await request('/attendance', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminAttendanceAccess.response.status, 200);
  assert.ok(Array.isArray(adminAttendanceAccess.data.records));

  const adminAttendanceValidation = await request('/attendance/check-in', {
    method: 'POST',
    headers: { Cookie: adminSession.cookie },
    body: JSON.stringify({})
  });
  assert.equal(adminAttendanceValidation.response.status, 400);

  // Regression: checkout must close an open shift from the previous India-local
  // date instead of looking only for a row dated today.
  const todayIndia = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const previousDateObject = new Date(todayIndia+'T12:00:00Z');
  previousDateObject.setUTCDate(previousDateObject.getUTCDate()-1);
  const previousIndiaDate = previousDateObject.toISOString().slice(0,10);
  await query('DELETE FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date',{employee:adminSession.user.id,date:previousIndiaDate});
  await query(`INSERT INTO attendance_records (id,employee_id,attendance_date,check_in_at,check_in_method,status)
    VALUES (:id,:employee,:date,:checkIn,'GPS','ON_TIME')`,{
    id:crypto.randomUUID(),employee:adminSession.user.id,date:previousIndiaDate,
    checkIn:new Date(previousIndiaDate+'T18:20:00.000Z')
  });
  const overnightCheckout = await request('/attendance/check-out',{
    method:'POST',
    headers:{Cookie:adminSession.cookie},
    body:JSON.stringify({method:'OFF_PREMISES'})
  });
  assert.equal(overnightCheckout.response.status,200,'An off-premises check-out must close an open overnight shift.');
  const closedOvernight = await query('SELECT check_out_at,check_out_method FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date',{employee:adminSession.user.id,date:previousIndiaDate});
  assert.ok(closedOvernight[0]?.check_out_at,'Overnight checkout must persist a checkout timestamp.');
  assert.equal(closedOvernight[0]?.check_out_method,'OFF_PREMISES','Off-premises checkout must record its actual verification method.');


  const adminLeaveAttempt = await request('/leave', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminLeaveAttempt.response.status, 403);

  const dashboard = await request('/admin/dashboard', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.data.stats);
  assert.equal(Number.isInteger(dashboard.data.stats.employees), true);

  let googleLoginResponse;
  for(let attempt=0;attempt<11;attempt+=1) {
    googleLoginResponse=await request('/auth/google',{method:'POST',body:JSON.stringify({credential:'deliberately-invalid-google-token'})});
    if(attempt<10) assert.equal(googleLoginResponse.response.status,401);
  }
  assert.equal(googleLoginResponse.response.status,429,'The dedicated Google login limiter must throttle request eleven.');

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(logout.response.status, 200);

  const afterLogout = await request('/auth/me', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(afterLogout.response.status, 401);
  assert.match(afterLogout.data?.error || '', /revoked/i);

  console.log('API integration smoke verification: PASS');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await pool.end();
}
