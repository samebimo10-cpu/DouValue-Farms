// Simplification pass 3 of 8: the sick-plant report — FR-SIMP-07.
//
// The sent screen is drawn only after a real send, which the 360 px test
// does for a serious report. The quiet case is held here, from the source:
// what happens next is still said, one tap away, and still names where the
// answer will appear.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

const source = readFileSync(new URL('../web/js/ui/sickplant.js', import.meta.url), 'utf8');
const { sickPlantView } = await import(new URL('../web/js/ui/sickplant.js', import.meta.url).href);

test('Sick-plant report moved: what happens after a quiet report is one tap behind "What happens next"', () => {
  assert.match(source, /more\('What happens next', '<p><small>They will look at the plant and work out what it is\. '/);
  assert.match(source, /\{ id: 'sick-plant\.next' \}/);
  assert.match(source, /"Your sick-plant reports"/);
});

test('Sick-plant report moved: how a serious report climbs is one tap behind "What happens next"', () => {
  assert.match(source, /4 hours it goes to the Field Supervisor/);
  assert.match(source, /closed in 12 hours, to the Owner/);
  assert.match(source, /\{ id: 'sick-plant\.ladder' \}/);
});

test('Sick-plant report: the first step still opens on the zones, with Next as the main action', async () => {
  const { state } = await sampleState();
  sickPlantView.enter(ctxFor(state, state.people.sp_emeka));
  const html = sickPlantView.render(ctxFor(state, state.people.sp_emeka));
  assert.match(html, /Which zone\?/);
  assert.match(html, /data-main-action="sick-plant"/);
});
