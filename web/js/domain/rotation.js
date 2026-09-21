// Rotation by resistance group — FR-GATE-05, Build Rules §6, §7 and SR-08.
//
// The old check counted how often one product had been used. That was the wrong
// unit: cypermethrin and lambda-cyhalothrin are two products and one group, and
// alternating them is not a rotation, it is the same spray twice with a
// different label. So the check now reads groups, and it reads them out of
// rules/douvalue_rules_rev5_1.json — the named IRAC sequence (3A → 4A → 5 → 28,
// then restart), the named FRAC sequence (M3 → M1 → 4+M3, then restart), the
// thrips programme by group, and the Week 10 organics-only rule with its one
// exception for repeated M1.
//
// Every verdict carries `sources`: the exact pointers into the rules file that
// produced it. A hand who is refused a product can be shown the line, and a
// manager who disagrees can argue with the rules rather than with the app.

import { daysBetween, isoDate } from '../util.js';
import { getRules, ref } from './rules.js';
import { buildCatalogue, canUseActive, parseGroup, resolveActive, sameGroup, groupOfSpray } from './catalogue.js';

const norm = (s) => String(s || '').toLowerCase();

/**
 * Which week the crop is in — rules week_counting.
 *
 * "Transplant day = T = Day 1 of Week 0. week = floor((date - T) / 7)."
 */
export function cropWeek(cycle, today = isoDate()) {
  if (!cycle || !cycle.transplantDate) return null;
  const days = daysBetween(cycle.transplantDate, today);
  if (days < 0) return null;
  return Math.floor(days / 7);
}

export const WEEK_10 = 10;

/**
 * The organics SR-08 allows from Week 10 — read off the rule text itself.
 *
 * The rule reads: "From Week 10 (both crops): organics only - neem oil,
 * garlic-chilli, Copper Hydroxide. No synthetic insecticide within 14 days..."
 * so the list is what stands between "organics only" and the full stop. Taking
 * it from the text rather than retyping it here means the app cannot drift from
 * the rules when the rules change.
 */
