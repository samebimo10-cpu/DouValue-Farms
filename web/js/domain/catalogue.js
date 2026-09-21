// The active-ingredient catalogue — FR-STOCK-05 to FR-STOCK-09, Build Rules 11d.
//
// A treatment is chosen by what is in the bottle, not by what is printed on it.
// Season 1 was sprayed by brand name: three products called Punch, Vanguish and
// Lion Seal went on the same crop, and nobody could say whether that was a
// rotation or the same chemical three times. A brand tells you nothing about
// resistance; the active ingredient and its IRAC/FRAC group tell you everything,
// and the rotation gate is built on those groups.
//
// So the catalogue is the twenty actives in the rules file, with their groups,
// and nothing else. Brands come back as *labels*: a manager attaches a brand to
// one or more actives, and the group fills itself in from the active. Nobody
// types a group by hand, which is what stops a guessed group from quietly
// defeating the rotation gate (decision C-6).
//
// Everything here reads rules/douvalue_rules_rev5_1.json. Every value carries a
// `source` pointer back into that file, so a refused spray can be traced to the
// rule that refused it.

import { can } from '../store.js';
import { getRules, ref } from './rules.js';

// --- Names and ids ---------------------------------------------------------

/** A stable id for an active, derived from its name so two phones agree. */
export function slug(name) {
  return String(name || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The other names one active answers to.
 *
 * Nothing is invented: the rules file's own wording is split on its own
 * punctuation. "Azadirachtin / neem oil" is one active under two names on the
 * shelf; "Bacillus thuringiensis (Bt)" carries its short form in brackets. A
 * bracket that says where something came from rather than what it is called —
 * "(farm-made)" — is not a name, so it is left out.
 */
export function aliasesFor(name) {
  const out = new Set([norm(name)]);
  const outside = norm(String(name).replace(/\(.*?\)/g, ' '));
  if (outside) out.add(outside);
  for (const m of String(name).matchAll(/\((.*?)\)/g)) {
    const inside = norm(m[1]);
    if (inside && !inside.includes('farm-made')) out.add(inside);
  }
  for (const part of String(name).split('/')) {
    const p = norm(part.replace(/\(.*?\)/g, ' '));
    if (p) out.add(p);
  }
  return [...out].filter((a) => a.length >= 2);
}

// --- Resistance groups -----------------------------------------------------

/**
 * Multi-site protectants are written M1/M2/M3 in the rules and M01/M02/M03 on
 * some labels and in the older product table. Same group, and the rotation
 * check has to see it that way or Mancozeb would rotate with itself.
 */
export function normaliseCode(code) {
  const c = String(code || '').toUpperCase().replace(/\s+/g, '');
  return /^M0\d+$/.test(c) ? c.replace(/^M0+/, 'M') : c;
}

/**
 * Read "IRAC 3A", "FRAC 4 + M3", "BM02" or "none" into something comparable.
 *
 * `rotates` is false for the two entries the rules record as *not* a resistance
 * group: "none" (farm-made garlic-chilli) and IRAC UN, which is the code for an
 * unknown mode of action rather than a group you can rotate out of. Treating UN
 * as a group would make the Week 10 organics programme impossible to obey —
 * from Week 10 neem is one of only three products allowed, and it is meant to
 * be repeated every 5-7 days.
 */
export function parseGroup(group) {
  const text = String(group || '').trim();
  if (!text || norm(text) === 'none') return { text: text || 'none', system: null, codes: [], rotates: false };
  const m = /^(IRAC|FRAC)\b/i.exec(text);
  const system = m ? m[1].toUpperCase() : (/^BM\d/i.test(text) ? 'FRAC' : null);
  const codes = text.replace(/^(IRAC|FRAC)\b/i, '')
    .split('+').map((c) => normaliseCode(c)).filter(Boolean);
  const rotates = codes.length > 0 && !codes.every((c) => c === 'UN' || c === 'NC');
  return { text, system, codes, rotates };
}

/** Do two actives share a resistance group? "FRAC 4 + M3" shares M3 with Mancozeb. */
export function sameGroup(a, b) {
  if (!a || !b || !a.rotates || !b.rotates) return false;
  if (a.system && b.system && a.system !== b.system) return false;
  return a.codes.some((c) => b.codes.includes(c));
}

// --- PHI and REI defaults (FR-STOCK-07, rules §9) --------------------------

const HOURS = (s) => {
  const m = /(\d+)\s*h/i.exec(String(s || ''));
  return m ? Number(m[1]) : null;
};

/**
 * The default waiting periods, read out of the rules `phi` table.
 *
 * The table is keyed by product prose ("Cypermethrin, Thiamethoxam,
 * Chlorantraniliprole"), so an active matches an entry when the entry names it.
 * The last row — "Any other synthetic" — is the catch-all, and it is what makes
 * a blank label safe: 14 days before picking, 24 hours before anyone goes back
 * in, until somebody enters the real figures off the container.
 */
export function defaultIntervals(active, rules = getRules()) {
  const rows = rules.phi || [];
  const name = norm(active.name);
  let fallback = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const products = norm(row.product);
    if (/any other/.test(products)) { fallback = { row, i }; continue; }
    // A row names several products in one string ("Garlic-chilli, Neem oil,
    // Trichoderma"), each in shorter form than the catalogue name, so the row
    // name has to be looked for inside the active rather than the other way.
    const named = products.split(/[,;]/).map((s2) => norm(s2.replace(/\(.*?\)/g, ' ')))
      .filter((s2) => s2.length >= 3);
    if (named.some((n) => name.includes(n) || aliasesFor(active.name).includes(n))) {
      return {
        phiDays: Number(row.phi_days) || 0,
        reiHours: HOURS(row.rei_default) ?? 24,
        exportBufferDays: row.export_buffer_days ?? null,
        source: ref(`phi/${i}`),
      };
    }
  }
  const row = fallback ? fallback.row : {};
  return {
    phiDays: Number.isFinite(Number(row.phi_days)) ? Number(row.phi_days) : 14,
    reiHours: HOURS(row.rei_default) ?? 24,
    exportBufferDays: row.export_buffer_days ?? null,
    source: fallback ? ref(`phi/${fallback.i}`) : ref('phi'),
  };
}

// --- The catalogue ---------------------------------------------------------

function activeFromRules(entry, i, rules) {
  const group = parseGroup(entry.group);
  const base = {
    id: slug(entry.ai),
    name: entry.ai,
    type: entry.type || '',
    group: entry.group,
    groupSystem: group.system,
    groupCodes: group.codes,
    rotates: group.rotates,
    scheduleRate: entry.schedule_rate || null,
    aliases: aliasesFor(entry.ai),
    addedBy: null,
    source: ref(`active_ingredients/${i}`),
    groupSource: ref(`active_ingredients/${i}/group`),
  };
  const defaults = defaultIntervals(base, rules);
  return {
    ...base,
    // An active carrying its own phi_days in the rules overrides the table:
    // that is the rules being specific about this one product.
    phiDays: entry.phi_days != null ? Number(entry.phi_days) : defaults.phiDays,
    phiSource: entry.phi_days != null ? ref(`active_ingredients/${i}/phi_days`) : defaults.source,
    reiHours: defaults.reiHours,
    reiSource: defaults.source,
    exportBufferDays: defaults.exportBufferDays,
  };
}

/** The banned actives, as the rules name them. Never in the catalogue at all. */
export function bannedNames(rules = getRules()) {
  return ((rules.labels || {}).banned || []).map(String);
}

/**
 * FR-STOCK-09 — is this a banned active?
 *
 * The rules write it "Carbofuran (Furadan)", one entry naming both the active
 * and the brand it is sold under here, so both have to be refused. A ban that
 * only catches the word the buyer does not use is not a ban.
 */
export function isBanned(name, rules = getRules()) {
  const text = norm(name).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return false;
  for (const entry of bannedNames(rules)) {
    // Whole names, not loose words: "Carbofuran" and "Furadan" each ban a
    // container, where a bare word like "oil" from some future entry would ban
    // half the store.
    for (const alias of aliasesFor(entry)) {
      const phrase = alias.replace(/[^a-z0-9]+/g, ' ').trim();
      if (!phrase) continue;
      if (new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)) return true;
    }
  }
  return false;
}

