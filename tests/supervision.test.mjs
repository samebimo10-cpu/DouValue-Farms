// Supervised spray and gate screens — UX-27, with UX-26 behind it.
//
// "Until that round is complete, spray and gate screens are used only with the
// Field Supervisor or Farm Manager present."
//
// Two things have to be true at once and it is easy to get one at the cost of
// the other: the rule has to actually hold before the trial is signed off, and
// it has to actually end afterwards. A rule that cannot be switched off gets
// worked around; a switch anybody can reach is not a rule. So the tests below
// come in pairs — it blocks, and it stops blocking; the Owner can sign off, and
// nobody else can.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const sup = await import(new URL('domain/supervision.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const { gatesView } = await import(new URL('ui/gates.js', base).href);

const people = {
  u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true },
  u_mgr: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager', active: true },
  u_sup: { id: 'u_sup', name: 'Tamuno West', role: 'supervisor', active: true },
  u_hand: { id: 'u_hand', name: 'Emeka Okoro', role: 'hand', active: true },
  u_gone: { id: 'u_gone', name: 'Former Supervisor', role: 'supervisor', active: false },
};

const farm = (settings = {}) => ({
  settings,
  people,
  plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' } },
  cycles: {}, tasks: {}, inputs: {}, soilTests: [], topsoilBatches: {}, gateOverrides: [],
  harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
  stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [], shifts: [],
  alertAcks: [], alertDecisions: [], positions: {}, absences: [], log: [], orphans: [],
});

// --- Before the trial is signed off ---------------------------------------

test('a farm that has not recorded the trial is a farm that has not had it', () => {
  // The default has to be "supervised": the requirement holds until the round
  // is complete, and silence is not completion.
  assert.equal(sup.trialSignedOff(farm()), false);
  assert.equal(sup.trialSignedOff(farm({ fieldTrial: {} })), false);
  assert.equal(sup.trialSignedOff(farm({ fieldTrial: { signedOff: true } })), true);
});

test('a hand cannot log a spray or record gate evidence alone', () => {
  for (const screen of ['spray', 'gate']) {
    const verdict = sup.checkSupervision(farm(), people.u_hand, { screen });
    assert.equal(verdict.ok, false, `${screen} let a hand through unsupervised`);
    assert.equal(verdict.needsConfirm, true);
    assert.match(verdict.why, /Field Supervisor or Farm Manager/);
  }
});

test('the Field Supervisor and the Farm Manager are the two the rule names', () => {
  for (const person of [people.u_sup, people.u_mgr, people.u_owner]) {
    assert.equal(sup.checkSupervision(farm(), person, { screen: 'spray' }).ok, true);
    assert.equal(sup.checkSupervision(farm(), person, { screen: 'spray' }).how, 'present');
  }
  assert.equal(sup.isSupervisor(people.u_hand), false);
});

test('or they confirm on the spot, which is what a shared phone actually looks like', () => {
  const verdict = sup.checkSupervision(farm(), people.u_hand,
    { screen: 'spray', confirmedBy: 'u_sup' });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.how, 'confirmed');
  assert.equal(verdict.by, 'u_sup');
  assert.equal(verdict.byName, 'Tamuno West', 'their name goes on the record');
});

test('another hand confirming is not a confirmation', () => {
  const verdict = sup.checkSupervision(farm(), people.u_hand,
    { screen: 'spray', confirmedBy: 'u_hand' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'not-a-supervisor');
});

test('somebody who has left the farm cannot be the one standing there', () => {
  const verdict = sup.checkSupervision(farm(), people.u_hand,
    { screen: 'spray', confirmedBy: 'u_gone' });
  assert.equal(verdict.ok, false);
  assert.deepEqual(sup.whoCanConfirm(farm()).map((p) => p.id), ['u_sup', 'u_mgr', 'u_owner']);
});

test('the sheet says who can confirm, so nobody has to go and find out', () => {
  const verdict = sup.checkSupervision(farm(), people.u_hand, { screen: 'gate' });
  assert.deepEqual(verdict.candidates.map((p) => p.name),
    ['Tamuno West', 'Ada Briggs', 'Ebimo Sam']);
  assert.match(verdict.fix, /confirm|hand them the phone/);
});

test('a farm with nobody in either position says so rather than blocking silently', () => {
  const alone = { ...farm(), people: { u_hand: people.u_hand } };
  const verdict = sup.checkSupervision(alone, people.u_hand, { screen: 'spray' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.fix, /Ask the Owner/);
});

// --- After the Owner signs off --------------------------------------------

test('signing off ends it, for everybody, on both screens', () => {
  const after = farm({ fieldTrial: { signedOff: true, by: 'u_owner', at: '2026-10-01T10:00:00Z' } });
  for (const screen of ['spray', 'gate']) {
    const verdict = sup.checkSupervision(after, people.u_hand, { screen });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.required, false);
    assert.equal(verdict.how, 'trial-signed-off');
  }
});

test('the sign-off is a record, not a flag: who, when, and any note', () => {
  const payload = sup.signOffPayload(people.u_owner,
    { note: 'Two hands, consultant watching, four fixes made', at: '2026-10-01T10:00:00Z' });
  assert.deepEqual(payload.fieldTrial, {
    signedOff: true, at: '2026-10-01T10:00:00Z', by: 'u_owner',
    note: 'Two hands, consultant watching, four fixes made',
  });

  const record = sup.trialRecord(farm(payload));
  assert.equal(record.signedOff, true);
  assert.equal(record.by, 'u_owner');
});

test('the Owner can put supervised use back on', () => {
  const off = sup.signOffPayload(people.u_owner, { signedOff: false });
  assert.equal(sup.trialSignedOff(farm(off)), false);
});

// --- Whose switch it is ----------------------------------------------------

test('only the Owner holds the switch', () => {
  // Deliberately not the Farm Manager's: the person who finds the confirmation
  // tedious is the person who must not be able to turn it off.
  assert.equal(sup.maySignOff(people.u_owner), true);
  assert.equal(sup.maySignOff(people.u_mgr), false);
  assert.equal(sup.maySignOff(people.u_sup), false);
  assert.equal(sup.maySignOff(people.u_hand), false);
});

test('the server refuses a sign-off from anybody but the Owner', () => {
  // Settings in general are the Farm Manager's. This one field is not.
  const guard = core.EVENT_POLICY['settings.update'].guard;
  const signOff = { payload: { fieldTrial: { signedOff: true } } };

  assert.equal(guard(signOff, { id: 'u_mgr', role: 'manager' }).ok, false);
  assert.match(guard(signOff, { id: 'u_mgr', role: 'manager' }).why, /Only the Owner/);
  assert.equal(guard(signOff, { id: 'u_owner', role: 'ceo' }).ok, true);

  // And it does not get in the way of ordinary settings.
  assert.equal(guard({ payload: { crateKg: 14 } }, { id: 'u_mgr', role: 'manager' }).ok, true);
});

// --- On the screen ---------------------------------------------------------

test('the gate screen says the rule is in force, and stops saying it afterwards', () => {
  const ctx = (state) => ({ state, user: people.u_hand, store: { state } });

  const before = gatesView.render(ctx(farm()));
  assert.match(before, /Field trial: supervised use/);
  assert.match(before, /Field Supervisor or Farm Manager/);

  const after = gatesView.render(ctx(farm({ fieldTrial: { signedOff: true } })));
  assert.ok(!after.includes('Field trial: supervised use'));
});
