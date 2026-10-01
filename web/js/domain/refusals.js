// Records the farm server refused, told to the person who made them.
//
// The phone saves every record at once, offline, and the farm server judges it
// later — the gates, the waiting periods, the proof photos (server/judge.mjs),
// as well as who may file what. A refusal used to be marked as sent and
// written to the browser console, so the record stayed on one phone, never
// reached anybody else's, and the person who made it was never told. A
// planting or a harvest that the farm does not know about is worse than one
// that was refused to their face: they think it is done.
//
// So a refusal is kept on the phone with what the record was, why it was
// refused and what to do, and shown to the person who made it — and to the
// people who run the work — until they say they have read it. The record
// itself stays in this phone's log (records are corrected, never silently
// deleted, NFR-SEC-05); it is simply not on the farm.

/** How many refusals a phone keeps. Older ones drop off once read. */
export const REFUSALS_KEPT = 100;

const DAY = (at) => String(at || '').slice(0, 10);

function zoneOf(state, { plotId = null, zoneId = null, cycleId = null } = {}) {
  const plots = (state && state.plots) || {};
  const cycle = cycleId ? ((state && state.cycles) || {})[cycleId] : null;
  const zone = plots[plotId] || plots[zoneId] || (cycle ? plots[cycle.plotId] : null);
  return zone ? zone.name : null;
}

/** What a record was, in a few words a hand would recognise. */
export function describeRecord(event, state = {}) {
  if (!event) return 'A record';
  const p = event.payload || {};
  const where = zoneOf(state, p);
  const on = where ? ` on ${where}` : '';
  switch (event.type) {
    case 'cycle.start': return `Planting${p.cropId ? ` ${p.cropId}` : ''}${where ? ` in ${where}` : ''}`;
    case 'spray.record': return `Spray of ${p.productName || p.activeId || p.productId || 'a product'}${on}`;
    case 'harvest.record': return `Harvest${p.kg ? ` of ${p.kg} kg` : ''}${where ? ` from ${where}` : ''}`;
    case 'topsoil.assign': return `Topsoil put into ${where || 'a zone'}`;
    case 'task.complete': {
      const task = ((state && state.tasks) || {})[p.id];
      return `${task ? task.title : 'A task'} marked done`;
    }
    case 'scout.record': return p.trapCount != null ? `Trap count${on}` : `Scouting${on}`;
    case 'diagnosis.record': return `Diagnosis${on}`;
    case 'diagnosis.confirm': return 'Confirming a diagnosis';
    case 'diagnosis.approve': return 'Approving a diagnosis';
    case 'sale.record': return 'A sale';
    case 'person.upsert': return `An account${p.name ? ` for ${p.name}` : ''}`;
    default: return String(event.type || 'A record').replace(/\./g, ' ');
  }
}

/**
 * Fold the server's refusals for one push into what the phone keeps. `batch`
 * is what was sent, so each refusal can say what the record was and who made
 * it; the server's reply only carries its id.
 */
export function noteRefusals(kept, refused, batch, { state = {}, now = new Date().toISOString() } = {}) {
  const byId = new Map((batch || []).map((e) => [e.id, e]));
  const next = new Map((kept || []).map((r) => [r.id, r]));
  for (const r of refused || []) {
    if (!r || !r.id) continue;
    const event = byId.get(r.id) || null;
    next.set(r.id, {
      id: r.id,
      type: r.type || (event && event.type) || null,
      what: describeRecord(event || { type: r.type }, state),
      day: DAY((event && ((event.payload || {}).date || event.at)) || now),
      by: (event && event.by) || null,
      why: r.why || 'The farm server did not accept it.',
      fix: r.fix || null,
      rule: r.rule || null,
      refusedAt: now,
      read: false,
    });
  }
  return [...next.values()]
    .sort((a, b) => (a.refusedAt < b.refusedAt ? 1 : -1))
    .filter((r, i) => !r.read || i < REFUSALS_KEPT);
}

/**
 * The unread refusals this person should see: their own records, and — for
 * the people who run the work — everybody's on this phone, because a hand
 * whose harvest was refused may have walked off before the bar turned red.
 */
export function refusalsFor(kept, person, { seesAll = false } = {}) {
  if (!person) return [];
  return (kept || []).filter((r) => !r.read && (seesAll || !r.by || r.by === person.id));
}

/** Mark these as read. They stay on the list until it is trimmed. */
export function markRead(kept, ids) {
  const wanted = new Set(ids || []);
  return (kept || []).map((r) => (wanted.has(r.id) ? { ...r, read: true } : r));
}
