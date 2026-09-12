// Keeping every phone on the farm in step, with each person signed in as
// themselves.
//
// The data model does the hard part. Everything recorded is an event with a
// globally unique id and nothing is edited in place, so merging two devices is
// a set union: no last-writer-wins, no field-level conflict, and no way for one
// phone to overwrite another's morning.
//
// What this file adds is identity. Each device holds a token that belongs to one
// person. The server knows their role and decides what they may read and write,
// so a farm hand's phone is never sent the wage bill in the first place. A PIN
// on its own gets nobody in from a new handset: enrolling a device takes an
// invite, and an invite is single-use and expires.

import {
  countUnsynced, getMeta, markSynced, mergeEvents, setMeta, unsyncedEvents,
} from './db.js';

const PUSH_BATCH = 400;
const PULL_BATCH = 500;
const POLL_MS = 120000;
const BACKOFF_MS = [5000, 15000, 45000, 120000, 300000];
const REQUEST_TIMEOUT_MS = 20000;

let auth = null;          // { url, farmId, token, memberId, role, name, farmName }
let store = null;
let timer = null;
let inFlight = null;
let failures = 0;
let status = { state: 'off', pending: 0, lastSyncAt: null, lastError: null, serverEvents: null, withheld: 0 };
const listeners = new Set();

export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getStatus() { return { ...status, configured: !!auth, member: auth ? { ...auth } : null }; }
export function getAuth() { return auth ? { ...auth } : null; }
export function isConnected() { return !!auth; }

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) { try { fn(getStatus()); } catch { /* a listener must not break sync */ } }
}

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

/** A device name, so the CEO can tell one enrolled handset from another. */
async function deviceLabel() {
  let label = await getMeta('deviceLabel', null);
  if (!label) {
    const ua = navigator.userAgent || '';
    const guess = /Android/i.test(ua) ? 'Android phone'
      : /iPhone|iPad/i.test(ua) ? 'iPhone'
      : /Windows/i.test(ua) ? 'Windows PC'
      : /Mac/i.test(ua) ? 'Mac' : 'Device';
    label = `${guess} ${Math.random().toString(36).slice(2, 6)}`;
    await setMeta('deviceLabel', label);
  }
  return label;
}

async function api(path, { method = 'GET', body = null, token = auth && auth.token, base = auth && auth.url } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok) {
      const message = (payload && payload.error) || `Server said ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Setting a farm up and joining one ------------------------------------

export function newFarmId() {
  const a = new Uint8Array(6);
  (globalThis.crypto || {}).getRandomValues?.(a);
  const hex = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `farm_${hex || Math.random().toString(36).slice(2, 14)}`;
}

/** Check an address is a farm server before asking anyone to trust it. */
export async function checkServer(url) {
  try {
    const res = await fetch(`${trimUrl(url)}/`, { method: 'GET' });
    const text = await res.text();
    if (!/DouValue farm server/i.test(text)) {
      return { ok: false, error: 'That address answered, but it is not a DouValue farm server.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach it. ${err.message || err}` };
  }
}

/** The CEO creates the farm on the server and enrols this phone as the owner. */
export async function bootstrapFarm({ url, farmId, farmName, name, password, memberId }) {
  const base = trimUrl(url);
  const id = farmId || newFarmId();
  const result = await api(`/api/farms/${encodeURIComponent(id)}/bootstrap`, {
    method: 'POST', base, token: null,
    body: { name, password, farmName, memberId, device: await deviceLabel() },
  });
  await saveAuth({
    url: base, farmId: id, token: result.token,
    memberId: result.member.id, role: result.member.role, name: result.member.name,
    farmName: (result.farm && result.farm.name) || farmName,
  });
  return result;
}

/** Create an account for someone and get the one-time code to hand them. */
export async function inviteMember({ name, role, memberId }) {
  if (!auth) throw new Error('This phone is not connected to a farm server');
  const result = await api(`/api/farms/${encodeURIComponent(auth.farmId)}/invite`, {
    method: 'POST', body: { name, role, memberId },
  });
  return { ...result, link: joinLink(result.joinCode) };
}

