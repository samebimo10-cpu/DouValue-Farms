// Alerts, escalation and the digest — requirements 6.5 and 6.11.
//
// Root cause two was thrips controlled too late, and root cause three was
// oversight the Owner could not see. So the tests that matter here are the ones
// about time: does a breach open an alert the moment it is recorded, does it
// climb when nobody acts, and does it refuse to close on anything except real
// work.
//
// The single most important test in this file is the one asserting that a later
// clean scouting record does NOT close an alert. "I looked again and it seemed
// better" is exactly how the first one got left.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const {
  alerts, breaches, kpis, levelFor, openAlerts, risingWarnings, thresholdFor, trend,
  DEFAULT_LADDER, DEFAULT_THRESHOLDS,
} = await import(new URL('domain/alerts.js', base).href);
const { digest, digestText, digestSize, exceptions } = await import(new URL('domain/digest.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const NOW = '2026-09-16T08:00:00.000Z';
const hoursAgo = (h) => new Date(new Date(NOW).getTime() - h * 3600000).toISOString();
const day = (n) => {
  const d = new Date('2026-09-16T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function farm(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {
      u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true },
      u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
      u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand', active: true },
    },
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 },
      fa: { id: 'fa', name: 'Field A', type: 'field', areaM2: 4000 },
    },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-40), status: 'active' },
      c2: { id: 'c2', plotId: 'fa', cropId: 'habanero', transplantDate: day(-50), status: 'active' },
    },
    tasks: {}, inputs: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [
      { id: 'st1', zoneId: 'gh1', date: day(-45), ph: 6.2, nematode: 'clean' },
      { id: 'st2', zoneId: 'fa', date: day(-55), ph: 6.0, nematode: 'clean' },
    ],
    topsoilBatches: {}, gateOverrides: [],
    alertAcks: [], alertDecisions: [],
    log: [], orphans: [],
    ...overrides,
  };
}

const scout = (o) => ({
  id: 'sc1', cycleId: 'c1', pestId: 'thrips', date: day(0),
  at: hoursAgo(1), by: 'u_hand', finding: 'Thrips on the young leaves', ...o,
});

// --- FR-SCOUT-02: thresholds ---------------------------------------------

test('a greenhouse is held to a tighter threshold than open field', () => {
  const state = farm();
  const house = thresholdFor('thrips', state.plots.gh1);
  const field = thresholdFor('thrips', state.plots.fa);

  assert.ok(house.perTrap < field.perTrap,
    'a closed house compounds a population that open field would tolerate');
  assert.equal(house.vector, true, 'thrips are flagged as a virus vector');
});

test('the Owner can change a threshold without a new release', () => {
  // FR-SCOUT-02 requires these be editable, and Rev 5 will replace the
  // defaults, so a setting has to win over the built-in table.
  const state = farm({ settings: { thresholds: { thrips: { greenhouse: { perTrap: 3 } } } } });
  const limit = thresholdFor('thrips', state.plots.gh1, state.settings);

  assert.equal(limit.perTrap, 3);
  assert.equal(breaches(scout({ trapCount: 4 }), state.plots.gh1, state.settings).count, 4);
  assert.equal(breaches(scout({ trapCount: 4 }), state.plots.gh1, {}), null,
    'the built-in threshold of 10 would not have caught that count');
});

test('a count under the threshold raises nothing', () => {
  const state = farm();
  assert.equal(breaches(scout({ trapCount: 3 }), state.plots.gh1), null);
});

test('either count over the line is a breach, not both', () => {
  const state = farm();
  // A trap catching nothing while the plants are covered means the trap is in
  // the wrong place, not that the house is clean.
  const hit = breaches(scout({ trapCount: 0, perPlant: 9 }), state.plots.gh1);
  assert.ok(hit);
  assert.equal(hit.kind, 'plant');
});

// --- FR-SCOUT-03: the alert and its deadline ------------------------------

test('crossing the threshold opens an alert with a 24-hour deadline', () => {
  const state = farm({ scouts: [scout({ trapCount: 14 })] });
  const [a] = openAlerts(state, { now: NOW });

  assert.ok(a, 'the breach opened an alert');
  assert.equal(a.pestName, 'Thrips');
  assert.equal(a.zoneName, 'GH-01');
  assert.equal(a.count, 14);
  assert.equal(a.limit, 10);

  const deadlineHours = (new Date(a.dueAt) - new Date(a.at)) / 3600000;
  assert.equal(deadlineHours, DEFAULT_LADDER.ownerAfterHours);
});

