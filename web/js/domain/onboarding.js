// Mid-season onboarding — FR-ONB-01 to FR-ONB-08.
//
// The farm does not start using the app on a bare field. On the day it goes
// live, GH-01 is in Week 6, GH-03 is being picked, and somebody sprayed
// spinosad on Tuesday. The app has to start from there, not from transplant,
// and it has to start from there without pretending it knows things it does
// not.
//
// Two kinds of record come out of that day, and the whole of this file is about
// keeping them apart:
//
//   * The crop cycle itself (cycle.onboard): media, crop, variety and the
//     transplant date. Everything that counts in weeks — the current week, the
//     Week 10 organics rule, the task schedule — derives from that date, so a
//     crop onboarded in Week 6 is in Week 6 from the first minute.
//
//   * Backfilled entries (backfill.record): the last insecticide and the last
//     fungicide with their group and date, every spray in the last 21 days,
//     the harvest to date, the stock on hand, and any gate evidence that
//     exists. Each one is marked backfilled and kept apart from the live
//     records. A backfilled spray is not a treatment the app gated, so it is
//     never counted as one (G3, KPI-03, the follow-up board); but it is a real
//     chemical on real fruit, so the rotation gate and the PHI harvest block
//     read it exactly as they read a live spray.
//
// And one rule stops the gap between the two from being silently waved
// through (gates.js rule 2: unknown is not pass). A zone onboarded without its
// spray history has an unknown last group and an unknown waiting period. The
// rotation cannot be judged and neither can the PHI, so treatments and harvest
// there are blocked, with a message that says the history is missing, until it
// is entered.

import { addDays, daysBetween, isoDate } from '../util.js';
import { peekRules } from '../rules.js';
import { buildCatalogue, parseGroup, resolveActive } from './catalogue.js';
import { harvestClearance, reentryClearance } from './safety.js';
import { tasksFor } from './schedule.js';

/** FR-ONB-03: how far back "any spray in the last N days" reaches. */
export const HISTORY_WINDOW_DAYS = 21;

/** The status a zone planted before the app existed gets on the Gates screen. */
export const PRE_GATES = 'pre-gates';
export const PRE_GATES_LABEL = 'Planted before the gates';

/** What a backfilled entry can be. */
export const BACKFILL_KINDS = ['spray', 'harvest', 'stock', 'evidence', 'declare'];

/**
 * The statements a person can make on the setup screen when the honest answer
 * is "none". Recording "no fungicide this cycle" is a fact; leaving the field
 * blank is not, and the two must not look the same to a gate.
 */
export const DECLARATIONS = {
  'no-insecticide': 'No insecticide has gone on this crop',
  'no-fungicide': 'No fungicide has gone on this crop',
  'recent-complete': `Every spray in the last ${HISTORY_WINDOW_DAYS} days is entered`,
  'zone-empty': 'Nothing is growing in this zone',
};

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

export const isOnboarded = (cycle) => !!(cycle && cycle.onboarded);

