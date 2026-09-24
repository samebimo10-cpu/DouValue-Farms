// The nursery, seedling batches and the zone register — FR-FARM-01, FR-FARM-04, FR-FARM-05.
//
// "Seedlings carry thrips, tospovirus and damping-off into every block; the
// nursery is the first green bridge." The release check is what stands on
// that bridge, so most of this file is the check refusing a batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const { loadRules } = await import(new URL('rules.js', base).href);
const RULES = await loadRules();
const nursery = await import(new URL('domain/nursery.js', base).href);
const farmMod = await import(new URL('domain/farm.js', base).href);
const { reduce } = await import(new URL('store.js', base).href);
const { canPlant } = await import(new URL('domain/gates.js', base).href);
const { tasksFor } = await import(new URL('domain/schedule.js', base).href);
const core = await import(new URL('../server/core.mjs', import.meta.url).href);
const { withGatesCleared } = await import(new URL('./helpers/gates-cleared.mjs', import.meta.url).href);

const { releaseCheck, nurseryTasks, SEEDLING_CHECK_DAYS } = nursery;

const TODAY = '2026-09-16';            // a Wednesday
const day = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const plots = {
  nur: { id: 'nur', name: 'OF-02', type: 'nursery' },
  gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse', areaM2: 300 },
  old: { id: 'old', name: 'GH-09', type: 'greenhouse', retired: true },
};
const state0 = { plots, people: {}, seedlingBatches: {} };

const batch = (o = {}) => ({
  id: 'b1', label: 'N-1', nurseryZoneId: 'nur', cropId: 'bell', sownDate: day(-40),
  media: 'sterilised', status: 'growing', hardenedFrom: day(-8), checks: [], ...o,
});
const yes = { noVirus: true, noThrips: true, noDampingOff: true };
const check = (b, o = {}) => releaseCheck(state0, b, { date: TODAY, zoneId: 'gh1', answers: yes, rules: RULES, ...o });
const failing = (v) => v.failing.map((f) => f.id);

// --- FR-FARM-05: the release check ------------------------------------------

test('FR-FARM-05: a batch that meets every line of the release check passes', () => {
  const v = check(batch());
  assert.equal(v.ok, true, v.why);
  // The lines are the rules' own, plus clean media from the hygiene rules.
  const labels = v.items.map((i) => i.label);
  for (const line of RULES.nursery.seedling_release_check) assert.ok(labels.includes(line), line);
});

test('FR-FARM-05: hardened fewer than 7 days fails, and says the earliest release day', () => {
  const v = check(batch({ hardenedFrom: day(-6) }));
  assert.deepEqual(failing(v), ['hardened']);
  assert.match(v.failing[0].fix, new RegExp(day(1)));
  assert.deepEqual(failing(check(batch({ hardenedFrom: null }))), ['hardened']);
  assert.equal(check(batch({ hardenedFrom: day(-7) })).ok, true, 'seven days is hardened 7+ days');
});

test('FR-FARM-05: virus, thrips or damping-off not ruled out today fails that line', () => {
  assert.deepEqual(failing(check(batch(), { answers: { ...yes, noVirus: false } })), ['no_virus']);
  assert.deepEqual(failing(check(batch(), { answers: { ...yes, noThrips: undefined } })), ['no_thrips']);
  assert.deepEqual(failing(check(batch(), { answers: { ...yes, noDampingOff: false } })), ['no_damping_off']);
});

test('FR-FARM-05: a tick box does not undo a seedling check that found virus', () => {
  const found = batch({ checks: [{ id: 'c1', date: day(-2), virus: true, thrips: false, dampingOff: false }] });
  const v = check(found);
  assert.deepEqual(failing(v), ['no_virus']);
  assert.match(v.failing[0].why, /found virus/);

  const cleanLater = batch({ checks: [
    { id: 'c1', date: day(-5), virus: false, thrips: true, dampingOff: true },
    { id: 'c2', date: day(-1), virus: false, thrips: false, dampingOff: false },
  ] });
  assert.equal(check(cleanLater).ok, true, 'a later clean check is the one that stands');
});

