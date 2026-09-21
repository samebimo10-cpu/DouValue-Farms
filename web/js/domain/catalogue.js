// The active-ingredient catalogue, read off the rules file.
//
// FR-STOCK-05: a treatment is chosen by active ingredient, from a fixed list
// that already carries the IRAC or FRAC group. The brand on the bottle is a
// label attached to an active, not a thing you can spray on its own, because
// the rotation gate works on groups and a brand name does not tell you one.
// That is decision C-18, and it is why Punch, Vanguish and Lion Seal are not
// in here.
//
// This module does three jobs and no more:
//
//   1. Turns rules.active_ingredients into entries the app can hold, with the
//      group split into kind and code so "IRAC 3A" and "FRAC M1" can be
//      compared rather than string-matched.
//   2. Applies the PHI and REI defaults (FR-STOCK-07, decision C-8): blank
//      means the default, and an entered label value counts only if it is
//      LONGER. A label is allowed to be stricter than the farm's default and
//      never allowed to be laxer.
//   3. Maps a spray already on the record back to its active, so the rotation
//      check can read a history that was logged before this catalogue existed.
//
// Nothing here decides anything. The deciding is in doctor.js.

import { rules } from './rules.js';
import { PRODUCT_BY_ID } from './safety.js';

/**
 * Short keys for the actives, so the rest of the app is not passing
 * "Garlic-chilli extract (farm-made)" around as an identifier. The name in the
 * rules file stays the authority; this is only a handle. An active that turns
 * up in the rules file without a key here still appears, under a slug of its
 * name, so a new active is never silently dropped.
 */
const KEYS = {
  'Cypermethrin': 'cypermethrin',
  'Lambda-cyhalothrin': 'lambda_cyhalothrin',
  'Thiamethoxam': 'thiamethoxam',
  'Imidacloprid': 'imidacloprid',
  'Acetamiprid': 'acetamiprid',
  'Spinosad': 'spinosad',
  'Spinetoram': 'spinetoram',
  'Abamectin': 'abamectin',
  'Emamectin benzoate': 'emamectin',
  'Bacillus thuringiensis (Bt)': 'bt',
  'Chlorantraniliprole': 'chlorantraniliprole',
  'Azadirachtin / neem oil': 'neem',
  'Garlic-chilli extract (farm-made)': 'garlic_chilli',
  'Sulphur (wettable)': 'sulphur',
  'Copper oxychloride': 'copper_oxychloride',
  'Copper hydroxide': 'copper_hydroxide',
  'Mancozeb': 'mancozeb',
  'Metalaxyl-M + Mancozeb': 'metalaxyl_m',
  'Trichoderma harzianum': 'trichoderma',
  'Bacillus subtilis': 'bacillus_subtilis',
};

/** Sprays were logged against safety.js product ids long before this file. */
const FROM_SPRAY_ID = {
  mancozeb: 'mancozeb',
  copper_oxychloride: 'copper_oxychloride',
  metalaxyl_mancozeb: 'metalaxyl_m',
  sulphur: 'sulphur',
  bt: 'bt',
  neem: 'neem',
  spinosad: 'spinosad',
  emamectin: 'emamectin',
  abamectin: 'abamectin',
  acetamiprid: 'acetamiprid',
  imidacloprid: 'imidacloprid',
  lambda_cyhalothrin: 'lambda_cyhalothrin',
  cypermethrin: 'cypermethrin',
};

/**
 * SR-08, the Week 10 rule, names exactly three things: neem oil, garlic-chilli
 * and Copper Hydroxide. It is a closed list and it is written out here as one,
 * because "organics" read loosely would let Bt and Trichoderma through on a
 * judgement call the schedule did not make.
 */
const WEEK_10_ORGANICS = ['neem', 'garlic_chilli', 'copper_hydroxide'];

/** Not synthetic, for the harvest-buffer wording and the Owner escalation. */
const NOT_SYNTHETIC = ['neem', 'garlic_chilli', 'trichoderma', 'bacillus_subtilis', 'bt'];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * "IRAC 3A" -> { kind: 'IRAC', codes: ['3A'] }
 * "FRAC 4 + M3" -> { kind: 'FRAC', codes: ['4', 'M3'] }
 * "none" -> { kind: null, codes: [], stated: true }
 *
 * `stated` is the difference between "this product has no resistance group"
 * (farm-made garlic-chilli: true, and it is exempt from the rotation check)
 * and "nobody has written the group down", which under `product_rule` means
 * the product cannot be selected at all.
 */
export function parseGroup(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: null, codes: [], stated: false, text: '' };
  if (/^none$/i.test(text)) return { kind: null, codes: [], stated: true, text: 'none' };

  const m = text.match(/^(IRAC|FRAC)\s+(.*)$/i);
  const kind = m ? m[1].toUpperCase() : null;
  const body = m ? m[2] : text;
  const codes = body.split('+').map((c) => normaliseCode(c)).filter(Boolean);
  return { kind, codes, stated: true, text };
}

/**
 * FRAC writes M01 on some labels and M1 on others. They are one group, so the
 * padding comes off — but only from the multi-site M codes, because BM02 is
 * written that way on purpose and BM2 is not a group anybody publishes.
 */
function normaliseCode(code) {
  const c = String(code).trim().toUpperCase();
  const m = c.match(/^M0(\d+)$/);
  return m ? `M${m[1]}` : c;
}

