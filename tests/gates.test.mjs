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
// FR-GATE-05 reads the rotation out of rules/douvalue_rules_rev5_1.json, so the
// rules have to be in hand before a gate can be asked anything.
const { loadRules } = await import(new URL('rules.js', base).href);
await loadRules();
const {
  canPlant, canTreat, cropWeek, gatesForZone, gateBoard, rotationCheck, GATE_RULES,
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
    actives: {}, labels: {},
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

// --- FR-GATE-05: spray rotation by resistance group ----------------------
//
// The rules file does not say "three sprays in sixty days". It says "never the
// same IRAC group twice in a row" and "never the same FRAC group twice in a
// row", and it names the two sequences the farm rotates through. That is what
// these assert, because a rotation gate that reads brand names is not a
// rotation gate — it is a spelling check.

/** A zone with a crop in it, so the week-10 rules have a transplant date to count from. */
const planted = (transplantDate = day(-30), extra = {}) => farm({
  cycles: { c1: { id: 'c1', plotId: 'gh1', crop: 'bell', status: 'active', transplantDate } },
  ...extra,
});

const sprayed = (rows) => rows.map((r, i) => ({
  id: `s${i}`, cycleId: 'c1', activeId: r.activeId, date: r.date,
  targetProblem: r.target || '', purpose: r.purpose || null,
}));

test('the same FRAC group twice in a row is blocked, however long the gap', () => {
  const state = planted(day(-30), { sprays: sprayed([{ activeId: 'mancozeb', date: day(-20) }]) });
  const verdict = rotationCheck(state, 'c1', 'mancozeb', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.ok(/never the same frac group twice in a row/i.test(verdict.why), verdict.why);
  assert.ok(verdict.alternatives.length, 'a block that names no alternative just gets overridden');
});

test('the named FRAC sequence runs clean: M3, then M1, then the Metalaxyl mixture', () => {
  const after = (rows, activeId) => rotationCheck(
    planted(day(-60), { sprays: sprayed(rows) }), 'c1', activeId, { today: TODAY },
  );

  assert.equal(after([], 'mancozeb').ok, true);
  assert.equal(after([{ activeId: 'mancozeb', date: day(-24) }], 'copper-oxychloride').ok, true);
  assert.equal(after([
    { activeId: 'mancozeb', date: day(-24) },
    { activeId: 'copper-oxychloride', date: day(-12) },
  ], 'metalaxyl-m-mancozeb').ok, true);
  // "then: restart at M3" — the mixture rotates as FRAC 4, so Mancozeb follows it.
  assert.equal(after([
    { activeId: 'mancozeb', date: day(-36) },
    { activeId: 'copper-oxychloride', date: day(-24) },
    { activeId: 'metalaxyl-m-mancozeb', date: day(-12) },
  ], 'mancozeb').ok, true);
});

test('a second brand from the same IRAC group is not a rotation', () => {
  // Cypermethrin and lambda-cyhalothrin are both IRAC 3A. Two bottles, two
  // prices, one mode of action, and the thrips cannot tell them apart.
  const state = planted(day(-30), { sprays: sprayed([{ activeId: 'cypermethrin', date: day(-9) }]) });
  const verdict = rotationCheck(state, 'c1', 'lambda-cyhalothrin', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.equal(verdict.group, 'IRAC 3A');
  assert.ok(/Thiamethoxam/i.test(verdict.fix), verdict.fix);
});

test('the sequence itself is the fix a refusal offers', () => {
  const state = planted(day(-30), { sprays: sprayed([{ activeId: 'cypermethrin', date: day(-9) }]) });
  const verdict = rotationCheck(state, 'c1', 'cypermethrin', { today: TODAY });

  assert.equal(verdict.next.group, 'IRAC 4A', 'after 3A the programme goes to 4A');
  assert.equal(verdict.next.rate, '0.2 g/L', 'and it carries the rate, so nobody guesses one');
});

test('rotation is judged per zone, not across the whole farm', () => {
  // Two houses each sprayed once is not two applications on one population.
  const state = farm({
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', status: 'active', transplantDate: day(-30) },
      c2: { id: 'c2', plotId: 'gh2', status: 'active', transplantDate: day(-30) },
    },
    sprays: [{ id: 's0', cycleId: 'c2', activeId: 'mancozeb', date: day(-10) }],
  });
  assert.equal(rotationCheck(state, 'c1', 'mancozeb', { today: TODAY }).ok, true);
});

test('copper sprayed on pruning wounds does not count against the FRAC rotation', () => {
  // Rev 5.1: wound care is logged as wound care and excluded from the rotation
  // check and the interval count.
  const state = planted(day(-30), {
    sprays: sprayed([{ activeId: 'copper-hydroxide', date: day(-3), purpose: 'wound-care' }]),
  });
  assert.equal(rotationCheck(state, 'c1', 'copper-oxychloride', { today: TODAY }).ok, true);
});

test('Metalaxyl-M is refused until two other fungicides have been through', () => {
  const state = planted(day(-40), {
    sprays: sprayed([
      { activeId: 'metalaxyl-m-mancozeb', date: day(-24) },
      { activeId: 'mancozeb', date: day(-12) },
    ]),
  });
  const verdict = rotationCheck(state, 'c1', 'metalaxyl-m-mancozeb', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'metalaxyl', 'max every third fungicide spray');
});

test('an active with no rate on file cannot be sprayed at all', () => {
  // FR-STOCK-08. Abamectin is in the catalogue with no schedule rate, so until
  // somebody enters the label it is a bottle with no dose.
  const verdict = rotationCheck(planted(), 'c1', 'abamectin', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'no-rate');
  assert.ok(/label/i.test(verdict.fix), verdict.fix);
});

test('the rotation block reaches the treatment gate, not just the warning screen', () => {
  const state = planted(day(-30), {
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'anthracnose', date: day(-1), confirmedBy: 'u_mgr' }],
    sprays: sprayed([{ activeId: 'mancozeb', date: day(-12) }]),
  });
  const verdict = canTreat(state, 'c1', { today: TODAY, activeId: 'mancozeb' });

  assert.equal(verdict.ok, false, 'a confirmed diagnosis does not excuse breaking rotation');
  assert.equal(verdict.reason, 'rotation');
});

