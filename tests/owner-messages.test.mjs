// The Owner's messages — FR-REP-02 (D-1: WhatsApp, text first, email copy
// optional) and FR-REP-06 (straight-to-Owner items go as they happen).
//
// Two halves. The phones decide what to say and when (domain/notify.js); the
// farm server holds the keys and sends each message once (server/core.mjs).
// WhatsApp and email are stubbed here: the test is what the server asks them
// to do, and what it does when they say no.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const RULES = JSON.parse(readFileSync(
  new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8',
));
(await import(new URL('rules.js', base).href)).setRules(RULES);

const store = await import(new URL('store.js', base).href);
const notify = await import(new URL('domain/notify.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const DAY = '2026-09-30';
const at = (hhmm, day = DAY) => `${day}T${hhmm}:00.000Z`;
const ev = (id, type, by, payload, when) => ({ id, type, by, at: when, payload });

const farm = (...more) => store.reduce([
  ev('p1', 'settings.update', 'u_owner', { farmName: 'DouValue Farms' }, at('05:00')),
  ev('z1', 'plot.upsert', 'u_owner', { id: 'gh1', name: 'GH-01' }, at('05:00')),
  ev('c1', 'cycle.start', 'u_owner', { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-10' }, at('05:00')),
  ...more,
]);
const virus = (when, id = 'dxv') => ev(`d_${id}`, 'diagnosis.record', 'u_hand',
  { id, cycleId: 'c1', date: when.slice(0, 10), problemId: 'tospovirus', problemName: 'Tospovirus (TSWV)' }, when);

// --- What the phones offer ----------------------------------------------------

test('FR-REP-06: a straight-to-Owner item is offered the moment a phone has it, by any role', () => {
  const state = farm(virus(at('10:00')));
  const offered = notify.ownerMessages(state, { now: at('10:05'), role: 'hand' });
  const item = offered.find((m) => m.key === 'now:virus:dxv');
  assert.ok(item, 'a hand\'s phone raises the alarm too');
  assert.equal(item.kind, 'immediate');
  assert.match(item.text, /^DouValue Farms — straight to you\n!! VIRUS SUSPECTED/);
  assert.ok(!offered.some((m) => m.kind === 'digest'), 'but a hand\'s phone does not send the digest');

  // Same record, same key, on any phone at any time: the server sends it once.
  assert.equal(notify.ownerMessages(state, { now: at('11:00'), role: 'manager' })
    .find((m) => m.kind === 'immediate').key, 'now:virus:dxv');
});

test('FR-REP-06: history is not replayed as alarms; older items are the digest\'s', () => {
  const state = farm(virus(at('10:00', '2026-09-27')));
  assert.equal(notify.ownerMessages(state, { now: at('10:05'), role: 'manager' })
    .filter((m) => m.kind === 'immediate').length, 0);
});

test('FR-REP-02: the digest is offered once a day from 7 AM farm time, by a phone that runs the work', () => {
  // Nothing planted, nothing wrong: the one-line digest.
  const state = store.reduce([ev('p1', 'settings.update', 'u_owner', { farmName: 'DouValue Farms' }, at('05:00'))]);
  assert.equal(notify.ownerMessages(state, { now: at('05:59'), role: 'manager' }).length, 0, '6:59 AM WAT');
  const [digest] = notify.ownerMessages(state, { now: at('06:00'), role: 'supervisor' });
  assert.equal(digest.key, `digest:${DAY}`);
  assert.equal(digest.kind, 'digest');
  assert.match(digest.text, /Nothing needs you today/, 'exceptions only (FR-REP-01)');
  assert.ok(new TextEncoder().encode(digest.text).length < 1000, 'text first: a few hundred bytes');

  // A farm with something wrong says what, and still fits in one message.
  const [busy] = notify.ownerMessages(farm(), { now: at('06:00'), role: 'manager' });
  assert.match(busy.text, /1 thing needs you today/);
  assert.ok(busy.text.length <= notify.MAX_MESSAGE_CHARS);
});

// --- What the server does with them ---------------------------------------------

const ENV = {
  WHATSAPP_TOKEN: 'wa-secret-token',
  WHATSAPP_PHONE_NUMBER_ID: '1122334455',
  OWNER_WHATSAPP: '+234 803 000 0000',
};
const envOf = (vars) => (name) => vars[name] || '';

/** A farm record in memory, like the Deno KV and file adapters. */
const farmStore = () => {
  let farm = { id: 'f1', name: 'DouValue Farms' };
  return { async getFarm() { return farm; }, async setFarm(_, next) { farm = next; }, peek: () => farm };
};

/** A stand-in for WhatsApp and Resend that records every request. */
const fakeNet = (reply = () => ({ ok: true, body: { messages: [{ id: 'wamid.1' }] } })) => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    const call = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    calls.push(call);
    const r = reply(call, calls.length);
    return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => r.body || {} };
  };
  return { calls, fetchFn };
};

const MANAGER = { id: 'u_mgr', role: 'manager' };
const HAND = { id: 'u_hand', role: 'hand' };
const digestItem = { key: `digest:${DAY}`, kind: 'digest', text: 'DouValue Farms — 30 Sep\nNothing needs you today.' };
const virusItem = { key: 'now:virus:dxv', kind: 'immediate', text: 'DouValue Farms — straight to you\n!! VIRUS SUSPECTED on GH-01\n   Isolate those plants.' };

const send = (items, { me = MANAGER, env = ENV, net = fakeNet(), s = farmStore() } = {}) => core
  .notifyOwner('f1', { items }, me, s, { env: envOf(env), fetchFn: net.fetchFn, now: at('06:30') });

test('FR-REP-02: WhatsApp, text first — the whole message as the Owner reads it', async () => {
  const net = fakeNet();
  const reply = await send([digestItem], { net });
  assert.deepEqual(reply.results, [{ key: digestItem.key, status: 'sent', via: ['text'] }]);
  assert.equal(net.calls.length, 1);
  const [call] = net.calls;
  assert.equal(call.url, 'https://graph.facebook.com/v22.0/1122334455/messages');
  assert.equal(call.headers.Authorization, 'Bearer wa-secret-token');
  assert.deepEqual(call.body, {
    messaging_product: 'whatsapp', to: '2348030000000', type: 'text',
    text: { body: digestItem.text, preview_url: false },
  });
  assert.ok(!JSON.stringify(reply).includes('wa-secret-token'), 'the key never leaves the server');
});

test('FR-REP-02: the same message is never sent twice, whichever phone offers it', async () => {
  const net = fakeNet();
  const s = farmStore();
  await send([virusItem], { net, s });
  const again = await send([virusItem], { net, s, me: HAND });
  assert.equal(again.results[0].status, 'already-sent');
  assert.equal(net.calls.length, 1);
});

test('FR-REP-02: outside WhatsApp\'s 24-hour window it falls back to the approved template, same words', async () => {
  const net = fakeNet((call, n) => (n === 1
    ? { ok: false, body: { error: { code: 131047, message: 'Re-engagement message' } } }
    : { ok: true }));
  const reply = await send([virusItem], { net, env: { ...ENV, WHATSAPP_TEMPLATE: 'farm_alert' } });
  assert.deepEqual(reply.results[0].via, ['template']);
  const template = net.calls[1].body.template;
  assert.equal(template.name, 'farm_alert');
  assert.equal(template.language.code, 'en');
  const param = template.components[0].parameters[0].text;
  assert.ok(!/\n/.test(param) && !/ {2,}/.test(param), 'a template variable holds no line breaks or runs of spaces');
  assert.match(param, /VIRUS SUSPECTED on GH-01 · Isolate those plants/);
});

test('FR-REP-02: a message that did not get through is not marked sent, so the retry goes', async () => {
  const s = farmStore();
  const refusing = fakeNet(() => ({ ok: false, body: { error: { code: 131047, message: 'Re-engagement message' } } }));
  const first = await send([virusItem], { net: refusing, s });
  assert.equal(first.results[0].status, 'failed', 'no template set, so WhatsApp\'s refusal stands');
  assert.match(first.results[0].why, /Re-engagement/);

  const working = fakeNet();
  const retry = await send([virusItem], { net: working, s });
  assert.equal(retry.results[0].status, 'sent');
});

test('FR-REP-02: the email copy is optional, and each channel is owed separately', async () => {
  const env = { ...ENV, RESEND_API_KEY: 're_secret', OWNER_EMAIL: 'owner@example.com', EMAIL_FROM: 'farm@example.com' };
  const s = farmStore();
  // WhatsApp down, email up.
  const net = fakeNet((call) => (call.url.includes('graph.facebook.com') ? { ok: false, body: { error: { code: 1 } } } : { ok: true }));
  const first = await send([virusItem], { net, s, env });
  assert.equal(first.results[0].status, 'partly-sent');
  const mail = net.calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['owner@example.com']);
  assert.equal(mail.body.subject, 'DouValue Farms — straight to you: !! VIRUS SUSPECTED on GH-01');
  assert.equal(mail.body.text, virusItem.text);

  // The retry owes WhatsApp only; the Owner does not get the email twice.
  const net2 = fakeNet();
  const second = await send([virusItem], { net: net2, s, env });
  assert.equal(second.results[0].status, 'sent');
  assert.deepEqual(net2.calls.map((c) => new URL(c.url).host), ['graph.facebook.com']);
});

