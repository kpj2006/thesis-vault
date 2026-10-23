import { api, qs } from '../api.js';
import { html, icon, $, options, STATUS_TEXT, empty } from '../ui.js';
import { state, query } from '../app.js';

const bars = (rows, label, value, { alt, max } = {}) => {
  const top = max || Math.max(1, ...rows.map(r => r[value]));
  return rows.length ? html`<div class="bars">${rows.map(r => html`<div class="bar-row"><span class="lbl" title="${r[label]}">${r[label]}</span>
    <span class="track"><span class="fill ${alt ? 'alt' : ''}" style="width:${(r[value] / top) * 100}%"></span></span><span class="num">${r[value]}</span></div>`)}</div>`
    : html`<p class="muted small">No data for this selection.</p>`;
};
const columns = (rows, label, value, fmt = v => v) => {
  const top = Math.max(1, ...rows.map(r => r[value]));
  return rows.length ? html`<div class="cols" role="img" aria-label="Column chart">${rows.map(r => html`<div class="col"><div class="c" style="height:${(r[value] / top) * 85}%"><span>${r[value]}</span></div>${fmt(r[label])}</div>`)}</div>`
    : html`<p class="muted small">No data for this selection.</p>`;
};
const stat = (label, value, hint) => html`<div class="card stat"><div class="label">${label}</div><div class="value">${value ?? '—'}</div>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;

// UC-019 Generate Reports — institutional research output (BR-010).
export async function reports(main) {
  const q = query();
  const r = await api.get(`/reports/research${qs(q)}`);
  const s = r.summary;
  const years = Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => new Date().getFullYear() - i);
  const month = m => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Research Output Reports</h1><p>Institutional overview of thesis submissions, review and publication.</p></div>
      <div class="row"><button class="btn" data-print>Print</button><a class="btn primary" href="/api/reports/published.csv">${icon('download')} Export published (CSV)</a></div></div>
    <form class="card filters" data-filter style="margin-bottom:18px;border-bottom:1px solid var(--border)">
      <select name="department" aria-label="Department">${options(state.meta.departments, q.department, { blank: 'All departments' })}</select>
      <select name="yearFrom" aria-label="From year">${options(years, q.yearFrom, { blank: 'From year' })}</select>
      <select name="yearTo" aria-label="To year">${options(years, q.yearTo, { blank: 'To year' })}</select>
      <button class="btn">Apply</button>${Object.keys(q).length ? html`<a class="btn ghost" href="#/reports">Reset</a>` : ''}
    </form>
    ${s.totalSubmitted === 0 ? html`<div class="card">${empty('No submissions in this range', 'Change the filters to see results.')}</div>` : html`
    <div class="grid grid-4" style="margin-bottom:16px">
      ${stat('Theses submitted', s.totalSubmitted)}${stat('Published', s.published, `${Math.round((s.published / s.totalSubmitted) * 100)}% of submissions`)}
      ${stat('In review', s.inReview, `${s.revisionRequired} awaiting scholar revision`)}${stat('Awaiting library', s.awaitingCataloguing)}
    </div>
    <div class="grid grid-4" style="margin-bottom:16px">
      ${stat('Avg. days to publish', s.avgDaysToPublish, 'Submission → repository')}${stat('Avg. revisions per thesis', s.avgRevisionsPerThesis)}
      ${stat('Avg. similarity', s.avgSimilarity != null ? `${s.avgSimilarity}%` : '—', `Threshold ${state.meta.threshold}%`)}${stat('Flagged checks', s.flaggedChecks, `${s.rejected} thesis(es) rejected`)}
    </div>
    <div class="grid grid-2">
      <div class="card card-pad"><h2 style="margin-bottom:14px">Pipeline by status</h2>${bars(r.byStatus.map(x => ({ ...x, label: STATUS_TEXT[x.status] })), 'label', 'n')}</div>
      <div class="card card-pad"><h2 style="margin-bottom:14px">Published per year</h2>${columns(r.byYear, 'year', 'published')}</div>
      <div class="card card-pad"><h2 style="margin-bottom:4px">By department</h2><p class="small muted" style="margin-bottom:12px">Submitted (blue) and published (gold)</p>
        ${r.byDepartment.length ? html`<div class="bars">${r.byDepartment.map(d => {
          const top = Math.max(...r.byDepartment.map(x => x.submitted));
          return html`<div class="bar-row"><span class="lbl" title="${d.department}">${d.department}</span><span>
            <span class="track" style="display:block;margin-bottom:3px"><span class="fill" style="display:block;width:${(d.submitted / top) * 100}%"></span></span>
            <span class="track" style="display:block"><span class="fill alt" style="display:block;width:${(d.published / top) * 100}%"></span></span></span>
            <span class="num">${d.published}/${d.submitted}</span></div>`;
        })}</div>` : html`<p class="muted small">No data.</p>`}</div>
      <div class="card card-pad"><h2 style="margin-bottom:14px">Submissions, last 12 months</h2>${columns(r.monthlySubmissions, 'month', 'n', month)}</div>
      <div class="card card-pad"><h2 style="margin-bottom:14px">Similarity score distribution</h2>${bars(r.similarityBuckets, 'bucket', 'n', { alt: true })}</div>
      <div class="card card-pad"><h2 style="margin-bottom:14px">By degree</h2>${bars(r.byDegree, 'degree', 'n')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Reviewer workload</h2></div>
      ${r.reviewerWorkload.length ? html`<div class="table-wrap"><table><thead><tr><th>Reviewer</th><th>Role</th><th class="num">Pending</th><th class="num">Total assigned</th></tr></thead><tbody>
      ${r.reviewerWorkload.map(w => html`<tr><td>${w.name}</td><td>${state.meta.roles[w.role]}</td><td class="num">${w.pending ? html`<b>${w.pending}</b>` : 0}</td><td class="num">${w.total}</td></tr>`)}</tbody></table></div>`
      : html`<p class="card-body muted">No assignments yet.</p>`}</div>`}`);

  $('[data-filter]', main).addEventListener('submit', e => {
    e.preventDefault();
    location.hash = `/reports${qs(Object.fromEntries(new FormData(e.target)))}`;
  });
  $('[data-print]', main).addEventListener('click', () => window.print());
}
