import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const migrationsDir = path.join(serverDir, 'migrations');
const host = String(process.env.DB_HOST || '');
const port = Number(process.env.DB_PORT || 3306);
const user = String(process.env.DB_USER || '');
const password = String(process.env.DB_PASSWORD || '');
const baseName = String(process.env.DB_NAME || '');
if (process.env.CI !== 'true' || process.env.HRMS_MIGRATION_REHEARSAL !== 'true' ||
    process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host) ||
    !/_ci$/.test(baseName) || !user) {
  throw new Error('Migration rehearsal is restricted to an explicitly enabled local CI MySQL database; production and non-CI targets are refused.');
}

const suffix = Date.now().toString(36) + '_' + process.pid.toString(36);
const dbNames = {
  clean: ('hrms_rehearsal_clean_' + suffix).slice(0, 60),
  populatedAdmin: ('hrms_rehearsal_admin_' + suffix).slice(0, 60),
  populatedNoAdmin: ('hrms_rehearsal_noadmin_' + suffix).slice(0, 60),
  partial006: ('hrms_rehearsal_partial6_' + suffix).slice(0, 60),
  partial008: ('hrms_rehearsal_partial8_' + suffix).slice(0, 60)
};
const created = [];
const migrations = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
const migrationSource = new Map();
for (const name of migrations) migrationSource.set(name, await readFile(path.join(migrationsDir, name), 'utf8'));

