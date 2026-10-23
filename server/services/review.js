// Review & Approval Service (Lab 7 §4.2): IReviewService.getAssignedThesis / recordReview, IApprovalWorkflow.recordApproval
import { one, all, run, insert, tx } from '../db/database.js';
import { fail, forbidden } from '../errors.js';
import { audit, notify, recordAndNotify } from './history.js';
import { loadThesis, transition } from './workflow.js';

const OUTCOMES = ['Approved', 'RevisionRequested', 'Rejected'];

// Stage is derived from the thesis status; the reviewer must be the one officially assigned to it (BR-002).
export function reviewContext(user, thesisId) {
  const t = loadThesis(thesisId);
  let stage = null;
  if (user.role === 'supervisor') {
    if (t.guide_id !== user.id) fail('NOT_ASSIGNED', 'You are not the assigned Supervisor/Guide for this thesis.', 403);
    if (t.status === 'UnderGuideReview') stage = 'Guide';
  } else if (user.role === 'examiner') {
    if (t.examiner_id !== user.id) fail('NOT_ASSIGNED', 'You are not the assigned Examiner/Committee member for this thesis.', 403);
    if (t.status === 'UnderCommitteeReview') stage = 'Committee';
  } else {
    throw forbidden('Only assigned guides and examiners can review theses.');
  }
  return { thesis: t, stage };
}

export function reviewQueue(user) {
  const col = user.role === 'supervisor' ? 'guide_id' : 'examiner_id';
  const active = user.role === 'supervisor' ? 'UnderGuideReview' : 'UnderCommitteeReview';
  return all(`
    SELECT t.id, t.title, t.status, t.year, t.degree, t.submission_date, t.updated_at, d.name AS department,
           a.name AS author_name, a.roll_number, v.version_number AS current_version,
           (SELECT similarity_score FROM plagiarism_checks p WHERE p.version_id = t.current_version_id ORDER BY p.id DESC LIMIT 1) AS similarity,
           (t.status = ?) AS awaiting_me
      FROM theses t
      JOIN users a ON a.id = t.author_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN thesis_versions v ON v.id = t.current_version_id
     WHERE t.${col} = ? AND t.status <> 'Draft'
     ORDER BY awaiting_me DESC, t.updated_at DESC`, active, user.id);
}

// Saves the reviewer's in-progress comments without making a decision ("Save Review" in the wireframe).
export function saveReview(user, thesisId, { comments, feedback }, ip) {
  const { thesis: t, stage } = reviewContext(user, thesisId);
  if (!stage) fail('NOT_REVIEWABLE', 'This thesis is not currently awaiting your review.', 409);
  const existing = one(`SELECT id FROM reviews WHERE thesis_id = ? AND version_id = ? AND reviewer_id = ? AND stage = ? AND is_submitted = 0`,
    t.id, t.current_version_id, user.id, stage);
  const reviewId = existing
    ? (run(`UPDATE reviews SET comments = ?, feedback_to_student = ?, review_date = datetime('now') WHERE id = ?`, comments || '', feedback || '', existing.id), existing.id)
    : insert(`INSERT INTO reviews (thesis_id, version_id, reviewer_id, stage, comments, feedback_to_student) VALUES (?, ?, ?, ?, ?, ?)`,
      t.id, t.current_version_id, user.id, stage, comments || '', feedback || '');
  audit(user.id, 'REVIEW_SAVED', 'thesis', t.id, { reviewId, stage }, ip);
  return { reviewId, status: t.status };
}

export const draftReview = (user, t) => one(
  `SELECT * FROM reviews WHERE thesis_id = ? AND version_id = ? AND reviewer_id = ? AND is_submitted = 0`,
  t.id, t.current_version_id, user.id);

// Picks the active examiner in the thesis's department with the lightest committee load.
function autoAssignExaminer(t) {
  const pick = one(`
    SELECT u.id, u.name FROM users u
     WHERE u.role = 'examiner' AND u.status = 'active'
     ORDER BY (u.department_id = ?) DESC,
              (SELECT COUNT(*) FROM theses x WHERE x.examiner_id = u.id AND x.status = 'UnderCommitteeReview') ASC,
              u.id ASC
     LIMIT 1`, t.department_id);
  if (pick) run('UPDATE theses SET examiner_id = ? WHERE id = ?', pick.id, t.id);
  return pick;
}

