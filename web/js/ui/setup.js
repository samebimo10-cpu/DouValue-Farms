// The Setup screen — mid-season onboarding, FR-ONB-01 to FR-ONB-08.
//
// For the day the farm starts using the app with crops already in the ground.
// The Owner (and the Farm Manager, who holds `settings`) sees every cropping
// zone, which ones are not set up yet and what each is missing; opens one;
// enters the crop that is growing in it; and then backfills what the gates
// need to know about it. Everything entered here is marked backfilled.

import {
  badge, button, card, cardHead, confirmSheet, empty, esc, field, input, note, readForm, select, textarea, toast,
} from './kit.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { MEDIA_TYPES } from '../domain/media.js';
import { buildCatalogue } from '../domain/catalogue.js';
import {
  backfills, cropDay, DECLARATIONS, HISTORY_WINDOW_DAYS, harvestToDate, preGatesEvidence, PRE_GATES_LABEL,
  scheduleFrom, setupStatus, sprayHistoryStatus, systemOf,
} from '../domain/onboarding.js';
import { isNursery } from '../domain/farm.js';
import { rulesLoaded } from '../rules.js';
import { bindPhoto, photoField, photoPayload, resetPhoto } from './photo.js';
import { addDays, isoDate, kg, uid } from '../util.js';

let openZone = null;

const statusBadge = (row) => ({
  'not-set-up': badge('✕ not set up', 'danger'),
  incomplete: badge(`! ${row.missing.length} missing`, 'warn'),
  complete: badge('✓ set up', 'ok'),
  live: badge('✓ started in the app', 'ok'),
  empty: badge('· empty', 'muted'),
  between: badge('· between cycles', 'muted'),
}[row.status] || '');

export const setupView = {
  perm: 'settings',

  render(ctx) {
    const today = isoDate();
    const status = setupStatus(ctx.state, { today });
    if (!status.rows.length) {
      return card(empty('🗺️', 'No zones yet', 'Add your greenhouses and fields under Zones first.'));
    }
    if (!openZone || !status.rows.some((r) => r.zone.id === openZone)) {
      openZone = (status.incomplete[0] || status.rows[0]).zone.id;
    }
    const row = status.rows.find((r) => r.zone.id === openZone);
    return head(status) + listCard(status) + stockCard(ctx, status) + zonePanel(ctx, row, today);
  },

  mounted() { bindPhoto(document); },

  actions: {
    'setup-zone': (ctx, el) => { openZone = el.dataset.id; ctx.refresh(); },
    'save-onboard': saveOnboard,
    'setup-empty': async (ctx, el) => {
      const ok = await confirmSheet('Nothing growing here?', 'The zone is recorded as empty on setup day. '
        + 'When a crop goes in, it goes through the gates like any other.', 'Yes, it is empty');
      if (!ok) return;
      await ctx.store.dispatch('backfill.record', { id: uid('bf'), kind: 'declare', item: 'zone-empty',
        zoneId: el.dataset.zone, date: isoDate() });
      toast('Recorded as empty');
    },
    'setup-declare': async (ctx, el) => {
      const { item, cycle, zone } = el.dataset;
      const ok = await confirmSheet('Record this?', `${DECLARATIONS[item]}. It goes on the record under your name, `
        + 'marked backfilled, and the gates rely on it.', 'Yes, record it');
      if (!ok) return;
      await ctx.store.dispatch('backfill.record', { id: uid('bf'), kind: 'declare', item, cycleId: cycle, zoneId: zone,
        date: isoDate() });
      toast('Recorded');
    },
    'save-bf-spray': saveSpray,
    'save-bf-harvest': saveHarvest,
    'save-bf-evidence': saveEvidence,
    'save-bf-stock': saveStock,
  },
};

function head(status) {
  return card(
    cardHead('Setup', status.complete ? badge('✓ complete', 'ok')
      : badge(`${status.incomplete.length + (status.farm.complete ? 0 : 1)} to finish`, 'warn'))
    + '<p><small>For crops that were already growing when the farm started using the app. Enter what is in '
    + 'each zone and when it was transplanted; the week and the task schedule follow from that date. Then '
    + 'enter what the gates need to know from before today. Every entry here is marked backfilled and kept '
    + 'apart from live records.</small></p>'
    + note('warn', 'A zone with no spray history cannot be sprayed or picked',
      '<small>Until its last insecticide, last fungicide and every spray in the last '
      + `${HISTORY_WINDOW_DAYS} days are entered — or recorded as none — the rotation and the waiting period `
      + 'cannot be checked, so the app blocks both.</small>'),
    { tight: true },
  );
}

