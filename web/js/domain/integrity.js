// Judging the farm's own records.
//
// The CEO's question is not "what do the books say" but "can I believe them".
// On a farm the honest failure is far more common than the dishonest one: a hand
// writes Monday's crates up on Thursday from memory, a supervisor rounds
// everything to the nearest ten, a phone's clock is two hours out. Both kinds
// leave the same fingerprints, and the point of this file is to surface them
// without accusing anyone.
//
// Every check answers three questions in order, because a finding that cannot
// answer all three is just noise:
//
//   1. What specifically looks wrong, in numbers?
//   2. What is the innocent explanation?
//   3. What would settle it?
//
// Nothing here decides that a person is dishonest. It decides that a record
// deserves a question, and says which question.

import { addDays, daysBetween, isoDate, round, sum } from '../util.js';

export const SEVERITY = { high: 3, medium: 2, low: 1 };

/** When a record is timestamped, and how far that is from the work it claims. */
export function timing(record) {
  // `at` is the phone's clock when the record was made. `serverAt` is the farm
  // server's clock when it arrived, which is the one that cannot be argued with.
  const claimedFor = record.date || (record.at || '').slice(0, 10) || null;
  const recordedAt = record.at || null;
  const arrivedAt = record.serverAt || null;

  const recordedDay = recordedAt ? recordedAt.slice(0, 10) : null;
  const lagDays = claimedFor && recordedDay ? daysBetween(claimedFor, recordedDay) : null;

  // A phone whose clock disagrees with the server makes every time on it suspect.
  const skewMinutes = recordedAt && arrivedAt
    ? Math.round((new Date(arrivedAt) - new Date(recordedAt)) / 60000)
    : null;

  return {
    claimedFor,
    recordedAt,
    arrivedAt,
    lagDays,
    skewMinutes,
    backdated: lagDays != null && lagDays >= 1,
    futureDated: lagDays != null && lagDays <= -1,
  };
}

const person = (state, id) => state.people[id] || { id, name: id || 'someone' };

function finding(f) {
  return { severity: 'medium', ...f, weight: SEVERITY[f.severity || 'medium'] };
}

// --- The checks -----------------------------------------------------------

/** Work written up days later is remembered, not measured. */
function checkLateEntry(state, opts) {
  const out = [];
  const limit = opts.lateAfterDays;
  for (const h of state.harvests) {
    const t = timing(h);
    if (t.lagDays == null || t.lagDays < limit) continue;
    out.push(finding({
      id: `late_${h.id}`,
      kind: 'late-entry',
      severity: t.lagDays >= limit * 2 ? 'high' : 'medium',
      who: h.by,
      when: t.recordedAt,
      cycleId: h.cycleId,
      title: `${person(state, h.by).name} recorded a picking ${t.lagDays} days after the day it claims`,
      detail: `${round(h.kg, 1)} kg written down for ${t.claimedFor}, but not entered until ${(t.recordedAt || '').slice(0, 10)}.`,
      innocent: 'The phone had no signal, or the book was written up at the end of the week.',
      settle: 'Ask what the crates actually weighed that day, and whether anyone else saw the pick.',
      evidence: { lagDays: t.lagDays, kg: h.kg, date: t.claimedFor },
    }));
  }
  return out;
}

/** A record dated after the day it was written is either a typo or a guess. */
function checkFutureDated(state) {
  const out = [];
  for (const h of state.harvests) {
    const t = timing(h);
    if (!t.futureDated) continue;
    out.push(finding({
      id: `future_${h.id}`,
      kind: 'future-dated',
      severity: 'high',
      who: h.by,
      when: t.recordedAt,
      cycleId: h.cycleId,
      title: `A picking is dated ${Math.abs(t.lagDays)} days in the future`,
      detail: `${round(h.kg, 1)} kg dated ${t.claimedFor}, entered on ${(t.recordedAt || '').slice(0, 10)}.`,
      innocent: 'The date was mistyped, or the phone\'s own clock is wrong.',
      settle: 'Check the date on that phone against a known clock, then correct the record.',
      evidence: { lagDays: t.lagDays, kg: h.kg },
    }));
  }
  return out;
}

