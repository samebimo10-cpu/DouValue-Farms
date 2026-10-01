// Checking your own work — requirements §4.2, FR-ROLE-12 to FR-ROLE-15, with
// FR-REP-02 (the Owner's WhatsApp) and the limits that must not move:
// FR-ROLE-14 (Gate 0 and Gate 4 unchanged), FR-DOC-08 (the Farm Doctor never
// confirms its own diagnosis) and the hard block on a treatment until the
// approval lands.
//
// Each rule is checked in the three places it is enforced: the app's own
// verdicts, the saved-record rebuild (store.reduce), and the farm server
// (server/core.mjs, which the Deno builds are generated from).
//
// The farm keeps West Africa Time (UTC+1). The spray window is 4-7 PM farm
// time (SR-01), so 15:00-18:00 UTC. Times below are UTC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const { loadRules } = await load('rules.js');
await loadRules();
const store = await load('store.js');
const sc = await load('domain/selfcheck.js');
const dx = await load('domain/diagnose.js');
const { canTreat, gateModel } = await load('domain/gates.js');
const { straightToOwner } = await load('domain/alerts.js');
const { digest, digestText } = await load('domain/digest.js');
const notify = await load('domain/notify.js');
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const RULES = JSON.parse(await readFile(new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8'));

const DAY = '2026-09-21';
const at = (hhmm, day = DAY) => `${day}T${hhmm}:00.000Z`;
const nextDay = '2026-09-22';

// --- A small farm, as an event log ------------------------------------------

const PEOPLE = {
  u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' },
  u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' },
  u_sup: { id: 'u_sup', name: 'Tamuno George', role: 'supervisor' },
  u_sup2: { id: 'u_sup2', name: 'Ibim Jack', role: 'supervisor' },
  u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' },
};

let n = 0;
const ev = (type, by, when, payload) => ({ id: `e${++n}`, type, by, at: when, payload });

/** People, a greenhouse, a crop in it. */
function base0() {
  return [
    ...Object.values(PEOPLE).map((p) => ev('person.upsert', 'u_owner', at('05:00', '2026-09-01'), p)),
    ev('plot.upsert', 'u_owner', at('05:01', '2026-09-01'), { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 }),
    ev('cycle.start', 'u_mgr', at('05:02', '2026-09-01'), {
      id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-09-01', status: 'active',
    }),
  ];
}

/** A thrips breach at 10:00 UTC (11 AM farm time): due at the close of today's window, 18:00 UTC. */
const breach = (when = at('10:00')) => ev('scout.record', 'u_sup', when,
  { id: 'sc1', cycleId: 'c1', pestId: 'thrips', trapCount: 14, date: when.slice(0, 10) });

/** A finished diagnosis the Field Supervisor raised: card, photo, confirm test, reasoning. */
const raised = (by = 'u_sup', when = at('11:00')) => ev('diagnosis.record', by, when, {
  id: 'dx1', cycleId: 'c1', cardId: 'thrips', engine: dx.RULES_VERSION, triageRow: 1,
  problemId: 'thrips', problemName: 'Thrips', date: when.slice(0, 10),
  photos: [{ dataUrl: 'data:image/jpeg;base64,xx' }],
  confirmTest: 'Tap test over white paper', confirmResult: 'Thrips on every tap',
  reasoning: 'Silvery scars on the young leaves and thrips in the flowers.',
});

const confirm = (by, when = at('12:00')) => ev('diagnosis.confirm', by, when,
  { id: 'dx1', confirmTest: 'Tap test over white paper', confirmResult: 'Thrips on every tap' });

const approve = (by, when) => ev('diagnosis.approve', by, when, { id: 'dx1' });

const spray = (when, extra = {}) => ev('spray.record', 'u_sup', when, {
  id: `sp_${when}`, cycleId: 'c1', diagnosisId: 'dx1', activeId: 'spinosad', productId: 'spinosad',
  productName: 'Spinosad', date: when.slice(0, 10), ...extra,
});

const clockIn = (who, when) => ev('attendance.in', who, when, { personId: who, date: when.slice(0, 10) });

const reduce = (events) => store.reduce(events);
const dxOf = (state) => state.diagnoses.find((d) => d.id === 'dx1');

// --- FR-ROLE-12: a second person preferred; self-confirmed when alone -------

test('FR-ROLE-12: the raiser may confirm alone, and the record is marked self-confirmed', () => {
  const state = reduce([...base0(), raised(), confirm('u_sup')]);
  const d = dxOf(state);
  assert.equal(d.confirmedBy, 'u_sup');
  assert.equal(d.selfConfirmed, true);
  assert.equal(d.approvalFrom, 'manager', "the Field Supervisor's goes to the Farm Manager");
  assert.equal(dx.readDiagnosis(d).selfConfirmed, true);
});

test('FR-ROLE-12: a second person confirming is not self-confirmed and needs no approval', () => {
  const d = dxOf(reduce([...base0(), raised(), confirm('u_mgr')]));
  assert.equal(d.selfConfirmed, false);
  assert.equal(d.approvalFrom, null);
  assert.equal(sc.treatable(d), true);
});

test('FR-ROLE-12: with another qualified person on the farm, the raiser cannot confirm it', () => {
  const events = [...base0(), clockIn('u_mgr', at('07:00')), raised(), confirm('u_sup')];
  const state = reduce(events);
  const d = dxOf(state);
  assert.equal(d.confirmedBy, undefined, 'replay refuses it');
  assert.match(d.confirmRefused, /Ada Briggs/);
  // The screen says the same thing before anybody presses a button.
  const verdict = dx.canConfirm(d,
    { by: 'u_sup', role: 'supervisor', others: sc.otherConfirmers(state, d, at('12:00')) });
  assert.equal(verdict.reason, 'second-person');
  // A hand on the farm is not qualified, and someone clocked out is not here.
  const later = reduce([...base0(), clockIn('u_hand', at('07:00')), clockIn('u_sup2', at('07:00')),
    ev('attendance.out', 'u_sup2', at('09:00'), { personId: 'u_sup2' }), raised(), confirm('u_sup')]);
  assert.equal(dxOf(later).selfConfirmed, true);
});

test('FR-ROLE-12: a later confirmation cannot turn a self-confirmed record into a second person\'s', () => {
  const d = dxOf(reduce([...base0(), raised(), confirm('u_sup'), confirm('u_sup2', at('12:30'))]));
  assert.equal(d.confirmedBy, 'u_sup');
  assert.equal(d.selfConfirmed, true);
  assert.equal(sc.awaitingApproval(d), true, 'only the approval lifts it');
});

test('FR-ROLE-12: the payload cannot claim a confirmation or an approval', () => {
  const forged = ev('diagnosis.record', 'u_sup', at('11:00'), {
    id: 'dx1', cycleId: 'c1', problemId: 'thrips', date: DAY,
    confirmedBy: 'u_mgr', selfConfirmed: false, approvedBy: 'u_mgr', approvalFrom: null,
  });
  const d = dxOf(reduce([...base0(), forged]));
  assert.equal(d.confirmedBy, undefined);
  assert.equal(d.approvedBy, undefined);
});

test('FR-ROLE-12 on the server: the raiser is refused while a second person is clocked in', async () => {
  const farm = memoryServer();
  await farm.push('u_mgr', [clockIn('u_mgr', at('07:00'))]);
  await farm.push('u_sup', [raised()]);
  const out = await farm.push('u_sup', [confirm('u_sup')]);
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].why, /second person/i);
  // Without anybody else in, it goes through.
  const alone = memoryServer();
  await alone.push('u_sup', [raised()]);
  assert.equal((await alone.push('u_sup', [confirm('u_sup')])).refused.length, 0);
});

