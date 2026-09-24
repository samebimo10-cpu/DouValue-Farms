// The active-ingredient catalogue and the rotation gate — FR-STOCK-05 to
// FR-STOCK-09, FR-GATE-05, Build Rules 11d, §6, §7 and SR-08.
//
// Two things are being asserted here, and the second is the one that matters.
//
// The first is that each rule works: a brand label fills in its own group, a
// product with no rate is refused, the same resistance group twice in a row is
// blocked, a banned active cannot be added by anybody.
//
// The second is that none of those answers is written down in the app. Every
// group, sequence, default and ban comes out of
// rules/douvalue_rules_rev5_1.json, so several tests change the rules document
// and assert the app changes with it. A catalogue that agrees with the rules by
// coincidence is a catalogue that will disagree with them after the next
// revision, quietly, in the middle of a season.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { loadRules, ref, RULES_FILE, setRules: rulesModuleSetRules } = await import(new URL('rules.js', base).href);
const rules = await loadRules();

const {
  buildCatalogue, canUseActive, checkAddActive, checkAddLabel, isBanned, parseGroup,
  planStockMigration, migrationEvents, rateFor, resolveActive, sameGroup, slug,
} = await import(new URL('domain/catalogue.js', base).href);
const {
  cropWeek, rotationVerdict, sequenceFor, thripsProgramme, week10Actives,
} = await import(new URL('domain/rotation.js', base).href);
const { canTreat } = await import(new URL('domain/gates.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);

const OWNER = { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo' };
const MANAGER = { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' };
const SUPERVISOR = { id: 'u_sup', name: 'Tamuno George', role: 'supervisor' };
const HAND = { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' };

const TODAY = '2026-09-21';
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A farm with one house, one crop in it, and whatever else the test needs. */
function farm(overrides = {}) {
  return {
    settings: {},
    people: {}, plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' } },
    // Week 2 by default, so the Week 10 rule is not in the way of a test about
    // something else. Tests that want Week 10 move the transplant date.
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-20), status: 'active' } },
    tasks: {}, inputs: {}, actives: {}, labels: {},
    harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [], expenses: [],
    stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    soilTests: [], topsoilBatches: {}, gateOverrides: [], log: [], orphans: [],
    ...overrides,
  };
}

const cat = (state = farm(), doc = rules) => buildCatalogue(state, doc);
const spray = (productId, date, extra = {}) => ({ id: `s_${productId}_${date}`, cycleId: 'c1', productId, date, ...extra });

// --- FR-STOCK-05: twenty actives, with their groups, from the rules ---------

test('the catalogue is the twenty actives in the rules file, with their groups', () => {
  const catalogue = cat();

  assert.equal(catalogue.actives.length, rules.active_ingredients.length);
  assert.equal(catalogue.actives.length, 20);

  for (const entry of rules.active_ingredients) {
    const active = catalogue.byId[slug(entry.ai)];
    assert.ok(active, `${entry.ai} is in the catalogue`);
    assert.equal(active.group, entry.group, `${entry.ai} carries the group the rules give it`);
    assert.equal(active.scheduleRate, entry.schedule_rate || null);
  }
});

test('a group is read from the rules file, not from a copy inside the app', () => {
  // The proof that nothing is hard-coded: move Spinosad from IRAC 5 to IRAC 28
  // in the document and the catalogue moves with it, rotation and all.
  const edited = structuredClone(rules);
  edited.active_ingredients.find((a) => a.ai === 'Spinosad').group = 'IRAC 28';
  const catalogue = cat(farm(), edited);

  assert.equal(catalogue.byId.spinosad.group, 'IRAC 28');
  assert.equal(cat().byId.spinosad.group, 'IRAC 5', 'and the real rules are untouched');
});

test('every active says which line of the rules its group came from', () => {
  for (const active of cat().actives) {
    assert.match(active.groupSource, new RegExp(`^${RULES_FILE.replace('.', '\\.')}#/active_ingredients/\\d+/group$`),
      `${active.name} can be traced back to the rules`);
  }
});

test('IRAC and FRAC groups are read apart, and M3 is M03', () => {
  assert.deepEqual(parseGroup('IRAC 3A'), { text: 'IRAC 3A', system: 'IRAC', codes: ['3A'], rotates: true });
  assert.deepEqual(parseGroup('FRAC 4 + M3').codes, ['4', 'M3']);
  assert.equal(sameGroup(parseGroup('FRAC M03'), parseGroup('FRAC M3')), true,
    'the old product table wrote M03 for the same group; rotation must see through that');
  assert.equal(sameGroup(parseGroup('IRAC 3A'), parseGroup('FRAC 3')), false,
    'IRAC 3 and FRAC 3 are different systems and not the same group');
  assert.equal(parseGroup('none').rotates, false);
  assert.equal(parseGroup('IRAC UN').rotates, false, 'UN is "unknown mode of action", not a rotation group');
});

// --- FR-STOCK-06: brand labels, with the group filled in -------------------

test('a manager attaches a brand to actives, and the group fills in from them', () => {
  const catalogue = cat();
  const check = checkAddLabel(MANAGER, {
    brand: 'Punch', activeIds: ['spinosad'], formulation: '45SC', concentration: '45 g/L',
    rate: '0.3 ml/L', photo: { dataUrl: 'data:image/jpeg;base64,x' },
  }, catalogue);

  assert.equal(check.ok, true, check.why);
  const withLabel = cat(farm({ labels: { l1: { ...check.payload, id: 'l1' } } }));
  const label = withLabel.labels[0];

  assert.deepEqual(label.groups, ['IRAC 5'], 'the group is the active\'s, never typed by hand');
  assert.equal(label.formulation, '45SC');
  assert.ok(label.photo, 'the label photo is part of the record');
  assert.deepEqual(withLabel.byId.spinosad.labels.map((l) => l.brand), ['Punch']);
});

test('one label can carry more than one active', () => {
  const check = checkAddLabel(MANAGER, {
    brand: 'Lion Seal', activeIds: ['mancozeb', 'copper_oxychloride'], rate: '2.5 g/L',
  }, cat());
  assert.equal(check.ok, true, check.why);

  const label = cat(farm({ labels: { l1: { ...check.payload, id: 'l1' } } })).labels[0];
  assert.deepEqual(label.groups, ['FRAC M3', 'FRAC M1']);
});

test('a brand with no active ingredient behind it is refused', () => {
  // Punch, Vanguish and Lion Seal are exactly this case: names that identify no
  // chemical. A guessed group would defeat the rotation gate (decision C-6).
  const check = checkAddLabel(MANAGER, { brand: 'Vanguish', activeIds: [] }, cat());
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'no-active');
  assert.match(check.fix, /Owner adds it first/);
});

test('a hand cannot add a brand label', () => {
  assert.equal(checkAddLabel(HAND, { brand: 'Punch', activeIds: ['spinosad'] }, cat()).ok, false);
  assert.equal(checkAddLabel(SUPERVISOR, { brand: 'Punch', activeIds: ['spinosad'] }, cat()).reason, 'not-manager');
});

// --- FR-STOCK-07: blank PHI and REI take the defaults ----------------------

test('a blank PHI and REI on a label take the defaults: 24 h re-entry, 14 days before picking', () => {
  const label = { id: 'l1', brand: 'Something', activeIds: ['mancozeb'], rate: '2.5 g/L',
    phiDays: null, reiHours: null };
  const stored = cat(farm({ labels: { l1: label } })).labels[0];

  assert.equal(stored.phiDays, 14, 'the default for a synthetic');
  assert.equal(stored.reiHours, 24);
  assert.equal(stored.phiIsDefault, true, 'and it is marked as a default, not as a label figure');
  assert.equal(stored.reiIsDefault, true);
});

test('a label figure is used only if it is longer than the default', () => {
  const shorter = cat(farm({ labels: { l1: { id: 'l1', brand: 'Cheap', activeIds: ['mancozeb'],
    rate: '2 g/L', phiDays: 3, reiHours: 4 } } })).labels[0];
  assert.equal(shorter.phiDays, 14, 'a label claiming 3 days does not shorten a 14-day default');
  assert.equal(shorter.reiHours, 24);

  const longer = cat(farm({ labels: { l1: { id: 'l1', brand: 'Honest', activeIds: ['mancozeb'],
    rate: '2 g/L', phiDays: 21, reiHours: 48 } } })).labels[0];
  assert.equal(longer.phiDays, 21, 'a longer label figure is the one that counts');
  assert.equal(longer.reiHours, 48);
  assert.equal(longer.phiIsDefault, false);
});

test('the PHI-0 organics keep their own figures from the rules', () => {
  const catalogue = cat();
  assert.equal(catalogue.byId.azadirachtin_neem_oil.phiDays, 0);
  assert.equal(catalogue.byId.azadirachtin_neem_oil.reiHours, 4, 'until dry, minimum 4 h');
  assert.equal(catalogue.byId.copper_hydroxide.phiDays, 0);
  assert.equal(catalogue.byId.copper_hydroxide.reiHours, 24);
  assert.equal(catalogue.byId.cypermethrin.phiDays, 14);
});

// --- FR-STOCK-08: no rate, no spray ----------------------------------------

test('an active with no schedule rate and no label rate cannot be used', () => {
  const catalogue = cat();
  // The rules leave Abamectin's schedule rate blank on purpose.
  assert.equal(catalogue.byId.abamectin.scheduleRate, null);

  const verdict = canUseActive(catalogue, 'abamectin');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'no-rate');
  assert.match(verdict.fix, /brand label/);
  assert.equal(verdict.source, ref('labels/rate_rule'));
});

