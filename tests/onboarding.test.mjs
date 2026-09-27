// Mid-season onboarding — FR-ONB-01 to FR-ONB-08.
//
// The farm starts using the app with crops already in the ground. These tests
// set a zone up the way the Setup screen does — events through the reducer —
// and check the four things that make that safe:
//
//   * the week and the schedule come from the transplant date (FR-ONB-02);
//   * backfilled sprays are read by the rotation gate and the PHI (FR-ONB-04);
//   * no spray history means no spray and no harvest, with a message that
//     says the history is missing (FR-ONB-05);
//   * a zone planted before the app is "planted before the gates", not a
//     violation, and Gate 4 at the end of the cycle clears normally (FR-ONB-06).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
await loadRules();
const { reduce, inputUsage } = await import(new URL('store.js', base).href);
const { canPlant, canTreat, gateModel, GATE_STATE, isBlocking } = await import(new URL('domain/gates.js', base).href);
const { cropWeek, rotationVerdict } = await import(new URL('domain/rotation.js', base).href);
const { buildCatalogue, resolveActive } = await import(new URL('domain/catalogue.js', base).href);
const { kpis } = await import(new URL('domain/alerts.js', base).href);
const onb = await import(new URL('domain/onboarding.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-24';
const day = (n, from = TODAY) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const noon = (date = TODAY) => new Date(`${date}T12:00:00`);

let seq = 0;
const ev = (type, payload, by = 'u_owner', at = `${TODAY}T08:00:00.000Z`) => ({
  id: `ev_${++seq}`, type, payload, by, at, device: 'test',
});

const PEOPLE = [
  ev('person.upsert', { id: 'u_owner', name: 'Owner', role: 'ceo' }, 'system', '2026-01-01T00:00:00.000Z'),
  ev('person.upsert', { id: 'u_mgr', name: 'Manager', role: 'manager' }, 'system', '2026-01-01T00:00:01.000Z'),
  ev('person.upsert', { id: 'u_hand', name: 'Hand', role: 'hand' }, 'system', '2026-01-01T00:00:02.000Z'),
  ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }, 'u_owner', '2026-01-01T00:00:03.000Z'),
];

/** GH-01 set up on TODAY with bell pepper transplanted six weeks ago. */
const ONBOARD = (o = {}) => ev('cycle.onboard', {
  id: 'c1', plotId: 'gh1', media: 'bed', cropId: 'bell', variety: 'Nikita F1',
  transplantDate: day(-42), plants: 900, setupDate: TODAY, ...o,
});
const bf = (payload, at) => ev('backfill.record', { id: `bf_${++seq}`, cycleId: 'c1', zoneId: 'gh1', ...payload }, 'u_owner', at);
const DECLARE_ALL_BUT = (skip = []) => ['no-insecticide', 'no-fungicide', 'recent-complete']
  .filter((item) => !skip.includes(item)).map((item) => bf({ kind: 'declare', item, date: TODAY }));

/** A confirmed diagnosis, so the only thing a treatment can be refused on is what the test is about. */
function diagnosed(state, problemId = 'thrips') {
  state.diagnoses.push({ id: 'd1', cycleId: 'c1', date: TODAY, problemId, problemName: problemId, confirmedBy: 'u_mgr' });
  return state;
}

const active = (name) => resolveActive(buildCatalogue({}), name);

// --- FR-ONB-02: everything derives from the transplant date ------------------

test('FR-ONB-02: week numbers derive correctly from a transplant date 6 weeks in the past', () => {
  const state = reduce([...PEOPLE, ONBOARD()]);
  const cycle = state.cycles.c1;
  assert.equal(cycle.status, 'active');
  assert.equal(cycle.transplantDate, day(-42));

  // Rules → week_counting: T is Day 1 of Week 0, week = floor((date - T) / 7).
  assert.equal(cropWeek(cycle, TODAY), 6);
  assert.deepEqual(onb.cropDay(cycle.transplantDate, TODAY), { days: 42, week: 6, dayOfWeek: 1 });
  assert.equal(cropWeek(cycle, day(-1)), 5, 'the day before is the last day of Week 5');
  assert.equal(cropWeek(cycle, day(6)), 6, 'six days on is still Week 6');
  assert.equal(cropWeek(cycle, day(7)), 7);
});

