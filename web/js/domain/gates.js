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
//
// THE MODEL
//
// FR-GATE-06 asks for Gate 0 to Gate 4 from the rules, each with its pass
// conditions and its evidence, on one screen per zone — plus the clean-restart
// protocol for GH-04 and GH-05. gateModel() below is that model. Each gate is
// the rules' own entry (name, when, pass_all, evidence, source), and each
// pass_all line is a condition judged from records. The gates that stop a
// transplant (G0, the clean restart, G1, and G4 of the previous cycle) are what
// canPlant() reads; G2 and G3 are shown with their state, and G3 is the
// treatment gate canTreat() enforces.

import { addDays, daysBetween, isoDate } from '../util.js';
import { gateSpec, peekRules } from '../rules.js';
import { rotationVerdict } from './rotation.js';
import { alerts } from './alerts.js';
import { GATE_ITEMS, gateItem } from './doctor.js';
import { isNursery, protocolOf } from './farm.js';
import { releasedFor } from './nursery.js';
import {
  BARRIERS, bagRules, batchFailure, batchName, batchesIn, fillsFor, galledCycle, mediaOf,
} from './media.js';
import { mediaLimePlan } from './calc.js';

/**
 * Gate thresholds.
 *
 * pH 5.5–7.0 and the 5.2 hold line are the rules' soil_ph_gate (C-5). The
 * 90-day freshness window is FR-GATE-01 (requirements v1.5): soil and pH
 * results must be sampled after the previous cycle in the zone ended and no
 * more than 90 days before transplant. It applies to the nematode assay as
 * well as the pH, because the requirement names both.
 */
export const GATE_RULES = {
  phMin: 5.5,
  phMax: 7.0,
  phHoldBelow: 5.2,
  holdRetestDays: 10,
  threePoints: 3,
  soilTestMaxAgeDays: 90,
  nematodeMaxAgeDays: 90,
};

export const GATE_STATE = {
  pass: { label: 'Clear', tone: 'ok', icon: '✓' },
  fail: { label: 'Blocked', tone: 'danger', icon: '✕' },
  unknown: { label: 'Not tested', tone: 'danger', icon: '✕' },
  held: { label: 'Held', tone: 'warn', icon: '!' },
  overridden: { label: 'Overridden', tone: 'warn', icon: '!' },
  waiting: { label: 'Not yet', tone: 'muted', icon: '·' },
  na: { label: 'Not applicable', tone: 'muted', icon: '·' },
};

/** States that let an action through. Everything else blocks. */
const OPEN = new Set(['pass', 'overridden', 'waiting', 'na']);
export const isBlocking = (condition) => !OPEN.has(condition.state);

/** Ranks, mirroring web/js/store.js. Used to check who signed what. */
const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOfId = (state, id) => {
  const p = ((state && state.people) || {})[id];
  return (p && RANK[p.role]) || 0;
};

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

/**
 * The day a gate is being asked about, and the window its evidence must sit in.
 *
 * FR-GATE-01 puts a freshness window on the soil test, but the window is a
 * condition on *planting*, not a clock that keeps running afterwards. Judged
 * against today, a bed correctly cleared before transplant turns red ninety
 * days later and the app starts re-blocking ground that passed its checks —
 * which teaches people the red means nothing.
 *
 * So for a zone with a crop in it, the question is "was this true when the
 * crop went in?", and the answer never changes again. For an empty zone it is
 * "is it true now?", which is the decision actually in front of someone.
 *
 * `since` is the day the previous cycle in the zone ended. Evidence from
 * before it describes the last crop's ground, not this one's.
 */
export function zoneWindow(state, zoneId, today = isoDate()) {
  const cycles = Object.values((state && state.cycles) || {}).filter((c) => c.plotId === zoneId);
  const active = cycles
    .filter((c) => c.status === 'active')
    .sort((a, b) => ((a.transplantDate || '') < (b.transplantDate || '') ? 1 : -1))[0] || null;
  const judged = (active && active.transplantDate) || today;
  const previous = cycles
    .filter((c) => c !== active && c.status === 'closed' && c.closedAt && c.closedAt <= judged)
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))[0] || null;
  return { today, judged, active, previous, since: previous ? previous.closedAt : null };
}

function gate(id, name, state, extra = {}) {
  return { id, name, state, why: '', fix: null, ...extra };
}

// --- FR-GATE-01 — the pH gate ------------------------------------------------

const readingsOf = (t) => (Array.isArray(t.readings) ? t.readings.map(Number).filter(Number.isFinite) : []);
const pointsOf = (t) => readingsOf(t).length || Number(t.points) || 0;
const lowOf = (t) => (readingsOf(t).length ? Math.min(...readingsOf(t)) : Number(t.ph));
const highOf = (t) => (readingsOf(t).length ? Math.max(...readingsOf(t)) : Number(t.ph));

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

function phText(key) {
  const g = ((peekRules() || {}).soil_and_water || {}).soil_ph_gate || {};
  return g[key] || '';
}

/**
 * FR-GATE-01 — the pH gate.
 *
 * A reading opens it only when all of this is true:
 *
 *   - it was sampled after the previous cycle here ended, and no more than 90
 *     days before transplant;
 *   - it was taken after any lime correction;
 *   - it is a three-point test, from a meter calibrated that morning at pH 4.0
 *     and 7.0, with a photo of the meter (rules → soil_ph_gate.test, Gate 0);
 *   - every one of the three points is inside 5.5–7.0. A mean can hide an
 *     acid corner, so the lowest point decides the hold and the highest point
 *     decides the upper limit;
 *   - it is not a re-test taken inside the 10-day hold after a low reading.
 *
 * Below 5.2 and 5.2–5.49 are the two hold rules (C-5), and each says what to
 * do in the rules' own words.
 */
export function phGate(state, zoneId, { today = isoDate() } = {}) {
  const w = zoneWindow(state, zoneId, today);
  if (mediaOf(state, zoneId, w.active) === 'bag') return bagGate(state, zoneId, w, 'ph');
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  const tests = (state.soilTests || [])
    .filter((t) => t.ph != null && t.ph !== '')
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= w.judged)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return judgePh(tests, {
    judged: w.judged,
    since: w.since,
    none: {
      why: 'No pH reading has been recorded for this zone.',
      fix: 'Take a three-point pH test and record it under Soil tests. Planting stays blocked until then.',
    },
    early: (test) => (w.since && test.zoneId === zoneId && test.date <= w.since ? {
      why: `The last pH reading (${test.date}) was taken before the previous cycle here ended on ${w.since}.`,
      fix: 'Re-sample. FR-GATE-01: the pH must be sampled after the last cycle in this zone ended.',
    } : null),
  });
}

