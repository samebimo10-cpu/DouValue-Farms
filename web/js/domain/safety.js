// Spray safety: who can go back into a sprayed bed, when the fruit is safe to
// pick and sell, and whether the farm is burning through one chemical family
// fast enough to breed resistance.
//
// The pre-harvest interval is the part that matters most. A bed sprayed on
// Monday with a 7-day product must not be picked on Wednesday, whatever the
// buyer is offering. The app therefore treats PHI as a hard block on harvest
// logging, not a suggestion.
//
// PHI and re-entry figures here are typical label values. Labels differ by
// country, formulation and concentration, and the label on the container in
// your store is the one that counts. Where the two disagree, follow the label
// and correct the figure in Settings.

import { addDays, daysBetween, isoDate, parseDate } from '../util.js';

export const HAZARD = {
  low: { label: 'Lower hazard', colour: '#2e7d5b' },
  moderate: { label: 'Moderate hazard', colour: '#c77800' },
  high: { label: 'High hazard', colour: '#b23c3c' },
  avoid: { label: 'Do not use on pepper', colour: '#7a1f1f' },
};

/**
 * The products a pepper farm around Port Harcourt actually buys, with the
 * numbers the app needs to keep people and fruit safe.
 *
 * phiDays  days from spraying until fruit may be picked
 * reiHours hours until a worker may re-enter without protective gear
 * group    resistance group (FRAC for fungicides, IRAC for insecticides)
 */
