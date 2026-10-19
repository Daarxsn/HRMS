import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const enterprise = fs.readFileSync(path.join(root, 'src/EnterpriseHRPage.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

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
assert.ok(app.includes('Promise.allSettled(['), 'Employee overview must tolerate partial data outages');
assert.ok(app.includes('attendance action was recorded, but the latest status could not be refreshed'), 'Attendance success must not be reported as failed when only its refresh fails');
assert.ok(!app.includes("document.querySelector('[aria-label=\"Notifications\"]')?.click()"), 'Overview notifications action must use a real navigation link');
assert.ok(app.includes('We couldn’t verify WFH access.'), 'WFH API outage must not be mistaken for disabled eligibility');
assert.ok(app.includes('Retry notifications'), 'Notification loading failures must offer recovery');
assert.ok(app.includes('outRequest.current+=1'), 'Out-of-office fetches must be invalidated on unmount');
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
assert.ok(!index.includes('http-equiv="Permissions-Policy"'), 'Permissions-Policy must be delivered as an HTTP response header, not an HTML meta tag');
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

assert.ok(enterprise.includes('We couldn’t load your policies'), 'Employee policy errors must offer a clear recovery state');
assert.ok(enterprise.includes('Try again'), 'Employee policy loading must provide retry feedback');
assert.ok(app.includes("localStorage.getItem('hrms-theme')"), 'Appearance preference must persist across reloads');
assert.ok(app.includes("document.documentElement.dataset.theme=theme"), 'Appearance preference must update the document theme');
assert.ok(css.includes('--ui-surface: var(--fx-white)'), 'Light mode must define a semantic white surface');
assert.ok(css.includes('--ui-text: var(--fx-charcoal)'), 'Light mode must define readable brand foreground text');
assert.ok(css.includes('--ui-bg: var(--fx-charcoal)'), 'Dark mode must use the approved charcoal canvas');
assert.ok(css.includes('--ui-text: var(--fx-white)'), 'Dark mode must use readable white foreground text');
assert.ok(css.includes('html[data-theme] .profile-info-grid > div'), 'Profile grid cells must follow the active theme');
assert.ok(css.includes('html[data-theme] .calendar-day'), 'Calendar day cells must follow the active theme');
assert.ok(css.includes('html[data-theme] .calendar-day b'), 'Calendar date text must override legacy important colors');
assert.ok(css.includes('html[data-theme] .calendar-today'), 'Today highlight must adapt to the active theme');
assert.ok(!css.includes('HRMS appearance system — contrast and cross-surface consistency'), 'Duplicate legacy theme layer must be removed');

assert.ok(css.includes('profile-details-grid'), 'Theme regression coverage must include profile data grids');
assert.ok(app.includes("function Card({ children, className='', ...props })"), 'Shared cards must forward ids and accessibility attributes');
assert.ok(app.includes('profileLoadError')===false, 'Profile load recovery should use the current explicit loadError state');
assert.ok(app.includes('setProfileRetry((v)=>v+1)'), 'Profile fetch failure must offer retry');
assert.ok(app.includes('disabled={!phoneChanged||profileLoading}'), 'Profile save must be disabled when no phone change is pending');
assert.ok(app.includes('return ()=>{active=false;}'), 'Calendar fetch must ignore stale responses after year changes');
assert.ok(app.includes('calendar-empty-error'), 'Calendar API failure must not masquerade as an empty holiday list');
assert.ok(enterprise.includes('const policyRequest=useRef(0)'), 'Policy fetches must reject stale responses');
assert.ok(enterprise.includes('setPolicies((current)=>current.map((policy)=>policy.id===id?{...policy,acknowledged:1}:policy))'), 'Policy acknowledgements should update locally without reloading the entire page');
assert.ok(enterprise.includes('share the error reference with your HR administrator'), 'Policy failures must explain the support recovery path');
assert.ok(css.includes('.profile-load-error'), 'Profile load failure needs a styled retry state');
assert.ok(css.includes('.calendar-load-error'), 'Calendar load failure needs a styled retry state');
assert.ok(css.includes('.employee-policy-error'), 'Policy errors must remain visible in both themes');


console.log('Frontend smoke contracts: PASS');

assert.ok(app.includes('GPS geofencing and office-network verification are alternatives'), 'Attendance settings must explain that GPS and office-network checks are alternatives');
assert.ok(app.includes('office public egress IP'), 'Office network diagnostics must explain the public IP used for network fallback');
assert.ok(app.includes('If that IP changes'), 'Office network diagnostics must explain how to recover from a changed public IP');

assert.ok(app.includes('function locationFailureMessage(error, action='), 'Geolocation errors need a shared, code-specific explanation');
assert.ok(app.includes('Chrome could not determine your Mac’s location'), 'Unavailable position must not be misreported as denied permission');
assert.ok(app.includes('The location request timed out'), 'Geolocation timeout must show recovery instructions distinct from permission denial');
assert.ok(app.includes('Location permission was denied'), 'Permission denial must provide Chrome and macOS location settings instructions');

assert.ok(app.includes("locationFailureMessage({code:3}"), 'A geolocation wait timeout must produce explicit timeout guidance');

assert.ok(app.includes('Promise.allSettled(['), 'Admin overview and report loaders must tolerate partial API failures');
assert.ok(app.includes('adminDashboardLoaded.current'), 'Admin dashboard polling must retain loaded data between refreshes');
assert.ok(app.includes('Review queue could not be loaded.'), 'Admin dashboard must not show a false clear queue on an API failure');
assert.ok(app.includes("try{return localStorage.getItem('hrms-people-view')||'cards';}catch{return 'cards';}"), 'People view must work when local storage is unavailable');
assert.ok(app.includes('peopleRequest.current+=1'), 'People requests must be invalidated on unmount');
assert.ok(app.includes('attendanceAdminRequest.current+=1'), 'Admin attendance refreshes must not race');
assert.ok(app.includes('approvalsRequest.current+=1'), 'Approval queue refreshes must not race');
assert.ok(app.includes('Review queue unavailable'), 'Failed approval queue loads must be distinct from an empty queue');
assert.ok(app.includes('attendanceReportLoaded'), 'Report metrics must distinguish unavailable data from zero records');
assert.ok(app.includes('settingsAvailable'), 'Settings must not display an editable blank form after a failed settings fetch');
assert.ok(app.includes('Save remote-work limit'), 'The separate remote-work limit must have a working save action');
assert.ok(app.includes('auditLoaded.current'), 'Audit trail fetches must be protected against stale responses');
assert.ok(css.includes('.admin-page-error'), 'Admin error states must be styled with semantic theme tokens');
assert.ok(css.includes('.admin-empty-recovery'), 'Failed admin data panels must remain distinct from empty results');