/**
 * The pH judgement itself, on the tests for one place, newest first. The bed
 * and a plant-bag media batch are judged by exactly the same rules; only what
 * counts as "too early" and the words for the fix differ. `lowFix` lets a
 * batch replace the bed's lime advice with lime by media volume.
 */
function judgePh(tests, { judged, since = null, none, early, lowFix = null }) {
  const name = 'Soil pH tested';
  const test = tests[0];

  if (!test) return gate('ph', name, 'unknown', none);

  const tooEarly = early(test);
  if (tooEarly) return gate('ph', name, 'fail', { ...tooEarly, test });

  const age = daysBetween(test.date, judged);
  if (age > GATE_RULES.soilTestMaxAgeDays) {
    return gate('ph', name, 'fail', {
      why: `The last pH reading is ${age} days old (${test.ph} on ${test.date}).`,
      fix: `Re-test. A reading older than ${GATE_RULES.soilTestMaxAgeDays} days does not describe this soil any more.`,
      test,
    });
  }

  if (test.beforeCorrection) {
    return gate('ph', name, 'fail', {
      why: `The reading of ${test.ph} was taken before lime was applied, so it does not say where the soil is now.`,
      fix: 'Re-test after the lime has worked in and record that reading.',
      test,
    });
  }

  const points = pointsOf(test);
  if (points < GATE_RULES.threePoints) {
    return gate('ph', name, 'fail', {
      why: `pH ${test.ph} on ${test.date} is from ${points || 'an unrecorded number of'} sampling point${points === 1 ? '' : 's'}.`,
      fix: `Gate 0 asks for a three-point test: ${phText('test') || 'three points per block'}. Record all three readings.`,
      test,
    });
  }
  if (!test.calibrated) {
    return gate('ph', name, 'fail', {
      why: `The three-point reading on ${test.date} does not record the meter being calibrated that morning.`,
      fix: 'Calibrate the meter at pH 4.0 and 7.0 on the morning of the test, then re-test and tick it on the record.',
      test,
    });
  }
  if (!test.photo) {
    return gate('ph', name, 'fail', {
      why: `The three-point reading on ${test.date} has no photo of the meter.`,
      fix: 'Gate 0 wants the meter photo on file. Re-test and photograph the reading.',
      test,
    });
  }

  const low = lowOf(test);
  const high = highOf(test);
  const retestFrom = isoDate(addDays(test.date, GATE_RULES.holdRetestDays));
  const shown = readingsOf(test).length ? readingsOf(test).join(', ') : String(test.ph);
  const lowered = (verdict) => (lowFix ? { ...verdict, ...lowFix(verdict, test, tests) } : verdict);

  if (low < GATE_RULES.phHoldBelow) {
    return lowered(gate('ph', name, 'fail', {
      hold: 'below_5_2',
      why: `pH ${low} (points ${shown}) is below ${GATE_RULES.phHoldBelow}.`,
      fix: `${phText('below_5_2') || 'Apply half the original lime rate again and wait 10 days.'} `
        + `Re-test no sooner than ${retestFrom}.`,
      retestFrom,
      test,
    }));
  }
  if (low < GATE_RULES.phMin) {
    return lowered(gate('ph', name, 'held', {
      hold: '5_2_to_5_49',
      why: `pH ${low} (points ${shown}) is between ${GATE_RULES.phHoldBelow} and ${GATE_RULES.phMin}: the block is held.`,
      fix: `${phText('5_2_to_5_49') || 'Hold; re-test after 10 days.'} Re-test on or after ${retestFrom}.`,
      retestFrom,
      test,
    }));
  }
  if (high > GATE_RULES.phMax) {
    return gate('ph', name, 'fail', {
      why: `pH ${high} (points ${shown}) is above ${GATE_RULES.phMax}, outside the ${GATE_RULES.phMin}–${GATE_RULES.phMax} range peppers need.`,
      fix: 'Bring it down with sulphur or organic matter, then re-test and record the corrected reading.',
      test,
    });
  }

  // The hold is a wait, not only a number: a passing re-test taken inside the
  // ten days after a low reading has not waited out the hold.
  const heldBy = tests.slice(1).find((t) => (!since || t.date > since)
    && lowOf(t) < GATE_RULES.phMin && daysBetween(t.date, test.date) < GATE_RULES.holdRetestDays);
  if (heldBy) {
    const from = isoDate(addDays(heldBy.date, GATE_RULES.holdRetestDays));
    return gate('ph', name, 'held', {
      hold: 'retest_too_soon',
      why: `pH ${low} on ${test.date} is in range, but only ${daysBetween(heldBy.date, test.date)} days after `
        + `the reading of ${lowOf(heldBy)} on ${heldBy.date} that put the block on hold.`,
      fix: `The hold is re-tested after ${GATE_RULES.holdRetestDays} days. Re-test on or after ${from}.`,
      retestFrom: from,
      test,
    });
  }

  return gate('ph', name, 'pass', {
    why: `pH ${shown} from ${points} points, recorded ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
    test,
  });
}

/**
 * FR-GATE-02 — the nematode gate.
 *
 * This is the one that cost Season 1. Root-knot nematode is invisible until the
 * plants are already failing, and by then the ground is the problem, not the
 * crop. Nothing goes in without a clean lab result on the record — Gate 0 asks
 * for a lab report, so a clean result must say which lab gave it.
 */
export function nematodeGate(state, zoneId, { today = isoDate() } = {}) {
  const zone = state.plots[zoneId];
  const batchId = zone && zone.topsoilBatchId;
  const w = zoneWindow(state, zoneId, today);
  if (mediaOf(state, zoneId, w.active) === 'bag') return bagGate(state, zoneId, w, 'nematode');
  const name = 'Nematode clear';

  const tests = (state.soilTests || [])
    .filter((t) => t.nematode)
    .filter((t) => t.zoneId === zoneId || (batchId && t.batchId === batchId))
    .filter((t) => t.date && t.date <= w.judged)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const test = tests[0];
  if (!test) {
    return gate('nematode', name, 'unknown', {
      why: 'No nematode test has been recorded for this zone or for the topsoil in it.',
      fix: 'Send a soil sample for a nematode test and record the result. This is the check Season 1 was lost for.',
    });
  }

  if (w.since && test.zoneId === zoneId && test.date <= w.since) {
    return gate('nematode', name, 'fail', {
      why: `The last nematode result (${test.date}) is from before the previous cycle here ended on ${w.since}.`,
      fix: 'Re-sample. FR-GATE-01: soil results must be sampled after the last cycle in this zone ended.',
      test,
    });
  }

  const age = daysBetween(test.date, w.judged);
  if (age > GATE_RULES.nematodeMaxAgeDays) {
    return gate('nematode', name, 'fail', {
      why: `The clean result is ${age} days old (${test.date}).`,
      fix: `Re-test. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers this ground.`,
      test,
    });
  }

  if (test.nematode !== 'clean') {
    return gate('nematode', name, 'fail', {
      why: `The test on ${test.date} came back ${test.nematode}.`,
      fix: 'Do not plant peppers here. Solarise or rotate to a non-host — maize or a resistant cover — '
        + 'and re-test before this zone carries a crop again.',
      test,
    });
  }

  if (!String(test.lab || '').trim()) {
    return gate('nematode', name, 'fail', {
      why: `The clean result on ${test.date} does not name the lab that gave it.`,
      fix: 'Record which lab tested it and keep the report. Gate 0 asks for a lab report, not a note.',
      test,
    });
  }

  return gate('nematode', name, 'pass', {
    why: `${test.lab} returned clean ${test.date}${age ? ` (${age} days ago)` : ' today'}.`,
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
export function batchGate(state, zoneId) {
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

  const clean = (state.soilTests || []).filter((t) => t.batchId === batchId && t.nematode === 'clean');
  if (!clean.length) {
    return gate('topsoil', 'Topsoil tested', 'fail', {
      why: `Batch from ${batch.supplier || 'an unnamed supplier'} (${batch.date || 'no date'}) has no clean test.`,
      fix: 'Test the batch before anything is planted into it. An untested load can carry nematodes '
        + 'straight into a clean house.',
      batch,
    });
  }
  if (!clean.some((t) => String(t.lab || '').trim())) {
    return gate('topsoil', 'Topsoil tested', 'fail', {
      why: `Batch from ${batch.supplier || 'an unnamed supplier'} tested clean, but no lab is named on the result.`,
      fix: 'Record which lab tested the batch. A clean result nobody can trace is not a lab report.',
      batch,
    });
  }

  return gate('topsoil', 'Topsoil tested', 'pass', {
    why: `Batch from ${batch.supplier || 'supplier not named'} tested clean.`,
    batch,
  });
}

// --- Plant-bag zones: Gate 0 clears on the media batch (C-19) -----------------

/** Rules → plant_bags.gate_0.pass_all, one label per bag-zone G0 line. */
export const BAG_G0_ITEMS = ['media_batch', 'ph_three_point', 'lab_report', 'heap_solarisation', 'bag_barrier'];

export function bagG0Label(itemId, rules = peekRules()) {
  const lines = ((bagRules(rules) || {}).gate_0 || {}).pass_all || [];
  return lines[BAG_G0_ITEMS.indexOf(itemId)] || itemId.replace(/_/g, ' ');
}

const batchTests = (state, batchId, judged, key) => (state.soilTests || [])
  .filter((t) => t.mediaBatchId === batchId)
  .filter((t) => (key === 'ph' ? t.ph != null && t.ph !== '' : !!t.nematode))
  .filter((t) => t.date && t.date <= judged)
  .sort((a, b) => (a.date < b.date ? 1 : -1));

/**
 * One media batch's own Gate 0 lines, as of a day: the record (supplier,
 * delivery date, not rejected, not failed), the three-point pH, the nematode
 * lab result, and the heap's solarisation dates if it was covered. These are
 * what filling a bag from the batch needs (rules → plant_bags.fill_rule), and
 * what a bag zone's Gate 0 reads for every batch in its bags.
 */
export function batchLines(state, batchId, { judged = isoDate() } = {}) {
  const batch = ((state && state.mediaBatches) || {})[batchId] || null;
  const who = batchName(batch);
  if (!batch) {
    const missing = gate('media_batch', 'Media batch', 'unknown', {
      why: 'The bags name a media batch that is not on record.',
      fix: 'Record the delivery as a media batch, with its supplier and date, and test it.',
    });
    return { batch: null, record: missing, ph: missing, nematode: missing, heap: missing };
  }
  const delivered = batch.deliveredDate || null;

  // The record.
  let record;
  const failure = batchFailure(state, batchId);
  if (batch.rejected) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} was rejected on ${batch.rejected.date}: ${batch.rejected.reason}.`,
      fix: 'A rejected batch fills no bags. Empty any bags filled from it and fill them from a batch that has cleared.',
      batch,
    });
  } else if (failure && failure.date <= judged) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} failed on ${failure.date}: ${failure.why}.`,
      fix: 'Empty and discard the bags filled from it. Refill from a batch that has cleared Gate 0.',
      batch, failure,
    });
  } else if (!String(batch.supplier || '').trim() || !delivered) {
    record = gate('media_batch', 'Media batch', 'fail', {
      why: `${who} does not record ${!String(batch.supplier || '').trim() ? 'its supplier' : 'its delivery date'}.`,
      fix: 'Correct the batch record: the supplier and the day it was delivered. A batch nobody can trace is not cleared.',
      batch,
    });
  } else {
    record = gate('media_batch', 'Media batch', 'pass', {
      why: `${who}: ${batch.supplier}, delivered ${delivered}${batch.volumeM3 ? `, ${batch.volumeM3} m³` : ''}.`,
      batch,
    });
  }

  // The pH, judged by the same rules as a bed, with lime by media volume.
  const phTests = batchTests(state, batchId, judged, 'ph');
  const ph = judgePh(phTests, {
    judged,
    none: {
      why: `No pH reading has been recorded for ${who}.`,
      fix: 'Take a three-point pH test of the batch and record it against the batch. No bag is filled until then.',
    },
    early: (test) => (delivered && test.date < delivered ? {
      why: `The last pH reading of ${who} (${test.date}) is from before it was delivered on ${delivered}.`,
      fix: 'Re-test the batch as delivered, at three points.',
    } : null),
    lowFix: (verdict, test, all) => batchLimeFix(batch, verdict, test, all, judged),
  });

  // The nematode lab result.
  let nematode;
  const nt = batchTests(state, batchId, judged, 'nematode')[0];
  if (!nt) {
    nematode = gate('nematode', 'Nematode clear', 'unknown', {
      why: `No nematode test has been recorded for ${who}.`,
      fix: 'Send a sample of the batch for a nematode assay and record the result against the batch.',
    });
  } else if (delivered && nt.date < delivered) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The nematode result for ${who} (${nt.date}) is from before it was delivered on ${delivered}.`,
      fix: 'Sample the batch as delivered and send it to the lab.', test: nt,
    });
  } else if (daysBetween(nt.date, judged) > GATE_RULES.nematodeMaxAgeDays) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The clean result for ${who} is ${daysBetween(nt.date, judged)} days old (${nt.date}).`,
      fix: `Re-test. After ${GATE_RULES.nematodeMaxAgeDays} days a clean result no longer covers this media.`, test: nt,
    });
  } else if (nt.nematode !== 'clean') {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The test of ${who} on ${nt.date} came back ${nt.nematode}.`,
      fix: 'Reject the batch. Media carrying nematodes goes into no bag on this farm.', test: nt,
    });
  } else if (!String(nt.lab || '').trim()) {
    nematode = gate('nematode', 'Nematode clear', 'fail', {
      why: `The clean result for ${who} on ${nt.date} does not name the lab that gave it.`,
      fix: 'Record which lab tested it and keep the report. Gate 0 asks for a lab report, not a note.', test: nt,
    });
  } else {
    const age = daysBetween(nt.date, judged);
    nematode = gate('nematode', 'Nematode clear', 'pass', {
      why: `${nt.lab} returned ${who} clean ${nt.date}${age ? ` (${age} days ago)` : ' today'}.`, test: nt,
    });
  }

  // The heap's solarisation dates, if it was covered.
  let heap;
  if (!batch.covered) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'pass', {
      why: `${who}: the heap was not covered, so there are no solarisation dates to record.`,
    });
  } else if (!batch.coverFrom) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'fail', {
      why: `${who} was covered but the day the plastic went on is not recorded.`,
      fix: 'Correct the batch record: the day the plastic went on and the day it was lifted.',
    });
  } else if (!batch.coverTo || batch.coverTo > judged) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'held', {
      why: `${who} has been under plastic since ${batch.coverFrom}.`,
      fix: 'Record the day the plastic was lifted. Nothing is filled from a heap still under plastic.',
    });
  } else if (batch.coverTo < batch.coverFrom) {
    heap = gate('heap_solarisation', 'Heap solarisation', 'fail', {
      why: `${who}: the plastic is recorded as lifted (${batch.coverTo}) before it went on (${batch.coverFrom}).`,
      fix: 'Correct the solarisation dates on the batch record.',
    });
  } else {
    heap = gate('heap_solarisation', 'Heap solarisation', 'pass', {
      why: `${who}: under plastic ${batch.coverFrom} to ${batch.coverTo} (${daysBetween(batch.coverFrom, batch.coverTo)} days).`,
    });
  }

  return { batch, record, ph, nematode, heap };
}

