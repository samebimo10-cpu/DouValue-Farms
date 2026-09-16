// State. Events in, farm out.
//
// reduce() is a pure function of the event log, exported on its own so it can be
// tested without a browser. createStore() wraps it with persistence and change
// notification.

import { appendEvents, deviceId, loadEvents } from './db.js';
import { isoDate, sortBy, sum, uid } from './util.js';

/**
 * Who can do what.
 *
 * `rank` is the authority order, and it decides account creation as well as
 * visibility: you may only create an account below your own rank, so a manager
 * can take on hands and supervisors but cannot appoint another manager or
 * remove the owner. Only the CEO holds `manageOwners`, which lifts that ceiling.
 */
export const ROLES = {
  hand: {
    id: 'hand', name: 'Farm hand', pidgin: 'Farm hand', rank: 10,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose'],
    home: '#/today',
    blurb: 'Sees today\'s jobs, records work and harvest, reports anything wrong.',
  },
  supervisor: {
    id: 'supervisor', name: 'Supervisor', pidgin: 'Oga for field', rank: 50,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout'],
    home: '#/field',
    blurb: 'Assigns the day\'s work, checks the harvest, records sprays and inputs.',
  },
  agronomist: {
    id: 'agronomist', name: 'Agronomist', pidgin: 'Crop doctor', rank: 60,
    can: ['viewOwnTasks', 'viewGuide', 'diagnose', 'scout', 'logSpray', 'prescribe', 'manageCycles',
      'viewTeam', 'viewReports', 'assignTasks'],
    home: '#/clinic',
    blurb: 'Diagnoses problems, writes the spray plan, watches the risk board.',
  },
  manager: {
    id: 'manager', name: 'Farm manager', pidgin: 'Oga', rank: 80,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings'],
    home: '#/dashboard',
    blurb: 'Runs the farm day to day: work, money, people, planning and reports.',
  },
  ceo: {
    id: 'ceo', name: 'CEO', pidgin: 'Chairman', rank: 100,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings',
      'manageOwners', 'manageSync', 'viewAudit', 'wipeFarm'],
    home: '#/dashboard',
    blurb: 'Owns the farm. Sees everything, appoints the manager and everyone else, '
      + 'and controls the link that keeps every phone in step.',
  },
};

/** Roles from the top down, for pickers and tables. */
export const ROLE_LIST = Object.values(ROLES).sort((a, b) => b.rank - a.rank);

export function roleRank(person) {
  if (!person) return -1;
  const role = ROLES[person.role || person];
  return role ? role.rank : -1;
}

export function can(person, permission) {
  if (!person) return false;
  const role = ROLES[person.role];
  return !!role && role.can.includes(permission);
}

/**
 * Which roles this person may hand out.
 *
 * The CEO may appoint anyone, including a second owner. Everyone else with
 * people authority may only appoint below themselves, which is what stops a
 * manager quietly promoting themselves or creating a rival manager.
 */
export function assignableRoles(actor) {
  if (!can(actor, 'managePeople')) return [];
  if (can(actor, 'manageOwners')) return ROLE_LIST.map((r) => r.id);
  const mine = roleRank(actor);
  return ROLE_LIST.filter((r) => r.rank < mine).map((r) => r.id);
}

/** Whether this person may create or change an account holding that role. */
export function canAssignRole(actor, targetRole) {
  return assignableRoles(actor).includes(targetRole);
}

/**
 * Whether this person may edit that account.
 *
 * Anyone may edit their own details. Otherwise the target's current role must be
 * one you could have assigned in the first place, so a manager cannot edit the
 * CEO or another manager.
 */
export function canEditPerson(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return true;
  if (!can(actor, 'managePeople')) return false;
  return canAssignRole(actor, target.role);
}

/**
 * The farm must never be left without an owner: removing the last CEO would
 * lock everyone out of sync setup and account creation for good.
 */
