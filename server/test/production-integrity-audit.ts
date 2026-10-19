import crypto from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.mts';

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
type Finding = { status: Status; area: string; detail: string };

const target = String(process.env.HRMS_DB_AUDIT_TARGET || '');
if (!['ci', 'production'].includes(target)) {
  console.error('Set HRMS_DB_AUDIT_TARGET to ci or production before running the read-only audit.');
  process.exit(2);
}
if (target === 'production' && process.env.NODE_ENV !== 'production') {
  console.error('Production audit requires NODE_ENV=production.');
  process.exit(2);
}

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const findings: Finding[] = [];
const missingTables = new Set<string>();
const requiredTables = [
  'employees','system_settings','attendance_records','leave_requests','wfh_requests',
  'attendance_correction_requests','flex_start_requests','notifications','audit_logs',
  'company_holidays','attachments','qr_challenges','qr_challenge_uses','temporary_exits',
  'employee_schedule_exceptions','employee_emergency_contacts','employment_history','onboarding_tasks',
  'employee_documents','company_assets','company_policies','policy_acknowledgements','separation_cases','schema_migrations'
];

function report(status: Status, area: string, detail: string) {
  findings.push({ status, area, detail });
  const message = '[' + status + '] ' + area + ': ' + detail;
  if (status === 'FAIL') console.error(message);
  else console.log(message);
}

async function rows(sql: string, params: unknown[] = []) {
  const [result] = await pool.query(sql, params);
  return result as any[];
}

async function zeroCount(area: string, sql: string, tables: string[], warning = false) {
  if (tables.some((table) => missingTables.has(table))) {
    report('SKIP', area, 'Required table is missing; see schema findings.');
    return;
  }
  try {
    const result = await rows(sql);
    const count = Number(result[0]?.count || 0);
    report(count === 0 ? 'PASS' : warning ? 'WARN' : 'FAIL', area,
      count === 0 ? 'No anomalies found.' : String(count) + ' anomalous group(s)/row(s) found.');
  } catch {
    report('FAIL', area, 'Read-only query failed; check schema version and SELECT privileges.');
  }
}

function hasIndex(indexes: any[], table: string, name: string, columns: string, unique: boolean) {
  const index = indexes.find((item) => String(item.tableName).toLowerCase() === table && item.indexName === name);
  return Boolean(index && String(index.columnsUsed) === columns && ((Number(index.nonUnique) === 0) === unique));
}