// --- FR-ROLE-13: the next level up approves ---------------------------------

test('FR-ROLE-13: the Farm Manager\'s self-confirmation goes to the Owner; the Owner\'s is recorded, not escalated', () => {
  const mgr = dxOf(reduce([...base0(), raised('u_mgr'), confirm('u_mgr')]));
  assert.equal(mgr.selfConfirmed, true);
  assert.equal(mgr.approvalFrom, 'ceo');

  const own = dxOf(reduce([...base0(), raised('u_owner'), confirm('u_owner')]));
  assert.equal(own.selfConfirmed, true, 'recorded as self-confirmed');
  assert.equal(own.approvalFrom, null, 'nobody above the Owner');
  assert.equal(sc.awaitingApproval(own), false);
  assert.equal(sc.treatable(own), true);
  assert.equal(canTreat(reduce([...base0(), raised('u_owner'), confirm('u_owner')]), 'c1',
    { today: DAY, now: at('15:30') }).ok, true);
  assert.equal(sc.canApprove({}, own, { id: 'u_mgr', role: 'manager' }).reason, 'not-needed');
});

test('FR-ROLE-13: who may approve a Field Supervisor\'s — the Farm Manager; the Owner only when the Farm Manager is away', () => {
  const events = [...base0(), raised(), confirm('u_sup')];
  // The Farm Manager approves.
  assert.ok(dxOf(reduce([...events, approve('u_mgr', at('13:00'))])).approvedBy);
  // A peer Field Supervisor, a hand, and the confirmer do not.
  for (const who of ['u_sup2', 'u_hand', 'u_sup']) {
    const d = dxOf(reduce([...events, approve(who, at('13:00'))]));
    assert.equal(d.approvedBy, null, `${who} must not approve it`);
    assert.ok(d.approveRefused);
  }
  // The Owner, while the Farm Manager is in (clocked in): refused.
  const mgrIn = dxOf(reduce([...events, clockIn('u_mgr', at('12:30')), approve('u_owner', at('13:00'))]));
  assert.equal(mgrIn.approvedBy, null);
  assert.match(mgrIn.approveRefused, /Farm Manager/);
  // The Owner, with the Farm Manager marked absent: approved, as cover.
  const away = dxOf(reduce([...events,
    ev('absence.record', 'u_mgr', at('06:00'), { id: 'ab1', personId: 'u_mgr', date: DAY }),
    approve('u_owner', at('13:00'))]));
  assert.equal(away.approvedBy, 'u_owner');
  assert.equal(away.approvedCovering, true);
  // ...or not clocked in once the morning is out (9 AM farm time).
  const noShow = dxOf(reduce([...events, approve('u_owner', at('13:00'))]));
  assert.equal(noShow.approvedBy, 'u_owner');
  // The Farm Manager's own goes to the Owner and only the Owner.
  const mgrEvents = [...base0(), raised('u_mgr'), confirm('u_mgr')];
  assert.equal(dxOf(reduce([...mgrEvents, approve('u_sup', at('13:00'))])).approvedBy, null);
  assert.equal(dxOf(reduce([...mgrEvents, approve('u_owner', at('13:00'))])).approvedBy, 'u_owner');
});

