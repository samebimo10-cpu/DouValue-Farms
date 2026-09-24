// The two calculators the Farm Doctor is required to carry (FR-DOC-05).
//
// Both exist because the same two sums were being done in somebody's head, at
// four in the afternoon, next to a running tap. A rate written as "0.3 ml/L"
// is not a dose; a dose is "4.8 ml in this knapsack". A pH of 5.3 is not a
// plan; a plan is "hold, and re-test on the 26th". Turning the first into the
// second is arithmetic, and arithmetic is the one thing a phone is better at
// than a tired person.
//
// Neither calculator invents anything. The dose calculator refuses when there
// is no rate on file (FR-STOCK-08, and the Farm Doctor's own "never invents a
// dose"), and the lime calculator reads its rates, its routes and its timing
// locks straight out of the rules file.

import { addDays, daysBetween, isoDate, round } from '../util.js';
import { KNAPSACK_L } from './safety.js';
import { getRules as rules, mediaRules } from '../rules.js';

/** The three vessels FR-DOC-05 names, smallest first. */
export const TANKS = [
  { litres: KNAPSACK_L, label: `${KNAPSACK_L} L knapsack` },
  { litres: 500, label: '500 L tank' },
  { litres: 1000, label: '1,000 L tank' },
];

/**
 * A bottle cap holds about 10 ml. It is the measure people actually use in the
 * field, and FR-TREAT-03 asks for it by name ("3 caps per 16 L knapsack").
 * Only ever offered for liquids: a cap of powder is not a measurement, and the
 * mixing rules already say borax is weighed, not guessed.
 */
export const CAP_ML = 10;

const UNITS = { ml: 'ml', l: 'L', g: 'g', kg: 'kg' };

/**
 * Turn a written rate into numbers.
 *
 * Handles the shapes the rules file and the label form actually produce:
 *
 *   "1 ml/L (10EC)"                              -> 1 ml per litre, 10EC
 *   "0.3 ml/L (45SC), after 4 PM"                -> 0.3 ml per litre, with a timing note
 *   "150 ml cold-pressed oil + 30 ml soap / 16 L" -> two components, per 16 L
 *   "5 g/L GH; 2.5 g/L field"                    -> first clause governs, the rest recorded
 *   "per label" / "see prep table" / null        -> refused
 *
 * A refusal is not a failure of the calculator. It is the calculator doing its
 * job: "the product cannot be used until a label rate is entered".
 */
export function parseRate(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) {
    return refuse(text, 'No rate is recorded for this product.');
  }
  if (/^(per label|see\b|as per|refer)/i.test(text)) {
    return refuse(text, `The rules file says "${text}", which is not a number this app can weigh out.`);
  }

  // "5 g/L GH; 2.5 g/L field" — the first clause is the one that governs, and
  // the others are kept so the screen can show the person their choice.
  const clauses = text.split(';').map((c) => c.trim()).filter(Boolean);
  const head = clauses[0];
  const variants = clauses.slice(1);

  // A trailing "/ 16 L" is a whole-tank basis. A bare "/L" is per litre.
  const perTank = head.match(/\/\s*([\d.]+)\s*(?:L|litres?)\b/i);
  const perLitre = /\/\s*(?:L|litres?)\b/i.test(head);
  const basisLitres = perTank ? Number(perTank[1]) : (perLitre ? 1 : null);
  if (!basisLitres) {
    return refuse(text, `"${text}" does not say how much water it goes into, so it cannot be scaled.`);
  }

  const formulation = (head.match(/\(([^)]*\d[^)]*)\)/) || [])[1] || null;
  const timing = (head.match(/,\s*(after[^,;]*|before[^,;]*)/i) || [])[1] || null;

  // Strip the basis and the bracketed formulation before splitting components,
  // so "(45SC)" does not read as another thing to pour in.
  const body = head
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\/\s*[\d.]*\s*(?:L|litres?)\b/i, ' ')
    .replace(/,\s*(after|before)[^,;]*/i, ' ');

  const components = [];
  for (const piece of body.split('+')) {
    const m = piece.match(/([\d.]+)\s*(ml|l|g|kg)\b/i);
    if (!m) continue;
    const of = piece
      .replace(m[0], ' ')
      .replace(/[^A-Za-z- ]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    components.push({
      amount: Number(m[1]) / basisLitres,
      unit: UNITS[m[2].toLowerCase()] || m[2],
      of: of || null,
    });
  }

  if (!components.length) {
    return refuse(text, `No quantity could be read out of "${text}".`);
  }

  // A single component's trailing words are a qualifier ("GH", "field"), not
  // the name of a second thing to pour in. Only a premix has named parts.
  if (components.length === 1 && components[0].of) {
    components[0].context = components[0].of;
    components[0].of = null;
  }

  return {
    ok: true,
    raw: text,
    basisLitres,
    formulation,
    timing,
    variants,
    /** Per one litre of spray, whatever the written basis was. */
    components,
  };
}

