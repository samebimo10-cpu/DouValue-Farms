// Gates: the rules that stop a wrong action before it happens.
//
// Section 6.2 of the requirements calls these the most important part of the
// app, and the reason is in section 1. Season 1 was not lost because nobody
// wrote things down. It was lost because planting went into untested soil and
// treatment went in by guesswork. A record of either would have been a perfect
// account of a failure. A gate would have been the failure not happening.
//
// So the test for everything here is narrow and harsh: does it BLOCK, or does
// it merely warn? A gate that can be clicked past is a label.
//
// Three rules hold this file together.
//
//   1. A gate is a pure function of recorded facts. No gate reads a setting
//      that a person can quietly relax, except the Owner's explicit override,
//      which is itself a record with a reason attached.
//   2. Unknown is not pass. A zone with no soil test is blocked exactly as
//      hard as a zone with a failing one, because "we never checked" is how
//      Season 1 started.
//   3. Every block says the fix. A gate that says no without saying what would
//      make it yes gets overridden, and then gates stop meaning anything.

import { daysBetween, isoDate } from '../util.js';
import { PRODUCT_BY_ID } from './safety.js';
import {
  activeById, activeForSpray, allowedInWeek10, canUse, carriesCode, catalogue, findActive,
  nextInSequence, parseGroup, sameGroup, thripsOptions, week10Names,
} from './actives.js';

/**
 * Gate thresholds.
 *
 * pH 5.5–7.0 is FR-GATE-01, straight from the requirements. The freshness
 * window is marked in the document as "[set from Rev 5.1]" and is not decided
 * yet, so it lives here with a defensible default and a name that makes its
 * provisional status obvious wherever it is read.
 */
export const GATE_RULES = {
  phMin: 5.5,
  phMax: 7.0,
  // How old a soil test may be and still count. 90 days covers a nursery-to-
  // transplant run without letting last season's reading authorise this one.
  // AWAITING Rev 5.1: confirm with the agronomist before launch.
  soilTestMaxAgeDays: 90,
  // A nematode clearance is a bigger, slower test and is not re-run as often.
  nematodeMaxAgeDays: 180,
};

export const GATE_STATE = {
  pass: { label: 'Clear', tone: 'ok', icon: '✓' },
  fail: { label: 'Blocked', tone: 'danger', icon: '✕' },
  unknown: { label: 'Not tested', tone: 'danger', icon: '✕' },
  overridden: { label: 'Overridden', tone: 'warn', icon: '!' },
};

/**
 * The day a gate is being asked about.
 *
 * FR-GATE-01 puts a freshness window on the soil test, but the window is a
 * condition on *planting*, not a clock that keeps running afterwards. Judged
 * against today, a bed correctly cleared before transplant turns red ninety
 * days later and the app starts re-blocking ground that passed its checks —
 * which teaches people the red means nothing.
 *
 * So for a zone with a crop in it, the question is "was this test fresh when
 * the crop went in?", and the answer never changes again. For an empty zone it
 * is "is it fresh now?", which is the decision actually in front of someone.
 */
function asOf(state, zoneId, today) {
  const cycle = Object.values(state.cycles || {})
    .filter((c) => c.plotId === zoneId && c.status === 'active')
    .sort((a, b) => ((a.transplantDate || '') < (b.transplantDate || '') ? 1 : -1))[0];
  return (cycle && cycle.transplantDate) || today;
}

/** The most recent soil test for a zone, or for the topsoil batch filling it. */
export function latestSoilTest(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;

  const mine = (state.soilTests || [])
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return mine[0] || null;
}

/**
 * FR-GATE-01 — the pH gate.
 *
 * Corrected pH is what counts. Liming is the whole point of testing early, so
 * a test taken before the lime went on says nothing about what the plants will
 * meet. When a test is marked as pre-correction, it does not open the gate.
 */
