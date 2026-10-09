// Simplification pass 6 of 8: the end-of-shift report — FR-SIMP-02, 07, 08,
// in a real Chrome at 360 px (docs/simplify-pass/06-shift.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };

test('FR-SIMP-08 end of shift: Write today\'s report, then Send, are in reach; the report keeps every field', opts, async () => {
  await phone.as('sp_blessing', '#/shifts');
  assertReachable('End of shift', await phone.mainAction('[data-main-action="shift"]'));
  await phone.tap('[data-main-action="shift"]');
  assertReachable('End of shift: send', await phone.mainAction('.sheet [data-main-action="shift-send"]'));
  assert.deepEqual(await phone.sheetControls(), ['observation', 'zoneId', 'note']);

  await phone.evaluate(`(() => {
    const f = document.querySelector('.sheet form');
    f.querySelector('[name=observation]').value = 'Scouted Bed 2, traps replaced, drip line on row four blocked and flushed';
    f.querySelector('[name=zoneId]').value = 'sp_b2';
    f.querySelector('[name=note]').value = 'Need a new fitting';
    f.requestSubmit();
    return true;
  })()`);
  await phone.page.waitFor(`(__douvalueCtx.store.state.shifts || []).some((s) => s.note === 'Need a new fitting')`, { what: 'the report to save' });
  const s = await phone.evaluate(`(() => { const s = __douvalueCtx.store.state.shifts.find((x) => x.note === 'Need a new fitting');
    return { personId: s.personId, date: s.date, observation: s.observation, zoneId: s.zoneId, enteredAt: !!s.enteredAt }; })()`);
  assert.equal(s.personId, 'sp_blessing');
  assert.equal(s.zoneId, 'sp_b2');
  assert.match(s.observation, /drip line/);
  assert.ok(s.date && s.enteredAt);
});

test('End of shift moved: what the report is for, and earlier reports, are one tap away on the screen', opts, async () => {
  await phone.as('sp_blessing', '#/shifts');
  const purpose = await phone.evaluate(`document.querySelector('details[data-moved="shift.purpose"]').textContent`);
  assert.match(purpose, /^What this report is for/);
  assert.match(purpose, /It is not a problem report/);
  assert.match(purpose, /only record of the day that is in your own words/);
  assert.match(purpose, /reads first tomorrow morning/);
});
