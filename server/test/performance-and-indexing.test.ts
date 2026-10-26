import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recoverAbandonedOutboxJobs,
  renewLockLease,
  EMAIL_OUTBOX_LEASE_SECONDS,
  EMAIL_OUTBOX_MAX_ATTEMPTS
} from '../src/email-outbox.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration015 = fs.readFileSync(path.resolve(here, '../migrations/015_phase9_query_indexes_and_worker_locks.sql'), 'utf8');
const outboxSource = fs.readFileSync(path.resolve(here, '../src/email-outbox.mts'), 'utf8');
const workerSource = fs.readFileSync(path.resolve(here, '../src/email-outbox-worker.mts'), 'utf8');
const workplaceRoutes = fs.readFileSync(path.resolve(here, '../src/routes/workplace.mts'), 'utf8');
const enterpriseRoutes = fs.readFileSync(path.resolve(here, '../src/routes/enterprise.mts'), 'utf8');
const adminRoutes = fs.readFileSync(path.resolve(here, '../src/routes/admin.mts'), 'utf8');
const accountRoutes = fs.readFileSync(path.resolve(here, '../src/routes/account.mts'), 'utf8');
const viteConfig = fs.readFileSync(path.resolve(here, '../../client/vite.config.ts'), 'utf8');

test('Phase 9 Migration 015: Optimizes high-volume database queries with targeted composite indices (HRMS-DEF-036)', () => {
  // 1. Attendance indexing
  assert.ok(migration015.includes('idx_attendance_emp_date'), 'Must define idx_attendance_emp_date');
  assert.ok(migration015.includes('attendance_records ADD INDEX idx_attendance_emp_date (employee_id, attendance_date)'), 'Must index (employee_id, attendance_date)');
  assert.ok(migration015.includes('idx_attendance_emp_date_status'), 'Must define idx_attendance_emp_date_status');

  // 2. Leave request indexing
  assert.ok(migration015.includes('idx_leave_emp_status'), 'Must define idx_leave_emp_status');
  assert.ok(migration015.includes('leave_requests ADD INDEX idx_leave_emp_status (employee_id, status)'), 'Must index (employee_id, status)');
  assert.ok(migration015.includes('idx_leave_emp_created'), 'Must define idx_leave_emp_created');

  // 3. Outbox status & availability indexing
  assert.ok(migration015.includes('idx_outbox_status_available'), 'Must define idx_outbox_status_available');
  assert.ok(migration015.includes('email_outbox ADD INDEX idx_outbox_status_available (status, available_at)'), 'Must index (status, available_at)');
  assert.ok(migration015.includes('idx_outbox_status_lease'), 'Must define idx_outbox_status_lease');

  // 4. Workflow requests indexing (WFH, corrections, flex-start)
  assert.ok(migration015.includes('idx_wfh_emp_status_date'), 'Must define idx_wfh_emp_status_date');
  assert.ok(migration015.includes('idx_correction_emp_status'), 'Must define idx_correction_emp_status');
  assert.ok(migration015.includes('idx_flex_emp_status'), 'Must define idx_flex_emp_status');

  // 5. Notifications and enterprise allowances
  assert.ok(migration015.includes('idx_notifications_emp_created'), 'Must define idx_notifications_emp_created');
  assert.ok(migration015.includes('idx_learning_emp_fiscal_status'), 'Must define idx_learning_emp_fiscal_status');
});

test('Outbox Worker Recovery: recoverAbandonedOutboxJobs and renewLockLease protect against starvation (HRMS-DEF-027)', () => {
  assert.equal(typeof recoverAbandonedOutboxJobs, 'function', 'recoverAbandonedOutboxJobs must be an exported function');
  assert.equal(typeof renewLockLease, 'function', 'renewLockLease must be an exported function');
  assert.equal(EMAIL_OUTBOX_LEASE_SECONDS, 120, 'EMAIL_OUTBOX_LEASE_SECONDS default lease must be 120s');

  // Source contract: recoverAbandonedOutboxJobs handles terminal attempts and resets PROCESSING state
  assert.ok(outboxSource.includes('export async function recoverAbandonedOutboxJobs'), 'Must export recoverAbandonedOutboxJobs');
  assert.ok(outboxSource.includes("SET status=IF(attempts>=max_attempts,'FAILED','PENDING')"), 'Must mark terminal jobs as FAILED');
  assert.ok(outboxSource.includes('email_outbox_abandoned_jobs_recovered'), 'Must log recovered abandoned jobs metric');

  // Source contract: renewLockLease extends lock lease
  assert.ok(outboxSource.includes('export async function renewLockLease'), 'Must export renewLockLease');
  assert.ok(outboxSource.includes('SET lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL :extension SECOND)'), 'Must extend lease_until');
});

test('Outbox Worker Daemon: Integrates periodic heartbeat and abandoned job recovery cycle', () => {
  assert.ok(workerSource.includes('recoverAbandonedOutboxJobs(300)'), 'Worker must call recoverAbandonedOutboxJobs(300)');
  assert.ok(workerSource.includes('email_outbox_worker_heartbeat'), 'Worker must log periodic health heartbeat');
  assert.ok(workerSource.includes('getEmailOutboxSummary'), 'Worker must collect outbox summary for heartbeat');
});

test('Streaming Storage Memory Protection: All binary download endpoints stream via Readable pipes (HRMS-DEF-020)', () => {
  // 1. workplace files
  assert.ok(workplaceRoutes.includes('Readable.from(object.buffer).pipe(res)'), 'Workplace file route must pipe buffer via stream');

  // 2. enterprise employee documents
  assert.ok(enterpriseRoutes.includes('Readable.from(file.buffer).pipe(res)'), 'Enterprise employee document route must pipe buffer via stream');

  // 3. enterprise admin documents
  assert.ok(enterpriseRoutes.includes('Readable.from(file.buffer).pipe(res)'), 'Enterprise admin document route must pipe buffer via stream');

  // 4. admin employee profile photos
  assert.ok(adminRoutes.includes('Readable.from(file.buffer).pipe(res)'), 'Admin user profile photo route must pipe buffer via stream');

  // 5. account user profile photos
  assert.ok(accountRoutes.includes('Readable.from(file.buffer).pipe(res)'), 'Account user profile photo route must pipe buffer via stream');

  // Ensure no memory buffering res.send(file.buffer) exists in these storage routes
  assert.ok(!enterpriseRoutes.includes('res.send(file.buffer)'), 'Enterprise routes must not use blocking res.send(file.buffer)');
  assert.ok(!adminRoutes.includes('res.send(file.buffer)'), 'Admin routes must not use blocking res.send(file.buffer)');
  assert.ok(!accountRoutes.includes('res.send(file.buffer)'), 'Account routes must not use blocking res.send(file.buffer)');
});

test('Client-Side Tree-Shaking: Vite Rollup options enforce pure tree-shaking and vendor splitting', () => {
  assert.ok(viteConfig.includes('treeshake: {'), 'Vite config must declare Rollup treeshake options');
  assert.ok(viteConfig.includes('moduleSideEffects: false'), 'Must declare moduleSideEffects: false');
  assert.ok(viteConfig.includes('vendor-react'), 'Must split vendor-react chunk');
  assert.ok(viteConfig.includes('vendor-icons'), 'Must split vendor-icons chunk');
  assert.ok(viteConfig.includes('chunkSizeWarningLimit: 600'), 'Must define chunk size threshold');
});
