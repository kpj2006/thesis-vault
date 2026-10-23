import { api } from '../api.js';
import { html, icon, $, $$, statusBadge, fmtDate, ago, fmtSize, empty, field, showErrors, clearErrors, busy, toast, confirmDialog, similarityBadge } from '../ui.js';
import { state, go, render } from '../app.js';

export async function reviewQueue(main) {
  const { theses } = await api.get('/reviews/queue');
  const isGuide = state.user.role === 'supervisor';
  const waiting = theses.filter(t => t.awaiting_me);
  const others = theses.filter(t => !t.awaiting_me);
  const table = list => html`<div class="table-wrap"><table><thead><tr><th>Thesis</th><th>Scholar</th><th>Version</th><th>Similarity</th><th>Status</th><th>Updated</th></tr></thead><tbody>
    ${list.map(t => {
      const href = t.awaiting_me ? `#/review/${t.id}` : `#/thesis/${t.id}`;
      return html`<tr class="clickable" data-href="${href}"><td><a class="title-link" href="${href}">${t.title}</a><div class="sub">#${t.id} · ${t.department} · ${t.degree}</div></td>
      <td>${t.author_name}<div class="sub">${t.roll_number || ''}</div></td><td>v${t.current_version}</td>
      <td>${similarityBadge(t.similarity, state.meta.threshold)}</td><td>${statusBadge(t.status)}</td><td>${ago(t.updated_at)}</td></tr>`;
    })}</tbody></table></div>`;

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>${isGuide ? 'Review Queue' : 'Evaluation Queue'}</h1>
      <p>${isGuide ? 'Theses submitted by scholars officially assigned to you (BR-002).' : 'Theses assigned to you for committee evaluation.'}</p></div></div>
    <div class="card"><div class="card-head"><h2>Awaiting your decision <span class="muted">(${waiting.length})</span></h2></div>
      ${waiting.length ? table(waiting) : empty('Nothing awaiting you', 'New submissions and revisions will appear here and you will be notified.')}</div>
    <div class="card"><div class="card-head"><h2>Other assigned theses <span class="muted">(${others.length})</span></h2></div>
      ${others.length ? table(others) : html`<p class="card-body muted">None.</p>`}</div>`);
  main.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
}