test('FR-ROLE-13 on the server: the same ladder, judged from the stored log', async () => {
  const farm = memoryServer();
  await farm.push('u_sup', [raised(), confirm('u_sup')]);
  for (const who of ['u_sup', 'u_sup2']) {
    const out = await farm.push(who, [approve(who, at('13:00'))]);
    assert.equal(out.refused.length, 1, `${who} is refused`);
  }
  await farm.push('u_mgr', [clockIn('u_mgr', at('12:30'))]);
  assert.equal((await farm.push('u_owner', [approve('u_owner', at('13:00'))])).refused.length, 1,
    'the Owner is refused while the Farm Manager is in');
  assert.equal((await farm.push('u_mgr', [approve('u_mgr', at('13:05'))])).refused.length, 0);

  const away = memoryServer();
  await away.push('u_sup', [raised(), confirm('u_sup')]);
  await away.push('u_mgr', [ev('absence.record', 'u_mgr', at('06:00'), { id: 'ab1', personId: 'u_mgr', date: DAY })]);
  assert.equal((await away.push('u_owner', [approve('u_owner', at('13:00'))])).refused.length, 0,
    'the Owner covers for an absent Farm Manager');

  // The Owner's own self-confirmation. (The guided diagnosis is the Field
  // Supervisor's and the Farm Manager's, FR-DIAG-07, so the Owner raising one
  // reaches the log only from older records; the rule is judged all the same.)
  const facts = { diagnoses: {}, scouts: {}, sprays: [], decisions: [], attendance: [], absences: {} };
  for (const e of [raised('u_owner'), confirm('u_owner')]) core.foldFact(facts, e);
  const members = Object.values(PEOPLE).map((p) => ({ ...p, status: 'active' }));
  const verdict = await core.mayWriteFromLog(approve('u_mgr', at('13:00')), members[1], facts, members);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /recorded, not sent up/);
  // And a spray from it is not blocked: there is nobody to wait for.
  assert.equal((await core.mayWriteFromLog(spray(at('12:30')), members[0], facts, members)).ok, true);
});

