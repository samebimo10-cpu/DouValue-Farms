// The Farm Doctor — requirements §6.14.
//
// There is no agronomist on this site. FR-GATE-00 says so plainly, and this
// file is what stands in that gap for the day-to-day decisions: what is wrong
// with this plant, what would prove it, what may be sprayed on it, what
// evidence a gate is still missing, and whether the last treatment worked.
//
// It advises. People decide. That sentence is the whole design, and the six
// limits in FR-DOC-08 are what keep it true when the advice is convenient:
//
//   * it never clears a gate;
//   * it never confirms its own diagnosis;
//   * it never approves its own plan;
//   * it never names a product outside the catalogue or outside the store,
//     and never a banned one;
//   * it never invents a dose;
//   * it never calls a virus or a bacterial disease confirmed from a photo.
//
// Those are not warnings printed next to an answer. Each one is a function
// that returns a refusal, and each has a test named after it. A limit that
// only appears in the wording of a screen is a limit that a busy week removes.
//
// Everything here is pure and works with the network off (FR-DOC-03,
// FR-ADV-02). The one part that needs a connection is photo review, and its
// answer comes back through normalisePhotoReview() below, which applies the
// same limits to whatever the far end said.

import { addDays, daysBetween, isoDate, round } from '../util.js';
import {
  DEFAULT_REI_HOURS, defaultPhiDays, diagnosisCard, gateSpec, peekRules, rulesVersion,
} from '../rules.js';
// The catalogue and the rotation sequences are read in one place each
// (domain/catalogue.js, domain/rotation.js). The Farm Doctor asks them rather
// than keeping its own reading of the rules, so a group, a rate or a sequence
// means the same thing to the Doctor, to the treatment gate and to the spray
// screen — and changing the rules file changes all three at once.
import {
  buildCatalogue, canUseActive, groupOfSpray as catalogueGroupOfSpray, isBanned, resolveActive,
} from './catalogue.js';
import { rotationVerdict, week10Actives } from './rotation.js';
import { PROBLEM_BY_ID } from './pests.js';
import { latestSoilTest, nematodeGate, phGate } from './gates.js';

/**
 * The catalogue, in the shape the rest of this file reads.
 *
 * domain/catalogue.js calls an active ingredient's name `name`; the Farm
 * Doctor's own records call it `ai`, after the column in the rules file. One
 * adapter here is cheaper than renaming a field across either side, and
 * `organic` is added from the rules' own Week 10 list (SR-08) rather than
 * guessed at from the name.
 */
function catalogueOf(state, rules) {
  if (!rules) return null;
  return buildCatalogue(state || {}, rules);
}

function adapt(active, catalogue, rules) {
  if (!active) return null;
  const allowed = catalogue && rules ? week10Actives(catalogue, rules).actives : [];
  return { ...active, ai: active.name, organic: allowed.some((a) => a.id === active.id) };
}

/** Every active in the catalogue, adapted. */
function actives(state, rules) {
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return [];
  return catalogue.actives.map((a) => adapt(a, catalogue, rules));
}

/** One active, by name, alias, id, or the product id an old spray was logged with. */
function activeFor(name, state, rules) {
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return null;
  return adapt(resolveActive(catalogue, name), catalogue, rules);
}

/** The Farm Doctor is not a person. This id is what every output is signed with. */
export const DOCTOR = { id: 'farm-doctor', name: 'Farm Doctor' };

/** FR-DOC-03 — the three words the app is allowed to use about its own certainty. */
export const CONFIDENCE = {
  high: { id: 'high', label: 'High confidence', rank: 3,
    hint: 'Still do the confirm test before anyone spends money.' },
  medium: { id: 'medium', label: 'Medium confidence', rank: 2,
    hint: 'Do the confirm test. This is a shortlist, not an answer.' },
  low: { id: 'low', label: 'Low confidence', rank: 1,
    hint: 'Not enough to act on. Take better photos or send a sample.' },
};

export function normaliseConfidence(value) {
  const v = String(value || '').toLowerCase().trim();
  return CONFIDENCE[v] ? v : 'low';       // anything unrecognised is treated as low
}

/**
 * FR-DOC-08, as data.
 *
 * Every refusal in this file names one of these, so a screen, a test and the
 * saved record all describe the same limit in the same words.
 */
export const LIMITS = {
  gate: {
    id: 'gate', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never clears a gate.',
    who: 'Gate 0 and Gate 4: the Farm Manager confirms and the Owner approves (FR-GATE-00).',
  },
  diagnosis: {
    id: 'diagnosis', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never confirms its own diagnosis.',
    who: 'The Field Supervisor or Farm Manager does the confirm test and confirms (FR-DIAG-03).',
  },
  plan: {
    id: 'plan', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never approves its own treatment plan.',
    who: 'The Farm Manager approves a plan before it is sprayed.',
  },
  catalogue: {
    id: 'catalogue', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never recommends a product outside the catalogue, outside the store, '
      + 'or on the banned list.',
    who: 'Only the Owner adds an active ingredient to the catalogue, with its group (FR-STOCK-09).',
  },
  dose: {
    id: 'dose', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never invents a dose.',
    who: 'The Farm Manager enters the label rate, PHI and REI before that product can be used '
      + '(FR-STOCK-06, FR-STOCK-08).',
  },
  photo: {
    id: 'photo', requirement: 'FR-DOC-08',
    rule: 'The Farm Doctor never confirms a virus or a bacterial disease from a photo alone.',
    who: 'A lab sample settles it, and the Owner is told (FR-DOC-09, FR-DIAG-05).',
  },
};

