# Aiven Production Security Runbook

## Safety boundary

This repository is public. Do not place production credentials, raw database snapshots, employee-level records, connection strings, SQL dumps, or detailed production audit output in tracked files, issue comments, workflow logs, or public artifacts. Store secrets in the protected `production` environment. The automated preflight intentionally emits only sanitized status and aggregate audit counts.

The existing `backup-production.yml` and `PHASE21_BACKUP_DISASTER_RECOVERY.md` describe a Google Cloud SQL path. They are **not evidence** that an Aiven MySQL database has a recent backup or a tested restore. The Aiven database observed during the HRMS audit must be verified separately.

## Automated readiness gate

Run **Aiven Production Security Preflight** from GitHub Actions only after its protected environment variables and secrets are configured. The workflow fails closed unless it can verify:
- Aiven's configured service is MySQL and is running.
- Admin, application-runtime, migration, and read-only-audit usernames are distinct and exist on the service.
- Aiven returns at least one backup and the newest backup timestamp is within 48 hours.
- The Vercel production environment uses the designated non-admin runtime identity.
- The latest Vercel production deployment corresponds to the workflow's source commit and the deployed readiness endpoint responds successfully.
- The database audit identity can connect over certificate-verified TLS and its effective grants are read-only.
- The repository's read-only production integrity audit completes with no failures.

Detailed audit output is redirected to a temporary runner file and is not uploaded or printed because repository Actions logs can be visible to people who can read this public repository.

## Required protected production environment configuration

Create these non-secret **environment variables** on the GitHub `production` environment:
- `AIVEN_PROJECT`
- `AIVEN_SERVICE`
- `AIVEN_ADMIN_DB_USER`
- `AIVEN_RUNTIME_DB_USER`
- `AIVEN_MIGRATION_DB_USER`
- `AIVEN_AUDIT_DB_USER`
- `AIVEN_DB_HOST`
- `AIVEN_DB_PORT`
- `AIVEN_DB_NAME`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID`

Create these **environment secrets**:
- `AIVEN_API_TOKEN` — a short-lived Aiven token with the minimum service/project read permissions needed for metadata checks.
- `AIVEN_AUDIT_DB_PASSWORD` — password for the dedicated read-only database user.
- `AIVEN_DB_SSL_CA` — the Aiven MySQL CA certificate used for certificate-verified TLS.
- `VERCEL_TOKEN` — a Vercel token with access to inspect the target project and production environment.

The audit user must be created with SELECT-only privileges. Do not reuse the application's runtime credentials or an administrator user for the audit. The workflow tests the actual grants with `SHOW GRANTS`; it rejects any grant including data writes, DDL, privilege delegation, or other administrative privileges.

## Credential rotation sequence

1. Confirm the Vercel production `DB_USER` is the dedicated runtime account and is not the administrator. The preflight enforces this before a subsequent rotation workflow should be allowed.
2. Rotate the exposed Aiven administrator service-user credential in Aiven's service **Connect → Users** panel (or the service-user credential-reset API). Do not reset all service credentials if only one user is exposed.
3. Do not put the new administrator password in application environment variables. The application must keep using the non-admin runtime identity.
4. Verify the old administrator password is rejected, using a controlled credential test. Do not paste either password into the terminal transcript, GitHub logs, or chat.
5. Verify the deployed runtime identity still connects and `/api/health/ready` passes. Redeploy only if the application's own environment values actually changed.

Aiven's service-user API can create users with restricted `mysql_grants`; omitting that field grants admin-level privileges. Restrict service-user grants at creation. See [Aiven's MySQL service-user documentation](https://aiven.io/docs/products/mysql/howto/manage-service-users).

## Access separation

- **Administrator:** break-glass platform/database administration only. Never use for routine app requests or audits.
- **Runtime user:** DML required by the HRMS at runtime; no schema-management or user-administration privileges.
- **Migration user:** used only by an approved migration operation; has only the DDL and data permissions required by the repository migrations; not configured as the app's runtime user.
- **Integrity-audit user:** SELECT-only; TLS certificate verification required; connection pool capped at two.

The preflight requires four distinct identities. Review the grant set for the runtime and migration users as part of the controlled account-change record before locking production.

## Backup and restore evidence

Aiven for MySQL documents automatic full backups daily and continuous binary-log recording for point-in-time recovery; retention depends on the service plan. This is provider capability, not proof that this specific service has a recent usable backup. See [Aiven's backup documentation](https://aiven.io/docs/products/mysql/concepts/mysql-backups).

Before production can be locked:
- The automated gate must verify a recent service backup.
- A restore/fork must be performed into a separate recovery service, never over production.
- Verify service starts, TLS connectivity, schema/migration checksums, aggregate row-count parity, and HRMS health checks against the recovery target.
- Record restore start/end times and measured RTO/RPO in a **private** change record; do not commit the detailed record to this public repository.

## Baseline record

The database migrations 006–008 were applied to the audited Aiven database on 2026-10-20. The subsequent terminal audit reported that all eight migration records/checksums matched the repository and that required schema/index/foreign-key/enum checks passed; one remaining integrity failure was multiple open attendance shifts. This describes the supplied terminal output and is not a newly executed check from this workflow.

Use the automated preflight to capture current deployment and database gate results. Keep exact project/service identifiers, backup timestamps, row counts, employee-level exceptions, account names, and full integrity output in a private incident/change record.

## Lock criteria

Production is not locked until every item below is evidenced:
- [ ] Administrator credential rotated; old password tested and rejected.
- [ ] Runtime, migration, administrator, and audit users are distinct; grants were verified.
- [ ] Vercel production DB user matches the designated non-admin runtime identity.
- [ ] Recent Aiven backup verified and a separate restore drill passed.
- [ ] App deployment commit and database baseline recorded for the same change window.
- [ ] Read-only production integrity audit has zero failures.
- [ ] Live readiness and authorized employee/admin smoke tests pass.

Do not mark this runbook complete merely because the migration command succeeded or the preflight workflow file exists.
