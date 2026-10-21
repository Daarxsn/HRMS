import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pool, query } from '../src/db.mts';

const port = 8090;
const baseUrl = `http://127.0.0.1:${port}/api`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  DEMO_AUTH_ENABLED: 'true',
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
    body:JSON.stringify({method:'GPS',latitude:18.506633,longitude:73.857692,accuracy:10})
  });
  assert.equal(spoofedGpsAttempt.response.status,403,'Client-supplied X-Forwarded-For and GPS coordinates must not bypass the office IP allow-list.');

  const gpsInsideWithoutOfficeNetwork = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'GPS',latitude:18.506633,longitude:73.857692,accuracy:10})
  });
  assert.equal(gpsInsideWithoutOfficeNetwork.response.status,403,'Client GPS coordinates alone must not authorize a punch when the server-observed IP is not on the office allow-list.');

  const gpsOutsideOffice = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'GPS',latitude:18.516633,longitude:73.857692,accuracy:10})
  });
  assert.equal(gpsOutsideOffice.response.status,422,'An outside-geofence check-in must be rejected when office-network verification also fails.');

  const offPremisesCheckIn = await request('/attendance/check-in', {
    method:'POST',
    headers:{Cookie:employeeSession.cookie},
    body:JSON.stringify({method:'OFF_PREMISES'})
  });
  assert.equal(offPremisesCheckIn.response.status,400,'OFF_PREMISES must be checkout-only.');


  const adminSession = await signIn(admin.email);
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
    const pending = await query("SELECT id FROM attendance_correction_requests WHERE employee_id=:employee AND attendance_date=:date AND status='PENDING' LIMIT 1",{employee:employeeSession.user.id,date:candidate});
    if(!pending[0]) correctionDate=candidate;
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
  const testedBalances=await request('/leave/balances',{headers:{Cookie:employeeSession.cookie}});
  assert.equal(testedBalances.response.status,200);
  const earnedBalance=(testedBalances.data.balances||[]).find((balance)=>balance.type==='EARNED');
  assert.ok(earnedBalance&&Number.isFinite(earnedBalance.accrued)&&Number.isFinite(earnedBalance.remaining),'Earned balance must expose numeric accrued and remaining fields.');

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
  for(let offset=35;offset<=400&&lifecycleCandidates.length<2;offset+=1){
    const candidate=new Date(wfhBase.getTime()+offset*86400000).toISOString().slice(0,10);
    const weekday=new Date(candidate+'T12:00:00Z').getUTCDay();
    if(weekday===0)continue;
    if(['01-26','08-15','10-02'].includes(candidate.slice(5)))continue;
    if(lifecycleMonths.has(candidate.slice(0,7)))continue;
    const [fixedHoliday]=await query("SELECT id FROM company_holidays WHERE holiday_date=:date AND holiday_kind='FIXED' LIMIT 1",{date:candidate});
    if(fixedHoliday[0])continue;
    const monthStart=candidate.slice(0,7)+'-01';
    const [yy,mm]=candidate.split('-').map(Number);
    const monthEnd=new Date(Date.UTC(yy,mm,0)).toISOString().slice(0,10);
    const [monthlyCount]=await query("SELECT COUNT(*) AS count FROM wfh_requests WHERE employee_id=:employee AND request_date BETWEEN :start AND :end AND status IN ('PENDING','APPROVED')",{employee:employeeSession.user.id,start:monthStart,end:monthEnd});
    if(Number(monthlyCount[0]?.count||0)>=Number(wfhState.data.monthlyCap||4))continue;
    const [existingActive]=await query("SELECT id FROM wfh_requests WHERE employee_id=:employee AND request_date=:date AND status IN ('PENDING','APPROVED') LIMIT 1",{employee:employeeSession.user.id,date:candidate});
    if(existingActive[0])continue;
    lifecycleCandidates.push(candidate);
    lifecycleMonths.add(candidate.slice(0,7));
  }
  assert.equal(lifecycleCandidates.length,2,'Must find two future non-fixed-holiday business dates in different months for WFH lifecycle tests.');

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

  // Sick-leave validation must identify the correct type and rule when documentation is missing.
  let sickStart='';
  for(let offset=7;offset<=60&&!sickStart;offset+=1){
    const candidate=new Date(wfhBase.getTime()+offset*86400000).toISOString().slice(0,10);
    if(new Date(candidate+'T12:00:00Z').getUTCDay()!==1)continue;
    const sickEndDate=new Date(new Date(candidate+'T12:00:00Z').getTime()+2*86400000).toISOString().slice(0,10);
    if(candidate.slice(0,4)!==sickEndDate.slice(0,4))continue;
    const [fixedRows]=await query("SELECT id FROM company_holidays WHERE holiday_kind='FIXED' AND holiday_date BETWEEN :start AND :end LIMIT 1",{start:candidate,end:sickEndDate});
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
