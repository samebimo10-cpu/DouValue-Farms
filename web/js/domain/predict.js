// Forecasting. Everything here answers a question a manager actually asks:
// when will this bed start paying, how much will it give, what is it worth at
// that time of year, how many hands do I need on picking day, and when does the
// store run out.
//
// Two principles hold throughout. First, every forecast states what it assumed,
// because a number with no assumptions attached gets trusted further than it
// deserves. Second, the moment this farm has its own records, they override the
// book figures: calibrate() learns the farm's real yield per plant and the
// forecast follows it.

import { CROPS, getCrop, plantsForArea, stageAt } from './crops.js';
import { priceIndexOn, climateFor, waterloggingIndex, wetnessIndex } from './climate.js';
import { addDays, clamp, daysBetween, isoDate, monthOf, parseDate, round, sum } from '../util.js';

/** Shape of the picking curve: slow start, peak about a third in, long tail. */
function harvestWeight(t) {
  const a = 2.0, b = 3.33;
  if (t <= 0 || t >= 1) return 0;
  return Math.pow(t, a - 1) * Math.pow(1 - t, b - 1);
}

/**
 * How healthy the bed has been, from what was logged against it.
 * 1.0 is a clean, well-fed, well-drained crop. Below 0.6 means something is
 * badly wrong and the forecast should say so rather than quietly shrink.
 */
export function healthFactor(cycle, events = {}) {
  const reasons = [];
  let factor = 1;

  const incidence = clamp(Number(events.diseaseIncidencePct) || 0, 0, 100) / 100;
  if (incidence > 0.02) {
    const hit = clamp(incidence * 1.4, 0, 0.6);
    factor *= 1 - hit;
    reasons.push(`${Math.round(incidence * 100)}% of plants showing disease costs about ${Math.round(hit * 100)}% of the yield`);
  }

  const missedFeeds = Number(events.missedFertiliserSplits) || 0;
  if (missedFeeds > 0) {
    const hit = clamp(missedFeeds * 0.08, 0, 0.3);
    factor *= 1 - hit;
    reasons.push(`${missedFeeds} fertiliser split${missedFeeds === 1 ? '' : 's'} missed`);
  }

  const dryDays = Number(events.dryStressDays) || 0;
  if (dryDays > 3) {
    const hit = clamp((dryDays - 3) * 0.02, 0, 0.35);
    factor *= 1 - hit;
    reasons.push(`${dryDays} days of water stress`);
  }

  if (events.waterlogged) {
    factor *= 0.8;
    reasons.push('water stood in the bed');
  }

  const gapPct = clamp(Number(events.gapPct) || 0, 0, 100) / 100;
  if (gapPct > 0.05) {
    factor *= 1 - gapPct;
    reasons.push(`${Math.round(gapPct * 100)}% of the stand missing or dead`);
  }

  if (events.wellManaged && !reasons.length) {
    factor *= 1.1;
    reasons.push('clean crop, fed on schedule');
  }

  return { factor: clamp(factor, 0.25, 1.15), reasons };
}

/**
 * Learn this farm's real yield from finished cycles.
 * Returns a multiplier per crop against the book "typical" figure, and says how
 * much evidence is behind it so the UI can be honest about confidence.
 */
export function calibrate(closedCycles) {
  const out = {};
  for (const cropId of Object.keys(CROPS)) {
    const rows = closedCycles.filter((c) => c.cropId === cropId && c.plants > 0 && c.actualKg > 0);
    if (!rows.length) { out[cropId] = { multiplier: 1, samples: 0, basis: 'book figures only' }; continue; }
    const ratios = rows.map((c) => (c.actualKg / c.plants) / getCrop(cropId).yieldPerPlantKg.typical)
      .sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
    out[cropId] = {
      multiplier: clamp(median, 0.3, 2.5),
      samples: rows.length,
      basis: `${rows.length} finished cycle${rows.length === 1 ? '' : 's'} on this farm`,
    };
  }
  return out;
}

/**
 * The main forecast for one crop cycle.
 *
 * cycle: { cropId, transplantDate, plants (or areaM2), harvestedKg?, health? }
 * Returns dated milestones, a week-by-week picking curve, and a total, with the
 * assumptions spelled out.
 */
