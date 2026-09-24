// A zone that passed every transplant gate, for fixtures that are about
// something else.
//
// FR-GATE-00/01/06 and FR-FARM-05 made the transplant gates what the rules say
// they are: Gate 0 (lab report, three-point pH with a calibrated meter and a
// photo, the Farm Doctor check confirmed by the Farm Manager and approved by
// the Owner) and Gate 1 (the whole Establishment Checklist, including a
// seedling batch released to the block). A test about the digest or the
// adviser that plants a "healthy" zone has to have planted it properly, or
// the healthy farm is — correctly — reported as planted behind a closed gate.
//
// Not a test file: the runner only picks up *.test.mjs.

const minus = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const G1_LINES = ['inputs_on_site', 'drip_pressure', 'spacing_pegged', 'traps_installed', 'sops_live',
  'scout_roster', 'route_b_wait'];

/**
 * The records that clear G0 and G1 for `zoneId`, planted on `plantedOn` as
 * `cycleId`. Returns a new state; nothing passed in is changed. `soil: false`
 * leaves the soil tests to the caller, for tests that are about the soil.
 */
export function withGatesCleared(state, { zoneId, plantedOn, cycleId = null, soil = true }) {
  const tag = `${zoneId}_ok`;
  const people = {
    gate_mgr: { id: 'gate_mgr', name: 'Gate Manager', role: 'manager', active: true },
    gate_owner: { id: 'gate_owner', name: 'Gate Owner', role: 'ceo', active: true },
    ...(state.people || {}),
  };
  return {
    ...state,
    people,
    inputs: { ...(state.inputs || {}), [`${tag}_spin`]: { id: `${tag}_spin`, name: 'Spinosad 45SC', unit: 'litre', qty: 2 } },
    soilTests: !soil ? (state.soilTests || []) : [...(state.soilTests || []), {
      id: `${tag}_soil`, zoneId, date: minus(plantedOn, 1), ph: 6.2, readings: [6.1, 6.2, 6.3],
      calibrated: true, photo: { dataUrl: 'data:image/jpeg;base64,x' }, nematode: 'clean', lab: 'Rivers Soil Lab',
    }],
    gateEvidence: [...(state.gateEvidence || []), ...G1_LINES.map((itemId) => ({
      id: `${tag}_${itemId}`, gate: 'G1', itemId, zoneId, date: minus(plantedOn, 3),
      note: 'done', count: itemId === 'traps_installed' ? 10000 : undefined,
      route: itemId === 'route_b_wait' ? 'A' : undefined,
    }))],
    doctorOutputs: [...(state.doctorOutputs || []), {
      id: `${tag}_review`, kind: 'gate-review', subject: { zoneId, gates: ['G0', 'G1', 'G4'] },
      gates: [{ id: 'G0', missing: [{ id: 'doctor_check' }] }],
      at: `${minus(plantedOn, 2)}T09:00:00.000Z`,
      confirmedBy: 'gate_mgr', approvedBy: 'gate_owner',
    }],
    seedlingBatches: {
      ...(state.seedlingBatches || {}),
      [`${tag}_batch`]: {
        id: `${tag}_batch`, nurseryZoneId: 'nursery', status: 'released', usedByCycleId: cycleId,
        release: { date: minus(plantedOn, 1), zoneId },
      },
    },
  };
}
