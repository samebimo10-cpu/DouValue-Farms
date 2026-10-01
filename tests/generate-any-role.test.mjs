// The day's tasks are generated when anyone opens the app — FR-TASK-01,
// FR-ROLE-05, UX-23.
//
// Generation used to run only on a phone signed in as somebody who could
// assign tasks. On a morning when a Greenhouse Hand opened the app first —
// and the nursery's trap count is due at seven — their list was empty, and
// stayed empty until a supervisor's phone happened to open. These tests run
// the generator as every role, on open and on sign-in, and send what it makes
// through the farm server's own write check as a hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { reduce, ROLES } = await import(new URL('store.js', base).href);
const { generateOnSignIn, generateToday } = await import(new URL('generate.js', base).href);
const { OPERATIONS } = await import(new URL('domain/schedule.js', base).href);
const { NURSERY_OPERATIONS } = await import(new URL('domain/nursery.js', base).href);
const { addDays, isoDate } = await import(new URL('util.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

// Dated from today, the same call the generator makes, so the clock-shifted
// run still finds the work due.
const TODAY = isoDate();
const day = (n) => isoDate(addDays(TODAY, n));

const PEOPLE = Object.keys(ROLES).map((role) => ({ id: `u_${role}`, name: role, role, active: true }));

function farmEvents() {
  let n = 0;
  const ev = (type, payload, by = 'u_ceo') => ({ id: `e${++n}`, type, at: `${day(-40)}T08:00:${String(n).padStart(2, '0')}Z`, by, payload });
  return [
    ...PEOPLE.map((p) => ev('person.upsert', p)),
    ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse' }),
    ev('plot.upsert', { id: 'nur', name: 'OF-02', type: 'nursery' }),
    ev('cycle.start', { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-28), plants: 400 }),
    // A spray two days ago, so the three-day check (FR-DOC-07) is due too.
    { id: 'e_spray', type: 'spray.record', at: `${day(-2)}T16:30:00Z`, by: 'u_supervisor',
      payload: { id: 'sp1', cycleId: 'c1', date: day(-2), productName: 'Neem oil' } },
  ];
}

/** Just enough of createStore() for the generator: the log, the user, dispatch. */
function fakeStore(user = null) {
  const events = farmEvents();
  const listeners = new Set();
  let current = user;
  const store = {
    events,
    state: reduce(events),
    get user() { return current; },
    setUser(p) { current = p; for (const fn of listeners) fn(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async dispatch(type, payload, opts = {}) {
      const event = { id: opts.eventId || `x${events.length}`, type, at: new Date().toISOString(),
        by: current ? current.id : 'system', payload };
      if (!events.some((e) => e.id === event.id)) events.push(event);
      store.state = reduce(events);
      for (const fn of listeners) fn();
      return event;
    },
  };
  const ctx = { store, get user() { return store.user; }, get state() { return store.state; }, refresh() {} };
  return { store, ctx };
}

const generated = (store) => store.events.filter((e) => e.type === 'task.create');

for (const person of PEOPLE) {
  test(`FR-TASK-01: ${/^[aeiou]/.test(person.role) ? 'an' : 'a'} ${person.role} opening the app puts the day's work on the board`, async () => {
    const { store, ctx } = fakeStore(person);
    await generateToday(ctx);
    const made = generated(store);
    const kinds = new Set(made.map((e) => e.payload.kind));
    assert.ok(kinds.has('nursery_trap'), 'the nursery\'s daily trap count');
    assert.ok(kinds.has('irrigate'), 'the crop\'s daily watering');
    assert.ok(kinds.has('follow_up'), 'the three-day check after a spray');
    assert.ok(made.every((e) => e.by === person.id && e.id === `ev_${e.payload.id}`));
  });
}

test('generating twice, or on two phones, adds nothing the second time', async () => {
  const { store, ctx } = fakeStore(PEOPLE.find((p) => p.role === 'hand'));
  await generateToday(ctx);
  const first = generated(store).length;
  await generateToday(ctx);
  assert.equal(generated(store).length, first);
});

test('nobody signed in: nothing is written under no name', async () => {
  const { store, ctx } = fakeStore(null);
  await generateToday(ctx);
  assert.equal(generated(store).length, 0);
});

test('the open usually lands on the sign-in screen: the day is generated when someone signs in', async () => {
  const { store, ctx } = fakeStore(null);
  generateOnSignIn(ctx);
  const hand = PEOPLE.find((p) => p.role === 'hand');
  store.setUser(hand);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const made = generated(store);
  assert.ok(made.some((e) => e.payload.kind === 'nursery_trap'), 'generated on sign-in');
  assert.ok(made.every((e) => e.by === hand.id));
});

test('app.js no longer keeps generation to the people who assign tasks', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  const gen = readFileSync(new URL('../web/js/generate.js', import.meta.url), 'utf8');
  assert.match(app, /generateOnSignIn\(ctx\)/);
  assert.doesNotMatch(gen, /assignTasks/);
});

// --- The farm server takes them from a hand's phone ---------------------------

const hand = { id: 'u_hand', role: 'hand' };

test('every task the generator makes is accepted from a hand by the farm server', async () => {
  const { store, ctx } = fakeStore(PEOPLE.find((p) => p.role === 'hand'));
  await generateToday(ctx);
  const made = generated(store);
  assert.ok(made.length >= 3);
  for (const event of made) {
    assert.deepEqual(core.mayWrite(event, hand), { ok: true }, `${event.payload.kind}: ${event.payload.id}`);
  }
});

test('…but only the generator\'s shape: a hand still cannot write a task of their own', () => {
  const real = {
    id: `ev_gen_${TODAY}_gh1_trap`, type: 'task.create',
    payload: { id: `gen_${TODAY}_gh1_trap`, kind: 'trap', zoneId: 'gh1', due: `${TODAY}T10:00`, generated: true },
  };
  assert.equal(core.mayWrite(real, hand).ok, true);
  const refused = [
    ['a task written by hand', { id: 'ev_t1', type: 'task.create', payload: { id: 't1', title: 'Go home early', kind: 'other' } }],
    ['not marked generated', { ...real, payload: { ...real.payload, generated: false } }],
    ['naming someone', { ...real, payload: { ...real.payload, assignedTo: 'u_other' } }],
    ['an unknown kind', { ...real, payload: { ...real.payload, kind: 'holiday', id: `gen_${TODAY}_gh1_holiday` }, id: `ev_gen_${TODAY}_gh1_holiday` }],
    ['an id that does not match the day', { ...real, payload: { ...real.payload, due: `${day(1)}T10:00` } }],
    ['an id that does not match the zone', { ...real, payload: { ...real.payload, zoneId: 'gh2' } }],
    ['an event id of its own', { ...real, id: 'ev_other' }],
    ['a follow-up for a different spray', { id: 'ev_fd_follow_sp1', type: 'task.create',
      payload: { id: 'fd_follow_sp1', kind: 'follow_up', sprayId: 'sp2', generated: true } }],
  ];
  for (const [what, event] of refused) {
    const verdict = core.mayWrite(event, hand);
    assert.equal(verdict.ok, false, what);
    assert.match(verdict.why, /scheduled work/, what);
  }
  // FR-TASK-04 is unchanged: the people who run the work still write one-off tasks.
  assert.equal(core.mayWrite(refused[0][1], { id: 'u_sup', role: 'supervisor' }).ok, true);
  assert.equal(core.mayWrite(refused[0][1], { id: 'u_mgr', role: 'manager' }).ok, true);
});

test('the server\'s list of generated kinds is the generator\'s list', () => {
  const app = [...OPERATIONS, ...NURSERY_OPERATIONS].map((o) => o.kind).concat('follow_up').sort();
  assert.deepEqual([...core.GENERATED_TASK_KINDS].sort(), app);
});