test('a second sighting of the same pest in the same zone does not open a second alert', () => {
  // Two alerts for one problem is how a board becomes wallpaper.
  const state = farm({
    scouts: [
      scout({ id: 'sc1', trapCount: 14, at: hoursAgo(6) }),
      scout({ id: 'sc2', trapCount: 22, at: hoursAgo(2) }),
    ],
  });
  const open = openAlerts(state, { now: NOW });

  assert.equal(open.length, 1);
  assert.equal(open[0].sightings.length, 2);
  assert.equal(open[0].worst, 22, 'the worst count seen is carried');
});

test('the same pest in a different zone is a different alert', () => {
  const state = farm({
    scouts: [
      scout({ id: 'sc1', cycleId: 'c1', trapCount: 14 }),
      scout({ id: 'sc2', cycleId: 'c2', trapCount: 30 }),
    ],
  });
  assert.equal(openAlerts(state, { now: NOW }).length, 2);
});

// --- FR-SCOUT-04: the escalation ladder -----------------------------------

test('the ladder climbs on elapsed time', () => {
  assert.equal(levelFor(1, false), 'manager');
  assert.equal(levelFor(3.9, false), 'manager');
  assert.equal(levelFor(4, false), 'supervisor');
  assert.equal(levelFor(23.9, false), 'supervisor');
  assert.equal(levelFor(24, false), 'owner');
});

test('acknowledging stops the climb to the Supervisor but not to the Owner', () => {
  // "Seen it" is not "dealt with", and Season 1 was full of seen.
  assert.equal(levelFor(6, true), 'manager');
  assert.equal(levelFor(30, true), 'owner');
});

test('an alert nobody touched for a day is with the Owner', () => {
  const state = farm({ scouts: [scout({ trapCount: 14, at: hoursAgo(26) })] });
  const [a] = openAlerts(state, { now: NOW });

  assert.equal(a.level, 'owner');
  assert.equal(a.overdue, true);
});

test('an acknowledgement is honoured only if it came after the breach', () => {
  const state = farm({
    scouts: [scout({ trapCount: 14, at: hoursAgo(6) })],
    alertAcks: [{ id: 'ak0', cycleId: 'c1', pestId: 'thrips', by: 'u_mgr', at: hoursAgo(20) }],
  });
  const [a] = openAlerts(state, { now: NOW });

  assert.equal(a.ack, null, 'yesterday\'s acknowledgement cannot cover today\'s breach');
  assert.equal(a.level, 'supervisor');
});

// --- FR-SCOUT-05: what closes one -----------------------------------------

test('a treatment closes the alert and records how long it took', () => {
  const state = farm({
    scouts: [scout({ trapCount: 14, at: hoursAgo(9) })],
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', productName: 'Neem oil',
      date: day(0), at: hoursAgo(3), diagnosisId: 'd1' }],
  });
  const [a] = alerts(state, { now: NOW });

  assert.equal(a.status, 'closed');
  assert.equal(a.hoursToClose, 6);
  assert.equal(a.withinDeadline, true);
});

test('a recorded decision not to treat closes it, and says who decided', () => {
  const state = farm({
    scouts: [scout({ trapCount: 14, at: hoursAgo(9) })],
    alertDecisions: [{ id: 'ad1', cycleId: 'c1', pestId: 'thrips', by: 'u_mgr',
      at: hoursAgo(5), reason: 'Predatory mites released on Monday, giving them the week' }],
  });
  const [a] = alerts(state, { now: NOW });

  assert.equal(a.status, 'closed');
  assert.equal(a.closure.kind, 'decided');
  assert.match(a.closure.what, /Predatory mites/);
});