/**
 * Build the catalogue: the twenty actives from the rules, plus any the Owner
 * has added since, plus the brand labels managers have attached to them.
 *
 * A banned active is filtered out at the last moment as well as refused at the
 * door, so that even a log that somehow carries one — a bad merge, an older
 * build — cannot put it back on a spray screen.
 */
export function buildCatalogue(state = {}, rules = getRules()) {
  const actives = (rules.active_ingredients || [])
    .map((entry, i) => activeFromRules(entry, i, rules))
    .filter((a) => !isBanned(a.name, rules));

  for (const added of Object.values(state.actives || {})) {
    if (isBanned(added.name || added.ai, rules)) continue;
    const group = parseGroup(added.group);
    if (!group.text || !added.group) continue;   // no group on file, no catalogue entry
    const name = added.name || added.ai;
    const base = {
      id: added.id || slug(name),
      name,
      type: added.type || '',
      group: added.group,
      groupSystem: group.system,
      groupCodes: group.codes,
      rotates: group.rotates,
      scheduleRate: added.scheduleRate || null,
      aliases: aliasesFor(name),
      addedBy: added.by || added.addedBy || null,
      addedAt: added.at || null,
      source: 'farm record: active.add',
      groupSource: 'farm record: active.add (Owner, with its group)',
    };
    const defaults = defaultIntervals(base, rules);
    const already = actives.findIndex((a) => a.id === base.id);
    const entry = { ...base, phiDays: defaults.phiDays, phiSource: defaults.source,
      reiHours: defaults.reiHours, reiSource: defaults.source,
      exportBufferDays: defaults.exportBufferDays };
    if (already >= 0) actives[already] = { ...actives[already], ...entry };
    else actives.push(entry);
  }

  const byId = Object.fromEntries(actives.map((a) => [a.id, a]));
  const labels = Object.values(state.labels || {})
    .filter((l) => !l.retired)
    .map((l) => normaliseLabel(l, byId, rules))
    .filter((l) => l.activeIds.length);

  for (const label of labels) {
    for (const id of label.activeIds) if (byId[id]) (byId[id].labels = byId[id].labels || []).push(label);
  }
  for (const a of actives) a.labels = a.labels || [];

  return { actives, byId, labels, rules, banned: bannedNames(rules) };
}

