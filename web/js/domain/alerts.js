// Thresholds, alerts and the escalation ladder — requirements 6.5.
//
// This is root cause number two: thrips controlled too late. Not unnoticed —
// late. Somebody saw them, somebody wrote it down, and the spray went on after
// the tospovirus was already in the house. The gap between seeing and acting is
// the thing this file exists to close, and KPI-01 measures it: threshold breach
// to treatment done, twenty-four hours.
//
// Alerts are DERIVED, never stored.
//
// That is the important decision here. An alert is not a row somebody flips to
// "closed"; it is what the records mean when you read them in order. A count
// over threshold opens one. A diagnosis and a treatment — or a recorded
// decision not to treat — close it. Elapsed time decides how far up the ladder
// it has climbed. Nothing can be closed by clicking; it closes because the work
// that answers it exists.
//
// That matters on a farm with five phones and intermittent signal. Two people
// cannot disagree about whether an alert is open, because neither of them holds
// the answer — the event log does, and it merges without conflict.

import { addDays, daysBetween, isoDate } from '../util.js';
import { PROBLEM_BY_ID } from './pests.js';
import { PRODUCT_BY_ID } from './safety.js';

/**
 * Action thresholds — FR-SCOUT-02.
 *
 * AWAITING Rev 5: the document points at "the Rev 5 triage table" for the real
 * numbers and I do not have it. These are defensible published figures for
 * capsicum under cover, and every one of them is editable by the Owner in
 * settings, which is what FR-SCOUT-02 requires. Replace them from Rev 5 before
 * launch rather than after.
 *
 * `perTrap` is what a sticky trap is allowed to hold between checks.
 * `perPlant` is what ten inspected plants are allowed to average.
 * Greenhouse figures are tighter than field: a house is a closed room, so a
 * population that would be tolerable outside compounds inside it.
 */
export const DEFAULT_THRESHOLDS = {
  thrips: {
    greenhouse: { perTrap: 10, perPlant: 2 },
    field: { perTrap: 25, perPlant: 5 },
    // Thrips are not judged on damage alone. They carry tospovirus, and the
    // virus arrives long before the feeding scars look serious.
    note: 'Vector for tospovirus. Treat on the count, not on the damage.',
    vector: true,
  },
  whitefly: {
    greenhouse: { perTrap: 15, perPlant: 3 },
    field: { perTrap: 40, perPlant: 8 },
    note: 'Vector for leaf curl virus. A rising trap count is the warning.',
    vector: true,
  },
  aphids: {
    greenhouse: { perTrap: 20, perPlant: 10 },
    field: { perTrap: 50, perPlant: 20 },
    note: 'Vector for CMV and PVMV. Ants on the plants usually mean aphids under the leaves.',
    vector: true,
  },
  red_spider_mite: {
    greenhouse: { perPlant: 5 },
    field: { perPlant: 10 },
    note: 'Dry, hot weather is when this one runs away. Check leaf undersides.',
  },
  broad_mite: {
    greenhouse: { perPlant: 2 },
    field: { perPlant: 4 },
    note: 'Too small to see. Judge on the curled, shiny growing tips.',
  },
  fruit_borer: {
    greenhouse: { perPlant: 1 },
    field: { perPlant: 2 },
    note: 'One bored fruit per ten plants is already a spray decision — the damage is the crop itself.',
  },
  fruit_fly: {
    greenhouse: { perTrap: 5 },
    field: { perTrap: 10 },
  },
  mealybug: {
    greenhouse: { perPlant: 3 },
    field: { perPlant: 6 },
  },
  variegated_grasshopper: {
    field: { perPlant: 2 },
    greenhouse: { perPlant: 1 },
  },
};

/**
 * The escalation ladder — FR-SCOUT-04, from rules C-12 (`escalation.threshold_alert`).
 *
 * Four rungs, not three, and the fourth is not a person:
 *
 *   0 h   Farm Manager        the moment the count is recorded
 *   4 h   Field Supervisor    if nobody has acknowledged it
 *  12 h   Owner               if it is still not closed
 *  24 h   Owner, KPI breach   still not closed: this is KPI-01 failing
 *
 * D-4 settled these timings, so they are no longer bracketed guesses — but they
 * are still settings rather than constants, because the requirement asks for
 * the ladder to be shortened for testing (§9) and an Owner should not need a
 * release to do it.
 */
