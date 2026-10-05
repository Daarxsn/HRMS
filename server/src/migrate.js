import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(path.join(here, '../migrations'))).filter((f) => f.endsWith('.sql')).sort();
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
  for (const file of files) {
    const [rows] = await pool.execute('SELECT version FROM schema_migrations WHERE version = ?', [file]);
    if (rows.length) continue;
    const sql = await readFile(path.join(here, '../migrations', file), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(statement);
    await pool.execute('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
