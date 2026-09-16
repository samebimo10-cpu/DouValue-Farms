// The farm's own adviser: agronomy and farm economics applied to this farm's
// own numbers, with no network and no account anywhere.
//
// This is the floor, not the ceiling. When the farm has a server of its own it
// can also ask a wider adviser that reads current knowledge off the internet —
// today's market, a new advisory, a product deregistered since this file was
// written. But the wider one needs signal and a key, and a farm in Rivers State
// cannot depend on either. So everything here works on a phone in a field with
// the network off, and the online answer is added to it rather than replacing
// it.
//
// Every recommendation has to survive four questions, or it does not ship:
//
//   why now   — what in the data triggered it, quoted back
//   so what   — what it costs to ignore, in kilograms or naira where possible
//   do what   — a specific action, today, by someone on this farm
//   says who  — the agronomy behind it, in one line a farm manager can check
//
// Advice with no number behind it is an opinion. Opinions are not ranked.

import { round } from '../util.js';
import { CROPS, getCrop } from './crops.js';
import { litresPerPlantPerDay } from './climate.js';

/** Urgency decides order, colour, and whether it interrupts anyone. */
export const URGENCY = {
  now: { rank: 4, label: 'Today', tone: 'danger' },
  week: { rank: 3, label: 'This week', tone: 'warn' },
  soon: { rank: 2, label: 'Within the month', tone: 'info' },
  watch: { rank: 1, label: 'Keep an eye on it', tone: 'muted' },
};

const naira = (n) => `₦${Math.round(n).toLocaleString('en-NG')}`;

function rec(o) {
  return {
    id: o.id,
    urgency: o.urgency || 'soon',
    area: o.area,
    title: o.title,
    because: o.because,
    cost: o.cost || null,
    action: o.action,
    basis: o.basis,
  };
}

// --- Safety ---------------------------------------------------------------
// First, always, and never rankable below money. A waiting period ignored is a
// buyer rejection at best and somebody poisoned at worst.

function safety(brief) {
  const out = [];
  const chem = brief.chemicals || {};

  for (const b of chem.keepPeopleOut || []) {
    out.push(rec({
      id: `rei:${b.bed}`,
      urgency: 'now',
      area: 'safety',
      title: `Nobody goes into ${b.bed || 'that bed'} for another ${b.hoursLeft} hours`,
      because: `${b.product} was sprayed there and its re-entry interval has not run out.`,
      action: 'Move today\'s work to another bed. If someone must go in, they need gloves, boots, '
        + 'long sleeves and a mask, and they do not eat or smoke until they have washed.',
      basis: 'Re-entry intervals are set by the residue left on the leaf, not by how dry it looks.',
    }));
  }

  for (const b of chem.cannotHarvestYet || []) {
    out.push(rec({
      id: `phi:${b.bed}`,
      urgency: 'now',
      area: 'safety',
      title: `Do not pick ${b.bed || 'that bed'} until ${b.safeFrom}`,
      because: `${b.product} was applied there; ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} of its `
        + 'pre-harvest interval are still to run.',
      cost: 'A buyer who tests and finds residue does not come back, and the whole load is refused.',
      action: `Pick the other beds first and put ${b.bed || 'this one'} on the plan for ${b.safeFrom}.`,
      basis: 'The pre-harvest interval is how long the residue takes to fall below the legal limit.',
    }));
  }

  for (const r of chem.resistanceRisk || []) {
    out.push(rec({
      id: `resistance:${r.group}`,
      urgency: 'week',
      area: 'safety',
      title: `Stop using ${r.group} for now`,
      because: `It has gone on ${r.timesUsed} times in 60 days.`,
      cost: 'Resistance is permanent on that farm. The product stops working exactly when a bad '
        + 'season needs it.',
      action: (r.insteadTry || []).length
        ? `Switch the next spray to a different group — ${r.insteadTry.join(' or ')}.`
        : 'Switch the next spray to a product from a different resistance group.',
      basis: 'FRAC and IRAC both put the limit at two consecutive applications from one group.',
    }));
  }
  return out;
}

/**
 * FR-GATE-01/02 reaching the adviser — a zone that cannot legally be planted.
 *
 * This sits with safety rather than planning on purpose. A blocked gate is not
 * a scheduling inconvenience; it is the app refusing to repeat Season 1.
 */