export function harvestForecast(cycle, opts = {}) {
  const crop = getCrop(cycle.cropId);
  const today = opts.today ? parseDate(opts.today) : new Date();
  const transplant = parseDate(cycle.transplantDate);
  const plants = Number(cycle.plants) || plantsForArea(cycle.cropId, cycle.areaM2 || 0);
  const dat = daysBetween(transplant, today);

  const cal = (opts.calibration && opts.calibration[cycle.cropId]) || { multiplier: 1, samples: 0, basis: 'book figures only' };
  const health = cycle.health || healthFactor(cycle, cycle.events || {});

  const perPlant = crop.yieldPerPlantKg.typical * cal.multiplier * health.factor;
  const totalKg = round(perPlant * plants, 1);

  const firstHarvest = addDays(transplant, crop.daysToFirstHarvest);
  const peak = addDays(transplant, crop.daysToPeak);
  const lastHarvest = addDays(transplant, crop.daysToFirstHarvest + crop.harvestWindowDays);

  // Week-by-week picking curve across the harvest window.
  const weeks = Math.ceil(crop.harvestWindowDays / 7);
  const raw = [];
  for (let w = 0; w < weeks; w++) raw.push(harvestWeight((w + 0.5) / weeks));
  const rawTotal = sum(raw) || 1;
  const curve = raw.map((r, w) => {
    const start = addDays(firstHarvest, w * 7);
    const kgThisWeek = round((r / rawTotal) * totalKg, 1);
    return {
      week: w + 1,
      from: isoDate(start),
      to: isoDate(addDays(start, 6)),
      month: monthOf(start),
      kg: kgThisWeek,
      past: daysBetween(start, today) > 6,
    };
  });

  const harvestedKg = Number(cycle.harvestedKg) || 0;
  const pickedSoFar = sum(curve.filter((c) => c.past), (c) => c.kg);
  const remainingKg = round(Math.max(0, totalKg - Math.max(harvestedKg, pickedSoFar)), 1);

  const stage = stageAt(cycle.cropId, dat);
  const daysToFirst = daysBetween(today, firstHarvest);

  return {
    cropId: cycle.cropId,
    crop,
    plants,
    dat,
    stage,
    perPlantKg: round(perPlant, 2),
    totalKg,
    harvestedKg,
    remainingKg,
    milestones: {
      transplant: isoDate(transplant),
      flowering: isoDate(addDays(transplant, crop.daysToFlower)),
      firstHarvest: isoDate(firstHarvest),
      peak: isoDate(peak),
      lastHarvest: isoDate(lastHarvest),
      daysToFirstHarvest: daysToFirst,
    },
    curve,
    confidence: cal.samples >= 3 ? 'good' : cal.samples >= 1 ? 'fair' : 'rough',
    assumptions: [
      `${plants.toLocaleString('en-NG')} plants at ${round(perPlant, 2)} kg each over the whole cycle`,
      `Book figure for ${crop.name} is ${crop.yieldPerPlantKg.typical} kg per plant; calibration ${round(cal.multiplier, 2)}x from ${cal.basis}`,
      `Crop health factor ${round(health.factor, 2)}${health.reasons.length ? ': ' + health.reasons.join('; ') : ''}`,
      `Picking runs about ${weeks} weeks from ${isoDate(firstHarvest)}, peaking around ${isoDate(peak)}`,
    ],
    health,
  };
}

/**
 * What the crop is worth, week by week, at the time of year it actually lands.
 * Pepper prices here swing by nearly two to one across the year, so timing is
 * worth more than yield on the margin.
 */
export function revenueForecast(forecast, opts = {}) {
  const basePrice = Number(opts.basePriceNgnPerKg) || forecast.crop.priceTierNgnPerKg;
  const seasonality = opts.seasonality || null;
  const gradeOutPct = clamp(Number(opts.gradeOutPct ?? 12), 0, 60) / 100; // rejects, rot, shrink

  const weeks = forecast.curve.map((w) => {
    const index = priceIndexOn(w.from, seasonality);
    const sellableKg = round(w.kg * (1 - gradeOutPct), 1);
    const price = round(basePrice * index, 0);
    return { ...w, sellableKg, priceNgnPerKg: price, revenue: round(sellableKg * price, 0), priceIndex: round(index, 2) };
  });

  const total = sum(weeks, (w) => w.revenue);
  const totalKg = sum(weeks, (w) => w.sellableKg);
  const future = weeks.filter((w) => !w.past);

  return {
    weeks,
    totalRevenue: total,
    remainingRevenue: sum(future, (w) => w.revenue),
    sellableKg: round(totalKg, 1),
    averagePrice: totalKg ? round(total / totalKg, 0) : 0,
    basePrice,
    gradeOutPct: gradeOutPct * 100,
    bestWeek: weeks.length ? weeks.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null,
    assumptions: [
      `Farm-gate base price ${basePrice.toLocaleString('en-NG')} naira per kg, moved by the month-by-month price index`,
      `${Math.round(gradeOutPct * 100)}% taken off for rejects, rot and shrinkage between picking and sale`,
      'Price index is a planning estimate. Check Mile 3 and Creek Road before you commit to a buyer.',
    ],
  };
}

