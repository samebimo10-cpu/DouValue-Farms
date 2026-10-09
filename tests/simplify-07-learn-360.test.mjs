// Simplification pass 7 of 8: the Learn area — FR-SIMP-08, in a real Chrome
// at 360 px (docs/simplify-pass/07-learn.md).

import { after, before, test } from 'node:test';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };

test('FR-SIMP-08 Learn: the search is in reach on the list', opts, async () => {
  await phone.as('sp_emeka', '#/learn');
  assertReachable('Learn', await phone.mainAction('[data-main-action="learn"]'));
});

test('FR-SIMP-08 Learn: on a card, Report a sick plant is in reach', opts, async () => {
  await phone.as('sp_emeka', '#/learn/card?id=thrips');
  assertReachable('Learn card', await phone.mainAction('[data-main-action="learn-card"]'));
});
