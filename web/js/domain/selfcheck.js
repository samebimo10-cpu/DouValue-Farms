// Checking your own work — requirements §4.2, FR-ROLE-12 to FR-ROLE-15.
//
// On a farm this size the Field Supervisor who scouts a house is often the
// only qualified person there to confirm what he found. Refusing that would
// stop work, so it is allowed — but only when nobody else qualified is in, and
// the record says so: **self-confirmed** (FR-ROLE-12).
//
// A treatment from a self-confirmed diagnosis then waits for the next level
// up (FR-ROLE-13): the Field Supervisor's for the Farm Manager, the Farm
// Manager's for the Owner, and the Owner may stand in for a Farm Manager who
// is not in. The Owner's own self-confirmation has nobody above it, so it is
// recorded, not escalated.
//
// One exception, and it is computed, never chosen: where the treatment closes
// an open alert whose deadline falls before the next spray window, waiting for
// the approval would miss the deadline. The treatment goes ahead, is marked
// **treated before approval**, and the Owner hears at once. The approval is
// still owed; Gate 3 stays yellow until it lands and goes red after 48 hours.
//
// What does not change: Gate 0 and Gate 4 still clear on the Farm Manager's
// confirmation and the Owner's approval of the Farm Doctor's check (FR-ROLE-14,
// FR-GATE-00), and nothing in this file can clear them. The Farm Doctor still
// never confirms or approves anything (FR-DOC-08).
//
// Everything here is a pure function of recorded facts, so the screens, the
// record rebuild in store.js and the tests all get the same answer. The farm
// server holds its own copy of the parts it can judge from the log
// (server/core.mjs); tests/self-confirm.test.mjs keeps the two in step.

import { peekRules } from '../rules.js';
import { alerts } from './alerts.js';

/** The Farm Doctor's account id. It is not a person and confirms nothing (FR-DOC-08). */
export const FARM_DOCTOR_ID = 'farm-doctor';

/** Who may confirm a diagnosis at all: the Field Supervisor, the Farm Manager, the Owner (FR-DIAG-03). */
export const CONFIRMING_ROLES = new Set(['supervisor', 'manager', 'ceo']);

/** How long an approval may trail a treatment that went before it, before Gate 3 turns red. */
export const APPROVAL_WITHIN_HOURS = 48;

/** The farm keeps West Africa Time all year: UTC+1, no daylight saving. */
export const FARM_UTC_OFFSET_HOURS = 1;

/** A Farm Manager not clocked in by this farm hour counts as away (positions.js uses the same 9). */
export const NO_SHOW_HOUR = 9;

const TITLE = { supervisor: 'Field Supervisor', manager: 'Farm Manager', ceo: 'Owner' };
export const roleTitle = (role) => TITLE[role] || 'Farm Manager';

const HOUR = 3600000;
const people = (state) => (state && state.people) || {};
const active = (p) => !!p && p.active !== false;

/**
 * Who approves a treatment from a diagnosis this role confirmed on itself —
 * FR-ROLE-13. The Field Supervisor's (and anyone else below the Farm Manager)
 * goes to the Farm Manager, the Farm Manager's to the Owner, and the Owner's to
 * nobody (null): it is recorded. A role the record does not know goes to the
 * Owner, the safe end of the ladder.
 */
export function approverFor(role) {
  if (role === 'ceo') return null;
  if (role === 'manager') return 'ceo';
  if (role === 'supervisor' || role === 'hand') return 'manager';
  return 'ceo';
}

// --- FR-ROLE-12: is anybody else here to confirm it? -------------------------

/**
 * Is this person on the farm at `at`? Clocked in that day, not yet clocked
 * out, and not marked absent. Somebody who never clocks in — usually the
 * Owner — is not here to do a confirm test, however senior.
 */
export function onFarmAt(state, personId, at) {
  const day = String(at).slice(0, 10);
  const off = ((state && state.absences) || [])
    .some((a) => a.personId === personId && a.date === day && !a.cancelled);
  if (off) return false;
  return ((state && state.attendance) || []).some((a) => a.personId === personId
    && String(a.in || '').slice(0, 10) === day && a.in <= at && (!a.out || a.out > at));
}

