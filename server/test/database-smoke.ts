import assert from 'node:assert/strict';
import { pool } from '../src/db.mts';

try {
  const [tables] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
  const names = new Set(tables.map((row) => row.TABLE_NAME || row.table_name));
  const required = [
    'employees','system_settings','attendance_records','leave_requests','wfh_requests',
    'attendance_correction_requests','flex_start_requests','notifications','audit_logs',
    'company_holidays','attachments','qr_challenges','qr_challenge_uses','temporary_exits',
    'employee_schedule_exceptions','schema_migrations'
  ];
  for (const table of required) assert.ok(names.has(table), `Missing required table: ${table}`);

  const [migrationRows] = await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  assert.ok(migrationRows.some((row) => row.version === '001_initial_schema.sql'), 'Initial schema migration is not recorded');
  assert.ok(migrationRows.some((row) => row.version === '002_session_revocation.sql'), 'Session revocation migration is not recorded');
  assert.ok(migrationRows.some((row) => row.version === '003_retire_qr_setting.sql'), 'QR retirement migration is not recorded');
  assert.ok(migrationRows.every((row) => /^[a-f0-9]{64}$/.test(String(row.checksum || ''))), 'Every applied migration must have a SHA-256 checksum');

  const [employeeRows] = await pool.query("SELECT COUNT(*) AS total FROM employees WHERE status='ACTIVE'");
  assert.ok(Number(employeeRows[0].total) >= 11, 'Expected seeded local workforce plus administrator');

  const [settings] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key='geofence_meters'");
  assert.equal(Number(settings[0]?.setting_value), 80, 'Locked 80m geofence setting is missing');
  const [qrSetting] = await pool.query("SELECT COUNT(*) AS total FROM system_settings WHERE setting_key='qr_ttl_seconds'");
  assert.equal(Number(qrSetting[0].total), 0, 'Retired QR setting is still present');

  console.log('Database smoke verification: PASS');
} finally {
  await pool.end();
}
