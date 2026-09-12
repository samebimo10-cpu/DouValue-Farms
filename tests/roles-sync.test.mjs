// The chain of command, and whether the server actually enforces it.
//
// The point of these tests is adversarial: not "does a farm hand's app hide the
// wage bill", but "can a farm hand's token get the wage bill out of the server
// at all". The app's role checks are a convenience. This is the fence.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

const base = new URL('../web/js/', import.meta.url);
const store = await import(new URL('store.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

// --- The chain of command, as the app sees it -----------------------------

const ceo = { id: 'u_ceo', name: 'Owner', role: 'ceo' };
const manager = { id: 'u_mgr', name: 'Manager', role: 'manager' };
const supervisor = { id: 'u_sup', name: 'Supervisor', role: 'supervisor' };
const hand = { id: 'u_hand', name: 'Hand', role: 'hand' };

test('roles are ranked from the farm hand up to the owner', () => {
  assert.ok(store.roleRank(ceo) > store.roleRank(manager));
  assert.ok(store.roleRank(manager) > store.roleRank({ role: 'agronomist' }));
  assert.ok(store.roleRank({ role: 'agronomist' }) > store.roleRank(supervisor));
  assert.ok(store.roleRank(supervisor) > store.roleRank(hand));
});

test('the CEO can appoint anyone; a manager only below themselves', () => {
  for (const role of ['ceo', 'manager', 'agronomist', 'supervisor', 'hand']) {
    assert.ok(store.assignableRoles(ceo).includes(role));
  }
  assert.deepEqual(store.assignableRoles(manager).sort(), ['agronomist', 'hand', 'supervisor']);
  assert.deepEqual(store.assignableRoles(hand), []);
});

test('the app and the server agree on who may appoint whom', () => {
  // Two copies of the rules exist: one shapes the screens, one guards the data.
  // If they ever drift, the app offers something the server will refuse.
  for (const role of Object.keys(core.ROLES)) {
    assert.deepEqual(
      core.assignableRoles(role).sort(),
      store.assignableRoles({ role }).sort(),
      `${role} disagrees between app and server`,
    );
  }
});

test('a manager cannot edit the owner or a peer', () => {
  assert.equal(store.canEditPerson(manager, ceo), false);
  assert.equal(store.canEditPerson(manager, { id: 'other', role: 'manager' }), false);
  assert.equal(store.canEditPerson(manager, hand), true);
});

test('the last owner cannot be removed', () => {
  const state = { people: { u_ceo: { id: 'u_ceo', role: 'ceo', active: true } } };
  const result = store.canRemovePerson(ceo, { id: 'u_other', role: 'ceo' }, state);
  assert.equal(result.ok, false);
  assert.match(result.why, /only CEO/i);
});

// --- What the server will and will not hand over ---------------------------

test('a farm hand is never sent the money, redaction or not', () => {
  const sale = { id: 's1', type: 'sale.record', payload: { amount: 500000 } };
  assert.equal(core.visibleTo(sale, { memberId: 'h', role: 'hand' }), null);
  assert.equal(core.visibleTo(sale, { memberId: 's', role: 'supervisor' }), null);
  assert.equal(core.visibleTo(sale, { memberId: 'a', role: 'agronomist' }), null);
  assert.ok(core.visibleTo(sale, { memberId: 'm', role: 'manager' }));
  assert.ok(core.visibleTo(sale, { memberId: 'c', role: 'ceo' }));
});

test('colleagues travel as names and roles, never as wages', () => {
  const event = { id: 'p1', type: 'person.upsert',
    payload: { id: 'x', name: 'Ada', role: 'hand', dailyRate: 3500, phone: '080', pinHash: 'secret' } };

  const seenByHand = core.visibleTo(event, { memberId: 'h', role: 'hand' }).payload;
  assert.equal(seenByHand.name, 'Ada', 'a hand still knows who their colleagues are');
  assert.equal(seenByHand.dailyRate, undefined);
  assert.equal(seenByHand.phone, undefined);
  assert.equal(seenByHand.pinHash, undefined, 'a password digest never leaves the server');

  const ownRecord = core.visibleTo(event, { memberId: 'x', role: 'hand' }).payload;
  assert.equal(ownRecord.dailyRate, 3500, 'but everyone may see their own pay');

  const seenByManager = core.visibleTo(event, { memberId: 'm', role: 'manager' }).payload;
  assert.equal(seenByManager.dailyRate, 3500);
  assert.equal(seenByManager.pinHash, undefined, 'not even the books get the digest');
});

test('own-pay works whether the reader is a session or a stored member', () => {
  // The server passes a stored member record, which is keyed id; the app passes
  // a session, which is keyed memberId. Honouring only one of them meant nobody
  // ever saw their own wage on the live path, and the unit test still passed.
  const event = { id: 'p1', type: 'person.upsert', payload: { id: 'x', name: 'Ada', role: 'hand', dailyRate: 3500 } };
  assert.equal(core.visibleTo(event, { memberId: 'x', role: 'hand' }).payload.dailyRate, 3500);
  assert.equal(core.visibleTo(event, { id: 'x', role: 'hand' }).payload.dailyRate, 3500);
  assert.equal(core.visibleTo(event, { id: 'other', role: 'hand' }).payload.dailyRate, undefined);
});

test('prices are commercial; crate weights are not', () => {
  const event = { id: 'st', type: 'settings.update',
    payload: { crateKg: 12, kgPerPersonHour: 12, prices: { habanero: 2600 }, defaultDailyWage: 3500 } };
  const forHand = core.visibleTo(event, { memberId: 'h', role: 'hand' }).payload;
  assert.equal(forHand.crateKg, 12, 'a hand needs the crate weight to record a harvest');
  assert.equal(forHand.prices, undefined);
  assert.equal(forHand.defaultDailyWage, undefined);
  assert.ok(core.visibleTo(event, { memberId: 'c', role: 'ceo' }).payload.prices);
});

test('nobody can write outside their role, or promote themselves', () => {
  const sale = { id: 's', type: 'sale.record', payload: {} };
  assert.equal(core.mayWrite(sale, { id: 'h', role: 'hand' }).ok, false);
  assert.equal(core.mayWrite(sale, { id: 'm', role: 'manager' }).ok, true);

  const selfPromote = { id: 'p', type: 'person.upsert', payload: { id: 'h', role: 'ceo' } };
  assert.equal(core.mayWrite(selfPromote, { id: 'h', role: 'hand' }).ok, false);
  assert.equal(core.mayWrite(selfPromote, { id: 'm', role: 'manager' }).ok, false,
    'not even a manager may mint an owner');
  assert.equal(core.mayWrite(selfPromote, { id: 'c', role: 'ceo' }).ok, true);

  const rivalManager = { id: 'p2', type: 'person.upsert', payload: { id: 'z', role: 'manager' } };
  assert.equal(core.mayWrite(rivalManager, { id: 'm', role: 'manager' }).ok, false);
});

test('an unknown record type is neither stored nor relayed', () => {
  const odd = { id: 'x', type: 'something.invented', payload: {} };
  assert.equal(core.mayWrite(odd, { id: 'c', role: 'ceo' }).ok, false);
  assert.equal(core.visibleTo(odd, { memberId: 'c', role: 'ceo' }), null);
});

test('secrets are hashed slowly and compared without leaking', async () => {
  const { salt, hash } = await core.hashSecret('4821');
  assert.notEqual(hash, '4821');
  assert.equal(await core.verifySecret('4821', salt, hash), true);
  assert.equal(await core.verifySecret('4822', salt, hash), false);
  assert.equal(await core.verifySecret('4821', salt, null), false);
  assert.equal(core.timingSafeEqualHex('abc', 'abd'), false);
  assert.equal(core.timingSafeEqualHex('abc', 'abc'), true);
});

test('join codes avoid the characters people misread', () => {
  const code = core.randomCode(24);
  assert.equal(/[IO01]/.test(code), false, `${code} should avoid I, O, 0 and 1`);
});

test('repeated wrong tries lock an account for a while', () => {
  let member = { failedAttempts: 0, lockedUntil: 0 };
  for (let i = 0; i < 5; i++) {
    member = { ...member, ...core.afterFailure(member) };
    assert.equal(core.lockoutState(member).locked, false, `try ${i + 1} should not lock yet`);
  }
  member = { ...member, ...core.afterFailure(member) };
  assert.equal(core.lockoutState(member).locked, true, 'the sixth try locks it');
  assert.ok(core.lockoutState(member).seconds > 600);
});

// --- The server, run for real ---------------------------------------------

let server = null;
let dataDir = null;
const PORT = 8793;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const FARM = 'farm_under_test';

const call = async (path, { method = 'GET', token = null, body = null } = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* some replies have no body */ }
  return { status: res.status, body: payload };
};

let ceoToken = null;
let handToken = null;
let handId = null;

before(async () => {
  dataDir = mkdtempSync(pathJoin(tmpdir(), 'douvalue-farm-'));
  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  server = spawn(process.execPath, [entry, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${URL_BASE}/`)).ok) return; } catch { /* still coming up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('farm server did not start');
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('the farm is created once, with its owner', async () => {
  const made = await call(`/api/farms/${FARM}/bootstrap`, {
    method: 'POST',
    body: { name: 'Ebimo Sam', password: '8421', farmName: 'DouValue Farms Limited', memberId: 'person_ceo' },
  });
  assert.equal(made.status, 200);
  assert.equal(made.body.member.role, 'ceo');
  assert.ok(made.body.token);
  ceoToken = made.body.token;

  const again = await call(`/api/farms/${FARM}/bootstrap`, {
    method: 'POST', body: { name: 'Impostor', password: '0000' },
  });
  assert.equal(again.status, 409, 'a second bootstrap must not seize an existing farm');
});

test('no token, no data', async () => {
  assert.equal((await call(`/api/farms/${FARM}/events?since=0`)).status, 401);
  assert.equal((await call(`/api/farms/${FARM}/events?since=0`, { token: 'made-up' })).status, 401);
});

test('the CEO invites a farm hand and gets a one-time code', async () => {
  const invited = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: ceoToken, body: { name: 'Emeka Okoro', role: 'hand' },
  });
  assert.equal(invited.status, 200);
  assert.match(invited.body.joinCode, /^[A-Z2-9]{6}$/);
  assert.match(invited.body.joinPassword, /^[A-Z2-9]{6}$/);
  handId = invited.body.memberId;

  const wrongPassword = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: 'WRONG9', pin: '1111' },
  });
  assert.equal(wrongPassword.status, 403, 'the code alone is not enough');

  const joined = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: invited.body.joinPassword, pin: '7391' },
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.member.role, 'hand');
  handToken = joined.body.token;

  const reused = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: invited.body.joinPassword, pin: '2222' },
  });
  assert.equal(reused.status, 403, 'an invite works exactly once');
});

test('a farm hand cannot invite anybody', async () => {
  const attempt = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: handToken, body: { name: 'Friend', role: 'hand' },
  });
  assert.equal(attempt.status, 403);
});

test('a manager cannot invite another manager', async () => {
  const invited = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: ceoToken, body: { name: 'Ada Briggs', role: 'manager' },
  });
  const joined = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: invited.body.joinPassword, pin: '5150' },
  });
  const managerToken = joined.body.token;

  const rival = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: managerToken, body: { name: 'Rival', role: 'manager' },
  });
  assert.equal(rival.status, 403);

  const owner = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: managerToken, body: { name: 'Rival Owner', role: 'ceo' },
  });
  assert.equal(owner.status, 403);

  const allowed = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: managerToken, body: { name: 'Blessing', role: 'supervisor' },
  });
  assert.equal(allowed.status, 200, 'but field staff are theirs to take on');
});

test('the CEO files records of every kind', async () => {
  const events = [
    { id: 'e_person', type: 'person.upsert', at: '2026-01-01T08:00:00Z',
      payload: { id: handId, name: 'Emeka Okoro', role: 'hand', dailyRate: 3500, phone: '08030000004' } },
    { id: 'e_settings', type: 'settings.update', at: '2026-01-01T08:01:00Z',
      payload: { crateKg: 12, prices: { habanero: 2600 }, defaultDailyWage: 3500 } },
    { id: 'e_plot', type: 'plot.upsert', at: '2026-01-02T08:00:00Z',
      payload: { id: 'b1', name: 'Bed 1', areaM2: 800 } },
    { id: 'e_cycle', type: 'cycle.start', at: '2026-05-01T08:00:00Z',
      payload: { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: '2026-05-01', plants: 1200 } },
    { id: 'e_sale', type: 'sale.record', at: '2026-09-01T08:00:00Z',
      payload: { kg: 190, amount: 532000, buyer: 'Mile 3 trader', date: '2026-09-01' } },
    { id: 'e_expense', type: 'expense.record', at: '2026-09-02T08:00:00Z',
      payload: { amount: 248000, category: 'inputs', date: '2026-09-02' } },
  ];
  const pushed = await call(`/api/farms/${FARM}/events`, { method: 'POST', token: ceoToken, body: { events } });
  assert.equal(pushed.status, 200);
  assert.equal(pushed.body.accepted, 6);
  assert.deepEqual(pushed.body.refused, []);
});

test("the hand's own token cannot pull the money out of the server", async () => {
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: handToken });
  assert.equal(page.status, 200);

  const ids = page.body.events.map((e) => e.id);
  assert.equal(ids.includes('e_sale'), false, 'a sale must never reach a farm hand');
  assert.equal(ids.includes('e_expense'), false);
  assert.ok(ids.includes('e_plot'), 'but the beds must, or the app is useless');
  assert.ok(page.body.withheld >= 2, 'and the server says it held things back');

  const wire = JSON.stringify(page.body);
  assert.equal(wire.includes('532000'), false, 'the figure is not on the wire at all');
  assert.equal(wire.includes('Mile 3 trader'), false);
});

test('a farm hand sees who their colleagues are, but not what they earn', async () => {
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: handToken });
  const person = page.body.events.find((e) => e.id === 'e_person');
  assert.ok(person, 'the record still travels');
  assert.equal(person.payload.name, 'Emeka Okoro');
  // This particular record is the hand's own, so their own rate is theirs to see.
  assert.equal(person.payload.dailyRate, 3500);

  const settings = page.body.events.find((e) => e.id === 'e_settings');
  assert.equal(settings.payload.crateKg, 12);
  assert.equal(settings.payload.prices, undefined, 'prices are commercial');
  assert.equal(settings.payload.defaultDailyWage, undefined);
});

test('the CEO does get everything', async () => {
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: ceoToken });
  const ids = page.body.events.map((e) => e.id);
  for (const id of ['e_person', 'e_settings', 'e_plot', 'e_cycle', 'e_sale', 'e_expense']) {
    assert.ok(ids.includes(id), `the owner should see ${id}`);
  }
  assert.equal(page.body.withheld, 0);
});

test('a farm hand filing a sale is refused, not quietly accepted', async () => {
  const attempt = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: handToken,
    body: { events: [{ id: 'e_forged_sale', type: 'sale.record', payload: { amount: 1 } }] },
  });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.accepted, 0);
  assert.equal(attempt.body.refused.length, 1);
  assert.match(attempt.body.refused[0].why, /may not file/);

  const asCeo = await call(`/api/farms/${FARM}/events?since=0`, { token: ceoToken });
  assert.equal(asCeo.body.events.some((e) => e.id === 'e_forged_sale'), false);
});

test('a farm hand cannot promote themselves by pushing a record', async () => {
  const attempt = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: handToken,
    body: { events: [{ id: 'e_coup', type: 'person.upsert', payload: { id: handId, name: 'Emeka', role: 'ceo' } }] },
  });
  assert.equal(attempt.body.accepted, 0);
  assert.equal(attempt.body.refused.length, 1);

  const me = await call(`/api/farms/${FARM}/me`, { token: handToken });
  assert.equal(me.body.member.role, 'hand', 'still a farm hand');
});

test('work is filed under whoever actually sent it', async () => {
  await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: handToken,
    body: { events: [{ id: 'e_harvest', type: 'harvest.record', by: 'person_ceo',
      payload: { cycleId: 'c1', kg: 48, date: '2026-09-10' } }] },
  });
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: ceoToken });
  const harvest = page.body.events.find((e) => e.id === 'e_harvest');
  assert.equal(harvest.by, handId, 'the claimed author is replaced with the authenticated one');
});

test('signing a phone out stops that token dead', async () => {
  const stillWorks = await call(`/api/farms/${FARM}/me`, { token: handToken });
  assert.equal(stillWorks.status, 200);

  const revoked = await call(`/api/farms/${FARM}/revoke`, {
    method: 'POST', token: ceoToken, body: { memberId: handId, devicesOnly: true },
  });
  assert.equal(revoked.status, 200);

  const after = await call(`/api/farms/${FARM}/me`, { token: handToken });
  assert.equal(after.status, 401, 'the lost handset is locked out immediately');
});

test('one farm cannot read another', async () => {
  const other = await call('/api/farms/farm_someone_else/bootstrap', {
    method: 'POST', body: { name: 'Other Owner', password: '9999' },
  });
  const otherToken = other.body.token;
  const crossing = await call(`/api/farms/${FARM}/events?since=0`, { token: otherToken });
  assert.equal(crossing.status, 401, "another farm's token is worthless here");
});

test('what survives the wire still replays into a farm', async () => {
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: ceoToken });
  const rebuilt = store.reduce(page.body.events);
  assert.equal(rebuilt.cycles.c1.harvestedKg, 48);
  assert.equal(rebuilt.plots.b1.name, 'Bed 1');
  assert.equal(store.activeCycles(rebuilt).length, 1);
});

test('the same farm replays differently for a hand, and still works', async () => {
  const handRejoin = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: ceoToken, body: { name: 'Emeka Again', role: 'hand' },
  });
  const joined = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: handRejoin.body.joinCode, joinPassword: handRejoin.body.joinPassword, pin: '4242' },
  });
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: joined.body.token });
  const rebuilt = store.reduce(page.body.events);

  assert.equal(rebuilt.plots.b1.name, 'Bed 1', 'the beds are there');
  assert.equal(rebuilt.cycles.c1.harvestedKg, 48, 'the harvest is there');
  assert.equal(rebuilt.sales.length, 0, 'the money is not');
  assert.equal(rebuilt.expenses.length, 0);
});

test('the generated Deno server has not drifted from the core', async () => {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const generated = new URL('../server/deno-sync.ts', import.meta.url).pathname;
  const before = readFileSync(generated, 'utf8');
  execFileSync(process.execPath, [new URL('../scripts-build-deno.mjs', import.meta.url).pathname], { stdio: 'ignore' });
  assert.equal(readFileSync(generated, 'utf8'), before,
    'server/deno-sync.ts is generated: run node douvalue/scripts-build-deno.mjs and commit the result');
});
