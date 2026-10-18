// Each person is sent only what concerns them — FR-ROLE-03, and the Owner's
// decision of 18 October 2026: "Each person should only see what concerns
// them based on the login they have."
//
// Withholding records from a phone is only safe if the phone still works on
// what it is sent. So the test that matters most here rebuilds each hand's
// phone from exactly what the server would send them, and checks it shows the
// same day's work and the same picking and re-entry blocks as a phone that
// holds everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleState } from './helpers/sample-state.mjs';

const core = await import('../server/core.mjs');
const { myWork, zoneHolders, zonesHeldBy } = await import('../web/js/domain/assignments.js');
const { harvestCheck, reentryCheck } = await import('../web/js/domain/onboarding.js');
const { isoDate } = await import('../web/js/util.js');

const { events: sample, reduce } = await sampleState();
const now = new Date().toISOString();
const today = isoDate();

// Records the sample does not have: a hand's sick-plant report diagnosed and
// confirmed (FR-DIAG-10), another's report, store costs, the Farm Doctor.
const extra = [
  { id: 'x1', type: 'report.record', by: 'sp_emeka', at: now,
    payload: { id: 'rep_emeka', kind: 'sick-plant', zoneId: 'sp_b4', where: ['top_leaves'], howMany: 'few', photos: [{ dataUrl: 'data:image/jpeg;base64,AA' }] } },
  { id: 'x2', type: 'diagnosis.record', by: 'sp_tamuno', at: now, payload: { id: 'dx_emeka', reportId: 'rep_emeka', cardId: 'thrips' } },
  { id: 'x3', type: 'diagnosis.confirm', by: 'sp_ada', at: now, payload: { id: 'dx_emeka', confirmTest: 'loupe', confirmResult: 'thrips seen' } },
  { id: 'x4', type: 'report.record', by: 'sp_blessing', at: now, payload: { id: 'rep_blessing', note: 'drip line blocked in house 3' } },
  { id: 'x5', type: 'input.receive', by: 'sp_ada', at: now, payload: { id: 'mv1', itemId: Object.values(reduce(sample).inputs)[0].id, qty: 5, unitCost: 4200 } },
  { id: 'x6', type: 'doctor.record', by: 'sp_tamuno', at: now, payload: { id: 'doc1', kind: 'plan' } },
];
const events = [...sample, ...extra];

function sentTo(personId, role) {
  const facts = core.emptyScopeFacts();
  for (const e of events) core.foldScopeFact(facts, e);
  const reader = { id: personId, role };
  const scope = core.readScope(facts, reader);
  return events.map((e) => core.visibleTo(e, reader, scope)).filter(Boolean);
}

const full = reduce(events);
const hands = ['sp_emeka', 'sp_blessing'];