test('FR-FARM-05: the batch is recorded against a real cropping block', () => {
  assert.deepEqual(failing(check(batch(), { zoneId: null })), ['block_recorded']);
  assert.deepEqual(failing(check(batch(), { zoneId: 'nur' })), ['block_recorded']);
  assert.deepEqual(failing(check(batch(), { zoneId: 'old' })), ['block_recorded']);
  assert.deepEqual(failing(check(batch(), { zoneId: 'nowhere' })), ['block_recorded']);
});

test('FR-FARM-04: seedlings raised in raw block soil fail the release check', () => {
  assert.deepEqual(failing(check(batch({ media: 'raw soil from GH-03' }))), ['clean_media']);
});

test('FR-FARM-05: a batch is released once, and a discarded one never', () => {
  assert.equal(check(batch({ status: 'released', release: { date: day(-1) } })).ok, false);
  assert.equal(check(batch({ status: 'discarded' })).ok, false);
});

// --- The reducer enforces it on replay ------------------------------------------

let n = 0;
const ev = (type, payload, by = 'u_sup', at = `${TODAY}T09:00:00.000Z`) => ({ id: `e${n++}`, type, payload, by, at });
const people = [
  ev('person.upsert', { id: 'u_sup', name: 'Tamuno', role: 'supervisor' }, 'u_owner', '2026-01-01T00:00:00Z'),
  ev('person.upsert', { id: 'u_hand', name: 'Emeka', role: 'hand' }, 'u_owner', '2026-01-01T00:00:00Z'),
  ev('plot.upsert', plots.nur, 'u_owner', '2026-01-01T00:00:00Z'),
  ev('plot.upsert', plots.gh1, 'u_owner', '2026-01-01T00:00:00Z'),
];
const grown = [
  ev('seedling.sow', { id: 'b1', label: 'N-1', nurseryZoneId: 'nur', cropId: 'bell', sownDate: day(-40), media: 'sterilised' },
    'u_sup', `${day(-40)}T09:00:00.000Z`),
  ev('seedling.harden', { batchId: 'b1', date: day(-9) }, 'u_sup', `${day(-9)}T09:00:00.000Z`),
  ev('seedling.check', { id: 'k1', batchId: 'b1', date: day(-2), thrips: false, virus: false, dampingOff: false },
    'u_sup', `${day(-2)}T09:00:00.000Z`),
];
const release = (o = {}, by = 'u_sup') => ev('seedling.release',
  { id: 'b1', zoneId: 'gh1', date: TODAY, answers: yes, ...o }, by, `${TODAY}T10:00:00.000Z`);

test('FR-FARM-05: a passing release check releases the batch to its block', () => {
  const b = reduce([...people, ...grown, release()]).seedlingBatches.b1;
  assert.equal(b.status, 'released');
  assert.equal(b.release.zoneId, 'gh1');
  assert.equal(b.release.by, 'u_sup');
});

test('FR-FARM-05: a failing release check is refused on replay, with the reason kept', () => {
  const b = reduce([...people, ...grown, release({ answers: { ...yes, noThrips: false } })]).seedlingBatches.b1;
  assert.equal(b.status, 'growing');
  assert.match(b.releaseRefused.why, /no thrips on a tap test/);
});

test('FR-FARM-05: a farm hand cannot release a batch, even if the phone lets the record through', () => {
  const b = reduce([...people, ...grown, release({}, 'u_hand')]).seedlingBatches.b1;
  assert.equal(b.status, 'growing');
  assert.match(b.releaseRefused.why, /Field Supervisor/);
  assert.equal(core.EVENT_POLICY['seedling.release'].write, 'verifyHarvest');
  assert.equal(core.can('hand', 'verifyHarvest'), false);
});

