// GH-04 from teardown to transplant — FR-GATE-00, FR-GATE-01, FR-GATE-06,
// FR-FARM-05 and the Rev 5 p16-17 clean-restart protocol, end to end. Then the
// same house again, on plant bags (C-19): the bed crop closes galled, GH-04
// moves to bags, Gate 0 clears on the media batch, and a batch fails after
// planting and names every zone it filled.
//
// Every record goes in as an event, dated, by the person who would make it, and
// the farm is rebuilt with reduce() exactly as a phone rebuilds it. After each
// record the gate is asked, as of that day, whether GH-04 may be transplanted,
// and the test names the exact set of conditions still standing — not merely
// "blocked", which an empty farm also is.
//
// Where a step has an edge (a solarisation one day short, a knockdown one day
// early), a what-if branch tries it without changing the main line, so the
// walk still ends in a transplant that went in the right way.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
const rules = await loadRules();
const { reduce } = await import(new URL('store.js', base).href);
const { canPlant, gateModel } = await import(new URL('domain/gates.js', base).href);
const { confirmOutput, draftCycleReview, gateEvidence } = await import(new URL('domain/doctor.js', base).href);
const { newFarmEvents } = await import(new URL('domain/farm.js', base).href);
const { batchTrace, galledCycle } = await import(new URL('domain/media.js', base).href);
const { fillCheck } = await import(new URL('domain/gates.js', base).href);
const { exceptions } = await import(new URL('domain/digest.js', base).href);

const Z = 'zone_gh-04';
const NUR = 'zone_of-02';
const G1_ALL = ['inputs_on_site', 'drip_pressure', 'spacing_pegged', 'traps_installed', 'sops_live',
  'scout_roster', 'route_b_wait', 'seedling_release'];
const CR_ALL = ['cr_terminate_remove', 'cr_sanitise', 'cr_solarise', 'cr_host_free_fallow', 'cr_pre_plant_knockdown'];

// --- The log ------------------------------------------------------------------

const events = [];
let seq = 0;
/** One record, stamped on its own day; later records on a day sort later. */
function put(date, type, payload, by = 'u_mgr') {
  const n = seq++;
  const at = `${date}T${String(8 + Math.floor(n / 60) % 10).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`;
  events.push({ id: `e${n}`, type, payload, by, at });
}
const farm = (extra = []) => reduce([...events, ...extra]);

function ask(date, { extra = [], batchId = null } = {}) {
  return canPlant(farm(extra), Z, { today: date, ...(batchId ? { batchId } : {}) });
}
const ids = (v) => v.blocking.map((c) => c.id).sort();
const find = (v, id) => v.blocking.find((c) => c.id === id);

function expectBlocked(v, expected) {
  assert.equal(v.ok, false, 'should be blocked');
  assert.deepEqual(ids(v), [...expected].sort());
}

/** A record that could be made, tried without making it. */
function whatIf(date, type, payload, by = 'u_sup') {
  return { id: `wf_${type}_${date}`, type, payload, by, at: `${date}T19:00:00.000Z` };
}

const evidence = (date, gate, itemId, extra = {}, by = 'u_sup') => put(date, 'gate.evidence', {
  id: `ev_${gate}_${itemId}_${date}`, gate, itemId, zoneId: Z, date, note: `${itemId} done`, ...extra,
}, by);
const soil = (date, readings, extra = {}) => put(date, 'soiltest.record', {
  id: `st_${date}_${extra.calibrated === false ? 'x' : 'c'}`, zoneId: Z, date,
  ph: Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 100) / 100, readings,
  calibrated: true, photo: { dataUrl: 'data:image/jpeg;base64,x' }, nematode: null, lab: null, ...extra,
}, 'u_sup');
const saveDoctorCheck = (date, id) => {
  const review = gateEvidence(farm(), { zoneId: Z, today: date, rules });
  put(date, 'doctor.record', { ...review, id, at: `${date}T15:00:00.000Z` });
};

// --- The farm, and GH-04's last crop ---------------------------------------------

newFarmEvents({ farmName: 'DouValue Farms Limited', owner: { id: 'u_owner', name: 'Owner' }, rules })
  .forEach((e) => put('2026-01-01', e.type, e.payload, 'u_owner'));
put('2026-01-01', 'person.upsert', { id: 'u_mgr', name: 'Farm Manager', role: 'manager' }, 'u_owner');
put('2026-01-01', 'person.upsert', { id: 'u_sup', name: 'Field Supervisor', role: 'supervisor' }, 'u_owner');
put('2026-01-01', 'person.upsert', { id: 'u_hand', name: 'Greenhouse Hand', role: 'hand' }, 'u_owner');
put('2026-01-01', 'plot.upsert', { id: Z, areaM2: 300 });
put('2026-02-10', 'cycle.start', { id: 'c0', plotId: Z, cropId: 'bell', transplantDate: '2026-02-10', plants: 900 });
// A clean soil test from while the old crop was still in.
put('2026-07-20', 'soiltest.record', {
  id: 'st_old', zoneId: Z, date: '2026-07-20', ph: 6.2, readings: [6.1, 6.2, 6.3], calibrated: true,
  photo: { dataUrl: 'x' }, nematode: 'clean', lab: 'Rivers Soil Lab',
}, 'u_sup');
put('2026-08-01', 'cycle.close', { id: 'c0', date: '2026-08-01', note: 'Old crop out' });