test('FR-ONB-02: the task schedule runs from this week onward, in the crop\'s own rhythm', () => {
  const state = reduce([...PEOPLE, ONBOARD()]);
  const next = onb.scheduleFrom(state, 'c1', { from: TODAY, days: 14 });
  assert.ok(next.length, 'a crop in Week 6 has work this fortnight');
  assert.ok(next.every((t) => t.date >= TODAY), 'nothing is scheduled before the day of setup');
  assert.ok(next.every((t) => t.cycleId === 'c1' && t.zoneId === 'gh1'));

  // Scouting runs every 3 days from day 7 after transplant; feeding every 7
  // from day 14. Day 42 is a feeding day; the next scouting day is day 43.
  const scouts = next.filter((t) => t.kind === 'scout').map((t) => t.date);
  assert.deepEqual(scouts, [1, 4, 7, 10, 13].map((n) => day(n)));
  const feeds = next.filter((t) => t.kind === 'fertigate').map((t) => t.date);
  assert.deepEqual(feeds, [day(0), day(7)]);
  // Pruning (day 28 to 120, every 14): day 42 is one.
  assert.ok(next.some((t) => t.kind === 'prune' && t.date === TODAY));
});

// --- FR-ONB-05: no spray history, no spray and no harvest ----------------------

test('FR-ONB-05: a zone with no spray history blocks a spray', () => {
  const state = diagnosed(reduce([...PEOPLE, ONBOARD()]));
  const spinosad = active('Spinosad');
  const verdict = canTreat(state, 'c1', { today: TODAY, activeId: spinosad.id });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'spray-history-missing');
  assert.match(verdict.why, /spray history for this zone is missing/i);
  assert.match(verdict.why, /last insecticide/i);

  // The Farm Doctor's plan check and the spray screen's hint go through the
  // rotation verdict, so it refuses the same way — even for neem, which has
  // no rotation group: the history is missing, not the group.
  assert.equal(rotationVerdict(state, 'c1', spinosad.id, { today: TODAY }).reason, 'spray-history-missing');
  assert.equal(rotationVerdict(state, 'c1', active('Azadirachtin').id, { today: TODAY }).reason, 'spray-history-missing');
});

test('FR-ONB-05: a zone with no spray history blocks a harvest', () => {
  const state = reduce([...PEOPLE, ONBOARD()]);
  const check = onb.harvestCheck(state, 'c1', noon());
  assert.equal(check.safe, false);
  assert.equal(check.historyMissing, true);
  assert.match(check.reason, /spray history for this zone is missing/i);
});

test('FR-ONB-05: part of the history is still missing history', () => {
  const state = diagnosed(reduce([...PEOPLE, ONBOARD(), ...DECLARE_ALL_BUT(['recent-complete'])]));
  assert.equal(onb.harvestCheck(state, 'c1', noon()).safe, false);
  const verdict = canTreat(state, 'c1', { today: TODAY, activeId: active('Spinosad').id });
  assert.equal(verdict.reason, 'spray-history-missing');
  assert.match(verdict.why, /last 21 days/);
  assert.doesNotMatch(verdict.why, /last insecticide/i, 'only what is actually missing is named');
});

test('FR-ONB-05: once the history is on record, the zone is judged like any other', () => {
  const state = diagnosed(reduce([...PEOPLE, ONBOARD(), ...DECLARE_ALL_BUT()]));
  assert.equal(onb.harvestCheck(state, 'c1', noon()).safe, true);
  assert.equal(canTreat(state, 'c1', { today: TODAY, activeId: active('Spinosad').id }).ok, true);
});

test('FR-ONB-05: a crop started in the app is not asked for a history it already has', () => {
  const state = diagnosed(reduce([...PEOPLE,
    ev('cycle.start', { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-42) })]));
  assert.equal(onb.harvestCheck(state, 'c1', noon()).safe, true);
  assert.equal(canTreat(state, 'c1', { today: TODAY, activeId: active('Spinosad').id }).ok, true);
});

// --- FR-ONB-04: the rotation and the PHI read backfilled sprays ---------------

test('FR-ONB-04: a backfilled IRAC 5 spray blocks another IRAC 5', () => {
  const state = diagnosed(reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'insecticide', activeId: active('Spinetoram').id, date: day(-10) }),
    ...DECLARE_ALL_BUT(['no-insecticide'])]));
  assert.equal(state.sprays.length, 0, 'the backfilled spray is not a live record');

  const spinosad = active('Spinosad');
  assert.equal(spinosad.group, 'IRAC 5');
  const verdict = canTreat(state, 'c1', { today: TODAY, activeId: spinosad.id });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.equal(verdict.lastSpray.backfilled, true);
  assert.equal(verdict.lastSpray.date, day(-10));
  assert.match(verdict.why, /IRAC 5/);

  // A different group in the thrips programme goes through.
  assert.equal(canTreat(state, 'c1', { today: TODAY, activeId: active('Chlorantraniliprole').id }).ok, true);
});

