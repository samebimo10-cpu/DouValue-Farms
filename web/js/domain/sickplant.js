// The sick-plant report — FR-DIAG-03, FR-DIAG-07 to FR-DIAG-10.
//
// Two paths through one problem, split by who is holding the phone.
//
// A Greenhouse Hand reports: which zone, photos, where on the plant, how many
// plants. That is everything a hand can say for certain about a sick plant, and
// nothing on the path asks them to guess a cause. No triage rows, no cards, no
// confirm tests, no look-alikes. The report goes to named people, and the
// screen ends by saying who.
//
// The Field Supervisor or the Farm Manager diagnoses: the full guided flow
// (clinic.js) opens from the report, carrying its zone and its photos, and the
// diagnosis records which report it answers. When that diagnosis is confirmed
// the hand who reported it sees the result, next to their own photo.
//
// Some answers cannot wait for anybody to get round to the clinic. A wilting
// plant, a problem spreading plant to plant, or many plants at once raise an
// alert the moment the report is sent, on the same ladder as a pest count over
// its threshold (FR-SCOUT-04): Farm Manager at once, Field Supervisor at 4 h
// if nobody has picked it up, Owner at 12 h, KPI breach at 24 h. The alert is
// read off the report itself, not off a diagnosis, so a report nobody has
// diagnosed yet is exactly the one that climbs.
//
// Pure: no DOM, no store. Every function takes the state it reads.

import { escalationFor, levelFor, ALERT_LEVEL, ladderFor } from './alerts.js';
import { zoneHolders } from './assignments.js';
import { readDiagnosis, TRIAGE_BY_N } from './diagnose.js';
import { handSafe } from './learn.js';

/** What makes a report a sick-plant report rather than a general problem. */
export const SICK_PLANT = 'sick-plant';

/**
 * Where on the plant — picture choices. `serious` marks the answer that raises
 * the alert on its own. The picture is a pictogram, and the words are never
 * left off: a tile has to read as well without it.
 */
export const WHERE_ON_PLANT = [
  { id: 'top_leaves', pic: '🌱', label: 'New leaves at the top' },
  { id: 'old_leaves', pic: '🍂', label: 'Old leaves lower down' },
  { id: 'flowers_fruit', pic: '🌶️', label: 'Flowers or fruit' },
  { id: 'stem', pic: '🪵', label: 'Stem' },
  { id: 'base_roots', pic: '🟫', label: 'Base of the stem or roots' },
  { id: 'wilting', pic: '🥀', label: 'Whole plant drooping (wilting)', serious: 'wilting' },
];
export const WHERE_BY_ID = Object.fromEntries(WHERE_ON_PLANT.map((w) => [w.id, w]));

/**
 * How many plants — picture choices. More than five is "many": past the point
 * where it is one unlucky plant, and a patch is how a house is lost.
 */
export const MANY_PLANTS_FROM = 6;
export const HOW_MANY = [
  { id: 'one', pic: '🪴', label: 'One plant', plants: 1 },
  { id: 'few', pic: '🪴🪴', label: '2 to 5 plants', plants: 5 },
  { id: 'many', pic: '🪴🪴🪴', label: `More than ${MANY_PLANTS_FROM - 1} plants`, plants: MANY_PLANTS_FROM, serious: 'many plants' },
];
export const HOW_MANY_BY_ID = Object.fromEntries(HOW_MANY.map((h) => [h.id, h]));

/** Is it on the plants next to it too? Yes is the spreading answer. */
export const SPREADING = [
  { id: 'yes', pic: '↔️', label: 'Yes, the plants next to it too', serious: 'spreading' },
  { id: 'no', pic: '⏺️', label: 'No, just these' },
  { id: 'unsure', pic: '❔', label: 'Not sure' },
];
export const SPREADING_BY_ID = Object.fromEntries(SPREADING.map((s) => [s.id, s]));

export const isSickPlantReport = (r) => !!r && r.kind === SICK_PLANT;

/**
 * The answers that make a report serious, in words. An empty list means it is
 * not. Read from the answers every time, never from a flag the phone set, so a
 * report cannot be sent quietly by a phone that forgot to set it.
 */
export function seriousReasons(report = {}) {
  const out = [];
  for (const id of report.where || []) {
    const w = WHERE_BY_ID[id];
    if (w && w.serious && !out.includes(w.serious)) out.push(w.serious);
  }
  const s = SPREADING_BY_ID[report.spreading];
  if (s && s.serious) out.push(s.serious);
  const h = HOW_MANY_BY_ID[report.howMany];
  if (h && h.serious) out.push(h.serious);
  return out;
}

