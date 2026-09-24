// The gate model — FR-GATE-06, FR-GATE-00, FR-GATE-01, FR-FARM-05.
//
// Gate 0 to Gate 4 from the rules, each with its pass conditions, and the
// clean-restart protocol for GH-04 and GH-05. Every test here starts from a
// zone with everything cleared and takes one thing away, so what it asserts is
// that one missing thing blocks — not that an empty farm is blocked, which is
// true of every gate at once and proves nothing about any of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
const RULES = await loadRules();
const { canPlant, canTreat, gateModel, phGate, nematodeGate, GATE_RULES } = await import(new URL('domain/gates.js', base).href);
const { withGatesCleared } = await import(new URL('./helpers/gates-cleared.mjs', import.meta.url).href);

const TODAY = '2026-09-16';
const day = (n, from = TODAY) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function farm(overrides = {}) {
  return {
    settings: {},
    people: {
      u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' },
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' },
      u_sup: { id: 'u_sup', name: 'Tamuno George', role: 'supervisor' },
      u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' },
    },
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 },
      gh4: { id: 'gh4', name: 'GH-04', code: 'GH-04', type: 'greenhouse', areaM2: 300, protocol: 'clean-restart' },
      nur: { id: 'nur', name: 'OF-02', type: 'nursery' },
    },
    cycles: {}, tasks: {}, inputs: {}, positions: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], gateEvidence: [], doctorOutputs: [],
    seedlingBatches: {}, alertAcks: [], alertDecisions: [], log: [],
    ...overrides,
  };
}

/** A three-point test from a calibrated meter, photographed, lab named. */
const soil = (o = {}) => {
  const ph = o.ph ?? 6.3;
  return {
    id: `t_${o.date || 'x'}_${ph}`, zoneId: 'gh1', date: day(-10), ph, readings: [ph, ph, ph], calibrated: true,
    photo: { dataUrl: 'data:image/jpeg;base64,x' }, nematode: 'clean', lab: 'Rivers Soil Lab', ...o,
  };
};

/** Everything cleared for a zone; `soil: false` leaves the soil to the test. */
const ready = (state, zoneId = 'gh1', o = {}) => withGatesCleared(state, { zoneId, plantedOn: TODAY, ...o });

const verdict = (state, zoneId = 'gh1', o = {}) => canPlant(state, zoneId, { today: TODAY, ...o });
const blockingIds = (v) => v.blocking.map((g) => g.id);
const gateOf = (state, id, zoneId = 'gh1', o = {}) => gateModel(state, zoneId, { today: TODAY, ...o }).gates.find((g) => g.id === id);

test('baseline: a zone with every condition recorded may be transplanted', () => {
  const v = verdict(ready(farm()));
  assert.equal(v.ok, true, blockingIds(v).join(', '));
});

// --- FR-GATE-06: the model is the rules' gates --------------------------------

test('FR-GATE-06: each zone shows Gate 0 to Gate 4 with the rules\' own names and conditions', () => {
  const model = gateModel(farm(), 'gh1', { today: TODAY });
  assert.deepEqual(model.gates.map((g) => g.id), ['G0', 'G1', 'G2', 'G3', 'G4']);
  for (const g of model.gates) {
    const spec = RULES.gates.find((r) => r.id === g.id);
    assert.equal(g.name, spec.name);
    assert.equal(g.when, spec.when);
    assert.ok(g.conditions.length, `${g.id} has no conditions`);
    assert.ok(g.state, `${g.id} has no state`);
  }
  const g1 = model.gates.find((g) => g.id === 'G1');
  assert.deepEqual(g1.conditions.map((c) => c.name), RULES.gates.find((r) => r.id === 'G1').pass_all);
  const g0 = model.gates.find((g) => g.id === 'G0');
  assert.equal(g0.evidence, null, 'G0 names no separate evidence document in the rules');
  assert.equal(g1.evidence, 'signed Establishment Checklist');
});

