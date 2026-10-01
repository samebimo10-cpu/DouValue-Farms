// The farm server enforces what used to be the phone's alone — FR-GATE-01 to
// 05, FR-TREAT-02, FR-PROOF-01/02, FR-STOCK-04/07/08 and the Week 10 organics
// rule — and a refusal says why.
//
// Every test here pushes records the way a phone does, to a farm server held
// in memory, as somebody whose role *may* file that kind of record. The
// question is never "may a supervisor log a spray" — that is roles-sync — but
// "may this spray, on this zone, today, go on the farm". Each refusal is
// checked for the reason and the requirement it names, because the person who
// made the record is now shown both (domain/refusals.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const { reduce } = await import(new URL('store.js', base).href);
const { RULES_VERSION } = await import(new URL('domain/diagnose.js', base).href);
const { harvestCheck } = await import(new URL('domain/onboarding.js', base).href);
const { canAssignBatch, canTreat } = await import(new URL('domain/gates.js', base).href);
const { proofCheck } = await import(new URL('domain/proof.js', base).href);
const { FRESH_PHOTO_MS } = await import(new URL('db.js', base).href);
const { FRESH_PHOTO_MINUTES } = await import(new URL('domain/proof.js', base).href);
const { loadRules, setRules, peekRules } = await import(new URL('rules.js', base).href);
const {
  describeRecord, markRead, noteRefusals, refusalsFor,
} = await import(new URL('domain/refusals.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const { ownerOverrides } = await import(new URL('./helpers/gates-cleared.mjs', import.meta.url).href);

await loadRules();

const PEOPLE = {
  u_owner: { id: 'u_owner', name: 'Owner', role: 'ceo' },
  u_mgr: { id: 'u_mgr', name: 'Ada', role: 'manager' },
  u_sup: { id: 'u_sup', name: 'Tamuno', role: 'supervisor' },
  u_hand: { id: 'u_hand', name: 'Emeka', role: 'hand' },
};

let n = 0;
const ev = (type, by, at, payload) => ({ id: `e${++n}_${type}`, type, by, at, payload });
const at = (day, time = '09:00') => `${day}T${time}:00.000Z`;

/** The farm the server already holds: its people, its zones, a crop. */
function farmLog({ transplant = '2026-08-20' } = {}) {
  return [
    ...Object.values(PEOPLE).map((p) => ev('person.upsert', 'u_owner', at('2026-01-01'), { ...p, active: true })),
    ev('plot.upsert', 'u_owner', at('2026-01-01'), { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }),
    ev('plot.upsert', 'u_owner', at('2026-01-01'), { id: 'gh2', name: 'GH-02', type: 'greenhouse', areaM2: 300 }),
    ev('plot.upsert', 'u_owner', at('2026-01-01'), { id: 'nur', name: 'OF-02', type: 'nursery' }),
    ev('cycle.start', 'u_mgr', at(transplant), { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: transplant, plants: 400 }),
  ];
}

/** A thrips diagnosis on GH-01, raised by the supervisor and confirmed by the manager. */
function diagnosed(day) {
  return [
    ev('diagnosis.record', 'u_sup', at(day, '08:00'), {
      id: `dx_${day}`, cycleId: 'c1', cardId: 'thrips', engine: RULES_VERSION, triageRow: 1,
      problemId: 'thrips', problemName: 'Thrips', date: day, photos: [{ dataUrl: 'data:image/jpeg;base64,xx' }],
      confirmTest: 'Tap test over white paper', confirmResult: 'Thrips on every tap',
      reasoning: 'Silvery scars on the young leaves and thrips in the flowers.',
    }),
    ev('diagnosis.confirm', 'u_mgr', at(day, '08:30'), {
      id: `dx_${day}`, confirmTest: 'Tap test over white paper', confirmResult: 'Thrips on every tap',
    }),
  ];
}

function memoryServer(seed = []) {
  const events = [...seed];
  const members = Object.values(PEOPLE).map((p) => ({ ...p, status: 'active' }));
  const store = {
    async getFarm() { return { id: 'f', name: 'Test farm' }; },
    async listMembers() { return members; },
    async getMember(_f, id) { return members.find((m) => m.id === id) || null; },
    async appendEvents(_f, list) {
      let accepted = 0, skipped = 0;
      for (const e of list) {
        if (events.some((x) => x.id === e.id)) { skipped++; continue; }
        events.push(e); accepted++;
      }
      return { accepted, skipped, cursor: events.length };
    },
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

const spray = (day, extra = {}, time = '16:30') => ev('spray.record', 'u_sup', at(day, time), {
  id: `sp_${day}_${extra.activeId || 'spinosad'}`, cycleId: 'c1', activeId: 'spinosad', productId: 'spinosad',
  productName: 'Spinosad', targetProblem: 'thrips', date: day, ...extra,
});

/** Push one record and return the refusal for it, or null if it went in. */
async function refusalOf(server, who, event) {
  const res = await server.push(who, [event]);
  assert.deepEqual(res.held, [], 'nothing held: the rules are loaded');
  return res.refused.find((r) => r.id === event.id) || null;
}

// --- FR-GATE-01 / 02: planting ------------------------------------------------

async function plantingServer(soil) {
  const log = farmLog();
  // Everything but the soil is overridden by the Owner, so the soil decides.
  const overrides = (await ownerOverrides(log, 'gh2', { today: '2026-09-10', at: at('2026-09-01'), except: ['ph', 'nematode'] }))
    .map((o) => ({ ...o, by: 'u_owner' }));
  const tests = soil ? [ev('soiltest.record', 'u_sup', at('2026-09-05'), {
    id: 'st1', zoneId: 'gh2', date: '2026-09-05', ph: soil.ph, readings: [soil.ph, soil.ph, soil.ph],
    calibrated: true, photo: { dataUrl: 'data:image/jpeg;base64,x' }, nematode: soil.nematode, lab: 'Rivers Soil Lab',
  })] : [];
  return memoryServer([...log, ...overrides, ...tests]);
}
const plant = () => ev('cycle.start', 'u_mgr', at('2026-09-10'), {
  id: 'c2', plotId: 'gh2', cropId: 'bell', transplantDate: '2026-09-10', plants: 400,
});

test('FR-GATE-01: no soil test, or a pH outside 5.5–7.0, and the farm server refuses the planting', async () => {
  const none = await refusalOf(await plantingServer(null), 'u_mgr', plant());
  assert.ok(none, 'refused with no test at all');
  assert.match(none.why, /Planting is blocked on GH-02/);
  assert.match(none.rule, /FR-GATE-01/);

  const acid = await refusalOf(await plantingServer({ ph: 5.0, nematode: 'clean' }), 'u_mgr', plant());
  assert.ok(acid, 'refused at pH 5.0');
  assert.match(acid.why, /Soil pH tested/);
  assert.ok(acid.fix, 'and says what to do');
});

test('FR-GATE-02: a nematode result that is not clean refuses the planting', async () => {
  const dirty = await refusalOf(await plantingServer({ ph: 6.2, nematode: 'root-knot' }), 'u_mgr', plant());
  assert.ok(dirty);
  assert.match(dirty.why, /Nematode clear/);
});

test('FR-GATE-01/02: a clean three-point pH and a clean lab result, and it goes in', async () => {
  const server = await plantingServer({ ph: 6.2, nematode: 'clean' });
  assert.equal(await refusalOf(server, 'u_mgr', plant()), null);
  assert.ok(server.events.some((e) => e.type === 'cycle.start' && e.payload.id === 'c2'), 'stored');
});

// --- FR-GATE-03: bought-in topsoil ---------------------------------------------

test('FR-GATE-03: an untested topsoil batch cannot be assigned to a zone; a clean one can', async () => {
  const server = memoryServer([...farmLog(),
    ev('topsoil.receive', 'u_sup', at('2026-09-01'), { id: 'ts1', supplier: 'Rumuokoro tipper', date: '2026-09-01' })]);
  const untested = await refusalOf(server, 'u_mgr', ev('topsoil.assign', 'u_mgr', at('2026-09-02'), { zoneId: 'gh2', batchId: 'ts1' }));
  assert.ok(untested);
  assert.match(untested.why, /no clean test.*cannot be assigned/);
  assert.equal(untested.rule, 'FR-GATE-03');

  await server.push('u_sup', [ev('soiltest.record', 'u_sup', at('2026-09-04'), {
    id: 'st_ts1', batchId: 'ts1', date: '2026-09-04', nematode: 'clean', lab: 'Rivers Soil Lab' })]);
  assert.equal(await refusalOf(server, 'u_mgr', ev('topsoil.assign', 'u_mgr', at('2026-09-05'), { zoneId: 'gh2', batchId: 'ts1' })), null);
  const nursery = await refusalOf(server, 'u_mgr', ev('topsoil.assign', 'u_mgr', at('2026-09-05'), { zoneId: 'nur', batchId: 'ts1' }));
  assert.match(nursery.why, /nursery/);
});

// --- FR-GATE-04 / 05 and the Week 10 rule: sprays -----------------------------

test('FR-GATE-04: a spray with no confirmed diagnosis behind it is refused', async () => {
  const server = memoryServer(farmLog());
  const r = await refusalOf(server, 'u_sup', spray('2026-09-10'));
  assert.equal(r.rule, 'FR-GATE-04');
  assert.match(r.why, /diagnosed/);
  assert.match(r.fix, /clinic/);
  // An unconfirmed one is not enough either.
  const raisedOnly = memoryServer([...farmLog(), diagnosed('2026-09-09')[0]]);
  assert.match((await refusalOf(raisedOnly, 'u_sup', spray('2026-09-10'))).why, /nobody senior has confirmed it/);
});

test('FR-GATE-04: with a confirmed diagnosis it goes in', async () => {
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09')]);
  assert.equal(await refusalOf(server, 'u_sup', spray('2026-09-10')), null);
});

test('FR-GATE-05: the same resistance group twice in a row is refused, and a group outside the thrips programme too', async () => {
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09')]);
  assert.equal(await refusalOf(server, 'u_sup', spray('2026-09-10')), null, 'first IRAC 5 goes in');
  const again = await refusalOf(server, 'u_sup', spray('2026-09-12', { id: 'sp_again' }));
  assert.equal(again.rule, 'FR-GATE-05');
  assert.match(again.why, /IRAC 5/);
  const pyrethroid = await refusalOf(server, 'u_sup', spray('2026-09-12', { activeId: 'cypermethrin', productId: 'cypermethrin', productName: 'Cypermethrin' }));
  assert.equal(pyrethroid.rule, 'FR-GATE-05');
  assert.match(pyrethroid.why, /thrips programme/);
});

test('Week 10: from Week 10 only the organics go on, and the server says so', async () => {
  // Transplanted ten weeks before the spray.
  const server = memoryServer([...farmLog({ transplant: '2026-06-25' }), ...diagnosed('2026-09-09')]);
  const synthetic = await refusalOf(server, 'u_sup', spray('2026-09-10'));
  assert.match(synthetic.rule, /Week 10/);
  assert.match(synthetic.why, /organics only/);
  assert.equal(await refusalOf(server, 'u_sup', spray('2026-09-10', {
    activeId: 'azadirachtin_neem_oil', productId: 'azadirachtin_neem_oil', productName: 'Neem oil' })), null, 'neem goes on');
});

test('FR-STOCK-08: an active with no schedule rate and no label rate cannot be used', async () => {
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09')]);
  const r = await refusalOf(server, 'u_sup', spray('2026-09-10', { activeId: 'abamectin', productId: 'abamectin', productName: 'Abamectin' }));
  assert.equal(r.rule, 'FR-STOCK-08');
  assert.match(r.why, /no rate/);
  const unnamed = await refusalOf(server, 'u_sup', spray('2026-09-10', { activeId: null, productId: null }));
  assert.equal(unnamed.rule, 'FR-STOCK-05', 'a spray names its active');
});

test('FR-STOCK-04: an active held only in expired containers cannot be chosen for a treatment', async () => {
  const expired = ev('input.upsert', 'u_mgr', at('2026-08-01'), {
    id: 'i_spin', name: 'Spinosad 45SC', activeId: 'spinosad', qty: 2, unit: 'litre', expiry: '2026-09-01' });
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), expired]);
  const r = await refusalOf(server, 'u_sup', spray('2026-09-10'));
  assert.equal(r.rule, 'FR-STOCK-04');
  assert.match(r.why, /past its expiry date/);
  // A fresh container on the shelf beside it, and it goes in.
  await server.push('u_mgr', [ev('input.upsert', 'u_mgr', at('2026-09-09'), {
    id: 'i_spin2', name: 'Spinosad 45SC', activeId: 'spinosad', qty: 1, unit: 'litre', expiry: '2027-09-01' })]);
  assert.equal(await refusalOf(server, 'u_sup', spray('2026-09-10', { id: 'sp_fresh' })), null);
  // The phone asks the same question before the form is saved.
  const state = reduce([...farmLog(), ...diagnosed('2026-09-09'), expired]);
  assert.equal(canTreat(state, 'c1', { today: '2026-09-10', now: at('2026-09-10', '16:00'), activeId: 'spinosad' }).reason, 'expired');
});

// --- FR-STOCK-07 / FR-TREAT-02: the waiting periods ----------------------------

test('FR-STOCK-07: the waiting periods on a spray are the server catalogue\'s, not the phone\'s', async () => {
  const label = (id, phiDays) => ev('label.add', 'u_mgr', at('2026-09-01'), {
    id, brand: `Brand ${id}`, activeIds: ['spinosad'], rate: '0.5 ml/L', phiDays, reiHours: '' });
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), label('long', 21), label('short', 3)]);
  // A record claiming no waiting period gets the catalogue's 14 days.
  await server.push('u_sup', [spray('2026-09-10', { phiDays: 0, reiHours: 0 })]);
  const stored = server.events.find((e) => e.type === 'spray.record');
  assert.equal(stored.payload.phiDays, 14);
  assert.equal(stored.payload.reiHours, 24);
  // A label with a longer PHI lengthens it; one with a shorter PHI does not shorten it.
  const server2 = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), label('long', 21), label('short', 3)]);
  await server2.push('u_sup', [spray('2026-09-10', { labelId: 'long', phiDays: 0 })]);
  assert.equal(server2.events.find((e) => e.type === 'spray.record').payload.phiDays, 21);
  const server3 = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), label('long', 21), label('short', 3)]);
  await server3.push('u_sup', [spray('2026-09-10', { labelId: 'short', phiDays: 3 })]);
  assert.equal(server3.events.find((e) => e.type === 'spray.record').payload.phiDays, 14);
});

