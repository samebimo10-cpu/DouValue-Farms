// Tests for the parts of the app that decide things: what is wrong with a plant,
// when fruit is safe to pick, what a bed will yield, and what the log adds up to.
// Run with:  node --test douvalue/tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const util = await load('util.js');
const crops = await load('domain/crops.js');
const climate = await load('domain/climate.js');
const pests = await load('domain/pests.js');
const diagnose = await load('domain/diagnose.js');
const safety = await load('domain/safety.js');
const predict = await load('domain/predict.js');
const store = await load('store.js');

// --- Utilities ------------------------------------------------------------

test('dates count calendar days, not hours', () => {
  assert.equal(util.daysBetween('2026-03-01', '2026-03-08'), 7);
  assert.equal(util.daysBetween('2026-03-08', '2026-03-01'), -7);
  assert.equal(util.isoDate(util.addDays('2026-02-27', 2)), '2026-03-01'); // 2026 is not a leap year
});

test('money reads as naira', () => {
  assert.equal(util.naira(1500), '₦1,500');
  assert.equal(util.naira(2400000, true), '₦2.4m');
});

// --- Crops ----------------------------------------------------------------

test('every crop profile is internally consistent', () => {
  for (const crop of crops.CROP_LIST) {
    assert.ok(crop.daysToFlower < crop.daysToFirstHarvest, `${crop.id}: flowers before it fruits`);
    assert.ok(crop.daysToFirstHarvest < crop.daysToPeak, `${crop.id}: first pick before peak`);
    assert.ok(crop.daysToFirstHarvest + crop.harvestWindowDays <= crop.cycleDays + 30, `${crop.id}: window fits the cycle`);
    assert.ok(crop.yieldPerPlantKg.low < crop.yieldPerPlantKg.typical);
    assert.ok(crop.yieldPerPlantKg.typical < crop.yieldPerPlantKg.high);
  }
});

test('habanero is the slow one and bell the quickest to pick', () => {
  assert.ok(crops.CROPS.habanero.daysToFirstHarvest > crops.CROPS.chili.daysToFirstHarvest);
  assert.ok(crops.CROPS.chili.daysToFirstHarvest > crops.CROPS.bell.daysToFirstHarvest);
});

test('plant population follows the spacing', () => {
  const pop = crops.populationPerHa('bell'); // 0.5 x 0.6 m
  assert.equal(pop, 33333);
  assert.equal(crops.plantsForArea('bell', 600), 2000);
});

test('growth stage advances with days after transplant', () => {
  assert.equal(crops.stageAt('bell', -10).id, 'nursery');
  assert.equal(crops.stageAt('bell', 5).id, 'establish');
  assert.equal(crops.stageAt('bell', 40).id, 'flowering');
  assert.equal(crops.stageAt('bell', 75).id, 'harvest');
});

// --- Climate --------------------------------------------------------------

test('the wet season is wet and the dry season is not', () => {
  const august = climate.wetnessIndex('2026-08-15');
  const january = climate.wetnessIndex('2026-01-15');
  assert.ok(august > 0.7, `August wetness ${august}`);
  assert.ok(january < 0.3, `January wetness ${january}`);
  assert.ok(Math.abs(climate.drynessIndex('2026-01-15') + january - 1) < 1e-9, 'dryness is the inverse of wetness');
});

test('waterlogging pressure peaks with the rains', () => {
  assert.ok(climate.waterloggingIndex('2026-09-15') > climate.waterloggingIndex('2026-12-15'));
});

test('growing degree days respect the base and the cut-off', () => {
  assert.equal(climate.gdd(30, 20, 10, 30), 15);
  assert.equal(climate.gdd(40, 35, 10, 30), 20); // capped at the cut-off
  assert.equal(climate.gdd(8, 5, 10, 30), 0);    // too cold to grow
});

test('irrigation is only needed when rain falls short', () => {
  assert.ok(climate.irrigationGapMmPerDay('2026-01-15', 5.5) > 3, 'dry season needs watering');
  assert.equal(climate.irrigationGapMmPerDay('2026-08-15', 5.5), 0, 'peak rains cover the crop');
});

test('price seasonality peaks in the scarce months', () => {
  const july = climate.priceIndexOn('2026-07-10');
  const december = climate.priceIndexOn('2026-12-10');
  assert.ok(july > december * 1.5, `July ${july} against December ${december}`);
  const mean = Object.values(climate.PRICE_SEASONALITY).reduce((a, b) => a + b, 0) / 12;
  assert.ok(Math.abs(mean - 1) < 0.08, `index should average about 1, got ${mean}`);
});

