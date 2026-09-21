// The Farm Doctor — requirements 6.14, and FR-TREAT-03/04.
//
// The Farm Doctor is the thing standing where a site agronomist would have
// stood, so these tests are the questions you would ask that agronomist before
// letting them write a spray plan for your farm:
//
//   Will you repeat the group you used last week?        (no)
//   Will you put a synthetic on in Week 10?              (no)
//   How much goes in the knapsack?                       (to the millilitre)
//   The pH came back 5.3. What do we do?                 (hold, re-test in 10 days)
//
// The refusals are the point. A planner that says yes to everything is the
// guesswork it was built to replace, with a nicer screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules, rules } = await import(new URL('domain/rules.js', base).href);
await loadRules();

const { catalogue, activeByKey, intervalsFor, isBanned } = await import(new URL('domain/catalogue.js', base).href);
const { dosePlan, parseRate, limePlan, TANKS, TEXTURES } = await import(new URL('domain/calc.js', base).href);
const { checkPlan, cropWeek, nextValidOptions, ppeFor, followUpTask, CHECKS } =
  await import(new URL('domain/doctor.js', base).href);
const { KNAPSACK_L } = await import(new URL('domain/safety.js', base).href);

const TODAY = '2026-09-21';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A farm with one greenhouse, one bed transplanted five weeks ago, a confirmed
 * diagnosis on it and a full store — so every test below only has to break the
 * one rule it is about.
 */
function farm(overrides = {}) {
  const { cycleDay = -35, ...rest } = overrides;
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {
      u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true },
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
    },
    plots: { gh1: { id: 'gh1', name: 'GH-01', areaM2: 300, type: 'greenhouse' } },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell_pepper', status: 'active',
        transplantDate: day(cycleDay), areaM2: 300 },
    },
    tasks: {},
    inputs: {
      i_spin: { id: 'i_spin', name: 'Spinosad 45SC', kind: 'chemical', unit: 'litre', qty: 2 },
      i_manc: { id: 'i_manc', name: 'Mancozeb 80WP', kind: 'chemical', unit: 'kg', qty: 6 },
      i_chlor: { id: 'i_chlor', name: 'Chlorantraniliprole 200SC', kind: 'chemical', unit: 'litre', qty: 1 },
      i_thia: { id: 'i_thia', name: 'Thiamethoxam 25WG', kind: 'chemical', unit: 'kg', qty: 1 },
      i_cyp: { id: 'i_cyp', name: 'Cypermethrin 10EC', kind: 'chemical', unit: 'litre', qty: 2 },
      i_neem: { id: 'i_neem', name: 'Neem oil, cold-pressed', kind: 'chemical', unit: 'litre', qty: 5 },
      i_cuoh: { id: 'i_cuoh', name: 'Copper hydroxide 50WP', kind: 'chemical', unit: 'kg', qty: 4 },
      i_garlic: { id: 'i_garlic', name: 'Garlic-chilli extract', kind: 'chemical', unit: 'litre', qty: 10 },
    },
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', problemName: 'Thrips',
      date: day(-1), by: 'u_mgr', confirmedBy: 'u_mgr' }],
    harvests: [], sales: [], sprays: [], scouts: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    positions: {}, absences: [],
    log: [], orphans: [],
    ...rest,
  };
}

/** A plan that passes everything, so a test can spoil exactly one thing. */
const plan = (over = {}) => ({
  cycleId: 'c1',
  activeKey: 'spinosad',
  targetPest: 'thrips',
  at: `${TODAY}T17:00`,
  tankLitres: KNAPSACK_L,
  loads: 1,
  ...over,
});

const verdictOf = (state, p) => checkPlan(state, p, { today: TODAY });
const checkNamed = (v, id) => v.checks.find((c) => c.id === id);

// --- The four the brief names --------------------------------------------

test('a plan repeating the last IRAC group is refused, and the rule is named', () => {
  // Spinosad is IRAC 5. So was the last thing on this bed.
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'spinosad', productName: 'Spinosad',
      date: day(-7) }],
  });

  const verdict = verdictOf(state, plan({ activeKey: 'spinosad' }));
  const rotation = checkNamed(verdict, 'rotation');

  assert.equal(verdict.ok, false);
  assert.equal(verdict.firstFailure.id, 'rotation');
  assert.equal(rotation.state, 'fail');
  assert.equal(rotation.lastGroup, '5');
  assert.match(rotation.fix, /never the same IRAC group twice in a row/i);
  assert.ok(verdict.alternatives.length, 'a refusal with no next option is a refusal that gets ignored');
  assert.ok(verdict.alternatives.every((a) => a.active.group.codes.join() !== '5'),
    'every alternative offered must itself be out of group 5');
});

