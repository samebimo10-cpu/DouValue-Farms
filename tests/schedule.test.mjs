// Task generation, zones and positions — requirements 6.1, 6.3 and section 4.
//
// Two properties carry this whole area, and both are tested here before
// anything else.
//
// GENERATION IS IDEMPOTENT. Five phones, offline from each other for days, all
// generate Tuesday independently. If that produced five copies of Tuesday's
// scouting round the board would be unusable within a week.
//
// WORK DOES NOT VANISH WHEN SOMEBODY IS OFF. A position's work moves to the
// backup holder automatically, including when nobody told the app — which is
// the case that actually happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { tasksFor, missingTasks, overdue, dayProgress, howTo, taskIdFor, OPERATIONS } =
  await import(new URL('domain/schedule.js', base).href);
const { coverBoard, isAbsent, resolveOwner, uncoveredToday } =
  await import(new URL('domain/positions.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);

const TODAY = '2026-09-16';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (h) => new Date(`${TODAY}T${String(h).padStart(2, '0')}:00:00Z`);

function farm(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
      u_emeka: { id: 'u_emeka', name: 'Emeka Okoro', role: 'hand', active: true },
      u_blessing: { id: 'u_blessing', name: 'Blessing Amadi', role: 'hand', active: true },
    },
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 },
      gh2: { id: 'gh2', name: 'GH-02', type: 'greenhouse', areaM2: 300 },
    },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-30), status: 'active' },
    },
    positions: {
      pos_gh1: { id: 'pos_gh1', title: 'Greenhouse Hand — GH-01', role: 'hand',
        primaryZoneId: 'gh1', backupZoneId: 'gh2', holderId: 'u_emeka' },
      pos_gh2: { id: 'pos_gh2', title: 'Greenhouse Hand — GH-02', role: 'hand',
        primaryZoneId: 'gh2', backupZoneId: 'gh1', holderId: 'u_blessing' },
    },
    tasks: {}, inputs: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    absences: [], log: [], orphans: [],
    ...overrides,
  };
}

const kinds = (list) => list.map((t) => t.kind).sort();

// --- FR-TASK-01: the day generates itself ---------------------------------

test('a planted zone generates its own day of work', () => {
  const list = tasksFor(farm(), { date: TODAY });

  assert.ok(list.length, 'something is due on a bed thirty days in');
  assert.ok(list.every((t) => t.zoneId === 'gh1'));
  assert.ok(list.every((t) => t.title.includes('GH-01')), 'every task names its zone');
});

test('an empty zone generates nothing', () => {
  // GH-02 has no cycle, so there is nothing to scout, water or pick.
  const list = tasksFor(farm(), { date: TODAY });
  assert.equal(list.filter((t) => t.zoneId === 'gh2').length, 0);
});

test('a retired zone generates nothing, even with a cycle still on it', () => {
  const state = farm({
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', retired: true } },
  });
  assert.equal(tasksFor(state, { date: TODAY }).length, 0);
});

test('the work follows the crop, not the calendar', () => {
  // Pruning starts at day 28 and stops at 120, so a bed a week in gets none.
  const young = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-7), status: 'active' } },
  });
  assert.ok(!kinds(tasksFor(young, { date: TODAY })).includes('prune'));

  const grown = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-56), status: 'active' } },
  });
  assert.ok(kinds(tasksFor(grown, { date: TODAY })).includes('prune'));
});

test('picking is scheduled once the crop is actually pickable, and not before', () => {
  const tooEarly = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-30), status: 'active' } },
  });
  assert.ok(!kinds(tasksFor(tooEarly, { date: TODAY })).includes('harvest'));

  // Bell pepper first picks around day 70 and keeps picking well past it.
  const picking = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-72), status: 'active' } },
  });
  assert.ok(kinds(tasksFor(picking, { date: TODAY })).includes('harvest'),
    'day 72 is inside the picking window');
});