test('entering a label rate is what brings it back', () => {
  const withLabel = cat(farm({ labels: { l1: { id: 'l1', brand: 'Dynamec', activeIds: ['abamectin'],
    formulation: '18EC', rate: '0.5 ml/L' } } }));

  const verdict = canUseActive(withLabel, 'abamectin');
  assert.equal(verdict.ok, true);
  assert.equal(rateFor(withLabel, 'abamectin').rate, '0.5 ml/L');
  assert.equal(rateFor(withLabel, 'abamectin').from, 'label');
});

test('a schedule rate that only points elsewhere is not a rate', () => {
  // "per label" and "see prep table" are not doses, and the Farm Doctor is
  // forbidden from inventing one.
  assert.equal(cat().byId.bacillus_subtilis.scheduleRate, 'per label');
  assert.equal(canUseActive(cat(), 'bacillus_subtilis').ok, false);
  assert.equal(canUseActive(cat(), 'garlic_chilli_extract').reason, 'no-rate');
});

test('a product with no rate is refused by the treatment gate, not merely hidden', () => {
  const state = farm({
    diagnoses: [{ id: 'd1', cycleId: 'c1', problemId: 'broad_mite', date: day(-1), confirmedBy: 'u_mgr' }],
  });
  const verdict = canTreat(state, 'c1', { today: TODAY, activeId: 'abamectin', rules });

  assert.equal(verdict.ok, false, 'a confirmed diagnosis does not conjure a dose');
  assert.equal(verdict.reason, 'no-rate');
});