// --- FR-ROLE-13: blocked until the approval lands ---------------------------

test('FR-ROLE-13: a treatment from a self-confirmed diagnosis is blocked, and stays blocked until approval lands', () => {
  const events = [...base0(), raised(), confirm('u_sup')];
  // No alert at all: blocked, now and later in the day.
  for (const when of [at('12:30'), at('15:30'), at('17:00')]) {
    const v = canTreat(reduce(events), 'c1', { today: DAY, now: when });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'awaiting-approval');
  }
  // The next morning, still nothing: still blocked.
  assert.equal(canTreat(reduce(events), 'c1', { today: nextDay, now: at('08:00', nextDay) }).reason, 'awaiting-approval');
  // A refused approval is not an approval.
  assert.equal(canTreat(reduce([...events, approve('u_sup2', at('13:00'))]), 'c1',
    { today: DAY, now: at('15:30') }).reason, 'awaiting-approval');
  // The approval lands: the treatment goes ahead, without the flag.
  const after = canTreat(reduce([...events, approve('u_mgr', at('13:00'))]), 'c1', { today: DAY, now: at('15:30') });
  assert.equal(after.ok, true);
  assert.equal(after.beforeApproval, undefined);
});

test('FR-ROLE-13: a spray that skipped the block is caught on replay and on the server', async () => {
  const events = [...base0(), raised(), confirm('u_sup')];
  const state = reduce([...events, spray(at('15:30'))]);
  assert.ok(state.sprays[0].unapproved, 'replay marks it');
  assert.equal(state.sprays[0].beforeApproval, null);
  const g3 = gateModel(state, 'gh1', { today: DAY, now: at('16:00') }).gates.find((g) => g.id === 'G3');
  assert.equal(g3.conditions[0].state, 'fail', 'Gate 3 is red');
  // Approving afterwards does not make it green: it went on without approval.
  const later = reduce([...events, spray(at('15:30')), approve('u_mgr', at('16:00'))]);
  assert.equal(gateModel(later, 'gh1', { today: DAY, now: at('17:00') }).gates.find((g) => g.id === 'G3').conditions[0].state, 'fail');

  const farm = memoryServer();
  await farm.push('u_sup', events.slice(-2));
  const out = await farm.push('u_sup', [spray(at('15:30'))]);
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].why, /blocked until it lands/);
  // ...and accepted once the approval is on the log.
  await farm.push('u_mgr', [approve('u_mgr', at('15:40'))]);
  assert.equal((await farm.push('u_sup', [spray(at('15:50'))])).refused.length, 0);
});

// --- FR-ROLE-13: the exception, computed from the deadline and the window ---

