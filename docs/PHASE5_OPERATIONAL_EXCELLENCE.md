# Phase 5 — Operational Excellence, Observability & UAT Readiness

## Objective

Phase 5 strengthens the HRMS for real operational use after the Phase 4 production launch path. The locked business rules remain unchanged.

## Implemented work

### 5.1 Runtime release traceability

The API health responses now expose non-secret runtime metadata:

- application version;
- deployed build/commit SHA;
- uptime;
- readiness database status.

The production deployment workflow stamps the Cloud Run service and migration job with the Git commit SHA so an administrator can correlate a production response with the exact released source.

### 5.2 Administrator system health

The administrator Office Settings screen now includes a System Health panel showing:

- API operational status;
- MySQL server version;
- database latency for a lightweight health query;
- Node.js runtime version;
- application release version;
- deployed build identifier.

This is an administrator-only diagnostic surface. It does not expose secrets, connection strings, employee data, or database credentials.

### 5.3 Request-correlated API errors

API failures now return the request ID alongside the user-safe error message. Server logs already capture request IDs and now also emit structured error records containing the request ID, method, path and status.

This gives support staff a safe way to correlate a user's reported failure with server logs without exposing internal exception details to the browser.

### 5.4 Production contract tests

The production contract test suite now checks the Phase 5 health metadata and administrator system-health surface in addition to the Phase 3 production safeguards.

## Phase 5 acceptance

Before Phase 5 is locked:

| Check | Acceptance |
| --- | --- |
| Local API | Starts against the approved local MySQL environment |
| Health | Live and readiness endpoints return correct status |
| Admin health | Administrator can view runtime/database diagnostics |
| Error correlation | API errors contain a request ID and logs correlate it |
| Release traceability | Production build is stamped with commit SHA |
| CI | Dependency audit, backend tests, frontend build, smoke test and production container checks pass |
| Employee workflows | Login, attendance, leave, WFH, corrections and notifications remain functional |
| Admin workflows | People, approvals, attendance, reports, settings, QR and audit remain functional |
| Privacy | No continuous location collection and no sensitive data added to logs |
| UAT | Desktop and mobile acceptance pass completed |

## Phase 5 lock rule

Phase 5 is not locked by source-code completion alone. It becomes locked after the final main-branch CI run is green and the company-owned staging/production environment completes the acceptance matrix.

No production credential or company infrastructure is fabricated in the repository.