/** A phone whose clock is adrift makes every time it reports unreliable. */
function checkClockSkew(state, opts) {
  const byDevice = new Map();
  for (const entry of state.log) {
    if (!entry.at || !entry.serverAt) continue;
    const skew = Math.round((new Date(entry.serverAt) - new Date(entry.at)) / 60000);
    const key = entry.device || 'unknown device';
    const seen = byDevice.get(key) || [];
    seen.push(skew);
    byDevice.set(key, seen);
  }
  const out = [];
  for (const [device, skews] of byDevice) {
    if (skews.length < 3) continue;
    const sorted = [...skews].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Sync delay always makes serverAt later than at. Only a phone running
    // *ahead* of the server, or hours behind, means the clock itself is wrong.
    if (median > -opts.clockSkewMinutes && median < opts.clockSkewMinutes) continue;
    out.push(finding({
      id: `skew_${device}`,
      kind: 'clock-skew',
      severity: 'medium',
      who: null,
      when: null,
      title: `One phone's clock is about ${Math.abs(median)} minutes ${median < 0 ? 'ahead of' : 'behind'} the farm's`,
      detail: `Across ${skews.length} records from ${device}, times differ from the server by ${median} minutes.`,
      innocent: 'The phone\'s date and time are set by hand rather than by the network.',
      settle: 'On that phone, switch date and time to automatic. Times recorded on it until then are approximate.',
      evidence: { device, medianSkewMinutes: median, records: skews.length },
    }));
  }
  return out;
}

/**
 * A whole day's book entered in one burst, covering several different days, is
 * somebody catching up from memory rather than recording as they went.
 */
function checkBulkBackfill(state, opts) {
  const bySession = new Map();
  for (const h of state.harvests) {
    const t = timing(h);
    if (!t.recordedAt || t.lagDays == null || t.lagDays < 1) continue;
    const key = `${h.by}|${t.recordedAt.slice(0, 13)}`;    // same person, same hour
    const rows = bySession.get(key) || [];
    rows.push({ h, t });
    bySession.set(key, rows);
  }
  const out = [];
  for (const [key, rows] of bySession) {
    const days = new Set(rows.map((r) => r.t.claimedFor));
    if (rows.length < opts.bulkCount || days.size < opts.bulkDays) continue;
    const [by, hour] = key.split('|');
    out.push(finding({
      id: `bulk_${key}`,
      kind: 'bulk-backfill',
      severity: 'medium',
      who: by,
      when: `${hour}:00:00.000Z`,
      title: `${person(state, by).name} entered ${rows.length} pickings across ${days.size} different days in one sitting`,
      detail: `All entered within the same hour on ${hour.slice(0, 10)}, covering ${[...days].sort().join(', ')}.`,
      innocent: 'A week with no signal, or a paper book being typed up.',
      settle: 'Compare the total against what the store or the buyer actually received that week.',
      evidence: { records: rows.length, days: [...days].sort(), totalKg: round(sum(rows, (r) => r.h.kg), 1) },
    }));
  }
  return out;
}

/** Weights that are always round were estimated, not weighed. */
function checkRoundNumbers(state, opts) {
  const byPerson = new Map();
  for (const h of state.harvests) {
    const rows = byPerson.get(h.by) || [];
    rows.push(h);
    byPerson.set(h.by, rows);
  }
  const out = [];
  for (const [by, rows] of byPerson) {
    if (rows.length < opts.minSample) continue;
    const round10 = rows.filter((h) => Number(h.kg) > 0 && Number(h.kg) % 10 === 0).length;
    const share = round10 / rows.length;
    if (share < opts.roundShare) continue;
    out.push(finding({
      id: `round_${by}`,
      kind: 'estimated-weights',
      severity: 'low',
      who: by,
      when: null,
      title: `${person(state, by).name}'s weights are almost always round numbers`,
      detail: `${round10} of ${rows.length} pickings land exactly on a multiple of 10 kg.`,
      innocent: 'They are counting crates and multiplying, which is what the app does when no weight is typed.',
      settle: 'Put a scale at the shed and ask for the weighed figure. Crate counts drift as crates get older.',
      evidence: { roundRecords: round10, total: rows.length, share: round(share * 100, 0) },
    }));
  }
  return out;
}

/** The same bed, the same day, the same weight, twice. */
function checkDuplicates(state) {
  const seen = new Map();
  const out = [];
  for (const h of state.harvests) {
    const key = `${h.cycleId}|${h.date}|${round(h.kg, 1)}`;
    if (seen.has(key)) {
      const first = seen.get(key);
      out.push(finding({
        id: `dup_${h.id}`,
        kind: 'possible-duplicate',
        severity: 'medium',
        who: h.by,
        when: h.at,
        cycleId: h.cycleId,
        title: `The same picking may have been recorded twice`,
        detail: `${round(h.kg, 1)} kg on ${h.date} appears twice for this bed, by `
          + `${person(state, first.by).name} and ${person(state, h.by).name}.`,
        innocent: 'Two people picked the same bed and each recorded their own crates.',
        settle: 'Check whether the day\'s total matches what reached the store.',
        evidence: { kg: h.kg, date: h.date, firstBy: first.by, secondBy: h.by },
      }));
    } else {
      seen.set(key, h);
    }
  }
  return out;
}

