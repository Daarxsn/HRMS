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
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
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
    this.write(command + '\r\n');
    const response = await this.readResponse();
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
    this.socket.end();
    await new Promise((resolve) => this.socket.once('close', resolve));
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

  if (config.secure) await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
  else await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  return new SmtpClient(socket, config.timeoutMs);
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

const buildMessage = (message: EmailMessage) => {
  const from = emailAddress(getConfig().from);
  const to = message.to.map(emailAddress).filter(Boolean);
  return [
    'From: ' + from,
    'To: ' + to.join(', '),
    ...(message.replyTo ? ['Reply-To: ' + emailAddress(message.replyTo)] : []),
    'Subject: ' + message.subject.replace(/[\r\n]/g, ' '),
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
  const recipients = (message.to || []).flatMap((item) => String(item).split(',')).map(emailAddress).filter(Boolean);
  if (!recipients.length) throw new Error('No SMTP recipients were provided.');

  let client = await openSocket(config);
  try {
    const greeting = await client.readResponse();
    if (greeting.code !== 220) throw new Error('SMTP greeting failed (' + greeting.code + ').');

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
  const value = String(process.env.HR_NOTIFICATION_EMAIL || '').trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
};

export async function sendHrNotificationEmail(message: Omit<EmailMessage, 'to'>): Promise<{ sent: boolean; skipped: boolean; recipient: string | null }> {
  const recipient = getHrNotificationEmail();
  if (!recipient) return { sent:false, skipped:true, recipient:null };
  const result = await sendEmail({ ...message, to:[recipient] });
  return { sent:result.sent, skipped:result.skipped, recipient };
}
