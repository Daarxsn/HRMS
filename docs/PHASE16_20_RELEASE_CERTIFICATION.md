# Phases 16–20 Release Certification

## Phase 16 — Database / migration certification
- Migration execution uses a database advisory lock.
- Applied migrations are recorded in `schema_migrations`.
- Each applied migration stores a SHA-256 checksum.
- Existing checksum-less records are backfilled safely.
- Missing migration files and changed applied migrations fail closed.
- CI runs migrations twice to verify idempotence.
- Database smoke verification requires all locked tables, migrations, settings, and migration checksums.
- Production API images package the migration directory required by the compiled migration runner.

## Phase 17 — Playwright E2E
- `playwright.config.ts` defines deterministic CI execution.
- Chromium desktop and Pixel 7 mobile projects are covered.
- Employee demo sign-in and action center are covered.
- Administrator demo sign-in and workplace pulse are covered.
- Mobile navigation is covered.
- CI installs only Chromium and publishes the Playwright report.
- Failed tests retain trace, screenshot, and video evidence.

## Phase 18 — Mobile / PWA certification
- Responsive breakpoints cover desktop, tablet, mobile, and very-small screens.
- Mobile navigation uses an explicit open/close interaction.
- Safe-area insets are respected for mobile overlays and toasts.
- Touch targets use `touch-action: manipulation`.
- Manifest uses standalone display and an installable icon.
- Service worker caches only the application shell/static same-origin GET responses.
- API paths are explicitly excluded from service-worker caching.
- Navigation is network-first with cached-shell fallback.
- Reduced-motion preferences are respected.

## Phase 19 — Monitoring / observability
- Liveness and DB-backed readiness endpoints are available.
- Health responses are `no-store`.
- Every request receives an `X-Request-ID`.
- Structured HTTP request logs include request ID, method, path, status, and duration.
- Structured process-level logs capture uncaught exceptions and unhandled rejections.
- Production health verification is part of deployment and rollback workflows.

## Phase 20 — Staging
- A dedicated `staging` GitHub environment is supported.
- Staging has an independent Cloud Run service, migration job, database, secrets, storage bucket, and portal origin.
- Staging deployment is manual and concurrency-protected.
- The staging workflow validates all required configuration before deployment.
- Migrations run before the API deployment.
- Liveness and readiness are mandatory post-deploy gates.

### Staging environment contract

Configure these GitHub Environment Variables/Secrets under **Settings → Environments → staging** using the same names as the production workflow, but pointing to staging resources:

`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_AR_REPOSITORY`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_MIGRATION_JOB`, `CLOUD_SQL_CONNECTION`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, `CLOUD_RUN_SERVICE_ACCOUNT`, `GCP_WIF_PROVIDER`, `DB_NAME`, `DB_USER`, `GCS_BUCKET`, `APP_ORIGIN`, `OFFICE_NETWORK_IPS`, `GOOGLE_CLIENT_ID`, `DB_PASSWORD_SECRET`, `JWT_SECRET_NAME`, `DB_PASSWORD_SECRET_VERSION`, `JWT_SECRET_VERSION`.

Do not reuse production database, bucket, JWT secret, or Google OAuth credentials unless the staging security model explicitly requires it.

## Gate
Phases 16–19 are code/CI certifiable. Phase 20 becomes operationally certified only after the staging environment is provisioned and the staging deployment workflow completes its migration, liveness, and readiness gates successfully.