test('FR-TREAT-02: no harvest inside the waiting period, read off the catalogue whatever the spray record says', async () => {
  // A spray already on the server that claims no waiting period at all.
  const claimed = { ...spray('2026-09-10', { phiDays: 0, reiHours: 0 }), by: 'u_sup' };
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), claimed]);
  const pick = (day, id) => ev('harvest.record', 'u_hand', at(day, '07:00'), { id, cycleId: 'c1', kg: 12, date: day });
  const early = await refusalOf(server, 'u_hand', pick('2026-09-13', 'h1'));
  assert.equal(early.rule, 'FR-TREAT-02');
  assert.match(early.why, /Do not pick GH-01 yet.*2026-09-24/);
  assert.equal(await refusalOf(server, 'u_hand', pick('2026-09-24', 'h2')), null, 'on the day it clears');
  // A spray logged later does not reach back and refuse an earlier picking.
  const later = memoryServer([...farmLog(), ...diagnosed('2026-09-09'), { ...spray('2026-09-20'), by: 'u_sup' }]);
  assert.equal(await refusalOf(later, 'u_hand', pick('2026-09-18', 'h3')), null);
  // The phone reads the same floor: the record's 0 does not open the bed.
  const state = reduce([...farmLog(), ...diagnosed('2026-09-09'), claimed]);
  assert.equal(harvestCheck(state, 'c1', '2026-09-13T12:00:00').safe, false);
});

