import net from 'node:net';
import tls from 'node:tls';

type SmtpResponse = { code: number; lines: string[] };

type PendingResponse = {
  code: number;
  lines: string[];
  resolve: (response: SmtpResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type EmailMessage = {
  to: string[];
  cc?: string[] | null;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
  fromName?: string | null;
  messageId?: string | null;
};

const getConfig = () => ({
  host: String(process.env.SMTP_HOST || '').trim(),
  port: Number(process.env.SMTP_PORT || 587),
  user: String(process.env.SMTP_USER || '').trim(),
  password: String(process.env.SMTP_PASSWORD || ''),
  from: String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  required: String(process.env.SMTP_REQUIRED || 'false').toLowerCase() === 'true',
  timeoutMs: Math.max(3000, Number(process.env.SMTP_TIMEOUT_MS || 15000))
});

export const smtpConfigured = () => {
  const config = getConfig();
  return Boolean(
    config.host &&
    Number.isInteger(config.port) &&
    config.port > 0 &&
    config.port <= 65535 &&
    config.user &&
    config.password &&
    config.from
  );
};

const emailAddress = (value: string) => value.replace(/[\r\n<>]/g, '').trim();

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}

class SmtpClient {
  socket;
  buffer = '';
  pending: PendingResponse[] = [];
  closed = false;

  constructor(socket, timeoutMs) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.consume(String(chunk)));
    socket.on('error', (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    socket.on('close', () => {
      if (!this.closed) this.fail(new Error('SMTP connection closed unexpectedly.'));
    });
    this.timeoutMs = timeoutMs;
  }

  timeoutMs;

  consume(chunk: string) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const index = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      const code = Number(match[1]);
      const separator = match[2];
      const current = this.pending[0];
      if (!current) continue;
      current.lines.push(match[3]);
      current.code = code;
      if (separator === ' ') {
        this.pending.shift();
        clearTimeout(current.timer);
        current.resolve({ code, lines: current.lines });
      }
    }
  }

  fail(error: Error) {
    while (this.pending.length) {
      const current = this.pending.shift();
      clearTimeout(current.timer);
      current.reject(error);
    }
  }

  readResponse(): Promise<SmtpResponse> {
    return new Promise<SmtpResponse>((resolve, reject) => {
      const entry = {
        code: 0,
        lines: [],
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.pending.indexOf(entry);
          if (index >= 0) this.pending.splice(index, 1);
          reject(new Error('SMTP server response timed out.'));
        }, this.timeoutMs)
      };
      this.pending.push(entry);
    });
  }

  write(value: string | Buffer) {
    this.socket.write(value);
  }

  async command(command: string, expected: number[]): Promise<SmtpResponse> {
    // Register the response waiter before writing so very fast SMTP servers cannot
    // answer before the client starts listening.
    const responsePromise = this.readResponse();
    this.write(command + '\r\n');
    const response = await responsePromise;
    if (!expected.includes(response.code)) {
      throw new Error('SMTP command failed (' + response.code + ').');
    }
    return response;
  }

  detach() {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
  }

  async close(): Promise<void> {
    this.closed = true;
    const socket = this.socket as any;
    if (socket.destroyed) return;
    await new Promise<void>((resolve) => {
      let doneCalled = false;
      const done = () => {
        if (doneCalled) return;
        doneCalled = true;
        socket.removeListener('close', done);
        socket.removeListener('error', done);
        resolve();
      };
      socket.once('close', done);
      socket.once('error', done);
      try {
        socket.end(() => done());
      } catch {
        done();
      }
      if (socket.destroyed) done();
    });
  }
}

const openSocket = async (config): Promise<SmtpClient> => {
  const socket = config.secure
    ? tls.connect({
        host: config.host,
        port: config.port,
        servername: config.host,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      })
    : net.createConnection({ host: config.host, port: config.port });

  const client = new SmtpClient(socket, config.timeoutMs);

  // Register the greeting waiter before waiting for connection establishment.
  // SMTP servers are allowed to send the 220 banner immediately.
  const greetingPromise = client.readResponse();

  if (config.secure) {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
  }

  const greeting = await greetingPromise;
  if (greeting.code !== 220) throw new Error('SMTP greeting failed (' + greeting.code + ').');
  return client;
};