// --- Knowledge base -------------------------------------------------------

test('every problem points at symptoms and lookalikes that exist', () => {
  const symptomIds = new Set(pests.SYMPTOMS.map((s) => s.id));
  const problemIds = new Set(pests.PROBLEMS.map((p) => p.id));
  for (const p of pests.PROBLEMS) {
    assert.ok(Object.keys(p.symptoms).length, `${p.id} has symptoms`);
    for (const sid of Object.keys(p.symptoms)) {
      assert.ok(symptomIds.has(sid), `${p.id} refers to unknown symptom ${sid}`);
    }
    for (const l of p.lookalikes || []) {
      assert.ok(problemIds.has(l), `${p.id} refers to unknown lookalike ${l}`);
      assert.notEqual(l, p.id, `${p.id} lists itself as a lookalike`);
    }
    assert.ok(p.confirm.length, `${p.id} says how to confirm it`);
    assert.ok(p.manage.now.length, `${p.id} says what to do now`);
    assert.ok(p.severity >= 1 && p.severity <= 5);
  }
});

test('every symptom belongs to a part the wizard asks about', () => {
  const parts = new Set(pests.PARTS.map((p) => p.id));
  for (const s of pests.SYMPTOMS) {
    assert.ok(parts.has(s.part), `${s.id} sits in unknown part ${s.part}`);
    assert.ok(s.label && s.pidgin, `${s.id} needs both languages`);
  }
});

// --- Diagnosis ------------------------------------------------------------

function top(ctx) {
  const r = diagnose.diagnose(ctx);
  return r.results[0];
}

test('the streaming test points at bacterial wilt', () => {
  const best = top({ symptoms: ['wilt_sudden_green', 'stem_ooze_white'], parts: ['whole', 'stem'],
    cropId: 'habanero', dat: 60, date: '2026-08-10' });
  assert.equal(best.id, 'bacterial_wilt');
  assert.equal(best.confidence.id, 'strong');
});

test('a wet low corner with a stem lesion points at Phytophthora', () => {
  const best = top({ symptoms: ['wilt_sudden_green', 'stem_lesion_soil', 'pattern_low_wet', 'pattern_after_rain'],
    parts: ['whole', 'stem', 'pattern'], cropId: 'habanero', dat: 60, date: '2026-08-10' });
  assert.equal(best.id, 'phytophthora_blight');
});

test('a sunken fruit lesion in the rains is anthracnose', () => {
  const best = top({ symptoms: ['fruit_sunken_lesion', 'pattern_after_rain'], parts: ['fruit', 'pattern'],
    cropId: 'bell', dat: 85, date: '2026-07-20' });
  assert.equal(best.id, 'anthracnose');
});

test('webbing in the dry season is spider mite, not a disease', () => {
  const best = top({ symptoms: ['leaf_webbing', 'leaf_stipple', 'pattern_after_dry'], parts: ['leaf', 'pattern'],
    cropId: 'chili', dat: 90, date: '2026-01-15' });
  assert.equal(best.id, 'red_spider_mite');
});

test('vein banding and stunting point at virus', () => {
  const best = top({ symptoms: ['leaf_vein_banding', 'leaf_mosaic', 'stunted', 'pattern_field_edge'],
    parts: ['leaf', 'whole', 'pattern'], cropId: 'habanero', dat: 50, date: '2026-05-01' });
  assert.equal(best.id, 'pvmv');
});

test('a black blossom end is a disorder, not something to spray', () => {
  const best = top({ symptoms: ['fruit_black_end'], parts: ['fruit'], cropId: 'bell', dat: 80, date: '2026-02-10' });
  assert.equal(best.id, 'blossom_end_rot');
  assert.equal(best.problem.type, 'disorder');
});

test('toppling seedlings in the nursery are damping-off', () => {
  const best = top({ symptoms: ['seedling_topple', 'pattern_patches'], parts: ['seedling', 'pattern'],
    cropId: 'bell', dat: -20, date: '2026-06-01' });
  assert.equal(best.id, 'damping_off');
});

