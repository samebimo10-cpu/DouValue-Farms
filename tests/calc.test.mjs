// The dose and lime calculators, and the gear before the job.
//
// FR-DOC-05 asks for two calculators: a dose per 16 L knapsack and per tank,
// and a lime calculator that turns three pH readings, a soil texture and a bed
// area into a route, a product and kilograms. FR-TREAT-04 asks for the
// protective equipment as pictures, confirmed with a tap, before the task
// starts.
//
// Ported from claude/farm-doctor-planning-calcs, where they were written. The
// refusals are the point: the lime calculator answering "hold, and re-test in
// ten days" is the rules refusing to let a block be limed twice on the same
// reading, which is how soil gets over-corrected and a season gets lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
await loadRules();

const { dosePlan, parseRate, limePlan, TANKS, TEXTURES } = await import(new URL('domain/calc.js', base).href);
const { ppeFor, sprayRule } = await import(new URL('domain/doctor.js', base).href);
const { buildCatalogue, resolveActive } = await import(new URL('domain/catalogue.js', base).href);

/** One active from the catalogue, in the shape the Farm Doctor reads. */
const activeByKey = (name) => {
  const found = resolveActive(buildCatalogue({}), name);
  return found ? { ...found, organic: /neem|garlic|copper hydroxide|trichoderma|bacillus/i.test(found.name) } : null;
};
const { KNAPSACK_L } = await import(new URL('domain/safety.js', base).href);

const TODAY = '2026-09-21';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

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