// UC-006/UC-007/UC-008 (guide) and UC-011/UC-012 (committee) — wireframe Figure 2.
export async function reviewPage(main, { id }) {
  const { thesis: t } = await api.get(`/theses/${id}`);
  if (!t.can.review) {
    main.innerHTML = String(html`<div class="empty">${icon('info')}<h3>Not awaiting your review</h3><p>This thesis is currently ${statusBadge(t.status)}.</p><a class="btn" href="#/thesis/${t.id}">Open thesis record</a></div>`);
    return;
  }
  const isGuide = state.user.role === 'supervisor';
  const v = t.currentVersion;
  const chk = t.plagiarismChecks.find(c => c.version_id === v.id);
  const draft = t.myDraftReview || {};
  const fileUrl = (dl) => `/api/theses/${t.id}/versions/${v.id}/file${dl ? '?download=1' : ''}`;
  const myNotes = () => t.annotations.filter(a => a.version_id === v.id);
  const prevReviews = t.reviews.filter(r => r.version_id !== v.id || r.stage !== (isGuide ? 'Guide' : 'Committee'));

  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/reviews">${isGuide ? 'Review queue' : 'Evaluation queue'}</a> / Thesis #${t.id}</div>
    <div class="page-head"><div><div class="row" style="margin-bottom:8px">${statusBadge(t.status)}<span class="badge plain">${isGuide ? 'Guide stage' : 'Committee stage'}</span></div>
      <h1>${t.title}</h1><p>${isGuide ? 'UC-007 · Review Thesis (Supervisor/Guide)' : 'UC-011 · Evaluate Thesis (Committee/Examiner)'}</p></div></div>
    <div class="split">
      <div class="stack">
        <div class="card card-pad"><iframe class="pdf-frame" src="${fileUrl()}" title="Thesis PDF"></iframe></div>
        <div class="card"><div class="card-head"><h2>Annotations on v${v.version_number}</h2></div><div class="card-body">
          <div data-notes></div>
          <form data-annotate class="row" style="margin-top:12px;align-items:flex-start" novalidate>
            <input name="page" type="number" min="1" placeholder="Page" style="width:90px" aria-label="Page number">
            <input name="note" placeholder="Add an annotation for the scholar…" style="flex:1;min-width:200px" aria-label="Annotation">
            <button class="btn">${icon('plus')} Add</button>
          </form></div></div>
        ${prevReviews.length ? html`<div class="card card-pad"><h2 style="margin-bottom:10px">Earlier reviews</h2>${prevReviews.map(r => html`
          <div class="review-item"><b>${r.reviewer_name}</b> <span class="muted small">· ${r.stage} · v${r.version_number} · ${fmtDate(r.review_date)} · ${r.outcome}</span>
          <p style="margin:6px 0 0">${r.comments}</p>${r.feedback_to_student ? html`<div class="quote">${r.feedback_to_student}</div>` : ''}</div>`)}</div>` : ''}
      </div>

      <form class="card" data-review novalidate>
        <div class="card-head"><h2>Review &amp; decision</h2></div>
        <div class="card-body">
          <div data-form-error hidden></div>
          <dl class="kv" style="grid-template-columns:120px 1fr;margin-bottom:16px">
            <dt>Scholar</dt><dd>${t.author.name}</dd><dt>Department</dt><dd>${t.department?.name}</dd>
            <dt>Year</dt><dd>${t.year}</dd><dt>Submitted</dt><dd>${fmtDate(t.submission_date)}</dd>
            <dt>Version</dt><dd>v${v.version_number} · <a href="${fileUrl(true)}">Download PDF</a> <span class="muted small">(${fmtSize(v.file_size)})</span></dd>
            <dt>Similarity</dt><dd>${chk ? html`<span class="badge plain ${chk.status === 'Passed' ? 'b-ok' : 'b-bad'}">${chk.similarity_score}% · ${chk.status}</span> <a href="#/thesis/${t.id}?tab=similarity">View report</a>` : '—'}</dd>
            <dt>Declaration</dt><dd>${t.versions.length ? html`${icon('check')} Originality declaration accepted` : '—'}</dd>
          </dl>
          ${field('comments', 'Review comments', html`<textarea id="f-comments" name="comments" rows="5" placeholder="Enter review comments (required)">${draft.comments || ''}</textarea>`, { required: true })}
          <div class="field" data-field="outcome"><label class="req">Decision</label>
            <div class="radio-cards" style="grid-template-columns:1fr">
              <label class="radio-card"><input type="radio" name="outcome" value="Approved"><div><b>${isGuide ? 'Recommend for approval' : 'Approve thesis'}</b><span>${isGuide ? 'Moves the thesis to committee review.' : 'Meets academic rigour; moves to cataloguing.'}</span></div></label>
              <label class="radio-card r-revise"><input type="radio" name="outcome" value="RevisionRequested"><div><b>Request revision</b><span>Returns the thesis to the scholar with required changes.</span></div></label>
              <label class="radio-card r-reject"><input type="radio" name="outcome" value="Rejected"><div><b>Reject</b><span>Ends the workflow for this submission.</span></div></label>
            </div><div class="err"></div></div>
          <div data-feedback hidden>${field('feedback', 'Required changes for the scholar', html`<textarea id="f-feedback" name="feedback" rows="4" placeholder="Enter comments / required changes">${draft.feedback_to_student || ''}</textarea>`, { required: true })}</div>
        </div>
        <div class="form-actions">
          <a class="btn" href="${fileUrl()}" target="_blank" rel="noopener" style="margin-right:auto">${icon('eye')} View full thesis</a>
          <button type="button" class="btn" data-save>Save review</button>
          <button type="submit" class="btn primary">Submit decision</button>
        </div>
      </form>
    </div>`);

  const form = $('[data-review]', main);
  const renderNotes = () => {
    const notes = myNotes();
    $('[data-notes]', main).innerHTML = String(notes.length ? html`<table><tbody>${notes.map(a => html`<tr><td style="width:70px">${a.page ? `p. ${a.page}` : '—'}</td><td>${a.note}<div class="sub">${a.reviewer_name}</div></td>
      <td style="width:40px">${a.reviewer_id === state.user.id ? html`<button class="icon-btn" data-del="${a.id}" aria-label="Remove annotation">${icon('x')}</button>` : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="muted small">No annotations yet. Add page-specific notes the scholar will see with your review.</p>`);
    $$('[data-del]', main).forEach(b => b.addEventListener('click', async () => {
      try { await api.del(`/annotations/${b.dataset.del}`); t.annotations = t.annotations.filter(a => String(a.id) !== b.dataset.del); renderNotes(); }
      catch (err) { toast(err.message, 'bad'); }
    }));
  };
  renderNotes();

  $('[data-annotate]', main).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.note.value.trim()) return f.note.focus();
    try {
      const { annotationId } = await busy($('button', f), () => api.post(`/theses/${t.id}/annotations`, { page: f.page.value, note: f.note.value }));
      t.annotations.push({ id: annotationId, version_id: v.id, page: f.page.value || null, note: f.note.value.trim(), reviewer_id: state.user.id, reviewer_name: state.user.name });
      f.reset(); renderNotes();
    } catch (err) { toast(err.message, 'bad'); }
  });

  const syncFeedback = () => { $('[data-feedback]', form).hidden = form.outcome.value !== 'RevisionRequested'; };
  $$('input[name=outcome]', form).forEach(r => r.addEventListener('change', syncFeedback));

  $('[data-save]', form).addEventListener('click', async e => {
    clearErrors(form);
    try {
      await busy(e.currentTarget, () => api.post(`/theses/${t.id}/review/save`, { comments: form.comments.value, feedback: form.feedback.value }));
      toast('Review saved. You can submit your decision later.', 'ok');
    } catch (err) { showErrors(form, err); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors(form);
    const outcome = form.outcome.value;
    if (!outcome) return showErrors(form, { message: 'Choose a decision.', fields: { outcome: 'Select one option.' } });
    const label = { Approved: isGuide ? 'recommend this thesis for approval' : 'approve this thesis', RevisionRequested: 'request a revision', Rejected: 'reject this thesis' }[outcome];
    if (!await confirmDialog('Submit decision?', `You are about to ${label}. The scholar${outcome === 'Approved' ? ' and next-stage reviewers' : ''} will be notified.`, { confirmText: 'Submit decision', danger: outcome === 'Rejected' })) return;
    try {
      const res = await busy($('button[type=submit]', form), () => api.post(`/theses/${t.id}/review/decision`, { outcome, comments: form.comments.value, feedback: form.feedback.value }));
      toast(`Decision recorded. Thesis is now ${res.status.replace(/([a-z])([A-Z])/g, '$1 $2')}.`, 'ok');
      go(`/thesis/${t.id}`);
    } catch (err) {
      showErrors(form, err);
      if (err.code === 'NOT_REVIEWABLE' || err.code === 'ALREADY_DECIDED') render();
    }
  });
}
