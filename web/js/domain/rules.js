// The one place that reads rules/douvalue_rules_rev5_1.json.
//
// CLAUDE.md is explicit: the rules JSON is the source of truth, and both web/
// and server/ load it *from there* rather than keeping a copy. So this module
// resolves the file relative to itself and hands it out read-only. The repo
// layout and the published site agree on the path:
//
//   repo:  /web/js/domain/rules.js  ->  ../../../rules/...   =  /rules/...
//   site:  /js/domain/rules.js      ->  ../../../rules/...   =  /rules/...
//
// (URL resolution clamps the extra "..", so the same relative path works at the
// site root, where the app is served from, and under /web/ in development.)
//
// Loading is asynchronous, so this module top-level awaits it. Everything that
// imports it — diagnose.js and its importers — therefore waits for the rules
// before it runs, which is what makes the rest of the code able to treat them
// as ordinary synchronous data.

const RULES_URL = new URL('../../../rules/douvalue_rules_rev5_1.json', import.meta.url);

async function readRules() {
  // Node (the test suite, the build) reads the file; fetch() has no file://.
  if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(RULES_URL, 'utf8'));
  }
  const res = await fetch(RULES_URL.href);
  if (!res || !res.ok) {
    throw new Error(`The rules file could not be read from ${RULES_URL.href}. `
      + 'The app cannot diagnose anything without it.');
  }
  return res.json();
}

/** Nothing downstream may edit the source of truth, even by accident. */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

export const RULES = deepFreeze(await readRules());

/** rules-1.2 at the time of writing. Stamped onto everything the engine produces. */
export const RULES_VERSION = (RULES.meta && RULES.meta.version) || 'unknown';

export const RULES_SOURCE = RULES_URL.href;