test('a later clean scouting record does NOT close an alert', () => {
  // The most important test in this file. "I looked again and it seemed
  // better" is precisely how the first one got left.
  const state = farm({
    scouts: [
      scout({ id: 'sc1', trapCount: 14, at: hoursAgo(20) }),
      scout({ id: 'sc2', trapCount: 0, at: hoursAgo(2), finding: 'Looks clear now' }),
    ],
  });
  const open = openAlerts(state, { now: NOW });

  assert.equal(open.length, 1, 'still open — nothing was done about it');
  assert.equal(open[0].status, 'open');
});

test('a treatment on a different zone does not close this zone\'s alert', () => {
  const state = farm({
    scouts: [scout({ cycleId: 'c1', trapCount: 14, at: hoursAgo(9) })],
    sprays: [{ id: 'sp1', cycleId: 'c2', productId: 'neem', date: day(0), at: hoursAgo(3) }],
  });
  assert.equal(openAlerts(state, { now: NOW }).length, 1);
});

test('a treatment from before the breach does not close it', () => {
  const state = farm({
    scouts: [scout({ trapCount: 14, at: hoursAgo(4) })],
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', date: day(-3), at: hoursAgo(80) }],
  });
  assert.equal(openAlerts(state, { now: NOW }).length, 1);
});

test('the server refuses a no-treat decision with no reason behind it', () => {
  const guard = core.EVENT_POLICY['alert.decide'].guard;
  for (const reason of ['', 'fine', 'ok now']) {
    assert.equal(guard({ payload: { cycleId: 'c1', pestId: 'thrips', reason } }).ok, false);
  }
  assert.equal(guard({
    payload: { cycleId: 'c1', pestId: 'thrips', reason: 'Predators released Monday, giving them the week' },
  }).ok, true);
  // And a farm hand cannot make that call at all.
  assert.equal(core.can('hand', 'assignTasks'), false);
});

// --- FR-SCOUT-06/07: trend and the warning before the line ----------------

test('three rising checks warn before the threshold is crossed', () => {
  const state = farm({
    scouts: [-14, -7, 0].map((n, i) => scout({
      id: `sc${i}`, date: day(n), at: `${day(n)}T09:00:00.000Z`, trapCount: [2, 5, 8][i],
    })),
  });
  const t = trend(state, 'c1', 'thrips', { today: day(0) });

  assert.equal(t.line, 10);
  assert.ok(t.rising, 'a climb towards the line is worth saying before it is crossed');
  assert.equal(t.rising.checksToThreshold, 1);
});

test('a flat or falling count raises no yellow warning', () => {
  const state = farm({
    scouts: [-14, -7, 0].map((n, i) => scout({
      id: `sc${i}`, date: day(n), at: `${day(n)}T09:00:00.000Z`, trapCount: [8, 5, 2][i],
    })),
  });
  assert.equal(trend(state, 'c1', 'thrips', { today: day(0) }).rising, null);
});

test('two readings are not a trend', () => {
  const state = farm({
    scouts: [-7, 0].map((n, i) => scout({
      id: `sc${i}`, date: day(n), at: `${day(n)}T09:00:00.000Z`, trapCount: [2, 6][i],
    })),
  });
  assert.equal(trend(state, 'c1', 'thrips', { today: day(0) }).rising, null);
});

// --- FR-REP-01/02: the digest ---------------------------------------------

test('a quiet farm gets one line, not a report', () => {
  const text = digestText(farm(), { now: NOW });

  assert.equal(text.split('\n').length, 2, text);
  assert.match(text, /Nothing needs you today/);
});

test('the digest leads with what needs the Owner', () => {
  const state = farm({
    scouts: [scout({ trapCount: 40, at: hoursAgo(30) })],
    tasks: { t1: { id: 't1', kind: 'scout', title: 'Check GH-02 traps', due: day(-2), status: 'open' } },
  });
  const d = digest(state, { now: NOW });

  assert.equal(d.allWell, false);
  assert.equal(d.items[0].severity, 'critical');
  assert.match(d.items[0].line, /Thrips on GH-01/);
});

test('a suspected virus outranks everything else in the digest', () => {
  const state = farm({
    scouts: [scout({ trapCount: 40, at: hoursAgo(30) })],
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'leaf_curl_virus',
      problemName: 'Pepper leaf curl virus', date: day(0), confirmedBy: 'u_mgr' }],
  });
  const [first] = exceptions(state, { now: NOW });

  assert.match(first.line, /VIRUS SUSPECTED/);
  assert.match(first.detail, /Isolate/);
});

