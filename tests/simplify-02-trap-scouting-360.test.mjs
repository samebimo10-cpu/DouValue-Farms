// Simplification pass 2 of 8: trap check and scouting — FR-SIMP-02, 07, 08,
// in a real Chrome at 360 px.
//
// Three sheets: the trap count, the scouting round a photo-proof task opens,
// and the supervisor's scouting record. Each one's save button is in reach on
// the open sheet; each form keeps every control it had before the pass (no
// record loses a field); what moved is one tap away on the same sheet
// (docs/simplify-pass/02-trap-scouting.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };

test('FR-SIMP-08 trap count: Save the count is in reach on the open sheet', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-trapcount"]');
  assertReachable('Trap count', await phone.mainAction('.sheet [data-main-action="trap"]'));
});

test('FR-SIMP-02 trap count: the form keeps every box it had, open', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-trapcount"]');
  assert.deepEqual(await phone.sheetControls(),
    ['taskId', 'zoneId', 'count_thrips', 'count_whitefly', 'count_aphids', 'count_fruit_fly', 'photo', 'note']);
  // FR-SCOUT-03: every pest with a trap threshold is on the screen, not behind a tap.
  const hidden = await phone.evaluate(`[...document.querySelectorAll('.sheet [name^="count_"]')]
    .filter((e) => e.closest('details')).map((e) => e.name)`);
  assert.deepEqual(hidden, []);
});

test('FR-SIMP-02 trap count: what is saved is the same record, every field', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-trapcount"]');
  const before = await phone.evaluate('__douvalueCtx.store.state.scouts.length');
  await phone.evaluate(`(() => {
    const f = document.querySelector('.sheet form');
    f.querySelector('[name=count_thrips]').value = '3';
    f.querySelector('[name=count_whitefly]').value = '0';
    f.querySelector('[name=count_aphids]').value = '2';
    f.querySelector('[name=note]').value = 'Card nearly full';
    f.requestSubmit();
    return true;
  })()`);
  await phone.page.waitFor(`__douvalueCtx.store.state.scouts.length >= ${before + 3}`, { what: 'the counts to save' });
  const saved = await phone.evaluate(`__douvalueCtx.store.state.scouts.slice(-3).map((s) => ({ pest: s.pestId, n: s.trapCount, note: s.note, zone: s.zoneId || s.plotId || null }))`);
  assert.deepEqual(saved.map((s) => [s.pest, s.n]), [['thrips', 3], ['whitefly', 0], ['aphids', 2]]);
  for (const s of saved) assert.equal(s.note, 'Card nearly full');
});

test('FR-SIMP-08 scouting (supervisor): Save scouting is in reach, and every box is still there', opts, async () => {
  await phone.as('sp_tamuno', '#/field');
  await phone.tap('[data-act="open-scout"]');
  assertReachable('Scouting', await phone.mainAction('.sheet [data-main-action="scout"]'));
  assert.deepEqual(await phone.sheetControls(),
    ['cycleId', 'pestId', 'trapCount', 'perPlant', 'finding', 'affected', 'plantsAffected', 'note', 'photo']);
});

test('FR-SIMP-08 scouting round (photo proof): Done is in reach, with the photo and the line', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  // A scouting round on Emeka's own zone, as the schedule writes one.
  await phone.evaluate(`(async () => {
    const ctx = __douvalueCtx;
    const t = Object.values(ctx.store.state.tasks).find((x) => x.zoneId === 'sp_b4' && x.status !== 'done');
    await ctx.store.dispatch('task.create', { ...t, id: 'scout_round_test', kind: 'scout', title: 'Scout — Back field', status: 'open' });
    ctx.refresh();
    return true;
  })()`);
  await phone.page.waitFor(`!!document.querySelector('[data-act="task-done"][data-id="scout_round_test"]')`, { what: 'the scouting round' });
  await phone.tap('[data-act="task-done"][data-id="scout_round_test"]');
  assertReachable('Scouting round', await phone.mainAction('.sheet [data-main-action="scout-proof"]'));
  assert.deepEqual(await phone.sheetControls(), ['taskId', 'photo', 'note']);
  // Moved: why the photo must be taken now, one tap away on the same sheet.
  assert.match(await phone.evaluate(`document.querySelector('.sheet details[data-moved="scout.photo-why"]').textContent`),
    /a picture from the gallery proves the bed was fine earlier/);
  // Moved: "A line is enough" went into the box's own placeholder.
  assert.match(await phone.evaluate(`document.querySelector('.sheet [name=note]').placeholder`), /^A line is enough/);
});

test('Trap check and scouting moved: each explanation is one tap away on its own sheet', opts, async () => {
  const movedText = (id) => phone.evaluate(`(() => {
    const el = document.querySelector('.sheet [data-moved="${id}"]');
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  })()`);

  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-trapcount"]');
  assert.match(await movedText('trap.photo-why'), /^Why a photo ?.*settles any question later/);

  await phone.as('sp_tamuno', '#/field');
  await phone.tap('[data-act="open-scout"]');
  assert.match(await movedText('scout.method'), /^How to scout a bed ?.*Walk a diagonal across the bed/);
  assert.match(await movedText('scout.photo-why'), /^Why a photo ?.*worth more than a description/);
  assert.match(await movedText('scout.clinic'), /Not sure what it is\? Open the Clinic/);
  assert.equal(await phone.evaluate(`document.querySelector('.sheet [data-moved="scout.clinic"] [data-to]').dataset.to`), '#/clinic');
});
