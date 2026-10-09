// Simplification pass 1 of 8: Home — FR-SIMP-08, in a real Chrome at 360 px.
//
// The app served from the repository, the sample farm loaded, one person
// signed in: the next job's Done is on the screen with nothing scrolled, and
// not under the tab bar.

import { after, before, test } from 'node:test';
import { assertReachable, openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };

test('FR-SIMP-08 Home: a hand reaches the next job\'s Done without scrolling', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  assertReachable('Home (hand)', await phone.mainAction());
});

test('FR-SIMP-08 Home: so does a supervisor, with My work / The farm and a blocked bed above it', opts, async () => {
  await phone.as('sp_tamuno', '#/today');
  assertReachable('Home (supervisor)', await phone.mainAction());
});
