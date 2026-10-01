// The published site installs its service worker and opens with no signal.
// NFR-OFF-01, NFR-DEV-01, FR-DOC-03.
//
// web/sw.js used to precache '../rules/douvalue_rules_rev5_1.json' in its
// shell list. In the repository, with the app under web/, that is the rules
// file. On GitHub Pages the app is the site root and "../" climbs out of the
// site altogether, so the request 404s, cache.addAll() rejects, the install
// fails — and the published app had no offline cache at all. Every unit test
// passed, because none of them ran the worker against the layout that ships.
//
// These do. The site is built by the real scripts/assemble_site.sh, served
// under /DouValue-Farms/ the way Pages serves it, and opened in a real Chrome.
// Then the server is stopped and the page reloaded: anything that opens after
// that came out of the service worker's cache.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { assembleSite, BASE, serveDir, workerLists } from './helpers/site.mjs';
import { findChrome, launchChrome } from './helpers/browser.mjs';

const { SHELL, RULES, SOURCES } = workerLists();

let dir;
before(() => { dir = assembleSite(); });
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

async function status(url) {
  const res = await fetch(url);
  await res.arrayBuffer();
  return res.status;
}

/** Every file the worker caches, resolved the way the worker resolves it. */
async function checkLayout(site, workerPath) {
  const worker = new URL(workerPath, site.origin);
  const missing = [];
  for (const entry of SHELL) {
    const url = new URL(entry, worker);
    if (await status(url) !== 200) missing.push(`${entry} → ${url.pathname}`);
  }
  assert.deepEqual(missing, [], 'cache.addAll(SHELL) rejects if any one of these is missing, and the install fails');
  for (const [name, list] of [['rules', RULES], ['source registry', SOURCES]]) {
    const found = [];
    for (const entry of list) if (await status(new URL(entry, worker)) === 200) found.push(entry);
    assert.ok(found.length, `none of the ${name} addresses answer: ${list.join(', ')}`);
  }
}

test('published layout: every file the worker precaches is on the site', async () => {
  const site = await serveDir(dir, BASE);
  try {
    await checkLayout(site, `${BASE}sw.js`);
  } finally { await site.stop(); }
});

test('repository layout: the same worker still finds everything from web/', async () => {
  // README: a developer serves the repository root and opens /web/.
  const site = await serveDir();
  try {
    await checkLayout(site, '/web/sw.js');
  } finally { await site.stop(); }
});

test('the shell list never reaches outside the folder the worker is in', () => {
  // The precise mistake: a "../" in SHELL works in the repository and nowhere
  // else. The rules are reached through RULES, which tries both addresses.
  for (const entry of SHELL) assert.ok(!entry.startsWith('../'), `${entry} climbs out of the published site`);
});

test('every module the app can import is in the shell list', () => {
  // A module left out of SHELL is a screen that does not open with no signal,
  // and nothing fails until somebody is standing in a greenhouse. Walk the
  // imports from app.js — static and dynamic — and check each one is cached.
  const web = new URL('../web/', import.meta.url);
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(new URL(rel, web), 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const next = new URL(m[1] || m[2], new URL(rel, web));
      walk(next.href.slice(web.href.length));
    }
  };
  walk('js/app.js');
  const cached = new Set(SHELL.map((e) => e.replace(/^\.\//, '')));
  const missing = [...seen].filter((f) => !cached.has(f));
  assert.deepEqual(missing, [], 'add these to SHELL in web/sw.js (and bump CACHE)');
});

const chrome = findChrome();
// On CI a missing browser is a failure, not a skip: this is the only test that
// runs the worker at all.
const skip = !chrome && !process.env.CI ? 'no Chrome or Chromium on this machine (set CHROME_PATH)' : false;

test('published site: the service worker installs and the app opens offline', { skip, timeout: 120000 }, async () => {
  const site = await serveDir(dir, BASE);
  const browser = await launchChrome(chrome);
  try {
    const page = await browser.newPage();
    await page.goto(site.url);

    // Installed, activated and in charge of this page. A failed install never
    // gets this far: the registration ends with no active worker at all.
    await page.waitFor(`navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.state === 'activated'`, { what: 'the service worker to install and take over' });

    const cached = await page.evaluate(`(async () => {
      const out = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const req of await cache.keys()) out.push(new URL(req.url).pathname);
      }
      return out;
    })()`);
    for (const path of [BASE, `${BASE}index.html`, `${BASE}js/app.js`,
      `${BASE}rules/douvalue_rules_rev5_1.json`, `${BASE}rules/sources.json`]) {
      assert.ok(cached.includes(path), `${path} is not in the offline cache`);
    }

    // The signal goes. Not a 404 — nothing answers at all.
    await site.stop();
    const before = site.served.length;
    // Marked, so nothing below can be read off the page from before the reload.
    await page.evaluate('window.__beforeReload = true');
    await page.reload();

    await page.waitFor('!window.__beforeReload && !!window.__douvalueCtx && !!navigator.serviceWorker.controller',
      { what: 'the app to open with the server stopped', timeout: 60000 });
    const text = await page.evaluate("document.getElementById('app').textContent");
    assert.doesNotMatch(text, /could not start/i);
    assert.doesNotMatch(text, /^\s*Loading…\s*$/);

    // FR-DOC-03 / NFR-OFF-01: the gates, the calculators and the plan checks
    // need the rule book, so it has to have come out of the cache too.
    const rules = await page.evaluate(`import(new URL('js/rules.js', location.href).href)
      .then((m) => m.rulesLoaded() && m.rulesVersion())`);
    assert.ok(rules, 'the rules did not load offline');
    assert.equal(site.served.length, before, 'something reached the stopped server');
  } finally {
    await browser.close();
    await site.stop().catch(() => {});
  }
});
