// FR-ROLE-13's one exception — treated before approval.
//
// A treatment from a self-confirmed diagnosis waits for the next level up.
// Except when it closes an open alert whose deadline (rules C-3) falls before
// the next spray window (SR-01, 4–7 PM farm time): then waiting would miss the
// deadline, so the treatment goes ahead, is marked treated before approval,
// and the Owner is told at once. The approval is still owed, and the record
// stays flagged until it lands.
//
// Times below are UTC; the farm keeps West Africa Time, UTC+1. So the spray
// window is 15:00–18:00Z.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const RULES = JSON.parse(readFileSync(
  new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8',
));
(await import(new URL('rules.js', base).href)).setRules(RULES);

const store = await import(new URL('store.js', base).href);
const dx = await import(new URL('domain/diagnose.js', base).href);
const al = await import(new URL('domain/alerts.js', base).href);
const { canTreat, gateModel } = await import(new URL('domain/gates.js', base).href);
const { ownerMessages } = await import(new URL('domain/notify.js', base).href);

const DAY = '2026-09-30';
const at = (hhmm) => `${DAY}T${hhmm}:00.000Z`;
const ev = (id, type, by, payload, when) => ({ id, type, by, at: when, payload });

const farm = [
  ev('p1', 'person.upsert', 'u_owner', { id: 'u_owner', name: 'Owner', role: 'ceo' }, at('06:00')),
  ev('p2', 'person.upsert', 'u_owner', { id: 'u_mgr', name: 'Farm Manager', role: 'manager' }, at('06:00')),
  ev('p3', 'person.upsert', 'u_owner', { id: 'u_sup', name: 'Field Supervisor', role: 'supervisor' }, at('06:00')),
  ev('z1', 'plot.upsert', 'u_owner', { id: 'gh1', name: 'GH-01' }, at('06:00')),
  ev('c1', 'cycle.start', 'u_owner', { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-10' }, at('06:00')),
];
/** Thrips over the greenhouse line at 09:00 farm time: C-3 says treat in today's window. */
const breach = (pestId = 'thrips') => ev(`s_${pestId}`, 'scout.record', 'u_sup',
  { id: `sc_${pestId}`, cycleId: 'c1', pestId, trapCount: 40, date: DAY }, at('08:00'));
/** The supervisor diagnoses thrips and, alone on the farm, confirms it themselves. */
const selfConfirmed = [
  ev('d1', 'diagnosis.record', 'u_sup', {
    id: 'dx1', cycleId: 'c1', date: DAY, engine: dx.RULES_VERSION, cardId: 'thrips', triageRow: 1,
    confirmTest: 'Tap a tip over white paper', confirmResult: 'Six thrips on one tip',
    photos: [{ dataUrl: 'data:image/jpeg;base64,AA' }],
  }, at('09:00')),
  ev('k1', 'diagnosis.confirm', 'u_sup', { id: 'dx1', confirmTest: 'x', confirmResult: 'y' }, at('09:30')),
];
const spray = (when) => ev(`sp_${when}`, 'spray.record', 'u_sup', {
  id: `sp_${when.slice(11, 16).replace(':', '')}`, cycleId: 'c1', diagnosisId: 'dx1', productId: 'spinosad',
  activeId: 'spinosad', productName: 'Spinosad 45SC', date: DAY, at: when,
}, when);
const approve = (when) => ev('a1', 'diagnosis.approve', 'u_mgr', { id: 'dx1' }, when);

const replay = (...more) => store.reduce([...farm, ...more]);
const g3 = (state) => gateModel(state, 'gh1', { today: DAY }).gates.find((g) => g.id === 'G3')
  .conditions.find((c) => c.id === 'g3_diagnosis_first');

test('C-3 and SR-01: the deadline is the close of the window the breach falls in, the next window is tomorrow once this one opens', () => {
  assert.equal(al.sprayDeadline({ at: at('08:00'), dueAt: '2026-10-01T08:00:00.000Z' }), at('18:00'));
  assert.equal(al.sprayDeadline({ at: at('19:00'), dueAt: '2026-10-01T19:00:00.000Z' }), '2026-10-01T18:00:00.000Z',
    'logged after 7 PM farm time: the next day\'s window');
  assert.equal(al.nextSprayWindow(at('12:00')), at('15:00'), 'before 4 PM: today\'s window');
  assert.equal(al.nextSprayWindow(at('16:00')), '2026-10-01T15:00:00.000Z', 'inside it: tomorrow\'s');
});

test('FR-ROLE-13: before the window opens there is still time to approve, so it stays blocked', () => {
  const verdict = canTreat(replay(breach(), ...selfConfirmed), 'c1', { today: DAY, now: at('13:00') });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'awaiting-approval');
});

test('FR-ROLE-13: in the last window before the deadline, the treatment goes ahead marked treated before approval', () => {
  const verdict = canTreat(replay(breach(), ...selfConfirmed), 'c1', { today: DAY, now: at('16:00') });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.beforeApproval, 'and it says so');
  assert.equal(verdict.beforeApproval.alert.pestId, 'thrips');
  assert.equal(verdict.beforeApproval.deadline, at('18:00'));
  assert.equal(verdict.beforeApproval.approvalFrom, 'manager');
  assert.match(verdict.beforeApproval.why, /Owner is told now/);
});

