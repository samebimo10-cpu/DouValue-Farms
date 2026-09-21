// The Farm Doctor — requirements §6.14.
//
// There is no agronomist on this site, so this file is the only thing standing
// between "the app said so" and a spray going on. The important half is not
// that the Doctor gives good advice; it is that the six limits in FR-DOC-08
// hold when the advice is inconvenient. Each of those limits has a test named
// after it below, and each one tries to break the limit the way a real day
// would: a reply that claims certainty, a product that is not on the shelf, an
// account confirming its own work.
//
// The rules file is the source of truth (CLAUDE.md), so the tests read the
// real one off disk rather than a fixture. A rule that changes there changes
// here, which is the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const RULES = JSON.parse(readFileSync(
  new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8',
));

const rulesModule = await import(new URL('rules.js', base).href);
rulesModule.setRules(RULES);

const {
  CONFIDENCE, DOCTOR, FOLLOW_UP_DAYS, LIMITS, approvePlan, awaitingConfirmation, checkPlan,
  confirmOutput, countChange, doseFor, doctorOutput, doctorRecords, draftCycleReview,
  followUpBoard, followUpRecord, followUpTaskId, gateClearance, gateEvidence, labAdvice,
  labSamples, missingFollowUps, normalisePhotoReview, openLabSamples, ownerNotifications,
  parseRate, photoReviewRequest, stockOf, treatmentPlan,
} = await import(new URL('domain/doctor.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);
const { exceptions } = await import(new URL('domain/digest.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const TODAY = '2026-09-21';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const OWNER = { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' };
const MANAGER = { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' };
const SUPERVISOR = { id: 'u_sup', name: 'Tari West', role: 'supervisor' };
const HAND = { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' };

/** A farm with a bell pepper house, a confirmed thrips diagnosis and a stocked store. */
function farm(overrides = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: {
      u_owner: { ...OWNER, active: true },
      u_mgr: { ...MANAGER, active: true },
      u_sup: { ...SUPERVISOR, active: true },
      u_hand: { ...HAND, active: true },
    },
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 } },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', variety: 'Nikita',
        transplantDate: day(-40), plants: 900, areaM2: 300, status: 'active' },
    },
    inputs: {
      i_spin: { id: 'i_spin', name: 'Spinosad 45SC', kind: 'chemical', unit: 'litre', qty: 2 },
      i_man: { id: 'i_man', name: 'Mancozeb 80% WP', kind: 'chemical', unit: 'kg', qty: 5 },
      i_neem: { id: 'i_neem', name: 'Neem oil', kind: 'chemical', unit: 'litre', qty: 3 },
      i_abam: { id: 'i_abam', name: 'Abamectin 1.8EC', kind: 'chemical', unit: 'litre', qty: 1 },
    },
    tasks: {},
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'thrips', problemName: 'Thrips',
      date: day(-1), confirmedBy: 'u_sup', confirmedAt: `${day(-1)}T17:00:00Z` }],
    sprays: [], scouts: [], harvests: [], sales: [], expenses: [], stockMoves: [],
    attendance: [], workLogs: [], weather: [], reports: [], soilTests: [],
    topsoilBatches: {}, gateOverrides: [], positions: {}, absences: [],
    doctorOutputs: [], gateEvidence: [], labSamples: [],
    log: [], orphans: [],
    ...overrides,
  };
}

const whys = (result) => (result.violations || []).map((v) => v.why).join(' | ');
const limitsHit = (result) => (result.violations || []).map((v) => v.limit).filter(Boolean);

// ===========================================================================
// FR-DOC-08, limit 1 — never clears a gate
// ===========================================================================

test('FR-DOC-08: a gate check never clears the gate, however complete the evidence', () => {
  const state = farm();
  const review = gateEvidence(state, { zoneId: 'gh1', cycleId: 'c1', today: TODAY });

  assert.equal(review.clears, false);
  assert.equal(review.clearedBy, null);
  assert.ok(review.missing.length, 'an untested zone should be missing evidence');
  // And it says who does clear it, because a refusal with no route is an override waiting to happen.
  assert.match(review.needsConfirming, /Farm Manager/);
  assert.equal(review.needsApproval, 'Owner');
});

test('FR-DOC-08: clearing a gate needs the Farm Manager and the Owner, not the Doctor', () => {
  const complete = { missing: [] };

  const bySelf = gateClearance(complete, { confirmedBy: DOCTOR, approvedBy: DOCTOR });
  assert.equal(bySelf.ok, false);
  assert.equal(bySelf.limit, 'gate');

  const halfWay = gateClearance(complete, { confirmedBy: MANAGER, approvedBy: null });
  assert.equal(halfWay.ok, false);
  assert.match(halfWay.why, /Owner approval/);

  const supervisorIsNotEnough = gateClearance(complete, { confirmedBy: SUPERVISOR, approvedBy: OWNER });
  assert.equal(supervisorIsNotEnough.ok, false);
  assert.match(supervisorIsNotEnough.why, /Farm Manager/);

  const proper = gateClearance(complete, { confirmedBy: MANAGER, approvedBy: OWNER });
  assert.equal(proper.ok, true);
  assert.equal(proper.cleared, true);
});

test('FR-DOC-08: evidence still missing means no clearance even with both signatures', () => {
  const verdict = gateClearance({ missing: [{ id: 'lab_report' }] },
    { confirmedBy: MANAGER, approvedBy: OWNER });
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /evidence still missing/);
});

// ===========================================================================
// FR-DOC-08, limit 2 — never confirms its own diagnosis
// ===========================================================================

test('FR-DOC-08: the Farm Doctor cannot confirm its own diagnosis', () => {
  const output = doctorOutput({ kind: 'photo', subject: { cycleId: 'c1' }, confidence: 'high' });
  assert.equal(output.confirmedBy, null);

  const selfConfirm = confirmOutput(output, DOCTOR);
  assert.equal(selfConfirm.ok, false);
  assert.equal(selfConfirm.limit, 'diagnosis');
  assert.match(selfConfirm.fix, /Field Supervisor or Farm Manager/);
});