/**
 * FR-STOCK-06 — a brand label, with the group filled in from its actives.
 *
 * FR-STOCK-07 is the sharp bit: a blank PHI or REI takes the default, and an
 * entered value is used *only if it is longer*. A label that claims a shorter
 * waiting period than the rules' default does not shorten it — that is how a
 * cheap re-labelled container would otherwise talk the app into clearing fruit
 * a week early.
 */
export function normaliseLabel(label, byId, rules = getRules()) {
  const activeIds = (label.activeIds || []).filter((id) => byId[id]);
  const actives = activeIds.map((id) => byId[id]);
  const defaultPhi = Math.max(0, ...actives.map((a) => a.phiDays || 0), 0);
  const defaultRei = Math.max(0, ...actives.map((a) => a.reiHours || 0), 0) || 24;
  const entered = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const phiEntered = entered(label.phiDays);
  const reiEntered = entered(label.reiHours);
  return {
    ...label,
    activeIds,
    groups: [...new Set(actives.map((a) => a.group))],
    phiDays: phiEntered != null && phiEntered > defaultPhi ? phiEntered : defaultPhi,
    phiIsDefault: !(phiEntered != null && phiEntered > defaultPhi),
    phiEntered,
    reiHours: reiEntered != null && reiEntered > defaultRei ? reiEntered : defaultRei,
    reiIsDefault: !(reiEntered != null && reiEntered > defaultRei),
    reiEntered,
    rateSource: ref('labels/rate_rule'),
    defaultsSource: ref('rei/rule'),
  };
}

// --- Rate, and what may be used (FR-STOCK-08) ------------------------------

