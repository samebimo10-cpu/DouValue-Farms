// Simplification pass 7 of 8: the Learn area — FR-SIMP-07 with FR-LEARN-01
// to 05, rendered in Node (docs/simplify-pass/07-learn.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

globalThis.location ??= { hash: '' };
const { learnView, learnCardView } = await import(new URL('../web/js/ui/learn.js', import.meta.url).href);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const onScreen = (html) => html.replace(/<details class="more"[\s\S]*?<\/details>/g, '');

const { state } = await sampleState();
const hand = state.people.sp_emeka;
const sup = state.people.sp_tamuno;
const cardFor = (id, user) => { globalThis.location.hash = `#/learn/card?id=${id}`; return learnCardView.render(ctxFor(state, user)); };

test('Learn: the search is the list\'s main action, and the kinds and cards stay', () => {
  const html = learnView.render(ctxFor(state, hand));
  assert.match(html, /name="learn-q" type="search" data-main-action="learn"/);
  assert.match(html, /data-act="learn-kind"/);
  assert.match(html, /href="#\/learn\/card\?id=thrips"/);
  assert.match(text(html), /how to catch them early/, 'what Learn is for is still said on Learn (pass 1 sent it here)');
});

test('Learn: a hand\'s card keeps every section FR-LEARN-02 asks for, on the screen', () => {
  const seen = text(onScreen(cardFor('thrips', hand)));
  for (const section of ['How to recognise it', 'How to catch it early', 'Often confused with', 'What to do first']) {
    assert.ok(seen.includes(section), section);
  }
  assert.match(seen, /Tell them apart:/);
});

test('Learn moved: Report a sick plant is at the top of the card as its main action, and still under What to do first', () => {
  const html = cardFor('thrips', hand);
  const top = html.indexOf('data-main-action="learn-card"');
  assert.ok(top > 0 && top < html.indexOf('How to recognise it'), 'before the first section');
  assert.match(html.slice(html.indexOf('What to do first')), /data-to="#\/sick-plant"/);
});

test('Learn moved: why doses are not on the hand\'s view is behind "Why they are not here", for a supervisor only', () => {
  const html = cardFor('thrips', sup);
  assert.match(html, /Open the full card: doses, groups, treatment plan/);
  assert.match(html, /data-moved="learn.full-card-why"><summary>Why they are not here<\/summary>/);
  assert.match(text(html), /kept off this view, which is what a Greenhouse Hand sees/);
  assert.ok(!/learn.full-card-why|Open the full card/.test(cardFor('thrips', hand)), 'a hand gets neither');
});

test('Learn moved: why a card is not yet reviewed is behind "Why" on its warning', async () => {
  const { learnCard, learnSearch } = await import(new URL('../web/js/domain/learn.js', import.meta.url).href);
  const drafted = learnSearch('').map((c) => c.id).filter((id) => (learnCard(state, id) || {}).drafted);
  assert.ok(drafted.length, 'the rules carry cards not yet reviewed');
  const html = cardFor(drafted[0], hand);
  assert.match(html, /Not yet reviewed/);
  assert.match(html, /data-moved="learn.drafted"><summary>Why<\/summary>/);
  assert.ok(text(html).includes(learnCard(state, drafted[0]).drafted));
});