// --- FR-STOCK-09: who may add an active, and what may never be added -------

test('only the Owner can add an active ingredient', () => {
  const draft = { name: 'Flonicamid', group: 'IRAC 29', type: 'insecticide' };

  assert.equal(checkAddActive(MANAGER, draft, cat()).reason, 'not-owner');
  assert.equal(checkAddActive(SUPERVISOR, draft, cat()).ok, false);
  assert.equal(checkAddActive(HAND, draft, cat()).ok, false);

  const owner = checkAddActive(OWNER, draft, cat());
  assert.equal(owner.ok, true, owner.why);
  assert.equal(owner.payload.id, 'flonicamid');
});

test('an active added without its group is refused, because the gate could not see it', () => {
  const check = checkAddActive(OWNER, { name: 'Flonicamid', group: '' }, cat());
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'no-group');
  assert.equal(check.source, ref('product_rule'));
});

test('an Owner-added active joins the catalogue and rotates like the rest', () => {
  const state = farm({
    actives: { flonicamid: { id: 'flonicamid', name: 'Flonicamid', group: 'IRAC 29',
      type: 'insecticide', scheduleRate: '0.4 g/L', by: 'u_owner', at: `${day(-1)}T10:00:00Z` } },
    sprays: [spray('flonicamid', day(-7))],
  });
  const catalogue = cat(state);

  assert.equal(catalogue.byId.flonicamid.group, 'IRAC 29');
  assert.equal(catalogue.byId.flonicamid.addedBy, 'u_owner');
  assert.equal(catalogue.byId.flonicamid.phiDays, 14, 'and takes the default waiting period');

  const again = rotationVerdict(state, 'c1', 'flonicamid', { rules, catalogue, today: TODAY });
  assert.equal(again.ok, false, 'a new active is in the rotation from its first spray');
  assert.equal(again.reason, 'rotation');
});