export function phGate(state, zoneId, { today = isoDate() } = {}) {
  const judged = asOf(state, zoneId, today);
  const test = latestSoilTest(state, zoneId, { today: judged });

  if (!test || test.ph == null) {
    return gate('ph', 'Soil pH tested', 'unknown', {
      why: 'No pH reading has been recorded for this zone.',
      fix: 'Take a pH reading and record it under Soil tests. Planting stays blocked until then.',
    });
  }

  const age = daysBetween(test.date, judged);
  if (age > GATE_RULES.soilTestMaxAgeDays) {
    return gate('ph', 'Soil pH tested', 'fail', {
      why: `The last pH reading is ${age} days old (${test.ph} on ${test.date}).`,
      fix: `Re-test. A reading older than ${GATE_RULES.soilTestMaxAgeDays} days does not describe this soil any more.`,
      test,
    });
  }

  if (test.beforeCorrection) {
    return gate('ph', 'Soil pH tested', 'fail', {
      why: `The reading of ${test.ph} was taken before lime was applied, so it does not say where the soil is now.`,
      fix: 'Re-test after the lime has worked in and record that reading.',
      test,
    });
  }

  const ph = Number(test.ph);
  if (ph < GATE_RULES.phMin || ph > GATE_RULES.phMax) {
    return gate('ph', 'Soil pH tested', 'fail', {
      why: `pH is ${ph}, outside the ${GATE_RULES.phMin}–${GATE_RULES.phMax} range peppers need.`,
      fix: ph < GATE_RULES.phMin
        ? 'Lime it, wait for the lime to work in, then re-test and record the corrected reading.'
        : 'Bring it down with sulphur or organic matter, then re-test and record the corrected reading.',
      test,
    });
  }

  return gate('ph', 'Soil pH tested', 'pass', {
    why: `pH ${ph}, recorded ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
    test,
  });
}

/**
 * FR-GATE-02 — the nematode gate.
 *
 * This is the one that cost Season 1. Root-knot nematode is invisible until the
 * plants are already failing, and by then the ground is the problem, not the
 * crop. Nothing goes in without a clean result on the record.
 */
export function nematodeGate(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  const judged = asOf(state, zoneId, today);

  const tests = (state.soilTests || [])
    .filter((t) => t.nematode)
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= judged)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const test = tests[0];
  if (!test) {
    return gate('nematode', 'Nematode clear', 'unknown', {
      why: 'No nematode test has been recorded for this zone or for the topsoil in it.',
      fix: 'Send a soil sample for a nematode test and record the result. This is the check Season 1 was lost for.',
    });
  }

  const age = daysBetween(test.date, judged);
  if (age > GATE_RULES.nematodeMaxAgeDays) {
    return gate('nematode', 'Nematode clear', 'fail', {
      why: `The clean result is ${age} days old (${test.date}).`,
      fix: `Re-test. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers this ground.`,
      test,
    });
  }

  if (test.nematode !== 'clean') {
    return gate('nematode', 'Nematode clear', 'fail', {
      why: `The test on ${test.date} came back ${test.nematode}.`,
      fix: 'Do not plant peppers here. Solarise or rotate to a non-host — maize or a resistant cover — '
        + 'and re-test before this zone carries a crop again.',
      test,
    });
  }

  return gate('nematode', 'Nematode clear', 'pass', {
    why: `Clean result recorded ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
    test,
  });
}

/**
 * FR-GATE-03 — purchased topsoil.
 *
 * A delivery is a batch until somebody tests it. Bought-in soil is the fastest
 * way to move a nematode population onto clean ground, so an untested batch
 * cannot be assigned to a zone at all.
 */
