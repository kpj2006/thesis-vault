import { api } from '../api.js';
import { html, icon, $, field, options, showErrors, busy, toast } from '../ui.js';
import { state, setUser, go } from '../app.js';

const art = () => html`
  <section class="auth-art">
    <a class="brand" href="#/repository"><span class="brand-mark">${icon('vault')}</span>
      <span><span class="brand-name">Thesis Vault</span><div class="brand-sub" style="color:#9fb0c8">LNMIIT Jaipur</div></span></a>
    <div>
      <h1>One home for every thesis, from first draft to the archive.</h1>
      <p>Submit your work, follow it through guide and committee review, and find past research in the institute's searchable repository.</p>
      <ul>
        <li>${icon('upload')} Online submission with structured metadata</li>
        <li>${icon('shield')} Similarity check before any approval</li>
        <li>${icon('history')} Every revision kept in the version history</li>
        <li>${icon('search')} Full-text search across archived theses</li>
      </ul>
    </div>
    <p class="small" style="color:#8ea0bb">${state.meta?.institute || ''}</p>
  </section>`;

const DEMO = [
  ['Scholar', 'scholar@lnmiit.ac.in'], ['Guide', 'guide@lnmiit.ac.in'], ['Examiner', 'examiner@lnmiit.ac.in'],
  ['Librarian', 'librarian@lnmiit.ac.in'], ['Admin', 'admin@lnmiit.ac.in'], ['Institute', 'dean.research@lnmiit.ac.in'],
];

export function login(root) {
  root.innerHTML = String(html`<div class="auth">${art()}
    <section class="auth-form"><div class="card">
      <h2>Sign in</h2><p class="muted">Use your institutional account.</p>
      <form novalidate style="margin-top:20px">
        <div data-form-error hidden></div>
        ${field('email', 'Email', html`<input id="f-email" name="email" type="email" autocomplete="username" required>`)}
        ${field('password', 'Password', html`<input id="f-password" name="password" type="password" autocomplete="current-password" required>`)}
        <button class="btn primary" style="width:100%" type="submit">Sign in</button>
      </form>
      <p class="small muted" style="margin-top:16px">New research scholar? <a href="#/register">Create an account</a> · <a href="#/repository">Browse the repository</a></p>
      <div class="demo-accounts">
        <div class="small muted" style="margin-bottom:8px">Demo accounts (password <span class="mono">Password@123</span>):</div>
        <div class="row">${DEMO.map(([l, e]) => html`<button type="button" class="btn small" data-demo="${e}">${l}</button>`)}</div>
      </div>
    </div></section></div>`);

  const form = $('form', root);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    try {
      const { user } = await busy(btn, () => api.post('/auth/login', { email: form.email.value, password: form.password.value }));
      await setUser(user);
      toast(`Welcome back, ${user.name}.`, 'ok');
      go('/dashboard');
    } catch (err) { showErrors(form, err); }
  });
  root.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    form.email.value = b.dataset.demo; form.password.value = 'Password@123';
    form.requestSubmit();
  }));
  form.email.focus();
}

export function register(root) {
  const { departments, domain } = state.meta;
  root.innerHTML = String(html`<div class="auth">${art()}
    <section class="auth-form"><div class="card">
      <h2>Create scholar account</h2>
      <p class="muted">Staff accounts (guides, examiners, librarians) are created by the administrator.</p>
      <form novalidate style="margin-top:20px">
        <div data-form-error hidden></div>
        ${field('name', 'Full name', html`<input id="f-name" name="name" autocomplete="name">`, { required: true })}
        ${field('email', 'Institutional email', html`<input id="f-email" name="email" type="email" placeholder="you@${domain}" autocomplete="email">`, { required: true, help: `Must end with @${domain}` })}
        <div class="fields-2">
          ${field('roll_number', 'Roll / enrolment no.', html`<input id="f-roll_number" name="roll_number">`, { required: true })}
          ${field('department_id', 'Department', html`<select id="f-department_id" name="department_id">${options(departments, '', { blank: 'Select…' })}</select>`, { required: true })}
        </div>
        ${field('password', 'Password', html`<input id="f-password" name="password" type="password" autocomplete="new-password">`, { required: true, help: 'At least 8 characters, including letters and numbers.' })}
        <button class="btn primary" style="width:100%" type="submit">Create account</button>
      </form>
      <p class="small muted" style="margin-top:16px">Already registered? <a href="#/login">Sign in</a></p>
    </div></section></div>`);

  const form = $('form', root);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(form));
      const { user } = await busy($('button[type=submit]', form), () => api.post('/auth/register', body));
      await setUser(user);
      toast('Account created. An administrator will assign your Supervisor/Guide.', 'ok');
      go('/dashboard');
    } catch (err) { showErrors(form, err); }
  });
}