test('picking does not stop when the stage label changes to decline', () => {
  // A bed at the tail end is still picked until it is cleared. Stopping at the
  // label would leave ripe fruit on the plant, which is what tells it to stop
  // setting more.
  const late = farm({
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-153), status: 'active' } },
  });
  assert.ok(kinds(tasksFor(late, { date: TODAY })).includes('harvest'));
});

test('scouting is scheduled for the morning, when the pests are countable', () => {
  const scout = tasksFor(farm(), { date: TODAY }).find((t) => t.kind === 'scout');
  if (scout) assert.ok(Number(scout.due.slice(11, 13)) <= 10, `scouting due at ${scout.due}`);

  // And whenever it appears, it carries its steps and its reason (UX-19).
  const how = howTo('scout');
  assert.ok(how.how.length >= 3);
  assert.match(how.why, /cheap/);
  assert.equal(how.proof, true, 'scouting needs a photo to close');
});

// --- Idempotence ----------------------------------------------------------

test('generating the same day twice produces the same ids', () => {
  const state = farm();
  const a = tasksFor(state, { date: TODAY });
  const b = tasksFor(state, { date: TODAY });

  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
  assert.equal(new Set(a.map((t) => t.id)).size, a.length, 'no two tasks share an id');
});

test('five phones generating Tuesday independently land one Tuesday', () => {
  // The event log keys by id and merges as a set union, so the test is that the
  // ids collide rather than that anyone coordinates.
  const state = farm();
  const events = [];
  for (let phone = 0; phone < 5; phone++) {
    for (const task of tasksFor(state, { date: TODAY })) {
      events.push({
        id: `ev_${task.id}`, type: 'task.create', at: `${TODAY}T05:0${phone}:00.000Z`,
        by: 'u_emeka', payload: task,
      });
    }
  }
  const byId = new Map(events.map((e) => [e.id, e]));
  const rebuilt = reduce([...byId.values()]);

  assert.equal(Object.keys(rebuilt.tasks).length, tasksFor(state, { date: TODAY }).length);
});

test('a task already on the log is not generated again', () => {
  const state = farm();
  const first = tasksFor(state, { date: TODAY })[0];
  const withOne = farm({ tasks: { [first.id]: { ...first, status: 'done' } } });

  const missing = missingTasks(withOne, { date: TODAY });
  assert.ok(!missing.some((t) => t.id === first.id), 'a finished task is never resurrected as open');
});

test('two zones planted a week apart do not both fall due on the same day', () => {
  // Counting from transplant rather than from the calendar is what spreads the
  // load, and a farm where everything lands on Monday is a farm that skips
  // Monday.
  const state = farm({
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-30), status: 'active' },
      c2: { id: 'c2', plotId: 'gh2', cropId: 'bell', transplantDate: day(-27), status: 'active' },
    },
  });
  const scouting = tasksFor(state, { date: TODAY }).filter((t) => t.kind === 'scout');
  assert.ok(scouting.length <= 1, 'both zones were scheduled to scout on the same morning');
});

// --- FR-TASK-02: tasks belong to positions --------------------------------

test('a generated task names the position, not the person', () => {
  const task = tasksFor(farm(), { date: TODAY })[0];
  assert.equal(task.positionId, 'pos_gh1');
  assert.equal(task.assignedTo, undefined, 'a person is resolved at read time, never stored');
});

// --- Section 4: positions, absence and cover ------------------------------

test('the holder does their own zone when they are in', () => {
  const state = farm({ attendance: [{ personId: 'u_emeka', in: `${TODAY}T06:30:00Z` }] });
  const owner = resolveOwner(state, 'pos_gh1', { today: TODAY, now: at(10) });

  assert.equal(owner.person.id, 'u_emeka');
  assert.equal(owner.covering, false);
});

