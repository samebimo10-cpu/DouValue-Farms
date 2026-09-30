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

export const SOURCES_FILE = 'rules/sources.json';

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
export async function loadSources({ url = null, fetchImpl = null } = {}) {
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

export function peekSources() { return cache; }

/** Tests set the registry directly. */
export function setSources(doc) {
  cache = doc ? shape(doc) : null;
  return cache;
}

export function sourceById(id, registry = cache) {
  if (!registry) return null;
  return registry.sources.find((s) => s.id === id) || null;
}

// --- Licences ---------------------------------------------------------------

/** "unknown", "not stated", "check each" — none of these is a licence. */
export function licenceRecorded(licence) {
  const text = String(licence || '').trim();
  if (!text) return false;
  return !/^(unknown|none|not stated|n\/?a|tbc|check\b|per publication)/i.test(text);
}

/** CC BY-NC, CC BY-NC-SA, CC BY-NC-ND: the NC is what makes it non-commercial. */
export function isNonCommercial(licence) {
  return /(^|[^a-z])NC([^a-z]|$)/i.test(String(licence || ''))
    || /non[-\s]?commercial/i.test(String(licence || ''));
}

/** A Creative Commons licence with the BY (attribution) element. */
export function needsAttribution(licence) {
  return /\bCC[-\s]+BY\b/i.test(String(licence || ''));
}

/**
 * The line shown with a bundled source (FR-KNOW-05). A linked source has no
 * licence line: we show its link and nothing we did not copy needs one.
 */
export function licenceLine(source) {
  if (!source || !source.bundled) return '';
  const credit = source.attribution || source.publisher || '';
  return `${credit ? `${credit}. ` : ''}${source.licence}. Bundled with the app.`;
}

// --- The checks the build runs (docs/knowledge-layer.md §8) -----------------

/**
 * Everything wrong with a registry, as a list of { id, problem } — empty when
 * it is sound. FR-KNOW-00 and FR-KNOW-02 are the two that must never fail.
 */
export function registryProblems(registry) {
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
export function sourcedEntries(rules) {
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
export function unresolvedSources(rules, registry) {
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
export function sourcesOf(entries) {
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
export function describeSources(ids, registry = cache) {
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