test('one vague observation never produces a confident answer', () => {
  const r = diagnose.diagnose({ symptoms: ['pattern_after_rain'], parts: ['pattern'],
    cropId: 'bell', dat: 60, date: '2026-07-20' });
  assert.ok(r.results.length, 'it still offers candidates');
  for (const hit of r.results) {
    assert.notEqual(hit.confidence.id, 'strong', `${hit.id} should not be a strong match on one vague tick`);
  }
  assert.ok(r.nextChecks.length, 'it says what to go and look at');
});

test('evidence in a part nobody inspected does not win the ranking', () => {
  // Cercospora lives on leaves. Report a stem and pattern problem without ever
  // looking at a leaf, and it must not come top on a shared generic symptom.
  const r = diagnose.diagnose({ symptoms: ['wilt_sudden_green', 'stem_lesion_soil', 'pattern_after_rain'],
    parts: ['whole', 'stem', 'pattern'], cropId: 'bell', dat: 60, date: '2026-08-01' });
  assert.notEqual(r.results[0].id, 'cercospora_leaf_spot');
});

test('nothing ticked means nothing claimed', () => {
  const r = diagnose.diagnose({ symptoms: [], parts: ['leaf'], cropId: 'bell' });
  assert.equal(r.results.length, 0);
});

test('the separating question distinguishes the top two', () => {
  const r = diagnose.diagnose({ symptoms: ['wilt_sudden_green', 'pattern_patches'], parts: ['whole', 'pattern'],
    cropId: 'habanero', dat: 60, date: '2026-08-10' });
  if (r.separator) {
    assert.notEqual(r.separator.points_to.id, r.separator.away_from.id);
    assert.ok(r.separator.symptom.label);
  }
});

test('the risk board rises in the rains and falls in the dry', () => {
  const beds = [{ cropId: 'bell', stage: 'fruiting', label: 'B1' }];
  const wet = diagnose.riskForecast(beds, '2026-08-15');
  const dry = diagnose.riskForecast(beds, '2026-01-15');
  const anthWet = wet.find((r) => r.problem.id === 'anthracnose');
  const anthDry = dry.find((r) => r.problem.id === 'anthracnose');
  assert.ok(anthWet && anthWet.risk > 0.6, 'anthracnose is a wet-season worry');
  assert.ok(!anthDry || anthDry.risk < anthWet.risk);
  assert.ok(dry.some((r) => r.problem.id === 'red_spider_mite'), 'mites show up in the dry season');
});

// --- Spray safety ---------------------------------------------------------

test('fruit cannot be picked inside the pre-harvest interval', () => {
  const apps = [{ productId: 'metalaxyl_mancozeb', date: '2026-09-08', bedId: 'b1' }];
  const c = safety.harvestClearance(apps, new Date('2026-09-11'));
  assert.equal(c.safe, false);
  assert.equal(c.clearOn, '2026-09-22');
  assert.equal(c.daysLeft, 11);
});

test('the longest outstanding interval is the one that blocks', () => {
  const apps = [
    { productId: 'neem', date: '2026-09-10' },               // 0 days
    { productId: 'lambda_cyhalothrin', date: '2026-09-09' }, // 7 days
    { productId: 'copper_oxychloride', date: '2026-09-10' }, // 3 days
  ];
  const c = safety.harvestClearance(apps, new Date('2026-09-11'));
  assert.equal(c.clearOn, '2026-09-16');
});

test('once every interval has passed, picking is clear', () => {
  const c = safety.harvestClearance([{ productId: 'mancozeb', date: '2026-08-01' }], new Date('2026-09-11'));
  assert.equal(c.safe, true);
});

test('workers are kept out until the re-entry interval expires', () => {
  const apps = [{ productId: 'lambda_cyhalothrin', date: '2026-09-11', at: '2026-09-11T06:00:00' }];
  const blocked = safety.reentryClearance(apps, new Date('2026-09-11T10:00:00'));
  assert.equal(blocked.safe, false);
  assert.equal(blocked.hoursLeft, 20);
  const later = safety.reentryClearance(apps, new Date('2026-09-12T08:00:00'));
  assert.equal(later.safe, true);
});

test('repeat use of one resistance group raises a warning', () => {
  const apps = [
    { productId: 'lambda_cyhalothrin', date: '2026-08-01' },
    { productId: 'cypermethrin', date: '2026-08-15' },   // same IRAC group
    { productId: 'lambda_cyhalothrin', date: '2026-09-01' },
  ];
  const warnings = safety.resistanceWarnings(apps, 60, new Date('2026-09-11'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].group, /3A/);
  assert.ok(warnings[0].alternatives.length);
});

