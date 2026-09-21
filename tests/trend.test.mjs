// The trap-count trend chart — FR-SCOUT-06.
//
// "A trend chart per zone shows trap counts over time, with the threshold line
// drawn."
//
// A chart is hard to test and easy to get wrong in ways that matter here. The
// failure worth guarding against is not an ugly chart: it is a chart that says
// everything is fine. A threshold line drawn off the top of the picture, a
// count plotted below a line it is actually above, a zone whose chart is
// another zone's — each of those is a reassuring picture of a house that is
// about to be lost, which is the Season 1 failure in a new form.
//
// So these tests read the geometry rather than the appearance: where the
// threshold line is relative to the points, and whether the sentence under the
// chart says the same thing the picture does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { trendChart, trendSummary } = await import(new URL('ui/chart.js', base).href);
const { trend, zoneTrends } = await import(new URL('domain/alerts.js', base).href);
const { alertsView } = await import(new URL('ui/alerts.js', base).href);

const day = (n) => {
  const d = new Date('2026-09-21T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const TODAY = day(0);

function farm(scouts) {
  return {
    settings: {},
    people: { u_hand: { id: 'u_hand', name: 'Emeka', role: 'hand', active: true } },
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },
      fa: { id: 'fa', name: 'Field A', type: 'field' },
    },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-60), status: 'active' },
      c2: { id: 'c2', plotId: 'fa', cropId: 'habanero', transplantDate: day(-60), status: 'active' },
    },
    tasks: {}, inputs: {}, harvests: [], sales: [], sprays: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [], shifts: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    positions: {}, absences: [], log: [], orphans: [],
    scouts,
  };
}

const counts = (list, cycleId = 'c1', pestId = 'thrips') => list.map((count, i) => ({
  id: `sc_${cycleId}_${i}`, cycleId, pestId, trapCount: count,
  date: day(-(list.length - i) * 2), at: `${day(-(list.length - i) * 2)}T09:00:00.000Z`, by: 'u_hand',
}));

/** Pull the y coordinates back out of the drawn SVG. */
function geometry(svg) {
  const line = svg.match(/class="threshold" x1="[\d.]+" y1="([\d.]+)"/);
  const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="(\d)" class="([^"]*)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]), over: m[4] === 'over' }));
  return { thresholdY: line ? Number(line[1]) : null, dots };
}

// --- The line the chart exists for ----------------------------------------

test('the threshold line is drawn, and labelled with its number', () => {
  const t = trend(farm(counts([2, 5, 8])), 'c1', 'thrips', { today: TODAY });
  const svg = trendChart(t, { pestName: 'Thrips' });

  assert.equal(t.line, 10, 'the greenhouse thrips threshold');
  assert.match(svg, /class="threshold"/);
  assert.match(svg, /threshold 10/);
});

test('a count over the line is drawn over the line', () => {
  // The test that matters. A chart whose geometry disagrees with the numbers
  // is a reassuring picture of a house about to be lost.
  const t = trend(farm(counts([2, 6, 14])), 'c1', 'thrips', { today: TODAY });
  const { thresholdY, dots } = geometry(trendChart(t, { pestName: 'Thrips' }));

  // SVG y grows downwards, so "above the line" is a smaller number.
  assert.ok(dots[2].y < thresholdY, 'the count of 14 sits above the threshold line');
  assert.ok(dots[0].y > thresholdY, 'the count of 2 sits below it');
  assert.equal(dots[2].over, true, 'and it is marked, not only positioned');
  assert.equal(dots[0].over, false);
});

test('the threshold line is never cropped off the top of the picture', () => {
  // A chart scaled to its counts alone would push the line out of frame on a
  // quiet week, which reads as "no threshold" rather than "well under it".
  const t = trend(farm(counts([1, 1, 2])), 'c1', 'thrips', { today: TODAY });
  const { thresholdY, dots } = geometry(trendChart(t, { pestName: 'Thrips' }));

  assert.ok(thresholdY > 0, 'the line is inside the drawing');
  assert.ok(thresholdY < 150);
  for (const dot of dots) assert.ok(dot.y > thresholdY, 'every quiet count is below it');
});