export function batchGate(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  if (!batchId) {
    return gate('topsoil', 'Topsoil tested', 'pass', {
      why: 'No purchased topsoil in this zone — nothing to clear.',
    });
  }

  const batch = (state.topsoilBatches || {})[batchId];
  if (!batch) {
    return gate('topsoil', 'Topsoil tested', 'unknown', {
      why: 'This zone names a topsoil batch that is not on record.',
      fix: 'Record the delivery under Topsoil, with its supplier and date, and test it.',
    });
  }

  const tested = (state.soilTests || []).some((t) => t.batchId === batchId && t.nematode === 'clean');
  if (!tested) {
    return gate('topsoil', 'Topsoil tested', 'fail', {
      why: `Batch from ${batch.supplier || 'an unnamed supplier'} (${batch.date || 'no date'}) has no clean test.`,
      fix: 'Test the batch before anything is planted into it. An untested load can carry nematodes '
        + 'straight into a clean house.',
      batch,
    });
  }

  return gate('topsoil', 'Topsoil tested', 'pass', {
    why: `Batch from ${batch.supplier || 'supplier not named'} tested clean.`,
    batch,
  });
}

/** Has the Owner overridden this gate for this zone, and is that override still standing? */
function overrideFor(state, gateId, zoneId) {
  const list = (state.gateOverrides || [])
    .filter((o) => o.gate === gateId && o.zoneId === zoneId && !o.revoked)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
  return list[0] || null;
}

function gate(id, name, state, extra = {}) {
  return { id, name, state, why: '', fix: null, ...extra };
}

/**
 * FR-GATE-06 — every planting gate for one zone, in one place.
 *
 * An override does not delete the finding. The gate still reports what it
 * found and who decided to go anyway, because that is the record the digest
 * and the audit need.
 */
export function gatesForZone(state, zoneId, opts = {}) {
  return [phGate(state, zoneId, opts), nematodeGate(state, zoneId, opts), batchGate(state, zoneId, opts)]
    .map((g) => {
      if (g.state === 'pass') return g;
      const override = overrideFor(state, g.id, zoneId);
      if (!override) return g;
      return { ...g, state: 'overridden', override, blockedWhy: g.why };
    });
}

/**
 * FR-GATE-01/02/03 — may a crop be planted here?
 *
 * The one call the planting screen makes. `ok` is false unless every gate is
 * pass or explicitly overridden by the Owner.
 */
export function canPlant(state, zoneId, opts = {}) {
  const gates = gatesForZone(state, zoneId, opts);
  const blocking = gates.filter((g) => g.state === 'fail' || g.state === 'unknown');
  return {
    ok: blocking.length === 0,
    gates,
    blocking,
    overridden: gates.filter((g) => g.state === 'overridden'),
    why: blocking.length
      ? `${blocking.length} gate${blocking.length === 1 ? '' : 's'} not cleared: `
        + blocking.map((g) => g.name).join(', ')
      : null,
  };
}

/**
 * FR-GATE-04 — diagnose before you treat.
 *
 * "Treatment by guesswork" is one of the four named causes of Season 1. A
 * spray needs a diagnosis that names the problem, was recorded for this zone,
 * is recent enough to still describe it, and — FR-DIAG-03 — was confirmed by
 * somebody senior to the person who started it.
 *
 * `productId` may be an active ingredient from the catalogue, which is how
 * FR-STOCK-05 says a treatment is chosen, or a legacy product id from a spray
 * logged before the catalogue existed.
 */
