// Field guide to what goes wrong with pepper in the Niger Delta.
//
// Two halves: SYMPTOMS is the checklist a farm hand ticks (plain English with a
// Pidgin gloss), and PROBLEMS is what those ticks point at. diagnose.js scores
// one against the other.
//
// This is a field guide, not a laboratory. It narrows the list and tells you how
// to confirm. Anything that could cost a whole bed deserves a second opinion
// from the Rivers State ADP extension officer or a plant clinic before you spend
// money on chemicals.

/** Parts of the plant, in the order the wizard asks about them. */
export const PARTS = [
  { id: 'whole',    name: 'Whole plant',  pidgin: 'Di whole plant', emoji: '🌱' },
  { id: 'leaf',     name: 'Leaves',       pidgin: 'Leaf',           emoji: '🍃' },
  { id: 'stem',     name: 'Stem',         pidgin: 'Stem',           emoji: '🪵' },
  { id: 'fruit',    name: 'Fruit',        pidgin: 'Di pepper',      emoji: '🌶️' },
  { id: 'flower',   name: 'Flowers',      pidgin: 'Flower',         emoji: '🌸' },
  { id: 'root',     name: 'Roots',        pidgin: 'Root',           emoji: '🪴' },
  { id: 'seedling', name: 'Nursery',      pidgin: 'Nursery',        emoji: '🌿' },
  { id: 'pattern',  name: 'How it spreads', pidgin: 'How e dey go', emoji: '🗺️' },
];

/** The tick-boxes. Keep the wording concrete: what you can see, not what it is. */
export const SYMPTOMS = [
  // Whole plant
  { id: 'wilt_sudden_green', part: 'whole', label: 'Wilts suddenly, leaves still green', pidgin: 'E just bend but leaf still green' },
  { id: 'wilt_midday', part: 'whole', label: 'Wilts in hot sun, recovers in the evening', pidgin: 'E dey bend for afternoon, come back for evening' },
  { id: 'stunted', part: 'whole', label: 'Small and stunted next to its neighbours', pidgin: 'E no wan grow like di others' },
  { id: 'yellowing_whole', part: 'whole', label: 'Whole plant going yellow', pidgin: 'Di whole plant dey yellow' },
  { id: 'dieback', part: 'whole', label: 'Dying from the top downwards', pidgin: 'E dey die from up' },
  { id: 'collapse', part: 'whole', label: 'Plant collapsed and died where it stood', pidgin: 'E just die for di same place' },
  { id: 'one_sided', part: 'whole', label: 'Only one side of the plant affected', pidgin: 'Na one side only' },

  // Leaves
  { id: 'leaf_yellow_old', part: 'leaf', label: 'Bottom (older) leaves yellow first', pidgin: 'Leaf for down dey yellow first' },
  { id: 'leaf_yellow_new', part: 'leaf', label: 'Top (new) leaves pale or yellow', pidgin: 'New leaf for up dey pale' },
  { id: 'leaf_interveinal', part: 'leaf', label: 'Yellow between the veins, veins stay green', pidgin: 'Yellow for middle, vein still green' },
  { id: 'leaf_margin_scorch', part: 'leaf', label: 'Leaf edges brown and burnt-looking', pidgin: 'Leaf edge don burn' },
  { id: 'leaf_spots_water_soaked', part: 'leaf', label: 'Small water-soaked spots turning dark', pidgin: 'Small wet spot wey dey turn black' },
  { id: 'leaf_spots_yellow_halo', part: 'leaf', label: 'Spots with a yellow ring around them', pidgin: 'Spot wit yellow round am' },
  { id: 'leaf_spots_grey_centre', part: 'leaf', label: 'Spots with grey or white centre, dark rim', pidgin: 'Spot wey get white eye for middle' },
  { id: 'leaf_spots_large_brown', part: 'leaf', label: 'Large brown blotches', pidgin: 'Big brown patch' },
  { id: 'leaf_mosaic', part: 'leaf', label: 'Mottled light and dark green pattern', pidgin: 'Leaf colour dey scatter, light and dark' },
  { id: 'leaf_vein_banding', part: 'leaf', label: 'Dark green banding along the veins', pidgin: 'Dark line dey follow vein' },
  { id: 'leaf_curl_up', part: 'leaf', label: 'Leaves curling upwards', pidgin: 'Leaf dey curl go up' },
  { id: 'leaf_curl_down', part: 'leaf', label: 'Leaves curling down / cupping', pidgin: 'Leaf dey curl go down' },
  { id: 'leaf_narrow_strappy', part: 'leaf', label: 'New leaves narrow and strap-like', pidgin: 'New leaf thin like rope' },
  { id: 'leaf_thick_leathery', part: 'leaf', label: 'Leaves thick, leathery, small', pidgin: 'Leaf hard and small' },
  { id: 'leaf_silver_bronze', part: 'leaf', label: 'Silvery or bronze sheen', pidgin: 'Leaf dey shine like silver' },
  { id: 'leaf_stipple', part: 'leaf', label: 'Tiny pale dots all over the leaf', pidgin: 'Plenty small white dot' },
  { id: 'leaf_webbing', part: 'leaf', label: 'Fine spider web underneath', pidgin: 'Small web for under leaf' },
  { id: 'leaf_white_powder', part: 'leaf', label: 'White powder on the leaf', pidgin: 'White powder for leaf' },
  { id: 'leaf_sticky_sooty', part: 'leaf', label: 'Sticky leaves with black sooty coating', pidgin: 'Leaf dey sticky wit black black' },
  { id: 'leaf_insects_under', part: 'leaf', label: 'Small insects clustered underneath', pidgin: 'Small insect gather for under leaf' },
  { id: 'leaf_flies_rise', part: 'leaf', label: 'Tiny white flies fly up when you shake it', pidgin: 'Small white fly dey comot when you shake am' },
  { id: 'leaf_ants', part: 'leaf', label: 'Ants running up and down the plant', pidgin: 'Ant full di plant' },
  { id: 'leaf_holes_chewed', part: 'leaf', label: 'Chewed, ragged, holes in leaves', pidgin: 'Something don chop di leaf' },
  { id: 'leaf_drop', part: 'leaf', label: 'Leaves dropping off', pidgin: 'Leaf dey fall' },
  { id: 'leaf_black_specks', part: 'leaf', label: 'Tiny black specks (droppings) on the leaf', pidgin: 'Small black black for leaf' },

  // Stem
  { id: 'stem_lesion_soil', part: 'stem', label: 'Dark wet rot on the stem at soil level', pidgin: 'Stem don rotten for ground level' },
  { id: 'stem_brown_inside', part: 'stem', label: 'Brown streaks inside when you cut it', pidgin: 'Inside stem don brown' },
  { id: 'stem_ooze_white', part: 'stem', label: 'Cut stem in clear water: milky thread comes out', pidgin: 'Put cut stem for water, white thread comot' },
  { id: 'stem_girdled_base', part: 'stem', label: 'Stem eaten or ringed at the base', pidgin: 'Dem don chop round di stem' },
  { id: 'stem_white_mould', part: 'stem', label: 'White mould or whiskers on the stem', pidgin: 'White mould for stem' },
  { id: 'stem_soil_tubes', part: 'stem', label: 'Mud tubes or soil sheeting on the stem', pidgin: 'Sand don cover di stem like tunnel' },

  // Fruit
  { id: 'fruit_sunken_lesion', part: 'fruit', label: 'Sunken round spot, sometimes pink/orange dots in it', pidgin: 'Hole-hole spot wit pink powder' },
  { id: 'fruit_black_end', part: 'fruit', label: 'Black leathery patch at the blossom (bottom) end', pidgin: 'Black hard patch for di bottom' },
  { id: 'fruit_hole_frass', part: 'fruit', label: 'Hole in the fruit with droppings around it', pidgin: 'Hole wit shit for outside' },
  { id: 'fruit_maggots', part: 'fruit', label: 'Maggots or a caterpillar inside', pidgin: 'Worm dey inside' },
  { id: 'fruit_sting_marks', part: 'fruit', label: 'Small puncture marks on the skin', pidgin: 'Small pin hole for skin' },
  { id: 'fruit_pale_papery', part: 'fruit', label: 'Pale papery sunburnt patch on the sunny side', pidgin: 'Sun don burn one side' },
  { id: 'fruit_scabby', part: 'fruit', label: 'Rough scabby raised spots', pidgin: 'Rough rough spot' },
  { id: 'fruit_deformed', part: 'fruit', label: 'Twisted, bumpy, deformed fruit', pidgin: 'Pepper no straight, e twist' },
  { id: 'fruit_small', part: 'fruit', label: 'Fruit much smaller than it should be', pidgin: 'Pepper too small' },
  { id: 'fruit_soft_rot', part: 'fruit', label: 'Soft watery rot', pidgin: 'Pepper don soft, water dey comot' },
  { id: 'fruit_dropping', part: 'fruit', label: 'Fruit dropping before it ripens', pidgin: 'Pepper dey fall before e ripe' },

  // Flowers
  { id: 'flower_drop', part: 'flower', label: 'Flowers falling without setting fruit', pidgin: 'Flower dey fall, no pepper' },
  { id: 'flower_black_whisker', part: 'flower', label: 'Flowers rotting with black whiskery growth', pidgin: 'Flower rotten wit black hair' },
  { id: 'flower_scarred', part: 'flower', label: 'Flowers or tiny fruit scarred and russeted', pidgin: 'Flower get scar' },

  // Roots
  { id: 'root_knots', part: 'root', label: 'Knots, galls or swellings on the roots', pidgin: 'Root get knot knot' },
  { id: 'root_brown_rot', part: 'root', label: 'Roots brown, soft, rotting', pidgin: 'Root don rotten' },
  { id: 'root_few', part: 'root', label: 'Very few roots, short and stubby', pidgin: 'Root no plenty, e short' },

  // Nursery
  { id: 'seedling_topple', part: 'seedling', label: 'Seedlings fall over at the soil line', pidgin: 'Seedling dey fall for ground level' },
  { id: 'seedling_no_germ', part: 'seedling', label: 'Seeds not coming up', pidgin: 'Seed no wan germinate' },
  { id: 'seedling_leggy', part: 'seedling', label: 'Seedlings tall, thin and weak', pidgin: 'Seedling long but weak' },

  // Field pattern
  { id: 'pattern_scattered', part: 'pattern', label: 'Odd plants here and there', pidgin: 'Na one one plant' },
  { id: 'pattern_patches', part: 'pattern', label: 'Whole patches together', pidgin: 'Na patch patch' },
  { id: 'pattern_low_wet', part: 'pattern', label: 'Worst in the low, wet part of the bed', pidgin: 'Na where water dey stay e bad pass' },
  { id: 'pattern_spreading_fast', part: 'pattern', label: 'Spreading fast down the row', pidgin: 'E dey spread quick for di line' },
  { id: 'pattern_field_edge', part: 'pattern', label: 'Worst at the edge of the field', pidgin: 'Na for edge e bad pass' },
  { id: 'pattern_whole_bed', part: 'pattern', label: 'Whole bed affected evenly', pidgin: 'Di whole bed be di same' },
  { id: 'pattern_after_rain', part: 'pattern', label: 'Started after heavy rain', pidgin: 'E start afta heavy rain' },
  { id: 'pattern_after_dry', part: 'pattern', label: 'Started in a hot dry spell', pidgin: 'E start wen sun dey hot' },
  { id: 'pattern_after_spray', part: 'pattern', label: 'Started after a spray was applied', pidgin: 'E start afta dem spray' },
];

