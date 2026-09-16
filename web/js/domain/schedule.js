// The daily work, generated from the operations schedule — requirements 6.3.
//
// FR-TASK-01 asks for the day's tasks to appear per zone without anybody
// writing them out: scouting, trap checks, irrigation, fertigation, pruning,
// harvest, sanitation. The point is not convenience. It is that a round nobody
// scheduled is a round nobody misses, and the gap Season 1 fell into was
// exactly that shape — the scouting that would have caught the thrips was
// somebody's intention rather than somebody's list.
//
// GENERATION IS IDEMPOTENT
//
// Every generated task has a deterministic id built from the date, the zone and
// the kind. Five phones opening the app on Tuesday morning all generate the
// same Tuesday, and because IndexedDB keys events by id and the sync merge is a
// set union, it lands exactly once. No coordination, no leader, no duplicates —
// which matters when the phones are offline from each other for days.
//
// AWAITING Rev 5: the real cadence lives in the Farm Operations Schedule, which
// I have not seen. What follows is a defensible schedule for capsicum under
// cover in Port Harcourt, keyed to crop stage, and every line of it is a
// setting the Farm Manager can change without a release.

import { addDays, daysBetween, isoDate } from '../util.js';
import { stageAt, waterDemandMmPerDay } from './crops.js';

/**
 * The schedule.
 *
 * `every` is in days. `from`/`to` are days after transplant, so the work
 * follows the crop rather than the calendar — pruning a seedling and scouting a
 * finished bed are both wasted mornings.
 *
 * `fromStage` holds a list, because picking does not stop when the stage label
 * changes — it runs through `harvest` and on into `decline` until the bed is
 * cleared.
 *
 * `due` is the hour it should be done by. Scouting is early on purpose: thrips
 * and whitefly are countable in the cool of the morning and invisible by noon,
 * and a round done at four in the afternoon is a round that finds nothing.
 */
export const OPERATIONS = [
  {
    kind: 'scout',
    title: 'Scout and count',
    every: 3,
    due: 9,
    from: 7,
    proof: true,
    how: [
      'Walk a diagonal across the zone, stopping at ten plants.',
      'Look at the underside of the young leaves, the growing tip, the flowers and the fruit.',
      'Count what you find on the ten and put the average in the app.',
      'Photograph anything you are not sure about.',
    ],
    why: 'This is the round that catches a pest while it is still cheap. Ten plants looked at '
      + 'properly beats fifty glanced at.',
  },
  {
    kind: 'trap',
    title: 'Check the sticky traps',
    every: 7,
    due: 10,
    from: 0,
    proof: true,
    how: [
      'Photograph each trap before you touch it.',
      'Count the thrips and whitefly on one card and record it.',
      'Replace any trap that is full or more than three weeks old.',
    ],
    why: 'The trap count is the number the thresholds are set against, so it is the number that '
      + 'decides whether a spray happens.',
  },
  {
    kind: 'irrigate',
    title: 'Water',
    every: 1,
    due: 8,
    from: 0,
    how: [
      'Water at the base, early, never over the leaves.',
      'Check every dripper on the line is running before you leave.',
    ],
    why: 'Pepper drops its flowers within days of water stress, and wet leaves in this humidity '
      + 'are how anthracnose starts.',
  },
  {
    kind: 'fertigate',
    title: 'Feed',
    every: 7,
    due: 9,
    from: 14,
    how: [
      'Mix to the rate on the plan for this stage.',
      'Run clean water through the line afterwards so it does not block.',
    ],
    why: 'Fruit fill is where the yield is decided, and it is where calcium and potassium run short.',
  },
  {
    kind: 'prune',
    title: 'Prune and tie',
    every: 14,
    due: 11,
    from: 28,
    to: 120,
    how: [
      'Take off the leaves below the first fork and anything touching the ground.',
      'Tie the new growth up before it bends.',
      'Wash your hands between zones.',
    ],
    why: 'Air moving through the plant is the cheapest disease control there is. Hands moving '
      + 'between zones is the fastest way to spread a virus.',
  },
  {
    kind: 'harvest',
    title: 'Pick',
    every: 3,
    due: 8,
    fromStage: ['harvest', 'decline'],
    how: [
      'Pick into the crate, not the ground.',
      'Anything spotted or soft goes in a separate crate and is recorded as a reject.',
      'Weigh at the zone and enter it at the zone.',
    ],
    why: 'Ripe fruit left on the plant tells it to stop setting more. Picking late costs the fruit '
      + 'you can see and the fruit you would have had.',
  },
  {
    kind: 'sanitation',
    title: 'Clean down',
    every: 7,
    due: 16,
    from: 0,
    proof: true,
    how: [
      'Clear fallen leaves and fruit out of the zone and off the farm — not onto the path.',
      'Disinfect the footbath at the door.',
      'Wipe down tools before they go back.',
    ],
    why: 'Fallen fruit under the bench is where anthracnose overwinters and where fruit fly breeds.',
  },
];

