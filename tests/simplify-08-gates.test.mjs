// Simplification pass 8 of 8: the gates screen — FR-SIMP-01, 07 and the
// CLAUDE.md rule that no gate is weakened, rendered in Node
// (docs/simplify-pass/08-gates.md).
//
// The pass changes how the gates are drawn, never what they decide: the same
// gateBoard and gateModel feed the screen. Every condition of every gate is
// still drawn — still to clear on the screen, passed one tap away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

const load = (p) => import(new URL(`../web/js/${p}`, import.meta.url).href);
const { gatesView } = await load('ui/gates.js');
const { gateBoard } = await load('domain/gates.js');
const { isoDate } = await load('util.js');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const onScreen = (html) => html.replace(/<details class="more"[\s\S]*?<\/details>/g, '');

const { state } = await sampleState();
const sup = state.people.sp_tamuno;
const html = gatesView.render(ctxFor(state, sup));
const board = gateBoard(state, { today: isoDate(), now: new Date().toISOString() }).filter((r) => !r.zone.retired);
const open = board.find((r) => !r.ok) || board[0];

test('Gates: the next thing to record for the open zone is the screen\'s main action, under the heading', () => {
  const next = html.indexOf('Next for ');
  assert.ok(next > 0 && next < html.indexOf('data-act="gates-zone"'), 'before the board');
  assert.match(html, /data-main-action="gates"/);
  assert.match(text(html.slice(next, html.indexOf('data-main-action="gates"') + 300)), new RegExp(`Next for ${open.zone.name.replace(/[()]/g, '.')}`));
});

test('Gates: every zone is still on the board, and every blocked one on the screen', () => {
  for (const r of board) assert.ok(html.includes(`data-act="gates-zone" data-id="${r.zone.id}"`), r.zone.name);
  for (const r of board.filter((x) => !x.ok)) {
    assert.ok(onScreen(html).includes(`data-act="gates-zone" data-id="${r.zone.id}"`), `${r.zone.name} is blocked and on the screen`);
  }
});

test('No gate weakened: every condition of the open zone is drawn; those still to clear on the screen', () => {
  const seen = text(onScreen(html));
  const all = text(html);
  assert.ok(!html.includes('&amp;amp;'), 'a gate name is escaped once ("Cycle Close & Learn")');
  for (const g of open.model.gates) {
    assert.ok(seen.includes(`${g.id} — ${g.name}`), `${g.id} on the screen`);
    for (const c of g.conditions) {
      const name = c.label || c.name;
      assert.ok(all.includes(name), `${g.id}: ${name} is drawn`);
      if (c.state !== 'pass') assert.ok(seen.includes(name), `${g.id}: ${name} is still to clear and on the screen`);
    }
  }
});

test('Gates moved: passed conditions, and when/what/evidence/source of each gate, are one tap away', () => {
  const passed = open.model.gates.flatMap((g) => g.conditions.filter((c) => c.state === 'pass'));
  if (passed.length) {
    assert.match(html, /data-moved="gates.passed"><summary>\d+ passed<\/summary>/);
    assert.ok(!text(onScreen(html)).includes(`✓ ${passed[0].label || passed[0].name}`), 'a passed row is off the screen');
  }
  assert.match(html, /data-moved="gates.gate-about"><summary>About this gate<\/summary>/);
  const g = open.model.gates.find((x) => x.source);
  if (g) assert.ok(text(html).includes(`Source: ${g.source}`));
});

test('Gates moved: what the gates are, and the soil tests they read, are one tap away', () => {
  assert.match(html, /data-moved="gates.about"><summary>What the gates are<\/summary>/);
  assert.match(text(html), /These are the four things that cost Season 1/);
  assert.ok(!text(onScreen(html)).includes('four things that cost Season 1'));
});

test('Gates: the Owner\'s override and the supervised-use banner are still on the screen', async () => {
  const owner = gatesView.render(ctxFor(state, state.people.sp_owner));
  assert.match(onScreen(owner), /data-act="open-override"/, 'Only the Owner overrides (FR-GATE-07), from the screen');
  assert.ok(!/data-act="open-override"/.test(html), 'and nobody else');
  assert.match(text(onScreen(html)), /Field trial: supervised use/, 'UX-27');
});