/** A refusal. Shaped like every other answer in the app: what, why, and the fix. */
export function refusal(limitId, why, extra = {}) {
  const limit = LIMITS[limitId];
  return {
    ok: false,
    limit: limitId,
    requirement: limit ? limit.requirement : 'FR-DOC-08',
    rule: limit ? limit.rule : '',
    why,
    fix: limit ? limit.who : '',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// FR-DOC-10 — every output is a record
// ---------------------------------------------------------------------------

/**
 * The shape of everything the Farm Doctor says.
 *
 * `read` is the point of it: the list of records the answer was built from, so
 * "show what it looked at" (FR-ADV-03) works for the Doctor as well as for the
 * adviser, and so an answer can be argued with a year later. `confirmedBy` is
 * null at birth and stays null until a person who is allowed to confirm does
 * — which is the whole of FR-DOC-08's second and third limits, expressed as a
 * field nothing in this file can set.
 */
export function doctorOutput({
  id = null, kind, subject = {}, read = [], confidence = null, summary = '',
  findings = [], notifyOwner = false, lab = null, at = null, rules = peekRules(),
} = {}) {
  return {
    id: id || `fd_${kind}_${subject.id || subject.zoneId || subject.cycleId || 'farm'}_${(at || new Date().toISOString()).slice(0, 19)}`,
    kind,
    by: DOCTOR.id,
    at: at || new Date().toISOString(),
    subject,
    read: read.map((r) => ({ kind: r.kind, id: r.id || null, what: r.what || '' })),
    confidence: confidence == null ? null : normaliseConfidence(confidence),
    summary,
    findings,
    notifyOwner: !!notifyOwner,
    lab,
    rulesVersion: rulesVersion(rules),
    // FR-DOC-08, first three limits, in the record itself.
    clears: false,
    confirmedBy: null,
    confirmedAt: null,
    approvedBy: null,
    approvedAt: null,
  };
}

/** Who may confirm or approve what. Ranks mirror web/js/store.js. */
const RANK = { hand: 10, supervisor: 50, agronomist: 60, manager: 80, ceo: 100 };
const rankOf = (person) => (person && RANK[person.role]) || 0;
const isDoctor = (person) => !person || person.id === DOCTOR.id || person.role === 'doctor';

export const CONFIRMS = {
  // FR-DIAG-03 / farm_doctor.confirmation.diagnosis
  diagnosis: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  photo: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  // farm_doctor.confirmation.treatment_plan
  plan: { minRank: RANK.manager, who: 'Farm Manager', limit: 'plan' },
  followup: { minRank: RANK.supervisor, who: 'Field Supervisor or Farm Manager', limit: 'diagnosis' },
  // FR-GATE-00: Farm Manager confirms, Owner approves. Confirming is not clearing.
  'gate-review': { minRank: RANK.manager, who: 'Farm Manager', limit: 'gate', approver: RANK.ceo },
  'cycle-review': { minRank: RANK.manager, who: 'Farm Manager', limit: 'gate', approver: RANK.ceo },
};

/**
 * FR-DOC-08 — a person confirms, and the Farm Doctor is not a person.
 *
 * The refusal is deliberately not a silent no-op. An app that quietly ignored
 * a self-confirmation would leave a record that looks confirmed to whoever
 * reads it next.
 */
export function confirmOutput(output, person, { note = '', at = null } = {}) {
  if (!output || !output.kind) return refusal('diagnosis', 'There is nothing to confirm.');
  const spec = CONFIRMS[output.kind] || CONFIRMS.diagnosis;

  if (isDoctor(person)) {
    return refusal(spec.limit,
      `The Farm Doctor produced this ${labelFor(output.kind)}, so it cannot be the one to confirm it.`);
  }
  if (rankOf(person) < spec.minRank) {
    return refusal(spec.limit,
      `${person.name || 'That account'} is a ${person.role || 'visitor'}, and a ${labelFor(output.kind)} `
      + `is confirmed by the ${spec.who}.`);
  }
  return {
    ok: true,
    output: {
      ...output,
      confirmedBy: person.id,
      confirmedRole: person.role,
      confirmedAt: at || new Date().toISOString(),
      confirmNote: note,
    },
  };
}

/**
 * FR-DOC-08 — the Farm Doctor never approves its own plan, and a plan that has
 * not been approved by the Farm Manager is not sprayable.
 */
export function approvePlan(plan, person, { at = null } = {}) {
  if (!plan) return refusal('plan', 'There is no plan to approve.');
  if (isDoctor(person)) {
    return refusal('plan', 'The Farm Doctor wrote this plan, so it cannot approve it.');
  }
  if (rankOf(person) < RANK.manager) {
    return refusal('plan',
      `${person && person.name ? person.name : 'That account'} is a ${(person && person.role) || 'visitor'}; `
      + 'a treatment plan is approved by the Farm Manager.');
  }
  return { ok: true, plan: { ...plan, approvedBy: person.id, approvedAt: at || new Date().toISOString() } };
}

/**
 * FR-DOC-08 / FR-GATE-00 — a gate is cleared by people, never by this file.
 *
 * The Doctor's gate work produces a review. Clearing needs the Farm Manager's
 * confirmation and the Owner's approval on top of it, and if either is missing
 * the answer is no, however complete the evidence looks.
 */
export function gateClearance(review, { confirmedBy = null, approvedBy = null } = {}) {
  const missing = [];
  if (review && review.missing && review.missing.length) {
    missing.push(`${review.missing.length} piece${review.missing.length === 1 ? '' : 's'} of evidence still missing`);
  }
  if (isDoctor(confirmedBy) || rankOf(confirmedBy) < RANK.manager) missing.push('Farm Manager confirmation');
  if (isDoctor(approvedBy) || rankOf(approvedBy) < RANK.ceo) missing.push('Owner approval');
  if (missing.length) {
    return refusal('gate', `This gate is not cleared: ${missing.join(', ')}.`, { missing });
  }
  return { ok: true, cleared: true, confirmedBy: confirmedBy.id, approvedBy: approvedBy.id };
}

function labelFor(kind) {
  return ({
    diagnosis: 'diagnosis', photo: 'photo review', plan: 'treatment plan',
    'gate-review': 'gate review', 'cycle-review': 'cycle review', followup: 'follow-up check',
  })[kind] || 'finding';
}

// ---------------------------------------------------------------------------
// The catalogue, the store shelf and the dose — FR-DOC-08 limits four and five
// ---------------------------------------------------------------------------

/**
 * What is actually on the shelf for one active ingredient.
 *
 * Stock is kept by the name on the container ("Mancozeb 80% WP"), while the
 * catalogue keeps active ingredients ("Mancozeb"). An item may also carry an
 * explicit `activeId`, which is what the Farm Manager sets when entering a
 * brand label (FR-STOCK-06), and that always wins over name matching.
 */
export function stockOf(state, entry, { today = isoDate() } = {}) {
  if (!entry) return null;
  const items = Object.values((state && state.inputs) || {});
  const named = items.filter((item) => {
    if (item.activeId) return item.activeId === entry.id;
    const hay = String(item.name || '').toLowerCase();
    return entry.aliases.some((alias) => {
      const a = String(alias).toLowerCase();
      return a.length > 3 && hay.includes(a);
    });
  });
  if (!named.length) return null;

  // FR-STOCK-04: an expired container is not stock.
  const usable = named.filter((item) => !item.expiry || item.expiry >= today);
  const qty = usable.reduce((n, item) => n + (Number(item.qty) || 0), 0);
  return {
    item: usable[0] || named[0],
    qty,
    expiredOnly: !usable.length,
    unit: (usable[0] || named[0]).unit || '',
  };
}

/**
 * Turn a rate written for people into numbers.
 *
 * The rules write rates the way a label does — "2.5 g/L (80WP)", "150 ml
 * cold-pressed oil + 30 ml soap / 16 L" — and two of the twenty entries say
 * "per label" or "see prep table", which is the catalogue being honest that it
 * does not hold a number. Those must not parse. A rate this function cannot
 * read is a product the Farm Doctor will not dose (FR-DOC-08).
 */
export function parseRate(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const formulation = (/\((\d+\s*(?:EC|SC|WP|WG|SL|SP|WDG|WSG)[^)]*)\)/i.exec(s) || [])[1] || null;

  const perLitre = /(\d+(?:\.\d+)?)\s*(ml|g)\s*\/\s*(?:1\s*)?L\b/i.exec(s);
  if (perLitre) {
    return {
      value: Number(perLitre[1]), unit: perLitre[2].toLowerCase(), perLitres: 1,
      formulation, text: s,
    };
  }

  const perTank = /(\d+(?:\.\d+)?)\s*(ml|g)\b[^/;]*\/\s*(\d+(?:\.\d+)?)\s*L\b/i.exec(s);
  if (perTank) {
    return {
      value: Number(perTank[1]), unit: perTank[2].toLowerCase(), perLitres: Number(perTank[3]),
      formulation, text: s,
    };
  }

  return null;     // "per label", "see prep table", anything else a person wrote
}

/** The knapsack and the two tanks a spray is actually mixed in (FR-DOC-05). */
export const TANKS = [16, 500, 1000];

/**
 * FR-DOC-05 dose calculator, and FR-DOC-08's fifth limit.
 *
 * A dose comes from the schedule rate for that active, or from a label rate
 * the Farm Manager has entered. Where neither exists the answer is a refusal,
 * not an estimate: an invented dose is either a wasted spray or a residue
 * failure, and both are worse than "enter the label first".
 */
export function doseFor(entry, { labelRate = null, tanks = TANKS } = {}) {
  if (!entry) return refusal('catalogue', 'That product is not in the catalogue.');

  const fromLabel = parseRate(labelRate);
  const fromSchedule = parseRate(entry.scheduleRate);
  const rate = fromLabel || fromSchedule;
  const source = fromLabel ? 'label entered by the Farm Manager' : 'schedule rate in the rules';

  if (!rate) {
    return refusal('dose',
      `${entry.ai} has no usable rate: the rules give ${entry.scheduleRate ? `"${entry.scheduleRate}"` : 'none'}`
      + `${labelRate ? ` and the entered label says "${labelRate}"` : ' and no label has been entered'}.`);
  }

  const perLitre = rate.value / rate.perLitres;
  return {
    ok: true,
    rate,
    source,
    perLitre: round(perLitre, 3),
    unit: rate.unit,
    amounts: tanks.map((volumeL) => {
      const amount = perLitre * volumeL;
      return {
        volumeL,
        amount: round(amount, amount >= 10 ? 0 : 2),
        unit: rate.unit,
        text: `${round(amount, amount >= 10 ? 0 : 2)} ${rate.unit} in ${volumeL} L`,
      };
    }),
  };
}

/**
 * Which catalogue actives a piece of rules text names.
 *
 * The rules say what to reach for in prose — "Abamectin or wettable sulphur on
 * tips", "Spinosad IRAC 5 preferred". Reading those names back out of the same
 * file keeps the Farm Doctor's shortlist tied to the rules rather than to a
 * second list in the app that could drift away from them.
 */
export function activesNamedIn(text, rules = peekRules(), state = null) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return [];
  return actives(state, rules).filter((entry) => (entry.aliases || []).some((alias) => {
    const a = String(alias).toLowerCase();
    return a.length > 3 && hay.includes(a);
  }));
}

/**
 * The rules' diagnosis card for one of the app's guide entries.
 *
 * The guide in web/js/domain/pests.js is wider than the 22 cards, so some
 * problems have no card. Where there is none the Farm Doctor has no rules text
 * to read a product out of, and says so rather than reaching for the guide's
 * own chemical list — the rules are the source of truth for what may be
 * sprayed here.
 */
export const CARD_FOR_PROBLEM = {
  thrips: 'thrips',
  broad_mite: 'broad_mite',
  whitefly: 'whitefly',
  aphids: 'aphids',
  red_spider_mite: 'spider_mite',
  fruit_borer: 'helicoverpa',
  root_knot_nematode: 'root_knot_nematode',
  phytophthora_blight: 'phytophthora',
  fusarium_wilt: 'fusarium_wilt',
  bacterial_wilt: 'bacterial_wilt',
  anthracnose: 'anthracnose',
  powdery_mildew: 'powdery_mildew',
  damping_off: 'damping_off',
  bacterial_leaf_spot: 'bacterial_spot',
  blossom_end_rot: 'blossom_end_rot',
  acid_soil: 'acid_soil',
  pvmv: 'mosaic_virus',
  cmv: 'mosaic_virus',
  leaf_curl_virus: 'mosaic_virus',
};

export function cardForProblem(problemId, rules = peekRules()) {
  const id = CARD_FOR_PROBLEM[problemId] || problemId;
  return diagnosisCard(id, rules);
}

/** Week of the cycle, counted the rules' way: T is day 1 of Week 0. */
export function weekOf(cycle, date = isoDate()) {
  if (!cycle || !cycle.transplantDate) return null;
  const dat = daysBetween(cycle.transplantDate, date);
  if (dat < 0) return null;
  return Math.floor(dat / 7);
}

/**
 * The group a past spray belongs to.
 *
 * The farm's history predates the catalogue, so a spray may name a brand, an
 * old product id or nothing useful at all. domain/catalogue.js knows how to
 * read all three, and this is the Doctor asking it rather than guessing.
 */
function groupOfSpray(spray, rules = peekRules(), state = null) {
  if (!spray || !rules) return null;
  const catalogue = catalogueOf(state, rules);
  if (!catalogue) return null;
  return catalogueGroupOfSpray(catalogue, spray) || spray.group || null;
}

/** A block that is not one of the FR-DOC-08 limits but a rule in its own right. */
function block(code, requirement, why, fix, extra = {}) {
  return { ok: false, limit: null, code, requirement, why, fix, ...extra };
}

