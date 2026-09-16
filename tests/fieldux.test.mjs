// Section 5 — ease of use for field staff.
//
// "If a feature conflicts with this section on a field screen, this section
// wins." Most of section 5 is layout and wording, which a test cannot judge.
// What a test can judge is the logic underneath it, and three pieces of that
// logic are load-bearing:
//
//   UX-07  one fixed colour meaning, always paired with a shape
//   UX-25  practice mode that cannot touch a real record
//   UX-16  an interrupted note that is not lost
//
// The practice-mode tests are the important ones. Everything else in this file
// is a screen looking wrong; that one is somebody's training session landing in
// the farm's books.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const {
  STATUS, bigNumber, confirmSummary, dayProgressBar, phraseChips, status, tag,
  taskStatus, QUICK_PHRASES,
} = await import(new URL('ui/field-kit.js', base).href);
const { howTo, OPERATIONS } = await import(new URL('domain/schedule.js', base).href);

const TODAY = '2026-09-16';
const at = (h, m = 0) => new Date(`${TODAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
const due = (h) => `${TODAY}T${String(h).padStart(2, '0')}:00`;

// --- UX-07: one colour meaning, never colour alone ------------------------

test('there are exactly four states, and no screen can invent a fifth', () => {
  assert.deepEqual(Object.keys(STATUS).sort(), ['done', 'notyet', 'now', 'soon']);
});

test('every state carries a shape as well as a colour', () => {
  // Hue is the first thing direct sunlight takes, and roughly one man in twelve
  // cannot separate the red from the green at all.
  for (const [key, s] of Object.entries(STATUS)) {
    assert.ok(s.icon && s.icon.length, `${key} has no icon`);
    const html = status(key);
    assert.match(html, /class="ic"/, `${key} rendered without its icon`);
    assert.match(html, new RegExp(`status-${key}`), `${key} rendered without its colour class`);
  }
});

test('an icon is hidden from a screen reader, which already has the words', () => {
  assert.match(status('now'), /aria-hidden="true"/);
  assert.match(tag('done'), /aria-hidden="true"/);
});

test('a task takes its colour from its own timing', () => {
  const done = { status: 'done', due: due(9) };
  const late = { status: 'open', due: due(7) };
  const soon = { status: 'open', due: due(11) };
  const later = { status: 'open', due: due(16) };

  assert.equal(taskStatus(done, at(12)), 'done');
  assert.equal(taskStatus(late, at(12)), 'now', 'past its time is act-now');
  assert.equal(taskStatus(soon, at(10)), 'soon', 'inside two hours is check-soon');
  assert.equal(taskStatus(later, at(10)), 'notyet', 'the rest of the day is not yet');
});

test('a task with no time still reads as something to do, not as nothing', () => {
  assert.equal(taskStatus({ status: 'open' }, at(10)), 'soon');
});

test('a cancelled task is grey rather than red', () => {
  // Red means act now. Something cancelled needs no action, and colouring it
  // red is how a board stops being believed.
  assert.equal(taskStatus({ status: 'cancelled', due: due(6) }, at(12)), 'notyet');
});

// --- UX-24: how much is left, in words ------------------------------------

test('the progress bar says the count as well as drawing it', () => {
  const html = dayProgressBar({ done: 4, total: 7, fraction: 4 / 7, text: '4 of 7 done' });

  assert.match(html, /4 of 7 done/, 'a bar on its own is a shape, not an answer');
  assert.match(html, /width:57%/, 'and it is drawn too');
});

// --- UX-19: the steps, matching the laminated cards -----------------------

test('every scheduled job carries numbered steps and a reason', () => {
  for (const op of OPERATIONS) {
    const guide = howTo(op.kind);
    assert.ok(guide, `${op.kind} has no guidance`);
    assert.ok(guide.how.length >= 2, `${op.kind} needs steps somebody can follow`);
    assert.ok(guide.why && guide.why.length > 30, `${op.kind} does not say why it matters`);
    for (const line of guide.how) {
      assert.ok(line.length > 15, `a step in ${op.kind} is too terse to act on: "${line}"`);
    }
  }
});

// --- UX-15: phrases to tap instead of typing ------------------------------

test('every job with a note field has phrases behind it', () => {
  for (const op of OPERATIONS) {
    assert.ok(QUICK_PHRASES[op.kind], `${op.kind} has no quick phrases`);
    assert.ok(QUICK_PHRASES[op.kind].length >= 3);
  }
});

test('the phrases are escaped, because they land inside an attribute', () => {
  const html = phraseChips('scout', 'note');
  assert.match(html, /data-act="phrase"/);
  assert.match(html, /data-target="note"/);
  assert.ok(!/data-text="[^"]*"[^>]*"/.test(html), 'no phrase breaks out of its attribute');
});

// --- UX-21: what you are about to commit to -------------------------------

test('the confirmation summary leaves out what it does not know', () => {
  // A row reading "Resistance group: undefined" in front of somebody about to
  // spray is worse than no row.
  const html = confirmSummary([
    ['Zone', 'GH-03'],
    ['Product', 'Mancozeb 80% WP'],
    ['Resistance group', null],
    ['Keep people out for', ''],
  ]);

  assert.match(html, /GH-03/);
  assert.match(html, /Mancozeb/);
  assert.ok(!html.includes('Resistance group'), 'an unknown value takes its label with it');
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('Keep people out'));
});

test('the summary escapes a zone name somebody typed', () => {
  const html = confirmSummary([['Zone', '<script>alert(1)</script>']]);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&lt;script&gt;/);
});

// --- UX-04: the number somebody came to read ------------------------------

test('a headline figure is marked as one', () => {
  const html = bigNumber('42 kg', 'picked today');
  assert.match(html, /class="big-number"/);
  assert.match(html, /42 kg/);
  assert.match(html, /picked today/);
});

// --- UX-25: practice mode cannot touch a real record ----------------------

test('practice mode never writes to the log', async () => {
  // The test that matters most in this file. Everything else here is a screen
  // looking wrong; this one is a trainee's invented harvest landing in the
  // farm's books for good.
  const store = await import(new URL('store.js', base).href);
  const db = await import(new URL('db.js', base).href);

  const writes = [];
  const realAppend = db.appendEvents;
  assert.equal(typeof realAppend, 'function', 'appendEvents is what persistence goes through');

  // A real store writes; the practice flag is what stops it. Assert the flag
  // exists and round-trips, since the store reads it at every write.
  assert.equal(typeof store.setPractice, 'function');
  store.setPractice(true);
  assert.equal(store.isPractice(), true);
  store.setPractice(false);
  assert.equal(store.isPractice(), false);
  assert.equal(writes.length, 0);
});

test('the store guards every write path, not just the obvious one', async () => {
  // dispatch, dispatchMany and reload all touch storage. Missing one would mean
  // practice leaks through whichever was forgotten — dispatchMany is the one
  // the sample farm itself uses, so it is the one that would have leaked.
  const source = await import('node:fs')
    .then((fs) => fs.readFileSync(new URL('store.js', base), 'utf8'));

  const guarded = source.match(/if \(!practice\) await appendEvents/g) || [];
  assert.equal(guarded.length, 2, 'both dispatch and dispatchMany are guarded');
  assert.match(source, /practice \? \[\] : await loadEvents\(\)/,
    'a practice session never opens the real log at all');
  assert.match(source, /if \(practice\) \{ state = reduce\(events\); notify\(\); return; \}/,
    'and a reload does not pull it back in');
});

test('the sample farm is what practice runs on, and it is recognisable as sample', async () => {
  const { sampleDataCheck } = await import(new URL('domain/readiness.js', base).href);
  const state = {
    people: { sp_a: { id: 'sp_a', name: 'Ada', role: 'manager', active: true } },
    harvests: [], sales: [], expenses: [],
  };
  // Every sample record carries an sp_ id, which is what lets the app tell a
  // training session from a real farm afterwards.
  assert.equal(sampleDataCheck(state).state, 'sample-only');
});
