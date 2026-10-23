// Administration (UC-002 Manage Users, UC-018 View Audit Log, BR-007), reports (UC-019, BR-010), notifications, dashboard
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { one, all, run, insert, tx, getSetting, setSetting } from '../db/database.js';
import { fail } from '../errors.js';
import { requireAuth, requireRole, ROLES } from '../middleware/auth.js';
import { audit, notify, unreadCount } from '../services/history.js';
import { assignExaminer } from '../services/review.js';
import { researchReport, publishedCsv } from '../services/reports.js';
import { STATUS_LABELS } from '../services/workflow.js';
import { DEGREES } from '../services/submission.js';
import { publicUser } from './auth.js';

const r = Router();
const admin = requireRole('admin');

// ---- Reference data ----------------------------------------------------------
r.get('/meta', (req, res) => res.json({
  departments: all('SELECT id, code, name FROM departments ORDER BY name'),
  degrees: DEGREES,
  statuses: STATUS_LABELS,
  roles: ROLES,
  threshold: Number(getSetting('plagiarism_threshold')),
  domain: getSetting('institutional_domain'),
  institute: getSetting('institute_name'),
}));

// ---- Users (BR-007: only administrators manage accounts and roles) -----------
r.get('/admin/users', admin, (req, res) => {
  const { role, q, status } = req.query;
  const where = ['1 = 1']; const p = [];
  if (role) { where.push('u.role = ?'); p.push(role); }
  if (status) { where.push('u.status = ?'); p.push(status); }
  if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.roll_number LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json({ users: all(`SELECT u.id, u.name, u.email, u.role, u.status, u.roll_number, u.specialization, u.contact, u.department_id, u.guide_id,
      d.name AS department, g.name AS guide_name, u.created_at,
      (SELECT COUNT(*) FROM theses t WHERE t.guide_id = u.id AND t.status <> 'Draft') AS guiding
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users g ON g.id = u.guide_id
    WHERE ${where.join(' AND ')} ORDER BY u.role, u.name`, ...p) });
});

function readUser(body, { creating }) {
  const u = {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    role: body.role,
    department_id: body.department_id ? Number(body.department_id) : null,
    contact: String(body.contact || '').trim() || null,
    specialization: String(body.specialization || '').trim() || null,
    roll_number: String(body.roll_number || '').trim() || null,
    guide_id: body.guide_id ? Number(body.guide_id) : null,
  };
  const fields = {};
  if (u.name.length < 2) fields.name = 'Name is required.';
  if (!/^[^\s@]+@[^\s@]+$/.test(u.email)) fields.email = 'Valid email is required.';
  if (!ROLES[u.role]) fields.role = 'Select a role.';
  if (u.department_id && !one('SELECT 1 FROM departments WHERE id = ?', u.department_id)) fields.department_id = 'Invalid department.';
  if (u.role !== 'scholar') u.guide_id = null;
  if (u.guide_id && !one(`SELECT 1 FROM users WHERE id = ? AND role = 'supervisor' AND status = 'active'`, u.guide_id)) fields.guide_id = 'Guide must be an active supervisor.';
  if (creating && body.password && String(body.password).length < 8) fields.password = 'At least 8 characters.';
  if (Object.keys(fields).length) fail('MISSING_REQUIRED', 'Please correct the highlighted fields.', 422, { fields });
  return u;
}

