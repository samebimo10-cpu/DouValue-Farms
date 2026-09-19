// The active-ingredient catalogue — FR-STOCK-05 to FR-STOCK-09, Build Rules §11d.
//
// Season 1's spray record is a list of brand names. A list of brand names
// cannot answer "have we already used this chemical family here?", which is the
// only question worth asking before the next spray. So these tests are about
// the catalogue being the thing that answers it: twenty actives with their
// groups, brands hanging off them rather than standing in for them, and two
// refusals that have to hold under every route in — a banned active, and a
// product whose dose nobody can name.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules, rules } = await import(new URL('rules.js', base).href);
const doc = await loadRules();
const {
  addActive, addLabel, activeById, allowedInWeek10, bannedActives, canUse, catalogue,
  findActive, fungicideSequence, insecticideSequence, intervalDefaults, intervalsFor,
  isBanned, labelGroups, migrationEvents, migrationPlan, nextInSequence, parseGroup,
  rateFor, sameGroup, thripsProgramme, usableActives, week10Actives,
} = await import(new URL('domain/actives.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);

const OWNER = { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' };
const MANAGER = { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' };
const SUPERVISOR = { id: 'u_2ic', name: 'Tamuno George', role: 'supervisor' };
const HAND = { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' };

const empty = () => reduce([]);

/** A farm state with the given events applied, so the reducer is under test too. */
const farmWith = (events) => reduce(events.map((e, i) => ({
  id: `e${i}`, at: `2026-09-0${(i % 9) + 1}T08:00:00Z`, by: e.by || 'u_mgr', ...e,
})));

// --- FR-STOCK-05: the catalogue itself ------------------------------------

test('the catalogue is the twenty actives in the rules file, with their groups', () => {
  const list = catalogue();

  assert.equal(list.length, 20);
  assert.equal(list.length, doc.active_ingredients.length,
    'the rules file is the source of truth; the catalogue is not a second copy of it');
  for (const active of list) {
    assert.ok(active.name, 'every row is named');
    assert.ok(active.group, `${active.name} has a group on file`);
  }
});

test('every active carries the IRAC or FRAC group the rules give it', () => {
  const group = (id) => activeById(id).group;

  assert.equal(group('cypermethrin'), 'IRAC 3A');
  assert.equal(group('thiamethoxam'), 'IRAC 4A');
  assert.equal(group('spinosad'), 'IRAC 5');
  assert.equal(group('abamectin'), 'IRAC 6');
  assert.equal(group('chlorantraniliprole'), 'IRAC 28');
  assert.equal(group('mancozeb'), 'FRAC M3');
  assert.equal(group('copper-oxychloride'), 'FRAC M1');
  assert.equal(group('metalaxyl-m-mancozeb'), 'FRAC 4 + M3');
});

test('a brand swap inside one group is not a rotation, and the catalogue says so', () => {
  assert.equal(sameGroup(activeById('cypermethrin'), activeById('lambda-cyhalothrin')), true);
  assert.equal(sameGroup(activeById('spinosad'), activeById('spinetoram')), true);
  assert.equal(sameGroup(activeById('cypermethrin'), activeById('thiamethoxam')), false);
});

test('a mixture rotates on its single-site group, and still carries both', () => {
  // FRAC 4 + M3: resistance builds against the systemic 4, not the multi-site
  // M3, which is why the rules restart the sequence at Mancozeb straight after.
  const mix = parseGroup('FRAC 4 + M3');
  assert.deepEqual(mix.codes, ['4', 'M3']);
  assert.deepEqual(mix.rotationCodes, ['4']);
  assert.equal(sameGroup(activeById('metalaxyl-m-mancozeb'), activeById('mancozeb')), false);
});

test('the named sequences are read from the rules, rates and all', () => {
  const irac = insecticideSequence();
  assert.deepEqual(irac.map((s) => s.group), ['IRAC 3A', 'IRAC 4A', 'IRAC 5', 'IRAC 28']);
  assert.deepEqual(irac.map((s) => s.activeId),
    ['cypermethrin', 'thiamethoxam', 'spinosad', 'chlorantraniliprole']);

  const frac = fungicideSequence();
  assert.deepEqual(frac.map((s) => s.group), ['FRAC M3', 'FRAC M1', 'FRAC 4 + M3']);

  // "then: restart at 3A" / "restart at M3"
  assert.equal(nextInSequence('IRAC', 'IRAC 28').group, 'IRAC 3A');
  assert.equal(nextInSequence('FRAC', 'FRAC 4 + M3').group, 'FRAC M3');
});

// --- FR-STOCK-09: the banned active ---------------------------------------

test('carbofuran is not in the catalogue at all — not even flagged', () => {
  const list = catalogue();
  assert.ok(bannedActives().some((b) => /carbofuran/i.test(b)), 'the rules name it as banned');

  for (const active of list) {
    assert.ok(!/carbofuran|furadan/i.test(active.name), `${active.name} is in the catalogue`);
    assert.ok(!/carbofuran|furadan/i.test(JSON.stringify(active)));
  }
  assert.equal(activeById('carbofuran'), null);
  assert.equal(findActive('Furadan 3G'), null);
});

test('the banned check catches the brand name and the packaging, not just the word', () => {
  assert.equal(isBanned('Carbofuran'), true);
  assert.equal(isBanned('carbofuran 3G granules'), true);
  assert.equal(isBanned('Furadan'), true);
  assert.equal(isBanned('Mancozeb 80% WP'), false);
});

test('the Owner cannot add a banned active either', () => {
  for (const name of ['Carbofuran', 'Furadan 3G', 'carbofuran']) {
    const verdict = addActive(empty(), OWNER, { name, group: 'IRAC 1A' });
    assert.equal(verdict.ok, false, `${name} was accepted`);
    assert.equal(verdict.reason, 'banned');
    assert.ok(/marigold|maize|solaris/i.test(verdict.fix), 'the refusal says what to do instead');
  }
});

test('a banned product cannot come in behind a brand label either', () => {
  const verdict = addLabel(empty(), MANAGER, {
    brand: 'Furadan 3G', activeIds: ['cypermethrin'], labelRate: '1 g/L',
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'banned');
});

test('an event that somehow carries a banned active still never reaches a screen', () => {
  // Defence in depth: the log is a merge of five phones, and the catalogue is
  // read through one filter that runs on the way out as well as the way in.
  const state = farmWith([
    { type: 'active.add', by: 'u_owner', payload: { id: 'carbofuran', name: 'Carbofuran', group: 'IRAC 1A' } },
  ]);
  assert.ok(state.actives.carbofuran, 'the event is kept in the log, as every record is');
  assert.equal(catalogue(state).length, 20, 'and it is not in the catalogue');
  assert.equal(activeById('carbofuran', state), null);
});

// --- FR-STOCK-09: only the Owner adds an active ---------------------------

test('only the Owner can add an active ingredient to the catalogue', () => {
  for (const person of [HAND, SUPERVISOR, MANAGER]) {
    const verdict = addActive(empty(), person, { name: 'Pymetrozine', group: 'IRAC 9B' });
    assert.equal(verdict.ok, false, `${person.role} added an active`);
    assert.equal(verdict.reason, 'not-owner');
  }

  const owner = addActive(empty(), OWNER, { name: 'Pymetrozine', type: 'insecticide', group: 'IRAC 9B' });
  assert.equal(owner.ok, true);
  assert.equal(owner.event.type, 'active.add');
  assert.equal(owner.event.payload.group, 'IRAC 9B');
  assert.equal(owner.event.payload.addedBy, OWNER.id);
});

test('a new active without a group is refused — the product rule allows no exception', () => {
  const verdict = addActive(empty(), OWNER, { name: 'Pymetrozine', group: '' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'no-group');
  assert.ok(/IRAC|FRAC/.test(verdict.fix));
});

test('an active the Owner added joins the catalogue and rotates like any other', () => {
  const state = farmWith([{
    type: 'active.add', by: 'u_owner',
    payload: { id: 'pymetrozine', name: 'Pymetrozine', type: 'insecticide', group: 'IRAC 9B',
      scheduleRate: '0.5 g/L' },
  }]);

  const added = activeById('pymetrozine', state);
  assert.equal(catalogue(state).length, 21);
  assert.equal(added.group, 'IRAC 9B');
  assert.equal(sameGroup(added, activeById('thiamethoxam')), false);
  assert.equal(canUse(state, 'pymetrozine').ok, true);

  // Adding it twice is refused rather than quietly duplicating the row.
  assert.equal(addActive(state, OWNER, { name: 'Pymetrozine', group: 'IRAC 9B' }).reason, 'duplicate');
});

// --- FR-STOCK-06: brand labels --------------------------------------------

test('the Farm Manager adds a brand label against one or more actives', () => {
  const verdict = addLabel(empty(), MANAGER, {
    brand: 'Punch', activeIds: ['spinosad'], formulation: '45SC', concentration: '45 g/L',
    labelRate: '0.35 ml/L', phiDays: 3, reiHours: 12, photo: 'data:image/jpeg;base64,xx',
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.event.type, 'label.add');
  assert.equal(verdict.event.payload.brand, 'Punch');
  assert.deepEqual(verdict.event.payload.activeIds, ['spinosad']);
  assert.ok(verdict.event.payload.photo, 'a label with no photo of the label is hearsay');
});

test('the group is never typed on a label — it fills in from the active', () => {
  const state = farmWith([{
    type: 'label.add', payload: { id: 'lb_punch', brand: 'Punch', activeIds: ['spinosad'],
      formulation: '45SC', labelRate: '0.35 ml/L' },
  }]);

  assert.deepEqual(labelGroups(state, state.labels.lb_punch), ['IRAC 5']);
  assert.equal(state.labels.lb_punch.group, undefined,
    'a relabelled bottle cannot restart a rotation by claiming a different group');
});

test('a label may carry more than one active, and then it carries both groups', () => {
  const state = farmWith([{
    type: 'label.add', payload: { id: 'lb_mix', brand: 'Lion Seal', formulation: '68WG',
      activeIds: ['mancozeb', 'copper-oxychloride'], labelRate: '2.5 g/L' },
  }]);
  assert.deepEqual(labelGroups(state, state.labels.lb_mix), ['FRAC M3', 'FRAC M1']);
});

test('a hand or supervisor cannot add a label', () => {
  for (const person of [HAND, SUPERVISOR]) {
    const verdict = addLabel(empty(), person, { brand: 'Punch', activeIds: ['spinosad'] });
    assert.equal(verdict.ok, false, `${person.role} added a label`);
    assert.equal(verdict.reason, 'not-manager');
  }
});

test('a label has to name an active that is actually in the catalogue', () => {
  assert.equal(addLabel(empty(), MANAGER, { brand: 'Vanguish', activeIds: [] }).reason, 'no-active');
  assert.equal(
    addLabel(empty(), MANAGER, { brand: 'Vanguish', activeIds: ['unobtainium'] }).reason,
    'unknown-active',
  );
});

// --- FR-STOCK-07: PHI and REI defaults ------------------------------------

test('the farm defaults are 14 days before picking and 24 hours before re-entry', () => {
  const defaults = intervalDefaults();
  assert.equal(defaults.phiDays, 14);
  assert.equal(defaults.reiHours, 24);
});

test('a blank PHI or REI on a label falls back to the default', () => {
  const state = farmWith([{
    type: 'label.add', payload: { id: 'lb_blank', brand: 'Z-Force', activeIds: ['mancozeb'],
      labelRate: '2.5 g/L', phiDays: null, reiHours: null },
  }]);

  const shown = intervalsFor(state, 'mancozeb', { label: state.labels.lb_blank });
  assert.equal(shown.phiDays, 14);
  assert.equal(shown.reiHours, 24);
  assert.equal(shown.phiSource, 'default');
  assert.ok(/default — check label/.test(shown.reiNote), 'the screen says the figure is a default');
});

test('a label value is used only if it is longer than the default', () => {
  const state = farmWith([
    { type: 'label.add', payload: { id: 'lb_short', brand: 'Cheap Copper', activeIds: ['copper-oxychloride'],
      labelRate: '3 g/L', phiDays: 3, reiHours: 12 } },
    { type: 'label.add', payload: { id: 'lb_long', brand: 'Careful Copper', activeIds: ['copper-oxychloride'],
      labelRate: '3 g/L', phiDays: 21, reiHours: 48 } },
  ]);

  const short = intervalsFor(state, 'copper-oxychloride', { label: state.labels.lb_short });
  assert.equal(short.phiDays, 14, 'a bottle claiming 3 days does not shorten this farm\'s 14');
  assert.equal(short.reiHours, 24);

  const long = intervalsFor(state, 'copper-oxychloride', { label: state.labels.lb_long });
  assert.equal(long.phiDays, 21, 'a longer label value is the one that counts');
  assert.equal(long.reiHours, 48);
  assert.equal(long.phiSource, 'label');
});

test('the PHI-0 organics keep their zero, and carry the export buffer where the rules set one', () => {
  assert.equal(activeById('azadirachtin-neem-oil').phiDays, 0);
  assert.equal(activeById('garlic-chilli-extract-farm-made').phiDays, 0);
  assert.equal(activeById('copper-hydroxide').phiDays, 0);
  assert.equal(activeById('cypermethrin').phiDays, 14);
  assert.equal(activeById('cypermethrin').exportBufferDays, 21);
});

// --- FR-STOCK-08: no rate, no use -----------------------------------------

test('an active with no schedule rate and no label rate cannot be used', () => {
  // Abamectin, emamectin, spinetoram, imidacloprid, acetamiprid and Bt are all
  // in the rules with a group and no rate. They are real products the farm may
  // buy; they are not doses anyone may guess.
  for (const id of ['abamectin', 'emamectin-benzoate', 'spinetoram', 'imidacloprid', 'acetamiprid']) {
    const verdict = canUse(empty(), id);
    assert.equal(verdict.ok, false, `${id} was usable with no rate on file`);
    assert.equal(verdict.reason, 'no-rate');
    assert.ok(/label/i.test(verdict.fix));
  }
});

test('entering the label rate is what makes it usable — and nothing else is', () => {
  const state = farmWith([{
    type: 'label.add', payload: { id: 'lb_dynamec', brand: 'Dynamec', activeIds: ['abamectin'],
      formulation: '18EC', labelRate: '0.5 ml/L' },
  }]);

  const verdict = canUse(state, 'abamectin');
  assert.equal(verdict.ok, true);
  assert.equal(rateFor(state, 'abamectin').rate, '0.5 ml/L');
  assert.equal(rateFor(state, 'abamectin').source, 'label');

  // A label with everything but the rate does not open the gate.
  const rateless = farmWith([{
    type: 'label.add', payload: { id: 'lb_x', brand: 'Bottle With No Rate', activeIds: ['spinetoram'],
      formulation: '12SC', phiDays: 7 },
  }]);
  assert.equal(canUse(rateless, 'spinetoram').reason, 'no-rate');
});

test('the schedule rate wins over a label, because it is this farm\'s own agronomy', () => {
  const state = farmWith([{
    type: 'label.add', payload: { id: 'lb_z', brand: 'Z-Force', activeIds: ['mancozeb'], labelRate: '4 g/L' },
  }]);
  const rate = rateFor(state, 'mancozeb');
  assert.equal(rate.source, 'schedule');
  assert.equal(rate.rate, '2.5 g/L (80WP)');
});

test('a product that is not in the catalogue is refused outright', () => {
  const verdict = canUse(empty(), 'whatever-was-on-the-shelf');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'not-in-catalogue');
  assert.ok(/active ingredient/i.test(verdict.fix));
});

test('the spray picker offers only what has a rate', () => {
  const usable = usableActives(empty()).map((a) => a.id);
  assert.ok(usable.includes('mancozeb'));
  assert.ok(!usable.includes('abamectin'));
  assert.ok(!usable.some((id) => /carbofuran/.test(id)));
});

// --- The thrips programme and the Week 10 organics ------------------------

test('the thrips programme is four groups, each with the actives that fit it', () => {
  const programme = thripsProgramme();
  assert.deepEqual(programme.map((p) => p.group), ['IRAC 5', 'IRAC 6', 'IRAC 28', 'IRAC 4A']);

  const five = programme.find((p) => p.group === 'IRAC 5');
  assert.deepEqual(five.actives.map((a) => a.id), ['spinosad', 'spinetoram']);
  assert.equal(five.preferred.id, 'spinosad');

  const six = programme.find((p) => p.group === 'IRAC 6');
  assert.deepEqual(six.actives.map((a) => a.id), ['abamectin', 'emamectin-benzoate']);
});

test('a thrips group with no usable active is not offered until a label is entered', () => {
  // IRAC 6 is abamectin or emamectin, and the rules give neither a rate.
  const six = thripsProgramme(empty()).find((p) => p.group === 'IRAC 6');
  assert.equal(six.usable.length, 0);

  const withLabel = farmWith([{
    type: 'label.add', payload: { id: 'lb_ema', brand: 'Emastar', activeIds: ['emamectin-benzoate'],
      labelRate: '0.4 g/L' },
  }]);
  const now = thripsProgramme(withLabel).find((p) => p.group === 'IRAC 6');
  assert.deepEqual(now.usable.map((a) => a.id), ['emamectin-benzoate']);
});

test('the Week 10 list is the three organics SR-08 names, and nothing else', () => {
  const ids = week10Actives().map((a) => a.id);
  assert.deepEqual(ids.sort(), [
    'azadirachtin-neem-oil', 'copper-hydroxide', 'garlic-chilli-extract-farm-made',
  ].sort());

  assert.equal(allowedInWeek10(activeById('copper-hydroxide')), true);
  assert.equal(allowedInWeek10(activeById('copper-oxychloride')), false,
    'the other copper is a 14-day product and the crop is being picked');
  assert.equal(allowedInWeek10(activeById('mancozeb')), false);
});

// --- Migrating the old store onto actives ---------------------------------

test('existing stock items find the active they were always made of', () => {
  const state = farmWith([
    { type: 'input.upsert', payload: { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', unit: 'kg', qty: 6 } },
    { type: 'input.upsert', payload: { id: 'i2', name: 'Neem oil', kind: 'chemical', unit: 'litre', qty: 3 } },
    { type: 'input.upsert', payload: { id: 'i3', name: 'Copper oxychloride', kind: 'chemical', unit: 'kg', qty: 2 } },
    { type: 'input.upsert', payload: { id: 'i4', name: 'NPK 12-12-17+2MgO', kind: 'fertiliser', unit: 'bag', qty: 4 } },
    { type: 'input.upsert', payload: { id: 'i5', name: 'Shelf mystery', kind: 'chemical', unit: 'litre', qty: 1 } },
  ]);

  const plan = migrationPlan(state);
  assert.deepEqual(
    plan.linked.map((r) => [r.itemId, r.activeId]),
    [['i1', 'mancozeb'], ['i2', 'azadirachtin-neem-oil'], ['i3', 'copper-oxychloride']],
  );
  assert.deepEqual(plan.unmatched.map((r) => r.itemId), ['i5'],
    'what the app cannot name it does not guess at; the Farm Manager links it by hand');
  assert.ok(!plan.linked.some((r) => r.itemId === 'i4'), 'fertiliser is not a pesticide');
});

test('migration keeps every movement, cost and quantity the store already had', () => {
  const history = [
    { type: 'input.upsert', payload: { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', unit: 'kg', qty: 6, unitCost: 9500 } },
    { type: 'input.receive', payload: { id: 'mv1', itemId: 'i1', qty: 4, date: '2026-08-01' } },
    { type: 'input.issue', payload: { id: 'mv2', itemId: 'i1', qty: 1.5, cycleId: 'c1', date: '2026-08-20' } },
  ];
  const before = farmWith(history);
  const after = farmWith([...history, ...migrationEvents(before).map((e) => ({ type: e.type, payload: e.payload }))]);

  assert.equal(after.inputs.i1.activeId, 'mancozeb');
  assert.equal(after.inputs.i1.qty, before.inputs.i1.qty, 'the quantity is untouched');
  assert.equal(after.inputs.i1.unitCost, 9500);
  assert.deepEqual(
    after.stockMoves.map((m) => [m.itemId, m.direction, m.qty]),
    before.stockMoves.map((m) => [m.itemId, m.direction, m.qty]),
    'every movement still points at the same item',
  );
});

test('migration runs once however many phones run it', () => {
  const state = farmWith([
    { type: 'input.upsert', payload: { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', qty: 6 } },
  ]);
  const first = migrationEvents(state);
  assert.equal(first.length, 1);
  assert.equal(first[0].eventId, 'mig_stock_i1', 'a derived id, so the sync merge dedupes it');

  const migrated = farmWith([
    { type: 'input.upsert', payload: { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', qty: 6 } },
    { type: 'stock.link', payload: { itemId: 'i1', activeId: 'mancozeb' } },
  ]);
  assert.deepEqual(migrationEvents(migrated), [], 'nothing left to do on a second run');
});

test('a link filed before the item it names is not lost', () => {
  // Phones on this farm are offline for days and their clocks drift. An event
  // that arrives before its subject is parked and replayed, not dropped.
  const state = farmWith([
    { type: 'stock.link', at: '2026-09-01T08:00:00Z', payload: { itemId: 'i1', activeId: 'mancozeb' } },
    { type: 'input.upsert', at: '2026-09-02T08:00:00Z', payload: { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', qty: 6 } },
  ]);
  assert.equal(state.inputs.i1.activeId, 'mancozeb');
});

test('a store item can be linked to the active the manager says, not the one the name suggests', () => {
  const state = farmWith([
    { type: 'input.upsert', payload: { id: 'i1', name: 'Blue drum, no label', kind: 'chemical', qty: 2 } },
    { type: 'stock.link', by: 'u_mgr', payload: { itemId: 'i1', activeId: 'copper-hydroxide' } },
  ]);
  assert.equal(state.inputs.i1.activeId, 'copper-hydroxide');
  assert.equal(state.inputs.i1.linkedBy, 'u_mgr', 'and who said so is on the record (NFR-SEC-05)');
});

test('sprays logged before the catalogue still name the group that went on', () => {
  // The old records spell things however whoever typed them did. What matters
  // is that the rotation gate can still read a group out of them.
  const cases = [
    ['Mancozeb 80% WP', 'mancozeb'],
    ['metalaxyl_mancozeb', 'metalaxyl-m-mancozeb'],
    ['copper_oxychloride', 'copper-oxychloride'],
    ['lambda_cyhalothrin', 'lambda-cyhalothrin'],
    ['Neem oil / azadirachtin', 'azadirachtin-neem-oil'],
    ['Wettable sulphur', 'sulphur-wettable'],
  ];
  for (const [written, expected] of cases) {
    assert.equal(findActive(written)?.id, expected, `"${written}" did not resolve`);
  }
});

test('a name that could be two actives resolves to neither', () => {
  // "Copper" is oxychloride or hydroxide, one a 14-day product and one PHI 0.
  // A guess here is a guess about when the fruit is safe to pick.
  assert.equal(findActive('Copper'), null);
  assert.equal(findActive('Bacillus'), null);
  assert.equal(findActive(''), null);
});

// --- The loader itself -----------------------------------------------------

test('the catalogue reads the one rules file, and says which version it is on', () => {
  assert.equal(rules(), doc);
  assert.equal(doc.meta.version, 'rules-1.2');
});

test('a half-loaded rules file stops the app rather than emptying the catalogue', async () => {
  const { setRules } = await import(new URL('rules.js', base).href);
  assert.throws(() => setRules({ meta: { version: 'x' } }), /missing/i);
  assert.equal(catalogue().length, 20, 'and the good document is still in place');
});

// --- The same refusals on the server --------------------------------------
//
// The phone refuses all of this already. The server refuses it again because
// the phone is the thing an attacker controls, and because five handsets
// merging one log is exactly how a bad record would otherwise arrive.

const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const OWNER_S = { id: 'c', role: 'ceo' };
const MANAGER_S = { id: 'm', role: 'manager' };
const AGRONOMIST_S = { id: 'a', role: 'agronomist' };
const SUPERVISOR_S = { id: 's', role: 'supervisor' };
const HAND_S = { id: 'h', role: 'hand' };

test('the server keeps its banned list in step with the rules file', () => {
  assert.deepEqual(core.BANNED_ACTIVES, doc.labels.banned,
    'server/core.mjs carries the names because it is pasted into Deno Deploy alone; '
    + 'if the rules file changes, change it there too');
});

test('the server refuses a banned active however it is spelled', () => {
  for (const name of ['Carbofuran', 'Furadan 3G', 'carbofuran granules']) {
    const event = { id: 'a1', type: 'active.add', payload: { id: 'x', name, group: 'IRAC 1A' } };
    const verdict = core.mayWrite(event, OWNER_S);
    assert.equal(verdict.ok, false, `${name} was accepted by the server`);
    assert.ok(/banned/i.test(verdict.why), verdict.why);
  }
  assert.equal(core.namesBannedActive('Mancozeb 80% WP'), false);
});

test('the server puts a new active with the Owner and nobody else', () => {
  const event = { id: 'a2', type: 'active.add', payload: { id: 'pymetrozine', name: 'Pymetrozine', group: 'IRAC 9B' } };
  for (const author of [HAND_S, SUPERVISOR_S, AGRONOMIST_S, MANAGER_S]) {
    assert.equal(core.mayWrite(event, author).ok, false, `a ${author.role} added an active`);
  }
  assert.equal(core.mayWrite(event, OWNER_S).ok, true);
});

test('the server refuses an active with no resistance group', () => {
  const event = { id: 'a3', type: 'active.add', payload: { id: 'x', name: 'Something new', group: '' } };
  const verdict = core.mayWrite(event, OWNER_S);
  assert.equal(verdict.ok, false);
  assert.ok(/IRAC or FRAC/.test(verdict.why), verdict.why);
});

test('the server puts brand labels with the Farm Manager', () => {
  const event = { id: 'l1', type: 'label.add',
    payload: { id: 'lb', brand: 'Punch', activeIds: ['spinosad'], labelRate: '0.35 ml/L' } };
  for (const author of [HAND_S, SUPERVISOR_S, AGRONOMIST_S]) {
    assert.equal(core.mayWrite(event, author).ok, false, `a ${author.role} added a label`);
  }
  assert.equal(core.mayWrite(event, MANAGER_S).ok, true);
  assert.equal(core.mayWrite(event, OWNER_S).ok, true);
});

test('the server will not take a label that carries a group of its own', () => {
  // FR-STOCK-06: the group fills in from the active. A brand that could name
  // its own group could restart a rotation by being rebottled.
  const event = { id: 'l2', type: 'label.add',
    payload: { id: 'lb', brand: 'Punch', activeIds: ['spinosad'], group: 'IRAC 28' } };
  const verdict = core.mayWrite(event, MANAGER_S);
  assert.equal(verdict.ok, false);
  assert.ok(/group comes from the active/.test(verdict.why), verdict.why);
});

test('the server will not take a label with no active behind it', () => {
  const event = { id: 'l3', type: 'label.add', payload: { id: 'lb', brand: 'Vanguish', activeIds: [] } };
  assert.equal(core.mayWrite(event, MANAGER_S).ok, false);
});

test('the server refuses a stock link to a banned active', () => {
  const good = { id: 'k1', type: 'stock.link', payload: { itemId: 'i1', activeId: 'mancozeb' } };
  assert.equal(core.mayWrite(good, SUPERVISOR_S).ok, true);
  assert.equal(core.mayWrite(good, HAND_S).ok, false);

  const bad = { id: 'k2', type: 'stock.link', payload: { itemId: 'i1', activeId: 'carbofuran' } };
  assert.equal(core.mayWrite(bad, MANAGER_S).ok, false);
});
