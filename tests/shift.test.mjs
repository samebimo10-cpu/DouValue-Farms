// End-of-shift reports — FR-TASK-05 and UX-09.
//
// "Each person submits a short written end-of-shift report, which the Farm
// Manager can read and comment on."
//
// The test this file is really about is the separation one. A shift report and
// a problem report are different things: one is the ordinary end of an ordinary
// day, the other is an exception that has to be chased. Running them through
// one list costs both — the exceptions fill with "watered as normal" until
// nobody reads them, and the day's account vanishes the moment somebody marks
// it resolved. So there are tests here asserting that neither ends up in the
// other's list, and they are the ones that would catch a well-meaning merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const store = await import(new URL('store.js', base).href);
const shift = await import(new URL('domain/shift.js', base).href);
const { shiftView } = await import(new URL('ui/shift.js', base).href);
const { isoDate } = await import(new URL('util.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

// Today, read the way the screen reads it.
//
// The domain functions take the day as an argument, but shiftView.render()
// cannot — it is the end-of-shift screen, and the day it is about is the day
// you are standing in. It calls isoDate(). A fixture pinned to one date
// therefore renders an empty board on every other date, and the screen tests
// below would be reading a page nobody would ever see. So the fixture moves
// with the clock, and the two older evenings are dated relative to it.
const TODAY = isoDate();
const day = (n) => isoDate(new Date(Date.now() + n * 86400000));
const at = (h, m = 0) => `${TODAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

const ev = (type, payload, by = 'u_hand', when = at(17)) =>
  ({ id: `ev_${type}_${payload.id || payload.shiftId}_${when}`, type, at: when, by, payload });

const OBSERVATION = 'Scouted GH-02 and GH-03, traps replaced in both. '
  + 'Drip line on bench three still blocked, flushed it twice.';

function log(extra = []) {
  return [
    ev('person.upsert', { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' }, 'system', at(6)),
    ev('person.upsert', { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' }, 'system', at(6)),
    ev('person.upsert', { id: 'u_sup', name: 'Tamuno West', role: 'supervisor' }, 'system', at(6)),
    ev('plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }, 'system', at(6)),
    ev('attendance.in', { personId: 'u_hand', date: TODAY }, 'u_hand', at(6, 30)),
    ...extra,
  ];
}

// --- UX-09: the written observation ---------------------------------------

test('a report has to say something somebody can act on tomorrow', () => {
  assert.equal(shift.judgeObservation('').ok, false);
  assert.equal(shift.judgeObservation('   ').reason, 'missing');
  // "ok." is six characters and says nothing, which is why the floor is
  // counted in words rather than in characters.
  assert.equal(shift.judgeObservation('ok').ok, false);
  assert.equal(shift.judgeObservation('all fine today').ok, false);
  assert.equal(shift.judgeObservation(OBSERVATION).ok, true);
});

test('the form asks the two questions UX-09 words', () => {
  assert.match(shift.OBSERVATION_PROMPT, /what did you see/i);
  assert.match(shift.OBSERVATION_PROMPT, /what did you do/i);
});

// --- FR-TASK-05: filing one ------------------------------------------------

test('a filed report belongs to the person who worked the shift', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION, zoneId: 'gh2' }),
  ]));

  const [report] = shift.shiftReports(state, { date: TODAY });
  assert.equal(report.personId, 'u_hand');
  assert.equal(report.person.name, 'Emeka Okoro');
  assert.equal(report.zone.name, 'GH-02');
  assert.equal(report.observation, OBSERVATION);
  assert.equal(shift.shiftFiled(state, 'u_hand', TODAY), true);
  assert.equal(shift.shiftFiled(state, 'u_mgr', TODAY), false);
});

test('the Farm Manager can comment, and the comment lives on the report', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
    ev('shift.comment', { id: 'c1', shiftId: 'sh1', note: 'Good catch. Fitting ordered for Thursday.' },
      'u_mgr', at(19)),
  ]));

  const [report] = shift.shiftReports(state, { date: TODAY });
  assert.equal(report.comments.length, 1);
  assert.equal(report.comments[0].by, 'u_mgr');
  assert.match(report.comments[0].note, /Fitting ordered/);
  assert.equal(report.commented, true);
});

test('a comment that arrives before its report is not lost', () => {
  // Five phones, no signal between them: the manager's comment can reach a
  // handset before the report it answers. The log parks it and replays it.
  const state = store.reduce([
    ev('shift.comment', { id: 'c1', shiftId: 'sh1', note: 'Seen, thank you' }, 'u_mgr', at(4)),
    ...log([ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION })]),
  ]);

  const [report] = shift.shiftReports(state, { date: TODAY });
  assert.equal(report.comments.length, 1, 'the early comment was replayed onto its report');
  assert.equal(state.orphans.length, 0);
});

// --- FR-TASK-05: the Farm Manager's board ---------------------------------

test('the board says who filed, who has not, and what is unanswered', () => {
  const state = store.reduce(log([
    ev('attendance.in', { personId: 'u_sup', date: TODAY }, 'u_sup', at(6, 40)),
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
  ]));

  const board = shift.shiftBoard(state, { date: TODAY });
  assert.equal(board.counts.filed, 1);
  assert.deepEqual(board.missing.map((p) => p.name), ['Tamuno West']);
  assert.equal(board.awaitingComment.length, 1, 'nobody has answered it yet');
});

test('somebody who was not in today does not owe a report', () => {
  // A board that lists everybody on the staff list every evening is a board
  // that gets ignored by Thursday.
  const board = shift.shiftBoard(store.reduce(log()), { date: TODAY });
  assert.deepEqual(board.missing.map((p) => p.id), ['u_hand'], 'only the person who clocked in');
});

test('a report from somebody nobody clocked in still counts as worked', () => {
  const state = store.reduce([
    ev('person.upsert', { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' }, 'system', at(6)),
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
  ]);
  const board = shift.shiftBoard(state, { date: TODAY });
  assert.equal(board.counts.filed, 1);
  assert.equal(board.missing.length, 0);
});

test('a run of evenings is readable, which is the point of keeping them', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: day(-2), observation: OBSERVATION }, 'u_hand', `${day(-2)}T17:00:00.000Z`),
    ev('shift.record', { id: 'sh2', date: day(-1), observation: OBSERVATION }, 'u_hand', `${day(-1)}T17:00:00.000Z`),
    ev('shift.record', { id: 'sh3', date: TODAY, observation: OBSERVATION }),
  ]));
  assert.equal(shift.shiftHistory(state, 'u_hand', { today: TODAY }).length, 3);
  assert.equal(shift.shiftHistory(state, 'u_mgr', { today: TODAY }).length, 0);
});

// --- Separate from the problem reports ------------------------------------

test('a shift report is not a problem report, and neither lands in the other list', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
    ev('report.record', { id: 'r1', cycleId: null, note: 'Fence panel down at the back gate',
      severity: 'high', date: TODAY }),
  ]));

  assert.equal(state.shifts.length, 1);
  assert.equal(state.reports.length, 1);
  assert.equal(state.shifts[0].id, 'sh1');
  assert.equal(state.reports[0].id, 'r1');

  // The exceptions list holds the fence, not the ordinary evening.
  assert.deepEqual(store.openReports(state).map((r) => r.id), ['r1']);
  assert.deepEqual(shift.shiftReports(state, { date: TODAY }).map((s) => s.id), ['sh1']);
});

test('a shift report is never "resolved" — it is read and answered', () => {
  // A problem report closes. A day does not: marking Tuesday resolved would
  // hide it, and the whole value of these is reading a run of them.
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
    ev('report.resolve', { id: 'sh1', note: 'trying to close a shift report' }, 'u_mgr', at(19)),
  ]));
  assert.equal(state.shifts[0].status, undefined);
  assert.equal(state.shifts[0].resolvedBy, undefined);
});

// --- The fence ------------------------------------------------------------

test('the server refuses a report that says nothing', () => {
  const guard = core.EVENT_POLICY['shift.record'].guard;
  for (const observation of ['', 'ok', 'all fine']) {
    assert.equal(guard({ payload: { date: TODAY, observation } }, { id: 'u_hand' }).ok, false);
  }
  assert.equal(guard({ payload: { date: TODAY, observation: OBSERVATION } }, { id: 'u_hand' }).ok, true);
});

test('nobody files somebody else\'s day', () => {
  const guard = core.EVENT_POLICY['shift.record'].guard;
  const filed = guard({ payload: { date: TODAY, personId: 'u_sup', observation: OBSERVATION } },
    { id: 'u_hand' });
  assert.equal(filed.ok, false);
  assert.match(filed.why, /person who worked the shift/);
});

test('everybody may file one; only the people who run the work may comment', () => {
  assert.equal(core.can('hand', core.EVENT_POLICY['shift.record'].write), true);
  assert.equal(core.can('hand', core.EVENT_POLICY['shift.comment'].write), false);
  assert.equal(core.can('supervisor', core.EVENT_POLICY['shift.comment'].write), true);
  assert.equal(core.can('manager', core.EVENT_POLICY['shift.comment'].write), true);
});

test('an empty comment is refused, and one with no report to answer', () => {
  const guard = core.EVENT_POLICY['shift.comment'].guard;
  assert.equal(guard({ payload: { shiftId: 'sh1', note: '  ' } }).ok, false);
  assert.equal(guard({ payload: { note: 'Seen, thank you' } }).ok, false);
  assert.equal(guard({ payload: { shiftId: 'sh1', note: 'Seen, thank you' } }).ok, true);
});

// --- The screen -----------------------------------------------------------

const ctxFor = (state, user) => ({ state, user, store: { state } });

/**
 * The board actually drew a report.
 *
 * Every assertion about what the manager's screen contains is worthless
 * against the empty state — "No reports yet today" contains no script tag
 * either, so an escaping test passes on it for the wrong reason. This is the
 * check that makes that impossible: it fails loudly, naming the empty board,
 * before anything is asserted about what is on it.
 */
function assertBoardDrewAReport(html) {
  assert.ok(!/No reports yet today/.test(html),
    'the board rendered its empty state, so nothing below this is being tested — '
    + 'the fixture is dated for a day the screen is not showing');
  assert.match(html, /data-act="open-shift-comment"/,
    'a rendered report carries the way to answer it');
}

test('the screen offers a hand their own report, and nobody else\'s', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: 'Tamuno saw whitefly on the GH-04 trap today', }, 'u_sup', at(17)),
  ]));
  const html = shiftView.render(ctxFor(state, state.people.u_hand));

  assert.match(html, /Write today&#39;s report/, 'the button is there, with its apostrophe escaped');
  assert.ok(!html.includes('Tamuno saw whitefly'), 'a hand does not read the team\'s reports');
});

test('the Farm Manager\'s screen shows the reports and a way to answer them', () => {
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY, observation: OBSERVATION }),
  ]));
  const html = shiftView.render(ctxFor(state, state.people.u_mgr));

  assertBoardDrewAReport(html);
  assert.match(html, /Emeka Okoro/);
  assert.match(html, /Drip line on bench three/);
  assert.match(html, /not answered yet/);
});

test('an observation is escaped before it is shown', () => {
  // NFR-SEC-04: every word of this is typed by a person.
  const state = store.reduce(log([
    ev('shift.record', { id: 'sh1', date: TODAY,
      observation: '<script>alert(1)</script> and the rest of the day' }),
  ]));
  const html = shiftView.render(ctxFor(state, state.people.u_mgr));

  // Before asserting on the escaping, prove there is something to escape. The
  // negative assertion below passes on an empty board, so without this the
  // whole test can go quiet rather than red.
  assertBoardDrewAReport(html);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&lt;script&gt;/);
});
