// Manager screens: the numbers, the plan, the people, the store and the money.

import {
  badge, bar, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, note, openSheet, readForm, select, spark, stat, table, textarea, toast,
} from './kit.js';
import {
  activeCycles, assignableRoles, can, canEditPerson, canRemovePerson, closedCycles,
  costsBetween, cycleLabel, inputsList, inputUsage, openReports, openTasks,
  payrollBetween, revenueBetween, ROLES, ROLE_LIST, DEFAULT_SETTINGS,
} from '../store.js';
import {
  bootstrapFarm, checkServer, getAuth, getStatus, inviteMember, isConnected,
  joinLink, listMembers, newFarmId, revokeMember, signOutDevice, statusLine, syncNow,
} from '../sync.js';
import { getMeta, setMeta } from '../db.js';
import {
  bestSowingWindow, calibrate, cashflowForecast, forecastAccuracy, harvestForecast,
  labourForecast, revenueForecast, stockForecast, breakEven,
} from '../domain/predict.js';
import { riskForecast, RISK_DRIVER_TEXT } from '../domain/diagnose.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { harvestClearance, PRODUCTS } from '../domain/safety.js';
import { PRICE_SEASONALITY, seasonOn, SEASON_LABELS, climateFor } from '../domain/climate.js';
import { spraysForCycle } from '../store.js';
import { addDays, daysBetween, friendlyDate, isoDate, kg, naira, round, sum, uid } from '../util.js';
import { hashPin } from './shell.js';
import { exportBundle, importBundle, storageReport, clearEvents } from '../db.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthRange(today = isoDate()) {
  const from = today.slice(0, 8) + '01';
  return { from, to: today };
}

function calibrationFor(state) { return calibrate(closedCycles(state)); }

// --- Dashboard ------------------------------------------------------------

export const dashboardView = {
  perm: 'viewReports',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();
    const { from, to } = monthRange(today);
    const cycles = activeCycles(state);
    const cal = calibrationFor(state);

    const forecasts = cycles.map((c) => ({
      cycle: c,
      forecast: harvestForecast(c, { today, calibration: cal }),
    }));
    const revenues = forecasts.map(({ cycle, forecast }) => revenueForecast(forecast, {
      basePriceNgnPerKg: state.settings.prices[cycle.cropId],
      seasonality: state.settings.seasonality,
      gradeOutPct: state.settings.gradeOutPct,
    }));

    const pickedThisMonth = sum(state.harvests.filter((h) => h.date >= from && h.date <= to), (h) => h.kg);
    const soldThisMonth = revenueBetween(state, from, to);
    const costsThisMonth = sum(costsBetween(state, from, to), (c) => c.amount);
    const expectedRemaining = sum(revenues, (r) => r.remainingRevenue);

    // Last 14 days of picking, for the sparkline.
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = isoDate(addDays(today, -i));
      days.push({ value: sum(state.harvests.filter((h) => h.date === d), (h) => h.kg), label: `${d}` });
    }

    const alerts = buildAlerts(ctx, cycles, cal);

    let out = card(
      `<div class="row between"><div><h1 style="margin:0">${esc(state.settings.farmName)}</h1>`
      + `<small>${esc(friendlyDate(today))} · ${esc(seasonOn(today).label)}</small></div>`
      + badge(`${cycles.length} beds`, cycles.length ? 'ok' : '') + '</div>',
      { tight: true },
    );

    // Sales and costs are withheld from roles without money authority, so their
    // totals here would be zeroes that read as fact. Show the crop instead.
    const showsMoney = can(ctx.user, 'manageMoney');

    out += card(
      '<div class="grid">'
      + stat('Picked this month', kg(pickedThisMonth, 0), `${state.harvests.filter((h) => h.date >= from).length} pickings`)
      + (showsMoney
        ? stat('Sold this month', naira(soldThisMonth, true), 'recorded sales')
        : stat('Beds working', String(cycles.length), 'crop cycles on the ground'))
      + (showsMoney
        ? stat('Spent this month', naira(costsThisMonth, true), 'inputs and labour')
        : stat('Still to pick', kg(sum(forecasts, (f) => f.forecast.remainingKg), 0), 'across all beds'))
      + (showsMoney
        ? stat('Still on the plants', naira(expectedRemaining, true), 'forecast value')
        : stat('Open jobs', String(openTasks(state).length), 'assigned and due'))
      + '</div>'
      + '<h3 style="margin-top:16px">Picking, last 14 days</h3>'
      + spark(days, { caption: `Total ${kg(sum(days, (d) => d.value), 0)} over the fortnight.` }),
    );

    if (alerts.length) {
      out += card(
        cardHead('Needs you', badge(`${alerts.length}`, 'warn'))
        + '<ul class="list">' + alerts.map((a) => `<li><div class="grow"><b>${esc(a.title)}</b>`
          + `<small>${esc(a.detail)}</small></div>`
          + (a.to ? `<a class="btn btn-sm btn-ghost" href="${esc(a.to)}">Open</a>` : '')
          + '</li>').join('') + '</ul>',
      );
    }

    if (forecasts.length) {
      out += card(
        cardHead('Beds')
        + table(
          [{ label: 'Bed' }, { label: 'Stage' }, { label: 'Picked', num: true }, { label: 'To come', num: true }]
            .concat(showsMoney ? [{ label: 'Worth', num: true }] : [{ label: 'First pick' }]),
          forecasts.map(({ cycle, forecast }, i) => [
            cycleLabel(state, cycle.id),
            forecast.stage.name,
            kg(cycle.harvestedKg || 0, 0),
            kg(forecast.remainingKg, 0),
            showsMoney ? naira(revenues[i].remainingRevenue, true)
              : friendlyDate(forecast.milestones.firstHarvest),
          ]),
        ),
      );

      const nextWeek = sum(revenues, (r) => {
        const w = r.weeks.find((x) => !x.past);
        return w ? w.kg : 0;
      });
      if (nextWeek > 0) {
        const lab = labourForecast(nextWeek, { kgPerPersonHour: state.settings.kgPerPersonHour });
        out += card(cardHead('Picking next week') + note('info', lab.text,
          `<small>About ${kg(nextWeek, 0)} expected across all beds.</small>`));
      }
    }

    out += card(
      cardHead('Go to')
      + '<div class="grid">'
      + button('Farm check', 'go', { cls: 'btn-ghost', icon: '🔎', data: { to: '#/audit' } })
      + button('Planting planner', 'go', { cls: 'btn-ghost', icon: '📅', data: { to: '#/plan' } })
      + button('Reports', 'go', { cls: 'btn-ghost', icon: '📄', data: { to: '#/reports' } })
      + button('Money', 'go', { cls: 'btn-ghost', icon: '💰', data: { to: '#/money' } })
      + button('People', 'go', { cls: 'btn-ghost', icon: '👥', data: { to: '#/people' } })
      + '</div>',
    );

    return out;
  },
};

