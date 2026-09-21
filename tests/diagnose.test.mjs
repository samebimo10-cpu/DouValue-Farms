// The Farm Doctor's diagnosis engine, tested against the rules JSON itself.
//
// Requirements under test: FR-DIAG-01 (the 23 triage rows and 22 cards are the
// diagnosis), FR-DIAG-02 (a diagnosis records card, answers, photos, reasoning
// and who confirmed it), FR-DIAG-03 (only a senior confirms), FR-DOC-01
// (photos and the confirm step before a cause is named), FR-DOC-02 (look-alikes
// and the test that separates them), FR-DOC-08 (the Farm Doctor never confirms
// its own answer).
//
// Nothing here hard-codes a pest: the expectations are read from
// rules/douvalue_rules_rev5_1.json and from the engine's own output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const dx = await load('domain/diagnose.js');
const store = await load('store.js');
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const RULES = JSON.parse(await readFile(
  new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8',
));

// --- FR-DIAG-01: the rules ARE the engine --------------------------------

test('the engine loads every triage row and every card from the rules', () => {
  assert.equal(dx.TRIAGE.length, RULES.triage.length);
  assert.equal(dx.TRIAGE.length, 23, 'requirements v1.5 says 23 triage rows');
  assert.equal(dx.CARDS.length, RULES.diagnosis_cards.length);
  assert.equal(dx.CARDS.length, 22, 'requirements v1.5 says 22 diagnosis cards');
  assert.equal(dx.RULES_VERSION, RULES.meta.version);
});

test('every card is reachable from at least one triage row', () => {
  for (const card of dx.CARDS) {
    const rows = dx.rowsForCard(card.id);
    assert.ok(rows.length >= 1, `${card.id} is not reachable from any triage row`);
    for (const row of rows) {
      assert.ok(row.confirm, `row ${row.n} reaching ${card.id} has no confirm test`);
      assert.ok(row.firstAction, `row ${row.n} reaching ${card.id} has no first action`);
    }
  }
});

test('every triage row reaches a card', () => {
  for (const row of dx.TRIAGE) {
    assert.ok(row.cardId, `row ${row.n} ("${row.likely}") reaches no card`);
    assert.ok(dx.CARD_BY_ID[row.cardId], `row ${row.n} points at a card that is not in the rules`);
  }
});

test('the six problems the old engine had no entry for now exist', () => {
  // These are cards the rules carry that the local field guide never had.
  for (const id of ['helicoverpa', 'cutworm', 'botrytis', 'tospovirus', 'mosaic_virus', 'boron_deficiency']) {
    const card = dx.CARD_BY_ID[id];
    assert.ok(card, `${id} is missing from the cards`);
    assert.ok(card.cause && card.detection && card.treatment, `${id} is not a complete card`);
    assert.ok(dx.rowsForCard(id).length, `${id} cannot be reached from the triage table`);
  }
});

// --- Symptom -> triage row -> card ---------------------------------------

const pathTo = (words) => dx.matchTriage(words);

test('"stunted plants, no galls" reaches the acid-soil card, not nematode', () => {
  const match = pathTo('stunted plants, no galls');
  const best = match.rows[0];
  assert.equal(best.card.id, 'acid_soil');
  assert.equal(best.row.n, 23);
  // The denial is what does it: the same words without "no" go the other way.
  const nematode = match.rows.find((r) => r.card.id === 'root_knot_nematode');
  assert.ok(nematode, 'nematode is still offered as the look-alike');
  assert.ok(nematode.contradicted.some((c) => c.term === 'gall'),
    'the absent galls are recorded as arguing against nematode');
  assert.ok(best.score > nematode.score);
});

test('galls on the roots reach the nematode card instead', () => {
  const best = pathTo('roots knotted with galls, stunted and starved').rows[0];
  assert.equal(best.card.id, 'root_knot_nematode');
});

test('"ring patterns on leaves" reaches tospovirus', () => {
  const match = pathTo('ring patterns on leaves');
  assert.equal(match.rows[0].card.id, 'tospovirus');
  assert.equal(match.rows[0].row.n, 6);
});