function refuse(raw, why) {
  return {
    ok: false,
    raw,
    reason: 'no-rate',
    why,
    // FR-STOCK-08 and the Farm Doctor's "never invents a dose": the way out is
    // a label, entered by the Farm Manager, not a number the app made up.
    fix: 'The Farm Manager enters the label rate against this active ingredient '
      + '(Store → the active → Add label). Until then the product cannot be used.',
    components: [],
  };
}

/**
 * FR-DOC-05 — how much goes in the knapsack, and in each tank.
 *
 * `rate` is a written rate (the schedule rate off the rules file, or a label
 * rate the Farm Manager entered). Everything comes back already rounded to
 * something a person can measure, with the raw number kept beside it so a
 * stock check subtracts the real quantity rather than the displayed one.
 */
export function dosePlan(rate, { tanks = TANKS } = {}) {
  const parsed = typeof rate === 'string' || rate == null ? parseRate(rate) : rate;
  if (!parsed.ok) return { ...parsed, tanks: [] };

  return {
    ...parsed,
    tanks: tanks.map((tank) => ({
      ...tank,
      components: parsed.components.map((c) => measure(c.amount * tank.litres, c.unit, c.of)),
      text: parsed.components
        .map((c) => measure(c.amount * tank.litres, c.unit, c.of).text)
        .join(' + ') + ` in ${tank.litres} L of water`,
    })),
  };
}

/** One quantity, in the largest sensible unit, with the cap count if it helps. */
export function measure(amount, unit, of = null) {
  let value = amount;
  let shown = unit;

  if (unit === 'ml' && value >= 1000) { value /= 1000; shown = 'L'; }
  if (unit === 'g' && value >= 1000) { value /= 1000; shown = 'kg'; }

  const dp = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const display = round(value, dp);

  // Caps are for liquids only. Powders are weighed.
  const caps = unit === 'ml' && amount >= CAP_ML ? round(amount / CAP_ML, 1) : null;

  return {
    amount,
    unit,
    value: display,
    shownUnit: shown,
    of,
    caps,
    capText: caps ? `about ${caps} cap${caps === 1 ? '' : 's'} of ${CAP_ML} ml` : null,
    weigh: unit === 'g' || unit === 'kg',
    text: `${display} ${shown}${of ? ` ${of}` : ''}`,
  };
}

// --- Lime -----------------------------------------------------------------

/** The texture names in the rules file, with the slugs the screens use. */
export const TEXTURES = [
  { id: 'loamy_sand', name: 'Loamy sand', rulesKey: 'loamy sand',
    hint: 'Runs through your fingers. Water disappears fast.' },
  { id: 'sandy_loam', name: 'Sandy loam', rulesKey: 'sandy loam',
    hint: 'Gritty but holds together damp. Most of the main farm.' },
  { id: 'loam_clay_loam', name: 'Loam or clay loam', rulesKey: 'loam / clay loam',
    hint: 'Rolls into a thread when wet. Sticks to the boot.' },
];

export function textureFor(id) {
  return TEXTURES.find((t) => t.id === id || t.rulesKey === id) || null;
}

/** "16.5-23.5" -> { low: 16.5, high: 23.5 } */
function rateRange(text) {
  const nums = String(text || '').match(/[\d.]+/g) || [];
  if (!nums.length) return null;
  return { low: Number(nums[0]), high: Number(nums[nums.length - 1]) };
}

/**
 * FR-DOC-05 — the lime calculator.
 *
 * Three pH readings, a texture and a bed area in, a route, a product and a
 * number of kilograms out. The parts that matter most are the two it refuses
 * to turn into kilograms:
 *
 *   pH 5.2 to 5.49  the block is HELD. Route A lime may still be reacting, and
 *                   liming on top of lime that has not finished is how ground
 *                   ends up above 7.0, which is far harder to walk back. The
 *                   answer is a date, not a dose (decision C-5).
 *   pH below 5.2    where lime has already gone on, the top-up is HALF the
 *                   original rate and ten more days. Never a second full dose.
 *
 * Everything below reads its numbers from rules.soil_and_water, so correcting
 * the schedule corrects the calculator.
 *
 * Plant bags (FR-GATE-08, `media: 'bag'`) are dosed by the volume of media,
 * not by an area. The same route table applies, spread through the
 * incorporation depth the rules give: a 100 m² rate worked 20 cm deep is a
 * rate for 20 m³ of soil. The bands, the hold and the half and quarter doses
 * are the same; only the unit the kilograms are counted in changes.
 */