/**
 * Where the dose comes from: the schedule rate for the active, or a rate off a
 * label somebody has entered. If there is neither, the product cannot be used.
 *
 * This is not a warning. An invented dose is how a crop gets burnt and how a
 * residue test gets failed, and the Farm Doctor is forbidden from guessing one
 * (rules farm_doctor.never). So the answer is "no", with the fix attached.
 */
export function statedRate(text) {
  const t = String(text || '').trim();
  // "per label" and "see prep table" are pointers, not doses. The rules forbid
  // inventing a dose, so an active whose schedule points elsewhere needs the
  // label entering before anybody can mix it.
  return /\d/.test(t) ? t : null;
}

export function rateFor(catalogue, activeId) {
  const active = catalogue.byId[activeId];
  if (!active) return { ok: false, reason: 'unknown-active', rate: null };
  const scheduled = statedRate(active.scheduleRate);
  if (scheduled) {
    return { ok: true, rate: scheduled, from: 'schedule', source: active.source };
  }
  const labelled = (active.labels || []).find((l) => statedRate(l.rate));
  if (labelled) {
    return { ok: true, rate: labelled.rate, from: 'label', label: labelled, source: 'farm record: label.add' };
  }
  return { ok: false, reason: 'no-rate', rate: null, scheduleSays: active.scheduleRate || null,
    source: ref('labels/rate_rule') };
}

/** FR-STOCK-08 — may this active be chosen at all? */
export function canUseActive(catalogue, activeId) {
  const active = catalogue.byId[activeId];
  if (!active) {
    return { ok: false, reason: 'unknown-active', why: 'That product is not in the catalogue.',
      fix: 'Treatments are chosen by active ingredient. Pick one from the catalogue, or ask the Owner to add it.' };
  }
  const rate = rateFor(catalogue, activeId);
  if (!rate.ok) {
    return {
      ok: false, reason: 'no-rate', active,
      why: `${active.name} has no rate: the schedule does not give one${rate.scheduleSays
        ? ` (it says "${rate.scheduleSays}")` : ''} and no label has been entered.`,
      fix: 'The Farm Manager adds a brand label for it — brand, formulation, concentration and the rate off '
        + 'the container — and then it can be used.',
      source: rate.source,
    };
  }
  return { ok: true, active, rate };
}

/** What the spray screen may offer, in catalogue order. */
export function usableActives(catalogue) {
  return catalogue.actives.filter((a) => canUseActive(catalogue, a.id).ok);
}

// --- Adding to the catalogue ----------------------------------------------

/**
 * FR-STOCK-09 — only the Owner adds an active, and must give its group.
 *
 * Three refusals, in the order that matters. Banned first: carbofuran is not a
 * permissions question, and no role on this farm may add it. Then authority.
 * Then the group, because an active with no group cannot be rotated and the
 * rules say a product without one cannot be selected at all (product_rule).
 */
export function checkAddActive(person, draft, catalogue) {
  const rules = catalogue.rules;
  const name = String((draft && (draft.name || draft.ai)) || '').trim();

  if (!name) return { ok: false, reason: 'no-name', why: 'Give the active ingredient a name.' };

  if (isBanned(name, rules)) {
    return {
      ok: false, reason: 'banned',
      why: `${name} is banned on this farm and cannot be added by anybody, including the Owner.`,
      fix: 'It is not stocked, not sprayed and not listed. For root-knot nematode the rules give rotation '
        + 'with maize or marigold, neem cake and clean topsoil.',
      source: ref('labels/banned'),
    };
  }

  if (!can(person, 'manageOwners')) {
    return {
      ok: false, reason: 'not-owner',
      why: 'Only the Owner can add an active ingredient to the catalogue.',
      fix: 'Send the label photo to the Owner. Meanwhile a brand label can be attached to an active that '
        + 'is already in the catalogue.',
      source: ref('labels/new_active'),
    };
  }

  const group = parseGroup(draft.group);
  if (!draft.group || !group.codes.length) {
    return {
      ok: false, reason: 'no-group',
      why: `${name} has no IRAC or FRAC group, so the rotation gate could not see it.`,
      fix: 'The group is printed on the label, usually in a box at the top. Enter it as it appears, '
        + 'for example "IRAC 4A" or "FRAC M3".',
      source: ref('product_rule'),
    };
  }

  if (catalogue.byId[slug(name)]) {
    return { ok: false, reason: 'duplicate', why: `${name} is already in the catalogue.` };
  }

  return {
    ok: true,
    payload: {
      id: slug(name), name, group: draft.group, type: draft.type || '',
      scheduleRate: draft.scheduleRate || null,
    },
  };
}

