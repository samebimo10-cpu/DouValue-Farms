// Supervised spray and gate screens — UX-27.
//
// "Until that round is complete, spray and gate screens are used only with the
// Field Supervisor or Farm Manager present."
//
// UX-26 sends the field screens out to be tried in real work by two Greenhouse
// Hands with the training consultant watching, and anything that slows them
// down is fixed in one revision round afterwards. UX-27 is the safety rule that
// holds while that is going on: the two screens where a mistake is expensive —
// a spray, and a gate — are not used alone by somebody who has never used them
// before.
//
// Expensive in two different ways. A spray puts chemical on a crop, starts a
// waiting period on the fruit and keeps people out of a house. A gate decides
// whether anything may be planted at all. A hand mis-tapping either one during
// a trial of an app they saw last week is exactly the risk the trial itself is
// meant to surface, and running it unsupervised is how the trial creates the
// problem it was there to find.
//
// Two ways to satisfy it, as the requirement words it: the Field Supervisor or
// Farm Manager is signed in, or they are standing there and confirm. The second
// is not a loophole — it is the situation on a shared phone, where the hand is
// holding the handset and the supervisor is beside them. What it costs is a
// name on the record, so "who was there" is answerable afterwards.
//
// And it ends. The Owner has a switch, which is the sign-off UX-26 asks for,
// and after it the screens behave normally. The switch belongs to the Owner
// alone: the Farm Manager who finds the confirmation tedious is precisely the
// person who must not be able to turn it off.

/** The screens UX-27 names. Nothing else is supervised. */
export const SUPERVISED_SCREENS = {
  spray: {
    id: 'spray',
    label: 'Logging a spray',
    why: 'A spray costs money, starts a waiting period on the fruit and keeps people out of the '
      + 'house.',
  },
  gate: {
    id: 'gate',
    label: 'The gate screens',
    why: 'Gates decide whether anything may be planted. A wrong tap here is the whole cycle.',
  },
};

/** Roles that satisfy UX-27 by being the person doing it. */
export const SUPERVISING_ROLES = new Set(['supervisor', 'manager', 'ceo']);

export function isSupervisor(person) {
  return !!person && SUPERVISING_ROLES.has(person.role);
}

/**
 * Has the post-build field trial been signed off? — UX-26, §9a.
 *
 * False by default, and deliberately so: a farm that has not recorded the
 * sign-off has not had the trial, and the requirement holds "until that round
 * is complete".
 */
export function trialSignedOff(state) {
  const trial = ((state && state.settings) || {}).fieldTrial;
  return !!(trial && trial.signedOff);
}

/** The sign-off itself, for the screen that shows what was recorded. */
export function trialRecord(state) {
  const trial = ((state && state.settings) || {}).fieldTrial || {};
  return {
    signedOff: !!trial.signedOff,
    at: trial.at || null,
    by: trial.by || null,
    note: trial.note || '',
  };
}

/** Everyone who could stand over somebody's shoulder and confirm. */
export function whoCanConfirm(state) {
  return Object.values((state && state.people) || {})
    .filter((p) => p.active !== false && isSupervisor(p))
    .sort((a, b) => {
      const rank = { supervisor: 0, manager: 1, ceo: 2 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
    });
}

/**
 * May this person use this screen right now? — UX-27.
 *
 * `confirmedBy` is the id of the supervisor or manager standing beside them,
 * when there is one. Returns `ok` plus how it was satisfied, so the caller can
 * put that on the record rather than merely being let through.
 */
export function checkSupervision(state, user, { screen = 'spray', confirmedBy = null } = {}) {
  const what = SUPERVISED_SCREENS[screen] || SUPERVISED_SCREENS.spray;

  if (trialSignedOff(state)) {
    return { ok: true, required: false, screen: what.id, how: 'trial-signed-off' };
  }
  if (isSupervisor(user)) {
    return { ok: true, required: true, screen: what.id, how: 'present', by: user ? user.id : null };
  }

  const candidates = whoCanConfirm(state);
  if (confirmedBy) {
    const person = ((state && state.people) || {})[confirmedBy];
    if (isSupervisor(person) && person.active !== false) {
      return { ok: true, required: true, screen: what.id, how: 'confirmed', by: person.id,
        byName: person.name };
    }
    return {
      ok: false,
      required: true,
      screen: what.id,
      reason: 'not-a-supervisor',
      why: `${person ? person.name : 'That person'} is not the Field Supervisor or Farm Manager.`,
      fix: 'The Field Supervisor or the Farm Manager has to be the one who confirms.',
      candidates,
    };
  }

  return {
    ok: false,
    required: true,
    screen: what.id,
    reason: 'needs-confirmation',
    needsConfirm: true,
    why: `${what.label} needs the Field Supervisor or Farm Manager until the field trial is signed off.`,
    fix: candidates.length
      ? 'Ask them to confirm here, or hand them the phone.'
      : 'Nobody on this phone holds either position yet. Ask the Owner to set them up.',
    detail: what.why,
    candidates,
  };
}

/**
 * The Owner's switch — the settings payload, so the screen and the test agree
 * on the shape of what gets written.
 */
export function signOffPayload(user, { signedOff = true, note = '', at = new Date().toISOString() } = {}) {
  return {
    fieldTrial: {
      signedOff: !!signedOff,
      at,
      by: user ? user.id : null,
      note: String(note || ''),
    },
  };
}

/** Only the Owner may flip it. Mirrored by the server guard. */
export function maySignOff(user) {
  return !!user && user.role === 'ceo';
}