/** The other qualified people on the farm at `at` — anyone who could confirm instead. */
export function otherConfirmers(state, diagnosis, at) {
  const raiser = diagnosis && diagnosis.by;
  return Object.values(people(state))
    .filter((p) => active(p) && CONFIRMING_ROLES.has(p.role) && p.id !== raiser && p.id !== FARM_DOCTOR_ID)
    .filter((p) => onFarmAt(state, p.id, at));
}

// --- FR-ROLE-13: who approves ----------------------------------------------

/** The farm's hour of the day (0-23) at an instant. */
export const farmHour = (at) => new Date(Date.parse(at) + FARM_UTC_OFFSET_HOURS * HOUR).getUTCHours();

/**
 * Is the Farm Manager away at `at`? Judged the way FR-ROLE-06 judges cover:
 * marked absent that day, or not clocked in once the morning is out (9 AM farm
 * time) — or the farm has no Farm Manager at all. The farm server judges it
 * the same way from the same records (server/core.mjs managerAwayFrom).
 */
export function managerAway(state, at) {
  const day = String(at).slice(0, 10);
  const managers = Object.values(people(state)).filter((p) => active(p) && p.role === 'manager');
  if (!managers.length) return { away: true, why: 'The farm has no Farm Manager.' };
  const isIn = (m) => {
    const off = ((state && state.absences) || []).some((a) => a.personId === m.id && a.date === day && !a.cancelled);
    if (off) return false;
    const clocked = ((state && state.attendance) || [])
      .some((a) => a.personId === m.id && String(a.in || '').slice(0, 10) === day && a.in <= at);
    return clocked || farmHour(at) < NO_SHOW_HOUR;
  };
  const inToday = managers.filter(isIn);
  if (inToday.length) {
    return { away: false, why: `${inToday.map((m) => m.name || m.id).join(' and ')} ${inToday.length === 1 ? 'is' : 'are'} in today.` };
  }
  return { away: true, why: `${managers.map((m) => m.name || m.id).join(' and ')} ${managers.length === 1 ? 'is' : 'are'} not in today.` };
}

/** Self-confirmed, with somebody above it, and that somebody has not approved yet. */
export function awaitingApproval(d) {
  return !!(d && d.confirmedBy && d.selfConfirmed && d.approvalFrom && !d.approvedBy);
}

/**
 * May a treatment rest on this diagnosis without the exception? Confirmed by a
 * second person; or self-confirmed and approved; or the Owner's own.
 */
export function treatable(d) {
  return !!(d && d.confirmedBy && d.confirmedBy !== FARM_DOCTOR_ID && !awaitingApproval(d));
}

/**
 * FR-ROLE-13 — may this person approve a self-confirmed diagnosis at `at`?
 *
 * `approver` is { id, role }. A Field Supervisor's goes to a Farm Manager, or
 * to the Owner when the Farm Manager is away. A Farm Manager's goes to the
 * Owner. Never to the person who confirmed it, and never to the Farm Doctor.
 */