/**
 * When to sow so the picking lands in the months the market pays most.
 *
 * Walks a candidate sowing date through every week of the year, runs the whole
 * forecast, and scores the revenue. It also flags candidates whose flowering
 * falls into the worst disease weather, because a high paper price on a crop
 * that rots is not a plan.
 */
export function bestSowingWindow(cropId, opts = {}) {
  const crop = getCrop(cropId);
  const year = opts.year || new Date().getFullYear() + (opts.nextYear ? 1 : 0);
  const plants = Number(opts.plants) || 1000;
  const basePrice = Number(opts.basePriceNgnPerKg) || crop.priceTierNgnPerKg;
  const notBefore = opts.notBefore ? parseDate(opts.notBefore) : null;

  const candidates = [];
  for (let week = 0; week < 52; week++) {
    const sow = addDays(new Date(year, 0, 6), week * 7);
    if (notBefore && sow < notBefore) continue;
    const transplant = addDays(sow, crop.nurseryDays);
    const forecast = harvestForecast(
      { cropId, transplantDate: isoDate(transplant), plants },
      { today: isoDate(transplant), calibration: opts.calibration },
    );
    const revenue = revenueForecast(forecast, { basePriceNgnPerKg: basePrice, seasonality: opts.seasonality });

    // Disease weather during flowering and early fruit, the vulnerable weeks.
    const flowering = addDays(transplant, crop.daysToFlower);
    let pressure = 0;
    for (let d = 0; d < 45; d += 7) {
      const when = addDays(flowering, d);
      pressure += 0.6 * wetnessIndex(when) + 0.4 * waterloggingIndex(when);
    }
    pressure /= 7;

    // Nursery in the peak of the rains is hard to keep alive.
    const nurseryRisk = climateFor(sow).season === 'peak' ? 0.15 : 0;

    const riskAdjusted = revenue.totalRevenue * (1 - 0.35 * pressure - nurseryRisk);

    candidates.push({
      sowDate: isoDate(sow),
      transplantDate: isoDate(transplant),
      firstHarvest: forecast.milestones.firstHarvest,
      peakHarvest: forecast.milestones.peak,
      lastHarvest: forecast.milestones.lastHarvest,
      grossRevenue: revenue.totalRevenue,
      averagePrice: revenue.averagePrice,
      diseasePressure: round(pressure, 2),
      score: Math.round(riskAdjusted),
      revenuePerPlant: round(riskAdjusted / plants, 0),
    });
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return {
    cropId,
    crop,
    plants,
    candidates,
    ranked,
    best,
    worst,
    upliftPct: worst && worst.score > 0 ? round(((best.score - worst.score) / worst.score) * 100, 0) : 0,
    advice: best
      ? `Sow ${crop.name} around ${best.sowDate} to transplant ${best.transplantDate} and pick from `
        + `${best.firstHarvest}, with the peak near ${best.peakHarvest}. That puts most of the crop into the `
        + 'months when southern supply is thin and the price is strongest.'
      : 'Not enough of the year left to plan a full cycle.',
    assumptions: [
      'Uses the built-in seasonal price index for the South-South, which you can edit in Settings.',
      'Penalises sowing dates whose flowering falls in the wettest, most disease-prone weeks.',
      'Assumes irrigation is available. Without it, a dry-season crop will not reach these yields.',
    ],
  };
}

/** People and hours needed to get a week's picking off the field. */
export function labourForecast(kgThisWeek, opts = {}) {
  const kgPerPersonHour = Number(opts.kgPerPersonHour) || 12; // picking small fruit is slow work
  const hoursPerDay = Number(opts.hoursPerDay) || 6;
  const pickDaysPerWeek = Number(opts.pickDaysPerWeek) || 2;
  const hours = kgThisWeek / kgPerPersonHour;
  const peoplePerPickDay = Math.ceil(hours / (hoursPerDay * pickDaysPerWeek));
  return {
    totalHours: round(hours, 1),
    pickDaysPerWeek,
    peoplePerPickDay,
    text: `${round(hours, 0)} picking hours this week: about ${peoplePerPickDay} `
      + `${peoplePerPickDay === 1 ? 'person' : 'people'} on each of ${pickDaysPerWeek} picking days.`,
    assumptions: [`${kgPerPersonHour} kg picked per person per hour`, `${hoursPerDay} hour working day`],
  };
}

/** Days until an input runs out, at the rate it has actually been used. */
export function stockForecast(item, usageHistory, today = new Date()) {
  const days = 30;
  const since = isoDate(addDays(today, -days));
  const used = sum(usageHistory.filter((u) => u.itemId === item.id && u.date >= since), (u) => u.qty);
  const perDay = used / days;
  if (perDay <= 0) {
    return { itemId: item.id, perDay: 0, daysLeft: Infinity, status: 'idle',
      text: 'Not used in the last 30 days.' };
  }
  const daysLeft = Math.floor((Number(item.qty) || 0) / perDay);
  const status = daysLeft <= 7 ? 'critical' : daysLeft <= 21 ? 'low' : 'ok';
  return {
    itemId: item.id,
    perDay: round(perDay, 2),
    daysLeft,
    runsOut: isoDate(addDays(today, daysLeft)),
    status,
    text: daysLeft <= 60
      ? `About ${daysLeft} days left at ${round(perDay, 2)} ${item.unit} a day. Runs out around ${isoDate(addDays(today, daysLeft))}.`
      : `Comfortable: roughly ${daysLeft} days of stock.`,
  };
}

/** Money in against money out, month by month, for the cycles on the ground. */
export function cashflowForecast(cycles, costs, opts = {}) {
  const months = new Map();
  const touch = (key) => {
    if (!months.has(key)) months.set(key, { month: key, income: 0, cost: 0 });
    return months.get(key);
  };

  for (const c of cycles) {
    const f = harvestForecast(c, opts);
    const r = revenueForecast(f, opts);
    for (const w of r.weeks) touch(w.from.slice(0, 7)).income += w.revenue;
  }
  for (const cost of costs) touch(String(cost.date).slice(0, 7)).cost += Number(cost.amount) || 0;

  const rows = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  let running = Number(opts.openingBalance) || 0;
  for (const r of rows) {
    r.net = round(r.income - r.cost, 0);
    running += r.net;
    r.balance = round(running, 0);
    r.income = round(r.income, 0);
    r.cost = round(r.cost, 0);
  }
  const tightest = rows.length ? rows.reduce((a, b) => (b.balance < a.balance ? b : a)) : null;
  return { rows, closingBalance: round(running, 0), tightest };
}

/** Break-even: how many kg must be sold to cover what has been spent. */
export function breakEven(totalCostNgn, priceNgnPerKg, expectedKg) {
  const kgNeeded = priceNgnPerKg > 0 ? Math.ceil(totalCostNgn / priceNgnPerKg) : Infinity;
  const share = expectedKg > 0 ? kgNeeded / expectedKg : Infinity;
  return {
    kgNeeded,
    shareOfCrop: round(clamp(share, 0, 9.99), 2),
    verdict: share <= 0.5 ? 'comfortable' : share <= 0.8 ? 'tight' : share <= 1 ? 'very tight' : 'loss at this price',
    text: priceNgnPerKg > 0
      ? `Needs ${kgNeeded.toLocaleString('en-NG')} kg sold at ${priceNgnPerKg.toLocaleString('en-NG')} naira `
        + `to break even, which is ${Math.round(clamp(share, 0, 9.99) * 100)}% of the expected crop.`
      : 'Set a price to work out break-even.',
  };
}

/**
 * Measure the forecaster against what actually happened, so nobody over-trusts it.
 *
 * Each cycle is scored with a calibration fitted on the *other* cycles only.
 * Calibrating on a cycle and then grading the forecast against that same cycle
 * would report near-perfect accuracy no matter how wrong the model is, which is
 * worse than reporting nothing.
 */
export function forecastAccuracy(closed) {
  const usable = closed.filter((c) => c.actualKg > 0 && c.transplantDate && (c.plants > 0 || c.areaM2 > 0));
  if (!usable.length) {
    return { rows: [], meanErrorPct: null, heldOut: false,
      note: 'No finished cycles yet, so the forecast is running on book figures rather than on what this farm does.' };
  }

  const rows = usable.map((c) => {
    const others = usable.filter((x) => x.id !== c.id);
    const cal = others.length ? calibrate(others) : null;
    const f = harvestForecast({ ...c, harvestedKg: 0, events: c.events || {} },
      { today: c.transplantDate, calibration: cal });
    const error = c.actualKg > 0 ? Math.abs(c.actualKg - f.totalKg) / c.actualKg : 0;
    return {
      cycleId: c.id, cropId: c.cropId,
      predicted: f.totalKg, actual: c.actualKg,
      errorPct: round(error * 100, 0),
      basis: others.length ? `${others.length} other cycle${others.length === 1 ? '' : 's'}` : 'book figures',
    };
  });

  const mean = round(sum(rows, (r) => r.errorPct) / rows.length, 0);
  const heldOut = usable.length > 1;
  return {
    rows,
    meanErrorPct: mean,
    heldOut,
    note: `Across ${rows.length} finished cycle${rows.length === 1 ? '' : 's'} the forecast has been out by `
      + `${mean}% on average. Treat any single number as give or take that much. `
      + (heldOut
        ? 'Each cycle was scored using only the other cycles, so this is a fair test.'
        : 'With only one finished cycle this is measured against the book figures, not against your own '
          + 'records. Close a second cycle and the number starts to mean something.'),
  };
}
