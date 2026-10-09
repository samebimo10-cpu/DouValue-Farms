// Simplification pass 5 of 8: the spray screen — FR-SIMP-02 and the safety
// elements, from the source.
//
// The pass changed what is drawn around the spray form, not what a spray
// files or what is asked before it is filed: the record, the confirmation
// summary (UX-21) and the gear (FR-TREAT-04) are held here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const field = readFileSync(new URL('../web/js/ui/field.js', import.meta.url), 'utf8');
const ppe = readFileSync(new URL('../web/js/ui/ppe.js', import.meta.url), 'utf8');

test('FR-SIMP-02 spray: the spray record still carries every field', () => {
  const start = field.indexOf("await ctx.store.dispatch('spray.record', {");
  const record = field.slice(start, field.indexOf('ppeConfirmedAt = null;', start));
  for (const key of ['diagnosisId', 'supervision', 'id: sprayId', 'cycleId', 'activeId', 'productId', 'labelId',
    'productName', 'group', 'rate:', 'phiDays', 'reiHours', 'litres', 'areaM2', 'targetProblem', 'operator',
    'note:', 'date:', 'ppeConfirmedAt', 'photo:', 'at:', 'enteredAt']) {
    assert.ok(record.includes(key), `the spray record lost ${key}`);
  }
});

test('UX-21: the summary before saving still names the waiting period and the re-entry', () => {
  for (const row of ["['Active ingredient'", "['Resistance group'", "['Rate'", "['Mix sprayed'",
    "['No picking until'", "['Keep people out for'"]) {
    assert.ok(field.includes(row), `the confirmation lost ${row}`);
  }
});

test('FR-TREAT-04: the gear sheet is untouched by the pass — nothing on it folded away', () => {
  assert.ok(!/more\(/.test(ppe), 'no disclosure on the gear sheet');
  assert.match(ppe, /I am wearing all of this/);
  assert.match(field, /const worn = await confirmPpe\(kit, \{ title: 'Before you spray, put this on' \}\);/);
});

test('Spray safety: the waiting period, re-entry, rate and mixing notes are not behind a disclosure', () => {
  const hints = field.slice(field.indexOf('function updateSprayHints('), field.indexOf('async function saveSpray('));
  assert.match(hints, /note\(active\.phiDays >= 7 \? 'warn' : 'info',\n\s+`Waiting period:/);
  assert.match(hints, /Nobody goes back in without protective gear for \$\{active\.reiHours\} hours/);
  assert.match(hints, /note\('info', `Rate: \$\{esc\(rate\.rate\)\}`/);
  assert.match(hints, /note\('info', 'Mixing'/);
  assert.ok(!/more\([^)]*Waiting period/.test(hints) && !/more\([^)]*Mixing/.test(hints));
});
