// Plant-bag zones — the media type per zone, and batch → bags → zone (C-19).
//
// A zone grows its crop either in its own bed soil or in plant bags filled from
// a batch of media. For a bed zone nothing here applies and nothing changes.
// For a bag zone the bed is not the ground the roots meet; the batch is. So
// Gate 0 is judged on the batch (gates.js reads the helpers below), every fill
// is recorded as batch → number of bags → zone, and a batch that fails after it
// has been used can name every zone it went into.
//
// Rules → plant_bags. Nothing in this file is agronomy of its own: it keeps the
// records straight so the gates can read them.

import { isoDate } from '../util.js';
import { peekRules } from '../rules.js';

export const MEDIA_TYPES = {
  bed: { id: 'bed', label: 'Bed soil' },
  bag: { id: 'bag', label: 'Plant bags' },
};

/** Rules → plant_bags.barrier.options, with the ids the records carry. */
export const BARRIERS = [
  { value: 'ground_cover', label: 'Ground cover' },
  { value: 'polythene', label: 'Polythene' },
  { value: 'none', label: 'None — bags stand on bare ground' },
];

export const MEDIA_SOURCES = [
  { value: 'fresh', label: 'Fresh — a new delivery' },
  { value: 're-treated', label: 'Re-treated — used media, treated again' },
];

export function bagRules(rules = peekRules()) {
  return (rules && rules.plant_bags) || null;
}

const dayOf = (r) => (r && (r.date || (r.at || '').slice(0, 10))) || '';

/**
 * The media a crop in this zone grows in. A planted cycle keeps the media it
 * was planted in, so changing the zone later does not re-judge that crop.
 * Anything that is not recorded as bags is bed soil: a zone set up before
 * media types existed is judged exactly as it always was.
 */
export function mediaOf(state, zoneId, cycle = null) {
  if (cycle && cycle.media) return cycle.media === 'bag' ? 'bag' : 'bed';
  const zone = ((state && state.plots) || {})[zoneId];
  return zone && zone.media === 'bag' ? 'bag' : 'bed';
}

export const isBagZone = (zone) => !!zone && zone.media === 'bag';

export function barrierLabel(value) {
  const b = BARRIERS.find((x) => x.value === value);
  return b ? b.label : null;
}

export function batchName(batch) {
  if (!batch) return 'an unrecorded batch';
  return batch.label || `${batch.supplier || 'batch'} ${String(batch.id).slice(-4)}`;
}

/** Every fill into a zone that was not refused, in a window, oldest first. */
export function fillsFor(state, zoneId, { since = null, until = null } = {}) {
  return ((state && state.mediaFills) || [])
    .filter((f) => f.zoneId === zoneId && !f.refused)
    .filter((f) => (!since || dayOf(f) > since) && (!until || dayOf(f) <= until))
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
}

/** The batches the bags in a zone were filled from, in that window. */
export function batchesIn(state, zoneId, window = {}) {
  const ids = [...new Set(fillsFor(state, zoneId, window).map((f) => f.batchId))];
  return ids.map((id) => ({ id, batch: ((state && state.mediaBatches) || {})[id] || null }));
}

/** The first day a batch went into bags, or null. */
export function firstFill(state, batchId) {
  const f = ((state && state.mediaFills) || []).filter((x) => x.batchId === batchId && !x.refused)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1))[0];
  return f ? dayOf(f) : null;
}

/**
 * Has this batch failed after it was used? Rules → plant_bags.trace.failure:
 * a nematode result on the batch that is not clear, sampled on or after its
 * first fill, or a failure recorded against it. The earliest one counts.
 * Before a batch fills anything, a bad result is simply the gate saying no.
 */
