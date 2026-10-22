# Step 7 performance and UI verification

## Safety and method

Do not tune the database pool or cache the admin overview until reproducible measurements show a bottleneck. The included scripts require CI=true, HRMS_BENCHMARK=true, a loopback database host, a database name ending in _ci, and non-production NODE_ENV. They refuse remote or production database targets.

## Database connection baseline

Run npm run bench:db-pool --workspace server with the isolated CI MySQL service and a synthetic employee dataset. Vary BENCH_POOL_SIZE, BENCH_CONCURRENCY, and BENCH_ITERATIONS one at a time. Capture throughput, p50/p95/max latency, and MySQL Threads_connected. Repeat with normal concurrency and the expected morning check-in burst.

Before choosing a production pool size, calculate worst-case connection budget as maximum simultaneous app instances multiplied by per-instance connectionLimit, plus workers/migrations/administrative headroom. Compare that budget with the provider's max_connections and hosting scale-out behavior. The benchmark is a synthetic SELECT contention baseline; it is not a substitute for a real attendance POST load test against a representative staging database.

## Admin overview baseline

Run npm run bench:admin-overview --workspace server. It measures the ten SQL reads used by the current admin overview individually and reports p50/p95/max. Seed a disposable staging database with realistic employee, attendance, leave, onboarding, assets, policy and document counts before interpreting the result. Compare query count and HTTP endpoint p50/p95 under concurrency before optimizing or adding a cache. The script is a query-level baseline, not an HTTP endpoint latency benchmark.

## CSS and themes

The existing stylesheet is legacy-ordered and contains multiple root token declarations and theme overrides. Step 7 adds a canonical semantic token file and imports it before legacy CSS, while adding semantic color-scheme, focus, and responsive table defaults at the final override layer. This is a compatibility bridge, not a full 4,214-line module extraction; migrate selectors by component in separately reviewed slices with visual snapshots, not a one-shot rewrite.

Theme validation should cover employee overview, attendance, leave/WFH forms, documents, calendar, profile, admin overview, people, enterprise HR, approvals, reports, settings, and audit in both light and dark modes. Include keyboard focus, forced-colors, reduced-motion, and mobile/tablet viewport checks.

## Accessibility and retry behavior

The sidebar now exposes navigation labels and expanded state to assistive technology. Tables have a horizontal-scroll fallback at narrow widths, and semantic focus tokens are available. Verify active NavLink aria-current, modal focus trapping/restoration, keyboard dismissal, and contrast with browser-based accessibility tooling.

API requests already have a 15-second timeout and dispatch a session-expired event on protected 401 responses. Preserve this behavior; ensure failed form submissions keep the controlled input values and prevent duplicate submission while busy. Retry actions should reuse stable idempotency keys for mutation endpoints that may be retried after ambiguous network failures.

## Closure criteria

- Save benchmark outputs from a representative dataset and expected concurrency; do not change pool defaults without a measured connection budget.
- Benchmark the complete admin overview HTTP route and query count with realistic row counts before optimizing.
- Run CI, Playwright across light/dark and mobile/tablet, and an accessibility scan.
- Review CSS refactoring in small slices with screenshot comparisons; this branch's semantic tokens are a first stage, not a claim that all legacy CSS is modularized.
- Run a manual production-like session expiry and network failure test; CI cannot prove live provider latency or production configuration.
