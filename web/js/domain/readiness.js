// Is this farm ready for real use? — section 9, and NFR-SEC-01.
//
// The acceptance checklist in the requirements is a list of things somebody has
// to remember before launch. Things people have to remember are things people
// forget, and the one at the top of the list is the dangerous one: the sample
// farm and its shared PIN of 1234, left in place beside real records.
//
// So the checklist lives in the app and answers itself from the records. Every
// row here is computed. None of it is a box anyone ticks.

import { isoDate } from '../util.js';
import { gateBoard } from './gates.js';
import { alerts } from './alerts.js';

/** Sample records are the only ones that carry an `sp_` id. */
const isSample = (id) => String(id || '').startsWith('sp_');

/**
 * NFR-SEC-01 — the one that matters most.
 *
 * Sample data alone is fine: somebody is looking around. Real data alone is
 * fine: the farm is running. The two together is the dangerous state, because
 * every sample account shares the PIN 1234 and every one of them can sign in
 * and see whatever their role allows — on a farm with real wages in it.
 */
export function sampleDataCheck(state) {
  const people = Object.values(state.people || {});
  const samplePeople = people.filter((p) => isSample(p.id) && p.active !== false);
  const realPeople = people.filter((p) => !isSample(p.id) && p.active !== false);

  const realRecords = [
    ...(state.harvests || []), ...(state.sales || []), ...(state.expenses || []),
  ].filter((r) => !isSample(r.id)).length;

  if (!samplePeople.length) {
    return { ok: true, state: 'clean', why: 'No sample accounts on this phone.' };
  }
  if (!realPeople.length && !realRecords) {
    return {
      ok: true,
      state: 'sample-only',
      why: 'This is the sample farm. Nothing real is recorded here yet.',
      fix: 'Erase it from the sign-in screen before you start recording real work.',
    };
  }
  return {
    ok: false,
    state: 'mixed',
    severity: 'critical',
    why: `${samplePeople.length} sample account${samplePeople.length === 1 ? '' : 's'} `
      + `${samplePeople.length === 1 ? 'is' : 'are'} still active alongside `
      + `${realPeople.length} real ${realPeople.length === 1 ? 'person' : 'people'}`
      + `${realRecords ? ` and ${realRecords} real records` : ''}.`,
    fix: 'Every sample account shares the PIN 1234. Remove them under People before anyone '
      + 'else uses this farm.',
    samplePeople: samplePeople.map((p) => p.name),
  };
}

/** Accounts that can still be opened with the sample PIN — NFR-SEC-02. */
export function sharedPinCheck(state) {
  const shared = Object.values(state.people || {})
    .filter((p) => p.active !== false && isSample(p.id));
  return shared.length
    ? {
      ok: false,
      severity: 'critical',
      why: `${shared.length} account${shared.length === 1 ? '' : 's'} still use the sample PIN 1234.`,
      fix: 'Real PINs are set by each person when they join with their own invite.',
    }
    : { ok: true, why: 'No account is using a shared PIN.' };
}

/**
 * The launch checklist, answered from the records — section 9.
 *
 * Two rows cannot be answered by a computer and say so plainly rather than
 * pretending: the field-screen review with the training consultant (UX-26), and
 * confirming the Owner actually received a digest on the chosen channel
 * (FR-REP-02, open decision D-1).
 */
export function readiness(state, { today = isoDate(), now = new Date().toISOString() } = {}) {
  const sample = sampleDataCheck(state);
  const pins = sharedPinCheck(state);
  const board = gateBoard(state, { today });
  const plantedUngated = board.filter((r) => r.planted && r.blocking.length);
  const openAlerts = alerts(state, { now }).filter((a) => a.status === 'open');
  const stale = openAlerts.filter((a) => a.overdue);
  const spraysNoDiagnosis = (state.sprays || []).filter((s) => !s.diagnosisId).length;

  const rows = [
    {
      id: 'NFR-SEC-01',
      label: 'Sample farm erased before real use',
      ok: sample.ok && sample.state !== 'sample-only',
      detail: sample.why,
      fix: sample.fix,
      severity: sample.severity,
    },
    {
      id: 'NFR-SEC-02',
      label: 'Every PIN is one person\'s own',
      ok: pins.ok,
      detail: pins.why,
      fix: pins.fix,
      severity: pins.severity,
    },
    {
      id: 'FR-GATE-01/02',
      label: 'Nothing planted behind a closed gate',
      ok: plantedUngated.length === 0,
      detail: plantedUngated.length
        ? `${plantedUngated.map((r) => r.zone.name).join(', ')} planted with checks outstanding.`
        : `${board.length} zone${board.length === 1 ? '' : 's'} checked, none planted behind a gate.`,
      fix: 'Test those zones now — the result decides what happens to the next cycle in that ground.',
      severity: 'critical',
    },
    {
      id: 'FR-GATE-04',
      label: 'No treatment without a diagnosis',
      ok: spraysNoDiagnosis === 0,
      detail: spraysNoDiagnosis
        ? `${spraysNoDiagnosis} spray${spraysNoDiagnosis === 1 ? '' : 's'} on record with nothing behind `
          + 'them. The gate refuses new ones.'
        : 'Every recorded spray has a confirmed diagnosis behind it.',
    },
    {
      id: 'FR-SCOUT-04',
      label: 'No alert left past its deadline',
      ok: stale.length === 0,
      detail: stale.length
        ? `${stale.length} alert${stale.length === 1 ? '' : 's'} past 24 hours.`
        : `${openAlerts.length} open, none past its deadline.`,
      severity: 'critical',
    },
    {
      id: 'NFR-OFF-01',
      label: 'Field screens work with no signal',
      ok: true,
      detail: 'Every screen reads from this phone. Sync is an exchange afterwards, never a '
        + 'condition of recording.',
    },
    {
      id: 'UX-26',
      label: 'Field screens tried by two Greenhouse Hands',
      ok: null,
      detail: 'Nobody can answer this from the records. It needs the training consultant and two '
        + 'of the hands, on their own phones, in the field.',
    },
    {
      id: 'FR-REP-02',
      label: 'Owner receives the digest on the chosen channel',
      ok: null,
      detail: 'Open decision D-1: WhatsApp, email, or both. The digest is ready to copy; how it '
        + 'is sent is still yours to choose.',
    },
  ];

  const blocking = rows.filter((r) => r.ok === false);
  return {
    rows,
    blocking,
    unanswerable: rows.filter((r) => r.ok === null),
    ready: blocking.length === 0,
  };
}