export function batchFailure(state, batchId) {
  const batch = ((state && state.mediaBatches) || {})[batchId];
  if (!batch) return null;
  const first = firstFill(state, batchId);
  const found = [];
  if (batch.failure) {
    found.push({ date: batch.failure.date, reason: batch.failure.reason || 'recorded',
      why: batch.failure.note || batch.failure.reason || 'failure recorded', by: batch.failure.by,
      from: { kind: 'media-batch', id: batchId } });
  }
  if (first) {
    for (const t of (state.soilTests || [])) {
      if (t.mediaBatchId !== batchId || !t.nematode || t.nematode === 'clean' || !t.date || t.date < first) continue;
      found.push({ date: t.date, reason: 'nematode', why: `nematode test came back ${t.nematode}${t.lab ? ` (${t.lab})` : ''}`,
        from: { kind: 'soil-test', id: t.id } });
    }
  }
  return found.sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

/**
 * The cycles that grew in the bags a fill made. A cycle counts when it was
 * planted on or after the fill and the fill came after the cycle before it in
 * that zone had ended — the same window Gate 0 reads.
 */
function cyclesFromFill(state, fill) {
  const cycles = Object.values((state && state.cycles) || {}).filter((c) => c.plotId === fill.zoneId);
  return cycles.filter((c) => {
    if (!c.transplantDate || c.transplantDate < dayOf(fill)) return false;
    const before = cycles.filter((o) => o !== c && o.closedAt && o.closedAt <= c.transplantDate)
      .map((o) => o.closedAt).sort().pop();
    return !before || dayOf(fill) > before;
  });
}

/**
 * Rules → plant_bags.trace: batch → bags → zone. Every zone the batch filled,
 * with the bags, the fill dates and any crop planted in them.
 */
export function batchTrace(state, batchId) {
  const batch = ((state && state.mediaBatches) || {})[batchId] || null;
  const fills = ((state && state.mediaFills) || []).filter((f) => f.batchId === batchId && !f.refused)
    .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : 1));
  const byZone = new Map();
  for (const f of fills) {
    const row = byZone.get(f.zoneId) || {
      zoneId: f.zoneId, zone: ((state && state.plots) || {})[f.zoneId] || null, bags: 0, fills: [], cycles: [],
    };
    row.bags += Number(f.bags) || 0;
    row.fills.push(f);
    for (const c of cyclesFromFill(state, f)) if (!row.cycles.includes(c)) row.cycles.push(c);
    byZone.set(f.zoneId, row);
  }
  const zones = [...byZone.values()].map((z) => ({
    ...z,
    name: (z.zone && z.zone.name) || z.zoneId,
    planted: z.cycles.filter((c) => c.status === 'active'),
  }));
  return { batch, fills, zones, bags: zones.reduce((n, z) => n + z.bags, 0) };
}

/** "GH-04 (120 bags, planted 2026-09-16), GH-05 (80 bags, empty)" */
export function traceText(trace) {
  return trace.zones.map((z) => {
    const crop = z.planted.length ? `planted ${z.planted.map((c) => c.transplantDate).join(', ')}`
      : z.cycles.length ? 'crop closed' : 'not planted';
    return `${z.name} (${z.bags} bag${z.bags === 1 ? '' : 's'}, ${crop})`;
  }).join('; ');
}

/**
 * Every batch that has failed after filling bags, with where it went. This is
 * what the Gates screen and the Owner's digest show: a failure is only useful
 * if it arrives with the list of houses to go and look at.
 */
export function failedBatches(state, { today = isoDate() } = {}) {
  return Object.values((state && state.mediaBatches) || {})
    .map((batch) => ({ batch, failure: batchFailure(state, batch.id) }))
    .filter((x) => x.failure && x.failure.date <= today)
    .map((x) => ({ ...x, trace: batchTrace(state, x.batch.id) }))
    .filter((x) => x.trace.zones.length)
    .sort((a, b) => (a.failure.date < b.failure.date ? 1 : -1));
}

/**
 * Was this crop galled? Rules → plant_bags.clean_restart.galled: the Gate 4
 * root inspection found galls, a root-knot nematode diagnosis was confirmed on
 * it, or the batch in its bags failed on nematodes.
 */
export function galledCycle(state, cycle) {
  if (!cycle) return { galled: false, why: null };
  const inspection = ((state && state.gateEvidence) || [])
    .find((e) => e.gate === 'G4' && e.itemId === 'root_inspection' && e.cycleId === cycle.id && e.galls);
  if (inspection) return { galled: true, why: `the root inspection on ${dayOf(inspection)} found galls` };
  const diagnosis = ((state && state.diagnoses) || [])
    .find((d) => d.cycleId === cycle.id && d.problemId === 'root_knot_nematode' && d.confirmedBy);
  if (diagnosis) return { galled: true, why: `root-knot nematode was confirmed on ${diagnosis.date}` };
  for (const f of ((state && state.mediaFills) || []).filter((x) => x.zoneId === cycle.plotId && !x.refused)) {
    if (!cyclesFromFill(state, f).includes(cycle)) continue;
    const failure = batchFailure(state, f.batchId);
    if (failure && failure.reason === 'nematode') {
      return { galled: true, why: `its media batch ${batchName(state.mediaBatches[f.batchId])} failed on nematodes (${failure.date})` };
    }
  }
  return { galled: false, why: null };
}
