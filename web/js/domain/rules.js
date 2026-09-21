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

export const RULES_FILE = 'rules/douvalue_rules_rev5_1.json';

let cache = null;

/** A pointer into the rules file, for showing the working. */
export function ref(path) {
  return `${RULES_FILE}#/${String(path).replace(/^\/+/, '')}`;
}

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/**
 * Where to look, in order.
 *
 * Deployed, the app sits at the site root and the rules beside it at /rules/,
 * so two levels up from js/domain/ is right. In the repository the app is one
 * level deeper, under web/, so three levels up is right. Trying both keeps a
 * developer's http-server and the published site on the same code path.
 */
function candidates() {
  return [
    new URL(`../../${RULES_FILE}`, import.meta.url),
    new URL(`../../../${RULES_FILE}`, import.meta.url),
  ];
}

function check(doc, where) {
  if (!doc || typeof doc !== 'object') throw new Error(`${where} is not a rules document`);
  if (!Array.isArray(doc.active_ingredients) || !doc.active_ingredients.length) {
    throw new Error(`${where} has no active_ingredients: it is not rev 5.1 of the rules`);
  }
  return doc;
}

/**
 * Read the rules. The one call the app makes at boot.
 *
 * `fetchImpl` and `url` exist for tests; normal callers pass nothing.
 */
export async function loadRules({ url = null, fetchImpl = null } = {}) {
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
export function getRules() {
  if (!cache) throw new Error('The rules have not been loaded yet — call loadRules() first');
  return cache;
}

export function rulesLoaded() { return !!cache; }

/** Tests and the sample farm set the document directly. */
export function setRules(doc) {
  cache = doc ? check(doc, 'the supplied rules') : null;
  return cache;
}
