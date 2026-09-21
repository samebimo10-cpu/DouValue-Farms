// The Farm Doctor screen — requirements 6.14.
//
// Three jobs on one screen, because they are the three questions that used to
// be answered by phoning somebody:
//
//   Plan check   "we want to spray X on GH-01 tomorrow" -> every rule, in
//                order, with the one that says no and what to use instead.
//   Dose         "how much goes in the knapsack" -> 16 L, 500 L, 1,000 L.
//   Lime         "the pH came back 5.3" -> a route and kilograms, or a date.
//
// The screen never approves anything. FR-DOC-08 is explicit: the Farm Doctor
// does not clear a gate, confirm its own diagnosis or approve its own plan. So
// a plan that passes every check ends on a line naming the person who has to
// approve it, and a button that records the check — not one that sprays.

import {
  badge, button, card, cardHead, empty, esc, field, input, note, readForm, select, table, toast,
} from './kit.js';
import { rulesReady, rules } from '../domain/rules.js';
import { activeByKey, catalogue } from '../domain/catalogue.js';
import { dosePlan, limePlan, TANKS, TEXTURES } from '../domain/calc.js';
import { checkPlan, cropWeek, ppeFor } from '../domain/doctor.js';
import { KNAPSACK_L } from '../domain/safety.js';
import { activeCycles, cycleLabel } from '../store.js';
import { confirmPpe, ppeGrid } from './ppe.js';
import { isoDate, uid } from '../util.js';

const TABS = [
  { id: 'plan', label: 'Check a plan', icon: '🧪' },
  { id: 'dose', label: 'Dose', icon: '⚖️' },
  { id: 'lime', label: 'Lime', icon: '🪨' },
];

let tab = 'plan';
let planForm = null;
let planResult = null;
let doseForm = null;
let limeResult = null;
let limeForm = null;

function defaultPlan(ctx) {
  const cycles = activeCycles(ctx.state);
  return {
    cycleId: cycles.length ? cycles[0].id : '',
    activeKey: '',
    targetPest: '',
    at: `${isoDate()}T17:00`,
    tankLitres: KNAPSACK_L,
    loads: 1,
    mixWith: '',
    flowering: false,
    openFlowers: false,
    wind: false,
    leavesWet: false,
  };
}

export const doctorView = {
  perm: 'diagnose',

  enter(ctx) {
    if (!planForm) planForm = defaultPlan(ctx);
  },

  render(ctx) {
    if (!rulesReady()) {
      return card(empty('📕', 'The rules file has not loaded',
        'The Farm Doctor reads rules/douvalue_rules_rev5_1.json and will not guess without it. '
        + 'Open the app once with a connection; after that it works offline.'));
    }

    const head = card(
      cardHead('Farm Doctor', badge(rules().meta.version))
      + `<p><small>${esc(rules().farm_doctor.role)}</small></p>`
      + '<div class="row wrap">' + TABS.map((t) =>
        `<button class="chip ${tab === t.id ? 'on' : ''}" data-act="doc-tab" data-id="${esc(t.id)}">`
        + `${t.icon} ${esc(t.label)}</button>`).join(' ') + '</div>'
      // FR-DOC-11: one entry point, so nobody has to decide whether their
      // question is a diagnosis question or a farm question.
      + `<div style="margin-top:10px">${button('Diagnose a sick plant', 'go',
        { cls: 'btn-block btn-ghost', icon: '🔍', data: { to: '#/diagnose' } })}</div>`
      + `<div style="margin-top:8px">${button('Ask the farm adviser', 'go',
        { cls: 'btn-block btn-quiet', icon: '🧠', data: { to: '#/adviser' } })}</div>`,
      { tight: true },
    );

    if (tab === 'dose') return head + doseTab(ctx);
    if (tab === 'lime') return head + limeTab(ctx);
    return head + planTab(ctx);
  },

  actions: {
    'doc-tab': (ctx, el) => { tab = el.dataset.id; ctx.refresh(); },
    'doc-plan-check': (ctx, form) => runPlanCheck(ctx, form),
    'doc-plan-swap': (ctx, el) => { planForm.activeKey = el.dataset.key; runPlanCheck(ctx, null); },
    'doc-plan-reset': (ctx) => { planForm = defaultPlan(ctx); planResult = null; ctx.refresh(); },
    'doc-plan-ppe': (ctx, el) => showPpe(ctx, el.dataset.key),
    'doc-plan-record': (ctx) => recordPlan(ctx),
    'doc-dose': (ctx, form) => { doseForm = readForm(form); ctx.refresh(); },
    'doc-lime': (ctx, form) => runLime(ctx, form),
  },
};