function connect(database) {
  return mysql.createConnection({
    host, port, user, password,
    ...(database ? { database } : {}),
    connectTimeout: 10000,
    multipleStatements: false
  });
}
function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prevChar = i > 0 ? sql[i - 1] : '';

    if (char === "'" && !inDoubleQuote && !inBacktick && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inBacktick && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && prevChar !== '\\') {
      inBacktick = !inBacktick;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
function executeSqlFile(connection, sql) {
  return (async () => {
    for (const statement of splitSqlStatements(sql)) {
      await connection.query(statement);
    }
  })();
}
async function createDatabase(name) {
  assert.match(name, /^[a-zA-Z0-9_]+$/);
  const connection = await connect(undefined);
  try {
    await connection.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    created.push(name);
  } finally {
    await connection.end();
  }
}
async function applyBaseMigrations(name) {
  const connection = await connect(name);
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    for (const filename of migrations.filter((n) => /^00[1-5]_/.test(n))) {
      await executeSqlFile(connection, migrationSource.get(filename));
      await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [filename, checksum(migrationSource.get(filename))]);
    }
  } finally {
    await connection.end();
  }
}
function runMigrator(name, expectedSuccess = true) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'src/migrate.ts'], {
    cwd: serverDir,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: host,
      DB_PORT: String(port),
      DB_NAME: name,
      DB_USER: user,
      DB_PASSWORD: password,
      HRMS_MIGRATION_REHEARSAL: 'true'
    }
  });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (expectedSuccess && result.status !== 0) throw new Error('Migration rehearsal failed for ' + name + ':\n' + output.slice(-8000));
  if (!expectedSuccess && result.status === 0) throw new Error('Expected partial-schema preflight to block migration for ' + name + ', but the migrator returned success.\n' + output);
  return output;
}
async function insertFixtureEmployees(name, withAdmin) {
  const connection = await connect(name);
  const ids = { admin: crypto.randomUUID(), employee: crypto.randomUUID(), second: crypto.randomUUID() };
  try {
    if (withAdmin) {
      await connection.execute(
        "INSERT INTO employees (id,employee_code,full_name,email,role,user_type,status,title,joined_on,wfh_enabled) VALUES (?,?,?,?, 'ADMIN','ADMIN','ACTIVE','Rehearsal administrator','2025-01-06',FALSE)",
        [ids.admin, 'RHA-' + suffix, 'Rehearsal Administrator', 'reh-admin-' + suffix + '@example.test']
      );
    }
    await connection.execute(
      "INSERT INTO employees (id,employee_code,full_name,email,role,user_type,status,title,joined_on,wfh_enabled) VALUES (?,?,?,?, 'EMPLOYEE','EMPLOYEE','ACTIVE','Rehearsal employee','2025-01-06',FALSE)",
      [ids.employee, 'RHE-' + suffix, 'Rehearsal Employee', 'reh-employee-' + suffix + '@example.test']
    );
    if (!withAdmin) {
      await connection.execute(
        "INSERT INTO employees (id,employee_code,full_name,email,role,user_type,status,title,joined_on,wfh_enabled) VALUES (?,?,?,?, 'EMPLOYEE','EMPLOYEE','ACTIVE','Second rehearsal employee','2025-01-07',FALSE)",
        [ids.second, 'RHS-' + suffix, 'Second Rehearsal Employee', 'reh-second-' + suffix + '@example.test']
      );
    }
    await connection.execute(
      "INSERT INTO attendance_records (id,employee_id,attendance_date,check_in_at,check_out_at,check_in_method,check_out_method,status) VALUES (?,?, '2026-01-05','2026-01-05 03:00:00','2026-01-05 11:00:00','GPS','GPS','ON_TIME')",
      [crypto.randomUUID(), ids.employee]
    );
    await connection.execute(
      "INSERT INTO leave_requests (id,employee_id,leave_type,start_date,end_date,days,reason,status) VALUES (?,?, 'CASUAL','2026-01-06','2026-01-06',1,'Migration preservation rehearsal','REJECTED')",
      [crypto.randomUUID(), ids.employee]
    );
    await connection.execute(
      "INSERT INTO wfh_requests (id,employee_id,request_date,request_kind,reason,status) VALUES (?,?, '2026-02-02','PLANNED','Historical rejected WFH request for migration rehearsal','REJECTED')",
      [crypto.randomUUID(), ids.employee]
    );
    return ids;
  } finally {
    await connection.end();
  }
}
async function rowCounts(name) {
  const connection = await connect(name);
  try {
    const counts = {};
    for (const table of ['employees','attendance_records','leave_requests','wfh_requests']) {
      const [rows] = await connection.query('SELECT COUNT(*) AS count FROM `' + table + '`');
      counts[table] = Number(rows[0].count);
    }
    return counts;
  } finally {
    await connection.end();
  }
}
async function verifyAllMigrations(name) {
  const connection = await connect(name);
  try {
    const [ledger] = await connection.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
    assert.deepEqual(ledger.map((row) => String(row.version)), migrations);
    for (const row of ledger) {
      assert.equal(String(row.checksum), checksum(migrationSource.get(String(row.version))), 'Checksum mismatch for ' + row.version);
    }
    const [columns] = await connection.query(
      "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,GENERATION_EXPRESSION AS generationExpression FROM information_schema.columns WHERE table_schema=DATABASE()"
    );
    const columnMap = new Map(columns.map((row) => [String(row.tableName).toLowerCase()+'.'+String(row.columnName).toLowerCase(),row]));
    const [tables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'");
    const tableNames = new Set(tables.map((row) => String(row.name).toLowerCase()));
    for (const table of ['employee_emergency_contacts','employment_history','onboarding_tasks','employee_documents','company_assets','company_policies','policy_acknowledgements','separation_cases']) {
      assert.ok(tableNames.has(table), 'Migration 006 table missing: ' + table);
    }
    const creator = columnMap.get('employment_history.created_by');
    assert.ok(creator, 'employment_history.created_by is missing');
    assert.equal(String(creator.isNullable).toUpperCase(), 'YES');
    const activeDate = columnMap.get('wfh_requests.active_request_date');
    assert.ok(activeDate, 'Migration 008 active_request_date is missing');
    assert.match(String(activeDate.extra).toLowerCase(), /stored generated/);
    assert.match(String(activeDate.generationExpression).toUpperCase(), /PENDING/);
    assert.match(String(activeDate.generationExpression).toUpperCase(), /APPROVED/);
    for (const name of ['attendance_records.check_in_method','attendance_records.check_out_method']) {
      const type = String(columnMap.get(name)?.columnType || '');
      assert.match(type, /WIFI/);
      assert.match(type, /OFF_PREMISES/);
    }
    const [indexes] = await connection.query(
      "SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsUsed FROM information_schema.statistics WHERE table_schema=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE"
    );
    const lookup = (table, index) => indexes.find((row) => String(row.tableName).toLowerCase() === table && row.indexName === index);
    assert.equal(lookup('wfh_requests','uq_wfh_employee_day'), undefined, 'Legacy WFH unique index remains');
    assert.equal(Number(lookup('wfh_requests','uq_wfh_active_employee_day')?.nonUnique), 0);
    assert.equal(String(lookup('wfh_requests','uq_wfh_active_employee_day')?.columnsUsed), 'employee_id,active_request_date');
    assert.equal(String(lookup('wfh_requests','idx_wfh_employee_request_date')?.columnsUsed), 'employee_id,request_date');
    const [fks] = await connection.query("SELECT TABLE_NAME AS tableName,CONSTRAINT_NAME AS name FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_type='FOREIGN KEY'");
    assert.ok(fks.some((fk) => String(fk.tableName).toLowerCase()==='wfh_requests' && fk.name==='fk_wfh_employee_active'));
  } finally {
    await connection.end();
  }
}
async function testWfhReapplication(name, employeeId) {
  const connection = await connect(name);
  try {
    await connection.execute(
      "INSERT INTO wfh_requests (id,employee_id,request_date,request_kind,reason,status) VALUES (?,?, '2026-02-02','PLANNED','Reapplication after a rejection is allowed','PENDING')",
      [crypto.randomUUID(), employeeId]
    );
    await assert.rejects(
      connection.execute(
        "INSERT INTO wfh_requests (id,employee_id,request_date,request_kind,reason,status) VALUES (?,?, '2026-02-02','PLANNED','Second active request must be rejected','APPROVED')",
        [crypto.randomUUID(), employeeId]
      ),
      (error) => error?.code === 'ER_DUP_ENTRY'
    );
    await connection.execute("UPDATE wfh_requests SET status='CANCELLED' WHERE employee_id=? AND request_date='2026-02-02' AND status='PENDING'", [employeeId]);
    await connection.execute(
      "INSERT INTO wfh_requests (id,employee_id,request_date,request_kind,reason,status) VALUES (?,?, '2026-02-02','PLANNED','Reapplication after cancellation is allowed','PENDING')",
      [crypto.randomUUID(), employeeId]
    );
  } finally {
    await connection.end();
  }
}
async function partial006IsBlocked(name) {
  const connection = await connect(name);
  try {
    await connection.query('CREATE TABLE employee_documents (id CHAR(36) PRIMARY KEY) ENGINE=InnoDB');
  } finally {
    await connection.end();
  }
  const output = runMigrator(name, false);
  assert.match(output, /preflight blocked 006/i);
  const c = await connect(name);
  try {
    const [rows] = await c.execute("SELECT COUNT(*) AS count FROM schema_migrations WHERE version='006_enterprise_hr.sql'");
    assert.equal(Number(rows[0].count), 0, '006 should not be recorded after partial-state detection');
  } finally { await c.end(); }
}
async function partial008IsBlocked(name) {
  const connection = await connect(name);
  try {
    for (const file of ['006_enterprise_hr.sql','007_wifi_attendance_method.sql']) {
      await executeSqlFile(connection, migrationSource.get(file));
      await connection.execute('INSERT INTO schema_migrations (version,checksum) VALUES (?,?)', [file,checksum(migrationSource.get(file))]);
    }
    await connection.query("ALTER TABLE wfh_requests ADD COLUMN active_request_date DATE GENERATED ALWAYS AS (CASE WHEN status IN ('PENDING','APPROVED') THEN request_date ELSE NULL END) STORED");
  } finally {
    await connection.end();
  }
  const output = runMigrator(name, false);
  assert.match(output, /preflight blocked 008/i);
  const c = await connect(name);
  try {
    const [rows] = await c.execute("SELECT COUNT(*) AS count FROM schema_migrations WHERE version='008_attendance_workflow_integrity.sql'");
    assert.equal(Number(rows[0].count), 0, '008 should not be recorded after partial-state detection');
  } finally { await c.end(); }
}

const dropped = [];
try {
  // Clean installation: no employee or administrator exists when 006 backfill runs.
  await createDatabase(dbNames.clean);
  runMigrator(dbNames.clean);
  runMigrator(dbNames.clean);
  await verifyAllMigrations(dbNames.clean);
  assert.deepEqual(await rowCounts(dbNames.clean), {employees:0,attendance_records:0,leave_requests:0,wfh_requests:0});

  for (const scenario of [
    { key: 'populatedAdmin', withAdmin: true },
    { key: 'populatedNoAdmin', withAdmin: false }
  ]) {
    const name = dbNames[scenario.key];
    await createDatabase(name);
    await applyBaseMigrations(name);
    const ids = await insertFixtureEmployees(name, scenario.withAdmin);
    const before = await rowCounts(name);
    runMigrator(name);
    runMigrator(name);
    await verifyAllMigrations(name);
    assert.deepEqual(await rowCounts(name), before, 'Migrations must preserve employee/attendance/leave/WFH row counts for ' + scenario.key);

    const connection = await connect(name);
    try {
      const [history] = await connection.execute("SELECT employee_id,created_by FROM employment_history WHERE event_type='JOINED'");
      const expectedHistoryCount = scenario.withAdmin ? 2 : 2;
      assert.equal(history.length, expectedHistoryCount);
      if (scenario.withAdmin) {
        assert.ok(history.every((row) => row.created_by === ids.admin), 'Backfill should retain active administrator as creator where available');
      } else {
        assert.ok(history.every((row) => row.created_by === null), 'Backfill without an administrator must not fabricate a creator');
      }
    } finally {
      await connection.end();
    }
    if (scenario.withAdmin) await testWfhReapplication(name, ids.employee);
  }

  await createDatabase(dbNames.partial006);
  await applyBaseMigrations(dbNames.partial006);
  await partial006IsBlocked(dbNames.partial006);

  await createDatabase(dbNames.partial008);
  await applyBaseMigrations(dbNames.partial008);
  await partial008IsBlocked(dbNames.partial008);

  console.log('Migration rehearsal PASS: clean install; populated data with/without active admin; 006–009 migration idempotency; employee/attendance/leave/WFH row-count preservation; WFH reject/cancel reapplication; partial 006 and 008 states fail closed.');
} finally {
  const connection = await connect(undefined);
  try {
    for (const name of created.reverse()) {
      try {
        await connection.query('DROP DATABASE IF EXISTS `' + name + '`');
      } catch {
        dropped.push(name);
      }
    }
  } finally {
    await connection.end();
  }
  if (dropped.length) console.error('Warning: test databases could not be dropped cleanly: ' + dropped.join(', '));
}
