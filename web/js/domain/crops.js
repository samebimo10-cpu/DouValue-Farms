// Crop profiles for the three peppers DouValue grows, tuned for open-field
// production in Port Harcourt (Rivers State, Nigeria).
//
// Timings are days after transplanting (DAT) unless the field says otherwise,
// and describe a healthy crop in the rain-fed season. They are starting points:
// the forecaster in predict.js corrects them against what a bed actually did,
// and every number here can be edited in Settings once the farm has its own
// records. Sources are ordinary extension-service ranges for Capsicum, not
// measurements from this farm.

export const CROPS = {
  bell: {
    id: 'bell',
    name: 'Bell pepper',
    localName: 'Tatashe (sweet)',
    pidgin: 'Tatashe',
    species: 'Capsicum annuum',
    colour: '#e0392b',
    emoji: '🫑',
    varieties: ['California Wonder', 'Yolo Wonder', 'Nikita F1', 'Goliath F1', 'Commandant F1'],
    nurseryDays: 30,        // sowing to transplant
    germinationDays: 8,
    daysToFlower: 35,
    daysToFirstHarvest: 70, // green-mature fruit
    daysToColour: 90,       // fully coloured red/yellow fruit
    daysToPeak: 100,
    harvestWindowDays: 80,  // picking runs this long from first harvest
    cycleDays: 160,
    pickEveryDays: 7,
    spacing: { inRow: 0.5, betweenRow: 0.6 },  // metres
    yieldPerPlantKg: { low: 0.8, typical: 1.6, high: 3.0 },
    fruitPerKg: 7,
    baseTempC: 10,
    optTempC: 26,
    heatStressC: 33,
    // Bell has the thinnest cuticle and the biggest fruit: it suffers most from
    // rain-splash fruit rot and from calcium going short during fast fruit fill.
    watchFor: ['anthracnose', 'blossom_end_rot', 'bacterial_leaf_spot', 'phytophthora_blight'],
    notes: 'Hardest of the three in open field here. Shade netting or a rain shelter over the '
      + 'fruiting beds pays for itself in the peak rains. Mulch heavily and keep calcium up.',
    priceTierNgnPerKg: 1400,   // farm-gate starting point, edit in Settings
  },

  chili: {
    id: 'chili',
    name: 'Chili (cayenne)',
    localName: 'Shombo',
    pidgin: 'Shombo',
    species: 'Capsicum annuum',
    colour: '#c62828',
    emoji: '🌶️',
    varieties: ['Shombo local', 'Cayenne Long Slim', 'Legon 18', 'Bird pepper (Ata wewe)'],
    nurseryDays: 28,
    germinationDays: 7,
    daysToFlower: 40,
    daysToFirstHarvest: 75,
    daysToColour: 95,
    daysToPeak: 105,
    harvestWindowDays: 100,
    cycleDays: 190,
    pickEveryDays: 7,
    spacing: { inRow: 0.4, betweenRow: 0.6 },
    yieldPerPlantKg: { low: 0.5, typical: 1.1, high: 2.0 },
    fruitPerKg: 110,
    baseTempC: 10,
    optTempC: 27,
    heatStressC: 34,
    watchFor: ['anthracnose', 'thrips', 'pvmv', 'fruit_borer'],
    notes: 'The steady earner. Long picking window, dries well, so a glut can be dried and held '
      + 'for the scarcity months instead of being dumped on the market fresh.',
    priceTierNgnPerKg: 1800,
  },

  habanero: {
    id: 'habanero',
    name: 'Habanero',
    localName: 'Ata rodo',
    pidgin: 'Rodo',
    species: 'Capsicum chinense',
    colour: '#f57c00',
    emoji: '🔥',
    varieties: ['Ata rodo local', 'Scotch Bonnet', 'Habanero Yellow', 'Nabuki F1'],
    nurseryDays: 35,        // C. chinense is slow off the mark
    germinationDays: 14,
    daysToFlower: 50,
    daysToFirstHarvest: 95,
    daysToColour: 115,
    daysToPeak: 130,
    harvestWindowDays: 140, // keeps going for months if kept healthy
    cycleDays: 260,
    pickEveryDays: 10,
    spacing: { inRow: 0.5, betweenRow: 0.7 },
    yieldPerPlantKg: { low: 0.6, typical: 1.4, high: 2.8 },
    fruitPerKg: 90,
    baseTempC: 12,
    optTempC: 27,
    heatStressC: 35,
    watchFor: ['bacterial_wilt', 'root_knot_nematode', 'phytophthora_blight', 'whitefly'],
    notes: 'Slow to start, longest to pay, then pays the most. Worth ratooning a healthy bed after '
      + 'the first flush instead of replanting: cut back, feed, and it flowers again in 6-8 weeks.',
    priceTierNgnPerKg: 2600,
  },
};

export const CROP_LIST = Object.values(CROPS);