test('carbofuran is not in the catalogue at all', () => {
  for (const active of cat().actives) {
    assert.ok(!/carbofuran|furadan/i.test(active.name), `${active.name} must not be in the catalogue`);
  }
  assert.equal(cat().byId.carbofuran, undefined);
  assert.equal(isBanned('Carbofuran', rules), true);
  assert.equal(isBanned('Furadan 3G', rules), true, 'the brand it is sold under here is the same ban');
  assert.equal(isBanned('Mancozeb', rules), false);
});

test('a banned active cannot be added — by the Owner, or by anybody', () => {
  for (const person of [OWNER, MANAGER, SUPERVISOR, HAND]) {
    const check = checkAddActive(person, { name: 'Carbofuran', group: 'IRAC 1A' }, cat());
    assert.equal(check.ok, false, `${person.role} must not be able to add it`);
    assert.equal(check.reason, 'banned', 'refused as banned, before authority is even considered');
    assert.equal(check.source, ref('labels/banned'));
  }
  assert.equal(checkAddActive(OWNER, { name: 'Furadan', group: 'IRAC 1A' }, cat()).reason, 'banned');
  assert.equal(checkAddLabel(MANAGER, { brand: 'Furadan 3G', activeIds: ['abamectin'] }, cat()).reason, 'banned');
});

test('even a log that somehow carries a banned active does not put it on a screen', () => {
  // A bad merge, an older build, a hand-edited export: the catalogue is built
  // from the rules every time, and the ban is applied on the way in.
  const state = farm({ actives: { carbofuran: { id: 'carbofuran', name: 'Carbofuran',
    group: 'IRAC 1A', scheduleRate: '1 g/L' } } });
  const catalogue = cat(state);

  assert.equal(catalogue.byId.carbofuran, undefined);
  assert.equal(catalogue.actives.length, 20);
  assert.equal(rotationVerdict(state, 'c1', 'carbofuran', { rules, catalogue, today: TODAY }).ok, false);
});

// --- FR-GATE-05: rotation by group -----------------------------------------

test('the named IRAC sequence is the rules\' own: 3A, 4A, 5, 28, then restart', () => {
  const seq = sequenceFor('IRAC', rules);
  assert.deepEqual(seq.steps.map((s) => s.group.codes[0]), ['3A', '4A', '5', '28']);
  assert.equal(seq.then, 'restart at 3A');

  const frac = sequenceFor('FRAC', rules);
  assert.deepEqual(frac.steps.map((s) => s.group.codes.join('+')), ['M3', 'M1', '4+M3']);
});

