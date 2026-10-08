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
const { ownerOverrides } = await import(new URL('./helpers/gates-cleared.mjs', import.meta.url).href);

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
  // NFR-SEC-02 sets this at five tries. It was six before the requirements
  // arrived; the number is the requirement's to set, not ours.
  let member = { failedAttempts: 0, lockedUntil: 0 };
  for (let i = 0; i < 4; i++) {
    member = { ...member, ...core.afterFailure(member) };
    assert.equal(core.lockoutState(member).locked, false, `try ${i + 1} should not lock yet`);
  }
  member = { ...member, ...core.afterFailure(member) };
  assert.equal(core.lockoutState(member).locked, true, 'the fifth try locks it');
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
  const plot = { id: 'e_plot', type: 'plot.upsert', at: '2026-01-02T08:00:00Z',
    payload: { id: 'b1', name: 'Bed 1', areaM2: 800 } };
  // The server judges a planting against the gates now (FR-GATE-01 to 03).
  // This test is about who may file what, so the Owner overrides them —
  // FR-GATE-07, and itself a record only the CEO may file.
  const overrides = await ownerOverrides([{ ...plot, by: 'x' }], 'b1', { today: '2026-05-01', at: '2026-04-30T08:00:00Z' });
  const events = [
    { id: 'e_person', type: 'person.upsert', at: '2026-01-01T08:00:00Z',
      payload: { id: handId, name: 'Emeka Okoro', role: 'hand', dailyRate: 3500, phone: '08030000004' } },
    { id: 'e_settings', type: 'settings.update', at: '2026-01-01T08:01:00Z',
      payload: { crateKg: 12, prices: { habanero: 2600 }, defaultDailyWage: 3500 } },
    plot,
    ...overrides,
    { id: 'e_cycle', type: 'cycle.start', at: '2026-05-01T08:00:00Z',
      payload: { id: 'c1', plotId: 'b1', cropId: 'habanero', transplantDate: '2026-05-01', plants: 1200 } },
    { id: 'e_sale', type: 'sale.record', at: '2026-09-01T08:00:00Z',
      payload: { kg: 190, amount: 532000, buyer: 'Mile 3 trader', date: '2026-09-01' } },
    { id: 'e_expense', type: 'expense.record', at: '2026-09-02T08:00:00Z',
      payload: { amount: 248000, category: 'inputs', date: '2026-09-02' } },
  ];
  const pushed = await call(`/api/farms/${FARM}/events`, { method: 'POST', token: ceoToken, body: { events } });
  assert.equal(pushed.status, 200);
  assert.deepEqual(pushed.body.refused, []);
  assert.ok(overrides.length > 0, 'the bare bed is blocked until overridden');
  assert.equal(pushed.body.accepted, 6 + overrides.length);
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

test('a manager cannot unseat the owner by rewriting their record', async () => {
  // The dangerous shape: "make this person a farm hand" is a role a manager may
  // grant, so pointing it at the CEO's own account would slip past a check that
  // only looked at the role being handed out. Every app reads roles out of this
  // log, so it would have handed the owner a farm hand's screens.
  const invited = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: ceoToken, body: { name: 'Second Manager', role: 'manager' },
  });
  const joined = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: invited.body.joinPassword, pin: '3030' },
  });
  const managerToken = joined.body.token;

  const demote = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: managerToken,
    body: { events: [{ id: 'e_demote_ceo', type: 'person.upsert',
      payload: { id: 'person_ceo', name: 'Ebimo Sam', role: 'hand' } }] },
  });
  assert.equal(demote.body.accepted, 0, 'the owner must not be demotable');
  assert.match(demote.body.refused[0].why, /cannot change a ceo/i);

  const remove = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: managerToken,
    body: { events: [{ id: 'e_remove_ceo', type: 'person.deactivate', payload: { id: 'person_ceo' } }] },
  });
  assert.equal(remove.body.accepted, 0, 'nor removable');

  // And the owner's record in the log is untouched.
  const page = await call(`/api/farms/${FARM}/events?since=0`, { token: ceoToken });
  assert.equal(page.body.events.some((e) => e.id === 'e_demote_ceo'), false);
  assert.equal(page.body.events.some((e) => e.id === 'e_remove_ceo'), false);
});