export const isSerious = (report) => seriousReasons(report).length > 0;

/**
 * What a report still needs before it can be sent. The same list the screen
 * shows and the server refuses on: zone, a photo, where, how many.
 */
export function reportGaps(report = {}) {
  const gaps = [];
  if (!report.zoneId) gaps.push({ id: 'zone', need: 'Pick the zone' });
  if (!Array.isArray(report.photos) || !report.photos.length) gaps.push({ id: 'photos', need: 'Take a photo of the plant' });
  if (!Array.isArray(report.where) || !report.where.some((id) => WHERE_BY_ID[id])) {
    gaps.push({ id: 'where', need: 'Tap where on the plant' });
  }
  if (!HOW_MANY_BY_ID[report.howMany]) gaps.push({ id: 'howMany', need: 'Tap how many plants' });
  return gaps;
}

const activePerson = (p) => !!p && p.active !== false;
const TITLE = { supervisor: 'Field Supervisor', manager: 'Farm Manager', ceo: 'Owner' };
export const roleTitle = (person) => (person ? TITLE[person.role] || person.role : '');

/**
 * Who a report goes to, named — FR-DIAG-08.
 *
 * The Field Supervisor who holds that zone, or every active Field Supervisor
 * if none holds it; and the Farm Manager, because the Farm Manager is who a
 * serious one alerts first (FR-SCOUT-04) and who runs the guided diagnosis if
 * the supervisor cannot. The reporter is never on their own list.
 */
export function recipientsFor(state, zoneId, { reporterId = null } = {}) {
  const people = Object.values((state && state.people) || {}).filter(activePerson);
  const out = [];
  const add = (person) => {
    if (!person || person.id === reporterId || out.some((x) => x.person.id === person.id)) return;
    out.push({ person, title: roleTitle(person) });
  };

  if (zoneId) {
    const held = zoneHolders(state, zoneId);
    for (const h of [...held.primary, ...held.backup]) {
      if (h.person.role === 'supervisor') add(h.person);
    }
  }
  if (!out.length) people.filter((p) => p.role === 'supervisor').forEach(add);
  people.filter((p) => p.role === 'manager').forEach(add);
  // A farm with no supervisor and no manager on the books still sends it
  // somewhere a person will read it.
  if (!out.length) people.filter((p) => p.role === 'ceo').forEach(add);
  return out;
}

