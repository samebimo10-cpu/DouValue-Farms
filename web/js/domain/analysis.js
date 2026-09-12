// Turning the farm's records into the handful of numbers worth acting on.
//
// The test for anything in this file: would it change a decision? A chart of
// harvest by day would not. "This bed costs more per kilo than it earns" would.

import { addDays, daysBetween, isoDate, round, sum } from '../util.js';
import { getCrop } from './crops.js';
import { harvestForecast, calibrate } from './predict.js';

const weekKey = (date) => {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  const day = (d.getDay() + 6) % 7;                   // Monday start
  return isoDate(addDays(d, -day));
};

/** Picking by week, split by crop, for the trend line. */
export function harvestTrend(state, { weeks = 12, today = isoDate() } = {}) {
  const from = isoDate(addDays(today, -weeks * 7));
  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    buckets.set(weekKey(isoDate(addDays(today, -i * 7))), { week: '', kg: 0, byCrop: {}, pickings: 0 });
  }
  for (const h of state.harvests) {
    if (!h.date || h.date < from) continue;
    const key = weekKey(h.date);
    const row = buckets.get(key);
    if (!row) continue;
    const cycle = state.cycles[h.cycleId];
    const crop = cycle ? cycle.cropId : 'unknown';
    row.kg += Number(h.kg) || 0;
    row.pickings += 1;
    row.byCrop[crop] = (row.byCrop[crop] || 0) + (Number(h.kg) || 0);
  }
  const rows = [...buckets.entries()].map(([week, row]) => ({ ...row, week, kg: round(row.kg, 1) }));

  const recent = rows.slice(-4);
  const previous = rows.slice(-8, -4);
  const recentTotal = sum(recent, (r) => r.kg);
  const previousTotal = sum(previous, (r) => r.kg);
  const change = previousTotal > 0 ? ((recentTotal - previousTotal) / previousTotal) * 100 : null;

  return {
    rows,
    recentTotal: round(recentTotal, 1),
    previousTotal: round(previousTotal, 1),
    changePct: change == null ? null : round(change, 0),
    direction: change == null ? 'flat' : change > 8 ? 'up' : change < -8 ? 'down' : 'flat',
  };
}

/** How each bed is doing against what it was forecast to do. */
export function bedPerformance(state, { today = isoDate() } = {}) {
  const cal = calibrate(Object.values(state.cycles).filter((c) => c.status === 'closed'));
  const rows = [];
  for (const cycle of Object.values(state.cycles)) {
    const picks = state.harvests.filter((h) => h.cycleId === cycle.id);
    const picked = sum(picks, (h) => h.kg);
    const forecast = harvestForecast(cycle, { today, calibration: cal });
    const dat = daysBetween(cycle.transplantDate, today);

    // Only judge a bed against the part of its curve that has already passed.
    const due = sum(forecast.curve.filter((w) => w.past), (w) => w.kg);
    const ratio = due > 0 ? picked / due : null;

    rows.push({
      cycleId: cycle.id,
      plot: state.plots[cycle.plotId],
      crop: getCrop(cycle.cropId),
      status: cycle.status,
      dat,
      plants: cycle.plants || 0,
      pickedKg: round(picked, 1),
      dueByNowKg: round(due, 1),
      forecastKg: forecast.totalKg,
      perPlantKg: cycle.plants ? round(picked / cycle.plants, 2) : null,
      ratio: ratio == null ? null : round(ratio, 2),
      verdict: ratio == null ? 'too early'
        : ratio >= 1.1 ? 'ahead'
          : ratio >= 0.85 ? 'on track'
            : ratio >= 0.6 ? 'behind' : 'well behind',
      pickings: picks.length,
      lastPick: picks.length ? picks.map((h) => h.date).sort().slice(-1)[0] : null,
    });
  }
  return rows.sort((a, b) => (a.ratio ?? 9) - (b.ratio ?? 9));
}

