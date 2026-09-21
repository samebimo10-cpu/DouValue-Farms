// The Farm Doctor's plan check (FR-DOC-04, FR-DOC-08).
//
// There is no agronomist on site. What there was instead, in Season 1, was a
// product somebody had heard of and a knapsack. So the Farm Doctor is allowed
// to propose a treatment, but it is not allowed to propose one that breaks a
// rule — and when it cannot propose a legal one, it has to say so rather than
// soften a rule until something fits.
//
// Every plan goes through the same nine checks, in this order, and the order
// matters: the cheapest and most fundamental refusals come first, so a person
// is told "this product is banned" before being told "and you are 3 kg short
// of it".
//
//   1. catalogue   the active exists, is not banned, and has a group on file
//   2. gate3       a confirmed diagnosis exists for this zone         (G3)
//   3. rotation    not the same IRAC/FRAC group as last time
//   4. week10      from Week 10 it is organics only                   (SR-08)
//   5. phi         the fruit is not picked inside the waiting period
//   6. rei         nobody is sent back in unprotected
//   7. mixing      nothing in the tank that must not share a tank
//   8. timing      inside the spray window, on dry leaves             (SR-01..04)
//   9. stock       enough of it, in date, actually on the farm
//
// A check that fails carries the rule it failed, in the rule file's own words,
// and `alternatives` — the next products that would pass. A block that names
// no alternative is a block that gets overridden.
//
// Nothing here clears a gate or approves anything. FR-DOC-08: the Farm Doctor
// never approves its own plan. The Farm Manager does.

import { addDays, daysBetween, isoDate } from '../util.js';
import { rules } from './rules.js';
import {
  activeByKey, activeKeyOfSpray, catalogue, groupOfSpray, intervalsFor, isBanned, isWoundCare,
} from './catalogue.js';
import { dosePlan, measure } from './calc.js';
import { canTreat } from './gates.js';
import { KNAPSACK_L } from './safety.js';

/** The checks, in the order they run, for the screen that lists them. */
export const CHECKS = [
  { id: 'catalogue', name: 'Product is allowed', ref: 'labels / FR-STOCK-05, FR-STOCK-09' },
  { id: 'gate3', name: 'Gate 3 — diagnosis first', ref: 'G3 / FR-GATE-04' },
  { id: 'rotation', name: 'Rotation', ref: 'insecticide_rotation, fungicide_rotation / FR-GATE-05' },
  { id: 'week10', name: 'Week 10 organics only', ref: 'SR-08 / rei.week_10_rule' },
  { id: 'phi', name: 'Pre-harvest interval', ref: 'phi / FR-TREAT-02' },
  { id: 'rei', name: 'Re-entry interval', ref: 'rei / FR-TREAT-02' },
  { id: 'mixing', name: 'Mixing', ref: 'mixing_rules, SR-05' },
  { id: 'timing', name: 'Spray timing', ref: 'SR-01, SR-02, SR-03' },
  { id: 'stock', name: 'Stock on hand', ref: 'FR-STOCK-01, FR-STOCK-04' },
];

/**
 * Groups that are not rotation groups.
 *
 * IRAC UN means "mode of action unknown or uncertain" and FRAC BM means
 * "biological". Neither is a resistance group you can burn through, and
 * treating them as one would contradict the rules file itself: SR-08 requires
 * neem (IRAC UN) repeatedly from Week 10, which is impossible if UN rotates.
 */
const NOT_ROTATION_GROUPS = new Set(['UN', 'NONE']);
const isRotationCode = (code) => code && !NOT_ROTATION_GROUPS.has(code) && !/^BM/.test(code);

// --- Crop week ------------------------------------------------------------

/**
 * week_counting: transplant day is T, Day 1 of Week 0, and week = floor((date
 * - T) / 7). Week 10 therefore starts on day 71, which is the day the Week 10
 * organics rule bites.
 */
export function cropWeek(state, cycleId, onDate = isoDate()) {
  const cycle = (state.cycles || {})[cycleId];
  if (!cycle || !cycle.transplantDate) return { day: null, week: null, cycle: cycle || null };
  const elapsed = daysBetween(cycle.transplantDate, onDate);
  return { day: elapsed + 1, week: Math.floor(elapsed / 7), cycle, transplantDate: cycle.transplantDate };
}

// --- The plan check -------------------------------------------------------

function pass(id, why, extra = {}) { return { ...check(id), state: 'pass', why, ...extra }; }
function fail(id, why, fix, extra = {}) { return { ...check(id), state: 'fail', why, fix, ...extra }; }
function warn(id, why, fix, extra = {}) { return { ...check(id), state: 'warn', why, fix, ...extra }; }
function skip(id, why) { return { ...check(id), state: 'n/a', why }; }
function check(id) { return { ...CHECKS.find((c) => c.id === id) }; }

