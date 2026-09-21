// "New version — tap to update" — NFR-OFF-05.
//
// The requirement has two halves and the second one is the one with teeth: a
// new version reaches phones without staff clearing data, AND the app shows
// "New version — tap to update".
//
// The easy way to satisfy the first half is skipWaiting() in the service
// worker's install handler, which is what this app used to do. It is also the
// bug: the page reloads under a hand who is halfway through a scouting note, in
// a greenhouse, for no reason they can see. So the first test here reads the
// service worker source and asserts that skipWaiting is no longer reachable
// from install at all — a test about a file rather than a function, because
// that is where this particular mistake lives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const {
  applyUpdate, mountUpdatePrompt, pollForUpdate, updateBanner, UPDATE_PROMPT, watchForUpdate,
} = await import(new URL('ui/update.js', base).href);

const swSource = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');

// --- The service worker no longer takes over on its own --------------------

test('install caches the shell and then stops', () => {
  const install = swSource.slice(swSource.indexOf("addEventListener('install'"),
    swSource.indexOf("addEventListener('message'"));
  assert.match(install, /cache\.addAll\(SHELL\)/, 'it still caches everything for offline use');
  assert.ok(!install.includes('skipWaiting'),
    'a new version must not take over while somebody is typing');
});

test('the only way to take over is the message the tap sends', () => {
  assert.match(swSource, /addEventListener\('message'/);
  assert.match(swSource, /event\.data\.type === 'SKIP_WAITING'/);
  // Exactly one call in the file, and it is inside that handler.
  assert.equal((swSource.match(/self\.skipWaiting\(\)/g) || []).length, 1);
  const handler = swSource.slice(swSource.indexOf("addEventListener('message'"));
  assert.match(handler, /SKIP_WAITING[\s\S]*self\.skipWaiting\(\)/);
});

test('every screen the app can reach is in the offline cache', () => {
  // NFR-OFF-01: a field screen that was never cached is a field screen that
  // does not open in a greenhouse.
  for (const file of ['./js/ui/shift.js', './js/ui/kpis.js', './js/ui/chart.js',
    './js/ui/scan.js', './js/ui/update.js', './js/domain/qr.js', './js/domain/shift.js',
    './js/domain/stock.js', './js/domain/supervision.js']) {
    assert.ok(swSource.includes(`'${file}'`), `${file} is missing from the cache list`);
  }
});

test('the cache name was bumped, so an old shell is discarded rather than mixed', () => {
  // Pinned to a number this test would have to be edited for, rather than to
  // one particular number: every branch that adds a file to the shell bumps
  // this, and a test that has to be edited on each bump is a test people learn
  // to edit without reading.
  const version = /const CACHE = 'douvalue-v(\d+)'/.exec(swSource);
  assert.ok(version, 'the shell cache is named and versioned');
  assert.ok(Number(version[1]) >= 12, `v${version[1]} is older than the version this test was written against`);
});

// --- The prompt ------------------------------------------------------------

test('the bar says exactly what the requirement says', () => {
  assert.equal(UPDATE_PROMPT, 'New version — tap to update');
  const html = updateBanner();
  assert.match(html, /New version — tap to update/);
  assert.match(html, /data-act="apply-update"/);
  assert.match(html, /data-act="dismiss-update"/, 'and a way to say "not now"');
  assert.match(html, /role="status"/);
});

// --- Noticing a waiting version -------------------------------------------

function fakeRegistration({ waiting = null } = {}) {
  const listeners = new Map();
  return {
    waiting,
    installing: null,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn));
    },
    fire: (type) => { for (const fn of listeners.get(type) || []) fn(); },
    update: () => { fakeRegistration.updates++; },
  };
}

function fakeWorker() {
  const listeners = new Map();
  return {
    state: 'installing',
    messages: [],
    postMessage: () => {},
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    fire: (type) => { for (const fn of listeners.get(type) || []) fn(); },
  };
}

test('a version that finished downloading while the phone was in a pocket is noticed', () => {
  // The common case: the download completed, the worker is already waiting when
  // the app next opens, and no updatefound event will ever fire again.
  const waiting = { id: 'waiting' };
  let told = null;
  watchForUpdate(fakeRegistration({ waiting }), (worker) => { told = worker; });
  assert.equal(told, waiting);
});

test('a version that arrives while the app is open is noticed too', () => {
  const registration = fakeRegistration();
  const installing = fakeWorker();
  let told = null;

  const scope = { navigator: { serviceWorker: { controller: { id: 'the old one' } } } };
  watchForUpdate(registration, (worker) => { told = worker; }, { scope });
  registration.installing = installing;
  registration.fire('updatefound');
  installing.state = 'installed';
  installing.fire('statechange');

  assert.equal(told, installing);
});

test('the very first install tells nobody — there is nothing to update from', () => {
  const registration = fakeRegistration();
  const installing = fakeWorker();
  let told = null;

  const scope = { navigator: { serviceWorker: { controller: null } } };
  watchForUpdate(registration, (worker) => { told = worker; }, { scope });
  registration.installing = installing;
  registration.fire('updatefound');
  installing.state = 'installed';
  installing.fire('statechange');

  assert.equal(told, null);
});

test('it is said once, however many events arrive', () => {
  const registration = fakeRegistration({ waiting: { id: 'w' } });
  let count = 0;
  watchForUpdate(registration, () => { count++; });
  registration.fire('updatefound');
  registration.fire('updatefound');
  assert.equal(count, 1);
});

// --- Taking the update -----------------------------------------------------

test('the tap tells the waiting worker to take over, and reloads when it has', () => {
  const sent = [];
  let onControllerChange = null;
  let reloaded = false;
  const scope = {
    navigator: { serviceWorker: {
      addEventListener: (type, fn) => { if (type === 'controllerchange') onControllerChange = fn; },
    } },
    location: { reload: () => { reloaded = true; } },
  };
  const worker = { postMessage: (msg) => sent.push(msg) };

  applyUpdate(worker, scope);
  assert.deepEqual(sent, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloaded, false, 'not until the new worker is actually in charge');

  onControllerChange();
  assert.equal(reloaded, true);
});

test('nothing happens without a waiting version', () => {
  assert.equal(applyUpdate(null), false);
});

// --- Looking for one -------------------------------------------------------

test('it asks the browser to look again when the app comes back to the front', () => {
  let checks = 0;
  const handlers = new Map();
  const scope = {
    document: {
      hidden: false,
      addEventListener: (type, fn) => handlers.set(type, fn),
      removeEventListener: () => handlers.clear(),
    },
  };
  const registration = { update: () => { checks++; } };

  const stop = pollForUpdate(registration, { scope, everyMs: 10000 });
  handlers.get('visibilitychange')();
  assert.equal(checks, 1);

  scope.document.hidden = true;
  handlers.get('visibilitychange')();
  assert.equal(checks, 1, 'not while it is in the background');
  stop();
});

test('a phone that is offline when it checks is not an error', () => {
  const handlers = new Map();
  const scope = { document: { hidden: false, addEventListener: (t, fn) => handlers.set(t, fn),
    removeEventListener: () => {} } };
  const registration = { update: () => { throw new Error('offline'); } };
  const stop = pollForUpdate(registration, { scope, everyMs: 10000 });
  assert.doesNotThrow(() => handlers.get('visibilitychange')());
  stop();
});

test('mounting on a phone with no registration does nothing and breaks nothing', () => {
  assert.doesNotThrow(() => mountUpdatePrompt(null, { scope: {} }));
});