test('a manager cannot promote themselves by editing their own record', async () => {
  const invited = await call(`/api/farms/${FARM}/invite`, {
    method: 'POST', token: ceoToken, body: { name: 'Third Manager', role: 'manager' },
  });
  const joined = await call(`/api/farms/${FARM}/join`, {
    method: 'POST',
    body: { joinCode: invited.body.joinCode, joinPassword: invited.body.joinPassword, pin: '4040' },
  });
  const token = joined.body.token;
  const myId = joined.body.member.id;

  const selfPromote = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token,
    body: { events: [{ id: 'e_self_ceo', type: 'person.upsert',
      payload: { id: myId, name: 'Third Manager', role: 'ceo' } }] },
  });
  assert.equal(selfPromote.body.accepted, 0);

  // But editing their own details, without touching the role, is fine.
  const ownDetails = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token,
    body: { events: [{ id: 'e_own_phone', type: 'person.upsert',
      payload: { id: myId, name: 'Third Manager', role: 'manager', phone: '08031111111' } }] },
  });
  assert.equal(ownDetails.body.accepted, 1, 'people may still correct their own details');

  const selfRemove = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token,
    body: { events: [{ id: 'e_self_remove', type: 'person.deactivate', payload: { id: myId } }] },
  });
  assert.equal(selfRemove.body.accepted, 0, 'and nobody deletes themselves');
});

