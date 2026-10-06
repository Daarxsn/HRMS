import 'dotenv/config';
import { access, readdir, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationCandidates = [path.join(here, '../migrations'), path.join(here, '../../migrations')];
let migrationDir = '';
for (const candidate of migrationCandidates) {
  try { await access(candidate); migrationDir = candidate; break; } catch {}
}
if (!migrationDir) throw new Error('Migration directory could not be located.');
const lockName = 'falchion_xeniaa_schema_migration';
const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();

let connection;
let lockAcquired = false;

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
  await connection.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64) NULL`);

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
      if (recorded && recorded !== checksum) throw new Error(`Migration checksum mismatch for ${file}. Refusing to continue.`);
      if (!recorded) await connection.execute('UPDATE schema_migrations SET checksum=? WHERE version=?', [checksum, file]);
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