/** A picking far outside what that bed normally gives. */
function checkOutliers(state, opts) {
  const byCycle = new Map();
  for (const h of state.harvests) {
    const rows = byCycle.get(h.cycleId) || [];
    rows.push(h);
    byCycle.set(h.cycleId, rows);
  }
  const out = [];
  for (const [cycleId, rows] of byCycle) {
    if (rows.length < opts.minSample) continue;
    const weights = rows.map((h) => Number(h.kg) || 0).sort((a, b) => a - b);
    const median = weights[Math.floor(weights.length / 2)];
    if (median <= 0) continue;
    for (const h of rows) {
      const ratio = (Number(h.kg) || 0) / median;
      if (ratio < opts.outlierHigh && ratio > opts.outlierLow) continue;
      out.push(finding({
        id: `outlier_${h.id}`,
        kind: 'unusual-weight',
        severity: ratio >= opts.outlierHigh ? 'medium' : 'low',
        who: h.by,
        when: h.at,
        cycleId,
        title: `A picking ${ratio >= 1 ? round(ratio, 1) + ' times' : round(1 / ratio, 1) + ' times below'} this bed's usual`,
        detail: `${round(h.kg, 1)} kg on ${h.date}, where this bed usually gives about ${round(median, 1)} kg.`,
        innocent: ratio >= 1
          ? 'A first big flush, or two people picking together and one recording the lot.'
          : 'A short pick at the end of the day, or rain stopping work.',
        settle: 'Check it against the crates that reached the store that day.',
        evidence: { kg: h.kg, medianKg: round(median, 1), ratio: round(ratio, 2) },
      }));
    }
  }
  return out;
}

/** Work recorded on a day that person never clocked in. */
function checkUnattended(state) {
  const shifts = new Map();
  for (const a of state.attendance) {
    const day = (a.in || '').slice(0, 10);
    if (!day) continue;
    shifts.set(`${a.personId}|${day}`, true);
  }
  const anyAttendance = shifts.size > 0;
  if (!anyAttendance) return [];                      // a farm not using clock-in

  const out = [];
  for (const h of state.harvests) {
    if (!h.date || !h.by) continue;
    if (shifts.has(`${h.by}|${h.date}`)) continue;
    // Only worth raising for people who do clock in at other times.
    const everClocked = [...shifts.keys()].some((k) => k.startsWith(`${h.by}|`));
    if (!everClocked) continue;
    out.push(finding({
      id: `noshift_${h.id}`,
      kind: 'no-matching-shift',
      severity: 'medium',
      who: h.by,
      when: h.at,
      cycleId: h.cycleId,
      title: `${person(state, h.by).name} recorded a picking for a day they never clocked in`,
      detail: `${round(h.kg, 1)} kg on ${h.date}, with no shift recorded for them that day.`,
      innocent: 'They forgot to clock in, or came in briefly on a day off.',
      settle: 'Ask whether they worked that day, and fix the attendance either way.',
      evidence: { date: h.date, kg: h.kg },
    }));
  }
  return out;
}

/** More sold than was ever picked: the one that costs real money. */
function checkSalesReconcile(state, opts) {
  const out = [];
  const byCrop = new Map();
  for (const h of state.harvests) {
    const cycle = state.cycles[h.cycleId];
    const crop = cycle ? cycle.cropId : 'unknown';
    const row = byCrop.get(crop) || { picked: 0, sold: 0 };
    row.picked += Number(h.kg) || 0;
    byCrop.set(crop, row);
  }
  for (const s of state.sales) {
    const crop = s.cropId || 'unknown';
    const row = byCrop.get(crop) || { picked: 0, sold: 0 };
    row.sold += Number(s.kg) || 0;
    byCrop.set(crop, row);
  }
  for (const [crop, row] of byCrop) {
    if (row.sold <= 0) continue;
    const over = row.sold - row.picked;
    if (over <= row.picked * opts.saleTolerance) continue;
    out.push(finding({
      id: `sold_over_${crop}`,
      kind: 'sold-more-than-picked',
      severity: 'high',
      who: null,
      when: null,
      title: `More ${crop} has been sold than was ever recorded as picked`,
      detail: `${round(row.sold, 1)} kg sold against ${round(row.picked, 1)} kg picked, a gap of ${round(over, 1)} kg.`,
      innocent: 'Pickings went unrecorded, or a sale covered stock carried over from an earlier cycle.',
      settle: 'This is the one worth chasing first. Either crates are leaving unrecorded, or the picking book is incomplete.',
      evidence: { crop, soldKg: round(row.sold, 1), pickedKg: round(row.picked, 1), gapKg: round(over, 1) },
    }));
  }
  return out;
}