/**
 * Lime for a batch whose pH is low: by media volume, not bed area (C-19). When
 * no rate can be derived the batch is corrected or rejected — the gate says so
 * rather than passing on the bed's advice, which is written per 100 m².
 */
function batchLimeFix(batch, verdict, test, tests, judged) {
  const earlier = tests.slice(1).find((t) => lowOf(t) < GATE_RULES.phMin
    && daysBetween(t.date, test.date) >= GATE_RULES.holdRetestDays);
  let plan;
  try {
    plan = mediaLimePlan({
      readings: readingsOf(test), texture: batch.texture || null, volumeM3: batch.volumeM3,
      covered: !!batch.covered, lastLime: tests.some((t) => t.beforeCorrection) ? {} : null,
      holdSince: verdict.hold === '5_2_to_5_49' && earlier ? earlier.date : null, today: judged,
    });
  } catch (err) {
    plan = { derivable: false, why: 'The rules are not loaded, so no lime rate can be read.', fix: '' };
  }
  if (plan.noLime) return {};
  if (!plan.derivable) {
    return {
      state: 'fail',
      noRate: true,
      limePlan: plan,
      fix: `No lime rate can be derived for this batch: ${plan.why} ${plan.fix} `
        + 'The batch is corrected or rejected before any bag is filled from it.',
    };
  }
  return {
    limePlan: plan,
    fix: `${plan.headline} ${plan.steps.slice(1).join(' ')}`,
  };
}