export const PRODUCTS = [
  // --- Fungicides and bactericides ---
  { id: 'mancozeb', name: 'Mancozeb 80% WP', examples: 'Z-Force, Dithane M-45', kind: 'fungicide',
    group: 'FRAC M03', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['anthracnose', 'bacterial_leaf_spot', 'cercospora_leaf_spot', 'choanephora_wet_rot'],
    note: 'Protectant. It has to be on the plant before the spores land, so spray ahead of rain, not after.' },
  { id: 'copper_oxychloride', name: 'Copper oxychloride', examples: 'Champ, Kocide', kind: 'fungicide',
    group: 'FRAC M01', phiDays: 3, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['bacterial_leaf_spot', 'anthracnose', 'phytophthora_blight'],
    note: 'Cheap and broad. Copper builds up in soil over years, so do not exceed the label rate.' },
  { id: 'metalaxyl_mancozeb', name: 'Metalaxyl-M + mancozeb', examples: 'Ridomil Gold MZ 68WG', kind: 'fungicide',
    group: 'FRAC 4 + M03', phiDays: 14, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['phytophthora_blight', 'damping_off'],
    note: 'The Phytophthora product. Long wait before picking, so plan it around the harvest round.' },
  { id: 'azoxystrobin', name: 'Azoxystrobin', examples: 'Amistar', kind: 'fungicide',
    group: 'FRAC 11', phiDays: 3, reiHours: 12, hazard: 'low', bee: 'low',
    targets: ['anthracnose', 'cercospora_leaf_spot', 'powdery_mildew'],
    note: 'Never twice in a row. Resistance to this group builds faster than to any other.' },
  { id: 'difenoconazole', name: 'Difenoconazole', examples: 'Score 250EC', kind: 'fungicide',
    group: 'FRAC 3', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['anthracnose', 'cercospora_leaf_spot', 'powdery_mildew'], note: '' },
  { id: 'carbendazim', name: 'Carbendazim 50WP', examples: 'Bendazim', kind: 'fungicide',
    group: 'FRAC 1', phiDays: 7, reiHours: 24, hazard: 'moderate', bee: 'low',
    targets: ['fusarium_wilt', 'anthracnose'],
    note: 'Widespread resistance already. Useful as a drench, weak as a routine spray.' },
  { id: 'fosetyl_al', name: 'Fosetyl-aluminium', examples: 'Aliette', kind: 'fungicide',
    group: 'FRAC P07', phiDays: 7, reiHours: 12, hazard: 'low', bee: 'low',
    targets: ['phytophthora_blight'], note: 'Moves both up and down inside the plant.' },
  { id: 'sulphur', name: 'Wettable sulphur', examples: 'Thiovit, Kumulus', kind: 'fungicide',
    group: 'FRAC M02', phiDays: 1, reiHours: 24, hazard: 'low', bee: 'low',
    targets: ['powdery_mildew', 'red_spider_mite', 'broad_mite'],
    note: 'Do not spray above 32°C or you scorch the leaves. Never within two weeks of an oil spray.' },

  // --- Insecticides and miticides ---
  { id: 'bt', name: 'Bacillus thuringiensis', examples: 'Dipel', kind: 'biological',
    group: 'IRAC 11A', phiDays: 0, reiHours: 4, hazard: 'low', bee: 'none',
    targets: ['fruit_borer'],
    note: 'Safest thing you can spray during picking. Only works on small caterpillars, and only in the evening: sunlight destroys it.' },
  { id: 'neem', name: 'Neem oil / azadirachtin', examples: 'Neemazal, home-made kernel extract', kind: 'biological',
    group: 'IRAC UN', phiDays: 0, reiHours: 4, hazard: 'low', bee: 'low',
    targets: ['aphids', 'whitefly', 'thrips', 'red_spider_mite', 'mealybug'],
    note: 'No waiting period, so it fits the harvest window. Repeat every 5-7 days; one spray does little.' },
  { id: 'spinosad', name: 'Spinosad', examples: 'Tracer, Laser', kind: 'insecticide',
    group: 'IRAC 5', phiDays: 3, reiHours: 4, hazard: 'low', bee: 'high while wet',
    targets: ['thrips', 'fruit_borer', 'fruit_fly'],
    note: 'Spray at dusk. It is harmless to bees once the spray has dried, but deadly while wet.' },
  { id: 'emamectin', name: 'Emamectin benzoate', examples: 'Emastar, Warrior', kind: 'insecticide',
    group: 'IRAC 6', phiDays: 3, reiHours: 12, hazard: 'moderate', bee: 'moderate',
    targets: ['fruit_borer', 'thrips'], note: 'Short wait, strong on caterpillars.' },
  { id: 'abamectin', name: 'Abamectin', examples: 'Dynamec, Abamex', kind: 'miticide',
    group: 'IRAC 6', phiDays: 7, reiHours: 12, hazard: 'high', bee: 'moderate',
    targets: ['red_spider_mite', 'broad_mite', 'thrips'],
    note: 'Same resistance group as emamectin. Using both back to back counts as using one twice.' },
  { id: 'acetamiprid', name: 'Acetamiprid', examples: 'Mospilan', kind: 'insecticide',
    group: 'IRAC 4A', phiDays: 7, reiHours: 12, hazard: 'moderate', bee: 'moderate',
    targets: ['aphids', 'whitefly', 'mealybug', 'leaf_curl_virus'], note: '' },
  { id: 'imidacloprid', name: 'Imidacloprid', examples: 'Confidor, Imiforce', kind: 'insecticide',
    group: 'IRAC 4A', phiDays: 14, reiHours: 12, hazard: 'high', bee: 'very high',
    targets: ['aphids', 'whitefly', 'leaf_curl_virus'],
    note: 'Never while flowers are open. It kills the bees that set your fruit, and you pay for that twice.' },
  { id: 'spiromesifen', name: 'Spiromesifen', examples: 'Oberon', kind: 'miticide',
    group: 'IRAC 23', phiDays: 3, reiHours: 12, hazard: 'moderate', bee: 'low',
    targets: ['whitefly', 'red_spider_mite'], note: 'Hits eggs and young stages. Good rotation partner.' },
  { id: 'lambda_cyhalothrin', name: 'Lambda-cyhalothrin', examples: 'Karate, Lambda Super 2.5EC', kind: 'insecticide',
    group: 'IRAC 3A', phiDays: 7, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['aphids', 'thrips', 'variegated_grasshopper', 'fruit_borer'],
    note: 'Kills everything including the predators. Routine use is the fastest way to get a spider mite outbreak.' },
  { id: 'cypermethrin', name: 'Cypermethrin', examples: 'Cyperforce, Best', kind: 'insecticide',
    group: 'IRAC 3A', phiDays: 7, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['fruit_borer', 'variegated_grasshopper'],
    note: 'Same group as lambda-cyhalothrin. Swapping between them is not a rotation.' },
  { id: 'fipronil', name: 'Fipronil', examples: '-', kind: 'insecticide',
    group: 'IRAC 2B', phiDays: 14, reiHours: 24, hazard: 'high', bee: 'very high',
    targets: ['termites'], note: 'Soil and nest treatment only. Never spray it onto fruit.' },

  // --- Fertilisers and correctives, listed so they can be logged like any other input ---
  { id: 'calcium_nitrate', name: 'Calcium nitrate (foliar)', examples: '-', kind: 'nutrient',
    group: '-', phiDays: 0, reiHours: 0, hazard: 'low', bee: 'none',
    targets: ['blossom_end_rot'], note: 'A nutrient, not a pesticide. No waiting period.' },
  { id: 'epsom', name: 'Magnesium sulphate (Epsom salt)', examples: '-', kind: 'nutrient',
    group: '-', phiDays: 0, reiHours: 0, hazard: 'low', bee: 'none',
    targets: ['magnesium_deficiency'], note: '' },

  // --- Products to keep off this farm ---
  { id: 'carbofuran', name: 'Carbofuran', examples: 'Furadan', kind: 'insecticide',
    group: 'IRAC 1A', phiDays: 60, reiHours: 48, hazard: 'avoid', bee: 'very high',
    targets: ['root_knot_nematode'],
    note: 'Banned across the EU and much of Africa. It has killed farm workers and poisoned whole flocks of birds. '
      + 'Residues in pepper will fail any buyer test. Rotation with maize and marigold does the same job safely.' },
  { id: 'paraquat', name: 'Paraquat', examples: 'Gramoxone', kind: 'herbicide',
    group: 'HRAC D', phiDays: 60, reiHours: 48, hazard: 'avoid', bee: 'low',
    targets: [],
    note: 'A mouthful is fatal and there is no antidote. Banned in over 60 countries. Never store it near drinking water '
      + 'or in an unlabelled bottle, and never use the same knapsack afterwards for anything else.' },
  { id: 'chlorpyrifos', name: 'Chlorpyrifos', examples: 'Dursban', kind: 'insecticide',
    group: 'IRAC 1B', phiDays: 21, reiHours: 48, hazard: 'avoid', bee: 'very high',
    targets: ['termites', 'fruit_borer'],
    note: 'Withdrawn from food crops in the EU and US over harm to children. Buyers increasingly test for it.' },
  { id: 'dimethoate', name: 'Dimethoate', examples: 'Rogor', kind: 'insecticide',
    group: 'IRAC 1B', phiDays: 21, reiHours: 48, hazard: 'avoid', bee: 'very high',
    targets: ['aphids', 'fruit_fly'],
    note: 'Three weeks before you can pick, and harsh on whoever sprays it. On a crop picked weekly it does not fit.' },
];

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export function productsFor(problemId) {
  return PRODUCTS.filter((p) => p.targets.includes(problemId) && p.hazard !== 'avoid');
}

