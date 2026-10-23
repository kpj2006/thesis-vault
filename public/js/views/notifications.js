import { api } from '../api.js';
import { html, icon, $, ago, fmtDateTime, empty, field, showErrors, busy, toast } from '../ui.js';
import { refreshUnread } from '../app.js';

const TYPE_ICON = { STATUS_CHANGE: 'history', ASSIGNMENT: 'users', ACTION_REQUIRED: 'alert' };

export async function notifications(main) {
  const { notifications: list } = await api.get('/notifications');
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>Notifications</h1><p>Status changes, assignments and review outcomes (BR-009).</p></div>
      ${list.some(n => !n.is_read) ? html`<button class="btn" data-read-all>${icon('check')} Mark all as read</button>` : ''}</div>
    <div class="card">${list.length ? list.map(n => html`
      <div class="result" style="display:flex;gap:14px;align-items:flex-start;${n.is_read ? '' : 'background:var(--brand-soft)'}" data-id="${n.id}">
        <span class="avatar" style="background:var(--surface-2);color:var(--brand)">${icon(TYPE_ICON[n.type] || 'bell')}</span>
        <div style="flex:1;min-width:0"><div>${n.message}</div>
          <div class="small muted" style="margin-top:4px" title="${fmtDateTime(n.created_at)}">${ago(n.created_at)}${n.thesis_id ? html` · <a href="#/thesis/${n.thesis_id}" data-open="${n.id}">Open thesis</a>` : ''}</div></div>
        ${n.is_read ? '' : html`<button class="btn small ghost" data-read="${n.id}">Mark read</button>`}
      </div>`) : empty('No notifications', 'You will be notified when something needs your attention.')}</div>`);

  const markRead = async id => { await api.post(`/notifications/${id}/read`); await refreshUnread(); };
  main.querySelectorAll('[data-read]').forEach(b => b.addEventListener('click', async () => {
    await markRead(b.dataset.read);
    const row = b.closest('[data-id]'); row.style.background = ''; b.remove();
  }));
  main.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', () => markRead(a.dataset.open)));
  $('[data-read-all]', main)?.addEventListener('click', async () => {
    await api.post('/notifications/read-all'); await refreshUnread(); notifications(main);
  });
}

export async function account(main) {
  const { user: u } = await api.get('/auth/me');
  main.innerHTML = String(html`
    <div class="page-head"><div><h1>My account</h1><p>${u.roleLabel}</p></div></div>
    <div class="grid grid-2">
      <div class="card card-pad"><h2>Profile</h2><dl class="kv" style="margin-top:12px">
        <dt>Name</dt><dd>${u.name}</dd><dt>Email</dt><dd>${u.email}</dd><dt>Role</dt><dd>${u.roleLabel}</dd>
        <dt>Department</dt><dd>${u.department || '—'}</dd>
        ${u.role === 'scholar' ? html`<dt>Roll number</dt><dd>${u.roll_number || '—'}</dd><dt>Supervisor</dt><dd>${u.guide_name || html`<span class="muted">Not yet assigned</span>`}</dd>` : ''}
        ${u.specialization ? html`<dt>Specialization</dt><dd>${u.specialization}</dd>` : ''}
        <dt>Member since</dt><dd>${fmtDateTime(u.created_at)}</dd></dl>
        <p class="small muted" style="margin-top:14px">Profile details and roles are managed by the administrator (BR-007).</p></div>
      <form class="card card-pad" novalidate><h2 style="margin-bottom:14px">Change password</h2><div data-form-error hidden></div>
        ${field('current', 'Current password', html`<input id="f-current" name="current" type="password" autocomplete="current-password">`, { required: true })}
        ${field('next', 'New password', html`<input id="f-next" name="next" type="password" autocomplete="new-password">`, { required: true, help: 'At least 8 characters with letters and numbers.' })}
        <button class="btn primary">Update password</button></form>
    </div>`);
  const form = $('form', main);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await busy($('button', form), () => api.post('/auth/password', Object.fromEntries(new FormData(form)))); form.reset(); toast('Password updated.', 'ok'); }
    catch (err) { showErrors(form, err); }
  });
}
