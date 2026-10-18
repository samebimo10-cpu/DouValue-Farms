// The generated Deno server runs, and judges the gates with the app's code.
//
// server/deno-sync.ts is one file: core.mjs plus every app module the farm
// server judges records with (server/judge.mjs), bundled by
// scripts-build-deno.mjs. A bundling mistake would not show in any other test —
// they all import the modules directly — so this one loads the generated file
// itself, in Node, with a stand-in for Deno's KV and serve, laid out the way a
// repository deploy is (rules/ one level up), and pushes records through it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/**
 * Just enough of Deno KV for the adapter: get, set, delete, list, atomic.
 *
 * With Deno KV's own value limit: a value of 64 KiB or more is refused with
 * the error Deno throws. Without it this stand-in stored records a real
 * server cannot, and a photo-sized record crashing every push went unseen.
 * `busy` makes the next commits lose their race, as with other phones pushing.
 */
const KV_VALUE_MAX = 65536;
const kvBytes = (value) => (value instanceof Uint8Array ? value.byteLength
  : new TextEncoder().encode(JSON.stringify(value)).length);
function tooLarge(value) {
  if (kvBytes(value) >= KV_VALUE_MAX) throw new TypeError(`Value too large (max ${KV_VALUE_MAX} bytes)`);
}
let theKv = null;
const SETUP_KEY = 'operator-setup-key';
function memoryKv() {
  const data = new Map();
  let stamp = 0;
  const id = (key) => JSON.stringify(key);
  const cmp = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      return typeof a[i] === 'number' && typeof b[i] === 'number' ? a[i] - b[i] : String(a[i]) < String(b[i]) ? -1 : 1;
    }
    return a.length - b.length;
  };
  const kv = {
    async get(key) {
      const hit = data.get(id(key));
      return hit ? { key, value: hit.value, versionstamp: hit.stamp } : { key, value: null, versionstamp: null };
    },
    busy: 0,
    async set(key, value) { tooLarge(value); data.set(id(key), { key, value, stamp: String(++stamp) }); return { ok: true }; },
    async delete(key) { data.delete(id(key)); },
    async *list(sel, { limit = Infinity } = {}) {
      const rows = [...data.values()].filter(({ key }) => (sel.prefix
        ? sel.prefix.every((p, i) => key[i] === p)
        : cmp(key, sel.start) >= 0 && cmp(key, sel.end) < 0)).sort((a, b) => cmp(a.key, b.key));
      for (const row of rows.slice(0, limit)) yield { key: row.key, value: row.value, versionstamp: row.stamp };
    },
    atomic() {
      const checks = [];
      const sets = [];
      const op = {
        check(c) { checks.push(c); return op; },
        set(key, value) { sets.push([key, value]); return op; },
        async commit() {
          for (const [, value] of sets) tooLarge(value);
          if (kv.busy > 0) { kv.busy--; return { ok: false }; }
          for (const c of checks) {
            const hit = data.get(id(c.key));
            if ((hit ? hit.stamp : null) !== c.versionstamp) return { ok: false };
          }
          for (const [key, value] of sets) await kv.set(key, value);
          return { ok: true };
        },
      };
      return op;
    },
  };
  theKv = kv;
  return kv;
}

let dir;
let handler;

before(async () => {
  // The repository layout: server/deno-sync.* with rules/ beside server/.
  dir = mkdtempSync(join(tmpdir(), 'douvalue-deno-'));
  mkdirSync(join(dir, 'server'));
  symlinkSync(new URL('rules', ROOT).pathname, join(dir, 'rules'));
  const file = join(dir, 'server', 'deno-sync.mjs');
  writeFileSync(file, readFileSync(new URL('server/deno-sync.ts', ROOT), 'utf8'));
  globalThis.Deno = {
    openKv: async () => memoryKv(),
    serve: (fn) => { handler = fn; },
    // A server holding several farms, as an operator's would: new ones need the key.
    env: { get: (name) => (name === 'FARM_SETUP_KEY' ? SETUP_KEY : undefined) },
  };
  await import(pathToFileURL(file).href);
});

after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); delete globalThis.Deno; });