test('FR-DIAG-03: a hand may not confirm one either, a supervisor may', () => {
  const output = doctorOutput({ kind: 'photo', subject: { cycleId: 'c1' }, confidence: 'medium' });

  const byHand = confirmOutput(output, HAND);
  assert.equal(byHand.ok, false);
  assert.match(byHand.why, /Field Supervisor or Farm Manager/);

  const bySupervisor = confirmOutput(output, SUPERVISOR, { at: `${TODAY}T18:00:00Z` });
  assert.equal(bySupervisor.ok, true);
  assert.equal(bySupervisor.output.confirmedBy, 'u_sup');
  assert.equal(bySupervisor.output.confirmedAt, `${TODAY}T18:00:00Z`);
});

test('FR-DOC-08: the event log refuses a self-confirmation, it does not merely hide it', () => {
  const events = [
    { id: 'e0', type: 'person.upsert', at: `${day(-2)}T08:00:00Z`, by: 'u_owner',
      payload: { id: 'u_sup', name: 'Tari West', role: 'supervisor' } },
    { id: 'e1', type: 'doctor.record', at: `${TODAY}T09:00:00Z`, by: 'u_sup',
      payload: { id: 'fd1', kind: 'photo', confidence: 'high', subject: { cycleId: 'c1' },
        // A payload that has tried to promote itself on the way in.
        confirmedBy: 'farm-doctor', clears: true, approvedBy: 'farm-doctor' } },
    { id: 'e2', type: 'doctor.confirm', at: `${TODAY}T09:05:00Z`, by: 'farm-doctor', payload: { id: 'fd1' } },
  ];
  const state = reduce(events);
  const saved = state.doctorOutputs[0];

  assert.equal(saved.clears, false);
  assert.equal(saved.confirmedBy, null, 'the Doctor cannot confirm its own output');
  assert.equal(saved.approvedBy, null);
});

test('FR-DOC-10: a confirmation by a person who is senior enough does land', () => {
  const events = [
    { id: 'e0', type: 'person.upsert', at: `${day(-2)}T08:00:00Z`, by: 'u_owner',
      payload: { id: 'u_sup', name: 'Tari West', role: 'supervisor' } },
    { id: 'e1', type: 'doctor.record', at: `${TODAY}T09:00:00Z`, by: 'u_sup',
      payload: { id: 'fd1', kind: 'photo', confidence: 'medium', subject: { cycleId: 'c1' },
        read: [{ kind: 'photos', what: '2 photos' }] } },
    { id: 'e2', type: 'doctor.confirm', at: `${TODAY}T10:00:00Z`, by: 'u_sup',
      payload: { id: 'fd1', note: 'Tapped a tip over paper, thrips present' } },
  ];
  const state = reduce(events);
  const saved = state.doctorOutputs[0];

  assert.equal(saved.confirmedBy, 'u_sup');
  assert.equal(saved.confirmedRole, 'supervisor');
  assert.equal(saved.confidence, 'medium');
  assert.deepEqual(saved.read, [{ kind: 'photos', what: '2 photos' }]);
});

// ===========================================================================
// FR-DOC-08, limit 3 — never approves its own plan
// ===========================================================================

test('FR-DOC-08: a plan is born unapproved and not sprayable', () => {
  const plan = treatmentPlan(farm(), { problemId: 'thrips', cycleId: 'c1', diagnosisId: 'd1', today: TODAY });

  assert.equal(plan.approvedBy, null);
  assert.equal(plan.readyToSpray, false);
  assert.equal(plan.clears, false);
  assert.match(plan.needsApproval, /Farm Manager/);
});

test('FR-DOC-08: the Doctor cannot approve its own plan, and a supervisor cannot either', () => {
  const plan = treatmentPlan(farm(), { problemId: 'thrips', cycleId: 'c1', diagnosisId: 'd1', today: TODAY });

  const bySelf = approvePlan(plan, DOCTOR);
  assert.equal(bySelf.ok, false);
  assert.equal(bySelf.limit, 'plan');

  const bySupervisor = approvePlan(plan, SUPERVISOR);
  assert.equal(bySupervisor.ok, false);
  assert.match(bySupervisor.why, /Farm Manager/);

  const byManager = approvePlan(plan, MANAGER, { at: `${TODAY}T15:00:00Z` });
  assert.equal(byManager.ok, true);
  assert.equal(byManager.plan.approvedBy, 'u_mgr');
});

