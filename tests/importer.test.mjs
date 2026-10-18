// Bringing existing records in — Phase 2, and the Owner's decision of 18
// October 2026: from spreadsheets, paper reports and hand-filled sheets.
//
// The promises this file holds the importer to: every row is checked and shown
// before anything is saved; unknown stays unknown; a possible duplicate is left
// out unless the person says otherwise; a whole import can be undone without
// deleting anything; and history is kept apart, so it never stands in for a
// live harvest, spray or treatment and never moves a gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const imp = await import('../web/js/domain/importer.js');
const { reduce } = await import('../web/js/store.js');
const core = await import('../server/core.mjs');
const { JUDGED } = await import('../server/judge.mjs');
const { harvestCheck } = await import('../web/js/domain/onboarding.js');

const TODAY = '2026-10-18';
const at = (d, h = 8) => `${d}T0${h}:00:00.000Z`;
const farm = [
  { id: 'p1', type: 'plot.upsert', at: at('2026-01-01'), by: 'c', payload: { id: 'gh1', name: 'GH-01', type: 'greenhouse' } },
  { id: 'p2', type: 'plot.upsert', at: at('2026-01-01'), by: 'c', payload: { id: 'gh2', name: 'GH-02', type: 'greenhouse' } },
  { id: 'p3', type: 'plot.upsert', at: at('2026-01-01'), by: 'c', payload: { id: 'of1', name: 'OF-01', type: 'field' } },
];
const state = reduce(farm);

// --- Reading what people actually have ------------------------------------------

test('a .csv with quotes, commas inside numbers and a line break inside a note', () => {
  const t = imp.parseTable('﻿Date,House,Kg,Notes\r\n14/03/2026,GH-01,"1,200","two pickers,\nmorning"\r\n\r\n15/03/2026,GH-02,30,\r\n');
  assert.deepEqual(t.headers, ['Date', 'House', 'Kg', 'Notes']);
  assert.equal(t.rows.length, 2, 'the blank line is dropped');
  assert.equal(t.rows[0][2], '1,200');
  assert.equal(t.rows[0][3], 'two pickers,\nmorning');
});

test('cells pasted from Excel or Google Sheets arrive tab-separated, and a semicolon file is read too', () => {
  const pasted = imp.parseTable('Date\tBuyer\tKg\tTotal\n14/03/2026\tMama Nkechi\t40\t₦160,000\n');
  assert.deepEqual(pasted.rows[0], ['14/03/2026', 'Mama Nkechi', '40', '₦160,000']);
  const semi = imp.parseTable('Date;Item;Amount\n01/02/2026;Diesel;45000\n');
  assert.deepEqual(semi.rows[0], ['01/02/2026', 'Diesel', '45000']);
});

test('columns are matched from the headings a farm book uses, and every guess can be changed', () => {
  assert.deepEqual(imp.suggestMapping(['Date', 'Greenhouse', 'Weight (kg)', 'No of crates', 'Remarks'], 'harvest'),
    { date: 0, zone: 1, kg: 2, crates: 3, grade: null, crop: null, picker: null, note: 4 });
  const sale = imp.suggestMapping(['Date', 'Customer', 'Qty', 'Unit price', 'Amount', 'Payment status'], 'sale');
  assert.equal(sale.buyer, 1);
  assert.equal(sale.kg, 2);
  assert.equal(sale.pricePerKg, 3);
  assert.equal(sale.total, 4);
  assert.equal(sale.paid, 5);
  assert.equal(imp.suggestMapping(['Particulars', 'Date', 'Naira'], 'expense').item, 0);
});