test('spinetoram after spinosad is still IRAC 5, and is refused too', () => {
  // The trap this rule exists for: a different name, the same group.
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'spinosad', date: day(-7) }],
  });
  const verdict = verdictOf(state, plan({ activeKey: 'spinetoram' }));

  assert.equal(checkNamed(verdict, 'rotation').state, 'fail');
});

test('a different IRAC group after the last spray passes rotation', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'spinosad', date: day(-7) }],
  });
  const verdict = verdictOf(state, plan({ activeKey: 'chlorantraniliprole' }));

  assert.equal(checkNamed(verdict, 'rotation').state, 'pass');
  assert.equal(verdict.ok, true, JSON.stringify(verdict.failed, null, 1));
});

test('a synthetic in Week 10 is refused, whatever the rotation says', () => {
  // Day 71 is the first day of Week 10 under week_counting.
  const state = farm({ cycleDay: -70 });
  const verdict = verdictOf(state, plan({ activeKey: 'chlorantraniliprole' }));
  const week10 = checkNamed(verdict, 'week10');

  assert.equal(verdict.week.week, 10, 'day 71 is Week 10');
  assert.equal(week10.state, 'fail');
  assert.equal(week10.ref, 'SR-08');
  assert.match(week10.fix, /organics only/i);
  assert.ok(verdict.alternatives.length, 'there is always something legal left in Week 10');
  assert.ok(verdict.alternatives.every((a) => a.active.organic),
    'the only things offered in Week 10 are the three organics');
});

test('Week 9 is not Week 10: the synthetic is still allowed on day 70', () => {
  const state = farm({ cycleDay: -69 });
  const verdict = verdictOf(state, plan({ activeKey: 'chlorantraniliprole' }));

  assert.equal(verdict.week.week, 9);
  assert.equal(checkNamed(verdict, 'week10').state, 'pass');
});

test('neem oil is allowed in Week 10, because SR-08 names it', () => {
  const state = farm({ cycleDay: -80 });
  const verdict = verdictOf(state, plan({ activeKey: 'neem' }));

  assert.equal(checkNamed(verdict, 'week10').state, 'pass');
  assert.equal(verdict.ok, true, JSON.stringify(verdict.failed, null, 1));
});

test('knapsack maths is right for 16 L', () => {
  assert.equal(KNAPSACK_L, 16, 'the farm carries a 16 L knapsack, not a 15 L one');
  assert.equal(TANKS[0].litres, 16);
  assert.deepEqual(TANKS.map((t) => t.litres), [16, 500, 1000]);

  // Spinosad 45SC at 0.3 ml/L.
  const spinosad = dosePlan('0.3 ml/L (45SC), after 4 PM');
  assert.equal(spinosad.ok, true);
  assert.equal(spinosad.tanks[0].components[0].amount, 4.8);   // 0.3 x 16
  assert.equal(spinosad.tanks[1].components[0].amount, 150);   // 0.3 x 500
  assert.equal(spinosad.tanks[2].components[0].amount, 300);   // 0.3 x 1000
  assert.equal(spinosad.tanks[0].components[0].text, '4.8 ml');

  // Mancozeb 80WP at 2.5 g/L, shown in kg once it passes a thousand grams.
  const mancozeb = dosePlan('2.5 g/L (80WP)');
  assert.equal(mancozeb.tanks[0].components[0].amount, 40);
  assert.equal(mancozeb.tanks[0].components[0].text, '40 g');
  assert.equal(mancozeb.tanks[2].components[0].text, '2.5 kg');
  assert.ok(mancozeb.tanks[0].components[0].weigh, 'powder is weighed, never measured in caps');

  // FR-TREAT-03 asks for the practical measure as well as the millilitres.
  const cyp = dosePlan('1 ml/L (10EC)');
  assert.equal(cyp.tanks[0].components[0].amount, 16);
  assert.equal(cyp.tanks[0].components[0].caps, 1.6);
  assert.match(cyp.tanks[0].components[0].capText, /cap/);

  // A rate already written per 16 L is not multiplied by 16 again.
  const neem = dosePlan('150 ml cold-pressed oil + 30 ml soap / 16 L');
  assert.equal(neem.tanks[0].components.length, 2);
  assert.equal(neem.tanks[0].components[0].amount, 150);
  assert.equal(neem.tanks[0].components[1].amount, 30);
});

