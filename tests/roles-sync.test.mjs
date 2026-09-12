// Who may appoint whom, and whether a day's work actually reaches the other phones.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = new URL('../web/js/', import.meta.url);
const store = await import(new URL('store.js', base).href);

// sync.js reaches for browser globals at import time only through these two.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
const sync = await import(new URL('sync.js', base).href);

// --- The chain of command -------------------------------------------------

const ceo = { id: 'u_ceo', name: 'Owner', role: 'ceo' };
const manager = { id: 'u_mgr', name: 'Manager', role: 'manager' };
const agronomist = { id: 'u_agro', name: 'Agronomist', role: 'agronomist' };
const supervisor = { id: 'u_sup', name: 'Supervisor', role: 'supervisor' };
const hand = { id: 'u_hand', name: 'Hand', role: 'hand' };

test('roles are ranked from the farm hand up to the owner', () => {
  assert.ok(store.roleRank(ceo) > store.roleRank(manager));
  assert.ok(store.roleRank(manager) > store.roleRank(agronomist));
  assert.ok(store.roleRank(agronomist) > store.roleRank(supervisor));
  assert.ok(store.roleRank(supervisor) > store.roleRank(hand));
});

test('the CEO can appoint anyone, including the manager', () => {
  const can = store.assignableRoles(ceo);
  for (const role of ['ceo', 'manager', 'agronomist', 'supervisor', 'hand']) {
    assert.ok(can.includes(role), `CEO should be able to appoint a ${role}`);
  }
});

test('a manager may take on field staff but never another manager', () => {
  const can = store.assignableRoles(manager);
  assert.deepEqual(can.sort(), ['agronomist', 'hand', 'supervisor']);
  assert.equal(store.canAssignRole(manager, 'manager'), false);
  assert.equal(store.canAssignRole(manager, 'ceo'), false);
});

test('field staff cannot create accounts at all', () => {
  for (const person of [agronomist, supervisor, hand]) {
    assert.deepEqual(store.assignableRoles(person), [], `${person.role} should appoint nobody`);
  }
});

test('a manager cannot edit the owner or a peer, but can edit field staff', () => {
  assert.equal(store.canEditPerson(manager, ceo), false);
  assert.equal(store.canEditPerson(manager, { id: 'other', role: 'manager' }), false);
  assert.equal(store.canEditPerson(manager, supervisor), true);
  assert.equal(store.canEditPerson(manager, hand), true);
});

test('anyone may edit their own account', () => {
  assert.equal(store.canEditPerson(hand, hand), true);
  assert.equal(store.canEditPerson(manager, manager), true);
});

test('only the CEO controls the sync link and sees the audit trail', () => {
  assert.equal(store.can(ceo, 'manageSync'), true);
  assert.equal(store.can(manager, 'manageSync'), false);
  assert.equal(store.can(ceo, 'manageOwners'), true);
  assert.equal(store.can(manager, 'manageOwners'), false);
});

test('the CEO still sees every operational screen, not just the money', () => {
  for (const p of ['logHarvest', 'diagnose', 'manageCycles', 'viewReports', 'manageMoney',
    'managePeople', 'settings', 'logSpray', 'assignTasks']) {
    assert.equal(store.can(ceo, p), true, `CEO should have ${p}`);
  }
});

test('the last owner cannot be removed, leaving the farm without one', () => {
  const state = { people: {
    u_ceo: { id: 'u_ceo', role: 'ceo', active: true },
    u_mgr: { id: 'u_mgr', role: 'manager', active: true },
  } };
  const solo = store.canRemovePerson(ceo, { id: 'u_other', role: 'ceo' }, state);
  assert.equal(solo.ok, false);
  assert.match(solo.why, /only CEO/i);

  const two = { people: { ...state.people, u_ceo2: { id: 'u_ceo2', role: 'ceo', active: true } } };
  assert.equal(store.canRemovePerson(ceo, { id: 'u_ceo2', role: 'ceo' }, two).ok, true);
});

test('nobody can remove their own account', () => {
  const state = { people: { u_ceo: { id: 'u_ceo', role: 'ceo', active: true } } };
  assert.equal(store.canRemovePerson(ceo, ceo, state).ok, false);
});

