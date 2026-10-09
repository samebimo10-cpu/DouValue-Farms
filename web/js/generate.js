// FR-TASK-01 — the day's work, generated on the phone that opens first.
//
// Its own module rather than a corner of app.js so it can be run in a test
// without a browser: who may trigger it is the whole point of it.

import { missingTasks } from './domain/schedule.js';
import { missingFollowUps } from './domain/doctor.js';
import { respraysDue, resprayTaskFor } from './domain/climate.js';
import { isoDate } from './util.js';

/**
 * FR-TASK-01 — put today's work on the board.
 *
 * Runs on every open and on every sign-in, whoever it is. Safe to run five
 * times on five phones, because every generated task carries a deterministic
 * id: IndexedDB keys events by id and the sync merge is a set union, so the
 * same Tuesday lands once however many handsets produced it.
 *
 * Any role, not only the people who run the work. It used to be supervisors
 * only, which meant a Greenhouse Hand who opened the app first in the morning
 * found an empty list (FR-ROLE-05, UX-23) — and the nursery's trap count is due
 * at seven, before anyone senior has usually signed in. The schedule is the schedule
 * whoever's phone writes it down: nothing here is anyone's choice, and the
 * farm server accepts a generated task from any role only in the exact shape
 * this generator makes (server/core.mjs, guardTaskCreate).
 */
export async function generateToday(ctx) {
  if (!ctx.user) return;
  const today = isoDate();
  // FR-DOC-07: the three-day check after every treatment is generated the same
  // way, from the spray it belongs to, so it is on the board whether or not
  // anybody remembered to write it down.
  const due = [
    ...missingTasks(ctx.store.state, { date: today }),
    ...missingFollowUps(ctx.store.state, { today }),
  ];
  if (!due.length) return;

  for (const task of due) {
    await ctx.store.dispatch('task.create', task, { eventId: `ev_${task.id}` });
  }
  ctx.refresh();
}

/**
 * SR-04 — open field, more than 15 mm of rain within 4 h after a spray: a
 * re-spray task for the next dry window. Run whenever the hourly weather
 * arrives. Like the schedule, the task is derived from the spray alone, so any
 * phone may file it and five phones file it once.
 */
export async function generateResprays(ctx, forecast) {
  if (!ctx.user || !forecast) return;
  const today = isoDate();
  const due = respraysDue(ctx.store.state, forecast).map((d) => resprayTaskFor(d, forecast, { today }));
  if (!due.length) return;
  for (const task of due) {
    await ctx.store.dispatch('task.create', task, { eventId: `ev_${task.id}` });
  }
  ctx.refresh();
}

/**
 * Most opens start at the sign-in screen, so the open above finds nobody signed
 * in. Whoever signs in next — on a shared phone, each person in turn — gets the
 * day generated then, before their list is drawn from it.
 */
export function generateOnSignIn(ctx) {
  let last = ctx.user ? ctx.user.id : null;
  ctx.store.subscribe(() => {
    const id = ctx.user ? ctx.user.id : null;
    if (id === last) return;
    last = id;
    if (!id) return;
    generateToday(ctx).catch((err) => console.error('Could not generate today\'s tasks', err));
  });
}
