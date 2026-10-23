import { api } from '../api.js';
import {
  html, icon, $, $$, statusBadge, stepper, fmtDate, fmtDateTime, fmtSize, keywordTags, empty, modal, options, toast, busy, showErrors,
} from '../ui.js';
import { state, query, render } from '../app.js';

const pages = n => n ? `${n} page${n === 1 ? '' : 's'}` : '? pages';
const fileUrl = (t, v, dl) => `/api/theses/${t.id}/versions/${v.id}/file${dl ? '?download=1' : ''}`;
const OUTCOME = { Approved: ['Approved', 'b-approved'], RevisionRequested: ['Revision requested', 'b-revision'], Rejected: ['Rejected', 'b-rejected'] };

export const citationBlock = c => c?.citation_apa ? html`
  <div class="stack">
    <div><div class="row between"><b class="small">APA</b><button class="btn small ghost" data-copy="${c.citation_apa}">Copy</button></div><p class="small" style="margin-top:4px">${c.citation_apa}</p></div>
    <div><div class="row between"><b class="small">IEEE</b><button class="btn small ghost" data-copy="${c.citation_ieee}">Copy</button></div><p class="small" style="margin-top:4px">${c.citation_ieee}</p></div>
  </div>` : html`<p class="muted small">Citations are generated during cataloguing.</p>`;

export const bindCopy = root => $$('[data-copy]', root).forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); toast('Citation copied.', 'ok'); } catch { toast('Copy failed.', 'bad'); }
}));