export function week10Actives(catalogue, rules = getRules()) {
  const rows = rules.spray_rules || [];
  const i = rows.findIndex((r) => r.id === 'SR-08');
  const text = norm(i >= 0 ? rows[i].rule : '');
  const after = text.split('organics only')[1] || '';
  const named = after.split('.')[0].replace(/^[\s:\-–]+/, '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const actives = [];
  for (const name of named) {
    const active = resolveActive(catalogue, name);
    if (active && !actives.includes(active)) actives.push(active);
  }
  return { actives, named, source: ref(`spray_rules/${i >= 0 ? i : ''}`) };
}

/** The named sequence for a system, as ordered group codes. */
export function sequenceFor(system, rules = getRules()) {
  const key = system === 'FRAC' ? 'fungicide_rotation' : 'insecticide_rotation';
  const block = rules[key] || {};
  const steps = (block.sequence || []).map((step, i) => ({
    order: step.order ?? i + 1,
    product: step.product,
    group: parseGroup(`${system} ${system === 'FRAC' ? step.frac : step.irac}`),
    source: ref(`${key}/sequence/${i}`),
  }));
  return { key, steps, rule: block.rule || '', then: block.then || '', source: ref(`${key}/rule`) };
}

/** The step after the one last used, so a refusal can say what to use instead. */
export function nextInSequence(system, lastCodes, rules = getRules()) {
  const seq = sequenceFor(system, rules);
  if (!seq.steps.length) return null;
  const at = seq.steps.findIndex((s) => s.group.codes.some((c) => (lastCodes || []).includes(c)));
  return seq.steps[(at + 1) % seq.steps.length] || seq.steps[0];
}

/** The thrips programme — rotate by group, never the same group twice running. */
export function thripsProgramme(catalogue, rules = getRules()) {
  const block = rules.thrips_program || {};
  const options = Object.entries(block.options_by_group || {}).map(([group, text], i) => ({
    group: parseGroup(group),
    groupText: group,
    text,
    // The rules name the products for each group ("spinosad (preferred) or
    // spinetoram"), so the programme offers those, not every active that
    // happens to share the group.
    actives: namedIn(text, catalogue.actives.filter((a) => sameGroup(parseGroup(a.group), parseGroup(group)))),
    source: ref(`thrips_program/options_by_group/${i}`),
  }));
  return { rule: block.rule || '', note: block.note || '', options, source: ref('thrips_program/rule') };
}

/** The actives a rule names by name, or all of them if it names none. */
function namedIn(text, actives) {
  const hit = actives.filter((a) => a.aliases.some((alias) => norm(text).includes(alias)));
  return hit.length ? hit : actives;
}

const isThrips = (target) => /thrips/.test(norm(target));

/** Wound-care copper is logged, but the rules exclude it from the FRAC count. */
const countsForRotation = (spray) => !/wound/.test(norm(spray.purpose || spray.targetProblem || ''));

/**
 * The sprays already on this zone that the rotation has to reckon with, newest
 * first, in the same resistance system as the product being considered.
 */
export function priorSprays(state, cycleId, system, catalogue, today = isoDate()) {
  return (state.sprays || [])
    .filter((s) => s.cycleId === cycleId)
    .filter((s) => s.date && s.date <= today)
    .filter(countsForRotation)
    .map((s) => ({ spray: s, ...groupOfSpray(catalogue, s) }))
    .filter((r) => r.group.rotates && (!system || r.group.system === system))
    .sort((a, b) => (a.spray.date < b.spray.date ? 1 : -1));
}

/**
 * The rotation verdict.
 *
 * Order matters, and it is the order of consequence: a product nobody can dose
 * is refused before anything else, Week 10 outranks the rotation because it is
 * about residue on fruit that is being picked now, and the group check comes
 * last because it is about next season.
 */
export function rotationVerdict(state, cycleId, productRef, opts = {}) {
  const rules = opts.rules || getRules();
  const catalogue = opts.catalogue || buildCatalogue(state, rules);
  const today = opts.today || isoDate();
  const sources = [];

  if (!productRef) return { ok: true, sources };

  const active = resolveActive(catalogue, productRef);
  if (!active) {
    return {
      ok: false, reason: 'not-in-catalogue',
      why: `${productRef} is not in the active-ingredient catalogue, so it has no IRAC or FRAC group on file.`,
      fix: 'Treatments are chosen by active ingredient. Pick one from the catalogue; the Owner adds a new '
        + 'active, with its group.',
      sources: [ref('product_rule')],
    };
  }
  sources.push(active.groupSource);

  // FR-STOCK-08 — no schedule rate and no label rate means no dose, and an
  // invented dose is worse than no spray.
  const usable = canUseActive(catalogue, active.id);
  if (!usable.ok) return { ...usable, active, sources: [...sources, usable.source].filter(Boolean) };

  const group = parseGroup(active.group);
  const cycle = (state.cycles || {})[cycleId];
  const week = opts.week != null ? opts.week : cropWeek(cycle, today);

  // SR-08 / rei.week_10_rule — from Week 10 the crop is being picked, so only
  // the three organics may go on it. This is a residue rule, not a resistance
  // rule, and it outranks everything below.
  if (week != null && week >= WEEK_10) {
    const allowed = week10Actives(catalogue, rules);
    sources.push(allowed.source, ref('rei/week_10_rule'));
    if (!allowed.actives.some((a) => a.id === active.id)) {
      return {
        ok: false, reason: 'week-10', active, week, sources,
        why: `The crop is in Week ${week}, and from Week 10 the rules allow organics only: `
          + `${allowed.actives.map((a) => a.name).join(', ')}.`,
        fix: `${active.name} is not one of them. Picking is under way, and a synthetic now puts residue on `
          + 'fruit that is already going to market.',
        alternatives: allowed.actives.filter((a) => canUseActive(catalogue, a.id).ok).map((a) => a.name),
      };
    }
  }

  // The thrips programme is by group: the rules name which groups may be used
  // against thrips at all, and neither 3A nor anything outside that list is in
  // it. A pyrethroid on thrips is how Season 1 was lost.
  const target = opts.target || (opts.diagnosis && (opts.diagnosis.problemId || opts.diagnosis.problemName));
  if (isThrips(target) && group.rotates) {
    const programme = thripsProgramme(catalogue, rules);
    sources.push(programme.source);
    const inProgramme = programme.options.some((o) => sameGroup(o.group, group));
    if (!inProgramme) {
      const offered = programme.options
        .flatMap((o) => o.actives.filter((a) => canUseActive(catalogue, a.id).ok)
          .map((a) => `${a.name} (${a.group})`));
      return {
        ok: false, reason: 'thrips-programme', active, group: active.group, sources,
        why: `${active.name} is ${active.group}, and that group is not in the thrips programme.`,
        fix: offered.length
          ? `The programme rotates ${programme.options.map((o) => o.groupText).join(', ')}. Ready to use: ${offered.join(', ')}.`
          : `The programme rotates ${programme.options.map((o) => o.groupText).join(', ')}, but none of those `
            + 'has a rate yet — enter a label first.',
        alternatives: offered,
      };
    }
  }

  if (!group.rotates) {
    // "none" and IRAC UN are not resistance groups: garlic-chilli and neem are
    // meant to be repeated, and the Week 10 programme depends on it.
    return { ok: true, active, group: active.group, sources };
  }

  const prior = priorSprays(state, cycleId, group.system, catalogue, today);
  const last = prior[0];

  // The one exception in the rules: from Week 10, Copper Hydroxide is the only
  // PHI-0 fungicide, so repeated M1 is allowed — at the sequence's own 10-14
  // day interval, not back to back.
  const m1Repeat = week != null && week >= WEEK_10 && group.system === 'FRAC'
    && group.codes.length === 1 && group.codes[0] === 'M1';

  if (last && sameGroup(last.group, group)) {
    const seq = sequenceFor(group.system, rules);
    sources.push(seq.source);
    if (m1Repeat) {
      sources.push(ref('fungicide_rotation/week_10_exception'));
      const gap = daysBetween(last.spray.date, today);
      if (gap < 10) {
        return {
          ok: false, reason: 'interval', active, group: active.group, week, sources,
          why: `Repeated M1 is allowed from Week 10, but at 10-14 day intervals. The last M1 on this zone `
            + `was ${gap} day${gap === 1 ? '' : 's'} ago.`,
          fix: `Wait until ${addDaysIso(last.spray.date, 10)}.`,
          lastSpray: last.spray,
        };
      }
      return { ok: true, active, group: active.group, week, exception: 'week-10-m1', sources };
    }
    const next = nextInSequence(group.system, group.codes, rules);
    const alternatives = next
      ? catalogue.actives.filter((a) => sameGroup(parseGroup(a.group), next.group))
        .filter((a) => canUseActive(catalogue, a.id).ok).map((a) => a.name)
      : [];
    return {
      ok: false, reason: 'rotation', active, group: active.group, sources,
      why: `${sentence(seq.rule)} ${last.active ? last.active.name : last.spray.productName || 'The last spray'} `
        + `on ${last.spray.date} was ${last.group.text}, and ${active.name} is ${active.group}.`,
      fix: next
        ? `The sequence says ${next.product} next.${alternatives.length
          ? ` Ready to use: ${alternatives.join(' or ')}.` : ''}`
        : 'Use a product from a different group this time.',
      alternatives: alternatives.length ? alternatives : (next ? [next.product] : []),
      lastSpray: last.spray,
      nextInSequence: next ? next.product : null,
    };
  }

  // "Metalaxyl-M only in rotation, max every 3rd" — the one product the rules
  // single out, because it is the only systemic Phytophthora product the farm
  // has and losing it to resistance would cost a whole wet season.
  if (/metalaxyl/i.test(active.name)) {
    sources.push(ref('fungicide_rotation/rule'), ref('mixing_rules/5'));
    const recent = prior.slice(0, 2).find((r) => r.active && /metalaxyl/i.test(r.active.name));
    if (recent) {
      return {
        ok: false, reason: 'metalaxyl-interval', active, sources,
        why: `Metalaxyl-M is allowed in rotation only, at most every third fungicide. It was used on this `
          + `zone on ${recent.spray.date}, ${prior.indexOf(recent) + 1} spray${prior.indexOf(recent) ? 's' : ''} ago.`,
        fix: 'Put Mancozeb (M3) and Copper Oxychloride (M1) through first.',
        lastSpray: recent.spray,
      };
    }
  }

  return { ok: true, active, group: active.group, week, sources };
}

/** The rules are written as clauses ("never the same FRAC group twice in a row;
 * Metalaxyl-M only in rotation"). A refusal quotes the clause that applies. */
function sentence(rule) {
  const first = String(rule || '').split(';')[0].trim();
  return first ? `${first[0].toUpperCase()}${first.slice(1)}.` : '';
}

/**
 * Where a resistance group is being leaned on across the whole farm.
 *
 * The rotation gate works per zone, because resistance builds in one
 * population. This is the other view, for the Owner's digest: one group going
 * on bed after bed is the farm buying itself a resistant population the slow
 * way, and no single zone's gate would ever see it.
 */
export function groupUsage(state, { rules = getRules(), catalogue = null, withinDays = 60,
  today = isoDate(), threshold = 3 } = {}) {
  const cat = catalogue || buildCatalogue(state, rules);
  const byGroup = new Map();

  for (const spray of state.sprays || []) {
    if (!spray.date || daysBetween(spray.date, today) > withinDays) continue;
    if (!countsForRotation(spray)) continue;
    const { group, active } = groupOfSpray(cat, spray);
    if (!group.rotates) continue;
    const key = group.text;
    const entry = byGroup.get(key) || { group: key, system: group.system, uses: [], products: new Set() };
    entry.uses.push({ date: spray.date, cycleId: spray.cycleId });
    entry.products.add(active ? active.name : (spray.productName || spray.productId));
    byGroup.set(key, entry);
  }

  return [...byGroup.values()]
    .filter((e) => e.uses.length >= threshold)
    .map((e) => {
      const next = nextInSequence(e.system, parseGroup(e.group).codes, rules);
      return {
        group: e.group,
        count: e.uses.length,
        products: [...e.products],
        message: `${e.group} has gone on this farm ${e.uses.length} times in ${withinDays} days.`,
        alternatives: next
          ? cat.actives.filter((a) => sameGroup(parseGroup(a.group), next.group))
            .filter((a) => canUseActive(cat, a.id).ok).map((a) => a.name)
          : [],
        source: ref(`${e.system === 'FRAC' ? 'fungicide' : 'insecticide'}_rotation/rule`),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