test('FR-ONB-04: a backfilled group entered by hand counts too, and live sprays after it are read in order', () => {
  // A container the catalogue does not know, entered with its group off the label.
  const state = diagnosed(reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'insecticide', productName: 'Tracer-X', group: 'IRAC 5', date: day(-12) }),
    ...DECLARE_ALL_BUT(['no-insecticide'])]));
  assert.equal(canTreat(state, 'c1', { today: TODAY, activeId: active('Spinosad').id }).reason, 'rotation');

  // A live IRAC 28 spray after it is now the last one: IRAC 5 is fine again.
  state.sprays.push({ id: 's1', cycleId: 'c1', activeId: active('Chlorantraniliprole').id, date: day(-3), diagnosisId: 'd1' });
  assert.equal(canTreat(state, 'c1', { today: TODAY, activeId: active('Spinosad').id }).ok, true);
});

test('FR-ONB-04: a backfilled spray 5 days ago blocks harvest at a 14-day PHI', () => {
  const state = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'insecticide', activeId: active('Spinosad').id, date: day(-5), phiDays: 14 }),
    ...DECLARE_ALL_BUT(['no-insecticide'])]);
  const check = onb.harvestCheck(state, 'c1', noon());
  assert.equal(check.safe, false);
  assert.equal(check.clearOn, day(9));
  assert.equal(check.daysLeft, 9);
  assert.equal(check.blocker.application.backfilled, true);
  assert.equal(onb.harvestCheck(state, 'c1', noon(day(9))).safe, true, 'clear on day 14 after the spray');
  // Re-entry runs from the day it was sprayed, not the day it was typed in.
  assert.equal(onb.reentryCheck(state, 'c1', noon()).safe, true);
});

test('FR-ONB-04: a backfilled spray with no waiting period entered takes the default, never a shorter one', () => {
  // Spinosad's default in the rules is 14 days; a label figure of 3 does not shorten it (FR-STOCK-07).
  const short = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'recent', activeId: active('Spinosad').id, date: day(-5), phiDays: 3 }),
    ...DECLARE_ALL_BUT()]);
  assert.equal(onb.harvestCheck(short, 'c1', noon()).clearOn, day(9));
  // A product nobody can name to the catalogue gets the 14-day synthetic default, not zero.
  const unknown = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'recent', productName: 'Unlabelled bottle', date: day(-5) }),
    ...DECLARE_ALL_BUT()]);
  assert.equal(onb.harvestCheck(unknown, 'c1', noon()).clearOn, day(9));
});

// --- FR-ONB-06: planted before the gates ------------------------------------------

test('FR-ONB-06: a zone planted before the app is "planted before the gates", with its evidence, and no override', () => {
  const state = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'evidence', gate: 'G0', what: 'nematode assay, clean', lab: 'Rivers Soil Lab', date: day(-50) })]);
  const model = gateModel(state, 'gh1', { today: TODAY });
  assert.equal(model.preGates.label, 'Planted before the gates');
  assert.equal(model.preGates.evidence.length, 1);

  const g0 = model.gates.find((g) => g.id === 'G0');
  assert.equal(g0.state, onb.PRE_GATES);
  assert.equal(GATE_STATE[g0.state].label, 'Planted before the gates');
  assert.ok(g0.conditions.every((c) => c.state === onb.PRE_GATES || c.state === 'pass'));
  assert.ok(g0.conditions.some((c) => c.found), 'each condition still says what it found');
  assert.equal(g0.conditions.find((c) => c.state === onb.PRE_GATES).evidence[0].what, 'nematode assay, clean');
  assert.equal(model.gates.find((g) => g.id === 'G1').state, onb.PRE_GATES);

  // Not a violation: nothing blocks, nothing is overridden, KPI-04 stays at 0.
  const verdict = canPlant(state, 'gh1', { today: TODAY });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.overridden.length, 0);
  assert.equal(model.gates.filter((g) => g.blocksTransplant).flatMap((g) => g.conditions).filter(isBlocking).length, 0);
  // Gate 2 is not a transplant gate: it runs live from today, and no trap
  // count is logged yet, so it says so.
  assert.equal(model.gates.find((g) => g.id === 'G2').conditions.find((c) => c.id === 'g2_scouting').state, 'fail');
  assert.equal(state.gateOverrides.length, 0);
  assert.equal(kpis(state, { now: `${TODAY}T12:00:00.000Z` }).find((k) => k.id === 'KPI-04').value, 0);

  // Gate 4 waits for the end of this cycle.
  assert.ok(model.gates.find((g) => g.id === 'G4').conditions.every((c) => c.state === 'waiting'));
});

