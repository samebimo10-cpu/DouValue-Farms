// Gates — requirements 6.2.
//
// The design test in section 1 is "would this have stopped Season 1?", so that
// is what these assert. Every test here is one of the four root causes trying
// to happen again and being refused.
//
// The important half is the refusals. A gate that passes when it should is
// pleasant; a gate that passes when it should not is the whole disaster
// repeating with better paperwork.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const {
  canPlant, canTreat, gatesForZone, gateBoard, rotationCheck, GATE_RULES,
} = await import(new URL('domain/gates.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-16';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function farm(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {
      u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true },
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
      u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand', active: true },
    },
    plots: { gh1: { id: 'gh1', name: 'GH-01', areaM2: 300, type: 'greenhouse' } },
    cycles: {},
    tasks: {},
    inputs: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [],
    log: [], orphans: [],
    ...overrides,
  };
}

/** Both soil gates satisfied, so a test only has to break the one it is about. */
const cleanTests = (zoneId = 'gh1', date = day(-10)) => [
  { id: 't1', zoneId, date, ph: 6.3, nematode: 'clean' },
];

const names = (v) => v.blocking.map((g) => g.name).join(', ');

// --- FR-GATE-01: the pH gate ---------------------------------------------

test('planting is blocked on a zone that has never been tested', () => {
  const verdict = canPlant(farm(), 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocking.length, 2, names(verdict));
  // Never tested is not a softer state than tested-and-failed. That distinction
  // is exactly how untested ground got planted in Season 1.
  assert.equal(verdict.gates.find((g) => g.id === 'ph').state, 'unknown');
  assert.equal(verdict.gates.find((g) => g.id === 'nematode').state, 'unknown');
});

test('planting is blocked when pH is outside 5.5 to 7.0', () => {
  for (const ph of [4.8, 5.4, 7.1, 8.2]) {
    const state = farm({ soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph, nematode: 'clean' }] });
    const verdict = canPlant(state, 'gh1', { today: TODAY });
    assert.equal(verdict.ok, false, `pH ${ph} should be refused`);
    assert.match(verdict.gates.find((g) => g.id === 'ph').why, new RegExp(String(ph)));
  }
});

test('planting is allowed at the edges of the range, which are inside it', () => {
  for (const ph of [5.5, 6.2, 7.0]) {
    const state = farm({ soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph, nematode: 'clean' }] });
    assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, true, `pH ${ph} should pass`);
  }
});

test('a reading taken before liming does not open the gate', () => {
  // The whole reason for testing early is to lime. A pre-correction reading
  // that happens to be in range says nothing about what the roots will meet.
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.0, nematode: 'clean', beforeCorrection: true }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.match(verdict.gates.find((g) => g.id === 'ph').why, /before lime/);
});

test('a stale reading stops counting', () => {
  const tooOld = GATE_RULES.soilTestMaxAgeDays + 1;
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-tooOld), ph: 6.3, nematode: 'clean' }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.match(verdict.gates.find((g) => g.id === 'ph').why, /days old/);
});

test('the newest test is the one that counts', () => {
  const state = farm({
    soilTests: [
      { id: 't1', zoneId: 'gh1', date: day(-40), ph: 4.5, nematode: 'clean' },   // before liming
      { id: 't2', zoneId: 'gh1', date: day(-3), ph: 6.4, nematode: 'clean' },    // after
    ],
  });
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, true);
});

test('a bed cleared before transplant does not turn red as the test ages', () => {
  // The window is a condition on planting, not a clock that keeps running. If
  // a growing crop re-blocks its own zone ninety days in, people learn that red
  // means nothing, and then it does.
  const tested = day(-130);
  const state = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-120), status: 'active' } },
    soilTests: [{ id: 't1', zoneId: 'gh1', date: tested, ph: 6.2, nematode: 'clean' }],
  });

  const verdict = canPlant(state, 'gh1', { today: TODAY });
  assert.equal(verdict.ok, true, names(verdict));
});

test('but an empty zone is judged as of today, which is the decision in front of you', () => {
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-130), ph: 6.2, nematode: 'clean' }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false, 'a 130-day-old test cannot authorise planting today');
  assert.match(verdict.gates.find((g) => g.id === 'ph').why, /days old/);
});

test('a test taken after the crop went in does not retroactively clear the planting', () => {
  const state = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-60), status: 'active' } },
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.2, nematode: 'clean' }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false, 'testing afterwards is not the same as testing first');
});

// --- FR-GATE-02: the nematode gate ---------------------------------------

test('a nematode result that is not clean blocks planting and says what to do instead', () => {
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.3, nematode: 'root-knot detected' }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });
  const gate = verdict.gates.find((g) => g.id === 'nematode');

  assert.equal(verdict.ok, false);
  assert.equal(gate.state, 'fail');
  assert.match(gate.fix, /solarise|rotate|non-host/i);
});

