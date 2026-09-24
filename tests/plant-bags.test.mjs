// Plant-bag zones — C-19, FR-GATE-01/02/03/06, FR-DOC-05, FR-DOC-08.
//
// The walkthrough (walkthrough-gh04.test.mjs) takes GH-04 through a bag cycle
// end to end. This file pins the parts it passes through quickly: bed zones do
// not change at all, lime by media volume and the cases where no rate can be
// derived, the rules file and its readable copy, and the server's guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
const RULES = await loadRules();
const { reduce } = await import(new URL('store.js', base).href);
const { canPlant, gateModel, fillCheck } = await import(new URL('domain/gates.js', base).href);
const { mediaLimePlan, TEXTURES } = await import(new URL('domain/calc.js', base).href);
const { batchTrace, galledCycle, mediaOf } = await import(new URL('domain/media.js', base).href);
const { gateEvidence } = await import(new URL('domain/doctor.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const { withGatesCleared } = await import(new URL('./helpers/gates-cleared.mjs', import.meta.url).href);

const TODAY = '2026-09-16';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let n = 0;
const ev = (type, payload, by = 'u_mgr', at = `${day(-1)}T08:${String(n % 60).padStart(2, '0')}:00.000Z`) => (
  { id: `e${n++}`, type, payload, by, at });
const people = [
  ev('person.upsert', { id: 'u_mgr', name: 'Manager', role: 'manager' }, 'u_mgr', '2026-01-01T00:00:00.000Z'),
];
const zones = [
  ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }, 'u_mgr', '2026-01-01T00:01:00.000Z'),
  ev('plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse', areaM2: 300, media: 'bag', barrier: 'none' },
    'u_mgr', '2026-01-01T00:02:00.000Z'),
];
const batch = (o = {}) => ev('media.receive', {
  id: 'm1', label: 'M1', supplier: 'Onne Agro Media', deliveredDate: day(-20), source: 'fresh',
  texture: 'sandy_loam', volumeM3: 6, covered: false, ...o,
}, 'u_mgr', `${o.deliveredDate || day(-20)}T07:00:00.000Z`);
const batchTest = (date, readings, extra = {}) => ev('soiltest.record', {
  id: `st_${date}_${n}`, mediaBatchId: 'm1', date, ph: readings[1], readings, calibrated: true,
  photo: { dataUrl: 'x' }, nematode: 'clean', lab: 'Rivers Soil Lab', ...extra,
}, 'u_mgr', `${date}T09:00:00.000Z`);
const fill = (date, zoneId = 'gh2', extra = {}) => ev('media.fill', {
  id: `f_${zoneId}_${date}`, batchId: 'm1', zoneId, date, bags: 150, newBags: true, ...extra,
}, 'u_mgr', `${date}T10:00:00.000Z`);

// --- Bed zones keep their behaviour exactly -----------------------------------

test('C-19: a bed zone is judged exactly as before, whatever the bag zones beside it are doing', () => {
  const bedOnly = reduce([...people, ...zones.slice(0, 1)]);
  const withBags = reduce([...people, ...zones, batch(), batchTest(day(-10), [6.1, 6.2, 6.3]), fill(day(-5))]);
  const strip = (m) => JSON.parse(JSON.stringify({ ...m, zone: null }));
  assert.deepEqual(strip(gateModel(withBags, 'gh1', { today: TODAY })), strip(gateModel(bedOnly, 'gh1', { today: TODAY })));
  const g0 = gateModel(withBags, 'gh1', { today: TODAY }).gates.find((g) => g.id === 'G0');
  assert.deepEqual(g0.conditions.map((c) => c.id), ['nematode', 'ph', 'topsoil', 'doctor_check']);
  assert.equal(gateModel(withBags, 'gh1', { today: TODAY }).media, 'bed');
});

test('C-19: a zone with no media recorded is bed soil, and a cleared bed zone still plants', () => {
  const state = withGatesCleared(reduce([...people, ...zones.slice(0, 1)]), { zoneId: 'gh1', plantedOn: TODAY });
  assert.equal(mediaOf(state, 'gh1'), 'bed');
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, true);
});

