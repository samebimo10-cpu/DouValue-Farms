// The frame: who is signed in, which screen is showing, and the plumbing that
// turns a tap into an event in the log.

import { can, ROLES } from '../store.js';
import { getLang, LANGS, setLang, t } from '../i18n.js';
import {
  badge, button, closeSheet, confirmSheet, empty, esc, field, initials, input,
  note, openSheet, readForm, sheetOpen, toast,
} from './kit.js';
import {
  getAuth, getStatus, joinFarm, onStatus, readJoinLink, signOutDevice,
  statusLine, syncNow, verifyPin,
} from '../sync.js';
import { isoDate } from '../util.js';
import { applyPhrase, buzz, callSupervisor } from './field-kit.js';
import { getMeta, setMeta } from '../db.js';

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
  const linked = getAuth();

  // A phone enrolled against the server belongs to one person. That is the
  // point: their PIN is useless on anybody else's handset, and nobody can pick
  // a different name off this one and work under it.
  if (linked) {
    const me = state.people[linked.memberId]
      || { id: linked.memberId, name: linked.name, role: linked.role };
    return pinScreen(me, `Signed in on this phone as ${ROLES[me.role]?.name || me.role}`);
  }

  const people = Object.values(state.people).filter((p) => p.active !== false);
  if (!people.length) return firstRunScreen(state);

  if (!pending.personId) {
    // Whoever lands here may be nobody on this list: it can be the sample farm
    // left over from a look around, or a phone that belongs to a farm set up
    // somewhere else. Without a way off this screen they are stuck on it, so
    // the ways out sit underneath the faces rather than behind them.
    const sample = isSampleFarm(state);
    return brandMark(state)
      + `<div class="card"><h2>${esc(t('login.who'))}</h2><div class="people-grid">`
      + people.map((p) => `<div class="person-tile" data-act="pick-person" data-id="${esc(p.id)}">`
        // UX-01: the face, where there is one. A name has to be read; a face is
        // recognised, which is faster and works for someone who reads slowly.
        + (p.face
          ? `<img class="face" src="${esc(p.face)}" alt="" width="72" height="72">`
          : `<div class="av">${esc(initials(p.name))}</div>`)
        + `<b>${esc(p.name)}</b>`
        + `<small>${esc(ROLES[p.role]?.name || p.role)}</small></div>`).join('')
      + '</div>'
      + (sample ? '<p style="margin:14px 0 0"><small>Every PIN on the sample farm is '
        + '<b>1234</b>.</small></p>' : '')
      + '</div>'
      + '<div class="card tight">'
      + (sample
        ? '<b>This is the sample farm</b>'
          + '<p><small>These are made-up people and made-up records, here so you can look '
          + 'around. Erase them when you are ready to start on your own farm.</small></p>'
          + button('Erase this and set up my farm', 'start-real-farm', { cls: 'btn-block', icon: '🌱' })
        : '<b>Not one of these people?</b>'
          + '<p><small>Join a farm that already exists, or start a new one on this '
          + 'phone.</small></p>')
      + `<div style="margin-top:10px">${button('Join with a code', 'open-join', { cls: 'btn-ghost btn-block' })}</div>`
      + '</div>';
  }

  return pinScreen(state.people[pending.personId], null);
}

