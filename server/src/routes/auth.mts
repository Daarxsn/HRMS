import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { query, transaction } from '../db.mts';
import { authCookieOptions, signToken, audit, publicUser, parseDeviceName } from '../security.mts';
import { requireAuth } from '../security.mts';
import { asyncRoute } from '../validate.mts';

const router = Router();
// Keep login attempts stricter than authenticated session-management requests.
const googleLoginLimiter = rateLimit({ windowMs:15*60*1000, limit:10, standardHeaders:true, legacyHeaders:false });
const googleClient = new OAuth2Client();
const userSelect = `id, employee_code, full_name, email, role, user_type, status, title, phone, branch, department, position, profile_photo_key, wfh_enabled, joined_on, probation_end_date, session_version`;

async function createAndPersistSession(user: any, req: any, rememberMe: boolean) {
  const sessionId = crypto.randomUUID();
  const sessionTokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const ipAddress = String(req.ip || '').slice(0, 45);
  const deviceName = parseDeviceName(userAgent);
  const maxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString().slice(0, 19).replace('T', ' ');

  try {
    await query(`
      INSERT INTO employee_sessions (id, employee_id, session_token_hash, device_name, user_agent, ip_address, is_remember_me, expires_at)
      VALUES (:id, :employeeId, :hash, :deviceName, :userAgent, :ip, :rememberMe, :expiresAt)
    `, {
      id: sessionId,
      employeeId: user.id,
      hash: sessionTokenHash,
      deviceName,
      userAgent,
      ip: ipAddress,
      rememberMe: rememberMe ? 1 : 0,
      expiresAt
    });
  } catch (err: any) {
    console.warn(JSON.stringify({ type: 'session_persistence_skipped', error: String(err?.message || err) }));
  }

  const token = signToken(user, rememberMe, sessionId);
  return { token, sessionId, rememberMe };
}

router.get('/demo-users', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_AUTH_ENABLED !== 'true') return res.json({ enabled: false, users: [] });
  const users = await query(`SELECT id, employee_code, full_name, email, role, user_type, title FROM employees WHERE status='ACTIVE' ORDER BY role DESC, full_name`);
  res.json({ enabled: true, users });
}));

router.post('/demo', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_AUTH_ENABLED !== 'true') return res.status(404).json({ error: 'Demo sign-in is disabled.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rememberMe = req.body?.rememberMe === undefined ? true : Boolean(req.body?.rememberMe);
  const users = await query(`SELECT ${userSelect} FROM employees WHERE LOWER(email)=:email AND status='ACTIVE' LIMIT 1`, { email });
  if (!users[0]) return res.status(401).json({ error: 'This demo account is not available.' });
  const user = users[0];
  const session = await createAndPersistSession(user, req, rememberMe);
  res.cookie('fx_session', session.token, authCookieOptions(rememberMe)).json({ user: publicUser(user) });
  await audit({ actorId: user.id, action: 'AUTH_DEMO_SIGN_IN', entityType: 'employee', entityId: user.id, details: { rememberMe, sessionId: session.sessionId }, ipAddress: req.ip });
}));

