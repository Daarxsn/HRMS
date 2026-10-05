import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from './db.ts';

const secret = () => {
  const value=process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!value || Buffer.byteLength(value)<32)) throw new Error('JWT_SECRET must be configured with at least 32 bytes in production');
  return value || 'local-development-secret-change-before-deploy-32chars';
};

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, session_version: Number(user.session_version || 0) },
    secret(),
    { expiresIn: '8h', issuer: 'falchion-xeniaa' }
  );
}
export function authCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 };
}
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.fx_session;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(token, secret(), { issuer: 'falchion-xeniaa' });
    const rows = await query(`SELECT id, employee_code, full_name, email, role, user_type, status, title, phone, wfh_enabled, joined_on, probation_end_date, session_version
      FROM employees WHERE id = :id LIMIT 1`, { id: payload.sub });
    if (!rows[0] || rows[0].status !== 'ACTIVE') return res.status(401).json({ error: 'This account is not active.' });
    if (Number(payload.session_version) !== Number(rows[0].session_version)) return res.status(401).json({ error: 'Your session has been revoked. Sign in again.' });
    req.user = rows[0];
    next();
  } catch {
    res.clearCookie('fx_session', authCookieOptions());
    res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
};
export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export async function audit({ actorId, action, entityType, entityId = null, details = {}, ipAddress = null }) {
  await query(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json, ip_address, created_at)
    VALUES (:id, :actorId, :action, :entityType, :entityId, :details, :ipAddress, UTC_TIMESTAMP())`, {
    id: crypto.randomUUID(), actorId, action, entityType, entityId,
    details: JSON.stringify(details), ipAddress
  });
}
export async function notify(userId, title, body, kind = 'UPDATE', entity = null) {
  await query(`INSERT INTO notifications (id, employee_id, title, body, kind, entity_json, created_at)
    VALUES (:id, :userId, :title, :body, :kind, :entity, UTC_TIMESTAMP())`, {
    id: crypto.randomUUID(), userId, title, body, kind, entity: entity ? JSON.stringify(entity) : null
  });
}
export async function notifyAdmins(title, body, kind = 'REQUEST', entity = null) {
  const admins = await query(`SELECT id FROM employees WHERE role='ADMIN' AND status='ACTIVE'`);
  await Promise.all(admins.map((admin) => notify(admin.id, title, body, kind, entity)));
}