/**
 * FR-STOCK-06 — the Farm Manager attaches a brand label to one or more actives.
 *
 * The manager never types a group. It comes from the active, which is the whole
 * point of C-18: a brand cannot mislead the rotation gate if the brand is not
 * what the gate reads.
 */
export function checkAddLabel(person, draft, catalogue) {
  if (!can(person, 'settings')) {
    return { ok: false, reason: 'not-manager', why: 'Only the Farm Manager or the Owner can add a brand label.' };
  }
  const brand = String((draft && draft.brand) || '').trim();
  if (!brand) return { ok: false, reason: 'no-brand', why: 'Enter the brand name printed on the container.' };

  if (isBanned(brand, catalogue.rules)) {
    return { ok: false, reason: 'banned', why: `${brand} is a banned product and cannot be entered.`,
      source: ref('labels/banned') };
  }

  const activeIds = (draft.activeIds || []).filter(Boolean);
  const unknown = activeIds.filter((id) => !catalogue.byId[id]);
  if (!activeIds.length) {
    return {
      ok: false, reason: 'no-active',
      why: 'Choose the active ingredient or ingredients this brand contains.',
      fix: 'It is on the label, usually under "Active ingredient" or "Composition". If it is not in the '
        + 'catalogue, the Owner adds it first, with its group.',
      source: ref('labels/manager_adds_label'),
    };
  }
  if (unknown.length) {
    return { ok: false, reason: 'unknown-active', why: `Not in the catalogue: ${unknown.join(', ')}.` };
  }

  return {
    ok: true,
    payload: {
      id: draft.id || `lbl_${slug(brand)}`,
      brand,
      activeIds,
      formulation: draft.formulation || '',
      concentration: draft.concentration || '',
      rate: draft.rate || '',
      phiDays: draft.phiDays === '' || draft.phiDays == null ? null : Number(draft.phiDays),
      reiHours: draft.reiHours === '' || draft.reiHours == null ? null : Number(draft.reiHours),
      photo: draft.photo || null,
    },
  };
}

// --- Reading a record back -------------------------------------------------

/**
 * The legacy product table's ids, mapped onto the catalogue.
 *
 * Before the catalogue, sprays were logged against a hard-coded product list.
 * Those records are the farm's history: nothing rewrites them, so the reading
 * side has to understand both. This map is the whole of the difference.
 */
export const LEGACY_PRODUCT_IDS = {
  mancozeb: 'mancozeb',
  copper_oxychloride: 'copper_oxychloride',
  metalaxyl_mancozeb: 'metalaxyl_m_mancozeb',
  sulphur: 'sulphur',
  bt: 'bacillus_thuringiensis',
  neem: 'azadirachtin_neem_oil',
  spinosad: 'spinosad',
  emamectin: 'emamectin_benzoate',
  abamectin: 'abamectin',
  acetamiprid: 'acetamiprid',
  imidacloprid: 'imidacloprid',
  lambda_cyhalothrin: 'lambda_cyhalothrin',
  cypermethrin: 'cypermethrin',
};

