# Aiven Production Security Runbook

## Status and safety boundaries

The audited production database is Aiven MySQL, while the older `.github/workflows/backup-production.yml` and `docs/PHASE21_BACKUP_DISASTER_RECOVERY.md` describe Google Cloud SQL. Those Cloud SQL workflows are not evidence of an Aiven backup or a successful Aiven restore.

This repository is public. Never commit passwords, tokens, connection strings, raw database dumps, employee-level data, or unencrypted production audit output. The Aiven production baseline produced by the preflight workflow is encrypted with age before upload. Keep the matching age private key outside GitHub and outside this repository.

The prior terminal audit on 2026-10-20 reported 36 passing checks and one failure: multiple employees had multiple historical open attendance shifts. This is a historical result, not a current verified production result. Do not invent checkout times or update attendance data automatically to make the audit pass.

## Required protected GitHub environment configuration

Create/verify the GitHub environment named `production`. Restrict deployments to `main` and configure required reviewer approval before allowing secret-bearing workflows.

### Environment variables (non-secret)

- `AIVEN_PROJECT` — Aiven project name.
- `AIVEN_SERVICE` — exact Aiven MySQL service name.
- `AIVEN_ADMIN_DB_USER` — exposed administrative username (usually `avnadmin`).
- `AIVEN_RUNTIME_DB_USER` — least-privilege account actually used by the deployed HRMS.
- `AIVEN_MIGRATION_DB_USER` — separate migration identity.
- `AIVEN_AUDIT_DB_USER` — separate read-only audit identity.
- `AIVEN_DB_HOST`, `AIVEN_DB_PORT`, `AIVEN_DB_NAME` — actual production MySQL endpoint.
- `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` — exact production Vercel target.
- `BASELINE_AGE_RECIPIENT` — public age encryption recipient (starts with `age1`). The matching private key must be stored securely outside GitHub.

All four database usernames must be different. The preflight also verifies that the current production Vercel `DB_USER` equals the designated runtime account and is not the administrator.

### Protected production environment secrets

- `AIVEN_API_TOKEN` — Aiven token with the minimum service/user/backup-read permissions required for checks.
- `AIVEN_DB_SSL_CA` — Aiven MySQL CA certificate used for certificate-verified TLS.
- `AIVEN_ADMIN_DB_PASSWORD` — current exposed administrator credential before rotation; the rotation workflow overwrites this same environment secret with its generated replacement once the database change succeeds.
- `AIVEN_MIGRATION_DB_PASSWORD` — migration account password.
- `AIVEN_AUDIT_DB_PASSWORD` — read-only audit account password.
- `VERCEL_TOKEN` — minimum access needed to inspect the target project's production environment and latest deployment.
- `ACTIONS_SECRETS_WRITE_TOKEN` — narrowly scoped GitHub token that can update only the `production` environment secret needed by the rotation workflow. It is used only in the final rotation step and is never printed.

Do not share any of these secret values in chat, terminal transcripts, workflow inputs, issues, or source control. If the GitHub token cannot update environment secrets, the rotation step fails closed before changing the database password.

## Step 1 — rotate the exposed administrator credential

Run **Rotate Exposed Aiven Admin Credential** from Actions and enter the exact confirmation string `ROTATE-EXPOSED-AIVEN-ADMIN`.

Before changing the password, the workflow checks:
- the target is a running Aiven MySQL service;
- admin, runtime, migration, and audit usernames exist and are distinct;
- Aiven reports a recent backup (within the 48-hour check window);
- the latest Vercel production deployment matches the workflow commit, the readiness endpoint is healthy, and production `DB_USER` is the separate non-admin runtime identity.

It then generates a random replacement, writes it directly into the protected `AIVEN_ADMIN_DB_PASSWORD` environment secret without printing it, applies the password change over certificate-verified TLS, verifies the replacement works, and verifies the previous credential is rejected. The HRMS application should not need redeployment because this workflow refuses to proceed unless Vercel is already using the separate runtime account. If any precondition fails, no credential change is attempted. If a post-change connection test fails, the workflow attempts a compensating rollback and reports the resulting state without exposing either password.

If the live application is using the admin account, the rotation action intentionally stops instead of risking production downtime. First migrate the application to a distinct runtime identity and verify readiness.

## Step 2 — separate and verify database access

Run **Aiven Production Security Preflight** with confirmation `RUN-READ-ONLY-PRODUCTION-PREFLIGHT`.

The workflow verifies:
- all purpose-specific service users exist and are distinct;
- runtime account effective grants contain no schema-change or administrator privileges;
- migration account has the required schema/data-change privileges for migrations but no user-administration, grant-option, or platform-administrator privileges;
- audit account has SELECT-only access;
- database access uses certificate-verified TLS;
- the actual Vercel production DB account is the non-admin runtime identity;
- current application deployment, recent backup metadata, migration ledger/checksums, schema metadata, exact row counts, and integrity-audit results are captured.

The workflow suppresses detailed audit output from the public job summary and puts the full report, exact counts, schema fingerprint, migration ledger, deployed/source commit, and audit results into an age-encrypted artifact. Decrypt it only in an approved environment using the private key kept offline.

Aiven's MySQL service-user API supports restrictive `mysql_grants`; omitting that field grants admin-level privileges. The documented allow-list is at [Aiven MySQL service users](https://aiven.io/docs/products/mysql/howto/manage-service-users).

## Step 3 — backup and restore evidence

Aiven for MySQL documents daily full backups and continuous binary-log recording for point-in-time recovery; retention depends on the service plan. See [Aiven MySQL backups](https://aiven.io/docs/products/mysql/concepts/mysql-backups).

The automated preflight only proves that Aiven reports a recent backup. It does **not** prove restoration is recoverable. Before locking production:
1. Fork/restore into a separate recovery service, never over production.
2. Wait for the recovery service to become healthy.
3. Verify TLS connectivity, migration ledger/checksums, schema fingerprint, exact row-count comparison for the key HRMS tables, and read-only integrity audit.
4. Record recovery start/end time and observed RTO/RPO in a private change record.
5. Delete or power off the recovery service after review to control ongoing cost, while preserving the private evidence report.

Creating a recovery fork creates a separate Aiven service and may incur additional cost; this repository workflow does not create that billable service automatically without a specifically approved recovery target.

## Lock criteria

Do **not** mark Step 1 complete or lock production until each item is evidenced:

- [ ] Administrator password rotation succeeded and the old password was rejected.
- [ ] The HRMS production runtime account is distinct from the admin identity and has no DDL/admin privileges.
- [ ] The migration account is distinct and has only the required migration grants.
- [ ] The audit account is distinct, SELECT-only, and connects over certificate-verified TLS.
- [ ] The actual current Aiven backup was verified and a separate restore drill passed.
- [ ] The current deployed commit, migration ledger/checksums, schema fingerprint, exact row counts, and audit result were captured in the encrypted baseline.
- [ ] A fresh production integrity audit has zero failures.
- [ ] Production API readiness and authorized employee/admin smoke tests pass.

The preflight workflow file existing in Git is not proof that a workflow has run successfully. Never report Step 1 as complete until the action results and restore evidence prove every required control.
