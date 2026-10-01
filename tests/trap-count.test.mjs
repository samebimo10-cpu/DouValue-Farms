// A Greenhouse Hand's trap count is a number, and it opens an alert —
// FR-SCOUT-01, FR-SCOUT-03, FR-FARM-04, FR-PROOF-01.
//
// The hands count the sticky traps: each crop's every week, the nursery's every
// morning. Until now the trap check closed on a photo and a line of text, the
// server refused any scouting record from a hand's account, and so nothing a
// hand counted could ever cross a threshold. The nursery was worse: its count
// had no crop cycle to hang on, and alerts were keyed on the crop, so even a
// supervisor's nursery count could not open one — although the rules say in as
// many words that thrips above threshold in the nursery "opens an alert like
// any other zone".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const { reduce, ROLES } = await import(new URL('store.js', base).href);
const { alerts, openAlerts, kpis } = await import(new URL('domain/alerts.js', base).href);
const {
  ALWAYS_COUNTED, overThreshold, readCounts, TRAP_TASKS, trapCountRecords, trapPests, trapZones,
} = await import(new URL('domain/traps.js', base).href);
const { canComplete, PROOF_REQUIRED } = await import(new URL('domain/proof.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const RULES = JSON.parse(readFileSync(new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8'));

const DAY = '2026-09-16';
const NOW = `${DAY}T09:00:00.000Z`;

const PEOPLE = {
  u_owner: { id: 'u_owner', name: 'Owner', role: 'ceo' },
  u_mgr: { id: 'u_mgr', name: 'Ada', role: 'manager' },
  u_sup: { id: 'u_sup', name: 'Tamuno', role: 'supervisor' },
  u_hand: { id: 'u_hand', name: 'Emeka', role: 'hand' },
};

let n = 0;
const ev = (type, payload, by = 'u_owner', at = `2026-08-01T08:00:00.000Z`) => ({ id: `e${++n}`, type, at, by, payload });

