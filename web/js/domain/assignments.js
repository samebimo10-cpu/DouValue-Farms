// Field assignments — requirements §4.1, FR-ROLE-05 to FR-ROLE-11.
//
// Section 4 made jobs positions rather than people, and that still holds. What
// it did not say is that a Farm Manager on a farm this size is also in the
// houses: he walks GH-03 himself when a hand is off, the Field Supervisor holds
// OF-01 because nobody else is trained on the ridges, and the Owner scouts the
// nursery on a Sunday. Before this file that work lived nowhere — the manager's
// own scouting round was a task on nobody's list, which is the exact shape of
// the gap Season 1 fell into.
//
// So a field assignment is one person holding one zone, as its primary or its
// backup. Anyone may hold one, in any role (FR-ROLE-05). A zone can carry
// several people and a person several zones (FR-ROLE-07). The positions from
// section 4 still count: whoever holds "Greenhouse Hand — GH-02" holds GH-02 as
// its primary, exactly as before, so nothing already set up changes meaning.
//
// Who does a task is resolved when it is read, never written onto the task, so
// an absence or a new assignment moves the work without anybody editing it —
// the same rule positions.js follows for FR-ROLE-02.
//
// The one thing a person's own work must never do is escalate to themselves.
// A Field Supervisor whose own scouting round is late does not get a reminder
// from the Field Supervisor rung; it goes to the Farm Manager (FR-ROLE-10).

import { addDays, isoDate } from '../util.js';
import { isAbsent, resolveOwner } from './positions.js';
import { tasksFor } from './schedule.js';

/** The two ways to hold a zone — FR-ROLE-01, per zone rather than per position. */
export const HOLDINGS = ['primary', 'backup'];

/** Roles that get both views, My work and The farm — FR-ROLE-08. */
export const SUPERVISING = new Set(['supervisor', 'manager', 'ceo']);

/**
 * The overdue ladder — FR-TASK-03 with FR-ROLE-10.
 *
 * Overdue work goes to the Field Supervisor first. A rung is skipped when the
 * person whose task it is holds it, so the Supervisor's own goes to the Farm
 * Manager and the Farm Manager's own goes to the Owner.
 */
export const OVERDUE_LADDER = [
  { rung: 'supervisor', title: 'Field Supervisor', rank: 50 },
  { rung: 'manager', title: 'Farm Manager', rank: 80 },
  { rung: 'ceo', title: 'Owner', rank: 100 },
];

const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOf = (person) => (person ? RANK[person.role] ?? -1 : -1);

export function hasFarmView(user) {
  return !!user && SUPERVISING.has(user.role);
}

const peopleOf = (state) => (state && state.people) || {};
const active = (person) => !!person && person.active !== false;
const dayOf = (task) => (task.due || '').slice(0, 10) || task.dueDate || null;
/** A task written against a bed rather than a zone still belongs to that bed's zone. */
const zoneOf = (state, task) => task.zoneId
  || (task.cycleId && ((state && state.cycles) || {})[task.cycleId]
    ? state.cycles[task.cycleId].plotId : null);