test('FR-DOC-08: an approval only lands on the log after a person has confirmed', () => {
  const events = [
    { id: 'e0', type: 'person.upsert', at: `${day(-3)}T08:00:00Z`, by: 'u_owner',
      payload: { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' } },
    { id: 'e1', type: 'doctor.record', at: `${TODAY}T09:00:00Z`, by: 'u_mgr',
      payload: { id: 'fd_plan', kind: 'plan', subject: { cycleId: 'c1' } } },
    { id: 'e2', type: 'doctor.approve', at: `${TODAY}T09:10:00Z`, by: 'u_mgr', payload: { id: 'fd_plan' } },
  ];
  assert.equal(reduce(events).doctorOutputs[0].approvedBy, null,
    'approval without a confirmation is not an approval');

  const confirmed = reduce([
    ...events.slice(0, 2),
    { id: 'e3', type: 'doctor.confirm', at: `${TODAY}T09:05:00Z`, by: 'u_mgr', payload: { id: 'fd_plan' } },
    events[2],
  ]);
  assert.equal(confirmed.doctorOutputs[0].approvedBy, 'u_mgr');
});

// ===========================================================================
// FR-DOC-08, limit 4 — never a product outside the catalogue or the store
// ===========================================================================

test('FR-DOC-08: a banned product is refused before anything else is considered', () => {
  // Carbofuran works on nematodes, is cheap, and is the exact reason this limit
  // exists. FR-STOCK-09 keeps it out of the catalogue; this keeps it out of the
  // Doctor's mouth even if somebody re-adds it to the shelf.
  const state = farm({ inputs: { i_bad: { id: 'i_bad', name: 'Furadan (carbofuran)', qty: 10 } } });
  const verdict = checkPlan(state, { active: 'Carbofuran', cycleId: 'c1' }, { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.deepEqual(limitsHit(verdict), ['catalogue']);
  assert.match(whys(verdict), /banned/);
});

test('FR-DOC-08: a product that is not an active ingredient in the catalogue is refused', () => {
  const verdict = checkPlan(farm(), { active: 'Lion Seal', cycleId: 'c1' }, { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.deepEqual(limitsHit(verdict), ['catalogue']);
  // The rules removed the unknown brands until a manager enters them as labels.
  assert.match(whys(verdict), /not an active ingredient in the catalogue/);
});

test('FR-DOC-08: a catalogue product that is not on the shelf is refused', () => {
  const state = farm();
  delete state.inputs.i_spin;
  const verdict = checkPlan(state, { active: 'Spinosad', cycleId: 'c1' }, { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.ok(limitsHit(verdict).includes('catalogue'));
  assert.match(whys(verdict), /no Spinosad in the store/);
});

test('FR-STOCK-04: expired stock is not stock', () => {
  const state = farm({
    inputs: { i_spin: { id: 'i_spin', name: 'Spinosad 45SC', qty: 2, expiry: day(-30) } },
  });
  assert.equal(stockOf(state, rulesModule.catalogueEntry('Spinosad'), { today: TODAY }).expiredOnly, true);

  const verdict = checkPlan(state, { active: 'Spinosad', cycleId: 'c1' }, { today: TODAY });
  assert.equal(verdict.ok, false);
  assert.match(whys(verdict), /past its expiry date/);
});

test('a catalogue product in stock, with a rate and a confirmed diagnosis, passes', () => {
  const verdict = checkPlan(farm(), { active: 'Spinosad', cycleId: 'c1' }, { today: TODAY });

  assert.equal(verdict.ok, true, whys(verdict));
  assert.equal(verdict.entry.group, 'IRAC 5');
  assert.equal(verdict.dose.amounts[0].text, '4.8 ml in 16 L');
});

test('FR-DOC-08: the whole plan refuses to name anything when the rules have not loaded', () => {
  const verdict = checkPlan(farm(), { active: 'Spinosad', cycleId: 'c1' }, { today: TODAY, rules: null });

  assert.equal(verdict.ok, false);
  assert.deepEqual(limitsHit(verdict), ['catalogue']);
  assert.match(whys(verdict), /rules file has not loaded/);
});

test('the catalogue comes from the rules file itself, not from a second copy', async () => {
  // CLAUDE.md: rules/douvalue_rules_rev5_1.json is the source of truth and both
  // web/ and server/ read it from there. This is the test that would fail the
  // day somebody pastes a copy of the catalogue into the app.
  const { existsSync, readFileSync: read } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const loaded = await rulesModule.loadRules(async (url) => {
    const path = fileURLToPath(url);
    if (!existsSync(path)) return { ok: false };
    return { ok: true, json: async () => JSON.parse(read(path, 'utf8')) };
  });

  assert.ok(loaded, 'the loader found the repository\'s own rules file');
  assert.equal(rulesModule.rulesVersion(loaded), RULES.meta.version);
  assert.equal(rulesModule.catalogue(loaded).length, RULES.active_ingredients.length);
});

test('FR-STOCK-09: a banned active never appears in the catalogue at all', () => {
  const names = rulesModule.catalogue(RULES).map((a) => a.ai.toLowerCase());
  assert.ok(!names.some((n) => n.includes('carbofuran')));
  assert.ok(!names.some((n) => n.includes('furadan')));
});

// ===========================================================================
// FR-DOC-08, limit 5 — never invents a dose
// ===========================================================================

test('FR-DOC-08: an active with no schedule rate and no label cannot be dosed', () => {
  // Abamectin is in the catalogue, in the rules' own thrips programme and on
  // the shelf. It still cannot be used, because nobody has entered a rate.
  const verdict = checkPlan(farm(), { active: 'Abamectin', cycleId: 'c1' }, { today: TODAY });

  assert.equal(verdict.ok, false);
  assert.deepEqual(limitsHit(verdict), ['dose']);
  assert.match(whys(verdict), /no usable rate/);
});

test('FR-STOCK-06: entering the label rate is what unlocks it', () => {
  const verdict = checkPlan(farm(),
    { active: 'Abamectin', cycleId: 'c1', labelRate: '0.5 ml/L' }, { today: TODAY });

  assert.equal(verdict.ok, true, whys(verdict));
  assert.equal(verdict.dose.source, 'label entered by the Farm Manager');
  assert.equal(verdict.dose.amounts[0].text, '8 ml in 16 L');
});

test('FR-DOC-08: prose where a number should be does not become a dose', () => {
  // Two catalogue entries say "per label" and "see prep table". Both are the
  // rules being honest that they hold no number, and neither may be guessed at.
  assert.equal(parseRate('per label'), null);
  assert.equal(parseRate('see prep table'), null);
  assert.equal(parseRate(''), null);

  const refused = doseFor(rulesModule.catalogueEntry('Bacillus subtilis'), {});
  assert.equal(refused.ok, false);
  assert.equal(refused.limit, 'dose');
});

test('FR-DOC-05: the dose calculator covers the knapsack and both tanks', () => {
  const dose = doseFor(rulesModule.catalogueEntry('Mancozeb'), {});
  assert.equal(dose.ok, true);
  assert.deepEqual(dose.amounts.map((a) => a.text), ['40 g in 16 L', '1250 g in 500 L', '2500 g in 1000 L']);
});

test('a plan only ever offers products that passed every one of those checks', () => {
  const plan = treatmentPlan(farm(), { problemId: 'thrips', cycleId: 'c1', diagnosisId: 'd1', today: TODAY });

  assert.ok(plan.options.length, 'the farm has spinosad in stock');
  for (const option of plan.options) {
    assert.ok(option.dose.ok, `${option.entry.ai} was offered without a dose`);
    assert.ok(option.stock.qty > 0, `${option.entry.ai} was offered without stock`);
  }
  // Abamectin is in stock and named by the rules, and is still not offered.
  const abamectin = plan.rejected.find((r) => r.active.id === 'abamectin');
  assert.ok(abamectin, 'abamectin should appear with its reason, not silently vanish');
  assert.equal(abamectin.violations[0].limit, 'dose');
});

// ===========================================================================
// FR-DOC-08, limit 6 — never a virus or a bacterial disease from a photo
// ===========================================================================

test('FR-DOC-08: a photo review claiming a confirmed virus is filed as a suspicion', () => {
  const reply = {
    confidence: 'high',
    confirmed: true,                       // what the far end said
    candidates: [{ problemId: 'pvmv', confidence: 'high', why: 'Vein mottle and distortion' }],
    text: 'This is confirmed pepper veinal mottle virus.',
  };
  const review = normalisePhotoReview(reply, { state: farm(), cycleId: 'c1', zoneId: 'gh1', today: TODAY });

  assert.equal(review.confirmed, false);
  assert.equal(review.photoAlone, true);
  assert.equal(review.limit, 'photo');
  assert.match(review.limitRule, /never confirms a virus/i);
  // FR-DOC-09 rides along: a suspected virus means a sample and the Owner.
  assert.equal(review.labAdvice.needed, true);
  assert.equal(review.notifyOwner, true);
});

test('FR-DOC-08: the same holds for a bacterial disease', () => {
  const review = normalisePhotoReview(
    { confidence: 'high', candidates: [{ problemId: 'bacterial_wilt', confidence: 'high' }] },
    { state: farm(), cycleId: 'c1', today: TODAY },
  );

  assert.equal(review.confirmed, false);
  assert.equal(review.photoAlone, true);
  assert.ok(review.confirmTest.length, 'it must name the test that would settle it');
  assert.match(review.confirmTest.join(' '), /streaming test|water/i);
});

test('FR-DOC-08: a fungal reading is still unconfirmed, but not flagged as photo-only', () => {
  const review = normalisePhotoReview(
    { confidence: 'medium', candidates: [{ problemId: 'anthracnose', confidence: 'medium' }] },
    { state: farm(), cycleId: 'c1', today: TODAY },
  );

  assert.equal(review.confirmed, false, 'a person confirms every diagnosis, FR-DIAG-03');
  assert.equal(review.photoAlone, false);
  assert.equal(review.limit, null);
});

test('FR-DOC-08: products named in a photo reply go through the catalogue and store checks', () => {
  const review = normalisePhotoReview(
    { confidence: 'medium', candidates: [{ problemId: 'thrips', confidence: 'medium' }],
      actives: ['Carbofuran', 'Lion Seal', 'Spinosad'] },
    { state: farm(), cycleId: 'c1', today: TODAY },
  );

  const droppedNames = review.droppedActives.map((d) => d.name);
  assert.ok(droppedNames.includes('Carbofuran'), 'banned');
  assert.ok(droppedNames.includes('Lion Seal'), 'not in the catalogue');
  for (const dropped of review.droppedActives) {
    assert.ok(dropped.violations.length, `${dropped.name} was dropped with no reason recorded`);
  }
});

test('an unrecognised confidence word is read as low, never as high', () => {
  const review = normalisePhotoReview({ confidence: 'very high', candidates: [] },
    { state: farm(), today: TODAY });
  assert.equal(review.confidence, 'low');
  assert.equal(CONFIDENCE[review.confidence].rank, 1);
});

// ===========================================================================
// FR-DOC-03 — online photo review, offline guided flow
// ===========================================================================

test('FR-DOC-03: offline, photo review falls back to the guided flow and says what still works', () => {
  const request = photoReviewRequest({ photos: ['data:image/jpeg;base64,x'], cycleId: 'c1', online: false });

  assert.equal(request.mode, 'offline');
  assert.match(request.fix, /guided diagnosis/i);
  assert.ok(request.stillWorks.includes('Dose calculator'));
  assert.ok(request.stillWorks.includes('Plan checks'));
  assert.equal(request.queuedPhotos, 1);
});

test('FR-DOC-03: online, the request carries the photos and the limits it must be answered under', () => {
  const request = photoReviewRequest({
    photos: ['data:image/jpeg;base64,x', 'data:image/jpeg;base64,y'],
    cycleId: 'c1', zoneId: 'gh1', problemShortlist: [{ id: 'thrips' }], online: true, today: TODAY,
  });

  assert.equal(request.mode, 'online');
  assert.equal(request.payload.photos.length, 2);
  assert.deepEqual(request.payload.shortlist, [{ id: 'thrips', name: 'Thrips' }]);
  assert.ok(request.payload.limits.some((l) => /virus/i.test(l)));
});

test('FR-DOC-03: with no photos there is nothing to review', () => {
  assert.equal(photoReviewRequest({ photos: [], online: true }).ok, false);
});

test('FR-DOC-10: a photo review is saved with what it read and how sure it was', () => {
  const review = normalisePhotoReview(
    { confidence: 'medium', candidates: [{ problemId: 'thrips', confidence: 'medium' }] },
    { state: farm(), cycleId: 'c1', zoneId: 'gh1', photos: ['a', 'b'], today: TODAY },
  );

  assert.equal(review.by, DOCTOR.id);
  assert.equal(review.confidence, 'medium');
  assert.equal(review.confirmedBy, null);
  assert.equal(review.rulesVersion, RULES.meta.version);
  assert.match(review.read.map((r) => r.what).join(' '), /2 photo/);
});

// ===========================================================================
// FR-DOC-06 — Gate 0, 1 and 4 evidence
// ===========================================================================

test('FR-DOC-06: an untested zone is told exactly what Gate 0 is missing', () => {
  const review = gateEvidence(farm(), { zoneId: 'gh1', cycleId: 'c1', today: TODAY });
  const g0 = review.gates.find((g) => g.id === 'G0');

  assert.equal(g0.name, 'Ground Clearance');
  assert.equal(g0.complete, false);
  assert.deepEqual(g0.missing.map((m) => m.id), ['lab_report', 'ph_three_point', 'doctor_check']);
  for (const missing of g0.missing) {
    assert.ok(missing.fix, `${missing.id} says nothing about how to fix it`);
    // The wording is the rules' own, not a second copy written here.
    assert.ok(RULES.gates.find((g) => g.id === 'G0').pass_all.includes(missing.label));
  }
});

test('FR-DOC-06: a clean nematode result with no lab named is not a lab report', () => {
  const state = farm({
    // Dated before transplant: Gate 0 asks whether this ground was cleared
    // before the crop went in, not whether it was tested afterwards.
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-50), ph: 6.2, points: 3,
      photo: 'data:image/jpeg;base64,x', nematode: 'clean' }],
  });
  const g0 = gateEvidence(state, { zoneId: 'gh1', today: TODAY }).gates.find((g) => g.id === 'G0');

  const lab = g0.items.find((i) => i.id === 'lab_report');
  assert.equal(lab.state, 'missing');
  assert.match(lab.why, /does not name the lab/);
  // The pH line, which has its three points and its meter photo, is satisfied.
  assert.equal(g0.items.find((i) => i.id === 'ph_three_point').state, 'have');
});

test('FR-GATE-01: a pH reading from one point does not satisfy the three-point test', () => {
  const state = farm({
    soilTests: [{ id: 't1', zoneId: 'gh1', date: day(-50), ph: 6.2, points: 1,
      photo: 'x', nematode: 'clean', lab: 'Rivers Soil Lab' }],
  });
  const g0 = gateEvidence(state, { zoneId: 'gh1', today: TODAY }).gates.find((g) => g.id === 'G0');
  const ph = g0.items.find((i) => i.id === 'ph_three_point');

  assert.equal(ph.state, 'missing');
  assert.match(ph.why, /1 sampling point/);
});

test('FR-DOC-06: Gate 1 reads the store for thrips controls and the roster for cover', () => {
  const state = farm({
    positions: { p1: { id: 'p1', name: 'GH-01 hand', primaryZoneId: 'gh1', backupZoneId: 'gh2' } },
  });
  const g1 = gateEvidence(state, { zoneId: 'gh1', cycleId: 'c1', today: TODAY }).gates.find((g) => g.id === 'G1');

  assert.equal(g1.items.find((i) => i.id === 'inputs_on_site').state, 'have');
  assert.equal(g1.items.find((i) => i.id === 'scout_roster').state, 'have');
  // Traps, drip, spacing, SOPs, lime route and the seedling batch are nobody's yet.
  assert.ok(g1.missing.length >= 5);
});

test('FR-GATE-01/FR-DOC-06: an empty store means Gate 1 says so in the store\'s own terms', () => {
  const state = farm({ inputs: { i_man: { id: 'i_man', name: 'Mancozeb 80% WP', qty: 5 } } });
  const g1 = gateEvidence(state, { zoneId: 'gh1', today: TODAY }).gates.find((g) => g.id === 'G1');
  const inputs = g1.items.find((i) => i.id === 'inputs_on_site');

  assert.equal(inputs.state, 'missing');
  assert.match(inputs.why, /thrips programme/);
});

test('FR-DOC-06: traps are counted against the zone, not ticked off', () => {
  const state = farm({
    gateEvidence: [{ id: 'ev1', gate: 'G1', itemId: 'traps_installed', zoneId: 'gh1',
      date: day(-2), count: 20, note: 'Hung at plant height' }],
  });
  const g1 = gateEvidence(state, { zoneId: 'gh1', today: TODAY }).gates.find((g) => g.id === 'G1');
  const traps = g1.items.find((i) => i.id === 'traps_installed');

  // 300 m² at one trap per 6 m² is fifty traps, not twenty.
  assert.equal(traps.state, 'missing');
  assert.match(traps.why, /one per 6 m²/);
  assert.match(traps.fix, /30 more/);
});

test('FR-DOC-06: recorded evidence satisfies the lines that only a person can answer', () => {
  const state = farm({
    gateEvidence: [
      { id: 'ev1', gate: 'G1', itemId: 'drip_pressure', zoneId: 'gh1', date: day(-3), note: 'Pressure tested at 1.2 bar' },
      { id: 'ev2', gate: 'G4', itemId: 'root_inspection', zoneId: 'gh1', cycleId: 'c1', date: day(-1), note: 'Ten plants lifted, roots white and firm' },
    ],
  });
  const review = gateEvidence(state, { zoneId: 'gh1', cycleId: 'c1', today: TODAY });

  const drip = review.gates.find((g) => g.id === 'G1').items.find((i) => i.id === 'drip_pressure');
  assert.equal(drip.state, 'have');
  assert.match(drip.why, /Pressure tested/);

  const roots = review.gates.find((g) => g.id === 'G4').items.find((i) => i.id === 'root_inspection');
  assert.equal(roots.state, 'have');
});

test('FR-DOC-06: Gate 4 wants the cycle review document, and a draft nobody confirmed is not one', () => {
  const draft = draftCycleReview(farm(), 'c1', { today: TODAY });
  const state = farm({ doctorOutputs: [draft] });

  const g4 = gateEvidence(state, { zoneId: 'gh1', cycleId: 'c1', today: TODAY }).gates.find((g) => g.id === 'G4');
  const doc = g4.items.find((i) => i.id === 'cycle_review');
  assert.equal(doc.state, 'missing');
  assert.match(doc.why, /nobody has confirmed/);

  const confirmed = confirmOutput(draft, MANAGER).output;
  const g4b = gateEvidence(farm({ doctorOutputs: [confirmed] }), { zoneId: 'gh1', cycleId: 'c1', today: TODAY })
    .gates.find((g) => g.id === 'G4');
  assert.equal(g4b.items.find((i) => i.id === 'cycle_review').state, 'have');
});

test('FR-DOC-10: the gate check saves what it looked at', () => {
  const review = gateEvidence(farm(), { zoneId: 'gh1', cycleId: 'c1', today: TODAY });

  assert.equal(review.kind, 'gate-review');
  assert.equal(review.by, DOCTOR.id);
  assert.ok(review.read.some((r) => r.kind === 'soil-tests'));
  assert.ok(review.read.some((r) => r.kind === 'gate-evidence'));
  assert.ok(review.summary.includes('GH-01'));
});

// ===========================================================================
// FR-DOC-07 — the three-day check, and the Gate 4 review
// ===========================================================================

test('FR-DOC-07/FR-TREAT-05: every treatment gets a check task three days later', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-1), productName: 'Spinosad 45SC', targetProblem: 'thrips' }],
  });
  const due = missingFollowUps(state, { today: TODAY });

  assert.equal(due.length, 1);
  assert.equal(due[0].id, followUpTaskId('sp1'));
  assert.equal(due[0].due.slice(0, 10), day(-1 + FOLLOW_UP_DAYS));
  assert.equal(due[0].proof, true);
  assert.match(due[0].title, /GH-01/);
});

