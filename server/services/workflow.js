// ThesisWorkflowService (Lab 6): status transitions follow the Lab 5 Thesis state diagram exactly.
import { one, run } from '../db/database.js';
import { fail, forbidden, notFound } from '../errors.js';
import { recordAndNotify } from './history.js';

export const STATUS_LABELS = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  UnderGuideReview: 'Under Guide Review',
  RevisionRequired: 'Revision Required',
  UnderCommitteeReview: 'Under Committee Review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Catalogued: 'Catalogued',
  Published: 'Published / Archived',
};

const TRANSITIONS = {
  Draft: ['Submitted'],
  Submitted: ['UnderGuideReview'],
  UnderGuideReview: ['RevisionRequired', 'UnderCommitteeReview', 'Rejected'],
  RevisionRequired: ['UnderGuideReview'],
  UnderCommitteeReview: ['Approved', 'Rejected', 'RevisionRequired'],
  Approved: ['Catalogued'],
  Catalogued: ['Published'],
  Rejected: [],
  Published: [],
};

export function transition(thesis, toStatus, { actorId, action, note, recipients = [], message }) {
  const from = thesis.status;
  if (!TRANSITIONS[from]?.includes(toStatus)) {
    fail('INVALID_TRANSITION', `A thesis cannot move from "${STATUS_LABELS[from]}" to "${STATUS_LABELS[toStatus]}".`, 409);
  }
  run(`UPDATE theses SET status = ?, updated_at = datetime('now') WHERE id = ?`, toStatus, thesis.id);
  thesis.status = toStatus;
  return recordAndNotify({
    actorId, thesisId: thesis.id, action, fromStatus: from, toStatus, note, recipients,
    message: message || `"${thesis.title}" is now ${STATUS_LABELS[toStatus]}.`, type: 'STATUS_CHANGE',
  });
}

export function loadThesis(id) {
  const t = one('SELECT * FROM theses WHERE id = ?', Number(id));
  if (!t) throw notFound('Thesis');
  return t;
}

const STAFF_VIEW = ['admin'];
const LIBRARY_STATES = ['Approved', 'Catalogued', 'Published'];

// FR-006/BR-002/BR-006/NFR-013: who may see a thesis's working record (documents, reviews, reports).
export function canView(user, t) {
  if (!user) return false;
  if (STAFF_VIEW.includes(user.role)) return true;
  if (user.role === 'scholar') return t.author_id === user.id;
  if (user.role === 'supervisor') return t.guide_id === user.id;
  if (user.role === 'examiner') return t.examiner_id === user.id && t.status !== 'Draft';
  if (user.role === 'librarian') return LIBRARY_STATES.includes(t.status);
  return false;
}

export function assertCanView(user, t) {
  if (!canView(user, t)) throw forbidden('You are not authorised to access this thesis.');
}