test('FR-FARM-05: planting links the batch to the block, and the same batch cannot go in twice', () => {
  const start = (id, at) => ev('cycle.start', { id, plotId: 'gh1', cropId: 'bell', transplantDate: TODAY, seedlingBatchId: 'b1' }, 'u_sup', at);
  const state = reduce([...people, ...grown, release(), start('c1', `${TODAY}T11:00:00.000Z`)]);
  assert.equal(state.seedlingBatches.b1.usedByCycleId, 'c1');
  assert.equal(state.seedlingBatches.b1.plantedAt, TODAY);

  // A second planting naming the same batch is refused at the gate…
  const closed = { ...state, cycles: { ...state.cycles, c1: { ...state.cycles.c1, status: 'closed', closedAt: TODAY } } };
  const v = canPlant(withGatesCleared(closed, { zoneId: 'gh1', plantedOn: TODAY }), 'gh1', { today: TODAY, batchId: 'b1' });
  assert.ok(v.blocking.some((g) => g.id === 'seedling_release'));
  // …and the reducer does not re-link it.
  const again = reduce([...people, ...grown, release(), start('c1', `${TODAY}T11:00:00.000Z`), start('c2', `${TODAY}T12:00:00.000Z`)]);
  assert.equal(again.seedlingBatches.b1.usedByCycleId, 'c1');
});

test('a release stamped before its batch was sown is judged, not lost — and not waved through', () => {
  // A drifting clock puts the release ahead of the sowing. It waits for the
  // batch, then is judged against the batch as it stood at that point in the
  // log: not yet hardened, so refused, with the reason on the record.
  const early = { ...release(), at: `${day(-50)}T10:00:00.000Z` };
  const state = reduce([...people, early, ...grown]);
  const b = state.seedlingBatches.b1;
  assert.equal(b.status, 'growing');
  assert.match(b.releaseRefused.why, /hardened/);
  assert.equal(state.orphans.length, 0, 'nothing left waiting');
});

test('FR-FARM-05 end to end: sow, harden, check, release, then Gate 1 on that block sees it', () => {
  const state = reduce([...people, ...grown, release()]);
  const withRest = withGatesCleared({ ...state, seedlingBatches: state.seedlingBatches }, { zoneId: 'gh1', plantedOn: TODAY });
  // Drop the helper's own batch so only the real one can clear the line.
  delete withRest.seedlingBatches.gh1_ok_batch;
  const v = canPlant(withRest, 'gh1', { today: TODAY, batchId: 'b1' });
  assert.equal(v.ok, true, v.why);
});

// --- FR-FARM-04: the nursery's own work -------------------------------------------

test('FR-FARM-04: the nursery gets a trap count every day, first thing, with a photo', () => {
  const state = { plots, seedlingBatches: {}, cycles: {} };
  const tasks = tasksFor(state, { date: TODAY });
  const traps = tasks.filter((t) => t.zoneId === 'nur');
  assert.deepEqual(traps.map((t) => t.kind), ['nursery_trap']);
  assert.equal(traps[0].due, `${TODAY}T07:00`);
  assert.equal(traps[0].proof, true);
  assert.match(traps[0].how.join(' '), /nursery first/i);
});

test('FR-FARM-04: a seedling check twice a week while batches are growing', () => {
  const state = { plots, seedlingBatches: { b1: batch() }, cycles: {} };
  const week = Array.from({ length: 7 }, (_, i) => day(i));
  const checkDays = week.filter((d) => tasksFor(state, { date: d }).some((t) => t.kind === 'seedling_check'));
  assert.equal(checkDays.length, 2);
  for (const d of checkDays) assert.ok(SEEDLING_CHECK_DAYS.includes(new Date(`${d}T12:00:00`).getDay()));
  // Nothing growing, nothing to check.
  const empty = { plots, seedlingBatches: { b1: batch({ status: 'released' }) }, cycles: {} };
  assert.ok(!week.some((d) => tasksFor(empty, { date: d }).some((t) => t.kind === 'seedling_check')));
});

test('FR-FARM-04: nursery work comes before the blocks in the day', () => {
  const state = {
    plots,
    seedlingBatches: {},
    cycles: { c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-20), status: 'active' } },
  };
  const tasks = tasksFor(state, { date: TODAY });
  assert.equal(tasks[0].zoneId, 'nur');
  // And the ids are stable, so five phones make one task.
  assert.deepEqual(nurseryTasks(state, { date: TODAY, taskIdFor: (d, z, k) => `${d}_${z}_${k}` }).map((t) => t.id),
    [`${TODAY}_nur_nursery_trap`]);
});

test('FR-FARM-04: the hygiene rules shown are the rules file\'s', () => {
  assert.deepEqual(nursery.hygieneRules(RULES), RULES.nursery.rules);
  assert.equal(nursery.hardenDays(RULES), 7);
});

