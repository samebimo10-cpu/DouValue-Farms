// The farm's history: what the app recorded live, beside what was brought in
// from spreadsheets and paper books (domain/importer.js).
//
// Kept beside, never mixed in. The KPIs, the forecasts, the waiting periods
// and the record checks read only live records, because twenty months of
// typed-up paper is not evidence of how the farm runs today. This is where the
// two meet, for the questions only a longer view answers: is this year
// better than last, which zone has always given more.
//
// Every figure says how much of it is imported. Where a figure had to be
// worked out — a sale with a price per kg but no total, a picking in crates
// with no weight — it is counted as worked out, and a value nobody wrote down
// is left unknown, never treated as zero. What each role sees follows
// FR-SIMP-04: kilograms for anyone who sees reports; sales and spending for
// the people who run the books; the difference between them for the Owner.

import { historyRows } from './importer.js';

const yearOf = (d) => String(d || '').slice(0, 4) || 'undated';
const blank = (period) => ({
  period,
  kgLive: 0, kgImported: 0, kgFromCrates: 0,
  salesLive: 0, salesImported: 0, salesWorkedOut: 0, salesUnknown: 0, salesCount: 0,
  spentLive: 0, spentImported: 0, spentCount: 0,
});

/** A sale's naira as written; or worked out from price × kg; or unknown. */
function saleValue(r) {
  if (r.total != null) return { value: Number(r.total), worked: false };
  if (r.pricePerKg != null && r.kg != null) return { value: Number(r.pricePerKg) * Number(r.kg), worked: true };
  return { value: null, worked: false };
}

/**
 * Year by year, live and imported side by side.
 * `money`: include sales and spending (manageMoney). `profit`: include the
 * difference (viewProfit — the Owner).
 */
export function historyByYear(state, { money = false, profit = false } = {}) {
  const years = new Map();
  const row = (d) => { const y = yearOf(d); if (!years.has(y)) years.set(y, blank(y)); return years.get(y); };
  const crateKg = Number((state.settings || {}).crateKg) || null;

  for (const h of state.harvests || []) {
    const kg = Number(h.kg);
    if (Number.isFinite(kg) && kg > 0) row(h.date).kgLive += kg;
  }
  for (const h of historyRows(state, 'harvest')) {
    const r = row(h.date);
    if (h.kg != null) r.kgImported += Number(h.kg);
    else if (h.crates != null && crateKg) { r.kgImported += Number(h.crates) * crateKg; r.kgFromCrates++; }
  }
  if (money) {
    for (const s of state.sales || []) { const r = row(s.date); r.salesLive += Number(s.amount) || 0; r.salesCount++; }
    for (const s of historyRows(state, 'sale')) {
      const r = row(s.date);
      r.salesCount++;
      const v = saleValue(s);
      if (v.value == null) r.salesUnknown++;
      else { r.salesImported += v.value; if (v.worked) r.salesWorkedOut++; }
    }
    for (const x of state.expenses || []) { const r = row(x.date); r.spentLive += Number(x.amount) || 0; r.spentCount++; }
    for (const x of historyRows(state, 'expense')) { const r = row(x.date); r.spentImported += Number(x.amount) || 0; r.spentCount++; }
  }

  return [...years.values()].sort((a, b) => (a.period < b.period ? 1 : -1)).map((r) => {
    const out = {
      period: r.period,
      kg: r.kgLive + r.kgImported, kgImported: r.kgImported, kgFromCrates: r.kgFromCrates,
    };
    if (money) {
      Object.assign(out, {
        sales: r.salesLive + r.salesImported, salesImported: r.salesImported,
        salesWorkedOut: r.salesWorkedOut, salesUnknown: r.salesUnknown, salesRecords: r.salesCount,
        spent: r.spentLive + r.spentImported, spentImported: r.spentImported, spentRecords: r.spentCount,
      });
    }
    // A year with no sales or no spending on record has no difference to give:
    // "₦0 sold" would read as a year that sold nothing.
    if (money && profit) out.difference = out.salesRecords && out.spentRecords ? out.sales - out.spent : null;
    return out;
  });
}

/** Kilograms per zone, all years, live and imported; pickings with no zone written are their own line. */
export function historyByZone(state) {
  const zones = new Map();
  const row = (id) => {
    if (!zones.has(id)) {
      const z = (state.plots || {})[id];
      zones.set(id, { zoneId: id, name: id ? (z ? z.name : id) : 'No zone written', kg: 0, kgImported: 0 });
    }
    return zones.get(id);
  };
  const crateKg = Number((state.settings || {}).crateKg) || null;
  for (const h of state.harvests || []) {
    const kg = Number(h.kg);
    const zone = ((state.cycles || {})[h.cycleId] || {}).plotId || h.zoneId || null;
    if (Number.isFinite(kg) && kg > 0) row(zone).kg += kg;
  }
  for (const h of historyRows(state, 'harvest')) {
    const kg = h.kg != null ? Number(h.kg) : (h.crates != null && crateKg ? Number(h.crates) * crateKg : null);
    if (kg == null) continue;
    const r = row(h.zoneId || null);
    r.kg += kg;
    r.kgImported += kg;
  }
  return [...zones.values()].sort((a, b) => b.kg - a.kg);
}

/** Is there any imported history to show? */
export const hasHistory = (state) => ['harvest', 'sale', 'expense'].some((k) => historyRows(state, k).length > 0);
