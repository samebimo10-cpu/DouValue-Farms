// GH-04 from teardown to transplant — FR-GATE-00, FR-GATE-01, FR-GATE-06,
// FR-FARM-05 and the Rev 5 p16-17 clean-restart protocol, end to end.
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
