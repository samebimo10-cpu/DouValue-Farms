// A record is "saved" only when it will still be there after the app closes
// — UX-20, NFR-OFF-01, and the brief's "never fake success".
//
// db.js falls back to localStorage when IndexedDB refuses a write (a full
// phone, a browser hiccup). It used to ignore whether that worked as well, so
// the screen showed a tick for a record kept only in memory; and records that
// did land in localStorage were never read again once IndexedDB recovered, so
// they were neither shown nor synced. These run db.js and the store against a
// small IndexedDB and localStorage that can be made to refuse writes.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Just enough IndexedDB for db.js: one database, keyPath stores, readwrite transactions that can fail. */
function fakeIndexedDB() {
  const stores = new Map();
  const ctl = { failWrites: false };
  const storeApi = (name, staged, requests) => ({
    put(value, key) {
      const s = stores.get(name);
      staged.get(name).set(s.keyPath ? value[s.keyPath] : key, structuredClone(value));
    },
    get(key) {
      const req = {};
      requests.push(() => { req.result = staged.get(name).get(key); if (req.onsuccess) req.onsuccess(); });
      return req;
    },
    getAll() {
      const req = {};
      requests.push(() => { req.result = [...staged.get(name).values()]; if (req.onsuccess) req.onsuccess(); });
      return req;
    },
    clear() { staged.get(name).clear(); },
  });
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore(name, opts = {}) {
      stores.set(name, { keyPath: opts.keyPath || null, rows: new Map() });
      return { createIndex() {}, indexNames: { contains: () => true } };
    },
    transaction(name, mode = 'readonly') {
      const staged = new Map([...stores].map(([n, s]) => [n, new Map(s.rows)]));
      const requests = [];
      const tx = { objectStore: (n) => storeApi(n, staged, requests) };
      setTimeout(() => {
        while (requests.length) requests.shift()();
        if (mode === 'readwrite' && ctl.failWrites) {
          tx.error = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          if (tx.onabort) tx.onabort(); else if (tx.onerror) tx.onerror();
          return;
        }
        for (const [n, rows] of staged) stores.get(n).rows = rows;
        if (tx.oncomplete) tx.oncomplete();
      }, 0);
      return tx;
    },
  };
  return {
    ctl,
    rows: (name) => [...(stores.get(name)?.rows.values() || [])],
    open() {
      const req = {};
      setTimeout(() => {
        req.result = db;
        req.transaction = { objectStore: () => ({ indexNames: { contains: () => false }, createIndex() {} }) };
        if (!stores.size && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

/** localStorage with a size limit, like a phone's. */
function fakeLocalStorage() {
  const data = new Map();
  const ctl = { full: false };
  return {
    ctl,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (ctl.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
}

const idb = fakeIndexedDB();
const ls = fakeLocalStorage();
globalThis.indexedDB = idb;
globalThis.localStorage = ls;

const db = await import('../web/js/db.js');
const { createStore } = await import('../web/js/store.js');

const ev = (id) => ({ id, type: 'work.log', at: new Date().toISOString(), by: 'p1', payload: { id, hours: 2 } });

beforeEach(() => {
  idb.ctl.failWrites = false;
  ls.ctl.full = false;
  ls.removeItem('douvalue.events');
});

test('a normal save goes into IndexedDB', async () => {
  await db.appendEvents([ev('ok_1')]);
  assert.ok(idb.rows('events').some((e) => e.id === 'ok_1'));
});

test('IndexedDB refuses and localStorage is full: the save fails, it does not pretend', async () => {
  idb.ctl.failWrites = true;
  ls.ctl.full = true;
  await assert.rejects(db.appendEvents([ev('lost_1')]), (err) => {
    assert.equal(err.name, 'NotSavedError');
    assert.match(err.message, /Not saved/);
    assert.match(err.message, /Free some space/, 'it says what to do next (UX-20)');
    return true;
  });
  idb.ctl.failWrites = false;
  ls.ctl.full = false;
  const all = await db.loadEvents();
  assert.ok(!all.some((e) => e.id === 'lost_1'), 'and nothing half-saved is shown later as if it were');
});

test('the store does not show a record it could not save, and tells the screen', async () => {
  const store = await createStore();
  const before = store.state.log.length;
  idb.ctl.failWrites = true;
  ls.ctl.full = true;
  await assert.rejects(store.dispatch('work.log', { id: 'w_fail', hours: 3 }), { name: 'NotSavedError' });
  assert.equal(store.state.log.length, before, 'no record appears on screen that is not on the phone');
  await assert.rejects(store.dispatchMany([{ type: 'work.log', payload: { id: 'w_fail2', hours: 1 } }]),
    { name: 'NotSavedError' });
  assert.equal(store.state.log.length, before);
});

test('a record IndexedDB refused but localStorage kept is moved back, shown and sent', async () => {
  idb.ctl.failWrites = true;
  await db.appendEvents([ev('rescued_1')]);          // resolves: localStorage holds it
  assert.ok(!idb.rows('events').some((e) => e.id === 'rescued_1'));
  idb.ctl.failWrites = false;

  const all = await db.loadEvents();
  assert.ok(all.some((e) => e.id === 'rescued_1'), 'it is shown');
  assert.ok(idb.rows('events').some((e) => e.id === 'rescued_1'), 'it is now in IndexedDB');
  assert.equal(ls.getItem('douvalue.events'), null, 'and the rescue copy is cleared once it is safe');
  assert.ok((await db.unsyncedEvents()).some((e) => e.id === 'rescued_1'), 'it is queued for the farm server');
  assert.equal((await db.loadEvents()).filter((e) => e.id === 'rescued_1').length, 1, 'once, not twice');
});

test('while IndexedDB still refuses, rescued records stay in localStorage and are still shown', async () => {
  idb.ctl.failWrites = true;
  await db.appendEvents([ev('waiting_1')]);
  const all = await db.loadEvents();
  assert.ok(all.some((e) => e.id === 'waiting_1'));
  assert.ok(ls.getItem('douvalue.events').includes('waiting_1'), 'not cleared until it is safe elsewhere');
  idb.ctl.failWrites = false;
  await db.loadEvents();
  assert.equal(ls.getItem('douvalue.events'), null);
});