export const SYMPTOM_BY_ID = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s]));
export function symptomsForPart(part) { return SYMPTOMS.filter((s) => s.part === part); }

/** Severity: 1 nuisance, 5 can take the whole field. */
export const PROBLEMS = [
  {
    id: 'phytophthora_blight',
    name: 'Phytophthora blight',
    local: 'Sudden death / wet root rot',
    type: 'fungal',
    cause: 'Phytophthora capsici, a water mould that swims through wet soil',
    severity: 5,
    spread: 'very fast in standing water',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      wilt_sudden_green: 3, stem_lesion_soil: 4, root_brown_rot: 3, collapse: 2,
      pattern_low_wet: 3, pattern_after_rain: 3, pattern_patches: 2, pattern_spreading_fast: 2,
      leaf_drop: 1, fruit_soft_rot: 2, dieback: 1,
    },
    conditions: { waterlogging: 1.0, wetness: 0.7 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Dig one dying plant. A dark, water-soaked band right at the soil line that runs up the stem is the giveaway.',
      'Look at where the dead plants are. Phytophthora follows water: low spots, the end of a furrow, downhill of a puddle.',
      'Plants die green and stay standing. If they yellowed first over a week or two, think Fusarium or nematodes instead.',
    ],
    lookalikes: ['bacterial_wilt', 'fusarium_wilt', 'waterlogging'],
    loss: 'Can clear a whole bed in one wet week. The worst disease on this farm, by distance.',
    manage: {
      now: [
        'Pull out dead plants with the soil around the roots. Carry them off the field in a bag, do not drop them in the drain.',
        'Open the drains and break any pan so water leaves the bed within hours, not days.',
        'Stop furrow or flood irrigation on that block immediately. The water is the disease vehicle.',
      ],
      cultural: [
        'Raised beds, 30 cm high, are the single best defence here. Flat beds in Port Harcourt rain are a gamble.',
        'Never plant pepper, tomato, garden egg or okra back onto an infected bed for at least 3 years.',
        'Mulch to stop soil splashing up onto stems.',
        'Work infected blocks last and wash boots and tools before moving to a clean block.',
      ],
      chemical: [
        { active: 'Metalaxyl-M + mancozeb', example: 'Ridomil Gold MZ 68WG', how: 'Drench the base of plants around the affected patch and spray the block', phiDays: 14, note: 'Protects what is still healthy. It will not raise the dead.' },
        { active: 'Copper oxychloride', example: 'Champ / Kocide', how: 'Protective spray on the block after heavy rain', phiDays: 3, note: 'Cheap standby, weaker on Phytophthora than metalaxyl.' },
        { active: 'Fosetyl-aluminium', example: 'Aliette', how: 'Foliar or drench', phiDays: 7, note: 'Systemic, works both up and down the plant.' },
      ],
      organic: [
        'Trichoderma harzianum worked into the bed before transplanting, plus in the nursery mix.',
        'Well-rotted poultry manure raises soil biology that suppresses it. Fresh manure makes it worse.',
      ],
    },
  },

  {
    id: 'bacterial_wilt',
    name: 'Bacterial wilt',
    local: 'Sudden wilt with no spots',
    type: 'bacterial',
    cause: 'Ralstonia solanacearum, living in the soil',
    severity: 5,
    spread: 'fast through soil water and on tools',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      wilt_sudden_green: 4, stem_ooze_white: 5, stem_brown_inside: 3, wilt_midday: 2,
      pattern_patches: 2, pattern_scattered: 1, pattern_low_wet: 2, pattern_after_rain: 2, root_brown_rot: 1,
    },
    conditions: { waterlogging: 0.7, wetness: 0.5 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'The streaming test settles it. Cut the stem near the base, hang the cut end in a clear glass of clean water, hold it still. Milky white threads sinking out of the cut within 5 minutes means bacterial wilt.',
      'No leaf spots, no stem lesion, no yellowing first. The plant just wilts and dies standing, usually starting on the hottest day.',
      'Cut the stem across: a brown ring in the water-carrying tissue.',
    ],
    lookalikes: ['phytophthora_blight', 'fusarium_wilt', 'root_knot_nematode'],
    loss: 'No spray cures it. On an infested block the only honest answer is not to plant pepper there.',
    manage: {
      now: [
        'Rogue infected plants with the root ball. Do not compost them.',
        'Wash hands and dip cutlasses and knives in bleach solution between plants when pruning or harvesting in an affected block.',
        'Do not let irrigation or run-off flow from the sick block to a clean one.',
      ],
      cultural: [
        'Rotate to maize, okra is not safe, use maize, cassava or a grass fallow for 3 or more years. Never tomato, garden egg or potato.',
        'Raised beds and sharp drainage. The bacterium moves in water.',
        'Grafting onto resistant rootstock is the serious answer if you keep losing habanero on the same land.',
        'Soil solarisation with clear plastic over 6 weeks of dry-season sun knocks the population back.',
      ],
      chemical: [
        { active: 'None that cures it', example: '-', how: 'Do not waste money on fungicides; this is a bacterium in the soil', phiDays: 0, note: 'Copper slows surface spread at best.' },
      ],
      organic: [
        'Add lime and well-rotted organic matter; the disease is worse in acid, compacted soil.',
        'Some farmers get useful suppression from Bacillus subtilis biologicals applied at transplanting.',
      ],
    },
  },

  {
    id: 'fusarium_wilt',
    name: 'Fusarium wilt',
    local: 'Slow one-sided wilt',
    type: 'fungal',
    cause: 'Fusarium oxysporum in the soil',
    severity: 4,
    spread: 'slow, but permanent in the soil',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      one_sided: 4, leaf_yellow_old: 3, stem_brown_inside: 3, wilt_midday: 2,
      stunted: 2, pattern_scattered: 2, dieback: 2, leaf_drop: 2,
    },
    conditions: { dryness: 0.3, wetness: 0.2 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Yellowing usually starts on one side or one branch, then the whole plant goes over one or two weeks. Bacterial wilt is faster and greener.',
      'Split the stem lengthwise: a brown stain running up the inside.',
      'Do the streaming test anyway. No milky ooze points away from bacterial wilt and towards this.',
    ],
    lookalikes: ['bacterial_wilt', 'root_knot_nematode', 'phytophthora_blight'],
    loss: 'Takes plants one at a time through the season. Steady, quiet yield loss.',
    manage: {
      now: ['Remove affected plants with the root ball.', 'Mark the spot; do not replant into it this cycle.'],
      cultural: [
        'Long rotation away from solanaceae, and lime to bring pH up towards 6.5. Fusarium likes acid soil.',
        'Do not injure roots with careless weeding; every wound is a door.',
        'Nematode control matters, because nematode wounds let Fusarium in.',
      ],
      chemical: [
        { active: 'Carbendazim', example: 'Bendazim 50WP', how: 'Soil drench at the base of healthy neighbours', phiDays: 7, note: 'Partial help only. Do not rely on it.' },
      ],
      organic: ['Trichoderma in the planting hole.', 'Compost-rich beds slow it down.'],
    },
  },

  {
    id: 'anthracnose',
    name: 'Anthracnose fruit rot',
    local: 'Pepper rot / black spot for pepper',
    type: 'fungal',
    cause: 'Colletotrichum species, splashed by rain',
    severity: 5,
    spread: 'fast in the rains, fruit to fruit',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_sunken_lesion: 5, fruit_soft_rot: 2, fruit_dropping: 2, leaf_spots_large_brown: 1,
      pattern_after_rain: 3, pattern_whole_bed: 1, pattern_patches: 1,
    },
    conditions: { wetness: 1.0 },
    stages: ['fruiting', 'harvest', 'decline'],
    confirm: [
      'Look for a round, sunken, water-soaked spot on the fruit that darkens, with rings of tiny pink or orange spore dots in the middle when it is damp.',
      'Ripening and ripe fruit are hit hardest. Green fruit can carry it silently and rot after picking.',
      'Worst on the fruit nearest the ground and after a run of rainy days.',
    ],
    lookalikes: ['bacterial_leaf_spot', 'choanephora_wet_rot', 'sunscald'],
    loss: 'The main reason pepper is rejected at the market gate here. Can take 40% of a wet-season crop.',
    manage: {
      now: [
        'Pick and carry off every rotten fruit, including the ones on the ground. Each one is a spore factory for the rest of the bed.',
        'Bury or burn them well away from the field. Do not throw them at the field edge.',
        'Start a protective fungicide programme and keep it up through the rains.',
      ],
      cultural: [
        'Stake and prune the lower branches so no fruit touches the soil and air moves through the canopy.',
        'Mulch: it stops rain splashing soil-borne spores up onto the fruit.',
        'Harvest on time. Over-ripe fruit left on the plant is where it starts.',
        'Wider spacing in the rainy season, even at the cost of plant count.',
      ],
      chemical: [
        { active: 'Mancozeb', example: 'Z-Force / Dithane M-45', how: 'Protective spray every 7-10 days from first fruit set', phiDays: 7, note: 'The backbone. Protectant only, so it must be on the fruit before the rain.' },
        { active: 'Azoxystrobin', example: 'Amistar', how: 'Alternate with mancozeb', phiDays: 3, note: 'Rotate. Never use a strobilurin twice in a row or you breed resistance.' },
        { active: 'Difenoconazole', example: 'Score 250EC', how: 'Curative-leaning, use when pressure is already high', phiDays: 7, note: 'Alternate with a different mode of action.' },
        { active: 'Copper oxychloride', example: 'Champ', how: 'Cheap protectant between sprays', phiDays: 3, note: 'Also helps against bacterial spot.' },
      ],
      organic: [
        'Bicarbonate plus a wetter gives some protection on small plots.',
        'Wider spacing, mulch, and ruthless removal of rotten fruit do most of the work even without chemicals.',
      ],
    },
  },

  {
    id: 'bacterial_leaf_spot',
    name: 'Bacterial leaf spot',
    local: 'Leaf spot',
    type: 'bacterial',
    cause: 'Xanthomonas species, seed-borne and splash-spread',
    severity: 4,
    spread: 'fast in wind-driven rain',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_spots_water_soaked: 4, leaf_spots_yellow_halo: 3, leaf_drop: 3, fruit_scabby: 3,
      pattern_after_rain: 3, pattern_spreading_fast: 2, pattern_whole_bed: 2, leaf_spots_large_brown: 1,
    },
    conditions: { wetness: 1.0 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Hold a leaf up to the light. Small angular spots, greasy and water-soaked underneath, turning brown with a yellow halo.',
      'Heavy leaf drop leaves fruit naked and then sunburnt. That knock-on damage is often worse than the spots.',
      'Raised scabby spots on fruit rather than sunken ones. Sunken means anthracnose.',
    ],
    lookalikes: ['cercospora_leaf_spot', 'anthracnose'],
    loss: 'Defoliation plus sunscald. A bad year costs a third of the crop.',
    manage: {
      now: [
        'Stop working in the block while the leaves are wet. You spread it on your clothes and hands.',
        'Start copper plus mancozeb on a 7-day cycle while the weather stays wet.',
      ],
      cultural: [
        'Use clean, treated seed. This comes in on seed more often than farmers realise.',
        'Hot-water treat your own saved seed: 50°C for 25 minutes, then dry.',
        'Rotate away from pepper and tomato for 2 years; plough in or remove old crop trash.',
        'Avoid overhead watering late in the day.',
      ],
      chemical: [
        { active: 'Copper oxychloride + mancozeb', example: 'Champ + Z-Force', how: 'Tank mix, every 7 days through wet weather', phiDays: 7, note: 'The standard pair. Copper alone loses steam once resistance builds.' },
        { active: 'Copper hydroxide', example: 'Kocide 3000', how: 'Protective', phiDays: 3, note: 'Do not exceed label rate; copper builds up in soil.' },
      ],
      organic: ['Clean seed and rotation are the real controls.', 'Bacillus subtilis sprays give partial suppression.'],
    },
  },

  {
    id: 'cercospora_leaf_spot',
    name: 'Cercospora leaf spot (frog-eye)',
    local: 'Frog eye',
    type: 'fungal',
    cause: 'Cercospora capsici',
    severity: 3,
    spread: 'moderate',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_spots_grey_centre: 5, leaf_spots_yellow_halo: 2, leaf_drop: 3,
      pattern_after_rain: 2, leaf_spots_large_brown: 1,
    },
    conditions: { wetness: 0.8 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Round spots with a pale grey or white centre and a dark brown border. The "frog eye" look is unmistakable once you have seen it.',
      'Spots stay on leaves and stems, not on fruit. Fruit damage means you are looking at something else.',
    ],
    lookalikes: ['bacterial_leaf_spot'],
    loss: 'Defoliation and smaller fruit rather than direct fruit rot.',
    manage: {
      now: ['Spray mancozeb or a triazole and keep the canopy open.'],
      cultural: ['Remove crop trash after harvest.', 'Do not crowd plants in the rainy season.'],
      chemical: [
        { active: 'Mancozeb', example: 'Dithane M-45', how: 'Every 10 days in wet weather', phiDays: 7, note: 'Protectant.' },
        { active: 'Difenoconazole', example: 'Score', how: 'When spots are already established', phiDays: 7, note: 'Alternate modes of action.' },
      ],
      organic: ['Neem oil slows it on light infections.'],
    },
  },

  {
    id: 'choanephora_wet_rot',
    name: 'Choanephora wet rot',
    local: 'Flower rot wit black hair',
    type: 'fungal',
    cause: 'Choanephora cucurbitarum',
    severity: 3,
    spread: 'fast while the weather stays wet, then stops',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      flower_black_whisker: 5, stem_white_mould: 2, fruit_soft_rot: 3, flower_drop: 2,
      pattern_after_rain: 3, dieback: 2,
    },
    conditions: { wetness: 1.0, waterlogging: 0.4 },
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'Look at a rotting flower or young fruit with a hand lens in the morning: black pin-head heads on fine white whiskers, like a tiny brush.',
      'It hits flowers and growing tips, spreads down the shoot, and stops dead as soon as the weather dries.',
    ],
    lookalikes: ['anthracnose', 'flower_drop_stress'],
    loss: 'Loses you a flush of flowers in the wettest weeks. Rarely kills plants.',
    manage: {
      now: ['Cut out and remove rotted shoots and flowers.', 'Open the canopy so air can move.'],
      cultural: ['Wider spacing and staking in the peak rains.', 'Avoid excess nitrogen, which makes soft growth it loves.'],
      chemical: [
        { active: 'Mancozeb', example: 'Z-Force', how: 'Protective cover during wet spells', phiDays: 7, note: 'Timing beats product here: spray before the wet run, not after.' },
      ],
      organic: ['Drop nitrogen, open the canopy, wait for the dry days. It usually burns itself out.'],
    },
  },

  {
    id: 'damping_off',
    name: 'Damping-off',
    local: 'Nursery die',
    type: 'fungal',
    cause: 'Pythium and Rhizoctonia in wet nursery soil',
    severity: 4,
    spread: 'very fast across a seedbed',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      seedling_topple: 5, seedling_no_germ: 2, pattern_patches: 2, stem_lesion_soil: 2,
      pattern_after_rain: 1, root_brown_rot: 2,
    },
    conditions: { wetness: 0.8 },
    stages: ['nursery'],
    confirm: [
      'Seedlings fall over with a thin, pinched, water-soaked stem right at the soil line while the top still looks fresh.',
      'It starts as a patch and runs outwards across the tray or bed within days.',
    ],
    lookalikes: ['termites'],
    loss: 'Can cost you a whole nursery, and with it the planting date.',
    manage: {
      now: [
        'Stop watering in the evening. Water in the morning only, so the surface dries before night.',
        'Remove affected seedlings and the soil under them.',
        'Thin the seedbed and lift the shade so air moves.',
      ],
      cultural: [
        'Sow in trays with sterile or solarised media rather than field soil.',
        'Do not sow thickly. Crowding is half the problem.',
        'Raise the seedbed so it never sits wet.',
      ],
      chemical: [
        { active: 'Metalaxyl-M + mancozeb', example: 'Ridomil Gold MZ', how: 'Light drench of the seedbed at sowing and again a week later', phiDays: 0, note: 'Nursery stage, long before harvest.' },
        { active: 'Thiram or captan seed dressing', example: '-', how: 'Dress the seed before sowing', phiDays: 0, note: 'Cheap insurance.' },
      ],
      organic: ['Trichoderma in the nursery mix.', 'Wood ash lightly dusted on the seedbed surface.'],
    },
  },

  {
    id: 'powdery_mildew',
    name: 'Powdery mildew',
    local: 'White powder',
    type: 'fungal',
    cause: 'Leveillula taurica',
    severity: 3,
    spread: 'moderate',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_white_powder: 5, leaf_spots_yellow_halo: 2, leaf_drop: 3, leaf_yellow_old: 2,
      pattern_after_dry: 2,
    },
    conditions: { dryness: 0.7 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Turn the leaf over. On pepper the white powder sits underneath, with a yellow blotch showing on top. Many farmers miss it because they only look at the upper surface.',
      'Heavy leaf fall follows, then sunscald on the naked fruit.',
    ],
    lookalikes: ['bacterial_leaf_spot', 'magnesium_deficiency'],
    loss: 'Defoliation in the dry months, then sunburnt fruit.',
    manage: {
      now: ['Spray sulphur or a triazole, covering the leaf undersides properly.'],
      cultural: ['Do not let plants go thirsty.', 'Remove the worst leaves.'],
      chemical: [
        { active: 'Wettable sulphur', example: 'Thiovit / Kumulus', how: 'Cover both leaf surfaces', phiDays: 1, note: 'Do not apply when it is above 32°C or you will scorch the leaves.' },
        { active: 'Difenoconazole', example: 'Score', how: 'Every 10-14 days', phiDays: 7, note: 'Alternate with sulphur.' },
      ],
      organic: ['Milk-and-water spray (1 part milk to 9 parts water) weekly works on light infections.', 'Potassium bicarbonate.'],
    },
  },

  {
    id: 'pvmv',
    name: 'Pepper veinal mottle virus',
    local: 'Virus / leaf mottle',
    type: 'viral',
    cause: 'PVMV, carried plant to plant by aphids',
    severity: 5,
    spread: 'as fast as the aphids move',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_vein_banding: 5, leaf_mosaic: 4, stunted: 3, fruit_deformed: 3, fruit_small: 3,
      leaf_narrow_strappy: 2, pattern_scattered: 2, pattern_field_edge: 2, leaf_insects_under: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Dark green banding hugging the veins, with a mottled light and dark pattern between them, and the plant obviously behind its neighbours.',
      'No spots, no mould, nothing washes off. Virus symptoms are in the growth itself.',
      'It usually starts at the field edge and moves inwards, following the aphids.',
      'A plant clinic can run a strip test if you need certainty. There is no cure either way.',
    ],
    lookalikes: ['cmv', 'leaf_curl_virus', 'herbicide_drift', 'magnesium_deficiency'],
    loss: 'Endemic in Nigerian pepper and the biggest single reason a habanero field underperforms.',
    manage: {
      now: [
        'Rogue infected plants early and bag them. One infected plant left standing is a reservoir for the whole block.',
        'Control the aphids in the surrounding weeds, not just on the crop.',
      ],
      cultural: [
        'Buy certified seed and resistant or tolerant varieties where you can get them.',
        'Keep a clean weed-free strip around the field. Weeds hold both the virus and the aphids.',
        'Do not plant a young nursery next to an old, infected pepper field. Separate them in space and time.',
        'A maize or sorghum barrier row round the plot slows incoming aphids.',
        'Silver-grey plastic mulch repels aphids landing on young plants.',
      ],
      chemical: [
        { active: 'No cure for the virus', example: '-', how: 'Spraying a sick plant does nothing', phiDays: 0, note: 'Insecticide is for slowing the aphids, and only helps before infection.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Aphid control on young plants', phiDays: 14, note: 'Very toxic to bees. Never spray while flowers are open and bees are working.' },
      ],
      organic: ['Neem for aphids, weekly on young plants.', 'Rogue, rogue, rogue. It is the whole strategy.'],
    },
  },

  {
    id: 'cmv',
    name: 'Cucumber mosaic virus',
    local: 'Mosaic',
    type: 'viral',
    cause: 'CMV, spread by aphids from a very wide range of weeds',
    severity: 4,
    spread: 'fast where aphids are heavy',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_mosaic: 5, leaf_narrow_strappy: 4, stunted: 3, fruit_deformed: 2,
      pattern_scattered: 2, fruit_small: 2, leaf_thick_leathery: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Light and dark green mosaic, and new leaves that come out narrow and strappy, sometimes almost like a shoelace.',
      'Ring patterns can show on the fruit.',
      'Look at the weeds around the plot. CMV lives in a huge range of them.',
    ],
    lookalikes: ['pvmv', 'herbicide_drift'],
    loss: 'Stunted plants that never pay back what you spent on them.',
    manage: {
      now: ['Rogue and bag infected plants.'],
      cultural: ['Clear broadleaf weeds around the plot.', 'Do not overlap an old crop with a new nursery.'],
      chemical: [{ active: 'No cure', example: '-', how: 'Manage the aphid vector before infection only', phiDays: 0, note: '' }],
      organic: ['Neem and reflective mulch on young plants.'],
    },
  },

  {
    id: 'leaf_curl_virus',
    name: 'Pepper leaf curl (whitefly virus)',
    local: 'Leaf curl',
    type: 'viral',
    cause: 'Begomovirus carried by whitefly',
    severity: 4,
    spread: 'fast where whitefly is heavy',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_curl_up: 5, leaf_thick_leathery: 4, stunted: 3, leaf_flies_rise: 3,
      fruit_small: 2, leaf_sticky_sooty: 1, pattern_field_edge: 2,
    },
    conditions: { dryness: 0.5 },
    stages: ['establish', 'vegetative', 'flowering'],
    confirm: [
      'Leaves curl upwards, go thick and leathery, and the internodes shorten so the plant looks bunched.',
      'Shake the plant. A cloud of tiny white flies means whitefly is present and this is the likely answer.',
      'Thrips also curl leaves upward, but thrips leave silvering and black specks. Virus does not.',
    ],
    lookalikes: ['thrips', 'pvmv'],
    loss: 'Early infection means a plant that never yields. Late infection costs less.',
    manage: {
      now: ['Rogue badly curled young plants.', 'Hit the whitefly, including the leaf undersides.'],
      cultural: [
        'Yellow sticky traps to catch the adults and to tell you when numbers are rising.',
        'Nursery under insect-proof net is the highest-value change: protect the seedling and you protect the season.',
        'Clear weeds that host whitefly.',
      ],
      chemical: [
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar, cover leaf undersides', phiDays: 7, note: 'Rotate with a different mode of action.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Drench at transplanting protects for weeks', phiDays: 14, note: 'Bee-toxic. Not during open flowering.' },
      ],
      organic: ['Neem oil weekly.', 'Insect net over the nursery.', 'Yellow sticky traps.'],
    },
  },

  {
    id: 'aphids',
    name: 'Aphids',
    local: 'Small soft insect',
    type: 'insect',
    cause: 'Aphis gossypii and friends',
    severity: 3,
    spread: 'explosive in warm dry spells',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_insects_under: 5, leaf_sticky_sooty: 4, leaf_curl_down: 3, leaf_ants: 3,
      leaf_yellow_new: 2, stunted: 2, leaf_drop: 1,
    },
    conditions: { dryness: 0.6 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Turn over the youngest leaves and growing tips. Clusters of small soft pear-shaped insects, green, black or yellow.',
      'Ants running up and down the plant is the tell from ten paces: they farm aphids for the honeydew.',
      'Sticky leaves going black with sooty mould.',
    ],
    lookalikes: ['whitefly', 'mealybug'],
    loss: 'Direct damage is modest. The real cost is the virus they inject while feeding.',
    manage: {
      now: [
        'Spot-spray the infested plants rather than blanket-spraying the field. It saves money and saves the beneficials.',
        'Check for ladybird larvae and hoverfly maggots first. If they are working, hold your hand.',
      ],
      cultural: ['Do not over-apply nitrogen: soft lush growth pulls aphids in.', 'Keep the weed strip clean.'],
      chemical: [
        { active: 'Neem seed kernel extract', example: 'home-made or Neemazal', how: 'Cover undersides, repeat after 5-7 days', phiDays: 0, note: 'First choice while fruit is being picked.' },
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar', phiDays: 7, note: 'Effective and reasonably kind to predators at label rate.' },
        { active: 'Lambda-cyhalothrin', example: 'Karate / Lambda Super', how: 'Foliar when numbers are high', phiDays: 7, note: 'Broad-spectrum: it kills the ladybirds too, so use it sparingly.' },
      ],
      organic: ['Soapy water (mild soap, 20 g in 10 L) on a cloudy evening.', 'Neem.', 'Encourage ladybirds by not blanket-spraying.'],
    },
  },

  {
    id: 'whitefly',
    name: 'Whitefly',
    local: 'Small white fly',
    type: 'insect',
    cause: 'Bemisia tabaci',
    severity: 4,
    spread: 'fast, and it carries virus',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_flies_rise: 5, leaf_sticky_sooty: 4, leaf_yellow_old: 2, leaf_curl_up: 2,
      stunted: 2, leaf_insects_under: 2,
    },
    conditions: { dryness: 0.6 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Shake a plant in the morning: a cloud of tiny white flies goes up and settles back.',
      'Scales and eggs sit on the underside of the young leaves. Check there, not on top.',
      'Yellow sticky traps give you a count you can track week to week.',
    ],
    lookalikes: ['aphids', 'leaf_curl_virus'],
    loss: 'Sooty mould downgrades fruit, and the begomovirus it carries is worse than the insect.',
    manage: {
      now: ['Spray undersides in the early morning while the flies are sluggish.', 'Put out yellow sticky traps.'],
      cultural: ['Insect net over the nursery.', 'Remove and burn heavily infested old crop at the end of the cycle.', 'Do not plant a new block beside an old infested one.'],
      chemical: [
        { active: 'Acetamiprid', example: 'Mospilan', how: 'Foliar, undersides', phiDays: 7, note: 'Rotate groups; whitefly builds resistance quickly.' },
        { active: 'Spiromesifen', example: 'Oberon', how: 'Hits eggs and nymphs', phiDays: 3, note: 'Good rotation partner.' },
        { active: 'Imidacloprid', example: 'Confidor', how: 'Soil drench at transplant', phiDays: 14, note: 'Bee-toxic; not during open flowering.' },
      ],
      organic: ['Neem oil every 5-7 days.', 'Yellow sticky traps.', 'Insect-proof nursery net.'],
    },
  },

  {
    id: 'thrips',
    name: 'Thrips',
    local: 'Leaf curl insect',
    type: 'insect',
    cause: 'Thrips and Scirtothrips species',
    severity: 4,
    spread: 'fast in dry weather',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_silver_bronze: 5, leaf_curl_up: 4, leaf_black_specks: 4, flower_scarred: 3,
      fruit_deformed: 3, leaf_stipple: 2, pattern_after_dry: 2, flower_drop: 2,
    },
    conditions: { dryness: 0.8 },
    stages: ['nursery', 'establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Hold a white paper under a flower or a curled shoot and tap it. Slim yellow-brown insects that run rather than fly off.',
      'Silvery or bronzed patches with tiny black specks of frass, and leaves curling upward with the edges puckered.',
      'Scarred, russeted fruit that will not make first grade even though it is edible.',
    ],
    lookalikes: ['leaf_curl_virus', 'red_spider_mite', 'broad_mite'],
    loss: 'Downgrades fruit and, on chili, can take the flowers off entirely in a dry spell.',
    manage: {
      now: ['Spray at first sign, covering flowers and growing points, and repeat in 5-7 days to catch the next hatch.'],
      cultural: ['Blue sticky traps for monitoring.', 'Irrigate: dry stressed plants are thrips plants.', 'Clear weed hosts.'],
      chemical: [
        { active: 'Spinosad', example: 'Tracer / Laser', how: 'Foliar into the flowers', phiDays: 3, note: 'The best fit here: effective and short waiting period. Spray at dusk to spare bees.' },
        { active: 'Emamectin benzoate', example: 'Emastar', how: 'Foliar', phiDays: 3, note: 'Rotate with spinosad.' },
        { active: 'Lambda-cyhalothrin', example: 'Karate', how: 'Foliar', phiDays: 7, note: 'Thrips develop resistance fast; do not use it back to back.' },
      ],
      organic: ['Neem suppresses the young stages.', 'Keep the crop watered.', 'Blue sticky traps.'],
    },
  },

  {
    id: 'red_spider_mite',
    name: 'Red spider mite',
    local: 'Red insect for under leaf',
    type: 'mite',
    cause: 'Tetranychus species',
    severity: 4,
    spread: 'explosive in hot dry weather',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_webbing: 5, leaf_stipple: 4, leaf_silver_bronze: 3, leaf_drop: 3,
      pattern_after_dry: 3, pattern_after_spray: 2, leaf_yellow_old: 2,
    },
    conditions: { dryness: 1.0 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Fine webbing on the underside and in the leaf axils, with dust-sized specks moving on it. A hand lens settles it.',
      'Leaves stippled with tiny pale dots, going bronze, then dropping.',
      'It nearly always follows a hot dry spell, or a broad-spectrum insecticide that killed the predatory mites.',
    ],
    lookalikes: ['thrips', 'broad_mite'],
    loss: 'Can strip a habanero block in three weeks of harmattan-dry weather.',
    manage: {
      now: [
        'Use a proper miticide, not a general insecticide. Pyrethroids make spider mite worse by killing its predators.',
        'Spray the undersides. Coverage is everything with mites.',
      ],
      cultural: ['Irrigate and keep dust down; dusty roadside rows are always hit first.', 'Stop routine pyrethroid sprays.'],
      chemical: [
        { active: 'Abamectin', example: 'Dynamec / Abamex', how: 'Foliar, thorough underside coverage', phiDays: 7, note: 'Add a wetter. Repeat after 7 days.' },
        { active: 'Wettable sulphur', example: 'Thiovit', how: 'Cheap knockdown', phiDays: 1, note: 'Not above 32°C.' },
        { active: 'Spiromesifen', example: 'Oberon', how: 'Hits eggs and young stages', phiDays: 3, note: 'Good rotation partner.' },
      ],
      organic: ['Neem oil plus a wetter, twice, 5 days apart.', 'Water the crop properly; mites hate humidity.'],
    },
  },

  {
    id: 'broad_mite',
    name: 'Broad mite',
    local: 'Tip curl mite',
    type: 'mite',
    cause: 'Polyphagotarsonemus latus',
    severity: 4,
    spread: 'fast, often unnoticed until damage shows',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_curl_down: 5, leaf_narrow_strappy: 3, leaf_thick_leathery: 3, dieback: 2,
      fruit_scabby: 3, stunted: 2, leaf_silver_bronze: 2,
    },
    conditions: { wetness: 0.4, dryness: 0.4 },
    stages: ['vegetative', 'flowering', 'fruiting'],
    confirm: [
      'Damage is all at the growing tip: new leaves cupped downward, hardened, bronzed underneath, and the tip stops growing.',
      'You will not see the mite without a strong lens. Diagnose by the damage pattern at the tip.',
      'Often mistaken for virus or herbicide drift. The difference: broad mite damage is only on new growth and recovers after a miticide.',
    ],
    lookalikes: ['herbicide_drift', 'pvmv', 'thrips'],
    loss: 'Stops the plant in its tracks during flowering. Common on habanero here and badly under-diagnosed.',
    manage: {
      now: ['Apply a miticide to the growing points, twice, 5 days apart.'],
      cultural: ['Do not move workers or tools from an infested block to a clean one.'],
      chemical: [
        { active: 'Abamectin', example: 'Dynamec', how: 'Target the growing tips', phiDays: 7, note: 'Two applications 5 days apart.' },
        { active: 'Wettable sulphur', example: 'Thiovit', how: 'Cheap and effective on broad mite', phiDays: 1, note: 'Avoid in extreme heat.' },
      ],
      organic: ['Sulphur.', 'Neem, though it is weaker on this one.'],
    },
  },

  {
    id: 'fruit_borer',
    name: 'Fruit borer / armyworm',
    local: 'Worm for pepper',
    type: 'insect',
    cause: 'Helicoverpa armigera and Spodoptera species',
    severity: 4,
    spread: 'moth flights, so it arrives suddenly',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_hole_frass: 5, fruit_maggots: 4, leaf_holes_chewed: 3, fruit_dropping: 2, fruit_soft_rot: 1,
    },
    conditions: {},
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'A clean round hole near the fruit stalk with wet droppings around it, and a caterpillar inside when you open it.',
      'Once the hole is there, secondary rot follows within days.',
      'Scout at dusk. That is when the caterpillars feed on the outside.',
    ],
    lookalikes: ['fruit_fly'],
    loss: 'Bores one fruit after another. Ten percent of a picking can go in a bad week.',
    manage: {
      now: [
        'Hand-pick and destroy bored fruit. Do not leave them on the ground; the caterpillar just walks to the next plant.',
        'Spray at egg-hatch, in the evening. A caterpillar already inside the fruit cannot be reached.',
      ],
      cultural: ['Pheromone traps tell you when the moths have arrived so you spray at the right time.', 'Deep ploughing between cycles exposes pupae.'],
      chemical: [
        { active: 'Bacillus thuringiensis', example: 'Dipel', how: 'Evening spray on small caterpillars', phiDays: 0, note: 'Best choice during picking: no waiting period at all.' },
        { active: 'Emamectin benzoate', example: 'Emastar', how: 'Foliar at egg-hatch', phiDays: 3, note: 'Very effective. Respect the 3-day wait.' },
        { active: 'Spinosad', example: 'Tracer', how: 'Foliar', phiDays: 3, note: 'Rotate with Bt and emamectin.' },
      ],
      organic: ['Bt.', 'Neem as an egg-laying deterrent.', 'Hand-picking at dusk works on a small plot.'],
    },
  },

  {
    id: 'fruit_fly',
    name: 'Fruit fly',
    local: 'Fly wey dey spoil pepper',
    type: 'insect',
    cause: 'Bactrocera and Dacus species',
    severity: 3,
    spread: 'from surrounding fruit trees and fallen fruit',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_sting_marks: 5, fruit_maggots: 4, fruit_dropping: 3, fruit_soft_rot: 3,
    },
    conditions: { wetness: 0.4 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A small puncture on the skin with a slight dimple, and small white maggots inside when you cut it open.',
      'Fruit softens and drops early. Bell pepper suffers most because of the thick flesh.',
      'Mango and guava trees around the farm are usually the source.',
    ],
    lookalikes: ['fruit_borer', 'anthracnose'],
    loss: 'Worse near orchards. Mainly a fresh-market quality problem.',
    manage: {
      now: [
        'Collect every fallen and stung fruit daily and drown it in water or bury it 50 cm deep. This one act breaks the cycle.',
        'Hang protein bait or methyl eugenol traps around the block.',
      ],
      cultural: ['Harvest slightly earlier rather than letting fruit over-ripen on the plant.', 'Clear fallen mango and guava around the farm.'],
      chemical: [
        { active: 'Spinosad bait (GF-120 style)', example: 'Success Appat', how: 'Spot-spray bait droplets on foliage, not a full cover spray', phiDays: 1, note: 'Baiting uses a fraction of the chemical of a cover spray and spares beneficials.' },
      ],
      organic: ['Sanitation and traps do most of it.', 'Bag individual bell fruit on a small plot.'],
    },
  },

  {
    id: 'root_knot_nematode',
    name: 'Root-knot nematode',
    local: 'Knot for root',
    type: 'nematode',
    cause: 'Meloidogyne species',
    severity: 4,
    spread: 'slow, but it builds up and stays',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      root_knots: 5, wilt_midday: 3, stunted: 4, leaf_yellow_old: 2,
      pattern_patches: 3, root_few: 2, fruit_small: 2,
    },
    conditions: { dryness: 0.3 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Dig a stunted plant, wash the roots in water, and look for hard swellings and knots along them. Nitrogen nodules on a legume rub off; nematode galls are part of the root.',
      'The tell-tale is a patch of plants that wilts at midday, recovers at night, and does not respond to fertiliser.',
      'Sandy soils here favour it.',
    ],
    lookalikes: ['fusarium_wilt', 'nitrogen_deficiency'],
    loss: 'Quiet 20-40% yield theft, and it opens the door for Fusarium.',
    manage: {
      now: ['Mark the patch. Do not replant pepper into it next cycle.'],
      cultural: [
        'Rotate with maize, rice or a marigold cover crop. Never tomato, garden egg or okra.',
        'Plough in African marigold (Tagetes) as a green manure; it genuinely suppresses Meloidogyne.',
        'Solarise with clear plastic through the dry season.',
        'Load the bed with organic matter: compost feeds the fungi and mites that eat nematodes.',
      ],
      chemical: [
        { active: 'Avoid carbofuran (Furadan)', example: '-', how: 'Do not use it', phiDays: 0, note: 'Extremely toxic to people and birds, banned in many markets and a real risk to anyone eating your pepper. Rotation and marigold are safer and work.' },
        { active: 'Fluensulfone or fluopyram', example: 'Nimitz / Velum', how: 'Soil applied before planting where registered and available', phiDays: 14, note: 'Expensive. Only worth it on a proven heavy infestation.' },
      ],
      organic: ['Marigold rotation.', 'Neem cake worked into the bed at 2-3 t/ha.', 'Compost.'],
    },
  },

  {
    id: 'variegated_grasshopper',
    name: 'Variegated grasshopper',
    local: 'Big coloured grasshopper',
    type: 'insect',
    cause: 'Zonocerus variegatus',
    severity: 3,
    spread: 'in bands, from bush edges',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_holes_chewed: 5, pattern_field_edge: 4, dieback: 1, stem_girdled_base: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'You will see them: fat, slow, brightly marked yellow, green and black, sitting in groups, and they do not fly off readily.',
      'Ragged chewing from the field edge inwards, worst next to bush and around the end of the rains.',
    ],
    lookalikes: ['fruit_borer'],
    loss: 'Defoliation at the field margin, occasionally deep into the block when numbers are high.',
    manage: {
      now: [
        'They cluster and roost. Knock them into a bucket of soapy water early in the morning while they are cold and slow. On most plots this beats spraying.',
        'If you must spray, treat the field-edge rows and the bush margin, not the whole field.',
      ],
      cultural: ['Clear the bush margin and destroy egg-laying sites in bare damp soil at the end of the rains.'],
      chemical: [
        { active: 'Lambda-cyhalothrin', example: 'Karate', how: 'Edge rows and margin only', phiDays: 7, note: 'A border treatment does the job; a full-field spray is wasted money.' },
      ],
      organic: ['Hand collection at dawn.', 'Metarhizium biopesticide where available.'],
    },
  },

  {
    id: 'mealybug',
    name: 'Mealybug',
    local: 'White cotton insect',
    type: 'insect',
    cause: 'Phenacoccus and Planococcus species',
    severity: 3,
    spread: 'moved around by ants',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_insects_under: 3, leaf_sticky_sooty: 4, leaf_ants: 4, stunted: 2,
      leaf_yellow_new: 2, dieback: 2,
    },
    conditions: { dryness: 0.5 },
    stages: ['vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'White waxy cottony masses tucked into leaf axils, under the calyx of the fruit and at the stem joints.',
      'Ants everywhere. The ants carry them from plant to plant and protect them.',
    ],
    lookalikes: ['aphids', 'whitefly'],
    loss: 'Sooty mould downgrades fruit; heavy infestations stunt the plant.',
    manage: {
      now: ['Deal with the ants and you have half-solved the mealybug.', 'Spot-treat with oil-based spray; the wax coat repels water-based ones.'],
      cultural: ['Remove and bag heavily infested shoots.', 'Do not move seedlings from an infested nursery.'],
      chemical: [
        { active: 'Acetamiprid + horticultural oil', example: 'Mospilan + oil', how: 'Spot spray, thorough coverage into the axils', phiDays: 7, note: 'The oil is what gets through the wax.' },
      ],
      organic: ['Neem oil with soap.', 'Ant baiting.'],
    },
  },

  {
    id: 'termites',
    name: 'Termites',
    local: 'Termite / ant-ant',
    type: 'insect',
    cause: 'Macrotermes and others',
    severity: 3,
    spread: 'from nests nearby',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      stem_girdled_base: 5, stem_soil_tubes: 5, wilt_sudden_green: 2, seedling_topple: 2,
      pattern_after_dry: 2, pattern_scattered: 2,
    },
    conditions: { dryness: 0.7 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Soil sheeting or mud tubes running up the stem, and the bark eaten away underneath.',
      'Plants topple at the base in a dry spell, mostly on land newly cleared from bush.',
    ],
    lookalikes: ['phytophthora_blight', 'damping_off'],
    loss: 'Scattered plant loss, worst on newly cleared land and in the dry season.',
    manage: {
      now: ['Find and treat the nest. Killing foragers on one plant achieves nothing.', 'Firm soil around the base and irrigate; dry soil invites them.'],
      cultural: ['Remove buried wood and crop residue when clearing.', 'Keep the crop watered in the dry season.'],
      chemical: [
        { active: 'Fipronil or bifenthrin', example: '-', how: 'Treat the nest and the planting hole, not the foliage', phiDays: 14, note: 'Targeted soil use only. Never spray these onto fruit.' },
      ],
      organic: ['Wood ash and neem cake in the planting hole.', 'Destroy nests physically.'],
    },
  },

  {
    id: 'blossom_end_rot',
    name: 'Blossom-end rot',
    local: 'Black bottom',
    type: 'disorder',
    cause: 'Calcium not reaching the fruit, usually because water supply swung',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_black_end: 5, fruit_soft_rot: 1, pattern_whole_bed: 2, leaf_margin_scorch: 1,
    },
    conditions: { dryness: 0.5 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A sunken, leathery, dark patch exactly at the blossom end, the bottom tip of the fruit. Firm and dry, not slimy.',
      'It is not an infection and it does not spread from fruit to fruit. Do not spray fungicide at it.',
      'Bell pepper gets it worst because the fruit is big and fills fast.',
      'Think back a week or two: did the bed dry right out and then get flooded or heavily rained on? That swing is the cause.',
    ],
    lookalikes: ['anthracnose'],
    loss: 'Unsellable fruit in the first flush, then it usually settles down once water is steady.',
    manage: {
      now: [
        'Even out the water. Steady moderate moisture beats drought-then-flood every time. Mulch holds it steady.',
        'Foliar calcium nitrate, weekly for three weeks, helps the fruit still forming. It cannot repair fruit already marked.',
        'Pick off affected fruit so the plant stops feeding them.',
      ],
      cultural: [
        'Lime acid beds before planting: most soils here are short of calcium to begin with.',
        'Do not over-apply nitrogen, especially ammonium forms; it competes with calcium uptake.',
        'Mulch heavily. It is the cheapest and most reliable fix.',
      ],
      chemical: [
        { active: 'Calcium nitrate', example: 'foliar at 5 g/L', how: 'Weekly during fruit fill', phiDays: 0, note: 'A nutrient, not a pesticide. No waiting period.' },
      ],
      organic: ['Mulch, steady irrigation, lime, eggshell or wood ash worked in before planting.'],
    },
  },

  {
    id: 'sunscald',
    name: 'Sunscald',
    local: 'Sun don burn am',
    type: 'disorder',
    cause: 'Fruit exposed to direct sun after the canopy was lost',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      fruit_pale_papery: 5, leaf_drop: 3, fruit_soft_rot: 1, pattern_whole_bed: 1,
    },
    conditions: { dryness: 0.6 },
    stages: ['fruiting', 'harvest'],
    confirm: [
      'A pale, papery, flattened patch on the side of the fruit that faces the sun. It often goes mouldy afterwards, which sends people chasing the wrong problem.',
      'Always follows leaf loss. Ask what took the leaves off: disease, mites, or over-hard pruning.',
    ],
    lookalikes: ['anthracnose'],
    loss: 'Secondary. Fix the defoliation and this goes away.',
    manage: {
      now: ['Find and treat whatever removed the leaves.', 'Do not prune hard in the dry season.'],
      cultural: ['Keep the canopy healthy.', 'Shade netting on bell pepper in the dry months.'],
      chemical: [{ active: 'None', example: '-', how: 'Nothing to spray', phiDays: 0, note: 'Treat the cause of the leaf loss instead.' }],
      organic: ['Canopy management.'],
    },
  },

  {
    id: 'flower_drop_stress',
    name: 'Flower and fruit drop',
    local: 'Flower dey fall',
    type: 'disorder',
    cause: 'Heat above 33°C, heavy rain at flowering, drought, or too much nitrogen',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      flower_drop: 5, fruit_dropping: 3, pattern_whole_bed: 3, pattern_after_dry: 2, pattern_after_rain: 2,
    },
    conditions: { dryness: 0.4, wetness: 0.3 },
    stages: ['flowering', 'fruiting'],
    confirm: [
      'Flowers drop clean off at the joint with no rot, no insect, no mark.',
      'Whole bed does it at once, which points at weather or feeding rather than a pest.',
      'Check the last two weeks: a run of very hot afternoons, a heavy downpour on open flowers, a dry-out, or a recent heavy urea dose.',
    ],
    lookalikes: ['thrips', 'choanephora_wet_rot'],
    loss: 'A lost flush. The plant usually flowers again if you fix the cause.',
    manage: {
      now: [
        'Water steadily; do not let the bed swing between bone dry and soaked.',
        'Stop nitrogen-heavy feeding and switch to a potassium-led fertiliser.',
        'Shade cloth over bell pepper through the hottest weeks.',
      ],
      cultural: ['Time the planting so flowering misses the hottest and the wettest weeks.', 'Mulch to buffer soil moisture.'],
      chemical: [
        { active: 'Boron + calcium foliar', example: 'micronutrient mix', how: 'At first flowering', phiDays: 0, note: 'Helps set where boron is short. Do not overdo boron; it turns toxic fast.' },
      ],
      organic: ['Mulch and steady irrigation.', 'Shade in the hot months.'],
    },
  },

  {
    id: 'nitrogen_deficiency',
    name: 'Nitrogen shortage',
    local: 'Plant dey hungry',
    type: 'deficiency',
    cause: 'Not enough nitrogen, or it leached away in heavy rain',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_yellow_old: 5, stunted: 3, yellowing_whole: 3, pattern_whole_bed: 3,
      fruit_small: 2, pattern_after_rain: 2,
    },
    conditions: { wetness: 0.4 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'Even, pale yellowing that starts on the oldest bottom leaves and works upward, with no spots and no pattern within the leaf.',
      'The whole bed looks the same, which separates it from a disease.',
      'Heavy rain leaches nitrogen out of these sandy soils fast; three weeks of downpours will do it.',
    ],
    lookalikes: ['root_knot_nematode', 'waterlogging', 'fusarium_wilt'],
    loss: 'Small plants, small fruit, low yield. Cheap to fix if you catch it.',
    manage: {
      now: ['Side-dress urea at about 100 kg/ha, placed beside the plant and watered in, or give a soluble feed if you fertigate.'],
      cultural: ['Split nitrogen into 3 or 4 doses instead of one big one. In this rainfall, one big dose is money down the drain.', 'Build organic matter so the soil holds nutrients at all.'],
      chemical: [{ active: 'Urea 46-0-0 or NPK 15-15-15', example: '-', how: 'Side-dress and water in', phiDays: 0, note: 'Fertiliser, no waiting period.' }],
      organic: ['Well-rotted poultry manure.', 'Legume cover crop in the fallow.'],
    },
  },

  {
    id: 'potassium_deficiency',
    name: 'Potassium shortage',
    local: 'Leaf edge dey burn',
    type: 'deficiency',
    cause: 'Potassium short, usually because a heavy picking took it off the field',
    severity: 3,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_margin_scorch: 5, leaf_yellow_old: 3, fruit_small: 3, pattern_whole_bed: 2, leaf_drop: 2,
    },
    conditions: {},
    stages: ['fruiting', 'harvest', 'decline'],
    confirm: [
      'Older leaves scorch from the edge inwards while the middle of the leaf stays green.',
      'Fruit is small and does not fill or colour properly.',
      'It shows up after a heavy pick, because every crate carries potassium off the farm.',
    ],
    lookalikes: ['magnesium_deficiency', 'nitrogen_deficiency'],
    loss: 'Fruit size and colour, which is exactly what the buyer pays for.',
    manage: {
      now: ['Apply NPK 12-12-17 + 2MgO, or muriate of potash, and water it in.'],
      cultural: ['Feed after every second picking through the harvest window, not just at planting.'],
      chemical: [{ active: 'NPK 12-12-17+2MgO or KCl', example: '-', how: 'Side-dress', phiDays: 0, note: 'Fertiliser.' }],
      organic: ['Wood ash, applied with care: it also raises pH, which here is usually welcome.'],
    },
  },

  {
    id: 'magnesium_deficiency',
    name: 'Magnesium shortage',
    local: 'Yellow for middle of leaf',
    type: 'deficiency',
    cause: 'Magnesium short in acid, sandy, heavily leached soil',
    severity: 2,
    spread: 'not contagious',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_interveinal: 5, leaf_yellow_old: 3, leaf_drop: 2, pattern_whole_bed: 2,
    },
    conditions: { wetness: 0.3 },
    stages: ['flowering', 'fruiting', 'harvest'],
    confirm: [
      'Yellow between the veins on the older leaves while the veins themselves stay bright green, giving a herringbone look.',
      'Common here: leached sandy soil plus heavy potassium feeding locks magnesium out.',
    ],
    lookalikes: ['pvmv', 'potassium_deficiency'],
    loss: 'Early leaf loss and weaker fruit fill.',
    manage: {
      now: ['Foliar Epsom salts (magnesium sulphate) at 10 g/L, twice, a week apart.'],
      cultural: ['Use dolomitic lime rather than plain lime when you lime; it supplies magnesium and corrects pH together.', 'Do not overdo potassium.'],
      chemical: [{ active: 'Magnesium sulphate', example: 'Epsom salt', how: 'Foliar or soil', phiDays: 0, note: 'Nutrient.' }],
      organic: ['Dolomitic lime.', 'Compost.'],
    },
  },

  {
    id: 'waterlogging',
    name: 'Waterlogging',
    local: 'Water don stay for bed',
    type: 'disorder',
    cause: 'Roots drowning in a bed that will not drain',
    severity: 4,
    spread: 'follows the low ground',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_yellow_old: 4, wilt_midday: 3, pattern_low_wet: 5, root_brown_rot: 3,
      pattern_after_rain: 4, stunted: 2, leaf_drop: 2, pattern_patches: 2,
    },
    conditions: { waterlogging: 1.0 },
    stages: ['establish', 'vegetative', 'flowering', 'fruiting', 'harvest'],
    confirm: [
      'The plant wilts while the soil is visibly wet. That contradiction is the signature.',
      'Dig 20 cm down: grey, smelly, airless soil, and brown mushy roots.',
      'It follows the contour, worst in the low corner, which no disease does so neatly.',
      'Waterlogged roots are also how Phytophthora gets in, so the two often arrive together.',
    ],
    lookalikes: ['phytophthora_blight', 'nitrogen_deficiency'],
    loss: 'Slows the crop badly and opens the door to root rot. Entirely preventable with bed height.',
    manage: {
      now: ['Cut drains and get the water off the bed today.', 'Do not add fertiliser to a drowning root system; it cannot take it up.'],
      cultural: [
        'Raise beds to 30 cm before the rains. In this rainfall that is not optional.',
        'Break any hardpan with a ripper or deep hoe before planting.',
        'Lay the beds across the slope so water runs off, not along the row.',
      ],
      chemical: [{ active: 'None', example: '-', how: 'This is an engineering problem, not a spray problem', phiDays: 0, note: 'A preventive Phytophthora drench is worth it once drainage is fixed.' }],
      organic: ['Raised beds, organic matter, drains.'],
    },
  },

  {
    id: 'herbicide_drift',
    name: 'Herbicide drift',
    local: 'Spray don touch am',
    type: 'disorder',
    cause: 'Weedkiller drifting in from a neighbour, or a sprayer that was not washed out',
    severity: 3,
    spread: 'not contagious, but shows along the windward edge',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      leaf_narrow_strappy: 5, leaf_curl_down: 4, fruit_deformed: 3, stunted: 3,
      pattern_field_edge: 4, pattern_after_spray: 4, dieback: 2,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering', 'fruiting'],
    confirm: [
      'New growth comes out cupped, strappy and distorted while the older leaves below look perfectly normal.',
      'Damage is strongest on the edge facing the neighbour or the road and fades as you walk inwards. Virus does not fade like that.',
      'Ask what was sprayed nearby, and check whether the knapsack was used for weedkiller before this.',
    ],
    lookalikes: ['pvmv', 'cmv', 'broad_mite'],
    loss: 'A mild hit grows out in three weeks. A heavy one costs the cycle.',
    manage: {
      now: [
        'Irrigate and feed lightly to push new clean growth.',
        'Keep a separate knapsack for herbicide, marked in paint. Never wash one out and use it for insecticide; residue survives rinsing.',
        'Photograph the damage and the date. If a neighbour caused it you will want the record.',
      ],
      cultural: ['Agree spray timing with neighbours.', 'Plant a barrier hedge on the windward side.'],
      chemical: [{ active: 'None', example: '-', how: 'Nothing to spray', phiDays: 0, note: 'Support the plant and wait for clean growth.' }],
      organic: ['Time and good feeding.'],
    },
  },

  {
    id: 'acid_soil',
    name: 'Acid soil / aluminium toxicity',
    local: 'Ground too sour',
    type: 'disorder',
    cause: 'Soil pH below about 5, common in Niger Delta soils',
    severity: 3,
    spread: 'the whole block behaves the same',
    crops: ['bell', 'chili', 'habanero'],
    symptoms: {
      stunted: 5, root_few: 4, leaf_yellow_new: 3, pattern_whole_bed: 4,
      fruit_small: 2, leaf_interveinal: 1,
    },
    conditions: {},
    stages: ['establish', 'vegetative', 'flowering'],
    confirm: [
      'The whole block is stunted and yet fertiliser makes little difference. That combination points at pH.',
      'Roots are short and stubby with few fine feeder roots.',
      'Test the soil. A cheap pH meter or a soil test at the Rivers State ADP office settles it, and it is the best money you will spend all season.',
    ],
    lookalikes: ['root_knot_nematode', 'nitrogen_deficiency'],
    loss: 'Caps the yield of the whole block no matter what you spend on fertiliser.',
    manage: {
      now: ['Test the pH before you buy anything else.'],
      cultural: [
        'Apply agricultural lime or dolomite at 1-2 t/ha, worked in 3-4 weeks before planting. Aim for pH 6.0-6.5.',
        'Dolomitic lime is better value here because it fixes magnesium at the same time.',
        'Build organic matter every cycle; it buffers pH and holds the nutrients.',
      ],
      chemical: [{ active: 'Agricultural lime or dolomite', example: '-', how: 'Broadcast and work in before planting', phiDays: 0, note: 'Give it 3-4 weeks to react before transplanting.' }],
      organic: ['Wood ash in small amounts.', 'Compost.'],
    },
  },
];

export const PROBLEM_BY_ID = Object.fromEntries(PROBLEMS.map((p) => [p.id, p]));

export const PROBLEM_TYPES = {
  fungal: { label: 'Fungal disease', colour: '#8e6c3a' },
  bacterial: { label: 'Bacterial disease', colour: '#b23c3c' },
  viral: { label: 'Virus', colour: '#7b4397' },
  insect: { label: 'Insect pest', colour: '#c77800' },
  mite: { label: 'Mite', colour: '#a3562a' },
  nematode: { label: 'Nematode', colour: '#5d6d3f' },
  disorder: { label: 'Disorder or damage', colour: '#4a6fa5' },
  deficiency: { label: 'Nutrient shortage', colour: '#2e7d5b' },
};

/** Everything a spray of this problem's chemicals implies for harvest timing. */
export function longestPhi(problemId) {
  const p = PROBLEM_BY_ID[problemId];
  if (!p) return 0;
  return Math.max(0, ...p.manage.chemical.map((c) => c.phiDays || 0));
}
