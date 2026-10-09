// docs/simplify.md §5 and FR-SIMP-04 on the screens of the pass: no margin,
// profit, crop value, cashflow, labour rate or labour cost, and no
// verification finding, on any of them for anyone below the Owner — and no
// money at all for a Greenhouse Hand or a Field Supervisor. The server side
// and the Owner's own screens are held by owner-decisions.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

globalThis.location ??= { hash: '' };
const load = (p) => import(new URL(`../web/js/${p}`, import.meta.url).href);
const { todayView, myReportsView, pickedToday } = await load('ui/worker.js');
const { sickPlantView } = await load('ui/sickplant.js');
const { shiftView } = await load('ui/shift.js');
const { learnView, learnCardView } = await load('ui/learn.js');
const { gatesView } = await load('ui/gates.js');

const { state } = await sampleState();
const OWNER_ONLY = /margin|profit|crop value|cash ?flow|labour cost|daily rate|rate per position|verification|finding/i;
const MONEY = /₦|naira|\bprice\b|revenue/i;

function screens(user) {
  const ctx = ctxFor(state, user);
  sickPlantView.enter(ctx);
  globalThis.location.hash = '#/learn/card?id=thrips';
  return {
    home: todayView.render(ctx), reports: myReportsView.render(ctx), picked: pickedToday(state, user),
    sick: sickPlantView.render(ctx), shift: shiftView.render(ctx), learn: learnView.render(ctx),
    card: learnCardView.render(ctx), gates: gatesView.render(ctx),
  };
}

for (const [id, who] of [['sp_emeka', 'Greenhouse Hand'], ['sp_tamuno', 'Field Supervisor'], ['sp_ada', 'Farm Manager']]) {
  test(`FR-SIMP-04: nothing Owner-only on the passed screens for the ${who}`, () => {
    for (const [name, html] of Object.entries(screens(state.people[id]))) {
      const words = html.replace(/<[^>]+>/g, ' ');
      assert.ok(!OWNER_ONLY.test(words), `${name}: ${(OWNER_ONLY.exec(words) || [])[0]}`);
      if (id !== 'sp_ada') assert.ok(!MONEY.test(words), `${name} shows money to the ${who}: ${(MONEY.exec(words) || [])[0]}`);
    }
  });
}