test('the milky ooze reaches bacterial wilt', () => {
  const best = pathTo('rapid wilt, leaves still green, stem base oozes').rows[0];
  assert.equal(best.card.id, 'bacterial_wilt');
});

test('nothing said means nothing claimed', () => {
  const match = dx.matchTriage('');
  assert.equal(match.rows.length, 0);
  assert.equal(match.separator, null);
});

test('words the rules do not use are reported rather than silently dropped', () => {
  const match = dx.matchTriage('the tractor will not start');
  assert.ok(match.unmatched.length, 'it says which words it could not place');
  assert.equal(match.rows.length, 0);
});

test('a match shows what it looked at', () => {
  const best = pathTo('silvery flecks on leaves and tips').rows[0];
  assert.equal(best.card.id, 'thrips');
  assert.ok(best.matched.length >= 2, 'it lists the words that carried the match');
  assert.ok(best.confidence.label);
});

// --- FR-DOC-02: look-alikes and the test that separates them -------------

const PAIRS = [
  // [a, b, a word that must appear in the separating test]
  ['root_knot_nematode', 'acid_soil', 'root'],
  ['fusarium_wilt', 'bacterial_wilt', 'water'],
  ['thrips', 'broad_mite', 'loupe'],
];

test('the named look-alike pairs each know they look alike', () => {
  for (const [a, b] of PAIRS) {
    const forward = dx.lookalikesFor(a).map((l) => l.cardId);
    const back = dx.lookalikesFor(b).map((l) => l.cardId);
    assert.ok(forward.includes(b), `${b} is not listed as a look-alike of ${a}`);
    assert.ok(back.includes(a), `${a} is not listed as a look-alike of ${b}`);
  }
});

test('each look-alike pair routes to its separating test', () => {
  for (const [a, b, word] of PAIRS) {
    const sep = dx.separatingSymptom(a, b);
    assert.ok(sep, `${a} vs ${b} has no separating test`);
    assert.match(sep.test.toLowerCase(), new RegExp(word),
      `${a} vs ${b} did not route to the test that mentions "${word}"`);
    // Both readings are named, and each says which cause it points at.
    const targets = sep.tests.map((t) => t.points_to.id).sort();
    assert.deepEqual(targets, [a, b].sort());
    // Every test it names is a test the rules name.
    for (const t of sep.tests) {
      const fromRules = t.from === 'root_read'
        ? t.test.startsWith(dx.ROOT_READ.test)
        : RULES.triage.some((r) => r.confirm === t.test);
      assert.ok(fromRules, `"${t.test}" is not a test the rules name`);
    }
  }
});

test('nematode against acid soil is settled by the rules\' own root read', () => {
  const sep = dx.separatingSymptom('root_knot_nematode', 'acid_soil');
  assert.equal(sep.kind, 'root_read');
  assert.equal(sep.when, RULES.root_read.when);
  assert.equal(sep.discriminator.term, 'gall', 'galls are the whole difference');
  const readings = Object.fromEntries(sep.readings.map((r) => [r.sign, r.cardId]));
  assert.equal(readings['red/brown galls'], 'root_knot_nematode');
  assert.equal(readings['stubby, thickened, dead-tipped, no galls'], 'acid_soil');
  // "water only" and "rot" name no card in the rules, and are not forced onto one.
  assert.equal(readings['white firm'], null);
  assert.equal(readings['brown slimy'], null);
});

test('Fusarium against bacterial wilt routes to the water test', () => {
  const sep = dx.separatingSymptom('fusarium_wilt', 'bacterial_wilt');
  assert.equal(sep.kind, 'confirm_test');
  assert.equal(sep.points_to.id, 'bacterial_wilt');
  assert.equal(sep.away_from.id, 'fusarium_wilt');
  assert.equal(sep.test, RULES.triage.find((r) => r.likely === 'bacterial_wilt').confirm);
  assert.equal(sep.tests[1].test, RULES.triage.find((r) => r.likely === 'fusarium_wilt').confirm);
});