test('FR-FARM-04: the server refuses a batch raised in anything but clean media', () => {
  const guard = core.EVENT_POLICY['seedling.sow'].guard;
  assert.equal(guard({ payload: { id: 'b', nurseryZoneId: 'nur', media: 'raw' } }).ok, false);
  assert.equal(guard({ payload: { id: 'b', nurseryZoneId: 'nur', media: 'sterilised' } }).ok, true);
  const rel = core.EVENT_POLICY['seedling.release'].guard;
  assert.equal(rel({ payload: { id: 'b' } }).ok, false, 'a release names the block');
  assert.equal(rel({ payload: { id: 'b', zoneId: 'gh1' } }).ok, true);
});

// --- FR-FARM-01: the real zones for a new farm -----------------------------------

test('FR-FARM-01: a new farm starts with GH-01 to GH-05, OF-01, OF-02 (nursery), OF-03 and RUK-01', () => {
  const zones = farmMod.realZones(RULES);
  assert.deepEqual(zones.map((z) => z.name).sort(),
    ['GH-01', 'GH-02', 'GH-03', 'GH-04', 'GH-05', 'OF-01', 'OF-02', 'OF-03', 'RUK-01']);
  const by = Object.fromEntries(zones.map((z) => [z.name, z]));
  assert.equal(by['OF-02'].type, 'nursery');
  assert.equal(by['GH-04'].protocol, 'clean-restart');
  assert.equal(by['GH-05'].protocol, 'clean-restart');
  assert.equal(by['GH-01'].protocol, null);
  assert.equal(by['OF-01'].type, 'field');
  assert.equal(by['RUK-01'].type, 'field');
  assert.equal(by['RUK-01'].rulesType, 'open_field_ridge');
  assert.equal(by['RUK-01'].spacingCm, 40);
  assert.equal(farmMod.zoneTypeLabel(by['RUK-01']), 'Open field, ridges');
  assert.equal(by['GH-01'].id, 'zone_gh-01', 'stable ids, so two phones setting up agree');
});

test('FR-FARM-01: the first-run records create the Owner and the zones, and replay into a farm', () => {
  const events = farmMod.newFarmEvents({ farmName: 'DouValue Farms Limited', owner: { id: 'o1', name: 'Ebimo' }, rules: RULES })
    .map((e, i) => ({ ...e, id: `f${i}`, at: '2026-09-01T08:00:00.000Z', by: 'o1' }));
  const state = reduce(events);
  assert.equal(state.people.o1.role, 'ceo');
  assert.equal(Object.keys(state.plots).length, 9);
  assert.equal(state.plots['zone_of-02'].type, 'nursery');
  // With no rules there is no register, and nothing is guessed.
  assert.equal(farmMod.newFarmEvents({ owner: { id: 'o1' }, rules: null }).filter((e) => e.type === 'plot.upsert').length, 0);
});

test('FR-FARM-01: the sample farm is left as it is', () => {
  const src = readFileSync(new URL('../web/js/sample.js', import.meta.url), 'utf8');
  assert.ok(!/realZones|newFarmEvents|domain\/farm\.js/.test(src), 'the sample farm does not use the real register');
  for (const bed of ['sp_b1', 'sp_b2', 'sp_b3', 'sp_b4']) assert.ok(src.includes(`'${bed}'`), bed);
});

// --- The rules and their readable copy stay in step (CLAUDE.md) -------------------

test('the clean-restart protocol in the rules JSON is in docs/build-rules.md word for word', () => {
  const md = readFileSync(new URL('../docs/build-rules.md', import.meta.url), 'utf8');
  const cr = RULES.clean_restart;
  assert.deepEqual(cr.zones, ['GH-04', 'GH-05']);
  for (const step of cr.steps) {
    assert.ok(md.includes(step.name), step.name);
    for (const line of step.pass_all) assert.ok(md.includes(line), line);
  }
  assert.ok(md.includes(cr.gate_rule));
  assert.ok(md.includes(`rules-${RULES.meta.version.replace('rules-', '')}`));
  // The register marks exactly those two houses.
  assert.deepEqual(RULES.zones.filter((z) => z.protocol === 'clean-restart').map((z) => z.id), cr.zones);
});
