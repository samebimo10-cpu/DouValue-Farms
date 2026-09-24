// Plant-bag zones — FR-GATE-08, FR-GATE-09, FR-GATE-10 and FR-DOC-05 (bags).
//
// A bag zone's Gate 0 clears on the media batch its bags came from, not on its
// ground. These tests walk the same steps as docs/walkthrough-bag-zone.md, as
// records in the event log, and check what each gate says at each step —
// including the step that matters most: a batch that fails after planting
// names every zone it reached.
//
// The other half is that nothing changed for bed zones. Those tests are here
// too, because "keep bed zones exactly as they are" is only true if something
// fails when it stops being true.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules, getRules, setRules } = await import(new URL('rules.js', base).href);
await loadRules();

const { reduce } = await import(new URL('store.js', base).href);
const {
  canPlant, gatesForZone, mediaBatchStanding, condemnedBatches, gateBoard,
} = await import(new URL('domain/gates.js', base).href);
const { zonesForBatch, batchesInZone, bagsInZone, mediaOf, mediaVolumeL } = await import(new URL('domain/media.js', base).href);
const { limePlan } = await import(new URL('domain/calc.js', base).href);
const { gateEvidence } = await import(new URL('domain/doctor.js', base).href);
const { exceptions } = await import(new URL('domain/digest.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-24';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (n, hh = '09') => `${day(n)}T${hh}:00:00Z`;

let seq = 0;
const ev = (type, payload, n = 0, by = 'u_mgr', hh = '09') => ({ id: `e${++seq}`, type, at: at(n, hh), by, payload });

const people = [
  ev('person.upsert', { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' }, -400, 'u_owner'),
  ev('person.upsert', { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' }, -400, 'u_owner'),
];

const gate = (state, zoneId, id, today = TODAY) => gatesForZone(state, zoneId, { today }).find((g) => g.id === id);

// --- The walkthrough, part A: set up a bag zone and clear Gate 0 on its batch ---

const partA = [
  ...people,
  // Step 1 — a zone grown in plant bags.
  ev('plot.upsert', { id: 'gh6', name: 'GH-06', type: 'greenhouse', areaM2: 200, media: 'bag', bagLitres: 20 }, -90),
  // Step 2 — the heap is a batch: supplier, date, solarisation.
  ev('media.receive', { id: 'mb1', supplier: 'Rumuokoro yard', date: day(-60), volume: '4 m³' }, -60),
];

test('FR-GATE-08: a zone is bed soil unless it says plant bags, and old zones are beds', () => {
  assert.equal(mediaOf({ id: 'x' }), 'bed');
  assert.equal(mediaOf({ id: 'x', media: 'bed' }), 'bed');
  assert.equal(mediaOf({ id: 'x', media: 'bag' }), 'bag');
  assert.equal(mediaOf({ id: 'x', media: 'something else' }), 'bed');
});

test('walkthrough A3: a bag zone with no bags filled is blocked on all three gates', () => {
  const state = reduce(partA);
  const verdict = canPlant(state, 'gh6', { today: TODAY });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.blocking.map((g) => g.id).sort(), ['nematode', 'ph', 'topsoil']);
  for (const g of verdict.blocking) {
    assert.equal(g.state, 'unknown', 'no bags is not a pass');
    assert.match(g.why, /plant-bag zone/);
  }
});

test('walkthrough A4: a clean bed test on the ground under the bags does not clear a bag zone', () => {
  const state = reduce([
    ...partA,
    ev('media.fill', { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 200, date: day(-20) }, -20),
    // Somebody tests the house floor instead of the heap.
    ev('soiltest.record', { id: 'st_floor', zoneId: 'gh6', date: day(-10), ph: 6.4, nematode: 'clean',
      readings: [6.3, 6.4, 6.5], points: 3, lab: 'Soil lab' }, -10),
  ]);
  const verdict = canPlant(state, 'gh6', { today: TODAY });
  assert.equal(verdict.ok, false);
  assert.equal(gate(state, 'gh6', 'ph').state, 'unknown');
  assert.equal(gate(state, 'gh6', 'nematode').state, 'unknown');
  assert.match(gate(state, 'gh6', 'nematode').why, /media batch/);
});

test('walkthrough A3: bags from an untested batch are still recorded, and traced', () => {
  const state = reduce([
    ...partA,
    ev('media.fill', { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 200, date: day(-20) }, -20),
  ]);
  assert.equal(bagsInZone(state, 'gh6'), 200);
  assert.deepEqual(batchesInZone(state, 'gh6').map((b) => [b.batchId, b.bags]), [['mb1', 200]]);
  assert.deepEqual(zonesForBatch(state, 'mb1').map((z) => [z.zoneId, z.bags]), [['gh6', 200]]);
  assert.equal(mediaBatchStanding(state, 'mb1', { today: TODAY }).ok, false);
});

// Everything part A records, in order, to the point the batch clears.
const cleared = [
  ...partA,
  // Step 5 — first reading of the heap is acid, taken before lime.
  ev('soiltest.record', { id: 'st1', mediaBatchId: 'mb1', date: day(-58), ph: 5.03,
    readings: [5.0, 5.1, 5.0], points: 3, beforeCorrection: true }, -58),
  // Step 6 — limed with compost, then under plastic 26 days.
  ev('media.solarise', { batchId: 'mb1', from: day(-56), to: day(-30) }, -30),
  // Step 7 — re-tested after the plastic came off: three points and a lab assay.
  ev('soiltest.record', { id: 'st2', mediaBatchId: 'mb1', date: day(-28), ph: 6.1,
    readings: [6.0, 6.2, 6.1], points: 3, nematode: 'clean', lab: 'Soil lab' }, -28),
  ev('media.fill', { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 200, date: day(-20) }, -20),
];

test('walkthrough A5: a pre-lime reading does not open the pH gate', () => {
  const state = reduce(cleared.slice(0, partA.length + 1).concat(
    ev('media.fill', { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 200, date: day(-20) }, -20)));
  assert.equal(gate(state, 'gh6', 'ph').state, 'fail');
  assert.match(gate(state, 'gh6', 'ph').why, /before lime/);
});

test('walkthrough A7: once the heap is solarised, three-point tested and assayed clean, the bag zone may be planted', () => {
  const state = reduce(cleared);
  const verdict = canPlant(state, 'gh6', { today: TODAY });
  assert.equal(verdict.ok, true, verdict.why);
  assert.match(gate(state, 'gh6', 'ph').why, /from 3 points/);
  assert.match(gate(state, 'gh6', 'topsoil').why, /solarised 26 days/);
  assert.equal(gate(state, 'gh6', 'topsoil').name, 'Media batch traced');
});

test('FR-GATE-08: a one-point pH on a batch does not clear it', () => {
  const state = reduce([
    ...partA,
    ev('media.solarise', { batchId: 'mb1', from: day(-56), to: day(-30) }, -30),
    ev('soiltest.record', { id: 'st2', mediaBatchId: 'mb1', date: day(-28), ph: 6.1, nematode: 'clean', lab: 'Soil lab' }, -28),
    ev('media.fill', { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 200, date: day(-20) }, -20),
  ]);
  const ph = gate(state, 'gh6', 'ph');
  assert.equal(ph.state, 'fail');
  assert.match(ph.why, /not three/);
});

test('FR-GATE-08: solarisation shorter than the rules minimum, or unrecorded, blocks', () => {
  const min = getRules().soil_and_water.plant_bag_media.solarisation_min_days;
  const shortRun = reduce([
    ...cleared,
    ev('media.solarise', { batchId: 'mb1', from: day(-45), to: day(-45 + min - 1) }, -1),
  ]);
  assert.equal(gate(shortRun, 'gh6', 'topsoil').state, 'fail');
  assert.match(gate(shortRun, 'gh6', 'topsoil').why, new RegExp(`${min - 1} days`));

  const none = reduce(cleared.filter((e) => e.type !== 'media.solarise'));
  assert.equal(gate(none, 'gh6', 'topsoil').state, 'fail');
  assert.match(gate(none, 'gh6', 'topsoil').why, /No solarisation dates/);
});

test('FR-GATE-08: a batch with no supplier cannot be traced and does not clear', () => {
  const state = reduce(cleared.map((e) => (e.type === 'media.receive'
    ? { ...e, payload: { ...e.payload, supplier: '' } } : e)));
  assert.equal(gate(state, 'gh6', 'topsoil').state, 'fail');
  assert.match(gate(state, 'gh6', 'topsoil').why, /no supplier/);
});

test('FR-GATE-08: every batch in a zone must pass — one good heap does not carry an untested one', () => {
  const state = reduce([
    ...cleared,
    ev('media.receive', { id: 'mb2', supplier: 'Eleme Road', date: day(-5) }, -5),
    ev('media.fill', { id: 'f2', batchId: 'mb2', zoneId: 'gh6', bags: 40, date: day(-2) }, -2),
  ]);
  const verdict = canPlant(state, 'gh6', { today: TODAY });
  assert.equal(verdict.ok, false);
  assert.match(gate(state, 'gh6', 'nematode').why, /Eleme Road/);
});

test('FR-DOC-06: the Farm Doctor reads the batch for a bag zone\'s Gate 0 evidence', () => {
  const state = reduce(cleared);
  const review = gateEvidence(state, { zoneId: 'gh6', today: TODAY, gates: ['G0'] });
  const items = Object.fromEntries(review.gates[0].items.map((i) => [i.id, i]));
  assert.equal(items.lab_report.state, 'have');
  assert.match(items.lab_report.why, /Soil lab returned clear/);
  // Three points are on file; the meter photo is not yet.
  assert.equal(items.ph_three_point.state, 'missing');
  assert.match(items.ph_three_point.why, /photo of the meter/);
  assert.equal(review.clears, false, 'checking is never clearing (FR-DOC-08)');

  const withPhoto = reduce([
    ...cleared,
    ev('gate.evidence', { id: 'gv1', gate: 'G0', itemId: 'ph_three_point', zoneId: 'gh6', date: day(-27),
      photo: 'data:image/jpeg;base64,AAAA', note: 'Meter at 6.1' }, -27),
  ]);
  const again = gateEvidence(withPhoto, { zoneId: 'gh6', today: TODAY, gates: ['G0'] });
  assert.equal(again.gates[0].items.find((i) => i.id === 'ph_three_point').state, 'have');
});

// --- The walkthrough, part B: a batch that fails after planting -----------

const planted = [
  ...cleared,
  ev('plot.upsert', { id: 'gh7', name: 'GH-07', type: 'greenhouse', areaM2: 120, media: 'bag', bagLitres: 20 }, -90),
  ev('media.fill', { id: 'f3', batchId: 'mb1', zoneId: 'gh7', bags: 80, date: day(-18) }, -18),
  // A bed zone on the same farm, clear, which the failure must not touch.
  ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }, -90),
  ev('soiltest.record', { id: 'st_gh1', zoneId: 'gh1', date: day(-12), ph: 6.3, nematode: 'clean' }, -12),
  ev('cycle.start', { id: 'c6', plotId: 'gh6', cropId: 'bell', variety: 'California Wonder',
    transplantDate: day(-14), plants: 200, areaM2: 200 }, -14),
];
const failed = [
  ...planted,
  // Step B2 — the lab's re-assay of the heap comes back dirty, after planting.
  ev('soiltest.record', { id: 'st_bad', mediaBatchId: 'mb1', date: day(-1), nematode: 'root-knot detected',
    lab: 'Soil lab' }, -1),
];

test('walkthrough B1: before the result, both bag zones are clear and GH-06 is planted', () => {
  const state = reduce(planted);
  assert.equal(canPlant(state, 'gh6', { today: TODAY }).ok, true);
  assert.equal(canPlant(state, 'gh7', { today: TODAY }).ok, true);
  assert.equal(condemnedBatches(state, { today: TODAY }).length, 0);
});

test('FR-GATE-10 / walkthrough B3: a batch that fails after planting closes Gate 0 on every zone it reached', () => {
  const state = reduce(failed);

  for (const zoneId of ['gh6', 'gh7']) {
    const nem = gate(state, zoneId, 'nematode');
    assert.equal(nem.state, 'fail', `${zoneId} holds bags from the failed batch`);
    assert.equal(nem.condemned, true);
    assert.match(nem.why, /root-knot detected/);
    // The message names every affected zone, not just this one.
    assert.match(nem.why, /GH-06 \(200 bags, planted\)/);
    assert.match(nem.why, /GH-07 \(80 bags\)/);
  }

  // The planted zone is now planted behind a closed gate, which the board says.
  const row = gateBoard(state, { today: TODAY }).find((r) => r.zone.id === 'gh6');
  assert.equal(row.planted, true);
  assert.equal(row.ok, false);

  // The bed zone is untouched.
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, true);
});

test('FR-GATE-10: the failed batch lists its zones, and the digest names them all in one line', () => {
  const state = reduce(failed);
  const [bad] = condemnedBatches(state, { today: TODAY });
  assert.equal(bad.batchId, 'mb1');
  assert.deepEqual(bad.live.map((z) => [z.name, z.bags, z.planted]), [['GH-06', 200, true], ['GH-07', 80, false]]);

  const lines = exceptions(state, { now: `${TODAY}T18:00:00Z` });
  const line = lines.find((l) => /Media batch from Rumuokoro yard/.test(l.line));
  assert.ok(line, 'the digest carries the failed batch');
  assert.equal(line.severity, 'critical');
  assert.match(line.detail, /GH-06 \(200 bags, planted\), GH-07 \(80 bags\)/);
});

test('FR-GATE-10: a later clean re-test does not un-condemn a failed batch', () => {
  const state = reduce([
    ...failed,
    ev('soiltest.record', { id: 'st_again', mediaBatchId: 'mb1', date: TODAY, nematode: 'clean', lab: 'Other lab' }, 0),
  ]);
  assert.equal(gate(state, 'gh7', 'nematode').state, 'fail');
  assert.equal(condemnedBatches(state, { today: TODAY }).length, 1);
});

test('walkthrough B5: pulled bags leave the zone but stay on the batch\'s record', () => {
  const state = reduce([
    ...failed,
    ev('media.pull', { id: 'f3', date: TODAY, reason: 'batch failed nematode assay' }, 0),
  ]);
  assert.equal(bagsInZone(state, 'gh7'), 0);
  const gh7 = zonesForBatch(state, 'mb1').find((z) => z.zoneId === 'gh7');
  assert.deepEqual([gh7.bags, gh7.pulled, gh7.cleared], [0, 80, true]);

  // GH-07 has no bags now: blocked as unknown until it is refilled.
  assert.equal(gate(state, 'gh7', 'nematode').state, 'unknown');
  // The digest line now names only the zone still holding bags.
  const line = exceptions(state, { now: `${TODAY}T18:00:00Z` }).find((l) => /Media batch/.test(l.line));
  assert.doesNotMatch(line.detail, /GH-07/);
  assert.match(line.detail, /GH-06/);
});

test('walkthrough B6: GH-07 refilled from a cleared batch opens again', () => {
  const state = reduce([
    ...failed,
    ev('media.pull', { id: 'f3', date: day(0), reason: 'batch failed nematode assay' }, 0, 'u_mgr', '08'),
    ev('media.receive', { id: 'mb2', supplier: 'Eleme Road', date: day(-40), solarisedFrom: day(-38),
      solarisedTo: day(-15) }, -40),
    ev('soiltest.record', { id: 'st_mb2', mediaBatchId: 'mb2', date: day(-10), ph: 6.4,
      readings: [6.3, 6.4, 6.5], points: 3, nematode: 'clean', lab: 'Soil lab' }, -10),
    ev('media.fill', { id: 'f4', batchId: 'mb2', zoneId: 'gh7', bags: 80, date: TODAY }, 0, 'u_mgr', '10'),
  ]);
  assert.equal(canPlant(state, 'gh7', { today: TODAY }).ok, true, canPlant(state, 'gh7', { today: TODAY }).why);
});

test('FR-GATE-07: only an Owner override on the record opens a zone on a failed batch', () => {
  const state = reduce([
    ...failed,
    ev('gate.override', { id: 'ov1', gate: 'nematode', zoneId: 'gh6',
      reason: 'Crop is two weeks from last pick; bags go straight after.' }, 0, 'u_owner'),
  ]);
  const nem = gate(state, 'gh6', 'nematode');
  assert.equal(nem.state, 'overridden');
  assert.match(nem.blockedWhy, /root-knot/);
  assert.equal(gate(state, 'gh7', 'nematode').state, 'fail', 'an override is per zone');
});

test('FR-GATE-08: bags added after transplant are judged on the day they went in', () => {
  // Clean assay on day -28; crop in on day -14; more bags from the same heap on
  // day -3. Still clean and still fresh, so the zone stays clear.
  const state = reduce([...planted,
    ev('media.fill', { id: 'f9', batchId: 'mb1', zoneId: 'gh6', bags: 10, date: day(-3) }, -3)]);
  assert.equal(canPlant(state, 'gh6', { today: TODAY }).ok, true);
});

// --- Bed zones: exactly as they were ---------------------------------------

test('bed zones: the three gates read the zone and its topsoil, as before', () => {
  const state = reduce([
    ...people,
    ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }, -90),
    ev('plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse', areaM2: 300, media: 'bed' }, -90),
    // A media batch on the farm is irrelevant to a bed.
    ev('media.receive', { id: 'mb1', supplier: 'Rumuokoro yard', date: day(-60) }, -60),
    ev('soiltest.record', { id: 's1', zoneId: 'gh1', date: day(-5), ph: 6.3, nematode: 'clean' }, -5),
    ev('soiltest.record', { id: 's2', zoneId: 'gh2', date: day(-5), ph: 6.3, nematode: 'clean' }, -5),
  ]);
  for (const id of ['gh1', 'gh2']) {
    const verdict = canPlant(state, id, { today: TODAY });
    assert.equal(verdict.ok, true, `${id}: ${verdict.why}`);
    const names = verdict.gates.map((g) => g.name);
    assert.deepEqual(names, ['Soil pH tested', 'Nematode clear', 'Topsoil tested']);
    assert.ok(verdict.gates.every((g) => !g.media), 'no bed gate goes through the media path');
    // A bed pH gate does not demand three points; that is the Doctor's G0 check.
    assert.match(verdict.gates[0].why, /pH 6.3/);
  }
});