function pinScreen(person, subtitle) {
  if (!person) return '<div class="card"><p>That account is not on this phone.</p></div>';
  const linked = getAuth();
  const dots = [0, 1, 2, 3].map((i) => `<span class="${i < pending.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  return `<div class="card"><div class="row">`
    + (person.face
      ? `<img class="face" src="${esc(person.face)}" alt="" width="44" height="44" `
        + 'style="width:44px;height:44px;margin:0">'
      : '<div class="av" style="width:44px;height:44px;border-radius:50%;'
        + 'background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;'
        + `font-weight:800">${esc(initials(person.name))}</div>`)
    + `<div class="grow"><b>${esc(person.name)}</b><br>`
    + `<small>${esc(subtitle || ROLES[person.role]?.name || '')}</small></div></div>`
    + `<p style="margin-top:12px">${esc(t('login.pin'))}</p>`
    + `<div class="pin-dots">${dots}</div>`
    + '<div class="pin-pad">'
    + keys.map((k) => {
      if (k === 'back') return button('⌫', 'pin-back', { cls: 'btn-quiet' });
      if (k === 'ok') return button('✓', 'pin-ok', {});
      return `<button type="button" data-act="pin-key" data-key="${k}">${k}</button>`;
    }).join('')
    + '</div>'
    + (linked
      ? `<div style="margin-top:14px">${button('Sign this phone out of the farm', 'device-signout', { cls: 'btn-ghost btn-block btn-sm' })}</div>`
      : `<div style="margin-top:14px">${button(t('login.back'), 'pin-cancel', { cls: 'btn-ghost btn-block' })}</div>`)
    + '</div>';
}

/**
 * Is everything on this phone the sample farm?
 *
 * The seeder gives every record it makes an `sp_` id and nothing else ever
 * does, so "every person here is a sample person" is exact: one real account
 * created alongside them and this stops being a sample farm to erase.
 */
function isSampleFarm(state) {
  const people = Object.values(state.people || {});
  return people.length > 0 && people.every((p) => String(p.id).startsWith('sp_'));
}

/**
 * UX-17 — read the app in the language this person reads.
 *
 * Called at every point somebody signs in. On a shared phone the setting
 * cannot belong to the handset: two people using one phone read different
 * languages, and making the second change it back each morning is how a
 * feature turns into a nuisance.
 */
function adoptLanguage(person) {
  if (person && person.language) setLang(person.language);
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
    + button('Try it on an example farm', 'practice-start', { cls: 'btn-quiet btn-block' })
    + '<p style="margin:8px 0 0"><small>Practice mode. Fills the app with an example farm so you '
    + 'can see how everything works. Nothing you do in practice is saved, so there is nothing to '
    + 'erase afterwards.</small></p>'
    + '</div>';
}

/**
 * What someone sees when they tap the link the CEO sent them.
 *
 * Two things to type, both short, both handed over by someone they know: the
 * code (already filled in from the link) and the password. Then they pick their
 * own PIN and never type anything longer again.
 */
function joinScreen(state) {
  const fromLink = readJoinLink();
  const linked = getAuth();

  if (linked) {
    return brandMark(state)
      + `<div class="card"><h1>Already joined</h1>`
      + `<p>This phone is signed in as <b>${esc(linked.name)}</b> on `
      + `<b>${esc(linked.farmName)}</b>.</p>`
      + button('Go to the farm', 'go', { cls: 'btn-block btn-lg', data: { to: '#/today' } })
      + `<div style="margin-top:10px">${button('Sign this phone out', 'device-signout', { cls: 'btn-ghost btn-block' })}</div>`
      + '</div>';
  }

  return brandMark(state)
    + '<div class="card"><h1>Join the farm</h1>'
    + '<p>The CEO creates your account and sends you a link and a password. '
    + 'Enter them once, choose a PIN you will remember, and this phone is yours.</p>'
    + '<form data-act="do-join">'
    + field('Farm server', input('url', {
      value: fromLink ? fromLink.url : '', required: true, placeholder: 'https://your-farm.deno.dev' }),
      fromLink ? 'Filled in from the link you tapped.' : 'The address the CEO gave you.')
    + field('Farm', input('farmId', { value: fromLink ? fromLink.farmId : '', required: true }))
    + field('Join code', input('joinCode', {
      value: fromLink ? fromLink.joinCode : '', required: true, placeholder: 'ABC123' }))
    + field('Password you were given', input('joinPassword', { required: true, placeholder: 'XYZ789' }),
      'Six letters and numbers. It works once, then it is dead.')
    + field('Choose your PIN', input('pin', {
      type: 'password', required: true, inputmode: 'numeric', placeholder: '0000' }),
      'Four digits or more. This is what you type every day from now on.')
    + field('Type the PIN again', input('pin2', { type: 'password', inputmode: 'numeric', placeholder: '0000' }))
    + '<button class="btn-block btn-lg" type="submit">Join</button>'
    + '</form>'
    + note('info', 'Why two things?',
      '<small>The code says which account, the password proves it is you. Neither works twice, '
      + 'and neither works on a phone that was not invited. If the code is refused, ask the CEO '
      + 'to send a new one.</small>')
    + '</div>'
    + (Object.keys(state.people).length
      ? `<div class="card tight">${button('Back', 'go', { cls: 'btn-ghost btn-block', data: { to: '#/today' } })}</div>`
      : '');
}

// --- Chrome ---------------------------------------------------------------

/**
 * Where "back" goes from a screen that is not one of the tabs.
 *
 * A fixed parent beats the browser's history: someone who arrived at a bed from
 * a link, or from the dashboard's alert list, still wants Back to mean "the
 * field", not "wherever I happened to be three taps ago". It also means Back
 * never walks them out of the app.
 */
const PARENT_OF = {
  '#/field/cycle': '#/field',
  '#/gates': '#/field',
  '#/alerts': '#/clinic',
  '#/digest': '#/dashboard',
  '#/zones': '#/field',
  '#/diagnose': '#/clinic',
  '#/adviser': '#/clinic',
  '#/guide': '#/clinic',
  '#/guide/item': '#/guide',
  '#/plan': '#/dashboard',
  '#/reports': '#/dashboard',
  '#/audit': '#/dashboard',
  '#/people': '#/dashboard',
  '#/money': '#/dashboard',
};

function parentOf(route, user) {
  if (PARENT_OF[route]) return PARENT_OF[route];
  return ROLES[user.role]?.home || '#/today';
}

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
  // A tab shows the mark; anything deeper shows the way back in its place, so
  // the bar stays one height and the target stays a thumb's width.
  const onTab = tabs.some((tab) => tab.hash === here);
  const back = onTab ? '' : parentOf(here, user);

  const practice = isPractising();
  return (practice
    ? '<div class="practice-bar" role="status">'
      + '<b>PRACTICE MODE</b><span>Nothing here is saved.</span>'
      + '<button data-act="practice-stop">Leave practice</button>'
      + '</div>'
    : '')
    + '<header class="topbar">'
    + (back
      ? `<button class="topbar-back" data-act="go" data-to="${esc(back)}" `
        + 'aria-label="Back">&#8592;</button>'
      : '<img class="topbar-mark" src="img/mark.jpg" alt="" width="256" height="256">')
    + `<div class="brand">${esc(state.settings.farmName)}<small>${esc(state.settings.location)}</small></div>`
    + '<div class="spacer"></div>'
    + `<button data-act="toggle-lang" title="Language">${lang === 'pcm' ? 'Pidgin' : 'English'}</button>`
    + '<button data-act="toggle-contrast" title="Bright sunlight" aria-label="Bright sunlight">☀</button>'
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

  if (routeKey() === '#/join') { root.innerHTML = joinScreen(state); return; }
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
  const tabRoots = tabsFor(user).map((tab) => tab.hash);
  if (!tabRoots.includes(key)) {
    const home = parentOf(key, user);
    body += `<div class="card tight return-card">${button('Back', 'go',
      { cls: 'btn-ghost btn-block', icon: '←', data: { to: home } })}</div>`;
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
    const linked = getAuth();
    const pin = pending.pin;

    if (linked) {
      // The PIN is checked against what this device stored when it was enrolled,
      // so signing in still works with no network. The token is what the server
      // actually trusts, and it is checked on the next exchange.
      const stored = await getMeta('devicePin', null);
      const hash = await hashPin(pin, linked.memberId);
      if (!stored || stored !== hash) {
        pending.pin = '';
        toast(t('login.wrong'), true);
        render();
        return;
      }
      pending = { personId: null, pin: '' };
      const person = c.store.state.people[linked.memberId]
        || { id: linked.memberId, name: linked.name, role: linked.role, active: true };
      c.store.setUser(person);
      adoptLanguage(person);
      sessionStorage.setItem('douvalue.user', person.id);
      navigate(ROLES[person.role]?.home || '#/today');
      render();
      return;
    }

    const person = c.store.state.people[pending.personId];
    if (!person) { pending = { personId: null, pin: '' }; render(); return; }
    const hash = await hashPin(pin);
    if (person.pinHash && person.pinHash !== hash) {
      pending.pin = '';
      toast(t('login.wrong'), true);
      render();
      return;
    }
    pending = { personId: null, pin: '' };
    c.store.setUser(person);
    adoptLanguage(person);
    sessionStorage.setItem('douvalue.user', person.id);
    navigate(ROLES[person.role]?.home || '#/today');
    render();
  },

  'device-signout': async (c) => {
    const ok = await confirmSheet('Sign this phone out?',
      'This phone stops sending and receiving, and whoever uses it next will need a fresh '
      + 'invite from the CEO. Records already on the server stay there.', 'Sign out');
    if (!ok) return;
    await signOutDevice();
    await setMeta('devicePin', null);
    sessionStorage.removeItem('douvalue.user');
    c.store.setUser(null);
    pending = { personId: null, pin: '' };
    toast('This phone is signed out');
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
    adoptLanguage(c.store.state.people[id]);
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
  'toggle-lang': async (c) => {
    const next = getLang() === 'en' ? 'pcm' : 'en';
    setLang(next);
    localStorage.setItem('douvalue.lang', next);
    // UX-17: on a shared phone the language belongs to the person, not the
    // handset. Two people using one phone read different languages, and making
    // the second change it back every morning is how a feature becomes a
    // nuisance.
    if (c.user) await c.store.dispatch('person.upsert', { ...c.user, language: next });
    render();
  },

  // UX-05: readable in direct sun. Not a dark theme inverted — the same layout
  // with every soft grey removed and the borders taken to full strength,
  // because soft grey is the first thing sunlight eats.
  'toggle-contrast': () => {
    const root = document.documentElement;
    const on = root.getAttribute('data-contrast') === 'high';
    if (on) root.removeAttribute('data-contrast');
    else root.setAttribute('data-contrast', 'high');
    try { localStorage.setItem('douvalue.contrast', on ? '' : 'high'); } catch { /* fine */ }
    render();
  },

  // UX-15: a phrase tapped instead of typed.
  phrase: (c, el) => applyPhrase(el),

  /**
   * UX-25 — practice mode.
   *
   * Training on the real farm means somebody's first attempt at recording a
   * harvest is a harvest that did not happen, sitting in the books for ever.
   * So practice runs against the sample farm in a separate store: the real
   * event log is not opened, not written and not synced while it is on.
   *
   * The banner is deliberately loud. Somebody who does not notice they are in
   * practice will record a real morning's work into nothing.
   */
  'practice-start': async (c) => {
    const ok = await confirmSheet('Start practice mode?',
      'The app fills with an example farm so people can try everything — recording a harvest, '
      + 'scouting, closing a task — without touching your real records. Nothing done in practice '
      + 'is saved or synced.', 'Start practice');
    if (!ok) return;
    try { sessionStorage.setItem('douvalue.practice', '1'); } catch { /* still works */ }
    location.reload();
  },

  'practice-stop': () => {
    try { sessionStorage.removeItem('douvalue.practice'); } catch { /* still works */ }
    location.reload();
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

  'open-join': () => { navigate('#/join'); },

  // Leaving the sample farm is a wipe, so it asks first — but the warning is
  // about pretend records, not real ones, and says so.
  'start-real-farm': async () => {
    const ok = await confirmSheet('Erase the sample farm?',
      'The example people and their records go for good. Nothing of your own is on this phone '
      + 'yet, so there is nothing real to lose.', 'Erase it and start');
    if (!ok) return;
    const { clearEvents } = await import('../db.js');
    await clearEvents();
    sessionStorage.removeItem('douvalue.user');
    location.reload();
  },

  'do-join': async (c, form) => {
    const data = readForm(form);
    const pin = String(data.pin || '');
    if (!/^\d{4,12}$/.test(pin)) { toast('Your PIN must be at least 4 digits', true); return; }
    if (pin !== String(data.pin2 || '')) { toast('The two PINs do not match', true); return; }

    toast('Joining…');
    try {
      const result = await joinFarm({
        url: data.url, farmId: data.farmId,
        joinCode: String(data.joinCode || '').trim().toUpperCase(),
        joinPassword: String(data.joinPassword || '').trim().toUpperCase(),
        pin,
      });
      // The PIN also unlocks this phone with no network, so it is kept here as a
      // digest alongside the token the server actually trusts.
      await setMeta('devicePin', await hashPin(pin, result.member.id));
      const sync = await syncNow();
      await c.store.reload();
      const person = c.store.state.people[result.member.id] || {
        id: result.member.id, name: result.member.name, role: result.member.role, active: true,
      };
      c.store.setUser(person);
      adoptLanguage(person);
      sessionStorage.setItem('douvalue.user', person.id);
      navigate(ROLES[person.role]?.home || '#/today');
      toast(sync.ok
        ? `Welcome, ${person.name}. Pulled down ${sync.received} records.`
        : `Welcome, ${person.name}. The first sync will retry on its own.`);
      render();
    } catch (err) {
      toast(err.message || 'Could not join', true);
    }
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

  try {
    if (localStorage.getItem('douvalue.contrast') === 'high') {
      document.documentElement.setAttribute('data-contrast', 'high');
    }
  } catch { /* a phone with storage blocked simply starts in normal contrast */ }

  const savedUser = sessionStorage.getItem('douvalue.user');
  if (savedUser && store.state.people[savedUser]) {
    store.setUser(store.state.people[savedUser]);
    // UX-17: their language, not the phone's.
    const mine = store.state.people[savedUser].language;
    if (mine) setLang(mine);
  }

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

/** UX-25 — is this a training session rather than the real farm? */
export function isPractising() {
  try { return sessionStorage.getItem('douvalue.practice') === '1'; } catch { return false; }
}

export function getCtx() { return ctx; }