test('FR-ROLE-13: the exception needs an open alert on the same pest', () => {
  const noAlert = canTreat(replay(...selfConfirmed), 'c1', { today: DAY, now: at('16:00') });
  assert.equal(noAlert.reason, 'awaiting-approval', 'no alert, nothing that cannot wait');
  const otherPest = canTreat(replay(breach('whitefly'), ...selfConfirmed), 'c1', { today: DAY, now: at('16:00') });
  assert.equal(otherPest.reason, 'awaiting-approval', 'a whitefly alert does not let a thrips spray skip approval');
});

test('FR-ROLE-13: the record stays flagged, and the Owner is told, until the approval lands', () => {
  const treated = replay(breach(), ...selfConfirmed, spray(at('16:30')));
  const sp = treated.sprays[0];

  const status = al.approvalStatus(treated, sp);
  assert.equal(status.exception, true, 'the alert could not wait, judged as the farm stood when it went on');
  assert.equal(status.approved, false);

  assert.equal(g3(treated).state, 'held', 'flagged, not red: it was allowed');
  assert.match(g3(treated).why, /Treated before approval/);

  const owner = al.straightToOwner(treated, { now: at('16:31') }).find((i) => i.kind === 'treated_before_approval');
  assert.ok(owner, 'on the straight-to-Owner list');
  assert.equal(owner.rule, 'FR-ROLE-13');
  const messages = ownerMessages(treated, { now: at('16:31'), role: 'supervisor' });
  assert.ok(messages.some((m) => m.key === `now:treated_before_approval:${sp.id}` && m.kind === 'immediate'),
    'and offered to the Owner at once, not at tomorrow\'s digest');

  // Still owed the next morning: nothing ages it off.
  assert.ok(al.straightToOwner(treated, { now: '2026-10-09T08:00:00.000Z' })
    .some((i) => i.kind === 'treated_before_approval'));

  const landed = replay(breach(), ...selfConfirmed, spray(at('16:30')), approve(at('17:10')));
  assert.equal(al.approvalStatus(landed, landed.sprays[0]).approved, true);
  assert.equal(g3(landed).state, 'pass', 'the flag clears when the approval lands');
  assert.equal(al.straightToOwner(landed, { now: at('17:11') })
    .some((i) => i.kind === 'treated_before_approval'), false);
});

test('FR-ROLE-13: a spray that did not qualify for the exception is still red, approval or not', () => {
  const early = replay(breach(), ...selfConfirmed, spray(at('13:00')));
  assert.equal(al.approvalStatus(early, early.sprays[0]).exception, false);
  assert.equal(g3(early).state, 'fail');
  assert.equal(al.straightToOwner(early, { now: at('13:01') })
    .some((i) => i.kind === 'treated_before_approval'), false, 'not an exception, so not reported as one');
});
