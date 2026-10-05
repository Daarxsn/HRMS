# API contract

All routes are prefixed with `/api`. Successful JSON responses use UTF-8. The session is an eight-hour, signed HTTP-only cookie; clients send `credentials: include`. All protected routes enforce authorization on the server.

## Authentication

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/google` | Public, rate limited | Verify a Google ID credential; allow only an active pre-authorized email |
| GET | `/auth/me` | Signed in | Current employee profile |
| POST | `/auth/logout` | Public | Clear the session cookie |
| GET | `/auth/demo-users` | Local demo only | List seeded preview accounts |
| POST | `/auth/demo` | Local demo only | Sign in as an active preview account |

## Employee endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD` | Own attendance and fixed-lunch work calculations |
| POST | `/attendance/check-in` | GPS, approved WFH or current QR check-in |
| POST | `/attendance/check-out` | GPS, WFH or current QR check-out |
| POST | `/attendance/corrections` | Request a missing or incorrect attendance time |
| POST | `/attendance/flex-requests` | Request a 9:00–10:30 flex start |
| GET | `/attendance/exits/current` | Current temporary-exit record |
| POST | `/attendance/exits` | Record temporary exit (no location) |
| PATCH | `/attendance/exits/:id/return` | Close own exit record |
| GET | `/leave/balances` | Own yearly leave balances |
| GET/POST | `/leave` | List or apply for leave |
| DELETE | `/leave/:id` | Withdraw a pending own leave request |
| POST | `/files` | Upload private PDF/JPG/PNG attachment (10 MB limit) |
| GET | `/files/:id` | Download a private attachment after owner/admin check |
| GET/POST | `/wfh` | List or request WFH |
| GET | `/calendar?year=YYYY` | National and company holidays |
| GET/PATCH | `/account/profile` | Own profile and contact number |
| GET | `/account/notifications` | Own notifications |
| POST | `/account/notifications/:id/read` | Mark an own notification read |
| POST | `/account/notifications/read-all` | Mark all own notifications read |

GPS check-in/check-out JSON uses `{ "method":"GPS", "latitude":18.5, "longitude":73.8, "accuracy":20 }`. The server measures distance from the currently stored office coordinates and radius. QR uses `{ "method":"QR", "qrToken":"..." }`; WFH uses `{ "method":"WFH" }` and requires an approved WFH record for the date.

Leave JSON uses `{ "type":"SICK", "startDate":"YYYY-MM-DD", "endDate":"YYYY-MM-DD", "reason":"...", "attachmentId":"uuid" }`. A note is required for 3+ consecutive sick leave calendar days. Casual and sick leave draw from the same balance.

## Administrator endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/admin/dashboard` | Team attendance and pending-request summary |
| GET/POST | `/admin/users` | List/create employee, intern or administrator accounts |
| PATCH | `/admin/users/:id` | Update account, role, status, contact, probation and WFH access |
| GET | `/admin/attendance?from=...&to=...` | Attendance and GPS verification records |
| GET | `/admin/approvals` | Pending leave, WFH, attendance correction and flex requests |
| POST | `/admin/approvals/:type/:id` | Approve/reject a request with an optional note |
| GET/PUT | `/admin/settings` | Office coordinates/radius, GPS accuracy, QR expiry and WFH limit |
| POST | `/admin/qr` | Create an expiring dynamic office QR |
| DELETE | `/admin/qr/current` | Revoke active QR codes created by the signed-in administrator |
| GET | `/admin/reports.csv?from=...&to=...` | Download spreadsheet-compatible CSV |
| GET | `/admin/audit` | Recent sign-in, attendance, approval and settings events |
| GET | `/admin/temporary-exits?date=...` | Temporary exit/return record list |
| POST | `/calendar` | Add or update a company holiday |

## Database entities

`employees`, `system_settings`, `attendance_records`, `qr_challenges`, `qr_challenge_uses`, `attendance_correction_requests`, `employee_schedule_exceptions`, `flex_start_requests`, `attachments`, `leave_requests`, `wfh_requests`, `temporary_exits`, `company_holidays`, `notifications`, `audit_logs`, and `schema_migrations`.

The API returns generic errors for unexpected server failures. Input is validated server-side; employee routes are scoped to the signed-in account, and admin routes check the administrator role before database operations.