export function canApprove(state, d, approver, { at = new Date().toISOString() } = {}) {
  if (!d) return { ok: false, reason: 'missing', why: 'There is no such diagnosis.' };
  if (!d.confirmedBy) return { ok: false, reason: 'unconfirmed', why: 'Nobody has confirmed this diagnosis yet.' };
  if (!d.selfConfirmed) {
    return { ok: false, reason: 'not-needed', why: 'A second person confirmed this one, so it needs no approval.' };
  }
  if (!d.approvalFrom) {
    return { ok: false, reason: 'not-needed',
      why: 'The Owner confirmed this one. It is recorded as self-confirmed; there is nobody above to approve it.' };
  }
  if (d.approvedBy) return { ok: false, reason: 'done', why: 'This one is already approved.' };
  if (!approver || approver.id === FARM_DOCTOR_ID) {
    return { ok: false, reason: 'doctor', why: 'The Farm Doctor does not approve anything (FR-DOC-08).' };
  }
  if (approver.id === d.confirmedBy || approver.id === d.by) {
    return { ok: false, reason: 'self', why: `You confirmed this yourself, so the ${roleTitle(d.approvalFrom)} approves it.` };
  }
  if (d.approvalFrom === 'ceo') {
    return approver.role === 'ceo'
      ? { ok: true, how: 'owner' }
      : { ok: false, reason: 'rank', why: 'The Farm Manager confirmed this one on their own finding, so the Owner approves it.' };
  }
  if (approver.role === 'manager') return { ok: true, how: 'manager' };
  if (approver.role === 'ceo') {
    const away = managerAway(state, at);
    return away.away
      ? { ok: true, how: 'covering', why: `Approving for the Farm Manager: ${away.why}` }
      : { ok: false, reason: 'manager-in',
        why: `The Farm Manager approves this one. ${away.why} The Owner approves it only when the Farm Manager is away.` };
  }
  return { ok: false, reason: 'rank', why: 'A self-confirmed diagnosis from the field is approved by the Farm Manager.' };
}

// --- FR-ROLE-13: the exception, from the alert deadline and the window -------

/**
 * The spray window, read from SR-01 ("Spray window 4-7 PM ..."). Returns farm
 * hours { open: 16, close: 19 }, or null if the rules no longer say.
 */
export function sprayWindow(rules = peekRules()) {
  const sr = ((rules && rules.spray_rules) || []).find((r) => r.id === 'SR-01');
  const m = sr && /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*PM/i.exec(sr.rule || '');
  if (!m) return null;
  const open = (Number(m[1]) % 12) + 12;
  const close = (Number(m[2]) % 12) + 12;
  return close > open ? { open, close } : null;
}