test('a pH test alone does not clear the nematode gate', () => {
  // The two are separate samples and separate questions. Season 1 passed one
  // of them.
  const state = farm({ soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.3 }] });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.gates.find((g) => g.id === 'ph').state, 'pass');
  assert.equal(verdict.gates.find((g) => g.id === 'nematode').state, 'unknown');
});

// --- FR-GATE-03: purchased topsoil ---------------------------------------

test('an untested topsoil batch blocks the zone it was put in', () => {
  const state = farm({
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', topsoilBatchId: 'b1' } },
    topsoilBatches: { b1: { id: 'b1', supplier: 'Rumuokoro loader', date: day(-8) } },
    soilTests: cleanTests(),
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });
  const gate = verdict.gates.find((g) => g.id === 'topsoil');

  assert.equal(verdict.ok, false);
  assert.equal(gate.state, 'fail');
  assert.match(gate.why, /Rumuokoro loader/);
});

test('a batch tested clean clears the zone it fills', () => {
  const state = farm({
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', topsoilBatchId: 'b1' } },
    topsoilBatches: { b1: { id: 'b1', supplier: 'Rumuokoro loader', date: day(-8) } },
    soilTests: [{ id: 't1', batchId: 'b1', date: day(-6), ph: 6.1, nematode: 'clean' }],
  });
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, true);
});

test('a zone with no purchased topsoil is not asked about topsoil', () => {
  const state = farm({ soilTests: cleanTests() });
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).gates.find((g) => g.id === 'topsoil').state, 'pass');
});

// --- FR-GATE-04: diagnose before treat -----------------------------------

test('a treatment is refused when nothing has been diagnosed', () => {
  const verdict = canTreat(farm(), 'c1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'no-diagnosis');
  assert.match(verdict.fix, /clinic/i);
});

test('a treatment is refused on a diagnosis nobody senior has confirmed', () => {
  // FR-DIAG-03. A hand can start one; it does not become a licence to spray
  // until a supervisor or manager has agreed with it.
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', problemName: 'Thrips',
      date: day(-1), by: 'u_hand' }],
  });
  const verdict = canTreat(state, 'c1', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'unconfirmed');
  assert.match(verdict.fix, /Field Supervisor or Farm Manager/);
});

test('a confirmed diagnosis lets the treatment through', () => {
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', problemName: 'Thrips',
      date: day(-1), by: 'u_hand', confirmedBy: 'u_mgr' }],
  });
  const verdict = canTreat(state, 'c1', { today: TODAY });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.diagnosis.id, 'd1');
});

test('a diagnosis from last month does not authorise a spray today', () => {
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', date: day(-30), confirmedBy: 'u_mgr' }],
  });
  assert.equal(canTreat(state, 'c1', { today: TODAY }).reason, 'no-diagnosis');
});

// --- FR-GATE-05: spray rotation ------------------------------------------

test('a third spray from one resistance group is blocked, with alternatives named', () => {
  const sprays = [day(-30), day(-15)].map((date, i) => ({
    id: `s${i}`, cycleId: 'c1', productId: 'mancozeb', date,
  }));
  const verdict = rotationCheck(farm({ sprays }), 'c1', 'mancozeb', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.ok(verdict.alternatives.length, 'a block that names no alternative just gets overridden');
});

test('two from one group is still allowed, because two is the limit', () => {
  const sprays = [{ id: 's0', cycleId: 'c1', productId: 'mancozeb', date: day(-20) }];
  assert.equal(rotationCheck(farm({ sprays }), 'c1', 'mancozeb', { today: TODAY }).ok, true);
});

test('rotation is judged per zone, not across the whole farm', () => {
  // Two houses each sprayed twice is not four applications on one population.
  const sprays = [day(-30), day(-15)].map((date, i) => ({
    id: `s${i}`, cycleId: 'c2', productId: 'mancozeb', date,
  }));
  assert.equal(rotationCheck(farm({ sprays }), 'c1', 'mancozeb', { today: TODAY }).ok, true);
});

test('the rotation block reaches the treatment gate, not just the warning screen', () => {
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'anthracnose', date: day(-1), confirmedBy: 'u_mgr' }],
    sprays: [day(-30), day(-15)].map((date, i) => ({ id: `s${i}`, cycleId: 'c1', productId: 'mancozeb', date })),
  });
  const verdict = canTreat(state, 'c1', { today: TODAY, productId: 'mancozeb' });

  assert.equal(verdict.ok, false, 'a confirmed diagnosis does not excuse breaking rotation');
  assert.equal(verdict.reason, 'rotation');
});

// --- FR-GATE-07: overrides ------------------------------------------------

