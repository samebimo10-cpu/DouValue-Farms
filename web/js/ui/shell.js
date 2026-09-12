// The frame: who is signed in, which screen is showing, and the plumbing that
// turns a tap into an event in the log.

import { can, ROLES } from '../store.js';
import { getLang, LANGS, setLang, t } from '../i18n.js';
import {
  badge, button, closeSheet, empty, esc, field, initials, input, openSheet, readForm, sheetOpen, toast,
} from './kit.js';
import { configure, getStatus, onStatus, readInviteCode, statusLine, syncNow, testConnection } from '../sync.js';
import { isoDate } from '../util.js';

const routes = new Map();
let ctx = null;
let currentRoute = null;

export function registerRoute(hash, view) { routes.set(hash, view); }

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

export function params() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

function routeKey() {
  return (location.hash.split('?')[0] || '#/today') || '#/today';
}

// --- PIN handling ---------------------------------------------------------
// This separates roles on a shared farm phone. It is a workplace control, not
// protection against someone determined who has the handset: anyone who can
// open the browser's storage can read the log. Keep payroll on the manager's
// own phone and treat the PIN as a way to stop accidental entries under the
// wrong name.

export async function hashPin(pin, salt = 'douvalue') {
  const text = `${salt}:${pin}`;
  try {
    if (globalThis.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  let h = 0;
  for (let i = 0; i < text.length; i++) { h = ((h << 5) - h + text.charCodeAt(i)) | 0; }
  return `plain${h}`;
}

// --- Login ----------------------------------------------------------------

let pending = { personId: null, pin: '' };

function loginScreen(state) {
  const people = Object.values(state.people).filter((p) => p.active !== false);
  if (!people.length) return firstRunScreen(state);

  if (!pending.personId) {
    return brandMark(state)
      + `<div class="card"><h2>${esc(t('login.who'))}</h2><div class="people-grid">`
      + people.map((p) => `<div class="person-tile" data-act="pick-person" data-id="${esc(p.id)}">`
        + `<div class="av">${esc(initials(p.name))}</div><b>${esc(p.name)}</b>`
        + `<small>${esc(ROLES[p.role]?.name || p.role)}</small></div>`).join('')
      + '</div></div>';
  }

  const person = state.people[pending.personId];
  const dots = [0, 1, 2, 3].map((i) => `<span class="${i < pending.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  return `<div class="card"><div class="row"><div class="av" style="width:44px;height:44px;border-radius:50%;`
    + `background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:800">`
    + `${esc(initials(person.name))}</div><div class="grow"><b>${esc(person.name)}</b><br>`
    + `<small>${esc(ROLES[person.role]?.name || '')}</small></div></div>`
    + `<p style="margin-top:12px">${esc(t('login.pin'))}</p>`
    + `<div class="pin-dots">${dots}</div>`
    + '<div class="pin-pad">'
    + keys.map((k) => {
      if (k === 'back') return button('⌫', 'pin-back', { cls: 'btn-quiet' });
      if (k === 'ok') return button('✓', 'pin-ok', {});
      return `<button type="button" data-act="pin-key" data-key="${k}">${k}</button>`;
    }).join('')
    + '</div>'
    + `<div style="margin-top:14px">${button(t('login.back'), 'pin-cancel', { cls: 'btn-ghost btn-block' })}</div>`
    + '</div>';
}

/** The company mark, shown on the screens people see before they are signed in. */
function brandMark(state) {
  return '<div class="brandmark">'
    + '<picture><source srcset="img/logo.webp" type="image/webp"><img src="img/logo.jpg" alt="DouValue Farms Limited" width="502" height="518"></picture>'
    + `<p class="brandmark-where">${esc(state?.settings?.location || 'Port Harcourt, Rivers State')}</p>`
    + '</div>';
}

function firstRunScreen(state) {
  return brandMark(state)
    + '<div class="card"><h1>Set up the farm</h1>'
    + '<p>This phone has no accounts yet. The first account is the <b>CEO</b>, the owner of the '
    + 'farm. From there you appoint the farm manager, and the manager takes on supervisors and '
    + 'farm hands.</p>'
    + '<form data-act="first-run">'
    + '<div class="field"><label>Your name</label>'
    + '<input name="name" required placeholder="e.g. Ebimo Sam" autocomplete="name"></div>'
    + '<div class="field"><label>Choose a 4-digit PIN</label>'
    + '<input name="pin" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="0000">'
    + '<div class="hint">You type this to sign in. Do not use 1234 or your year of birth.</div></div>'
    + '<div class="field"><label>Farm name</label><input name="farmName" value="DouValue Farms Limited"></div>'
    + '<button class="btn-block btn-lg" type="submit">Create the CEO account</button>'
    + '</form>'
    + '<p style="margin-top:16px"><small>Records are kept on this phone and work with no network. '
    + 'Once you are in, set up Sync under Settings and every phone on the farm stays in step '
    + 'automatically whenever it finds signal.</small></p>'
    + '</div>'
    + '<div class="card tight">'
    + '<b>Joining a farm that already exists?</b>'
    + '<p><small>If the CEO has already set this farm up on another phone, paste the join code '
    + 'they gave you instead of creating a new farm.</small></p>'
    + button('Join with a code', 'open-join', { cls: 'btn-ghost btn-block' })
    + '</div>'
    + '<div class="card tight">'
    + button('Load a sample farm to look around', 'load-sample', { cls: 'btn-quiet btn-block' })
    + '<p style="margin:8px 0 0"><small>Fills the app with an example farm so you can see how it '
    + 'works. Erase it from Settings before you start recording real work.</small></p>'
    + '</div>';
}

// --- Chrome ---------------------------------------------------------------

function tabsFor(user) {
  const all = [
    { hash: '#/today', icon: '📋', key: 'nav.today', perm: 'viewOwnTasks' },
    { hash: '#/field', icon: '🌱', key: 'nav.field', perm: 'viewGuide' },
    { hash: '#/clinic', icon: '🔍', key: 'nav.clinic', perm: 'diagnose' },
    { hash: '#/store', icon: '📦', key: 'nav.store', perm: 'logInputs' },
    { hash: '#/dashboard', icon: '📊', key: 'nav.dashboard', perm: 'viewReports' },
    { hash: '#/settings', icon: '⚙️', key: 'nav.settings', perm: 'settings' },
  ];
  return all.filter((tab) => can(user, tab.perm));
}

function chrome(user, state, body) {
  const lang = getLang();
  const tabs = tabsFor(user);
  const here = routeKey();
  const sync = statusLine();
  return '<header class="topbar">'
    + '<img class="topbar-mark" src="img/mark.jpg" alt="" width="256" height="256">'
    + `<div class="brand">${esc(state.settings.farmName)}<small>${esc(state.settings.location)}</small></div>`
    + '<div class="spacer"></div>'
    + `<button data-act="toggle-lang" title="Language">${lang === 'pcm' ? 'Pidgin' : 'English'}</button>`
    + `<button data-act="open-account" title="Account">${esc(initials(user.name))}</button>`
    + '</header>'
    + `<div class="syncbar ${esc(sync.tone)}" data-act="sync-now" role="status">`
    + `<span class="dot"></span><span>${esc(sync.text)}</span></div>`
    + `<main>${body}</main>`
    + '<nav class="tabbar">' + tabs.map((tab) => `<a href="${tab.hash}" class="${here === tab.hash ? 'on' : ''}">`
      + `<span class="ic">${tab.icon}</span>${esc(t(tab.key))}</a>`).join('') + '</nav>';
}

// --- Rendering ------------------------------------------------------------

export function render() {
  const root = document.getElementById('app');
  const state = ctx.store.state;
  const user = ctx.store.user;

  if (!user) { root.innerHTML = loginScreen(state); return; }

  const key = routeKey();
  const view = routes.get(key) || routes.get('#/today');
  if (currentRoute !== key) {
    if (currentRoute && routes.get(currentRoute)?.leave) routes.get(currentRoute).leave(ctx);
    currentRoute = key;
    if (view.enter) view.enter(ctx);
  }

  if (view.perm && !can(user, view.perm)) {
    root.innerHTML = chrome(user, state, `<div class="card">${empty('🔒', 'Not your screen',
      'Ask the manager if you need access to this part of the app.')}</div>`);
    return;
  }

  let body;
  try {
    body = view.render(ctx);
  } catch (err) {
    console.error(err);
    body = `<div class="card"><h2>Something went wrong on this screen</h2>`
      + `<p>${esc(err.message)}</p><p><small>Your records are safe. Go back and try again.</small></p></div>`;
  }
  root.innerHTML = chrome(user, state, body);
  if (view.mounted) view.mounted(ctx);
}

function accountSheet() {
  const user = ctx.store.user;
  const state = ctx.store.state;
  const role = ROLES[user.role];
  return `<h2>${esc(user.name)}</h2><p>${badge(role?.name || user.role)} <small>${esc(role?.blurb || '')}</small></p>`
    + `<p><small>Signed in on this phone. ${esc(state.log.length)} records stored. `
    + `${esc(statusLine().text)}.</small></p>`
    + '<div class="field"><label>Language</label>'
    + Object.entries(LANGS).map(([code, name]) => `<button class="chip ${getLang() === code ? 'on' : ''}" `
      + `data-act="set-lang" data-lang="${code}">${esc(name)}</button>`).join(' ')
    + '</div>'
    + button('Sign out', 'sign-out', { cls: 'btn-ghost btn-block' });
}

// --- Wiring ---------------------------------------------------------------

const shellActions = {
  'pick-person': (c, el) => { pending = { personId: el.dataset.id, pin: '' }; render(); },
  'pin-key': (c, el) => {
    if (pending.pin.length < 4) pending.pin += el.dataset.key;
    if (pending.pin.length === 4) shellActions['pin-ok'](c);
    else render();
  },
  'pin-back': () => { pending.pin = pending.pin.slice(0, -1); render(); },
  'pin-cancel': () => { pending = { personId: null, pin: '' }; render(); },
  'pin-ok': async (c) => {
    const person = c.store.state.people[pending.personId];
    if (!person) { pending = { personId: null, pin: '' }; render(); return; }
    const hash = await hashPin(pending.pin);
    if (person.pinHash && person.pinHash !== hash) {
      pending.pin = '';
      toast(t('login.wrong'), true);
      render();
      return;
    }
    pending = { personId: null, pin: '' };
    c.store.setUser(person);
    sessionStorage.setItem('douvalue.user', person.id);
    navigate(ROLES[person.role]?.home || '#/today');
    render();
  },
  'first-run': async (c, el) => {
    const data = readForm(el);
    if (!/^\d{4}$/.test(String(data.pin || ''))) { toast('PIN must be exactly 4 digits', true); return; }
    if (!String(data.name || '').trim()) { toast('Enter your name', true); return; }
    const id = 'person_ceo';
    await c.store.dispatchMany([
      { type: 'settings.update', payload: { farmName: data.farmName || 'DouValue Farms Limited' } },
      { type: 'person.upsert', payload: {
        id, name: String(data.name).trim(), role: 'ceo', pinHash: await hashPin(data.pin), dailyRate: 0 } },
    ]);
    c.store.setUser(c.store.state.people[id]);
    sessionStorage.setItem('douvalue.user', id);
    navigate('#/dashboard');
    toast('CEO account created. Next: add your farm manager under People.');
  },
  'load-sample': async (c) => {
    const { seedSampleFarm } = await import('../sample.js');
    await seedSampleFarm(c.store);
    toast('Sample farm loaded. Sign in as any of the people shown.');
    render();
  },
  'toggle-lang': (c) => {
    setLang(getLang() === 'en' ? 'pcm' : 'en');
    localStorage.setItem('douvalue.lang', getLang());
    render();
  },
  'set-lang': (c, el) => {
    setLang(el.dataset.lang);
    localStorage.setItem('douvalue.lang', getLang());
    closeSheet();
    render();
  },
  'open-account': async () => {
    const { openSheet } = await import('./kit.js');
    openSheet(accountSheet());
  },
  'sign-out': (c) => {
    closeSheet();
    sessionStorage.removeItem('douvalue.user');
    c.store.setUser(null);
    pending = { personId: null, pin: '' };
    render();
  },
  'sync-now': async () => {
    const s = getStatus();
    if (!s.configured) {
      toast('Sync is not set up yet. The CEO can switch it on under Settings.');
      return;
    }
    toast('Syncing…');
    const result = await syncNow();
    toast(result.ok
      ? `Up to date. Sent ${result.sent}, received ${result.received}.`
      : `Could not sync: ${result.reason}`, !result.ok);
  },

  'open-join': () => {
    openSheet('<h2>Join a farm</h2>'
      + '<p><small>The CEO can show you a join code from Settings, Sync on their phone. '
      + 'Paste the whole code here. This phone will then pull down the farm\'s records and stay '
      + 'in step from now on.</small></p>'
      + '<form data-act="save-join">'
      + field('Join code', '<textarea name="code" placeholder="Paste the code here" rows="4"></textarea>')
      + '<button class="btn-block btn-lg" type="submit">Join this farm</button>'
      + '</form>');
  },

  'save-join': async (c, form) => {
    const { code } = readForm(form);
    const cfg = readInviteCode(code);
    if (!cfg) { toast('That code could not be read. Copy the whole thing and try again.', true); return; }
    toast('Checking the code…');
    const check = await testConnection(cfg);
    if (!check.ok) { toast(`Could not reach that farm: ${check.error}`, true); return; }
    await configure(cfg);
    const result = await syncNow();
    closeSheet();
    await c.store.reload();
    toast(result.ok
      ? `Joined. Pulled down ${result.received} records.`
      : 'Joined, but the first sync failed. It will retry on its own.', !result.ok);
    render();
  },

  'go': (c, el) => navigate(el.dataset.to),
  'back': () => history.back(),
  'print': () => window.print(),
};

function findAction(target) {
  const el = target.closest('[data-act]');
  return el ? { el, act: el.dataset.act } : null;
}

export async function startShell(store) {
  ctx = {
    store,
    get state() { return store.state; },
    get user() { return store.user; },
    get lang() { return getLang(); },
    params,
    go: navigate,
    refresh: render,
    today: () => isoDate(),
  };

  const savedLang = localStorage.getItem('douvalue.lang');
  if (savedLang) setLang(savedLang);

  const savedUser = sessionStorage.getItem('douvalue.user');
  if (savedUser && store.state.people[savedUser]) store.setUser(store.state.people[savedUser]);

  document.addEventListener('click', async (e) => {
    const hit = findAction(e.target);
    if (!hit) return;
    if (hit.el.tagName === 'A') return;
    e.preventDefault();
    const view = routes.get(routeKey());
    const handler = (view && view.actions && view.actions[hit.act]) || shellActions[hit.act];
    if (!handler) return;
    try {
      await handler(ctx, hit.el, hit.el.dataset);
    } catch (err) {
      console.error(err);
      toast(err.message || 'That did not work', true);
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-act]');
    if (!form) return;
    e.preventDefault();
    const view = routes.get(routeKey());
    const handler = (view && view.actions && view.actions[form.dataset.act]) || shellActions[form.dataset.act];
    if (!handler) return;
    try {
      await handler(ctx, form, form.dataset);
    } catch (err) {
      console.error(err);
      toast(err.message || 'That did not save', true);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen()) closeSheet();
  });

  window.addEventListener('hashchange', () => { closeSheet(); render(); });
  onStatus(() => { if (ctx && ctx.store.user) render(); });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  store.subscribe(() => render());

  render();
  return ctx;
}

export function getCtx() { return ctx; }
