// The nursery and its seedling batches — FR-FARM-04, FR-FARM-05, Build Rules §11e.
//
// "Seedlings carry thrips, tospovirus and damping-off into every block; the
// nursery is the first green bridge." So the nursery gets its own work (a daily
// trap count, a twice-weekly seedling check), its own hygiene rules, and a
// release check that every batch passes before it may leave for a block.
//
// Gate 1 reads the release from here: a block cannot log transplant without a
// batch that passed the check and was released to that block (rules →
// nursery.gate_link). The release is judged from the batch's own record every
// time the log is replayed, so a phone that skipped the form cannot sync a
// release that did not pass.

import { addDays, daysBetween, isoDate } from '../util.js';
import { isNursery } from './farm.js';

/**
 * The five lines of the release check, in the rules' order, plus the first
 * hygiene rule (clean media), which is a condition of the batch existing
 * safely at all. Labels are read from the rules where the rules have them.
 */
const RELEASE_IDS = ['hardened', 'no_virus', 'no_thrips', 'no_damping_off', 'block_recorded'];

export const CLEAN_MEDIA = [
  { value: 'sterilised', label: 'Sterilised' },
  { value: 'solarised', label: 'Solarised' },
  { value: 'bought-in', label: 'Bought-in' },
];

export function nurseryRules(rules) {
  return (rules && rules.nursery) || null;
}

/** "hardened 7+ days" → 7. Falls back to 7 if the wording ever changes. */
export function hardenDays(rules) {
  const first = ((nurseryRules(rules) || {}).seedling_release_check || [])[0] || '';
  const m = /(\d+)\s*\+?\s*days?/i.exec(first);
  return m ? Number(m[1]) : 7;
}

export function releaseLabels(rules) {
  const list = (nurseryRules(rules) || {}).seedling_release_check || [];
  return RELEASE_IDS.map((id, i) => ({ id, label: list[i] || id.replace(/_/g, ' ') }));
}

/** The hygiene rules, as the rules file words them (§11e). */
export function hygieneRules(rules) {
  return ((nurseryRules(rules) || {}).rules || []).slice();
}

export const batchList = (state) => Object.values((state && state.seedlingBatches) || {});

/** Batches still growing in one nursery zone (not released, not discarded). */
export function growingIn(state, nurseryZoneId) {
  return batchList(state)
    .filter((b) => b.nurseryZoneId === nurseryZoneId && b.status === 'growing')
    .sort((a, b) => ((a.sownDate || '') < (b.sownDate || '') ? -1 : 1));
}

function latestCheck(batch, date) {
  return [...(batch.checks || [])]
    .filter((c) => !date || (c.date || '') <= date)
    .sort((a, b) => ((a.date || a.at || '') < (b.date || b.at || '') ? 1 : -1))[0] || null;
}

/**
 * FR-FARM-05 — the release check for one batch going to one block.
 *
 * Pure. `answers` are what the person doing the check saw today
 * ({ noVirus, noThrips, noDampingOff }, each true only if they looked and
 * found none). The batch's own record decides hardening and media; its latest
 * twice-weekly check can still fail a line the person ticked, because a
 * seedling check that found virus two days ago is not undone by a tick box.
 */
export function releaseCheck(state, batch, { date = isoDate(), zoneId = null, answers = {}, rules = null } = {}) {
  const labels = Object.fromEntries(releaseLabels(rules).map((l) => [l.id, l.label]));
  const items = [];
  const add = (id, label, ok, why, fix = '') => items.push({ id, label, state: ok ? 'have' : 'missing', why, fix });

  if (!batch) {
    return { ok: false, items: [], failing: [{ id: 'batch', why: 'There is no such seedling batch.' }], why: 'There is no such seedling batch.' };
  }

  const status = batch.status || 'growing';
  if (status !== 'growing') {
    const why = status === 'released'
      ? `Batch ${batch.label || batch.id} was already released on ${(batch.release || {}).date || 'an earlier day'}.`
      : `Batch ${batch.label || batch.id} was discarded.`;
    return { ok: false, items: [], failing: [{ id: 'status', why }], why };
  }

  // Hygiene rule 1: never raw soil from a cropping block.
  const cleanMedia = CLEAN_MEDIA.some((m) => m.value === batch.media);
  add('clean_media', 'nursery media clean: sterilised, solarised or bought-in', cleanMedia,
    cleanMedia ? `Raised in ${batch.media} media.` : `Media recorded as "${batch.media || 'not recorded'}".`,
    'Seedlings raised in raw soil from a cropping block carry that block\'s problems. Re-raise the batch in clean media.');

  const need = hardenDays(rules);
  const hardenedFor = batch.hardenedFrom ? daysBetween(batch.hardenedFrom, date) : null;
  add('hardened', labels.hardened, hardenedFor != null && hardenedFor >= need,
    hardenedFor == null ? 'Hardening has not been recorded for this batch.'
      : `Hardening since ${batch.hardenedFrom}: ${hardenedFor} day${hardenedFor === 1 ? '' : 's'}.`,
    hardenedFor == null ? 'Record the day hardening started.'
      : `Hardening needs ${need} days. Earliest release ${isoDate(addDays(batch.hardenedFrom, need))}.`);

  const last = latestCheck(batch, date);
  const seen = (key, answer, found, label, fix) => {
    const failedBefore = last && last[found];
    const ok = answer === true && !failedBefore;
    add(key, label, ok,
      failedBefore ? `The seedling check on ${last.date} found ${found === 'dampingOff' ? 'damping-off' : found}.`
        : answer === true ? 'Checked today: none found.' : 'Not confirmed today.',
      fix);
  };
  seen('no_virus', answers.noVirus, 'virus', labels.no_virus,
    'Look for ring/line patterns and mottling. A batch with virus does not leave; rogue and bag the affected trays.');
  seen('no_thrips', answers.noThrips, 'thrips', labels.no_thrips,
    'Tap tips over white paper. Thrips on the batch means treat and re-check before release.');
  seen('no_damping_off', answers.noDampingOff, 'dampingOff', labels.no_damping_off,
    'Any collapsed seedlings in the batch means it does not leave yet.');

  const target = zoneId ? ((state && state.plots) || {})[zoneId] : null;
  const blockOk = !!target && !isNursery(target) && !target.retired;
  add('block_recorded', labels.block_recorded, blockOk,
    !zoneId ? 'No block named.'
      : !target ? 'The block named is not on record.'
        : isNursery(target) ? `${target.name} is the nursery, not a block.`
          : target.retired ? `${target.name} is retired.`
            : `Going to ${target.name}.`,
    'Name the block the batch goes to. That link is what Gate 1 reads.');

  const failing = items.filter((i) => i.state !== 'have');
  return {
    ok: failing.length === 0,
    items,
    failing,
    why: failing.length ? `Release check not passed: ${failing.map((f) => f.label).join('; ')}.` : null,
  };
}

