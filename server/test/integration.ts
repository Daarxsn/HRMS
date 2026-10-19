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

  const adminSession = await signIn(admin.email);
  const adminMe = await request('/auth/me', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminMe.response.status, 200);
  assert.equal(adminMe.data.user.role, 'ADMIN');
  assert.equal(adminMe.data.user.user_type, 'ADMIN');
  assert.equal(adminMe.data.user.platform, 'ADMIN');
  assert.equal(adminMe.data.user.landingPath, '/admin');

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

    // Deliberately omit coordinates and submit GPS, as a stale frontend can do.
    const remoteCheckIn = await request('/attendance/check-in', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ method: 'GPS' })
    });
    assert.equal(remoteCheckIn.response.status, 201, 'Approved WFH check-in must bypass office GPS and network checks.');
    assert.equal(remoteCheckIn.data.method, 'WFH', 'Server must promote an old GPS-mode request to WFH when today is approved.');

    // Check-out must follow the saved WFH mode even when an older client submits GPS.
    const remoteCheckOut = await request('/attendance/check-out', {
      method: 'POST',
      headers: { Cookie: employeeSession.cookie },
      body: JSON.stringify({ method: 'GPS' })
    });
    assert.equal(remoteCheckOut.response.status, 200, 'WFH check-out must not require office geolocation.');
    assert.equal(remoteCheckOut.data.method, 'WFH');
  } else {
    console.log('WFH GPS-fallback integration scenario skipped: today is a non-working day, company holiday, or attendance already exists.');
  }

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
    body:JSON.stringify({method:'GPS'})
  });
  assert.equal(overnightCheckout.response.status,200,'An open shift from yesterday must be closable today.');
  const closedOvernight = await query('SELECT check_out_at FROM attendance_records WHERE employee_id=:employee AND attendance_date=:date',{employee:adminSession.user.id,date:previousIndiaDate});
  assert.ok(closedOvernight[0]?.check_out_at,'Overnight checkout must persist a checkout timestamp.');

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
