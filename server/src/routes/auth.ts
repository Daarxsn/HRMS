import { Router } from 'express';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { query, transaction } from '../db.ts';
import { authCookieOptions, signToken, audit, publicUser } from '../security.ts';
import { requireAuth } from '../security.ts';
import { asyncRoute } from '../validate.ts';

const router = Router();
const googleClient = new OAuth2Client();
const userSelect = `id, employee_code, full_name, email, role, user_type, status, title, phone, wfh_enabled, joined_on, probation_end_date, session_version`;

router.get('/demo-users', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_AUTH_ENABLED !== 'true') return res.json({ enabled: false, users: [] });
  const users = await query(`SELECT id, employee_code, full_name, email, role, user_type, title FROM employees WHERE status='ACTIVE' ORDER BY role DESC, full_name`);
  res.json({ enabled: true, users });
}));

router.post('/demo', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_AUTH_ENABLED !== 'true') return res.status(404).json({ error: 'Demo sign-in is disabled.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const users = await query(`SELECT ${userSelect} FROM employees WHERE LOWER(email)=:email AND status='ACTIVE' LIMIT 1`, { email });
  if (!users[0]) return res.status(401).json({ error: 'This demo account is not available.' });
  const user = users[0];
  res.cookie('fx_session', signToken(user), authCookieOptions()).json({ user: publicUser(user) });
  await audit({ actorId: user.id, action: 'AUTH_DEMO_SIGN_IN', entityType: 'employee', entityId: user.id, ipAddress: req.ip });
}));

router.post('/google', asyncRoute(async (req, res) => {
  const credential = req.body?.credential;
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
  res.cookie('fx_session', signToken(user), authCookieOptions()).json({ user });
  await audit({ actorId: user.id, action: 'AUTH_GOOGLE_SIGN_IN', entityType: 'employee', entityId: user.id, ipAddress: req.ip });
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => res.json({ user: publicUser(req.user) })));
router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  await transaction(async (connection) => {
    await connection.execute('UPDATE employees SET session_version = session_version + 1 WHERE id=:id', { id: req.user.id });
  });
  await audit({ actorId: req.user.id, action: 'AUTH_LOGOUT', entityType: 'employee', entityId: req.user.id, ipAddress: req.ip });
  res.clearCookie('fx_session', authCookieOptions()).json({ ok: true });
}));

export default router;