test('the spray window comes from SR-01, and the server\'s copy matches it', () => {
  const sr01 = RULES.spray_rules.find((r) => r.id === 'SR-01').rule;
  assert.match(sr01, /4-7 PM/);
  assert.deepEqual(sc.sprayWindow(RULES), { open: 16, close: 19 });
  assert.deepEqual(core.SPRAY_WINDOW, sc.sprayWindow(RULES), 'server/core.mjs repeats SR-01; it must not drift');
  // Farm time: 4 PM WAT is 15:00 UTC.
  assert.equal(sc.nextWindowOpens(at('10:00')), at('15:00'));
  assert.equal(sc.nextWindowOpens(at('15:30')), at('15:00', nextDay), 'inside a window, the next one is tomorrow');
  assert.equal(core.nextWindowOpens(at('15:30')), sc.nextWindowOpens(at('15:30')));
  // C-3: due at the close of that day's window; after 7 PM, the next day's; never past 24 h.
  assert.equal(sc.alertDeadline({ at: at('10:00') }), at('18:00'));
  assert.equal(sc.alertDeadline({ at: at('19:00') }), at('18:00', nextDay));
  assert.equal(core.alertDeadline(at('19:00')), at('18:00', nextDay));
});

test('FR-ROLE-13 exception: an alert due before the next window lets it go ahead, marked treated before approval', () => {
  const events = [...base0(), breach(), raised(), confirm('u_sup')];
  const v = canTreat(reduce(events), 'c1', { today: DAY, now: at('15:30') });
  assert.equal(v.ok, true, v.why);
  assert.ok(v.beforeApproval, 'the verdict says it is going before approval');
  assert.equal(v.beforeApproval.alertId, 'alert:sc1');
  assert.equal(v.beforeApproval.deadline, at('18:00'));
  assert.equal(v.beforeApproval.nextWindow, at('15:00', nextDay));

  // Replayed, the record carries the flag — computed, not taken from the payload.
  const state = reduce([...events, spray(at('15:30'))]);
  assert.deepEqual(state.sprays[0].beforeApproval,
    { alertId: 'alert:sc1', deadline: at('18:00'), nextWindow: at('15:00', nextDay) });
});

test('FR-ROLE-13 exception: not when the deadline falls after the next window opens', () => {
  // At noon farm time the window opens at 4 PM, before the 7 PM deadline: wait for the approval.
  const events = [...base0(), breach(), raised(), confirm('u_sup')];
  const v = canTreat(reduce(events), 'c1', { today: DAY, now: at('11:30') });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'awaiting-approval');
  assert.match(v.why, /after the next spray window opens/);
});

test('FR-ROLE-13 exception: never chosen by the person — a payload claim is ignored', async () => {
  // No alert, but the phone says "before approval": replay throws the claim away.
  const events = [...base0(), raised(), confirm('u_sup')];
  const claimed = spray(at('15:30'), { beforeApproval: { alertId: 'alert:sc1' } });
  const state = reduce([...events, claimed]);
  assert.equal(state.sprays[0].beforeApproval, null);
  assert.ok(state.sprays[0].unapproved);
  // An alert for a different pest does not count either.
  const mites = ev('scout.record', 'u_sup', at('10:00'), { id: 'sc9', cycleId: 'c1', pestId: 'broad_mite', perPlant: 99, date: DAY });
  assert.equal(canTreat(reduce([...base0(), mites, raised(), confirm('u_sup')]), 'c1',
    { today: DAY, now: at('15:30') }).ok, false);
  // The server refuses a claim it cannot match to an alert on the log.
  const farm = memoryServer();
  await farm.push('u_sup', events.slice(-2));
  assert.equal((await farm.push('u_sup', [claimed])).refused.length, 1);
  // ...and one whose alert is not due before the next window.
  const early = memoryServer();
  await early.push('u_sup', [breach(), raised(), confirm('u_sup')]);
  assert.equal((await early.push('u_sup', [spray(at('11:30'), { beforeApproval: { alertId: 'alert:sc1' } })])).refused.length, 1);
  // ...and accepts the real one.
  assert.equal((await early.push('u_sup', [spray(at('15:30'), { beforeApproval: { alertId: 'alert:sc1' } })])).refused.length, 0);
});

