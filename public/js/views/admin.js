import { api, qs } from '../api.js';
import { html, icon, $, $$, statusBadge, fmtDateTime, ago, empty, field, options, showErrors, busy, toast, modal, confirmDialog } from '../ui.js';
import { state, query, render } from '../app.js';

const ROLE_ORDER = ['scholar', 'supervisor', 'examiner', 'librarian', 'admin', 'institute'];

// ---- UC-002 Manage Users -------------------------------------------------------
export async function users(main) {
  const q = query();
  const [{ users: list }, { users: guides }] = await Promise.all([
    api.get(`/admin/users${qs(q)}`), api.get('/admin/users?role=supervisor&status=active'),
  ]);
  const { roles, departments } = state.meta;

  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Users &amp; Roles</h1><p>Only administrators can create, change, deactivate or reassign accounts (BR-007).</p></div>
      <button class="btn primary" data-new>${icon('plus')} New user</button></div>
    <div class="card">
      <form class="filters" data-filter>
        <input name="q" value="${q.q || ''}" placeholder="Search name, email or roll no.">
        <select name="role">${options(ROLE_ORDER.map(r => [r, roles[r]]), q.role, { blank: 'All roles' })}</select>
        <select name="status">${options([['active', 'Active'], ['deactivated', 'Deactivated']], q.status, { blank: 'Any status' })}</select>
        <button class="btn">Filter</button>
      </form>
      ${list.length ? html`<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Department</th><th>Guide / load</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(u => html`<tr>
        <td><b>${u.name}</b><div class="sub">${u.email}${u.roll_number ? ` · ${u.roll_number}` : ''}</div></td>
        <td>${roles[u.role]}</td><td>${u.department || '—'}</td>
        <td>${u.role === 'scholar' ? (u.guide_name || html`<span class="badge b-revision">Unassigned</span>`) : u.role === 'supervisor' ? `${u.guiding} thesis(es)` : '—'}</td>
        <td>${u.status === 'active' ? html`<span class="badge b-ok">Active</span>` : html`<span class="badge b-bad">Deactivated</span>`}</td>
        <td class="num"><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
          <button class="btn small" data-edit="${u.id}">Edit</button>
          <button class="btn small ghost" data-reset="${u.id}" title="Reset password">${icon('lock')}</button>
          ${u.id !== state.user.id ? html`<button class="btn small ${u.status === 'active' ? 'danger' : ''}" data-status="${u.id}" data-to="${u.status === 'active' ? 'deactivated' : 'active'}">${u.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>` : ''}
        </div></td></tr>`)}</tbody></table></div>` : empty('No users match', 'Adjust the filters.')}
    </div>`);

  $('[data-filter]', main).addEventListener('submit', e => {
    e.preventDefault();
    location.hash = `/admin/users${qs(Object.fromEntries(new FormData(e.target)))}`;
  });

  const editor = u => {
    const isNew = !u;
    u ||= { role: 'scholar' };
    modal(isNew ? 'New user' : `Edit ${u.name}`, html`<form novalidate><div data-form-error hidden></div>
      <div class="fields-2">${field('name', 'Full name', html`<input id="f-name" name="name" value="${u.name || ''}">`, { required: true })}
        ${field('email', 'Email', html`<input id="f-email" name="email" type="email" value="${u.email || ''}">`, { required: true })}</div>
      <div class="fields-2">${field('role', 'Role', html`<select id="f-role" name="role">${options(ROLE_ORDER.map(r => [r, roles[r]]), u.role)}</select>`, { required: true })}
        ${field('department_id', 'Department', html`<select id="f-department_id" name="department_id">${options(departments, u.department_id, { blank: '—' })}</select>`)}</div>
      <div data-scholar><div class="fields-2">${field('roll_number', 'Roll number', html`<input id="f-roll_number" name="roll_number" value="${u.roll_number || ''}">`)}
        ${field('guide_id', 'Supervisor / Guide', html`<select id="f-guide_id" name="guide_id">${options(guides.map(g => [g.id, `${g.name} (${g.department || '—'})`]), u.guide_id, { blank: 'Not assigned' })}</select>`)}</div></div>
      <div data-staff>${field('specialization', 'Specialization', html`<input id="f-specialization" name="specialization" value="${u.specialization || ''}">`)}</div>
      ${field('contact', 'Contact', html`<input id="f-contact" name="contact" value="${u.contact || ''}">`)}
      ${isNew ? field('password', 'Initial password', html`<input id="f-password" name="password" type="text" placeholder="Leave blank to generate one">`) : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${isNew ? 'Create user' : 'Save changes'}</button></div></form>`, {
      onMount: (m, close) => {
        const form = $('form', m);
        const sync = () => { $('[data-scholar]', m).hidden = form.role.value !== 'scholar'; $('[data-staff]', m).hidden = !['supervisor', 'examiner'].includes(form.role.value); };
        form.role.addEventListener('change', sync); sync();
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(form));
          try {
            const res = await busy($('button.primary', m), () => isNew ? api.post('/admin/users', body) : api.put(`/admin/users/${u.id}`, body));
            close();
            if (res.tempPassword) modal('User created', html`<p>Share this temporary password with <b>${res.user.name}</b> securely. It will not be shown again.</p><p class="mono" style="font-size:18px;margin-top:10px">${res.tempPassword}</p>`, { onClose: render });
            else { toast('User saved.', 'ok'); render(); }
          } catch (err) { showErrors(form, err); }
        });
      },
    });
  };

  $('[data-new]', main).addEventListener('click', () => editor(null));
  $$('[data-edit]', main).forEach(b => b.addEventListener('click', () => editor(list.find(u => String(u.id) === b.dataset.edit))));
  $$('[data-status]', main).forEach(b => b.addEventListener('click', async () => {
    const u = list.find(x => String(x.id) === b.dataset.status);
    const deact = b.dataset.to === 'deactivated';
    if (!await confirmDialog(`${deact ? 'Deactivate' : 'Reactivate'} ${u.name}?`, deact ? 'They will be signed out and unable to sign in. Their records are kept.' : 'They will be able to sign in again.', { confirmText: deact ? 'Deactivate' : 'Reactivate', danger: deact })) return;
    try { await api.put(`/admin/users/${u.id}/status`, { status: b.dataset.to }); toast('Account updated.', 'ok'); render(); } catch (err) { toast(err.message, 'bad'); }
  }));
  $$('[data-reset]', main).forEach(b => b.addEventListener('click', async () => {
    const u = list.find(x => String(x.id) === b.dataset.reset);
    if (!await confirmDialog(`Reset password for ${u.name}?`, 'A new temporary password will be generated.', { confirmText: 'Reset password' })) return;
    try { const { tempPassword } = await api.post(`/admin/users/${u.id}/reset-password`); modal('Password reset', html`<p>New temporary password for <b>${u.name}</b>:</p><p class="mono" style="font-size:18px;margin-top:10px">${tempPassword}</p>`); }
    catch (err) { toast(err.message, 'bad'); }
  }));
}

// ---- Thesis oversight ------------------------------------------------------------
export async function theses(main) {
  const q = query();
  const { theses: list } = await api.get(`/admin/theses${qs(q)}`);
  const { statuses } = state.meta;
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Thesis Oversight</h1><p>Every submission in the workflow. Assign examiners for committee review.</p></div></div>
    <div class="card">
      <form class="filters" data-filter><input name="q" value="${q.q || ''}" placeholder="Search title or author">
        <select name="status">${options(Object.entries(statuses).filter(([k]) => k !== 'Draft' && k !== 'Submitted'), q.status, { blank: 'All statuses' })}</select>
        <button class="btn">Filter</button></form>
      ${list.length ? html`<div class="table-wrap"><table><thead><tr><th>Thesis</th><th>Scholar</th><th>Guide</th><th>Examiner</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      ${list.map(t => html`<tr class="clickable" data-href="#/thesis/${t.id}"><td><a class="title-link" href="#/thesis/${t.id}">${t.title}</a><div class="sub">#${t.id} · ${t.department || '—'} · ${t.year || ''}</div></td>
        <td>${t.author_name}</td><td>${t.guide_name || '—'}</td>
        <td>${t.examiner_name || (t.status === 'UnderCommitteeReview' ? html`<span class="badge b-revision">Needs examiner</span>` : '—')}</td>
        <td>${statusBadge(t.status)}</td><td>${ago(t.updated_at)}</td></tr>`)}</tbody></table></div>` : empty('No theses', 'Nothing matches the filter.')}
    </div>`);
  $('[data-filter]', main).addEventListener('submit', e => { e.preventDefault(); location.hash = `/admin/theses${qs(Object.fromEntries(new FormData(e.target)))}`; });
  main.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
}

