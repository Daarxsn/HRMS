# HRMS backup restoration and disaster recovery

## Scope and safety

Never restore over production as part of a test. Restore into a dedicated, isolated MySQL database or instance with no production application traffic and restricted network access. A successful backup job only proves that a backup operation ran; it does not prove that the backup is readable or that the application can use the restored database.

## Recovery objectives

Set and approve the business RPO (maximum acceptable data loss) and RTO (maximum time to restore service) before declaring the disaster recovery process production-ready. The daily backup workflow alone implies up to roughly 24 hours between scheduled backup points, excluding backup lag; it does not establish an RPO guarantee. Record the last successful restore rehearsal, schema version, backup timestamp, elapsed restore time, and validation outcome.

## Restore procedure

1. Open the Production Backup workflow and confirm a successful backup ID/status for the correct Cloud SQL instance and project.
2. Create an isolated temporary Cloud SQL instance or an isolated restore target in accordance with the approved security policy. Do not point the application at production credentials.
3. Restore the selected backup into that target using the provider-supported restore operation. Wait for the provider to report completion.
4. Configure a temporary application environment with the restored host/database credentials, TLS settings, and a newly generated JWT secret. Keep outbound email and other external side effects disabled or routed to test sinks.
5. Run the schema/migration verifier in read-only mode first. Compare schema_migrations entries and checksums with the deployed source; do not blindly run new migrations during recovery before assessing the restored version.
6. Run database integrity checks, then launch the API in the isolated environment. Verify health/readiness, sign-in using a dedicated test account, attendance read access, leave balances, WFH state, document metadata, settings, calendar, reports, and audit-log reads.
7. Compare known fixture/marker records and row counts from before the backup. Verify that the application can read the restored schema and data, not just that the database accepts connections.
8. Record restore start/end timestamps, restored backup ID, application commit, migration ledger, checksums, validation results, and issues in the incident/recovery record.
9. Destroy the temporary environment and revoke its temporary credentials after evidence is retained. If recovery is required for an actual incident, follow the approved cutover plan only after the data owner approves it.

## Automated isolated MySQL rehearsal

CI can test logical backup/restore mechanics without touching production: create a unique temporary schema, apply all migrations, seed synthetic data, dump only that schema, restore into a second unique schema, and compare migration ledgers, critical table counts, key constraints, and representative application queries. Use a disposable CI MySQL service account with permission to create/drop only the CI test schemas. Always drop both temporary schemas in a finally block.

This rehearsal validates the backup/restore toolchain and schema/data integrity within CI. It does not replace a provider-level Cloud SQL backup restore drill, IAM/WIF verification, point-in-time recovery testing, or a timed disaster-recovery exercise against a real isolated cloud target. Those environment-dependent checks must be recorded separately.

## Evidence required to close Step 6

- CI clean install and upgrade rehearsal pass from migrations 001 through the current schema.
- Populated-database data-preservation and final constraint assertions pass.
- MySQL-backed API integration and Playwright end-to-end workflows pass.
- Injected multi-table/audit failures demonstrate full rollback.
- CI logical dump/restore rehearsal passes.
- A provider-level isolated restore is completed and the restored application is exercised successfully.