export function canRemovePerson(actor, target, state) {
  if (!canEditPerson(actor, target)) return { ok: false, why: 'You cannot change that account.' };
  if (actor.id === target.id) return { ok: false, why: 'You cannot remove your own account.' };
  if (target.role === 'ceo') {
    const owners = Object.values(state.people)
      .filter((p) => p.role === 'ceo' && p.active !== false);
    if (owners.length <= 1) {
      return { ok: false, why: 'This is the only CEO account. Appoint another owner first, '
        + 'otherwise nobody can create accounts or manage the sync link.' };
    }
  }
  return { ok: true };
}

export const DEFAULT_SETTINGS = {
  farmName: 'DouValue Farms Limited',
  location: 'Port Harcourt, Rivers State',
  currency: 'NGN',
  language: 'en',
  crateKg: 12,           // what one crate of pepper weighs on this farm
  basketKg: 25,
  prices: { bell: 1400, chili: 1800, habanero: 2600 },
  seasonality: null,      // null means use the built-in index
  gradeOutPct: 12,
  kgPerPersonHour: 12,
  defaultDailyWage: 3500,
  overtimeRatePerHour: 700,
  soilPh: 5.2,
};

const EMPTY = () => ({
  settings: { ...DEFAULT_SETTINGS },
  people: {},
  plots: {},
  cycles: {},
  tasks: {},
  inputs: {},
  harvests: [],
  sales: [],
  sprays: [],
  scouts: [],
  diagnoses: [],
  soilTests: [],
  topsoilBatches: {},
  gateOverrides: [],
  expenses: [],
  stockMoves: [],
  attendance: [],
  workLogs: [],
  weather: [],
  reports: [],
  log: [],
  orphans: [],
});

/**
 * Rebuild the whole farm from its event log. Pure: same events, same state.
 *
 * Events are replayed in timestamp order, but timestamps cannot be trusted to
 * put things in causal order. Phones on this farm are offline for days, their
 * clocks drift, and a supervisor may type up Monday's paper notes on Thursday.
 * So an event that changes something which does not exist yet is parked rather
 * than dropped, and replayed the moment its subject turns up. Without that, a
 * task completed at 07:00 against a task created at 09:00 would silently vanish,
 * and the worker who did the job would be told to do it again.
 */
