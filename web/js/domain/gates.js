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
import { peekRules, mediaRules } from '../rules.js';
import { rotationVerdict } from './rotation.js';
import { batchLabel, batchesInZone, describeZones, isBagZone, zonesForBatch } from './media.js';

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
  if (isBagZone(state.plots[zoneId])) return mediaPhGate(state, zoneId, { today });
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
  if (isBagZone(state.plots[zoneId])) return mediaNematodeGate(state, zoneId, { today });
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
  if (isBagZone(state.plots[zoneId])) return mediaBatchGate(state, zoneId, { today });
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

// --- Plant bags: Gate 0 on the media batch (FR-GATE-08 to FR-GATE-10) ------
//
// For a bag zone the bed is not what the roots meet; the heap is. So the three
// planting gates keep their ids and their names — an override, the digest and
// the Farm Doctor all go on meaning the same thing — but read the batches the
// zone's bags came from instead of the zone's own soil tests. A test recorded
// against the zone's ground says nothing about a bag, and is not read.
//
// Every batch in the zone must pass. Bags from one good heap and one untested
// heap are a zone with untested media in it.

/**
 * The day one fill is judged on.
 *
 * The bed rule, applied per fill: for an empty zone, today; for a planted one,
 * the day the plants met this media — transplant for bags already standing,
 * or the day the bags went in if they were added after.
 */
function fillJudgedOn(state, zoneId, fill, today) {
  const planted = asOf(state, zoneId, today);
  if (planted === today) return today;
  return fill.date && fill.date > planted ? fill.date : planted;
}