test('FR-GATE-06: GH-04 and GH-05 show the clean-restart protocol between Gate 0 and Gate 1', () => {
  const model = gateModel(farm(), 'gh4', { today: TODAY });
  assert.deepEqual(model.gates.map((g) => g.id), ['G0', 'CR', 'G1', 'G2', 'G3', 'G4']);
  const cr = model.gates.find((g) => g.id === 'CR');
  assert.equal(cr.conditions.length, RULES.clean_restart.steps.length);
  assert.equal(cr.source, 'Rev 5 p16-17');
  // A zone named GH-05 with no protocol field still gets it, from the register.
  const state = farm({ plots: { gh5: { id: 'gh5', name: 'GH-05', type: 'greenhouse' } } });
  assert.ok(gateModel(state, 'gh5', { today: TODAY }).gates.some((g) => g.id === 'CR'));
  // And GH-01 does not.
  assert.ok(!gateModel(farm(), 'gh1', { today: TODAY }).gates.some((g) => g.id === 'CR'));
});

// --- FR-GATE-00: Gate 0 clears only after Doctor, Manager and Owner ------------

function withReview(state, patch) {
  return {
    ...state,
    doctorOutputs: state.doctorOutputs.map((o) => (o.kind === 'gate-review' ? { ...o, ...patch } : o)),
  };
}

test('FR-GATE-00: Gate 0 blocks with no Farm Doctor check saved', () => {
  const state = { ...ready(farm()), doctorOutputs: [] };
  assert.deepEqual(blockingIds(verdict(state)), ['doctor_check']);
});

test('FR-GATE-00: a Doctor check nobody has confirmed does not clear Gate 0', () => {
  const v = verdict(withReview(ready(farm()), { confirmedBy: null, approvedBy: null }));
  assert.deepEqual(blockingIds(v), ['doctor_check']);
  assert.match(v.blocking[0].why, /Farm Manager to confirm/);
});

test('FR-GATE-00: confirmed by the Farm Manager but not approved by the Owner does not clear Gate 0', () => {
  const v = verdict(withReview(ready(farm()), { confirmedBy: 'u_mgr', approvedBy: null }));
  assert.deepEqual(blockingIds(v), ['doctor_check']);
  assert.match(v.blocking[0].why, /Owner has not approved/);
});

test('FR-GATE-00: a supervisor cannot stand in for the Manager, nor the Manager for the Owner', () => {
  assert.equal(verdict(withReview(ready(farm()), { confirmedBy: 'u_sup', approvedBy: 'u_owner' })).ok, false);
  assert.equal(verdict(withReview(ready(farm()), { confirmedBy: 'u_mgr', approvedBy: 'u_mgr' })).ok, false);
  assert.equal(verdict(withReview(ready(farm()), { confirmedBy: 'farm-doctor', approvedBy: 'u_owner' })).ok, false,
    'FR-DOC-08: the Farm Doctor never confirms its own check');
  assert.equal(verdict(withReview(ready(farm()), { confirmedBy: 'u_mgr', approvedBy: 'u_owner' })).ok, true);
});

test('FR-GATE-00: confirming a Doctor check that found Gate 0 incomplete does not clear it', () => {
  const state = withReview(ready(farm()), {
    gates: [{ id: 'G0', missing: [{ id: 'lab_report', label: 'soil + nematode lab report returned CLEAR' }, { id: 'doctor_check' }] }],
  });
  const v = verdict(state);
  assert.deepEqual(blockingIds(v), ['doctor_check']);
  assert.match(v.blocking[0].why, /found Gate 0 incomplete/);
});

test('FR-GATE-00: last cycle\'s sign-off does not clear this cycle\'s ground', () => {
  // The review is dated before the previous cycle here closed.
  let state = farm({
    cycles: { c0: { id: 'c0', plotId: 'gh1', transplantDate: day(-200), status: 'closed', closedAt: day(-30) } },
  });
  state = withGatesCleared(state, { zoneId: 'gh1', plantedOn: TODAY });
  state = withReview(state, { at: `${day(-40)}T09:00:00.000Z` });
  assert.ok(blockingIds(verdict(state)).includes('doctor_check'));
});

