import { api } from '../api.js';
import { html, icon, $, $$, statusBadge, fmtDate, fmtDateTime, empty, field, options, showErrors, clearErrors, busy, toast, modal, confirmDialog } from '../ui.js';
import { state, go, render, query } from '../app.js';
import { citationBlock, bindCopy } from './thesis.js';

export async function catalogueQueue(main) {
  const { theses } = await api.get('/catalogue/queue');
  const groups = {
    approved: ['Ready to catalogue', theses.filter(t => t.status === 'Approved')],
    catalogued: ['Ready to publish', theses.filter(t => t.status === 'Catalogued')],
    published: ['Published', theses.filter(t => t.status === 'Published')],
  };
  const tab = query().tab || 'approved';
  const table = list => list.length ? html`<div class="table-wrap"><table><thead><tr><th>Thesis</th><th>Author / guide</th><th>Committee approval</th><th>Accession</th><th>Status</th></tr></thead><tbody>
    ${list.map(t => html`<tr class="clickable" data-href="#/catalogue/${t.id}"><td><a class="title-link" href="#/catalogue/${t.id}">${t.title}</a><div class="sub">#${t.id} · ${t.department} · ${t.degree} · ${t.year}</div></td>
      <td>${t.author_name}<div class="sub">${t.guide_name || ''}</div></td><td>${fmtDate(t.approval_date)}</td>
      <td class="mono">${t.accession_no || '—'}${t.visibility ? html`<div class="sub">${t.visibility}</div>` : ''}</td><td>${statusBadge(t.status)}</td></tr>`)}</tbody></table></div>`
    : empty('Nothing here', 'Theses appear here once they reach this stage.');

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Cataloguing</h1><p>Only theses that completed guide and committee approval reach the library (BR-001, BR-008).</p></div>
      <a class="btn" href="/api/reports/published.csv">${icon('download')} Export catalogue (CSV)</a></div>
    <div class="tabs">${Object.entries(groups).map(([k, [l, list]]) => html`<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}<span class="n">${list.length}</span></button>`)}</div>
    <div class="card" data-panel>${table(groups[tab][1])}</div>`);

  const bindRows = () => main.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  bindRows();
  $$('[data-tab]', main).forEach(b => b.addEventListener('click', () => {
    $$('[data-tab]', main).forEach(x => x.classList.toggle('active', x === b));
    $('[data-panel]', main).innerHTML = String(table(groups[b.dataset.tab][1]));
    history.replaceState(null, '', `#/catalogue?tab=${b.dataset.tab}`);
    bindRows();
  }));
}

