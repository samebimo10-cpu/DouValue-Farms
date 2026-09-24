// A worked example of DouValue Farms Limited, so the app can be explored before a single
// real record exists. Dates are built relative to today, so the sample always
// shows beds at different stages: one in the nursery run-up, one flowering, one
// in full picking.
//
// Every sample person signs in with PIN 1234. Ebimo Sam is the CEO and sees
// everything; Ada Briggs runs the farm as manager; the rest are field staff.

import { addDays, isoDate, uid } from './util.js';
import { hashPin } from './ui/shell.js';

export async function seedSampleFarm(store) {
  const today = new Date();
  const d = (n) => isoDate(addDays(today, n));
  const pin = await hashPin('1234');

  const people = [
    { id: 'sp_owner', name: 'Ebimo Sam', role: 'ceo', phone: '08030000000', dailyRate: 0 },
    { id: 'sp_ada', name: 'Ada Briggs', role: 'manager', phone: '08030000001', dailyRate: 0 },
    { id: 'sp_tamuno', name: 'Tamuno George', role: 'supervisor', phone: '08030000002', dailyRate: 5000 },
    { id: 'sp_chidi', name: 'Chidi Nwosu', role: 'agronomist', phone: '08030000003', dailyRate: 6000 },
    { id: 'sp_emeka', name: 'Emeka Okoro', role: 'hand', phone: '08030000004', dailyRate: 3500 },
    { id: 'sp_blessing', name: 'Blessing Amadi', role: 'hand', phone: '08030000005', dailyRate: 3500 },
  ];

  const plots = [
    { id: 'sp_b1', name: 'Bed 1 (front)', areaM2: 800, drainage: 'raised', soilPh: 5.4 },
    { id: 'sp_b2', name: 'Bed 2 (front)', areaM2: 800, drainage: 'raised', soilPh: 5.3 },
    { id: 'sp_b3', name: 'Bed 3 (low corner)', areaM2: 600, drainage: 'ridged', soilPh: 4.9 },
    { id: 'sp_b4', name: 'Back field', areaM2: 1500, drainage: 'raised', soilPh: 5.6 },
    // FR-GATE-08: two plant-bag houses sharing one media heap, so a trainee
    // can see a failed batch name both of them (docs/walkthrough-bag-zone.md).
    { id: 'sp_bag1', name: 'Bag house A', areaM2: 200, drainage: 'raised', media: 'bag', bagLitres: 20 },
    { id: 'sp_bag2', name: 'Bag house B', areaM2: 120, drainage: 'raised', media: 'bag', bagLitres: 20 },
  ];

  const cycles = [
    { id: 'sp_c1', plotId: 'sp_b4', cropId: 'habanero', variety: 'Ata rodo local',
      transplantDate: d(-135), plants: 4200, areaM2: 1500 },
    { id: 'sp_c2', plotId: 'sp_b1', cropId: 'chili', variety: 'Shombo local',
      transplantDate: d(-80), plants: 3300, areaM2: 800 },
    { id: 'sp_c3', plotId: 'sp_b2', cropId: 'bell', variety: 'California Wonder',
      transplantDate: d(-30), plants: 2600, areaM2: 800 },
    { id: 'sp_c4', plotId: 'sp_b3', cropId: 'habanero', variety: 'Scotch Bonnet',
      transplantDate: d(-12), plants: 1700, areaM2: 600 },
    { id: 'sp_c5', plotId: 'sp_bag1', cropId: 'bell', variety: 'California Wonder',
      transplantDate: d(-20), plants: 300, areaM2: 200 },
  ];

  const events = [
    { type: 'settings.update', payload: { farmName: 'DouValue Farms Limited', location: 'Port Harcourt, Rivers State' } },
    ...people.map((p) => ({ type: 'person.upsert', payload: { ...p, pinHash: pin } })),
    ...plots.map((p) => ({ type: 'plot.upsert', payload: p })),
    ...cycles.map((c) => ({ type: 'cycle.start', payload: c })),
  ];

  // Plant-bag media. Heap 1 was solarised, tested and cleared, then bagged into
  // both bag houses; A is planted, B is waiting. Heap 2 has just arrived and
  // has nothing on record yet. The walkthrough fails heap 1 after planting.
  // Media events go in before the cycle list is replayed, so they carry the
  // dates they happened on (see the stamping at the end).
  events.push({ type: 'media.receive', payload: {
    id: 'sp_mb1', supplier: 'Rumuokoro topsoil and cocopeat yard', date: d(-70), volume: '9 m³',
    solarisedFrom: d(-66), solarisedTo: d(-40) } });
  events.push({ type: 'soiltest.record', payload: {
    id: 'sp_st_mb1', mediaBatchId: 'sp_mb1', date: d(-38), ph: 6.2, readings: [6.1, 6.2, 6.3], points: 3,
    nematode: 'clean', lab: 'Sample soil lab', note: 'Sampled after the plastic came off.' } });
  events.push({ type: 'media.fill', payload: {
    id: 'sp_fill1', batchId: 'sp_mb1', zoneId: 'sp_bag1', bags: 300, date: d(-30) } });
  events.push({ type: 'media.fill', payload: {
    id: 'sp_fill2', batchId: 'sp_mb1', zoneId: 'sp_bag2', bags: 150, date: d(-28) } });
  events.push({ type: 'media.receive', payload: {
    id: 'sp_mb2', supplier: 'Eleme Road nursery supplies', date: d(-4), volume: '6 m³' } });

  // A closed cycle from earlier in the year, so the forecaster has something to
  // calibrate against and the reports are not empty.
  events.push({ type: 'cycle.start', payload: {
    id: 'sp_c0', plotId: 'sp_b1', cropId: 'habanero', variety: 'Ata rodo local',
    transplantDate: d(-330), plants: 3200, areaM2: 800 } });
  for (let i = 0; i < 14; i++) {
    events.push({ type: 'harvest.record', payload: {
      id: uid('h'), cycleId: 'sp_c0', kg: 275 + Math.round(Math.sin(i / 2) * 90),
      grade: 'first', date: d(-250 + i * 7) } });
  }
  events.push({ type: 'cycle.close', payload: { id: 'sp_c0', date: d(-150), note: 'Good season, ratooned then cleared.' } });

  // Store. `reorderLevel` is the "set level" FR-STOCK-02 alerts the Farm
  // Manager at: the sticky traps are deliberately under theirs, so the low
  // stock alert is one of the things a trainee sees.
  const items = [
    { id: 'sp_i1', name: 'Mancozeb 80% WP', kind: 'chemical', unit: 'kg', qty: 6, unitCost: 9500, reorderLevel: 2 },
    { id: 'sp_i2', name: 'NPK 12-12-17+2MgO', kind: 'fertiliser', unit: 'bag', qty: 4, unitCost: 62000, reorderLevel: 2 },
    { id: 'sp_i3', name: 'Urea 46-0-0', kind: 'fertiliser', unit: 'bag', qty: 1, unitCost: 58000, reorderLevel: 2 },
    { id: 'sp_i4', name: 'Neem oil', kind: 'chemical', unit: 'litre', qty: 3, unitCost: 7000, reorderLevel: 2 },
    { id: 'sp_i5', name: 'Agricultural lime', kind: 'fertiliser', unit: 'bag', qty: 8, unitCost: 15000, reorderLevel: 3 },
    { id: 'sp_i6', name: 'Harvest crates', kind: 'consumable', unit: 'piece', qty: 40, unitCost: 3500 },
    { id: 'sp_i7', name: 'Yellow sticky traps', kind: 'consumable', unit: 'piece', qty: 18, unitCost: 350, reorderLevel: 60 },
  ];
  for (const item of items) events.push({ type: 'input.upsert', payload: item });
  for (let i = 1; i <= 8; i++) {
    events.push({ type: 'input.issue', payload: { id: uid('mv'), itemId: 'sp_i1', qty: 0.5, cycleId: 'sp_c2', date: d(-i * 4) } });
    if (i <= 4) events.push({ type: 'input.issue', payload: { id: uid('mv'), itemId: 'sp_i3', qty: 0.25, cycleId: 'sp_c3', date: d(-i * 7) } });
  }

  // Picking on the two mature beds over the last six weeks.
  const pickers = ['sp_emeka', 'sp_blessing'];
  for (let week = 6; week >= 0; week--) {
    for (const day of [0, 3]) {
      const when = d(-(week * 7 + day));
      events.push({ type: 'harvest.record', by: 'sp_emeka', payload: {
        id: uid('h'), cycleId: 'sp_c1', kg: 95 + Math.round(Math.cos(week) * 25), crates: 8,
        grade: 'first', date: when } });
      events.push({ type: 'harvest.record', by: 'sp_blessing', payload: {
        id: uid('h'), cycleId: 'sp_c2', kg: 40 + Math.round(Math.sin(week) * 12), crates: 3,
        grade: week === 2 ? 'second' : 'first', date: when } });
    }
  }

  // Sprays, including one recent enough to still be inside its waiting period.
  events.push({ type: 'spray.record', payload: {
    id: uid('sp'), cycleId: 'sp_c2', productId: 'mancozeb', productName: 'Mancozeb 80% WP',
    phiDays: 7, reiHours: 24, targetProblem: 'anthracnose', operator: 'Tamuno George',
    date: d(-2), at: addDays(today, -2).toISOString(), note: 'Whole bed, after three wet days.' } });
  events.push({ type: 'spray.record', payload: {
    id: uid('sp'), cycleId: 'sp_c1', productId: 'neem', productName: 'Neem oil',
    phiDays: 0, reiHours: 4, targetProblem: 'aphids', operator: 'Tamuno George',
    date: d(-5), at: addDays(today, -5).toISOString(), note: 'Spot sprayed the edge rows only.' } });
  events.push({ type: 'spray.record', payload: {
    id: uid('sp'), cycleId: 'sp_c3', productId: 'copper_oxychloride', productName: 'Copper oxychloride',
    phiDays: 3, reiHours: 24, targetProblem: 'bacterial_leaf_spot', operator: 'Tamuno George',
    date: d(-16), at: addDays(today, -16).toISOString(), note: '' } });

  // Scouting and a live problem report.
  events.push({ type: 'scout.record', payload: {
    id: uid('sc'), cycleId: 'sp_c1', finding: 'Aphids on young leaves, edge rows',
    affectedPct: 20, note: 'Ants everywhere on the same plants.', date: d(-6) } });
  events.push({ type: 'scout.record', payload: {
    id: uid('sc'), cycleId: 'sp_c3', finding: 'Clean', affectedPct: 0, note: '', date: d(-3) } });
  events.push({ type: 'report.record', by: 'sp_emeka', payload: {
    id: uid('r'), cycleId: 'sp_c4', severity: 'high',
    note: 'Three plants in the low corner wilted overnight. Leaves still green.', date: d(-1) } });

  // Jobs for today.
  events.push({ type: 'task.create', payload: {
    id: uid('t'), title: 'Pick Bed 4 habanero, first grade only', assignedTo: 'sp_emeka',
    cycleId: 'sp_c1', dueDate: isoDate(today), priority: 'high' } });
  events.push({ type: 'task.create', payload: {
    id: uid('t'), title: 'Clear the drain along Bed 3', assignedTo: 'sp_blessing',
    cycleId: 'sp_c4', dueDate: isoDate(today), priority: 'high' } });
  events.push({ type: 'task.create', payload: {
    id: uid('t'), title: 'Side-dress Bed 2 with NPK', assignedTo: 'sp_blessing',
    cycleId: 'sp_c3', dueDate: d(1), priority: 'normal' } });

  // Attendance across the whole picking period, so the record checks are not
  // shouting about work with no matching shift in what is only demo data.
  for (let i = 45; i >= 1; i--) {
    const day = addDays(today, -i);
    if (day.getDay() === 0) continue; // Sunday off
    for (const person of pickers.concat('sp_tamuno')) {
      events.push({ type: 'attendance.in', by: person, payload: { personId: person, date: isoDate(day) },
        at: new Date(day.setHours(7, 0, 0, 0)).toISOString() });
      events.push({ type: 'attendance.out', by: person, payload: { personId: person, date: isoDate(day), hours: 8 },
        at: new Date(day.setHours(15, 0, 0, 0)).toISOString() });
    }
  }
  for (const [activity, hours, cycleId] of [['weeding', 6, 'sp_c3'], ['harvesting', 8, 'sp_c1'],
    ['spraying', 3, 'sp_c2'], ['drainage', 5, 'sp_c4'], ['mulching', 6, 'sp_c3']]) {
    events.push({ type: 'work.log', by: 'sp_emeka', payload: {
      id: uid('w'), activity, hours, cycleId, date: d(-Math.ceil(Math.random() * 10)) } });
  }

  // End-of-shift reports, so the Farm Manager's board is not empty in practice
  // mode and a trainee can see what one looks like — including one that has
  // been answered (FR-TASK-05, UX-09).
  const shifts = [
    ['sp_emeka', -2, 'sp_b2', 'Picked Bed 1 and Bed 2, about eleven crates between them. '
      + 'Traps in Bed 2 looked busy, told Tamuno.'],
    ['sp_blessing', -1, 'sp_b3', 'Cleared the drain along Bed 3 after the rain. Two plants at '
      + 'the low end still standing in water.'],
    ['sp_emeka', 0, 'sp_b1', 'Scouted Bed 1, counted the traps and replaced two. Nothing on the '
      + 'young leaves today.'],
  ];
  for (const [person, offset, zoneId, observation] of shifts) {
    const id = uid('sh');
    events.push({ type: 'shift.record', by: person, payload: {
      id, personId: person, date: d(offset), zoneId, observation },
    at: new Date(`${d(offset)}T17:10:00`).toISOString() });
    if (offset === -2) {
      events.push({ type: 'shift.comment', by: 'sp_ada', payload: {
        id: uid('shc'), shiftId: id,
        note: 'Thank you — Tamuno counted Bed 2 this morning and it is over. Spray goes on at four.' },
      at: new Date(`${d(offset + 1)}T07:20:00`).toISOString() });
    }
  }

  // Money.
  for (let week = 6; week >= 0; week--) {
    events.push({ type: 'sale.record', payload: {
      id: uid('sale'), cropId: 'habanero', kg: 190, amount: 190 * 2800,
      buyer: 'Mile 3 market trader', date: d(-(week * 7 + 1)) } });
    events.push({ type: 'sale.record', payload: {
      id: uid('sale'), cropId: 'chili', kg: 80, amount: 80 * 1900,
      buyer: 'Creek Road buyer', date: d(-(week * 7 + 1)) } });
  }
  for (const [category, amount, noteText, day] of [
    ['inputs', 248000, '4 bags NPK 12-12-17', -40],
    ['inputs', 58000, '1 bag urea', -25],
    ['transport', 35000, 'Bus to Mile 3, six trips', -14],
    ['equipment', 45000, 'Knapsack sprayer repair', -30],
    ['water', 62000, 'Pump fuel, dry spell', -21],
    ['land', 150000, 'Quarterly land rent', -60],
  ]) {
    events.push({ type: 'expense.record', payload: { id: uid('exp'), category, amount, note: noteText, date: d(day) } });
  }

  // Stamp the batch with authorship and, more importantly, honest timing.
  //
  // Order matters when the log is replayed: a cycle has to be started before it
  // can be closed, and the opening stock has to be set before anything is issued
  // out of it. So setup events are dated well before the history they support,
  // and everything else takes the date it actually carries.
  const SETUP_TYPES = new Set(['settings.update', 'person.upsert', 'plot.upsert', 'input.upsert']);
  const setupAt = new Date(addDays(today, -365)).toISOString();

  const stamped = events.map((e) => {
    const p = e.payload || {};
    const day = p.date || p.transplantDate || p.dueDate;
    return {
      type: e.type,
      payload: e.payload,
      by: e.by || 'sp_ada',
      at: e.at
        || (SETUP_TYPES.has(e.type) ? setupAt : null)
        || (day ? new Date(`${day}T09:00:00`).toISOString() : new Date().toISOString()),
    };
  });

  await store.dispatchMany(stamped);
  return stamped.length;
}