const startTls = async (client: SmtpClient, config): Promise<SmtpClient> => {
  await client.command('STARTTLS', [220]);
  const rawSocket = client.socket as net.Socket;
  client.detach();
  const upgraded = tls.connect({
    socket: rawSocket,
    servername: config.host,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  });
  await new Promise<void>((resolve, reject) => {
    upgraded.once('secureConnect', resolve);
    upgraded.once('error', reject);
  });
  client.closed = true;
  client = new SmtpClient(upgraded, config.timeoutMs);
  await client.command('EHLO falchionxeniaa-hrms', [250]);
  return client;
};

const dotStuff = (body) => body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

export const buildMessage = (message: EmailMessage, senderOverride: string | null = null) => {
  const from = emailAddress(senderOverride || getConfig().from);
  const fromName = message.fromName ? String(message.fromName).replace(/[\r\n"]/g, '').trim().slice(0, 120) : '';
  const fromHeader = fromName ? '"' + fromName + '" <' + from + '>' : from;
  const to = (message.to || []).flatMap((item) => String(item).split(',')).map(emailAddress).filter(Boolean);
  const cc = (message.cc || []).flatMap((item) => String(item).split(',')).map(emailAddress).filter(Boolean);
  return [
    'From: ' + fromHeader,
    'To: ' + to.join(', '),
    ...(cc.length ? ['Cc: ' + cc.join(', ')] : []),
    ...(message.replyTo ? ['Reply-To: ' + emailAddress(message.replyTo)] : []),
    'Subject: ' + message.subject.replace(/[\r\n]/g, ' '),
    ...(message.messageId ? ['Message-ID: <' + String(message.messageId).replace(/[\r\n<>]/g, '') + '>'] : []),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="=FXHRMS"',
    '',
    '--=FXHRMS',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(message.text),
    '',
    '--=FXHRMS',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(message.html),
    '',
    '--=FXHRMS--',
    ''
  ].join('\r\n');
};

export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean; skipped: boolean }> {
  if (!smtpConfigured()) {
    if (getConfig().required) throw new Error('SMTP is required but not fully configured.');
    return { sent: false, skipped: true };
  }

  const config = getConfig();
  const toRecipients = (message.to || []).flatMap((item) => String(item).split(',')).map(emailAddress).filter(Boolean);
  const ccRecipients = (message.cc || []).flatMap((item) => String(item).split(',')).map(emailAddress).filter(Boolean);
  const recipients = [...new Set([...toRecipients, ...ccRecipients])];
  if (!recipients.length) throw new Error('No SMTP recipients were provided.');

  let client = await openSocket(config);
  try {
    const ehlo = await client.command('EHLO falchionxeniaa-hrms', [250]);
    if (!config.secure) {
      if (!ehlo.lines.some((line) => /^STARTTLS(?: |$)/i.test(line.trim()))) throw new Error('SMTP server does not advertise STARTTLS.');
      client = await startTls(client, config);
    }

    const authPlain = Buffer.from('\0' + config.user + '\0' + config.password).toString('base64');
    await client.command('AUTH PLAIN ' + authPlain, [235]);

    await client.command('MAIL FROM:<' + emailAddress(config.from) + '>', [250]);
    for (const recipient of recipients) {
      await client.command('RCPT TO:<' + recipient + '>', [250, 251]);
    }
    await client.command('DATA', [354]);
    client.write(buildMessage(message) + '\r\n.\r\n');
    const accepted = await client.readResponse();
    if (![250].includes(accepted.code)) throw new Error('SMTP message was not accepted (' + accepted.code + ').');
    await client.command('QUIT', [221]);
    return { sent: true, skipped: false };
  } finally {
    try { await client.close(); } catch {}
  }
}

export { escapeHtml, escapeHtml as htmlEscape };

export const getHrNotificationEmail = () => {
  const value = String(process.env.HR_NOTIFICATION_EMAIL || 'falchionxeniaa@gmail.com').trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
};

export async function sendHrNotificationEmail(message: Omit<EmailMessage, 'to'>): Promise<{ sent: boolean; skipped: boolean; recipient: string | null }> {
  const recipient = getHrNotificationEmail();
  if (!recipient) return { sent:false, skipped:true, recipient:null };
  const result = await sendEmail({ ...message, to:[recipient] });
  return { sent:result.sent, skipped:result.skipped, recipient };
}

export type BrandedEmailOptions = {
  kicker?: string;
  heading: string;
  subheading?: string;
  statusBadge?: {
    label: string;
    variant: 'pending' | 'success' | 'danger' | 'neutral';
  };
  details: Array<{ label: string; value: string }>;
  action?: {
    label: string;
    url: string;
  };
  footerNote?: string;
};

export function renderBrandedEmailHtml(options: BrandedEmailOptions): string {
  const badgeStyle = options.statusBadge ? {
    success: 'background:#DCFCE7;color:#166534;border:1px solid #BBF7D0;',
    danger: 'background:#FEE2E2;color:#991B1B;border:1px solid #FECACA;',
    pending: 'background:#FEF9C3;color:#854D0E;border:1px solid #FEF08A;',
    neutral: 'background:#F4F4F5;color:#3F3F46;border:1px solid #E4E4E7;'
  }[options.statusBadge.variant] : '';

  const detailsRows = options.details.map((d, index) => {
    const bg = index % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
    return `<tr>
      <td style="padding:10px 14px;font-size:13px;color:#71717A;width:38%;border-bottom:1px solid #F4F4F5;background:${bg};font-weight:600">${escapeHtml(d.label)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#18181B;border-bottom:1px solid #F4F4F5;background:${bg};font-weight:600">${escapeHtml(d.value)}</td>
    </tr>`;
  }).join('');

  const actionBlock = options.action ? `
    <div style="margin:24px 0 12px;text-align:left">
      <a href="${escapeHtml(options.action.url)}" style="display:inline-block;background:#DAAF51;color:#111111;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:0.04em;padding:12px 24px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.1)">
        ${escapeHtml(options.action.label)} &rarr;
      </a>
    </div>` : '';

  const statusBadgeHtml = options.statusBadge ? `
    <div style="margin-top:12px">
      <span style="display:inline-block;padding:4px 10px;font-size:11px;font-weight:800;letter-spacing:0.06em;border-radius:999px;text-transform:uppercase;${badgeStyle}">
        ${escapeHtml(options.statusBadge.label)}
      </span>
    </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(options.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181B;line-height:1.5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F5;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border-radius:10px;overflow:hidden;border:1px solid #E4E4E7;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
          <!-- Brand Header -->
          <tr>
            <td style="background-color:#111111;padding:22px 28px;border-bottom:3px solid #DAAF51">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.16em;color:#DAAF51;text-transform:uppercase;display:block">
                ${escapeHtml(options.kicker || 'FALCHION XENIAA · HRMS')}
              </span>
              <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.01em">
                ${escapeHtml(options.heading)}
              </h1>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:28px">
              ${options.subheading ? `<p style="margin:0 0 16px;font-size:14px;color:#52525B;line-height:1.6">${escapeHtml(options.subheading)}</p>` : ''}
              ${statusBadgeHtml}

              <!-- Details Table -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border:1px solid #E4E4E7;border-radius:8px;overflow:hidden;border-collapse:collapse">
                ${detailsRows}
              </table>

              ${actionBlock}

              ${options.footerNote ? `<p style="margin:18px 0 0;font-size:12px;color:#71717A;line-height:1.5">${escapeHtml(options.footerNote)}</p>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#FAFAFA;padding:18px 28px;border-top:1px solid #E4E4E7;text-align:left">
              <p style="margin:0;font-size:11px;color:#A1A1AA;line-height:1.5">
                Falchion Xeniaa HRMS &middot; People Operations<br>
                This is an automated operational notification. You can reply directly to this email to contact the sender.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderBrandedEmailText(options: BrandedEmailOptions): string {
  const lines: string[] = [
    'FALCHION XENIAA · HRMS',
    options.kicker ? `[${options.kicker}]` : '',
    '',
    options.heading.toUpperCase(),
    options.subheading || '',
    options.statusBadge ? `Status: ${options.statusBadge.label}` : '',
    '------------------------------------------------------------',
    ...options.details.map((d) => `${d.label}: ${d.value}`),
    '------------------------------------------------------------'
  ];
  if (options.action) {
    lines.push('', `${options.action.label}: ${options.action.url}`);
  }
  if (options.footerNote) {
    lines.push('', options.footerNote);
  }
  lines.push(
    '',
    'Falchion Xeniaa HRMS · People Operations',
    'Replies to this email route directly to the designated contact via Reply-To.'
  );
  return lines.filter(Boolean).join('\n');
}
