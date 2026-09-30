// Learn — the problem cards as a Greenhouse Hand reads them (FR-LEARN-01 to 05).
//
// The same 22 cards the clinic diagnoses from, cut down to what a hand acts
// on: how to recognise it, how to catch it early, what it is confused with,
// and what to do first. Doses, rotation groups and treatment plans are not on
// the hand's card at all; they stay on the supervising view of the same card
// (#/guide/item), which only a role holding `viewTreatment` opens.
//
// The rules' own text mixes the two. A first action reads "Rotate thrips spray
// (Spinosad IRAC 5) if over threshold; log and re-count", and a prevention
// line reads "Borax 1 g/L weekly on tips through set". So every clause that
// reaches a hand goes through one filter, and a clause that names a product,
// a group, a dose or a spray programme is left off whole rather than edited:
// half a spray instruction is worse than none. The product names come from the
// rules' active-ingredient list, so a new active added to the rules is kept
// off the hand's card without anybody touching this file.
//
// Pure, and offline: everything here is read from the rules bundled with the
// app and from reference photos already in the farm's log.

import { loadRules, peekRules } from '../rules.js';
import {
  CARD_BY_ID, CARDS, cardPhoto, lookalikesFor, rowPhoto, rowsForCard, separatingSymptom,
} from './diagnose.js';

const RULES = peekRules() || await loadRules();

// --- The filter -----------------------------------------------------------

/** Words that make a clause a treatment instruction rather than something a hand does. */
const TREATMENT_RE = new RegExp([
  'spray', 'drench', 'miticide', 'fungicide', 'insecticide', 'pesticide', 'chemical',
  '\\birac\\b', '\\bfrac\\b', 'rotat', 'programme', '\\bdoses?\\b', '\\brates?\\b',
  '\\bbt\\b', '\\bca\\b', 'calcium', 'nitrate', '\\blime\\b', 'liming', 'solaris',
  '\\bgate\\s*\\d', '\\bg\\d\\b', '\\binputs?\\b', 'pre-stocked',
  'fertili', 'phosph', 'nutrition', '\\bplace p\\b',
].join('|'), 'i');

/** A quantity: 1 g/L, 0.5 ml/L, 1.8 kg/1,000 L, "max 1.5". */
const DOSE_RE = /\d+(?:[.,]\d+)?\s*(?:ml|g|kg|l|litres?)\b|\/\s*(?:l\b|1,000)|\bmax\s*\d/i;

/** Every word of every active ingredient in the rules, e.g. spinosad, copper, neem. */
const GENERIC = new Set(['farm', 'made', 'extract', 'wettable', 'harzianum', 'benzoate', 'oxychloride', 'hydroxide']);
export const PRODUCT_WORDS = [...new Set((RULES.active_ingredients || [])
  .flatMap((a) => String(a.ai || '').toLowerCase().split(/[^a-z]+/))
  .filter((w) => w.length >= 4 && !GENERIC.has(w)))];
const PRODUCT_RE = PRODUCT_WORDS.length
  ? new RegExp(`\\b(?:${PRODUCT_WORDS.join('|')})`, 'i') : /$^/;

/** Whether a piece of text is treatment detail a hand's card leaves off. */
export function isTreatmentText(text) {
  const t = String(text || '');
  return TREATMENT_RE.test(t) || DOSE_RE.test(t) || PRODUCT_RE.test(t);
}

/**
 * Taking plants or parts of plants out — roguing, removing, discarding. The
 * Field Supervisor or the Farm Manager decides that, so a hand's card leaves
 * it off along with the treatment. It is a separate test from
 * isTreatmentText because it is about who decides, not about products.
 */
// A bare "weeds" in the rules is the tail of a removal list ("remove infested
// lower leaves; weeds"), so it goes with it.
const REMOVAL_RE = /\brogu|\bremov|\bdiscard|^\s*weeds?\s*$/i;
export const isRemovalText = (text) => REMOVAL_RE.test(String(text || ''));

/** The clauses of a rules sentence a hand may read, in order, each once. */
export function handSafe(...texts) {
  const out = [];
  for (const text of texts) {
    for (const raw of String(text || '').split(';')) {
      const clause = raw.trim().replace(/\.$/, '');
      if (!clause || isTreatmentText(clause) || isRemovalText(clause)) continue;
      const tidy = clause[0].toUpperCase() + clause.slice(1);
      if (!out.some((x) => x.toLowerCase() === tidy.toLowerCase())) out.push(tidy);
    }
  }
  return out;
}