/** Every live assignment on the farm, newest first. */
export function liveAssignments(state) {
  return Object.values((state && state.assignments) || {})
    .filter((a) => !a.ended)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/**
 * Who holds a zone — FR-ROLE-07.
 *
 * Assignments and positions together, one entry per person per holding. A
 * person on both lists (say, primary by position and backup by assignment) is
 * kept on the primary list only, because that is the stronger claim.
 */
export function zoneHolders(state, zoneId) {
  const people = peopleOf(state);
  const out = { primary: [], backup: [] };
  const seen = { primary: new Set(), backup: new Set() };
  const add = (holding, person, via) => {
    if (!active(person) || seen[holding].has(person.id)) return;
    seen[holding].add(person.id);
    out[holding].push({ person, holding, ...via });
  };

  for (const a of liveAssignments(state)) {
    if (a.zoneId !== zoneId) continue;
    add(a.holding === 'backup' ? 'backup' : 'primary', people[a.personId],
      { via: 'assignment', assignmentId: a.id });
  }
  for (const pos of Object.values((state && state.positions) || {})) {
    if (pos.retired || !pos.holderId) continue;
    if (pos.primaryZoneId === zoneId) add('primary', people[pos.holderId], { via: 'position', positionId: pos.id });
    if (pos.backupZoneId === zoneId) add('backup', people[pos.holderId], { via: 'position', positionId: pos.id });
  }
  out.backup = out.backup.filter((h) => !seen.primary.has(h.person.id));
  const byName = (a, b) => String(a.person.name).localeCompare(String(b.person.name));
  out.primary.sort(byName);
  out.backup.sort(byName);
  return out;
}

/** The zones one person holds, with how — the top of their My work (FR-ROLE-05). */
export function zonesHeldBy(state, personId) {
  const plots = (state && state.plots) || {};
  const out = [];
  for (const zone of Object.values(plots)) {
    if (zone.retired) continue;
    const h = zoneHolders(state, zone.id);
    const mine = h.primary.find((x) => x.person.id === personId)
      || h.backup.find((x) => x.person.id === personId);
    if (mine) out.push({ zone, holding: mine.holding, via: mine.via });
  }
  return out.sort((a, b) => (a.holding === b.holding
    ? String(a.zone.name).localeCompare(String(b.zone.name))
    : a.holding === 'primary' ? -1 : 1));
}

/**
 * Is this person working on that date?
 *
 * Today is judged the way positions.js judges it: declared, or not clocked in
 * once the morning is out. A future day only knows about declared absence — a
 * roster for next Thursday cannot assume nobody turns up. A past day that has
 * ended counts a person who never clocked in as out, which is what the
 * attendance book says. `roster` reads declared absence only, for a plan of
 * the week rather than a record of it.
 */
export function presentOn(state, personId, date, { today = isoDate(), now = new Date(), roster = false } = {}) {
  const declared = ((state && state.absences) || [])
    .some((a) => a.personId === personId && a.date === date && !a.cancelled);
  if (declared) return false;
  if (roster || date > today) return true;
  const when = date === today ? now : new Date(`${date}T23:59:00`);
  return !isAbsent(state, personId, { today: date, now: when }).absent;
}

/**
 * Who does this task on its day — FR-ROLE-05/07 with FR-ROLE-02.
 *
 * A task written for one person stays with that person. Otherwise it goes to
 * everyone who holds its zone as primary and is in; when none of them is, to
 * the backup holders who are; when nobody is, it is uncovered and says why.
 * A zone nobody holds at all is `unheld`, and The farm lists it as a gap.
 */
export function doersFor(state, task, { today = isoDate(), now = new Date(), roster = false } = {}) {
  const people = peopleOf(state);
  const date = dayOf(task) || today;

  if (task.assignedTo) {
    const person = people[task.assignedTo];
    return { people: active(person) ? [person] : [], covering: false, direct: true };
  }

  const zoneId = zoneOf(state, task);
  if (zoneId) {
    const zone = ((state && state.plots) || {})[zoneId];
    const name = zone ? zone.name : 'this zone';
    const holders = zoneHolders(state, zoneId);
    if (!holders.primary.length && !holders.backup.length) {
      if (task.positionId) return fromPosition(state, task, { today, now });
      return { people: [], unheld: true, why: `Nobody holds ${name}.` };
    }
    const here = (list) => list.filter((h) => presentOn(state, h.person.id, date, { today, now, roster }));
    const primary = here(holders.primary);
    if (primary.length) return { people: primary.map((h) => h.person), covering: false };
    const backup = here(holders.backup);
    const away = holders.primary.map((h) => h.person.name).join(' and ');
    if (backup.length) {
      return {
        people: backup.map((h) => h.person),
        covering: true,
        instead: holders.primary.map((h) => h.person),
        why: holders.primary.length
          ? `${away} ${holders.primary.length === 1 ? 'is' : 'are'} not in, so ${name} passes to `
            + `${backup.map((h) => h.person.name).join(' and ')} as backup.`
          : `${name} has no primary holder, so the backup takes it.`,
      };
    }
    return {
      people: [],
      unassigned: true,
      why: `${away || 'The holders'} ${holders.primary.length === 1 ? 'is' : 'are'} not in and `
        + `no backup for ${name} is either.`,
    };
  }

  if (task.positionId) return fromPosition(state, task, { today, now });
  return { people: [], unheld: true, why: 'This task is not tied to a zone or a person.' };
}

function fromPosition(state, task, { today, now }) {
  const r = resolveOwner(state, task.positionId, { today: dayOf(task) || today, now });
  if (r.person) return { people: [r.person], covering: !!r.covering, why: r.why || null };
  return { people: [], unassigned: true, why: r.why || 'Nobody holds this position.' };
}

/**
 * Whose task it is, for the ladder: whoever is doing it today, and the
 * primary holders of its zone whether or not they are in. A Farm Manager who
 * has not clocked in is still the person whose round is late.
 */
export function ownersOf(state, task, opts = {}) {
  const out = new Map();
  for (const p of doersFor(state, task, opts).people) out.set(p.id, p);
  if (!task.assignedTo) {
    const zoneId = zoneOf(state, task);
    if (zoneId) for (const h of zoneHolders(state, zoneId).primary) out.set(h.person.id, h.person);
    else if (task.positionId) {
      const pos = ((state && state.positions) || {})[task.positionId];
      const holder = pos && pos.holderId ? peopleOf(state)[pos.holderId] : null;
      if (active(holder)) out.set(holder.id, holder);
    }
  }
  return [...out.values()];
}

/** Is it past due and still open? */
export function isOverdue(task, now = new Date()) {
  return !!task && task.status === 'open' && !!task.due && new Date(task.due) < now;
}

/**
 * Where overdue work goes — FR-TASK-03 and FR-ROLE-10.
 *
 * Up the ladder from the Field Supervisor, skipping any rung held by the
 * person whose task it is, any rung at or below their own standing, and any
 * rung with nobody on it. The Owner's own late task has nowhere higher to go,
 * so it stays on the Owner's list, marked late.
 */
export function escalationFor(state, task, { today = isoDate(), now = new Date() } = {}) {
  if (!isOverdue(task, now)) return null;
  const owners = ownersOf(state, task, { today, now });
  const top = Math.max(-1, ...owners.map(rankOf));
  const everyone = Object.values(peopleOf(state)).filter(active);
  const skipped = [];

  for (const step of OVERDUE_LADDER) {
    const own = owners.find((o) => o.role === step.rung);
    if (own) { skipped.push({ rung: step.rung, why: `${own.name} is the ${step.title}, and it is their own task.` }); continue; }
    if (step.rank <= top) { skipped.push({ rung: step.rung, why: `The ${step.title} is not above whoever it belongs to.` }); continue; }
    const to = everyone.filter((p) => p.role === step.rung && !owners.some((o) => o.id === p.id));
    if (!to.length) { skipped.push({ rung: step.rung, why: `Nobody is the ${step.title}.` }); continue; }
    return {
      rung: step.rung,
      title: step.title,
      to,
      skipped,
      why: `Late, so it moves to the ${step.title}`
        + (skipped.length ? ` (${skipped.map((s) => s.why).join(' ')})` : '') + '.',
    };
  }
  return {
    rung: null, title: null, to: owners.filter((o) => o.role === 'ceo'), skipped, top: true,
    why: 'Nobody sits above the Owner, so it stays on the Owner\'s own list.',
  };
}

/**
 * May this person hand out zones today? — FR-ROLE-06.
 *
 * The Farm Manager and the Owner, always. The Field Supervisor when covering,
 * which means the Farm Manager is not in today — declared off or not clocked
 * in once the morning is out — or the farm has no Farm Manager at all.
 */
export function mayAssignZones(state, user, { today = isoDate(), now = new Date() } = {}) {
  if (!user) return { ok: false, why: 'Sign in first.' };
  if (user.role === 'manager' || user.role === 'ceo') return { ok: true, how: 'manager' };
  if (user.role !== 'supervisor') {
    return { ok: false, why: 'Zones are assigned by the Farm Manager, or the Field Supervisor when covering.' };
  }
  const managers = Object.values(peopleOf(state)).filter((p) => active(p) && p.role === 'manager');
  const inToday = managers.filter((m) => !isAbsent(state, m.id, { today, now }).absent);
  if (!inToday.length) {
    return {
      ok: true,
      how: 'covering',
      coveringFor: managers.map((m) => m.id),
      why: managers.length
        ? `Covering for ${managers.map((m) => m.name).join(' and ')}, who ${managers.length === 1 ? 'is' : 'are'} not in today.`
        : 'Covering: the farm has no Farm Manager.',
    };
  }
  return {
    ok: false,
    why: `${inToday.map((m) => m.name).join(' and ')} ${inToday.length === 1 ? 'is' : 'are'} in today. `
      + 'The Field Supervisor assigns zones only when covering for the Farm Manager.',
  };
}

/** The checks one assignment has to pass, shared by the screen and the event log. */
export function checkAssignment(state, payload, user, opts = {}) {
  const who = mayAssignZones(state, user, opts);
  if (!who.ok) return who;
  const p = payload || {};
  const person = peopleOf(state)[p.personId];
  if (!active(person)) return { ok: false, why: 'Choose somebody on the staff list.' };
  const zone = ((state && state.plots) || {})[p.zoneId];
  if (!zone || zone.retired) return { ok: false, why: 'Choose a zone that is in use.' };
  if (!HOLDINGS.includes(p.holding)) return { ok: false, why: 'Say whether it is their primary or backup zone.' };
  return { ok: true, how: who.how, person, zone };
}

/** Today's tasks, generated or on the log, without doubles. */
function dayTasks(state, date) {
  const logged = Object.values((state && state.tasks) || {})
    .filter((t) => t.status !== 'cancelled' && dayOf(t) === date);
  const ids = new Set(logged.map((t) => t.id));
  let planned = [];
  try { planned = tasksFor(state, { date }); } catch { planned = []; }
  return [...logged, ...planned.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, status: 'open', planned: true }))];
}

