// Field assignments — requirements §4.1, FR-ROLE-05 to FR-ROLE-11.
//
// The claims under test, one block per requirement:
//   05  anyone, in any role, can hold a zone and gets that zone's day;
//   06  the Farm Manager assigns by name (himself included), the Field
//       Supervisor only when covering — on the screen, on replay, on the server;
//   07  many people per zone, many zones per person, primary before backup;
//   08  My work and The farm for supervising roles, My work only for a hand;
//   09  their own tasks keep the photo rule, the late rule and the shift report;
//   10  late work skips the rung its own holder stands on;
//   11  the week's work, spread across people.
//
// Every date here is pinned and every clock is passed in, so the suite reads
// the same with the clock moved forward (scripts/test-clock-offsets.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const A = await import(new URL('domain/assignments.js', base).href);
const { tasksFor } = await import(new URL('domain/schedule.js', base).href);
const { canComplete } = await import(new URL('domain/proof.js', base).href);
const { shiftBoard } = await import(new URL('domain/shift.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const farmUi = await import(new URL('ui/farm.js', base).href);

// A Wednesday. Local times throughout, because attendance is judged in farm time.
const TODAY = '2026-09-16';
const day = (n) => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const at = (h, date = TODAY) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`);
const iso = (h, date = TODAY) => at(h, date).toISOString();

const PEOPLE = {
  u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' },
  u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' },
  u_sup: { id: 'u_sup', name: 'Tamuno George', role: 'supervisor' },
  u_emeka: { id: 'u_emeka', name: 'Emeka Okoro', role: 'hand' },
  u_blessing: { id: 'u_blessing', name: 'Blessing Amadi', role: 'hand' },
};

function farm({ assignments = [], people = PEOPLE, tasks = {}, attendance = [], absences = [], positions = {} } = {}) {
  const state = {
    settings: { farmName: 'DouValue Farms Limited' },
    people: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, { active: true, ...v }])),
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },
      gh2: { id: 'gh2', name: 'GH-02', type: 'greenhouse' },
      gh3: { id: 'gh3', name: 'GH-03', type: 'greenhouse' },
    },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-30), status: 'active' },
      c2: { id: 'c2', plotId: 'gh2', cropId: 'bell', transplantDate: day(-30), status: 'active' },
      c3: { id: 'c3', plotId: 'gh3', cropId: 'bell', transplantDate: day(-30), status: 'active' },
    },
    positions,
    assignments: Object.fromEntries(assignments.map(([personId, zoneId, holding = 'primary'], i) =>
      [`as${i}`, { id: `as${i}`, personId, zoneId, holding, at: iso(6, day(-10)) }])),
    tasks,
    attendance,
    absences,
    shifts: [],
  };
  return state;
}

/** Put a day's generated schedule on the log, as generateToday does. */
function withDay(state, date = TODAY) {
  for (const t of tasksFor(state, { date })) state.tasks[t.id] = { ...t, status: 'open' };
  return state;
}

const ids = (list) => list.map((p) => p.id).sort();
const here = (personId, date = TODAY, h = 7) => ({ personId, in: iso(h, date) });

// --- FR-ROLE-05: any role can hold a zone, and gets its day -----------------

test('FR-ROLE-05: a person in every role can hold a zone and gets a daily list for it', () => {
  for (const personId of Object.keys(PEOPLE)) {
    const state = withDay(farm({ assignments: [[personId, 'gh1']] }));
    const work = A.myWork(state, personId, { date: TODAY, now: at(7) });
    assert.ok(work.tasks.length, `${PEOPLE[personId].role} has GH-01's day on My work`);
    assert.ok(work.tasks.every(({ task }) => task.zoneId === 'gh1'), 'and only GH-01\'s');
    assert.deepEqual(work.zones.map((z) => z.zone.id), ['gh1']);
  }
});

test('FR-ROLE-05: My work shows nobody else\'s zones', () => {
  const state = withDay(farm({ assignments: [['u_mgr', 'gh1'], ['u_emeka', 'gh2']] }));
  const mgr = A.myWork(state, 'u_mgr', { date: TODAY, now: at(7) });
  const emeka = A.myWork(state, 'u_emeka', { date: TODAY, now: at(7) });
  assert.ok(mgr.tasks.every(({ task }) => task.zoneId === 'gh1'));
  assert.ok(emeka.tasks.every(({ task }) => task.zoneId === 'gh2'));
  assert.match(mgr.progress.text, /^0 of \d+ done$/);
});

// --- FR-ROLE-06: who hands out zones ----------------------------------------