// --- FR-PROOF-01 / 02: proof photos --------------------------------------------

const photo = (o = {}) => ({ dataUrl: 'data:image/jpeg;base64,AAAA', takenAt: at('2026-09-10', '09:58'),
  attachedAt: at('2026-09-10', '10:00'), fresh: true, ageMinutes: 2, bytes: 3000, ...o });
const stamp = (o = {}) => ({ takenAt: at('2026-09-10', '09:58'), attachedAt: at('2026-09-10', '10:00'),
  zone: 'GH-01', person: 'Emeka', kind: 'trap', timeVerified: true, ...o });
const trapTask = ev('task.create', 'u_mgr', at('2026-09-10', '05:00'), {
  id: 'gen_2026-09-10_gh1_trap', kind: 'trap', title: 'Check the sticky traps — GH-01', zoneId: 'gh1',
  cycleId: 'c1', due: '2026-09-10T10:00', generated: true, proof: true });
const waterTask = ev('task.create', 'u_mgr', at('2026-09-10', '05:00'), {
  id: 'gen_2026-09-10_gh1_irrigate', kind: 'irrigate', title: 'Water — GH-01', zoneId: 'gh1',
  cycleId: 'c1', due: '2026-09-10T08:00', generated: true });
const complete = (payload) => ev('task.complete', 'u_hand', at('2026-09-10', '10:01'),
  { id: 'gen_2026-09-10_gh1_trap', note: 'traps replaced', ...payload });