export const DEFAULT_LADDER = {
  // Straight to the Farm Manager the moment the count is recorded.
  managerAtOnce: true,
  // Nobody acknowledged it → the Field Supervisor.
  supervisorAfterHours: 4,
  // Still not closed → the Owner.
  ownerAfterHours: 12,
  // Still not closed a day later. The alert does not move to anybody new; what
  // changes is that KPI-01 has been missed, and the digest says so.
  kpiBreachAfterHours: 24,
};

export const ALERT_LEVEL = {
  manager: { rank: 1, label: 'Farm Manager', role: 'manager', tone: 'warn' },
  supervisor: { rank: 2, label: 'Field Supervisor', role: 'supervisor', tone: 'warn' },
  owner: { rank: 3, label: 'Owner', role: 'ceo', tone: 'danger' },
  kpi: { rank: 4, label: 'Owner — KPI breach', role: 'ceo', tone: 'danger' },
};

/** The levels that put an alert in front of the Owner. */
export const OWNER_LEVELS = new Set(['owner', 'kpi']);

/** The ladder in force, after the Owner's edits. */
export function ladderFor(settings = {}) {
  return { ...DEFAULT_LADDER, ...((settings && settings.ladder) || {}) };
}

/**
 * The four rungs as data — FR-SCOUT-04.
 *
 * Returned as a list rather than hard-coded into the screens so the ladder can
 * be shown, tested and shortened in one place. `condition` is what stops the
 * climb at that rung: an acknowledgement stops the Supervisor being pulled in,
 * and only closing the alert stops the rest.
 */
export function ladderRungs(settings = {}) {
  const ladder = ladderFor(settings);
  return [
    {
      level: 'manager', atHours: 0, to: ALERT_LEVEL.manager.label, role: 'manager',
      condition: 'as soon as the count is recorded', stoppedBy: 'closing the alert',
    },
    {
      level: 'supervisor', atHours: ladder.supervisorAfterHours, to: ALERT_LEVEL.supervisor.label,
      role: 'supervisor', condition: 'not acknowledged', stoppedBy: 'acknowledging it',
    },
    {
      level: 'owner', atHours: ladder.ownerAfterHours, to: ALERT_LEVEL.owner.label, role: 'ceo',
      condition: 'not closed', stoppedBy: 'closing the alert',
    },
    {
      level: 'kpi', atHours: ladder.kpiBreachAfterHours, to: ALERT_LEVEL.owner.label, role: 'ceo',
      condition: 'not closed', stoppedBy: 'closing the alert', kpiBreach: true,
    },
  ];
}

/**
 * Where one alert has got to on the ladder, rung by rung.
 *
 * Every rung carries when it fires and whether it has fired yet, so the screen
 * and the test read the same thing: not "it is with the Owner" but "it reached
 * the Owner at 12 h, and the Supervisor rung was skipped because Ada picked it
 * up at 02:40".
 */
export function escalationFor(alert, settings = {}) {
  const rungs = ladderRungs(settings);
  const hours = alert.status === 'closed' ? (alert.hoursToClose || 0) : (alert.hoursOpen || 0);
  const acknowledged = !!alert.ack;
  const openedAt = new Date(alert.at).getTime();

  return rungs.map((rung) => {
    const skipped = rung.level === 'supervisor' && acknowledged;
    const reached = !skipped && hours >= rung.atHours;
    return {
      ...rung,
      reached,
      skipped,
      at: Number.isNaN(openedAt) ? null
        : new Date(openedAt + rung.atHours * 3600000).toISOString(),
      // Closed in time means the rung never fired, however long ago it was.
      why: skipped
        ? `Acknowledged before ${rung.atHours} h, so it never went to the ${rung.to}.`
        : reached
          ? `${rung.atHours} h passed ${rung.condition === 'not closed' ? 'without it being closed' : rung.condition}.`
          : `Fires at ${rung.atHours} h if it is still ${rung.condition === 'not acknowledged' ? 'unacknowledged' : 'open'}.`,
    };
  });
}

/** A zone is a greenhouse unless it says otherwise; open field is the exception here. */
const zoneKind = (zone) => (zone && zone.type === 'field' ? 'field' : 'greenhouse');

/** The threshold in force for one pest in one kind of zone, after Owner edits. */
export function thresholdFor(pestId, zone, settings = {}) {
  const table = { ...DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) };
  const entry = table[pestId];
  if (!entry) return null;
  const kind = zoneKind(zone);
  const limits = entry[kind] || entry.greenhouse || entry.field;
  if (!limits) return null;
  return { pestId, kind, ...limits, note: entry.note || null, vector: !!entry.vector };
}

