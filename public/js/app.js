import { api } from './api.js';
import { html, icon, initials, $, $$, toast, loading } from './ui.js';

export const state = { user: null, meta: null, unread: 0 };

// ---- Routing -----------------------------------------------------------------
const ALL = ['scholar', 'supervisor', 'examiner', 'librarian', 'admin', 'institute'];
const routes = [
  ['/login', () => import('./views/auth.js').then(m => m.login), { guest: true }],
  ['/register', () => import('./views/auth.js').then(m => m.register), { guest: true }],
  ['/dashboard', () => import('./views/dashboard.js').then(m => m.dashboard), { roles: ALL }],
  ['/theses', () => import('./views/scholar.js').then(m => m.myTheses), { roles: ['scholar'] }],
  ['/submit', () => import('./views/scholar.js').then(m => m.submitForm), { roles: ['scholar'] }],
  ['/submit/:id', () => import('./views/scholar.js').then(m => m.submitForm), { roles: ['scholar'] }],
  ['/thesis/:id/revise', () => import('./views/scholar.js').then(m => m.reviseForm), { roles: ['scholar'] }],
  ['/thesis/:id', () => import('./views/thesis.js').then(m => m.thesisPage), { public: true }],
  ['/reviews', () => import('./views/review.js').then(m => m.reviewQueue), { roles: ['supervisor', 'examiner'] }],
  ['/review/:id', () => import('./views/review.js').then(m => m.reviewPage), { roles: ['supervisor', 'examiner'] }],
  ['/catalogue', () => import('./views/catalogue.js').then(m => m.catalogueQueue), { roles: ['librarian', 'admin'] }],
  ['/catalogue/:id', () => import('./views/catalogue.js').then(m => m.cataloguePage), { roles: ['librarian', 'admin'] }],
  ['/repository', () => import('./views/repository.js').then(m => m.repository), { public: true }],
  ['/notifications', () => import('./views/notifications.js').then(m => m.notifications), { roles: ALL }],
  ['/account', () => import('./views/notifications.js').then(m => m.account), { roles: ALL }],
  ['/admin/users', () => import('./views/admin.js').then(m => m.users), { roles: ['admin'] }],
  ['/admin/theses', () => import('./views/admin.js').then(m => m.theses), { roles: ['admin'] }],
  ['/admin/audit', () => import('./views/admin.js').then(m => m.audit), { roles: ['admin'] }],
  ['/admin/settings', () => import('./views/admin.js').then(m => m.settings), { roles: ['admin'] }],
  ['/reports', () => import('./views/reports.js').then(m => m.reports), { roles: ['admin', 'institute'] }],
].map(([pattern, load, opts]) => ({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), load, ...opts }));

export const go = path => { if (location.hash !== '#' + path) location.hash = path; else render(); };
const currentPath = () => (location.hash.slice(1) || '/').split('?')[0];
export const query = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  let path = currentPath();
  if (path === '/') path = state.user ? '/dashboard' : '/repository';
  const route = routes.find(r => r.re.test(path));
  const params = route ? path.match(route.re).groups || {} : {};

  if (!route) return shell(html`<div class="empty">${icon('alert')}<h3>Page not found</h3><p><a href="#/">Go to the start page</a></p></div>`, path);
  if (route.guest) {
    if (state.user) return go('/dashboard');
    const view = await route.load();
    return view($('#app'), params);
  }
  if (!route.public && !state.user) return go('/login');
  if (route.roles && !route.roles.includes(state.user.role)) {
    return shell(html`<div class="empty">${icon('lock')}<h3>Access denied</h3><p>Your role does not have access to this page.</p></div>`, path);
  }
  const main = shell(loading(), path);
  try {
    const view = await route.load();
    if (seq !== renderSeq) return;
    await view(main, params);
    main.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    const denied = err.status === 403;
    main.innerHTML = String(html`<div class="empty">${icon(denied ? 'lock' : 'alert')}<h3>${denied ? 'Access denied' : err.status === 404 ? 'Not found' : 'Something went wrong'}</h3><p>${err.message}</p></div>`);
    if (!err.status) console.error(err);
  }
}

// ---- Shell -------------------------------------------------------------------
const NAV = {
  scholar: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/theses', 'My Theses', 'file'], ['/submit', 'Submit Thesis', 'upload']]]],
  supervisor: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/reviews', 'Review Queue', 'inbox']]]],
  examiner: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/reviews', 'Evaluation Queue', 'inbox']]]],
  librarian: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/catalogue', 'Cataloguing', 'book']]]],
  admin: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/reports', 'Reports', 'chart']]],
    ['Administration', [['/admin/users', 'Users & Roles', 'users'], ['/admin/theses', 'Thesis Oversight', 'list'], ['/catalogue', 'Cataloguing', 'book'], ['/admin/audit', 'Audit Log', 'shield'], ['/admin/settings', 'Settings', 'settings']]]],
  institute: [['Workspace', [['/dashboard', 'Dashboard', 'home'], ['/reports', 'Research Reports', 'chart']]]],
};

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

