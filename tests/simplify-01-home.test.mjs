// Simplification pass 1 of 8: Home — docs/simplify.md, FR-SIMP-01 to 07.
//
// The pass moves what a field worker does not act on off their screens. It
// deletes nothing (FR-SIMP-01): every moved element lands somewhere stated in
// docs/simplify-pass/01-home.md (FR-SIMP-07), and each test here names that
// place and renders it.
//
// The no-scrolling check (FR-SIMP-08) needs a real screen and is in
// simplify-01-home-360.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ctxFor, sampleState } from './helpers/sample-state.mjs';

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const { todayView, myReportsView, pickedToday } = await load('ui/worker.js');
const { accountSheet } = await load('ui/shell.js');
const { zonePicker, zoneListSheet } = await load('ui/scan.js');
const { howTo } = await load('domain/schedule.js');
const { seasonOn } = await load('domain/climate.js');
const { isoDate, friendlyDate } = await load('util.js');

/** The text a person reads, without tags. */
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

/** Only what is on the screen before any "more" is opened. */
const onScreen = (html) => html.replace(/<details class="more"[\s\S]*?<\/details>/g, '');

const sample = await sampleState();
const { state } = sample;
const emeka = state.people.sp_emeka;
const tamuno = state.people.sp_tamuno;

// --- 1. Home ---------------------------------------------------------------

test('Home: what a hand acts on is still on the screen', () => {
  const html = todayView.render(ctxFor(state, emeka));
  const seen = text(onScreen(html));
  assert.match(seen, /Clock in|Clocked in/, 'clocking in');
  assert.match(seen, /Do not pick .* until/, 'a bed inside its PHI (FR-TREAT-02)');
  assert.match(seen, /of \d+ done/, 'the progress bar in words (UX-24)');
  assert.match(html, /data-main-action="home"/, 'the next job\'s Done');
  assert.match(seen, /Log harvest/);
  assert.match(seen, /Count a trap/);
  assert.match(seen, /Report a sick plant/);
  assert.match(seen, /End of shift/);
  assert.match(html, /data-to="#\/learn"/, 'Learn opens from Home (FR-LEARN-01)');
});

test('Home: the steps of every job are still on its card (UX-19)', () => {
  const html = todayView.render(ctxFor(state, emeka));
  const open = Object.values(state.tasks).filter((t) => t.status !== 'done' && howTo(t.kind));
  assert.ok(open.length, 'the sample has a job with steps');
  for (const line of howTo(open[0].kind).how) assert.ok(text(onScreen(html)).includes(line.replace(/&/g, '&')), line);
});

test('Home moved: the name, the date and the season are on the account sheet', () => {
  const home = text(todayView.render(ctxFor(state, emeka)));
  assert.ok(!home.includes(seasonOn(isoDate()).label), 'the season is off Home');
  const sheet = accountSheet({ store: { user: emeka, state } });
  assert.match(sheet, /data-moved="home.date-season"/);
  assert.ok(sheet.includes(emeka.name));
  assert.ok(text(sheet).includes(friendlyDate(isoDate())));
  assert.ok(text(sheet).includes(seasonOn(isoDate()).label));
});

test('Home moved: the zones a person holds are on the account sheet', () => {
  const home = text(onScreen(todayView.render(ctxFor(state, emeka))));
  assert.ok(!/Your zones/.test(home));
  const sheet = text(accountSheet({ store: { user: emeka, state } }));
  assert.match(sheet, /Your zones: Back field ?, Bed 1 \(front\) \(backup\)/);
});

test('Home moved: why a bed is blocked is one tap behind "Safety first: why"', () => {
  const html = todayView.render(ctxFor(state, emeka));
  assert.match(html, /data-moved="home.safety-reason"><summary>Safety first: why<\/summary>/);
  const reason = /data-moved="home.safety-reason">[\s\S]*?<\/details>/.exec(html)[0];
  assert.match(text(reason), /was applied on .* not safe to pick/);
});