test('dates as Nigerian books write them, day first; an impossible date is refused, never guessed', () => {
  for (const [raw, want] of [['14/03/2026', '2026-03-14'], ['14/3/26', '2026-03-14'], ['14-03-2026', '2026-03-14'],
    ['14.03.2026', '2026-03-14'], ['2026-03-14', '2026-03-14'], ['14 Mar 2026', '2026-03-14'],
    ['14th March 2026', '2026-03-14'], ['March 14, 2026', '2026-03-14'], ['45730', '2025-03-14'], ['03/04/2026', '2026-04-03']]) {
    assert.equal(imp.readDate(raw).value, want, raw);
  }
  assert.match(imp.readDate('31/02/2026').error, /not a real date/);
  assert.match(imp.readDate('last Tuesday').error, /Write it like 14\/03\/2026/);
  assert.equal(imp.readDate('').value, null, 'empty is unknown');
});

test('numbers as people write them; an empty cell is unknown, not zero', () => {
  assert.equal(imp.readNumber('1,200').value, 1200);
  assert.equal(imp.readNumber('₦45,000').value, 45000);
  assert.equal(imp.readNumber('N3500').value, 3500);
  assert.equal(imp.readNumber('12.5kg').value, 12.5);
  assert.equal(imp.readNumber('').value, null);
  assert.match(imp.readNumber('-4').error, /less than nothing/);
  assert.match(imp.readNumber('about 40').error, /not a number/);
  assert.equal(imp.readPaid('Owing').value, 'unpaid');
  assert.equal(imp.readPaid('part payment').error !== undefined, true);
  assert.equal(imp.readPaid('').value, null);
});

test('a zone is found however it is written, and a zone the farm does not have is an error', () => {
  for (const raw of ['GH-01', 'gh1', 'GH 01', 'Greenhouse 1', 'gh-1']) assert.equal(imp.findZone(state, raw).value, 'gh1', raw);
  assert.equal(imp.findZone(state, 'of 1').value, 'of1');
  assert.match(imp.findZone(state, 'GH-09').error, /No zone called "GH-09"/);
});

// --- Checking every row before anything is saved --------------------------------

const harvestRows = [
  ['14/03/2026', 'GH-01', '42', '', 'A'],          // 2: fine
  ['', 'GH-01', '10', '', ''],                     // 3: no date
  ['15/03/2026', 'GH-09', '10', '', ''],           // 4: unknown zone
  ['16/03/2026', 'GH-02', '', '', ''],             // 5: neither kg nor crates
  ['17/03/2026', '', '20', '', ''],                // 6: no zone written: a warning, not an error
  ['14/03/2026', 'gh1', '42', '', 'A'],            // 7: same as line 2
  ['01/12/2026', 'GH-01', '5', '', ''],            // 8: after today
];
const harvestMap = { date: 0, zone: 1, kg: 2, crates: 3, grade: 4, crop: null, picker: null, note: null };