/** The PHI and REI defaults from rules.phi, applied by active (decision C-8). */
function defaultsFor(key, entry) {
  const phi = rules().phi || [];
  const organicRow = phi.find((r) => /Neem oil/i.test(r.product)) || {};
  const copperRow = phi.find((r) => /^Copper Hydroxide/i.test(r.product)) || {};
  const otherRow = phi.find((r) => /Any other synthetic/i.test(r.product)) || {};

  if (entry.phi_days === 0 || key === 'copper_hydroxide') {
    const row = key === 'copper_hydroxide' ? copperRow : organicRow;
    return {
      phiDays: 0,
      exportBufferDays: 0,
      // Copper carries the 24 h default; the botanicals and Trichoderma carry
      // "until dry, minimum 4 h", which the app holds as 4.
      reiHours: key === 'copper_hydroxide' ? 24 : 4,
      reiNote: row.rei_default || '',
      phiSource: 'rules',
    };
  }

  return {
    phiDays: 14,
    exportBufferDays: Number(otherRow.export_buffer_days) || 21,
    reiHours: 24,
    reiNote: otherRow.rei_default || '24 h until label value entered',
    // Marked so every screen can say "default — check label" rather than
    // showing a borrowed number as if it came off the container.
    phiSource: 'default',
  };
}

let built = null;

/** The catalogue, built once from the rules file. */
export function catalogue() {
  if (built) return built;

  const banned = (rules().labels?.banned || []).map((b) => String(b).toLowerCase());

  built = (rules().active_ingredients || []).map((entry) => {
    const key = KEYS[entry.ai] || slug(entry.ai);
    const group = parseGroup(entry.group);
    const d = defaultsFor(key, entry);
    return {
      key,
      ai: entry.ai,
      type: entry.type,
      group,
      groupText: group.text,
      scheduleRate: entry.schedule_rate || null,
      ...d,
      organic: WEEK_10_ORGANICS.includes(key),
      synthetic: !NOT_SYNTHETIC.includes(key),
      banned: banned.some((b) => b.includes(entry.ai.toLowerCase())),
      kindOfProduct: /fungicid|bacterici/i.test(entry.type) ? 'fungicide'
        : /insecticid|miticid|botanical/i.test(entry.type) ? 'insecticide'
          : 'other',
    };
  });

  return built;
}

/** Only for the tests and for a rules file that arrives over sync. */
export function resetCatalogue() { built = null; }

export function activeByKey(key) {
  return catalogue().find((a) => a.key === key) || null;
}

export function activeByName(name) {
  const want = String(name || '').toLowerCase();
  return catalogue().find((a) => a.ai.toLowerCase() === want || a.key === want) || null;
}

/**
 * FR-STOCK-09 and the rules' own banned list. Carbofuran is not in the
 * catalogue at all, so this is the check that stops it being typed in by hand
 * or arriving as a brand label.
 */
export function isBanned(name) {
  const want = String(name || '').trim().toLowerCase();
  // A blank name is not a product, and must not match every banned entry by
  // way of "every string contains the empty string".
  if (want.length < 3) return false;
  return (rules().labels?.banned || []).some((entry) => {
    const b = String(entry).toLowerCase();
    // "Carbofuran (Furadan)" -> the active and every trade name on the line.
    const words = b.split(/[^a-z0-9-]+/).filter((w) => w.length >= 3);
    return words.some((w) => want.includes(w));
  });
}

/**
 * FR-STOCK-07: a label value is used only if it is longer than the default.
 * `label` is whatever the Farm Manager entered against the active — possibly
 * nothing, which is allowed and means the default stands.
 */
export function intervalsFor(active, label = null) {
  const phiDays = Math.max(active.phiDays, Number(label?.phiDays) || 0);
  const reiHours = Math.max(active.reiHours, Number(label?.reiHours) || 0);
  return {
    phiDays,
    reiHours,
    phiFromLabel: phiDays !== active.phiDays,
    reiFromLabel: reiHours !== active.reiHours,
    phiNote: phiDays === active.phiDays && active.phiSource === 'default'
      ? 'default — check label' : '',
    exportBufferDays: active.exportBufferDays,
  };
}

/**
 * The resistance group behind a spray already on the record.
 *
 * Sprays logged before the catalogue existed carry a safety.js product id, so
 * fall back to that list rather than treat an unmatched id as "no group".
 * Forgetting a past spray is how a rotation check quietly starts passing.
 */
export function groupOfSpray(spray) {
  const key = FROM_SPRAY_ID[spray.productId] || spray.activeKey || spray.productId;
  const active = activeByKey(key);
  if (active) return { ...active.group, active };

  const fallback = PRODUCT_BY_ID[spray.productId];
  if (fallback && fallback.group && fallback.group !== '-') {
    return { ...parseGroup(fallback.group), active: null };
  }
  return { kind: null, codes: [], stated: false, text: '', active: null };
}

/** The key a logged spray maps to, or null if it is not a catalogue active. */
export function activeKeyOfSpray(spray) {
  return FROM_SPRAY_ID[spray.productId] || spray.activeKey
    || (activeByKey(spray.productId) ? spray.productId : null);
}

/**
 * C-7: copper put on a pruning wound is sanitation, not a crop spray. It is
 * logged as wound care and kept out of the rotation count, otherwise it blocks
 * the Copper Oxychloride the schedule actually asks for.
 */
export function isWoundCare(spray) {
  return spray.woundCare === true || /wound/i.test(spray.purpose || '');
}
