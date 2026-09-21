// Low stock — FR-STOCK-02.
//
// "Low stock (below a set level) alerts the Farm Manager, before the input is
// needed."
//
// Two words in that sentence decide the design.
//
// ALERTS. Not "appears in the Owner's digest tomorrow morning", which is what
// this app did before. The Owner is not the person who buys sticky traps; the
// Farm Manager is. Sending it only to the Owner means the one person who can
// act on it is the one person not told, and the digest is exceptions-only, so
// it arrives at best once a day and at worst not at all.
//
// BEFORE. An alert that fires when the drum is empty is a report, not an alert.
// So there are two ways to be low, and either is enough: below the level
// somebody set for that item, or forecast to run out inside the lead time.
// Thiamethoxam ordered the week after the thrips threshold is crossed is
// thiamethoxam that arrives after the tospovirus.
//
// The Owner still sees it in the digest. The point is that they are no longer
// the only one who does.

import { isoDate } from '../util.js';
import { stockForecast } from './predict.js';

/**
 * How long an order takes to arrive, in days.
 *
 * Port Harcourt agro-dealers are not next-day. Two weeks is the default lead
 * time used when an item has no level set, and it is the window "before the
 * input is needed" actually means.
 */
export const DEFAULT_LEAD_DAYS = 14;

/** The level below which this item counts as low, if anybody set one. */
export function reorderLevel(item) {
  const set = Number(item && item.reorderLevel);
  return Number.isFinite(set) && set > 0 ? set : null;
}

/**
 * Who this goes to — FR-STOCK-02.
 *
 * The position first, the role second. A farm where somebody has been moved
 * into the Farm Manager position gets the person; a farm that has not set its
 * positions up yet still gets whoever holds the role, rather than nobody.
 */
export function farmManager(state) {
  const positions = Object.values(state.positions || {});
  const post = positions.find((p) => !p.retired && p.role === 'manager' && p.holderId);
  if (post) {
    const person = (state.people || {})[post.holderId];
    if (person && person.active !== false) return person;
  }
  return Object.values(state.people || {})
    .find((p) => p.role === 'manager' && p.active !== false) || null;
}

/**
 * Everything running low, worst first.
 *
 * `severity` is the app's fixed four-state vocabulary (UX-07): red = act now,
 * yellow = check soon. Nothing here is green, because an item that is fine does
 * not belong on an alert list at all.
 */
export function lowStock(state, { now = new Date().toISOString(), leadDays = DEFAULT_LEAD_DAYS } = {}) {
  const at = new Date(now);
  const usage = (state.stockMoves || [])
    .filter((m) => m.direction === 'out')
    .map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0, date: (m.date || m.at || '').slice(0, 10) }));

  const out = [];
  for (const item of Object.values(state.inputs || {})) {
    const qty = Number(item.qty) || 0;
    const level = reorderLevel(item);
    const forecast = stockForecast(item, usage, at);
    const belowLevel = level != null && qty <= level;
    const runningOut = forecast.daysLeft != null && Number.isFinite(forecast.daysLeft)
      && forecast.daysLeft <= leadDays;

    if (!belowLevel && !runningOut) continue;

    const emptyNow = qty <= 0;
    const severity = emptyNow || forecast.status === 'critical' ? 'now' : 'soon';
    const why = belowLevel
      ? `${qty} ${item.unit || ''} left, at or under the ${level} ${item.unit || ''} reorder level.`.replace(/\s+/g, ' ')
      : `${forecast.daysLeft} days left at the rate it is being used.`;

    out.push({
      itemId: item.id,
      item,
      name: item.name,
      qty,
      unit: item.unit || '',
      reorderLevel: level,
      daysLeft: Number.isFinite(forecast.daysLeft) ? forecast.daysLeft : null,
      reason: belowLevel ? 'below-level' : 'running-out',
      severity,
      // FR-STOCK-02 in one field: this is the Farm Manager's, and it is not
      // only the Owner's digest.
      to: 'Farm Manager',
      role: 'manager',
      line: emptyNow
        ? `${item.name} is out of stock`
        : `${item.name} is low${belowLevel ? '' : ` — about ${forecast.daysLeft} days left`}`,
      detail: `${why} Order it now: anything bought today lands in about ${leadDays} days.`,
      orderBy: isoDate(at),
    });
  }

  const rank = { now: 0, soon: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]
    || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
}

/** The one line a manager's screen needs: is there anything to buy? */
export function lowStockSummary(state, opts = {}) {
  const rows = lowStock(state, opts);
  const urgent = rows.filter((r) => r.severity === 'now').length;
  return {
    rows,
    count: rows.length,
    urgent,
    to: farmManager(state),
    text: !rows.length
      ? 'Nothing running short.'
      : `${rows.length} input${rows.length === 1 ? '' : 's'} to order`
        + (urgent ? `, ${urgent} needed now` : ''),
  };
}