/** Backfilled entries, filtered. Newest first. */
export function backfills(state, { cycleId = null, zoneId = null, kind = null } = {}) {
  return ((state && state.backfills) || [])
    .filter((b) => !kind || b.kind === kind)
    .filter((b) => !cycleId || b.cycleId === cycleId)
    .filter((b) => !zoneId || b.zoneId === zoneId)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

function catalogueFor(state, opts) {
  if (opts.catalogue) return opts.catalogue;
  const rules = opts.rules || peekRules();
  return rules ? buildCatalogue(state || {}, rules) : null;
}

/**
 * The resistance system of a backfilled spray: IRAC, FRAC or neither. Read off
 * the catalogue first, then the group written on the entry, then the slot it
 * was entered in ("last insecticide").
 */
export function systemOf(entry, catalogue = null) {
  const active = catalogue ? resolveActive(catalogue, entry.activeId || entry.productName) : null;
  const group = parseGroup((active && active.group) || entry.group || null);
  if (group.system === 'IRAC' || group.system === 'FRAC') return group.system;
  if (entry.slot === 'insecticide') return 'IRAC';
  if (entry.slot === 'fungicide') return 'FRAC';
  return null;
}

/**
 * Backfilled sprays for one cycle, in the shape of a live spray record so the
 * rotation and the PHI can read them without knowing where they came from.
 *
 * FR-STOCK-07 applies to the waiting period: the catalogue's default holds
 * unless the entry states a longer one, and an entry naming nothing the
 * catalogue knows gets the 14-day synthetic default rather than zero.
 */
export function backfilledSprays(state, cycleId = null, opts = {}) {
  const catalogue = catalogueFor(state, opts);
  return backfills(state, { cycleId, kind: 'spray' }).map((b) => {
    const active = catalogue ? resolveActive(catalogue, b.activeId || b.productName) : null;
    const entered = Number(b.phiDays);
    const enteredRei = Number(b.reiHours);
    const basePhi = active ? active.phiDays : 14;
    const baseRei = active ? active.reiHours : 24;
    return {
      ...b,
      // `at` on the entry is when it was typed in, not when the spray went
      // on. Re-entry is timed from `at` when there is one, so it is moved
      // aside: a spray backfilled as five days old is five days old.
      at: null,
      enteredAt: b.at,
      backfilled: true,
      activeId: (active && active.id) || b.activeId || null,
      productId: (active && active.id) || b.activeId || null,
      productName: (active && active.name) || b.productName || 'Unnamed product',
      group: (active && active.group) || b.group || '',
      phiDays: Number.isFinite(entered) && entered > basePhi ? entered : basePhi,
      reiHours: Number.isFinite(enteredRei) && enteredRei > baseRei ? enteredRei : baseRei,
      diagnosisId: null,
    };
  });
}

/**
 * Every spray the gates must reckon with on this cycle: the live ones and the
 * backfilled ones. FR-ONB-04.
 */
export function sprayHistory(state, cycleId, opts = {}) {
  const live = ((state && state.sprays) || []).filter((s) => s.cycleId === cycleId);
  return [...live, ...backfilledSprays(state, cycleId, opts)];
}

/** The latest "none" statement of this kind for a cycle (or zone). */
function declared(state, item, { cycleId = null, zoneId = null } = {}) {
  return backfills(state, { kind: 'declare', cycleId, zoneId }).find((d) => d.item === item) || null;
}

/**
 * FR-ONB-05 — is this cycle's spray history on record?
 *
 * A cycle started in the app has its whole history in the app, so it is known
 * by construction. An onboarded cycle needs three things, each either entered
 * or stated as none: the last insecticide, the last fungicide, and every spray
 * in the 21 days before setup.
 */
export function sprayHistoryStatus(state, cycleId, opts = {}) {
  const cycle = ((state && state.cycles) || {})[cycleId];
  if (!cycle) return { known: false, cycle: null, missing: [], lines: [] };
  if (!isOnboarded(cycle)) return { known: true, cycle, live: true, missing: [], lines: [] };

  const catalogue = catalogueFor(state, opts);
  const sprays = backfills(state, { cycleId, kind: 'spray' });
  const bySystem = (system) => sprays.filter((s) => systemOf(s, catalogue) === system)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : -1))[0] || null;

  const line = (id, label, have, from) => ({ id, label, have: !!have, from: from || null });
  const insecticide = bySystem('IRAC');
  const fungicide = bySystem('FRAC');
  const lines = [
    line('insecticide', 'Last insecticide, with its group and date',
      insecticide || declared(state, 'no-insecticide', { cycleId }),
      insecticide ? `${insecticide.productName || insecticide.group} on ${dayOf(insecticide)}`
        : declared(state, 'no-insecticide', { cycleId }) ? DECLARATIONS['no-insecticide'] : null),
    line('fungicide', 'Last fungicide, with its group and date',
      fungicide || declared(state, 'no-fungicide', { cycleId }),
      fungicide ? `${fungicide.productName || fungicide.group} on ${dayOf(fungicide)}`
        : declared(state, 'no-fungicide', { cycleId }) ? DECLARATIONS['no-fungicide'] : null),
    line('recent', `Every spray in the last ${HISTORY_WINDOW_DAYS} days`,
      declared(state, 'recent-complete', { cycleId }),
      declared(state, 'recent-complete', { cycleId }) ? DECLARATIONS['recent-complete'] : null),
  ];
  const missing = lines.filter((l) => !l.have);
  return { known: missing.length === 0, cycle, live: false, missing, lines };
}

