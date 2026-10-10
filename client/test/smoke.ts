import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const enterprise = fs.readFileSync(path.join(root, 'src/EnterpriseHRPage.tsx'), 'utf8');

const api = fs.readFileSync(path.join(root, 'src/api.ts'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'src/sw.ts'), 'utf8');

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
assert.ok(app.includes('Report time · 9:00–9:30 AM'), 'Attendance reporting-window UX contract missing');
assert.ok(app.includes('overview-attendance-card'), 'Overview attendance action module contract missing');
assert.ok(app.includes('navigator.geolocation'), 'Browser geolocation attendance contract missing');
assert.ok(app.includes("get('/admin/system-health')"), 'Administrator system-health API integration contract missing');
assert.ok(app.includes('hrms:session-expired'), 'Session-expiry recovery contract missing');
assert.ok(app.includes('What needs your attention'), 'Employee action-center contract missing');
assert.ok(app.includes('approved this month') || app.includes('approvedWfhThisMonth'), 'Employee WFH usage visibility contract missing');
assert.ok(app.includes('NEXT COMPANY HOLIDAY'), 'Employee next-holiday contract missing');
assert.ok(app.includes('Attach a doctor’s note for sick leave of 3 or more consecutive calendar days.'), 'Sick leave doctor-note validation contract missing');
assert.ok(app.includes('The last day cannot be before the first day.'), 'Leave date range validation contract missing');
assert.ok(app.includes('path="/notifications"'), 'Employee notifications route contract missing');
assert.ok(app.includes('get(\'/account/notifications\')'), 'Employee notifications API integration contract missing');
assert.ok(app.includes('Workplace pulse'), 'Administrator workplace pulse contract missing');
assert.ok(app.includes('Next to review'), 'Administrator review preview contract missing');
assert.ok(app.includes("get('/admin/approvals')"), 'Administrator approval queue integration contract missing');
assert.ok(api.includes('AbortController'), 'API timeout contract missing');
assert.ok(api.includes('Z|[+-]'), 'Timezone-aware timestamp parsing contract missing');
assert.ok(api.includes("credentials: 'include'"), 'HTTP-only session credential contract missing');
assert.ok(!/\balert\s*\(/.test(app), 'Browser alert() should not be used in the production UI');
assert.ok(!/\balert\s*\(/.test(enterprise), 'Enterprise HR actions must not use blocking browser alerts');
assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'Service worker must exclude API responses');
assert.ok(manifest.includes('"display": "standalone"'), 'PWA standalone display contract missing');
assert.ok(index.includes('Permissions-Policy'), 'Browser Permissions-Policy contract missing');
assert.ok(index.includes('strict-origin-when-cross-origin'), 'Referrer policy contract missing');

for (const secretName of ['JWT_SECRET', 'DB_PASSWORD', 'GCS_PRIVATE_KEY']) {
  assert.ok(!app.includes(secretName) && !api.includes(secretName), `Frontend must not contain server secret name: ${secretName}`);
}


assert.ok(app.includes("const attended=rows.filter((r)=>r.status==='ON_TIME'||r.status==='LATE_ENTRY')"), 'Reports present-day metric contract missing');
assert.ok(app.includes("const open=attended.filter((r)=>!r.check_out_at).length"), 'Reports open-shift metric contract missing');
assert.ok(app.includes('PRESENT DAYS'), 'Reports present-days label contract missing');
assert.ok(app.includes('OPEN SHIFTS'), 'Reports open-shifts label contract missing');
assert.ok(app.includes('ABSENT'), 'Reports absent summary contract missing');
assert.ok(app.includes('ON LEAVE'), 'Reports leave summary contract missing');
assert.ok(app.includes('WFH'), 'Reports WFH summary contract missing');

assert.ok(enterprise.includes('lifecycleRequest.current'), 'Employee lifecycle requests must ignore stale responses');
assert.ok(enterprise.includes('setLifecycle(null)'), 'Employee lifecycle panel must clear stale employee details');
assert.ok(enterprise.includes('Could not load onboarding tasks.'), 'Onboarding load failures must be surfaced');
assert.ok(enterprise.includes('Retrying…'), 'Onboarding task loading must provide retry feedback');

console.log('Frontend smoke contracts: PASS');
