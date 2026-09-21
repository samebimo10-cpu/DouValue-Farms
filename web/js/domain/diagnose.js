// The Farm Doctor's diagnosis engine — FR-DIAG-01, FR-DIAG-02, FR-DOC-01, FR-DOC-02.
//
// Everything about a pest, a disease or a disorder in here is READ FROM
// rules/douvalue_rules_rev5_1.json: the 23 triage rows, the 22 diagnosis cards,
// the root read and the Farm Doctor's own limits. No symptom, weight, cause or
// test is written down in this file, so a change to the rules changes the
// diagnosis without anybody touching code. What this file holds is the method:
//
//   symptom  ->  matching triage rows  ->  card  ->  confirm test
//
// and the rule that gives the method its point (FR-DOC-01): the Farm Doctor
// asks for photos and the confirm step BEFORE it names a cause. Season 1 was
// lost partly to "treatment by guesswork"; naming a cause off a glance is how
// guesswork gets a name and a spray.
//
// The matching itself is deliberately plain text-matching against the rules'
// own wording, weighted by how much a word narrows the 23 rows down. Two
// things make it work on real field words:
//
//   * Negation. "NO galls" in row 23 is the whole difference between acid soil
//     and nematode. A worker who types "no galls" must be pushed towards acid
//     soil and away from nematode, not merely fail to match "galls".
//   * Contradiction. A word one row asserts and another denies is not noise:
//     it is the separating test, and the engine reports it as one.
//
// riskForecast() at the foot of the file is the other half of the clinic — the
// standing weather-and-stage risk board — and still reads the local field guide
// in pests.js, which carries the product, PHI and weather data the rules do not.

import { RULES, RULES_VERSION } from './rules.js';
import { PROBLEMS, PROBLEM_BY_ID } from './pests.js';
import { wetnessIndex, drynessIndex, waterloggingIndex } from './climate.js';
import { clamp } from '../util.js';

export { RULES_VERSION };

// --- Reading the rules' prose ---------------------------------------------

const NEGATORS = new Set(['no', 'not', 'without', 'never', 'none', 'nothing', 'nor']);

/** Words that appear everywhere and narrow nothing. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'with', 'at', 'by', 'for', 'from',
  'then', 'that', 'than', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'these',
  'those', 'but', 'also', 'still', 'over', 'under', 'per', 'if', 'any', 'all', 'one', 'two',
  'three', 'into', 'out', 'up', 'down', 'when', 'while', 'after', 'before', 'very', 'more',
  'most', 'less', 'only', 'same', 'other', 'others', 'each', 'every', 'look', 'looks', 'like',
  'can', 'cannot', 'has', 'have', 'been', 'may', 'will', 'there', 'their', 'they', 'you', 'your',
]);

/**
 * Crude English plural folding, enough to make "galls" and "gall", "leaves"
 * and "leaf" the same word. Anything cleverer would need a dictionary, and a
 * dictionary is a second source of truth.
 */
function stem(word) {
  if (word.length > 4 && word.endsWith('ves')) return `${word.slice(0, -3)}f`;
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Negation runs to the end of its clause and no further. */
function clausesOf(text) { return String(text == null ? '' : text).split(/[;,:.!?()]+/); }

/**
 * Text -> Map(term -> net polarity). A positive count means the text asserts
 * the sign; a negative count means it denies it ("no insect visible").
 */
export function termsOf(text) {
  const out = new Map();
  for (const clause of clausesOf(text)) {
    let negated = false;
    for (const raw of clause.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw) continue;
      if (NEGATORS.has(raw)) { negated = true; continue; }
      if (raw.length < 3 || STOP.has(raw)) continue;
      const term = stem(raw);
      out.set(term, (out.get(term) || 0) + (negated ? -1 : 1));
    }
  }
  return out;
}

const polarity = (n) => (n < 0 ? -1 : 1);

