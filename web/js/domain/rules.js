// The rules file, read from the one place it lives.
//
// rules/douvalue_rules_rev5_1.json is the source of truth for this farm: the
// gates, the rotations, the PHI and REI defaults, the lime rates, the Week 10
// organics rule. CLAUDE.md says both web/ and server/ read it from there and
// that nobody copies it, and the reason is the obvious one — a second copy is
// a second answer, and the day the two disagree is the day a gate lets
// something through that the schedule forbids.
//
// So this module is the only thing in the app that knows where the file is.
// Everything else asks for `rules()`.
//
// Loading is asynchronous because a browser has to fetch it, but reading is
// synchronous, because a calculator in the middle of a spray sheet cannot go
// away and come back. The app loads it once at boot; the tests load it once at
// the top of the file. A screen that reads it before it is loaded is a bug in
// the screen, so `rules()` throws rather than quietly returning half a farm.

const FILE = 'douvalue_rules_rev5_1.json';

/**
 * Where the file is, which is not the same question in the two places this
 * module runs.
 *
 * In Node — the tests, and anything that imports the domain directly — it is
 * the repository's own rules/ directory, three levels up from web/js/domain/.
 *
 * In a browser it sits beside the app, because `scripts/assemble_site.sh`
 * publishes web/ at the site root and rules/ next to it. Resolving that
 * against the page rather than against this module is deliberate: the site
 * lives under /DouValue-Farms/ on Pages and at / when served locally, and the
 * app is written not to know which. The document already knows.
 */
export function rulesUrl() {
  if (typeof document === 'undefined' || !document.baseURI) {
    return new URL(`../../../rules/${FILE}`, import.meta.url);
  }
  return new URL(`rules/${FILE}`, document.baseURI);
}

let loaded = null;

/** The rules, or an explosion. Never a guess. */
export function rules() {
  if (!loaded) {
    throw new Error('The rules file has not been loaded yet. Call loadRules() before reading it.');
  }
  return loaded;
}

export function rulesReady() { return !!loaded; }

/**
 * Hand the rules in directly.
 *
 * Used by the tests, and by any caller that already has the parsed file. It is
 * also the seam that would let a future version read a newer rules file that
 * arrived over sync without this module having to know about it.
 */
export function setRules(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('That is not a rules file.');
  loaded = parsed;
  return loaded;
}

/**
 * Read the file. Safe to call repeatedly: the second call is free.
 *
 * Node reads it off disk, a browser fetches it. A browser that is offline gets
 * it from the service-worker cache, which is why the file is in the cache
 * manifest — the calculators and plan checks are required to work with no
 * signal (FR-DOC-03, NFR-OFF-01), and they cannot do that if their own rule
 * book needs a network.
 */
export async function loadRules() {
  if (loaded) return loaded;
  const url = rulesUrl();

  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return setRules(JSON.parse(await readFile(url, 'utf8')));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the rules file (${res.status}).`);
  return setRules(await res.json());
}
