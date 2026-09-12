// Small view helpers. Views return HTML strings and declare behaviour with
// data-act attributes; the shell delegates the clicks. No framework, nothing to
// download, and the whole app still fits in a service-worker cache.

import { esc, html, naira, raw } from '../util.js';

export { html, esc, raw };

export function card(inner, opts = {}) {
  return `<section class="card ${opts.tight ? 'tight' : ''} ${opts.cls || ''}">${inner}</section>`;
}

export function cardHead(title, right = '') {
  return `<div class="card-head"><h2>${esc(title)}</h2>${right}</div>`;
}

export function stat(label, value, sub = '') {
  return `<div class="stat"><div class="k">${esc(label)}</div><div class="v">${value}</div>`
    + (sub ? `<div class="s">${sub}</div>` : '') + '</div>';
}

export function note(kind, title, body = '') {
  return `<div class="note ${kind}">${title ? `<b>${esc(title)}</b>` : ''}${body}</div>`;
}

export function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

export function bar(fraction, cls = '') {
  const pctWidth = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
  return `<div class="bar ${cls}"><span style="width:${pctWidth.toFixed(0)}%"></span></div>`;
}

export function empty(icon, title, body = '', action = '') {
  return `<div class="empty"><span class="big">${icon}</span><b>${esc(title)}</b>`
    + (body ? `<p>${esc(body)}</p>` : '') + action + '</div>';
}

export function field(label, control, hint = '') {
  return `<div class="field"><label>${esc(label)}</label>${control}`
    + (hint ? `<div class="hint">${esc(hint)}</div>` : '') + '</div>';
}

export function input(name, opts = {}) {
  const attrs = [
    `name="${esc(name)}"`,
    `type="${esc(opts.type || 'text')}"`,
    opts.value != null ? `value="${esc(opts.value)}"` : '',
    opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : '',
    opts.min != null ? `min="${esc(opts.min)}"` : '',
    opts.max != null ? `max="${esc(opts.max)}"` : '',
    opts.step != null ? `step="${esc(opts.step)}"` : '',
    opts.required ? 'required' : '',
    opts.inputmode ? `inputmode="${esc(opts.inputmode)}"` : '',
    opts.autofocus ? 'autofocus' : '',
  ].filter(Boolean).join(' ');
  return `<input ${attrs}>`;
}

export function textarea(name, opts = {}) {
  return `<textarea name="${esc(name)}" rows="${Number(opts.rows) || 3}" `
    + `placeholder="${esc(opts.placeholder || '')}">${esc(opts.value || '')}</textarea>`;
}

export function select(name, options, value = '', opts = {}) {
  const body = options.map((o) => {
    const val = o.value !== undefined ? o.value : o;
    const text = o.label !== undefined ? o.label : o;
    return `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
  }).join('');
  return `<select name="${esc(name)}" ${opts.required ? 'required' : ''}>`
    + (opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : '')
    + body + '</select>';
}

export function button(text, act, opts = {}) {
  const data = Object.entries(opts.data || {})
    .map(([k, v]) => `data-${esc(k)}="${esc(v)}"`).join(' ');
  return `<button type="${opts.type || 'button'}" class="${opts.cls || ''}" data-act="${esc(act)}" ${data}`
    + `${opts.disabled ? ' disabled' : ''}>${opts.icon ? `<span>${opts.icon}</span>` : ''}${esc(text)}</button>`;
}

export function link(text, href, opts = {}) {
  // Anything leaving the app opens in its own tab, so a half-finished entry on
  // the screen behind it is not lost.
  const away = opts.newTab ? ' target="_blank" rel="noopener"' : '';
  return `<a class="btn ${opts.cls || ''}" href="${esc(href)}"${away}>${opts.icon ? `<span>${opts.icon}</span>` : ''}${esc(text)}</a>`;
}

export function tick(id, label, sub = '', on = false) {
  return `<label class="tick ${on ? 'on' : ''}" data-act="toggle-tick" data-id="${esc(id)}">`
    + `<span class="box">✓</span><span class="txt"><b>${esc(label)}</b>`
    + (sub ? `<span class="pid">${esc(sub)}</span>` : '') + '</span></label>';
}

export function money(n) { return naira(n); }

export function table(headers, rows, opts = {}) {
  const head = headers.map((h) => {
    const label = typeof h === 'string' ? h : h.label;
    const num = typeof h === 'object' && h.num;
    return `<th class="${num ? 'num' : ''}">${esc(label)}</th>`;
  }).join('');
  const body = rows.map((r) => '<tr>' + r.map((cel, i) => {
    const num = typeof headers[i] === 'object' && headers[i].num;
    return `<td class="${num ? 'num' : ''}">${cel && cel.__raw ? cel.__raw : esc(cel)}</td>`;
  }).join('') + '</tr>').join('');
  return `<div class="table-wrap"><table>${opts.noHead ? '' : `<thead><tr>${head}</tr></thead>`}`
    + `<tbody>${body}</tbody></table></div>`;
}

export function spark(values, opts = {}) {
  const max = Math.max(1, ...values.map((v) => Math.abs(Number(v.value ?? v) || 0)));
  return '<div class="spark">' + values.map((v) => {
    const value = Number(v.value ?? v) || 0;
    const h = Math.max(2, (Math.abs(value) / max) * 100);
    const dim = v.dim ? 'dim' : '';
    const title = v.label ? ` title="${esc(v.label)}"` : '';
    return `<i class="${dim}" style="height:${h.toFixed(0)}%"${title}></i>`;
  }).join('') + '</div>' + (opts.caption ? `<small>${esc(opts.caption)}</small>` : '');
}

// --- Overlays -------------------------------------------------------------

let sheetEl = null;

export function openSheet(innerHtml) {
  closeSheet();
  sheetEl = document.createElement('div');
  sheetEl.className = 'sheet-back';
  sheetEl.innerHTML = `<div class="sheet"><div class="grabber"></div>${innerHtml}</div>`;
  sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeSheet(); });
  document.body.appendChild(sheetEl);
  const focusable = sheetEl.querySelector('input, select, textarea, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);
  return sheetEl;
}

export function closeSheet() {
  if (sheetEl && sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl);
  sheetEl = null;
}

export function sheetOpen() { return !!sheetEl; }

let toastTimer = null;
export function toast(message, bad = false) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = `toast ${bad ? 'bad' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 5200 : 2800);
}

export function confirmSheet(title, body, confirmLabel = 'Yes, do it') {
  return new Promise((resolve) => {
    const el = openSheet(
      `<h2>${esc(title)}</h2><p>${esc(body)}</p>`
      + '<div class="row"><button class="btn-ghost btn-block" data-role="no">Cancel</button>'
      + `<button class="btn-danger btn-block" data-role="yes">${esc(confirmLabel)}</button></div>`,
    );
    el.querySelector('[data-role="yes"]').onclick = () => { closeSheet(); resolve(true); };
    el.querySelector('[data-role="no"]').onclick = () => { closeSheet(); resolve(false); };
  });
}

/** Read a form inside a container into a plain object. */
export function readForm(container) {
  const out = {};
  for (const el of container.querySelectorAll('input,select,textarea')) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}
