import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(here, '../migrations');
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
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  for (const file of files) {
    const [rows] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ?', [file]);
    if (rows.length) continue;

    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
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
