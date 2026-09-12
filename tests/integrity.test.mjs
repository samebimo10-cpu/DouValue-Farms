// Whether the record checks catch what they should, and stay quiet otherwise.
//
// The second half matters as much as the first. A check that fires on honest
// work gets the whole screen ignored, so most of these tests assert silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const integrity = await import(new URL('domain/integrity.js', base).href);
const analysis = await import(new URL('domain/analysis.js', base).href);

const TODAY = '2026-09-20';
const day = (n) => {
  const d = new Date('2026-09-20T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (date, hour = 14, minute = 0) =>
  `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

function farm(overrides = {}) {
  return {
    settings: { defaultDailyWage: 3500, prices: { habanero: 2600 } },
    people: {
      u_ceo: { id: 'u_ceo', name: 'Owner', role: 'ceo', active: true },
      u_hand: { id: 'u_hand', name: 'Emeka', role: 'hand', active: true, dailyRate: 3500 },
      u_sup: { id: 'u_sup', name: 'Tamuno', role: 'supervisor', active: true, dailyRate: 5000 },
    },
    plots: { b1: { id: 'b1', name: 'Bed 1', areaM2: 800 } },
    cycles: {
      c1: { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: day(-150),
        plants: 1200, status: 'active' },
    },
    harvests: [], sales: [], expenses: [], attendance: [], workLogs: [],
    scouts: [], sprays: [], reports: [], diagnoses: [], inputs: {}, stockMoves: [],
    weather: [], tasks: {}, log: [],
    ...overrides,
  };
}

const pick = (o) => ({
  id: o.id, cycleId: 'c1', kg: o.kg, date: o.date, by: o.by || 'u_hand',
  at: o.at || at(o.date), serverAt: o.serverAt || o.at || at(o.date),
  grade: o.grade || 'first', verified: o.verified || false, photo: o.photo || null,
});

// --- Timing ---------------------------------------------------------------

test('timing separates the day claimed from the day recorded', () => {
  const t = integrity.timing(pick({ id: 'h1', kg: 40, date: day(-3), at: at(day(0), 9) }));
  assert.equal(t.claimedFor, day(-3));
  assert.equal(t.lagDays, 3);
  assert.equal(t.backdated, true);
  assert.equal(t.futureDated, false);
});

test('a record made on the day it claims has no lag', () => {
  const t = integrity.timing(pick({ id: 'h1', kg: 40, date: day(0), at: at(day(0), 16) }));
  assert.equal(t.lagDays, 0);
  assert.equal(t.backdated, false);
});

test('a record dated ahead of when it was made is flagged as future-dated', () => {
  const t = integrity.timing(pick({ id: 'h1', kg: 40, date: day(2), at: at(day(0)) }));
  assert.equal(t.futureDated, true);
});

// --- Checks that should fire ----------------------------------------------

test('work written up days later is raised, with the innocent reason first', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 42, date: day(-6), at: at(day(0), 8) })] });
  const { findings } = integrity.audit(state, { today: TODAY });
  const late = findings.find((f) => f.kind === 'late-entry');
  assert.ok(late, 'a six-day-old entry should be raised');
  assert.match(late.title, /6 days after/);
  assert.ok(late.innocent.length > 10, 'it must offer the innocent explanation');
  assert.ok(late.settle.length > 10, 'and say what would settle it');
});

test('a week of records entered in one sitting is spotted', () => {
  const harvests = [-5, -4, -3, -2].map((n, i) =>
    pick({ id: `h${i}`, kg: 30 + i, date: day(n), at: at(day(0), 19, i * 5) }));
  const { findings } = integrity.audit(farm({ harvests }), { today: TODAY });
  const bulk = findings.find((f) => f.kind === 'bulk-backfill');
  assert.ok(bulk);
  assert.match(bulk.title, /4 pickings across 4 different days/);
});

test('selling more than was ever picked is the loudest finding', () => {
  const state = farm({
    harvests: [pick({ id: 'h1', kg: 100, date: day(-1) })],
    sales: [{ id: 's1', cropId: 'habanero', kg: 400, amount: 1040000, date: day(-1) }],
  });
  const { findings } = integrity.audit(state, { today: TODAY });
  assert.equal(findings[0].kind, 'sold-more-than-picked', 'it should sort to the top');
  assert.equal(findings[0].severity, 'high');
  assert.match(findings[0].detail, /gap of 300 kg/);
});

test('a bed in picking that nobody has touched is raised', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 40, date: day(-25) })] });
  const { findings } = integrity.audit(state, { today: TODAY });
  const silent = findings.find((f) => f.kind === 'silent-bed');
  assert.ok(silent);
  assert.match(silent.title, /25 days/);
});

test('the same picking recorded twice is queried', () => {
  const state = farm({ harvests: [
    pick({ id: 'h1', kg: 48, date: day(-1), by: 'u_hand' }),
    pick({ id: 'h2', kg: 48, date: day(-1), by: 'u_sup' }),
  ] });
  const { findings } = integrity.audit(state, { today: TODAY });
  const dup = findings.find((f) => f.kind === 'possible-duplicate');
  assert.ok(dup);
  assert.match(dup.innocent, /two people/i);
});

test('a picking far outside the bed\'s usual is queried', () => {
  const harvests = [10, 11, 12, 13, 14].map((n, i) =>
    pick({ id: `h${i}`, kg: 40, date: day(-n) }));
  harvests.push(pick({ id: 'big', kg: 400, date: day(-2) }));
  const { findings } = integrity.audit(farm({ harvests }), { today: TODAY });
  const odd = findings.find((f) => f.kind === 'unusual-weight');
  assert.ok(odd);
  assert.equal(odd.evidence.kg, 400);
});

test('a picking on a day the person never clocked in is queried', () => {
  const state = farm({
    harvests: [pick({ id: 'h1', kg: 40, date: day(-1) })],
    attendance: [{ id: 'a1', personId: 'u_hand', in: at(day(-5), 7), out: at(day(-5), 15), hours: 8 }],
  });
  const { findings } = integrity.audit(state, { today: TODAY });
  assert.ok(findings.find((f) => f.kind === 'no-matching-shift'));
});

test('weights that are always round are noticed, gently', () => {
  const harvests = [1, 2, 3, 4, 5, 6].map((n) => pick({ id: `h${n}`, kg: n * 10, date: day(-n) }));
  const { findings } = integrity.audit(farm({ harvests }), { today: TODAY });
  const round = findings.find((f) => f.kind === 'estimated-weights');
  assert.ok(round);
  assert.equal(round.severity, 'low', 'this is a nudge, not an accusation');
});

test('a phone with a wrong clock is identified as the phone, not the person', () => {
  const log = [];
  for (let i = 0; i < 6; i++) {
    // The phone reports a time two hours ahead of the server.
    log.push({ id: `e${i}`, type: 'harvest.record', device: 'dev_bad',
      at: at(day(-i), 12), serverAt: at(day(-i), 10) });
  }
  const { findings } = integrity.audit(farm({ log }), { today: TODAY });
  const skew = findings.find((f) => f.kind === 'clock-skew');
  assert.ok(skew);
  assert.match(skew.title, /clock/);
  assert.equal(skew.who, null, 'a clock is not a person');
});

test('a photo attached long after it was taken is noted', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 40, date: day(0),
    photo: { dataUrl: 'data:,', fresh: false, ageMinutes: 4000 } })] });
  const { findings } = integrity.audit(state, { today: TODAY });
  assert.ok(findings.find((f) => f.kind === 'old-photo'));
});

// --- Checks that should stay quiet ----------------------------------------

test('a clean week raises nothing at all', () => {
  const harvests = [1, 2, 3, 4, 5].map((n) => pick({
    id: `h${n}`, kg: 38 + n, date: day(-n), at: at(day(-n), 16), verified: true,
    photo: { dataUrl: 'data:,', fresh: true, ageMinutes: 2 },
  }));
  const attendance = [1, 2, 3, 4, 5].map((n) => ({
    id: `a${n}`, personId: 'u_hand', in: at(day(-n), 7), out: at(day(-n), 15), hours: 8,
  }));
  const { findings } = integrity.audit(farm({ harvests, attendance }), { today: TODAY });
  assert.deepEqual(findings.map((f) => f.kind), [], `expected silence, got ${findings.map((f) => f.kind)}`);
});

test('a farm that does not use clock-in is not nagged about shifts', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 40, date: day(0) })] });
  const { findings } = integrity.audit(state, { today: TODAY });
  assert.equal(findings.some((f) => f.kind === 'no-matching-shift'), false);
});

test('one day of sync delay is not treated as a wrong clock', () => {
  const log = [];
  for (let i = 0; i < 6; i++) {
    // Recorded offline, arrived twenty minutes later. Entirely normal.
    log.push({ id: `e${i}`, type: 'harvest.record', device: 'dev_ok',
      at: at(day(-i), 12), serverAt: at(day(-i), 12, 20) });
  }
  const { findings } = integrity.audit(farm({ log }), { today: TODAY });
  assert.equal(findings.some((f) => f.kind === 'clock-skew'), false);
});

test('a young bed is not accused of being silent', () => {
  const state = farm({ cycles: { c1: { id: 'c1', plotId: 'b1', cropId: 'habanero',
    transplantDate: day(-20), plants: 1200, status: 'active' } } });
  const { findings } = integrity.audit(state, { today: TODAY });
  assert.equal(findings.some((f) => f.kind === 'silent-bed'), false);
});

test('a small sample never triggers the pattern checks', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 50, date: day(0) })] });
  const { findings } = integrity.audit(state, { today: TODAY });
  for (const kind of ['estimated-weights', 'unusual-weight']) {
    assert.equal(findings.some((f) => f.kind === kind), false, `${kind} needs more than one record`);
  }
});

// --- Scoring --------------------------------------------------------------

test('record quality rewards recording on the spot, with evidence', () => {
  const good = farm({ harvests: [1, 2, 3, 4].map((n) => pick({
    id: `h${n}`, kg: 40, date: day(-n), at: at(day(-n), 16), verified: true,
    photo: { dataUrl: 'data:,', fresh: true, ageMinutes: 1 },
  })) });
  const poor = farm({ harvests: [1, 2, 3, 4].map((n) => pick({
    id: `h${n}`, kg: 40, date: day(-n - 5), at: at(day(0), 20),
  })) });
  const g = integrity.recordQuality(good);
  const p = integrity.recordQuality(poor);
  assert.equal(g.sameDay, 100);
  assert.equal(g.withPhoto, 100);
  assert.ok(g.score > 90, `good farm scored ${g.score}`);
  assert.ok(p.score < 30, `poor farm scored ${p.score}`);
  assert.equal(g.band.tone, 'ok');
  assert.equal(p.band.tone, 'danger');
});

test('an empty farm scores nothing rather than zero', () => {
  const q = integrity.recordQuality(farm());
  assert.equal(q.total, 0);
  assert.equal(q.score, null, 'no records is not the same as bad records');
});

test('the per-person summary grades record-keeping, not honesty', () => {
  const harvests = [1, 2, 3, 4].map((n) => pick({
    id: `h${n}`, kg: 40, date: day(-n), at: at(day(-n), 16),
  }));
  const { people } = integrity.audit(farm({ harvests }), { today: TODAY });
  const row = people.find((r) => r.person.id === 'u_hand');
  assert.ok(row);
  assert.equal(row.sameDayShare, 100);
  assert.equal(row.grade.tone, 'ok');
  assert.match(row.grade.label, /records as they go/i);
});

// --- Analysis -------------------------------------------------------------

test('the trend compares the last four weeks with the four before', () => {
  const harvests = [];
  for (let n = 1; n <= 28; n++) harvests.push(pick({ id: `a${n}`, kg: 10, date: day(-n) }));
  for (let n = 29; n <= 56; n++) harvests.push(pick({ id: `b${n}`, kg: 5, date: day(-n) }));
  const trend = analysis.harvestTrend(farm({ harvests }), { today: TODAY });
  assert.ok(trend.recentTotal > trend.previousTotal);
  assert.equal(trend.direction, 'up');
});

test('bed performance judges against the part of the forecast already past', () => {
  const state = farm({ harvests: [pick({ id: 'h1', kg: 20, date: day(-1) })] });
  const rows = analysis.bedPerformance(state, { today: TODAY });
  const bed = rows.find((r) => r.cycleId === 'c1');
  assert.ok(bed);
  assert.ok(bed.dueByNowKg > 0, 'a bed 150 days in should have been due something');
  assert.equal(bed.verdict, 'well behind', '20 kg against a season of forecast is well behind');
});

test('unit economics says plainly when a crop sells below what it costs', () => {
  const state = farm({
    harvests: [pick({ id: 'h1', kg: 100, date: day(-2) })],
    sales: [{ id: 's1', cropId: 'habanero', kg: 100, amount: 50000, date: day(-1) }],
    expenses: [{ id: 'e1', amount: 300000, category: 'inputs', date: day(-3) }],
  });
  const e = analysis.unitEconomics(state, { today: TODAY });
  assert.equal(e.pricePerKg, 500);
  assert.ok(e.costPerKg >= 3000);
  assert.ok(e.marginPerKg < 0);
  assert.match(e.verdict, /below what it costs/);
});

test('grade mix flags a heavy reject share', () => {
  const harvests = [
    pick({ id: 'g1', kg: 70, date: day(-1), grade: 'first' }),
    pick({ id: 'g2', kg: 30, date: day(-1), grade: 'reject' }),
  ];
  const mix = analysis.gradeMix(farm({ harvests }), { today: TODAY });
  assert.equal(mix.rejectShare, 30);
  assert.equal(mix.grades[0].grade, 'first');
});

test('analysis of an empty farm does not throw', () => {
  const a = analysis.analyse(farm(), { today: TODAY });
  assert.equal(a.trend.recentTotal, 0);
  assert.equal(a.economics.costPerKg, null);
  assert.equal(a.grades.total, 0);
});

test('the same question about the same person is asked once, with a count', () => {
  const harvests = [];
  for (let n = 1; n <= 12; n++) {
    harvests.push(pick({ id: `h${n}`, kg: 40, date: day(-n - 5), at: at(day(0), 20, n) }));
  }
  const grouped = integrity.audit(farm({ harvests }), { today: TODAY });
  const late = grouped.findings.filter((f) => f.kind === 'late-entry');
  assert.equal(late.length, 1, 'twelve late entries are one finding, not twelve');
  assert.equal(late[0].grouped, 12);
  assert.match(late[0].title, /^12 records raise the same question/);
  assert.equal(late[0].examples.length, 3, 'it keeps a few examples');

  const ungrouped = integrity.audit(farm({ harvests }), { today: TODAY, group: false });
  assert.equal(ungrouped.findings.filter((f) => f.kind === 'late-entry').length, 12);
  assert.equal(grouped.rawCount, ungrouped.findings.length);
});

test('one or two of a kind are still shown in full', () => {
  const harvests = [
    pick({ id: 'h1', kg: 40, date: day(-6), at: at(day(0), 9) }),
    pick({ id: 'h2', kg: 41, date: day(-7), at: at(day(0), 9, 5) }),
  ];
  const { findings } = integrity.audit(farm({ harvests }), { today: TODAY });
  const late = findings.filter((f) => f.kind === 'late-entry');
  assert.ok(late.length >= 1);
  assert.equal(late.every((f) => !f.grouped), true, 'below the threshold nothing is collapsed');
});