test('thrips against broad mite routes to the loupe, and names the visible insect', () => {
  const sep = dx.separatingSymptom('thrips', 'broad_mite');
  assert.equal(sep.points_to.id, 'broad_mite');
  assert.equal(sep.test, RULES.triage.find((r) => r.likely === 'broad_mite').confirm);
  assert.equal(sep.discriminator.term, 'insect');
  assert.equal(sep.discriminator.denied_by, 'broad_mite');
});

test('a close call offers the separating test unprompted', () => {
  const match = dx.matchTriage('plant wilting and starved');
  if (match.rows.length > 1 && match.rows[0].score - match.rows[1].score < 0.3) {
    assert.ok(match.separator, 'two close candidates and no test to tell them apart');
    assert.ok(match.separator.test);
  }
});

test('separating a card from itself is not a test', () => {
  assert.equal(dx.separatingSymptom('thrips', 'thrips'), null);
  assert.equal(dx.separatingSymptom([]), null);
});

// --- FR-DOC-01: photos and the confirm step before a cause is named ------

const fullDraft = () => ({
  triageRow: 23,
  photos: [{ dataUrl: 'data:image/jpeg;base64,xx', fresh: true }],
  confirmTest: 'Three-point pH test (below 5.5)',
  confirmResult: 'pH 5.1 on all three points',
  reasoning: 'Stunted and purple, roots stubby with dead tips and no galls.',
});

test('no cause is named without a photo', () => {
  const draft = { ...fullDraft(), photos: [] };
  const out = dx.nameCause(draft);
  assert.equal(out.ok, false);
  assert.equal(out.card, null, 'it must not name the cause');
  assert.ok(out.missing.some((m) => m.id === 'photos'));
  // It still says what to go and do.
  assert.equal(out.confirmTest, RULES.triage.find((r) => r.n === 23).confirm);
});

test('no cause is named without the confirm step', () => {
  for (const field of ['confirmTest', 'confirmResult']) {
    const draft = { ...fullDraft(), [field]: '' };
    const out = dx.nameCause(draft);
    assert.equal(out.ok, false, `${field} missing should block naming`);
    assert.equal(out.card, null);
    assert.ok(out.missing.some((m) => m.id === field));
  }
});

test('with the photos and the confirm step, the card is named', () => {
  const out = dx.nameCause(fullDraft());
  assert.equal(out.ok, true);
  assert.equal(out.card.id, 'acid_soil');
  assert.equal(out.row.n, 23);
  assert.ok(out.lookalikes.length, 'it names the look-alikes too');
  assert.ok(out.separator, 'and the test that separates the closest one');
  assert.equal(out.rulesVersion, RULES.meta.version);
});

test('the rules decide when a lab has to settle it', () => {
  // The rules list virus, bacterial wilt and nematodes; every one of those is
  // read off farm_doctor.lab_required_for, not off a list kept in the code.
  assert.ok(dx.labRecommendedFor('tospovirus'));
  assert.ok(dx.labRecommendedFor('bacterial_wilt'));
  assert.ok(dx.labRecommendedFor('root_knot_nematode'));
  assert.equal(dx.labRecommendedFor('sunscald_cracking'), false);
});

// --- FR-DIAG-02 / FR-DIAG-03: what a diagnosis records, and who signs it --

const recorded = (over = {}) => ({
  id: 'dx1',
  engine: dx.RULES_VERSION,
  cardId: 'acid_soil',
  triageRow: 23,
  by: 'u_hand',
  date: '2026-09-21',
  ...fullDraft(),
  ...over,
});

test('a diagnosis records the card, the answers, the photos, the reasoning and the person', () => {
  const read = dx.readDiagnosis(recorded());
  assert.equal(read.cardId, 'acid_soil');
  assert.equal(read.card.name, 'Acid soil');
  assert.equal(read.legacy, false);
  assert.equal(read.mapping, 'rules');
  assert.ok(read.photos.length);
  assert.ok(read.reasoning);
  assert.ok(read.confirmTest && read.confirmResult);
  assert.equal(read.confirmed, false, 'nobody has confirmed it yet');
});