test('every row is checked and each problem says what is wrong in words', () => {
  const c = imp.checkRows(harvestRows, harvestMap, 'harvest', state, { today: TODAY });
  const by = Object.fromEntries(c.rows.map((r) => [r.line, r]));
  assert.equal(by[2].status, 'ok');
  assert.match(by[3].problems.join(), /Date is empty/);
  assert.match(by[4].problems.join(), /No zone called "GH-09"/);
  assert.match(by[5].problems.join(), /Kilograms or Crates/);
  assert.equal(by[6].status, 'warn');
  assert.match(by[6].warnings.join(), /farm's totals/);
  assert.equal(by[6].values.zoneId, null, 'unknown stays unknown');
  assert.equal(by[7].duplicate, 'same as line 2');
  assert.match(by[8].problems.join(), /after today/);
  assert.equal(c.error, 4);
  assert.equal(by[2].values.crates, null, 'an empty crates cell is not 0');
  assert.equal(by[6].values.grade, null, 'a missing grade is not grade A');
});

test('a row already on the farm, live or imported, is a possible duplicate', () => {
  const withLive = reduce([...farm,
    { id: 'cy', type: 'cycle.start', at: at('2026-02-01'), by: 'c', payload: { id: 'cy1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-02-01' } },
    { id: 'hv', type: 'harvest.record', at: at('2026-03-14'), by: 'h', payload: { id: 'hv1', cycleId: 'cy1', date: '2026-03-14', kg: 42 } },
  ]);
  const c = imp.checkRows([harvestRows[0]], harvestMap, 'harvest', withLive, { today: TODAY });
  assert.equal(c.rows[0].duplicate, 'already on the farm');
});

test('a sale whose price × kg disagrees with its total is flagged, and both figures kept as written', () => {
  const map = imp.suggestMapping(['Date', 'Buyer', 'Kg', 'Price per kg', 'Total', 'Paid'], 'sale');
  const c = imp.checkRows([['14/03/2026', 'Mama Nkechi', '40', '4000', '150000', 'yes']], map, 'sale', state, { today: TODAY });
  assert.equal(c.rows[0].status, 'warn');
  assert.match(c.rows[0].warnings.join(), /Both are kept as written/);
  assert.equal(c.rows[0].values.total, 150000);
  assert.equal(c.rows[0].values.paid, 'paid');
});

// --- Saving, the report, and undoing ---------------------------------------------

test('only checked rows are filed; duplicates only when chosen; saving twice files nothing new', () => {
  const c = imp.checkRows(harvestRows, harvestMap, 'harvest', state, { today: TODAY });
  const opts = { kind: 'harvest', importId: 'imp_a', source: 'spreadsheet', fileName: 'book.csv', today: TODAY };
  const events = imp.importEvents(c, opts);
  const lines = events.filter((e) => e.type === 'history.harvest').map((e) => e.payload.line);
  assert.deepEqual(lines, [2, 6], 'errors never; the duplicate not by default');
  assert.equal(events[0].type, 'import.batch');
  assert.deepEqual([events[0].payload.imported, events[0].payload.skippedErrors, events[0].payload.skippedDuplicates], [2, 4, 1]);
  assert.deepEqual(imp.importEvents(c, { ...opts, includeDuplicates: true })
    .filter((e) => e.type === 'history.harvest').map((e) => e.payload.line), [2, 6, 7]);
  assert.deepEqual(imp.importEvents(c, opts).map((e) => e.eventId), events.map((e) => e.eventId), 'ids from the import and the line');
  for (const e of events.slice(1)) assert.equal(e.payload.source, 'spreadsheet', 'every row says where it came from');
});

test('the report says what happened to every line and why', () => {
  const c = imp.checkRows(harvestRows, harvestMap, 'harvest', state, { today: TODAY });
  const csv = imp.importReportCsv(c).split('\n');
  assert.equal(csv.length, harvestRows.length + 1);
  assert.match(csv[1], /^2,"Imported"/);
  assert.match(csv[2], /^3,"Not imported","Date is empty"/);
  assert.match(csv[6], /^7,"Not imported \(possible duplicate\)"/);
});

const toEvents = (list, by = 'c', when = at(TODAY)) => list.map((e, i) => ({ id: e.eventId, type: e.type, at: when, by, payload: e.payload, n: i }));

test('history is kept apart: it never becomes a live harvest, and an undone import drops out without being deleted', () => {
  const c = imp.checkRows(harvestRows, harvestMap, 'harvest', state, { today: TODAY });
  const filed = toEvents(imp.importEvents(c, { kind: 'harvest', importId: 'imp_b', source: 'paper', today: TODAY }));
  let s = reduce([...farm, ...filed]);
  assert.equal(s.harvests.length, 0, 'no live harvest');
  assert.equal(imp.historyRows(s, 'harvest').length, 2);
  assert.equal(s.imports.imp_b.imported, 2);

  s = reduce([...farm, ...filed, { id: 'rv', type: 'import.revert', at: at(TODAY, 9), by: 'c', payload: { id: 'imp_b', reason: 'wrong year' } }]);
  assert.equal(imp.historyRows(s, 'harvest').length, 0, 'undone');
  assert.equal(s.history.harvest.length, 2, 'still in the log');
  assert.equal(s.imports.imp_b.revertReason, 'wrong year');
  // Undone rows no longer count as duplicates of a new, corrected import.
  assert.equal(imp.checkRows([harvestRows[0]], harvestMap, 'harvest', s, { today: TODAY }).rows[0].duplicate, null);
});

test('imported history never moves a waiting period or a gate', () => {
  const live = [...farm,
    { id: 'cy', type: 'cycle.start', at: at('2026-09-01'), by: 'c', payload: { id: 'cy1', plotId: 'gh1', cropId: 'bell', transplantDate: '2026-09-01' } }];
  const before = harvestCheck(reduce(live), 'cy1', new Date(at(TODAY)));
  const c = imp.checkRows([['17/10/2026', 'GH-01', '50', '', '']], harvestMap, 'harvest', reduce(live), { today: TODAY });
  const after = harvestCheck(reduce([...live, ...toEvents(imp.importEvents(c, { kind: 'harvest', importId: 'imp_c', source: 'spreadsheet', today: TODAY }))]), 'cy1', new Date(at(TODAY)));
  assert.deepEqual(after, before);
  assert.ok(!JUDGED.has('history.harvest'), 'not judged as a live harvest, because it is not one');
  assert.ok(!Object.keys(imp.IMPORT_KINDS).some((k) => /spray|treat/.test(k)), 'spray history is not imported here; it goes through Setup');
});

// --- The farm server -------------------------------------------------------------

test('the server knows the same kinds and sources as the app', () => {
  assert.deepEqual(core.IMPORT_KIND_RECORDS, Object.fromEntries(Object.entries(imp.IMPORT_KINDS).map(([k, v]) => [k, v.record])));
  assert.deepEqual(core.IMPORT_SOURCE_IDS, Object.keys(imp.IMPORT_SOURCES));
});

const rec = (type, payload) => ({ id: `e_${type}`, type, at: at(TODAY), payload });
const row = { id: 'r1', importId: 'imp1', source: 'paper', date: '2026-03-14', kg: 5 };

test('only the Farm Manager and the Owner bring records in; money history only the people who run the books', () => {
  for (const role of ['hand', 'supervisor']) {
    assert.equal(core.mayWrite(rec('history.harvest', row), { id: 'x', role }).ok, false, `${role}: harvest history`);
    assert.equal(core.mayWrite(rec('import.batch', { id: 'imp1', kind: 'harvest', source: 'paper' }), { id: 'x', role }).ok, false, role);
  }
  for (const role of ['manager', 'ceo']) {
    assert.equal(core.mayWrite(rec('history.harvest', row), { id: 'x', role }).ok, true, role);
    assert.equal(core.mayWrite(rec('history.sale', { ...row, buyer: 'B' }), { id: 'x', role }).ok, true, role);
  }
  const sale = rec('history.sale', { ...row, buyer: 'B', total: 1000 });
  assert.equal(core.visibleTo(sale, { id: 's', role: 'supervisor' }), null, 'sales history is money');
  assert.ok(core.visibleTo(sale, { id: 'm', role: 'manager' }));
});

test('the server refuses history dated after its import, with negative numbers, or with no import or source', () => {
  const me = { id: 'm', role: 'manager' };
  assert.match(core.mayWrite(rec('history.harvest', { ...row, date: '2026-12-01' }), me).why, /after the day it is imported/);
  assert.match(core.mayWrite(rec('history.harvest', { ...row, kg: -3 }), me).why, /0 or more/);
  assert.match(core.mayWrite(rec('history.harvest', { ...row, importId: null }), me).why, /names its import/);
  assert.match(core.mayWrite(rec('history.harvest', { ...row, source: 'guess' }), me).why, /where the record came from/);
  assert.match(core.mayWrite(rec('import.revert', { id: 'imp1', reason: '' }), me).why, /why/);
  assert.equal(core.mayWrite(rec('import.batch', { id: 'imp1', kind: 'spray', source: 'paper' }), me).ok, false, 'no spray imports');
});

test('a farm hand is never sent imported history', () => {
  const facts = core.emptyScopeFacts();
  const reader = { id: 'h', role: 'hand' };
  const e = { ...rec('history.harvest', row), by: 'c' };
  assert.equal(core.visibleTo(e, reader, core.readScope(facts, reader)), null);
});