test('a record naming nobody is refused', async () => {
  const nameless = await call(`/api/farms/${FARM}/events`, {
    method: 'POST', token: ceoToken,
    body: { events: [{ id: 'e_nameless', type: 'person.upsert', payload: { name: 'Ghost', role: 'hand' } }] },
  });
  assert.equal(nameless.body.accepted, 0);
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

// --- UX-28: the CEO makes the sign-in, the person signs in on any phone ------

const account = (token, body) => call(`/api/farms/${FARM}/account`, { method: 'POST', token, body });
const signIn = (login, password) => call('/api/signin', { method: 'POST', body: { login, password, device: 'test' } });

test('UX-28: the CEO makes a sign-in name and password, and the person lands in the role they were given', async () => {
  const made = await account(ceoToken, { name: 'Chidi Okafor', role: 'manager', login: 'Chidi', password: '482913' });
  assert.equal(made.status, 200);
  assert.equal(made.body.login, 'chidi', 'sign-in names are kept in lower case');
  assert.equal(made.body.password, undefined, 'the password is never sent back');

  // A new phone knows only the server: the name finds the farm.
  const inside = await signIn('CHIDI', '482913');
  assert.equal(inside.status, 200);
  assert.equal(inside.body.farmId, FARM);
  assert.equal(inside.body.member.role, 'manager');
  assert.equal(inside.body.member.name, 'Chidi Okafor');
  assert.equal(inside.body.member.passHash, undefined);

  const me = await call(`/api/farms/${FARM}/me`, { token: inside.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.member.role, 'manager');

  // It works again from a second phone: unlike an invite, it is not used up.
  assert.equal((await signIn('chidi', '482913')).status, 200);
});

test('UX-28: a wrong password and an unknown name get the same answer', async () => {
  const wrong = await signIn('chidi', '000000');
  const nobody = await signIn('nobody-here', '482913');
  assert.equal(wrong.status, 403);
  assert.equal(nobody.status, 403);
  assert.equal(wrong.body.error, nobody.body.error, 'the page must not reveal who works here');
});

test('UX-28: the password is 6 to 12 digits, and a sign-in name belongs to one person', async () => {
  for (const password of ['4821', '12345', 'abcdef', '1234567890123']) {
    const r = await account(ceoToken, { name: 'Short', role: 'hand', login: 'shorty', password });
    assert.equal(r.status, 400, `${password} should be refused`);
  }
  const taken = await account(ceoToken, { name: 'Another Chidi', role: 'hand', login: 'chidi', password: '555111' });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /taken/);
  assert.equal((await account(ceoToken, { name: 'Spaces', role: 'hand', login: 'ada b', password: '555111' })).body.login, 'adab');
  assert.equal((await account(ceoToken, { name: 'Bad', role: 'hand', login: 'no!', password: '555111' })).status, 400);
});

test('UX-28: a manager makes sign-ins only below their own level', async () => {
  const mgr = (await signIn('chidi', '482913')).body.token;
  assert.equal((await account(mgr, { name: 'Rival', role: 'manager', login: 'rival', password: '111222' })).status, 403);
  assert.equal((await account(mgr, { name: 'Owner 2', role: 'ceo', login: 'owner2', password: '111222' })).status, 403);
  assert.equal((await account(mgr, { memberId: 'person_ceo', name: 'Ebimo Sam', role: 'ceo', login: 'ebimo', password: '111222' })).status, 403,
    'nor reset the owner\'s password');
  const sup = await account(mgr, { name: 'Blessing Ama', role: 'supervisor', login: 'blessing', password: '737373' });
  assert.equal(sup.status, 200);
  assert.equal((await signIn('blessing', '737373')).body.member.role, 'supervisor');
  // A farm hand cannot make anyone.
  const handT = (await signIn('blessing', '737373')).body.token;
  assert.equal((await account(handT, { name: 'Friend', role: 'hand', login: 'friend', password: '737373' })).status, 403);
});

test('UX-28: changing the job keeps the password; a new password replaces the old', async () => {
  const id = (await signIn('blessing', '737373')).body.member.id;
  const promoted = await account(ceoToken, { memberId: id, name: 'Blessing Ama', role: 'agronomist', login: 'blessing' });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.passwordChanged, false);
  const after = await signIn('blessing', '737373');
  assert.equal(after.body.member.role, 'agronomist', 'the next sign-in carries the new job');

  await account(ceoToken, { memberId: id, name: 'Blessing Ama', role: 'agronomist', login: 'blessing', password: '909090' });
  assert.equal((await signIn('blessing', '737373')).status, 403);
  assert.equal((await signIn('blessing', '909090')).status, 200);

  // A new account cannot be made without a password.
  assert.equal((await account(ceoToken, { name: 'No Pass', role: 'hand', login: 'nopass' })).status, 400);
});

test('UX-28 / NFR-SEC-02: five wrong passwords lock the sign-in for a while', async () => {
  await account(ceoToken, { name: 'Musa Bello', role: 'hand', login: 'musa', password: '246810' });
  for (let i = 0; i < 5; i++) assert.equal((await signIn('musa', '000000')).status, 403);
  const locked = await signIn('musa', '246810');
  assert.equal(locked.status, 429, 'even the right password waits out the lock');
});

test('UX-28: removing someone closes their sign-in', async () => {
  const made = await account(ceoToken, { name: 'Leaving Soon', role: 'hand', login: 'leaver', password: '135791' });
  const token = (await signIn('leaver', '135791')).body.token;
  const removed = await call(`/api/farms/${FARM}/revoke`, { method: 'POST', token: ceoToken, body: { memberId: made.body.memberId } });
  assert.equal(removed.status, 200);
  assert.equal((await signIn('leaver', '135791')).status, 403);
  assert.equal((await call(`/api/farms/${FARM}/me`, { token })).status, 401);
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

// The app already builds the brief to the asker's role. This is the second
// fence: the server must strip money again on the way out, because an app that
// redacts correctly is a convenience and a server that does is a guarantee.
test('the adviser brief is redacted again on the server, whatever the app sent', () => {
  const sent = {
    farm: { name: 'DouValue', askedBy: { role: 'hand', seesMoney: true } },
    growing: [{ bed: 'Bed 1', pickedKg: 40 }],
    economics: { last90Days: { revenueNgn: 900000, costPerKgNgn: 1200 } },
  };

  for (const role of ['hand', 'supervisor', 'agronomist']) {
    const out = core.redactBrief(structuredClone(sent), role);
    assert.equal(out.economics, undefined, `${role} must not receive money`);
    assert.equal(out.farm.askedBy.seesMoney, false, `${role} is told they cannot see money`);
    assert.ok(out.growing, `${role} still gets the agronomy`);
    assert.ok(!JSON.stringify(out).includes('900000'), `no naira reaches a ${role}`);
  }

  for (const role of ['manager', 'ceo']) {
    const out = core.redactBrief(structuredClone(sent), role);
    assert.ok(out.economics, `${role} keeps the money`);
  }
});

test('the generated Deno servers have not drifted from the core', async () => {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const generated = [
    new URL('../server/deno-sync.ts', import.meta.url).pathname,
    new URL('../server/deploy/main.ts', import.meta.url).pathname,
  ];
  const before = generated.map((path) => readFileSync(path, 'utf8'));
  execFileSync(process.execPath, [new URL('../scripts-build-deno.mjs', import.meta.url).pathname], { stdio: 'ignore' });
  generated.forEach((path, i) => {
    assert.equal(readFileSync(path, 'utf8'), before[i],
      `${path} is generated: run node scripts-build-deno.mjs and commit the result`);
  });
  assert.equal(before[0], before[1], 'both copies of the server must be the same file');
  // Deno 2 hides Deno.openKv behind a flag; a repository deploy of server/deploy
  // only boots if its deno.json turns KV on.
  const deployConfig = JSON.parse(readFileSync(new URL('../server/deploy/deno.json', import.meta.url), 'utf8'));
  assert.ok((deployConfig.unstable || []).includes('kv'), 'server/deploy/deno.json must enable kv');
});