test('rotating between groups raises no warning', () => {
  const apps = [
    { productId: 'mancozeb', date: '2026-08-01' },
    { productId: 'azoxystrobin', date: '2026-08-15' },
    { productId: 'difenoconazole', date: '2026-09-01' },
  ];
  assert.equal(safety.resistanceWarnings(apps, 60, new Date('2026-09-11')).length, 0);
});

test('recommended products exclude the ones flagged as unsafe', () => {
  for (const problem of pests.PROBLEMS) {
    for (const p of safety.productsFor(problem.id)) {
      assert.notEqual(p.hazard, 'avoid', `${p.name} should not be recommended`);
    }
  }
  const nematode = safety.discouragedFor('root_knot_nematode');
  assert.ok(nematode.some((p) => p.id === 'carbofuran'), 'carbofuran is called out, not recommended');
});

test('every product carries the numbers the app relies on', () => {
  for (const p of safety.PRODUCTS) {
    assert.ok(Number.isFinite(p.phiDays) && p.phiDays >= 0, `${p.id} needs a pre-harvest interval`);
    assert.ok(Number.isFinite(p.reiHours) && p.reiHours >= 0, `${p.id} needs a re-entry interval`);
    assert.ok(safety.HAZARD[p.hazard], `${p.id} has a known hazard class`);
  }
});

// --- Forecasting ----------------------------------------------------------

test('yield scales with the number of plants', () => {
  const small = predict.harvestForecast({ cropId: 'chili', transplantDate: '2026-05-01', plants: 500 }, { today: '2026-09-01' });
  const big = predict.harvestForecast({ cropId: 'chili', transplantDate: '2026-05-01', plants: 1000 }, { today: '2026-09-01' });
  assert.ok(Math.abs(big.totalKg - small.totalKg * 2) < 1);
});

test('milestones fall in the right order', () => {
  const f = predict.harvestForecast({ cropId: 'habanero', transplantDate: '2026-05-01', plants: 100 }, { today: '2026-05-01' });
  const m = f.milestones;
  assert.ok(m.transplant < m.flowering);
  assert.ok(m.flowering < m.firstHarvest);
  assert.ok(m.firstHarvest < m.peak);
  assert.ok(m.peak < m.lastHarvest);
});

test('the picking curve adds up to the total and peaks early in the window', () => {
  const f = predict.harvestForecast({ cropId: 'bell', transplantDate: '2026-05-01', plants: 1000 }, { today: '2026-05-01' });
  const curveTotal = f.curve.reduce((s, w) => s + w.kg, 0);
  assert.ok(Math.abs(curveTotal - f.totalKg) / f.totalKg < 0.02, 'curve sums to the forecast');
  const peakWeek = f.curve.reduce((a, b) => (b.kg > a.kg ? b : a));
  assert.ok(peakWeek.week <= f.curve.length / 2, 'peaks in the first half, then tails off');
});

test('a sick, patchy crop is forecast lower than a clean one', () => {
  const clean = predict.harvestForecast({ cropId: 'bell', transplantDate: '2026-05-01', plants: 1000 }, { today: '2026-05-01' });
  const sick = predict.harvestForecast({
    cropId: 'bell', transplantDate: '2026-05-01', plants: 1000,
    events: { diseaseIncidencePct: 30, gapPct: 15, missedFertiliserSplits: 2 },
  }, { today: '2026-05-01' });
  assert.ok(sick.totalKg < clean.totalKg * 0.7, `${sick.totalKg} should be well under ${clean.totalKg}`);
  assert.ok(sick.health.reasons.length >= 3, 'and it says why');
});

test('calibration learns from finished cycles', () => {
  const cal = predict.calibrate([
    { cropId: 'habanero', plants: 1000, actualKg: 700 },  // 0.7 kg/plant against a 1.4 book figure
    { cropId: 'habanero', plants: 1000, actualKg: 700 },
  ]);
  assert.ok(Math.abs(cal.habanero.multiplier - 0.5) < 0.01);
  assert.equal(cal.habanero.samples, 2);
  assert.equal(cal.bell.multiplier, 1, 'a crop with no history keeps the book figure');
});