// --- FR-GATE-01: the three-point pH test and its hold rules -------------------

const phOnly = (tests, extra = {}) => ready(farm({ soilTests: tests, ...extra }), 'gh1', { soil: false });
const ph = (state) => phGate(state, 'gh1', { today: TODAY });

test('FR-GATE-01: fewer than three points does not open the gate', () => {
  const state = phOnly([soil({ readings: [6.2, 6.3] })]);
  assert.deepEqual(blockingIds(verdict(state)), ['ph']);
  assert.match(ph(state).why, /2 sampling points/);
  assert.match(ph(state).fix, /three-point/);
});

test('FR-GATE-01: the meter has to have been calibrated that morning, and photographed', () => {
  assert.match(ph(phOnly([soil({ calibrated: false })])).why, /calibrated/);
  assert.match(ph(phOnly([soil({ photo: null })])).why, /no photo of the meter/);
  assert.equal(verdict(phOnly([soil({ calibrated: false })])).ok, false);
  assert.equal(verdict(phOnly([soil({ photo: null })])).ok, false);
});

test('FR-GATE-01: every point must be in range — an average cannot hide an acid corner', () => {
  const state = phOnly([soil({ ph: 6.13, readings: [5.3, 6.5, 6.6] })]);
  const g = ph(state);
  assert.equal(g.state, 'held');
  assert.match(g.why, /5\.3/);
  assert.equal(verdict(state).ok, false);
});

test('FR-GATE-01: below 5.2 fails with the half-rate rule and a re-test date', () => {
  const g = ph(phOnly([soil({ date: day(-2), ph: 5.0 })]));
  assert.equal(g.state, 'fail');
  assert.equal(g.hold, 'below_5_2');
  assert.match(g.fix, /half the original rate/);
  assert.match(g.fix, /never stack a full dose/);
  assert.equal(g.retestFrom, day(8));
});

test('FR-GATE-01: 5.2 to 5.49 holds the block, re-test after 10 days, quarter rate if still low', () => {
  for (const low of [5.2, 5.35, 5.49]) {
    const state = phOnly([soil({ date: day(-2), ph: low })]);
    const g = ph(state);
    assert.equal(g.state, 'held', `pH ${low}`);
    assert.equal(g.hold, '5_2_to_5_49');
    assert.match(g.fix, /re-test after 10 days/);
    assert.match(g.fix, /one-quarter of the original rate/);
    assert.match(g.fix, /Owner approves/);
    assert.equal(verdict(state).ok, false, `pH ${low} must block`);
  }
});

test('FR-GATE-01: a passing re-test inside the 10-day hold does not lift it; after 10 days it does', () => {
  const tooSoon = phOnly([soil({ date: day(-6), ph: 5.3 }), soil({ date: day(-1), ph: 5.8 })]);
  const g = ph(tooSoon);
  assert.equal(g.state, 'held');
  assert.equal(g.hold, 'retest_too_soon');
  assert.equal(g.retestFrom, day(4));

  const waited = phOnly([soil({ date: day(-12), ph: 5.3 }), soil({ date: day(-1), ph: 5.8 })]);
  assert.equal(ph(waited).state, 'pass');
  assert.equal(verdict(waited).ok, true);
});

test('FR-GATE-01: soil and pH results older than 90 days before transplant are re-taken', () => {
  assert.equal(GATE_RULES.soilTestMaxAgeDays, 90);
  assert.equal(GATE_RULES.nematodeMaxAgeDays, 90);
  assert.equal(verdict(phOnly([soil({ date: day(-90) })])).ok, true, '90 days is inside the window');
  const stale = phOnly([soil({ date: day(-91) })]);
  assert.deepEqual(blockingIds(verdict(stale)).sort(), ['nematode', 'ph']);
});

