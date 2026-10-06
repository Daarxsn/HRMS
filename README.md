# Falchion Xeniaa Employee Management System

A responsive employee and administrator workplace portal built with the locked stack: **React + TypeScript, Node.js + TypeScript, MySQL, Google Cloud and Vercel**. The React app uses Vite; the API uses Express on Node.js; production data is stored in MySQL on Cloud SQL; the API is designed for Cloud Run; and the frontend is a static Vite build for Vercel.

## What is implemented

- Google Sign-In with an authorized-user allowlist. An administrator provisions an employee’s Google email first; no company email domain is enforced.
- Administrator and employee roles, employee/intern account types, and account activation controls. No departments are modeled in V1.
- Employee home, attendance history, profile, notification center, holiday calendar, leave and WFH request experiences.
- Administrator overview, people management, attendance review, request approvals, audit trail, CSV reports, and office configuration.
- Server-side GPS distance and accuracy checks at the time an employee chooses check-in or check-out. A GPS event stores one location verification record. There is no continuous location collection or background tracking.
- Attendance uses one-time GPS and office-network verification; QR attendance is retired in the current production policy.
- 9:00 AM–6:00 PM schedule, Monday–Saturday work week, late at **9:30 AM or later**, fixed 30-minute lunch deduction, and approved flex starts between 9:00 AM and 10:30 AM.
- Casual and sick leave share the locked 8-day annual pool; earned leave is 15 days/year with the policy’s 1-day-per-month accrual after probation; floating leave is 4 days/year. Sundays and company/national holidays are excluded from day-counting. A doctor’s note is required for sick leave of 3 or more consecutive calendar days.
- Planned WFH requires at least 24 hours’ notice, emergency WFH can be requested on the same day, and approval is required. The typical monthly guideline defaults to 4 days and eligibility is individually enabled. Only one seeded demo employee has WFH enabled.
- Temporary exit/return timestamps, attendance correction requests, flex-start approvals, in-app notifications, private leave attachments, holiday management, and append-only-style audit entries.
- PWA manifest and a small static shell cache. API responses and personal data are never placed in the offline cache.
- Production API containers run as the non-root `node` user and shut down gracefully on SIGTERM. Liveness and database-backed readiness health endpoints are available.
- Sensitive attendance, leave, administrator mutation and file-upload endpoints use per-user rate limits in addition to the API-wide limit.
- Security basics: secure HTTP-only session cookie, short-lived signed session, Google token verification, server-side role checks, exact-origin CORS, Helmet, request validation, sign-in rate limiting, least-data location records, CSV formula-injection protection, and private GCS attachment storage. The npm locks pin `uuid` 11.1.1 through an override to address a transitive Google SDK advisory; the affected SDK call sites use the compatible `v4` API.

## Project structure

```text
client/                 React UI, Vite config, PWA shell, Vercel config
server/src/             Express API, auth, policy, routes and database pool
server/migrations/      MySQL schema migrations
server/private-uploads/ Local-only private upload directory (ignored by Git)
docs/API.md             API roles and endpoint contract
server/Dockerfile       Cloud Run container build
```

This archive is the working Falchion Xeniaa application project. It is structured as a Vite React client and Express Node.js API and is ready for local development and deployment configuration.

## Run locally

### Requirements

- Node.js 22 or newer and npm
- MySQL 8.0 or newer
- A Google OAuth Web client to exercise Google sign-in (optional for local preview)

### 1. Install packages

From this project directory:

```sh
npm install
```

### 2. Create a local MySQL database and user

```sql
CREATE DATABASE falchion_xeniaa CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'falchion_app'@'localhost' IDENTIFIED BY 'use-a-local-secret-here';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON falchion_xeniaa.* TO 'falchion_app'@'localhost';
```

Use a separate, least-privilege application identity in each deployed environment. Schema changes are applied through the migration command, which needs the additional DDL rights above; the running application itself only needs routine data access.

### 3. Configure the API

