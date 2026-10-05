# Phase 4 — Production Launch Integration & UAT

## Purpose

Phase 4 turns the Phase 3 production-ready baseline into a controlled launch path. The application code and locked business rules remain unchanged. This phase adds a repeatable production deployment mechanism, a database migration release gate, post-deploy health verification, and a browser/device user-acceptance checklist.

## Scope

### 4.1 Production deployment automation

The repository now contains a manually triggered GitHub Actions workflow at `.github/workflows/deploy-production.yml`.

The workflow:

1. Authenticates to Google Cloud with GitHub OIDC / Workload Identity Federation.
2. Builds the production API image with Cloud Build and stores it in Artifact Registry.
3. Runs the repository migration runner as a one-task Cloud Run Job.
4. Deploys the same immutable image to the Cloud Run API service.
5. Verifies the deployed service through liveness and database-backed readiness checks.
6. Writes the deployed image and health results into the GitHub Actions job summary.

The workflow deliberately uses Workload Identity Federation rather than a long-lived service-account key. Google documents OIDC federation for GitHub Actions as the preferred pattern for avoiding exported long-lived credentials. citeturn371461search0turn371461search2

### 4.2 Database release gate

Migrations run in a Cloud Run Job using the same application image that is being released. This keeps the schema runner and API code on the same commit and avoids running schema changes from an untrusted or ad-hoc workstation.

Cloud Run Jobs support one-off executions and a wait-for-completion flow, which is used by the workflow before API deployment. citeturn246726search0turn246726search1

The migration runner already serializes concurrent migrations using a MySQL advisory lock.

### 4.3 Production secrets

The deployment expects the runtime database password and JWT signing secret to live in Google Secret Manager. They are injected into both the migration job and Cloud Run service as secret-backed environment variables.

Google recommends Secret Manager for sensitive Cloud Run values; this phase therefore does not put database passwords or JWT secrets in GitHub repository files. citeturn246726search2

Secret versions are supplied explicitly through GitHub environment variables so a rotation can be controlled and audited.

### 4.4 Cloud SQL connection

The API and migration job use the Cloud Run Cloud SQL connection and the MySQL Unix socket path:

`/cloudsql/<project>:<region>:<instance>`

Google's current Cloud Run / Cloud SQL guidance supports attaching the Cloud SQL instance to Cloud Run and using the Unix socket connection path. citeturn149071search1turn149071search5

### 4.5 User acceptance testing

The production acceptance pass must cover:

| Area | Acceptance |
| --- | --- |
| Login | Authorized Google identity signs in; unauthorized identity is rejected |
| Employee dashboard | Home, profile, notifications, calendar and balances load |
| GPS attendance | Check-in/out records one location verification per explicit action |
| QR fallback | Active QR works only within its validity window and per-event use restriction |
| WFH | Eligible employee can request; approval changes effective attendance |
| Leave | Shared casual/sick pool, earned, floating and sick-note rule behave as locked |
| Flex start | Employee request and administrator approval change the effective start time |
| Corrections | Employee request, administrator approval and audit notification work |
| Temporary exit | Exit/return timestamps record without creating continuous location tracking |
| Admin | People, attendance, approvals, holidays, settings, QR and audit views work |
| Attachments | Private documents upload/download only for authorized users |
| Reports | CSV downloads and formula-safe export behavior remain intact |
| Mobile/PWA | Core workflows work on supported mobile browsers and installed PWA |
| Security | Session expiry, role checks, CORS and rate limits behave as expected |
| Health | `/api/health/live` and `/api/health/ready` both pass after deployment |

## Required GitHub production environment variables

Create a protected GitHub Environment named `production` and define:

| Variable | Purpose |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_REGION` | Cloud Run / Artifact Registry region |
| `GCP_AR_REPOSITORY` | Artifact Registry Docker repository |
| `CLOUD_RUN_SERVICE` | Production API Cloud Run service name |
| `CLOUD_RUN_MIGRATION_JOB` | Cloud Run Job used for schema migrations |
| `CLOUD_SQL_CONNECTION` | Cloud SQL connection name |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | GitHub OIDC deployment identity used to build/deploy |
| `CLOUD_RUN_SERVICE_ACCOUNT` | Runtime service account used by the API and migration job |
| `GCP_WIF_PROVIDER` | Full GitHub OIDC Workload Identity Provider resource name |
| `DB_NAME` | Production database name |
| `DB_USER` | Least-privilege application database user |
| `GCS_BUCKET` | Private attachment bucket |
| `APP_ORIGIN` | Exact production portal origin |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `DB_PASSWORD_SECRET` | Secret Manager name containing the DB password |
| `JWT_SECRET_NAME` | Secret Manager name containing the JWT secret |
| `DB_PASSWORD_SECRET_VERSION` | Secret version used for the DB password |
| `JWT_SECRET_VERSION` | Secret version used for the JWT secret |

Do not put secret values themselves into GitHub variables. Only resource identifiers and secret names/versions belong there.

## Google Cloud permissions

The GitHub deployment identity needs only the permissions required to build and deploy. Google documents the Cloud Run / Cloud Build roles and the Workload Identity Federation flow for GitHub Actions. citeturn149071search0turn149071search6

The GitHub deployment identity should be separate from the Cloud Run runtime service account. The deployment identity needs only the build/deploy permissions required by the workflow.

The Cloud Run runtime service account separately needs:

- Cloud SQL Client access to the target Cloud SQL instance.
- Secret Manager Secret Accessor access to the two runtime secrets.
- Cloud Storage object access limited to the private HRMS attachment bucket.

Keep deployment identity permissions separate from runtime service permissions.

## First deployment procedure

1. Create the production Cloud SQL database and application user.
2. Create the private GCS attachment bucket with public access prevention.
3. Create the two Secret Manager secrets and record their versions.
4. Configure the Google OAuth Web client for the exact production portal origin.
5. Configure GitHub Workload Identity Federation restricted to `Daarxsn/HRMS`.
6. Create the protected `production` GitHub Environment and add the variables above.
7. Configure the Cloud Run service account and its runtime roles.
8. Run **Deploy Production** manually from GitHub Actions.
9. Confirm the migration job completed.
10. Confirm liveness and readiness checks passed.
11. Configure Vercel with the deployed API URL and matching Google client ID.
12. Run the full Phase 4 UAT matrix before real employee onboarding.

## Release rules

- Never run the local seed script against the production database.
- Never commit `.env`, database passwords, JWT secrets, service-account keys or OAuth private credentials.
- Deploy an immutable image tag tied to the Git commit.
- Apply migrations before sending production traffic to a new application version.
- Use a protected production environment for deployment approval.
- Record the released commit/image in the deployment summary.

## Phase 4 exit gate

Phase 4 is **not locked** merely because the workflow file exists.

It is locked only after a real company-owned environment completes:

- production database migration;
- production Cloud Run deployment;
- private attachment storage test;
- authorized and unauthorized Google login tests;
- employee and administrator UAT;
- mobile/PWA smoke test;
- health endpoint verification;
- rollback/redeploy drill.

Until those company-owned resources and credentials are available, the repository remains **Phase 4 implementation-ready, not production-deployed**.
