// The Owner's decisions of 9 October 2026, on docs/verification.md and
// docs/simplify.md: what the Farm Manager sees of the money (FR-SIMP-04), the
// weather on the spray screen (SR-04), photo review and the monthly cap
// (FR-DOC-03, FR-ADV-07), litres on a spray and the stock it draws
// (FR-TREAT-01, FR-STOCK-01), and the record checks as Part A of the
// verification spec: Owner-only, nightly on the farm server (FR-VER-01,
// FR-XCHK-01/09/10).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

const base = new URL('../web/js/', import.meta.url);
const store = await import(new URL('store.js', base).href);
const climate = await import(new URL('domain/climate.js', base).href);
const drawdown = await import(new URL('domain/drawdown.js', base).href);
const brief = await import(new URL('domain/brief.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const ev = (type, payload, at, by = 'u_mgr') => ({ id: `e_${type}_${payload.id || Math.random()}`, type, at, by, payload });

// --- FR-SIMP-04: the Farm Manager sees sales, not profit ----------------------

const SAMPLE_BRIEF = {
  farm: { askedBy: { role: 'x', seesMoney: true } },
  economics: {
    last90Days: {
      revenueNgn: 500000, inputCostNgn: 120000, pricePerKgNgn: 2600, soldKg: 190,
      labourCostNgn: 90000, totalCostNgn: 210000, costPerKgNgn: 1100, marginPerKgNgn: 1500, verdict: 'comfortably profitable',
    },
    ownRecentPrices: [{ date: '2026-10-01', ngnPerKg: 2600, buyer: 'Mile 3' }],
  },
  dataTrust: { score: 70, concerns: [{ what: 'Bed 1: a picking recorded 4 days after the day it claims' }] },
};

test('FR-SIMP-04: the adviser brief keeps sales and prices for the Farm Manager, and drops margin and cost against revenue', () => {
  const forManager = core.redactBrief(structuredClone(SAMPLE_BRIEF), 'manager');
  const e = forManager.economics.last90Days;
  assert.equal(e.revenueNgn, 500000);
  assert.equal(e.pricePerKgNgn, 2600);
  assert.equal(e.inputCostNgn, 120000, 'input costs are the Farm Manager\'s');
  for (const key of ['labourCostNgn', 'totalCostNgn', 'costPerKgNgn', 'marginPerKgNgn', 'verdict']) {
    assert.equal(key in e, false, `${key} is the Owner's`);
  }
  assert.equal(forManager.economics.ownRecentPrices.length, 1, 'buyers and prices stay');
  assert.equal(forManager.dataTrust, undefined, 'the record checks are the Owner\'s (FR-VER-01)');

  const forOwner = core.redactBrief(structuredClone(SAMPLE_BRIEF), 'ceo');
  assert.equal(forOwner.economics.last90Days.marginPerKgNgn, 1500);
  assert.ok(forOwner.dataTrust);

  const forSupervisor = core.redactBrief(structuredClone(SAMPLE_BRIEF), 'supervisor');
  assert.equal(forSupervisor.economics, undefined);
  assert.equal(forSupervisor.dataTrust, undefined);
});

test('FR-SIMP-04: profit, crop value, cashflow and the record checks are the Owner\'s permissions alone', () => {
  for (const perm of ['viewProfit', 'viewAudit', 'manageRates']) {
    assert.equal(store.can({ role: 'ceo' }, perm), true, perm);
    for (const role of ['manager', 'supervisor', 'hand']) {
      assert.equal(store.can({ role }, perm), false, `${role} must not hold ${perm}`);
    }
  }
  // The Farm Manager still records and reads sales.
  assert.equal(core.mayWrite({ type: 'sale.record', payload: {} }, { id: 'm', role: 'manager' }).ok, true);
  assert.ok(core.visibleTo({ id: 's', type: 'sale.record', payload: { amount: 1 } }, { memberId: 'm', role: 'manager' }));
});

test('the brief built on the Farm Manager\'s phone carries no margin and no record checks', () => {
  const state = store.reduce([
    ev('person.upsert', { id: 'u_mgr', name: 'Ada', role: 'manager' }, '2026-01-01T08:00:00Z'),
    ev('sale.record', { id: 's1', kg: 100, amount: 260000, buyer: 'Mile 3', date: '2026-10-01' }, '2026-10-01T17:00:00Z'),
  ]);
  const b = brief.buildBrief(state, { id: 'u_mgr', role: 'manager' }, { today: '2026-10-09' });
  assert.ok(b.economics, 'the Farm Manager sees the sales');
  assert.equal(b.economics.last90Days.marginPerKgNgn, undefined);
  assert.equal(b.economics.last90Days.costPerKgNgn, undefined);
  assert.equal(b.dataTrust, undefined);
});

// --- SR-04: open field, more than 15 mm within 4 h after a spray ---------------

const hours = (startIso, mmPerHour) => mmPerHour.map((rain, i) => ({
  end: new Date(Date.parse(startIso) + (i + 1) * 3600 * 1000).toISOString(), rain,
}));

test('Open-Meteo\'s farm-local hours come back as UTC instants', () => {
  const out = climate.hourlyRain({ utc_offset_seconds: 3600, hourly: { time: ['2026-10-09T14:00'], precipitation: [4.2] } });
  assert.deepEqual(out, [{ end: '2026-10-09T13:00:00.000Z', rain: 4.2 }]);
});

test('SR-04 applies to open field only, and reads the next four hours', () => {
  const now = new Date('2026-10-09T15:00:00Z');
  const forecast = { hours: hours('2026-10-09T15:00:00Z', [6, 6, 6, 6, 30]) };
  const field = climate.sprayWeather({ type: 'field' }, forecast, now);
  assert.equal(field.applies, true);
  assert.equal(field.mm, 24, 'the fifth hour is outside the window');
  assert.equal(field.over, true);
  assert.equal(climate.sprayWeather({ type: 'greenhouse' }, forecast, now).applies, false);
  assert.equal(climate.sprayWeather({ type: 'nursery' }, forecast, now).applies, false);
});

function sprayFarm(zoneType) {
  return store.reduce([
    ev('plot.upsert', { id: 'z1', name: 'OF-01', type: zoneType, areaM2: 2000 }, '2026-01-01T08:00:00Z'),
    ev('cycle.start', { id: 'c1', plotId: 'z1', cropId: 'habanero', transplantDate: '2026-08-01', plants: 3000 }, '2026-08-01T08:00:00Z'),
    ev('spray.record', { id: 'sp1', cycleId: 'c1', activeId: 'a1', productName: 'Mancozeb', rate: '2.5 g/L', date: '2026-10-08' },
      '2026-10-08T15:00:00Z', 'u_sup'),
  ]);
}

test('SR-04: more than 15 mm within four hours of an open-field spray puts a re-spray task on the board', () => {
  const wet = { hours: hours('2026-10-08T15:00:00Z', [4, 4, 4, 4]), days: [{ date: '2026-10-10', rain: 12 }, { date: '2026-10-11', rain: 1 }] };
  const due = climate.respraysDue(sprayFarm('field'), wet);
  assert.equal(due.length, 1);
  assert.equal(due[0].mm, 16);
  const task = climate.resprayTaskFor(due[0], wet, { today: '2026-10-09' });
  assert.equal(task.id, 'fd_respray_sp1');
  assert.equal(task.kind, 'respray');
  assert.equal(task.due, '2026-10-11T16:00', 'the next dry day, in the spray window');

  const exactly15 = { hours: hours('2026-10-08T15:00:00Z', [3.75, 3.75, 3.75, 3.75]) };
  assert.equal(climate.respraysDue(sprayFarm('field'), exactly15).length, 0, 'more than 15, not 15');
  assert.equal(climate.respraysDue(sprayFarm('greenhouse'), wet).length, 0, 'a greenhouse is covered');
  const short = { hours: hours('2026-10-08T15:00:00Z', [20]) };
  assert.equal(climate.respraysDue(sprayFarm('field'), short).length, 0, 'a window the data does not cover is not judged');
});

test('SR-04: any phone may file the re-spray task, but only in the generator\'s exact shape', () => {
  const task = { id: 'fd_respray_sp1', kind: 'respray', sprayId: 'sp1', generated: true, zoneId: 'z1' };
  const hand = { id: 'h', role: 'hand' };
  assert.equal(core.mayWrite({ id: 'ev_fd_respray_sp1', type: 'task.create', payload: task }, hand).ok, true);
  assert.equal(core.mayWrite({ id: 'ev_x', type: 'task.create', payload: { ...task, id: 'fd_respray_other' } }, hand).ok, false);
});

// --- FR-TREAT-01, FR-STOCK-01: litres, area, and the stock a spray draws -------

test('a rate is read as an amount per litre, the greenhouse or field one where it gives both', () => {
  assert.deepEqual(drawdown.ratePerLitre('2.5 g/L (80WP)'), { amount: 2.5, unit: 'g' });
  assert.deepEqual(drawdown.ratePerLitre('0.3 ml/L (45SC), after 4 PM'), { amount: 0.3, unit: 'ml' });
  assert.deepEqual(drawdown.ratePerLitre('5 g/L GH; 2.5 g/L field', 'field'), { amount: 2.5, unit: 'g' });
  assert.deepEqual(drawdown.ratePerLitre('5 g/L GH; 2.5 g/L field', 'greenhouse'), { amount: 5, unit: 'g' });
  assert.equal(drawdown.ratePerLitre('150 ml cold-pressed oil + 30 ml soap / 16 L').amount, 150 / 16);
  assert.equal(drawdown.ratePerLitre('per label'), null);
});

function stockedFarm(spray, unit = 'kg') {
  return store.reduce([
    ev('plot.upsert', { id: 'z1', name: 'GH-01', type: 'greenhouse', areaM2: 400 }, '2026-01-01T08:00:00Z'),
    ev('cycle.start', { id: 'c1', plotId: 'z1', cropId: 'bell', transplantDate: '2026-08-01', plants: 1000 }, '2026-08-01T08:00:00Z'),
    ev('input.upsert', { id: 'i1', name: 'Mancozeb 80% WP', unit, qty: 6, activeId: 'mancozeb' }, '2026-01-02T08:00:00Z'),
    ev('spray.record', { id: 'sp1', cycleId: 'c1', activeId: 'mancozeb', rate: '2.5 g/L (80WP)', date: '2026-10-08', ...spray },
      '2026-10-08T16:00:00Z', 'u_sup'),
  ]);
}

test('FR-STOCK-01: a spray with litres takes its product out of the store by itself', () => {
  const s = stockedFarm({ litres: 32, areaM2: 400 });
  assert.equal(s.inputs.i1.qty, 6 - 0.08, '2.5 g/L × 32 L = 80 g = 0.08 kg');
  const move = s.stockMoves.find((m) => m.sprayId === 'sp1');
  assert.equal(move.auto, true);
  assert.equal(move.direction, 'out');
  assert.equal(s.sprays[0].litres, 32);
  assert.equal(s.sprays[0].areaM2, 400);
});

test('a spray from before litres were asked for draws nothing, and says so', () => {
  const s = stockedFarm({});
  assert.equal(s.inputs.i1.qty, 6);
  assert.equal(s.sprays[0].drawn.none, 'no litres recorded');
  const bags = stockedFarm({ litres: 32 }, 'bag');
  assert.equal(bags.inputs.i1.qty, 6, 'a bag is not a weight: nothing guessed');
  assert.match(bags.sprays[0].drawn.none, /bag/);
});

// --- FR-ADV-07: what an answer costs ------------------------------------------

test('FR-ADV-07: an answer is costed from its usage at list prices, an unknown model at the dearest', () => {
  const usage = { input_tokens: 10000, output_tokens: 2000, server_tool_use: { web_search_requests: 3 } };
  // Opus 5: $5 in, $25 out per million; searches $10 per thousand.
  assert.equal(Math.round(core.usageCostUsd('claude-opus-5', usage) * 1e6), Math.round((0.05 + 0.05 + 0.03) * 1e6));
  assert.ok(core.usageCostUsd('some-new-model', usage) > core.usageCostUsd('claude-opus-5', usage));
  // Opus 5.5, the server's default: $4 / $20, a fifth cheaper than Opus 5 on the same tokens.
  const tokensOnly = { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 10000 };
  assert.equal(Math.round(core.usageCostUsd('claude-opus-5-5', tokensOnly) * 1e6), Math.round((0.04 + 0.04 + 0.002) * 1e6));
  assert.ok(core.usageCostUsd('claude-opus-5-5', tokensOnly) < core.usageCostUsd('claude-opus-5', tokensOnly));
});

// --- FR-XCHK-01: the record checks run on the server, once a night -------------

function memoryStore(seed) {
  const events = [...seed];
  let farm = { id: 'f', name: 'Test farm' };
  return {
    events,
    async getFarm() { return farm; },
    async setFarm(_f, value) { farm = value; },
    async appendEvents(_f, list) {
      for (const e of list) events.push(e);
      return { accepted: list.length, skipped: 0, cursor: events.length };
    },
    async listEvents(_f, since, limit) {
      const page = events.slice(since, since + limit);
      return { events: page, cursor: since + page.length, more: since + page.length < events.length };
    },
  };
}

test('FR-XCHK-01: the checks run from 02:00 farm time, once a night, and only the Owner is sent them', async () => {
  const mem = memoryStore([
    ev('person.upsert', { id: 'u_hand', name: 'Emeka', role: 'hand' }, '2026-01-01T08:00:00Z'),
    ev('plot.upsert', { id: 'b1', name: 'Bed 1' }, '2026-01-01T08:00:00Z'),
    ev('cycle.start', { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: '2026-05-01', plants: 1000 }, '2026-05-01T08:00:00Z'),
    // Written up six days late.
    ev('harvest.record', { id: 'h1', cycleId: 'c1', kg: 40, date: '2026-10-01' }, '2026-10-07T09:00:00Z', 'u_hand'),
  ]);
  assert.deepEqual(await core.runDueChecks(mem, ['f'], { now: new Date('2026-10-08T00:30:00Z') }), [], 'before 2 AM, nothing');
  const [first] = await core.runDueChecks(mem, ['f'], { now: new Date('2026-10-08T01:10:00Z') });
  assert.equal(first.ok, true);
  const [again] = await core.runDueChecks(mem, ['f'], { now: new Date('2026-10-08T05:10:00Z') });
  assert.equal(again.skipped, true, 'once a night');

  const record = mem.events.find((e) => e.type === 'checks.record');
  assert.equal(record.payload.date, '2026-10-08');
  const late = record.payload.findings.find((f) => f.kind === 'late-entry');
  assert.ok(late);
  assert.equal(late.xc, 'XC-05');
  assert.doesNotMatch(late.title, /Emeka/, 'the headline names the bed, not the person (FR-XCHK-10)');
  assert.equal(late.who, 'u_hand', 'who entered it stays on the finding');

  for (const role of ['manager', 'supervisor', 'hand']) {
    assert.equal(core.visibleTo(record, { memberId: 'x', role }), null, `${role} is not sent the findings`);
  }
  assert.ok(core.visibleTo(record, { memberId: 'c', role: 'ceo' }));
  assert.equal(core.mayWrite(record, { id: 'c', role: 'ceo' }).ok, false, 'not even the Owner files findings');

  const s = store.reduce(mem.events);
  assert.equal(s.checks.date, '2026-10-08', 'the Owner\'s phone reads the latest run');
});

// --- The farm server, run for real: photo review, the cap, checks on demand ----

let server = null;
let dataDir = null;
const PORT = 8797;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const FARM = 'farm_decisions';
const tokens = {};

const call = async (path, { method = 'GET', token = null, body = null } = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: payload };
};

before(async () => {
  dataDir = mkdtempSync(pathJoin(tmpdir(), 'douvalue-decisions-'));
  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  // A key, so the server gets as far as the cap. Nothing here may reach the API:
  // every call below is refused before one would be made.
  server = spawn(process.execPath, [entry, '--port', String(PORT), '--data', dataDir], {
    stdio: 'ignore', env: { ...process.env, ANTHROPIC_API_KEY: 'test-key-never-sent' },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${URL_BASE}/`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const ceo = await call(`/api/farms/${FARM}/bootstrap`, {
    method: 'POST', body: { name: 'Ebimo Sam', password: '842113', farmName: 'DouValue', memberId: 'person_ceo' },
  });
  tokens.ceo = ceo.body.token;
  for (const [role, login] of [['manager', 'ada'], ['hand', 'emeka']]) {
    await call(`/api/farms/${FARM}/account`, {
      method: 'POST', token: tokens.ceo, body: { name: login, role, login, password: '551234' },
    });
    tokens[role] = (await call('/api/signin', { method: 'POST', body: { login, password: '551234' } })).body.token;
  }
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('FR-DOC-03: a Greenhouse Hand is refused photo review on the server', async () => {
  assert.ok(tokens.hand, 'the hand signed in');
  const res = await call(`/api/farms/${FARM}/photo-review`, { method: 'POST', token: tokens.hand, body: { photos: [] } });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, 'role');
});

test('FR-ADV-07: the monthly cap is the Owner\'s to see and set, and a reached cap stops the call', async () => {
  assert.equal((await call(`/api/farms/${FARM}/spend-cap`, { token: tokens.manager })).status, 403);
  assert.equal((await call(`/api/farms/${FARM}/spend-cap`, { method: 'POST', token: tokens.manager, body: { monthlyUsd: 500 } })).status, 403);

  const set = await call(`/api/farms/${FARM}/spend-cap`, { method: 'POST', token: tokens.ceo, body: { monthlyUsd: 0 } });
  assert.equal(set.status, 200);
  assert.equal(set.body.capUsd, 0);
  assert.equal(set.body.over, true, 'a cap of $0 switches outside advice off');

  const advice = await call(`/api/farms/${FARM}/advise`, { method: 'POST', token: tokens.manager, body: { brief: {} } });
  assert.equal(advice.status, 429);
  assert.equal(advice.body.reason, 'monthly-cap');

  const cleared = await call(`/api/farms/${FARM}/spend-cap`, { method: 'POST', token: tokens.ceo, body: { monthlyUsd: null } });
  assert.equal(cleared.body.capUsd, null);
});

test('FR-XCHK-09: the Owner runs the checks now; the Farm Manager can neither run nor read them', async () => {
  assert.equal((await call(`/api/farms/${FARM}/checks`, { method: 'POST', token: tokens.manager, body: {} })).status, 403);
  const ran = await call(`/api/farms/${FARM}/checks`, { method: 'POST', token: tokens.ceo, body: {} });
  assert.equal(ran.status, 200);
  assert.equal(ran.body.ok, true);

  const owner = await call(`/api/farms/${FARM}/events?since=0`, { token: tokens.ceo });
  assert.ok(owner.body.events.some((e) => e.type === 'checks.record'));
  const manager = await call(`/api/farms/${FARM}/events?since=0`, { token: tokens.manager });
  assert.equal(manager.body.events.some((e) => e.type === 'checks.record'), false);

  const forged = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: tokens.ceo,
    body: { events: [{ id: 'e_forged_checks', type: 'checks.record', payload: { findings: [] } }] },
  });
  assert.equal(forged.body.accepted, 0, 'findings come from the server\'s run, never a phone');
});