function shell(content, path) {
  const u = state.user;
  const groups = u ? [...NAV[u.role], ['Library', [['/repository', 'Repository', 'search'], ['/notifications', 'Notifications', 'bell']]]]
    : [['Library', [['/repository', 'Repository', 'search']]]];
  const active = p => path === p || (p !== '/dashboard' && path.startsWith(p + '/'));
  $('#app').innerHTML = String(html`
    <div class="shell">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="#/"><span class="brand-mark">${icon('vault')}</span>
          <span><span class="brand-name">Thesis Vault</span><div class="brand-sub">LNMIIT Jaipur</div></span></a>
        ${groups.map(([label, links]) => html`<div class="nav-label">${label}</div><nav class="nav">${links.map(([href, text, ic]) => html`
          <a href="#${href}" class="${active(href) ? 'active' : ''}">${icon(ic)}${text}
          ${href === '/notifications' && state.unread ? html`<span class="count">${state.unread}</span>` : ''}</a>`)}</nav>`)}
        <div class="sidebar-foot">${u ? html`Signed in as <b>${u.roleLabel}</b>` : html`<a class="btn primary" style="width:100%" href="#/login">Sign in</a>`}</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" data-menu aria-label="Open navigation">${icon('menu')}</button>
          <form data-search role="search"><label class="sr-only" for="global-q">Search the repository</label>${icon('search')}
            <input id="global-q" name="q" placeholder="Search published theses by title, author, keyword or full text" autocomplete="off"></form>
          <span class="spacer"></span>
          <button class="icon-btn" data-theme-toggle aria-label="Toggle dark mode">${icon(isDark() ? 'sun' : 'moon')}</button>
          ${u ? html`
            <a class="icon-btn" href="#/notifications" aria-label="Notifications (${state.unread} unread)">${icon('bell')}${state.unread ? html`<span class="dot">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}</a>
            <a class="user-chip" href="#/account"><span class="avatar">${initials(u.name)}</span><span class="who"><b>${u.name}</b><span>${u.roleLabel}</span></span></a>
            <button class="icon-btn" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button>`
          : html`<a class="btn primary" href="#/login">Sign in</a>`}
        </header>
        <main class="content" id="main" tabindex="-1">${content}</main>
      </div>
    </div>`);

  const shellEl = $('.shell');
  $('[data-menu]')?.addEventListener('click', () => shellEl.classList.toggle('nav-open'));
  $$('.nav a').forEach(a => a.addEventListener('click', () => shellEl.classList.remove('nav-open')));
  $('[data-search]').addEventListener('submit', e => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    go(`/repository${q ? '?q=' + encodeURIComponent(q) : ''}`);
  });
  $('[data-logout]')?.addEventListener('click', async () => {
    await api.post('/auth/logout');
    state.user = null;
    toast('You have been signed out.');
    go('/login');
  });
  $('[data-theme-toggle]').addEventListener('click', () => {
    const dark = !isDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('tv-theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    render();
  });
  return $('#main');
}

export async function refreshUnread() {
  if (!state.user) return;
  try {
    const { unread } = await api.get('/auth/me');
    if (unread !== state.unread) {
      state.unread = unread;
      $$('[href="#/notifications"]').forEach(a => {
        const badge = a.querySelector('.dot, .count');
        if (unread && badge) badge.textContent = unread;
        else if (!unread) badge?.remove();
        else a.insertAdjacentHTML('beforeend', a.classList.contains('icon-btn') ? `<span class="dot">${unread}</span>` : `<span class="count">${unread}</span>`);
      });
    }
  } catch { /* offline; try again later */ }
}

export async function setUser(user) {
  state.user = user;
  if (user) await refreshUnread();
}

// ---- Boot --------------------------------------------------------------------
async function boot() {
  try { const t = localStorage.getItem('tv-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  try {
    const [me, meta] = await Promise.all([api.get('/auth/me'), api.get('/meta')]);
    state.user = me.user; state.unread = me.unread || 0; state.meta = meta;
  } catch (err) {
    $('#app').innerHTML = String(html`<div class="empty">${icon('alert')}<h3>Thesis Vault is unavailable</h3><p>${err.message}</p></div>`);
    return;
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('tv:unauthorized', () => { if (state.user) { state.user = null; toast('Your session has expired. Please sign in again.', 'bad'); go('/login'); } });
  setInterval(refreshUnread, 45000);
  render();
}

export { render };
boot();