export function reduce(events) {
  const state = EMPTY();
  const ordered = sortBy(events.filter(Boolean), (e) => e.at || '');

  // Events waiting for the thing they refer to, keyed by "kind:id".
  const parked = new Map();

  /** What an event creates, if anything. */
  const creates = (type, p) => {
    switch (type) {
      case 'cycle.start': return `cycle:${p.id}`;
      case 'task.create': return `task:${p.id}`;
      case 'harvest.record': return `harvest:${p.id}`;
      case 'diagnosis.confirm': {
        const d = state.diagnoses.find((x) => x.id === p.id);
        if (d) { d.confirmedBy = e.by; d.confirmedAt = e.at; d.confirmNote = p.note || ''; }
        break;
      }

      case 'report.record': return `report:${p.id}`;
      case 'input.upsert': return `input:${p.id}`;
      case 'diagnosis.record': return `diagnosis:${p.id}`;
      case 'topsoil.receive': return `topsoil:${p.id}`;
      case 'gate.override': return `override:${p.id}`;
      case 'person.upsert': return `person:${p.id}`;
      case 'attendance.in': return `attendance:${p.personId}`;
      default: return null;
    }
  };

  /** What an event needs to already exist, if anything. */
  const requires = (type, p) => {
    switch (type) {
      case 'cycle.update': case 'cycle.close': return `cycle:${p.id}`;
      case 'task.update': case 'task.complete': case 'task.cancel': return `task:${p.id}`;
      case 'harvest.verify': return `harvest:${p.id}`;
      case 'report.resolve': return `report:${p.id}`;
      case 'input.receive': case 'input.issue': return `input:${p.itemId}`;
      case 'person.deactivate': return `person:${p.id}`;
      case 'attendance.out': return `attendance:${p.personId}`;
      case 'diagnosis.confirm': return `diagnosis:${p.id}`;
      case 'topsoil.assign': return `topsoil:${p.batchId}`;
      case 'gate.override.revoke': return `override:${p.id}`;
      default: return null;
    }
  };

  const exists = (key) => {
    if (!key) return true;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    switch (kind) {
      case 'cycle': return !!state.cycles[id];
      case 'task': return !!state.tasks[id];
      case 'input': return !!state.inputs[id];
      case 'person': return !!state.people[id];
      case 'harvest': return state.harvests.some((h) => h.id === id);
      case 'diagnosis': return state.diagnoses.some((d) => d.id === id);
      case 'topsoil': return !!state.topsoilBatches[id];
      case 'override': return state.gateOverrides.some((o) => o.id === id);
      case 'report': return state.reports.some((r) => r.id === id);
      case 'attendance': return state.attendance.some((a) => a.personId === id && !a.out);
      default: return true;
    }
  };

  function apply(e) {
    const p = e.payload || {};
    switch (e.type) {
      case 'settings.update':
        state.settings = { ...state.settings, ...p };
        break;

      case 'person.upsert':
        state.people[p.id] = { ...(state.people[p.id] || {}), ...p, active: p.active !== false };
        break;
      case 'person.deactivate':
        if (state.people[p.id]) state.people[p.id].active = false;
        break;

      // --- Gates (requirements 6.2) ------------------------------------
      // Soil tests, topsoil batches and overrides are what the gates read.
      // They are plain appends: a test is a fact about a day, and a later test
      // does not erase an earlier one, it supersedes it.
      case 'soiltest.record':
        state.soilTests.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'topsoil.receive':
        state.topsoilBatches[p.id] = { ...p, by: e.by, at: e.at };
        break;
      case 'topsoil.assign':
        if (state.plots[p.zoneId]) state.plots[p.zoneId].topsoilBatchId = p.batchId;
        break;
      case 'gate.override':
        state.gateOverrides.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'gate.override.revoke': {
        const o = state.gateOverrides.find((x) => x.id === p.id);
        if (o) { o.revoked = true; o.revokedBy = e.by; o.revokedAt = e.at; }
        break;
      }

      case 'plot.upsert':
        state.plots[p.id] = { ...(state.plots[p.id] || {}), ...p };
        break;
      case 'plot.remove':
        delete state.plots[p.id];
        break;

      case 'cycle.start':
        state.cycles[p.id] = { ...p, status: 'active', events: {}, startedBy: e.by, startedAt: e.at };
        break;
      case 'cycle.update':
        state.cycles[p.id] = { ...state.cycles[p.id], ...p };
        break;
      case 'cycle.close':
        state.cycles[p.id].status = 'closed';
        state.cycles[p.id].closedAt = p.date || isoDate(new Date(e.at));
        state.cycles[p.id].closeNote = p.note || '';
        break;

      case 'task.create':
        state.tasks[p.id] = { ...p, status: 'open', createdBy: e.by, createdAt: e.at };
        break;
      case 'task.update':
        state.tasks[p.id] = { ...state.tasks[p.id], ...p };
        break;
      case 'task.complete':
        state.tasks[p.id].status = 'done';
        state.tasks[p.id].doneBy = e.by;
        state.tasks[p.id].doneAt = e.at;
        state.tasks[p.id].doneNote = p.note || '';
        break;
      case 'task.cancel':
        state.tasks[p.id].status = 'cancelled';
        state.tasks[p.id].cancelReason = p.reason || '';
        break;

      case 'attendance.in':
        state.attendance.push({ ...p, id: p.id || e.id, personId: p.personId || e.by, in: e.at, out: null });
        break;
      case 'attendance.out': {
        const open = [...state.attendance].reverse()
          .find((a) => a.personId === (p.personId || e.by) && !a.out);
        if (open) { open.out = e.at; open.hours = p.hours ?? hoursBetween(open.in, e.at); }
        break;
      }

      case 'work.log':
        state.workLogs.push({ ...p, id: p.id || e.id, personId: p.personId || e.by, at: e.at });
        break;

      case 'harvest.record':
        state.harvests.push({ ...p, id: p.id || e.id, by: e.by, at: e.at, verified: false });
        break;
      case 'harvest.verify': {
        const h = state.harvests.find((x) => x.id === p.id);
        if (h) { h.verified = true; h.verifiedBy = e.by; h.kg = p.kg ?? h.kg; }
        break;
      }

      case 'sale.record':
        state.sales.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'spray.record':
        state.sprays.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'scout.record':
        state.scouts.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;
      case 'diagnosis.record':
        state.diagnoses.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      case 'diagnosis.confirm': {
        const d = state.diagnoses.find((x) => x.id === p.id);
        if (d) { d.confirmedBy = e.by; d.confirmedAt = e.at; d.confirmNote = p.note || ''; }
        break;
      }

      case 'report.record':
        state.reports.push({ ...p, id: p.id || e.id, by: e.by, at: e.at, status: 'open' });
        break;
      case 'report.resolve': {
        const r = state.reports.find((x) => x.id === p.id);
        if (r) { r.status = 'resolved'; r.resolution = p.note || ''; r.resolvedBy = e.by; r.resolvedAt = e.at; }
        break;
      }

      case 'expense.record':
        state.expenses.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      case 'input.upsert':
        state.inputs[p.id] = { ...(state.inputs[p.id] || { qty: 0 }), ...p };
        break;
      case 'input.receive':
        state.inputs[p.itemId].qty = (Number(state.inputs[p.itemId].qty) || 0) + Number(p.qty || 0);
        state.stockMoves.push({ ...p, id: p.id || e.id, direction: 'in', by: e.by, at: e.at });
        break;
      case 'input.issue':
        state.inputs[p.itemId].qty = (Number(state.inputs[p.itemId].qty) || 0) - Number(p.qty || 0);
        state.stockMoves.push({ ...p, id: p.id || e.id, direction: 'out', by: e.by, at: e.at });
        break;

      case 'weather.record':
        state.weather.push({ ...p, id: p.id || e.id, by: e.by, at: e.at });
        break;

      default:
        break; // an event from a newer version of the app: kept in the log, ignored here
    }
  }

  /** Apply anything that was waiting on this key, and anything that then unblocks. */
  function drain(key) {
    const queue = parked.get(key);
    if (!queue) return;
    parked.delete(key);
    for (const e of queue) {
      apply(e);
      const made = creates(e.type, e.payload || {});
      if (made) drain(made);
    }
  }

  for (const e of ordered) {
    const p = e.payload || {};
    state.log.push({ id: e.id, type: e.type, at: e.at, by: e.by, device: e.device });

    const needs = requires(e.type, p);
    if (needs && !exists(needs)) {
      if (!parked.has(needs)) parked.set(needs, []);
      parked.get(needs).push(e);
      continue;
    }

    apply(e);
    const made = creates(e.type, p);
    if (made) drain(made);
  }

  // Anything still waiting refers to something this log has never seen: most
  // likely half of a merge that has not arrived from another phone yet.
  state.orphans = [...parked.values()].flat()
    .map((e) => ({ id: e.id, type: e.type, waitingFor: requires(e.type, e.payload || {}) }));

  // Roll harvest totals onto their cycles so forecasting can correct itself.
  for (const h of state.harvests) {
    const c = state.cycles[h.cycleId];
    if (c) c.harvestedKg = (c.harvestedKg || 0) + (Number(h.kg) || 0);
  }
  for (const c of Object.values(state.cycles)) {
    if (c.status === 'closed') c.actualKg = c.harvestedKg || 0;
  }

  return state;
}

function hoursBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return ms > 0 ? Math.round((ms / 3600000) * 10) / 10 : 0;
}

/** The live store: loads the log, applies new events, tells the UI to redraw. */
export async function createStore() {
  const events = await loadEvents();
  const device = await deviceId();
  let state = reduce(events);
  const listeners = new Set();
  let currentUser = null;

  function notify() { for (const fn of listeners) fn(state); }

  return {
    get state() { return state; },
    get device() { return device; },
    get user() { return currentUser; },
    setUser(person) { currentUser = person; notify(); },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Record something. Returns the event so callers can reference its id. */
    async dispatch(type, payload = {}) {
      const event = {
        id: uid('ev'),
        type,
        at: new Date().toISOString(),
        by: currentUser ? currentUser.id : 'system',
        device,
        payload,
      };
      await appendEvents([event]);
      events.push(event);
      state = reduce(events);
      notify();
      return event;
    },

    /**
     * Several events at once, one redraw. An entry may carry its own `by` and
     * `at` so historical records (a seeded sample, or a paper book being typed
     * up after the fact) land under the right name and date.
     */
    async dispatchMany(list) {
      const batch = list.map(({ type, payload, by, at }) => ({
        id: uid('ev'), type, at: at || new Date().toISOString(),
        by: by || (currentUser ? currentUser.id : 'system'), device, payload: payload || {},
      }));
      await appendEvents(batch);
      events.push(...batch);
      state = reduce(events);
      notify();
      return batch;
    },

    async reload() {
      const fresh = await loadEvents();
      events.length = 0;
      events.push(...fresh);
      state = reduce(events);
      notify();
    },

    get events() { return events; },
  };
}