test('FR-PROOF-01: a trap check does not close without a photo; watering does', async () => {
  const server = memoryServer([...farmLog(), trapTask, waterTask]);
  const r = await refusalOf(server, 'u_hand', complete({}));
  assert.equal(r.rule, 'FR-PROOF-01');
  assert.match(r.why, /Check the sticky traps — GH-01: A trap check is not done until there is a picture/);
  assert.equal(await refusalOf(server, 'u_hand',
    ev('task.complete', 'u_hand', at('2026-09-10', '08:30'), { id: 'gen_2026-09-10_gh1_irrigate' })), null);
});

test('FR-PROOF-02: a gallery picture is refused — by its flag, its age, or its own two times', async () => {
  const server = memoryServer([...farmLog(), trapTask]);
  for (const [what, p] of [
    ['flagged from the gallery', photo({ fresh: false, ageMinutes: 300 })],
    ['older than five minutes', photo({ fresh: null, ageMinutes: 45 })],
    ['taken an hour before it was attached', photo({ fresh: null, ageMinutes: null, takenAt: at('2026-09-10', '09:00') })],
  ]) {
    const r = await refusalOf(server, 'u_hand', complete({ photo: p, stamp: stamp() }));
    assert.ok(r, what);
    assert.match(r.rule, /FR-PROOF-0[12]/, what);
  }
  assert.equal(FRESH_PHOTO_MS, FRESH_PHOTO_MINUTES * 60000, 'one meaning of "taken now" on the phone and the server');
});