test('FR-ROLE-06: the Farm Manager and the Owner may assign; a hand may not', () => {
  const state = farm();
  const opts = { today: TODAY, now: at(10) };
  assert.equal(A.mayAssignZones(state, PEOPLE.u_mgr, opts).ok, true);
  assert.equal(A.mayAssignZones(state, PEOPLE.u_owner, opts).ok, true);
  assert.equal(A.mayAssignZones(state, PEOPLE.u_emeka, opts).ok, false);
});

test('FR-ROLE-06: the Farm Manager can assign a zone to himself, by name', () => {
  const state = farm();
  const verdict = A.checkAssignment(state, { personId: 'u_mgr', zoneId: 'gh3', holding: 'primary' },
    PEOPLE.u_mgr, { today: TODAY, now: at(10) });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.person.name, 'Ada Briggs');
});

test('FR-ROLE-06: the Field Supervisor assigns only when covering for the Farm Manager', () => {
  const inToday = farm({ attendance: [here('u_mgr')] });
  const refused = A.mayAssignZones(inToday, PEOPLE.u_sup, { today: TODAY, now: at(10) });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /Ada Briggs is in today/);

  const declared = farm({ absences: [{ id: 'ab1', personId: 'u_mgr', date: TODAY }] });
  const covering = A.mayAssignZones(declared, PEOPLE.u_sup, { today: TODAY, now: at(7) });
  assert.equal(covering.ok, true);
  assert.equal(covering.how, 'covering');

  // Nobody told the app: the Farm Manager simply has not clocked in by mid-morning.
  const noShow = farm();
  assert.equal(A.mayAssignZones(noShow, PEOPLE.u_sup, { today: TODAY, now: at(7) }).ok, false,
    'too early to call it at seven');
  assert.equal(A.mayAssignZones(noShow, PEOPLE.u_sup, { today: TODAY, now: at(10) }).ok, true);
});

test('FR-ROLE-06: the event log applies the same rule on replay', () => {
  const setup = (by, type, payload, when) => ({ id: `ev_${Math.random()}`, type, by, at: when, payload });
  const base = [
    ...Object.values(PEOPLE).map((p) => setup('u_owner', 'person.upsert', p, iso(1, day(-5)))),
    setup('u_mgr', 'plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse' }, iso(1, day(-5))),
    setup('u_mgr', 'plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }, iso(1, day(-5))),
  ];

  const self = reduce([...base,
    setup('u_mgr', 'zone.assign', { id: 'a1', personId: 'u_mgr', zoneId: 'gh1', holding: 'primary' }, iso(8))]);
  assert.equal(self.assignments.a1.personId, 'u_mgr', 'the manager holds GH-01 himself');

  // The Farm Manager clocked in at seven; the Supervisor's assignment at ten is refused.
  const refused = reduce([...base,
    setup('u_mgr', 'attendance.in', { personId: 'u_mgr', date: TODAY }, iso(7)),
    setup('u_sup', 'zone.assign', { id: 'a2', personId: 'u_emeka', zoneId: 'gh2', holding: 'primary', covering: true }, iso(10))]);
  assert.equal(refused.assignments.a2, undefined);
  assert.equal(refused.assignRefused.length, 1);

  // Marked absent: the Supervisor is covering, and it lands, marked so.
  const covered = reduce([...base,
    setup('u_mgr', 'absence.record', { id: 'ab', personId: 'u_mgr', date: TODAY }, iso(6)),
    setup('u_sup', 'zone.assign', { id: 'a3', personId: 'u_emeka', zoneId: 'gh2', holding: 'primary', covering: true }, iso(7))]);
  assert.equal(covered.assignments.a3.covering, true);

  // A hand cannot hand out zones at all.
  const hand = reduce([...base,
    setup('u_emeka', 'zone.assign', { id: 'a4', personId: 'u_emeka', zoneId: 'gh1', holding: 'primary' }, iso(8))]);
  assert.equal(hand.assignments.a4, undefined);
});

test('FR-ROLE-06: the server refuses a zone assignment from anyone who may not make one', () => {
  const ev = (payload) => ({ type: 'zone.assign', payload: { id: 'a1', personId: 'u_emeka', zoneId: 'gh1', holding: 'primary', ...payload } });
  assert.equal(core.mayWrite(ev({}), { id: 'u_mgr', role: 'manager' }).ok, true);
  assert.equal(core.mayWrite(ev({}), { id: 'u_owner', role: 'ceo' }).ok, true);
  assert.equal(core.mayWrite(ev({}), { id: 'u_sup', role: 'supervisor' }).ok, false, 'not covering');
  assert.equal(core.mayWrite(ev({ covering: true }), { id: 'u_sup', role: 'supervisor' }).ok, true);
  assert.equal(core.mayWrite(ev({}), { id: 'u_emeka', role: 'hand' }).ok, false);
  assert.equal(core.mayWrite(ev({ holding: 'sometimes' }), { id: 'u_mgr', role: 'manager' }).ok, false);
});