test('FR-ROLE-13: the Owner is told at once, and the item stays until the approval lands', () => {
  const events = [...base0(), breach(), raised(), confirm('u_sup'), spray(at('15:30'))];
  const now = at('15:31');
  const items = straightToOwner(reduce(events), { now }).filter((i) => i.kind === 'treated_before_approval');
  assert.equal(items.length, 1);
  assert.match(items[0].line, /Treated before approval on GH-01/);
  // It goes as its own WhatsApp message, from any phone, without waiting for the digest.
  const msgs = notify.ownerMessages(reduce(events), { now, role: 'hand' });
  assert.ok(msgs.some((m) => m.kind === 'immediate' && m.key === `now:treated_before_approval:sp_${at('15:30')}`));
  // Still on the Owner's list days later, until the approval lands.
  assert.equal(straightToOwner(reduce(events), { now: at('12:00', '2026-10-01'), days: 7 })
    .filter((i) => i.kind === 'treated_before_approval').length, 1);
  const approved = reduce([...events, approve('u_mgr', at('16:00'))]);
  assert.equal(straightToOwner(approved, { now: at('16:01') }).filter((i) => i.kind === 'treated_before_approval').length, 0);
});

test('Gate 3: yellow while treated before approval, green when it lands, red after 48 hours without it', () => {
  const events = [...base0(), breach(), raised(), confirm('u_sup'), spray(at('15:30'))];
  const g3 = (evs, now) => gateModel(reduce(evs), 'gh1', { today: now.slice(0, 10), now })
    .gates.find((g) => g.id === 'G3');
  const held = g3(events, at('16:00'));
  assert.equal(held.conditions[0].state, 'held');
  assert.equal(held.state, 'held', 'the gate shows yellow');
  assert.equal(g3(events, at('15:00', '2026-09-23')).conditions[0].state, 'held', 'still yellow at 47.5 h');
  assert.equal(g3(events, at('15:30', '2026-09-23')).conditions[0].state, 'fail', 'red at 48 h');
  assert.equal(g3([...events, approve('u_mgr', at('09:00', nextDay))], at('10:00', nextDay)).conditions[0].state, 'pass',
    'green when the approval lands');
});

// --- FR-ROLE-14: Gate 0 and Gate 4 unchanged; a self-confirmed diagnosis clears no gate

test('FR-ROLE-14: Gate 0 and Gate 4 read the same with or without a self-confirmed diagnosis on the zone', () => {
  const plain = reduce(base0());
  const withSelf = reduce([...base0(), breach(), raised('u_mgr'), confirm('u_mgr'), approve('u_owner', at('13:00'))]);
  const pick = (state) => gateModel(state, 'gh1', { today: DAY, now: at('16:00') }).gates
    .filter((g) => g.id === 'G0' || g.id === 'G4')
    .map((g) => ({ id: g.id, state: g.state, conditions: g.conditions.map((c) => [c.id, c.state]) }));
  assert.deepEqual(pick(withSelf), pick(plain));
  // And Gate 0 still wants the Farm Manager's confirmation and the Owner's approval.
  const g0 = gateModel(withSelf, 'gh1', { today: DAY }).gates.find((g) => g.id === 'G0');
  assert.notEqual(g0.state, 'pass');
});

test('FR-ROLE-14: a self-confirmed diagnosis never turns Gate 3 green before its approval', () => {
  const events = [...base0(), raised(), confirm('u_sup'), spray(at('15:30'))];
  for (const now of [at('15:31'), at('12:00', nextDay), at('12:00', '2026-09-30')]) {
    const c = gateModel(reduce(events), 'gh1', { today: now.slice(0, 10), now }).gates.find((g) => g.id === 'G3').conditions[0];
    assert.notEqual(c.state, 'pass');
  }
});

