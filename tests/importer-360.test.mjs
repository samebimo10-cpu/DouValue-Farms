// Bringing existing records in, in a real Chrome at 360 px — Phase 2.
//
// The whole path on a phone: paste cells from a spreadsheet, match the
// columns, see every row checked, confirm, and undo; type rows in from a
// paper report; print a blank sheet. Set SCREENSHOTS=<dir> to keep a picture
// of each step.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPhone, PHONE, skip } from './helpers/phone.mjs';

const { SHEET_ROWS } = await import('../web/js/ui/importer.js');

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => phone.evaluate(`document.querySelector('#app').innerText`);
const width = () => phone.evaluate('document.documentElement.scrollWidth');

async function shot(name) {
  if (!process.env.SCREENSHOTS) return;
  const { data } = await phone.page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(process.env.SCREENSHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

test('a spreadsheet pasted in on a phone: matched, checked, shown, confirmed, and undone', opts, async () => {
  await phone.as('sp_ada', '#/import');
  assert.match(await text(), /Bring in existing records/);
  assert.ok((await width()) <= PHONE.width, 'no sideways scroll');
  await shot('1-start');

  await phone.tap('[data-act="imp-spreadsheet"]');
  const zone = await phone.evaluate(`Object.values(__douvalueCtx.store.state.plots)[0].name`);
  const pasted = `Date\\tHouse\\tWeight kg\\tGrade\\n02/03/2026\\t${zone}\\t42\\tA\\n03/03/2026\\tGH-99\\t10\\t\\n04/03/2026\\t\\t18\\tB\\n`;
  await phone.evaluate(`document.querySelector('textarea[name=pasted]').value = "${pasted}"; true`);
  await shot('2-paste');
  await phone.tap('[data-act="imp-read"]');
  assert.match(await text(), /Match the columns/);
  assert.equal(await phone.evaluate(`document.querySelector('select[name=col_kg]').value`), '2', 'Weight kg is guessed as kilograms');
  await shot('3-map');

  await phone.evaluate(`document.querySelector('form[data-act="imp-map"]').requestSubmit(); true`);
  await sleep(400);
  const preview = await text();
  assert.match(preview, /Check before importing/);
  assert.match(preview, /No zone called "GH-99"/);
  assert.match(preview, /farm's totals/);
  assert.ok((await width()) <= PHONE.width, 'the preview does not scroll sideways');
  await shot('4-preview');

  const before = await phone.evaluate('__douvalueCtx.store.state.harvests.length');
  await phone.tap('[data-act="imp-confirm"]');
  assert.match(await phone.evaluate(`document.querySelector('.sheet').innerText`), /Import 2 rows\?/);
  await phone.tap('.sheet [data-role="yes"]');
  await sleep(500);
  assert.match(await text(), /2 rows brought in as history/);
  await shot('5-done');
  const s = await phone.evaluate(`(() => { const st = __douvalueCtx.store.state;
    return { live: st.harvests.length, history: st.history.harvest.length, imports: Object.keys(st.imports).length }; })()`);
  assert.equal(s.live, before, 'no live harvest was made');
  assert.equal(s.history, 2);
  assert.equal(s.imports, 1);

  await phone.tap('[data-act="imp-restart"]');
  assert.match(await text(), /Past imports/);
  await phone.tap('[data-act="imp-undo"]');
  await phone.evaluate(`(() => { const f = document.querySelector('.sheet form'); f.querySelector('[name=reason]').value = 'wrong file'; f.requestSubmit(); return true; })()`);
  await sleep(500);
  assert.match(await text(), /undone: wrong file/);
  await shot('6-undone');
});

test('a paper report typed in row by row, kept if the app is closed, then checked', opts, async () => {
  await phone.as('sp_ada', '#/import');
  await phone.tap('[data-act="imp-kind"][data-kind="expense"]');
  await phone.tap('[data-act="imp-typed"][data-source="paper"]');
  assert.match(await text(), /Paper report, typed in/);
  await shot('7-typed');
  await phone.evaluate(`(() => { const f = document.querySelector('form[data-act="imp-add-row"]');
    f.querySelector('[name=f_date]').value = '2026-02-01';
    f.querySelector('[name=f_item]').value = 'Diesel for the pump';
    f.querySelector('[name=f_amount]').value = '45,000';
    f.requestSubmit(); return true; })()`);
  await sleep(400);
  assert.match(await text(), /Rows so far: 1/);
  assert.deepEqual(await phone.evaluate(`(async () => (await import('./js/db.js')).getMeta('importTyped'))()`)
    .then((d) => d.rows.length), 1, 'the typed row is kept on the phone');
  await phone.tap('[data-act="imp-check-typed"]');
  assert.match(await text(), /Import 1 row/);
});

test('a blank sheet to print and fill in by hand', opts, async () => {
  await phone.as('sp_ada', '#/import/sheet?kind=sale');
  const t = await text();
  assert.match(t, /Sales history — record sheet/);
  assert.match(t, /Leave a box empty if you do not know it/);
  assert.equal(await phone.evaluate(`document.querySelectorAll('#app tbody tr').length`), SHEET_ROWS);
  await shot('8-sheet');
});

test('a farm hand cannot open it', opts, async () => {
  await phone.as('sp_emeka', '#/import');
  assert.doesNotMatch(await text(), /Bring in existing records/);
});