function gates(brief) {
  const out = [];
  for (const g of brief.gates || []) {
    if (g.planted && (g.blocked || []).length) {
      out.push(rec({
        id: `gate-planted:${g.zone}`,
        urgency: 'week',
        area: 'safety',
        title: `${g.zone} was planted with its checks not passed`,
        because: `Still outstanding: ${g.blocked.join(', ')}.`,
        cost: 'If it is nematodes, the crop in there is already lost and the ground stays infected '
          + 'for the next one.',
        action: 'Test it now, even though the plants are in. A result this cycle decides whether the '
          + 'next cycle can go in the same ground.',
        basis: 'Untested soil is the first of the four causes named in the season review.',
      }));
    } else if ((g.blocked || []).length) {
      out.push(rec({
        id: `gate:${g.zone}`,
        urgency: 'week',
        area: 'planning',
        title: `${g.zone} cannot be planted yet`,
        because: `Not cleared: ${g.blocked.join(', ')}.`,
        action: 'Get the test done and recorded before transplanting is scheduled. A lab turnaround '
          + 'is days, so booking it late is what makes people want to skip it.',
        basis: 'The gate is the control. Planning around it rather than through it is the failure.',
      }));
    }
    for (const name of g.openOnOverride || []) {
      out.push(rec({
        id: `override:${g.zone}:${name}`,
        urgency: 'week',
        area: 'safety',
        title: `${g.zone} is open on an override — ${name}`,
        because: 'The Owner cleared the way while the check itself is still outstanding.',
        action: 'Close the loop: get the real result recorded and put the gate back. An override is '
          + 'meant to be temporary, and the ones that are forgotten are the dangerous ones.',
        basis: 'An override is a decision under time pressure, not a finding that the ground is safe.',
      }));
    }
  }
  return out;
}

// --- Water and weather ----------------------------------------------------

function water(brief) {
  const out = [];
  const c = brief.conditions || {};
  // Drainage and irrigation are advice about a crop. With nothing in the ground
  // they are weather commentary, and weather commentary is what makes an adviser
  // get closed and not reopened.
  if (!(brief.growing || []).length) return out;

  if ((c.waterloggingRisk ?? 0) >= 0.6) {
    const lowBeds = (brief.growing || [])
      .filter((b) => b.drainage && b.drainage !== 'raised')
      .map((b) => b.bed);
    out.push(rec({
      id: 'waterlogging',
      urgency: 'week',
      area: 'water',
      title: 'Open the drains before the next heavy rain',
      because: `${c.observed?.rainLast30mm ?? 'Recent'}mm of rain in 30 days puts the waterlogging `
        + `risk at ${Math.round((c.waterloggingRisk || 0) * 100)}%.`,
      cost: 'Pepper roots die in 48 hours of standing water, and Phytophthora walks in behind it. '
        + 'A flooded bed is usually a lost bed, not a slow one.',
      action: lowBeds.length
        ? `Clear the furrows and deepen the side drains, ${lowBeds.join(' and ')} first — they are `
          + 'not on raised beds.'
        : 'Clear the furrows and deepen the side drains, lowest corner of the field first.',
      basis: 'Capsicum has almost no tolerance for anaerobic soil; raised beds and open furrows are '
        + 'the whole defence in a Niger Delta wet season.',
    }));
  }

  if ((c.irrigationGapMmPerDay ?? 0) > 1.5) {
    // Litres per plant depends on the ground each plant is standing on, so the
    // widest-spaced crop actually growing sets the figure rather than a guess.
    const spacings = (brief.growing || [])
      .map((b) => getCrop(cropIdByName(b.crop)).spacing);
    const spacing = spacings.length
      ? spacings.reduce((a, b) => (a.inRow * a.betweenRow > b.inRow * b.betweenRow ? a : b))
      : { inRow: 0.5, betweenRow: 0.6 };
    // Watering every second day means each watering carries two days of shortfall.
    const litres = round(litresPerPlantPerDay(c.irrigationGapMmPerDay, spacing) * 2, 1);
    out.push(rec({
      id: 'irrigation',
      urgency: (c.drynessRisk ?? 0) >= 0.6 ? 'now' : 'week',
      area: 'water',
      title: `Water is ${c.irrigationGapMmPerDay}mm a day short of what the crop wants`,
      because: `Rain is not covering demand: ${c.observed?.rainLast7mm ?? 0}mm fell in the last week.`,
      cost: 'Pepper drops flowers within days of water stress, and the fruit that does set comes '
        + 'small and thick-skinned. Blossom-end rot follows.',
      action: `Irrigate every second day. About ${litres} litres per plant per watering covers the gap `
        + `at ${spacing.inRow}m by ${spacing.betweenRow}m spacing. Water early morning, at the base, `
        + 'never over the leaves.',
      basis: 'Flowering and early fruit set are the stages where capsicum yield is decided by water.',
    }));
  }

  if ((c.observed?.humidityPct ?? 0) >= 85 && (c.observed?.rainDaysLast7 ?? 0) >= 3) {
    out.push(rec({
      id: 'disease-pressure',
      urgency: 'week',
      area: 'disease',
      title: 'Conditions are right for anthracnose and bacterial spot',
      because: `Humidity around ${c.observed.humidityPct}% with ${c.observed.rainDaysLast7} rain days `
        + 'in the last week.',
      cost: 'Anthracnose takes the fruit, not the leaf. It shows up at the point where the crop is '
        + 'worth the most.',
      action: 'Scout every bed this week, take out and bury any spotted fruit rather than dropping it '
        + 'between the rows, and space the plants\' lower leaves by pruning so air moves.',
      basis: 'Colletotrichum and Xanthomonas both need leaf wetness; hours of wetness, not rainfall '
        + 'total, is what drives infection.',
    }));
  }
  return out;
}