test('FR-ONB-06: backfilled sprays are not ungated treatments (G3, KPI-03)', () => {
  const state = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'insecticide', activeId: active('Spinosad').id, date: day(-8) }),
    ...DECLARE_ALL_BUT(['no-insecticide'])]);
  const g3 = gateModel(state, 'gh1', { today: TODAY }).gates.find((g) => g.id === 'G3');
  assert.equal(g3.conditions[0].state, 'pass');
  assert.equal(kpis(state, { now: `${TODAY}T12:00:00.000Z` }).find((k) => k.id === 'KPI-03').value, 0);
});

test('FR-ONB-06: Gate 4 at the end of this cycle clears normally', () => {
  const close = ev('cycle.close', { id: 'c1', date: day(60) }, 'u_mgr', `${day(60)}T10:00:00.000Z`);
  const state = reduce([...PEOPLE, ONBOARD(), close]);
  const later = day(61);
  const g4 = gateModel(state, 'gh1', { today: later }).gates.find((g) => g.id === 'G4');
  assert.equal(g4.blocksTransplant, true, 'the closed cycle has to pass Gate 4 before the next goes in');
  assert.equal(g4.subject.cycleId, 'c1');
  assert.ok(g4.conditions.every((c) => c.state !== onb.PRE_GATES), 'the status ends with the cycle');
  assert.ok(g4.conditions.some(isBlocking), 'nothing recorded yet, so it blocks like any Gate 4');

  // Record every Gate 4 line and the signed-off review: it clears.
  const lines = g4.conditions.filter((c) => c.id !== 'g4_signoff').map((c) => c.itemId || c.id);
  state.gateEvidence.push(...lines.map((itemId) => ({
    id: `g4_${itemId}`, gate: 'G4', itemId, zoneId: 'gh1', cycleId: 'c1', date: day(60), note: 'done',
    photo: { dataUrl: 'data:image/jpeg;base64,x' },
  })));
  state.doctorOutputs.push({ id: 'rev', kind: 'cycle-review', subject: { cycleId: 'c1' }, at: `${day(60)}T12:00:00.000Z`,
    confirmedBy: 'u_mgr', approvedBy: 'u_owner' });
  const cleared = gateModel(state, 'gh1', { today: later }).gates.find((g) => g.id === 'G4');
  assert.equal(cleared.state, 'pass', cleared.conditions.filter(isBlocking).map((c) => `${c.id}: ${c.why}`).join('; '));
});

// --- FR-ONB-03: backfilled entries are marked and kept apart -----------------

test('FR-ONB-03: backfilled entries are marked backfilled and kept out of the live records', () => {
  const state = reduce([...PEOPLE, ONBOARD(),
    bf({ kind: 'spray', slot: 'fungicide', activeId: active('Mancozeb').id, date: day(-9) }),
    bf({ kind: 'harvest', kg: 180, date: TODAY }),
    bf({ kind: 'evidence', gate: 'G1', what: 'traps installed', date: day(-43) }),
    ev('backfill.record', { id: 'bf_stock', kind: 'stock', itemId: 'in_spin', name: 'Spinosad 45SC', unit: 'litre', qty: 2.5, date: TODAY }),
  ]);
  assert.ok(state.backfills.length === 4 && state.backfills.every((b) => b.backfilled === true));
  assert.equal(state.sprays.length, 0);
  assert.equal(state.harvests.length, 0);
  assert.equal(state.gateEvidence.length, 0);

  // Harvest to date is on the cycle, under its own name as well.
  assert.equal(state.cycles.c1.backfilledKg, 180);
  assert.equal(state.cycles.c1.harvestedKg, 180);

  // Stock is an opening count: the shelf holds 2.5, and it is not usage.
  assert.equal(state.inputs.in_spin.qty, 2.5);
  assert.equal(state.stockMoves[0].direction, 'opening');
  assert.equal(state.stockMoves[0].backfilled, true);
  assert.equal(inputUsage(state).length, 0);
});