test('C-19: a bed zone\'s own soil tests do not clear a bag zone, and a batch\'s do not clear a bed', () => {
  const s = reduce([...people, ...zones, batch(), batchTest(day(-10), [6.1, 6.2, 6.3]),
    ev('soiltest.record', { id: 'bed', zoneId: 'gh2', date: day(-3), ph: 6.2, readings: [6.1, 6.2, 6.3],
      calibrated: true, photo: { dataUrl: 'x' }, nematode: 'clean', lab: 'Rivers Soil Lab' })]);
  const bag = canPlant(s, 'gh2', { today: TODAY });
  assert.match(bag.blocking.find((c) => c.id === 'ph').why, /No bags have been filled here/);
  assert.match(canPlant(s, 'gh1', { today: TODAY }).blocking.find((c) => c.id === 'ph').why, /No pH reading/);
});

// --- The batch and its fills ----------------------------------------------------

test('C-19: bags cannot be filled in a bed zone, or from a batch that has not cleared', () => {
  const s = reduce([...people, ...zones, batch(), fill(day(-5), 'gh1'), fill(day(-5))]);
  assert.match(s.mediaFills.find((f) => f.zoneId === 'gh1').refused.why, /grows in bed soil/);
  assert.match(s.mediaFills.find((f) => f.zoneId === 'gh2').refused.why, /No pH reading has been recorded for M1/);
});

test('C-19: a batch missing its supplier, a test from before delivery, or a stale result does not clear', () => {
  const noSupplier = reduce([...people, ...zones, batch({ supplier: '' }), batchTest(day(-10), [6.1, 6.2, 6.3])]);
  assert.match(fillCheck(noSupplier, 'm1', { date: TODAY }).why, /does not record its supplier/);
  const early = reduce([...people, ...zones, batch(), batchTest(day(-25), [6.1, 6.2, 6.3])]);
  assert.match(fillCheck(early, 'm1', { date: TODAY }).why, /before it was delivered/);
  const stale = reduce([...people, ...zones, batch({ deliveredDate: day(-200) }), batchTest(day(-100), [6.1, 6.2, 6.3])]);
  assert.match(fillCheck(stale, 'm1', { date: TODAY }).why, /100 days old/);
});

test('C-19: a covered heap needs both solarisation dates, in order', () => {
  const on = reduce([...people, ...zones, batch({ covered: true }), batchTest(day(-10), [6.1, 6.2, 6.3])]);
  assert.match(fillCheck(on, 'm1', { date: TODAY }).why, /the day the plastic went on is not recorded/);
  const backwards = reduce([...people, ...zones, batch({ covered: true, coverFrom: day(-12), coverTo: day(-14) }),
    batchTest(day(-10), [6.1, 6.2, 6.3])]);
  assert.match(fillCheck(backwards, 'm1', { date: TODAY }).why, /lifted .* before it went on/);
  const done = reduce([...people, ...zones, batch({ covered: true, coverFrom: day(-19), coverTo: day(-11) }),
    batchTest(day(-10), [6.1, 6.2, 6.3])]);
  assert.equal(fillCheck(done, 'm1', { date: TODAY }).ok, true);
});

test('C-19: the bag barrier must be recorded; "none" is recorded, and says what it risks', () => {
  const s = reduce([...people, ...zones,
    ev('plot.upsert', { id: 'gh3', name: 'GH-03', type: 'greenhouse', media: 'bag' }, 'u_mgr', '2026-01-01T00:03:00.000Z')]);
  assert.equal(canPlant(s, 'gh3', { today: TODAY }).blocking.find((c) => c.id === 'bag_barrier').state, 'unknown');
  const none = gateModel(s, 'gh2', { today: TODAY }).gates[0].conditions.find((c) => c.id === 'bag_barrier');
  assert.equal(none.state, 'pass');
  assert.match(none.why, /drainage holes/);
});

test('C-19: batch → bags → zone, and a later failure names every zone with its bags', () => {
  const s = reduce([...people, ...zones,
    ev('plot.upsert', { id: 'gh3', name: 'GH-03', type: 'greenhouse', media: 'bag', barrier: 'polythene' }, 'u_mgr', '2026-01-01T00:03:00.000Z'),
    batch(), batchTest(day(-10), [6.1, 6.2, 6.3]), fill(day(-5)), fill(day(-4), 'gh3', { bags: 40 }),
    ev('media.fail', { id: 'm1', date: day(-1), reason: 'nematode', note: 'galls in GH-02 traced to the batch' }, 'u_mgr', `${day(-1)}T12:00:00.000Z`)]);
  const trace = batchTrace(s, 'm1');
  assert.deepEqual(trace.zones.map((z) => [z.name, z.bags]), [['GH-02', 150], ['GH-03', 40]]);
  assert.match(canPlant(s, 'gh3', { today: TODAY }).blocking.find((c) => c.id === 'media_batch').why, /failed on/);
});

