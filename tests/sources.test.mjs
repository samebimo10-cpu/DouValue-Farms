// The source registry — docs/knowledge-layer.md §2, §3 and §8 (session K1).
//
// Two kinds of test here. The first half runs the checks against the real
// rules/sources.json and the real rules file, so a registry edit that bundles
// an NC item or a rules entry that names a source nobody registered goes red
// in CI (FR-KNOW-02: "a build check fails"). The second half feeds the same
// checks deliberately bad fixtures, because a registry with nothing in it
// yet passes every check vacuously, and a check that has never been seen to
// fail is not a check.
//
// The fixtures are made up (example.org, "Fixture guide"). K1 enters no
// source content; that is K2's job, with the Owner approving each one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const RULES = read('rules/douvalue_rules_rev5_1.json');
const REGISTRY = read('rules/sources.json');

const rulesModule = await import(new URL('rules.js', base).href);
rulesModule.setRules(RULES);
const S = await import(new URL('sources.js', base).href);
const { referencesMarkdown } = await import(new URL('../scripts/references.mjs', import.meta.url).href);

const clone = (x) => JSON.parse(JSON.stringify(x));

/** A registry entry with every registry field, overridable. */
const entry = (over = {}) => ({
  id: 'fixture-guide-a',
  title: 'Fixture guide A',
  publisher: 'Fixture publisher',
  kind: 'decision-guide',
  region: 'West Africa',
  licence: 'CC BY-SA 4.0',
  url: 'https://example.org/a',
  bundled: false,
  retrieved: '2026-09-29',
  covers: ['thrips'],
  ...over,
});
const registry = (...sources) => ({ meta: clone(REGISTRY.meta), sources });

// ===========================================================================
// The real files
// ===========================================================================

test('§3: rules/sources.json is a registry — meta, a sources array, and the registry fields documented', () => {
  assert.ok(Array.isArray(REGISTRY.sources));
  for (const f of ['id', 'title', 'publisher', 'kind', 'region', 'licence', 'url', 'bundled', 'retrieved', 'covers']) {
    assert.ok(f in REGISTRY.meta.fields, `the registry documents "${f}"`);
  }
  assert.ok(REGISTRY.meta.kinds.includes('decision-guide'));
});

test('FR-KNOW-00, FR-KNOW-02: the real registry passes every licence check', () => {
  assert.deepEqual(S.registryProblems(REGISTRY), []);
  for (const s of REGISTRY.sources.filter((x) => x.bundled)) {
    assert.ok(S.licenceRecorded(s.licence), `${s.id} is bundled with a licence recorded`);
    assert.ok(!S.isNonCommercial(s.licence), `${s.id} is bundled and not NC`);
  }
});

test('FR-KNOW-04: every triage row, diagnosis card and rules entry carries a sources array', () => {
  for (const row of RULES.triage) assert.ok(Array.isArray(row.sources), `triage row ${row.n}`);
  for (const c of RULES.diagnosis_cards) assert.ok(Array.isArray(c.sources), `card ${c.id}`);
  for (const [section, value] of Object.entries(RULES)) {
    if (!Array.isArray(value) || section === 'zones') continue;
    value.forEach((e, i) => assert.ok(Array.isArray(e.sources), `${section}[${i}] has a sources array`));
  }
  // The zone register is the farm's own layout, not agronomy with a source.
  assert.ok(RULES.zones.every((z) => !('sources' in z)));
});

test('FR-KNOW-04: every sources id in the rules resolves to a registry entry', () => {
  assert.deepEqual(S.unresolvedSources(RULES, REGISTRY), []);
});

test('FR-KNOW-06: docs/references.md is what rules/sources.json generates', () => {
  const committed = readFileSync(new URL('../docs/references.md', import.meta.url), 'utf8');
  assert.equal(committed, referencesMarkdown(REGISTRY),
    'docs/references.md is stale: run `npm run references` and commit the result');
});

test('the loader reads the registry off disk, and a missing one is null, not a crash', async () => {
  const doc = await S.loadSources();
  assert.equal(doc.meta.version, REGISTRY.meta.version);
  S.setSources(null);
  assert.equal(await S.loadSources({ url: 'file:///nowhere/sources.json' }), null);
  S.setSources(REGISTRY);
});

// ===========================================================================
// The checks, seen to fail
// ===========================================================================