// --- Plan check -----------------------------------------------------------

function activeOptions() {
  const groups = { insecticide: [], fungicide: [], other: [] };
  for (const a of catalogue()) groups[a.kindOfProduct].push(a);
  return Object.entries(groups).filter(([, list]) => list.length).map(([kind, list]) =>
    `<optgroup label="${esc(kind)}">` + list.map((a) =>
      `<option value="${esc(a.key)}" ${planForm.activeKey === a.key ? 'selected' : ''}>`
      + `${esc(a.ai)} — ${esc(a.groupText)}${a.scheduleRate ? '' : ' (needs a label rate)'}</option>`).join('')
    + '</optgroup>').join('');
}

function planTab(ctx) {
  const cycles = activeCycles(ctx.state);
  const week = planForm.cycleId ? cropWeek(ctx.state, planForm.cycleId, planForm.at.slice(0, 10)) : null;

  const form = card(
    cardHead('Check a treatment plan')
    + '<p><small>Every rule the schedule sets, in order. Nothing is sprayed from this screen — '
    + 'it says whether the plan would be allowed, and what to use instead if it would not.</small></p>'
    + '<form data-act="doc-plan-check">'
    + field('Which bed?', select('cycleId', cycles.map((c) =>
      ({ value: c.id, label: cycleLabel(ctx.state, c.id) })), planForm.cycleId, { placeholder: 'Pick a bed' }))
    + (week && week.week != null
      ? note(week.week >= 10 ? 'warn' : 'info',
        `Week ${week.week}, day ${week.day}`,
        `<small>${week.week >= 10
          ? 'From Week 10 it is organics only: neem oil, garlic-chilli, Copper Hydroxide (SR-08).'
          : `The Week 10 organics rule starts on day 71, which is ${71 - week.day} day${71 - week.day === 1 ? '' : 's'} away.`}</small>`)
      : '')
    + field('Active ingredient', `<select name="activeKey">`
      + '<option value="">Pick an active ingredient</option>' + activeOptions() + '</select>',
      'Chosen by active ingredient, not by brand. The group fills in from the catalogue (C-18).')
    + field('What are you treating?', input('targetPest',
      { value: planForm.targetPest, placeholder: 'e.g. thrips' }))
    + field('When?', input('at', { type: 'datetime-local', value: planForm.at }),
      'Spray window is 4-7 PM, and 5-7 PM once the crop is flowering.')
    + '<div class="grid grid-2">'
    + field('Tank size (L)', input('tankLitres', { type: 'number', min: 1, step: '1', value: planForm.tankLitres }))
    + field('How many loads?', input('loads', { type: 'number', min: 1, step: '1', value: planForm.loads }))
    + '</div>'
    + field('Anything else in the tank?', input('mixWith',
      { value: planForm.mixWith, placeholder: 'e.g. Calcium Nitrate, Borax' }),
      'Separate with commas. The mixing rules are checked against whatever is listed.')
    + '<div class="ticks">'
    + checkbox('flowering', 'The crop is flowering', 'Closes the window until 5 PM (SR-02).')
    + checkbox('openFlowers', 'There are open flowers now', 'Never sprayed onto open flowers.')
    + checkbox('wind', 'Wind through the nets')
    + checkbox('leavesWet', 'The leaves are wet', 'Mancozeb needs 2 dry hours to bind (SR-03).')
    + '</div>'
    + '<button class="btn-block btn-lg" type="submit">Check this plan</button></form>',
  );

  return form + (planResult ? planVerdict(ctx, planResult) : '');
}

