// UC-001 Login, FR-001..FR-004
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, all, insert, getSetting } from '../db/database.js';
import { ah, fail, unauthorized } from '../errors.js';
import { issueSession, clearSession, requireAuth, ROLES } from '../middleware/auth.js';
import { audit, unreadCount } from '../services/history.js';

const r = Router();

// Simple in-memory brute-force guard: 5 failures per email+IP per 15 minutes.
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const tooMany = key => {
  const a = attempts.get(key);
  return a && a.count >= 5 && Date.now() - a.first < WINDOW;
};
const recordFailure = key => {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
};

export function publicUser(id) {
  const u = one(`SELECT u.id, u.name, u.email, u.role, u.department_id, d.name AS department, u.contact, u.specialization,
      u.roll_number, u.guide_id, g.name AS guide_name, u.status, u.created_at
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users g ON g.id = u.guide_id WHERE u.id = ?`, id);
  return u && { ...u, roleLabel: ROLES[u.role] };
}

r.post('/login', ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = `${email}|${req.ip}`;
  if (tooMany(key)) fail('TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Please wait 15 minutes and try again.', 429);
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    recordFailure(key);
    audit(user?.id, 'LOGIN_FAILED', 'user', user?.id, { email }, req.ip);
    throw unauthorized('Incorrect email or password.');
  }
  if (user.status !== 'active') fail('ACCOUNT_DEACTIVATED', 'This account has been deactivated. Contact the administrator.', 403);
  attempts.delete(key);
  issueSession(res, user);
  audit(user.id, 'LOGIN', 'user', user.id, null, req.ip);
  res.json({ user: publicUser(user.id) });
}));

// FR-001: self-registration is for research scholars with an institutional email; staff accounts are created by admins (BR-007).
r.post('/register', ah(async (req, res) => {
  const domain = getSetting('institutional_domain');
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const departmentId = Number(req.body.department_id);
  const rollNumber = String(req.body.roll_number || '').trim();
  const fields = {};
  if (name.length < 2) fields.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
  else if (!email.endsWith('@' + domain)) fields.email = `Use your institutional email address (@${domain}).`;
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) fields.password = 'Use at least 8 characters with letters and numbers.';
  if (!one('SELECT 1 FROM departments WHERE id = ?', departmentId)) fields.department_id = 'Select your department.';
  if (!rollNumber) fields.roll_number = 'Enter your roll / enrolment number.';
  if (Object.keys(fields).length) fail('MISSING_REQUIRED', 'Please correct the highlighted fields.', 422, { fields });
  if (one('SELECT 1 FROM users WHERE email = ?', email)) fail('EMAIL_TAKEN', 'An account with this email already exists.', 409, { fields: { email: 'Already registered.' } });

  const hash = await bcrypt.hash(password, 12); // NFR-003
  const id = insert(`INSERT INTO users (name, email, password_hash, role, department_id, roll_number) VALUES (?, ?, ?, 'scholar', ?, ?)`,
    name, email, hash, departmentId, rollNumber);
  audit(id, 'REGISTER', 'user', id, { email }, req.ip);
  for (const a of all(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)) {
    insert(`INSERT INTO notifications (recipient_id, type, message) VALUES (?, 'ACTION_REQUIRED', ?)`, a.id, `New scholar ${name} registered and needs a Supervisor/Guide assigned.`);
  }
  issueSession(res, { id, role: 'scholar' });
  res.status(201).json({ user: publicUser(id) });
}));

r.post('/logout', (req, res) => {
  if (req.user) audit(req.user.id, 'LOGOUT', 'user', req.user.id, null, req.ip);
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user.id), unread: unreadCount(req.user.id) });
});

r.post('/password', requireAuth, ah(async (req, res) => {
  const { current, next } = req.body;
  const user = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(String(current || ''), user.password_hash))) fail('INVALID_INPUT', 'Current password is incorrect.', 422, { fields: { current: 'Incorrect password.' } });
  if (String(next || '').length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) fail('INVALID_INPUT', 'Use at least 8 characters with letters and numbers.', 422, { fields: { next: 'Too weak.' } });
  const hash = await bcrypt.hash(next, 12);
  one('UPDATE users SET password_hash = ? WHERE id = ? RETURNING id', hash, user.id);
  audit(user.id, 'PASSWORD_CHANGED', 'user', user.id, null, req.ip);
  res.json({ ok: true });
}));

export default r;
