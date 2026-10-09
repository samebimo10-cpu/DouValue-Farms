// The sick-plant flow, split by role — FR-DIAG-03, FR-DIAG-07 to FR-DIAG-10.
//
// A Greenhouse Hand reports: zone, photos, where on the plant, how many
// plants, send. The Field Supervisor and the Farm Manager run the guided
// diagnosis, from that report. Three things this file exists to hold:
//
//   1. a hand cannot reach the guided flow — not the screen, not the button,
//      and not the server, which is what matters when the phone is patched;
//   2. a serious report raises its alert with no diagnosis behind it;
//   3. once a diagnosis is confirmed, the hand who reported it sees the answer
//      next to their own photo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const store = await load('store.js');
const sp = await load('domain/sickplant.js');
const dx = await load('domain/diagnose.js');
const { exceptions } = await load('domain/digest.js');
const { diagnoseView, clinicView } = await load('ui/clinic.js');
const { sickPlantView } = await load('ui/sickplant.js');
const { todayView } = await load('ui/worker.js');
const { alertsView } = await load('ui/alerts.js');
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const T0 = '2026-09-30T08:00:00.000Z';
const hoursAfter = (h) => new Date(new Date(T0).getTime() + h * 3600000).toISOString();
const PHOTO = { dataUrl: 'data:image/jpeg;base64,SICKPLANTPHOTO', fresh: true, bytes: 9000 };

const ev = (id, type, payload, by = 'system', at = '2026-09-29T06:00:00.000Z') => ({ id, type, at, by, payload });