test('FR-PROOF-02: the photo is stamped with date, time, zone and person; and FR-PROOF-03 a wrong door is refused', async () => {
  const server = memoryServer([...farmLog(), trapTask]);
  assert.match((await refusalOf(server, 'u_hand', complete({ photo: photo() }))).why, /not stamped/);
  assert.match((await refusalOf(server, 'u_hand', complete({ photo: photo(), stamp: stamp({ zone: null }) }))).why, /not stamped/);
  const wrongDoor = await refusalOf(server, 'u_hand', complete({ photo: photo(), stamp: stamp(),
    zoneCheck: { zoneId: 'gh2', zoneName: 'GH-02', method: 'qr' } }));
  assert.equal(wrongDoor.rule, 'FR-PROOF-03');
  assert.equal(await refusalOf(server, 'u_hand', complete({ photo: photo(), stamp: stamp(),
    zoneCheck: { zoneId: 'gh1', zoneName: 'GH-01', method: 'qr' } })), null, 'and the real thing closes it');
});

test('the phone\'s own completion passes the server\'s proof check', () => {
  // The shape saveProof and the trap count build (worker.js): photoPayload + stampFor.
  const task = { ...trapTask.payload };
  assert.deepEqual(proofCheck(task, { photo: photo(), stamp: stamp(), zoneCheck: null, note: '' }), { ok: true, unverifiedTime: false });
  assert.equal(proofCheck({ ...task, kind: 'nursery_trap' }, { photo: null }).ok, false);
});

// --- Held, repeats, and what a refusal says ------------------------------------

test('no rule book: the gated records are held — not stored, not refused — and go in once it is back', async () => {
  const doc = peekRules();
  setRules(null);
  core.configureRules({ loader: async () => null, retryMs: 0 });
  try {
    const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09')]);
    const note = ev('work.log', 'u_sup', at('2026-09-10'), { id: 'w1', activity: 'weeding', hours: 2 });
    const res = await server.push('u_sup', [spray('2026-09-10'), note]);
    assert.equal(res.held.length, 1);
    assert.match(res.held[0].why, /rule book/);
    assert.deepEqual(res.refused, []);
    assert.equal(res.accepted, 1, 'everything else still goes in');
    core.configureRules({ loader: async () => doc, retryMs: 0 });
    const again = await server.push('u_sup', [spray('2026-09-10')]);
    assert.deepEqual(again.held, []);
    assert.equal(again.accepted, 1);
  } finally {
    if (!peekRules()) setRules(doc);
    core.configureRules({ loader: null, retryMs: 60000 });
  }
});

