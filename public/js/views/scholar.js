import { api } from '../api.js';
import {
  html, icon, $, statusBadge, fmtDate, ago, fmtSize, empty, field, options, dropZone, bindDrop,
  showErrors, clearErrors, busy, toast, modal, confirmDialog, similarityBadge,
} from '../ui.js';
import { state, go } from '../app.js';

export const thesisTable = (theses, { compact } = {}) => html`<div class="table-wrap"><table>
  <thead><tr><th>Thesis</th>${compact ? '' : html`<th>Guide</th>`}<th>Version</th><th>Similarity</th><th>Status</th><th>Updated</th></tr></thead>
  <tbody>${theses.map(t => {
    const href = t.status === 'Draft' ? `#/submit/${t.id}` : `#/thesis/${t.id}`;
    return html`<tr class="clickable" data-href="${href}">
      <td><a class="title-link" href="${href}">${t.title}</a><div class="sub">#${t.id} · ${t.degree} · ${t.department || 'No department'}${t.year ? ` · ${t.year}` : ''}</div></td>
      ${compact ? '' : html`<td>${t.guide_name || html`<span class="muted">Not assigned</span>`}</td>`}
      <td>${t.current_version ? `v${t.current_version}` : '—'}</td>
      <td>${similarityBadge(t.similarity, state.meta.threshold)}</td>
      <td>${statusBadge(t.status)}</td><td>${ago(t.updated_at)}</td></tr>`;
  })}</tbody></table></div>`;

const linkRows = root => root.querySelectorAll('tr[data-href]').forEach(tr =>
  tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));

export async function myTheses(main) {
  const { theses } = await api.get('/theses/mine');
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>My Theses</h1><p>Drafts, submissions under review and published work.</p></div>
      <a class="btn primary" href="#/submit">${icon('plus')} New submission</a></div>
    <div class="card">${theses.length ? thesisTable(theses) : empty('No theses yet', 'Create a draft or submit your thesis to begin.', html`<a class="btn primary" href="#/submit">Submit thesis</a>`)}</div>`);
  linkRows(main);
}

const matchList = d => d?.matches?.length ? html`<div style="margin-top:8px"><b>Closest matches:</b><ul style="margin:6px 0 0 18px;padding:0">
  ${d.matches.map(m => html`<li>${m.title}${m.author ? ` — ${m.author}` : ''} (${m.percent}%)</li>`)}</ul></div>` : '';