/**
 * Rules → plant_bags.fill_rule: may bags be filled from this batch today? The
 * batch's own four lines must all pass. The reducer re-runs this on every
 * replay, so a phone cannot sync its way to a fill from an untested heap.
 */
export function fillCheck(state, batchId, { date = isoDate() } = {}) {
  const lines = batchLines(state, batchId, { judged: date });
  const items = [lines.record, lines.ph, lines.nematode, lines.heap];
  const blocking = items.filter((c) => c.state !== 'pass');
  return {
    ok: blocking.length === 0,
    items,
    blocking,
    lines,
    why: blocking.length ? blocking.map((c) => `${c.why} ${c.fix || ''}`.trim()).join(' ') : null,
  };
}

/**
 * A bag zone's Gate 0 line, over every batch in its bags. The bags must have
 * been filled after the previous cycle here ended — media left in from the
 * last crop is the last crop's ground — and every batch in them must pass.
 */
function bagGate(state, zoneId, w, which) {
  const window = { since: w.since, until: w.judged };
  const batches = batchesIn(state, zoneId, window);
  const id = which === 'record' ? 'media_batch' : which === 'heap' ? 'heap_solarisation' : which;
  const name = { media_batch: 'Media batch', ph: 'Soil pH tested', nematode: 'Nematode clear',
    heap_solarisation: 'Heap solarisation' }[id];

  if (!batches.length) {
    const earlier = fillsFor(state, zoneId, { until: w.judged }).length;
    return gate(id, name, 'unknown', {
      why: earlier && w.since
        ? `The bags here were filled before the previous cycle ended on ${w.since}. That media grew the last crop.`
        : 'No bags have been filled here from a media batch, so there is no media to judge.',
      fix: 'Fill the bags from a media batch that has cleared its own checks (supplier, three-point pH, '
        + 'nematode CLEAR, heap dates if covered). The fill is recorded batch → bags → zone.',
    });
  }

  const judged = batches.map(({ id: batchId }) => batchLines(state, batchId, { judged: w.judged })[which]);
  const bad = judged.find((c) => c.state !== 'pass');
  if (bad) return { ...bad, id, name };
  return gate(id, name, 'pass', {
    why: judged.map((c) => c.why).join(' '),
    test: judged[0].test,
    batches: batches.map((b) => b.id),
  });
}

/** Rules → plant_bags.barrier: whether the bags stand on a barrier, recorded. */
export function barrierGate(state, zoneId) {
  const zone = ((state && state.plots) || {})[zoneId] || {};
  const b = BARRIERS.find((x) => x.value === zone.barrier);
  if (!b) {
    return gate('bag_barrier', 'Bag barrier', 'unknown', {
      why: 'Whether the bags stand on a barrier is not recorded.',
      fix: 'Record it on the zone: ground cover, polythene, or none.',
    });
  }
  return gate('bag_barrier', 'Bag barrier', 'pass', {
    why: b.value === 'none'
      ? `${b.label}. ${((bagRules() || {}).barrier || {}).why || ''}`.trim()
      : `Bags stand on ${b.label.toLowerCase()}.`,
  });
}