export function limePlan({
  readings = [],
  texture = null,
  areaM2 = 0,
  zoneType = 'greenhouse',
  solarised = false,
  transplantDate = null,
  limeDate = null,
  lastLime = null,
  holdSince = null,
  media = 'bed',
  volumeL = 0,
  bags = 0,
  litresPerBag = 0,
  today = isoDate(),
} = {}) {
  const soil = rules().soil_and_water;
  const gate = soil.soil_ph_gate;
  const lime = soil.lime;
  const bag = media === 'bag';

  const points = readings.map(Number).filter((n) => Number.isFinite(n));
  if (points.length < 3) {
    return {
      ok: false,
      reason: 'three-points',
      why: `The gate wants three points per block and ${points.length === 1 ? 'one was' : `${points.length} were`} entered.`,
      fix: `Test three points: ${gate.test}`,
    };
  }

  const tex = textureFor(texture);
  if (!tex) {
    return {
      ok: false,
      reason: 'no-texture',
      why: 'The soil texture decides the rate, and none was chosen.',
      fix: 'Pick loamy sand, sandy loam, or loam / clay loam.',
    };
  }

  // How many "100 m² at the incorporation depth" the job is. For a bed that is
  // the area over 100; for bags it is the media volume over 20 m³.
  let units = (Number(areaM2) || 0) / 100;
  let volume = null;
  if (bag) {
    const spec = mediaRules();
    if (!spec) {
      return { ok: false, reason: 'no-media-rules',
        why: 'The rules file has no plant-bag media section, so there is no rate by volume.',
        fix: 'Load rules-1.3 or later.' };
    }
    const litres = Number(volumeL) > 0 ? Number(volumeL) : (Number(bags) || 0) * (Number(litresPerBag) || 0);
    if (!(litres > 0)) {
      return { ok: false, reason: 'no-volume',
        why: 'Bags are limed by the volume of media, and no volume was given.',
        fix: 'Enter the heap volume, or the number of bags and the litres each bag holds.' };
    }
    const perUnitM3 = 100 * spec.lime_incorporation_depth_m;
    units = litres / 1000 / perUnitM3;
    volume = { litres, m3: round(litres / 1000, 2), bags: Number(bags) || 0,
      litresPerBag: Number(litresPerBag) || 0, perUnitM3, where: spec.lime_where, basis: spec.lime_basis };
  }

  const mean = round(points.reduce((a, b) => a + b, 0) / points.length, 2);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const reading = { points, mean, min, max, spread: round(max - min, 2) };

  const warnings = [];
  if (reading.spread > 0.5) {
    warnings.push(`The three points range from ${min} to ${max}. That is not one block: `
      + 'lime the acid corner on its own rate and re-test it separately, or the average hides it.');
  }
  if (mean >= gate.min && min < gate.min) {
    warnings.push(`The average passes at ${mean} but one point read ${min}, which is below the `
      + `${gate.min} gate. Plants in that corner will meet ${min}, not ${mean}.`);
  }

  const common = { reading, texture: tex, areaM2, zoneType, warnings, gateMin: gate.min, gateMax: gate.max,
    treatArea: bag ? volume.where : gate.treat_area, doNotBuy: lime.do_not_buy || [], fallback: lime.fallback,
    media: bag ? 'bag' : 'bed', volume };

  // --- Above the gate: lime is the wrong tool entirely --------------------
  if (mean > gate.max) {
    return { ok: true, ...common, band: 'above-max', route: null, action: 'no-lime',
      headline: `pH ${mean.toFixed(2)} is above the ${gate.max} limit. Do not lime.`,
      detail: 'Liming pushes it further out. Bring it down with sulphur or organic matter, then re-test.',
      steps: [], locks: [] };
  }

  // --- In range: nothing to do -------------------------------------------
  if (mean >= gate.min) {
    return { ok: true, ...common, band: 'in-range', route: null, action: 'no-lime',
      headline: `pH ${mean.toFixed(2)} is inside ${gate.min}–${gate.max}. No lime needed.`,
      detail: 'Record the reading with the meter photo and the pH gate opens.',
      steps: [], locks: [] };
  }

  // --- 5.2 to 5.49: HELD, and the answer is a date ------------------------
  if (mean >= 5.2) {
    const heldDays = holdSince ? daysBetween(holdSince, today) : null;
    const retestOn = isoDate(addDays(holdSince || today, 10));

    if (!holdSince || heldDays < 10) {
      return { ok: true, ...common, band: 'hold', route: null, action: 'hold',
        headline: `pH ${mean.toFixed(2)}. Hold this block and re-test in 10 days.`,
        detail: gate['5_2_to_5_49'],
        holdUntil: retestOn,
        retestOn,
        blocksTransplant: true,
        steps: [
          holdSince
            ? `Keep holding. The re-test falls on ${retestOn} (${10 - heldDays} day${10 - heldDays === 1 ? '' : 's'} to go).`
            : `Put the block on hold today and re-test on ${retestOn}.`,
          'Do not add lime now. Route A lime from the start of solarisation may still be reacting, '
            + 'and a dose on top of a dose overshoots.',
          'Re-test the same three points, with the meter calibrated that morning, and photograph it.',
        ],
        locks: [] };
    }

    // The hold ran its ten days and the block is still under 5.5, so the
    // schedule allows a quarter of the ORIGINAL rate — not a quarter of a
    // fresh full dose.
    const quarter = doseFor({ lime, tex, units, volume, solarised, transplantDate, lastLime, fraction: 0.25 });
    return { ok: true, ...common, band: 'hold-expired', action: 'quarter-rate',
      ...quarter,
      headline: `pH ${mean.toFixed(2)} after a 10-day hold. Apply one quarter of the original rate.`,
      detail: gate['5_2_to_5_49'],
      approval: 'Farm Doctor checks the plan; the Owner approves it before it goes on.',
      retestOn: isoDate(addDays(today, 10)),
      blocksTransplant: true,
      steps: [
        `Apply ${quarter.kgText}${quarter.perBagText ? ` (${quarter.perBagText} per bag)` : ''} — `
          + 'one quarter of the original rate, not a new full dose.',
        'Wait 10 days.',
        `Re-test the same three points on ${isoDate(addDays(today, 10))}.`,
      ],
      locks: locksFor({ lime, route: quarter.route, limeDate: limeDate || today, transplantDate }) };
  }

  // --- Below 5.2 ----------------------------------------------------------
  const first = !lastLime;
  const dose = doseFor({ lime, tex, units, volume, solarised, transplantDate, lastLime,
    fraction: first ? 1 : 0.5 });

  return {
    ok: true,
    ...common,
    band: 'below-5-2',
    action: first ? 'full-rate' : 'half-rate',
    ...dose,
    headline: first
      ? `pH ${mean.toFixed(2)}. Route ${dose.route}: ${dose.kgText} of ${dose.product}.`
      : `pH ${mean.toFixed(2)} after liming. Apply HALF the original rate again and add 10 days.`,
    detail: first ? (dose.timing || dose.when) : gate.below_5_2,
    blocksTransplant: true,
    retestOn: isoDate(addDays(limeDate || today, first ? 28 : 10)),
    steps: first
      ? [
        bag
          ? `Mix ${dose.kgText} of ${dose.product} through the ${volume.m3} m³ of media${
            dose.perBagText ? ` (${dose.perBagText} per bag)` : ''}.`
          : `Spread ${dose.kgText} of ${dose.product} over the ${treatAreaText(zoneType, gate)}.`,
        dose.timing || 'Incorporate and irrigate.',
        bag
          ? 'Re-test three points in the heap before bagging, after the lime has worked in.'
          : `Re-test the three points before transplant, after the lime has worked in.`,
      ]
      : [
        `Apply ${dose.kgText}${dose.perBagText ? ` (${dose.perBagText} per bag)` : ''} — half the original rate. `
          + 'Never stack a second full dose.',
        'Add 10 days to the schedule.',
        `Re-test the same three points on ${isoDate(addDays(limeDate || today, 10))}.`,
      ],
    locks: locksFor({ lime, route: dose.route, limeDate: limeDate || today, transplantDate }),
  };
}

