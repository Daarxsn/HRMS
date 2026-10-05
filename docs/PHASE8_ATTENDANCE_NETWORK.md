# Phase 8 — Attendance UX & Office Network Verification

## Decision

QR attendance has been retired from the V1 product flow.

The intended office attendance journey is now:

1. Employee signs in with the pre-authorized Google/office identity.
2. Employee clicks Check in at office.
3. The browser requests one-time geolocation permission.
4. The API validates the reported GPS accuracy and distance from Falchion Xeniaa Pune HQ.
5. The API validates the request's observed network identity against the configured office network egress allow-list.
6. The attendance record is created.
7. No QR scan, camera access, or secondary fallback is required.

WFH remains a separate approved attendance mode.

## Network verification model

A normal browser does not provide a dependable office Wi-Fi SSID to a web application. The Network Information API only exposes general connection information such as a connection type and is not broadly available across browsers. Therefore the application treats network verification as a server-side control rather than trusting a browser-reported Wi-Fi name. citeturn860352search1turn860352search2

For production, configure OFFICE_NETWORK_IPS with the stable public egress IP address(es) used by the office Wi-Fi, separated by semicolons.

The API compares the observed request IP with that allow-list. Local development defaults to 127.0.0.1;::1.

## Location behavior

The location check is intentionally one-time. It uses the browser geolocation API when the employee presses the attendance action. The browser requires an explicit permission grant for geolocation, and the document must be permitted to use geolocation. citeturn860352search0turn860352search5

The application does not use continuous location tracking.

## Removed product surface

Removed from the active product flow:

- employee QR attendance fallback;
- QR scanner/camera flow;
- admin QR generation/revocation UI;
- QR attendance API routes;
- QR attendance documentation;
- QR expiry configuration.

The legacy QR database tables from the pre-production implementation are retained only for schema compatibility; they are not used by the current application. The retired QR setting is removed by migration 003_retire_qr_setting.sql.

## Acceptance

The attendance UX is considered complete for this phase when:

- office check-in prompts for location when permission is not yet granted;
- a request outside the geofence is rejected;
- a request from an unapproved network is rejected;
- a request that passes both checks records attendance;
- office check-out follows the same GPS + office-network verification;
- WFH remains independent of the office network gate;
- no QR controls appear anywhere in the active frontend or API;
- CI passes the policy, contract, database, integration and frontend smoke gates.

## Production setup requirement

Before production launch, the production environment must contain the office's stable public Wi-Fi egress IP(s) in OFFICE_NETWORK_IPS. The value is an infrastructure configuration, not a browser-provided Wi-Fi name.