/**
 * Did this scouting record cross its threshold?
 *
 * A record carries either a trap count or a per-plant count, and they are
 * judged against different numbers. Where a record has both, either one over
 * the line is a breach — a trap catching nothing while the plants are covered
 * means the trap is in the wrong place, not that the house is clean.
 */
export function breaches(scout, zone, settings = {}) {
  const limit = thresholdFor(scout.pestId, zone, settings);
  if (!limit) return null;

  const hits = [];
  if (limit.perTrap != null && scout.trapCount != null && Number(scout.trapCount) >= limit.perTrap) {
    hits.push({ kind: 'trap', count: Number(scout.trapCount), limit: limit.perTrap });
  }
  if (limit.perPlant != null && scout.perPlant != null && Number(scout.perPlant) >= limit.perPlant) {
    hits.push({ kind: 'plant', count: Number(scout.perPlant), limit: limit.perPlant });
  }
  if (!hits.length) return null;

  const worst = hits.sort((a, b) => (b.count / b.limit) - (a.count / a.limit))[0];
  return { ...worst, threshold: limit, over: Math.round((worst.count / worst.limit) * 100) - 100 };
}

/** Hours between two instants, for the ladder. */
function hoursBetween(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, (b - a) / 3600000);
}

/**
 * What closes an alert — FR-SCOUT-05.
 *
 * A treatment on the zone after the breach, with a confirmed diagnosis behind
 * it (the gate in gates.js already guarantees that), or an explicit recorded
 * decision not to treat. Nothing else. In particular a later clean scouting
 * record does not close it: "I looked again and it seemed better" is how the
 * first one got left.
 */
function closureFor(state, breach) {
  const after = (date) => date && date >= breach.date;

  const treatment = (state.sprays || [])
    .filter((s) => s.cycleId === breach.cycleId && after((s.date || '').slice(0, 10)))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (treatment) {
    return {
      kind: 'treated',
      at: treatment.at || `${treatment.date}T12:00:00.000Z`,
      what: `${treatment.productName || treatment.productId} applied`,
      by: treatment.by,
    };
  }

  const decision = (state.alertDecisions || [])
    .filter((d) => d.cycleId === breach.cycleId && d.pestId === breach.pestId)
    .filter((d) => (d.at || '') >= breach.at)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
  if (decision) {
    return {
      kind: 'decided',
      at: decision.at,
      what: `Decided not to treat: ${decision.reason}`,
      by: decision.by,
    };
  }

  return null;
}

/** Has anyone said they have seen it? An acknowledgement stops the second rung. */
function ackFor(state, breach) {
  return (state.alertAcks || [])
    .filter((a) => a.cycleId === breach.cycleId && a.pestId === breach.pestId)
    .filter((a) => (a.at || '') >= breach.at)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? -1 : 1))[0] || null;
}

/**
 * Every alert the records imply, open and closed — FR-SCOUT-03/04/05.
 *
 * One alert per zone per pest per breach. A second breach of the same pest in
 * the same zone while the first is still open does not open a second alert; it
 * raises the count on the one already running, because two alerts for one
 * problem is how a board becomes wallpaper.
 */
