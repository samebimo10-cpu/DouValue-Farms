// Erasing a phone never takes unsent records with it — NFR-DATA-02, and the
// brief's "never silently discard unsynchronized records".
//
// Settings → Erase everything on this phone used to say "export first" and
// clear the log. A record that has not reached the farm server exists only on
// that phone, so a manager tidying a shared handset deleted a hand's unsent
// harvests for good. Now the warning gives the number, and a backup file is
// saved before anything is cleared whenever such records exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { eraseWarning } = await import('../web/js/ui/manage.js');

test('with nothing unsent, erasing says the records are safe on the farm', () => {
  const text = eraseWarning(0, true);
  assert.match(text, /already reached the farm server/);
  assert.doesNotMatch(text, /backup file/);
});

test('unsent records on a connected phone are counted and named as existing nowhere else', () => {
  assert.match(eraseWarning(1, true), /1 record on this phone has not reached the farm server/);
  const text = eraseWarning(7, true);
  assert.match(text, /7 records on this phone have not reached the farm server yet and exist nowhere else/);
  assert.match(text, /backup file of everything is saved to this phone first/);
});

test('on a farm with no server, every record is said to exist only here', () => {
  const text = eraseWarning(42, false);
  assert.match(text, /no server, so all 42 records exist only here/);
  assert.match(text, /backup file/);
});

test('the erase action saves the backup before it clears anything, whenever records are unsent', () => {
  const source = readFileSync(new URL('../web/js/ui/manage.js', import.meta.url), 'utf8');
  const start = source.indexOf("'wipe-data': async");
  assert.ok(start > 0, 'the erase action exists');
  const body = source.slice(start, source.indexOf('location.reload()', start));
  const counted = body.indexOf('await countUnsynced()');
  const backup = body.indexOf('await downloadBackup()');
  const cleared = body.indexOf('await clearEvents()');
  assert.ok(counted >= 0, 'it counts what has not been sent');
  assert.ok(backup >= 0, 'it saves a backup when there is something unsent');
  assert.ok(counted < backup && backup < cleared, 'counted, then backed up, then cleared — in that order');
  assert.match(body, /if \(unsent\) \{\s*const bundle = await downloadBackup\(\)/);
});
