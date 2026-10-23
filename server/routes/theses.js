// Thesis submission, versions, review and annotation endpoints (UC-003..UC-012, UC-016)
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { one } from '../db/database.js';
import { ah, fail, forbidden } from '../errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { saveDraft, submitThesis, uploadRevision, myTheses, deleteDraft } from '../services/submission.js';
import { reviewQueue, saveReview, recordReview, addAnnotation, deleteAnnotation } from '../services/review.js';
import { thesisDetail } from '../services/detail.js';
import { loadThesis, canView } from '../services/workflow.js';
import { canDownloadPublished } from '../services/search.js';
import { resolveFile } from '../services/storage.js';
import { audit } from '../services/history.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } }).single('file');

// ---- Research Scholar --------------------------------------------------------
r.get('/theses/mine', requireRole('scholar'), (req, res) => res.json({ theses: myTheses(req.user) }));

r.post('/theses/draft', requireRole('scholar'), upload, ah(async (req, res) => {
  res.status(201).json(await saveDraft(req.user, { body: req.body, file: req.file, ip: req.ip }));
}));

r.put('/theses/:id/draft', requireRole('scholar'), upload, ah(async (req, res) => {
  res.json(await saveDraft(req.user, { thesisId: req.params.id, body: req.body, file: req.file, ip: req.ip }));
}));

r.post('/theses/submit', requireRole('scholar'), upload, ah(async (req, res) => {
  res.status(201).json(await submitThesis(req.user, { thesisId: req.body.thesisId || null, body: req.body, file: req.file, ip: req.ip }));
}));

r.delete('/theses/:id', requireRole('scholar'), (req, res) => {
  deleteDraft(req.user, req.params.id, req.ip);
  res.json({ ok: true });
});

r.post('/theses/:id/revisions', requireRole('scholar'), upload, ah(async (req, res) => {
  res.status(201).json(await uploadRevision(req.user, {
    thesisId: req.params.id, file: req.file, notes: req.body.notes, declaration: req.body.declaration, ip: req.ip,
  }));
}));

// ---- Shared ------------------------------------------------------------------
// Public catalogue entries of published theses are viewable without signing in (UC-016).
r.get('/theses/:id', (req, res) => res.json({ thesis: thesisDetail(req.user, req.params.id) }));

r.get('/theses/:id/versions/:vid/file', (req, res) => {
  const t = loadThesis(req.params.id);
  const v = one('SELECT * FROM thesis_versions WHERE id = ? AND thesis_id = ?', Number(req.params.vid), t.id);
  if (!v) fail('NOT_FOUND', 'Document version not found.', 404);
  let allowed = canView(req.user, t);
  if (!allowed && t.status === 'Published' && v.id === t.current_version_id) {
    const rec = one('SELECT visibility FROM catalogue_records WHERE thesis_id = ?', t.id);
    allowed = canDownloadPublished(req.user, t, rec.visibility);
  }
  if (!allowed) throw forbidden(req.user ? 'This document is restricted.' : 'Sign in to access this document.');
  audit(req.user?.id, 'DOCUMENT_ACCESSED', 'thesis', t.id, { versionId: v.id }, req.ip);
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${v.file_name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(resolveFile(v.file_path));
});

// ---- Supervisor / Examiner review -------------------------------------------
r.get('/reviews/queue', requireRole('supervisor', 'examiner'), (req, res) => res.json({ theses: reviewQueue(req.user) }));

r.post('/theses/:id/review/save', requireRole('supervisor', 'examiner'), (req, res) => {
  res.json(saveReview(req.user, req.params.id, req.body, req.ip));
});

r.post('/theses/:id/review/decision', requireRole('supervisor', 'examiner'), (req, res) => {
  res.json(recordReview(req.user, req.params.id, req.body, req.ip));
});

r.post('/theses/:id/annotations', requireRole('supervisor', 'examiner'), (req, res) => {
  res.status(201).json(addAnnotation(req.user, req.params.id, req.body, req.ip));
});

r.delete('/annotations/:aid', requireAuth, (req, res) => {
  deleteAnnotation(req.user, req.params.aid, req.ip);
  res.json({ ok: true });
});

export default r;
