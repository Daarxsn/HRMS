# Production operations runbook — Vercel + Aiven

## Scope and deployment target

The current deployment target for this closeout is the Vercel project serving both the Vite frontend and Express API via `vercel.json`, with MySQL hosted on Aiven. Confirm the exact Vercel project, production domain, Aiven service/database, and deployed commit in the provider consoles before any production operation. This document does not authorize deployment or mutation of production.

**Provider safety rule:** `.github/workflows/deploy-production.yml`, `backup-production.yml`, `rollback-production.yml`, `launch-production.yml`, and `FINAL_RELEASE_PREFLIGHT.md` contain Google Cloud Run / Cloud SQL / GCS procedures. They are not the deployment or backup workflow for the Vercel + Aiven environment. Do not run those workflows against production or use their success as evidence for Aiven backup/restore. Use Vercel's deployment controls and Aiven's managed backup/restore facilities unless a separately reviewed provider-specific workflow is explicitly created.

## Production environment configuration

Set server-side variables in the Vercel project environment. Do not prefix secrets with `VITE_`, because Vite exposes `VITE_*` values to browser code.

| Variable | Purpose / handling |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact public portal origin, scheme + host only |
| `JWT_SECRET` | Random secret of at least 32 bytes; never log or commit |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `VITE_GOOGLE_CLIENT_ID` | Same public OAuth client ID for browser sign-in |
| `VITE_API_URL` | Usually `/api` for same-origin Vercel services; confirm actual routing |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Exact Aiven MySQL endpoint, port, database |
| `DB_USER`, `DB_PASSWORD` | Dedicated least-privilege runtime user, not Aiven admin or migration/audit user |
| `DB_SSL_MODE` | `REQUIRED` or `VERIFY_CA`; prefer `VERIFY_CA` with `DB_SSL_CA` if supported/configured |
| `DB_SSL_CA` | CA material only if using `VERIFY_CA`; keep secret server-side |
| `DB_CONNECTION_LIMIT`, `DB_MAX_IDLE`, `DB_TRANSACTION_RETRIES` | Explicitly reviewed runtime pool/retry values; do not change without measurements |
| `OFFICE_NETWORK_IPS` | Semicolon-separated stable public office egress IPs; no private LAN IPs |
| `BLOB_READ_WRITE_TOKEN` | Required when using Vercel Blob private object storage; never expose to browser |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Server-side SMTP delivery configuration |
| `SMTP_REQUIRED` | Use `true` when production notification delivery is required |
| `HR_NOTIFICATION_EMAIL` | Designated HR recipient, if required by current notification policy |
| `EMAIL_OUTBOX_CRON_SECRET` | Random secret of at least 32 characters for authenticated outbox dispatch |
| `EMAIL_OUTBOX_WORKER_ENABLED`, `EMAIL_OUTBOX_POLL_MS` | Enable only when operating the long-running worker model; serverless should use the approved scheduled caller |

The exact required-variable gate is defined in `server/src/production-config.mts`; check it at the release commit before changing this table. Do not copy values from this runbook into the Vercel dashboard. Populate secrets directly through the provider's protected settings and verify presence without printing their values.

## Vercel deployment procedure

1. Review the candidate commit and require green CI, integration, security, migration-rehearsal and Playwright checks.
2. Confirm the Vercel project is connected to the intended repository and branch, and that `vercel.json` service roots and rewrites match the current project layout.
3. Verify production environment-variable presence and correct target identities without displaying values. Confirm `DB_USER` is the dedicated runtime user and not the Aiven administrator/migration account.
4. Deploy the reviewed immutable commit through Vercel's normal deployment flow. Do not use a Cloud Run deployment workflow.
5. Confirm the deployment URL and commit SHA in Vercel, then verify portal and API health, security headers, database readiness, and authentication-protected endpoints.
6. Do not promote a preview automatically if the release candidate's migrations, private storage, SMTP/outbox and recovery evidence are incomplete.

## Aiven migration procedure

