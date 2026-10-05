import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 8090;
const baseUrl = `http://127.0.0.1:${port}/api`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  DEMO_AUTH_ENABLED: 'true',
  JWT_SECRET: 'ci-integration-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
};

const server = spawn(process.execPath, ['--experimental-strip-types', 'src/index.ts'], {
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

  const employeeAdminAttempt = await request('/admin/system-health', {
    headers: { Cookie: employeeSession.cookie }
  });
  assert.equal(employeeAdminAttempt.response.status, 403);

  const attendanceValidation = await request('/attendance/check-in', {
    method: 'POST',
    headers: { Cookie: employeeSession.cookie },
    body: JSON.stringify({})
  });
  assert.equal(attendanceValidation.response.status, 400);

  const adminSession = await signIn(admin.email);
  const adminMe = await request('/auth/me', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminMe.response.status, 200);
  assert.equal(adminMe.data.user.role, 'ADMIN');

  const adminHealth = await request('/admin/system-health', {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminHealth.response.status, 200);
  assert.equal(adminHealth.data.status, 'ok');
  assert.equal(adminHealth.data.databaseLatencyMs >= 0, true);
  assert.ok(adminHealth.data.mysqlVersion);

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
}
