// End-of-shift reports — FR-TASK-05 and UX-09.
//
// "Each person submits a short written end-of-shift report, which the Farm
// Manager can read and comment on."
//
// This is NOT the problem report. A problem report (`state.reports`) is raised
// the moment something is wrong and stays open until somebody resolves it; it
// is an exception. A shift report is the ordinary end of an ordinary day, filed
// by everybody who worked, whether or not anything went wrong. Mixing the two
// costs both of them: the exceptions list fills with "watered as normal" until
// nobody reads it, and the day's account disappears the moment it is resolved.
//
// So they are separate records, separate lists, separate screens. The only
// thing they share is that both carry a written observation, because UX-09 asks
// for one in plain words: what did you see, what did you do.
//
// The Farm Manager's comment is part of the report rather than a reply
// somewhere else. A hand who writes "the drip line on bench three is still
// blocked" for the third evening running should be able to see that somebody
// read it.

import { isoDate } from '../util.js';

/**
 * UX-09 — "a short written observation".
 *
 * Short is the point: this is typed one-handed, standing up, at the end of a
 * day that started at six. But a report that says "ok" is a tick dressed as a
 * sentence, and a tick is what the app already has. So there is a floor, and
 * it is stated in words rather than characters because "fine." is six
 * characters and says nothing.
 */
export const MIN_OBSERVATION_WORDS = 4;

/** The two questions the observation answers, shown on the form. */
export const OBSERVATION_PROMPT = 'What did you see, and what did you do about it?';

export function judgeObservation(text) {
  const clean = String(text || '').trim();
  if (!clean) {
    return { ok: false, reason: 'missing', why: 'The report needs a line about your day.',
      fix: OBSERVATION_PROMPT };
  }
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < MIN_OBSERVATION_WORDS) {
    return {
      ok: false,
      reason: 'too-short',
      why: `"${clean}" is not something anybody can act on tomorrow.`,
      fix: OBSERVATION_PROMPT,
    };
  }
  return { ok: true, words: words.length };
}

/** One day's shift reports, newest first, with the person and their comments. */
export function shiftReports(state, { date = null, personId = null } = {}) {
  return [...(state.shifts || [])]
    .filter((s) => !date || s.date === date)
    .filter((s) => !personId || (s.personId || s.by) === personId)
    .map((s) => ({
      ...s,
      personId: s.personId || s.by,
      person: (state.people || {})[s.personId || s.by] || null,
      zone: s.zoneId ? (state.plots || {})[s.zoneId] || null : null,
      comments: s.comments || [],
      commented: !!(s.comments && s.comments.length),
    }))
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/** Has this person filed today's report yet? */
export function shiftFiled(state, personId, date = isoDate()) {
  return (state.shifts || []).some((s) => (s.personId || s.by) === personId && s.date === date);
}

/**
 * The Farm Manager's board — FR-TASK-05.
 *
 * Who filed, who has not, and which of the filed ones nobody has answered.
 * "Who has not" is read from attendance rather than from the staff list: a
 * person who was not in today does not owe a report, and asking them for one is
 * how the board turns into noise nobody clears.
 */
export function shiftBoard(state, { date = isoDate() } = {}) {
  const worked = new Set(
    (state.attendance || [])
      .filter((a) => (a.in || '').slice(0, 10) === date)
      .map((a) => a.personId),
  );
  // Anyone who filed counts as having worked, even if nobody clocked them in.
  const filed = shiftReports(state, { date });
  for (const s of filed) worked.add(s.personId);

  const filedBy = new Set(filed.map((s) => s.personId));
  const missing = [...worked]
    .filter((id) => !filedBy.has(id))
    .map((id) => (state.people || {})[id] || { id, name: id })
    .filter((p) => p.active !== false)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    date,
    reports: filed,
    missing,
    awaitingComment: filed.filter((s) => !s.commented),
    counts: { worked: worked.size, filed: filed.length, missing: missing.length },
  };
}

/**
 * A run of reports from one person, for the "is this the third evening running?"
 * question a manager actually has.
 */
export function shiftHistory(state, personId, { days = 14, today = isoDate() } = {}) {
  const from = new Date(`${today}T00:00:00`);
  from.setDate(from.getDate() - days);
  const since = isoDate(from);
  return shiftReports(state, { personId }).filter((s) => s.date >= since);
}