test('no diagnosis can be confirmed without the confirm step', () => {
  for (const gap of [{ confirmTest: '' }, { confirmResult: '' }, { photos: [] }]) {
    const verdict = dx.canConfirm(recorded(gap), { by: 'u_sup', senior: true });
    assert.equal(verdict.ok, false, `${JSON.stringify(gap)} should not be confirmable`);
    assert.equal(verdict.reason, 'no-confirm-step');
  }
  assert.equal(dx.canConfirm(recorded(), { by: 'u_sup', senior: true }).ok, true);
});

test('nobody confirms their own diagnosis (FR-DIAG-03, FR-DOC-08)', () => {
  assert.equal(dx.canConfirm(recorded(), { by: 'u_hand', senior: true }).reason, 'self');
  assert.equal(dx.canConfirm(recorded(), { by: 'u_hand2', senior: false }).reason, 'rank');
});

test('the event log refuses a confirmation with no confirm step behind it', () => {
  const events = [
    { id: 'e1', type: 'diagnosis.record', at: '2026-09-21T08:00:00Z', by: 'u_hand',
      payload: { ...recorded(), photos: [], confirmTest: '', confirmResult: '' } },
    { id: 'e2', type: 'diagnosis.confirm', at: '2026-09-21T09:00:00Z', by: 'u_mgr',
      payload: { id: 'dx1', confirmTest: 'x', confirmResult: 'y' } },
  ];
  const state = store.reduce(events);
  assert.equal(state.diagnoses[0].confirmedBy, undefined, 'replay must not confirm it');
  assert.ok(state.diagnoses[0].confirmRefused, 'and it says why');
});

test('the event log accepts a confirmation that has the confirm step behind it', () => {
  const events = [
    { id: 'e1', type: 'diagnosis.record', at: '2026-09-21T08:00:00Z', by: 'u_hand', payload: recorded() },
    { id: 'e2', type: 'diagnosis.confirm', at: '2026-09-21T09:00:00Z', by: 'u_mgr',
      payload: { id: 'dx1', confirmTest: 'Three-point pH test', confirmResult: 'pH 5.1', note: 'Agreed' } },
  ];
  const state = store.reduce(events);
  assert.equal(state.diagnoses[0].confirmedBy, 'u_mgr');
  assert.equal(state.diagnoses[0].confirmNote, 'Agreed');
});

test('the server refuses a diagnosis with no photo and no confirm step', () => {
  const guard = core.EVENT_POLICY['diagnosis.record'].guard;
  assert.ok(guard, 'diagnosis.record is guarded');
  assert.equal(guard({ payload: recorded() }).ok, true);
  assert.equal(guard({ payload: { ...recorded(), photos: [] } }).ok, false);
  assert.equal(guard({ payload: { ...recorded(), confirmResult: '' } }).ok, false);
  assert.equal(guard({ payload: { ...recorded(), cardId: null } }).ok, false);
  assert.equal(guard({ payload: { ...recorded(), reasoning: 'hmm' } }).ok, false);
});

test('the server makes the confirmer say what the test showed', () => {
  const guard = core.EVENT_POLICY['diagnosis.confirm'].guard;
  assert.ok(guard, 'diagnosis.confirm is guarded');
  assert.equal(guard({ payload: { id: 'dx1', confirmTest: 'Cut the stem', confirmResult: 'milky' } }).ok, true);
  assert.equal(guard({ payload: { id: 'dx1' } }).ok, false);
  assert.equal(guard({ payload: { id: 'dx1', confirmTest: 'Cut the stem' } }).ok, false);
  // FR-DIAG-03 still holds: only a senior may write it at all.
  assert.equal(core.EVENT_POLICY['diagnosis.confirm'].write, 'verifyHarvest');
});

// --- Old records ---------------------------------------------------------