test('a manager cannot remove the owner', () => {
  const state = { people: { u_ceo: { id: 'u_ceo', role: 'ceo', active: true } } };
  assert.equal(store.canRemovePerson(manager, ceo, state).ok, false);
});

// --- Join codes -----------------------------------------------------------

test('a join code carries the server, the farm and the key, and survives a round trip', () => {
  const creds = sync.newFarmCredentials();
  assert.match(creds.farmId, /^farm_/);
  assert.ok(creds.farmKey.length >= 16, 'the key must be long enough to be worth having');

  const code = sync.makeInviteCode({ url: 'https://farm.example.dev/', ...creds });
  const back = sync.readInviteCode(code);
  assert.equal(back.farmId, creds.farmId);
  assert.equal(back.farmKey, creds.farmKey);
  assert.equal(back.url, 'https://farm.example.dev', 'the trailing slash is trimmed');
});

test('two farms never get the same identifiers', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = sync.newFarmCredentials();
    assert.equal(seen.has(c.farmId), false);
    seen.add(c.farmId);
  }
});

test('rubbish in a join code is refused rather than half-accepted', () => {
  for (const bad of ['', 'hello', 'e30=', btoa('{"url":"x"}'), 'not base64 at all!!']) {
    assert.equal(sync.readInviteCode(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('the status line says something a farm hand can act on', () => {
  assert.match(sync.statusLine({ configured: false, state: 'off' }).text, /this phone only/i);
  const waiting = sync.statusLine({ configured: true, state: 'offline', pending: 3 });
  assert.match(waiting.text, /3 records waiting/);
  assert.equal(waiting.tone, 'warn');
  const clean = sync.statusLine({ configured: true, state: 'idle', pending: 0, lastSyncAt: 'x' });
  assert.equal(clean.tone, 'ok');
  assert.match(sync.statusLine({ configured: true, state: 'error', lastError: 'boom' }).text, /boom/);
});

// --- The server, exercised for real ---------------------------------------

let server = null;
let dataDir = null;
const PORT = 8791;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const FARM = 'farm_testing';
const KEY = 'key-for-the-tests-1234';
const auth = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'douvalue-sync-'));
  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  server = spawn(process.execPath, [entry, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${URL_BASE}/api/farms/${FARM}/health`, { headers: auth });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('sync server did not start');
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const push = (events) => fetch(`${URL_BASE}/api/farms/${FARM}/events`, {
  method: 'POST', headers: auth, body: JSON.stringify({ events }),
}).then((r) => r.json());

const pull = (since = 0, limit = 500) =>
  fetch(`${URL_BASE}/api/farms/${FARM}/events?since=${since}&limit=${limit}`, { headers: auth })
    .then((r) => r.json());

test('the server takes events and hands them back in order', async () => {
  const sent = [
    { id: 'ev_a', type: 'harvest.record', at: '2026-09-01T08:00:00Z', payload: { kg: 10 } },
    { id: 'ev_b', type: 'harvest.record', at: '2026-09-01T09:00:00Z', payload: { kg: 20 } },
  ];
  const result = await push(sent);
  assert.equal(result.accepted, 2);
  const page = await pull(0);
  assert.equal(page.events.length, 2);
  assert.deepEqual(page.events.map((e) => e.id), ['ev_a', 'ev_b']);
  assert.equal(page.more, false);
});

test('pushing the same events twice changes nothing', async () => {
  const again = await push([{ id: 'ev_a', type: 'harvest.record' }, { id: 'ev_c', type: 'sale.record' }]);
  assert.equal(again.accepted, 1, 'only the new one lands');
  assert.equal(again.skipped, 1, 'the repeat is ignored');
  const page = await pull(0);
  assert.equal(page.events.filter((e) => e.id === 'ev_a').length, 1, 'no duplicate in the log');
});

test('a device only receives what it has not already seen', async () => {
  const first = await pull(0, 2);
  assert.equal(first.events.length, 2);
  assert.equal(first.more, true);
  const next = await pull(first.cursor);
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].id, 'ev_c');
  assert.equal(next.more, false);
  const nothing = await pull(next.cursor);
  assert.deepEqual(nothing.events, []);
});

test('the wrong farm key gets nothing', async () => {
  const res = await fetch(`${URL_BASE}/api/farms/${FARM}/events?since=0`, {
    headers: { Authorization: 'Bearer completely-wrong-key' },
  });
  assert.equal(res.status, 403);
  const none = await fetch(`${URL_BASE}/api/farms/${FARM}/health`);
  assert.equal(none.status, 401);
});

test('one farm cannot read another farm', async () => {
  await fetch(`${URL_BASE}/api/farms/other_farm/events`, {
    method: 'POST',
    headers: { Authorization: 'Bearer a-totally-different-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ id: 'secret_1', type: 'sale.record' }] }),
  });
  const mine = await pull(0);
  assert.equal(mine.events.some((e) => e.id === 'secret_1'), false);
});

test('two phones offline at the same time both keep their work', async () => {
  // Phone A and phone B each record while apart, then both come back into signal.
  const phoneA = [{ id: 'ev_a1', type: 'harvest.record', payload: { by: 'A' } },
    { id: 'ev_a2', type: 'work.log', payload: { by: 'A' } }];
  const phoneB = [{ id: 'ev_b1', type: 'harvest.record', payload: { by: 'B' } },
    { id: 'ev_b2', type: 'spray.record', payload: { by: 'B' } }];

  const before = (await pull(0)).events.length;
  await Promise.all([push(phoneA), push(phoneB)]);
  const after = await pull(0);

  assert.equal(after.events.length, before + 4, 'nothing was dropped by the overlap');
  for (const id of ['ev_a1', 'ev_a2', 'ev_b1', 'ev_b2']) {
    assert.ok(after.events.some((e) => e.id === id), `${id} survived`);
  }
});

test('a malformed push is rejected without corrupting the log', async () => {
  const before = (await pull(0)).events.length;
  const res = await fetch(`${URL_BASE}/api/farms/${FARM}/events`, {
    method: 'POST', headers: auth, body: 'this is not json',
  });
  assert.equal(res.status, 400);
  const junk = await push([null, { noId: true }, { id: '', type: 'x' }]);
  assert.equal(junk.accepted, 0);
  assert.equal((await pull(0)).events.length, before, 'the log is untouched');
});

test('the log survives the server being restarted', async () => {
  const before = await pull(0);
  server.kill();
  await new Promise((r) => setTimeout(r, 300));

  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  server = spawn(process.execPath, [entry, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${URL_BASE}/api/farms/${FARM}/health`, { headers: auth })).ok) break; }
    catch { /* still coming up */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  const after = await pull(0);
  assert.deepEqual(after.events.map((e) => e.id), before.events.map((e) => e.id));
});