test('a record already on the server is skipped on a repeat send, not judged again', async () => {
  const server = memoryServer([...farmLog(), ...diagnosed('2026-09-09')]);
  const first = spray('2026-09-10');
  assert.equal((await server.push('u_sup', [first])).accepted, 1);
  // The phone never heard back and sends it again. Judged now it would break
  // the rotation against itself; it is a repeat, and is skipped.
  const res = await server.push('u_sup', [first]);
  assert.deepEqual(res.refused, []);
  assert.equal(res.skipped, 1);
});

test('every refusal says which record, what kind, why, what to do and the rule', async () => {
  const server = memoryServer(farmLog());
  const res = await server.push('u_sup', [spray('2026-09-10')]);
  const [r] = res.refused;
  assert.deepEqual(Object.keys(r).sort(), ['fix', 'id', 'rule', 'type', 'why']);
  assert.equal(r.type, 'spray.record');
});

// --- On the phone: told, not dropped -------------------------------------------

test('the phone keeps a refusal with what the record was, and shows it to whoever made it', () => {
  const state = reduce(farmLog());
  const sent = [spray('2026-09-10'), ev('harvest.record', 'u_hand', at('2026-09-11'), { id: 'h9', cycleId: 'c1', kg: 24, date: '2026-09-11' })];
  const kept = noteRefusals([], [
    { id: sent[0].id, type: 'spray.record', why: 'Nothing has been diagnosed on this zone in the last two weeks.', fix: 'Run the clinic first.', rule: 'FR-GATE-04' },
    { id: sent[1].id, why: 'Do not pick GH-01 yet.' },
  ], sent, { state, now: '2026-09-11T10:00:00.000Z' });
  assert.equal(kept.length, 2);
  const spr = kept.find((r) => r.id === sent[0].id);
  assert.equal(spr.what, 'Spray of Spinosad on GH-01');
  assert.equal(spr.day, '2026-09-10');
  assert.equal(spr.by, 'u_sup');
  assert.equal(spr.rule, 'FR-GATE-04');
  assert.equal(kept.find((r) => r.id === sent[1].id).what, 'Harvest of 24 kg from GH-01');

  // The hand sees their own; the supervisor who runs the work sees both.
  assert.deepEqual(refusalsFor(kept, PEOPLE.u_hand).map((r) => r.id), [sent[1].id]);
  assert.equal(refusalsFor(kept, PEOPLE.u_sup, { seesAll: true }).length, 2);
  const read = markRead(kept, [sent[1].id]);
  assert.equal(refusalsFor(read, PEOPLE.u_hand).length, 0, 'read, and the bar goes back to normal');
  assert.equal(describeRecord(ev('topsoil.assign', 'u_mgr', at('2026-09-01'), { zoneId: 'gh2' }), state), 'Topsoil put into GH-02');
});

test('sync no longer drops a refusal with a console warning, and leaves held records queued', () => {
  const sync = readFileSync(new URL('../web/js/sync.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sync, /console\.warn\('The server would not accept/);
  assert.match(sync, /noteRefusals\(refusals, result\.refused, batch/);
  assert.match(sync, /markSynced\(batch\.map\(\(e\) => e\.id\)\.filter\(\(id\) => !heldIds\.has\(id\)\)\)/);
  const shell = readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /data-act="open-refused" role="alert"/);
});

// --- The phone's own checks, which the server mirrors ----------------------------

test('FR-GATE-03 on the phone: a delivery records the zone it is for, and goes in only once tested', () => {
  const gatesUi = readFileSync(new URL('../web/js/ui/gates.js', import.meta.url), 'utf8');
  assert.doesNotMatch(gatesUi, /if \(data\.zoneId\) await ctx\.store\.dispatch\('topsoil\.assign'/);
  assert.match(gatesUi, /forZoneId: data\.zoneId \|\| null/);
  const state = reduce([...farmLog(), ev('topsoil.receive', 'u_sup', at('2026-09-01'), { id: 'ts1', supplier: 'X', date: '2026-09-01' })]);
  assert.equal(canAssignBatch(state, 'ts1', 'gh2').ok, false);
});
