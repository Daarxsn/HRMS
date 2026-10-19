# Production Database Migration Recovery — Aiven MySQL

## Current findings

The production read-only audit connected successfully to MySQL 8.4.8 and the defaultdb database. Migration checksums for 001–005 matched repository source. Migrations 006–008 were not recorded as applied. Missing tables, WFH active-date metadata, related keys, and attendance enum values are expected consequences of that schema drift.

The audit also found three employee groups with multiple open attendance shifts. This is a separate data-integrity finding. It is not a reason to delete or rewrite records automatically.

## Mandatory safety gates

1. A database administrator password was pasted into a chat during troubleshooting. Treat it as compromised and rotate it in Aiven. If any deployed runtime uses that username, update that runtime's secret and verify its database-backed readiness before continuing.
2. Use a fresh, verified Aiven connection endpoint, port, and database name from the active Aiven service's connection information.
3. Create/use separate identities: a SELECT-only audit user for audits, and a migration-capable account for the approved migration run. Do not put admin/write-capable credentials in .env.audit.
4. Take a manual/pre-migration Aiven backup and confirm it completed successfully. Record the backup ID/time and confirm the recovery/restore path is available before altering production schema.
5. Pull the reviewed main commit and complete the preflight audit using the read-only user. Do not proceed if it reports no active administrator (migration 006 needs an actor for the employee-history backfill), or if fk_wfh_employee is missing while the legacy uq_wfh_employee_day index is present.

Do not run migrations in response to a health-check screenshot alone. Keep a maintenance/change record and have the person responsible for production data approve the migration window.

## Prepare a local migration environment file

From the repository root, create .env.migration. This filename is covered by the .env.* ignore rule. Never commit it, display it to the terminal, or paste its contents into chat.

Populate it locally with values copied from the active Aiven service's connection details and a migration account that has the privileges needed by the reviewed SQL migrations:

~~~dotenv
NODE_ENV=production
DB_HOST=<verified-aiven-host>
DB_PORT=<verified-aiven-port>
DB_NAME=<verified-database-name>
DB_USER=<migration-user>
DB_PASSWORD=<new-migration-user-password>
DB_SSL_MODE=REQUIRED
DB_CONNECTION_LIMIT=2
DB_MAX_IDLE=1
DB_TRANSACTION_RETRIES=0
~~~

DB_SSL_MODE=REQUIRED encrypts MySQL traffic. Where practical, use VERIFY_CA with the Aiven CA certificate for certificate validation. Never disable TLS for production.

Set permissions and confirm Git ignores it:

~~~sh
chmod 600 .env.migration
git check-ignore -v .env.migration
~~~

## Apply the pending migrations

Only after credential rotation, backup confirmation, and preflight review, run from the current repository root:

~~~sh
set -o pipefail
node --env-file=.env.migration --experimental-strip-types server/src/migrate.ts \
  | tee "hrms-db-migrate-$(date +%Y%m%d-%H%M%S).log"
~~~

The migration runner uses a MySQL advisory lock, applies source migrations missing from schema_migrations, checks recorded checksums, and records applied checksums. In the audited database, migrations 001–005 already match current source, so expected pending migrations are 006, 007 and 008.

This command changes the production schema and writes the migration ledger. It is intentionally separate from the read-only audit. Do not run it with .env.audit or a SELECT-only user. Stop immediately on any error; do not manually insert migration ledger rows, edit historical migration files to bypass checksums, or rerun unknown repair SQL. Preserve the output log with the change record.

## Post-migration verification

1. Replace .env.audit credentials with the dedicated SELECT-only audit user. Use the latest main checkout.
2. Rerun the read-only audit:

~~~sh
set -o pipefail
node --env-file=.env.audit --experimental-strip-types server/test/production-integrity-audit.ts \
  | tee "hrms-db-audit-postmigration-$(date +%Y%m%d-%H%M%S).log"
~~~

3. Confirm all eight migrations are recorded and checksums match, all expected tables/columns/indexes/foreign keys exist, both attendance enums include WIFI and OFF_PREMISES, and the data checks report no unexpected anomalies.
4. Check /api/health/ready and perform a limited administrator/employee smoke test. Do not report the app healthy based on database ping alone.
5. Investigate the three open-shift employee groups separately. Use the read-only query below to identify their dates and record counts locally; do not post employee identifiers or row-level personal data publicly.

~~~sql
SELECT
  e.employee_code,
  COUNT(*) AS open_shift_count,
  MIN(a.attendance_date) AS oldest_open_date,
  MAX(a.attendance_date) AS newest_open_date,
  SUM(a.attendance_date < CURRENT_DATE()) AS prior_date_open_shifts
FROM attendance_records AS a
JOIN employees AS e ON e.id = a.employee_id
WHERE a.check_in_at IS NOT NULL
  AND a.check_out_at IS NULL
GROUP BY e.id, e.employee_code
HAVING COUNT(*) > 1
ORDER BY oldest_open_date;
~~~

HR must determine whether the underlying shifts reflect missed check-outs, overnight work, or another legitimate scenario. Any correction should be an individually reviewed, authorized, and audit-logged attendance correction—not a blanket update or delete.

## Completion criteria

Point 2 is complete only after the production migration output is clean, the post-migration read-only audit passes, health/readiness and a controlled smoke test pass, and the three multiple-open-shift findings are resolved or explicitly accepted with documented owners and due dates. CI passing on a disposable database is necessary but not a substitute for production verification.
