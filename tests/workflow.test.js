// Integration tests for the core workflow, business rules and access control.
// Each run uses a fresh temporary data directory, so the demo database is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thesis-vault-test-'));
process.env.JWT_SECRET = 'test-secret';

const { app } = await import('../server/index.js');
const { db, insert, one } = await import('../server/db/database.js');
const { makePdf } = await import('../server/services/storage.js');
const bcrypt = (await import('bcryptjs')).default;

let server, base;
const ids = {};

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;

  const hash = bcrypt.hashSync('Password@123', 4);
  const dept = insert(`INSERT INTO departments (code, name) VALUES ('CSE', 'Computer Science')`);
  const add = (key, role, extra = {}) => {
    ids[key] = insert(`INSERT INTO users (name, email, password_hash, role, department_id, guide_id) VALUES (?, ?, ?, ?, ?, ?)`,
      `${key} user`, `${key}@lnmiit.ac.in`, hash, role, dept, extra.guide ?? null);
  };
  add('admin', 'admin'); add('librarian', 'librarian'); add('institute', 'institute');
  add('guide', 'supervisor'); add('otherGuide', 'supervisor'); add('examiner', 'examiner');
  add('scholar', 'scholar', { guide: ids.guide });
  add('scholar2', 'scholar', { guide: ids.guide });
  add('noGuide', 'scholar');
  ids.dept = dept;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// Minimal client with a cookie jar per user.
async function login(email) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }) });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => {
    const opts = { method, headers: { cookie } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(base + url, opts);
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data, code: data?.error?.code };
  };
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const as = key => login(`${key}@lnmiit.ac.in`);

const ABSTRACT = 'This abstract is long enough to satisfy the minimum length rule for thesis submission metadata.';
function submission(title, text, overrides = {}) {
  const fd = new FormData();
  const fields = { title, department_id: ids.dept, degree: 'PhD', year: 2026, keywords: 'alpha, beta', abstract: ABSTRACT, declaration: 'true', ...overrides };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, String(v));
  if (text !== null) fd.set('file', new Blob([makePdf(title, [text])], { type: 'application/pdf' }), 'thesis.pdf');
  return fd;
}
const uniqueText = tag => `${tag} ` + Array.from({ length: 60 }, (_, i) => `${tag}word${i}`).join(' ');

test('FR-001: registration requires an institutional email', async () => {
  const res = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Out Sider', email: 'out@gmail.com', password: 'Password123', department_id: ids.dept, roll_number: 'X1' }) });
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.ok(body.error.details.fields.email);
});

test('FR-002: wrong password is rejected', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'scholar@lnmiit.ac.in', password: 'nope' }) });
  assert.equal(res.status, 401);
});

test('NFR-003: passwords are stored as bcrypt hashes', () => {
  const u = one('SELECT password_hash FROM users WHERE id = ?', ids.scholar);
  assert.match(u.password_hash, /^\$2[aby]\$/);
});

test('BR-006/BR-007: role-based access control on admin and report endpoints', async () => {
  const scholar = await as('scholar');
  assert.equal((await scholar.get('/admin/users')).status, 403);
  assert.equal((await scholar.get('/reports/research')).status, 403);
  assert.equal((await (await as('institute')).get('/reports/research')).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 401);
});

test('UC-003 alt flow: submission is blocked until a guide is assigned', async () => {
  const r = await (await as('noGuide')).post('/theses/submit', submission('Some Valid Title', uniqueText('noguide')));
  assert.equal(r.code, 'GUIDE_NOT_ASSIGNED');
});

test('BR-004: missing metadata is rejected with field errors', async () => {
  const r = await (await as('scholar')).post('/theses/submit', submission('', uniqueText('meta'), { keywords: '', abstract: '' }));
  assert.equal(r.code, 'MISSING_REQUIRED');
  assert.ok(r.data.error.details.fields.title && r.data.error.details.fields.keywords && r.data.error.details.fields.abstract);
});

test('NFR-015: non-PDF uploads are rejected', async () => {
  const fd = submission('A Proper Thesis Title', null);
  fd.set('file', new Blob(['hello, not a pdf'], { type: 'application/pdf' }), 'fake.pdf');
  const r = await (await as('scholar')).post('/theses/submit', fd);
  assert.equal(r.code, 'INVALID_FILE');
});

