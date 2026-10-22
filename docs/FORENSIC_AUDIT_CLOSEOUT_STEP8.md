# HRMS forensic audit closeout — Step 8 candidate

**Candidate branch:** `step-8/final-verification-closeout`  
**Evidence reviewed:** repository source at the Step 7 candidate and GitHub Actions runs linked below, plus current repository workflow/documentation contents.  
**Important limitation:** this is a repository/CI evidence report. No production credentials were accessed, no production database query was executed in this review, and no authenticated production mutation was performed. Therefore production behavior is not labelled verified.

## Executive summary

This report uses the defect register below as the sole source of status totals. Each numbered finding has exactly one current status. Totals are calculated from the 10 register entries:

- **Fixed in source / docs:** 4
- **Verified by automated CI/E2E evidence:** 2
- **Open / requires further evidence or implementation:** 4
- **Not applicable:** 0
- **Total findings:** 10

"Fixed in source" means a code or documentation change is present; it does not imply production verification. "Verified" requires a successful automated run linked below. The totals are intentionally not summed across multiple labels: every finding has one primary status.

## Evidence references

- Step 7 CI: https://github.com/Daarxsn/HRMS/actions/runs/39723125515 — completed successfully on commit `81742a64bdbf1d217f145867b311c68c29a64151`.
- Step 7 Playwright: https://github.com/Daarxsn/HRMS/actions/runs/39723125491 — completed successfully on the same commit.
- Earlier Step 7 Playwright failure: https://github.com/Daarxsn/HRMS/actions/runs/39721469086 — failure in sidebar navigation after an `aria-hidden` regression; the subsequent commit removed that attribute and the later Playwright run passed.
- Candidate run evidence must be refreshed after every Step 8 change; Step 7 green checks do not prove Step 8 changes pass.
- Provider topology and safe procedure: `docs/VERCEL_AIVEN_OPERATIONS_RUNBOOK.md`.
- Existing provider-specific legacy workflows: `.github/workflows/deploy-production.yml`, `backup-production.yml`, `rollback-production.yml`, and `launch-production.yml` use Google Cloud Run / Cloud SQL / GCS assumptions. They must not be treated as the Vercel/Aiven production path.

## Master defect register

| ID | Finding | Status | Evidence / closure condition |
|---|---|---|---|
| F-41 | Operations docs mixed current Vercel/Aiven with legacy Cloud Run/Cloud SQL/GCS procedures | **Fixed in source/docs** | Added `docs/VERCEL_AIVEN_OPERATIONS_RUNBOOK.md` and linked it at the top of README. Review the actual Vercel project and Aiven service before any change. |
| F-42 | Final regression suite must pass on the immutable Step 8 candidate | **Open** | Step 7 CI and Playwright passed, but Step 8 commits need their own successful CI and E2E runs. |
| F-43 | Live-production smoke test for login/session revocation, employee attendance, manager approvals, document access, notifications, admin summary and database health | **Open** | Only anonymous read-only HTTP smoke checks are safe by default. Authenticated workflows require an approved test identity and explicit safe test procedure. No production test has been claimed. |
| F-44 | Forensic audit report and executive totals need a single reconciled evidence-backed register | **Fixed in source/docs** | This document defines one status per finding and reconciles the executive totals to the 10 rows below. Update statuses only when new evidence is attached. |
| F-35/36 | Performance claims need measured representative load and complete admin-summary endpoint evidence | **Open** | CI query-level baselines exist; representative large-tenant HTTP load and provider connection budget still need measurement. |
| F-37/38 | CSS modularization and consistent light/dark visuals across major screens | **Open** | Semantic tokens are a compatibility layer; full legacy CSS modularization and visual regression coverage are incomplete. |
| F-39 | Responsive layout and accessibility coverage | **Verified by automated CI/E2E evidence** | Step 7 CI and Playwright passed after the sidebar accessibility fix. This does not replace a full manual WCAG/contrast audit. |
| F-40 | Session expiry, form-error preservation and retry safety | **Verified by automated CI/E2E evidence** | API timeout/session-expiry contract checks and existing E2E checks pass in Step 7 CI. Mutation idempotency and all form failure states still need review if any gap is identified. |
| F-30–34 | MySQL integration, migration, rollback and logical backup/restore test infrastructure | **Fixed in source/docs** | Step 6 CI and Playwright passed at https://github.com/Daarxsn/HRMS/actions/runs/39606219964 and https://github.com/Daarxsn/HRMS/actions/runs/39606219991. Provider-level Aiven restore is not proven by CI. |
| F-23/41 | Actual Vercel Blob, SMTP/outbox and Aiven configuration/runtime health | **Open** | Source and configuration docs exist, but provider-console settings and live delivery/storage paths have not been verified in this report. |

## Required final regression evidence

On the Step 8 candidate commit, require green results for:
- dependency installation and security audit;
- frontend/backend build and TypeScript validation;
- unit, contract and security regression tests;
- migration clean-install and populated-upgrade rehearsal;
- disposable MySQL API integration suite;
- logical backup/restore rehearsal;
- Playwright desktop and mobile flows.

A green build alone is not sufficient. Record the exact candidate commit SHA and the links to both CI and Playwright runs before marking F-42 verified.

## Production smoke and change-control boundary

The repository includes public HTTP checks for portal reachability, API liveness/readiness, expected unauthenticated denial, disabled demo login and security headers. These are read-only from the application's perspective. They do not prove successful employee/admin login, revocation, attendance writes, approval mutations, document authorization, SMTP delivery or real production data integrity.

For those checks, use an approved dedicated test employee/admin in a controlled production test window only if HR/data owners permit it. Prefer staging for write-path checks. Never create real attendance or approval records for employees merely to satisfy a checklist. Aiven read-only audit should use a dedicated SELECT-only identity. Do not run the legacy Cloud SQL/GCP deployment or backup workflows against Aiven.

## Closeout status

**Step 8 is not locked.** Lock only after the Step 8 candidate has green CI + Playwright, the operations documentation and register are reviewed, and live-only checks are either completed with evidence or explicitly accepted as residual risks by the production owner.
