# Final HRMS Release Preflight

This checklist is the final gate between code freeze and production launch. Repository changes can enforce and verify configuration, but real company infrastructure values must be supplied in the protected GitHub environments.

## 1. Production GitHub environment

Configure protected environment `production` with these non-secret variables:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_AR_REPOSITORY`
- `CLOUD_RUN_SERVICE`
- `CLOUD_RUN_MIGRATION_JOB`
- `CLOUD_SQL_CONNECTION`
- `CLOUD_SQL_INSTANCE`
- `CLOUD_RUN_SERVICE_ACCOUNT`
- `GCP_DEPLOYER_SERVICE_ACCOUNT`
- `GCP_WIF_PROVIDER`
- `DB_NAME`
- `DB_USER`
- `GCS_BUCKET`
- `APP_ORIGIN`
- `OFFICE_NETWORK_IPS`
- `GOOGLE_CLIENT_ID`
- `DB_PASSWORD_SECRET`
- `JWT_SECRET_NAME`
- `DB_PASSWORD_SECRET_VERSION`
- `JWT_SECRET_VERSION`

Store only secret references in GitHub variables. Store the DB password and JWT payloads in Google Secret Manager.

## 2. Domain and OAuth

Use one exact portal origin and one API origin, for example:

- Portal: `https://portal.<company-domain>`
- API: `https://api.<company-domain>`

Set:

`APP_ORIGIN=https://portal.<company-domain>`

Vercel production:

`VITE_API_URL=https://api.<company-domain>/api`

`VITE_GOOGLE_CLIENT_ID=<same Web OAuth client ID>`

Register the exact portal origin in the Google OAuth Web client. The production API must return the same origin in its CORS response for approved browser requests.

## 3. Database and storage

Production must have:

- Cloud SQL MySQL instance in RUNNABLE state.
- Production database and least-privilege application user.
- Migration job connectivity.
- A successful backup before production migration.
- Private GCS bucket with Public Access Prevention enforced.
- Cloud Run runtime identity with only required Cloud SQL and bucket permissions.

Never run the seed command against production. The application now hard-fails the seed command when `NODE_ENV=production`.

## 4. Automated verification

Run **Production Readiness Preflight** with the exact public portal and API URLs.

It verifies:

- required production configuration is present;
- Cloud SQL exists;
- DB password/JWT Secret Manager versions are enabled;
- secret payloads are non-empty and the JWT payload meets the 32-byte requirement without printing secret values;
- GCS bucket exists and public access prevention is enforced;
- portal/API are reachable over HTTPS;
- API liveness and database-backed readiness pass;
- exact-origin CORS is working;
- production security headers are present;
- demo authentication is disabled.

Run **Production Smoke Test** after production deployment. It verifies the public portal, API liveness/readiness, anonymous access protection, disabled demo login, and baseline security headers.

## 5. Staging

Before release candidate creation, run **Deploy Staging** against a real staging environment and verify:

- migrations complete;
- Cloud Run deployment completes;
- liveness passes;
- readiness/database connectivity passes;
- staging portal points at the staging API;
- Google OAuth uses the staging origin;
- real staging smoke/UAT scenarios pass.

The Release Candidate workflow refuses to publish a release without a successful staging deployment for the exact commit.

## 6. HR/UAT

Run **HRMS UAT Sign-off** only after the release candidate has passed CI, Playwright and staging.

The protected `uat` environment should require the designated HR/business reviewer.

The UAT test must include at least one authorized admin and one authorized employee and verify login, attendance, leave/WFH, approvals, attachments, notifications, reports and mobile behavior.

## 7. Production launch

Only after UAT approval:

1. Create/verify the production backup.
2. Run **HRMS Production Launch** for the immutable release tag.
3. Verify Cloud Run liveness/readiness.
4. Run **Production Smoke Test**.
5. Perform real admin/employee browser smoke tests on the company domain.
6. Confirm the final GO/NO-GO with HR/business owner.

The repository is considered launch-ready only after the infrastructure workflows and real-user smoke tests pass.