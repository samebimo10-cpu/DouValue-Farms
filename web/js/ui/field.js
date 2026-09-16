// Field screens: the beds, what is growing in them, and everything done to them.

import {
  badge, bar, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, note, openSheet, readForm, select, spark, stat, table, textarea, toast,
} from './kit.js';
import { activeCycles, can, closedCycles, cycleLabel, spraysForCycle } from '../store.js';
import { CROP_LIST, fertiliserPlan, getCrop, plantsForArea, stagesFor, stageAt, waterDemandMmPerDay } from '../domain/crops.js';
import { harvestForecast, revenueForecast, calibrate, healthFactor } from '../domain/predict.js';
import { harvestClearance, PRODUCTS, PRODUCT_BY_ID, reentryClearance, resistanceWarnings, knapsackPlan, SPRAY_RULES } from '../domain/safety.js';
import { irrigationGapMmPerDay, litresPerPlantPerDay, seasonOn } from '../domain/climate.js';
import { canPlant, canTreat, gateBoard, GATE_STATE } from '../domain/gates.js';
import { DEFAULT_THRESHOLDS } from '../domain/alerts.js';
import { PROBLEM_BY_ID } from '../domain/pests.js';
import { addDays, daysBetween, esc as _esc, friendlyDate, isoDate, kg, naira, round, sum, uid } from '../util.js';
import { navigate, params } from './shell.js';
import { bindPhoto, photoField, photoPayload, photoThumb, resetPhoto } from './photo.js';
import { getLang } from '../i18n.js';

/**
 * The pests with action thresholds, for the scouting form.
 *
 * Deliberately only these. A list of all thirty-two problems makes the field
 * screen a scrolling exercise, and anything without a threshold cannot raise an
 * alert anyway — it belongs in the written observation.
 */
