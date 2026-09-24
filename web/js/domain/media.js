// Growing media — FR-GATE-08 to FR-GATE-10.
//
// A zone grows either in its own bed soil or in plant bags filled from a heap
// of bought-in or mixed media. The two fail in different places. A bed carries
// its own history, so Gate 0 tests the bed. A bag carries the history of the
// heap it was filled from, and one heap can fill bags in three houses. Testing
// each house for a problem that arrived in one lorry is how the same nematodes
// get planted three times.
//
// So for a bag zone the unit of clearance is the media batch, and the thing
// this file keeps is the chain between them: batch → bags → zone. Every fill
// names the batch it came from, the zone it went into and how many bags, so
// that when a batch fails — before planting or after — the answer to "where
// did it go?" is a list, not a memory.
//
// Nothing here decides a gate. gates.js does that; this is the record it reads.
// A zone with no `media` field is a bed zone, which is every zone that existed
// before bags did, and they behave exactly as they always have.

export const MEDIA_TYPES = [
  { id: 'bed', name: 'Bed soil', hint: 'Planted straight into the ground or a raised bed. Gate 0 tests the bed.' },
  { id: 'bag', name: 'Plant bags', hint: 'Grown in bags filled from a media heap. Gate 0 tests the heap each bag came from.' },
];

/** 'bed' unless the zone says 'bag'. Unknown values are beds, which is the stricter-tested and older path. */
export function mediaOf(zone) {
  return zone && zone.media === 'bag' ? 'bag' : 'bed';
}

export function isBagZone(zone) {
  return mediaOf(zone) === 'bag';
}

/** Every fill ever made from anything, oldest first. */
function allFills(state) {
  return [...((state && state.mediaFills) || [])]
    .sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
}

/** The bags standing in a zone now: fills not since pulled out. */
export function fillsInZone(state, zoneId, { includePulled = false } = {}) {
  return allFills(state)
    .filter((f) => f.zoneId === zoneId)
    .filter((f) => includePulled || !f.pulledAt);
}

export function bagsInZone(state, zoneId) {
  return fillsInZone(state, zoneId).reduce((n, f) => n + (Number(f.bags) || 0), 0);
}

/**
 * The batches a zone depends on now, each with how many of its bags are there.
 * One entry per batch, in the order the first of its bags went in.
 */
export function batchesInZone(state, zoneId) {
  const out = new Map();
  for (const f of fillsInZone(state, zoneId)) {
    const row = out.get(f.batchId) || {
      batchId: f.batchId,
      batch: ((state && state.mediaBatches) || {})[f.batchId] || null,
      bags: 0,
      fills: [],
    };
    row.bags += Number(f.bags) || 0;
    row.fills.push(f);
    out.set(f.batchId, row);
  }
  return [...out.values()];
}

/**
 * FR-GATE-10 — where a batch went.
 *
 * Every zone that has ever held bags from this batch, with the bags still
 * standing there and the ones already pulled, and whether a crop is in the
 * ground. A failed batch reads this to name every zone it reached; a zone
 * whose bags were all pulled stays on the list, marked, because "we already
 * dealt with GH-05" is a claim someone should be able to check.
 */
export function zonesForBatch(state, batchId) {
  const plots = (state && state.plots) || {};
  const cycles = Object.values((state && state.cycles) || {});
  const out = new Map();

  for (const f of allFills(state).filter((x) => x.batchId === batchId)) {
    const row = out.get(f.zoneId) || {
      zoneId: f.zoneId,
      zone: plots[f.zoneId] || null,
      name: (plots[f.zoneId] && plots[f.zoneId].name) || f.zoneId,
      bags: 0,
      pulled: 0,
      fills: [],
    };
    if (f.pulledAt) row.pulled += Number(f.bags) || 0;
    else row.bags += Number(f.bags) || 0;
    row.fills.push(f);
    out.set(f.zoneId, row);
  }

  return [...out.values()].map((row) => {
    const cycle = cycles.find((c) => c.plotId === row.zoneId && c.status === 'active') || null;
    return { ...row, cycle, planted: !!cycle, cleared: row.bags === 0 };
  });
}

/** "GH-03 (120 bags, planted), GH-05 (40 bags)" — the list a person reads out. */
export function describeZones(rows) {
  return rows
    .filter((r) => r.bags > 0)
    .map((r) => `${r.name} (${r.bags} bag${r.bags === 1 ? '' : 's'}${r.planted ? ', planted' : ''})`)
    .join(', ');
}

/** A batch's short name for screens and messages. */
export function batchLabel(batch, batchId = null) {
  if (!batch) return `batch ${String(batchId || '').slice(-4) || '(unknown)'}`;
  return `${batch.supplier || 'unnamed supplier'}, ${batch.date || 'no date'}`;
}

/**
 * The volume of media in a zone, in litres, when the zone says how big its
 * bags are. The lime calculator doses by this (FR-DOC-05, bag zones).
 */
export function mediaVolumeL(state, zoneId) {
  const zone = ((state && state.plots) || {})[zoneId];
  const litres = Number(zone && zone.bagLitres) || 0;
  const bags = bagsInZone(state, zoneId);
  return { bags, litresPerBag: litres, litres: bags * litres };
}