test('what the server returns still replays into a farm', async () => {
  // The point of the whole exercise: events that went through the server are
  // still a valid log, so a phone that pulls them rebuilds the same farm.
  const events = [
    { id: 's1', type: 'person.upsert', at: '2026-01-01T08:00:00Z', by: 'u_ceo',
      payload: { id: 'u_ceo', name: 'Owner', role: 'ceo' } },
    { id: 's2', type: 'plot.upsert', at: '2026-01-02T08:00:00Z', by: 'u_ceo',
      payload: { id: 'b1', name: 'Bed 1', areaM2: 600 } },
    { id: 's3', type: 'cycle.start', at: '2026-05-01T08:00:00Z', by: 'u_ceo',
      payload: { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: '2026-05-01', plants: 100 } },
    { id: 's4', type: 'harvest.record', at: '2026-09-01T08:00:00Z', by: 'u_ceo',
      payload: { cycleId: 'c1', kg: 42, date: '2026-09-01' } },
  ];
  await fetch(`${URL_BASE}/api/farms/replay_farm/events`, {
    method: 'POST',
    headers: { Authorization: 'Bearer replay-farm-key-9999', 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  const page = await fetch(`${URL_BASE}/api/farms/replay_farm/events?since=0`, {
    headers: { Authorization: 'Bearer replay-farm-key-9999' },
  }).then((r) => r.json());

  const rebuilt = store.reduce(page.events);
  assert.equal(rebuilt.people.u_ceo.role, 'ceo');
  assert.equal(rebuilt.cycles.c1.harvestedKg, 42);
  assert.equal(store.activeCycles(rebuilt).length, 1);
});