test('FR-TASK-01: the check task id is deterministic, so five phones make one task', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-1), productName: 'Spinosad 45SC' }],
  });
  const first = missingFollowUps(state, { today: TODAY })[0];
  const withTask = farm({ ...state, tasks: { [first.id]: { ...first, status: 'open' } } });

  assert.deepEqual(missingFollowUps(withTask, { today: TODAY }), [],
    'a check already on the board is not generated again');
  assert.deepEqual(missingFollowUps(state, { today: TODAY })[0], first, 'and it is the same task each time');
});

test('FR-DOC-07: the answer records whether it worked, with the counts either side', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-3), productName: 'Spinosad 45SC', targetProblem: 'thrips' }],
    scouts: [
      { id: 's1', cycleId: 'c1', pestId: 'thrips', date: day(-4), count: 22 },
      { id: 's2', cycleId: 'c1', pestId: 'thrips', date: day(-1), count: 6 },
    ],
  });
  const spray = state.sprays[0];
  const record = followUpRecord(state, { spray, worked: 'yes', person: SUPERVISOR, pestId: 'thrips', today: TODAY });

  assert.equal(record.kind, 'followup');
  assert.equal(record.worked, 'yes');
  assert.equal(record.counts.from, 22);
  assert.equal(record.counts.to, 6);
  assert.equal(record.counts.change, -73);
  assert.equal(record.observedBy, 'u_sup');
  assert.equal(record.confirmedBy, null);
  assert.ok(record.read.some((r) => r.kind === 'spray'));
});