function treatAreaText(zoneType, gate) {
  return zoneType === 'greenhouse'
    ? 'bed area only (not the paths)'
    : 'full cropped area';
}

/** Route, product and kilograms, at whatever fraction of the rate applies. */
function doseFor({ lime, tex, units, volume = null, solarised, transplantDate, lastLime, fraction = 1 }) {
  // Route A is for a block not yet under solarisation plastic; Route B is for
  // one already solarised with transplant less than three weeks out.
  const route = solarised ? 'B' : 'A';
  const spec = route === 'B' ? lime.route_B : lime.route_A;
  const range = rateRange(spec.rates_per_100m2_kg[tex.rulesKey]);
  const hundreds = Number(units) || 0;

  // "Original rate" means the rate that actually went on, when one is on
  // record. Falling back to the table keeps the sum honest when it is not.
  const base = lastLime && lastLime.ratePer100Low
    ? { low: Number(lastLime.ratePer100Low), high: Number(lastLime.ratePer100High || lastLime.ratePer100Low) }
    : range;

  const low = round(base.low * hundreds * fraction, 1);
  const high = round(base.high * hundreds * fraction, 1);

  // Bags: the same dose, said per cubic metre and per bag, because that is how
  // it is weighed out at the heap.
  let perVolume = {};
  if (volume) {
    const m3Low = round((base.low * fraction) / volume.perUnitM3, 3);
    const m3High = round((base.high * fraction) / volume.perUnitM3, 3);
    const g = (kgPerM3) => round(kgPerM3 * volume.litresPerBag, 0);
    perVolume = {
      kgPerM3Low: m3Low,
      kgPerM3High: m3High,
      gPerBagLow: volume.litresPerBag ? g(m3Low) : null,
      gPerBagHigh: volume.litresPerBag ? g(m3High) : null,
      perBagText: volume.litresPerBag
        ? (g(m3Low) === g(m3High) ? `${g(m3Low)} g` : `${g(m3Low)}–${g(m3High)} g`) : null,
    };
  }

  return {
    ...perVolume,
    route,
    product: spec.product,
    when: spec.when,
    timing: spec.timing || null,
    note: spec.note || null,
    targetPh: spec.target_ph || null,
    ratePer100Low: round(base.low * fraction, 2),
    ratePer100High: round(base.high * fraction, 2),
    fraction,
    kgLow: low,
    kgHigh: high,
    kgText: low === high ? `${low} kg` : `${low}–${high} kg`,
    transplantWaitDays: spec.transplant_wait_days || null,
    nitrogenBlackoutDays: spec.nitrogen_blackout_days || null,
    substitute: spec.substitute || null,
  };
}