const COUNTED_PESTS = Object.keys(DEFAULT_THRESHOLDS)
  .map((id) => ({ value: id, label: (PROBLEM_BY_ID[id] || {}).name || id }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * A number entry with + and - beside it — UX-10.
 *
 * Small changes are a tap; a big number is still typed. Counting thrips on a
 * trap is the former, counting aphids is the latter.
 */
function numberField(name, value = '') {
  return '<div class="stepper">'
    + `<button type="button" class="step" data-act="step" data-name="${esc(name)}" data-by="-1">−</button>`
    + `<input type="number" inputmode="numeric" name="${esc(name)}" value="${esc(value)}" `
    + 'min="0" step="1" placeholder="—">'
    + `<button type="button" class="step" data-act="step" data-name="${esc(name)}" data-by="1">+</button>`
    + '</div>';
}

function calibrationFor(state) { return calibrate(closedCycles(state).map((c) => ({ ...c, plants: c.plants }))); }

/** When a record was actually entered, which is not always the day it claims. */
function stampOf(record) {
  const at = record.at || record.enteredAt;
  if (!at) return 'time not recorded';
  const day = at.slice(0, 10);
  const clock = new Date(at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  return record.date && record.date !== day
    ? `${friendlyDate(day)} ${clock} (for ${record.date})`
    : `${friendlyDate(day)} ${clock}`;
}

function cropDot(cropId) {
  return `<span class="crop-dot" style="background:${getCrop(cropId).colour}"></span>`;
}

// --- Field list -----------------------------------------------------------

export const fieldView = {
  perm: 'viewGuide',
  render(ctx) {
    const { state } = ctx;
    const cycles = activeCycles(state);
    const cal = calibrationFor(state);
    const today = isoDate();

    let out = card(
      cardHead('The field', badge(`${cycles.length} active`, cycles.length ? 'ok' : ''))
      + `<p><small>${esc(seasonOn(today).label)} in ${esc(state.settings.location)}. `
      + `${esc(Object.keys(state.plots).length)} beds registered.</small></p>`
      + '<div class="row wrap">'
      + button('Start a crop cycle', 'open-new-cycle', { icon: '🌱' })
      + button('Zones and cover', 'go', { cls: 'btn-ghost', icon: '🏠', data: { to: '#/zones' } })
      + '</div>',
      { tight: true },
    );

    // The gates belong here rather than behind a menu: this is the screen
    // someone is on when they are about to plant, which is the moment the
    // checks either happen or do not.
    out += gateSummary(state, today);

    if (!cycles.length) {
      out += card(empty('🌱', 'Nothing planted yet',
        'Add a bed, then start a crop cycle on it. Everything else in the app hangs off that.'));
      return out + closedList(state);
    }

    for (const cycle of cycles) {
      const crop = getCrop(cycle.cropId);
      const dat = daysBetween(cycle.transplantDate, today);
      const stage = stageAt(cycle.cropId, dat);
      const forecast = harvestForecast(cycle, { today, calibration: cal });
      const sprays = spraysForCycle(state, cycle.id);
      const clearance = harvestClearance(sprays);
      const reentry = reentryClearance(sprays);
      const progress = Math.min(1, Math.max(0, dat / crop.cycleDays));
      const picked = cycle.harvestedKg || 0;

      out += card(
        `<div class="card-head">${cropDot(cycle.cropId)}<h2>${esc(cycleLabel(state, cycle.id))}</h2>`
        + badge(stage.name, stage.id === 'harvest' ? 'ok' : '') + '</div>'
        + `<p style="margin-bottom:6px"><small>${esc(crop.emoji)} ${esc(crop.name)} — day ${dat} after transplant, `
        + `${esc(cycle.plants || plantsForArea(cycle.cropId, cycle.areaM2 || 0))} plants</small></p>`
        + bar(progress)
        + '<div class="grid" style="margin-top:12px">'
        + stat('Expected total', kg(forecast.totalKg, 0), `${forecast.confidence} estimate`)
        + stat('Picked so far', kg(picked, 0), picked > 0 ? `${Math.round((picked / Math.max(forecast.totalKg, 1)) * 100)}% of forecast` : 'nothing yet')
        + stat(dat >= crop.daysToFirstHarvest ? 'Picking until' : 'First pick',
          dat >= crop.daysToFirstHarvest
            ? friendlyDate(forecast.milestones.lastHarvest)
            : friendlyDate(forecast.milestones.firstHarvest),
          dat >= crop.daysToFirstHarvest ? '' : `${forecast.milestones.daysToFirstHarvest} days`)
        + '</div>'
        + (!clearance.safe ? note('danger', `Do not pick until ${clearance.clearOn}`, `<small>${esc(clearance.reason)}</small>`) : '')
        + (!reentry.safe ? note('warn', `Keep out for ${reentry.hoursLeft} more hours`, '') : '')
        + `<div class="note info" style="margin:12px 0 0"><b>${esc(stage.name)}</b><small>${esc(stage.job)}</small></div>`
        + '<div class="row wrap" style="margin-top:12px">'
        + button('Open', 'go', { cls: 'btn-sm', data: { to: `#/field/cycle?id=${cycle.id}` } })
        + button('Scout', 'open-scout', { cls: 'btn-sm btn-ghost', data: { id: cycle.id } })
        + button('Log spray', 'open-spray', { cls: 'btn-sm btn-ghost', data: { id: cycle.id } })
        + '</div>',
      );
    }

    return out + closedList(state);
  },

  actions: {
    'open-new-plot': (ctx) => openPlotSheet(ctx),
    'open-new-cycle': (ctx) => openCycleSheet(ctx),
    'save-plot': (ctx, form) => savePlot(ctx, form),
    'save-cycle': (ctx, form) => saveCycle(ctx, form),
    'open-scout': (ctx, el) => openScoutSheet(ctx, el.dataset.id),
    // UX-10: + and - move the count without opening the keypad.
    step: (ctx, el) => {
      const box = el.closest('.stepper');
      const field = box && box.querySelector('input');
      if (!field) return;
      const next = (Number(field.value) || 0) + Number(el.dataset.by || 0);
      field.value = String(Math.max(0, next));
    },
    'save-scout': (ctx, form) => saveScout(ctx, form),
    'open-spray': (ctx, el) => openSpraySheet(ctx, el.dataset.id),
    'save-spray': (ctx, form) => saveSpray(ctx, form),
    'spray-product-change': (ctx, el) => updateSprayHints(ctx, el),
    'cycle-crop-change': (ctx, el) => updateCycleHints(ctx, el),
  },
};

function closedList(state) {
  const closed = closedCycles(state);
  if (!closed.length) return '';
  return card(
    cardHead('Finished cycles')
    + table([{ label: 'Bed' }, { label: 'Crop' }, { label: 'Picked', num: true }, { label: 'Per plant', num: true }],
      closed.slice(-8).reverse().map((c) => [
        cycleLabel(state, c.id),
        getCrop(c.cropId).name,
        kg(c.actualKg || 0, 0),
        c.plants ? `${round((c.actualKg || 0) / c.plants, 2)} kg` : '—',
      ]))
    + '<p style="margin:10px 0 0"><small>Every finished cycle teaches the forecaster what this farm '
    + 'actually yields, so the next estimate is closer.</small></p>',
  );
}

// --- Cycle detail ---------------------------------------------------------

export const cycleView = {
  perm: 'viewGuide',
  render(ctx) {
    const { state } = ctx;
    const id = params().id;
    const cycle = state.cycles[id];
    if (!cycle) return card(empty('🤷', 'That bed is not here', 'It may have been removed.'));

    const crop = getCrop(cycle.cropId);
    const today = isoDate();
    const dat = daysBetween(cycle.transplantDate, today);
    const cal = calibrationFor(state);
    const forecast = harvestForecast(cycle, { today, calibration: cal });
    const revenue = revenueForecast(forecast, {
      basePriceNgnPerKg: state.settings.prices[cycle.cropId],
      seasonality: state.settings.seasonality,
      gradeOutPct: state.settings.gradeOutPct,
    });
    const sprays = spraysForCycle(state, cycle.id);
    const scouts = state.scouts.filter((s) => s.cycleId === cycle.id).slice(-5).reverse();
    const harvests = state.harvests.filter((h) => h.cycleId === cycle.id);
    const clearance = harvestClearance(sprays);
    const plants = cycle.plants || plantsForArea(cycle.cropId, cycle.areaM2 || 0);

    // Prices and crop values are commercial. A role without money authority is
    // not sent the farm's real prices at all, so showing a value here would be
    // the app's built-in estimate dressed up as this farm's figure.
    const showsMoney = can(ctx.user, 'manageMoney');

    let out = card(
      `<div class="card-head">${cropDot(cycle.cropId)}<h2>${esc(cycleLabel(state, cycle.id))}</h2>`
      + badge(forecast.stage.name) + '</div>'
      + `<p><small>${esc(crop.emoji)} ${esc(crop.name)} (${esc(crop.localName)}) · ${esc(cycle.variety || 'variety not recorded')}<br>`
      + `Transplanted ${esc(friendlyDate(cycle.transplantDate))} · day ${dat} · ${plants.toLocaleString('en-NG')} plants</small></p>`
      + (!clearance.safe ? note('danger', `Spray waiting period: no picking until ${clearance.clearOn}`,
        `<small>${esc(clearance.reason)}</small>`) : '')
      + '<div class="grid">'
      + stat('Forecast', kg(forecast.totalKg, 0), `${round(forecast.perPlantKg, 2)} kg/plant`)
      + stat('Picked', kg(cycle.harvestedKg || 0, 0), `${harvests.length} pickings`)
      + stat('Still to come', kg(forecast.remainingKg, 0), showsMoney ? naira(revenue.remainingRevenue, true) : 'to pick')
      + (showsMoney
        ? stat('Crop value', naira(revenue.totalRevenue, true), `at ~${naira(revenue.averagePrice)}/kg`)
        : stat('Picking until', friendlyDate(forecast.milestones.lastHarvest), 'end of the window'))
      + '</div>',
      { tight: true },
    );

    // Timeline
    out += card(
      cardHead('Where it is in the cycle')
      + '<ul class="timeline">'
      + stagesFor(cycle.cropId).filter((s) => s.id !== 'closed').map((s) => {
        const when = addDays(cycle.transplantDate, s.from);
        const done = dat > s.from;
        const now = forecast.stage.id === s.id;
        return `<li class="${now ? 'now' : done ? 'done' : ''}"><b>${esc(s.name)}</b> `
          + `<small>${esc(friendlyDate(when))}</small><br><small>${esc(s.job)}</small></li>`;
      }).join('')
      + '</ul>',
    );

    // Picking curve
    const future = forecast.curve.filter((w) => !w.past);
    out += card(
      cardHead('Expected picking, week by week')
      + spark(forecast.curve.map((w) => ({ value: w.kg, dim: w.past, label: `${w.from}: ${w.kg} kg` })),
        { caption: 'Grey weeks are already past. Height is kilograms expected that week.' })
      + (future.length
        ? (showsMoney
          ? table([{ label: 'Week of' }, { label: 'Expect', num: true }, { label: 'Price', num: true }, { label: 'Worth', num: true }],
            revenue.weeks.filter((w) => !w.past).slice(0, 6).map((w) => [
              friendlyDate(w.from), kg(w.kg, 0), naira(w.priceNgnPerKg), naira(w.revenue, true)]))
          : table([{ label: 'Week of' }, { label: 'Expect', num: true }],
            forecast.curve.filter((w) => !w.past).slice(0, 6).map((w) => [friendlyDate(w.from), kg(w.kg, 0)])))
        : '<p><small>Picking window has closed.</small></p>')
      + '<details style="margin-top:10px"><summary><small>How this was worked out</small></summary>'
      + '<ul>' + forecast.assumptions.concat(showsMoney ? revenue.assumptions : [])
        .map((a) => `<li><small>${esc(a)}</small></li>`).join('') + '</ul>'
      + '</details>',
    );

    // Feeding plan
    const plan = fertiliserPlan(cycle.cropId);
    const areaHa = (cycle.areaM2 || plants * crop.spacing.inRow * crop.spacing.betweenRow) / 10000;
    out += card(
      cardHead('Feeding plan')
      + table([{ label: 'When' }, { label: 'What' }, { label: 'Amount', num: true }, { label: 'Status' }],
        plan.map((step) => {
          const when = addDays(cycle.transplantDate, step.dat);
          const due = daysBetween(when, today);
          const status = due > 7 ? badge('done or missed', due > 21 ? 'warn' : '')
            : due >= -3 ? badge('due now', 'warn') : badge('later');
          return [friendlyDate(when), `${step.name}: ${step.product}`,
            `${Math.round(step.rateKgHa * areaHa)} kg`, { __raw: status }];
        }))
      + `<p style="margin:10px 0 0"><small>Rates scaled to this bed (${round(areaHa, 3)} ha). `
      + 'Split doses beat one big dose: in this rainfall a single heavy application mostly leaches away.</small></p>',
    );

    // Water
    const demand = waterDemandMmPerDay(cycle.cropId, dat);
    const gap = irrigationGapMmPerDay(today, demand);
    out += card(
      cardHead('Water')
      + '<div class="grid">'
      + stat('Crop needs', `${demand} mm/day`, forecast.stage.name)
      + stat('Rain gives', `${round(Math.max(0, demand - gap), 1)} mm/day`, 'seasonal average')
      + stat('You must add', gap > 0.2 ? `${round(gap, 1)} mm/day` : 'nothing', gap > 0.2
        ? `${litresPerPlantPerDay(gap, crop.spacing)} litres per plant per day` : 'rain is covering it')
      + '</div>',
    );

    // Sprays
    out += card(
      cardHead('Spray record', button('Log spray', 'open-spray', { cls: 'btn-sm', data: { id: cycle.id } }))
      + (sprays.length
        ? table([{ label: 'Date' }, { label: 'Product' }, { label: 'Safe to pick' }, { label: 'Recorded' }, { label: 'Label photo' }],
          [...sprays].reverse().slice(0, 10).map((s) => {
            const product = PRODUCT_BY_ID[s.productId];
            return [s.date, product ? product.name : s.productName || '—',
              isoDate(addDays(s.date, product ? product.phiDays : 0)),
              stampOf(s), s.photo ? 'yes' : 'no'];
          }))
        : '<p><small>Nothing sprayed on this bed yet.</small></p>'),
    );

    // Scouting
    out += card(
      cardHead('Scouting', button('Scout now', 'open-scout', { cls: 'btn-sm btn-ghost', data: { id: cycle.id } }))
      + (scouts.length
        ? '<ul class="list">' + scouts.map((s) => `<li><div class="grow"><b>${esc(s.finding || 'Checked, nothing found')}</b>`
          + `<small>${esc(friendlyDate(s.date))} — ${esc(s.affectedPct ?? 0)}% of plants affected</small>`
          + `<small>Recorded ${esc(stampOf(s))}</small>`
          + photoThumb(s.photo, { small: true, alt: 'Photo from this scouting round' })
          + '</div>'
          + badge(s.affectedPct >= 20 ? 'high' : s.affectedPct >= 5 ? 'watch' : 'low',
            s.affectedPct >= 20 ? 'danger' : s.affectedPct >= 5 ? 'warn' : 'ok') + '</li>').join('') + '</ul>'
        : '<p><small>Nobody has walked this bed yet. Scout once a week, more in the rains.</small></p>'),
    );

    out += card(
      '<div class="row wrap">'
      + button('Close this cycle', 'close-cycle', { cls: 'btn-ghost', data: { id: cycle.id } })
      + button('Back to field', 'go', { cls: 'btn-quiet', data: { to: '#/field' } })
      + '</div>',
      { tight: true },
    );

    return out;
  },

  actions: {
    ...fieldView.actions,
    'close-cycle': async (ctx, el) => {
      const id = el.dataset.id;
      const cycle = ctx.state.cycles[id];
      const ok = await confirmSheet('Close this cycle?',
        `${cycleLabel(ctx.state, id)} has given ${kg(cycle.harvestedKg || 0, 0)} so far. `
        + 'Closing it stops the forecast and files the result, which is what teaches the app '
        + 'what this farm really yields. You cannot record harvest against it afterwards.',
        'Close it');
      if (!ok) return;
      await ctx.store.dispatch('cycle.close', { id, date: isoDate() });
      toast('Cycle closed and filed');
      navigate('#/field');
    },
  },
};

// --- Sheets ---------------------------------------------------------------

function openPlotSheet(ctx) {
  openSheet('<h2>Add a bed</h2>'
    + '<form data-act="save-plot">'
    + field('Name', input('name', { required: true, placeholder: 'e.g. Bed 4, or Back field east' }))
    + field('Size in square metres', input('areaM2', { type: 'number', min: 1, step: '1', value: 600, inputmode: 'numeric' }),
      'A bed 30 m by 20 m is 600 square metres. One hectare is 10,000.')
    + field('Drainage', select('drainage', [
      { value: 'raised', label: 'Raised beds, 30 cm' },
      { value: 'ridged', label: 'Ridges' },
      { value: 'flat', label: 'Flat ground' },
    ], 'raised'), 'Flat ground in this rainfall is the single biggest risk factor for root disease.')
    + field('Soil pH if you know it', input('soilPh', { type: 'number', min: 3, max: 9, step: '0.1', placeholder: 'e.g. 5.2' }),
      'Below 5.5 means lime before you plant. Most soils here need it.')
    + '<button class="btn-block btn-lg" type="submit">Save bed</button></form>');
}

async function savePlot(ctx, form) {
  const data = readForm(form);
  if (!data.name) { toast('Give the bed a name', true); return; }
  await ctx.store.dispatch('plot.upsert', {
    id: uid('plot'), name: data.name, areaM2: Number(data.areaM2) || 0,
    drainage: data.drainage, soilPh: data.soilPh || null,
  });
  closeSheet();
  toast('Bed added');
}

function openCycleSheet(ctx) {
  const plots = Object.values(ctx.state.plots);
  if (!plots.length) {
    openSheet('<h2>Start a crop cycle</h2>' + empty('📍', 'Add a bed first',
      'A cycle has to sit on a bed so the app can work out plant numbers and yields.')
      + button('Add a bed', 'open-new-plot', { cls: 'btn-block' }));
    return;
  }
  openSheet('<h2>Start a crop cycle</h2>'
    + '<form data-act="save-cycle">'
    + field('Bed', select('plotId', plots.map((p) => ({ value: p.id, label: `${p.name} (${p.areaM2} m²)` })), '', { required: true }))
    + field('Crop', `<select name="cropId" data-act="cycle-crop-change">`
      + CROP_LIST.map((c) => `<option value="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)} — ${esc(c.localName)}</option>`).join('')
      + '</select>')
    + field('Variety', `<select name="variety">${getCrop('bell').varieties.map((v) => `<option>${esc(v)}</option>`).join('')}</select>`)
    + field('Transplant date', input('transplantDate', { type: 'date', value: isoDate(), required: true }),
      'The day seedlings went into the field, not the day you sowed the nursery.')
    + field('Number of plants', input('plants', { type: 'number', min: 1, step: '1', inputmode: 'numeric' }),
      'Leave empty and the app works it out from bed size and spacing.')
    + '<div id="cycle-hint"></div>'
    + '<button class="btn-block btn-lg" type="submit">Start cycle</button></form>');
  const sel = document.querySelector('.sheet select[name=cropId]');
  if (sel) updateCycleHints(ctx, sel);
}

function updateCycleHints(ctx, el) {
  const sheet = el.closest('.sheet');
  const cropId = sheet.querySelector('select[name=cropId]').value;
  const crop = getCrop(cropId);
  const plotId = sheet.querySelector('select[name=plotId]').value;
  const plot = ctx.state.plots[plotId];
  const varietySel = sheet.querySelector('select[name=variety]');
  if (varietySel) varietySel.innerHTML = crop.varieties.map((v) => `<option>${esc(v)}</option>`).join('');
  const hint = sheet.querySelector('#cycle-hint');
  if (!hint) return;
  const plants = plot ? plantsForArea(cropId, plot.areaM2) : 0;
  hint.innerHTML = note('info', `${crop.name}: what to expect`,
    `<small>At ${crop.spacing.inRow} m by ${crop.spacing.betweenRow} m spacing this bed holds about `
    + `<b>${plants.toLocaleString('en-NG')} plants</b>. First picking around <b>${crop.daysToFirstHarvest} days</b> `
    + `after transplant, running about ${Math.round(crop.harvestWindowDays / 7)} weeks. `
    + `Watch for: ${crop.watchFor.map((w) => w.replace(/_/g, ' ')).join(', ')}.<br><br>${esc(crop.notes)}</small>`);
}

async function saveCycle(ctx, form) {
  const data = readForm(form);
  const plot = ctx.state.plots[data.plotId];
  if (!plot) { toast('Pick a bed', true); return; }

  // FR-GATE-01/02/03. This is the block, not a warning: planting into untested
  // ground is one of the four things that cost Season 1, and the save simply
  // does not happen. Only the Owner can clear the way, and only on the record.
  const verdict = canPlant(ctx.state, plot.id, { today: isoDate() });
  if (!verdict.ok) {
    closeSheet();
    openGateBlock(ctx, plot, verdict);
    return;
  }

  const plants = Number(data.plants) || plantsForArea(data.cropId, plot.areaM2);
  await ctx.store.dispatch('cycle.start', {
    id: uid('cyc'), plotId: data.plotId, cropId: data.cropId, variety: data.variety,
    transplantDate: data.transplantDate, plants, areaM2: plot.areaM2,
  });
  closeSheet();
  toast(`${getCrop(data.cropId).name} started on ${plot.name}`);
}

/**
 * What a blocked planting looks like.
 *
 * Deliberately not a toast. A refusal that flashes past teaches people the app
 * is unreliable; a refusal that names the gate, says what it found and says
 * what would clear it teaches them the order of work.
 */
function openGateBlock(ctx, plot, verdict) {
  const owner = can(ctx.user, 'manageOwners');
  openSheet(`<h2>Cannot plant ${esc(plot.name)} yet</h2>`
    + `<p><small>${esc(verdict.why)}. These checks exist because Season 1 went into ground `
    + 'nobody had tested.</small></p>'
    + verdict.blocking.map((g) => note('danger', `${GATE_STATE[g.state].icon} ${g.name}`,
      `<small><b>${esc(g.why)}</b><br>${esc(g.fix || '')}</small>`)).join('')
    // Recording a test and overriding both live on the Gates screen, which owns
    // those handlers. Sending people there beats duplicating the forms.
    + `<div style="margin-top:12px">${button('Go to the gates', 'go',
      { cls: 'btn-block btn-lg', icon: '🚧', data: { to: '#/gates' } })}</div>`
    + (owner
      ? '<p><small>You can record the test there, or override the gate — an override is kept with '
        + 'your name and your reason, and it shows in the daily digest.</small></p>'
      : '<p><small>Record the test there. Only the Owner can override a gate, so ask before '
        + 'planting.</small></p>'));
}

/**
 * The standing of every zone's gates, in one line when all is well.
 *
 * A blocked zone is worth interrupting for. A clear farm is worth one quiet
 * line, so the screen does not train people to scroll past it.
 */
function gateSummary(state, today) {
  const board = gateBoard(state, { today });
  if (!board.length) return '';
  const blocked = board.filter((r) => !r.ok);
  const overridden = board.filter((r) => r.ok && r.overridden.length);

  if (!blocked.length && !overridden.length) {
    return card(
      `<p class="gate-row ok"><b>✓ Gates clear</b> <small>All ${board.length} `
      + `${board.length === 1 ? 'zone has' : 'zones have'} passed soil and topsoil checks. </small>`
      + button('See the gates', 'go', { cls: 'btn-ghost btn-sm', data: { to: '#/gates' } })
      + '</p>',
      { tight: true },
    );
  }

  return card(
    cardHead('Gates', badge(blocked.length ? `${blocked.length} blocked` : 'on an override',
      blocked.length ? 'danger' : 'warn'))
    + '<ul class="list">'
    + [...blocked, ...overridden].slice(0, 5).map((r) => '<li><div class="grow">'
      + `<b>${esc(r.zone.name)}</b><small>${esc(r.blocking.length
        ? r.blocking.map((g) => g.name).join(', ')
        : `open on an override: ${r.overridden.map((g) => g.name).join(', ')}`)}</small></div>`
      + badge(r.blocking.length ? 'blocked' : 'override', r.blocking.length ? 'danger' : 'warn')
      + '</li>').join('')
    + '</ul>'
    + `<div style="margin-top:10px">${button('Open the gates screen', 'go',
      { cls: 'btn-block', icon: '🚧', data: { to: '#/gates' } })}</div>`,
  );
}

function openScoutSheet(ctx, cycleId) {
  const el = openSheet(`<h2>Scout ${esc(cycleLabel(ctx.state, cycleId))}</h2>`
    + '<p><small>Walk a diagonal across the bed and look at ten plants properly: undersides of the young '
    + 'leaves, the growing tip, the fruit, and the soil line. Ten looked at well beats fifty glanced at.</small></p>'
    + '<form data-act="save-scout">'
    + `<input type="hidden" name="cycleId" value="${esc(cycleId)}">`
    // FR-SCOUT-01. The counted pest and the number are what the thresholds
    // read; without them nothing can ever cross a line and the whole alert
    // ladder stays asleep. The written observation stays alongside (UX-09).
    + field('Which pest?', select('pestId', COUNTED_PESTS, '',
      { placeholder: 'None — the bed looked clean' }),
      'Only the ones with action thresholds are listed. Anything else goes in the notes.')
    + field('Count on the sticky trap', numberField('trapCount'),
      'Since the last check. Leave blank if there is no trap in this zone.')
    + field('Average per plant, from ten plants', numberField('perPlant'),
      'Count on ten plants and put the average here.')
    + field('What did you find?', input('finding', { placeholder: 'e.g. aphids on young leaves, 3 plants' }),
      'Leave empty if the bed looked clean.')
    + field('How many of the ten plants were affected?', select('affected',
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: `${n} of 10 (${n * 10}%)` })), 0))
    + field('Anything else', textarea('note', { placeholder: 'optional' }))
    + photoField('Photo of what you found', 'A picture of the leaf or the fruit is worth more than a description.')
    + '<button class="btn-block btn-lg" type="submit">Save scouting</button></form>'
    + note('info', 'Not sure what you are looking at?', 'Use the Clinic. It asks what you can see and narrows it down.'));
  bindPhoto(el);
}

