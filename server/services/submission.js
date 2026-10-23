// Thesis Submission Service (Lab 7 §4.1): IThesisSubmission.submitThesis / saveDraft, IVersionManagement.uploadRevision
import { one, all, run, insert, tx } from '../db/database.js';
import { fail, forbidden } from '../errors.js';
import { audit, recordAndNotify } from './history.js';
import { validatePdf, extractText, storeFile, removeFile } from './storage.js';
import { runSimilarity, recordCheck } from './plagiarism.js';
import { loadThesis, transition, STATUS_LABELS } from './workflow.js';

export const DEGREES = ['PhD', 'M.Tech', 'M.Sc', 'MS (Research)', 'B.Tech'];

const clean = v => (typeof v === 'string' ? v.trim() : v);
const normaliseKeywords = k =>
  [...new Set(String(k || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean))].join(', ');

export function readMetadata(body) {
  return {
    title: clean(body.title) || '',
    abstract: clean(body.abstract) || '',
    keywords: normaliseKeywords(body.keywords),
    department_id: body.department_id ? Number(body.department_id) : null,
    degree: clean(body.degree) || 'PhD',
    year: body.year ? Number(body.year) : null,
  };
}

// FR-009/FR-010/BR-004: all required metadata must be present and well-formed.
export function validateMetadata(m, { partial = false } = {}) {
  const errors = {};
  const thisYear = new Date().getFullYear();
  if (!m.title) errors.title = 'Title is required.';
  else if (m.title.length < 5) errors.title = 'Title must be at least 5 characters.';
  if (!partial || m.year) {
    if (!m.year) errors.year = 'Year is required.';
    else if (!Number.isInteger(m.year) || m.year < 1990 || m.year > thisYear + 1) errors.year = `Year must be between 1990 and ${thisYear + 1}.`;
  }
  if (!partial || m.department_id) {
    if (!m.department_id || !one('SELECT 1 FROM departments WHERE id = ?', m.department_id)) errors.department_id = 'Select a valid department.';
  }
  if (!partial) {
    const kw = m.keywords ? m.keywords.split(', ') : [];
    if (kw.length === 0) errors.keywords = 'Provide at least one keyword.';
    else if (kw.length > 12) errors.keywords = 'Provide at most 12 keywords.';
    if (!m.abstract) errors.abstract = 'Abstract is required.';
    else if (m.abstract.length < 50) errors.abstract = 'Abstract must be at least 50 characters.';
  }
  if (!DEGREES.includes(m.degree)) errors.degree = 'Select a valid degree.';
  if (Object.keys(errors).length) {
    fail(partial ? 'INVALID_METADATA' : 'MISSING_REQUIRED', 'Please complete the highlighted fields.', 422, { fields: errors });
  }
}

function requireScholarWithGuide(user) {
  if (user.role !== 'scholar') throw forbidden('Only research scholars can submit theses.');
  const guide = user.guide_id && one(`SELECT id, name FROM users WHERE id = ? AND role = 'supervisor' AND status = 'active'`, user.guide_id);
  if (!guide) {
    fail('GUIDE_NOT_ASSIGNED', 'You do not have an assigned Supervisor/Guide yet. An administrator must assign one before you can submit.', 409);
  }
  return guide;
}

function ownDraft(user, thesisId) {
  const t = loadThesis(thesisId);
  if (t.author_id !== user.id) throw forbidden('You can only edit your own thesis.');
  if (t.status !== 'Draft') fail('NOT_EDITABLE', `This thesis is already ${STATUS_LABELS[t.status]} and can no longer be edited as a draft.`, 409);
  return t;
}

const nextVersionNumber = thesisId =>
  (one('SELECT MAX(version_number) AS n FROM thesis_versions WHERE thesis_id = ?', thesisId).n || 0) + 1;