// UC-003 Submit Thesis — wireframe Figure 1.
export async function submitForm(main, { id }) {
  const { departments, degrees, threshold } = state.meta;
  const u = state.user;
  const t = id ? (await api.get(`/theses/${id}`)).thesis : null;
  if (t && t.status !== 'Draft') return go(`/thesis/${t.id}`);
  const v = t || { department: { id: u.department_id }, degree: 'PhD', year: new Date().getFullYear() };
  const savedFile = t?.currentVersion;

  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/theses">My Theses</a> / ${t ? 'Edit draft' : 'New submission'}</div>
    <div class="page-head"><div><h1>${t ? 'Continue draft' : 'Submit Thesis'}</h1><p>UC-003 · Provide the required metadata and your thesis PDF. Fields marked * are mandatory.</p></div></div>
    ${!u.guide_id ? html`<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<div><b>No Supervisor/Guide assigned.</b> You can save a draft, but the system will not accept a submission until the administrator assigns your guide.</div></div>` : ''}
    <form class="card" novalidate>
      <div style="padding:16px 20px 0"><div data-form-error hidden></div></div>
      <section class="form-section"><div class="sect-label"><h3>Thesis details</h3><p>Title, author, department and year.</p></div><div>
        ${field('title', 'Title', html`<input id="f-title" name="title" value="${v.title || ''}" maxlength="300">`, { required: true })}
        <div class="fields-2">
          ${field('author', 'Author', html`<input id="f-author" value="${u.name}" readonly>`, { help: 'Taken from your account.' })}
          ${field('department_id', 'Department', html`<select id="f-department_id" name="department_id">${options(departments, v.department?.id, { blank: 'Select department…' })}</select>`, { required: true })}
        </div>
        <div class="fields-2">
          ${field('degree', 'Degree', html`<select id="f-degree" name="degree">${options(degrees, v.degree)}</select>`, { required: true })}
          ${field('year', 'Year', html`<input id="f-year" name="year" type="number" min="1990" max="${new Date().getFullYear() + 1}" value="${v.year || ''}">`, { required: true })}
        </div>
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Thesis metadata</h3><p>Used for cataloguing and search.</p></div><div>
        ${field('keywords', 'Keywords', html`<input id="f-keywords" name="keywords" value="${v.keywords || ''}" placeholder="e.g. federated learning, edge computing, privacy">`, { required: true, help: 'Separate keywords with commas (1–12).' })}
        ${field('abstract', 'Abstract', html`<textarea id="f-abstract" name="abstract" rows="7">${v.abstract || ''}</textarea>`, { required: true, help: 'At least 50 characters.' })}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Thesis document</h3><p>PDF only. Each upload is kept as a version.</p></div><div>
        ${savedFile ? html`<div class="alert info" style="margin-bottom:12px">${icon('file')}<div>Draft document on file: <b>${savedFile.file_name}</b> (v${savedFile.version_number}, ${fmtSize(savedFile.file_size)}). Upload a new file only if you want to replace it with a newer version.</div></div>` : ''}
        <div class="field" data-field="file">${dropZone()}<div class="err"></div></div>
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Submission status</h3><p>Before review, the document is checked for similarity against the repository.</p></div><div>
        <div class="row" style="margin-bottom:12px">${statusBadge(t ? 'Draft' : 'Draft')} <span class="muted small">→ Submitted → Under Guide Review</span></div>
        <div class="alert info" style="margin-bottom:12px">${icon('shield')}<div>Submissions with a similarity score of <b>${threshold}%</b> or more are flagged and withheld from guide review (BR-003).</div></div>
        <div class="field" data-field="declaration"><label class="check"><input type="checkbox" name="declaration" value="true">
          <span>I declare that this thesis is my original work, that all sources are properly acknowledged, and that it has not been submitted for any other degree.</span></label><div class="err"></div></div>
      </div></section>
      <div class="form-actions">
        ${t ? html`<button type="button" class="btn danger" data-delete style="margin-right:auto">Delete draft</button>` : ''}
        <button type="button" class="btn" data-draft>Save draft</button>
        <button type="submit" class="btn primary">${icon('upload')} Submit thesis</button>
      </div>
    </form>`);

  const form = $('form', main);
  bindDrop(form);
  const payload = () => {
    const fd = new FormData(form);
    if (!form.file.files[0]) fd.delete('file');
    if (t) fd.set('thesisId', t.id);
    return fd;
  };

  $('[data-draft]', form).addEventListener('click', async e => {
    clearErrors(form);
    try {
      const res = await busy(e.currentTarget, () => t ? api.put(`/theses/${t.id}/draft`, payload()) : api.post('/theses/draft', payload()));
      toast('Draft saved.', 'ok');
      if (!t) go(`/submit/${res.thesisId}`); else go(`/submit/${t.id}`);
    } catch (err) { showErrors(form, err); }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    if (!await confirmDialog('Delete draft?', 'This removes the draft and its metadata. This cannot be undone.', { confirmText: 'Delete', danger: true })) return;
    try { await api.del(`/theses/${t.id}`); toast('Draft deleted.'); go('/theses'); } catch (err) { toast(err.message, 'bad'); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors(form);
    try {
      const res = await busy($('button[type=submit]', form), () => api.post('/theses/submit', payload()));
      modal('Thesis submitted', html`
        <div class="alert ok">${icon('check')}<div><b>Your thesis was submitted successfully.</b></div></div>
        <dl class="kv" style="margin-top:16px"><dt>Thesis ID</dt><dd class="mono">#${res.thesisId}</dd>
          <dt>Version</dt><dd>v1</dd><dt>Similarity</dt><dd>${res.similarityScore}% (passed)</dd>
          <dt>Status</dt><dd>${statusBadge(res.status)}</dd><dt>Routed to</dt><dd>${res.guide}</dd></dl>
        <p class="muted small" style="margin-top:14px">Your guide has been notified. You will receive a notification whenever the status changes.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>View submission</button></div>`,
      { onClose: () => go(`/thesis/${res.thesisId}`) });
    } catch (err) {
      if (err.code === 'PLAGIARISM_THRESHOLD_EXCEEDED') {
        const box = form.querySelector('[data-form-error]');
        box.hidden = false;
        box.innerHTML = String(html`<div class="alert bad">${icon('alert')}<div><b>Similarity check failed.</b> ${err.message}${matchList(err.details)}</div></div>`);
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        showErrors(form, err);
      }
    }
  });
}

// UC-004 Upload Revised Version — wireframe Figure 3.
export async function reviseForm(main, { id }) {
  const { thesis: t } = await api.get(`/theses/${id}`);
  if (!t.can?.revise) return go(`/thesis/${id}`);
  const open = t.revisionRequests.find(r => r.status === 'Open') || t.revisionRequests[0];
  const review = t.reviews.find(r => r.outcome === 'RevisionRequested');
  const nextVersion = (t.versions[0]?.version_number || 0) + 1;
  const draftKey = `tv-revision-notes-${t.id}`;
  let savedNotes = '';
  try { savedNotes = localStorage.getItem(draftKey) || ''; } catch { /* storage unavailable */ }

  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/theses">My Theses</a> / <a href="#/thesis/${t.id}">${t.title}</a> / Revise</div>
    <div class="page-head"><div><h1>Upload Revised Thesis</h1><p>UC-004 · Address the requested changes and upload the corrected PDF. Earlier versions stay in the history.</p></div></div>
    <form class="card" novalidate>
      <div style="padding:16px 20px 0"><div data-form-error hidden></div></div>
      <section class="form-section"><div class="sect-label"><h3>Original submission</h3></div><div>
        <dl class="kv"><dt>Title</dt><dd>${t.title}</dd><dt>Submission ID</dt><dd class="mono">#${t.id}</dd>
          <dt>Submitted</dt><dd>${fmtDate(t.submission_date)}</dd><dt>Current status</dt><dd>${statusBadge(t.status)}</dd></dl>
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Reviewer feedback</h3><p>${open ? `From ${open.requested_by_name}, ${fmtDate(open.request_date)}` : ''}</p></div><div>
        ${open ? html`<div class="quote"><b>Required changes:</b> ${open.reason}</div>` : html`<p class="muted">No feedback recorded.</p>`}
        ${review?.comments ? html`<p style="margin-top:10px"><b>Review comments:</b> ${review.comments}</p>` : ''}
        ${t.annotations.filter(a => a.version_number === t.currentVersion?.version_number).length ? html`<p style="margin-top:10px"><b>Annotations:</b></p>
          <ul style="margin:4px 0 0 18px;padding:0">${t.annotations.filter(a => a.version_number === t.currentVersion?.version_number).map(a => html`<li>${a.page ? `p. ${a.page}: ` : ''}${a.note}</li>`)}</ul>` : ''}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Revision details</h3></div><div>
        ${field('notes', 'Describe the changes made in this revision', html`<textarea id="f-notes" name="notes" rows="5" placeholder="e.g. Added STGCN and Graph WaveNet baselines in Chapter 5; reported MAE at 15/30/60 minutes…">${savedNotes}</textarea>`, { required: true })}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Revised thesis file</h3></div><div>
        <div class="field" data-field="file">${dropZone('Upload revised thesis PDF · PDF only · Maximum 50 MB')}<div class="err"></div></div>
        ${field('version', 'Version number', html`<input id="f-version" value="v${nextVersion} (auto-generated)" readonly>`)}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Declaration</h3></div><div>
        <div class="field" data-field="declaration"><label class="check"><input type="checkbox" name="declaration" value="true">
          <span>I confirm that I have addressed all the required changes and the revised thesis is my original work.</span></label><div class="err"></div></div>
      </div></section>
      <div class="form-actions">
        <a class="btn" href="#/thesis/${t.id}?tab=versions" style="margin-right:auto">${icon('history')} View revision history</a>
        <button type="button" class="btn" data-draft>Save as draft</button>
        <button type="submit" class="btn primary">${icon('upload')} Submit revised thesis</button>
      </div>
    </form>`);

  const form = $('form', main);
  bindDrop(form);
  $('[data-draft]', form).addEventListener('click', () => {
    try { localStorage.setItem(draftKey, form.notes.value); toast('Revision notes saved on this device.', 'ok'); }
    catch { toast('Could not save on this device.', 'bad'); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors(form);
    const fd = new FormData(form);
    if (!form.file.files[0]) {
      return showErrors(form, { message: 'Please attach the revised thesis PDF.', fields: { file: 'Revised PDF is required.' } });
    }
    try {
      const res = await busy($('button[type=submit]', form), () => api.post(`/theses/${t.id}/revisions`, fd));
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast(`Version ${res.versionNumber} submitted and sent to your guide for review.`, 'ok');
      go(`/thesis/${t.id}`);
    } catch (err) {
      if (err.code === 'PLAGIARISM_THRESHOLD_EXCEEDED') {
        const box = form.querySelector('[data-form-error]');
        box.hidden = false;
        box.innerHTML = String(html`<div class="alert bad">${icon('alert')}<div><b>Similarity check failed.</b> ${err.message}${matchList(err.details)}</div></div>`);
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else showErrors(form, err);
    }
  });
}