test('a declared absence moves the work to the backup holder', () => {
  const state = farm({
    absences: [{ id: 'ab1', personId: 'u_emeka', date: TODAY, reason: 'sick' }],
    attendance: [{ personId: 'u_blessing', in: `${TODAY}T06:30:00Z` }],
  });
  const owner = resolveOwner(state, 'pos_gh1', { today: TODAY, now: at(10) });

  assert.equal(owner.person.id, 'u_blessing', 'GH-02\'s hand has GH-01 as their backup zone');
  assert.equal(owner.covering, true);
  assert.match(owner.why, /marked absent/);
});

test('a no-show moves the work too, without anybody telling the app', () => {
  // The case that actually happens: a flat phone, or somebody ill at six who
  // tells a cousin rather than an app.
  const state = farm({ attendance: [{ personId: 'u_blessing', in: `${TODAY}T06:30:00Z` }] });
  const owner = resolveOwner(state, 'pos_gh1', { today: TODAY, now: at(10) });

  assert.equal(owner.person.id, 'u_blessing');
  assert.match(owner.why, /not clocked in/);
});

test('nobody is called absent before the morning is out', () => {
  // Reassigning at half past five because nobody has clocked in yet would make
  // the whole mechanism untrustworthy.
  const state = farm();
  assert.equal(isAbsent(state, 'u_emeka', { today: TODAY, now: at(6) }).absent, false);
  assert.equal(isAbsent(state, 'u_emeka', { today: TODAY, now: at(10) }).absent, true);
});

test('when both the holder and the backup are out, the gap is named rather than hidden', () => {
  const state = farm({
    absences: [
      { id: 'ab1', personId: 'u_emeka', date: TODAY },
      { id: 'ab2', personId: 'u_blessing', date: TODAY },
    ],
  });
  const owner = resolveOwner(state, 'pos_gh1', { today: TODAY, now: at(10) });

  assert.equal(owner.person, null);
  assert.equal(owner.unassigned, true);
  assert.ok(uncoveredToday(state, { today: TODAY, now: at(10) }).length >= 1,
    'an unchecked house is exactly what the Owner cannot see from anywhere else');
});

test('a cancelled absence puts the work back', () => {
  const state = farm({
    absences: [{ id: 'ab1', personId: 'u_emeka', date: TODAY, cancelled: true }],
    attendance: [{ personId: 'u_emeka', in: `${TODAY}T06:30:00Z` }],
  });
  assert.equal(resolveOwner(state, 'pos_gh1', { today: TODAY, now: at(10) }).person.id, 'u_emeka');
});

