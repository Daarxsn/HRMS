# HRMS Database Migration & Integrity Audit

## Purpose and safety boundary

This audit compares the connected database with the repository's eight SQL migrations and checks critical schema constraints plus aggregate data-integrity anomalies.

The audit program is \`server/test/production-integrity-audit.ts\`; run it with \`npm run db:audit\` only for CI or through the direct Node command below for production.

**The audit is read-only.** It executes \`SELECT\` queries against application tables and \`information_schema\`. It does not execute migration files, create/alter/drop tables, change migration ledger rows, seed fixtures, or update/delete business data. Use a database account with \`SELECT\` access only. Do not use the normal application or migration credentials if a read-only identity is available.

The report contains schema names, migration filenames, check results, MySQL version, and aggregate anomaly counts. It does not print employee-level row contents. Treat even this summary as internal operational information.

## What it checks

- MySQL version, selected database and InnoDB use.
- Required application tables and 22 critical columns.
- Migration ledger entries compared with every SQL file in \`server/migrations/\`.
- SHA-256 checksum match for every applied migration recorded in \`schema_migrations\`.
- Stored generated expression, indexes, uniqueness and foreign keys for attendance and WFH workflows.
- Duplicate attendance per employee/date, checkout-before-check-in, checkout without check-in, and multiple open shifts.
- Orphan attendance/leave/WFH employee references and invalid leave date ranges/durations.
- Duplicate active WFH requests and active WFH that overlaps a pending/approved leave request.

A WFH/leave overlap is reported as a warning rather than an automatic failure because historical production records may require HR review. The audit never tries to repair a finding.

## CI validation

GitHub Actions runs the audit against an isolated disposable MySQL 8.4 database after applying all migrations and seeding test fixtures:

\`\`\`sh
HRMS_DB_AUDIT_TARGET=ci npm run db:audit --workspace server
\`\`\`

CI results prove that the source migrations and audit script behave on a clean test database. They do not establish that production has the same schema or clean data.

## Run the audit against production

### 1. Prepare a read-only database identity

Prefer an existing database identity with read-only access, or ask the database administrator to create a dedicated audit user with \`SELECT\` access only to the HRMS database. Do not grant \`INSERT\`, \`UPDATE\`, \`DELETE\`, \`CREATE\`, \`ALTER\`, \`DROP\`, or migration privileges.

For a MySQL service that allows SQL-managed user grants, the shape is:

\`\`\`sql
CREATE USER 'hrms_integrity_audit'@'<permitted-client-host>'
  IDENTIFIED BY '<unique-strong-password>';
GRANT SELECT ON \`<production_database>\`.* TO 'hrms_integrity_audit'@'<permitted-client-host>';
\`\`\`

Replace every placeholder with provider-approved values; do not run this example literally. Managed database providers may require creating the user through their console. Use the smallest client-host/network allow-list that will permit the audit workstation to connect.

### 2. Create a private local environment file

From the repository root, create \`.env.audit\`. This file is ignored by Git by the existing \`.env.*\` rule. Do not commit it or paste its contents into chat or an issue.

Example shape, with values filled in locally:

\`\`\`dotenv
NODE_ENV=production
HRMS_DB_AUDIT_TARGET=production
DB_HOST=<production-database-host>
DB_PORT=3306
DB_NAME=<production-database-name>
DB_USER=hrms_integrity_audit
DB_PASSWORD=<read-only-audit-user-password>
DB_SSL_MODE=REQUIRED
DB_CONNECTION_LIMIT=2
DB_MAX_IDLE=1
DB_TRANSACTION_RETRIES=0
\`\`\`

Use \`DB_SSL_MODE=VERIFY_CA\` with the provider's CA certificate in \`DB_SSL_CA\` when supported by the database service. Otherwise \`REQUIRED\` enables TLS but does not validate the server certificate. Never disable TLS for this audit.

Set restrictive file permissions and confirm Git ignores the file:

\`\`\`sh
chmod 600 .env.audit
git check-ignore -v .env.audit
\`\`\`

Do not copy the production application's write-capable credentials into this file. If the database provider restricts client IPs, run the audit from a trusted machine/network already approved by the provider rather than opening the database to all IP addresses.

### 3. Run the read-only audit

Run from the repository root with Node.js 22 or newer:

\`\`\`sh
set -o pipefail
node --env-file=.env.audit --experimental-strip-types server/test/production-integrity-audit.ts \\
  | tee "hrms-db-audit-$(date +%Y%m%d-%H%M%S).log"
\`\`\`

The command exits non-zero if required schema, migration checksum, index, foreign key or data-integrity checks fail. Review the aggregate report before making any database changes.

### 4. Preserve evidence safely

Keep the output log with the audit ticket/change record, but do not attach \`.env.audit\`. Share the audit report only with authorized maintainers. Do not run \`npm run db:migrate\`, \`npm run db:seed\`, or any repair SQL as part of the audit.

## How to triage findings

- **Missing migration or checksum mismatch:** stop; confirm the correct database and release commit. Do not rewrite the migration ledger or edit a historical migration just to silence the report.
- **Missing table/column/index/foreign key:** compare \`schema_migrations\`, the source migrations and the deployed commit. Plan a reviewed, backed-up migration separately; do not repair directly during this audit.
- **Data anomaly:** examine only the affected records through an authorized HR/database process, preserve an evidence trail, and approve any correction before writing data.
- **Connection/permission failure:** check host, port, TLS, selected database and the read-only user's grants. Never work around the error by using a broad administrator account or exposing production secrets.

## Current status

- CI migration path and the read-only audit pass against clean MySQL 8.4 test data.
- Production migration/checksum/schema/data findings remain **unverified until the audit is run against the actual production database**.