function batchTests(state, batchId) {
  return (state.soilTests || [])
    .filter((t) => t.mediaBatchId === batchId && t.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function pointsIn(test) {
  return Number(test.points || (Array.isArray(test.readings) ? test.readings.length : 0));
}

/** One batch's pH, as of a day. Same range and freshness as a bed, plus the three points. */
export function batchPhCheck(state, batchId, { judged = isoDate() } = {}) {
  const batch = (state.mediaBatches || {})[batchId] || null;
  const label = batchLabel(batch, batchId);
  const test = batchTests(state, batchId).find((t) => t.ph != null && t.date <= judged);

  if (!test) {
    return { state: 'unknown', batchId, why: `No pH reading for the media batch (${label}).`,
      fix: 'Test three points in the heap and record them against the batch.' };
  }
  const age = daysBetween(test.date, judged);
  if (age > GATE_RULES.soilTestMaxAgeDays) {
    return { state: 'fail', batchId, test, why: `The batch pH (${label}) is ${age} days old.`,
      fix: `Re-test the heap. A reading older than ${GATE_RULES.soilTestMaxAgeDays} days does not describe it any more.` };
  }
  if (test.beforeCorrection) {
    return { state: 'fail', batchId, test,
      why: `The batch pH of ${test.ph} (${label}) was taken before lime went into the heap.`,
      fix: 'Re-test the heap after the lime has worked in.' };
  }
  const points = pointsIn(test);
  if (points < 3) {
    return { state: 'fail', batchId, test,
      why: `The batch pH (${label}) is from ${points || 'an unrecorded number of'} point${points === 1 ? '' : 's'}, not three.`,
      fix: 'Take three readings from different parts of the heap and record all three.' };
  }
  const ph = Number(test.ph);
  if (ph < GATE_RULES.phMin || ph > GATE_RULES.phMax) {
    return { state: 'fail', batchId, test,
      why: `The batch pH is ${ph} (${label}), outside ${GATE_RULES.phMin}–${GATE_RULES.phMax}.`,
      fix: ph < GATE_RULES.phMin
        ? 'Lime the heap by its volume (Farm Doctor, lime calculator, plant bags), let it work in, then re-test three points.'
        : 'Bring the heap down with sulphur or organic matter, then re-test three points.' };
  }
  return { state: 'pass', batchId, test,
    why: `Batch ${label}: pH ${ph} from ${points} points, ${test.date}.` };
}

/**
 * One batch's nematode standing.
 *
 * A clean result has to be on file, and fresh, on the day judged. A dirty
 * result counts from the day it is recorded, whenever that is: a batch found
 * dirty after its bags were planted is condemned in every zone that holds them,
 * and a later clean re-test does not un-condemn it. The rules say pull the bags
 * and do not reuse the media; only the Owner's override on the record says
 * otherwise.
 */
export function batchNematodeCheck(state, batchId, { judged = isoDate(), today = isoDate() } = {}) {
  const batch = (state.mediaBatches || {})[batchId] || null;
  const label = batchLabel(batch, batchId);
  const tests = batchTests(state, batchId).filter((t) => t.nematode && t.date <= today);

  const dirty = tests.find((t) => t.nematode !== 'clean');
  if (dirty) {
    const reached = describeZones(zonesForBatch(state, batchId));
    return { state: 'fail', batchId, test: dirty, condemned: true,
      why: `The media batch (${label}) came back ${dirty.nematode} on ${dirty.date}.`
        + (reached ? ` Its bags are in: ${reached}.` : ''),
      fix: 'Pull every bag from this batch in every zone listed, and do not reuse the media. '
        + 'Refill from a batch that has cleared Gate 0.' };
  }

  const clean = tests.find((t) => t.date <= judged);
  if (!clean) {
    return { state: 'unknown', batchId,
      why: tests.length
        ? `The media batch (${label}) was only tested after these bags were planted.`
        : `No nematode assay for the media batch (${label}).`,
      fix: 'Send a sample of the heap for a nematode assay and record the result against the batch.' };
  }
  const age = daysBetween(clean.date, judged);
  if (age > GATE_RULES.nematodeMaxAgeDays) {
    return { state: 'fail', batchId, test: clean,
      why: `The clean assay for the batch (${label}) is ${age} days old.`,
      fix: `Re-test the heap. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers it.` };
  }
  return { state: 'pass', batchId, test: clean, why: `Batch ${label}: nematode clean, ${clean.date}.` };
}

/** Supplier and heap solarisation: the half of Gate 0 that is about where the media came from. */
export function batchRecordCheck(state, batchId, { judged = isoDate(), rules = peekRules() } = {}) {
  const batch = (state.mediaBatches || {})[batchId] || null;
  if (!batch) {
    return { state: 'unknown', batchId, why: 'Bags in this zone name a media batch that is not on record.',
      fix: 'Record the batch — supplier, date and the heap\'s solarisation dates.' };
  }
  const label = batchLabel(batch, batchId);
  const spec = mediaRules(rules);
  if (!spec) {
    // Unknown is not pass: without the rules there is no minimum to hold the heap to.
    return { state: 'unknown', batchId, why: 'The rules file has no plant-bag media section to check this batch against.',
      fix: 'Load rules-1.3 or later.' };
  }
  if (!String(batch.supplier || '').trim()) {
    return { state: 'fail', batchId, why: `The media batch from ${batch.date || 'an unknown date'} names no supplier.`,
      fix: 'Record who supplied or mixed it. A batch nobody can trace cannot be recalled.' };
  }
  const from = batch.solarisedFrom;
  const to = batch.solarisedTo;
  if (!from || !to) {
    return { state: 'fail', batchId, why: `No solarisation dates for the heap (${label}).`,
      fix: `Record when the heap went under plastic and when it came off. It needs ${spec.solarisation_min_days} days or more.` };
  }
  const days = daysBetween(from, to);
  if (!(days >= spec.solarisation_min_days)) {
    return { state: 'fail', batchId, why: `The heap (${label}) was solarised for ${days} days, ${from} to ${to}.`,
      fix: `Solarise for at least ${spec.solarisation_min_days} days, then re-test.` };
  }
  if (to > judged) {
    return { state: 'fail', batchId, why: `The heap (${label}) is under plastic until ${to}.`,
      fix: 'Wait for solarisation to finish before bagging and planting.' };
  }
  return { state: 'pass', batchId, why: `Batch ${label}: supplier recorded, solarised ${days} days (${from} to ${to}).` };
}

const WORST = { fail: 3, unknown: 2, pass: 1 };

/** Run one per-batch check over every fill standing in the zone, and keep the worst. */
function acrossBatches(state, zoneId, today, gateId, name, check) {
  const rows = batchesInZone(state, zoneId);
  if (!rows.length) {
    return gate(gateId, name, 'unknown', {
      why: 'This is a plant-bag zone and no bags from a recorded media batch are in it.',
      fix: 'Fill the bags from a media batch and record the fill (batch, zone, number of bags).',
      media: true,
    });
  }

  const results = [];
  for (const row of rows) {
    // A batch's bags may have gone in on different days; the earliest is the
    // strictest day to judge a clean result on.
    const judged = row.fills.map((f) => fillJudgedOn(state, zoneId, f, today)).sort()[0];
    results.push({ ...check(row.batchId, judged), bags: row.bags });
  }

  const worst = results.reduce((a, b) => (WORST[b.state] > WORST[a.state] ? b : a));
  const bad = results.filter((r) => r.state !== 'pass');
  return gate(gateId, name, worst.state, {
    why: (bad.length ? bad : results).map((r) => r.why).join(' '),
    fix: bad.length ? bad[0].fix : null,
    test: (worst.test || (results.find((r) => r.test) || {}).test) || undefined,
    tests: results.map((r) => r.test).filter(Boolean),
    batches: results,
    condemned: results.some((r) => r.condemned),
    media: true,
  });
}

function mediaPhGate(state, zoneId, { today = isoDate() } = {}) {
  return acrossBatches(state, zoneId, today, 'ph', 'Soil pH tested',
    (batchId, judged) => batchPhCheck(state, batchId, { judged }));
}

function mediaNematodeGate(state, zoneId, { today = isoDate() } = {}) {
  return acrossBatches(state, zoneId, today, 'nematode', 'Nematode clear',
    (batchId, judged) => batchNematodeCheck(state, batchId, { judged, today }));
}

function mediaBatchGate(state, zoneId, { today = isoDate() } = {}) {
  return acrossBatches(state, zoneId, today, 'topsoil', 'Media batch traced',
    (batchId, judged) => batchRecordCheck(state, batchId, { judged }));
}

/**
 * FR-GATE-09 — a media batch on its own: may bags from it go anywhere?
 *
 * Judged as of today, the day someone is about to fill bags from it.
 */
export function mediaBatchStanding(state, batchId, { today = isoDate() } = {}) {
  const checks = [
    { id: 'record', name: 'Supplier and solarisation', ...batchRecordCheck(state, batchId, { judged: today }) },
    { id: 'ph', name: 'Three-point pH', ...batchPhCheck(state, batchId, { judged: today }) },
    { id: 'nematode', name: 'Nematode clear', ...batchNematodeCheck(state, batchId, { judged: today, today }) },
  ];
  const blocking = checks.filter((c) => c.state !== 'pass');
  const zones = zonesForBatch(state, batchId);
  return {
    batchId,
    batch: (state.mediaBatches || {})[batchId] || null,
    ok: blocking.length === 0,
    condemned: checks.some((c) => c.condemned),
    checks,
    blocking,
    zones,
    bagsOut: zones.reduce((n, z) => n + z.bags, 0),
  };
}

/**
 * FR-GATE-10 — every batch with a dirty nematode result, and every zone it
 * reached. `live` is the list still holding bags from it; the digest shouts
 * about those until the last bag is pulled.
 */
export function condemnedBatches(state, { today = isoDate() } = {}) {
  return Object.keys(state.mediaBatches || {})
    .map((id) => mediaBatchStanding(state, id, { today }))
    .filter((s) => s.condemned)
    .map((s) => ({
      ...s,
      failedTest: s.checks.find((c) => c.id === 'nematode').test,
      live: s.zones.filter((z) => z.bags > 0),
    }));
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
export function canTreat(state, cycleId, opts = {}) {
  const { today = isoDate(), productId = null, activeId = null, maxAgeDays = 14 } = opts;
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
  const rotation = rotationCheck(state, cycleId, activeId || productId, { ...opts, today, diagnosis });
  if (!rotation.ok) return rotation;

  return { ok: true, diagnosis };
}

/**
 * FR-GATE-05 — spray rotation, by resistance group.
 *
 * The check itself lives in rotation.js, on the rules file's own IRAC and FRAC
 * sequences, the thrips programme and the Week 10 rule. This is the door it
 * comes through, kept here because the treatment gate and the spray screen both
 * ask the same question: may this go on this zone today?
 *
 * `productRef` is an active-ingredient id, and — because the log is
 * append-only and the farm's history predates the catalogue — also accepts the
 * product id a spray was recorded with before the catalogue existed.
 */
export function rotationCheck(state, cycleId, productRef, opts = {}) {
  return rotationVerdict(state, cycleId, productRef, opts);
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
