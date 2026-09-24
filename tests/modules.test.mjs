// Every browser module parses.
//
// The unit tests import the domain files, never web/js/app.js, which touches
// the DOM at load. So a syntax error there — a binding imported twice by a
// merge, as happened with doctorView — left every test green while the app
// itself stopped at "Loading…" on every phone. This checks each module the
// way the browser would, without running it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/js/', import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}${name}`;
    return statSync(path).isDirectory() ? files(`${path}/`) : name.endsWith('.js') ? [path] : [];
  });
}

test('every module under web/js parses as an ES module', () => {
  for (const file of files(root)) {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(file, 'utf8'), encoding: 'utf8',
    });
    assert.equal(r.status, 0, `${file.slice(root.length)}: ${r.stderr}`);
  }
});
