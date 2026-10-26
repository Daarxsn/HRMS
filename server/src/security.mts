import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from './db.mts';

const secret = () => {
  const value=process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!value || Buffer.byteLength(value)<32)) throw new Error('JWT_SECRET must be configured with at least 32 bytes in production');
  return value || 'local-development-secret-change-before-deploy-32chars';
};

export function isSuperAdmin(user: any): boolean {
  return Boolean(user && (user.role === 'SUPER_ADMIN' || user.user_type === 'SUPER_ADMIN'));
}

export function isAdmin(user: any): boolean {
  return Boolean(user && (
    (user.role === 'SUPER_ADMIN' && user.user_type === 'SUPER_ADMIN') ||
    (user.role === 'ADMIN' && user.user_type === 'ADMIN')
  ));
}

export function isIntern(user: any): boolean {
  return Boolean(user && (user.role === 'INTERN' || user.user_type === 'INTERN'));
}

export type UserPlatform = 'ADMIN' | 'PEOPLE';

export function platformFor(user: any): UserPlatform {
  return isAdmin(user) ? 'ADMIN' : 'PEOPLE';
}

export function landingPathFor(user: any): string {
  return platformFor(user) === 'ADMIN' ? '/admin' : '/';
}

export function accessFor(user: any) {
  const platform = platformFor(user);
  const superAdmin = isSuperAdmin(user);
  const intern = isIntern(user);
  return {
    platform,
    landingPath: landingPathFor(user),
    role: user?.role,
    userType: user?.user_type,
    isSuperAdmin: superAdmin,
    isIntern: intern,
    capabilities: platform === 'ADMIN'
      ? [
          'admin_dashboard',
          'people_management',
          'employee_lifecycle',
          'attendance_review',
          'approvals',
          'reports',
          'holiday_calendar',
          'hr_operations',
          'asset_register',
          'policy_center',
          'offboarding',
          'security_controls',
          'employee_documents',
          'profile',
          'notifications',
          ...(superAdmin ? ['office_settings', 'audit_trail', 'role_management_super'] : [])
        ]
      : ['employee_dashboard', 'attendance', 'leave', 'work_from_home', 'temporary_exit', 'notifications', 'employee_documents', 'holiday_calendar', 'policy_center', 'profile']
  };
}

export function publicUser(user: any) {
  return {
    id: user.id,
    employee_code: user.employee_code,
    full_name: user.full_name,
    email: user.email,
    branch: user.branch,
    department: user.department,
    position: user.position,
    profile_photo_available: Boolean(user.profile_photo_key),
    role: user.role,
    user_type: user.user_type,
    status: user.status,
    title: user.title,
    phone: user.phone,
    wfh_enabled: Boolean(user.wfh_enabled),
    joined_on: user.joined_on,
    probation_end_date: user.probation_end_date,
    ...accessFor(user)
  };
}

export function parseDeviceName(userAgent?: string): string {
  if (!userAgent) return 'Web Browser';
  const ua = userAgent.toLowerCase();
  let os = 'Unknown OS';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('linux')) os = 'Linux';

  let browser = 'Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('firefox/') || ua.includes('fxios/')) browser = 'Firefox';

  return `${os} · ${browser}`;
}

export function signToken(user: any, rememberMe = false, sessionId?: string) {
  return jwt.sign(
    {
      sub: user.id,
      sid: sessionId || null,
      role: user.role,
      platform: platformFor(user),
      session_version: Number(user.session_version || 0),
      remember_me: Boolean(rememberMe)
    },
    secret(),
    { expiresIn: rememberMe ? '30d' : '8h', issuer: 'falchion-xeniaa' }
  );
}

export function authCookieOptions(rememberMe = false) {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge };
}

export async function requireAuth(req: any, res: any, next: any) {
  try {
    const token = req.cookies?.fx_session;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload: any = jwt.verify(token, secret(), { issuer: 'falchion-xeniaa', algorithms: ['HS256'] });
    const rows = await query(`SELECT id, employee_code, full_name, email, role, user_type, status, title, phone, branch, department, position, profile_photo_key, wfh_enabled, joined_on, probation_end_date, session_version
      FROM employees WHERE id = :id LIMIT 1`, { id: payload.sub });
    if (!rows[0] || rows[0].status !== 'ACTIVE') return res.status(401).json({ error: 'This account is not active.' });
    const validRole = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'INTERN'].includes(rows[0].role);
    const validUserType = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'INTERN'].includes(rows[0].user_type);
    const validPair =
      (rows[0].role === 'SUPER_ADMIN' && rows[0].user_type === 'SUPER_ADMIN') ||
      (rows[0].role === 'ADMIN' && rows[0].user_type === 'ADMIN') ||
      (rows[0].role === 'INTERN' && ['INTERN', 'EMPLOYEE'].includes(rows[0].user_type)) ||
      (rows[0].role === 'EMPLOYEE' && ['EMPLOYEE', 'INTERN'].includes(rows[0].user_type));
    if (!validRole || !validUserType || !validPair) {
      return res.status(403).json({ error: 'This account has an invalid access configuration. Ask an administrator to correct the account.' });
    }
    if (Number(payload.session_version) !== Number(rows[0].session_version)) return res.status(401).json({ error: 'Your session has been revoked. Sign in again.' });

    if (payload.sid) {
      const hash = crypto.createHash('sha256').update(payload.sid).digest('hex');
      try {
        const sessionRows = await query(`SELECT id, revoked_at, expires_at, TIMESTAMPDIFF(MINUTE, last_active_at, UTC_TIMESTAMP()) AS idle_minutes
          FROM employee_sessions WHERE session_token_hash = :hash LIMIT 1`, { hash });
        if (sessionRows[0]) {
          if (sessionRows[0].revoked_at || new Date(sessionRows[0].expires_at).getTime() < Date.now()) {
            res.clearCookie('fx_session', authCookieOptions());
            return res.status(401).json({ error: 'Your session has expired or was terminated. Sign in again.' });
          }
          if (Number(sessionRows[0].idle_minutes || 0) >= 5) {
            void query('UPDATE employee_sessions SET last_active_at = UTC_TIMESTAMP() WHERE id = :id', { id: sessionRows[0].id }).catch(() => {});
          }
        }
      } catch {
        // Fall back gracefully if employee_sessions table is not yet created
      }
    }

    req.user = rows[0];
    req.sessionId = payload.sid || null;
    req.sessionRememberMe = Boolean(payload.remember_me);
    req.access = accessFor(rows[0]);
    next();
  } catch {
    res.clearCookie('fx_session', authCookieOptions());
    res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

export const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Super Administrator access is required.' });
  next();
};

export const requireAdmin = (req: any, res: any, next: any) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Administrator access is required.' });
  next();
};

export const requirePeople = (req: any, res: any, next: any) => {
  if (isAdmin(req.user)) return res.status(403).json({ error: 'Employee or intern access is required.' });
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
  const admins = await query(`SELECT id FROM employees WHERE role IN ('SUPER_ADMIN','ADMIN') AND status='ACTIVE'`);
  await Promise.all(admins.map((admin) => notify(admin.id, title, body, kind, entity)));
}
