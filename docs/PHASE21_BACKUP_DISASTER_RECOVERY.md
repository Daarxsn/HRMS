# Phase 21 — Backup & Disaster Recovery

## Objective
Protect production data and make recovery executable without guessing.

## Automated backup
`.github/workflows/backup-production.yml` creates and verifies a Cloud SQL backup:
- scheduled daily at 02:15 UTC;
- manually runnable for an emergency/change window;
- protected by a single-flight concurrency group;
- authenticated with GitHub OIDC;
- verifies that the newest backup has an ID/status/timestamp.

The production deployment workflow also creates a fresh pre-deployment backup before migrations.

Required production variables:
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CLOUD_SQL_INSTANCE`
- `GCP_DEPLOYER_SERVICE_ACCOUNT`
- `GCP_WIF_PROVIDER`

## Recovery order
1. Stop further application releases.
2. Identify the last known-good Cloud SQL backup.
3. Restore into a separate recovery instance first when possible.
4. Validate schema, migration records, employee/account counts, attendance, leave, settings, and audit data.
5. Point the application to the recovered database only after validation.
6. Run production health checks.
7. Execute business/UAT smoke checks.
8. Record the incident and recovery timestamp.

For an application-only regression, use `Rollback Production` with a known-good immutable image tag. Do not automatically roll the database backward.

## Recovery drill
Before declaring DR operational, perform one non-production restore drill and record backup ID, restore timestamps, schema validation, connectivity, business smoke checks, measured RTO, and measured RPO.