// --- FR-ROLE-07: many to many, primary before backup -------------------------

test('FR-ROLE-07: a zone carries several people and a person holds several zones', () => {
  const state = withDay(farm({ assignments: [['u_emeka', 'gh1'], ['u_sup', 'gh1'], ['u_emeka', 'gh2']] }));
  const holders = A.zoneHolders(state, 'gh1');
  assert.deepEqual(ids(holders.primary.map((h) => h.person)), ['u_emeka', 'u_sup']);

  const task = Object.values(state.tasks).find((t) => t.zoneId === 'gh1');
  assert.deepEqual(ids(A.doersFor(state, task, { today: TODAY, now: at(7) }).people), ['u_emeka', 'u_sup'],
    'both primaries have it');

  const emeka = A.myWork(state, 'u_emeka', { date: TODAY, now: at(7) });
  assert.deepEqual([...new Set(emeka.tasks.map(({ task: t }) => t.zoneId))].sort(), ['gh1', 'gh2']);
});

test('FR-ROLE-07: backups take a zone only when every primary holder is off', () => {
  const assignments = [['u_emeka', 'gh1'], ['u_blessing', 'gh1'], ['u_mgr', 'gh1', 'backup']];
  const task = (s) => Object.values(s.tasks).find((t) => t.zoneId === 'gh1');

  const oneOff = withDay(farm({ assignments, absences: [{ id: 'x', personId: 'u_emeka', date: TODAY }] }));
  assert.deepEqual(ids(A.doersFor(oneOff, task(oneOff), { today: TODAY, now: at(7) }).people), ['u_blessing'],
    'one primary still in keeps the zone');

  const bothOff = withDay(farm({ assignments, absences: [
    { id: 'x', personId: 'u_emeka', date: TODAY }, { id: 'y', personId: 'u_blessing', date: TODAY }] }));
  const who = A.doersFor(bothOff, task(bothOff), { today: TODAY, now: at(7) });
  assert.deepEqual(ids(who.people), ['u_mgr']);
  assert.equal(who.covering, true);
  assert.match(who.why, /as backup/);
});

test('FR-ROLE-07: a position still makes its holder the zone\'s primary', () => {
  const state = farm({ positions: { pos_gh3: { id: 'pos_gh3', role: 'hand', primaryZoneId: 'gh3',
    backupZoneId: 'gh1', holderId: 'u_blessing' } }, assignments: [['u_emeka', 'gh3']] });
  assert.deepEqual(ids(A.zoneHolders(state, 'gh3').primary.map((h) => h.person)), ['u_blessing', 'u_emeka']);
  assert.deepEqual(ids(A.zoneHolders(state, 'gh1').backup.map((h) => h.person)), ['u_blessing']);
});

test('FR-ROLE-07: moving a person from primary to backup on a zone leaves one holding, not two', () => {
  const ev = (id, type, payload, h) => ({ id, type, by: 'u_mgr', at: iso(h, day(-1)), payload });
  const state = reduce([
    ev('p1', 'person.upsert', PEOPLE.u_mgr, 1), ev('p2', 'person.upsert', PEOPLE.u_emeka, 1),
    ev('z1', 'plot.upsert', { id: 'gh1', name: 'GH-01' }, 1),
    ev('a1', 'zone.assign', { id: 'a1', personId: 'u_emeka', zoneId: 'gh1', holding: 'primary' }, 2),
    ev('a2', 'zone.assign', { id: 'a2', personId: 'u_emeka', zoneId: 'gh1', holding: 'backup' }, 3),
  ]);
  assert.deepEqual(A.liveAssignments(state).map((a) => a.holding), ['backup']);
});

// --- FR-ROLE-08: two views for supervising roles, one for a hand -----------

test('FR-ROLE-08: supervising roles get My work and The farm; a Greenhouse Hand only My work', () => {
  for (const role of ['supervisor', 'manager', 'ceo']) {
    const user = { id: 'x', role };
    assert.equal(A.hasFarmView(user), true, role);
    assert.equal(farmUi.farmView.allow(user), true);
    const sw = farmUi.workSwitch(user, '#/today');
    assert.match(sw, /My work/);
    assert.match(sw, /The farm/);
  }
  const hand = { id: 'h', role: 'hand' };
  assert.equal(farmUi.farmView.allow(hand), false, 'The farm is closed to a hand');
  assert.equal(farmUi.workSwitch(hand, '#/today'), '', 'and a hand sees no switch');
});