test('FR-KNOW-00: a bundled item with no licence recorded fails; linking it is fine', () => {
  for (const licence of ['', 'unknown', 'Not stated', 'check each', 'per publication']) {
    const bad = S.registryProblems(registry(entry({ bundled: true, licence, attribution: 'x' })));
    assert.ok(bad.some((p) => /FR-KNOW-00/.test(p.problem)), `"${licence}" is not a licence`);
    assert.deepEqual(S.registryProblems(registry(entry({ bundled: false, licence }))), []);
  }
  const noUrl = S.registryProblems(registry(entry({ bundled: true, url: '', attribution: 'CABI' })));
  assert.ok(noUrl.some((p) => /no URL/.test(p.problem)));
});

test('FR-KNOW-02: an NC item with bundled content fails; linked, it passes', () => {
  for (const licence of ['CC BY-NC-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-ND 4.0', 'Non-commercial use only']) {
    const bad = S.registryProblems(registry(entry({ bundled: true, licence, attribution: 'CABI' })));
    assert.ok(bad.some((p) => /FR-KNOW-02/.test(p.problem)), `${licence} bundled must fail`);
    assert.deepEqual(S.registryProblems(registry(entry({ licence }))), [], `${licence} linked is fine`);
  }
  assert.ok(!S.isNonCommercial('CC BY-SA 4.0'));
  assert.ok(!S.isNonCommercial('DouValue own'));
});

test('FR-KNOW-01: a bundled CC BY item needs its attribution line', () => {
  const bad = S.registryProblems(registry(entry({ bundled: true })));
  assert.ok(bad.some((p) => /FR-KNOW-01/.test(p.problem)));
  assert.deepEqual(S.registryProblems(registry(entry({ bundled: true, attribution: 'Fixture publisher' }))), []);
});

test('the registry shape: fields, unique slug ids, known kinds, dates', () => {
  const { url, ...noUrl } = entry();
  assert.ok(url);
  assert.ok(S.registryProblems(registry(noUrl)).some((p) => /"url"/.test(p.problem)));
  assert.ok(S.registryProblems(registry(entry(), entry())).some((p) => /twice/.test(p.problem)));
  assert.ok(S.registryProblems(registry(entry({ id: 'Not A Slug' }))).some((p) => /slug/.test(p.problem)));
  assert.ok(S.registryProblems(registry(entry({ kind: 'rumour' }))).some((p) => /kinds/.test(p.problem)));
  assert.ok(S.registryProblems(registry(entry({ retrieved: '29/09/2026' }))).some((p) => /YYYY/.test(p.problem)));
  assert.ok(S.registryProblems(registry(entry({ bundled: 'yes' }))).some((p) => /true or false/.test(p.problem)));
});

test('FR-KNOW-04: an id no registry entry answers to is reported, with where it is', () => {
  const rules = clone(RULES);
  rules.diagnosis_cards[0].sources = ['fixture-guide-a', 'nobody-registered-this'];
  rules.triage[0].sources = 'fixture-guide-a';
  const out = S.unresolvedSources(rules, registry(entry()));
  assert.deepEqual(out.map((o) => [o.where, o.id]), [
    ['triage[row 1]', null],
    [`diagnosis_cards[${rules.diagnosis_cards[0].id}]`, 'nobody-registered-this'],
  ]);
});

// ===========================================================================
// FR-KNOW-05 — "show what it looked at"
// ===========================================================================

const BUNDLED = entry({ id: 'fixture-guide-a', bundled: true, attribution: 'Fixture publisher (CC BY-SA)' });
const LINKED = entry({ id: 'fixture-bulletin-b', title: 'Fixture bulletin B', kind: 'extension-bulletin', licence: 'not stated', url: 'https://example.org/b' });
const LABEL = entry({ id: 'fixture-label-c', title: 'Fixture label C', kind: 'label', url: 'https://example.org/c' });

/** The real rules with fixture ids on the thrips card, a thrips row, Spinosad and G0. */
function sourcedRules() {
  const rules = clone(RULES);
  rules.diagnosis_cards.find((c) => c.id === 'thrips').sources = ['fixture-guide-a'];
  rules.triage.find((r) => r.likely === 'thrips').sources = ['fixture-bulletin-b', 'fixture-guide-a'];
  rules.active_ingredients.find((a) => /spinosad/i.test(a.ai)).sources = ['fixture-label-c'];
  rules.gates.find((g) => g.id === 'G0').sources = ['fixture-bulletin-b'];
  return rules;
}

test('FR-KNOW-05: a bundled source shows its licence line; a linked one does not', () => {
  const reg = registry(BUNDLED, LINKED);
  const [a, b, c] = S.describeSources(['fixture-guide-a', 'fixture-bulletin-b', 'ghost'], reg);
  assert.equal(a.licenceLine, 'Fixture publisher (CC BY-SA). CC BY-SA 4.0. Bundled with the app.');
  assert.equal(b.licenceLine, '');
  assert.equal(b.url, 'https://example.org/b');
  assert.equal(c.known, false);
});

