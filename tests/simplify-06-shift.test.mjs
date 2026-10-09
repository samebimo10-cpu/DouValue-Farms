// Simplification pass 6 of 8: the end-of-shift report — FR-SIMP-07, rendered
// in Node (docs/simplify-pass/06-shift.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

const { shiftView } = await import(new URL('../web/js/ui/shift.js', import.meta.url).href);
const { isoDate, addDays } = await import(new URL('../web/js/util.js', import.meta.url).href);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const onScreen = (html) => html.replace(/<details class="more"[\s\S]*?<\/details>/g, '');

const at = (d) => new Date(`${d}T17:00:00`).toISOString();
const shift = (id, date, observation) => ({ id, type: 'shift.record', by: 'sp_blessing', at: at(date),
  payload: { id, personId: 'sp_blessing', date, observation, zoneId: null, note: '' } });

test('End of shift moved: earlier reports are behind "Your earlier reports"', async () => {
  const yesterday = isoDate(addDays(new Date(), -1));
  const { state } = await sampleState([
    shift('sh_y', yesterday, 'Yesterday the whole of Bed 3 was weeded and the drains cleared'),
    shift('sh_t', isoDate(), 'Today the traps in Bed 2 were replaced and the drip line flushed'),
  ]);
  const html = shiftView.render(ctxFor(state, state.people.sp_blessing));
  assert.match(html, /data-moved="shift.earlier"><summary>Your earlier reports \(\d+\)<\/summary>/);
  assert.match(text(html), /Yesterday the whole of Bed 3 was weeded/);
  assert.ok(!text(onScreen(html)).includes('Yesterday the whole of Bed 3'), 'not on the screen until tapped');
  assert.match(text(onScreen(html)), /Today the traps in Bed 2 were replaced/, 'today\'s report stays');
});

test('End of shift moved: who owes a report is explained behind "Who is listed", for the manager', async () => {
  // Somebody clocked in today and has not filed.
  const { state } = await sampleState([{ id: 'att_t', type: 'attendance.in', by: 'sp_tamuno',
    at: new Date().toISOString(), payload: { personId: 'sp_tamuno', date: isoDate() } }]);
  const html = shiftView.render(ctxFor(state, state.people.sp_ada));
  assert.match(text(onScreen(html)), /Not in yet .*Tamuno George/);
  assert.match(html, /data-moved="shift.missing-who"><summary>Who is listed<\/summary>/);
  assert.match(text(html), /Only people who clocked in are listed/);
});