function buildAlerts(ctx, cycles, cal) {
  const { state } = ctx;
  const today = isoDate();
  const alerts = [];

  for (const c of cycles) {
    const clearance = harvestClearance(spraysForCycle(state, c.id));
    if (!clearance.safe) {
      alerts.push({
        title: `${cycleLabel(state, c.id)}: no picking until ${clearance.clearOn}`,
        detail: clearance.reason, to: `#/field/cycle?id=${c.id}`,
      });
    }
  }

  const reports = openReports(state);
  if (reports.length) {
    alerts.push({
      title: `${reports.length} problem report${reports.length === 1 ? '' : 's'} waiting`,
      detail: reports.slice(0, 2).map((r) => r.note).join(' · '), to: '#/clinic',
    });
  }

  const overdue = Object.values(state.tasks).filter((t) => t.status === 'open' && t.dueDate && t.dueDate < today);
  if (overdue.length) {
    alerts.push({
      title: `${overdue.length} job${overdue.length === 1 ? '' : 's'} overdue`,
      detail: overdue.slice(0, 2).map((t) => t.title).join(' · '), to: '#/today',
    });
  }

  const usage = inputUsage(state);
  for (const item of inputsList(state)) {
    const f = stockForecast(item, usage);
    if (f.status === 'critical' || f.status === 'low') {
      alerts.push({ title: `${item.name} running out`, detail: f.text, to: '#/store' });
    }
  }

  const stages = cycles.map((c) => ({
    cropId: c.cropId, id: c.id, label: cycleLabel(state, c.id),
    stage: stageAt(c.cropId, daysBetween(c.transplantDate, today)).id,
  }));
  const risks = riskForecast(stages, today).filter((r) => r.risk >= 0.7);
  for (const r of risks.slice(0, 2)) {
    alerts.push({
      title: `High risk: ${r.problem.name}`,
      detail: `${Math.round(r.risk * 100)}% pressure from ${RISK_DRIVER_TEXT[r.driver] || r.driver}. `
        + `Walk ${[...new Set(r.beds)].slice(0, 3).join(', ')} today.`,
      to: `#/guide/item?id=${r.problem.id}`,
    });
  }

  return alerts;
}

// --- Planting planner -----------------------------------------------------

let planState = { cropId: 'habanero', plants: 1000 };