test('FR-DOC-07: "it worked" against a rising count is flagged, not filed quietly', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-3), productName: 'Spinosad 45SC', targetProblem: 'thrips' }],
    scouts: [
      { id: 's1', cycleId: 'c1', pestId: 'thrips', date: day(-4), count: 10 },
      { id: 's2', cycleId: 'c1', pestId: 'thrips', date: day(-1), count: 18 },
    ],
  });
  const record = followUpRecord(state, { spray: state.sprays[0], worked: 'yes', person: HAND, pestId: 'thrips', today: TODAY });

  assert.equal(record.disagreesWithCounts, true);
  assert.match(record.nextStep, /Re-count/);
});

test('FR-DOC-07: a treatment that did nothing sends you back to the diagnosis, not to a second dose', () => {
  const state = farm({ sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-3), productName: 'Spinosad 45SC' }] });
  const record = followUpRecord(state, { spray: state.sprays[0], worked: 'no', person: MANAGER, today: TODAY });

  assert.match(record.nextStep, /Do not repeat the same product/);
  assert.match(record.nextStep, /Re-diagnose/);
});

test('FR-DOC-07: the board shows which checks are overdue', () => {
  const state = farm({
    sprays: [
      { id: 'sp1', cycleId: 'c1', date: day(-10), productName: 'Mancozeb 80% WP' },
      { id: 'sp2', cycleId: 'c1', date: day(-1), productName: 'Spinosad 45SC' },
    ],
  });
  const board = followUpBoard(state, { today: TODAY });
  const late = board.find((b) => b.spray.id === 'sp1');

  assert.equal(late.overdue, true);
  assert.equal(late.daysLate, 7);
  assert.equal(board.find((b) => b.spray.id === 'sp2').overdue, false);
});