test('bed zones: the lime calculator gives the same answer with or without the media option', () => {
  const args = { readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', areaM2: 300, today: TODAY };
  const before = limePlan(args);
  const after = limePlan({ ...args, media: 'bed', volumeL: 5000, bags: 100, litresPerBag: 20 });
  assert.equal(after.kgText, before.kgText);
  assert.equal(after.kgLow, 49.5);
  assert.equal(after.kgHigh, 70.5);
  assert.equal(after.perBagText, undefined);
});

// --- FR-DOC-05, bags: lime by media volume ---------------------------------

test('FR-DOC-05 (bags): the dose comes from the media volume, through the rules\' incorporation depth', () => {
  const spec = getRules().soil_and_water.plant_bag_media;
  assert.equal(spec.lime_incorporation_depth_m, 0.2);

  // Sandy loam, Route A: 16.5-23.5 kg per 100 m², worked 20 cm deep = 20 m³.
  const heap = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', media: 'bag', volumeL: 4000, today: TODAY });
  assert.equal(heap.ok, true);
  assert.equal(heap.route, 'A');
  assert.equal(heap.kgLow, 3.3);
  assert.equal(heap.kgHigh, 4.7);
  assert.equal(heap.kgPerM3Low, 0.825);
  assert.equal(heap.kgPerM3High, 1.175);
  assert.match(heap.steps[0], /through the 4 m³ of media/);

  // The same volume given as bags, with a per-bag figure to weigh out.
  const bags = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', media: 'bag',
    bags: 200, litresPerBag: 20, today: TODAY });
  assert.equal(bags.kgText, heap.kgText);
  assert.equal(bags.perBagText, '17–24 g');
});