/** Midnight farm time, as an instant, for the farm day an instant falls in. */
function farmMidnight(ms) {
  const shifted = ms + FARM_UTC_OFFSET_HOURS * HOUR;
  return shifted - (((shifted % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)) - FARM_UTC_OFFSET_HOURS * HOUR;
}

/** The first spray window to OPEN strictly after `at` — "the next spray window". */
export function nextWindowOpens(at, win = sprayWindow()) {
  const t = Date.parse(at);
  const day = farmMidnight(t);
  const today = day + win.open * HOUR;
  return new Date(today > t ? today : today + 24 * HOUR).toISOString();
}

/**
 * C-3 (rules → alert_deadlines): treat at the next spray window, never later
 * than 24 hours. A breach logged before 7 PM is due at the close of that day's
 * window; one logged after 7 PM at the close of the next day's. Capped by the
 * alert's own 24-hour deadline (FR-SCOUT-03).
 */
export function alertDeadline(alert, win = sprayWindow()) {
  const t = Date.parse(alert.at);
  const day = farmMidnight(t);
  const close = day + win.close * HOUR;
  const windowClose = close > t ? close : close + 24 * HOUR;
  const own = alert.dueAt ? Date.parse(alert.dueAt) : t + 24 * HOUR;
  return new Date(Math.min(windowClose, own)).toISOString();
}

/**
 * FR-ROLE-13 exception — may a treatment from this self-confirmed, unapproved
 * diagnosis go ahead at `at`?
 *
 * Only if it closes an open alert on the same zone, for the pest the diagnosis
 * names, whose deadline falls before the next spray window opens. Nothing a
 * person says decides it: the alert, its deadline and the window times do.
 */
export function beforeApprovalCheck(state, d, { cycleId = d && d.cycleId, at = new Date().toISOString(), rules = peekRules() } = {}) {
  const win = sprayWindow(rules);
  if (!win) return { ok: false, reason: 'no-window', why: 'The rules do not give a spray window (SR-01), so nothing can go before approval.' };
  if (!awaitingApproval(d)) return { ok: false, reason: 'not-waiting', why: 'This diagnosis is not waiting on an approval.' };
  const open = alerts(state, { now: at }).filter((a) => a.status === 'open' && a.cycleId === cycleId
    && a.at <= at && (!d.problemId || a.pestId === d.problemId));
  const next = nextWindowOpens(at, win);
  const judged = open.map((a) => ({ alert: a, deadline: alertDeadline(a, win) }))
    .sort((x, y) => (x.deadline < y.deadline ? -1 : 1));
  const hit = judged.find((j) => j.deadline < next);
  const who = roleTitle(d.approvalFrom);
  if (hit) {
    return {
      ok: true, alert: hit.alert, alertId: hit.alert.id, deadline: hit.deadline, nextWindow: next,
      why: `The ${hit.alert.pestName} alert on ${hit.alert.zoneName} is due ${hit.deadline.slice(0, 16).replace('T', ' ')} UTC, `
        + `before the next spray window opens (${next.slice(0, 16).replace('T', ' ')} UTC). It goes ahead marked `
        + `treated before approval; the Owner is told now and the ${who} still approves it.`,
    };
  }
  return {
    ok: false,
    reason: open.length ? 'deadline-after-window' : 'no-alert',
    nextWindow: next,
    why: open.length
      ? `The open alert is due ${judged[0].deadline.slice(0, 16).replace('T', ' ')} UTC, after the next spray window opens, `
        + `so there is time for the ${who} to approve it first.`
      : 'No open alert for this pest on this zone is waiting on it.',
  };
}

/**
 * Where a treatment from a self-confirmed diagnosis stands — the Gate 3 colour
 * for one spray. `pass` once approved (or never needed one), `held` (yellow)
 * while treated before approval and inside 48 hours, `fail` (red) after 48
 * hours without it, or when it went on without approval and without the
 * exception.
 */
export function approvalStanding(spray, d, { now = new Date().toISOString() } = {}) {
  if (!d || !d.selfConfirmed || !d.approvalFrom) return { state: 'pass' };
  const who = roleTitle(d.approvalFrom);
  if (d.approvedAt && d.approvedAt <= spray.at) return { state: 'pass', why: `Approved by the ${who} before the spray.` };
  if (!spray.beforeApproval) {
    return { state: 'fail', why: `Sprayed on a self-confirmed diagnosis before the ${who} approved it, and not to meet an alert deadline.` };
  }
  const hours = (Date.parse(d.approvedAt || now) - Date.parse(spray.at)) / HOUR;
  if (d.approvedAt) {
    return { state: 'pass', why: `Treated before approval; the ${who} approved it ${Math.round(hours)} h later`
      + (hours > APPROVAL_WITHIN_HOURS ? `, past the ${APPROVAL_WITHIN_HOURS} h limit.` : '.') };
  }
  if (hours >= APPROVAL_WITHIN_HOURS) {
    return { state: 'fail', why: `Treated before approval ${Math.round(hours)} h ago, and the ${who} has still not approved it.` };
  }
  return { state: 'held', why: `Treated before approval ${Math.round(hours)} h ago; waiting on the ${who} (red after ${APPROVAL_WITHIN_HOURS} h).` };
}

/** FR-ROLE-15 — self-confirmed diagnoses in the last `days` days, for the Owner's digest. */
export function selfConfirmedSince(state, { now = new Date().toISOString(), days = 7 } = {}) {
  const from = new Date(Date.parse(now) - days * 24 * HOUR).toISOString();
  return ((state && state.diagnoses) || [])
    .filter((d) => d.selfConfirmed && d.confirmedAt && d.confirmedAt >= from && d.confirmedAt <= now);
}

/** What is waiting on this person to approve — for their screen, and the dashboard. */
export function approvalsFor(state, user, { at = new Date().toISOString() } = {}) {
  if (!user) return [];
  return ((state && state.diagnoses) || [])
    .filter(awaitingApproval)
    .filter((d) => canApprove(state, d, user, { at }).ok);
}
