# HRMS Production Deployment Checklist

## Before deployment

- Create a production Cloud SQL MySQL 8 database.
- Apply database migrations from server/migrations.
- Create a private Cloud Storage bucket for leave attachments with public access prevention enabled.
- Create a dedicated Cloud Run service account with only the required Cloud SQL and GCS permissions.
- Create the Google OAuth Web client and register the exact Vercel portal origin.
- Create the Vercel frontend project with the client root directory.

## Cloud Run configuration

Required runtime settings:

- NODE_ENV=production
- PORT=8080
- APP_ORIGIN=https://portal.<company-domain>
- GOOGLE_CLIENT_ID=<web-client-id>
- GCS_BUCKET=<private-bucket>
- DB_NAME=<production-db>
- DB_USER=<least-privilege-db-user>
- DB_PASSWORD=<secret>
- DB_SOCKET_PATH=/cloudsql/<project>:<region>:<instance>
- JWT_SECRET=<Secret Manager value>
- DEMO_AUTH_ENABLED=false

Do not place secrets in Git, Vercel environment variables intended for the browser, Docker images, or source files.

## Health probes

Use:

- Liveness: /api/health/live
- Readiness: /api/health/ready

Readiness is the database dependency check.

## Migration procedure

Run migrations before directing production traffic to a new application version. The migration runner uses a MySQL advisory lock so concurrent migration processes do not execute the same schema migration at the same time.

## Vercel configuration

Set:

- VITE_API_URL=https://api.<company-domain>/api
- VITE_GOOGLE_CLIENT_ID=<same web client id>

The Vercel deployment should use the client directory as its root.

## Acceptance checks

1. GET /api/health/live returns 200.
2. GET /api/health/ready returns 200 with a reachable database.
3. Google Sign-In accepts an authorized employee identity.
4. Unauthorized Google identities are rejected.
5. Employee attendance works with approved GPS/QR/WFH paths.
6. Admin approval workflows update state and create notifications.
7. Private attachment upload/download works only for authorized users.
8. CSV export remains private and formula-safe.
9. Cloud Run logs contain request IDs for troubleshooting.
