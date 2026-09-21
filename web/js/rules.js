// The rules file, read once.
//
// rules/douvalue_rules_rev5_1.json is the source of truth for this farm
// (CLAUDE.md), and the repository holds exactly one copy of it. Nothing here
// restates a threshold, a rate or a gate condition: everything below is a
// reader over that file, so the way to change a rule stays "edit the JSON".
//
// The file is fetched rather than imported because it is published beside the
// app rather than bundled into it. Two addresses are tried: the assembled site
// puts the app at the root with the rules one level below it, and a developer
// serving the repository root has the app under web/ and the rules a further
// level up. The loader is content to fail — every caller has to cope with the
// rules being absent anyway, since a phone's first run may be offline. The
// Farm Doctor's answer to "I could not read the rules" is to refuse, not to
// guess, which is the behaviour the limits in FR-DOC-08 ask for.

let RULES = null;

/** The rules as loaded, or null if they have not arrived on this device yet. */
export function getRules() { return RULES; }

/** Put a rules object in place. The tests read the file off disk and call this. */
export function setRules(rules) { RULES = rules && typeof rules === 'object' ? rules : null; return RULES; }

export function rulesVersion(rules = RULES) {
  return (rules && rules.meta && rules.meta.version) || null;
}

const CANDIDATES = [
  '../rules/douvalue_rules_rev5_1.json',       // assembled site: app at /, rules at /rules/
  '../../rules/douvalue_rules_rev5_1.json',    // repository root served: app at /web/
];

/**
 * Fetch the rules and remember them. Returns null rather than throwing: a farm
 * phone that cannot reach the file still has to open.
 */
export async function loadRules(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (!fetchImpl) return null;
  for (const rel of CANDIDATES) {
    try {
      const res = await fetchImpl(new URL(rel, import.meta.url).href, { cache: 'no-cache' });
      if (!res || !res.ok) continue;
      const parsed = await res.json();
      if (parsed && parsed.meta) return setRules(parsed);
    } catch {
      // Next candidate, then give up quietly.
    }
  }
  return null;
}

// --- Readers over the file ------------------------------------------------

/** A stable id for an active ingredient, so it can be keyed and compared. */
export function activeId(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * The names one active ingredient might appear under on a stock shelf.
 * "Azadirachtin / neem oil" is one entry in the catalogue and two words on a
 * bottle, and a farm writes whichever is on the bottle.
 */
export function activeAliases(entry) {
  const raw = String(entry.ai || '');
  const parts = raw.split('/').map((s) => s.trim()).filter(Boolean);
  const out = new Set([raw, ...parts]);
  for (const p of [...out]) {
    const bare = p.replace(/\([^)]*\)/g, '').trim();          // "Bacillus thuringiensis (Bt)"
    if (bare) out.add(bare);
    const inner = /\(([^)]+)\)/.exec(p);
    if (inner) out.add(inner[1].trim());
    const first = bare.split(/\s+/)[0];
    if (first && first.length > 4) out.add(first);            // "Mancozeb 80% WP" on the shelf
  }
  return [...out].filter(Boolean);
}

/**
 * The active-ingredient catalogue (FR-STOCK-05), normalised.
 *
 * `banned` is carried through so the ban is enforced from the same list the
 * catalogue comes from; FR-STOCK-09 keeps banned actives out of the catalogue
 * altogether, and this is the belt to that braces.
 */
export function catalogue(rules = RULES) {
  if (!rules || !Array.isArray(rules.active_ingredients)) return [];
  const banned = bannedNames(rules);
  return rules.active_ingredients
    .filter((a) => a && a.ai)
    .map((a) => ({
      id: activeId(a.ai),
      ai: a.ai,
      type: a.type || '',
      group: a.group || '',
      scheduleRate: a.schedule_rate || null,
      phiDays: a.phi_days == null ? null : Number(a.phi_days),
      aliases: activeAliases(a),
      organic: isOrganic(a),
    }))
    .filter((a) => !banned.some((b) => matchesName(b, a)));
}

export function catalogueEntry(name, rules = RULES) {
  const id = activeId(name);
  const list = catalogue(rules);
  return list.find((a) => a.id === id)
    || list.find((a) => a.aliases.some((alias) => activeId(alias) === id))
    || null;
}

/** Names the rules say never to buy or use. Checked by name, not by id. */
export function bannedNames(rules = RULES) {
  const out = [];
  const labelBan = rules && rules.labels && rules.labels.banned;
  if (Array.isArray(labelBan)) out.push(...labelBan);
  const doNotBuy = rules && rules.soil_and_water && rules.soil_and_water.lime
    && rules.soil_and_water.lime.do_not_buy;
  if (Array.isArray(doNotBuy)) out.push(...doNotBuy);
  return out.map(String);
}

/** Does this banned entry — "Carbofuran (Furadan)" — describe that product? */
export function matchesName(bannedEntry, product) {
  const words = String(bannedEntry).toLowerCase().match(/[a-z]{4,}/g) || [];
  const hay = [product.ai, product.name, ...(product.aliases || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return words.some((w) => hay.includes(w));
}

export function isBanned(name, rules = RULES) {
  const product = { ai: name, aliases: [name] };
  return bannedNames(rules).some((b) => matchesName(b, product));
}

/** From Week 10 the only things that may be sprayed are these (SR-08, rei.week_10_rule). */
export function isOrganic(active) {
  const hay = `${active.ai || active.name || ''} ${active.type || ''}`.toLowerCase();
  return /neem|azadirachtin|garlic|copper hydroxide|trichoderma|bacillus|botanical|biological/.test(hay);
}

export function gateSpec(id, rules = RULES) {
  if (!rules || !Array.isArray(rules.gates)) return null;
  return rules.gates.find((g) => g.id === id) || null;
}

export function doctorRules(rules = RULES) { return (rules && rules.farm_doctor) || null; }

export function triageRows(rules = RULES) { return (rules && rules.triage) || []; }

export function diagnosisCard(id, rules = RULES) {
  const cards = (rules && rules.diagnosis_cards) || [];
  return cards.find((c) => c.id === id) || null;
}

/** The rules' own default waiting periods, read out of the phi table. */
export function defaultPhiDays(rules = RULES) {
  const rows = (rules && rules.phi) || [];
  for (const row of rows) {
    if (/other synthetic/i.test(String(row.product || ''))) {
      const n = parseInt(String(row.phi_days), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 14;
}

export const DEFAULT_REI_HOURS = 24;   // rei.rule: "24 h until label value entered"