test('FR-DOC-05 (bags): the hold and the half dose still apply, by volume', () => {
  const held = limePlan({ readings: [5.3, 5.4, 5.3], texture: 'sandy_loam', media: 'bag', volumeL: 4000, today: TODAY });
  assert.equal(held.action, 'hold');
  assert.equal(held.kgText, undefined, 'a held heap gets a date, not a dose');

  const again = limePlan({ readings: [5.0, 5.0, 5.1], texture: 'sandy_loam', media: 'bag', volumeL: 4000,
    lastLime: { ratePer100Low: 16.5, ratePer100High: 23.5 }, today: TODAY });
  assert.equal(again.action, 'half-rate');
  assert.equal(again.kgLow, 1.7);
  assert.equal(again.kgHigh, 2.4);
});

test('FR-DOC-05 (bags): no volume, no dose', () => {
  const out = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', media: 'bag', today: TODAY });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-volume');
});

test('FR-GATE-08: without the plant-bag rules, a bag zone is not cleared and bags are not dosed', () => {
  const rules = getRules();
  const stripped = JSON.parse(JSON.stringify(rules));
  delete stripped.soil_and_water.plant_bag_media;
  setRules(stripped);
  try {
    const state = reduce(cleared);
    assert.equal(gate(state, 'gh6', 'topsoil').state, 'unknown');
    assert.equal(canPlant(state, 'gh6', { today: TODAY }).ok, false);
    const out = limePlan({ readings: [5.0, 5.1, 5.0], texture: 'sandy_loam', media: 'bag', volumeL: 4000, today: TODAY });
    assert.equal(out.reason, 'no-media-rules');
  } finally {
    setRules(JSON.parse(JSON.stringify(rules)));
  }
});

