// Keeping every phone on the farm in step.
//
// The data model makes this far simpler than it usually is. Everything the farm
// records is an event with a globally unique id, and nothing is ever edited in
// place, so merging two devices is a set union. There is no last-writer-wins,
// no field-level conflict, and no possibility of one phone silently overwriting
// another's morning. Two hands can record harvests all day with no signal
// between them and lose nothing.
//
// So the whole job is: push what this device has that the server does not, pull
// what the server has that this device does not, and be patient about the
// network, because in Port Harcourt the network is the unreliable part.

import {
  countUnsynced, getMeta, markSynced, mergeEvents, setMeta, unsyncedEvents,
} from './db.js';

const PUSH_BATCH = 400;
const PULL_BATCH = 500;
const POLL_MS = 120000;            // a quiet check every two minutes while online
const BACKOFF_MS = [5000, 15000, 45000, 120000, 300000];
const REQUEST_TIMEOUT_MS = 20000;

let config = null;                 // { url, farmId, farmKey }
let store = null;
let timer = null;
let inFlight = null;
let failures = 0;
let status = {
  state: 'off',                    // off | offline | idle | syncing | error
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  serverEvents: null,
};
const listeners = new Set();

export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getStatus() { return { ...status, configured: !!config }; }

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) { try { fn(getStatus()); } catch { /* a listener must not break sync */ } }
}

export function getConfig() { return config ? { ...config } : null; }

/** Everything a second phone needs to join this farm, as one pasteable code. */
export function makeInviteCode(cfg = config) {
  if (!cfg) return '';
  const payload = JSON.stringify({ v: 1, url: cfg.url, farmId: cfg.farmId, farmKey: cfg.farmKey });
  return btoa(unescape(encodeURIComponent(payload)));
}

export function readInviteCode(code) {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(String(code).trim()))));
    if (!parsed || !parsed.url || !parsed.farmId || !parsed.farmKey) return null;
    return { url: String(parsed.url).replace(/\/+$/, ''), farmId: parsed.farmId, farmKey: parsed.farmKey };
  } catch {
    return null;
  }
}