test('Full lifecycle: submit → guide → committee → catalogue → publish → full-text search', async () => {
  const scholar = await as('scholar'); const guide = await as('guide'); const examiner = await as('examiner'); const lib = await as('librarian');
  const sub = await scholar.post('/theses/submit', submission('Quantum Annealing for Timetabling', uniqueText('zephyrine') + ' timetabling constraints'));
  assert.equal(sub.status, 201, JSON.stringify(sub.data));
  assert.equal(sub.data.status, 'UnderGuideReview');
  const id = sub.data.thesisId;

  // BR-002: a guide not assigned to the scholar may not review.
  assert.equal((await (await as('otherGuide')).post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'ok' })).code, 'NOT_ASSIGNED');
  // Cataloguing is impossible before approval (BR-001).
  assert.equal((await lib.post(`/catalogue/${id}/complete`, {})).code, 'NOT_COMMITTEE_APPROVED');
  // Comments are mandatory.
  assert.equal((await guide.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: '' })).code, 'COMMENTS_REQUIRED');

  const g = await guide.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'Ready for committee.' });
  assert.equal(g.data.status, 'UnderCommitteeReview');
  assert.equal((await guide.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'again' })).code, 'NOT_REVIEWABLE');
  assert.equal(one('SELECT examiner_id FROM theses WHERE id = ?', id).examiner_id, ids.examiner, 'examiner auto-assigned');

  const c = await examiner.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'Rigorous.' });
  assert.equal(c.data.status, 'Approved');

  // BR-008: cannot publish before cataloguing.
  assert.equal((await lib.post(`/catalogue/${id}/publish`)).code, 'CATALOGUING_INCOMPLETE');
  const meta = { title: 'Quantum Annealing for Timetabling', department_id: ids.dept, degree: 'PhD', year: 2026, keywords: 'alpha, beta', abstract: ABSTRACT };
  assert.equal((await lib.post(`/catalogue/${id}/complete`, meta)).code, 'MISSING_CLASSIFICATION');
  const done = await lib.post(`/catalogue/${id}/complete`, { ...meta, ddc_class: '005.1', category: 'Optimisation', visibility: 'Public' });
  assert.equal(done.data.status, 'Catalogued');
  assert.equal((await lib.post(`/catalogue/${id}/complete`, meta)).code, 'ALREADY_CATALOGUED');
  const pub = await lib.post(`/catalogue/${id}/publish`);
  assert.equal(pub.data.status, 'Published');
  assert.ok(pub.data.doi);

  const levels = db.prepare('SELECT level FROM approvals WHERE thesis_id = ? ORDER BY id').all(id).map(a => a.level);
  assert.deepEqual(levels, ['Guide', 'Committee', 'Librarian'], 'BR-001 approval order');

  // Full-text search (anonymous, public) finds a word that only appears in the PDF body.
  const s = await (await fetch(`${base}/repository/search?q=zephyrinewor`)).json();
  assert.equal(s.total, 1);
  assert.equal(s.results[0].id, id);
  assert.ok(s.results[0].snippet.includes('[['));

  // BR-009: the scholar was notified along the way.
  const n = await scholar.get('/notifications');
  assert.ok(n.data.notifications.length >= 3);
});