// --- FR-DOC-08 unchanged ----------------------------------------------------

test('FR-DOC-08: the Farm Doctor never confirms or approves, in the app, on replay or on the server', async () => {
  assert.equal(dx.canConfirm({ id: 'x', by: 'farm-doctor', cardId: 'c', confirmTest: 't', confirmResult: 'r', photos: [{}] },
    { by: 'farm-doctor' }).reason, 'doctor');
  const replay = dxOf(reduce([...base0(), raised(), confirm('farm-doctor')]));
  assert.equal(replay.confirmedBy, undefined);
  assert.match(replay.confirmRefused, /Farm Doctor/);
  const selfConfirmed = dxOf(reduce([...base0(), raised(), confirm('u_sup')]));
  assert.equal(sc.canApprove({}, selfConfirmed, { id: 'farm-doctor', role: 'ceo' }).reason, 'doctor');
  assert.equal(core.mayWrite({ type: 'diagnosis.confirm', payload: { id: 'dx1', confirmTest: 't', confirmResult: 'r' } },
    { id: 'farm-doctor', role: 'manager' }).ok, false);
  assert.equal(core.mayWrite({ type: 'diagnosis.approve', payload: { id: 'dx1' } },
    { id: 'farm-doctor', role: 'ceo' }).ok, false);
});

// --- FR-ROLE-15: the Owner digest counts them --------------------------------

test('FR-ROLE-15: the Owner digest counts self-confirmed diagnoses for the week, as a line, not an alert', () => {
  const state = reduce([...base0(), raised(), confirm('u_sup')]);
  const now = at('09:00', nextDay);
  const d = digest(state, { now });
  assert.equal(d.selfConfirmedWeek, 1);
  assert.ok(!d.items.some((i) => /self-confirmed/i.test(i.line)), 'not an exception item');
  assert.match(digestText(state, { now }), /Self-confirmed diagnoses this week: 1\./);
  // A week later it has dropped off.
  assert.equal(digest(state, { now: at('12:00', '2026-09-29') }).selfConfirmedWeek, 0);
  // A second person's confirmation is not counted.
  assert.equal(digest(reduce([...base0(), raised(), confirm('u_mgr')]), { now }).selfConfirmedWeek, 0);
});

// --- FR-REP-02: the Owner's WhatsApp ------------------------------------------

test('FR-REP-02: the digest goes from 7 AM farm time from a phone that runs the work; alarms from anyone', () => {
  const state = reduce([...base0(), raised(), confirm('u_sup')]);
  assert.equal(notify.ownerMessages(state, { now: at('05:30'), role: 'manager' }).length, 0, '6:30 AM farm time: not yet');
  const msgs = notify.ownerMessages(state, { now: at('06:00'), role: 'manager' });
  assert.deepEqual(msgs.map((m) => m.key), [`digest:${DAY}`]);
  assert.ok(msgs[0].text.length < 4096);
  assert.equal(notify.ownerMessages(state, { now: at('06:00'), role: 'hand' }).length, 0);
});

test('FR-REP-02: every item on immediate_to_owner goes when it happens, not with the digest', () => {
  // A suspected virus, recorded now.
  const virus = ev('diagnosis.record', 'u_sup', at('10:00'),
    { id: 'dv', cycleId: 'c1', problemId: 'tospovirus', problemName: 'Tomato spotted wilt virus', date: DAY });
  // (shape aside: what decides it is the problem named, not the card)
  const state = reduce([...base0(), virus]);
  const msgs = notify.ownerMessages(state, { now: at('10:05'), role: 'hand' });
  assert.deepEqual(msgs.map((m) => m.key), ['now:virus:dv']);
  assert.match(msgs[0].text, /^DouValue|— straight to you/m);
  assert.match(msgs[0].text, /VIRUS SUSPECTED/);
  // The rules' list is what is covered.
  assert.equal(RULES.escalation.immediate_to_owner.length, 5);
  // Old news is left to the digest.
  assert.equal(notify.ownerMessages(state, { now: at('11:00', '2026-09-24'), role: 'hand' }).length, 0);
});

