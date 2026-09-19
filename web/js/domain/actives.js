// The active-ingredient catalogue — FR-STOCK-05 to FR-STOCK-09, Build Rules §11d.
//
// A farm does not buy active ingredients. It buys whatever the agro-dealer in
// Rumuokoro has on the shelf this week, under a name printed by whoever bottled
// it. Season 1's spray record is a list of brand names, and a list of brand
// names cannot answer the only question that matters before the next spray:
// have we already used this chemical family on this house?
//
// So the catalogue is the twenty active ingredients in the rules file, each
// with its IRAC or FRAC group, and a treatment is chosen from that list.
// A brand label is a separate thing entirely: a container the Farm Manager has
// in hand, attached to one or more actives, carrying the brand name, the
// formulation, the concentration, the rate printed on it, its PHI and REI, and
// a photo of the label itself. The group is never typed — it comes from the
// active, so a relabelled bottle cannot quietly restart the rotation.
//
// Three rules shape everything below.
//
//   1. The catalogue is read from rules/douvalue_rules_rev5_1.json, never
//      copied. Twenty actives here means twenty actives there.
//   2. A banned active is not in the catalogue at all. Not greyed out, not
//      flagged 'avoid' — absent, and refused at the door if anyone tries to add
//      it (FR-STOCK-09). Carbofuran killed farm workers; it does not get to be
//      a row in a list with a warning colour.
//   3. No rate, no use. An active with no schedule rate and no entered label
//      rate cannot be sprayed (FR-STOCK-08), because the alternative is a
//      guessed dose, and guessing is what cost Season 1.

import { rules, section } from '../rules.js';
import { roleRank, ROLES } from '../store.js';

// --- Names, tokens and matching -------------------------------------------
//
// One active ingredient is written four ways before breakfast: "Mancozeb",
// "Mancozeb 80% WP", "MANCOZEB 80WP", "mancozeb80". Matching has to survive
// that without ever matching the wrong thing — pairing copper oxychloride with
// copper hydroxide would put two M1 sprays back to back and call it a rotation.

/** Formulation and packaging noise that says nothing about which chemical it is. */
const NOISE = new Set(['wp', 'ec', 'sc', 'wg', 'wdg', 'sl', 'sp', 'gr', 'g', 'kg', 'l', 'ml', 'w', 'v']);

export function slug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** The words of a product name that actually identify the chemical. */
export function tokens(name) {
  return String(name || '').toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .filter((t) => !/^\d+(\.\d+)?$/.test(t))             // "80", "2.5"
    .filter((t) => !/^\d+[a-z]{1,3}$/.test(t))            // "45sc", "10ec", "200sc"
    .filter((t) => !NOISE.has(t));
}

const subset = (a, b) => [...a].every((t) => b.has(t));

/**
 * A looser reading, for names that hyphenate differently.
 *
 * The store's own records spell things as whoever typed them did:
 * "metalaxyl_mancozeb" against the catalogue's "Metalaxyl-M + Mancozeb". Broken
 * at the hyphen, with the stray initial dropped, the two say the same thing.
 * Only tried when the strict pass finds nothing, so it never loosens a match
 * that was already clear.
 */
function looseTokens(name) {
  return tokens(name)
    .flatMap((t) => t.split('-'))
    .filter((t) => t.length > 1);
}

/**
 * How well one product name names another. 0 is no match.
 *
 * 3  the same chemical, written the same way
 * 2  the candidate's full name appears inside a longer one ("Mancozeb 80% WP")
 * 1  a shorter form of the candidate ("Bacillus thuringiensis" for the Bt row)
 */
function score(queryTokens, candidateTokens) {
  const q = new Set(queryTokens);
  const c = new Set(candidateTokens);
  if (!q.size || !c.size) return 0;
  if (q.size === c.size && subset(q, c)) return 3;
  if (subset(c, q)) return 2;
  if (subset(q, c)) return 1;
  return 0;
}

// --- Banned actives (FR-STOCK-09) -----------------------------------------