test('GH-04 from teardown to transplant, every step gated', async (t) => {
  await t.test('01 · 08-01 old crop closed: nothing may go straight back in', () => {
    assert.equal(farm().plots[Z].protocol, 'clean-restart', 'seeded from the rules register');
    const v = ask('2026-08-01');
    expectBlocked(v, ['nematode', 'ph', 'doctor_check', ...CR_ALL, ...G1_ALL,
      'root_inspection', 'control_audit', 'sops_updated', 'g4_signoff']);
    // The old crop's clean test does not clear the new crop's ground (FR-GATE-01).
    assert.match(find(v, 'ph').why, /before the previous cycle here ended on 2026-08-01/);
    assert.match(find(v, 'nematode').why, /before the previous cycle here ended/);
  });

  await t.test('02 · 08-02/03 Gate 4 evidence and the Farm Doctor cycle review: waiting on the Farm Manager', () => {
    evidence('2026-08-02', 'G4', 'root_inspection', { cycleId: 'c0', note: 'Ten plants lifted: galls on 3' }, 'u_mgr');
    evidence('2026-08-02', 'G4', 'control_audit', { cycleId: 'c0', note: 'Thrips spray late twice' }, 'u_mgr');
    evidence('2026-08-02', 'G4', 'sops_updated', { cycleId: 'c0', note: 'Trap counts daily; Spinosad pre-stocked' }, 'u_mgr');
    const draft = draftCycleReview(farm(), 'c0', { today: '2026-08-03', rules });
    put('2026-08-03', 'doctor.record', { ...draft, id: 'rev_c0', at: '2026-08-03T10:00:00.000Z' });
    const v = ask('2026-08-03');
    assert.ok(!ids(v).some((id) => ['root_inspection', 'control_audit', 'sops_updated'].includes(id)));
    assert.match(find(v, 'g4_signoff').why, /waiting for the Farm Manager to confirm/);
  });

  await t.test('03 · a Greenhouse Hand cannot confirm the cycle review, on the screen or through sync', () => {
    const s = farm();
    const refused = confirmOutput(s.doctorOutputs.find((o) => o.id === 'rev_c0'), s.people.u_hand);
    assert.equal(refused.ok, false);
    assert.match(refused.why, /confirmed by the Farm Manager/);
    put('2026-08-03', 'doctor.confirm', { id: 'rev_c0' }, 'u_hand');
    assert.equal(farm().doctorOutputs.find((o) => o.id === 'rev_c0').confirmedBy, null);
  });

  await t.test('04 · the Farm Manager confirms and cannot also approve (FR-GATE-00)', () => {
    put('2026-08-03', 'doctor.confirm', { id: 'rev_c0' }, 'u_mgr');
    put('2026-08-03', 'doctor.approve', { id: 'rev_c0' }, 'u_mgr');
    assert.match(find(ask('2026-08-03'), 'g4_signoff').why, /Owner has not approved/);
  });

  await t.test('05 · 08-04 the Owner approves: Gate 4 of the old crop is closed', () => {
    put('2026-08-04', 'doctor.approve', { id: 'rev_c0' }, 'u_owner');
    const v = ask('2026-08-04');
    assert.ok(!ids(v).some((id) => ['root_inspection', 'control_audit', 'sops_updated', 'g4_signoff'].includes(id)));
    assert.equal(gateModel(farm(), Z, { today: '2026-08-04' }).gates.find((g) => g.id === 'G4').state, 'pass');
  });

  await t.test('06 · restart steps 1 and 2: terminate (08-02) and sanitise (08-03)', () => {
    evidence('2026-08-02', 'CR', 'terminate_remove', { note: 'All plants bagged and burned off-site; volunteers pulled 5 m out' });
    evidence('2026-08-03', 'CR', 'sanitise', { note: 'Nets bleached, drip flushed, old traps off-site' });
    expectBlocked(ask('2026-08-04'), ['nematode', 'ph', 'doctor_check',
      'cr_solarise', 'cr_host_free_fallow', 'cr_pre_plant_knockdown', ...G1_ALL]);
  });

  await t.test('07 · 08-18 plastic on since 08-04 and fallow recorded: both held, not yet long enough', () => {
    evidence('2026-08-04', 'CR', 'solarise', { coverFrom: '2026-08-04', note: 'Clear polythene sealed over the beds' });
    evidence('2026-08-04', 'CR', 'host_free_fallow', { note: 'Doors shut, no hosts inside' });
    const v = ask('2026-08-18');
    const cover = find(v, 'cr_solarise');
    assert.equal(cover.state, 'held');
    assert.match(cover.why, /Under plastic since 2026-08-04: 14 days so far/);
    assert.match(cover.fix, /on or after 2026-08-25 and no later than 2026-09-01/);
    const fallow = find(v, 'cr_host_free_fallow');
    assert.equal(fallow.state, 'held');
    assert.match(fallow.why, /host-free for 16 days/);
  });

  await t.test('08 · what if the plastic came off on 08-22 (18 days), or stayed to 09-02 (29 days)?', () => {
    for (const [lift, days] of [['2026-08-22', 18], ['2026-09-02', 29]]) {
      const v = ask('2026-09-03', { extra: [whatIf(lift, 'gate.evidence', {
        id: `wf_lift_${lift}`, gate: 'CR', itemId: 'solarise', zoneId: Z, date: lift,
        coverFrom: '2026-08-04', coverTo: lift, note: 'Plastic lifted',
      })] });
      const c = find(v, 'cr_solarise');
      assert.ok(c, `a ${days}-day span must block`);
      assert.equal(c.state, 'fail');
      assert.match(c.why, new RegExp(`${days} days continuous`));
    }
  });

  await t.test('09 · 08-28 plastic lifted after 24 days; lab CLEAR; pH 5.3 / 5.3 / 5.4 holds the block', () => {
    evidence('2026-08-28', 'CR', 'solarise', {
      coverFrom: '2026-08-04', coverTo: '2026-08-28', note: 'Lifted after 24 days; Trichoderma drench',
    });
    soil('2026-08-28', [5.3, 5.3, 5.4], { nematode: 'clean', lab: 'Rivers Soil Lab' });
    const v = ask('2026-08-29');
    expectBlocked(v, ['ph', 'doctor_check', 'cr_pre_plant_knockdown', ...G1_ALL]);
    const ph = find(v, 'ph');
    assert.equal(ph.state, 'held');
    assert.equal(ph.hold, '5_2_to_5_49');
    assert.match(ph.fix, /one-quarter of the original rate/);
    assert.match(ph.fix, /Re-test on or after 2026-09-07/);
  });

  await t.test('10 · 08-29 a Farm Doctor check saved now, signed off anyway, still does not clear Gate 0', () => {
    saveDoctorCheck('2026-08-29', 'g0_early');
    put('2026-08-29', 'doctor.confirm', { id: 'g0_early' }, 'u_mgr');
    put('2026-08-29', 'doctor.approve', { id: 'g0_early' }, 'u_owner');
    assert.match(find(ask('2026-08-29'), 'doctor_check').why, /found Gate 0 incomplete/);
  });

  await t.test('11 · 09-02 a passing re-test inside the 10-day hold does not lift it', () => {
    soil('2026-09-02', [5.7, 5.8, 5.9]);
    const ph = find(ask('2026-09-02'), 'ph');
    assert.equal(ph.state, 'held');
    assert.equal(ph.hold, 'retest_too_soon');
    assert.match(ph.why, /only 5 days after the reading of 5.3/);
  });

  await t.test('12 · 09-08 a re-test with the calibration not recorded does not count', () => {
    soil('2026-09-08', [5.8, 5.9, 5.9], { calibrated: false });
    assert.match(find(ask('2026-09-08'), 'ph').why, /calibrated/);
  });

  await t.test('13 · 09-08 the same re-test from a calibrated meter clears the pH', () => {
    soil('2026-09-08', [5.8, 5.9, 5.9]);
    const v = ask('2026-09-08');
    assert.ok(!ids(v).includes('ph'), ids(v).join(', '));
    // The early sign-off is still the one on file, and it still says incomplete.
    expectBlocked(v, ['doctor_check', 'cr_pre_plant_knockdown', ...G1_ALL]);
  });

  await t.test('14 · 09-09/10 a fresh Farm Doctor check: waits for the Manager, then the Owner, then clears', () => {
    saveDoctorCheck('2026-09-09', 'g0_ok');
    assert.match(find(ask('2026-09-09'), 'doctor_check').why, /waiting for the Farm Manager to confirm/);
    put('2026-09-09', 'doctor.confirm', { id: 'g0_ok' }, 'u_mgr');
    assert.match(find(ask('2026-09-09'), 'doctor_check').why, /Owner has not approved/);
    put('2026-09-10', 'doctor.approve', { id: 'g0_ok' }, 'u_owner');
    expectBlocked(ask('2026-09-10'), ['cr_pre_plant_knockdown', ...G1_ALL]);
    assert.equal(gateModel(farm(), Z, { today: '2026-09-10' }).gates.find((g) => g.id === 'G0').state, 'pass');
  });

  await t.test('15 · 09-11 the Establishment Checklist, too few traps, and the knockdown sprayed five days ahead of transplant', () => {
    put('2026-09-10', 'input.upsert', { id: 'i_spin', name: 'Spinosad 45SC', kind: 'chemical', unit: 'litre', qty: 2 });
    put('2026-09-10', 'position.upsert', {
      id: 'pos_gh4', title: 'Greenhouse Hand — GH-04', role: 'hand', primaryZoneId: Z, backupZoneId: 'zone_gh-05',
    });
    evidence('2026-09-11', 'G1', 'drip_pressure', { note: '1.2 bar at the far end' });
    evidence('2026-09-11', 'G1', 'spacing_pegged', { note: '30 cm pegged and photographed' });
    evidence('2026-09-11', 'G1', 'traps_installed', { count: 30, note: 'Fresh traps at plant height' });
    evidence('2026-09-11', 'G1', 'sops_live', { note: 'Role cards up, team briefed' });
    evidence('2026-09-11', 'G1', 'route_b_wait', { route: 'A', note: 'Route A lime in the solarisation window' });
    evidence('2026-09-11', 'CR', 'pre_plant_knockdown', { note: 'Cypermethrin 1 ml/L all surfaces; Mancozeb on beds' });

    const v = ask('2026-09-11');
    expectBlocked(v, ['traps_installed', 'seedling_release', 'cr_pre_plant_knockdown']);
    assert.match(find(v, 'traps_installed').why, /30 traps recorded for 300 m². The rules ask for one per 6 m², so 50/);
    // Sprayed today: no night with the doors shut before a transplant today.
    assert.match(find(v, 'cr_pre_plant_knockdown').why, /same day as transplant/);
  });

  await t.test('16 · traps topped up to 50', () => {
    evidence('2026-09-11', 'G1', 'traps_installed', { count: 50, note: 'Topped up' });
    expectBlocked(ask('2026-09-11'), ['seedling_release', 'cr_pre_plant_knockdown']);
  });

  await t.test('17 · the nursery: a release with thrips found and 4 days of hardening is refused', () => {
    put('2026-08-10', 'seedling.sow', {
      id: 'b1', label: 'N-0810-A', nurseryZoneId: NUR, cropId: 'bell', variety: 'Nikita', sownDate: '2026-08-10', media: 'sterilised',
    }, 'u_sup');
    put('2026-09-05', 'seedling.check', { id: 'k1', batchId: 'b1', date: '2026-09-05', thrips: true, virus: false, dampingOff: false, note: 'Thrips on tap test' }, 'u_sup');
    put('2026-09-07', 'seedling.harden', { batchId: 'b1', date: '2026-09-07' }, 'u_sup');
    put('2026-09-11', 'seedling.release', {
      id: 'b1', zoneId: Z, date: '2026-09-11', answers: { noVirus: true, noThrips: true, noDampingOff: true },
    }, 'u_sup');
    const b = farm().seedlingBatches.b1;
    assert.equal(b.status, 'growing');
    assert.match(b.releaseRefused.why, /hardened 7\+ days; no thrips on a tap test/);
  });

  await t.test('18 · a Greenhouse Hand cannot release; the Field Supervisor can, after a clean check', () => {
    put('2026-09-12', 'seedling.check', { id: 'k2', batchId: 'b1', date: '2026-09-12', thrips: false, virus: false, dampingOff: false, note: 'Clean after spray' }, 'u_sup');
    put('2026-09-14', 'seedling.release', {
      id: 'b1', zoneId: Z, date: '2026-09-14', answers: { noVirus: true, noThrips: true, noDampingOff: true },
    }, 'u_hand');
    assert.match(farm().seedlingBatches.b1.releaseRefused.why, /Field Supervisor or above/);
    put('2026-09-14', 'seedling.release', {
      id: 'b1', zoneId: Z, date: '2026-09-14', answers: { noVirus: true, noThrips: true, noDampingOff: true },
    }, 'u_sup');
    const b = farm().seedlingBatches.b1;
    assert.equal(b.status, 'released');
    assert.equal(b.release.zoneId, Z);
  });

  await t.test('19 · 09-14 the batch is released; the knockdown from 09-11 is now 3 days old', () => {
    const v = ask('2026-09-14');
    expectBlocked(v, ['cr_pre_plant_knockdown']);
    assert.match(find(v, 'cr_pre_plant_knockdown').why, /3 days before transplant/);
    assert.match(find(v, 'cr_pre_plant_knockdown').fix, /within 48 h/);
  });

  await t.test('20 · transplant day 09-16: the 09-11 knockdown does not count, nor would one sprayed today', () => {
    expectBlocked(ask('2026-09-16', { batchId: 'b1' }), ['cr_pre_plant_knockdown']);
    const today = ask('2026-09-16', { batchId: 'b1', extra: [whatIf('2026-09-16', 'gate.evidence', {
      id: 'wf_knock', gate: 'CR', itemId: 'pre_plant_knockdown', zoneId: Z, date: '2026-09-16', note: 'Sprayed this morning',
    })] });
    expectBlocked(today, ['cr_pre_plant_knockdown']);
    assert.match(find(today, 'cr_pre_plant_knockdown').fix, /overnight/);
    // Two days before is the far edge of 48 h, and counts.
    const edge = ask('2026-09-16', { batchId: 'b1', extra: [whatIf('2026-09-14', 'gate.evidence', {
      id: 'wf_knock2', gate: 'CR', itemId: 'pre_plant_knockdown', zoneId: Z, date: '2026-09-14', note: 'Sprayed',
    })] });
    assert.equal(edge.ok, true, ids(edge).join(', '));
  });

  await t.test('21 · knockdown sprayed 09-15, doors shut overnight: 09-16 transplant is allowed', () => {
    evidence('2026-09-15', 'CR', 'pre_plant_knockdown', { note: 'Cypermethrin 1 ml/L all surfaces, doors shut; Mancozeb on beds' });
    const v = ask('2026-09-16', { batchId: 'b1' });
    assert.equal(v.ok, true, ids(v).join(', '));
    assert.equal(v.overridden.length, 0, 'cleared on the record, not by an override');
  });

  await t.test('22 · planted: the batch is linked, and the gates judge as of transplant day from now on', () => {
    put('2026-09-16', 'cycle.start', {
      id: 'c1', plotId: Z, cropId: 'bell', variety: 'Nikita', transplantDate: '2026-09-16', plants: 900, seedlingBatchId: 'b1',
    });
    const s = farm();
    assert.equal(s.seedlingBatches.b1.usedByCycleId, 'c1');
    const states = Object.fromEntries(gateModel(s, Z, { today: '2026-09-16' }).gates.map((g) => [g.id, g.state]));
    assert.deepEqual(states, { G0: 'pass', CR: 'pass', G1: 'pass', G2: 'waiting', G3: 'pass', G4: 'pass' });
    // Months later the soil test is old and the knockdown long past, but the
    // question is whether they were right on transplant day, and they were.
    assert.equal(canPlant(s, Z, { today: '2026-12-30' }).ok, true);
  });
});

