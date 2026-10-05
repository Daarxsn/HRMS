import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/api.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');

const requiredRoutes = [
  'path="/attendance"',
  'path="/leave"',
  'path="/wfh"',
  'path="/out"',
  'path="/calendar"',
  'path="/profile"',
  'path="/team"',
  'path="/admin-attendance"',
  'path="/approvals"',
  'path="/reports"',
  'path="/settings"',
  'path="/audit"'
];

for (const route of requiredRoutes) {
  assert.ok(app.includes(route), `Missing frontend route contract: ${route}`);
}

assert.ok(app.includes('AppErrorBoundary'), 'React error boundary contract missing');
assert.ok(app.includes('System health'), 'Administrator system-health view contract missing');
assert.ok(app.includes('Verifying your location'), 'Attendance location verification UX contract missing');
assert.ok(app.includes('Verifying office network'), 'Attendance office-network verification UX contract missing');
assert.ok(app.includes('navigator.geolocation'), 'Browser geolocation attendance contract missing');
assert.ok(app.includes("get('/admin/system-health')"), 'Administrator system-health API integration contract missing');
assert.ok(app.includes('hrms:session-expired'), 'Session-expiry recovery contract missing');
assert.ok(api.includes('AbortController'), 'API timeout contract missing');
assert.ok(api.includes("credentials: 'include'"), 'HTTP-only session credential contract missing');
assert.ok(!/\balert\s*\(/.test(app), 'Browser alert() should not be used in the production UI');
assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'Service worker must exclude API responses');
assert.ok(manifest.includes('"display": "standalone"'), 'PWA standalone display contract missing');
assert.ok(index.includes('Permissions-Policy'), 'Browser Permissions-Policy contract missing');
assert.ok(index.includes('strict-origin-when-cross-origin'), 'Referrer policy contract missing');

for (const secretName of ['JWT_SECRET', 'DB_PASSWORD', 'GCS_PRIVATE_KEY']) {
  assert.ok(!app.includes(secretName) && !api.includes(secretName), `Frontend must not contain server secret name: ${secretName}`);
}

console.log('Frontend smoke contracts: PASS');