test('FR-REP-02: who may send what, and what is not a message', async () => {
  const reply = await send([
    digestItem,                                                         // a hand does not send the digest
    virusItem,                                                          // but does raise the alarm
    { key: 'hello', kind: 'immediate', text: 'hi' },                    // not a key this server sends
    { key: 'now:x:1', kind: 'digest', text: 'mislabelled' },           // kind must match the key
    { key: 'now:x:2', kind: 'immediate', text: 'x'.repeat(4097) },      // WhatsApp's ceiling
  ], { me: HAND });
  assert.deepEqual(reply.results.map((r) => r.status), ['refused', 'sent', 'refused', 'refused', 'refused']);
});

test('FR-REP-02: with no channel set up the server says so, and the phone keeps the copy button', async () => {
  const net = fakeNet();
  const reply = await send([digestItem], { net, env: {} });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'not-configured');
  assert.equal(net.calls.length, 0);
  assert.deepEqual(reply.configured, { whatsapp: false, email: false });
});

test('FR-REP-02: a day\'s sending is bounded, so a bad actor cannot flood the Owner', async () => {
  const s = farmStore();
  const net = fakeNet();
  const items = Array.from({ length: 20 }, (_, i) => ({ key: `now:test:${i}`, kind: 'immediate', text: `item ${i}` }));
  for (let round = 0; round < 4; round++) {
    await send(items.map((it) => ({ ...it, key: `${it.key}_${round}` })), { net, s });
  }
  assert.equal(net.calls.length, 60);
  assert.equal(s.peek().notifyDay.count, 60);
});