/** A new farm's identifiers. The key is the shared secret that guards the data. */
export function newFarmCredentials() {
  const rand = (n) => {
    const bytes = new Uint8Array(n);
    (globalThis.crypto || {}).getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, n * 2);
  };
  return { farmId: `farm_${rand(6)}`, farmKey: rand(16) };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.farmKey}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('The farm key was refused. Check the join code on this phone.');
    }
    if (!res.ok) throw new Error(`Server said ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Hand the server everything it has not acknowledged. */
async function push() {
  let sent = 0;
  for (;;) {
    const batch = await unsyncedEvents(PUSH_BATCH);
    if (!batch.length) break;
    // The synced stamp is this device's bookkeeping; the server has no use for it.
    const payload = batch.map(({ synced, ...rest }) => rest);
    const result = await request(`/api/farms/${encodeURIComponent(config.farmId)}/events`, {
      method: 'POST',
      body: JSON.stringify({ events: payload }),
    });
    await markSynced(batch.map((e) => e.id));
    sent += batch.length;
    if (result && typeof result.total === 'number') setStatus({ serverEvents: result.total });
    if (batch.length < PUSH_BATCH) break;
  }
  return sent;
}

/** Take everything recorded on the other phones since last time. */
async function pull() {
  let received = 0;
  for (;;) {
    const cursor = (await getMeta('syncCursor', 0)) || 0;
    const result = await request(
      `/api/farms/${encodeURIComponent(config.farmId)}/events?since=${cursor}&limit=${PULL_BATCH}`,
    );
    const events = (result && result.events) || [];
    if (events.length) {
      const merged = await mergeEvents(events, true);
      received += merged.added;
    }
    if (result && typeof result.cursor === 'number' && result.cursor > cursor) {
      await setMeta('syncCursor', result.cursor);
    }
    if (typeof result?.total === 'number') setStatus({ serverEvents: result.total });
    if (!result || !result.more) break;
  }
  return received;
}

/**
 * One full exchange. Concurrent callers share the same run rather than stacking
 * up: coming back into signal fires several triggers at once, and a farm phone
 * should not spend its bundle sending the same batch three times.
 */
export async function syncNow({ silent = false } = {}) {
  if (!config) return { ok: false, reason: 'not configured' };
  if (inFlight) return inFlight;
  if (!navigator.onLine) {
    setStatus({ state: 'offline', pending: await countUnsynced() });
    return { ok: false, reason: 'offline' };
  }

  setStatus({ state: 'syncing' });
  inFlight = (async () => {
    try {
      const sent = await push();
      const received = await pull();
      failures = 0;
      const pending = await countUnsynced();
      setStatus({
        state: 'idle', pending, lastError: null, lastSyncAt: new Date().toISOString(),
      });
      await setMeta('lastSyncAt', status.lastSyncAt);
      if (received && store) await store.reload();
      return { ok: true, sent, received };
    } catch (err) {
      failures++;
      setStatus({
        state: navigator.onLine ? 'error' : 'offline',
        pending: await countUnsynced(),
        lastError: err.message || String(err),
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
  if (!config) return;
  const delay = failures ? BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)] : POLL_MS;
  timer = setTimeout(() => { syncNow({ silent: true }); }, delay);
}

/** Check a server and key before saving them, so a typo is caught at setup. */
export async function testConnection(cfg) {
  const previous = config;
  config = { ...cfg, url: String(cfg.url).replace(/\/+$/, '') };
  try {
    const health = await request(`/api/farms/${encodeURIComponent(config.farmId)}/health`);
    return { ok: true, events: health && health.events };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    config = previous;
  }
}

export async function configure(cfg) {
  config = cfg ? { ...cfg, url: String(cfg.url).replace(/\/+$/, '') } : null;
  await setMeta('syncConfig', config);
  failures = 0;
  if (!config) {
    clearTimeout(timer);
    setStatus({ state: 'off', lastError: null });
    return;
  }
  setStatus({ state: navigator.onLine ? 'idle' : 'offline', pending: await countUnsynced() });
  syncNow({ silent: true });
}

/** Forget the link on this device. The farm's records stay put. */
export async function disconnect() {
  await setMeta('syncCursor', 0);
  await configure(null);
}

/**
 * Wire sync into the running app.
 *
 * Three things start a sync: coming back online, a record being written, and a
 * slow background tick. The write trigger is debounced so a supervisor entering
 * ten harvests in a row causes one exchange, not ten.
 */
export async function startSync(appStore) {
  store = appStore;
  config = await getMeta('syncConfig', null);
  const lastSyncAt = await getMeta('lastSyncAt', null);
  setStatus({
    state: config ? (navigator.onLine ? 'idle' : 'offline') : 'off',
    pending: await countUnsynced(),
    lastSyncAt,
  });

  window.addEventListener('online', () => {
    failures = 0;
    setStatus({ state: config ? 'idle' : 'off' });
    syncNow({ silent: true });
  });
  window.addEventListener('offline', () => {
    setStatus({ state: config ? 'offline' : 'off' });
  });

  let writeTimer = null;
  store.subscribe(async () => {
    setStatus({ pending: await countUnsynced() });
    if (!config) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => syncNow({ silent: true }), 4000);
  });

  // A phone that has been in a drawer wakes up behind; catch up when it returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && config && navigator.onLine) {
      syncNow({ silent: true });
    }
  });

  if (config) syncNow({ silent: true });
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
    case 'error':
      return { text: `Could not sync: ${s.lastError || 'unknown problem'}`, tone: 'danger' };
    case 'idle':
      return s.pending
        ? { text: `${s.pending} record${s.pending === 1 ? '' : 's'} waiting to send`, tone: 'warn' }
        : { text: s.lastSyncAt ? 'All phones up to date' : 'Connected, waiting for the first sync', tone: 'ok' };
    default:
      return { text: 'Saved on this phone only', tone: 'warn' };
  }
}
