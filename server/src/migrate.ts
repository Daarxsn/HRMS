import 'dotenv/config';
import { access, readdir, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationCandidates = [path.join(here, '../migrations'), path.join(here, '../../migrations')];
let migrationDir = '';
for (const candidate of migrationCandidates) {
  try { await access(candidate); migrationDir = candidate; break; } catch {}
}
if (!migrationDir) throw new Error('Migration directory could not be located.');
const lockName = 'falchion_xeniaa_schema_migration';
// Migration 006 was applied to production before creator-nullability hardening; accept only its exact old checksum.
const approvedLegacyChecksums = new Map<string, Set<string>>([
  ['006_enterprise_hr.sql', new Set(['4f95aab5efc6eda1e10c05f3e108f4e7e1d3ccac31758310465365345fcc9a10'])]
]);
const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();

let connection;
let lockAcquired = false;

async function inspectSchema(connection) {
  const [tablesRows] = await connection.query(
    'SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type=\'BASE TABLE\''
  );
  const tables = new Set(tablesRows.map((row) => String(row.tableName).toLowerCase()));
  const [columnRows] = await connection.query(
    'SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,GENERATION_EXPRESSION AS generationExpression FROM information_schema.columns WHERE table_schema=DATABASE()'
  );
  const [indexRows] = await connection.query(
    'SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsUsed FROM information_schema.statistics WHERE table_schema=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE'
  );
  const [foreignKeyRows] = await connection.query(
    'SELECT TABLE_NAME AS tableName,CONSTRAINT_NAME AS constraintName FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_type=\'FOREIGN KEY\''
  );
  return {
    tables,
    columns: new Map(columnRows.map((row) => [String(row.tableName).toLowerCase()+'.'+String(row.columnName).toLowerCase(), row])),
    indexes: indexRows,
    foreignKeys: foreignKeyRows
  };
}

function hasExpectedIndex(schema, table, name, columns, unique) {
  const item = schema.indexes.find((row) =>
    String(row.tableName).toLowerCase() === table && row.indexName === name
  );
  return Boolean(item && String(item.columnsUsed) === columns && ((Number(item.nonUnique) === 0) === unique));
}

async function preflightPendingMigration(file, connection) {
  const schema = await inspectSchema(connection);

  if (file === '006_enterprise_hr.sql') {
    const enterpriseTables = [
      'employee_emergency_contacts','employment_history','onboarding_tasks','employee_documents',
      'company_assets','company_policies','policy_acknowledgements','separation_cases'
    ];
    const partial = enterpriseTables.filter((table) => schema.tables.has(table));
    if (partial.length) {
      throw new Error(
        'Migration preflight blocked 006: enterprise tables already exist without a recorded 006 migration. ' +
        'Possible partial/manual application: ' + partial.join(', ') + '. Review schema before changing anything.'
      );
    }
    if (!schema.tables.has('employees')) {
      throw new Error('Migration preflight blocked 006: base employees table is missing.');
    }
  }

  if (file === '007_wifi_attendance_method.sql') {
    for (const name of ['attendance_records.check_in_method','attendance_records.check_out_method']) {
      const column = schema.columns.get(name);
      if (!column) throw new Error('Migration preflight blocked 007: missing ' + name + '.');
      if (String(column.columnType).includes('OFF_PREMISES')) {
        throw new Error('Migration preflight blocked 007: OFF_PREMISES already exists while 007 is unrecorded; schema may contain part of 008.');
      }
    }
  }

  if (file === '008_attendance_workflow_integrity.sql') {
    if (!schema.tables.has('wfh_requests') || !schema.tables.has('attendance_records')) {
      throw new Error('Migration preflight blocked 008: base WFH or attendance table is missing.');
    }
    const oldUnique = schema.indexes.some((row) =>
      String(row.tableName).toLowerCase()==='wfh_requests' && row.indexName==='uq_wfh_employee_day'
    );
    const oldFk = schema.foreignKeys.some((row) =>
      String(row.tableName).toLowerCase()==='wfh_requests' && row.constraintName==='fk_wfh_employee'
    );
    const activeColumn = schema.columns.get('wfh_requests.active_request_date');
    const activeUnique = hasExpectedIndex(schema,'wfh_requests','uq_wfh_active_employee_day','employee_id,active_request_date',true);
    const supportIndex = hasExpectedIndex(schema,'wfh_requests','idx_wfh_employee_request_date','employee_id,request_date',false);
    const newFk = schema.foreignKeys.some((row) =>
      String(row.tableName).toLowerCase()==='wfh_requests' && row.constraintName==='fk_wfh_employee_active'
    );
    const attendanceEnumsReady = ['attendance_records.check_in_method','attendance_records.check_out_method'].every((name) => {
      const value = String(schema.columns.get(name)?.columnType || '');
      return value.includes('WIFI') && value.includes('OFF_PREMISES');
    });
    const cleanPre008 = oldUnique && oldFk && !activeColumn && !activeUnique && !supportIndex && !newFk && !attendanceEnumsReady;
    const complete008 = !oldUnique && !oldFk && Boolean(activeColumn) && activeUnique && supportIndex && newFk && attendanceEnumsReady;
    if (complete008) {
      const duplicates = await connection.query(
        "SELECT COUNT(*) AS count FROM (SELECT employee_id, active_request_date FROM wfh_requests WHERE active_request_date IS NOT NULL GROUP BY employee_id, active_request_date HAVING COUNT(*)>1) AS duplicated_active"
      );
      if (Number(duplicates[0][0]?.count || 0) !== 0) {
        throw new Error('Migration preflight blocked 008 reconciliation: duplicate active WFH dates remain.');
      }
      return 'RECONCILE_COMPLETE_SCHEMA';
    }
    if (!cleanPre008) {
      throw new Error(
        'Migration preflight blocked 008: WFH schema is neither the complete legacy state nor the complete 008 state. ' +
        'Detected mixed/partial application; inspect indexes, foreign keys, generated column and attendance enums before proceeding.'
      );
    }
    const duplicates = await connection.query(
      "SELECT COUNT(*) AS count FROM (SELECT employee_id, request_date FROM wfh_requests WHERE status IN ('PENDING','APPROVED') GROUP BY employee_id, request_date HAVING COUNT(*)>1) AS duplicated_active"
    );
    if (Number(duplicates[0][0]?.count || 0) !== 0) {
      throw new Error('Migration preflight blocked 008: duplicate active WFH requests must be reviewed before adding uniqueness.');
    }
    const pendingCorrections = await connection.query(
      "SELECT COUNT(*) AS count FROM (SELECT employee_id, attendance_date FROM attendance_correction_requests WHERE status='PENDING' GROUP BY employee_id, attendance_date HAVING COUNT(*)>1) AS duplicated_corrections"
    );
    if (Number(pendingCorrections[0][0]?.count || 0) !== 0) {
      throw new Error('Migration preflight blocked 008: duplicate pending correction requests must be reviewed before proceeding.');
    }
  }

  if (file === '009_enterprise_history_nullable_creator.sql') {
    const creator = schema.columns.get('employment_history.created_by');
    if (!schema.tables.has('employment_history') || !creator) {
      throw new Error('Migration preflight blocked 009: employment_history.created_by is missing; migration 006 must be reviewed first.');
    }
  }

  return 'READY';
}

try {
  connection = await pool.getConnection();
  const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  lockAcquired = Number(lockRows[0]?.acquired) === 1;
  if (!lockAcquired) throw new Error('Could not acquire the database migration lock within 30 seconds.');

  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [checksumColumns] = await connection.query(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'checksum'`);
  if (Number(checksumColumns[0]?.count) === 0) await connection.query('ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL');

  const [recordedRows] = await connection.query('SELECT version, checksum FROM schema_migrations');
  const knownFiles = new Set(files);
  for (const row of recordedRows) {
    if (!knownFiles.has(row.version)) throw new Error(`Recorded migration is missing from source tree: ${row.version}`);
  }

  for (const file of files) {
    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const [rows] = await connection.execute('SELECT version, checksum FROM schema_migrations WHERE version = ?', [file]);
    if (rows.length) {
      const recorded = rows[0].checksum;
      const approvedLegacy = Boolean(recorded && approvedLegacyChecksums.get(file)?.has(String(recorded).toLowerCase()));
      if (recorded && recorded !== checksum && !approvedLegacy) throw new Error(`Migration checksum mismatch for ${file}. Refusing to continue.`);
      if (approvedLegacy) console.warn(`Accepted the explicitly allow-listed legacy checksum for ${file}; historical ledger bytes remain unchanged.`);
      if (!recorded) await connection.execute('UPDATE schema_migrations SET checksum=? WHERE version=?', [checksum, file]);
      continue;
    }
    const preflight = await preflightPendingMigration(file, connection);
    if (preflight === 'RECONCILE_COMPLETE_SCHEMA') {
      await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      console.warn(`Reconciled ${file} ledger because all expected schema changes are present and the active-WFH integrity check passed.`);
      continue;
    }
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
    console.log(`Applied ${file}`);
  }
} finally {
  if (connection) {
    try {
      if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } finally {
      connection.release();
    }
  }
  await pool.end();
}
