// FR-STOCK-01 — a spray draws its product out of the store by itself.
//
// The spray record says how many litres of mix went on and at what rate, so
// the amount of product is arithmetic, not a second entry somebody has to
// remember. A spray recorded before litres were asked for (or one whose rate
// or stock unit cannot be turned into an amount) draws nothing, and says why,
// rather than guessing: XC-02 and XC-03 read only sprays that carry litres.
//
// Pure, with no store import, so the reducer can call it on replay.

const MASS = { g: 1, gram: 1, grams: 1, kg: 1000 };
const VOLUME = { ml: 1, millilitre: 1, l: 1000, litre: 1000, liter: 1000, litres: 1000 };

/**
 * "2.5 g/L (80WP)", "0.3 ml/L, after 4 PM", "150 ml oil + 30 ml soap / 16 L",
 * "5 g/L GH; 2.5 g/L field" → amount of product per litre of mix, and its
 * unit ('g' or 'ml'). Null when the text does not state one.
 */
export function ratePerLitre(text, zoneType = 'greenhouse') {
  let t = String(text || '');
  // One rate for greenhouses and another for the field: take this zone's.
  if (t.includes(';')) {
    const parts = t.split(';');
    const want = zoneType === 'field' ? /field/i : /\bGH\b|greenhouse/i;
    t = parts.find((p) => want.test(p)) || parts[0];
  }
  const perLitre = t.match(/(\d+(?:\.\d+)?)\s*(g|ml)\s*\/\s*L\b/i);
  if (perLitre) return { amount: Number(perLitre[1]), unit: perLitre[2].toLowerCase() };
  // "150 ml ... / 16 L": the first amount, over the tank it is mixed into.
  const perTank = t.match(/(\d+(?:\.\d+)?)\s*(g|ml)\b[^/]*\/\s*(\d+(?:\.\d+)?)\s*L\b/i);
  if (perTank) return { amount: Number(perTank[1]) / Number(perTank[3]), unit: perTank[2].toLowerCase() };
  return null;
}

/** The store item a spray draws from: same active, stock on hand first. */
export function stockItemFor(inputs, activeId) {
  const items = Object.values(inputs || {}).filter((i) => activeId && i.activeId === activeId);
  return items.find((i) => Number(i.qty) > 0) || items[0] || null;
}

/**
 * What one spray takes out of the store: { itemId, qty, unit } in the item's
 * own unit, or { none: why }.
 */
export function sprayDrawdown(state, spray) {
  const litres = Number(spray.litres);
  if (!(litres > 0)) return { none: 'no litres recorded' };
  const cycle = ((state && state.cycles) || {})[spray.cycleId];
  const zone = cycle ? ((state && state.plots) || {})[cycle.plotId] : null;
  const rate = ratePerLitre(spray.rate, zone ? zone.type : 'greenhouse');
  if (!rate) return { none: 'the rate does not give an amount per litre' };
  const item = stockItemFor(state && state.inputs, spray.activeId || spray.productId);
  if (!item) return { none: 'no store item for this active ingredient' };
  const unit = String(item.unit || '').toLowerCase();
  const table = rate.unit === 'g' ? MASS : VOLUME;
  if (!table[unit]) return { none: `the store counts it in ${item.unit || 'no unit'}, not by weight or volume` };
  const qty = Math.round(((rate.amount * litres) / table[unit]) * 1000) / 1000;
  return { itemId: item.id, qty, unit: item.unit };
}
