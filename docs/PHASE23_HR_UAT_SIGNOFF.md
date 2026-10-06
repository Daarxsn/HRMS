# Phase 23 — HR / UAT Sign-off

UAT is a business acceptance gate, not another automated test.

The UAT workflow verifies the immutable release, successful CI/E2E gates, and produces a sign-off artifact tied to the exact release SHA. Configure the GitHub `uat` environment with required HR/business reviewers.

## Employee checklist
- [ ] Authorized Google Sign-In
- [ ] Unauthorized identity rejected
- [ ] Profile
- [ ] Check-in/check-out
- [ ] GPS/network verification
- [ ] Approved WFH
- [ ] Attendance history
- [ ] Leave/WFH requests
- [ ] Notifications
- [ ] Holiday calendar
- [ ] Private attachments

## Administrator checklist
- [ ] Employee/intern management
- [ ] Activation
- [ ] Attendance review/corrections
- [ ] Leave/WFH/flex approvals
- [ ] Office/policy settings
- [ ] Holidays
- [ ] Audit trail
- [ ] Reports/CSV
- [ ] Health diagnostics

## Security checklist
- [ ] Production secure HTTP-only session
- [ ] Demo authentication disabled
- [ ] Admin authorization enforced
- [ ] Private attachment authorization
- [ ] Exact-origin CORS
- [ ] JWT in Secret Manager
- [ ] Database credentials outside source control

The approving HR/business owner must be identified and the protected UAT environment approval completed. Sign-off is valid only for the exact release SHA/tag tested.
