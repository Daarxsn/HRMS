# Step 2 — Production Database Repair and Migration

## Current database facts

The previous authorized production audit output reported migrations 006, 007 and 008 applied on Aiven MySQL, with matching recorded checksums, and identified three groups of employees with multiple open attendance shifts. That is historical terminal evidence, not a newly run production query. Never apply 006–008 again blindly: inspect the live migration ledger and schema first.

The actual source of migration 006's active-administrator dependency is the `employment_history` backfill. It creates a `JOINED` event for existing employees and writes the first active administrator into `created_by`. The migration does not seed document categories in the current repository version. The revised migration permits a NULL creator when the historical/system actor cannot be truthfully identified; it never assigns an employee to their own history event to satisfy a foreign key.

## Repository changes

- Migration 006 now allows `employment_history.created_by` to be NULL when the original actor is unknown.
- Migration 009 widens the already-created column in upgraded databases; it does not rewrite employee history or attendance data.
- The migration runner recognizes only one explicit legacy checksum for migration 006 (the exact source SHA-256 recorded before this hardening). All other checksum mismatches still stop migration execution. Historical migration ledger bytes are not rewritten.
- The migration runner preflights migrations 006–009, blocks mixed/partial 006 and 008 states, detects duplicate active WFH requests and duplicate pending correction requests before migration 008, and reconciles an unrecorded migration 008 only if the complete expected schema is present and active-WFH integrity passes.
- The production audit checks all eight enterprise HR tables, their critical columns, expected indexes and foreign keys, 006 backfill completeness, creator nullability, checksums, active WFH uniqueness, duplicate pending corrections, and mixed/partial 006–008 schema states.
- CI rehearses clean install, populated data with an active administrator, populated data without an active administrator, migration reruns, preservation of employee/attendance/leave/WFH row counts, WFH reapplication after rejection/cancellation, and intentionally partial 006/008 states. This rehearsal is restricted to a disposable local CI MySQL instance.

## Open attendance anomalies — no automatic closure

The previous report identified three employee groups containing 15 open attendance rows in total. These are operational records, not schema noise. Do not bulk-update `check_out_at`, fabricate checkout timestamps, or delete these rows to make the integrity audit pass.

The Aiven production preflight packages the open-shift rows and linked attendance audit events into the age-encrypted baseline artifact. Those details are not printed to the public GitHub logs. The matching age private key must remain offline and outside the repository. An authorized HR reviewer must compare the encrypted report with available roster, network, employee, and supporting records, then document an approved outcome for each shift through the normal attendance correction/audit process. If the evidence is inconclusive, keep the exception open and escalate it; do not infer a checkout time.

## Production execution gates

Do not run a schema-changing production migration until Step 1's backup and restore requirement is satisfied. A provider-reported backup is not a restore drill. The migration operation must be separately approved and performed with the migration account, not the runtime or read-only audit identity.

Before applying any pending migration:

1. Confirm the connection identity and selected database are the intended Aiven production target.
2. Capture the current deployed commit, exact schema, migration ledger/checksums, row counts and integrity results in the encrypted private baseline.
3. Confirm an active administrator exists for populated production use. A clean database may migrate without employees; it must not be put into production service before a bootstrap administrator is provisioned and verified.
4. Verify there are no duplicate active WFH requests or duplicate pending attendance correction requests, and inspect foreign keys/indexes and the complete pre/post shape of migration 008.
5. Rehearse against a production-like restored copy; verify existing employee, attendance, leave and WFH row counts and representative records are unchanged.
6. Apply only migrations that are genuinely pending. Existing 006–008 entries must be skipped when ledger checksums/schema match. Migration 009 is the forward compatibility repair for `employment_history.created_by` nullability.
7. Rerun the read-only integrity audit and functional smoke tests. Any remaining open-shift anomaly must have an HR-approved resolution or a formally documented exception before the database can be locked.

## Production-lock criteria

- [ ] A current Aiven backup is verified and a separate restore drill passed, with measured recovery evidence recorded privately.
- [ ] Live schema/migration preflight and encrypted baseline are complete for the production target.
- [ ] Migrations 006–008 are verified in place; 009 is applied only if pending.
- [ ] All expected tables, columns, indexes, foreign keys and attendance enum values pass the audit.
- [ ] No duplicate WFH active dates, duplicate pending corrections, duplicate attendance employee/date rows, invalid checkout times or orphan records remain.
- [ ] Each open-attendance group has a documented HR-approved outcome; no attendance data was fabricated or bulk-closed.
- [ ] A fresh production integrity audit has zero failures.
- [ ] The deployed application commit, database schema, health/readiness checks and authorized employee/admin smoke tests agree.

A green CI rehearsal validates the repository implementation; it does not prove that live Aiven production has been migrated, that its backup can be restored, or that HR has adjudicated the historical attendance exceptions.
