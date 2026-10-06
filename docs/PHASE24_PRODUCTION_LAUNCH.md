# Phase 24 — Production Launch

Run `HRMS Production Launch` with the approved immutable release tag.

The workflow verifies the release tag, CI, Playwright, protected UAT approval, and protected production approval, then triggers the existing immutable production deployment.

The production deployment:
- validates configuration;
- creates/verifies a pre-deployment Cloud SQL backup;
- applies migrations through the Cloud Run migration job;
- deploys the API;
- verifies liveness and database-backed readiness;
- records a deployment summary.

## Frontend
Deploy the same approved commit to Vercel with:
- root directory `client`;
- `VITE_API_URL` set to the production API;
- `VITE_GOOGLE_CLIENT_ID` set to the production OAuth Web client.

## Launch smoke test
- [ ] Portal loads
- [ ] Google sign-in works
- [ ] Employee dashboard loads
- [ ] Administrator dashboard loads
- [ ] Attendance path works
- [ ] Leave/WFH request path works
- [ ] Admin approval works
- [ ] Reports export works
- [ ] Liveness = 200
- [ ] Readiness = 200
- [ ] Request IDs appear in API logs

GO only when UAT, backup, deployment, migration, health, and portal smoke tests pass.

For application regression, use the known-good image rollback. For database incidents, follow the Phase 21 recovery procedure.