// Everything derived from the rules file is worked out once and remembered
// against the document it came from. These are read inside loops on a screen
// that has to open in under two seconds on a 2 GB phone (NFR-PERF-01), and the
// rules do not change between two reads.
const memo = new WeakMap();

function derived(key, build) {
  const doc = rules();
  let bucket = memo.get(doc);
  if (!bucket) { bucket = new Map(); memo.set(doc, bucket); }
  if (!bucket.has(key)) bucket.set(key, build(doc));
  return bucket.get(key);
}

/** Every word that names a banned active, brand names included. */
function bannedKeys() {
  return derived('banned', (doc) => {
    const out = new Set();
    for (const entry of (doc.labels || {}).banned || []) {
      for (const token of tokens(entry)) out.add(token);
    }
    return out;
  });
}

/** The banned actives, as the rules write them. For the refusal message. */
export function bannedActives() {
  return [...(section('labels').banned || [])];
}

/**
 * Is this name a banned active?
 *
 * Deliberately generous: any word of a banned entry is enough, so "Furadan",
 * "Carbofuran 3G" and "carbofuran granules" are all refused. A false refusal
 * costs somebody a phone call. A false acceptance costs somebody their life.
 */
export function isBanned(name) {
  const keys = bannedKeys();
  return tokens(name).some((t) => keys.has(t));
}

// --- Resistance groups -----------------------------------------------------

/** FRAC's multi-site codes: M1 copper, M2 sulphur, M3 dithiocarbamates. */
const MULTISITE = /^M\d+$/i;

/**
 * Split "FRAC 4 + M3" into the system, the codes, and the codes that drive the
 * rotation.
 *
 * A mixture carries every group in it, but it does not rotate on all of them.
 * Metalaxyl-M + Mancozeb is FRAC 4 (single-site, the group resistance actually
 * builds against) blended with M3 (multi-site). The rules file says so itself —
 * "Multi-site M groups carry low resistance risk" — and its own fungicide
 * sequence restarts at Mancozeb (M3) straight after the Metalaxyl mixture, which
 * only works if the mixture rotates as 4. So the single-site component drives
 * the rotation where there is one, and the multi-site code where there is not.
 */
export function parseGroup(group) {
  const none = { system: null, codes: [], rotationCodes: [], label: 'no group', rotates: false };
  const raw = String(group || '').trim();
  if (!raw || /^none$/i.test(raw)) return none;

  const m = raw.match(/^(IRAC|FRAC)\s+(.+)$/i);
  if (m) {
    const system = m[1].toUpperCase();
    const codes = m[2].split('+').map((c) => c.trim().toUpperCase()).filter(Boolean);
    const single = codes.filter((c) => !MULTISITE.test(c));
    // "UN" is IRAC's label for an unknown mode of action — the botanicals. It is
    // not a resistance group you can rotate away from, and SR-08 requires neem
    // and garlic-chilli to be used repeatedly from Week 10, so it does not
    // enter the rotation check.
    const rotates = !codes.every((c) => c === 'UN');
    return { system, codes, rotationCodes: single.length ? single : codes, label: raw, rotates };
  }

  // FRAC's biological codes (BM02) come without the prefix. Biologicals carry
  // low resistance risk and are used repeatedly on purpose.
  if (/^BM/i.test(raw)) {
    return { system: 'BM', codes: [raw.toUpperCase()], rotationCodes: [], label: raw, rotates: false };
  }

  return { ...none, codes: [raw.toUpperCase()], label: raw };
}

/** Do two actives rotate as the same resistance group? */
export function sameGroup(a, b) {
  if (!a || !b) return false;
  const ga = parseGroup(a.group);
  const gb = parseGroup(b.group);
  if (!ga.rotates || !gb.rotates) return false;
  if (ga.system !== gb.system) return false;
  return ga.rotationCodes.some((c) => gb.rotationCodes.includes(c));
}

/** Does this active carry a given FRAC/IRAC code at all, mixture partners included? */
export function carriesCode(active, code) {
  if (!active) return false;
  return parseGroup(active.group).codes.includes(String(code).toUpperCase());
}

// --- PHI and REI defaults (FR-STOCK-07, Build Rules §9) --------------------