const byDue = (a, b) => ((a.due || '') < (b.due || '') ? -1 : (a.due || '') > (b.due || '') ? 1 : 0);

/**
 * My work — FR-ROLE-05, FR-ROLE-08 and FR-ROLE-09.
 *
 * The same list for everybody: the day's tasks for the zones this person holds
 * (or covers), anything written for them by name, and — for whoever sits on
 * the rung it climbed to — late work that has moved up to them. The last is
 * how FR-TASK-03 reaches a list rather than a report.
 */
export function myWork(state, personId, { date = isoDate(), now = new Date(), today = date } = {}) {
  const opts = { today, now };
  const mine = [];
  for (const task of Object.values((state && state.tasks) || {})) {
    if (task.status === 'cancelled') continue;
    const day = dayOf(task);
    // Tasks written by hand before times were a thing carry a day, not an
    // hour, and stay on the list until somebody does them.
    const legacyOpen = !task.due && task.status === 'open' && (!task.dueDate || task.dueDate <= date);
    if (day !== date && !legacyOpen) continue;
    const who = doersFor(state, task, opts);
    if (!who.people.some((p) => p.id === personId)) continue;
    mine.push({ task, covering: !!who.covering, why: who.covering ? who.why : null });
  }
  mine.sort((a, b) => byDue(a.task, b.task));

  const me = peopleOf(state)[personId];
  const moved = [];
  const unheld = [];
  for (const task of Object.values((state && state.tasks) || {})) {
    if (!isOverdue(task, now) || (dayOf(task) || '') > date) continue;
    const up = escalationFor(state, task, opts);
    if (up && up.to.some((p) => p.id === personId) && !mine.some((m) => m.task.id === task.id)) {
      moved.push({ task, escalation: up });
    }
  }
  // A zone nobody holds is a gap, and a gap is the first rung's to fill.
  if (me && me.role === firstRung(state)) {
    for (const task of Object.values((state && state.tasks) || {})) {
      if (task.status !== 'open' || dayOf(task) !== date) continue;
      const who = doersFor(state, task, opts);
      if (who.unheld || who.unassigned) unheld.push({ task, why: who.why });
    }
  }
  const done = mine.filter((m) => m.task.status === 'done').length;
  return {
    zones: zonesHeldBy(state, personId),
    tasks: mine,
    moved: moved.sort((a, b) => byDue(a.task, b.task)),
    unheld: unheld.sort((a, b) => byDue(a.task, b.task)),
    progress: {
      total: mine.length,
      done,
      fraction: mine.length ? done / mine.length : 0,
      text: mine.length ? `${done} of ${mine.length} done` : 'Nothing scheduled today',
    },
  };
}