test('C-19: a crop is galled by its root inspection, a confirmed root-knot diagnosis, or its batch', () => {
  const cycle = { id: 'c1', plotId: 'gh2', transplantDate: day(-60), status: 'closed', closedAt: day(-1) };
  const base0 = { plots: { gh2: { id: 'gh2', media: 'bag' } }, cycles: { c1: cycle }, mediaFills: [], mediaBatches: {}, soilTests: [] };
  assert.equal(galledCycle(base0, cycle).galled, false);
  assert.equal(galledCycle({ ...base0, gateEvidence: [{ gate: 'G4', itemId: 'root_inspection', cycleId: 'c1', galls: true, date: day(0) }] }, cycle).galled, true);
  assert.equal(galledCycle({ ...base0, diagnoses: [{ cycleId: 'c1', problemId: 'root_knot_nematode', date: day(-10) }] }, cycle).galled, false,
    'an unconfirmed diagnosis is not enough');
  assert.equal(galledCycle({ ...base0, diagnoses: [{ cycleId: 'c1', problemId: 'root_knot_nematode', date: day(-10), confirmedBy: 'u_mgr' }] }, cycle).galled, true);
});

test('FR-DOC-06: the Farm Doctor\'s Gate 0 check on a bag zone lists the batch lines', () => {
  const s = reduce([...people, ...zones]);
  const g0 = gateEvidence(s, { zoneId: 'gh2', today: TODAY, rules: RULES }).gates.find((g) => g.id === 'G0');
  assert.deepEqual(g0.items.map((i) => i.id), ['media_batch', 'ph_three_point', 'lab_report', 'heap_solarisation', 'bag_barrier', 'doctor_check']);
  assert.deepEqual(g0.items.slice(0, 5).map((i) => i.label), RULES.plant_bags.gate_0.pass_all);
  assert.deepEqual(g0.missing.map((m) => m.id), ['media_batch', 'ph_three_point', 'lab_report', 'heap_solarisation', 'doctor_check']);
});

// --- Lime by media volume (FR-DOC-05, C-19) --------------------------------------

test('C-19: lime for a batch is by media volume, from the Route A rate over its 15-20 cm depth', () => {
  const md = readFileSync(new URL('../docs/build-rules.md', import.meta.url), 'utf8');
  for (const t of TEXTURES) {
    const plan = mediaLimePlan({ readings: [5.0, 5.0, 5.1], texture: t.id, volumeM3: 10 });
    assert.equal(plan.derivable, true, t.id);
    assert.equal(plan.basis, 'volume');
    const [lo, hi] = RULES.soil_and_water.lime.route_A.rates_per_100m2_kg[t.rulesKey].split('-').map(Number);
    assert.equal(plan.perM3Low, Math.round((lo / 20) * 100) / 100);
    assert.equal(plan.perM3High, Math.round((hi / 15) * 100) / 100);
    assert.equal(plan.kgLow, Math.round(plan.perM3Low * 10 * 10) / 10);
    // The table in the readable copy is the same numbers.
    assert.ok(md.includes(`| ${t.rulesKey} | ${RULES.soil_and_water.lime.route_A.rates_per_100m2_kg[t.rulesKey]} | ${plan.perM3Low}–${plan.perM3High} |`), t.rulesKey);
  }
});

