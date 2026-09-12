// Storage. Everything the farm records is an event in an append-only log.
//
// Why a log and not a table of rows: the farm has several phones, a weak mobile
// signal and no server of its own. Two hands can both record a harvest with no
// network between them, and when the phones finally meet, merging is just the
// union of two sets of events. Nothing overwrites anything, nothing is lost,
// and the manager can always see who recorded what and when.

const DB_NAME = 'douvalue';
const DB_VERSION = 1;
const EVENT_STORE = 'events';
const META_STORE = 'meta';

let dbPromise = null;
let memoryFallback = null;

function hasIndexedDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const store = db.createObjectStore(EVENT_STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
        store.createIndex('type', 'type');
      }
      // Events carry a "synced" stamp so the app always knows what has not yet
      // reached the server. Without it, a phone coming back from three days
      // offline would have to re-send its whole history to find out.
      const eventStore = req.transaction.objectStore(EVENT_STORE);
      if (!eventStore.indexNames.contains('synced')) eventStore.createIndex('synced', 'synced');
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** localStorage keeps the app working in a private window or an old browser. */
const LS_KEY = 'douvalue.events';
function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function lsWrite(events) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(events)); return true; }
  catch { return false; }
}

export async function loadEvents() {
  if (!hasIndexedDB()) {
    if (memoryFallback) return memoryFallback;
    memoryFallback = lsRead();
    return memoryFallback;
  }
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EVENT_STORE, 'readonly');
      const req = tx.objectStore(EVENT_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    memoryFallback = lsRead();
    return memoryFallback;
  }
}

export async function appendEvents(events) {
  if (!events.length) return;
  if (!hasIndexedDB()) {
    memoryFallback = (memoryFallback || lsRead()).concat(events);
    lsWrite(memoryFallback);
    return;
  }
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(EVENT_STORE, 'readwrite');
      const store = tx.objectStore(EVENT_STORE);
      for (const e of events) store.put(e);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    memoryFallback = (memoryFallback || lsRead()).concat(events);
    lsWrite(memoryFallback);
  }
}

/**
 * Merge incoming events, skipping ones already held. Returns how many were new.
 *
 * `fromServer` marks the arrivals as already synced: they came off the server,
 * so pushing them straight back would be pointless traffic on a metered phone.
 */
export async function mergeEvents(incoming, fromServer = false) {
  const existing = await loadEvents();
  const known = new Set(existing.map((e) => e.id));
  const stamp = fromServer ? new Date().toISOString() : undefined;
  const fresh = incoming
    .filter((e) => e && e.id && !known.has(e.id))
    .map((e) => (fromServer ? { ...e, synced: e.synced || stamp } : e));
  if (fresh.length) await appendEvents(fresh);
  return { added: fresh.length, skipped: incoming.length - fresh.length };
}

/** Events this device has not yet handed to the server. */
export async function unsyncedEvents(limit = 500) {
  const all = await loadEvents();
  return all.filter((e) => !e.synced).slice(0, limit);
}

export async function countUnsynced() {
  const all = await loadEvents();
  return all.reduce((n, e) => n + (e.synced ? 0 : 1), 0);
}

/** Stamp events the server has confirmed it holds. */
export async function markSynced(ids, at = new Date().toISOString()) {
  const wanted = new Set(ids);
  if (!wanted.size) return 0;

  if (!hasIndexedDB()) {
    const list = memoryFallback || lsRead();
    let n = 0;
    for (const e of list) if (wanted.has(e.id) && !e.synced) { e.synced = at; n++; }
    memoryFallback = list;
    lsWrite(list);
    return n;
  }

  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EVENT_STORE, 'readwrite');
      const store = tx.objectStore(EVENT_STORE);
      let n = 0;
      for (const id of wanted) {
        const get = store.get(id);
        get.onsuccess = () => {
          const rec = get.result;
          if (rec && !rec.synced) { rec.synced = at; store.put(rec); n++; }
        };
      }
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return 0;
  }
}

export async function clearEvents() {
  memoryFallback = [];
  try { localStorage.removeItem(LS_KEY); } catch { /* nothing to do */ }
  if (!hasIndexedDB()) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(EVENT_STORE, 'readwrite');
      tx.objectStore(EVENT_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* already gone */ }
}

export async function getMeta(key, fallback = null) {
  if (!hasIndexedDB()) {
    try { const v = localStorage.getItem(`douvalue.meta.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  }
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => resolve(fallback);
    });
  } catch { return fallback; }
}

export async function setMeta(key, value) {
  if (!hasIndexedDB()) {
    try { localStorage.setItem(`douvalue.meta.${key}`, JSON.stringify(value)); } catch { /* full */ }
    return;
  }
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best effort */ }
}

/** This phone's id, so the log records which device an entry came from. */
export async function deviceId() {
  let id = await getMeta('deviceId');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10);
    await setMeta('deviceId', id);
  }
  return id;
}

/**
 * Photos go in as small JPEGs. A farm phone on a shared bundle cannot afford
 * full-resolution images, and a 640 px picture of a leaf spot is plenty to
 * diagnose from.
 */
export function compressImage(file, maxSide = 640, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that picture'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a picture'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Everything, as a file the manager can keep, mail, or carry on a phone. */
export async function exportBundle() {
  const events = await loadEvents();
  return {
    format: 'douvalue-farm-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: await deviceId(),
    eventCount: events.length,
    events,
  };
}

export async function importBundle(bundle) {
  if (!bundle || bundle.format !== 'douvalue-farm-log' || !Array.isArray(bundle.events)) {
    throw new Error('That file is not a DouValue farm log.');
  }
  return mergeEvents(bundle.events);
}

/** Rough size of the log, so a full phone is a warning and not a surprise. */
export async function storageReport() {
  const events = await loadEvents();
  const bytes = new Blob([JSON.stringify(events)]).size;
  let quota = null, usage = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      quota = est.quota; usage = est.usage;
    }
  } catch { /* not available */ }
  return { events: events.length, bytes, quota, usage };
}