test('the same IRAC group twice in a row is blocked, whichever product it is sold as', () => {
  // Cypermethrin and lambda-cyhalothrin are two products and one group. This is
  // the case the old product-counting check could not see.
  const state = farm({ sprays: [spray('cypermethrin', day(-10))] });
  const verdict = rotationVerdict(state, 'c1', 'lambda_cyhalothrin', { rules, today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rotation');
  assert.match(verdict.why, /IRAC 3A/);
  assert.match(verdict.nextInSequence, /Thiamethoxam/, 'and the sequence says what comes next');
});

test('the next group in the sequence goes through', () => {
  const state = farm({ sprays: [spray('cypermethrin', day(-10))] });
  assert.equal(rotationVerdict(state, 'c1', 'thiamethoxam', { rules, today: TODAY }).ok, true);
});

test('the same FRAC group twice in a row is blocked, and a shared code counts', () => {
  const state = farm({ sprays: [spray('mancozeb', day(-12))] });

  assert.equal(rotationVerdict(state, 'c1', 'mancozeb', { rules, today: TODAY }).reason, 'rotation');
  assert.equal(rotationVerdict(state, 'c1', 'metalaxyl_m_mancozeb', { rules, today: TODAY }).reason, 'rotation',
    'Metalaxyl-M + Mancozeb is 4 + M3, and M3 is what just went on');
  assert.equal(rotationVerdict(state, 'c1', 'copper_oxychloride', { rules, today: TODAY }).ok, true);
});

test('insecticides and fungicides rotate on their own sequences', () => {
  const state = farm({ sprays: [spray('mancozeb', day(-3))] });
  assert.equal(rotationVerdict(state, 'c1', 'cypermethrin', { rules, today: TODAY }).ok, true,
    'a FRAC spray does not block an IRAC one');
});

test('rotation is judged per zone', () => {
  const state = farm({ sprays: [{ ...spray('mancozeb', day(-10)), cycleId: 'c2' }] });
  assert.equal(rotationVerdict(state, 'c1', 'mancozeb', { rules, today: TODAY }).ok, true);
});

test('Metalaxyl-M is allowed in rotation only, at most every third fungicide', () => {
  const state = farm({ sprays: [
    spray('metalaxyl_m_mancozeb', day(-30)),
    spray('copper_oxychloride', day(-15)),
  ] });
  const verdict = rotationVerdict(state, 'c1', 'metalaxyl_m_mancozeb', { rules, today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'metalaxyl-interval');

  const third = farm({ sprays: [
    spray('metalaxyl_m_mancozeb', day(-40)),
    spray('copper_oxychloride', day(-28)),
    spray('mancozeb', day(-14)),
  ] });
  // M3 last, so Metalaxyl-M's own M3 half still collides — the rules' sequence
  // puts Copper Oxychloride between them, and that is what this asserts.
  assert.equal(rotationVerdict(third, 'c1', 'metalaxyl_m_mancozeb', { rules, today: TODAY }).reason, 'rotation');
});

test('copper sprayed as wound care after pruning is left out of the FRAC count', () => {
  const state = farm({ sprays: [spray('copper_oxychloride', day(-5), { purpose: 'wound care' })] });
  assert.equal(rotationVerdict(state, 'c1', 'copper_hydroxide', { rules, today: TODAY }).ok, true);
});

test('a spray logged before the catalogue existed still counts against the rotation', () => {
  // The legacy record carries productId "mancozeb" and group "FRAC M03".
  const state = farm({ sprays: [{ id: 'old', cycleId: 'c1', productId: 'mancozeb',
    productName: 'Mancozeb 80% WP', date: day(-9) }] });
  assert.equal(rotationVerdict(state, 'c1', 'mancozeb', { rules, today: TODAY }).reason, 'rotation');
});

test('a refusal says which lines of the rules produced it', () => {
  const state = farm({ sprays: [spray('cypermethrin', day(-10))] });
  const verdict = rotationVerdict(state, 'c1', 'lambda_cyhalothrin', { rules, today: TODAY });

  assert.ok(verdict.sources.length, 'a gate that cannot show its working gets overridden');
  for (const source of verdict.sources) assert.ok(String(source).startsWith(RULES_FILE), source);
  assert.ok(verdict.sources.includes(ref('insecticide_rotation/rule')));
  assert.ok(verdict.sources.some((s) => /active_ingredients\/\d+\/group/.test(s)));
});

// --- The thrips programme, by group ----------------------------------------

test('the thrips programme is the four groups the rules name', () => {
  const programme = thripsProgramme(cat(), rules);
  assert.deepEqual(programme.options.map((o) => o.groupText), ['IRAC 5', 'IRAC 6', 'IRAC 28', 'IRAC 4A']);
  assert.deepEqual(programme.options[0].actives.map((a) => a.name), ['Spinosad', 'Spinetoram']);
  assert.deepEqual(programme.options[3].actives.map((a) => a.name), ['Thiamethoxam'],
    'IRAC 4A offers thiamethoxam, which is the one the rules name');
});

test('a product outside the thrips programme is refused for thrips', () => {
  const verdict = rotationVerdict(farm(), 'c1', 'cypermethrin', { rules, today: TODAY, target: 'thrips' });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'thrips-programme');
  assert.match(verdict.fix, /IRAC 5, IRAC 6, IRAC 28, IRAC 4A/);
  assert.equal(rotationVerdict(farm(), 'c1', 'cypermethrin', { rules, today: TODAY }).ok, true,
    'the same product against caterpillars is fine — it is the thrips programme that is by group');
});

test('thrips treatments rotate by group, never the same group twice running', () => {
  const state = farm({ sprays: [spray('spinosad', day(-7), { targetProblem: 'thrips' })] });

  assert.equal(rotationVerdict(state, 'c1', 'spinosad', { rules, today: TODAY, target: 'thrips' }).reason,
    'rotation', 'IRAC 5 twice running');
  assert.equal(rotationVerdict(state, 'c1', 'chlorantraniliprole',
    { rules, today: TODAY, target: 'thrips' }).ok, true, 'IRAC 28 is the next group along');
});

test('the thrips programme only offers what the farm can actually dose', () => {
  // Abamectin and emamectin (IRAC 6) have no rate until a label is entered, so
  // a refusal must not send somebody looking for them.
  const verdict = rotationVerdict(farm(), 'c1', 'cypermethrin', { rules, today: TODAY, target: 'thrips' });
  assert.ok(!verdict.alternatives.some((a) => /Abamectin|Emamectin/.test(a)));
  assert.ok(verdict.alternatives.some((a) => /Spinosad/.test(a)));
});

// --- Week 10: organics only, with repeated M1 allowed ----------------------

test('the week is counted the way the rules count it', () => {
  assert.equal(cropWeek({ transplantDate: '2026-09-21' }, '2026-09-21'), 0, 'transplant day is Week 0');
  assert.equal(cropWeek({ transplantDate: '2026-09-21' }, '2026-09-27'), 0, 'days 1-7 are Week 0');
  assert.equal(cropWeek({ transplantDate: '2026-09-21' }, '2026-09-28'), 1);
  assert.equal(cropWeek({ transplantDate: '2026-09-21' }, '2026-11-30'), 10);
});

test('the Week 10 organics are the three the rule names', () => {
  assert.deepEqual(week10Actives(cat(), rules).actives.map((a) => a.name),
    ['Azadirachtin / neem oil', 'Garlic-chilli extract (farm-made)', 'Copper hydroxide']);
});

test('from Week 10 a synthetic is refused outright', () => {
  const state = farm({ cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell',
    transplantDate: day(-71), status: 'active' } } });
  const verdict = rotationVerdict(state, 'c1', 'mancozeb', { rules, today: TODAY });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'week-10');
  assert.equal(verdict.week, 10);
  assert.match(verdict.why, /organics only/);
  assert.ok(verdict.sources.includes(ref('rei/week_10_rule')));
});