// --- What the beds are actually doing -------------------------------------

function beds(brief) {
  const out = [];
  for (const bed of brief.growing || []) {
    if (bed.verdict === 'well behind' || bed.verdict === 'behind') {
      const gap = round((bed.expectedByNowKg || 0) - (bed.pickedKg || 0), 1);
      out.push(rec({
        id: `bed:${bed.bed}`,
        urgency: bed.verdict === 'well behind' ? 'week' : 'soon',
        area: 'yield',
        title: `${bed.bed} is ${gap}kg behind where it should be`,
        because: `${bed.pickedKg}kg picked against ${bed.expectedByNowKg}kg expected by day `
          + `${bed.daysAfterTransplant}.`,
        action: bed.soilPh != null && bed.soilPh < 5.5
          ? `Check this bed first: its pH is ${bed.soilPh}, which locks up phosphorus and calcium. `
            + 'Lime it between cycles and split the next nitrogen dose.'
          : 'Walk the bed and count plants. A shortfall this size is usually missing plants, a '
            + 'blocked drip line, or picking that is happening but not being recorded.',
        basis: bed.soilPh != null && bed.soilPh < 5.5
          ? 'Capsicum wants pH 6.0–6.8. Below 5.5 the nutrients are in the soil but not available.'
          : 'A forecast gap is a counting problem before it is an agronomy problem.',
      }));
    }
    if (bed.lastPicked && bed.verdict !== 'too early') {
      const stale = daysSince(bed.lastPicked, brief.farm.today);
      if (stale >= 7) {
        out.push(rec({
          id: `stale:${bed.bed}`,
          urgency: 'now',
          area: 'yield',
          title: `${bed.bed} has not been picked in ${stale} days`,
          because: `Last recorded picking was ${bed.lastPicked}.`,
          cost: 'Ripe fruit left on the plant tells it to stop setting more. Picking late costs the '
            + 'fruit you can see and the fruit you would have had.',
          action: 'Pick it this week, or find out why the record stopped — an unrecorded picking is '
            + 'the same problem wearing a different hat.',
          basis: 'Capsicum is indeterminate: harvest frequency drives total yield.',
        }));
      }
    }
  }
  return out;
}

/** The brief carries crop names, the crop table is keyed by id. */
function cropIdByName(name) {
  const hit = Object.values(CROPS).find((c) => c.name === name);
  return hit ? hit.id : 'chili';
}