/** The link that opens the app straight on the join screen with the code filled in. */
export function joinLink(joinCode, at = location.href) {
  if (!auth) return '';
  const base = String(at).split('#')[0];
  const params = new URLSearchParams({ s: auth.url, f: auth.farmId, c: joinCode });
  return `${base}#/join?${params.toString()}`;
}

/** Redeem an invite on this phone and set the person's own PIN. */
export async function joinFarm({ url, farmId, joinCode, joinPassword, pin }) {
  const base = trimUrl(url);
  const result = await api(`/api/farms/${encodeURIComponent(farmId)}/join`, {
    method: 'POST', base, token: null,
    body: { joinCode, joinPassword, pin, device: await deviceLabel() },
  });
  await saveAuth({
    url: base, farmId, token: result.token,
    memberId: result.member.id, role: result.member.role, name: result.member.name,
    farmName: (result.farm && result.farm.name) || 'DouValue Farms Limited',
  });
  await setMeta('syncCursor', 0);
  return result;
}

/** Confirm a PIN against the server, and change it if asked. */
export async function verifyPin(pin, newPin = null) {
  if (!auth) return { ok: false, error: 'not connected' };
  try {
    await api(`/api/farms/${encodeURIComponent(auth.farmId)}/unlock`, {
      method: 'POST', body: { pin, newPin },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status };
  }
}

export async function listMembers() {
  if (!auth) return [];
  const result = await api(`/api/farms/${encodeURIComponent(auth.farmId)}/members`);
  return result.members || [];
}

/** Cut someone off, or just sign every one of their handsets out. */
export async function revokeMember(memberId, { devicesOnly = false } = {}) {
  if (!auth) throw new Error('This phone is not connected to a farm server');
  return api(`/api/farms/${encodeURIComponent(auth.farmId)}/revoke`, {
    method: 'POST', body: { memberId, devicesOnly },
  });
}

async function saveAuth(next) {
  auth = next;
  await setMeta('farmAuth', next);
  failures = 0;
  setStatus({ state: navigator.onLine ? 'idle' : 'offline', lastError: null, pending: await countUnsynced() });
}

/** Forget the link on this device. The farm's records stay on the server. */
export async function signOutDevice() {
  auth = null;
  await setMeta('farmAuth', null);
  await setMeta('syncCursor', 0);
  clearTimeout(timer);
  setStatus({ state: 'off', lastError: null, serverEvents: null });
}

// --- Exchanging records ---------------------------------------------------

async function push() {
  let sent = 0, refused = 0;
  for (;;) {
    const batch = await unsyncedEvents(PUSH_BATCH);
    if (!batch.length) break;
    const payload = batch.map(({ synced, ...rest }) => rest);
    const result = await api(`/api/farms/${encodeURIComponent(auth.farmId)}/events`, {
      method: 'POST', body: { events: payload },
    });
    // Records the server refused are marked as done too. They were written by
    // someone whose role does not allow them, so retrying forever would jam the
    // outbox behind a record that will never be accepted.
    await markSynced(batch.map((e) => e.id));
    sent += result.accepted || 0;
    refused += (result.refused || []).length;
    if (result.refused && result.refused.length) {
      console.warn('The server would not accept some records:', result.refused);
    }
    if (typeof result.total === 'number') setStatus({ serverEvents: result.total });
    if (batch.length < PUSH_BATCH) break;
  }
  return { sent, refused };
}

async function pull() {
  let received = 0, withheld = 0;
  for (;;) {
    const cursor = (await getMeta('syncCursor', 0)) || 0;
    const result = await api(
      `/api/farms/${encodeURIComponent(auth.farmId)}/events?since=${cursor}&limit=${PULL_BATCH}`,
    );
    const events = result.events || [];
    if (events.length) received += (await mergeEvents(events, true)).added;
    withheld += result.withheld || 0;
    if (typeof result.cursor === 'number' && result.cursor > cursor) await setMeta('syncCursor', result.cursor);
    if (typeof result.total === 'number') setStatus({ serverEvents: result.total });
    if (!result.more) break;
  }
  return { received, withheld };
}

/**
 * One full exchange. Concurrent callers share the same run: coming back into
 * signal fires several triggers at once, and a farm phone should not spend its
 * bundle sending the same batch three times.
 */
export async function syncNow({ silent = false } = {}) {
  if (!auth) return { ok: false, reason: 'not connected' };
  if (inFlight) return inFlight;
  if (!navigator.onLine) {
    setStatus({ state: 'offline', pending: await countUnsynced() });
    return { ok: false, reason: 'offline' };
  }

  setStatus({ state: 'syncing' });
  inFlight = (async () => {
    try {
      const pushed = await push();
      const pulled = await pull();
      failures = 0;
      const at = new Date().toISOString();
      await setMeta('lastSyncAt', at);
      setStatus({
        state: 'idle', pending: await countUnsynced(), lastError: null,
        lastSyncAt: at, withheld: pulled.withheld,
      });
      if (pulled.received && store) await store.reload();
      return { ok: true, sent: pushed.sent, refused: pushed.refused, received: pulled.received };
    } catch (err) {
      failures++;
      // A token that no longer works means this device was cut off, or the
      // person was removed. Say so plainly rather than retrying for ever.
      if (err.status === 401 || err.status === 403) {
        setStatus({ state: 'error', lastError: `${err.message} Ask the CEO for a new invite.` });
        clearTimeout(timer);
        return { ok: false, reason: err.message, signedOut: true };
      }
      setStatus({
        state: navigator.onLine ? 'error' : 'offline',
        pending: await countUnsynced(), lastError: err.message || String(err),
      });
      if (!silent) console.warn('Sync failed:', err);
      return { ok: false, reason: err.message || String(err) };
    } finally {
      inFlight = null;
      schedule();
    }
  })();
  return inFlight;
}

function schedule() {
  clearTimeout(timer);
  if (!auth) return;
  const delay = failures ? BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)] : POLL_MS;
  timer = setTimeout(() => { syncNow({ silent: true }); }, delay);
}

