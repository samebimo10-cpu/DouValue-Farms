// The farm, compressed into the smallest thing an adviser can reason over.
//
// Two readers use this: the built-in adviser in adviser.js, and — when the farm
// has a server of its own — a language model reading current knowledge off the
// internet. Both need the same thing, so it is built once, here.
//
// Three rules hold the file together:
//
//   1. Facts only. No advice, no verdict the caller did not already compute.
//      The moment this file starts recommending, two advisers disagree.
//   2. Small. A brief that runs to thousands of tokens costs money on every
//      question and buries the signal. Round hard, cap lists, drop empties.
//   3. Redacted the same way the server redacts. A supervisor asking for advice
//      must not get money back inside the answer, so money never enters the
//      brief unless the reader is allowed to see it.

import { addDays, daysBetween, isoDate, round, sum } from '../util.js';
import { can, inputUsage, inputsList, spraysForCycle } from '../store.js';
import { getCrop, stageAt, waterDemandMmPerDay } from './crops.js';
import {
  climateFor, drynessIndex, FARM_LOCATION, irrigationGapMmPerDay, priceIndexOn,
  SEASON_LABELS, seasonOn, summariseObserved, waterloggingIndex,
} from './climate.js';
import { bedPerformance, gradeMix, harvestTrend, labourProductivity, unitEconomics } from './analysis.js';
import { audit } from './integrity.js';
import { gateBoard } from './gates.js';
import { harvestClearance, reentryClearance, resistanceWarnings } from './safety.js';
import { forecastAccuracy, stockForecast } from './predict.js';
import { PROBLEM_BY_ID } from './pests.js';

/** Keep a list short enough to read and cheap enough to send. */
const top = (rows, n) => rows.slice(0, n);

/** Drop keys whose value carries nothing, so the brief has no filler in it. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

/**
 * What is growing right now, and how it is doing against its own forecast.
 *
 * Beds behind their curve come first: a bed that is ahead needs no advice.
 */
function growing(state, today) {
  const rows = bedPerformance(state, { today })
    .filter((r) => r.status === 'active')
    .map((r) => compact({
      bed: r.plot ? r.plot.name : 'unknown bed',
      crop: r.crop.name,
      daysAfterTransplant: r.dat,
      stage: stageAt(r.crop.id, r.dat)?.name || null,
      plants: r.plants || null,
      pickedKg: r.pickedKg,
      expectedByNowKg: r.dueByNowKg,
      ratio: r.ratio,
      verdict: r.verdict,
      lastPicked: r.lastPick,
      soilPh: r.plot ? r.plot.soilPh : null,
      drainage: r.plot ? r.plot.drainage : null,
    }));
  return top(rows, 12);
}

/** What people have actually reported seeing, most recent first. */
function problems(state, today, days = 30) {
  const from = isoDate(addDays(today, -days));
  const bedOf = (cycleId) => {
    const cycle = state.cycles[cycleId];
    return cycle && state.plots[cycle.plotId] ? state.plots[cycle.plotId].name : null;
  };

  // Scouting is free text plus a percentage. "Clean" is a real and useful
  // finding, but it is not a problem, so it does not come through here.
  const scouted = state.scouts
    .filter((s) => (s.date || '').slice(0, 10) >= from)
    .filter((s) => (Number(s.affectedPct) || 0) > 0 || !/^\s*clean\s*$/i.test(s.finding || ''))
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
    .map((s) => compact({
      bed: bedOf(s.cycleId),
      finding: s.finding || s.note || null,
      affectedPct: Number(s.affectedPct) || 0,
      when: (s.date || '').slice(0, 10),
    }));

  const open = state.reports
    .filter((r) => r.status !== 'resolved' && r.status !== 'closed')
    .filter((r) => (r.date || '').slice(0, 10) >= from)
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
    .map((r) => compact({
      bed: bedOf(r.cycleId),
      what: r.note || null,
      severity: r.severity || null,
      when: (r.date || '').slice(0, 10),
    }));

  const diagnosed = state.diagnoses
    .filter((d) => (d.date || '').slice(0, 10) >= from)
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
    .map((d) => compact({
      bed: bedOf(d.cycleId),
      problem: (PROBLEM_BY_ID[d.problemId] || {}).name || d.problemId,
      confidence: d.confidence || null,
      when: (d.date || '').slice(0, 10),
    }));

  return compact({
    scouted: top(scouted, 10),
    openReports: top(open, 8),
    diagnosed: top(diagnosed, 6),
  });
}

