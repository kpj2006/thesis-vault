import { api } from '../api.js';
import { html, icon, statusBadge, ago, empty } from '../ui.js';
import { state } from '../app.js';
import { thesisTable } from './scholar.js';

const stat = (label, value, hint, accent) => html`<div class="card stat ${accent ? 'accent' : ''}"><div class="label">${label}</div><div class="value">${value ?? 0}</div>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;

const activity = recent => recent.length ? html`<ul class="timeline">${recent.map(h => html`
  <li><b>${h.action}</b> — <a href="#/thesis/${h.thesis_id}">${h.title}</a>
  <div class="when">${h.actor_name || 'System'} · ${ago(h.created_at)}</div>${h.note ? html`<div class="note">${h.note}</div>` : ''}</li>`)}</ul>`
  : html`<p class="muted">No activity yet.</p>`;

export async function dashboard(main) {
  const u = state.user;
  const { stats: s, recent } = await api.get('/dashboard');
  let cards, primary;

  if (u.role === 'scholar') {
    const { theses } = await api.get('/theses/mine');
    cards = [stat('My theses', s.total), stat('In review', s.inReview), stat('Needs my action', s.actionNeeded, 'Drafts and revision requests', s.actionNeeded > 0), stat('Published', s.published)];
    const action = theses.find(t => t.status === 'RevisionRequired');
    primary = html`
      ${!s.guide ? html`<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<div><b>No Supervisor/Guide assigned yet.</b> You can prepare a draft, but submission is blocked until the administrator assigns your guide.</div></div>` : ''}
      ${action ? html`<div class="alert warn" style="margin-bottom:16px">${icon('edit')}<div><b>Revision requested</b> on “${action.title}”. <a href="#/thesis/${action.id}/revise">Upload a revised version →</a></div></div>` : ''}
      <div class="card"><div class="card-head"><h2>My theses</h2><a class="btn primary small" href="#/submit">${icon('plus')} New submission</a></div>
      ${theses.length ? thesisTable(theses, { compact: true }) : empty('No theses yet', 'Start by submitting your thesis with its metadata and PDF.', html`<a class="btn primary" href="#/submit">Submit thesis</a>`)}</div>`;
  } else if (u.role === 'supervisor' || u.role === 'examiner') {
    const { theses } = await api.get('/reviews/queue');
    const waiting = theses.filter(t => t.awaiting_me);
    cards = u.role === 'supervisor'
      ? [stat('Awaiting my review', s.awaiting, null, s.awaiting > 0), stat('With scholar for revision', s.withScholar), stat('At committee stage', s.atCommittee), stat('My scholars', s.scholars)]
      : [stat('Awaiting my evaluation', s.awaiting, null, s.awaiting > 0), stat('Theses I approved', s.approved), stat('Published in repository', s.published)];
    primary = html`<div class="card"><div class="card-head"><h2>${u.role === 'supervisor' ? 'Awaiting your review' : 'Awaiting your evaluation'}</h2><a href="#/reviews">View full queue →</a></div>
      ${waiting.length ? html`<div class="table-wrap"><table><thead><tr><th>Thesis</th><th>Scholar</th><th>Version</th><th>Similarity</th><th>Updated</th></tr></thead><tbody>
      ${waiting.map(t => html`<tr class="clickable" data-href="#/review/${t.id}"><td><a class="title-link" href="#/review/${t.id}">${t.title}</a><div class="sub">${t.department} · ${t.degree}</div></td>
        <td>${t.author_name}<div class="sub">${t.roll_number || ''}</div></td><td>v${t.current_version}</td>
        <td>${t.similarity ?? '—'}%</td><td>${ago(t.updated_at)}</td></tr>`)}</tbody></table></div>`
      : empty('All caught up', 'There are no theses waiting for you right now.')}</div>`;
  } else if (u.role === 'librarian') {
    const { theses } = await api.get('/catalogue/queue');
    const todo = theses.filter(t => t.status !== 'Published');
    cards = [stat('Ready to catalogue', s.toCatalogue, 'Committee-approved', s.toCatalogue > 0), stat('Ready to publish', s.toPublish, 'Catalogued'), stat('Published', s.published), stat('Restricted access', s.restricted)];
    primary = html`<div class="card"><div class="card-head"><h2>Cataloguing work</h2><a href="#/catalogue">Open cataloguing →</a></div>
      ${todo.length ? html`<div class="table-wrap"><table><thead><tr><th>Thesis</th><th>Author</th><th>Status</th></tr></thead><tbody>
      ${todo.map(t => html`<tr class="clickable" data-href="#/catalogue/${t.id}"><td><a class="title-link" href="#/catalogue/${t.id}">${t.title}</a><div class="sub">${t.department} · ${t.year}</div></td><td>${t.author_name}</td><td>${statusBadge(t.status)}</td></tr>`)}
      </tbody></table></div>` : empty('Nothing to catalogue', 'Approved theses will appear here.')}</div>`;
  } else {
    cards = u.role === 'admin'
      ? [stat('Active users', s.users), stat('Scholars without guide', s.unassignedScholars, null, s.unassignedScholars > 0), stat('Need examiner', s.needsExaminer, null, s.needsExaminer > 0), stat('Published theses', s.published)]
      : [stat('Theses in workflow', s.inWorkflow), stat('Published theses', s.published), stat('Active users', s.users)];
    primary = html`<div class="card card-pad"><h2>Quick links</h2><div class="row" style="margin-top:14px">
      <a class="btn" href="#/reports">${icon('chart')} Research reports</a><a class="btn" href="#/repository">${icon('search')} Repository</a>
      ${u.role === 'admin' ? html`<a class="btn" href="#/admin/users">${icon('users')} Manage users</a><a class="btn" href="#/admin/theses">${icon('list')} Thesis oversight</a><a class="btn" href="#/admin/audit">${icon('shield')} Audit log</a>` : ''}
    </div></div>`;
  }

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Welcome, ${u.name.split(' ')[0] === 'Dr.' || u.name.split(' ')[0] === 'Prof.' ? u.name : u.name.split(' ')[0]}</h1>
      <p>${u.roleLabel}${u.department ? ` · ${u.department}` : ''}</p></div></div>
    <div class="grid grid-4" style="margin-bottom:18px">${cards}</div>
    <div class="split"><div>${primary}</div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div><div class="card-body">${activity(recent)}</div></div></div>`);
  main.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
}