test('from Week 10 repeated Copper Hydroxide is allowed, at 10-14 day intervals', () => {
  const week10 = { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-80), status: 'active' } };

  const tooSoon = farm({ cycles: week10, sprays: [spray('copper_hydroxide', day(-4))] });
  const early = rotationVerdict(tooSoon, 'c1', 'copper_hydroxide', { rules, today: TODAY });
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'interval', 'repeated M1 is allowed, but not back to back');

  const due = farm({ cycles: week10, sprays: [spray('copper_hydroxide', day(-12))] });
  const later = rotationVerdict(due, 'c1', 'copper_hydroxide', { rules, today: TODAY });
  assert.equal(later.ok, true, 'this is the one exception to "never the same FRAC twice"');
  assert.equal(later.exception, 'week-10-m1');
  assert.ok(later.sources.includes(ref('fungicide_rotation/week_10_exception')));
});

test('before Week 10 the M1 exception does not apply', () => {
  const state = farm({ sprays: [spray('copper_oxychloride', day(-12))] });
  assert.equal(rotationVerdict(state, 'c1', 'copper_hydroxide', { rules, today: TODAY }).reason, 'rotation');
});

test('neem may be repeated, because IRAC UN is not a resistance group', () => {
  // The Week 10 programme depends on it: neem is one of three products left and
  // the guidance is to repeat it every 5-7 days.
  const state = farm({ sprays: [spray('azadirachtin_neem_oil', day(-6))] });
  assert.equal(rotationVerdict(state, 'c1', 'azadirachtin_neem_oil', { rules, today: TODAY }).ok, true);
});

// --- Migrating the store onto actives --------------------------------------