test('time runs left to right, oldest first', () => {
  const t = trend(farm(counts([2, 6, 14])), 'c1', 'thrips', { today: TODAY });
  const { dots } = geometry(trendChart(t, {}));
  assert.ok(dots[0].x < dots[1].x && dots[1].x < dots[2].x);
  assert.match(trendChart(t, {}), new RegExp(t.points[0].date.slice(8, 10)));
});

// --- The same answer in words (UX-07) --------------------------------------

test('the chart carries its own sentence, for sunlight and for screen readers', () => {
  const t = trend(farm(counts([2, 6, 14])), 'c1', 'thrips', { today: TODAY });
  const svg = trendChart(t, { pestName: 'Thrips', zoneName: 'GH-01' });

  assert.match(trendSummary(t, { pestName: 'Thrips' }), /Over the threshold of 10/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="[^"]*Over the threshold of 10/);
  assert.match(svg, /class="trend-caption"/, 'and the same words are printed under it');
});

test('a climbing count says how far it has to go', () => {
  const t = trend(farm(counts([2, 5, 8])), 'c1', 'thrips', { today: TODAY });
  assert.match(trendSummary(t, { pestName: 'Thrips' }), /checks away/);
});

test('one check is not a trend, and no checks is not an empty chart', () => {
  const one = trend(farm(counts([4])), 'c1', 'thrips', { today: TODAY });
  assert.match(trendChart(one, {}), /A trend needs at least two/);
  assert.ok(!trendChart(one, {}).includes('<svg'));

  const none = trend(farm([]), 'c1', 'thrips', { today: TODAY });
  assert.match(trendChart(none, {}), /nothing to draw/);
});

test('a zone name typed by a person is escaped before it is drawn', () => {
  const t = trend(farm(counts([2, 6])), 'c1', 'thrips', { today: TODAY });
  const svg = trendChart(t, { zoneName: '<script>alert(1)</script>', pestName: 'Thrips' });
  assert.ok(!/<script/i.test(svg));
  assert.match(svg, /&lt;script&gt;/);
});

// --- Per zone --------------------------------------------------------------

test('there is a chart per zone, and each one holds its own counts', () => {
  const state = farm([...counts([2, 6, 14], 'c1'), ...counts([1, 1, 2], 'c2')]);
  const all = zoneTrends(state, { today: TODAY });

  assert.deepEqual(all.map((t) => t.zoneName), ['GH-01', 'Field A'], 'worst zone first');
  assert.equal(all[0].over, true);
  assert.equal(all[1].over, false);
  assert.deepEqual(all[0].trend.points.map((p) => p.count), [2, 6, 14]);
  assert.deepEqual(all[1].trend.points.map((p) => p.count), [1, 1, 2]);
});

test('one zone can be asked for on its own, for that zone\'s screen', () => {
  const state = farm([...counts([2, 6, 14], 'c1'), ...counts([1, 1, 2], 'c2')]);
  const justField = zoneTrends(state, { today: TODAY, zoneId: 'fa' });
  assert.deepEqual(justField.map((t) => t.zoneName), ['Field A']);
});

test('the open field is held to its own threshold, not the greenhouse\'s', () => {
  const state = farm(counts([10, 14, 20], 'c2'));
  const [field] = zoneTrends(state, { today: TODAY });
  assert.equal(field.trend.line, 25, 'a closed house compounds what open field shrugs off');
  assert.equal(field.over, false);
});

test('the alerts screen draws them, grouped by zone', () => {
  const state = farm([...counts([2, 6, 14], 'c1'), ...counts([1, 1, 2], 'c2')]);
  const html = alertsView.render({ state, user: state.people.u_hand, store: { state } });

  assert.match(html, /Trap counts by zone/);
  assert.match(html, /GH-01/);
  assert.match(html, /Field A/);
  assert.match(html, /class="threshold"/);
  assert.match(html, /over the line/);
});
