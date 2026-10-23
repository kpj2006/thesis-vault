// Cataloguing Service (Lab 7 §4.3): ICatalogueService.completeCataloguing, ICataloguing.publishToRepository
import { one, all, run, insert, tx, getSetting } from '../db/database.js';
import { config } from '../config.js';
import { fail, forbidden } from '../errors.js';
import { audit, recordAndNotify } from './history.js';
import { loadThesis, transition } from './workflow.js';
import { readMetadata, validateMetadata } from './submission.js';

const VISIBILITY = ['Public', 'Restricted'];

const assertLibrarian = user => {
  if (!['librarian', 'admin'].includes(user.role)) throw forbidden('Only librarians can catalogue theses.');
};

export function catalogueQueue() {
  return all(`
    SELECT t.id, t.title, t.status, t.year, t.degree, d.name AS department, a.name AS author_name, g.name AS guide_name,
           c.accession_no, c.status AS catalogue_status, c.visibility, c.doi, c.published_date,
           (SELECT approval_date FROM approvals ap WHERE ap.thesis_id = t.id AND ap.level = 'Committee' ORDER BY ap.id DESC LIMIT 1) AS approval_date
      FROM theses t
      JOIN users a ON a.id = t.author_id
      LEFT JOIN users g ON g.id = t.guide_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN catalogue_records c ON c.thesis_id = t.id
     WHERE t.status IN ('Approved', 'Catalogued', 'Published')
     ORDER BY CASE t.status WHEN 'Approved' THEN 0 WHEN 'Catalogued' THEN 1 ELSE 2 END, t.updated_at DESC`);
}

// BR-001: final cataloguing needs a committee approval on the current version.
const committeeApproval = t => one(
  `SELECT * FROM approvals WHERE thesis_id = ? AND version_id = ? AND level = 'Committee'`, t.id, t.current_version_id);

function ensureRecord(t) {
  let rec = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id);
  if (!rec) {
    const year = t.year || new Date().getFullYear();
    const seq = (one(`SELECT COUNT(*) AS n FROM catalogue_records WHERE accession_no LIKE ?`, `TV-${year}-%`).n || 0) + 1;
    insert('INSERT INTO catalogue_records (thesis_id, accession_no) VALUES (?, ?)', t.id, `TV-${year}-${String(seq).padStart(4, '0')}`);
    rec = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id);
  }
  return rec;
}

export function citations(t) {
  const author = one('SELECT name FROM users WHERE id = ?', t.author_id)?.name || 'Unknown';
  const dept = one('SELECT name FROM departments WHERE id = ?', t.department_id)?.name || '';
  const inst = getSetting('institute_name');
  const parts = author.trim().split(/\s+/);
  const last = parts.pop();
  const initials = parts.map(p => p[0].toUpperCase() + '.').join(' ');
  const kind = t.degree === 'PhD' ? 'Doctoral thesis' : `${t.degree} thesis`;
  const ieeeKind = t.degree === 'PhD' ? 'Ph.D. dissertation' : `${t.degree} thesis`;
  return {
    apa: `${last}${initials ? ', ' + initials : ''} (${t.year}). ${t.title} [${kind}, ${inst}]. Thesis Vault.`,
    ieee: `${initials ? initials + ' ' : ''}${last}, "${t.title}," ${ieeeKind}, ${dept ? dept + ', ' : ''}${inst}, ${t.year}.`,
  };
}

function readCatalogue(body) {
  return {
    ddc_class: (body.ddc_class || '').trim() || null,
    category: (body.category || '').trim() || null,
    research_area: (body.research_area || '').trim() || null,
    visibility: VISIBILITY.includes(body.visibility) ? body.visibility : null,
    notes: (body.notes || '').trim() || null,
  };
}

export function catalogueDetail(user, thesisId) {
  assertLibrarian(user);
  const t = loadThesis(thesisId);
  if (!['Approved', 'Catalogued', 'Published'].includes(t.status)) {
    fail('APPROVAL_INCOMPLETE', 'This thesis has not completed the required approval stages.', 409);
  }
  return { record: one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id), citations: citations(t) };
}

// "Save Metadata": librarian verifies/edits metadata and catalogue fields without completing cataloguing.
export function saveCatalogueMetadata(user, thesisId, body, ip) {
  assertLibrarian(user);
  const t = loadThesis(thesisId);
  if (t.status !== 'Approved' && t.status !== 'Catalogued') {
    if (t.status === 'Published') fail('ALREADY_CATALOGUED', 'This thesis is already published; its catalogue record is locked.', 409);
    fail('APPROVAL_INCOMPLETE', 'Cataloguing is disabled until the thesis completes all approval stages.', 409);
  }
  const m = readMetadata(body);
  validateMetadata(m);
  const c = readCatalogue(body);
  return tx(() => {
    run(`UPDATE theses SET title = ?, abstract = ?, keywords = ?, department_id = ?, degree = ?, year = ?, updated_at = datetime('now') WHERE id = ?`,
      m.title, m.abstract, m.keywords, m.department_id, m.degree, m.year, t.id);
    const rec = ensureRecord({ ...t, ...m });
    const cit = citations({ ...t, ...m });
    run(`UPDATE catalogue_records SET ddc_class = ?, category = ?, research_area = ?, visibility = COALESCE(?, visibility), notes = ?,
           citation_apa = ?, citation_ieee = ?, updated_at = datetime('now') WHERE id = ?`,
      c.ddc_class, c.category, c.research_area, c.visibility, c.notes, cit.apa, cit.ieee, rec.id);
    audit(user.id, 'CATALOGUE_METADATA_SAVED', 'thesis', t.id, { accession: rec.accession_no }, ip);
    return { catalogueId: rec.id, accessionNo: rec.accession_no, catalogueStatus: rec.status };
  });
}