/** Gate 0's media lines for a bag zone, for the model and the Farm Doctor. */
export function bagG0(state, zoneId, { today = isoDate() } = {}) {
  const w = zoneWindow(state, zoneId, today);
  return {
    media_batch: bagGate(state, zoneId, w, 'record'),
    ph_three_point: bagGate(state, zoneId, w, 'ph'),
    lab_report: bagGate(state, zoneId, w, 'nematode'),
    heap_solarisation: bagGate(state, zoneId, w, 'heap'),
    bag_barrier: barrierGate(state, zoneId),
  };
}

/**
 * The clean restart in a bag zone (rules → plant_bags.clean_restart): step 3
 * is fresh or re-treated media rather than solarising a bed. Media left in the
 * bags from the last crop does not count, a re-treated batch says how it was
 * treated, and bags from a galled crop are discarded, not refilled.
 */
function freshMedia(state, zone, w, step) {
  const base = { id: `cr_${step.id}`, gate: 'CR', name: `Step ${step.step} — ${step.name}`, itemId: step.id,
    lines: step.pass_all || [] };
  const fills = fillsFor(state, zone.id, { since: w.since, until: w.judged });
  if (!fills.length) {
    return { ...base, state: 'unknown', why: 'No bags have been filled for this restart.',
      fix: `Fill the bags ${step.when}: ${(step.pass_all || []).join('; ')}.` };
  }
  const batches = state.mediaBatches || {};
  const galled = w.previous ? galledCycle(state, w.previous) : { galled: false };
  for (const f of fills) {
    const b = batches[f.batchId];
    const who = batchName(b);
    if (!b || !['fresh', 're-treated'].includes(b.source)) {
      return { ...base, state: 'fail', why: `${who} is not recorded as fresh or re-treated media.`,
        fix: 'Correct the batch record, or fill from a fresh or re-treated batch. Media left in from the last crop does not count.' };
    }
    if (b.source === 're-treated' && !String(b.treatment || '').trim()) {
      return { ...base, state: 'fail', why: `${who} is re-treated media with no record of how it was treated.`,
        fix: 'Record the treatment on the batch (for example: solarised under sealed plastic, with dates).' };
    }
    const from = b.fromCycleId && (state.cycles || {})[b.fromCycleId];
    const fromGalled = from ? galledCycle(state, from) : null;
    if (b.source === 're-treated' && fromGalled && fromGalled.galled) {
      return { ...base, state: 'fail', why: `${who} is media from a galled crop: ${fromGalled.why}.`,
        fix: 'Media from a galled crop is discarded, not re-treated. Fill from a fresh batch.' };
    }
    if (galled.galled && !f.newBags) {
      return { ...base, state: 'fail', why: `The last crop here was galled (${galled.why}), and the fill on ${dayOf(f)} reused its bags.`,
        fix: 'Bags from a galled crop are discarded, not refilled. Fill new bags and record them as new.' };
    }
  }
  return { ...base, state: 'pass', from: { kind: 'media-fill', id: fills[fills.length - 1].id },
    why: `${fills.length} fill${fills.length === 1 ? '' : 's'} for this restart, from `
      + `${[...new Set(fills.map((f) => `${batchName(batches[f.batchId])} (${batches[f.batchId].source})`))].join(', ')}`
      + `${galled.galled ? '; the last crop was galled and every bag is new' : ''}.` };
}

// --- FR-GATE-00 — the sign-off on Gate 0 and Gate 4 --------------------------

/**
 * FR-GATE-00: there is no site agronomist. Gate 0 and Gate 4 clear only after
 * the Farm Doctor check, the Farm Manager's confirmation and the Owner's
 * approval — three different records, in that order.
 *
 * For Gate 0 the check is a saved Farm Doctor gate review for this zone that
 * found nothing else missing on Gate 0 at the time it was run. A review that
 * listed missing evidence is not made good by somebody confirming it: the
 * Farm Manager confirms what the Doctor found, and what it found was "not yet".
 *
 * For Gate 4 the check is the Farm Doctor's cycle review of that cycle.
 */
export function gateSignoff(state, zoneId, gateId, { since = null, until = isoDate(), cycleId = null } = {}) {
  const isG0 = gateId === 'G0';
  const id = isG0 ? 'doctor_check' : 'g4_signoff';
  const name = isG0
    ? (((gateSpec('G0') || {}).pass_all || [])[2] || 'Farm Doctor check passed, confirmed by Farm Manager and approved by Owner')
    : 'Farm Doctor cycle review, confirmed by Farm Manager and approved by Owner (FR-GATE-00)';

  const review = ((state && state.doctorOutputs) || [])
    .filter((o) => (isG0
      ? o.kind === 'gate-review' && (o.subject || {}).zoneId === zoneId
        && (!Array.isArray((o.subject || {}).gates) || o.subject.gates.includes('G0'))
      : o.kind === 'cycle-review' && (o.subject || {}).cycleId === cycleId))
    .filter((o) => dayOf(o) <= until && (!since || dayOf(o) > since))
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];

  const c = (state2, why, fix, extra = {}) => ({ id, gate: gateId, name, state: state2, why, fix, ...extra });

  if (!review) {
    return c('unknown', isG0 ? 'No Farm Doctor gate check has been saved for this zone since the last cycle ended.'
      : 'The Farm Doctor has not drafted the cycle review for this cycle.',
    isG0 ? 'Record the evidence, then save the Farm Doctor gate check; the Farm Manager confirms and the Owner approves.'
      : 'Ask the Farm Doctor to draft the cycle review from the season\'s records; the Farm Manager confirms and the Owner approves.');
  }
  const from = { kind: 'doctor-output', id: review.id };

  if (isG0) {
    const section = (review.gates || []).find((g) => g.id === 'G0');
    const gaps = section ? (section.missing || []).filter((m) => m.id !== 'doctor_check') : null;
    if (!gaps) {
      return c('fail', `The gate check saved ${dayOf(review)} does not show Gate 0's evidence.`,
        'Save a fresh Farm Doctor gate check for this zone.', { from });
    }
    if (gaps.length) {
      return c('fail', `The Farm Doctor check on ${dayOf(review)} found Gate 0 incomplete: `
        + `${gaps.map((m) => m.label || m.id).join('; ')}.`,
      'Record what is missing, then run and save the Farm Doctor check again.', { from });
    }
  }

  if (!review.confirmedBy || rankOfId(state, review.confirmedBy) < RANK.manager) {
    return c('fail', `The Farm Doctor check from ${dayOf(review)} is waiting for the Farm Manager to confirm it.`,
      'The Farm Manager confirms it. The Farm Doctor never confirms its own work (FR-DOC-08).', { from });
  }
  if (!review.approvedBy || rankOfId(state, review.approvedBy) < RANK.ceo) {
    return c('fail', 'The Farm Manager has confirmed it; the Owner has not approved it yet.',
      'FR-GATE-00: the Owner approves Gate 0 and Gate 4.', { from });
  }
  return c('pass', `Checked ${dayOf(review)}, confirmed by the Farm Manager and approved by the Owner.`, null, { from });
}

