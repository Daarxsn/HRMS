# HRMS email outbox — operating notes

## Delivery model

Business routes write the business record first and then persist a notification in `email_outbox`. They do not open an SMTP connection. The API response distinguishes a queued notification (`queued: true`, `status: PENDING`) from a message that has been delivered (`status: SENT` is recorded by the worker). A database enqueue failure is returned as `ENQUEUE_FAILED` and logged; it is not misreported as an email send.

The outbox is durable in MySQL. It uses a unique `dedupe_key`, a row lock with `SKIP LOCKED`, a per-claim lock token, and a renewable/reclaimable lease. Each failed attempt stores a truncated error and the attempt number. The worker makes eight attempts with exponential backoff from 30 seconds up to 15 minutes; exhausted entries become `FAILED`. Administrators can inspect counts and failed records through `GET /api/admin/email-outbox` and request a retry with `POST /api/admin/email-outbox/:id/retry`.

Emails use a stable RFC Message-ID based on the outbox record. Delivery is **at least once**, not mathematically exactly once: SMTP can accept a message immediately before a process or database failure, leaving the worker unable to confirm the SENT update. The stable Message-ID and database lease reduce duplicate risk, but cannot make an external SMTP server transactional with MySQL.

## Vercel/serverless deployment

The connected FX Vercel team is on Hobby, so its native Cron Jobs cannot run every five minutes. Use the GitHub Actions workflow `.github/workflows/email-outbox-worker.yml` as the external scheduler.

1. Apply migration `010_email_outbox.sql` using the normal migration command before enabling the worker.
2. Generate a random secret with at least 32 bytes of entropy. Set it as `EMAIL_OUTBOX_CRON_SECRET` in the Vercel project environment (Production and any test environment that needs the runner).
3. Add two GitHub Actions repository secrets:
   - `HRMS_EMAIL_OUTBOX_URL`: the full HTTPS URL ending in `/api/internal/email-outbox`.
   - `HRMS_EMAIL_OUTBOX_SECRET`: the same value used by `EMAIL_OUTBOX_CRON_SECRET`.
4. Confirm the live API readiness response reports `email_outbox_runner: configured`; then dispatch the Email Outbox Delivery workflow once and verify the returned counts.
5. Confirm `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `HR_NOTIFICATION_EMAIL` are correct in production. Use the administrator SMTP test to verify current credentials.

The workflow runs every five minutes after it is present on the default branch. A draft/feature branch does not activate the schedule. Until the workflow is merged and the secrets are configured, the outbox will accumulate messages but will not send them automatically.

## Persistent worker alternative

For a long-running container/service, deploy the built API and start the second process using `npm run worker:email` with `EMAIL_OUTBOX_WORKER_ENABLED=true`. The worker polls MySQL every five seconds by default (`EMAIL_OUTBOX_POLL_MS`, 1–60 seconds). Keep API and worker on the same database and environment. Do not run the background worker inside a request handler or start an unbounded poll loop inside a Vercel function.

## Operational verification

Inspect `GET /api/admin/email-outbox` as an administrator for counts of PENDING, PROCESSING, SENT, and FAILED entries. Investigate repeated SMTP authentication errors before manually retrying them. Check the outbox logs for `email_outbox_delivery_failed`, `email_outbox_sent_state_persist_failed`, and `email_outbox_batch_failed`. Never log the SMTP password or cron secret.