test('BR-005: revisions create new versions and old versions cannot be deleted', async () => {
  const scholar = await as('scholar2'); const guide = await as('guide');
  const sub = await scholar.post('/theses/submit', submission('Revision Flow Thesis Title', uniqueText('marlinova')));
  const id = sub.data.thesisId;
  assert.equal((await scholar.post(`/theses/${id}/revisions`, submission('x', uniqueText('early')))).code, 'REVISION_NOT_REQUESTED');
  assert.equal((await guide.post(`/theses/${id}/review/decision`, { outcome: 'RevisionRequested', comments: 'Needs work.' })).code, 'COMMENTS_REQUIRED');
  await guide.post(`/theses/${id}/review/decision`, { outcome: 'RevisionRequested', comments: 'Needs work.', feedback: 'Add chapter 3.' });

  const fd = new FormData();
  fd.set('notes', 'Added chapter 3'); fd.set('declaration', 'true');
  fd.set('file', new Blob([makePdf('rev', [uniqueText('marlinova') + ' chapter three added'])], { type: 'application/pdf' }), 'v2.pdf');
  const rev = await scholar.post(`/theses/${id}/revisions`, fd);
  assert.equal(rev.status, 201, JSON.stringify(rev.data));
  assert.equal(rev.data.versionNumber, 2);
  assert.equal(rev.data.status, 'UnderGuideReview');

  const versions = db.prepare('SELECT version_number FROM thesis_versions WHERE thesis_id = ? ORDER BY version_number').all(id);
  assert.deepEqual(versions.map(v => v.version_number), [1, 2]);
  assert.throws(() => db.prepare('DELETE FROM thesis_versions WHERE thesis_id = ?').run(id), /BR-005/);
  assert.throws(() => db.prepare(`UPDATE thesis_versions SET file_path = 'x' WHERE thesis_id = ?`).run(id), /BR-005/);
  assert.equal(one(`SELECT status FROM revision_requests WHERE thesis_id = ?`, id).status, 'Resolved');
});

test('BR-003: a document above the similarity threshold is not accepted', async () => {
  const copied = uniqueText('zephyrine') + ' timetabling constraints'; // same text as the published thesis above
  const before = one('SELECT COUNT(*) AS n FROM theses').n;
  const r = await (await as('scholar2')).post('/theses/submit', submission('Copied Thesis Title', copied));
  assert.equal(r.code, 'PLAGIARISM_THRESHOLD_EXCEEDED');
  assert.ok(r.data.error.details.similarityScore >= 20);
  assert.equal(one('SELECT COUNT(*) AS n FROM theses').n, before, 'no thesis row is created');
});

test('Restricted theses: metadata hidden from guests, PDF blocked for unrelated users', async () => {
  const scholar = await as('scholar'); const guide = await as('guide'); const examiner = await as('examiner'); const lib = await as('librarian');
  const id = (await scholar.post('/theses/submit', submission('Restricted Embargoed Thesis', uniqueText('quorvex')))).data.thesisId;
  await guide.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'ok' });
  await examiner.post(`/theses/${id}/review/decision`, { outcome: 'Approved', comments: 'ok' });
  await lib.post(`/catalogue/${id}/complete`, { title: 'Restricted Embargoed Thesis', department_id: ids.dept, degree: 'PhD', year: 2026, keywords: 'a', abstract: ABSTRACT, ddc_class: '1', category: 'c', visibility: 'Restricted' });
  await lib.post(`/catalogue/${id}/publish`);
  const vid = one('SELECT current_version_id AS v FROM theses WHERE id = ?', id).v;

  assert.equal((await (await fetch(`${base}/repository/search?q=quorvexword1`)).json()).total, 0, 'guests cannot find it');
  assert.equal((await (await as('scholar2')).get(`/repository/search?q=quorvexword1`)).data.total, 1, 'signed-in users can');
  assert.equal((await fetch(`${base}/theses/${id}/versions/${vid}/file`)).status, 403);
  assert.equal((await (await as('scholar2')).get(`/theses/${id}/versions/${vid}/file`)).status, 403);
  assert.equal((await scholar.get(`/theses/${id}/versions/${vid}/file`)).status, 200, 'author can read');
});

test('NFR-016: actions are audited and the audit log is append-only', async () => {
  const n = one(`SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('THESIS_SUBMITTED','THESIS_PUBLISHED','LOGIN')`).n;
  assert.ok(n > 3);
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  const admin = await as('admin');
  assert.equal((await admin.get('/admin/audit')).status, 200);
});

test('Admin can assign a guide, which unblocks submission', async () => {
  const admin = await as('admin');
  const r = await admin.put(`/admin/users/${ids.noGuide}`, { name: 'noGuide user', email: 'noGuide@lnmiit.ac.in', role: 'scholar', department_id: ids.dept, guide_id: ids.guide });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sub = await (await as('noGuide')).post('/theses/submit', submission('Now With A Guide', uniqueText('pelluxor')));
  assert.equal(sub.status, 201);
});