1. Confirm the selected Aiven service is the intended production MySQL service and is healthy. Verify an Aiven-managed backup exists and is recent enough for the approved change window.
2. Confirm the current migration ledger and schema with a read-only audit identity. Review every pending migration and its compatibility with the currently deployed API.
3. Test the exact migration sequence against a disposable MySQL instance matching the Aiven MySQL major version. Include clean install, populated-database upgrade, constraints, and rollback/failure cases.
4. Schedule a maintenance/change window if the migration can lock or rewrite important tables. Have the database owner approve the change and rollback plan.
5. Run migrations only through an explicitly reviewed Aiven-compatible migration runner using the dedicated migration identity. Do not run a Cloud SQL Job, use Cloud SQL sockets, seed production, or use application/admin credentials for DDL.
6. Verify migration ledger, schema constraints, API readiness, and representative read-only queries. Apply no automatic data repair for attendance or HR anomalies; obtain HR/data-owner approval for any correction.
7. Deploy compatible application code and perform the post-deployment smoke test. Record commit, migration ledger, backup reference, timing and outcomes.

## Backup and restoration

- Use Aiven's managed backup/restore controls and retain the provider's backup identifier, timestamp, retention window and service/database identity in the change record.
- A green Cloud SQL backup workflow does not establish an Aiven backup. Do not run `.github/workflows/backup-production.yml` as an Aiven backup procedure.
- For restore rehearsal, create an isolated Aiven-supported test service/database with no production application traffic and separate credentials. Restore a selected backup there, verify schema/migration ledger and aggregate integrity, then start a test API with outbound email and production side effects disabled.
- Test health/readiness, authentication with a dedicated test identity, attendance reads, leave/WFH state, document metadata/storage access, approvals (only in disposable test data), reports and audit reads.
- Record actual RPO/RTO only after timing a provider-level restore. Destroy isolated resources and revoke temporary credentials afterward. Never restore a test backup over production.

## Private object storage

The application has a Vercel Blob integration. Confirm the deployed `server/src/object-storage.mts` behavior and production configuration gate before release. The production Blob store must be private; use the least-privilege `BLOB_READ_WRITE_TOKEN` server-side. Test upload/download authorization, another employee's document ID/URL denial, invalid content, size limits, unavailable storage, missing token, signed-link expiry (if signed links are used), and cleanup of temporary test files. A GCS bucket configuration is not a substitute for a Vercel Blob configuration.

## Email outbox

Production email is delivered via server-side SMTP and a persistent database outbox. Configure SMTP credentials only on the server. Confirm the scheduled dispatcher or dedicated worker is enabled for the chosen hosting model and authenticates using `EMAIL_OUTBOX_CRON_SECRET`. Test bounded retries, timeout/credential failures, duplicate prevention, eventual recovery and separation between business-operation success and delivery success. Do not assume a background process remains alive inside a serverless function; use a scheduled caller or a separately hosted long-running worker.

## Recovery and incident response

1. Record incident time, affected deployment SHA, request IDs, symptoms and data owner.
2. Check Vercel deployment health/logs, Aiven service health/connection metrics, database readiness, SMTP/outbox backlog and Blob configuration without copying secrets or employee records into the incident.
3. For application regressions, use Vercel's reviewed rollback to a known compatible deployment. A code rollback does not reverse schema changes; follow the migration-specific compatibility/restore plan.
4. For database recovery, follow the Aiven provider's restore process into an isolated target first. Production cutover requires owner approval and an explicit data-loss/RPO decision.
5. Re-run safe smoke tests and record evidence, decision owner and recovery duration.

## Final read-only smoke checks

- Portal HTTPS returns successfully.
- `/api/health/live` and `/api/health/ready` return success.
- Anonymous requests to `/api/auth/me`, `/api/attendance`, `/api/leave`, and `/api/admin/dashboard` are denied as expected.
- Required security headers are present on the actual production portal and API.
- Deployed build SHA and Vercel project identity match the approved candidate.
- No mutation is performed by the anonymous smoke checks. Authenticated employee/admin checks require an authorized test identity and explicit approval; they are not claimed complete by CI alone.