function missingText(status) {
  return status.missing.map((l) => l.label.toLowerCase()).join('; ');
}

/**
 * FR-ONB-05 — a treatment on a cycle with no spray history on record.
 *
 * Returns null when the history is known. Otherwise the refusal, in the same
 * shape as every other treatment refusal (reason, why, fix).
 */
export function treatmentHistoryBlock(state, cycleId, opts = {}) {
  const status = sprayHistoryStatus(state, cycleId, opts);
  if (status.known || !status.cycle) return null;
  return {
    ok: false,
    reason: 'spray-history-missing',
    missing: status.missing,
    why: `The spray history for this zone is missing: ${missingText(status)}. `
      + 'Without it the app cannot tell which group went on last, so it cannot check the rotation.',
    fix: 'The Farm Manager or Owner enters it on the Setup screen: the last insecticide and the last fungicide '
      + `with group and date, and every spray in the last ${HISTORY_WINDOW_DAYS} days — or records that there were none.`,
    sources: ['FR-ONB-05', 'FR-GATE-05'],
  };
}

/**
 * FR-TREAT-02 and FR-ONB-04/05 — may this cycle be picked?
 *
 * The PHI reads live and backfilled sprays alike. A cycle with no spray
 * history on record is not safe by default; it is blocked, because a spray
 * nobody entered is exactly the one whose waiting period is still running.
 */
export function harvestCheck(state, cycleId, at = new Date(), opts = {}) {
  const status = sprayHistoryStatus(state, cycleId, opts);
  if (status.cycle && !status.known) {
    return {
      safe: false,
      reason: `The spray history for this zone is missing (${missingText(status)}), so the app cannot tell `
        + 'whether a spray is still inside its waiting period.',
      historyMissing: true,
      missing: status.missing,
      clearOn: null,
      daysLeft: null,
      blocker: null,
    };
  }
  return harvestClearance(sprayHistory(state, cycleId, opts), at);
}

/** Re-entry reads backfilled sprays as well: the chemical does not know it was typed in late. */
export function reentryCheck(state, cycleId, at = new Date(), opts = {}) {
  return reentryClearance(sprayHistory(state, cycleId, opts), at);
}

/** The latest harvest-to-date figure for a cycle, if one was entered. */
export function harvestToDate(state, cycleId) {
  return backfills(state, { cycleId, kind: 'harvest' })[0] || null;
}

/** FR-ONB-06 — the evidence entered for a zone planted before the gates. */
export function preGatesEvidence(state, zoneId, cycleId = null) {
  return backfills(state, { zoneId, kind: 'evidence' })
    .filter((e) => !cycleId || !e.cycleId || e.cycleId === cycleId);
}

/**
 * FR-ONB-06 — was this crop planted before the app existed?
 *
 * Only an onboarded cycle whose transplant date is before the day it was set
 * up. It is a status, not a pass: the gates still say what they found, and
 * none of it counts as a violation or needs an override, because there was no
 * gate to pass on the day it went in.
 */
export function plantedBeforeGates(cycle) {
  if (!isOnboarded(cycle) || !cycle.transplantDate) return false;
  const setup = cycle.onboarded.date || dayOf(cycle.onboarded);
  return !!setup && cycle.transplantDate < setup;
}

/**
 * FR-ONB-02 — the day a crop is on, from its transplant date.
 *
 * Rules → week_counting: "Transplant day = T = Day 1 of Week 0.
 * week = floor((date - T) / 7)." Same arithmetic as rotation.cropWeek.
 */
export function cropDay(transplantDate, today = isoDate()) {
  if (!transplantDate) return null;
  const days = daysBetween(transplantDate, today);
  if (days < 0) return null;
  return { days, week: Math.floor(days / 7), dayOfWeek: (days % 7) + 1 };
}