/** Sprays: what went on, what it costs in waiting days, and where resistance is building. */
function chemicals(state, today) {
  const now = new Date(`${today}T12:00:00`);
  const bedOf = (cycleId) => {
    const cycle = state.cycles[cycleId];
    return cycle && state.plots[cycle.plotId] ? state.plots[cycle.plotId].name : null;
  };

  const recent = state.sprays
    .filter((s) => daysBetween((s.date || '').slice(0, 10), today) <= 60)
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
    .map((s) => compact({
      product: s.productName || s.productId,
      bed: bedOf(s.cycleId),
      when: (s.date || '').slice(0, 10),
      against: s.targetProblem || null,
    }));

  // Waiting periods are a property of one bed's own spray history, so each
  // active bed is asked separately. A farm-wide answer would either block
  // everything or clear everything, and both are wrong.
  const cannotHarvest = [];
  const keepOut = [];
  for (const cycle of Object.values(state.cycles)) {
    if (cycle.status !== 'active') continue;
    const mine = spraysForCycle(state, cycle.id);
    if (!mine.length) continue;
    const phi = harvestClearance(mine, now);
    if (!phi.safe) {
      cannotHarvest.push(compact({
        bed: bedOf(cycle.id), product: phi.blocker.product.name,
        safeFrom: phi.clearOn, daysLeft: phi.daysLeft,
      }));
    }
    const rei = reentryClearance(mine, now);
    if (!rei.safe) {
      keepOut.push(compact({
        bed: bedOf(cycle.id),
        product: rei.blocker.product ? rei.blocker.product.name : 'a spray',
        hoursLeft: rei.hoursLeft,
      }));
    }
  }

  return compact({
    last60Days: top(recent, 12),
    cannotHarvestYet: cannotHarvest,
    keepPeopleOut: keepOut,
    resistanceRisk: resistanceWarnings(state.sprays, 60, now).map((w) => compact({
      group: w.group, timesUsed: w.count, note: w.message, insteadTry: w.alternatives,
    })),
  });
}

/** Weather as the farm will feel it: too wet to spray, too dry to skip watering. */
function conditions(state, today, observedDays) {
  const observed = summariseObserved(observedDays || state.weather, new Date(`${today}T12:00:00`));
  const normal = climateFor(today);
  const activeCrops = [...new Set(Object.values(state.cycles)
    .filter((c) => c.status === 'active').map((c) => c.cropId))];
  const demand = activeCrops.length
    ? Math.max(...activeCrops.map((id) => waterDemandMmPerDay(id, 60)))
    : 4;

  return compact({
    place: FARM_LOCATION.name,
    season: SEASON_LABELS[seasonOn(today)] || seasonOn(today),
    normalRainDaysThisMonth: normal.rainDays,
    observed: observed ? compact({
      rainDaysLast7: observed.rainDaysLast7,
      rainLast7mm: observed.rainLast7 == null ? null : round(observed.rainLast7, 0),
      rainLast30mm: observed.rainLast30,
      humidityPct: observed.rh,
      meanMaxTempC: observed.tmaxMean == null ? null : round(observed.tmaxMean, 1),
    }) : null,
    waterloggingRisk: round(waterloggingIndex(today, observed), 2),
    drynessRisk: round(drynessIndex(today, observed), 2),
    irrigationGapMmPerDay: round(irrigationGapMmPerDay(today, demand, observed), 1),
  });
}

/** Inputs that will run out before they can be replaced. */
function store(state, today) {
  const usage = inputUsage(state);
  const rows = [];
  for (const item of inputsList(state)) {
    const f = stockForecast(item, usage, new Date(`${today}T12:00:00`));
    if (f.status !== 'critical' && f.status !== 'low') continue;
    rows.push(compact({
      item: item.name,
      unit: item.unit,
      onHand: round(Number(item.qty) || 0, 1),
      usedPerDay: f.perDay,
      daysLeft: f.daysLeft,
      runsOut: f.runsOut,
    }));
  }
  return top(rows.sort((a, b) => a.daysLeft - b.daysLeft), 8);
}

