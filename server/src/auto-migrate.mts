import { access, readdir, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationCandidates = [
  path.join(here, '../migrations'),
  path.join(here, '../../migrations'),
  path.resolve(process.cwd(), 'migrations'),
  path.resolve(process.cwd(), 'server/migrations')
];

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

export async function runAutoMigrations(): Promise<{ applied: string[]; skipped: number }> {
  let migrationDir = '';
  for (const candidate of migrationCandidates) {
    try {
      await access(candidate);
      migrationDir = candidate;
      break;
    } catch {}
  }

  if (!migrationDir) {
    console.warn(JSON.stringify({ type: 'auto_migration_warning', message: 'Migration directory could not be located; auto-migration skipped.' }));
    return { applied: [], skipped: 0 };
  }

  const lockName = 'falchion_xeniaa_schema_migration';
  let connection: any;
  let lockAcquired = false;

  try {
    connection = await pool.getConnection();
    const [lockRows]: any = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      console.warn(JSON.stringify({ type: 'auto_migration_lock', message: 'Could not acquire migration lock within 10s; skipping startup migration.' }));
      return { applied: [], skipped: 0 };
    }

    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const [recordedRows]: any = await connection.query('SELECT version FROM schema_migrations');
    const recordedSet = new Set(recordedRows.map((r: any) => String(r.version)));

    const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (recordedSet.has(file)) continue;

      const sql = await readFile(path.join(migrationDir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      const statements = splitSqlStatements(sql);
      for (const statement of statements) {
        if (!statement.trim()) continue;
        try {
          await connection.query(statement);
        } catch (stmtErr: any) {
          // Allow idempotent execution if table, column, or key already exists
          if (stmtErr?.code === 'ER_DUP_FIELDNAME' || stmtErr?.code === 'ER_TABLE_EXISTS_ERROR' || stmtErr?.code === 'ER_DUP_KEYNAME') {
            continue;
          }
          throw stmtErr;
        }
      }

      await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      applied.push(file);
      console.log(JSON.stringify({ type: 'auto_migration_applied', file }));
    }

    return { applied, skipped: files.length - applied.length };
  } catch (error: any) {
    console.error(JSON.stringify({ type: 'auto_migration_error', error: String(error?.stack || error?.message || error) }));
    return { applied: [], skipped: 0 };
  } finally {
    if (connection) {
      try {
        if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch {}
      connection.release();
    }
  }
}
