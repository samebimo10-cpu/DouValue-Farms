// Simplification pass 5 of 8: the spray screen — FR-SIMP-02, 07, 08 and §5's
// "every safety element on the spray screen is still present and prominent",
// in a real Chrome at 360 px.
//
// docs/simplify.md: PPE, re-entry, pre-harvest interval and dose are category
// 1. The pass leaves every one of them on the screen and moves them up, to sit
// under the product they belong to. Only what surrounds them moved
// (docs/simplify-pass/05-spray.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, PHONE, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open Log spray on the first bed, as the Field Supervisor; stop at the gear. */
async function openGear() {
  await phone.as('sp_tamuno', '#/field');
  await phone.tap('[data-act="open-spray"]');
  await phone.page.waitFor(`!!document.querySelector('.sheet [data-role="yes"]')`, { what: 'the PPE sheet' });
}
async function openForm() {
  await openGear();
  await phone.evaluate(`document.querySelector('.sheet [data-role="yes"]').click(); true`);
  await phone.page.waitFor(`!!document.querySelector('.sheet form[data-act="save-spray"] #spray-hint .note')`, { what: 'the spray form' });
}

test('FR-TREAT-04: the gear is shown as pictures before the spray, every item, none behind a tap', opts, async () => {
  await openGear();
  const gear = await phone.evaluate(`(() => {
    const sh = document.querySelector('.sheet');
    return {
      items: [...sh.querySelectorAll('.ppe-item')].map((f) => ({ pic: !!f.querySelector('svg'), label: f.querySelector('b').textContent, hidden: !!f.closest('details') })),
      details: sh.querySelectorAll('details').length,
      confirm: sh.querySelector('[data-role="yes"]').textContent,
    };
  })()`);
  assert.ok(gear.items.length >= 2, 'the kit has its items');
  for (const item of gear.items) {
    assert.ok(item.pic, `${item.label} has its picture`);
    assert.equal(item.hidden, false, `${item.label} is on the screen`);
  }
  assert.equal(gear.details, 0, 'nothing on the gear sheet is folded away');
  assert.equal(gear.confirm, 'I am wearing all of this');
  // Deliberately not held in reach like a save button: the confirmation comes
  // after the last picture, so reaching it means passing every item.
  assert.equal(await phone.evaluate(`(() => {
    const sh = document.querySelector('.sheet');
    const items = [...sh.querySelectorAll('.ppe-item')];
    const yes = sh.querySelector('[data-role="yes"]');
    return items.every((i) => i.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`), true, 'every item comes before the confirmation');
});

test('Spray safety: waiting period, re-entry, rate and mixing are on the screen, under the product, without scrolling', opts, async () => {
  await openForm();
  const safety = await phone.evaluate(`(() => {
    const hint = document.querySelector('.sheet #spray-hint');
    const notes = [...hint.querySelectorAll(':scope > .note')];
    const shown = (re) => notes.find((n) => re.test(n.querySelector('b').textContent));
    const box = (n) => n ? Math.round(n.getBoundingClientRect().top) : null;
    const phi = shown(/^Waiting period: \\d+ days? before picking/);
    const rate = shown(/^Rate: /);
    const mix = shown(/^Mixing/);
    const visibleText = (n) => { const c = n.cloneNode(true); c.querySelectorAll('details').forEach((d) => d.remove()); return c.textContent; };
    const order = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      phi: phi && visibleText(phi), phiTop: box(phi),
      rate: rate && visibleText(rate), mix: mix && visibleText(mix),
      folded: notes.filter((n) => n.closest('details')).length,
      afterProduct: !!order(document.querySelector('.sheet select[name=activeId]'), hint),
      beforeLitres: !!order(hint, document.querySelector('.sheet input[name=litres]')),
    };
  })()`);
  assert.match(safety.phi, /safe to pick from \d{4}-\d\d-\d\d/, 'the pre-harvest interval (FR-TREAT-02)');
  assert.match(safety.phi, /Nobody goes back in without protective gear for \d+ hours/, 'the re-entry interval (FR-TREAT-02)');
  assert.match(safety.rate, /^Rate: .+/, 'the dose (FR-TREAT-03)');
  assert.match(safety.mix, /knapsack load.* ml of product per load/, 'the dose as a sprayer measure (FR-TREAT-03)');
  assert.equal(safety.folded, 0, 'no safety note is behind a tap');
  assert.ok(safety.afterProduct && safety.beforeLitres, 'they sit under the product, before the rest of the form');
  assert.ok(safety.phiTop < PHONE.height, `the waiting period is on the first screen (at ${safety.phiTop} px)`);
});

test('Spray safety: choosing another product changes its waiting period and rate on the screen', opts, async () => {
  await openForm();
  const read = () => phone.evaluate(`document.querySelector('.sheet #spray-hint').innerText`);
  const first = await read();
  const other = await phone.evaluate(`(() => {
    const sel = document.querySelector('.sheet select[name=activeId]');
    const next = [...sel.options].find((o) => o.value !== sel.value && /neem|azadirachtin/i.test(o.textContent))
      || [...sel.options].find((o) => o.value !== sel.value);
    sel.value = next.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return next.textContent;
  })()`);
  await sleep(300);
  const second = await read();
  assert.notEqual(second, first, `the hints followed the choice of ${other}`);
  assert.match(second, /Waiting period: \d+ days? before picking/);
  assert.match(second, /Rate: /);
});

test('FR-SIMP-08 spray: Save spray is in reach, and the form keeps every box it had', opts, async () => {
  await openForm();
  assertReachable('Spray', await phone.mainAction('.sheet [data-main-action="spray"]'));
  assert.deepEqual(await phone.sheetControls(),
    ['cycleId', 'activeId', 'labelId', 'date', 'litres', 'areaM2', 'targetProblem', 'operator', 'note', 'photo']);
});

test('Spray moved: where the rate comes from, why the container photo, and which rule refused, one tap each', opts, async () => {
  await openForm();
  const moved = (id) => phone.evaluate(`(() => { const el = document.querySelector('.sheet [data-moved="${id}"]');
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  assert.match(await moved('spray.rate-source'), /^Where this rate comes from ?From (the operations schedule|the label entered)/);
  assert.match(await moved('spray.photo-why'), /The label carries the real waiting period and the real rate/);
  // The sample's first product is refused in Week 10 on this bed: the refusal
  // stays on the screen, the rule file it was read from is one tap away.
  const refusal = await moved('spray.refusal-source');
  if (refusal) assert.match(refusal, /^Which rule ?Read from rules\//);
  // The full spray safety rules were behind a tap before the pass and still are.
  assert.match(await phone.evaluate(`document.querySelector('.sheet #spray-hint details:not(.more)').textContent`),
    /Spray safety rules.*pregnant or under 18/s);
});