test('Home moved: why a job matters is one tap behind "Why this matters"', () => {
  const html = todayView.render(ctxFor(state, emeka));
  const task = Object.values(state.tasks).find((t) => t.status !== 'done' && howTo(t.kind));
  assert.match(html, /data-moved="home.task-why"><summary>Why this matters<\/summary>/);
  assert.ok(html.includes(howTo(task.kind).why.replace(/'/g, '&#39;')) || text(html).includes(howTo(task.kind).why));
  assert.ok(!text(onScreen(html)).includes(howTo(task.kind).why), 'and not on the screen until tapped');
});

test('Home moved: what a finished job recorded is one tap behind "What was recorded"', () => {
  const task = Object.values(state.tasks).find((t) => t.status !== 'done' && t.zoneId
    && Object.values(state.assignments || {}).some((a) => a.personId === 'sp_emeka' && a.zoneId === t.zoneId));
  const { reduce, events } = sample;
  const done = reduce([...events, {
    id: 'done1', type: 'task.complete', by: 'sp_emeka', at: new Date().toISOString(),
    payload: { id: task.id, note: 'Dripper on row 3 unblocked' },
  }]);
  const html = todayView.render(ctxFor(done, done.people.sp_emeka));
  assert.match(html, /data-moved="home.task-recorded"><summary>What was recorded<\/summary>/);
  const body = /data-moved="home.task-recorded">[\s\S]*?<\/details>/.exec(html)[0];
  assert.match(body, /Dripper on row 3 unblocked/);
});

test('Home moved: why scan or list is said on the zone list, not on every card', () => {
  const html = todayView.render(ctxFor(state, emeka));
  const why = zonePicker({ supported: false }).why;
  assert.ok(!text(html).includes(why), 'off the task cards');
  // openZonePicker passes the same words to the list it opens.
  const source = readFileSync(new URL('ui/worker.js', base), 'utf8');
  assert.match(source, /: zonePicker\(\)\.why,/);
  assert.match(zoneListSheet(state, { why }), new RegExp(why.replace(/[.,]/g, '.')));
});

test('Home moved: the sick-plant reports are on "Your sick-plant reports", one tap from Home', async () => {
  const { composeReport } = await load('domain/sickplant.js');
  const { payload } = composeReport(state, 'sp_emeka', {
    zoneId: 'sp_b4', photos: [{ dataUrl: 'data:image/jpeg;base64,AAAA', fresh: true }],
    where: ['old_leaves'], howMany: 'one', spreading: 'no',
  }, { id: 'rep1', now: new Date().toISOString() });
  const s2 = sample.reduce([...sample.events,
    { id: 'rep1e', type: 'report.record', by: 'sp_emeka', at: new Date().toISOString(), payload }]);
  const home = todayView.render(ctxFor(s2, s2.people.sp_emeka));
  assert.match(home, /data-to="#\/my-reports"/);
  assert.ok(!/Waiting for the answer/.test(home), 'a waiting report is off Home');
  const list = myReportsView.render(ctxFor(s2, s2.people.sp_emeka));
  assert.match(list, /data-moved="home.plant-reports"/);
  assert.match(list, /Waiting for the answer/);
  assert.match(list, /Back field/);
});

test('Home moved: what was picked today is on the harvest sheet', () => {
  const home = text(todayView.render(ctxFor(state, emeka)));
  assert.ok(!/What you picked today/.test(home), 'off Home');
  const mine = state.harvests.filter((h) => h.by === 'sp_emeka' && h.date === isoDate());
  assert.ok(mine.length, 'the sample has a picking today');
  const sheet = pickedToday(state, emeka);
  assert.match(sheet, /data-moved="home.picked-today"/);
  assert.match(text(sheet), /What you picked today: \d+ kg/);
  assert.match(text(sheet), /picked today/);
  // And the harvest sheet carries it.
  assert.match(readFileSync(new URL('ui/worker.js', base), 'utf8'),
    /'<div id="harvest-body"><\/div>'\n\s+\+ pickedToday\(ctx\.store\.state, ctx\.user\)/);
});

test('Home moved: what the end-of-shift report and Learn are for is said on their own screens', async () => {
  const home = text(todayView.render(ctxFor(state, emeka)));
  assert.ok(!/the only record of the day in your own words/.test(home));
  assert.ok(!/how to catch them early/.test(home));
  const { shiftView } = await load('ui/shift.js');
  const { learnView } = await load('ui/learn.js');
  assert.match(text(shiftView.render(ctxFor(state, emeka))), /what you saw, what you did/);
  assert.match(text(learnView.render(ctxFor(state, emeka))), /how to catch them early/);
});

test('Home: a supervisor keeps My work and The farm, beside the clock', () => {
  const html = todayView.render(ctxFor(state, tamuno));
  assert.match(html, /data-to="#\/farm"/);
  assert.match(html, /data-to="#\/today"/);
});