/** A bed in full picking that nobody has touched for a week. */
function checkSilentBeds(state, opts, today) {
  const out = [];
  for (const cycle of Object.values(state.cycles)) {
    if (cycle.status !== 'active') continue;
    const dat = daysBetween(cycle.transplantDate, today);
    if (dat < 70) continue;                            // not in picking yet
    const picks = state.harvests.filter((h) => h.cycleId === cycle.id);
    const last = picks.length
      ? picks.map((h) => h.date).sort().slice(-1)[0]
      : null;
    const quiet = last ? daysBetween(last, today) : dat;
    if (quiet < opts.silentBedDays) continue;
    out.push(finding({
      id: `silent_${cycle.id}`,
      kind: 'silent-bed',
      severity: quiet >= opts.silentBedDays * 2 ? 'high' : 'medium',
      who: null,
      when: null,
      cycleId: cycle.id,
      title: `A bed in picking has had nothing recorded for ${quiet} days`,
      detail: last
        ? `Last picking recorded ${last}. A bed at this stage should be picked every week or so.`
        : 'No picking has ever been recorded against this bed, though it is past first harvest.',
      innocent: 'The bed failed, or picking is happening and nobody is writing it down.',
      settle: 'Walk it. Either the crop is gone, which is worth knowing, or produce is leaving unrecorded.',
      evidence: { quietDays: quiet, lastPick: last },
    }));
  }
  return out;
}

/** Photos that were not taken when they were attached. */
function checkStalePhotos(state) {
  const out = [];
  const withPhotos = [
    ...state.reports.map((r) => ({ record: r, what: 'problem report' })),
    ...state.harvests.map((h) => ({ record: h, what: 'picking' })),
    ...state.scouts.map((s) => ({ record: s, what: 'scouting' })),
    ...state.sprays.map((s) => ({ record: s, what: 'spray' })),
  ];
  for (const { record, what } of withPhotos) {
    const photo = record.photo;
    if (!photo || typeof photo === 'string') continue;
    if (photo.fresh !== false) continue;
    if ((photo.ageMinutes || 0) < 120) continue;
    out.push(finding({
      id: `photo_${record.id}`,
      kind: 'old-photo',
      severity: 'low',
      who: record.by,
      when: record.at,
      cycleId: record.cycleId,
      title: `A ${what} is backed by a photo taken well before it was attached`,
      detail: `The picture was taken about ${Math.round((photo.ageMinutes || 0) / 60)} hours before it was added to the record.`,
      innocent: 'They photographed it at the bed and attached it once back in signal.',
      settle: 'Fine on its own. Worth noticing if the same person does it every time.',
      evidence: { ageMinutes: photo.ageMinutes },
    }));
  }
  return out;
}

export const DEFAULT_RULES = {
  lateAfterDays: 2,
  clockSkewMinutes: 45,
  bulkCount: 4,
  bulkDays: 3,
  minSample: 5,
  roundShare: 0.9,
  outlierHigh: 3,
  outlierLow: 0.25,
  saleTolerance: 0.05,
  silentBedDays: 10,
};

/**
 * Run every check. Returns findings worst-first, plus a per-person summary,
 * because the same question asked of one record is noise and asked of thirty is
 * a pattern.
 */
/**
 * Collapse a run of the same question about the same person into one.
 *
 * Thirty separate cards saying "this was written up late" is not thirty times
 * more useful than one; it is a screen nobody reads. The pattern is the finding,
 * so the summary leads with the count and keeps the worst few as examples.
 */
