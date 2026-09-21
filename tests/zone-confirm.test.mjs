// Confirming the zone at the start of a task — UX-12, FR-PROOF-03, FR-FARM-03.
//
// The photo proves the work happened. It does not prove where. A trap
// photographed in GH-02 and filed against GH-01 leaves both houses wrong: one
// with a count that is not its own, and one that looks checked and is not.
//
// The encoder and the code format are tested in qr.test.mjs. This file is about
// the behaviour around them: what the app offers when the phone can scan and
// when it cannot, what happens when somebody scans the wrong door, and whether
// the confirmation actually lands on the record.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const store = await import(new URL('store.js', base).href);
const { judgeZoneStart, zoneStamp, ZONE_CONFIRMED } = await import(new URL('domain/proof.js', base).href);
const { scanSupported, zoneListSheet, zonePicker } = await import(new URL('ui/scan.js', base).href);
const { zoneCodesView } = await import(new URL('ui/zones.js', base).href);
const { zoneCode } = await import(new URL('domain/qr.js', base).href);

const GH1 = { id: 'gh1', name: 'GH-01', type: 'greenhouse' };
const GH2 = { id: 'gh2', name: 'GH-02', type: 'greenhouse' };
const TASK = { id: 'gen_2026-09-21_gh1_scout', kind: 'scout', zoneId: 'gh1',
  title: 'Scout and count — GH-01' };

// --- UX-12: scanning is offered first, and the list is always there --------

test('scanning is offered first where the phone can do it', () => {
  const picker = zonePicker({ supported: true });
  assert.equal(picker.offer, 'scan');
  assert.equal(picker.primary.act, 'scan-zone');
  assert.equal(picker.fallback.act, 'pick-zone', 'the list is still one tap away');
});

test('a phone with no barcode reader gets the list, and is told why', () => {
  // Plenty of cheap Android handsets have no BarcodeDetector. That is an
  // ordinary Tuesday, not an error.
  const picker = zonePicker({ supported: false });
  assert.equal(picker.offer, 'list');
  assert.equal(picker.primary.act, 'pick-zone');
  assert.equal(picker.fallback, null);
  assert.match(picker.why, /cannot scan/);
});

test('support means a reader and a camera, not just one of them', () => {
  assert.equal(scanSupported({}), false);
  assert.equal(scanSupported({ BarcodeDetector: class {} }), false, 'no camera');
  assert.equal(scanSupported({ navigator: { mediaDevices: { getUserMedia() {} } } }), false,
    'no reader');
  assert.equal(scanSupported({
    BarcodeDetector: class {}, navigator: { mediaDevices: { getUserMedia() {} } },
  }), true);
});

test('the fallback list is a list of this farm\'s zones, big enough to tap', () => {
  const html = zoneListSheet({ plots: { gh1: GH1, gh2: GH2,
    old: { id: 'old', name: 'GH-09', retired: true } } });
  assert.match(html, /GH-01/);
  assert.match(html, /GH-02/);
  assert.ok(!html.includes('GH-09'), 'a retired zone is not somewhere to stand');
  assert.match(html, /class="list big"/, 'UX-03: a target for a gloved thumb');
});

// --- FR-PROOF-03: the confirmation itself ---------------------------------

test('the record says which zone, and how sure the app is about it', () => {
  const scanned = zoneStamp({ zone: GH1, method: 'qr', by: 'u_hand', at: '2026-09-21T07:02:00Z' });
  assert.equal(scanned.zoneId, 'gh1');
  assert.equal(scanned.strength, 'scanned');
  assert.equal(scanned.label, ZONE_CONFIRMED.qr.label);

  const chosen = zoneStamp({ zone: GH1, method: 'list', by: 'u_hand' });
  assert.equal(chosen.strength, 'chosen', 'tapping a list is worth less than scanning a door');
});

test('scanning the wrong door refuses the job, naming both houses', () => {
  const wrong = zoneStamp({ zone: GH2, method: 'qr', by: 'u_hand' });
  const verdict = judgeZoneStart(TASK, wrong);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'wrong-zone');
  assert.match(verdict.why, /GH-02/);
  assert.match(verdict.fix, /house you are standing in/);
});

test('no confirmation does not block the work — it lowers what the record is worth', () => {
  // A door label peels off; a phone has no camera. Refusing the round would
  // mean the house goes unchecked, which is worse than an unconfirmed round.
  const verdict = judgeZoneStart(TASK, null);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.confirmed, false);
  assert.match(verdict.fix, /Scan the code on the door/);
});

test('the right door confirms, whichever way it was chosen', () => {
  for (const method of ['qr', 'list']) {
    const verdict = judgeZoneStart(TASK, zoneStamp({ zone: GH1, method, by: 'u_hand' }));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.confirmed, true);
  }
});

// --- It lands on the record ------------------------------------------------

test('the confirmation is stored with the completed task, not thrown away', () => {
  const at = (h) => `2026-09-21T${String(h).padStart(2, '0')}:00:00.000Z`;
  const state = store.reduce([
    { id: 'e1', type: 'plot.upsert', at: at(5), by: 'system', payload: GH1 },
    { id: 'e2', type: 'task.create', at: at(6), by: 'u_mgr', payload: TASK },
    { id: 'e3', type: 'task.complete', at: at(7), by: 'u_hand', payload: {
      id: TASK.id,
      photo: { dataUrl: 'data:image/jpeg;base64,x', fresh: true, bytes: 40000 },
      note: 'Traps replaced, a few thrips on the GH-01 card',
      zoneCheck: zoneStamp({ zone: GH1, method: 'qr', by: 'u_hand', at: at(7) }),
    } },
  ]);

  const task = state.tasks[TASK.id];
  assert.equal(task.status, 'done');
  assert.equal(task.zoneCheck.zoneId, 'gh1');
  assert.equal(task.zoneCheck.method, 'qr');
  assert.equal(task.zoneCheck.by, 'u_hand');
});

// --- FR-FARM-03: the printable codes --------------------------------------

test('every zone gets a code to print, with its name big enough to read', () => {
  const state = {
    settings: { farmName: 'DouValue Farms Limited' },
    plots: { gh1: GH1, gh2: GH2, old: { id: 'old', name: 'GH-09', retired: true } },
  };
  const html = zoneCodesView.render({ state, user: { role: 'hand' }, store: { state } });

  assert.equal((html.match(/class="qr-card"/g) || []).length, 2, 'one per working zone');
  assert.ok(!html.includes('GH-09'), 'a retired zone needs no door label');
  assert.equal((html.match(/<svg class="qr"/g) || []).length, 2);
  assert.match(html, /aria-label="Zone code for GH-01"/);
  assert.match(html, /scan at the start of every job here/);
  assert.match(html, /data-act="print"/);
});

test('the printed code is the one the app reads back', () => {
  // The same payload function on both ends, so printing and scanning cannot
  // drift apart.
  assert.equal(zoneCode(GH1), 'DOUVALUE:ZONE:gh1');
  const state = { settings: {}, plots: { gh1: GH1 } };
  const html = zoneCodesView.render({ state, user: { role: 'hand' }, store: { state } });
  assert.ok(html.includes('<svg class="qr"'), 'the code is drawn into the page itself');
});

test('a farm with no zones is told what to do first', () => {
  const state = { settings: {}, plots: {} };
  const html = zoneCodesView.render({ state, user: { role: 'hand' }, store: { state } });
  assert.match(html, /No zones to label yet/);
});
