// Phase 1b — shared-phone security and "did it send?".
//
// NFR-SEC-02: five wrong PINs lock the pad for 15 minutes, on the phone as on
// the server. NFR-SEC-06: ten idle minutes and the phone asks again. A
// connected phone's PIN digest is slow and salted, and an old one is upgraded
// on the next right PIN. A person sees whether their own records have reached
// the farm; the Owner sees which phones have gone quiet.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const unlock = await import('../web/js/domain/unlock.js');
const { hashPin } = await import('../web/js/ui/shell.js');
const { myRecordsLine } = await import('../web/js/sync.js');
const { dataHealthCard } = await import('../web/js/ui/manage.js');

const T = Date.parse('2026-10-18T08:00:00Z');

// --- The PIN pad -------------------------------------------------------------

test('five wrong PINs lock the pad for 15 minutes; it opens again after', () => {
  let rec = null;
  for (let i = 1; i <= 4; i++) {
    rec = unlock.afterWrongPin(rec, T + i);
    assert.equal(unlock.padState(rec, T + i).locked, false, `try ${i}`);
  }
  assert.equal(unlock.padState(rec, T).left, 1);
  assert.match(unlock.padMessage(unlock.padState(rec, T)), /1 try left/);
  rec = unlock.afterWrongPin(rec, T + 5);
  const locked = unlock.padState(rec, T + 6);
  assert.equal(locked.locked, true);
  assert.match(unlock.padMessage(locked), /Wait 15 minutes/);
  assert.equal(unlock.padState(rec, T + 5 + 14 * 60000).locked, true, 'still locked at 14 minutes');
  const later = unlock.padState(rec, T + 5 + 15 * 60000);
  assert.equal(later.locked, false);
  assert.equal(later.left, 5, 'a fresh five after the lock');
});

test('a wrong PIN while locked does not extend or reset the lock', () => {
  let rec = { fails: 0, lockedUntil: T + 60000 };
  rec = unlock.afterWrongPin(rec, T);
  assert.equal(rec.lockedUntil, T + 60000);
});

test('the PIN pad checks the lock before the PIN, and counts every wrong one, connected or not', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8');
  const start = src.indexOf("'pin-ok': async");
  const body = src.slice(start, src.indexOf("'device-signout': async", start));
  assert.ok(body.indexOf('if (st.locked)') < body.indexOf('checkDevicePin'), 'locked is answered before any PIN is tried');
  assert.equal((body.match(/await wrong\(/g) || []).length, 2, 'both the connected and the shared-phone path count a wrong PIN');
  assert.ok(body.includes('setMeta(PIN_TRIES_KEY'), 'kept in the phone\'s storage, so reopening the app does not reset it');
});

