// Positions, not people — section 4 of the requirements.
//
// "Roles are positions, not people. A person can be moved between positions
// without changing the app." That sentence is the whole design.
//
// A task belongs to the Greenhouse Hand for GH-02, not to Emeka. Emeka holds
// that position today. When he is off, the work does not vanish and it does not
// sit in a list nobody reads: it goes to whoever holds the backup for that
// zone, automatically, because FR-ROLE-02 says so and because on a real farm
// the alternative is that nobody checks GH-02 on Thursday.
//
// The awkward case this file exists to handle is the one that actually happens:
// somebody is absent and nobody told the app. So absence is inferred from
// attendance as well as declared, and the fallback runs either way.

import { isoDate } from '../util.js';

/**
 * The positions a farm of this shape needs — section 4.
 *
 * Created once when the farm is set up, then held by whoever is doing that job.
 * The titles match the requirements exactly so the laminated role cards, the
 * training material and the app all use the same words (UX-06).
 */
export const POSITION_TEMPLATE = [
  { id: 'pos_owner', title: 'Owner', role: 'ceo', zones: 0 },
  { id: 'pos_manager', title: 'Farm Manager', role: 'manager', zones: 0 },
  { id: 'pos_2ic', title: 'Field Supervisor (2IC)', role: 'supervisor', zones: 0 },
  { id: 'pos_gh1', title: 'Greenhouse Hand — GH-01', role: 'hand', zones: 1 },
  { id: 'pos_gh2', title: 'Greenhouse Hand — GH-02', role: 'hand', zones: 1 },
  { id: 'pos_gh3', title: 'Greenhouse Hand — GH-03', role: 'hand', zones: 1 },
  { id: 'pos_gh4', title: 'Greenhouse Hand — GH-04', role: 'hand', zones: 1 },
];

/** Everyone currently holding a position, keyed by position id. */
export function holders(state) {
  const out = {};
  for (const pos of Object.values(state.positions || {})) {
    if (pos.retired) continue;
    out[pos.id] = pos.holderId ? (state.people || {})[pos.holderId] || null : null;
  }
  return out;
}

/**
 * Is this person absent today?
 *
 * Two ways to be absent, and the second is the one that matters. Declared
 * absence is somebody saying so. Inferred absence is nobody clocking in by the
 * time the work is due — which is what actually happens when a phone is flat or
 * a person is ill at six in the morning and tells a cousin rather than an app.
 *
 * `by` is the hour after which a no-show counts. Before that it is simply
 * early, and reassigning work at 05:30 because nobody has clocked in yet would
 * make the whole mechanism untrustworthy.
 */
export function isAbsent(state, personId, { today = isoDate(), now = new Date(), by = 9 } = {}) {
  if (!personId) return true;

  const declared = (state.absences || [])
    .some((a) => a.personId === personId && a.date === today && !a.cancelled);
  if (declared) return { absent: true, reason: 'declared' };

  const clockedIn = (state.attendance || [])
    .some((a) => a.personId === personId && (a.in || '').slice(0, 10) === today);
  if (clockedIn) return { absent: false };

  const hour = now.getHours();
  if (hour < by) return { absent: false, reason: 'too-early-to-tell' };
  return { absent: true, reason: 'no-show' };
}

/**
 * Who should actually do this task today — FR-ROLE-02.
 *
 * The position's holder, unless they are absent, in which case whoever holds a
 * position whose backup zone is this one. Returns the reason as well as the
 * person, because a hand who finds someone else's zone on their list deserves
 * to be told why rather than left to guess.
 */
export function resolveOwner(state, positionId, { today = isoDate(), now = new Date() } = {}) {
  const position = (state.positions || {})[positionId];
  if (!position) return { person: null, position: null, why: 'No such position.' };

  const holder = position.holderId ? (state.people || {})[position.holderId] : null;
  if (holder && holder.active !== false) {
    const absence = isAbsent(state, holder.id, { today, now });
    if (!absence.absent) return { person: holder, position, covering: false };

    const cover = coverFor(state, position, { today, now });
    if (cover) {
      return {
        person: cover.person,
        position,
        covering: true,
        instead: holder,
        // Written in the third person: this line shows on the manager's cover
        // board as often as on the covering hand's own list.
        why: `${holder.name} is ${absence.reason === 'declared' ? 'marked absent' : 'not clocked in'}`
          + `, so ${position.primaryZoneId ? 'the zone' : 'this work'} passes to `
          + `${cover.person.name} today.`,
      };
    }
    return {
      person: null,
      position,
      covering: false,
      unassigned: true,
      why: `${holder.name} is not in and nobody holds the backup for this zone.`,
    };
  }

  // Nobody holds the position at all. That is a management problem, and saying
  // so beats silently dropping the work.
  const cover = coverFor(state, position, { today, now });
  if (cover) {
    return {
      person: cover.person, position, covering: true,
      why: `Nobody holds this position, so ${cover.person.name} covers it as the backup.`,
    };
  }
  return { person: null, position, unassigned: true, why: 'Nobody holds this position.' };
}

/** Whoever has this position's zone as their backup zone, and is actually in. */
function coverFor(state, position, { today, now }) {
  if (!position.primaryZoneId) return null;
  for (const other of Object.values(state.positions || {})) {
    if (other.id === position.id || other.retired) continue;
    if (other.backupZoneId !== position.primaryZoneId) continue;
    const person = other.holderId ? (state.people || {})[other.holderId] : null;
    if (!person || person.active === false) continue;
    if (isAbsent(state, person.id, { today, now }).absent) continue;
    return { person, position: other };
  }
  return null;
}

/**
 * The cover plan, for the Farm Manager's screen.
 *
 * Every position, who holds it, whether they are in, and who is picking it up
 * if they are not. This is the screen that answers "is GH-04 being checked
 * today?" without anyone having to ask three people.
 */
export function coverBoard(state, { today = isoDate(), now = new Date() } = {}) {
  return Object.values(state.positions || {})
    .filter((p) => !p.retired)
    .map((position) => {
      const resolved = resolveOwner(state, position.id, { today, now });
      const holder = position.holderId ? (state.people || {})[position.holderId] : null;
      return {
        position,
        holder,
        zone: position.primaryZoneId ? (state.plots || {})[position.primaryZoneId] : null,
        backupZone: position.backupZoneId ? (state.plots || {})[position.backupZoneId] : null,
        doing: resolved.person,
        covering: !!resolved.covering,
        unassigned: !!resolved.unassigned,
        why: resolved.why || null,
      };
    })
    .sort((a, b) => Number(b.unassigned) - Number(a.unassigned)
      || Number(b.covering) - Number(a.covering));
}

/**
 * Gaps a Farm Manager needs to close — positions with nobody doing them today.
 * Feeds the digest, because an unchecked house is exactly the kind of thing the
 * Owner could not see from anywhere else.
 */
export function uncoveredToday(state, opts = {}) {
  return coverBoard(state, opts).filter((row) => row.unassigned);
}