// --- The clean-restart protocol (GH-04, GH-05) -------------------------------

/**
 * Rules → clean_restart. Each step is recorded under gate "CR" by whoever did
 * it, after the previous cycle in the house ended. The host-free fallow also
 * has a length: the break from the day the old crop came out to transplant is
 * at least the step's `min_days`.
 */
function cleanRestart(state, zone, w, rules) {
  const spec = rules && rules.clean_restart;
  if (!spec || protocolOf(zone, rules) !== 'clean-restart') return null;

  const recorded = (itemId) => latestEvidence(state, 'CR', zone.id, itemId, { since: w.since, until: w.judged });
  // A bag zone restarts on fresh or re-treated media instead of a solarised
  // bed (rules → plant_bags.clean_restart). Every other step is the same.
  const bags = mediaOf(state, zone.id, w.active) === 'bag' && ((bagRules(rules) || {}).clean_restart || null);
  const conditions = (spec.steps || []).map((step) => {
    if (bags && step.id === bags.replaces_step) return freshMedia(state, zone, w, bags.step);
    const rec = recorded(step.id);
    const base = { id: `cr_${step.id}`, gate: 'CR', name: `Step ${step.step} — ${step.name}`, itemId: step.id, lines: step.pass_all || [] };
    if (!rec) {
      return { ...base, state: 'unknown', why: `Not recorded for this restart (${step.when}).`,
        fix: `Do it and record it: ${(step.pass_all || []).join('; ')}.` };
    }
    if (step.min_days) {
      const out = recorded((spec.steps[0] || {}).id);
      const days = out ? daysBetween(dayOf(out), w.judged) : null;
      if (days == null || days < step.min_days) {
        return { ...base, state: 'held', from: { kind: 'gate-evidence', id: rec.id },
          why: days == null ? 'The fallow is recorded but the day the old crop came out is not.'
            : `The house has been host-free for ${days} days.`,
          fix: `The minimum host-free break is ${step.min_days} days from the day the old crop came out.` };
      }
    }
    const timing = step.cover_days ? coverTiming(step, rec, w)
      : step.within_hours_before_transplant ? knockdownTiming(step, rec, w) : null;
    if (timing) return { ...base, from: { kind: 'gate-evidence', id: rec.id }, ...timing };
    return { ...base, state: 'pass', from: { kind: 'gate-evidence', id: rec.id },
      why: `Recorded ${dayOf(rec)}${rec.note ? ` — ${rec.note}` : ''}.` };
  });

  return {
    id: 'CR',
    name: spec.name || 'Clean-restart protocol',
    when: 'between cycles, before transplant',
    source: spec.source || null,
    evidence: 'each step recorded, with a photo',
    blocksAction: 'transplant',
    blocksTransplant: true,
    why: spec.why || '',
    note: [spec.timing_note, spec.after_replant].filter(Boolean).join(' '),
    rule: spec.gate_rule || '',
    conditions,
  };
}

/**
 * Step 3: solarisation is one continuous span under sealed plastic, 21 to 28
 * days (rules → clean_restart.steps[].cover_days). The record carries the day
 * the plastic went on (`coverFrom`) and the day it was lifted (`coverTo`); a
 * record with no lift day means the plastic is still on. Plastic laid before
 * the old crop ended belongs to the last restart, not this one.
 *
 * Returns null when the timing is right, otherwise the condition's state.
 */
function coverTiming(step, rec, w) {
  const { min, max } = step.cover_days;
  const from = rec.coverFrom || null;
  const to = rec.coverTo || null;
  const span = `${min}–${max} days`;
  if (!from) {
    return { state: 'fail', why: 'The solarisation is recorded without the day the plastic went on.',
      fix: `Record the day the plastic went on and the day it was lifted. It must be one continuous ${span}.` };
  }
  if (w.since && from <= w.since) {
    return { state: 'fail', why: `The plastic went on ${from}, before the previous cycle here ended on ${w.since}.`,
      fix: `Solarise after the old crop is out: one continuous ${span} under sealed plastic.` };
  }
  if (!to) {
    const sofar = daysBetween(from, w.judged);
    return { state: 'held', why: `Under plastic since ${from}: ${sofar} day${sofar === 1 ? '' : 's'} so far.`,
      fix: sofar < min
        ? `Keep it sealed. Lift it on or after ${isoDate(addDays(from, min))} and no later than ${isoDate(addDays(from, max))}, then record the lift.`
        : `Lift it no later than ${isoDate(addDays(from, max))} and record the lift.` };
  }
  const days = daysBetween(from, to);
  if (days < min || days > max) {
    return { state: 'fail', why: `The plastic was on ${from} to ${to}: ${days} days continuous.`,
      fix: days < min
        ? `Solarisation is one continuous ${span}. ${days} days is too short to kill the nematode and pathogen load: re-lay the plastic and record a new span.`
        : `Solarisation is one continuous ${span} (Rev 5 p16). If the lab asked for longer, record it as a new span or the Owner overrides with the lab's reason.` };
  }
  return { state: 'pass', why: `Under sealed plastic ${from} to ${to}: ${days} days continuous${rec.note ? ` — ${rec.note}` : ''}.` };
}

/**
 * Step 5: the pre-plant knockdown goes on within 48 h before transplant, with
 * the doors shut overnight in between (rules →
 * clean_restart.steps[].within_hours_before_transplant).
 *
 * Records carry a day, not an hour, so the window is counted in days: the day
 * before transplant or the day before that. Transplant day itself is refused,
 * because there has been no night with the doors shut.
 */
function knockdownTiming(step, rec, w) {
  const hours = step.within_hours_before_transplant;
  const maxDays = Math.ceil(hours / 24);
  const sprayed = dayOf(rec);
  const before = daysBetween(sprayed, w.judged);
  if (before < 1) {
    return { state: 'fail', why: `The knockdown was sprayed ${sprayed}, the same day as transplant.`,
      fix: 'The doors stay shut overnight after the knockdown. Spray it the day before transplant.' };
  }
  if (before > maxDays) {
    return { state: 'fail', why: `The knockdown was sprayed ${sprayed}, ${before} days before transplant.`,
      fix: `It has to go on within ${hours} h before transplant (${step.timing_rule || 'the day before, or the day before that'}). Spray it again and record it.` };
  }
  return { state: 'pass', why: `Sprayed ${sprayed}, ${before} day${before === 1 ? '' : 's'} before transplant${rec.note ? ` — ${rec.note}` : ''}.` };
}