async function saveScout(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('scout.record', {
    id: uid('sc'), cycleId: data.cycleId, finding: data.finding || '',
    pestId: data.pestId || null,
    // Blank is not zero. A trap nobody looked at must not read as a trap
    // holding nothing, or an empty form becomes evidence the house is clean.
    trapCount: data.trapCount === '' || data.trapCount == null ? null : Number(data.trapCount),
    perPlant: data.perPlant === '' || data.perPlant == null ? null : Number(data.perPlant),
    affectedPct: (Number(data.affected) || 0) * 10, note: data.note || '',
    photo: photoPayload(), date: isoDate(), enteredAt: new Date().toISOString(),
  });
  resetPhoto();
  closeSheet();
  toast('Scouting saved');
}

// --- Spray ----------------------------------------------------------------

function openSpraySheet(ctx, cycleId) {
  const usable = PRODUCTS.filter((p) => p.hazard !== 'avoid');
  const el = openSheet(`<h2>Log a spray</h2>`
    + `<p><small>${esc(cycleLabel(ctx.state, cycleId))}</small></p>`
    + '<form data-act="save-spray">'
    + `<input type="hidden" name="cycleId" value="${esc(cycleId)}">`
    + field('Product', `<select name="productId" data-act="spray-product-change">`
      + ['fungicide', 'insecticide', 'miticide', 'biological', 'nutrient'].map((kind) => {
        const items = usable.filter((p) => p.kind === kind);
        if (!items.length) return '';
        return `<optgroup label="${esc(kind)}">`
          + items.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') + '</optgroup>';
      }).join('') + '</select>')
    + field('Date', input('date', { type: 'date', value: isoDate() }))
    + field('What were you treating?', input('targetProblem', { placeholder: 'e.g. anthracnose' }))
    + field('Who sprayed?', input('operator', { value: ctx.user.name }))
    + '<div id="spray-hint"></div>'
    + field('Note', textarea('note', { placeholder: 'Rate used, weather, anything unusual' }))
    + photoField('Photo of the container',
      'The label carries the real waiting period and the real rate. A picture of it is the record '
      + 'that settles any question about what actually went on the crop.')
    + '<button class="btn-block btn-lg" type="submit">Save spray</button></form>');
  bindPhoto(el);
  const sel = document.querySelector('.sheet select[name=productId]');
  if (sel) updateSprayHints(ctx, sel);
}