/** A stable id, so the same day generated twice is the same task. */
export const taskIdFor = (date, zoneId, kind) => `gen_${date}_${zoneId}_${kind}`;

/** Is this operation due on this date for this cycle? */
function dueOn(op, cycle, date, cropId) {
  const dat = daysBetween(cycle.transplantDate, date);
  if (dat < 0) return false;
  if (op.from != null && dat < op.from) return false;
  if (op.to != null && dat > op.to) return false;
  if (op.fromStage) {
    const wanted = Array.isArray(op.fromStage) ? op.fromStage : [op.fromStage];
    const stage = stageAt(cropId, dat);
    if (!stage || !wanted.includes(stage.id)) return false;
  }
  // Counted from transplant so the rhythm is the crop's, not the calendar's —
  // and so two zones planted a week apart do not both fall on Monday.
  const offset = op.from != null ? op.from : 0;
  return (dat - offset) % op.every === 0;
}

/**
 * The work due on one day, for every zone with something growing in it.
 *
 * Pure: same farm, same date, same list. That is what lets every phone generate
 * it independently and agree.
 */
export function tasksFor(state, { date = isoDate(), operations = null } = {}) {
  const schedule = operations || (state.settings && state.settings.operations) || OPERATIONS;
  const out = [];

  // Which position owns each zone. Built once rather than searched per task.
  const positionOfZone = new Map();
  for (const pos of Object.values(state.positions || {})) {
    if (!pos.retired && pos.primaryZoneId) positionOfZone.set(pos.primaryZoneId, pos.id);
  }

  for (const cycle of Object.values(state.cycles || {})) {
    if (cycle.status !== 'active') continue;
    const zone = (state.plots || {})[cycle.plotId];
    if (!zone || zone.retired) continue;

    for (const op of schedule) {
      if (!dueOn(op, cycle, date, cycle.cropId)) continue;
      out.push({
        id: taskIdFor(date, zone.id, op.kind),
        kind: op.kind,
        title: `${op.title} — ${zone.name}`,
        zoneId: zone.id,
        cycleId: cycle.id,
        // FR-TASK-02: an owner position, not a person. Who is actually doing it
        // today is resolved at read time, so absence reassigns without anybody
        // editing a task.
        positionId: positionOfZone.get(zone.id) || null,
        due: `${date}T${String(op.due).padStart(2, '0')}:00`,
        generated: true,
        proof: !!op.proof,
        how: op.how,
        why: op.why,
      });
    }
  }

  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/**
 * Which of today's tasks are not on the log yet.
 *
 * The caller files these. Anything already there is left alone, so a task
 * somebody has already done is never resurrected as open.
 */
export function missingTasks(state, { date = isoDate(), operations = null } = {}) {
  const existing = state.tasks || {};
  return tasksFor(state, { date, operations }).filter((t) => !existing[t.id]);
}

/**
 * FR-TASK-03 — what is overdue, and whose list it moves to.
 *
 * Overdue work does not merely turn red where it is. It moves to the Field
 * Supervisor, because the person who missed it is by definition not looking at
 * their list.
 */
export function overdue(state, { now = new Date(), date = isoDate() } = {}) {
  return Object.values(state.tasks || {})
    .filter((t) => t.status === 'open' && t.due)
    .filter((t) => new Date(t.due) < now)
    .map((t) => ({
      ...t,
      hoursLate: Math.round(((now - new Date(t.due)) / 3600000) * 10) / 10,
      // Anything still open at the end of the day is the Supervisor's.
      escalated: t.due.slice(0, 10) < date,
    }))
    .sort((a, b) => b.hoursLate - a.hoursLate);
}

/** How the day is going, for the progress bar on a hand's home screen (UX-24). */
export function dayProgress(state, { date = isoDate(), personId = null } = {}) {
  let mine = Object.values(state.tasks || {})
    .filter((t) => (t.due || '').slice(0, 10) === date);
  if (personId) {
    mine = mine.filter((t) => t.assignedTo === personId || t.doneBy === personId || !t.assignedTo);
  }
  const done = mine.filter((t) => t.status === 'done').length;
  return {
    total: mine.length,
    done,
    fraction: mine.length ? done / mine.length : 0,
    text: mine.length ? `${done} of ${mine.length} done` : 'Nothing scheduled today',
  };
}

/** The steps for a task kind, for the numbered card on the worker's screen (UX-19). */
export function howTo(kind, operations = OPERATIONS) {
  const op = operations.find((o) => o.kind === kind);
  return op ? { title: op.title, how: op.how, why: op.why, proof: !!op.proof } : null;
}
