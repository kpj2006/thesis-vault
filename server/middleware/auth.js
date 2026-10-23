import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/database.js';
import { forbidden, unauthorized } from '../errors.js';

export const COOKIE = 'tv_session';

export const ROLES = {
  scholar: 'Research Scholar',
  supervisor: 'Supervisor / Guide',
  examiner: 'Examiner / Committee Member',
  librarian: 'Librarian',
  admin: 'Administrator',
  institute: 'Institute / Management',
};

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: Boolean(config.tlsCert),
    maxAge: config.sessionHours * 3600 * 1000,
  });
}

export const clearSession = res => res.clearCookie(COOKIE);

// FR-002/FR-003: resolve the authenticated user and their role on every request.
// The role is re-read from the database so role changes and deactivation take effect immediately.
export function authenticate(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { sub } = jwt.verify(token, config.jwtSecret);
      const user = one(`SELECT id, name, email, role, department_id, guide_id, status FROM users WHERE id = ?`, sub);
      if (user && user.status === 'active') req.user = user;
    } catch { /* invalid or expired token: treat as anonymous */ }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

// FR-004/FR-005/BR-006: role-based access control.
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