export function discouragedFor(problemId) {
  return PRODUCTS.filter((p) => p.targets.includes(problemId) && p.hazard === 'avoid');
}

/** Date fruit from this application becomes safe to pick. */
export function safeHarvestDate(application) {
  const product = PRODUCT_BY_ID[application.productId];
  const phi = application.phiDays ?? product?.phiDays ?? 0;
  return isoDate(addDays(application.date, phi));
}

/** Time workers may go back in without protective clothing. */
export function reentryAt(application) {
  const product = PRODUCT_BY_ID[application.productId];
  const hours = application.reiHours ?? product?.reiHours ?? 24;
  const base = application.at ? new Date(application.at) : parseDate(application.date);
  return new Date(base.getTime() + hours * 3600000);
}

/**
 * Can this bed be picked today?
 * Returns the blocking application and the date it clears, so the answer the
 * worker sees is "not until Friday" and not just "no".
 */
export function harvestClearance(applications, onDate = new Date()) {
  const today = isoDate(onDate);
  let blocker = null;
  for (const app of applications) {
    const clear = safeHarvestDate(app);
    if (clear > today && (!blocker || clear > blocker.clearOn)) {
      blocker = {
        clearOn: clear,
        daysLeft: daysBetween(today, clear),
        application: app,
        product: PRODUCT_BY_ID[app.productId] || { name: app.productName || 'Unknown product' },
      };
    }
  }
  if (!blocker) return { safe: true, clearOn: today, blocker: null };
  return {
    safe: false,
    clearOn: blocker.clearOn,
    daysLeft: blocker.daysLeft,
    blocker,
    reason: `${blocker.product.name} was applied on ${blocker.application.date}. `
      + `Fruit from this bed is not safe to pick or sell until ${blocker.clearOn}.`,
  };
}

