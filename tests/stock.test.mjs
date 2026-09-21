// Low stock — FR-STOCK-02.
//
// "Low stock (below a set level) alerts the Farm Manager, before the input is
// needed."
//
// The app already put low stock in the Owner's daily digest. That is not what
// the requirement asks for and it is not what the farm needs: the Owner does
// not buy sticky traps. These tests pin both halves of the sentence — that the
// alert is addressed to the Farm Manager, and that it fires with time left to
// order rather than when the drum is empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { farmManager, lowStock, lowStockSummary, reorderLevel, DEFAULT_LEAD_DAYS } =
  await import(new URL('domain/stock.js', base).href);
const { digestText } = await import(new URL('domain/digest.js', base).href);
const { storeView, dashboardView } = await import(new URL('ui/manage.js', base).href);

const NOW = '2026-09-21T09:00:00.000Z';
const day = (n) => {
  const d = new Date('2026-09-21T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function farm({ inputs = {}, stockMoves = [], positions = {}, people = null } = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: people || {
      u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true },
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
      u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand', active: true },
    },
    positions,
    plots: {}, cycles: {}, tasks: {}, inputs,
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves, attendance: [], workLogs: [], weather: [], reports: [], shifts: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    absences: [], log: [], orphans: [],
  };
}

const traps = (over = {}) => ({
  id: 'i_traps', name: 'Yellow sticky traps', kind: 'consumable', unit: 'piece',
  qty: 40, ...over,
});

// --- Below a set level -----------------------------------------------------

test('the set level is what the manager set, and nothing is invented for them', () => {
  assert.equal(reorderLevel(traps({ reorderLevel: 50 })), 50);
  assert.equal(reorderLevel(traps()), null, 'no level set is not a level of zero');
  assert.equal(reorderLevel(traps({ reorderLevel: 0 })), null);
});

test('stock at or under its set level raises an alert', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 50, reorderLevel: 50 }) } });
  const [row] = lowStock(state, { now: NOW });

  assert.equal(row.reason, 'below-level');
  assert.match(row.line, /Yellow sticky traps is low/);
  assert.match(row.detail, /reorder level/);
});

test('stock above its level, and not running out, raises nothing', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 400, reorderLevel: 50 }) } });
  assert.deepEqual(lowStock(state, { now: NOW }), []);
});

// --- Before it is needed ---------------------------------------------------

test('an item with no level set still warns while there is time to order', () => {
  // Ten a day, sixty left: six days, and an order takes a fortnight.
  const state = farm({
    inputs: { i_traps: traps({ qty: 60 }) },
    stockMoves: Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, itemId: 'i_traps', direction: 'out', qty: 10, date: day(-i - 1),
    })),
  });
  const [row] = lowStock(state, { now: NOW });

  assert.equal(row.reason, 'running-out');
  assert.ok(row.daysLeft <= DEFAULT_LEAD_DAYS, 'inside the ordering lead time');
  assert.match(row.detail, /Order it now/);
});

test('an empty item is act-now, not check-soon', () => {
  // UX-07's fixed vocabulary: red means act now.
  const state = farm({ inputs: { i_traps: traps({ qty: 0, reorderLevel: 50 }) } });
  const [row] = lowStock(state, { now: NOW });
  assert.equal(row.severity, 'now');
  assert.match(row.line, /out of stock/);
});

test('the worst thing is at the top of the list', () => {
  const state = farm({
    inputs: {
      i_traps: traps({ qty: 10, reorderLevel: 50 }),
      i_lime: { id: 'i_lime', name: 'Agricultural lime', unit: 'kg', qty: 0, reorderLevel: 20 },
    },
  });
  assert.deepEqual(lowStock(state, { now: NOW }).map((r) => r.itemId), ['i_lime', 'i_traps']);
});

// --- To the Farm Manager ---------------------------------------------------

test('every low-stock alert is addressed to the Farm Manager', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 10, reorderLevel: 50 }) } });
  for (const row of lowStock(state, { now: NOW })) {
    assert.equal(row.to, 'Farm Manager');
    assert.equal(row.role, 'manager');
  }
});

test('it finds the person holding the Farm Manager position, then the role', () => {
  const byPosition = farm({
    positions: { pos_manager: { id: 'pos_manager', title: 'Farm Manager', role: 'manager',
      holderId: 'u_hand' } },
  });
  // Whoever is in the chair today, even if their account is a hand's.
  assert.equal(farmManager(byPosition).id, 'u_hand');

  // No positions set up yet: fall back to the role rather than to nobody.
  assert.equal(farmManager(farm()).id, 'u_mgr');
});

test('the store screen puts it at the top, in the Farm Manager\'s name', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 10, reorderLevel: 50 }) } });
  const html = storeView.render({ state, user: state.people.u_mgr, store: { state } });

  assert.match(html, /To order/);
  assert.match(html, /Farm Manager \(Ada Briggs\)/);
  assert.match(html, /Yellow sticky traps is low/);
});

test('the manager\'s board carries it, not only the Owner\'s digest', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 10, reorderLevel: 50 }) } });
  const html = dashboardView.render({ state, user: state.people.u_mgr, store: { state } });

  assert.match(html, /Yellow sticky traps is low — Farm Manager/);
});

test('the Owner still sees it in the digest — it is no longer the only route', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 10, reorderLevel: 50 }) } });
  assert.match(digestText(state, { now: NOW }), /Yellow sticky traps/);
});

test('the summary says what a manager needs in one line', () => {
  const state = farm({
    inputs: {
      i_traps: traps({ qty: 10, reorderLevel: 50 }),
      i_lime: { id: 'i_lime', name: 'Agricultural lime', unit: 'kg', qty: 0, reorderLevel: 20 },
    },
  });
  const summary = lowStockSummary(state, { now: NOW });
  assert.equal(summary.count, 2);
  assert.equal(summary.urgent, 1);
  assert.match(summary.text, /2 inputs to order, 1 needed now/);
  assert.equal(summary.to.name, 'Ada Briggs');
});

test('a farm with nothing running short says so, and shows no banner', () => {
  const state = farm({ inputs: { i_traps: traps({ qty: 400, reorderLevel: 50 }) } });
  assert.match(lowStockSummary(state, { now: NOW }).text, /Nothing running short/);
  const html = storeView.render({ state, user: state.people.u_mgr, store: { state } });
  assert.ok(!html.includes('To order'));
});