async function main() {
  const identity = await rows('SELECT DATABASE() AS databaseName, VERSION() AS serverVersion');
  const databaseName = String(identity[0]?.databaseName || '');
  const serverVersion = String(identity[0]?.serverVersion || '');
  report(databaseName ? 'PASS' : 'FAIL', 'Connection identity',
    databaseName ? 'Connected to selected database "' + databaseName + '".' : 'No database is selected.');

  const version = serverVersion.match(/^(\d+)\.(\d+)/);
  const supportedVersion = Boolean(version && Number(version[1]) >= 8);
  report(supportedVersion ? 'PASS' : 'FAIL', 'MySQL version',
    supportedVersion ? 'MySQL ' + serverVersion : 'Expected MySQL 8.x or newer; received ' + (serverVersion || 'unknown') + '.');

  const tableRows = await rows('SELECT TABLE_NAME AS tableName, ENGINE AS engine FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\'');
  const tableMap = new Map<string, any>();
  for (const item of tableRows) tableMap.set(String(item.tableName).toLowerCase(), item);
  for (const table of requiredTables) if (!tableMap.has(table)) missingTables.add(table);
  report(missingTables.size === 0 ? 'PASS' : 'FAIL', 'Required tables', missingTables.size === 0
    ? String(requiredTables.length) + ' required tables exist.'
    : 'Missing tables: ' + [...missingTables].join(', '));

  const badEngines = tableRows.filter((item) => requiredTables.includes(String(item.tableName).toLowerCase())
    && String(item.engine || '').toUpperCase() !== 'INNODB').map((item) => String(item.tableName));
  report(badEngines.length === 0 ? 'PASS' : 'FAIL', 'Transactional storage engine', badEngines.length === 0
    ? 'All present required tables use InnoDB.' : 'Required tables without InnoDB: ' + badEngines.join(', '));

  // Verify the ledger only: this script never applies or repairs migrations.
  if (missingTables.has('schema_migrations')) {
    report('FAIL', 'Migration ledger', 'schema_migrations is missing.');
  } else {
    try {
      const ledger = await rows('SELECT version, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version');
      const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
      const sourceSet = new Set(files);
      const appliedSet = new Set(ledger.map((item) => String(item.version)));
      const unexpected = ledger.filter((item) => !sourceSet.has(String(item.version))).map((item) => String(item.version));
      const notApplied = files.filter((file) => !appliedSet.has(file));
      report(unexpected.length === 0 ? 'PASS' : 'FAIL', 'Migration ledger/source consistency',
        unexpected.length === 0 ? 'No ledger entries are absent from source.' : 'Unexpected ledger entries: ' + unexpected.join(', '));
      report(notApplied.length === 0 ? 'PASS' : 'FAIL', 'Migration coverage',
        notApplied.length === 0 ? String(files.length) + ' source migrations are recorded.' : 'Not recorded as applied: ' + notApplied.join(', '));

      for (const file of files) {
        const applied = ledger.find((item) => String(item.version) === file);
        if (!applied) continue;
        const source = await readFile(path.join(migrationsDir, file), 'utf8');
        const expected = crypto.createHash('sha256').update(source).digest('hex');
        const actual = String(applied.checksum || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(actual)) {
          report('FAIL', 'Checksum ' + file, 'Missing or invalid SHA-256 checksum in ledger.');
        } else if (actual !== expected) {
          report('FAIL', 'Checksum ' + file, 'Production checksum differs from repository source.');
        } else {
          report('PASS', 'Checksum ' + file, 'Matches repository source.');
        }
      }
    } catch {
      report('FAIL', 'Migration ledger', 'Could not read ledger/checksums; verify SELECT privileges and schema version.');
    }
  }

  if (!missingTables.has('employees')) {
    try {
      const activeAdminRows = await rows("SELECT COUNT(*) AS count FROM employees WHERE role='ADMIN' AND status='ACTIVE'");
      const activeAdminCount = Number(activeAdminRows[0]?.count || 0);
      report(activeAdminCount > 0 ? 'PASS' : 'FAIL', 'Migration 006 backfill prerequisite',
        activeAdminCount > 0 ? 'At least one active administrator exists for employment-history backfill.' : 'No active administrator exists; migration 006 backfill would fail its required created_by value.');
    } catch {
      report('FAIL', 'Migration 006 backfill prerequisite', 'Could not verify an active administrator using a read-only count query.');
    }
  } else {
    report('SKIP', 'Migration 006 backfill prerequisite', 'Employees table is missing; cannot check the required backfill actor.');
  }

  await zeroCount('Migration 008 preflight: duplicate active WFH dates',
    'SELECT COUNT(*) AS count FROM (SELECT employee_id, request_date FROM wfh_requests WHERE status IN (\'PENDING\',\'APPROVED\') GROUP BY employee_id, request_date HAVING COUNT(*) > 1) AS active_request_duplicates',
    ['wfh_requests']);

  const columns = await rows('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression FROM information_schema.columns WHERE table_schema = DATABASE()');
  const columnMap = new Map<string, any>();
  for (const item of columns) columnMap.set(String(item.tableName).toLowerCase() + '.' + String(item.columnName).toLowerCase(), item);

  const requiredColumns = [
    'schema_migrations.version','schema_migrations.checksum','schema_migrations.applied_at',
    'employees.id','employees.employee_code','employees.email','employees.session_version',
    'attendance_records.id','attendance_records.employee_id','attendance_records.attendance_date',
    'attendance_records.check_in_at','attendance_records.check_out_at','attendance_records.check_in_method','attendance_records.check_out_method',
    'leave_requests.employee_id','leave_requests.start_date','leave_requests.end_date','leave_requests.status',
    'wfh_requests.employee_id','wfh_requests.request_date','wfh_requests.status','wfh_requests.active_request_date'
  ];
  const absentColumns = requiredColumns.filter((item) => !columnMap.has(item));
  report(absentColumns.length === 0 ? 'PASS' : 'FAIL', 'Critical columns', absentColumns.length === 0
    ? String(requiredColumns.length) + ' required columns exist.' : 'Missing columns: ' + absentColumns.join(', '));

  const generated = columnMap.get('wfh_requests.active_request_date');
  if (generated) {
    const expression = String(generated.generationExpression || '').toUpperCase();
    const valid = /PENDING/.test(expression) && /APPROVED/.test(expression) && /REQUEST_DATE/.test(expression)
      && /STORED GENERATED/i.test(String(generated.extra || ''));
    report(valid ? 'PASS' : 'FAIL', 'WFH generated active date',
      valid ? 'Stored generated column reflects pending/approved status.' : 'Generated column definition does not match the required active-request rule.');
  } else {
    report('FAIL', 'WFH generated active date', 'Missing wfh_requests.active_request_date.');
  }

  const indexes = await rows('SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsUsed FROM information_schema.statistics WHERE table_schema = DATABASE() GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE');
  const indexChecks = [
    ['attendance_records','uq_attendance_employee_date','employee_id,attendance_date',true],
    ['wfh_requests','uq_wfh_active_employee_day','employee_id,active_request_date',true],
    ['wfh_requests','idx_wfh_employee_request_date','employee_id,request_date',false],
    ['employees','employee_code','employee_code',true],
    ['employees','email','email',true]
  ] as const;
  for (const [table, name, columnList, unique] of indexChecks) {
    if (missingTables.has(table)) {
      report('SKIP', 'Index ' + name, 'Table is missing; see schema findings.');
      continue;
    }
    const valid = hasIndex(indexes, table, name, columnList, unique);
    report(valid ? 'PASS' : 'FAIL', 'Index ' + name, valid ? 'Expected columns and uniqueness are present.' : 'Index is missing or differs from expected columns/uniqueness.');
  }
  const legacyIndex = indexes.some((item) => String(item.tableName).toLowerCase() === 'wfh_requests' && item.indexName === 'uq_wfh_employee_day');
  report(legacyIndex ? 'FAIL' : 'PASS', 'Legacy WFH uniqueness index', legacyIndex
    ? 'Old all-status index uq_wfh_employee_day remains.' : 'Old all-status WFH index is absent.');

  const foreignKeys = await rows('SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_type = \'FOREIGN KEY\'');
  const legacyWfhUnique = indexes.some((item) => String(item.tableName).toLowerCase() === 'wfh_requests' && item.indexName === 'uq_wfh_employee_day');
  const legacyWfhForeignKey = foreignKeys.some((item) => String(item.tableName).toLowerCase() === 'wfh_requests' && item.constraintName === 'fk_wfh_employee');
  if (legacyWfhUnique) {
    report(legacyWfhForeignKey ? 'PASS' : 'FAIL', 'Migration 008 legacy WFH prerequisite',
      legacyWfhForeignKey ? 'Legacy WFH employee foreign key exists for the 008 replacement ALTER.' : 'Legacy unique index exists but fk_wfh_employee is missing; do not run migration 008 until this schema drift is reviewed.');
  } else {
    report('SKIP', 'Migration 008 legacy WFH prerequisite', 'Legacy unique index is already absent; inspect active WFH index/foreign-key state before running an unrecorded migration.');
  }
  const expectedFks = [
    ['attendance_records','fk_attendance_employee'],
    ['leave_requests','fk_leave_employee'],
    ['wfh_requests','fk_wfh_employee_active']
  ] as const;
  for (const [table, name] of expectedFks) {
    if (missingTables.has(table)) {
      report('SKIP', 'Foreign key ' + name, 'Table is missing; see schema findings.');
      continue;
    }
    const valid = foreignKeys.some((item) => String(item.tableName).toLowerCase() === table && item.constraintName === name);
    report(valid ? 'PASS' : 'FAIL', 'Foreign key ' + name, valid ? 'Expected employee reference exists.' : 'Expected foreign key is missing.');
  }

  for (const name of ['attendance_records.check_in_method','attendance_records.check_out_method']) {
    const item = columnMap.get(name);
    if (!item) continue;
    const type = String(item.columnType || '');
    const valid = type.includes('WIFI') && type.includes('OFF_PREMISES');
    report(valid ? 'PASS' : 'FAIL', 'Attendance enum ' + name,
      valid ? 'WIFI and OFF_PREMISES are supported.' : 'Expected attendance method values are missing.');
  }

  await zeroCount('Duplicate attendance per employee/date',
    'SELECT COUNT(*) AS count FROM (SELECT employee_id, attendance_date FROM attendance_records GROUP BY employee_id, attendance_date HAVING COUNT(*) > 1) AS duplicates',
    ['attendance_records']);
  await zeroCount('Checkout before check-in',
    'SELECT COUNT(*) AS count FROM attendance_records WHERE check_in_at IS NOT NULL AND check_out_at IS NOT NULL AND check_out_at < check_in_at',
    ['attendance_records']);
  await zeroCount('Checkout timestamp without check-in',
    'SELECT COUNT(*) AS count FROM attendance_records WHERE check_in_at IS NULL AND check_out_at IS NOT NULL',
    ['attendance_records']);
  await zeroCount('Multiple open shifts per employee',
    'SELECT COUNT(*) AS count FROM (SELECT employee_id FROM attendance_records WHERE check_out_at IS NULL AND check_in_at IS NOT NULL GROUP BY employee_id HAVING COUNT(*) > 1) AS multiple_open',
    ['attendance_records']);
  await zeroCount('Orphan attendance employee references',
    'SELECT COUNT(*) AS count FROM attendance_records a LEFT JOIN employees e ON e.id = a.employee_id WHERE e.id IS NULL',
    ['attendance_records','employees']);
  await zeroCount('Orphan leave employee references',
    'SELECT COUNT(*) AS count FROM leave_requests l LEFT JOIN employees e ON e.id = l.employee_id WHERE e.id IS NULL',
    ['leave_requests','employees']);
  await zeroCount('Orphan WFH employee references',
    'SELECT COUNT(*) AS count FROM wfh_requests w LEFT JOIN employees e ON e.id = w.employee_id WHERE e.id IS NULL',
    ['wfh_requests','employees']);
  await zeroCount('Invalid leave ranges/duration',
    'SELECT COUNT(*) AS count FROM leave_requests WHERE start_date > end_date OR days <= 0',
    ['leave_requests']);
  if (columnMap.has('wfh_requests.active_request_date')) {
    await zeroCount('Duplicate active WFH requests',
      'SELECT COUNT(*) AS count FROM (SELECT employee_id, active_request_date FROM wfh_requests WHERE active_request_date IS NOT NULL GROUP BY employee_id, active_request_date HAVING COUNT(*) > 1) AS duplicate_wfh',
      ['wfh_requests']);
  } else {
    report('SKIP', 'Duplicate active WFH requests', 'Requires migration 008 active_request_date; the schema finding above must be resolved before this check can run.');
  }
  await zeroCount('Active WFH overlapping pending/approved leave',
    'SELECT COUNT(*) AS count FROM wfh_requests w JOIN leave_requests l ON l.employee_id = w.employee_id AND l.start_date <= w.request_date AND l.end_date >= w.request_date WHERE w.status IN (\'PENDING\',\'APPROVED\') AND l.status IN (\'PENDING\',\'APPROVED\')',
    ['wfh_requests','leave_requests'], true);

  const failures = findings.filter((item) => item.status === 'FAIL');
  const warnings = findings.filter((item) => item.status === 'WARN');
  const passes = findings.filter((item) => item.status === 'PASS');
  report(failures.length === 0 ? 'PASS' : 'FAIL', 'Summary',
    passes.length + ' pass, ' + failures.length + ' fail, ' + warnings.length + ' warning(s).');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '# HRMS read-only database integrity audit', '',
      '- Target: ' + target,
      '- MySQL version: ' + (serverVersion || 'unknown'),
      '- Passed: ' + passes.length,
      '- Failed: ' + failures.length,
      '- Warnings: ' + warnings.length, '',
      '| Status | Check | Result |', '|---|---|---|',
      ...findings.map((item) => '| ' + item.status + ' | ' + item.area.replace(/\|/g, '\\|') + ' | ' + item.detail.replace(/\|/g, '\\|') + ' |'),
      '',
      'Read-only audit: SELECT queries only; no migrations or business records were changed and no employee-level data is included.', ''
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), 'utf8');
  }
  if (failures.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error: unknown) {
  // Emit only non-secret error metadata. Avoid printing the full error message,
  // SQL query text, connection string, or any environment variable values.
  const diagnostic = error && typeof error === 'object' ? error as {
    code?: unknown; errno?: unknown; sqlState?: unknown; syscall?: unknown;
  } : {};
  const safeCode = typeof diagnostic.code === 'string' && /^[A-Z0-9_]+$/i.test(diagnostic.code)
    ? diagnostic.code : 'UNKNOWN';
  const safeErrno = typeof diagnostic.errno === 'number' ? diagnostic.errno : 'n/a';
  const safeSqlState = typeof diagnostic.sqlState === 'string' && /^[A-Z0-9]{5}$/i.test(diagnostic.sqlState)
    ? diagnostic.sqlState : 'n/a';
  const safeSyscall = typeof diagnostic.syscall === 'string' && /^[a-z0-9_ -]+$/i.test(diagnostic.syscall)
    ? diagnostic.syscall : 'n/a';
  const detail = 'code=' + safeCode + '; errno=' + safeErrno + '; sqlState=' + safeSqlState + '; syscall=' + safeSyscall;
  console.error('[FAIL] Database audit could not complete (' + detail + '). Check host/port/database, TLS settings and read-only SELECT privileges. No database changes were attempted.');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '\n## HRMS database audit\n\n**FAIL** — ' + detail + '. No database changes were attempted. Connection secrets and query text were not logged.\n', 'utf8');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