test('FR-KNOW-05: the Doctor\'s treatment plan records the sources behind the card, row and actives', async () => {
  const rules = sourcedRules();
  rulesModule.setRules(rules);
  const { treatmentPlan, gateEvidence, doctorOutput } = await import(new URL('domain/doctor.js', base).href);
  const state = {
    plots: { gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 } },
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-08-12', status: 'active' } },
    inputs: { i_spin: { id: 'i_spin', name: 'Spinosad 45SC', kind: 'chemical', unit: 'litre', qty: 2 } },
    sprays: [], diagnoses: [], scouts: [], soilTests: [], gateEvidence: [], doctorOutputs: [],
  };
  const plan = treatmentPlan(state, { problemId: 'thrips', cycleId: 'c1', today: '2026-09-21', rules });
  assert.deepEqual(plan.sources, ['fixture-guide-a', 'fixture-bulletin-b', 'fixture-label-c']);

  const review = gateEvidence(state, { zoneId: 'gh1', today: '2026-09-21', rules, gates: ['G0'] });
  assert.deepEqual(review.sources, ['fixture-bulletin-b']);

  // A record that read no rules entry names no source, and ids are kept once each.
  assert.deepEqual(doctorOutput({ kind: 'followup', rules }).sources, []);
  assert.deepEqual(doctorOutput({ kind: 'plan', sources: ['x', 'x', 'y'], rules }).sources, ['x', 'y']);
  rulesModule.setRules(RULES);
});

test('FR-KNOW-05: the guided diagnosis names the sources behind its row and card, and only once it names the cause', async () => {
  rulesModule.setRules(sourcedRules());
  // diagnose.js builds its rows and cards from the rules at import, so it is
  // imported here, after the fixture ids are in.
  const { nameCause, TRIAGE } = await import(new URL('domain/diagnose.js', base).href);
  const row = TRIAGE.find((r) => r.likely === 'thrips');
  const draft = { triageRow: row.n, photos: ['p1'], confirmTest: 'tap test', confirmResult: 'thrips on the paper' };
  assert.deepEqual(nameCause(draft).sources, ['fixture-bulletin-b', 'fixture-guide-a']);
  assert.deepEqual(nameCause({ ...draft, photos: [] }).sources, [], 'no cause named, no sources shown');
  rulesModule.setRules(RULES);
});

test('FR-KNOW-05: the list shown under "What it looked at" carries the licence line for bundled ones', async () => {
  S.setSources(registry(BUNDLED, LINKED, LABEL));
  const { sourceItems } = await import(new URL('ui/kit.js', base).href);
  const html = sourceItems(['fixture-guide-a', 'fixture-bulletin-b', 'unregistered-id']);
  const items = html.split('</li>').filter(Boolean);
  assert.equal(items.length, 3);
  assert.match(items[0], /href="https:\/\/example\.org\/a"/);
  assert.match(items[0], /CC BY-SA 4\.0\. Bundled with the app\./);
  assert.match(items[1], /link only/);
  assert.doesNotMatch(items[1], /Bundled/);
  assert.match(items[2], /unregistered-id \(not in the source registry\)/);
  // Only http(s) addresses become links.
  S.setSources(registry(entry({ url: 'javascript:alert(1)' })));
  assert.doesNotMatch(sourceItems(['fixture-guide-a']), /href/);
  S.setSources(REGISTRY);
});

// ===========================================================================
// FR-KNOW-06 — the generator
// ===========================================================================

test('FR-KNOW-06: references.md splits bundled from linked, sorted by id, with the licence', () => {
  const md = referencesMarkdown(registry(LABEL, BUNDLED, LINKED));
  const [bundledPart, linkedPart] = md.split('## Linked only');
  assert.match(bundledPart, /`fixture-guide-a` \| \[Fixture guide A\]\(https:\/\/example\.org\/a\) \|.*\| CC BY-SA 4\.0 \|/);
  assert.doesNotMatch(bundledPart, /fixture-bulletin-b/);
  assert.ok(linkedPart.indexOf('fixture-bulletin-b') < linkedPart.indexOf('fixture-label-c'));
  assert.match(md, /3 \(1 bundled, 2 linked only\)/);
  // Same registry, same file: nothing in it depends on the clock or the order entered.
  assert.equal(md, referencesMarkdown(registry(LINKED, BUNDLED, LABEL)));
});