function checkbox(name, label, hint = '') {
  return `<label class="tick ${planForm[name] ? 'on' : ''}">`
    + `<input type="checkbox" name="${esc(name)}" ${planForm[name] ? 'checked' : ''} `
    + 'style="width:24px;height:24px;margin-right:10px">'
    + `<span class="txt"><b>${esc(label)}</b>${hint ? `<span class="pid">${esc(hint)}</span>` : ''}</span></label>`;
}

const MARK = { pass: '✓', fail: '✕', warn: '!', 'n/a': '–' };
const ROW_CLASS = { pass: 'pass', fail: 'fail', warn: 'warn', 'n/a': 'na' };

function planVerdict(ctx, verdict) {
  const rows = '<ul class="check-list">' + verdict.checks.map((c) =>
    `<li class="check-row ${ROW_CLASS[c.state]}"><span class="mark">${MARK[c.state]}</span>`
    + `<span class="body"><b>${esc(c.name)}</b><small>${esc(c.why)}</small>`
    + (c.fix ? `<small><b>${esc(c.fix)}</b></small>` : '')
    + `<small class="ref">${esc(c.ref)}</small></span></li>`).join('') + '</ul>';

  let out = card(
    cardHead(verdict.ok ? 'This plan passes' : 'This plan is blocked',
      badge(verdict.ok ? 'clear' : `${verdict.failed.length} blocked`, verdict.ok ? 'ok' : 'danger'))
    + (verdict.ok
      ? note('ok', `${verdict.active.ai} on ${cycleLabel(ctx.state, verdict.plan.cycleId)}`,
        `<small>No picking until ${esc(verdict.safeToPickFrom)}. `
        + `Nobody back in unprotected before ${esc(verdict.reentryAfter)}.</small>`)
      : note('danger', verdict.firstFailure.name, `<small>${esc(verdict.firstFailure.why)}</small>`))
    + rows,
  );

  if (verdict.ok && verdict.dose.ok) {
    out += card(
      cardHead('Mix it')
      + doseTable(dosePlan(verdict.dose.raw))
      + note('info', 'Before you start',
        `<small>${esc(verdict.ppe.rule)}</small>`)
      + `<div style="margin-top:10px">${button('Show the gear', 'doc-plan-ppe',
        { cls: 'btn-block', icon: '🧤', data: { key: verdict.active.key } })}</div>`,
    );

    // FR-DOC-08 and FR-DOC-10: the doctor's output is recorded and handed to a
    // person. It never approves itself.
    out += card(
      note('warn', 'Who approves this', `<small>${esc(verdict.approval)}</small>`)
      + `<div style="margin-top:10px">${button('Record this check', 'doc-plan-record',
        { cls: 'btn-block btn-lg', icon: '📋' })}</div>`
      + '<p style="margin:8px 0 0"><small>Saves what the Farm Doctor read and what it found, '
      + 'so the approval and the spray both point back at it.</small></p>',
      { tight: true },
    );
  }

  if (!verdict.ok) {
    out += card(
      cardHead('Next valid option')
      + ((verdict.alternatives || []).length
        ? '<ul class="list">' + verdict.alternatives.map((alt) =>
          `<li><div class="grow"><b>${esc(alt.active.ai)}</b><small>${esc(alt.why)}</small>`
          + (alt.dose.ok ? `<small>${esc(alt.dose.tanks[0].text)}</small>` : '')
          + '</div>'
          + button('Use this', 'doc-plan-swap', { cls: 'btn-sm', data: { key: alt.active.key } })
          + '</li>').join('') + '</ul>'
        : note('danger', 'Nothing in the catalogue passes every rule today',
          '<small>That is an answer, not a gap. Move the spray to a day inside the window, '
          + 'clear the diagnosis, or buy in the product the rotation is asking for. The Farm Doctor '
          + 'will not offer something that breaks a rule.</small>')),
    );
  }

  return out;
}