/**
 * Wire sync into the running app. Four things start an exchange: coming back
 * online, a record being written, the app returning to the foreground, and a
 * slow background tick. The write trigger is debounced, so a supervisor
 * entering ten harvests causes one exchange rather than ten.
 */
export async function startSync(appStore) {
  store = appStore;
  auth = await getMeta('farmAuth', null);
  const lastSyncAt = await getMeta('lastSyncAt', null);
  setStatus({
    state: auth ? (navigator.onLine ? 'idle' : 'offline') : 'off',
    pending: await countUnsynced(), lastSyncAt,
  });

  window.addEventListener('online', () => { failures = 0; syncNow({ silent: true }); });
  window.addEventListener('offline', () => setStatus({ state: auth ? 'offline' : 'off' }));

  let writeTimer = null;
  store.subscribe(async () => {
    setStatus({ pending: await countUnsynced() });
    if (!auth) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => syncNow({ silent: true }), 4000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth && navigator.onLine) syncNow({ silent: true });
  });

  if (auth) syncNow({ silent: true });
  schedule();
  return getStatus();
}

/** One line a farm hand can read at a glance. */
export function statusLine(s = getStatus()) {
  if (!s.configured) return { text: 'Saved on this phone only', tone: 'warn' };
  switch (s.state) {
    case 'syncing': return { text: 'Syncing…', tone: 'info' };
    case 'offline':
      return {
        text: s.pending
          ? `No network. ${s.pending} record${s.pending === 1 ? '' : 's'} waiting to send`
          : 'No network. Everything here is already sent',
        tone: 'warn',
      };
    case 'error': return { text: s.lastError || 'Could not sync', tone: 'danger' };
    case 'idle':
      return s.pending
        ? { text: `${s.pending} record${s.pending === 1 ? '' : 's'} waiting to send`, tone: 'warn' }
        : { text: s.lastSyncAt ? 'All phones up to date' : 'Connected, waiting for the first sync', tone: 'ok' };
    default: return { text: 'Saved on this phone only', tone: 'warn' };
  }
}

/** Read an invite link's parameters, so a tapped link fills the join form in. */
export function readJoinLink(hash = location.hash) {
  const query = String(hash).split('?')[1];
  if (!query) return null;
  const p = new URLSearchParams(query);
  const url = p.get('s'), farmId = p.get('f'), joinCode = p.get('c');
  if (!url || !farmId) return null;
  return { url: trimUrl(url), farmId, joinCode: joinCode || '' };
}