/** The lowest rung of the ladder that somebody actually stands on. */
function firstRung(state) {
  const roles = new Set(Object.values(peopleOf(state)).filter(active).map((p) => p.role));
  const step = OVERDUE_LADDER.find((s) => roles.has(s.rung));
  return step ? step.rung : null;
}

/**
 * The farm — FR-ROLE-08.
 *
 * Everything My work shows, for the whole farm at once: each zone with its
 * holders and its day, the gaps, and every late task with where it went.
 */
export function farmWork(state, { date = isoDate(), now = new Date(), today = date } = {}) {
  const opts = { today, now };
  const zones = Object.values((state && state.plots) || {})
    .filter((z) => !z.retired)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((zone) => {
      const tasks = Object.values((state && state.tasks) || {})
        .filter((t) => zoneOf(state, t) === zone.id && t.status !== 'cancelled' && dayOf(t) === date)
        .sort(byDue);
      const doers = tasks.length ? doersFor(state, tasks[0], opts) : doersFor(state, { zoneId: zone.id, due: `${date}T12:00` }, opts);
      return {
        zone,
        holders: zoneHolders(state, zone.id),
        tasks,
        done: tasks.filter((t) => t.status === 'done').length,
        doing: doers.people,
        covering: !!doers.covering,
        gap: !!(doers.unheld || doers.unassigned),
        why: doers.why || null,
      };
    });
  const late = Object.values((state && state.tasks) || {})
    .filter((t) => isOverdue(t, now) && (dayOf(t) || '') <= date)
    .sort(byDue)
    .map((task) => ({ task, owners: ownersOf(state, task, opts), escalation: escalationFor(state, task, opts) }));
  return { date, zones, late };
}

