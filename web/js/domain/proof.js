// Proof of work — requirements 6.4.
//
// Root cause three again, from the other end. The Owner could not see whether
// the work was happening, and "marked done" is not evidence of anything: it is
// evidence that somebody tapped a button, which is exactly as easy to do from
// the shade as from inside the house.
//
// So for the tasks where it matters — scouting and trap checks, the ones that
// catch a pest while it is still cheap — done requires a picture taken now, in
// the app, of the thing being checked.
//
// The line this file draws is between a photo and PROOF. The app has taken
// photos since the first version; what was missing was the refusal.

/**
 * The kinds of task that cannot be closed on somebody's word. FR-PROOF-01.
 *
 * `nursery_trap` is the nursery's daily trap check (FR-FARM-04) — a trap check
 * like any other, and the schedule already marks it as needing a photo.
 */
export const PROOF_REQUIRED = new Set(['scout', 'trap', 'nursery_trap', 'sanitation']);
const TRAP_KINDS = new Set(['trap', 'nursery_trap']);

/**
 * FR-PROOF-04 — a picture small enough to send from a field.
 *
 * 200 KB is the requirement. The compressor already aims well under it, so
 * this is the backstop for a phone whose camera produces something unusual —
 * and it is a real limit, because a farm hand on a metered connection who
 * cannot sync is a farm hand who stops recording.
 */
export const MAX_PHOTO_BYTES = 200 * 1024;

/**
 * Is this photo proof, or just a picture?
 *
 * Three things have to hold, and the requirement names all three. It has to
 * exist. It has to have been taken now rather than pulled out of the gallery
 * (FR-PROOF-02). And it has to be small enough to actually arrive
 * (FR-PROOF-04).
 *
 * `fresh` is null when the file carried no timestamp at all. That is treated as
 * acceptable rather than as a failure: some Android cameras hand over a file
 * with no lastModified, and refusing those would block honest work on the
 * cheapest handsets, which is the opposite of what this is for. The record
 * still carries the absence, and the audit screen shows it.
 */
export function judgePhoto(photo) {
  if (!photo || !photo.dataUrl) {
    return { ok: false, reason: 'missing', why: 'No photo attached.' };
  }
  if (photo.fresh === false) {
    return {
      ok: false,
      reason: 'stale',
      why: `That picture is ${photo.ageMinutes} minutes old, so it came out of the gallery.`,
      fix: 'Take a new one at the bed. A photo from earlier proves the bed was fine earlier.',
    };
  }
  if (photo.bytes && photo.bytes > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      reason: 'too-big',
      why: `That picture is ${Math.round(photo.bytes / 1024)} KB, over the ${
        Math.round(MAX_PHOTO_BYTES / 1024)} KB limit.`,
      fix: 'Take it again. A closer shot of the trap is smaller and more useful than a wide one.',
    };
  }
  return { ok: true, unverifiedTime: photo.fresh == null };
}

/**
 * May this task be marked done? — FR-PROOF-01.
 *
 * Only the proof kinds are gated. Gating everything would mean a photo of a
 * watering can every morning, and a rule people resent is a rule they work
 * around.
 */
export function canComplete(task, photo) {
  if (!task) return { ok: false, why: 'That task is not on record.' };
  if (!PROOF_REQUIRED.has(task.kind)) return { ok: true };

  const verdict = judgePhoto(photo);
  if (verdict.ok) return { ok: true, unverifiedTime: verdict.unverifiedTime };

  return {
    ok: false,
    reason: verdict.reason,
    why: verdict.reason === 'missing'
      ? `A ${TRAP_KINDS.has(task.kind) ? 'trap check' : task.kind} is not done until there is a picture of it.`
      : verdict.why,
    fix: verdict.fix
      || 'Open the camera in the app and photograph the trap or the plants you checked.',
  };
}

/**
 * The stamp that goes on the record beside the picture — FR-PROOF-02.
 *
 * Date, time, zone and person. Built here rather than at each call site so
 * every proof photo carries the same four facts in the same shape, and the
 * audit screen can rely on it.
 */
export function stampFor(photo, { zoneName, personName, taskKind, at = new Date().toISOString() }) {
  return {
    takenAt: photo && photo.takenAt ? photo.takenAt : at,
    attachedAt: at,
    zone: zoneName || null,
    person: personName || null,
    kind: taskKind || null,
    // Kept so the audit screen can say "the time on this one could not be
    // checked" rather than quietly implying it was verified.
    timeVerified: photo ? photo.fresh !== null : false,
  };
}

/** FR-PROOF-02 — how long after the shutter a photo still counts as taken now. */
export const FRESH_PHOTO_MINUTES = 5;

/**
 * May this completion close this task? — FR-PROOF-01, FR-PROOF-02, FR-PROOF-03.
 *
 * The whole proof rule in one place, for the record as it travels: the photo
 * is there, small enough, taken now rather than pulled from the gallery — by
 * the phone's own flag and by its own two timestamps, which have to agree —
 * and stamped with date, time, zone and person; and a zone scanned at the
 * start is the task's zone. The phone builds a completion that passes it, and
 * the farm server refuses one that does not, so a phone that skipped the
 * screen cannot close a scouting round or a trap check on its word.
 */