/**
 * FR-DOC-04 — run a proposed treatment past every rule.
 *
 * `plan` is what somebody is about to do:
 *
 *   cycleId      the bed
 *   activeKey    the active ingredient, from the catalogue
 *   label        a brand label entered against it, or null
 *   at           when the spray would happen, 'YYYY-MM-DDTHH:MM'
 *   tankLitres   one tank load (16 by default)
 *   loads        how many of them
 *   mixWith      anything else going in the tank
 *   flowering, openFlowers, wind, leavesWet, dryHoursAhead, woundCare
 *
 * Returns every check with its verdict, whether the plan may go ahead, and
 * what to do instead if it may not.
 */
export function checkPlan(state, plan = {}, { today = isoDate(), withAlternatives = true } = {}) {
  const at = plan.at || `${today}T17:00`;
  const date = at.slice(0, 10);
  const active = plan.activeKey ? activeByKey(plan.activeKey) : null;
  const week = cropWeek(state, plan.cycleId, date);
  const intervals = active ? intervalsFor(active, plan.label) : null;
  const dose = dosePlan(plan.rate || plan.label?.rate || active?.scheduleRate, {
    tanks: [{ litres: Number(plan.tankLitres) || KNAPSACK_L, label: 'this tank' }],
  });

  const checks = [
    checkCatalogue(plan, active, dose),
    checkGate3(state, plan, date),
    checkRotation(state, plan, active, date, week),
    checkWeek10(plan, active, week),
    checkPhi(state, plan, active, intervals, date, week),
    checkRei(state, plan, active, intervals, at),
    checkMixing(state, plan, active, date, dose),
    checkTiming(plan, active, at),
    checkStock(state, plan, active, dose, date),
  ];

  const failed = checks.filter((c) => c.state === 'fail');
  const warned = checks.filter((c) => c.state === 'warn');
  const out = {
    ok: failed.length === 0,
    plan: { ...plan, at, date },
    active,
    week,
    intervals,
    dose,
    checks,
    failed,
    warned,
    firstFailure: failed[0] || null,
    // FR-DOC-08: the Farm Doctor never approves its own plan.
    approval: rules().farm_doctor.confirmation.treatment_plan,
    ppe: active ? ppeFor({ active }) : null,
    safeToPickFrom: intervals ? isoDate(addDays(date, intervals.phiDays)) : null,
    reentryAfter: intervals ? reentryStamp(at, intervals.reiHours) : null,
  };

  // "If a plan fails, show which rule failed and offer the next valid option."
  if (!out.ok && withAlternatives) {
    out.alternatives = nextValidOptions(state, plan, { today: date, limit: 3 });
  }
  return out;
}