/**
 * FR-DOC-04 — a plan that already passes every rule, checked one rule at a time.
 *
 * The order matters. Catalogue, store and dose come first because they are the
 * FR-DOC-08 limits: a product the farm cannot legally or physically use is not
 * improved by having good rotation. Everything after them is the agronomy that
 * makes a legal spray a sensible one.
 */
export function checkPlan(state, plan = {}, { today = isoDate(), rules = peekRules() } = {}) {
  const violations = [];
  const cycle = plan.cycleId ? ((state && state.cycles) || {})[plan.cycleId] : null;
  const name = plan.active || plan.activeId || plan.productName || '';

  if (!rules) {
    violations.push(refusal('catalogue',
      'The rules file has not loaded on this phone, so the catalogue cannot be checked.',
      { fix: 'Open the app once with a connection. Until then the Farm Doctor will not name a product.' }));
    return { ok: false, entry: null, dose: null, violations };
  }

  // FR-DOC-08 / FR-STOCK-09 — banned, whatever else is true of it.
  if (isBanned(name, rules)) {
    return {
      ok: false, entry: null, dose: null,
      violations: [refusal('catalogue', `${name} is on the banned list and can never be used on this farm.`)],
    };
  }

  const entry = activeFor(name, state, rules);
  if (!entry) {
    return {
      ok: false, entry: null, dose: null,
      violations: [refusal('catalogue',
        `${name || 'That product'} is not an active ingredient in the catalogue.`)],
    };
  }

  // product_rule: no IRAC/FRAC group on file, no treatment. Farm-made botanicals
  // carry no group by nature, and SR-08 names them for Week 10, so the rule
  // bites on the synthetics it was written for.
  if ((!entry.group || entry.group === 'none') && !entry.organic) {
    violations.push(block('no-group', 'rules.product_rule',
      `${entry.ai} has no IRAC or FRAC group on file.`,
      'The Owner adds the group to the catalogue entry before this can be selected.'));
  }

  const stock = stockOf(state, entry, { today });
  if (!stock || stock.qty <= 0) {
    violations.push(refusal('catalogue',
      stock && stock.expiredOnly
        ? `The only ${entry.ai} in the store is past its expiry date.`
        : `There is no ${entry.ai} in the store.`,
      { fix: 'Buy it in and receive it into stock, or pick something already on the shelf.' }));
  }

  const dose = doseFor(entry, { labelRate: plan.labelRate });
  if (!dose.ok) violations.push(dose);

  // FR-GATE-04 / Gate 3 — diagnosed before treated.
  if (plan.cycleId) {
    const diagnosed = treatableDiagnosis(state, plan.cycleId, { today });
    if (!diagnosed.ok) {
      violations.push(block('gate-3', 'FR-GATE-04', diagnosed.why, diagnosed.fix));
    }
  }

  // FR-GATE-05, SR-08, the thrips programme and the Metalaxyl-M cadence, all
  // from the rules' own sequences. This is the same verdict the treatment gate
  // and the spray screen get (domain/rotation.js), so there is one answer to
  // "may this go on this zone today?" rather than the Doctor's and the gate's.
  //
  // Two of its refusals are FR-DOC-08 limits rather than agronomy, and keep
  // the limit's name: a product that is not in the catalogue, and one with no
  // dose on file.
  const week = weekOf(cycle, plan.date || today);
  if (plan.cycleId) {
    const rotation = rotationVerdict(state, plan.cycleId, entry.id, {
      rules, today, target: plan.problemId || null, week,
    });
    if (!rotation.ok) {
      if (rotation.reason === 'not-in-catalogue') {
        violations.push(refusal('catalogue', rotation.why, { fix: rotation.fix }));
      } else if (rotation.reason !== 'no-rate') {
        // 'no-rate' is left out deliberately: doseFor() above has already
        // answered it, and answered it better. It reads the schedule rate, a
        // stored label and a rate entered on the plan itself, and refuses in
        // the calculator's own words. Repeating it here would put the same
        // FR-DOC-08 limit in the list twice.
        violations.push(block(rotation.reason || 'rotation', 'FR-GATE-05', rotation.why, rotation.fix,
          { alternatives: rotation.alternatives || [], sources: rotation.sources || [] }));
      }
    }
  }

  // SR-05 — a microbial inoculant is killed by a fungicide it follows too closely.
  const mixing = mixingBlock(state, plan.cycleId, entry, { today });
  if (mixing) violations.push(mixing);

  // SR-01/02/03 — the hour it is going on, when the plan names one.
  const timing = sprayWindowBlock(plan, entry, { rules });
  if (timing) violations.push(timing);

  const phiDays = phiFor(entry, plan, rules);
  const reiHours = reiFor(plan);

  return {
    ok: violations.length === 0,
    entry,
    stock: stock || null,
    dose: dose.ok ? dose : null,
    phiDays,
    reiHours,
    // FR-TREAT-02 — what this spray costs the harvest plan, said before it happens.
    harvestBlockedUntil: isoDate(addDays(plan.date || today, phiDays)),
    week,
    violations,
  };
}

/** FR-GATE-04 read the app's own way: a confirmed diagnosis, recent enough to mean it. */
function treatableDiagnosis(state, cycleId, { today = isoDate(), maxAgeDays = 14 } = {}) {
  const recent = ((state && state.diagnoses) || [])
    .filter((d) => d.cycleId === cycleId)
    .filter((d) => d.date && d.date <= today && daysBetween(d.date, today) <= maxAgeDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!recent.length) {
    return { ok: false, why: 'Nothing has been diagnosed on this bed in the last two weeks.',
      fix: 'Run the Farm Doctor on a sick plant, then have the diagnosis confirmed.' };
  }
  const confirmed = recent.find((d) => d.confirmedBy && d.confirmedBy !== DOCTOR.id);
  if (!confirmed) {
    return { ok: false,
      why: `"${recent[0].problemName || recent[0].problemId}" was diagnosed on ${recent[0].date}, `
        + 'but nobody has confirmed it.',
      fix: 'The Field Supervisor or Farm Manager does the confirm test and confirms it.' };
  }
  return { ok: true, diagnosis: confirmed };
}

/** SR-05: a microbial inoculant never within 48 h of a fungicide, never in the same tank. */
function mixingBlock(state, cycleId, entry, { today = isoDate() } = {}) {
  if (!/biological|trichoderma|bacillus/i.test(`${entry.type} ${entry.ai}`)) return null;
  const recent = ((state && state.sprays) || [])
    .filter((s) => s.cycleId === cycleId && s.date && daysBetween(s.date, today) <= 2)
    .find((s) => /fungicide|mancozeb|copper|metalaxyl|sulphur/i.test(`${s.productName || ''} ${s.kind || ''}`));
  if (!recent) return null;
  return block('mixing', 'rules.spray_rules SR-05',
    `A fungicide went on this bed on ${recent.date}. A microbial inoculant within 48 hours of one is wasted.`,
    'Wait until 48 hours have passed, and never put the two in the same tank.');
}

/** FR-STOCK-07: the default applies unless an entered label is longer. */
function phiFor(entry, plan, rules) {
  const fallback = entry.phiDays != null ? entry.phiDays : defaultPhiDays(rules);
  const label = Number(plan.labelPhiDays);
  if (Number.isFinite(label) && label > fallback) return label;
  return fallback;
}

function reiFor(plan) {
  const label = Number(plan.labelReiHours);
  if (Number.isFinite(label) && label > DEFAULT_REI_HOURS) return label;
  return DEFAULT_REI_HOURS;
}

/**
 * FR-DOC-04 — the plan itself.
 *
 * Every candidate the rules name for this problem, put through checkPlan, and
 * split into what may be sprayed and what may not with the reason attached.
 * The rejected list is not noise: "there is nothing you may use here" is an
 * answer a manager has to act on, and the reasons are what they act on.
 */
export function treatmentPlan(state, {
  problemId, cycleId = null, zoneId = null, diagnosisId = null, today = isoDate(),
  tanks = TANKS, labels = {}, rules = peekRules(),
} = {}) {
  const problem = PROBLEM_BY_ID[problemId] || null;
  const card = cardForProblem(problemId, rules);
  const triage = (rules && rules.triage || []).filter((r) => (CARD_FOR_PROBLEM[problemId] || problemId) === r.likely);

  const text = [
    card && card.treatment, card && card.prevention,
    ...triage.map((r) => r.first_action),
  ].filter(Boolean).join(' ');

  let candidates = activesNamedIn(text, rules);
  // The thrips programme is a rotation of its own, named in the rules.
  if ((CARD_FOR_PROBLEM[problemId] || problemId) === 'thrips' && rules && rules.thrips_program) {
    const options = Object.values(rules.thrips_program.options_by_group || {}).join(', ');
    candidates = [...candidates, ...activesNamedIn(options, rules)];
  }
  const seen = new Set();
  candidates = candidates.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));

  const options = [];
  const rejected = [];
  for (const entry of candidates) {
    const checked = checkPlan(state, {
      active: entry.ai, cycleId, zoneId, problemId, diagnosisId,
      labelRate: labels[entry.id] && labels[entry.id].rate,
      labelPhiDays: labels[entry.id] && labels[entry.id].phiDays,
      labelReiHours: labels[entry.id] && labels[entry.id].reiHours,
      date: today,
    }, { today, rules });
    if (checked.ok) options.push({ ...checked, active: entry, dose: doseFor(entry, { labelRate: labels[entry.id] && labels[entry.id].rate, tanks }) });
    else rejected.push({ active: entry, violations: checked.violations });
  }

  const record = doctorOutput({
    kind: 'plan',
    subject: { problemId, cycleId, zoneId, diagnosisId },
    confidence: options.length ? 'high' : 'low',
    rules,
    read: [
      diagnosisId ? { kind: 'diagnosis', id: diagnosisId, what: 'the confirmed diagnosis' } : null,
      card ? { kind: 'rules-card', id: card.id, what: 'the diagnosis card in the rules' } : null,
      { kind: 'stock', what: `${Object.keys((state && state.inputs) || {}).length} items on the store shelf` },
      { kind: 'sprays', what: `${(((state && state.sprays) || []).filter((s) => s.cycleId === cycleId)).length} sprays already on this bed` },
    ].filter(Boolean),
    summary: options.length
      ? `${options.length} product${options.length === 1 ? '' : 's'} the rules and the store both allow today.`
      : 'Nothing in the catalogue and the store may be sprayed on this today.',
  });

  return {
    ...record,
    problem,
    card,
    options,
    rejected,
    // FR-DOC-08: written by the Farm Doctor, sprayable only once a person approves.
    approvedBy: null,
    readyToSpray: false,
    needsApproval: CONFIRMS.plan.who,
  };
}

