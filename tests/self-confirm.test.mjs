// Checking your own work — requirements §4.2, FR-ROLE-12 and FR-ROLE-13.
//
// A supervisor who scouts a zone may be the only qualified person there to
// confirm what they found. The app allows it and marks the record
// self-confirmed, and a treatment from it waits for the next level up. These
// tests hold the three limits around that allowance, and the one thing it
// exists to guarantee:
//
//   1. FR-DOC-08 is unchanged: the Farm Doctor confirms and approves nothing.
//   2. A self-confirmed diagnosis clears no gate on its own.
//   3. The Owner's own confirmation is recorded, not sent up.
//   4. A treatment blocked on a self-confirmed diagnosis stays blocked until
//      the approval lands — on the phone, on replay and on the server.

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
const { canTreat, gateModel } = await import(new URL('domain/gates.js', base).href);
const { DOCTOR } = await import(new URL('domain/doctor.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-30';
const at = (hh) => `${TODAY}T${hh}:00:00.000Z`;
const ev = (id, type, by, payload, when = at('08')) => ({ id, type, by, at: when, payload });

const PEOPLE = [
  ['u_owner', 'Owner', 'ceo'],
  ['u_mgr', 'Farm Manager', 'manager'],
  ['u_mgr2', 'Second Manager', 'manager'],
  ['u_sup', 'Field Supervisor', 'supervisor'],
  ['u_sup2', 'Other Supervisor', 'supervisor'],
  ['u_hand', 'Greenhouse Hand', 'hand'],
];

/** A planted zone and its people. Everything after this is the diagnosis. */
const farm = () => [
  ...PEOPLE.map(([id, name, role], i) => ev(`p${i}`, 'person.upsert', 'u_owner', { id, name, role }, at('06'))),
  ev('z1', 'plot.upsert', 'u_owner', { id: 'gh1', name: 'GH-01' }, at('06')),
  ev('c1', 'cycle.start', 'u_owner',
    { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-01' }, at('06')),
];

/** A rules-engine diagnosis on GH-01 with its card, photos and confirm step in. */
const raise = (by, id = 'dx1') => ev(`r_${id}`, 'diagnosis.record', by, {
  id, cycleId: 'c1', date: TODAY, engine: dx.RULES_VERSION, cardId: 'acid_soil', triageRow: 23,
  confirmTest: 'Three-point pH test', confirmResult: 'pH 5.1', photos: [{ dataUrl: 'data:image/jpeg;base64,AA' }],
}, at('09'));
const confirm = (by, id = 'dx1', when = at('10')) => ev(`k_${id}_${by}`, 'diagnosis.confirm', by,
  { id, confirmTest: 'Three-point pH test', confirmResult: 'pH 5.1' }, when);
const approve = (by, id = 'dx1', when = at('11')) => ev(`a_${id}_${by}`, 'diagnosis.approve', by, { id }, when);

const replay = (...events) => store.reduce([...farm(), ...events]);
const diagnosis = (state, id = 'dx1') => state.diagnoses.find((d) => d.id === id);
const treat = (state) => canTreat(state, 'c1', { today: TODAY });

// --- FR-ROLE-12: allowed, and marked ----------------------------------------

test('FR-ROLE-12: the person who raised a diagnosis may confirm it, and the record says so', () => {
  const sup = diagnosis(replay(raise('u_sup'), confirm('u_sup')));
  assert.equal(sup.confirmedBy, 'u_sup');
  assert.equal(sup.selfConfirmed, true);
  assert.equal(sup.approvalFrom, 'manager', "the Field Supervisor's goes to the Farm Manager");

  const mgr = diagnosis(replay(raise('u_mgr'), confirm('u_mgr')));
  assert.equal(mgr.selfConfirmed, true);
  assert.equal(mgr.approvalFrom, 'ceo', "the Farm Manager's goes to the Owner");

  const second = diagnosis(replay(raise('u_hand'), confirm('u_sup')));
  assert.equal(second.selfConfirmed, false, 'a second person confirming is the ordinary case');
  assert.equal(second.approvalFrom, null);
  assert.equal(treat(replay(raise('u_hand'), confirm('u_sup'))).ok, true);
});

test('FR-ROLE-12: a later self-confirmation does not undo a second person\'s', () => {
  const state = replay(raise('u_sup'), confirm('u_mgr'), confirm('u_sup', 'dx1', at('12')));
  assert.equal(diagnosis(state).confirmedBy, 'u_mgr');
  assert.equal(diagnosis(state).selfConfirmed, false);
  assert.equal(treat(state).ok, true);
});

test('FR-ROLE-12: the confirm sheet allows it and names who approves next', () => {
  const record = { ...raise('u_sup').payload, by: 'u_sup' };
  const verdict = dx.canConfirm(record, { by: 'u_sup', senior: true, role: 'supervisor' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.self, true);
  assert.match(verdict.why, /Farm Manager approves it/);
});

// --- Limit 1: FR-DOC-08 is unchanged ------------------------------------------

test('limit — FR-DOC-08: the Farm Doctor still confirms nothing and approves nothing', () => {
  // Its name on a confirmation is refused on replay, whoever's phone sent it.
  const byDoctor = diagnosis(replay(raise('u_sup'), confirm(DOCTOR.id)));
  assert.equal(byDoctor.confirmedBy, undefined);
  assert.match(byDoctor.confirmRefused, /Farm Doctor/);
  assert.equal(dx.canConfirm({ ...raise('u_sup').payload, by: DOCTOR.id }, { by: DOCTOR.id }).reason, 'doctor');

  // Nor can it approve a self-confirmed diagnosis into a treatment.
  const state = replay(raise('u_sup'), confirm('u_sup'), approve(DOCTOR.id));
  assert.equal(diagnosis(state).approvedBy, null);
  assert.equal(treat(state).reason, 'awaiting-approval');
  assert.equal(dx.canApprove(diagnosis(state), { id: DOCTOR.id, role: 'doctor' }).reason, 'doctor');

  // And the server refuses both before they reach the log.
  const doctor = { id: 'farm-doctor', memberId: 'farm-doctor', role: 'ceo' };
  assert.equal(core.mayWrite({ type: 'diagnosis.approve', payload: { id: 'dx1' } }, doctor).ok, false);
  assert.equal(core.mayWrite({ type: 'diagnosis.confirm',
    payload: { id: 'dx1', confirmTest: 'x', confirmResult: 'y' } }, doctor).ok, false);

  // The Doctor's own outputs are untouched by any of this.
  const output = store.reduce([...farm(),
    ev('o1', 'doctor.record', 'u_sup', { id: 'fd1', kind: 'photo', subject: { cycleId: 'c1' } }, at('09')),
    ev('o2', 'doctor.confirm', DOCTOR.id, { id: 'fd1' }, at('10'))]).doctorOutputs[0];
  assert.equal(output.confirmedBy, null);
  assert.equal(output.clears, false);
});

// --- Limit 2: a self-confirmed diagnosis clears no gate -------------------------

test('limit — a self-confirmed diagnosis does not open Gate 3 / FR-GATE-04 on its own', () => {
  const state = replay(raise('u_sup'), confirm('u_sup'));
  const verdict = treat(state);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'awaiting-approval');
  assert.match(verdict.why, /Acid soil/);
  assert.match(verdict.fix, /Farm Manager/);

  // A spray that reached the log anyway — a phone that skipped the screen —
  // turns Gate 3 red rather than being read as diagnosed.
  const sprayed = replay(raise('u_sup'), confirm('u_sup'),
    ev('s1', 'spray.record', 'u_sup', { id: 'sp1', cycleId: 'c1', diagnosisId: 'dx1',
      productId: 'mancozeb', date: TODAY }, at('12')),
    approve('u_mgr', 'dx1', at('13')));
  const g3 = gateModel(sprayed, 'gh1', { today: TODAY }).gates.find((g) => g.id === 'G3');
  const line = g3.conditions.find((c) => c.id === 'g3_diagnosis_first');
  assert.equal(line.state, 'fail', 'approving afterwards does not make that spray diagnosed');
  assert.match(line.why, /before it was approved/);

  // The same spray logged after the approval is an ordinary diagnosed spray.
  const inOrder = replay(raise('u_sup'), confirm('u_sup'), approve('u_mgr', 'dx1', at('11')),
    ev('s1', 'spray.record', 'u_sup', { id: 'sp1', cycleId: 'c1', diagnosisId: 'dx1',
      productId: 'mancozeb', date: TODAY }, at('12')));
  const ok = gateModel(inOrder, 'gh1', { today: TODAY }).gates.find((g) => g.id === 'G3')
    .conditions.find((c) => c.id === 'g3_diagnosis_first');
  assert.equal(ok.state, 'pass');
});

// --- Limit 3: the Owner's own is recorded, not escalated -------------------------

test('limit — an Owner self-confirmation is recorded as self-confirmed and sent nowhere', () => {
  const state = replay(raise('u_owner'), confirm('u_owner'));
  const d = diagnosis(state);
  assert.equal(d.selfConfirmed, true, 'recorded');
  assert.equal(d.approvalFrom, null, 'nobody above to send it to');
  assert.equal(dx.awaitingApproval(d), false);
  assert.equal(dx.readDiagnosis(d).selfConfirmed, true);
  assert.equal(treat(state).ok, true, 'and it does not wait on anyone');

  // Nobody is asked to approve it, and an approval sent anyway changes nothing.
  assert.equal(dx.canApprove(d, { id: 'u_mgr', role: 'manager' }).reason, 'not-needed');
  const after = diagnosis(replay(raise('u_owner'), confirm('u_owner'), approve('u_mgr')));
  assert.equal(after.approvedBy, null);
  assert.equal(after.selfConfirmed, true);
});

// --- The guarantee: blocked until the approval lands ---------------------------

test('FR-ROLE-13: a treatment blocked on a self-confirmed diagnosis stays blocked until the approval lands', () => {
  const blocked = (...more) => treat(replay(raise('u_sup'), confirm('u_sup'), ...more));

  assert.equal(blocked().reason, 'awaiting-approval');
  assert.equal(blocked(approve('u_sup')).reason, 'awaiting-approval', 'not by the person who confirmed it');
  assert.equal(blocked(approve('u_sup2')).reason, 'awaiting-approval', 'not by a peer');
  assert.equal(blocked(approve('u_hand')).reason, 'awaiting-approval', 'not from below');

  const refused = diagnosis(replay(raise('u_sup'), confirm('u_sup'), approve('u_sup2')));
  assert.match(refused.approveRefused, /Farm Manager/, 'and the record says why');

  const landed = replay(raise('u_sup'), confirm('u_sup'), approve('u_mgr'));
  assert.equal(treat(landed).ok, true, 'the Farm Manager approves it and the treatment may go');
  assert.equal(diagnosis(landed).approvedBy, 'u_mgr');
  assert.equal(diagnosis(landed).selfConfirmed, true, 'approved, and still marked self-confirmed');

  // The Farm Manager's own waits for the Owner, not another manager.
  const mgr = (...more) => treat(replay(raise('u_mgr'), confirm('u_mgr'), ...more));
  assert.equal(mgr(approve('u_mgr2')).reason, 'awaiting-approval');
  assert.equal(mgr(approve('u_owner')).ok, true);
});

test('FR-ROLE-13: an approval whose clock ran ahead of the confirmation still lands', () => {
  // Phones drift. The approver saw the confirmation, so the approval answers
  // it even if its timestamp is earlier.
  const state = replay(raise('u_sup'), approve('u_mgr', 'dx1', at('09')), confirm('u_sup', 'dx1', at('10')));
  assert.equal(diagnosis(state).approvedBy, 'u_mgr');
  assert.equal(treat(state).ok, true);
});

// --- The server --------------------------------------------------------------

/** Just enough of a storage adapter: a log and the members. */
const serverStore = (events) => ({
  async listEvents(farmId, since, limit) {
    const slice = events.slice(since, since + limit);
    return { events: slice, cursor: since + slice.length, more: since + slice.length < events.length };
  },
  async getMember(farmId, id) {
    const found = PEOPLE.find(([pid]) => pid === id);
    return found ? { id, role: found[2] } : null;
  },
});
const member = (id) => ({ id, memberId: id, role: PEOPLE.find(([pid]) => pid === id)[2] });
const serverSays = (log, by) => core.mayApproveDiagnosis(approve(by), member(by), 'farm', serverStore(log));

test('FR-ROLE-13 on the server: who may approve is read from the stored log, not the payload', async () => {
  const supOwn = [raise('u_sup'), confirm('u_sup')];
  assert.equal((await serverSays(supOwn, 'u_sup')).ok, false, 'not the confirmer');
  assert.equal((await serverSays(supOwn, 'u_sup2')).ok, false, 'not a peer');
  assert.equal((await serverSays(supOwn, 'u_mgr')).ok, true, 'the Farm Manager');
  assert.equal((await serverSays(supOwn, 'u_owner')).ok, true, 'or the Owner above them');

  const mgrOwn = [raise('u_mgr'), confirm('u_mgr')];
  assert.equal((await serverSays(mgrOwn, 'u_mgr2')).ok, false);
  assert.equal((await serverSays(mgrOwn, 'u_owner')).ok, true);

  assert.match((await serverSays([raise('u_owner'), confirm('u_owner')], 'u_mgr')).why, /recorded/);
  assert.match((await serverSays([raise('u_hand'), confirm('u_sup')], 'u_mgr')).why, /second person/);
  assert.match((await serverSays([raise('u_sup')], 'u_mgr')).why, /not been confirmed/);

  // A supervisor cannot file an approval at all.
  assert.equal(core.mayWrite(approve('u_sup'), member('u_sup')).ok, false);
});

test('the app and the server agree on who approves whose self-confirmation', () => {
  for (const role of [...Object.keys(core.ROLES), 'unknown']) {
    assert.equal(core.selfConfirmApprover(role), dx.selfConfirmApprover(role), role);
  }
});
