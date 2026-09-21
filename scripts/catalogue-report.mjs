#!/usr/bin/env node
//
// What the catalogue did to this farm's records, in numbers.
//
//   node scripts/catalogue-report.mjs                  # the sample farm
//   node scripts/catalogue-report.mjs farm-export.json # a real export, from Settings
//   node scripts/catalogue-report.mjs '' copper_hydroxide sp_c3   # ask about one product
//
// Three things, because they are the three worth checking by hand:
//
//   1. the catalogue, and which line of the rules file each group came from
//   2. the stock migration, with the treatment count before and after — they
//      must match, because the migration writes no treatment record at all
//   3. one rotation check, traced back to the rules that decided it
//
// It only reads. Nothing here writes to the farm's log.

import { readFileSync } from 'node:fs';

const web = new URL('../web/js/', import.meta.url);
const { loadRules, RULES_FILE } = await import(new URL('domain/rules.js', web).href);
const { reduce } = await import(new URL('store.js', web).href);
const {
  buildCatalogue, canUseActive, planStockMigration, migrationEvents, rateFor,
} = await import(new URL('domain/catalogue.js', web).href);
const { rotationVerdict } = await import(new URL('domain/rotation.js', web).href);

const rules = await loadRules();

async function farmEvents(path) {
  if (path) {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const events = Array.isArray(doc) ? doc : doc.events;
    if (!Array.isArray(events)) throw new Error(`${path} holds no event log`);
    return { events, from: path };
  }
  const { seedSampleFarm } = await import(new URL('sample.js', web).href);
  const events = [];
  await seedSampleFarm({ dispatchMany: async (list) => {
    events.push(...list.map((e, i) => ({ id: `ev_sample_${i}`, ...e })));
  } });
  return { events, from: 'the sample farm (web/js/sample.js)' };
}

const { events, from } = await farmEvents(process.argv[2]);
const before = reduce(events);
const catalogue = buildCatalogue(before, rules);

console.log(`Rules      ${RULES_FILE} (${rules.meta.version})`);
console.log(`Farm log   ${from} — ${events.length} events\n`);

console.log('1. THE CATALOGUE');
console.log(`   ${catalogue.actives.length} actives, ${catalogue.banned.length} banned and absent: `
  + `${catalogue.banned.join(', ')}`);
for (const a of catalogue.actives) {
  const usable = canUseActive(catalogue, a.id);
  console.log(`   ${a.name.padEnd(34)} ${a.group.padEnd(12)} `
    + `${(usable.ok ? rateFor(catalogue, a.id).rate : 'no rate — needs a label').padEnd(42)} `
    + `${a.groupSource.replace(`${RULES_FILE}#/`, '')}`);
}

console.log('\n2. THE STOCK MIGRATION');
const plan = planStockMigration(before, catalogue);
console.log(`   Past treatments before: ${plan.treatmentsBefore}`);
for (const row of plan.items) {
  console.log(`   ${String(row.name).padEnd(28)} ${row.activeId
    ? `→ ${row.active.name} (${row.group})`
    : row.chemical ? '→ no active ingredient found — a person must attach one' : '  not a chemical'}`);
}
const written = migrationEvents(plan);
const after = reduce([...events, ...written.map((e, i) => ({
  id: e.eventId, type: e.type, at: new Date(Date.now() + i).toISOString(), by: 'report', payload: e.payload,
}))]);
const afterPlan = planStockMigration(after, buildCatalogue(after, rules));
console.log(`   Events written: ${written.length}, all input.upsert — no treatment record is touched`);
console.log(`   Past treatments after:  ${afterPlan.treatmentsBefore}`);
console.log(`   Match: ${plan.treatmentsBefore === afterPlan.treatmentsBefore ? 'YES' : 'NO — STOP'}`
  + ` · every treatment still resolves to its active: `
  + `${afterPlan.treatmentsResolved}/${afterPlan.treatmentsBefore}`);

console.log('\n3. ONE ROTATION CHECK, TRACED');
const cycleId = process.argv[4]
  || Object.keys(after.cycles).find((id) => (after.sprays || []).some((s) => s.cycleId === id));
const history = (after.sprays || []).filter((s) => s.cycleId === cycleId);
const candidate = process.argv[3] || 'mancozeb';
console.log(`   Zone ${after.plots[after.cycles[cycleId].plotId].name}, cycle ${cycleId}`);
for (const s of history) console.log(`   sprayed ${s.date}  ${s.productName || s.productId}`);
const verdict = rotationVerdict(after, cycleId, candidate, { catalogue, rules });
console.log(`   asking for: ${candidate}`);
console.log(`   verdict: ${verdict.ok ? 'allowed' : `REFUSED (${verdict.reason})`}`);
if (verdict.why) console.log(`   why: ${verdict.why}`);
if (verdict.fix) console.log(`   fix: ${verdict.fix}`);
console.log('   read from:');
for (const source of verdict.sources || []) console.log(`     ${source}`);
