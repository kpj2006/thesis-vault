// Rendering helpers: an escaping html`` template, formatting, toasts, modals and form error display.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = v => v == null || v === false ? '' : v instanceof Raw ? v.s
  : Array.isArray(v) ? v.map(escape).join('') : String(v).replace(/[&<>"']/g, c => ESC[c]);
export const html = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? escape(vals[i]) : ''), ''));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- Icons (inline SVG, stroke-based) ----
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  check: 'M20 6 9 17l-5-5',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  chart: 'M3 3v18h18M7 15v3m5-8v8m5-12v12',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  vault: 'M4 4h16v16H4zM12 8v8M8 12h8M4 9h2M4 15h2',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  alert: 'M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-6v-4m0-4h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-16v6l4 2',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  x: 'M18 6 6 18M6 6l12 12',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
};
export const icon = (name, cls = '') => raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.info}"/></svg>`);

// ---- Formatting ----
const toDate = s => s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') : null;
export const fmtDate = s => { const d = toDate(s); return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
export const fmtDateTime = s => { const d = toDate(s); return d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
export const ago = s => {
  const d = toDate(s); if (!d) return '';
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const dd = Math.round(h / 24); if (dd < 30) return `${dd} day${dd > 1 ? 's' : ''} ago`;
  return fmtDate(s);
};
export const fmtSize = b => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;
export const initials = n => (n || '?').replace(/^(Dr|Prof)\.?\s+/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const keywordTags = k => (k || '').split(',').map(s => s.trim()).filter(Boolean).map(t => html`<span class="tag">${t}</span>`);

export const STATUS_CLASS = {
  Draft: 'b-draft', Submitted: 'b-review', UnderGuideReview: 'b-review', RevisionRequired: 'b-revision',
  UnderCommitteeReview: 'b-committee', Approved: 'b-approved', Rejected: 'b-rejected', Catalogued: 'b-catalogued', Published: 'b-published',
};
export const STATUS_TEXT = {
  Draft: 'Draft', Submitted: 'Submitted', UnderGuideReview: 'Under Guide Review', RevisionRequired: 'Revision Required',
  UnderCommitteeReview: 'Under Committee Review', Approved: 'Approved', Rejected: 'Rejected', Catalogued: 'Catalogued', Published: 'Published',
};
export const statusBadge = s => html`<span class="badge ${STATUS_CLASS[s] || ''}">${STATUS_TEXT[s] || s}</span>`;

export const similarityBadge = (score, threshold) => score == null ? html`<span class="muted">—</span>`
  : html`<span class="badge plain ${score >= threshold ? 'b-bad' : 'b-ok'}">${score}%</span>`;

// Workflow stepper following the Lab 5 state diagram.
const FLOW = [['Draft', 'Draft'], ['UnderGuideReview', 'Guide review'], ['UnderCommitteeReview', 'Committee review'], ['Approved', 'Approved'], ['Catalogued', 'Catalogued'], ['Published', 'Published']];
export function stepper(status, { rejectedAt } = {}) {
  const pos = { Draft: 0, Submitted: 1, UnderGuideReview: 1, RevisionRequired: 1, UnderCommitteeReview: 2, Approved: 3, Catalogued: 4, Published: 5 };
  const cur = status === 'Rejected' ? (rejectedAt ?? 2) : pos[status];
  return html`<div class="stepper" role="list">${FLOW.map(([, label], i) => {
    let cls = i < cur ? 'done' : i === cur ? 'current' : '';
    let text = label;
    if (i === cur && status === 'RevisionRequired') { cls = 'warn'; text = 'Revision required'; }
    if (i === cur && status === 'Rejected') { cls = 'bad'; text = 'Rejected'; }
    if (i === cur && status === 'Published') cls = 'done current';
    return html`<div class="step ${cls}" role="listitem"><span class="pip"></span>${text}</div>`;
  })}</div>`;
}

export const empty = (title, text, action = '') => html`<div class="empty">${icon('inbox')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
export const loading = () => html`<div class="loading" aria-label="Loading"></div>`;

// ---- Toasts & modals ----
export function toast(message, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6500 : 4000);
}

export function modal(title, body, { onMount, onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = String(html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="card-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="card-body">${body}</div></div>`);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  bg.querySelector('input, select, textarea, button:not([data-close])')?.focus();
  onMount?.(bg.querySelector('.modal'), close);
  return close;
}

export function confirmDialog(title, message, { confirmText = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let ok = false;
    modal(title, html`<p>${message}</p><div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirmText}</button></div>`, {
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', () => { ok = true; close(); }),
      onClose: () => resolve(ok),
    });
  });
}

// ---- Forms ----
export function clearErrors(form) {
  $$('.field.invalid', form).forEach(f => f.classList.remove('invalid'));
  $$('[data-form-error]', form).forEach(e => { e.hidden = true; e.innerHTML = ''; });
}

// Highlights fields named in an API error (wireframe §2.5: "highlight mandatory fields").
export function showErrors(form, err) {
  clearErrors(form);
  let first = null;
  for (const [name, msg] of Object.entries(err.fields || {})) {
    const input = form.querySelector(`[name="${name}"]`);
    const field = input?.closest('.field') || form.querySelector(`[data-field="${name}"]`);
    if (!field) continue;
    field.classList.add('invalid');
    const e = field.querySelector('.err'); if (e) e.textContent = msg;
    first ??= input;
  }
  const box = form.querySelector('[data-form-error]');
  if (box) { box.hidden = false; box.innerHTML = String(html`<div class="alert bad">${icon('alert')}<div>${err.message}</div></div>`); }
  else toast(err.message, 'bad');
  first?.focus();
}

export async function busy(btn, fn) {
  btn?.classList.add('busy');
  try { return await fn(); } finally { btn?.classList.remove('busy'); }
}

export const field = (name, label, input, { required, help } = {}) => html`
  <div class="field"><label for="f-${name}" class="${required ? 'req' : ''}">${label}</label>${input}
  ${help ? html`<div class="help">${help}</div>` : ''}<div class="err"></div></div>`;

export const options = (list, selected, { blank } = {}) => html`${blank ? html`<option value="">${blank}</option>` : ''}${list.map(o => {
  const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.id, o.name] : [o, o];
  return html`<option value="${v}" ${String(v) === String(selected ?? '') ? raw('selected') : ''}>${l}</option>`;
})}`;

// Drag-and-drop PDF picker used on the submission and revision screens.
export function bindDrop(root, onFile) {
  const drop = $('.drop', root);
  if (!drop) return;
  const input = $('input[type=file]', drop);
  const show = f => {
    $('.fname', drop).textContent = f ? `${f.name} · ${fmtSize(f.size)}` : '';
    onFile?.(f);
  };
  drop.addEventListener('click', e => { if (e.target !== input) input.click(); });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => show(input.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; show(f); }
  });
}

export const dropZone = (hint = 'PDF only · Maximum 50 MB') => html`
  <div class="drop" tabindex="0" role="button" aria-label="Choose PDF file">
    ${icon('upload')}<div><b>Click to choose</b> or drag your thesis PDF here</div>
    <div class="small muted">${hint}</div><div class="fname"></div>
    <input type="file" name="file" accept="application/pdf,.pdf">
  </div>`;
