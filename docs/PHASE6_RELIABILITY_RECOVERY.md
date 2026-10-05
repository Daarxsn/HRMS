# Phase 6 — Reliability, Recovery & Release Safety

## Objective

Phase 6 strengthens the HRMS against transient production failures and makes operational recovery safer. The locked attendance, leave, WFH, privacy and role rules remain unchanged.

## Implemented work

### 6.1 Transient database transaction recovery

The database transaction helper now retries a small, bounded set of transient MySQL transaction conflicts:

- deadlocks;
- lock wait timeouts.

Retries use short exponential backoff and are capped by `DB_TRANSACTION_RETRIES` (default: 2, allowed range: 0–5).

Permanent SQL failures are still surfaced immediately. A transaction is rolled back before a retry and the connection is returned to the pool after every attempt.

### 6.2 CI database integration gate

GitHub Actions now starts a disposable MySQL 8.4 service and validates the actual migration/seed path:

1. create the CI database through the service;
2. apply `server/migrations`;
3. run the seed;
4. verify all required tables;
5. verify the recorded migration;
6. verify the seeded workforce;
7. verify the locked 80 metre geofence setting.

This closes the gap between source-level contract tests and a real MySQL schema execution.

### 6.3 Controlled production rollback

Added `.github/workflows/rollback-production.yml`.

The workflow is manually triggered and protected by the GitHub `production` environment. It:

1. authenticates through the existing GitHub OIDC deployment identity;
2. verifies that the requested immutable Artifact Registry image exists;
3. deploys that existing image to Cloud Run;
4. verifies liveness and database-backed readiness;
5. records the rollback result in the GitHub Actions summary.

A rollback does **not** run migrations. This is intentional: production database migrations must be backward-compatible with the application version being rolled back to before the rollback is used.

### 6.4 Runtime tuning

Added `DB_TRANSACTION_RETRIES=2` to the environment template so transaction retry behavior is explicit and configurable per environment.

## Recovery model

The production release model is now:

`build -> migrate -> deploy -> health verify`

The rollback model is:

`select known-good immutable image -> deploy -> health verify`

Schema reversal is not automated. A destructive schema migration should never be paired with an application rollback unless compatibility has been independently verified.

## Phase 6 acceptance matrix

| Check | Acceptance |
| --- | --- |
| Database reliability | Transaction helper retries only bounded transient conflicts |
| Migration integration | MySQL 8.4 CI migration succeeds |
| Seed integration | CI seed succeeds and smoke verification passes |
| Release traceability | Released/rolled-back image is visible in workflow summary |
| Rollback | Known-good image can be redeployed and health checks pass |
| Data safety | Rollback workflow never executes seed and does not reverse schema |
| CI | Dependency audit, syntax, backend tests, DB smoke, frontend build, frontend smoke and container checks pass |
| Employee workflows | Existing attendance, leave, WFH, flex, correction and notification workflows remain unchanged |
| Admin workflows | Existing people, approvals, reports, settings, QR and audit workflows remain unchanged |
| Privacy | No new tracking or sensitive production logging is introduced |

## Phase 6 lock rule

Phase 6 is locked only after the final CI run is green and the company-owned environment completes a rollback/redeploy drill using a known-good immutable API image.

No production credentials, company infrastructure or database backup data are fabricated in the repository.