test('FR-ROLE-08: The farm shows every zone with its holders, without switching accounts', () => {
  const state = withDay(farm({ assignments: [['u_sup', 'gh1'], ['u_emeka', 'gh2']] }));
  const view = A.farmWork(state, { date: TODAY, now: at(7) });
  const row = (id) => view.zones.find((z) => z.zone.id === id);
  assert.deepEqual(ids(row('gh1').doing), ['u_sup']);
  assert.deepEqual(ids(row('gh2').doing), ['u_emeka']);
  assert.equal(row('gh3').gap, true, 'nobody holds GH-03');
  // The Supervisor's own list is still just GH-01, plus the gap nobody holds.
  const mine = A.myWork(state, 'u_sup', { date: TODAY, now: at(7) });
  assert.ok(mine.tasks.every(({ task }) => task.zoneId === 'gh1'));
  assert.ok(mine.unheld.every(({ task }) => task.zoneId === 'gh3') && mine.unheld.length);
});

// --- FR-ROLE-09: the same rules on their own tasks -------------------------

test('FR-ROLE-09: a Farm Manager\'s own scouting round cannot close without a photo', () => {
  const state = farm({ assignments: [['u_mgr', 'gh1']], tasks: {
    s1: { id: 's1', kind: 'scout', zoneId: 'gh1', due: `${TODAY}T09:00`, status: 'open', proof: true },
  } });
  const [own] = A.myWork(state, 'u_mgr', { date: TODAY, now: at(7) }).tasks;
  assert.equal(own.task.id, 's1', 'it is on his list');
  assert.equal(canComplete(own.task, null).ok, false);
  assert.equal(canComplete(own.task, { dataUrl: 'data:image/jpeg;base64,xx', fresh: true, bytes: 1000 }).ok, true);
});

test('FR-ROLE-09: a supervising role\'s own late task escalates like anyone else\'s', () => {
  const state = farm({ assignments: [['u_sup', 'gh1']], tasks: {
    w1: { id: 'w1', kind: 'irrigate', zoneId: 'gh1', due: `${TODAY}T08:00`, status: 'open' },
  }, attendance: [here('u_sup')] });
  const up = A.escalationFor(state, state.tasks.w1, { today: TODAY, now: at(11) });
  assert.ok(up, 'late is late, whoever holds it');
  assert.deepEqual(ids(up.to), ['u_mgr']);
});

test('FR-ROLE-09: a Farm Manager who did field work owes an end-of-shift report', () => {
  const state = farm({ tasks: {
    w1: { id: 'w1', kind: 'irrigate', zoneId: 'gh1', due: `${TODAY}T08:00`, status: 'done',
      doneBy: 'u_mgr', doneAt: iso(8) },
  } });
  const board = shiftBoard(state, { date: TODAY });
  assert.deepEqual(board.missing.map((p) => p.id), ['u_mgr'], 'no clock-in, but the work says he was out there');

  state.shifts.push({ id: 'sh1', personId: 'u_mgr', date: TODAY, at: iso(17),
    observation: 'Watered GH-01, one drip line blocked and cleared' });
  assert.equal(shiftBoard(state, { date: TODAY }).missing.length, 0);
});

// --- FR-ROLE-10: skip your own rung --------------------------------------------

function lateIn(zoneHolder, extra = {}) {
  return farm({
    assignments: [[zoneHolder, 'gh1']],
    tasks: { w1: { id: 'w1', kind: 'irrigate', zoneId: 'gh1', due: `${TODAY}T08:00`, status: 'open' } },
    attendance: Object.keys(PEOPLE).map((id) => here(id)),
    ...extra,
  });
}
const upFor = (state) => A.escalationFor(state, state.tasks.w1, { today: TODAY, now: at(11) });

test('FR-ROLE-10: a Greenhouse Hand\'s late task goes to the Field Supervisor', () => {
  const up = upFor(lateIn('u_emeka'));
  assert.equal(up.rung, 'supervisor');
  assert.deepEqual(ids(up.to), ['u_sup']);
});