test('FR-ONB-01: only the Farm Manager or Owner sets up a growing crop, and only one planted before setup day', () => {
  const byHand = reduce([...PEOPLE, { ...ONBOARD(), by: 'u_hand' }]);
  assert.equal(byHand.cycles.c1, undefined);
  assert.match(byHand.onboardRefused[0].why, /Farm Manager or the Owner/);

  const today = reduce([...PEOPLE, ONBOARD({ transplantDate: TODAY })]);
  assert.equal(today.cycles.c1, undefined, 'a crop planted today goes through the gates');

  const future = reduce([...PEOPLE, ONBOARD({ transplantDate: TODAY, setupDate: day(5) })]);
  assert.equal(future.cycles.c1, undefined, 'a setup day in the future does not open the door');

  const twice = reduce([...PEOPLE, ONBOARD(), ONBOARD({ id: 'c2' })]);
  assert.equal(twice.cycles.c2, undefined, 'one crop per zone');

  // The server says the same.
  assert.equal(core.EVENT_POLICY['cycle.onboard'].write, 'settings');
  assert.equal(core.EVENT_POLICY['backfill.record'].write, 'settings');
  assert.equal(core.mayWrite(ONBOARD(), { role: 'hand' }).ok, false);
  assert.equal(core.mayWrite(ONBOARD(), { role: 'manager' }).ok, true);
  assert.equal(core.mayWrite(ONBOARD({ transplantDate: TODAY }), { role: 'ceo' }).ok, false);
  assert.equal(core.mayWrite(ONBOARD({ transplantDate: TODAY, setupDate: day(5) }), { role: 'ceo' }).ok, false);
  assert.equal(core.mayWrite(bf({ kind: 'spray', activeId: 'spinosad' }), { role: 'ceo' }).ok, false, 'a spray needs its date');
});

// --- FR-ONB-08: the Owner's setup screen ------------------------------------------

test('FR-ONB-08: the setup screen lists the incomplete zones and what each is missing', () => {
  const events = [...PEOPLE,
    ev('plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }, 'u_owner', '2026-01-01T00:00:04.000Z'),
    ev('plot.upsert', { id: 'gh3', name: 'GH-03', type: 'greenhouse' }, 'u_owner', '2026-01-01T00:00:05.000Z'),
    ev('plot.upsert', { id: 'nur', name: 'OF-02', type: 'nursery' }, 'u_owner', '2026-01-01T00:00:06.000Z'),
    ONBOARD({ variety: '' }),
    bf({ kind: 'spray', slot: 'insecticide', activeId: active('Spinosad').id, date: day(-6) }),
    ev('backfill.record', { id: 'bf_empty', kind: 'declare', item: 'zone-empty', zoneId: 'gh3', date: TODAY }),
  ];
  const status = onb.setupStatus(reduce(events), { today: TODAY });
  assert.deepEqual(status.rows.map((r) => r.zone.name), ['GH-01', 'GH-02', 'GH-03'], 'the nursery is not a cropping zone');

  const gh1 = status.rows.find((r) => r.zone.id === 'gh1');
  assert.equal(gh1.complete, false);
  assert.equal(gh1.week, 6);
  assert.deepEqual(gh1.missing.map((m) => m.id), ['variety', 'spray-fungicide', 'spray-recent', 'harvest']);

  const gh2 = status.rows.find((r) => r.zone.id === 'gh2');
  assert.equal(gh2.status, 'not-set-up');
  assert.match(gh2.missing[0].label, /media type, crop, variety and transplant date/);

  assert.equal(status.rows.find((r) => r.zone.id === 'gh3').complete, true, 'recorded empty');
  assert.equal(status.farm.complete, false, 'stock on hand not counted yet');
  assert.deepEqual(status.incomplete.map((r) => r.zone.id), ['gh1', 'gh2']);
  assert.equal(status.complete, false);

  // Finish GH-01, set up GH-02, count the store: complete.
  const done = onb.setupStatus(reduce([...events,
    ev('cycle.update', { id: 'c1', variety: 'Nikita F1' }),
    bf({ kind: 'declare', item: 'no-fungicide' }), bf({ kind: 'declare', item: 'recent-complete' }),
    bf({ kind: 'harvest', kg: 0 }),
    ev('cycle.onboard', { id: 'c2', plotId: 'gh2', media: 'bag', cropId: 'habanero', variety: 'Scotch Bonnet',
      transplantDate: day(-20), setupDate: TODAY }),
    ...['no-insecticide', 'no-fungicide', 'recent-complete'].map((item) =>
      ev('backfill.record', { id: `d_${item}`, kind: 'declare', item, cycleId: 'c2', zoneId: 'gh2' })),
    ev('backfill.record', { id: 'h2', kind: 'harvest', kg: 0, cycleId: 'c2', zoneId: 'gh2' }),
    ev('backfill.record', { id: 's1', kind: 'stock', itemId: 'in1', name: 'Neem oil', qty: 4 }),
  ]), { today: TODAY });
  assert.equal(done.complete, true, JSON.stringify(done.incomplete.map((r) => [r.zone.id, r.missing])));
});