async function runPlanCheck(ctx, form) {
  if (form) {
    const data = readForm(form);
    planForm = {
      ...planForm,
      ...data,
      tankLitres: Number(data.tankLitres) || KNAPSACK_L,
      loads: Number(data.loads) || 1,
    };
  }
  if (!planForm.cycleId) { toast('Pick a bed first', true); return; }
  if (!planForm.activeKey) { toast('Pick an active ingredient', true); return; }

  planResult = checkPlan(ctx.state, {
    ...planForm,
    mixWith: String(planForm.mixWith || '').split(',').map((s) => s.trim()).filter(Boolean),
  }, { today: isoDate() });

  ctx.refresh();
  window.scrollTo(0, document.body.scrollHeight);
}

async function showPpe(ctx, key) {
  const kit = ppeFor({ active: activeByKey(key) });
  const worn = await confirmPpe(kit);
  if (worn) toast('Gear confirmed');
}

async function recordPlan(ctx) {
  if (!planResult) return;
  // FR-DOC-10: what it read, what it found, and who has to confirm it.
  await ctx.store.dispatch('doctor.record', {
    id: uid('doc'),
    kind: 'treatment-plan',
    cycleId: planResult.plan.cycleId,
    activeKey: planResult.active.key,
    activeName: planResult.active.ai,
    group: planResult.active.groupText,
    at: planResult.plan.at,
    week: planResult.week.week,
    ok: planResult.ok,
    checks: planResult.checks.map((c) => ({ id: c.id, state: c.state, why: c.why, ref: c.ref })),
    diagnosisId: (planResult.checks.find((c) => c.id === 'gate3') || {}).diagnosis?.id || null,
    dose: planResult.dose.ok ? planResult.dose.raw : null,
    safeToPickFrom: planResult.safeToPickFrom,
    rulesVersion: rules().meta.version,
    needsApproval: planResult.approval,
    date: isoDate(),
  });
  toast('Recorded. The Farm Manager approves it.');
}

// --- Dose calculator ------------------------------------------------------

function doseTab(ctx) {
  const chosen = doseForm?.activeKey ? activeByKey(doseForm.activeKey) : null;
  const entered = String(doseForm?.rate || '').trim();
  const rate = entered || chosen?.scheduleRate || '';
  const plan = rate ? dosePlan(rate) : null;

  return card(
    cardHead('Dose calculator')
    + '<p><small>From the schedule rate on file, or from a rate you read off the label in front of '
    + `you. Answers come back per ${KNAPSACK_L} L knapsack and per 500 L and 1,000 L tank.</small></p>`
    + '<form data-act="doc-dose">'
    + field('Active ingredient', `<select name="activeKey"><option value="">Pick one</option>`
      + catalogue().map((a) => `<option value="${esc(a.key)}" ${doseForm?.activeKey === a.key ? 'selected' : ''}>`
        + `${esc(a.ai)}${a.scheduleRate ? ` — ${esc(a.scheduleRate)}` : ' — no rate on file'}</option>`).join('')
      + '</select>')
    + field('Or a label rate', input('rate', { value: entered, placeholder: 'e.g. 2 ml/L, or 40 g / 16 L' }),
      'What the container says. An entered label rate wins over the schedule rate for that formulation.')
    + '<button class="btn-block btn-lg" type="submit">Work it out</button></form>',
  ) + (plan ? doseResult(chosen, plan, entered) : '');
}

