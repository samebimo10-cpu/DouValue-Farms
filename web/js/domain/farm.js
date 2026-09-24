// The farm's zones — requirements 6.1, FR-FARM-01.
//
// The zone register lives in the rules file (rules/douvalue_rules_rev5_1.json →
// zones), because the Rev 5.1 block register is what the schedule, the gates
// and the clean-restart protocol are all written against. A new farm starts
// from that register rather than from an empty list, so GH-04 is GH-04 from
// the first morning and OF-02 is the nursery from the first morning.
//
// The sample farm is deliberately not built from this. It is a teaching farm
// with its own beds (UX-25), and it stays exactly as it was.

/**
 * The zone types the app knows.
 *
 * The rules file has four (`greenhouse`, `open_field`, `open_field_ridge`,
 * `nursery`); the app has always stored open field as `field`, and pest
 * thresholds are read on that (alerts.js). So a ridge block is a field for
 * thresholds, and keeps its rules type beside it for spacing and display.
 */
export const ZONE_TYPES = {
  greenhouse: { id: 'greenhouse', label: 'Greenhouse' },
  field: { id: 'field', label: 'Open field' },
  nursery: { id: 'nursery', label: 'Nursery' },
};

const APP_TYPE = {
  greenhouse: 'greenhouse',
  open_field: 'field',
  open_field_ridge: 'field',
  nursery: 'nursery',
};

export function appTypeOf(rulesType) {
  return APP_TYPE[rulesType] || 'greenhouse';
}

export function zoneTypeLabel(zone) {
  if (!zone) return '';
  if (zone.rulesType === 'open_field_ridge') return 'Open field, ridges';
  return (ZONE_TYPES[zone.type] || ZONE_TYPES.greenhouse).label;
}

/** FR-FARM-04: the nursery raises seedlings; it is not a cropping block. */
export const isNursery = (zone) => !!zone && zone.type === 'nursery';

/** A stable id per register entry, so two phones setting up the farm agree. */
export const zoneIdFor = (code) => `zone_${String(code).toLowerCase()}`;

/** The rules' own entry for a zone, matched on its register code or its name. */
export function rulesZoneFor(zone, rules) {
  if (!zone || !rules || !Array.isArray(rules.zones)) return null;
  const code = String(zone.code || zone.name || '').trim().toUpperCase();
  return rules.zones.find((z) => z.id.toUpperCase() === code) || null;
}

/** GH-04 and GH-05 carry the clean-restart protocol (rules → zones[].protocol). */
export function protocolOf(zone, rules) {
  if (!zone) return null;
  if (zone.protocol) return zone.protocol;
  const entry = rulesZoneFor(zone, rules);
  return (entry && entry.protocol) || null;
}

/**
 * FR-FARM-01 — the real zones, as plot records, straight from the register.
 *
 * Area is left at 0: the register does not carry it, and a guessed area would
 * put a wrong trap count on Gate 1. The Farm Manager fills it in.
 */
export function realZones(rules) {
  if (!rules || !Array.isArray(rules.zones)) {
    throw new Error('The zone register comes from the rules file, and the rules are not loaded');
  }
  return rules.zones.map((z) => ({
    id: zoneIdFor(z.id),
    code: z.id,
    name: z.id,
    type: appTypeOf(z.type),
    rulesType: z.type,
    crop: z.crop || '',
    spacingCm: z.spacing_cm ?? null,
    protocol: z.protocol || null,
    note: z.note || '',
    areaM2: 0,
    drainage: z.type === 'open_field_ridge' ? 'ridged' : 'raised',
  }));
}

/** The records a brand-new farm starts with: its name, its Owner, its zones. */
export function newFarmEvents({ farmName, owner, rules }) {
  return [
    { type: 'settings.update', payload: { farmName: farmName || 'DouValue Farms Limited' } },
    { type: 'person.upsert', payload: { ...owner, role: 'ceo' } },
    // No rules, no register: better no zones than guessed ones.
    ...(rules ? realZones(rules) : []).map((payload) => ({ type: 'plot.upsert', payload })),
  ];
}