test('a pH of 5.3 routes to "hold, re-test in 10 days" and never to a dose', () => {
  const result = limePlan({
    readings: [5.3, 5.3, 5.3],
    texture: 'sandy_loam',
    areaM2: 300,
    zoneType: 'greenhouse',
    solarised: false,
    today: TODAY,
  });

  assert.equal(result.ok, true);
  assert.equal(result.band, 'hold');
  assert.equal(result.action, 'hold');
  assert.equal(result.route, null, 'a held block gets a date, not a route');
  assert.equal(result.kgLow, undefined, 'and certainly not a number of kilograms');
  assert.equal(result.retestOn, day(10));
  assert.equal(result.blocksTransplant, true);
  assert.match(result.headline, /hold/i);
  assert.match(result.headline, /10 days/i);
});

// --- The rest of the lime calculator -------------------------------------

test('a held block still under 5.5 after ten days gets a quarter of the original rate', () => {
  const result = limePlan({
    readings: [5.3, 5.4, 5.35],
    texture: 'sandy_loam',
    areaM2: 300,
    solarised: false,
    holdSince: day(-11),
    lastLime: { date: day(-45), route: 'A', ratePer100Low: 16.5, ratePer100High: 23.5 },
    today: TODAY,
  });

  assert.equal(result.band, 'hold-expired');
  assert.equal(result.action, 'quarter-rate');
  // A quarter of 16.5-23.5 kg per 100 m2, over 300 m2.
  assert.equal(result.kgLow, 12.4);
  assert.equal(result.kgHigh, 17.6);
  assert.match(result.approval, /Owner approves/i);
});

test('below 5.2 on a block already limed is half the original rate, never a second full dose', () => {
  const first = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', areaM2: 300,
    solarised: false, today: TODAY });
  const second = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', areaM2: 300,
    solarised: false, lastLime: { date: day(-30), route: 'A', ratePer100Low: 16.5, ratePer100High: 23.5 },
    today: TODAY });

  assert.equal(first.action, 'full-rate');
  assert.equal(first.kgLow, 49.5);                       // 16.5 kg/100 m2 x 3
  assert.equal(second.action, 'half-rate');
  // Kilograms of lime are rounded to a tenth: nobody weighs out 24.75 kg.
  assert.ok(Math.abs(second.kgLow - first.kgLow / 2) <= 0.1, `${second.kgLow} is not half of ${first.kgLow}`);
  assert.match(second.detail, /never stack a full dose/i);
});

test('Route A and Route B come from the rules, with the product each one names', () => {
  const routeA = limePlan({ readings: [5.0, 5.0, 5.0], texture: 'loam_clay_loam', areaM2: 100,
    solarised: false, today: TODAY });
  const routeB = limePlan({ readings: [5.0, 5.0, 5.0], texture: 'loam_clay_loam', areaM2: 100,
    solarised: true, transplantDate: day(18), today: TODAY });

  assert.equal(routeA.route, 'A');
  assert.match(routeA.product, /dolomitic/i);
  assert.equal(routeA.kgLow, 26.5);
  assert.equal(routeA.kgHigh, 33.5);

  assert.equal(routeB.route, 'B');
  assert.match(routeB.product, /hydrated/i);
  assert.equal(routeB.kgLow, 18);
  assert.equal(routeB.kgHigh, 22);
  assert.equal(routeB.targetPh, 5.8);
});

test('the neem-cake and urea locks are dated off the day the lime goes on', () => {
  const result = limePlan({ readings: [5.0, 5.0, 5.0], texture: 'sandy_loam', areaM2: 200,
    solarised: false, limeDate: TODAY, today: TODAY });

  const neem = result.locks.find((l) => l.id === 'neem-cake');
  const urea = result.locks.find((l) => l.id === 'urea');

  assert.equal(neem.days, 10);
  assert.equal(neem.notBefore, day(10));
  assert.equal(urea.days, 21);
  assert.equal(urea.notBefore, day(21));
});