test('a calibrated forecast follows the farm, not the book', () => {
  const cal = predict.calibrate([{ cropId: 'chili', plants: 1000, actualKg: 550 }]);
  const f = predict.harvestForecast({ cropId: 'chili', transplantDate: '2026-05-01', plants: 1000 },
    { today: '2026-05-01', calibration: cal });
  assert.ok(Math.abs(f.totalKg - 550) < 5, `expected about 550, got ${f.totalKg}`);
  assert.equal(f.confidence, 'fair');
});

test('accuracy is measured on cycles held out of the calibration', () => {
  const closed = [
    { id: 'a', cropId: 'chili', plants: 1000, actualKg: 550, transplantDate: '2026-01-01' },
    { id: 'b', cropId: 'chili', plants: 1000, actualKg: 560, transplantDate: '2026-02-01' },
  ];
  const acc = predict.forecastAccuracy(closed);
  assert.equal(acc.heldOut, true);
  assert.equal(acc.rows.length, 2);
  // Cycle 'a' is predicted from 'b' alone, so the prediction is 560, not 550.
  assert.ok(Math.abs(acc.rows[0].predicted - 560) < 5, `held-out prediction was ${acc.rows[0].predicted}`);
  assert.ok(acc.meanErrorPct < 10);
});

test('revenue follows the season, not just the weight', () => {
  const f = predict.harvestForecast({ cropId: 'chili', transplantDate: '2026-01-01', plants: 1000 }, { today: '2026-01-01' });
  const r = predict.revenueForecast(f, { basePriceNgnPerKg: 2000 });
  assert.ok(r.sellableKg < f.totalKg, 'grade-out is taken off the top');
  const expensive = r.weeks.find((w) => w.month === 7 || w.month === 8);
  const cheap = r.weeks.find((w) => w.month === 12 || w.month === 1);
  if (expensive && cheap) assert.ok(expensive.priceNgnPerKg > cheap.priceNgnPerKg);
});

test('the planner favours sowing dates that pick into the scarce months', () => {
  const plan = predict.bestSowingWindow('chili', { year: 2027, plants: 1000 });
  const peakMonth = Number(plan.best.peakHarvest.slice(5, 7));
  assert.ok([6, 7, 8, 9].includes(peakMonth), `peak picking landed in month ${peakMonth}`);
  assert.ok(plan.upliftPct > 20, 'timing is worth a lot more than nothing');
  assert.ok(plan.best.score >= plan.worst.score);
});

test('the planner covers the whole year and never recommends a rotten date', () => {
  for (const cropId of ['bell', 'chili', 'habanero']) {
    const plan = predict.bestSowingWindow(cropId, { year: 2027, plants: 100 });
    assert.ok(plan.candidates.length >= 50, `${cropId}: a candidate for most weeks`);
    assert.ok(plan.best.diseasePressure <= plan.worst.diseasePressure + 0.35);
  }
});

test('labour need scales with the weight to be picked', () => {
  const light = predict.labourForecast(120);
  const heavy = predict.labourForecast(1200);
  assert.ok(heavy.peoplePerPickDay > light.peoplePerPickDay);
  assert.ok(heavy.totalHours === light.totalHours * 10);
});

test('stock runs out at the rate it is actually used', () => {
  const usage = [];
  for (let i = 1; i <= 30; i++) usage.push({ itemId: 'x', qty: 1, date: util.isoDate(util.addDays(new Date('2026-09-11'), -i)) });
  const f = predict.stockForecast({ id: 'x', qty: 10, unit: 'kg' }, usage, new Date('2026-09-11'));
  assert.ok(f.daysLeft <= 11 && f.daysLeft >= 9, `about ten days left, got ${f.daysLeft}`);
  assert.equal(f.status, 'low');
  const idle = predict.stockForecast({ id: 'y', qty: 5, unit: 'kg' }, [], new Date('2026-09-11'));
  assert.equal(idle.status, 'idle');
});

test('break-even reports the share of the crop it takes', () => {
  const be = predict.breakEven(900000, 2400, 1500);
  assert.equal(be.kgNeeded, 375);
  assert.equal(be.verdict, 'comfortable');
  assert.equal(predict.breakEven(900000, 200, 1500).verdict, 'loss at this price');
});

// --- Event log ------------------------------------------------------------

const ev = (type, payload, at, by = 'p1') => ({ id: `e_${Math.random()}`, type, at, by, payload });