export function alerts(state, { now = new Date().toISOString(), settings = null } = {}) {
  const config = settings || state.settings || {};
  const ladder = { ...DEFAULT_LADDER, ...(config.ladder || {}) };
  const out = [];
  const openByKey = new Map();

  const scouts = [...(state.scouts || [])]
    .filter((s) => s.pestId)
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? -1 : 1));

  for (const scout of scouts) {
    const cycle = (state.cycles || {})[scout.cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    const hit = breaches(scout, zone, config);
    if (!hit) continue;

    const key = `${scout.cycleId}::${scout.pestId}`;
    const running = openByKey.get(key);
    if (running) {
      // Same problem, same zone, still open: this is more evidence, not a new alert.
      running.sightings.push({ at: scout.at || scout.date, count: hit.count, kind: hit.kind });
      running.worst = Math.max(running.worst, hit.count);
      continue;
    }

    const at = scout.at || `${scout.date}T12:00:00.000Z`;
    const breach = {
      id: `alert:${scout.id}`,
      cycleId: scout.cycleId,
      pestId: scout.pestId,
      pestName: (PROBLEM_BY_ID[scout.pestId] || {}).name || scout.pestId,
      zone: zone || null,
      zoneName: zone ? zone.name : 'unknown zone',
      date: (scout.date || at).slice(0, 10),
      at,
      raisedBy: scout.by,
      count: hit.count,
      worst: hit.count,
      limit: hit.limit,
      countKind: hit.kind,
      overPct: hit.over,
      vector: hit.threshold.vector,
      note: hit.threshold.note,
      sightings: [{ at, count: hit.count, kind: hit.kind }],
      // FR-SCOUT-03: the 24-hour deadline is set when the alert opens, not when
      // somebody gets round to looking at it.
      dueAt: new Date(new Date(at).getTime() + ladder.kpiBreachAfterHours * 3600000).toISOString(),
    };

    const closure = closureFor(state, breach);
    const ack = ackFor(state, breach);

    if (closure) {
      breach.status = 'closed';
      breach.closure = closure;
      breach.ack = ack;
      // KPI-01: this is the number the whole section exists to move.
      breach.hoursToClose = Math.round(hoursBetween(at, closure.at) * 10) / 10;
      breach.withinDeadline = breach.hoursToClose <= ladder.kpiBreachAfterHours;
      breach.kpiBreach = !breach.withinDeadline;
      breach.level = levelFor(breach.hoursToClose, !!ack, ladder);
    } else {
      breach.status = 'open';
      breach.ack = ack;
      breach.hoursOpen = Math.round(hoursBetween(at, now) * 10) / 10;
      breach.overdue = breach.hoursOpen >= ladder.kpiBreachAfterHours;
      breach.level = levelFor(breach.hoursOpen, !!ack, ladder);
      breach.kpiBreach = breach.level === 'kpi';
      openByKey.set(key, breach);
    }
    // FR-SCOUT-04: the whole ladder, rung by rung, on the alert itself — so a
    // screen can show what has already been tried and a test can check it end
    // to end rather than inferring it from one label.
    breach.escalation = escalationFor(breach, { ladder });
    breach.levelLabel = ALERT_LEVEL[breach.level].label;
    out.push(breach);
  }

  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'open') return (b.hoursOpen || 0) - (a.hoursOpen || 0);
    return (a.at < b.at ? 1 : -1);
  });
}

/**
 * How far up the ladder — FR-SCOUT-04.
 *
 * Acknowledging stops the climb to the Supervisor, because somebody has picked
 * it up. It does not stop the climb to the Owner: only closing it does. "Seen
 * it" is not "dealt with", and Season 1 was full of seen.
 */
export function levelFor(hoursOpen, acknowledged, ladder = DEFAULT_LADDER) {
  const full = { ...DEFAULT_LADDER, ...(ladder || {}) };
  // The top rung is the same person as the one below it. What it adds is the
  // KPI breach: a day gone by with the thing still open is the failure KPI-01
  // was written to count, and calling it "with the Owner" hides that.
  if (hoursOpen >= full.kpiBreachAfterHours) return 'kpi';
  if (hoursOpen >= full.ownerAfterHours) return 'owner';
  if (!acknowledged && hoursOpen >= full.supervisorAfterHours) return 'supervisor';
  return 'manager';
}

/** Just the ones still open, worst first. The board people actually work from. */
export function openAlerts(state, opts = {}) {
  return alerts(state, opts).filter((a) => a.status === 'open');
}

/**
 * FR-SCOUT-06/07 — the trend, and the warning before the line is crossed.
 *
 * A count that is climbing is more useful than a count that is high: it says
 * how many days are left before the decision has to be made.
 */