test('Route B adds the 14-day transplant wait and the 21-day nitrogen blackout', () => {
  const result = limePlan({ readings: [5.0, 5.0, 5.0], texture: 'sandy_loam', areaM2: 200,
    solarised: true, limeDate: TODAY, today: TODAY });

  const transplant = result.locks.find((l) => l.id === 'transplant');
  const nitrogen = result.locks.find((l) => l.id === 'nitrogen');

  assert.equal(transplant.notBefore, day(14));
  assert.equal(nitrogen.notBefore, day(21));
  assert.match(nitrogen.text, /Calcium Nitrate/i);
});

test('a pH inside the gate asks for no lime at all', () => {
  const result = limePlan({ readings: [6.2, 6.4, 6.3], texture: 'sandy_loam', areaM2: 300,
    solarised: false, today: TODAY });

  assert.equal(result.band, 'in-range');
  assert.equal(result.action, 'no-lime');
});

test('two readings are not a three-point test, and the calculator says so', () => {
  const result = limePlan({ readings: [5.3, 5.4], texture: 'sandy_loam', areaM2: 300, today: TODAY });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'three-points');
});

test('an average that passes while one point fails is flagged, not buried', () => {
  const result = limePlan({ readings: [5.1, 6.0, 5.6], texture: 'sandy_loam', areaM2: 300,
    solarised: false, today: TODAY });

  assert.equal(result.band, 'in-range');
  assert.ok(result.warnings.some((w) => /5\.1/.test(w)), result.warnings.join(' | '));
});

// --- Gate 3, stock, PHI, timing, mixing ----------------------------------

test('a plan with no confirmed diagnosis does not get past Gate 3', () => {
  const state = farm({ diagnoses: [] });
  const verdict = verdictOf(state, plan());

  assert.equal(verdict.ok, false);
  assert.equal(checkNamed(verdict, 'gate3').state, 'fail');
});

test('a diagnosis nobody senior confirmed does not count', () => {
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', date: day(-1), by: 'u_hand' }],
  });
  assert.equal(checkNamed(verdictOf(state, plan()), 'gate3').reason, 'unconfirmed');
});

test('a product with no rate on file cannot be planned, and the app does not invent one', () => {
  // Abamectin is in the catalogue with schedule_rate null.
  const verdict = verdictOf(farm(), plan({ activeKey: 'abamectin' }));
  const cat = checkNamed(verdict, 'catalogue');

  assert.equal(cat.state, 'fail');
  assert.match(cat.fix, /label rate/i);
});

test('a banned active is refused even if somebody types the brand name', () => {
  const verdict = verdictOf(farm(), plan({ activeKey: 'carbofuran', brand: 'Furadan' }));

  assert.equal(checkNamed(verdict, 'catalogue').state, 'fail');
  assert.equal(checkNamed(verdict, 'catalogue').banned, true);
  assert.equal(isBanned('Furadan'), true);
  assert.equal(catalogue().some((a) => /carbofuran/i.test(a.ai)), false,
    'FR-STOCK-09: it does not ship in the catalogue at all');
});

test('a product that is not in the store is refused, with the quantity it would have needed', () => {
  const state = farm({ inputs: {} });
  const stock = checkNamed(verdictOf(state, plan()), 'stock');

  assert.equal(stock.state, 'fail');
  assert.match(stock.fix, /4\.8 ml/);
});

test('an expired product cannot be selected', () => {
  const state = farm({
    inputs: { i_spin: { id: 'i_spin', name: 'Spinosad 45SC', unit: 'litre', qty: 2, expiry: day(-5) } },
  });
  const stock = checkNamed(verdictOf(state, plan()), 'stock');

  assert.equal(stock.state, 'fail');
  assert.equal(stock.ref, 'FR-STOCK-04');
});

test('not enough in the store to fill the tanks is a refusal, not a rounding-down', () => {
  const state = farm({
    inputs: { i_manc: { id: 'i_manc', name: 'Mancozeb 80WP', unit: 'kg', qty: 0.5 } },
  });
  // 2.5 g/L over ten 16 L loads is 400 g... which fits. Twenty loads does not.
  const verdict = verdictOf(state, plan({ activeKey: 'mancozeb', loads: 20, targetPest: 'anthracnose' }));

  assert.equal(checkNamed(verdict, 'stock').state, 'fail');
});