function reentryStamp(at, hours) {
  const base = new Date(at.length > 10 ? at : `${at}T17:00`);
  return new Date(base.getTime() + hours * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

// --- 1. Catalogue ---------------------------------------------------------

function checkCatalogue(plan, active, dose) {
  if (!plan.activeKey) {
    return fail('catalogue', 'No active ingredient was chosen.',
      'Pick one from the catalogue. Treatments are chosen by active ingredient, not by brand (C-18).');
  }
  if (isBanned(plan.activeKey) || isBanned(active?.ai) || isBanned(plan.brand)) {
    return fail('catalogue', `${plan.brand || active?.ai || plan.activeKey} is on the banned list.`,
      'It is never added to the catalogue and never sprayed here. Pick a different active ingredient.',
      { banned: true });
  }
  if (!active) {
    return fail('catalogue', `"${plan.activeKey}" is not in the active-ingredient catalogue.`,
      rules().labels.new_active, { ref: 'FR-STOCK-09' });
  }
  if (!active.group.stated) {
    return fail('catalogue', `${active.ai} has no IRAC or FRAC group on file.`, rules().product_rule);
  }
  if (!dose.ok) {
    // FR-STOCK-08 and the Farm Doctor's "never invents a dose".
    return fail('catalogue', `${active.ai}: ${dose.why}`, dose.fix, { ref: 'FR-STOCK-08 / labels.rate_rule' });
  }
  return pass('catalogue', `${active.ai}, ${active.groupText}, rate on file (${dose.raw}).`);
}

// --- 2. Gate 3 ------------------------------------------------------------

function checkGate3(state, plan, date) {
  // The rotation half of canTreat is deliberately left out: this module runs
  // the rules file's stricter "never twice in a row" a few lines down, and
  // running both would report the same refusal twice under two different
  // numbers.
  const verdict = canTreat(state, plan.cycleId, { today: date, productId: null });
  if (!verdict.ok) {
    return fail('gate3', verdict.why, verdict.fix, { reason: verdict.reason });
  }
  return pass('gate3', `Diagnosed ${verdict.diagnosis.date}, confirmed by a supervisor or the manager.`,
    { diagnosis: verdict.diagnosis });
}

// --- 3. Rotation ----------------------------------------------------------

const codeKey = (codes) => codes.filter(isRotationCode).slice().sort().join('+');

/**
 * The sprays already on this bed, newest first, in the same rotation family
 * (IRAC against IRAC, FRAC against FRAC) with wound care and the non-rotating
 * groups taken out.
 */
export function rotationHistory(state, cycleId, kind, { today = isoDate() } = {}) {
  return (state.sprays || [])
    .filter((s) => s.cycleId === cycleId)
    .filter((s) => s.date && s.date <= today)
    .filter((s) => !isWoundCare(s))
    .map((s) => ({ spray: s, group: groupOfSpray(s), key: activeKeyOfSpray(s) }))
    .filter((h) => h.group.kind === kind && codeKey(h.group.codes))
    .sort((a, b) => (a.spray.date < b.spray.date ? 1 : -1));
}

function checkRotation(state, plan, active, date, week) {
  if (!active || !active.group.stated) return skip('rotation', 'No product to check yet.');
  if (plan.woundCare) {
    return skip('rotation', 'Logged as wound care, which decision C-7 keeps out of the rotation count.');
  }

  const mine = codeKey(active.group.codes);
  if (!mine) {
    return pass('rotation', `${active.groupText} is not a resistance group, so rotation does not apply.`);
  }

  const kind = active.group.kind;
  const history = rotationHistory(state, plan.cycleId, kind, { today: date });
  const last = history[0];

  if (!last) {
    return pass('rotation', `Nothing from an ${kind} group has gone on this bed yet.`);
  }

  const sameAsLast = codeKey(last.group.codes) === mine;
  const gap = daysBetween(last.spray.date, date);

  // C-15, the one exception in the whole rotation rule: from Week 10, Copper
  // Hydroxide (M1) is the only PHI-0 fungicide, so repeated M1 is allowed at
  // 10 to 14 day intervals. The alternative would be a synthetic inside its
  // own waiting period, which is worse.
  if (sameAsLast && week.week >= 10 && active.key === 'copper_hydroxide' && last.key === 'copper_hydroxide') {
    if (gap < 10) {
      return fail('rotation',
        `Copper Hydroxide went on ${last.spray.date}, ${gap} day${gap === 1 ? '' : 's'} ago. `
        + 'The Week 10 exception allows repeats at 10 to 14 day intervals, not sooner.',
        `Wait until ${isoDate(addDays(last.spray.date, 10))}.`, { ref: 'fungicide_rotation.week_10_exception' });
    }
    return pass('rotation',
      `Repeat M1 at ${gap} days. ${rules().fungicide_rotation.week_10_exception}`,
      { exception: 'week-10-m1' });
  }

  if (sameAsLast) {
    const ruleText = kind === 'IRAC'
      ? rules().insecticide_rotation.rule
      : rules().fungicide_rotation.rule;
    return fail('rotation',
      `The last ${kind === 'IRAC' ? 'insecticide' : 'fungicide'} on this bed was `
      + `${last.spray.productName || last.key || last.spray.productId} on ${last.spray.date}, `
      + `${kind} ${codeKey(last.group.codes)} — the same group as ${active.ai}.`,
      `${ruleText}. Use a different group this time.`,
      { ref: kind === 'IRAC' ? 'insecticide_rotation' : 'fungicide_rotation', lastGroup: codeKey(last.group.codes) });
  }

  // "Metalaxyl-M only in rotation, max every 3rd" — so it must not appear in
  // either of the last two fungicide slots, not merely the last one.
  if (active.key === 'metalaxyl_m') {
    const recent = history.slice(0, 2).find((h) => h.key === 'metalaxyl_m');
    if (recent) {
      return fail('rotation',
        `Metalaxyl-M went on ${recent.spray.date}, ${history.indexOf(recent) + 1} spray`
        + `${history.indexOf(recent) === 0 ? '' : 's'} ago.`,
        'Metalaxyl-M is allowed at most every third fungicide. Put two other groups through first.',
        { ref: 'fungicide_rotation / mixing_rules' });
    }
  }

  return pass('rotation',
    `Last ${kind} on this bed was ${codeKey(last.group.codes)} on ${last.spray.date}; `
    + `${active.ai} is ${mine}.`);
}

// --- 4. Week 10 -----------------------------------------------------------

function checkWeek10(plan, active, week) {
  if (!active) return skip('week10', 'No product to check yet.');
  if (week.week == null) {
    return warn('week10', 'This bed has no transplant date, so the crop week cannot be worked out.',
      'Record the transplant date on the cycle. The Week 10 rule cannot be applied without it.');
  }
  if (week.week < 10) {
    return pass('week10', `Week ${week.week} (day ${week.day}). The Week 10 rule starts on day 71.`);
  }
  if (active.organic) {
    return pass('week10', `Week ${week.week}: organics only, and ${active.ai} is one of the three named.`);
  }
  return fail('week10',
    `This bed is in Week ${week.week} (day ${week.day}), and ${active.ai} is not one of the organics.`,
    `${rules().spray_rules.find((r) => r.id === 'SR-08').rule} `
    + 'Neem oil, garlic-chilli or Copper Hydroxide.',
    { ref: 'SR-08', ownerNotified: true });
}

// --- 5. PHI ---------------------------------------------------------------

function checkPhi(state, plan, active, intervals, date, week) {
  if (!active || !intervals) return skip('phi', 'No product to check yet.');

  const safeFrom = isoDate(addDays(date, intervals.phiDays));
  const blocked = (Object.values(state.tasks || {}))
    .filter((t) => t.cycleId === plan.cycleId && t.kind === 'harvest')
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .filter((t) => String(t.due || '').slice(0, 10) < safeFrom)
    .sort((a, b) => (a.due < b.due ? -1 : 1));

  const label = intervals.phiFromLabel ? ' (from the label, which is longer)'
    : intervals.phiNote ? ` (${intervals.phiNote})` : '';

  if (blocked.length) {
    return fail('phi',
      `${intervals.phiDays} days before picking${label}, so nothing comes off this bed until ${safeFrom}. `
      + `${blocked.length} harvest task${blocked.length === 1 ? ' is' : 's are'} due before that, `
      + `starting ${String(blocked[0].due).slice(0, 10)}.`,
      `Either move the harvest to ${safeFrom} or later, or use a PHI-0 product `
      + '(neem oil, garlic-chilli, Copper Hydroxide, Trichoderma).',
      { safeFrom, blockedTasks: blocked.map((t) => t.id), ref: 'rei.harvest_block' });
  }

  if (intervals.phiDays === 0) {
    return pass('phi', `No waiting period${label}. Picking can carry on.`, { safeFrom });
  }
  return pass('phi',
    `${intervals.phiDays} days${label}. No picking on this bed until ${safeFrom}.`
    + (week.week >= 10 ? ` Export buffer ${intervals.exportBufferDays} days.` : ''),
    { safeFrom });
}

// --- 6. REI ---------------------------------------------------------------

function checkRei(state, plan, active, intervals, at) {
  if (!active || !intervals) return skip('rei', 'No product to check yet.');

  const until = new Date(new Date(at.length > 10 ? at : `${at}T17:00`).getTime()
    + intervals.reiHours * 3600000);
  const untilStamp = until.toISOString().slice(0, 16).replace('T', ' ');

  const inside = Object.values(state.tasks || {})
    .filter((t) => t.cycleId === plan.cycleId && t.kind !== 'harvest')
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .filter((t) => t.due && new Date(t.due) < until)
    .sort((a, b) => (a.due < b.due ? -1 : 1));

  const source = intervals.reiFromLabel ? 'from the label' : `${active.reiNote || 'default'}`;

  if (inside.length) {
    // The hard stop on a person walking into a sprayed house is
    // reentryClearance() on the field screen, which reads the same numbers.
    // This is the planning view of it: these jobs need moving first.
    return warn('rei',
      `Nobody goes back in unprotected until ${untilStamp} (${intervals.reiHours} h, ${source}). `
      + `${inside.length} job${inside.length === 1 ? '' : 's'} on this bed fall${inside.length === 1 ? 's' : ''} inside that.`,
      `Move them past ${untilStamp}, or send whoever does them in full protective gear.`,
      { until: untilStamp, tasks: inside.map((t) => ({ id: t.id, title: t.title, due: t.due })) });
  }
  return pass('rei', `Re-entry from ${untilStamp} (${intervals.reiHours} h, ${source}).`, { until: untilStamp });
}

// --- 7. Mixing ------------------------------------------------------------

/**
 * The vocabulary of the mixing rules. They talk about fertilisers and trace
 * elements that are not active ingredients, so the tank is matched on words
 * rather than catalogue keys.
 */
const TERMS = {
  ca_nitrate: /\bca(lcium)?\s*nitrate\b/i,
  k_nitrate: /\b(k|potassium)\s*nitrate\b/i,
  mg_sulphate: /\b(mg|magnesium)\s*sulphate\b|\bepsom\b/i,
  phosphate: /\bphosphate\b|\bmap\b|\bmkp\b/i,
  neem: /\bneem\b|azadirachtin/i,
  soap: /\bsoap\b/i,
  borax: /\bborax\b/i,
  boron: /\bboron\b|\bborax\b/i,
  zinc: /\bzinc\b/i,
  calcium: /\bca(lcium)?\b/i,
  metalaxyl: /metalaxyl/i,
  microbial: /trichoderma|bacillus|microbial|inoculant/i,
};

function tankContents(plan, active) {
  const items = [active ? active.ai : '', plan.brand || '', ...(plan.mixWith || [])]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  // A catalogue key in mixWith reads better as its active's name.
  return items.map((x) => (activeByKey(x) ? activeByKey(x).ai : x));
}

const hasTerm = (contents, term) => contents.some((c) => TERMS[term].test(c));

function checkMixing(state, plan, active, date, dose) {
  if (!active) return skip('mixing', 'No product to check yet.');
  const contents = tankContents(plan, active);
  const broken = [];
  const unchecked = [];

  for (const rule of rules().mixing_rules) {
    const never = rule.never;

    // "Ca Nitrate + K Nitrate in the same tank" and the other pair rules.
    const pair = never.match(/^(.+?)\s*\+\s*(.+?)(?:\s+in the same tank)?$/i);
    if (pair && !/without/i.test(never)) {
      const a = termFor(pair[1]);
      const b = termFor(pair[2]);
      if (!a || !b) { unchecked.push(rule); continue; }
      if (hasTerm(contents, a) && hasTerm(contents, b)) broken.push(rule);
      continue;
    }

    // "Neem oil without soap" — the premix, not the tank partner.
    if (/^neem oil without soap$/i.test(never)) {
      if (hasTerm(contents, 'neem')) {
        const mixed = hasTerm(contents, 'soap')
          || (dose.components || []).some((c) => c.of && TERMS.soap.test(c.of));
        if (!mixed) broken.push(rule);
      }
      continue;
    }

    // Rate ceilings: "Borax above 1.5 g/L", "Zinc above 2 g/L if grey sheen appears".
    const ceiling = never.match(/^(\w+)\s+above\s+([\d.]+)\s*(g|ml)\/L/i);
    if (ceiling) {
      const term = termFor(ceiling[1]);
      const entered = Number((plan.rates || {})[ceiling[1].toLowerCase()]);
      if (term && hasTerm(contents, term) && entered > Number(ceiling[2])) broken.push(rule);
      continue;
    }

    // "Foliar Ca after first open flower".
    if (/^foliar ca after first open flower$/i.test(never)) {
      if (plan.flowering && hasTerm(contents, 'calcium') && !plan.drench) broken.push(rule);
      continue;
    }

    // "Boron within 4 h of Ca" — both in one tank is inside four hours.
    if (/^boron within 4 h of ca$/i.test(never)) {
      if (hasTerm(contents, 'boron') && hasTerm(contents, 'calcium')) broken.push(rule);
      continue;
    }

    // "Metalaxyl-M consecutively" is the rotation check's business.
    if (/consecutively/i.test(never)) continue;

    unchecked.push(rule);
  }

  // SR-05 is a mixing rule that lives with the spray rules: a microbial
  // inoculant never shares a tank with a fungicide, and never goes on within
  // 48 hours of one either way.
  const sr05 = rules().spray_rules.find((r) => r.id === 'SR-05');
  const microbialInTank = hasTerm(contents, 'microbial');
  const fungicideInTank = active.kindOfProduct === 'fungicide'
    || contents.some((c) => { const a = activeByKey(c) || null; return a && a.kindOfProduct === 'fungicide'; });

  if (microbialInTank && fungicideInTank) broken.push({ never: sr05.rule, do: 'Separate passes, 48 h apart.' });

  if (microbialInTank || fungicideInTank) {
    const near = (state.sprays || [])
      .filter((s) => s.cycleId === plan.cycleId && s.date)
      .filter((s) => Math.abs(daysBetween(s.date, date)) <= 2)
      .find((s) => {
        const a = activeByKey(activeKeyOfSpray(s) || '');
        if (!a) return false;
        return microbialInTank ? a.kindOfProduct === 'fungicide' : TERMS.microbial.test(a.ai);
      });
    if (near) {
      broken.push({
        never: sr05.rule,
        do: `The last one went on ${near.date}. Leave a full 48 hours between them.`,
      });
    }
  }

  if (broken.length) {
    return fail('mixing',
      broken.map((r) => `Never: ${r.never}.`).join(' '),
      broken.map((r) => r.do).join(' '),
      { broken, ref: 'mixing_rules / SR-05' });
  }

  return pass('mixing',
    contents.length > 1
      ? `${contents.join(' + ')} — no rule against that combination.`
      : 'Nothing else in the tank.',
    unchecked.length ? { unchecked: unchecked.map((r) => r.never) } : {});
}

function termFor(text) {
  const t = String(text).trim();
  return Object.keys(TERMS).find((k) => TERMS[k].test(t)) || null;
}

// --- 8. Timing ------------------------------------------------------------

const ruleText = (id) => (rules().spray_rules.find((r) => r.id === id) || {}).rule || '';

function checkTiming(plan, active, at) {
  if (!active) return skip('timing', 'No product to check yet.');
  if (at.length <= 10) {
    return warn('timing', 'No time of day was given for this spray.',
      `${ruleText('SR-01')} Set a time so the window can be checked.`);
  }

  const [h, m] = at.slice(11).split(':').map(Number);
  const clock = h + (m || 0) / 60;
  const pretty = at.slice(11, 16);
  const broken = [];

  // SR-02 tightens SR-01 once the crop is flowering: after 5 PM, not 4.
  const opensAt = plan.flowering ? 17 : 16;
  if (clock < opensAt || clock > 19) {
    broken.push({
      why: `${pretty} is outside the spray window.`,
      fix: plan.flowering ? ruleText('SR-02') : ruleText('SR-01'),
    });
  }
  if (plan.openFlowers) {
    broken.push({ why: 'The crop has open flowers.', fix: ruleText('SR-02') });
  }
  if (plan.wind) {
    broken.push({ why: 'There is wind through the nets.', fix: ruleText('SR-02') });
  }
  if (plan.leavesWet) {
    broken.push({ why: 'The leaves are wet.', fix: ruleText('SR-03') });
  }
  if (active.key === 'mancozeb' && plan.dryHoursAhead != null && Number(plan.dryHoursAhead) < 2) {
    broken.push({
      why: `Mancozeb needs 2 dry hours to bind and there ${plan.dryHoursAhead === 1 ? 'is 1' : `are ${plan.dryHoursAhead}`} ahead.`,
      fix: ruleText('SR-03'),
    });
  }
  // Spinosad carries its own timing note in the catalogue: UV degrades it.
  if (active.key === 'spinosad' && clock < 16) {
    broken.push({ why: 'Spinosad breaks down in sunlight.', fix: 'After 4 PM only.' });
  }

  if (broken.length) {
    return fail('timing', broken.map((b) => b.why).join(' '), broken.map((b) => b.fix).join(' '),
      { ref: 'SR-01, SR-02, SR-03' });
  }

  const notes = [];
  if (plan.openField) notes.push(ruleText('SR-04'));
  return pass('timing', `${pretty}, inside the ${opensAt === 17 ? '5' : '4'}-7 PM window.`,
    notes.length ? { notes } : {});
}

// --- 9. Stock -------------------------------------------------------------

const TO_BASE = { g: 1, kg: 1000, ml: 1, l: 1000, litre: 1000, litres: 1000 };

function checkStock(state, plan, active, dose, date) {
  if (!active || !dose.ok) return skip('stock', 'No dose to measure out yet.');

  const loads = Math.max(1, Number(plan.loads) || 1);
  const litres = (Number(plan.tankLitres) || KNAPSACK_L) * loads;
  const need = dose.components.map((c) => {
    const total = c.amount * litres;
    return { ...c, total, measured: measure(total, c.unit, c.of) };
  });
  const needText = need.map((n) => n.measured.text).join(' + ');

  const item = findStockItem(state, active);
  if (!item) {
    return fail('stock', `${active.ai} is not in the store.`,
      `Add it to the store before planning a spray with it. The plan needs `
      + `${needText} for ${litres} L.`,
      { need, ref: 'farm_doctor.never — not in stock' });
  }

  if (item.expiry && item.expiry < date) {
    return fail('stock', `The ${active.ai} in the store expired on ${item.expiry}.`,
      'Expired product cannot be selected. Dispose of it safely and buy in date.',
      { item: item.id, ref: 'FR-STOCK-04' });
  }

  const haveBase = (Number(item.qty) || 0) * (TO_BASE[String(item.unit || '').toLowerCase()] || 0);
  if (!haveBase) {
    return warn('stock', `${item.name} is held in ${item.unit || 'an unstated unit'}, `
      + 'which cannot be compared with a dose in ml or g.',
      `Check by eye: the plan needs ${needText}.`,
      { item: item.id, need });
  }

  const short = need.filter((n) => n.total > haveBase);
  if (short.length) {
    return fail('stock',
      `${item.name}: ${short.map((n) => n.measured.text).join(' + ')} needed for `
      + `${litres} L, and there ${Number(item.qty) === 1 ? 'is' : 'are'} ${item.qty} ${item.unit} on hand.`,
      'Buy it in, or cut the plan to the tanks the store can actually fill.',
      { item: item.id, need, ref: 'FR-STOCK-01' });
  }

  return pass('stock', `${needText} for ${litres} L; ${item.qty} ${item.unit} on hand.`,
    { item: item.id, need });
}

/**
 * The store holds brand names and pack sizes ("Mancozeb 80WP", "Neem oil,
 * cold-pressed"), so the match is on the active's own distinctive words.
 *
 * Distinctive matters: "copper" appears in two actives, so a bag of Copper
 * Hydroxide must not answer a plan for Copper Oxychloride. A word that belongs
 * to more than one active in the catalogue cannot identify either of them.
 */
let distinctive = null;

function distinctiveWords(active) {
  if (!distinctive) {
    const counts = new Map();
    const wordsOf = (a) => String(a.ai).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    for (const a of catalogue()) {
      for (const w of new Set(wordsOf(a))) counts.set(w, (counts.get(w) || 0) + 1);
    }
    distinctive = new Map(catalogue().map((a) => [a.key, wordsOf(a).filter((w) => counts.get(w) === 1)]));
  }
  return distinctive.get(active.key) || [];
}

export function resetStockMatching() { distinctive = null; }

function findStockItem(state, active) {
  const words = distinctiveWords(active);
  return Object.values(state.inputs || {})
    .filter((i) => i.qty != null)
    .find((i) => {
      if (String(i.activeKey || '') === active.key) return true;
      const name = String(i.name || '').toLowerCase();
      return words.some((w) => name.includes(w));
    }) || null;
}

// --- The next valid option ------------------------------------------------

/**
 * "If a plan fails, show which rule failed and offer the next valid option."
 *
 * Runs the same plan past every other active in the catalogue and keeps the
 * ones that come back clean. Ordered so the schedule's own rotation sequence
 * comes first, because the next product in the sequence is the right answer
 * far more often than the cleverest one.
 */
export function nextValidOptions(state, plan, { today = isoDate(), limit = 3 } = {}) {
  const wanted = plan.activeKey ? activeByKey(plan.activeKey) : null;
  const kind = wanted ? wanted.kindOfProduct : plan.kind || 'insecticide';
  const order = sequenceOrder();

  let candidates = catalogue()
    .filter((a) => a.key !== plan.activeKey)
    .filter((a) => a.kindOfProduct === kind || (kind === 'other'));

  // thrips_program names the groups this farm rotates thrips through, so when
  // the target is thrips the alternatives come from that list, not from every
  // insecticide on the shelf.
  let preferred = candidates;
  if (/thrips/i.test(plan.targetPest || '')) {
    const named = Object.values(rules().thrips_program.options_by_group).join(' ').toLowerCase();
    const only = candidates.filter((a) => named.includes(a.ai.split(/[\s/(]/)[0].toLowerCase()));
    if (only.length) preferred = only;
  }

  const tried = (list) => {
    const out = [];
    for (const a of list.slice().sort((x, y) => (order[x.key] ?? 99) - (order[y.key] ?? 99))) {
      const verdict = checkPlan(state, { ...plan, activeKey: a.key, rate: null, label: null },
        { today, withAlternatives: false });
      if (!verdict.ok) continue;
      out.push({
        active: a,
        dose: verdict.dose,
        week: verdict.week,
        safeToPickFrom: verdict.safeToPickFrom,
        why: `${a.ai} — ${a.groupText}, `
          + `${verdict.intervals.phiDays === 0 ? 'no waiting period' : `${verdict.intervals.phiDays} days before picking`}.`,
      });
      if (out.length >= limit) break;
    }
    return out;
  };

  // Narrow first, then widen. The thrips programme is the right shortlist
  // right up until Week 10, when every product on it is a synthetic and the
  // only legal answers are the organics SR-08 names. An empty shortlist is not
  // an answer of "nothing can be done".
  const shortlist = tried(preferred);
  if (shortlist.length || preferred === candidates) return shortlist;
  return tried(candidates.filter((a) => !preferred.includes(a)));
}

/** The rotation sequences in the rules file, as a sort order. */
function sequenceOrder() {
  const order = {};
  const add = (list) => list.forEach((step) => {
    const first = String(step.product).split(/[\s/(]/)[0].toLowerCase();
    const match = catalogue().find((a) => a.ai.toLowerCase().startsWith(first));
    if (match && order[match.key] == null) order[match.key] = step.order;
  });
  add(rules().insecticide_rotation.sequence);
  add(rules().fungicide_rotation.sequence);
  return order;
}

// --- PPE (FR-TREAT-04) ----------------------------------------------------

/**
 * The gear, as things you can point at.
 *
 * FR-TREAT-04 asks for pictures before the task starts and a tap to confirm,
 * because a list of words in English is not what stops somebody spraying in a
 * singlet. The `icon` is drawn by the UI; the words are here so the domain can
 * be tested without a browser.
 */
export const PPE = {
  mask: { id: 'mask', icon: 'mask', label: 'Mask over nose and mouth',
    why: 'The spray drifts back at you the moment the wind shifts.' },
  dust_mask: { id: 'dust_mask', icon: 'mask', label: 'Dust mask',
    why: 'Hydrated lime dust burns the inside of the nose and the lungs.' },
  gloves: { id: 'gloves', icon: 'gloves', label: 'Gloves',
    why: 'Most of what gets into a person gets in through the hands.' },
  goggles: { id: 'goggles', icon: 'goggles', label: 'Goggles',
    why: 'There is no rinsing this back out of an eye in the field.' },
  sleeves: { id: 'sleeves', icon: 'sleeves', label: 'Long sleeves and trousers',
    why: 'Bare arms in a sprayed house carry it home on the skin.' },
  boots: { id: 'boots', icon: 'boots', label: 'Boots',
    why: 'The run-off ends up on the floor you are standing in.' },
};

/**
 * What must be worn for this job (SR-06, plus the farm's own standing rules).
 *
 * SR-06 sets the floor: mask and gloves for any spray, and for hydrated lime
 * goggles, gloves, dust mask, long sleeves and a briefing that gets logged.
 * The farm's spray rules in safety.js go further — sleeves, trousers and boots
 * every time — and the stricter of the two is the one that applies.
 */
export function ppeFor({ active = null, task = 'spray' } = {}) {
  const sr06 = ruleText('SR-06');

  if (task === 'lime' || active?.key === 'hydrated_lime') {
    return {
      task: 'lime',
      items: [PPE.goggles, PPE.gloves, PPE.dust_mask, PPE.sleeves, PPE.boots],
      briefing: true,
      briefingText: 'Hydrated lime needs a team briefing before anyone opens a bag, '
        + 'and the briefing is logged with who was there.',
      source: 'SR-06',
      rule: sr06,
    };
  }

  const items = [PPE.mask, PPE.gloves, PPE.sleeves, PPE.boots];

  // Goggles for anything that is not a PHI-0 botanical, and for garlic-chilli,
  // which the PHI table marks as an eye and skin irritant in its own right.
  if (!active || active.synthetic || active.key === 'garlic_chilli') items.splice(2, 0, PPE.goggles);

  return {
    task: 'spray',
    items,
    briefing: false,
    source: 'SR-06',
    rule: sr06,
    extra: active?.key === 'garlic_chilli'
      ? 'Garlic-chilli is an eye and skin irritant. Treat it like a chemical, because it is one.'
      : null,
    // SR-07, the step everyone skips.
    after: active && active.kindOfProduct === 'insecticide' ? ruleText('SR-07') : null,
  };
}

// --- Follow-up (FR-TREAT-05, FR-DOC-07) -----------------------------------

/**
 * A treatment that nobody went back to look at is a treatment nobody knows the
 * result of, which is how the same product gets sprayed four more times.
 */
export function followUpTask(spray, { zoneName = '' } = {}) {
  const on = isoDate(addDays(spray.date, 3));
  return {
    id: `t_fu_${spray.id}`,
    kind: 'scout',
    title: `Did the spray work? — ${zoneName || spray.cycleId}`,
    cycleId: spray.cycleId,
    zoneId: spray.zoneId || null,
    due: `${on}T09:00`,
    sprayId: spray.id,
    source: 'farm-doctor',
    proof: true,
    why: 'Three days after a treatment is when you can tell whether it worked. '
      + 'If the count has not moved, the next spray is a different group, not the same one again.',
    how: ['Count the same ten plants and the same traps as before.',
      'Photograph one affected leaf.',
      'Record whether it is better, the same, or worse.'],
  };
}