/**
 * Gate 1's question: is there a released batch for this block?
 *
 * The batch must have been released to this block, on or before the day being
 * judged and after the previous cycle there ended, and not already planted
 * into another cycle. `batchId` asks about one batch in particular.
 */
export function releasedFor(state, zoneId, { asOf = isoDate(), since = null, batchId = null, cycleId = null } = {}) {
  const fits = (b) => b.status === 'released' && b.release && b.release.zoneId === zoneId
    && (b.release.date || '') <= asOf
    && (!since || (b.release.date || '') > since)
    && (!b.usedByCycleId || b.usedByCycleId === cycleId);

  if (batchId) {
    const b = ((state && state.seedlingBatches) || {})[batchId];
    if (!b) return { batch: null, why: 'That seedling batch is not on record.' };
    if (!fits(b)) {
      return {
        batch: null,
        why: b.status !== 'released' ? `Batch ${b.label || b.id} has not passed the release check.`
          : b.release.zoneId !== zoneId ? `Batch ${b.label || b.id} was released to a different block.`
            : b.usedByCycleId ? `Batch ${b.label || b.id} is already planted.`
              : `Batch ${b.label || b.id} was released outside the window for this planting.`,
      };
    }
    return { batch: b, why: '' };
  }

  const batch = batchList(state).filter(fits)
    .sort((a, b) => ((a.release.date || '') < (b.release.date || '') ? 1 : -1))[0] || null;
  return { batch, why: batch ? '' : 'No seedling batch has been released to this block.' };
}

// --- The nursery's own work (FR-FARM-04) -----------------------------------

/**
 * Daily trap count and a twice-weekly seedling check (rules → nursery.rules).
 *
 * The rules say "twice-weekly" without naming days; Monday and Thursday keep
 * the two checks evenly apart. Nursery work is due at 07:00, before anything
 * in the blocks, because the hygiene rule is "nursery first, cropping blocks
 * after".
 */
export const SEEDLING_CHECK_DAYS = [1, 4];

export const NURSERY_OPERATIONS = [
  {
    kind: 'nursery_trap',
    title: 'Nursery trap count',
    due: 7,
    proof: true,
    how: [
      'Come to the nursery first, before any cropping block — never from a block back in without washing hands and changing over-clothes.',
      'Photograph each trap, count the thrips and whitefly and record it.',
      'Check nothing within 5 m: no crop debris, culls or volunteer peppers.',
    ],
    why: 'The nursery is the first green bridge. A thrips build-up here goes out to every block with the seedlings.',
  },
  {
    kind: 'seedling_check',
    title: 'Seedling check',
    due: 7,
    proof: true,
    how: [
      'Tap tips over white paper for thrips.',
      'Look for ring/line patterns and mottling (virus).',
      'Look for collapsed seedlings pinched at the base (damping-off).',
      'Record what you found for each batch, with a photo.',
    ],
    why: 'A batch only leaves once it passes the release check, and this is how you know before release day.',
  },
];

export function nurseryTasks(state, { date = isoDate(), taskIdFor, positionOfZone = new Map() } = {}) {
  const out = [];
  const weekday = new Date(`${date}T12:00:00`).getDay();
  for (const zone of Object.values((state && state.plots) || {})) {
    if (!isNursery(zone) || zone.retired) continue;
    const ops = [NURSERY_OPERATIONS[0]];
    if (SEEDLING_CHECK_DAYS.includes(weekday) && growingIn(state, zone.id).length) ops.push(NURSERY_OPERATIONS[1]);
    for (const op of ops) {
      out.push({
        id: taskIdFor(date, zone.id, op.kind),
        kind: op.kind,
        title: `${op.title} — ${zone.name}`,
        zoneId: zone.id,
        cycleId: null,
        positionId: positionOfZone.get(zone.id) || null,
        due: `${date}T${String(op.due).padStart(2, '0')}:00`,
        generated: true,
        proof: !!op.proof,
        how: op.how,
        why: op.why,
      });
    }
  }
  return out;
}
