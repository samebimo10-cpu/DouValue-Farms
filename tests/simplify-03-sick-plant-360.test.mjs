// Simplification pass 3 of 8: the sick-plant report — FR-SIMP-02, 07, 08, in a
// real Chrome at 360 px.
//
// The report was already short (FR-DIAG-07): zone, photos, where, how many,
// send. The pass leaves every step and every choice; on each step the Next or
// Send button is in reach with nothing scrolled, and on the last screen the
// names stay while how the alert climbs moves one tap away
// (docs/simplify-pass/03-sick-plant.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };
const step = () => phone.evaluate(`document.querySelector('#app .card-head h2').textContent`);

test('FR-SIMP-08 sick-plant report: Next and Send are in reach on every step, and nothing on the record is lost', opts, async () => {
  await phone.as('sp_emeka', '#/sick-plant');
  assert.equal(await step(), 'Which zone?');
  assertReachable('Sick plant: zone', await phone.mainAction());
  await phone.tap('[data-act="sp-zone"][data-id="sp_b4"]');
  await phone.tap('[data-main-action="sick-plant"]');

  assert.match(await step(), /^Take a photo/);
  assertReachable('Sick plant: photo', await phone.mainAction());
  await phone.attachPhoto();
  await phone.tap('[data-act="sp-add-photo"]');
  await phone.tap('[data-main-action="sick-plant"]');

  assert.equal(await step(), 'Where on the plant?');
  assertReachable('Sick plant: where', await phone.mainAction());
  await phone.tap('[data-act="sp-where"][data-id="wilting"]');
  await phone.tap('[data-main-action="sick-plant"]');

  assert.equal(await step(), 'How many plants?');
  assertReachable('Sick plant: how many', await phone.mainAction());
  await phone.tap('[data-act="sp-howmany"]');
  await phone.tap('[data-act="sp-spreading"]');
  const before = await phone.evaluate('__douvalueCtx.store.state.reports.length');
  await phone.tap('[data-main-action="sick-plant"]');
  await phone.page.waitFor(`__douvalueCtx.store.state.reports.length > ${before}`, { what: 'the report to save' });

  // FR-SIMP-02: the report carries every field it did before the pass.
  const filed = await phone.evaluate('(() => { const r = __douvalueCtx.store.state.reports.slice(-1)[0]; return { keys: Object.keys(r), zoneId: r.zoneId, where: r.where, photos: r.photos.length }; })()');
  for (const k of ['zoneId', 'photos', 'where', 'howMany', 'spreading', 'sentTo']) assert.ok(filed.keys.includes(k), `the report lost ${k}`);
  assert.equal(filed.zoneId, 'sp_b4');
  assert.deepEqual(filed.where, ['wilting']);
  assert.equal(filed.photos, 1);

  // The last screen: who it went to and the alert, on the screen; the ladder one tap away.
  const sent = await phone.evaluate(`document.getElementById('app').innerText`);
  assert.match(sent, /Report sent/);
  assert.match(sent, /Sent to .*Farm Manager/);
  assert.match(sent, /Alert raised/);
  assert.match(await phone.evaluate(`document.querySelector('details[data-moved="sick-plant.ladder"]').textContent`),
    /What happens next.*4 hours.*Field Supervisor.*12 hours.*Owner/s);
  assertReachable('Sick plant: sent', await phone.mainAction('[data-main-action="sick-plant-sent"]'));
});