// UC-013 Catalogue Thesis / UC-014 Publish — wireframe Figure 4.
export async function cataloguePage(main, { id }) {
  const [{ thesis: t }, cat] = await Promise.all([api.get(`/theses/${id}`), api.get(`/catalogue/${id}`)]);
  const { departments, degrees } = state.meta;
  const rec = cat.record || {};
  const committee = t.approvals.filter(a => a.level === 'Committee').pop();
  const locked = t.status === 'Published';
  const v = t.currentVersion;
  const ro = locked ? 'readonly' : '';

  main.innerHTML = String(html`
    <div class="crumbs"><a href="#/catalogue">Cataloguing</a> / Thesis #${t.id}</div>
    <div class="page-head"><div><div class="row" style="margin-bottom:8px">${statusBadge(t.status)}${rec.accession_no ? html`<span class="badge plain mono">${rec.accession_no}</span>` : ''}</div>
      <h1>Catalogue Thesis</h1><p>UC-013 · Verify metadata, classify, and publish to the searchable repository.</p></div></div>
    ${locked ? html`<div class="alert ok" style="margin-bottom:16px">${icon('check')}<div><b>Published ${fmtDate(rec.published_date)}</b> with DOI <span class="mono">${rec.doi}</span>. The catalogue record is locked; only visibility can change.</div></div>` : ''}
    <form class="card" novalidate>
      <div style="padding:16px 20px 0"><div data-form-error hidden></div></div>
      <section class="form-section"><div class="sect-label"><h3>Approved thesis details</h3></div><div>
        <dl class="kv"><dt>Author</dt><dd>${t.author.name} <span class="muted small">(${t.author.email})</span></dd><dt>Supervisor</dt><dd>${t.guide?.name || '—'}</dd>
          <dt>Committee approval</dt><dd>${committee ? html`${committee.approver_name}, ${fmtDate(committee.approval_date)}` : html`<span class="badge b-bad">Missing</span>`}</dd>
          <dt>Approval chain</dt><dd>${t.approvals.map(a => html`<span class="tag">${a.level}: ${a.approver_name}</span>`)}</dd></dl>
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Verify metadata</h3><p>Correct anything the scholar entered inaccurately.</p></div><div>
        ${field('title', 'Title', html`<input id="f-title" name="title" value="${t.title}" ${ro}>`, { required: true })}
        <div class="fields-3">
          ${field('department_id', 'Department', html`<select id="f-department_id" name="department_id" ${locked ? 'disabled' : ''}>${options(departments, t.department?.id)}</select>`, { required: true })}
          ${field('degree', 'Degree', html`<select id="f-degree" name="degree" ${locked ? 'disabled' : ''}>${options(degrees, t.degree)}</select>`, { required: true })}
          ${field('year', 'Year', html`<input id="f-year" name="year" type="number" value="${t.year}" ${ro}>`, { required: true })}
        </div>
        ${field('keywords', 'Keywords', html`<input id="f-keywords" name="keywords" value="${t.keywords}" ${ro}>`, { required: true, help: 'Comma separated.' })}
        ${field('abstract', 'Abstract', html`<textarea id="f-abstract" name="abstract" rows="6" ${ro}>${t.abstract}</textarea>`, { required: true })}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Library catalogue details</h3><p>Classification and access level are required (Lab 7 §4.3).</p></div><div>
        <div class="fields-2">
          ${field('accession', 'Accession no.', html`<input id="f-accession" value="${rec.accession_no || 'Auto-generated on save'}" readonly>`)}
          ${field('ddc_class', 'DDC / subject classification', html`<input id="f-ddc_class" name="ddc_class" value="${rec.ddc_class || ''}" placeholder="e.g. 006.31" ${ro}>`, { required: true })}
        </div>
        <div class="fields-2">
          ${field('category', 'Category', html`<input id="f-category" name="category" value="${rec.category || ''}" placeholder="e.g. Machine Learning" ${ro}>`, { required: true })}
          ${field('research_area', 'Research area', html`<input id="f-research_area" name="research_area" value="${rec.research_area || ''}" ${ro}>`)}
        </div>
        <div class="field" data-field="visibility"><label class="req">Visibility</label>
          <div class="radio-cards" style="grid-template-columns:1fr 1fr">
            <label class="radio-card"><input type="radio" name="visibility" value="Public" ${(rec.visibility || 'Public') === 'Public' ? 'checked' : ''}><div><b>${icon('globe')} Public</b><span>Anyone can read and download the PDF.</span></div></label>
            <label class="radio-card"><input type="radio" name="visibility" value="Restricted" ${rec.visibility === 'Restricted' ? 'checked' : ''}><div><b>${icon('lock')} Restricted</b><span>Record visible to signed-in users; full text only for staff, the author and guide.</span></div></label>
          </div><div class="err"></div></div>
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Document file</h3></div><div>
        ${v ? html`<div class="row"><b>${v.file_name}</b><span class="muted small">v${v.version_number} · approved version</span>
          <a class="btn small right" href="/api/theses/${t.id}/versions/${v.id}/file" target="_blank" rel="noopener">${icon('eye')} View file</a></div>` : '—'}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Citation information</h3><p>Generated automatically when metadata is saved.</p></div><div>${citationBlock(rec)}</div></section>
      <section class="form-section"><div class="sect-label"><h3>Notes</h3></div><div>
        ${field('notes', 'Internal notes (optional)', html`<textarea id="f-notes" name="notes" rows="2" ${ro}>${rec.notes || ''}</textarea>`)}
      </div></section>
      <section class="form-section"><div class="sect-label"><h3>Archive &amp; publish</h3></div><div>
        <ol class="small" style="margin:0;padding-left:18px;line-height:2">
          <li>${t.status !== 'Approved' ? icon('check') : ''} Complete cataloguing — records the Librarian approval (BR-001) ${rec.catalogue_date ? html`<span class="muted">· ${fmtDateTime(rec.catalogue_date)}</span>` : ''}</li>
          <li>${locked ? icon('check') : ''} Publish to repository — assigns DOI and makes it searchable (BR-008)</li>
        </ol>
      </div></section>
      <div class="form-actions">
        <a class="btn" href="#/catalogue" style="margin-right:auto">Cancel</a>
        <button type="button" class="btn" data-record ${rec.accession_no ? '' : 'disabled'}>View catalogue record</button>
        ${locked ? html`<button type="button" class="btn primary" data-visibility>Update visibility</button>` : html`
          <button type="button" class="btn" data-save>Save metadata</button>
          ${t.status === 'Approved' ? html`<button type="button" class="btn primary" data-complete>${icon('check')} Complete cataloguing</button>` : ''}
          <button type="button" class="btn accent" data-publish ${t.status === 'Catalogued' ? '' : 'disabled title="Complete cataloguing first"'}>${icon('book')} Publish in repository</button>`}
      </div>
    </form>`);

  const form = $('form', main);
  const body = () => Object.fromEntries(new FormData(form));
  bindCopy(main);

  $('[data-save]', form)?.addEventListener('click', async e => {
    clearErrors(form);
    try { await busy(e.currentTarget, () => api.put(`/catalogue/${t.id}`, body())); toast('Metadata saved.', 'ok'); render(); }
    catch (err) { showErrors(form, err); }
  });
  $('[data-complete]', form)?.addEventListener('click', async e => {
    clearErrors(form);
    if (!await confirmDialog('Complete cataloguing?', 'This records the librarian approval and locks the thesis for publication.', { confirmText: 'Complete cataloguing' })) return;
    try { const r = await busy(e.currentTarget, () => api.post(`/catalogue/${t.id}/complete`, body())); toast(`Catalogued as ${r.accessionNo}.`, 'ok'); render(); }
    catch (err) { showErrors(form, err); }
  });
  $('[data-publish]', form)?.addEventListener('click', async e => {
    if (!await confirmDialog('Publish to repository?', `The thesis will become searchable${form.visibility.value === 'Public' ? ' and its PDF publicly downloadable' : ' (full text restricted)'}. The scholar and guide will be notified.`, { confirmText: 'Publish' })) return;
    try { const r = await busy(e.currentTarget, () => api.post(`/catalogue/${t.id}/publish`)); toast(`Published with DOI ${r.doi}.`, 'ok'); go(`/thesis/${t.id}`); }
    catch (err) { showErrors(form, err); }
  });
  $('[data-visibility]', form)?.addEventListener('click', async e => {
    try { await busy(e.currentTarget, () => api.put(`/catalogue/${t.id}/visibility`, { visibility: form.visibility.value })); toast('Visibility updated.', 'ok'); }
    catch (err) { showErrors(form, err); }
  });
  $('[data-record]', form)?.addEventListener('click', () => modal('Catalogue record', html`
    <dl class="kv" style="grid-template-columns:130px 1fr">
      <dt>Accession no.</dt><dd class="mono">${rec.accession_no}</dd><dt>Title</dt><dd>${t.title}</dd><dt>Author</dt><dd>${t.author.name}</dd>
      <dt>Supervisor</dt><dd>${t.guide?.name}</dd><dt>Department</dt><dd>${t.department?.name}</dd><dt>Degree / year</dt><dd>${t.degree}, ${t.year}</dd>
      <dt>DDC class</dt><dd>${rec.ddc_class || '—'}</dd><dt>Category</dt><dd>${rec.category || '—'}</dd><dt>Research area</dt><dd>${rec.research_area || '—'}</dd>
      <dt>Visibility</dt><dd>${rec.visibility}</dd><dt>Status</dt><dd>${rec.status}</dd><dt>DOI</dt><dd class="mono">${rec.doi || 'Assigned on publication'}</dd>
      <dt>Catalogued</dt><dd>${fmtDateTime(rec.catalogue_date)}</dd><dt>Published</dt><dd>${fmtDateTime(rec.published_date)}</dd></dl>
    <div style="margin-top:16px">${citationBlock(rec)}</div>`, { onMount: m => bindCopy(m) }));
}