// --- FR-GATE-05: the thrips programme ------------------------------------

test('thrips rotation is its own series, so an unrelated spray does not reset it', () => {
  const state = planted(day(-30), {
    sprays: sprayed([
      { activeId: 'spinosad', date: day(-14), target: 'thrips' },
      { activeId: 'cypermethrin', date: day(-7), target: 'general insects' },
    ]),
  });
  const verdict = rotationCheck(state, 'c1', 'spinosad', { today: TODAY, target: 'thrips' });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.ok(verdict.alternatives.some((a) => /IRAC 28/.test(a)),
    `the other thrips groups are offered: ${verdict.alternatives.join('; ')}`);
});

test('the next group in the thrips programme is allowed', () => {
  const state = planted(day(-30), {
    sprays: sprayed([{ activeId: 'spinosad', date: day(-14), target: 'thrips' }]),
  });
  assert.equal(
    rotationCheck(state, 'c1', 'chlorantraniliprole', { today: TODAY, target: 'thrips' }).ok, true,
  );
});

// --- FR-GATE-05: the Week 10 rule (SR-08) --------------------------------

test('week 10 is counted from transplant, not from the calendar', () => {
  // Build Rules §11a: T is Day 1 of Week 0, so Week 10 opens 70 days later.
  const state = planted(day(-69));
  assert.equal(cropWeek(state, 'c1', TODAY), 9);
  assert.equal(cropWeek(planted(day(-70)), 'c1', TODAY), 10);
});

test('from Week 10 a synthetic cannot be selected at all', () => {
  const verdict = rotationCheck(planted(day(-80)), 'c1', 'mancozeb', { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'week-10');
  assert.ok(verdict.alternatives.includes('copper hydroxide'), verdict.alternatives.join(', '));
});

test('from Week 10 Copper Hydroxide may repeat, and it is the only thing that may', () => {
  const state = planted(day(-80), {
    sprays: sprayed([{ activeId: 'copper-hydroxide', date: day(-12) }]),
  });
  assert.equal(rotationCheck(state, 'c1', 'copper-hydroxide', { today: TODAY }).ok, true,
    'the one exception to "never the same FRAC group twice"');

  const oxychloride = rotationCheck(state, 'c1', 'copper-oxychloride', { today: TODAY });
  assert.equal(oxychloride.ok, false, 'the other M1 copper is still a synthetic with a 14-day PHI');
  assert.equal(oxychloride.reason, 'week-10');
});

test('Metalaxyl-M stops at Week 10 even when the rotation would allow it', () => {
  const verdict = rotationCheck(planted(day(-80)), 'c1', 'metalaxyl-m-mancozeb', { today: TODAY });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason === 'week-10' || verdict.reason === 'metalaxyl', verdict.reason);
});

test('neem and garlic-chilli keep working from Week 10, and may repeat', () => {
  const state = planted(day(-80), {
    sprays: sprayed([{ activeId: 'azadirachtin-neem-oil', date: day(-6) }]),
  });
  assert.equal(rotationCheck(state, 'c1', 'azadirachtin-neem-oil', { today: TODAY }).ok, true,
    'SR-08 requires the organics repeatedly; they carry no rotatable resistance group');
  assert.equal(rotationCheck(state, 'c1', 'garlic-chilli-extract-farm-made', { today: TODAY }).ok, true);
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