/** Inverse document frequency over a corpus of term maps: rare words carry more. */
function idfIndex(corpus) {
  const df = new Map();
  for (const terms of corpus) for (const t of terms.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = corpus.length;
  const out = new Map();
  for (const [t, count] of df) out.set(t, Math.log(1 + n / count));
  return out;
}

// --- The cards ------------------------------------------------------------

const segmentsOf = (id) => new Set(String(id).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const subset = (a, b) => [...a].every((x) => b.has(x));

/** "root_knot_nematode" -> "Root knot nematode". The rules give ids, not names. */
function nameFromId(id) {
  const words = String(id).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const RAW_CARDS = RULES.diagnosis_cards;
const CARD_SEGMENTS = new Map(RAW_CARDS.map((c) => [c.id, segmentsOf(c.id)]));

/**
 * Which card a triage row's `likely` names.
 *
 * Twenty-one of the 23 rows name a card id outright. The other two are
 * sunscald and fruit_cracking, which the rules fold into one `sunscald_cracking`
 * card — so a row also matches a card that shares a word with it, as long as
 * exactly one card does. That is why 23 rows reach 22 cards.
 */
function cardIdFor(likely) {
  const key = String(likely || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!key) return null;
  if (CARD_SEGMENTS.has(key)) return key;
  const want = segmentsOf(key);
  let best = 0;
  let hits = [];
  for (const [id, have] of CARD_SEGMENTS) {
    let overlap = 0;
    for (const s of want) if (have.has(s)) overlap += 1;
    if (overlap > best) { best = overlap; hits = [id]; } else if (overlap === best && overlap > 0) hits.push(id);
  }
  return best > 0 && hits.length === 1 ? hits[0] : null;
}

// --- The triage table -----------------------------------------------------

const cardsById = new Map();
for (const raw of RAW_CARDS) {
  cardsById.set(raw.id, {
    ...raw,
    name: nameFromId(raw.id),
    rows: [],          // filled in below
    confirmTests: [],
    firstActions: [],
  });
}

/** The 23 rows, each carrying the card it reaches and the words it is made of. */
export const TRIAGE = RULES.triage.map((raw) => {
  const cardId = cardIdFor(raw.likely);
  const card = cardId ? cardsById.get(cardId) : null;
  const signText = [raw.see, card && card.detection, card && card.cause].filter(Boolean).join('; ');
  const row = {
    n: raw.n,
    see: raw.see,
    likely: raw.likely,
    confirm: raw.confirm,
    firstAction: raw.first_action,
    cardId,
    cues: clausesOf(raw.see).map((c) => c.trim()).filter(Boolean),
    signs: termsOf(signText),
    confirmTerms: termsOf(raw.confirm),
  };
  if (card) {
    card.rows.push(row.n);
    if (!card.confirmTests.includes(raw.confirm)) card.confirmTests.push(raw.confirm);
    if (!card.firstActions.includes(raw.first_action)) card.firstActions.push(raw.first_action);
  }
  return row;
});

export const TRIAGE_BY_N = new Map(TRIAGE.map((r) => [r.n, r]));

/** The 22 cards, each knowing which triage rows reach it. */
export const CARDS = [...cardsById.values()];
export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** The card categories the rules actually use: pest, disease, virus, disorder, soil. */
export const CARD_CATEGORIES = [...new Set(CARDS.map((c) => c.category))].sort();

/** The names the triage table uses for a card, e.g. "sunscald" -> sunscald_cracking. */
const LIKELY_TO_CARD = new Map(TRIAGE.filter((r) => r.cardId).map((r) => [r.likely, r.cardId]));

/**
 * A card, from a card id, a triage row, a triage `likely` name, or an old
 * field-guide problem id. Deliberately strict about the last one: it goes
 * through LEGACY_CARD_MAP, which only maps where the match is clear, so
 * "cercospora_leaf_spot" resolves to nothing rather than to the nearest card
 * that happens to share the word "spot".
 */
export const cardFor = (idOrRow) => {
  if (!idOrRow) return null;
  if (typeof idOrRow === 'object') return idOrRow.cardId ? CARD_BY_ID[idOrRow.cardId] || null : idOrRow;
  return CARD_BY_ID[idOrRow]
    || CARD_BY_ID[LIKELY_TO_CARD.get(idOrRow)]
    || CARD_BY_ID[LEGACY_CARD_MAP[idOrRow]]
    || null;
};

export const rowsForCard = (cardId) => TRIAGE.filter((r) => r.cardId === cardId);

const SIGN_IDF = idfIndex(TRIAGE.map((r) => r.signs));
const CONFIRM_IDF = idfIndex(TRIAGE.map((r) => r.confirmTerms));
const signWeight = (t) => SIGN_IDF.get(t) || 0;
const confirmWeight = (t) => CONFIRM_IDF.get(t) || 0;
const signMass = (row) => [...row.signs.keys()].reduce((a, t) => a + signWeight(t), 0);

/** Every distinct observable phrase in the rules, for the tick-list in the wizard. */
export const CUES = (() => {
  const seen = new Map();
  for (const row of TRIAGE) {
    for (const text of row.cues) {
      const key = text.toLowerCase();
      const hit = seen.get(key) || { id: `cue_${seen.size + 1}`, text, rows: [] };
      if (!hit.rows.includes(row.n)) hit.rows.push(row.n);
      seen.set(key, hit);
    }
  }
  return [...seen.values()];
})();

export const CUE_BY_ID = Object.fromEntries(CUES.map((c) => [c.id, c]));

/** Free text plus ticked cues, as one observation. */
export function observationText(observation) {
  if (!observation) return '';
  if (typeof observation === 'string') return observation;
  if (Array.isArray(observation)) return observation.join('; ');
  const cues = (observation.cues || []).map((id) => (CUE_BY_ID[id] || { text: id }).text);
  return [...cues, observation.text || ''].filter(Boolean).join('; ');
}

// --- Step 1: symptom -> matching triage rows ------------------------------

/**
 * Score all 23 rows against what the worker says they can see.
 *
 * A word the row asserts and the observation asserts counts for it; a word one
 * of them denies and the other asserts counts against. That single rule is what
 * carries "stunted plants, no galls" past the nematode row (which needs galls)
 * and onto the acid-soil row (which needs their absence).
 */
export function matchTriage(observation, { limit = 6, floor = 0.05 } = {}) {
  const text = observationText(observation);
  const obs = termsOf(text);
  const known = [...obs.entries()].filter(([t]) => SIGN_IDF.has(t));
  const unknown = [...obs.keys()].filter((t) => !SIGN_IDF.has(t));
  const mass = known.reduce((a, [t]) => a + signWeight(t), 0);

  if (!mass) {
    return { observation: text, rows: [], unmatched: unknown, separator: null, asked: obs.size };
  }

  const scored = [];
  for (const row of TRIAGE) {
    let score = 0;
    const matched = [];
    const contradicted = [];
    for (const [term, obsCount] of known) {
      const rowCount = row.signs.get(term);
      if (rowCount === undefined) continue;
      const weight = signWeight(term);
      if (polarity(rowCount) === polarity(obsCount)) {
        score += weight;
        matched.push({ term, denied: polarity(obsCount) < 0 });
      } else {
        score -= weight;
        contradicted.push({ term, rowAsserts: polarity(rowCount) > 0 });
      }
    }
    if (score <= 0) continue;
    scored.push({
      row,
      card: cardFor(row),
      score: clamp(score / mass, 0, 1),
      matched,
      contradicted,
      confidence: confidenceLabel(clamp(score / mass, 0, 1)),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.row.n - b.row.n);
  const rows = scored.filter((r) => r.score >= floor).slice(0, limit);

  return {
    observation: text,
    asked: obs.size,
    rows,
    unmatched: unknown,
    // Two candidates that close together is exactly when the confirm test has
    // to be named rather than guessed between.
    separator: rows.length > 1 && rows[0].score - rows[1].score < 0.3
      ? separatingSymptom(rows[0].card, rows[1].card)
      : null,
  };
}

export function confidenceLabel(score) {
  if (score >= 0.6) return { id: 'high', label: 'High', hint: 'Do the confirm test, then act on it.' };
  if (score >= 0.3) return { id: 'medium', label: 'Medium', hint: 'The confirm test decides this one.' };
  return { id: 'low', label: 'Low', hint: 'Not enough to name a cause. Look again, and send a sample.' };
}

// --- Look-alikes and the test that separates them (FR-DOC-02) -------------

function rowSimilarity(a, b) {
  let shared = 0;
  let contra = 0;
  const contradictions = [];
  for (const [term, ca] of a.signs) {
    const cb = b.signs.get(term);
    if (cb === undefined) continue;
    const weight = signWeight(term);
    if (polarity(ca) === polarity(cb)) shared += weight;
    else { contra += weight; contradictions.push({ term, asserts: polarity(ca) > 0 ? a.n : b.n }); }
  }
  const mass = Math.sqrt(Math.max(signMass(a), 0.001) * Math.max(signMass(b), 0.001));
  return { score: (shared + contra) / mass, shared: shared / mass, contra: contra / mass, contradictions };
}

/**
 * Cards that look like this one in the field.
 *
 * Derived, not listed: two rows are look-alikes when they are built out of the
 * same words. A word they disagree about — galls, or a visible insect — raises
 * the score rather than lowering it, because that disagreement is the thing a
 * person has to go and settle.
 */
export function lookalikesFor(cardId, { limit = 4, floor = 0.06, ratio = 0.5 } = {}) {
  const card = cardFor(cardId);
  if (!card) return [];
  const mine = rowsForCard(card.id);
  const out = new Map();
  for (const row of mine) {
    for (const other of TRIAGE) {
      if (other.cardId === card.id || !other.cardId) continue;
      const sim = rowSimilarity(row, other);
      const prev = out.get(other.cardId);
      if (!prev || prev.score < sim.score) {
        out.set(other.cardId, { cardId: other.cardId, card: cardFor(other), row: other, ...sim });
      }
    }
  }
  const ranked = [...out.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  // Relative as well as absolute: how alike two rows can look depends on how
  // much the rules wrote about them, so a card with one strong look-alike must
  // not also list four distant ones just because its own wording is long.
  const cut = Math.max(floor, ratio * ranked[0].score);
  return ranked.filter((x) => x.score >= cut).slice(0, limit);
}

// --- The root read --------------------------------------------------------

/**
 * The rules carry one named differential of their own: pull a plant and read
 * the roots. Its four readings are plain words ("nematode", "acid soil"), so
 * each is matched to a card whose id is made of those same words — and only
 * where that is unambiguous, and only among the categories a root read can
 * reach. "rot" and "water only" resolve to no card and stay as the rules wrote
 * them, rather than being forced onto the nearest id that happens to contain
 * the word "rot".
 */
const ROOT_CATEGORIES = new Set(['soil', 'disease']);

function cardForReading(reading) {
  const want = segmentsOf(reading);
  if (!want.size) return null;
  const hits = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (!ROOT_CATEGORIES.has(CARD_BY_ID[id].category)) continue;
    if (subset(want, have)) hits.push(id);
  }
  return hits.length === 1 ? hits[0] : null;
}

export const ROOT_READ = (() => {
  const raw = RULES.root_read || {};
  const readings = Object.entries(raw)
    .filter(([sign]) => sign !== 'when')
    .map(([sign, reading]) => ({ sign, reading, cardId: cardForReading(reading) }));
  return {
    when: raw.when || '',
    test: 'Pull a plant and read the roots',
    readings,
    cardIds: readings.map((r) => r.cardId).filter(Boolean),
  };
})();

const rootReadCovers = (cardId) => ROOT_READ.cardIds.includes(cardId);

// --- separatingSymptom ----------------------------------------------------

/**
 * How much a confirm test tells you that the OTHER candidate does not already
 * show. The sharper test is the one that introduces new observations rather
 * than restating signs both causes share — "cut the stem in clear water and
 * watch for milky threads" against "cut the lower stem and look for a brown
 * ring", where both causes already wilt and both tests already cut a stem.
 */
function testSharpness(row, otherRow) {
  let sharp = 0;
  for (const term of row.confirmTerms.keys()) {
    if (otherRow.signs.has(term) || otherRow.confirmTerms.has(term)) continue;
    sharp += confirmWeight(term);
  }
  return sharp;
}

function bestRowFor(cardId, against) {
  const rows = rowsForCard(cardId);
  if (rows.length < 2) return rows[0] || null;
  return rows.slice().sort((a, b) => testSharpness(b, against) - testSharpness(a, against))[0];
}

/**
 * FR-DOC-02 — name the look-alike and the test that tells them apart.
 *
 * Accepts two cards (or card ids, or triage rows), or the `rows` array from
 * matchTriage(), in which case it separates the top two. Every test it returns
 * is a test the rules name: the root read, or a triage row's confirm step.
 */
export function separatingSymptom(a, b) {
  if (Array.isArray(a)) {
    if (a.length < 2) return null;
    return separatingSymptom(a[0].card || a[0].row || a[0], a[1].card || a[1].row || a[1]);
  }
  const cardA = cardFor(a);
  const cardB = cardFor(b);
  if (!cardA || !cardB || cardA.id === cardB.id) return null;

  // 1. The rules' own named differential, where it covers both.
  if (rootReadCovers(cardA.id) && rootReadCovers(cardB.id)) {
    const readingFor = (id) => ROOT_READ.readings.find((r) => r.cardId === id);
    return {
      kind: 'root_read',
      test: ROOT_READ.test,
      source: 'rules root_read',
      when: ROOT_READ.when,
      readings: ROOT_READ.readings,
      discriminator: discriminatorBetween(cardA.id, cardB.id),
      points_to: cardA,
      away_from: cardB,
      tests: [cardA, cardB].map((card) => ({
        test: `${ROOT_READ.test}: ${(readingFor(card.id) || {}).sign || ''}`.trim(),
        from: 'root_read',
        points_to: card,
      })),
    };
  }

  // 2. Otherwise the confirm step on each one's triage row, sharper test first.
  const rowA = bestRowFor(cardA.id, rowsForCard(cardB.id)[0] || TRIAGE[0]);
  const rowB = bestRowFor(cardB.id, rowA || TRIAGE[0]);
  if (!rowA || !rowB) return null;

  const tests = [
    { test: rowA.confirm, from: `triage row ${rowA.n}`, points_to: cardA, sharpness: testSharpness(rowA, rowB) },
    { test: rowB.confirm, from: `triage row ${rowB.n}`, points_to: cardB, sharpness: testSharpness(rowB, rowA) },
  ].sort((x, y) => y.sharpness - x.sharpness);

  return {
    kind: 'confirm_test',
    test: tests[0].test,
    source: tests[0].from,
    points_to: tests[0].points_to,
    away_from: tests[0].points_to.id === cardA.id ? cardB : cardA,
    discriminator: discriminatorBetween(cardA.id, cardB.id),
    tests,
  };
}

/** The single sign one of them asserts and the other denies, if there is one. */
function discriminatorBetween(idA, idB) {
  const rowsA = rowsForCard(idA);
  const rowsB = rowsForCard(idB);
  let best = null;
  for (const ra of rowsA) {
    for (const rb of rowsB) {
      for (const [term, ca] of ra.signs) {
        const cb = rb.signs.get(term);
        if (cb === undefined || polarity(ca) === polarity(cb)) continue;
        const weight = signWeight(term);
        if (!best || weight > best.weight) {
          best = { term, weight, asserted_by: polarity(ca) > 0 ? idA : idB, denied_by: polarity(ca) > 0 ? idB : idA };
        }
      }
    }
  }
  return best;
}

// --- Step 2: the card, but only after photos and the confirm step ---------

/**
 * FR-DOC-01 — the Farm Doctor asks for photos and the confirm step before
 * naming a cause. This is the gate that makes that true rather than advisory:
 * until a draft carries both, nameCause() hands back what is missing instead of
 * a card. FR-DOC-08 adds the second half: it never confirms its own answer.
 */
export function namingGate(draft = {}) {
  const missing = [];
  const row = draft.triageRow != null ? TRIAGE_BY_N.get(Number(draft.triageRow)) : null;
  if (!row) missing.push({ id: 'row', need: 'Pick the triage row that matches what you can see' });
  if (!((draft.photos || []).length)) {
    missing.push({ id: 'photos', need: 'Take at least one photo of the affected plant' });
  }
  if (!String(draft.confirmTest || '').trim()) {
    missing.push({ id: 'confirmTest', need: 'Do the confirm test the row names, and record which test you did' });
  }
  if (!String(draft.confirmResult || '').trim()) {
    missing.push({ id: 'confirmResult', need: 'Say what the confirm test showed' });
  }
  return { ok: missing.length === 0, missing, row };
}

/**
 * symptom -> row -> card -> confirm test, in one call.
 *
 * Returns the card only once the gate above is satisfied. The confirm test and
 * the look-alikes come back either way, because those are what the person has
 * to go and do.
 */
export function nameCause(draft = {}) {
  const gate = namingGate(draft);
  const row = gate.row;
  const card = row ? cardFor(row) : null;
  const lookalikes = card ? lookalikesFor(card.id) : [];
  const out = {
    ok: gate.ok,
    missing: gate.missing,
    row,
    confirmTest: row ? row.confirm : null,
    firstAction: row ? row.firstAction : null,
    lookalikes,
    separator: card && lookalikes.length ? separatingSymptom(card.id, lookalikes[0].cardId) : null,
    labRecommended: card ? labRecommendedFor(card, draft) : false,
    rulesVersion: RULES_VERSION,
  };
  // FR-DOC-01: no cause is named until the photos and the confirm step are in.
  out.card = gate.ok ? card : null;
  return out;
}

/**
 * FR-DOC-09 / FR-DIAG-05 — when the rules say a lab has to settle it.
 * The trigger list is the rules' own `farm_doctor.lab_required_for`, matched by
 * the card's category and id rather than by a list kept here.
 */
export function labRecommendedFor(cardOrId, draft = {}) {
  const card = cardFor(cardOrId);
  if (!card) return false;
  const triggers = (RULES.farm_doctor && RULES.farm_doctor.lab_required_for) || [];
  const haystack = triggers.join(' ; ').toLowerCase();
  const terms = termsOf(haystack);
  const idHit = [...segmentsOf(card.id)].some((s) => terms.has(stem(s)));
  const categoryHit = terms.has(stem(card.category));
  const lowTwice = String(draft.confidence || '').toLowerCase() === 'low' && draft.secondLowConfidence === true;
  return idHit || categoryHit || lowTwice;
}

/** The Farm Doctor's own limits, straight from the rules (FR-DOC-08). */
export const FARM_DOCTOR = RULES.farm_doctor || {};
export const FARM_DOCTOR_NEVER = FARM_DOCTOR.never || [];
export const FARM_DOCTOR_ROLE = FARM_DOCTOR.role || '';

// --- Step 3: who may confirm it (FR-DIAG-02, FR-DIAG-03, FR-DOC-10) -------

/** A diagnosis this engine produced carries its stamp; older ones do not. */
export const isLegacyDiagnosis = (d) => !d || (!d.cardId && !d.engine);

/**
 * The structural half of "no diagnosis is confirmed without the confirm step".
 * store.js and server/core.mjs both enforce this; it lives here so there is one
 * definition of what a finished diagnosis looks like.
 */
export function confirmStepDone(d) {
  if (!d) return false;
  return Boolean(d.cardId)
    && Boolean(String(d.confirmTest || '').trim())
    && Boolean(String(d.confirmResult || '').trim())
    && (d.photos || []).length > 0;
}

/**
 * FR-DIAG-03 — a hand may start a diagnosis; a Field Supervisor or Farm Manager
 * performs the confirm test and confirms it. FR-DOC-08 — the Farm Doctor never
 * confirms its own. And nobody signs off their own work.
 */
export function canConfirm(diagnosis, { by = null, senior = true } = {}) {
  if (!diagnosis) return { ok: false, reason: 'missing', why: 'There is no such diagnosis.' };
  if (isLegacyDiagnosis(diagnosis)) {
    return {
      ok: false,
      reason: 'legacy',
      why: 'This record predates the rules engine, so it has no card and no confirm step behind it.',
      fix: 'Run the guided diagnosis again on the bed, then confirm that one.',
    };
  }
  const gate = namingGate(diagnosis);
  if (!confirmStepDone(diagnosis)) {
    return {
      ok: false,
      reason: 'no-confirm-step',
      why: 'The confirm test and the photos are what turn a match into a diagnosis.',
      missing: gate.missing.length ? gate.missing : [{ id: 'confirmTest', need: 'Record the confirm test and what it showed' }],
    };
  }
  if (by && diagnosis.by && by === diagnosis.by) {
    return { ok: false, reason: 'self', why: 'The person who started a diagnosis does not confirm it.' };
  }
  if (!senior) {
    return { ok: false, reason: 'rank', why: 'Only the Field Supervisor or the Farm Manager confirms a diagnosis.' };
  }
  return { ok: true };
}

// --- Old records ----------------------------------------------------------

/**
 * "Keep existing diagnosis records readable; map them to cards where the match
 * is clear and mark the rest legacy."
 *
 * Clear means derivable, in two passes and no hand-written table:
 *   1. the ids are made of the same words, one inside the other —
 *      phytophthora_blight -> phytophthora, bacterial_leaf_spot ->
 *      bacterial_spot, sunscald -> sunscald_cracking, red_spider_mite ->
 *      spider_mite;
 *   2. failing that, the old entry NAMES the card in its own text and sits in
 *      the same family — "Helicoverpa armigera and Spodoptera species" is the
 *      helicoverpa card; "Cucumber mosaic virus" is the mosaic_virus card.
 *
 * Everything else — Cercospora leaf spot, PVMV, leaf curl, fruit fly, the
 * nutrient shortages — stays legacy and says so. Guessing a card for those
 * would put a wrong cause on a real record, which is worse than leaving it.
 */
const FAMILY = {
  fungal: 'disease', bacterial: 'disease', viral: 'virus', insect: 'pest',
  mite: 'pest', nematode: 'soil', disorder: 'disorder', deficiency: 'disorder',
};

function mapLegacyId(problemId) {
  const legacy = segmentsOf(problemId);
  if (!legacy.size) return null;

  const byWords = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (subset(have, legacy) || subset(legacy, have)) byWords.push(id);
  }
  if (byWords.length === 1) return byWords[0];
  if (byWords.length > 1) return null;

  const problem = PROBLEM_BY_ID[problemId];
  if (!problem) return null;
  const text = termsOf([problem.name, problem.local, problem.cause].filter(Boolean).join('; '));
  const family = FAMILY[problem.type];
  const byName = [];
  for (const [id, have] of CARD_SEGMENTS) {
    if (family && CARD_BY_ID[id].category !== family) continue;
    if ([...have].every((s) => text.has(stem(s)))) byName.push(id);
  }
  return byName.length === 1 ? byName[0] : null;
}

/** problemId (old field-guide id) -> card id, for every old id that maps. */
export const LEGACY_CARD_MAP = Object.freeze(Object.fromEntries(
  PROBLEMS.map((p) => [p.id, mapLegacyId(p.id)]).filter(([, card]) => card),
));

/** card id -> the old field-guide entry behind it, where there is one. */
export const CARD_TO_PROBLEM = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_CARD_MAP).map(([problemId, cardId]) => [cardId, problemId]),
));

/**
 * Read any diagnosis record, old or new, into one shape the screens can show.
 * Old records keep their own wording; they are marked legacy rather than
 * rewritten, because the event log is a record of what people actually did.
 */
export function readDiagnosis(record) {
  if (!record) return null;
  const direct = record.cardId ? CARD_BY_ID[record.cardId] : null;
  const mapped = direct || (record.problemId ? CARD_BY_ID[LEGACY_CARD_MAP[record.problemId]] : null);
  const problem = record.problemId ? PROBLEM_BY_ID[record.problemId] : null;
  const legacy = !record.cardId;
  return {
    ...record,
    card: mapped || null,
    cardId: mapped ? mapped.id : null,
    label: (mapped && mapped.name) || record.problemName || (problem && problem.name) || record.problemId || 'Unnamed',
    legacy,
    // A legacy record that maps cleanly is still a legacy record: nobody did the
    // rules' confirm test on it. The card is shown as "read as", not as fact.
    mapping: legacy ? (mapped ? 'mapped' : 'legacy') : 'rules',
    confirmed: Boolean(record.confirmedBy),
    confirmStep: confirmStepDone(record),
  };
}

// --- Browsing -------------------------------------------------------------

/** Search the 22 cards and the 23 rows by any word in them. */
export function searchCards(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CARDS;
  return CARDS.filter((c) => {
    const rows = rowsForCard(c.id);
    const hay = [c.id, c.name, c.category, c.cause, c.prevention, c.detection, c.treatment,
      ...rows.map((r) => `${r.see} ${r.confirm} ${r.firstAction}`)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** The local field guide, kept for the product, PHI and weather detail. */
export function searchProblems(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return PROBLEMS.filter((p) => {
    const hay = [p.name, p.local, p.cause, p.type, ...(p.confirm || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// --- The risk board -------------------------------------------------------

/**
 * Standing risk board: what the weather and the crop stage make likely right
 * now, before anyone reports anything. This is the early-warning half of the
 * clinic, and it is what lets a manager walk the right house first. It reads
 * the local field guide rather than the rules, because the weather response of
 * each problem is not in the rules JSON.
 */
export function riskForecast(cycles, date = new Date(), observed = null) {
  const byProblem = new Map();
  for (const cyc of cycles) {
    const stage = cyc.stage;
    for (const problem of PROBLEMS) {
      if (problem.crops && !problem.crops.includes(cyc.cropId)) continue;
      if (problem.stages && stage && !problem.stages.includes(stage)) continue;
      const conditions = problem.conditions || {};
      const keys = Object.keys(conditions);
      if (!keys.length) continue;
      const idx = {
        wetness: wetnessIndex(date, observed),
        dryness: drynessIndex(date, observed),
        waterlogging: waterloggingIndex(date, observed),
      };
      let weighted = 0;
      let total = 0;
      for (const k of keys) { weighted += conditions[k] * (idx[k] ?? 0.5); total += conditions[k]; }
      const pressure = total ? weighted / total : 0;
      const risk = clamp(pressure * (0.5 + 0.1 * problem.severity), 0, 1);
      const entry = byProblem.get(problem.id) || {
        problem, risk: 0, beds: [], driver: keys.sort((a, b) => conditions[b] - conditions[a])[0],
        cardId: LEGACY_CARD_MAP[problem.id] || null,
      };
      entry.risk = Math.max(entry.risk, risk);
      entry.beds.push(cyc.label || cyc.id);
      byProblem.set(problem.id, entry);
    }
  }
  return [...byProblem.values()]
    .filter((e) => e.risk >= 0.3)
    .sort((a, b) => b.risk - a.risk);
}

export const RISK_DRIVER_TEXT = {
  wetness: 'wet leaves and rain splash',
  dryness: 'hot dry weather',
  waterlogging: 'water standing in the beds',
};

export { PROBLEM_BY_ID };
