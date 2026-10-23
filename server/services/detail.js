// Assembles the full record of a thesis for the detail page, filtered by what the viewer may see.
import { one, all } from '../db/database.js';
import { loadThesis, canView, STATUS_LABELS } from './workflow.js';
import { checksFor } from './plagiarism.js';
import { thesisHistory } from './history.js';
import { canDownloadPublished } from './search.js';
import { draftReview } from './review.js';
import { forbidden } from '../errors.js';

const person = id => id ? one(`SELECT u.id, u.name, u.email, u.role, u.specialization, d.name AS department
  FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, id) : null;

export function thesisDetail(user, id) {
  const t = loadThesis(id);
  const record = one('SELECT * FROM catalogue_records WHERE thesis_id = ?', t.id);
  const fullAccess = canView(user, t);

  // UC-016: anyone may view the public catalogue entry of a published thesis.
  if (!fullAccess) {
    if (t.status !== 'Published' || (!user && record.visibility !== 'Public')) {
      throw forbidden('You are not authorised to access this thesis.');
    }
  }

  const base = {
    id: t.id, title: t.title, abstract: t.abstract, keywords: t.keywords, degree: t.degree, year: t.year,
    status: t.status, statusLabel: STATUS_LABELS[t.status], submission_date: t.submission_date, updated_at: t.updated_at,
    department: one('SELECT id, name FROM departments WHERE id = ?', t.department_id),
    author: person(t.author_id), guide: person(t.guide_id), examiner: person(t.examiner_id),
    catalogue: record,
    fullAccess,
  };
  const currentVersion = t.current_version_id ? one(
    'SELECT id, version_number, file_name, file_size, page_count, upload_date FROM thesis_versions WHERE id = ?', t.current_version_id) : null;
  if (!fullAccess) {
    return { ...base, author: base.author && { name: base.author.name, department: base.author.department }, guide: base.guide && { name: base.guide.name },
      examiner: null, currentVersion, canDownload: canDownloadPublished(user, t, record.visibility) };
  }

  const versions = all(`SELECT v.id, v.version_number, v.file_name, v.file_size, v.page_count, v.revision_notes, v.upload_date, u.name AS uploaded_by
    FROM thesis_versions v JOIN users u ON u.id = v.uploaded_by WHERE v.thesis_id = ? ORDER BY v.version_number DESC`, t.id);
  const reviews = all(`SELECT r.id, r.version_id, r.stage, r.comments, r.feedback_to_student, r.outcome, r.review_date, u.name AS reviewer_name, v.version_number
    FROM reviews r JOIN users u ON u.id = r.reviewer_id JOIN thesis_versions v ON v.id = r.version_id
    WHERE r.thesis_id = ? AND r.is_submitted = 1 ORDER BY r.id DESC`, t.id);
  const annotations = all(`SELECT a.id, a.version_id, a.page, a.note, a.created_at, a.reviewer_id, u.name AS reviewer_name, v.version_number
    FROM annotations a JOIN users u ON u.id = a.reviewer_id JOIN thesis_versions v ON v.id = a.version_id
    WHERE v.thesis_id = ? ORDER BY v.version_number DESC, a.page, a.id`, t.id);
  const revisionRequests = all(`SELECT rr.*, u.name AS requested_by_name, v.version_number AS resolved_version
    FROM revision_requests rr JOIN users u ON u.id = rr.requested_by LEFT JOIN thesis_versions v ON v.id = rr.resolved_version_id
    WHERE rr.thesis_id = ? ORDER BY rr.id DESC`, t.id);
  const approvals = all(`SELECT ap.level, ap.approval_date, ap.comments, u.name AS approver_name, v.version_number
    FROM approvals ap JOIN users u ON u.id = ap.approver_id JOIN thesis_versions v ON v.id = ap.version_id
    WHERE ap.thesis_id = ? ORDER BY ap.id`, t.id);

  const isReviewer = (user.role === 'supervisor' && t.status === 'UnderGuideReview') || (user.role === 'examiner' && t.status === 'UnderCommitteeReview');
  return {
    ...base, currentVersion, versions, reviews, annotations, revisionRequests, approvals,
    plagiarismChecks: checksFor(t.id),
    history: thesisHistory(t.id),
    myDraftReview: isReviewer ? draftReview(user, t) : null,
    canDownload: true,
    can: {
      editDraft: user.id === t.author_id && t.status === 'Draft',
      revise: user.id === t.author_id && t.status === 'RevisionRequired',
      review: isReviewer,
      catalogue: ['librarian', 'admin'].includes(user.role) && ['Approved', 'Catalogued'].includes(t.status),
      assignExaminer: user.role === 'admin' && ['UnderGuideReview', 'UnderCommitteeReview', 'RevisionRequired'].includes(t.status),
    },
  };
}