test('a connected phone keeps a slow, salted digest of the PIN, never the quick one', async () => {
  const a = await unlock.devicePinDigest('482913', 'person_x', { rounds: 1000 });
  const b = await unlock.devicePinDigest('482913', 'person_x', { rounds: 1000 });
  assert.match(a, /^pbkdf2\$1000\$person_x:[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b, 'salted: the same PIN never gives the same digest');
  assert.equal((await unlock.checkDevicePin('482913', 'person_x', a, hashPin)).ok, true);
  assert.equal((await unlock.checkDevicePin('482914', 'person_x', a, hashPin)).ok, false);
  const src = (await import('node:fs')).readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8')
    + (await import('node:fs')).readFileSync(new URL('../web/js/ui/manage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /setMeta\('devicePin', await hashPin/, 'nothing stores the quick digest any more');
});

test('a phone with the old quick digest is upgraded on the next right PIN, and only then', async () => {
  const old = await hashPin('1357', 'person_y');
  const wrong = await unlock.checkDevicePin('9999', 'person_y', old, hashPin);
  assert.deepEqual(wrong, { ok: false, upgrade: null });
  const right = await unlock.checkDevicePin('1357', 'person_y', old, hashPin);
  assert.equal(right.ok, true);
  assert.match(right.upgrade, /^pbkdf2\$/);
  assert.equal((await unlock.checkDevicePin('1357', 'person_y', right.upgrade, hashPin)).ok, true, 'the new digest works');
  assert.equal((await unlock.checkDevicePin('1357', 'person_y', null, hashPin)).ok, false, 'no digest, no entry');
});

// --- Idle sign-out --------------------------------------------------------------

test('ten idle minutes sign a phone out; nine do not; an unknown last tap does not', () => {
  assert.equal(unlock.idleExpired(T, T + 9 * 60000), false);
  assert.equal(unlock.idleExpired(T, T + 10 * 60000), true);
  assert.equal(unlock.idleExpired(NaN, T), false);
});

test('the tap that wakes an idle phone only signs it out, and never presses the button under it', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8');
  const watch = src.slice(src.indexOf('function watchIdle'), src.indexOf('export async function startShell'));
  assert.match(watch, /if \(signOutIfIdle\(store\)\) \{ swallowClick = true; e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \}/);
  assert.match(watch, /addEventListener\('click', \(e\) => \{\s*if \(!swallowClick\) return;/);
  assert.match(watch, /visibilitychange/, 'checked when the app comes back to the front');
  assert.match(src, /if \(savedUser && idleExpired\(lastActive\(\)\)\) sessionStorage\.removeItem\('douvalue\.user'\)/,
    'a reopened tab after ten minutes asks again');
});

// --- "Has my report been saved and sent?" ------------------------------------------

test('a person sees their own records as saved, waiting, sent or refused, in words', () => {
  const base = { configured: true, state: 'idle', pendingBy: { me: 0, other: 9 } };
  assert.match(myRecordsLine(base, 'me').text, /Everything you recorded has reached the farm/);
  assert.equal(myRecordsLine(base, 'me').tone, 'ok', "somebody else's waiting records are not this person's");
  const waiting = myRecordsLine({ ...base, state: 'offline', pendingBy: { me: 3 } }, 'me');
  assert.match(waiting.text, /3 of your records saved on this phone, waiting for signal/);
  assert.equal(waiting.tone, 'warn');
  assert.match(myRecordsLine({ ...base, pendingBy: { me: 1 } }, 'me').text, /1 of your record saved on this phone, sending now|1 of your records? saved/);
  const refused = myRecordsLine(base, 'me', 2);
  assert.match(refused.text, /2 of your records were refused/);
  assert.equal(refused.tone, 'danger');
  assert.match(myRecordsLine({ configured: false }, 'me').text, /This farm has no server/);
});

// --- The Owner's view of the phones ------------------------------------------------

test('the Owner\'s card names the phones gone quiet and the refused records, and says what to do', () => {
  const html = dataHealthCard({ ok: true, devices: [
    { name: 'Emeka', device: 'Android phone ab12', quietHours: 50 },
    { name: 'Ada', device: 'iPhone 9f3c', quietHours: 0 },
  ] }, { refused: 2 });
  assert.match(html, /1 phone has not reached the farm server for a day or more/);
  assert.match(html, /exists only on that phone/);
  assert.match(html, /2 records refused by the farm server/);
  assert.match(html, /Emeka.*Android phone ab12.*2 days ago/s);
  assert.match(dataHealthCard({ ok: true, devices: [{ name: 'Ada', device: 'x', quietHours: 3 }] }), /Every signed-in phone has reached/);
  assert.match(dataHealthCard(null), /could not be reached just now/);
});

const PORT = 8803;
const SERVER = `http://127.0.0.1:${PORT}`;
let proc; let dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'douvalue-1b-'));
  proc = spawn(process.execPath, [new URL('../server/node-sync.mjs', import.meta.url).pathname, '--port', String(PORT), '--data', dir],
    { stdio: 'ignore', env: { ...process.env, FARM_SETUP_KEY: '' } });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${SERVER}/`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(() => { if (proc) proc.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); });

const call = async (path, { token, body } = {}) => {
  const res = await fetch(`${SERVER}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('the farm server lists the phones for the Owner only, with no token or digest in it', async () => {
  const ceo = (await call('/api/farms/farm_1b/bootstrap', { body: { name: 'Owner', password: '842113', device: 'Owner laptop' } })).body.token;
  await call('/api/farms/farm_1b/account', { token: ceo, body: { name: 'Ada', role: 'manager', login: 'ada1b', password: '551234' } });
  const ada = (await call('/api/signin', { body: { login: 'ada1b', password: '551234', device: 'Android phone ab12' } })).body.token;

  assert.equal((await call('/api/farms/farm_1b/devices', { token: ada })).status, 403, 'not the Farm Manager');
  const seen = await call('/api/farms/farm_1b/devices', { token: ceo });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.devices.map((d) => d.device).sort(), ['Android phone ab12', 'Owner laptop']);
  assert.ok(seen.body.devices.every((d) => d.quietHours === 0));
  const text = JSON.stringify(seen.body);
  assert.doesNotMatch(text, /digest|token|passHash|passSalt/);
});
