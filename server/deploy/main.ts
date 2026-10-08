// DouValue farm server, for Deno Deploy.
//
// GENERATED FILE. Do not edit here: change server/core.mjs (or the app modules
// it judges with) and run
//   node scripts-build-deno.mjs
//
// To run it, with no command line and no card:
//   1. Open https://dash.deno.com and create a new Playground.
//   2. Paste this whole file in.
//   3. Press Save & Deploy and copy the address it gives you.
//   4. Put that address into the app when the CEO sets the farm up.
//
// Storage is Deno KV, which is built in and persistent. The rules are read at
// boot from beside this file, from the RULES_URL environment variable, or from
// the farm's published site (https://samebimo10-cpu.github.io/DouValue-Farms/rules/douvalue_rules_rev5_1.json).
//
// Contents: the app modules the farm server judges records with
// (server/judge.mjs: the gates, the waiting periods, the proof photos), each
// in its own scope, then server/core.mjs, then the storage adapter.

// --- The app's modules, one scope each --------------------------------------
const __dvModules = new Map();
const __dvBinders = [];
function __dvModule(id) {
  if (!__dvModules.has(id)) __dvModules.set(id, {});
  return __dvModules.get(id);
}
function __dvImport(id, ...assigns) {
  const m = __dvModule(id);
  for (const assign of assigns) {
    __dvBinders.push(() => assign(m));
    try { assign(m); } catch { /* a module still loading: bound again below */ }
  }
}
function __dvBindAll() {
  for (const bind of __dvBinders) { try { bind(); } catch { /* still loading */ } }
}

// ─── web/js/db.js ──────────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "loadEvents": { enumerable: true, get: () => loadEvents },
  "appendEvents": { enumerable: true, get: () => appendEvents },
  "mergeEvents": { enumerable: true, get: () => mergeEvents },
  "unsyncedEvents": { enumerable: true, get: () => unsyncedEvents },
  "countUnsynced": { enumerable: true, get: () => countUnsynced },
  "markSynced": { enumerable: true, get: () => markSynced },
  "clearEvents": { enumerable: true, get: () => clearEvents },
  "getMeta": { enumerable: true, get: () => getMeta },
  "setMeta": { enumerable: true, get: () => setMeta },
  "deviceId": { enumerable: true, get: () => deviceId },
  "compressImage": { enumerable: true, get: () => compressImage },
  "FRESH_PHOTO_MS": { enumerable: true, get: () => FRESH_PHOTO_MS },
  "captureEvidence": { enumerable: true, get: () => captureEvidence },
  "exportBundle": { enumerable: true, get: () => exportBundle },
  "importBundle": { enumerable: true, get: () => importBundle },
  "storageReport": { enumerable: true, get: () => storageReport },
});


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

async function loadEvents() {
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

async function appendEvents(events) {
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
async function mergeEvents(incoming, fromServer = false) {
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
async function unsyncedEvents(limit = 500) {
  const all = await loadEvents();
  return all.filter((e) => !e.synced).slice(0, limit);
}

async function countUnsynced() {
  const all = await loadEvents();
  return all.reduce((n, e) => n + (e.synced ? 0 : 1), 0);
}

/** Stamp events the server has confirmed it holds. */
async function markSynced(ids, at = new Date().toISOString()) {
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

async function clearEvents() {
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

async function getMeta(key, fallback = null) {
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

async function setMeta(key, value) {
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
async function deviceId() {
  let id = await getMeta('deviceId');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10);
    await setMeta('deviceId', id);
  }
  return id;
}

/**
 * Photos go in as small JPEGs, and carry where they came from.
 *
 * A farm phone on a shared bundle cannot afford full-resolution images, and a
 * 640 px picture of a leaf spot is plenty to diagnose from. Evidence photos go
 * smaller still.
 *
 * The provenance matters as much as the picture. A photo taken at the bed, now,
 * is evidence; one picked out of the gallery days later is a claim. The file's
 * own modified time tells the two apart, so that is kept alongside it and the
 * audit can say "this picture was taken three days before it was attached".
 */
function compressImage(file, maxSide = 640, quality = 0.7) {
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

/** How long after a photo was taken it still counts as "taken just now". */
const FRESH_PHOTO_MS = 5 * 60 * 1000;

/**
 * A picture plus everything needed to judge it later.
 * Evidence shots are deliberately smaller than diagnosis shots: they are there
 * to show crates in a bed, not to resolve a mite.
 */
async function captureEvidence(file, { maxSide = 560, quality = 0.62 } = {}) {
  const dataUrl = await compressImage(file, maxSide, quality);
  const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
  const attachedAt = new Date().toISOString();
  const ageMs = file.lastModified ? Date.now() - file.lastModified : null;
  return {
    dataUrl,
    takenAt,
    attachedAt,
    // A picture whose file is older than a few minutes came out of the gallery,
    // whatever the camera button suggested.
    fresh: ageMs != null ? ageMs <= FRESH_PHOTO_MS : null,
    ageMinutes: ageMs != null ? Math.round(ageMs / 60000) : null,
    bytes: Math.round((dataUrl.length * 3) / 4),
  };
}

/** Everything, as a file the manager can keep, mail, or carry on a phone. */
async function exportBundle() {
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

async function importBundle(bundle) {
  if (!bundle || bundle.format !== 'douvalue-farm-log' || !Array.isArray(bundle.events)) {
    throw new Error('That file is not a DouValue farm log.');
  }
  return mergeEvents(bundle.events);
}

/** Rough size of the log, so a full phone is a warning and not a surprise. */
async function storageReport() {
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
})(__dvModule("web/js/db.js"));
__dvBindAll();

// ─── web/js/rules.js ───────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "RULES_FILE": { enumerable: true, get: () => RULES_FILE },
  "ref": { enumerable: true, get: () => ref },
  "loadRules": { enumerable: true, get: () => loadRules },
  "getRules": { enumerable: true, get: () => getRules },
  "rulesLoaded": { enumerable: true, get: () => rulesLoaded },
  "peekRules": { enumerable: true, get: () => peekRules },
  "setRules": { enumerable: true, get: () => setRules },
  "rulesVersion": { enumerable: true, get: () => rulesVersion },
  "gateSpec": { enumerable: true, get: () => gateSpec },
  "doctorRules": { enumerable: true, get: () => doctorRules },
  "triageRows": { enumerable: true, get: () => triageRows },
  "diagnosisCard": { enumerable: true, get: () => diagnosisCard },
  "defaultPhiDays": { enumerable: true, get: () => defaultPhiDays },
  "DEFAULT_REI_HOURS": { enumerable: true, get: () => DEFAULT_REI_HOURS },
});


// The rules loader.
//
// rules/douvalue_rules_rev5_1.json is the source of truth for this farm: the
// gates, the rotation sequences, the thresholds, the active ingredients and
// their IRAC/FRAC groups. CLAUDE.md is explicit that web/ and server/ both read
// that one file and that nobody copies it, because two copies means one of them
// is wrong and nobody finds out until a gate lets a spray through.
//
// So this module holds no agronomy of its own. It finds the file, parses it,
// and hands it out. Anything that reads a number out of it says where it came
// from (see `ref` below), so a blocked spray can be traced back to the line in
// the rules that blocked it rather than to somebody's memory of the PDF.
//
// The catalogue of active ingredients is built on top of this, in
// domain/catalogue.js, and the rotation sequences in domain/rotation.js. They
// are the only readers of the agronomy; everything else asks them.

const RULES_FILE = 'rules/douvalue_rules_rev5_1.json';

let cache = null;

/** A pointer into the rules file, for showing the working. */
function ref(path) {
  return `${RULES_FILE}#/${String(path).replace(/^\/+/, '')}`;
}

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/**
 * Where to look, in order.
 *
 * Deployed, the app sits at the site root and the rules beside it at /rules/,
 * so one level up from js/ is right. In the repository the app is one level
 * deeper, under web/, so two levels up is right. Trying both keeps a
 * developer's http-server and the published site on the same code path.
 */
function candidates() {
  return [
    new URL(`../${RULES_FILE}`, import.meta.url),
    new URL(`../../${RULES_FILE}`, import.meta.url),
  ];
}

/** Nothing downstream may edit the source of truth, even by accident. */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

function check(doc, where) {
  if (!doc || typeof doc !== 'object') throw new Error(`${where} is not a rules document`);
  if (!Array.isArray(doc.active_ingredients) || !doc.active_ingredients.length) {
    throw new Error(`${where} has no active_ingredients: it is not rev 5.1 of the rules`);
  }
  return deepFreeze(doc);
}

/**
 * Read the rules. The one call the app makes at boot.
 *
 * `fetchImpl` and `url` exist for tests; normal callers pass nothing.
 */
async function loadRules({ url = null, fetchImpl = null } = {}) {
  if (cache) return cache;
  const urls = url ? [new URL(url, import.meta.url)] : candidates();

  // Node — tests, the sync server and any script — reads it off disk. There is
  // no HTTP server in those places, and the file is right there in the repo.
  if (isNode && !fetchImpl) {
    const { readFileSync } = await import('node:fs');
    let err = null;
    for (const u of urls) {
      try { return (cache = check(JSON.parse(readFileSync(u, 'utf8')), u.pathname)); }
      catch (e) { err = e; }
    }
    throw new Error(`Could not read ${RULES_FILE}: ${err && err.message}`);
  }

  const get = fetchImpl || ((u) => fetch(u));
  let last = null;
  for (const u of urls) {
    try {
      const res = await get(String(u));
      if (!res || !res.ok) { last = new Error(`HTTP ${res && res.status} for ${u}`); continue; }
      cache = check(await res.json(), String(u));
      return cache;
    } catch (err) { last = err; }
  }
  throw new Error(`Could not load ${RULES_FILE}: ${last && last.message}. `
    + 'The app will not run on guessed agronomy, so it stops here.');
}

/**
 * The rules, synchronously, for the domain code that runs inside a screen.
 *
 * Throws rather than returning an empty document: a rotation check with no
 * rules behind it would pass everything, which is the one failure this whole
 * file exists to prevent.
 */
function getRules() {
  if (!cache) throw new Error('The rules have not been loaded yet — call loadRules() first');
  return cache;
}

function rulesLoaded() { return !!cache; }

/**
 * The rules if they are here, and null if they are not.
 *
 * For the code that has to carry on without them rather than stop: the Farm
 * Doctor refuses to name a product when the rules have not arrived
 * (FR-DOC-08), and a screen still has to paint in order to say so. Anything
 * that would otherwise *decide* something uses getRules() and its exception.
 */
function peekRules() { return cache; }

/** Tests and the sample farm set the document directly. */
function setRules(doc) {
  cache = doc ? check(doc, 'the supplied rules') : null;
  return cache;
}

function rulesVersion(rules = cache) {
  return (rules && rules.meta && rules.meta.version) || null;
}

// --- Readers that are not the catalogue ------------------------------------
//
// The active ingredients, their groups and the rotation sequences are read by
// domain/catalogue.js and domain/rotation.js. What is left here is the handful
// of other sections the Farm Doctor reads directly.

function gateSpec(id, rules = cache) {
  if (!rules || !Array.isArray(rules.gates)) return null;
  return rules.gates.find((g) => g.id === id) || null;
}

function doctorRules(rules = cache) { return (rules && rules.farm_doctor) || null; }

function triageRows(rules = cache) { return (rules && rules.triage) || []; }

function diagnosisCard(id, rules = cache) {
  const cards = (rules && rules.diagnosis_cards) || [];
  return cards.find((c) => c.id === id) || null;
}

/** The rules' own default waiting period, read out of the phi table. */
function defaultPhiDays(rules = cache) {
  const rows = (rules && rules.phi) || [];
  for (const row of rows) {
    if (/other synthetic/i.test(String(row.product || ''))) {
      const n = parseInt(String(row.phi_days), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 14;
}

const DEFAULT_REI_HOURS = 24;   // rei.rule: "24 h until label value entered"
})(__dvModule("web/js/rules.js"));
__dvBindAll();

// ─── the rule book, before anything reads it ─────────────────────────────
await (async () => {
  const rules = __dvModule("web/js/rules.js");
  if (rules.rulesLoaded()) return;
  try { await rules.loadRules(); return; } catch { /* not on disk beside this file */ }
  let fromEnv = null;
  try { fromEnv = Deno.env.get("RULES_URL") || null; } catch { /* no env access */ }
  for (const url of [fromEnv, new URL("../rules/douvalue_rules_rev5_1.json", import.meta.url).href, "https://samebimo10-cpu.github.io/DouValue-Farms/rules/douvalue_rules_rev5_1.json"]) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) { rules.setRules(await res.json()); return; }
    } catch { /* the next address */ }
  }
  throw new Error("The farm server could not read its rule book (rules/douvalue_rules_rev5_1.json). "
    + "Set RULES_URL to where it is published, then deploy again.");
})();

// ─── web/js/sources.js ─────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "SOURCES_FILE": { enumerable: true, get: () => SOURCES_FILE },
  "loadSources": { enumerable: true, get: () => loadSources },
  "peekSources": { enumerable: true, get: () => peekSources },
  "setSources": { enumerable: true, get: () => setSources },
  "sourceById": { enumerable: true, get: () => sourceById },
  "licenceRecorded": { enumerable: true, get: () => licenceRecorded },
  "isNonCommercial": { enumerable: true, get: () => isNonCommercial },
  "needsAttribution": { enumerable: true, get: () => needsAttribution },
  "licenceLine": { enumerable: true, get: () => licenceLine },
  "registryProblems": { enumerable: true, get: () => registryProblems },
  "sourcedEntries": { enumerable: true, get: () => sourcedEntries },
  "unresolvedSources": { enumerable: true, get: () => unresolvedSources },
  "sourcesOf": { enumerable: true, get: () => sourcesOf },
  "describeSources": { enumerable: true, get: () => describeSources },
});


// The source registry — docs/knowledge-layer.md §2 and §3.
//
// rules/sources.json lists every outside source once: a CABI decision guide, a
// WorldVeg crop guide, a NAFDAC list. Rules entries, triage rows and diagnosis
// cards name them by id in a `sources` array (FR-KNOW-04), so an answer can say
// what it rests on, and docs/references.md is generated from the same file
// (FR-KNOW-06) so the reading list and the app cannot drift apart.
//
// The licence is the part that matters most. DouValue is a commercial farm, so
// a non-commercial item can be linked but never shipped inside the app, and
// anything shipped says under what licence (FR-KNOW-00, FR-KNOW-02). The checks
// that enforce that live here, as plain functions, and the test suite runs them
// against the real file on every push.
//
// Unlike the rules, the registry is not needed to decide anything: a missing
// registry means the Farm Doctor lists source ids without their titles, not
// that it stops. So the loader never throws at the app.

const SOURCES_FILE = 'rules/sources.json';

const REGISTRY_FIELDS = ['id', 'title', 'publisher', 'kind', 'region', 'licence', 'url', 'bundled', 'retrieved', 'covers'];

let cache = null;

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/** Same two addresses as web/js/rules.js, for the same reason. */
function candidates() {
  return [
    new URL(`../${SOURCES_FILE}`, import.meta.url),
    new URL(`../../${SOURCES_FILE}`, import.meta.url),
  ];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

function shape(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sources)) {
    throw new Error(`${SOURCES_FILE} has no sources array`);
  }
  return deepFreeze(doc);
}

/** Read the registry. Resolves to null, never rejects, if it cannot be read. */
async function loadSources({ url = null, fetchImpl = null } = {}) {
  if (cache) return cache;
  const urls = url ? [new URL(url, import.meta.url)] : candidates();

  if (isNode && !fetchImpl) {
    const { readFileSync } = await import('node:fs');
    for (const u of urls) {
      try { return (cache = shape(JSON.parse(readFileSync(u, 'utf8')))); } catch { /* next */ }
    }
    return null;
  }

  const get = fetchImpl || ((u) => fetch(u));
  for (const u of urls) {
    try {
      const res = await get(String(u));
      if (!res || !res.ok) continue;
      return (cache = shape(await res.json()));
    } catch { /* next */ }
  }
  return null;
}

function peekSources() { return cache; }

/** Tests set the registry directly. */
function setSources(doc) {
  cache = doc ? shape(doc) : null;
  return cache;
}

function sourceById(id, registry = cache) {
  if (!registry) return null;
  return registry.sources.find((s) => s.id === id) || null;
}

// --- Licences ---------------------------------------------------------------

/** "unknown", "not stated", "check each" — none of these is a licence. */
function licenceRecorded(licence) {
  const text = String(licence || '').trim();
  if (!text) return false;
  return !/^(unknown|none|not stated|n\/?a|tbc|check\b|per publication)/i.test(text);
}

/** CC BY-NC, CC BY-NC-SA, CC BY-NC-ND: the NC is what makes it non-commercial. */
function isNonCommercial(licence) {
  return /(^|[^a-z])NC([^a-z]|$)/i.test(String(licence || ''))
    || /non[-\s]?commercial/i.test(String(licence || ''));
}

/** A Creative Commons licence with the BY (attribution) element. */
function needsAttribution(licence) {
  return /\bCC[-\s]+BY\b/i.test(String(licence || ''));
}

/**
 * The line shown with a bundled source (FR-KNOW-05). A linked source has no
 * licence line: we show its link and nothing we did not copy needs one.
 */
function licenceLine(source) {
  if (!source || !source.bundled) return '';
  const credit = source.attribution || source.publisher || '';
  return `${credit ? `${credit}. ` : ''}${source.licence}. Bundled with the app.`;
}

// --- The checks the build runs (docs/knowledge-layer.md §8) -----------------

/**
 * Everything wrong with a registry, as a list of { id, problem } — empty when
 * it is sound. FR-KNOW-00 and FR-KNOW-02 are the two that must never fail.
 */
function registryProblems(registry) {
  const problems = [];
  const list = (registry && registry.sources) || null;
  if (!Array.isArray(list)) return [{ id: null, problem: 'the registry has no sources array' }];
  const kinds = (registry.meta && registry.meta.kinds) || null;
  const seen = new Set();

  for (const s of list) {
    const id = s && s.id;
    const say = (problem) => problems.push({ id: id || null, problem });
    if (!s || typeof s !== 'object') { say('an entry is not an object'); continue; }

    for (const f of REGISTRY_FIELDS) if (!(f in s)) say(`missing the registry field "${f}"`);
    if (typeof id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) say('the id is not a lower-case slug');
    if (seen.has(id)) say('the id is listed twice');
    seen.add(id);
    if (typeof s.bundled !== 'boolean') say('"bundled" must be true or false');
    if ('covers' in s && !(Array.isArray(s.covers) && s.covers.every((c) => typeof c === 'string'))) {
      say('"covers" must be a list of ids');
    }
    if (s.retrieved != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(s.retrieved))) say('"retrieved" is not YYYY-MM-DD');
    if (kinds && s.kind != null && !kinds.includes(s.kind)) say(`"${s.kind}" is not one of the registry's kinds`);

    if (s.bundled === true) {
      // FR-KNOW-00: bundled means source, licence and URL on record.
      if (!licenceRecorded(s.licence)) say('bundled with no licence recorded (FR-KNOW-00): link it instead');
      if (!String(s.url || '').trim()) say('bundled with no URL recorded (FR-KNOW-00)');
      if (!String(s.publisher || '').trim()) say('bundled with no publisher recorded (FR-KNOW-00)');
      // FR-KNOW-02: never ship non-commercial content.
      if (isNonCommercial(s.licence)) say(`bundled under a non-commercial licence, ${s.licence} (FR-KNOW-02)`);
      // FR-KNOW-01: a CC BY item carries its credit.
      if (needsAttribution(s.licence) && !String(s.attribution || '').trim()) {
        say(`bundled under ${s.licence} with no attribution line (FR-KNOW-01)`);
      }
    }
  }
  return problems;
}

/** Every rules entry that carries a `sources` array: [{ where, entry }]. */
function sourcedEntries(rules) {
  const out = [];
  for (const [section, value] of Object.entries(rules || {})) {
    if (!Array.isArray(value)) continue;
    value.forEach((entry, i) => {
      if (entry && typeof entry === 'object' && 'sources' in entry) {
        const key = entry.id || (entry.n != null ? `row ${entry.n}` : entry.ai || entry.pest || entry.product || i);
        out.push({ where: `${section}[${key}]`, section, entry });
      }
    });
  }
  return out;
}

/**
 * FR-KNOW-04 — every `sources` id in the rules names a registry entry.
 * Returns [{ where, id, problem }], empty when all of them resolve.
 */
function unresolvedSources(rules, registry) {
  const known = new Set(((registry && registry.sources) || []).map((s) => s.id));
  const out = [];
  for (const { where, entry } of sourcedEntries(rules)) {
    if (!Array.isArray(entry.sources)) {
      out.push({ where, id: null, problem: '"sources" is not a list' });
      continue;
    }
    for (const id of entry.sources) {
      if (!known.has(id)) out.push({ where, id, problem: 'not in rules/sources.json' });
    }
  }
  return out;
}

// --- What an answer rests on (FR-KNOW-05) -----------------------------------

/** The `sources` ids of some rules entries, once each, in order. */
function sourcesOf(entries) {
  const out = [];
  for (const e of entries || []) {
    for (const id of (e && Array.isArray(e.sources) ? e.sources : [])) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Source ids, resolved for showing: the title, publisher and link, and the
 * licence line for a bundled one. An id the registry does not know is still
 * listed — hiding it would hide that the rules point at nothing.
 */
function describeSources(ids, registry = cache) {
  return (ids || []).map((id) => {
    const s = sourceById(id, registry);
    if (!s) return { id, known: false, title: id, publisher: '', url: '', bundled: false, licence: '', licenceLine: '' };
    return {
      id,
      known: true,
      title: s.title,
      publisher: s.publisher || '',
      url: s.url || '',
      bundled: !!s.bundled,
      licence: s.licence || '',
      licenceLine: licenceLine(s),
    };
  });
}
})(__dvModule("web/js/sources.js"));
__dvBindAll();

// ─── web/js/domain/pests.js ────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "PARTS": { enumerable: true, get: () => PARTS },
  "SYMPTOMS": { enumerable: true, get: () => SYMPTOMS },
  "SYMPTOM_BY_ID": { enumerable: true, get: () => SYMPTOM_BY_ID },
  "symptomsForPart": { enumerable: true, get: () => symptomsForPart },
  "PROBLEMS": { enumerable: true, get: () => PROBLEMS },
  "PROBLEM_BY_ID": { enumerable: true, get: () => PROBLEM_BY_ID },
  "PROBLEM_TYPES": { enumerable: true, get: () => PROBLEM_TYPES },
  "longestPhi": { enumerable: true, get: () => longestPhi },
});


// Field guide to what goes wrong with pepper in the Niger Delta.
//
// Two halves: SYMPTOMS is the checklist a farm hand ticks (plain English with a
// Pidgin gloss), and PROBLEMS is what those ticks point at. diagnose.js scores
// one against the other.
//
// This is a field guide, not a laboratory. It narrows the list and tells you how
// to confirm. Anything that could cost a whole bed deserves a second opinion
// from the Rivers State ADP extension officer or a plant clinic before you spend
// money on chemicals.

/** Parts of the plant, in the order the wizard asks about them. */
const PARTS = [
  { id: 'whole',    name: 'Whole plant',  pidgin: 'Di whole plant', emoji: '🌱' },
  { id: 'leaf',     name: 'Leaves',       pidgin: 'Leaf',           emoji: '🍃' },
  { id: 'stem',     name: 'Stem',         pidgin: 'Stem',           emoji: '🪵' },
  { id: 'fruit',    name: 'Fruit',        pidgin: 'Di pepper',      emoji: '🌶️' },
  { id: 'flower',   name: 'Flowers',      pidgin: 'Flower',         emoji: '🌸' },
  { id: 'root',     name: 'Roots',        pidgin: 'Root',           emoji: '🪴' },
  { id: 'seedling', name: 'Nursery',      pidgin: 'Nursery',        emoji: '🌿' },
  { id: 'pattern',  name: 'How it spreads', pidgin: 'How e dey go', emoji: '🗺️' },
];

/** The tick-boxes. Keep the wording concrete: what you can see, not what it is. */
const SYMPTOMS = [
  // Whole plant
  { id: 'wilt_sudden_green', part: 'whole', label: 'Wilts suddenly, leaves still green', pidgin: 'E just bend but leaf still green' },
  { id: 'wilt_midday', part: 'whole', label: 'Wilts in hot sun, recovers in the evening', pidgin: 'E dey bend for afternoon, come back for evening' },
  { id: 'stunted', part: 'whole', label: 'Small and stunted next to its neighbours', pidgin: 'E no wan grow like di others' },
  { id: 'yellowing_whole', part: 'whole', label: 'Whole plant going yellow', pidgin: 'Di whole plant dey yellow' },
  { id: 'dieback', part: 'whole', label: 'Dying from the top downwards', pidgin: 'E dey die from up' },
  { id: 'collapse', part: 'whole', label: 'Plant collapsed and died where it stood', pidgin: 'E just die for di same place' },
  { id: 'one_sided', part: 'whole', label: 'Only one side of the plant affected', pidgin: 'Na one side only' },

  // Leaves
  { id: 'leaf_yellow_old', part: 'leaf', label: 'Bottom (older) leaves yellow first', pidgin: 'Leaf for down dey yellow first' },
  { id: 'leaf_yellow_new', part: 'leaf', label: 'Top (new) leaves pale or yellow', pidgin: 'New leaf for up dey pale' },
  { id: 'leaf_interveinal', part: 'leaf', label: 'Yellow between the veins, veins stay green', pidgin: 'Yellow for middle, vein still green' },
  { id: 'leaf_margin_scorch', part: 'leaf', label: 'Leaf edges brown and burnt-looking', pidgin: 'Leaf edge don burn' },
  { id: 'leaf_spots_water_soaked', part: 'leaf', label: 'Small water-soaked spots turning dark', pidgin: 'Small wet spot wey dey turn black' },
  { id: 'leaf_spots_yellow_halo', part: 'leaf', label: 'Spots with a yellow ring around them', pidgin: 'Spot wit yellow round am' },
  { id: 'leaf_spots_grey_centre', part: 'leaf', label: 'Spots with grey or white centre, dark rim', pidgin: 'Spot wey get white eye for middle' },
  { id: 'leaf_spots_large_brown', part: 'leaf', label: 'Large brown blotches', pidgin: 'Big brown patch' },
  { id: 'leaf_mosaic', part: 'leaf', label: 'Mottled light and dark green pattern', pidgin: 'Leaf colour dey scatter, light and dark' },
  { id: 'leaf_vein_banding', part: 'leaf', label: 'Dark green banding along the veins', pidgin: 'Dark line dey follow vein' },
  { id: 'leaf_curl_up', part: 'leaf', label: 'Leaves curling upwards', pidgin: 'Leaf dey curl go up' },
  { id: 'leaf_curl_down', part: 'leaf', label: 'Leaves curling down / cupping', pidgin: 'Leaf dey curl go down' },
  { id: 'leaf_narrow_strappy', part: 'leaf', label: 'New leaves narrow and strap-like', pidgin: 'New leaf thin like rope' },
  { id: 'leaf_thick_leathery', part: 'leaf', label: 'Leaves thick, leathery, small', pidgin: 'Leaf hard and small' },
  { id: 'leaf_silver_bronze', part: 'leaf', label: 'Silvery or bronze sheen', pidgin: 'Leaf dey shine like silver' },
  { id: 'leaf_stipple', part: 'leaf', label: 'Tiny pale dots all over the leaf', pidgin: 'Plenty small white dot' },
  { id: 'leaf_webbing', part: 'leaf', label: 'Fine spider web underneath', pidgin: 'Small web for under leaf' },
  { id: 'leaf_white_powder', part: 'leaf', label: 'White powder on the leaf', pidgin: 'White powder for leaf' },
  { id: 'leaf_sticky_sooty', part: 'leaf', label: 'Sticky leaves with black sooty coating', pidgin: 'Leaf dey sticky wit black black' },
  { id: 'leaf_insects_under', part: 'leaf', label: 'Small insects clustered underneath', pidgin: 'Small insect gather for under leaf' },
  { id: 'leaf_flies_rise', part: 'leaf', label: 'Tiny white flies fly up when you shake it', pidgin: 'Small white fly dey comot when you shake am' },
  { id: 'leaf_ants', part: 'leaf', label: 'Ants running up and down the plant', pidgin: 'Ant full di plant' },
  { id: 'leaf_holes_chewed', part: 'leaf', label: 'Chewed, ragged, holes in leaves', pidgin: 'Something don chop di leaf' },
  { id: 'leaf_drop', part: 'leaf', label: 'Leaves dropping off', pidgin: 'Leaf dey fall' },
  { id: 'leaf_black_specks', part: 'leaf', label: 'Tiny black specks (droppings) on the leaf', pidgin: 'Small black black for leaf' },

  // Stem
  { id: 'stem_lesion_soil', part: 'stem', label: 'Dark wet rot on the stem at soil level', pidgin: 'Stem don rotten for ground level' },
  { id: 'stem_brown_inside', part: 'stem', label: 'Brown streaks inside when you cut it', pidgin: 'Inside stem don brown' },
  { id: 'stem_ooze_white', part: 'stem', label: 'Cut stem in clear water: milky thread comes out', pidgin: 'Put cut stem for water, white thread comot' },
  { id: 'stem_girdled_base', part: 'stem', label: 'Stem eaten or ringed at the base', pidgin: 'Dem don chop round di stem' },
  { id: 'stem_white_mould', part: 'stem', label: 'White mould or whiskers on the stem', pidgin: 'White mould for stem' },
  { id: 'stem_soil_tubes', part: 'stem', label: 'Mud tubes or soil sheeting on the stem', pidgin: 'Sand don cover di stem like tunnel' },

  // Fruit
  { id: 'fruit_sunken_lesion', part: 'fruit', label: 'Sunken round spot, sometimes pink/orange dots in it', pidgin: 'Hole-hole spot wit pink powder' },
  { id: 'fruit_black_end', part: 'fruit', label: 'Black leathery patch at the blossom (bottom) end', pidgin: 'Black hard patch for di bottom' },
  { id: 'fruit_hole_frass', part: 'fruit', label: 'Hole in the fruit with droppings around it', pidgin: 'Hole wit shit for outside' },
  { id: 'fruit_maggots', part: 'fruit', label: 'Maggots or a caterpillar inside', pidgin: 'Worm dey inside' },
  { id: 'fruit_sting_marks', part: 'fruit', label: 'Small puncture marks on the skin', pidgin: 'Small pin hole for skin' },
  { id: 'fruit_pale_papery', part: 'fruit', label: 'Pale papery sunburnt patch on the sunny side', pidgin: 'Sun don burn one side' },
  { id: 'fruit_scabby', part: 'fruit', label: 'Rough scabby raised spots', pidgin: 'Rough rough spot' },
  { id: 'fruit_deformed', part: 'fruit', label: 'Twisted, bumpy, deformed fruit', pidgin: 'Pepper no straight, e twist' },
  { id: 'fruit_small', part: 'fruit', label: 'Fruit much smaller than it should be', pidgin: 'Pepper too small' },
  { id: 'fruit_soft_rot', part: 'fruit', label: 'Soft watery rot', pidgin: 'Pepper don soft, water dey comot' },
  { id: 'fruit_dropping', part: 'fruit', label: 'Fruit dropping before it ripens', pidgin: 'Pepper dey fall before e ripe' },

  // Flowers
  { id: 'flower_drop', part: 'flower', label: 'Flowers falling without setting fruit', pidgin: 'Flower dey fall, no pepper' },
  { id: 'flower_black_whisker', part: 'flower', label: 'Flowers rotting with black whiskery growth', pidgin: 'Flower rotten wit black hair' },
  { id: 'flower_scarred', part: 'flower', label: 'Flowers or tiny fruit scarred and russeted', pidgin: 'Flower get scar' },

  // Roots
  { id: 'root_knots', part: 'root', label: 'Knots, galls or swellings on the roots', pidgin: 'Root get knot knot' },
  { id: 'root_brown_rot', part: 'root', label: 'Roots brown, soft, rotting', pidgin: 'Root don rotten' },
  { id: 'root_few', part: 'root', label: 'Very few roots, short and stubby', pidgin: 'Root no plenty, e short' },

  // Nursery
  { id: 'seedling_topple', part: 'seedling', label: 'Seedlings fall over at the soil line', pidgin: 'Seedling dey fall for ground level' },
  { id: 'seedling_no_germ', part: 'seedling', label: 'Seeds not coming up', pidgin: 'Seed no wan germinate' },
  { id: 'seedling_leggy', part: 'seedling', label: 'Seedlings tall, thin and weak', pidgin: 'Seedling long but weak' },

  // Field pattern
  { id: 'pattern_scattered', part: 'pattern', label: 'Odd plants here and there', pidgin: 'Na one one plant' },
  { id: 'pattern_patches', part: 'pattern', label: 'Whole patches together', pidgin: 'Na patch patch' },
  { id: 'pattern_low_wet', part: 'pattern', label: 'Worst in the low, wet part of the bed', pidgin: 'Na where water dey stay e bad pass' },
  { id: 'pattern_spreading_fast', part: 'pattern', label: 'Spreading fast down the row', pidgin: 'E dey spread quick for di line' },
  { id: 'pattern_field_edge', part: 'pattern', label: 'Worst at the edge of the field', pidgin: 'Na for edge e bad pass' },
  { id: 'pattern_whole_bed', part: 'pattern', label: 'Whole bed affected evenly', pidgin: 'Di whole bed be di same' },
  { id: 'pattern_after_rain', part: 'pattern', label: 'Started after heavy rain', pidgin: 'E start afta heavy rain' },
  { id: 'pattern_after_dry', part: 'pattern', label: 'Started in a hot dry spell', pidgin: 'E start wen sun dey hot' },
  { id: 'pattern_after_spray', part: 'pattern', label: 'Started after a spray was applied', pidgin: 'E start afta dem spray' },
];

const SYMPTOM_BY_ID = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s]));
function symptomsForPart(part) { return SYMPTOMS.filter((s) => s.part === part); }

/** Severity: 1 nuisance, 5 can take the whole field. */
const PROBLEMS = [
  {
    id: 'phytophthora_blight',
    name: 'Phytophthora blight',
    local: 'Sudden death / wet root rot',
    type: 'fungal',
    cause: 'Phytophthora capsici, a water mould that swims through wet soil',
    severity: 5,
    spread: 'very fast in standing water',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      wilt_sudden_green: 3, stem_lesion_soil: 4, root_brown_rot: 3, collapse: 2,
      pattern_low_wet: 3, pattern_after_rain: 3, pattern_patches: 2, pattern_spreading_fast: 2,
      leaf_drop: 1, fruit_soft_rot: 2, dieback: 1,
    },
    conditions: { waterlogging: 1.0, wetness: 0.7 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Dig one dying plant. A dark, water-soaked band right at the soil line that runs up the stem is the giveaway.',
      'Look at where the dead plants are. Phytophthora follows water: low spots, the end of a furrow, downhill of a puddle.',
      'Plants die green and stay standing. If they yellowed first over a week or two, think Fusarium or nematodes instead.',
    ],
    lookalikes: ['bacterial_wilt', 'fusarium_wilt', 'waterlogging'],
    loss: 'Can clear a whole bed in one wet week. The worst disease on this farm, by distance.',
    manage: {
      now: [
        'Pull out dead plants with the soil around the roots. Carry them off the field in a bag, do not drop them in the drain.',
        'Open the drains and break any pan so water leaves the bed within hours, not days.',
        'Stop furrow or flood irrigation on that block immediately. The water is the disease vehicle.',
      ],
      cultural: [
        'Raised beds, 30 cm high, are the single best defence here. Flat beds in Port Harcourt rain are a gamble.',
        'Never plant pepper, tomato, garden egg or okra back onto an infected bed for at least 3 years.',
        'Mulch to stop soil splashing up onto stems.',
        'Work infected blocks last and wash boots and tools before moving to a clean block.',
      ],
      chemical: [
        { active: 'Metalaxyl-M + mancozeb', example: 'Ridomil Gold MZ 68WG', how: 'Drench the base of plants around the affected patch and spray the block', phiDays: 14, note: 'Protects what is still healthy. It will not raise the dead.' },
        { active: 'Copper oxychloride', example: 'Champ / Kocide', how: 'Protective spray on the block after heavy rain', phiDays: 3, note: 'Cheap standby, weaker on Phytophthora than metalaxyl.' },
        { active: 'Fosetyl-aluminium', example: 'Aliette', how: 'Foliar or drench', phiDays: 7, note: 'Systemic, works both up and down the plant.' },
      ],
      organic: [
        'Trichoderma harzianum worked into the bed before transplanting, plus in the nursery mix.',
        'Well-rotted poultry manure raises soil biology that suppresses it. Fresh manure makes it worse.',
      ],
    },
  },

  {
    id: 'bacterial_wilt',
    name: 'Bacterial wilt',
    local: 'Sudden wilt with no spots',
    type: 'bacterial',
    cause: 'Ralstonia solanacearum, living in the soil',
    severity: 5,
    spread: 'fast through soil water and on tools',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      wilt_sudden_green: 4, stem_ooze_white: 5, stem_brown_inside: 3, wilt_midday: 2,
      pattern_patches: 2, pattern_scattered: 1, pattern_low_wet: 2, pattern_after_rain: 2, root_brown_rot: 1,
    },
    conditions: { waterlogging: 0.7, wetness: 0.5 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'The streaming test settles it. Cut the stem near the base, hang the cut end in a clear glass of clean water, hold it still. Milky white threads sinking out of the cut within 5 minutes means bacterial wilt.',
      'No leaf spots, no stem lesion, no yellowing first. The plant just wilts and dies standing, usually starting on the hottest day.',
      'Cut the stem across: a brown ring in the water-carrying tissue.',
    ],
    lookalikes: ['phytophthora_blight', 'fusarium_wilt', 'root_knot_nematode'],
    loss: 'No spray cures it. On an infested block the only honest answer is not to plant pepper there.',
    manage: {
      now: [
        'Rogue infected plants with the root ball. Do not compost them.',
        'Wash hands and dip cutlasses and knives in bleach solution between plants when pruning or harvesting in an affected block.',
        'Do not let irrigation or run-off flow from the sick block to a clean one.',
      ],
      cultural: [
        'Rotate to maize, okra is not safe, use maize, cassava or a grass fallow for 3 or more years. Never tomato, garden egg or potato.',
        'Raised beds and sharp drainage. The bacterium moves in water.',
        'Grafting onto resistant rootstock is the serious answer if you keep losing habanero on the same land.',
        'Soil solarisation with clear plastic over 6 weeks of dry-season sun knocks the population back.',
      ],
      chemical: [
        { active: 'None that cures it', example: '-', how: 'Do not waste money on fungicides; this is a bacterium in the soil', phiDays: 0, note: 'Copper slows surface spread at best.' },
      ],
      organic: [
        'Add lime and well-rotted organic matter; the disease is worse in acid, compacted soil.',
        'Some farmers get useful suppression from Bacillus subtilis biologicals applied at transplanting.',
      ],
    },
  },

  {
    id: 'fusarium_wilt',
    name: 'Fusarium wilt',
    local: 'Slow one-sided wilt',
    type: 'fungal',
    cause: 'Fusarium oxysporum in the soil',
    severity: 4,
    spread: 'slow, but permanent in the soil',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      one_sided: 4, leaf_yellow_old: 3, stem_brown_inside: 3, wilt_midday: 2,
      stunted: 2, pattern_scattered: 2, dieback: 2, leaf_drop: 2,
    },
    conditions: { dryness: 0.3, wetness: 0.2 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Yellowing usually starts on one side or one branch, then the whole plant goes over one or two weeks. Bacterial wilt is faster and greener.',
      'Split the stem lengthwise: a brown stain running up the inside.',
      'Do the streaming test anyway. No milky ooze points away from bacterial wilt and towards this.',
    ],
    lookalikes: ['bacterial_wilt', 'root_knot_nematode', 'phytophthora_blight'],
    loss: 'Takes plants one at a time through the season. Steady, quiet yield loss.',
    manage: {
      now: ['Remove affected plants with the root ball.', 'Mark the spot; do not replant into it this cycle.'],
      cultural: [
        'Long rotation away from solanaceae, and lime to bring pH up towards 6.5. Fusarium likes acid soil.',
        'Do not injure roots with careless weeding; every wound is a door.',
        'Nematode control matters, because nematode wounds let Fusarium in.',
      ],
      chemical: [
        { active: 'Carbendazim', example: 'Bendazim 50WP', how: 'Soil drench at the base of healthy neighbours', phiDays: 7, note: 'Partial help only. Do not rely on it.' },
      ],
      organic: ['Trichoderma in the planting hole.', 'Compost-rich beds slow it down.'],
    },
  },

  {
    id: 'anthracnose',
    name: 'Anthracnose fruit rot',
    local: 'Pepper rot / black spot for pepper',
    type: 'fungal',
    cause: 'Colletotrichum species, splashed by rain',
    severity: 5,
    spread: 'fast in the rains, fruit to fruit',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_sunken_lesion: 5, fruit_soft_rot: 2, fruit_dropping: 2, leaf_spots_large_brown: 1,
      pattern_after_rain: 3, pattern_whole_bed: 1, pattern_patches: 1,
    },
    conditions: { wetness: 1.0 },
    stages: ['fruiting', 'harvest', 'decline'],
    confirm: [
      'Look for a round, sunken, water-soaked spot on the fruit that darkens, with rings of tiny pink or orange spore dots in the middle when it is damp.',
      'Ripening and ripe fruit are hit hardest. Green fruit can carry it silently and rot after picking.',
      'Worst on the fruit nearest the ground and after a run of rainy days.',
    ],
    lookalikes: ['bacterial_leaf_spot', 'choanephora_wet_rot', 'sunscald'],
    loss: 'The main reason pepper is rejected at the market gate here. Can take 40% of a wet-season crop.',
    manage: {
      now: [
        'Pick and carry off every rotten fruit, including the ones on the ground. Each one is a spore factory for the rest of the bed.',
        'Bury or burn them well away from the field. Do not throw them at the field edge.',
        'Start a protective fungicide programme and keep it up through the rains.',
      ],
      cultural: [
        'Stake and prune the lower branches so no fruit touches the soil and air moves through the canopy.',
        'Mulch: it stops rain splashing soil-borne spores up onto the fruit.',
        'Harvest on time. Over-ripe fruit left on the plant is where it starts.',
        'Wider spacing in the rainy season, even at the cost of plant count.',
      ],
      chemical: [
        { active: 'Mancozeb', example: 'Z-Force / Dithane M-45', how: 'Protective spray every 7-10 days from first fruit set', phiDays: 7, note: 'The backbone. Protectant only, so it must be on the fruit before the rain.' },
        { active: 'Azoxystrobin', example: 'Amistar', how: 'Alternate with mancozeb', phiDays: 3, note: 'Rotate. Never use a strobilurin twice in a row or you breed resistance.' },
        { active: 'Difenoconazole', example: 'Score 250EC', how: 'Curative-leaning, use when pressure is already high', phiDays: 7, note: 'Alternate with a different mode of action.' },
        { active: 'Copper oxychloride', example: 'Champ', how: 'Cheap protectant between sprays', phiDays: 3, note: 'Also helps against bacterial spot.' },
      ],
      organic: [
        'Bicarbonate plus a wetter gives some protection on small plots.',
        'Wider spacing, mulch, and ruthless removal of rotten fruit do most of the work even without chemicals.',
      ],
    },
  },

  {
    id: 'bacterial_leaf_spot',
    name: 'Bacterial leaf spot',
    local: 'Leaf spot',
    type: 'bacterial',
    cause: 'Xanthomonas species, seed-borne and splash-spread',
    severity: 4,
    spread: 'fast in wind-driven rain',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_spots_water_soaked: 4, leaf_spots_yellow_halo: 3, leaf_drop: 3, fruit_scabby: 3,
      pattern_after_rain: 3, pattern_spreading_fast: 2, pattern_whole_bed: 2, leaf_spots_large_brown: 1,
    },
    conditions: { wetness: 1.0 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Hold a leaf up to the light. Small angular spots, greasy and water-soaked underneath, turning brown with a yellow halo.',
      'Heavy leaf drop leaves fruit naked and then sunburnt. That knock-on damage is often worse than the spots.',
      'Raised scabby spots on fruit rather than sunken ones. Sunken means anthracnose.',
    ],
    lookalikes: ['cercospora_leaf_spot', 'anthracnose'],
    loss: 'Defoliation plus sunscald. A bad year costs a third of the crop.',
    manage: {
      now: [
        'Stop working in the block while the leaves are wet. You spread it on your clothes and hands.',
        'Start copper plus mancozeb on a 7-day cycle while the weather stays wet.',
      ],
      cultural: [
        'Use clean, treated seed. This comes in on seed more often than farmers realise.',
        'Hot-water treat your own saved seed: 50°C for 25 minutes, then dry.',
        'Rotate away from pepper and tomato for 2 years; plough in or remove old crop trash.',
        'Avoid overhead watering late in the day.',
      ],
      chemical: [
        { active: 'Copper oxychloride + mancozeb', example: 'Champ + Z-Force', how: 'Tank mix, every 7 days through wet weather', phiDays: 7, note: 'The standard pair. Copper alone loses steam once resistance builds.' },
        { active: 'Copper hydroxide', example: 'Kocide 3000', how: 'Protective', phiDays: 3, note: 'Do not exceed label rate; copper builds up in soil.' },
      ],
      organic: ['Clean seed and rotation are the real controls.', 'Bacillus subtilis sprays give partial suppression.'],
    },
  },

  {
    id: 'cercospora_leaf_spot',
    name: 'Cercospora leaf spot (frog-eye)',
    local: 'Frog eye',
    type: 'fungal',
    cause: 'Cercospora capsici',
    severity: 3,
    spread: 'moderate',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_spots_grey_centre: 5, leaf_spots_yellow_halo: 2, leaf_drop: 3,
      pattern_after_rain: 2, leaf_spots_large_brown: 1,
    },
    conditions: { wetness: 0.8 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Round spots with a pale grey or white centre and a dark brown border. The "frog eye" look is unmistakable once you have seen it.',
      'Spots stay on leaves and stems, not on fruit. Fruit damage means you are looking at something else.',
    ],
    lookalikes: ['bacterial_leaf_spot'],
    loss: 'Defoliation and smaller fruit rather than direct fruit rot.',
    manage: {
      now: ['Spray mancozeb or a triazole and keep the canopy open.'],
      cultural: ['Remove crop trash after harvest.', 'Do not crowd plants in the rainy season.'],
      chemical: [
        { active: 'Mancozeb', example: 'Dithane M-45', how: 'Every 10 days in wet weather', phiDays: 7, note: 'Protectant.' },
        { active: 'Difenoconazole', example: 'Score', how: 'When spots are already established', phiDays: 7, note: 'Alternate modes of action.' },
      ],
      organic: ['Neem oil slows it on light infections.'],
    },
  },

  {
    id: 'choanephora_wet_rot',
    name: 'Choanephora wet rot',
    local: 'Flower rot wit black hair',
    type: 'fungal',
    cause: 'Choanephora cucurbitarum',
    severity: 3,
    spread: 'fast while the weather stays wet, then stops',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      flower_black_whisker: 5, stem_white_mould: 2, fruit_soft_rot: 3, flower_drop: 2,
      pattern_after_rain: 3, dieback: 2,
    },
    conditions: { wetness: 1.0, waterlogging: 0.4 },
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'Look at a rotting flower or young fruit with a hand lens in the morning: black pin-head heads on fine white whiskers, like a tiny brush.',
      'It hits flowers and growing tips, spreads down the shoot, and stops dead as soon as the weather dries.',
    ],
    lookalikes: ['anthracnose', 'flower_drop_stress'],
    loss: 'Loses you a flush of flowers in the wettest weeks. Rarely kills plants.',
    manage: {
      now: ['Cut out and remove rotted shoots and flowers.', 'Open the canopy so air can move.'],
      cultural: ['Wider spacing and staking in the peak rains.', 'Avoid excess nitrogen, which makes soft growth it loves.'],
      chemical: [
        { active: 'Mancozeb', example: 'Z-Force', how: 'Protective cover during wet spells', phiDays: 7, note: 'Timing beats product here: spray before the wet run, not after.' },
      ],
      organic: ['Drop nitrogen, open the canopy, wait for the dry days. It usually burns itself out.'],
    },
  },

  {
    id: 'damping_off',
    name: 'Damping-off',
    local: 'Nursery die',
    type: 'fungal',
    cause: 'Pythium and Rhizoctonia in wet nursery soil',
    severity: 4,
    spread: 'very fast across a seedbed',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      seedling_topple: 5, seedling_no_germ: 2, pattern_patches: 2, stem_lesion_soil: 2,
      pattern_after_rain: 1, root_brown_rot: 2,
    },
    conditions: { wetness: 0.8 },
    stages: ['nursery'],
    confirm: [
      'Seedlings fall over with a thin, pinched, water-soaked stem right at the soil line while the top still looks fresh.',
      'It starts as a patch and runs outwards across the tray or bed within days.',
    ],
    lookalikes: ['termites'],
    loss: 'Can cost you a whole nursery, and with it the planting date.',
    manage: {
      now: [
        'Stop watering in the evening. Water in the morning only, so the surface dries before night.',
        'Remove affected seedlings and the soil under them.',
        'Thin the seedbed and lift the shade so air moves.',
      ],
      cultural: [
        'Sow in trays with sterile or solarised media rather than field soil.',
        'Do not sow thickly. Crowding is half the problem.',
        'Raise the seedbed so it never sits wet.',
      ],
      chemical: [
        { active: 'Metalaxyl-M + mancozeb', example: 'Ridomil Gold MZ', how: 'Light drench of the seedbed at sowing and again a week later', phiDays: 0, note: 'Nursery stage, long before harvest.' },
        { active: 'Thiram or captan seed dressing', example: '-', how: 'Dress the seed before sowing', phiDays: 0, note: 'Cheap insurance.' },
      ],
      organic: ['Trichoderma in the nursery mix.', 'Wood ash lightly dusted on the seedbed surface.'],
    },
  },

  {
    id: 'powdery_mildew',
    name: 'Powdery mildew',
    local: 'White powder',
    type: 'fungal',
    cause: 'Leveillula taurica',
    severity: 3,
    spread: 'moderate',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_white_powder: 5, leaf_spots_yellow_halo: 2, leaf_drop: 3, leaf_yellow_old: 2,
      pattern_after_dry: 2,
    },
    conditions: { dryness: 0.7 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Turn the leaf over. On pepper the white powder sits underneath, with a yellow blotch showing on top. Many farmers miss it because they only look at the upper surface.',
      'Heavy leaf fall follows, then sunscald on the naked fruit.',
    ],
    lookalikes: ['bacterial_leaf_spot', 'magnesium_deficiency'],
    loss: 'Defoliation in the dry months, then sunburnt fruit.',
    manage: {
      now: ['Spray sulphur or a triazole, covering the leaf undersides properly.'],
      cultural: ['Do not let plants go thirsty.', 'Remove the worst leaves.'],
      chemical: [
        { active: 'Wettable sulphur', example: 'Thiovit / Kumulus', how: 'Cover both leaf surfaces', phiDays: 1, note: 'Do not apply when it is above 32°C or you will scorch the leaves.' },
        { active: 'Difenoconazole', example: 'Score', how: 'Every 10-14 days', phiDays: 7, note: 'Alternate with sulphur.' },
      ],
      organic: ['Milk-and-water spray (1 part milk to 9 parts water) weekly works on light infections.', 'Potassium bicarbonate.'],
    },
  },

  {
    id: 'pvmv',
    name: 'Pepper veinal mottle virus',
    local: 'Virus / leaf mottle',
    type: 'viral',
    cause: 'PVMV, carried plant to plant by aphids',
    severity: 5,
    spread: 'as fast as the aphids move',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_vein_banding: 5, leaf_mosaic: 4, stunted: 3, fruit_deformed: 3, fruit_small: 3,
      leaf_narrow_strappy: 2, pattern_scattered: 2, pattern_field_edge: 2, leaf_insects_under: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Dark green banding hugging the veins, with a mottled light and dark pattern between them, and the plant obviously behind its neighbours.',
      'No spots, no mould, nothing washes off. Virus symptoms are in the growth itself.',
      'It usually starts at the field edge and moves inwards, following the aphids.',
      'A plant clinic can run a strip test if you need certainty. There is no cure either way.',
    ],
    lookalikes: ['cmv', 'leaf_curl_virus', 'herbicide_drift', 'magnesium_deficiency'],
    loss: 'Endemic in Nigerian pepper and the biggest single reason a habanero field underperforms.',
    manage: {
      now: [
        'Rogue infected plants early and bag them. One infected plant left standing is a reservoir for the whole block.',
        'Control the aphids in the surrounding weeds, not just on the crop.',
      ],
      cultural: [
        'Buy certified seed and resistant or tolerant varieties where you can get them.',
        'Keep a clean weed-free strip around the field. Weeds hold both the virus and the aphids.',
        'Do not plant a young nursery next to an old, infected pepper field. Separate them in space and time.',
        'A maize or sorghum barrier row round the plot slows incoming aphids.',
        'Silver-grey plastic mulch repels aphids landing on young plants.',
      ],
      chemical: [
        { active: 'No cure for the virus', example: '-', how: 'Spraying a sick plant does nothing', phiDays: 0, note: 'Insecticide is for slowing the aphids, and only helps before infection.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Aphid control on young plants', phiDays: 14, note: 'Very toxic to bees. Never spray while flowers are open and bees are working.' },
      ],
      organic: ['Neem for aphids, weekly on young plants.', 'Rogue, rogue, rogue. It is the whole strategy.'],
    },
  },

  {
    id: 'cmv',
    name: 'Cucumber mosaic virus',
    local: 'Mosaic',
    type: 'viral',
    cause: 'CMV, spread by aphids from a very wide range of weeds',
    severity: 4,
    spread: 'fast where aphids are heavy',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_mosaic: 5, leaf_narrow_strappy: 4, stunted: 3, fruit_deformed: 2,
      pattern_scattered: 2, fruit_small: 2, leaf_thick_leathery: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Light and dark green mosaic, and new leaves that come out narrow and strappy, sometimes almost like a shoelace.',
      'Ring patterns can show on the fruit.',
      'Look at the weeds around the plot. CMV lives in a huge range of them.',
    ],
    lookalikes: ['pvmv', 'herbicide_drift'],
    loss: 'Stunted plants that never pay back what you spent on them.',
    manage: {
      now: ['Rogue and bag infected plants.'],
      cultural: ['Clear broadleaf weeds around the plot.', 'Do not overlap an old crop with a new nursery.'],
      chemical: [{ active: 'No cure', example: '-', how: 'Manage the aphid vector before infection only', phiDays: 0, note: '' }],
      organic: ['Neem and reflective mulch on young plants.'],
    },
  },

  {
    id: 'leaf_curl_virus',
    name: 'Pepper leaf curl (whitefly virus)',
    local: 'Leaf curl',
    type: 'viral',
    cause: 'Begomovirus carried by whitefly',
    severity: 4,
    spread: 'fast where whitefly is heavy',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_curl_up: 5, leaf_thick_leathery: 4, stunted: 3, leaf_flies_rise: 3,
      fruit_small: 2, leaf_sticky_sooty: 1, pattern_field_edge: 2,
    },
    conditions: { dryness: 0.5 },
    stages: ['establish', 'vegetative', 'flowering'],
    confirm: [
      'Leaves curl upwards, go thick and leathery, and the internodes shorten so the plant looks bunched.',
      'Shake the plant. A cloud of tiny white flies means whitefly is present and this is the likely answer.',
      'Thrips also curl leaves upward, but thrips leave silvering and black specks. Virus does not.',
    ],
    lookalikes: ['thrips', 'pvmv'],
    loss: 'Early infection means a plant that never yields. Late infection costs less.',
    manage: {
      now: ['Rogue badly curled young plants.', 'Hit the whitefly, including the leaf undersides.'],
      cultural: [
        'Yellow sticky traps to catch the adults and to tell you when numbers are rising.',
        'Nursery under insect-proof net is the highest-value change: protect the seedling and you protect the season.',
        'Clear weeds that host whitefly.',
      ],
      chemical: [
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar, cover leaf undersides', phiDays: 7, note: 'Rotate with a different mode of action.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Drench at transplanting protects for weeks', phiDays: 14, note: 'Bee-toxic. Not during open flowering.' },
      ],
      organic: ['Neem oil weekly.', 'Insect net over the nursery.', 'Yellow sticky traps.'],
    },
  },

  {
    id: 'aphids',
    name: 'Aphids',
    local: 'Small soft insect',
    type: 'insect',
    cause: 'Aphis gossypii and friends',
    severity: 3,
    spread: 'explosive in warm dry spells',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_insects_under: 5, leaf_sticky_sooty: 4, leaf_curl_down: 3, leaf_ants: 3,
      leaf_yellow_new: 2, stunted: 2, leaf_drop: 1,
    },
    conditions: { dryness: 0.6 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Turn over the youngest leaves and growing tips. Clusters of small soft pear-shaped insects, green, black or yellow.',
      'Ants running up and down the plant is the tell from ten paces: they farm aphids for the honeydew.',
      'Sticky leaves going black with sooty mould.',
    ],
    lookalikes: ['whitefly', 'mealybug'],
    loss: 'Direct damage is modest. The real cost is the virus they inject while feeding.',
    manage: {
      now: [
        'Spot-spray the infested plants rather than blanket-spraying the field. It saves money and saves the beneficials.',
        'Check for ladybird larvae and hoverfly maggots first. If they are working, hold your hand.',
      ],
      cultural: ['Do not over-apply nitrogen: soft lush growth pulls aphids in.', 'Keep the weed strip clean.'],
      chemical: [
        { active: 'Neem seed kernel extract', example: 'home-made or Neemazal', how: 'Cover undersides, repeat after 5-7 days', phiDays: 0, note: 'First choice while fruit is being picked.' },
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar', phiDays: 7, note: 'Effective and reasonably kind to predators at label rate.' },
        { active: 'Lambda-cyhalothrin', example: 'Karate / Lambda Super', how: 'Foliar when numbers are high', phiDays: 7, note: 'Broad-spectrum: it kills the ladybirds too, so use it sparingly.' },
      ],
      organic: ['Soapy water (mild soap, 20 g in 10 L) on a cloudy evening.', 'Neem.', 'Encourage ladybirds by not blanket-spraying.'],
    },
  },

  {
    id: 'whitefly',
    name: 'Whitefly',
    local: 'Small white fly',
    type: 'insect',
    cause: 'Bemisia tabaci',
    severity: 4,
    spread: 'fast, and it carries virus',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_flies_rise: 5, leaf_sticky_sooty: 4, leaf_yellow_old: 2, leaf_curl_up: 2,
      stunted: 2, leaf_insects_under: 2,
    },
    conditions: { dryness: 0.6 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Shake a plant in the morning: a cloud of tiny white flies goes up and settles back.',
      'Scales and eggs sit on the underside of the young leaves. Check there, not on top.',
      'Yellow sticky traps give you a count you can track week to week.',
    ],
    lookalikes: ['aphids', 'leaf_curl_virus'],
    loss: 'Sooty mould downgrades fruit, and the begomovirus it carries is worse than the insect.',
    manage: {
      now: ['Spray undersides in the early morning while the flies are sluggish.', 'Put out yellow sticky traps.'],
      cultural: ['Insect net over the nursery.', 'Remove and burn heavily infested old crop at the end of the cycle.', 'Do not plant a new block beside an old infested one.'],
      chemical: [
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar, undersides', phiDays: 7, note: 'Rotate groups; whitefly builds resistance quickly.' },
        { active: 'Spiromesifen', example: 'Oberon', how: 'Hits eggs and nymphs', phiDays: 3, note: 'Good rotation partner.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Soil drench at transplant', phiDays: 14, note: 'Bee-toxic; not during open flowering.' },
      ],
      organic: ['Neem oil every 5-7 days.', 'Yellow sticky traps.', 'Insect-proof nursery net.'],
    },
  },

  {
    id: 'thrips',
    name: 'Thrips',
    local: 'Leaf curl insect',
    type: 'insect',
    cause: 'Thrips and Scirtothrips species',
    severity: 4,
    spread: 'fast in dry weather',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_silver_bronze: 5, leaf_curl_up: 4, leaf_black_specks: 4, flower_scarred: 3,
      fruit_deformed: 3, leaf_stipple: 2, pattern_after_dry: 2, flower_drop: 2,
    },
    conditions: { dryness: 0.8 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Hold a white paper under a flower or a curled shoot and tap it. Slim yellow-brown insects that run rather than fly off.',
      'Silvery or bronzed patches with tiny black specks of frass, and leaves curling upward with the edges puckered.',
      'Scarred, russeted fruit that will not make first grade even though it is edible.',
    ],
    lookalikes: ['leaf_curl_virus', 'red_spider_mite', 'broad_mite'],
    loss: 'Downgrades fruit and, on chili, can take the flowers off entirely in a dry spell.',
    manage: {
      now: ['Spray at first sign, covering flowers and growing points, and repeat in 5-7 days to catch the next hatch.'],
      cultural: ['Blue sticky traps for monitoring.', 'Irrigate: dry stressed plants are thrips plants.', 'Clear weed hosts.'],
      chemical: [
        { active: 'Spinosad', example: 'Tracer / Laser', how: 'Foliar into the flowers', phiDays: 3, note: 'The best fit here: effective and short waiting period. Spray at dusk to spare bees.' },
        { active: 'Emamectin benzoate', example: 'Emastar', how: 'Foliar', phiDays: 3, note: 'Rotate with spinosad.' },
        { active: 'Lambda-cyhalothrin', example: 'Karate', how: 'Foliar', phiDays: 7, note: 'Thrips develop resistance fast; do not use it back to back.' },
      ],
      organic: ['Neem suppresses the young stages.', 'Keep the crop watered.', 'Blue sticky traps.'],
    },
  },

  {
    id: 'red_spider_mite',
    name: 'Red spider mite',
    local: 'Red insect for under leaf',
    type: 'mite',
    cause: 'Tetranychus species',
    severity: 4,
    spread: 'explosive in hot dry weather',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_webbing: 5, leaf_stipple: 4, leaf_silver_bronze: 3, leaf_drop: 3,
      pattern_after_dry: 3, pattern_after_spray: 2, leaf_yellow_old: 2,
    },
    conditions: { dryness: 1.0 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Fine webbing on the underside and in the leaf axils, with dust-sized specks moving on it. A hand lens settles it.',
      'Leaves stippled with tiny pale dots, going bronze, then dropping.',
      'It nearly always follows a hot dry spell, or a broad-spectrum insecticide that killed the predatory mites.',
    ],
    lookalikes: ['thrips', 'broad_mite'],
    loss: 'Can strip a habanero block in three weeks of harmattan-dry weather.',
    manage: {
      now: [
        'Use a proper miticide, not a general insecticide. Pyrethroids make spider mite worse by killing its predators.',
        'Spray the undersides. Coverage is everything with mites.',
      ],
      cultural: ['Irrigate and keep dust down; dusty roadside rows are always hit first.', 'Stop routine pyrethroid sprays.'],
      chemical: [
        { active: 'Abamectin', example: 'Dynamec / Abamex', how: 'Foliar, thorough underside coverage', phiDays: 7, note: 'Add a wetter. Repeat after 7 days.' },
        { active: 'Wettable sulphur', example: 'Thiovit', how: 'Cheap knockdown', phiDays: 1, note: 'Not above 32°C.' },
        { active: 'Spiromesifen', example: 'Oberon', how: 'Hits eggs and young stages', phiDays: 3, note: 'Good rotation partner.' },
      ],
      organic: ['Neem oil plus a wetter, twice, 5 days apart.', 'Water the crop properly; mites hate humidity.'],
    },
  },

  {
    id: 'broad_mite',
    name: 'Broad mite',
    local: 'Tip curl mite',
    type: 'mite',
    cause: 'Polyphagotarsonemus latus',
    severity: 4,
    spread: 'fast, often unnoticed until damage shows',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_curl_down: 5, leaf_narrow_strappy: 3, leaf_thick_leathery: 3, dieback: 2,
      fruit_scabby: 3, stunted: 2, leaf_silver_bronze: 2,
    },
    conditions: { wetness: 0.4, dryness: 0.4 },
    stages: ['vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Damage is all at the growing tip: new leaves cupped downward, hardened, bronzed underneath, and the tip stops growing.',
      'You will not see the mite without a strong lens. Diagnose by the damage pattern at the tip.',
      'Often mistaken for virus or herbicide drift. The difference: broad mite damage is only on new growth and recovers after a miticide.',
    ],
    lookalikes: ['herbicide_drift', 'pvmv', 'thrips'],
    loss: 'Stops the plant in its tracks during flowering. Common on habanero here and badly under-diagnosed.',
    manage: {
      now: ['Apply a miticide to the growing points, twice, 5 days apart.'],
      cultural: ['Do not move workers or tools from an infested block to a clean one.'],
      chemical: [
        { active: 'Abamectin', example: 'Dynamec', how: 'Target the growing tips', phiDays: 7, note: 'Two applications 5 days apart.' },
        { active: 'Wettable sulphur', example: 'Thiovit', how: 'Cheap and effective on broad mite', phiDays: 1, note: 'Avoid in extreme heat.' },
      ],
      organic: ['Sulphur.', 'Neem, though it is weaker on this one.'],
    },
  },

  {
    id: 'fruit_borer',
    name: 'Fruit borer / armyworm',
    local: 'Worm for pepper',
    type: 'insect',
    cause: 'Helicoverpa armigera and Spodoptera species',
    severity: 4,
    spread: 'moth flights, so it arrives suddenly',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_hole_frass: 5, fruit_maggots: 4, leaf_holes_chewed: 3, fruit_dropping: 2, fruit_soft_rot: 1,
    },
    conditions: {},
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'A clean round hole near the fruit stalk with wet droppings around it, and a caterpillar inside when you open it.',
      'Once the hole is there, secondary rot follows within days.',
      'Scout at dusk. That is when the caterpillars feed on the outside.',
    ],
    lookalikes: ['fruit_fly'],
    loss: 'Bores one fruit after another. Ten percent of a picking can go in a bad week.',
    manage: {
      now: [
        'Hand-pick and destroy bored fruit. Do not leave them on the ground; the caterpillar just walks to the next plant.',
        'Spray at egg-hatch, in the evening. A caterpillar already inside the fruit cannot be reached.',
      ],
      cultural: ['Pheromone traps tell you when the moths have arrived so you spray at the right time.', 'Deep ploughing between cycles exposes pupae.'],
      chemical: [
        { active: 'Bacillus thuringiensis', example: 'Dipel', how: 'Evening spray on small caterpillars', phiDays: 0, note: 'Best choice during picking: no waiting period at all.' },
        { active: 'Emamectin benzoate', example: 'Emastar', how: 'Foliar at egg-hatch', phiDays: 3, note: 'Very effective. Respect the 3-day wait.' },
        { active: 'Spinosad', example: 'Tracer', how: 'Foliar', phiDays: 3, note: 'Rotate with Bt and emamectin.' },
      ],
      organic: ['Bt.', 'Neem as an egg-laying deterrent.', 'Hand-picking at dusk works on a small plot.'],
    },
  },

  {
    id: 'fruit_fly',
    name: 'Fruit fly',
    local: 'Fly wey dey spoil pepper',
    type: 'insect',
    cause: 'Bactrocera and Dacus species',
    severity: 3,
    spread: 'from surrounding fruit trees and fallen fruit',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_sting_marks: 5, fruit_maggots: 4, fruit_dropping: 3, fruit_soft_rot: 3,
    },
    conditions: { wetness: 0.4 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A small puncture on the skin with a slight dimple, and small white maggots inside when you cut it open.',
      'Fruit softens and drops early. Bell pepper suffers most because of the thick flesh.',
      'Mango and guava trees around the farm are usually the source.',
    ],
    lookalikes: ['fruit_borer', 'anthracnose'],
    loss: 'Worse near orchards. Mainly a fresh-market quality problem.',
    manage: {
      now: [
        'Collect every fallen and stung fruit daily and drown it in water or bury it 50 cm deep. This one act breaks the cycle.',
        'Hang protein bait or methyl eugenol traps around the block.',
      ],
      cultural: ['Harvest slightly earlier rather than letting fruit over-ripen on the plant.', 'Clear fallen mango and guava around the farm.'],
      chemical: [
        { active: 'Spinosad bait (GF-120 style)', example: 'Success Appat', how: 'Spot-spray bait droplets on foliage, not a full cover spray', phiDays: 1, note: 'Baiting uses a fraction of the chemical of a cover spray and spares beneficials.' },
      ],
      organic: ['Sanitation and traps do most of it.', 'Bag individual bell fruit on a small plot.'],
    },
  },

  {
    id: 'root_knot_nematode',
    name: 'Root-knot nematode',
    local: 'Knot for root',
    type: 'nematode',
    cause: 'Meloidogyne species',
    severity: 4,
    spread: 'slow, but it builds up and stays',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      root_knots: 5, wilt_midday: 3, stunted: 4, leaf_yellow_old: 2,
      pattern_patches: 3, root_few: 2, fruit_small: 2,
    },
    conditions: { dryness: 0.3 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Dig a stunted plant, wash the roots in water, and look for hard swellings and knots along them. Nitrogen nodules on a legume rub off; nematode galls are part of the root.',
      'The tell-tale is a patch of plants that wilts at midday, recovers at night, and does not respond to fertiliser.',
      'Sandy soils here favour it.',
    ],
    lookalikes: ['fusarium_wilt', 'nitrogen_deficiency'],
    loss: 'Quiet 20-40% yield theft, and it opens the door for Fusarium.',
    manage: {
      now: ['Mark the patch. Do not replant pepper into it next cycle.'],
      cultural: [
        'Rotate with maize, rice or a marigold cover crop. Never tomato, garden egg or okra.',
        'Plough in African marigold (Tagetes) as a green manure; it genuinely suppresses Meloidogyne.',
        'Solarise with clear plastic through the dry season.',
        'Load the bed with organic matter: compost feeds the fungi and mites that eat nematodes.',
      ],
      chemical: [
        { active: 'Avoid carbofuran (Furadan)', example: '-', how: 'Do not use it', phiDays: 0, note: 'Extremely toxic to people and birds, banned in many markets and a real risk to anyone eating your pepper. Rotation and marigold are safer and work.' },
        { active: 'Fluensulfone or fluopyram', example: 'Nimitz / Velum', how: 'Soil applied before planting where registered and available', phiDays: 14, note: 'Expensive. Only worth it on a proven heavy infestation.' },
      ],
      organic: ['Marigold rotation.', 'Neem cake worked into the bed at 2-3 t/ha.', 'Compost.'],
    },
  },

  {
    id: 'variegated_grasshopper',
    name: 'Variegated grasshopper',
    local: 'Big coloured grasshopper',
    type: 'insect',
    cause: 'Zonocerus variegatus',
    severity: 3,
    spread: 'in bands, from bush edges',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_holes_chewed: 5, pattern_field_edge: 4, dieback: 1, stem_girdled_base: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'You will see them: fat, slow, brightly marked yellow, green and black, sitting in groups, and they do not fly off readily.',
      'Ragged chewing from the field edge inwards, worst next to bush and around the end of the rains.',
    ],
    lookalikes: ['fruit_borer'],
    loss: 'Defoliation at the field margin, occasionally deep into the block when numbers are high.',
    manage: {
      now: [
        'They cluster and roost. Knock them into a bucket of soapy water early in the morning while they are cold and slow. On most plots this beats spraying.',
        'If you must spray, treat the field-edge rows and the bush margin, not the whole field.',
      ],
      cultural: ['Clear the bush margin and destroy egg-laying sites in bare damp soil at the end of the rains.'],
      chemical: [
        { active: 'Lambda-cyhalothrin', example: 'Karate', how: 'Edge rows and margin only', phiDays: 7, note: 'A border treatment does the job; a full-field spray is wasted money.' },
      ],
      organic: ['Hand collection at dawn.', 'Metarhizium biopesticide where available.'],
    },
  },

  {
    id: 'mealybug',
    name: 'Mealybug',
    local: 'White cotton insect',
    type: 'insect',
    cause: 'Phenacoccus and Planococcus species',
    severity: 3,
    spread: 'moved around by ants',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_insects_under: 3, leaf_sticky_sooty: 4, leaf_ants: 4, stunted: 2,
      leaf_yellow_new: 2, dieback: 2,
    },
    conditions: { dryness: 0.5 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'White waxy cottony masses tucked into leaf axils, under the calyx of the fruit and at the stem joints.',
      'Ants everywhere. The ants carry them from plant to plant and protect them.',
    ],
    lookalikes: ['aphids', 'whitefly'],
    loss: 'Sooty mould downgrades fruit; heavy infestations stunt the plant.',
    manage: {
      now: ['Deal with the ants and you have half-solved the mealybug.', 'Spot-treat with oil-based spray; the wax coat repels water-based ones.'],
      cultural: ['Remove and bag heavily infested shoots.', 'Do not move seedlings from an infested nursery.'],
      chemical: [
        { active: 'Acetamiprid + horticultural oil', example: 'Mospilan + oil', how: 'Spot spray, thorough coverage into the axils', phiDays: 7, note: 'The oil is what gets through the wax.' },
      ],
      organic: ['Neem oil with soap.', 'Ant baiting.'],
    },
  },

  {
    id: 'termites',
    name: 'Termites',
    local: 'Termite / ant-ant',
    type: 'insect',
    cause: 'Macrotermes and others',
    severity: 3,
    spread: 'from nests nearby',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      stem_girdled_base: 5, stem_soil_tubes: 5, wilt_sudden_green: 2, seedling_topple: 2,
      pattern_after_dry: 2, pattern_scattered: 2,
    },
    conditions: { dryness: 0.7 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Soil sheeting or mud tubes running up the stem, and the bark eaten away underneath.',
      'Plants topple at the base in a dry spell, mostly on land newly cleared from bush.',
    ],
    lookalikes: ['phytophthora_blight', 'damping_off'],
    loss: 'Scattered plant loss, worst on newly cleared land and in the dry season.',
    manage: {
      now: ['Find and treat the nest. Killing foragers on one plant achieves nothing.', 'Firm soil around the base and irrigate; dry soil invites them.'],
      cultural: ['Remove buried wood and crop residue when clearing.', 'Keep the crop watered in the dry season.'],
      chemical: [
        { active: 'Fipronil or bifenthrin', example: '-', how: 'Treat the nest and the planting hole, not the foliage', phiDays: 14, note: 'Targeted soil use only. Never spray these onto fruit.' },
      ],
      organic: ['Wood ash and neem cake in the planting hole.', 'Destroy nests physically.'],
    },
  },

  {
    id: 'blossom_end_rot',
    name: 'Blossom-end rot',
    local: 'Black bottom',
    type: 'disorder',
    cause: 'Calcium not reaching the fruit, usually because water supply swung',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_black_end: 5, fruit_soft_rot: 1, pattern_whole_bed: 2, leaf_margin_scorch: 1,
    },
    conditions: { dryness: 0.5 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A sunken, leathery, dark patch exactly at the blossom end, the bottom tip of the fruit. Firm and dry, not slimy.',
      'It is not an infection and it does not spread from fruit to fruit. Do not spray fungicide at it.',
      'Bell pepper gets it worst because the fruit is big and fills fast.',
      'Think back a week or two: did the bed dry right out and then get flooded or heavily rained on? That swing is the cause.',
    ],
    lookalikes: ['anthracnose'],
    loss: 'Unsellable fruit in the first flush, then it usually settles down once water is steady.',
    manage: {
      now: [
        'Even out the water. Steady moderate moisture beats drought-then-flood every time. Mulch holds it steady.',
        'Foliar calcium nitrate, weekly for three weeks, helps the fruit still forming. It cannot repair fruit already marked.',
        'Pick off affected fruit so the plant stops feeding them.',
      ],
      cultural: [
        'Lime acid beds before planting: most soils here are short of calcium to begin with.',
        'Do not over-apply nitrogen, especially ammonium forms; it competes with calcium uptake.',
        'Mulch heavily. It is the cheapest and most reliable fix.',
      ],
      chemical: [
        { active: 'Calcium nitrate', example: 'foliar at 5 g/L', how: 'Weekly during fruit fill', phiDays: 0, note: 'A nutrient, not a pesticide. No waiting period.' },
      ],
      organic: ['Mulch, steady irrigation, lime, eggshell or wood ash worked in before planting.'],
    },
  },

  {
    id: 'sunscald',
    name: 'Sunscald',
    local: 'Sun don burn am',
    type: 'disorder',
    cause: 'Fruit exposed to direct sun after the canopy was lost',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_pale_papery: 5, leaf_drop: 3, fruit_soft_rot: 1, pattern_whole_bed: 1,
    },
    conditions: { dryness: 0.6 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A pale, papery, flattened patch on the side of the fruit that faces the sun. It often goes mouldy afterwards, which sends people chasing the wrong problem.',
      'Always follows leaf loss. Ask what took the leaves off: disease, mites, or over-hard pruning.',
    ],
    lookalikes: ['anthracnose'],
    loss: 'Secondary. Fix the defoliation and this goes away.',
    manage: {
      now: ['Find and treat whatever removed the leaves.', 'Do not prune hard in the dry season.'],
      cultural: ['Keep the canopy healthy.', 'Shade netting on bell pepper in the dry months.'],
      chemical: [{ active: 'None', example: '-', how: 'Nothing to spray', phiDays: 0, note: 'Treat the cause of the leaf loss instead.' }],
      organic: ['Canopy management.'],
    },
  },

  {
    id: 'flower_drop_stress',
    name: 'Flower and fruit drop',
    local: 'Flower dey fall',
    type: 'disorder',
    cause: 'Heat above 33°C, heavy rain at flowering, drought, or too much nitrogen',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      flower_drop: 5, fruit_dropping: 3, pattern_whole_bed: 3, pattern_after_dry: 2, pattern_after_rain: 2,
    },
    conditions: { dryness: 0.4, wetness: 0.3 },
    stages: ['flowering', 'fruiting'],
    confirm: [
      'Flowers drop clean off at the joint with no rot, no insect, no mark.',
      'Whole bed does it at once, which points at weather or feeding rather than a pest.',
      'Check the last two weeks: a run of very hot afternoons, a heavy downpour on open flowers, a dry-out, or a recent heavy urea dose.',
    ],
    lookalikes: ['thrips', 'choanephora_wet_rot'],
    loss: 'A lost flush. The plant usually flowers again if you fix the cause.',
    manage: {
      now: [
        'Water steadily; do not let the bed swing between bone dry and soaked.',
        'Stop nitrogen-heavy feeding and switch to a potassium-led fertiliser.',
        'Shade cloth over bell pepper through the hottest weeks.',
      ],
      cultural: ['Time the planting so flowering misses the hottest and the wettest weeks.', 'Mulch to buffer soil moisture.'],
      chemical: [
        { active: 'Boron + calcium foliar', example: 'micronutrient mix', how: 'At first flowering', phiDays: 0, note: 'Helps set where boron is short. Do not overdo boron; it turns toxic fast.' },
      ],
      organic: ['Mulch and steady irrigation.', 'Shade in the hot months.'],
    },
  },

  {
    id: 'nitrogen_deficiency',
    name: 'Nitrogen shortage',
    local: 'Plant dey hungry',
    type: 'deficiency',
    cause: 'Not enough nitrogen, or it leached away in heavy rain',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_yellow_old: 5, stunted: 3, yellowing_whole: 3, pattern_whole_bed: 3,
      fruit_small: 2, pattern_after_rain: 2,
    },
    conditions: { wetness: 0.4 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Even, pale yellowing that starts on the oldest bottom leaves and works upward, with no spots and no pattern within the leaf.',
      'The whole bed looks the same, which separates it from a disease.',
      'Heavy rain leaches nitrogen out of these sandy soils fast; three weeks of downpours will do it.',
    ],
    lookalikes: ['root_knot_nematode', 'waterlogging', 'fusarium_wilt'],
    loss: 'Small plants, small fruit, low yield. Cheap to fix if you catch it.',
    manage: {
      now: ['Side-dress urea at about 100 kg/ha, placed beside the plant and watered in, or give a soluble feed if you fertigate.'],
      cultural: ['Split nitrogen into 3 or 4 doses instead of one big one. In this rainfall, one big dose is money down the drain.', 'Build organic matter so the soil holds nutrients at all.'],
      chemical: [{ active: 'Urea 46-0-0 or NPK 15-15-15', example: '-', how: 'Side-dress and water in', phiDays: 0, note: 'Fertiliser, no waiting period.' }],
      organic: ['Well-rotted poultry manure.', 'Legume cover crop in the fallow.'],
    },
  },

  {
    id: 'potassium_deficiency',
    name: 'Potassium shortage',
    local: 'Leaf edge dey burn',
    type: 'deficiency',
    cause: 'Potassium short, usually because a heavy picking took it off the field',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_margin_scorch: 5, leaf_yellow_old: 3, fruit_small: 3, pattern_whole_bed: 2, leaf_drop: 2,
    },
    conditions: {},
    stages: ['fruiting', 'harvest', 'decline'],
    confirm: [
      'Older leaves scorch from the edge inwards while the middle of the leaf stays green.',
      'Fruit is small and does not fill or colour properly.',
      'It shows up after a heavy pick, because every crate carries potassium off the farm.',
    ],
    lookalikes: ['magnesium_deficiency', 'nitrogen_deficiency'],
    loss: 'Fruit size and colour, which is exactly what the buyer pays for.',
    manage: {
      now: ['Apply NPK 12-12-17 + 2MgO, or muriate of potash, and water it in.'],
      cultural: ['Feed after every second picking through the harvest window, not just at planting.'],
      chemical: [{ active: 'NPK 12-12-17+2MgO or KCl', example: '-', how: 'Side-dress', phiDays: 0, note: 'Fertiliser.' }],
      organic: ['Wood ash, applied with care: it also raises pH, which here is usually welcome.'],
    },
  },

  {
    id: 'magnesium_deficiency',
    name: 'Magnesium shortage',
    local: 'Yellow for middle of leaf',
    type: 'deficiency',
    cause: 'Magnesium short in acid, sandy, heavily leached soil',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_interveinal: 5, leaf_yellow_old: 3, leaf_drop: 2, pattern_whole_bed: 2,
    },
    conditions: { wetness: 0.3 },
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'Yellow between the veins on the older leaves while the veins themselves stay bright green, giving a herringbone look.',
      'Common here: leached sandy soil plus heavy potassium feeding locks magnesium out.',
    ],
    lookalikes: ['pvmv', 'potassium_deficiency'],
    loss: 'Early leaf loss and weaker fruit fill.',
    manage: {
      now: ['Foliar Epsom salts (magnesium sulphate) at 10 g/L, twice, a week apart.'],
      cultural: ['Use dolomitic lime rather than plain lime when you lime; it supplies magnesium and corrects pH together.', 'Do not overdo potassium.'],
      chemical: [{ active: 'Magnesium sulphate', example: 'Epsom salt', how: 'Foliar or soil', phiDays: 0, note: 'Nutrient.' }],
      organic: ['Dolomitic lime.', 'Compost.'],
    },
  },

  {
    id: 'waterlogging',
    name: 'Waterlogging',
    local: 'Water don stay for bed',
    type: 'disorder',
    cause: 'Roots drowning in a bed that will not drain',
    severity: 4,
    spread: 'follows the low ground',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_yellow_old: 4, wilt_midday: 3, pattern_low_wet: 5, root_brown_rot: 3,
      pattern_after_rain: 4, stunted: 2, leaf_drop: 2, pattern_patches: 2,
    },
    conditions: { waterlogging: 1.0 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'The plant wilts while the soil is visibly wet. That contradiction is the signature.',
      'Dig 20 cm down: grey, smelly, airless soil, and brown mushy roots.',
      'It follows the contour, worst in the low corner, which no disease does so neatly.',
      'Waterlogged roots are also how Phytophthora gets in, so the two often arrive together.',
    ],
    lookalikes: ['phytophthora_blight', 'nitrogen_deficiency'],
    loss: 'Slows the crop badly and opens the door to root rot. Entirely preventable with bed height.',
    manage: {
      now: ['Cut drains and get the water off the bed today.', 'Do not add fertiliser to a drowning root system; it cannot take it up.'],
      cultural: [
        'Raise beds to 30 cm before the rains. In this rainfall that is not optional.',
        'Break any hardpan with a ripper or deep hoe before planting.',
        'Lay the beds across the slope so water runs off, not along the row.',
      ],
      chemical: [{ active: 'None', example: '-', how: 'This is an engineering problem, not a spray problem', phiDays: 0, note: 'A preventive Phytophthora drench is worth it once drainage is fixed.' }],
      organic: ['Raised beds, organic matter, drains.'],
    },
  },

  {
    id: 'herbicide_drift',
    name: 'Herbicide drift',
    local: 'Spray don touch am',
    type: 'disorder',
    cause: 'Weedkiller drifting in from a neighbour, or a sprayer that was not washed out',
    severity: 3,
    spread: 'not contagious, but shows along the windward edge',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_narrow_strappy: 5, leaf_curl_down: 4, fruit_deformed: 3, stunted: 3,
      pattern_field_edge: 4, pattern_after_spray: 4, dieback: 2,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'New growth comes out cupped, strappy and distorted while the older leaves below look perfectly normal.',
      'Damage is strongest on the edge facing the neighbour or the road and fades as you walk inwards. Virus does not fade like that.',
      'Ask what was sprayed nearby, and check whether the knapsack was used for weedkiller before this.',
    ],
    lookalikes: ['pvmv', 'cmv', 'broad_mite'],
    loss: 'A mild hit grows out in three weeks. A heavy one costs the cycle.',
    manage: {
      now: [
        'Irrigate and feed lightly to push new clean growth.',
        'Keep a separate knapsack for herbicide, marked in paint. Never wash one out and use it for insecticide; residue survives rinsing.',
        'Photograph the damage and the date. If a neighbour caused it you will want the record.',
      ],
      cultural: ['Agree spray timing with neighbours.', 'Plant a barrier hedge on the windward side.'],
      chemical: [{ active: 'None', example: '-', how: 'Nothing to spray', phiDays: 0, note: 'Support the plant and wait for clean growth.' }],
      organic: ['Time and good feeding.'],
    },
  },

  {
    id: 'acid_soil',
    name: 'Acid soil / aluminium toxicity',
    local: 'Ground too sour',
    type: 'disorder',
    cause: 'Soil pH below about 5, common in Niger Delta soils',
    severity: 3,
    spread: 'the whole block behaves the same',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      stunted: 5, root_few: 4, leaf_yellow_new: 3, pattern_whole_bed: 4,
      fruit_small: 2, leaf_interveinal: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering'],
    confirm: [
      'The whole block is stunted and yet fertiliser makes little difference. That combination points at pH.',
      'Roots are short and stubby with few fine feeder roots.',
      'Test the soil. A cheap pH meter or a soil test at the Rivers State ADP office settles it, and it is the best money you will spend all season.',
    ],
    lookalikes: ['root_knot_nematode', 'nitrogen_deficiency'],
    loss: 'Caps the yield of the whole block no matter what you spend on fertiliser.',
    manage: {
      now: ['Test the pH before you buy anything else.'],
      cultural: [
        'Apply agricultural lime or dolomite at 1-2 t/ha, worked in 3-4 weeks before planting. Aim for pH 6.0-6.5.',
        'Dolomitic lime is better value here because it fixes magnesium at the same time.',
        'Build organic matter every cycle; it buffers pH and holds the nutrients.',
      ],
      chemical: [{ active: 'Agricultural lime or dolomite', example: '-', how: 'Broadcast and work in before planting', phiDays: 0, note: 'Give it 3-4 weeks to react before transplanting.' }],
      organic: ['Wood ash in small amounts.', 'Compost.'],
    },
  },
];

const PROBLEM_BY_ID = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));

const PROBLEM_TYPES = {
  fungal: { label: 'Fungal disease', colour: '#8e6c3a' },
  bacterial: { label: 'Bacterial disease', colour: '#b23c3c' },
  viral: { label: 'Virus', colour: '#7b4397' },
  insect: { label: 'Insect pest', colour: '#c77800' },
  mite: { label: 'Mite', colour: '#a3562a' },
  nematode: { label: 'Nematode', colour: '#5d6d3f' },
  disorder: { label: 'Disorder or damage', colour: '#4a6fa5' },
  deficiency: { label: 'Nutrient shortage', colour: '#2e7d5b' },
};

/** Everything a spray of this problem's chemicals implies for harvest timing. */
function longestPhi(problemId) {
  const p = PROBLEM_BY_ID[problemId];
  if (!p) return 0;
  return Math.max(0, ...p.manage.chemical.map((c) => c.phiDays || 0));
}
})(__dvModule("web/js/domain/pests.js"));
__dvBindAll();

// ─── web/js/util.js ────────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "DAY_MS": { enumerable: true, get: () => DAY_MS },
  "uid": { enumerable: true, get: () => uid },
  "isoDate": { enumerable: true, get: () => isoDate },
  "parseDate": { enumerable: true, get: () => parseDate },
  "addDays": { enumerable: true, get: () => addDays },
  "daysBetween": { enumerable: true, get: () => daysBetween },
  "monthOf": { enumerable: true, get: () => monthOf },
  "clamp": { enumerable: true, get: () => clamp },
  "sum": { enumerable: true, get: () => sum },
  "groupBy": { enumerable: true, get: () => groupBy },
  "naira": { enumerable: true, get: () => naira },
  "kg": { enumerable: true, get: () => kg },
  "pct": { enumerable: true, get: () => pct },
  "friendlyDate": { enumerable: true, get: () => friendlyDate },
  "timeOfDay": { enumerable: true, get: () => timeOfDay },
  "esc": { enumerable: true, get: () => esc },
  "html": { enumerable: true, get: () => html },
  "raw": { enumerable: true, get: () => raw },
  "round": { enumerable: true, get: () => round },
  "interpolate": { enumerable: true, get: () => interpolate },
  "debounce": { enumerable: true, get: () => debounce },
  "sortBy": { enumerable: true, get: () => sortBy },
  "titleCase": { enumerable: true, get: () => titleCase },
  "unitsToKg": { enumerable: true, get: () => unitsToKg },
});


// Small helpers shared by every module. No dependencies, no network.

const DAY_MS = 86400000;

let idCounter = 0;
/** Sortable, collision-resistant id: time prefix + counter + randomness. */
function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 4096;
  const t = Date.now().toString(36);
  const c = idCounter.toString(36).padStart(3, '0');
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${c}${r}`;
}

/** YYYY-MM-DD for a Date or ISO string, in local farm time. */
function isoDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(v);
}

function addDays(d, n) {
  const x = parseDate(d);
  return new Date(x.getTime() + n * DAY_MS);
}

/** Whole days from a to b (b - a). Calendar days, not hours. */
function daysBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  const ax = Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const by = Date.UTC(y.getFullYear(), y.getMonth(), y.getDate());
  return Math.round((by - ax) / DAY_MS);
}

function monthOf(d) { return parseDate(d).getMonth() + 1; } // 1-12

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function sum(list, pick = (x) => x) {
  return list.reduce((t, x) => t + (Number(pick(x)) || 0), 0);
}

function groupBy(list, key) {
  const out = new Map();
  for (const item of list) {
    const k = typeof key === 'function' ? key(item) : item[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/** Naira with thousands separators. Big numbers get k/m suffixes when short=true. */
function naira(n, short = false) {
  const v = Number(n) || 0;
  if (short && Math.abs(v) >= 1e6) return `₦${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}m`;
  if (short && Math.abs(v) >= 1e4) return `₦${Math.round(v / 1e3)}k`;
  return `₦${Math.round(v).toLocaleString('en-NG')}`;
}

function kg(n, dp = 1) {
  const v = Number(n) || 0;
  return `${v >= 100 ? Math.round(v).toLocaleString('en-NG') : v.toFixed(dp)} kg`;
}

function pct(n, dp = 0) { return `${(Number(n) || 0).toFixed(dp)}%`; }

/** "Today", "Yesterday", "Mon 4 Aug" — short and readable on a phone. */
function friendlyDate(d, today = new Date()) {
  const diff = daysBetween(d, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const x = parseDate(d);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (x.getFullYear() !== parseDate(today).getFullYear()) opts.year = 'numeric';
  return x.toLocaleDateString('en-NG', opts);
}

function timeOfDay(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Escape for safe insertion into innerHTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolated value. Arrays are joined. */
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (Array.isArray(v) ? v.join('') : v && v.__raw ? v.__raw : esc(v)) + strings[i + 1];
  }
  return out;
}

/** Mark a string as already-safe HTML for use inside html``. */
function raw(s) { return { __raw: String(s) }; }

function round(n, dp = 0) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Linear interpolation between stops: [[x,y],...] sorted by x. */
function interpolate(stops, x) {
  if (!stops.length) return 0;
  if (x <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i - 1], [x2, y2] = stops[i];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1 || 1);
  }
  return last[1];
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Stable sort helper: sortBy(list, x => x.date, 'desc') */
function sortBy(list, pick, dir = 'asc') {
  const s = [...list].sort((a, b) => {
    const av = pick(a), bv = pick(b);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return dir === 'desc' ? s.reverse() : s;
}

function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Crates and baskets are how the field counts; kg is how the books count. */
function unitsToKg(qty, unit, unitWeights) {
  const w = unitWeights[unit];
  return w ? Number(qty) * w : Number(qty);
}
})(__dvModule("web/js/util.js"));
__dvBindAll();

// ─── web/js/domain/climate.js ──────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "FARM_LOCATION": { enumerable: true, get: () => FARM_LOCATION },
  "CLIMATOLOGY": { enumerable: true, get: () => CLIMATOLOGY },
  "SEASON_LABELS": { enumerable: true, get: () => SEASON_LABELS },
  "climateFor": { enumerable: true, get: () => climateFor },
  "seasonOn": { enumerable: true, get: () => seasonOn },
  "rainProbability": { enumerable: true, get: () => rainProbability },
  "gdd": { enumerable: true, get: () => gdd },
  "normalGdd": { enumerable: true, get: () => normalGdd },
  "expectedGddBetween": { enumerable: true, get: () => expectedGddBetween },
  "PRICE_SEASONALITY": { enumerable: true, get: () => PRICE_SEASONALITY },
  "normaliseSeasonality": { enumerable: true, get: () => normaliseSeasonality },
  "priceIndexOn": { enumerable: true, get: () => priceIndexOn },
  "wetnessIndex": { enumerable: true, get: () => wetnessIndex },
  "drynessIndex": { enumerable: true, get: () => drynessIndex },
  "waterloggingIndex": { enumerable: true, get: () => waterloggingIndex },
  "irrigationGapMmPerDay": { enumerable: true, get: () => irrigationGapMmPerDay },
  "litresPerPlantPerDay": { enumerable: true, get: () => litresPerPlantPerDay },
  "fetchForecast": { enumerable: true, get: () => fetchForecast },
  "summariseObserved": { enumerable: true, get: () => summariseObserved },
  "forecastHeadline": { enumerable: true, get: () => forecastHeadline },
});
let clamp, interpolate, isoDate, monthOf, parseDate, daysBetween;
__dvImport("web/js/util.js", (m) => { clamp = m.clamp; }, (m) => { interpolate = m.interpolate; }, (m) => { isoDate = m.isoDate; }, (m) => { monthOf = m.monthOf; }, (m) => { parseDate = m.parseDate; }, (m) => { daysBetween = m.daysBetween; });
// Weather for Port Harcourt: a built-in climatology that works with no network,
// an optional live fetch when the phone has data, and the derived numbers the
// rest of the app reasons with (heat units, wetness, disease pressure).



const FARM_LOCATION = { name: 'Port Harcourt, Rivers State', lat: 4.82, lon: 7.04, tz: 'Africa/Lagos' };

/**
 * Long-run monthly averages for Port Harcourt. Used whenever there is no logged
 * rain-gauge reading and no live forecast — which, on a farm phone with no data
 * left, is most of the time. Rain in mm, rainDays out of the month, temps in C,
 * rh as mean relative humidity %.
 */
const CLIMATOLOGY = [
  { m: 1,  rain: 30,  rainDays: 2,  tmax: 33, tmin: 22, rh: 76, season: 'dry' },
  { m: 2,  rain: 50,  rainDays: 3,  tmax: 34, tmin: 23, rh: 78, season: 'dry' },
  { m: 3,  rain: 130, rainDays: 7,  tmax: 33, tmin: 23, rh: 82, season: 'onset' },
  { m: 4,  rain: 200, rainDays: 11, tmax: 32, tmin: 23, rh: 84, season: 'wet' },
  { m: 5,  rain: 280, rainDays: 15, tmax: 31, tmin: 23, rh: 86, season: 'wet' },
  { m: 6,  rain: 350, rainDays: 19, tmax: 30, tmin: 23, rh: 88, season: 'wet' },
  { m: 7,  rain: 420, rainDays: 23, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 8,  rain: 380, rainDays: 24, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 9,  rain: 420, rainDays: 23, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 10, rain: 300, rainDays: 18, tmax: 30, tmin: 23, rh: 88, season: 'wet' },
  { m: 11, rain: 100, rainDays: 7,  tmax: 32, tmin: 23, rh: 84, season: 'retreat' },
  { m: 12, rain: 30,  rainDays: 2,  tmax: 33, tmin: 22, rh: 78, season: 'dry' },
];

const SEASON_LABELS = {
  dry: 'Dry season', onset: 'Rains starting', wet: 'Rainy season',
  peak: 'Peak rains', retreat: 'Rains ending',
};

function climateFor(dateOrMonth) {
  const m = typeof dateOrMonth === 'number' ? dateOrMonth : monthOf(dateOrMonth);
  return CLIMATOLOGY[clamp(m, 1, 12) - 1];
}

function seasonOn(date) {
  const c = climateFor(date);
  return { id: c.season, label: SEASON_LABELS[c.season] };
}

/** Chance any given day in this month is a rain day. */
function rainProbability(date) {
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  return clamp(c.rainDays / daysInMonth, 0, 1);
}

/**
 * Growing degree days for one day. Capsicum sits between a base below which it
 * stops growing and an upper cut-off above which extra heat buys nothing.
 */
function gdd(tmax, tmin, base = 10, cutoff = 30) {
  const hi = Math.min(tmax, cutoff);
  const lo = Math.max(Math.min(tmin, cutoff), base);
  const mean = (Math.max(hi, base) + lo) / 2;
  return Math.max(0, mean - base);
}

/** Climatological GDD for a date, used when no measured temperature exists. */
function normalGdd(date, base = 10) {
  const c = climateFor(date);
  return gdd(c.tmax, c.tmin, base);
}

/** Heat units expected between two dates from climatology alone. */
function expectedGddBetween(from, to, base = 10) {
  const days = daysBetween(from, to);
  if (days <= 0) return 0;
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(parseDate(from).getTime() + i * 86400000);
    total += normalGdd(d, base);
  }
  return Math.round(total);
}

/**
 * Farm-gate price seasonality for fresh pepper in the South-South.
 *
 * Prices here are driven by irrigated dry-season supply coming down from Kano,
 * Kaduna and Sokoto. That supply lands from about November to March and the
 * market softens; it thins out from June and the market runs hot through the
 * rains.
 *
 * The twelve figures average to exactly 1.00, which matters more than it looks:
 * the base price in Settings is a yearly average, so an index that averaged, say,
 * 1.09 would silently mark every forecast up by nine percent and make every crop
 * look better than it is. These are planning multipliers, not quotes: check Mile 3
 * and Creek Road before trusting them with real money, and replace them in
 * Settings once the farm has a season of its own sales to average.
 */
const PRICE_SEASONALITY = {
  1: 0.73, 2: 0.78, 3: 0.87, 4: 0.96, 5: 1.05, 6: 1.19,
  7: 1.33, 8: 1.37, 9: 1.24, 10: 1.01, 11: 0.78, 12: 0.69,
};

/**
 * Normalise any monthly index so it averages 1.00. A manager typing in their own
 * remembered prices will not produce a set that happens to average out, and an
 * index that runs high or low would bias every revenue forecast in the app.
 * Normalising keeps the *shape* they entered, which is the part that carries the
 * information, and leaves the level to the base price.
 */
function normaliseSeasonality(table) {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const values = months.map((m) => Number(table[m]));
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return { ...PRICE_SEASONALITY };
  const mean = values.reduce((a, b) => a + b, 0) / 12;
  if (!mean) return { ...PRICE_SEASONALITY };
  const out = {};
  months.forEach((m, i) => { out[m] = values[i] / mean; });
  return out;
}

function priceIndexOn(date, overrides = null) {
  const table = overrides && Object.keys(overrides).length
    ? normaliseSeasonality(overrides) : PRICE_SEASONALITY;
  return Number(table[monthOf(date)]) || 1;
}

/**
 * Wetness pressure 0-1: how favourable the weather is to splash-borne and
 * humid-air fungal and bacterial disease. Built from rain days and humidity so
 * it still works with nothing but the calendar.
 */
function wetnessIndex(date, observed = null) {
  if (observed && observed.rainDaysLast7 != null) {
    const rd = clamp(observed.rainDaysLast7 / 7, 0, 1);
    const rh = clamp(((observed.rh ?? climateFor(date).rh) - 65) / 30, 0, 1);
    return clamp(0.6 * rd + 0.4 * rh, 0, 1);
  }
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  const rd = clamp(c.rainDays / daysInMonth, 0, 1);
  const rh = clamp((c.rh - 65) / 30, 0, 1);
  return clamp(0.6 * rd + 0.4 * rh, 0, 1);
}

/** Dryness pressure 0-1: mite and thrips weather, and when irrigation decides the crop. */
function drynessIndex(date, observed = null) {
  return clamp(1 - wetnessIndex(date, observed), 0, 1);
}

/** Waterlogging pressure: heavy monthly rain on flat ground is the Phytophthora setup. */
function waterloggingIndex(date, observed = null) {
  const c = climateFor(date);
  const monthly = observed && observed.rainLast30 != null ? observed.rainLast30 : c.rain;
  return clamp(interpolate([[80, 0], [200, 0.35], [320, 0.7], [420, 1]], monthly), 0, 1);
}

/** Irrigation shortfall in mm/day: crop demand minus what the sky is giving. */
function irrigationGapMmPerDay(date, cropDemandMmPerDay, observed = null) {
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  const rainPerDay = observed && observed.rainLast30 != null
    ? observed.rainLast30 / 30 : c.rain / daysInMonth;
  const effective = rainPerDay * 0.7; // runoff and evaporation take the rest
  return Math.max(0, cropDemandMmPerDay - effective);
}

/** Litres per plant per day from a mm/day shortfall and the plant's ground area. */
function litresPerPlantPerDay(mmPerDay, spacing) {
  const areaM2 = spacing.inRow * spacing.betweenRow;
  return Math.round(mmPerDay * areaM2 * 10) / 10; // 1 mm over 1 m2 = 1 litre
}

/**
 * Optional live forecast from Open-Meteo. No API key, no account. Returns null
 * on any failure so every caller falls back to climatology without a fuss.
 */
async function fetchForecast(lat = FARM_LOCATION.lat, lon = FARM_LOCATION.lon, signal = null) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean'
    + `&past_days=7&forecast_days=7&timezone=${encodeURIComponent(FARM_LOCATION.tz)}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.daily;
    if (!d || !Array.isArray(d.time)) return null;
    return {
      fetchedAt: new Date().toISOString(),
      days: d.time.map((t, i) => ({
        date: t,
        tmax: d.temperature_2m_max[i],
        tmin: d.temperature_2m_min[i],
        rain: d.precipitation_sum[i],
        rh: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
      })),
    };
  } catch {
    return null;
  }
}

/** Turn a forecast (or logged rain readings) into the observed shape the indices take. */
function summariseObserved(days, today = new Date()) {
  if (!days || !days.length) return null;
  const t = isoDate(today);
  const past = days.filter((d) => d.date <= t);
  const last7 = past.slice(-7);
  const last30 = past.slice(-30);
  if (!last7.length) return null;
  const rainDaysLast7 = last7.filter((d) => (d.rain || 0) >= 1).length;
  const rainLast30 = last30.reduce((s, d) => s + (d.rain || 0), 0) * (30 / Math.max(last30.length, 1));
  const rh = last7.reduce((s, d) => s + (d.rh ?? 85), 0) / last7.length;
  return {
    rainDaysLast7,
    rainLast7: last7.reduce((s, d) => s + (d.rain || 0), 0),
    rainLast30: Math.round(rainLast30),
    rh: Math.round(rh),
    tmaxMean: last7.reduce((s, d) => s + (d.tmax ?? 30), 0) / last7.length,
  };
}

/** Next few days in plain words, for the worker's home screen. */
function forecastHeadline(forecast, today = new Date()) {
  if (!forecast) {
    const c = climateFor(today);
    return { text: `${SEASON_LABELS[c.season]} — about ${c.rainDays} rain days this month`, live: false };
  }
  const t = isoDate(today);
  const ahead = forecast.days.filter((d) => d.date >= t).slice(0, 3);
  const wet = ahead.filter((d) => (d.rain || 0) >= 5).length;
  if (wet >= 2) return { text: 'Heavy rain in the next 3 days — hold off spraying, check drains', live: true };
  if (wet === 1) return { text: 'Rain expected within 3 days — spray early and let it dry', live: true };
  return { text: 'Dry spell in the next 3 days — irrigate and watch for mites', live: true };
}
})(__dvModule("web/js/domain/climate.js"));
__dvBindAll();

// ─── web/js/domain/safety.js ───────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "HAZARD": { enumerable: true, get: () => HAZARD },
  "PRODUCTS": { enumerable: true, get: () => PRODUCTS },
  "PRODUCT_BY_ID": { enumerable: true, get: () => PRODUCT_BY_ID },
  "productsFor": { enumerable: true, get: () => productsFor },
  "discouragedFor": { enumerable: true, get: () => discouragedFor },
  "safeHarvestDate": { enumerable: true, get: () => safeHarvestDate },
  "reentryAt": { enumerable: true, get: () => reentryAt },
  "harvestClearance": { enumerable: true, get: () => harvestClearance },
  "reentryClearance": { enumerable: true, get: () => reentryClearance },
  "resistanceWarnings": { enumerable: true, get: () => resistanceWarnings },
  "SPRAY_RULES": { enumerable: true, get: () => SPRAY_RULES },
  "KNAPSACK_L": { enumerable: true, get: () => KNAPSACK_L },
  "knapsackPlan": { enumerable: true, get: () => knapsackPlan },
});
let addDays, daysBetween, isoDate, parseDate;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; }, (m) => { parseDate = m.parseDate; });
// Spray safety: who can go back into a sprayed bed, when the fruit is safe to
// pick and sell, and whether the farm is burning through one chemical family
// fast enough to breed resistance.
//
// The pre-harvest interval is the part that matters most. A bed sprayed on
// Monday with a 7-day product must not be picked on Wednesday, whatever the
// buyer is offering. The app therefore treats PHI as a hard block on harvest
// logging, not a suggestion.
//
// PHI and re-entry figures here are typical label values. Labels differ by
// country, formulation and concentration, and the label on the container in
// your store is the one that counts. Where the two disagree, follow the label
// and correct the figure in Settings.



const HAZARD = {
  low: { label: 'Lower hazard', colour: '#2e7d5b' },
  moderate: { label: 'Moderate hazard', colour: '#c77800' },
  high: { label: 'High hazard', colour: '#b23c3c' },
  avoid: { label: 'Do not use on pepper', colour: '#7a1f1f' },
};

/**
 * The products a pepper farm around Port Harcourt actually buys, with the
 * numbers the app needs to keep people and fruit safe.
 *
 * phiDays  days from spraying until fruit may be picked
 * reiHours hours until a worker may re-enter without protective gear
 * group    resistance group (FRAC for fungicides, IRAC for insecticides)
 */
const PRODUCTS = [
  // --- Fungicides and bactericides ---
  { id: 'mancozeb', name: 'Mancozeb 80% WP', examples: 'Z-Force, Dithane M-45', kind: 'fungicide',
    group: 'FRAC M03', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['anthracnose', 'bacterial_leaf_spot', 'cercospora_leaf_spot', 'choanephora_wet_rot'],
    note: 'Protectant. It has to be on the plant before the spores land, so spray ahead of rain, not after.' },
  { id: 'copper_oxychloride', name: 'Copper oxychloride', examples: 'Champ, Kocide', kind: 'fungicide',
    group: 'FRAC M01', phiDays: 3, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['bacterial_leaf_spot', 'anthracnose', 'phytophthora_blight'],
    note: 'Cheap and broad. Copper builds up in soil over years, so do not exceed the label rate.' },
  { id: 'metalaxyl_mancozeb', name: 'Metalaxyl-M + mancozeb', examples: 'Ridomil Gold MZ 68WG', kind: 'fungicide',
    group: 'FRAC 4 + M03', phiDays: 14, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['phytophthora_blight', 'damping_off'],
    note: 'The Phytophthora product. Long wait before picking, so plan it around the harvest round.' },
  { id: 'azoxystrobin', name: 'Azoxystrobin', examples: 'Amistar', kind: 'fungicide',
    group: 'FRAC 11', phiDays: 3, reiHours: 12, hazard: 'low', bee: 'low',
    targets: ['anthracnose', 'cercospora_leaf_spot', 'powdery_mildew'],
    note: 'Never twice in a row. Resistance to this group builds faster than to any other.' },
  { id: 'difenoconazole', name: 'Difenoconazole', examples: 'Score 250EC', kind: 'fungicide',
    group: 'FRAC 3', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['anthracnose', 'cercospora_leaf_spot', 'powdery_mildew'], note: '' },
  { id: 'carbendazim', name: 'Carbendazim 50WP', examples: 'Bendazim', kind: 'fungicide',
    group: 'FRAC 1', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['fusarium_wilt', 'anthracnose'],
    note: 'Widespread resistance already. Useful as a drench, weak as a routine spray.' },
  { id: 'fosetyl_al', name: 'Fosetyl-aluminium', examples: 'Aliette', kind: 'fungicide',
    group: 'FRAC P07', phiDays: 7, reiHours: 12, hazard: 'low', bee: 'low',
    targets: ['phytophthora_blight'], note: 'Moves both up and down inside the plant.' },
  { id: 'sulphur', name: 'Wettable sulphur', examples: 'Thiovit, Kumulus', kind: 'fungicide',
    group: 'FRAC M02', phiDays: 1, reiHours: 24, hazard: 'low', bee: 'low',
    targets: ['powdery_mildew', 'red_spider_mite', 'broad_mite'],
    note: 'Do not spray above 32°C or you scorch the leaves. Never within two weeks of an oil spray.' },

  // --- Insecticides and miticides ---
  { id: 'bt', name: 'Bacillus thuringiensis', examples: 'Dipel', kind: 'biological',
    group: 'IRAC 11A', phiDays: 0, reiHours: 4, hazard: 'low', bee: 'none',
    targets: ['fruit_borer'],
    note: 'Safest thing you can spray during picking. Only works on small caterpillars, and only in the evening: sunlight destroys it.' },
  { id: 'neem', name: 'Neem oil / azadirachtin', examples: 'Neemazal, home-made kernel extract', kind: 'biological',
    group: 'IRAC UN', phiDays: 0, reiHours: 4, hazard: 'low', bee: 'low',
    targets: ['aphids', 'whitefly', 'thrips', 'red_spider_mite', 'mealybug'],
    note: 'No waiting period, so it fits the harvest window. Repeat every 5-7 days; one spray does little.' },
  { id: 'spinosad', name: 'Spinosad', examples: 'Tracer, Laser', kind: 'insecticide',
    group: 'IRAC 5', phiDays: 3, reiHours: 4, hazard: 'low', bee: 'high while wet',
    targets: ['thrips', 'fruit_borer', 'fruit_fly'],
    note: 'Spray at dusk. It is harmless to bees once the spray has dried, but deadly while wet.' },
  { id: 'emamectin', name: 'Emamectin benzoate', examples: 'Emastar, Warrior', kind: 'insecticide',
    group: 'IRAC 6', phiDays: 3, reiHours: 12, hazard: 'moderate', bee: 'moderate',
    targets: ['fruit_borer', 'thrips'], note: 'Short wait, strong on caterpillars.' },
  { id: 'abamectin', name: 'Abamectin', examples: 'Dynamec, Abamex', kind: 'miticide',
    group: 'IRAC 6', phiDays: 7, reiHours: 12, hazard: 'high', bee: 'moderate',
    targets: ['red_spider_mite', 'broad_mite', 'thrips'],
    note: 'Same resistance group as emamectin. Using both back to back counts as using one twice.' },
  { id: 'acetamiprid', name: 'Acetamiprid', examples: 'Mospilan', kind: 'insecticide',
    group: 'IRAC 4A', phiDays: 7, reiHours: 12, hazard: 'moderate', bee: 'moderate',
    targets: ['aphids', 'whitefly', 'mealybug', 'leaf_curl_virus'], note: '' },
  { id: 'imidacloprid', name: 'Imidacloprid', examples: 'Confidor, Imiforce', kind: 'insecticide',
    group: 'IRAC 4A', phiDays: 14, reiHours: 12, hazard: 'high', bee: 'very high',
    targets: ['aphids', 'whitefly', 'leaf_curl_virus'],
    note: 'Never while flowers are open. It kills the bees that set your fruit, and you pay for that twice.' },
  { id: 'spiromesifen', name: 'Spiromesifen', examples: 'Oberon', kind: 'miticide',
    group: 'IRAC 23', phiDays: 3, reiHours: 12, hazard: 'moderate', bee: 'low',
    targets: ['whitefly', 'red_spider_mite'], note: 'Hits eggs and young stages. Good rotation partner.' },
  { id: 'lambda_cyhalothrin', name: 'Lambda-cyhalothrin', examples: 'Karate, Lambda Super 2.5EC', kind: 'insecticide',
    group: 'IRAC 3A', phiDays: 7, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['aphids', 'thrips', 'variegated_grasshopper', 'fruit_borer'],
    note: 'Kills everything including the predators. Routine use is the fastest way to get a spider mite outbreak.' },
  { id: 'cypermethrin', name: 'Cypermethrin', examples: 'Cyperforce, Best', kind: 'insecticide',
    group: 'IRAC 3A', phiDays: 7, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['fruit_borer', 'variegated_grasshopper'],
    note: 'Same group as lambda-cyhalothrin. Swapping between them is not a rotation.' },
  { id: 'fipronil', name: 'Fipronil', examples: '-', kind: 'insecticide',
    group: 'IRAC 2B', phiDays: 14, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['termites'], note: 'Soil and nest treatment only. Never spray it onto fruit.' },

  // --- Fertilisers and correctives, listed so they can be logged like any other input ---
  { id: 'calcium_nitrate', name: 'Calcium nitrate (foliar)', examples: '-', kind: 'nutrient',
    group: '-', phiDays: 0, reiHours: 0, hazard: 'low', bee: 'none',
    targets: ['blossom_end_rot'], note: 'A nutrient, not a pesticide. No waiting period.' },
  { id: 'epsom', name: 'Magnesium sulphate (Epsom salt)', examples: '-', kind: 'nutrient',
    group: '-', phiDays: 0, reiHours: 0, hazard: 'low', bee: 'none',
    targets: ['magnesium_deficiency'], note: '' },

  // --- Products to keep off this farm ---
  //
  // Carbofuran (Furadan) is not here, and its absence is the requirement.
  // FR-STOCK-09 and rules labels.banned say a banned active must not ship in
  // the catalogue at all, "not even flagged as 'avoid'" — a greyed-out row is
  // still a row somebody can ask about, and the rules' answer is that this
  // farm does not hold the product. domain/catalogue.js refuses it by name on
  // the way in, for every role including the Owner. The nematode guidance in
  // domain/pests.js still says plainly why nobody should go looking for it.
  { id: 'paraquat', name: 'Paraquat', examples: 'Gramoxone', kind: 'herbicide',
    group: 'HRAC D', phiDays: 60, reiHours: 48, hazard: 'avoid', bee: 'low',
    targets: [],
    note: 'A mouthful is fatal and there is no antidote. Banned in over 60 countries. Never store it near drinking water '
      + 'or in an unlabelled bottle, and never use the same knapsack afterwards for anything else.' },
  { id: 'chlorpyrifos', name: 'Chlorpyrifos', examples: 'Dursban', kind: 'insecticide',
    group: 'IRAC 1B', phiDays: 21, reiHours: 48, hazard: 'avoid', bee: 'very high',
    targets: ['termites', 'fruit_borer'],
    note: 'Withdrawn from food crops in the EU and US over harm to children. Buyers increasingly test for it.' },
  { id: 'dimethoate', name: 'Dimethoate', examples: 'Rogor', kind: 'insecticide',
    group: 'IRAC 1B', phiDays: 21, reiHours: 48, hazard: 'avoid', bee: 'very high',
    targets: ['aphids', 'fruit_fly'],
    note: 'Three weeks before you can pick, and harsh on whoever sprays it. On a crop picked weekly it does not fit.' },
];

const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

function productsFor(problemId) {
  return PRODUCTS.filter((p) => p.targets.includes(problemId) && p.hazard !== 'avoid');
}

function discouragedFor(problemId) {
  return PRODUCTS.filter((p) => p.targets.includes(problemId) && p.hazard === 'avoid');
}

/** Date fruit from this application becomes safe to pick. */
function safeHarvestDate(application) {
  const product = PRODUCT_BY_ID[application.productId];
  const phi = application.phiDays ?? product?.phiDays ?? 0;
  return isoDate(addDays(application.date, phi));
}

/** Time workers may go back in without protective clothing. */
function reentryAt(application) {
  const product = PRODUCT_BY_ID[application.productId];
  const hours = application.reiHours ?? product?.reiHours ?? 24;
  const base = application.at ? new Date(application.at) : parseDate(application.date);
  return new Date(base.getTime() + hours * 3600000);
}

/**
 * Can this bed be picked today?
 * Returns the blocking application and the date it clears, so the answer the
 * worker sees is "not until Friday" and not just "no".
 */
function harvestClearance(applications, onDate = new Date()) {
  const today = isoDate(onDate);
  let blocker = null;
  for (const app of applications) {
    const clear = safeHarvestDate(app);
    if (clear > today && (!blocker || clear > blocker.clearOn)) {
      blocker = {
        clearOn: clear,
        daysLeft: daysBetween(today, clear),
        application: app,
        product: PRODUCT_BY_ID[app.productId] || { name: app.productName || 'Unknown product' },
      };
    }
  }
  if (!blocker) return { safe: true, clearOn: today, blocker: null };
  return {
    safe: false,
    clearOn: blocker.clearOn,
    daysLeft: blocker.daysLeft,
    blocker,
    reason: `${blocker.product.name} was applied on ${blocker.application.date}. `
      + `Fruit from this bed is not safe to pick or sell until ${blocker.clearOn}.`,
  };
}

/** Whether it is safe to send someone into the bed right now, unprotected. */
function reentryClearance(applications, at = new Date()) {
  let blocker = null;
  for (const app of applications) {
    const until = reentryAt(app);
    if (until > at && (!blocker || until > blocker.until)) {
      blocker = { until, application: app, product: PRODUCT_BY_ID[app.productId] };
    }
  }
  if (!blocker) return { safe: true, blocker: null };
  const hours = Math.ceil((blocker.until - at) / 3600000);
  return {
    safe: false,
    until: blocker.until,
    hoursLeft: hours,
    blocker,
    reason: `${blocker.product?.name || 'A spray'} was applied here. Nobody goes in without gloves, `
      + `boots, long sleeves and a mask for another ${hours} hour${hours === 1 ? '' : 's'}.`,
  };
}

/**
 * Resistance check: the same chemical group used again and again stops working,
 * usually just when a season depends on it. Warn on a third consecutive use of
 * one group against one problem.
 */
function resistanceWarnings(applications, withinDays = 60, today = new Date()) {
  const recent = applications
    .filter((a) => daysBetween(a.date, today) <= withinDays)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const byGroup = new Map();
  for (const app of recent) {
    const product = PRODUCT_BY_ID[app.productId];
    if (!product || product.group === '-') continue;
    const entry = byGroup.get(product.group) || { group: product.group, uses: [], kind: product.kind };
    entry.uses.push({ date: app.date, product: product.name, bedId: app.bedId });
    byGroup.set(product.group, entry);
  }
  const warnings = [];
  for (const entry of byGroup.values()) {
    if (entry.uses.length >= 3) {
      warnings.push({
        group: entry.group,
        count: entry.uses.length,
        products: [...new Set(entry.uses.map((u) => u.product))],
        message: `${entry.group} has been used ${entry.uses.length} times in the last ${withinDays} days. `
          + 'Switch to a different resistance group for the next spray or it will stop working on you.',
        alternatives: PRODUCTS
          .filter((p) => p.kind === entry.kind && p.group !== entry.group && p.hazard !== 'avoid')
          .slice(0, 3).map((p) => p.name),
      });
    }
  }
  return warnings;
}

/** Plain-language safety rules, shown before anyone logs a spray. */
const SPRAY_RULES = [
  'Wear the gear: long sleeves, trousers, boots, gloves, and a mask or cloth over nose and mouth. Every time.',
  'Never spray with the wind blowing into your face, and never into your neighbour\'s field.',
  'Spray early morning or late evening. Midday heat wastes the chemical and burns the crop.',
  'Do not eat, drink or smoke while spraying. Wash hands and face before you do.',
  'Mix outside, downwind, and never with your bare hands or in a cooking bowl.',
  'Keep the empty container out of the house. Triple-rinse it, puncture it, and bury or return it. Never reuse it for water.',
  'Write the spray in the app before you leave the field, so nobody picks that bed too early.',
  'Anybody pregnant or under 18 does not mix or spray. That is not negotiable.',
];

/**
 * The knapsack this farm actually carries.
 *
 * FR-TREAT-03 and FR-DOC-05 both name 16 L, and it is the size on the shelf.
 * Every dose in the app is worked out against this one number, so a sprayer
 * filling from the schedule and a sprayer filling from the Farm Doctor put the
 * same amount in the same tank.
 */
const KNAPSACK_L = 16;

/** Rough spray volume for a knapsack operator, so the mix is not guesswork. */
function knapsackPlan(areaM2, rateMlPerLoad = 30, volumeLPerHa = 400) {
  const ha = areaM2 / 10000;
  const litres = Math.max(1, Math.round(ha * volumeLPerHa));
  const loads = Math.max(1, Math.ceil(litres / KNAPSACK_L));
  return {
    litres,
    loads,
    knapsackL: KNAPSACK_L,
    perLoadMl: rateMlPerLoad,
    totalProductMl: Math.round(loads * rateMlPerLoad),
    text: `${litres} L of spray in about ${loads} knapsack load${loads === 1 ? '' : 's'} of ${KNAPSACK_L} L, `
      + `${rateMlPerLoad} ml of product per load.`,
  };
}
})(__dvModule("web/js/domain/safety.js"));
__dvBindAll();

// ─── web/js/domain/alerts.js ───────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "DEFAULT_THRESHOLDS": { enumerable: true, get: () => DEFAULT_THRESHOLDS },
  "DEFAULT_LADDER": { enumerable: true, get: () => DEFAULT_LADDER },
  "ALERT_LEVEL": { enumerable: true, get: () => ALERT_LEVEL },
  "OWNER_LEVELS": { enumerable: true, get: () => OWNER_LEVELS },
  "ladderFor": { enumerable: true, get: () => ladderFor },
  "ladderRungs": { enumerable: true, get: () => ladderRungs },
  "escalationFor": { enumerable: true, get: () => escalationFor },
  "thresholdFor": { enumerable: true, get: () => thresholdFor },
  "breaches": { enumerable: true, get: () => breaches },
  "scoutZone": { enumerable: true, get: () => scoutZone },
  "alerts": { enumerable: true, get: () => alerts },
  "levelFor": { enumerable: true, get: () => levelFor },
  "openAlerts": { enumerable: true, get: () => openAlerts },
  "trend": { enumerable: true, get: () => trend },
  "zoneTrends": { enumerable: true, get: () => zoneTrends },
  "risingWarnings": { enumerable: true, get: () => risingWarnings },
  "IMMEDIATE_TO_OWNER": { enumerable: true, get: () => IMMEDIATE_TO_OWNER },
  "POD_BORER_TO_OWNER": { enumerable: true, get: () => POD_BORER_TO_OWNER },
  "weekOf": { enumerable: true, get: () => weekOf },
  "ORGANICS_ONLY_FROM_WEEK": { enumerable: true, get: () => ORGANICS_ONLY_FROM_WEEK },
  "WEEK_10_ORGANICS": { enumerable: true, get: () => WEEK_10_ORGANICS },
  "isSyntheticFromWeek10": { enumerable: true, get: () => isSyntheticFromWeek10 },
  "straightToOwner": { enumerable: true, get: () => straightToOwner },
  "kpis": { enumerable: true, get: () => kpis },
  "weekStart": { enumerable: true, get: () => weekStart },
  "kpisByWeek": { enumerable: true, get: () => kpisByWeek },
  "kpisByZone": { enumerable: true, get: () => kpisByZone },
});
let addDays, daysBetween, isoDate;
let PROBLEM_BY_ID;
let PRODUCT_BY_ID;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/domain/pests.js", (m) => { PROBLEM_BY_ID = m.PROBLEM_BY_ID; });
__dvImport("web/js/domain/safety.js", (m) => { PRODUCT_BY_ID = m.PRODUCT_BY_ID; });
// Thresholds, alerts and the escalation ladder — requirements 6.5.
//
// This is root cause number two: thrips controlled too late. Not unnoticed —
// late. Somebody saw them, somebody wrote it down, and the spray went on after
// the tospovirus was already in the house. The gap between seeing and acting is
// the thing this file exists to close, and KPI-01 measures it: threshold breach
// to treatment done, twenty-four hours.
//
// Alerts are DERIVED, never stored.
//
// That is the important decision here. An alert is not a row somebody flips to
// "closed"; it is what the records mean when you read them in order. A count
// over threshold opens one. A diagnosis and a treatment — or a recorded
// decision not to treat — close it. Elapsed time decides how far up the ladder
// it has climbed. Nothing can be closed by clicking; it closes because the work
// that answers it exists.
//
// That matters on a farm with five phones and intermittent signal. Two people
// cannot disagree about whether an alert is open, because neither of them holds
// the answer — the event log does, and it merges without conflict.





/**
 * Action thresholds — FR-SCOUT-02.
 *
 * AWAITING Rev 5: the document points at "the Rev 5 triage table" for the real
 * numbers and I do not have it. These are defensible published figures for
 * capsicum under cover, and every one of them is editable by the Owner in
 * settings, which is what FR-SCOUT-02 requires. Replace them from Rev 5 before
 * launch rather than after.
 *
 * `perTrap` is what a sticky trap is allowed to hold between checks.
 * `perPlant` is what ten inspected plants are allowed to average.
 * Greenhouse figures are tighter than field: a house is a closed room, so a
 * population that would be tolerable outside compounds inside it.
 */
const DEFAULT_THRESHOLDS = {
  thrips: {
    greenhouse: { perTrap: 10, perPlant: 2 },
    field: { perTrap: 25, perPlant: 5 },
    // Thrips are not judged on damage alone. They carry tospovirus, and the
    // virus arrives long before the feeding scars look serious.
    note: 'Vector for tospovirus. Treat on the count, not on the damage.',
    vector: true,
  },
  whitefly: {
    greenhouse: { perTrap: 15, perPlant: 3 },
    field: { perTrap: 40, perPlant: 8 },
    note: 'Vector for leaf curl virus. A rising trap count is the warning.',
    vector: true,
  },
  aphids: {
    greenhouse: { perTrap: 20, perPlant: 10 },
    field: { perTrap: 50, perPlant: 20 },
    note: 'Vector for CMV and PVMV. Ants on the plants usually mean aphids under the leaves.',
    vector: true,
  },
  red_spider_mite: {
    greenhouse: { perPlant: 5 },
    field: { perPlant: 10 },
    note: 'Dry, hot weather is when this one runs away. Check leaf undersides.',
  },
  broad_mite: {
    greenhouse: { perPlant: 2 },
    field: { perPlant: 4 },
    note: 'Too small to see. Judge on the curled, shiny growing tips.',
  },
  fruit_borer: {
    greenhouse: { perPlant: 1 },
    field: { perPlant: 2 },
    note: 'One bored fruit per ten plants is already a spray decision — the damage is the crop itself.',
  },
  fruit_fly: {
    greenhouse: { perTrap: 5 },
    field: { perTrap: 10 },
  },
  mealybug: {
    greenhouse: { perPlant: 3 },
    field: { perPlant: 6 },
  },
  variegated_grasshopper: {
    field: { perPlant: 2 },
    greenhouse: { perPlant: 1 },
  },
};

/**
 * The escalation ladder — FR-SCOUT-04, from rules C-12 (`escalation.threshold_alert`).
 *
 * Four rungs, not three, and the fourth is not a person:
 *
 *   0 h   Farm Manager        the moment the count is recorded
 *   4 h   Field Supervisor    if nobody has acknowledged it
 *  12 h   Owner               if it is still not closed
 *  24 h   Owner, KPI breach   still not closed: this is KPI-01 failing
 *
 * D-4 settled these timings, so they are no longer bracketed guesses — but they
 * are still settings rather than constants, because the requirement asks for
 * the ladder to be shortened for testing (§9) and an Owner should not need a
 * release to do it.
 */
const DEFAULT_LADDER = {
  // Straight to the Farm Manager the moment the count is recorded.
  managerAtOnce: true,
  // Nobody acknowledged it → the Field Supervisor.
  supervisorAfterHours: 4,
  // Still not closed → the Owner.
  ownerAfterHours: 12,
  // Still not closed a day later. The alert does not move to anybody new; what
  // changes is that KPI-01 has been missed, and the digest says so.
  kpiBreachAfterHours: 24,
};

const ALERT_LEVEL = {
  manager: { rank: 1, label: 'Farm Manager', role: 'manager', tone: 'warn' },
  supervisor: { rank: 2, label: 'Field Supervisor', role: 'supervisor', tone: 'warn' },
  owner: { rank: 3, label: 'Owner', role: 'ceo', tone: 'danger' },
  kpi: { rank: 4, label: 'Owner — KPI breach', role: 'ceo', tone: 'danger' },
};

/** The levels that put an alert in front of the Owner. */
const OWNER_LEVELS = new Set(['owner', 'kpi']);

/** The ladder in force, after the Owner's edits. */
function ladderFor(settings = {}) {
  return { ...DEFAULT_LADDER, ...((settings && settings.ladder) || {}) };
}

/**
 * The four rungs as data — FR-SCOUT-04.
 *
 * Returned as a list rather than hard-coded into the screens so the ladder can
 * be shown, tested and shortened in one place. `condition` is what stops the
 * climb at that rung: an acknowledgement stops the Supervisor being pulled in,
 * and only closing the alert stops the rest.
 */
function ladderRungs(settings = {}) {
  const ladder = ladderFor(settings);
  return [
    {
      level: 'manager', atHours: 0, to: ALERT_LEVEL.manager.label, role: 'manager',
      condition: 'as soon as the count is recorded', stoppedBy: 'closing the alert',
    },
    {
      level: 'supervisor', atHours: ladder.supervisorAfterHours, to: ALERT_LEVEL.supervisor.label,
      role: 'supervisor', condition: 'not acknowledged', stoppedBy: 'acknowledging it',
    },
    {
      level: 'owner', atHours: ladder.ownerAfterHours, to: ALERT_LEVEL.owner.label, role: 'ceo',
      condition: 'not closed', stoppedBy: 'closing the alert',
    },
    {
      level: 'kpi', atHours: ladder.kpiBreachAfterHours, to: ALERT_LEVEL.owner.label, role: 'ceo',
      condition: 'not closed', stoppedBy: 'closing the alert', kpiBreach: true,
    },
  ];
}

/**
 * Where one alert has got to on the ladder, rung by rung.
 *
 * Every rung carries when it fires and whether it has fired yet, so the screen
 * and the test read the same thing: not "it is with the Owner" but "it reached
 * the Owner at 12 h, and the Supervisor rung was skipped because Ada picked it
 * up at 02:40".
 */
function escalationFor(alert, settings = {}) {
  const rungs = ladderRungs(settings);
  const hours = alert.status === 'closed' ? (alert.hoursToClose || 0) : (alert.hoursOpen || 0);
  const acknowledged = !!alert.ack;
  const openedAt = new Date(alert.at).getTime();

  return rungs.map((rung) => {
    const skipped = rung.level === 'supervisor' && acknowledged;
    const reached = !skipped && hours >= rung.atHours;
    return {
      ...rung,
      reached,
      skipped,
      at: Number.isNaN(openedAt) ? null
        : new Date(openedAt + rung.atHours * 3600000).toISOString(),
      // Closed in time means the rung never fired, however long ago it was.
      why: skipped
        ? `Acknowledged before ${rung.atHours} h, so it never went to the ${rung.to}.`
        : reached
          ? `${rung.atHours} h passed ${rung.condition === 'not closed' ? 'without it being closed' : rung.condition}.`
          : `Fires at ${rung.atHours} h if it is still ${rung.condition === 'not acknowledged' ? 'unacknowledged' : 'open'}.`,
    };
  });
}

/** A zone is a greenhouse unless it says otherwise; open field is the exception here. */
const zoneKind = (zone) => (zone && zone.type === 'field' ? 'field' : 'greenhouse');

/** The threshold in force for one pest in one kind of zone, after Owner edits. */
function thresholdFor(pestId, zone, settings = {}) {
  const table = { ...DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) };
  const entry = table[pestId];
  if (!entry) return null;
  const kind = zoneKind(zone);
  const limits = entry[kind] || entry.greenhouse || entry.field;
  if (!limits) return null;
  return { pestId, kind, ...limits, note: entry.note || null, vector: !!entry.vector };
}

/**
 * Did this scouting record cross its threshold?
 *
 * A record carries either a trap count or a per-plant count, and they are
 * judged against different numbers. Where a record has both, either one over
 * the line is a breach — a trap catching nothing while the plants are covered
 * means the trap is in the wrong place, not that the house is clean.
 */
function breaches(scout, zone, settings = {}) {
  const limit = thresholdFor(scout.pestId, zone, settings);
  if (!limit) return null;

  const hits = [];
  if (limit.perTrap != null && scout.trapCount != null && Number(scout.trapCount) >= limit.perTrap) {
    hits.push({ kind: 'trap', count: Number(scout.trapCount), limit: limit.perTrap });
  }
  if (limit.perPlant != null && scout.perPlant != null && Number(scout.perPlant) >= limit.perPlant) {
    hits.push({ kind: 'plant', count: Number(scout.perPlant), limit: limit.perPlant });
  }
  if (!hits.length) return null;

  const worst = hits.sort((a, b) => (b.count / b.limit) - (a.count / a.limit))[0];
  return { ...worst, threshold: limit, over: Math.round((worst.count / worst.limit) * 100) - 100 };
}

/**
 * Which zone a scouting record is about.
 *
 * Through its crop where it has one. The nursery has no crop cycle, so a count
 * there carries the zone itself (FR-FARM-04, and the rules' own "thrips above
 * threshold in the nursery opens an alert like any other zone").
 */
function scoutZone(state, scout) {
  const cycle = scout && scout.cycleId ? (state.cycles || {})[scout.cycleId] : null;
  if (cycle) return (state.plots || {})[cycle.plotId] || null;
  return (scout && scout.zoneId && (state.plots || {})[scout.zoneId]) || null;
}

/**
 * Is this ack, decision or spray about the same place as the alert? The crop
 * where the alert has one; otherwise the zone, and only a record that names no
 * crop of its own.
 */
function sameSubject(record, breach) {
  if (breach.cycleId) return record.cycleId === breach.cycleId;
  return !record.cycleId && !!breach.zoneId && record.zoneId === breach.zoneId;
}

/** Hours between two instants, for the ladder. */
function hoursBetween(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, (b - a) / 3600000);
}

/**
 * What closes an alert — FR-SCOUT-05.
 *
 * A treatment on the zone after the breach, with a confirmed diagnosis behind
 * it (the gate in gates.js already guarantees that), or an explicit recorded
 * decision not to treat. Nothing else. In particular a later clean scouting
 * record does not close it: "I looked again and it seemed better" is how the
 * first one got left.
 */
function closureFor(state, breach) {
  const after = (date) => date && date >= breach.date;

  const treatment = (state.sprays || [])
    .filter((s) => sameSubject(s, breach) && after((s.date || '').slice(0, 10)))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (treatment) {
    return {
      kind: 'treated',
      at: treatment.at || `${treatment.date}T12:00:00.000Z`,
      what: `${treatment.productName || treatment.productId} applied`,
      by: treatment.by,
    };
  }

  const decision = (state.alertDecisions || [])
    .filter((d) => sameSubject(d, breach) && d.pestId === breach.pestId)
    .filter((d) => (d.at || '') >= breach.at)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
  if (decision) {
    return {
      kind: 'decided',
      at: decision.at,
      what: `Decided not to treat: ${decision.reason}`,
      by: decision.by,
    };
  }

  return null;
}

/** Has anyone said they have seen it? An acknowledgement stops the second rung. */
function ackFor(state, breach) {
  return (state.alertAcks || [])
    .filter((a) => sameSubject(a, breach) && a.pestId === breach.pestId)
    .filter((a) => (a.at || '') >= breach.at)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? -1 : 1))[0] || null;
}

/**
 * Every alert the records imply, open and closed — FR-SCOUT-03/04/05.
 *
 * One alert per zone per pest per breach. A second breach of the same pest in
 * the same zone while the first is still open does not open a second alert; it
 * raises the count on the one already running, because two alerts for one
 * problem is how a board becomes wallpaper.
 */
function alerts(state, { now = new Date().toISOString(), settings = null } = {}) {
  const config = settings || state.settings || {};
  const ladder = { ...DEFAULT_LADDER, ...(config.ladder || {}) };
  const out = [];
  const openByKey = new Map();

  const scouts = [...(state.scouts || [])]
    .filter((s) => s.pestId)
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? -1 : 1));

  for (const scout of scouts) {
    const zone = scoutZone(state, scout);
    const hit = breaches(scout, zone, config);
    if (!hit) continue;

    // One alert per crop per pest — or, in the nursery, per zone per pest.
    const key = `${scout.cycleId || `zone:${zone ? zone.id : scout.zoneId}`}::${scout.pestId}`;
    const running = openByKey.get(key);
    if (running) {
      // Same problem, same zone, still open: this is more evidence, not a new alert.
      running.sightings.push({ at: scout.at || scout.date, count: hit.count, kind: hit.kind });
      running.worst = Math.max(running.worst, hit.count);
      continue;
    }

    const at = scout.at || `${scout.date}T12:00:00.000Z`;
    const breach = {
      id: `alert:${scout.id}`,
      cycleId: scout.cycleId || null,
      zoneId: zone ? zone.id : (scout.zoneId || null),
      pestId: scout.pestId,
      pestName: (PROBLEM_BY_ID[scout.pestId] || {}).name || scout.pestId,
      zone: zone || null,
      zoneName: zone ? zone.name : 'unknown zone',
      date: (scout.date || at).slice(0, 10),
      at,
      raisedBy: scout.by,
      count: hit.count,
      worst: hit.count,
      limit: hit.limit,
      countKind: hit.kind,
      overPct: hit.over,
      vector: hit.threshold.vector,
      note: hit.threshold.note,
      sightings: [{ at, count: hit.count, kind: hit.kind }],
      // FR-SCOUT-03: the 24-hour deadline is set when the alert opens, not when
      // somebody gets round to looking at it.
      dueAt: new Date(new Date(at).getTime() + ladder.kpiBreachAfterHours * 3600000).toISOString(),
    };

    const closure = closureFor(state, breach);
    const ack = ackFor(state, breach);

    if (closure) {
      breach.status = 'closed';
      breach.closure = closure;
      breach.ack = ack;
      // KPI-01: this is the number the whole section exists to move.
      breach.hoursToClose = Math.round(hoursBetween(at, closure.at) * 10) / 10;
      breach.withinDeadline = breach.hoursToClose <= ladder.kpiBreachAfterHours;
      breach.kpiBreach = !breach.withinDeadline;
      breach.level = levelFor(breach.hoursToClose, !!ack, ladder);
    } else {
      breach.status = 'open';
      breach.ack = ack;
      breach.hoursOpen = Math.round(hoursBetween(at, now) * 10) / 10;
      breach.overdue = breach.hoursOpen >= ladder.kpiBreachAfterHours;
      breach.level = levelFor(breach.hoursOpen, !!ack, ladder);
      breach.kpiBreach = breach.level === 'kpi';
      openByKey.set(key, breach);
    }
    // FR-SCOUT-04: the whole ladder, rung by rung, on the alert itself — so a
    // screen can show what has already been tried and a test can check it end
    // to end rather than inferring it from one label.
    breach.escalation = escalationFor(breach, { ladder });
    breach.levelLabel = ALERT_LEVEL[breach.level].label;
    out.push(breach);
  }

  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'open') return (b.hoursOpen || 0) - (a.hoursOpen || 0);
    return (a.at < b.at ? 1 : -1);
  });
}

/**
 * How far up the ladder — FR-SCOUT-04.
 *
 * Acknowledging stops the climb to the Supervisor, because somebody has picked
 * it up. It does not stop the climb to the Owner: only closing it does. "Seen
 * it" is not "dealt with", and Season 1 was full of seen.
 */
function levelFor(hoursOpen, acknowledged, ladder = DEFAULT_LADDER) {
  const full = { ...DEFAULT_LADDER, ...(ladder || {}) };
  // The top rung is the same person as the one below it. What it adds is the
  // KPI breach: a day gone by with the thing still open is the failure KPI-01
  // was written to count, and calling it "with the Owner" hides that.
  if (hoursOpen >= full.kpiBreachAfterHours) return 'kpi';
  if (hoursOpen >= full.ownerAfterHours) return 'owner';
  if (!acknowledged && hoursOpen >= full.supervisorAfterHours) return 'supervisor';
  return 'manager';
}

/** Just the ones still open, worst first. The board people actually work from. */
function openAlerts(state, opts = {}) {
  return alerts(state, opts).filter((a) => a.status === 'open');
}

/**
 * FR-SCOUT-06/07 — the trend, and the warning before the line is crossed.
 *
 * A count that is climbing is more useful than a count that is high: it says
 * how many days are left before the decision has to be made.
 */
function trend(state, cycleId, pestId, { weeks = 8, today = isoDate(), settings = null } = {}) {
  const config = settings || state.settings || {};
  const cycle = (state.cycles || {})[cycleId];
  const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
  const limit = thresholdFor(pestId, zone, config);
  const from = isoDate(addDays(today, -weeks * 7));

  const points = (state.scouts || [])
    .filter((s) => s.cycleId === cycleId && s.pestId === pestId && s.date >= from)
    .map((s) => ({
      date: s.date,
      count: Number(s.trapCount ?? s.perPlant ?? 0),
      kind: s.trapCount != null ? 'trap' : 'plant',
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const line = limit ? (points.some((p) => p.kind === 'trap') ? limit.perTrap : limit.perPlant) : null;

  // Two readings say nothing about a trend; three is the fewest that can.
  let rising = null;
  if (points.length >= 3 && line) {
    const last3 = points.slice(-3);
    const climbing = last3[2].count > last3[1].count && last3[1].count > last3[0].count;
    const step = (last3[2].count - last3[0].count) / 2;
    if (climbing && step > 0 && last3[2].count < line) {
      const checksLeft = Math.ceil((line - last3[2].count) / step);
      rising = {
        step: Math.round(step * 10) / 10,
        checksToThreshold: checksLeft,
        // FR-SCOUT-07: yellow before red, so the spray can be planned rather
        // than scrambled.
        why: `Up ${Math.round(step)} a check for three checks running. At this rate it crosses `
          + `${line} in about ${checksLeft} more check${checksLeft === 1 ? '' : 's'}.`,
      };
    }
  }

  return { points, line, rising, pestId, limit };
}

/**
 * FR-SCOUT-06 — one trend per zone, per pest, ready to draw.
 *
 * Trap counts first, because the traps are the number the thresholds are set
 * against and the ones counted daily. A pest with no counts at all is left out
 * rather than drawn as an empty chart.
 */
function zoneTrends(state, { today = isoDate(), weeks = 8, settings = null, zoneId = null } = {}) {
  const seen = new Set();
  const out = [];

  for (const s of state.scouts || []) {
    if (!s.pestId || !s.cycleId) continue;
    const key = `${s.cycleId}::${s.pestId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cycle = (state.cycles || {})[s.cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    if (zoneId && (!zone || zone.id !== zoneId)) continue;

    const t = trend(state, s.cycleId, s.pestId, { weeks, today, settings });
    if (!t.points.length) continue;
    const last = t.points[t.points.length - 1];
    out.push({
      cycleId: s.cycleId,
      zoneId: zone ? zone.id : null,
      zoneName: zone ? zone.name : 'unknown zone',
      pestId: s.pestId,
      pestName: (PROBLEM_BY_ID[s.pestId] || {}).name || s.pestId,
      trend: t,
      over: t.line != null && last.count >= t.line,
      rising: !!t.rising,
    });
  }

  // Whatever is over the line first, then whatever is climbing, then the rest.
  return out.sort((a, b) => Number(b.over) - Number(a.over)
    || Number(b.rising) - Number(a.rising)
    || String(a.zoneName).localeCompare(String(b.zoneName)));
}

/** Every zone-and-pest pair that is climbing but not yet over — the yellow list. */
function risingWarnings(state, opts = {}) {
  const seen = new Set();
  const out = [];
  for (const s of state.scouts || []) {
    if (!s.pestId || !s.cycleId) continue;
    const key = `${s.cycleId}::${s.pestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = trend(state, s.cycleId, s.pestId, opts);
    if (!t.rising) continue;
    const cycle = (state.cycles || {})[s.cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    out.push({
      cycleId: s.cycleId,
      pestId: s.pestId,
      pestName: (PROBLEM_BY_ID[s.pestId] || {}).name || s.pestId,
      zoneName: zone ? zone.name : 'unknown zone',
      ...t.rising,
    });
  }
  return out.sort((a, b) => a.checksToThreshold - b.checksToThreshold);
}

/**
 * The five things that go straight to the Owner — rules `escalation.immediate_to_owner`.
 *
 * These do not climb the ladder. There is no four hours with the Supervisor
 * first, because by the time the ladder has finished being polite about a
 * tospovirus the house is gone. Each one is read off the records the same way
 * an alert is, so nobody has to remember to send anything.
 *
 * The list is the rules JSON's, in its order:
 *   suspected virus (tospovirus, mosaic) · bacterial wilt · gate override ·
 *   pod borer on more than 10 plants · any synthetic logged from Week 10.
 */
const IMMEDIATE_TO_OWNER = [
  'suspected virus (tospovirus, mosaic)',
  'bacterial wilt',
  'gate override',
  'pod borer >10 plants',
  'any synthetic logged from Week 10',
];

const VIRUS_RE = /virus|tospo|mosaic|pvmv|cmv|leaf_curl/i;
const BACTERIAL_WILT_RE = /bacterial_wilt|bacterial wilt|ralstonia/i;
const BORER_RE = /borer/i;

/** Pod borer counted on more than this many plants goes to the Owner today. */
const POD_BORER_TO_OWNER = 10;

/**
 * Week counting, from the rules: transplant day is Day 1 of Week 0, and
 * `week = floor((date - T) / 7)`. Week 10 therefore starts on day 70.
 */
function weekOf(cycle, date) {
  if (!cycle || !cycle.transplantDate) return null;
  const days = daysBetween(cycle.transplantDate, date);
  return days < 0 ? null : Math.floor(days / 7);
}

/** Week 10 onwards is organics only — spray rule SR-08. */
const ORGANICS_ONLY_FROM_WEEK = 10;

/**
 * What counts as an organic from Week 10 — SR-08 names neem oil, garlic-chilli
 * and copper hydroxide, and Bt belongs with them.
 *
 * Anything not on this list is treated as a synthetic, including the copper
 * oxychloride in the catalogue. Erring that way raises a flag the Owner can
 * dismiss; erring the other way lets a synthetic through the last ten weeks of
 * the crop without anybody being told, which is the export residue problem
 * SR-08 exists to prevent.
 */
const WEEK_10_ORGANICS = new Set([
  'neem', 'bt', 'garlic_chilli', 'trichoderma', 'copper_hydroxide',
]);

function isSyntheticFromWeek10(productId) {
  if (!productId) return false;
  if (WEEK_10_ORGANICS.has(productId)) return false;
  const product = PRODUCT_BY_ID[productId];
  // A nutrient is not a pesticide, and a product nobody recognises is treated
  // as a synthetic rather than waved through.
  if (product && product.kind === 'nutrient') return false;
  return true;
}

/**
 * Everything on the straight-to-Owner list, newest first — FR-SCOUT-04.
 *
 * `days` bounds how far back it looks, so a virus from last season does not
 * live in today's digest for ever.
 */
function straightToOwner(state, { now = new Date().toISOString(), days = 7 } = {}) {
  const today = now.slice(0, 10);
  const from = isoDate(addDays(today, -days));
  const out = [];
  const where = (cycleId) => {
    const cycle = (state.cycles || {})[cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    return zone ? zone.name : 'a zone';
  };

  for (const d of state.diagnoses || []) {
    const date = (d.date || (d.at || '').slice(0, 10));
    if (!date || date < from) continue;
    const text = `${d.problemId || ''} ${d.problemName || ''}`;
    const name = d.problemName || d.problemId || 'something';
    if (VIRUS_RE.test(text)) {
      out.push({
        id: d.id, kind: 'virus', rule: IMMEDIATE_TO_OWNER[0], at: d.at || `${date}T12:00:00.000Z`, date,
        zoneName: where(d.cycleId), cycleId: d.cycleId || null,
        line: `VIRUS SUSPECTED: ${name} on ${where(d.cycleId)}`,
        detail: 'Isolate those plants, do not move tools or hands between houses, pull and burn '
          + 'the affected ones. Confirm before replanting.',
      });
    } else if (BACTERIAL_WILT_RE.test(text)) {
      out.push({
        id: d.id, kind: 'bacterial_wilt', rule: IMMEDIATE_TO_OWNER[1], at: d.at || `${date}T12:00:00.000Z`, date,
        zoneName: where(d.cycleId), cycleId: d.cycleId || null,
        line: `BACTERIAL WILT SUSPECTED on ${where(d.cycleId)}`,
        detail: 'Do not irrigate from that bed into the others. A lab sample decides it — the '
          + 'Farm Doctor never confirms this one on a photo.',
      });
    }
  }

  // An override is not an event that happened once; it is a state the farm is
  // standing in. So it is listed for as long as it stands, however long ago it
  // was granted — FR-GATE-07 says the Owner sees every one, and an override
  // quietly ageing off the list after a week is how one becomes permanent.
  for (const o of state.gateOverrides || []) {
    if (o.revoked) continue;
    const date = (o.at || '').slice(0, 10);
    const zone = (state.plots || {})[o.zoneId];
    out.push({
      id: o.id, kind: 'gate_override', rule: IMMEDIATE_TO_OWNER[2], at: o.at, date,
      zoneName: zone ? zone.name : 'a zone', cycleId: null,
      line: `Gate override on ${zone ? zone.name : 'a zone'} — ${o.gate}`,
      detail: `Reason given: ${o.reason || 'none recorded'}`,
    });
  }

  for (const sc of state.scouts || []) {
    const date = sc.date || (sc.at || '').slice(0, 10);
    if (!date || date < from) continue;
    const pest = `${sc.pestId || ''} ${(PROBLEM_BY_ID[sc.pestId] || {}).name || ''}`;
    if (!BORER_RE.test(pest)) continue;
    // Counted plants with entry holes. The ten-plant average cannot express
    // "more than ten plants", so this reads the explicit count and stays quiet
    // when nobody made one rather than guessing from a percentage.
    const plants = Number(sc.plantsAffected ?? NaN);
    if (!Number.isFinite(plants) || plants <= POD_BORER_TO_OWNER) continue;
    out.push({
      id: sc.id, kind: 'pod_borer', rule: IMMEDIATE_TO_OWNER[3], at: sc.at || `${date}T12:00:00.000Z`, date,
      zoneName: where(sc.cycleId), cycleId: sc.cycleId || null,
      line: `Pod borer on ${plants} plants in ${where(sc.cycleId)}`,
      detail: 'Over ten plants with entry holes: spray the whole field today, do not wait for the '
        + 'next window.',
    });
  }

  for (const sp of state.sprays || []) {
    const date = sp.date || (sp.at || '').slice(0, 10);
    if (!date || date < from) continue;
    const cycle = (state.cycles || {})[sp.cycleId];
    const week = weekOf(cycle, date);
    if (week == null || week < ORGANICS_ONLY_FROM_WEEK) continue;
    if (!isSyntheticFromWeek10(sp.productId)) continue;
    out.push({
      id: sp.id, kind: 'week10_synthetic', rule: IMMEDIATE_TO_OWNER[4], at: sp.at || `${date}T12:00:00.000Z`, date,
      zoneName: where(sp.cycleId), cycleId: sp.cycleId || null,
      line: `Synthetic sprayed in Week ${week} on ${where(sp.cycleId)}`
        + ` — ${sp.productName || sp.productId}`,
      detail: 'From Week 10 it is organics only: neem, garlic-chilli, copper. A synthetic this '
        + 'late puts residue on fruit that is already being picked.',
    });
  }

  // FR-ROLE-13 — a treatment that went ahead before its approval, because the
  // alert was due before the next spray window. The Owner hears at once, and
  // it stays on the list, however old, until the approval lands.
  const diagnosisById = new Map((state.diagnoses || []).map((d) => [d.id, d]));
  for (const sp of state.sprays || []) {
    if (!sp.beforeApproval) continue;
    const d = diagnosisById.get(sp.diagnosisId);
    if (!d || d.approvedBy) continue;
    const who = d.approvalFrom === 'ceo' ? 'Owner' : 'Farm Manager';
    const raiser = ((state.people || {})[d.confirmedBy] || {}).name || 'the person who raised it';
    out.push({
      id: sp.id, kind: 'treated_before_approval', rule: 'FR-ROLE-13 treated before approval',
      at: sp.at, date: (sp.at || '').slice(0, 10),
      zoneName: where(sp.cycleId), cycleId: sp.cycleId || null,
      line: `Treated before approval on ${where(sp.cycleId)} — ${sp.productName || sp.productId || 'a spray'} `
        + `against ${d.problemName || d.problemId}`,
      detail: `Self-confirmed by ${raiser}. The alert was due before the next spray window, so it went ahead. `
        + `The ${who} still approves it; Gate 3 is red if that has not happened within 48 hours.`,
    });
  }

  return out.sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/**
 * The success measures — section 3. The app is only working if these move.
 *
 * Computed, not claimed. Every one of them is read straight off the records so
 * nobody has to be trusted to report it.
 */
function kpis(state, {
  now = new Date().toISOString(), days = 28, settings = null, from = null, to = null, zoneId = null,
} = {}) {
  const config = settings || state.settings || {};
  const ladder = ladderFor(config);
  const today = now.slice(0, 10);
  const until = to || today;
  const since = from || isoDate(addDays(until, -days));
  const window = (date) => !!date && date >= since && date <= until;
  const span = Math.max(1, daysBetween(since, until));

  // FR-REP-03 asks for these per zone as well as per week, so every measure
  // below is written to answer "and what about GH-04 on its own?".
  const zones = Object.values(state.plots || {}).filter((z) => !zoneId || z.id === zoneId);
  const cycleIds = new Set(Object.values(state.cycles || {})
    .filter((c) => !zoneId || c.plotId === zoneId).map((c) => c.id));
  const inZone = (cycleId) => !zoneId || cycleIds.has(cycleId);

  const all = alerts(state, { now, settings: config })
    .filter((a) => !zoneId || (a.zone && a.zone.id === zoneId));
  const inWindow = all.filter((a) => window(a.date));

  // KPI-01 — breach to treatment done.
  const closed = inWindow.filter((a) => a.status === 'closed' && a.hoursToClose != null);
  const meanHours = closed.length
    ? Math.round((closed.reduce((s, a) => s + a.hoursToClose, 0) / closed.length) * 10) / 10
    : null;

  // KPI-02 — scouting completed, with a photo.
  const scoutTasks = Object.values(state.tasks || {})
    .filter((t) => t.kind === 'scout' && window((t.due || '').slice(0, 10)))
    .filter((t) => !zoneId || t.zoneId === zoneId);
  const doneWithPhoto = scoutTasks.filter((t) => t.status === 'done' && t.photo);
  const scoutRate = scoutTasks.length
    ? Math.round((doneWithPhoto.length / scoutTasks.length) * 100) : null;

  // KPI-03 — treatments with no diagnosis behind them. The gate makes new ones
  // impossible; this counts what is already on the record.
  const untreatedSprays = (state.sprays || [])
    .filter((s) => window(s.date || ''))
    .filter((s) => inZone(s.cycleId))
    .filter((s) => !s.diagnosisId).length;

  // KPI-04 — plantings that did not pass their gates.
  const ungatedPlantings = (state.gateOverrides || [])
    .filter((o) => !o.revoked && window((o.at || '').slice(0, 10)))
    .filter((o) => !zoneId || o.zoneId === zoneId).length;

  // KPI-05 — open alerts past the deadline. Section 3 writes this as 48 h; the
  // app counts from the ladder's own 24-hour deadline instead, which is the
  // stricter of the two and the one KPI-01 is measured against.
  const staleOpen = all.filter((a) => a.status === 'open'
    && a.hoursOpen > ladder.kpiBreachAfterHours).length;

  // KPI-06 — is profit known per zone? Deliberately not windowed: the measure
  // is "every cycle", and a zone whose costs were all booked in week one does
  // not stop being known about in week six.
  const zonesWithMoney = zones.filter((z) => {
    const ids = Object.values(state.cycles || {})
      .filter((c) => c.plotId === z.id).map((c) => c.id);
    return (state.sales || []).some((s) => ids.includes(s.cycleId))
      || (state.expenses || []).some((x) => ids.includes(x.cycleId));
  }).length;

  return [
    {
      id: 'KPI-01',
      measure: 'Hours from threshold breach to treatment done',
      target: `≤ ${ladder.kpiBreachAfterHours} h`,
      value: meanHours,
      display: meanHours == null ? 'nothing to measure yet' : `${meanHours} h`,
      ok: meanHours != null && meanHours <= ladder.kpiBreachAfterHours,
      basis: `${closed.length} alert${closed.length === 1 ? '' : 's'} closed in ${span} days`,
    },
    {
      id: 'KPI-02',
      measure: 'Scheduled scouting completed, with photo',
      target: '≥ 95%',
      value: scoutRate,
      display: scoutRate == null ? 'no scouting scheduled' : `${scoutRate}%`,
      ok: scoutRate != null && scoutRate >= 95,
      basis: `${doneWithPhoto.length} of ${scoutTasks.length} scheduled checks`,
    },
    {
      id: 'KPI-03',
      measure: 'Treatments logged without a diagnosis',
      target: '0',
      value: untreatedSprays,
      display: String(untreatedSprays),
      ok: untreatedSprays === 0,
      basis: 'The gate refuses new ones; this counts what is already recorded.',
    },
    {
      id: 'KPI-04',
      measure: 'Plantings logged without passing soil gates',
      target: '0',
      value: ungatedPlantings,
      display: String(ungatedPlantings),
      ok: ungatedPlantings === 0,
      basis: 'Counts standing Owner overrides.',
    },
    {
      id: 'KPI-05',
      measure: `Open alerts older than ${ladder.kpiBreachAfterHours} h`,
      target: '0',
      value: staleOpen,
      display: String(staleOpen),
      ok: staleOpen === 0,
      basis: `${all.filter((a) => a.status === 'open').length} open in total`
        + ' · section 3 allows 48 h; this counts from the 24-hour deadline',
    },
    {
      id: 'KPI-06',
      measure: 'Profit or loss known per zone',
      target: 'every cycle',
      value: zonesWithMoney,
      display: zones.length ? `${zonesWithMoney} of ${zones.length} zones` : 'no zones yet',
      ok: zones.length > 0 && zonesWithMoney === zones.length,
      basis: 'A zone counts once a sale or a cost has been tied to it.',
    },
  ];
}

/** Monday of the week a date falls in, which is how the farm counts a week. */
function weekStart(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  const shift = (d.getDay() + 6) % 7;                    // Monday = 0
  return isoDate(addDays(d, -shift));
}

/**
 * FR-REP-03 — the same measures, one row per week.
 *
 * Built on kpis() rather than beside it: a KPI that is computed twice is a KPI
 * that disagrees with itself the first time somebody changes a rule.
 */
function kpisByWeek(state, { now = new Date().toISOString(), weeks = 6, settings = null, zoneId = null } = {}) {
  const today = now.slice(0, 10);
  const thisWeek = weekStart(today);
  const out = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const from = isoDate(addDays(thisWeek, -7 * i));
    const to = isoDate(addDays(from, 6));
    const asAt = to < today ? `${to}T23:59:59.999Z` : now;
    out.push({
      from,
      to,
      current: i === 0,
      label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `Week of ${from}`,
      rows: kpis(state, { now: asAt, from, to, settings, zoneId }),
    });
  }
  return out;
}

/** FR-REP-03 — the same measures, one block per zone. */
function kpisByZone(state, { now = new Date().toISOString(), days = 28, settings = null } = {}) {
  return Object.values(state.plots || {})
    .filter((z) => !z.retired)
    .map((zone) => ({ zone, rows: kpis(state, { now, days, settings, zoneId: zone.id }) }))
    .sort((a, b) => {
      const failed = (r) => r.rows.filter((x) => !x.ok).length;
      return failed(b) - failed(a) || String(a.zone.name).localeCompare(String(b.zone.name));
    });
}
})(__dvModule("web/js/domain/alerts.js"));
__dvBindAll();

// ─── web/js/domain/selfcheck.js ────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "FARM_DOCTOR_ID": { enumerable: true, get: () => FARM_DOCTOR_ID },
  "CONFIRMING_ROLES": { enumerable: true, get: () => CONFIRMING_ROLES },
  "APPROVAL_WITHIN_HOURS": { enumerable: true, get: () => APPROVAL_WITHIN_HOURS },
  "FARM_UTC_OFFSET_HOURS": { enumerable: true, get: () => FARM_UTC_OFFSET_HOURS },
  "NO_SHOW_HOUR": { enumerable: true, get: () => NO_SHOW_HOUR },
  "roleTitle": { enumerable: true, get: () => roleTitle },
  "approverFor": { enumerable: true, get: () => approverFor },
  "onFarmAt": { enumerable: true, get: () => onFarmAt },
  "otherConfirmers": { enumerable: true, get: () => otherConfirmers },
  "farmHour": { enumerable: true, get: () => farmHour },
  "managerAway": { enumerable: true, get: () => managerAway },
  "awaitingApproval": { enumerable: true, get: () => awaitingApproval },
  "treatable": { enumerable: true, get: () => treatable },
  "canApprove": { enumerable: true, get: () => canApprove },
  "sprayWindow": { enumerable: true, get: () => sprayWindow },
  "nextWindowOpens": { enumerable: true, get: () => nextWindowOpens },
  "alertDeadline": { enumerable: true, get: () => alertDeadline },
  "beforeApprovalCheck": { enumerable: true, get: () => beforeApprovalCheck },
  "approvalStanding": { enumerable: true, get: () => approvalStanding },
  "selfConfirmedSince": { enumerable: true, get: () => selfConfirmedSince },
  "approvalsFor": { enumerable: true, get: () => approvalsFor },
});
let peekRules;
let alerts;
__dvImport("web/js/rules.js", (m) => { peekRules = m.peekRules; });
__dvImport("web/js/domain/alerts.js", (m) => { alerts = m.alerts; });
// Checking your own work — requirements §4.2, FR-ROLE-12 to FR-ROLE-15.
//
// On a farm this size the Field Supervisor who scouts a house is often the
// only qualified person there to confirm what he found. Refusing that would
// stop work, so it is allowed — but only when nobody else qualified is in, and
// the record says so: **self-confirmed** (FR-ROLE-12).
//
// A treatment from a self-confirmed diagnosis then waits for the next level
// up (FR-ROLE-13): the Field Supervisor's for the Farm Manager, the Farm
// Manager's for the Owner, and the Owner may stand in for a Farm Manager who
// is not in. The Owner's own self-confirmation has nobody above it, so it is
// recorded, not escalated.
//
// One exception, and it is computed, never chosen: where the treatment closes
// an open alert whose deadline falls before the next spray window, waiting for
// the approval would miss the deadline. The treatment goes ahead, is marked
// **treated before approval**, and the Owner hears at once. The approval is
// still owed; Gate 3 stays yellow until it lands and goes red after 48 hours.
//
// What does not change: Gate 0 and Gate 4 still clear on the Farm Manager's
// confirmation and the Owner's approval of the Farm Doctor's check (FR-ROLE-14,
// FR-GATE-00), and nothing in this file can clear them. The Farm Doctor still
// never confirms or approves anything (FR-DOC-08).
//
// Everything here is a pure function of recorded facts, so the screens, the
// record rebuild in store.js and the tests all get the same answer. The farm
// server holds its own copy of the parts it can judge from the log
// (server/core.mjs); tests/self-confirm.test.mjs keeps the two in step.




/** The Farm Doctor's account id. It is not a person and confirms nothing (FR-DOC-08). */
const FARM_DOCTOR_ID = 'farm-doctor';

/** Who may confirm a diagnosis at all: the Field Supervisor, the Farm Manager, the Owner (FR-DIAG-03). */
const CONFIRMING_ROLES = new Set(['supervisor', 'manager', 'ceo']);

/** How long an approval may trail a treatment that went before it, before Gate 3 turns red. */
const APPROVAL_WITHIN_HOURS = 48;

/** The farm keeps West Africa Time all year: UTC+1, no daylight saving. */
const FARM_UTC_OFFSET_HOURS = 1;

/** A Farm Manager not clocked in by this farm hour counts as away (positions.js uses the same 9). */
const NO_SHOW_HOUR = 9;

const TITLE = { supervisor: 'Field Supervisor', agronomist: 'Agronomist', manager: 'Farm Manager', ceo: 'Owner' };
const roleTitle = (role) => TITLE[role] || 'Farm Manager';

const HOUR = 3600000;
const people = (state) => (state && state.people) || {};
const active = (p) => !!p && p.active !== false;

/**
 * Who approves a treatment from a diagnosis this role confirmed on itself —
 * FR-ROLE-13. The Field Supervisor's (and anyone else below the Farm Manager)
 * goes to the Farm Manager, the Farm Manager's to the Owner, and the Owner's to
 * nobody (null): it is recorded. A role the record does not know goes to the
 * Owner, the safe end of the ladder.
 */
function approverFor(role) {
  if (role === 'ceo') return null;
  if (role === 'manager') return 'ceo';
  if (role === 'supervisor' || role === 'agronomist' || role === 'hand') return 'manager';
  return 'ceo';
}

// --- FR-ROLE-12: is anybody else here to confirm it? -------------------------

/**
 * Is this person on the farm at `at`? Clocked in that day, not yet clocked
 * out, and not marked absent. Somebody who never clocks in — usually the
 * Owner — is not here to do a confirm test, however senior.
 */
function onFarmAt(state, personId, at) {
  const day = String(at).slice(0, 10);
  const off = ((state && state.absences) || [])
    .some((a) => a.personId === personId && a.date === day && !a.cancelled);
  if (off) return false;
  return ((state && state.attendance) || []).some((a) => a.personId === personId
    && String(a.in || '').slice(0, 10) === day && a.in <= at && (!a.out || a.out > at));
}

/** The other qualified people on the farm at `at` — anyone who could confirm instead. */
function otherConfirmers(state, diagnosis, at) {
  const raiser = diagnosis && diagnosis.by;
  return Object.values(people(state))
    .filter((p) => active(p) && CONFIRMING_ROLES.has(p.role) && p.id !== raiser && p.id !== FARM_DOCTOR_ID)
    .filter((p) => onFarmAt(state, p.id, at));
}

// --- FR-ROLE-13: who approves ----------------------------------------------

/** The farm's hour of the day (0-23) at an instant. */
const farmHour = (at) => new Date(Date.parse(at) + FARM_UTC_OFFSET_HOURS * HOUR).getUTCHours();

/**
 * Is the Farm Manager away at `at`? Judged the way FR-ROLE-06 judges cover:
 * marked absent that day, or not clocked in once the morning is out (9 AM farm
 * time) — or the farm has no Farm Manager at all. The farm server judges it
 * the same way from the same records (server/core.mjs managerAwayFrom).
 */
function managerAway(state, at) {
  const day = String(at).slice(0, 10);
  const managers = Object.values(people(state)).filter((p) => active(p) && p.role === 'manager');
  if (!managers.length) return { away: true, why: 'The farm has no Farm Manager.' };
  const isIn = (m) => {
    const off = ((state && state.absences) || []).some((a) => a.personId === m.id && a.date === day && !a.cancelled);
    if (off) return false;
    const clocked = ((state && state.attendance) || [])
      .some((a) => a.personId === m.id && String(a.in || '').slice(0, 10) === day && a.in <= at);
    return clocked || farmHour(at) < NO_SHOW_HOUR;
  };
  const inToday = managers.filter(isIn);
  if (inToday.length) {
    return { away: false, why: `${inToday.map((m) => m.name || m.id).join(' and ')} ${inToday.length === 1 ? 'is' : 'are'} in today.` };
  }
  return { away: true, why: `${managers.map((m) => m.name || m.id).join(' and ')} ${managers.length === 1 ? 'is' : 'are'} not in today.` };
}

/** Self-confirmed, with somebody above it, and that somebody has not approved yet. */
function awaitingApproval(d) {
  return !!(d && d.confirmedBy && d.selfConfirmed && d.approvalFrom && !d.approvedBy);
}

/**
 * May a treatment rest on this diagnosis without the exception? Confirmed by a
 * second person; or self-confirmed and approved; or the Owner's own.
 */
function treatable(d) {
  return !!(d && d.confirmedBy && d.confirmedBy !== FARM_DOCTOR_ID && !awaitingApproval(d));
}

/**
 * FR-ROLE-13 — may this person approve a self-confirmed diagnosis at `at`?
 *
 * `approver` is { id, role }. A Field Supervisor's goes to a Farm Manager, or
 * to the Owner when the Farm Manager is away. A Farm Manager's goes to the
 * Owner. Never to the person who confirmed it, and never to the Farm Doctor.
 */
function canApprove(state, d, approver, { at = new Date().toISOString() } = {}) {
  if (!d) return { ok: false, reason: 'missing', why: 'There is no such diagnosis.' };
  if (!d.confirmedBy) return { ok: false, reason: 'unconfirmed', why: 'Nobody has confirmed this diagnosis yet.' };
  if (!d.selfConfirmed) {
    return { ok: false, reason: 'not-needed', why: 'A second person confirmed this one, so it needs no approval.' };
  }
  if (!d.approvalFrom) {
    return { ok: false, reason: 'not-needed',
      why: 'The Owner confirmed this one. It is recorded as self-confirmed; there is nobody above to approve it.' };
  }
  if (d.approvedBy) return { ok: false, reason: 'done', why: 'This one is already approved.' };
  if (!approver || approver.id === FARM_DOCTOR_ID) {
    return { ok: false, reason: 'doctor', why: 'The Farm Doctor does not approve anything (FR-DOC-08).' };
  }
  if (approver.id === d.confirmedBy || approver.id === d.by) {
    return { ok: false, reason: 'self', why: `You confirmed this yourself, so the ${roleTitle(d.approvalFrom)} approves it.` };
  }
  if (d.approvalFrom === 'ceo') {
    return approver.role === 'ceo'
      ? { ok: true, how: 'owner' }
      : { ok: false, reason: 'rank', why: 'The Farm Manager confirmed this one on their own finding, so the Owner approves it.' };
  }
  if (approver.role === 'manager') return { ok: true, how: 'manager' };
  if (approver.role === 'ceo') {
    const away = managerAway(state, at);
    return away.away
      ? { ok: true, how: 'covering', why: `Approving for the Farm Manager: ${away.why}` }
      : { ok: false, reason: 'manager-in',
        why: `The Farm Manager approves this one. ${away.why} The Owner approves it only when the Farm Manager is away.` };
  }
  return { ok: false, reason: 'rank', why: 'A self-confirmed diagnosis from the field is approved by the Farm Manager.' };
}

// --- FR-ROLE-13: the exception, from the alert deadline and the window -------

/**
 * The spray window, read from SR-01 ("Spray window 4-7 PM ..."). Returns farm
 * hours { open: 16, close: 19 }, or null if the rules no longer say.
 */
function sprayWindow(rules = peekRules()) {
  const sr = ((rules && rules.spray_rules) || []).find((r) => r.id === 'SR-01');
  const m = sr && /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*PM/i.exec(sr.rule || '');
  if (!m) return null;
  const open = (Number(m[1]) % 12) + 12;
  const close = (Number(m[2]) % 12) + 12;
  return close > open ? { open, close } : null;
}

/** Midnight farm time, as an instant, for the farm day an instant falls in. */
function farmMidnight(ms) {
  const shifted = ms + FARM_UTC_OFFSET_HOURS * HOUR;
  return shifted - (((shifted % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)) - FARM_UTC_OFFSET_HOURS * HOUR;
}

/** The first spray window to OPEN strictly after `at` — "the next spray window". */
function nextWindowOpens(at, win = sprayWindow()) {
  const t = Date.parse(at);
  const day = farmMidnight(t);
  const today = day + win.open * HOUR;
  return new Date(today > t ? today : today + 24 * HOUR).toISOString();
}

/**
 * C-3 (rules → alert_deadlines): treat at the next spray window, never later
 * than 24 hours. A breach logged before 7 PM is due at the close of that day's
 * window; one logged after 7 PM at the close of the next day's. Capped by the
 * alert's own 24-hour deadline (FR-SCOUT-03).
 */
function alertDeadline(alert, win = sprayWindow()) {
  const t = Date.parse(alert.at);
  const day = farmMidnight(t);
  const close = day + win.close * HOUR;
  const windowClose = close > t ? close : close + 24 * HOUR;
  const own = alert.dueAt ? Date.parse(alert.dueAt) : t + 24 * HOUR;
  return new Date(Math.min(windowClose, own)).toISOString();
}

/**
 * FR-ROLE-13 exception — may a treatment from this self-confirmed, unapproved
 * diagnosis go ahead at `at`?
 *
 * Only if it closes an open alert on the same zone, for the pest the diagnosis
 * names, whose deadline falls before the next spray window opens. Nothing a
 * person says decides it: the alert, its deadline and the window times do.
 */
function beforeApprovalCheck(state, d, { cycleId = d && d.cycleId, at = new Date().toISOString(), rules = peekRules() } = {}) {
  const win = sprayWindow(rules);
  if (!win) return { ok: false, reason: 'no-window', why: 'The rules do not give a spray window (SR-01), so nothing can go before approval.' };
  if (!awaitingApproval(d)) return { ok: false, reason: 'not-waiting', why: 'This diagnosis is not waiting on an approval.' };
  const open = alerts(state, { now: at }).filter((a) => a.status === 'open' && a.cycleId === cycleId
    && a.at <= at && (!d.problemId || a.pestId === d.problemId));
  const next = nextWindowOpens(at, win);
  const judged = open.map((a) => ({ alert: a, deadline: alertDeadline(a, win) }))
    .sort((x, y) => (x.deadline < y.deadline ? -1 : 1));
  const hit = judged.find((j) => j.deadline < next);
  const who = roleTitle(d.approvalFrom);
  if (hit) {
    return {
      ok: true, alert: hit.alert, alertId: hit.alert.id, deadline: hit.deadline, nextWindow: next,
      why: `The ${hit.alert.pestName} alert on ${hit.alert.zoneName} is due ${hit.deadline.slice(0, 16).replace('T', ' ')} UTC, `
        + `before the next spray window opens (${next.slice(0, 16).replace('T', ' ')} UTC). It goes ahead marked `
        + `treated before approval; the Owner is told now and the ${who} still approves it.`,
    };
  }
  return {
    ok: false,
    reason: open.length ? 'deadline-after-window' : 'no-alert',
    nextWindow: next,
    why: open.length
      ? `The open alert is due ${judged[0].deadline.slice(0, 16).replace('T', ' ')} UTC, after the next spray window opens, `
        + `so there is time for the ${who} to approve it first.`
      : 'No open alert for this pest on this zone is waiting on it.',
  };
}

/**
 * Where a treatment from a self-confirmed diagnosis stands — the Gate 3 colour
 * for one spray. `pass` once approved (or never needed one), `held` (yellow)
 * while treated before approval and inside 48 hours, `fail` (red) after 48
 * hours without it, or when it went on without approval and without the
 * exception.
 */
function approvalStanding(spray, d, { now = new Date().toISOString() } = {}) {
  if (!d || !d.selfConfirmed || !d.approvalFrom) return { state: 'pass' };
  const who = roleTitle(d.approvalFrom);
  if (d.approvedAt && d.approvedAt <= spray.at) return { state: 'pass', why: `Approved by the ${who} before the spray.` };
  if (!spray.beforeApproval) {
    return { state: 'fail', why: `Sprayed on a self-confirmed diagnosis before the ${who} approved it, and not to meet an alert deadline.` };
  }
  const hours = (Date.parse(d.approvedAt || now) - Date.parse(spray.at)) / HOUR;
  if (d.approvedAt) {
    return { state: 'pass', why: `Treated before approval; the ${who} approved it ${Math.round(hours)} h later`
      + (hours > APPROVAL_WITHIN_HOURS ? `, past the ${APPROVAL_WITHIN_HOURS} h limit.` : '.') };
  }
  if (hours >= APPROVAL_WITHIN_HOURS) {
    return { state: 'fail', why: `Treated before approval ${Math.round(hours)} h ago, and the ${who} has still not approved it.` };
  }
  return { state: 'held', why: `Treated before approval ${Math.round(hours)} h ago; waiting on the ${who} (red after ${APPROVAL_WITHIN_HOURS} h).` };
}

/** FR-ROLE-15 — self-confirmed diagnoses in the last `days` days, for the Owner's digest. */
function selfConfirmedSince(state, { now = new Date().toISOString(), days = 7 } = {}) {
  const from = new Date(Date.parse(now) - days * 24 * HOUR).toISOString();
  return ((state && state.diagnoses) || [])
    .filter((d) => d.selfConfirmed && d.confirmedAt && d.confirmedAt >= from && d.confirmedAt <= now);
}

/** What is waiting on this person to approve — for their screen, and the dashboard. */
function approvalsFor(state, user, { at = new Date().toISOString() } = {}) {
  if (!user) return [];
  return ((state && state.diagnoses) || [])
    .filter(awaitingApproval)
    .filter((d) => canApprove(state, d, user, { at }).ok);
}
})(__dvModule("web/js/domain/selfcheck.js"));
__dvBindAll();

// ─── web/js/domain/diagnose.js ─────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "RULES_VERSION": { enumerable: true, get: () => RULES_VERSION },
  "termsOf": { enumerable: true, get: () => termsOf },
  "TRIAGE": { enumerable: true, get: () => TRIAGE },
  "TRIAGE_BY_N": { enumerable: true, get: () => TRIAGE_BY_N },
  "CARDS": { enumerable: true, get: () => CARDS },
  "CARD_BY_ID": { enumerable: true, get: () => CARD_BY_ID },
  "CARD_CATEGORIES": { enumerable: true, get: () => CARD_CATEGORIES },
  "cardFor": { enumerable: true, get: () => cardFor },
  "rowsForCard": { enumerable: true, get: () => rowsForCard },
  "CUES": { enumerable: true, get: () => CUES },
  "CUE_BY_ID": { enumerable: true, get: () => CUE_BY_ID },
  "observationText": { enumerable: true, get: () => observationText },
  "matchTriage": { enumerable: true, get: () => matchTriage },
  "confidenceLabel": { enumerable: true, get: () => confidenceLabel },
  "lookalikesFor": { enumerable: true, get: () => lookalikesFor },
  "ROOT_READ": { enumerable: true, get: () => ROOT_READ },
  "separatingSymptom": { enumerable: true, get: () => separatingSymptom },
  "namingGate": { enumerable: true, get: () => namingGate },
  "nameCause": { enumerable: true, get: () => nameCause },
  "labRecommendedFor": { enumerable: true, get: () => labRecommendedFor },
  "FARM_DOCTOR": { enumerable: true, get: () => FARM_DOCTOR },
  "FARM_DOCTOR_NEVER": { enumerable: true, get: () => FARM_DOCTOR_NEVER },
  "FARM_DOCTOR_ROLE": { enumerable: true, get: () => FARM_DOCTOR_ROLE },
  "isLegacyDiagnosis": { enumerable: true, get: () => isLegacyDiagnosis },
  "confirmStepDone": { enumerable: true, get: () => confirmStepDone },
  "canConfirm": { enumerable: true, get: () => canConfirm },
  "LEGACY_CARD_MAP": { enumerable: true, get: () => LEGACY_CARD_MAP },
  "CARD_TO_PROBLEM": { enumerable: true, get: () => CARD_TO_PROBLEM },
  "readDiagnosis": { enumerable: true, get: () => readDiagnosis },
  "rowSlot": { enumerable: true, get: () => rowSlot },
  "cardSlot": { enumerable: true, get: () => cardSlot },
  "PHOTO_SLOTS": { enumerable: true, get: () => PHOTO_SLOTS },
  "PHOTO_SLOT_BY_ID": { enumerable: true, get: () => PHOTO_SLOT_BY_ID },
  "isPhotoSlot": { enumerable: true, get: () => isPhotoSlot },
  "referencePhoto": { enumerable: true, get: () => referencePhoto },
  "rowPhoto": { enumerable: true, get: () => rowPhoto },
  "cardPhoto": { enumerable: true, get: () => cardPhoto },
  "photoCues": { enumerable: true, get: () => photoCues },
  "photoCoverage": { enumerable: true, get: () => photoCoverage },
  "searchCards": { enumerable: true, get: () => searchCards },
  "searchProblems": { enumerable: true, get: () => searchProblems },
  "riskForecast": { enumerable: true, get: () => riskForecast },
  "RISK_DRIVER_TEXT": { enumerable: true, get: () => RISK_DRIVER_TEXT },
  "PROBLEM_BY_ID": { enumerable: true, get: () => PROBLEM_BY_ID },
});
let loadRules, peekRules, rulesVersion;
let sourcesOf;
let PROBLEMS, PROBLEM_BY_ID;
let wetnessIndex, drynessIndex, waterloggingIndex;
let clamp;
let approverFor, awaitingApproval, FARM_DOCTOR_ID, roleTitle, treatable;
__dvImport("web/js/rules.js", (m) => { loadRules = m.loadRules; }, (m) => { peekRules = m.peekRules; }, (m) => { rulesVersion = m.rulesVersion; });
__dvImport("web/js/sources.js", (m) => { sourcesOf = m.sourcesOf; });
__dvImport("web/js/domain/pests.js", (m) => { PROBLEMS = m.PROBLEMS; }, (m) => { PROBLEM_BY_ID = m.PROBLEM_BY_ID; });
__dvImport("web/js/domain/climate.js", (m) => { wetnessIndex = m.wetnessIndex; }, (m) => { drynessIndex = m.drynessIndex; }, (m) => { waterloggingIndex = m.waterloggingIndex; });
__dvImport("web/js/util.js", (m) => { clamp = m.clamp; });
__dvImport("web/js/domain/selfcheck.js", (m) => { approverFor = m.approverFor; }, (m) => { awaitingApproval = m.awaitingApproval; }, (m) => { FARM_DOCTOR_ID = m.FARM_DOCTOR_ID; }, (m) => { roleTitle = m.roleTitle; }, (m) => { treatable = m.treatable; });
// The Farm Doctor's diagnosis engine — FR-DIAG-01, FR-DIAG-02, FR-DOC-01, FR-DOC-02.
//
// Everything about a pest, a disease or a disorder in here is READ FROM
// rules/douvalue_rules_rev5_1.json: the 23 triage rows, the 22 diagnosis cards,
// the root read and the Farm Doctor's own limits. No symptom, weight, cause or
// test is written down in this file, so a change to the rules changes the
// diagnosis without anybody touching code. What this file holds is the method:
//
//   symptom  ->  matching triage rows  ->  card  ->  confirm test
//
// and the rule that gives the method its point (FR-DOC-01): the Farm Doctor
// asks for photos and the confirm step BEFORE it names a cause. Season 1 was
// lost partly to "treatment by guesswork"; naming a cause off a glance is how
// guesswork gets a name and a spray.
//
// The matching itself is deliberately plain text-matching against the rules'
// own wording, weighted by how much a word narrows the 23 rows down. Two
// things make it work on real field words:
//
//   * Negation. "NO galls" in row 23 is the whole difference between acid soil
//     and nematode. A worker who types "no galls" must be pushed towards acid
//     soil and away from nematode, not merely fail to match "galls".
//   * Contradiction. A word one row asserts and another denies is not noise:
//     it is the separating test, and the engine reports it as one.
//
// riskForecast() at the foot of the file is the other half of the clinic — the
// standing weather-and-stage risk board — and still reads the local field guide
// in pests.js, which carries the product, PHI and weather data the rules do not.

// The rules file is read in one place for the whole app (web/js/rules.js).
// This module needs the document at import time, because the 22 cards and the
// 23 triage rows are built from it as ordinary constants; the loader caches,
// so asking it here costs one read shared with everybody else rather than a
// second copy of the file.



const RULES = peekRules() || await loadRules();

/** rules-1.3 at the time of writing. Stamped onto everything the engine produces. */
const RULES_VERSION = rulesVersion(RULES) || 'unknown';






// --- Reading the rules' prose ---------------------------------------------

const NEGATORS = new Set(['no', 'not', 'without', 'never', 'none', 'nothing', 'nor']);

/** Words that appear everywhere and narrow nothing. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'with', 'at', 'by', 'for', 'from',
  'then', 'that', 'than', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'these',
  'those', 'but', 'also', 'still', 'over', 'under', 'per', 'if', 'any', 'all', 'one', 'two',
  'three', 'into', 'out', 'up', 'down', 'when', 'while', 'after', 'before', 'very', 'more',
  'most', 'less', 'only', 'same', 'other', 'others', 'each', 'every', 'look', 'looks', 'like',
  'can', 'cannot', 'has', 'have', 'been', 'may', 'will', 'there', 'their', 'they', 'you', 'your',
]);

/**
 * Crude English plural folding, enough to make "galls" and "gall", "leaves"
 * and "leaf" the same word. Anything cleverer would need a dictionary, and a
 * dictionary is a second source of truth.
 */
function stem(word) {
  if (word.length > 4 && word.endsWith('ves')) return `${word.slice(0, -3)}f`;
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Negation runs to the end of its clause and no further. */
function clausesOf(text) { return String(text == null ? '' : text).split(/[;,:.!?()]+/); }

/**
 * Text -> Map(term -> net polarity). A positive count means the text asserts
 * the sign; a negative count means it denies it ("no insect visible").
 */
function termsOf(text) {
  const out = new Map();
  for (const clause of clausesOf(text)) {
    let negated = false;
    for (const raw of clause.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw) continue;
      if (NEGATORS.has(raw)) { negated = true; continue; }
      if (raw.length < 3 || STOP.has(raw)) continue;
      const term = stem(raw);
      out.set(term, (out.get(term) || 0) + (negated ? -1 : 1));
    }
  }
  return out;
}

const polarity = (n) => (n < 0 ? -1 : 1);

/** Inverse document frequency over a corpus of term maps: rare words carry more. */
function idfIndex(corpus) {
  const df = new Map();
  for (const terms of corpus) for (const t of terms.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = corpus.length;
  const out = new Map();
  for (const [t, count] of df) out.set(t, Math.log(1 + n / count));
  return out;
}

// --- The cards ------------------------------------------------------------

const segmentsOf = (id) => new Set(String(id).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const subset = (a, b) => [...a].every((x) => b.has(x));

/** "root_knot_nematode" -> "Root knot nematode". The rules give ids, not names. */
function nameFromId(id) {
  const words = String(id).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const RAW_CARDS = RULES.diagnosis_cards;
const CARD_SEGMENTS = new Map(RAW_CARDS.map((c) => [c.id, segmentsOf(c.id)]));

/**
 * Which card a triage row's `likely` names.
 *
 * Twenty-one of the 23 rows name a card id outright. The other two are
 * sunscald and fruit_cracking, which the rules fold into one `sunscald_cracking`
 * card — so a row also matches a card that shares a word with it, as long as
 * exactly one card does. That is why 23 rows reach 22 cards.
 */
function cardIdFor(likely) {
  const key = String(likely || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!key) return null;
  if (CARD_SEGMENTS.has(key)) return key;
  const want = segmentsOf(key);
  let best = 0;
  let hits = [];
  for (const [id, have] of CARD_SEGMENTS) {
    let overlap = 0;
    for (const s of want) if (have.has(s)) overlap += 1;
    if (overlap > best) { best = overlap; hits = [id]; } else if (overlap === best && overlap > 0) hits.push(id);
  }
  return best > 0 && hits.length === 1 ? hits[0] : null;
}

// --- The triage table -----------------------------------------------------

const cardsById = new Map();
for (const raw of RAW_CARDS) {
  cardsById.set(raw.id, {
    ...raw,
    name: nameFromId(raw.id),
    rows: [],          // filled in below
    confirmTests: [],
    firstActions: [],
  });
}

/** The 23 rows, each carrying the card it reaches and the words it is made of. */
const TRIAGE = RULES.triage.map((raw) => {
  const cardId = cardIdFor(raw.likely);
  const card = cardId ? cardsById.get(cardId) : null;
  const signText = [raw.see, card && card.detection, card && card.cause].filter(Boolean).join('; ');
  const row = {
    n: raw.n,
    see: raw.see,
    likely: raw.likely,
    confirm: raw.confirm,
    firstAction: raw.first_action,
    sources: raw.sources || [],
    cardId,
    cues: clausesOf(raw.see).map((c) => c.trim()).filter(Boolean),
    signs: termsOf(signText),
    confirmTerms: termsOf(raw.confirm),
  };
  if (card) {
    card.rows.push(row.n);
    if (!card.confirmTests.includes(raw.confirm)) card.confirmTests.push(raw.confirm);
    if (!card.firstActions.includes(raw.first_action)) card.firstActions.push(raw.first_action);
  }
  return row;
});

const TRIAGE_BY_N = new Map(TRIAGE.map((r) => [r.n, r]));

/** The 22 cards, each knowing which triage rows reach it. */
const CARDS = [...cardsById.values()];
const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** The card categories the rules actually use: pest, disease, virus, disorder, soil. */
const CARD_CATEGORIES = [...new Set(CARDS.map((c) => c.category))].sort();

/** The names the triage table uses for a card, e.g. "sunscald" -> sunscald_cracking. */
const LIKELY_TO_CARD = new Map(TRIAGE.filter((r) => r.cardId).map((r) => [r.likely, r.cardId]));

/**
 * A card, from a card id, a triage row, a triage `likely` name, or an old
 * field-guide problem id. Deliberately strict about the last one: it goes
 * through LEGACY_CARD_MAP, which only maps where the match is clear, so
 * "cercospora_leaf_spot" resolves to nothing rather than to the nearest card
 * that happens to share the word "spot".
 */
const cardFor = (idOrRow) => {
  if (!idOrRow) return null;
  if (typeof idOrRow === 'object') return idOrRow.cardId ? CARD_BY_ID[idOrRow.cardId] || null : idOrRow;
  return CARD_BY_ID[idOrRow]
    || CARD_BY_ID[LIKELY_TO_CARD.get(idOrRow)]
    || CARD_BY_ID[LEGACY_CARD_MAP[idOrRow]]
    || null;
};

const rowsForCard = (cardId) => TRIAGE.filter((r) => r.cardId === cardId);

const SIGN_IDF = idfIndex(TRIAGE.map((r) => r.signs));
const CONFIRM_IDF = idfIndex(TRIAGE.map((r) => r.confirmTerms));
const signWeight = (t) => SIGN_IDF.get(t) || 0;
const confirmWeight = (t) => CONFIRM_IDF.get(t) || 0;
const signMass = (row) => [...row.signs.keys()].reduce((a, t) => a + signWeight(t), 0);

/** Every distinct observable phrase in the rules, for the tick-list in the wizard. */
const CUES = (() => {
  const seen = new Map();
  for (const row of TRIAGE) {
    for (const text of row.cues) {
      const key = text.toLowerCase();
      const hit = seen.get(key) || { id: `cue_${seen.size + 1}`, text, rows: [] };
      if (!hit.rows.includes(row.n)) hit.rows.push(row.n);
      seen.set(key, hit);
    }
  }
  return [...seen.values()];
})();

const CUE_BY_ID = Object.fromEntries(CUES.map((c) => [c.id, c]));

/** Free text plus ticked cues, as one observation. */
function observationText(observation) {
  if (!observation) return '';
  if (typeof observation === 'string') return observation;
  if (Array.isArray(observation)) return observation.join('; ');
  const cues = (observation.cues || []).map((id) => (CUE_BY_ID[id] || { text: id }).text);
  return [...cues, observation.text || ''].filter(Boolean).join('; ');
}

// --- Step 1: symptom -> matching triage rows ------------------------------

/**
 * Score all 23 rows against what the worker says they can see.
 *
 * A word the row asserts and the observation asserts counts for it; a word one
 * of them denies and the other asserts counts against. That single rule is what
 * carries "stunted plants, no galls" past the nematode row (which needs galls)
 * and onto the acid-soil row (which needs their absence).
 */
function matchTriage(observation, { limit = 6, floor = 0.05 } = {}) {
  const text = observationText(observation);
  const obs = termsOf(text);
  const known = [...obs.entries()].filter(([t]) => SIGN_IDF.has(t));
  const unknown = [...obs.keys()].filter((t) => !SIGN_IDF.has(t));
  const mass = known.reduce((a, [t]) => a + signWeight(t), 0);

  if (!mass) {
    return { observation: text, rows: [], unmatched: unknown, separator: null, asked: obs.size };
  }

  const scored = [];
  for (const row of TRIAGE) {
    let score = 0;
    const matched = [];
    const contradicted = [];
    for (const [term, obsCount] of known) {
      const rowCount = row.signs.get(term);
      if (rowCount === undefined) continue;
      const weight = signWeight(term);
      if (polarity(rowCount) === polarity(obsCount)) {
        score += weight;
        matched.push({ term, denied: polarity(obsCount) < 0 });
      } else {
        score -= weight;
        contradicted.push({ term, rowAsserts: polarity(rowCount) > 0 });
      }
    }
    if (score <= 0) continue;
    scored.push({
      row,
      card: cardFor(row),
      score: clamp(score / mass, 0, 1),
      matched,
      contradicted,
      confidence: confidenceLabel(clamp(score / mass, 0, 1)),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.row.n - b.row.n);
  const rows = scored.filter((r) => r.score >= floor).slice(0, limit);

  return {
    observation: text,
    asked: obs.size,
    rows,
    unmatched: unknown,
    // Two candidates that close together is exactly when the confirm test has
    // to be named rather than guessed between.
    separator: rows.length > 1 && rows[0].score - rows[1].score < 0.3
      ? separatingSymptom(rows[0].card, rows[1].card)
      : null,
  };
}

function confidenceLabel(score) {
  if (score >= 0.6) return { id: 'high', label: 'High', hint: 'Do the confirm test, then act on it.' };
  if (score >= 0.3) return { id: 'medium', label: 'Medium', hint: 'The confirm test decides this one.' };
  return { id: 'low', label: 'Low', hint: 'Not enough to name a cause. Look again, and send a sample.' };
}

// --- Look-alikes and the test that separates them (FR-DOC-02) -------------

function rowSimilarity(a, b) {
  let shared = 0;
  let contra = 0;
  const contradictions = [];
  for (const [term, ca] of a.signs) {
    const cb = b.signs.get(term);
    if (cb === undefined) continue;
    const weight = signWeight(term);
    if (polarity(ca) === polarity(cb)) shared += weight;
    else { contra += weight; contradictions.push({ term, asserts: polarity(ca) > 0 ? a.n : b.n }); }
  }
  const mass = Math.sqrt(Math.max(signMass(a), 0.001) * Math.max(signMass(b), 0.001));
  return { score: (shared + contra) / mass, shared: shared / mass, contra: contra / mass, contradictions };
}

/**
 * Cards that look like this one in the field.
 *
 * Derived, not listed: two rows are look-alikes when they are built out of the
 * same words. A word they disagree about — galls, or a visible insect — raises
 * the score rather than lowering it, because that disagreement is the thing a
 * person has to go and settle.
 */
function lookalikesFor(cardId, { limit = 4, floor = 0.06, ratio = 0.5 } = {}) {
  const card = cardFor(cardId);
  if (!card) return [];
  const mine = rowsForCard(card.id);
  const out = new Map();
  for (const row of mine) {
    for (const other of TRIAGE) {
      if (other.cardId === card.id || !other.cardId) continue;
      const sim = rowSimilarity(row, other);
      const prev = out.get(other.cardId);
      if (!prev || prev.score < sim.score) {
        out.set(other.cardId, { cardId: other.cardId, card: cardFor(other), row: other, ...sim });
      }
    }
  }
  const ranked = [...out.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  // Relative as well as absolute: how alike two rows can look depends on how
  // much the rules wrote about them, so a card with one strong look-alike must
  // not also list four distant ones just because its own wording is long.
  const cut = Math.max(floor, ratio * ranked[0].score);
  return ranked.filter((x) => x.score >= cut).slice(0, limit);
}

// --- The root read --------------------------------------------------------

/**
 * The rules carry one named differential of their own: pull a plant and read
 * the roots. Its four readings are plain words ("nematode", "acid soil"), so
 * each is matched to a card whose id is made of those same words — and only
 * where that is unambiguous, and only among the categories a root read can
 * reach. "rot" and "water only" resolve to no card and stay as the rules wrote
 * them, rather than being forced onto the nearest id that happens to contain
 * the word "rot".
 */
const ROOT_CATEGORIES = new Set(['soil', 'disease']);

function cardForReading(reading) {
  const want = segmentsOf(reading);
  if (!want.size) return null;
  const hits = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (!ROOT_CATEGORIES.has(CARD_BY_ID[id].category)) continue;
    if (subset(want, have)) hits.push(id);
  }
  return hits.length === 1 ? hits[0] : null;
}

const ROOT_READ = (() => {
  const raw = RULES.root_read || {};
  const readings = Object.entries(raw)
    .filter(([sign]) => sign !== 'when')
    .map(([sign, reading]) => ({ sign, reading, cardId: cardForReading(reading) }));
  return {
    when: raw.when || '',
    test: 'Pull a plant and read the roots',
    readings,
    cardIds: readings.map((r) => r.cardId).filter(Boolean),
  };
})();

const rootReadCovers = (cardId) => ROOT_READ.cardIds.includes(cardId);

// --- separatingSymptom ----------------------------------------------------

/**
 * How much a confirm test tells you that the OTHER candidate does not already
 * show. The sharper test is the one that introduces new observations rather
 * than restating signs both causes share — "cut the stem in clear water and
 * watch for milky threads" against "cut the lower stem and look for a brown
 * ring", where both causes already wilt and both tests already cut a stem.
 */
function testSharpness(row, otherRow) {
  let sharp = 0;
  for (const term of row.confirmTerms.keys()) {
    if (otherRow.signs.has(term) || otherRow.confirmTerms.has(term)) continue;
    sharp += confirmWeight(term);
  }
  return sharp;
}

function bestRowFor(cardId, against) {
  const rows = rowsForCard(cardId);
  if (rows.length < 2) return rows[0] || null;
  return rows.slice().sort((a, b) => testSharpness(b, against) - testSharpness(a, against))[0];
}

/**
 * FR-DOC-02 — name the look-alike and the test that tells them apart.
 *
 * Accepts two cards (or card ids, or triage rows), or the `rows` array from
 * matchTriage(), in which case it separates the top two. Every test it returns
 * is a test the rules name: the root read, or a triage row's confirm step.
 */
function separatingSymptom(a, b) {
  if (Array.isArray(a)) {
    if (a.length < 2) return null;
    return separatingSymptom(a[0].card || a[0].row || a[0], a[1].card || a[1].row || a[1]);
  }
  const cardA = cardFor(a);
  const cardB = cardFor(b);
  if (!cardA || !cardB || cardA.id === cardB.id) return null;

  // 1. The rules' own named differential, where it covers both.
  if (rootReadCovers(cardA.id) && rootReadCovers(cardB.id)) {
    const readingFor = (id) => ROOT_READ.readings.find((r) => r.cardId === id);
    return {
      kind: 'root_read',
      test: ROOT_READ.test,
      source: 'rules root_read',
      when: ROOT_READ.when,
      readings: ROOT_READ.readings,
      discriminator: discriminatorBetween(cardA.id, cardB.id),
      points_to: cardA,
      away_from: cardB,
      tests: [cardA, cardB].map((card) => ({
        test: `${ROOT_READ.test}: ${(readingFor(card.id) || {}).sign || ''}`.trim(),
        from: 'root_read',
        points_to: card,
      })),
    };
  }

  // 2. Otherwise the confirm step on each one's triage row, sharper test first.
  const rowA = bestRowFor(cardA.id, rowsForCard(cardB.id)[0] || TRIAGE[0]);
  const rowB = bestRowFor(cardB.id, rowA || TRIAGE[0]);
  if (!rowA || !rowB) return null;

  const tests = [
    { test: rowA.confirm, from: `triage row ${rowA.n}`, points_to: cardA, sharpness: testSharpness(rowA, rowB) },
    { test: rowB.confirm, from: `triage row ${rowB.n}`, points_to: cardB, sharpness: testSharpness(rowB, rowA) },
  ].sort((x, y) => y.sharpness - x.sharpness);

  return {
    kind: 'confirm_test',
    test: tests[0].test,
    source: tests[0].from,
    points_to: tests[0].points_to,
    away_from: tests[0].points_to.id === cardA.id ? cardB : cardA,
    discriminator: discriminatorBetween(cardA.id, cardB.id),
    tests,
  };
}

/** The single sign one of them asserts and the other denies, if there is one. */
function discriminatorBetween(idA, idB) {
  const rowsA = rowsForCard(idA);
  const rowsB = rowsForCard(idB);
  let best = null;
  for (const ra of rowsA) {
    for (const rb of rowsB) {
      for (const [term, ca] of ra.signs) {
        const cb = rb.signs.get(term);
        if (cb === undefined || polarity(ca) === polarity(cb)) continue;
        const weight = signWeight(term);
        if (!best || weight > best.weight) {
          best = { term, weight, asserted_by: polarity(ca) > 0 ? idA : idB, denied_by: polarity(ca) > 0 ? idB : idA };
        }
      }
    }
  }
  return best;
}

// --- Step 2: the card, but only after photos and the confirm step ---------

/**
 * FR-DOC-01 — the Farm Doctor asks for photos and the confirm step before
 * naming a cause. This is the gate that makes that true rather than advisory:
 * until a draft carries both, nameCause() hands back what is missing instead of
 * a card. FR-DOC-08 adds the second half: it never confirms its own answer.
 */
function namingGate(draft = {}) {
  const missing = [];
  const row = draft.triageRow != null ? TRIAGE_BY_N.get(Number(draft.triageRow)) : null;
  if (!row) missing.push({ id: 'row', need: 'Pick the triage row that matches what you can see' });
  if (!((draft.photos || []).length)) {
    missing.push({ id: 'photos', need: 'Take at least one photo of the affected plant' });
  }
  if (!String(draft.confirmTest || '').trim()) {
    missing.push({ id: 'confirmTest', need: 'Do the confirm test the row names, and record which test you did' });
  }
  if (!String(draft.confirmResult || '').trim()) {
    missing.push({ id: 'confirmResult', need: 'Say what the confirm test showed' });
  }
  return { ok: missing.length === 0, missing, row };
}

/**
 * symptom -> row -> card -> confirm test, in one call.
 *
 * Returns the card only once the gate above is satisfied. The confirm test and
 * the look-alikes come back either way, because those are what the person has
 * to go and do.
 */
function nameCause(draft = {}) {
  const gate = namingGate(draft);
  const row = gate.row;
  const card = row ? cardFor(row) : null;
  const lookalikes = card ? lookalikesFor(card.id) : [];
  const out = {
    ok: gate.ok,
    missing: gate.missing,
    row,
    confirmTest: row ? row.confirm : null,
    firstAction: row ? row.firstAction : null,
    lookalikes,
    separator: card && lookalikes.length ? separatingSymptom(card.id, lookalikes[0].cardId) : null,
    labRecommended: card ? labRecommendedFor(card, draft) : false,
    rulesVersion: RULES_VERSION,
  };
  // FR-DOC-01: no cause is named until the photos and the confirm step are in.
  out.card = gate.ok ? card : null;
  // FR-KNOW-05: the registry ids behind the row and the card it names.
  out.sources = gate.ok ? sourcesOf([row, card]) : [];
  return out;
}

/**
 * FR-DOC-09 / FR-DIAG-05 — when the rules say a lab has to settle it.
 * The trigger list is the rules' own `farm_doctor.lab_required_for`, matched by
 * the card's category and id rather than by a list kept here.
 */
function labRecommendedFor(cardOrId, draft = {}) {
  const card = cardFor(cardOrId);
  if (!card) return false;
  const triggers = (RULES.farm_doctor && RULES.farm_doctor.lab_required_for) || [];
  const haystack = triggers.join(' ; ').toLowerCase();
  const terms = termsOf(haystack);
  const idHit = [...segmentsOf(card.id)].some((s) => terms.has(stem(s)));
  const categoryHit = terms.has(stem(card.category));
  const lowTwice = String(draft.confidence || '').toLowerCase() === 'low' && draft.secondLowConfidence === true;
  return idHit || categoryHit || lowTwice;
}

/** The Farm Doctor's own limits, straight from the rules (FR-DOC-08). */
const FARM_DOCTOR = RULES.farm_doctor || {};
const FARM_DOCTOR_NEVER = FARM_DOCTOR.never || [];
const FARM_DOCTOR_ROLE = FARM_DOCTOR.role || '';

// --- Step 3: who may confirm it (FR-DIAG-02, FR-DIAG-03, FR-DOC-10) -------

/** A diagnosis this engine produced carries its stamp; older ones do not. */
const isLegacyDiagnosis = (d) => !d || (!d.cardId && !d.engine);

/**
 * The structural half of "no diagnosis is confirmed without the confirm step".
 * store.js and server/core.mjs both enforce this; it lives here so there is one
 * definition of what a finished diagnosis looks like.
 */
function confirmStepDone(d) {
  if (!d) return false;
  return Boolean(d.cardId)
    && Boolean(String(d.confirmTest || '').trim())
    && Boolean(String(d.confirmResult || '').trim())
    && (d.photos || []).length > 0;
}

/**
 * FR-DIAG-03 — a hand may start a diagnosis; a Field Supervisor or Farm Manager
 * performs the confirm test and confirms it. FR-DOC-08 — the Farm Doctor never
 * confirms its own.
 *
 * FR-ROLE-12 — a second person is preferred. The person who raised it may
 * confirm it only when nobody else qualified is on the farm (`others`, from
 * selfcheck.otherConfirmers). That is allowed and the answer says so: `self`
 * is true and `approver` names who approves a treatment from it (null for the
 * Owner, whose own confirmation is recorded rather than sent up).
 */
function canConfirm(diagnosis, { by = null, senior = true, role = null, others = [] } = {}) {
  if (!diagnosis) return { ok: false, reason: 'missing', why: 'There is no such diagnosis.' };
  if (isLegacyDiagnosis(diagnosis)) {
    return {
      ok: false,
      reason: 'legacy',
      why: 'This record predates the rules engine, so it has no card and no confirm step behind it.',
      fix: 'Run the guided diagnosis again on the bed, then confirm that one.',
    };
  }
  const gate = namingGate(diagnosis);
  if (!confirmStepDone(diagnosis)) {
    return {
      ok: false,
      reason: 'no-confirm-step',
      why: 'The confirm test and the photos are what turn a match into a diagnosis.',
      missing: gate.missing.length ? gate.missing : [{ id: 'confirmTest', need: 'Record the confirm test and what it showed' }],
    };
  }
  if (by === FARM_DOCTOR_ID) {
    return { ok: false, reason: 'doctor', why: 'The Farm Doctor never confirms its own diagnosis (FR-DOC-08).' };
  }
  if (!senior) {
    return { ok: false, reason: 'rank', why: 'Only the Field Supervisor or the Farm Manager confirms a diagnosis.' };
  }
  if (by && diagnosis.by && by === diagnosis.by) {
    if (others.length) {
      const names = others.map((p) => p.name || p.id).join(' or ');
      return { ok: false, reason: 'second-person', others,
        why: `You raised this one, and ${names} ${others.length === 1 ? 'is' : 'are'} on the farm. A second person confirms it.`,
        fix: `Ask ${names} to do the confirm test and confirm it.` };
    }
    const approver = approverFor(role);
    return {
      ok: true,
      self: true,
      approver,
      why: approver
        ? 'You raised this one and nobody else qualified is in, so you may confirm it. It is marked '
          + `self-confirmed, and the ${roleTitle(approver)} approves it before any treatment.`
        : 'You raised this one. Your confirmation is recorded as self-confirmed.',
    };
  }
  return { ok: true, self: false, approver: null };
}

// --- Old records ----------------------------------------------------------

/**
 * "Keep existing diagnosis records readable; map them to cards where the match
 * is clear and mark the rest legacy."
 *
 * Clear means derivable, in two passes and no hand-written table:
 *   1. the ids are made of the same words, one inside the other —
 *      phytophthora_blight -> phytophthora, bacterial_leaf_spot ->
 *      bacterial_spot, sunscald -> sunscald_cracking, red_spider_mite ->
 *      spider_mite;
 *   2. failing that, the old entry NAMES the card in its own text and sits in
 *      the same family — "Helicoverpa armigera and Spodoptera species" is the
 *      helicoverpa card; "Cucumber mosaic virus" is the mosaic_virus card.
 *
 * Everything else — Cercospora leaf spot, PVMV, leaf curl, fruit fly, the
 * nutrient shortages — stays legacy and says so. Guessing a card for those
 * would put a wrong cause on a real record, which is worse than leaving it.
 */
const FAMILY = {
  fungal: 'disease', bacterial: 'disease', viral: 'virus', insect: 'pest',
  mite: 'pest', nematode: 'soil', disorder: 'disorder', deficiency: 'disorder',
};

function mapLegacyId(problemId) {
  const legacy = segmentsOf(problemId);
  if (!legacy.size) return null;

  const byWords = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (subset(have, legacy) || subset(legacy, have)) byWords.push(id);
  }
  if (byWords.length === 1) return byWords[0];
  if (byWords.length > 1) return null;

  const problem = PROBLEM_BY_ID[problemId];
  if (!problem) return null;
  const text = termsOf([problem.name, problem.local, problem.cause].filter(Boolean).join('; '));
  const family = FAMILY[problem.type];
  const byName = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (family && CARD_BY_ID[id].category !== family) continue;
    if ([...have].every((s) => text.has(stem(s)))) byName.push(id);
  }
  return byName.length === 1 ? byName[0] : null;
}

/** problemId (old field-guide id) -> card id, for every old id that maps. */
const LEGACY_CARD_MAP = Object.freeze(Object.fromEntries(
  PROBLEMS.map((p) => [p.id, mapLegacyId(p.id)]).filter(([, card]) => card),
));

/** card id -> the old field-guide entry behind it, where there is one. */
const CARD_TO_PROBLEM = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_CARD_MAP).map(([problemId, cardId]) => [cardId, problemId]),
));

/**
 * Read any diagnosis record, old or new, into one shape the screens can show.
 * Old records keep their own wording; they are marked legacy rather than
 * rewritten, because the event log is a record of what people actually did.
 */
function readDiagnosis(record) {
  if (!record) return null;
  const direct = record.cardId ? CARD_BY_ID[record.cardId] : null;
  const mapped = direct || (record.problemId ? CARD_BY_ID[LEGACY_CARD_MAP[record.problemId]] : null);
  const problem = record.problemId ? PROBLEM_BY_ID[record.problemId] : null;
  const legacy = !record.cardId;
  return {
    ...record,
    card: mapped || null,
    cardId: mapped ? mapped.id : null,
    label: (mapped && mapped.name) || record.problemName || (problem && problem.name) || record.problemId || 'Unnamed',
    legacy,
    // A legacy record that maps cleanly is still a legacy record: nobody did the
    // rules' confirm test on it. The card is shown as "read as", not as fact.
    mapping: legacy ? (mapped ? 'mapped' : 'legacy') : 'rules',
    confirmed: Boolean(record.confirmedBy),
    confirmStep: confirmStepDone(record),
    // FR-ROLE-12/13 — confirmed by the person who raised it, and whether a
    // treatment is still waiting on the next level up.
    selfConfirmed: Boolean(record.confirmedBy && record.selfConfirmed),
    awaitingApproval: awaitingApproval(record),
    treatable: treatable(record),
  };
}

// --- Reference photos (FR-DIAG-01, UX-11) --------------------------------
//
// Every triage row and every diagnosis card has a slot for one reference
// photo: 23 + 22 = 45 slots, derived from the rules like everything else here.
// The pictures themselves are not: the rules JSON is the source of truth and
// the app never writes to it. A reference photo is the farm's own material,
// taken or chosen by the Owner or the Farm Manager, and it travels with the
// farm's other photos in the event log so every phone gets it on the next sync
// and it still works with no signal (NFR-OFF-01).
//
// The two slots hold different pictures on purpose. A row's photo is the thing
// as you first see it walking the house — that is what the tick-list is for. A
// card's photo is the confirmed thing, next to its cause and its treatment. So
// a row does not borrow its card's picture, or the wizard would be showing the
// answer at the step that is supposed to be a question.
//
// An empty slot is not an error and never blocks anything. The rules' own
// wording is the fallback, and the wording is what the engine matches on
// either way.

const rowSlot = (n) => `row:${n}`;
const cardSlot = (cardId) => `card:${cardId}`;

/** Every slot the app knows about, in the order the guide lists them. */
const PHOTO_SLOTS = [
  ...TRIAGE.map((row) => ({
    slot: rowSlot(row.n),
    kind: 'row',
    n: row.n,
    cardId: row.cardId,
    label: row.see,
    where: `Triage row ${row.n}`,
    shows: 'What you see in the house, before anything is confirmed.',
  })),
  ...CARDS.map((card) => ({
    slot: cardSlot(card.id),
    kind: 'card',
    n: null,
    cardId: card.id,
    label: card.name,
    where: `${card.name} card`,
    shows: card.detection,
  })),
];

const PHOTO_SLOT_BY_ID = new Map(PHOTO_SLOTS.map((s) => [s.slot, s]));

/** Guards the store and the server against a slot nothing in the rules has. */
const isPhotoSlot = (slot) => PHOTO_SLOT_BY_ID.has(slot);

/** The photo held in a slot, or null when the slot is empty. */
function referencePhoto(state, slot) {
  const held = (state && state.referencePhotos) || {};
  const hit = held[slot];
  return hit && hit.photo && hit.photo.dataUrl ? hit : null;
}

const rowPhoto = (state, n) => referencePhoto(state, rowSlot(n));
const cardPhoto = (state, cardId) => referencePhoto(state, cardSlot(cardId));

/**
 * The tick-list, with each cue carrying its row's photo where there is one.
 *
 * Every cue keeps its words whether or not a picture turns up beside them, so
 * an empty slot costs the person nothing: UX-11 offers photo cards OR a
 * searchable list by name, and this is both at once.
 */
function photoCues(state) {
  return CUES.map((cue) => {
    const n = cue.rows[0];
    const held = n != null ? rowPhoto(state, n) : null;
    return { ...cue, photo: held ? held.photo : null, caption: held ? held.caption : '' };
  });
}

/**
 * Which slots are filled and which are still empty — the answer to "show me
 * the cards that still have no photo".
 */
function photoCoverage(state) {
  const filled = [];
  const missing = [];
  for (const slot of PHOTO_SLOTS) {
    const held = referencePhoto(state, slot.slot);
    (held ? filled : missing).push(held ? { ...slot, held } : slot);
  }
  const split = (kind) => {
    const all = PHOTO_SLOTS.filter((s) => s.kind === kind);
    const gaps = missing.filter((s) => s.kind === kind);
    return { total: all.length, have: all.length - gaps.length, missing: gaps };
  };
  return {
    cards: split('card'),
    rows: split('row'),
    total: PHOTO_SLOTS.length,
    have: filled.length,
    missing,
    percent: PHOTO_SLOTS.length ? filled.length / PHOTO_SLOTS.length : 0,
    bytes: filled.reduce((n, s) => n + ((s.held.photo || {}).bytes || 0), 0),
  };
}

// --- Browsing -------------------------------------------------------------

/** Search the 22 cards and the 23 rows by any word in them. */
function searchCards(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CARDS;
  return CARDS.filter((c) => {
    const rows = rowsForCard(c.id);
    const hay = [c.id, c.name, c.category, c.cause, c.prevention, c.detection, c.treatment,
      ...rows.map((r) => `${r.see} ${r.confirm} ${r.firstAction}`)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** The local field guide, kept for the product, PHI and weather detail. */
function searchProblems(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return PROBLEMS.filter((p) => {
    const hay = [p.name, p.local, p.cause, p.type, ...(p.confirm || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// --- The risk board -------------------------------------------------------

/**
 * Standing risk board: what the weather and the crop stage make likely right
 * now, before anyone reports anything. This is the early-warning half of the
 * clinic, and it is what lets a manager walk the right house first. It reads
 * the local field guide rather than the rules, because the weather response of
 * each problem is not in the rules JSON.
 */
function riskForecast(cycles, date = new Date(), observed = null) {
  const byProblem = new Map();
  for (const cyc of cycles) {
    const stage = cyc.stage;
    for (const problem of PROBLEMS) {
      if (problem.crops && !problem.crops.includes(cyc.cropId)) continue;
      if (problem.stages && stage && !problem.stages.includes(stage)) continue;
      const conditions = problem.conditions || {};
      const keys = Object.keys(conditions);
      if (!keys.length) continue;
      const idx = {
        wetness: wetnessIndex(date, observed),
        dryness: drynessIndex(date, observed),
        waterlogging: waterloggingIndex(date, observed),
      };
      let weighted = 0;
      let total = 0;
      for (const k of keys) { weighted += conditions[k] * (idx[k] ?? 0.5); total += conditions[k]; }
      const pressure = total ? weighted / total : 0;
      const risk = clamp(pressure * (0.5 + 0.1 * problem.severity), 0, 1);
      const entry = byProblem.get(problem.id) || {
        problem, risk: 0, beds: [], driver: keys.sort((a, b) => conditions[b] - conditions[a])[0],
        cardId: LEGACY_CARD_MAP[problem.id] || null,
      };
      entry.risk = Math.max(entry.risk, risk);
      entry.beds.push(cyc.label || cyc.id);
      byProblem.set(problem.id, entry);
    }
  }
  return [...byProblem.values()]
    .filter((e) => e.risk >= 0.3)
    .sort((a, b) => b.risk - a.risk);
}

const RISK_DRIVER_TEXT = {
  wetness: 'wet leaves and rain splash',
  dryness: 'hot dry weather',
  waterlogging: 'water standing in the beds',
};
})(__dvModule("web/js/domain/diagnose.js"));
__dvBindAll();

// ─── web/js/domain/catalogue.js ────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "slug": { enumerable: true, get: () => slug },
  "aliasesFor": { enumerable: true, get: () => aliasesFor },
  "normaliseCode": { enumerable: true, get: () => normaliseCode },
  "parseGroup": { enumerable: true, get: () => parseGroup },
  "sameGroup": { enumerable: true, get: () => sameGroup },
  "defaultIntervals": { enumerable: true, get: () => defaultIntervals },
  "bannedNames": { enumerable: true, get: () => bannedNames },
  "isBanned": { enumerable: true, get: () => isBanned },
  "buildCatalogue": { enumerable: true, get: () => buildCatalogue },
  "normaliseLabel": { enumerable: true, get: () => normaliseLabel },
  "statedRate": { enumerable: true, get: () => statedRate },
  "rateFor": { enumerable: true, get: () => rateFor },
  "canUseActive": { enumerable: true, get: () => canUseActive },
  "sprayIntervals": { enumerable: true, get: () => sprayIntervals },
  "usableActives": { enumerable: true, get: () => usableActives },
  "checkAddActive": { enumerable: true, get: () => checkAddActive },
  "checkAddLabel": { enumerable: true, get: () => checkAddLabel },
  "LEGACY_PRODUCT_IDS": { enumerable: true, get: () => LEGACY_PRODUCT_IDS },
  "resolveActive": { enumerable: true, get: () => resolveActive },
  "groupOfSpray": { enumerable: true, get: () => groupOfSpray },
  "planStockMigration": { enumerable: true, get: () => planStockMigration },
  "migrationEvents": { enumerable: true, get: () => migrationEvents },
  "migrateStockToActives": { enumerable: true, get: () => migrateStockToActives },
});
let can;
let DEFAULT_REI_HOURS, defaultPhiDays, getRules, ref;
__dvImport("web/js/store.js", (m) => { can = m.can; });
__dvImport("web/js/rules.js", (m) => { DEFAULT_REI_HOURS = m.DEFAULT_REI_HOURS; }, (m) => { defaultPhiDays = m.defaultPhiDays; }, (m) => { getRules = m.getRules; }, (m) => { ref = m.ref; });
// The active-ingredient catalogue — FR-STOCK-05 to FR-STOCK-09, Build Rules 11d.
//
// A treatment is chosen by what is in the bottle, not by what is printed on it.
// Season 1 was sprayed by brand name: three products called Punch, Vanguish and
// Lion Seal went on the same crop, and nobody could say whether that was a
// rotation or the same chemical three times. A brand tells you nothing about
// resistance; the active ingredient and its IRAC/FRAC group tell you everything,
// and the rotation gate is built on those groups.
//
// So the catalogue is the twenty actives in the rules file, with their groups,
// and nothing else. Brands come back as *labels*: a manager attaches a brand to
// one or more actives, and the group fills itself in from the active. Nobody
// types a group by hand, which is what stops a guessed group from quietly
// defeating the rotation gate (decision C-6).
//
// Everything here reads rules/douvalue_rules_rev5_1.json. Every value carries a
// `source` pointer back into that file, so a refused spray can be traced to the
// rule that refused it.




// --- Names and ids ---------------------------------------------------------

/** A stable id for an active, derived from its name so two phones agree. */
function slug(name) {
  return String(name || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The other names one active answers to.
 *
 * Nothing is invented: the rules file's own wording is split on its own
 * punctuation. "Azadirachtin / neem oil" is one active under two names on the
 * shelf; "Bacillus thuringiensis (Bt)" carries its short form in brackets. A
 * bracket that says where something came from rather than what it is called —
 * "(farm-made)" — is not a name, so it is left out.
 */
function aliasesFor(name) {
  const out = new Set([norm(name)]);
  const outside = norm(String(name).replace(/\(.*?\)/g, ' '));
  if (outside) out.add(outside);
  for (const m of String(name).matchAll(/\((.*?)\)/g)) {
    const inside = norm(m[1]);
    if (inside && !inside.includes('farm-made')) out.add(inside);
  }
  for (const part of String(name).split('/')) {
    const p = norm(part.replace(/\(.*?\)/g, ' '));
    if (p) out.add(p);
  }
  return [...out].filter((a) => a.length >= 2);
}

// --- Resistance groups -----------------------------------------------------

/**
 * Multi-site protectants are written M1/M2/M3 in the rules and M01/M02/M03 on
 * some labels and in the older product table. Same group, and the rotation
 * check has to see it that way or Mancozeb would rotate with itself.
 */
function normaliseCode(code) {
  const c = String(code || '').toUpperCase().replace(/\s+/g, '');
  return /^M0\d+$/.test(c) ? c.replace(/^M0+/, 'M') : c;
}

/**
 * Read "IRAC 3A", "FRAC 4 + M3", "BM02" or "none" into something comparable.
 *
 * `rotates` is false for the two entries the rules record as *not* a resistance
 * group: "none" (farm-made garlic-chilli) and IRAC UN, which is the code for an
 * unknown mode of action rather than a group you can rotate out of. Treating UN
 * as a group would make the Week 10 organics programme impossible to obey —
 * from Week 10 neem is one of only three products allowed, and it is meant to
 * be repeated every 5-7 days.
 */
function parseGroup(group) {
  const text = String(group || '').trim();
  if (!text || norm(text) === 'none') return { text: text || 'none', system: null, codes: [], rotates: false };
  const m = /^(IRAC|FRAC)\b/i.exec(text);
  const system = m ? m[1].toUpperCase() : (/^BM\d/i.test(text) ? 'FRAC' : null);
  const codes = text.replace(/^(IRAC|FRAC)\b/i, '')
    .split('+').map((c) => normaliseCode(c)).filter(Boolean);
  const rotates = codes.length > 0 && !codes.every((c) => c === 'UN' || c === 'NC');
  return { text, system, codes, rotates };
}

/** Do two actives share a resistance group? "FRAC 4 + M3" shares M3 with Mancozeb. */
function sameGroup(a, b) {
  if (!a || !b || !a.rotates || !b.rotates) return false;
  if (a.system && b.system && a.system !== b.system) return false;
  return a.codes.some((c) => b.codes.includes(c));
}

// --- PHI and REI defaults (FR-STOCK-07, rules §9) --------------------------

const HOURS = (s) => {
  const m = /(\d+)\s*h/i.exec(String(s || ''));
  return m ? Number(m[1]) : null;
};

/**
 * The default waiting periods, read out of the rules `phi` table.
 *
 * The table is keyed by product prose ("Cypermethrin, Thiamethoxam,
 * Chlorantraniliprole"), so an active matches an entry when the entry names it.
 * The last row — "Any other synthetic" — is the catch-all, and it is what makes
 * a blank label safe: 14 days before picking, 24 hours before anyone goes back
 * in, until somebody enters the real figures off the container.
 */
function defaultIntervals(active, rules = getRules()) {
  const rows = rules.phi || [];
  const name = norm(active.name);
  let fallback = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const products = norm(row.product);
    if (/any other/.test(products)) { fallback = { row, i }; continue; }
    // A row names several products in one string ("Garlic-chilli, Neem oil,
    // Trichoderma"), each in shorter form than the catalogue name, so the row
    // name has to be looked for inside the active rather than the other way.
    const named = products.split(/[,;]/).map((s2) => norm(s2.replace(/\(.*?\)/g, ' ')))
      .filter((s2) => s2.length >= 3);
    if (named.some((n) => name.includes(n) || aliasesFor(active.name).includes(n))) {
      return {
        phiDays: Number(row.phi_days) || 0,
        reiHours: HOURS(row.rei_default) ?? 24,
        exportBufferDays: row.export_buffer_days ?? null,
        source: ref(`phi/${i}`),
      };
    }
  }
  const row = fallback ? fallback.row : {};
  return {
    phiDays: Number.isFinite(Number(row.phi_days)) ? Number(row.phi_days) : 14,
    reiHours: HOURS(row.rei_default) ?? 24,
    exportBufferDays: row.export_buffer_days ?? null,
    source: fallback ? ref(`phi/${fallback.i}`) : ref('phi'),
  };
}

// --- The catalogue ---------------------------------------------------------

function activeFromRules(entry, i, rules) {
  const group = parseGroup(entry.group);
  const base = {
    id: slug(entry.ai),
    name: entry.ai,
    type: entry.type || '',
    group: entry.group,
    groupSystem: group.system,
    groupCodes: group.codes,
    rotates: group.rotates,
    scheduleRate: entry.schedule_rate || null,
    aliases: aliasesFor(entry.ai),
    addedBy: null,
    source: ref(`active_ingredients/${i}`),
    groupSource: ref(`active_ingredients/${i}/group`),
  };
  const defaults = defaultIntervals(base, rules);
  return {
    ...base,
    // An active carrying its own phi_days in the rules overrides the table:
    // that is the rules being specific about this one product.
    phiDays: entry.phi_days != null ? Number(entry.phi_days) : defaults.phiDays,
    phiSource: entry.phi_days != null ? ref(`active_ingredients/${i}/phi_days`) : defaults.source,
    reiHours: defaults.reiHours,
    reiSource: defaults.source,
    exportBufferDays: defaults.exportBufferDays,
  };
}

/** The banned actives, as the rules name them. Never in the catalogue at all. */
function bannedNames(rules = getRules()) {
  return ((rules.labels || {}).banned || []).map(String);
}

/**
 * FR-STOCK-09 — is this a banned active?
 *
 * The rules write it "Carbofuran (Furadan)", one entry naming both the active
 * and the brand it is sold under here, so both have to be refused. A ban that
 * only catches the word the buyer does not use is not a ban.
 */
function isBanned(name, rules = getRules()) {
  const text = norm(name).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return false;
  for (const entry of bannedNames(rules)) {
    // Whole names, not loose words: "Carbofuran" and "Furadan" each ban a
    // container, where a bare word like "oil" from some future entry would ban
    // half the store.
    for (const alias of aliasesFor(entry)) {
      const phrase = alias.replace(/[^a-z0-9]+/g, ' ').trim();
      if (!phrase) continue;
      if (new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)) return true;
    }
  }
  return false;
}

/**
 * Build the catalogue: the twenty actives from the rules, plus any the Owner
 * has added since, plus the brand labels managers have attached to them.
 *
 * A banned active is filtered out at the last moment as well as refused at the
 * door, so that even a log that somehow carries one — a bad merge, an older
 * build — cannot put it back on a spray screen.
 */
function buildCatalogue(state = {}, rules = getRules()) {
  const actives = (rules.active_ingredients || [])
    .map((entry, i) => activeFromRules(entry, i, rules))
    .filter((a) => !isBanned(a.name, rules));

  for (const added of Object.values(state.actives || {})) {
    if (isBanned(added.name || added.ai, rules)) continue;
    const group = parseGroup(added.group);
    if (!group.text || !added.group) continue;   // no group on file, no catalogue entry
    const name = added.name || added.ai;
    const base = {
      id: added.id || slug(name),
      name,
      type: added.type || '',
      group: added.group,
      groupSystem: group.system,
      groupCodes: group.codes,
      rotates: group.rotates,
      scheduleRate: added.scheduleRate || null,
      aliases: aliasesFor(name),
      addedBy: added.by || added.addedBy || null,
      addedAt: added.at || null,
      source: 'farm record: active.add',
      groupSource: 'farm record: active.add (Owner, with its group)',
    };
    const defaults = defaultIntervals(base, rules);
    const already = actives.findIndex((a) => a.id === base.id);
    const entry = { ...base, phiDays: defaults.phiDays, phiSource: defaults.source,
      reiHours: defaults.reiHours, reiSource: defaults.source,
      exportBufferDays: defaults.exportBufferDays };
    if (already >= 0) actives[already] = { ...actives[already], ...entry };
    else actives.push(entry);
  }

  const byId = Object.fromEntries(actives.map((a) => [a.id, a]));
  const labels = Object.values(state.labels || {})
    .filter((l) => !l.retired)
    .map((l) => normaliseLabel(l, byId, rules))
    .filter((l) => l.activeIds.length);

  for (const label of labels) {
    for (const id of label.activeIds) if (byId[id]) (byId[id].labels = byId[id].labels || []).push(label);
  }
  for (const a of actives) a.labels = a.labels || [];

  return { actives, byId, labels, rules, banned: bannedNames(rules) };
}

/**
 * FR-STOCK-06 — a brand label, with the group filled in from its actives.
 *
 * FR-STOCK-07 is the sharp bit: a blank PHI or REI takes the default, and an
 * entered value is used *only if it is longer*. A label that claims a shorter
 * waiting period than the rules' default does not shorten it — that is how a
 * cheap re-labelled container would otherwise talk the app into clearing fruit
 * a week early.
 */
function normaliseLabel(label, byId, rules = getRules()) {
  const activeIds = (label.activeIds || []).filter((id) => byId[id]);
  const actives = activeIds.map((id) => byId[id]);
  const defaultPhi = Math.max(0, ...actives.map((a) => a.phiDays || 0), 0);
  const defaultRei = Math.max(0, ...actives.map((a) => a.reiHours || 0), 0) || 24;
  const entered = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const phiEntered = entered(label.phiDays);
  const reiEntered = entered(label.reiHours);
  return {
    ...label,
    activeIds,
    groups: [...new Set(actives.map((a) => a.group))],
    phiDays: phiEntered != null && phiEntered > defaultPhi ? phiEntered : defaultPhi,
    phiIsDefault: !(phiEntered != null && phiEntered > defaultPhi),
    phiEntered,
    reiHours: reiEntered != null && reiEntered > defaultRei ? reiEntered : defaultRei,
    reiIsDefault: !(reiEntered != null && reiEntered > defaultRei),
    reiEntered,
    rateSource: ref('labels/rate_rule'),
    defaultsSource: ref('rei/rule'),
  };
}

// --- Rate, and what may be used (FR-STOCK-08) ------------------------------

/**
 * Where the dose comes from: the schedule rate for the active, or a rate off a
 * label somebody has entered. If there is neither, the product cannot be used.
 *
 * This is not a warning. An invented dose is how a crop gets burnt and how a
 * residue test gets failed, and the Farm Doctor is forbidden from guessing one
 * (rules farm_doctor.never). So the answer is "no", with the fix attached.
 */
function statedRate(text) {
  const t = String(text || '').trim();
  // "per label" and "see prep table" are pointers, not doses. The rules forbid
  // inventing a dose, so an active whose schedule points elsewhere needs the
  // label entering before anybody can mix it.
  return /\d/.test(t) ? t : null;
}

function rateFor(catalogue, activeId) {
  const active = catalogue.byId[activeId];
  if (!active) return { ok: false, reason: 'unknown-active', rate: null };
  const scheduled = statedRate(active.scheduleRate);
  if (scheduled) {
    return { ok: true, rate: scheduled, from: 'schedule', source: active.source };
  }
  const labelled = (active.labels || []).find((l) => statedRate(l.rate));
  if (labelled) {
    return { ok: true, rate: labelled.rate, from: 'label', label: labelled, source: 'farm record: label.add' };
  }
  return { ok: false, reason: 'no-rate', rate: null, scheduleSays: active.scheduleRate || null,
    source: ref('labels/rate_rule') };
}

/** FR-STOCK-08 — may this active be chosen at all? */
function canUseActive(catalogue, activeId) {
  const active = catalogue.byId[activeId];
  if (!active) {
    return { ok: false, reason: 'unknown-active', why: 'That product is not in the catalogue.',
      fix: 'Treatments are chosen by active ingredient. Pick one from the catalogue, or ask the Owner to add it.' };
  }
  const rate = rateFor(catalogue, activeId);
  if (!rate.ok) {
    return {
      ok: false, reason: 'no-rate', active,
      why: `${active.name} has no rate: the schedule does not give one${rate.scheduleSays
        ? ` (it says "${rate.scheduleSays}")` : ''} and no label has been entered.`,
      fix: 'The Farm Manager adds a brand label for it — brand, formulation, concentration and the rate off '
        + 'the container — and then it can be used.',
      source: rate.source,
    };
  }
  return { ok: true, active, rate };
}

/**
 * FR-STOCK-07, FR-TREAT-02 — the waiting periods a spray carries, from the
 * catalogue rather than from whatever the record says.
 *
 * The phone that logged the spray wrote `phiDays` and `reiHours` onto it, and
 * the harvest block used to read those numbers back as given — so a record
 * claiming a shorter wait than the product has would have opened the bed early
 * on every phone, and on the farm server. Here the catalogue decides: the
 * active's own waiting period, or the label's where a label is named and its
 * entered figure is longer (normaliseLabel already holds that floor). A figure
 * on the record is kept only where it is longer still.
 *
 * A product the catalogue does not know — a spray from before the catalogue —
 * keeps what its record says, or the rules' synthetic defaults if it says
 * nothing. A new spray of an unknown product never gets this far: the rotation
 * gate refuses it.
 */
function sprayIntervals(catalogue, spray = {}) {
  const entered = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const phiOn = entered(spray.phiDays);
  const reiOn = entered(spray.reiHours);
  const active = catalogue ? resolveActive(catalogue, spray.activeId || spray.productId || spray.productName) : null;
  if (!active) {
    return {
      known: false, activeId: null,
      phiDays: phiOn ?? defaultPhiDays(catalogue && catalogue.rules),
      reiHours: reiOn ?? DEFAULT_REI_HOURS,
      source: phiOn != null ? 'the spray record' : ref('phi'),
    };
  }
  const label = spray.labelId ? (catalogue.labels || []).find((l) => l.id === spray.labelId) : null;
  const phi = Math.max(active.phiDays || 0, label ? label.phiDays || 0 : 0);
  const rei = Math.max(active.reiHours || 0, label ? label.reiHours || 0 : 0);
  return {
    known: true,
    activeId: active.id,
    phiDays: Math.max(phi, phiOn ?? 0),
    reiHours: Math.max(rei, reiOn ?? 0),
    source: label && label.phiDays > (active.phiDays || 0) ? `farm record: label ${label.brand || label.id}` : active.phiSource,
  };
}

/** What the spray screen may offer, in catalogue order. */
function usableActives(catalogue) {
  return catalogue.actives.filter((a) => canUseActive(catalogue, a.id).ok);
}

// --- Adding to the catalogue ----------------------------------------------

/**
 * FR-STOCK-09 — only the Owner adds an active, and must give its group.
 *
 * Three refusals, in the order that matters. Banned first: carbofuran is not a
 * permissions question, and no role on this farm may add it. Then authority.
 * Then the group, because an active with no group cannot be rotated and the
 * rules say a product without one cannot be selected at all (product_rule).
 */
function checkAddActive(person, draft, catalogue) {
  const rules = catalogue.rules;
  const name = String((draft && (draft.name || draft.ai)) || '').trim();

  if (!name) return { ok: false, reason: 'no-name', why: 'Give the active ingredient a name.' };

  if (isBanned(name, rules)) {
    return {
      ok: false, reason: 'banned',
      why: `${name} is banned on this farm and cannot be added by anybody, including the Owner.`,
      fix: 'It is not stocked, not sprayed and not listed. For root-knot nematode the rules give rotation '
        + 'with maize or marigold, neem cake and clean topsoil.',
      source: ref('labels/banned'),
    };
  }

  if (!can(person, 'manageOwners')) {
    return {
      ok: false, reason: 'not-owner',
      why: 'Only the Owner can add an active ingredient to the catalogue.',
      fix: 'Send the label photo to the Owner. Meanwhile a brand label can be attached to an active that '
        + 'is already in the catalogue.',
      source: ref('labels/new_active'),
    };
  }

  const group = parseGroup(draft.group);
  if (!draft.group || !group.codes.length) {
    return {
      ok: false, reason: 'no-group',
      why: `${name} has no IRAC or FRAC group, so the rotation gate could not see it.`,
      fix: 'The group is printed on the label, usually in a box at the top. Enter it as it appears, '
        + 'for example "IRAC 4A" or "FRAC M3".',
      source: ref('product_rule'),
    };
  }

  if (catalogue.byId[slug(name)]) {
    return { ok: false, reason: 'duplicate', why: `${name} is already in the catalogue.` };
  }

  return {
    ok: true,
    payload: {
      id: slug(name), name, group: draft.group, type: draft.type || '',
      scheduleRate: draft.scheduleRate || null,
    },
  };
}

/**
 * FR-STOCK-06 — the Farm Manager attaches a brand label to one or more actives.
 *
 * The manager never types a group. It comes from the active, which is the whole
 * point of C-18: a brand cannot mislead the rotation gate if the brand is not
 * what the gate reads.
 */
function checkAddLabel(person, draft, catalogue) {
  if (!can(person, 'settings')) {
    return { ok: false, reason: 'not-manager', why: 'Only the Farm Manager or the Owner can add a brand label.' };
  }
  const brand = String((draft && draft.brand) || '').trim();
  if (!brand) return { ok: false, reason: 'no-brand', why: 'Enter the brand name printed on the container.' };

  if (isBanned(brand, catalogue.rules)) {
    return { ok: false, reason: 'banned', why: `${brand} is a banned product and cannot be entered.`,
      source: ref('labels/banned') };
  }

  const activeIds = (draft.activeIds || []).filter(Boolean);
  const unknown = activeIds.filter((id) => !catalogue.byId[id]);
  if (!activeIds.length) {
    return {
      ok: false, reason: 'no-active',
      why: 'Choose the active ingredient or ingredients this brand contains.',
      fix: 'It is on the label, usually under "Active ingredient" or "Composition". If it is not in the '
        + 'catalogue, the Owner adds it first, with its group.',
      source: ref('labels/manager_adds_label'),
    };
  }
  if (unknown.length) {
    return { ok: false, reason: 'unknown-active', why: `Not in the catalogue: ${unknown.join(', ')}.` };
  }

  return {
    ok: true,
    payload: {
      id: draft.id || `lbl_${slug(brand)}`,
      brand,
      activeIds,
      formulation: draft.formulation || '',
      concentration: draft.concentration || '',
      rate: draft.rate || '',
      phiDays: draft.phiDays === '' || draft.phiDays == null ? null : Number(draft.phiDays),
      reiHours: draft.reiHours === '' || draft.reiHours == null ? null : Number(draft.reiHours),
      photo: draft.photo || null,
    },
  };
}

// --- Reading a record back -------------------------------------------------

/**
 * The legacy product table's ids, mapped onto the catalogue.
 *
 * Before the catalogue, sprays were logged against a hard-coded product list.
 * Those records are the farm's history: nothing rewrites them, so the reading
 * side has to understand both. This map is the whole of the difference.
 */
const LEGACY_PRODUCT_IDS = {
  mancozeb: 'mancozeb',
  copper_oxychloride: 'copper_oxychloride',
  metalaxyl_mancozeb: 'metalaxyl_m_mancozeb',
  sulphur: 'sulphur',
  bt: 'bacillus_thuringiensis',
  neem: 'azadirachtin_neem_oil',
  spinosad: 'spinosad',
  emamectin: 'emamectin_benzoate',
  abamectin: 'abamectin',
  acetamiprid: 'acetamiprid',
  imidacloprid: 'imidacloprid',
  lambda_cyhalothrin: 'lambda_cyhalothrin',
  cypermethrin: 'cypermethrin',
};

/** Find an active by id, legacy product id, or the name on a store item. */
function resolveActive(catalogue, reference) {
  if (!reference) return null;
  const raw = String(reference);
  if (catalogue.byId[raw]) return catalogue.byId[raw];
  const legacy = LEGACY_PRODUCT_IDS[raw];
  if (legacy && catalogue.byId[legacy]) return catalogue.byId[legacy];

  // A store item is named the way the shop names it: "Mancozeb 80% WP",
  // "Copper Oxychloride 50WP". Strip the formulation and match on the active.
  const flatten = (s) => norm(s)
    .replace(/\b\d+(\.\d+)?\s*%/g, ' ')
    .replace(/\b\d+\s*(wp|wg|sc|ec|sl|wdg|g\/l)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = flatten(raw);
  if (!text) return null;

  // Longest alias found inside the name wins: "Copper oxychloride 50WP" must
  // not settle for "copper".
  let best = null;
  for (const active of catalogue.actives) {
    for (const alias of active.aliases.map(flatten)) {
      if (!alias) continue;
      const pattern = new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
      if (pattern.test(text) && (!best || alias.length > best.alias.length)) best = { active, alias };
    }
  }
  if (best) return best.active;

  // The other direction: the rules and the field both use short forms —
  // "garlic-chilli" for "Garlic-chilli extract (farm-made)". Accepted only when
  // exactly one active answers to it, so a bare "copper" stays ambiguous and
  // resolves to nothing rather than to the wrong one.
  const partial = catalogue.actives.filter((a) => a.aliases
    .map(flatten).some((alias) => alias.startsWith(`${text} `) || alias === text));
  return partial.length === 1 ? partial[0] : null;
}

/**
 * The resistance group behind a recorded spray.
 *
 * Catalogue first. A spray from before the catalogue whose product never made
 * it in — azoxystrobin, difenoconazole — still has to count against the
 * rotation, so its group comes off the record itself. Forgetting it would let
 * the same group through twice, which is the one thing the gate exists to stop.
 */
function groupOfSpray(catalogue, spray) {
  const active = resolveActive(catalogue, spray.activeId || spray.productId || spray.productName);
  if (active) return { group: parseGroup(active.group), active, source: active.groupSource };
  if (spray.group) return { group: parseGroup(spray.group), active: null, source: 'the spray record' };
  return { group: parseGroup(null), active: null, source: null };
}

// --- Migrating the store onto actives --------------------------------------

/**
 * Plan the migration of existing stock items onto actives.
 *
 * Nothing is deleted and nothing is rewritten — the log is append-only, so the
 * migration is one `input.upsert` per item carrying the active it turned out to
 * be. Past treatments are not touched at all: they are read through
 * `resolveActive`, so the count of treatments before and after is necessarily
 * the same number, and the plan reports it so that can be checked rather than
 * believed.
 */
function planStockMigration(state, catalogue) {
  const items = Object.values(state.inputs || {});
  const rows = items.map((item) => {
    const existing = item.activeId && catalogue.byId[item.activeId] ? catalogue.byId[item.activeId] : null;
    const match = existing || resolveActive(catalogue, item.name);
    return {
      itemId: item.id,
      name: item.name,
      kind: item.kind || '',
      activeId: match ? match.id : null,
      active: match,
      group: match ? match.group : null,
      already: !!existing,
      // Fertiliser, seed and crates are not chemicals and have no active.
      // Saying so is part of the report: an unmatched *chemical* is the one
      // that needs a person.
      chemical: (item.kind || '') === 'chemical',
    };
  });

  const treatments = (state.sprays || []);
  const resolved = treatments.filter((s) => !!groupOfSpray(catalogue, s).active);

  return {
    items: rows,
    matched: rows.filter((r) => r.activeId && !r.already),
    alreadyDone: rows.filter((r) => r.already),
    unmatchedChemicals: rows.filter((r) => r.chemical && !r.activeId),
    treatmentsBefore: treatments.length,
    treatmentsAfter: treatments.length,
    treatmentsResolved: resolved.length,
    treatmentsUnresolved: treatments.length - resolved.length,
  };
}

/**
 * The events that carry out the plan.
 *
 * Each one has a fixed id, so five phones running the migration produce the
 * same five events and the merge is a no-op. Running it twice changes nothing.
 */
function migrationEvents(plan) {
  return plan.matched.map((row) => ({
    type: 'input.upsert',
    payload: { id: row.itemId, activeId: row.activeId },
    eventId: `ev_mig_active_${row.itemId}`,
  }));
}

/** Run it. Returns the plan, with what was written. */
async function migrateStockToActives(store, catalogue) {
  const plan = planStockMigration(store.state, catalogue);
  const events = migrationEvents(plan);
  if (events.length) {
    for (const e of events) await store.dispatch(e.type, e.payload, { eventId: e.eventId });
  }
  return { ...plan, written: events.length };
}
})(__dvModule("web/js/domain/catalogue.js"));
__dvBindAll();

// ─── web/js/domain/crops.js ────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "CROPS": { enumerable: true, get: () => CROPS },
  "CROP_LIST": { enumerable: true, get: () => CROP_LIST },
  "getCrop": { enumerable: true, get: () => getCrop },
  "stagesFor": { enumerable: true, get: () => stagesFor },
  "stageAt": { enumerable: true, get: () => stageAt },
  "plantsForArea": { enumerable: true, get: () => plantsForArea },
  "populationPerHa": { enumerable: true, get: () => populationPerHa },
  "fertiliserPlan": { enumerable: true, get: () => fertiliserPlan },
  "waterDemandMmPerDay": { enumerable: true, get: () => waterDemandMmPerDay },
});


// Crop profiles for the three peppers DouValue grows, tuned for open-field
// production in Port Harcourt (Rivers State, Nigeria).
//
// Timings are days after transplanting (DAT) unless the field says otherwise,
// and describe a healthy crop in the rain-fed season. They are starting points:
// the forecaster in predict.js corrects them against what a bed actually did,
// and every number here can be edited in Settings once the farm has its own
// records. Sources are ordinary extension-service ranges for Capsicum, not
// measurements from this farm.

const CROPS = {
  bell: {
    id: 'bell',
    name: 'Bell pepper',
    localName: 'Tatashe (sweet)',
    pidgin: 'Tatashe',
    species: 'Capsicum annuum',
    colour: '#e0392b',
    emoji: '🫑',
    varieties: ['California Wonder', 'Yolo Wonder', 'Nikita F1', 'Goliath F1', 'Commandant F1'],
    nurseryDays: 30,        // sowing to transplant
    germinationDays: 8,
    daysToFlower: 35,
    daysToFirstHarvest: 70, // green-mature fruit
    daysToColour: 90,       // fully coloured red/yellow fruit
    daysToPeak: 100,
    harvestWindowDays: 80,  // picking runs this long from first harvest
    cycleDays: 160,
    pickEveryDays: 7,
    spacing: { inRow: 0.5, betweenRow: 0.6 },  // metres
    yieldPerPlantKg: { low: 0.8, typical: 1.6, high: 3.0 },
    fruitPerKg: 7,
    baseTempC: 10,
    optTempC: 26,
    heatStressC: 33,
    // Bell has the thinnest cuticle and the biggest fruit: it suffers most from
    // rain-splash fruit rot and from calcium going short during fast fruit fill.
    watchFor: ['anthracnose', 'blossom_end_rot', 'bacterial_leaf_spot', 'phytophthora_blight'],
    notes: 'Hardest of the three in open field here. Shade netting or a rain shelter over the '
      + 'fruiting beds pays for itself in the peak rains. Mulch heavily and keep calcium up.',
    priceTierNgnPerKg: 1400,   // farm-gate starting point, edit in Settings
  },

  chili: {
    id: 'chili',
    name: 'Chili (cayenne)',
    localName: 'Shombo',
    pidgin: 'Shombo',
    species: 'Capsicum annuum',
    colour: '#c62828',
    emoji: '🌶️',
    varieties: ['Shombo local', 'Cayenne Long Slim', 'Legon 18', 'Bird pepper (Ata wewe)'],
    nurseryDays: 28,
    germinationDays: 7,
    daysToFlower: 40,
    daysToFirstHarvest: 75,
    daysToColour: 95,
    daysToPeak: 105,
    harvestWindowDays: 100,
    cycleDays: 190,
    pickEveryDays: 7,
    spacing: { inRow: 0.4, betweenRow: 0.6 },
    yieldPerPlantKg: { low: 0.5, typical: 1.1, high: 2.0 },
    fruitPerKg: 110,
    baseTempC: 10,
    optTempC: 27,
    heatStressC: 34,
    watchFor: ['anthracnose', 'thrips', 'pvmv', 'fruit_borer'],
    notes: 'The steady earner. Long picking window, dries well, so a glut can be dried and held '
      + 'for the scarcity months instead of being dumped on the market fresh.',
    priceTierNgnPerKg: 1800,
  },

  habanero: {
    id: 'habanero',
    name: 'Habanero',
    localName: 'Ata rodo',
    pidgin: 'Rodo',
    species: 'Capsicum chinense',
    colour: '#f57c00',
    emoji: '🔥',
    varieties: ['Ata rodo local', 'Scotch Bonnet', 'Habanero Yellow', 'Nabuki F1'],
    nurseryDays: 35,        // C. chinense is slow off the mark
    germinationDays: 14,
    daysToFlower: 50,
    daysToFirstHarvest: 95,
    daysToColour: 115,
    daysToPeak: 130,
    harvestWindowDays: 140, // keeps going for months if kept healthy
    cycleDays: 260,
    pickEveryDays: 10,
    spacing: { inRow: 0.5, betweenRow: 0.7 },
    yieldPerPlantKg: { low: 0.6, typical: 1.4, high: 2.8 },
    fruitPerKg: 90,
    baseTempC: 12,
    optTempC: 27,
    heatStressC: 35,
    watchFor: ['bacterial_wilt', 'root_knot_nematode', 'phytophthora_blight', 'whitefly'],
    notes: 'Slow to start, longest to pay, then pays the most. Worth ratooning a healthy bed after '
      + 'the first flush instead of replanting: cut back, feed, and it flowers again in 6-8 weeks.',
    priceTierNgnPerKg: 2600,
  },
};

const CROP_LIST = Object.values(CROPS);

function getCrop(id) { return CROPS[id] || CROPS.chili; }

/** Growth stages in order, each with the DAT it begins. */
function stagesFor(cropId) {
  const c = getCrop(cropId);
  return [
    { id: 'nursery', name: 'Nursery', pidgin: 'Nursery', from: -c.nurseryDays,
      job: 'Seedlings in trays or beds. Shade, water twice daily, watch for damping-off.' },
    { id: 'establish', name: 'Establishment', pidgin: 'Small small', from: 0,
      job: 'First 3 weeks after transplant. Keep moist, shade in hot sun, gap up the dead ones.' },
    { id: 'vegetative', name: 'Vegetative', pidgin: 'E dey grow', from: 21,
      job: 'Plant is building leaves. Nitrogen now, first weeding, stake the tall ones.' },
    { id: 'flowering', name: 'Flowering', pidgin: 'E don flower', from: c.daysToFlower,
      job: 'Flowers open. Do not let it go dry. Calcium and potassium now, watch thrips.' },
    { id: 'fruiting', name: 'Fruit set', pidgin: 'E don born', from: c.daysToFlower + 14,
      job: 'Fruit swelling. Steady water, potassium, protect fruit from rot.' },
    { id: 'harvest', name: 'Harvesting', pidgin: 'Picking time', from: c.daysToFirstHarvest,
      job: `Pick every ${c.pickEveryDays} days. Feed after every 2 pickings. Mind spray waiting days.` },
    { id: 'decline', name: 'Tail end', pidgin: 'E dey finish', from: c.daysToFirstHarvest + c.harvestWindowDays,
      job: 'Yield falling. Decide: ratoon the healthy beds, or clear and replant.' },
    { id: 'closed', name: 'Closed', pidgin: 'Don finish', from: c.cycleDays,
      job: 'Cycle over. Clear trash off the field, do not leave old pepper stalks as a disease bridge.' },
  ];
}

/** Which stage a cycle is in at a given number of days after transplant. */
function stageAt(cropId, dat) {
  const stages = stagesFor(cropId);
  let current = stages[0];
  for (const s of stages) if (dat >= s.from) current = s;
  return current;
}

/** Plants a bed of this many square metres holds at the crop's spacing. */
function plantsForArea(cropId, areaM2) {
  const c = getCrop(cropId);
  const perPlant = c.spacing.inRow * c.spacing.betweenRow;
  return Math.max(0, Math.round((Number(areaM2) || 0) / perPlant));
}

/** Population per hectare at the crop's spacing. */
function populationPerHa(cropId) { return plantsForArea(cropId, 10000); }

/**
 * Fertiliser plan per crop cycle, split the way a smallholder here actually
 * applies it: basal at transplant, then side-dressings. Rates are per hectare;
 * the caller scales by bed area.
 */
function fertiliserPlan(cropId) {
  const c = getCrop(cropId);
  return [
    { dat: -7, name: 'Land prep', product: 'Poultry manure (well rotted)', rateKgHa: 8000,
      why: 'Builds the sandy Niger Delta soil and holds water. Must be old manure, not fresh.' },
    { dat: -7, name: 'Land prep', product: 'Agricultural lime', rateKgHa: 1000, conditional: 'soilPhBelow5.5',
      why: 'Soils here run acid (pH 4.5-5.5). Lime unlocks the phosphorus and calcium you paid for.' },
    { dat: 0, name: 'Basal', product: 'NPK 15-15-15', rateKgHa: 250,
      why: 'Starter for roots and early leaves. Place beside the plant, not touching the stem.' },
    { dat: 21, name: 'First side-dress', product: 'Urea 46-0-0', rateKgHa: 100,
      why: 'Pushes the vegetative frame before flowering.' },
    { dat: c.daysToFlower, name: 'Flowering feed', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 250,
      why: 'Potassium and magnesium for fruit set and fruit weight.' },
    { dat: c.daysToFlower + 7, name: 'Calcium spray', product: 'Calcium nitrate foliar', rateKgHa: 15,
      why: 'Blossom-end rot insurance while fruit is filling fast.' },
    { dat: c.daysToFirstHarvest, name: 'Harvest feed', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 200,
      why: 'Every crate you pick takes potassium off the field. Replace it or the next flush is small.' },
    { dat: c.daysToFirstHarvest + 30, name: 'Harvest feed 2', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 200,
      why: 'Keeps the picking window long instead of one big flush and done.' },
  ];
}

/** Water demand in mm/day by stage — what irrigation has to make up in the dry months. */
function waterDemandMmPerDay(cropId, dat) {
  const stage = stageAt(cropId, dat).id;
  const table = { nursery: 2, establish: 3, vegetative: 4, flowering: 5.5,
    fruiting: 6, harvest: 5.5, decline: 4, closed: 0 };
  return table[stage] ?? 4;
}
})(__dvModule("web/js/domain/crops.js"));
__dvBindAll();

// ─── web/js/domain/farm.js ─────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "ZONE_TYPES": { enumerable: true, get: () => ZONE_TYPES },
  "appTypeOf": { enumerable: true, get: () => appTypeOf },
  "zoneTypeLabel": { enumerable: true, get: () => zoneTypeLabel },
  "isNursery": { enumerable: true, get: () => isNursery },
  "zoneIdFor": { enumerable: true, get: () => zoneIdFor },
  "rulesZoneFor": { enumerable: true, get: () => rulesZoneFor },
  "protocolOf": { enumerable: true, get: () => protocolOf },
  "realZones": { enumerable: true, get: () => realZones },
  "newFarmEvents": { enumerable: true, get: () => newFarmEvents },
});


// The farm's zones — requirements 6.1, FR-FARM-01.
//
// The zone register lives in the rules file (rules/douvalue_rules_rev5_1.json →
// zones), because the Rev 5.1 block register is what the schedule, the gates
// and the clean-restart protocol are all written against. A new farm starts
// from that register rather than from an empty list, so GH-04 is GH-04 from
// the first morning and OF-02 is the nursery from the first morning.
//
// The sample farm is deliberately not built from this. It is a teaching farm
// with its own beds (UX-25), and it stays exactly as it was.

/**
 * The zone types the app knows.
 *
 * The rules file has four (`greenhouse`, `open_field`, `open_field_ridge`,
 * `nursery`); the app has always stored open field as `field`, and pest
 * thresholds are read on that (alerts.js). So a ridge block is a field for
 * thresholds, and keeps its rules type beside it for spacing and display.
 */
const ZONE_TYPES = {
  greenhouse: { id: 'greenhouse', label: 'Greenhouse' },
  field: { id: 'field', label: 'Open field' },
  nursery: { id: 'nursery', label: 'Nursery' },
};

const APP_TYPE = {
  greenhouse: 'greenhouse',
  open_field: 'field',
  open_field_ridge: 'field',
  nursery: 'nursery',
};

function appTypeOf(rulesType) {
  return APP_TYPE[rulesType] || 'greenhouse';
}

function zoneTypeLabel(zone) {
  if (!zone) return '';
  if (zone.rulesType === 'open_field_ridge') return 'Open field, ridges';
  return (ZONE_TYPES[zone.type] || ZONE_TYPES.greenhouse).label;
}

/** FR-FARM-04: the nursery raises seedlings; it is not a cropping block. */
const isNursery = (zone) => !!zone && zone.type === 'nursery';

/** A stable id per register entry, so two phones setting up the farm agree. */
const zoneIdFor = (code) => `zone_${String(code).toLowerCase()}`;

/** The rules' own entry for a zone, matched on its register code or its name. */
function rulesZoneFor(zone, rules) {
  if (!zone || !rules || !Array.isArray(rules.zones)) return null;
  const code = String(zone.code || zone.name || '').trim().toUpperCase();
  return rules.zones.find((z) => z.id.toUpperCase() === code) || null;
}

/** GH-04 and GH-05 carry the clean-restart protocol (rules → zones[].protocol). */
function protocolOf(zone, rules) {
  if (!zone) return null;
  if (zone.protocol) return zone.protocol;
  const entry = rulesZoneFor(zone, rules);
  return (entry && entry.protocol) || null;
}

/**
 * FR-FARM-01 — the real zones, as plot records, straight from the register.
 *
 * Area is left at 0: the register does not carry it, and a guessed area would
 * put a wrong trap count on Gate 1. The Farm Manager fills it in.
 */
function realZones(rules) {
  if (!rules || !Array.isArray(rules.zones)) {
    throw new Error('The zone register comes from the rules file, and the rules are not loaded');
  }
  return rules.zones.map((z) => ({
    id: zoneIdFor(z.id),
    code: z.id,
    name: z.id,
    type: appTypeOf(z.type),
    rulesType: z.type,
    crop: z.crop || '',
    spacingCm: z.spacing_cm ?? null,
    protocol: z.protocol || null,
    note: z.note || '',
    areaM2: 0,
    drainage: z.type === 'open_field_ridge' ? 'ridged' : 'raised',
  }));
}

/** The records a brand-new farm starts with: its name, its Owner, its zones. */
function newFarmEvents({ farmName, owner, rules }) {
  return [
    { type: 'settings.update', payload: { farmName: farmName || 'DouValue Farms Limited' } },
    { type: 'person.upsert', payload: { ...owner, role: 'ceo' } },
    // No rules, no register: better no zones than guessed ones.
    ...(rules ? realZones(rules) : []).map((payload) => ({ type: 'plot.upsert', payload })),
  ];
}
})(__dvModule("web/js/domain/farm.js"));
__dvBindAll();

// ─── web/js/domain/nursery.js ──────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "CLEAN_MEDIA": { enumerable: true, get: () => CLEAN_MEDIA },
  "nurseryRules": { enumerable: true, get: () => nurseryRules },
  "hardenDays": { enumerable: true, get: () => hardenDays },
  "releaseLabels": { enumerable: true, get: () => releaseLabels },
  "hygieneRules": { enumerable: true, get: () => hygieneRules },
  "batchList": { enumerable: true, get: () => batchList },
  "growingIn": { enumerable: true, get: () => growingIn },
  "releaseCheck": { enumerable: true, get: () => releaseCheck },
  "releasedFor": { enumerable: true, get: () => releasedFor },
  "SEEDLING_CHECK_DAYS": { enumerable: true, get: () => SEEDLING_CHECK_DAYS },
  "NURSERY_OPERATIONS": { enumerable: true, get: () => NURSERY_OPERATIONS },
  "nurseryTasks": { enumerable: true, get: () => nurseryTasks },
});
let addDays, daysBetween, isoDate;
let isNursery;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/domain/farm.js", (m) => { isNursery = m.isNursery; });
// The nursery and its seedling batches — FR-FARM-04, FR-FARM-05, Build Rules §11e.
//
// "Seedlings carry thrips, tospovirus and damping-off into every block; the
// nursery is the first green bridge." So the nursery gets its own work (a daily
// trap count, a twice-weekly seedling check), its own hygiene rules, and a
// release check that every batch passes before it may leave for a block.
//
// Gate 1 reads the release from here: a block cannot log transplant without a
// batch that passed the check and was released to that block (rules →
// nursery.gate_link). The release is judged from the batch's own record every
// time the log is replayed, so a phone that skipped the form cannot sync a
// release that did not pass.




/**
 * The five lines of the release check, in the rules' order, plus the first
 * hygiene rule (clean media), which is a condition of the batch existing
 * safely at all. Labels are read from the rules where the rules have them.
 */
const RELEASE_IDS = ['hardened', 'no_virus', 'no_thrips', 'no_damping_off', 'block_recorded'];

const CLEAN_MEDIA = [
  { value: 'sterilised', label: 'Sterilised' },
  { value: 'solarised', label: 'Solarised' },
  { value: 'bought-in', label: 'Bought-in' },
];

function nurseryRules(rules) {
  return (rules && rules.nursery) || null;
}

/** "hardened 7+ days" → 7. Falls back to 7 if the wording ever changes. */
function hardenDays(rules) {
  const first = ((nurseryRules(rules) || {}).seedling_release_check || [])[0] || '';
  const m = /(\d+)\s*\+?\s*days?/i.exec(first);
  return m ? Number(m[1]) : 7;
}

function releaseLabels(rules) {
  const list = (nurseryRules(rules) || {}).seedling_release_check || [];
  return RELEASE_IDS.map((id, i) => ({ id, label: list[i] || id.replace(/_/g, ' ') }));
}

/** The hygiene rules, as the rules file words them (§11e). */
function hygieneRules(rules) {
  return ((nurseryRules(rules) || {}).rules || []).slice();
}

const batchList = (state) => Object.values((state && state.seedlingBatches) || {});

/** Batches still growing in one nursery zone (not released, not discarded). */
function growingIn(state, nurseryZoneId) {
  return batchList(state)
    .filter((b) => b.nurseryZoneId === nurseryZoneId && b.status === 'growing')
    .sort((a, b) => ((a.sownDate || '') < (b.sownDate || '') ? -1 : 1));
}

function latestCheck(batch, date) {
  return [...(batch.checks || [])]
    .filter((c) => !date || (c.date || '') <= date)
    .sort((a, b) => ((a.date || a.at || '') < (b.date || b.at || '') ? 1 : -1))[0] || null;
}

/**
 * FR-FARM-05 — the release check for one batch going to one block.
 *
 * Pure. `answers` are what the person doing the check saw today
 * ({ noVirus, noThrips, noDampingOff }, each true only if they looked and
 * found none). The batch's own record decides hardening and media; its latest
 * twice-weekly check can still fail a line the person ticked, because a
 * seedling check that found virus two days ago is not undone by a tick box.
 */
function releaseCheck(state, batch, { date = isoDate(), zoneId = null, answers = {}, rules = null } = {}) {
  const labels = Object.fromEntries(releaseLabels(rules).map((l) => [l.id, l.label]));
  const items = [];
  const add = (id, label, ok, why, fix = '') => items.push({ id, label, state: ok ? 'have' : 'missing', why, fix });

  if (!batch) {
    return { ok: false, items: [], failing: [{ id: 'batch', why: 'There is no such seedling batch.' }], why: 'There is no such seedling batch.' };
  }

  const status = batch.status || 'growing';
  if (status !== 'growing') {
    const why = status === 'released'
      ? `Batch ${batch.label || batch.id} was already released on ${(batch.release || {}).date || 'an earlier day'}.`
      : `Batch ${batch.label || batch.id} was discarded.`;
    return { ok: false, items: [], failing: [{ id: 'status', why }], why };
  }

  // Hygiene rule 1: never raw soil from a cropping block.
  const cleanMedia = CLEAN_MEDIA.some((m) => m.value === batch.media);
  add('clean_media', 'nursery media clean: sterilised, solarised or bought-in', cleanMedia,
    cleanMedia ? `Raised in ${batch.media} media.` : `Media recorded as "${batch.media || 'not recorded'}".`,
    'Seedlings raised in raw soil from a cropping block carry that block\'s problems. Re-raise the batch in clean media.');

  const need = hardenDays(rules);
  const hardenedFor = batch.hardenedFrom ? daysBetween(batch.hardenedFrom, date) : null;
  add('hardened', labels.hardened, hardenedFor != null && hardenedFor >= need,
    hardenedFor == null ? 'Hardening has not been recorded for this batch.'
      : `Hardening since ${batch.hardenedFrom}: ${hardenedFor} day${hardenedFor === 1 ? '' : 's'}.`,
    hardenedFor == null ? 'Record the day hardening started.'
      : `Hardening needs ${need} days. Earliest release ${isoDate(addDays(batch.hardenedFrom, need))}.`);

  const last = latestCheck(batch, date);
  const seen = (key, answer, found, label, fix) => {
    const failedBefore = last && last[found];
    const ok = answer === true && !failedBefore;
    add(key, label, ok,
      failedBefore ? `The seedling check on ${last.date} found ${found === 'dampingOff' ? 'damping-off' : found}.`
        : answer === true ? 'Checked today: none found.' : 'Not confirmed today.',
      fix);
  };
  seen('no_virus', answers.noVirus, 'virus', labels.no_virus,
    'Look for ring/line patterns and mottling. A batch with virus does not leave; rogue and bag the affected trays.');
  seen('no_thrips', answers.noThrips, 'thrips', labels.no_thrips,
    'Tap tips over white paper. Thrips on the batch means treat and re-check before release.');
  seen('no_damping_off', answers.noDampingOff, 'dampingOff', labels.no_damping_off,
    'Any collapsed seedlings in the batch means it does not leave yet.');

  const target = zoneId ? ((state && state.plots) || {})[zoneId] : null;
  const blockOk = !!target && !isNursery(target) && !target.retired;
  add('block_recorded', labels.block_recorded, blockOk,
    !zoneId ? 'No block named.'
      : !target ? 'The block named is not on record.'
        : isNursery(target) ? `${target.name} is the nursery, not a block.`
          : target.retired ? `${target.name} is retired.`
            : `Going to ${target.name}.`,
    'Name the block the batch goes to. That link is what Gate 1 reads.');

  const failing = items.filter((i) => i.state !== 'have');
  return {
    ok: failing.length === 0,
    items,
    failing,
    why: failing.length ? `Release check not passed: ${failing.map((f) => f.label).join('; ')}.` : null,
  };
}

/**
 * Gate 1's question: is there a released batch for this block?
 *
 * The batch must have been released to this block, on or before the day being
 * judged and after the previous cycle there ended, and not already planted
 * into another cycle. `batchId` asks about one batch in particular.
 */
function releasedFor(state, zoneId, { asOf = isoDate(), since = null, batchId = null, cycleId = null } = {}) {
  const fits = (b) => b.status === 'released' && b.release && b.release.zoneId === zoneId
    && (b.release.date || '') <= asOf
    && (!since || (b.release.date || '') > since)
    && (!b.usedByCycleId || b.usedByCycleId === cycleId);

  if (batchId) {
    const b = ((state && state.seedlingBatches) || {})[batchId];
    if (!b) return { batch: null, why: 'That seedling batch is not on record.' };
    if (!fits(b)) {
      return {
        batch: null,
        why: b.status !== 'released' ? `Batch ${b.label || b.id} has not passed the release check.`
          : b.release.zoneId !== zoneId ? `Batch ${b.label || b.id} was released to a different block.`
            : b.usedByCycleId ? `Batch ${b.label || b.id} is already planted.`
              : `Batch ${b.label || b.id} was released outside the window for this planting.`,
      };
    }
    return { batch: b, why: '' };
  }

  const batch = batchList(state).filter(fits)
    .sort((a, b) => ((a.release.date || '') < (b.release.date || '') ? 1 : -1))[0] || null;
  return { batch, why: batch ? '' : 'No seedling batch has been released to this block.' };
}

// --- The nursery's own work (FR-FARM-04) -----------------------------------

/**
 * Daily trap count and a twice-weekly seedling check (rules → nursery.rules).
 *
 * The rules say "twice-weekly" without naming days; Monday and Thursday keep
 * the two checks evenly apart. Nursery work is due at 07:00, before anything
 * in the blocks, because the hygiene rule is "nursery first, cropping blocks
 * after".
 */
const SEEDLING_CHECK_DAYS = [1, 4];

const NURSERY_OPERATIONS = [
  {
    kind: 'nursery_trap',
    title: 'Nursery trap count',
    due: 7,
    proof: true,
    how: [
      'Come to the nursery first, before any cropping block — never from a block back in without washing hands and changing over-clothes.',
      'Photograph each trap, count the thrips and whitefly and record it.',
      'Check nothing within 5 m: no crop debris, culls or volunteer peppers.',
    ],
    why: 'The nursery is the first green bridge. A thrips build-up here goes out to every block with the seedlings.',
  },
  {
    kind: 'seedling_check',
    title: 'Seedling check',
    due: 7,
    proof: true,
    how: [
      'Tap tips over white paper for thrips.',
      'Look for ring/line patterns and mottling (virus).',
      'Look for collapsed seedlings pinched at the base (damping-off).',
      'Record what you found for each batch, with a photo.',
    ],
    why: 'A batch only leaves once it passes the release check, and this is how you know before release day.',
  },
];

function nurseryTasks(state, { date = isoDate(), taskIdFor, positionOfZone = new Map() } = {}) {
  const out = [];
  const weekday = new Date(`${date}T12:00:00`).getDay();
  for (const zone of Object.values((state && state.plots) || {})) {
    if (!isNursery(zone) || zone.retired) continue;
    const ops = [NURSERY_OPERATIONS[0]];
    if (SEEDLING_CHECK_DAYS.includes(weekday) && growingIn(state, zone.id).length) ops.push(NURSERY_OPERATIONS[1]);
    for (const op of ops) {
      out.push({
        id: taskIdFor(date, zone.id, op.kind),
        kind: op.kind,
        title: `${op.title} — ${zone.name}`,
        zoneId: zone.id,
        cycleId: null,
        positionId: positionOfZone.get(zone.id) || null,
        due: `${date}T${String(op.due).padStart(2, '0')}:00`,
        generated: true,
        proof: !!op.proof,
        how: op.how,
        why: op.why,
      });
    }
  }
  return out;
}
})(__dvModule("web/js/domain/nursery.js"));
__dvBindAll();

// ─── web/js/domain/schedule.js ─────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "OPERATIONS": { enumerable: true, get: () => OPERATIONS },
  "taskIdFor": { enumerable: true, get: () => taskIdFor },
  "tasksFor": { enumerable: true, get: () => tasksFor },
  "missingTasks": { enumerable: true, get: () => missingTasks },
  "overdue": { enumerable: true, get: () => overdue },
  "dayProgress": { enumerable: true, get: () => dayProgress },
  "howTo": { enumerable: true, get: () => howTo },
});
let addDays, daysBetween, isoDate;
let stageAt, waterDemandMmPerDay;
let NURSERY_OPERATIONS, nurseryTasks;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/domain/crops.js", (m) => { stageAt = m.stageAt; }, (m) => { waterDemandMmPerDay = m.waterDemandMmPerDay; });
__dvImport("web/js/domain/nursery.js", (m) => { NURSERY_OPERATIONS = m.NURSERY_OPERATIONS; }, (m) => { nurseryTasks = m.nurseryTasks; });
// The daily work, generated from the operations schedule — requirements 6.3.
//
// FR-TASK-01 asks for the day's tasks to appear per zone without anybody
// writing them out: scouting, trap checks, irrigation, fertigation, pruning,
// harvest, sanitation. The point is not convenience. It is that a round nobody
// scheduled is a round nobody misses, and the gap Season 1 fell into was
// exactly that shape — the scouting that would have caught the thrips was
// somebody's intention rather than somebody's list.
//
// GENERATION IS IDEMPOTENT
//
// Every generated task has a deterministic id built from the date, the zone and
// the kind. Five phones opening the app on Tuesday morning all generate the
// same Tuesday, and because IndexedDB keys events by id and the sync merge is a
// set union, it lands exactly once. No coordination, no leader, no duplicates —
// which matters when the phones are offline from each other for days.
//
// AWAITING Rev 5: the real cadence lives in the Farm Operations Schedule, which
// I have not seen. What follows is a defensible schedule for capsicum under
// cover in Port Harcourt, keyed to crop stage, and every line of it is a
// setting the Farm Manager can change without a release.





/**
 * The schedule.
 *
 * `every` is in days. `from`/`to` are days after transplant, so the work
 * follows the crop rather than the calendar — pruning a seedling and scouting a
 * finished bed are both wasted mornings.
 *
 * `fromStage` holds a list, because picking does not stop when the stage label
 * changes — it runs through `harvest` and on into `decline` until the bed is
 * cleared.
 *
 * `due` is the hour it should be done by. Scouting is early on purpose: thrips
 * and whitefly are countable in the cool of the morning and invisible by noon,
 * and a round done at four in the afternoon is a round that finds nothing.
 */
const OPERATIONS = [
  {
    kind: 'scout',
    title: 'Scout and count',
    every: 3,
    due: 9,
    from: 7,
    proof: true,
    how: [
      'Walk a diagonal across the zone, stopping at ten plants.',
      'Look at the underside of the young leaves, the growing tip, the flowers and the fruit.',
      'Count what you find on the ten and put the average in the app.',
      'Photograph anything you are not sure about.',
    ],
    why: 'This is the round that catches a pest while it is still cheap. Ten plants looked at '
      + 'properly beats fifty glanced at.',
  },
  {
    kind: 'trap',
    title: 'Check the sticky traps',
    every: 7,
    due: 10,
    from: 0,
    proof: true,
    how: [
      'Photograph each trap before you touch it.',
      'Count the thrips and whitefly on one card and record it.',
      'Replace any trap that is full or more than three weeks old.',
    ],
    why: 'The trap count is the number the thresholds are set against, so it is the number that '
      + 'decides whether a spray happens.',
  },
  {
    kind: 'irrigate',
    title: 'Water',
    every: 1,
    due: 8,
    from: 0,
    how: [
      'Water at the base, early, never over the leaves.',
      'Check every dripper on the line is running before you leave.',
    ],
    why: 'Pepper drops its flowers within days of water stress, and wet leaves in this humidity '
      + 'are how anthracnose starts.',
  },
  {
    kind: 'fertigate',
    title: 'Feed',
    every: 7,
    due: 9,
    from: 14,
    how: [
      'Mix to the rate on the plan for this stage.',
      'Run clean water through the line afterwards so it does not block.',
    ],
    why: 'Fruit fill is where the yield is decided, and it is where calcium and potassium run short.',
  },
  {
    kind: 'prune',
    title: 'Prune and tie',
    every: 14,
    due: 11,
    from: 28,
    to: 120,
    how: [
      'Take off the leaves below the first fork and anything touching the ground.',
      'Tie the new growth up before it bends.',
      'Wash your hands between zones.',
    ],
    why: 'Air moving through the plant is the cheapest disease control there is. Hands moving '
      + 'between zones is the fastest way to spread a virus.',
  },
  {
    kind: 'harvest',
    title: 'Pick',
    every: 3,
    due: 8,
    fromStage: ['harvest', 'decline'],
    how: [
      'Pick into the crate, not the ground.',
      'Anything spotted or soft goes in a separate crate and is recorded as a reject.',
      'Weigh at the zone and enter it at the zone.',
    ],
    why: 'Ripe fruit left on the plant tells it to stop setting more. Picking late costs the fruit '
      + 'you can see and the fruit you would have had.',
  },
  {
    kind: 'sanitation',
    title: 'Clean down',
    every: 7,
    due: 16,
    from: 0,
    proof: true,
    how: [
      'Clear fallen leaves and fruit out of the zone and off the farm — not onto the path.',
      'Disinfect the footbath at the door.',
      'Wipe down tools before they go back.',
    ],
    why: 'Fallen fruit under the bench is where anthracnose overwinters and where fruit fly breeds.',
  },
];

/** A stable id, so the same day generated twice is the same task. */
const taskIdFor = (date, zoneId, kind) => `gen_${date}_${zoneId}_${kind}`;

/** Is this operation due on this date for this cycle? */
function dueOn(op, cycle, date, cropId) {
  const dat = daysBetween(cycle.transplantDate, date);
  if (dat < 0) return false;
  if (op.from != null && dat < op.from) return false;
  if (op.to != null && dat > op.to) return false;
  if (op.fromStage) {
    const wanted = Array.isArray(op.fromStage) ? op.fromStage : [op.fromStage];
    const stage = stageAt(cropId, dat);
    if (!stage || !wanted.includes(stage.id)) return false;
  }
  // Counted from transplant so the rhythm is the crop's, not the calendar's —
  // and so two zones planted a week apart do not both fall on Monday.
  const offset = op.from != null ? op.from : 0;
  return (dat - offset) % op.every === 0;
}

/**
 * The work due on one day, for every zone with something growing in it.
 *
 * Pure: same farm, same date, same list. That is what lets every phone generate
 * it independently and agree.
 */
function tasksFor(state, { date = isoDate(), operations = null } = {}) {
  const schedule = operations || (state.settings && state.settings.operations) || OPERATIONS;
  const out = [];

  // Which position owns each zone. Built once rather than searched per task.
  const positionOfZone = new Map();
  for (const pos of Object.values(state.positions || {})) {
    if (!pos.retired && pos.primaryZoneId) positionOfZone.set(pos.primaryZoneId, pos.id);
  }

  for (const cycle of Object.values(state.cycles || {})) {
    if (cycle.status !== 'active') continue;
    const zone = (state.plots || {})[cycle.plotId];
    if (!zone || zone.retired) continue;

    for (const op of schedule) {
      if (!dueOn(op, cycle, date, cycle.cropId)) continue;
      out.push({
        id: taskIdFor(date, zone.id, op.kind),
        kind: op.kind,
        title: `${op.title} — ${zone.name}`,
        zoneId: zone.id,
        cycleId: cycle.id,
        // FR-TASK-02: an owner position, not a person. Who is actually doing it
        // today is resolved at read time, so absence reassigns without anybody
        // editing a task.
        positionId: positionOfZone.get(zone.id) || null,
        due: `${date}T${String(op.due).padStart(2, '0')}:00`,
        generated: true,
        proof: !!op.proof,
        how: op.how,
        why: op.why,
      });
    }
  }

  // FR-FARM-04: the nursery has no crop cycle, but it has daily work of its
  // own — and it comes first in the day, because staff go nursery first.
  out.push(...nurseryTasks(state, { date, taskIdFor, positionOfZone }));

  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/**
 * Which of today's tasks are not on the log yet.
 *
 * The caller files these. Anything already there is left alone, so a task
 * somebody has already done is never resurrected as open.
 */
function missingTasks(state, { date = isoDate(), operations = null } = {}) {
  const existing = state.tasks || {};
  return tasksFor(state, { date, operations }).filter((t) => !existing[t.id]);
}

/**
 * FR-TASK-03 — what is overdue, and whose list it moves to.
 *
 * Overdue work does not merely turn red where it is. It moves to the Field
 * Supervisor, because the person who missed it is by definition not looking at
 * their list.
 */
function overdue(state, { now = new Date(), date = isoDate() } = {}) {
  return Object.values(state.tasks || {})
    .filter((t) => t.status === 'open' && t.due)
    .filter((t) => new Date(t.due) < now)
    .map((t) => ({
      ...t,
      hoursLate: Math.round(((now - new Date(t.due)) / 3600000) * 10) / 10,
      // Anything still open at the end of the day is the Supervisor's.
      escalated: t.due.slice(0, 10) < date,
    }))
    .sort((a, b) => b.hoursLate - a.hoursLate);
}

/** How the day is going, for the progress bar on a hand's home screen (UX-24). */
function dayProgress(state, { date = isoDate(), personId = null } = {}) {
  let mine = Object.values(state.tasks || {})
    .filter((t) => (t.due || '').slice(0, 10) === date);
  if (personId) {
    mine = mine.filter((t) => t.assignedTo === personId || t.doneBy === personId || !t.assignedTo);
  }
  const done = mine.filter((t) => t.status === 'done').length;
  return {
    total: mine.length,
    done,
    fraction: mine.length ? done / mine.length : 0,
    text: mine.length ? `${done} of ${mine.length} done` : 'Nothing scheduled today',
  };
}

/** The steps for a task kind, for the numbered card on the worker's screen (UX-19). */
function howTo(kind, operations = OPERATIONS) {
  const op = operations.find((o) => o.kind === kind) || NURSERY_OPERATIONS.find((o) => o.kind === kind);
  return op ? { title: op.title, how: op.how, why: op.why, proof: !!op.proof } : null;
}
})(__dvModule("web/js/domain/schedule.js"));
__dvBindAll();

// ─── web/js/domain/onboarding.js ───────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "HISTORY_WINDOW_DAYS": { enumerable: true, get: () => HISTORY_WINDOW_DAYS },
  "PRE_GATES": { enumerable: true, get: () => PRE_GATES },
  "PRE_GATES_LABEL": { enumerable: true, get: () => PRE_GATES_LABEL },
  "BACKFILL_KINDS": { enumerable: true, get: () => BACKFILL_KINDS },
  "DECLARATIONS": { enumerable: true, get: () => DECLARATIONS },
  "isOnboarded": { enumerable: true, get: () => isOnboarded },
  "backfills": { enumerable: true, get: () => backfills },
  "systemOf": { enumerable: true, get: () => systemOf },
  "backfilledSprays": { enumerable: true, get: () => backfilledSprays },
  "sprayHistory": { enumerable: true, get: () => sprayHistory },
  "sprayHistoryStatus": { enumerable: true, get: () => sprayHistoryStatus },
  "treatmentHistoryBlock": { enumerable: true, get: () => treatmentHistoryBlock },
  "harvestCheck": { enumerable: true, get: () => harvestCheck },
  "reentryCheck": { enumerable: true, get: () => reentryCheck },
  "harvestToDate": { enumerable: true, get: () => harvestToDate },
  "preGatesEvidence": { enumerable: true, get: () => preGatesEvidence },
  "plantedBeforeGates": { enumerable: true, get: () => plantedBeforeGates },
  "cropDay": { enumerable: true, get: () => cropDay },
  "scheduleFrom": { enumerable: true, get: () => scheduleFrom },
  "setupStatus": { enumerable: true, get: () => setupStatus },
});
let addDays, daysBetween, isoDate;
let peekRules;
let buildCatalogue, parseGroup, resolveActive, sprayIntervals;
let harvestClearance, reentryClearance;
let tasksFor;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/rules.js", (m) => { peekRules = m.peekRules; });
__dvImport("web/js/domain/catalogue.js", (m) => { buildCatalogue = m.buildCatalogue; }, (m) => { parseGroup = m.parseGroup; }, (m) => { resolveActive = m.resolveActive; }, (m) => { sprayIntervals = m.sprayIntervals; });
__dvImport("web/js/domain/safety.js", (m) => { harvestClearance = m.harvestClearance; }, (m) => { reentryClearance = m.reentryClearance; });
__dvImport("web/js/domain/schedule.js", (m) => { tasksFor = m.tasksFor; });
// Mid-season onboarding — FR-ONB-01 to FR-ONB-08.
//
// The farm does not start using the app on a bare field. On the day it goes
// live, GH-01 is in Week 6, GH-03 is being picked, and somebody sprayed
// spinosad on Tuesday. The app has to start from there, not from transplant,
// and it has to start from there without pretending it knows things it does
// not.
//
// Two kinds of record come out of that day, and the whole of this file is about
// keeping them apart:
//
//   * The crop cycle itself (cycle.onboard): media, crop, variety and the
//     transplant date. Everything that counts in weeks — the current week, the
//     Week 10 organics rule, the task schedule — derives from that date, so a
//     crop onboarded in Week 6 is in Week 6 from the first minute.
//
//   * Backfilled entries (backfill.record): the last insecticide and the last
//     fungicide with their group and date, every spray in the last 21 days,
//     the harvest to date, the stock on hand, and any gate evidence that
//     exists. Each one is marked backfilled and kept apart from the live
//     records. A backfilled spray is not a treatment the app gated, so it is
//     never counted as one (G3, KPI-03, the follow-up board); but it is a real
//     chemical on real fruit, so the rotation gate and the PHI harvest block
//     read it exactly as they read a live spray.
//
// And one rule stops the gap between the two from being silently waved
// through (gates.js rule 2: unknown is not pass). A zone onboarded without its
// spray history has an unknown last group and an unknown waiting period. The
// rotation cannot be judged and neither can the PHI, so treatments and harvest
// there are blocked, with a message that says the history is missing, until it
// is entered.







/** FR-ONB-03: how far back "any spray in the last N days" reaches. */
const HISTORY_WINDOW_DAYS = 21;

/** The status a zone planted before the app existed gets on the Gates screen. */
const PRE_GATES = 'pre-gates';
const PRE_GATES_LABEL = 'Planted before the gates';

/** What a backfilled entry can be. */
const BACKFILL_KINDS = ['spray', 'harvest', 'stock', 'evidence', 'declare'];

/**
 * The statements a person can make on the setup screen when the honest answer
 * is "none". Recording "no fungicide this cycle" is a fact; leaving the field
 * blank is not, and the two must not look the same to a gate.
 */
const DECLARATIONS = {
  'no-insecticide': 'No insecticide has gone on this crop',
  'no-fungicide': 'No fungicide has gone on this crop',
  'recent-complete': `Every spray in the last ${HISTORY_WINDOW_DAYS} days is entered`,
  'zone-empty': 'Nothing is growing in this zone',
};

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

const isOnboarded = (cycle) => !!(cycle && cycle.onboarded);

/** Backfilled entries, filtered. Newest first. */
function backfills(state, { cycleId = null, zoneId = null, kind = null } = {}) {
  return ((state && state.backfills) || [])
    .filter((b) => !kind || b.kind === kind)
    .filter((b) => !cycleId || b.cycleId === cycleId)
    .filter((b) => !zoneId || b.zoneId === zoneId)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

function catalogueFor(state, opts) {
  if (opts.catalogue) return opts.catalogue;
  const rules = opts.rules || peekRules();
  return rules ? buildCatalogue(state || {}, rules) : null;
}

/**
 * The resistance system of a backfilled spray: IRAC, FRAC or neither. Read off
 * the catalogue first, then the group written on the entry, then the slot it
 * was entered in ("last insecticide").
 */
function systemOf(entry, catalogue = null) {
  const active = catalogue ? resolveActive(catalogue, entry.activeId || entry.productName) : null;
  const group = parseGroup((active && active.group) || entry.group || null);
  if (group.system === 'IRAC' || group.system === 'FRAC') return group.system;
  if (entry.slot === 'insecticide') return 'IRAC';
  if (entry.slot === 'fungicide') return 'FRAC';
  return null;
}

/**
 * Backfilled sprays for one cycle, in the shape of a live spray record so the
 * rotation and the PHI can read them without knowing where they came from.
 *
 * FR-STOCK-07 applies to the waiting period: the catalogue's default holds
 * unless the entry states a longer one, and an entry naming nothing the
 * catalogue knows gets the 14-day synthetic default rather than zero.
 */
function backfilledSprays(state, cycleId = null, opts = {}) {
  const catalogue = catalogueFor(state, opts);
  return backfills(state, { cycleId, kind: 'spray' }).map((b) => {
    const active = catalogue ? resolveActive(catalogue, b.activeId || b.productName) : null;
    const entered = Number(b.phiDays);
    const enteredRei = Number(b.reiHours);
    const basePhi = active ? active.phiDays : 14;
    const baseRei = active ? active.reiHours : 24;
    return {
      ...b,
      // `at` on the entry is when it was typed in, not when the spray went
      // on. Re-entry is timed from `at` when there is one, so it is moved
      // aside: a spray backfilled as five days old is five days old.
      at: null,
      enteredAt: b.at,
      backfilled: true,
      activeId: (active && active.id) || b.activeId || null,
      productId: (active && active.id) || b.activeId || null,
      productName: (active && active.name) || b.productName || 'Unnamed product',
      group: (active && active.group) || b.group || '',
      phiDays: Number.isFinite(entered) && entered > basePhi ? entered : basePhi,
      reiHours: Number.isFinite(enteredRei) && enteredRei > baseRei ? enteredRei : baseRei,
      diagnosisId: null,
    };
  });
}

/**
 * Every spray the gates must reckon with on this cycle: the live ones and the
 * backfilled ones. FR-ONB-04.
 */
function sprayHistory(state, cycleId, opts = {}) {
  const catalogue = catalogueFor(state, opts);
  // FR-STOCK-07, FR-TREAT-02: the waiting periods come from the catalogue; a
  // live record's own figures only ever lengthen them (sprayIntervals).
  const live = ((state && state.sprays) || []).filter((s) => s.cycleId === cycleId)
    .map((s) => {
      if (!catalogue) return s;
      const { phiDays, reiHours } = sprayIntervals(catalogue, s);
      return { ...s, phiDays, reiHours };
    });
  return [...live, ...backfilledSprays(state, cycleId, { ...opts, catalogue })];
}

/** The latest "none" statement of this kind for a cycle (or zone). */
function declared(state, item, { cycleId = null, zoneId = null } = {}) {
  return backfills(state, { kind: 'declare', cycleId, zoneId }).find((d) => d.item === item) || null;
}

/**
 * FR-ONB-05 — is this cycle's spray history on record?
 *
 * A cycle started in the app has its whole history in the app, so it is known
 * by construction. An onboarded cycle needs three things, each either entered
 * or stated as none: the last insecticide, the last fungicide, and every spray
 * in the 21 days before setup.
 */
function sprayHistoryStatus(state, cycleId, opts = {}) {
  const cycle = ((state && state.cycles) || {})[cycleId];
  if (!cycle) return { known: false, cycle: null, missing: [], lines: [] };
  if (!isOnboarded(cycle)) return { known: true, cycle, live: true, missing: [], lines: [] };

  const catalogue = catalogueFor(state, opts);
  const sprays = backfills(state, { cycleId, kind: 'spray' });
  const bySystem = (system) => sprays.filter((s) => systemOf(s, catalogue) === system)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : -1))[0] || null;

  const line = (id, label, have, from) => ({ id, label, have: !!have, from: from || null });
  const insecticide = bySystem('IRAC');
  const fungicide = bySystem('FRAC');
  const lines = [
    line('insecticide', 'Last insecticide, with its group and date',
      insecticide || declared(state, 'no-insecticide', { cycleId }),
      insecticide ? `${insecticide.productName || insecticide.group} on ${dayOf(insecticide)}`
        : declared(state, 'no-insecticide', { cycleId }) ? DECLARATIONS['no-insecticide'] : null),
    line('fungicide', 'Last fungicide, with its group and date',
      fungicide || declared(state, 'no-fungicide', { cycleId }),
      fungicide ? `${fungicide.productName || fungicide.group} on ${dayOf(fungicide)}`
        : declared(state, 'no-fungicide', { cycleId }) ? DECLARATIONS['no-fungicide'] : null),
    line('recent', `Every spray in the last ${HISTORY_WINDOW_DAYS} days`,
      declared(state, 'recent-complete', { cycleId }),
      declared(state, 'recent-complete', { cycleId }) ? DECLARATIONS['recent-complete'] : null),
  ];
  const missing = lines.filter((l) => !l.have);
  return { known: missing.length === 0, cycle, live: false, missing, lines };
}

function missingText(status) {
  return status.missing.map((l) => l.label.toLowerCase()).join('; ');
}

/**
 * FR-ONB-05 — a treatment on a cycle with no spray history on record.
 *
 * Returns null when the history is known. Otherwise the refusal, in the same
 * shape as every other treatment refusal (reason, why, fix).
 */
function treatmentHistoryBlock(state, cycleId, opts = {}) {
  const status = sprayHistoryStatus(state, cycleId, opts);
  if (status.known || !status.cycle) return null;
  return {
    ok: false,
    reason: 'spray-history-missing',
    missing: status.missing,
    why: `The spray history for this zone is missing: ${missingText(status)}. `
      + 'Without it the app cannot tell which group went on last, so it cannot check the rotation.',
    fix: 'The Farm Manager or Owner enters it on the Setup screen: the last insecticide and the last fungicide '
      + `with group and date, and every spray in the last ${HISTORY_WINDOW_DAYS} days — or records that there were none.`,
    sources: ['FR-ONB-05', 'FR-GATE-05'],
  };
}

/**
 * FR-TREAT-02 and FR-ONB-04/05 — may this cycle be picked?
 *
 * The PHI reads live and backfilled sprays alike. A cycle with no spray
 * history on record is not safe by default; it is blocked, because a spray
 * nobody entered is exactly the one whose waiting period is still running.
 */
function harvestCheck(state, cycleId, at = new Date(), opts = {}) {
  const status = sprayHistoryStatus(state, cycleId, opts);
  if (status.cycle && !status.known) {
    return {
      safe: false,
      reason: `The spray history for this zone is missing (${missingText(status)}), so the app cannot tell `
        + 'whether a spray is still inside its waiting period.',
      historyMissing: true,
      missing: status.missing,
      clearOn: null,
      daysLeft: null,
      blocker: null,
    };
  }
  return harvestClearance(sprayHistory(state, cycleId, opts), at);
}

/** Re-entry reads backfilled sprays as well: the chemical does not know it was typed in late. */
function reentryCheck(state, cycleId, at = new Date(), opts = {}) {
  return reentryClearance(sprayHistory(state, cycleId, opts), at);
}

/** The latest harvest-to-date figure for a cycle, if one was entered. */
function harvestToDate(state, cycleId) {
  return backfills(state, { cycleId, kind: 'harvest' })[0] || null;
}

/** FR-ONB-06 — the evidence entered for a zone planted before the gates. */
function preGatesEvidence(state, zoneId, cycleId = null) {
  return backfills(state, { zoneId, kind: 'evidence' })
    .filter((e) => !cycleId || !e.cycleId || e.cycleId === cycleId);
}

/**
 * FR-ONB-06 — was this crop planted before the app existed?
 *
 * Only an onboarded cycle whose transplant date is before the day it was set
 * up. It is a status, not a pass: the gates still say what they found, and
 * none of it counts as a violation or needs an override, because there was no
 * gate to pass on the day it went in.
 */
function plantedBeforeGates(cycle) {
  if (!isOnboarded(cycle) || !cycle.transplantDate) return false;
  const setup = cycle.onboarded.date || dayOf(cycle.onboarded);
  return !!setup && cycle.transplantDate < setup;
}

/**
 * FR-ONB-02 — the day a crop is on, from its transplant date.
 *
 * Rules → week_counting: "Transplant day = T = Day 1 of Week 0.
 * week = floor((date - T) / 7)." Same arithmetic as rotation.cropWeek.
 */
function cropDay(transplantDate, today = isoDate()) {
  if (!transplantDate) return null;
  const days = daysBetween(transplantDate, today);
  if (days < 0) return null;
  return { days, week: Math.floor(days / 7), dayOfWeek: (days % 7) + 1 };
}

/**
 * FR-ONB-02 — the task schedule for one cycle from a day onward.
 *
 * The same generator the daily round uses, keyed on days after transplant, so
 * a crop onboarded in Week 6 gets Week 6's work in Week 6's rhythm — and
 * nothing from the weeks before the app, which are not overdue, just past.
 */
function scheduleFrom(state, cycleId, { from = isoDate(), days = 7, operations = null } = {}) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = isoDate(addDays(from, i));
    out.push(...tasksFor(state, { date, operations })
      .filter((t) => t.cycleId === cycleId)
      .map((t) => ({ ...t, date })));
  }
  return out;
}

/**
 * FR-ONB-08 — what setup still needs, zone by zone.
 *
 * One row per cropping zone. A zone is complete when it either has a crop the
 * app knows the whole history of, or an onboarded crop with every item
 * entered, or is recorded as empty. The farm-wide stock count is its own row.
 */
function setupStatus(state, { today = isoDate(), ...opts } = {}) {
  const zones = Object.values((state && state.plots) || {})
    .filter((z) => !z.retired && z.type !== 'nursery')
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

  const rows = zones.map((zone) => {
    const cycle = Object.values(state.cycles || {})
      .filter((c) => c.plotId === zone.id && c.status === 'active')
      .sort((a, b) => ((a.transplantDate || '') < (b.transplantDate || '') ? 1 : -1))[0] || null;

    if (!cycle) {
      // Between two cycles the app ran: nothing to onboard.
      if (Object.values(state.cycles || {}).some((c) => c.plotId === zone.id && c.status === 'closed')) {
        return { zone, cycle: null, status: 'between', complete: true, missing: [], notes: ['Between cycles.'] };
      }
      const empty = declared(state, 'zone-empty', { zoneId: zone.id });
      return empty
        ? { zone, cycle: null, status: 'empty', complete: true, missing: [], notes: [DECLARATIONS['zone-empty']] }
        : { zone, cycle: null, status: 'not-set-up', complete: false,
          missing: [{ id: 'cycle', label: 'The crop in it: media type, crop, variety and transplant date — or record that it is empty' }],
          notes: [] };
    }
    if (!isOnboarded(cycle)) {
      return { zone, cycle, status: 'live', complete: true, missing: [], notes: ['Started in the app; its history is complete.'] };
    }

    const missing = [];
    if (!cycle.media) missing.push({ id: 'media', label: 'Media type (bed soil or plant bags)' });
    if (!cycle.cropId) missing.push({ id: 'crop', label: 'Crop' });
    if (!cycle.variety) missing.push({ id: 'variety', label: 'Variety' });
    if (!cycle.transplantDate) missing.push({ id: 'transplant', label: 'Transplant date' });
    const history = sprayHistoryStatus(state, cycle.id, opts);
    missing.push(...history.missing.map((l) => ({ id: `spray-${l.id}`, label: l.label })));
    if (!harvestToDate(state, cycle.id)) missing.push({ id: 'harvest', label: 'Harvest to date (0 if nothing picked yet)' });

    const evidence = preGatesEvidence(state, zone.id, cycle.id);
    const notes = [];
    if (plantedBeforeGates(cycle)) notes.push(`${PRE_GATES_LABEL}.`);
    notes.push(evidence.length
      ? `${evidence.length} piece${evidence.length === 1 ? '' : 's'} of gate evidence attached.`
      : 'No gate evidence attached. Add any that exists: a soil or lab report, a pH reading, a photo.');
    const at = cropDay(cycle.transplantDate, today);
    return {
      zone, cycle, status: missing.length ? 'incomplete' : 'complete', complete: !missing.length,
      missing, notes, week: at ? at.week : null, history, evidence,
    };
  });

  const stock = backfills(state, { kind: 'stock' });
  const farm = {
    id: 'stock',
    label: 'Stock on hand',
    complete: stock.length > 0,
    missing: stock.length ? [] : [{ id: 'stock', label: 'Count the store: chemicals, fertiliser, lime, seed, traps' }],
    count: stock.length,
  };

  return {
    rows,
    farm,
    incomplete: rows.filter((r) => !r.complete),
    complete: rows.every((r) => r.complete) && farm.complete,
  };
}
})(__dvModule("web/js/domain/onboarding.js"));
__dvBindAll();

// ─── web/js/domain/rotation.js ─────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "cropWeek": { enumerable: true, get: () => cropWeek },
  "WEEK_10": { enumerable: true, get: () => WEEK_10 },
  "week10Actives": { enumerable: true, get: () => week10Actives },
  "sequenceFor": { enumerable: true, get: () => sequenceFor },
  "nextInSequence": { enumerable: true, get: () => nextInSequence },
  "thripsProgramme": { enumerable: true, get: () => thripsProgramme },
  "priorSprays": { enumerable: true, get: () => priorSprays },
  "rotationVerdict": { enumerable: true, get: () => rotationVerdict },
  "groupUsage": { enumerable: true, get: () => groupUsage },
});
let daysBetween, isoDate;
let getRules, ref;
let buildCatalogue, canUseActive, parseGroup, resolveActive, sameGroup, groupOfSpray;
let backfilledSprays, sprayHistory, treatmentHistoryBlock;
__dvImport("web/js/util.js", (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/rules.js", (m) => { getRules = m.getRules; }, (m) => { ref = m.ref; });
__dvImport("web/js/domain/catalogue.js", (m) => { buildCatalogue = m.buildCatalogue; }, (m) => { canUseActive = m.canUseActive; }, (m) => { parseGroup = m.parseGroup; }, (m) => { resolveActive = m.resolveActive; }, (m) => { sameGroup = m.sameGroup; }, (m) => { groupOfSpray = m.groupOfSpray; });
__dvImport("web/js/domain/onboarding.js", (m) => { backfilledSprays = m.backfilledSprays; }, (m) => { sprayHistory = m.sprayHistory; }, (m) => { treatmentHistoryBlock = m.treatmentHistoryBlock; });
// Rotation by resistance group — FR-GATE-05, Build Rules §6, §7 and SR-08.
//
// The old check counted how often one product had been used. That was the wrong
// unit: cypermethrin and lambda-cyhalothrin are two products and one group, and
// alternating them is not a rotation, it is the same spray twice with a
// different label. So the check now reads groups, and it reads them out of
// rules/douvalue_rules_rev5_1.json — the named IRAC sequence (3A → 4A → 5 → 28,
// then restart), the named FRAC sequence (M3 → M1 → 4+M3, then restart), the
// thrips programme by group, and the Week 10 organics-only rule with its one
// exception for repeated M1.
//
// Every verdict carries `sources`: the exact pointers into the rules file that
// produced it. A hand who is refused a product can be shown the line, and a
// manager who disagrees can argue with the rules rather than with the app.






const norm = (s) => String(s || '').toLowerCase();

/**
 * Which week the crop is in — rules week_counting.
 *
 * "Transplant day = T = Day 1 of Week 0. week = floor((date - T) / 7)."
 */
function cropWeek(cycle, today = isoDate()) {
  if (!cycle || !cycle.transplantDate) return null;
  const days = daysBetween(cycle.transplantDate, today);
  if (days < 0) return null;
  return Math.floor(days / 7);
}

const WEEK_10 = 10;

/**
 * The organics SR-08 allows from Week 10 — read off the rule text itself.
 *
 * The rule reads: "From Week 10 (both crops): organics only - neem oil,
 * garlic-chilli, Copper Hydroxide. No synthetic insecticide within 14 days..."
 * so the list is what stands between "organics only" and the full stop. Taking
 * it from the text rather than retyping it here means the app cannot drift from
 * the rules when the rules change.
 */
function week10Actives(catalogue, rules = getRules()) {
  const rows = rules.spray_rules || [];
  const i = rows.findIndex((r) => r.id === 'SR-08');
  const text = norm(i >= 0 ? rows[i].rule : '');
  const after = text.split('organics only')[1] || '';
  const named = after.split('.')[0].replace(/^[\s:\-–]+/, '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const actives = [];
  for (const name of named) {
    const active = resolveActive(catalogue, name);
    if (active && !actives.includes(active)) actives.push(active);
  }
  return { actives, named, source: ref(`spray_rules/${i >= 0 ? i : ''}`) };
}

/** The named sequence for a system, as ordered group codes. */
function sequenceFor(system, rules = getRules()) {
  const key = system === 'FRAC' ? 'fungicide_rotation' : 'insecticide_rotation';
  const block = rules[key] || {};
  const steps = (block.sequence || []).map((step, i) => ({
    order: step.order ?? i + 1,
    product: step.product,
    group: parseGroup(`${system} ${system === 'FRAC' ? step.frac : step.irac}`),
    source: ref(`${key}/sequence/${i}`),
  }));
  return { key, steps, rule: block.rule || '', then: block.then || '', source: ref(`${key}/rule`) };
}

/** The step after the one last used, so a refusal can say what to use instead. */
function nextInSequence(system, lastCodes, rules = getRules()) {
  const seq = sequenceFor(system, rules);
  if (!seq.steps.length) return null;
  const at = seq.steps.findIndex((s) => s.group.codes.some((c) => (lastCodes || []).includes(c)));
  return seq.steps[(at + 1) % seq.steps.length] || seq.steps[0];
}

/** The thrips programme — rotate by group, never the same group twice running. */
function thripsProgramme(catalogue, rules = getRules()) {
  const block = rules.thrips_program || {};
  const options = Object.entries(block.options_by_group || {}).map(([group, text], i) => ({
    group: parseGroup(group),
    groupText: group,
    text,
    // The rules name the products for each group ("spinosad (preferred) or
    // spinetoram"), so the programme offers those, not every active that
    // happens to share the group.
    actives: namedIn(text, catalogue.actives.filter((a) => sameGroup(parseGroup(a.group), parseGroup(group)))),
    source: ref(`thrips_program/options_by_group/${i}`),
  }));
  return { rule: block.rule || '', note: block.note || '', options, source: ref('thrips_program/rule') };
}

/** The actives a rule names by name, or all of them if it names none. */
function namedIn(text, actives) {
  const hit = actives.filter((a) => a.aliases.some((alias) => norm(text).includes(alias)));
  return hit.length ? hit : actives;
}

const isThrips = (target) => /thrips/.test(norm(target));

/** Wound-care copper is logged, but the rules exclude it from the FRAC count. */
const countsForRotation = (spray) => !/wound/.test(norm(spray.purpose || spray.targetProblem || ''));

/**
 * The sprays already on this zone that the rotation has to reckon with, newest
 * first, in the same resistance system as the product being considered.
 *
 * FR-ONB-04: backfilled sprays count. Spinosad typed in on setup day went on
 * the same thrips as spinosad logged live, and a second IRAC 5 after it is the
 * same resistance risk whichever screen the first one came through.
 */
function priorSprays(state, cycleId, system, catalogue, today = isoDate()) {
  return sprayHistory(state, cycleId, { catalogue })
    .filter((s) => s.date && s.date <= today)
    .filter(countsForRotation)
    .map((s) => ({ spray: s, ...groupOfSpray(catalogue, s) }))
    .filter((r) => r.group.rotates && (!system || r.group.system === system))
    .sort((a, b) => (a.spray.date < b.spray.date ? 1 : -1));
}

/**
 * The rotation verdict.
 *
 * Order matters, and it is the order of consequence: a product nobody can dose
 * is refused before anything else, Week 10 outranks the rotation because it is
 * about residue on fruit that is being picked now, and the group check comes
 * last because it is about next season.
 */
function rotationVerdict(state, cycleId, productRef, opts = {}) {
  const rules = opts.rules || getRules();
  const catalogue = opts.catalogue || buildCatalogue(state, rules);
  const today = opts.today || isoDate();
  const sources = [];

  if (!productRef) return { ok: true, sources };

  // FR-ONB-05 — an onboarded zone with no spray history on record. The last
  // group is unknown, and unknown is not pass: nothing is judged against a
  // history nobody has entered.
  const missingHistory = treatmentHistoryBlock(state, cycleId, { catalogue });
  if (missingHistory) return missingHistory;

  const active = resolveActive(catalogue, productRef);
  if (!active) {
    return {
      ok: false, reason: 'not-in-catalogue',
      why: `${productRef} is not in the active-ingredient catalogue, so it has no IRAC or FRAC group on file.`,
      fix: 'Treatments are chosen by active ingredient. Pick one from the catalogue; the Owner adds a new '
        + 'active, with its group.',
      sources: [ref('product_rule')],
    };
  }
  sources.push(active.groupSource);

  // FR-STOCK-08 — no schedule rate and no label rate means no dose, and an
  // invented dose is worse than no spray.
  const usable = canUseActive(catalogue, active.id);
  if (!usable.ok) return { ...usable, active, sources: [...sources, usable.source].filter(Boolean) };

  const group = parseGroup(active.group);
  const cycle = (state.cycles || {})[cycleId];
  const week = opts.week != null ? opts.week : cropWeek(cycle, today);

  // SR-08 / rei.week_10_rule — from Week 10 the crop is being picked, so only
  // the three organics may go on it. This is a residue rule, not a resistance
  // rule, and it outranks everything below.
  if (week != null && week >= WEEK_10) {
    const allowed = week10Actives(catalogue, rules);
    sources.push(allowed.source, ref('rei/week_10_rule'));
    if (!allowed.actives.some((a) => a.id === active.id)) {
      return {
        ok: false, reason: 'week-10', active, week, sources,
        why: `The crop is in Week ${week}, and from Week 10 the rules allow organics only: `
          + `${allowed.actives.map((a) => a.name).join(', ')}.`,
        fix: `${active.name} is not one of them. Picking is under way, and a synthetic now puts residue on `
          + 'fruit that is already going to market.',
        alternatives: allowed.actives.filter((a) => canUseActive(catalogue, a.id).ok).map((a) => a.name),
      };
    }
  }

  // The thrips programme is by group: the rules name which groups may be used
  // against thrips at all, and neither 3A nor anything outside that list is in
  // it. A pyrethroid on thrips is how Season 1 was lost.
  const target = opts.target || (opts.diagnosis && (opts.diagnosis.problemId || opts.diagnosis.problemName));
  if (isThrips(target) && group.rotates) {
    const programme = thripsProgramme(catalogue, rules);
    sources.push(programme.source);
    const inProgramme = programme.options.some((o) => sameGroup(o.group, group));
    if (!inProgramme) {
      const offered = programme.options
        .flatMap((o) => o.actives.filter((a) => canUseActive(catalogue, a.id).ok)
          .map((a) => `${a.name} (${a.group})`));
      return {
        ok: false, reason: 'thrips-programme', active, group: active.group, sources,
        why: `${active.name} is ${active.group}, and that group is not in the thrips programme.`,
        fix: offered.length
          ? `The programme rotates ${programme.options.map((o) => o.groupText).join(', ')}. Ready to use: ${offered.join(', ')}.`
          : `The programme rotates ${programme.options.map((o) => o.groupText).join(', ')}, but none of those `
            + 'has a rate yet — enter a label first.',
        alternatives: offered,
      };
    }
  }

  if (!group.rotates) {
    // "none" and IRAC UN are not resistance groups: garlic-chilli and neem are
    // meant to be repeated, and the Week 10 programme depends on it.
    return { ok: true, active, group: active.group, sources };
  }

  const prior = priorSprays(state, cycleId, group.system, catalogue, today);
  const last = prior[0];

  // The one exception in the rules: from Week 10, Copper Hydroxide is the only
  // PHI-0 fungicide, so repeated M1 is allowed — at the sequence's own 10-14
  // day interval, not back to back.
  const m1Repeat = week != null && week >= WEEK_10 && group.system === 'FRAC'
    && group.codes.length === 1 && group.codes[0] === 'M1';

  if (last && sameGroup(last.group, group)) {
    const seq = sequenceFor(group.system, rules);
    sources.push(seq.source);
    if (m1Repeat) {
      sources.push(ref('fungicide_rotation/week_10_exception'));
      const gap = daysBetween(last.spray.date, today);
      if (gap < 10) {
        return {
          ok: false, reason: 'interval', active, group: active.group, week, sources,
          why: `Repeated M1 is allowed from Week 10, but at 10-14 day intervals. The last M1 on this zone `
            + `was ${gap} day${gap === 1 ? '' : 's'} ago.`,
          fix: `Wait until ${addDaysIso(last.spray.date, 10)}.`,
          lastSpray: last.spray,
        };
      }
      return { ok: true, active, group: active.group, week, exception: 'week-10-m1', sources };
    }
    const next = nextInSequence(group.system, group.codes, rules);
    const alternatives = next
      ? catalogue.actives.filter((a) => sameGroup(parseGroup(a.group), next.group))
        .filter((a) => canUseActive(catalogue, a.id).ok).map((a) => a.name)
      : [];
    return {
      ok: false, reason: 'rotation', active, group: active.group, sources,
      why: `${sentence(seq.rule)} ${last.active ? last.active.name : last.spray.productName || 'The last spray'} `
        + `on ${last.spray.date} was ${last.group.text}, and ${active.name} is ${active.group}.`,
      fix: next
        ? `The sequence says ${next.product} next.${alternatives.length
          ? ` Ready to use: ${alternatives.join(' or ')}.` : ''}`
        : 'Use a product from a different group this time.',
      alternatives: alternatives.length ? alternatives : (next ? [next.product] : []),
      lastSpray: last.spray,
      nextInSequence: next ? next.product : null,
    };
  }

  // "Metalaxyl-M only in rotation, max every 3rd" — the one product the rules
  // single out, because it is the only systemic Phytophthora product the farm
  // has and losing it to resistance would cost a whole wet season.
  if (/metalaxyl/i.test(active.name)) {
    sources.push(ref('fungicide_rotation/rule'), ref('mixing_rules/5'));
    const recent = prior.slice(0, 2).find((r) => r.active && /metalaxyl/i.test(r.active.name));
    if (recent) {
      return {
        ok: false, reason: 'metalaxyl-interval', active, sources,
        why: `Metalaxyl-M is allowed in rotation only, at most every third fungicide. It was used on this `
          + `zone on ${recent.spray.date}, ${prior.indexOf(recent) + 1} spray${prior.indexOf(recent) ? 's' : ''} ago.`,
        fix: 'Put Mancozeb (M3) and Copper Oxychloride (M1) through first.',
        lastSpray: recent.spray,
      };
    }
  }

  return { ok: true, active, group: active.group, week, sources };
}

/** The rules are written as clauses ("never the same FRAC group twice in a row;
 * Metalaxyl-M only in rotation"). A refusal quotes the clause that applies. */
function sentence(rule) {
  const first = String(rule || '').split(';')[0].trim();
  return first ? `${first[0].toUpperCase()}${first.slice(1)}.` : '';
}

/**
 * Where a resistance group is being leaned on across the whole farm.
 *
 * The rotation gate works per zone, because resistance builds in one
 * population. This is the other view, for the Owner's digest: one group going
 * on bed after bed is the farm buying itself a resistant population the slow
 * way, and no single zone's gate would ever see it.
 */
function groupUsage(state, { rules = getRules(), catalogue = null, withinDays = 60,
  today = isoDate(), threshold = 3 } = {}) {
  const cat = catalogue || buildCatalogue(state, rules);
  const byGroup = new Map();

  for (const spray of [...(state.sprays || []), ...backfilledSprays(state, null, { catalogue: cat })]) {
    if (!spray.date || daysBetween(spray.date, today) > withinDays) continue;
    if (!countsForRotation(spray)) continue;
    const { group, active } = groupOfSpray(cat, spray);
    if (!group.rotates) continue;
    const key = group.text;
    const entry = byGroup.get(key) || { group: key, system: group.system, uses: [], products: new Set() };
    entry.uses.push({ date: spray.date, cycleId: spray.cycleId });
    entry.products.add(active ? active.name : (spray.productName || spray.productId));
    byGroup.set(key, entry);
  }

  return [...byGroup.values()]
    .filter((e) => e.uses.length >= threshold)
    .map((e) => {
      const next = nextInSequence(e.system, parseGroup(e.group).codes, rules);
      return {
        group: e.group,
        count: e.uses.length,
        products: [...e.products],
        message: `${e.group} has gone on this farm ${e.uses.length} times in ${withinDays} days.`,
        alternatives: next
          ? cat.actives.filter((a) => sameGroup(parseGroup(a.group), next.group))
            .filter((a) => canUseActive(cat, a.id).ok).map((a) => a.name)
          : [],
        source: ref(`${e.system === 'FRAC' ? 'fungicide' : 'insecticide'}_rotation/rule`),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
})(__dvModule("web/js/domain/rotation.js"));
__dvBindAll();

// ─── web/js/domain/media.js ────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "MEDIA_TYPES": { enumerable: true, get: () => MEDIA_TYPES },
  "BARRIERS": { enumerable: true, get: () => BARRIERS },
  "MEDIA_SOURCES": { enumerable: true, get: () => MEDIA_SOURCES },
  "bagRules": { enumerable: true, get: () => bagRules },
  "mediaOf": { enumerable: true, get: () => mediaOf },
  "isBagZone": { enumerable: true, get: () => isBagZone },
  "barrierLabel": { enumerable: true, get: () => barrierLabel },
  "batchName": { enumerable: true, get: () => batchName },
  "fillsFor": { enumerable: true, get: () => fillsFor },
  "batchesIn": { enumerable: true, get: () => batchesIn },
  "firstFill": { enumerable: true, get: () => firstFill },
  "batchFailure": { enumerable: true, get: () => batchFailure },
  "batchTrace": { enumerable: true, get: () => batchTrace },
  "traceText": { enumerable: true, get: () => traceText },
  "failedBatches": { enumerable: true, get: () => failedBatches },
  "galledCycle": { enumerable: true, get: () => galledCycle },
});
let isoDate;
let peekRules;
__dvImport("web/js/util.js", (m) => { isoDate = m.isoDate; });
__dvImport("web/js/rules.js", (m) => { peekRules = m.peekRules; });
// Plant-bag zones — the media type per zone, and batch → bags → zone (C-19).
//
// A zone grows its crop either in its own bed soil or in plant bags filled from
// a batch of media. For a bed zone nothing here applies and nothing changes.
// For a bag zone the bed is not the ground the roots meet; the batch is. So
// Gate 0 is judged on the batch (gates.js reads the helpers below), every fill
// is recorded as batch → number of bags → zone, and a batch that fails after it
// has been used can name every zone it went into.
//
// Rules → plant_bags. Nothing in this file is agronomy of its own: it keeps the
// records straight so the gates can read them.




const MEDIA_TYPES = {
  bed: { id: 'bed', label: 'Bed soil' },
  bag: { id: 'bag', label: 'Plant bags' },
};

/** Rules → plant_bags.barrier.options, with the ids the records carry. */
const BARRIERS = [
  { value: 'ground_cover', label: 'Ground cover' },
  { value: 'polythene', label: 'Polythene' },
  { value: 'none', label: 'None — bags stand on bare ground' },
];

const MEDIA_SOURCES = [
  { value: 'fresh', label: 'Fresh — a new delivery' },
  { value: 're-treated', label: 'Re-treated — used media, treated again' },
];

function bagRules(rules = peekRules()) {
  return (rules && rules.plant_bags) || null;
}

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

/**
 * The media a crop in this zone grows in. A planted cycle keeps the media it
 * was planted in, so changing the zone later does not re-judge that crop.
 * Anything that is not recorded as bags is bed soil: a zone set up before
 * media types existed is judged exactly as it always was.
 */
function mediaOf(state, zoneId, cycle = null) {
  if (cycle && cycle.media) return cycle.media === 'bag' ? 'bag' : 'bed';
  const zone = ((state && state.plots) || {})[zoneId];
  return zone && zone.media === 'bag' ? 'bag' : 'bed';
}

const isBagZone = (zone) => !!zone && zone.media === 'bag';

function barrierLabel(value) {
  const b = BARRIERS.find((x) => x.value === value);
  return b ? b.label : null;
}

function batchName(batch) {
  if (!batch) return 'an unrecorded batch';
  return batch.label || `${batch.supplier || 'batch'} ${String(batch.id).slice(-4)}`;
}

/** Every fill into a zone that was not refused, in a window, oldest first. */
function fillsFor(state, zoneId, { since = null, until = null } = {}) {
  return ((state && state.mediaFills) || [])
    .filter((f) => f.zoneId === zoneId && !f.refused)
    .filter((f) => (!since || dayOf(f) > since) && (!until || dayOf(f) <= until))
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
}

/** The batches the bags in a zone were filled from, in that window. */
function batchesIn(state, zoneId, window = {}) {
  const ids = [...new Set(fillsFor(state, zoneId, window).map((f) => f.batchId))];
  return ids.map((id) => ({ id, batch: ((state && state.mediaBatches) || {})[id] || null }));
}

/** The first day a batch went into bags, or null. */
function firstFill(state, batchId) {
  const f = ((state && state.mediaFills) || []).filter((x) => x.batchId === batchId && !x.refused)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1))[0];
  return f ? dayOf(f) : null;
}

/**
 * Has this batch failed after it was used? Rules → plant_bags.trace.failure:
 * a nematode result on the batch that is not clear, sampled on or after its
 * first fill, or a failure recorded against it. The earliest one counts.
 * Before a batch fills anything, a bad result is simply the gate saying no.
 */
function batchFailure(state, batchId) {
  const batch = ((state && state.mediaBatches) || {})[batchId];
  if (!batch) return null;
  const first = firstFill(state, batchId);
  const found = [];
  if (batch.failure) {
    found.push({ date: batch.failure.date, reason: batch.failure.reason || 'recorded',
      why: batch.failure.note || batch.failure.reason || 'failure recorded', by: batch.failure.by,
      from: { kind: 'media-batch', id: batchId } });
  }
  if (first) {
    for (const t of (state.soilTests || [])) {
      if (t.mediaBatchId !== batchId || !t.nematode || t.nematode === 'clean' || !t.date || t.date < first) continue;
      found.push({ date: t.date, reason: 'nematode', why: `nematode test came back ${t.nematode}${t.lab ? ` (${t.lab})` : ''}`,
        from: { kind: 'soil-test', id: t.id } });
    }
  }
  return found.sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

/**
 * The cycles that grew in the bags a fill made. A cycle counts when it was
 * planted on or after the fill and the fill came after the cycle before it in
 * that zone had ended — the same window Gate 0 reads.
 */
function cyclesFromFill(state, fill) {
  const cycles = Object.values((state && state.cycles) || {}).filter((c) => c.plotId === fill.zoneId);
  return cycles.filter((c) => {
    if (!c.transplantDate || c.transplantDate < dayOf(fill)) return false;
    const before = cycles.filter((o) => o !== c && o.closedAt && o.closedAt <= c.transplantDate)
      .map((o) => o.closedAt).sort().pop();
    return !before || dayOf(fill) > before;
  });
}

/**
 * Rules → plant_bags.trace: batch → bags → zone. Every zone the batch filled,
 * with the bags, the fill dates and any crop planted in them.
 */
function batchTrace(state, batchId) {
  const batch = ((state && state.mediaBatches) || {})[batchId] || null;
  const fills = ((state && state.mediaFills) || []).filter((f) => f.batchId === batchId && !f.refused)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
  const byZone = new Map();
  for (const f of fills) {
    const row = byZone.get(f.zoneId) || {
      zoneId: f.zoneId, zone: ((state && state.plots) || {})[f.zoneId] || null, bags: 0, fills: [], cycles: [],
    };
    row.bags += Number(f.bags) || 0;
    row.fills.push(f);
    for (const c of cyclesFromFill(state, f)) if (!row.cycles.includes(c)) row.cycles.push(c);
    byZone.set(f.zoneId, row);
  }
  const zones = [...byZone.values()].map((z) => ({
    ...z,
    name: (z.zone && z.zone.name) || z.zoneId,
    planted: z.cycles.filter((c) => c.status === 'active'),
  }));
  return { batch, fills, zones, bags: zones.reduce((n, z) => n + z.bags, 0) };
}

/** "GH-04 (120 bags, planted 2026-09-16), GH-05 (80 bags, empty)" */
function traceText(trace) {
  return trace.zones.map((z) => {
    const crop = z.planted.length ? `planted ${z.planted.map((c) => c.transplantDate).join(', ')}`
      : z.cycles.length ? 'crop closed' : 'not planted';
    return `${z.name} (${z.bags} bag${z.bags === 1 ? '' : 's'}, ${crop})`;
  }).join('; ');
}

/**
 * Every batch that has failed after filling bags, with where it went. This is
 * what the Gates screen and the Owner's digest show: a failure is only useful
 * if it arrives with the list of houses to go and look at.
 */
function failedBatches(state, { today = isoDate() } = {}) {
  return Object.values((state && state.mediaBatches) || {})
    .map((batch) => ({ batch, failure: batchFailure(state, batch.id) }))
    .filter((x) => x.failure && x.failure.date <= today)
    .map((x) => ({ ...x, trace: batchTrace(state, x.batch.id) }))
    .filter((x) => x.trace.zones.length)
    .sort((a, b) => (a.failure.date < b.failure.date ? 1 : -1));
}

/**
 * Was this crop galled? Rules → plant_bags.clean_restart.galled: the Gate 4
 * root inspection found galls, a root-knot nematode diagnosis was confirmed on
 * it, or the batch in its bags failed on nematodes.
 */
function galledCycle(state, cycle) {
  if (!cycle) return { galled: false, why: null };
  const inspection = ((state && state.gateEvidence) || [])
    .find((e) => e.gate === 'G4' && e.itemId === 'root_inspection' && e.cycleId === cycle.id && e.galls);
  if (inspection) return { galled: true, why: `the root inspection on ${dayOf(inspection)} found galls` };
  const diagnosis = ((state && state.diagnoses) || [])
    .find((d) => d.cycleId === cycle.id && d.problemId === 'root_knot_nematode' && d.confirmedBy);
  if (diagnosis) return { galled: true, why: `root-knot nematode was confirmed on ${diagnosis.date}` };
  for (const f of ((state && state.mediaFills) || []).filter((x) => x.zoneId === cycle.plotId && !x.refused)) {
    if (!cyclesFromFill(state, f).includes(cycle)) continue;
    const failure = batchFailure(state, f.batchId);
    if (failure && failure.reason === 'nematode') {
      return { galled: true, why: `its media batch ${batchName(state.mediaBatches[f.batchId])} failed on nematodes (${failure.date})` };
    }
  }
  return { galled: false, why: null };
}
})(__dvModule("web/js/domain/media.js"));
__dvBindAll();

// ─── web/js/domain/calc.js ─────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "TANKS": { enumerable: true, get: () => TANKS },
  "CAP_ML": { enumerable: true, get: () => CAP_ML },
  "parseRate": { enumerable: true, get: () => parseRate },
  "dosePlan": { enumerable: true, get: () => dosePlan },
  "measure": { enumerable: true, get: () => measure },
  "TEXTURES": { enumerable: true, get: () => TEXTURES },
  "textureFor": { enumerable: true, get: () => textureFor },
  "limePlan": { enumerable: true, get: () => limePlan },
  "mediaLimePlan": { enumerable: true, get: () => mediaLimePlan },
  "locksFor": { enumerable: true, get: () => locksFor },
});
let addDays, daysBetween, isoDate, round;
let KNAPSACK_L;
let rules;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; }, (m) => { round = m.round; });
__dvImport("web/js/domain/safety.js", (m) => { KNAPSACK_L = m.KNAPSACK_L; });
__dvImport("web/js/rules.js", (m) => { rules = m.getRules; });
// The two calculators the Farm Doctor is required to carry (FR-DOC-05).
//
// Both exist because the same two sums were being done in somebody's head, at
// four in the afternoon, next to a running tap. A rate written as "0.3 ml/L"
// is not a dose; a dose is "4.8 ml in this knapsack". A pH of 5.3 is not a
// plan; a plan is "hold, and re-test on the 26th". Turning the first into the
// second is arithmetic, and arithmetic is the one thing a phone is better at
// than a tired person.
//
// Neither calculator invents anything. The dose calculator refuses when there
// is no rate on file (FR-STOCK-08, and the Farm Doctor's own "never invents a
// dose"), and the lime calculator reads its rates, its routes and its timing
// locks straight out of the rules file.





/** The three vessels FR-DOC-05 names, smallest first. */
const TANKS = [
  { litres: KNAPSACK_L, label: `${KNAPSACK_L} L knapsack` },
  { litres: 500, label: '500 L tank' },
  { litres: 1000, label: '1,000 L tank' },
];

/**
 * A bottle cap holds about 10 ml. It is the measure people actually use in the
 * field, and FR-TREAT-03 asks for it by name ("3 caps per 16 L knapsack").
 * Only ever offered for liquids: a cap of powder is not a measurement, and the
 * mixing rules already say borax is weighed, not guessed.
 */
const CAP_ML = 10;

const UNITS = { ml: 'ml', l: 'L', g: 'g', kg: 'kg' };

/**
 * Turn a written rate into numbers.
 *
 * Handles the shapes the rules file and the label form actually produce:
 *
 *   "1 ml/L (10EC)"                              -> 1 ml per litre, 10EC
 *   "0.3 ml/L (45SC), after 4 PM"                -> 0.3 ml per litre, with a timing note
 *   "150 ml cold-pressed oil + 30 ml soap / 16 L" -> two components, per 16 L
 *   "5 g/L GH; 2.5 g/L field"                    -> first clause governs, the rest recorded
 *   "per label" / "see prep table" / null        -> refused
 *
 * A refusal is not a failure of the calculator. It is the calculator doing its
 * job: "the product cannot be used until a label rate is entered".
 */
function parseRate(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) {
    return refuse(text, 'No rate is recorded for this product.');
  }
  if (/^(per label|see\b|as per|refer)/i.test(text)) {
    return refuse(text, `The rules file says "${text}", which is not a number this app can weigh out.`);
  }

  // "5 g/L GH; 2.5 g/L field" — the first clause is the one that governs, and
  // the others are kept so the screen can show the person their choice.
  const clauses = text.split(';').map((c) => c.trim()).filter(Boolean);
  const head = clauses[0];
  const variants = clauses.slice(1);

  // A trailing "/ 16 L" is a whole-tank basis. A bare "/L" is per litre.
  const perTank = head.match(/\/\s*([\d.]+)\s*(?:L|litres?)\b/i);
  const perLitre = /\/\s*(?:L|litres?)\b/i.test(head);
  const basisLitres = perTank ? Number(perTank[1]) : (perLitre ? 1 : null);
  if (!basisLitres) {
    return refuse(text, `"${text}" does not say how much water it goes into, so it cannot be scaled.`);
  }

  const formulation = (head.match(/\(([^)]*\d[^)]*)\)/) || [])[1] || null;
  const timing = (head.match(/,\s*(after[^,;]*|before[^,;]*)/i) || [])[1] || null;

  // Strip the basis and the bracketed formulation before splitting components,
  // so "(45SC)" does not read as another thing to pour in.
  const body = head
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\/\s*[\d.]*\s*(?:L|litres?)\b/i, ' ')
    .replace(/,\s*(after|before)[^,;]*/i, ' ');

  const components = [];
  for (const piece of body.split('+')) {
    const m = piece.match(/([\d.]+)\s*(ml|l|g|kg)\b/i);
    if (!m) continue;
    const of = piece
      .replace(m[0], ' ')
      .replace(/[^A-Za-z- ]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    components.push({
      amount: Number(m[1]) / basisLitres,
      unit: UNITS[m[2].toLowerCase()] || m[2],
      of: of || null,
    });
  }

  if (!components.length) {
    return refuse(text, `No quantity could be read out of "${text}".`);
  }

  // A single component's trailing words are a qualifier ("GH", "field"), not
  // the name of a second thing to pour in. Only a premix has named parts.
  if (components.length === 1 && components[0].of) {
    components[0].context = components[0].of;
    components[0].of = null;
  }

  return {
    ok: true,
    raw: text,
    basisLitres,
    formulation,
    timing,
    variants,
    /** Per one litre of spray, whatever the written basis was. */
    components,
  };
}

function refuse(raw, why) {
  return {
    ok: false,
    raw,
    reason: 'no-rate',
    why,
    // FR-STOCK-08 and the Farm Doctor's "never invents a dose": the way out is
    // a label, entered by the Farm Manager, not a number the app made up.
    fix: 'The Farm Manager enters the label rate against this active ingredient '
      + '(Store → the active → Add label). Until then the product cannot be used.',
    components: [],
  };
}

/**
 * FR-DOC-05 — how much goes in the knapsack, and in each tank.
 *
 * `rate` is a written rate (the schedule rate off the rules file, or a label
 * rate the Farm Manager entered). Everything comes back already rounded to
 * something a person can measure, with the raw number kept beside it so a
 * stock check subtracts the real quantity rather than the displayed one.
 */
function dosePlan(rate, { tanks = TANKS } = {}) {
  const parsed = typeof rate === 'string' || rate == null ? parseRate(rate) : rate;
  if (!parsed.ok) return { ...parsed, tanks: [] };

  return {
    ...parsed,
    tanks: tanks.map((tank) => ({
      ...tank,
      components: parsed.components.map((c) => measure(c.amount * tank.litres, c.unit, c.of)),
      text: parsed.components
        .map((c) => measure(c.amount * tank.litres, c.unit, c.of).text)
        .join(' + ') + ` in ${tank.litres} L of water`,
    })),
  };
}

/** One quantity, in the largest sensible unit, with the cap count if it helps. */
function measure(amount, unit, of = null) {
  let value = amount;
  let shown = unit;

  if (unit === 'ml' && value >= 1000) { value /= 1000; shown = 'L'; }
  if (unit === 'g' && value >= 1000) { value /= 1000; shown = 'kg'; }

  const dp = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const display = round(value, dp);

  // Caps are for liquids only. Powders are weighed.
  const caps = unit === 'ml' && amount >= CAP_ML ? round(amount / CAP_ML, 1) : null;

  return {
    amount,
    unit,
    value: display,
    shownUnit: shown,
    of,
    caps,
    capText: caps ? `about ${caps} cap${caps === 1 ? '' : 's'} of ${CAP_ML} ml` : null,
    weigh: unit === 'g' || unit === 'kg',
    text: `${display} ${shown}${of ? ` ${of}` : ''}`,
  };
}

// --- Lime -----------------------------------------------------------------

/** The texture names in the rules file, with the slugs the screens use. */
const TEXTURES = [
  { id: 'loamy_sand', name: 'Loamy sand', rulesKey: 'loamy sand',
    hint: 'Runs through your fingers. Water disappears fast.' },
  { id: 'sandy_loam', name: 'Sandy loam', rulesKey: 'sandy loam',
    hint: 'Gritty but holds together damp. Most of the main farm.' },
  { id: 'loam_clay_loam', name: 'Loam or clay loam', rulesKey: 'loam / clay loam',
    hint: 'Rolls into a thread when wet. Sticks to the boot.' },
];

function textureFor(id) {
  return TEXTURES.find((t) => t.id === id || t.rulesKey === id) || null;
}

/** "16.5-23.5" -> { low: 16.5, high: 23.5 } */
function rateRange(text) {
  const nums = String(text || '').match(/[\d.]+/g) || [];
  if (!nums.length) return null;
  return { low: Number(nums[0]), high: Number(nums[nums.length - 1]) };
}

/**
 * FR-DOC-05 — the lime calculator.
 *
 * Three pH readings, a texture and a bed area in, a route, a product and a
 * number of kilograms out. The parts that matter most are the two it refuses
 * to turn into kilograms:
 *
 *   pH 5.2 to 5.49  the block is HELD. Route A lime may still be reacting, and
 *                   liming on top of lime that has not finished is how ground
 *                   ends up above 7.0, which is far harder to walk back. The
 *                   answer is a date, not a dose (decision C-5).
 *   pH below 5.2    where lime has already gone on, the top-up is HALF the
 *                   original rate and ten more days. Never a second full dose.
 *
 * Everything below reads its numbers from rules.soil_and_water, so correcting
 * the schedule corrects the calculator.
 */
function limePlan({
  readings = [],
  texture = null,
  areaM2 = 0,
  zoneType = 'greenhouse',
  solarised = false,
  transplantDate = null,
  limeDate = null,
  lastLime = null,
  holdSince = null,
  today = isoDate(),
} = {}) {
  const soil = rules().soil_and_water;
  const gate = soil.soil_ph_gate;
  const lime = soil.lime;

  const points = readings.map(Number).filter((n) => Number.isFinite(n));
  if (points.length < 3) {
    return {
      ok: false,
      reason: 'three-points',
      why: `The gate wants three points per block and ${points.length === 1 ? 'one was' : `${points.length} were`} entered.`,
      fix: `Test three points: ${gate.test}`,
    };
  }

  const tex = textureFor(texture);
  if (!tex) {
    return {
      ok: false,
      reason: 'no-texture',
      why: 'The soil texture decides the rate, and none was chosen.',
      fix: 'Pick loamy sand, sandy loam, or loam / clay loam.',
    };
  }

  const mean = round(points.reduce((a, b) => a + b, 0) / points.length, 2);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const reading = { points, mean, min, max, spread: round(max - min, 2) };

  const warnings = [];
  if (reading.spread > 0.5) {
    warnings.push(`The three points range from ${min} to ${max}. That is not one block: `
      + 'lime the acid corner on its own rate and re-test it separately, or the average hides it.');
  }
  if (mean >= gate.min && min < gate.min) {
    warnings.push(`The average passes at ${mean} but one point read ${min}, which is below the `
      + `${gate.min} gate. Plants in that corner will meet ${min}, not ${mean}.`);
  }

  const common = { reading, texture: tex, areaM2, zoneType, warnings, gateMin: gate.min, gateMax: gate.max,
    treatArea: gate.treat_area, doNotBuy: lime.do_not_buy || [], fallback: lime.fallback };

  // --- Above the gate: lime is the wrong tool entirely --------------------
  if (mean > gate.max) {
    return { ok: true, ...common, band: 'above-max', route: null, action: 'no-lime',
      headline: `pH ${mean.toFixed(2)} is above the ${gate.max} limit. Do not lime.`,
      detail: 'Liming pushes it further out. Bring it down with sulphur or organic matter, then re-test.',
      steps: [], locks: [] };
  }

  // --- In range: nothing to do -------------------------------------------
  if (mean >= gate.min) {
    return { ok: true, ...common, band: 'in-range', route: null, action: 'no-lime',
      headline: `pH ${mean.toFixed(2)} is inside ${gate.min}–${gate.max}. No lime needed.`,
      detail: 'Record the reading with the meter photo and the pH gate opens.',
      steps: [], locks: [] };
  }

  // --- 5.2 to 5.49: HELD, and the answer is a date ------------------------
  if (mean >= 5.2) {
    const heldDays = holdSince ? daysBetween(holdSince, today) : null;
    const retestOn = isoDate(addDays(holdSince || today, 10));

    if (!holdSince || heldDays < 10) {
      return { ok: true, ...common, band: 'hold', route: null, action: 'hold',
        headline: `pH ${mean.toFixed(2)}. Hold this block and re-test in 10 days.`,
        detail: gate['5_2_to_5_49'],
        holdUntil: retestOn,
        retestOn,
        blocksTransplant: true,
        steps: [
          holdSince
            ? `Keep holding. The re-test falls on ${retestOn} (${10 - heldDays} day${10 - heldDays === 1 ? '' : 's'} to go).`
            : `Put the block on hold today and re-test on ${retestOn}.`,
          'Do not add lime now. Route A lime from the start of solarisation may still be reacting, '
            + 'and a dose on top of a dose overshoots.',
          'Re-test the same three points, with the meter calibrated that morning, and photograph it.',
        ],
        locks: [] };
    }

    // The hold ran its ten days and the block is still under 5.5, so the
    // schedule allows a quarter of the ORIGINAL rate — not a quarter of a
    // fresh full dose.
    const quarter = doseFor({ lime, tex, areaM2, solarised, transplantDate, lastLime, fraction: 0.25 });
    return { ok: true, ...common, band: 'hold-expired', action: 'quarter-rate',
      ...quarter,
      headline: `pH ${mean.toFixed(2)} after a 10-day hold. Apply one quarter of the original rate.`,
      detail: gate['5_2_to_5_49'],
      approval: 'Farm Doctor checks the plan; the Owner approves it before it goes on.',
      retestOn: isoDate(addDays(today, 10)),
      blocksTransplant: true,
      steps: [
        `Apply ${quarter.kgText} — one quarter of the original rate, not a new full dose.`,
        'Wait 10 days.',
        `Re-test the same three points on ${isoDate(addDays(today, 10))}.`,
      ],
      locks: locksFor({ lime, route: quarter.route, limeDate: limeDate || today, transplantDate }) };
  }

  // --- Below 5.2 ----------------------------------------------------------
  const first = !lastLime;
  const dose = doseFor({ lime, tex, areaM2, solarised, transplantDate, lastLime,
    fraction: first ? 1 : 0.5 });

  return {
    ok: true,
    ...common,
    band: 'below-5-2',
    action: first ? 'full-rate' : 'half-rate',
    ...dose,
    headline: first
      ? `pH ${mean.toFixed(2)}. Route ${dose.route}: ${dose.kgText} of ${dose.product}.`
      : `pH ${mean.toFixed(2)} after liming. Apply HALF the original rate again and add 10 days.`,
    detail: first ? (dose.timing || dose.when) : gate.below_5_2,
    blocksTransplant: true,
    retestOn: isoDate(addDays(limeDate || today, first ? 28 : 10)),
    steps: first
      ? [
        `Spread ${dose.kgText} of ${dose.product} over the ${treatAreaText(zoneType, gate)}.`,
        dose.timing || 'Incorporate and irrigate.',
        `Re-test the three points before transplant, after the lime has worked in.`,
      ]
      : [
        `Apply ${dose.kgText} — half the original rate. Never stack a second full dose.`,
        'Add 10 days to the schedule.',
        `Re-test the same three points on ${isoDate(addDays(limeDate || today, 10))}.`,
      ],
    locks: locksFor({ lime, route: dose.route, limeDate: limeDate || today, transplantDate }),
  };
}

/**
 * Lime for a plant-bag batch — by media volume, not bed area (C-19).
 *
 * The rules give lime per 100 m² of bed, worked into 15–20 cm. A heap of bag
 * media has no bed area, so the rate is carried over through that depth: kg
 * per m³ = kg per 100 m² ÷ (100 m² × depth). The low end is the low rate over
 * the deeper 20 cm and the high end the high rate over 15 cm, so the range
 * covers what the table covers. Only Route A states a depth; Route B does not,
 * so a covered heap has no rate to derive.
 *
 * Where no rate can be derived the answer is `derivable: false` with the
 * reason, and the batch is corrected or rejected before any bag is filled. It
 * never falls back to a guess (FR-DOC-08).
 */
function mediaLimePlan({
  readings = [], texture = null, volumeM3 = 0, covered = false, lastLime = null, holdSince = null,
  today = isoDate(),
} = {}) {
  const spec = (rules().plant_bags || {}).lime || {};
  const depth = spec.incorporation_depth_m || {};
  const volume = Number(volumeM3) || 0;
  const cannot = (reason, why, fix) => ({
    ok: false, derivable: false, reason, why, fix,
    rule: spec.no_rate || 'No rate can be derived: correct the batch or reject it before filling.',
  });

  // The table's rate, never a rate someone recorded per 100 m² of bed.
  const ask = (tex) => limePlan({ readings, texture: tex, areaM2: 100, zoneType: 'bag', solarised: false,
    lastLime: lastLime ? {} : null, holdSince, today });
  const plan = ask(texture);
  if (!plan.ok && plan.reason === 'three-points') return { ...plan, derivable: false };
  // In range, above range or on hold: no lime goes on, so there is no rate to
  // derive, whatever the media is. The band does not depend on the texture.
  const band = plan.ok ? plan : ask(TEXTURES[0].id);
  if (band.ok && !band.kgText) {
    return { ...band, texture: textureFor(texture), derivable: true, basis: 'volume', noLime: true };
  }

  if (!plan.ok || !textureFor(texture)) {
    return cannot('no-texture',
      `The batch's media${texture ? ` (${texture})` : ''} is not one of the textures in the lime table `
        + `(${TEXTURES.map((t) => t.rulesKey).join(', ')}), so no rate per m³ can be derived.`,
      'Correct the batch: record which of the three textures it is, re-mix it to one, or reject it.');
  }
  if (covered) {
    return cannot('route-b',
      'The heap has been under solarisation plastic, which puts it on Route B, and Route B gives no '
        + 'incorporation depth, so no rate per m³ can be derived.',
      'Correct the batch (re-test after it has settled, or re-mix it with clean media) or reject it.');
  }
  if (!(volume > 0)) {
    return cannot('no-volume', 'The batch has no volume recorded, so the kilograms for it cannot be worked out.',
      'Correct the batch: record its volume in m³.');
  }
  if (!(depth.min > 0 && depth.max >= depth.min)) {
    return cannot('no-depth', 'The rules give no incorporation depth, so no rate per m³ can be derived.',
      'Correct the rules file before liming any batch.');
  }

  const perM3Low = round(plan.ratePer100Low / (100 * depth.max), 2);
  const perM3High = round(plan.ratePer100High / (100 * depth.min), 2);
  const kgLow = round(perM3Low * volume, 1);
  const kgHigh = round(perM3High * volume, 1);
  const kgText = kgLow === kgHigh ? `${kgLow} kg` : `${kgLow}–${kgHigh} kg`;
  const fractionText = plan.fraction === 1 ? '' : plan.fraction === 0.5 ? ' (half the original rate)'
    : ' (one quarter of the original rate)';
  return {
    ...plan,
    derivable: true,
    basis: 'volume',
    volumeM3: volume,
    perM3Low,
    perM3High,
    kgLow,
    kgHigh,
    kgText,
    headline: `pH ${plan.reading.mean.toFixed(2)}. Mix ${kgText} of ${plan.product} through the `
      + `${volume} m³ batch${fractionText}, before any bag is filled.`,
    steps: [
      `Mix ${kgText} of ${plan.product} through the whole heap — ${perM3Low}–${perM3High} kg per m³, `
        + 'the Route A rate carried over its 15–20 cm depth.',
      spec.after || 'Re-test the batch at three points after the lime has worked in.',
      'No bag is filled from this batch until the re-test passes.',
    ],
    derivation: spec.derivation || null,
  };
}

function treatAreaText(zoneType, gate) {
  if (zoneType === 'bag') return 'whole batch heap, mixed through before filling';
  return zoneType === 'greenhouse'
    ? 'bed area only (not the paths)'
    : 'full cropped area';
}

/** Route, product and kilograms, at whatever fraction of the rate applies. */
function doseFor({ lime, tex, areaM2, solarised, transplantDate, lastLime, fraction = 1 }) {
  // Route A is for a block not yet under solarisation plastic; Route B is for
  // one already solarised with transplant less than three weeks out.
  const route = solarised ? 'B' : 'A';
  const spec = route === 'B' ? lime.route_B : lime.route_A;
  const range = rateRange(spec.rates_per_100m2_kg[tex.rulesKey]);
  const hundreds = (Number(areaM2) || 0) / 100;

  // "Original rate" means the rate that actually went on, when one is on
  // record. Falling back to the table keeps the sum honest when it is not.
  const base = lastLime && lastLime.ratePer100Low
    ? { low: Number(lastLime.ratePer100Low), high: Number(lastLime.ratePer100High || lastLime.ratePer100Low) }
    : range;

  const low = round(base.low * hundreds * fraction, 1);
  const high = round(base.high * hundreds * fraction, 1);

  return {
    route,
    product: spec.product,
    when: spec.when,
    timing: spec.timing || null,
    note: spec.note || null,
    targetPh: spec.target_ph || null,
    ratePer100Low: round(base.low * fraction, 2),
    ratePer100High: round(base.high * fraction, 2),
    fraction,
    kgLow: low,
    kgHigh: high,
    kgText: low === high ? `${low} kg` : `${low}–${high} kg`,
    transplantWaitDays: spec.transplant_wait_days || null,
    nitrogenBlackoutDays: spec.nitrogen_blackout_days || null,
    substitute: spec.substitute || null,
  };
}

/**
 * The timing locks. These are the part people skip.
 *
 * Neem cake inside ten days of lime loses most of its nitrogen to the lime,
 * and urea inside twenty-one days of it gases off as ammonia — you pay for a
 * bag of fertiliser and get a smell. Route B adds two more: nothing is
 * transplanted for fourteen days after hydrated lime, and nitrogen stays off
 * for twenty-one, with Calcium Nitrate standing in for the Week 1 and Week 2
 * NPK.
 */
function locksFor({ lime, route, limeDate, transplantDate = null }) {
  const from = limeDate || isoDate();
  const locks = [
    {
      id: 'neem-cake',
      days: lime.neem_cake_gap_days,
      notBefore: isoDate(addDays(from, lime.neem_cake_gap_days)),
      rule: lime.neem_cake_rule,
      text: `Neem cake goes in no earlier than ${isoDate(addDays(from, lime.neem_cake_gap_days))} — `
        + `${lime.neem_cake_gap_days} days after the lime. On Route A that falls out naturally: `
        + 'lime at T-35 to T-28, neem cake at the plastic lift (T-7).',
    },
    {
      id: 'urea',
      days: lime.urea_after_lime_min_days,
      notBefore: isoDate(addDays(from, lime.urea_after_lime_min_days)),
      text: `No urea until ${isoDate(addDays(from, lime.urea_after_lime_min_days))} — `
        + `${lime.urea_after_lime_min_days} days after the lime, or it gases off as ammonia and you have `
        + 'bought nothing. Urea in the planting hole is deleted (Rev 5.1) either way.',
    },
  ];

  if (route === 'B') {
    const b = lime.route_B;
    locks.push({
      id: 'transplant',
      days: b.transplant_wait_days,
      notBefore: isoDate(addDays(from, b.transplant_wait_days)),
      text: `Nothing is transplanted before ${isoDate(addDays(from, b.transplant_wait_days))} — `
        + `${b.transplant_wait_days} days after hydrated lime. This is part of Gate 1.`,
    });
    locks.push({
      id: 'nitrogen',
      days: b.nitrogen_blackout_days,
      notBefore: isoDate(addDays(from, b.nitrogen_blackout_days)),
      text: `Nitrogen blackout to ${isoDate(addDays(from, b.nitrogen_blackout_days))}. ${b.substitute}`,
    });
  }

  if (transplantDate) {
    for (const lock of locks) {
      if (lock.id === 'transplant') continue;
      lock.clashesWithTransplant = lock.notBefore > transplantDate;
    }
  }

  return locks;
}
})(__dvModule("web/js/domain/calc.js"));
__dvBindAll();

// ─── web/js/domain/gates.js ────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "GATE_RULES": { enumerable: true, get: () => GATE_RULES },
  "GATE_STATE": { enumerable: true, get: () => GATE_STATE },
  "isBlocking": { enumerable: true, get: () => isBlocking },
  "zoneWindow": { enumerable: true, get: () => zoneWindow },
  "latestSoilTest": { enumerable: true, get: () => latestSoilTest },
  "phGate": { enumerable: true, get: () => phGate },
  "nematodeGate": { enumerable: true, get: () => nematodeGate },
  "batchGate": { enumerable: true, get: () => batchGate },
  "batchTested": { enumerable: true, get: () => batchTested },
  "canAssignBatch": { enumerable: true, get: () => canAssignBatch },
  "BAG_G0_ITEMS": { enumerable: true, get: () => BAG_G0_ITEMS },
  "bagG0Label": { enumerable: true, get: () => bagG0Label },
  "batchLines": { enumerable: true, get: () => batchLines },
  "fillCheck": { enumerable: true, get: () => fillCheck },
  "barrierGate": { enumerable: true, get: () => barrierGate },
  "bagG0": { enumerable: true, get: () => bagG0 },
  "gateSignoff": { enumerable: true, get: () => gateSignoff },
  "latestEvidence": { enumerable: true, get: () => latestEvidence },
  "gateModel": { enumerable: true, get: () => gateModel },
  "gatesForZone": { enumerable: true, get: () => gatesForZone },
  "canPlant": { enumerable: true, get: () => canPlant },
  "canTreat": { enumerable: true, get: () => canTreat },
  "expiredOnly": { enumerable: true, get: () => expiredOnly },
  "rotationCheck": { enumerable: true, get: () => rotationCheck },
  "gateBoard": { enumerable: true, get: () => gateBoard },
});
let addDays, daysBetween, isoDate;
let gateSpec, peekRules;
let rotationVerdict;
let alerts;
let GATE_ITEMS, gateItem, stockOf;
let isNursery, protocolOf;
let releasedFor;
let BARRIERS, bagRules, batchFailure, batchName, batchesIn, fillsFor, galledCycle, mediaOf;
let mediaLimePlan;
let approvalStanding, awaitingApproval, beforeApprovalCheck, roleTitle, treatable;
let PRE_GATES, PRE_GATES_LABEL, plantedBeforeGates, preGatesEvidence, treatmentHistoryBlock;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/rules.js", (m) => { gateSpec = m.gateSpec; }, (m) => { peekRules = m.peekRules; });
__dvImport("web/js/domain/rotation.js", (m) => { rotationVerdict = m.rotationVerdict; });
__dvImport("web/js/domain/alerts.js", (m) => { alerts = m.alerts; });
__dvImport("web/js/domain/doctor.js", (m) => { GATE_ITEMS = m.GATE_ITEMS; }, (m) => { gateItem = m.gateItem; }, (m) => { stockOf = m.stockOf; });
__dvImport("web/js/domain/farm.js", (m) => { isNursery = m.isNursery; }, (m) => { protocolOf = m.protocolOf; });
__dvImport("web/js/domain/nursery.js", (m) => { releasedFor = m.releasedFor; });
__dvImport("web/js/domain/media.js", (m) => { BARRIERS = m.BARRIERS; }, (m) => { bagRules = m.bagRules; }, (m) => { batchFailure = m.batchFailure; }, (m) => { batchName = m.batchName; }, (m) => { batchesIn = m.batchesIn; }, (m) => { fillsFor = m.fillsFor; }, (m) => { galledCycle = m.galledCycle; }, (m) => { mediaOf = m.mediaOf; });
__dvImport("web/js/domain/calc.js", (m) => { mediaLimePlan = m.mediaLimePlan; });
__dvImport("web/js/domain/selfcheck.js", (m) => { approvalStanding = m.approvalStanding; }, (m) => { awaitingApproval = m.awaitingApproval; }, (m) => { beforeApprovalCheck = m.beforeApprovalCheck; }, (m) => { roleTitle = m.roleTitle; }, (m) => { treatable = m.treatable; });
__dvImport("web/js/domain/onboarding.js", (m) => { PRE_GATES = m.PRE_GATES; }, (m) => { PRE_GATES_LABEL = m.PRE_GATES_LABEL; }, (m) => { plantedBeforeGates = m.plantedBeforeGates; }, (m) => { preGatesEvidence = m.preGatesEvidence; }, (m) => { treatmentHistoryBlock = m.treatmentHistoryBlock; });
// Gates: the rules that stop a wrong action before it happens.
//
// Section 6.2 of the requirements calls these the most important part of the
// app, and the reason is in section 1. Season 1 was not lost because nobody
// wrote things down. It was lost because planting went into untested soil and
// treatment went in by guesswork. A record of either would have been a perfect
// account of a failure. A gate would have been the failure not happening.
//
// So the test for everything here is narrow and harsh: does it BLOCK, or does
// it merely warn? A gate that can be clicked past is a label.
//
// Three rules hold this file together.
//
//   1. A gate is a pure function of recorded facts. No gate reads a setting
//      that a person can quietly relax, except the Owner's explicit override,
//      which is itself a record with a reason attached.
//   2. Unknown is not pass. A zone with no soil test is blocked exactly as
//      hard as a zone with a failing one, because "we never checked" is how
//      Season 1 started.
//   3. Every block says the fix. A gate that says no without saying what would
//      make it yes gets overridden, and then gates stop meaning anything.
//
// THE MODEL
//
// FR-GATE-06 asks for Gate 0 to Gate 4 from the rules, each with its pass
// conditions and its evidence, on one screen per zone — plus the clean-restart
// protocol for GH-04 and GH-05. gateModel() below is that model. Each gate is
// the rules' own entry (name, when, pass_all, evidence, source), and each
// pass_all line is a condition judged from records. The gates that stop a
// transplant (G0, the clean restart, G1, and G4 of the previous cycle) are what
// canPlant() reads; G2 and G3 are shown with their state, and G3 is the
// treatment gate canTreat() enforces.













/**
 * Gate thresholds.
 *
 * pH 5.5–7.0 and the 5.2 hold line are the rules' soil_ph_gate (C-5). The
 * 90-day freshness window is FR-GATE-01 (requirements v1.5): soil and pH
 * results must be sampled after the previous cycle in the zone ended and no
 * more than 90 days before transplant. It applies to the nematode assay as
 * well as the pH, because the requirement names both.
 */
const GATE_RULES = {
  phMin: 5.5,
  phMax: 7.0,
  phHoldBelow: 5.2,
  holdRetestDays: 10,
  threePoints: 3,
  soilTestMaxAgeDays: 90,
  nematodeMaxAgeDays: 90,
};

const GATE_STATE = {
  pass: { label: 'Clear', tone: 'ok', icon: '✓' },
  fail: { label: 'Blocked', tone: 'danger', icon: '✕' },
  unknown: { label: 'Not tested', tone: 'danger', icon: '✕' },
  held: { label: 'Held', tone: 'warn', icon: '!' },
  overridden: { label: 'Overridden', tone: 'warn', icon: '!' },
  waiting: { label: 'Not yet', tone: 'muted', icon: '·' },
  na: { label: 'Not applicable', tone: 'muted', icon: '·' },
  // FR-ONB-06: the crop went in before the app existed. Not a pass and not a
  // violation — there was no gate to pass on the day it was planted.
  [PRE_GATES]: { label: PRE_GATES_LABEL, tone: 'muted', icon: '·' },
};

/** States that let an action through. Everything else blocks. */
const OPEN = new Set(['pass', 'overridden', 'waiting', 'na', PRE_GATES]);
const isBlocking = (condition) => !OPEN.has(condition.state);

/** Ranks, mirroring web/js/store.js. Used to check who signed what. */
const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOfId = (state, id) => {
  const p = ((state && state.people) || {})[id];
  return (p && RANK[p.role]) || 0;
};

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

/**
 * The day a gate is being asked about, and the window its evidence must sit in.
 *
 * FR-GATE-01 puts a freshness window on the soil test, but the window is a
 * condition on *planting*, not a clock that keeps running afterwards. Judged
 * against today, a bed correctly cleared before transplant turns red ninety
 * days later and the app starts re-blocking ground that passed its checks —
 * which teaches people the red means nothing.
 *
 * So for a zone with a crop in it, the question is "was this true when the
 * crop went in?", and the answer never changes again. For an empty zone it is
 * "is it true now?", which is the decision actually in front of someone.
 *
 * `since` is the day the previous cycle in the zone ended. Evidence from
 * before it describes the last crop's ground, not this one's.
 */
function zoneWindow(state, zoneId, today = isoDate()) {
  const cycles = Object.values((state && state.cycles) || {}).filter((c) => c.plotId === zoneId);
  const active = cycles
    .filter((c) => c.status === 'active')
    .sort((a, b) => ((a.transplantDate || '') < (b.transplantDate || '') ? 1 : -1))[0] || null;
  const judged = (active && active.transplantDate) || today;
  const previous = cycles
    .filter((c) => c !== active && c.status === 'closed' && c.closedAt && c.closedAt <= judged)
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))[0] || null;
  return { today, judged, active, previous, since: previous ? previous.closedAt : null };
}

function gate(id, name, state, extra = {}) {
  return { id, name, state, why: '', fix: null, ...extra };
}

// --- FR-GATE-01 — the pH gate ------------------------------------------------

const readingsOf = (t) => (Array.isArray(t.readings) ? t.readings.map(Number).filter(Number.isFinite) : []);
const pointsOf = (t) => readingsOf(t).length || Number(t.points) || 0;
const lowOf = (t) => (readingsOf(t).length ? Math.min(...readingsOf(t)) : Number(t.ph));
const highOf = (t) => (readingsOf(t).length ? Math.max(...readingsOf(t)) : Number(t.ph));

/** The most recent soil test for a zone, or for the topsoil batch filling it. */
function latestSoilTest(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;

  const mine = (state.soilTests || [])
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return mine[0] || null;
}

function phText(key) {
  const g = ((peekRules() || {}).soil_and_water || {}).soil_ph_gate || {};
  return g[key] || '';
}

/**
 * FR-GATE-01 — the pH gate.
 *
 * A reading opens it only when all of this is true:
 *
 *   - it was sampled after the previous cycle here ended, and no more than 90
 *     days before transplant;
 *   - it was taken after any lime correction;
 *   - it is a three-point test, from a meter calibrated that morning at pH 4.0
 *     and 7.0, with a photo of the meter (rules → soil_ph_gate.test, Gate 0);
 *   - every one of the three points is inside 5.5–7.0. A mean can hide an
 *     acid corner, so the lowest point decides the hold and the highest point
 *     decides the upper limit;
 *   - it is not a re-test taken inside the 10-day hold after a low reading.
 *
 * Below 5.2 and 5.2–5.49 are the two hold rules (C-5), and each says what to
 * do in the rules' own words.
 */
function phGate(state, zoneId, { today = isoDate() } = {}) {
  const w = zoneWindow(state, zoneId, today);
  if (mediaOf(state, zoneId, w.active) === 'bag') return bagGate(state, zoneId, w, 'ph');
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  const tests = (state.soilTests || [])
    .filter((t) => t.ph != null && t.ph !== '')
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= w.judged)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return judgePh(tests, {
    judged: w.judged,
    since: w.since,
    none: {
      why: 'No pH reading has been recorded for this zone.',
      fix: 'Take a three-point pH test and record it under Soil tests. Planting stays blocked until then.',
    },
    early: (test) => (w.since && test.zoneId === zoneId && test.date <= w.since ? {
      why: `The last pH reading (${test.date}) was taken before the previous cycle here ended on ${w.since}.`,
      fix: 'Re-sample. FR-GATE-01: the pH must be sampled after the last cycle in this zone ended.',
    } : null),
  });
}

/**
 * The pH judgement itself, on the tests for one place, newest first. The bed
 * and a plant-bag media batch are judged by exactly the same rules; only what
 * counts as "too early" and the words for the fix differ. `lowFix` lets a
 * batch replace the bed's lime advice with lime by media volume.
 */
function judgePh(tests, { judged, since = null, none, early, lowFix = null }) {
  const name = 'Soil pH tested';
  const test = tests[0];

  if (!test) return gate('ph', name, 'unknown', none);

  const tooEarly = early(test);
  if (tooEarly) return gate('ph', name, 'fail', { ...tooEarly, test });

  const age = daysBetween(test.date, judged);
  if (age > GATE_RULES.soilTestMaxAgeDays) {
    return gate('ph', name, 'fail', {
      why: `The last pH reading is ${age} days old (${test.ph} on ${test.date}).`,
      fix: `Re-test. A reading older than ${GATE_RULES.soilTestMaxAgeDays} days does not describe this soil any more.`,
      test,
    });
  }

  if (test.beforeCorrection) {
    return gate('ph', name, 'fail', {
      why: `The reading of ${test.ph} was taken before lime was applied, so it does not say where the soil is now.`,
      fix: 'Re-test after the lime has worked in and record that reading.',
      test,
    });
  }

  const points = pointsOf(test);
  if (points < GATE_RULES.threePoints) {
    return gate('ph', name, 'fail', {
      why: `pH ${test.ph} on ${test.date} is from ${points || 'an unrecorded number of'} sampling point${points === 1 ? '' : 's'}.`,
      fix: `Gate 0 asks for a three-point test: ${phText('test') || 'three points per block'}. Record all three readings.`,
      test,
    });
  }
  if (!test.calibrated) {
    return gate('ph', name, 'fail', {
      why: `The three-point reading on ${test.date} does not record the meter being calibrated that morning.`,
      fix: 'Calibrate the meter at pH 4.0 and 7.0 on the morning of the test, then re-test and tick it on the record.',
      test,
    });
  }
  if (!test.photo) {
    return gate('ph', name, 'fail', {
      why: `The three-point reading on ${test.date} has no photo of the meter.`,
      fix: 'Gate 0 wants the meter photo on file. Re-test and photograph the reading.',
      test,
    });
  }

  const low = lowOf(test);
  const high = highOf(test);
  const retestFrom = isoDate(addDays(test.date, GATE_RULES.holdRetestDays));
  const shown = readingsOf(test).length ? readingsOf(test).join(', ') : String(test.ph);
  const lowered = (verdict) => (lowFix ? { ...verdict, ...lowFix(verdict, test, tests) } : verdict);

  if (low < GATE_RULES.phHoldBelow) {
    return lowered(gate('ph', name, 'fail', {
      hold: 'below_5_2',
      why: `pH ${low} (points ${shown}) is below ${GATE_RULES.phHoldBelow}.`,
      fix: `${phText('below_5_2') || 'Apply half the original lime rate again and wait 10 days.'} `
        + `Re-test no sooner than ${retestFrom}.`,
      retestFrom,
      test,
    }));
  }
  if (low < GATE_RULES.phMin) {
    return lowered(gate('ph', name, 'held', {
      hold: '5_2_to_5_49',
      why: `pH ${low} (points ${shown}) is between ${GATE_RULES.phHoldBelow} and ${GATE_RULES.phMin}: the block is held.`,
      fix: `${phText('5_2_to_5_49') || 'Hold; re-test after 10 days.'} Re-test on or after ${retestFrom}.`,
      retestFrom,
      test,
    }));
  }
  if (high > GATE_RULES.phMax) {
    return gate('ph', name, 'fail', {
      why: `pH ${high} (points ${shown}) is above ${GATE_RULES.phMax}, outside the ${GATE_RULES.phMin}–${GATE_RULES.phMax} range peppers need.`,
      fix: 'Bring it down with sulphur or organic matter, then re-test and record the corrected reading.',
      test,
    });
  }

  // The hold is a wait, not only a number: a passing re-test taken inside the
  // ten days after a low reading has not waited out the hold.
  const heldBy = tests.slice(1).find((t) => (!since || t.date > since)
    && lowOf(t) < GATE_RULES.phMin && daysBetween(t.date, test.date) < GATE_RULES.holdRetestDays);
  if (heldBy) {
    const from = isoDate(addDays(heldBy.date, GATE_RULES.holdRetestDays));
    return gate('ph', name, 'held', {
      hold: 'retest_too_soon',
      why: `pH ${low} on ${test.date} is in range, but only ${daysBetween(heldBy.date, test.date)} days after `
        + `the reading of ${lowOf(heldBy)} on ${heldBy.date} that put the block on hold.`,
      fix: `The hold is re-tested after ${GATE_RULES.holdRetestDays} days. Re-test on or after ${from}.`,
      retestFrom: from,
      test,
    });
  }

  return gate('ph', name, 'pass', {
    why: `pH ${shown} from ${points} points, recorded ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
    test,
  });
}

/**
 * FR-GATE-02 — the nematode gate.
 *
 * This is the one that cost Season 1. Root-knot nematode is invisible until the
 * plants are already failing, and by then the ground is the problem, not the
 * crop. Nothing goes in without a clean lab result on the record — Gate 0 asks
 * for a lab report, so a clean result must say which lab gave it.
 */
function nematodeGate(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  const w = zoneWindow(state, zoneId, today);
  if (mediaOf(state, zoneId, w.active) === 'bag') return bagGate(state, zoneId, w, 'nematode');
  const name = 'Nematode clear';

  const tests = (state.soilTests || [])
    .filter((t) => t.nematode)
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= w.judged)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const test = tests[0];
  if (!test) {
    return gate('nematode', name, 'unknown', {
      why: 'No nematode test has been recorded for this zone or for the topsoil in it.',
      fix: 'Send a soil sample for a nematode test and record the result. This is the check Season 1 was lost for.',
    });
  }

  if (w.since && test.zoneId === zoneId && test.date <= w.since) {
    return gate('nematode', name, 'fail', {
      why: `The last nematode result (${test.date}) is from before the previous cycle here ended on ${w.since}.`,
      fix: 'Re-sample. FR-GATE-01: soil results must be sampled after the last cycle in this zone ended.',
      test,
    });
  }

  const age = daysBetween(test.date, w.judged);
  if (age > GATE_RULES.nematodeMaxAgeDays) {
    return gate('nematode', name, 'fail', {
      why: `The clean result is ${age} days old (${test.date}).`,
      fix: `Re-test. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers this ground.`,
      test,
    });
  }

  if (test.nematode !== 'clean') {
    return gate('nematode', name, 'fail', {
      why: `The test on ${test.date} came back ${test.nematode}.`,
      fix: 'Do not plant peppers here. Solarise or rotate to a non-host — maize or a resistant cover — '
        + 'and re-test before this zone carries a crop again.',
      test,
    });
  }

  if (!String(test.lab || '').trim()) {
    return gate('nematode', name, 'fail', {
      why: `The clean result on ${test.date} does not name the lab that gave it.`,
      fix: 'Record which lab tested it and keep the report. Gate 0 asks for a lab report, not a note.',
      test,
    });
  }

  return gate('nematode', name, 'pass', {
    why: `${test.lab} returned clean ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
    test,
  });
}

/**
 * FR-GATE-03 — purchased topsoil.
 *
 * A delivery is a batch until somebody tests it. Bought-in soil is the fastest
 * way to move a nematode population onto clean ground, so an untested batch
 * cannot be assigned to a zone at all.
 */
function batchGate(state, zoneId) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  if (!batchId) {
    return gate('topsoil', 'Topsoil tested', 'pass', {
      why: 'No purchased topsoil in this zone — nothing to clear.',
    });
  }
  const tested = batchTested(state, batchId);
  if (!tested.batch) {
    return gate('topsoil', 'Topsoil tested', 'unknown', {
      why: 'This zone names a topsoil batch that is not on record.',
      fix: tested.fix,
    });
  }
  return gate('topsoil', 'Topsoil tested', tested.ok ? 'pass' : 'fail', {
    why: tested.why, ...(tested.fix ? { fix: tested.fix } : {}), batch: tested.batch,
  });
}

/**
 * FR-GATE-03 — has this delivery a clean result from a named lab?
 *
 * `today`, when given, leaves out a result dated after it: a batch is judged
 * on what was known on the day somebody put it into a zone.
 */
function batchTested(state, batchId, { today = null } = {}) {
  const batch = ((state && state.topsoilBatches) || {})[batchId] || null;
  if (!batch) {
    return { ok: false, batch: null, why: 'That topsoil batch is not on record.',
      fix: 'Record the delivery under Topsoil, with its supplier and date, and test it.' };
  }
  const clean = ((state && state.soilTests) || [])
    .filter((t) => t.batchId === batchId && t.nematode === 'clean' && (!today || !t.date || t.date <= today));
  if (!clean.length) {
    return { ok: false, batch,
      why: `Batch from ${batch.supplier || 'an unnamed supplier'} (${batch.date || 'no date'}) has no clean test.`,
      fix: 'Test the batch before anything is planted into it. An untested load can carry nematodes '
        + 'straight into a clean house.' };
  }
  if (!clean.some((t) => String(t.lab || '').trim())) {
    return { ok: false, batch,
      why: `Batch from ${batch.supplier || 'an unnamed supplier'} tested clean, but no lab is named on the result.`,
      fix: 'Record which lab tested the batch. A clean result nobody can trace is not a lab report.' };
  }
  return { ok: true, batch, why: `Batch from ${batch.supplier || 'supplier not named'} tested clean.` };
}

/**
 * FR-GATE-03 — may this batch go into that zone? "Untested batches are marked
 * red and cannot be assigned to a zone." The delivery is logged with the zone
 * it is meant for; it goes in only once it has tested clean.
 */
function canAssignBatch(state, batchId, zoneId, { today = null } = {}) {
  const zone = ((state && state.plots) || {})[zoneId];
  if (!zone) return { ok: false, reason: 'no-zone', why: 'That zone is not on record.', fix: 'Choose a zone from the list.' };
  if (isNursery(zone)) {
    return { ok: false, reason: 'nursery', why: `${zone.name} is the nursery; bought-in topsoil goes into a cropping block.`,
      fix: 'Nursery media is sterilised, solarised or bought-in potting media, recorded under the nursery.' };
  }
  const tested = batchTested(state, batchId, { today });
  if (!tested.ok) {
    return { ok: false, reason: 'untested', batch: tested.batch,
      why: `${tested.why} An untested batch cannot be assigned to a zone (FR-GATE-03).`, fix: tested.fix };
  }
  return { ok: true, batch: tested.batch, zone };
}

// --- Plant-bag zones: Gate 0 clears on the media batch (C-19) -----------------

/** Rules → plant_bags.gate_0.pass_all, one label per bag-zone G0 line. */
const BAG_G0_ITEMS = ['media_batch', 'ph_three_point', 'lab_report', 'heap_solarisation', 'bag_barrier'];

function bagG0Label(itemId, rules = peekRules()) {
  const lines = ((bagRules(rules) || {}).gate_0 || {}).pass_all || [];
  return lines[BAG_G0_ITEMS.indexOf(itemId)] || itemId.replace(/_/g, ' ');
}

const batchTests = (state, batchId, judged, key) => (state.soilTests || [])
  .filter((t) => t.mediaBatchId === batchId)
  .filter((t) => (key === 'ph' ? t.ph != null && t.ph !== '' : !!t.nematode))
  .filter((t) => t.date && t.date <= judged)
  .sort((a, b) => (a.date < b.date ? 1 : -1));

/**
 * One media batch's own Gate 0 lines, as of a day: the record (supplier,
 * delivery date, not rejected, not failed), the three-point pH, the nematode
 * lab result, and the heap's solarisation dates if it was covered. These are
 * what filling a bag from the batch needs (rules → plant_bags.fill_rule), and
 * what a bag zone's Gate 0 reads for every batch in its bags.
 */
function batchLines(state, batchId, { judged = isoDate() } = {}) {
  const batch = ((state && state.mediaBatches) || {})[batchId] || null;
  const who = batchName(batch);
  if (!batch) {
    const missing = gate('media_batch', 'Media batch', 'unknown', {
      why: 'The bags name a media batch that is not on record.',
      fix: 'Record the delivery as a media batch, with its supplier and date, and test it.',
    });
    return { batch: null, record: missing, ph: missing, nematode: missing, heap: missing };
  }
  const delivered = batch.deliveredDate || null;

  // The record.
  let record;
  const failure = batchFailure(state, batchId);
  if (batch.rejected) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} was rejected on ${batch.rejected.date}: ${batch.rejected.reason}.`,
      fix: 'A rejected batch fills no bags. Empty any bags filled from it and fill them from a batch that has cleared.',
      batch,
    });
  } else if (failure && failure.date <= judged) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} failed on ${failure.date}: ${failure.why}.`,
      fix: 'Empty and discard the bags filled from it. Refill from a batch that has cleared Gate 0.',
      batch, failure,
    });
  } else if (!String(batch.supplier || '').trim() || !delivered) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} does not record ${!String(batch.supplier || '').trim() ? 'its supplier' : 'its delivery date'}.`,
      fix: 'Correct the batch record: the supplier and the day it was delivered. A batch nobody can trace is not cleared.',
      batch,
    });
  } else {
    record = gate('media_batch', 'Media batch', 'pass', {
      why: `${who}: ${batch.supplier}, delivered ${delivered}${batch.volumeM3 ? `, ${batch.volumeM3} m³` : ''}.`,
      batch,
    });
  }

  // The pH, judged by the same rules as a bed, with lime by media volume.
  const phTests = batchTests(state, batchId, judged, 'ph');
  const ph = judgePh(phTests, {
    judged,
    none: {
      why: `No pH reading has been recorded for ${who}.`,
      fix: 'Take a three-point pH test of the batch and record it against the batch. No bag is filled until then.',
    },
    early: (test) => (delivered && test.date < delivered ? {
      why: `The last pH reading of ${who} (${test.date}) is from before it was delivered on ${delivered}.`,
      fix: 'Re-test the batch as delivered, at three points.',
    } : null),
    lowFix: (verdict, test, all) => batchLimeFix(batch, verdict, test, all, judged),
  });

  // The nematode lab result.
  let nematode;
  const nt = batchTests(state, batchId, judged, 'nematode')[0];
  if (!nt) {
    nematode = gate('nematode', 'Nematode clear', 'unknown', {
      why: `No nematode test has been recorded for ${who}.`,
      fix: 'Send a sample of the batch for a nematode assay and record the result against the batch.',
    });
  } else if (delivered && nt.date < delivered) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The nematode result for ${who} (${nt.date}) is from before it was delivered on ${delivered}.`,
      fix: 'Sample the batch as delivered and send it to the lab.', test: nt,
    });
  } else if (daysBetween(nt.date, judged) > GATE_RULES.nematodeMaxAgeDays) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The clean result for ${who} is ${daysBetween(nt.date, judged)} days old (${nt.date}).`,
      fix: `Re-test. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers this media.`, test: nt,
    });
  } else if (nt.nematode !== 'clean') {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The test of ${who} on ${nt.date} came back ${nt.nematode}.`,
      fix: 'Reject the batch. Media carrying nematodes goes into no bag on this farm.', test: nt,
    });
  } else if (!String(nt.lab || '').trim()) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The clean result for ${who} on ${nt.date} does not name the lab that gave it.`,
      fix: 'Record which lab tested it and keep the report. Gate 0 asks for a lab report, not a note.', test: nt,
    });
  } else {
    const age = daysBetween(nt.date, judged);
    nematode = gate('nematode', 'Nematode clear', 'pass', {
      why: `${nt.lab} returned ${who} clean ${nt.date}${age ? ` (${age} days ago)` : ' today'}.`, test: nt,
    });
  }

  // The heap's solarisation dates, if it was covered.
  let heap;
  if (!batch.covered) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'pass', {
      why: `${who}: the heap was not covered, so there are no solarisation dates to record.`,
    });
  } else if (!batch.coverFrom) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'fail', {
      why: `${who} was covered but the day the plastic went on is not recorded.`,
      fix: 'Correct the batch record: the day the plastic went on and the day it was lifted.',
    });
  } else if (!batch.coverTo || batch.coverTo > judged) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'held', {
      why: `${who} has been under plastic since ${batch.coverFrom}.`,
      fix: 'Record the day the plastic was lifted. Nothing is filled from a heap still under plastic.',
    });
  } else if (batch.coverTo < batch.coverFrom) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'fail', {
      why: `${who}: the plastic is recorded as lifted (${batch.coverTo}) before it went on (${batch.coverFrom}).`,
      fix: 'Correct the solarisation dates on the batch record.',
    });
  } else {
    heap = gate('heap_solarisation', 'Heap solarisation', 'pass', {
      why: `${who}: under plastic ${batch.coverFrom} to ${batch.coverTo} (${daysBetween(batch.coverFrom, batch.coverTo)} days).`,
    });
  }

  return { batch, record, ph, nematode, heap };
}

/**
 * Lime for a batch whose pH is low: by media volume, not bed area (C-19). When
 * no rate can be derived the batch is corrected or rejected — the gate says so
 * rather than passing on the bed's advice, which is written per 100 m².
 */
function batchLimeFix(batch, verdict, test, tests, judged) {
  const earlier = tests.slice(1).find((t) => lowOf(t) < GATE_RULES.phMin
    && daysBetween(t.date, test.date) >= GATE_RULES.holdRetestDays);
  let plan;
  try {
    plan = mediaLimePlan({
      readings: readingsOf(test), texture: batch.texture || null, volumeM3: batch.volumeM3,
      covered: !!batch.covered, lastLime: tests.some((t) => t.beforeCorrection) ? {} : null,
      holdSince: verdict.hold === '5_2_to_5_49' && earlier ? earlier.date : null, today: judged,
    });
  } catch (err) {
    plan = { derivable: false, why: 'The rules are not loaded, so no lime rate can be read.', fix: '' };
  }
  if (plan.noLime) return {};
  if (!plan.derivable) {
    return {
      state: 'fail',
      noRate: true,
      limePlan: plan,
      fix: `No lime rate can be derived for this batch: ${plan.why} ${plan.fix} `
        + 'The batch is corrected or rejected before any bag is filled from it.',
    };
  }
  return {
    limePlan: plan,
    fix: `${plan.headline} ${plan.steps.slice(1).join(' ')}`,
  };
}

/**
 * Rules → plant_bags.fill_rule: may bags be filled from this batch today? The
 * batch's own four lines must all pass. The reducer re-runs this on every
 * replay, so a phone cannot sync its way to a fill from an untested heap.
 */
function fillCheck(state, batchId, { date = isoDate() } = {}) {
  const lines = batchLines(state, batchId, { judged: date });
  const items = [lines.record, lines.ph, lines.nematode, lines.heap];
  const blocking = items.filter((c) => c.state !== 'pass');
  return {
    ok: blocking.length === 0,
    items,
    blocking,
    lines,
    why: blocking.length ? blocking.map((c) => `${c.why} ${c.fix || ''}`.trim()).join(' ') : null,
  };
}

/**
 * A bag zone's Gate 0 line, over every batch in its bags. The bags must have
 * been filled after the previous cycle here ended — media left in from the
 * last crop is the last crop's ground — and every batch in them must pass.
 */
function bagGate(state, zoneId, w, which) {
  const window = { since: w.since, until: w.judged };
  const batches = batchesIn(state, zoneId, window);
  const id = which === 'record' ? 'media_batch' : which === 'heap' ? 'heap_solarisation' : which;
  const name = { media_batch: 'Media batch', ph: 'Soil pH tested', nematode: 'Nematode clear',
    heap_solarisation: 'Heap solarisation' }[id];

  if (!batches.length) {
    const earlier = fillsFor(state, zoneId, { until: w.judged }).length;
    return gate(id, name, 'unknown', {
      why: earlier && w.since
        ? `The bags here were filled before the previous cycle ended on ${w.since}. That media grew the last crop.`
        : 'No bags have been filled here from a media batch, so there is no media to judge.',
      fix: 'Fill the bags from a media batch that has cleared its own checks (supplier, three-point pH, '
        + 'nematode CLEAR, heap dates if covered). The fill is recorded batch → bags → zone.',
    });
  }

  const judged = batches.map(({ id: batchId }) => batchLines(state, batchId, { judged: w.judged })[which]);
  const bad = judged.find((c) => c.state !== 'pass');
  if (bad) return { ...bad, id, name };
  return gate(id, name, 'pass', {
    why: judged.map((c) => c.why).join(' '),
    test: judged[0].test,
    batches: batches.map((b) => b.id),
  });
}

/** Rules → plant_bags.barrier: whether the bags stand on a barrier, recorded. */
function barrierGate(state, zoneId) {
  const zone = ((state && state.plots) || {})[zoneId] || {};
  const b = BARRIERS.find((x) => x.value === zone.barrier);
  if (!b) {
    return gate('bag_barrier', 'Bag barrier', 'unknown', {
      why: 'Whether the bags stand on a barrier is not recorded.',
      fix: 'Record it on the zone: ground cover, polythene, or none.',
    });
  }
  return gate('bag_barrier', 'Bag barrier', 'pass', {
    why: b.value === 'none'
      ? `${b.label}. ${((bagRules() || {}).barrier || {}).why || ''}`.trim()
      : `Bags stand on ${b.label.toLowerCase()}.`,
  });
}

/** Gate 0's media lines for a bag zone, for the model and the Farm Doctor. */
function bagG0(state, zoneId, { today = isoDate() } = {}) {
  const w = zoneWindow(state, zoneId, today);
  return {
    media_batch: bagGate(state, zoneId, w, 'record'),
    ph_three_point: bagGate(state, zoneId, w, 'ph'),
    lab_report: bagGate(state, zoneId, w, 'nematode'),
    heap_solarisation: bagGate(state, zoneId, w, 'heap'),
    bag_barrier: barrierGate(state, zoneId),
  };
}

/**
 * The clean restart in a bag zone (rules → plant_bags.clean_restart): step 3
 * is fresh or re-treated media rather than solarising a bed. Media left in the
 * bags from the last crop does not count, a re-treated batch says how it was
 * treated, and bags from a galled crop are discarded, not refilled.
 */
function freshMedia(state, zone, w, step) {
  const base = { id: `cr_${step.id}`, gate: 'CR', name: `Step ${step.step} — ${step.name}`, itemId: step.id,
    lines: step.pass_all || [] };
  const fills = fillsFor(state, zone.id, { since: w.since, until: w.judged });
  if (!fills.length) {
    return { ...base, state: 'unknown', why: 'No bags have been filled for this restart.',
      fix: `Fill the bags ${step.when}: ${(step.pass_all || []).join('; ')}.` };
  }
  const batches = state.mediaBatches || {};
  const galled = w.previous ? galledCycle(state, w.previous) : { galled: false };
  for (const f of fills) {
    const b = batches[f.batchId];
    const who = batchName(b);
    if (!b || !['fresh', 're-treated'].includes(b.source)) {
      return { ...base, state: 'fail', why: `${who} is not recorded as fresh or re-treated media.`,
        fix: 'Correct the batch record, or fill from a fresh or re-treated batch. Media left in from the last crop does not count.' };
    }
    if (b.source === 're-treated' && !String(b.treatment || '').trim()) {
      return { ...base, state: 'fail', why: `${who} is re-treated media with no record of how it was treated.`,
        fix: 'Record the treatment on the batch (for example: solarised under sealed plastic, with dates).' };
    }
    const from = b.fromCycleId && (state.cycles || {})[b.fromCycleId];
    const fromGalled = from ? galledCycle(state, from) : null;
    if (b.source === 're-treated' && fromGalled && fromGalled.galled) {
      return { ...base, state: 'fail', why: `${who} is media from a galled crop: ${fromGalled.why}.`,
        fix: 'Media from a galled crop is discarded, not re-treated. Fill from a fresh batch.' };
    }
    if (galled.galled && !f.newBags) {
      return { ...base, state: 'fail', why: `The last crop here was galled (${galled.why}), and the fill on ${dayOf(f)} reused its bags.`,
        fix: 'Bags from a galled crop are discarded, not refilled. Fill new bags and record them as new.' };
    }
  }
  return { ...base, state: 'pass', from: { kind: 'media-fill', id: fills[fills.length - 1].id },
    why: `${fills.length} fill${fills.length === 1 ? '' : 's'} for this restart, from `
      + `${[...new Set(fills.map((f) => `${batchName(batches[f.batchId])} (${batches[f.batchId].source})`))].join(', ')}`
      + `${galled.galled ? '; the last crop was galled and every bag is new' : ''}.` };
}

// --- FR-GATE-00 — the sign-off on Gate 0 and Gate 4 --------------------------

/**
 * FR-GATE-00: there is no site agronomist. Gate 0 and Gate 4 clear only after
 * the Farm Doctor check, the Farm Manager's confirmation and the Owner's
 * approval — three different records, in that order.
 *
 * For Gate 0 the check is a saved Farm Doctor gate review for this zone that
 * found nothing else missing on Gate 0 at the time it was run. A review that
 * listed missing evidence is not made good by somebody confirming it: the
 * Farm Manager confirms what the Doctor found, and what it found was "not yet".
 *
 * For Gate 4 the check is the Farm Doctor's cycle review of that cycle.
 */
function gateSignoff(state, zoneId, gateId, { since = null, until = isoDate(), cycleId = null } = {}) {
  const isG0 = gateId === 'G0';
  const id = isG0 ? 'doctor_check' : 'g4_signoff';
  const name = isG0
    ? (((gateSpec('G0') || {}).pass_all || [])[2] || 'Farm Doctor check passed, confirmed by Farm Manager and approved by Owner')
    : 'Farm Doctor cycle review, confirmed by Farm Manager and approved by Owner (FR-GATE-00)';

  const review = ((state && state.doctorOutputs) || [])
    .filter((o) => (isG0
      ? o.kind === 'gate-review' && (o.subject || {}).zoneId === zoneId
        && (!Array.isArray((o.subject || {}).gates) || o.subject.gates.includes('G0'))
      : o.kind === 'cycle-review' && (o.subject || {}).cycleId === cycleId))
    .filter((o) => dayOf(o) <= until && (!since || dayOf(o) > since))
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];

  const c = (state2, why, fix, extra = {}) => ({ id, gate: gateId, name, state: state2, why, fix, ...extra });

  if (!review) {
    return c('unknown', isG0 ? 'No Farm Doctor gate check has been saved for this zone since the last cycle ended.'
      : 'The Farm Doctor has not drafted the cycle review for this cycle.',
    isG0 ? 'Record the evidence, then save the Farm Doctor gate check; the Farm Manager confirms and the Owner approves.'
      : 'Ask the Farm Doctor to draft the cycle review from the season\'s records; the Farm Manager confirms and the Owner approves.');
  }
  const from = { kind: 'doctor-output', id: review.id };

  if (isG0) {
    const section = (review.gates || []).find((g) => g.id === 'G0');
    const gaps = section ? (section.missing || []).filter((m) => m.id !== 'doctor_check') : null;
    if (!gaps) {
      return c('fail', `The gate check saved ${dayOf(review)} does not show Gate 0's evidence.`,
        'Save a fresh Farm Doctor gate check for this zone.', { from });
    }
    if (gaps.length) {
      return c('fail', `The Farm Doctor check on ${dayOf(review)} found Gate 0 incomplete: `
        + `${gaps.map((m) => m.label || m.id).join('; ')}.`,
      'Record what is missing, then run and save the Farm Doctor check again.', { from });
    }
  }

  if (!review.confirmedBy || rankOfId(state, review.confirmedBy) < RANK.manager) {
    return c('fail', `The Farm Doctor check from ${dayOf(review)} is waiting for the Farm Manager to confirm it.`,
      'The Farm Manager confirms it. The Farm Doctor never confirms its own work (FR-DOC-08).', { from });
  }
  if (!review.approvedBy || rankOfId(state, review.approvedBy) < RANK.ceo) {
    return c('fail', 'The Farm Manager has confirmed it; the Owner has not approved it yet.',
      'FR-GATE-00: the Owner approves Gate 0 and Gate 4.', { from });
  }
  return c('pass', `Checked ${dayOf(review)}, confirmed by the Farm Manager and approved by the Owner.`, null, { from });
}

// --- The clean-restart protocol (GH-04, GH-05) -------------------------------

/**
 * Rules → clean_restart. Each step is recorded under gate "CR" by whoever did
 * it, after the previous cycle in the house ended. The host-free fallow also
 * has a length: the break from the day the old crop came out to transplant is
 * at least the step's `min_days`.
 */
function cleanRestart(state, zone, w, rules) {
  const spec = rules && rules.clean_restart;
  if (!spec || protocolOf(zone, rules) !== 'clean-restart') return null;

  const recorded = (itemId) => latestEvidence(state, 'CR', zone.id, itemId, { since: w.since, until: w.judged });
  // A bag zone restarts on fresh or re-treated media instead of a solarised
  // bed (rules → plant_bags.clean_restart). Every other step is the same.
  const bags = mediaOf(state, zone.id, w.active) === 'bag' && ((bagRules(rules) || {}).clean_restart || null);
  const conditions = (spec.steps || []).map((step) => {
    if (bags && step.id === bags.replaces_step) return freshMedia(state, zone, w, bags.step);
    const rec = recorded(step.id);
    const base = { id: `cr_${step.id}`, gate: 'CR', name: `Step ${step.step} — ${step.name}`, itemId: step.id, lines: step.pass_all || [] };
    if (!rec) {
      return { ...base, state: 'unknown', why: `Not recorded for this restart (${step.when}).`,
        fix: `Do it and record it: ${(step.pass_all || []).join('; ')}.` };
    }
    if (step.min_days) {
      const out = recorded((spec.steps[0] || {}).id);
      const days = out ? daysBetween(dayOf(out), w.judged) : null;
      if (days == null || days < step.min_days) {
        return { ...base, state: 'held', from: { kind: 'gate-evidence', id: rec.id },
          why: days == null ? 'The fallow is recorded but the day the old crop came out is not.'
            : `The house has been host-free for ${days} days.`,
          fix: `The minimum host-free break is ${step.min_days} days from the day the old crop came out.` };
      }
    }
    const timing = step.cover_days ? coverTiming(step, rec, w)
      : step.within_hours_before_transplant ? knockdownTiming(step, rec, w) : null;
    if (timing) return { ...base, from: { kind: 'gate-evidence', id: rec.id }, ...timing };
    return { ...base, state: 'pass', from: { kind: 'gate-evidence', id: rec.id },
      why: `Recorded ${dayOf(rec)}${rec.note ? ` — ${rec.note}` : ''}.` };
  });

  return {
    id: 'CR',
    name: spec.name || 'Clean-restart protocol',
    when: 'between cycles, before transplant',
    source: spec.source || null,
    evidence: 'each step recorded, with a photo',
    blocksAction: 'transplant',
    blocksTransplant: true,
    why: spec.why || '',
    note: [spec.timing_note, spec.after_replant].filter(Boolean).join(' '),
    rule: spec.gate_rule || '',
    conditions,
  };
}

/**
 * Step 3: solarisation is one continuous span under sealed plastic, 21 to 28
 * days (rules → clean_restart.steps[].cover_days). The record carries the day
 * the plastic went on (`coverFrom`) and the day it was lifted (`coverTo`); a
 * record with no lift day means the plastic is still on. Plastic laid before
 * the old crop ended belongs to the last restart, not this one.
 *
 * Returns null when the timing is right, otherwise the condition's state.
 */
function coverTiming(step, rec, w) {
  const { min, max } = step.cover_days;
  const from = rec.coverFrom || null;
  const to = rec.coverTo || null;
  const span = `${min}–${max} days`;
  if (!from) {
    return { state: 'fail', why: 'The solarisation is recorded without the day the plastic went on.',
      fix: `Record the day the plastic went on and the day it was lifted. It must be one continuous ${span}.` };
  }
  if (w.since && from <= w.since) {
    return { state: 'fail', why: `The plastic went on ${from}, before the previous cycle here ended on ${w.since}.`,
      fix: `Solarise after the old crop is out: one continuous ${span} under sealed plastic.` };
  }
  if (!to) {
    const sofar = daysBetween(from, w.judged);
    return { state: 'held', why: `Under plastic since ${from}: ${sofar} day${sofar === 1 ? '' : 's'} so far.`,
      fix: sofar < min
        ? `Keep it sealed. Lift it on or after ${isoDate(addDays(from, min))} and no later than ${isoDate(addDays(from, max))}, then record the lift.`
        : `Lift it no later than ${isoDate(addDays(from, max))} and record the lift.` };
  }
  const days = daysBetween(from, to);
  if (days < min || days > max) {
    return { state: 'fail', why: `The plastic was on ${from} to ${to}: ${days} days continuous.`,
      fix: days < min
        ? `Solarisation is one continuous ${span}. ${days} days is too short to kill the nematode and pathogen load: re-lay the plastic and record a new span.`
        : `Solarisation is one continuous ${span} (Rev 5 p16). If the lab asked for longer, record it as a new span or the Owner overrides with the lab's reason.` };
  }
  return { state: 'pass', why: `Under sealed plastic ${from} to ${to}: ${days} days continuous${rec.note ? ` — ${rec.note}` : ''}.` };
}

/**
 * Step 5: the pre-plant knockdown goes on within 48 h before transplant, with
 * the doors shut overnight in between (rules →
 * clean_restart.steps[].within_hours_before_transplant).
 *
 * Records carry a day, not an hour, so the window is counted in days: the day
 * before transplant or the day before that. Transplant day itself is refused,
 * because there has been no night with the doors shut.
 */
function knockdownTiming(step, rec, w) {
  const hours = step.within_hours_before_transplant;
  const maxDays = Math.ceil(hours / 24);
  const sprayed = dayOf(rec);
  const before = daysBetween(sprayed, w.judged);
  if (before < 1) {
    return { state: 'fail', why: `The knockdown was sprayed ${sprayed}, the same day as transplant.`,
      fix: 'The doors stay shut overnight after the knockdown. Spray it the day before transplant.' };
  }
  if (before > maxDays) {
    return { state: 'fail', why: `The knockdown was sprayed ${sprayed}, ${before} days before transplant.`,
      fix: `It has to go on within ${hours} h before transplant (${step.timing_rule || 'the day before, or the day before that'}). Spray it again and record it.` };
  }
  return { state: 'pass', why: `Sprayed ${sprayed}, ${before} day${before === 1 ? '' : 's'} before transplant${rec.note ? ` — ${rec.note}` : ''}.` };
}

/** The latest evidence line for one gate and zone, inside a window. */
function latestEvidence(state, gateId, zoneId, itemId, { cycleId = null, since = null, until = null } = {}) {
  return [...((state && state.gateEvidence) || [])]
    .filter((e) => e.gate === gateId && e.itemId === itemId && e.zoneId === zoneId)
    .filter((e) => (cycleId && e.cycleId ? e.cycleId === cycleId : true))
    .filter((e) => (!since || dayOf(e) > since) && (!until || dayOf(e) <= until))
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? 1 : -1))[0] || null;
}

// --- G2 and G3: the standing gates -------------------------------------------

function standingControls(state, zone, w, { today, now }) {
  const cycle = w.active;
  const weekOne = cycle && daysBetween(cycle.transplantDate, today) >= 7;
  const base = { gate: 'G2' };
  if (!cycle || !weekOne) {
    const why = cycle ? 'Runs from Week 1 of the cycle.' : 'Runs from Week 1 once something is planted.';
    return ['g2_scouting', 'g2_escalation', 'g2_owner'].map((id, i) => ({
      ...base, id, name: ((gateSpec('G2') || {}).pass_all || [])[i] || id, state: 'waiting', why, fix: null,
    }));
  }
  const labels = (gateSpec('G2') || {}).pass_all || [];

  const counts = (state.scouts || []).filter((s) => s.cycleId === cycle.id && s.trapCount != null && dayOf(s) <= today)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : -1));
  const gap = counts.length ? daysBetween(dayOf(counts[0]), today) : null;
  const scouting = gap != null && gap <= 2
    ? { state: 'pass', why: `Last trap count ${dayOf(counts[0])}.` }
    : { state: 'fail',
      why: gap == null ? 'No trap count has been logged for this cycle.' : `Trap counts have gapped ${gap} days.`,
      fix: 'Count every trap today and log it. RC2 red flag: trap counts gapped more than 2 days.' };

  const late = alerts(state, { now }).filter((a) => a.status === 'open' && a.cycleId === cycle.id
    && a.dueAt && a.dueAt < now);
  const escalation = late.length
    ? { state: 'fail', why: `${late.length} alert${late.length === 1 ? '' : 's'} on this zone past the 24 h deadline.`,
      fix: 'Close them with a diagnosis and a treatment, or a recorded decision not to treat (FR-SCOUT-05).' }
    : { state: 'pass', why: 'No alert on this zone is past its deadline.' };

  const weekAgo = isoDate(addDays(today, -7));
  const ownerIds = new Set(Object.values(state.people || {}).filter((p) => p.role === 'ceo').map((p) => p.id));
  const seen = (state.log || []).some((e) => ownerIds.has(e.by) && (e.at || '').slice(0, 10) >= weekAgo
    && (e.at || '').slice(0, 10) <= today);
  const owner = seen
    ? { state: 'pass', why: 'The Owner has been on the records in the last 7 days.' }
    : { state: 'fail', why: 'Nothing from the Owner on the records in the last 7 days.',
      fix: 'The Owner reads the digest and this screen at least weekly (RC3).' };

  return [
    { ...base, id: 'g2_scouting', name: labels[0] || 'scouting logged', ...scouting },
    { ...base, id: 'g2_escalation', name: labels[1] || 'escalation live', ...escalation },
    { ...base, id: 'g2_owner', name: labels[2] || 'owner verifying', ...owner },
  ];
}

/**
 * G3 — a diagnosis precedes every spray. FR-ROLE-13 adds the approval: a spray
 * resting on a self-confirmed diagnosis is clear only once the next level up
 * has approved it. Treated before approval is yellow while the approval is
 * inside 48 hours, red after; a spray that went on without the approval or the
 * exception is red. A self-confirmed diagnosis clears nothing on its own.
 */
function diagnosisFirst(state, w, { now = new Date().toISOString() } = {}) {
  const name = ((gateSpec('G3') || {}).pass_all || [])[0] || 'a diagnosis precedes every spray';
  const cycle = w.active;
  if (!cycle) {
    return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'waiting',
      why: 'Nothing planted. Every spray will need a confirmed diagnosis first.', fix: null }];
  }
  const sprays = (state.sprays || []).filter((s) => s.cycleId === cycle.id);
  const bare = sprays.filter((s) => !s.diagnosisId && !s.woundCare);
  if (bare.length) {
    return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'fail',
      why: `${bare.length} spray${bare.length === 1 ? '' : 's'} on this cycle with no diagnosis behind ${bare.length === 1 ? 'it' : 'them'}.`,
      fix: 'RC4 red flag. The treatment screen refuses new ones; diagnose what those sprays were for.' }];
  }
  const byId = new Map((state.diagnoses || []).map((d) => [d.id, d]));
  const standing = sprays.filter((s) => s.diagnosisId)
    .map((s) => ({ spray: s, ...approvalStanding(s, byId.get(s.diagnosisId), { now }) }));
  const red = standing.filter((x) => x.state === 'fail');
  if (red.length) {
    return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'fail', approval: 'missing',
      why: red.map((x) => x.why).join(' '),
      fix: 'FR-ROLE-13: the next level up approves a self-confirmed diagnosis. Approve it on the Clinic screen, '
        + 'and record why the spray went ahead without it.' }];
  }
  const held = standing.filter((x) => x.state === 'held');
  if (held.length) {
    return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'held', approval: 'treated-before-approval',
      why: held.map((x) => x.why).join(' '),
      fix: 'The approval is still owed: approve it on the Clinic screen.' }];
  }
  return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'pass',
    why: sprays.length ? `All ${sprays.length} sprays have a diagnosis behind them.` : 'No sprays yet.' }];
}

// --- The model ---------------------------------------------------------------

function fromItem(gateId, it, zoneName) {
  return {
    id: it.id,
    gate: gateId,
    name: it.label,
    itemId: it.id,
    state: it.state === 'have' ? 'pass' : 'fail',
    why: it.why || 'Nothing recorded for this line yet.',
    fix: it.state === 'have' ? null : (it.fix || `Record this against ${gateId} for ${zoneName}.`),
    from: it.from || null,
  };
}

function summarise(conditions) {
  if (conditions.every((c) => c.state === 'na')) return 'na';
  if (conditions.every((c) => c.state === 'waiting' || c.state === 'na')) return 'waiting';
  if (conditions.some((c) => c.state === 'fail' || c.state === 'unknown')) return 'fail';
  if (conditions.some((c) => c.state === 'held')) return 'held';
  if (conditions.some((c) => c.state === 'overridden')) return 'overridden';
  if (conditions.some((c) => c.state === PRE_GATES)) return PRE_GATES;
  if (conditions.some((c) => c.state === 'waiting')) return 'waiting';
  return 'pass';
}

/** Has the Owner overridden this condition for this zone, since the last cycle ended? */
function overrideFor(state, conditionId, zoneId, since) {
  return (state.gateOverrides || [])
    .filter((o) => o.gate === conditionId && o.zoneId === zoneId && !o.revoked)
    .filter((o) => !since || (o.at || '').slice(0, 10) > since)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0] || null;
}

function spec(id) {
  const s = gateSpec(id) || {};
  return {
    id, name: s.name || id, when: s.when || '', source: s.source || null,
    evidence: s.evidence || null, blocksAction: s.blocks_action || null, passAll: s.pass_all || [],
  };
}

/**
 * FR-GATE-06 — Gate 0 to Gate 4 for one zone, from the rules.
 *
 * Returns the gates in order (with the clean restart between G0 and G1 on
 * GH-04 and GH-05). Every gate carries its conditions, and every condition its
 * state, why, fix and — where there is one — the record it read.
 */
function gateModel(state, zoneId, opts = {}) {
  const today = opts.today || isoDate();
  const now = opts.now || `${today}T23:59:59.000Z`;
  const rules = opts.rules || peekRules();
  const zone = (state.plots || {})[zoneId];
  const w = zoneWindow(state, zoneId, today);
  const zoneName = (zone && zone.name) || zoneId;
  const gates = [];

  // G0 — Ground Clearance. A bag zone clears it on the media batch in its
  // bags, not on the bed (C-19); a bed zone exactly as before.
  const g0 = spec('G0');
  const bag = mediaOf(state, zoneId, w.active) === 'bag';
  if (bag) {
    const lines = bagG0(state, zoneId, { today });
    gates.push({
      ...g0, blocksTransplant: true, media: 'bag',
      why: ((bagRules(rules) || {}).media_types || {}).bag || 'Gate 0 clears on the media batch, not the bed.',
      conditions: [
        ...BAG_G0_ITEMS.map((itemId) => ({ ...lines[itemId], gate: 'G0', itemId, label: bagG0Label(itemId, rules) })),
        gateSignoff(state, zoneId, 'G0', { since: w.since, until: w.judged }),
      ],
    });
  } else {
    const nem = nematodeGate(state, zoneId, { today });
    const ph = phGate(state, zoneId, { today });
    const topsoil = batchGate(state, zoneId);
    gates.push({
      ...g0, blocksTransplant: true,
      conditions: [
        { ...nem, gate: 'G0', label: g0.passAll[0] },
        { ...ph, gate: 'G0', label: g0.passAll[1] },
        { ...topsoil, gate: 'G0', label: 'purchased topsoil tested (FR-GATE-03)' },
        gateSignoff(state, zoneId, 'G0', { since: w.since, until: w.judged }),
      ],
    });
  }

  const cr = cleanRestart(state, zone, w, rules);
  if (cr) gates.push(cr);

  // G1 — Establishment Readiness, the checklist, one recorded line at a time.
  const g1 = spec('G1');
  gates.push({
    ...g1, blocksTransplant: true,
    conditions: GATE_ITEMS.G1.map((itemId, i) => fromItem('G1', gateItem(state, {
      gateId: 'G1', itemId, label: g1.passAll[i], zoneId, cycleId: w.active ? w.active.id : null,
      today: w.judged, since: w.since, until: w.judged, batchId: opts.batchId || null, rules,
    }), zoneName)),
  });

  gates.push({ ...spec('G2'), blocksTransplant: false, conditions: standingControls(state, zone, w, { today, now }) });
  gates.push({ ...spec('G3'), blocksTransplant: false, conditions: diagnosisFirst(state, w, { now }) });

  // G4 — Cycle Close & Learn. What it is about depends on where the zone is:
  // an empty zone after a cycle has to close that cycle before the next goes
  // in; a planted zone had to close the one before it; a planted zone with no
  // earlier cycle waits for the end of this one.
  const g4 = spec('G4');
  const subject = w.previous || w.active || null;
  const blocks = !!w.previous;
  let g4Conditions;
  if (!subject) {
    g4Conditions = [{ id: 'g4_none', gate: 'G4', name: 'no earlier cycle to close', state: 'na',
      why: 'No cycle has run in this zone yet.', fix: null }];
  } else if (!blocks) {
    g4Conditions = [...GATE_ITEMS.G4, 'g4_signoff'].map((id, i) => ({
      id, gate: 'G4', name: g4.passAll[i] || 'Farm Doctor cycle review, confirmed by Farm Manager and approved by Owner (FR-GATE-00)',
      state: 'waiting', why: 'At the end of this cycle, before the next one goes in.', fix: null,
    }));
  } else {
    const window = { since: subject.transplantDate || null, until: w.judged };
    g4Conditions = [
      ...GATE_ITEMS.G4.map((itemId, i) => fromItem('G4', gateItem(state, {
        gateId: 'G4', itemId, label: g4.passAll[i], zoneId, cycleId: subject.id, today: w.judged, ...window, rules,
      }), zoneName)),
      gateSignoff(state, zoneId, 'G4', { ...window, cycleId: subject.id }),
    ];
  }
  gates.push({
    ...g4,
    blocksAction: blocks ? 'transplant' : null,
    blocksTransplant: blocks,
    subject: subject ? { cycleId: subject.id, closedAt: subject.closedAt || null, transplantDate: subject.transplantDate } : null,
    conditions: g4Conditions,
  });

  // FR-ONB-06: a crop planted before the app existed was never asked to pass
  // the gates that stand before a transplant. Each condition still says what
  // it found, and carries whatever evidence was entered on setup; none of it
  // is a violation and none of it needs an override. Gate 2 and Gate 3 run as
  // normal, and Gate 4 at the end of this cycle — when the crop comes out and
  // this stops applying — is judged like any other.
  const preGates = plantedBeforeGates(w.active);
  const preEvidence = preGates ? preGatesEvidence(state, zoneId, w.active.id) : [];

  // FR-GATE-07: an Owner override opens one condition on one zone and keeps
  // what it found. It does not reach G2 or G3, which block nothing here.
  for (const g of gates) {
    g.conditions = g.conditions.map((c) => {
      if (!g.blocksTransplant || !isBlocking(c)) return c;
      if (preGates) {
        return {
          ...c, state: PRE_GATES, found: c.why,
          why: `${PRE_GATES_LABEL}: transplanted ${w.active.transplantDate}, set up in the app ${w.active.onboarded.date}.`,
          fix: null,
          evidence: preEvidence.filter((e) => !e.gate || e.gate === g.id),
        };
      }
      const override = overrideFor(state, c.id, zoneId, w.since);
      return override ? { ...c, state: 'overridden', override, blockedWhy: c.why } : c;
    });
    g.state = summarise(g.conditions);
  }

  // A media batch that failed after it filled bags here: not a gate (the
  // crop in the ground was judged on transplant day), but the thing the
  // screen and the digest lead with (rules → plant_bags.trace).
  const failedMedia = bag ? batchesIn(state, zoneId, { since: w.since })
    .map(({ id, batch }) => ({ batch, failure: batchFailure(state, id) }))
    .filter((x) => x.failure && x.failure.date <= today) : [];

  return {
    zoneId, zone, window: w, planted: !!w.active, media: bag ? 'bag' : 'bed', failedMedia, gates,
    preGates: preGates ? { status: PRE_GATES, label: PRE_GATES_LABEL, cycleId: w.active.id,
      transplantDate: w.active.transplantDate, setupDate: w.active.onboarded.date, evidence: preEvidence } : null,
  };
}

/**
 * FR-GATE-06 — every condition that stands between this zone and a transplant.
 *
 * An override does not delete the finding. The condition still reports what
 * it found and who decided to go anyway, because that is the record the
 * digest and the audit need.
 */
function gatesForZone(state, zoneId, opts = {}) {
  const zone = (state.plots || {})[zoneId];
  if (isNursery(zone)) {
    return [gate('zone_type', 'Cropping block', 'fail', {
      gate: 'zone',
      noOverride: true,
      why: `${zone.name} is the nursery, not a cropping block (FR-FARM-04).`,
      fix: 'Seedlings are raised here, pass the release check, and are transplanted into a block.',
    })];
  }
  return gateModel(state, zoneId, opts).gates
    .filter((g) => g.blocksTransplant)
    .flatMap((g) => g.conditions);
}

/**
 * FR-GATE-00/01/02/03/06, FR-FARM-05 — may a crop be transplanted here?
 *
 * The one call the planting screen makes. `ok` is false unless every
 * condition of every gate that blocks transplant is clear or explicitly
 * overridden by the Owner. `batchId` names the seedling batch going in.
 */
function canPlant(state, zoneId, opts = {}) {
  const gates = gatesForZone(state, zoneId, opts);
  const blocking = gates.filter(isBlocking);
  return {
    ok: blocking.length === 0,
    gates,
    blocking,
    overridden: gates.filter((g) => g.state === 'overridden'),
    why: blocking.length
      ? `${blocking.length} condition${blocking.length === 1 ? '' : 's'} not cleared: `
        + blocking.map((g) => g.name).join(', ')
      : null,
  };
}

/**
 * FR-GATE-04 — diagnose before you treat.
 *
 * "Treatment by guesswork" is one of the four named causes of Season 1. A
 * spray needs a diagnosis that names the problem, was recorded for this zone,
 * is recent enough to still describe it, and — FR-DIAG-03 — was confirmed by
 * somebody senior to the person who started it.
 *
 * FR-ROLE-13: a self-confirmed diagnosis waits for the next level up. Until
 * the approval lands the treatment is blocked, unless it closes an open alert
 * due before the next spray window — then `beforeApproval` says so, and the
 * spray is recorded as treated before approval. `opts.now` is the instant.
 */
function canTreat(state, cycleId, opts = {}) {
  const { today = isoDate(), productId = null, activeId = null, maxAgeDays = 14 } = opts;

  // FR-ONB-05 — first, because it is the one nobody on the zone can fix by
  // diagnosing: the history has to be entered on the Setup screen.
  const missingHistory = treatmentHistoryBlock(state, cycleId, opts);
  if (missingHistory) return missingHistory;

  const recent = (state.diagnoses || [])
    .filter((d) => d.cycleId === cycleId)
    .filter((d) => d.date && d.date <= today && daysBetween(d.date, today) <= maxAgeDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const confirmed = recent.filter((d) => d.confirmedBy);
  // FR-ROLE-13 — self-confirmed and not yet approved is not enough to spray on.
  const usable = confirmed.filter(treatable);

  if (!recent.length) {
    return {
      ok: false,
      reason: 'no-diagnosis',
      why: 'Nothing has been diagnosed on this zone in the last two weeks.',
      fix: 'Run the clinic on a sick plant first. Spraying without knowing what you are spraying at is '
        + 'how a season gets lost.',
    };
  }

  if (!confirmed.length) {
    return {
      ok: false,
      reason: 'unconfirmed',
      diagnosis: recent[0],
      why: `"${recent[0].problemName || recent[0].problemId}" was diagnosed on ${recent[0].date} `
        + 'but nobody senior has confirmed it.',
      fix: 'The Field Supervisor or Farm Manager confirms the diagnosis, then the treatment can be logged.',
    };
  }

  let diagnosis = usable[0];
  let beforeApproval = null;
  if (!diagnosis) {
    const waiting = confirmed.find(awaitingApproval);
    if (!waiting) {
      return {
        ok: false,
        reason: 'unconfirmed',
        diagnosis: confirmed[0],
        why: `"${confirmed[0].problemName || confirmed[0].problemId}" has no person's confirmation behind it.`,
        fix: 'The Field Supervisor or Farm Manager confirms the diagnosis, then the treatment can be logged.',
      };
    }
    // The one exception, computed from the alert deadline and the window times.
    const at = opts.now || new Date().toISOString();
    const verdict = beforeApprovalCheck(state, waiting, { cycleId, at });
    const who = roleTitle(waiting.approvalFrom);
    if (!verdict.ok) {
      return {
        ok: false,
        reason: 'awaiting-approval',
        diagnosis: waiting,
        why: `"${waiting.problemName || waiting.problemId}" was confirmed by the person who raised it, `
          + `so the ${who} approves it before a treatment. ${verdict.why}`,
        fix: `Ask the ${who} to approve it from their phone, on the Clinic screen (FR-ROLE-13).`,
      };
    }
    diagnosis = waiting;
    beforeApproval = verdict;
  }
  const rotation = rotationCheck(state, cycleId, activeId || productId, { ...opts, today, diagnosis });
  if (!rotation.ok) return rotation;

  // FR-STOCK-04 — an expired container is not stock, and cannot be chosen for
  // a treatment. Where the store holds this active only in expired
  // containers, the spray is refused; where it holds none at all, stock is not
  // what this gate decides.
  const expired = rotation.active ? expiredOnly(state, rotation.active, today) : null;
  if (expired) return expired;

  return beforeApproval ? { ok: true, diagnosis, beforeApproval } : { ok: true, diagnosis };
}

/** FR-STOCK-04 — the refusal when every container of this active is past its date, else null. */
function expiredOnly(state, active, today = isoDate()) {
  const stock = stockOf(state, active, { today });
  if (!stock || !stock.expiredOnly) return null;
  const item = stock.item || {};
  return {
    ok: false, reason: 'expired', active,
    why: `The only ${active.name} in the store${item.name ? ` (${item.name})` : ''} is past its expiry date`
      + `${item.expiry ? `, ${item.expiry}` : ''}.`,
    fix: 'An expired container does not go on the crop. Record a new delivery, or choose another product '
      + 'the rotation allows.',
    sources: ['FR-STOCK-04'],
  };
}

/**
 * FR-GATE-05 — spray rotation, by resistance group.
 *
 * The check itself lives in rotation.js, on the rules file's own IRAC and FRAC
 * sequences, the thrips programme and the Week 10 rule. This is the door it
 * comes through, kept here because the treatment gate and the spray screen both
 * ask the same question: may this go on this zone today?
 *
 * `productRef` is an active-ingredient id, and — because the log is
 * append-only and the farm's history predates the catalogue — also accepts the
 * product id a spray was recorded with before the catalogue existed.
 */
function rotationCheck(state, cycleId, productRef, opts = {}) {
  return rotationVerdict(state, cycleId, productRef, opts);
}


/**
 * Every zone's standing, for the Gates screen and the Owner's digest.
 * Blocked zones come first: a clear zone needs no attention.
 */
function gateBoard(state, opts = {}) {
  return Object.values(state.plots || {})
    .map((zone) => {
      const verdict = canPlant(state, zone.id, opts);
      const cycle = Object.values(state.cycles || {})
        .find((c) => c.plotId === zone.id && c.status === 'active');
      return {
        zone,
        planted: !!cycle,
        cycle: cycle || null,
        model: isNursery(zone) ? null : gateModel(state, zone.id, opts),
        ...verdict,
      };
    })
    .sort((a, b) => (b.blocking.length - a.blocking.length)
      || String(a.zone.name).localeCompare(String(b.zone.name)));
}
})(__dvModule("web/js/domain/gates.js"));
__dvBindAll();

// ─── web/js/domain/doctor.js ───────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "DOCTOR": { enumerable: true, get: () => DOCTOR },
  "CONFIDENCE": { enumerable: true, get: () => CONFIDENCE },
  "normaliseConfidence": { enumerable: true, get: () => normaliseConfidence },
  "LIMITS": { enumerable: true, get: () => LIMITS },
  "refusal": { enumerable: true, get: () => refusal },
  "doctorOutput": { enumerable: true, get: () => doctorOutput },
  "CONFIRMS": { enumerable: true, get: () => CONFIRMS },
  "confirmOutput": { enumerable: true, get: () => confirmOutput },
  "approvePlan": { enumerable: true, get: () => approvePlan },
  "gateClearance": { enumerable: true, get: () => gateClearance },
  "stockOf": { enumerable: true, get: () => stockOf },
  "parseRate": { enumerable: true, get: () => parseRate },
  "TANKS": { enumerable: true, get: () => TANKS },
  "doseFor": { enumerable: true, get: () => doseFor },
  "activesNamedIn": { enumerable: true, get: () => activesNamedIn },
  "CARD_FOR_PROBLEM": { enumerable: true, get: () => CARD_FOR_PROBLEM },
  "cardForProblem": { enumerable: true, get: () => cardForProblem },
  "weekOf": { enumerable: true, get: () => weekOf },
  "checkPlan": { enumerable: true, get: () => checkPlan },
  "treatmentPlan": { enumerable: true, get: () => treatmentPlan },
  "PPE": { enumerable: true, get: () => PPE },
  "sprayRule": { enumerable: true, get: () => sprayRule },
  "ppeFor": { enumerable: true, get: () => ppeFor },
  "sprayWindowBlock": { enumerable: true, get: () => sprayWindowBlock },
  "PHOTO_CANNOT_CONFIRM": { enumerable: true, get: () => PHOTO_CANNOT_CONFIRM },
  "LAB_TYPES": { enumerable: true, get: () => LAB_TYPES },
  "photoReviewRequest": { enumerable: true, get: () => photoReviewRequest },
  "normalisePhotoReview": { enumerable: true, get: () => normalisePhotoReview },
  "labAdvice": { enumerable: true, get: () => labAdvice },
  "labSamples": { enumerable: true, get: () => labSamples },
  "openLabSamples": { enumerable: true, get: () => openLabSamples },
  "overdueLabSamples": { enumerable: true, get: () => overdueLabSamples },
  "ownerNotifications": { enumerable: true, get: () => ownerNotifications },
  "doctorRecords": { enumerable: true, get: () => doctorRecords },
  "awaitingConfirmation": { enumerable: true, get: () => awaitingConfirmation },
  "GATE_ITEMS": { enumerable: true, get: () => GATE_ITEMS },
  "recordedEvidence": { enumerable: true, get: () => recordedEvidence },
  "gateEvidence": { enumerable: true, get: () => gateEvidence },
  "gateItem": { enumerable: true, get: () => gateItem },
  "FOLLOW_UP_DAYS": { enumerable: true, get: () => FOLLOW_UP_DAYS },
  "followUpTaskId": { enumerable: true, get: () => followUpTaskId },
  "followUpTaskFor": { enumerable: true, get: () => followUpTaskFor },
  "missingFollowUps": { enumerable: true, get: () => missingFollowUps },
  "followUpFor": { enumerable: true, get: () => followUpFor },
  "countChange": { enumerable: true, get: () => countChange },
  "WORKED": { enumerable: true, get: () => WORKED },
  "followUpRecord": { enumerable: true, get: () => followUpRecord },
  "followUpBoard": { enumerable: true, get: () => followUpBoard },
  "draftCycleReview": { enumerable: true, get: () => draftCycleReview },
});
let addDays, daysBetween, isoDate, round;
let DEFAULT_REI_HOURS, defaultPhiDays, diagnosisCard, gateSpec, peekRules, rulesVersion;
let buildCatalogue, canUseActive, catalogueGroupOfSpray, isBanned, resolveActive;
let rotationVerdict, week10Actives;
let PROBLEM_BY_ID;
let BAG_G0_ITEMS, bagG0, bagG0Label, gateSignoff, latestSoilTest, nematodeGate, phGate, zoneWindow;
let mediaOf;
let sourcesOf;
let releasedFor;
let awaitingApproval, roleTitle, treatable;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { daysBetween = m.daysBetween; }, (m) => { isoDate = m.isoDate; }, (m) => { round = m.round; });
__dvImport("web/js/rules.js", (m) => { DEFAULT_REI_HOURS = m.DEFAULT_REI_HOURS; }, (m) => { defaultPhiDays = m.defaultPhiDays; }, (m) => { diagnosisCard = m.diagnosisCard; }, (m) => { gateSpec = m.gateSpec; }, (m) => { peekRules = m.peekRules; }, (m) => { rulesVersion = m.rulesVersion; });
__dvImport("web/js/domain/catalogue.js", (m) => { buildCatalogue = m.buildCatalogue; }, (m) => { canUseActive = m.canUseActive; }, (m) => { catalogueGroupOfSpray = m.groupOfSpray; }, (m) => { isBanned = m.isBanned; }, (m) => { resolveActive = m.resolveActive; });
__dvImport("web/js/domain/rotation.js", (m) => { rotationVerdict = m.rotationVerdict; }, (m) => { week10Actives = m.week10Actives; });
__dvImport("web/js/domain/pests.js", (m) => { PROBLEM_BY_ID = m.PROBLEM_BY_ID; });
__dvImport("web/js/domain/gates.js", (m) => { BAG_G0_ITEMS = m.BAG_G0_ITEMS; }, (m) => { bagG0 = m.bagG0; }, (m) => { bagG0Label = m.bagG0Label; }, (m) => { gateSignoff = m.gateSignoff; }, (m) => { latestSoilTest = m.latestSoilTest; }, (m) => { nematodeGate = m.nematodeGate; }, (m) => { phGate = m.phGate; }, (m) => { zoneWindow = m.zoneWindow; });
__dvImport("web/js/domain/media.js", (m) => { mediaOf = m.mediaOf; });
__dvImport("web/js/sources.js", (m) => { sourcesOf = m.sourcesOf; });
__dvImport("web/js/domain/nursery.js", (m) => { releasedFor = m.releasedFor; });
__dvImport("web/js/domain/selfcheck.js", (m) => { awaitingApproval = m.awaitingApproval; }, (m) => { roleTitle = m.roleTitle; }, (m) => { treatable = m.treatable; });
// The Farm Doctor — requirements §6.14.
//
// There is no agronomist on this site. FR-GATE-00 says so plainly, and this
// file is what stands in that gap for the day-to-day decisions: what is wrong
// with this plant, what would prove it, what may be sprayed on it, what
// evidence a gate is still missing, and whether the last treatment worked.
//
// It advises. People decide. That sentence is the whole design, and the six
// limits in FR-DOC-08 are what keep it true when the advice is convenient:
//
//   * it never clears a gate;
//   * it never confirms its own diagnosis;
//   * it never approves its own plan;
//   * it never names a product outside the catalogue or outside the store,
//     and never a banned one;
//   * it never invents a dose;
//   * it never calls a virus or a bacterial disease confirmed from a photo.
//
// Those are not warnings printed next to an answer. Each one is a function
// that returns a refusal, and each has a test named after it. A limit that
// only appears in the wording of a screen is a limit that a busy week removes.
//
// Everything here is pure and works with the network off (FR-DOC-03,
// FR-ADV-02). The one part that needs a connection is photo review, and its
// answer comes back through normalisePhotoReview() below, which applies the
// same limits to whatever the far end said.



// The catalogue and the rotation sequences are read in one place each
// (domain/catalogue.js, domain/rotation.js). The Farm Doctor asks them rather
// than keeping its own reading of the rules, so a group, a rate or a sequence
// means the same thing to the Doctor, to the treatment gate and to the spray
// screen — and changing the rules file changes all three at once.









/**
 * The catalogue, in the shape the rest of this file reads.
 *
 * domain/catalogue.js calls an active ingredient's name `name`; the Farm
 * Doctor's own records call it `ai`, after the column in the rules file. One
 * adapter here is cheaper than renaming a field across either side, and
 * `organic` is added from the rules' own Week 10 list (SR-08) rather than
 * guessed at from the name.
 */
function catalogueOf(state, rules) {
  if (!rules) return null;
  return buildCatalogue(state || {}, rules);
}

function adapt(active, catalogue, rules) {
  if (!active) return null;
  const allowed = catalogue && rules ? week10Actives(catalogue, rules).actives : [];
  return { ...active, ai: active.name, organic: allowed.some((a) => a.id === active.id) };
}

/** Every active in the catalogue, adapted. */
function actives(state, rules) {
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return [];
  return catalogue.actives.map((a) => adapt(a, catalogue, rules));
}

/** One active, by name, alias, id, or the product id an old spray was logged with. */
function activeFor(name, state, rules) {
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return null;
  return adapt(resolveActive(catalogue, name), catalogue, rules);
}

/** The Farm Doctor is not a person. This id is what every output is signed with. */
const DOCTOR = { id: 'farm-doctor', name: 'Farm Doctor' };

/** FR-DOC-03 — the three words the app is allowed to use about its own certainty. */
const CONFIDENCE = {
  high: { id: 'high', label: 'High confidence', rank: 3,
    hint: 'Still do the confirm test before anyone spends money.' },
  medium: { id: 'medium', label: 'Medium confidence', rank: 2,
    hint: 'Do the confirm test. This is a shortlist, not an answer.' },
  low: { id: 'low', label: 'Low confidence', rank: 1,
    hint: 'Not enough to act on. Take better photos or send a sample.' },
};

function normaliseConfidence(value) {
  const v = String(value || '').toLowerCase().trim();
  return CONFIDENCE[v] ? v : 'low';       // anything unrecognised is treated as low
}

/**
 * FR-DOC-08, as data.
 *
 * Every refusal in this file names one of these, so a screen, a test and the
 * saved record all describe the same limit in the same words.
 */
const LIMITS = {
  gate: {
    id: 'gate', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never clears a gate.',
    who: 'Gate 0 and Gate 4: the Farm Manager confirms and the Owner approves (FR-GATE-00).',
  },
  diagnosis: {
    id: 'diagnosis', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never confirms its own diagnosis.',
    who: 'The Field Supervisor or Farm Manager does the confirm test and confirms (FR-DIAG-03).',
  },
  plan: {
    id: 'plan', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never approves its own treatment plan.',
    who: 'The Farm Manager approves a plan before it is sprayed.',
  },
  catalogue: {
    id: 'catalogue', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never recommends a product outside the catalogue, outside the store, '
      + 'or on the banned list.',
    who: 'Only the Owner adds an active ingredient to the catalogue, with its group (FR-STOCK-09).',
  },
  dose: {
    id: 'dose', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never invents a dose.',
    who: 'The Farm Manager enters the label rate, PHI and REI before that product can be used '
      + '(FR-STOCK-06, FR-STOCK-08).',
  },
  photo: {
    id: 'photo', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never confirms a virus or a bacterial disease from a photo alone.',
    who: 'A lab sample settles it, and the Owner is told (FR-DOC-09, FR-DIAG-05).',
  },
};

/** A refusal. Shaped like every other answer in the app: what, why, and the fix. */
function refusal(limitId, why, extra = {}) {
  const limit = LIMITS[limitId];
  return {
    ok: false,
    limit: limitId,
    requirement: limit ? limit.requirement : 'FR-DOC-08',
    rule: limit ? limit.rule : '',
    why,
    fix: limit ? limit.who : '',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// FR-DOC-10 — every output is a record
// ---------------------------------------------------------------------------

/**
 * The shape of everything the Farm Doctor says.
 *
 * `read` is the point of it: the list of records the answer was built from, so
 * "show what it looked at" (FR-ADV-03) works for the Doctor as well as for the
 * adviser, and so an answer can be argued with a year later. `confirmedBy` is
 * null at birth and stays null until a person who is allowed to confirm does
 * — which is the whole of FR-DOC-08's second and third limits, expressed as a
 * field nothing in this file can set.
 *
 * `sources` is the other half of showing the working (FR-KNOW-05): the ids in
 * rules/sources.json behind the rules entries the answer used, so the record
 * names the published guides it rests on, not only the farm records.
 */
function doctorOutput({
  id = null, kind, subject = {}, read = [], sources = [], confidence = null, summary = '',
  findings = [], notifyOwner = false, lab = null, at = null, rules = peekRules(),
} = {}) {
  return {
    id: id || `fd_${kind}_${subject.id || subject.zoneId || subject.cycleId || 'farm'}_${(at || new Date().toISOString()).slice(0, 19)}`,
    kind,
    by: DOCTOR.id,
    at: at || new Date().toISOString(),
    subject,
    read: read.map((r) => ({ kind: r.kind, id: r.id || null, what: r.what || '' })),
    sources: [...new Set(sources)],
    confidence: confidence == null ? null : normaliseConfidence(confidence),
    summary,
    findings,
    notifyOwner: !!notifyOwner,
    lab,
    rulesVersion: rulesVersion(rules),
    // FR-DOC-08, first three limits, in the record itself.
    clears: false,
    confirmedBy: null,
    confirmedAt: null,
    approvedBy: null,
    approvedAt: null,
  };
}

/** Who may confirm or approve what. Ranks mirror web/js/store.js. */
const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOf = (person) => (person && RANK[person.role]) || 0;
const isDoctor = (person) => !person || person.id === DOCTOR.id || person.role === 'doctor';

const CONFIRMS = {
  // FR-DIAG-03 / farm_doctor.confirmation.diagnosis
  diagnosis: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  photo: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  // farm_doctor.confirmation.treatment_plan
  plan: { minRank: RANK.manager, who: 'Farm Manager', limit: 'plan' },
  followup: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  // FR-GATE-00: Farm Manager confirms, Owner approves. Confirming is not clearing.
  'gate-review': { minRank: RANK.manager, who: 'Farm Manager', limit: 'gate', approver: RANK.ceo },
  'cycle-review': { minRank: RANK.manager, who: 'Farm Manager', limit: 'gate', approver: RANK.ceo },
};

/**
 * FR-DOC-08 — a person confirms, and the Farm Doctor is not a person.
 *
 * The refusal is deliberately not a silent no-op. An app that quietly ignored
 * a self-confirmation would leave a record that looks confirmed to whoever
 * reads it next.
 */
function confirmOutput(output, person, { note = '', at = null } = {}) {
  if (!output || !output.kind) return refusal('diagnosis', 'There is nothing to confirm.');
  const spec = CONFIRMS[output.kind] || CONFIRMS.diagnosis;

  if (isDoctor(person)) {
    return refusal(spec.limit,
      `The Farm Doctor produced this ${labelFor(output.kind)}, so it cannot be the one to confirm it.`);
  }
  if (rankOf(person) < spec.minRank) {
    return refusal(spec.limit,
      `${person.name || 'That account'} is a ${person.role || 'visitor'}, and a ${labelFor(output.kind)} `
      + `is confirmed by the ${spec.who}.`);
  }
  return {
    ok: true,
    output: {
      ...output,
      confirmedBy: person.id,
      confirmedRole: person.role,
      confirmedAt: at || new Date().toISOString(),
      confirmNote: note,
    },
  };
}

/**
 * FR-DOC-08 — the Farm Doctor never approves its own plan, and a plan that has
 * not been approved by the Farm Manager is not sprayable.
 */
function approvePlan(plan, person, { at = null } = {}) {
  if (!plan) return refusal('plan', 'There is no plan to approve.');
  if (isDoctor(person)) {
    return refusal('plan', 'The Farm Doctor wrote this plan, so it cannot approve it.');
  }
  if (rankOf(person) < RANK.manager) {
    return refusal('plan',
      `${person && person.name ? person.name : 'That account'} is a ${(person && person.role) || 'visitor'}; `
      + 'a treatment plan is approved by the Farm Manager.');
  }
  return { ok: true, plan: { ...plan, approvedBy: person.id, approvedAt: at || new Date().toISOString() } };
}

/**
 * FR-DOC-08 / FR-GATE-00 — a gate is cleared by people, never by this file.
 *
 * The Doctor's gate work produces a review. Clearing needs the Farm Manager's
 * confirmation and the Owner's approval on top of it, and if either is missing
 * the answer is no, however complete the evidence looks.
 */
function gateClearance(review, { confirmedBy = null, approvedBy = null } = {}) {
  const missing = [];
  if (review && review.missing && review.missing.length) {
    missing.push(`${review.missing.length} piece${review.missing.length === 1 ? '' : 's'} of evidence still missing`);
  }
  if (isDoctor(confirmedBy) || rankOf(confirmedBy) < RANK.manager) missing.push('Farm Manager confirmation');
  if (isDoctor(approvedBy) || rankOf(approvedBy) < RANK.ceo) missing.push('Owner approval');
  if (missing.length) {
    return refusal('gate', `This gate is not cleared: ${missing.join(', ')}.`, { missing });
  }
  return { ok: true, cleared: true, confirmedBy: confirmedBy.id, approvedBy: approvedBy.id };
}

function labelFor(kind) {
  return ({
    diagnosis: 'diagnosis', photo: 'photo review', plan: 'treatment plan',
    'gate-review': 'gate review', 'cycle-review': 'cycle review', followup: 'follow-up check',
  })[kind] || 'finding';
}

// ---------------------------------------------------------------------------
// The catalogue, the store shelf and the dose — FR-DOC-08 limits four and five
// ---------------------------------------------------------------------------

/**
 * What is actually on the shelf for one active ingredient.
 *
 * Stock is kept by the name on the container ("Mancozeb 80% WP"), while the
 * catalogue keeps active ingredients ("Mancozeb"). An item may also carry an
 * explicit `activeId`, which is what the Farm Manager sets when entering a
 * brand label (FR-STOCK-06), and that always wins over name matching.
 */
function stockOf(state, entry, { today = isoDate() } = {}) {
  if (!entry) return null;
  const items = Object.values((state && state.inputs) || {});
  const named = items.filter((item) => {
    if (item.activeId) return item.activeId === entry.id;
    const hay = String(item.name || '').toLowerCase();
    return entry.aliases.some((alias) => {
      const a = String(alias).toLowerCase();
      return a.length > 3 && hay.includes(a);
    });
  });
  if (!named.length) return null;

  // FR-STOCK-04: an expired container is not stock.
  const usable = named.filter((item) => !item.expiry || item.expiry >= today);
  const qty = usable.reduce((n, item) => n + (Number(item.qty) || 0), 0);
  return {
    item: usable[0] || named[0],
    qty,
    expiredOnly: !usable.length,
    unit: (usable[0] || named[0]).unit || '',
  };
}

/**
 * Turn a rate written for people into numbers.
 *
 * The rules write rates the way a label does — "2.5 g/L (80WP)", "150 ml
 * cold-pressed oil + 30 ml soap / 16 L" — and two of the twenty entries say
 * "per label" or "see prep table", which is the catalogue being honest that it
 * does not hold a number. Those must not parse. A rate this function cannot
 * read is a product the Farm Doctor will not dose (FR-DOC-08).
 */
function parseRate(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const formulation = (/\((\d+\s*(?:EC|SC|WP|WG|SL|SP|WDG|WSG)[^)]*)\)/i.exec(s) || [])[1] || null;

  const perLitre = /(\d+(?:\.\d+)?)\s*(ml|g)\s*\/\s*(?:1\s*)?L\b/i.exec(s);
  if (perLitre) {
    return {
      value: Number(perLitre[1]), unit: perLitre[2].toLowerCase(), perLitres: 1,
      formulation, text: s,
    };
  }

  const perTank = /(\d+(?:\.\d+)?)\s*(ml|g)\b[^/;]*\/\s*(\d+(?:\.\d+)?)\s*L\b/i.exec(s);
  if (perTank) {
    return {
      value: Number(perTank[1]), unit: perTank[2].toLowerCase(), perLitres: Number(perTank[3]),
      formulation, text: s,
    };
  }

  return null;     // "per label", "see prep table", anything else a person wrote
}

/** The knapsack and the two tanks a spray is actually mixed in (FR-DOC-05). */
const TANKS = [16, 500, 1000];

/**
 * FR-DOC-05 dose calculator, and FR-DOC-08's fifth limit.
 *
 * A dose comes from the schedule rate for that active, or from a label rate
 * the Farm Manager has entered. Where neither exists the answer is a refusal,
 * not an estimate: an invented dose is either a wasted spray or a residue
 * failure, and both are worse than "enter the label first".
 */
function doseFor(entry, { labelRate = null, tanks = TANKS } = {}) {
  if (!entry) return refusal('catalogue', 'That product is not in the catalogue.');

  const fromLabel = parseRate(labelRate);
  const fromSchedule = parseRate(entry.scheduleRate);
  const rate = fromLabel || fromSchedule;
  const source = fromLabel ? 'label entered by the Farm Manager' : 'schedule rate in the rules';

  if (!rate) {
    return refusal('dose',
      `${entry.ai} has no usable rate: the rules give ${entry.scheduleRate ? `"${entry.scheduleRate}"` : 'none'}`
      + `${labelRate ? ` and the entered label says "${labelRate}"` : ' and no label has been entered'}.`);
  }

  const perLitre = rate.value / rate.perLitres;
  return {
    ok: true,
    rate,
    source,
    perLitre: round(perLitre, 3),
    unit: rate.unit,
    amounts: tanks.map((volumeL) => {
      const amount = perLitre * volumeL;
      return {
        volumeL,
        amount: round(amount, amount >= 10 ? 0 : 2),
        unit: rate.unit,
        text: `${round(amount, amount >= 10 ? 0 : 2)} ${rate.unit} in ${volumeL} L`,
      };
    }),
  };
}

/**
 * Which catalogue actives a piece of rules text names.
 *
 * The rules say what to reach for in prose — "Abamectin or wettable sulphur on
 * tips", "Spinosad IRAC 5 preferred". Reading those names back out of the same
 * file keeps the Farm Doctor's shortlist tied to the rules rather than to a
 * second list in the app that could drift away from them.
 */
function activesNamedIn(text, rules = peekRules(), state = null) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return [];
  return actives(state, rules).filter((entry) => (entry.aliases || []).some((alias) => {
    const a = String(alias).toLowerCase();
    return a.length > 3 && hay.includes(a);
  }));
}

/**
 * The rules' diagnosis card for one of the app's guide entries.
 *
 * The guide in web/js/domain/pests.js is wider than the 22 cards, so some
 * problems have no card. Where there is none the Farm Doctor has no rules text
 * to read a product out of, and says so rather than reaching for the guide's
 * own chemical list — the rules are the source of truth for what may be
 * sprayed here.
 */
const CARD_FOR_PROBLEM = {
  thrips: 'thrips',
  broad_mite: 'broad_mite',
  whitefly: 'whitefly',
  aphids: 'aphids',
  red_spider_mite: 'spider_mite',
  fruit_borer: 'helicoverpa',
  root_knot_nematode: 'root_knot_nematode',
  phytophthora_blight: 'phytophthora',
  fusarium_wilt: 'fusarium_wilt',
  bacterial_wilt: 'bacterial_wilt',
  anthracnose: 'anthracnose',
  powdery_mildew: 'powdery_mildew',
  damping_off: 'damping_off',
  bacterial_leaf_spot: 'bacterial_spot',
  blossom_end_rot: 'blossom_end_rot',
  acid_soil: 'acid_soil',
  pvmv: 'mosaic_virus',
  cmv: 'mosaic_virus',
  leaf_curl_virus: 'mosaic_virus',
};

function cardForProblem(problemId, rules = peekRules()) {
  const id = CARD_FOR_PROBLEM[problemId] || problemId;
  return diagnosisCard(id, rules);
}

/**
 * FR-KNOW-05 — the registry ids behind a card, its triage rows and any actives
 * an answer named, read off those rules entries' `sources` arrays.
 */
function sourcesBehind({ card = null, triage = [], actives: named = [] } = {}, rules = peekRules()) {
  // Two rows name a half of a card (sunscald, fruit_cracking -> sunscald_cracking).
  const cards = new Set(((rules && rules.diagnosis_cards) || []).map((c) => c.id));
  const parts = (id) => String(id).split('_');
  const rows = triage.length || !card ? triage
    : ((rules && rules.triage) || []).filter((r) => r.likely === card.id
      || (!cards.has(r.likely) && parts(r.likely).some((p) => parts(card.id).includes(p))));
  const entries = named.map((a) => ((rules && rules.active_ingredients) || [])
    .find((r) => r.ai === (a && (a.ai || a)))).filter(Boolean);
  return sourcesOf([card, ...rows, ...entries].filter(Boolean));
}

/** Week of the cycle, counted the rules' way: T is day 1 of Week 0. */
function weekOf(cycle, date = isoDate()) {
  if (!cycle || !cycle.transplantDate) return null;
  const dat = daysBetween(cycle.transplantDate, date);
  if (dat < 0) return null;
  return Math.floor(dat / 7);
}

/**
 * The group a past spray belongs to.
 *
 * The farm's history predates the catalogue, so a spray may name a brand, an
 * old product id or nothing useful at all. domain/catalogue.js knows how to
 * read all three, and this is the Doctor asking it rather than guessing.
 */
function groupOfSpray(spray, rules = peekRules(), state = null) {
  if (!spray || !rules) return null;
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return null;
  return catalogueGroupOfSpray(catalogue, spray) || spray.group || null;
}

/** A block that is not one of the FR-DOC-08 limits but a rule in its own right. */
function block(code, requirement, why, fix, extra = {}) {
  return { ok: false, limit: null, code, requirement, why, fix, ...extra };
}

/**
 * FR-DOC-04 — a plan that already passes every rule, checked one rule at a time.
 *
 * The order matters. Catalogue, store and dose come first because they are the
 * FR-DOC-08 limits: a product the farm cannot legally or physically use is not
 * improved by having good rotation. Everything after them is the agronomy that
 * makes a legal spray a sensible one.
 */
function checkPlan(state, plan = {}, { today = isoDate(), rules = peekRules() } = {}) {
  const violations = [];
  const cycle = plan.cycleId ? ((state && state.cycles) || {})[plan.cycleId] : null;
  const name = plan.active || plan.activeId || plan.productName || '';

  if (!rules) {
    violations.push(refusal('catalogue',
      'The rules file has not loaded on this phone, so the catalogue cannot be checked.',
      { fix: 'Open the app once with a connection. Until then the Farm Doctor will not name a product.' }));
    return { ok: false, entry: null, dose: null, violations };
  }

  // FR-DOC-08 / FR-STOCK-09 — banned, whatever else is true of it.
  if (isBanned(name, rules)) {
    return {
      ok: false, entry: null, dose: null,
      violations: [refusal('catalogue', `${name} is on the banned list and can never be used on this farm.`)],
    };
  }

  const entry = activeFor(name, state, rules);
  if (!entry) {
    return {
      ok: false, entry: null, dose: null,
      violations: [refusal('catalogue',
        `${name || 'That product'} is not an active ingredient in the catalogue.`)],
    };
  }

  // product_rule: no IRAC/FRAC group on file, no treatment. Farm-made botanicals
  // carry no group by nature, and SR-08 names them for Week 10, so the rule
  // bites on the synthetics it was written for.
  if ((!entry.group || entry.group === 'none') && !entry.organic) {
    violations.push(block('no-group', 'rules.product_rule',
      `${entry.ai} has no IRAC or FRAC group on file.`,
      'The Owner adds the group to the catalogue entry before this can be selected.'));
  }

  const stock = stockOf(state, entry, { today });
  if (!stock || stock.qty <= 0) {
    violations.push(refusal('catalogue',
      stock && stock.expiredOnly
        ? `The only ${entry.ai} in the store is past its expiry date.`
        : `There is no ${entry.ai} in the store.`,
      { fix: 'Buy it in and receive it into stock, or pick something already on the shelf.' }));
  }

  const dose = doseFor(entry, { labelRate: plan.labelRate });
  if (!dose.ok) violations.push(dose);

  // FR-GATE-04 / Gate 3 — diagnosed before treated.
  if (plan.cycleId) {
    const diagnosed = treatableDiagnosis(state, plan.cycleId, { today });
    if (!diagnosed.ok) {
      violations.push(block('gate-3', 'FR-GATE-04', diagnosed.why, diagnosed.fix));
    }
  }

  // FR-GATE-05, SR-08, the thrips programme and the Metalaxyl-M cadence, all
  // from the rules' own sequences. This is the same verdict the treatment gate
  // and the spray screen get (domain/rotation.js), so there is one answer to
  // "may this go on this zone today?" rather than the Doctor's and the gate's.
  //
  // Two of its refusals are FR-DOC-08 limits rather than agronomy, and keep
  // the limit's name: a product that is not in the catalogue, and one with no
  // dose on file.
  const week = weekOf(cycle, plan.date || today);
  if (plan.cycleId) {
    const rotation = rotationVerdict(state, plan.cycleId, entry.id, {
      rules, today, target: plan.problemId || null, week,
    });
    if (!rotation.ok) {
      if (rotation.reason === 'not-in-catalogue') {
        violations.push(refusal('catalogue', rotation.why, { fix: rotation.fix }));
      } else if (rotation.reason !== 'no-rate') {
        // 'no-rate' is left out deliberately: doseFor() above has already
        // answered it, and answered it better. It reads the schedule rate, a
        // stored label and a rate entered on the plan itself, and refuses in
        // the calculator's own words. Repeating it here would put the same
        // FR-DOC-08 limit in the list twice.
        violations.push(block(rotation.reason || 'rotation', 'FR-GATE-05', rotation.why, rotation.fix,
          { alternatives: rotation.alternatives || [], sources: rotation.sources || [] }));
      }
    }
  }

  // SR-05 — a microbial inoculant is killed by a fungicide it follows too closely.
  const mixing = mixingBlock(state, plan.cycleId, entry, { today });
  if (mixing) violations.push(mixing);

  // SR-01/02/03 — the hour it is going on, when the plan names one.
  const timing = sprayWindowBlock(plan, entry, { rules });
  if (timing) violations.push(timing);

  const phiDays = phiFor(entry, plan, rules);
  const reiHours = reiFor(plan);

  return {
    ok: violations.length === 0,
    entry,
    stock: stock || null,
    dose: dose.ok ? dose : null,
    phiDays,
    reiHours,
    // FR-TREAT-02 — what this spray costs the harvest plan, said before it happens.
    harvestBlockedUntil: isoDate(addDays(plan.date || today, phiDays)),
    week,
    violations,
  };
}

/** FR-GATE-04 read the app's own way: a confirmed diagnosis, recent enough to mean it. */
function treatableDiagnosis(state, cycleId, { today = isoDate(), maxAgeDays = 14 } = {}) {
  const recent = ((state && state.diagnoses) || [])
    .filter((d) => d.cycleId === cycleId)
    .filter((d) => d.date && d.date <= today && daysBetween(d.date, today) <= maxAgeDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!recent.length) {
    return { ok: false, why: 'Nothing has been diagnosed on this bed in the last two weeks.',
      fix: 'Run the Farm Doctor on a sick plant, then have the diagnosis confirmed.' };
  }
  const confirmed = recent.find((d) => d.confirmedBy && d.confirmedBy !== DOCTOR.id && treatable(d));
  const waiting = recent.find(awaitingApproval);
  if (!confirmed && waiting) {
    // FR-ROLE-13 — self-confirmed, and the next level up has not approved it.
    return { ok: false,
      why: `"${waiting.problemName || waiting.problemId}" was confirmed by the person who raised it, `
        + `and the ${roleTitle(waiting.approvalFrom)} has not approved it yet.`,
      fix: `The ${roleTitle(waiting.approvalFrom)} approves it on the Clinic screen, then the plan can go ahead.` };
  }
  if (!confirmed) {
    return { ok: false,
      why: `"${recent[0].problemName || recent[0].problemId}" was diagnosed on ${recent[0].date}, `
        + 'but nobody has confirmed it.',
      fix: 'The Field Supervisor or Farm Manager does the confirm test and confirms it.' };
  }
  return { ok: true, diagnosis: confirmed };
}

/** SR-05: a microbial inoculant never within 48 h of a fungicide, never in the same tank. */
function mixingBlock(state, cycleId, entry, { today = isoDate() } = {}) {
  if (!/biological|trichoderma|bacillus/i.test(`${entry.type} ${entry.ai}`)) return null;
  const recent = ((state && state.sprays) || [])
    .filter((s) => s.cycleId === cycleId && s.date && daysBetween(s.date, today) <= 2)
    .find((s) => /fungicide|mancozeb|copper|metalaxyl|sulphur/i.test(`${s.productName || ''} ${s.kind || ''}`));
  if (!recent) return null;
  return block('mixing', 'rules.spray_rules SR-05',
    `A fungicide went on this bed on ${recent.date}. A microbial inoculant within 48 hours of one is wasted.`,
    'Wait until 48 hours have passed, and never put the two in the same tank.');
}

/** FR-STOCK-07: the default applies unless an entered label is longer. */
function phiFor(entry, plan, rules) {
  const fallback = entry.phiDays != null ? entry.phiDays : defaultPhiDays(rules);
  const label = Number(plan.labelPhiDays);
  if (Number.isFinite(label) && label > fallback) return label;
  return fallback;
}

function reiFor(plan) {
  const label = Number(plan.labelReiHours);
  if (Number.isFinite(label) && label > DEFAULT_REI_HOURS) return label;
  return DEFAULT_REI_HOURS;
}

/**
 * FR-DOC-04 — the plan itself.
 *
 * Every candidate the rules name for this problem, put through checkPlan, and
 * split into what may be sprayed and what may not with the reason attached.
 * The rejected list is not noise: "there is nothing you may use here" is an
 * answer a manager has to act on, and the reasons are what they act on.
 */
function treatmentPlan(state, {
  problemId, cycleId = null, zoneId = null, diagnosisId = null, today = isoDate(),
  tanks = TANKS, labels = {}, rules = peekRules(),
} = {}) {
  const problem = PROBLEM_BY_ID[problemId] || null;
  const card = cardForProblem(problemId, rules);
  const triage = (rules && rules.triage || []).filter((r) => (CARD_FOR_PROBLEM[problemId] || problemId) === r.likely);

  const text = [
    card && card.treatment, card && card.prevention,
    ...triage.map((r) => r.first_action),
  ].filter(Boolean).join(' ');

  let candidates = activesNamedIn(text, rules);
  // The thrips programme is a rotation of its own, named in the rules.
  if ((CARD_FOR_PROBLEM[problemId] || problemId) === 'thrips' && rules && rules.thrips_program) {
    const options = Object.values(rules.thrips_program.options_by_group || {}).join(', ');
    candidates = [...candidates, ...activesNamedIn(options, rules)];
  }
  const seen = new Set();
  candidates = candidates.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));

  const options = [];
  const rejected = [];
  for (const entry of candidates) {
    const checked = checkPlan(state, {
      active: entry.ai, cycleId, zoneId, problemId, diagnosisId,
      labelRate: labels[entry.id] && labels[entry.id].rate,
      labelPhiDays: labels[entry.id] && labels[entry.id].phiDays,
      labelReiHours: labels[entry.id] && labels[entry.id].reiHours,
      date: today,
    }, { today, rules });
    if (checked.ok) options.push({ ...checked, active: entry, dose: doseFor(entry, { labelRate: labels[entry.id] && labels[entry.id].rate, tanks }) });
    else rejected.push({ active: entry, violations: checked.violations });
  }

  const record = doctorOutput({
    kind: 'plan',
    subject: { problemId, cycleId, zoneId, diagnosisId },
    confidence: options.length ? 'high' : 'low',
    rules,
    read: [
      diagnosisId ? { kind: 'diagnosis', id: diagnosisId, what: 'the confirmed diagnosis' } : null,
      card ? { kind: 'rules-card', id: card.id, what: 'the diagnosis card in the rules' } : null,
      { kind: 'stock', what: `${Object.keys((state && state.inputs) || {}).length} items on the store shelf` },
      { kind: 'sprays', what: `${(((state && state.sprays) || []).filter((s) => s.cycleId === cycleId)).length} sprays already on this bed` },
    ].filter(Boolean),
    sources: sourcesBehind({ card, triage, actives: candidates }, rules),
    summary: options.length
      ? `${options.length} product${options.length === 1 ? '' : 's'} the rules and the store both allow today.`
      : 'Nothing in the catalogue and the store may be sprayed on this today.',
  });

  return {
    ...record,
    problem,
    card,
    options,
    rejected,
    // FR-DOC-08: written by the Farm Doctor, sprayable only once a person approves.
    approvedBy: null,
    readyToSpray: false,
    needsApproval: CONFIRMS.plan.who,
  };
}

// ---------------------------------------------------------------------------
// FR-TREAT-04 — the gear, before the job
// ---------------------------------------------------------------------------
//
// Ported from claude/farm-doctor-planning-calcs. SR-06 sets the floor — mask
// and gloves for any spray, and for hydrated lime goggles, gloves, dust mask,
// long sleeves and a briefing that gets logged. The farm's own spray rules go
// further (sleeves, trousers and boots every time), and the stricter of the
// two is the one that applies.

const PPE = {
  mask: { id: 'mask', icon: 'mask', label: 'Mask over nose and mouth',
    why: 'The spray drifts back at you the moment the wind shifts.' },
  dust_mask: { id: 'dust_mask', icon: 'mask', label: 'Dust mask',
    why: 'Hydrated lime dust burns the inside of the nose and the lungs.' },
  gloves: { id: 'gloves', icon: 'gloves', label: 'Gloves',
    why: 'Most of what gets into a person gets in through the hands.' },
  goggles: { id: 'goggles', icon: 'goggles', label: 'Goggles',
    why: 'There is no rinsing this back out of an eye in the field.' },
  sleeves: { id: 'sleeves', icon: 'sleeves', label: 'Long sleeves and trousers',
    why: 'Bare arms in a sprayed house carry it home on the skin.' },
  boots: { id: 'boots', icon: 'boots', label: 'Boots',
    why: 'The run-off ends up on the floor you are standing in.' },
};

/** One spray rule, by its id, in the rules' own words. */
function sprayRule(id, rules = peekRules()) {
  const list = (rules && rules.spray_rules) || [];
  return (list.find((r) => r.id === id) || {}).rule || '';
}

const GARLIC_CHILLI = 'garlic_chilli_extract_farm_made';

/** What must be worn for this job (SR-06, and the farm's standing rules). */
function ppeFor({ active = null, task = 'spray', rules = peekRules() } = {}) {
  const sr06 = sprayRule('SR-06', rules);

  if (task === 'lime' || (active && active.id === 'hydrated_lime')) {
    return {
      task: 'lime',
      items: [PPE.goggles, PPE.gloves, PPE.dust_mask, PPE.sleeves, PPE.boots],
      briefing: true,
      briefingText: 'Hydrated lime needs a team briefing before anyone opens a bag, '
        + 'and the briefing is logged with who was there.',
      source: 'SR-06',
      rule: sr06,
    };
  }

  const items = [PPE.mask, PPE.gloves, PPE.sleeves, PPE.boots];
  // Goggles for anything that is not a PHI-0 botanical, and for garlic-chilli,
  // which the PHI table marks as an eye and skin irritant in its own right.
  if (!active || !active.organic || active.id === GARLIC_CHILLI) items.splice(2, 0, PPE.goggles);

  return {
    task: 'spray',
    items,
    briefing: false,
    source: 'SR-06',
    rule: sr06,
    extra: active && active.id === GARLIC_CHILLI
      ? 'Garlic-chilli is an eye and skin irritant. Treat it like a chemical, because it is one.'
      : null,
    // SR-07, the step everyone skips.
    after: active && /insecticide/.test(active.type || '') ? sprayRule('SR-07', rules) : null,
  };
}

// ---------------------------------------------------------------------------
// SR-01, SR-02, SR-03 — when a spray may go on
// ---------------------------------------------------------------------------

/**
 * The spray window, ported from claude/farm-doctor-planning-calcs.
 *
 * Midday heat wastes the chemical and burns the crop, wet leaves stop Mancozeb
 * binding, and once the crop is flowering the window closes until 5 PM so the
 * spray does not land on open flowers. All four are rules in the file, so the
 * refusal quotes them rather than restating them.
 */
function sprayWindowBlock(plan = {}, entry = null, { rules = peekRules() } = {}) {
  const at = plan.at || '';
  if (!rules || !at || at.length <= 10) return null;

  const [h, m] = at.slice(11).split(':').map(Number);
  const clock = h + (m || 0) / 60;
  const pretty = at.slice(11, 16);
  const broken = [];

  // SR-02 tightens SR-01 once the crop is flowering: after 5 PM, not 4.
  const opensAt = plan.flowering ? 17 : 16;
  if (clock < opensAt || clock > 19) {
    broken.push({ why: `${pretty} is outside the spray window.`,
      fix: plan.flowering ? sprayRule('SR-02', rules) : sprayRule('SR-01', rules) });
  }
  if (plan.openFlowers) broken.push({ why: 'The crop has open flowers.', fix: sprayRule('SR-02', rules) });
  if (plan.wind) broken.push({ why: 'There is wind through the nets.', fix: sprayRule('SR-02', rules) });
  if (plan.leavesWet) broken.push({ why: 'The leaves are wet.', fix: sprayRule('SR-03', rules) });
  if (entry && entry.id === 'mancozeb' && plan.dryHoursAhead != null && Number(plan.dryHoursAhead) < 2) {
    broken.push({
      why: `Mancozeb needs 2 dry hours to bind and there ${Number(plan.dryHoursAhead) === 1 ? 'is 1' : `are ${plan.dryHoursAhead}`} ahead.`,
      fix: sprayRule('SR-03', rules),
    });
  }
  if (entry && entry.id === 'spinosad' && clock < 16) {
    broken.push({ why: 'Spinosad breaks down in sunlight.', fix: 'After 4 PM only.' });
  }

  if (!broken.length) return null;
  return block('timing', 'rules.spray_rules SR-01, SR-02, SR-03',
    broken.map((b) => b.why).join(' '), broken.map((b) => b.fix).filter(Boolean).join(' '));
}

// ---------------------------------------------------------------------------
// FR-DOC-03 — photo review online, the guided flow offline
// ---------------------------------------------------------------------------

/** Problems that a picture can suggest but never settle (FR-DOC-08, FR-DOC-09). */
const PHOTO_CANNOT_CONFIRM = new Set(['viral', 'bacterial']);
const LAB_TYPES = new Set(['viral', 'bacterial', 'nematode']);

/**
 * What to do with a set of photos.
 *
 * Online, the photos go to the farm's own server, which asks the wider model
 * and returns a reading with a stated confidence. Offline — which on this farm
 * is most of the time — the answer is not "try again later": the guided
 * diagnosis, the calculators and the plan checks all still work, and this says
 * so and points at them.
 */
function photoReviewRequest({
  photos = [], cycleId = null, zoneId = null, problemShortlist = [], symptoms = [],
  note = '', online = false, today = isoDate(),
} = {}) {
  if (!photos.length) {
    return { ok: false, mode: 'none', why: 'No photos yet.',
      fix: 'Take a close photo of the damage and a second one of the whole plant.' };
  }
  if (!online) {
    return {
      ok: true,
      mode: 'offline',
      why: 'This phone has no connection, so the photos cannot be reviewed yet.',
      fix: 'Work through the guided diagnosis instead — it asks what you can see, names the '
        + 'look-alikes and gives you the test that separates them. The photos are saved and '
        + 'will be reviewed when the phone next has signal.',
      stillWorks: ['Guided diagnosis', 'Dose calculator', 'Lime calculator', 'Plan checks', 'Gate evidence'],
      queuedPhotos: photos.length,
    };
  }
  return {
    ok: true,
    mode: 'online',
    payload: {
      photos, cycleId, zoneId, note, symptoms, date: today,
      shortlist: problemShortlist.map((p) => ({
        id: p.id || p, name: (PROBLEM_BY_ID[p.id || p] || {}).name || String(p.id || p),
      })),
      limits: [LIMITS.photo.rule, LIMITS.catalogue.rule, LIMITS.dose.rule],
    },
  };
}

/**
 * Take whatever came back from the far end and make it obey the limits.
 *
 * This is the important half of photo review. The server prompt asks the model
 * to respect the limits, but asking is not enforcing: the answer arrives here
 * as untrusted data, and what a person finally sees is built from these fields,
 * not from the reply. A reply that says a virus is confirmed lands as a
 * suspicion with a lab sample attached, every time.
 */
function normalisePhotoReview(raw = {}, {
  state = null, cycleId = null, zoneId = null, photos = [], today = isoDate(), rules = peekRules(),
} = {}) {
  const confidence = normaliseConfidence(raw.confidence);

  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .slice(0, 5)
    .map((c) => {
      const problem = PROBLEM_BY_ID[c.problemId] || null;
      return {
        problemId: problem ? problem.id : null,
        name: problem ? problem.name : String(c.name || c.problemId || 'Unnamed'),
        type: problem ? problem.type : null,
        inGuide: !!problem,
        confidence: normaliseConfidence(c.confidence || confidence),
        why: String(c.why || '').slice(0, 400),
      };
    });

  const top = candidates[0] || null;
  const type = top && top.type;

  // FR-DOC-08 — a photo never confirms a virus or a bacterial disease. Whatever
  // the reply claimed, this is what the record says.
  const photoAlone = !!(type && PHOTO_CANNOT_CONFIRM.has(type));
  const limit = photoAlone ? LIMITS.photo : null;

  // FR-DOC-08 — nor does a photo review get to name a product. Anything it
  // suggested is put through the same catalogue, stock and dose checks as any
  // other plan, and what fails is dropped with its reason kept.
  const suggested = [];
  const dropped = [];
  for (const name of (Array.isArray(raw.actives) ? raw.actives : []).slice(0, 6)) {
    const checked = checkPlan(state || { inputs: {}, sprays: [], diagnoses: [] },
      { active: name, cycleId, date: today }, { today, rules });
    if (checked.ok) suggested.push({ active: checked.entry, dose: checked.dose });
    else dropped.push({ name: String(name), violations: checked.violations });
  }

  const lab = labAdvice(state, {
    problemId: top && top.problemId, type, confidence, cycleId, zoneId, today, rules,
  });

  const card = top && top.problemId ? cardForProblem(top.problemId, rules) : null;
  const confirmTest = [
    card && card.detection,
    ...(top && PROBLEM_BY_ID[top.problemId] ? (PROBLEM_BY_ID[top.problemId].confirm || []) : []),
  ].filter(Boolean);

  const record = doctorOutput({
    kind: 'photo',
    subject: { cycleId, zoneId, problemId: top && top.problemId },
    confidence,
    rules,
    read: [
      { kind: 'photos', what: `${photos.length || raw.photoCount || 0} photo(s) taken in the app` },
      card ? { kind: 'rules-card', id: card.id, what: 'the diagnosis card in the rules' } : null,
      { kind: 'model', what: `photo review, ${CONFIDENCE[confidence].label.toLowerCase()}` },
    ].filter(Boolean),
    sources: sourcesBehind({ card, actives: suggested.map((x) => x.active) }, rules),
    summary: top
      ? `Photo review points at ${top.name}, ${CONFIDENCE[confidence].label.toLowerCase()}.`
      : 'The photo review could not name anything.',
    notifyOwner: lab.notifyOwner,
    lab: lab.needed ? lab.sample : null,
  });

  return {
    ...record,
    mode: 'online',
    candidates,
    // Never true. A person confirms, after the confirm test (FR-DIAG-03).
    confirmed: false,
    photoAlone,
    limit: limit ? limit.id : null,
    limitRule: limit ? limit.rule : null,
    confirmTest,
    needsConfirming: CONFIRMS.photo.who,
    suggestedActives: suggested,
    droppedActives: dropped,
    labAdvice: lab,
    text: String(raw.text || '').slice(0, 4000),
  };
}

// ---------------------------------------------------------------------------
// FR-DOC-09 / FR-DIAG-05 — the lab, and telling the Owner
// ---------------------------------------------------------------------------

/**
 * When a sample goes to a lab, and when the Owner hears about it.
 *
 * The four cases are the rules' own (farm_doctor.lab_required_for): a virus,
 * bacterial wilt, nematodes, or the same thing coming back low confidence
 * twice. The last one is the one that matters most in practice — it is the app
 * admitting it has stopped being useful on this problem, which is exactly the
 * point at which Season 1 kept guessing instead.
 */
function labAdvice(state, {
  problemId = null, type = null, confidence = null, cycleId = null, zoneId = null,
  today = isoDate(), rules = peekRules(),
} = {}) {
  const problem = problemId ? PROBLEM_BY_ID[problemId] : null;
  const kind = type || (problem && problem.type) || null;
  const reasons = [];

  if (kind === 'viral') {
    reasons.push('A virus cannot be told from a photo or a symptom list. Only a lab says which one it is.');
  }
  if (problemId === 'bacterial_wilt' || (kind === 'bacterial' && /wilt/.test(problemId || ''))) {
    reasons.push('Bacterial wilt: if the streaming test is not clear-cut, the lab settles it.');
  } else if (kind === 'bacterial') {
    reasons.push('A bacterial disease is not confirmed from a photo. A sample settles it.');
  }
  if (kind === 'nematode') {
    reasons.push('A nematode assay comes from a lab and cannot be replaced by the app (Gate 0).');
  }

  const lowBefore = countLowConfidence(state, { problemId, cycleId, zoneId });
  const lowNow = normaliseConfidence(confidence) === 'low' ? lowBefore + 1 : lowBefore;
  if (lowNow >= 2) {
    reasons.push(`This is the ${ordinal(lowNow)} low-confidence reading on the same problem. `
      + 'Two is where the app stops guessing and a sample goes off.');
  }

  const needed = reasons.length > 0;
  return {
    needed,
    reasons,
    // farm_doctor.confirmation: virus, bacterial wilt, nematode or low confidence -> Owner told.
    notifyOwner: needed,
    escalation: needed ? 'Owner notified now, not at the next digest.' : null,
    sample: needed ? {
      problemId, cycleId, zoneId,
      requestedOn: today,
      reason: reasons[0],
      // FR-DIAG-05: what a tracked sample has to carry.
      lab: null, sentDate: null, result: null, resultDate: null,
      status: 'recommended',
    } : null,
  };
}

function countLowConfidence(state, { problemId, cycleId, zoneId }) {
  return ((state && state.doctorOutputs) || []).filter((o) => {
    if (o.confidence !== 'low') return false;
    const s = o.subject || {};
    if (problemId && s.problemId && s.problemId !== problemId) return false;
    if (cycleId && s.cycleId && s.cycleId !== cycleId) return false;
    if (zoneId && s.zoneId && s.zoneId !== zoneId) return false;
    return !!(problemId || cycleId || zoneId);
  }).length;
}

const ordinal = (n) => (n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`);

/** FR-DIAG-05 — every sample, with where it went and what came back. */
function labSamples(state) {
  return [...((state && state.labSamples) || [])]
    .sort((a, b) => ((a.sentDate || a.requestedOn || '') < (b.sentDate || b.requestedOn || '') ? 1 : -1));
}

function openLabSamples(state) {
  return labSamples(state).filter((s) => !s.result);
}

/** A sample sent and not answered is a hole in the record, not a closed matter. */
function overdueLabSamples(state, { today = isoDate(), days = 14 } = {}) {
  return openLabSamples(state)
    .filter((s) => s.sentDate && daysBetween(s.sentDate, today) >= days)
    .map((s) => ({ ...s, waitingDays: daysBetween(s.sentDate, today) }));
}

/** FR-DOC-09 — what the Owner is owed, for the digest and the alerts screen. */
function ownerNotifications(state, { today = isoDate() } = {}) {
  const out = [];
  for (const o of ((state && state.doctorOutputs) || [])) {
    if (!o.notifyOwner || o.ownerSeenAt) continue;
    out.push({
      id: o.id, kind: o.kind, at: o.at, confidence: o.confidence,
      subject: o.subject || {},
      why: o.summary || '',
      lab: o.lab || null,
    });
  }
  for (const s of overdueLabSamples(state, { today })) {
    out.push({
      id: `lab:${s.id}`, kind: 'lab', at: s.sentDate, confidence: null, subject: s,
      why: `Sample sent to ${s.lab || 'the lab'} on ${s.sentDate} — ${s.waitingDays} days with no result.`,
    });
  }
  return out.sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

// ---------------------------------------------------------------------------
// FR-DOC-10 — reading the records back
// ---------------------------------------------------------------------------

function doctorRecords(state, { kind = null, limit = 50 } = {}) {
  return [...((state && state.doctorOutputs) || [])]
    .filter((o) => !kind || o.kind === kind)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))
    .slice(0, limit);
}

/** Outputs still waiting on a person. This is the Doctor's own to-do list. */
function awaitingConfirmation(state) {
  return doctorRecords(state, { limit: 200 })
    .filter((o) => !o.confirmedBy)
    .filter((o) => o.kind !== 'followup');
}

// ---------------------------------------------------------------------------
// FR-DOC-06 — what Gates 0, 1 and 4 are still missing
// ---------------------------------------------------------------------------

/**
 * The evidence items, in the order the rules list them.
 *
 * The labels are not written here. They are read out of the gate's own
 * `pass_all` list so that the words on the screen are the words in the rules
 * file; this array only says which id each line is recorded under and how the
 * app can tell, from records it already holds, that the line is satisfied.
 */
const GATE_ITEMS = {
  G0: ['lab_report', 'ph_three_point', 'doctor_check'],
  G1: ['inputs_on_site', 'drip_pressure', 'spacing_pegged', 'traps_installed',
    'sops_live', 'scout_roster', 'route_b_wait', 'seedling_release'],
  G4: ['root_inspection', 'control_audit', 'sops_updated'],
};

/** The latest thing a person recorded against one line of one gate. */
function recordedEvidence(state, gateId, zoneId, itemId, { cycleId = null, since = null, until = null } = {}) {
  const day = (e) => e.date || (e.at || '').slice(0, 10);
  return [...((state && state.gateEvidence) || [])]
    .filter((e) => e.gate === gateId && e.itemId === itemId)
    .filter((e) => (e.zoneId ? e.zoneId === zoneId : true))
    .filter((e) => (cycleId && e.cycleId ? e.cycleId === cycleId : true))
    // Evidence from before the previous cycle ended describes the last crop's
    // house, not this one's (FR-GATE-01's window, applied to every line).
    .filter((e) => (!since || day(e) > since) && (!until || day(e) <= until))
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? 1 : -1))[0] || null;
}

function item(id, label, state, extra = {}) {
  return { id, label, state, why: '', fix: '', from: null, ...extra };
}

/** An item satisfied by somebody recording it, with the note they left. */
function fromRecord(id, label, record, missingFix) {
  if (!record) {
    return item(id, label, 'missing', { fix: missingFix });
  }
  return item(id, label, 'have', {
    why: `Recorded ${record.date || (record.at || '').slice(0, 10)}`
      + `${record.note ? ` — ${record.note}` : ''}`,
    from: { kind: 'gate-evidence', id: record.id || null },
  });
}

/**
 * FR-DOC-06 — check the evidence for Gates 0, 1 and 4 and list what is missing.
 *
 * Note what this does not do. It does not return a pass. Gate 0 and Gate 4 are
 * cleared by the Farm Manager's confirmation and the Owner's approval
 * (FR-GATE-00), and this is the check that happens before that, not instead of
 * it. `clears` is false in every branch, and gateClearance() is the only thing
 * that turns evidence into a cleared gate — and only when two people are named.
 */
function gateEvidence(state, {
  zoneId, cycleId = null, today = isoDate(), rules = peekRules(), gates = ['G0', 'G1', 'G4'],
} = {}) {
  const zone = ((state && state.plots) || {})[zoneId] || null;
  const out = [];
  const w = zoneWindow(state || { plots: {} }, zoneId, today);

  // C-19: a bag zone's Gate 0 is the media batch's lines, then the sign-off.
  const bag = mediaOf(state || { plots: {} }, zoneId, w.active) === 'bag';

  for (const gateId of gates) {
    const spec = gateSpec(gateId, rules);
    const bagG0Items = bag && gateId === 'G0';
    const labels = bagG0Items ? [...BAG_G0_ITEMS.map((id) => bagG0Label(id, rules)), (spec && spec.pass_all || [])[2]]
      : (spec && spec.pass_all) || [];
    const ids = bagG0Items ? [...BAG_G0_ITEMS, 'doctor_check'] : GATE_ITEMS[gateId] || labels.map((_, i) => `item_${i + 1}`);
    const items = ids.map((id, i) => {
      const label = labels[i] || id.replace(/_/g, ' ');
      // G4 is about the cycle it closes; the others about this planting.
      const window = gateId === 'G4' ? {} : { since: w.since };
      return checkGateItem(state, { gateId, itemId: id, label, zoneId, cycleId, today, rules, zone, ...window });
    });

    // Gate 4's evidence is a document, and the Doctor drafts it (FR-DOC-07).
    if (gateId === 'G4') {
      const review = ((state && state.doctorOutputs) || [])
        .filter((o) => o.kind === 'cycle-review' && (o.subject || {}).cycleId === cycleId)
        .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
      items.push(review
        ? item('cycle_review', (spec && spec.evidence) || 'Cycle Review document',
          review.confirmedBy ? 'have' : 'missing', {
            why: review.confirmedBy
              ? 'Cycle review drafted and confirmed.'
              : 'A cycle review is drafted but nobody has confirmed it yet.',
            fix: review.confirmedBy ? '' : `The ${CONFIRMS['cycle-review'].who} confirms it, then the Owner approves.`,
            from: { kind: 'doctor-output', id: review.id },
          })
        : item('cycle_review', (spec && spec.evidence) || 'Cycle Review document', 'missing', {
          fix: 'Ask the Farm Doctor to draft the cycle review from this season\'s records.',
        }));
    }

    const missing = items.filter((it) => it.state !== 'have');
    out.push({
      id: gateId,
      name: (spec && spec.name) || gateId,
      when: (spec && spec.when) || '',
      blocksAction: (spec && spec.blocks_action) || null,
      source: (spec && spec.source) || null,
      items,
      missing,
      complete: missing.length === 0,
    });
  }

  const missing = out.flatMap((g) => g.missing.map((m) => ({ gate: g.id, ...m })));

  const record = doctorOutput({
    kind: 'gate-review',
    subject: { zoneId, cycleId, gates },
    confidence: rules ? 'high' : 'low',
    rules,
    sources: sourcesOf(gates.map((g) => gateSpec(g, rules))),
    read: [
      { kind: 'rules', what: `gates ${gates.join(', ')} in the rules file` },
      { kind: 'soil-tests', what: `${(((state && state.soilTests) || []).filter((t) => t.zoneId === zoneId)).length} soil tests for this zone` },
      { kind: 'gate-evidence', what: `${((state && state.gateEvidence) || []).filter((e) => e.zoneId === zoneId).length} evidence entries recorded` },
      ...(bag ? [{ kind: 'media-fills', what: `${((state && state.mediaFills) || []).filter((f) => f.zoneId === zoneId && !f.refused).length} bag fills into this zone, and the media batches behind them` }] : []),
      { kind: 'stock', what: `${Object.keys((state && state.inputs) || {}).length} items on the store shelf` },
    ],
    summary: missing.length
      ? `${missing.length} piece${missing.length === 1 ? '' : 's'} of gate evidence missing for `
        + `${(zone && zone.name) || zoneId}.`
      : `Every listed piece of evidence for ${gates.join(', ')} is on file for ${(zone && zone.name) || zoneId}.`,
  });

  return {
    ...record,
    zoneId,
    zone,
    cycleId,
    gates: out,
    missing,
    complete: missing.length === 0,
    // FR-DOC-08, first limit. Checking is not clearing, and this says so in the record.
    clears: false,
    clearedBy: null,
    needsConfirming: CONFIRMS['gate-review'].who,
    needsApproval: 'Owner',
    limitRule: LIMITS.gate.rule,
  };
}

/**
 * One line of one gate, judged — the same check the Gates screen reads
 * (gates.js → gateModel), so the Farm Doctor and the gate cannot disagree
 * about a line. `since`/`until` bound the evidence to this planting's window;
 * `batchId` names the seedling batch for the release line.
 */
function gateItem(state, {
  gateId, itemId, label = null, zoneId, cycleId = null, today = isoDate(), since = null, until = null,
  batchId = null, rules = peekRules(),
} = {}) {
  const spec = gateSpec(gateId, rules);
  const i = (GATE_ITEMS[gateId] || []).indexOf(itemId);
  const text = label || ((spec && spec.pass_all) || [])[i] || itemId.replace(/_/g, ' ');
  const zone = ((state && state.plots) || {})[zoneId] || null;
  return checkGateItem(state, { gateId, itemId, label: text, zoneId, cycleId, today, rules, zone, since, until, batchId });
}

function checkGateItem(state, {
  gateId, itemId, label, zoneId, cycleId, today, rules, zone, since = null, until = null, batchId = null,
}) {
  const recorded = recordedEvidence(state, gateId, zoneId, itemId, { cycleId, since, until });

  switch (itemId) {
    // --- Gate 0, plant-bag lines (C-19) ------------------------------------
    case 'media_batch':
    case 'heap_solarisation':
    case 'bag_barrier': {
      const c = bagG0(state, zoneId, { today })[itemId];
      return item(itemId, label, c.state === 'pass' ? 'have' : 'missing', {
        why: c.why, fix: c.fix || '', from: c.batch ? { kind: 'media-batch', id: c.batch.id } : null,
      });
    }

    // --- Gate 0 -----------------------------------------------------------
    case 'lab_report': {
      const nem = nematodeGate(state, zoneId, { today });
      const test = latestSoilTest(state, zoneId, { today });
      if (nem.state !== 'pass') {
        return item(itemId, label, 'missing', { why: nem.why, fix: nem.fix || 'Send a soil sample for a nematode assay.' });
      }
      if (!(nem.test && nem.test.lab)) {
        return item(itemId, label, 'missing', {
          why: 'A clean nematode result is on file but it does not name the lab that gave it.',
          fix: 'Record which lab tested it, and keep the report. Gate 0 asks for a lab report, not a note.',
          from: { kind: 'soil-test', id: (nem.test && nem.test.id) || null },
        });
      }
      return item(itemId, label, 'have', {
        why: `${nem.test.lab} returned clear on ${nem.test.date}.`,
        from: { kind: 'soil-test', id: nem.test.id || (test && test.id) || null },
      });
    }

    case 'ph_three_point': {
      const ph = phGate(state, zoneId, { today });
      if (ph.state !== 'pass') {
        return item(itemId, label, 'missing', { why: ph.why, fix: ph.fix || 'Record a corrected pH reading.' });
      }
      const test = ph.test || {};
      const points = Number(test.points || (Array.isArray(test.readings) ? test.readings.length : 0));
      if (points < 3) {
        return item(itemId, label, 'missing', {
          why: `pH ${test.ph} is on file, but from ${points || 'an unrecorded number of'} sampling point${points === 1 ? '' : 's'}.`,
          fix: 'Gate 0 asks for a three-point test. Take readings at three places in the block and record all three.',
          from: { kind: 'soil-test', id: test.id || null },
        });
      }
      if (!test.photo) {
        return item(itemId, label, 'missing', {
          why: `A three-point reading of ${test.ph} is on file with no photo of the meter.`,
          fix: 'Photograph the meter reading and attach it to the soil test.',
          from: { kind: 'soil-test', id: test.id || null },
        });
      }
      return item(itemId, label, 'have', {
        why: `pH ${test.ph} from ${points} points on ${test.date}, meter photographed.`,
        from: { kind: 'soil-test', id: test.id || null },
      });
    }

    case 'doctor_check': {
      // FR-GATE-00: the same sign-off the gate itself reads (gates.js).
      const w = zoneWindow(state, zoneId, today);
      const signoff = gateSignoff(state, zoneId, 'G0', { since: w.since, until: w.judged });
      return item(itemId, label, signoff.state === 'pass' ? 'have' : 'missing', {
        why: signoff.why, fix: signoff.fix || '', from: signoff.from || null,
      });
    }

    // --- Gate 1 -----------------------------------------------------------
    case 'inputs_on_site': {
      // The rules name the thrips programme; "full input list incl. thrips
      // controls" is checkable against the store for exactly that part.
      const options = Object.values(((rules && rules.thrips_program) || {}).options_by_group || {}).join(', ');
      const thripsActives = activesNamedIn(options, rules);
      const held = thripsActives.filter((e) => {
        const s = stockOf(state, e, { today });
        return s && s.qty > 0;
      });
      if (!held.length) {
        return item(itemId, label, 'missing', {
          why: thripsActives.length
            ? `Nothing from the thrips programme is in the store (${thripsActives.map((e) => e.ai).join(', ')}).`
            : 'The store has not been checked against the thrips programme.',
          fix: 'Gate 1 exists because Season 1 met thrips with an empty store. Buy the rotation in before transplant.',
        });
      }
      if (recorded) return fromRecord(itemId, label, recorded, '');
      return item(itemId, label, 'have', {
        why: `Thrips controls in stock: ${held.map((e) => e.ai).join(', ')}.`,
        from: { kind: 'stock', id: null },
      });
    }

    case 'traps_installed': {
      if (!recorded) {
        return item(itemId, label, 'missing', {
          fix: 'Record the trap count for this zone, with a photo. One per 6 m² at plant height.',
        });
      }
      const area = Number(zone && zone.areaM2) || 0;
      const needed = area ? Math.ceil(area / 6) : 0;
      const have = Number(recorded.count) || 0;
      if (needed && have < needed) {
        return item(itemId, label, 'missing', {
          why: `${have} traps recorded for ${area} m². The rules ask for one per 6 m², so ${needed}.`,
          fix: `Put up ${needed - have} more and record the new count.`,
          from: { kind: 'gate-evidence', id: recorded.id || null },
        });
      }
      return fromRecord(itemId, label, recorded, '');
    }

    case 'scout_roster': {
      const positions = Object.values((state && state.positions) || {})
        .filter((p) => !p.retired && (p.primaryZoneId === zoneId || p.backupZoneId === zoneId));
      if (positions.length) {
        return item(itemId, label, 'have', {
          why: `${positions.length} position${positions.length === 1 ? '' : 's'} cover this zone, primary and backup.`,
          from: { kind: 'position', id: positions[0].id },
        });
      }
      return fromRecord(itemId, label, recorded,
        'FR-ROLE-01: give this zone a primary and a backup position, so scouting has an owner when somebody is away.');
    }

    case 'route_b_wait': {
      const route = (zone && zone.limeRoute) || (recorded && recorded.route) || null;
      if (route && String(route).toUpperCase() !== 'B') {
        return item(itemId, label, 'have', { why: `This block is Route ${route}, so the hydrated-lime wait does not apply.` });
      }
      const limed = recorded && (recorded.date || recorded.limeDate);
      if (!limed) {
        return item(itemId, label, route ? 'missing' : 'missing', {
          why: route ? 'This is a Route B block and the hydrated-lime date is not recorded.'
            : 'Neither the lime route nor a hydrated-lime date is recorded for this block.',
          fix: 'Record which route was used and, for Route B, the day the hydrated lime went on.',
        });
      }
      const waited = daysBetween(limed, today);
      if (waited < 14) {
        return item(itemId, label, 'missing', {
          why: `Hydrated lime went on ${limed}, ${waited} day${waited === 1 ? '' : 's'} ago.`,
          fix: `Route B blocks wait 14 days. Earliest transplant is ${isoDate(addDays(limed, 14))}.`,
          from: { kind: 'gate-evidence', id: recorded.id || null },
        });
      }
      return item(itemId, label, 'have', { why: `Hydrated lime ${limed}, ${waited} days ago.` });
    }

    case 'seedling_release': {
      // FR-FARM-05: a batch that passed the nursery release check and was
      // released to this block — read from the batch record, not from a note.
      const checks = ((rules && rules.nursery) || {}).seedling_release_check || [];
      const found = releasedFor(state, zoneId, {
        asOf: until || today, since, batchId, cycleId,
      });
      if (!found.batch) {
        return item(itemId, label, 'missing', {
          why: found.why,
          fix: checks.length
            ? `Release a batch from the nursery to this block. It passes ${checks.length} checks first — ${checks.join('; ')}.`
            : 'Release a seedling batch from the nursery to this block.',
        });
      }
      return item(itemId, label, 'have', {
        why: `Batch ${found.batch.label || found.batch.id} released ${found.batch.release.date} to this block.`,
        from: { kind: 'seedling-batch', id: found.batch.id },
      });
    }

    // --- The lines only a person can answer, on either gate ---------------
    case 'drip_pressure':
      return fromRecord(itemId, label, recorded,
        'Run the drip and check the pressure at the far end of the line. Record the reading '
        + 'and anything blocked — a house that waters unevenly is a house that fails unevenly.');
    case 'spacing_pegged':
      return fromRecord(itemId, label, recorded,
        'Peg the rows to the planned spacing and photograph the pegged block before planting.');
    case 'sops_live':
      return fromRecord(itemId, label, recorded,
        'The role cards and the spray, scouting and hygiene SOPs are up where the work happens, '
        + 'and the people doing the work have been through them.');

    // --- Gate 4, and everything else a person simply records --------------
    case 'root_inspection':
      return fromRecord(itemId, label, recorded,
        'Lift sample plants at the end of the cycle and record what the roots looked like — '
        + 'white and firm, brown and slimy, galled, or stubby. That reading is what Gate 4 learns from.');
    case 'control_audit':
      return fromRecord(itemId, label, recorded,
        'Audit the controls: which sprays went on, which worked, which thresholds were missed.');
    case 'sops_updated':
      return fromRecord(itemId, label, recorded,
        'Write down what changes for next cycle. A cycle that changes nothing has not been reviewed.');
    default:
      return fromRecord(itemId, label, recorded, `Record this against ${gateId} for this zone.`);
  }
}

// ---------------------------------------------------------------------------
// FR-DOC-07 — did it work, and what did the season teach
// ---------------------------------------------------------------------------

/** FR-TREAT-05 / farm_doctor.does: a check three days after every treatment. */
const FOLLOW_UP_DAYS = 3;

const followUpTaskId = (sprayId) => `fd_follow_${sprayId}`;

/**
 * The follow-up task for one spray.
 *
 * Deterministic in the same way the daily schedule is (schedule.js): the id is
 * derived from the spray, so five phones generating it produce one task, and a
 * task already answered is never resurrected.
 */
function followUpTaskFor(state, spray, { today = isoDate() } = {}) {
  const cycle = ((state && state.cycles) || {})[spray.cycleId] || null;
  const zone = cycle ? ((state && state.plots) || {})[cycle.plotId] : null;
  const due = isoDate(addDays(spray.date, FOLLOW_UP_DAYS));
  const what = spray.productName || spray.activeName || 'the treatment';
  return {
    id: followUpTaskId(spray.id),
    kind: 'follow_up',
    title: `Check the ${what} worked — ${(zone && zone.name) || 'bed'}`,
    zoneId: zone ? zone.id : null,
    cycleId: spray.cycleId || null,
    sprayId: spray.id,
    positionId: null,
    due: `${due}T16:00`,
    generated: true,
    proof: true,
    priority: 'high',
    how: [
      'Count the same way you counted before the spray — same traps, same ten plants.',
      'Photograph the damage that made you spray, from the same distance.',
      'Say plainly whether it worked, partly worked, or did nothing.',
    ],
    why: 'A treatment nobody checked is a treatment nobody can learn from, and the next one '
      + 'is a guess again. Three days is long enough to see a change and short enough to fix it.',
    createdFor: today,
  };
}

/** Sprays that still need their three-day check put on the board. */
function missingFollowUps(state, { today = isoDate(), withinDays = 30 } = {}) {
  const tasks = (state && state.tasks) || {};
  return ((state && state.sprays) || [])
    .filter((s) => s.id && s.date && s.date <= today)
    .filter((s) => daysBetween(s.date, today) <= withinDays)
    .filter((s) => !tasks[followUpTaskId(s.id)])
    .map((s) => followUpTaskFor(state, s, { today }));
}

/** The follow-up answer for one spray, if anyone has given it. */
function followUpFor(state, sprayId) {
  return ((state && state.doctorOutputs) || [])
    .filter((o) => o.kind === 'followup' && (o.subject || {}).sprayId === sprayId)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0] || null;
}

/** Trap and scouting counts either side of a spray, which is the evidence it worked. */
function countChange(state, { cycleId, pestId, sprayDate, today = isoDate() }) {
  const scouts = ((state && state.scouts) || [])
    .filter((s) => s.cycleId === cycleId && (!pestId || s.pestId === pestId) && s.date);
  const before = scouts.filter((s) => s.date <= sprayDate).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const after = scouts.filter((s) => s.date > sprayDate && s.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!before || !after) return { before: before || null, after: after || null, change: null };
  const b = Number(before.count);
  const a = Number(after.count);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
    return { before, after, change: null };
  }
  return { before, after, change: round(((a - b) / b) * 100, 0), from: b, to: a };
}

const WORKED = {
  yes: { id: 'yes', label: 'It worked', tone: 'ok' },
  partly: { id: 'partly', label: 'Partly — still some there', tone: 'warn' },
  no: { id: 'no', label: 'No change', tone: 'danger' },
};

/**
 * FR-DOC-07 — the record of whether a treatment worked.
 *
 * The answer a person gives is the record. The counts either side are attached
 * as what the app could see for itself, so a "it worked" against a rising trap
 * count is visible as the disagreement it is rather than quietly filed.
 */
function followUpRecord(state, {
  spray, worked, note = '', person = null, pestId = null, today = isoDate(), rules = peekRules(),
} = {}) {
  const answer = WORKED[String(worked || '').toLowerCase()] ? String(worked).toLowerCase() : null;
  const counts = spray ? countChange(state, {
    cycleId: spray.cycleId, pestId: pestId || spray.targetProblem, sprayDate: spray.date, today,
  }) : { change: null };

  const disagrees = answer === 'yes' && counts.change != null && counts.change > 0;

  const record = doctorOutput({
    kind: 'followup',
    subject: { sprayId: spray && spray.id, cycleId: spray && spray.cycleId, problemId: pestId || (spray && spray.targetProblem) || null },
    confidence: counts.change == null ? 'low' : 'medium',
    rules,
    at: `${today}T16:00:00.000Z`,
    read: [
      spray ? { kind: 'spray', id: spray.id, what: `${spray.productName || 'treatment'} on ${spray.date}` } : null,
      counts.before ? { kind: 'scout', id: counts.before.id, what: `count of ${counts.before.count} on ${counts.before.date}, before` } : null,
      counts.after ? { kind: 'scout', id: counts.after.id, what: `count of ${counts.after.count} on ${counts.after.date}, after` } : null,
    ].filter(Boolean),
    summary: answer
      ? `${WORKED[answer].label}${counts.change != null ? ` — counts ${counts.change > 0 ? 'up' : 'down'} ${Math.abs(counts.change)}%` : ''}.`
      : 'Follow-up check recorded with no answer.',
  });

  return {
    ...record,
    worked: answer,
    note,
    counts,
    observedBy: person ? person.id : null,
    disagreesWithCounts: disagrees,
    // A treatment that did nothing is a diagnosis worth re-opening, not a spray
    // worth repeating. The rules would rather a second opinion than a second dose.
    nextStep: answer === 'no'
      ? 'Do not repeat the same product. Re-diagnose: the cause may be different, or the group may '
        + 'have stopped working. Consider a lab sample.'
      : disagrees
        ? 'The counts went up. Re-count before recording this as a success.'
        : null,
  };
}

/** Every treatment and where its check stands — the board FR-DOC-07 describes. */
function followUpBoard(state, { today = isoDate(), withinDays = 45 } = {}) {
  return ((state && state.sprays) || [])
    .filter((s) => s.date && daysBetween(s.date, today) <= withinDays)
    .map((s) => {
      const due = isoDate(addDays(s.date, FOLLOW_UP_DAYS));
      const answer = followUpFor(state, s.id);
      return {
        spray: s,
        due,
        answered: !!answer,
        worked: answer ? answer.worked : null,
        overdue: !answer && due < today,
        daysLate: !answer && due < today ? daysBetween(due, today) : 0,
        record: answer,
      };
    })
    .sort((a, b) => (a.due < b.due ? 1 : -1));
}

/**
 * FR-DOC-07 — the Gate 4 cycle review, drafted from the season's own records.
 *
 * A draft, and nothing more. Gate 4 is cleared by the Farm Manager and the
 * Owner (FR-GATE-00), and the value of this is that they argue with a filled-in
 * page instead of staring at a blank one at the end of a hard season.
 */
function draftCycleReview(state, cycleId, { today = isoDate(), rules = peekRules() } = {}) {
  const cycle = ((state && state.cycles) || {})[cycleId] || null;
  if (!cycle) {
    return { ...doctorOutput({ kind: 'cycle-review', subject: { cycleId }, confidence: 'low', rules }),
      sections: [], why: 'That cycle is not on record.' };
  }
  const zone = ((state && state.plots) || {})[cycle.plotId] || null;
  const harvests = ((state && state.harvests) || []).filter((h) => h.cycleId === cycleId);
  const sprays = ((state && state.sprays) || []).filter((s) => s.cycleId === cycleId);
  const diagnoses = ((state && state.diagnoses) || []).filter((d) => d.cycleId === cycleId);
  const scouts = ((state && state.scouts) || []).filter((s) => s.cycleId === cycleId);
  const kg = harvests.reduce((n, h) => n + (Number(h.kg) || 0), 0);
  const plants = Number(cycle.plants) || 0;
  const area = Number(cycle.areaM2) || (zone && Number(zone.areaM2)) || 0;
  const end = cycle.closedAt || today;
  const days = cycle.transplantDate ? daysBetween(cycle.transplantDate, end) : null;

  const groupsUsed = [...new Set(sprays.map((s) => groupOfSpray(s, rules)).filter(Boolean))];
  const follow = followUpBoard(state, { today, withinDays: 400 })
    .filter((f) => f.spray.cycleId === cycleId);
  const didNotWork = follow.filter((f) => f.worked === 'no');
  const unchecked = follow.filter((f) => !f.answered);
  const unconfirmed = diagnoses.filter((d) => !d.confirmedBy);
  const rootRead = ((rules && rules.root_read) || {});

  const sections = [
    {
      id: 'what',
      heading: 'What was grown',
      lines: [
        `${(zone && zone.name) || 'Bed'} — ${cycle.variety || cycle.cropId}, transplanted ${cycle.transplantDate || 'date not recorded'}.`,
        days != null ? `${days} days in the ground${cycle.status === 'closed' ? `, closed ${cycle.closedAt}` : ', still standing'}.` : '',
        plants ? `${plants} plants${area ? ` over ${area} m²` : ''}.` : '',
      ].filter(Boolean),
    },
    {
      id: 'yield',
      heading: 'What it gave',
      lines: [
        `${round(kg, 1)} kg over ${harvests.length} picking${harvests.length === 1 ? '' : 's'}.`,
        plants ? `${round(kg / plants, 2)} kg per plant.` : '',
        area ? `${round(kg / area, 2)} kg per m².` : '',
        harvests.length ? '' : 'Nothing was picked from this cycle, which is the first thing to explain.',
      ].filter(Boolean),
    },
    {
      id: 'problems',
      heading: 'What went wrong, and what was done',
      lines: [
        diagnoses.length
          ? `${diagnoses.length} diagnosis record${diagnoses.length === 1 ? '' : 's'}: `
            + [...new Set(diagnoses.map((d) => d.problemName || d.problemId))].join(', ') + '.'
          : 'No diagnosis was recorded all cycle. Either nothing went wrong, or nothing was written down.',
        unconfirmed.length ? `${unconfirmed.length} of them were never confirmed by anyone (FR-DIAG-03).` : '',
        `${scouts.length} scouting record${scouts.length === 1 ? '' : 's'} on file.`,
      ].filter(Boolean),
    },
    {
      id: 'treatments',
      heading: 'Treatments and whether they worked',
      lines: [
        `${sprays.length} treatment${sprays.length === 1 ? '' : 's'}${groupsUsed.length ? `, groups used: ${groupsUsed.join(', ')}` : ''}.`,
        didNotWork.length
          ? `${didNotWork.length} did nothing on the three-day check — ${didNotWork.map((f) => f.spray.productName || 'a spray').join(', ')}. `
            + 'Check the group before reaching for it again next cycle.'
          : '',
        unchecked.length ? `${unchecked.length} treatment${unchecked.length === 1 ? ' was' : 's were'} never checked after three days (FR-DOC-07).` : '',
        groupsUsed.length === 1 && sprays.length > 2
          ? `Everything sprayed was ${groupsUsed[0]}. That is how resistance is built.`
          : '',
      ].filter(Boolean),
    },
    {
      id: 'roots',
      heading: 'Root inspection',
      lines: [
        'Lift sample plants and read the roots before the block is cleared:',
        ...Object.entries(rootRead).filter(([k]) => k !== 'when').map(([look, means]) => `${look} → ${means}`),
      ],
    },
    {
      id: 'next',
      heading: 'What to change next cycle',
      lines: [
        didNotWork.length ? 'Rotate out the groups that failed their check.' : '',
        unconfirmed.length ? 'Confirm diagnoses on the day, not at the end of the cycle.' : '',
        unchecked.length ? 'Answer the three-day check while it is still on the board.' : '',
        'Anything else the Farm Manager and Owner decide belongs here, in their words.',
      ].filter(Boolean),
    },
  ];

  const record = doctorOutput({
    kind: 'cycle-review',
    subject: { cycleId, zoneId: cycle.plotId },
    confidence: harvests.length || sprays.length ? 'medium' : 'low',
    rules,
    read: [
      { kind: 'cycle', id: cycleId, what: `${(zone && zone.name) || 'bed'}, ${cycle.variety || cycle.cropId}` },
      { kind: 'harvests', what: `${harvests.length} pickings, ${round(kg, 1)} kg` },
      { kind: 'sprays', what: `${sprays.length} treatments` },
      { kind: 'diagnoses', what: `${diagnoses.length} diagnoses` },
      { kind: 'scouts', what: `${scouts.length} scouting records` },
    ],
    summary: `Draft Gate 4 review for ${(zone && zone.name) || cycleId}: ${round(kg, 1)} kg, `
      + `${sprays.length} treatments, ${diagnoses.length} diagnoses.`,
  });

  return {
    ...record,
    status: 'draft',
    cycle,
    zone,
    sections,
    totals: { kg: round(kg, 1), harvests: harvests.length, sprays: sprays.length, diagnoses: diagnoses.length },
    // FR-DOC-08: a draft is not a cleared gate, however complete it looks.
    clears: false,
    needsConfirming: CONFIRMS['cycle-review'].who,
    needsApproval: 'Owner',
  };
}
})(__dvModule("web/js/domain/doctor.js"));
__dvBindAll();

// ─── web/js/domain/positions.js ────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "POSITION_TEMPLATE": { enumerable: true, get: () => POSITION_TEMPLATE },
  "holders": { enumerable: true, get: () => holders },
  "isAbsent": { enumerable: true, get: () => isAbsent },
  "resolveOwner": { enumerable: true, get: () => resolveOwner },
  "coverBoard": { enumerable: true, get: () => coverBoard },
  "uncoveredToday": { enumerable: true, get: () => uncoveredToday },
});
let isoDate;
__dvImport("web/js/util.js", (m) => { isoDate = m.isoDate; });
// Positions, not people — section 4 of the requirements.
//
// "Roles are positions, not people. A person can be moved between positions
// without changing the app." That sentence is the whole design.
//
// A task belongs to the Greenhouse Hand for GH-02, not to Emeka. Emeka holds
// that position today. When he is off, the work does not vanish and it does not
// sit in a list nobody reads: it goes to whoever holds the backup for that
// zone, automatically, because FR-ROLE-02 says so and because on a real farm
// the alternative is that nobody checks GH-02 on Thursday.
//
// The awkward case this file exists to handle is the one that actually happens:
// somebody is absent and nobody told the app. So absence is inferred from
// attendance as well as declared, and the fallback runs either way.



/**
 * The positions a farm of this shape needs — section 4.
 *
 * Created once when the farm is set up, then held by whoever is doing that job.
 * The titles match the requirements exactly so the laminated role cards, the
 * training material and the app all use the same words (UX-06).
 */
const POSITION_TEMPLATE = [
  { id: 'pos_owner', title: 'Owner', role: 'ceo', zones: 0 },
  { id: 'pos_manager', title: 'Farm Manager', role: 'manager', zones: 0 },
  { id: 'pos_2ic', title: 'Field Supervisor (2IC)', role: 'supervisor', zones: 0 },
  { id: 'pos_gh1', title: 'Greenhouse Hand — GH-01', role: 'hand', zones: 1 },
  { id: 'pos_gh2', title: 'Greenhouse Hand — GH-02', role: 'hand', zones: 1 },
  { id: 'pos_gh3', title: 'Greenhouse Hand — GH-03', role: 'hand', zones: 1 },
  { id: 'pos_gh4', title: 'Greenhouse Hand — GH-04', role: 'hand', zones: 1 },
];

/** Everyone currently holding a position, keyed by position id. */
function holders(state) {
  const out = {};
  for (const pos of Object.values(state.positions || {})) {
    if (pos.retired) continue;
    out[pos.id] = pos.holderId ? (state.people || {})[pos.holderId] || null : null;
  }
  return out;
}

/**
 * Is this person absent today?
 *
 * Two ways to be absent, and the second is the one that matters. Declared
 * absence is somebody saying so. Inferred absence is nobody clocking in by the
 * time the work is due — which is what actually happens when a phone is flat or
 * a person is ill at six in the morning and tells a cousin rather than an app.
 *
 * `by` is the hour after which a no-show counts. Before that it is simply
 * early, and reassigning work at 05:30 because nobody has clocked in yet would
 * make the whole mechanism untrustworthy.
 */
function isAbsent(state, personId, { today = isoDate(), now = new Date(), by = 9 } = {}) {
  if (!personId) return true;

  const declared = (state.absences || [])
    .some((a) => a.personId === personId && a.date === today && !a.cancelled);
  if (declared) return { absent: true, reason: 'declared' };

  const clockedIn = (state.attendance || [])
    .some((a) => a.personId === personId && (a.in || '').slice(0, 10) === today);
  if (clockedIn) return { absent: false };

  const hour = now.getHours();
  if (hour < by) return { absent: false, reason: 'too-early-to-tell' };
  return { absent: true, reason: 'no-show' };
}

/**
 * Who should actually do this task today — FR-ROLE-02.
 *
 * The position's holder, unless they are absent, in which case whoever holds a
 * position whose backup zone is this one. Returns the reason as well as the
 * person, because a hand who finds someone else's zone on their list deserves
 * to be told why rather than left to guess.
 */
function resolveOwner(state, positionId, { today = isoDate(), now = new Date() } = {}) {
  const position = (state.positions || {})[positionId];
  if (!position) return { person: null, position: null, why: 'No such position.' };

  const holder = position.holderId ? (state.people || {})[position.holderId] : null;
  if (holder && holder.active !== false) {
    const absence = isAbsent(state, holder.id, { today, now });
    if (!absence.absent) return { person: holder, position, covering: false };

    const cover = coverFor(state, position, { today, now });
    if (cover) {
      return {
        person: cover.person,
        position,
        covering: true,
        instead: holder,
        // Written in the third person: this line shows on the manager's cover
        // board as often as on the covering hand's own list.
        why: `${holder.name} is ${absence.reason === 'declared' ? 'marked absent' : 'not clocked in'}`
          + `, so ${position.primaryZoneId ? 'the zone' : 'this work'} passes to `
          + `${cover.person.name} today.`,
      };
    }
    return {
      person: null,
      position,
      covering: false,
      unassigned: true,
      why: `${holder.name} is not in and nobody holds the backup for this zone.`,
    };
  }

  // Nobody holds the position at all. That is a management problem, and saying
  // so beats silently dropping the work.
  const cover = coverFor(state, position, { today, now });
  if (cover) {
    return {
      person: cover.person, position, covering: true,
      why: `Nobody holds this position, so ${cover.person.name} covers it as the backup.`,
    };
  }
  return { person: null, position, unassigned: true, why: 'Nobody holds this position.' };
}

/** Whoever has this position's zone as their backup zone, and is actually in. */
function coverFor(state, position, { today, now }) {
  if (!position.primaryZoneId) return null;
  for (const other of Object.values(state.positions || {})) {
    if (other.id === position.id || other.retired) continue;
    if (other.backupZoneId !== position.primaryZoneId) continue;
    const person = other.holderId ? (state.people || {})[other.holderId] : null;
    if (!person || person.active === false) continue;
    if (isAbsent(state, person.id, { today, now }).absent) continue;
    return { person, position: other };
  }
  return null;
}

/**
 * The cover plan, for the Farm Manager's screen.
 *
 * Every position, who holds it, whether they are in, and who is picking it up
 * if they are not. This is the screen that answers "is GH-04 being checked
 * today?" without anyone having to ask three people.
 */
function coverBoard(state, { today = isoDate(), now = new Date() } = {}) {
  return Object.values(state.positions || {})
    .filter((p) => !p.retired)
    .map((position) => {
      const resolved = resolveOwner(state, position.id, { today, now });
      const holder = position.holderId ? (state.people || {})[position.holderId] : null;
      return {
        position,
        holder,
        zone: position.primaryZoneId ? (state.plots || {})[position.primaryZoneId] : null,
        backupZone: position.backupZoneId ? (state.plots || {})[position.backupZoneId] : null,
        doing: resolved.person,
        covering: !!resolved.covering,
        unassigned: !!resolved.unassigned,
        why: resolved.why || null,
      };
    })
    .sort((a, b) => Number(b.unassigned) - Number(a.unassigned)
      || Number(b.covering) - Number(a.covering));
}

/**
 * Gaps a Farm Manager needs to close — positions with nobody doing them today.
 * Feeds the digest, because an unchecked house is exactly the kind of thing the
 * Owner could not see from anywhere else.
 */
function uncoveredToday(state, opts = {}) {
  return coverBoard(state, opts).filter((row) => row.unassigned);
}
})(__dvModule("web/js/domain/positions.js"));
__dvBindAll();

// ─── web/js/domain/assignments.js ──────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "HOLDINGS": { enumerable: true, get: () => HOLDINGS },
  "SUPERVISING": { enumerable: true, get: () => SUPERVISING },
  "OVERDUE_LADDER": { enumerable: true, get: () => OVERDUE_LADDER },
  "hasFarmView": { enumerable: true, get: () => hasFarmView },
  "liveAssignments": { enumerable: true, get: () => liveAssignments },
  "zoneHolders": { enumerable: true, get: () => zoneHolders },
  "zonesHeldBy": { enumerable: true, get: () => zonesHeldBy },
  "presentOn": { enumerable: true, get: () => presentOn },
  "doersFor": { enumerable: true, get: () => doersFor },
  "ownersOf": { enumerable: true, get: () => ownersOf },
  "isOverdue": { enumerable: true, get: () => isOverdue },
  "escalationFor": { enumerable: true, get: () => escalationFor },
  "mayAssignZones": { enumerable: true, get: () => mayAssignZones },
  "checkAssignment": { enumerable: true, get: () => checkAssignment },
  "myWork": { enumerable: true, get: () => myWork },
  "farmWork": { enumerable: true, get: () => farmWork },
  "weekStart": { enumerable: true, get: () => weekStart },
  "weekSpread": { enumerable: true, get: () => weekSpread },
});
let addDays, isoDate;
let isAbsent, resolveOwner;
let tasksFor;
__dvImport("web/js/util.js", (m) => { addDays = m.addDays; }, (m) => { isoDate = m.isoDate; });
__dvImport("web/js/domain/positions.js", (m) => { isAbsent = m.isAbsent; }, (m) => { resolveOwner = m.resolveOwner; });
__dvImport("web/js/domain/schedule.js", (m) => { tasksFor = m.tasksFor; });
// Field assignments — requirements §4.1, FR-ROLE-05 to FR-ROLE-11.
//
// Section 4 made jobs positions rather than people, and that still holds. What
// it did not say is that a Farm Manager on a farm this size is also in the
// houses: he walks GH-03 himself when a hand is off, the Field Supervisor holds
// OF-01 because nobody else is trained on the ridges, and the Owner scouts the
// nursery on a Sunday. Before this file that work lived nowhere — the manager's
// own scouting round was a task on nobody's list, which is the exact shape of
// the gap Season 1 fell into.
//
// So a field assignment is one person holding one zone, as its primary or its
// backup. Anyone may hold one, in any role (FR-ROLE-05). A zone can carry
// several people and a person several zones (FR-ROLE-07). The positions from
// section 4 still count: whoever holds "Greenhouse Hand — GH-02" holds GH-02 as
// its primary, exactly as before, so nothing already set up changes meaning.
//
// Who does a task is resolved when it is read, never written onto the task, so
// an absence or a new assignment moves the work without anybody editing it —
// the same rule positions.js follows for FR-ROLE-02.
//
// The one thing a person's own work must never do is escalate to themselves.
// A Field Supervisor whose own scouting round is late does not get a reminder
// from the Field Supervisor rung; it goes to the Farm Manager (FR-ROLE-10).





/** The two ways to hold a zone — FR-ROLE-01, per zone rather than per position. */
const HOLDINGS = ['primary', 'backup'];

/** Roles that get both views, My work and The farm — FR-ROLE-08. */
const SUPERVISING = new Set(['supervisor', 'manager', 'ceo']);

/**
 * The overdue ladder — FR-TASK-03 with FR-ROLE-10.
 *
 * Overdue work goes to the Field Supervisor first. A rung is skipped when the
 * person whose task it is holds it, so the Supervisor's own goes to the Farm
 * Manager and the Farm Manager's own goes to the Owner.
 */
const OVERDUE_LADDER = [
  { rung: 'supervisor', title: 'Field Supervisor', rank: 50 },
  { rung: 'manager', title: 'Farm Manager', rank: 80 },
  { rung: 'ceo', title: 'Owner', rank: 100 },
];

const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOf = (person) => (person ? RANK[person.role] ?? -1 : -1);

function hasFarmView(user) {
  return !!user && SUPERVISING.has(user.role);
}

const peopleOf = (state) => (state && state.people) || {};
const active = (person) => !!person && person.active !== false;
const dayOf = (task) => (task.due || '').slice(0, 10) || task.dueDate || null;
/** A task written against a bed rather than a zone still belongs to that bed's zone. */
const zoneOf = (state, task) => task.zoneId
  || (task.cycleId && ((state && state.cycles) || {})[task.cycleId]
    ? state.cycles[task.cycleId].plotId : null);

/** Every live assignment on the farm, newest first. */
function liveAssignments(state) {
  return Object.values((state && state.assignments) || {})
    .filter((a) => !a.ended)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/**
 * Who holds a zone — FR-ROLE-07.
 *
 * Assignments and positions together, one entry per person per holding. A
 * person on both lists (say, primary by position and backup by assignment) is
 * kept on the primary list only, because that is the stronger claim.
 */
function zoneHolders(state, zoneId) {
  const people = peopleOf(state);
  const out = { primary: [], backup: [] };
  const seen = { primary: new Set(), backup: new Set() };
  const add = (holding, person, via) => {
    if (!active(person) || seen[holding].has(person.id)) return;
    seen[holding].add(person.id);
    out[holding].push({ person, holding, ...via });
  };

  for (const a of liveAssignments(state)) {
    if (a.zoneId !== zoneId) continue;
    add(a.holding === 'backup' ? 'backup' : 'primary', people[a.personId],
      { via: 'assignment', assignmentId: a.id });
  }
  for (const pos of Object.values((state && state.positions) || {})) {
    if (pos.retired || !pos.holderId) continue;
    if (pos.primaryZoneId === zoneId) add('primary', people[pos.holderId], { via: 'position', positionId: pos.id });
    if (pos.backupZoneId === zoneId) add('backup', people[pos.holderId], { via: 'position', positionId: pos.id });
  }
  out.backup = out.backup.filter((h) => !seen.primary.has(h.person.id));
  const byName = (a, b) => String(a.person.name).localeCompare(String(b.person.name));
  out.primary.sort(byName);
  out.backup.sort(byName);
  return out;
}

/** The zones one person holds, with how — the top of their My work (FR-ROLE-05). */
function zonesHeldBy(state, personId) {
  const plots = (state && state.plots) || {};
  const out = [];
  for (const zone of Object.values(plots)) {
    if (zone.retired) continue;
    const h = zoneHolders(state, zone.id);
    const mine = h.primary.find((x) => x.person.id === personId)
      || h.backup.find((x) => x.person.id === personId);
    if (mine) out.push({ zone, holding: mine.holding, via: mine.via });
  }
  return out.sort((a, b) => (a.holding === b.holding
    ? String(a.zone.name).localeCompare(String(b.zone.name))
    : a.holding === 'primary' ? -1 : 1));
}

/**
 * Is this person working on that date?
 *
 * Today is judged the way positions.js judges it: declared, or not clocked in
 * once the morning is out. A future day only knows about declared absence — a
 * roster for next Thursday cannot assume nobody turns up. A past day that has
 * ended counts a person who never clocked in as out, which is what the
 * attendance book says. `roster` reads declared absence only, for a plan of
 * the week rather than a record of it.
 */
function presentOn(state, personId, date, { today = isoDate(), now = new Date(), roster = false } = {}) {
  const declared = ((state && state.absences) || [])
    .some((a) => a.personId === personId && a.date === date && !a.cancelled);
  if (declared) return false;
  if (roster || date > today) return true;
  const when = date === today ? now : new Date(`${date}T23:59:00`);
  return !isAbsent(state, personId, { today: date, now: when }).absent;
}

/**
 * Who does this task on its day — FR-ROLE-05/07 with FR-ROLE-02.
 *
 * A task written for one person stays with that person. Otherwise it goes to
 * everyone who holds its zone as primary and is in; when none of them is, to
 * the backup holders who are; when nobody is, it is uncovered and says why.
 * A zone nobody holds at all is `unheld`, and The farm lists it as a gap.
 */
function doersFor(state, task, { today = isoDate(), now = new Date(), roster = false } = {}) {
  const people = peopleOf(state);
  const date = dayOf(task) || today;

  if (task.assignedTo) {
    const person = people[task.assignedTo];
    return { people: active(person) ? [person] : [], covering: false, direct: true };
  }

  const zoneId = zoneOf(state, task);
  if (zoneId) {
    const zone = ((state && state.plots) || {})[zoneId];
    const name = zone ? zone.name : 'this zone';
    const holders = zoneHolders(state, zoneId);
    if (!holders.primary.length && !holders.backup.length) {
      if (task.positionId) return fromPosition(state, task, { today, now });
      return { people: [], unheld: true, why: `Nobody holds ${name}.` };
    }
    const here = (list) => list.filter((h) => presentOn(state, h.person.id, date, { today, now, roster }));
    const primary = here(holders.primary);
    if (primary.length) return { people: primary.map((h) => h.person), covering: false };
    const backup = here(holders.backup);
    const away = holders.primary.map((h) => h.person.name).join(' and ');
    if (backup.length) {
      return {
        people: backup.map((h) => h.person),
        covering: true,
        instead: holders.primary.map((h) => h.person),
        why: holders.primary.length
          ? `${away} ${holders.primary.length === 1 ? 'is' : 'are'} not in, so ${name} passes to `
            + `${backup.map((h) => h.person.name).join(' and ')} as backup.`
          : `${name} has no primary holder, so the backup takes it.`,
      };
    }
    return {
      people: [],
      unassigned: true,
      why: `${away || 'The holders'} ${holders.primary.length === 1 ? 'is' : 'are'} not in and `
        + `no backup for ${name} is either.`,
    };
  }

  if (task.positionId) return fromPosition(state, task, { today, now });
  return { people: [], unheld: true, why: 'This task is not tied to a zone or a person.' };
}

function fromPosition(state, task, { today, now }) {
  const r = resolveOwner(state, task.positionId, { today: dayOf(task) || today, now });
  if (r.person) return { people: [r.person], covering: !!r.covering, why: r.why || null };
  return { people: [], unassigned: true, why: r.why || 'Nobody holds this position.' };
}

/**
 * Whose task it is, for the ladder: whoever is doing it today, and the
 * primary holders of its zone whether or not they are in. A Farm Manager who
 * has not clocked in is still the person whose round is late.
 */
function ownersOf(state, task, opts = {}) {
  const out = new Map();
  for (const p of doersFor(state, task, opts).people) out.set(p.id, p);
  if (!task.assignedTo) {
    const zoneId = zoneOf(state, task);
    if (zoneId) for (const h of zoneHolders(state, zoneId).primary) out.set(h.person.id, h.person);
    else if (task.positionId) {
      const pos = ((state && state.positions) || {})[task.positionId];
      const holder = pos && pos.holderId ? peopleOf(state)[pos.holderId] : null;
      if (active(holder)) out.set(holder.id, holder);
    }
  }
  return [...out.values()];
}

/** Is it past due and still open? */
function isOverdue(task, now = new Date()) {
  return !!task && task.status === 'open' && !!task.due && new Date(task.due) < now;
}

/**
 * Where overdue work goes — FR-TASK-03 and FR-ROLE-10.
 *
 * Up the ladder from the Field Supervisor, skipping any rung held by the
 * person whose task it is, any rung at or below their own standing, and any
 * rung with nobody on it. The Owner's own late task has nowhere higher to go,
 * so it stays on the Owner's list, marked late.
 */
function escalationFor(state, task, { today = isoDate(), now = new Date() } = {}) {
  if (!isOverdue(task, now)) return null;
  const owners = ownersOf(state, task, { today, now });
  const top = Math.max(-1, ...owners.map(rankOf));
  const everyone = Object.values(peopleOf(state)).filter(active);
  const skipped = [];

  for (const step of OVERDUE_LADDER) {
    const own = owners.find((o) => o.role === step.rung);
    if (own) { skipped.push({ rung: step.rung, why: `${own.name} is the ${step.title}, and it is their own task.` }); continue; }
    if (step.rank <= top) { skipped.push({ rung: step.rung, why: `The ${step.title} is not above whoever it belongs to.` }); continue; }
    const to = everyone.filter((p) => p.role === step.rung && !owners.some((o) => o.id === p.id));
    if (!to.length) { skipped.push({ rung: step.rung, why: `Nobody is the ${step.title}.` }); continue; }
    return {
      rung: step.rung,
      title: step.title,
      to,
      skipped,
      why: `Late, so it moves to the ${step.title}`
        + (skipped.length ? ` (${skipped.map((s) => s.why).join(' ')})` : '') + '.',
    };
  }
  return {
    rung: null, title: null, to: owners.filter((o) => o.role === 'ceo'), skipped, top: true,
    why: 'Nobody sits above the Owner, so it stays on the Owner\'s own list.',
  };
}

/**
 * May this person hand out zones today? — FR-ROLE-06.
 *
 * The Farm Manager and the Owner, always. The Field Supervisor when covering,
 * which means the Farm Manager is not in today — declared off or not clocked
 * in once the morning is out — or the farm has no Farm Manager at all.
 */
function mayAssignZones(state, user, { today = isoDate(), now = new Date() } = {}) {
  if (!user) return { ok: false, why: 'Sign in first.' };
  if (user.role === 'manager' || user.role === 'ceo') return { ok: true, how: 'manager' };
  if (user.role !== 'supervisor') {
    return { ok: false, why: 'Zones are assigned by the Farm Manager, or the Field Supervisor when covering.' };
  }
  const managers = Object.values(peopleOf(state)).filter((p) => active(p) && p.role === 'manager');
  const inToday = managers.filter((m) => !isAbsent(state, m.id, { today, now }).absent);
  if (!inToday.length) {
    return {
      ok: true,
      how: 'covering',
      coveringFor: managers.map((m) => m.id),
      why: managers.length
        ? `Covering for ${managers.map((m) => m.name).join(' and ')}, who ${managers.length === 1 ? 'is' : 'are'} not in today.`
        : 'Covering: the farm has no Farm Manager.',
    };
  }
  return {
    ok: false,
    why: `${inToday.map((m) => m.name).join(' and ')} ${inToday.length === 1 ? 'is' : 'are'} in today. `
      + 'The Field Supervisor assigns zones only when covering for the Farm Manager.',
  };
}

/** The checks one assignment has to pass, shared by the screen and the event log. */
function checkAssignment(state, payload, user, opts = {}) {
  const who = mayAssignZones(state, user, opts);
  if (!who.ok) return who;
  const p = payload || {};
  const person = peopleOf(state)[p.personId];
  if (!active(person)) return { ok: false, why: 'Choose somebody on the staff list.' };
  const zone = ((state && state.plots) || {})[p.zoneId];
  if (!zone || zone.retired) return { ok: false, why: 'Choose a zone that is in use.' };
  if (!HOLDINGS.includes(p.holding)) return { ok: false, why: 'Say whether it is their primary or backup zone.' };
  return { ok: true, how: who.how, person, zone };
}

/** Today's tasks, generated or on the log, without doubles. */
function dayTasks(state, date) {
  const logged = Object.values((state && state.tasks) || {})
    .filter((t) => t.status !== 'cancelled' && dayOf(t) === date);
  const ids = new Set(logged.map((t) => t.id));
  let planned = [];
  try { planned = tasksFor(state, { date }); } catch { planned = []; }
  return [...logged, ...planned.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, status: 'open', planned: true }))];
}

const byDue = (a, b) => ((a.due || '') < (b.due || '') ? -1 : (a.due || '') > (b.due || '') ? 1 : 0);

/**
 * My work — FR-ROLE-05, FR-ROLE-08 and FR-ROLE-09.
 *
 * The same list for everybody: the day's tasks for the zones this person holds
 * (or covers), anything written for them by name, and — for whoever sits on
 * the rung it climbed to — late work that has moved up to them. The last is
 * how FR-TASK-03 reaches a list rather than a report.
 */
function myWork(state, personId, { date = isoDate(), now = new Date(), today = date } = {}) {
  const opts = { today, now };
  const mine = [];
  for (const task of Object.values((state && state.tasks) || {})) {
    if (task.status === 'cancelled') continue;
    const day = dayOf(task);
    // Tasks written by hand before times were a thing carry a day, not an
    // hour, and stay on the list until somebody does them.
    const legacyOpen = !task.due && task.status === 'open' && (!task.dueDate || task.dueDate <= date);
    if (day !== date && !legacyOpen) continue;
    const who = doersFor(state, task, opts);
    if (!who.people.some((p) => p.id === personId)) continue;
    mine.push({ task, covering: !!who.covering, why: who.covering ? who.why : null });
  }
  mine.sort((a, b) => byDue(a.task, b.task));

  const me = peopleOf(state)[personId];
  const moved = [];
  const unheld = [];
  for (const task of Object.values((state && state.tasks) || {})) {
    if (!isOverdue(task, now) || (dayOf(task) || '') > date) continue;
    const up = escalationFor(state, task, opts);
    if (up && up.to.some((p) => p.id === personId) && !mine.some((m) => m.task.id === task.id)) {
      moved.push({ task, escalation: up });
    }
  }
  // A zone nobody holds is a gap, and a gap is the first rung's to fill.
  if (me && me.role === firstRung(state)) {
    for (const task of Object.values((state && state.tasks) || {})) {
      if (task.status !== 'open' || dayOf(task) !== date) continue;
      const who = doersFor(state, task, opts);
      if (who.unheld || who.unassigned) unheld.push({ task, why: who.why });
    }
  }
  const done = mine.filter((m) => m.task.status === 'done').length;
  return {
    zones: zonesHeldBy(state, personId),
    tasks: mine,
    moved: moved.sort((a, b) => byDue(a.task, b.task)),
    unheld: unheld.sort((a, b) => byDue(a.task, b.task)),
    progress: {
      total: mine.length,
      done,
      fraction: mine.length ? done / mine.length : 0,
      text: mine.length ? `${done} of ${mine.length} done` : 'Nothing scheduled today',
    },
  };
}

/** The lowest rung of the ladder that somebody actually stands on. */
function firstRung(state) {
  const roles = new Set(Object.values(peopleOf(state)).filter(active).map((p) => p.role));
  const step = OVERDUE_LADDER.find((s) => roles.has(s.rung));
  return step ? step.rung : null;
}

/**
 * The farm — FR-ROLE-08.
 *
 * Everything My work shows, for the whole farm at once: each zone with its
 * holders and its day, the gaps, and every late task with where it went.
 */
function farmWork(state, { date = isoDate(), now = new Date(), today = date } = {}) {
  const opts = { today, now };
  const zones = Object.values((state && state.plots) || {})
    .filter((z) => !z.retired)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((zone) => {
      const tasks = Object.values((state && state.tasks) || {})
        .filter((t) => zoneOf(state, t) === zone.id && t.status !== 'cancelled' && dayOf(t) === date)
        .sort(byDue);
      const doers = tasks.length ? doersFor(state, tasks[0], opts) : doersFor(state, { zoneId: zone.id, due: `${date}T12:00` }, opts);
      return {
        zone,
        holders: zoneHolders(state, zone.id),
        tasks,
        done: tasks.filter((t) => t.status === 'done').length,
        doing: doers.people,
        covering: !!doers.covering,
        gap: !!(doers.unheld || doers.unassigned),
        why: doers.why || null,
      };
    });
  const late = Object.values((state && state.tasks) || {})
    .filter((t) => isOverdue(t, now) && (dayOf(t) || '') <= date)
    .sort(byDue)
    .map((task) => ({ task, owners: ownersOf(state, task, opts), escalation: escalationFor(state, task, opts) }));
  return { date, zones, late };
}

/** Monday of the week a date falls in. */
function weekStart(date = isoDate()) {
  const d = new Date(`${date}T12:00:00`);
  const back = (d.getDay() + 6) % 7;
  return isoDate(addDays(date, -back));
}

/**
 * How the week's work is spread across people — FR-ROLE-11.
 *
 * Seven days from Monday. Days already on the log use what is there (a done
 * task counts for whoever did it); days not generated yet use the schedule, so
 * Thursday's load is visible on Monday while it can still be moved. It reads
 * the roster — holdings and declared absence — not who clocked in. A task two
 * people hold is counted for both, because both are on the hook for it; the
 * total line counts each task once.
 */
function weekSpread(state, { start = weekStart(), now = new Date(), today = isoDate(now) } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  const rows = new Map();
  const people = peopleOf(state);
  const rowFor = (person) => {
    if (!rows.has(person.id)) {
      rows.set(person.id, {
        person, zones: zonesHeldBy(state, person.id),
        perDay: days.map(() => ({ total: 0, done: 0, late: 0 })), total: 0, done: 0, late: 0,
      });
    }
    return rows.get(person.id);
  };
  for (const p of Object.values(people)) {
    if (active(p) && zonesHeldBy(state, p.id).length) rowFor(p);
  }
  const gaps = days.map(() => 0);
  const totals = days.map(() => 0);

  days.forEach((date, i) => {
    for (const task of dayTasks(state, date)) {
      totals[i] += 1;
      let who;
      if (task.status === 'done' && task.doneBy && people[task.doneBy]) who = [people[task.doneBy]];
      else who = doersFor(state, task, { today, now, roster: true }).people;
      if (!who.length) { gaps[i] += 1; continue; }
      for (const person of who) {
        const row = rowFor(person);
        const cell = row.perDay[i];
        cell.total += 1; row.total += 1;
        if (task.status === 'done') { cell.done += 1; row.done += 1; }
        // A day the schedule planned but nobody ever put on the log was never
        // issued, so it is not anybody's late work.
        else if (!task.planned && isOverdue(task, now)) { cell.late += 1; row.late += 1; }
      }
    }
  });

  const list = [...rows.values()].sort((a, b) => b.total - a.total
    || String(a.person.name).localeCompare(String(b.person.name)));
  const loads = list.map((r) => r.total);
  const mean = loads.length ? loads.reduce((s, n) => s + n, 0) / loads.length : 0;
  for (const r of list) {
    r.share = totals.reduce((s, n) => s + n, 0) ? r.total / totals.reduce((s, n) => s + n, 0) : 0;
    r.heavy = list.length > 1 && mean > 0 && r.total > mean * 1.5;
  }
  return { start, days, rows: list, gaps, totals, gapTotal: gaps.reduce((s, n) => s + n, 0) };
}
})(__dvModule("web/js/domain/assignments.js"));
__dvBindAll();

// ─── web/js/store.js ───────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "ROLES": { enumerable: true, get: () => ROLES },
  "ROLE_LIST": { enumerable: true, get: () => ROLE_LIST },
  "roleRank": { enumerable: true, get: () => roleRank },
  "can": { enumerable: true, get: () => can },
  "assignableRoles": { enumerable: true, get: () => assignableRoles },
  "canAssignRole": { enumerable: true, get: () => canAssignRole },
  "canEditPerson": { enumerable: true, get: () => canEditPerson },
  "canRemovePerson": { enumerable: true, get: () => canRemovePerson },
  "DEFAULT_SETTINGS": { enumerable: true, get: () => DEFAULT_SETTINGS },
  "reduce": { enumerable: true, get: () => reduce },
  "setPractice": { enumerable: true, get: () => setPractice },
  "isPractice": { enumerable: true, get: () => isPractice },
  "createStore": { enumerable: true, get: () => createStore },
  "activeCycles": { enumerable: true, get: () => activeCycles },
  "closedCycles": { enumerable: true, get: () => closedCycles },
  "cycleLabel": { enumerable: true, get: () => cycleLabel },
  "spraysForCycle": { enumerable: true, get: () => spraysForCycle },
  "openTasks": { enumerable: true, get: () => openTasks },
  "openReports": { enumerable: true, get: () => openReports },
  "shiftsOn": { enumerable: true, get: () => shiftsOn },
  "harvestsBetween": { enumerable: true, get: () => harvestsBetween },
  "todayAttendance": { enumerable: true, get: () => todayAttendance },
  "isClockedIn": { enumerable: true, get: () => isClockedIn },
  "payrollBetween": { enumerable: true, get: () => payrollBetween },
  "inputsList": { enumerable: true, get: () => inputsList },
  "inputUsage": { enumerable: true, get: () => inputUsage },
  "costsBetween": { enumerable: true, get: () => costsBetween },
  "revenueBetween": { enumerable: true, get: () => revenueBetween },
});
let appendEvents, deviceId, loadEvents;
let confirmStepDone, isLegacyDiagnosis, isPhotoSlot;
let approverFor, awaitingApproval, beforeApprovalCheck, canApprove, otherConfirmers;
let CONFIRMS, DOCTOR;
let releaseCheck;
let fillCheck;
let checkAssignment, mayAssignZones;
let peekRules;
let isoDate, sortBy, sum, uid;
__dvImport("web/js/db.js", (m) => { appendEvents = m.appendEvents; }, (m) => { deviceId = m.deviceId; }, (m) => { loadEvents = m.loadEvents; });
__dvImport("web/js/domain/diagnose.js", (m) => { confirmStepDone = m.confirmStepDone; }, (m) => { isLegacyDiagnosis = m.isLegacyDiagnosis; }, (m) => { isPhotoSlot = m.isPhotoSlot; });
__dvImport("web/js/domain/selfcheck.js", (m) => { approverFor = m.approverFor; }, (m) => { awaitingApproval = m.awaitingApproval; }, (m) => { beforeApprovalCheck = m.beforeApprovalCheck; }, (m) => { canApprove = m.canApprove; }, (m) => { otherConfirmers = m.otherConfirmers; });
__dvImport("web/js/domain/doctor.js", (m) => { CONFIRMS = m.CONFIRMS; }, (m) => { DOCTOR = m.DOCTOR; });
__dvImport("web/js/domain/nursery.js", (m) => { releaseCheck = m.releaseCheck; });
__dvImport("web/js/domain/gates.js", (m) => { fillCheck = m.fillCheck; });
__dvImport("web/js/domain/assignments.js", (m) => { checkAssignment = m.checkAssignment; }, (m) => { mayAssignZones = m.mayAssignZones; });
__dvImport("web/js/rules.js", (m) => { peekRules = m.peekRules; });
__dvImport("web/js/util.js", (m) => { isoDate = m.isoDate; }, (m) => { sortBy = m.sortBy; }, (m) => { sum = m.sum; }, (m) => { uid = m.uid; });
// State. Events in, farm out.
//
// reduce() is a pure function of the event log, exported on its own so it can be
// tested without a browser. createStore() wraps it with persistence and change
// notification.











/**
 * Who can do what.
 *
 * `rank` is the authority order, and it decides account creation as well as
 * visibility: you may only create an account below your own rank, so a manager
 * can take on hands and supervisors but cannot appoint another manager or
 * remove the owner. Only the CEO holds `manageOwners`, which lifts that ceiling.
 *
 * FR-DIAG-03/07: `guideDiagnosis` — the full guided diagnosis, triage rows to
 * card to confirm test — is the Field Supervisor's and the Farm Manager's and
 * nobody else's. A farm hand holds `reportProblem` and reports a sick plant;
 * the diagnosis opens from that report (domain/sickplant.js).
 *
 * FR-LEARN-02: `viewTreatment` is the supervising view of a problem card —
 * doses, rotation groups, treatment plans. Every role but the farm hand holds
 * it; a hand reads the same card in Learn, without them.
 *
 * FR-SCOUT-01/03, FR-FARM-04: `countTraps` — everyone, the farm hand
 * included, records the sticky-trap count as a number, and that count opens
 * an alert like anybody's. A full scouting round (`scout`: per-plant counts,
 * findings) stays with the Field Supervisor and above (domain/traps.js).
 */
const ROLES = {
  hand: {
    id: 'hand', name: 'Farm hand', pidgin: 'Farm hand', rank: 10,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps'],
    home: '#/today',
    blurb: 'Sees today\'s jobs, records work and harvest, reports anything wrong.',
  },
  supervisor: {
    id: 'supervisor', name: 'Supervisor', pidgin: 'Oga for field', rank: 50,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'guideDiagnosis', 'viewTreatment'],
    home: '#/field',
    blurb: 'Assigns the day\'s work, checks the harvest, records sprays and inputs.',
  },
  agronomist: {
    id: 'agronomist', name: 'Agronomist', pidgin: 'Crop doctor', rank: 60,
    can: ['viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose', 'scout', 'logSpray', 'prescribe', 'manageCycles',
      'viewTeam', 'viewReports', 'assignTasks', 'viewTreatment'],
    home: '#/clinic',
    blurb: 'Diagnoses problems, writes the spray plan, watches the risk board.',
  },
  manager: {
    id: 'manager', name: 'Farm manager', pidgin: 'Oga', rank: 80,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings', 'guideDiagnosis', 'viewTreatment'],
    home: '#/dashboard',
    blurb: 'Runs the farm day to day: work, money, people, planning and reports.',
  },
  ceo: {
    id: 'ceo', name: 'CEO', pidgin: 'Chairman', rank: 100,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings',
      'manageOwners', 'manageSync', 'viewAudit', 'wipeFarm', 'viewTreatment'],
    home: '#/dashboard',
    blurb: 'Owns the farm. Sees everything, appoints the manager and everyone else, '
      + 'and controls the link that keeps every phone in step.',
  },
};

/** Roles from the top down, for pickers and tables. */
const ROLE_LIST = Object.values(ROLES).sort((a, b) => b.rank - a.rank);

function roleRank(person) {
  if (!person) return -1;
  const role = ROLES[person.role || person];
  return role ? role.rank : -1;
}

function can(person, permission) {
  if (!person) return false;
  const role = ROLES[person.role];
  return !!role && role.can.includes(permission);
}

/**
 * Which roles this person may hand out.
 *
 * The CEO may appoint anyone, including a second owner. Everyone else with
 * people authority may only appoint below themselves, which is what stops a
 * manager quietly promoting themselves or creating a rival manager.
 */
function assignableRoles(actor) {
  if (!can(actor, 'managePeople')) return [];
  if (can(actor, 'manageOwners')) return ROLE_LIST.map((r) => r.id);
  const mine = roleRank(actor);
  return ROLE_LIST.filter((r) => r.rank < mine).map((r) => r.id);
}

/** Whether this person may create or change an account holding that role. */
function canAssignRole(actor, targetRole) {
  return assignableRoles(actor).includes(targetRole);
}

/**
 * Whether this person may edit that account.
 *
 * Anyone may edit their own details. Otherwise the target's current role must be
 * one you could have assigned in the first place, so a manager cannot edit the
 * CEO or another manager.
 */
function canEditPerson(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return true;
  if (!can(actor, 'managePeople')) return false;
  return canAssignRole(actor, target.role);
}

/**
 * The farm must never be left without an owner: removing the last CEO would
 * lock everyone out of sync setup and account creation for good.
 */
function canRemovePerson(actor, target, state) {
  if (!canEditPerson(actor, target)) return { ok: false, why: 'You cannot change that account.' };
  if (actor.id === target.id) return { ok: false, why: 'You cannot remove your own account.' };
  if (target.role === 'ceo') {
    const owners = Object.values(state.people)
      .filter((p) => p.role === 'ceo' && p.active !== false);
    if (owners.length <= 1) {
      return { ok: false, why: 'This is the only CEO account. Appoint another owner first, '
        + 'otherwise nobody can create accounts or manage the sync link.' };
    }
  }
  return { ok: true };
}

const DEFAULT_SETTINGS = {
  farmName: 'DouValue Farms Limited',
  location: 'Port Harcourt, Rivers State',
  currency: 'NGN',
  language: 'en',
  crateKg: 12,           // what one crate of pepper weighs on this farm
  basketKg: 25,
  prices: { bell: 1400, chili: 1800, habanero: 2600 },
  seasonality: null,      // null means use the built-in index
  gradeOutPct: 12,
  kgPerPersonHour: 12,
  defaultDailyWage: 3500,
  overtimeRatePerHour: 700,
  soilPh: 5.2,
};

const EMPTY = () => ({
  settings: { ...DEFAULT_SETTINGS },
  people: {},
  plots: {},
  cycles: {},
  tasks: {},
  inputs: {},
  actives: {},
  labels: {},
  harvests: [],
  sales: [],
  sprays: [],
  scouts: [],
  diagnoses: [],
  doctorOutputs: [],
  // Reference photos for the triage rows and diagnosis cards, keyed by slot.
  referencePhotos: {},
  soilTests: [],
  topsoilBatches: {},
  gateOverrides: [],
  // FR-FARM-05 — seedling batches in the nursery, keyed by id.
  seedlingBatches: {},
  // C-19 — plant-bag media: batches keyed by id, and every fill batch → bags → zone.
  mediaBatches: {},
  mediaFills: [],
  // FR-ONB-03 — entries typed in on the day the farm went live, for crops
  // already in the ground. Kept apart from the live lists on purpose: a
  // backfilled spray is not a treatment the app gated. domain/onboarding.js
  // is what reads them, and hands the sprays to the rotation and the PHI.
  backfills: [],
  onboardRefused: [],
  // §6.14 — the Farm Doctor. Its outputs, the evidence people record against
  // gates, and the samples that went to a lab.
  doctorOutputs: [],
  gateEvidence: [],
  labSamples: [],
  alertAcks: [],
  alertDecisions: [],
  positions: {},
  // §4.1, FR-ROLE-05 to 07 — one person holding one zone, primary or backup,
  // in any role. Keyed by id; an ended one is kept with who ended it.
  assignments: {},
  assignRefused: [],
  absences: [],
  expenses: [],
  stockMoves: [],
  attendance: [],
  workLogs: [],
  weather: [],
  reports: [],
  shifts: [],
  log: [],
  orphans: [],
});

/**
 * Rebuild the whole farm from its event log. Pure: same events, same state.
 *
 * Events are replayed in timestamp order, but timestamps cannot be trusted to
 * put things in causal order. Phones on this farm are offline for days, their
 * clocks drift, and a supervisor may type up Monday's paper notes on Thursday.
 * So an event that changes something which does not exist yet is parked rather
 * than dropped, and replayed the moment its subject turns up. Without that, a
 * task completed at 07:00 against a task created at 09:00 would silently vanish,
 * and the worker who did the job would be told to do it again.
 */
function reduce(events) {
  const state = EMPTY();
  const ordered = sortBy(events.filter(Boolean), (e) => e.at || '');

  // Events waiting for the thing they refer to, keyed by "kind:id".
  const parked = new Map();

  /** What an event creates, if anything. */
  const creates = (type, p) => {
    switch (type) {
      case 'cycle.start': case 'cycle.onboard': return `cycle:${p.id}`;
      case 'task.create': return `task:${p.id}`;
      case 'harvest.record': return `harvest:${p.id}`;
      case 'report.record': return `report:${p.id}`;
      case 'shift.record': return `shift:${p.id}`;
      case 'input.upsert': return `input:${p.id}`;
      case 'label.add': return `label:${p.id}`;
      case 'diagnosis.record': return `diagnosis:${p.id}`;
      case 'topsoil.receive': return `topsoil:${p.id}`;
      case 'gate.override': return `override:${p.id}`;
      case 'doctor.record': return `doctor:${p.id}`;
      case 'lab.record': return `lab:${p.id}`;
      case 'position.upsert': return `position:${p.id}`;
      case 'zone.assign': return `assignment:${p.id}`;
      case 'seedling.sow': return `seedling:${p.id}`;
      case 'media.receive': return `media:${p.id}`;
      case 'absence.record': return `absence:${p.id}`;
      case 'person.upsert': return `person:${p.id}`;
      case 'attendance.in': return `attendance:${p.personId}`;
      default: return null;
    }
  };

  /** What an event needs to already exist, if anything. */
  const requires = (type, p) => {
    switch (type) {
      case 'cycle.update': case 'cycle.close': return `cycle:${p.id}`;
      case 'backfill.record': return p.cycleId ? `cycle:${p.cycleId}` : null;
      case 'task.update': case 'task.complete': case 'task.cancel': return `task:${p.id}`;
      case 'harvest.verify': return `harvest:${p.id}`;
      case 'report.resolve': return `report:${p.id}`;
      case 'shift.comment': return `shift:${p.shiftId}`;
      case 'input.receive': case 'input.issue': return `input:${p.itemId}`;
      case 'label.retire': return `label:${p.id}`;
      case 'person.deactivate': return `person:${p.id}`;
      case 'attendance.out': return `attendance:${p.personId}`;
      case 'diagnosis.confirm': case 'diagnosis.approve': return `diagnosis:${p.id}`;
      case 'topsoil.assign': return `topsoil:${p.batchId}`;
      case 'gate.override.revoke': return `override:${p.id}`;
      case 'doctor.confirm': case 'doctor.approve': case 'doctor.owner-seen': return `doctor:${p.id}`;
      case 'lab.send': case 'lab.result': return `lab:${p.id}`;
      case 'position.assign': case 'position.retire': return `position:${p.id}`;
      case 'zone.unassign': return `assignment:${p.id}`;
      case 'absence.cancel': return `absence:${p.id}`;
      case 'plot.retire': case 'plot.restore': return `plot:${p.id}`;
      case 'seedling.check': case 'seedling.harden': case 'seedling.discard': return `seedling:${p.batchId}`;
      case 'seedling.release': return `seedling:${p.id}`;
      case 'media.update': case 'media.reject': case 'media.fail': return `media:${p.id}`;
      case 'media.fill': return `media:${p.batchId}`;
      default: return null;
    }
  };

  /** FR-ROLE-13 — apply one approval to a diagnosis, or record why not. */
  const approveDiagnosis = (d, e) => {
    const person = state.people[e.by];
    const verdict = canApprove(state, d, { id: e.by, role: person && person.active !== false ? person.role : null }, { at: e.at });
    if (!verdict.ok) {
      if (verdict.reason !== 'done') d.approveRefused = verdict.why;
      return;
    }
    d.approvedBy = e.by; d.approvedAt = e.at; d.approveNote = (e.payload || {}).note || '';
    d.approvedCovering = verdict.how === 'covering';
    delete d.approveRefused;
  };

  const exists = (key) => {
    if (!key) return true;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    switch (kind) {
      case 'cycle': return !!state.cycles[id];
      case 'task': return !!state.tasks[id];
      case 'input': return !!state.inputs[id];
      case 'label': return !!state.labels[id];
      case 'person': return !!state.people[id];
      case 'harvest': return state.harvests.some((h) => h.id === id);
      case 'diagnosis': return state.diagnoses.some((d) => d.id === id);
      case 'topsoil': return !!state.topsoilBatches[id];
      case 'override': return state.gateOverrides.some((o) => o.id === id);
      case 'doctor': return state.doctorOutputs.some((o) => o.id === id);
      case 'lab': return state.labSamples.some((s) => s.id === id);
      case 'position': return !!state.positions[id];
      case 'assignment': return !!state.assignments[id];
      case 'absence': return state.absences.some((a) => a.id === id);
      case 'plot': return !!state.plots[id];
      case 'seedling': return !!state.seedlingBatches[id];
      case 'media': return !!state.mediaBatches[id];
      case 'report': return state.reports.some((r) => r.id === id);
      case 'shift': return state.shifts.some((r) => r.id === id);
      case 'attendance': return state.attendance.some((a) => a.personId === id && !a.out);
      default: return true;
    }
  };

  function apply(e) {
    const p = e.payload || {};
    switch (e.type) {
      case 'settings.update':
        state.settings = { ...state.settings, ...p };
        break;

      case 'person.upsert':
        state.people[p.id] = { ...(state.people[p.id] || {}), ...p, active: p.active !== false };
        break;
      case 'person.deactivate':
        if (state.people[p.id]) state.people[p.id].active = false;
        break;

      // --- Gates (requirements 6.2) ------------------------------------
      // Soil tests, topsoil batches and overrides are what the gates read.
      // They are plain appends: a test is a fact about a day, and a later test
      // does not erase an earlier one, it supersedes it.
      case 'soiltest.record':
        state.soilTests.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'topsoil.receive':
        state.topsoilBatches[p.id] = { ...p, by: e.by, at: e.at };
        break;
      case 'topsoil.assign':
        if (state.plots[p.zoneId]) state.plots[p.zoneId].topsoilBatchId = p.batchId;
        break;
      case 'gate.override':
        state.gateOverrides.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'gate.override.revoke': {
        const o = state.gateOverrides.find((x) => x.id === p.id);
        if (o) { o.revoked = true; o.revokedBy = e.by; o.revokedAt = e.at; }
        break;
      }

      // --- The Farm Doctor (requirements 6.14) ---------------------------
      //
      // Every output the Doctor produces is saved with what it read, how sure
      // it was and — later, by a separate record — who confirmed it
      // (FR-DOC-10). The three FR-DOC-08 limits that matter here are enforced
      // on the way in rather than trusted: whatever a payload claims, an
      // output lands unconfirmed, unapproved and clearing nothing. The Farm
      // Doctor cannot promote its own work by writing a field.
      case 'doctor.record':
        state.doctorOutputs.push({
          ...p,
          id: p.id || e.id,
          by: DOCTOR.id,
          savedBy: e.by,
          at: p.at || e.at,
          clears: false,
          confirmedBy: null, confirmedAt: null,
          approvedBy: null, approvedAt: null,
        });
        break;

      // FR-DOC-08: a person confirms, and only one senior enough for that kind
      // of output. A confirmation from the Doctor itself, or from someone
      // junior, is not applied — the record stays unconfirmed, which is what
      // every gate and every spray screen then reads.
      case 'doctor.confirm': {
        const o = state.doctorOutputs.find((x) => x.id === p.id);
        if (!o) break;
        const person = state.people[e.by];
        const spec = CONFIRMS[o.kind] || CONFIRMS.diagnosis;
        if (e.by === DOCTOR.id || !person || roleRank(person) < spec.minRank) break;
        o.confirmedBy = e.by;
        o.confirmedRole = person.role;
        o.confirmedAt = e.at;
        o.confirmNote = p.note || '';
        break;
      }
      // FR-GATE-00: the Owner approves Gate 0 and Gate 4 work; the Farm
      // Manager approves a treatment plan. Approval never arrives before
      // confirmation, because the two are different people saying different
      // things.
      case 'doctor.approve': {
        const o = state.doctorOutputs.find((x) => x.id === p.id);
        if (!o || !o.confirmedBy) break;
        const person = state.people[e.by];
        const spec = CONFIRMS[o.kind] || CONFIRMS.plan;
        const needed = spec.approver || spec.minRank;
        if (e.by === DOCTOR.id || !person || roleRank(person) < needed) break;
        o.approvedBy = e.by;
        o.approvedAt = e.at;
        o.approveNote = p.note || '';
        break;
      }
      case 'doctor.owner-seen': {
        const o = state.doctorOutputs.find((x) => x.id === p.id);
        if (o) { o.ownerSeenAt = e.at; o.ownerSeenBy = e.by; }
        break;
      }

      // FR-DOC-06: one line of a gate's evidence, recorded by whoever did it.
      // Evidence is never a pass on its own — gates.js and doctor.js read it,
      // and people still clear the gate.
      case 'gate.evidence':
        state.gateEvidence.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      // FR-DIAG-05 / FR-DOC-09: a sample, from the day it was recommended to
      // the day the result came back.
      case 'lab.record':
        state.labSamples.push({ ...p, id: p.id || e.id, by: e.by, at: e.at, status: p.status || 'recommended' });
        break;
      case 'lab.send': {
        const sample = state.labSamples.find((x) => x.id === p.id);
        if (sample) {
          sample.lab = p.lab || sample.lab;
          sample.sentDate = p.sentDate || isoDate(new Date(e.at));
          sample.sentBy = e.by;
          sample.status = 'sent';
        }
        break;
      }
      case 'lab.result': {
        const sample = state.labSamples.find((x) => x.id === p.id);
        if (sample) {
          sample.result = p.result || '';
          sample.resultDate = p.resultDate || isoDate(new Date(e.at));
          sample.resultNote = p.note || '';
          sample.status = 'returned';
        }
        break;
      }

      // --- Alerts (requirements 6.5) ------------------------------------
      // An alert itself is never stored: it is what the scouting records mean
      // when read in order. These two are the only human inputs it reads —
      // somebody saying they have picked it up, and somebody deciding, on the
      // record, not to treat.
      case 'alert.ack':
        state.alertAcks.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'alert.decide':
        state.alertDecisions.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      case 'plot.upsert':
        state.plots[p.id] = { ...(state.plots[p.id] || {}), ...p };
        break;
      case 'plot.remove':
        delete state.plots[p.id];
        break;
      // FR-FARM-01: a zone is retired, not deleted. Deleting it would orphan
      // every harvest, spray and soil test recorded against it, and the history
      // of a house is exactly what you want when deciding whether to use it
      // again.
      case 'plot.retire':
        if (state.plots[p.id]) {
          state.plots[p.id].retired = true;
          state.plots[p.id].retiredReason = p.reason || '';
        }
        break;
      case 'plot.restore':
        if (state.plots[p.id]) {
          state.plots[p.id].retired = false;
          delete state.plots[p.id].retiredReason;
        }
        break;

      // --- Positions (section 4) ----------------------------------------
      // A position is the job. Who holds it is a property of the position, so
      // moving somebody between jobs is one record, not a rewrite of every
      // task they were ever assigned.
      case 'position.upsert':
        state.positions[p.id] = { ...(state.positions[p.id] || {}), ...p };
        break;
      case 'position.assign':
        if (state.positions[p.id]) {
          state.positions[p.id].holderId = p.holderId || null;
          state.positions[p.id].assignedAt = e.at;
        }
        break;
      case 'position.retire':
        if (state.positions[p.id]) state.positions[p.id].retired = true;
        break;

      // FR-ROLE-06 — a zone handed to somebody by name. Checked on replay, not
      // just on the screen: the Farm Manager or the Owner, or the Field
      // Supervisor on a day the Farm Manager is not in. Judged as of the
      // moment it was made, from the attendance the log held by then.
      case 'zone.assign': {
        const person = state.people[e.by];
        const when = { today: isoDate(new Date(e.at)), now: new Date(e.at) };
        const verdict = checkAssignment(state, p, person, when);
        if (!verdict.ok) {
          state.assignRefused.push({ id: p.id, zoneId: p.zoneId, personId: p.personId, why: verdict.why, by: e.by, at: e.at });
          break;
        }
        // One holding per person per zone: moving someone from backup to
        // primary ends the old one rather than leaving two.
        for (const a of Object.values(state.assignments)) {
          if (!a.ended && a.zoneId === p.zoneId && a.personId === p.personId) a.ended = { by: e.by, at: e.at, replacedBy: p.id };
        }
        state.assignments[p.id] = {
          id: p.id, zoneId: p.zoneId, personId: p.personId, holding: p.holding,
          by: e.by, at: e.at, covering: verdict.how === 'covering',
        };
        break;
      }
      case 'zone.unassign': {
        const a = state.assignments[p.id];
        const person = state.people[e.by];
        const who = mayAssignZones(state, person, { today: isoDate(new Date(e.at)), now: new Date(e.at) });
        if (!who.ok) {
          state.assignRefused.push({ id: p.id, zoneId: a.zoneId, personId: a.personId, why: who.why, by: e.by, at: e.at });
          break;
        }
        if (!a.ended) a.ended = { by: e.by, at: e.at, reason: p.reason || '' };
        break;
      }

      // FR-ROLE-02: somebody saying they are not in, so the work moves before
      // anyone stands in an unchecked house wondering.
      case 'absence.record':
        state.absences.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'absence.cancel': {
        const a = state.absences.find((x) => x.id === p.id);
        if (a) a.cancelled = true;
        break;
      }

      case 'cycle.start': {
        // C-19: a crop keeps the media it was planted in, so a zone changed
        // from bed to bags later does not re-judge what is already growing.
        const plot = state.plots[p.plotId];
        state.cycles[p.id] = {
          ...p, media: p.media || (plot && plot.media === 'bag' ? 'bag' : 'bed'),
          status: 'active', events: {}, startedBy: e.by, startedAt: e.at,
        };
        // FR-FARM-05: each batch is linked to the block it goes to. Only a
        // batch released to this very block, and not already planted, links.
        const batch = p.seedlingBatchId && state.seedlingBatches[p.seedlingBatchId];
        if (batch && batch.status === 'released' && batch.release && batch.release.zoneId === p.plotId
          && !batch.usedByCycleId) {
          batch.usedByCycleId = p.id;
          batch.plantedAt = p.transplantDate || isoDate(new Date(e.at));
        }
        break;
      }
      // FR-ONB-01/02/06 — a crop already in the ground on the day the farm
      // went live. It becomes an ordinary active cycle, so the week, the
      // Week 10 rule and the task schedule all derive from its transplant
      // date; it is marked onboarded, which is what the Gates screen reads to
      // show "planted before the gates" instead of a violation.
      //
      // That status opens nothing that is shut, but it does stand in for the
      // transplant gates of this one crop, so replay checks it rather than
      // trusting the screen: the Farm Manager or Owner only, a transplant date
      // before the day of setup, and no crop already growing in the zone.
      case 'cycle.onboard': {
        const plot = state.plots[p.plotId];
        const person = state.people[e.by];
        // Never later than the day the record was made: a setup day in the
        // future would let a crop planted today skip the gates.
        const madeOn = isoDate(new Date(e.at));
        const setupDate = p.setupDate && p.setupDate < madeOn ? p.setupDate : madeOn;
        const refuse = (why) => state.onboardRefused.push({ id: p.id, plotId: p.plotId, why, by: e.by, at: e.at });
        if (!person || roleRank(person) < ROLES.manager.rank) { refuse('Only the Farm Manager or the Owner sets up a crop that is already growing.'); break; }
        if (!plot || plot.type === 'nursery') { refuse('That is not a cropping zone on record.'); break; }
        if (!p.cropId || !p.transplantDate) { refuse('A crop and a transplant date are both needed.'); break; }
        if (!(p.transplantDate < setupDate)) { refuse('A crop set up here was planted before today. One planted today goes through the gates.'); break; }
        if (Object.values(state.cycles).some((c) => c.plotId === p.plotId && c.status === 'active')) {
          refuse('There is already a crop growing in that zone.'); break;
        }
        const { setupDate: _s, ...fields } = p;
        state.cycles[p.id] = {
          ...fields,
          media: p.media || (plot.media === 'bag' ? 'bag' : 'bed'),
          status: 'active', events: {}, startedBy: e.by, startedAt: e.at,
          onboarded: { date: setupDate, by: e.by, at: e.at },
        };
        break;
      }
      // FR-ONB-03 — one backfilled entry. Marked backfilled whatever the
      // payload says, and never pushed onto the live lists: sprays, harvests
      // and gate evidence stay in `backfills`. Stock is the exception that
      // proves the rule — the store holds one number per item — so the count
      // lands as an opening balance, a stock move of its own kind that no
      // usage figure reads.
      case 'backfill.record': {
        if (!['spray', 'harvest', 'stock', 'evidence', 'declare'].includes(p.kind)) break;
        const entry = { ...p, id: p.id || e.id, backfilled: true, by: e.by, at: e.at };
        state.backfills.push(entry);
        if (p.kind === 'stock' && p.itemId) {
          const item = state.inputs[p.itemId]
            || (state.inputs[p.itemId] = { id: p.itemId, name: p.name || p.itemId, unit: p.unit || '', qty: 0, backfilled: true });
          const counted = Number(p.qty) || 0;
          const delta = counted - (Number(item.qty) || 0);
          item.qty = counted;
          state.stockMoves.push({
            id: entry.id, itemId: p.itemId, qty: delta, counted, direction: 'opening', backfilled: true,
            date: p.date || isoDate(new Date(e.at)), by: e.by, at: e.at,
          });
        }
        break;
      }
      case 'cycle.update':
        state.cycles[p.id] = { ...state.cycles[p.id], ...p };
        break;
      case 'cycle.close':
        state.cycles[p.id].status = 'closed';
        state.cycles[p.id].closedAt = p.date || isoDate(new Date(e.at));
        state.cycles[p.id].closeNote = p.note || '';
        break;

      case 'task.create':
        state.tasks[p.id] = { ...p, status: 'open', createdBy: e.by, createdAt: e.at };
        break;
      case 'task.update':
        state.tasks[p.id] = { ...state.tasks[p.id], ...p };
        break;
      case 'task.complete':
        state.tasks[p.id].status = 'done';
        state.tasks[p.id].doneBy = e.by;
        state.tasks[p.id].doneAt = e.at;
        state.tasks[p.id].doneNote = p.note || '';
        // FR-PROOF-01/02: the picture and its stamp are the evidence the task
        // happened, so they belong on the task rather than in a side list.
        if (p.photo) state.tasks[p.id].photo = p.photo;
        if (p.stamp) state.tasks[p.id].stamp = p.stamp;
        // FR-PROOF-03: which zone was confirmed at the start, and how.
        if (p.zoneCheck) state.tasks[p.id].zoneCheck = p.zoneCheck;
        break;
      case 'task.cancel':
        state.tasks[p.id].status = 'cancelled';
        state.tasks[p.id].cancelReason = p.reason || '';
        break;

      case 'attendance.in':
        state.attendance.push({ ...p, id: p.id || e.id, personId: p.personId || e.by, in: e.at, out: null });
        break;
      case 'attendance.out': {
        const open = [...state.attendance].reverse()
          .find((a) => a.personId === (p.personId || e.by) && !a.out);
        if (open) { open.out = e.at; open.hours = p.hours ?? hoursBetween(open.in, e.at); }
        break;
      }

      case 'work.log':
        state.workLogs.push({ ...p, id: p.id || e.id, personId: p.personId || e.by, at: e.at });
        break;

      case 'harvest.record':
        state.harvests.push({ ...p, id: p.id || e.id, by: e.by, at: e.at, verified: false });
        break;
      case 'harvest.verify': {
        const h = state.harvests.find((x) => x.id === p.id);
        if (h) { h.verified = true; h.verifiedBy = e.by; h.kg = p.kg ?? h.kg; }
        break;
      }

      case 'sale.record':
        state.sales.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      // FR-ROLE-13 — a spray resting on a self-confirmed diagnosis that nobody
      // above has approved is judged here, from the records as they stood when
      // it went on. Whether it was treated before approval is computed from
      // the alert deadline and the window times; what the payload claims is
      // thrown away. One that does not qualify is kept (it happened) and
      // marked, and Gate 3 shows it red.
      case 'spray.record': {
        const spray = { ...p, id: p.id || e.id, by: e.by, at: e.at, beforeApproval: null };
        delete spray.unapproved;
        const d = p.diagnosisId && state.diagnoses.find((x) => x.id === p.diagnosisId);
        if (d && awaitingApproval(d)) {
          const verdict = beforeApprovalCheck(state, d, { cycleId: p.cycleId, at: e.at });
          if (verdict.ok) {
            spray.beforeApproval = { alertId: verdict.alertId, deadline: verdict.deadline, nextWindow: verdict.nextWindow };
          } else {
            spray.unapproved = verdict.why;
          }
        }
        state.sprays.push(spray);
        break;
      }
      case 'scout.record':
        state.scouts.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      // Who confirmed it, whether that was its own raiser, and who approved it
      // come from the confirm and approve records below, never from the
      // record's own payload (FR-ROLE-12/13).
      case 'diagnosis.record': {
        const d = { ...p, id: p.id || e.id, by: e.by, at: e.at };
        for (const k of ['confirmedBy', 'confirmedAt', 'selfConfirmed', 'approvalFrom', 'approvedBy', 'approvedAt',
          'approvedCovering', 'earlyApprovals', 'confirmRefused', 'approveRefused']) delete d[k];
        state.diagnoses.push(d);
        break;
      }

      // FR-DIAG-02 / FR-DOC-01 — a diagnosis the Farm Doctor produced cannot be
      // confirmed until the card, the photos and the confirm test are all on
      // the record. Replay enforces it as well as the screens do, because a
      // phone that skipped the flow must not be able to sync its way past it.
      //
      // Records from before the rules engine carry no card and no confirm step.
      // They are left exactly as they were confirmed at the time: the event log
      // is a record of what people actually did, and rewriting history here
      // would make every past treatment look ungated.
      //
      // FR-ROLE-12 — the person who raised it may confirm it only when nobody
      // else qualified is on the farm, and then the record says so. Who that
      // person is decides who approves a treatment from it (FR-ROLE-13); the
      // payload has no say in either. The first confirmation stands: a later
      // one cannot turn a self-confirmed record into a second person's, or the
      // approval could be skipped. FR-DOC-08: the Farm Doctor confirms nothing.
      case 'diagnosis.confirm': {
        const d = state.diagnoses.find((x) => x.id === p.id);
        if (!d || d.confirmedBy) break;
        if (e.by === DOCTOR.id) {
          d.confirmRefused = 'The Farm Doctor does not confirm its own diagnosis.';
          break;
        }
        if (!isLegacyDiagnosis(d) && !confirmStepDone(d)) {
          d.confirmRefused = 'The confirm test and the photos were not on the record.';
          break;
        }
        const self = !!d.by && e.by === d.by;
        if (self) {
          const others = otherConfirmers(state, d, e.at);
          if (others.length) {
            d.confirmRefused = `Raised and confirmed by the same person while ${others.map((x) => x.name || x.id).join(' and ')} `
              + 'could have confirmed it (FR-ROLE-12).';
            break;
          }
        }
        d.confirmedBy = e.by; d.confirmedAt = e.at; d.confirmNote = p.note || '';
        d.selfConfirmed = self;
        d.approvalFrom = self ? approverFor((state.people[e.by] || {}).role) : null;
        d.approvedBy = null; d.approvedAt = null;
        delete d.confirmRefused;
        // An approval whose clock ran ahead of this confirmation is judged now.
        for (const early of d.earlyApprovals || []) approveDiagnosis(d, early);
        delete d.earlyApprovals;
        break;
      }

      // FR-ROLE-13 — the next level up approves a treatment from a
      // self-confirmed diagnosis. Judged here from the record itself, so a
      // phone that skipped the screen cannot approve its own work by syncing.
      case 'diagnosis.approve': {
        const d = state.diagnoses.find((x) => x.id === p.id);
        if (!d) break;
        if (!d.confirmedBy) { (d.earlyApprovals ||= []).push(e); break; }
        approveDiagnosis(d, e);
        break;
      }

      // FR-DIAG-01 — the reference photo beside each triage row and card.
      //
      // Only a slot the rules actually have is accepted. The rules JSON is the
      // source of truth and the app never writes to it, so the picture lives
      // here in the log instead, and a slot that no longer exists after a rules
      // change quietly stops being shown rather than inventing a row.
      case 'reference.photo.set': {
        if (!isPhotoSlot(p.slot) || !p.photo || !p.photo.dataUrl) break;
        state.referencePhotos[p.slot] = {
          slot: p.slot,
          photo: p.photo,
          caption: p.caption || '',
          by: e.by,
          at: e.at,
        };
        break;
      }
      case 'reference.photo.clear':
        delete state.referencePhotos[p.slot];
        break;

      case 'report.record':
        state.reports.push({ ...p, id: p.id || e.id, by: e.by, at: e.at, status: 'open' });
        break;
      case 'report.resolve': {
        const r = state.reports.find((x) => x.id === p.id);
        if (r) { r.status = 'resolved'; r.resolution = p.note || ''; r.resolvedBy = e.by; r.resolvedAt = e.at; }
        break;
      }

      // FR-TASK-05 / UX-09: the end-of-shift report. Deliberately not a
      // problem report — everybody files one at the end of an ordinary day,
      // and it is never "resolved", only read and answered.
      case 'shift.record':
        state.shifts.push({
          ...p, id: p.id || e.id, personId: p.personId || e.by, by: e.by, at: e.at, comments: [],
        });
        break;
      case 'shift.comment': {
        const shift = state.shifts.find((x) => x.id === p.shiftId);
        if (shift) {
          shift.comments.push({ id: p.id || e.id, note: p.note || '', by: e.by, at: e.at });
        }
        break;
      }

      case 'expense.record':
        state.expenses.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      case 'input.upsert':
        state.inputs[p.id] = { ...(state.inputs[p.id] || { qty: 0 }), ...p };
        break;
      case 'input.receive':
        state.inputs[p.itemId].qty = (Number(state.inputs[p.itemId].qty) || 0) + Number(p.qty || 0);
        state.stockMoves.push({ ...p, id: p.id || e.id, direction: 'in', by: e.by, at: e.at });
        break;
      case 'input.issue':
        state.inputs[p.itemId].qty = (Number(state.inputs[p.itemId].qty) || 0) - Number(p.qty || 0);
        state.stockMoves.push({ ...p, id: p.id || e.id, direction: 'out', by: e.by, at: e.at });
        break;

      // --- The chemical catalogue (requirements 6.8) --------------------
      // The twenty actives and their IRAC/FRAC groups come from the rules file
      // and are never written here. What the farm records is only what the
      // rules leave to it: an active the Owner has added, with its group, and
      // the brand labels a manager attaches to actives already in the
      // catalogue. Both are read through domain/catalogue.js, which drops any
      // banned active whatever the log says — so a bad merge cannot put
      // carbofuran back on a spray screen.
      case 'active.add':
        state.actives[p.id] = { ...p, by: e.by, at: e.at };
        break;
      case 'label.add':
        state.labels[p.id] = { ...(state.labels[p.id] || {}), ...p, by: e.by, at: e.at };
        break;
      case 'label.retire':
        if (state.labels[p.id]) {
          state.labels[p.id].retired = true;
          state.labels[p.id].retiredBy = e.by;
        }
        break;

      // --- The nursery (FR-FARM-04, FR-FARM-05) --------------------------
      // A batch is sown, checked twice a week, hardened, and released to a
      // block only when the release check passes. The check is re-run here
      // from the batch's own record every time the log is replayed: a phone
      // that skipped the form cannot sync its way to a released batch.
      case 'seedling.sow':
        state.seedlingBatches[p.id] = {
          ...p, status: 'growing', checks: [], hardenedFrom: null, release: null, by: e.by, at: e.at,
        };
        break;
      case 'seedling.check': {
        const b = state.seedlingBatches[p.batchId];
        if (b) b.checks.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      }
      case 'seedling.harden': {
        const b = state.seedlingBatches[p.batchId];
        if (b && b.status === 'growing') b.hardenedFrom = p.date || isoDate(new Date(e.at));
        break;
      }
      case 'seedling.discard': {
        const b = state.seedlingBatches[p.batchId];
        if (b && b.status === 'growing') { b.status = 'discarded'; b.discardReason = p.reason || ''; }
        break;
      }
      case 'seedling.release': {
        const b = state.seedlingBatches[p.id];
        if (!b) break;
        const date = p.date || isoDate(new Date(e.at));
        const person = state.people[e.by];
        const verdict = releaseCheck(state, b, { date, zoneId: p.zoneId, answers: p.answers || {}, rules: peekRules() });
        const attempt = { date, zoneId: p.zoneId || null, by: e.by, at: e.at, note: p.note || '', items: verdict.items };
        // A release check is a senior's call, like confirming a diagnosis.
        if (!person || roleRank(person) < ROLES.supervisor.rank) {
          b.releaseRefused = { ...attempt, why: 'A release check is done by the Field Supervisor or above.' };
          break;
        }
        if (!verdict.ok) { b.releaseRefused = { ...attempt, why: verdict.why }; break; }
        b.status = 'released';
        b.release = attempt;
        delete b.releaseRefused;
        break;
      }

      // --- Plant-bag media (C-19) -------------------------------------------
      // A batch is received with its supplier and delivery date, tested like a
      // bed (soiltest.record with mediaBatchId), corrected, and then fills
      // bags. A fill is re-judged here on every replay against the batch's own
      // Gate 0 lines, as a seedling release is: a phone cannot sync its way to
      // bags filled from an untested heap. A rejection or a later failure is a
      // new fact about the batch; nothing about it is ever deleted.
      case 'media.receive':
        state.mediaBatches[p.id] = { ...p, by: e.by, at: e.at, rejected: null, failure: null, corrections: [] };
        break;
      case 'media.update': {
        const b = state.mediaBatches[p.id];
        if (!b) break;
        const { id, rejected, failure, by, at, corrections, ...fields } = p;
        b.corrections.push({ fields: Object.keys(fields), by: e.by, at: e.at, note: p.note || '' });
        Object.assign(b, fields);
        break;
      }
      case 'media.reject': {
        const b = state.mediaBatches[p.id];
        if (b && !b.rejected) b.rejected = { date: p.date || isoDate(new Date(e.at)), reason: p.reason || 'rejected', by: e.by, at: e.at };
        break;
      }
      case 'media.fail': {
        const b = state.mediaBatches[p.id];
        if (b && !b.failure) {
          b.failure = { date: p.date || isoDate(new Date(e.at)), reason: p.reason || 'recorded', note: p.note || '', by: e.by, at: e.at };
        }
        break;
      }
      case 'media.fill': {
        const date = p.date || isoDate(new Date(e.at));
        const verdict = fillCheck(state, p.batchId, { date });
        const fill = { ...p, id: p.id || e.id, date, bags: Number(p.bags) || 0, newBags: !!p.newBags, by: e.by, at: e.at };
        if (!state.plots[p.zoneId]) fill.refused = { why: 'That zone is not on record.' };
        else if (state.plots[p.zoneId].media !== 'bag') {
          fill.refused = { why: `${state.plots[p.zoneId].name || 'That zone'} grows in bed soil, not plant bags. Set its media to plant bags first.` };
        }
        else if (!verdict.ok) fill.refused = { why: verdict.why };
        state.mediaFills.push(fill);
        break;
      }

      case 'weather.record':
        state.weather.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      default:
        break; // an event from a newer version of the app: kept in the log, ignored here
    }
  }

  /** Apply anything that was waiting on this key, and anything that then unblocks. */
  function drain(key) {
    const queue = parked.get(key);
    if (!queue) return;
    parked.delete(key);
    for (const e of queue) {
      apply(e);
      const made = creates(e.type, e.payload || {});
      if (made) drain(made);
    }
  }

  for (const e of ordered) {
    const p = e.payload || {};
    state.log.push({ id: e.id, type: e.type, at: e.at, by: e.by, device: e.device });

    const needs = requires(e.type, p);
    if (needs && !exists(needs)) {
      if (!parked.has(needs)) parked.set(needs, []);
      parked.get(needs).push(e);
      continue;
    }

    apply(e);
    const made = creates(e.type, p);
    if (made) drain(made);
  }

  // Anything still waiting refers to something this log has never seen: most
  // likely half of a merge that has not arrived from another phone yet.
  state.orphans = [...parked.values()].flat()
    .map((e) => ({ id: e.id, type: e.type, waitingFor: requires(e.type, e.payload || {}) }));

  // Roll harvest totals onto their cycles so forecasting can correct itself.
  for (const h of state.harvests) {
    const c = state.cycles[h.cycleId];
    if (c) c.harvestedKg = (c.harvestedKg || 0) + (Number(h.kg) || 0);
  }
  // FR-ONB-03: the harvest to date on an onboarded crop. The latest figure
  // entered stands; it is kept on the cycle as its own number as well, so
  // nothing mistakes it for pickings the app saw weighed.
  for (const c of Object.values(state.cycles)) {
    const latest = state.backfills
      .filter((b) => b.kind === 'harvest' && b.cycleId === c.id)
      .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
    if (!latest) continue;
    c.backfilledKg = Number(latest.kg) || 0;
    c.harvestedKg = (c.harvestedKg || 0) + c.backfilledKg;
  }
  for (const c of Object.values(state.cycles)) {
    if (c.status === 'closed') c.actualKg = c.harvestedKg || 0;
  }

  return state;
}

function hoursBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return ms > 0 ? Math.round((ms / 3600000) * 10) / 10 : 0;
}

/** The live store: loads the log, applies new events, tells the UI to redraw. */
/**
 * UX-25 — practice mode.
 *
 * Set before the store is built. Everything downstream behaves normally except
 * that nothing is written to disk, which is the property that makes training
 * safe on a phone that also holds real records.
 */
let practice = false;
function setPractice(on) { practice = !!on; }
function isPractice() { return practice; }

async function createStore() {
  // In practice mode the real log is never opened. Loading it would sit the
  // example farm on top of the farm's actual records, which is both confusing
  // and the opposite of the point.
  const events = practice ? [] : await loadEvents();
  const device = await deviceId();
  let state = reduce(events);
  const listeners = new Set();
  let currentUser = null;

  function notify() { for (const fn of listeners) fn(state); }

  return {
    get state() { return state; },
    get device() { return device; },
    get user() { return currentUser; },
    setUser(person) { currentUser = person; notify(); },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Record something. Returns the event so callers can reference its id. */
    /**
     * File one record.
     *
     * `opts.eventId` pins the event's own id instead of minting a new one.
     * That is what makes the daily task generator idempotent: IndexedDB keys
     * events by id and `put` overwrites, and the sync merge is a set union, so
     * five phones generating Tuesday's scouting round for GH-01 all produce the
     * same id and it lands exactly once.
     */
    async dispatch(type, payload = {}, opts = {}) {
      const event = {
        id: opts.eventId || uid('ev'),
        type,
        at: new Date().toISOString(),
        by: currentUser ? currentUser.id : 'system',
        device,
        payload,
      };
      // UX-25: in practice mode the event is applied to the screen and thrown
      // away. Not persisted, so it never reaches the real log; not synced, so
      // it never reaches anybody else's phone. A trainee's first harvest must
      // not end up in the books.
      if (!practice) await appendEvents([event]);
      events.push(event);
      state = reduce(events);
      notify();
      return event;
    },

    /**
     * Several events at once, one redraw. An entry may carry its own `by` and
     * `at` so historical records (a seeded sample, or a paper book being typed
     * up after the fact) land under the right name and date.
     */
    async dispatchMany(list) {
      const batch = list.map(({ type, payload, by, at }) => ({
        id: uid('ev'), type, at: at || new Date().toISOString(),
        by: by || (currentUser ? currentUser.id : 'system'), device, payload: payload || {},
      }));
      if (!practice) await appendEvents(batch);
      events.push(...batch);
      state = reduce(events);
      notify();
      return batch;
    },

    async reload() {
      if (practice) { state = reduce(events); notify(); return; }
      const fresh = await loadEvents();
      events.length = 0;
      events.push(...fresh);
      state = reduce(events);
      notify();
    },

    get events() { return events; },
  };
}

// ---------------------------------------------------------------------------
// Selectors: plain reads over state, no side effects.
// ---------------------------------------------------------------------------

function activeCycles(state) {
  return Object.values(state.cycles).filter((c) => c.status === 'active');
}

function closedCycles(state) {
  return Object.values(state.cycles).filter((c) => c.status === 'closed');
}

function cycleLabel(state, cycleId) {
  const c = state.cycles[cycleId];
  if (!c) return 'Unknown bed';
  const plot = state.plots[c.plotId];
  return `${plot ? plot.name : 'Bed'} — ${c.variety || c.cropId}`;
}

function spraysForCycle(state, cycleId) {
  return state.sprays.filter((s) => s.cycleId === cycleId);
}

function openTasks(state, personId = null, onDate = null) {
  const day = onDate || isoDate();
  return Object.values(state.tasks).filter((t) => {
    if (t.status !== 'open') return false;
    if (personId && t.assignedTo && t.assignedTo !== personId) return false;
    if (t.dueDate && t.dueDate > day) return false;
    return true;
  }).sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
}

function openReports(state) {
  return state.reports.filter((r) => r.status === 'open');
}

/** Today's end-of-shift reports (FR-TASK-05). Not the same list as openReports. */
function shiftsOn(state, day = isoDate()) {
  return (state.shifts || []).filter((s) => s.date === day);
}

function harvestsBetween(state, from, to) {
  return state.harvests.filter((h) => h.date >= from && h.date <= to);
}

function todayAttendance(state, day = isoDate()) {
  return state.attendance.filter((a) => (a.in || '').slice(0, 10) === day);
}

function isClockedIn(state, personId) {
  return state.attendance.some((a) => a.personId === personId && !a.out);
}

/** Wages owed over a period, from attendance and the person's rate. */
function payrollBetween(state, from, to) {
  const rows = [];
  for (const person of Object.values(state.people)) {
    if (person.active === false) continue;
    const shifts = state.attendance.filter((a) => a.personId === person.id
      && (a.in || '').slice(0, 10) >= from && (a.in || '').slice(0, 10) <= to && a.out);
    const hours = sum(shifts, (s) => s.hours || 0);
    const days = new Set(shifts.map((s) => (s.in || '').slice(0, 10))).size;
    const rate = Number(person.dailyRate) || state.settings.defaultDailyWage;
    rows.push({ person, days, hours: Math.round(hours * 10) / 10, rate, pay: days * rate });
  }
  return rows.filter((r) => r.days > 0).sort((a, b) => b.pay - a.pay);
}

function inputsList(state) {
  return Object.values(state.inputs).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function inputUsage(state) {
  return state.stockMoves.filter((m) => m.direction === 'out')
    .map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0, date: (m.date || m.at || '').slice(0, 10) }));
}

function costsBetween(state, from, to) {
  const direct = state.expenses.filter((x) => x.date >= from && x.date <= to)
    .map((x) => ({ date: x.date, amount: Number(x.amount) || 0, category: x.category || 'other', note: x.note }));
  const labour = payrollBetween(state, from, to)
    .map((r) => ({ date: to, amount: r.pay, category: 'labour', note: `${r.person.name}, ${r.days} days` }));
  return [...direct, ...labour];
}

function revenueBetween(state, from, to) {
  return sum(state.sales.filter((s) => s.date >= from && s.date <= to), (s) => Number(s.amount) || 0);
}
})(__dvModule("web/js/store.js"));
__dvBindAll();

// ─── web/js/domain/proof.js ────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "PROOF_REQUIRED": { enumerable: true, get: () => PROOF_REQUIRED },
  "MAX_PHOTO_BYTES": { enumerable: true, get: () => MAX_PHOTO_BYTES },
  "judgePhoto": { enumerable: true, get: () => judgePhoto },
  "canComplete": { enumerable: true, get: () => canComplete },
  "stampFor": { enumerable: true, get: () => stampFor },
  "FRESH_PHOTO_MINUTES": { enumerable: true, get: () => FRESH_PHOTO_MINUTES },
  "proofCheck": { enumerable: true, get: () => proofCheck },
  "ZONE_CONFIRMED": { enumerable: true, get: () => ZONE_CONFIRMED },
  "zoneStamp": { enumerable: true, get: () => zoneStamp },
  "judgeZoneStart": { enumerable: true, get: () => judgeZoneStart },
});


// Proof of work — requirements 6.4.
//
// Root cause three again, from the other end. The Owner could not see whether
// the work was happening, and "marked done" is not evidence of anything: it is
// evidence that somebody tapped a button, which is exactly as easy to do from
// the shade as from inside the house.
//
// So for the tasks where it matters — scouting and trap checks, the ones that
// catch a pest while it is still cheap — done requires a picture taken now, in
// the app, of the thing being checked.
//
// The line this file draws is between a photo and PROOF. The app has taken
// photos since the first version; what was missing was the refusal.

/**
 * The kinds of task that cannot be closed on somebody's word. FR-PROOF-01.
 *
 * `nursery_trap` is the nursery's daily trap check (FR-FARM-04) — a trap check
 * like any other, and the schedule already marks it as needing a photo.
 */
const PROOF_REQUIRED = new Set(['scout', 'trap', 'nursery_trap', 'sanitation']);
const TRAP_KINDS = new Set(['trap', 'nursery_trap']);

/**
 * FR-PROOF-04 — a picture small enough to send from a field.
 *
 * 200 KB is the requirement. The compressor already aims well under it, so
 * this is the backstop for a phone whose camera produces something unusual —
 * and it is a real limit, because a farm hand on a metered connection who
 * cannot sync is a farm hand who stops recording.
 */
const MAX_PHOTO_BYTES = 200 * 1024;

/**
 * Is this photo proof, or just a picture?
 *
 * Three things have to hold, and the requirement names all three. It has to
 * exist. It has to have been taken now rather than pulled out of the gallery
 * (FR-PROOF-02). And it has to be small enough to actually arrive
 * (FR-PROOF-04).
 *
 * `fresh` is null when the file carried no timestamp at all. That is treated as
 * acceptable rather than as a failure: some Android cameras hand over a file
 * with no lastModified, and refusing those would block honest work on the
 * cheapest handsets, which is the opposite of what this is for. The record
 * still carries the absence, and the audit screen shows it.
 */
function judgePhoto(photo) {
  if (!photo || !photo.dataUrl) {
    return { ok: false, reason: 'missing', why: 'No photo attached.' };
  }
  if (photo.fresh === false) {
    return {
      ok: false,
      reason: 'stale',
      why: `That picture is ${photo.ageMinutes} minutes old, so it came out of the gallery.`,
      fix: 'Take a new one at the bed. A photo from earlier proves the bed was fine earlier.',
    };
  }
  if (photo.bytes && photo.bytes > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      reason: 'too-big',
      why: `That picture is ${Math.round(photo.bytes / 1024)} KB, over the ${
        Math.round(MAX_PHOTO_BYTES / 1024)} KB limit.`,
      fix: 'Take it again. A closer shot of the trap is smaller and more useful than a wide one.',
    };
  }
  return { ok: true, unverifiedTime: photo.fresh == null };
}

/**
 * May this task be marked done? — FR-PROOF-01.
 *
 * Only the proof kinds are gated. Gating everything would mean a photo of a
 * watering can every morning, and a rule people resent is a rule they work
 * around.
 */
function canComplete(task, photo) {
  if (!task) return { ok: false, why: 'That task is not on record.' };
  if (!PROOF_REQUIRED.has(task.kind)) return { ok: true };

  const verdict = judgePhoto(photo);
  if (verdict.ok) return { ok: true, unverifiedTime: verdict.unverifiedTime };

  return {
    ok: false,
    reason: verdict.reason,
    why: verdict.reason === 'missing'
      ? `A ${TRAP_KINDS.has(task.kind) ? 'trap check' : task.kind} is not done until there is a picture of it.`
      : verdict.why,
    fix: verdict.fix
      || 'Open the camera in the app and photograph the trap or the plants you checked.',
  };
}

/**
 * The stamp that goes on the record beside the picture — FR-PROOF-02.
 *
 * Date, time, zone and person. Built here rather than at each call site so
 * every proof photo carries the same four facts in the same shape, and the
 * audit screen can rely on it.
 */
function stampFor(photo, { zoneName, personName, taskKind, at = new Date().toISOString() }) {
  return {
    takenAt: photo && photo.takenAt ? photo.takenAt : at,
    attachedAt: at,
    zone: zoneName || null,
    person: personName || null,
    kind: taskKind || null,
    // Kept so the audit screen can say "the time on this one could not be
    // checked" rather than quietly implying it was verified.
    timeVerified: photo ? photo.fresh !== null : false,
  };
}

/** FR-PROOF-02 — how long after the shutter a photo still counts as taken now. */
const FRESH_PHOTO_MINUTES = 5;

/**
 * May this completion close this task? — FR-PROOF-01, FR-PROOF-02, FR-PROOF-03.
 *
 * The whole proof rule in one place, for the record as it travels: the photo
 * is there, small enough, taken now rather than pulled from the gallery — by
 * the phone's own flag and by its own two timestamps, which have to agree —
 * and stamped with date, time, zone and person; and a zone scanned at the
 * start is the task's zone. The phone builds a completion that passes it, and
 * the farm server refuses one that does not, so a phone that skipped the
 * screen cannot close a scouting round or a trap check on its word.
 */
function proofCheck(task, payload = {}) {
  if (!task || !PROOF_REQUIRED.has(task.kind)) return { ok: true };
  const photo = (payload && payload.photo) || null;
  const verdict = canComplete(task, photo);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, why: verdict.why, fix: verdict.fix, rule: 'FR-PROOF-01' };
  if (!String(photo.dataUrl).startsWith('data:image/')) {
    return { ok: false, reason: 'not-a-photo', why: 'What came with this task is not a picture.', fix: verdict.fix || 'Take the photo in the app.', rule: 'FR-PROOF-01' };
  }

  const live = { ok: false, reason: 'stale', rule: 'FR-PROOF-02',
    why: 'That picture was not taken just now, so it came out of the gallery.',
    fix: 'Take a new one at the bed, in the app. A photo from earlier proves the bed was fine earlier.' };
  if (photo.ageMinutes != null && Number(photo.ageMinutes) > FRESH_PHOTO_MINUTES) return live;
  const taken = Date.parse(photo.takenAt || '');
  const attached = Date.parse(photo.attachedAt || '');
  if (Number.isFinite(taken) && Number.isFinite(attached) && attached - taken > FRESH_PHOTO_MINUTES * 60000) return live;

  const stamp = (payload && payload.stamp) || {};
  if (!(stamp.takenAt || stamp.attachedAt) || !stamp.person || (task.zoneId && !stamp.zone)) {
    return { ok: false, reason: 'unstamped', rule: 'FR-PROOF-02',
      why: 'The photo is not stamped with the date, time, zone and person.',
      fix: 'Take it from the task in the app, which stamps it.' };
  }

  const zone = judgeZoneStart(task, (payload && payload.zoneCheck) || null);
  if (!zone.ok) return { ok: false, reason: zone.reason, why: zone.why, fix: zone.fix, rule: 'FR-PROOF-03' };
  return { ok: true, unverifiedTime: verdict.unverifiedTime };
}

// --- Which house are you actually standing in? — FR-PROOF-03, UX-12 --------
//
// The photo proves the work happened. It does not prove where. A trap
// photographed in GH-02 and filed against GH-01 leaves both houses wrong: one
// with a count that is not its own, and one with no count at all while looking
// as though it has been checked.
//
// So the zone is confirmed at the START of the task, by scanning the code on
// the door. That is the quickest way to choose a zone as well as the surest
// (UX-12 asks for scanning to be offered first), and it costs a second.
//
// Two things this deliberately does NOT do. It does not use GPS: a phone's
// position under a polythene roof is worth ±20 m on a farm whose houses are 8 m
// apart, and NFR-DEV-03 rules out constant GPS anyway. And it does not refuse
// to close a task when there is no scan — some phones have no BarcodeDetector
// and some doors lose their label. The record carries how the zone was
// confirmed, and a round confirmed by scan is worth more than one confirmed by
// tapping a list; both beat nothing, and the audit screen can tell them apart.

const ZONE_CONFIRMED = {
  qr: { method: 'qr', strength: 'scanned', label: 'Scanned at the door' },
  list: { method: 'list', strength: 'chosen', label: 'Chosen from the list' },
};

/**
 * The record that goes on the task: which zone, how it was confirmed, when and
 * by whom. Same shape whichever way it was confirmed, so nothing downstream has
 * to care which phone it came from.
 */
function zoneStamp({ zone, method = 'list', at = new Date().toISOString(), by = null }) {
  if (!zone) return null;
  const kind = ZONE_CONFIRMED[method] || ZONE_CONFIRMED.list;
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    method: kind.method,
    strength: kind.strength,
    label: kind.label,
    at,
    by,
  };
}

/**
 * May this task start against this confirmation? — FR-PROOF-03.
 *
 * A scan of the wrong door is the one case that is refused outright, because it
 * is the case this whole feature exists to catch and because the person is, by
 * definition, holding the answer in their hand. Everything else passes, with
 * `confirmed` saying how much the record is worth.
 */
function judgeZoneStart(task, stamp) {
  if (!task) return { ok: false, why: 'That task is not on record.' };
  const wanted = task.zoneId || null;

  if (!stamp) {
    return {
      ok: true,
      confirmed: false,
      why: 'The zone was not confirmed at the start of this job.',
      fix: 'Scan the code on the door next time — it takes a second and it settles where you were.',
    };
  }
  if (wanted && stamp.zoneId !== wanted) {
    return {
      ok: false,
      confirmed: false,
      reason: 'wrong-zone',
      why: `That code is ${stamp.zoneName}. This job is for another zone.`,
      fix: 'Open the job for the house you are standing in, or go to the right one.',
    };
  }
  return { ok: true, confirmed: true, strength: stamp.strength };
}
})(__dvModule("web/js/domain/proof.js"));
__dvBindAll();

// ─── server/judge.mjs ──────────────────────────────────────────────────────
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
  "JUDGED": { enumerable: true, get: () => JUDGED },
  "farmDay": { enumerable: true, get: () => farmDay },
  "judgeRecord": { enumerable: true, get: () => judgeRecord },
  "judgingLog": { enumerable: true, get: () => judgingLog },
});
let reduce;
let canAssignBatch, canPlant, canTreat;
let harvestCheck;
let buildCatalogue, sprayIntervals;
let proofCheck;
__dvImport("web/js/store.js", (m) => { reduce = m.reduce; });
__dvImport("web/js/domain/gates.js", (m) => { canAssignBatch = m.canAssignBatch; }, (m) => { canPlant = m.canPlant; }, (m) => { canTreat = m.canTreat; });
__dvImport("web/js/domain/onboarding.js", (m) => { harvestCheck = m.harvestCheck; });
__dvImport("web/js/domain/catalogue.js", (m) => { buildCatalogue = m.buildCatalogue; }, (m) => { sprayIntervals = m.sprayIntervals; });
__dvImport("web/js/domain/proof.js", (m) => { proofCheck = m.proofCheck; });
// The farm server judges the records the gates are about, with the app's own
// code — FR-GATE-01 to 05, FR-TREAT-02, FR-PROOF-01/02, FR-STOCK-04/07/08 and
// the Week 10 organics rule.
//
// Until this file those checks ran only on the phone. The phone is the thing a
// person controls, and a phone that skipped a screen — an old build, a patched
// one, a curl command with a token — could sync a planting into untested soil,
// a spray with no diagnosis or out of rotation, or a harvest inside its
// waiting period, and every other phone would replay it as fact.
//
// The rules are not written down twice. The server rebuilds the farm from its
// own log with the app's reduce() and asks the app's own gate functions, with
// the rules file loaded from where it is published (CLAUDE.md: one copy).
// scripts-build-deno.mjs bundles these modules into the single-file Deno
// server, so Deno Deploy runs exactly this code too.
//
// Two numbers never come from the phone: the pre-harvest and re-entry
// intervals on a spray are the server's catalogue's (FR-STOCK-07), and the
// harvest block is judged on those (FR-TREAT-02).

// store.js first: the app's modules import each other in a cycle that only
// resolves in this order (onboarding → catalogue → store → gates → onboarding).






/** The record types judged here. Anything else passes through untouched. */
const JUDGED = new Set(['cycle.start', 'topsoil.assign', 'spray.record', 'harvest.record', 'task.complete']);

const FARM_OFFSET_MS = 3600 * 1000;   // WAT, UTC+1: the day on the farm, not in UTC

/** The farm's calendar day at an instant. */
function farmDay(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t + FARM_OFFSET_MS).toISOString().slice(0, 10) : null;
}

const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** A refusal in one shape: what, why, what to do, and the requirement behind it. */
const refuse = (why, fix = null, rule = null) => ({ ok: false, why, fix, rule });

/** The reasons a spray is refused, mapped to the requirement each one is. */
const SPRAY_RULE = {
  'no-diagnosis': 'FR-GATE-04', unconfirmed: 'FR-GATE-04', 'awaiting-approval': 'FR-ROLE-13',
  'spray-history-missing': 'FR-ONB-05', rotation: 'FR-GATE-05', 'thrips-programme': 'FR-GATE-05',
  interval: 'FR-GATE-05', 'metalaxyl-interval': 'FR-GATE-05', 'not-in-catalogue': 'FR-STOCK-05',
  'no-rate': 'FR-STOCK-08', 'week-10': 'Week 10 organics rule (SR-08)', expired: 'FR-STOCK-04',
};

/**
 * A state for judging one record: the farm as the server holds it, cut back so
 * nothing dated after the record's own day can count against it — a spray
 * logged on Monday is not refused for a spray somebody else logged on Tuesday.
 */
function asOf(state, day) {
  const dated = (x) => !x.date || x.date <= day;
  return { ...state, sprays: (state.sprays || []).filter(dated), backfills: (state.backfills || []).filter(dated) };
}

/**
 * Judge one record against the farm. `state` is reduce() of the server's log
 * plus whatever this push has already accepted. Returns `{ ok: true }`,
 * `{ ok: true, payload }` when the server rewrites part of it, or a refusal.
 */
function judgeRecord(event, state, { rules }) {
  const p = event.payload || {};
  const at = String(event.at || new Date().toISOString());
  const day = isDay(p.date) ? p.date : farmDay(at);

  switch (event.type) {
    // FR-GATE-01/02/03/06, FR-FARM-05: nothing is transplanted until every
    // gate that blocks transplant is clear or overridden by the Owner.
    case 'cycle.start': {
      const verdict = canPlant(state, p.plotId, { today: farmDay(at), now: at, batchId: p.seedlingBatchId || null });
      if (verdict.ok) return { ok: true };
      const first = verdict.blocking[0] || {};
      return refuse(`Planting is blocked on ${zoneName(state, p.plotId)}: ${verdict.why}. ${first.why || ''}`.trim(),
        first.fix || 'Record what the gates are missing on the Gates screen. Only the Owner can override a gate.',
        'FR-GATE-01/02/03');
    }

    // FR-GATE-03: an untested batch cannot be assigned to a zone.
    case 'topsoil.assign': {
      const verdict = canAssignBatch(state, p.batchId, p.zoneId, { today: farmDay(at) });
      return verdict.ok ? { ok: true } : refuse(verdict.why, verdict.fix, 'FR-GATE-03');
    }

    // FR-GATE-04/05, FR-STOCK-04/05/08, the Week 10 rule — and the waiting
    // periods it carries, from this server's catalogue (FR-STOCK-07).
    case 'spray.record': {
      const productRef = p.activeId || p.productId;
      if (!productRef) {
        return refuse('A spray names the active ingredient that went on.',
          'Choose it from the catalogue on the spray screen.', 'FR-STOCK-05');
      }
      const catalogue = buildCatalogue(state, rules);
      const verdict = canTreat(state, p.cycleId, {
        today: day, now: at, activeId: productRef, catalogue, target: p.targetProblem || null,
      });
      if (!verdict.ok) return refuse(verdict.why, verdict.fix || null, SPRAY_RULE[verdict.reason] || 'FR-GATE-04/05');
      const { phiDays, reiHours } = sprayIntervals(catalogue, p);
      return { ok: true, payload: { ...p, phiDays, reiHours } };
    }

    // FR-TREAT-02 with FR-ONB-04/05: no picking inside a waiting period, read
    // off the catalogue, or on a zone whose spray history is missing.
    case 'harvest.record': {
      if (!p.cycleId) return { ok: true };
      const catalogue = buildCatalogue(state, rules);
      const verdict = harvestCheck(asOf(state, day), p.cycleId, `${day}T12:00:00`, { catalogue, rules });
      if (verdict.safe) return { ok: true };
      return refuse(verdict.historyMissing
        ? verdict.reason
        : `Do not pick ${zoneName(state, (state.cycles[p.cycleId] || {}).plotId)} yet. ${verdict.reason}`,
      verdict.historyMissing
        ? 'The Farm Manager or Owner enters the spray history on the Setup screen.'
        : 'Pick it once the waiting period has passed.',
      verdict.historyMissing ? 'FR-ONB-05' : 'FR-TREAT-02');
    }

    // FR-PROOF-01/02/03: a scouting round or a trap check closes on a photo
    // taken now, in the app, stamped with date, time, zone and person.
    case 'task.complete': {
      const task = (state.tasks || {})[p.id];
      if (!task) return { ok: true };   // not here yet: every phone parks it until it is
      const verdict = proofCheck(task, p);
      return verdict.ok ? { ok: true } : refuse(`${task.title || 'That task'}: ${verdict.why}`, verdict.fix || null, verdict.rule);
    }
    default:
      return { ok: true };
  }
}

function zoneName(state, zoneId) {
  const zone = ((state && state.plots) || {})[zoneId];
  return zone ? zone.name : 'that zone';
}

/**
 * The farm as the server holds it, kept for the length of one push: the stored
 * log plus each record accepted so far, rebuilt only when something new has
 * gone in since the last time it was asked for.
 */
function judgingLog(events) {
  const all = [...events];
  const ids = new Set(all.map((e) => e.id));
  let state = null;
  return {
    has: (id) => ids.has(id),
    add(event) { all.push(event); ids.add(event.id); state = null; },
    state() { if (!state) state = reduce(all); return state; },
  };
}
})(__dvModule("server/judge.mjs"));
__dvBindAll();

// ─── server/core.mjs ───────────────────────────────────────────────────────
let JUDGED, judgeRecord, judgingLog;
let loadRules, peekRules, rulesLoaded, setRules;
__dvImport("server/judge.mjs", (m) => { JUDGED = m.JUDGED; }, (m) => { judgeRecord = m.judgeRecord; }, (m) => { judgingLog = m.judgingLog; });
__dvImport("web/js/rules.js", (m) => { loadRules = m.loadRules; }, (m) => { peekRules = m.peekRules; }, (m) => { rulesLoaded = m.rulesLoaded; }, (m) => { setRules = m.setRules; });
__dvBindAll();
// The farm server's brain: who may join, who may read what, and who may write it.
//
// Runtime-agnostic on purpose. It takes a Request and a storage adapter and
// returns a Response, so the same code runs behind node:http and behind
// Deno.serve with nothing but a thin shim on either side.
//
// WHY THIS EXISTS
//
// The first version of sync used one shared farm key. It kept the books off the
// open internet, but anyone holding the join code could read everything, wages
// included, and roles were only enforced in the app, which is to say not
// enforced at all: a curl command with the key could do anything.
//
// This version fixes that properly.
//
//   * Every person has their own account. There is no shared key.
//   * A device is enrolled by a single-use invite that expires. A PIN on its own
//     never gets you in from a new phone, so a shouted-across-the-yard PIN is
//     useless to anyone who was not given an invite.
//   * The server decides what each role may read and write. The app's role
//     checks are now a convenience for the person using it; this is the fence.
//   * Events are stamped with the authenticated author, so nobody can file work
//     under someone else's name.




// --- Roles ----------------------------------------------------------------
// Mirrors web/js/store.js. The app's copy shapes the screens; this copy decides.

const ROLES = {
  hand: {
    rank: 10,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps'],
  },
  supervisor: {
    rank: 50,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'guideDiagnosis', 'viewTreatment'],
  },
  agronomist: {
    rank: 60,
    can: ['viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose', 'scout', 'logSpray', 'prescribe', 'manageCycles',
      'viewTeam', 'viewReports', 'assignTasks', 'viewTreatment'],
  },
  manager: {
    rank: 80,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings', 'guideDiagnosis', 'viewTreatment'],
  },
  ceo: {
    rank: 100,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'countTraps', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings',
      'manageOwners', 'manageSync', 'viewAudit', 'wipeFarm', 'viewTreatment'],
  },
};

const can = (role, permission) => !!ROLES[role] && ROLES[role].can.includes(permission);
const rankOf = (role) => (ROLES[role] ? ROLES[role].rank : -1);

/** Which roles a person may hand out: the CEO anyone, everyone else below themselves. */
function assignableRoles(role) {
  if (!can(role, 'managePeople')) return [];
  if (can(role, 'manageOwners')) return Object.keys(ROLES);
  return Object.keys(ROLES).filter((r) => rankOf(r) < rankOf(role));
}

// --- What each kind of record is, and who may touch it ---------------------

const ANY = 'viewGuide';   // every role holds this, so it means "everyone on the farm"

/**
 * write: the permission needed to file this kind of record.
 * read:  the permission needed to receive it at all.
 * redact: strips fields the reader has no business seeing.
 */
const EVENT_POLICY = {
  'settings.update':   { write: 'settings',      read: ANY, redact: redactSettings, guard: guardSettings },
  'person.upsert':     { write: 'managePeople',  read: ANY, redact: redactPerson, guard: guardPersonWrite },
  'person.deactivate': { write: 'managePeople',  read: ANY, guard: guardPersonWrite },
  'plot.upsert':       { write: 'manageCycles',  read: ANY },
  'plot.remove':       { write: 'manageCycles',  read: ANY },
  'cycle.start':       { write: 'manageCycles',  read: ANY },
  'cycle.update':      { write: 'manageCycles',  read: ANY },
  'cycle.close':       { write: 'manageCycles',  read: ANY },
  // FR-ONB-01/03 — mid-season onboarding. A crop set up as already growing is
  // shown as planted before the gates, so setting one up is the Farm
  // Manager's or the Owner's call (`settings`), never a hand's; so is every
  // backfilled entry, because the rotation and the PHI read them.
  'cycle.onboard':     { write: 'settings',      read: ANY, guard: guardOnboard },
  'backfill.record':   { write: 'settings',      read: ANY, guard: guardBackfill },
  // FR-TASK-01, FR-ROLE-05: every role's phone generates the day's schedule
  // when it opens, so anyone may file a generated task — but only in the exact
  // shape the generator makes. Writing a task of your own (FR-TASK-04) is
  // still `assignTasks`; guardTaskCreate holds that line.
  'task.create':       { write: 'viewOwnTasks',  read: ANY, guard: guardTaskCreate },
  'task.update':       { write: 'assignTasks',   read: ANY },
  'task.complete':     { write: 'viewOwnTasks',  read: ANY },
  'task.cancel':       { write: 'assignTasks',   read: ANY },
  'attendance.in':     { write: 'clockIn',       read: ANY },
  'attendance.out':    { write: 'clockIn',       read: ANY },
  'work.log':          { write: 'logWork',       read: ANY },
  'harvest.record':    { write: 'logHarvest',    read: ANY },
  'harvest.verify':    { write: 'verifyHarvest', read: ANY },
  'spray.record':      { write: 'logSpray',      read: ANY },
  // FR-SCOUT-01/03, FR-FARM-04: every role counts the sticky traps, a hand
  // included, and that count opens an alert. Anything more than a trap count
  // — per-plant counts, findings, a scouting round — is `scout` (guardScout).
  'scout.record':      { write: 'countTraps',    read: ANY, guard: guardScout },
  // FR-DIAG-03/07: the guided diagnosis is the Field Supervisor's and the
  // Farm Manager's. A hand's phone that has been patched to open it still
  // cannot file what it produced.
  'diagnosis.record':  { write: 'guideDiagnosis', read: ANY, guard: guardDiagnosis },
  'report.record':     { write: 'reportProblem', read: ANY, guard: guardReport },
  'report.resolve':    { write: 'assignTasks',   read: ANY },
  // FR-TASK-05 / UX-09: an end-of-shift report is written by whoever worked
  // the shift, and answered by whoever runs the work. Kept apart from
  // report.record above: that one is an exception, this one is the day.
  'shift.record':      { write: 'viewOwnTasks',  read: ANY, guard: guardShift },
  'shift.comment':     { write: 'assignTasks',   read: ANY, guard: guardShiftComment },
  'input.upsert':      { write: 'logInputs',     read: ANY, guard: guardInputUpsert },
  // FR-STOCK-06/09 — the catalogue. Adding an active ingredient is the Owner's
  // alone (`manageOwners` is the CEO and nobody else); attaching a brand label
  // to an active that is already in the catalogue is the Farm Manager's.
  //
  // Every phone builds the catalogue from rules/douvalue_rules_rev5_1.json and
  // drops a banned active on the way in, so an `active.add` naming carbofuran
  // never becomes a catalogue entry anywhere. The server refuses it as well,
  // because the phone is the thing an attacker controls and five handsets
  // merging a log is how a bad record would otherwise arrive. See
  // BANNED_ACTIVES below for why the names are repeated here and what stops
  // that copy going stale.
  'active.add':        { write: 'manageOwners',  read: ANY, guard: guardActiveAdd },
  'label.add':         { write: 'settings',      read: ANY, guard: guardLabelAdd },
  'label.retire':      { write: 'settings',      read: ANY },
  'input.receive':     { write: 'logInputs',     read: ANY },
  'input.issue':       { write: 'logInputs',     read: ANY },
  'weather.record':    { write: 'logWork',       read: ANY },

  // FR-DIAG-01 — reference photos for the triage rows and diagnosis cards.
  // `settings` is held by the Farm Manager and the CEO and nobody else, which
  // is the Owner-or-Farm-Manager rule. Everyone reads them: a reference photo
  // is worth nothing on the one phone that has it.
  'reference.photo.set':   { write: 'settings', read: ANY, guard: guardReferencePhoto },
  'reference.photo.clear': { write: 'settings', read: ANY, guard: guardReferenceClear },

  // Gates (requirements 6.2). These decide whether planting and spraying are
  // allowed at all, so who may write them matters more than most.
  //
  // A soil test is evidence, and evidence is recorded by whoever took the
  // sample — but only somebody who runs cycles may say a batch of bought-in
  // topsoil is now filling a particular house.
  'soiltest.record':   { write: 'scout',         read: ANY },
  'topsoil.receive':   { write: 'logInputs',     read: ANY },
  'topsoil.assign':    { write: 'manageCycles',  read: ANY },
  // FR-DIAG-03: a hand reports a sick plant, only a senior may confirm a diagnosis,
  // and a confirmed diagnosis is what unlocks a treatment. FR-DOC-01 adds the
  // step that makes the confirmation mean something: the senior performs the
  // confirm test the card names and records what it showed.
  'diagnosis.confirm': { write: 'verifyHarvest', read: ANY, guard: guardConfirmDiagnosis },
  // FR-ROLE-13: a self-confirmed diagnosis waits for the next level up before
  // a treatment. Who that is depends on who confirmed it, which only the log
  // knows, so writeEvents checks it against the stored records as well.
  'diagnosis.approve': { write: 'prescribe',     read: ANY, guard: guardDoctorConfirm },
  // FR-GATE-07: the Owner alone may override a gate, and the reason is part of
  // the record. `manageOwners` is held by the CEO and nobody else.
  'gate.override':        { write: 'manageOwners', read: ANY, guard: guardOverride },
  'gate.override.revoke': { write: 'manageOwners', read: ANY },

  // The Farm Doctor (requirements 6.14). It is not a person and holds no
  // account, so every one of its outputs is filed by whoever was holding the
  // phone — and confirmed, separately, by somebody senior enough to be worth
  // asking. FR-DOC-08 is the reason confirm and approve are three different
  // record types rather than three fields on one.
  'doctor.record':     { write: 'diagnose',      read: ANY },
  'doctor.confirm':    { write: 'verifyHarvest', read: ANY, guard: guardDoctorConfirm },
  'doctor.approve':    { write: 'prescribe',     read: ANY, guard: guardDoctorConfirm },
  'doctor.owner-seen': { write: 'viewReports',   read: ANY },
  // FR-DOC-06: one line of a gate's evidence, recorded by whoever did the work.
  'gate.evidence':     { write: 'scout',         read: ANY, guard: guardGateEvidence },
  // FR-FARM-04/05: the nursery. Sowing, checking and hardening a batch is
  // field-senior work; the release check is a senior's call, like confirming a
  // diagnosis, because a released batch is what opens Gate 1 for a block. The
  // app re-judges every release from the batch's own record as well.
  'seedling.sow':      { write: 'scout',         read: ANY, guard: guardSeedlingSow },
  'seedling.check':    { write: 'scout',         read: ANY, guard: guardSeedlingRef },
  'seedling.harden':   { write: 'scout',         read: ANY, guard: guardSeedlingRef },
  'seedling.discard':  { write: 'scout',         read: ANY, guard: guardSeedlingRef },
  'seedling.release':  { write: 'verifyHarvest', read: ANY, guard: guardSeedlingRelease },
  // C-19: plant-bag media. A batch is received like any bought-in input, and
  // corrected by the same people; filling bags commits a zone to a batch, which
  // is cycle management, as assigning topsoil is. Rejecting a batch is the
  // Farm Manager's or the Owner's call (`settings`, as for labels above).
  // Recording that a batch failed is anybody who records soil tests: bad news
  // must be easy to write down.
  'media.receive':     { write: 'logInputs',     read: ANY, guard: guardMediaReceive },
  'media.update':      { write: 'logInputs',     read: ANY, guard: guardMediaRef },
  'media.reject':      { write: 'settings',      read: ANY, guard: guardMediaReason },
  'media.fail':        { write: 'scout',         read: ANY, guard: guardMediaReason },
  'media.fill':        { write: 'manageCycles',  read: ANY, guard: guardMediaFill },
  // FR-DIAG-05: a sample, from recommendation to result.
  'lab.record':        { write: 'scout',         read: ANY },
  'lab.send':          { write: 'scout',         read: ANY, guard: guardLabSend },
  'lab.result':        { write: 'verifyHarvest', read: ANY, guard: guardLabResult },

  // Alerts (requirements 6.5). Anyone in the field may say they have picked
  // one up; deciding NOT to treat is a management call and needs a reason,
  // because "we looked at it and left it" is what Season 1 was made of.
  'alert.ack':         { write: 'viewOwnTasks',  read: ANY },
  'alert.decide':      { write: 'assignTasks',   read: ANY, guard: guardNoTreat },

  // Zones and positions (6.1, section 4). Retiring a zone or moving somebody
  // between jobs is management work, so it sits with managePeople and
  // manageCycles rather than with whoever happens to be holding a phone.
  'plot.retire':       { write: 'manageCycles',  read: ANY },
  'plot.restore':      { write: 'manageCycles',  read: ANY },
  'position.upsert':   { write: 'managePeople',  read: ANY },
  'position.assign':   { write: 'managePeople',  read: ANY },
  'position.retire':   { write: 'managePeople',  read: ANY },
  // §4.1, FR-ROLE-06: zones handed to people by name. The Farm Manager and the
  // Owner; the Field Supervisor only when covering, which the app checks
  // against attendance on replay — this refuses anyone else outright.
  'zone.assign':       { write: 'assignTasks',   read: ANY, guard: guardZoneAssign },
  'zone.unassign':     { write: 'assignTasks',   read: ANY, guard: guardZoneAssign },
  // Anyone may say they are not coming in. Being able to report your own
  // absence is the thing that makes the cover mechanism work at six in the
  // morning; needing a manager to record it is how it fails.
  'absence.record':    { write: 'viewOwnTasks',  read: ANY },
  'absence.cancel':    { write: 'viewOwnTasks',  read: ANY },

  // The money. Only roles that run the books ever receive these.
  'sale.record':       { write: 'manageMoney',   read: 'manageMoney' },
  'expense.record':    { write: 'manageMoney',   read: 'manageMoney' },
};

/**
 * Wages are the sharp edge. Everyone needs the names and roles of their
 * colleagues for tasks and harvest to make sense, so the record still travels,
 * but what someone earns goes only to the books and to that person themselves.
 */
function redactPerson(event, reader) {
  const p = event.payload || {};
  const out = { ...p };
  delete out.pinHash;                                  // never leaves the server
  // Readers arrive either as a stored member record (id) or as a session
  // (memberId). Accepting both is what stops "show me my own pay" quietly
  // failing on the one path that matters, the live server.
  const readerId = reader.memberId || reader.id;
  const ownRecord = p.id && p.id === readerId;
  if (!ownRecord && !can(reader.role, 'manageMoney')) {
    delete out.dailyRate;
    delete out.phone;
  }
  return { ...event, payload: out };
}

/** Prices and the wage bill are commercial; crate weights and rates are not. */
function redactSettings(event, reader) {
  if (can(reader.role, 'manageMoney')) return event;
  const p = { ...(event.payload || {}) };
  delete p.prices;
  delete p.seasonality;
  delete p.defaultDailyWage;
  delete p.overtimeRatePerHour;
  return { ...event, payload: p };
}

/**
 * Nobody may promote themselves, and nobody may reach upwards.
 *
 * Checking only the role being granted is not enough, and getting that wrong is
 * how a manager quietly unseats the owner: "make this person a farm hand" is a
 * role a manager may grant, so pointing it at the CEO's own account would pass.
 * Every app works out who you are from this log, so the owner's next sign-in
 * would hand them a farm hand's screens. The target's *current* standing has to
 * be checked as well, which needs the server's own record of them, not the
 * client's claim. That check lives in mayWritePerson below.
 */
function guardPersonWrite(event, author) {
  const payload = event.payload || {};
  const granting = payload.role;
  if (!granting) return { ok: true };                  // deactivate and the like

  // Correcting your own details while keeping the role you already hold is
  // ordinary housekeeping. Without this, a manager could not fix their own
  // phone number, because "manager" is not a role a manager may hand out.
  if (payload.id && payload.id === author.id && granting === author.role) return { ok: true };

  if (!assignableRoles(author.role).includes(granting)) {
    return { ok: false, why: `A ${author.role} cannot create or change a ${granting}` };
  }
  return { ok: true };
}

/**
 * The half of the check that needs to look the target up.
 *
 * You may always edit your own details, but never your own role. You may only
 * touch somebody else if you could have appointed them in the first place, which
 * is what stops anyone reaching over their own head. And the farm must never be
 * left without an owner.
 */
async function mayWritePerson(event, author, farmId, store) {
  if (event.type !== 'person.upsert' && event.type !== 'person.deactivate') return { ok: true };

  const payload = event.payload || {};
  const targetId = payload.id;
  if (!targetId) return { ok: false, why: 'That record names nobody' };

  const existing = await store.getMember(farmId, targetId);

  if (targetId === author.id) {
    if (event.type === 'person.deactivate') {
      return { ok: false, why: 'You cannot remove your own account' };
    }
    if (payload.role && existing && payload.role !== existing.role) {
      return { ok: false, why: 'You cannot change your own role' };
    }
    return { ok: true };
  }

  // Somebody the server has never heard of is a new account, already covered by
  // the check on the role being granted.
  if (!existing) return { ok: true };

  if (!assignableRoles(author.role).includes(existing.role)) {
    return { ok: false, why: `A ${author.role} cannot change a ${existing.role}` };
  }

  if (event.type === 'person.deactivate' && existing.role === 'ceo') {
    const owners = (await store.listMembers(farmId)).filter((m) => m.role === 'ceo' && m.status === 'active');
    if (owners.length <= 1) return { ok: false, why: 'That is the only CEO account' };
  }

  return { ok: true };
}

// --- Checking your own work — §4.2, FR-ROLE-12 to FR-ROLE-14 ----------------
//
// Mirrors web/js/domain/selfcheck.js. The app judges every record on replay;
// this is the fence that holds when a record arrives from something that is
// not the app. Who raised a diagnosis, who confirmed it, who is on the farm
// and when an alert opened are only in the log, so these checks read it.
//
// The spray window is SR-01's 4-7 PM. The server does not read the rules file,
// so it is repeated here, and tests/self-confirm.test.mjs fails the moment the
// rules say anything else (as BANNED_ACTIVES below is kept honest).

const SPRAY_WINDOW = { open: 16, close: 19 };
const FARM_OFFSET_MS = 3600 * 1000;           // WAT, UTC+1
const HOUR_MS = 3600 * 1000;
const NO_SHOW_HOUR = 9;
const ALERT_DEADLINE_HOURS = 24;              // FR-SCOUT-03, and C-3's "never later than 24 h"
const CONFIRMING_ROLES = new Set(['supervisor', 'manager', 'ceo']);
const DOCTOR_ID = 'farm-doctor';

/** FR-ROLE-13 — who approves a treatment from a diagnosis this role confirmed on itself. */
function approverFor(role) {
  if (role === 'ceo') return null;
  if (role === 'manager') return 'ceo';
  if (role === 'supervisor' || role === 'agronomist' || role === 'hand') return 'manager';
  return 'ceo';
}

function farmMidnight(ms) {
  const shifted = ms + FARM_OFFSET_MS;
  return shifted - (((shifted % (24 * HOUR_MS)) + 24 * HOUR_MS) % (24 * HOUR_MS)) - FARM_OFFSET_MS;
}

/** The first spray window to open strictly after `at`. */
function nextWindowOpens(at) {
  const t = Date.parse(at);
  const today = farmMidnight(t) + SPRAY_WINDOW.open * HOUR_MS;
  return new Date(today > t ? today : today + 24 * HOUR_MS).toISOString();
}

/** C-3: the close of the first spray window after the breach, never later than 24 h. */
function alertDeadline(alertAt) {
  const t = Date.parse(alertAt);
  const close = farmMidnight(t) + SPRAY_WINDOW.close * HOUR_MS;
  return new Date(Math.min(close > t ? close : close + 24 * HOUR_MS, t + ALERT_DEADLINE_HOURS * HOUR_MS)).toISOString();
}

/** What the log says about diagnoses, scouting, sprays and who is in. Built once per push. */
function emptyFacts() {
  return { diagnoses: {}, scouts: {}, sprays: [], decisions: [], attendance: [], absences: {} };
}

/** Fold one stored (or just-accepted) record into the facts. `e.by` is the server's stamp. */
function foldFact(facts, e) {
  const p = (e && e.payload) || {};
  switch (e && e.type) {
    case 'diagnosis.record':
      facts.diagnoses[p.id || e.id] = { id: p.id || e.id, by: e.by, cycleId: p.cycleId || null,
        problemId: p.problemId || null, confirmedBy: null, self: false, approvedBy: null };
      break;
    case 'diagnosis.confirm': {
      const d = facts.diagnoses[p.id];
      if (!d || d.confirmedBy || e.by === DOCTOR_ID) break;          // the first confirmation stands
      d.confirmedBy = e.by; d.self = !!d.by && e.by === d.by;
      break;
    }
    case 'diagnosis.approve': {
      const d = facts.diagnoses[p.id];
      if (d && d.confirmedBy && !d.approvedBy) d.approvedBy = e.by;
      break;
    }
    case 'scout.record':
      if (p.pestId) facts.scouts[p.id || e.id] = { cycleId: p.cycleId, pestId: p.pestId, at: e.at, date: p.date || String(e.at || '').slice(0, 10) };
      break;
    case 'spray.record':
      facts.sprays.push({ cycleId: p.cycleId, date: String(p.date || e.at || '').slice(0, 10), at: e.at });
      break;
    case 'alert.decide':
      facts.decisions.push({ cycleId: p.cycleId, pestId: p.pestId, at: e.at });
      break;
    case 'attendance.in':
      facts.attendance.push({ personId: p.personId || e.by, in: e.at, out: null });
      break;
    case 'attendance.out': {
      const open = [...facts.attendance].reverse().find((a) => a.personId === (p.personId || e.by) && !a.out);
      if (open) open.out = e.at;
      break;
    }
    case 'absence.record':
      facts.absences[p.id || e.id] = { personId: p.personId, date: p.date, cancelled: false };
      break;
    case 'absence.cancel':
      if (facts.absences[p.id]) facts.absences[p.id].cancelled = true;
      break;
    default:
  }
}

/** Every record the server holds for a farm, oldest first. */
async function storedEvents(farmId, store) {
  const out = [];
  for (let since = 0; ;) {
    const page = await store.listEvents(farmId, since, MAX_PULL);
    out.push(...page.events);
    if (!page.more || page.cursor <= since) break;
    since = page.cursor;
  }
  return out;
}

async function logFacts(farmId, store, events = null) {
  const facts = emptyFacts();
  for (const e of events || await storedEvents(farmId, store)) foldFact(facts, e);
  return facts;
}

const declaredOff = (facts, personId, day) => Object.values(facts.absences)
  .some((a) => a.personId === personId && a.date === day && !a.cancelled);

function onFarmAt(facts, personId, at) {
  const day = String(at).slice(0, 10);
  if (declaredOff(facts, personId, day)) return false;
  return facts.attendance.some((a) => a.personId === personId && String(a.in || '').slice(0, 10) === day
    && a.in <= at && (!a.out || a.out > at));
}

function managerAwayFrom(facts, members, at) {
  const day = String(at).slice(0, 10);
  const hour = new Date(Date.parse(at) + FARM_OFFSET_MS).getUTCHours();
  const managers = members.filter((m) => m.role === 'manager' && m.status === 'active');
  return !managers.some((m) => !declaredOff(facts, m.id, day)
    && (hour < NO_SHOW_HOUR || facts.attendance.some((a) => a.personId === m.id && String(a.in || '').slice(0, 10) === day && a.in <= at)));
}

/** The records this section judges from the log. */
const LOG_CHECKED = new Set(['diagnosis.confirm', 'diagnosis.approve', 'spray.record']);
const needsLog = (event) => LOG_CHECKED.has(event && event.type);

/**
 * FR-ROLE-12/13 against the log. `me` is the authenticated member; `at` is the
 * record's own time, which is the moment the phone says it happened.
 */
async function mayWriteFromLog(event, me, facts, members) {
  const p = event.payload || {};
  const at = String(event.at || new Date().toISOString());
  const who = me.memberId || me.id;
  const roleOf = (id) => ((members.find((m) => m.id === id) || {}).role) || null;

  if (event.type === 'diagnosis.confirm') {
    const d = facts.diagnoses[p.id];
    if (!d) return { ok: true };                    // not here yet; the app parks it until it is
    if (d.by && who === d.by) {
      const others = members.filter((m) => m.status === 'active' && CONFIRMING_ROLES.has(m.role)
        && m.id !== who && onFarmAt(facts, m.id, at));
      if (others.length) {
        return { ok: false, why: `A second person confirms it: ${others.map((m) => m.name || m.id).join(' or ')} is on the farm (FR-ROLE-12)` };
      }
    }
    return { ok: true };
  }

  if (event.type === 'diagnosis.approve') {
    const d = facts.diagnoses[p.id];
    if (!d || !d.confirmedBy) return { ok: false, why: 'That diagnosis has not been confirmed on the farm server yet' };
    if (!d.self) return { ok: false, why: 'A second person confirmed that diagnosis; it needs no approval' };
    const needed = approverFor(roleOf(d.confirmedBy));
    if (!needed) return { ok: false, why: "The Owner's own confirmation is recorded, not sent up for approval" };
    if (d.approvedBy) return { ok: false, why: 'That diagnosis is already approved' };
    if (who === d.confirmedBy) return { ok: false, why: 'Nobody approves a diagnosis they confirmed themselves (FR-ROLE-13)' };
    if (needed === 'ceo') return me.role === 'ceo' ? { ok: true } : { ok: false, why: 'The Owner approves a Farm Manager\'s self-confirmed diagnosis' };
    if (me.role === 'manager') return { ok: true };
    if (me.role === 'ceo') {
      return managerAwayFrom(facts, members, at)
        ? { ok: true }
        : { ok: false, why: 'The Farm Manager is in today, so the Farm Manager approves it' };
    }
    return { ok: false, why: 'The Farm Manager approves a self-confirmed diagnosis from the field' };
  }

  if (event.type === 'spray.record') {
    const d = p.diagnosisId && facts.diagnoses[p.diagnosisId];
    if (!d || !d.confirmedBy || !d.self || d.approvedBy || !approverFor(roleOf(d.confirmedBy))) return { ok: true };
    // FR-ROLE-13: blocked until the approval lands, unless the treatment
    // closes an open alert due before the next spray window.
    const blocked = { ok: false, why: 'That diagnosis was self-confirmed and is waiting on its approval; the treatment is blocked until it lands (FR-ROLE-13)' };
    const alertId = String(((p.beforeApproval || {}).alertId) || '');
    const scout = alertId.startsWith('alert:') ? facts.scouts[alertId.slice(6)] : null;
    if (!scout || scout.cycleId !== p.cycleId || scout.at > at || (d.problemId && scout.pestId !== d.problemId)) return blocked;
    const closed = facts.sprays.some((s) => s.cycleId === scout.cycleId && s.date >= scout.date && s.at <= at)
      || facts.decisions.some((x) => x.cycleId === scout.cycleId && x.pestId === scout.pestId && x.at >= scout.at && x.at <= at);
    if (closed) return blocked;
    return alertDeadline(scout.at) < nextWindowOpens(at) ? { ok: true } : blocked;
  }
  return { ok: true };
}

function mayWrite(event, author) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return { ok: false, why: `Unknown record type ${event.type}` };
  if (!can(author.role, policy.write)) {
    return { ok: false, why: `A ${author.role} may not file ${event.type}` };
  }
  if (policy.guard) return policy.guard(event, author);
  return { ok: true };
}

function visibleTo(event, reader) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return null;                            // unknown types are not relayed
  if (!can(reader.role, policy.read)) return null;
  return policy.redact ? policy.redact(event, reader) : event;
}

// --- Secrets --------------------------------------------------------------

const PBKDF2_ROUNDS = 210000;                          // OWASP guidance for PBKDF2-SHA256
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

/** A short code a person can read out over the phone without confusion. */
function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I, O, 0, 1
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  return [...a].map((n) => alphabet[n % alphabet.length]).join('');
}

async function hashSecret(secret, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    key, 256,
  );
  return { salt, hash: toHex(bits) };
}

async function verifySecret(secret, salt, expected) {
  if (!salt || !expected) return false;
  const { hash } = await hashSecret(secret, salt);
  return timingSafeEqualHex(hash, expected);
}

/** Compare without leaking where two strings first differ. */
function timingSafeEqualHex(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Device tokens are stored only as a digest, so a stolen database grants nothing. */
async function tokenDigest(token) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(String(token))));
}

/**
 * A fast digest of a join code, used only to find which account it belongs to.
 *
 * The slow hash stays on the password, which is what actually proves identity.
 * Making the lookup fast matters: verifying a code against every pending invite
 * with PBKDF2 would take a second per invite, which is both slow for the person
 * joining and an easy way for a stranger to tie the server in knots.
 */
async function codeDigest(farmId, code) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(`${farmId}:${String(code).toUpperCase()}`)));
}

// --- Guessing defence -----------------------------------------------------

// NFR-SEC-02: five wrong tries, then the account is locked for a quarter of an hour.
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function lockoutState(member, now = Date.now()) {
  const fails = member.failedAttempts || 0;
  const until = member.lockedUntil || 0;
  if (until > now) return { locked: true, seconds: Math.ceil((until - now) / 1000) };
  return { locked: false, fails: until ? 0 : fails };
}

function afterFailure(member, now = Date.now()) {
  const fails = (lockoutState(member, now).fails || 0) + 1;
  return fails >= LOCKOUT_AFTER
    ? { failedAttempts: 0, lockedUntil: now + LOCKOUT_MS }
    : { failedAttempts: fails, lockedUntil: 0 };
}

const afterSuccess = () => ({ failedAttempts: 0, lockedUntil: 0 });

// --- HTTP -----------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

const MAX_BODY = 5_000_000;
const MAX_PUSH = 1000;
const MAX_PULL = 1000;
const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;
const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  try { return JSON.parse(text); } catch { throw new Error('bad json'); }
}

/**
 * The whole API.
 *
 *   POST /api/farms/:id/bootstrap   create the farm and its CEO (once only)
 *   POST /api/signin                sign in on a new phone with a sign-in name and password (UX-28)
 *   POST /api/farms/:id/signin      the same, for one farm
 *   POST /api/farms/:id/account     give a person a sign-in name and password, or change them (UX-28)
 *   POST /api/farms/:id/invite      issue a single-use invite for a new person
 *   POST /api/farms/:id/join        redeem an invite, enrol this device
 *   POST /api/farms/:id/unlock      exchange a PIN for a fresh token on an enrolled device
 *   POST /api/farms/:id/revoke      cut off a person or a device
 *   GET  /api/farms/:id/me          who this token belongs to
 *   GET  /api/farms/:id/members     names and roles
 *   GET  /api/farms/:id/events      everything this role may see since a cursor
 *   POST /api/farms/:id/events      file records, each checked against the author
 *   POST /api/farms/:id/advise      the wider adviser: live weather, and the web if a key is set
 *   POST /api/farms/:id/photo-review  the Farm Doctor's photo review (FR-DOC-03)
 *   GET  /api/farms/:id/notify      whether WhatsApp to the Owner is set up (FR-REP-02)
 *   POST /api/farms/:id/notify      send the Owner the digest or a straight-to-Owner item
 */
async function handleRequest(req, store) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (!parts.length) {
    return new Response('DouValue farm server is running.\n\nPut this address into the app.\n',
      { status: 200, headers: { 'Content-Type': 'text/plain', ...CORS } });
  }
  const signingIn = parts[0] === 'api' && parts[1] === 'signin' && parts.length === 2;
  if (!signingIn && (parts[0] !== 'api' || parts[1] !== 'farms' || !parts[2])) return json({ error: 'Not found' }, 404);

  let body = {};
  if (req.method === 'POST') {
    try { body = await readJson(req); }
    catch (e) { return json({ error: e.message === 'too large' ? 'That batch is too large' : 'Body was not valid JSON' }, e.message === 'too large' ? 413 : 400); }
  }

  // UX-28: a new phone knows the server's address and nothing else, so the
  // sign-in name is what finds the farm.
  if (signingIn) return req.method === 'POST' ? signIn(null, body, store) : json({ error: 'Not found' }, 404);

  const farmId = decodeURIComponent(parts[2]);
  if (!safeId(farmId)) return json({ error: 'Bad farm id' }, 400);
  const action = parts[3] || '';

  if (action === 'bootstrap' && req.method === 'POST') return bootstrap(farmId, body, store);
  if (action === 'join' && req.method === 'POST') return join(farmId, body, store);
  if (action === 'signin' && req.method === 'POST') return signIn(farmId, body, store);

  // Everything below needs a token.
  const auth = await authenticate(farmId, req, store);
  if (!auth.ok) return auth.response;
  const me = auth.member;

  if (action === 'me' && req.method === 'GET') {
    return json({ ok: true, member: publicMember(me), farm: publicFarm(await store.getFarm(farmId)) });
  }
  if (action === 'members' && req.method === 'GET') {
    const members = await store.listMembers(farmId);
    return json({ members: members.map(publicMember) });
  }
  if (action === 'invite' && req.method === 'POST') return invite(farmId, body, me, store);
  if (action === 'account' && req.method === 'POST') return account(farmId, body, me, store);
  if (action === 'revoke' && req.method === 'POST') return revoke(farmId, body, me, store);
  if (action === 'unlock' && req.method === 'POST') return unlock(farmId, body, me, store, auth.token);
  if (action === 'events' && req.method === 'GET') return readEvents(farmId, url, me, store);
  if (action === 'events' && req.method === 'POST') return writeEvents(farmId, body, me, store);
  if (action === 'advise' && req.method === 'POST') return advise(farmId, body, me, store);
  // FR-DOC-03: photo review. Online only, by design — the app's guided
  // diagnosis is what answers when this cannot be reached.
  if (action === 'photo-review' && req.method === 'POST') return photoReview(farmId, body, me, store);
  // FR-REP-02: the Owner's WhatsApp. The phones decide what to say; the key
  // to send it lives here and nowhere else.
  if (action === 'notify' && req.method === 'GET') return json(await notifyStatus(farmId, store));
  if (action === 'notify' && req.method === 'POST') return json(await notifyOwner(farmId, body, me, store));

  return json({ error: 'Not found' }, 404);
}

const publicMember = (m) => ({
  id: m.id, name: m.name, role: m.role, status: m.status, login: m.login || null,
  joinedAt: m.joinedAt || null, invitedAt: m.invitedAt || null,
});
const publicFarm = (f) => (f ? { id: f.id, name: f.name, created: f.created } : null);

async function authenticate(farmId, req, store) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, response: json({ error: 'Sign in first' }, 401) };

  const rec = await store.getToken(await tokenDigest(token));
  if (!rec || rec.farmId !== farmId) return { ok: false, response: json({ error: 'That sign-in has expired' }, 401) };

  const member = await store.getMember(farmId, rec.memberId);
  if (!member || member.status !== 'active') {
    return { ok: false, response: json({ error: 'That account is no longer active' }, 403) };
  }
  await store.touchToken(rec.digest, new Date().toISOString());
  return { ok: true, member, token: rec };
}

/**
 * FR-SCOUT-05 — deciding not to treat is a decision, not a dismissal.
 *
 * An alert closes on a treatment or on this. Letting it close on a bare tap
 * would make the board clearable by whoever finds it annoying, which is the
 * failure mode this whole section exists to prevent.
 */
function guardNoTreat(event) {
  const p = event.payload || {};
  // The crop, or — in the nursery, which has none — the zone (FR-FARM-04).
  if ((!p.cycleId && !p.zoneId) || !p.pestId) return { ok: false, why: 'Say which zone and which pest' };
  if (String(p.reason || '').trim().length < 10) {
    return { ok: false, why: 'Say why no treatment is needed — a sentence someone can check later' };
  }
  return { ok: true };
}

/**
 * FR-SCOUT-01 — a count is a number, and a hand's record is a trap count.
 *
 * The Greenhouse Hands count the traps — the nursery's every morning, each
 * crop's every week — and that number is what the thresholds read, so it has to
 * reach the board from a hand's phone. What a hand files is the trap count and
 * nothing else: the pest, the zone (the nursery has no crop), a whole number
 * from zero up, and the task it closed. A per-plant count, a finding or a borer
 * count is a scouting round, and that is the Field Supervisor's.
 */
const HAND_TRAP_FIELDS = new Set([
  'id', 'kind', 'zoneId', 'cycleId', 'pestId', 'trapCount', 'note', 'taskId', 'date', 'enteredAt', 'photo',
]);
function guardScout(event, author) {
  const p = event.payload || {};
  for (const k of ['trapCount', 'perPlant', 'plantsAffected']) {
    if (p[k] != null && !(Number.isFinite(Number(p[k])) && Number(p[k]) >= 0)) {
      return { ok: false, why: 'A count is a number, 0 or more' };
    }
  }
  if (can(author.role, 'scout')) return { ok: true };
  const notTrap = { ok: false, why: 'A Greenhouse Hand records trap counts; a scouting round is the Field Supervisor\'s' };
  if (p.kind !== 'trap') return notTrap;
  if (Object.keys(p).some((k) => !HAND_TRAP_FIELDS.has(k))) return notTrap;
  if (!p.pestId || !p.zoneId) return { ok: false, why: 'Say which zone and which pest the trap count is for' };
  if (!Number.isInteger(p.trapCount) || p.trapCount < 0) {
    return { ok: false, why: 'A trap count is a whole number, 0 or more' };
  }
  return { ok: true };
}

/**
 * FR-TASK-01 — what a generated task looks like, and nothing else.
 *
 * The daily schedule is generated on whichever phone opens first, which may be
 * a Greenhouse Hand's. A hand may not hand out work, so what a hand's phone
 * files has to be the generator's output and only that: a known kind, the id
 * the generator derives from the day, the zone and the kind (or from the spray,
 * for the three-day check), an event id derived from that, and nobody named.
 * Any other task is the Farm Manager's or a supervisor's to write.
 *
 * The kinds are repeated from web/js/domain/schedule.js, nursery.js and
 * doctor.js because the server does not import the app;
 * tests/generate-any-role.test.mjs fails if they drift.
 */
const GENERATED_TASK_KINDS = [
  'scout', 'trap', 'irrigate', 'fertigate', 'prune', 'harvest', 'sanitation',
  'nursery_trap', 'seedling_check', 'follow_up',
];
function guardTaskCreate(event, author) {
  if (can(author.role, 'assignTasks')) return { ok: true };
  const p = event.payload || {};
  const refuse = { ok: false, why: 'Only the Farm Manager or a supervisor writes a task; your phone may only add the day\'s scheduled work' };
  if (p.generated !== true || !GENERATED_TASK_KINDS.includes(p.kind) || typeof p.id !== 'string') return refuse;
  if (event.id !== `ev_${p.id}`) return refuse;
  if (p.assignedTo || p.personId) return refuse;
  if (p.kind === 'follow_up') {
    if (!p.sprayId || p.id !== `fd_follow_${p.sprayId}`) return refuse;
  } else {
    const day = String(p.due || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !p.zoneId || p.id !== `gen_${day}_${p.zoneId}_${p.kind}`) return refuse;
  }
  return { ok: true };
}

/**
 * UX-27 — the field-trial sign-off belongs to the Owner.
 *
 * Settings are the Farm Manager's in general, and that is right for crate
 * weights and wages. This one is different: it is the switch that ends
 * supervised use of the spray and gate screens, and the person most tempted to
 * throw it early is the manager who finds the confirmation tedious. So the
 * write permission stays where it is and this one field is lifted to the Owner.
 */
function guardSettings(event, author) {
  const p = event.payload || {};
  if (!Object.prototype.hasOwnProperty.call(p, 'fieldTrial')) return { ok: true };
  if (!can(author.role, 'manageOwners')) {
    return { ok: false, why: 'Only the Owner can sign off the field trial (UX-26/27)' };
  }
  return { ok: true };
}

/**
 * FR-DIAG-01, FR-DIAG-02, FR-DOC-01 — a diagnosis is a card, the answers, the
 * photos, the reasoning and a person.
 *
 * The Farm Doctor is not allowed to name a cause off a glance: it asks for the
 * photos and the confirm step first. The screens enforce that, but the screens
 * run on a phone that has been offline for three days, so the server enforces
 * it too — otherwise "diagnosed" becomes a word somebody types to get past the
 * treatment gate, which is exactly the guesswork that cost Season 1.
 *
 * This is deliberately structural. Which cards exist and which test confirms
 * which card is in the rules JSON, and the server does not read the rules; it
 * only insists that a diagnosis carries the parts a diagnosis has.
 */
function guardDiagnosis(event) {
  const p = event.payload || {};
  if (!p.cardId) return { ok: false, why: 'A diagnosis names the card it came from' };
  if (p.triageRow == null) return { ok: false, why: 'A diagnosis names the triage row it started at' };
  if (!Array.isArray(p.photos) || !p.photos.length) {
    return { ok: false, why: 'Take a photo of the plant before naming a cause' };
  }
  if (!String(p.confirmTest || '').trim()) {
    return { ok: false, why: 'Record which confirm test you did' };
  }
  if (!String(p.confirmResult || '').trim()) {
    return { ok: false, why: 'Record what the confirm test showed' };
  }
  if (String(p.reasoning || '').trim().length < 10) {
    return { ok: false, why: 'Write why you think it is this — a sentence someone can check later' };
  }
  return { ok: true };
}

/**
 * FR-DIAG-07 — a sick-plant report carries what the short flow asks for: the
 * zone, a photo, where on the plant and how many plants. Those answers are what
 * decide whether it raises an alert (FR-DIAG-09), so a report missing them
 * would be one that could never be serious. Any other problem report is free
 * text, as it always was.
 *
 * The lists of answers are repeated from web/js/domain/sickplant.js because the
 * server does not import the app; tests/sickplant.test.mjs fails if they drift.
 */
const SICK_PLANT_WHERE = ['top_leaves', 'old_leaves', 'flowers_fruit', 'stem', 'base_roots', 'wilting'];
const SICK_PLANT_HOW_MANY = ['one', 'few', 'many'];
function guardReport(event) {
  const p = event.payload || {};
  if (p.kind !== 'sick-plant') return { ok: true };
  if (!p.zoneId) return { ok: false, why: 'Say which zone the sick plant is in' };
  if (!Array.isArray(p.photos) || !p.photos.length) return { ok: false, why: 'Take a photo of the plant' };
  if (!Array.isArray(p.where) || !p.where.length || !p.where.every((w) => SICK_PLANT_WHERE.includes(w))) {
    return { ok: false, why: 'Say where on the plant' };
  }
  if (!SICK_PLANT_HOW_MANY.includes(p.howMany)) return { ok: false, why: 'Say how many plants' };
  return { ok: true };
}

/**
 * FR-ROLE-06 — who hands out zones.
 *
 * The Farm Manager and the Owner. The Field Supervisor only on a record that
 * says it is covering; whether the Farm Manager really was out that day is a
 * question of attendance, which every phone replays and refuses on its own.
 * The agronomist assigns tasks but not zones.
 */
function guardZoneAssign(event, author) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which assignment this is' };
  const role = author.role;
  if (role === 'supervisor' && p.covering !== true) {
    return { ok: false, why: 'The Field Supervisor assigns zones only when covering for the Farm Manager' };
  }
  if (!['manager', 'ceo', 'supervisor'].includes(role)) {
    return { ok: false, why: 'Zones are assigned by the Farm Manager, or the Field Supervisor when covering' };
  }
  if (event.type === 'zone.assign') {
    if (!p.zoneId || !p.personId) return { ok: false, why: 'An assignment names a zone and a person' };
    if (!['primary', 'backup'].includes(p.holding)) {
      return { ok: false, why: 'Say whether it is their primary or backup zone' };
    }
  }
  return { ok: true };
}

/**
 * UX-09 — an end-of-shift report has to say something.
 *
 * The floor is four words, and it is a floor rather than a suggestion because
 * "ok" filed every evening for a month is a tick wearing a sentence's clothes.
 * The app refuses it first; this refuses it for the phone that was patched.
 *
 * Nobody may file somebody else's day: the server stamps the author onto the
 * event, so a report naming a different person is rejected rather than quietly
 * re-attributed.
 */
function guardShift(event, author) {
  const p = event.payload || {};
  if (!p.date) return { ok: false, why: 'A shift report is about one day; say which' };
  if (p.personId && p.personId !== author.id) {
    return { ok: false, why: 'A shift report is filed by the person who worked the shift' };
  }
  const words = String(p.observation || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return { ok: false, why: 'Say what you saw and what you did — a line, not a word' };
  }
  return { ok: true };
}

/**
 * The rules put it plainly: "Field Supervisor or Farm Manager performs the
 * confirm test and confirms". Performing it is the point, so the confirmation
 * carries what the confirmer saw, not just their name.
 */
function guardConfirmDiagnosis(event, author = {}) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which diagnosis is being confirmed' };
  if ((author.memberId || author.id) === 'farm-doctor') {
    return { ok: false, why: 'The Farm Doctor does not confirm its own diagnosis (FR-DOC-08)' };
  }
  if (!String(p.confirmTest || '').trim()) {
    return { ok: false, why: 'Say which confirm test you did' };
  }
  if (!String(p.confirmResult || '').trim()) {
    return { ok: false, why: 'Say what the confirm test showed' };
  }
  return { ok: true };
}

/**
 * FR-DIAG-01 — a reference photo names the slot it fills and carries a picture.
 *
 * Which slots exist comes from the rules JSON, which this server does not read,
 * so the check here is the shape and the size. The size is the point: these are
 * the only pictures in the log that every phone downloads whether or not it
 * ever opens them, so one oversized upload is a cost the whole farm pays on a
 * metered bundle (FR-PROOF-04, NFR-DEV-01).
 */
const REFERENCE_PHOTO_MAX_BYTES = 200 * 1024;

function guardReferencePhoto(event) {
  const p = event.payload || {};
  if (!/^(row|card):[A-Za-z0-9_]+$/.test(String(p.slot || ''))) {
    return { ok: false, why: 'A reference photo must say which row or card it belongs to' };
  }
  const photo = p.photo || {};
  if (!String(photo.dataUrl || '').startsWith('data:image/')) {
    return { ok: false, why: 'A reference photo needs a picture' };
  }
  const bytes = Number(photo.bytes) || Math.round((String(photo.dataUrl).length * 3) / 4);
  if (bytes > REFERENCE_PHOTO_MAX_BYTES) {
    return { ok: false, why: 'That picture is too big to send to every phone on the farm' };
  }
  return { ok: true };
}

/** A comment answers one report, and an empty one answers nothing. */
function guardShiftComment(event) {
  const p = event.payload || {};
  if (!p.shiftId) return { ok: false, why: 'Say which report this answers' };
  if (!String(p.note || '').trim()) return { ok: false, why: 'An empty comment says nothing' };
  return { ok: true };
}

function guardReferenceClear(event) {
  const p = event.payload || {};
  if (!p.slot) return { ok: false, why: 'Say which reference photo is being removed' };
  if (String(p.reason || '').trim().length < 4) {
    return { ok: false, why: 'Say why the picture is coming off' };
  }
  return { ok: true };
}

/**
 * FR-GATE-07 — an override is a decision on the record, not a switch.
 *
 * The permission table already limits this to the Owner. This adds the part
 * that makes the record worth having: it must name which gate, which zone, and
 * why. An override with an empty reason is refused, because a year later
 * "someone turned it off" is not an answer anybody can act on.
 */
function guardOverride(event, author) {
  const p = event.payload || {};
  if (!p.gate || !p.zoneId) return { ok: false, why: 'An override must name the gate and the zone' };
  const reason = String(p.reason || '').trim();
  if (reason.length < 10) {
    return { ok: false, why: 'An override needs a reason saying why it is safe to go ahead' };
  }
  return { ok: true };
}

/**
 * FR-DOC-08 — the Farm Doctor never confirms its own diagnosis or approves its
 * own plan.
 *
 * The app enforces this too, and the app's copy is the one people see. This is
 * the one that holds when the record arrives from something that is not the
 * app: a replayed request, another phone's queue, a curl command.
 */
function guardDoctorConfirm(event, author) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which Farm Doctor output this is about' };
  const who = author.memberId || author.id;
  if (who === 'farm-doctor') {
    return { ok: false, why: 'The Farm Doctor does not confirm or approve its own work (FR-DOC-08)' };
  }
  return { ok: true };
}

/** FR-DOC-06 — evidence has to say which gate and which line of it. */
function guardOnboard(event) {
  const p = event.payload || {};
  if (!p.id || !p.plotId) return { ok: false, why: 'Say which zone the crop is in' };
  if (!p.cropId || !p.transplantDate) return { ok: false, why: 'A crop and a transplant date are both needed' };
  const madeOn = String(event.at || '').slice(0, 10);
  const setup = p.setupDate && madeOn && p.setupDate < madeOn ? p.setupDate : madeOn;
  if (!(String(p.transplantDate) < setup)) {
    return { ok: false, why: 'Only a crop planted before setup day is onboarded; one planted today goes through the gates' };
  }
  return { ok: true };
}

const BACKFILL_KINDS = ['spray', 'harvest', 'stock', 'evidence', 'declare'];
function guardBackfill(event) {
  const p = event.payload || {};
  if (!BACKFILL_KINDS.includes(p.kind)) return { ok: false, why: 'Unknown kind of backfilled entry' };
  if (['spray', 'harvest'].includes(p.kind) && !p.cycleId) return { ok: false, why: 'Say which crop it is about' };
  if (p.kind === 'spray' && !p.date) return { ok: false, why: 'A backfilled spray needs the day it went on' };
  if (p.kind === 'stock' && !p.itemId) return { ok: false, why: 'Say which store item was counted' };
  if (p.kind === 'evidence' && !p.zoneId) return { ok: false, why: 'Evidence must name the zone it is about' };
  return { ok: true };
}

function guardGateEvidence(event) {
  const p = event.payload || {};
  if (!p.gate || !p.itemId) return { ok: false, why: 'Evidence must name the gate and which line of it' };
  if (!p.zoneId) return { ok: false, why: 'Evidence must name the zone it is about' };
  return { ok: true };
}

/**
 * FR-FARM-04 — nursery media must be clean: sterilised, solarised or
 * bought-in; never raw soil from a cropping block (rules → nursery.rules).
 */
const CLEAN_MEDIA = ['sterilised', 'solarised', 'bought-in'];
function guardSeedlingSow(event) {
  const p = event.payload || {};
  if (!p.id || !p.nurseryZoneId) return { ok: false, why: 'A batch needs an id and the nursery it is in' };
  if (!CLEAN_MEDIA.includes(p.media)) {
    return { ok: false, why: 'Nursery media must be sterilised, solarised or bought-in, never raw block soil' };
  }
  return { ok: true };
}

function guardSeedlingRef(event) {
  const p = event.payload || {};
  if (!p.batchId) return { ok: false, why: 'Say which seedling batch' };
  return { ok: true };
}

/** FR-FARM-05 — a release names the batch and the block it goes to. */
function guardSeedlingRelease(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which seedling batch' };
  if (!p.zoneId) return { ok: false, why: 'A release names the block the batch goes to' };
  return { ok: true };
}

/**
 * C-19 — a media batch names its supplier and delivery date (Gate 0 for a bag
 * zone reads both), and says whether it is fresh or re-treated media.
 */
const MEDIA_SOURCES = ['fresh', 're-treated'];
function guardMediaReceive(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'A media batch needs an id' };
  if (!String(p.supplier || '').trim()) return { ok: false, why: 'Say who supplied the media' };
  if (!p.deliveredDate) return { ok: false, why: 'Say the day the media was delivered' };
  if (!MEDIA_SOURCES.includes(p.source)) return { ok: false, why: 'Say whether the media is fresh or re-treated' };
  return { ok: true };
}

function guardMediaRef(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which media batch' };
  if (p.source != null && !MEDIA_SOURCES.includes(p.source)) {
    return { ok: false, why: 'Media is fresh or re-treated' };
  }
  return { ok: true };
}

/** A rejection or a failure says why: it is what every zone the batch filled is told. */
function guardMediaReason(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which media batch' };
  if (String(p.reason || '').trim().length < 3) return { ok: false, why: 'Say why' };
  return { ok: true };
}

/** A fill is batch → bags → zone; all three are named. */
function guardMediaFill(event) {
  const p = event.payload || {};
  if (!p.batchId) return { ok: false, why: 'Say which media batch filled the bags' };
  if (!p.zoneId) return { ok: false, why: 'Say which zone the bags are in' };
  if (!(Number(p.bags) > 0)) return { ok: false, why: 'Say how many bags were filled' };
  return { ok: true };
}

/** FR-DIAG-05 — a sample is tracked by where it went and when. */
function guardLabSend(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which sample' };
  if (!String(p.lab || '').trim()) return { ok: false, why: 'Say which lab it went to' };
  return { ok: true };
}

function guardLabResult(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which sample' };
  if (!String(p.result || '').trim()) return { ok: false, why: 'Say what the lab reported' };
  return { ok: true };
}

/**
 * The actives this farm will not hold, whatever anybody types.
 *
 * rules/douvalue_rules_rev5_1.json → labels.banned is the source of truth and
 * every phone reads it from there. This file is different: it is pasted into
 * Deno Deploy as one file with no rules beside it, so it cannot read them and
 * carries the names instead. That copy is the kind CLAUDE.md warns about, so
 * it has a tripwire — tests/catalogue.test.mjs fails if the two ever drift,
 * the same way the suite fails when the generated Deno build drifts from this
 * file.
 *
 * FR-STOCK-09: banned actives can never be added and must not ship in the
 * catalogue at all. Carbofuran has killed farm workers and poisoned whole
 * flocks of birds, and residues in pepper fail any buyer's test.
 */
const BANNED_ACTIVES = ['Carbofuran (Furadan)'];

const BANNED_WORDS = new Set(
  BANNED_ACTIVES.flatMap((entry) => String(entry).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)),
);

/** Does this name reach a banned active by any spelling on the label? */
function namesBannedActive(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
    .some((word) => BANNED_WORDS.has(word));
}

/**
 * FR-STOCK-09 — a new active arrives with its resistance group, or not at all.
 *
 * "Any product without an IRAC or FRAC group on file cannot be selected for a
 * treatment", so an active without one is a row that could never be used and a
 * rotation the gate could never check.
 */
function guardActiveAdd(event) {
  const p = event.payload || {};
  const name = String(p.name || p.ai || '').trim();
  if (!name) return { ok: false, why: 'An active ingredient needs a name' };
  if (namesBannedActive(name)) {
    return { ok: false, why: `${name} is banned and cannot be added to the catalogue` };
  }
  const group = String(p.group || '').trim();
  if (!group || /^none$/i.test(group)) {
    return { ok: false, why: 'An active needs its IRAC or FRAC group, read off the label' };
  }
  return { ok: true };
}

/**
 * FR-STOCK-06 — a label hangs off actives that are already in the catalogue.
 * The group is never on the label record, so a new brand name cannot restart a
 * rotation by claiming a group of its own.
 */
function guardLabelAdd(event) {
  const p = event.payload || {};
  const brand = String(p.brand || '').trim();
  if (!brand) return { ok: false, why: 'A label needs the brand name on the container' };
  if (namesBannedActive(brand)) return { ok: false, why: `${brand} is a banned product` };
  if (!Array.isArray(p.activeIds) || !p.activeIds.length) {
    return { ok: false, why: 'A label must name at least one active ingredient from the catalogue' };
  }
  if (p.activeIds.some((id) => namesBannedActive(id))) {
    return { ok: false, why: 'That label names a banned active ingredient' };
  }
  if (p.group) return { ok: false, why: 'A label does not carry its own group — the group comes from the active' };
  return { ok: true };
}

/**
 * Naming what a store item is made of (FR-STOCK-05). The item's history — its
 * movements, its cost, the sprays that came out of it — is not touched, and a
 * banned active cannot be the answer.
 */
function guardInputUpsert(event) {
  const p = event.payload || {};
  if (p.activeId && namesBannedActive(p.activeId)) {
    return { ok: false, why: 'That is a banned active ingredient' };
  }
  if (namesBannedActive(p.name)) {
    return { ok: false, why: `${p.name} is banned and does not belong in this farm's store` };
  }
  return { ok: true };
}

/** Create the farm and its first account. Works exactly once per farm. */
async function bootstrap(farmId, body, store) {
  const existing = await store.getFarm(farmId);
  if (existing) return json({ error: 'That farm already exists. Ask the CEO for an invite.' }, 409);

  const name = String(body.name || '').trim();
  const password = String(body.password || '');
  if (!name) return json({ error: 'A name is needed' }, 400);
  if (password.length < 4) return json({ error: 'The password is too short' }, 400);

  const memberId = String(body.memberId || 'person_ceo');
  if (!safeId(memberId)) return json({ error: 'Bad member id' }, 400);

  const { salt, hash } = await hashSecret(password);
  const now = new Date().toISOString();
  await store.setFarm(farmId, {
    id: farmId, name: String(body.farmName || 'DouValue Farms Limited'), created: now,
  });
  const member = {
    id: memberId, name, role: 'ceo', status: 'active',
    passSalt: salt, passHash: hash, joinedAt: now, failedAttempts: 0, lockedUntil: 0,
  };
  await store.setMember(farmId, member);

  const token = randomHex(32);
  await store.setToken(await tokenDigest(token), {
    digest: await tokenDigest(token), farmId, memberId, device: String(body.device || 'unknown'),
    created: now, lastSeen: now,
  });
  return json({ ok: true, token, member: publicMember(member), farm: publicFarm(await store.getFarm(farmId)) });
}

// --- Sign-in names and passwords (UX-28) -----------------------------------
//
// The CEO, or a manager for the people below them, makes each account with a
// sign-in name and a password and sends both to that person. On a new phone
// those two are all it takes: the server finds the farm from the name and the
// role from the account, so the person lands on their own screens.
//
// The password is 6 to 12 digits. Digits because it is also what unlocks the
// phone each day on the keypad (UX-01, UX-02); at least six because unlike a
// PIN it works from any handset, and the lockout (NFR-SEC-02) has to make a
// million guesses impractical, not ten thousand.

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 12;
const isAccountPassword = (p) => new RegExp(`^\\d{${PASSWORD_MIN},${PASSWORD_MAX}}$`).test(String(p || ''));

/** A sign-in name as stored: lower case, no spaces, 3 to 32 letters, digits, dots, dashes. */
function normalizeLogin(raw) {
  const login = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  return /^[a-z0-9._-]{3,32}$/.test(login) ? login : '';
}

/** Give someone a sign-in name and password, or change their name, role or password. */
async function account(farmId, body, me, store) {
  if (!can(me.role, 'managePeople')) return json({ error: 'You cannot create accounts' }, 403);

  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  const login = normalizeLogin(body.login);
  const password = body.password == null ? '' : String(body.password);
  if (!name) return json({ error: 'A name is needed' }, 400);
  if (!login) return json({ error: 'A sign-in name is 3 to 32 letters or numbers, with no spaces' }, 400);
  if (!assignableRoles(me.role).includes(role)) {
    return json({ error: `A ${me.role} cannot appoint a ${role}` }, 403);
  }

  const memberId = String(body.memberId || `person_${randomHex(6)}`);
  if (!safeId(memberId)) return json({ error: 'Bad member id' }, 400);
  if (memberId === me.id) return json({ error: 'You cannot change your own account here' }, 400);

  const existing = await store.getMember(farmId, memberId);
  if (existing && !assignableRoles(me.role).includes(existing.role)) {
    return json({ error: `A ${me.role} cannot change a ${existing.role}'s account` }, 403);
  }
  if (existing && existing.role === 'ceo' && role !== 'ceo') {
    const owners = (await store.listMembers(farmId)).filter((m) => m.role === 'ceo' && m.status === 'active');
    if (owners.length <= 1) return json({ error: 'That is the only CEO account' }, 400);
  }

  // A password is needed to make an account; changing the rest of one keeps it.
  const keepsPassword = !password && existing && existing.login && existing.passHash;
  if (!keepsPassword && !isAccountPassword(password)) {
    return json({ error: `The password is ${PASSWORD_MIN} to ${PASSWORD_MAX} digits` }, 400);
  }

  const taken = await store.getLoginIndex(login);
  if (taken && !(taken.farmId === farmId && taken.memberId === memberId)) {
    return json({ error: `The sign-in name "${login}" is already taken. Add a number or a surname.` }, 409);
  }

  const now = new Date().toISOString();
  const secret = keepsPassword
    ? { passSalt: existing.passSalt, passHash: existing.passHash }
    : await hashSecret(password).then(({ salt, hash }) => ({ passSalt: salt, passHash: hash }));
  const member = {
    ...(existing || {}),
    id: memberId, name, role, status: 'active', login, ...secret,
    invitedBy: (existing && existing.invitedBy) || me.id,
    invitedAt: (existing && existing.invitedAt) || now,
    accountSetBy: me.id, accountSetAt: now,
    ...(keepsPassword ? {} : afterSuccess()),
  };
  delete member.invite;

  if (existing && existing.invite) await store.deleteInviteIndex(existing.invite.lookup);
  if (existing && existing.login && existing.login !== login) await store.deleteLoginIndex(existing.login);
  await store.setMember(farmId, member);
  await store.setLoginIndex(login, { farmId, memberId });

  // The password is never returned: the person who typed it already has it.
  return json({ ok: true, memberId, name, role, login, passwordChanged: !keepsPassword });
}

/** Sign in on a phone with a sign-in name and password; the account says the farm and the role. */
async function signIn(farmIdHint, body, store) {
  const login = normalizeLogin(body.login);
  const password = String(body.password || '');
  if (!login || !password) return json({ error: 'Enter your sign-in name and password' }, 400);
  // One answer for a name that does not exist and a password that is wrong,
  // so the sign-in page cannot be used to find out who works here.
  const wrong = () => json({ error: 'That sign-in name or password is not right' }, 403);

  const pointer = await store.getLoginIndex(login);
  if (!pointer || (farmIdHint && pointer.farmId !== farmIdHint)) return wrong();
  const farmId = pointer.farmId;
  const farm = await store.getFarm(farmId);
  const member = farm ? await store.getMember(farmId, pointer.memberId) : null;
  if (!member || member.login !== login || !member.passHash) return wrong();

  const now = Date.now();
  const lock = lockoutState(member, now);
  if (lock.locked) return json({ error: `Too many wrong tries. Wait ${Math.ceil(lock.seconds / 60)} minutes.` }, 429);

  if (!(await verifySecret(password, member.passSalt, member.passHash))) {
    await store.setMember(farmId, { ...member, ...afterFailure(member, now) });
    return wrong();
  }
  if (member.status !== 'active') {
    return json({ error: 'That account has been closed. Ask the CEO.' }, 403);
  }

  const at = new Date().toISOString();
  const signedIn = { ...member, ...afterSuccess(), lastSignInAt: at, joinedAt: member.joinedAt || at };
  await store.setMember(farmId, signedIn);

  const token = randomHex(32);
  const digest = await tokenDigest(token);
  await store.setToken(digest, {
    digest, farmId, memberId: member.id, device: String(body.device || 'unknown'), created: at, lastSeen: at,
  });
  return json({ ok: true, token, farmId, member: publicMember(signedIn), farm: publicFarm(farm) });
}

/** The CEO or a manager creates an account and gets a one-time code for it. */
async function invite(farmId, body, me, store) {
  if (!can(me.role, 'managePeople')) return json({ error: 'You cannot create accounts' }, 403);

  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  if (!name) return json({ error: 'A name is needed' }, 400);
  if (!assignableRoles(me.role).includes(role)) {
    return json({ error: `A ${me.role} cannot appoint a ${role}` }, 403);
  }

  const memberId = String(body.memberId || `person_${randomHex(6)}`);
  if (!safeId(memberId)) return json({ error: 'Bad member id' }, 400);

  const existing = await store.getMember(farmId, memberId);
  if (existing && existing.status === 'active') {
    return json({ error: 'That person already has an account' }, 409);
  }

  const code = randomCode(6);
  const password = randomCode(6);
  const { salt: passSalt, hash: passHash } = await hashSecret(password);
  const now = new Date().toISOString();
  const lookup = await codeDigest(farmId, code);

  // Any earlier unredeemed invite for this person is dropped, so re-inviting
  // someone invalidates the code they were sent before.
  if (existing && existing.invite) await store.deleteInviteIndex(existing.invite.lookup);

  await store.setMember(farmId, {
    id: memberId, name, role, status: 'invited',
    invite: { lookup, passSalt, passHash, expiresAt: Date.now() + INVITE_TTL_MS },
    invitedBy: me.id, invitedAt: now, failedAttempts: 0, lockedUntil: 0,
  });
  await store.setInviteIndex(lookup, { farmId, memberId });

  // The plain code and password are returned once and never stored.
  return json({ ok: true, memberId, name, role, joinCode: code, joinPassword: password,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() });
}

/** Redeem an invite: this enrols one device and sets that person's own PIN. */
async function join(farmId, body, store) {
  const farm = await store.getFarm(farmId);
  if (!farm) return json({ error: 'No such farm' }, 404);

  const code = String(body.joinCode || '').trim().toUpperCase();
  const password = String(body.joinPassword || '').trim().toUpperCase();
  const pin = String(body.pin || '');
  if (!code || !password) return json({ error: 'Enter the code and the password you were given' }, 400);
  if (!/^\d{4,12}$/.test(pin)) return json({ error: 'Choose a PIN of at least 4 digits' }, 400);

  const lookup = await codeDigest(farmId, code);
  const pointer = await store.getInviteIndex(lookup);
  const member = pointer && pointer.farmId === farmId
    ? await store.getMember(farmId, pointer.memberId) : null;

  if (!member || member.status !== 'invited' || !member.invite || member.invite.lookup !== lookup) {
    return json({ error: 'That code is not valid, or it has already been used' }, 403);
  }

  const now = Date.now();
  const lock = lockoutState(member, now);
  if (lock.locked) return json({ error: `Too many tries. Wait ${lock.seconds} seconds.` }, 429);

  if (member.invite.expiresAt < now) {
    return json({ error: 'That invite has expired. Ask for a new one.' }, 410);
  }
  if (!(await verifySecret(password, member.invite.passSalt, member.invite.passHash))) {
    await store.setMember(farmId, { ...member, ...afterFailure(member, now) });
    return json({ error: 'That password does not match the code' }, 403);
  }

  const { salt, hash } = await hashSecret(pin);
  const joined = {
    ...member, status: 'active', passSalt: salt, passHash: hash,
    joinedAt: new Date().toISOString(), ...afterSuccess(),
  };
  delete joined.invite;                                 // single use, gone once redeemed
  await store.setMember(farmId, joined);
  await store.deleteInviteIndex(lookup);

  const token = randomHex(32);
  const digest = await tokenDigest(token);
  await store.setToken(digest, {
    digest, farmId, memberId: member.id, device: String(body.device || 'unknown'),
    created: new Date().toISOString(), lastSeen: new Date().toISOString(),
  });
  return json({ ok: true, token, member: publicMember(joined), farm: publicFarm(farm) });
}

/** Re-issue a token on a device that is already enrolled, using the person's PIN. */
async function unlock(farmId, body, me, store, currentToken) {
  const pin = String(body.pin || '');
  const lock = lockoutState(me);
  if (lock.locked) return json({ error: `Too many tries. Wait ${lock.seconds} seconds.` }, 429);

  if (!(await verifySecret(pin, me.passSalt, me.passHash))) {
    await store.setMember(farmId, { ...me, ...afterFailure(me) });
    return json({ error: 'Wrong PIN' }, 403);
  }
  await store.setMember(farmId, { ...me, ...afterSuccess() });

  if (body.newPin) {
    if (!/^\d{4,12}$/.test(String(body.newPin))) return json({ error: 'A PIN must be at least 4 digits' }, 400);
    const { salt, hash } = await hashSecret(String(body.newPin));
    await store.setMember(farmId, { ...me, passSalt: salt, passHash: hash, ...afterSuccess() });
  }
  return json({ ok: true, member: publicMember(me), token: currentToken ? undefined : null });
}

/** Cut off a person, or just one lost handset. */
async function revoke(farmId, body, me, store) {
  const targetId = String(body.memberId || '');
  const target = await store.getMember(farmId, targetId);
  if (!target) return json({ error: 'No such person' }, 404);
  if (target.id === me.id) return json({ error: 'You cannot revoke your own access' }, 400);
  if (!can(me.role, 'managePeople')) return json({ error: 'You cannot change accounts' }, 403);
  if (!assignableRoles(me.role).includes(target.role)) {
    return json({ error: `A ${me.role} cannot revoke a ${target.role}` }, 403);
  }
  if (target.role === 'ceo') {
    const owners = (await store.listMembers(farmId)).filter((m) => m.role === 'ceo' && m.status === 'active');
    if (owners.length <= 1) return json({ error: 'That is the only CEO account' }, 400);
  }

  await store.deleteTokensFor(farmId, targetId);
  if (body.devicesOnly) return json({ ok: true, signedOutOfEveryDevice: true });

  await store.setMember(farmId, { ...target, status: 'revoked' });
  // Their sign-in name is freed for someone else; giving them a new password
  // later (UX-28) opens the account again.
  if (target.login) await store.deleteLoginIndex(target.login);
  return json({ ok: true, revoked: targetId });
}

async function readEvents(farmId, url, me, store) {
  const since = Math.max(0, Number(url.searchParams.get('since') || 0) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit') || 500) || 500));
  const page = await store.listEvents(farmId, since, limit);

  const visible = [];
  for (const event of page.events) {
    const shaped = visibleTo(event, me);
    if (shaped) visible.push(shaped);
  }
  return json({
    events: visible, cursor: page.cursor, more: page.more,
    total: await store.countEvents(farmId),
    // The cursor counts everything, so a role that sees less still advances.
    withheld: page.events.length - visible.length,
  });
}

async function writeEvents(farmId, body, me, store) {
  const incoming = Array.isArray(body.events) ? body.events : [];
  if (incoming.length > MAX_PUSH) return json({ error: 'Too many records in one push' }, 413);

  const allowed = [];
  // Each refusal says which record, what kind, why, and what to do: the phone
  // shows it to the person who made the record (it used to be dropped there
  // with a console warning, which is to say nobody was told).
  const refused = [];
  // Records the server could not judge yet — no rule book loaded. Not stored
  // and not refused: the phone keeps them and sends them again.
  const held = [];
  // §4.2 and the gates: read the log once, and only when a record needs it.
  let log = null;
  let facts = null;
  let members = null;
  let judging = null;
  let rules;
  const readLog = async () => (log ||= await storedEvents(farmId, store));
  const refuse = (event, why, extra = {}) => refused.push({ id: event.id, type: event.type, why, ...extra });

  for (const event of incoming) {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.type !== 'string') {
      refused.push({ id: event && event.id, why: 'Malformed record' });
      continue;
    }
    const verdict = mayWrite(event, me);
    if (!verdict.ok) { refuse(event, verdict.why); continue; }

    // Account records need the target's standing on the server, not the claim
    // in the record, so this check cannot be folded into the table above.
    const overPerson = await mayWritePerson(event, me, farmId, store);
    if (!overPerson.ok) { refuse(event, overPerson.why); continue; }
    // Likewise a confirmation, an approval or a spray (FR-ROLE-12/13): who
    // may do it depends on who raised and confirmed, and who is in.
    if (needsLog(event)) {
      if (!facts) {
        facts = await logFacts(farmId, store, await readLog());
        for (const earlier of allowed) foldFact(facts, earlier);
        members = await store.listMembers(farmId);
      }
      const fromLog = await mayWriteFromLog(event, me, facts, members);
      if (!fromLog.ok) { refuse(event, fromLog.why, { rule: 'FR-ROLE-12/13' }); continue; }
    }
    // Authorship is the server's to decide, never the client's claim.
    let stamped = { ...event, by: me.id, serverAt: new Date().toISOString() };

    // FR-GATE-01 to 05, FR-TREAT-02, FR-PROOF-01/02, FR-STOCK-04/07/08 and the
    // Week 10 rule, judged by the app's own code against the farm as this
    // server holds it (judge.mjs). A record already stored is a repeat send
    // and is skipped below, not judged twice.
    if (JUDGED.has(event.type)) {
      if (rules === undefined) rules = await serverRules();
      if (!rules) {
        held.push({ id: event.id, type: event.type,
          why: 'The farm server cannot read its rule book just now, so it cannot check this record yet. '
            + 'It stays on this phone and is sent again.' });
        continue;
      }
      if (!judging) {
        judging = judgingLog(await readLog());
        for (const earlier of allowed) judging.add(earlier);
      }
      if (!judging.has(event.id)) {
        const judged = judgeRecord(stamped, judging.state(), { rules });
        if (!judged.ok) { refuse(event, judged.why, { fix: judged.fix, rule: judged.rule }); continue; }
        if (judged.payload) stamped = { ...stamped, payload: judged.payload };
      }
    }

    allowed.push(stamped);
    if (facts) foldFact(facts, stamped);
    if (judging) judging.add(stamped);
  }

  const stored = await store.appendEvents(farmId, allowed);
  return json({
    accepted: stored.accepted, skipped: stored.skipped, refused, held,
    total: await store.countEvents(farmId), cursor: stored.cursor,
  });
}

// --- The rule book -----------------------------------------------------------
//
// rules/douvalue_rules_rev5_1.json, loaded — never copied (CLAUDE.md). The
// node server reads it off disk beside the repository; the Deno server reads
// it from beside its own file, from RULES_URL if one is set, or from the copy
// the farm's site publishes (scripts-build-deno.mjs adds those addresses).
// Until it has one, the records the gates judge are held, not waved through.

const RULES_RETRY_MS = 60_000;
const rulesPlaces = [];
let rulesTriedAt = 0;
let rulesRetryMs = RULES_RETRY_MS;
let rulesLoader = null;

/** Where else to look for the rules, in order. Runtimes call this at boot. */
function rulesFrom(...urls) {
  for (const url of urls) if (url && !rulesPlaces.includes(String(url))) rulesPlaces.push(String(url));
}

/** Tests replace the loader and the retry pause; nothing else should. */
function configureRules({ loader = rulesLoader, retryMs = rulesRetryMs } = {}) {
  rulesLoader = loader;
  rulesRetryMs = retryMs;
  rulesTriedAt = 0;
}

async function defaultRulesLoader() {
  try { return await loadRules(); } catch { /* not on disk beside this server */ }
  for (const url of rulesPlaces) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* the next address */ }
  }
  return null;
}

/** The rules, loading them if they are not loaded yet; null if they cannot be had. */
async function serverRules() {
  if (rulesLoaded()) return peekRules();
  const now = Date.now();
  if (rulesTriedAt && now - rulesTriedAt < rulesRetryMs) return null;
  rulesTriedAt = now;
  try {
    const doc = await (rulesLoader || defaultRulesLoader)();
    if (doc) return rulesLoaded() ? peekRules() : setRules(doc);
  } catch { /* a rule book that does not parse is no rule book */ }
  return null;
}

// --- The wider adviser ----------------------------------------------------
//
// The app already has an adviser of its own that works with the network off.
// This adds the part that offline reasoning cannot do: read what is true this
// week rather than what was true when the app was written — an advisory on a
// pest moving through the region, a product deregistered, what pepper is
// actually fetching now.
//
// Three things make this safe to expose:
//
//   1. The key never leaves the server. It is set once on the deployment by the
//      CEO and no phone ever holds it, so a lost handset cannot spend money.
//   2. The server redacts before it sends. Whatever the app puts in the brief,
//      a role without manageMoney gets the money stripped here, because the app
//      making that decision correctly is a convenience, not a guarantee.
//   3. Every account has a daily cap. A token in the wrong hands can run up a
//      bill; this bounds it and the bound is per person, not per farm, so one
//      person cannot spend everyone else's share.

const ADVICE_PER_DAY = 25;
// Long enough for a few web searches and a considered answer; short enough that
// a phone on a weak signal gives up rather than hanging with a spinner.
const ADVICE_TIMEOUT_MS = 90_000;
const ADVICE_MODEL = 'claude-opus-5';

const ADVISER_BRIEF = `You are the farm adviser for a commercial pepper farm in Port Harcourt,
Rivers State, Nigeria. It grows bell pepper (tatashe), chili (shombo) and habanero (ata rodo)
in open field.

You are given that farm's own records as JSON. Your job is to add what the records cannot
contain: current outside knowledge. Search the web for anything time-sensitive that changes the
answer — pest and disease advisories for southern Nigeria, prices in Nigerian markets, product
registration and ban changes, weather beyond the forecast supplied.

Rules, in order of importance:

1. Never invent a number. If you looked it up, say where from and when it was published. If you
   could not find it, say you could not find it. A made-up price does more harm here than silence.
2. Safety outranks everything. Pre-harvest and re-entry intervals are not advice, and no
   commercial pressure moves them.
3. Be specific to what is in the records. "Monitor your crop" is worthless. "Bed 3 is 40kg behind
   and its pH is 4.9" is worth reading.
4. Every recommendation needs: what you saw in the records, what it costs to ignore, what to do
   this week, and who says so.
5. Write for a farm manager in Nigeria, not for an agronomy journal. Short sentences. Naira, kg,
   hectares and millimetres. No jargon you do not immediately explain.
6. Do not repeat what the built-in adviser already said unless you are correcting it or adding
   outside evidence to it. You are told what it said.

Answer in plain prose with short headed sections. No preamble about being an AI.`;

/** Today's date in the farm's own timezone, which is what a daily cap should turn over on. */
const farmDay = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);  // WAT, UTC+1

/**
 * Live weather from Open-Meteo. Free, no key, no account — which is why it is
 * the one outside source the adviser can always reach.
 */
async function liveWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=4.82&longitude=7.04'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean'
    + '&past_days=14&forecast_days=7&timezone=Africa%2FLagos';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()).daily;
    if (!d || !Array.isArray(d.time)) return null;
    return d.time.map((t, i) => ({
      date: t,
      tmax: d.temperature_2m_max[i],
      tmin: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i],
      rh: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
    }));
  } catch {
    return null;
  }
}

/** Strip anything the reader's role is not entitled to, whatever the client sent. */
function redactBrief(brief, role) {
  if (can(role, 'manageMoney')) return brief;
  const { economics, ...rest } = brief || {};
  if (rest.farm && rest.farm.askedBy) rest.farm.askedBy = { ...rest.farm.askedBy, seesMoney: false };
  return rest;
}

/** Deno and Node keep environment variables in different places, and neither exists in the other. */
function envVar(name) {
  try {
    if (typeof Deno !== 'undefined' && Deno.env) return Deno.env.get(name) || '';
  } catch { /* not Deno */ }
  try {
    if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  } catch { /* not Node */ }
  return '';
}

// --- The Owner's WhatsApp — FR-REP-02 ----------------------------------------
//
// The digest and the straight-to-Owner items go to the Owner by WhatsApp,
// text first. The server holds no farm model, so the phones work out what to
// say (web/js/domain/notify.js) and hand it over with a key; the server sends
// each key once, whichever phone offers it first, so every phone can safely
// offer everything it has seen. The WhatsApp key lives here and nowhere else.
//
// Set on the server (Deno Deploy → Settings → Environment Variables):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID   WhatsApp Cloud API credentials
//   OWNER_WHATSAPP                             the Owner's number(s), e.g. 2348030000000
//   WHATSAPP_TEMPLATE, WHATSAPP_TEMPLATE_LANG  optional: an approved template with one
//                                              body variable, used only when WhatsApp's
//                                              24-hour rule refuses a plain text

const NOTIFY_MAX_ITEMS = 20;
const NOTIFY_MAX_CHARS = 4096;           // WhatsApp's own ceiling on a text body
const NOTIFY_PER_DAY = 60;               // a bound on what one farm can send in a day
const NOTIFY_KEEP = 200;                 // sent keys remembered, newest kept
const NOTIFY_TIMEOUT_MS = 15000;
const NOTIFY_KEY = /^(now|digest):[A-Za-z0-9_:.-]{1,120}$/;
// WhatsApp's codes for "outside the 24-hour window: use a template".
const WA_OUTSIDE_WINDOW = new Set([131047, 470]);

/** What is set up. Nothing here ever leaves the server. */
function whatsappChannel(env = envVar) {
  const to = String(env('OWNER_WHATSAPP') || '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean);
  const wa = {
    token: env('WHATSAPP_TOKEN'), phoneId: env('WHATSAPP_PHONE_NUMBER_ID'), to,
    template: env('WHATSAPP_TEMPLATE'), lang: env('WHATSAPP_TEMPLATE_LANG') || 'en',
    version: env('WHATSAPP_API_VERSION') || 'v22.0',
  };
  return wa.token && wa.phoneId && wa.to.length ? wa : null;
}

/** A template variable may not hold line breaks or long runs of spaces. */
function templateParameter(text) {
  const flat = String(text).replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();
  return flat.length <= 900 ? flat : `${flat.slice(0, 890).trimEnd()} …`;
}

async function sendWhatsApp(wa, to, text, fetchFn) {
  const post = (message) => fetchFn(`https://graph.facebook.com/${wa.version}/${wa.phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wa.token}` },
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
  });
  const errorOf = async (res) => { try { return ((await res.json()) || {}).error || {}; } catch { return {}; } };

  // Text first: the whole message, line breaks and all.
  const res = await post({ type: 'text', text: { body: text, preview_url: false } });
  if (res.ok) return { ok: true, via: 'text' };
  const error = await errorOf(res);
  if (!WA_OUTSIDE_WINDOW.has(Number(error.code)) || !wa.template) {
    return { ok: false, why: `WhatsApp refused it: ${error.message || res.status}` };
  }
  const again = await post({
    type: 'template',
    template: { name: wa.template, language: { code: wa.lang },
      components: [{ type: 'body', parameters: [{ type: 'text', text: templateParameter(text) }] }] },
  });
  if (again.ok) return { ok: true, via: 'template' };
  const second = await errorOf(again);
  return { ok: false, why: `WhatsApp refused the template: ${second.message || again.status}` };
}

/** Whether WhatsApp is set up, and the last few keys that went. */
async function notifyStatus(farmId, store, { env = envVar } = {}) {
  const farm = (await store.getFarm(farmId)) || {};
  const sent = Object.entries(farm.notified || {})
    .sort((a, b) => ((a[1].at || '') < (b[1].at || '') ? 1 : -1)).slice(0, 10)
    .map(([key, rec]) => ({ key, at: rec.at }));
  return { ok: true, configured: { whatsapp: !!whatsappChannel(env) }, sent };
}

/**
 * Send what a phone offered: `{ items: [{ key, kind, text }] }`. Anyone on the
 * farm may raise a straight-to-Owner item; the digest comes from a role that
 * runs the work. Each key goes once to each number.
 */
async function notifyOwner(farmId, body, me, store, {
  env = envVar, fetchFn = fetch, now = new Date().toISOString(),
} = {}) {
  const wa = whatsappChannel(env);
  const items = Array.isArray(body && body.items) ? body.items.slice(0, NOTIFY_MAX_ITEMS) : [];
  const configured = { whatsapp: !!wa };
  if (!wa) {
    return { ok: false, reason: 'not-configured', configured,
      message: 'WhatsApp to the Owner is not set up on the farm server yet. Until it is, copy the digest '
        + 'into WhatsApp from the Alerts screen.',
      results: items.map((i) => ({ key: i && i.key, status: 'not-configured' })) };
  }

  const farm = (await store.getFarm(farmId)) || {};
  const notified = { ...(farm.notified || {}) };
  const day = farmDay();
  let budget = farm.notifyDay && farm.notifyDay.day === day ? farm.notifyDay.count : 0;
  const results = [];

  for (const item of items) {
    const key = String((item && item.key) || '');
    const kind = item && item.kind;
    // Plain text and nothing else: no control characters but the line break.
    const text = String((item && item.text) || '').replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
    const expected = key.startsWith('digest:') ? 'digest' : 'immediate';
    if (!NOTIFY_KEY.test(key) || kind !== expected) {
      results.push({ key, status: 'refused', why: 'Not a message this server sends' });
      continue;
    }
    if (!text || text.length > NOTIFY_MAX_CHARS) {
      results.push({ key, status: 'refused', why: 'A message is text, up to 4096 characters' });
      continue;
    }
    if (kind === 'digest' && !can(me.role, 'assignTasks')) {
      results.push({ key, status: 'refused', why: 'The digest comes from a phone that runs the work' });
      continue;
    }
    const rec = notified[key] || { at: null, done: {} };
    const owed = wa.to.filter((to) => !rec.done[to]);
    if (!owed.length) { results.push({ key, status: 'already-sent' }); continue; }
    if (budget >= NOTIFY_PER_DAY) {
      results.push({ key, status: 'failed', why: `That is ${NOTIFY_PER_DAY} messages today; the rest wait for tomorrow` });
      continue;
    }
    const failures = [];
    const via = [];
    for (const to of owed) {
      let sent;
      try { sent = await sendWhatsApp(wa, to, text, fetchFn); }
      catch (err) { sent = { ok: false, why: `Could not reach WhatsApp: ${err.message || err}` }; }
      if (sent.ok) { rec.done[to] = now; via.push(sent.via); } else failures.push(sent.why);
    }
    if (via.length) { rec.at = now; budget++; }
    notified[key] = rec;
    results.push(failures.length
      ? { key, status: via.length ? 'partly-sent' : 'failed', via, why: failures.join('; ') }
      : { key, status: 'sent', via });
  }

  const kept = Object.entries(notified)
    .sort((a, b) => ((a[1].at || '') < (b[1].at || '') ? 1 : -1)).slice(0, NOTIFY_KEEP);
  await store.setFarm(farmId, { ...farm, notified: Object.fromEntries(kept), notifyDay: { day, count: budget } });
  return { ok: true, configured, results };
}

/** Count one use against this person's day, and refuse once they are over. */
async function spendAdviceBudget(farmId, me, store) {
  const today = farmDay();
  const used = me.adviceUsed && me.adviceUsed.day === today ? me.adviceUsed.count : 0;
  if (used >= ADVICE_PER_DAY) return { ok: false, used };
  await store.setMember(farmId, { ...me, adviceUsed: { day: today, count: used + 1 } });
  return { ok: true, used: used + 1, left: ADVICE_PER_DAY - used - 1 };
}

async function advise(farmId, body, me, store) {
  const key = envVar('ANTHROPIC_API_KEY');
  const weather = await liveWeather();

  if (!key) {
    // Not an error: the farm simply has not turned this on. The app keeps its
    // own adviser either way, and the live weather is still worth returning.
    return json({
      ok: false,
      reason: 'no-key',
      weather,
      message: 'The wider adviser is not switched on for this farm. The CEO turns it on by '
        + 'setting ANTHROPIC_API_KEY on the farm server, in the Deno dashboard under Settings, '
        + 'Environment Variables. Until then the app advises from its own knowledge.',
    });
  }

  const budget = await spendAdviceBudget(farmId, me, store);
  if (!budget.ok) {
    return json({
      ok: false, reason: 'daily-limit', weather,
      message: `That is ${ADVICE_PER_DAY} questions today on this account. It resets at midnight.`,
    }, 429);
  }

  const brief = redactBrief(body.brief, me.role);
  const question = String(body.question || '').slice(0, 2000).trim();
  const alreadySaid = Array.isArray(body.alreadySaid)
    ? body.alreadySaid.slice(0, 20).map((t) => String(t).slice(0, 200))
    : [];

  const prompt = [
    'THE FARM\'S OWN RECORDS:',
    JSON.stringify(brief),
    '',
    weather ? `LIVE WEATHER (Open-Meteo, 14 days back and 7 forward):\n${JSON.stringify(weather)}` : '',
    '',
    alreadySaid.length
      ? `THE BUILT-IN ADVISER HAS ALREADY SAID:\n- ${alreadySaid.join('\n- ')}`
      : '',
    '',
    question
      ? `THE QUESTION, from the farm's ${me.role}:\n${question}`
      : `No specific question. Give this farm's ${me.role} the most useful reading of these `
        + 'records you can, with whatever current outside information changes the answer.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(ADVICE_TIMEOUT_MS),
      body: JSON.stringify({
        // Overridable, because the farm is the one paying for each question and
        // a cheaper model is a legitimate choice for a farm making many of them.
        model: envVar('ANTHROPIC_MODEL') || ADVICE_MODEL,
        // Thinking is on by default and is billed against this, so the ceiling
        // has to leave room for it or a good answer gets cut off mid-sentence.
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: ADVISER_BRIEF,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({
        ok: false, reason: 'upstream', weather,
        message: res.status === 401
          ? 'The farm server\'s ANTHROPIC_API_KEY was refused. Check it in the Deno dashboard.'
          : 'The wider adviser could not be reached just now. The app\'s own advice still stands.',
        detail: detail.slice(0, 300),
      }, 502);
    }

    const answer = await res.json();
    if (answer.stop_reason === 'refusal') {
      return json({
        ok: false, reason: 'declined', weather,
        message: 'The wider adviser would not answer that one. Ask it about the farm.',
      });
    }
    const text = (answer.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    // Citations are URLs the model produced after reading pages nobody here
    // controls. The app checks them again before it makes a link of one, but
    // the server should not hand out an address it would not follow itself.
    const sources = [];
    for (const block of answer.content || []) {
      for (const c of block.citations || []) {
        if (!c.url || !/^https?:\/\//i.test(String(c.url))) continue;
        if (sources.some((s) => s.url === c.url)) continue;
        sources.push({ url: String(c.url), title: String(c.title || c.url).slice(0, 200) });
      }
    }

    return json({
      ok: true,
      text,
      sources,
      weather,
      askedAt: new Date().toISOString(),
      questionsLeftToday: budget.left,
    });
  } catch (err) {
    return json({
      ok: false, reason: 'timeout', weather,
      message: 'The wider adviser took too long to answer. Try again when the signal is better.',
      detail: String(err && err.message || err).slice(0, 200),
    }, 504);
  }
}

// --- The Farm Doctor's photo review (FR-DOC-03) ----------------------------
//
// The one thing the offline app cannot do: look at a picture. Everything else
// the Farm Doctor does — guided diagnosis, the calculators, the plan and gate
// checks — runs on the phone with no signal, and this is added to that rather
// than depended on by it.
//
// The limits in FR-DOC-08 are stated in the prompt AND applied again by the
// app when the answer lands (normalisePhotoReview in web/js/domain/doctor.js).
// Asking a model to be careful is not a control. The app rebuilding the answer
// from fields it decides the meaning of is.

const PHOTO_MAX = 4;
const PHOTO_TIMEOUT_MS = 60_000;

const PHOTO_BRIEF = `You are the Farm Doctor for a pepper farm in Port Harcourt, Nigeria. You are
looking at photos taken in a greenhouse or open field, with a phone, in bad light, by a farm hand.

You take the place of a visiting agronomist for day-to-day decisions. You advise; people decide.

Hard limits, which the app enforces again after you answer:
1. You never call a virus or a bacterial disease confirmed from a photo. You may say it is
   suspected, and then the sample goes to a lab.
2. You never name a product. The app chooses products from the farm's own catalogue and store.
3. You state a confidence of exactly "high", "medium" or "low", and you are honest about it. Low
   is the right answer for a blurred photo of a leaf with no context.

Answer with JSON only, no prose around it:
{"confidence":"high|medium|low",
 "candidates":[{"problemId":"<id from the shortlist if it fits>","name":"...","confidence":"...","why":"what in the photo"}],
 "whatYouSee":"one or two plain sentences",
 "nextCheck":"the single test that would settle it in the field"}`;

function imageBlocks(photos) {
  const out = [];
  for (const photo of photos.slice(0, PHOTO_MAX)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(photo || ''));
    if (!m) continue;
    if (m[2].length > 2_000_000) continue;              // a photo nobody compressed
    out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  return out;
}

/** Pull the JSON object out of an answer, without trusting it to be the whole reply. */
function firstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function photoReview(farmId, body, me, store) {
  const key = envVar('ANTHROPIC_API_KEY');
  if (!key) {
    return json({
      ok: false, reason: 'no-key',
      message: 'Photo review is not switched on for this farm. The guided diagnosis, the '
        + 'calculators and the plan checks all still work without it.',
    });
  }

  const images = imageBlocks(Array.isArray(body.photos) ? body.photos : []);
  if (!images.length) {
    return json({ ok: false, reason: 'no-photos', message: 'No usable photos came through.' }, 400);
  }

  const budget = await spendAdviceBudget(farmId, me, store);
  if (!budget.ok) {
    return json({
      ok: false, reason: 'daily-limit',
      message: `That is ${ADVICE_PER_DAY} questions today on this account. It resets at midnight.`,
    }, 429);
  }

  const shortlist = Array.isArray(body.shortlist) ? body.shortlist.slice(0, 12) : [];
  const context = [
    body.zoneId ? `Zone: ${String(body.zoneId).slice(0, 40)}` : '',
    body.date ? `Date: ${String(body.date).slice(0, 10)}` : '',
    body.note ? `What the person wrote: ${String(body.note).slice(0, 600)}` : '',
    Array.isArray(body.symptoms) && body.symptoms.length
      ? `Ticked in the guided flow: ${body.symptoms.map((x) => String(x).slice(0, 40)).join(', ')}`
      : '',
    shortlist.length
      ? `The app's own shortlist (use these ids where one fits): ${shortlist.map((p) => `${p.id} (${p.name})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
      body: JSON.stringify({
        model: envVar('ANTHROPIC_MODEL') || ADVICE_MODEL,
        max_tokens: 4000,
        system: PHOTO_BRIEF,
        messages: [{
          role: 'user',
          content: [...images, { type: 'text', text: context || 'No extra context was given.' }],
        }],
      }),
    });

    if (!res.ok) {
      return json({
        ok: false, reason: 'upstream',
        message: res.status === 401
          ? 'The farm server\'s ANTHROPIC_API_KEY was refused. Check it in the Deno dashboard.'
          : 'Photo review could not be reached. Use the guided diagnosis; it needs no signal.',
      }, 502);
    }

    const answer = await res.json();
    if (answer.stop_reason === 'refusal') {
      return json({ ok: false, reason: 'declined', message: 'Photo review would not answer that one.' });
    }
    const text = (answer.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const parsed = firstJsonObject(text) || {};

    // Deliberately thin: the app applies FR-DOC-08 to whatever comes back, so
    // the server's job is to pass it on honestly rather than to interpret it.
    return json({
      ok: true,
      review: {
        confidence: parsed.confidence || 'low',
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5) : [],
        text: String(parsed.whatYouSee || text || '').slice(0, 2000),
        nextCheck: String(parsed.nextCheck || '').slice(0, 500),
        photoCount: images.length,
      },
      askedAt: new Date().toISOString(),
      questionsLeftToday: budget.left,
    });
  } catch (err) {
    return json({
      ok: false, reason: 'timeout',
      message: 'Photo review took too long. The guided diagnosis works with no signal at all.',
      detail: String((err && err.message) || err).slice(0, 200),
    }, 504);
  }
}


// --- Storage on Deno KV ----------------------------------------------------

const kv = await Deno.openKv();

const store = {
  async getFarm(farmId) { return (await kv.get(["farm", farmId, "meta"])).value; },
  async setFarm(farmId, farm) { await kv.set(["farm", farmId, "meta"], farm); },

  async getMember(farmId, memberId) { return (await kv.get(["farm", farmId, "member", memberId])).value; },
  async listMembers(farmId) {
    const out = [];
    for await (const e of kv.list({ prefix: ["farm", farmId, "member"] })) out.push(e.value);
    return out;
  },
  async setMember(farmId, member) { await kv.set(["farm", farmId, "member", member.id], member); },

  async getInviteIndex(lookup) { return (await kv.get(["invite", lookup])).value; },
  async setInviteIndex(lookup, rec) { await kv.set(["invite", lookup], rec); },
  async deleteInviteIndex(lookup) { await kv.delete(["invite", lookup]); },

  async getLoginIndex(login) { return (await kv.get(["login", login])).value; },
  async setLoginIndex(login, rec) { await kv.set(["login", login], rec); },
  async deleteLoginIndex(login) { await kv.delete(["login", login]); },

  async getToken(digest) { return (await kv.get(["token", digest])).value; },
  async setToken(digest, rec) { await kv.set(["token", digest], rec); },
  async touchToken(digest, at) {
    const cur = (await kv.get(["token", digest])).value;
    if (cur) await kv.set(["token", digest], { ...cur, lastSeen: at });
  },
  async deleteTokensFor(farmId, memberId) {
    for await (const e of kv.list({ prefix: ["token"] })) {
      const rec = e.value;
      if (rec && rec.farmId === farmId && rec.memberId === memberId) await kv.delete(e.key);
    }
  },

  async appendEvents(farmId, events) {
    const countKey = ["farm", farmId, "count"];
    let accepted = 0, skipped = 0;
    for (const event of events) {
      let placed = false;
      for (let attempt = 0; attempt < 5 && !placed; attempt++) {
        const current = await kv.get(countKey);
        const seq = (current.value || 0) + 1;
        const result = await kv.atomic()
          .check({ key: ["farm", farmId, "ev", event.id], versionstamp: null })
          .check({ key: countKey, versionstamp: current.versionstamp })
          .set(["farm", farmId, "ev", event.id], seq)
          .set(["farm", farmId, "seq", seq], event)
          .set(countKey, seq)
          .commit();
        if (result.ok) { accepted++; placed = true; break; }
        if ((await kv.get(["farm", farmId, "ev", event.id])).value !== null) { skipped++; placed = true; }
      }
      if (!placed) skipped++;
    }
    return { accepted, skipped, cursor: (await kv.get(countKey)).value || 0 };
  },

  async listEvents(farmId, since, limit) {
    const out = [];
    let cursor = since;
    const iter = kv.list({
      start: ["farm", farmId, "seq", since + 1],
      end: ["farm", farmId, "seq", Number.MAX_SAFE_INTEGER],
    }, { limit });
    for await (const entry of iter) { out.push(entry.value); cursor = Number(entry.key[3]); }
    return { events: out, cursor, more: out.length === limit };
  },

  async countEvents(farmId) { return (await kv.get(["farm", farmId, "count"])).value || 0; },
};

// --- The rule book ----------------------------------------------------------
// Beside this file on a repository deploy, beside it again when imported from
// the farm's site (server/deno-entry.js sits next to rules/), then RULES_URL,
// then the published copy. Loaded now so the first push does not wait for it.
let rulesUrl = null;
try { rulesUrl = Deno.env.get("RULES_URL") || null; } catch { /* no env access */ }
rulesFrom(rulesUrl, new URL("../rules/douvalue_rules_rev5_1.json", import.meta.url).href, "https://samebimo10-cpu.github.io/DouValue-Farms/rules/douvalue_rules_rev5_1.json");
await serverRules();

Deno.serve((req) => handleRequest(req, store));