/** Emeka holds GH-02, Tamuno supervises it, Ada runs the farm, Chioma owns it. */
function farm(extra = []) {
  return [
    ev('p1', 'person.upsert', { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' }),
    ev('p2', 'person.upsert', { id: 'u_sup', name: 'Tamuno West', role: 'supervisor' }),
    ev('p3', 'person.upsert', { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' }),
    ev('p4', 'person.upsert', { id: 'u_ceo', name: 'Chioma Douglas', role: 'ceo' }),
    ev('p5', 'person.upsert', { id: 'u_sup2', name: 'Bayo Ali', role: 'supervisor' }),
    ev('z1', 'plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }),
    ev('z2', 'plot.upsert', { id: 'gh4', name: 'GH-04', type: 'greenhouse' }),
    ev('a1', 'zone.assign', { id: 'as1', zoneId: 'gh2', personId: 'u_hand', holding: 'primary' }, 'u_mgr'),
    ev('a2', 'zone.assign', { id: 'as2', zoneId: 'gh2', personId: 'u_sup', holding: 'primary' }, 'u_mgr'),
    ...extra,
  ];
}

const answers = (over = {}) => ({
  zoneId: 'gh2', photos: [PHOTO], where: ['old_leaves'], howMany: 'one', spreading: 'no', ...over,
});

/** What the short flow files, as the event it would dispatch. */
function reportEvent(state, over = {}, { id = 'r1', at = T0 } = {}) {
  const { payload } = sp.composeReport(state, 'u_hand', answers(over), { id, now: at });
  return ev(`ev_${id}`, 'report.record', payload, 'u_hand', at);
}

const ctxFor = (state, user) => ({ state, user, store: { state } });

// --- 1. A hand cannot reach the guided flow --------------------------------

test('FR-DIAG-07: only the Field Supervisor and the Farm Manager hold the guided diagnosis', () => {
  const may = (role) => store.can({ role }, 'guideDiagnosis');
  assert.equal(may('hand'), false, 'a Greenhouse Hand');
  assert.equal(may('supervisor'), true, 'the Field Supervisor');
  assert.equal(may('manager'), true, 'the Farm Manager');
  assert.equal(may('ceo'), false);
  // The app and the server agree, role by role.
  for (const role of Object.keys(core.ROLES)) {
    assert.equal(core.can(role, 'guideDiagnosis'), may(role), `${role} disagrees between app and server`);
  }
});

test('FR-DIAG-07: the guided screen is locked to that permission, and a hand has no clinic tab', () => {
  assert.equal(diagnoseView.perm, 'guideDiagnosis');
  const hand = { id: 'u_hand', role: 'hand' };
  assert.equal(store.can(hand, diagnoseView.perm), false, 'the shell refuses a hand this screen');
  assert.equal(store.can(hand, clinicView.perm), false, 'nor the clinic it lives behind');
  assert.equal(store.can(hand, sickPlantView.perm), true, 'but a hand can report a sick plant');
});

test('FR-DIAG-07: the server refuses a diagnosis filed from a hand\'s phone', () => {
  const full = {
    id: 'dx1', engine: dx.RULES_VERSION, cardId: 'acid_soil', triageRow: 23,
    photos: [PHOTO], confirmTest: 'Three-point pH test', confirmResult: 'pH 5.1 on all three',
    reasoning: 'Stunted and purple, roots stubby with dead tips and no galls.',
  };
  const event = { type: 'diagnosis.record', payload: full };
  assert.equal(core.mayWrite(event, { id: 'u_hand', role: 'hand' }).ok, false);
  assert.equal(core.mayWrite(event, { id: 'u_sup', role: 'supervisor' }).ok, true);
  assert.equal(core.mayWrite(event, { id: 'u_mgr', role: 'manager' }).ok, true);
});

test('FR-DIAG-07: nothing a hand sees points at the guided diagnosis', () => {
  const state = store.reduce(farm([reportEvent(store.reduce(farm()), { where: ['wilting'] })]));
  const hand = state.people.u_hand;
  const today = todayView.render(ctxFor(state, hand));
  assert.match(today, /data-to="#\/sick-plant"/, 'My work opens the short report');
  assert.ok(!/#\/diagnose/.test(today), 'and never the guided flow');
  const board = alertsView.render(ctxFor(state, hand));
  assert.match(board, /Sick plants on GH-02/, 'the hand can see the alert their report raised');
  assert.ok(!/#\/diagnose/.test(board), 'but gets no way into the guided flow from it');
});

test('FR-DIAG-07: the report path carries no triage rows, cards, confirm tests or look-alikes', () => {
  // The screen imports nothing from the diagnosis engine, so it cannot show it.
  const source = readFileSync(new URL('ui/sickplant.js', base), 'utf8');
  assert.ok(!/from '\.\.\/domain\/diagnose\.js'/.test(source), 'the report screen imports the diagnosis engine');
  const state = store.reduce(farm());
  const html = sickPlantView.render(ctxFor(state, state.people.u_hand));
  assert.match(html, /Which zone\?/);
  assert.match(html, /GH-02 \(yours\)/, 'the hand\'s own zone is marked and first');
  for (const word of [/triage/i, /confirm test/i, /card/i, /confused with/i, /look-alike/i, /cause/i]) {
    assert.ok(!word.test(html.replace(/class="[^"]*card[^"]*"/g, '')), `the report screen mentions ${word}`);
  }
  // Every answer is a picture choice, with words.
  for (const list of [sp.WHERE_ON_PLANT, sp.HOW_MANY, sp.SPREADING]) {
    for (const choice of list) assert.ok(choice.pic && choice.label, `${choice.id} has a picture and words`);
  }
});

test('FR-DIAG-07: a report needs the zone, a photo, where and how many', () => {
  assert.deepEqual(sp.reportGaps(answers()), []);
  assert.deepEqual(sp.reportGaps(answers({ zoneId: '' })).map((g) => g.id), ['zone']);
  assert.deepEqual(sp.reportGaps(answers({ photos: [] })).map((g) => g.id), ['photos']);
  assert.deepEqual(sp.reportGaps(answers({ where: [] })).map((g) => g.id), ['where']);
  assert.deepEqual(sp.reportGaps(answers({ howMany: '' })).map((g) => g.id), ['howMany']);

  const guard = core.EVENT_POLICY['report.record'].guard;
  const state = store.reduce(farm());
  const filed = sp.composeReport(state, 'u_hand', answers(), { id: 'r1', now: T0 }).payload;
  assert.equal(guard({ payload: filed }).ok, true);
  assert.equal(guard({ payload: { ...filed, photos: [] } }).ok, false, 'no photo');
  assert.equal(guard({ payload: { ...filed, where: ['somewhere'] } }).ok, false, 'an answer that is not a choice');
  assert.equal(guard({ payload: { ...filed, howMany: undefined } }).ok, false, 'no count');
  assert.equal(guard({ payload: { note: 'leaves yellow on bed 3' } }).ok, true, 'a general problem report is as it was');
  // The server repeats the choices; this is what stops the two lists drifting.
  assert.deepEqual(core.SICK_PLANT_WHERE, sp.WHERE_ON_PLANT.map((w) => w.id));
  assert.deepEqual(core.SICK_PLANT_HOW_MANY, sp.HOW_MANY.map((h) => h.id));
});

test('FR-DIAG-08: the report ends by naming who it went to', () => {
  const state = store.reduce(farm());
  const sent = sp.composeReport(state, 'u_hand', answers(), { id: 'r1', now: T0 });
  // The supervisor holding GH-02, not every supervisor; and the Farm Manager.
  assert.deepEqual(sent.payload.sentTo, ['u_sup', 'u_mgr']);
  assert.equal(sp.namesLine(sent.recipients), 'Tamuno West (Field Supervisor) and Ada Briggs (Farm Manager)');
  // A zone nobody supervises goes to every supervisor.
  const other = sp.composeReport(state, 'u_hand', answers({ zoneId: 'gh4' }), { id: 'r2', now: T0 });
  assert.deepEqual(other.payload.sentTo.sort(), ['u_mgr', 'u_sup', 'u_sup2']);
  // The names stay on the record for the hand to read back.
  const after = store.reduce(farm([reportEvent(state)]));
  const html = todayView.render(ctxFor(after, after.people.u_hand));
  assert.match(html, /Sent to Tamuno West \(Field Supervisor\) and Ada Briggs \(Farm Manager\)/);
});

test('FR-DIAG-08: the guided diagnosis opens from the report, for those who may run it', () => {
  const state = store.reduce(farm([reportEvent(store.reduce(farm()))]));
  const sup = clinicView.render(ctxFor(state, state.people.u_sup));
  assert.match(sup, /Sick plant on GH-02/);
  assert.match(sup, /data-act="diagnose-report" data-id="r1"/, 'the supervisor diagnoses from the report');
  const mgr = clinicView.render(ctxFor(state, state.people.u_mgr));
  assert.match(mgr, /data-act="diagnose-report"/, 'so does the Farm Manager');
  const owner = clinicView.render(ctxFor(state, state.people.u_ceo));
  assert.ok(!/data-act="diagnose-report"/.test(owner), 'nobody else gets the button');
  assert.match(owner, /data-to="#\/sick-plant"/, 'they get the report instead');
});

// --- 2. A serious report raises its alert with no diagnosis ----------------

test('FR-DIAG-09: wilting, spreading and many plants are each serious; the rest are not', () => {
  assert.deepEqual(sp.seriousReasons(answers()), []);
  assert.deepEqual(sp.seriousReasons(answers({ where: ['old_leaves', 'wilting'] })), ['wilting']);
  assert.deepEqual(sp.seriousReasons(answers({ spreading: 'yes' })), ['spreading']);
  assert.deepEqual(sp.seriousReasons(answers({ howMany: 'many' })), ['many plants']);
  assert.deepEqual(sp.seriousReasons(answers({ howMany: 'few', spreading: 'unsure' })), []);
  assert.deepEqual(
    sp.seriousReasons(answers({ where: ['wilting'], howMany: 'many', spreading: 'yes' })),
    ['wilting', 'spreading', 'many plants'],
  );
});

test('FR-DIAG-09: a serious report with no diagnosis raises its alert at once', () => {
  const state = store.reduce(farm([reportEvent(store.reduce(farm()), { where: ['wilting'] })]));
  assert.equal(state.diagnoses.length, 0, 'nobody has diagnosed anything');

  const [alert, ...rest] = sp.openReportAlerts(state, { now: T0 });
  assert.equal(rest.length, 0);
  assert.ok(alert, 'the alert is there the moment the report is');
  assert.equal(alert.reportId, 'r1');
  assert.equal(alert.zoneName, 'GH-02');
  assert.deepEqual(alert.reasons, ['wilting']);
  assert.equal(alert.level, 'manager', 'Farm Manager at once (FR-SCOUT-04)');
  assert.equal(alert.ack, null, 'nobody has picked it up');

  // And it climbs the same ladder as a count over its threshold.
  assert.equal(sp.openReportAlerts(state, { now: hoursAfter(4) })[0].level, 'supervisor');
  assert.equal(sp.openReportAlerts(state, { now: hoursAfter(12) })[0].level, 'owner');
  assert.equal(sp.openReportAlerts(state, { now: hoursAfter(24) })[0].level, 'kpi');

  // It is on the board and in the Owner's digest.
  const html = alertsView.render(ctxFor(state, state.people.u_mgr));
  assert.match(html, /Sick plants on GH-02/);
  assert.match(html, /nobody has started a diagnosis yet/);
  const lines = exceptions(state, { now: hoursAfter(13) }).map((x) => x.line);
  assert.ok(lines.some((l) => /Sick plants on GH-02 — wilting/.test(l)), lines.join('\n'));
});

test('FR-DIAG-09: a report that is not serious raises no alert', () => {
  const state = store.reduce(farm([reportEvent(store.reduce(farm()))]));
  assert.equal(sp.openReportAlerts(state, { now: T0 }).length, 0);
});

test('FR-DIAG-09: the alert is read from the answers, not from a flag the phone set', () => {
  // A phone that files "many" with severity "low" does not get to send it quietly.
  const quiet = { ...reportEvent(store.reduce(farm()), { howMany: 'many' }) };
  quiet.payload = { ...quiet.payload, severity: 'low' };
  const state = store.reduce(farm([quiet]));
  assert.deepEqual(sp.openReportAlerts(state, { now: T0 })[0].reasons, ['many plants']);
});

test('FR-DIAG-09: starting a diagnosis picks it up; only resolving the report closes it', () => {
  const s0 = store.reduce(farm());
  const log = farm([
    reportEvent(s0, { spreading: 'yes' }),
    ev('d1', 'diagnosis.record', {
      id: 'dx1', engine: dx.RULES_VERSION, cardId: 'acid_soil', triageRow: 23, reportId: 'r1',
      photos: [PHOTO], confirmTest: 'Three-point pH test', confirmResult: 'pH 5.1',
      reasoning: 'Stunted and purple, roots stubby with no galls.', date: '2026-09-30',
    }, 'u_sup', hoursAfter(1)),
  ]);
  const picked = sp.openReportAlerts(store.reduce(log), { now: hoursAfter(5) })[0];
  assert.equal(picked.ack.by, 'u_sup');
  assert.equal(picked.level, 'manager', 'picked up, so it never went to the Field Supervisor rung');
  assert.equal(sp.openReportAlerts(store.reduce(log), { now: hoursAfter(13) })[0].level, 'owner',
    'but picking it up does not stop it reaching the Owner');

  const closed = store.reduce([...log, ev('x', 'report.resolve', { id: 'r1', note: 'Limed' }, 'u_mgr', hoursAfter(6))]);
  assert.equal(sp.openReportAlerts(closed, { now: hoursAfter(13) }).length, 0);
  assert.equal(sp.reportAlerts(closed, { now: hoursAfter(13) })[0].status, 'closed');
});

// --- 3. The confirmed result reaches the reporter --------------------------

test('FR-DIAG-10: the reporter sees the confirmed answer with their own photo', () => {
  const s0 = store.reduce(farm());
  const recorded = ev('d1', 'diagnosis.record', {
    id: 'dx1', engine: dx.RULES_VERSION, cardId: 'acid_soil', triageRow: 23, reportId: 'r1',
    cycleId: null, photos: [PHOTO], confirmTest: 'Three-point pH test (below 5.5)',
    confirmResult: 'pH 5.1 on all three points',
    reasoning: 'Stunted and purple, roots stubby with dead tips and no galls.', date: '2026-09-30',
  }, 'u_sup', hoursAfter(1));
  const log = farm([reportEvent(s0), recorded]);

  // Recorded but not confirmed: a match is not an answer, so the hand sees none.
  const before = store.reduce(log);
  assert.equal(sp.reportsBy(before, 'u_hand')[0].result, null);
  const waiting = todayView.render(ctxFor(before, before.people.u_hand));
  assert.ok(!/Acid soil/.test(waiting), 'an unconfirmed diagnosis is not shown to the reporter');
  assert.match(waiting, /Waiting for the answer/);

  // Confirmed by the Farm Manager — not the supervisor who ran it.
  const after = store.reduce([...log, ev('c1', 'diagnosis.confirm', {
    id: 'dx1', confirmTest: 'Three-point pH test (below 5.5)', confirmResult: 'pH 5.0 again',
  }, 'u_mgr', hoursAfter(3))]);
  const [mine] = sp.reportsBy(after, 'u_hand');
  assert.equal(mine.result.label, 'Acid soil');
  assert.equal(mine.result.confirmedBy, 'u_mgr');
  assert.equal(mine.photo.dataUrl, PHOTO.dataUrl, 'with the reporter\'s own photo');
  assert.equal(mine.result.cardId, 'acid_soil', 'and which card it is, for Learn');

  const html = todayView.render(ctxFor(after, after.people.u_hand));
  assert.match(html, /Confirmed: Acid soil<\/b>, by Ada Briggs/);
  assert.ok(html.includes(PHOTO.dataUrl), 'their photo is on the result');
  assert.ok(html.indexOf('Confirmed: Acid soil') < html.indexOf(PHOTO.dataUrl), 'beside the answer');

  // Nobody else's reports show on this hand's screen.
  assert.equal(sp.reportsBy(after, 'u_sup').length, 0);
});