export function trend(state, cycleId, pestId, { weeks = 8, today = isoDate(), settings = null } = {}) {
  const config = settings || state.settings || {};
  const cycle = (state.cycles || {})[cycleId];
  const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
  const limit = thresholdFor(pestId, zone, config);
  const from = isoDate(addDays(today, -weeks * 7));

  const points = (state.scouts || [])
    .filter((s) => s.cycleId === cycleId && s.pestId === pestId && s.date >= from)
    .map((s) => ({
      date: s.date,
      count: Number(s.trapCount ?? s.perPlant ?? 0),
      kind: s.trapCount != null ? 'trap' : 'plant',
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const line = limit ? (points.some((p) => p.kind === 'trap') ? limit.perTrap : limit.perPlant) : null;

  // Two readings say nothing about a trend; three is the fewest that can.
  let rising = null;
  if (points.length >= 3 && line) {
    const last3 = points.slice(-3);
    const climbing = last3[2].count > last3[1].count && last3[1].count > last3[0].count;
    const step = (last3[2].count - last3[0].count) / 2;
    if (climbing && step > 0 && last3[2].count < line) {
      const checksLeft = Math.ceil((line - last3[2].count) / step);
      rising = {
        step: Math.round(step * 10) / 10,
        checksToThreshold: checksLeft,
        // FR-SCOUT-07: yellow before red, so the spray can be planned rather
        // than scrambled.
        why: `Up ${Math.round(step)} a check for three checks running. At this rate it crosses `
          + `${line} in about ${checksLeft} more check${checksLeft === 1 ? '' : 's'}.`,
      };
    }
  }

  return { points, line, rising, pestId, limit };
}

/**
 * FR-SCOUT-06 — one trend per zone, per pest, ready to draw.
 *
 * Trap counts first, because the traps are the number the thresholds are set
 * against and the ones counted daily. A pest with no counts at all is left out
 * rather than drawn as an empty chart.
 */
export function zoneTrends(state, { today = isoDate(), weeks = 8, settings = null, zoneId = null } = {}) {
  const seen = new Set();
  const out = [];

  for (const s of state.scouts || []) {
    if (!s.pestId || !s.cycleId) continue;
    const key = `${s.cycleId}::${s.pestId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cycle = (state.cycles || {})[s.cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    if (zoneId && (!zone || zone.id !== zoneId)) continue;

    const t = trend(state, s.cycleId, s.pestId, { weeks, today, settings });
    if (!t.points.length) continue;
    const last = t.points[t.points.length - 1];
    out.push({
      cycleId: s.cycleId,
      zoneId: zone ? zone.id : null,
      zoneName: zone ? zone.name : 'unknown zone',
      pestId: s.pestId,
      pestName: (PROBLEM_BY_ID[s.pestId] || {}).name || s.pestId,
      trend: t,
      over: t.line != null && last.count >= t.line,
      rising: !!t.rising,
    });
  }

  // Whatever is over the line first, then whatever is climbing, then the rest.
  return out.sort((a, b) => Number(b.over) - Number(a.over)
    || Number(b.rising) - Number(a.rising)
    || String(a.zoneName).localeCompare(String(b.zoneName)));
}

/** Every zone-and-pest pair that is climbing but not yet over — the yellow list. */
export function risingWarnings(state, opts = {}) {
  const seen = new Set();
  const out = [];
  for (const s of state.scouts || []) {
    if (!s.pestId || !s.cycleId) continue;
    const key = `${s.cycleId}::${s.pestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = trend(state, s.cycleId, s.pestId, opts);
    if (!t.rising) continue;
    const cycle = (state.cycles || {})[s.cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    out.push({
      cycleId: s.cycleId,
      pestId: s.pestId,
      pestName: (PROBLEM_BY_ID[s.pestId] || {}).name || s.pestId,
      zoneName: zone ? zone.name : 'unknown zone',
      ...t.rising,
    });
  }
  return out.sort((a, b) => a.checksToThreshold - b.checksToThreshold);
}

/**
 * The five things that go straight to the Owner — rules `escalation.immediate_to_owner`.
 *
 * These do not climb the ladder. There is no four hours with the Supervisor
 * first, because by the time the ladder has finished being polite about a
 * tospovirus the house is gone. Each one is read off the records the same way
 * an alert is, so nobody has to remember to send anything.
 *
 * The list is the rules JSON's, in its order:
 *   suspected virus (tospovirus, mosaic) · bacterial wilt · gate override ·
 *   pod borer on more than 10 plants · any synthetic logged from Week 10.
 */
export const IMMEDIATE_TO_OWNER = [
  'suspected virus (tospovirus, mosaic)',
  'bacterial wilt',
  'gate override',
  'pod borer >10 plants',
  'any synthetic logged from Week 10',
];

const VIRUS_RE = /virus|tospo|mosaic|pvmv|cmv|leaf_curl/i;
const BACTERIAL_WILT_RE = /bacterial_wilt|bacterial wilt|ralstonia/i;
const BORER_RE = /borer/i;

/** Pod borer counted on more than this many plants goes to the Owner today. */
export const POD_BORER_TO_OWNER = 10;

/**
 * Week counting, from the rules: transplant day is Day 1 of Week 0, and
 * `week = floor((date - T) / 7)`. Week 10 therefore starts on day 70.
 */
export function weekOf(cycle, date) {
  if (!cycle || !cycle.transplantDate) return null;
  const days = daysBetween(cycle.transplantDate, date);
  return days < 0 ? null : Math.floor(days / 7);
}

/** Week 10 onwards is organics only — spray rule SR-08. */
export const ORGANICS_ONLY_FROM_WEEK = 10;

/**
 * What counts as an organic from Week 10 — SR-08 names neem oil, garlic-chilli
 * and copper hydroxide, and Bt belongs with them.
 *
 * Anything not on this list is treated as a synthetic, including the copper
 * oxychloride in the catalogue. Erring that way raises a flag the Owner can
 * dismiss; erring the other way lets a synthetic through the last ten weeks of
 * the crop without anybody being told, which is the export residue problem
 * SR-08 exists to prevent.
 */
export const WEEK_10_ORGANICS = new Set([
  'neem', 'bt', 'garlic_chilli', 'trichoderma', 'copper_hydroxide',
]);

export function isSyntheticFromWeek10(productId) {
  if (!productId) return false;
  if (WEEK_10_ORGANICS.has(productId)) return false;
  const product = PRODUCT_BY_ID[productId];
  // A nutrient is not a pesticide, and a product nobody recognises is treated
  // as a synthetic rather than waved through.
  if (product && product.kind === 'nutrient') return false;
  return true;
}

/**
 * Everything on the straight-to-Owner list, newest first — FR-SCOUT-04.
 *
 * `days` bounds how far back it looks, so a virus from last season does not
 * live in today's digest for ever.
 */
export function straightToOwner(state, { now = new Date().toISOString(), days = 7 } = {}) {
  const today = now.slice(0, 10);
  const from = isoDate(addDays(today, -days));
  const out = [];
  const where = (cycleId) => {
    const cycle = (state.cycles || {})[cycleId];
    const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
    return zone ? zone.name : 'a zone';
  };

  for (const d of state.diagnoses || []) {
    const date = (d.date || (d.at || '').slice(0, 10));
    if (!date || date < from) continue;
    const text = `${d.problemId || ''} ${d.problemName || ''}`;
    const name = d.problemName || d.problemId || 'something';
    if (VIRUS_RE.test(text)) {
      out.push({
        kind: 'virus', rule: IMMEDIATE_TO_OWNER[0], at: d.at || `${date}T12:00:00.000Z`, date,
        zoneName: where(d.cycleId), cycleId: d.cycleId || null,
        line: `VIRUS SUSPECTED: ${name} on ${where(d.cycleId)}`,
        detail: 'Isolate those plants, do not move tools or hands between houses, pull and burn '
          + 'the affected ones. Confirm before replanting.',
      });
    } else if (BACTERIAL_WILT_RE.test(text)) {
      out.push({
        kind: 'bacterial_wilt', rule: IMMEDIATE_TO_OWNER[1], at: d.at || `${date}T12:00:00.000Z`, date,
        zoneName: where(d.cycleId), cycleId: d.cycleId || null,
        line: `BACTERIAL WILT SUSPECTED on ${where(d.cycleId)}`,
        detail: 'Do not irrigate from that bed into the others. A lab sample decides it — the '
          + 'Farm Doctor never confirms this one on a photo.',
      });
    }
  }

  // An override is not an event that happened once; it is a state the farm is
  // standing in. So it is listed for as long as it stands, however long ago it
  // was granted — FR-GATE-07 says the Owner sees every one, and an override
  // quietly ageing off the list after a week is how one becomes permanent.
  for (const o of state.gateOverrides || []) {
    if (o.revoked) continue;
    const date = (o.at || '').slice(0, 10);
    const zone = (state.plots || {})[o.zoneId];
    out.push({
      kind: 'gate_override', rule: IMMEDIATE_TO_OWNER[2], at: o.at, date,
      zoneName: zone ? zone.name : 'a zone', cycleId: null,
      line: `Gate override on ${zone ? zone.name : 'a zone'} — ${o.gate}`,
      detail: `Reason given: ${o.reason || 'none recorded'}`,
    });
  }

  for (const sc of state.scouts || []) {
    const date = sc.date || (sc.at || '').slice(0, 10);
    if (!date || date < from) continue;
    const pest = `${sc.pestId || ''} ${(PROBLEM_BY_ID[sc.pestId] || {}).name || ''}`;
    if (!BORER_RE.test(pest)) continue;
    // Counted plants with entry holes. The ten-plant average cannot express
    // "more than ten plants", so this reads the explicit count and stays quiet
    // when nobody made one rather than guessing from a percentage.
    const plants = Number(sc.plantsAffected ?? NaN);
    if (!Number.isFinite(plants) || plants <= POD_BORER_TO_OWNER) continue;
    out.push({
      kind: 'pod_borer', rule: IMMEDIATE_TO_OWNER[3], at: sc.at || `${date}T12:00:00.000Z`, date,
      zoneName: where(sc.cycleId), cycleId: sc.cycleId || null,
      line: `Pod borer on ${plants} plants in ${where(sc.cycleId)}`,
      detail: 'Over ten plants with entry holes: spray the whole field today, do not wait for the '
        + 'next window.',
    });
  }

  for (const sp of state.sprays || []) {
    const date = sp.date || (sp.at || '').slice(0, 10);
    if (!date || date < from) continue;
    const cycle = (state.cycles || {})[sp.cycleId];
    const week = weekOf(cycle, date);
    if (week == null || week < ORGANICS_ONLY_FROM_WEEK) continue;
    if (!isSyntheticFromWeek10(sp.productId)) continue;
    out.push({
      kind: 'week10_synthetic', rule: IMMEDIATE_TO_OWNER[4], at: sp.at || `${date}T12:00:00.000Z`, date,
      zoneName: where(sp.cycleId), cycleId: sp.cycleId || null,
      line: `Synthetic sprayed in Week ${week} on ${where(sp.cycleId)}`
        + ` — ${sp.productName || sp.productId}`,
      detail: 'From Week 10 it is organics only: neem, garlic-chilli, copper. A synthetic this '
        + 'late puts residue on fruit that is already being picked.',
    });
  }

  return out.sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/**
 * The success measures — section 3. The app is only working if these move.
 *
 * Computed, not claimed. Every one of them is read straight off the records so
 * nobody has to be trusted to report it.
 */
export function kpis(state, {
  now = new Date().toISOString(), days = 28, settings = null, from = null, to = null, zoneId = null,
} = {}) {
  const config = settings || state.settings || {};
  const ladder = ladderFor(config);
  const today = now.slice(0, 10);
  const until = to || today;
  const since = from || isoDate(addDays(until, -days));
  const window = (date) => !!date && date >= since && date <= until;
  const span = Math.max(1, daysBetween(since, until));

  // FR-REP-03 asks for these per zone as well as per week, so every measure
  // below is written to answer "and what about GH-04 on its own?".
  const zones = Object.values(state.plots || {}).filter((z) => !zoneId || z.id === zoneId);
  const cycleIds = new Set(Object.values(state.cycles || {})
    .filter((c) => !zoneId || c.plotId === zoneId).map((c) => c.id));
  const inZone = (cycleId) => !zoneId || cycleIds.has(cycleId);

  const all = alerts(state, { now, settings: config })
    .filter((a) => !zoneId || (a.zone && a.zone.id === zoneId));
  const inWindow = all.filter((a) => window(a.date));

  // KPI-01 — breach to treatment done.
  const closed = inWindow.filter((a) => a.status === 'closed' && a.hoursToClose != null);
  const meanHours = closed.length
    ? Math.round((closed.reduce((s, a) => s + a.hoursToClose, 0) / closed.length) * 10) / 10
    : null;

  // KPI-02 — scouting completed, with a photo.
  const scoutTasks = Object.values(state.tasks || {})
    .filter((t) => t.kind === 'scout' && window((t.due || '').slice(0, 10)))
    .filter((t) => !zoneId || t.zoneId === zoneId);
  const doneWithPhoto = scoutTasks.filter((t) => t.status === 'done' && t.photo);
  const scoutRate = scoutTasks.length
    ? Math.round((doneWithPhoto.length / scoutTasks.length) * 100) : null;

  // KPI-03 — treatments with no diagnosis behind them. The gate makes new ones
  // impossible; this counts what is already on the record.
  const untreatedSprays = (state.sprays || [])
    .filter((s) => window(s.date || ''))
    .filter((s) => inZone(s.cycleId))
    .filter((s) => !s.diagnosisId).length;

  // KPI-04 — plantings that did not pass their gates.
  const ungatedPlantings = (state.gateOverrides || [])
    .filter((o) => !o.revoked && window((o.at || '').slice(0, 10)))
    .filter((o) => !zoneId || o.zoneId === zoneId).length;

  // KPI-05 — open alerts past the deadline. Section 3 writes this as 48 h; the
  // app counts from the ladder's own 24-hour deadline instead, which is the
  // stricter of the two and the one KPI-01 is measured against.
  const staleOpen = all.filter((a) => a.status === 'open'
    && a.hoursOpen > ladder.kpiBreachAfterHours).length;

  // KPI-06 — is profit known per zone? Deliberately not windowed: the measure
  // is "every cycle", and a zone whose costs were all booked in week one does
  // not stop being known about in week six.
  const zonesWithMoney = zones.filter((z) => {
    const ids = Object.values(state.cycles || {})
      .filter((c) => c.plotId === z.id).map((c) => c.id);
    return (state.sales || []).some((s) => ids.includes(s.cycleId))
      || (state.expenses || []).some((x) => ids.includes(x.cycleId));
  }).length;

  return [
    {
      id: 'KPI-01',
      measure: 'Hours from threshold breach to treatment done',
      target: `≤ ${ladder.kpiBreachAfterHours} h`,
      value: meanHours,
      display: meanHours == null ? 'nothing to measure yet' : `${meanHours} h`,
      ok: meanHours != null && meanHours <= ladder.kpiBreachAfterHours,
      basis: `${closed.length} alert${closed.length === 1 ? '' : 's'} closed in ${span} days`,
    },
    {
      id: 'KPI-02',
      measure: 'Scheduled scouting completed, with photo',
      target: '≥ 95%',
      value: scoutRate,
      display: scoutRate == null ? 'no scouting scheduled' : `${scoutRate}%`,
      ok: scoutRate != null && scoutRate >= 95,
      basis: `${doneWithPhoto.length} of ${scoutTasks.length} scheduled checks`,
    },
    {
      id: 'KPI-03',
      measure: 'Treatments logged without a diagnosis',
      target: '0',
      value: untreatedSprays,
      display: String(untreatedSprays),
      ok: untreatedSprays === 0,
      basis: 'The gate refuses new ones; this counts what is already recorded.',
    },
    {
      id: 'KPI-04',
      measure: 'Plantings logged without passing soil gates',
      target: '0',
      value: ungatedPlantings,
      display: String(ungatedPlantings),
      ok: ungatedPlantings === 0,
      basis: 'Counts standing Owner overrides.',
    },
    {
      id: 'KPI-05',
      measure: `Open alerts older than ${ladder.kpiBreachAfterHours} h`,
      target: '0',
      value: staleOpen,
      display: String(staleOpen),
      ok: staleOpen === 0,
      basis: `${all.filter((a) => a.status === 'open').length} open in total`
        + ' · section 3 allows 48 h; this counts from the 24-hour deadline',
    },
    {
      id: 'KPI-06',
      measure: 'Profit or loss known per zone',
      target: 'every cycle',
      value: zonesWithMoney,
      display: zones.length ? `${zonesWithMoney} of ${zones.length} zones` : 'no zones yet',
      ok: zones.length > 0 && zonesWithMoney === zones.length,
      basis: 'A zone counts once a sale or a cost has been tied to it.',
    },
  ];
}

/** Monday of the week a date falls in, which is how the farm counts a week. */
export function weekStart(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  const shift = (d.getDay() + 6) % 7;                    // Monday = 0
  return isoDate(addDays(d, -shift));
}

/**
 * FR-REP-03 — the same measures, one row per week.
 *
 * Built on kpis() rather than beside it: a KPI that is computed twice is a KPI
 * that disagrees with itself the first time somebody changes a rule.
 */
export function kpisByWeek(state, { now = new Date().toISOString(), weeks = 6, settings = null, zoneId = null } = {}) {
  const today = now.slice(0, 10);
  const thisWeek = weekStart(today);
  const out = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const from = isoDate(addDays(thisWeek, -7 * i));
    const to = isoDate(addDays(from, 6));
    const asAt = to < today ? `${to}T23:59:59.999Z` : now;
    out.push({
      from,
      to,
      current: i === 0,
      label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `Week of ${from}`,
      rows: kpis(state, { now: asAt, from, to, settings, zoneId }),
    });
  }
  return out;
}

/** FR-REP-03 — the same measures, one block per zone. */
export function kpisByZone(state, { now = new Date().toISOString(), days = 28, settings = null } = {}) {
  return Object.values(state.plots || {})
    .filter((z) => !z.retired)
    .map((zone) => ({ zone, rows: kpis(state, { now, days, settings, zoneId: zone.id }) }))
    .sort((a, b) => {
      const failed = (r) => r.rows.filter((x) => !x.ok).length;
      return failed(b) - failed(a) || String(a.zone.name).localeCompare(String(b.zone.name));
    });
}