/** The farm as it was before the catalogue: items by name, sprays by product id. */
function legacyFarm() {
  const events = [
    { id: 'e1', type: 'plot.upsert', at: '2026-01-01T09:00:00Z', payload: { id: 'gh1', name: 'GH-01' } },
    { id: 'e2', type: 'cycle.start', at: '2026-01-02T09:00:00Z',
      payload: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-20) } },
    ...[
      { id: 'i1', name: 'Mancozeb 80% WP', kind: 'chemical', unit: 'kg', qty: 6 },
      { id: 'i2', name: 'Neem oil', kind: 'chemical', unit: 'litre', qty: 3 },
      { id: 'i3', name: 'Copper Oxychloride 50WP', kind: 'chemical', unit: 'kg', qty: 2 },
      { id: 'i4', name: 'Rocket Force 200', kind: 'chemical', unit: 'litre', qty: 1 },
      { id: 'i5', name: 'NPK 12-12-17+2MgO', kind: 'fertiliser', unit: 'bag', qty: 4 },
      { id: 'i6', name: 'Harvest crates', kind: 'consumable', unit: 'piece', qty: 40 },
    ].map((payload, i) => ({ id: `ei${i}`, type: 'input.upsert', at: '2026-01-03T09:00:00Z', payload })),
    ...[
      { productId: 'mancozeb', productName: 'Mancozeb 80% WP', date: day(-40) },
      { productId: 'neem', productName: 'Neem oil', date: day(-30) },
      { productId: 'copper_oxychloride', productName: 'Copper oxychloride', date: day(-20) },
      { productId: 'spinosad', productName: 'Spinosad', date: day(-12) },
    ].map((payload, i) => ({ id: `es${i}`, type: 'spray.record', at: `${payload.date}T17:00:00Z`,
      payload: { id: `sp${i}`, cycleId: 'c1', ...payload } })),
  ];
  return { events, state: reduce(events) };
}

test('migration puts every store chemical onto an active, and says which it could not', () => {
  const { state } = legacyFarm();
  const plan = planStockMigration(state, cat(state));

  const byItem = Object.fromEntries(plan.items.map((r) => [r.itemId, r.activeId]));
  assert.equal(byItem.i1, 'mancozeb');
  assert.equal(byItem.i2, 'azadirachtin_neem_oil');
  assert.equal(byItem.i3, 'copper_oxychloride');
  assert.equal(byItem.i4, null, 'a brand name identifies no active, and is not guessed at');
  assert.equal(byItem.i5, null, 'fertiliser is not a pesticide');

  assert.deepEqual(plan.unmatchedChemicals.map((r) => r.name), ['Rocket Force 200']);
});

test('migration keeps every past treatment record intact', () => {
  const { events, state } = legacyFarm();
  const catalogue = cat(state);
  const plan = planStockMigration(state, catalogue);

  const after = reduce([...events, ...migrationEvents(plan).map((e, i) => ({
    id: e.eventId, type: e.type, at: `2026-09-21T10:0${i}:00Z`, by: 'u_mgr', payload: e.payload,
  }))]);

  assert.equal(plan.treatmentsBefore, 4);
  assert.equal(plan.treatmentsAfter, plan.treatmentsBefore, 'the migration writes no spray record at all');
  assert.equal(after.sprays.length, state.sprays.length, 'and none is lost, changed or duplicated');
  assert.deepEqual(after.sprays.map((s) => s.id), state.sprays.map((s) => s.id));
  assert.deepEqual(after.sprays.map((s) => s.date), state.sprays.map((s) => s.date));

  // And each of them still resolves to its active, which is what makes the
  // rotation gate able to read the farm's own history.
  assert.equal(plan.treatmentsResolved, 4);
  assert.equal(plan.treatmentsUnresolved, 0);
  assert.equal(after.inputs.i1.activeId, 'mancozeb', 'what the migration did write is the match');
  assert.equal(after.inputs.i1.name, 'Mancozeb 80% WP', 'without disturbing the item itself');
  assert.equal(after.inputs.i1.qty, 6);
});

