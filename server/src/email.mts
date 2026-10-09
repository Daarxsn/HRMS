import net from 'node:net';
import tls from 'node:tls';

type SocketLike = net.Socket | tls.TLSSocket;

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

const env = (key: string) => String(process.env[key] || '').trim();
const smtpHost = () => env('SMTP_HOST');
const smtpPort = () => Number(process.env.SMTP_PORT || 587);
const smtpSecure = () => env('SMTP_SECURE').toLowerCase() === 'true';
const smtpUser = () => env('SMTP_USER');
const smtpPassword = () => String(process.env.SMTP_PASSWORD || '');
const smtpFrom = () => env('SMTP_FROM') || smtpUser();
const smtpRequired = () => env('SMTP_REQUIRED').toLowerCase() === 'true';

export function smtpConfigured() {
  return Boolean(smtpHost() && Number.isInteger(smtpPort()) && smtpPort() > 0 && smtpUser() && smtpPassword() && smtpFrom());
}

function htmlEscape(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character] || character));
}

function normalizeEmailAddress(value: string) {
  const cleaned = value.replace(/[\r\n<>]/g, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    throw new Error('SMTP_FROM must be a valid email address.');
  }
  return cleaned;
}

class SmtpSession {
  private readonly socket: SocketLike;
  private buffer = '';
  private pending: Array<(response: { code: number; lines: string[] }) => void> = [];
  private rejected: Array<(error: Error) => void> = [];

  constructor(socket: SocketLike) {
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk) => this.consume(String(chunk)));
    this.socket.on('error', (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly.')));
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const lineEnd = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, '');
      this.buffer = this.buffer.slice(lineEnd + 1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match || match[2] !== ' ') continue;
      const resolver = this.pending.shift();
      if (resolver) resolver({ code: Number(match[1]), lines: [match[3]] });
    }
  }

  private fail(error: Error) {
    while (this.rejected.length) this.rejected.shift()!(error);
    this.pending.length = 0;
  }

  detach() {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
  }

  async read(): Promise<{ code: number; lines: string[] }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP response timed out.')), 15000);
      this.pending.push((response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.rejected.push((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  write(value: string | Buffer) {
    this.socket.write(value);
  }

  async command(command: string, expectedCodes: number[]) {
    this.write(command + '\r\n');
    const response = await this.read();
    if (!expectedCodes.includes(response.code)) throw new Error(`SMTP command failed with code ${response.code}.`);
    return response;
  }

  close() {
    this.socket.end();
  }
}

async function waitForConnection(socket: net.Socket | tls.TLSSocket, event: 'connect' | 'secureConnect') {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off(event, onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off('error', onError);
      resolve();
    };
    socket.once(event, onConnect);
    socket.once('error', onError);
  });
}

async function connectSession() {
  if (smtpSecure()) {
    const socket = tls.connect({
      host: smtpHost(),
      port: smtpPort(),
      servername: smtpHost(),
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    });
    await waitForConnection(socket, 'secureConnect');
    return new SmtpSession(socket);
  }

  const socket = net.createConnection({ host: smtpHost(), port: smtpPort() });
  await waitForConnection(socket, 'connect');
  return new SmtpSession(socket);
}

async function upgradeToStartTls(session: SmtpSession) {
  await session.command('STARTTLS', [220]);
  const rawSocket = (session as any).socket as net.Socket;
  session.detach();
  const secureSocket = tls.connect({
    socket: rawSocket,
    servername: smtpHost(),
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  });
  await waitForConnection(secureSocket, 'secureConnect');
  return new SmtpSession(secureSocket);
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function buildMessage(message: EmailMessage) {
  const sender = normalizeEmailAddress(smtpFrom());
  const recipient = normalizeEmailAddress(message.to);
  const subject = message.subject.replace(/[\r\n]/g, ' ').trim().slice(0, 200);
  const lines = [
    `From: ${sender}`,
    `To: ${recipient}`,
    ...(message.replyTo ? [`Reply-To: ${normalizeEmailAddress(message.replyTo)}`] : []),
    `Subject: ${subject}`,
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
  ];
  return lines.join('\r\n');
}

export async function sendEmail(message: EmailMessage) {
  if (!smtpConfigured()) {
    if (smtpRequired()) throw new Error('SMTP is required but not configured.');
    return { sent: false, skipped: true };
  }

  const sender = normalizeEmailAddress(smtpFrom());
  const recipient = normalizeEmailAddress(message.to);
  let session: SmtpSession | null = null;

  try {
    session = await connectSession();
    const greeting = await session.read();
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed with code ${greeting.code}.`);

    await session.command('EHLO falchionxeniaa-hrms', [250]);
    if (!smtpSecure()) {
      session = await upgradeToStartTls(session);
      await session.command('EHLO falchionxeniaa-hrms', [250]);
    }

    const auth = Buffer.from(`\0${smtpUser()}\0${smtpPassword()}`).toString('base64');
    await session.command(`AUTH PLAIN ${auth}`, [235]);

    await session.command(`MAIL FROM:<${sender}>`, [250]);
    await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.command('DATA', [354]);
    session.write(buildMessage(message) + '\r\n.\r\n');
    const accepted = await session.read();
    if (![250].includes(accepted.code)) throw new Error(`SMTP message rejected with code ${accepted.code}.`);
    await session.command('QUIT', [221]);
    return { sent: true, skipped: false };
  } finally {
    session?.close();
  }
}

export { htmlEscape };