// --- The same house on plant bags (C-19) ---------------------------------------
//
// The bed crop planted above comes out galled. GH-04 goes to plant bags for the
// next cycle, so Gate 0 clears on the media batch, not the bed; the restart's
// step 3 is fresh or re-treated media; the galled crop's bags are discarded.
// Two batches are refused on the way, one because no lime rate can be derived
// for it. The batch that does go in fails after planting, and has to name
// every zone it filled.

const Z5 = 'zone_gh-05';
const BAG_G0 = ['media_batch', 'ph', 'nematode', 'heap_solarisation', 'bag_barrier', 'doctor_check'];
const G1_REDO = ['drip_pressure', 'spacing_pegged', 'traps_installed', 'sops_live', 'route_b_wait', 'seedling_release'];
const batchSoil = (date, batchId, readings, extra = {}) => put(date, 'soiltest.record', {
  id: `st_${batchId}_${date}`, zoneId: null, mediaBatchId: batchId, date,
  ph: readings ? Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 100) / 100 : null,
  readings: readings || undefined, calibrated: !!readings, photo: readings ? { dataUrl: 'data:image/jpeg;base64,x' } : undefined,
  nematode: null, lab: null, ...extra,
}, 'u_sup');
const fill = (date, id, batchId, zoneId, bags, extra = {}) => put(date, 'media.fill', {
  id, batchId, zoneId, date, bags, litresPerBag: 20, newBags: true, ...extra,
});
const fillOf = (id) => farm().mediaFills.find((f) => f.id === id);