function doseResult(active, plan, entered) {
  if (!plan.ok) {
    return card(note('danger', 'No dose can be given', `<small>${esc(plan.why)} ${esc(plan.fix)}</small>`));
  }

  const ppe = active ? ppeFor({ active }) : null;

  return card(
    cardHead(active ? active.ai : 'Entered rate',
      badge(entered ? 'from the label' : 'schedule rate', entered ? 'warn' : ''))
    + `<p><small>Rate on file: <b>${esc(plan.raw)}</b>`
    + (plan.formulation ? ` · formulation ${esc(plan.formulation)}` : '')
    + (plan.timing ? ` · ${esc(plan.timing)}` : '')
    + '</small></p>'
    + doseTable(plan)
    + (plan.variants.length
      ? note('info', 'Other rates on the same line',
        `<small>${plan.variants.map(esc).join(' · ')}</small>`) : '')
    + (plan.components.some((c) => c.unit === 'g' || c.unit === 'kg')
      ? note('warn', 'Weigh it', '<small>Powders are weighed on a scale. A cap of powder is not a '
        + 'measurement, and the difference between 2 g/L and 3 g/L is a scorched crop.</small>') : '')
    + note('info', 'The label beats this screen',
      '<small>These are the rates on file for this farm. If the container in your hand says something '
      + 'different, the container wins — and the Farm Manager enters it as a label so the app agrees '
      + 'with it next time.</small>'),
  ) + (ppe ? card(cardHead('Wear this') + ppeGrid(ppe)
    + (ppe.after ? note('info', 'When you finish', `<small>${esc(ppe.after)}</small>`) : '')) : '');
}

function doseTable(plan) {
  return table(
    [{ label: 'Tank' }, { label: 'How much goes in', num: false }, { label: 'Practical measure' }],
    dosePlan(plan.raw, { tanks: TANKS }).tanks.map((t) => [
      t.label,
      t.components.map((c) => c.text).join(' + '),
      t.components.map((c) => c.capText || (c.weigh ? 'weigh it' : '')).filter(Boolean).join(' + ') || '—',
    ]),
  );
}

// --- Lime calculator ------------------------------------------------------

function limeTab(ctx) {
  return card(
    cardHead('Lime calculator')
    + '<p><small>Three pH readings from the same block, the soil texture and the area. Out comes '
    + 'Route A or Route B, the product, and the kilograms — or, between 5.2 and 5.49, a date instead '
    + 'of a dose.</small></p>'
    + '<form data-act="doc-lime">'
    + '<div class="grid grid-2">'
    + field('Point 1', input('ph1', { type: 'number', step: '0.01', min: 3, max: 9,
      value: limeForm?.ph1, required: true, inputmode: 'decimal' }))
    + field('Point 2', input('ph2', { type: 'number', step: '0.01', min: 3, max: 9,
      value: limeForm?.ph2, required: true, inputmode: 'decimal' }))
    + '</div>'
    + '<div class="grid grid-2">'
    + field('Point 3', input('ph3', { type: 'number', step: '0.01', min: 3, max: 9,
      value: limeForm?.ph3, required: true, inputmode: 'decimal' }))
    + field('Bed area (m²)', input('areaM2', { type: 'number', step: '1', min: 1,
      value: limeForm?.areaM2 || '', required: true, inputmode: 'numeric' }))
    + '</div>'
    + field('Soil texture', select('texture', TEXTURES.map((t) =>
      ({ value: t.id, label: `${t.name} — ${t.hint}` })), limeForm?.texture || 'sandy_loam'))
    + field('Zone', select('zoneType', [
      { value: 'greenhouse', label: 'Greenhouse — bed area only' },
      { value: 'field', label: 'Open field — full cropped area' },
    ], limeForm?.zoneType || 'greenhouse'))
    + `<label class="tick ${limeForm?.solarised ? 'on' : ''}">`
    + `<input type="checkbox" name="solarised" ${limeForm?.solarised ? 'checked' : ''} `
    + 'style="width:24px;height:24px;margin-right:10px">'
    + '<span class="txt"><b>Already under solarisation plastic</b>'
    + '<span class="pid">Route B and hydrated lime. Unticked means Route A, at T-35 to T-28.</span></span></label>'
    + field('Transplant date, if it is set', input('transplantDate',
      { type: 'date', value: limeForm?.transplantDate || '' }))
    + field('Date the block went on hold, if it did', input('holdSince',
      { type: 'date', value: limeForm?.holdSince || '' }),
      'Only for a block already held between 5.2 and 5.49. Leaves the 10-day clock where it is.')
    + '<button class="btn-block btn-lg" type="submit">Work out the lime</button></form>',
  ) + (limeResult ? limeOut(limeResult) : '');
}