/** Who picks how much per hour, from attendance and pickings on the same days. */
export function labourProductivity(state, { days = 60, today = isoDate() } = {}) {
  const from = isoDate(addDays(today, -days));
  const rows = [];
  for (const p of Object.values(state.people)) {
    if (p.active === false) continue;
    const shifts = state.attendance.filter((a) => a.personId === p.id
      && (a.in || '').slice(0, 10) >= from && a.out);
    const hours = sum(shifts, (s) => s.hours || 0);
    const picks = state.harvests.filter((h) => h.by === p.id && h.date >= from);
    const kg = sum(picks, (h) => h.kg);
    const work = state.workLogs.filter((w) => (w.by === p.id || w.personId === p.id) && w.date >= from);

    if (!hours && !kg && !work.length) continue;
    rows.push({
      person: p,
      hours: round(hours, 1),
      days: new Set(shifts.map((s) => (s.in || '').slice(0, 10))).size,
      kg: round(kg, 1),
      pickings: picks.length,
      kgPerHour: hours > 0 ? round(kg / hours, 1) : null,
      jobsLogged: work.length,
    });
  }
  return rows.sort((a, b) => (b.kgPerHour ?? -1) - (a.kgPerHour ?? -1));
}

/**
 * What a kilogram actually cost, against what it actually sold for.
 * The single number that says whether the season is working.
 */
export function unitEconomics(state, { days = 90, today = isoDate() } = {}) {
  const from = isoDate(addDays(today, -days));
  const pickedKg = sum(state.harvests.filter((h) => h.date >= from), (h) => h.kg);
  const soldKg = sum(state.sales.filter((s) => s.date >= from), (s) => s.kg);
  const revenue = sum(state.sales.filter((s) => s.date >= from), (s) => s.amount);
  const directCosts = sum(state.expenses.filter((e) => e.date >= from), (e) => e.amount);

  const wageDays = state.attendance.filter((a) => (a.in || '').slice(0, 10) >= from && a.out);
  const labourCost = sum(wageDays, (a) => {
    const p = state.people[a.personId];
    const rate = Number(p && p.dailyRate) || Number(state.settings.defaultDailyWage) || 0;
    return rate / Math.max(1, new Set(wageDays.filter((x) => x.personId === a.personId
      && (x.in || '').slice(0, 10) === (a.in || '').slice(0, 10)).map((x) => x.id)).size);
  });

  const totalCost = directCosts + labourCost;
  const costPerKg = pickedKg > 0 ? totalCost / pickedKg : null;
  const pricePerKg = soldKg > 0 ? revenue / soldKg : null;

  return {
    pickedKg: round(pickedKg, 1),
    soldKg: round(soldKg, 1),
    revenue: round(revenue, 0),
    directCosts: round(directCosts, 0),
    labourCost: round(labourCost, 0),
    totalCost: round(totalCost, 0),
    costPerKg: costPerKg == null ? null : round(costPerKg, 0),
    pricePerKg: pricePerKg == null ? null : round(pricePerKg, 0),
    marginPerKg: costPerKg != null && pricePerKg != null ? round(pricePerKg - costPerKg, 0) : null,
    unsoldKg: round(Math.max(0, pickedKg - soldKg), 1),
    verdict: costPerKg == null || pricePerKg == null ? 'not enough recorded yet'
      : pricePerKg > costPerKg * 1.5 ? 'comfortably profitable'
        : pricePerKg > costPerKg ? 'profitable, but thin'
          : 'selling below what it costs to grow',
  };
}

/** How much of the crop makes first grade, which is where the price lives. */
export function gradeMix(state, { days = 90, today = isoDate() } = {}) {
  const from = isoDate(addDays(today, -days));
  const rows = state.harvests.filter((h) => h.date >= from);
  const total = sum(rows, (h) => h.kg);
  if (!total) return { total: 0, grades: [], rejectShare: null };
  const byGrade = new Map();
  for (const h of rows) {
    const g = h.grade || 'first';
    byGrade.set(g, (byGrade.get(g) || 0) + (Number(h.kg) || 0));
  }
  const grades = [...byGrade.entries()]
    .map(([grade, kg]) => ({ grade, kg: round(kg, 1), share: round((kg / total) * 100, 0) }))
    .sort((a, b) => b.kg - a.kg);
  return {
    total: round(total, 1),
    grades,
    rejectShare: round(((byGrade.get('reject') || 0) / total) * 100, 0),
  };
}

/** Everything the analysis screen needs, in one call. */
export function analyse(state, opts = {}) {
  return {
    trend: harvestTrend(state, opts),
    beds: bedPerformance(state, opts),
    labour: labourProductivity(state, opts),
    economics: unitEconomics(state, opts),
    grades: gradeMix(state, opts),
  };
}