/** The latest evidence line for one gate and zone, inside a window. */
export function latestEvidence(state, gateId, zoneId, itemId, { cycleId = null, since = null, until = null } = {}) {
  return [...((state && state.gateEvidence) || [])]
    .filter((e) => e.gate === gateId && e.itemId === itemId && e.zoneId === zoneId)
    .filter((e) => (cycleId && e.cycleId ? e.cycleId === cycleId : true))
    .filter((e) => (!since || dayOf(e) > since) && (!until || dayOf(e) <= until))
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? 1 : -1))[0] || null;
}

// --- G2 and G3: the standing gates -------------------------------------------

function standingControls(state, zone, w, { today, now }) {
  const cycle = w.active;
  const weekOne = cycle && daysBetween(cycle.transplantDate, today) >= 7;
  const base = { gate: 'G2' };
  if (!cycle || !weekOne) {
    const why = cycle ? 'Runs from Week 1 of the cycle.' : 'Runs from Week 1 once something is planted.';
    return ['g2_scouting', 'g2_escalation', 'g2_owner'].map((id, i) => ({
      ...base, id, name: ((gateSpec('G2') || {}).pass_all || [])[i] || id, state: 'waiting', why, fix: null,
    }));
  }
  const labels = (gateSpec('G2') || {}).pass_all || [];

  const counts = (state.scouts || []).filter((s) => s.cycleId === cycle.id && s.trapCount != null && dayOf(s) <= today)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : -1));
  const gap = counts.length ? daysBetween(dayOf(counts[0]), today) : null;
  const scouting = gap != null && gap <= 2
    ? { state: 'pass', why: `Last trap count ${dayOf(counts[0])}.` }
    : { state: 'fail',
      why: gap == null ? 'No trap count has been logged for this cycle.' : `Trap counts have gapped ${gap} days.`,
      fix: 'Count every trap today and log it. RC2 red flag: trap counts gapped more than 2 days.' };

  const late = alerts(state, { now }).filter((a) => a.status === 'open' && a.cycleId === cycle.id
    && a.dueAt && a.dueAt < now);
  const escalation = late.length
    ? { state: 'fail', why: `${late.length} alert${late.length === 1 ? '' : 's'} on this zone past the 24 h deadline.`,
      fix: 'Close them with a diagnosis and a treatment, or a recorded decision not to treat (FR-SCOUT-05).' }
    : { state: 'pass', why: 'No alert on this zone is past its deadline.' };

  const weekAgo = isoDate(addDays(today, -7));
  const ownerIds = new Set(Object.values(state.people || {}).filter((p) => p.role === 'ceo').map((p) => p.id));
  const seen = (state.log || []).some((e) => ownerIds.has(e.by) && (e.at || '').slice(0, 10) >= weekAgo
    && (e.at || '').slice(0, 10) <= today);
  const owner = seen
    ? { state: 'pass', why: 'The Owner has been on the records in the last 7 days.' }
    : { state: 'fail', why: 'Nothing from the Owner on the records in the last 7 days.',
      fix: 'The Owner reads the digest and this screen at least weekly (RC3).' };

  return [
    { ...base, id: 'g2_scouting', name: labels[0] || 'scouting logged', ...scouting },
    { ...base, id: 'g2_escalation', name: labels[1] || 'escalation live', ...escalation },
    { ...base, id: 'g2_owner', name: labels[2] || 'owner verifying', ...owner },
  ];
}

function diagnosisFirst(state, w) {
  const name = ((gateSpec('G3') || {}).pass_all || [])[0] || 'a diagnosis precedes every spray';
  const cycle = w.active;
  if (!cycle) {
    return [{ id: 'g3_diagnosis_first', gate: 'G3', name, state: 'waiting',
      why: 'Nothing planted. Every spray will need a confirmed diagnosis first.', fix: null }];
  }
  const sprays = (state.sprays || []).filter((s) => s.cycleId === cycle.id);
  const bare = sprays.filter((s) => !s.diagnosisId && !s.woundCare);
  return [bare.length
    ? { id: 'g3_diagnosis_first', gate: 'G3', name, state: 'fail',
      why: `${bare.length} spray${bare.length === 1 ? '' : 's'} on this cycle with no diagnosis behind ${bare.length === 1 ? 'it' : 'them'}.`,
      fix: 'RC4 red flag. The treatment screen refuses new ones; diagnose what those sprays were for.' }
    : { id: 'g3_diagnosis_first', gate: 'G3', name, state: 'pass',
      why: sprays.length ? `All ${sprays.length} sprays have a diagnosis behind them.` : 'No sprays yet.' }];
}

// --- The model ---------------------------------------------------------------

function fromItem(gateId, it, zoneName) {
  return {
    id: it.id,
    gate: gateId,
    name: it.label,
    itemId: it.id,
    state: it.state === 'have' ? 'pass' : 'fail',
    why: it.why || 'Nothing recorded for this line yet.',
    fix: it.state === 'have' ? null : (it.fix || `Record this against ${gateId} for ${zoneName}.`),
    from: it.from || null,
  };
}

function summarise(conditions) {
  if (conditions.every((c) => c.state === 'na')) return 'na';
  if (conditions.every((c) => c.state === 'waiting' || c.state === 'na')) return 'waiting';
  if (conditions.some((c) => c.state === 'fail' || c.state === 'unknown')) return 'fail';
  if (conditions.some((c) => c.state === 'held')) return 'held';
  if (conditions.some((c) => c.state === 'overridden')) return 'overridden';
  if (conditions.some((c) => c.state === 'waiting')) return 'waiting';
  return 'pass';
}

/** Has the Owner overridden this condition for this zone, since the last cycle ended? */
function overrideFor(state, conditionId, zoneId, since) {
  return (state.gateOverrides || [])
    .filter((o) => o.gate === conditionId && o.zoneId === zoneId && !o.revoked)
    .filter((o) => !since || (o.at || '').slice(0, 10) > since)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0] || null;
}

function spec(id) {
  const s = gateSpec(id) || {};
  return {
    id, name: s.name || id, when: s.when || '', source: s.source || null,
    evidence: s.evidence || null, blocksAction: s.blocks_action || null, passAll: s.pass_all || [],
  };
}

/**
 * FR-GATE-06 — Gate 0 to Gate 4 for one zone, from the rules.
 *
 * Returns the gates in order (with the clean restart between G0 and G1 on
 * GH-04 and GH-05). Every gate carries its conditions, and every condition its
 * state, why, fix and — where there is one — the record it read.
 */