// ---------------------------------------------------------------------------
// FR-TREAT-04 — the gear, before the job
// ---------------------------------------------------------------------------
//
// Ported from claude/farm-doctor-planning-calcs. SR-06 sets the floor — mask
// and gloves for any spray, and for hydrated lime goggles, gloves, dust mask,
// long sleeves and a briefing that gets logged. The farm's own spray rules go
// further (sleeves, trousers and boots every time), and the stricter of the
// two is the one that applies.

export const PPE = {
  mask: { id: 'mask', icon: 'mask', label: 'Mask over nose and mouth',
    why: 'The spray drifts back at you the moment the wind shifts.' },
  dust_mask: { id: 'dust_mask', icon: 'mask', label: 'Dust mask',
    why: 'Hydrated lime dust burns the inside of the nose and the lungs.' },
  gloves: { id: 'gloves', icon: 'gloves', label: 'Gloves',
    why: 'Most of what gets into a person gets in through the hands.' },
  goggles: { id: 'goggles', icon: 'goggles', label: 'Goggles',
    why: 'There is no rinsing this back out of an eye in the field.' },
  sleeves: { id: 'sleeves', icon: 'sleeves', label: 'Long sleeves and trousers',
    why: 'Bare arms in a sprayed house carry it home on the skin.' },
  boots: { id: 'boots', icon: 'boots', label: 'Boots',
    why: 'The run-off ends up on the floor you are standing in.' },
};

/** One spray rule, by its id, in the rules' own words. */
export function sprayRule(id, rules = peekRules()) {
  const list = (rules && rules.spray_rules) || [];
  return (list.find((r) => r.id === id) || {}).rule || '';
}

const GARLIC_CHILLI = 'garlic_chilli_extract_farm_made';

/** What must be worn for this job (SR-06, and the farm's standing rules). */
export function ppeFor({ active = null, task = 'spray', rules = peekRules() } = {}) {
  const sr06 = sprayRule('SR-06', rules);

  if (task === 'lime' || (active && active.id === 'hydrated_lime')) {
    return {
      task: 'lime',
      items: [PPE.goggles, PPE.gloves, PPE.dust_mask, PPE.sleeves, PPE.boots],
      briefing: true,
      briefingText: 'Hydrated lime needs a team briefing before anyone opens a bag, '
        + 'and the briefing is logged with who was there.',
      source: 'SR-06',
      rule: sr06,
    };
  }

  const items = [PPE.mask, PPE.gloves, PPE.sleeves, PPE.boots];
  // Goggles for anything that is not a PHI-0 botanical, and for garlic-chilli,
  // which the PHI table marks as an eye and skin irritant in its own right.
  if (!active || !active.organic || active.id === GARLIC_CHILLI) items.splice(2, 0, PPE.goggles);

  return {
    task: 'spray',
    items,
    briefing: false,
    source: 'SR-06',
    rule: sr06,
    extra: active && active.id === GARLIC_CHILLI
      ? 'Garlic-chilli is an eye and skin irritant. Treat it like a chemical, because it is one.'
      : null,
    // SR-07, the step everyone skips.
    after: active && /insecticide/.test(active.type || '') ? sprayRule('SR-07', rules) : null,
  };
}

// ---------------------------------------------------------------------------
// SR-01, SR-02, SR-03 — when a spray may go on
// ---------------------------------------------------------------------------

/**
 * The spray window, ported from claude/farm-doctor-planning-calcs.
 *
 * Midday heat wastes the chemical and burns the crop, wet leaves stop Mancozeb
 * binding, and once the crop is flowering the window closes until 5 PM so the
 * spray does not land on open flowers. All four are rules in the file, so the
 * refusal quotes them rather than restating them.
 */
export function sprayWindowBlock(plan = {}, entry = null, { rules = peekRules() } = {}) {
  const at = plan.at || '';
  if (!rules || !at || at.length <= 10) return null;

  const [h, m] = at.slice(11).split(':').map(Number);
  const clock = h + (m || 0) / 60;
  const pretty = at.slice(11, 16);
  const broken = [];

  // SR-02 tightens SR-01 once the crop is flowering: after 5 PM, not 4.
  const opensAt = plan.flowering ? 17 : 16;
  if (clock < opensAt || clock > 19) {
    broken.push({ why: `${pretty} is outside the spray window.`,
      fix: plan.flowering ? sprayRule('SR-02', rules) : sprayRule('SR-01', rules) });
  }
  if (plan.openFlowers) broken.push({ why: 'The crop has open flowers.', fix: sprayRule('SR-02', rules) });
  if (plan.wind) broken.push({ why: 'There is wind through the nets.', fix: sprayRule('SR-02', rules) });
  if (plan.leavesWet) broken.push({ why: 'The leaves are wet.', fix: sprayRule('SR-03', rules) });
  if (entry && entry.id === 'mancozeb' && plan.dryHoursAhead != null && Number(plan.dryHoursAhead) < 2) {
    broken.push({
      why: `Mancozeb needs 2 dry hours to bind and there ${Number(plan.dryHoursAhead) === 1 ? 'is 1' : `are ${plan.dryHoursAhead}`} ahead.`,
      fix: sprayRule('SR-03', rules),
    });
  }
  if (entry && entry.id === 'spinosad' && clock < 16) {
    broken.push({ why: 'Spinosad breaks down in sunlight.', fix: 'After 4 PM only.' });
  }

  if (!broken.length) return null;
  return block('timing', 'rules.spray_rules SR-01, SR-02, SR-03',
    broken.map((b) => b.why).join(' '), broken.map((b) => b.fix).filter(Boolean).join(' '));
}

// ---------------------------------------------------------------------------
// FR-DOC-03 — photo review online, the guided flow offline
// ---------------------------------------------------------------------------

/** Problems that a picture can suggest but never settle (FR-DOC-08, FR-DOC-09). */
export const PHOTO_CANNOT_CONFIRM = new Set(['viral', 'bacterial']);
export const LAB_TYPES = new Set(['viral', 'bacterial', 'nematode']);

/**
 * What to do with a set of photos.
 *
 * Online, the photos go to the farm's own server, which asks the wider model
 * and returns a reading with a stated confidence. Offline — which on this farm
 * is most of the time — the answer is not "try again later": the guided
 * diagnosis, the calculators and the plan checks all still work, and this says
 * so and points at them.
 */
export function photoReviewRequest({
  photos = [], cycleId = null, zoneId = null, problemShortlist = [], symptoms = [],
  note = '', online = false, today = isoDate(),
} = {}) {
  if (!photos.length) {
    return { ok: false, mode: 'none', why: 'No photos yet.',
      fix: 'Take a close photo of the damage and a second one of the whole plant.' };
  }
  if (!online) {
    return {
      ok: true,
      mode: 'offline',
      why: 'This phone has no connection, so the photos cannot be reviewed yet.',
      fix: 'Work through the guided diagnosis instead — it asks what you can see, names the '
        + 'look-alikes and gives you the test that separates them. The photos are saved and '
        + 'will be reviewed when the phone next has signal.',
      stillWorks: ['Guided diagnosis', 'Dose calculator', 'Lime calculator', 'Plan checks', 'Gate evidence'],
      queuedPhotos: photos.length,
    };
  }
  return {
    ok: true,
    mode: 'online',
    payload: {
      photos, cycleId, zoneId, note, symptoms, date: today,
      shortlist: problemShortlist.map((p) => ({
        id: p.id || p, name: (PROBLEM_BY_ID[p.id || p] || {}).name || String(p.id || p),
      })),
      limits: [LIMITS.photo.rule, LIMITS.catalogue.rule, LIMITS.dose.rule],
    },
  };
}

/**
 * Take whatever came back from the far end and make it obey the limits.
 *
 * This is the important half of photo review. The server prompt asks the model
 * to respect the limits, but asking is not enforcing: the answer arrives here
 * as untrusted data, and what a person finally sees is built from these fields,
 * not from the reply. A reply that says a virus is confirmed lands as a
 * suspicion with a lab sample attached, every time.
 */