Copy `.env.example` to `server/.env`, then set the local database values. `JWT_SECRET` must be a private random value with at least 32 bytes. Never commit `.env`.

For local preview without Google OAuth, leave `DEMO_AUTH_ENABLED=true`. This is development-only: the server forcibly disables demo sign-in in production. The seed data uses fictional `example.test` emails and is not a set of real company accounts. The seed command hard-fails when `NODE_ENV=production`.

For Google sign-in, create a **Web application** OAuth client in Google Cloud Console and add the local frontend origin (`http://localhost:3000`) under Authorized JavaScript origins. Set the same client ID in `GOOGLE_CLIENT_ID` in `server/.env` and `VITE_GOOGLE_CLIENT_ID` in `client/.env.local`. The app authorizes a Google identity only when its verified email matches an active employee record; no domain allowlist is used.

### 4. Apply schema and demo data

```sh
npm run db:migrate
npm run db:seed
```

The seed inserts **10 fictional employee/intern accounts plus one administrator**, default office and policy settings, the national holidays for 2026, and WFH access for one demo employee. It is for local preview only; do not run it in the production database.

### 5. Start the app

```sh
npm run dev
```

Open `http://localhost:3000`. Select an account from the Local Preview list, or configure Google OAuth. The API health checks are `http://localhost:3001/api/health`, `/api/health/live` and `/api/health/ready`. The readiness endpoint verifies database connectivity.

## Phase 4 production launch

Phase 4 adds a controlled production release path through GitHub Actions. The manually triggered `Deploy Production` workflow:

- authenticates to Google Cloud with GitHub OIDC / Workload Identity Federation;
- builds the API image with Cloud Build into Artifact Registry;
- runs the database migration runner as a one-task Cloud Run Job;
- deploys the same immutable image to Cloud Run;
- verifies both liveness and database-backed readiness after deployment.

The workflow is intentionally configuration-driven. It does not contain company credentials, database passwords, JWT secrets, service-account keys, or real employee data. Configure the protected GitHub `production` environment from `docs/PHASE4_PRODUCTION_LAUNCH.md` before using it.

Phase 4 is not considered production-complete until the company-owned Cloud SQL, Cloud Run, GCS, Google OAuth and Vercel environments pass the documented UAT and rollback checks.

## Phase 5 operational excellence

Phase 5 adds runtime release traceability, administrator-only system health diagnostics, and request-correlated API error responses. The production deployment path stamps the deployed commit SHA into the API runtime, while the Office Settings screen provides safe database/runtime diagnostics for administrators.

See [Phase 5 operational excellence](docs/PHASE5_OPERATIONAL_EXCELLENCE.md) for the acceptance and lock criteria.

## Phase 6 reliability and recovery

Phase 6 adds bounded transient MySQL transaction retries, real MySQL 8.4 migration/seed verification in CI, and a controlled production rollback workflow for redeploying a known-good immutable API image.

See [Phase 6 reliability and recovery](docs/PHASE6_RELIABILITY_RECOVERY.md) for the recovery model and lock criteria.

## Phase 7 identity security and integration certification

Phase 7 hardens session lifecycle security with server-side session revocation and adds a real API integration smoke gate against the migrated and seeded MySQL database. Logout invalidates the current session version server-side, and GitHub Actions verifies employee/admin authentication, authorization, protected-route validation, system health, dashboard access, and logout revocation.

See [Phase 7 identity security and integration certification](docs/PHASE7_IDENTITY_INTEGRATION.md) for the acceptance and lock criteria.

## Google Cloud deployment

Use **Cloud Run for the Node API** and **Cloud SQL for MySQL 8**. Create a private Cloud Storage bucket for leave documentation. Keep the bucket’s public access prevention enabled.