test('FR-GATE-01: results sampled before the previous cycle here ended are re-taken', () => {
  const cycles = { c0: { id: 'c0', plotId: 'gh1', transplantDate: day(-150), status: 'closed', closedAt: day(-20) } };
  // Everything else for the new planting is recorded after the close.
  const before = withGatesCleared(farm({ cycles, soilTests: [soil({ date: day(-25) })] }),
    { zoneId: 'gh1', plantedOn: TODAY, soil: false });
  const v = verdict(before, 'gh1');
  assert.ok(blockingIds(v).includes('ph'));
  assert.ok(blockingIds(v).includes('nematode'));
  assert.match(ph(before).why, /before the previous cycle here ended/);

  const after = withGatesCleared(farm({ cycles, soilTests: [soil({ date: day(-15) })] }),
    { zoneId: 'gh1', plantedOn: TODAY, soil: false });
  assert.ok(!blockingIds(verdict(after)).includes('ph'));
});

test('FR-GATE-01: a clean nematode result has to name the lab that gave it', () => {
  const state = phOnly([soil({ lab: '' })]);
  assert.deepEqual(blockingIds(verdict(state)), ['nematode']);
  assert.match(nematodeGate(state, 'gh1', { today: TODAY }).why, /does not name the lab/);
});

test('FR-GATE-01: the soil test is recorded with its three readings and it is those that are judged', () => {
  const g = ph(phOnly([soil({ ph: 6.2, readings: [6.0, 6.2, 6.4] })]));
  assert.equal(g.state, 'pass');
  assert.match(g.why, /6, 6\.2, 6\.4 from 3 points/);
});

// --- The clean-restart protocol (GH-04, GH-05) --------------------------------

const crSteps = RULES.clean_restart.steps;
const crEvidence = (zoneId, dates = {}) => crSteps.map((s, i) => ({
  id: `cr_${s.id}`, gate: 'CR', itemId: s.id, zoneId, date: dates[s.id] || day(-30 + i), note: 'done',
}));

test('clean restart: GH-04 cannot be transplanted until every step is recorded', () => {
  const state = ready(farm(), 'gh4');
  const v = verdict(state, 'gh4');
  assert.deepEqual(blockingIds(v), crSteps.map((s) => `cr_${s.id}`));
  for (const c of v.blocking) assert.ok(c.fix.length > 20, `${c.id} says what to do`);
});

test('clean restart: all five steps recorded opens it', () => {
  const state = ready(farm({ gateEvidence: crEvidence('gh4') }), 'gh4');
  const v = verdict(state, 'gh4');
  assert.equal(v.ok, true, blockingIds(v).join(', '));
});

test('clean restart: steps from before the previous cycle ended belong to the last restart', () => {
  const cycles = { c0: { id: 'c0', plotId: 'gh4', transplantDate: day(-200), status: 'closed', closedAt: day(-35) } };
  const old = crEvidence('gh4', Object.fromEntries(crSteps.map((s) => [s.id, day(-60)])));
  const state = withGatesCleared(farm({ cycles, gateEvidence: old }), { zoneId: 'gh4', plantedOn: TODAY });
  const v = verdict(state, 'gh4');
  for (const s of crSteps) assert.ok(blockingIds(v).includes(`cr_${s.id}`), `${s.id} should not carry over`);
});

test('clean restart: the host-free fallow has to last the minimum break', () => {
  const fallow = crSteps.find((s) => s.min_days);
  assert.equal(fallow.min_days, 21);
  const dates = Object.fromEntries(crSteps.map((s) => [s.id, day(-5)]));
  const state = ready(farm({ gateEvidence: crEvidence('gh4', dates) }), 'gh4');
  const v = verdict(state, 'gh4');
  assert.deepEqual(blockingIds(v), [`cr_${fallow.id}`]);
  assert.equal(v.blocking[0].state, 'held');
  assert.match(v.blocking[0].why, /host-free for 5 days/);
});

// --- Gate 1 (FR-FARM-05) ------------------------------------------------------

test('FR-FARM-05: Gate 1 blocks transplant without a released seedling batch', () => {
  const state = { ...ready(farm()), seedlingBatches: {} };
  const v = verdict(state);
  assert.deepEqual(blockingIds(v), ['seedling_release']);
  assert.match(v.blocking[0].why, /No seedling batch has been released to this block/);
});