export function normalisePhotoReview(raw = {}, {
  state = null, cycleId = null, zoneId = null, photos = [], today = isoDate(), rules = peekRules(),
} = {}) {
  const confidence = normaliseConfidence(raw.confidence);

  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .slice(0, 5)
    .map((c) => {
      const problem = PROBLEM_BY_ID[c.problemId] || null;
      return {
        problemId: problem ? problem.id : null,
        name: problem ? problem.name : String(c.name || c.problemId || 'Unnamed'),
        type: problem ? problem.type : null,
        inGuide: !!problem,
        confidence: normaliseConfidence(c.confidence || confidence),
        why: String(c.why || '').slice(0, 400),
      };
    });

  const top = candidates[0] || null;
  const type = top && top.type;

  // FR-DOC-08 — a photo never confirms a virus or a bacterial disease. Whatever
  // the reply claimed, this is what the record says.
  const photoAlone = !!(type && PHOTO_CANNOT_CONFIRM.has(type));
  const limit = photoAlone ? LIMITS.photo : null;

  // FR-DOC-08 — nor does a photo review get to name a product. Anything it
  // suggested is put through the same catalogue, stock and dose checks as any
  // other plan, and what fails is dropped with its reason kept.
  const suggested = [];
  const dropped = [];
  for (const name of (Array.isArray(raw.actives) ? raw.actives : []).slice(0, 6)) {
    const checked = checkPlan(state || { inputs: {}, sprays: [], diagnoses: [] },
      { active: name, cycleId, date: today }, { today, rules });
    if (checked.ok) suggested.push({ active: checked.entry, dose: checked.dose });
    else dropped.push({ name: String(name), violations: checked.violations });
  }

  const lab = labAdvice(state, {
    problemId: top && top.problemId, type, confidence, cycleId, zoneId, today, rules,
  });

  const card = top && top.problemId ? cardForProblem(top.problemId, rules) : null;
  const confirmTest = [
    card && card.detection,
    ...(top && PROBLEM_BY_ID[top.problemId] ? (PROBLEM_BY_ID[top.problemId].confirm || []) : []),
  ].filter(Boolean);

  const record = doctorOutput({
    kind: 'photo',
    subject: { cycleId, zoneId, problemId: top && top.problemId },
    confidence,
    rules,
    read: [
      { kind: 'photos', what: `${photos.length || raw.photoCount || 0} photo(s) taken in the app` },
      card ? { kind: 'rules-card', id: card.id, what: 'the diagnosis card in the rules' } : null,
      { kind: 'model', what: `photo review, ${CONFIDENCE[confidence].label.toLowerCase()}` },
    ].filter(Boolean),
    summary: top
      ? `Photo review points at ${top.name}, ${CONFIDENCE[confidence].label.toLowerCase()}.`
      : 'The photo review could not name anything.',
    notifyOwner: lab.notifyOwner,
    lab: lab.needed ? lab.sample : null,
  });

  return {
    ...record,
    mode: 'online',
    candidates,
    // Never true. A person confirms, after the confirm test (FR-DIAG-03).
    confirmed: false,
    photoAlone,
    limit: limit ? limit.id : null,
    limitRule: limit ? limit.rule : null,
    confirmTest,
    needsConfirming: CONFIRMS.photo.who,
    suggestedActives: suggested,
    droppedActives: dropped,
    labAdvice: lab,
    text: String(raw.text || '').slice(0, 4000),
  };
}

// ---------------------------------------------------------------------------
// FR-DOC-09 / FR-DIAG-05 — the lab, and telling the Owner
// ---------------------------------------------------------------------------

/**
 * When a sample goes to a lab, and when the Owner hears about it.
 *
 * The four cases are the rules' own (farm_doctor.lab_required_for): a virus,
 * bacterial wilt, nematodes, or the same thing coming back low confidence
 * twice. The last one is the one that matters most in practice — it is the app
 * admitting it has stopped being useful on this problem, which is exactly the
 * point at which Season 1 kept guessing instead.
 */
export function labAdvice(state, {
  problemId = null, type = null, confidence = null, cycleId = null, zoneId = null,
  today = isoDate(), rules = peekRules(),
} = {}) {
  const problem = problemId ? PROBLEM_BY_ID[problemId] : null;
  const kind = type || (problem && problem.type) || null;
  const reasons = [];

  if (kind === 'viral') {
    reasons.push('A virus cannot be told from a photo or a symptom list. Only a lab says which one it is.');
  }
  if (problemId === 'bacterial_wilt' || (kind === 'bacterial' && /wilt/.test(problemId || ''))) {
    reasons.push('Bacterial wilt: if the streaming test is not clear-cut, the lab settles it.');
  } else if (kind === 'bacterial') {
    reasons.push('A bacterial disease is not confirmed from a photo. A sample settles it.');
  }
  if (kind === 'nematode') {
    reasons.push('A nematode assay comes from a lab and cannot be replaced by the app (Gate 0).');
  }

  const lowBefore = countLowConfidence(state, { problemId, cycleId, zoneId });
  const lowNow = normaliseConfidence(confidence) === 'low' ? lowBefore + 1 : lowBefore;
  if (lowNow >= 2) {
    reasons.push(`This is the ${ordinal(lowNow)} low-confidence reading on the same problem. `
      + 'Two is where the app stops guessing and a sample goes off.');
  }

  const needed = reasons.length > 0;
  return {
    needed,
    reasons,
    // farm_doctor.confirmation: virus, bacterial wilt, nematode or low confidence -> Owner told.
    notifyOwner: needed,
    escalation: needed ? 'Owner notified now, not at the next digest.' : null,
    sample: needed ? {
      problemId, cycleId, zoneId,
      requestedOn: today,
      reason: reasons[0],
      // FR-DIAG-05: what a tracked sample has to carry.
      lab: null, sentDate: null, result: null, resultDate: null,
      status: 'recommended',
    } : null,
  };
}

function countLowConfidence(state, { problemId, cycleId, zoneId }) {
  return ((state && state.doctorOutputs) || []).filter((o) => {
    if (o.confidence !== 'low') return false;
    const s = o.subject || {};
    if (problemId && s.problemId && s.problemId !== problemId) return false;
    if (cycleId && s.cycleId && s.cycleId !== cycleId) return false;
    if (zoneId && s.zoneId && s.zoneId !== zoneId) return false;
    return !!(problemId || cycleId || zoneId);
  }).length;
}