for (const hand of hands) {
  const mine = sentTo(hand, 'hand');
  const phone = reduce(mine);

  test(`${hand}'s phone shows the same day's work as a phone holding everything`, () => {
    const shape = (w) => ({
      tasks: w.tasks.map((t) => [t.task.id, t.task.status, t.covering]).sort(),
      progress: w.progress.text,
      zones: w.zones.map((z) => [z.zone.id, z.holding]),
    });
    assert.deepEqual(shape(myWork(phone, hand, { date: today })), shape(myWork(full, hand, { date: today })));
    assert.ok(myWork(full, hand, { date: today }).zones.length > 0, 'the hand does hold zones');
  });

  test(`${hand}'s phone blocks the same beds for picking and re-entry`, () => {
    const cycles = Object.values(full.cycles).filter((c) => c.status !== 'closed');
    assert.ok(cycles.length > 1);
    for (const c of cycles) {
      const a = harvestCheck(full, c.id, new Date());
      const b = harvestCheck(phone, c.id, new Date());
      assert.equal(b.safe, a.safe, `picking ${c.id}`);
      assert.equal(b.clearOn || null, a.clearOn || null, `waiting period on ${c.id}`);
      assert.equal(reentryCheck(phone, c.id, new Date()).safe, reentryCheck(full, c.id, new Date()).safe, `re-entry ${c.id}`);
    }
  });

  test(`${hand} is not sent anybody else's harvests, hours, shift reports or problem reports`, () => {
    for (const type of ['harvest.record', 'work.log', 'shift.record', 'report.record']) {
      const others = mine.filter((e) => e.type === type && e.by !== hand);
      assert.deepEqual(others.map((e) => e.id), [], `${type} of others`);
    }
    const own = events.filter((e) => e.by === hand);
    for (const e of own) assert.ok(mine.some((m) => m.id === e.id), `own ${e.type} ${e.id} is sent back`);
  });

  test(`${hand} is not sent money, rates, the store, or the Farm Doctor's working`, () => {
    const types = new Set(mine.map((e) => e.type));
    for (const t of ['sale.record', 'expense.record', 'rate.set', 'input.upsert', 'input.receive', 'input.issue', 'doctor.record']) {
      assert.ok(!types.has(t), `${t} withheld`);
    }
  });

  test(`${hand} gets attendance only for people who share their zones`, () => {
    const sharing = new Set([hand]);
    for (const { zone } of zonesHeldBy(full, hand)) {
      const h = zoneHolders(full, zone.id);
      for (const x of [...h.primary, ...h.backup]) sharing.add(x.person.id);
    }
    const att = mine.filter((e) => e.type.startsWith('attendance.'));
    const people = new Set(att.map((e) => e.payload.personId || e.by));
    assert.ok(people.has(hand));
    for (const p of people) assert.ok(sharing.has(p), `${p} shares a zone with ${hand}`);
    const outside = Object.keys(full.people).filter((p) => !sharing.has(p));
    assert.ok(outside.length, 'somebody on the farm shares none of their zones');
    for (const p of outside) assert.ok(!people.has(p), `${p}'s hours withheld`);
  });
}

test("a hand sees the confirmed answer to their own report (FR-DIAG-10), and not another's report", () => {
  const ids = sentTo('sp_emeka', 'hand').map((e) => e.id);
  for (const id of ['x1', 'x2', 'x3']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('x4'), "Blessing's report stays with Blessing and the people who run the work");
  assert.ok(!sentTo('sp_blessing', 'hand').map((e) => e.id).includes('x2'), "and Emeka's diagnosis is not Blessing's");
});

test('a supervisor gets the team\'s work, including the shift board, but no money or stock costs', () => {
  const got = sentTo('sp_tamuno', 'supervisor');
  const types = new Set(got.map((e) => e.type));
  for (const t of ['harvest.record', 'shift.record', 'shift.comment', 'work.log', 'report.record', 'attendance.in']) {
    assert.ok(types.has(t), `${t} reaches the supervisor`);
  }
  for (const t of ['sale.record', 'expense.record', 'rate.set']) assert.ok(!types.has(t), `${t} withheld`);
  const receipt = got.find((e) => e.id === 'x5');
  assert.ok(receipt, 'the stock movement reaches them');
  assert.equal(receipt.payload.unitCost, undefined, 'without what it cost (FR-SIMP-04)');
  assert.equal(receipt.payload.qty, 5);
});

test('the Farm Manager and the Owner are sent everything their role allows, costs included', () => {
  const manager = sentTo('sp_ada', 'manager');
  assert.equal(manager.find((e) => e.id === 'x5').payload.unitCost, 4200);
  assert.ok(manager.some((e) => e.type === 'sale.record'));
  assert.ok(!manager.some((e) => e.type === 'rate.set'), 'rates stay the Owner\'s');
  const owner = sentTo('sp_owner', 'ceo');
  assert.equal(owner.length, events.length);
});

test('a hand given a new zone is sent that zone\'s work from then on', () => {
  const facts = core.emptyScopeFacts();
  for (const e of events) core.foldScopeFact(facts, e);
  const reader = { id: 'sp_emeka', role: 'hand' };
  const task = events.find((e) => e.type === 'task.create' && e.payload.zoneId === 'sp_b2');
  assert.ok(task, 'a task in a zone Emeka does not hold');
  assert.equal(core.visibleTo(task, reader, core.readScope(facts, reader)), null);
  core.foldScopeFact(facts, { id: 'za', type: 'zone.assign', by: 'sp_ada', at: now,
    payload: { id: 'as_new', zoneId: 'sp_b2', personId: 'sp_emeka', holding: 'primary' } });
  assert.ok(core.visibleTo(task, reader, core.readScope(facts, reader)), 'once the zone is theirs');
});