function farmEvents() {
  return [
    ...Object.values(PEOPLE).map((p) => ev('person.upsert', { ...p, active: true })),
    ev('plot.upsert', { id: 'gh1', name: 'GH-01', type: 'greenhouse' }),
    ev('plot.upsert', { id: 'nur', name: 'OF-02', type: 'nursery' }),
    ev('plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }),
    ev('cycle.start', { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-10', plants: 400 }),
  ];
}

/** What the hand's phone files for one count: the records, as events by the hand. */
function handCount(state, zoneId, counts, { at = `${DAY}T07:10:00.000Z`, taskId = null } = {}) {
  return trapCountRecords(state, { zoneId, counts, taskId, date: at.slice(0, 10), enteredAt: at })
    .map((payload) => ev('scout.record', payload, 'u_hand', at));
}

// --- What the hand is asked for -----------------------------------------------

test('the trap card asks for thrips and whitefly every time, and the other trap pests if counted', () => {
  const pests = trapPests();
  assert.deepEqual(pests.slice(0, 2).map((p) => p.id), ALWAYS_COUNTED);
  assert.ok(pests.filter((p) => p.required).every((p) => ALWAYS_COUNTED.includes(p.id)));
  assert.ok(pests.some((p) => p.id === 'aphids' && !p.required));
  assert.ok(!pests.some((p) => p.id === 'broad_mite'), 'a pest with no trap threshold cannot open an alert from a trap');
  // FR-SCOUT-02: the Owner's edits are the thresholds in force.
  const edited = trapPests({ thresholds: { mealybug: { greenhouse: { perTrap: 4 } } } });
  assert.ok(edited.some((p) => p.id === 'mealybug'));
});

test('a count is a whole number: zero counts, a blank does not', () => {
  assert.deepEqual(readCounts({ count_thrips: '0', count_whitefly: '3' }), { ok: true, counts: { thrips: 0, whitefly: 3 } });
  assert.deepEqual(readCounts({ count_thrips: '12', count_whitefly: '0', count_aphids: '' }).counts, { thrips: 12, whitefly: 0 });
  assert.match(readCounts({ count_thrips: '', count_whitefly: '2' }).why, /thrips.*put 0/i);
  assert.match(readCounts({ count_thrips: '2' }).why, /whitefly/i);
  assert.equal(readCounts({ count_thrips: '-1', count_whitefly: '0' }).ok, false);
  assert.equal(readCounts({ count_thrips: '2.5', count_whitefly: '0' }).ok, false);
});

test('traps are counted in the nursery and wherever a crop is growing', () => {
  const state = reduce(farmEvents());
  assert.deepEqual(trapZones(state).map((z) => z.id).sort(), ['gh1', 'nur'], 'GH-02 is empty');
  assert.ok(TRAP_TASKS.has('trap') && TRAP_TASKS.has('nursery_trap'));
});

// --- The count opens the alert ------------------------------------------------

test('FR-SCOUT-03: a hand\'s trap count over the line opens an alert on the crop', () => {
  const events = farmEvents();
  const state = reduce(events);
  const records = handCount(state, 'gh1', { thrips: 14, whitefly: 2 });
  assert.equal(records[0].payload.cycleId, 'c1', 'filed against the crop growing there');
  const after = reduce([...events, ...records]);
  const open = openAlerts(after, { now: NOW });
  assert.equal(open.length, 1);
  assert.equal(open[0].pestId, 'thrips');
  assert.equal(open[0].cycleId, 'c1');
  assert.equal(open[0].raisedBy, 'u_hand');
  assert.equal(open[0].count, 14);
  assert.equal(open[0].level, 'manager', 'straight to the Farm Manager (FR-SCOUT-04)');
  assert.deepEqual(overThreshold(after, records.map((r) => r.payload)).map((o) => o.pestId), ['thrips'],
    'and the hand is told then and there');
});

test('FR-FARM-04: the nursery\'s daily count opens an alert like any other zone', () => {
  // The rules, in their own words — this test is what holds the app to them.
  assert.ok(RULES.nursery.rules.some((r) => /nursery opens an alert like any other zone/i.test(r)));

  const events = farmEvents();
  const records = handCount(reduce(events), 'nur', { thrips: 11, whitefly: 0 });
  assert.equal(records[0].payload.cycleId, null, 'the nursery has no crop cycle');
  assert.equal(records[0].payload.zoneId, 'nur');
  const state = reduce([...events, ...records]);
  const [alert] = openAlerts(state, { now: NOW });
  assert.ok(alert, 'an alert is open');
  assert.equal(alert.zoneId, 'nur');
  assert.equal(alert.zoneName, 'OF-02');
  assert.equal(alert.pestId, 'thrips');
  assert.equal(alert.cycleId, null);
});

test('FR-REP-03: a nursery alert left open counts against the nursery, per zone', () => {
  const events = farmEvents();
  const old = handCount(reduce(events), 'nur', { thrips: 11, whitefly: 0 }, { at: '2026-09-14T07:00:00.000Z' });
  const state = reduce([...events, ...old]);
  const k5 = (zoneId) => kpis(state, { now: NOW, zoneId }).find((k) => k.id === 'KPI-05').value;
  assert.equal(k5('nur'), 1, 'open alerts older than 48 h: the nursery');
  assert.equal(k5('gh1'), 0, 'and not GH-01');
});

test('a nursery count under the line opens nothing; the crop\'s own alert does not borrow it', () => {
  const events = farmEvents();
  const state = reduce([...events, ...handCount(reduce(events), 'nur', { thrips: 3, whitefly: 1 })]);
  assert.equal(openAlerts(state, { now: NOW }).length, 0);
});

test('a nursery alert is picked up and closed by records about the nursery, not about a crop', () => {
  const events = [...farmEvents(), ...handCount(reduce(farmEvents()), 'nur', { thrips: 20, whitefly: 0 })];
  const ack = ev('alert.ack', { id: 'ak1', cycleId: null, zoneId: 'nur', pestId: 'thrips' }, 'u_mgr', `${DAY}T07:30:00.000Z`);
  const cropDecision = ev('alert.decide', { id: 'ad0', cycleId: 'c1', zoneId: null, pestId: 'thrips',
    reason: 'GH-01 has predatory mites in, leaving it a week' }, 'u_mgr', `${DAY}T07:40:00.000Z`);
  let state = reduce([...events, ack, cropDecision]);
  let [alert] = alerts(state, { now: NOW });
  assert.equal(alert.ack && alert.ack.by, 'u_mgr', 'picked up');
  assert.equal(alert.status, 'open', 'a decision about GH-01 does not close the nursery\'s alert');

  const decision = ev('alert.decide', { id: 'ad1', cycleId: null, zoneId: 'nur', pestId: 'thrips',
    reason: 'Batch discarded, nursery cleaned down and traps replaced' }, 'u_mgr', `${DAY}T08:00:00.000Z`);
  state = reduce([...events, ack, cropDecision, decision]);
  [alert] = alerts(state, { now: NOW });
  assert.equal(alert.status, 'closed');
  assert.equal(alert.closure.kind, 'decided');
});

// --- FR-PROOF-01: the nursery's trap check is a trap check ----------------------

test('the nursery trap check cannot close without its photo', () => {
  assert.ok(PROOF_REQUIRED.has('nursery_trap'));
  const verdict = canComplete({ id: 't', kind: 'nursery_trap' }, null);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /trap check/);
});

test('My work routes a trap check to the count, not to a bare photo', () => {
  const worker = readFileSync(new URL('../web/js/ui/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /if \(task && TRAP_TASKS\.has\(task\.kind\)\) \{ openTrapSheet\(ctx, task\); return; \}/);
  assert.match(worker, /'open-trapcount'/);
});

// --- On the farm server --------------------------------------------------------

test('every role may count traps, on the phone and on the server alike', () => {
  for (const role of Object.keys(ROLES)) {
    assert.ok(ROLES[role].can.includes('countTraps'), `app: ${role}`);
    assert.ok(core.ROLES[role].can.includes('countTraps'), `server: ${role}`);
  }
  assert.ok(!core.can('hand', 'scout'), 'a full scouting round is still not a hand\'s');
});

function memoryServer() {
  const events = [];
  const members = Object.values(PEOPLE).map((p) => ({ ...p, status: 'active' }));
  const store = {
    async getFarm() { return { id: 'f', name: 'Test farm' }; },
    async listMembers() { return members; },
    async getMember(_f, id) { return members.find((m) => m.id === id) || null; },
    async appendEvents(_f, list) { events.push(...list); return { accepted: list.length, skipped: 0, cursor: events.length }; },
    async listEvents(_f, since, limit) {
      const page = events.slice(since, since + limit);
      return { events: page, cursor: since + page.length, more: since + page.length < events.length };
    },
    async countEvents() { return events.length; },
  };
  return {
    events,
    async push(who, list) {
      return (await core.writeEvents('f', { events: list }, members.find((m) => m.id === who), store)).json();
    },
  };
}

test('the farm server takes a hand\'s trap counts — the nursery\'s included — and the task they close', async () => {
  const server = memoryServer();
  const state = reduce(farmEvents());
  const nursery = handCount(state, 'nur', { thrips: 11, whitefly: 0, aphids: 2 }, { taskId: 'gen_2026-09-16_nur_nursery_trap' });
  const crop = handCount(state, 'gh1', { thrips: 4, whitefly: 1 });
  crop[0].payload.photo = { dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 3 };
  const done = ev('task.complete', { id: 'gen_2026-09-16_nur_nursery_trap', photo: { dataUrl: 'data:image/jpeg;base64,AAAA' } }, 'u_hand');
  const res = await server.push('u_hand', [...nursery, ...crop, done]);
  assert.deepEqual(res.refused, []);
  assert.equal(res.accepted, nursery.length + crop.length + 1);
  // And replayed from what the server holds, the alert opens.
  const replayed = reduce([...farmEvents(), ...server.events]);
  assert.equal(openAlerts(replayed, { now: NOW }).filter((a) => a.zoneId === 'nur').length, 1);
});

test('…but from a hand, a trap count and nothing more', async () => {
  const server = memoryServer();
  const good = { id: 'sc1', kind: 'trap', zoneId: 'gh1', cycleId: 'c1', pestId: 'thrips', trapCount: 4, date: DAY };
  const refused = [
    ['a per-plant count', { ...good, perPlant: 3 }],
    ['a finding', { ...good, finding: 'aphids on young leaves' }],
    ['not a trap count', { ...good, kind: undefined }],
    ['no zone', { ...good, zoneId: undefined }],
    ['no pest', { ...good, pestId: undefined }],
    ['a negative count', { ...good, trapCount: -2 }],
    ['half a thrips', { ...good, trapCount: 2.5 }],
    ['a count that is not a number', { ...good, trapCount: 'lots' }],
  ];
  for (const [what, payload] of refused) {
    const res = await server.push('u_hand', [ev('scout.record', payload, 'u_hand')]);
    assert.equal(res.refused.length, 1, what);
  }
  // The supervisor's full scouting round is unchanged.
  const round = { id: 'sc2', cycleId: 'c1', pestId: 'aphids', trapCount: null, perPlant: 4, finding: 'aphids on tips', affectedPct: 30 };
  assert.deepEqual((await server.push('u_sup', [ev('scout.record', round, 'u_sup')])).refused, []);
  assert.equal((await server.push('u_sup', [ev('scout.record', { ...round, id: 'sc3', perPlant: -1 }, 'u_sup')])).refused.length, 1,
    'a count is a number, 0 or more, whoever files it');
});

test('a decision not to treat may name the nursery instead of a crop', () => {
  const guard = core.EVENT_POLICY['alert.decide'].guard;
  const reason = 'Batch discarded and the nursery cleaned down';
  assert.equal(guard({ payload: { zoneId: 'nur', pestId: 'thrips', reason } }).ok, true);
  assert.equal(guard({ payload: { cycleId: 'c1', pestId: 'thrips', reason } }).ok, true);
  assert.equal(guard({ payload: { pestId: 'thrips', reason } }).ok, false, 'but it names one or the other');
});