test('C-19: where no rate can be derived the calculator says why, and never gives a number', () => {
  const low = [5.0, 5.0, 5.1];
  const cases = [
    [{ texture: 'cocopeat', volumeM3: 10 }, 'no-texture', /not one of the textures/],
    [{ texture: 'sandy_loam', volumeM3: 10, covered: true }, 'route-b', /Route B gives no incorporation depth/],
    [{ texture: 'sandy_loam', volumeM3: 0 }, 'no-volume', /no volume recorded/],
  ];
  for (const [o, reason, why] of cases) {
    const plan = mediaLimePlan({ readings: low, ...o });
    assert.equal(plan.derivable, false, reason);
    assert.equal(plan.reason, reason);
    assert.match(plan.why, why);
    assert.equal(plan.kgLow, undefined, 'no kilograms when there is no rate');
    assert.match(plan.rule, /corrected or rejected before any bag is filled/);
  }
  // In range or on hold nothing is limed, so an unknown media is not a problem.
  assert.equal(mediaLimePlan({ readings: [6.1, 6.2, 6.3], texture: 'cocopeat' }).noLime, true);
  assert.equal(mediaLimePlan({ readings: [5.3, 5.3, 5.4], texture: 'cocopeat' }).action, 'hold');
});

test('C-19: a batch whose lime rate cannot be derived is refused at the fill, and told to be corrected or rejected', () => {
  const s = reduce([...people, ...zones, batch({ texture: 'cocopeat' }), batchTest(day(-10), [5.0, 5.0, 5.1]), fill(day(-5))]);
  const refused = s.mediaFills[0].refused;
  assert.match(refused.why, /No lime rate can be derived for this batch/);
  assert.match(refused.why, /corrected or rejected before any bag is filled/);
  // Corrected — the texture recorded — the same reading gets a rate, and still no fill until the re-test.
  const fixed = reduce([...people, ...zones, batch({ texture: 'cocopeat' }), batchTest(day(-10), [5.0, 5.0, 5.1]),
    ev('media.update', { id: 'm1', texture: 'sandy_loam', note: 'It is sandy loam with 10% coir' }, 'u_mgr', `${day(-9)}T09:00:00.000Z`)]);
  const check = fillCheck(fixed, 'm1', { date: day(-8) });
  assert.match(check.why, /Mix 5–9\.4 kg/);
  assert.deepEqual(fixed.mediaBatches.m1.corrections.map((c) => c.fields), [['texture', 'note']]);
});

// --- The rules and their readable copy, and the server ------------------------

test('C-19: plant_bags in the rules JSON is in docs/build-rules.md word for word', () => {
  const md = readFileSync(new URL('../docs/build-rules.md', import.meta.url), 'utf8');
  const pb = RULES.plant_bags;
  for (const line of [...pb.gate_0.pass_all, ...pb.clean_restart.step.pass_all, pb.gate_0.freshness, pb.fill_rule,
    pb.trace.rule, pb.trace.failure, pb.barrier.why, pb.lime.derivation, pb.lime.route, pb.lime.no_rate, pb.lime.after,
    pb.clean_restart.galled, pb.clean_restart.step.name, pb.media_types.bed, pb.media_types.bag, pb.why, pb.source]) {
    assert.ok(md.includes(line), line);
  }
  assert.ok(md.includes('| C-19 |'));
  assert.equal(RULES.meta.decisions, 'C-1 to C-19 applied');
  assert.equal(pb.clean_restart.replaces_step, RULES.clean_restart.steps.find((s) => s.step === 3).id);
});

test('C-19: the server refuses a media record that leaves out what the gate reads', () => {
  const author = { role: 'manager' };
  const w = (type, payload) => core.mayWrite({ type, payload }, author);
  assert.equal(w('media.receive', { id: 'm', supplier: 'X', deliveredDate: TODAY, source: 'fresh' }).ok, true);
  assert.match(w('media.receive', { id: 'm', deliveredDate: TODAY, source: 'fresh' }).why, /supplied/);
  assert.match(w('media.receive', { id: 'm', supplier: 'X', source: 'fresh' }).why, /delivered/);
  assert.match(w('media.receive', { id: 'm', supplier: 'X', deliveredDate: TODAY, source: 'old bags' }).why, /fresh or re-treated/);
  assert.match(w('media.fill', { batchId: 'm', zoneId: 'gh2' }).why, /how many bags/);
  assert.match(w('media.reject', { id: 'm' }).why, /why/i);
  assert.equal(core.mayWrite({ type: 'media.fill', payload: { batchId: 'm', zoneId: 'z', bags: 3 } }, { role: 'hand' }).ok, false);
  assert.equal(core.mayWrite({ type: 'media.reject', payload: { id: 'm', reason: 'bad' } }, { role: 'supervisor' }).ok, false);
});
