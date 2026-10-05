# Phase 3 — Production Backend, Database & Deployment Readiness

## Objective

Move the HRMS from a CI-clean application into a production-ready service baseline without changing the locked attendance, leave, WFH or privacy policy.

## Workstreams

### 3.1 API runtime hardening
- Production startup validates required secrets and private attachment storage.
- Exact-origin CORS remains enforced.
- JSON payload size is constrained.
- Request IDs are generated and propagated for operational correlation.
- Structured request/error logging is available.
- Liveness and database-backed readiness endpoints are exposed.
- SIGTERM shutdown drains the HTTP server and closes the MySQL pool.

### 3.2 Database hardening
- Bounded connection pool and idle connections.
- Connection timeout and keep-alive enabled.
- Queue depth is bounded.
- Production database credentials are required.
- Transactions roll back safely even when rollback itself encounters an error.

### 3.3 Abuse and mutation controls
Per-user rate limits protect high-value mutation surfaces:
- attendance actions
- leave requests and withdrawals
- WFH requests
- administrator mutations
- private document uploads

The existing API-wide and authentication rate limits remain in place.

### 3.4 Private attachment hardening
- MIME type and file-signature checks remain enforced.
- Uploads are private.
- Production requires GCS-backed attachments.
- Object creation uses a no-overwrite precondition.
- Failed object/database persistence attempts are cleaned up.

### 3.5 Container hardening
- Production image uses Node 22 Alpine.
- Runtime process is the non-root node user.
- Private upload directory is explicitly permissioned.
- Container receives SIGTERM for graceful shutdown.

### 3.6 CI/CD validation
GitHub Actions validates:
1. clean dependency installation
2. server syntax
3. backend policy tests
4. frontend production build
5. frontend smoke contracts
6. production API container build
7. production API contract tests

## Phase 3 lock criteria

Phase 3 can be locked only when:
- all CI stages are green on the final main commit;
- the production API image builds successfully;
- database migrations and seed are separately validated against an approved MySQL environment;
- Cloud Run, Cloud SQL, GCS, Google OAuth and Vercel deployment settings are configured using company-owned credentials;
- production browser/device smoke tests pass.

No cloud resource or credential is fabricated in this repository.
