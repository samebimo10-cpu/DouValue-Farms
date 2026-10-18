// Who may create a farm on a farm server — NFR-SEC-03, FR-ADV-07, FR-REP-02.
//
// Creating a farm needs no account, and a farm's CEO can spend the server's
// adviser key and message the Owner's WhatsApp. The server's address is in
// every staff sign-in link. So once a server holds a farm, another one needs
// the setup key set on the deployment; the first farm on an empty server
// needs none, which keeps a fresh setup as it always was.
//
// Run against the real node server, twice: once with no key set, once with.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'a-long-operator-setup-key';
const servers = [];

async function startServer(port, env = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'douvalue-setup-'));
  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  const proc = spawn(process.execPath, [entry, '--port', String(port), '--data', dataDir], {
    stdio: 'ignore', env: { ...process.env, FARM_SETUP_KEY: '', ...env },
  });
  servers.push({ proc, dataDir });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/`)).ok) return base; } catch { /* still coming up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('farm server did not start');
}

const post = async (base, path, body, token = null) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const create = (base, farm, extra = {}) => post(base, `/api/farms/${farm}/bootstrap`,
  { name: 'Owner', password: '123456', ...extra });

let open;     // no FARM_SETUP_KEY on the deployment
let keyed;    // FARM_SETUP_KEY set

before(async () => {
  open = await startServer(8801);
  keyed = await startServer(8802, { FARM_SETUP_KEY: KEY });
});

after(() => {
  for (const s of servers) {
    s.proc.kill();
    rmSync(s.dataDir, { recursive: true, force: true });
  }
});

test('the first farm on an empty server needs no key, exactly as before', async () => {
  const first = await create(open, 'farm_first');
  assert.equal(first.status, 200);
  assert.ok(first.body.token);
});

test('with a farm on the server and no key set, nobody can add another', async () => {
  const second = await create(open, 'farm_stranger');
  assert.equal(second.status, 403);
  assert.equal(second.body.reason, 'setup-key');
  assert.match(second.body.error, /sign in with your sign-in name and password/,
    'a CEO on a second phone is pointed at signing in, not at a second empty farm');
  const guessing = await create(open, 'farm_guess', { setupKey: '' });
  assert.equal(guessing.status, 403);
});

test('a refused farm leaves nothing behind that later counts as a farm', async () => {
  // Requests that name a farm id the server has never held (the node store
  // makes a folder for it) do not stop the next check from seeing one farm.
  await fetch(`${open}/api/farms/farm_ghost/me`);
  const again = await create(open, 'farm_stranger2');
  assert.equal(again.status, 403);
  const original = await create(open, 'farm_first');
  assert.equal(original.status, 409, 'the existing farm still cannot be seized');
});

test('with the key set, a new farm needs it: wrong key refused, right key accepted', async () => {
  assert.equal((await create(keyed, 'farm_one')).status, 200, 'the first farm still needs none');
  const none = await create(keyed, 'farm_two');
  assert.equal(none.status, 403);
  assert.match(none.body.error, /setup key/);
  const wrong = await create(keyed, 'farm_two', { setupKey: 'not-the-key' });
  assert.equal(wrong.status, 403);
  const right = await create(keyed, 'farm_two', { setupKey: KEY });
  assert.equal(right.status, 200);
  assert.ok(right.body.token);
});

test('a farm made with the key is a farm like any other, and the farms stay apart', async () => {
  const one = await post(keyed, '/api/farms/farm_iso_a/bootstrap', { name: 'A', password: '123456', setupKey: KEY });
  const two = await post(keyed, '/api/farms/farm_iso_b/bootstrap', { name: 'B', password: '123456', setupKey: KEY });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  const crossing = await fetch(`${keyed}/api/farms/farm_iso_a/events?since=0`,
    { headers: { Authorization: `Bearer ${two.body.token}` } });
  assert.equal(crossing.status, 401, "one farm's token is worthless on another");
});