const ordinal = (n) => (n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`);

/** FR-DIAG-05 — every sample, with where it went and what came back. */
export function labSamples(state) {
  return [...((state && state.labSamples) || [])]
    .sort((a, b) => ((a.sentDate || a.requestedOn || '') < (b.sentDate || b.requestedOn || '') ? 1 : -1));
}

export function openLabSamples(state) {
  return labSamples(state).filter((s) => !s.result);
}

/** A sample sent and not answered is a hole in the record, not a closed matter. */
export function overdueLabSamples(state, { today = isoDate(), days = 14 } = {}) {
  return openLabSamples(state)
    .filter((s) => s.sentDate && daysBetween(s.sentDate, today) >= days)
    .map((s) => ({ ...s, waitingDays: daysBetween(s.sentDate, today) }));
}

/** FR-DOC-09 — what the Owner is owed, for the digest and the alerts screen. */
export function ownerNotifications(state, { today = isoDate() } = {}) {
  const out = [];
  for (const o of ((state && state.doctorOutputs) || [])) {
    if (!o.notifyOwner || o.ownerSeenAt) continue;
    out.push({
      id: o.id, kind: o.kind, at: o.at, confidence: o.confidence,
      subject: o.subject || {},
      why: o.summary || '',
      lab: o.lab || null,
    });
  }
  for (const s of overdueLabSamples(state, { today })) {
    out.push({
      id: `lab:${s.id}`, kind: 'lab', at: s.sentDate, confidence: null, subject: s,
      why: `Sample sent to ${s.lab || 'the lab'} on ${s.sentDate} — ${s.waitingDays} days with no result.`,
    });
  }
  return out.sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

// ---------------------------------------------------------------------------
// FR-DOC-10 — reading the records back
// ---------------------------------------------------------------------------

export function doctorRecords(state, { kind = null, limit = 50 } = {}) {
  return [...((state && state.doctorOutputs) || [])]
    .filter((o) => !kind || o.kind === kind)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))
    .slice(0, limit);
}

/** Outputs still waiting on a person. This is the Doctor's own to-do list. */
export function awaitingConfirmation(state) {
  return doctorRecords(state, { limit: 200 })
    .filter((o) => !o.confirmedBy)
    .filter((o) => o.kind !== 'followup');
}

// ---------------------------------------------------------------------------
// FR-DOC-06 — what Gates 0, 1 and 4 are still missing
// ---------------------------------------------------------------------------

/**
 * The evidence items, in the order the rules list them.
 *
 * The labels are not written here. They are read out of the gate's own
 * `pass_all` list so that the words on the screen are the words in the rules
 * file; this array only says which id each line is recorded under and how the
 * app can tell, from records it already holds, that the line is satisfied.
 */
const GATE_ITEMS = {
  G0: ['lab_report', 'ph_three_point', 'doctor_check'],
  G1: ['inputs_on_site', 'drip_pressure', 'spacing_pegged', 'traps_installed',
    'sops_live', 'scout_roster', 'route_b_wait', 'seedling_release'],
  G4: ['root_inspection', 'control_audit', 'sops_updated'],
};

/** The latest thing a person recorded against one line of one gate. */
export function recordedEvidence(state, gateId, zoneId, itemId, { cycleId = null } = {}) {
  return [...((state && state.gateEvidence) || [])]
    .filter((e) => e.gate === gateId && e.itemId === itemId)
    .filter((e) => (e.zoneId ? e.zoneId === zoneId : true))
    .filter((e) => (cycleId && e.cycleId ? e.cycleId === cycleId : true))
    .sort((a, b) => ((a.at || a.date || '') < (b.at || b.date || '') ? 1 : -1))[0] || null;
}

function item(id, label, state, extra = {}) {
  return { id, label, state, why: '', fix: '', from: null, ...extra };
}

/** An item satisfied by somebody recording it, with the note they left. */
function fromRecord(id, label, record, missingFix) {
  if (!record) {
    return item(id, label, 'missing', { fix: missingFix });
  }
  return item(id, label, 'have', {
    why: `Recorded ${record.date || (record.at || '').slice(0, 10)}`
      + `${record.note ? ` — ${record.note}` : ''}`,
    from: { kind: 'gate-evidence', id: record.id || null },
  });
}

/**
 * FR-DOC-06 — check the evidence for Gates 0, 1 and 4 and list what is missing.
 *
 * Note what this does not do. It does not return a pass. Gate 0 and Gate 4 are
 * cleared by the Farm Manager's confirmation and the Owner's approval
 * (FR-GATE-00), and this is the check that happens before that, not instead of
 * it. `clears` is false in every branch, and gateClearance() is the only thing
 * that turns evidence into a cleared gate — and only when two people are named.
 */
export function gateEvidence(state, {
  zoneId, cycleId = null, today = isoDate(), rules = peekRules(), gates = ['G0', 'G1', 'G4'],
} = {}) {
  const zone = ((state && state.plots) || {})[zoneId] || null;
  const out = [];

  for (const gateId of gates) {
    const spec = gateSpec(gateId, rules);
    const labels = (spec && spec.pass_all) || [];
    const ids = GATE_ITEMS[gateId] || labels.map((_, i) => `item_${i + 1}`);
    const items = ids.map((id, i) => {
      const label = labels[i] || id.replace(/_/g, ' ');
      return checkGateItem(state, { gateId, itemId: id, label, zoneId, cycleId, today, rules, zone });
    });

    // Gate 4's evidence is a document, and the Doctor drafts it (FR-DOC-07).
    if (gateId === 'G4') {
      const review = ((state && state.doctorOutputs) || [])
        .filter((o) => o.kind === 'cycle-review' && (o.subject || {}).cycleId === cycleId)
        .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
      items.push(review
        ? item('cycle_review', (spec && spec.evidence) || 'Cycle Review document',
          review.confirmedBy ? 'have' : 'missing', {
            why: review.confirmedBy
              ? 'Cycle review drafted and confirmed.'
              : 'A cycle review is drafted but nobody has confirmed it yet.',
            fix: review.confirmedBy ? '' : `The ${CONFIRMS['cycle-review'].who} confirms it, then the Owner approves.`,
            from: { kind: 'doctor-output', id: review.id },
          })
        : item('cycle_review', (spec && spec.evidence) || 'Cycle Review document', 'missing', {
          fix: 'Ask the Farm Doctor to draft the cycle review from this season\'s records.',
        }));
    }

    const missing = items.filter((it) => it.state !== 'have');
    out.push({
      id: gateId,
      name: (spec && spec.name) || gateId,
      when: (spec && spec.when) || '',
      blocksAction: (spec && spec.blocks_action) || null,
      source: (spec && spec.source) || null,
      items,
      missing,
      complete: missing.length === 0,
    });
  }

  const missing = out.flatMap((g) => g.missing.map((m) => ({ gate: g.id, ...m })));

  const record = doctorOutput({
    kind: 'gate-review',
    subject: { zoneId, cycleId, gates },
    confidence: rules ? 'high' : 'low',
    rules,
    read: [
      { kind: 'rules', what: `gates ${gates.join(', ')} in the rules file` },
      { kind: 'soil-tests', what: `${(((state && state.soilTests) || []).filter((t) => t.zoneId === zoneId)).length} soil tests for this zone` },
      { kind: 'gate-evidence', what: `${((state && state.gateEvidence) || []).filter((e) => e.zoneId === zoneId).length} evidence entries recorded` },
      { kind: 'stock', what: `${Object.keys((state && state.inputs) || {}).length} items on the store shelf` },
    ],
    summary: missing.length
      ? `${missing.length} piece${missing.length === 1 ? '' : 's'} of gate evidence missing for `
        + `${(zone && zone.name) || zoneId}.`
      : `Every listed piece of evidence for ${gates.join(', ')} is on file for ${(zone && zone.name) || zoneId}.`,
  });

  return {
    ...record,
    zoneId,
    zone,
    cycleId,
    gates: out,
    missing,
    complete: missing.length === 0,
    // FR-DOC-08, first limit. Checking is not clearing, and this says so in the record.
    clears: false,
    clearedBy: null,
    needsConfirming: CONFIRMS['gate-review'].who,
    needsApproval: 'Owner',
    limitRule: LIMITS.gate.rule,
  };
}

function checkGateItem(state, { gateId, itemId, label, zoneId, cycleId, today, rules, zone }) {
  const recorded = recordedEvidence(state, gateId, zoneId, itemId, { cycleId });

  switch (itemId) {
    // --- Gate 0 -----------------------------------------------------------
    case 'lab_report': {
      const nem = nematodeGate(state, zoneId, { today });
      const test = latestSoilTest(state, zoneId, { today });
      if (nem.state !== 'pass') {
        return item(itemId, label, 'missing', { why: nem.why, fix: nem.fix || 'Send a soil sample for a nematode assay.' });
      }
      // FR-GATE-08: a bag zone's lab report is one per media batch in it.
      if (nem.media) {
        const unnamed = (nem.tests || []).filter((t) => !t.lab);
        if (unnamed.length) {
          return item(itemId, label, 'missing', {
            why: `${unnamed.length} media batch assay${unnamed.length === 1 ? ' does' : 's do'} not name the lab that gave ${unnamed.length === 1 ? 'it' : 'them'}.`,
            fix: 'Record which lab tested each batch, and keep the reports. Gate 0 asks for a lab report, not a note.',
            from: { kind: 'soil-test', id: unnamed[0].id || null },
          });
        }
        return item(itemId, label, 'have', {
          why: nem.tests.map((t) => `${t.lab} returned clear on ${t.date}`).join('; ') + '.',
          from: { kind: 'soil-test', id: (nem.test && nem.test.id) || null },
        });
      }
      if (!(nem.test && nem.test.lab)) {
        return item(itemId, label, 'missing', {
          why: 'A clean nematode result is on file but it does not name the lab that gave it.',
          fix: 'Record which lab tested it, and keep the report. Gate 0 asks for a lab report, not a note.',
          from: { kind: 'soil-test', id: (nem.test && nem.test.id) || null },
        });
      }
      return item(itemId, label, 'have', {
        why: `${nem.test.lab} returned clear on ${nem.test.date}.`,
        from: { kind: 'soil-test', id: nem.test.id || (test && test.id) || null },
      });
    }

    case 'ph_three_point': {
      const ph = phGate(state, zoneId, { today });
      if (ph.state !== 'pass') {
        return item(itemId, label, 'missing', { why: ph.why, fix: ph.fix || 'Record a corrected pH reading.' });
      }
      // FR-GATE-08: the bag gate already insists on three points per batch;
      // what is left to check is a meter photo for every batch.
      if (ph.media) {
        // The soil-test form has no camera, so a meter photo recorded against
        // this line on the evidence card, on or after the newest batch
        // reading, counts for the batches in this zone.
        const newest = (ph.tests || []).map((t) => t.date).sort().pop() || '';
        const shot = recorded && recorded.photo && (recorded.date || (recorded.at || '').slice(0, 10)) >= newest;
        const bare = shot ? [] : (ph.tests || []).filter((t) => !t.photo);
        if (bare.length) {
          return item(itemId, label, 'missing', {
            why: `${bare.length} media batch pH reading${bare.length === 1 ? ' has' : 's have'} no photo of the meter.`,
            fix: 'Photograph the meter reading and attach it to each batch\'s test.',
            from: { kind: 'soil-test', id: bare[0].id || null },
          });
        }
        return item(itemId, label, 'have', {
          why: ph.why + ' Meter photographed.',
          from: { kind: 'soil-test', id: (ph.test && ph.test.id) || null },
        });
      }
      const test = ph.test || {};
      const points = Number(test.points || (Array.isArray(test.readings) ? test.readings.length : 0));
      if (points < 3) {
        return item(itemId, label, 'missing', {
          why: `pH ${test.ph} is on file, but from ${points || 'an unrecorded number of'} sampling point${points === 1 ? '' : 's'}.`,
          fix: 'Gate 0 asks for a three-point test. Take readings at three places in the block and record all three.',
          from: { kind: 'soil-test', id: test.id || null },
        });
      }
      if (!test.photo) {
        return item(itemId, label, 'missing', {
          why: `A three-point reading of ${test.ph} is on file with no photo of the meter.`,
          fix: 'Photograph the meter reading and attach it to the soil test.',
          from: { kind: 'soil-test', id: test.id || null },
        });
      }
      return item(itemId, label, 'have', {
        why: `pH ${test.ph} from ${points} points on ${test.date}, meter photographed.`,
        from: { kind: 'soil-test', id: test.id || null },
      });
    }

    case 'doctor_check': {
      const review = ((state && state.doctorOutputs) || [])
        .filter((o) => o.kind === 'gate-review' && (o.subject || {}).zoneId === zoneId)
        .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0];
      if (!review) {
        return item(itemId, label, 'missing', {
          why: 'No Farm Doctor gate check has been saved for this zone.',
          fix: 'Run this check and save it, then the Farm Manager confirms and the Owner approves.',
        });
      }
      if (!review.confirmedBy) {
        return item(itemId, label, 'missing', {
          why: `A gate check from ${(review.at || '').slice(0, 10)} is on file but nobody has confirmed it.`,
          fix: `The ${CONFIRMS['gate-review'].who} confirms it. The Farm Doctor cannot (${LIMITS.gate.rule})`,
          from: { kind: 'doctor-output', id: review.id },
        });
      }
      if (!review.approvedBy) {
        return item(itemId, label, 'missing', {
          why: 'The gate check is confirmed but the Owner has not approved it.',
          fix: 'FR-GATE-00: the Owner approves Gate 0 and Gate 4.',
          from: { kind: 'doctor-output', id: review.id },
        });
      }
      return item(itemId, label, 'have', {
        why: 'Checked, confirmed by the Farm Manager and approved by the Owner.',
        from: { kind: 'doctor-output', id: review.id },
      });
    }

    // --- Gate 1 -----------------------------------------------------------
    case 'inputs_on_site': {
      // The rules name the thrips programme; "full input list incl. thrips
      // controls" is checkable against the store for exactly that part.
      const options = Object.values(((rules && rules.thrips_program) || {}).options_by_group || {}).join(', ');
      const thripsActives = activesNamedIn(options, rules);
      const held = thripsActives.filter((e) => {
        const s = stockOf(state, e, { today });
        return s && s.qty > 0;
      });
      if (!held.length) {
        return item(itemId, label, 'missing', {
          why: thripsActives.length
            ? `Nothing from the thrips programme is in the store (${thripsActives.map((e) => e.ai).join(', ')}).`
            : 'The store has not been checked against the thrips programme.',
          fix: 'Gate 1 exists because Season 1 met thrips with an empty store. Buy the rotation in before transplant.',
        });
      }
      if (recorded) return fromRecord(itemId, label, recorded, '');
      return item(itemId, label, 'have', {
        why: `Thrips controls in stock: ${held.map((e) => e.ai).join(', ')}.`,
        from: { kind: 'stock', id: null },
      });
    }

    case 'traps_installed': {
      if (!recorded) {
        return item(itemId, label, 'missing', {
          fix: 'Record the trap count for this zone, with a photo. One per 6 m² at plant height.',
        });
      }
      const area = Number(zone && zone.areaM2) || 0;
      const needed = area ? Math.ceil(area / 6) : 0;
      const have = Number(recorded.count) || 0;
      if (needed && have < needed) {
        return item(itemId, label, 'missing', {
          why: `${have} traps recorded for ${area} m². The rules ask for one per 6 m², so ${needed}.`,
          fix: `Put up ${needed - have} more and record the new count.`,
          from: { kind: 'gate-evidence', id: recorded.id || null },
        });
      }
      return fromRecord(itemId, label, recorded, '');
    }

    case 'scout_roster': {
      const positions = Object.values((state && state.positions) || {})
        .filter((p) => !p.retired && (p.primaryZoneId === zoneId || p.backupZoneId === zoneId));
      if (positions.length) {
        return item(itemId, label, 'have', {
          why: `${positions.length} position${positions.length === 1 ? '' : 's'} cover this zone, primary and backup.`,
          from: { kind: 'position', id: positions[0].id },
        });
      }
      return fromRecord(itemId, label, recorded,
        'FR-ROLE-01: give this zone a primary and a backup position, so scouting has an owner when somebody is away.');
    }

    case 'route_b_wait': {
      const route = (zone && zone.limeRoute) || (recorded && recorded.route) || null;
      if (route && String(route).toUpperCase() !== 'B') {
        return item(itemId, label, 'have', { why: `This block is Route ${route}, so the hydrated-lime wait does not apply.` });
      }
      const limed = recorded && (recorded.date || recorded.limeDate);
      if (!limed) {
        return item(itemId, label, route ? 'missing' : 'missing', {
          why: route ? 'This is a Route B block and the hydrated-lime date is not recorded.'
            : 'Neither the lime route nor a hydrated-lime date is recorded for this block.',
          fix: 'Record which route was used and, for Route B, the day the hydrated lime went on.',
        });
      }
      const waited = daysBetween(limed, today);
      if (waited < 14) {
        return item(itemId, label, 'missing', {
          why: `Hydrated lime went on ${limed}, ${waited} day${waited === 1 ? '' : 's'} ago.`,
          fix: `Route B blocks wait 14 days. Earliest transplant is ${isoDate(addDays(limed, 14))}.`,
          from: { kind: 'gate-evidence', id: recorded.id || null },
        });
      }
      return item(itemId, label, 'have', { why: `Hydrated lime ${limed}, ${waited} days ago.` });
    }

    case 'seedling_release': {
      const checks = ((rules && rules.nursery) || {}).seedling_release_check || [];
      if (!recorded) {
        return item(itemId, label, 'missing', {
          why: 'No nursery release check is recorded for the batch going into this block.',
          fix: checks.length
            ? `FR-FARM-05: the batch passes ${checks.length} checks first — ${checks.join('; ')}.`
            : 'Record the nursery release check for the batch.',
        });
      }
      if (!recorded.batchId) {
        return item(itemId, label, 'missing', {
          why: 'A release check is recorded but it does not name the batch.',
          fix: 'The batch ID is what links the seedlings to this block. Record it.',
          from: { kind: 'gate-evidence', id: recorded.id || null },
        });
      }
      return fromRecord(itemId, label, recorded, '');
    }

    // --- The lines only a person can answer, on either gate ---------------
    case 'drip_pressure':
      return fromRecord(itemId, label, recorded,
        'Run the drip and check the pressure at the far end of the line. Record the reading '
        + 'and anything blocked — a house that waters unevenly is a house that fails unevenly.');
    case 'spacing_pegged':
      return fromRecord(itemId, label, recorded,
        'Peg the rows to the planned spacing and photograph the pegged block before planting.');
    case 'sops_live':
      return fromRecord(itemId, label, recorded,
        'The role cards and the spray, scouting and hygiene SOPs are up where the work happens, '
        + 'and the people doing the work have been through them.');

    // --- Gate 4, and everything else a person simply records --------------
    case 'root_inspection':
      return fromRecord(itemId, label, recorded,
        'Lift sample plants at the end of the cycle and record what the roots looked like — '
        + 'white and firm, brown and slimy, galled, or stubby. That reading is what Gate 4 learns from.');
    case 'control_audit':
      return fromRecord(itemId, label, recorded,
        'Audit the controls: which sprays went on, which worked, which thresholds were missed.');
    case 'sops_updated':
      return fromRecord(itemId, label, recorded,
        'Write down what changes for next cycle. A cycle that changes nothing has not been reviewed.');
    default:
      return fromRecord(itemId, label, recorded, `Record this against ${gateId} for this zone.`);
  }
}

// ---------------------------------------------------------------------------
// FR-DOC-07 — did it work, and what did the season teach
// ---------------------------------------------------------------------------

/** FR-TREAT-05 / farm_doctor.does: a check three days after every treatment. */
export const FOLLOW_UP_DAYS = 3;

export const followUpTaskId = (sprayId) => `fd_follow_${sprayId}`;

/**
 * The follow-up task for one spray.
 *
 * Deterministic in the same way the daily schedule is (schedule.js): the id is
 * derived from the spray, so five phones generating it produce one task, and a
 * task already answered is never resurrected.
 */
export function followUpTaskFor(state, spray, { today = isoDate() } = {}) {
  const cycle = ((state && state.cycles) || {})[spray.cycleId] || null;
  const zone = cycle ? ((state && state.plots) || {})[cycle.plotId] : null;
  const due = isoDate(addDays(spray.date, FOLLOW_UP_DAYS));
  const what = spray.productName || spray.activeName || 'the treatment';
  return {
    id: followUpTaskId(spray.id),
    kind: 'follow_up',
    title: `Check the ${what} worked — ${(zone && zone.name) || 'bed'}`,
    zoneId: zone ? zone.id : null,
    cycleId: spray.cycleId || null,
    sprayId: spray.id,
    positionId: null,
    due: `${due}T16:00`,
    generated: true,
    proof: true,
    priority: 'high',
    how: [
      'Count the same way you counted before the spray — same traps, same ten plants.',
      'Photograph the damage that made you spray, from the same distance.',
      'Say plainly whether it worked, partly worked, or did nothing.',
    ],
    why: 'A treatment nobody checked is a treatment nobody can learn from, and the next one '
      + 'is a guess again. Three days is long enough to see a change and short enough to fix it.',
    createdFor: today,
  };
}

/** Sprays that still need their three-day check put on the board. */
export function missingFollowUps(state, { today = isoDate(), withinDays = 30 } = {}) {
  const tasks = (state && state.tasks) || {};
  return ((state && state.sprays) || [])
    .filter((s) => s.id && s.date && s.date <= today)
    .filter((s) => daysBetween(s.date, today) <= withinDays)
    .filter((s) => !tasks[followUpTaskId(s.id)])
    .map((s) => followUpTaskFor(state, s, { today }));
}

/** The follow-up answer for one spray, if anyone has given it. */
export function followUpFor(state, sprayId) {
  return ((state && state.doctorOutputs) || [])
    .filter((o) => o.kind === 'followup' && (o.subject || {}).sprayId === sprayId)
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))[0] || null;
}

/** Trap and scouting counts either side of a spray, which is the evidence it worked. */
export function countChange(state, { cycleId, pestId, sprayDate, today = isoDate() }) {
  const scouts = ((state && state.scouts) || [])
    .filter((s) => s.cycleId === cycleId && (!pestId || s.pestId === pestId) && s.date);
  const before = scouts.filter((s) => s.date <= sprayDate).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const after = scouts.filter((s) => s.date > sprayDate && s.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!before || !after) return { before: before || null, after: after || null, change: null };
  const b = Number(before.count);
  const a = Number(after.count);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
    return { before, after, change: null };
  }
  return { before, after, change: round(((a - b) / b) * 100, 0), from: b, to: a };
}

export const WORKED = {
  yes: { id: 'yes', label: 'It worked', tone: 'ok' },
  partly: { id: 'partly', label: 'Partly — still some there', tone: 'warn' },
  no: { id: 'no', label: 'No change', tone: 'danger' },
};

/**
 * FR-DOC-07 — the record of whether a treatment worked.
 *
 * The answer a person gives is the record. The counts either side are attached
 * as what the app could see for itself, so a "it worked" against a rising trap
 * count is visible as the disagreement it is rather than quietly filed.
 */
export function followUpRecord(state, {
  spray, worked, note = '', person = null, pestId = null, today = isoDate(), rules = peekRules(),
} = {}) {
  const answer = WORKED[String(worked || '').toLowerCase()] ? String(worked).toLowerCase() : null;
  const counts = spray ? countChange(state, {
    cycleId: spray.cycleId, pestId: pestId || spray.targetProblem, sprayDate: spray.date, today,
  }) : { change: null };

  const disagrees = answer === 'yes' && counts.change != null && counts.change > 0;

  const record = doctorOutput({
    kind: 'followup',
    subject: { sprayId: spray && spray.id, cycleId: spray && spray.cycleId, problemId: pestId || (spray && spray.targetProblem) || null },
    confidence: counts.change == null ? 'low' : 'medium',
    rules,
    at: `${today}T16:00:00.000Z`,
    read: [
      spray ? { kind: 'spray', id: spray.id, what: `${spray.productName || 'treatment'} on ${spray.date}` } : null,
      counts.before ? { kind: 'scout', id: counts.before.id, what: `count of ${counts.before.count} on ${counts.before.date}, before` } : null,
      counts.after ? { kind: 'scout', id: counts.after.id, what: `count of ${counts.after.count} on ${counts.after.date}, after` } : null,
    ].filter(Boolean),
    summary: answer
      ? `${WORKED[answer].label}${counts.change != null ? ` — counts ${counts.change > 0 ? 'up' : 'down'} ${Math.abs(counts.change)}%` : ''}.`
      : 'Follow-up check recorded with no answer.',
  });

  return {
    ...record,
    worked: answer,
    note,
    counts,
    observedBy: person ? person.id : null,
    disagreesWithCounts: disagrees,
    // A treatment that did nothing is a diagnosis worth re-opening, not a spray
    // worth repeating. The rules would rather a second opinion than a second dose.
    nextStep: answer === 'no'
      ? 'Do not repeat the same product. Re-diagnose: the cause may be different, or the group may '
        + 'have stopped working. Consider a lab sample.'
      : disagrees
        ? 'The counts went up. Re-count before recording this as a success.'
        : null,
  };
}

/** Every treatment and where its check stands — the board FR-DOC-07 describes. */
export function followUpBoard(state, { today = isoDate(), withinDays = 45 } = {}) {
  return ((state && state.sprays) || [])
    .filter((s) => s.date && daysBetween(s.date, today) <= withinDays)
    .map((s) => {
      const due = isoDate(addDays(s.date, FOLLOW_UP_DAYS));
      const answer = followUpFor(state, s.id);
      return {
        spray: s,
        due,
        answered: !!answer,
        worked: answer ? answer.worked : null,
        overdue: !answer && due < today,
        daysLate: !answer && due < today ? daysBetween(due, today) : 0,
        record: answer,
      };
    })
    .sort((a, b) => (a.due < b.due ? 1 : -1));
}

/**
 * FR-DOC-07 — the Gate 4 cycle review, drafted from the season's own records.
 *
 * A draft, and nothing more. Gate 4 is cleared by the Farm Manager and the
 * Owner (FR-GATE-00), and the value of this is that they argue with a filled-in
 * page instead of staring at a blank one at the end of a hard season.
 */
export function draftCycleReview(state, cycleId, { today = isoDate(), rules = peekRules() } = {}) {
  const cycle = ((state && state.cycles) || {})[cycleId] || null;
  if (!cycle) {
    return { ...doctorOutput({ kind: 'cycle-review', subject: { cycleId }, confidence: 'low', rules }),
      sections: [], why: 'That cycle is not on record.' };
  }
  const zone = ((state && state.plots) || {})[cycle.plotId] || null;
  const harvests = ((state && state.harvests) || []).filter((h) => h.cycleId === cycleId);
  const sprays = ((state && state.sprays) || []).filter((s) => s.cycleId === cycleId);
  const diagnoses = ((state && state.diagnoses) || []).filter((d) => d.cycleId === cycleId);
  const scouts = ((state && state.scouts) || []).filter((s) => s.cycleId === cycleId);
  const kg = harvests.reduce((n, h) => n + (Number(h.kg) || 0), 0);
  const plants = Number(cycle.plants) || 0;
  const area = Number(cycle.areaM2) || (zone && Number(zone.areaM2)) || 0;
  const end = cycle.closedAt || today;
  const days = cycle.transplantDate ? daysBetween(cycle.transplantDate, end) : null;

  const groupsUsed = [...new Set(sprays.map((s) => groupOfSpray(s, rules)).filter(Boolean))];
  const follow = followUpBoard(state, { today, withinDays: 400 })
    .filter((f) => f.spray.cycleId === cycleId);
  const didNotWork = follow.filter((f) => f.worked === 'no');
  const unchecked = follow.filter((f) => !f.answered);
  const unconfirmed = diagnoses.filter((d) => !d.confirmedBy);
  const rootRead = ((rules && rules.root_read) || {});

  const sections = [
    {
      id: 'what',
      heading: 'What was grown',
      lines: [
        `${(zone && zone.name) || 'Bed'} — ${cycle.variety || cycle.cropId}, transplanted ${cycle.transplantDate || 'date not recorded'}.`,
        days != null ? `${days} days in the ground${cycle.status === 'closed' ? `, closed ${cycle.closedAt}` : ', still standing'}.` : '',
        plants ? `${plants} plants${area ? ` over ${area} m²` : ''}.` : '',
      ].filter(Boolean),
    },
    {
      id: 'yield',
      heading: 'What it gave',
      lines: [
        `${round(kg, 1)} kg over ${harvests.length} picking${harvests.length === 1 ? '' : 's'}.`,
        plants ? `${round(kg / plants, 2)} kg per plant.` : '',
        area ? `${round(kg / area, 2)} kg per m².` : '',
        harvests.length ? '' : 'Nothing was picked from this cycle, which is the first thing to explain.',
      ].filter(Boolean),
    },
    {
      id: 'problems',
      heading: 'What went wrong, and what was done',
      lines: [
        diagnoses.length
          ? `${diagnoses.length} diagnosis record${diagnoses.length === 1 ? '' : 's'}: `
            + [...new Set(diagnoses.map((d) => d.problemName || d.problemId))].join(', ') + '.'
          : 'No diagnosis was recorded all cycle. Either nothing went wrong, or nothing was written down.',
        unconfirmed.length ? `${unconfirmed.length} of them were never confirmed by anyone (FR-DIAG-03).` : '',
        `${scouts.length} scouting record${scouts.length === 1 ? '' : 's'} on file.`,
      ].filter(Boolean),
    },
    {
      id: 'treatments',
      heading: 'Treatments and whether they worked',
      lines: [
        `${sprays.length} treatment${sprays.length === 1 ? '' : 's'}${groupsUsed.length ? `, groups used: ${groupsUsed.join(', ')}` : ''}.`,
        didNotWork.length
          ? `${didNotWork.length} did nothing on the three-day check — ${didNotWork.map((f) => f.spray.productName || 'a spray').join(', ')}. `
            + 'Check the group before reaching for it again next cycle.'
          : '',
        unchecked.length ? `${unchecked.length} treatment${unchecked.length === 1 ? ' was' : 's were'} never checked after three days (FR-DOC-07).` : '',
        groupsUsed.length === 1 && sprays.length > 2
          ? `Everything sprayed was ${groupsUsed[0]}. That is how resistance is built.`
          : '',
      ].filter(Boolean),
    },
    {
      id: 'roots',
      heading: 'Root inspection',
      lines: [
        'Lift sample plants and read the roots before the block is cleared:',
        ...Object.entries(rootRead).filter(([k]) => k !== 'when').map(([look, means]) => `${look} → ${means}`),
      ],
    },
    {
      id: 'next',
      heading: 'What to change next cycle',
      lines: [
        didNotWork.length ? 'Rotate out the groups that failed their check.' : '',
        unconfirmed.length ? 'Confirm diagnoses on the day, not at the end of the cycle.' : '',
        unchecked.length ? 'Answer the three-day check while it is still on the board.' : '',
        'Anything else the Farm Manager and Owner decide belongs here, in their words.',
      ].filter(Boolean),
    },
  ];

  const record = doctorOutput({
    kind: 'cycle-review',
    subject: { cycleId, zoneId: cycle.plotId },
    confidence: harvests.length || sprays.length ? 'medium' : 'low',
    rules,
    read: [
      { kind: 'cycle', id: cycleId, what: `${(zone && zone.name) || 'bed'}, ${cycle.variety || cycle.cropId}` },
      { kind: 'harvests', what: `${harvests.length} pickings, ${round(kg, 1)} kg` },
      { kind: 'sprays', what: `${sprays.length} treatments` },
      { kind: 'diagnoses', what: `${diagnoses.length} diagnoses` },
      { kind: 'scouts', what: `${scouts.length} scouting records` },
    ],
    summary: `Draft Gate 4 review for ${(zone && zone.name) || cycleId}: ${round(kg, 1)} kg, `
      + `${sprays.length} treatments, ${diagnoses.length} diagnoses.`,
  });

  return {
    ...record,
    status: 'draft',
    cycle,
    zone,
    sections,
    totals: { kg: round(kg, 1), harvests: harvests.length, sprays: sprays.length, diagnoses: diagnoses.length },
    // FR-DOC-08: a draft is not a cleared gate, however complete it looks.
    clears: false,
    needsConfirming: CONFIRMS['cycle-review'].who,
    needsApproval: 'Owner',
  };
}