export const planView = {
  perm: 'viewReports',
  render(ctx) {
    const { state } = ctx;
    const crop = getCrop(planState.cropId);
    const result = bestSowingWindow(planState.cropId, {
      plants: planState.plants,
      basePriceNgnPerKg: state.settings.prices[planState.cropId],
      seasonality: state.settings.seasonality,
      calibration: calibrationFor(state),
      year: new Date().getFullYear() + 1,
    });

    const top = result.ranked.slice(0, 6);
    const byMonth = MONTH_NAMES.map((name, i) => {
      const rows = result.candidates.filter((c) => Number(c.sowDate.slice(5, 7)) === i + 1);
      return { label: `${name}: ${rows.length ? naira(Math.round(sum(rows, (r) => r.revenuePerPlant) / rows.length)) : '—'} per plant`,
        value: rows.length ? sum(rows, (r) => r.revenuePerPlant) / rows.length : 0 };
    });

    return card(
      cardHead('When to plant')
      + '<p><small>Pepper prices in the South-South swing by nearly two to one across the year. Dry-season '
      + 'irrigated supply from the north lands from November and softens the market; it thins out from June '
      + 'and prices run hot through the rains. Planting to hit that window is worth more than squeezing '
      + 'another crate out of the bed.</small></p>'
      + '<div class="row wrap">' + CROP_LIST.map((c) => `<button class="chip ${planState.cropId === c.id ? 'on' : ''}" `
        + `data-act="plan-crop" data-id="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join(' ') + '</div>'
      + `<div class="field" style="margin-top:12px"><label>How many plants?</label>`
      + `<input name="plants" type="number" min="10" step="10" value="${planState.plants}" data-act="plan-plants"></div>`,
      { tight: true },
    )
    + card(
      note('ok', 'Best window', `<small>${esc(result.advice)}</small>`)
      + '<div class="grid">'
      + stat('Sow', friendlyDate(result.best.sowDate), `transplant ${friendlyDate(result.best.transplantDate)}`)
      + stat('First pick', friendlyDate(result.best.firstHarvest), `peak ${friendlyDate(result.best.peakHarvest)}`)
      + stat('Per plant', naira(result.best.revenuePerPlant), 'risk-adjusted')
      + stat('Versus worst date', `+${result.upliftPct}%`, 'same crop, same work')
      + '</div>',
    )
    + card(
      cardHead('Average value by sowing month')
      + spark(byMonth, { caption: 'Taller is better. Height is risk-adjusted naira per plant for a crop sown that month.' })
      + table([{ label: 'Sow' }, { label: 'Transplant' }, { label: 'Peak picking' }, { label: 'Per plant', num: true }, { label: 'Disease risk' }],
        top.map((c) => [
          friendlyDate(c.sowDate), friendlyDate(c.transplantDate), friendlyDate(c.peakHarvest),
          naira(c.revenuePerPlant), c.diseasePressure > 0.65 ? 'high' : c.diseasePressure > 0.45 ? 'medium' : 'low',
        ])),
    )
    + card(
      cardHead('Before you trust this')
      + '<ul>' + result.assumptions.map((a) => `<li><small>${esc(a)}</small></li>`).join('') + '</ul>'
      + note('warn', 'The dry-season catch',
        '<small>The best-paying windows usually need a nursery or a young crop through the dry months. '
        + 'Without reliable irrigation those dates are fiction. If you cannot water, take the best window '
        + 'that keeps the whole crop inside the rains and accept the lower price.</small>'),
    );
  },

  actions: {
    'plan-crop': (ctx, el) => { planState.cropId = el.dataset.id; ctx.refresh(); },
    'plan-plants': () => {},
  },

  mounted(ctx) {
    const box = document.querySelector('input[name=plants]');
    if (!box) return;
    box.onchange = () => { planState.plants = Math.max(10, Number(box.value) || 1000); ctx.refresh(); };
  },
};

// --- Reports --------------------------------------------------------------

export const reportsView = {
  perm: 'viewReports',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();
    const from = isoDate(addDays(today, -90));
    const cal = calibrationFor(state);
    const cycles = Object.values(state.cycles);

    const yieldRows = cycles.map((c) => {
      const f = harvestForecast(c, { today, calibration: cal });
      const picked = c.harvestedKg || 0;
      return [
        cycleLabel(state, c.id),
        getCrop(c.cropId).name,
        c.status,
        kg(picked, 0),
        kg(f.totalKg, 0),
        c.plants ? `${round(picked / c.plants, 2)} kg` : '—',
      ];
    });

    const pay = payrollBetween(state, from, today);
    const costs = costsBetween(state, from, today);
    const costByCategory = new Map();
    for (const c of costs) costByCategory.set(c.category, (costByCategory.get(c.category) || 0) + c.amount);
    const revenue = revenueBetween(state, from, today);
    const totalCost = sum(costs, (c) => c.amount);

    const accuracy = forecastAccuracy(closedCycles(state));
    const cash = cashflowForecast(activeCycles(state), costs, {
      today, calibration: cal, seasonality: state.settings.seasonality,
      basePriceNgnPerKg: null, openingBalance: 0,
    });

    const workByType = new Map();
    for (const w of state.workLogs.filter((x) => x.date >= from)) {
      workByType.set(w.activity, (workByType.get(w.activity) || 0) + (Number(w.hours) || 0));
    }

    // An agronomist may read reports but is not sent sales, costs or wages. Their
    // totals would come out as zeroes, which reads as "the farm sold nothing"
    // rather than "you were not shown this".
    const showsMoney = can(ctx.user, 'manageMoney');

    return `<div class="print-head"><b>${esc(state.settings.farmName)}</b> — farm report, ${esc(friendlyDate(today))}</div>`
      + card(
        cardHead('Last 90 days', button('Print or save as PDF', 'print', { cls: 'btn-sm btn-ghost no-print' }))
        + '<div class="grid">'
        + (showsMoney
          ? stat('Sold', naira(revenue, true), 'recorded sales')
            + stat('Spent', naira(totalCost, true), 'labour and inputs')
            + stat('Margin', naira(revenue - totalCost, true),
              revenue > 0 ? `${Math.round(((revenue - totalCost) / revenue) * 100)}% of sales` : '—')
          : stat('Beds', String(cycles.length), 'cycles on record')
            + stat('Pickings', String(state.harvests.filter((h) => h.date >= from).length), 'in the period'))
        + stat('Picked', kg(sum(state.harvests.filter((h) => h.date >= from), (h) => h.kg), 0), 'all beds')
        + '</div>'
        + (showsMoney ? '' : note('info', 'The books are not on this phone',
          '<small>Sales, costs and wages go only to the CEO and the farm manager. Your screens '
          + 'show the crop and the work.</small>')),
      )
      + card(cardHead('Yield by bed')
        + table([{ label: 'Bed' }, { label: 'Crop' }, { label: 'Status' }, { label: 'Picked', num: true },
          { label: 'Forecast', num: true }, { label: 'Per plant', num: true }], yieldRows))
      + (showsMoney
        ? card(cardHead('Where the money went')
          + (costByCategory.size
            ? table([{ label: 'Category' }, { label: 'Amount', num: true }, { label: 'Share', num: true }],
              [...costByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amt]) => [
                cat, naira(amt), totalCost ? `${Math.round((amt / totalCost) * 100)}%` : '—']))
            : '<p><small>No costs recorded in this period.</small></p>'))
        : '')
      + card(cardHead('Labour')
        + (pay.length
          ? table([{ label: 'Person' }, { label: 'Days', num: true }, { label: 'Hours', num: true }]
              .concat(showsMoney ? [{ label: 'Pay', num: true }] : []),
            pay.map((r) => [r.person.name, r.days, r.hours]
              .concat(showsMoney ? [naira(r.pay)] : [])))
          : '<p><small>No attendance recorded in this period.</small></p>')
        + (workByType.size
          ? '<h3 style="margin-top:14px">Hours by job</h3>' + table([{ label: 'Job' }, { label: 'Hours', num: true }],
            [...workByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v, 1)]))
          : ''))
      + (showsMoney ? card(cardHead('Money coming in and going out')
        + (cash.rows.length
          ? table([{ label: 'Month' }, { label: 'Expected in', num: true }, { label: 'Out', num: true }, { label: 'Running', num: true }],
            cash.rows.map((r) => [r.month, naira(r.income, true), naira(r.cost, true), naira(r.balance, true)]))
            + (cash.tightest && cash.tightest.balance < 0
              ? note('warn', `Tightest month: ${cash.tightest.month}`,
                `<small>Running balance dips to ${esc(naira(cash.tightest.balance))}. Line up the cash before then, `
                + 'or move a planting so the picking lands earlier.</small>') : '')
          : '<p><small>Start a cycle to see the forecast.</small></p>')) : '')
      + card(cardHead('How good is the forecast?')
        + `<p>${esc(accuracy.note)}</p>`
        + (accuracy.rows.length
          ? table([{ label: 'Cycle' }, { label: 'Predicted', num: true }, { label: 'Actual', num: true }, { label: 'Out by', num: true }],
            accuracy.rows.map((r) => [cycleLabel(state, r.cycleId), kg(r.predicted, 0), kg(r.actual, 0), `${r.errorPct}%`]))
          : '')
        + '<p><small>Close a cycle when it finishes. That is what teaches this app what your land really does, '
        + 'and every closed cycle makes the next forecast tighter.</small></p>');
  },
};

// --- People ---------------------------------------------------------------

export const peopleView = {
  perm: 'managePeople',
  render(ctx) {
    const people = ROLE_LIST.flatMap((role) =>
      Object.values(ctx.state.people).filter((p) => p.role === role.id));
    const canAppoint = assignableRoles(ctx.user);
    const isOwner = can(ctx.user, 'manageOwners');

    return card(
      cardHead('People', button('Add someone', 'open-person', { cls: 'btn-sm' }))
      + '<ul class="list">' + people.map((p) => {
        const role = ROLES[p.role];
        const editable = canEditPerson(ctx.user, p);
        return `<li><div class="grow"><b>${esc(p.name)}</b>`
          + `<small>${esc(role?.name || p.role)} · ${p.dailyRate ? esc(naira(p.dailyRate)) + ' a day' : 'no rate set'}`
          + `${p.active === false ? ' · removed' : ''}${p.id === ctx.user.id ? ' · you' : ''}</small></div>`
          + (p.role === 'ceo' ? badge('owner', 'ok') : '')
          + (editable
            ? button('Edit', 'open-person', { cls: 'btn-sm btn-ghost', data: { id: p.id } })
            : badge('locked'))
          + '</li>';
      }).join('') + '</ul>'
      + (canAppoint.length
        ? `<p style="margin:10px 0 0"><small>You can appoint: `
          + `${esc(canAppoint.map((r) => ROLES[r].name).join(', '))}.</small></p>`
        : ''),
    )
    + card(cardHead('Who can do what')
      + '<ul class="list">' + ROLE_LIST.map((r) => `<li><div class="grow"><b>${esc(r.name)}</b>`
        + `<small>${esc(r.blurb)}</small></div></li>`).join('') + '</ul>'
      + (isOwner
        ? note('info', 'You are the CEO',
          '<small>Only you can appoint or change a farm manager, and only you can set up the sync '
          + 'link that keeps every phone in step. A manager can take on supervisors, agronomists and '
          + 'farm hands, but cannot create another manager or touch your account.</small>')
        : note('info', 'What you can do here',
          '<small>You can take on the people below your own level. Appointing or changing a manager, '
          + 'and setting up sync, is the CEO\'s to do.</small>'))
      + note('warn', 'About the PIN',
        '<small>The PIN keeps people out of each other\'s records on a shared farm phone. It is a '
        + 'workplace control, not security: anyone who can open the browser\'s storage on that '
        + 'handset can read what is on it. Keep the money screens on your own phone.</small>'));
  },

  actions: {
    'open-person': (ctx, el) => openPersonSheet(ctx, el.dataset.id),
    'save-person': (ctx, form) => savePerson(ctx, form),
    'invite-copy': async (ctx, el) => {
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); }
      catch { toast('Could not copy. Select it and copy by hand.', true); }
    },
    'invite-share': async (ctx, el) => {
      const text = `${el.dataset.name}, here is your login for the DouValue farm app: ${el.dataset.text}`;
      if (navigator.share) {
        try { await navigator.share({ title: 'DouValue farm app', text }); return; } catch { /* cancelled */ }
      }
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Link copied'); }
      catch { toast('Could not share on this phone', true); }
    },
    'invite-done': () => closeSheet(),

    'revoke-devices': async (ctx, el) => {
      const target = ctx.state.people[el.dataset.id];
      const ok = await confirmSheet('Sign out their phones?',
        `${target.name} will be signed out everywhere and will need a fresh invite to get back in. `
        + 'Use this the moment a phone goes missing.', 'Sign them out');
      if (!ok) return;
      try {
        await revokeMember(target.id, { devicesOnly: true });
        closeSheet();
        toast(`${target.name} has been signed out of every phone`);
      } catch (err) { toast(err.message || 'Could not do that', true); }
    },

    'deactivate-person': async (ctx, el) => {
      const target = ctx.state.people[el.dataset.id];
      const allowed = canRemovePerson(ctx.user, target, ctx.state);
      if (!allowed.ok) { toast(allowed.why, true); return; }
      const ok = await confirmSheet('Remove this person?',
        `${target.name} will not be able to sign in and will drop off the payroll. `
        + 'Everything they recorded stays in the farm\'s records.', 'Remove');
      if (!ok) return;
      await ctx.store.dispatch('person.deactivate', { id: target.id });
      closeSheet();
      toast('Removed');
    },
  },
};

function openPersonSheet(ctx, id) {
  const p = id ? ctx.state.people[id] : null;
  if (p && !canEditPerson(ctx.user, p)) {
    toast('That account is above your level. The CEO handles it.', true);
    return;
  }

  const allowed = assignableRoles(ctx.user);
  // Editing someone keeps their current role on the list even if you could not
  // have granted it, so a CEO editing their own account does not lose the role.
  const options = ROLE_LIST
    .filter((r) => allowed.includes(r.id) || (p && p.role === r.id))
    .map((r) => ({ value: r.id, label: `${r.name} — ${r.blurb}` }));

  if (!options.length) { toast('You cannot create accounts.', true); return; }

  const removable = p ? canRemovePerson(ctx.user, p, ctx.state) : { ok: false };

  openSheet(`<h2>${p ? 'Edit' : 'Add'} person</h2>`
    + '<form data-act="save-person">'
    + (p ? `<input type="hidden" name="id" value="${esc(p.id)}">` : '')
    + field('Name', input('name', { value: p?.name || '', required: true }))
    + field('Role', select('role', options, p?.role || options[options.length - 1].value))
    + field('Phone', input('phone', { value: p?.phone || '', type: 'tel', placeholder: '080...' }))
    + field('Daily rate', input('dailyRate', { type: 'number', min: 0, step: '100',
      value: p?.dailyRate ?? ctx.state.settings.defaultDailyWage }))
    + (!p && isConnected()
      ? note('info', 'They choose their own PIN',
        '<small>Saving this creates their account on the farm server and gives you a link and a '
        + 'one-time password to send them. They set their own PIN when they join, and you never '
        + 'see it.</small>')
      : field(p ? 'New 4-digit PIN (leave empty to keep)' : '4-digit PIN',
        input('pin', { inputmode: 'numeric', placeholder: '0000' }),
        p ? 'Set a new one only if they have forgotten it.' : 'Give this to them privately.'))
    + '<button class="btn-block btn-lg" type="submit">Save</button>'
    + '</form>'
    + (p && isConnected() && removable.ok
      ? button('Sign out their phones', 'revoke-devices', { cls: 'btn-ghost btn-block', data: { id: p.id } })
      : '')
    + (removable.ok
      ? button('Remove from the farm', 'deactivate-person', { cls: 'btn-ghost btn-block', data: { id: p.id } })
      : p && p.id !== ctx.user.id ? note('warn', 'Cannot be removed', `<small>${esc(removable.why)}</small>`) : ''));
}

async function savePerson(ctx, form) {
  const data = readForm(form);
  if (!data.name || !String(data.name).trim()) { toast('Name is needed', true); return; }

  const existing = data.id ? ctx.state.people[data.id] : null;
  if (existing && !canEditPerson(ctx.user, existing)) { toast('You cannot change that account.', true); return; }

  const keepingOwnRole = existing && existing.role === data.role;
  if (!keepingOwnRole && !assignableRoles(ctx.user).includes(data.role)) {
    toast('You cannot give out that role.', true);
    return;
  }

  const name = String(data.name).trim();

  // On a connected farm the server owns accounts: creating one produces a
  // single-use invite to hand over, and no PIN is set here at all.
  if (!existing && isConnected()) {
    try {
      toast('Creating the account…');
      const invite = await inviteMember({ name, role: data.role });
      await ctx.store.dispatch('person.upsert', {
        id: invite.memberId, name, role: data.role, phone: data.phone || '',
        dailyRate: Number(data.dailyRate) || 0, active: true,
      });
      closeSheet();
      showInvite(ctx, invite);
      return;
    } catch (err) {
      toast(err.message || 'Could not create that account', true);
      return;
    }
  }

  const payload = {
    id: data.id || uid('person'),
    name, role: data.role, phone: data.phone || '',
    dailyRate: Number(data.dailyRate) || 0, active: true,
  };
  if (data.pin) {
    if (!/^\d{4}$/.test(String(data.pin))) { toast('PIN must be 4 digits', true); return; }
    payload.pinHash = await hashPin(data.pin);
  } else if (existing) {
    payload.pinHash = existing.pinHash;
  } else {
    toast('Give them a 4-digit PIN so they can sign in', true);
    return;
  }

  await ctx.store.dispatch('person.upsert', payload);
  closeSheet();
  toast(existing ? 'Saved' : `${payload.name} can now sign in as ${ROLES[payload.role].name}`);
}

/** The one-time code and password, shown once, to be handed to that person. */
function showInvite(ctx, invite) {
  const link = invite.link || joinLink(invite.joinCode);
  openSheet(`<h2>Account ready for ${esc(invite.name)}</h2>`
    + `<p><small>${esc(ROLES[invite.role]?.name || invite.role)}. Send them these two things. `
    + 'The code and the password each work once, and expire in two weeks.</small></p>'

    + '<h3>1. The link</h3>'
    + `<div class="code-box">${esc(link)}</div>`
    + `<div class="row wrap">${button('Copy link', 'invite-copy', { data: { text: link } })}`
    + `${button('Send link', 'invite-share', { cls: 'btn-ghost', data: { text: link, name: invite.name } })}</div>`

    + '<h3 style="margin-top:16px">2. The password</h3>'
    + `<div class="code-box" style="font-size:1.5rem;text-align:center;letter-spacing:.18em">${esc(invite.joinPassword)}</div>`
    + `<div class="row wrap">${button('Copy password', 'invite-copy', { data: { text: invite.joinPassword } })}</div>`

    + note('warn', 'Send the password separately if you can',
      '<small>The link says which account; the password proves it is them. Sending them down two '
      + 'different channels, say the link by WhatsApp and the password by voice call, means one '
      + 'forwarded message is not enough for a stranger to get in.</small>')
    + note('info', 'If they cannot open the link',
      `<small>They can open the app, press <b>Join with a code</b>, and type the code `
      + `<b>${esc(invite.joinCode)}</b> with that password.</small>`)
    + button('Done', 'invite-done', { cls: 'btn-block btn-lg' }));
}

// --- Store (inputs) -------------------------------------------------------

export const storeView = {
  perm: 'logInputs',
  render(ctx) {
    const { state } = ctx;
    const items = inputsList(state);
    const usage = inputUsage(state);

    return card(
      cardHead('Store', button('Add item', 'open-input', { cls: 'btn-sm' }))
      + (items.length
        ? '<ul class="list">' + items.map((item) => {
          const f = stockForecast(item, usage);
          return `<li><div class="grow"><b>${esc(item.name)}</b>`
            + `<small>${esc(round(item.qty, 2))} ${esc(item.unit)} in stock — ${esc(f.text)}</small></div>`
            + badge(f.status === 'critical' ? 'order now' : f.status === 'low' ? 'low' : 'ok',
              f.status === 'critical' ? 'danger' : f.status === 'low' ? 'warn' : 'ok')
            + button('Move', 'open-move', { cls: 'btn-sm btn-ghost', data: { id: item.id } })
            + '</li>';
        }).join('') + '</ul>'
        : empty('📦', 'Store is empty', 'Add seed, fertiliser and chemicals so the app can warn you before they run out.')),
    )
    + card(cardHead('Recent movements')
      + (state.stockMoves.length
        ? table([{ label: 'Date' }, { label: 'Item' }, { label: 'In or out' }, { label: 'Qty', num: true }],
          [...state.stockMoves].reverse().slice(0, 12).map((m) => [
            (m.date || m.at || '').slice(0, 10),
            state.inputs[m.itemId]?.name || m.itemId,
            m.direction === 'in' ? 'received' : 'issued',
            round(m.qty, 2)]))
        : '<p><small>Nothing moved yet.</small></p>'));
  },

  actions: {
    'open-input': (ctx) => openInputSheet(ctx),
    'save-input': (ctx, form) => saveInput(ctx, form),
    'open-move': (ctx, el) => openMoveSheet(ctx, el.dataset.id),
    'save-move': (ctx, form) => saveMove(ctx, form),
  },
};

function openInputSheet(ctx) {
  openSheet('<h2>Add a store item</h2>'
    + '<form data-act="save-input">'
    + field('Name', `<input name="name" list="product-list" required placeholder="e.g. Mancozeb 80% WP">`
      + `<datalist id="product-list">${PRODUCTS.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`)
    + field('Kind', select('kind', [
      { value: 'chemical', label: 'Pesticide or fungicide' },
      { value: 'fertiliser', label: 'Fertiliser or lime' },
      { value: 'seed', label: 'Seed' },
      { value: 'consumable', label: 'Crates, twine, fuel, other' },
    ], 'chemical'))
    + field('Unit', select('unit', ['kg', 'litre', 'sachet', 'bag', 'piece', 'gram'], 'kg'))
    + field('How much is in stock now?', input('qty', { type: 'number', min: 0, step: '0.1', value: 0 }))
    + field('What one unit costs', input('unitCost', { type: 'number', min: 0, step: '10' }))
    + '<button class="btn-block btn-lg" type="submit">Save item</button></form>');
}

async function saveInput(ctx, form) {
  const data = readForm(form);
  if (!data.name) { toast('Name is needed', true); return; }
  await ctx.store.dispatch('input.upsert', {
    id: uid('item'), name: data.name, kind: data.kind, unit: data.unit,
    qty: Number(data.qty) || 0, unitCost: Number(data.unitCost) || 0,
  });
  closeSheet();
  toast('Added to the store');
}

function openMoveSheet(ctx, itemId) {
  const item = ctx.state.inputs[itemId];
  openSheet(`<h2>${esc(item.name)}</h2><p><small>${esc(round(item.qty, 2))} ${esc(item.unit)} in stock</small></p>`
    + '<form data-act="save-move">'
    + `<input type="hidden" name="itemId" value="${esc(itemId)}">`
    + field('What happened?', select('direction', [
      { value: 'out', label: 'Issued to the field' },
      { value: 'in', label: 'Received into the store' },
    ], 'out'))
    + field(`How much (${item.unit})`, input('qty', { type: 'number', min: 0, step: '0.1', required: true }))
    + field('Bed, if it went to one', select('cycleId',
      activeCycles(ctx.state).map((c) => ({ value: c.id, label: cycleLabel(ctx.state, c.id) })), '', { placeholder: 'General' }))
    + field('Cost, if you are buying', input('amount', { type: 'number', min: 0, step: '100', placeholder: 'optional' }))
    + '<button class="btn-block btn-lg" type="submit">Save</button></form>');
}

async function saveMove(ctx, form) {
  const data = readForm(form);
  const qty = Number(data.qty) || 0;
  if (qty <= 0) { toast('Enter a quantity', true); return; }
  const events = [{
    type: data.direction === 'in' ? 'input.receive' : 'input.issue',
    payload: { id: uid('mv'), itemId: data.itemId, qty, cycleId: data.cycleId || null, date: isoDate() },
  }];
  if (data.direction === 'in' && Number(data.amount) > 0) {
    events.push({ type: 'expense.record', payload: {
      id: uid('exp'), amount: Number(data.amount), category: 'inputs',
      note: ctx.state.inputs[data.itemId]?.name || 'store purchase', date: isoDate() } });
  }
  await ctx.store.dispatchMany(events);
  closeSheet();
  toast('Store updated');
}

// --- Money ----------------------------------------------------------------

export const moneyView = {
  perm: 'manageMoney',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();
    const from = isoDate(addDays(today, -60));
    const sales = state.sales.filter((s) => s.date >= from);
    const expenses = state.expenses.filter((e) => e.date >= from);
    const totalSales = sum(sales, (s) => s.amount);
    const totalExpenses = sum(expenses, (e) => e.amount);
    const labourCost = sum(payrollBetween(state, from, today), (r) => r.pay);
    const cal = calibrationFor(state);
    const expectedKg = sum(activeCycles(state).map((c) => harvestForecast(c, { today, calibration: cal })), (f) => f.totalKg);
    const be = breakEven(totalExpenses + labourCost, Math.round(state.settings.prices.habanero * 0.8), expectedKg);

    return card(
      cardHead('Money, last 60 days')
      + '<div class="grid">'
      + stat('Sales', naira(totalSales, true), `${sales.length} recorded`)
      + stat('Inputs', naira(totalExpenses, true), `${expenses.length} entries`)
      + stat('Labour', naira(labourCost, true), 'from attendance')
      + stat('Net', naira(totalSales - totalExpenses - labourCost, true), '')
      + '</div>'
      + '<div class="row wrap" style="margin-top:12px">'
      + button('Record a sale', 'open-sale', { icon: '💵' })
      + button('Record a cost', 'open-expense', { cls: 'btn-ghost', icon: '🧾' })
      + '</div>',
      { tight: true },
    )
    + card(cardHead('Break-even') + note(be.verdict === 'comfortable' ? 'ok' : be.verdict === 'loss at this price' ? 'danger' : 'warn',
      be.verdict, `<small>${esc(be.text)}</small>`))
    + card(cardHead('Sales')
      + (sales.length
        ? table([{ label: 'Date' }, { label: 'Buyer' }, { label: 'Kg', num: true }, { label: 'Amount', num: true }, { label: 'Per kg', num: true }],
          [...sales].reverse().map((s) => [s.date, s.buyer || '—', round(s.kg, 1), naira(s.amount),
            s.kg ? naira(s.amount / s.kg) : '—']))
        : '<p><small>No sales recorded yet.</small></p>'))
    + card(cardHead('Costs')
      + (expenses.length
        ? table([{ label: 'Date' }, { label: 'Category' }, { label: 'Note' }, { label: 'Amount', num: true }],
          [...expenses].reverse().map((e) => [e.date, e.category, e.note || '—', naira(e.amount)]))
        : '<p><small>No costs recorded yet.</small></p>'));
  },

  actions: {
    'open-sale': (ctx) => openSaleSheet(ctx),
    'save-sale': (ctx, form) => saveSale(ctx, form),
    'open-expense': (ctx) => openExpenseSheet(ctx),
    'save-expense': (ctx, form) => saveExpense(ctx, form),
  },
};

function openSaleSheet(ctx) {
  openSheet('<h2>Record a sale</h2>'
    + '<form data-act="save-sale">'
    + field('Crop', select('cropId', CROP_LIST.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` })), 'habanero'))
    + field('Kilograms sold', input('kg', { type: 'number', min: 0, step: '0.1', required: true }))
    + field('Total amount received', input('amount', { type: 'number', min: 0, step: '100', required: true }))
    + field('Buyer', input('buyer', { placeholder: 'e.g. Mile 3 market trader' }))
    + field('Date', input('date', { type: 'date', value: isoDate() }))
    + '<button class="btn-block btn-lg" type="submit">Save sale</button></form>');
}