test('moving a person between positions is one record — FR-ROLE-04', () => {
  const events = [
    { id: 'e1', type: 'position.upsert', at: `${day(-10)}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'pos_gh1', title: 'Greenhouse Hand — GH-01', role: 'hand', primaryZoneId: 'gh1' } },
    { id: 'e2', type: 'position.assign', at: `${day(-9)}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'pos_gh1', holderId: 'u_emeka' } },
    { id: 'e3', type: 'position.assign', at: `${TODAY}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'pos_gh1', holderId: 'u_blessing' } },
  ];
  const state = reduce(events);

  assert.equal(state.positions.pos_gh1.holderId, 'u_blessing');
  assert.equal(state.positions.pos_gh1.primaryZoneId, 'gh1', 'the job kept its zone');
});

test('the cover board puts the gaps first', () => {
  const state = farm({
    absences: [
      { id: 'ab1', personId: 'u_emeka', date: TODAY },
      { id: 'ab2', personId: 'u_blessing', date: TODAY },
    ],
  });
  const board = coverBoard(state, { today: TODAY, now: at(10) });

  assert.ok(board.length >= 2);
  assert.equal(board[0].unassigned, true);
});

// --- FR-TASK-03: overdue work climbs --------------------------------------

test('overdue work is listed worst first, and yesterday\'s is escalated', () => {
  const state = farm({
    tasks: {
      a: { id: 'a', kind: 'scout', title: 'Scout GH-01', due: `${TODAY}T09:00`, status: 'open' },
      b: { id: 'b', kind: 'irrigate', title: 'Water GH-01', due: `${day(-1)}T08:00`, status: 'open' },
      c: { id: 'c', kind: 'prune', title: 'Prune GH-01', due: `${TODAY}T11:00`, status: 'done' },
    },
  });
  const late = overdue(state, { now: at(12), date: TODAY });

  assert.deepEqual(late.map((t) => t.id), ['b', 'a'], 'the oldest is the most overdue');
  assert.equal(late[0].escalated, true, 'yesterday\'s goes to the Field Supervisor');
  assert.equal(late[1].escalated, false);
  assert.ok(!late.some((t) => t.id === 'c'), 'finished work is not overdue');
});

// --- UX-24: the progress bar ----------------------------------------------

test('the day\'s progress reads as a fraction a person can see at a glance', () => {
  const state = farm({
    tasks: {
      a: { id: 'a', due: `${TODAY}T09:00`, status: 'done' },
      b: { id: 'b', due: `${TODAY}T10:00`, status: 'done' },
      c: { id: 'c', due: `${TODAY}T11:00`, status: 'open' },
      d: { id: 'd', due: `${day(1)}T09:00`, status: 'open' },
    },
  });
  const p = dayProgress(state, { date: TODAY });

  assert.equal(p.text, '2 of 3 done', 'tomorrow is not part of today');
  assert.ok(Math.abs(p.fraction - 2 / 3) < 0.01);
});

test('a day with nothing scheduled says so rather than showing an empty bar', () => {
  assert.equal(dayProgress(farm(), { date: TODAY }).text, 'Nothing scheduled today');
});

// --- FR-FARM-01: zones are retired, never deleted -------------------------

test('retiring a zone keeps its history', () => {
  const events = [
    { id: 'e1', type: 'plot.upsert', at: `${day(-200)}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'gh4', name: 'GH-04', type: 'greenhouse' } },
    { id: 'e2', type: 'plot.retire', at: `${TODAY}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'gh4', reason: 'Clean restart after root-knot' } },
  ];
  const state = reduce(events);

  assert.equal(state.plots.gh4.retired, true);
  assert.equal(state.plots.gh4.name, 'GH-04', 'the zone is still there to hang history on');
  assert.match(state.plots.gh4.retiredReason, /root-knot/);
});

test('a retired zone can be brought back', () => {
  const events = [
    { id: 'e1', type: 'plot.upsert', at: `${day(-200)}T08:00:00Z`, by: 'u_mgr',
      payload: { id: 'gh4', name: 'GH-04', type: 'greenhouse' } },
    { id: 'e2', type: 'plot.retire', at: `${day(-30)}T08:00:00Z`, by: 'u_mgr', payload: { id: 'gh4' } },
    { id: 'e3', type: 'plot.restore', at: `${TODAY}T08:00:00Z`, by: 'u_mgr', payload: { id: 'gh4' } },
  ];
  const state = reduce(events);

  assert.equal(state.plots.gh4.retired, false);
  assert.equal(state.plots.gh4.retiredReason, undefined);
});

// --- The Owner sees an unchecked house ------------------------------------

test('a zone nobody is covering reaches the Owner\'s digest', async () => {
  const { digestText } = await import(new URL('domain/digest.js', base).href);
  const state = farm({
    absences: [
      { id: 'ab1', personId: 'u_emeka', date: TODAY },
      { id: 'ab2', personId: 'u_blessing', date: TODAY },
    ],
    soilTests: [{ id: 'st1', zoneId: 'gh1', date: day(-35), ph: 6.2, nematode: 'clean' }],
  });
  const text = digestText(state, { now: `${TODAY}T10:00:00.000Z` });

  assert.match(text, /Nobody on GH-0[12] today/,
    'an unchecked house is exactly what the Owner cannot see from anywhere else');
});
