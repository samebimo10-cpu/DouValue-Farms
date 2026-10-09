// The simplification pass report — docs/simplify-pass/, FR-SIMP-06 and 07.
//
// One file per screen. Every element is listed with its rating from
// docs/simplify.md §1, and every element rated 3 or 4 says where it went: a
// moved element that lands nowhere is a deleted one (FR-SIMP-01).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../docs/simplify-pass/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
const PASS = files.map((f) => readFileSync(new URL(f, DIR), 'utf8')).join('\n');

const SCREENS = ['Home', 'Trap check and scouting', 'Sick-plant report', 'Harvest entry',
  'Spray screen', 'End-of-shift report', 'The Learn area', 'The gates screen'];

test('FR-SIMP-06: each screen of the pass has its file, in the order of docs/simplify.md', () => {
  assert.ok(files.length >= 1);
  files.forEach((f, i) => {
    const head = readFileSync(new URL(f, DIR), 'utf8').split('\n')[0];
    assert.equal(head, `# Simplification pass ${i + 1} of 8 — ${SCREENS[i]}`, f);
  });
});

test('FR-SIMP-06: every element is rated 1 to 4', () => {
  const rows = PASS.split('\n').filter((l) => /^\| /.test(l) && !/^\| (Element|---)/.test(l));
  assert.ok(rows.length > 10);
  for (const row of rows) {
    const rating = row.split('|')[2].trim();
    assert.match(rating, /^[1-4]\b|^—$/, `not rated: ${row}`);
  }
});

test('FR-SIMP-07: every element rated 3 or 4 says where it went', () => {
  for (const line of PASS.split('\n').filter((l) => /^\| .* \| [34] \|/.test(l))) {
    const cells = line.split('|').map((c) => c.trim());
    const went = cells[3];
    assert.ok(went && !/^(—|-|stays|kept)$/i.test(went), `no destination for: ${cells[1]}`);
  }
});
