// The farm's history in the reports — live and imported side by side.
//
// Imported records are shown beside the app's own, year by year and zone by
// zone, always saying how much is imported; they never change what the live
// figures, forecasts and checks read. What each role sees follows FR-SIMP-04.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { reduce } = await import('../web/js/store.js');
const { historyByYear, historyByZone, hasHistory } = await import('../web/js/domain/history.js');
const { historyCard } = await import('../web/js/ui/manage.js');
const { unitEconomics, harvestTrend } = await import('../web/js/domain/analysis.js');

const at = (d) => `${d}T08:00:00.000Z`;
const base = [
  { id: 'p1', type: 'plot.upsert', at: at('2025-01-01'), by: 'c', payload: { id: 'gh1', name: 'GH-01' } },
  { id: 'p2', type: 'plot.upsert', at: at('2025-01-01'), by: 'c', payload: { id: 'gh2', name: 'GH-02' } },
  { id: 'cy', type: 'cycle.start', at: at('2026-08-01'), by: 'c', payload: { id: 'cy1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-01' } },
  { id: 'hv', type: 'harvest.record', at: at('2026-10-10'), by: 'h', payload: { id: 'hv1', cycleId: 'cy1', date: '2026-10-10', kg: 100 } },
  { id: 'sl', type: 'sale.record', at: at('2026-10-11'), by: 'm', payload: { id: 'sl1', date: '2026-10-11', amount: 400000 } },
  { id: 'ex', type: 'expense.record', at: at('2026-10-05'), by: 'm', payload: { id: 'ex1', date: '2026-10-05', amount: 150000 } },
];
const imported = (importId, kind, rows) => [
  { id: `b_${importId}`, type: 'import.batch', at: at('2026-10-18'), by: 'c', payload: { id: importId, kind, source: 'paper' } },
  ...rows.map((r, i) => ({ id: `r_${importId}_${i}`, type: `history.${kind}`, at: at('2026-10-18'), by: 'c',
    payload: { id: `h_${importId}_${i}`, importId, source: 'paper', ...r } })),
];
const history = [
  ...imported('i1', 'harvest', [
    { date: '2025-03-14', zoneId: 'gh1', kg: 300 },
    { date: '2025-04-02', zoneId: 'gh2', crates: 10 },        // crates only
    { date: '2025-05-01', zoneId: null, kg: 50 },             // no zone written
    { date: '2026-02-01', zoneId: 'gh1', kg: null, crates: null }, // nothing to count
  ]),
  ...imported('i2', 'sale', [
    { date: '2025-03-20', buyer: 'A', total: 900000 },
    { date: '2025-04-20', buyer: 'B', kg: 20, pricePerKg: 3000 }, // worked out
    { date: '2025-05-20', buyer: 'C', kg: 30 },                   // value unknown
  ]),
  ...imported('i3', 'expense', [{ date: '2025-02-01', item: 'Diesel', amount: 45000 }]),
];
const state = reduce([...base, ...history]);
const live = reduce(base);

test('year by year: live and imported together, each year saying how much is imported', () => {
  const years = historyByYear(state, { money: true, profit: true });
  assert.deepEqual(years.map((y) => y.period), ['2026', '2025']);
  const [y26, y25] = years;
  assert.equal(y26.kg, 100);
  assert.equal(y26.kgImported, 0, 'the 2026 import row with nothing in it adds nothing');
  assert.equal(y25.kg, 300 + 10 * 12 + 50);
  assert.equal(y25.kgFromCrates, 1, 'crates × the farm\'s crate weight, and counted as such');
  assert.equal(y25.sales, 900000 + 60000);
  assert.equal(y25.salesWorkedOut, 1);
  assert.equal(y25.salesUnknown, 1, 'a sale with no price is unknown, not ₦0');
  assert.equal(y25.spent, 45000);
  assert.equal(y26.difference, 400000 - 150000);
});

test('zone by zone, with a line for pickings that named no zone', () => {
  const z = Object.fromEntries(historyByZone(state).map((r) => [r.name, r]));
  assert.equal(z['GH-01'].kg, 400);
  assert.equal(z['GH-01'].kgImported, 300);
  assert.equal(z['GH-02'].kg, 120);
  assert.equal(z['No zone written'].kg, 50);
});

test('an undone import drops out of the history', () => {
  const undone = reduce([...base, ...history, { id: 'rv', type: 'import.revert', at: at('2026-10-18'), by: 'c', payload: { id: 'i2', reason: 'wrong book' } }]);
  assert.equal(historyByYear(undone, { money: true }).find((y) => y.period === '2025').sales, 0);
});

test('imported history changes none of the live figures the forecasts and checks read', () => {
  const opts = { today: '2026-10-18' };
  assert.deepEqual(unitEconomics(state, opts), unitEconomics(live, opts));
  assert.deepEqual(harvestTrend(state, opts), harvestTrend(live, opts));
  assert.equal(state.harvests.length, live.harvests.length);
  assert.equal(state.sales.length, live.sales.length);
});

test('FR-SIMP-04: kilograms for reports; sales and spending for the books; the difference for the Owner', () => {
  const owner = historyCard(state, { showsMoney: true, showsProfit: true });
  assert.match(owner, /Sold − spent/);
  const manager = historyCard(state, { showsMoney: true, showsProfit: false });
  assert.match(manager, /Sold/);
  assert.doesNotMatch(manager, /Sold − spent/, 'no margin for the Farm Manager');
  const supervisor = historyCard(state, {});
  assert.doesNotMatch(supervisor, /₦|Sold|Spent/, 'no money at all');
  assert.match(supervisor, /Picked by zone/);
  assert.equal(Object.prototype.hasOwnProperty.call(historyByYear(state)[0], 'sales'), false, 'not even computed');
});

test('the card says what is imported, what was worked out, and shows nothing when there is no history', () => {
  const html = historyCard(state, { showsMoney: true, showsProfit: true });
  assert.match(html, /includes imported records/);
  assert.match(html, /% imported/);
  assert.match(html, /crates × 12 kg/);
  assert.match(html, /no total written; it is price × kg/);
  assert.match(html, /no price or total, so it is not in the naira/);
  assert.equal(hasHistory(live), false);
  assert.equal(historyCard(live, { showsMoney: true, showsProfit: true }), '');
});

test('a year with no sales or spending on record says so, instead of showing ₦0', () => {
  const onlyHarvest = reduce([...base.slice(0, 4), ...imported('i9', 'harvest', [{ date: '2024-06-01', zoneId: 'gh1', kg: 80 }])]);
  const y24 = historyByYear(onlyHarvest, { money: true, profit: true }).find((y) => y.period === '2024');
  assert.equal(y24.salesRecords, 0);
  assert.equal(y24.difference, null, 'no difference without both sides');
  const html = historyCard(onlyHarvest, { showsMoney: true, showsProfit: true });
  assert.match(html, /No sales recorded or imported/);
  assert.doesNotMatch(html.slice(html.indexOf('<b>2024</b>')), /Sold − spent/);
});