test('GH-04 on plant bags: Gate 0 on the media batch, and a batch that fails after planting', async (t) => {
  await t.test('23 · 12-20 the bed crop closes; the root inspection finds galls; Gate 4 closed', () => {
    put('2026-12-20', 'cycle.close', { id: 'c1', date: '2026-12-20', note: 'Bed crop out' });
    evidence('2026-12-21', 'G4', 'root_inspection', { cycleId: 'c1', galls: true, note: 'Galls on 6 of 10 plants lifted' }, 'u_mgr');
    evidence('2026-12-21', 'G4', 'control_audit', { cycleId: 'c1', note: 'Thrips on time all cycle' }, 'u_mgr');
    evidence('2026-12-21', 'G4', 'sops_updated', { cycleId: 'c1', note: 'GH-04 moves to plant bags' }, 'u_mgr');
    const draft = draftCycleReview(farm(), 'c1', { today: '2026-12-21', rules });
    put('2026-12-21', 'doctor.record', { ...draft, id: 'rev_c1', at: '2026-12-21T10:00:00.000Z' });
    put('2026-12-21', 'doctor.confirm', { id: 'rev_c1' }, 'u_mgr');
    put('2026-12-21', 'doctor.approve', { id: 'rev_c1' }, 'u_owner');
    const s = farm();
    assert.equal(galledCycle(s, s.cycles.c1).galled, true);
    assert.equal(gateModel(s, Z, { today: '2026-12-21' }).gates.find((g) => g.id === 'G4').state, 'pass');
  });

  await t.test('24 · GH-04 and GH-05 go to plant bags: Gate 0 now asks about a media batch, not the bed', () => {
    put('2026-12-21', 'plot.upsert', { id: Z, media: 'bag' });
    put('2026-12-21', 'plot.upsert', { id: Z5, media: 'bag', barrier: 'polythene', areaM2: 300 });
    const v = ask('2026-12-21');
    expectBlocked(v, [...BAG_G0, ...CR_ALL.map((id) => (id === 'cr_solarise' ? 'cr_fresh_media' : id)), ...G1_REDO]);
    assert.ok(!ids(v).includes('topsoil'), 'bed topsoil is not a bag-zone line');
    assert.match(find(v, 'ph').why, /No bags have been filled here/);
    assert.match(find(v, 'cr_fresh_media').name, /Fresh or re-treated media/);
    // The planted bed crop was judged on the bed; the switch does not re-judge it.
    assert.equal(farm().cycles.c1.media, 'bed');
  });

  await t.test('25 · restart steps 1, 2 and the fallow; the bags are recorded standing on ground cover', () => {
    evidence('2026-12-22', 'CR', 'terminate_remove', { note: 'Old plants and every old bag off-site and burned' });
    evidence('2026-12-22', 'CR', 'sanitise', { note: 'Nets bleached, drip flushed' });
    evidence('2026-12-22', 'CR', 'host_free_fallow', { note: 'Doors shut' });
    put('2026-12-22', 'plot.upsert', { id: Z, barrier: 'ground_cover' });
    const v = ask('2026-12-22');
    assert.ok(!ids(v).includes('bag_barrier'));
    assert.ok(!ids(v).includes('cr_terminate_remove') && !ids(v).includes('cr_sanitise'));
  });

  await t.test('26 · batch M0: pH 5.0 and a media no lime rate can be derived for; it fills nothing and is rejected', () => {
    put('2026-12-22', 'media.receive', {
      id: 'm0', label: 'M0', supplier: 'Rumuokoro loader', deliveredDate: '2026-12-22', source: 'fresh',
      material: 'cocopeat and sawdust', texture: 'cocopeat mix', volumeM3: 8, covered: false,
    });
    batchSoil('2026-12-23', 'm0', [5.0, 5.1, 5.0], { nematode: 'clean', lab: 'Rivers Soil Lab' });
    const check = fillCheck(farm(), 'm0', { date: '2026-12-23' });
    assert.equal(check.ok, false);
    const ph = check.blocking.find((c) => c.id === 'ph');
    assert.equal(ph.noRate, true);
    assert.match(ph.fix, /No lime rate can be derived for this batch/);
    assert.match(ph.fix, /not one of the textures in the lime table/);
    assert.match(ph.fix, /corrected or rejected before any bag is filled/);
    fill('2026-12-23', 'f_m0', 'm0', Z, 200);
    assert.ok(fillOf('f_m0').refused, 'bags cannot be filled from it');
    put('2026-12-23', 'media.reject', { id: 'm0', date: '2026-12-23', reason: 'no lime rate for cocopeat mix; pH 5.0' });
    assert.match(fillCheck(farm(), 'm0', { date: '2026-12-24' }).why, /rejected on 2026-12-23/);
    assert.match(find(ask('2026-12-23'), 'media_batch').why, /No bags have been filled here/);
  });

  await t.test('27 · batch M1, sandy loam, 10 m³, pH 5.07: lime by media volume, and no fill until the re-test', () => {
    put('2026-12-23', 'media.receive', {
      id: 'm1', label: 'M1', supplier: 'Onne Agro Media', deliveredDate: '2026-12-23', source: 'fresh',
      material: 'topsoil, compost, rice hull', texture: 'sandy_loam', volumeM3: 10, covered: false,
    });
    batchSoil('2026-12-23', 'm1', [5.0, 5.1, 5.1], { nematode: 'clean', lab: 'Rivers Soil Lab' });
    const ph = fillCheck(farm(), 'm1', { date: '2026-12-23' }).blocking.find((c) => c.id === 'ph');
    // Route A sandy loam 16.5-23.5 kg/100 m² over 15-20 cm: 0.83-1.57 kg/m³, so 8.3-15.7 kg for 10 m³.
    assert.equal(ph.limePlan.basis, 'volume');
    assert.equal(ph.limePlan.perM3Low, 0.83);
    assert.equal(ph.limePlan.perM3High, 1.57);
    assert.match(ph.fix, /Mix 8\.3–15\.7 kg of dolomitic agricultural lime, finest grade through the 10 m³ batch/);
    fill('2026-12-23', 'f_m1_early', 'm1', Z, 200);
    assert.match(fillOf('f_m1_early').refused.why, /below 5.2/);
  });

  await t.test('28 · 01-03 limed and re-tested 6.0-6.2: M1 fills 200 new bags in GH-04 and 60 in GH-05', () => {
    batchSoil('2027-01-03', 'm1', [6.0, 6.1, 6.2]);
    assert.equal(fillCheck(farm(), 'm1', { date: '2027-01-03' }).ok, true);
    fill('2027-01-03', 'f_m1_gh4', 'm1', Z, 200);
    fill('2027-01-03', 'f_m1_gh5', 'm1', Z5, 60);
    assert.equal(fillOf('f_m1_gh4').refused, undefined);
    const v = ask('2027-01-03');
    for (const id of ['media_batch', 'ph', 'nematode', 'heap_solarisation', 'cr_fresh_media']) {
      assert.ok(!ids(v).includes(id), `${id}: ${(find(v, id) || {}).why}`);
    }
  });

  await t.test('29 · what if the galled crop\'s bags were refilled, or its media re-treated for GH-04?', () => {
    const reused = ask('2027-01-03', { extra: [whatIf('2027-01-03', 'media.fill', {
      id: 'wf_reuse', batchId: 'm1', zoneId: Z, date: '2027-01-03', bags: 20, newBags: false,
    })] });
    assert.match(find(reused, 'cr_fresh_media').why, /galled .*reused its bags/);
    const retreated = ask('2027-01-04', { extra: [
      whatIf('2027-01-03', 'media.receive', { id: 'm_old', label: 'M-old', supplier: 'GH-04 old bags',
        deliveredDate: '2027-01-02', source: 're-treated', treatment: 'solarised 3 weeks', fromZoneId: Z, fromCycleId: 'c1' }),
      whatIf('2027-01-04', 'soiltest.record', { id: 'wf_st', mediaBatchId: 'm_old', date: '2027-01-04', ph: 6.2,
        readings: [6.1, 6.2, 6.3], calibrated: true, photo: { dataUrl: 'x' }, nematode: 'clean', lab: 'Rivers Soil Lab' }),
      { ...whatIf('2027-01-04', 'media.fill', { id: 'wf_old', batchId: 'm_old', zoneId: Z, date: '2027-01-04', bags: 10, newBags: true }), at: '2027-01-04T20:00:00.000Z' },
    ] });
    assert.match(find(retreated, 'cr_fresh_media').why, /media from a galled crop/);
  });

  await t.test('30 · batch M2 for GH-05 was solarised under plastic: no fill until the lift is recorded', () => {
    put('2026-12-23', 'media.receive', {
      id: 'm2', label: 'M2', supplier: 'Onne Agro Media', deliveredDate: '2026-12-23', source: 'fresh',
      texture: 'sandy_loam', volumeM3: 4, covered: true, coverFrom: '2026-12-24',
    });
    batchSoil('2027-01-03', 'm2', [6.2, 6.3, 6.3], { nematode: 'clean', lab: 'Rivers Soil Lab' });
    fill('2027-01-03', 'f_m2_early', 'm2', Z5, 40);
    assert.match(fillOf('f_m2_early').refused.why, /under plastic since 2026-12-24/);
    put('2027-01-21', 'media.update', { id: 'm2', coverTo: '2027-01-21', note: 'Plastic lifted' });
    fill('2027-01-22', 'f_m2', 'm2', Z5, 40);
    assert.equal(fillOf('f_m2').refused, undefined);
  });

  await t.test('31 · Gate 1 again, a released batch, the knockdown, and the Farm Doctor check on the batch', () => {
    for (const item of ['drip_pressure', 'spacing_pegged', 'sops_live']) evidence('2027-01-05', 'G1', item);
    evidence('2027-01-05', 'G1', 'traps_installed', { count: 50 });
    evidence('2027-01-05', 'G1', 'route_b_wait', { route: 'A', note: 'Route A lime mixed through the batch' });
    put('2026-12-01', 'seedling.sow', {
      id: 'b2', label: 'N-1201-A', nurseryZoneId: NUR, cropId: 'bell', variety: 'Nikita', sownDate: '2026-12-01', media: 'sterilised',
    }, 'u_sup');
    put('2027-01-02', 'seedling.harden', { batchId: 'b2', date: '2027-01-02' }, 'u_sup');
    put('2027-01-10', 'seedling.check', { id: 'k3', batchId: 'b2', date: '2027-01-10', thrips: false, virus: false, dampingOff: false, note: 'Clean' }, 'u_sup');
    put('2027-01-10', 'seedling.release', {
      id: 'b2', zoneId: Z, date: '2027-01-10', answers: { noVirus: true, noThrips: true, noDampingOff: true },
    }, 'u_sup');
    evidence('2027-01-11', 'CR', 'pre_plant_knockdown', { note: 'Cypermethrin all surfaces, doors shut; Mancozeb on floor' });

    saveDoctorCheck('2027-01-11', 'g0_bags');
    const review = farm().doctorOutputs.find((o) => o.id === 'g0_bags');
    const g0 = review.gates.find((g) => g.id === 'G0');
    assert.deepEqual(g0.items.map((i) => i.id), ['media_batch', 'ph_three_point', 'lab_report', 'heap_solarisation', 'bag_barrier', 'doctor_check']);
    assert.deepEqual(g0.missing.map((m) => m.id), ['doctor_check'], 'the Doctor finds the batch complete');
    assert.ok(review.read.some((r) => r.kind === 'media-fills'), 'and says it read the fills (FR-DOC-10)');
    put('2027-01-11', 'doctor.confirm', { id: 'g0_bags' }, 'u_mgr');
    put('2027-01-11', 'doctor.approve', { id: 'g0_bags' }, 'u_owner');
    const v = ask('2027-01-12', { batchId: 'b2' });
    assert.equal(v.ok, true, ids(v).join(', '));
    assert.equal(v.overridden.length, 0);
  });

  await t.test('32 · 01-12 transplanted into the bags', () => {
    put('2027-01-12', 'cycle.start', {
      id: 'c2', plotId: Z, cropId: 'bell', variety: 'Nikita', transplantDate: '2027-01-12', plants: 200, seedlingBatchId: 'b2',
    });
    const s = farm();
    assert.equal(s.cycles.c2.media, 'bag');
    const states = Object.fromEntries(gateModel(s, Z, { today: '2027-01-12' }).gates.map((g) => [g.id, g.state]));
    assert.deepEqual(states, { G0: 'pass', CR: 'pass', G1: 'pass', G2: 'waiting', G3: 'pass', G4: 'pass' });
  });

  await t.test('33 · 02-10 M1 fails after planting: it names every zone it filled', () => {
    batchSoil('2027-02-10', 'm1', null, { nematode: 'root-knot detected', lab: 'Rivers Soil Lab', note: 'Re-test after wilting in GH-04' });
    const s = farm();
    const trace = batchTrace(s, 'm1');
    assert.deepEqual(trace.zones.map((z) => [z.name, z.bags, z.planted.map((c) => c.id)]),
      [['GH-04', 200, ['c2']], ['GH-05', 60, []]]);
    assert.equal(trace.bags, 260);

    const line = exceptions(s, { now: '2027-02-10T18:00:00.000Z' }).find((x) => /Media batch M1/.test(x.line));
    assert.ok(line, 'the Owner hears about it');
    assert.equal(line.severity, 'critical');
    assert.match(line.line, /failed 2027-02-10 \(nematode test came back root-knot detected \(Rivers Soil Lab\)\) — filled GH-04, GH-05/);
    assert.match(line.detail, /GH-04 \(200 bags, planted 2027-01-12\); GH-05 \(60 bags, not planted\)/);

    // GH-04's crop was judged on transplant day, and that answer stands; the
    // failure is shown beside it, not by rewriting the gate.
    const model = gateModel(s, Z, { today: '2027-02-10' });
    assert.equal(model.gates.find((g) => g.id === 'G0').state, 'pass');
    assert.deepEqual(model.failedMedia.map((x) => x.batch.id), ['m1']);
    // GH-05 is empty, so its Gate 0 is judged now: the failed batch blocks it.
    assert.match(canPlant(s, Z5, { today: '2027-02-10' }).blocking.find((c) => c.id === 'media_batch').why,
      /M1 failed on 2027-02-10/);
    // And M1 fills nothing more.
    fill('2027-02-11', 'f_m1_late', 'm1', Z5, 10);
    assert.match(fillOf('f_m1_late').refused.why, /failed on 2027-02-10/);
  });

  await t.test('34 · the crop in the failed bags counts as galled: its bags are discarded at the next restart', () => {
    put('2027-03-15', 'cycle.close', { id: 'c2', date: '2027-03-15', note: 'Terminated: nematodes in the media' });
    const s = farm();
    assert.match(galledCycle(s, s.cycles.c2).why, /M1 failed on nematodes/);
    // The media still in the bags grew the last crop: it does not clear the next one.
    const left = find(ask('2027-03-16'), 'media_batch');
    assert.equal(left.state, 'unknown');
    assert.match(left.why, /filled before the previous cycle ended on 2027-03-15\. That media grew the last crop/);
    const v = ask('2027-03-20', { extra: [
      whatIf('2027-03-16', 'media.receive', { id: 'm3', label: 'M3', supplier: 'Onne Agro Media', deliveredDate: '2027-03-16',
        source: 'fresh', texture: 'sandy_loam', volumeM3: 10 }),
      whatIf('2027-03-17', 'soiltest.record', { id: 'wf_m3', mediaBatchId: 'm3', date: '2027-03-17', ph: 6.2,
        readings: [6.1, 6.2, 6.3], calibrated: true, photo: { dataUrl: 'x' }, nematode: 'clean', lab: 'Rivers Soil Lab' }),
      whatIf('2027-03-18', 'media.fill', { id: 'wf_m3_fill', batchId: 'm3', zoneId: Z, date: '2027-03-18', bags: 200, newBags: false }),
    ] });
    assert.match(find(v, 'cr_fresh_media').why, /galled .*reused its bags/);
  });
});