test('mediaVolumeL counts standing bags times litres per bag', () => {
  const state = reduce(cleared);
  assert.deepEqual(mediaVolumeL(state, 'gh6'), { bags: 200, litresPerBag: 20, litres: 4000 });
});

// --- The record: event log and server -----------------------------------------

test('a fill that arrives before its batch is parked, not lost', () => {
  const fill = ev('media.fill', { id: 'fx', batchId: 'mbx', zoneId: 'gh6', bags: 5, date: day(-2) }, -2);
  const batch = ev('media.receive', { id: 'mbx', supplier: 'Late phone', date: day(-3) }, -1);
  const state = reduce([...partA, fill, batch]);
  assert.equal(bagsInZone(state, 'gh6'), 5);
  assert.equal(state.orphans.length, 0);
});

test('server: media records need the right role and a complete link', () => {
  const sup = { id: 'u_sup', role: 'supervisor' };
  const hand = { id: 'u_hand', role: 'hand' };
  const fill = { type: 'media.fill', payload: { id: 'f1', batchId: 'mb1', zoneId: 'gh6', bags: 20 } };

  assert.equal(core.mayWrite(fill, sup).ok, true);
  assert.equal(core.mayWrite(fill, hand).ok, false, 'a farm hand does not decide what a zone depends on');
  assert.equal(core.mayWrite({ ...fill, payload: { ...fill.payload, zoneId: '' } }, sup).ok, false);
  assert.equal(core.mayWrite({ ...fill, payload: { ...fill.payload, bags: 0 } }, sup).ok, false);
  assert.equal(core.mayWrite({ ...fill, payload: { ...fill.payload, bags: 2.5 } }, sup).ok, false);

  assert.equal(core.mayWrite({ type: 'media.receive', payload: { id: 'mb1', supplier: '' } }, sup).ok, false);
  assert.equal(core.mayWrite({ type: 'media.receive', payload: { id: 'mb1', supplier: 'Yard' } }, sup).ok, true);
  assert.equal(core.mayWrite({ type: 'media.solarise',
    payload: { batchId: 'mb1', from: day(-10), to: day(-20) } }, sup).ok, false);
  assert.equal(core.mayWrite({ type: 'media.pull', payload: { id: 'f1' } }, hand).ok, false);
  assert.equal(core.mayWrite({ type: 'media.pull', payload: { id: 'f1' } }, sup).ok, true);
});