export function canTreat(state, cycleId, {
  today = isoDate(), productId = null, activeId = null, labelId = null,
  target = null, purpose = null, maxAgeDays = 14,
} = {}) {
  const recent = (state.diagnoses || [])
    .filter((d) => d.cycleId === cycleId)
    .filter((d) => d.date && d.date <= today && daysBetween(d.date, today) <= maxAgeDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const confirmed = recent.filter((d) => d.confirmedBy);

  if (!recent.length) {
    return {
      ok: false,
      reason: 'no-diagnosis',
      why: 'Nothing has been diagnosed on this zone in the last two weeks.',
      fix: 'Run the clinic on a sick plant first. Spraying without knowing what you are spraying at is '
        + 'how a season gets lost.',
    };
  }

  if (!confirmed.length) {
    return {
      ok: false,
      reason: 'unconfirmed',
      diagnosis: recent[0],
      why: `"${recent[0].problemName || recent[0].problemId}" was diagnosed on ${recent[0].date} `
        + 'but nobody senior has confirmed it.',
      fix: 'The Field Supervisor or Farm Manager confirms the diagnosis, then the treatment can be logged.',
    };
  }

  const diagnosis = confirmed[0];
  const rotation = rotationCheck(state, cycleId, activeId || productId, {
    today, labelId, purpose, target: target || diagnosis.problemId,
  });
  if (!rotation.ok) return rotation;

  return { ok: true, diagnosis, active: rotation.active || null, rate: rotation.rate || null };
}

/**
 * Which week of the cycle a zone is in — Build Rules §11a.
 *
 * Transplant day is T, Day 1 of Week 0, and week n runs from day 7n+1 to 7n+7.
 * Week 10 is the one the spray rules care about: from there on the crop is in
 * continuous harvest and a 14-day synthetic simply does not fit between picks.
 */
export function cropWeek(state, cycleId, today = isoDate()) {
  const cycle = (state.cycles || {})[cycleId];
  if (!cycle || !cycle.transplantDate) return null;
  const dayNumber = daysBetween(cycle.transplantDate, today) + 1;
  if (dayNumber < 1) return null;
  return Math.floor((dayNumber - 1) / 7);
}

/** Sprays on one zone, newest first, resolved to the active that went on. */
function sprayHistory(state, cycleId, { today = isoDate() } = {}) {
  return (state.sprays || [])
    .filter((s) => s.cycleId === cycleId)
    .filter((s) => s.date && s.date <= today)
    // Copper as a wound spray after pruning is logged as wound care and is
    // excluded from the FRAC rotation check and the interval count (Rev 5.1).
    .filter((s) => s.purpose !== 'wound-care')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((s) => ({ spray: s, active: activeForSpray(state, s) }));
}

/**
 * FR-GATE-05 — spray rotation, by resistance group.
 *
 * The rules are blunt and they are not this app's invention: "never the same
 * IRAC group twice in a row", "never the same FRAC group twice in a row". A
 * brand name has nothing to do with it. Swapping cypermethrin for
 * lambda-cyhalothrin is buying a second bottle of the same thing, and the
 * thrips do not care what is written on it.
 *
 * So the gate reads groups, off the catalogue, and it reads them out of the
 * spray history rather than out of what somebody typed. Four things stop a
 * spray here:
 *
 *   no rate      FR-STOCK-08: nothing with a guessed dose goes on the crop
 *   same group   the group that went on last cannot go on again
 *   metalaxyl    FRAC 4 is "only in rotation, max every 3rd"
 *   Week 10      SR-08: organics only, and no Metalaxyl-M at all
 *
 * The one exception in the rules is Copper Hydroxide from Week 10: it is the
 * only PHI-0 fungicide left, M-groups carry low resistance risk, and repeated
 * M1 is allowed at 10-14 day intervals.
 */
export function rotationCheck(state, cycleId, product, {
  today = isoDate(), windowDays = 60, labelId = null, target = null, week = null, purpose = null,
} = {}) {
  if (!product) return { ok: true };

  const active = activeById(product, state) || findActive(product, state);
  if (!active) return legacyRotationCheck(state, cycleId, product, { today, windowDays });

  // FR-STOCK-08 and the product rule: no rate on file, no spray. A dose nobody
  // can name is the definition of treating by guesswork.
  const usable = canUse(state, active.id, { labelId });
  if (!usable.ok) return { ...usable, active };

  const group = parseGroup(active.group);
  const stage = week == null ? cropWeek(state, cycleId, today) : week;
  const atWeek10 = stage != null && stage >= 10;
  const history = sprayHistory(state, cycleId, { today });

  // SR-08 — from Week 10 both crops are in continuous harvest and only the
  // named organics may be used. A 14-day synthetic has nowhere to fit.
  if (atWeek10 && !allowedInWeek10(active, state)) {
    return {
      ok: false,
      reason: 'week-10',
      active,
      week: stage,
      why: `${active.name} is a synthetic and this zone is in Week ${stage}. `
        + 'From Week 10 the crop is picked continuously, so nothing with a waiting period can go on it.',
      fix: `Organics only from Week 10: ${week10Names().join(', ')}. `
        + 'No synthetic insecticide within 14 days of harvest, and keep a 21-day buffer for export.',
      alternatives: week10Names(),
    };
  }

  // "Metalaxyl-M only in rotation, max every 3rd", and stopped outright from
  // Week 10. Phytophthora is the one disease that can take a house in a week,
  // and this is the only systemic the farm has against it.
  if (carriesCode(active, '4') && group.system === 'FRAC') {
    if (atWeek10) {
      return {
        ok: false,
        reason: 'metalaxyl',
        active,
        week: stage,
        why: `Metalaxyl-M is stopped from Week 10 (SR-08), and this zone is in Week ${stage}.`,
        fix: 'Copper Hydroxide is the Week 10 fungicide: PHI 0, and repeated M1 is allowed at 10-14 day intervals.',
      };
    }
    const lastTwo = history.filter((h) => h.active && parseGroup(h.active.group).system === 'FRAC').slice(0, 2);
    const recentMetalaxyl = lastTwo.find((h) => carriesCode(h.active, '4'));
    if (recentMetalaxyl) {
      return {
        ok: false,
        reason: 'metalaxyl',
        active,
        why: `Metalaxyl-M went on this zone on ${recentMetalaxyl.spray.date}. It is allowed at most every third `
          + 'fungicide spray, and this would be sooner.',
        fix: 'Put two other fungicides through first — Mancozeb, then Copper Oxychloride — and keep Metalaxyl-M '
          + 'for the Phytophthora it is being saved for.',
        group: active.group,
      };
    }
  }

  if (!group.rotates) return { ok: true, active, week: stage, ...usable };

  // Copper on pruning wounds is wound care, not a fungicide programme spray:
  // the rules exclude it from the FRAC rotation check and the interval count
  // both ways round. It is still a chemical with a rate and a waiting period,
  // which is why it gets here at all.
  if (purpose === 'wound-care') return { ok: true, active, week: stage, woundCare: true, ...usable };

  // The rotation itself: what went on last in this system, and was it this group?
  const sameSystem = history.filter((h) => h.active && parseGroup(h.active.group).system === group.system);
  const last = sameSystem[0];

  if (last && sameGroup(last.active, active)) {
    // The one exception in the rules: Copper Hydroxide from Week 10.
    const m1Exception = atWeek10 && group.system === 'FRAC' && group.rotationCodes.includes('M1');
    if (!m1Exception) {
      return rotationBlock(state, active, last, group, { target, week: stage, windowDays });
    }
  }

  // The thrips programme is its own series — "rotate thrips treatments by
  // group, never the same group twice running" — so an unrelated insecticide in
  // between does not reset it. Thrips carry the tospovirus that took Season 1;
  // this is the rotation the farm cannot afford to lose.
  if (isThrips(target)) {
    const lastThrips = history.find((h) => h.active && isThrips(h.spray.targetProblem || h.spray.target));
    if (lastThrips && sameGroup(lastThrips.active, active)) {
      return rotationBlock(state, active, lastThrips, group, { target, week: stage, windowDays, thrips: true });
    }
  }

  return { ok: true, active, week: stage, ...usable };
}

function isThrips(problem) {
  return /thrips/i.test(String(problem || ''));
}

/** A refusal that says what to use instead, because one that does not gets overridden. */
function rotationBlock(state, active, last, group, { target, week, windowDays, thrips = false } = {}) {
  const next = nextInSequence(group.system, last.active.group);
  const options = thrips || isThrips(target)
    ? thripsOptions(state, last.active.group)
      .filter((row) => row.usable.length)
      .map((row) => `${row.group}: ${row.usable.map((a) => a.name).join(' or ')}`)
    : [];
  const alternatives = options.length
    ? options
    : [next && next.product, ...activesOutsideGroup(state, active, group)].filter(Boolean).slice(0, 3);

  return {
    ok: false,
    reason: 'rotation',
    active,
    week,
    group: active.group,
    lastSpray: last.spray,
    next: next || null,
    alternatives,
    why: `${active.name} is ${active.group}, and ${last.active.name} — the same group — went on this zone `
      + `on ${last.spray.date}. ${group.system === 'FRAC' ? 'Never the same FRAC group twice in a row.' : 'Never the same IRAC group twice in a row.'}`,
    fix: thrips || isThrips(target)
      ? `Rotate the thrips programme by group. Next: ${alternatives.join('; ')}.`
      : (next
        ? `Next in the programme is ${next.product} (${next.group}) at ${next.rate || 'the label rate'}.`
        : 'Use an active from a different resistance group this time.'),
    windowDays,
  };
}

/** Usable catalogue actives in the same system but a different group. */
function activesOutsideGroup(state, active, group) {
  return catalogue(state)
    .filter((a) => parseGroup(a.group).system === group.system)
    .filter((a) => !sameGroup(a, active))
    .filter((a) => canUse(state, a.id).ok)
    .map((a) => `${a.name} (${a.group})`);
}

/**
 * The pre-catalogue rotation check, kept for sprays logged against products
 * that never made it into the catalogue. Three applications of one group inside
 * sixty days is where it stops.
 */
function legacyRotationCheck(state, cycleId, productId, { today = isoDate(), windowDays = 60 } = {}) {
  const product = PRODUCT_BY_ID[productId];
  if (!product || product.group === '-') return { ok: true };

  const sameGroupSprays = (state.sprays || [])
    .filter((s) => s.cycleId === cycleId)
    .filter((s) => s.date && daysBetween(s.date, today) <= windowDays)
    .filter((s) => {
      const p = PRODUCT_BY_ID[s.productId];
      return p && p.group === product.group;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Two in a row is the limit, so this one — the third — is the one to stop.
  if (sameGroupSprays.length >= 2) {
    const alternatives = Object.values(PRODUCT_BY_ID)
      .filter((p) => p.kind === product.kind && p.group !== product.group && p.hazard !== 'avoid')
      .slice(0, 3).map((p) => p.name);
    return {
      ok: false,
      reason: 'rotation',
      why: `${product.name} is resistance group ${product.group}, and that group has already gone on `
        + `this zone ${sameGroupSprays.length} times in ${windowDays} days.`,
      fix: alternatives.length
        ? `Use a different group this time — ${alternatives.join(' or ')}.`
        : 'Use a product from a different resistance group this time.',
      group: product.group,
      alternatives,
    };
  }
  return { ok: true };
}

/**
 * Every zone's standing, for the Gates screen and the Owner's digest.
 * Blocked zones come first: a clear zone needs no attention.
 */
export function gateBoard(state, opts = {}) {
  return Object.values(state.plots || {})
    .map((zone) => {
      const verdict = canPlant(state, zone.id, opts);
      const cycle = Object.values(state.cycles || {})
        .find((c) => c.plotId === zone.id && c.status === 'active');
      return {
        zone,
        planted: !!cycle,
        cycle: cycle || null,
        ...verdict,
      };
    })
    .sort((a, b) => (b.blocking.length - a.blocking.length)
      || String(a.zone.name).localeCompare(String(b.zone.name)));
}