// --- One card, the hand's way ---------------------------------------------

/** The rules' scouting threshold for a pest card, if it has one. */
function thresholdFor(card) {
  const words = card.id.split('_');
  const hit = (RULES.thresholds || []).find((t) => {
    const pest = String(t.pest || '').toLowerCase();
    return words.every((w) => pest.includes(w)) || pest.includes(card.id.replace(/_/g, ' '));
  });
  if (!hit) return [];
  // The trigger and the watch are counts. The action is the spray, and stays off.
  return [
    hit.trigger ? `Tell the supervisor when you find: ${hit.trigger}` : '',
    hit.watch ? `Keep watching: ${String(hit.watch).replace(/->/g, '→')}` : '',
  ].filter((x) => x && !isTreatmentText(x));
}

/** What every hand's card ends on: report it, and leave the spray to others. */
export const REPORT_STEP = 'Report it: Report a sick plant on My work, with a photo. '
  + 'The Field Supervisor or the Farm Manager decides any spray or treatment.';

/**
 * The hand's card — FR-LEARN-02.
 *
 * `recognise`: the card's detection and each triage row's description, with
 * the reference photo for the card and for each row where one has been added.
 * `catchEarly`: the prevention clauses a hand can act on and, for a pest, the
 * count at which to tell the supervisor. `lookalikes`: what it is confused
 * with and the check that tells them apart. `firstSteps`: the rules' first
 * actions with every treatment clause removed, ending on the report.
 */
export function learnCard(state, cardId) {
  const card = CARD_BY_ID[cardId];
  if (!card) return null;
  const rows = rowsForCard(card.id);
  return {
    id: card.id,
    name: card.name,
    category: card.category,
    drafted: card.status || '',
    photo: cardPhoto(state, card.id),
    recognise: {
      detection: card.detection,
      signs: rows.map((r) => ({ n: r.n, see: r.see, photo: rowPhoto(state, r.n) })),
      checks: handSafe(...rows.map((r) => r.confirm)),
    },
    catchEarly: [...thresholdFor(card), ...handSafe(card.prevention)],
    lookalikes: lookalikesFor(card.id).map((l) => {
      const sep = separatingSymptom(card.id, l.cardId);
      return {
        cardId: l.cardId,
        name: l.card.name,
        category: l.card.category,
        photo: cardPhoto(state, l.cardId),
        tellApart: sep && !isTreatmentText(sep.test)
          ? { test: sep.test, pointsTo: sep.points_to.name } : null,
      };
    }),
    firstSteps: [...handSafe(...rows.map((r) => r.firstAction)), REPORT_STEP],
  };
}

// --- Browsing -------------------------------------------------------------

/** The words a hand can see on a card: what the offline search looks through. */
function handText(card) {
  const rows = rowsForCard(card.id);
  return [card.id.replace(/_/g, ' '), card.name, card.category, card.detection,
    ...rows.map((r) => r.see), ...handSafe(card.prevention, ...rows.map((r) => r.confirm))]
    .join(' ').toLowerCase();
}
const HAND_TEXT = new Map(CARDS.map((c) => [c.id, handText(c)]));

/**
 * Search the cards by what a hand would type — FR-LEARN-03. Every word must
 * appear somewhere on the hand's card, in any order, so "yellow leaf" finds a
 * card that says "leaves ... yellow". Offline: nothing here leaves the phone.
 */
export function learnSearch(query, { category = '' } = {}) {
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
  return CARDS
    .filter((c) => !category || c.category === category)
    .filter((c) => words.every((w) => HAND_TEXT.get(c.id).includes(w)));
}

/** The kinds of card, with a word a hand would use for each. */
export const LEARN_KINDS = [
  { id: 'pest', label: 'Insects and mites', pic: '🐛' },
  { id: 'disease', label: 'Diseases', pic: '🍄' },
  { id: 'virus', label: 'Viruses', pic: '🦠' },
  { id: 'disorder', label: 'Feeding and weather', pic: '🌡️' },
  { id: 'soil', label: 'Soil and roots', pic: '🟫' },
].filter((k) => CARDS.some((c) => c.category === k.id));
