# Phase 7 — Identity Security & Integration Certification

## Objective

Phase 7 hardens session lifecycle security and adds an end-to-end API gate so authentication, authorization and core protected routes are verified against a real migrated and seeded MySQL database.

## Implemented work

### 7.1 Server-side session revocation

Added employees.session_version through migration 002_session_revocation.sql.

Every new session token carries the current session version. Authenticated requests reload the current value from MySQL and reject tokens whose version no longer matches.

Logging out now:

1. requires an authenticated session;
2. increments the employee's session version;
3. records an AUTH_LOGOUT audit entry;
4. clears the HTTP-only session cookie.

This gives the server an explicit revocation mechanism rather than relying only on cookie deletion or token expiry.

### 7.2 API integration smoke gate

Added server/test/integration.ts and the test:integration workspace command.

The test starts the API against the CI MySQL database and verifies:

- liveness and database-backed health;
- seeded administrator and employee accounts;
- employee authentication and /auth/me;
- employee rejection from administrator-only routes;
- protected attendance validation;
- administrator authentication;
- administrator system health;
- administrator dashboard access;
- logout-driven session revocation.

The integration test is now part of GitHub Actions after migration and seed verification.

### 7.3 CI layering

Backend verification is now split into:

unit + production contracts -> migration -> seed + database smoke -> API integration smoke -> frontend build/smoke -> production container checks

The database smoke test is intentionally not part of the ordinary unit-test command because it requires a live MySQL service.

## Security model after Phase 7

Session lifetime remains 8 hours. The session is stored in an HTTP-only cookie. Server-side revocation is now available immediately through the session version counter.

Deactivated accounts are still rejected by the active-account check, and role authorization remains server-side.

No continuous location tracking, background collection, new employee profiling, or additional sensitive logging is introduced by this phase.

## Phase 7 acceptance matrix

| Check | Acceptance |
| --- | --- |
| Session issuance | JWT contains current session version |
| Session validation | Token version must match current employee version |
| Logout | Server revokes the session and clears the cookie |
| Auditability | Logout creates an audit event |
| Authentication integration | Demo/seed authentication works against migrated MySQL |
| Authorization integration | Employee cannot access administrator routes |
| Protected route integration | Attendance validation executes through the real API |
| Admin integration | System health and dashboard are reachable by administrator |
| CI | Integration smoke runs after database migration and seed |
| Existing policy | Attendance, leave, WFH, flex, correction and privacy rules remain unchanged |

## Phase 7 lock rule

Phase 7 is locked only after GitHub Actions is green with the integration smoke gate and the application passes the company-owned staging/UAT authentication and logout-revocation checks.

No production credentials or company infrastructure are fabricated in the repository.