export function groupFindings(findings, threshold = 3) {
  const buckets = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.who || '-'}`;
    const rows = buckets.get(key) || [];
    rows.push(f);
    buckets.set(key, rows);
  }

  const out = [];
  for (const rows of buckets.values()) {
    if (rows.length < threshold) { out.push(...rows); continue; }
    const worst = rows.reduce((a, b) => (b.weight > a.weight ? b : a));
    const examples = [...rows].sort((a, b) => b.weight - a.weight).slice(0, 3);
    out.push({
      ...worst,
      id: `group_${worst.kind}_${worst.who || 'farm'}`,
      grouped: rows.length,
      title: `${rows.length} records raise the same question: ${lowerFirst(worst.title)}`,
      detail: `${rows.length} records in all. For example: `
        + examples.map((e) => e.detail).join(' '),
      examples,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || (b.grouped || 1) - (a.grouped || 1));
}

const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);

export function audit(state, { today = isoDate(), rules = {}, group = true } = {}) {
  const opts = { ...DEFAULT_RULES, ...rules };
  const raw = [
    ...checkSalesReconcile(state, opts),
    ...checkSilentBeds(state, opts, today),
    ...checkFutureDated(state),
    ...checkLateEntry(state, opts),
    ...checkBulkBackfill(state, opts),
    ...checkDuplicates(state),
    ...checkUnattended(state),
    ...checkOutliers(state, opts),
    ...checkClockSkew(state, opts),
    ...checkRoundNumbers(state, opts),
    ...checkStalePhotos(state),
  ].sort((a, b) => b.weight - a.weight);

  const findings = group ? groupFindings(raw) : raw;

  return {
    findings,
    rawCount: raw.length,
    counts: {
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    },
    people: peopleSummary(state, raw, opts),
    records: recordQuality(state, opts),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * How each person's record-keeping looks.
 *
 * Deliberately framed as record-keeping, not honesty. Someone with no signal in
 * the back field will always look worse than someone at the office, and a score
 * that pretended otherwise would get people into trouble unfairly.
 */
export function peopleSummary(state, findings, opts = DEFAULT_RULES) {
  const rows = [];
  for (const p of Object.values(state.people)) {
    if (p.active === false) continue;
    const records = [
      ...state.harvests.filter((h) => h.by === p.id),
      ...state.workLogs.filter((w) => w.by === p.id || w.personId === p.id),
      ...state.scouts.filter((s) => s.by === p.id),
    ];
    if (!records.length) continue;

    const harvests = state.harvests.filter((h) => h.by === p.id);
    const lags = harvests.map((h) => timing(h).lagDays).filter((n) => n != null);
    const sameDay = lags.filter((n) => n <= 0).length;
    const withPhoto = harvests.filter((h) => h.photo).length;
    const theirFindings = findings.filter((f) => f.who === p.id);

    const promptness = lags.length ? sameDay / lags.length : null;
    const evidence = harvests.length ? withPhoto / harvests.length : null;

    rows.push({
      person: p,
      records: records.length,
      harvests: harvests.length,
      medianLagDays: lags.length ? lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)] : null,
      sameDayShare: promptness == null ? null : round(promptness * 100, 0),
      photoShare: evidence == null ? null : round(evidence * 100, 0),
      questions: theirFindings.length,
      highQuestions: theirFindings.filter((f) => f.severity === 'high').length,
      grade: gradeFor(promptness, theirFindings),
    });
  }
  return rows.sort((a, b) => b.questions - a.questions || b.records - a.records);
}

function gradeFor(promptness, theirFindings) {
  const high = theirFindings.filter((f) => f.severity === 'high').length;
  if (high) return { id: 'check', label: 'Needs checking', tone: 'danger' };
  if (theirFindings.length >= 3) return { id: 'watch', label: 'Worth a word', tone: 'warn' };
  if (promptness != null && promptness >= 0.8) return { id: 'good', label: 'Records as they go', tone: 'ok' };
  if (promptness != null && promptness < 0.5) return { id: 'late', label: 'Often writes up late', tone: 'warn' };
  return { id: 'ok', label: 'No questions', tone: 'ok' };
}

/** What share of the farm's records carry the marks of being recorded on the spot. */
export function recordQuality(state, opts = DEFAULT_RULES) {
  const harvests = state.harvests;
  if (!harvests.length) {
    return { total: 0, sameDay: null, withPhoto: null, verified: null, score: null };
  }
  const lags = harvests.map((h) => timing(h).lagDays);
  const sameDay = lags.filter((n) => n != null && n <= 0).length;
  const withPhoto = harvests.filter((h) => h.photo).length;
  const verified = harvests.filter((h) => h.verified).length;

  // A blunt headline number, weighted towards the thing that matters most:
  // whether the record was made at the time or remembered later.
  const score = Math.round(
    (0.55 * (sameDay / harvests.length)
      + 0.25 * (withPhoto / harvests.length)
      + 0.20 * (verified / harvests.length)) * 100,
  );

  return {
    total: harvests.length,
    sameDay: round((sameDay / harvests.length) * 100, 0),
    withPhoto: round((withPhoto / harvests.length) * 100, 0),
    verified: round((verified / harvests.length) * 100, 0),
    score,
    band: score >= 75 ? { label: 'Records look solid', tone: 'ok' }
      : score >= 45 ? { label: 'Usable, with gaps', tone: 'warn' }
        : { label: 'Thin evidence', tone: 'danger' },
  };
}
