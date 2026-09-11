// Weather for Port Harcourt: a built-in climatology that works with no network,
// an optional live fetch when the phone has data, and the derived numbers the
// rest of the app reasons with (heat units, wetness, disease pressure).

import { clamp, interpolate, isoDate, monthOf, parseDate, daysBetween } from '../util.js';

export const FARM_LOCATION = { name: 'Port Harcourt, Rivers State', lat: 4.82, lon: 7.04, tz: 'Africa/Lagos' };

/**
 * Long-run monthly averages for Port Harcourt. Used whenever there is no logged
 * rain-gauge reading and no live forecast — which, on a farm phone with no data
 * left, is most of the time. Rain in mm, rainDays out of the month, temps in C,
 * rh as mean relative humidity %.
 */
export const CLIMATOLOGY = [
  { m: 1,  rain: 30,  rainDays: 2,  tmax: 33, tmin: 22, rh: 76, season: 'dry' },
  { m: 2,  rain: 50,  rainDays: 3,  tmax: 34, tmin: 23, rh: 78, season: 'dry' },
  { m: 3,  rain: 130, rainDays: 7,  tmax: 33, tmin: 23, rh: 82, season: 'onset' },
  { m: 4,  rain: 200, rainDays: 11, tmax: 32, tmin: 23, rh: 84, season: 'wet' },
  { m: 5,  rain: 280, rainDays: 15, tmax: 31, tmin: 23, rh: 86, season: 'wet' },
  { m: 6,  rain: 350, rainDays: 19, tmax: 30, tmin: 23, rh: 88, season: 'wet' },
  { m: 7,  rain: 420, rainDays: 23, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 8,  rain: 380, rainDays: 24, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 9,  rain: 420, rainDays: 23, tmax: 29, tmin: 22, rh: 90, season: 'peak' },
  { m: 10, rain: 300, rainDays: 18, tmax: 30, tmin: 23, rh: 88, season: 'wet' },
  { m: 11, rain: 100, rainDays: 7,  tmax: 32, tmin: 23, rh: 84, season: 'retreat' },
  { m: 12, rain: 30,  rainDays: 2,  tmax: 33, tmin: 22, rh: 78, season: 'dry' },
];

export const SEASON_LABELS = {
  dry: 'Dry season', onset: 'Rains starting', wet: 'Rainy season',
  peak: 'Peak rains', retreat: 'Rains ending',
};

export function climateFor(dateOrMonth) {
  const m = typeof dateOrMonth === 'number' ? dateOrMonth : monthOf(dateOrMonth);
  return CLIMATOLOGY[clamp(m, 1, 12) - 1];
}

export function seasonOn(date) {
  const c = climateFor(date);
  return { id: c.season, label: SEASON_LABELS[c.season] };
}

/** Chance any given day in this month is a rain day. */
export function rainProbability(date) {
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  return clamp(c.rainDays / daysInMonth, 0, 1);
}

/**
 * Growing degree days for one day. Capsicum sits between a base below which it
 * stops growing and an upper cut-off above which extra heat buys nothing.
 */
export function gdd(tmax, tmin, base = 10, cutoff = 30) {
  const hi = Math.min(tmax, cutoff);
  const lo = Math.max(Math.min(tmin, cutoff), base);
  const mean = (Math.max(hi, base) + lo) / 2;
  return Math.max(0, mean - base);
}

/** Climatological GDD for a date, used when no measured temperature exists. */
export function normalGdd(date, base = 10) {
  const c = climateFor(date);
  return gdd(c.tmax, c.tmin, base);
}

/** Heat units expected between two dates from climatology alone. */
export function expectedGddBetween(from, to, base = 10) {
  const days = daysBetween(from, to);
  if (days <= 0) return 0;
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(parseDate(from).getTime() + i * 86400000);
    total += normalGdd(d, base);
  }
  return Math.round(total);
}

/**
 * Farm-gate price seasonality for fresh pepper in the South-South.
 *
 * Prices here are driven by irrigated dry-season supply coming down from Kano,
 * Kaduna and Sokoto. That supply lands from about November to March and the
 * market softens; it thins out from June and the market runs hot through the
 * rains.
 *
 * The twelve figures average to exactly 1.00, which matters more than it looks:
 * the base price in Settings is a yearly average, so an index that averaged, say,
 * 1.09 would silently mark every forecast up by nine percent and make every crop
 * look better than it is. These are planning multipliers, not quotes: check Mile 3
 * and Creek Road before trusting them with real money, and replace them in
 * Settings once the farm has a season of its own sales to average.
 */
export const PRICE_SEASONALITY = {
  1: 0.73, 2: 0.78, 3: 0.87, 4: 0.96, 5: 1.05, 6: 1.19,
  7: 1.33, 8: 1.37, 9: 1.24, 10: 1.01, 11: 0.78, 12: 0.69,
};

/**
 * Normalise any monthly index so it averages 1.00. A manager typing in their own
 * remembered prices will not produce a set that happens to average out, and an
 * index that runs high or low would bias every revenue forecast in the app.
 * Normalising keeps the *shape* they entered, which is the part that carries the
 * information, and leaves the level to the base price.
 */
export function normaliseSeasonality(table) {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const values = months.map((m) => Number(table[m]));
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return { ...PRICE_SEASONALITY };
  const mean = values.reduce((a, b) => a + b, 0) / 12;
  if (!mean) return { ...PRICE_SEASONALITY };
  const out = {};
  months.forEach((m, i) => { out[m] = values[i] / mean; });
  return out;
}