1. Create the Cloud SQL MySQL instance and database. Apply `server/migrations/` from an approved deployment job or a trusted workstation connected through the Cloud SQL Auth Proxy.
2. Create a dedicated Cloud Run service account. Grant it only Cloud SQL Client and object read/write access to the private attachment bucket. Attach the Cloud SQL instance to the Cloud Run service.
3. Build/deploy from the `server/` directory so its `Dockerfile` is used. Set the Cloud Run port to 8080.
4. Configure these Cloud Run variables/secrets:

   - `NODE_ENV=production`
   - `PORT=8080`
   - `APP_ORIGIN=https://portal.<your-company-domain>` (comma-separated exact origins if more than one)
   - `JWT_SECRET` from Secret Manager (never a checked-in value)
   - `GOOGLE_CLIENT_ID`
   - `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - `DB_SOCKET_PATH=/cloudsql/<project-id>:<region>:<instance-name>`
   - `GOOGLE_CLOUD_PROJECT`
   - `GCS_BUCKET=<private-bucket-name>`
   - `DEMO_AUTH_ENABLED=false`
   - `DEMO_APP_URL=https://portal.<your-company-domain>`

Use a portal and API custom domain under the same company domain (for example `portal.<company-domain>` and `api.<company-domain>`). This keeps the HTTP-only session cookie same-site while CORS still allows only the portal origin. Set `APP_ORIGIN` to the exact portal origin. Do not use broad wildcards for CORS.

The API is ready for deployment; no Google Cloud account, project, client secrets, or real employee emails were available in this workspace, so no cloud resources were created and no credentials have been fabricated. Production startup requires a private JWT secret, exact `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GCS_BUCKET` and database credentials; the local filesystem attachment fallback is development-only.

## Vercel deployment

1. Import the project into Vercel and set the **Root Directory** to `client`.
2. Add `VITE_API_URL=https://api.<your-company-domain>/api` and `VITE_GOOGLE_CLIENT_ID=<same Web client ID>` in Vercel’s production environment.
3. Add the portal origin to the OAuth client’s Authorized JavaScript origins. Add the deployed API to the Cloud Run `APP_ORIGIN` allowlist.
4. Deploy the Vite static frontend. The included `vercel.json` rewrites client-side routes to `index.html`.

Vite environment variables are embedded at build time. Redeploy the frontend after changing either `VITE_*` setting.

## Locked policy defaults

| Setting | Default |
| --- | --- |
| Office | Falchion Xeniaa Pune HQ |
| Coordinates | 18.506633, 73.857692 |
| Geofence | 80 m |
| Work days | Monday–Saturday |
| Standard hours | 9:00 AM–6:00 PM, Asia/Kolkata |
| Late threshold | 9:30 AM (exactly 9:30 is late) |
| Approved flex start | 9:00–10:30 AM by administrator approval |
| Lunch | Fixed 30 minutes, deducted at checkout; no manual break tracking |
| Leave | Shared casual/sick 8; earned 15; floating 4 |
| WFH | Individually enabled; typical cap 4/month |
| QR expiry | 120 seconds |

The policy PDFs in the referenced conversation are reflected in the code’s leave, flex-start, WFH, and trust/no-spyware behaviors. The locked leave allocation supplied later in that conversation takes precedence over any differing wording in the source documents.

## Important limits before real office use

- The local preview and production source are implemented, but live Google OAuth, Cloud SQL, Cloud Run, Cloud Storage and Vercel deployment still need company-owned credentials and setup.
- Attendance correction, leave, WFH and flex approvals are handled by an administrator; there is no separate manager hierarchy in this V1. The employee-facing and administrator-facing workflows are both implemented in the React application.
- No automatic push/email notifications or scheduled background absence job is configured. In-app approval notifications are supported; the administrator dashboard computes attendance exceptions from the current date/time.
- Uploads are private. Local uploads are stored under `server/private-uploads/` for development; production uses private Google Cloud Storage when `GCS_BUCKET` is configured.

See [API contract](docs/API.md) for routes and role access.


### TypeScript architecture

The application source is TypeScript throughout: React components use `.tsx`, shared/browser/server utilities use `.ts`, and the backend is compiled to JavaScript for production Node.js execution. The production service worker is also authored as TypeScript and emitted as the required `sw.js` runtime asset during the Vite build.