// Persists a version row for a file already written to disk; caller is inside tx().
function addVersion(thesisId, versionNumber, file, relPath, extracted, userId, notes) {
  const versionId = insert(
    `INSERT INTO thesis_versions (thesis_id, version_number, file_path, file_name, file_size, full_text, page_count, revision_notes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    thesisId, versionNumber, relPath, file.originalname, file.size, extracted.text, extracted.pages, notes || null, userId,
  );
  run('UPDATE theses SET current_version_id = ? WHERE id = ?', versionId, thesisId);
  return versionId;
}

// Writes the file then runs the DB transaction; removes the file again if the transaction fails (NFR-008).
function withStoredFile(thesisIdForPath, versionNumber, file, work) {
  const relPath = file ? storeFile(thesisIdForPath, versionNumber, file.buffer) : null;
  try {
    return tx(() => work(relPath));
  } catch (err) {
    removeFile(relPath);
    throw err;
  }
}

const saveMetaColumns = (thesisId, m) => run(
  `UPDATE theses SET title = ?, abstract = ?, keywords = ?, department_id = ?, degree = ?, year = ?, updated_at = datetime('now') WHERE id = ?`,
  m.title, m.abstract, m.keywords, m.department_id, m.degree, m.year, thesisId,
);

// IThesisSubmission.saveDraft: studentId, thesisMetadata → thesisId, draftStatus
export async function saveDraft(user, { thesisId, body, file, ip }) {
  if (user.role !== 'scholar') throw forbidden('Only research scholars can create thesis drafts.');
  const m = readMetadata(body);
  validateMetadata(m, { partial: true });
  if (file) validatePdf(file);
  const extracted = file ? await extractText(file.buffer) : null;

  let id = thesisId ? ownDraft(user, thesisId).id : null;
  if (!id) {
    id = tx(() => {
      const newId = insert(
        `INSERT INTO theses (author_id, guide_id, title, abstract, keywords, department_id, degree, year, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft')`,
        user.id, user.guide_id, m.title, m.abstract, m.keywords, m.department_id, m.degree, m.year,
      );
      recordAndNotify({ actorId: user.id, thesisId: newId, action: 'Draft created', toStatus: 'Draft' });
      return newId;
    });
  }
  const vn = nextVersionNumber(id);
  withStoredFile(id, vn, file, relPath => {
    saveMetaColumns(id, m);
    if (relPath) addVersion(id, vn, file, relPath, extracted, user.id, 'Draft upload');
    audit(user.id, 'THESIS_DRAFT_SAVED', 'thesis', id, { title: m.title, file: file?.originalname }, ip);
  });
  return { thesisId: id, draftStatus: 'Draft' };
}

// IThesisSubmission.submitThesis: studentId, thesisMetadata, documentRef → thesisId, versionId, status
export async function submitThesis(user, { thesisId, body, file, ip }) {
  const guide = requireScholarWithGuide(user);                        // steps 1–2
  const m = readMetadata(body);
  validateMetadata(m);                                                // step 3 (BR-004)
  if (!['true', 'on', '1', true].includes(body.declaration)) {
    fail('MISSING_REQUIRED', 'Please confirm the declaration of originality.', 422, { fields: { declaration: 'Declaration is required.' } });
  }
  const draft = thesisId ? ownDraft(user, thesisId) : null;
  const existingVersion = draft?.current_version_id && one('SELECT * FROM thesis_versions WHERE id = ?', draft.current_version_id);
  if (file) validatePdf(file);
  else if (!existingVersion) fail('INVALID_FILE', 'Please attach the thesis document as a PDF file.', 422, { fields: { file: 'Thesis PDF is required.' } });

  const text = file ? (await extractText(file.buffer)) : { text: existingVersion.full_text, pages: existingVersion.page_count };

  // step 4 (BR-003): similarity check before anything is routed for review
  const check = await runSimilarity(text.text, { excludeThesisId: draft?.id, versionRef: `thesis-${draft?.id ?? 'new'}` });

  if (!check.passed && !draft) {
    audit(user.id, 'SUBMISSION_FLAGGED', 'thesis', null, { title: m.title, score: check.similarityScore }, ip);
    fail('PLAGIARISM_THRESHOLD_EXCEEDED',
      `Similarity score ${check.similarityScore}% is at or above the institute threshold of ${check.threshold}%. The submission was not created. Please revise your document and submit again.`,
      422, { similarityScore: check.similarityScore, threshold: check.threshold, matches: check.matches });
  }

  // From here on the thesis row exists (either a draft or created inside the transaction).
  const newThesisId = draft?.id ?? tx(() => insert(
    `INSERT INTO theses (author_id, guide_id, title, status) VALUES (?, ?, ?, 'Draft')`, user.id, guide.id, m.title));
  const vn = file ? nextVersionNumber(newThesisId) : existingVersion.version_number;

  try {
    const result = withStoredFile(newThesisId, vn, file, relPath => {
      const t = loadThesis(newThesisId);
      saveMetaColumns(t.id, m);
      run(`UPDATE theses SET guide_id = ?, declaration = 1 WHERE id = ?`, guide.id, t.id);
      const versionId = relPath ? addVersion(t.id, vn, file, relPath, text, user.id, 'Initial submission') : existingVersion.id;
      const reportId = recordCheck(t.id, versionId, check);

      if (!check.passed) {
        // Draft stays a draft; the flagged report is kept so the scholar can see what matched.
        audit(user.id, 'SUBMISSION_FLAGGED', 'thesis', t.id, { score: check.similarityScore }, ip);
        return { flagged: true, thesisId: t.id, versionId, reportId };
      }

      if (!draft) recordAndNotify({ actorId: user.id, thesisId: t.id, action: 'Draft created', toStatus: 'Draft' });
      run(`UPDATE theses SET submission_date = datetime('now') WHERE id = ?`, t.id);
      transition(t, 'Submitted', { actorId: user.id, action: 'Thesis submitted', note: `Version ${vn}; similarity ${check.similarityScore}%` });
      transition(t, 'UnderGuideReview', {                             // steps 6–7
        actorId: user.id, action: 'Validated and routed to guide', recipients: [guide.id],
        message: `New thesis submission "${m.title}" from ${user.name} is awaiting your review.`,
      });
      audit(user.id, 'THESIS_SUBMITTED', 'thesis', t.id, { versionId, similarity: check.similarityScore }, ip);
      return { thesisId: t.id, versionId, reportId, status: t.status, similarityScore: check.similarityScore, guide: guide.name };
    });
    if (result.flagged) {
      fail('PLAGIARISM_THRESHOLD_EXCEEDED',
        `Similarity score ${check.similarityScore}% is at or above the institute threshold of ${check.threshold}%. Your draft has been kept and the report attached. Please revise the document and submit again.`,
        422, { similarityScore: check.similarityScore, threshold: check.threshold, matches: check.matches, thesisId: result.thesisId });
    }
    return result;
  } catch (err) {
    // A thesis row created only for this submission must not survive a failure.
    if (!draft) tx(() => { run('DELETE FROM thesis_history WHERE thesis_id = ?', newThesisId); run(`DELETE FROM theses WHERE id = ? AND status = 'Draft' AND current_version_id IS NULL`, newThesisId); });
    throw err;
  }
}

