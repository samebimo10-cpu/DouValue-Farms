// The sticky-trap count — FR-SCOUT-01, FR-SCOUT-03, FR-FARM-04.
//
// The trap count is the number the thresholds are set against, and the people
// who count the traps are the Greenhouse Hands: the weekly trap check on every
// crop and the nursery's count every morning. Until this module the hand's
// trap check closed on a photo and a line of text, the number never became a
// scouting record, and so nothing a hand counted could ever cross a threshold
// and open an alert. A full trap in the nursery at seven in the morning waited
// for a supervisor to walk past and count it again.
//
// So a hand's count is a number, per pest, and it lands as a scouting record
// like any other — with the zone on it, because the nursery has no crop cycle
// to hang it on. alerts.js reads it exactly as it reads a supervisor's.
//
// A hand records trap counts only. A full scouting round — per-plant counts,
// findings, borer holes — is still the Field Supervisor's (`scout`); the farm
// server holds that line (server/core.mjs, guardScout).

import { DEFAULT_THRESHOLDS, breaches } from './alerts.js';
import { PROBLEM_BY_ID } from './pests.js';
import { isNursery } from './farm.js';
import { isoDate, uid } from '../util.js';

/** The tasks that are a trap count: the crop's weekly check and the nursery's daily one. */
export const TRAP_TASKS = new Set(['trap', 'nursery_trap']);

/**
 * Counted on every check, blank or not: the two vectors the trap card is hung
 * for (the task's own steps say "count the thrips and whitefly"). Zero is a
 * count. An empty box is not, and is refused, so "nothing written" cannot pass
 * for "nothing on the trap".
 */
export const ALWAYS_COUNTED = ['thrips', 'whitefly'];

/**
 * Every pest that has a per-trap threshold in force, after the Owner's edits
 * (FR-SCOUT-02). A pest without one cannot open an alert from a trap, so it is
 * not offered.
 */
export function trapPests(settings = {}) {
  const table = { ...DEFAULT_THRESHOLDS, ...((settings && settings.thresholds) || {}) };
  const ids = Object.keys(table).filter((id) => {
    const t = table[id] || {};
    return (t.greenhouse && t.greenhouse.perTrap != null) || (t.field && t.field.perTrap != null);
  });
  const order = (id) => (ALWAYS_COUNTED.includes(id) ? ALWAYS_COUNTED.indexOf(id) : ALWAYS_COUNTED.length);
  return ids
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((id) => ({ id, name: (PROBLEM_BY_ID[id] || {}).name || id, required: ALWAYS_COUNTED.includes(id) }));
}

/** The crop growing in a zone today, or null — the nursery has none. */
export function cycleIn(state, zoneId) {
  const c = Object.values((state && state.cycles) || {})
    .find((x) => x.plotId === zoneId && x.status === 'active');
  return c ? c.id : null;
}

/** Zones a trap is hung in: anything growing, and the nursery. */
export function trapZones(state) {
  return Object.values((state && state.plots) || {})
    .filter((z) => !z.retired && (isNursery(z) || cycleIn(state, z.id)))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

/**
 * Read the counts off a form: `count_<pestId>` fields.
 *
 * Returns the counts that were filled in, and why not if a required one is
 * missing or any of them is not a whole number from zero up.
 */
export function readCounts(data, settings = {}) {
  const counts = {};
  for (const pest of trapPests(settings)) {
    const raw = data && data[`count_${pest.id}`];
    const blank = raw == null || String(raw).trim() === '';
    if (blank) {
      if (pest.required) return { ok: false, why: `Count the ${pest.name.toLowerCase()} on the trap. If there are none, put 0.` };
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return { ok: false, why: `The ${pest.name.toLowerCase()} count is a whole number, 0 or more.` };
    counts[pest.id] = n;
  }
  return { ok: true, counts };
}

/**
 * One scouting record per pest counted, each carrying the zone (the nursery
 * has no crop) and, from a task, the task it closed — so a count is always
 * traceable to the check it came from.
 */
export function trapCountRecords(state, { zoneId, counts, taskId = null, note = '', date = isoDate(), enteredAt = new Date().toISOString() }) {
  const cycleId = cycleIn(state, zoneId);
  return Object.entries(counts || {}).map(([pestId, trapCount]) => ({
    id: taskId ? `sc_${taskId}_${pestId}` : uid('sc'),
    kind: 'trap',
    zoneId,
    cycleId,
    pestId,
    trapCount,
    note: String(note || ''),
    taskId,
    date,
    enteredAt,
  }));
}

/** Which of these counts are over the line — for telling the person, then and there. */
export function overThreshold(state, records) {
  const zoneOf = (r) => (state.plots || {})[r.zoneId] || null;
  return records
    .map((r) => ({ record: r, hit: breaches(r, zoneOf(r), state.settings || {}) }))
    .filter((x) => x.hit)
    .map(({ record, hit }) => ({
      pestId: record.pestId,
      name: (PROBLEM_BY_ID[record.pestId] || {}).name || record.pestId,
      count: hit.count,
      limit: hit.limit,
    }));
}