function updateSprayHints(ctx, el) {
  const sheet = el.closest('.sheet');
  const hint = sheet.querySelector('#spray-hint');
  const product = PRODUCT_BY_ID[sheet.querySelector('select[name=productId]').value];
  const cycleId = sheet.querySelector('input[name=cycleId]').value;
  const cycle = ctx.state.cycles[cycleId];
  if (!hint || !product) return;

  const area = cycle ? (cycle.areaM2 || 0) : 0;
  const plan = knapsackPlan(area);
  const warnings = resistanceWarnings([...spraysForCycle(ctx.state, cycleId), { productId: product.id, date: isoDate() }]);

  hint.innerHTML =
    note(product.phiDays >= 7 ? 'warn' : 'info',
      `Waiting period: ${product.phiDays} day${product.phiDays === 1 ? '' : 's'} before picking`,
      `<small>Fruit from this bed will be safe to pick from <b>${isoDate(addDays(isoDate(), product.phiDays))}</b>. `
      + `Nobody goes back in without protective gear for ${product.reiHours} hours. `
      + `Resistance group ${esc(product.group)}.${product.note ? ' ' + esc(product.note) : ''}</small>`)
    + (product.bee === 'very high' || product.bee === 'high'
      ? note('warn', 'Hard on bees', '<small>Do not spray while flowers are open, or spray at dusk once the bees have gone in. '
        + 'Pepper sets more fruit when bees work it.</small>') : '')
    + warnings.map((w) => note('warn', 'Resistance warning',
      `<small>${esc(w.message)} Try instead: ${esc(w.alternatives.join(', '))}.</small>`)).join('')
    + (area ? note('info', 'Mixing', `<small>${esc(plan.text)} Check the label: it beats this estimate.</small>`) : '')
    + '<details><summary><small>Spray safety rules</small></summary><ul>'
    + SPRAY_RULES.map((r) => `<li><small>${esc(r)}</small></li>`).join('') + '</ul></details>';
}

