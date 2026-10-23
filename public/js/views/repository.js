import { api, qs } from '../api.js';
import { html, raw, icon, $, keywordTags, empty, options } from '../ui.js';
import { state, query } from '../app.js';

const highlight = s => {
  const esc = String(html`${s}`);
  return raw(esc.replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>'));
};

// UC-015 Search Archived Theses — metadata filters plus full-text search.
export async function repository(main) {
  const q = query();
  const { departments, degrees } = state.meta;
  const yearOpts = Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => new Date().getFullYear() - i);

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Thesis Repository</h1>
      <p>${state.user ? 'Search published theses by metadata or within the full text.' : 'Browse publicly available theses. Sign in to see restricted records.'}</p></div></div>
    <form class="card" data-search-form style="margin-bottom:18px" role="search"><div class="card-body">
      <div class="row" style="flex-wrap:nowrap"><input name="q" value="${q.q || ''}" placeholder="Title, author, keyword or a phrase from the full text…" aria-label="Search terms" style="font-size:15px;padding:11px 14px">
        <button class="btn primary">${icon('search')} Search</button></div>
      <div class="filters" style="padding:14px 0 0;border:0">
        <select name="department" aria-label="Department">${options(departments, q.department, { blank: 'All departments' })}</select>
        <select name="degree" aria-label="Degree">${options(degrees, q.degree, { blank: 'All degrees' })}</select>
        <select name="yearFrom" aria-label="From year">${options(yearOpts, q.yearFrom, { blank: 'From year' })}</select>
        <select name="yearTo" aria-label="To year">${options(yearOpts, q.yearTo, { blank: 'To year' })}</select>
        <input name="author" value="${q.author || ''}" placeholder="Author" aria-label="Author">
        <input name="keyword" value="${q.keyword || ''}" placeholder="Exact keyword" aria-label="Keyword">
        <select name="sort" aria-label="Sort">${options([['relevance', 'Sort: relevance'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A–Z']], q.sort || 'relevance')}</select>
      </div></div></form>
    <div data-results><div class="loading"></div></div>`);

  const form = $('[data-search-form]', main);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const params = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
    location.hash = `/repository${qs(params)}`;
  });
  form.querySelectorAll('select').forEach(s => s.addEventListener('change', () => form.requestSubmit()));

  let data;
  try { data = await api.get(`/repository/search${qs(q)}`); }
  catch (err) { $('[data-results]', main).innerHTML = String(html`<div class="alert bad">${icon('alert')}<div>${err.message}</div></div>`); return; }

  const pages = Math.ceil(data.total / data.pageSize);
  const active = Object.keys(q).filter(k => k !== 'page' && k !== 'sort').length;
  $('[data-results]', main).innerHTML = String(html`
    <div class="card"><div class="card-head"><h2>${data.total} ${data.total === 1 ? 'thesis' : 'theses'} found</h2>
      ${active ? html`<a href="#/repository" class="small">Clear search</a>` : ''}</div>
      ${data.results.length ? data.results.map(r => html`
        <article class="result">
          <div class="row" style="margin-bottom:4px"><span class="badge plain">${r.degree}</span>
            ${r.visibility === 'Restricted' ? html`<span class="badge plain">${icon('lock')} Restricted</span>` : ''}
            <span class="muted small mono">${r.accession_no}</span></div>
          <h3><a href="#/thesis/${r.id}">${r.title}</a></h3>
          <div class="meta">${r.author_name} · ${r.department} · ${r.year}${r.guide_name ? ` · Supervisor: ${r.guide_name}` : ''}</div>
          <p class="snippet">${r.snippet ? highlight(r.snippet) : (r.abstract.length > 280 ? r.abstract.slice(0, 280) + '…' : r.abstract)}</p>
          <div class="row" style="margin-top:8px">${keywordTags(r.keywords)}
            <span class="right row">${r.canDownload ? html`<a class="btn small" href="/api/theses/${r.id}/versions/${r.version_id}/file" target="_blank" rel="noopener">${icon('eye')} PDF</a>` : ''}
            <a class="btn small" href="#/thesis/${r.id}">Details</a></span></div>
        </article>`)
      : empty('No matching theses', 'Try fewer words, a different spelling, or remove some filters.')}
      ${pages > 1 ? html`<div class="pager">Page ${data.page} of ${pages}
        ${data.page > 1 ? html`<a class="btn small" href="#/repository${qs({ ...q, page: data.page - 1 })}">Previous</a>` : ''}
        ${data.page < pages ? html`<a class="btn small" href="#/repository${qs({ ...q, page: data.page + 1 })}">Next</a>` : ''}</div>` : ''}
    </div>`);
}