test('an Owner override opens the gate but does not erase what it found', () => {
  const state = farm({
    gateOverrides: [{ id: 'o1', gate: 'nematode', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lab result lost in transit; second sample already sent', at: `${day(-1)}T09:00:00Z` }],
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.3 }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });
  const gate = verdict.gates.find((g) => g.id === 'nematode');

  assert.equal(verdict.ok, true, 'the Owner may decide to go ahead');
  assert.equal(gate.state, 'overridden');
  assert.ok(gate.blockedWhy, 'what the gate found is kept on the record');
  assert.equal(gate.override.reason, 'Lab result lost in transit; second sample already sent');
});

test('an override of one gate does not open another', () => {
  const state = farm({
    gateOverrides: [{ id: 'o1', gate: 'nematode', zoneId: 'gh1', by: 'u_owner',
      reason: 'Second sample already sent to the lab', at: `${day(-1)}T09:00:00Z` }],
  });
  const verdict = canPlant(state, 'gh1', { today: TODAY });

  assert.equal(verdict.ok, false, 'pH is still untested');
  assert.deepEqual(verdict.blocking.map((g) => g.id), ['ph']);
});

test('an override for one zone does not travel to another', () => {
  const state = farm({
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },
      gh2: { id: 'gh2', name: 'GH-02', type: 'greenhouse' },
    },
    soilTests: [...cleanTests('gh1')],
    gateOverrides: [{ id: 'o1', gate: 'nematode', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lab slip mislaid, resample taken', at: `${day(-1)}T09:00:00Z` }],
  });
  assert.equal(canPlant(state, 'gh2', { today: TODAY }).ok, false);
});

test('a revoked override stops standing', () => {
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-5), ph: 6.3 }],
    gateOverrides: [{ id: 'o1', gate: 'nematode', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lab result lost in transit', at: `${day(-2)}T09:00:00Z`, revoked: true }],
  });
  assert.equal(canPlant(state, 'gh1', { today: TODAY }).ok, false);
});

// --- Server enforcement ---------------------------------------------------

test('only the Owner may override a gate', () => {
  const event = {
    id: 'e1', type: 'gate.override',
    payload: { gate: 'nematode', zoneId: 'gh1', reason: 'Second sample already at the lab' },
  };

  for (const role of ['hand', 'supervisor', 'agronomist', 'manager']) {
    assert.equal(core.can(role, 'manageOwners'), false, `${role} must not hold the override permission`);
  }
  assert.equal(core.can('ceo', 'manageOwners'), true);
  assert.equal(core.EVENT_POLICY['gate.override'].write, 'manageOwners');
});

test('an override without a real reason is refused by the server', () => {
  const owner = { id: 'u_owner', role: 'ceo' };
  const guard = core.EVENT_POLICY['gate.override'].guard;

  for (const reason of ['', '  ', 'ok', 'because']) {
    const verdict = guard({ type: 'gate.override', payload: { gate: 'ph', zoneId: 'gh1', reason } }, owner);
    assert.equal(verdict.ok, false, `"${reason}" is not a reason`);
  }
  const good = guard({
    type: 'gate.override',
    payload: { gate: 'ph', zoneId: 'gh1', reason: 'Lime went on Tuesday, retest booked for Friday' },
  }, owner);
  assert.equal(good.ok, true);
});

test('an override must name which gate and which zone', () => {
  const guard = core.EVENT_POLICY['gate.override'].guard;
  const owner = { id: 'u_owner', role: 'ceo' };
  const reason = 'Lime went on Tuesday, retest booked for Friday';

  assert.equal(guard({ payload: { zoneId: 'gh1', reason } }, owner).ok, false);
  assert.equal(guard({ payload: { gate: 'ph', reason } }, owner).ok, false);
});

test('a farm hand cannot confirm their own diagnosis', () => {
  assert.equal(core.can('hand', 'verifyHarvest'), false);
  assert.equal(core.can('supervisor', 'verifyHarvest'), true);
  assert.equal(core.EVENT_POLICY['diagnosis.confirm'].write, 'verifyHarvest');
});

// --- The board ------------------------------------------------------------

test('the gates board puts the blocked zones first', () => {
  const state = farm({
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },                 // nothing tested
      gh2: { id: 'gh2', name: 'GH-02', type: 'greenhouse' },                 // clear
      gh3: { id: 'gh3', name: 'GH-03', type: 'greenhouse' },                 // pH only
    },
    soilTests: [
      { id: 't2', zoneId: 'gh2', date: day(-4), ph: 6.2, nematode: 'clean' },
      { id: 't3', zoneId: 'gh3', date: day(-4), ph: 6.2 },
    ],
  });
  const board = gateBoard(state, { today: TODAY });

  assert.deepEqual(board.map((r) => r.zone.name), ['GH-01', 'GH-03', 'GH-02']);
  assert.equal(board[board.length - 1].ok, true);
});

test('every blocked gate says what would clear it', () => {
  // A block with no fix is the thing people override to get their work done,
  // and an app whose gates are routinely overridden has no gates.
  const state = farm({
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', topsoilBatchId: 'b1' } },
    topsoilBatches: { b1: { id: 'b1', supplier: 'Rumuokoro loader', date: day(-8) } },
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-2), ph: 4.4, nematode: 'root-knot detected' }],
  });

  for (const g of gatesForZone(state, 'gh1', { today: TODAY })) {
    if (g.state === 'pass') continue;
    assert.ok(g.why && g.why.length > 15, `${g.id} must say what it found`);
    assert.ok(g.fix && g.fix.length > 20, `${g.id} must say what would clear it`);
  }
});