export function gateModel(state, zoneId, opts = {}) {
  const today = opts.today || isoDate();
  const now = opts.now || `${today}T23:59:59.000Z`;
  const rules = opts.rules || peekRules();
  const zone = (state.plots || {})[zoneId];
  const w = zoneWindow(state, zoneId, today);
  const zoneName = (zone && zone.name) || zoneId;
  const gates = [];

  // G0 — Ground Clearance. A bag zone clears it on the media batch in its
  // bags, not on the bed (C-19); a bed zone exactly as before.
  const g0 = spec('G0');
  const bag = mediaOf(state, zoneId, w.active) === 'bag';
  if (bag) {
    const lines = bagG0(state, zoneId, { today });
    gates.push({
      ...g0, blocksTransplant: true, media: 'bag',
      why: ((bagRules(rules) || {}).media_types || {}).bag || 'Gate 0 clears on the media batch, not the bed.',
      conditions: [
        ...BAG_G0_ITEMS.map((itemId) => ({ ...lines[itemId], gate: 'G0', itemId, label: bagG0Label(itemId, rules) })),
        gateSignoff(state, zoneId, 'G0', { since: w.since, until: w.judged }),
      ],
    });
  } else {
    const nem = nematodeGate(state, zoneId, { today });
    const ph = phGate(state, zoneId, { today });
    const topsoil = batchGate(state, zoneId);
    gates.push({
      ...g0, blocksTransplant: true,
      conditions: [
        { ...nem, gate: 'G0', label: g0.passAll[0] },
        { ...ph, gate: 'G0', label: g0.passAll[1] },
        { ...topsoil, gate: 'G0', label: 'purchased topsoil tested (FR-GATE-03)' },
        gateSignoff(state, zoneId, 'G0', { since: w.since, until: w.judged }),
      ],
    });
  }

  const cr = cleanRestart(state, zone, w, rules);
  if (cr) gates.push(cr);

  // G1 — Establishment Readiness, the checklist, one recorded line at a time.
  const g1 = spec('G1');
  gates.push({
    ...g1, blocksTransplant: true,
    conditions: GATE_ITEMS.G1.map((itemId, i) => fromItem('G1', gateItem(state, {
      gateId: 'G1', itemId, label: g1.passAll[i], zoneId, cycleId: w.active ? w.active.id : null,
      today: w.judged, since: w.since, until: w.judged, batchId: opts.batchId || null, rules,
    }), zoneName)),
  });

  gates.push({ ...spec('G2'), blocksTransplant: false, conditions: standingControls(state, zone, w, { today, now }) });
  gates.push({ ...spec('G3'), blocksTransplant: false, conditions: diagnosisFirst(state, w) });

  // G4 — Cycle Close & Learn. What it is about depends on where the zone is:
  // an empty zone after a cycle has to close that cycle before the next goes
  // in; a planted zone had to close the one before it; a planted zone with no
  // earlier cycle waits for the end of this one.
  const g4 = spec('G4');
  const subject = w.previous || w.active || null;
  const blocks = !!w.previous;
  let g4Conditions;
  if (!subject) {
    g4Conditions = [{ id: 'g4_none', gate: 'G4', name: 'no earlier cycle to close', state: 'na',
      why: 'No cycle has run in this zone yet.', fix: null }];
  } else if (!blocks) {
    g4Conditions = [...GATE_ITEMS.G4, 'g4_signoff'].map((id, i) => ({
      id, gate: 'G4', name: g4.passAll[i] || 'Farm Doctor cycle review, confirmed by Farm Manager and approved by Owner (FR-GATE-00)',
      state: 'waiting', why: 'At the end of this cycle, before the next one goes in.', fix: null,
    }));
  } else {
    const window = { since: subject.transplantDate || null, until: w.judged };
    g4Conditions = [
      ...GATE_ITEMS.G4.map((itemId, i) => fromItem('G4', gateItem(state, {
        gateId: 'G4', itemId, label: g4.passAll[i], zoneId, cycleId: subject.id, today: w.judged, ...window, rules,
      }), zoneName)),
      gateSignoff(state, zoneId, 'G4', { ...window, cycleId: subject.id }),
    ];
  }
  gates.push({
    ...g4,
    blocksAction: blocks ? 'transplant' : null,
    blocksTransplant: blocks,
    subject: subject ? { cycleId: subject.id, closedAt: subject.closedAt || null, transplantDate: subject.transplantDate } : null,
    conditions: g4Conditions,
  });

  // FR-GATE-07: an Owner override opens one condition on one zone and keeps
  // what it found. It does not reach G2 or G3, which block nothing here.
  for (const g of gates) {
    g.conditions = g.conditions.map((c) => {
      if (!g.blocksTransplant || !isBlocking(c)) return c;
      const override = overrideFor(state, c.id, zoneId, w.since);
      return override ? { ...c, state: 'overridden', override, blockedWhy: c.why } : c;
    });
    g.state = summarise(g.conditions);
  }

  // A media batch that failed after it filled bags here: not a gate (the
  // crop in the ground was judged on transplant day), but the thing the
  // screen and the digest lead with (rules → plant_bags.trace).
  const failedMedia = bag ? batchesIn(state, zoneId, { since: w.since })
    .map(({ id, batch }) => ({ batch, failure: batchFailure(state, id) }))
    .filter((x) => x.failure && x.failure.date <= today) : [];

  return { zoneId, zone, window: w, planted: !!w.active, media: bag ? 'bag' : 'bed', failedMedia, gates };
}

/**
 * FR-GATE-06 — every condition that stands between this zone and a transplant.
 *
 * An override does not delete the finding. The condition still reports what
 * it found and who decided to go anyway, because that is the record the
 * digest and the audit need.
 */
export function gatesForZone(state, zoneId, opts = {}) {
  const zone = (state.plots || {})[zoneId];
  if (isNursery(zone)) {
    return [gate('zone_type', 'Cropping block', 'fail', {
      gate: 'zone',
      noOverride: true,
      why: `${zone.name} is the nursery, not a cropping block (FR-FARM-04).`,
      fix: 'Seedlings are raised here, pass the release check, and are transplanted into a block.',
    })];
  }
  return gateModel(state, zoneId, opts).gates
    .filter((g) => g.blocksTransplant)
    .flatMap((g) => g.conditions);
}

/**
 * FR-GATE-00/01/02/03/06, FR-FARM-05 — may a crop be transplanted here?
 *
 * The one call the planting screen makes. `ok` is false unless every
 * condition of every gate that blocks transplant is clear or explicitly
 * overridden by the Owner. `batchId` names the seedling batch going in.
 */
export function canPlant(state, zoneId, opts = {}) {
  const gates = gatesForZone(state, zoneId, opts);
  const blocking = gates.filter(isBlocking);
  return {
    ok: blocking.length === 0,
    gates,
    blocking,
    overridden: gates.filter((g) => g.state === 'overridden'),
    why: blocking.length
      ? `${blocking.length} condition${blocking.length === 1 ? '' : 's'} not cleared: `
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
        model: isNursery(zone) ? null : gateModel(state, zone.id, opts),
        ...verdict,
      };
    })
    .sort((a, b) => (b.blocking.length - a.blocking.length)
      || String(a.zone.name).localeCompare(String(b.zone.name)));
}
