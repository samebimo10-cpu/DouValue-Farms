// Simplification pass 8 of 8: the gates screen — FR-SIMP-08, in a real Chrome
// at 360 px (docs/simplify-pass/08-gates.md).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };

test('FR-SIMP-08 gates: the next thing to record for a blocked zone is in reach', opts, async () => {
  await phone.as('sp_tamuno', '#/gates');
  const at = await phone.mainAction('[data-main-action="gates"]');
  assertReachable('Gates', at);
  assert.match(at.label, /Record|Run and save|Log a|Fill bags|Draft/);
});

test('Gates: tapping the main action opens the same recording as the button on its gate', opts, async () => {
  await phone.as('sp_tamuno', '#/gates');
  const [main, same] = await phone.evaluate(`(() => {
    const m = document.querySelector('[data-main-action="gates"]');
    const twin = [...document.querySelectorAll('section.card button')].find((b) => b !== m
      && b.dataset.act === m.dataset.act && b.textContent === m.textContent);
    return [m.dataset.act, !!twin];
  })()`);
  assert.ok(same, `the gate card still carries ${main}`);
});