r.post('/admin/users', admin, async (req, res) => {
  const u = readUser(req.body, { creating: true });
  if (one('SELECT 1 FROM users WHERE email = ?', u.email)) fail('EMAIL_TAKEN', 'An account with this email already exists.', 409, { fields: { email: 'Already registered.' } });
  const tempPassword = req.body.password || `Tv-${crypto.randomBytes(4).toString('hex')}1`;
  const hash = await bcrypt.hash(tempPassword, 12);
  const id = insert(`INSERT INTO users (name, email, password_hash, role, department_id, contact, specialization, roll_number, guide_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, u.name, u.email, hash, u.role, u.department_id, u.contact, u.specialization, u.roll_number, u.guide_id);
  audit(req.user.id, 'USER_CREATED', 'user', id, { email: u.email, role: u.role }, req.ip);
  res.status(201).json({ user: publicUser(id), tempPassword: req.body.password ? null : tempPassword });
});

r.put('/admin/users/:id', admin, (req, res) => {
  const existing = one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!existing) fail('NOT_FOUND', 'User not found.', 404);
  const u = readUser(req.body, { creating: false });
  if (one('SELECT 1 FROM users WHERE email = ? AND id <> ?', u.email, existing.id)) fail('EMAIL_TAKEN', 'Another account uses this email.', 409, { fields: { email: 'Already in use.' } });
  if (existing.id === req.user.id && u.role !== 'admin') fail('INVALID_INPUT', 'You cannot remove your own administrator role.', 409);
  tx(() => {
    run(`UPDATE users SET name = ?, email = ?, role = ?, department_id = ?, contact = ?, specialization = ?, roll_number = ?, guide_id = ? WHERE id = ?`,
      u.name, u.email, u.role, u.department_id, u.contact, u.specialization, u.roll_number, u.guide_id, existing.id);
    // Reassigning a scholar's guide also moves their theses that are still before committee review.
    if (u.role === 'scholar' && u.guide_id !== existing.guide_id) {
      run(`UPDATE theses SET guide_id = ? WHERE author_id = ? AND status IN ('Draft','UnderGuideReview','RevisionRequired')`, u.guide_id, existing.id);
      if (u.guide_id) {
        const g = one('SELECT name FROM users WHERE id = ?', u.guide_id);
        notify(existing.id, 'ASSIGNMENT', `${g.name} has been assigned as your Supervisor/Guide.`);
        notify(u.guide_id, 'ASSIGNMENT', `You have been assigned as Supervisor/Guide for ${u.name}.`);
      }
    }
    const changes = Object.fromEntries(Object.entries(u).filter(([k, v]) => existing[k] !== v));
    audit(req.user.id, existing.role !== u.role ? 'ROLE_CHANGED' : 'USER_UPDATED', 'user', existing.id, changes, req.ip);
  });
  res.json({ user: publicUser(existing.id) });
});

r.put('/admin/users/:id/status', admin, (req, res) => {
  const status = req.body.status === 'active' ? 'active' : 'deactivated';
  const id = Number(req.params.id);
  if (id === req.user.id) fail('INVALID_INPUT', 'You cannot deactivate your own account.', 409);
  run('UPDATE users SET status = ? WHERE id = ?', status, id);
  audit(req.user.id, status === 'active' ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', 'user', id, null, req.ip);
  res.json({ user: publicUser(id) });
});

r.post('/admin/users/:id/reset-password', admin, async (req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT 1 FROM users WHERE id = ?', id)) fail('NOT_FOUND', 'User not found.', 404);
  const tempPassword = `Tv-${crypto.randomBytes(4).toString('hex')}1`;
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(tempPassword, 12), id);
  audit(req.user.id, 'PASSWORD_RESET', 'user', id, null, req.ip);
  res.json({ tempPassword });
});

// ---- Departments & settings -------------------------------------------------
r.post('/admin/departments', admin, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  if (!code || !name) fail('MISSING_REQUIRED', 'Code and name are required.', 422);
  if (one('SELECT 1 FROM departments WHERE code = ? OR name = ?', code, name)) fail('DUPLICATE', 'Department already exists.', 409);
  const id = insert('INSERT INTO departments (code, name) VALUES (?, ?)', code, name);
  audit(req.user.id, 'DEPARTMENT_CREATED', 'department', id, { code, name }, req.ip);
  res.status(201).json({ id });
});

r.get('/admin/settings', admin, (req, res) => res.json({ settings: Object.fromEntries(all('SELECT key, value FROM settings').map(s => [s.key, s.value])) }));

r.put('/admin/settings', admin, (req, res) => {
  const t = Number(req.body.plagiarism_threshold);
  if (!(t > 0 && t <= 100)) fail('INVALID_INPUT', 'Threshold must be between 1 and 100.', 422, { fields: { plagiarism_threshold: '1–100' } });
  const domain = String(req.body.institutional_domain || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail('INVALID_INPUT', 'Enter a valid email domain.', 422, { fields: { institutional_domain: 'e.g. lnmiit.ac.in' } });
  setSetting('plagiarism_threshold', t);
  setSetting('institutional_domain', domain);
  audit(req.user.id, 'SETTINGS_CHANGED', 'settings', null, { plagiarism_threshold: t, institutional_domain: domain }, req.ip);
  res.json({ ok: true });
});

// ---- Thesis oversight --------------------------------------------------------
r.get('/admin/theses', admin, (req, res) => {
  const { status, q } = req.query;
  const where = [`t.status <> 'Draft'`]; const p = [];
  if (status) { where.push('t.status = ?'); p.push(status); }
  if (q) { where.push('(t.title LIKE ? OR a.name LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  res.json({ theses: all(`SELECT t.id, t.title, t.status, t.year, t.updated_at, a.name AS author_name, g.name AS guide_name,
      e.name AS examiner_name, t.examiner_id, d.name AS department
    FROM theses t JOIN users a ON a.id = t.author_id LEFT JOIN users g ON g.id = t.guide_id LEFT JOIN users e ON e.id = t.examiner_id
    LEFT JOIN departments d ON d.id = t.department_id WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT 200`, ...p) });
});

r.put('/admin/theses/:id/examiner', admin, (req, res) => res.json(assignExaminer(req.user, req.params.id, req.body.examiner_id, req.ip)));

// ---- Audit log (UC-018, NFR-016) --------------------------------------------
r.get('/admin/audit', admin, (req, res) => {
  const { action, user, from, to } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = ['1 = 1']; const p = [];
  if (action) { where.push('l.action = ?'); p.push(action); }
  if (user) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); p.push(`%${user}%`, `%${user}%`); }
  if (from) { where.push('date(l.created_at) >= date(?)'); p.push(from); }
  if (to) { where.push('date(l.created_at) <= date(?)'); p.push(to); }
  const base = `FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE ${where.join(' AND ')}`;
  res.json({
    total: one(`SELECT COUNT(*) AS n ${base}`, ...p).n,
    page, pageSize: 50,
    actions: all('SELECT DISTINCT action FROM audit_log ORDER BY action').map(a => a.action),
    entries: all(`SELECT l.*, u.name AS user_name, u.role AS user_role ${base} ORDER BY l.id DESC LIMIT 50 OFFSET ?`, ...p, (page - 1) * 50),
  });
});

// ---- Reports (BR-010: administrators and institute-level roles) --------------
r.get('/reports/research', requireRole('admin', 'institute'), (req, res) => res.json(researchReport(req.query)));
r.get('/reports/published.csv', requireRole('admin', 'institute', 'librarian'), (req, res) => {
  audit(req.user.id, 'REPORT_EXPORTED', 'report', null, 'published.csv', req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="thesis-vault-published.csv"');
  res.send('﻿' + publishedCsv());
});

// ---- Notifications -----------------------------------------------------------
r.get('/notifications', requireAuth, (req, res) => res.json({
  unread: unreadCount(req.user.id),
  notifications: all(`SELECT n.*, t.title AS thesis_title FROM notifications n LEFT JOIN theses t ON t.id = n.thesis_id
    WHERE n.recipient_id = ? ORDER BY n.id DESC LIMIT 100`, req.user.id),
}));
r.post('/notifications/read-all', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE recipient_id = ?', req.user.id);
  res.json({ ok: true });
});
r.post('/notifications/:id/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---- Role-aware dashboard ----------------------------------------------------
r.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user;
  const count = (sql, ...p) => one(sql, ...p).n;
  const recent = all(`SELECT h.*, t.title, a.name AS actor_name FROM thesis_history h JOIN theses t ON t.id = h.thesis_id
    LEFT JOIN users a ON a.id = h.actor_id WHERE ${{
      scholar: 't.author_id = ?', supervisor: 't.guide_id = ?', examiner: 't.examiner_id = ?',
    }[u.role] || '? IS NOT NULL'} ORDER BY h.id DESC LIMIT 8`, u.id);
  const published = count(`SELECT COUNT(*) AS n FROM theses WHERE status = 'Published'`);
  let stats;
  switch (u.role) {
    case 'scholar': stats = {
      total: count(`SELECT COUNT(*) AS n FROM theses WHERE author_id = ?`, u.id),
      inReview: count(`SELECT COUNT(*) AS n FROM theses WHERE author_id = ? AND status IN ('UnderGuideReview','UnderCommitteeReview')`, u.id),
      actionNeeded: count(`SELECT COUNT(*) AS n FROM theses WHERE author_id = ? AND status IN ('Draft','RevisionRequired')`, u.id),
      published: count(`SELECT COUNT(*) AS n FROM theses WHERE author_id = ? AND status = 'Published'`, u.id),
      guide: u.guide_id ? one('SELECT name, email FROM users WHERE id = ?', u.guide_id) : null,
    }; break;
    case 'supervisor': stats = {
      awaiting: count(`SELECT COUNT(*) AS n FROM theses WHERE guide_id = ? AND status = 'UnderGuideReview'`, u.id),
      withScholar: count(`SELECT COUNT(*) AS n FROM theses WHERE guide_id = ? AND status = 'RevisionRequired'`, u.id),
      atCommittee: count(`SELECT COUNT(*) AS n FROM theses WHERE guide_id = ? AND status = 'UnderCommitteeReview'`, u.id),
      scholars: count(`SELECT COUNT(*) AS n FROM users WHERE guide_id = ? AND status = 'active'`, u.id),
    }; break;
    case 'examiner': stats = {
      awaiting: count(`SELECT COUNT(*) AS n FROM theses WHERE examiner_id = ? AND status = 'UnderCommitteeReview'`, u.id),
      approved: count(`SELECT COUNT(*) AS n FROM approvals WHERE approver_id = ? AND level = 'Committee'`, u.id),
      published,
    }; break;
    case 'librarian': stats = {
      toCatalogue: count(`SELECT COUNT(*) AS n FROM theses WHERE status = 'Approved'`),
      toPublish: count(`SELECT COUNT(*) AS n FROM theses WHERE status = 'Catalogued'`),
      published,
      restricted: count(`SELECT COUNT(*) AS n FROM catalogue_records WHERE status = 'Published' AND visibility = 'Restricted'`),
    }; break;
    default: stats = {
      users: count(`SELECT COUNT(*) AS n FROM users WHERE status = 'active'`),
      unassignedScholars: count(`SELECT COUNT(*) AS n FROM users WHERE role = 'scholar' AND guide_id IS NULL AND status = 'active'`),
      needsExaminer: count(`SELECT COUNT(*) AS n FROM theses WHERE status = 'UnderCommitteeReview' AND examiner_id IS NULL`),
      inWorkflow: count(`SELECT COUNT(*) AS n FROM theses WHERE status IN ('UnderGuideReview','UnderCommitteeReview','RevisionRequired','Approved','Catalogued')`),
      published,
    };
  }
  res.json({ stats, recent });
});

export default r;