test('FR-DOC-07: the Gate 4 review is drafted from the season\'s own records, as a draft', () => {
  const state = farm({
    harvests: [
      { id: 'h1', cycleId: 'c1', kg: 120, date: day(-14) },
      { id: 'h2', cycleId: 'c1', kg: 180, date: day(-7) },
    ],
    sprays: [
      { id: 'sp1', cycleId: 'c1', date: day(-20), productName: 'Spinosad 45SC' },
      { id: 'sp2', cycleId: 'c1', date: day(-10), productName: 'Mancozeb 80% WP' },
    ],
    scouts: [{ id: 's1', cycleId: 'c1', pestId: 'thrips', date: day(-21), count: 14 }],
  });
  const review = draftCycleReview(state, 'c1', { today: TODAY });

  assert.equal(review.kind, 'cycle-review');
  assert.equal(review.status, 'draft');
  assert.equal(review.clears, false);
  assert.equal(review.confirmedBy, null);
  assert.equal(review.totals.kg, 300);

  const headings = review.sections.map((s) => s.id);
  assert.deepEqual(headings, ['what', 'yield', 'problems', 'treatments', 'roots', 'next']);

  const yieldLines = review.sections.find((s) => s.id === 'yield').lines.join(' ');
  assert.match(yieldLines, /300 kg/);
  assert.match(yieldLines, /0\.33 kg per plant/);

  // Two treatments and nobody answered either three-day check.
  assert.match(review.sections.find((s) => s.id === 'treatments').lines.join(' '), /never checked/);
  // The root reading comes straight out of the rules.
  assert.match(review.sections.find((s) => s.id === 'roots').lines.join(' '), /galls/);
});