async function call(path, { method = 'GET', token = null, body = null } = {}) {
  const res = await handler(new Request(`http://farm.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('the bundled server boots, answers, and holds its rules', async () => {
  assert.equal(typeof handler, 'function', 'Deno.serve was given a handler');
  const res = await handler(new Request('http://farm.test/'));
  assert.match(await res.text(), /DouValue farm server is running/);
});

test('the bundled server judges a planting, a spray and a harvest with the app\'s gates', async () => {
  const boot = await call('/api/farms/f1/bootstrap', { method: 'POST', body: { name: 'Owner', password: '123456' } });
  assert.equal(boot.status, 200);
  const token = boot.body.token;
  const at = (d) => `${d}T08:00:00.000Z`;
  const events = [
    { id: 'p1', type: 'plot.upsert', at: at('2026-05-01'), payload: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 } },
    // FR-GATE-01/02: no soil test, no planting.
    { id: 'c1', type: 'cycle.start', at: at('2026-05-02'),
      payload: { id: 'cy1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-05-02' } },
    // FR-GATE-04: no diagnosis, no spray.
    { id: 's1', type: 'spray.record', at: at('2026-05-03'),
      payload: { id: 'sp1', cycleId: 'cy1', activeId: 'spinosad', date: '2026-05-03' } },
  ];
  const res = await call('/api/farms/f1/events', { method: 'POST', token, body: { events } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.held, [], 'the rules were found beside the file');
  const why = Object.fromEntries(res.body.refused.map((r) => [r.id, r]));
  assert.match(why.c1.why, /Planting is blocked on GH-01/);
  assert.match(why.c1.rule, /FR-GATE-01/);
  assert.match(why.s1.why, /diagnosed/);
  assert.equal(why.s1.rule, 'FR-GATE-04');
  assert.equal(res.body.accepted, 1, 'the zone itself went in');
});

// NFR-OFF-02, NFR-OFF-06 — a record with a photo is bigger than one Deno KV
// value. It used to throw inside the push, so the whole batch came back as a
// 500 and the phone sent the same batch for ever: nothing from that phone
// reached the farm again.
const photo = (kb) => `data:image/jpeg;base64,${'QUJD'.repeat(kb * 256)}`;
const report = (id, extra = {}) => ({ id, type: 'report.record', at: '2026-05-04T08:00:00.000Z',
  payload: { id: `r_${id}`, note: 'leaf spots on the lower leaves', ...extra } });

test('a photo-sized record is stored on Deno KV and pulled back exactly as it was sent', async () => {
  const boot = await call('/api/farms/f_photo/bootstrap', { method: 'POST', body: { name: 'Owner', password: '123456', setupKey: SETUP_KEY } });
  const token = boot.body.token;
  const sent = [
    report('small'),
    report('photo', { photos: [{ dataUrl: photo(120) }] }),
    report('words', { note: 'Ọ̀gá — “pidgin” 🌶️ '.repeat(4000) }),
    report('after'),
  ];
  const res = await call('/api/farms/f_photo/events', { method: 'POST', token, body: { events: sent } });
  assert.equal(res.status, 200, 'a big record no longer fails the push');
  assert.equal(res.body.accepted, 4);
  assert.deepEqual(res.body.refused, []);
  assert.deepEqual(res.body.held, []);

  const pulled = await call('/api/farms/f_photo/events?since=0', { token });
  for (const s of sent) {
    const got = pulled.body.events.find((e) => e.id === s.id);
    assert.ok(got, `${s.id} came back`);
    assert.deepEqual(got.payload, s.payload, `${s.id} came back byte for byte`);
  }

  // A repeat send is skipped, and cannot replace what the first one stored.
  const again = await call('/api/farms/f_photo/events', { method: 'POST', token,
    body: { events: [{ ...sent[1], payload: { ...sent[1].payload, note: 'swapped' } }] } });
  assert.equal(again.body.skipped, 1);
  const after = await call('/api/farms/f_photo/events?since=0', { token });
  assert.equal(after.body.events.find((e) => e.id === 'photo').payload.note, 'leaf spots on the lower leaves');
});

test('a record too large to keep is refused on its own; the rest of the batch goes in', async () => {
  const boot = await call('/api/farms/f_huge/bootstrap', { method: 'POST', body: { name: 'Owner', password: '123456', setupKey: SETUP_KEY } });
  const token = boot.body.token;
  const res = await call('/api/farms/f_huge/events', { method: 'POST', token,
    body: { events: [report('before'), report('huge', { photos: [{ dataUrl: photo(4500) }] }), report('next')] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.accepted, 2);
  assert.deepEqual(res.body.refused.map((r) => r.id), ['huge']);
  assert.match(res.body.refused[0].why, /larger than the farm server keeps/);
});

test('a record that loses every race is held for the phone to send again, never counted as sent', async () => {
  const boot = await call('/api/farms/f_busy/bootstrap', { method: 'POST', body: { name: 'Owner', password: '123456', setupKey: SETUP_KEY } });
  const token = boot.body.token;
  theKv.busy = 5;
  const res = await call('/api/farms/f_busy/events', { method: 'POST', token, body: { events: [report('raced'), report('calm')] } });
  theKv.busy = 0;
  assert.equal(res.status, 200);
  assert.equal(res.body.skipped, 0, 'not reported as already held — the phone would mark it sent');
  assert.deepEqual(res.body.held.map((h) => h.id), ['raced']);
  assert.equal(res.body.accepted, 1);
  const retry = await call('/api/farms/f_busy/events', { method: 'POST', token, body: { events: [report('raced')] } });
  assert.equal(retry.body.accepted, 1, 'sent again, it goes in');
});