// IVersionManagement.uploadRevision: studentId, thesisId, revisedFile, revisionComments → versionId, status
export async function uploadRevision(user, { thesisId, file, notes, declaration, ip }) {
  const t = loadThesis(thesisId);
  if (t.author_id !== user.id) throw forbidden('You can only revise your own thesis.');
  if (t.status !== 'RevisionRequired') fail('REVISION_NOT_REQUESTED', 'A revision has not been requested for this thesis.', 409);
  if (!notes?.trim()) fail('MISSING_REQUIRED', 'Describe the changes made in this revision.', 422, { fields: { notes: 'Revision details are required.' } });
  if (!['true', 'on', '1', true].includes(declaration)) {
    fail('MISSING_REQUIRED', 'Please confirm the revision declaration.', 422, { fields: { declaration: 'Declaration is required.' } });
  }
  validatePdf(file);
  const text = await extractText(file.buffer);
  const check = await runSimilarity(text.text, { excludeThesisId: t.id, versionRef: `thesis-${t.id}` });
  const vn = nextVersionNumber(t.id);

  const result = withStoredFile(t.id, vn, file, relPath => {
    const versionId = addVersion(t.id, vn, file, relPath, text, user.id, notes.trim()); // BR-005: new version, old ones untouched
    const reportId = recordCheck(t.id, versionId, check);
    audit(user.id, 'REVISION_UPLOADED', 'thesis', t.id, { versionId, version: vn, similarity: check.similarityScore }, ip);
    if (!check.passed) {
      recordAndNotify({ actorId: user.id, thesisId: t.id, action: `Version ${vn} flagged by similarity check`, note: `${check.similarityScore}%` });
      return { flagged: true, versionId, reportId };
    }
    run(`UPDATE revision_requests SET status = 'Resolved', resolved_version_id = ? WHERE thesis_id = ? AND status = 'Open'`, versionId, t.id);
    transition(t, 'UnderGuideReview', {
      actorId: user.id, action: `Revised version ${vn} submitted`, note: notes.trim(), recipients: [t.guide_id],
      message: `${user.name} uploaded revised version ${vn} of "${t.title}" for your review.`,
    });
    return { versionId, versionNumber: vn, reportId, status: t.status, similarityScore: check.similarityScore };
  });
  if (result.flagged) {
    fail('PLAGIARISM_THRESHOLD_EXCEEDED',
      `Version ${vn} was saved, but its similarity score of ${check.similarityScore}% is at or above the ${check.threshold}% threshold, so it has not been sent for review. Please upload a further revision.`,
      422, { similarityScore: check.similarityScore, threshold: check.threshold, matches: check.matches });
  }
  return result;
}

export function myTheses(user) {
  return all(`
    SELECT t.id, t.title, t.status, t.year, t.degree, t.submission_date, t.updated_at, d.name AS department,
           g.name AS guide_name, v.version_number AS current_version,
           (SELECT similarity_score FROM plagiarism_checks p WHERE p.thesis_id = t.id ORDER BY p.id DESC LIMIT 1) AS similarity
      FROM theses t
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN users g ON g.id = t.guide_id
      LEFT JOIN thesis_versions v ON v.id = t.current_version_id
     WHERE t.author_id = ? ORDER BY t.updated_at DESC`, user.id);
}

export function deleteDraft(user, thesisId, ip) {
  const t = ownDraft(user, thesisId);
  if (t.current_version_id) fail('NOT_EDITABLE', 'Drafts with uploaded documents are kept as part of the version history and cannot be deleted.', 409);
  tx(() => {
    run('DELETE FROM thesis_history WHERE thesis_id = ?', t.id);
    run('DELETE FROM theses WHERE id = ?', t.id);
    audit(user.id, 'THESIS_DRAFT_DELETED', 'thesis', t.id, { title: t.title }, ip);
  });
}