test('FR-ROLE-10: the Field Supervisor\'s own late task skips his rung and goes to the Farm Manager', () => {
  const up = upFor(lateIn('u_sup'));
  assert.equal(up.rung, 'manager');
  assert.deepEqual(ids(up.to), ['u_mgr']);
  assert.equal(up.skipped[0].rung, 'supervisor');
  assert.match(up.skipped[0].why, /their own task/);
});

test('FR-ROLE-10: the Farm Manager\'s own late task goes to the Owner', () => {
  const up = upFor(lateIn('u_mgr'));
  assert.equal(up.rung, 'ceo');
  assert.deepEqual(ids(up.to), ['u_owner']);
});

test('FR-ROLE-10: it is still the Farm Manager\'s task when he never clocked in', () => {
  // After nine an unclocked holder counts as off, but the round is still his —
  // it must not fall back down to the Supervisor.
  const up = upFor(lateIn('u_mgr', { attendance: [] }));
  assert.equal(up.rung, 'ceo');
});

test('FR-ROLE-10: the Owner\'s own late task stays with the Owner', () => {
  const up = upFor(lateIn('u_owner'));
  assert.equal(up.top, true);
  assert.deepEqual(ids(up.to), ['u_owner']);
});

test('FR-ROLE-10: a zone a hand and the Supervisor share skips the Supervisor\'s rung too', () => {
  const state = lateIn('u_emeka');
  state.assignments.x = { id: 'x', personId: 'u_sup', zoneId: 'gh1', holding: 'primary' };
  assert.equal(upFor(state).rung, 'manager');
});

test('FR-ROLE-10: late work lands on the list of whoever it climbed to', () => {
  const state = lateIn('u_sup');
  const mgr = A.myWork(state, 'u_mgr', { date: TODAY, now: at(11) });
  const sup = A.myWork(state, 'u_sup', { date: TODAY, now: at(11) });
  assert.deepEqual(mgr.moved.map((m) => m.task.id), ['w1']);
  assert.equal(sup.moved.length, 0, 'never back to himself');
  assert.equal(sup.tasks[0].task.id, 'w1', 'and still on his own list, late');
});

// --- FR-ROLE-11: the week, spread across people ------------------------------

test('FR-ROLE-11: the week is Monday to Sunday, with jobs per person per day', () => {
  const state = farm({ assignments: [['u_emeka', 'gh1'], ['u_sup', 'gh2'], ['u_mgr', 'gh2']] });
  const start = A.weekStart(TODAY);
  assert.equal(start, '2026-09-14');
  const spread = A.weekSpread(state, { start, now: at(7), today: TODAY });
  assert.equal(spread.days.length, 7);
  assert.equal(spread.days[0], '2026-09-14');

  const row = (id) => spread.rows.find((r) => r.person.id === id);
  // Watering is every day, so every holder has at least a job a day.
  assert.ok(row('u_emeka').perDay.every((c) => c.total >= 1));
  // GH-02 is held by two people: both carry it.
  assert.equal(row('u_sup').total, row('u_mgr').total);
  // GH-03 is held by nobody: it shows as a gap every day.
  assert.ok(spread.gaps.every((n) => n >= 1));
  assert.equal(spread.gapTotal, spread.gaps.reduce((s, n) => s + n, 0));
});

test('FR-ROLE-11: a done job counts for whoever did it', () => {
  const state = farm({ assignments: [['u_emeka', 'gh1']], tasks: {
    d1: { id: 'd1', kind: 'irrigate', zoneId: 'gh1', due: `${TODAY}T08:00`, status: 'done', doneBy: 'u_blessing', doneAt: iso(8) },
  } });
  const spread = A.weekSpread(state, { start: A.weekStart(TODAY), now: at(12), today: TODAY });
  const blessing = spread.rows.find((r) => r.person.id === 'u_blessing');
  assert.equal(blessing.perDay[2].done, 1, 'Wednesday, done by Blessing');
});

test('FR-ROLE-11: the week screen is a supervising view', () => {
  assert.equal(farmUi.weekView.allow({ role: 'manager' }), true);
  assert.equal(farmUi.weekView.allow({ role: 'hand' }), false);
});

test('FR-ROLE-11: a past day the schedule planned but nobody issued is not counted late', () => {
  const state = farm({ assignments: [['u_emeka', 'gh1']] });
  const spread = A.weekSpread(state, { start: A.weekStart(TODAY), now: at(12), today: TODAY });
  const emeka = spread.rows.find((r) => r.person.id === 'u_emeka');
  assert.ok(emeka.perDay[0].total >= 1, 'Monday had GH-01 work on the plan');
  assert.equal(emeka.late, 0, 'but none of it was ever on the log, so none of it is late');
});