/** Monday of the week a date falls in. */
export function weekStart(date = isoDate()) {
  const d = new Date(`${date}T12:00:00`);
  const back = (d.getDay() + 6) % 7;
  return isoDate(addDays(date, -back));
}

/**
 * How the week's work is spread across people — FR-ROLE-11.
 *
 * Seven days from Monday. Days already on the log use what is there (a done
 * task counts for whoever did it); days not generated yet use the schedule, so
 * Thursday's load is visible on Monday while it can still be moved. It reads
 * the roster — holdings and declared absence — not who clocked in. A task two
 * people hold is counted for both, because both are on the hook for it; the
 * total line counts each task once.
 */
export function weekSpread(state, { start = weekStart(), now = new Date(), today = isoDate(now) } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  const rows = new Map();
  const people = peopleOf(state);
  const rowFor = (person) => {
    if (!rows.has(person.id)) {
      rows.set(person.id, {
        person, zones: zonesHeldBy(state, person.id),
        perDay: days.map(() => ({ total: 0, done: 0, late: 0 })), total: 0, done: 0, late: 0,
      });
    }
    return rows.get(person.id);
  };
  for (const p of Object.values(people)) {
    if (active(p) && zonesHeldBy(state, p.id).length) rowFor(p);
  }
  const gaps = days.map(() => 0);
  const totals = days.map(() => 0);

  days.forEach((date, i) => {
    for (const task of dayTasks(state, date)) {
      totals[i] += 1;
      let who;
      if (task.status === 'done' && task.doneBy && people[task.doneBy]) who = [people[task.doneBy]];
      else who = doersFor(state, task, { today, now, roster: true }).people;
      if (!who.length) { gaps[i] += 1; continue; }
      for (const person of who) {
        const row = rowFor(person);
        const cell = row.perDay[i];
        cell.total += 1; row.total += 1;
        if (task.status === 'done') { cell.done += 1; row.done += 1; }
        // A day the schedule planned but nobody ever put on the log was never
        // issued, so it is not anybody's late work.
        else if (!task.planned && isOverdue(task, now)) { cell.late += 1; row.late += 1; }
      }
    }
  });

  const list = [...rows.values()].sort((a, b) => b.total - a.total
    || String(a.person.name).localeCompare(String(b.person.name)));
  const loads = list.map((r) => r.total);
  const mean = loads.length ? loads.reduce((s, n) => s + n, 0) / loads.length : 0;
  for (const r of list) {
    r.share = totals.reduce((s, n) => s + n, 0) ? r.total / totals.reduce((s, n) => s + n, 0) : 0;
    r.heavy = list.length > 1 && mean > 0 && r.total > mean * 1.5;
  }
  return { start, days, rows: list, gaps, totals, gapTotal: gaps.reduce((s, n) => s + n, 0) };
}