async function saveSale(ctx, form) {
  const data = readForm(form);
  if (!Number(data.amount)) { toast('Enter the amount', true); return; }
  await ctx.store.dispatch('sale.record', {
    id: uid('sale'), cropId: data.cropId, kg: Number(data.kg) || 0,
    amount: Number(data.amount), buyer: data.buyer || '', date: data.date || isoDate(),
  });
  closeSheet();
  toast('Sale recorded');
}

function openExpenseSheet(ctx) {
  openSheet('<h2>Record a cost</h2>'
    + '<form data-act="save-expense">'
    + field('Category', select('category', [
      { value: 'inputs', label: 'Seed, fertiliser, chemicals' },
      { value: 'labour', label: 'Casual labour paid directly' },
      { value: 'transport', label: 'Transport' },
      { value: 'land', label: 'Land and rent' },
      { value: 'equipment', label: 'Tools and equipment' },
      { value: 'water', label: 'Water and fuel' },
      { value: 'other', label: 'Other' },
    ], 'inputs'))
    + field('Amount', input('amount', { type: 'number', min: 0, step: '100', required: true }))
    + field('What for?', input('note', { placeholder: 'e.g. 2 bags NPK 15-15-15' }))
    + field('Date', input('date', { type: 'date', value: isoDate() }))
    + '<button class="btn-block btn-lg" type="submit">Save cost</button></form>');
}