// ---- UC-018 View Audit Log -------------------------------------------------------
export async function audit(main) {
  const q = query();
  const data = await api.get(`/admin/audit${qs(q)}`);
  const pages = Math.ceil(data.total / data.pageSize);
  const pretty = d => { if (!d) return ''; try { return Object.entries(JSON.parse(d)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { return d; } };
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Audit Log</h1><p>Append-only record of who did what and when (NFR-016). ${data.total} entries.</p></div></div>
    <div class="card">
      <form class="filters" data-filter>
        <select name="action">${options(data.actions, q.action, { blank: 'All actions' })}</select>
        <input name="user" value="${q.user || ''}" placeholder="User name or email">
        <input name="from" type="date" value="${q.from || ''}" aria-label="From date"><input name="to" type="date" value="${q.to || ''}" aria-label="To date">
        <button class="btn">Filter</button></form>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
      ${data.entries.map(e => html`<tr><td style="white-space:nowrap">${fmtDateTime(e.created_at)}</td>
        <td>${e.user_name || html`<span class="muted">—</span>`}${e.user_role ? html`<div class="sub">${state.meta.roles[e.user_role]}</div>` : ''}</td>
        <td><span class="mono">${e.action}</span></td>
        <td>${e.entity_type ? (e.entity_type === 'thesis' && e.entity_id ? html`<a href="#/thesis/${e.entity_id}">thesis #${e.entity_id}</a>` : `${e.entity_type}${e.entity_id ? ` #${e.entity_id}` : ''}`) : '—'}</td>
        <td class="small" style="max-width:360px;overflow-wrap:anywhere">${pretty(e.details)}${e.ip ? html`<div class="sub">${e.ip}</div>` : ''}</td></tr>`)}
      </tbody></table></div>
      ${pages > 1 ? html`<div class="pager">Page ${data.page} of ${pages}
        ${data.page > 1 ? html`<a class="btn small" href="#/admin/audit${qs({ ...q, page: data.page - 1 })}">Newer</a>` : ''}
        ${data.page < pages ? html`<a class="btn small" href="#/admin/audit${qs({ ...q, page: data.page + 1 })}">Older</a>` : ''}</div>` : ''}
    </div>`);
  $('[data-filter]', main).addEventListener('submit', e => { e.preventDefault(); location.hash = `/admin/audit${qs(Object.fromEntries(new FormData(e.target)))}`; });
}

// ---- Settings ----------------------------------------------------------------------
export async function settings(main) {
  const { settings: s } = await api.get('/admin/settings');
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1><p>Institute-level configuration.</p></div></div>
    <div class="grid grid-2">
      <form class="card card-pad" data-settings novalidate><h2 style="margin-bottom:14px">Workflow rules</h2><div data-form-error hidden></div>
        ${field('plagiarism_threshold', 'Similarity threshold (%)', html`<input id="f-plagiarism_threshold" name="plagiarism_threshold" type="number" min="1" max="100" step="0.5" value="${s.plagiarism_threshold}">`, { required: true, help: 'Submissions at or above this score are flagged and withheld from review (BR-003).' })}
        ${field('institutional_domain', 'Institutional email domain', html`<input id="f-institutional_domain" name="institutional_domain" value="${s.institutional_domain}">`, { required: true, help: 'Scholar self-registration requires an email at this domain (FR-001).' })}
        <button class="btn primary">Save settings</button></form>
      <form class="card card-pad" data-dept novalidate><h2 style="margin-bottom:14px">Departments</h2><div data-form-error hidden></div>
        <ul style="margin:0 0 16px;padding-left:18px">${state.meta.departments.map(d => html`<li>${d.name} <span class="muted small">(${d.code})</span></li>`)}</ul>
        <div class="fields-2">${field('code', 'Code', html`<input id="f-code" name="code" placeholder="e.g. CIV">`)}${field('name', 'Name', html`<input id="f-name" name="name" placeholder="e.g. Civil Engineering">`)}</div>
        <button class="btn">${icon('plus')} Add department</button></form>
    </div>`);
  $('[data-settings]', main).addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await busy($('button', e.target), () => api.put('/admin/settings', Object.fromEntries(new FormData(e.target))));
      state.meta = await api.get('/meta');
      toast('Settings saved.', 'ok');
    } catch (err) { showErrors(e.target, err); }
  });
  $('[data-dept]', main).addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await busy($('button', e.target), () => api.post('/admin/departments', Object.fromEntries(new FormData(e.target))));
      state.meta = await api.get('/meta');
      toast('Department added.', 'ok'); render();
    } catch (err) { showErrors(e.target, err); }
  });
}