test('running the migration twice changes nothing', () => {
  const { events, state } = legacyFarm();
  const plan = planStockMigration(state, cat(state));
  const written = migrationEvents(plan).map((e, i) => ({
    id: e.eventId, type: e.type, at: `2026-09-21T10:0${i}:00Z`, by: 'u_mgr', payload: e.payload,
  }));
  const once = reduce([...events, ...written]);
  const twice = reduce([...events, ...written, ...written]);

  assert.deepEqual(Object.keys(twice.inputs), Object.keys(once.inputs));
  assert.equal(twice.sprays.length, once.sprays.length);

  const second = planStockMigration(once, cat(once));
  assert.equal(second.matched.length, 0, 'nothing left to write');
  assert.equal(second.alreadyDone.length, 3);
});

test('a store item name is matched on its active, not on its formulation', () => {
  const catalogue = cat();
  assert.equal(resolveActive(catalogue, 'Mancozeb 80% WP').id, 'mancozeb');
  assert.equal(resolveActive(catalogue, 'Copper Oxychloride 50WP').id, 'copper_oxychloride');
  assert.equal(resolveActive(catalogue, 'neem').id, 'azadirachtin_neem_oil');
  assert.equal(resolveActive(catalogue, 'copper'), null, 'two coppers: better nothing than the wrong one');
  assert.equal(resolveActive(catalogue, 'Rocket Force 200'), null);
});

// --- The server refuses it too ---------------------------------------------
//
// Ported from the second catalogue branch (claude/active-ingredient-catalogue-
// rules-rspcs3), which built the same requirements independently and tested
// the server side of them where this branch tested only the app. The phone is
// the thing an attacker controls, and five handsets merging a log is how a bad
// record would otherwise arrive, so each of these is checked in both places.

const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const OWNER_S = { id: 'u_owner', role: 'ceo' };
const MANAGER_S = { id: 'u_mgr', role: 'manager' };
const AGRONOMIST_S = { id: 'u_agro', role: 'agronomist' };
const SUPERVISOR_S = { id: 'u_sup', role: 'supervisor' };
const HAND_S = { id: 'u_hand', role: 'hand' };

test('the server keeps its banned list in step with the rules file', () => {
  assert.deepEqual(core.BANNED_ACTIVES, rules.labels.banned,
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
  const event = { id: 'a2', type: 'active.add',
    payload: { id: 'pymetrozine', name: 'Pymetrozine', group: 'IRAC 9B' } };
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
    payload: { id: 'lb', brand: 'Punch', activeIds: ['spinosad'], rate: '0.35 ml/L' } };
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

test('the server refuses a store item linked to a banned active', () => {
  // Here the link is the migration's own record: an input.upsert that names
  // the active a store item was always made of.
  const good = { id: 'k1', type: 'input.upsert', payload: { id: 'i1', activeId: 'mancozeb' } };
  assert.equal(core.mayWrite(good, SUPERVISOR_S).ok, true);
  assert.equal(core.mayWrite(good, HAND_S).ok, false);

  const bad = { id: 'k2', type: 'input.upsert', payload: { id: 'i1', activeId: 'carbofuran' } };
  assert.equal(core.mayWrite(bad, MANAGER_S).ok, false);

  const smuggled = { id: 'k3', type: 'input.upsert',
    payload: { id: 'i2', name: 'Furadan 3G', kind: 'chemical', qty: 5 } };
  assert.equal(core.mayWrite(smuggled, MANAGER_S).ok, false, 'nor under its brand name');
});

// --- Also ported: what the rules file being half there should do ------------

test('a rules document that is not rev 5.1 is refused rather than half-loaded', () => {
  assert.throws(() => rulesModuleSetRules({ meta: { version: 'x' } }), /active_ingredients/i,
    'an empty catalogue would pass every rotation check silently');
  rulesModuleSetRules(rules);            // put the real document back for the rest of the file
});

test('a name that could be two actives resolves to neither', () => {
  // Ported: better no answer than the wrong one when a store label is ambiguous.
  assert.equal(resolveActive(cat(), 'copper'), null);
  assert.equal(resolveActive(cat(), 'Copper Hydroxide 50WP').id, 'copper_hydroxide');
});

test('the catalogue says which version of the rules it was built from', () => {
  assert.equal(rules.meta.version, 'rules-1.4');
  assert.match(ref('active_ingredients/0/group'), new RegExp(`^${RULES_FILE.replace('.', '\\.')}#/`));
});
