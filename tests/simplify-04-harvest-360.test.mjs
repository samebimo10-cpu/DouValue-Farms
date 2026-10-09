// Simplification pass 4 of 8: harvest entry — FR-SIMP-02, 07, 08, in a real
// Chrome at 360 px.
//
// Log harvest from My work: the bed, crates, kilograms, grade, a note and a
// photo, as before. The crop's stage and how crates are counted moved one tap
// away; Save is in reach on the open sheet; a saved picking carries every
// field it did (docs/simplify-pass/04-harvest.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };
const moved = (id) => phone.evaluate(`(() => {
  const el = document.querySelector('.sheet [data-moved="${id}"]');
  return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
})()`);

test('FR-SIMP-08 harvest: Save is in reach, and the form keeps every box it had', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-harvest"]');
  assertReachable('Harvest', await phone.mainAction('.sheet [data-main-action="harvest"]'));
  assert.deepEqual(await phone.evaluate(`[...document.querySelectorAll('.sheet form input, .sheet form select, .sheet form textarea')].map((e) => e.name)`),
    ['cycleId', 'crates', 'kg', 'grade', 'note', 'photo']);
});

test('Harvest moved: the crop\'s stage, the crate size and the photo note are behind "About this bed and the crates"', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-harvest"]');
  const about = await moved('harvest.about');
  assert.match(about, /^About this bed and the crates/);
  assert.match(about, /— [A-Z]/, 'the crop and its stage');
  assert.match(about, /One crate is counted as \d+ kg/);
  assert.match(about, /works them out from the crates/);
  assert.match(about, /settles any question later/);
});

test('FR-SIMP-02 harvest: a saved picking carries bed, crates, kilograms, grade, note and photo', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-harvest"]');
  await phone.attachPhoto("document.querySelector('.sheet')");
  const bed = await phone.evaluate(`document.querySelector('.sheet select[name=cycleId]').value`);
  const before = await phone.evaluate('__douvalueCtx.store.state.harvests.length');
  await phone.evaluate(`(() => {
    const f = document.querySelector('.sheet form');
    f.querySelector('[name=crates]').value = '3';
    f.querySelector('[name=grade]').value = 'second';
    f.querySelector('[name=note]').value = 'Some sunscald';
    f.requestSubmit();
    return true;
  })()`);
  await phone.page.waitFor(`__douvalueCtx.store.state.harvests.length > ${before}`, { what: 'the picking to save' });
  const h = await phone.evaluate(`(() => { const h = __douvalueCtx.store.state.harvests.find((x) => x.note === 'Some sunscald');
    return { cycleId: h.cycleId, crates: h.crates, kg: h.kg, grade: h.grade, note: h.note, photo: !!(h.photo && h.photo.dataUrl), date: h.date }; })()`);
  assert.equal(h.cycleId, bed);
  assert.equal(h.crates, 3);
  assert.ok(h.kg > 0);
  assert.equal(h.grade, 'second');
  assert.equal(h.note, 'Some sunscald');
  assert.equal(h.photo, true);
  assert.ok(h.date);

  // Pass 1 put "What you picked today" on this sheet; the new picking is on it.
  await phone.tap('[data-act="open-harvest"]');
  assert.match(await moved('home.picked-today'), /What you picked today: \d+/);
});

test('Harvest moved: why a bed in its PHI must not be picked is behind "Why it matters"', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-harvest"]');
  await phone.evaluate(`(() => {
    const sel = document.querySelector('.sheet select[name=cycleId]');
    sel.value = 'sp_c2';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await phone.page.waitFor(`!!document.querySelector('.sheet [data-moved="harvest.phi-why"]')`, { what: 'the PHI block' });
  const block = await phone.evaluate(`document.querySelector('#harvest-body').innerText`);
  assert.match(block, /more days?\./, 'how long is still on the screen');
  assert.match(block, /Tell the supervisor/);
  assert.match(await moved('harvest.phi-why'), /puts the buyer and whoever eats it at risk/);
  assert.equal(await phone.evaluate(`!!document.querySelector('.sheet form[data-act="save-harvest"]')`), false,
    'and there is still no way to save a picking from it (FR-TREAT-02)');
});