test('a harvest booked inside the waiting period blocks the plan', () => {
  const state = farm({
    tasks: {
      t1: { id: 't1', kind: 'harvest', cycleId: 'c1', due: `${day(3)}T08:00`, status: 'open' },
    },
  });
  const phi = checkNamed(verdictOf(state, plan()), 'phi');

  assert.equal(phi.state, 'fail');
  assert.equal(phi.safeFrom, day(14), 'the default PHI for a synthetic is 14 days (C-8)');
  assert.deepEqual(phi.blockedTasks, ['t1']);
});

test('a label PHI is used only when it is longer than the default', () => {
  const spinosad = activeByKey('spinosad');

  assert.equal(intervalsFor(spinosad, { phiDays: 3 }).phiDays, 14, 'a shorter label does not shorten the wait');
  assert.equal(intervalsFor(spinosad, { phiDays: 21 }).phiDays, 21, 'a longer label does');
  assert.equal(intervalsFor(spinosad, null).phiDays, 14);
  assert.equal(intervalsFor(spinosad, { reiHours: 12 }).reiHours, 24);
  assert.equal(intervalsFor(spinosad, { reiHours: 48 }).reiHours, 48);
});

test('a spray outside the 4-7 PM window is refused', () => {
  const verdict = verdictOf(farm(), plan({ at: `${TODAY}T11:00` }));
  const timing = checkNamed(verdict, 'timing');

  assert.equal(timing.state, 'fail');
  assert.match(timing.fix, /4-7 PM/);
});

test('once the crop is flowering the window closes until 5 PM', () => {
  const at4 = verdictOf(farm(), plan({ at: `${TODAY}T16:30`, flowering: true }));
  const at5 = verdictOf(farm(), plan({ at: `${TODAY}T17:30`, flowering: true }));

  assert.equal(checkNamed(at4, 'timing').state, 'fail');
  assert.equal(checkNamed(at5, 'timing').state, 'pass');
});

test('wet leaves postpone the spray', () => {
  const timing = checkNamed(verdictOf(farm(), plan({ leavesWet: true })), 'timing');

  assert.equal(timing.state, 'fail');
  assert.match(timing.fix, /Mancozeb needs 2 dry hours/i);
});

test('the mixing rules stop a tank that must not be mixed', () => {
  const verdict = verdictOf(farm(), plan({ mixWith: ['Calcium Nitrate', 'K Nitrate'] }));
  const mixing = checkNamed(verdict, 'mixing');

  assert.equal(mixing.state, 'fail');
  assert.match(mixing.why, /Ca Nitrate \+ K Nitrate/i);
  assert.match(mixing.fix, /separate passes/i);
});

test('neem without soap is refused; the premix rate already carries the soap', () => {
  const without = verdictOf(farm(), plan({ activeKey: 'neem', rate: '150 ml/L' }));
  const premix = verdictOf(farm(), plan({ activeKey: 'neem' }));

  assert.equal(checkNamed(without, 'mixing').state, 'fail');
  assert.equal(checkNamed(premix, 'mixing').state, 'pass');
});

test('SR-05: a microbial inoculant never shares a tank with a fungicide', () => {
  const verdict = verdictOf(farm(), plan({ activeKey: 'mancozeb', targetPest: 'anthracnose',
    mixWith: ['Trichoderma harzianum'] }));

  assert.equal(checkNamed(verdict, 'mixing').state, 'fail');
});

test('wound-care copper stays out of the rotation count (C-7)', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'copper_oxychloride', date: day(-4), woundCare: true }],
  });
  const verdict = verdictOf(state, plan({ activeKey: 'copper_oxychloride', targetPest: 'bacterial spot' }));

  assert.equal(checkNamed(verdict, 'rotation').state, 'pass');
});

test('the Week 10 copper exception allows a repeat at 10 days but not at 5', () => {
  const state = (gap) => farm({
    cycleDay: -80,
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'copper_hydroxide',
      activeKey: 'copper_hydroxide', date: day(-gap) }],
  });
  const soon = verdictOf(state(5), plan({ activeKey: 'copper_hydroxide', targetPest: 'bacterial spot' }));
  const later = verdictOf(state(11), plan({ activeKey: 'copper_hydroxide', targetPest: 'bacterial spot' }));

  assert.equal(checkNamed(soon, 'rotation').state, 'fail');
  assert.equal(checkNamed(later, 'rotation').state, 'pass');
  assert.equal(checkNamed(later, 'rotation').exception, 'week-10-m1');
});