// UC-016 public catalogue entry.
function publicView(main, t) {
  const c = t.catalogue;
  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/repository">Repository</a> / ${c.accession_no}</div>
    <div class="split"><div class="card card-pad">
      <div class="row" style="margin-bottom:10px"><span class="badge b-published">Published</span>
        <span class="badge plain">${c.visibility === 'Public' ? icon('globe') : icon('lock')} ${c.visibility}</span></div>
      <h1>${t.title}</h1>
      <p class="muted" style="margin-top:8px">${t.author.name} · ${t.degree} · ${t.department?.name} · ${t.year}</p>
      <h3 style="margin-top:22px">Abstract</h3><p style="margin-top:6px">${t.abstract}</p>
      <h3 style="margin-top:18px">Keywords</h3><div style="margin-top:8px">${keywordTags(t.keywords)}</div>
      <div class="row" style="margin-top:22px">
        ${t.canDownload && t.currentVersion ? html`<a class="btn primary" href="${fileUrl(t, t.currentVersion)}" target="_blank" rel="noopener">${icon('eye')} Read PDF</a>
          <a class="btn" href="${fileUrl(t, t.currentVersion, true)}">${icon('download')} Download</a>`
        : html`<div class="alert warn">${icon('lock')}<div>The full text of this thesis is <b>restricted</b>. ${state.user ? 'Contact the library for access.' : html`<a href="#/login">Sign in</a> to request access.`}</div></div>`}
      </div>
    </div>
    <div class="stack">
      <div class="card card-pad"><h2>Catalogue record</h2><dl class="kv" style="margin-top:12px;grid-template-columns:110px 1fr">
        <dt>Accession</dt><dd class="mono">${c.accession_no}</dd><dt>DOI</dt><dd class="mono">${c.doi || '—'}</dd>
        <dt>DDC class</dt><dd>${c.ddc_class || '—'}</dd><dt>Category</dt><dd>${c.category || '—'}</dd>
        <dt>Supervisor</dt><dd>${t.guide?.name || '—'}</dd><dt>Published</dt><dd>${fmtDate(c.published_date)}</dd>
        ${t.currentVersion ? html`<dt>File</dt><dd>${pages(t.currentVersion.page_count)} · ${fmtSize(t.currentVersion.file_size)}</dd>` : ''}</dl></div>
      <div class="card card-pad"><h2 style="margin-bottom:12px">Cite this thesis</h2>${citationBlock(c)}</div>
    </div></div>`);
  bindCopy(main);
}

export async function thesisPage(main, { id }) {
  const { thesis: t } = await api.get(`/theses/${id}`);
  if (!t.fullAccess) return publicView(main, t);
  const threshold = state.meta.threshold;
  const latestCheck = t.plagiarismChecks[0];
  const rejectedAt = t.history.some(h => h.to_status === 'Rejected' && h.from_status === 'UnderGuideReview') ? 1 : 2;
  const openReq = t.revisionRequests.find(r => r.status === 'Open');
  const tab = query().tab || 'overview';

  const actions = html`
    ${t.can.editDraft ? html`<a class="btn primary" href="#/submit/${t.id}">${icon('edit')} Continue draft</a>` : ''}
    ${t.can.revise ? html`<a class="btn primary" href="#/thesis/${t.id}/revise">${icon('upload')} Upload revised version</a>` : ''}
    ${t.can.review ? html`<a class="btn primary" href="#/review/${t.id}">${icon('check')} ${state.user.role === 'examiner' ? 'Evaluate thesis' : 'Review thesis'}</a>` : ''}
    ${t.can.catalogue ? html`<a class="btn primary" href="#/catalogue/${t.id}">${icon('book')} Catalogue</a>` : ''}
    ${t.can.assignExaminer ? html`<button class="btn" data-assign>${icon('users')} ${t.examiner ? 'Change examiner' : 'Assign examiner'}</button>` : ''}
    ${t.status === 'Published' ? html`<a class="btn" href="#/repository">${icon('search')} In repository</a>` : ''}`;

  const tabs = [
    ['overview', 'Overview'], ['document', 'Document'], ['versions', 'Versions', t.versions.length],
    ['reviews', 'Reviews & feedback', t.reviews.length + t.annotations.length], ['similarity', 'Similarity', t.plagiarismChecks.length], ['history', 'History'],
  ];

  const panels = {
    overview: html`<div class="split"><div class="card card-pad">
        <h3>Abstract</h3><p style="margin-top:6px">${t.abstract || html`<span class="muted">Not provided yet.</span>`}</p>
        <h3 style="margin-top:18px">Keywords</h3><div style="margin-top:8px">${keywordTags(t.keywords)}</div>
        ${t.catalogue ? html`<h3 style="margin-top:18px">Catalogue</h3><dl class="kv" style="margin-top:8px">
          <dt>Accession no.</dt><dd class="mono">${t.catalogue.accession_no}</dd><dt>DOI</dt><dd class="mono">${t.catalogue.doi || '—'}</dd>
          <dt>DDC / category</dt><dd>${t.catalogue.ddc_class || '—'} · ${t.catalogue.category || '—'}</dd><dt>Visibility</dt><dd>${t.catalogue.visibility}</dd></dl>
          <div style="margin-top:14px">${citationBlock(t.catalogue)}</div>` : ''}
      </div>
      <div class="card card-pad"><h2>Details</h2><dl class="kv" style="margin-top:12px;grid-template-columns:110px 1fr">
        <dt>Thesis ID</dt><dd class="mono">#${t.id}</dd><dt>Author</dt><dd>${t.author.name}</dd>
        <dt>Department</dt><dd>${t.department?.name || '—'}</dd><dt>Degree</dt><dd>${t.degree}</dd><dt>Year</dt><dd>${t.year || '—'}</dd>
        <dt>Guide</dt><dd>${t.guide?.name || html`<span class="muted">Not assigned</span>`}</dd>
        <dt>Examiner</dt><dd>${t.examiner?.name || html`<span class="muted">${['UnderCommitteeReview'].includes(t.status) ? 'Awaiting assignment' : '—'}</span>`}</dd>
        <dt>Submitted</dt><dd>${fmtDate(t.submission_date)}</dd><dt>Similarity</dt>
        <dd>${latestCheck ? html`<span class="badge plain ${latestCheck.status === 'Passed' ? 'b-ok' : 'b-bad'}">${latestCheck.similarity_score}% · ${latestCheck.status}</span>` : '—'}</dd>
        <dt>Approvals</dt><dd>${t.approvals.length ? t.approvals.map(a => html`<div>${icon('check')} ${a.level} — ${a.approver_name}, ${fmtDate(a.approval_date)}</div>`) : '—'}</dd></dl></div></div>`,

    document: t.currentVersion ? html`<div class="card card-pad">
        <div class="row between" style="margin-bottom:12px"><div><b>${t.currentVersion.file_name}</b>
          <span class="muted small"> · v${t.currentVersion.version_number} · ${pages(t.currentVersion.page_count)} · ${fmtSize(t.currentVersion.file_size)}</span></div>
          <div class="row"><a class="btn small" href="${fileUrl(t, t.currentVersion)}" target="_blank" rel="noopener">${icon('eye')} Open</a>
          <a class="btn small" href="${fileUrl(t, t.currentVersion, true)}">${icon('download')} Download</a></div></div>
        <iframe class="pdf-frame" src="${fileUrl(t, t.currentVersion)}" title="Thesis PDF"></iframe></div>`
      : html`<div class="card">${empty('No document uploaded', 'Upload the thesis PDF from the draft form.')}</div>`,

    versions: html`<div class="card"><div class="table-wrap"><table><thead><tr><th>Version</th><th>File</th><th>Notes</th><th>Uploaded</th><th>Similarity</th><th></th></tr></thead><tbody>
      ${t.versions.map(v => {
        const chk = t.plagiarismChecks.find(c => c.version_id === v.id);
        return html`<tr><td><b>v${v.version_number}</b>${v.id === t.currentVersion?.id ? html` <span class="badge plain b-ok">current</span>` : ''}</td>
          <td>${v.file_name}<div class="sub">${fmtSize(v.file_size)}${v.page_count ? ` · ${pages(v.page_count)}` : ''}</div></td>
          <td class="small">${v.revision_notes || '—'}</td><td>${fmtDateTime(v.upload_date)}<div class="sub">${v.uploaded_by}</div></td>
          <td>${chk ? html`<span class="badge plain ${chk.status === 'Passed' ? 'b-ok' : 'b-bad'}">${chk.similarity_score}%</span>` : '—'}</td>
          <td><a class="btn small" href="${fileUrl(t, v)}" target="_blank" rel="noopener">${icon('eye')} View</a></td></tr>`;
      })}</tbody></table></div>
      <div class="pager" style="justify-content:flex-start">${icon('lock', '')} Versions are append-only: earlier files are never overwritten or deleted (BR-005).</div></div>`,

    reviews: html`<div class="stack">
      ${openReq ? html`<div class="alert warn">${icon('edit')}<div><b>Open revision request</b> from ${openReq.requested_by_name} (${fmtDate(openReq.request_date)}): ${openReq.reason}</div></div>` : ''}
      ${t.reviews.length ? html`<div class="card card-pad"><h2 style="margin-bottom:12px">Reviews</h2>${t.reviews.map(r => html`
        <div class="review-item"><div class="row between"><div><b>${r.reviewer_name}</b> <span class="muted small">· ${r.stage} stage · on v${r.version_number}</span></div>
          <span class="badge ${OUTCOME[r.outcome]?.[1]}">${OUTCOME[r.outcome]?.[0]}</span></div>
          <p style="margin:8px 0 0">${r.comments}</p>
          ${r.feedback_to_student ? html`<div class="quote"><b>Required changes:</b> ${r.feedback_to_student}</div>` : ''}
          <div class="small muted" style="margin-top:8px">${fmtDateTime(r.review_date)}</div></div>`)}</div>` : ''}
      ${t.annotations.length ? html`<div class="card"><div class="card-head"><h2>Annotations</h2></div><div class="table-wrap"><table>
        <thead><tr><th>Version</th><th>Page</th><th>Note</th><th>By</th></tr></thead><tbody>
        ${t.annotations.map(a => html`<tr><td>v${a.version_number}</td><td>${a.page ?? '—'}</td><td>${a.note}</td><td>${a.reviewer_name}<div class="sub">${fmtDate(a.created_at)}</div></td></tr>`)}
        </tbody></table></div></div>` : ''}
      ${!t.reviews.length && !t.annotations.length ? html`<div class="card">${empty('No reviews yet', 'Feedback from your guide and the committee will appear here.')}</div>` : ''}
    </div>`,

    similarity: t.plagiarismChecks.length ? html`<div class="stack">${t.plagiarismChecks.map(c => html`
      <div class="card card-pad"><div class="row between"><div><b>Version ${c.version_number ?? '—'}</b> <span class="muted small">· ${c.tool} · ${fmtDateTime(c.check_date)}</span></div>
        <span class="badge ${c.status === 'Passed' ? 'b-ok' : 'b-bad'}">${c.status}</span></div>
        <div class="row" style="margin-top:14px;gap:16px"><div style="font:600 28px var(--serif)">${c.similarity_score}%</div>
          <div style="flex:1;min-width:200px"><div class="meter ${c.similarity_score >= c.threshold ? 'bad' : ''}"><span style="width:${Math.min(100, c.similarity_score)}%"></span><i style="left:${c.threshold}%"></i></div>
          <div class="small muted" style="margin-top:4px">Threshold ${c.threshold}% (BR-003)</div></div></div>
        ${c.report?.matches?.length ? html`<table style="margin-top:12px"><thead><tr><th>Matched source</th><th class="num">Overlap</th></tr></thead><tbody>
          ${c.report.matches.map(m => html`<tr><td>${m.title}${m.author ? html`<div class="sub">${m.author}</div>` : ''}</td><td class="num">${m.percent}%</td></tr>`)}</tbody></table>`
        : html`<p class="small muted" style="margin-top:10px">${c.report?.note || 'No overlapping sources found.'}</p>`}
      </div>`)}</div>` : html`<div class="card">${empty('No similarity checks yet', `The check runs automatically on submission. Threshold: ${threshold}%.`)}</div>`,

    history: html`<div class="card card-pad"><ul class="timeline">${[...t.history].reverse().map(h => html`
      <li><b>${h.action}</b>${h.to_status ? html` → ${statusBadge(h.to_status)}` : ''}
      <div class="when">${h.actor_name || 'System'}${h.actor_role ? ` (${state.meta.roles[h.actor_role]})` : ''} · ${fmtDateTime(h.created_at)}</div>
      ${h.note ? html`<div class="note">${h.note}</div>` : ''}</li>`)}</ul></div>`,
  };

  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/${state.user.role === 'scholar' ? 'theses' : state.user.role === 'librarian' ? 'catalogue' : state.user.role === 'admin' ? 'admin/theses' : 'reviews'}">Back</a> / Thesis #${t.id}</div>
    <div class="page-head"><div style="max-width:780px"><div class="row" style="margin-bottom:8px">${statusBadge(t.status)}<span class="muted small">Updated ${fmtDateTime(t.updated_at)}</span></div>
      <h1>${t.title}</h1><p>${t.author.name} · ${t.degree} · ${t.department?.name || 'No department'}${t.year ? ` · ${t.year}` : ''}</p></div>
      <div class="row">${actions}</div></div>
    <div class="card card-pad" style="margin-bottom:18px">${stepper(t.status, { rejectedAt })}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => html`<button role="tab" data-tab="${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div>
    <div data-panel>${panels[tab] || panels.overview}</div>`);

  $$('[data-tab]', main).forEach(b => b.addEventListener('click', () => {
    $$('[data-tab]', main).forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
    $('[data-panel]', main).innerHTML = String(panels[b.dataset.tab]);
    bindCopy(main);
    history.replaceState(null, '', `#/thesis/${t.id}?tab=${b.dataset.tab}`);
  }));
  bindCopy(main);

  $('[data-assign]', main)?.addEventListener('click', async () => {
    const { users } = await api.get('/admin/users?role=examiner&status=active');
    modal('Assign examiner', html`<form novalidate><div data-form-error hidden></div>
      <div class="field"><label for="f-ex">Examiner / committee member</label><select id="f-ex" name="examiner_id">${options(users.map(u => [u.id, `${u.name} — ${u.department || 'No dept'}`]), t.examiner?.id, { blank: 'Select…' })}</select><div class="err"></div></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Assign</button></div></form>`, {
      onMount: (m, close) => $('form', m).addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await busy($('button.primary', m), () => api.put(`/admin/theses/${t.id}/examiner`, { examiner_id: e.target.examiner_id.value }));
          close(); toast('Examiner assigned and notified.', 'ok'); render();
        } catch (err) { showErrors(e.target, err); }
      }),
    });
  });
}