router.post('/google', googleLoginLimiter, asyncRoute(async (req, res) => {
  const credential = req.body?.credential;
  const rememberMe = req.body?.rememberMe === undefined ? true : Boolean(req.body?.rememberMe);
  if (typeof credential !== 'string' || credential.length > 5000) return res.status(400).json({ error: 'Google sign-in token is missing.' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google Sign-In is not configured yet.' });
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  } catch {
    throw Object.assign(new Error('Google could not verify this sign-in. Please try again.'), { status: 401 });
  }
  const claims = ticket.getPayload();
  if (!claims?.email || claims.email_verified !== true || !claims.sub) return res.status(401).json({ error: 'Google could not verify this account.' });
  const email = claims.email.trim().toLowerCase();
  const user = await transaction(async (connection) => {
    const [users] = await connection.execute(`SELECT ${userSelect}, google_subject FROM employees WHERE LOWER(email)=:email AND status='ACTIVE' LIMIT 1 FOR UPDATE`, { email });
    if (!users[0]) throw Object.assign(new Error('This Google account has not been authorized by Falchion Xeniaa. Ask an administrator to add it.'), { status: 403 });
    const current = users[0];
    if (current.google_subject && current.google_subject !== claims.sub) throw Object.assign(new Error('This account is linked to a different Google identity.'), { status: 403 });
    if (!current.google_subject) {
      await connection.execute('UPDATE employees SET google_subject=:subject WHERE id=:id AND google_subject IS NULL', { subject: claims.sub, id: current.id });
      current.google_subject = claims.sub;
    }
    delete current.google_subject;
    return current;
  });
  const session = await createAndPersistSession(user, req, rememberMe);
  res.cookie('fx_session', session.token, authCookieOptions(rememberMe)).json({ user: publicUser(user) });
  await audit({ actorId: user.id, action: 'AUTH_GOOGLE_SIGN_IN', entityType: 'employee', entityId: user.id, details: { rememberMe, sessionId: session.sessionId }, ipAddress: req.ip });
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => res.json({ user: publicUser(req.user) })));

router.get('/sessions', requireAuth, asyncRoute(async (req, res) => {
  const currentHash = req.sessionId ? crypto.createHash('sha256').update(req.sessionId).digest('hex') : '';
  try {
    const rows = await query(`
      SELECT id, device_name, ip_address, is_remember_me, created_at, last_active_at, expires_at,
             (session_token_hash = :currentHash) AS is_current
      FROM employee_sessions
      WHERE employee_id = :employeeId AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
      ORDER BY (session_token_hash = :currentHash) DESC, last_active_at DESC
    `, { employeeId: req.user.id, currentHash });
    res.json({
      sessions: rows.map((r: any) => ({
        id: r.id,
        deviceName: r.device_name,
        ipAddress: r.ip_address,
        isRememberMe: Boolean(r.is_remember_me),
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
        expiresAt: r.expires_at,
        isCurrent: Boolean(r.is_current)
      }))
    });
  } catch {
    res.json({
      sessions: [{
        id: req.sessionId || 'current',
        deviceName: parseDeviceName(req.headers['user-agent']),
        ipAddress: req.ip,
        isRememberMe: Boolean(req.sessionRememberMe),
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (req.sessionRememberMe ? 30 : 8 / 24) * 86400000).toISOString(),
        isCurrent: true
      }]
    });
  }
}));

router.delete('/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
  const sessionId = String(req.params.id || '');
  if (sessionId === req.sessionId) {
    const hash = crypto.createHash('sha256').update(req.sessionId).digest('hex');
    try { await query('UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE session_token_hash = :hash', { hash }); } catch {}
    res.clearCookie('fx_session', authCookieOptions()).json({ ok: true, signedOut: true });
    return;
  }
  const result = await query(`UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = :id AND employee_id = :employeeId AND revoked_at IS NULL`, {
    id: sessionId,
    employeeId: req.user.id
  });
  if (!result.affectedRows) throw Object.assign(new Error('Session not found or already revoked.'), { status: 404 });
  await audit({ actorId: req.user.id, action: 'SESSION_REVOKED_REMOTE', entityType: 'employee_session', entityId: sessionId, ipAddress: req.ip });
  res.json({ ok: true, signedOut: false });
}));

router.delete('/sessions', requireAuth, asyncRoute(async (req, res) => {
  const currentHash = req.sessionId ? crypto.createHash('sha256').update(req.sessionId).digest('hex') : '';
  const result = await query(`
    UPDATE employee_sessions
    SET revoked_at = UTC_TIMESTAMP()
    WHERE employee_id = :employeeId AND session_token_hash != :currentHash AND revoked_at IS NULL
  `, { employeeId: req.user.id, currentHash });
  await audit({ actorId: req.user.id, action: 'ALL_OTHER_SESSIONS_REVOKED', entityType: 'employee', entityId: req.user.id, details: { revokedCount: result.affectedRows }, ipAddress: req.ip });
  res.json({ ok: true, revokedCount: result.affectedRows });
}));

router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  const allDevices = Boolean(req.body?.allDevices);
  if (req.sessionId) {
    const hash = crypto.createHash('sha256').update(req.sessionId).digest('hex');
    try {
      await query('UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE session_token_hash = :hash', { hash });
    } catch {}
  }
  if (allDevices || !req.sessionId) {
    await transaction(async (connection) => {
      await connection.execute('UPDATE employees SET session_version = session_version + 1 WHERE id=:id', { id: req.user.id });
      try {
        await connection.execute('UPDATE employee_sessions SET revoked_at = UTC_TIMESTAMP() WHERE employee_id = :id AND revoked_at IS NULL', { id: req.user.id });
      } catch {}
    });
  }
  await audit({ actorId: req.user.id, action: allDevices ? 'AUTH_LOGOUT_ALL_DEVICES' : 'AUTH_LOGOUT', entityType: 'employee', entityId: req.user.id, ipAddress: req.ip });
  res.clearCookie('fx_session', authCookieOptions()).json({ ok: true });
}));

export default router;