test('FR-REP-02 on the server: WhatsApp, text first, each key once; the template only when the 24-hour rule refuses text', async () => {
  const env = (k) => ({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123', OWNER_WHATSAPP: '+234 803 000 0000',
    WHATSAPP_TEMPLATE: 'farm_update' })[k] || '';
  const calls = [];
  let outside = false;
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (outside && body.type === 'text') {
      return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 });
    }
    return new Response('{}', { status: 200 });
  };
  const farm = memoryServer();
  const me = { id: 'u_hand', role: 'hand' };
  const item = { key: 'now:virus:dv', kind: 'immediate', text: 'DouValue — straight to you\n!! VIRUS SUSPECTED' };

  const first = await core.notifyOwner('f', { items: [item] }, me, farm.store, { env, fetchFn });
  assert.equal(first.results[0].status, 'sent');
  assert.equal(calls[0].body.type, 'text', 'text first');
  assert.equal(calls[0].body.to, '2348030000000');
  assert.equal(calls[0].body.text.body, item.text);

  const again = await core.notifyOwner('f', { items: [item] }, me, farm.store, { env, fetchFn });
  assert.equal(again.results[0].status, 'already-sent', 'five phones offering it still means one message');
  assert.equal(calls.length, 1);

  // A hand cannot send the digest; a supervisor can.
  const dig = { key: `digest:${DAY}`, kind: 'digest', text: 'DouValue — 21 Sep\nNothing needs you today.' };
  assert.equal((await core.notifyOwner('f', { items: [dig] }, me, farm.store, { env, fetchFn })).results[0].status, 'refused');
  outside = true;
  const late = await core.notifyOwner('f', { items: [dig] }, { id: 'u_sup', role: 'supervisor' }, farm.store, { env, fetchFn });
  assert.equal(late.results[0].status, 'sent');
  assert.deepEqual(late.results[0].via, ['template']);
  assert.equal(calls.at(-1).body.template.name, 'farm_update');

  // Not set up: says so, sends nothing.
  const none = await core.notifyOwner('f', { items: [item] }, me, farm.store, { env: () => '', fetchFn });
  assert.equal(none.reason, 'not-configured');
});

// --- The server builds -----------------------------------------------------------

test('the generated Deno servers carry the same §4.2 checks as server/core.mjs', async () => {
  for (const file of ['../server/deno-sync.ts', '../server/deploy/main.ts']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const name of ['function mayWriteFromLog', 'function approverFor', "'diagnosis.approve'", 'function notifyOwner',
      'const SPRAY_WINDOW = { open: 16, close: 19 }']) {
      assert.ok(text.includes(name), `${file} is missing ${name}; run node scripts-build-deno.mjs`);
    }
  }
});

// --- A farm server in memory ----------------------------------------------------

function memoryServer() {
  const events = [];
  let farm = { id: 'f', name: 'Test farm' };
  const members = Object.values(PEOPLE).map((p) => ({ ...p, status: 'active' }));
  const s = {
    async getFarm() { return farm; },
    async setFarm(_id, f) { farm = f; },
    async listMembers() { return members; },
    async getMember(_id, id) { return members.find((m) => m.id === id) || null; },
    async appendEvents(_id, list) { events.push(...list); return { accepted: list.length, skipped: 0, cursor: events.length }; },
    async listEvents(_id, since, limit) {
      const page = events.slice(since, since + limit);
      return { events: page, cursor: since + page.length, more: since + page.length < events.length };
    },
    async countEvents() { return events.length; },
  };
  return {
    store: s,
    async push(who, list) {
      const me = members.find((m) => m.id === who);
      const res = await core.writeEvents('f', { events: list }, me, s);
      return res.json();
    },
  };
}
