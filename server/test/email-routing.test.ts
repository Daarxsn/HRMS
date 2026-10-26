import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderBrandedEmailHtml,
  renderBrandedEmailText,
  buildMessage,
  htmlEscape
} from '../src/mailer.mts';
import { rfcFromHeader } from '../src/email-routing.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration014 = fs.readFileSync(path.resolve(here, '../migrations/014_phase8_email_routing_and_notifications.sql'), 'utf8');
const emailRoutingSource = fs.readFileSync(path.resolve(here, '../src/email-routing.mts'), 'utf8');
const mailerSource = fs.readFileSync(path.resolve(here, '../src/mailer.mts'), 'utf8');
const leaveRoutes = fs.readFileSync(path.resolve(here, '../src/routes/leave.mts'), 'utf8');
const workplaceRoutes = fs.readFileSync(path.resolve(here, '../src/routes/workplace.mts'), 'utf8');
const attendanceRoutes = fs.readFileSync(path.resolve(here, '../src/routes/attendance.mts'), 'utf8');
const adminRoutes = fs.readFileSync(path.resolve(here, '../src/routes/admin.mts'), 'utf8');
const enterpriseRoutes = fs.readFileSync(path.resolve(here, '../src/routes/enterprise.mts'), 'utf8');
const clientApp = fs.readFileSync(path.resolve(here, '../../client/src/App.tsx'), 'utf8');

test('Phase 8 Migration: 014 adds cc_json to email_outbox table safely', () => {
  assert.ok(migration014.includes('ALTER TABLE email_outbox'), 'Must alter email_outbox');
  assert.ok(migration014.includes('ADD COLUMN cc_json JSON NULL AFTER recipients_json'), 'Must add cc_json JSON column');
});

test('RFC 5322 From header: rfcFromHeader sanitizes and formats display name safely', () => {
  assert.equal(
    rfcFromHeader('Purvesh Sharma'),
    'Purvesh Sharma (via Falchion HRMS)'
  );

  // Removes quotes and newlines to prevent header injection
  assert.equal(
    rfcFromHeader('John "The Boss"\r\nDoe'),
    'John The Boss Doe (via Falchion HRMS)'
  );

  // Fallback when empty or whitespace
  assert.equal(
    rfcFromHeader('   '),
    'Falchion Xeniaa HRMS'
  );
});

test('Mailer: buildMessage produces RFC 5322 compliant envelope and headers without sender collision', () => {
  const msg = {
    to: ['manager@falchionxeniaa.com'],
    cc: ['hr@falchionxeniaa.com', 'director@falchionxeniaa.com'],
    fromName: 'Jane Doe (via Falchion HRMS)',
    replyTo: 'jane.doe@falchionxeniaa.com',
    subject: 'Leave Request · Jane Doe',
    text: 'Hello manager,\n\nPlease review my leave request.',
    html: '<p>Hello manager, please review my leave request.</p>'
  };

  const raw = buildMessage(msg, 'falchionxeniaa@gmail.com');

  // 1. Envelope sender stays fixed to authenticated SMTP account (avoids DMARC/SPF reject)
  assert.ok(raw.includes('From: "Jane Doe (via Falchion HRMS)" <falchionxeniaa@gmail.com>'), 'From header must match branded envelope pattern');

  // 2. Direct Reply-To routes manager responses straight to the employee
  assert.ok(raw.includes('Reply-To: jane.doe@falchionxeniaa.com'), 'Reply-To must route to employee email');

  // 3. To header contains primary recipient
  assert.ok(raw.includes('To: manager@falchionxeniaa.com'), 'To header must contain primary recipient');

  // 4. Cc header contains carbon copy recipients
  assert.ok(raw.includes('Cc: hr@falchionxeniaa.com, director@falchionxeniaa.com'), 'Cc header must contain CC recipients');

  // 5. Subject
  assert.ok(raw.includes('Subject: Leave Request · Jane Doe'), 'Subject must match');

  // 6. Multipart alternative MIME boundaries
  assert.ok(raw.includes('Content-Type: multipart/alternative; boundary="=FXHRMS"'), 'Must be multipart/alternative');
  assert.ok(raw.includes('Content-Type: text/plain; charset=utf-8') || raw.includes('Content-Type: text/plain; charset=UTF-8'), 'Must include text/plain part');
  assert.ok(raw.includes('Content-Type: text/html; charset=utf-8') || raw.includes('Content-Type: text/html; charset=UTF-8'), 'Must include text/html part');
});

