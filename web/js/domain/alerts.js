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
 * The escalation ladder — FR-SCOUT-04.
 *
 * AWAITING D-4: the document leaves the timings open and marks the middle rung
 * "[4] h". These are the bracketed defaults, and they are settings, not
 * constants, so the Owner can set the real ones without a release.
 */
export const DEFAULT_LADDER = {
  // Straight to the Farm Manager the moment the count is recorded.
  managerAtOnce: true,
  // Nobody acknowledged it → the Field Supervisor.
  supervisorAfterHours: 4,
  // Still not closed → the Owner. This is the KPI-01 deadline.
  ownerAfterHours: 24,
};

export const ALERT_LEVEL = {
  manager: { rank: 1, label: 'Farm Manager', tone: 'warn' },
  supervisor: { rank: 2, label: 'Field Supervisor', tone: 'warn' },
  owner: { rank: 3, label: 'Owner', tone: 'danger' },
};

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
      // FR-SCOUT-03: the deadline is set when the alert opens, not when
      // somebody gets round to looking at it.
      dueAt: new Date(new Date(at).getTime() + ladder.ownerAfterHours * 3600000).toISOString(),
    };

    const closure = closureFor(state, breach);
    const ack = ackFor(state, breach);

    if (closure) {
      breach.status = 'closed';
      breach.closure = closure;
      // KPI-01: this is the number the whole section exists to move.
      breach.hoursToClose = Math.round(hoursBetween(at, closure.at) * 10) / 10;
      breach.withinDeadline = breach.hoursToClose <= ladder.ownerAfterHours;
    } else {
      breach.status = 'open';
      breach.ack = ack;
      breach.hoursOpen = Math.round(hoursBetween(at, now) * 10) / 10;
      breach.overdue = breach.hoursOpen > ladder.ownerAfterHours;
      breach.level = levelFor(breach.hoursOpen, !!ack, ladder);
      openByKey.set(key, breach);
    }
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
  if (hoursOpen >= ladder.ownerAfterHours) return 'owner';
  if (!acknowledged && hoursOpen >= ladder.supervisorAfterHours) return 'supervisor';
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
 * The success measures — section 3. The app is only working if these move.
 *
 * Computed, not claimed. Every one of them is read straight off the records so
 * nobody has to be trusted to report it.
 */
export function kpis(state, { now = new Date().toISOString(), days = 28, settings = null } = {}) {
  const config = settings || state.settings || {};
  const ladder = { ...DEFAULT_LADDER, ...(config.ladder || {}) };
  const today = now.slice(0, 10);
  const from = isoDate(addDays(today, -days));
  const all = alerts(state, { now, settings: config });
  const inWindow = all.filter((a) => a.date >= from);

  // KPI-01 — breach to treatment done.
  const closed = inWindow.filter((a) => a.status === 'closed' && a.hoursToClose != null);
  const meanHours = closed.length
    ? Math.round((closed.reduce((s, a) => s + a.hoursToClose, 0) / closed.length) * 10) / 10
    : null;

  // KPI-02 — scouting completed, with a photo.
  const scoutTasks = Object.values(state.tasks || {})
    .filter((t) => t.kind === 'scout' && (t.due || '').slice(0, 10) >= from);
  const doneWithPhoto = scoutTasks.filter((t) => t.status === 'done' && t.photo);
  const scoutRate = scoutTasks.length
    ? Math.round((doneWithPhoto.length / scoutTasks.length) * 100) : null;

  // KPI-03 — treatments with no diagnosis behind them. The gate makes new ones
  // impossible; this counts what is already on the record.
  const untreatedSprays = (state.sprays || [])
    .filter((s) => (s.date || '') >= from)
    .filter((s) => !s.diagnosisId).length;

  // KPI-04 — plantings that did not pass their gates.
  const ungatedPlantings = (state.gateOverrides || [])
    .filter((o) => !o.revoked && (o.at || '').slice(0, 10) >= from).length;

  // KPI-05 — open alerts past the deadline.
  const staleOpen = all.filter((a) => a.status === 'open' && a.hoursOpen > ladder.ownerAfterHours).length;

  // KPI-06 — is profit known per zone?
  const zones = Object.values(state.plots || {});
  const zonesWithMoney = zones.filter((z) => {
    const cycleIds = Object.values(state.cycles || {})
      .filter((c) => c.plotId === z.id).map((c) => c.id);
    return (state.sales || []).some((s) => cycleIds.includes(s.cycleId))
      || (state.expenses || []).some((x) => cycleIds.includes(x.cycleId));
  }).length;

  return [
    {
      id: 'KPI-01',
      measure: 'Hours from threshold breach to treatment done',
      target: `≤ ${ladder.ownerAfterHours} h`,
      value: meanHours,
      display: meanHours == null ? 'nothing to measure yet' : `${meanHours} h`,
      ok: meanHours != null && meanHours <= ladder.ownerAfterHours,
      basis: `${closed.length} alert${closed.length === 1 ? '' : 's'} closed in ${days} days`,
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
      measure: `Open alerts older than ${ladder.ownerAfterHours} h`,
      target: '0',
      value: staleOpen,
      display: String(staleOpen),
      ok: staleOpen === 0,
      basis: `${all.filter((a) => a.status === 'open').length} open in total`,
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