test('FR-FARM-05: a batch released to a different block does not open this one', () => {
  const state = ready(farm());
  const moved = Object.fromEntries(Object.entries(state.seedlingBatches)
    .map(([k, b]) => [k, { ...b, release: { ...b.release, zoneId: 'gh4' } }]));
  assert.deepEqual(blockingIds(verdict({ ...state, seedlingBatches: moved })), ['seedling_release']);
});

test('FR-FARM-05: a batch already planted into another cycle cannot be planted again', () => {
  const state = ready(farm());
  const used = Object.fromEntries(Object.entries(state.seedlingBatches)
    .map(([k, b]) => [k, { ...b, usedByCycleId: 'someone_else' }]));
  assert.deepEqual(blockingIds(verdict({ ...state, seedlingBatches: used })), ['seedling_release']);
});

test('FR-FARM-05: naming a batch that has not passed the release check blocks the transplant', () => {
  const state = ready(farm());
  state.seedlingBatches.unreleased = { id: 'unreleased', label: 'N-9', status: 'growing', release: null };
  const v = verdict(state, 'gh1', { batchId: 'unreleased' });
  assert.deepEqual(blockingIds(v), ['seedling_release']);
  assert.match(v.blocking[0].why, /has not passed the release check/);
});

test('Gate 1: each line of the Establishment Checklist blocks on its own', () => {
  for (const line of ['drip_pressure', 'spacing_pegged', 'traps_installed', 'sops_live', 'route_b_wait']) {
    const state = ready(farm());
    state.gateEvidence = state.gateEvidence.filter((e) => e.itemId !== line);
    assert.deepEqual(blockingIds(verdict(state)), [line], line);
  }
});

test('Gate 1: last cycle\'s checklist does not count for this planting', () => {
  let state = farm({ cycles: { c0: { id: 'c0', plotId: 'gh1', transplantDate: day(-150), status: 'closed', closedAt: day(-1) } } });
  // Evidence dated three days before today, i.e. before the close.
  state = withGatesCleared(state, { zoneId: 'gh1', plantedOn: TODAY });
  const ids = blockingIds(verdict(state));
  assert.ok(ids.includes('drip_pressure'), ids.join(', '));
});

// --- Gate 2 and Gate 3 --------------------------------------------------------

function planted(extra = {}) {
  const cycles = { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-30), status: 'active' } };
  return withGatesCleared(farm({ cycles, ...extra }), { zoneId: 'gh1', plantedOn: day(-30), cycleId: 'c1' });
}

test('Gate 2: trap counts gapped more than 2 days turn it red, without blocking a transplant', () => {
  const state = planted({
    scouts: [{ id: 's1', cycleId: 'c1', pestId: 'thrips', trapCount: 2, date: day(-4) }],
    log: [{ by: 'u_owner', at: `${day(-1)}T08:00:00.000Z` }],
  });
  const g2 = gateOf(state, 'G2');
  assert.equal(g2.state, 'fail');
  assert.match(g2.conditions.find((c) => c.id === 'g2_scouting').why, /gapped 4 days/);
  assert.equal(g2.blocksTransplant, false, 'the rules give Gate 2 no action to block');
  assert.equal(verdict(state).ok, true);
});

test('Gate 2: live when trap counts are current, no alert is past its deadline and the Owner is looking', () => {
  const state = planted({
    scouts: [{ id: 's1', cycleId: 'c1', pestId: 'thrips', trapCount: 2, date: day(-1) }],
    log: [{ by: 'u_owner', at: `${day(-2)}T08:00:00.000Z` }],
  });
  assert.equal(gateOf(state, 'G2').state, 'pass');
  const unseen = planted({ scouts: state.scouts, log: [] });
  assert.equal(gateOf(unseen, 'G2').conditions.find((c) => c.id === 'g2_owner').state, 'fail');
});

test('Gate 2: waits for Week 1', () => {
  const cycles = { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-3), status: 'active' } };
  assert.equal(gateOf(farm({ cycles }), 'G2').state, 'waiting');
});

