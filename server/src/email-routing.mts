import { query } from './db.mts';
import {
  getHrNotificationEmail,
  renderBrandedEmailHtml,
  renderBrandedEmailText,
  escapeHtml
} from './mailer.mts';
import { enqueueEmail } from './email-outbox.mts';

export function getPortalOrigin(): string {
  const origin = String(process.env.APP_ORIGIN || '').replace(/\/$/, '');
  return origin || 'https://hrms.fxcoworks.com';
}

export function rfcFromHeader(name: string): string {
  const safeName = String(name || '').replace(/["<>]/g, '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!safeName) return 'Falchion Xeniaa HRMS';
  return `${safeName} (via Falchion HRMS)`;
}

export type RecipientRoutingResult = {
  primaryRecipients: string[];
  ccRecipients: string[];
  managerName: string | null;
  managerEmail: string | null;
  employeeName: string;
  employeeEmail: string;
  employeeCode: string;
};

export async function resolveRequestRecipients(employeeId: string): Promise<RecipientRoutingResult> {
  const [emp] = await query(
    `SELECT e.id, e.full_name, e.email, e.employee_code, e.reporting_manager_id,
            m.full_name AS manager_name, m.email AS manager_email
     FROM employees e
     LEFT JOIN employees m ON m.id = e.reporting_manager_id
     WHERE e.id = :id LIMIT 1`,
    { id: employeeId }
  );

  const hrEmail = getHrNotificationEmail();
  const employeeName = emp?.full_name || 'Team member';
  const employeeEmail = emp?.email || '';
  const employeeCode = emp?.employee_code || '';
  const managerEmail = emp?.manager_email?.trim()?.toLowerCase() || null;
  const managerName = emp?.manager_name || null;

  if (managerEmail && (!hrEmail || managerEmail !== hrEmail)) {
    return {
      primaryRecipients: [managerEmail],
      ccRecipients: hrEmail ? [hrEmail] : [],
      managerName,
      managerEmail,
      employeeName,
      employeeEmail,
      employeeCode
    };
  }

  return {
    primaryRecipients: hrEmail ? [hrEmail] : [],
    ccRecipients: [],
    managerName,
    managerEmail,
    employeeName,
    employeeEmail,
    employeeCode
  };
}

export type WorkflowSubmissionEmailOptions = {
  requestId: string;
  requestType: 'leave' | 'wfh' | 'correction' | 'flex' | 'encashment' | 'learning_claim';
  employeeId: string;
  title: string;
  summaryDetails: Array<{ label: string; value: string }>;
  reason?: string | null;
  attachmentNote?: string | null;
  portalRoute: string;
  adminApprovalRoute?: string;
};

export async function dispatchWorkflowRequestEmails(options: WorkflowSubmissionEmailOptions) {
  const origin = getPortalOrigin();
  const routing = await resolveRequestRecipients(options.employeeId);
  const hrEmail = getHrNotificationEmail();
  const approvalUrl = options.adminApprovalRoute
    ? `${origin}${options.adminApprovalRoute}`
    : `${origin}/admin/approvals?id=${encodeURIComponent(options.requestId)}&type=${encodeURIComponent(options.requestType)}`;
  const employeePortalUrl = `${origin}${options.portalRoute}`;

  const allDetails: Array<{ label: string; value: string }> = [
    { label: 'Employee', value: `${routing.employeeName} (${routing.employeeCode})` },
    { label: 'Work Email', value: routing.employeeEmail },
    ...options.summaryDetails
  ];
  if (options.reason) {
    allDetails.push({ label: 'Context / Note', value: options.reason });
  }
  if (options.attachmentNote) {
    allDetails.push({ label: 'Documentation', value: options.attachmentNote });
  }

  const results = {
    managerEmail: null as any,
    confirmationEmail: null as any
  };

  // 1. Manager & HR Admin Notification Email
  if (routing.primaryRecipients.length > 0) {
    const adminSubject = `${options.title} · ${routing.employeeName} · ${options.summaryDetails[0]?.value || ''}`.trim();
    const adminSubheading = routing.managerName
      ? `A new ${options.title.toLowerCase()} was submitted for your approval as reporting manager.`
      : `A new ${options.title.toLowerCase()} was submitted for administrative review.`;

    const adminHtml = renderBrandedEmailHtml({
      kicker: 'APPROVAL REQUIRED',
      heading: options.title,
      subheading: adminSubheading,
      statusBadge: {
        label: 'PENDING DECISION',
        variant: 'pending'
      },
      details: allDetails,
      action: {
        label: 'Review in Admin Portal',
        url: approvalUrl
      },
      footerNote: 'Replies to this notification route directly to the employee via Reply-To. Final approvals must be recorded in the HRMS Portal.'
    });

    const adminText = renderBrandedEmailText({
      kicker: 'APPROVAL REQUIRED',
      heading: options.title,
      subheading: adminSubheading,
      statusBadge: {
        label: 'PENDING DECISION',
        variant: 'pending'
      },
      details: allDetails,
      action: {
        label: 'Review in Admin Portal',
        url: approvalUrl
      },
      footerNote: 'Replies to this notification route directly to the employee via Reply-To.'
    });

    try {
      results.managerEmail = await enqueueEmail({
        to: routing.primaryRecipients,
        cc: routing.ccRecipients,
        subject: adminSubject,
        text: adminText,
        html: adminHtml,
        replyTo: routing.employeeEmail,
        fromName: rfcFromHeader(routing.employeeName)
      }, `${options.requestType}-review:${options.requestId}`);
    } catch (e: any) {
      console.error(JSON.stringify({
        type: 'workflow_review_email_enqueue_failed',
        request_id: options.requestId,
        error: String(e?.message || e)
      }));
    }
  }

  // 2. Dual Dispatch: Employee Confirmation Receipt
  if (routing.employeeEmail) {
    const receiptSubject = `Confirmation: Your ${options.title.toLowerCase()} has been received`;
    const managerNote = routing.managerName
      ? `Your request has been forwarded to ${routing.managerName} and HR Operations.`
      : `Your request has been forwarded to Falchion Xeniaa HR Operations.`;

    const receiptHtml = renderBrandedEmailHtml({
      kicker: 'CONFIRMATION RECEIPT',
      heading: `${options.title} Received`,
      subheading: `Hello ${routing.employeeName}, we received your ${options.title.toLowerCase()}. ${managerNote}`,
      statusBadge: {
        label: 'SUBMITTED',
        variant: 'neutral'
      },
      details: allDetails,
      action: {
        label: 'View in People Portal',
        url: employeePortalUrl
      },
      footerNote: 'You will receive another notification once your request has been reviewed.'
    });

    const receiptText = renderBrandedEmailText({
      kicker: 'CONFIRMATION RECEIPT',
      heading: `${options.title} Received`,
      subheading: `Hello ${routing.employeeName}, we received your ${options.title.toLowerCase()}. ${managerNote}`,
      statusBadge: {
        label: 'SUBMITTED',
        variant: 'neutral'
      },
      details: allDetails,
      action: {
        label: 'View in People Portal',
        url: employeePortalUrl
      },
      footerNote: 'You will receive another notification once your request has been reviewed.'
    });

    try {
      results.confirmationEmail = await enqueueEmail({
        to: [routing.employeeEmail],
        subject: receiptSubject,
        text: receiptText,
        html: receiptHtml,
        replyTo: hrEmail,
        fromName: 'Falchion Xeniaa HRMS'
      }, `${options.requestType}-receipt:${options.requestId}`);
    } catch (e: any) {
      console.error(JSON.stringify({
        type: 'workflow_receipt_email_enqueue_failed',
        request_id: options.requestId,
        error: String(e?.message || e)
      }));
    }
  }

  return results;
}

export type WorkflowStatusEmailOptions = {
  requestId: string;
  requestType: 'leave' | 'wfh' | 'correction' | 'flex' | 'encashment' | 'learning_claim';
  employeeId: string;
  title: string;
  decision: 'APPROVED' | 'REJECTED';
  summaryDetails: Array<{ label: string; value: string }>;
  reviewerNote?: string | null;
  reviewerName?: string | null;
  portalRoute: string;
};

export async function dispatchWorkflowStatusEmail(options: WorkflowStatusEmailOptions) {
  const [emp] = await query(
    `SELECT full_name, email, employee_code FROM employees WHERE id = :id LIMIT 1`,
    { id: options.employeeId }
  );
  if (!emp?.email) return null;

  const origin = getPortalOrigin();
  const hrEmail = getHrNotificationEmail();
  const employeePortalUrl = `${origin}${options.portalRoute}`;
  const isApproved = options.decision === 'APPROVED';
  const statusLabel = isApproved ? 'APPROVED' : 'DECLINED';
  const verb = isApproved ? 'approved' : 'declined';

  const details = [
    { label: 'Employee', value: `${emp.full_name} (${emp.employee_code})` },
    ...options.summaryDetails,
    { label: 'Decision', value: statusLabel }
  ];
  if (options.reviewerNote) {
    details.push({ label: 'Reviewer Note', value: options.reviewerNote });
  }

  const subject = `Your ${options.title.toLowerCase()} was ${verb}`;
  const subheading = isApproved
    ? `Great news! Your ${options.title.toLowerCase()} has been approved.`
    : `Your ${options.title.toLowerCase()} was reviewed and declined.`;

  const html = renderBrandedEmailHtml({
    kicker: 'DECISION NOTIFICATION',
    heading: `${options.title} ${statusLabel}`,
    subheading,
    statusBadge: {
      label: statusLabel,
      variant: isApproved ? 'success' : 'danger'
    },
    details,
    action: {
      label: 'View in People Portal',
      url: employeePortalUrl
    },
    footerNote: isApproved
      ? 'The approved schedule or balance updates have been applied to your account.'
      : 'If you have questions regarding this decision, you can reply directly to HR or discuss with your reviewer.'
  });

  const text = renderBrandedEmailText({
    kicker: 'DECISION NOTIFICATION',
    heading: `${options.title} ${statusLabel}`,
    subheading,
    statusBadge: {
      label: statusLabel,
      variant: isApproved ? 'success' : 'danger'
    },
    details,
    action: {
      label: 'View in People Portal',
      url: employeePortalUrl
    },
    footerNote: isApproved
      ? 'The approved schedule or balance updates have been applied to your account.'
      : 'If you have questions regarding this decision, you can reply directly to HR or discuss with your reviewer.'
  });

  try {
    return await enqueueEmail({
      to: [emp.email],
      subject,
      text,
      html,
      replyTo: hrEmail,
      fromName: 'Falchion Xeniaa HRMS'
    }, `${options.requestType}-status:${options.requestId}:${options.decision}`);
  } catch (e: any) {
    console.error(JSON.stringify({
      type: 'workflow_status_email_enqueue_failed',
      request_id: options.requestId,
      error: String(e?.message || e)
    }));
    return null;
  }
}