// ---------------------------------------------------------------------------
// Selectors: plain reads over state, no side effects.
// ---------------------------------------------------------------------------

export function activeCycles(state) {
  return Object.values(state.cycles).filter((c) => c.status === 'active');
}

export function closedCycles(state) {
  return Object.values(state.cycles).filter((c) => c.status === 'closed');
}

export function cycleLabel(state, cycleId) {
  const c = state.cycles[cycleId];
  if (!c) return 'Unknown bed';
  const plot = state.plots[c.plotId];
  return `${plot ? plot.name : 'Bed'} — ${c.variety || c.cropId}`;
}

export function spraysForCycle(state, cycleId) {
  return state.sprays.filter((s) => s.cycleId === cycleId);
}

export function openTasks(state, personId = null, onDate = null) {
  const day = onDate || isoDate();
  return Object.values(state.tasks).filter((t) => {
    if (t.status !== 'open') return false;
    if (personId && t.assignedTo && t.assignedTo !== personId) return false;
    if (t.dueDate && t.dueDate > day) return false;
    return true;
  }).sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
}

export function openReports(state) {
  return state.reports.filter((r) => r.status === 'open');
}

export function harvestsBetween(state, from, to) {
  return state.harvests.filter((h) => h.date >= from && h.date <= to);
}

export function todayAttendance(state, day = isoDate()) {
  return state.attendance.filter((a) => (a.in || '').slice(0, 10) === day);
}

export function isClockedIn(state, personId) {
  return state.attendance.some((a) => a.personId === personId && !a.out);
}

/** Wages owed over a period, from attendance and the person's rate. */
export function payrollBetween(state, from, to) {
  const rows = [];
  for (const person of Object.values(state.people)) {
    if (person.active === false) continue;
    const shifts = state.attendance.filter((a) => a.personId === person.id
      && (a.in || '').slice(0, 10) >= from && (a.in || '').slice(0, 10) <= to && a.out);
    const hours = sum(shifts, (s) => s.hours || 0);
    const days = new Set(shifts.map((s) => (s.in || '').slice(0, 10))).size;
    const rate = Number(person.dailyRate) || state.settings.defaultDailyWage;
    rows.push({ person, days, hours: Math.round(hours * 10) / 10, rate, pay: days * rate });
  }
  return rows.filter((r) => r.days > 0).sort((a, b) => b.pay - a.pay);
}

export function inputsList(state) {
  return Object.values(state.inputs).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function inputUsage(state) {
  return state.stockMoves.filter((m) => m.direction === 'out')
    .map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0, date: (m.date || m.at || '').slice(0, 10) }));
}

export function costsBetween(state, from, to) {
  const direct = state.expenses.filter((x) => x.date >= from && x.date <= to)
    .map((x) => ({ date: x.date, amount: Number(x.amount) || 0, category: x.category || 'other', note: x.note }));
  const labour = payrollBetween(state, from, to)
    .map((r) => ({ date: to, amount: r.pay, category: 'labour', note: `${r.person.name}, ${r.days} days` }));
  return [...direct, ...labour];
}

export function revenueBetween(state, from, to) {
  return sum(state.sales.filter((s) => s.date >= from && s.date <= to), (s) => Number(s.amount) || 0);
}