/** Find an active by id, legacy product id, or the name on a store item. */
export function resolveActive(catalogue, reference) {
  if (!reference) return null;
  const raw = String(reference);
  if (catalogue.byId[raw]) return catalogue.byId[raw];
  const legacy = LEGACY_PRODUCT_IDS[raw];
  if (legacy && catalogue.byId[legacy]) return catalogue.byId[legacy];

  // A store item is named the way the shop names it: "Mancozeb 80% WP",
  // "Copper Oxychloride 50WP". Strip the formulation and match on the active.
  const flatten = (s) => norm(s)
    .replace(/\b\d+(\.\d+)?\s*%/g, ' ')
    .replace(/\b\d+\s*(wp|wg|sc|ec|sl|wdg|g\/l)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = flatten(raw);
  if (!text) return null;

  // Longest alias found inside the name wins: "Copper oxychloride 50WP" must
  // not settle for "copper".
  let best = null;
  for (const active of catalogue.actives) {
    for (const alias of active.aliases.map(flatten)) {
      if (!alias) continue;
      const pattern = new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
      if (pattern.test(text) && (!best || alias.length > best.alias.length)) best = { active, alias };
    }
  }
  if (best) return best.active;

  // The other direction: the rules and the field both use short forms —
  // "garlic-chilli" for "Garlic-chilli extract (farm-made)". Accepted only when
  // exactly one active answers to it, so a bare "copper" stays ambiguous and
  // resolves to nothing rather than to the wrong one.
  const partial = catalogue.actives.filter((a) => a.aliases
    .map(flatten).some((alias) => alias.startsWith(`${text} `) || alias === text));
  return partial.length === 1 ? partial[0] : null;
}

/**
 * The resistance group behind a recorded spray.
 *
 * Catalogue first. A spray from before the catalogue whose product never made
 * it in — azoxystrobin, difenoconazole — still has to count against the
 * rotation, so its group comes off the record itself. Forgetting it would let
 * the same group through twice, which is the one thing the gate exists to stop.
 */
export function groupOfSpray(catalogue, spray) {
  const active = resolveActive(catalogue, spray.activeId || spray.productId || spray.productName);
  if (active) return { group: parseGroup(active.group), active, source: active.groupSource };
  if (spray.group) return { group: parseGroup(spray.group), active: null, source: 'the spray record' };
  return { group: parseGroup(null), active: null, source: null };
}

// --- Migrating the store onto actives --------------------------------------

/**
 * Plan the migration of existing stock items onto actives.
 *
 * Nothing is deleted and nothing is rewritten — the log is append-only, so the
 * migration is one `input.upsert` per item carrying the active it turned out to
 * be. Past treatments are not touched at all: they are read through
 * `resolveActive`, so the count of treatments before and after is necessarily
 * the same number, and the plan reports it so that can be checked rather than
 * believed.
 */
export function planStockMigration(state, catalogue) {
  const items = Object.values(state.inputs || {});
  const rows = items.map((item) => {
    const existing = item.activeId && catalogue.byId[item.activeId] ? catalogue.byId[item.activeId] : null;
    const match = existing || resolveActive(catalogue, item.name);
    return {
      itemId: item.id,
      name: item.name,
      kind: item.kind || '',
      activeId: match ? match.id : null,
      active: match,
      group: match ? match.group : null,
      already: !!existing,
      // Fertiliser, seed and crates are not chemicals and have no active.
      // Saying so is part of the report: an unmatched *chemical* is the one
      // that needs a person.
      chemical: (item.kind || '') === 'chemical',
    };
  });

  const treatments = (state.sprays || []);
  const resolved = treatments.filter((s) => !!groupOfSpray(catalogue, s).active);

  return {
    items: rows,
    matched: rows.filter((r) => r.activeId && !r.already),
    alreadyDone: rows.filter((r) => r.already),
    unmatchedChemicals: rows.filter((r) => r.chemical && !r.activeId),
    treatmentsBefore: treatments.length,
    treatmentsAfter: treatments.length,
    treatmentsResolved: resolved.length,
    treatmentsUnresolved: treatments.length - resolved.length,
  };
}

/**
 * The events that carry out the plan.
 *
 * Each one has a fixed id, so five phones running the migration produce the
 * same five events and the merge is a no-op. Running it twice changes nothing.
 */
export function migrationEvents(plan) {
  return plan.matched.map((row) => ({
    type: 'input.upsert',
    payload: { id: row.itemId, activeId: row.activeId },
    eventId: `ev_mig_active_${row.itemId}`,
  }));
}

/** Run it. Returns the plan, with what was written. */
export async function migrateStockToActives(store, catalogue) {
  const plan = planStockMigration(store.state, catalogue);
  const events = migrationEvents(plan);
  if (events.length) {
    for (const e of events) await store.dispatch(e.type, e.payload, { eventId: e.eventId });
  }
  return { ...plan, written: events.length };
}