function runLime(ctx, form) {
  limeForm = readForm(form);
  limeResult = limePlan({
    readings: [limeForm.ph1, limeForm.ph2, limeForm.ph3],
    texture: limeForm.texture,
    areaM2: Number(limeForm.areaM2) || 0,
    zoneType: limeForm.zoneType,
    solarised: !!limeForm.solarised,
    transplantDate: limeForm.transplantDate || null,
    holdSince: limeForm.holdSince || null,
    limeDate: isoDate(),
    today: isoDate(),
  });
  ctx.refresh();
  window.scrollTo(0, document.body.scrollHeight);
}

function limeOut(result) {
  if (!result.ok) {
    return card(note('danger', result.why, `<small>${esc(result.fix)}</small>`));
  }

  const tone = result.band === 'in-range' ? 'ok' : result.band === 'hold' ? 'warn' : 'danger';

  let out = card(
    cardHead('What to do',
      badge(result.band === 'hold' ? 'held' : result.band === 'in-range' ? 'clear' : `Route ${result.route || '—'}`,
        tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'danger'))
    + note(tone, result.headline, `<small>${esc(result.detail || '')}</small>`)
    + `<p><small>Three points: ${result.reading.points.join(', ')} — average `
    + `<b>${result.reading.mean}</b>, spread ${result.reading.spread}. `
    + `Gate is ${result.gateMin}–${result.gateMax}.</small></p>`
    + (result.kgText
      ? `<div class="dose-big">${esc(result.kgText)}</div>`
        + `<p><small>of ${esc(result.product)} over ${result.areaM2} m² `
        + `(${result.ratePer100Low}–${result.ratePer100High} kg per 100 m²). ${esc(result.treatArea)}</small></p>`
      : '')
    + (result.approval ? note('warn', 'Not the app\'s decision', `<small>${esc(result.approval)}</small>`) : '')
    + (result.blocksTransplant
      ? note('danger', 'Transplant stays blocked',
        '<small>The pH gate does not open until a corrected three-point reading of 5.5 or better is '
        + 'on file, with the meter photo (FR-GATE-01).</small>') : ''),
  );

  if (result.steps?.length) {
    out += card(cardHead('Steps') + '<ol>' + result.steps.map((s) => `<li>${esc(s)}</li>`).join('') + '</ol>');
  }

  if (result.locks?.length) {
    out += card(
      cardHead('Timing locks')
      + '<ul class="list">' + result.locks.map((l) =>
        `<li><div class="grow"><b>${esc(l.id.replace('-', ' '))}</b><small>${esc(l.text)}</small></div>`
        + badge(`not before ${l.notBefore}`, l.clashesWithTransplant ? 'danger' : '')
        + '</li>').join('') + '</ul>'
      + (result.locks.some((l) => l.clashesWithTransplant)
        ? note('danger', 'This clashes with the transplant date',
          '<small>One of these locks runs past the day the seedlings are due to go in. Move the '
          + 'transplant, or the lock is going to be broken quietly on the day.</small>') : ''),
    );
  }

  if (result.warnings?.length) {
    out += card(cardHead('Worth knowing')
      + result.warnings.map((w) => note('warn', '', `<small>${esc(w)}</small>`)).join(''));
  }

  if (result.route) {
    // SR-06 writes the briefing requirement against hydrated lime, which is
    // Route B. The gear covers both routes because agricultural lime raises
    // the same dust, and being stricter than the rule is always allowed.
    const kit = ppeFor({ task: 'lime' });
    out += card(
      cardHead(`Handling ${result.route === 'B' ? 'hydrated lime' : 'agricultural lime'}`)
      + ppeGrid(kit)
      + (result.route === 'B'
        ? note('danger', 'Team briefing first', `<small>${esc(kit.briefingText)}</small>`)
        : note('warn', 'Keep it out of eyes and lungs',
          '<small>Agricultural lime is a dust, and a bag of it empties into the wind. '
          + 'Same gear as hydrated lime.</small>')),
    );
  }

  out += card(
    cardHead('Do not buy these')
    + `<ul>${result.doNotBuy.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
    + note('info', 'If there is no lime to be had', `<small>${esc(result.fallback)}</small>`),
  );

  return out;
}