/** Whether it is safe to send someone into the bed right now, unprotected. */
export function reentryClearance(applications, at = new Date()) {
  let blocker = null;
  for (const app of applications) {
    const until = reentryAt(app);
    if (until > at && (!blocker || until > blocker.until)) {
      blocker = { until, application: app, product: PRODUCT_BY_ID[app.productId] };
    }
  }
  if (!blocker) return { safe: true, blocker: null };
  const hours = Math.ceil((blocker.until - at) / 3600000);
  return {
    safe: false,
    until: blocker.until,
    hoursLeft: hours,
    blocker,
    reason: `${blocker.product?.name || 'A spray'} was applied here. Nobody goes in without gloves, `
      + `boots, long sleeves and a mask for another ${hours} hour${hours === 1 ? '' : 's'}.`,
  };
}

/**
 * Resistance check: the same chemical group used again and again stops working,
 * usually just when a season depends on it. Warn on a third consecutive use of
 * one group against one problem.
 */
export function resistanceWarnings(applications, withinDays = 60, today = new Date()) {
  const recent = applications
    .filter((a) => daysBetween(a.date, today) <= withinDays)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const byGroup = new Map();
  for (const app of recent) {
    const product = PRODUCT_BY_ID[app.productId];
    if (!product || product.group === '-') continue;
    const entry = byGroup.get(product.group) || { group: product.group, uses: [], kind: product.kind };
    entry.uses.push({ date: app.date, product: product.name, bedId: app.bedId });
    byGroup.set(product.group, entry);
  }
  const warnings = [];
  for (const entry of byGroup.values()) {
    if (entry.uses.length >= 3) {
      warnings.push({
        group: entry.group,
        count: entry.uses.length,
        products: [...new Set(entry.uses.map((u) => u.product))],
        message: `${entry.group} has been used ${entry.uses.length} times in the last ${withinDays} days. `
          + 'Switch to a different resistance group for the next spray or it will stop working on you.',
        alternatives: PRODUCTS
          .filter((p) => p.kind === entry.kind && p.group !== entry.group && p.hazard !== 'avoid')
          .slice(0, 3).map((p) => p.name),
      });
    }
  }
  return warnings;
}

/** Plain-language safety rules, shown before anyone logs a spray. */
export const SPRAY_RULES = [
  'Wear the gear: long sleeves, trousers, boots, gloves, and a mask or cloth over nose and mouth. Every time.',
  'Never spray with the wind blowing into your face, and never into your neighbour\'s field.',
  'Spray early morning or late evening. Midday heat wastes the chemical and burns the crop.',
  'Do not eat, drink or smoke while spraying. Wash hands and face before you do.',
  'Mix outside, downwind, and never with your bare hands or in a cooking bowl.',
  'Keep the empty container out of the house. Triple-rinse it, puncture it, and bury or return it. Never reuse it for water.',
  'Write the spray in the app before you leave the field, so nobody picks that bed too early.',
  'Anybody pregnant or under 18 does not mix or spray. That is not negotiable.',
];

/** Rough spray volume for a knapsack operator, so the mix is not guesswork. */
export function knapsackPlan(areaM2, rateMlPer15L = 30, volumeLPerHa = 400) {
  const ha = areaM2 / 10000;
  const litres = Math.max(1, Math.round(ha * volumeLPerHa));
  const loads = Math.max(1, Math.ceil(litres / 15));
  return {
    litres,
    loads,
    perLoadMl: rateMlPer15L,
    totalProductMl: Math.round(loads * rateMlPer15L),
    text: `${litres} L of spray in about ${loads} knapsack load${loads === 1 ? '' : 's'} of 15 L, `
      + `${rateMlPer15L} ml of product per load.`,
  };
}