async function saveExpense(ctx, form) {
  const data = readForm(form);
  if (!Number(data.amount)) { toast('Enter the amount', true); return; }
  await ctx.store.dispatch('expense.record', {
    id: uid('exp'), category: data.category, amount: Number(data.amount),
    note: data.note || '', date: data.date || isoDate(),
  });
  closeSheet();
  toast('Cost recorded');
}

// --- Settings -------------------------------------------------------------

export const settingsView = {
  perm: 'settings',
  render(ctx) {
    const s = ctx.state.settings;
    const seasonality = s.seasonality || PRICE_SEASONALITY;

    return card(
      cardHead('Farm')
      + '<form data-act="save-settings">'
      + field('Farm name', input('farmName', { value: s.farmName }))
      + field('Location', input('location', { value: s.location }))
      + field('Weight of one crate (kg)', input('crateKg', { type: 'number', min: 1, step: '0.5', value: s.crateKg }),
        'Used to turn crates counted in the field into kilograms in the books.')
      + field('Grade-out allowance (%)', input('gradeOutPct', { type: 'number', min: 0, max: 60, value: s.gradeOutPct }),
        'How much of a picking is lost to rot, rejects and shrinkage before it is sold.')
      + field('Picking rate (kg per person per hour)', input('kgPerPersonHour', { type: 'number', min: 1, value: s.kgPerPersonHour }))
      + field('Standard daily wage', input('defaultDailyWage', { type: 'number', min: 0, step: '100', value: s.defaultDailyWage }))
      + '<h3>Farm-gate price per kg</h3>'
      + CROP_LIST.map((c) => field(`${c.emoji} ${c.name} (${c.localName})`,
        input(`price_${c.id}`, { type: 'number', min: 0, step: '50', value: s.prices[c.id] }))).join('')
      + '<button class="btn-block btn-lg" type="submit">Save settings</button>'
      + '</form>',
    )
    + card(cardHead('Seasonal price index')
      + '<p><small>What a kilo fetches in each month, as a multiple of the yearly average. The planner uses '
      + 'these. Replace them with your own figures once you have a season of sales: nothing in this app '
      + 'improves the planting decision more.</small></p>'
      + table([{ label: 'Month' }, { label: 'Index', num: true }, { label: 'Meaning' }],
        MONTH_NAMES.map((name, i) => {
          const v = seasonality[i + 1];
          return [name, v.toFixed(2), v >= 1.25 ? 'strong market' : v >= 1 ? 'average' : 'soft market'];
        }))
      + `<p><small>Climate for reference: ${MONTH_NAMES.map((n, i) =>
        `${n} ${climateFor(i + 1).rain}mm`).join(' · ')}</small></p>`)
    + syncCard(ctx)
    + card(cardHead('Backup and sharing')
      + '<p><small>Everything lives on this phone. Export regularly, and merge the hands\' phones into '
      + 'yours when they come back to the office. Merging never overwrites: the two logs are joined and '
      + 'anything already held is skipped.</small></p>'
      + '<div class="row wrap">'
      + button('Export a backup file', 'export-data', { icon: '⬇️' })
      + button('Share the log', 'share-data', { cls: 'btn-ghost', icon: '📤' })
      + button('Merge a file in', 'import-data', { cls: 'btn-ghost', icon: '⬆️' })
      + '</div>'
      + '<input type="file" accept="application/json,.json" id="import-file" style="display:none">'
      + '<div id="storage-report" style="margin-top:12px"></div>')
    + card(cardHead('Danger zone')
      + button('Erase everything on this phone', 'wipe-data', { cls: 'btn-danger btn-block' })
      + '<p style="margin-top:8px"><small>Export first. This cannot be undone.</small></p>');
  },

  actions: {
    'sync-setup': (ctx) => openSyncSetup(ctx),
    'sync-save': (ctx, form) => saveSyncSetup(ctx, form),
    'sync-run': async () => {
      toast('Syncing…');
      const r = await syncNow();
      toast(r.ok ? `Up to date. Sent ${r.sent}, received ${r.received}.` : r.reason, !r.ok);
    },
    'sync-signout': async (ctx) => {
      const ok = await confirmSheet('Sign this phone out?',
        'This phone stops sending and receiving, and whoever uses it next needs a fresh invite. '
        + 'Records already on the server stay there.', 'Sign out');
      if (!ok) return;
      await signOutDevice();
      await setMeta('devicePin', null);
      sessionStorage.removeItem('douvalue.user');
      ctx.store.setUser(null);
      closeSheet();
      toast('This phone is signed out');
    },

    'save-settings': async (ctx, form) => {
      const data = readForm(form);
      const prices = {};
      for (const c of CROP_LIST) prices[c.id] = Number(data[`price_${c.id}`]) || ctx.state.settings.prices[c.id];
      await ctx.store.dispatch('settings.update', {
        farmName: data.farmName || DEFAULT_SETTINGS.farmName,
        location: data.location,
        crateKg: Number(data.crateKg) || 12,
        gradeOutPct: Number(data.gradeOutPct) || 0,
        kgPerPersonHour: Number(data.kgPerPersonHour) || 12,
        defaultDailyWage: Number(data.defaultDailyWage) || 0,
        prices,
      });
      toast('Settings saved');
    },

    'export-data': async () => {
      const bundle = await exportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `douvalue-farm-${isoDate()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`Exported ${bundle.eventCount} records`);
    },

    'share-data': async () => {
      const bundle = await exportBundle();
      const file = new File([JSON.stringify(bundle)], `douvalue-farm-${isoDate()}.json`, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'DouValue farm log' });
      } else {
        toast('This phone cannot share files directly. Use Export instead.', true);
      }
    },

    'import-data': () => {
      const el = document.getElementById('import-file');
      if (el) el.click();
    },

    'wipe-data': async (ctx) => {
      const ok = await confirmSheet('Erase everything?',
        'Every record on this phone will be deleted: people, beds, harvests, money, all of it. '
        + 'If you have not exported a backup, it is gone for good.', 'Erase it all');
      if (!ok) return;
      await clearEvents();
      sessionStorage.removeItem('douvalue.user');
      location.reload();
    },
  },

  async mounted(ctx) {
    const fileEl = document.getElementById('import-file');
    if (fileEl) {
      fileEl.onchange = async () => {
        const file = fileEl.files && fileEl.files[0];
        if (!file) return;
        try {
          const bundle = JSON.parse(await file.text());
          const result = await importBundle(bundle);
          await ctx.store.reload();
          toast(`Merged: ${result.added} new records, ${result.skipped} already held`);
        } catch (err) {
          toast(err.message || 'That file could not be read', true);
        }
      };
    }
    const report = document.getElementById('storage-report');
    if (report) {
      const s = await storageReport();
      const mb = (s.bytes / 1048576).toFixed(2);
      report.innerHTML = `<small>${s.events} records, about ${mb} MB on this phone`
        + (s.quota ? `, of roughly ${(s.quota / 1048576).toFixed(0)} MB available` : '') + '.</small>';
    }
  },
};

// --- Sync -----------------------------------------------------------------

function syncCard(ctx) {
  const owner = can(ctx.user, 'manageSync');
  const status = getStatus();
  const linked = getAuth();
  const line = statusLine(status);

  if (!status.configured) {
    return card(
      cardHead('Sync', badge('off', 'warn'))
      + note('warn', 'This phone is on its own',
        '<small>Records are safe here, but nobody else can see them and nobody has their own '
        + 'account yet. Connect the farm to a server and each person gets a login of their own, '
        + 'with the server deciding what their role is allowed to see.</small>')
      + (owner
        ? '<p><small>You need a server first. It is free and takes about five minutes: open '
          + '<b>dash.deno.com</b>, make a new Playground, paste in the file at '
          + '<b>douvalue/server/deno-sync.ts</b>, press Save &amp; Deploy, and copy the address.</small></p>'
          + button('Connect the farm', 'sync-setup', { cls: 'btn-block btn-lg', icon: '🔗' })
        : note('info', 'Ask the CEO',
          '<small>Only the CEO can connect the farm. Until then, back this phone up from '
          + 'Backup and sharing below.</small>')),
    );
  }

  const pending = status.pending || 0;
  return card(
    cardHead('Sync', badge(status.state === 'idle' && !pending ? 'in step' : status.state,
      line.tone === 'ok' ? 'ok' : line.tone === 'danger' ? 'danger' : 'warn'))
    + note(line.tone === 'ok' ? 'ok' : line.tone === 'danger' ? 'danger' : 'warn', line.text,
      `<small>${status.lastSyncAt
        ? `Last exchange at ${esc(new Date(status.lastSyncAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }))}.`
        : 'No exchange yet.'}`
      + `${status.serverEvents != null ? ` The farm holds ${status.serverEvents} records.` : ''}</small>`)
    + '<div class="grid">'
    + stat('Waiting to send', String(pending), pending ? 'goes automatically' : 'nothing queued')
    + stat('Signed in as', linked ? linked.name : '—', linked ? ROLES[linked.role]?.name || linked.role : '')
    + '</div>'
    + `<p style="margin-top:12px"><small>Server: ${esc(linked ? linked.url : '—')}<br>`
    + `Farm: ${esc(linked ? linked.farmId : '—')}</small></p>`
    + (status.withheld
      ? note('info', 'Some records are not sent to this phone',
        `<small>${status.withheld} record${status.withheld === 1 ? '' : 's'} were held back because `
        + 'your role does not cover them. That is the server doing its job, not a fault.</small>')
      : '')
    + '<div class="row wrap">'
    + button('Sync now', 'sync-run', { icon: '🔄' })
    + (can(ctx.user, 'managePeople') ? button('Add a person', 'go', { cls: 'btn-ghost', icon: '👤', data: { to: '#/people' } }) : '')
    + button('Sign this phone out', 'sync-signout', { cls: 'btn-quiet btn-sm' })
    + '</div>',
  );
}

function openSyncSetup(ctx) {
  openSheet('<h2>Connect the farm</h2>'
    + '<p><small>This creates the farm on your server and makes you its first account. '
    + 'From then on you create everyone else here, and each of them signs in as themselves.</small></p>'
    + '<form data-act="sync-save">'
    + field('Server address', input('url', { required: true, placeholder: 'https://your-farm.deno.dev' }),
      'The address your server gave you. Use https.')
    + field('Your PIN', input('password', { type: 'password', required: true, inputmode: 'numeric', placeholder: '0000' }),
      'At least 4 digits. This is what you type to sign in on this phone.')
    + field('Type it again', input('password2', { type: 'password', inputmode: 'numeric', placeholder: '0000' }))
    + '<button class="btn-block btn-lg" type="submit">Create the farm</button>'
    + '</form>'
    + note('info', 'What the server protects',
      '<small>Each person gets their own account and the server decides what their role may see. '
      + 'A farm hand\'s phone is never sent wages or sales at all, so there is nothing on it to '
      + 'read. Losing a phone means revoking that one device, not changing everyone\'s password.</small>'));
}

async function saveSyncSetup(ctx, form) {
  const data = readForm(form);
  const url = String(data.url || '').trim().replace(/\/+$/, '');
  const password = String(data.password || '');
  if (!/^https?:\/\//.test(url)) { toast('The address must start with http or https', true); return; }
  if (!/^\d{4,12}$/.test(password)) { toast('Your PIN must be at least 4 digits', true); return; }
  if (password !== String(data.password2 || '')) { toast('The two PINs do not match', true); return; }

  toast('Checking the server…');
  const check = await checkServer(url);
  if (!check.ok) { toast(check.error, true); return; }

  try {
    const result = await bootstrapFarm({
      url, farmId: newFarmId(), farmName: ctx.state.settings.farmName,
      name: ctx.user.name, password, memberId: ctx.user.id,
    });
    await setMeta('devicePin', await hashPin(password, result.member.id));
    const sync = await syncNow();
    closeSheet();
    await ctx.store.reload();
    toast(sync.ok
      ? `Farm connected. ${sync.sent} records sent up.`
      : 'Farm connected. The first exchange will retry on its own.', !sync.ok);
  } catch (err) {
    toast(err.message || 'Could not create the farm', true);
  }
}