export function priceIndexOn(date, overrides = null) {
  const table = overrides && Object.keys(overrides).length
    ? normaliseSeasonality(overrides) : PRICE_SEASONALITY;
  return Number(table[monthOf(date)]) || 1;
}

/**
 * Wetness pressure 0-1: how favourable the weather is to splash-borne and
 * humid-air fungal and bacterial disease. Built from rain days and humidity so
 * it still works with nothing but the calendar.
 */
export function wetnessIndex(date, observed = null) {
  if (observed && observed.rainDaysLast7 != null) {
    const rd = clamp(observed.rainDaysLast7 / 7, 0, 1);
    const rh = clamp(((observed.rh ?? climateFor(date).rh) - 65) / 30, 0, 1);
    return clamp(0.6 * rd + 0.4 * rh, 0, 1);
  }
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  const rd = clamp(c.rainDays / daysInMonth, 0, 1);
  const rh = clamp((c.rh - 65) / 30, 0, 1);
  return clamp(0.6 * rd + 0.4 * rh, 0, 1);
}

/** Dryness pressure 0-1: mite and thrips weather, and when irrigation decides the crop. */
export function drynessIndex(date, observed = null) {
  return clamp(1 - wetnessIndex(date, observed), 0, 1);
}

/** Waterlogging pressure: heavy monthly rain on flat ground is the Phytophthora setup. */
export function waterloggingIndex(date, observed = null) {
  const c = climateFor(date);
  const monthly = observed && observed.rainLast30 != null ? observed.rainLast30 : c.rain;
  return clamp(interpolate([[80, 0], [200, 0.35], [320, 0.7], [420, 1]], monthly), 0, 1);
}

/** Irrigation shortfall in mm/day: crop demand minus what the sky is giving. */
export function irrigationGapMmPerDay(date, cropDemandMmPerDay, observed = null) {
  const c = climateFor(date);
  const daysInMonth = new Date(parseDate(date).getFullYear(), monthOf(date), 0).getDate();
  const rainPerDay = observed && observed.rainLast30 != null
    ? observed.rainLast30 / 30 : c.rain / daysInMonth;
  const effective = rainPerDay * 0.7; // runoff and evaporation take the rest
  return Math.max(0, cropDemandMmPerDay - effective);
}

/** Litres per plant per day from a mm/day shortfall and the plant's ground area. */
export function litresPerPlantPerDay(mmPerDay, spacing) {
  const areaM2 = spacing.inRow * spacing.betweenRow;
  return Math.round(mmPerDay * areaM2 * 10) / 10; // 1 mm over 1 m2 = 1 litre
}

/**
 * Optional live forecast from Open-Meteo. No API key, no account. Returns null
 * on any failure so every caller falls back to climatology without a fuss.
 */
export async function fetchForecast(lat = FARM_LOCATION.lat, lon = FARM_LOCATION.lon, signal = null) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean'
    + `&past_days=7&forecast_days=7&timezone=${encodeURIComponent(FARM_LOCATION.tz)}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.daily;
    if (!d || !Array.isArray(d.time)) return null;
    return {
      fetchedAt: new Date().toISOString(),
      days: d.time.map((t, i) => ({
        date: t,
        tmax: d.temperature_2m_max[i],
        tmin: d.temperature_2m_min[i],
        rain: d.precipitation_sum[i],
        rh: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
      })),
    };
  } catch {
    return null;
  }
}

/** Turn a forecast (or logged rain readings) into the observed shape the indices take. */
export function summariseObserved(days, today = new Date()) {
  if (!days || !days.length) return null;
  const t = isoDate(today);
  const past = days.filter((d) => d.date <= t);
  const last7 = past.slice(-7);
  const last30 = past.slice(-30);
  if (!last7.length) return null;
  const rainDaysLast7 = last7.filter((d) => (d.rain || 0) >= 1).length;
  const rainLast30 = last30.reduce((s, d) => s + (d.rain || 0), 0) * (30 / Math.max(last30.length, 1));
  const rh = last7.reduce((s, d) => s + (d.rh ?? 85), 0) / last7.length;
  return {
    rainDaysLast7,
    rainLast7: last7.reduce((s, d) => s + (d.rain || 0), 0),
    rainLast30: Math.round(rainLast30),
    rh: Math.round(rh),
    tmaxMean: last7.reduce((s, d) => s + (d.tmax ?? 30), 0) / last7.length,
  };
}

/** Next few days in plain words, for the worker's home screen. */
export function forecastHeadline(forecast, today = new Date()) {
  if (!forecast) {
    const c = climateFor(today);
    return { text: `${SEASON_LABELS[c.season]} — about ${c.rainDays} rain days this month`, live: false };
  }
  const t = isoDate(today);
  const ahead = forecast.days.filter((d) => d.date >= t).slice(0, 3);
  const wet = ahead.filter((d) => (d.rain || 0) >= 5).length;
  if (wet >= 2) return { text: 'Heavy rain in the next 3 days — hold off spraying, check drains', live: true };
  if (wet === 1) return { text: 'Rain expected within 3 days — spray early and let it dry', live: true };
  return { text: 'Dry spell in the next 3 days — irrigate and watch for mites', live: true };
}
