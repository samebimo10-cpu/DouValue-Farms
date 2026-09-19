// The rules loader.
//
// rules/douvalue_rules_rev5_1.json is the source of truth for this farm, and
// CLAUDE.md is blunt about what that means: both web/ and server/ read that one
// file, and nobody copies it. A copy is how a farm ends up spraying to one set
// of intervals and reporting against another.
//
// So this module is the only place that knows where the file lives. Everything
// downstream — the active-ingredient catalogue, the rotation gate, the Farm
// Doctor's plan checks — asks for the loaded document and never for a literal.
// When the agronomist edits the JSON, the app changes with it.
//
// It has to work in two runtimes with one code path:
//
//   the phone   fetch() against the published site, where assemble_site.sh puts
//               the app at the root and the rules at /rules/ beside it
//   node        the test runner and the sync server, reading the repository copy
//               straight off disk
//
// Loading is asynchronous because fetching is, but reading is not: once the
// document is in hand, rules() is a plain synchronous accessor, so a gate stays
// a pure function of recorded facts and never has to await anything mid-check.

/** Where the one copy lives, relative to the repository root and to the site root. */
export const RULES_FILE = 'rules/douvalue_rules_rev5_1.json';

let doc = null;
let loading = null;

/** Candidate addresses for the rules file, most likely first. */
function candidates() {
  return [
    // Published site: /js/rules.js sits beside /rules/…
    new URL(`../${RULES_FILE}`, import.meta.url),
    // Repository served from its root: /web/js/rules.js, rules two levels up.
    new URL(`../../${RULES_FILE}`, import.meta.url),
  ];
}

function isNode() {
  return typeof process !== 'undefined' && !!(process.versions && process.versions.node)
    && typeof document === 'undefined';
}

async function readFromDisk() {
  const { readFile } = await import('node:fs/promises');
  let lastError = null;
  for (const url of candidates()) {
    try {
      return JSON.parse(await readFile(url, 'utf8'));
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not read ${RULES_FILE}: ${lastError && lastError.message}`);
}

async function readOverNetwork(fetchImpl) {
  let lastError = null;
  for (const url of candidates()) {
    try {
      const res = await fetchImpl(url.href || String(url), { cache: 'no-cache' });
      if (!res.ok) { lastError = new Error(`${res.status} for ${url}`); continue; }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not fetch ${RULES_FILE}: ${lastError && lastError.message}`);
}

/**
 * Check the document is the rules and not, say, an error page that happened to
 * parse. A rules file with no actives would quietly empty the catalogue, and an
 * empty catalogue looks exactly like a farm with nothing to spray.
 */
function check(next) {
  const missing = ['active_ingredients', 'labels', 'insecticide_rotation', 'fungicide_rotation', 'phi']
    .filter((key) => !next || next[key] == null);
  if (missing.length) {
    throw new Error(`${RULES_FILE} is missing ${missing.join(', ')} — refusing to run on a half rules file`);
  }
  return next;
}

/**
 * Load the rules once and remember them.
 *
 * Concurrent callers share one read: the shell, the store and the first screen
 * all boot at the same time and none of them should trigger its own fetch.
 */
export async function loadRules({ reload = false, fetchImpl = null } = {}) {
  if (doc && !reload) return doc;
  if (loading && !reload) return loading;

  const fetcher = fetchImpl || (typeof fetch === 'function' && !isNode() ? fetch.bind(globalThis) : null);
  loading = (fetcher ? readOverNetwork(fetcher) : readFromDisk())
    .then((next) => { doc = check(next); loading = null; return doc; })
    .catch((err) => { loading = null; throw err; });
  return loading;
}

/**
 * The loaded rules, synchronously.
 *
 * Throws rather than returning an empty object. Every caller here decides
 * whether someone may spray, plant or pick; "the rules did not load" must stop
 * the screen, not silently become "no rule says otherwise".
 */
export function rules() {
  if (!doc) throw new Error(`${RULES_FILE} has not been loaded — call loadRules() during boot`);
  return doc;
}

export function rulesLoaded() {
  return !!doc;
}

/** Put a document in place directly. For the sync server and for tests. */
export function setRules(next) {
  doc = check(next);
  return doc;
}

/** One section, by name, with a clear error if the rules file has moved on. */
export function section(name) {
  const value = rules()[name];
  if (value == null) throw new Error(`${RULES_FILE} has no "${name}" section`);
  return value;
}

/** The rules version, for the audit trail and the "what am I running" screen. */
export function rulesVersion() {
  const meta = rules().meta || {};
  return meta.version || 'unknown';
}