const sampleLog = [
  ev('settings.update', { farmName: 'DouValue Farm' }, '2026-01-01T08:00:00Z'),
  ev('person.upsert', { id: 'p1', name: 'Ada', role: 'manager', dailyRate: 6000 }, '2026-01-01T08:01:00Z'),
  ev('person.upsert', { id: 'p2', name: 'Emeka', role: 'hand', dailyRate: 3500 }, '2026-01-01T08:02:00Z'),
  ev('plot.upsert', { id: 'b1', name: 'Bed 1', areaM2: 600 }, '2026-01-02T08:00:00Z'),
  ev('input.upsert', { id: 'i1', name: 'Mancozeb', unit: 'kg', qty: 10 }, '2026-01-02T08:10:00Z'),
  ev('cycle.start', { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: '2026-05-01', plants: 1200 }, '2026-05-01T08:00:00Z'),
  ev('attendance.in', { personId: 'p2' }, '2026-09-10T07:00:00Z', 'p2'),
  ev('attendance.out', { personId: 'p2' }, '2026-09-10T15:00:00Z', 'p2'),
  ev('harvest.record', { cycleId: 'c1', kg: 48, date: '2026-09-10' }, '2026-09-10T14:00:00Z', 'p2'),
  ev('harvest.record', { cycleId: 'c1', kg: 52, date: '2026-09-11' }, '2026-09-11T14:00:00Z', 'p2'),
  ev('input.issue', { itemId: 'i1', qty: 2.5, date: '2026-09-11' }, '2026-09-11T09:00:00Z'),
  ev('sale.record', { kg: 100, amount: 310000, buyer: 'Mile 3', date: '2026-09-11' }, '2026-09-11T17:00:00Z'),
  ev('task.create', { id: 't1', title: 'Weed Bed 1', assignedTo: 'p2', dueDate: '2026-09-11', priority: 'high' }, '2026-09-11T06:00:00Z'),
];

test('the log replays to the same farm whatever order it arrives in', () => {
  const forward = store.reduce(sampleLog);
  const backward = store.reduce([...sampleLog].reverse());
  const shuffled = store.reduce([...sampleLog].sort(() => Math.random() - 0.5));
  assert.deepEqual(forward.cycles, backward.cycles);
  assert.deepEqual(forward.inputs, shuffled.inputs);
  assert.equal(forward.harvests.length, shuffled.harvests.length);
});

test('harvest totals roll up onto the cycle', () => {
  const s = store.reduce(sampleLog);
  assert.equal(s.cycles.c1.harvestedKg, 100);
});

test('stock is reduced by what was issued', () => {
  const s = store.reduce(sampleLog);
  assert.equal(s.inputs.i1.qty, 7.5);
});

test('a shift produces hours and pay', () => {
  const s = store.reduce(sampleLog);
  assert.equal(s.attendance[0].hours, 8);
  const pay = store.payrollBetween(s, '2026-09-01', '2026-09-30');
  assert.equal(pay.length, 1);
  assert.equal(pay[0].person.name, 'Emeka');
  assert.equal(pay[0].pay, 3500);
});

test('closing a cycle files the actual yield', () => {
  const s = store.reduce([...sampleLog, ev('cycle.close', { id: 'c1', date: '2026-12-01' }, '2026-12-01T10:00:00Z')]);
  assert.equal(s.cycles.c1.status, 'closed');
  assert.equal(s.cycles.c1.actualKg, 100);
  assert.equal(store.activeCycles(s).length, 0);
  assert.equal(store.closedCycles(s).length, 1);
});

test('an event from a newer version of the app is kept, not crashed on', () => {
  const s = store.reduce([...sampleLog, ev('something.invented.later', { foo: 1 }, '2026-09-12T10:00:00Z')]);
  assert.equal(s.cycles.c1.harvestedKg, 100);
  assert.ok(s.log.some((l) => l.type === 'something.invented.later'));
});

test('roles grant only what they should', () => {
  const hand = { role: 'hand' };
  const manager = { role: 'manager' };
  assert.equal(store.can(hand, 'logHarvest'), true);
  assert.equal(store.can(hand, 'manageMoney'), false);
  assert.equal(store.can(hand, 'managePeople'), false);
  assert.equal(store.can(manager, 'manageMoney'), true);
  assert.equal(store.can(null, 'logHarvest'), false);
});