test('Gate 3: a spray with no diagnosis behind it turns the gate red, and new treatments are refused', () => {
  const state = planted({ sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'mancozeb', date: day(-2) }] });
  const g3 = gateOf(state, 'G3');
  assert.equal(g3.state, 'fail');
  assert.equal(g3.blocksAction, 'treatment');
  assert.equal(canTreat(state, 'c1', { today: TODAY }).ok, false);
  assert.equal(canTreat(state, 'c1', { today: TODAY }).reason, 'no-diagnosis');
});

// --- Gate 4 ---------------------------------------------------------------------

function afterCycle(extra = {}) {
  const cycles = { c0: { id: 'c0', plotId: 'gh1', transplantDate: day(-150), status: 'closed', closedAt: day(-20) } };
  const state = withGatesCleared(farm({ cycles, ...extra }), { zoneId: 'gh1', plantedOn: TODAY });
  return state;
}
const g4Evidence = ['root_inspection', 'control_audit', 'sops_updated'].map((itemId) => ({
  id: `g4_${itemId}`, gate: 'G4', itemId, zoneId: 'gh1', cycleId: 'c0', date: day(-19), note: 'done',
}));
const cycleReview = (o = {}) => ({
  id: 'cr1', kind: 'cycle-review', subject: { cycleId: 'c0' }, at: `${day(-18)}T09:00:00.000Z`,
  confirmedBy: 'u_mgr', approvedBy: 'u_owner', ...o,
});

test('Gate 4: the next transplant is blocked until the last cycle is closed and learned from', () => {
  const v = verdict(afterCycle());
  assert.deepEqual(blockingIds(v).sort(), ['control_audit', 'g4_signoff', 'root_inspection', 'sops_updated']);
});

test('FR-GATE-00: Gate 4 clears only with the Farm Doctor cycle review, confirmed and approved', () => {
  const base = afterCycle({ gateEvidence: g4Evidence });
  const withDoc = (o) => ({ ...base, doctorOutputs: [...base.doctorOutputs, cycleReview(o)] });

  assert.deepEqual(blockingIds(verdict(base)), ['g4_signoff'], 'no Doctor review drafted');
  assert.deepEqual(blockingIds(verdict(withDoc({ confirmedBy: null, approvedBy: null }))), ['g4_signoff']);
  assert.deepEqual(blockingIds(verdict(withDoc({ approvedBy: null }))), ['g4_signoff']);
  assert.deepEqual(blockingIds(verdict(withDoc({ approvedBy: 'u_mgr' }))), ['g4_signoff'], 'the Manager is not the Owner');
  assert.equal(verdict(withDoc()).ok, true);
});

test('Gate 4: a crop still growing waits for its own end, and does not block anything yet', () => {
  const g4 = gateOf(planted(), 'G4');
  assert.equal(g4.state, 'waiting');
  assert.equal(g4.blocksTransplant, false);
});

// --- Overrides and the nursery -----------------------------------------------------

test('FR-GATE-07: an Owner override from before the previous cycle ended does not stand', () => {
  const state = afterCycle({
    gateEvidence: g4Evidence,
    doctorOutputs: [cycleReview()],
    gateOverrides: [{ id: 'o1', gate: 'seedling_release', zoneId: 'gh1', reason: 'Seedlings from a trusted grower', at: `${day(-40)}T09:00:00Z` }],
  });
  state.seedlingBatches = {};
  assert.deepEqual(blockingIds(verdict(state)), ['seedling_release']);
});

test('FR-FARM-04: the nursery is never a cropping block, and no override makes it one', () => {
  const state = farm({
    gateOverrides: [{ id: 'o1', gate: 'zone_type', zoneId: 'nur', reason: 'We want to plant peppers in here', at: `${day(-1)}T09:00:00Z` }],
  });
  const v = verdict(state, 'nur');
  assert.equal(v.ok, false);
  assert.deepEqual(blockingIds(v), ['zone_type']);
  assert.match(v.blocking[0].why, /nursery, not a cropping block/);
});