/** Whether the records themselves can be trusted, which decides how hard to lean on them. */
function trust(state, today) {
  const result = audit(state, { today });
  const quality = result.records;
  return compact({
    score: quality.score,
    verdict: quality.band ? quality.band.label : null,
    sameDaySharePct: quality.sameDay,
    withPhotoSharePct: quality.withPhoto,
    seriousConcerns: result.counts.high,
    concerns: top(result.findings
      .filter((f) => f.severity !== 'low')
      .map((f) => compact({ what: f.title || f.kind, severity: f.severity, times: f.count || 1 })), 6),
  });
}

/**
 * The money, for the people the server would send money to and nobody else.
 *
 * This is the same line the sync server draws. Drawing it here too means a
 * supervisor's question cannot come back with a naira figure in the answer,
 * whatever the adviser on the other end decides to say.
 */
function economics(state, today) {
  const e = unitEconomics(state, { today });
  const prices = state.sales
    .filter((s) => daysBetween((s.date || '').slice(0, 10), today) <= 120 && s.kg > 0)
    .map((s) => ({ date: (s.date || '').slice(0, 10), ngnPerKg: round(s.amount / s.kg, 0), buyer: s.buyer || null }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return compact({
    last90Days: compact({
      pickedKg: e.pickedKg,
      soldKg: e.soldKg,
      unsoldKg: e.unsoldKg,
      revenueNgn: e.revenue,
      inputCostNgn: e.directCosts,
      labourCostNgn: e.labourCost,
      totalCostNgn: e.totalCost,
      costPerKgNgn: e.costPerKg,
      pricePerKgNgn: e.pricePerKg,
      marginPerKgNgn: e.marginPerKg,
      verdict: e.verdict,
    }),
    ownRecentPrices: top(prices, 10),
    seasonalPriceIndexNow: round(priceIndexOn(today, state.settings.priceSeasonality), 2),
    note: 'Prices are what this farm actually sold for, in naira per kilogram. '
      + 'The seasonal index is 1.00 at an average month.',
  });
}

/** How much the farm's own forecasts have been worth believing. */
function forecastTrack(state) {
  const closed = Object.values(state.cycles).filter((c) => c.status === 'closed');
  const acc = forecastAccuracy(closed);
  if (!acc || acc.meanErrorPct == null) return null;
  return compact({
    cyclesScored: acc.rows.length,
    meanErrorPct: acc.meanErrorPct,
    fairTest: acc.heldOut,
  });
}

/**
 * Build the briefing.
 *
 * @param {object} state   the reduced farm
 * @param {object} user    who is asking, so the brief can be cut to their role
 * @param {object} [opts]  today, and live weather if any has been fetched
 */
export function buildBrief(state, user, opts = {}) {
  const today = opts.today || isoDate();
  const money = can(user, 'manageMoney');

  const trend = harvestTrend(state, { today });
  const grades = gradeMix(state, { today });
  const labour = labourProductivity(state, { today });

  return compact({
    generatedAt: new Date().toISOString(),
    farm: compact({
      name: state.settings.farmName,
      where: state.settings.location || FARM_LOCATION.name,
      today,
      askedBy: compact({ role: user.role, seesMoney: money }),
      beds: Object.keys(state.plots).length,
      activeCycles: Object.values(state.cycles).filter((c) => c.status === 'active').length,
      people: Object.values(state.people).filter((p) => p.active !== false).length,
      crops: [...new Set(Object.values(state.cycles)
        .filter((c) => c.status === 'active')
        .map((c) => getCrop(c.cropId).name))],
    }),
    conditions: conditions(state, today, opts.weatherDays),
    growing: growing(state, today),
    harvest: compact({
      last4WeeksKg: trend.recentTotal,
      previous4WeeksKg: trend.previousTotal,
      changePct: trend.changePct,
      direction: trend.direction,
      firstGradeSharePct: grades.grades.find((g) => g.grade === 'first')?.share ?? null,
      rejectSharePct: grades.rejectShare,
    }),
    problems: problems(state, today),
    chemicals: chemicals(state, today),
    store: store(state, today),
    labour: top(labour.map((r) => compact({
      person: r.person.name,
      role: r.person.role,
      daysWorked: r.days,
      hours: r.hours,
      pickedKg: r.kg,
      kgPerHour: r.kgPerHour,
    })), 8),
    economics: money ? economics(state, today) : null,
    // FR-ADV-04. The adviser must never suggest planting into a blocked zone or
    // spraying without a diagnosis, so it is told the gates rather than left to
    // infer them from the records.
    gates: gateBoard(state, { today })
      .filter((r) => !r.ok || r.overridden.length)
      .slice(0, 8)
      .map((r) => compact({
        zone: r.zone.name,
        planted: r.planted,
        blocked: r.blocking.map((g) => g.name),
        openOnOverride: r.overridden.map((g) => g.name),
      })),
    dataTrust: trust(state, today),
    forecastTrack: forecastTrack(state),
  });
}

/**
 * The brief as plain prose, for a reader that takes text rather than JSON and
 * for the "what did it actually see?" panel. Kept deliberately close to the
 * JSON so the two can never tell different stories.
 */
export function briefToText(brief) {
  const lines = [];
  const put = (label, value) => { if (value != null && value !== '') lines.push(`${label}: ${value}`); };

  put('Farm', `${brief.farm.name}, ${brief.farm.where}, on ${brief.farm.today}`);
  put('Asked by', `${brief.farm.askedBy.role}${brief.farm.askedBy.seesMoney ? '' : ' (no access to money)'}`);
  put('Growing', `${brief.farm.activeCycles || 0} active beds of ${(brief.farm.crops || []).join(', ') || 'nothing recorded'}`);

  const c = brief.conditions || {};
  put('Season', c.season);
  if (c.observed) {
    put('Weather', `${c.observed.rainDaysLast7 ?? '?'} rain days in the last week, `
      + `${c.observed.rainLast30mm ?? '?'}mm over 30 days, humidity ${c.observed.humidityPct ?? '?'}%`);
  }
  put('Waterlogging risk', c.waterloggingRisk);
  put('Dryness risk', c.drynessRisk);
  put('Irrigation gap', c.irrigationGapMmPerDay == null ? null : `${c.irrigationGapMmPerDay} mm/day`);

  const h = brief.harvest || {};
  put('Harvest', `${h.last4WeeksKg ?? 0}kg in 4 weeks against ${h.previous4WeeksKg ?? 0}kg before `
    + `(${h.changePct == null ? 'no comparison' : `${h.changePct}%`}, ${h.direction})`);
  put('Rejects', h.rejectSharePct == null ? null : `${h.rejectSharePct}% of what was picked`);

  for (const bed of brief.growing || []) {
    lines.push(`Bed ${bed.bed}: ${bed.crop}, ${bed.daysAfterTransplant} days in, `
      + `${bed.pickedKg}kg picked against ${bed.expectedByNowKg}kg expected — ${bed.verdict}`);
  }

  for (const s of (brief.problems || {}).scouted || []) {
    lines.push(`Scouted: ${s.finding}${s.bed ? ` on ${s.bed}` : ''}`
      + `${s.affectedPct ? `, ${s.affectedPct}% affected` : ''} (${s.when})`);
  }
  for (const r of (brief.problems || {}).openReports || []) {
    lines.push(`Reported and still open: ${r.what}${r.bed ? ` on ${r.bed}` : ''} (${r.severity || 'unrated'}, ${r.when})`);
  }
  for (const d of (brief.problems || {}).diagnosed || []) {
    lines.push(`Diagnosed: ${d.problem}${d.bed ? ` on ${d.bed}` : ''}, ${d.confidence || 'unrated'} confidence (${d.when})`);
  }
  for (const b of (brief.chemicals || {}).cannotHarvestYet || []) {
    lines.push(`Cannot harvest ${b.bed || 'a bed'} until ${b.safeFrom} — ${b.product}, ${b.daysLeft} days to go`);
  }
  for (const r of (brief.chemicals || {}).resistanceRisk || []) {
    lines.push(`Resistance risk: ${r.note || `${r.group} used ${r.timesUsed} times`}`);
  }
  for (const s of brief.store || []) {
    lines.push(`Running out: ${s.item}, ${s.daysLeft} days left`);
  }

  if (brief.economics) {
    const e = brief.economics.last90Days;
    put('Money (90 days)', `₦${e.revenueNgn} in, ₦${e.totalCostNgn} out, `
      + `${e.costPerKgNgn ?? '?'}/kg to grow against ${e.pricePerKgNgn ?? '?'}/kg sold — ${e.verdict}`);
    put('Unsold', e.unsoldKg ? `${e.unsoldKg}kg picked and not sold` : null);
  }

  const t = brief.dataTrust || {};
  put('Record quality', t.verdict ? `${t.verdict} (${t.score}/100)` : null);

  return lines.join('\n');
}