export function proofCheck(task, payload = {}) {
  if (!task || !PROOF_REQUIRED.has(task.kind)) return { ok: true };
  const photo = (payload && payload.photo) || null;
  const verdict = canComplete(task, photo);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, why: verdict.why, fix: verdict.fix, rule: 'FR-PROOF-01' };
  if (!String(photo.dataUrl).startsWith('data:image/')) {
    return { ok: false, reason: 'not-a-photo', why: 'What came with this task is not a picture.', fix: verdict.fix || 'Take the photo in the app.', rule: 'FR-PROOF-01' };
  }

  const live = { ok: false, reason: 'stale', rule: 'FR-PROOF-02',
    why: 'That picture was not taken just now, so it came out of the gallery.',
    fix: 'Take a new one at the bed, in the app. A photo from earlier proves the bed was fine earlier.' };
  if (photo.ageMinutes != null && Number(photo.ageMinutes) > FRESH_PHOTO_MINUTES) return live;
  const taken = Date.parse(photo.takenAt || '');
  const attached = Date.parse(photo.attachedAt || '');
  if (Number.isFinite(taken) && Number.isFinite(attached) && attached - taken > FRESH_PHOTO_MINUTES * 60000) return live;

  const stamp = (payload && payload.stamp) || {};
  if (!(stamp.takenAt || stamp.attachedAt) || !stamp.person || (task.zoneId && !stamp.zone)) {
    return { ok: false, reason: 'unstamped', rule: 'FR-PROOF-02',
      why: 'The photo is not stamped with the date, time, zone and person.',
      fix: 'Take it from the task in the app, which stamps it.' };
  }

  const zone = judgeZoneStart(task, (payload && payload.zoneCheck) || null);
  if (!zone.ok) return { ok: false, reason: zone.reason, why: zone.why, fix: zone.fix, rule: 'FR-PROOF-03' };
  return { ok: true, unverifiedTime: verdict.unverifiedTime };
}

// --- Which house are you actually standing in? — FR-PROOF-03, UX-12 --------
//
// The photo proves the work happened. It does not prove where. A trap
// photographed in GH-02 and filed against GH-01 leaves both houses wrong: one
// with a count that is not its own, and one with no count at all while looking
// as though it has been checked.
//
// So the zone is confirmed at the START of the task, by scanning the code on
// the door. That is the quickest way to choose a zone as well as the surest
// (UX-12 asks for scanning to be offered first), and it costs a second.
//
// Two things this deliberately does NOT do. It does not use GPS: a phone's
// position under a polythene roof is worth ±20 m on a farm whose houses are 8 m
// apart, and NFR-DEV-03 rules out constant GPS anyway. And it does not refuse
// to close a task when there is no scan — some phones have no BarcodeDetector
// and some doors lose their label. The record carries how the zone was
// confirmed, and a round confirmed by scan is worth more than one confirmed by
// tapping a list; both beat nothing, and the audit screen can tell them apart.

export const ZONE_CONFIRMED = {
  qr: { method: 'qr', strength: 'scanned', label: 'Scanned at the door' },
  list: { method: 'list', strength: 'chosen', label: 'Chosen from the list' },
};

/**
 * The record that goes on the task: which zone, how it was confirmed, when and
 * by whom. Same shape whichever way it was confirmed, so nothing downstream has
 * to care which phone it came from.
 */
export function zoneStamp({ zone, method = 'list', at = new Date().toISOString(), by = null }) {
  if (!zone) return null;
  const kind = ZONE_CONFIRMED[method] || ZONE_CONFIRMED.list;
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    method: kind.method,
    strength: kind.strength,
    label: kind.label,
    at,
    by,
  };
}

/**
 * May this task start against this confirmation? — FR-PROOF-03.
 *
 * A scan of the wrong door is the one case that is refused outright, because it
 * is the case this whole feature exists to catch and because the person is, by
 * definition, holding the answer in their hand. Everything else passes, with
 * `confirmed` saying how much the record is worth.
 */
export function judgeZoneStart(task, stamp) {
  if (!task) return { ok: false, why: 'That task is not on record.' };
  const wanted = task.zoneId || null;

  if (!stamp) {
    return {
      ok: true,
      confirmed: false,
      why: 'The zone was not confirmed at the start of this job.',
      fix: 'Scan the code on the door next time — it takes a second and it settles where you were.',
    };
  }
  if (wanted && stamp.zoneId !== wanted) {
    return {
      ok: false,
      confirmed: false,
      reason: 'wrong-zone',
      why: `That code is ${stamp.zoneName}. This job is for another zone.`,
      fix: 'Open the job for the house you are standing in, or go to the right one.',
    };
  }
  return { ok: true, confirmed: true, strength: stamp.strength };
}