test('outside Week 10 the copper exception does not apply', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'copper_hydroxide',
      activeKey: 'copper_hydroxide', date: day(-12) }],
  });
  const verdict = verdictOf(state, plan({ activeKey: 'copper_hydroxide', targetPest: 'bacterial spot' }));

  assert.equal(checkNamed(verdict, 'rotation').state, 'fail');
});

test('neem twice running is not a rotation breach: IRAC UN is not a resistance group', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'neem', date: day(-6) }],
  });
  assert.equal(checkNamed(verdictOf(state, plan({ activeKey: 'neem' })), 'rotation').state, 'pass');
});

// --- The next valid option, PPE and follow-up ----------------------------

test('a refused plan comes back with options that would themselves pass', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'spinosad', date: day(-7) }],
  });
  const options = nextValidOptions(state, plan(), { today: TODAY });

  assert.ok(options.length);
  for (const option of options) {
    const again = checkPlan(state, plan({ activeKey: option.active.key }), { today: TODAY });
    assert.equal(again.ok, true, `${option.active.ai} was offered but does not pass: `
      + JSON.stringify(again.failed.map((f) => f.why)));
  }
});

test('thrips options are drawn from the thrips programme, not the whole shelf', () => {
  const state = farm({
    sprays: [{ id: 's1', cycleId: 'c1', productId: 'spinosad', date: day(-7) }],
  });
  const named = Object.values(rules().thrips_program.options_by_group).join(' ').toLowerCase();

  for (const option of nextValidOptions(state, plan({ targetPest: 'thrips' }), { today: TODAY })) {
    assert.ok(named.includes(option.active.ai.split(/[\s/(]/)[0].toLowerCase()),
      `${option.active.ai} is not in the thrips programme`);
  }
});

test('FR-TREAT-04: PPE comes back as pictures with a reason, and lime demands a briefing', () => {
  const spray = ppeFor({ active: activeByKey('spinosad') });
  const lime = ppeFor({ task: 'lime' });

  assert.ok(spray.items.length >= 4);
  assert.ok(spray.items.every((i) => i.icon && i.label && i.why), 'every item needs a picture and a reason');
  assert.ok(spray.items.some((i) => i.id === 'mask'));
  assert.ok(spray.items.some((i) => i.id === 'gloves'));
  assert.equal(spray.briefing, false);
  assert.match(spray.after, /Rinse knapsack 3x/i, 'SR-07 rides along with every insecticide');

  assert.equal(lime.briefing, true);
  assert.ok(lime.items.some((i) => i.id === 'goggles'));
  assert.ok(lime.items.some((i) => i.id === 'dust_mask'));
  assert.match(lime.briefingText, /logged/i);
});

test('every plan check carries the rule it is enforcing', () => {
  const verdict = verdictOf(farm(), plan());

  assert.equal(verdict.checks.length, CHECKS.length);
  for (const c of verdict.checks) {
    assert.ok(c.ref, `${c.id} does not say which rule it is applying`);
    assert.ok(c.why, `${c.id} does not say why`);
  }
});

test('a clean plan passes, and still says who has to approve it', () => {
  const verdict = verdictOf(farm(), plan());

  assert.equal(verdict.ok, true, JSON.stringify(verdict.failed, null, 1));
  assert.match(verdict.approval, /Farm Manager approves/i);
  assert.equal(verdict.safeToPickFrom, day(14));
  assert.ok(verdict.ppe.items.length);
});

test('FR-DOC-07: a follow-up check falls three days after the treatment', () => {
  const task = followUpTask({ id: 'sp1', cycleId: 'c1', date: TODAY }, { zoneName: 'GH-01' });

  assert.equal(task.due.slice(0, 10), day(3));
  assert.equal(task.sprayId, 'sp1');
  assert.equal(task.proof, true);
});

test('the crop week follows week_counting, not the calendar month', () => {
  const state = farm({ cycleDay: 0 });

  assert.equal(cropWeek(state, 'c1', TODAY).week, 0, 'transplant day is Day 1 of Week 0');
  assert.equal(cropWeek(state, 'c1', day(6)).week, 0, 'Week 0 is days 1-7');
  assert.equal(cropWeek(state, 'c1', day(7)).week, 1, 'Week 1 starts on day 8');
  assert.equal(cropWeek(state, 'c1', day(70)).day, 71);
  assert.equal(cropWeek(state, 'c1', day(70)).week, 10);
});