// ICatalogueService.completeCataloguing — pseudocode steps 1–5.
export function completeCataloguing(user, thesisId, body, ip) {
  assertLibrarian(user);                                                                 // step 1
  const t = loadThesis(thesisId);                                                        // step 2
  if (['Catalogued', 'Published'].includes(t.status)) fail('ALREADY_CATALOGUED', 'This thesis has already been catalogued.', 409);
  if (t.status !== 'Approved' || !committeeApproval(t)) {                                // step 3
    fail('NOT_COMMITTEE_APPROVED', 'Cataloguing is disabled until committee approval is recorded.', 409);
  }
  saveCatalogueMetadata(user, thesisId, body, ip);                                       // validates metadata (METADATA_INVALID → MISSING_REQUIRED)
  const rec = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id);
  const missing = {};
  if (!rec.ddc_class) missing.ddc_class = 'DDC / subject classification is required.';
  if (!rec.category) missing.category = 'Category is required.';
  if (!rec.visibility) missing.visibility = 'Access level is required.';
  if (Object.keys(missing).length) fail('MISSING_CLASSIFICATION', 'Classification and access level are required to complete cataloguing.', 422, { fields: missing }); // step 4

  return tx(() => {                                                                      // step 5
    run(`UPDATE catalogue_records SET status = 'Catalogued', catalogued_by = ?, catalogue_date = datetime('now') WHERE id = ?`, user.id, rec.id);
    insert('INSERT INTO approvals (thesis_id, version_id, approver_id, level, comments) VALUES (?, ?, ?, ?, ?)',
      t.id, t.current_version_id, user.id, 'Librarian', 'Cataloguing completed');
    transition(t, 'Catalogued', {
      actorId: user.id, action: 'Cataloguing completed', note: `Accession ${rec.accession_no}`,
      recipients: [t.author_id], message: `"${t.title}" has been catalogued (accession ${rec.accession_no}).`,
    });
    audit(user.id, 'THESIS_CATALOGUED', 'thesis', t.id, { accession: rec.accession_no }, ip);
    return { catalogueId: rec.id, accessionNo: rec.accession_no, catalogueStatus: 'Catalogued', status: t.status };
  });
}

// ICataloguing.publishToRepository — pseudocode steps 6–7. BR-008: only after cataloguing.
export function publishToRepository(user, thesisId, ip) {
  assertLibrarian(user);
  const t = loadThesis(thesisId);
  if (t.status === 'Published') fail('ALREADY_CATALOGUED', 'This thesis is already published.', 409);
  if (t.status !== 'Catalogued') fail('CATALOGUING_INCOMPLETE', 'Complete cataloguing before publishing to the repository (BR-008).', 409);
  const rec = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id);
  const author = one('SELECT name FROM users WHERE id = ?', t.author_id).name;
  const version = one('SELECT full_text FROM thesis_versions WHERE id = ?', t.current_version_id);
  const doi = `${config.doiPrefix}.${rec.accession_no.toLowerCase()}`;

  return tx(() => {
    run(`UPDATE catalogue_records SET status = 'Published', doi = ?, published_date = datetime('now'), updated_at = datetime('now') WHERE id = ?`, doi, rec.id);
    run('DELETE FROM thesis_fts WHERE thesis_id = ?', t.id);
    run('INSERT INTO thesis_fts (title, abstract, keywords, author, body, thesis_id) VALUES (?, ?, ?, ?, ?, ?)',
      t.title, t.abstract, t.keywords, author, version?.full_text || '', t.id);
    transition(t, 'Published', {
      actorId: user.id, action: 'Published to repository', note: `DOI ${doi}; visibility ${rec.visibility}`,
      recipients: [t.author_id, t.guide_id],
      message: `"${t.title}" is now published in the Thesis Vault repository (DOI ${doi}).`,
    });
    audit(user.id, 'THESIS_PUBLISHED', 'thesis', t.id, { doi, visibility: rec.visibility }, ip);
    return { catalogueNumber: rec.accession_no, doi, status: t.status };
  });
}

// Visibility can still be changed after publication (e.g. an embargo is lifted).
export function setVisibility(user, thesisId, visibility, ip) {
  assertLibrarian(user);
  if (!VISIBILITY.includes(visibility)) fail('INVALID_INPUT', 'Visibility must be Public or Restricted.', 422);
  const rec = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', Number(thesisId));
  if (!rec) fail('NOT_FOUND', 'Catalogue record not found.', 404);
  run(`UPDATE catalogue_records SET visibility = ?, updated_at = datetime('now') WHERE id = ?`, visibility, rec.id);
  audit(user.id, 'VISIBILITY_CHANGED', 'thesis', rec.thesis_id, { visibility }, ip);
  return { visibility };
}