test('FR-DOC-07: a cycle with nothing recorded says so rather than inventing a season', () => {
  const review = draftCycleReview(farm({ diagnoses: [] }), 'c1', { today: TODAY });
  assert.match(review.sections.find((s) => s.id === 'yield').lines.join(' '), /Nothing was picked/);
  assert.match(review.sections.find((s) => s.id === 'problems').lines.join(' '), /No diagnosis was recorded/);
});

// ===========================================================================
// FR-DOC-09 / FR-DIAG-05 — the lab, and the Owner
// ===========================================================================

test('FR-DOC-09: a suspected virus recommends a lab sample and notifies the Owner', () => {
  const advice = labAdvice(farm(), { problemId: 'pvmv', confidence: 'medium', cycleId: 'c1', zoneId: 'gh1', today: TODAY });

  assert.equal(advice.needed, true);
  assert.equal(advice.notifyOwner, true);
  assert.match(advice.reasons.join(' '), /virus cannot be told from a photo/i);
  assert.equal(advice.sample.status, 'recommended');
  assert.equal(advice.sample.requestedOn, TODAY);
});

test('FR-DOC-09: bacterial wilt and nematodes do the same', () => {
  assert.equal(labAdvice(farm(), { problemId: 'bacterial_wilt', cycleId: 'c1', today: TODAY }).needed, true);

  const nematode = labAdvice(farm(), { problemId: 'root_knot_nematode', cycleId: 'c1', today: TODAY });
  assert.equal(nematode.needed, true);
  assert.match(nematode.reasons.join(' '), /Gate 0/);
});

test('FR-DOC-09: a second low-confidence reading on the same problem sends a sample', () => {
  const first = labAdvice(farm(), { problemId: 'anthracnose', confidence: 'low', cycleId: 'c1', today: TODAY });
  assert.equal(first.needed, false, 'one low reading is a reason to look again, not to post a sample');

  const state = farm({
    doctorOutputs: [doctorOutput({ kind: 'photo', subject: { problemId: 'anthracnose', cycleId: 'c1' }, confidence: 'low' })],
  });
  const second = labAdvice(state, { problemId: 'anthracnose', confidence: 'low', cycleId: 'c1', today: TODAY });

  assert.equal(second.needed, true);
  assert.equal(second.notifyOwner, true);
  assert.match(second.reasons.join(' '), /second low-confidence/);
});

test('a confident fungal reading needs no lab and no Owner interrupt', () => {
  const advice = labAdvice(farm(), { problemId: 'anthracnose', confidence: 'high', cycleId: 'c1', today: TODAY });
  assert.equal(advice.needed, false);
  assert.equal(advice.notifyOwner, false);
  assert.equal(advice.sample, null);
});

test('FR-DIAG-05: a sample is tracked from recommendation to result', () => {
  const events = [
    { id: 'e1', type: 'lab.record', at: `${day(-20)}T09:00:00Z`, by: 'u_mgr',
      payload: { id: 'lab1', problemId: 'pvmv', cycleId: 'c1', zoneId: 'gh1', requestedOn: day(-20),
        reason: 'Suspected tospovirus' } },
    { id: 'e2', type: 'lab.send', at: `${day(-18)}T10:00:00Z`, by: 'u_mgr',
      payload: { id: 'lab1', lab: 'NRCRI Umudike', sentDate: day(-18) } },
    { id: 'e3', type: 'lab.result', at: `${day(-4)}T14:00:00Z`, by: 'u_mgr',
      payload: { id: 'lab1', result: 'Tospovirus positive', resultDate: day(-4) } },
  ];
  const state = reduce(events);
  const sample = labSamples(state)[0];

  assert.equal(sample.lab, 'NRCRI Umudike');
  assert.equal(sample.sentDate, day(-18));
  assert.equal(sample.result, 'Tospovirus positive');
  assert.equal(sample.resultDate, day(-4));
  assert.equal(sample.status, 'returned');
  assert.deepEqual(openLabSamples(state), []);
});

test('FR-DOC-09: a sample sent and never answered reaches the Owner', () => {
  const state = farm({
    labSamples: [{ id: 'lab1', problemId: 'pvmv', lab: 'NRCRI Umudike', sentDate: day(-20), result: null }],
  });
  const owed = ownerNotifications(state, { today: TODAY });

  assert.equal(owed.length, 1);
  assert.equal(owed[0].kind, 'lab');
  assert.match(owed[0].why, /20 days with no result/);
});