test('open tasks respect assignment and due date', () => {
  const s = store.reduce(sampleLog);
  assert.equal(store.openTasks(s, 'p2', '2026-09-11').length, 1);
  assert.equal(store.openTasks(s, 'p1', '2026-09-11').length, 0, 'not assigned to the manager');
  assert.equal(store.openTasks(s, 'p2', '2026-09-01').length, 0, 'not due yet');
});

test('a hand-entered price index is normalised so it cannot bias the forecast', () => {
  // Same shape, doubled level. The index must not change what the base price means.
  const doubled = {};
  for (let m = 1; m <= 12; m++) doubled[m] = climate.PRICE_SEASONALITY[m] * 2;
  assert.ok(Math.abs(climate.priceIndexOn('2026-07-10', doubled) - climate.priceIndexOn('2026-07-10')) < 1e-9);
  const nonsense = climate.normaliseSeasonality({ 1: 0, 2: -3 });
  assert.deepEqual(nonsense, climate.PRICE_SEASONALITY, 'nonsense falls back to the built-in index');
});

// --- Out-of-order events --------------------------------------------------
//
// Phones on this farm go days without a signal and their clocks drift. An event
// must not be lost because it carries a timestamp earlier than the thing it
// refers to.

test('a completion timestamped before its creation still lands', () => {
  const log = [
    ev('task.complete', { id: 't9' }, '2026-09-11T07:00:00Z', 'p2'),
    ev('task.create', { id: 't9', title: 'Weed Bed 2', assignedTo: 'p2', dueDate: '2026-09-11' }, '2026-09-11T09:00:00Z'),
  ];
  const s = store.reduce(log);
  assert.equal(s.tasks.t9.status, 'done');
  assert.equal(s.tasks.t9.doneBy, 'p2');
  assert.equal(s.orphans.length, 0);
});

test('stock issued before the item was registered still counts', () => {
  const log = [
    ev('input.issue', { itemId: 'i9', qty: 3 }, '2026-09-01T08:00:00Z'),
    ev('input.upsert', { id: 'i9', name: 'Urea', unit: 'bag', qty: 10 }, '2026-09-05T08:00:00Z'),
  ];
  const s = store.reduce(log);
  assert.equal(s.inputs.i9.qty, 7);
  assert.equal(s.stockMoves.length, 1);
});

test('a cycle closed out of order still closes', () => {
  const log = [
    ev('cycle.close', { id: 'c9', date: '2026-08-01' }, '2026-08-01T10:00:00Z'),
    ev('cycle.start', { id: 'c9', plotId: 'b1', cropId: 'chili', transplantDate: '2026-02-01', plants: 100 }, '2026-09-01T10:00:00Z'),
  ];
  const s = store.reduce(log);
  assert.equal(s.cycles.c9.status, 'closed');
});

test('clocking out before clocking in still records the shift', () => {
  const log = [
    ev('attendance.out', { personId: 'p2', hours: 8 }, '2026-09-10T15:00:00Z', 'p2'),
    ev('attendance.in', { personId: 'p2' }, '2026-09-10T16:00:00Z', 'p2'),
  ];
  const s = store.reduce(log);
  assert.equal(s.attendance.length, 1);
  assert.equal(s.attendance[0].hours, 8);
});

test('an event about something this phone has never seen is reported, not lost silently', () => {
  const s = store.reduce([ev('task.complete', { id: 'never_seen' }, '2026-09-11T07:00:00Z')]);
  assert.equal(s.orphans.length, 1);
  assert.equal(s.orphans[0].waitingFor, 'task:never_seen');
  assert.ok(s.log.some((l) => l.type === 'task.complete'), 'it stays in the log for the next merge');
});

test('replay stays deterministic with the parking queue in play', () => {
  const log = [
    ev('task.complete', { id: 't9' }, '2026-09-11T07:00:00Z', 'p2'),
    ev('task.create', { id: 't9', title: 'Weed', assignedTo: 'p2' }, '2026-09-11T09:00:00Z'),
    ev('input.issue', { itemId: 'i9', qty: 3 }, '2026-09-01T08:00:00Z'),
    ev('input.upsert', { id: 'i9', name: 'Urea', unit: 'bag', qty: 10 }, '2026-09-05T08:00:00Z'),
  ];
  const a = store.reduce(log);
  const b = store.reduce([...log].reverse());
  assert.deepEqual(a.tasks, b.tasks);
  assert.deepEqual(a.inputs, b.inputs);
});