/** Hours out of a written re-entry default: "minimum 4 h", "24 h until…". */
function reiHoursFrom(text) {
  const min = String(text || '').match(/minimum\s+(\d+)\s*h/i);
  if (min) return Number(min[1]);
  const any = String(text || '').match(/(\d+)\s*h\b/i);
  return any ? Number(any[1]) : 24;
}

function phiDaysFrom(value) {
  if (typeof value === 'number') return value;
  const m = String(value || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * The PHI/REI row that covers an active, from the rules table.
 *
 * The last row — "any other synthetic" — is the catch-all, and it is also the
 * default FR-STOCK-07 names: 14 days before picking, 24 hours before anyone
 * walks back in. Anything the table does not name falls to it, which is the
 * safe direction to fall.
 */
function phiRowFor(active) {
  const rows = section('phi');
  const fallback = rows.find((r) => /any other/i.test(r.product)) || rows[rows.length - 1];
  const named = rows.find((row) => {
    if (row === fallback) return false;
    return String(row.product).split(',').some((name) => score(tokens(name), tokens(active.name)) > 0);
  });
  return named || fallback;
}

/** The farm's defaults, before any label is entered: 14 days, 24 hours. */
export function intervalDefaults() {
  const rows = section('phi');
  const fallback = rows.find((r) => /any other/i.test(r.product)) || rows[rows.length - 1];
  return { phiDays: phiDaysFrom(fallback.phi_days) ?? 14, reiHours: reiHoursFrom(fallback.rei_default) };
}

// --- The catalogue ---------------------------------------------------------

/** One rules row, turned into the row the app uses. */
function build(row) {
  const group = parseGroup(row.group);
  const active = {
    id: slug(row.ai),
    name: row.ai,
    type: row.type || '',
    group: row.group || 'none',
    groupSystem: group.system,
    groupCodes: group.codes,
    rotates: group.rotates,
    scheduleRate: row.schedule_rate || null,
    addedBy: null,
  };
  const row2 = phiRowFor(active);
  const declared = typeof row.phi_days === 'number' ? row.phi_days : null;
  const tabled = phiDaysFrom(row2.phi_days);
  // Where the active declares its own PHI and the table names a default, take
  // the longer of the two. Never the shorter: a waiting period is the one
  // number on this screen that a mistake turns into a residue in a buyer's lab.
  active.phiDays = Math.max(declared ?? 0, tabled ?? 0);
  active.phiDefault = declared == null;
  active.reiHours = reiHoursFrom(row2.rei_default);
  active.reiDefault = true;
  active.exportBufferDays = row2.export_buffer_days || null;
  return active;
}

/**
 * The catalogue: the rules file's actives, plus any the Owner has added, minus
 * anything banned.
 *
 * The banned filter runs on the way out as well as on the way in. A forged or
 * replayed event cannot put carbofuran on a spray screen, because nothing that
 * matches a banned name is ever returned from here.
 */
export function catalogue(state = null) {
  const fromRules = derived('catalogue', (doc) => doc.active_ingredients.map(build));
  if (!state || !state.actives || !Object.keys(state.actives).length) {
    return fromRules.filter((a) => !isBanned(a.name));
  }
  const added = Object.values(state.actives).map((row) => ({
    ...build({ ai: row.name, type: row.type, group: row.group, schedule_rate: row.scheduleRate,
      phi_days: row.phiDays }),
    id: row.id || slug(row.name),
    addedBy: row.addedBy || null,
    addedAt: row.addedAt || null,
  }));

  const byId = new Map();
  for (const active of [...fromRules, ...added]) {
    if (isBanned(active.name)) continue;
    byId.set(active.id, active);
  }
  return [...byId.values()];
}

export function activeById(id, state = null) {
  return catalogue(state).find((a) => a.id === id) || null;
}

/**
 * The active a written product name refers to, or null when nothing matches
 * cleanly. Two equally good matches count as none: a guess here is a guess
 * about which resistance group just went on the crop.
 */
export function findActive(name, state = null) {
  if (!name) return null;
  const list = catalogue(state);
  const strict = bestMatch(tokens(name), list, (a) => tokens(a.name));
  const loose = bestMatch(looseTokens(name), list, (a) => looseTokens(a.name));

  // The looser reading only wins when it names the chemical better than the
  // strict one did. "metalaxyl_mancozeb" reads as plain Mancozeb until the
  // hyphen in Metalaxyl-M is broken; then it reads as both, which is what it is.
  if (loose && (!strict || loose.score > strict.score)) return loose.active;
  return strict ? strict.active : null;
}

function bestMatch(q, list, pick) {
  if (!q.length) return null;
  let best = 0;
  let hits = [];
  for (const active of list) {
    const s = score(q, pick(active));
    if (!s) continue;
    if (s > best) { best = s; hits = [active]; } else if (s === best) hits.push(active);
  }
  return hits.length === 1 ? { active: hits[0], score: best } : null;
}

export function activesInGroup(group, state = null) {
  return catalogue(state).filter((a) => sameGroup(a, { group }));
}

// --- Brand labels (FR-STOCK-06, FR-STOCK-07) -------------------------------

export function labelsFor(state, activeId) {
  return Object.values((state && state.labels) || {})
    .filter((l) => (l.activeIds || []).includes(activeId));
}

/** The actives a label is attached to, catalogue rows rather than ids. */
export function labelActives(state, label) {
  return (label.activeIds || []).map((id) => activeById(id, state)).filter(Boolean);
}

/**
 * The groups a label carries. FR-STOCK-06: the group fills in from the active,
 * so this is a read, never a field somebody types.
 */
export function labelGroups(state, label) {
  return [...new Set(labelActives(state, label).map((a) => a.group))];
}

/**
 * The waiting periods that actually apply — FR-STOCK-07.
 *
 * Blank on the label means the default. A value on the label is used only if it
 * is longer than the default, in both directions: a bottle claiming a 3-day PHI
 * does not shorten this farm's 14, and a bottle claiming 48 hours does lengthen
 * its 24.
 */
export function intervalsFor(state, activeId, { label = null } = {}) {
  const active = activeById(activeId, state);
  if (!active) return null;
  const defaults = { phiDays: active.phiDays, reiHours: active.reiHours };

  const labelPhi = label && label.phiDays != null && label.phiDays !== '' ? Number(label.phiDays) : null;
  const labelRei = label && label.reiHours != null && label.reiHours !== '' ? Number(label.reiHours) : null;

  const phiLonger = labelPhi != null && labelPhi > defaults.phiDays;
  const reiLonger = labelRei != null && labelRei > defaults.reiHours;

  return {
    phiDays: phiLonger ? labelPhi : defaults.phiDays,
    reiHours: reiLonger ? labelRei : defaults.reiHours,
    phiSource: phiLonger ? 'label' : 'default',
    reiSource: reiLonger ? 'label' : 'default',
    phiNote: phiLonger ? `${labelPhi} days from the label` : 'default — check label',
    reiNote: reiLonger ? `${labelRei} hours from the label` : 'default — check label',
    exportBufferDays: active.exportBufferDays,
  };
}

/**
 * The dose to use, and where it came from — Build Rules §11d rate rule.
 * Schedule rate first, because that is this farm's own agronomy; a label rate
 * only where the schedule is silent.
 */
export function rateFor(state, activeId, { labelId = null } = {}) {
  const active = activeById(activeId, state);
  if (!active) return null;
  if (active.scheduleRate) return { rate: active.scheduleRate, source: 'schedule' };

  const label = labelId ? (state.labels || {})[labelId] : null;
  const candidates = label ? [label] : labelsFor(state, activeId);
  const withRate = candidates.find((l) => l && l.labelRate);
  if (withRate) return { rate: withRate.labelRate, source: 'label', label: withRate };
  return null;
}

/**
 * FR-STOCK-08 — an active with no schedule rate and no label rate cannot be
 * used. This is the check that keeps "about a capful" off the crop.
 */
export function canUse(state, activeId, { labelId = null } = {}) {
  const active = activeById(activeId, state);
  if (!active) {
    return {
      ok: false,
      reason: 'not-in-catalogue',
      why: 'That product is not in the active-ingredient catalogue.',
      fix: 'Treatments are chosen by active ingredient. Pick one from the catalogue, or ask the Owner '
        + 'to add the active with its IRAC or FRAC group.',
    };
  }
  const rate = rateFor(state, activeId, { labelId });
  if (!rate) {
    return {
      ok: false,
      reason: 'no-rate',
      active,
      why: `${active.name} has no rate on file: the schedule does not give one and no label has been entered.`,
      fix: `The Farm Manager adds the brand label for ${active.name} — brand, formulation, concentration, `
        + 'label rate, PHI, REI and a photo of the label — and then it can be used.',
    };
  }
  return { ok: true, active, ...rate };
}

/** Every active that can be sprayed today, for the spray screen's picker. */
export function usableActives(state) {
  return catalogue(state).filter((a) => canUse(state, a.id).ok);
}

// --- Adding to the catalogue ----------------------------------------------

const OWNER_RANK = ROLES.ceo.rank;

/**
 * FR-STOCK-09 — only the Owner adds an active, and never a banned one.
 *
 * Returns the event to dispatch rather than dispatching it, so the rule can be
 * tested without a store and so the screen decides when to file it.
 */
export function addActive(state, person, draft = {}) {
  const name = String(draft.name || '').trim();
  const group = String(draft.group || '').trim();

  if (roleRank(person) < OWNER_RANK) {
    return {
      ok: false,
      reason: 'not-owner',
      why: 'Only the Owner can add an active ingredient to the catalogue.',
      fix: 'Ask the Owner to add it, with the IRAC or FRAC group off the label.',
    };
  }
  if (!name) {
    return { ok: false, reason: 'no-name', why: 'An active ingredient needs a name.', fix: 'Type the active ingredient as the label spells it.' };
  }
  // Checked before anything else about the entry, so a banned active cannot be
  // reached by any route: not by a new name, not by a brand name, not at all.
  if (isBanned(name)) {
    return {
      ok: false,
      reason: 'banned',
      why: `${name} is banned on this farm and cannot be added to the catalogue.`,
      fix: `${bannedActives().join(', ')} will not be stocked, stored or sprayed here. `
        + 'For root-knot nematode, rotate to maize or marigold and solarise; that is the plan that works '
        + 'and does not poison whoever sprays it.',
    };
  }
  if (!group || /^none$/i.test(group)) {
    return {
      ok: false,
      reason: 'no-group',
      why: 'Any product without an IRAC or FRAC group on file cannot be selected for a treatment.',
      fix: 'Read the resistance group off the label (IRAC for insecticides, FRAC for fungicides) and enter it with the active.',
    };
  }
  const id = slug(name);
  if (activeById(id, state) || findActive(name, state)) {
    return { ok: false, reason: 'duplicate', why: `${name} is already in the catalogue.`, fix: 'Add a brand label against it instead.' };
  }

  return {
    ok: true,
    event: {
      type: 'active.add',
      payload: {
        id,
        name,
        type: draft.type || '',
        group,
        scheduleRate: draft.scheduleRate || null,
        phiDays: draft.phiDays == null || draft.phiDays === '' ? null : Number(draft.phiDays),
        addedBy: person.id,
        addedAt: new Date().toISOString(),
      },
    },
  };
}

const LABEL_RANK = ROLES.manager.rank;

/**
 * FR-STOCK-06 — the Farm Manager attaches a brand label to one or more actives.
 *
 * What the manager types is what is on the container in front of them. What
 * they do not type is the resistance group: that comes from the active, and a
 * new brand name therefore cannot restart a rotation.
 */
export function addLabel(state, person, draft = {}) {
  if (roleRank(person) < LABEL_RANK) {
    return {
      ok: false,
      reason: 'not-manager',
      why: 'Only the Farm Manager or the Owner can add a brand label.',
      fix: 'Hand the container to the Farm Manager with the label facing up.',
    };
  }

  const brand = String(draft.brand || '').trim();
  if (!brand) return { ok: false, reason: 'no-brand', why: 'A label needs the brand name printed on the container.', fix: 'Type the brand exactly as the container spells it.' };

  const activeIds = [...new Set((draft.activeIds || []).map((id) => slug(id)).filter(Boolean))];
  if (!activeIds.length) {
    return {
      ok: false,
      reason: 'no-active',
      why: 'A label has to name at least one active ingredient from the catalogue.',
      fix: 'Read the active ingredients off the label and pick them from the catalogue. The group fills in by itself.',
    };
  }
  // A banned active cannot be smuggled in behind a brand name either.
  if (isBanned(brand)) {
    return {
      ok: false,
      reason: 'banned',
      why: `${brand} is a banned product and cannot be entered as a label.`,
      fix: `${bannedActives().join(', ')} will not be stocked, stored or sprayed here.`,
    };
  }
  const unknown = activeIds.filter((id) => !activeById(id, state));
  if (unknown.length) {
    return {
      ok: false,
      reason: 'unknown-active',
      why: `The catalogue has no active called ${unknown.join(', ')}.`,
      fix: 'Pick the active from the catalogue. If it is genuinely missing, only the Owner can add it, with its group.',
    };
  }

  const num = (v) => (v == null || v === '' ? null : Number(v));
  return {
    ok: true,
    event: {
      type: 'label.add',
      payload: {
        id: draft.id || `lb_${slug(brand)}`,
        brand,
        activeIds,
        formulation: draft.formulation || '',
        concentration: draft.concentration || '',
        labelRate: draft.labelRate || '',
        // Blank is allowed and means "use the default" (FR-STOCK-07).
        phiDays: num(draft.phiDays),
        reiHours: num(draft.reiHours),
        photo: draft.photo || null,
        addedBy: person.id,
        addedAt: new Date().toISOString(),
      },
    },
  };
}

// --- The thrips programme (Build Rules §11d) -------------------------------

/**
 * The thrips rotation, by group.
 *
 * Thrips are the pest that carries tospovirus, and tospovirus is one of the
 * four named causes of Season 1. The programme is four groups rotated, never
 * the same one twice running, and an active without a rate does not count as an
 * option no matter which group it sits in.
 */
export function thripsProgramme(state = null) {
  const programme = section('thrips_program');
  return Object.entries(programme.options_by_group || {}).map(([group, text]) => {
    // "spinosad (preferred) or spinetoram" — the note in brackets belongs to
    // the name in front of it, which is the one to offer first.
    const parts = String(text).split(/,| or |\(|\)/).map((s) => s.trim()).filter(Boolean);
    const marked = parts.findIndex((p) => /^preferred$/i.test(p));
    const named = parts.filter((p) => !/^preferred$/i.test(p));
    const actives = [];
    for (const name of named) {
      const active = findActive(name, state);
      if (active && !actives.some((a) => a.id === active.id)) actives.push(active);
    }
    const first = marked > 0 ? findActive(parts[marked - 1], state) : null;
    return {
      group,
      text,
      actives,
      usable: state ? actives.filter((a) => canUse(state, a.id).ok) : actives,
      preferred: first || actives[0] || null,
    };
  });
}

/** Which groups may be used against thrips next, given the group used last. */
export function thripsOptions(state, lastGroup = null) {
  return thripsProgramme(state).filter((row) => !lastGroup || !sameGroup({ group: row.group }, { group: lastGroup }));
}

// --- The Week 10 rule (SR-08) ---------------------------------------------

/**
 * The organics named in SR-08 — the only things that go on the crop from
 * Week 10, read out of the rule itself rather than re-typed here.
 */
export function week10Names() {
  return derived('week10', (doc) => {
    const rule = ((doc.spray_rules || []).find((r) => r.id === 'SR-08') || {}).rule || '';
    const clause = rule.toLowerCase().split('organics only')[1] || '';
    return clause.split('.')[0].replace(/^[\s:–-]+/, '').split(',').map((s) => s.trim()).filter(Boolean);
  });
}

/** The catalogue rows those names point at. */
export function week10Actives(state = null) {
  const names = week10Names();
  return catalogue(state).filter((a) => names.some((n) => a.name.toLowerCase().includes(n)));
}

export function allowedInWeek10(active, state = null) {
  if (!active) return false;
  return week10Actives(state).some((a) => a.id === active.id);
}

// --- The named rotation sequences (Build Rules §6 and §7) ------------------

function sequenceFrom(key, groupField, systemLabel) {
  const block = section(key);
  return (block.sequence || []).map((step) => {
    const active = findActive(step.product);
    const group = `${systemLabel} ${String(step[groupField]).replace(/\s*\+\s*/g, ' + ')}`;
    return {
      order: step.order,
      product: step.product,
      activeId: active ? active.id : null,
      group,
      codes: parseGroup(group).codes,
      rate: step.rate || (active && active.scheduleRate) || null,
      time: step.time || null,
      targets: step.targets || step.controls || '',
      intervalDays: step.interval_days || null,
      note: step.note || '',
    };
  });
}

/** The IRAC sequence: 3A → 4A → 5 → 28, then restart at 3A. */
export function insecticideSequence() {
  return sequenceFrom('insecticide_rotation', 'irac', 'IRAC');
}

/** The FRAC sequence: M3 → M1 → 4+M3, then restart at M3. */
export function fungicideSequence() {
  return sequenceFrom('fungicide_rotation', 'frac', 'FRAC');
}

export function sequenceFor(system) {
  if (system === 'IRAC') return insecticideSequence();
  if (system === 'FRAC') return fungicideSequence();
  return [];
}

/**
 * The step that follows the group just used, wrapping round to the start —
 * "then: restart at 3A". This is what turns a refusal into an instruction.
 */
export function nextInSequence(system, lastGroup = null) {
  const steps = sequenceFor(system);
  if (!steps.length) return null;
  if (!lastGroup) return steps[0];
  const wanted = String(lastGroup).toUpperCase().replace(/\s+/g, ' ');
  const at = steps.findIndex((s) => s.group.toUpperCase() === wanted);
  const found = at >= 0 ? at : steps.findIndex((s) => sameGroup({ group: s.group }, { group: lastGroup }));
  if (found < 0) return steps[0];
  return steps[(found + 1) % steps.length];
}

// --- Migrating the old store onto actives ----------------------------------
//
// The store already holds items the farm bought before any of this existed,
// and sprays logged against them. None of that is thrown away or re-entered:
// each item is linked to the active it always was, and every stock movement,
// cost and spray that points at the item keeps pointing at it.

/** The active a store item is made of, whether linked explicitly or by name. */
export function activeForItem(state, item) {
  if (!item) return null;
  if (item.activeId) return activeById(item.activeId, state);
  return findActive(item.name, state);
}

/** The active a logged spray used, for the rotation check to read history. */
export function activeForSpray(state, spray) {
  if (!spray) return null;
  if (spray.activeId) return activeById(spray.activeId, state);
  const item = spray.itemId ? (state.inputs || {})[spray.itemId] : null;
  return (item && activeForItem(state, item))
    || findActive(spray.productName, state)
    || findActive(spray.productId, state);
}

/**
 * What linking the existing store would do, without doing it.
 *
 * `linked` is the items that resolve to exactly one active; `unmatched` is the
 * rest, which are shown to the Farm Manager to link by hand rather than guessed
 * at. Fertiliser, crates and twine are not chemicals and are left alone.
 */
export function migrationPlan(state) {
  const linked = [];
  const unmatched = [];
  for (const item of Object.values(state.inputs || {})) {
    if (item.activeId) continue;
    if (item.kind && item.kind !== 'chemical') continue;
    const active = findActive(item.name, state);
    if (active) linked.push({ itemId: item.id, name: item.name, activeId: active.id, active });
    else unmatched.push({ itemId: item.id, name: item.name });
  }
  return { linked, unmatched };
}

/**
 * The events that carry out the migration.
 *
 * Event ids are derived from the item, so the same link filed on five phones
 * lands exactly once, and a second run after a sync changes nothing.
 */
export function migrationEvents(state) {
  return migrationPlan(state).linked.map((row) => ({
    eventId: `mig_stock_${row.itemId}`,
    type: 'stock.link',
    payload: { itemId: row.itemId, activeId: row.activeId },
  }));
}