test('an old record whose name matches a card is read as that card, and still marked legacy', () => {
  const read = dx.readDiagnosis({ id: 'old1', problemId: 'phytophthora_blight', date: '2026-05-01' });
  assert.equal(read.cardId, 'phytophthora');
  assert.equal(read.legacy, true);
  assert.equal(read.mapping, 'mapped');
  assert.equal(read.label, 'Phytophthora');
});

test('an old record with no clear card is kept readable and marked legacy', () => {
  const read = dx.readDiagnosis({ id: 'old2', problemId: 'cercospora_leaf_spot', date: '2026-05-01' });
  assert.equal(read.cardId, null);
  assert.equal(read.legacy, true);
  assert.equal(read.mapping, 'legacy');
  assert.equal(read.label, 'Cercospora leaf spot (frog-eye)', 'the old name is not lost');
});

test('a legacy record cannot be confirmed through the new flow', () => {
  const verdict = dx.canConfirm({ id: 'old1', problemId: 'phytophthora_blight' }, { by: 'u_mgr' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'legacy');
  assert.ok(verdict.fix, 'it says what to do instead');
});

test('a confirmation already in the log stays confirmed', () => {
  // Rewriting history would make every past treatment look ungated.
  const events = [
    { id: 'e1', type: 'diagnosis.record', at: '2026-05-01T08:00:00Z', by: 'u_hand',
      payload: { id: 'old1', problemId: 'thrips', cycleId: 'c1', date: '2026-05-01' } },
    { id: 'e2', type: 'diagnosis.confirm', at: '2026-05-01T09:00:00Z', by: 'u_mgr', payload: { id: 'old1' } },
  ];
  const state = store.reduce(events);
  assert.equal(state.diagnoses[0].confirmedBy, 'u_mgr');
});

test('every mapped old id points at a card the rules really have', () => {
  for (const [problemId, cardId] of Object.entries(dx.LEGACY_CARD_MAP)) {
    assert.ok(dx.CARD_BY_ID[cardId], `${problemId} maps to ${cardId}, which is not a card`);
    assert.equal(dx.CARD_TO_PROBLEM[cardId], problemId, 'the reverse map agrees');
  }
});

test('a card is never resolved from a name that only half matches', () => {
  // "cercospora leaf spot" shares the word "spot" with the bacterial_spot card
  // and is a different disease. Half a match is no match.
  assert.equal(dx.cardFor('cercospora_leaf_spot'), null);
  assert.equal(dx.cardFor('choanephora_wet_rot'), null);
  assert.equal(dx.cardFor('waterlogging'), null);
  // What does resolve: a card id, a triage `likely` name, and a clear old id.
  assert.equal(dx.cardFor('thrips').id, 'thrips');
  assert.equal(dx.cardFor('sunscald').id, 'sunscald_cracking');
  assert.equal(dx.cardFor('fruit_cracking').id, 'sunscald_cracking');
  assert.equal(dx.cardFor('phytophthora_blight').id, 'phytophthora');
});

test('every triage row\'s likely name resolves to the card it reaches', () => {
  for (const row of dx.TRIAGE) {
    assert.equal(dx.cardFor(row.likely).id, row.cardId, `row ${row.n}`);
  }
});

// --- Reference photos (FR-DIAG-01, UX-11) --------------------------------
//
// FR-DIAG-01 asks for the triage rows and cards as guided questions "with
// reference photos". The pictures are the farm's, not the rules': the rules
// JSON is the source of truth and the app never writes to it. So the slots are
// derived from the rules and the pictures live in the farm's own event log.

test('there is one photo slot for every triage row and every card', () => {
  assert.equal(dx.PHOTO_SLOTS.length, RULES.triage.length + RULES.diagnosis_cards.length);
  assert.equal(dx.PHOTO_SLOTS.length, 45);
  for (const row of dx.TRIAGE) {
    assert.ok(dx.PHOTO_SLOT_BY_ID.has(dx.rowSlot(row.n)), `row ${row.n} has no slot`);
  }
  for (const card of dx.CARDS) {
    assert.ok(dx.PHOTO_SLOT_BY_ID.has(dx.cardSlot(card.id)), `${card.id} has no slot`);
  }
  // Each slot says where it belongs and what the picture is meant to show, so
  // whoever is holding the camera knows what to point it at.
  for (const slot of dx.PHOTO_SLOTS) {
    assert.ok(slot.where && slot.label && slot.shows, `${slot.slot} is not described`);
  }
});

test('a slot the rules do not have is not a slot', () => {
  assert.equal(dx.isPhotoSlot('card:thrips'), true);
  assert.equal(dx.isPhotoSlot('row:23'), true);
  assert.equal(dx.isPhotoSlot('row:99'), false);
  assert.equal(dx.isPhotoSlot('card:cercospora_leaf_spot'), false);
  assert.equal(dx.isPhotoSlot(''), false);
});

const shot = (bytes = 4000) => ({ dataUrl: 'data:image/jpeg;base64,abc', bytes });
const withPhotos = (held) => ({ people: {}, referencePhotos: held });

test('coverage counts the gaps, split into cards and rows', () => {
  const bare = dx.photoCoverage({});
  assert.equal(bare.total, 45);
  assert.equal(bare.have, 0);
  assert.equal(bare.cards.missing.length, 22);
  assert.equal(bare.rows.missing.length, 23);
  assert.equal(bare.percent, 0);

  const some = dx.photoCoverage(withPhotos({
    'card:thrips': { slot: 'card:thrips', photo: shot(5000) },
    'row:23': { slot: 'row:23', photo: shot(3000) },
  }));
  assert.equal(some.have, 2);
  assert.equal(some.cards.have, 1);
  assert.equal(some.rows.have, 1);
  assert.equal(some.missing.length, 43);
  assert.equal(some.bytes, 8000, 'it says what every phone has to carry');
  assert.ok(!some.cards.missing.some((m) => m.cardId === 'thrips'));
});

test('an empty slot leaves the tick-list exactly as it was', () => {
  const bare = dx.photoCues({});
  assert.equal(bare.length, dx.CUES.length);
  for (const cue of bare) {
    assert.equal(cue.photo, null);
    assert.ok(cue.text, 'the words are still there, which is what the engine matches on');
  }
  // And the words are what matching uses, photo or no photo.
  assert.equal(dx.matchTriage('stunted plants, no galls').rows[0].card.id, 'acid_soil');
});

test('a cue shows its own row\'s photo when the slot is filled', () => {
  // One picture per row, so every clause of that row's wording carries it —
  // whichever line the person is scanning, the picture is beside it.
  const mine = dx.CUES.filter((c) => c.rows[0] === 23).map((c) => c.id);
  assert.ok(mine.length > 1, 'row 23 is written as several clauses');
  const cues = dx.photoCues(withPhotos({
    'row:23': { slot: 'row:23', photo: shot(), caption: 'GH-03, week 6' },
  }));
  for (const id of mine) {
    const filled = cues.find((c) => c.id === id);
    assert.equal(filled.photo.dataUrl, 'data:image/jpeg;base64,abc');
    assert.equal(filled.caption, 'GH-03, week 6');
  }
  // No cue belonging to any other row picked it up.
  assert.deepEqual(cues.filter((c) => c.photo).map((c) => c.id).sort(), mine.slice().sort());
});

test('a card\'s photo is not shown as if it were the symptom', () => {
  // The row picture is what you see walking the house; the card picture is the
  // confirmed thing. Borrowing one for the other would show the answer at the
  // step that is meant to be a question.
  const state = withPhotos({ 'card:acid_soil': { slot: 'card:acid_soil', photo: shot() } });
  assert.equal(dx.rowPhoto(state, 23), null);
  assert.ok(dx.cardPhoto(state, 'acid_soil'));
  assert.equal(dx.photoCues(state).filter((c) => c.photo).length, 0);
});

test('a slot with no picture in it reads as empty, not as a broken picture', () => {
  assert.equal(dx.referencePhoto({}, 'card:thrips'), null);
  assert.equal(dx.referencePhoto(withPhotos({ 'card:thrips': { slot: 'card:thrips' } }), 'card:thrips'), null);
  assert.equal(dx.referencePhoto(withPhotos({ 'card:thrips': { photo: {} } }), 'card:thrips'), null);
});

test('the event log holds the pictures, and only for slots the rules have', () => {
  const at = (n) => `2026-09-2${n}T08:00:00Z`;
  const state = store.reduce([
    { id: 'p1', type: 'reference.photo.set', at: at(1), by: 'u_mgr',
      payload: { slot: 'card:thrips', photo: shot(), caption: 'GH-02 traps' } },
    { id: 'p2', type: 'reference.photo.set', at: at(2), by: 'u_mgr',
      payload: { slot: 'row:99', photo: shot() } },
    { id: 'p3', type: 'reference.photo.set', at: at(3), by: 'u_mgr',
      payload: { slot: 'row:23' } },
  ]);
  assert.equal(Object.keys(state.referencePhotos).length, 1);
  assert.equal(state.referencePhotos['card:thrips'].caption, 'GH-02 traps');
  assert.equal(state.referencePhotos['card:thrips'].by, 'u_mgr', 'who put it there is on the record');
  assert.equal(state.referencePhotos['card:thrips'].at, at(1));
  assert.equal(dx.photoCoverage(state).have, 1);
});

test('a picture can be taken back off, and the words carry on', () => {
  const state = store.reduce([
    { id: 'p1', type: 'reference.photo.set', at: '2026-09-21T08:00:00Z', by: 'u_mgr',
      payload: { slot: 'card:thrips', photo: shot() } },
    { id: 'p2', type: 'reference.photo.clear', at: '2026-09-22T08:00:00Z', by: 'u_mgr',
      payload: { slot: 'card:thrips', reason: 'it was actually whitefly' } },
  ]);
  assert.equal(dx.cardPhoto(state, 'thrips'), null);
  assert.equal(dx.photoCoverage(state).have, 0);
  assert.equal(dx.matchTriage('silvery flecks on leaves and tips').rows[0].card.id, 'thrips');
});

test('only the Owner and the Farm Manager may fill a slot', () => {
  for (const type of ['reference.photo.set', 'reference.photo.clear']) {
    assert.equal(core.EVENT_POLICY[type].write, 'settings');
  }
  const may = (role) => store.can({ role }, 'settings');
  assert.equal(may('ceo'), true, 'the Owner');
  assert.equal(may('manager'), true, 'the Farm Manager');
  assert.equal(may('supervisor'), false);
  assert.equal(may('agronomist'), false);
  assert.equal(may('hand'), false);
  // Everyone reads them: a reference photo on one phone is worth nothing.
  assert.equal(core.EVENT_POLICY['reference.photo.set'].read, core.EVENT_POLICY['scout.record'].read);
});

test('the server refuses a slot, a file or a size it should not carry', () => {
  const guard = core.EVENT_POLICY['reference.photo.set'].guard;
  const ok = { slot: 'card:thrips', photo: { dataUrl: 'data:image/jpeg;base64,abc', bytes: 40000 } };
  assert.equal(guard({ payload: ok }).ok, true);
  assert.equal(guard({ payload: { ...ok, slot: '' } }).ok, false);
  assert.equal(guard({ payload: { ...ok, slot: 'zone:GH-01' } }).ok, false);
  assert.equal(guard({ payload: { ...ok, photo: { dataUrl: 'data:text/html,<script>' } } }).ok, false);
  // Every phone downloads these whether it opens them or not, so the size is
  // the whole farm's bill, not the uploader's.
  assert.equal(guard({ payload: { ...ok, photo: { ...ok.photo, bytes: 400000 } } }).ok, false);
});

test('taking a picture off the app is a decision with a reason on it', () => {
  const guard = core.EVENT_POLICY['reference.photo.clear'].guard;
  assert.equal(guard({ payload: { slot: 'card:thrips', reason: 'wrong pest' } }).ok, true);
  assert.equal(guard({ payload: { slot: 'card:thrips' } }).ok, false);
  assert.equal(guard({ payload: { reason: 'wrong pest' } }).ok, false);
});