/**
 * FR-ONB-02 — the task schedule for one cycle from a day onward.
 *
 * The same generator the daily round uses, keyed on days after transplant, so
 * a crop onboarded in Week 6 gets Week 6's work in Week 6's rhythm — and
 * nothing from the weeks before the app, which are not overdue, just past.
 */
export function scheduleFrom(state, cycleId, { from = isoDate(), days = 7, operations = null } = {}) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = isoDate(addDays(from, i));
    out.push(...tasksFor(state, { date, operations })
      .filter((t) => t.cycleId === cycleId)
      .map((t) => ({ ...t, date })));
  }
  return out;
}

/**
 * FR-ONB-08 — what setup still needs, zone by zone.
 *
 * One row per cropping zone. A zone is complete when it either has a crop the
 * app knows the whole history of, or an onboarded crop with every item
 * entered, or is recorded as empty. The farm-wide stock count is its own row.
 */
export function setupStatus(state, { today = isoDate(), ...opts } = {}) {
  const zones = Object.values((state && state.plots) || {})
    .filter((z) => !z.retired && z.type !== 'nursery')
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

  const rows = zones.map((zone) => {
    const cycle = Object.values(state.cycles || {})
      .filter((c) => c.plotId === zone.id && c.status === 'active')
      .sort((a, b) => ((a.transplantDate || '') < (b.transplantDate || '') ? 1 : -1))[0] || null;

    if (!cycle) {
      // Between two cycles the app ran: nothing to onboard.
      if (Object.values(state.cycles || {}).some((c) => c.plotId === zone.id && c.status === 'closed')) {
        return { zone, cycle: null, status: 'between', complete: true, missing: [], notes: ['Between cycles.'] };
      }
      const empty = declared(state, 'zone-empty', { zoneId: zone.id });
      return empty
        ? { zone, cycle: null, status: 'empty', complete: true, missing: [], notes: [DECLARATIONS['zone-empty']] }
        : { zone, cycle: null, status: 'not-set-up', complete: false,
          missing: [{ id: 'cycle', label: 'The crop in it: media type, crop, variety and transplant date — or record that it is empty' }],
          notes: [] };
    }
    if (!isOnboarded(cycle)) {
      return { zone, cycle, status: 'live', complete: true, missing: [], notes: ['Started in the app; its history is complete.'] };
    }

    const missing = [];
    if (!cycle.media) missing.push({ id: 'media', label: 'Media type (bed soil or plant bags)' });
    if (!cycle.cropId) missing.push({ id: 'crop', label: 'Crop' });
    if (!cycle.variety) missing.push({ id: 'variety', label: 'Variety' });
    if (!cycle.transplantDate) missing.push({ id: 'transplant', label: 'Transplant date' });
    const history = sprayHistoryStatus(state, cycle.id, opts);
    missing.push(...history.missing.map((l) => ({ id: `spray-${l.id}`, label: l.label })));
    if (!harvestToDate(state, cycle.id)) missing.push({ id: 'harvest', label: 'Harvest to date (0 if nothing picked yet)' });

    const evidence = preGatesEvidence(state, zone.id, cycle.id);
    const notes = [];
    if (plantedBeforeGates(cycle)) notes.push(`${PRE_GATES_LABEL}.`);
    notes.push(evidence.length
      ? `${evidence.length} piece${evidence.length === 1 ? '' : 's'} of gate evidence attached.`
      : 'No gate evidence attached. Add any that exists: a soil or lab report, a pH reading, a photo.');
    const at = cropDay(cycle.transplantDate, today);
    return {
      zone, cycle, status: missing.length ? 'incomplete' : 'complete', complete: !missing.length,
      missing, notes, week: at ? at.week : null, history, evidence,
    };
  });

  const stock = backfills(state, { kind: 'stock' });
  const farm = {
    id: 'stock',
    label: 'Stock on hand',
    complete: stock.length > 0,
    missing: stock.length ? [] : [{ id: 'stock', label: 'Count the store: chemicals, fertiliser, lime, seed, traps' }],
    count: stock.length,
  };

  return {
    rows,
    farm,
    incomplete: rows.filter((r) => !r.complete),
    complete: rows.every((r) => r.complete) && farm.complete,
  };
}
