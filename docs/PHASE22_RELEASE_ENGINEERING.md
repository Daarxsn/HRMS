# Phase 22 — Production Release Engineering

## Release chain
1. CI passes.
2. Playwright E2E passes.
3. Staging is deployed and health-verified.
4. Release Candidate publishes an immutable GitHub release/tag.
5. HR/UAT approval is recorded.
6. Production environment approval is granted.
7. Production deployment creates a fresh Cloud SQL backup.
8. Migration job runs once.
9. API deploys the exact immutable image tag.
10. Liveness and readiness are verified.

Production uses the commit SHA as the container image tag. Never rebuild a production release from changed source under the same release tag.

Rollback redeploys an existing image and does not run database down-migrations. Confirm application/schema compatibility first.

Abort when CI, E2E, staging, UAT, backup, migration, or readiness gates fail.