test('Branded HTML Email: Enforces Falchion Xeniaa brand guidelines and escapes HTML injection', () => {
  const html = renderBrandedEmailHtml({
    kicker: 'APPROVAL REQUIRED',
    heading: 'Leave Request <script>alert(1)</script>',
    subheading: 'A new leave request was submitted.',
    statusBadge: {
      label: 'PENDING DECISION',
      variant: 'pending'
    },
    details: [
      { label: 'Employee', value: 'Jane Doe <jane@example.com>' },
      { label: 'Reason', value: 'Family function & celebration' }
    ],
    action: {
      label: 'Review in Admin Portal',
      url: 'https://hrms.falchionxeniaa.com/admin/approvals?id=123&type=leave'
    },
    footerNote: 'Replies to this notification route directly to the employee via Reply-To.'
  });

  // Brand Palette assertions
  assert.ok(html.includes('#DAAF51') || html.includes('#daaf51'), 'Must include Warm Gold (#DAAF51)');
  assert.ok(html.includes('#111111') || html.includes('#111'), 'Must include Deep Charcoal (#111111)');
  assert.ok(html.includes('#F4F4F5') || html.includes('#f4f4f5'), 'Must include Platinum / Sand Neutral');

  // XSS protection assertion
  assert.ok(!html.includes('<script>'), 'Must escape HTML tags in heading and details');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Must have escaped script tag');
  assert.ok(html.includes('Jane Doe &lt;jane@example.com&gt;'), 'Must escape angles in details');

  // Action CTA assertion
  assert.ok(html.includes('Review in Admin Portal'), 'Must include action CTA button');
  assert.ok(html.includes('https://hrms.falchionxeniaa.com/admin/approvals?id=123&amp;type=leave'), 'Must include deep link URL');

  // Text version rendering
  const text = renderBrandedEmailText({
    kicker: 'APPROVAL REQUIRED',
    heading: 'Leave Request',
    subheading: 'A new leave request was submitted.',
    details: [{ label: 'Employee', value: 'Jane Doe' }]
  });
  assert.ok(text.includes('FALCHION XENIAA · HRMS'), 'Text version must include brand header');
  assert.ok(text.includes('Leave Request') || text.includes('LEAVE REQUEST'), 'Text version must include heading');
  assert.ok(text.includes('Employee: Jane Doe'), 'Text version must format details');
});

test('Workflow Routing Engine: Exports required dual dispatch and recipient resolution functions', () => {
  assert.ok(emailRoutingSource.includes('export async function resolveRequestRecipients'), 'Must export resolveRequestRecipients');
  assert.ok(emailRoutingSource.includes('export async function dispatchWorkflowRequestEmails'), 'Must export dispatchWorkflowRequestEmails');
  assert.ok(emailRoutingSource.includes('export async function dispatchWorkflowStatusEmail'), 'Must export dispatchWorkflowStatusEmail');
  assert.ok(emailRoutingSource.includes('export function rfcFromHeader'), 'Must export rfcFromHeader');
});

test('Routing Contracts: Leave submission and review integrate dual dispatch and status emails', () => {
  assert.ok(leaveRoutes.includes('dispatchWorkflowRequestEmails'), 'Leave submission must call dispatchWorkflowRequestEmails');
  assert.ok(leaveRoutes.includes('dispatchWorkflowStatusEmail'), 'Encashment review must call dispatchWorkflowStatusEmail');
  assert.ok(leaveRoutes.includes("requestType: 'leave'"), 'Leave submission request type must be leave');
  assert.ok(leaveRoutes.includes("requestType: 'encashment'"), 'Encashment submission request type must be encashment');
});

test('Routing Contracts: Workplace and Attendance routes integrate dual dispatch workflow emails', () => {
  assert.ok(workplaceRoutes.includes('dispatchWorkflowRequestEmails'), 'WFH submission must call dispatchWorkflowRequestEmails');
  assert.ok(workplaceRoutes.includes("requestType: 'wfh'"), 'WFH request type must be wfh');

  assert.ok(attendanceRoutes.includes('dispatchWorkflowRequestEmails'), 'Attendance routes must call dispatchWorkflowRequestEmails');
  assert.ok(attendanceRoutes.includes("type:'correction'"), 'Attendance correction must be routed');
  assert.ok(attendanceRoutes.includes("type:'flex'"), 'Attendance flex-start must be routed');
});

test('Routing Contracts: Admin approvals endpoint dispatches status decision emails to employees', () => {
  assert.ok(adminRoutes.includes('dispatchWorkflowStatusEmail'), 'Admin approvals must call dispatchWorkflowStatusEmail');
  assert.ok(adminRoutes.includes('approval_status_email_dispatch_failed'), 'Approval decision must log failures without breaking transaction');
});

test('Routing Contracts: Enterprise L&D claims integrate dual dispatch and status emails', () => {
  assert.ok(enterpriseRoutes.includes('dispatchWorkflowRequestEmails'), 'L&D claim submission must call dispatchWorkflowRequestEmails');
  assert.ok(enterpriseRoutes.includes('dispatchWorkflowStatusEmail'), 'L&D claim review must call dispatchWorkflowStatusEmail');
  assert.ok(enterpriseRoutes.includes("requestType: 'learning_claim'"), 'Learning claim request type must be learning_claim');
});

test('Frontend Deep Linking: ApprovalsPage inspects searchParams id and opens ReviewModal directly', () => {
  assert.ok(clientApp.includes("searchParams.get('id')"), 'ApprovalsPage must check for id param in URL');
  assert.ok(clientApp.includes("deepLinkedProcessed"), 'ApprovalsPage must track processed deep link state');
  assert.ok(clientApp.includes("setReviewing({ item: found, decision: 'APPROVED' })"), 'ApprovalsPage must open ReviewModal when request id matches');
});
