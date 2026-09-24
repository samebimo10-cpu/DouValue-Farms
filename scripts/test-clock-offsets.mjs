#!/usr/bin/env node
// Run the suite again with the clock moved forward.
//
// FR-TASK-05's shift board, FR-REP-03's KPI screen and FR-SCOUT-06's trend
// chart all render "as of now" and read the clock themselves. A fixture pinned
// to a literal date agrees with them on the day it is written and drifts out of
// their window afterwards — the screen then renders its empty state and the
// assertions underneath go quiet or, later, red on a commit nobody touched.
//
// Both of those happened here: two days for the shift board, about fifty for
// the other two. So the suite runs at a few offsets on every push, and a test
// that has picked up a dependency on today's date fails on the day it is
// written instead.
//
// The offsets are a day (a fixture pinned to the date it was written on), two
// months (anything inside a 28-day or 8-week window), and over a year (a season
// or a cycle). Each run is the whole suite and takes about as long as the
// normal one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OFFSETS = [1, 60, 400];
const onGitHub = !!process.env.GITHUB_ACTIONS;
const failed = [];

for (const days of OFFSETS) {
  process.stdout.write(`\n──── the suite, with the clock ${days} day${days === 1 ? '' : 's'} ahead ────\n`);
  const run = spawnSync(process.execPath, [
    '--import', fileURLToPath(new URL('fake-clock.mjs', import.meta.url)),
    '--test', 'tests/**/*.test.mjs',
  ], {
    stdio: 'inherit',
    env: { ...process.env, FAKE_CLOCK_DAYS: String(days) },
  });
  if (run.status !== 0) failed.push(days);
}

if (!failed.length) {
  console.log(`\n✓ The suite passes with the clock ${OFFSETS.join(', ')} days ahead.`);
  process.exit(0);
}

// The whole point of this job is that the next person reads this line before
// they start looking for a bug in the farm app.
const list = failed.length > 1
  ? `${failed.slice(0, -1).join(', ')} and ${failed[failed.length - 1]}`
  : String(failed[0]);

const banner = [
  '',
  '════════════════════════════════════════════════════════════════════',
  ' THE CLOCK WAS SHIFTED. This is not a real bug in the app.',
  '════════════════════════════════════════════════════════════════════',
  '',
  ` This job runs the ordinary suite with the clock moved forward. It`,
  ` failed at ${list} day${failed.length === 1 && failed[0] === 1 ? '' : 's'} ahead. If the ordinary run (a separate`,
  ' job) is green, nothing is wrong with the code today: a test above',
  ' depends on what today\'s date is, and it will break on its own in',
  ' about that many days.',
  '',
  ' Almost always the fixture is pinned to a literal date while the screen',
  ' it renders reads the clock itself. The fix is to date the fixture from',
  ' isoDate() — the same function the screen calls — not to loosen the',
  ' assertion. See tests/shift.test.mjs for the shape of it, including the',
  ' guard that refuses an empty render before asserting on its contents.',
  '',
  ' Reproduce locally:',
  `   FAKE_CLOCK_DAYS=${failed[0]} node --import scripts/fake-clock.mjs --test "tests/**/*.test.mjs"`,
  '════════════════════════════════════════════════════════════════════',
  '',
].join('\n');

console.error(banner);
if (onGitHub) {
  console.error(`::error title=Clock-shifted run failed — check this before hunting a bug::`
    + `The suite was run with the clock moved forward and failed at ${list} days ahead.`
    + ` A test depends on today's date and will break on its own in about that long.`
    + ` Date the fixture from isoDate(), the same call the screen makes.`);
}
process.exit(1);