// IReviewService.recordReview / IApprovalWorkflow.recordApproval — pseudocode steps 1–7.
export function recordReview(user, thesisId, { outcome, comments, feedback }, ip) {
  const { thesis: t, stage } = reviewContext(user, thesisId);                                   // step 1
  if (!stage) fail('NOT_REVIEWABLE', 'This thesis is not currently awaiting your review.', 409);
  if (!OUTCOMES.includes(outcome)) fail('INVALID_RECOMMENDATION', 'Choose Recommend for Approval, Request Revision or Reject.', 422);
  comments = (comments || '').trim(); feedback = (feedback || '').trim();
  if (!comments) fail('COMMENTS_REQUIRED', 'Review comments are required.', 422, { fields: { comments: 'Review comments are required.' } });
  if (outcome === 'RevisionRequested' && !feedback) {                                           // step 3
    fail('COMMENTS_REQUIRED', 'Describe the changes the scholar must make.', 422, { fields: { feedback: 'Required changes must be described.' } });
  }
  const versionId = t.current_version_id;                                                      // step 2
  const check = one('SELECT status FROM plagiarism_checks WHERE version_id = ? ORDER BY id DESC LIMIT 1', versionId);
  if (outcome === 'Approved' && check?.status !== 'Passed') {
    fail('APPROVAL_INCOMPLETE', 'This version has not passed the similarity check, so it cannot be approved (BR-003).', 409);
  }
  if (outcome === 'Approved' && one('SELECT 1 FROM approvals WHERE thesis_id = ? AND version_id = ? AND level = ?', t.id, versionId, stage)) {
    fail('ALREADY_DECIDED', 'An approval has already been recorded at this level.', 409);  // step 5
  }

  return tx(() => {
    const draft = draftReview(user, t);
    const reviewId = draft
      ? (run(`UPDATE reviews SET comments = ?, feedback_to_student = ?, outcome = ?, is_submitted = 1, review_date = datetime('now') WHERE id = ?`,
          comments, feedback, outcome, draft.id), draft.id)
      : insert(`INSERT INTO reviews (thesis_id, version_id, reviewer_id, stage, comments, feedback_to_student, outcome, is_submitted)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, t.id, versionId, user.id, stage, comments, feedback, outcome);
    const who = stage === 'Guide' ? 'Supervisor/Guide' : 'Examiner/Committee';
    let approvalId = null;

    if (outcome === 'RevisionRequested') {                                                     // step 4
      insert('INSERT INTO revision_requests (thesis_id, review_id, requested_by, reason) VALUES (?, ?, ?, ?)', t.id, reviewId, user.id, feedback);
      transition(t, 'RevisionRequired', {
        actorId: user.id, action: `${who} requested revision`, note: feedback,
        recipients: [t.author_id, stage === 'Committee' ? t.guide_id : null],
        message: `Revision requested on "${t.title}" by ${user.name}: ${feedback.slice(0, 160)}`,
      });
    } else if (outcome === 'Rejected') {
      transition(t, 'Rejected', {
        actorId: user.id, action: `${who} rejected thesis`, note: comments,
        recipients: [t.author_id, t.guide_id], message: `"${t.title}" was not approved at the ${stage.toLowerCase()} stage.`,
      });
    } else {                                                                                    // step 6
      approvalId = insert('INSERT INTO approvals (thesis_id, version_id, approver_id, level, comments) VALUES (?, ?, ?, ?, ?)',
        t.id, versionId, user.id, stage, comments);
      if (stage === 'Guide') {
        const examiner = t.examiner_id ? one('SELECT id, name FROM users WHERE id = ?', t.examiner_id) : autoAssignExaminer(t);
        transition(t, 'UnderCommitteeReview', {
          actorId: user.id, action: 'Guide approved; moved to committee review',
          note: examiner ? `Assigned examiner: ${examiner.name}` : 'Awaiting examiner assignment',
          recipients: [t.author_id],
          message: `Your guide approved "${t.title}". It has moved to committee/examiner review.`,
        });
        if (examiner) notify(examiner.id, 'ASSIGNMENT', `"${t.title}" has been assigned to you for committee evaluation.`, t.id);
        else for (const a of all(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)) {
          notify(a.id, 'ACTION_REQUIRED', `"${t.title}" needs an examiner assigned for committee review.`, t.id);
        }
      } else {
        transition(t, 'Approved', {
          actorId: user.id, action: 'Committee approved thesis', note: comments,
          recipients: [t.author_id, t.guide_id, ...all(`SELECT id FROM users WHERE role = 'librarian' AND status = 'active'`).map(u => u.id)],
          message: `"${t.title}" has received committee approval and is ready for cataloguing.`,
        });
      }
    }
    audit(user.id, `REVIEW_${outcome.toUpperCase()}`, 'thesis', t.id, { reviewId, approvalId, stage, versionId }, ip); // step 7
    return { reviewId, approvalId, status: t.status };
  });
}

// FR-019: page-anchored annotations on the specific version being reviewed.
export function addAnnotation(user, thesisId, { page, note }, ip) {
  const { thesis: t, stage } = reviewContext(user, thesisId);
  if (!stage) fail('NOT_REVIEWABLE', 'Annotations can only be added while the thesis is awaiting your review.', 409);
  if (!note?.trim()) fail('COMMENTS_REQUIRED', 'Annotation text is required.', 422);
  const pg = page ? Number(page) : null;
  if (pg !== null && (!Number.isInteger(pg) || pg < 1)) fail('INVALID_INPUT', 'Page must be a positive whole number.', 422);
  const id = insert('INSERT INTO annotations (version_id, reviewer_id, page, note) VALUES (?, ?, ?, ?)', t.current_version_id, user.id, pg, note.trim());
  audit(user.id, 'ANNOTATION_ADDED', 'thesis', t.id, { annotationId: id }, ip);
  return { annotationId: id };
}

export function deleteAnnotation(user, annotationId, ip) {
  const a = one('SELECT a.*, v.thesis_id FROM annotations a JOIN thesis_versions v ON v.id = a.version_id WHERE a.id = ?', Number(annotationId));
  if (!a || a.reviewer_id !== user.id) throw forbidden('You can only remove your own annotations.');
  const t = loadThesis(a.thesis_id);
  if (a.version_id !== t.current_version_id || !['UnderGuideReview', 'UnderCommitteeReview'].includes(t.status)) {
    fail('NOT_EDITABLE', 'Annotations on submitted reviews are part of the record and cannot be removed.', 409);
  }
  run('DELETE FROM annotations WHERE id = ?', a.id);
  audit(user.id, 'ANNOTATION_REMOVED', 'thesis', t.id, { annotationId: a.id }, ip);
}

// Admin action: assign or change the examiner for committee review.
export function assignExaminer(admin, thesisId, examinerId, ip) {
  const t = loadThesis(thesisId);
  const ex = one(`SELECT id, name FROM users WHERE id = ? AND role = 'examiner' AND status = 'active'`, Number(examinerId));
  if (!ex) fail('INVALID_INPUT', 'Select an active examiner.', 422);
  if (['Approved', 'Rejected', 'Catalogued', 'Published'].includes(t.status)) {
    fail('NOT_EDITABLE', 'The committee stage for this thesis is already complete.', 409);
  }
  tx(() => {
    run('UPDATE theses SET examiner_id = ? WHERE id = ?', ex.id, t.id);
    recordAndNotify({ actorId: admin.id, thesisId: t.id, action: 'Examiner assigned', note: ex.name, recipients: [ex.id],
      message: `"${t.title}" has been assigned to you for committee evaluation.`, type: 'ASSIGNMENT' });
    audit(admin.id, 'EXAMINER_ASSIGNED', 'thesis', t.id, { examinerId: ex.id }, ip);
  });
  return { examiner: ex };
}