test('FR-DOC-09: an output marked for the Owner stays on their list until they have seen it', () => {
  const flagged = { ...doctorOutput({ kind: 'photo', subject: { cycleId: 'c1' }, confidence: 'low', notifyOwner: true }), id: 'fd1' };
  assert.equal(ownerNotifications(farm({ doctorOutputs: [flagged] })).length, 1);
  assert.equal(ownerNotifications(farm({ doctorOutputs: [{ ...flagged, ownerSeenAt: `${TODAY}T08:00:00Z` }] })).length, 0);
});

test('FR-DOC-09/FR-REP-01: what the Owner is owed reaches the digest, not just a screen', () => {
  const state = farm({
    doctorOutputs: [{
      ...doctorOutput({ kind: 'photo', subject: { cycleId: 'c1', problemId: 'pvmv' },
        confidence: 'medium', notifyOwner: true,
        summary: 'Photo review points at Pepper veinal mottle virus, medium confidence.' }),
      id: 'fd1',
      lab: { reason: 'A virus cannot be told from a photo.' },
    }],
  });
  const lines = exceptions(state, { now: `${TODAY}T18:00:00Z` });
  const doctorLine = lines.find((l) => l.line.startsWith('Farm Doctor:'));

  assert.ok(doctorLine, 'the Owner is told in the digest, which is the thing that arrives');
  assert.equal(doctorLine.severity, 'critical');
  assert.match(doctorLine.detail, /sample should go off/);
});

test('FR-REP-01: a quiet day stays quiet', () => {
  const lines = exceptions(farm(), { now: `${TODAY}T18:00:00Z` });
  assert.equal(lines.filter((l) => l.line.startsWith('Farm Doctor:')).length, 0);
});

// ===========================================================================
// FR-DOC-10 — every output saved, and FR-DOC-11 — one entry point
// ===========================================================================

test('FR-DOC-10: every kind of output carries what it read, its confidence and who confirmed it', () => {
  const state = farm({ sprays: [{ id: 'sp1', cycleId: 'c1', date: day(-3), productName: 'Spinosad 45SC' }] });
  const outputs = [
    treatmentPlan(state, { problemId: 'thrips', cycleId: 'c1', diagnosisId: 'd1', today: TODAY }),
    gateEvidence(state, { zoneId: 'gh1', cycleId: 'c1', today: TODAY }),
    draftCycleReview(state, 'c1', { today: TODAY }),
    followUpRecord(state, { spray: state.sprays[0], worked: 'partly', person: SUPERVISOR, today: TODAY }),
    normalisePhotoReview({ confidence: 'high', candidates: [{ problemId: 'thrips' }] },
      { state, cycleId: 'c1', today: TODAY }),
  ];

  for (const output of outputs) {
    assert.ok(output.id, 'every output has an id');
    assert.equal(output.by, DOCTOR.id);
    assert.ok(Array.isArray(output.read) && output.read.length, `${output.kind} recorded nothing it read`);
    assert.ok(CONFIDENCE[output.confidence], `${output.kind} has no confidence`);
    assert.equal(output.confirmedBy, null, `${output.kind} arrived pre-confirmed`);
    assert.equal(output.clears, false);
    assert.equal(output.rulesVersion, RULES.meta.version);
  }
});

test('FR-DOC-10: outputs waiting on a person are listed for them', () => {
  const state = farm({
    doctorOutputs: [
      { ...doctorOutput({ kind: 'photo', confidence: 'medium' }), id: 'a', at: `${day(-1)}T09:00:00Z` },
      { ...doctorOutput({ kind: 'plan', confidence: 'high' }), id: 'b', at: `${TODAY}T09:00:00Z`, confirmedBy: 'u_sup' },
      { ...doctorOutput({ kind: 'followup', confidence: 'low' }), id: 'c', at: `${TODAY}T10:00:00Z` },
    ],
  });

  assert.deepEqual(awaitingConfirmation(state).map((o) => o.id), ['a']);
  assert.equal(doctorRecords(state).length, 3);
  assert.equal(doctorRecords(state, { kind: 'plan' }).length, 1);
});

test('FR-DOC-11: the Farm Doctor and the adviser share one entry point', () => {
  const app = readFileSync(new URL('app.js', base), 'utf8');

  // Both addresses land on the same screen, so nobody has to choose between
  // "ask the adviser" and "ask the Doctor" before knowing which they need.
  assert.match(app, /registerRoute\('#\/doctor', doctorView\)/);
  assert.match(app, /registerRoute\('#\/adviser', doctorView\)/);
});

// ===========================================================================
// The server holds the same line
// ===========================================================================

test('the server knows the Farm Doctor record types and who may file them', () => {
  assert.equal(core.EVENT_POLICY['doctor.record'].write, 'diagnose');
  assert.equal(core.EVENT_POLICY['doctor.confirm'].write, 'verifyHarvest');
  assert.equal(core.EVENT_POLICY['doctor.approve'].write, 'prescribe');
  assert.equal(core.EVENT_POLICY['gate.evidence'].write, 'scout');
  assert.equal(core.EVENT_POLICY['lab.record'].write, 'scout');
});

test('FR-DOC-08: the server refuses a confirmation filed under the Farm Doctor\'s name', () => {
  const guard = core.EVENT_POLICY['doctor.confirm'].guard;
  assert.equal(guard({ type: 'doctor.confirm', payload: { id: 'fd1' } }, { id: 'farm-doctor', role: 'manager' }).ok, false);
  assert.equal(guard({ type: 'doctor.confirm', payload: { id: 'fd1' } }, { id: 'u_sup', role: 'supervisor' }).ok, true);
});

test('FR-DIAG-05: a lab result must say which lab and what came back', () => {
  const guard = core.EVENT_POLICY['lab.result'].guard;
  assert.equal(guard({ type: 'lab.result', payload: { id: 'lab1' } }, MANAGER).ok, false);
  assert.equal(guard({ type: 'lab.result', payload: { id: 'lab1', result: 'Tospovirus positive' } }, MANAGER).ok, true);
});