/**
 * The timing locks. These are the part people skip.
 *
 * Neem cake inside ten days of lime loses most of its nitrogen to the lime,
 * and urea inside twenty-one days of it gases off as ammonia — you pay for a
 * bag of fertiliser and get a smell. Route B adds two more: nothing is
 * transplanted for fourteen days after hydrated lime, and nitrogen stays off
 * for twenty-one, with Calcium Nitrate standing in for the Week 1 and Week 2
 * NPK.
 */
export function locksFor({ lime, route, limeDate, transplantDate = null }) {
  const from = limeDate || isoDate();
  const locks = [
    {
      id: 'neem-cake',
      days: lime.neem_cake_gap_days,
      notBefore: isoDate(addDays(from, lime.neem_cake_gap_days)),
      rule: lime.neem_cake_rule,
      text: `Neem cake goes in no earlier than ${isoDate(addDays(from, lime.neem_cake_gap_days))} — `
        + `${lime.neem_cake_gap_days} days after the lime. On Route A that falls out naturally: `
        + 'lime at T-35 to T-28, neem cake at the plastic lift (T-7).',
    },
    {
      id: 'urea',
      days: lime.urea_after_lime_min_days,
      notBefore: isoDate(addDays(from, lime.urea_after_lime_min_days)),
      text: `No urea until ${isoDate(addDays(from, lime.urea_after_lime_min_days))} — `
        + `${lime.urea_after_lime_min_days} days after the lime, or it gases off as ammonia and you have `
        + 'bought nothing. Urea in the planting hole is deleted (Rev 5.1) either way.',
    },
  ];

  if (route === 'B') {
    const b = lime.route_B;
    locks.push({
      id: 'transplant',
      days: b.transplant_wait_days,
      notBefore: isoDate(addDays(from, b.transplant_wait_days)),
      text: `Nothing is transplanted before ${isoDate(addDays(from, b.transplant_wait_days))} — `
        + `${b.transplant_wait_days} days after hydrated lime. This is part of Gate 1.`,
    });
    locks.push({
      id: 'nitrogen',
      days: b.nitrogen_blackout_days,
      notBefore: isoDate(addDays(from, b.nitrogen_blackout_days)),
      text: `Nitrogen blackout to ${isoDate(addDays(from, b.nitrogen_blackout_days))}. ${b.substitute}`,
    });
  }

  if (transplantDate) {
    for (const lock of locks) {
      if (lock.id === 'transplant') continue;
      lock.clashesWithTransplant = lock.notBefore > transplantDate;
    }
  }

  return locks;
}