test('a gate override reaches the Owner, with the reason given', () => {
  const state = farm({
    gateOverrides: [{ id: 'o1', gate: 'nematode', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lab lost the slip, resample sent Monday', at: hoursAgo(20) }],
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-3), ph: 6.2 }],
  });
  const lines = exceptions(state, { now: NOW });
  const hit = lines.find((i) => /override/i.test(i.line));

  assert.ok(hit, JSON.stringify(lines.map((l) => l.line)));
  assert.match(hit.detail, /Lab lost the slip/);
});

test('the digest is small enough to receive on a weak connection', () => {
  // FR-REP-02 is a size requirement as much as a content one, so a busy farm
  // is what has to be measured, not a quiet one.
  const state = farm({
    scouts: [
      scout({ id: 'sc1', cycleId: 'c1', trapCount: 40, at: hoursAgo(30) }),
      scout({ id: 'sc2', cycleId: 'c2', pestId: 'whitefly', trapCount: 90, at: hoursAgo(28) }),
    ],
    gateOverrides: [{ id: 'o1', gate: 'ph', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lime applied Tuesday, retest booked Friday', at: hoursAgo(20) }],
    tasks: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`t${n}`,
      { id: `t${n}`, kind: 'scout', title: `Check house ${n}`, due: day(-1), status: 'open' }])),
  });
  const { text, bytes } = digestSize(state, { now: NOW });

  assert.ok(bytes < 2000, `digest was ${bytes} bytes:\n${text}`);
  assert.ok(!text.includes('data:'), 'no photos ride along in the message');
  assert.ok(!/<[a-z]/i.test(text), 'plain text only, so WhatsApp and SMS both carry it');
});

// --- Section 3: the success measures --------------------------------------

test('the KPI table computes every measure from the records', () => {
  const state = farm({
    scouts: [scout({ trapCount: 14, at: hoursAgo(9) })],
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', date: day(0), at: hoursAgo(3), diagnosisId: 'd1' }],
  });
  const rows = kpis(state, { now: NOW });

  assert.deepEqual(rows.map((r) => r.id),
    ['KPI-01', 'KPI-02', 'KPI-03', 'KPI-04', 'KPI-05', 'KPI-06']);

  const k1 = rows.find((r) => r.id === 'KPI-01');
  assert.equal(k1.value, 6, 'six hours from breach to treatment');
  assert.equal(k1.ok, true);

  const k3 = rows.find((r) => r.id === 'KPI-03');
  assert.equal(k3.value, 0, 'the spray carried a diagnosis');
});

test('KPI-03 counts a treatment with no diagnosis behind it', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', date: day(-1), at: hoursAgo(30) }],
  });
  const k3 = kpis(state, { now: NOW }).find((r) => r.id === 'KPI-03');

  assert.equal(k3.value, 1);
  assert.equal(k3.ok, false);
});

test('KPI-04 counts standing gate overrides, and stops counting revoked ones', () => {
  const live = farm({
    gateOverrides: [{ id: 'o1', gate: 'ph', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lime applied Tuesday', at: hoursAgo(10) }],
  });
  assert.equal(kpis(live, { now: NOW }).find((r) => r.id === 'KPI-04').value, 1);

  const revoked = farm({
    gateOverrides: [{ id: 'o1', gate: 'ph', zoneId: 'gh1', by: 'u_owner',
      reason: 'Lime applied Tuesday', at: hoursAgo(10), revoked: true }],
  });
  assert.equal(kpis(revoked, { now: NOW }).find((r) => r.id === 'KPI-04').value, 0);
});

test('KPI-05 counts alerts past their deadline', () => {
  const state = farm({
    scouts: [
      scout({ id: 'sc1', cycleId: 'c1', trapCount: 14, at: hoursAgo(30) }),
      scout({ id: 'sc2', cycleId: 'c2', pestId: 'whitefly', trapCount: 90, at: hoursAgo(2) }),
    ],
  });
  const k5 = kpis(state, { now: NOW }).find((r) => r.id === 'KPI-05');

  assert.equal(k5.value, 1, 'only the one past 24 hours counts');
  assert.equal(k5.ok, false);
});