async function saveSpray(ctx, form) {
  const data = readForm(form);
  const product = PRODUCT_BY_ID[data.productId];

  // FR-GATE-04 and FR-GATE-05. "Treatment by guesswork" is a named cause of
  // Season 1, so a spray needs a confirmed diagnosis behind it, and it must not
  // be the third from one resistance group.
  const allowed = canTreat(ctx.state, data.cycleId, { today: isoDate(), productId: data.productId });
  if (!allowed.ok) {
    closeSheet();
    openSheet(`<h2>${allowed.reason === 'rotation' ? 'Not this product' : 'Diagnose it first'}</h2>`
      + note('danger', allowed.why, `<small>${esc(allowed.fix)}</small>`)
      + (allowed.reason === 'rotation'
        ? '<p><small>Resistance does not wear off. A group used past its limit stops working on this '
          + 'farm for good, usually in the season that needs it most.</small></p>'
        : `<div style="margin-top:12px">${button('Check the plant now', 'go',
          { cls: 'btn-block btn-lg', icon: '🔍', data: { to: '#/diagnose' } })}</div>`));
    return;
  }

  await ctx.store.dispatch('spray.record', {
    diagnosisId: allowed.diagnosis ? allowed.diagnosis.id : null,
    id: uid('sp'), cycleId: data.cycleId, productId: data.productId,
    productName: product ? product.name : '', phiDays: product ? product.phiDays : 0,
    reiHours: product ? product.reiHours : 24, targetProblem: data.targetProblem || '',
    operator: data.operator || '', note: data.note || '', date: data.date || isoDate(),
    photo: photoPayload(), at: new Date().toISOString(), enteredAt: new Date().toISOString(),
  });
  resetPhoto();
  closeSheet();
  toast(product && product.phiDays > 0
    ? `Logged. No picking on that bed until ${isoDate(addDays(data.date || isoDate(), product.phiDays))}`
    : 'Spray logged');
}
