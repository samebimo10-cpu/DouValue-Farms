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
 */
export function canTreat(state, cycleId, { today = isoDate(), productId = null, maxAgeDays = 14 } = {}) {
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
  const rotation = rotationCheck(state, cycleId, productId, { today, diagnosis });
  if (!rotation.ok) return rotation;

  return { ok: true, diagnosis };
}

/**
 * FR-GATE-05 — spray rotation.
 *
 * This is the one gate that protects a future season rather than this one.
 * Two consecutive applications from one resistance group is the limit both
 * FRAC and IRAC publish; the third is what breeds a population the product no
 * longer touches.
 */
export function rotationCheck(state, cycleId, productId, { today = isoDate(), windowDays = 60 } = {}) {
  if (!productId) return { ok: true };
  const product = PRODUCT_BY_ID[productId];
  if (!product || product.group === '-') return { ok: true };

  const sameGroup = (state.sprays || [])
    .filter((s) => s.cycleId === cycleId)
    .filter((s) => s.date && daysBetween(s.date, today) <= windowDays)
    .filter((s) => {
      const p = PRODUCT_BY_ID[s.productId];
      return p && p.group === product.group;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Two in a row is the limit, so this one — the third — is the one to stop.
  if (sameGroup.length >= 2) {
    const alternatives = Object.values(PRODUCT_BY_ID)
      .filter((p) => p.kind === product.kind && p.group !== product.group && p.hazard !== 'avoid')
      .slice(0, 3).map((p) => p.name);
    return {
      ok: false,
      reason: 'rotation',
      why: `${product.name} is resistance group ${product.group}, and that group has already gone on `
        + `this zone ${sameGroup.length} times in ${windowDays} days.`,
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