function daysSince(date, today) {
  const a = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  const b = new Date(`${String(today).slice(0, 10)}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

// --- Quality --------------------------------------------------------------

function quality(brief) {
  const out = [];
  const h = brief.harvest || {};
  if ((h.rejectSharePct ?? 0) >= 15) {
    out.push(rec({
      id: 'rejects',
      urgency: 'week',
      area: 'quality',
      title: `${h.rejectSharePct}% of what is picked is being rejected`,
      because: 'Above about one kilo in ten, rejects stop being normal loss.',
      cost: 'Every rejected kilo cost the same to grow as a first-grade one and earns nothing.',
      action: 'Look at what the rejects have in common — sun-scald, anthracnose spots, blossom-end '
        + 'rot, or bruising in the crate. Each one has a different fix, and the crate is the '
        + 'cheapest to fix.',
      basis: 'Grade-out is the most under-watched loss on a smallholding: it never appears as a '
        + 'yield problem, only as a price problem.',
    }));
  }
  if ((h.direction === 'down') && (h.changePct ?? 0) <= -15) {
    out.push(rec({
      id: 'trend-down',
      urgency: 'week',
      area: 'yield',
      title: `Picking is down ${Math.abs(h.changePct)}% on the previous four weeks`,
      because: `${h.last4WeeksKg}kg against ${h.previous4WeeksKg}kg.`,
      action: 'Separate the two causes before acting: beds coming to the end of their cycle, or '
        + 'beds failing mid-cycle. The bed table says which, and only the second is fixable now.',
      basis: 'A fall that tracks cycle age is a planning problem; one that does not is an agronomy '
        + 'problem.',
    }));
  }
  return out;
}

// --- Money ----------------------------------------------------------------
// Only reached when the brief carries money at all, which depends on the role
// of whoever asked.

function economics(brief) {
  const out = [];
  if (!brief.economics) return out;
  const e = brief.economics.last90Days || {};

  if (e.costPerKgNgn != null && e.pricePerKgNgn != null) {
    if (e.pricePerKgNgn <= e.costPerKgNgn) {
      out.push(rec({
        id: 'below-cost',
        urgency: 'now',
        area: 'money',
        title: 'The farm is selling below what it costs to grow',
        because: `${naira(e.costPerKgNgn)} a kilo to grow, ${naira(e.pricePerKgNgn)} a kilo sold.`,
        cost: `At ${e.soldKg}kg sold that is ${naira((e.costPerKgNgn - e.pricePerKgNgn) * e.soldKg)} `
          + 'gone in 90 days.',
        action: 'Two levers and they work at different speeds. Price: stop selling at the farm gate '
          + 'to one buyer, and split loads between market days. Cost: the labour and input lines '
          + 'below say which one is carrying the weight.',
        basis: 'Cost per kilogram is the only farm number that is comparable across crops, seasons '
          + 'and farm sizes.',
      }));
    } else if (e.pricePerKgNgn < e.costPerKgNgn * 1.3) {
      out.push(rec({
        id: 'thin-margin',
        urgency: 'soon',
        area: 'money',
        title: 'The margin is too thin to absorb a bad month',
        because: `${naira(e.pricePerKgNgn - e.costPerKgNgn)} a kilo, on ${naira(e.costPerKgNgn)} of cost.`,
        cost: 'One flooded bed or one refused load turns this season negative.',
        action: 'Aim the next change at cost per kilo, not at total spend. Spending less while '
          + 'picking less leaves you exactly where you are.',
        basis: 'Under a 30% gross margin a smallholding has no buffer for the weather it will get.',
      }));
    }
  }

  if (e.unsoldKg && e.pickedKg && e.unsoldKg / e.pickedKg >= 0.15) {
    out.push(rec({
      id: 'unsold',
      urgency: 'week',
      area: 'money',
      title: `${e.unsoldKg}kg picked and never recorded as sold`,
      because: `${e.pickedKg}kg picked, ${e.soldKg}kg sold, in the same 90 days.`,
      cost: e.pricePerKgNgn ? `${naira(e.unsoldKg * e.pricePerKgNgn)} unaccounted for.` : null,
      action: 'Either it spoiled, it was eaten or given away, or the sale was never entered. The '
        + 'first is a cold-chain problem, the third is a record problem, and they need opposite '
        + 'responses — so find out which before you act.',
      basis: 'Picked-minus-sold is the single most useful reconciliation on a farm, because both '
        + 'sides are recorded by different people.',
    }));
  }

  // The seasonal price only becomes advice once there is a crop to sell or a
  // planting to time.
  const idx = (brief.growing || []).length ? brief.economics.seasonalPriceIndexNow : null;
  if (idx != null && idx >= 1.15) {
    out.push(rec({
      id: 'price-high',
      urgency: 'week',
      area: 'market',
      title: 'Prices are seasonally high right now',
      because: `The index for this month is ${idx} against an average month at 1.00.`,
      action: 'Pick to the shortest interval you can staff and sell fresh rather than holding. '
        + 'This is the wrong month to store.',
      basis: 'Nigerian pepper prices peak in the wet season when supply from the north thins out.',
    }));
  } else if (idx != null && idx <= 0.85) {
    out.push(rec({
      id: 'price-low',
      urgency: 'soon',
      area: 'market',
      title: 'Prices are seasonally low right now',
      because: `The index for this month is ${idx} against an average month at 1.00.`,
      action: 'If any of the crop can be dried or held, this is the month to do it. Aim the next '
        + 'transplanting so its peak picking misses this window.',
      basis: 'Harvest timing moves revenue more than yield does on a crop this seasonal.',
    }));
  }
  return out;
}

// --- Store, labour and record quality -------------------------------------

function operations(brief) {
  const out = [];
  for (const s of brief.store || []) {
    out.push(rec({
      id: `stock:${s.item}`,
      urgency: s.daysLeft <= 7 ? 'now' : 'week',
      area: 'store',
      title: `${s.item} runs out in ${s.daysLeft} days`,
      because: `${s.onHand}${s.unit ? ` ${s.unit}` : ''} left at ${s.usedPerDay} a day.`,
      action: `Order before ${s.runsOut}. Buying in a hurry in Port Harcourt costs more and is where `
        + 'adulterated product gets in.',
      basis: 'Input stock-outs stop work for days, because the gap is the delivery time, not the price.',
    }));
  }

  const t = brief.dataTrust || {};
  if (t.score != null && t.score < 45) {
    out.push(rec({
      id: 'records',
      urgency: 'soon',
      area: 'records',
      title: 'The records are too thin to advise on confidently',
      because: `Record quality scores ${t.score} out of 100${t.sameDaySharePct != null
        ? `; only ${t.sameDaySharePct}% of pickings were entered the same day` : ''}.`,
      cost: 'Every forecast, cost and verdict on this screen is built on these records. Weak records '
        + 'do not produce cautious advice, they produce confident wrong advice.',
      action: 'Fix the entry habit before anything else: weigh at the bed, enter at the bed, photo '
        + 'on the crate. One week of that is worth more than a season of remembered numbers.',
      basis: 'Recall error in farm records runs one way — towards round numbers and towards the '
        + 'figure the person thinks is expected.',
    }));
  }

  const slow = (brief.labour || []).filter((p) => p.kgPerHour != null);
  if (slow.length >= 3) {
    const rates = slow.map((p) => p.kgPerHour).sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)];
    const behind = slow.filter((p) => p.kgPerHour < median * 0.6);
    if (behind.length && median > 0) {
      out.push(rec({
        id: 'labour-spread',
        urgency: 'watch',
        area: 'labour',
        title: 'Picking rates vary more than they should',
        because: `The middle of the team picks ${median}kg an hour; `
          + `${behind.map((p) => p.person).join(', ')} ${behind.length === 1 ? 'is' : 'are'} under `
          + `${round(median * 0.6, 1)}kg.`,
        action: 'Put the slowest with the fastest for two days. Nearly all of this gap is technique — '
          + 'which fruit to take and how to hold the crate — and it transfers in an afternoon.',
        basis: 'Treat it as training before performance. The same spread appears when one person is '
          + 'given the difficult beds every time.',
      }));
    }
  }
  return out;
}

// --- Planting ahead -------------------------------------------------------

function planting(brief) {
  const out = [];
  const active = brief.farm.activeCycles || 0;
  const beds = brief.farm.beds || 0;
  if (beds > 0 && active < beds) {
    out.push(rec({
      id: 'idle-beds',
      urgency: 'soon',
      area: 'planning',
      title: `${beds - active} bed${beds - active === 1 ? '' : 's'} with nothing growing`,
      because: `${beds} beds recorded, ${active} with an active cycle.`,
      action: 'Decide deliberately: another cycle, a legume to rest the ground, or a fallow. Leaving '
        + 'it to happen by default is the one option that costs without resting anything.',
      basis: 'Continuous capsicum on the same ground builds up Phytophthora and root-knot nematode. '
        + 'A maize or cowpea break between cycles is the cheapest control there is.',
    }));
  }
  return out;
}

/**
 * Everything the adviser has to say, ranked.
 *
 * Safety outranks money at equal urgency — that ordering is deliberate and not
 * a preference the caller can pass in.
 */
export function advise(brief) {
  const all = [
    ...safety(brief),
    ...gates(brief),
    ...water(brief),
    ...beds(brief),
    ...quality(brief),
    ...economics(brief),
    ...operations(brief),
    ...planting(brief),
  ];

  const areaRank = (a) => (a === 'safety' ? 1 : 0);
  all.sort((a, b) => (URGENCY[b.urgency].rank - URGENCY[a.urgency].rank)
    || (areaRank(b.area) - areaRank(a.area)));

  return {
    generatedAt: new Date().toISOString(),
    source: 'built-in',
    recommendations: all,
    counts: {
      now: all.filter((r) => r.urgency === 'now').length,
      week: all.filter((r) => r.urgency === 'week').length,
      total: all.length,
    },
    nothingToSay: all.length === 0,
  };
}

/** The crops this adviser knows, for the "what does it actually know?" panel. */
export const KNOWN_CROPS = Object.values(CROPS).map((c) => c.name);