export function getCrop(id) { return CROPS[id] || CROPS.chili; }

/** Growth stages in order, each with the DAT it begins. */
export function stagesFor(cropId) {
  const c = getCrop(cropId);
  return [
    { id: 'nursery', name: 'Nursery', pidgin: 'Nursery', from: -c.nurseryDays,
      job: 'Seedlings in trays or beds. Shade, water twice daily, watch for damping-off.' },
    { id: 'establish', name: 'Establishment', pidgin: 'Small small', from: 0,
      job: 'First 3 weeks after transplant. Keep moist, shade in hot sun, gap up the dead ones.' },
    { id: 'vegetative', name: 'Vegetative', pidgin: 'E dey grow', from: 21,
      job: 'Plant is building leaves. Nitrogen now, first weeding, stake the tall ones.' },
    { id: 'flowering', name: 'Flowering', pidgin: 'E don flower', from: c.daysToFlower,
      job: 'Flowers open. Do not let it go dry. Calcium and potassium now, watch thrips.' },
    { id: 'fruiting', name: 'Fruit set', pidgin: 'E don born', from: c.daysToFlower + 14,
      job: 'Fruit swelling. Steady water, potassium, protect fruit from rot.' },
    { id: 'harvest', name: 'Harvesting', pidgin: 'Picking time', from: c.daysToFirstHarvest,
      job: `Pick every ${c.pickEveryDays} days. Feed after every 2 pickings. Mind spray waiting days.` },
    { id: 'decline', name: 'Tail end', pidgin: 'E dey finish', from: c.daysToFirstHarvest + c.harvestWindowDays,
      job: 'Yield falling. Decide: ratoon the healthy beds, or clear and replant.' },
    { id: 'closed', name: 'Closed', pidgin: 'Don finish', from: c.cycleDays,
      job: 'Cycle over. Clear trash off the field, do not leave old pepper stalks as a disease bridge.' },
  ];
}

/** Which stage a cycle is in at a given number of days after transplant. */
export function stageAt(cropId, dat) {
  const stages = stagesFor(cropId);
  let current = stages[0];
  for (const s of stages) if (dat >= s.from) current = s;
  return current;
}

/** Plants a bed of this many square metres holds at the crop's spacing. */
export function plantsForArea(cropId, areaM2) {
  const c = getCrop(cropId);
  const perPlant = c.spacing.inRow * c.spacing.betweenRow;
  return Math.max(0, Math.round((Number(areaM2) || 0) / perPlant));
}

/** Population per hectare at the crop's spacing. */
export function populationPerHa(cropId) { return plantsForArea(cropId, 10000); }

/**
 * Fertiliser plan per crop cycle, split the way a smallholder here actually
 * applies it: basal at transplant, then side-dressings. Rates are per hectare;
 * the caller scales by bed area.
 */
export function fertiliserPlan(cropId) {
  const c = getCrop(cropId);
  return [
    { dat: -7, name: 'Land prep', product: 'Poultry manure (well rotted)', rateKgHa: 8000,
      why: 'Builds the sandy Niger Delta soil and holds water. Must be old manure, not fresh.' },
    { dat: -7, name: 'Land prep', product: 'Agricultural lime', rateKgHa: 1000, conditional: 'soilPhBelow5.5',
      why: 'Soils here run acid (pH 4.5-5.5). Lime unlocks the phosphorus and calcium you paid for.' },
    { dat: 0, name: 'Basal', product: 'NPK 15-15-15', rateKgHa: 250,
      why: 'Starter for roots and early leaves. Place beside the plant, not touching the stem.' },
    { dat: 21, name: 'First side-dress', product: 'Urea 46-0-0', rateKgHa: 100,
      why: 'Pushes the vegetative frame before flowering.' },
    { dat: c.daysToFlower, name: 'Flowering feed', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 250,
      why: 'Potassium and magnesium for fruit set and fruit weight.' },
    { dat: c.daysToFlower + 7, name: 'Calcium spray', product: 'Calcium nitrate foliar', rateKgHa: 15,
      why: 'Blossom-end rot insurance while fruit is filling fast.' },
    { dat: c.daysToFirstHarvest, name: 'Harvest feed', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 200,
      why: 'Every crate you pick takes potassium off the field. Replace it or the next flush is small.' },
    { dat: c.daysToFirstHarvest + 30, name: 'Harvest feed 2', product: 'NPK 12-12-17 + 2MgO', rateKgHa: 200,
      why: 'Keeps the picking window long instead of one big flush and done.' },
  ];
}

/** Water demand in mm/day by stage — what irrigation has to make up in the dry months. */
export function waterDemandMmPerDay(cropId, dat) {
  const stage = stageAt(cropId, dat).id;
  const table = { nursery: 2, establish: 3, vegetative: 4, flowering: 5.5,
    fruiting: 6, harvest: 5.5, decline: 4, closed: 0 };
  return table[stage] ?? 4;
}