function listCard(status) {
  return card(cardHead('Zones')
    + '<ul class="list">' + status.rows.map((r) => `<li data-act="setup-zone" data-id="${esc(r.zone.id)}"`
      + `${r.zone.id === openZone ? ' class="on"' : ''}><div class="grow"><b>${esc(r.zone.name)}</b>`
      + (r.cycle ? `<small>${esc(getCrop(r.cycle.cropId).name)}${r.cycle.variety ? ` · ${esc(r.cycle.variety)}` : ''}`
        + `${r.week != null ? ` · Week ${esc(r.week)}` : ''}</small>` : '')
      + (r.missing.length ? `<small>Missing: ${esc(r.missing.map((m) => m.label).join('; '))}</small>` : '')
      + `</div>${statusBadge(r)}</li>`).join('') + '</ul>');
}

// --- Stock on hand (farm-wide) ------------------------------------------------

function stockCard(ctx, status) {
  const counted = backfills(ctx.state, { kind: 'stock' });
  const items = Object.values(ctx.state.inputs || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return card(
    cardHead('Stock on hand', status.farm.complete ? badge(`✓ ${counted.length} counted`, 'ok') : badge('! not counted', 'warn'))
    + (counted.length ? `<ul>${counted.map((c) => `<li><small>${esc(c.name || c.itemId)}: ${esc(c.qty)} ${esc(c.unit || '')}`
      + ` · counted ${esc(c.date)}</small></li>`).join('')}</ul>` : '')
    + '<form data-act="save-bf-stock">'
    + field('Item', select('itemId', [...items.map((i) => ({ value: i.id, label: i.name })), { value: '__new', label: 'Something not in the store yet' }], '', { placeholder: 'Choose' }))
    + field('New item name', input('name', { placeholder: 'only for something not in the store' }))
    + field('Unit', input('unit', { placeholder: 'litre, kg, pack…' }))
    + field('Quantity on the shelf today', input('qty', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', required: true }))
    + '<button type="submit" class="btn-block">Save count</button></form>',
  );
}

async function saveStock(ctx, form) {
  const d = readForm(form);
  const isNew = !d.itemId || d.itemId === '__new';
  if (isNew && !d.name) { toast('Name the item', true); return; }
  if (d.qty == null || d.qty < 0) { toast('Enter the quantity on the shelf', true); return; }
  const existing = !isNew ? ctx.state.inputs[d.itemId] : null;
  await ctx.store.dispatch('backfill.record', {
    id: uid('bf'), kind: 'stock', itemId: isNew ? uid('in') : d.itemId,
    name: existing ? existing.name : d.name, unit: d.unit || (existing && existing.unit) || '', qty: d.qty, date: isoDate(),
  });
  toast('Count saved');
}

// --- One zone -----------------------------------------------------------------

function zonePanel(ctx, row, today) {
  let out = `<h2 class="section">${esc(row.zone.name)}</h2>`;
  if (isNursery(row.zone)) return out;
  if (row.status === 'live') {
    return out + card(note('ok', 'Started in the app', '<small>This crop was planted through the gates, so its whole '
      + 'history is already on record. Nothing to set up.</small>'));
  }
  if (!row.cycle) return out + onboardForm(row);

  const c = row.cycle;
  const at = cropDay(c.transplantDate, today);
  const stage = at ? stageAt(c.cropId, at.days) : null;
  const next = scheduleFrom(ctx.state, c.id, { from: today, days: 7 });
  out += card(
    cardHead(`${getCrop(c.cropId).name}${c.variety ? ` · ${c.variety}` : ''}`, statusBadge(row))
    + `<p><small>${esc((MEDIA_TYPES[c.media] || MEDIA_TYPES.bed).label)} · transplanted ${esc(c.transplantDate)} · `
    + `set up ${esc(c.onboarded.date)}</small></p>`
    + (at ? `<p><b>Week ${esc(at.week)}, day ${esc(at.dayOfWeek)}</b> <small>(${esc(at.days)} days after transplant`
      + `${stage ? `, ${esc(stage.name)}` : ''})</small></p>` : '')
    + note('info', PRE_GATES_LABEL, '<small>Not a violation and no override needed. The Gates screen shows what each '
      + 'gate found, with any evidence attached below. Gate 4 at the end of this cycle is judged as normal.</small>')
    + (row.missing.length ? note('warn', 'Still missing', `<ul>${row.missing.map((m) => `<li><small>${esc(m.label)}</small></li>`).join('')}</ul>`) : '')
    + `<p><small><b>Schedule from today:</b> ${next.length
      ? esc([...new Set(next.map((t) => `${t.date.slice(5)} ${t.kind}`))].slice(0, 12).join(', '))
      : 'nothing due this week'}.</small></p>`,
  );
  out += sprayCard(ctx, c, row.zone, today);
  out += harvestCard(ctx, c, row.zone);
  out += evidenceCard(ctx, c, row.zone);
  return out;
}

function onboardForm(row) {
  const crops = CROP_LIST.map((c) => ({ value: c.id, label: c.name }));
  const varieties = [...new Set(CROP_LIST.flatMap((c) => c.varieties || []))];
  return card(
    cardHead('What is growing here?')
    + '<form data-act="save-onboard">'
    + `<input type="hidden" name="plotId" value="${esc(row.zone.id)}">`
    + field('Media type', select('media', Object.values(MEDIA_TYPES).map((m) => ({ value: m.id, label: m.label })),
      row.zone.media === 'bag' ? 'bag' : 'bed'))
    + field('Crop', select('cropId', crops, '', { required: true, placeholder: 'Choose' }))
    + field('Variety', `<input name="variety" list="setup-varieties" required placeholder="e.g. Nikita F1">`
      + `<datalist id="setup-varieties">${varieties.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`)
    + field('Transplant date', input('transplantDate', { type: 'date', required: true, max: isoDate(addDays(isoDate(), -1)) }),
      'The week, the Week 10 rule and the task schedule are all worked out from this date.')
    + field('Plants (if known)', input('plants', { type: 'number', min: 0, step: 1, inputmode: 'numeric' }))
    + '<button type="submit" class="btn-block btn-lg">Set up this crop</button></form>'
    + button('Nothing is growing here', 'setup-empty', { cls: 'btn-ghost btn-block', data: { zone: row.zone.id } }),
  );
}

async function saveOnboard(ctx, form) {
  const d = readForm(form);
  const today = isoDate();
  if (!d.cropId || !d.variety || !d.transplantDate) { toast('Crop, variety and transplant date are all needed', true); return; }
  if (!(d.transplantDate < today)) { toast('A crop planted today goes through the gates, not setup', true); return; }
  const at = cropDay(d.transplantDate, today);
  const ok = await confirmSheet('Set up this crop?',
    `${getCrop(d.cropId).name}, ${d.variety}, transplanted ${d.transplantDate}: that puts it in Week ${at.week} today. `
    + 'The schedule starts from this week. It is shown as planted before the gates.', 'Yes, set it up');
  if (!ok) return;
  const zone = ctx.state.plots[d.plotId];
  if (zone && zone.media !== d.media) await ctx.store.dispatch('plot.upsert', { id: d.plotId, media: d.media });
  await ctx.store.dispatch('cycle.onboard', {
    id: uid('c'), plotId: d.plotId, media: d.media, cropId: d.cropId, variety: d.variety,
    transplantDate: d.transplantDate, plants: d.plants || null, areaM2: (zone && zone.areaM2) || null, setupDate: today,
  });
  toast(`Set up — Week ${at.week}`);
}

// --- Spray history --------------------------------------------------------------

function sprayForm(cycle, zone, slot, actives, today) {
  const min = slot === 'recent' ? isoDate(addDays(today, -HISTORY_WINDOW_DAYS)) : null;
  return '<form data-act="save-bf-spray">'
    + `<input type="hidden" name="cycleId" value="${esc(cycle.id)}"><input type="hidden" name="zoneId" value="${esc(zone.id)}">`
    + `<input type="hidden" name="slot" value="${esc(slot)}">`
    + field('Active ingredient', select('activeId', actives.map((a) => ({ value: a.id, label: `${a.name} — ${a.group}` })),
      '', { placeholder: 'Not in the list', required: false }))
    + field('Or the product name', input('productName', { placeholder: 'as written on the container' }))
    + field('Group (if not in the list)', input('group', { placeholder: 'e.g. IRAC 5, FRAC M3' }))
    + field('Date sprayed', input('date', { type: 'date', required: true, max: today, ...(min ? { min } : {}) }))
    + field('Waiting period on the label, days', input('phiDays', { type: 'number', min: 0, step: 1, inputmode: 'numeric' }),
      'Blank uses the default. A shorter figure than the default is not used (FR-STOCK-07).')
    + '<button type="submit" class="btn-block">Save</button></form>';
}

function sprayCard(ctx, cycle, zone, today) {
  const catalogue = rulesLoaded() ? buildCatalogue(ctx.state) : { actives: [] };
  const history = sprayHistoryStatus(ctx.state, cycle.id, rulesLoaded() ? { catalogue } : {});
  const sprays = backfills(ctx.state, { cycleId: cycle.id, kind: 'spray' });
  const bySystem = (system) => catalogue.actives.filter((a) => a.groupSystem === system);
  const lineOf = (id) => history.lines.find((l) => l.id === id) || { have: false };
  const section = (id, title, system, declare) => {
    const l = lineOf(id);
    return `<h3>${l.have ? '✓' : '✕'} ${esc(title)}</h3>`
      + (l.have ? `<p><small>${esc(l.from || '')}</small></p>` : '')
      + `<details${l.have ? '' : ' open'}><summary><small>${l.have ? 'Enter a later one' : 'Enter it'}</small></summary>`
      + sprayForm(cycle, zone, id, system ? bySystem(system) : catalogue.actives, today)
      + (declare && !l.have ? button(DECLARATIONS[declare], 'setup-declare',
        { cls: 'btn-ghost btn-block', data: { item: declare, cycle: cycle.id, zone: zone.id } }) : '')
      + '</details>';
  };
  const recent = sprays.filter((s) => s.date >= isoDate(addDays(today, -HISTORY_WINDOW_DAYS)));
  return card(
    cardHead('Spray history', history.known ? badge('✓ on record', 'ok') : badge('✕ missing', 'danger'))
    + section('insecticide', 'Last insecticide', 'IRAC', 'no-insecticide')
    + section('fungicide', 'Last fungicide', 'FRAC', 'no-fungicide')
    + `<h3>${lineOf('recent').have ? '✓' : '✕'} Every spray in the last ${HISTORY_WINDOW_DAYS} days</h3>`
    + (recent.length ? `<ul>${recent.map((s) => `<li><small>${esc(s.date)} · ${esc(s.productName || s.activeId || '')}`
      + ` · ${esc(s.group || systemOf(s, rulesLoaded() ? catalogue : null) || '')} · backfilled</small></li>`).join('')}</ul>`
      : '<p><small>None entered.</small></p>')
    + `<details><summary><small>Add one</small></summary>${sprayForm(cycle, zone, 'recent', catalogue.actives, today)}</details>`
    + (lineOf('recent').have ? '' : button(`That is all of them (${recent.length})`, 'setup-declare',
      { cls: 'btn-ghost btn-block', data: { item: 'recent-complete', cycle: cycle.id, zone: zone.id } })),
  );
}

async function saveSpray(ctx, form) {
  const d = readForm(form);
  const today = isoDate();
  if (!d.activeId && !d.productName) { toast('Choose the active or write the product name', true); return; }
  if (!d.date || d.date > today) { toast('Enter the day it was sprayed', true); return; }
  const catalogue = rulesLoaded() ? buildCatalogue(ctx.state) : null;
  const active = catalogue && d.activeId ? catalogue.byId[d.activeId] : null;
  if (!active && !d.group && d.slot !== 'recent') { toast('Enter its group, e.g. IRAC 5', true); return; }
  await ctx.store.dispatch('backfill.record', {
    id: uid('bf'), kind: 'spray', slot: d.slot, cycleId: d.cycleId, zoneId: d.zoneId,
    activeId: active ? active.id : null, productName: active ? active.name : d.productName,
    group: active ? active.group : d.group || '', date: d.date,
    phiDays: d.phiDays != null ? d.phiDays : null,
  });
  toast('Spray saved, marked backfilled');
}

// --- Harvest to date ---------------------------------------------------------------

function harvestCard(ctx, cycle, zone) {
  const latest = harvestToDate(ctx.state, cycle.id);
  return card(
    cardHead('Harvest to date', latest ? badge(`✓ ${kg(latest.kg, 0)}`, 'ok') : badge('✕ missing', 'danger'))
    + (latest ? `<p><small>${esc(kg(latest.kg, 1))} as of ${esc(latest.date)}, backfilled.</small></p>` : '')
    + '<form data-act="save-bf-harvest">'
    + `<input type="hidden" name="cycleId" value="${esc(cycle.id)}"><input type="hidden" name="zoneId" value="${esc(zone.id)}">`
    + field('Kilograms picked so far this cycle', input('kg', { type: 'number', min: 0, step: '0.1', inputmode: 'decimal', required: true }),
      '0 if nothing has been picked yet.')
    + '<button type="submit" class="btn-block">Save</button></form>',
  );
}

async function saveHarvest(ctx, form) {
  const d = readForm(form);
  if (d.kg == null || d.kg < 0) { toast('Enter the kilograms, or 0', true); return; }
  await ctx.store.dispatch('backfill.record', { id: uid('bf'), kind: 'harvest', cycleId: d.cycleId, zoneId: d.zoneId,
    kg: d.kg, date: isoDate() });
  toast('Harvest to date saved');
}

// --- Gate evidence ----------------------------------------------------------------

function evidenceCard(ctx, cycle, zone) {
  const have = preGatesEvidence(ctx.state, zone.id, cycle.id);
  return card(
    cardHead('Gate evidence that exists', badge(`${have.length} attached`, have.length ? 'ok' : 'muted'))
    + '<p><small>Anything from before planting: a lab report, a pH reading, the checklist, a photo. It is attached to the '
    + `zone's "${esc(PRE_GATES_LABEL)}" status. Nothing here is required.</small></p>`
    + (have.length ? `<ul>${have.map((e) => `<li><small>${esc(e.gate)} · ${esc(e.what)} · ${esc(e.date || '')}`
      + `${e.ph != null ? ` · pH ${esc(e.ph)}` : ''}${e.lab ? ` · ${esc(e.lab)}` : ''}${e.photo ? ' · photo' : ''}</small></li>`).join('')}</ul>` : '')
    + '<form data-act="save-bf-evidence">'
    + `<input type="hidden" name="cycleId" value="${esc(cycle.id)}"><input type="hidden" name="zoneId" value="${esc(zone.id)}">`
    + field('Gate', select('gate', [
      { value: 'G0', label: 'Gate 0 — ground clearance (soil, lab, pH)' },
      { value: 'CR', label: 'Clean restart (GH-04, GH-05)' },
      { value: 'G1', label: 'Gate 1 — establishment readiness' },
    ], 'G0'))
    + field('What it is', input('what', { required: true, placeholder: 'e.g. nematode assay, clean' }))
    + field('Date', input('date', { type: 'date' }))
    + field('pH, if it is a reading', input('ph', { type: 'number', min: 0, max: 14, step: '0.1', inputmode: 'decimal' }))
    + field('Lab, if any', input('lab'))
    + field('Note', textarea('note'))
    + photoField('Photo of the report', 'A picture of the paper is better than a summary of it.')
    + '<button type="submit" class="btn-block">Attach</button></form>',
  );
}

async function saveEvidence(ctx, form) {
  const d = readForm(form);
  if (!d.what) { toast('Say what it is', true); return; }
  await ctx.store.dispatch('backfill.record', {
    id: uid('bf'), kind: 'evidence', cycleId: d.cycleId, zoneId: d.zoneId, gate: d.gate, what: d.what,
    date: d.date || null, ph: d.ph, lab: d.lab || '', note: d.note || '', photo: photoPayload(),
  });
  resetPhoto();
  toast('Evidence attached, marked backfilled');
}