/** "Tamuno West (Field Supervisor) and Ada Briggs (Farm Manager)". */
export function namesLine(recipients) {
  const names = recipients.map((r) => `${r.person.name} (${r.title})`);
  if (names.length <= 1) return names[0] || 'nobody — there is no supervisor or manager on the app yet';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The report exactly as the short flow files it, and who it goes to.
 *
 * `answers` is what the hand tapped: zone, photos, where, howMany, spreading.
 * The recipients are named here, at the moment of sending, and written onto
 * the record: "it went to Tamuno" has to stay true after Tamuno moves zones.
 */
export function composeReport(state, reporterId, answers, { id, today, now = new Date().toISOString() } = {}) {
  const zone = ((state && state.plots) || {})[answers.zoneId] || null;
  const cycle = Object.values((state && state.cycles) || {})
    .find((c) => c.plotId === answers.zoneId && c.status === 'active') || null;
  const recipients = recipientsFor(state, answers.zoneId, { reporterId });
  const where = [...(answers.where || [])];
  const payload = {
    id,
    kind: SICK_PLANT,
    zoneId: answers.zoneId,
    cycleId: cycle ? cycle.id : null,
    photos: [...(answers.photos || [])],
    // The first photo also sits where the older report screens look for one.
    photo: (answers.photos || [])[0] || null,
    where,
    howMany: answers.howMany,
    spreading: answers.spreading || 'unsure',
    note: `Sick plant on ${zone ? zone.name : 'a zone'}`,
    sentTo: recipients.map((r) => r.person.id),
    date: today || now.slice(0, 10),
    enteredAt: now,
  };
  const reasons = seriousReasons(payload);
  payload.severity = reasons.length ? 'high' : 'medium';
  return { payload, recipients, reasons, gaps: reportGaps(payload) };
}

/** The diagnoses recorded against one report, newest first. */
export function diagnosesFor(state, reportId) {
  return ((state && state.diagnoses) || [])
    .filter((d) => d.reportId === reportId)
    .map(readDiagnosis)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/** The confirmed diagnosis for a report, if there is one yet. */
export function confirmedFor(state, reportId) {
  return diagnosesFor(state, reportId).find((d) => d.confirmed) || null;
}

const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;

/**
 * Alerts raised by serious sick-plant reports — FR-DIAG-09.
 *
 * One per serious report. It opens the moment the report is recorded, with or
 * without a diagnosis behind it, and climbs the FR-SCOUT-04 ladder. Picking it
 * up — a guided diagnosis started from the report — stops the Field Supervisor
 * rung the way an acknowledgement does. Only resolving the report closes it.
 */
export function reportAlerts(state, { now = new Date().toISOString(), settings = null } = {}) {
  const ladder = ladderFor(settings || (state && state.settings) || {});
  const plots = (state && state.plots) || {};
  const out = [];

  for (const r of (state && state.reports) || []) {
    if (!isSickPlantReport(r)) continue;
    const reasons = seriousReasons(r);
    if (!reasons.length) continue;
    const at = r.at || r.enteredAt || `${r.date}T12:00:00.000Z`;
    const zone = plots[r.zoneId] || null;
    const picked = diagnosesFor(state, r.id).slice(-1)[0] || null;   // the first one started
    const alert = {
      id: `report-alert:${r.id}`,
      kind: 'sick-plant',
      reportId: r.id,
      zoneId: r.zoneId || null,
      cycleId: r.cycleId || null,
      zoneName: zone ? zone.name : 'unknown zone',
      reasons,
      raisedBy: r.by,
      at,
      date: (r.date || at).slice(0, 10),
      ack: picked ? { by: picked.by, at: picked.at } : null,
      dueAt: new Date(new Date(at).getTime() + ladder.kpiBreachAfterHours * 3600000).toISOString(),
    };
    if (r.status === 'resolved') {
      alert.status = 'closed';
      alert.hoursToClose = Math.round(hoursBetween(at, r.resolvedAt || at) * 10) / 10;
      alert.level = levelFor(alert.hoursToClose, !!alert.ack, ladder);
    } else {
      alert.status = 'open';
      alert.hoursOpen = Math.max(0, Math.round(hoursBetween(at, now) * 10) / 10);
      alert.level = levelFor(alert.hoursOpen, !!alert.ack, ladder);
      alert.overdue = alert.hoursOpen >= ladder.kpiBreachAfterHours;
    }
    alert.kpiBreach = alert.level === 'kpi';
    alert.levelLabel = ALERT_LEVEL[alert.level].label;
    alert.escalation = escalationFor(alert, { ladder });
    out.push(alert);
  }
  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return (a.at < b.at ? 1 : -1);
  });
}

export const openReportAlerts = (state, opts = {}) =>
  reportAlerts(state, opts).filter((a) => a.status === 'open');

/**
 * A hand's own sick-plant reports and what became of them — FR-DIAG-10.
 *
 * Each carries the reporter's own first photo, and the confirmed diagnosis once
 * a Field Supervisor or Farm Manager has confirmed one. An unconfirmed
 * diagnosis is not shown to the reporter: until the confirm test is done it is
 * a match, not an answer, and a hand acting on a match is the guesswork this
 * whole section exists to stop.
 */
export function reportsBy(state, personId) {
  return ((state && state.reports) || [])
    .filter((r) => isSickPlantReport(r) && r.by === personId)
    .map((r) => {
      const result = confirmedFor(state, r.id);
      const row = result && result.triageRow != null ? TRIAGE_BY_N.get(Number(result.triageRow)) : null;
      return {
        report: r,
        photo: (r.photos || [])[0] || null,
        serious: isSerious(r),
        result: result ? {
          id: result.id,
          label: result.label,
          cardId: result.cardId || null,
          confirmedBy: result.confirmedBy,
          confirmedAt: result.confirmedAt,
          // FR-LEARN-02: the rules' first action with the doses, products and
          // groups taken out. The spray itself is the supervisor's to decide.
          doNow: row ? handSafe(row.firstAction).join('; ') : '',
        } : null,
      };
    })
    .sort((a, b) => ((a.report.at || '') < (b.report.at || '') ? 1 : -1));
}
