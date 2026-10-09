// Manager screens: the numbers, the plan, the people, the store and the money.

import {
  badge, bar, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, link, note, openSheet, readForm, select, spark, stat, table, textarea, toast,
} from './kit.js';
import {
  activeCycles, assignableRoles, can, canEditPerson, canRemovePerson, closedCycles,
  costsBetween, cycleLabel, inputsList, inputUsage, openReports, openTasks,
  attendanceBetween, dailyRateFor, hasRates, labourByZone, revenueBetween, ROLES, ROLE_LIST, DEFAULT_SETTINGS,
} from '../store.js';
import {
  bootstrapFarm, checkServer, getAuth, getSpendCap, getStatus, isConnected, makePassword, newFarmId, setSpendCap,
  revokeMember, setAccount, signInLink, signOutDevice, statusLine, suggestLogin, syncNow,
} from '../sync.js';
import { getMeta, setMeta } from '../db.js';
import {
  bestSowingWindow, calibrate, cashflowForecast, forecastAccuracy, harvestForecast,
  labourForecast, revenueForecast, stockForecast, breakEven,
} from '../domain/predict.js';
import { riskForecast, RISK_DRIVER_TEXT } from '../domain/diagnose.js';
import { lowStock, lowStockSummary, reorderLevel } from '../domain/stock.js';
import { maySignOff, signOffPayload, trialRecord } from '../domain/supervision.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { harvestCheck, setupStatus } from '../domain/onboarding.js';
import {
  buildCatalogue, canUseActive, checkAddActive, checkAddLabel, migrateStockToActives,
  planStockMigration, rateFor,
} from '../domain/catalogue.js';
import { PRICE_SEASONALITY, seasonOn, SEASON_LABELS, climateFor } from '../domain/climate.js';
import { addDays, daysBetween, friendlyDate, isoDate, kg, naira, round, sum, uid } from '../util.js';
import { forgetDeviceLock, hashPin, isPin, params, PIN_MAX, PIN_MIN } from './shell.js';
import { bindPhoto, photoField, photoPayload, resetPhoto } from './photo.js';
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

    // UX-28: getting people onto their own phones is the first thing a new
    // farm needs, so until everyone has a sign-in it is the first card here.
    if (can(ctx.user, 'managePeople')) out += peopleCard(ctx);

    // Sales and costs are withheld from roles without money authority, so their
    // totals here would be zeroes that read as fact. Show the crop instead.
    const showsMoney = can(ctx.user, 'manageMoney');
    // FR-SIMP-04: what the crop on the plants is worth is the Owner's.
    const showsValue = can(ctx.user, 'viewProfit');

    out += card(
      '<div class="grid">'
      + stat('Picked this month', kg(pickedThisMonth, 0), `${state.harvests.filter((h) => h.date >= from).length} pickings`)
      + (showsMoney
        ? stat('Sold this month', naira(soldThisMonth, true), 'recorded sales')
        : stat('Beds working', String(cycles.length), 'crop cycles on the ground'))
      + (showsMoney
        ? stat('Spent this month', naira(costsThisMonth, true), hasRates(state) ? 'inputs and labour' : 'inputs')
        : stat('Still to pick', kg(sum(forecasts, (f) => f.forecast.remainingKg), 0), 'across all beds'))
      + (showsValue
        ? stat('Still on the plants', naira(expectedRemaining, true), 'forecast value')
        : stat('Open jobs', String(openTasks(state).length), 'assigned and due'))
      + '</div>'
      + '<h3 style="margin-top:16px">Picking, last 14 days</h3>'
      + spark(days, { caption: `Total ${kg(sum(days, (d) => d.value), 0)} over the fortnight.` }),
    );

    // FR-ONB-08: until every zone is set up, the Owner sees what is missing.
    if (can(ctx.user, 'settings')) {
      const setup = setupStatus(state, { today });
      const left = setup.incomplete.length + (setup.farm.complete ? 0 : 1);
      // Shown while onboarding is under way, or on a farm with no crop yet
      // started in the app — not forever on a farm that has moved past it.
      const begun = (state.backfills || []).length || setup.rows.some((r) => r.cycle && r.cycle.onboarded);
      const fresh = !Object.values(state.cycles || {}).some((c) => !c.onboarded);
      if (left && (begun || fresh)) {
        out += card(note('warn', `Setup: ${left} still to finish`,
          `<small>${esc(setup.incomplete.map((r) => `${r.zone.name}: ${r.missing.map((m) => m.label).join('; ')}`)
            .concat(setup.farm.complete ? [] : ['Stock on hand not counted']).join(' · '))}</small>`)
          + button('Open setup', 'go', { cls: 'btn-block', data: { to: '#/setup' } }), { tight: true });
      }
    }

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
            .concat(showsValue ? [{ label: 'Worth', num: true }] : [{ label: 'First pick' }]),
          forecasts.map(({ cycle, forecast }, i) => [
            cycleLabel(state, cycle.id),
            forecast.stage.name,
            kg(cycle.harvestedKg || 0, 0),
            kg(forecast.remainingKg, 0),
            showsValue ? naira(revenues[i].remainingRevenue, true)
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
      + button('Today\'s digest', 'go', { cls: 'btn-ghost', icon: '📨', data: { to: '#/digest' } })
      + button('Alerts', 'go', { cls: 'btn-ghost', icon: '🚨', data: { to: '#/alerts' } })
      + button('Success measures', 'go', { cls: 'btn-ghost', icon: '📈', data: { to: '#/kpis' } })
      + button('End-of-shift reports', 'go', { cls: 'btn-ghost', icon: '📝', data: { to: '#/shifts' } })
      + button('Ask the adviser', 'go', { cls: 'btn-ghost', icon: '🧠', data: { to: '#/adviser' } })
      + (can(ctx.user, 'viewAudit') ? button('Farm check', 'go', { cls: 'btn-ghost', icon: '🔎', data: { to: '#/audit' } }) : '')
      + (showsValue ? button('Planting planner', 'go', { cls: 'btn-ghost', icon: '📅', data: { to: '#/plan' } }) : '')
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
    const clearance = harvestCheck(state, c.id);
    if (!clearance.safe) {
      alerts.push({
        title: clearance.historyMissing ? `${cycleLabel(state, c.id)}: no picking — spray history missing`
          : `${cycleLabel(state, c.id)}: no picking until ${clearance.clearOn}`,
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

  // FR-STOCK-02: low stock is the Farm Manager's to act on, so it is on their
  // board by name rather than only in the Owner's digest tomorrow morning.
  for (const row of lowStock(state)) {
    alerts.push({
      title: `${row.line} — ${row.to}`,
      detail: row.detail,
      to: '#/store',
    });
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

// FR-SIMP-04: naira per plant by sowing date is a crop-value forecast, the Owner's.
export const planView = {
  perm: 'viewProfit',
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

    const pay = attendanceBetween(state, from, today);
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

    // An agronomist may read reports but is not sent sales or costs. Their
    // totals would come out as zeroes, which reads as "the farm sold nothing"
    // rather than "you were not shown this".
    const showsMoney = can(ctx.user, 'manageMoney');
    // FR-SIMP-04: margin, cost against revenue and the cashflow forecast are the
    // Owner's. The Farm Manager sees what was sold and what was spent.
    const showsProfit = can(ctx.user, 'viewProfit');

    return `<div class="print-head"><b>${esc(state.settings.farmName)}</b> — farm report, ${esc(friendlyDate(today))}</div>`
      + card(
        cardHead('Last 90 days', button('Print or save as PDF', 'print', { cls: 'btn-sm btn-ghost no-print' }))
        + '<div class="grid">'
        + (showsMoney
          ? stat('Sold', naira(revenue, true), 'recorded sales')
            + stat('Spent', naira(totalCost, true), hasRates(state) ? 'labour and inputs' : 'inputs')
            + (showsProfit
              ? stat('Margin', naira(revenue - totalCost, true),
                revenue > 0 ? `${Math.round(((revenue - totalCost) / revenue) * 100)}% of sales` : '—')
              : '')
          : stat('Beds', String(cycles.length), 'cycles on record')
            + stat('Pickings', String(state.harvests.filter((h) => h.date >= from).length), 'in the period'))
        + stat('Picked', kg(sum(state.harvests.filter((h) => h.date >= from), (h) => h.kg), 0), 'all beds')
        + '</div>'
        + (showsMoney ? '' : note('info', 'The books are not on this phone',
          '<small>Sales and costs go only to the CEO and the farm manager. Your screens '
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
          ? table([{ label: 'Person' }, { label: 'Days', num: true }, { label: 'Hours', num: true }],
            pay.map((r) => [r.person.name, r.days, r.hours]))
          : '<p><small>No attendance recorded in this period.</small></p>')
        + (workByType.size
          ? '<h3 style="margin-top:14px">Hours by job</h3>' + table([{ label: 'Job' }, { label: 'Hours', num: true }],
            [...workByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v, 1)]))
          : ''))
      + (showsProfit ? card(cardHead('Money coming in and going out')
        + (cash.rows.length
          ? table([{ label: 'Month' }, { label: 'Expected in', num: true }, { label: 'Out', num: true }, { label: 'Running', num: true }],
            cash.rows.map((r) => [r.month, naira(r.income, true), naira(r.cost, true), naira(r.balance, true)]))
            + (cash.tightest && cash.tightest.balance < 0
              ? note('warn', `Tightest month: ${cash.tightest.month}`,
                `<small>Running balance dips to ${esc(naira(cash.tightest.balance))}. Line up the cash before then, `
                + 'or move a planting so the picking lands earlier.</small>') : '')
          : '<p><small>Start a cycle to see the forecast.</small></p>')) : '')
      + (can(ctx.user, 'manageRates') ? labourByZoneCard(state, from, today) : '')
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
  // The dashboard's "Add a person" lands here with ?add=1 and opens the form,
  // so its buttons answer to this screen's actions wherever it was started.
  mounted(ctx) {
    if (!params().add) return;
    history.replaceState(null, '', '#/people');
    openPersonSheet(ctx, null);
  },
  render(ctx) {
    const people = ROLE_LIST.flatMap((role) =>
      Object.values(ctx.state.people).filter((p) => p.role === role.id));
    const canAppoint = assignableRoles(ctx.user);
    const isOwner = can(ctx.user, 'manageOwners');
    const connected = isConnected();

    return card(
      cardHead('Add a person')
      + (connected
        ? '<p><small>Type their name and pick their job. The app makes a sign-in name and a password; '
          + 'you send both to them. On their own phone they sign in and see the screens for that job.</small></p>'
        : notConnectedNote(ctx))
      + button('Add a person', 'open-person', { cls: 'btn-block btn-lg', icon: '👤' }),
    )
    + card(
      cardHead('People')
      + '<ul class="list">' + people.map((p) => {
        const role = ROLES[p.role];
        const editable = canEditPerson(ctx.user, p);
        const me = p.id === ctx.user.id;
        const signIn = !connected || me || p.active === false ? ''
          : p.login ? ` · signs in as ${esc(p.login)}` : ' · <b>no sign-in yet</b>';
        return `<li><div class="grow"><b>${esc(p.name)}</b>`
          + `<small>${esc(role?.name || p.role)}`
          + `${p.active === false ? ' · removed' : ''}${me ? ' · you' : ''}${signIn}</small></div>`
          + (p.role === 'ceo' ? badge('owner', 'ok') : '')
          + (editable
            ? button(connected && !me && !p.login && p.active !== false ? 'Give sign-in' : 'Edit',
              'open-person', { cls: 'btn-sm btn-ghost', data: { id: p.id } })
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
    'make-password': (ctx, el) => {
      const box = el.closest('form') && el.closest('form').querySelector('input[name="password"]');
      if (box) { box.value = makePassword(); box.focus(); }
    },
    'invite-copy': async (ctx, el) => {
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); }
      catch { toast('Could not copy. Select it and copy by hand.', true); }
    },
    'invite-share': async (ctx, el) => {
      if (navigator.share) {
        try { await navigator.share({ title: 'DouValue farm app', text: el.dataset.text }); return; }
        catch { /* cancelled, or not allowed: copy instead */ }
      }
      try { await navigator.clipboard.writeText(el.dataset.text); toast('Message copied. Paste it to them.'); }
      catch { toast('Could not share on this phone. Copy the details by hand.', true); }
    },
    'invite-done': () => closeSheet(),
    'go-connect': (ctx) => { closeSheet(); ctx.go('#/settings?connect=1'); },

    'revoke-devices': async (ctx, el) => {
      const target = ctx.state.people[el.dataset.id];
      const ok = await confirmSheet('Sign out their phones?',
        `${target.name} will be signed out everywhere and must sign in again with their password. `
        + 'If a phone went missing, give them a new password too, so whoever has it cannot.', 'Sign them out');
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
        `${target.name} will not be able to sign in. `
        + 'Everything they recorded stays in the farm\'s records.', 'Remove');
      if (!ok) return;
      // On a connected farm the server closes their account too, or their
      // password would still sign them in on a phone (UX-28).
      if (isConnected() && target.login) {
        try { await revokeMember(target.id); }
        catch (err) { toast(err.message || 'The server did not close their account. Try again.', true); return; }
      }
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
  // UX-28: on a connected farm everyone signs in with a name and a password
  // made here. Your own is optional: this phone already knows you, and the
  // sign-in is for using the app on another one.
  const self = !!(p && p.id === ctx.user.id);
  const signsIn = isConnected();
  const hasSignIn = !!(p && p.login);

  openSheet(`<h2>${p ? (signsIn && !hasSignIn && !self ? `Give ${esc(p.name)} a sign-in` : 'Edit person') : 'Add a person'}</h2>`
    + (isConnected() ? '' : notConnectedNote(ctx))
    + '<form data-act="save-person">'
    + (p ? `<input type="hidden" name="id" value="${esc(p.id)}">` : '')
    + field('Name', input('name', { value: p?.name || '', required: true, autocomplete: 'off' }))
    + field('Job', select('role', options, p?.role || options[options.length - 1].value),
      'This is what they see when they sign in.')
    + field('Phone', input('phone', { value: p?.phone || '', type: 'tel', placeholder: '080...' }),
      'Used to send them their sign-in on WhatsApp.')
    + (signsIn
      ? (self
        ? '<h3 style="margin-top:16px">Your sign-in, for another phone</h3>'
          + '<p><small>This phone already knows you. Set a sign-in name and password to use the app '
          + 'on another phone or a computer: open the app there and sign in with them.</small></p>'
        : '<h3 style="margin-top:16px">Their sign-in</h3>')
        + field('Sign-in name', input('login', {
          value: p?.login || '', placeholder: 'made from their name if left empty',
          autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' }),
        'What they type to sign in. Letters and numbers, no spaces.')
        + field(hasSignIn ? 'New password (leave empty to keep theirs)' : 'Password',
          input('password', { value: hasSignIn || self ? '' : makePassword(), inputmode: 'numeric',
            placeholder: hasSignIn ? 'leave empty to keep' : '6 to 12 numbers', autocomplete: 'off' }),
          '6 to 12 numbers. You send it to them; they type it to sign in.')
        + button('Make a new password', 'make-password', { cls: 'btn-quiet btn-sm' })
      : field(p ? 'New PIN (leave empty to keep)' : 'PIN',
        input('pin', { inputmode: 'numeric', placeholder: '0000' }),
        `${PIN_MIN} to ${PIN_MAX} digits. `
        + (p ? 'Set a new one only if they have forgotten it.' : 'Give this to them privately.')))
    + `<button class="btn-block btn-lg" type="submit" style="margin-top:14px">${signsIn && !hasSignIn && !self ? 'Save and make their sign-in' : 'Save'}</button>`
    + '</form>'
    + (p && isConnected() && removable.ok && hasSignIn
      ? button('Sign out their phones', 'revoke-devices', { cls: 'btn-ghost btn-block', data: { id: p.id } })
      : '')
    + (removable.ok
      ? button('Remove from the farm', 'deactivate-person', { cls: 'btn-ghost btn-block', data: { id: p.id } })
      : p && p.id !== ctx.user.id ? note('warn', 'Cannot be removed', `<small>${esc(removable.why)}</small>`) : ''));
}

/** Why a person added on an unconnected farm can use only this phone, and the way out. */
function notConnectedNote(ctx) {
  return note('warn', 'This farm is not connected yet',
    '<small>People added now can sign in only on this phone, by tapping their name. To let each '
    + 'person sign in on their own phone with a password, connect the farm first.</small>')
    + (can(ctx.user, 'manageSync')
      ? button('Connect the farm', 'go-connect', { cls: 'btn-block', icon: '🔗' })
      : '<p><small>Only the CEO can connect the farm.</small></p>');
}

/** UX-28: the dashboard's way in to adding people, and what is still missing. */
function peopleCard(ctx) {
  const others = Object.values(ctx.state.people)
    .filter((p) => p.active !== false && p.id !== ctx.user.id);
  if (!isConnected()) {
    return card(cardHead('People and sign-in', badge('not connected', 'warn'))
      + '<ol class="steps">'
      + '<li>Connect the farm to its server. Once only.</li>'
      + '<li>Add each person: their name, their job, a sign-in name and a password.</li>'
      + '<li>Send them both. On their own phone they sign in and see the screens for their job.</li>'
      + '</ol>'
      + (can(ctx.user, 'manageSync')
        ? button('Connect the farm', 'go', { cls: 'btn-block btn-lg', icon: '🔗', data: { to: '#/settings?connect=1' } })
        : note('info', 'Ask the CEO', '<small>Only the CEO can connect the farm.</small>'))
      + button('Add a person on this phone only', 'go', { cls: 'btn-ghost btn-block', data: { to: '#/people?add=1' } }));
  }
  const missing = others.filter((p) => !p.login && canEditPerson(ctx.user, p));
  if (others.length && !missing.length) {
    return card(button(`People and sign-in · ${others.length}`, 'go',
      { cls: 'btn-ghost btn-block', icon: '👥', data: { to: '#/people' } }), { tight: true });
  }
  return card(cardHead('People and sign-in', badge(`${others.length} ${others.length === 1 ? 'person' : 'people'}`))
    + (missing.length
      ? note('warn', `${missing.length} without a sign-in yet`,
        `<small>${esc(missing.map((p) => p.name).join(', '))}. Open People and press Give sign-in.</small>`)
      : '')
    + button('Add a person', 'go', { cls: 'btn-block btn-lg', icon: '👤', data: { to: '#/people?add=1' } })
    + button('See everyone', 'go', { cls: 'btn-ghost btn-block', icon: '👥', data: { to: '#/people' } }));
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

  // UX-28: on a connected farm the server owns accounts. Saving makes or
  // changes this person's sign-in, and the details are shown to send to them.
  // Your own record goes to the server only when you set your own sign-in.
  const self = !!(existing && existing.id === ctx.user.id);
  const settingOwn = self && (String(data.login || '').trim() || String(data.password || '').trim());
  if (isConnected() && (!self || settingOwn)) {
    const taken = Object.values(ctx.state.people)
      .filter((q) => q.login && (!existing || q.id !== existing.id)).map((q) => q.login);
    const login = String(data.login || '').trim().toLowerCase().replace(/\s+/g, '') || suggestLogin(name, taken);
    const password = String(data.password || '').trim();
    const needsPassword = !existing || !existing.login;
    if (self && !existing.login && !password) {
      toast('Choose a password of 6 to 12 numbers for your sign-in', true);
      return;
    }
    if ((needsPassword || password) && !/^\d{6,12}$/.test(password)) {
      toast('The password is 6 to 12 numbers. Press Make a new password for one.', true);
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Saving…'; }
    try {
      const result = await setAccount({
        memberId: existing ? existing.id : undefined, name, role: data.role, login, password,
      });
      await ctx.store.dispatch('person.upsert', {
        id: result.memberId, name, role: data.role, phone: data.phone || '',
        active: true, login: result.login,
      });
      if (self) {
        closeSheet();
        toast(`Your sign-in is ${result.login}${password ? ' with the password you chose' : ''}. `
          + 'Use it to open the app on another phone.');
      } else if (password) {
        showAccountReady(ctx, { name, role: data.role, phone: data.phone, login: result.login, password });
      } else {
        closeSheet();
        toast(`Saved. ${name} still signs in as ${result.login} with the same password.`);
      }
    } catch (err) {
      if (submit) { submit.disabled = false; submit.textContent = 'Try again'; }
      toast(err.message || 'Could not save that account', true);
    }
    return;
  }

  const payload = {
    id: data.id || uid('person'),
    name, role: data.role, phone: data.phone || '',
    active: true,
  };
  if (data.pin) {
    if (!isPin(data.pin)) { toast(`A PIN is ${PIN_MIN} to ${PIN_MAX} digits`, true); return; }
    payload.pinHash = await hashPin(data.pin);
  } else if (existing) {
    payload.pinHash = existing.pinHash;
  } else {
    toast(`Give them a PIN of ${PIN_MIN} to ${PIN_MAX} digits so they can sign in`, true);
    return;
  }

  await ctx.store.dispatch('person.upsert', payload);
  if (existing) {
    closeSheet();
    toast('Saved');
    return;
  }
  // Said on a sheet that stays until it is read, not in a toast that is gone
  // before anyone has looked up.
  openSheet(`<h2>✓ ${esc(payload.name)} is on the farm</h2>`
    + `<p>${esc(ROLES[payload.role].name)}. They sign in on <b>this phone</b>: tap their name, then `
    + 'type the PIN you gave them.</p>'
    + notConnectedNote(ctx)
    + button('Done', 'invite-done', { cls: 'btn-block btn-lg' }));
}

/** A Nigerian number as WhatsApp wants it: 0803… becomes 234803… */
function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234')) return digits;
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}

/**
 * UX-28 — the sign-in details, shown once, to send to the person.
 *
 * It stays open until Done is pressed: the password is not kept anywhere it
 * can be shown again, so this is the one chance to send it.
 */
function showAccountReady(ctx, { name, role, phone, login, password }) {
  const roleName = ROLES[role]?.name || role;
  const appLink = signInLink();
  const message = `Hello ${name}, welcome to the DouValue farm management app. `
    + `Open it here: ${appLink}\n`
    + `Sign-in name: ${login}\nPassword: ${password}\n`
    + `Your job in the app: ${roleName}. Keep the password to yourself.`;
  const wa = `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;

  openSheet(`<h2>✓ Account ready for ${esc(name)}</h2>`
    + `<p>${esc(roleName)}. When they sign in, the app opens on the ${esc(roleName)} screens.</p>`
    + '<div class="code-box" style="font-size:1.15rem;line-height:1.7">'
    + `Sign-in name: <b>${esc(login)}</b><br>Password: <b style="letter-spacing:.12em">${esc(password)}</b></div>`
    + '<h3 style="margin-top:14px">Send it to them</h3>'
    + link('Send on WhatsApp', wa, { cls: 'btn-block btn-lg', icon: '💬', newTab: true })
    + '<div class="row wrap" style="margin-top:8px">'
    + button('Share another way', 'invite-share', { cls: 'btn-ghost', data: { text: message } })
    + button('Copy the message', 'invite-copy', { cls: 'btn-ghost', data: { text: message } })
    + '</div>'
    + `<p style="margin-top:10px"><small>The message holds the app link, the sign-in name and the password:</small></p>`
    + `<div class="code-box" style="white-space:pre-wrap;font-size:.9rem">${esc(message)}</div>`
    + note('warn', 'This is the only time the password is shown',
      '<small>Send it now, or write it down. If it is lost, open the person in People and give them a new one.</small>')
    + button('Done', 'invite-done', { cls: 'btn-block btn-lg' }));
}

// --- Store (inputs) -------------------------------------------------------

export const storeView = {
  perm: 'logInputs',
  render(ctx) {
    const { state } = ctx;
    const items = inputsList(state);
    const usage = inputUsage(state);
    const low = lowStockSummary(state);
    const catalogue = buildCatalogue(state);

    return (low.count
      // FR-STOCK-02: at the top of the screen, addressed to the person who
      // orders things, before the input is needed rather than after.
      ? card(
        cardHead('To order', badge(low.text, low.urgent ? 'danger' : 'warn'))
        + `<p><small>For the ${esc(low.to ? `Farm Manager (${low.to.name})` : 'Farm Manager')}. `
        + 'Ordering today lands in about two weeks, which is why this says it now.</small></p>'
        + '<ul class="list">' + low.rows.map((r) => '<li><div class="grow">'
          + `<b>${esc(r.line)}</b><small>${esc(r.detail)}</small></div>`
          + badge(r.severity === 'now' ? 'order now' : 'order soon',
            r.severity === 'now' ? 'danger' : 'warn') + '</li>').join('') + '</ul>',
      )
      : '')
    + card(
      cardHead('Store', button('Add item', 'open-input', { cls: 'btn-sm' }))
      + (items.length
        ? '<ul class="list">' + items.map((item) => {
          const f = stockForecast(item, usage);
          const level = reorderLevel(item);
          const active = item.activeId ? catalogue.byId[item.activeId] : null;
          return `<li><div class="grow"><b>${esc(item.name)}</b>`
            + `<small>${esc(round(item.qty, 2))} ${esc(item.unit)} in stock — ${esc(f.text)}`
            + `${level ? ` · reorder at ${esc(level)} ${esc(item.unit)}` : ''}`
            + (active ? ` · ${esc(active.name)} (${esc(active.group)})` : '') + '</small></div>'
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
            m.direction === 'in' ? 'received' : m.direction === 'opening' ? 'opening count (backfilled)' : 'issued',
            round(m.qty, 2)]))
        : '<p><small>Nothing moved yet.</small></p>'))
    + catalogueCard(ctx, catalogue);
  },

  actions: {
    'open-input': (ctx) => openInputSheet(ctx),
    'save-input': (ctx, form) => saveInput(ctx, form),
    'open-move': (ctx, el) => openMoveSheet(ctx, el.dataset.id),
    'save-move': (ctx, form) => saveMove(ctx, form),
    'open-label': (ctx) => openLabelSheet(ctx),
    'save-label': (ctx, form) => saveLabel(ctx, form),
    'open-active': (ctx) => openActiveSheet(ctx),
    'save-active': (ctx, form) => saveActive(ctx, form),
    'match-stock': (ctx) => matchStock(ctx),
  },
};

/**
 * The active-ingredient catalogue — FR-STOCK-05, 06, 08 and 09.
 *
 * Twenty actives with their IRAC/FRAC groups, straight out of the rules file.
 * What the farm adds is only what the rules leave to it: brand labels, and (for
 * the Owner alone) an active the rules do not list. Nothing here is typed twice
 * — the group on a label is the group of its active.
 */
function catalogueCard(ctx, catalogue) {
  const plan = planStockMigration(ctx.state, catalogue);
  const mayLabel = can(ctx.user, 'settings');
  const mayActive = can(ctx.user, 'manageOwners');

  const rows = catalogue.actives.map((a) => {
    const usable = canUseActive(catalogue, a.id);
    const rate = rateFor(catalogue, a.id);
    return [
      a.name,
      a.group,
      usable.ok ? rate.rate : 'no rate — needs a label',
      a.labels.length ? a.labels.map((l) => l.brand).join(', ') : '—',
    ];
  });

  return card(cardHead('Chemical catalogue',
    (mayLabel ? button('Add brand label', 'open-label', { cls: 'btn-sm' }) : '')
    + (mayActive ? button('Add active', 'open-active', { cls: 'btn-sm btn-ghost' }) : ''))
    + (plan.matched.length
      ? note('info', `${plan.matched.length} store item${plan.matched.length === 1 ? '' : 's'} `
        + 'can be put onto an active ingredient',
        `<small>${esc(plan.matched.map((r) => `${r.name} → ${r.active.name}`).join(', '))}. `
        + 'Nothing is rewritten: the match is recorded against the item, and every past treatment '
        + `stays exactly as it was (${plan.treatmentsBefore} on record).</small>`)
        + button('Match them', 'match-stock', { cls: 'btn-block' })
      : '')
    + '<p><small>Treatments are chosen by active ingredient, and the resistance group comes with it. '
    + 'A brand is a label attached to an active, never a product of its own.</small></p>'
    + table([{ label: 'Active ingredient' }, { label: 'Group' }, { label: 'Rate' }, { label: 'Brands' }], rows)
    + (plan.unmatchedChemicals.length
      ? note('warn', 'Store items with no active ingredient yet',
        `<small>${esc(plan.unmatchedChemicals.map((r) => r.name).join(', '))}. `
        + 'Until one is attached they cannot be sprayed, because the rotation gate has no group to read.</small>')
      : '')
    + (mayActive ? '' : '<p><small>Only the Owner can add a new active ingredient, and must give its '
      + 'IRAC or FRAC group.</small></p>'));
}

/** FR-STOCK-05 — the one-tap version of the boot-time migration, for a manager. */
async function matchStock(ctx) {
  const before = (ctx.state.sprays || []).length;
  const result = await migrateStockToActives(ctx.store, buildCatalogue(ctx.state));
  const after = (ctx.store.state.sprays || []).length;
  toast(`${result.written} item${result.written === 1 ? '' : 's'} matched · `
    + `${after} treatment${after === 1 ? '' : 's'} on record, ${before === after ? 'unchanged' : 'CHANGED'}`);
}

function openLabelSheet(ctx) {
  const catalogue = buildCatalogue(ctx.state);
  const el = openSheet('<h2>Add a brand label</h2>'
    + '<p><small>The group fills in from the active ingredient, so it cannot be mistyped.</small></p>'
    + '<form data-act="save-label">'
    + field('Brand name', input('brand', { required: true, placeholder: 'e.g. Punch' }))
    + field('Active ingredient or ingredients',
      `<select name="activeIds" multiple size="8">`
      + catalogue.actives.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${esc(a.group)}</option>`).join('')
      + '</select>')
    + field('Formulation', input('formulation', { placeholder: 'e.g. 45SC, 80WP' }))
    + field('Concentration', input('concentration', { placeholder: 'e.g. 45 g/L' }))
    + field('Label rate', input('rate', { placeholder: 'e.g. 0.3 ml/L' }))
    + field('Label PHI, in days', input('phiDays', { type: 'number', min: 0, placeholder: 'blank uses the default' }))
    + field('Label REI, in hours', input('reiHours', { type: 'number', min: 0, placeholder: 'blank uses the default' }))
    + '<p><small>Leave PHI or REI blank and the default applies: 24 hours before re-entry, 14 days before '
    + 'picking for a synthetic. A figure off the label is used only if it is longer.</small></p>'
    + photoField('Photo of the label',
      'The container is the record. A photo of the label settles any later argument about the rate, '
      + 'the concentration and the waiting periods.')
    + '<button class="btn-block btn-lg" type="submit">Save label</button></form>');
  bindPhoto(el);
}

async function saveLabel(ctx, form) {
  const data = readForm(form);
  const selected = [...form.querySelectorAll('select[name=activeIds] option:checked')].map((o) => o.value);
  const catalogue = buildCatalogue(ctx.state);
  const check = checkAddLabel(ctx.user,
    { ...data, activeIds: selected, id: uid('lbl'), photo: photoPayload() }, catalogue);
  if (!check.ok) { toast(check.why, true); return; }

  await ctx.store.dispatch('label.add', check.payload);
  resetPhoto();
  closeSheet();
  toast('Label saved');
}

function openActiveSheet(ctx) {
  if (!can(ctx.user, 'manageOwners')) { toast('Only the Owner can add an active ingredient', true); return; }
  openSheet('<h2>Add an active ingredient</h2>'
    + '<p><small>Only the Owner does this, and the IRAC or FRAC group is required: without a group the '
    + 'rotation gate cannot see the product, and a product the gate cannot see cannot be sprayed.</small></p>'
    + '<form data-act="save-active">'
    + field('Active ingredient', input('name', { required: true, placeholder: 'as printed on the label' }))
    + field('IRAC or FRAC group', input('group', { required: true, placeholder: 'e.g. IRAC 4A, FRAC M3' }))
    + field('Kind', select('type', ['insecticide', 'fungicide', 'miticide', 'bactericide', 'botanical',
      'biological'], 'insecticide'))
    + field('Schedule rate, if the farm has one', input('scheduleRate', { placeholder: 'e.g. 0.5 ml/L' }))
    + '<button class="btn-block btn-lg" type="submit">Add to the catalogue</button></form>');
}

async function saveActive(ctx, form) {
  const data = readForm(form);
  const catalogue = buildCatalogue(ctx.state);
  const check = checkAddActive(ctx.user, data, catalogue);
  if (!check.ok) {
    // A banned product is not a validation message in the corner of a form.
    openSheet('<h2>Refused</h2>' + note('danger', check.why, `<small>${esc(check.fix || '')}</small>`));
    return;
  }
  await ctx.store.dispatch('active.add', check.payload);
  closeSheet();
  toast(`${check.payload.name} added to the catalogue`);
}

function openInputSheet(ctx) {
  openSheet('<h2>Add a store item</h2>'
    + '<form data-act="save-input">'
    + field('Name', `<input name="name" list="product-list" required placeholder="e.g. Mancozeb 80% WP">`
      + `<datalist id="product-list">${buildCatalogue(ctx.state).actives
        .map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist>`)
    + field('Active ingredient, if it is a chemical',
      select('activeId', buildCatalogue(ctx.state).actives.map((a) => ({ value: a.id, label: `${a.name} — ${a.group}` })),
        '', { placeholder: 'Work it out from the name' }))
    + field('Kind', select('kind', [
      { value: 'chemical', label: 'Pesticide or fungicide' },
      { value: 'fertiliser', label: 'Fertiliser or lime' },
      { value: 'seed', label: 'Seed' },
      { value: 'consumable', label: 'Crates, twine, fuel, other' },
    ], 'chemical'))
    + field('Unit', select('unit', ['kg', 'litre', 'sachet', 'bag', 'piece', 'gram'], 'kg'))
    + field('How much is in stock now?', input('qty', { type: 'number', min: 0, step: '0.1', value: 0 }))
    // FR-STOCK-02: "below a set level". This is the level.
    + field('Tell the farm manager when it drops to', input('reorderLevel', {
      type: 'number', min: 0, step: '0.1', placeholder: 'optional' }),
      'The Farm Manager is alerted at or below this. Leave it empty and the app warns when the '
      + 'rate it is being used says it runs out inside two weeks.')
    + field('What one unit costs', input('unitCost', { type: 'number', min: 0, step: '10' }))
    // FR-STOCK-03/04: the date on the container. Past it, the item is not
    // stock, and the spray screen and the farm server refuse it.
    + field('Expiry date on the container', input('expiry', { type: 'date' }),
      'If it has one. Once it has passed, this cannot be chosen for a spray.')
    + '<button class="btn-block btn-lg" type="submit">Save item</button></form>');
}

async function saveInput(ctx, form) {
  const data = readForm(form);
  if (!data.name) { toast('Name is needed', true); return; }
  // An item typed in without an active is matched by name on the next open, so
  // nobody has to know the catalogue to add a bag of something to the store.
  await ctx.store.dispatch('input.upsert', {
    id: uid('item'), name: data.name, kind: data.kind, unit: data.unit,
    qty: Number(data.qty) || 0, unitCost: Number(data.unitCost) || 0,
    reorderLevel: Number(data.reorderLevel) || null,
    activeId: data.activeId || null,
    expiry: data.expiry || null,
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
    // FR-COST-05: labour is priced from the Owner's rate table. FR-SIMP-04: net
    // and break-even set cost against revenue, which is the Owner's too. The
    // Farm Manager records and reads sales and input costs.
    const ownerBooks = can(ctx.user, 'manageRates');
    const showsProfit = can(ctx.user, 'viewProfit');
    const labourCost = labourByZone(state, from, today).total;
    const cal = calibrationFor(state);
    const expectedKg = sum(activeCycles(state).map((c) => harvestForecast(c, { today, calibration: cal })), (f) => f.totalKg);
    const be = breakEven(totalExpenses + labourCost, Math.round(state.settings.prices.habanero * 0.8), expectedKg);

    return card(
      cardHead('Money, last 60 days')
      + '<div class="grid">'
      + stat('Sales', naira(totalSales, true), `${sales.length} recorded`)
      + stat('Inputs', naira(totalExpenses, true), `${expenses.length} entries`)
      + (ownerBooks ? stat('Labour', naira(labourCost, true), 'days worked × position rate') : '')
      + (showsProfit ? stat('Net', naira(totalSales - totalExpenses - labourCost, true), '') : '')
      + '</div>'
      + '<div class="row wrap" style="margin-top:12px">'
      + button('Record a sale', 'open-sale', { icon: '💵' })
      + button('Record a cost', 'open-expense', { cls: 'btn-ghost', icon: '🧾' })
      + '</div>',
      { tight: true },
    )
    + (showsProfit
      ? card(cardHead('Break-even') + note(be.verdict === 'comfortable' ? 'ok' : be.verdict === 'loss at this price' ? 'danger' : 'warn',
        be.verdict, `<small>${esc(be.text)}</small>`))
      : '')
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

// --- Labour rates and labour cost (FR-COST-01, FR-COST-05) ---------------

/** The Owner's daily rate per position. Only the Owner's phone renders this, or holds the figures. */
function ratesCard(ctx) {
  return card(cardHead('Daily rate by position')
    + '<p><small>Only you see these. Labour cost per zone is the days each person worked there '
    + 'times the rate for their position. A position with no rate is shown as unpriced, never as free.</small></p>'
    + '<form data-act="save-rates">'
    + ROLE_LIST.map((r) => field(r.name, input(`rate_${r.id}`, {
      type: 'number', min: 0, step: '100', placeholder: 'not set', value: dailyRateFor(ctx.state, r.id) ?? '',
    }))).join('')
    + '<button class="btn-block btn-lg" type="submit">Save rates</button>'
    + '</form>');
}

function labourByZoneCard(state, from, to) {
  const l = labourByZone(state, from, to);
  const name = (id) => (state.plots[id] ? state.plots[id].name || id : id);
  const rows = Object.entries(l.zones).sort((a, b) => b[1].cost - a[1].cost)
    .map(([id, r]) => [name(id), round(r.days, 1), naira(r.cost)]);
  if (l.unallocated.days) rows.push(['Not tied to a zone', round(l.unallocated.days, 1), naira(l.unallocated.cost)]);
  return card(cardHead('Labour cost by zone')
    + (rows.length
      ? table([{ label: 'Zone' }, { label: 'Days', num: true }, { label: 'Cost', num: true }], rows)
      : '<p><small>No priced attendance in this period.</small></p>')
    + (l.unpriced.length
      ? note('warn', 'Days with no rate', `<small>${esc(l.unpriced.map((u) => `${ROLES[u.role]?.name || u.role}: ${u.days}`).join(' · '))}. `
        + 'Set a rate for these positions in Settings.</small>')
      : ''));
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
    + (can(ctx.user, 'manageRates') ? ratesCard(ctx) : '')
    + (can(ctx.user, 'manageOwners') && isConnected() ? card(cardHead('Outside advice: monthly limit')
      + '<p><small>The wider adviser and photo review are paid for on the farm server\'s key. '
      + 'Each person is limited per day; this limits the whole farm per month, in US dollars, '
      + 'which is what the bill is in. Only you see or set it.</small></p>'
      + button('See this month\'s spend', 'open-spend-cap', { cls: 'btn-ghost', icon: '💳' })) : '')
    + syncCard(ctx)
    + trialCard(ctx)
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
      // UX-25: training after the farm is running, without the trainee's first
      // attempt at a harvest ending up in the books.
      + button('Practice mode', 'practice-start', { cls: 'btn-ghost btn-block', icon: '🎓' })
      + '<p><small>Fills the app with an example farm so somebody can be trained on it. Nothing '
      + 'done in practice is saved or synced, and your real records are not opened at all.</small></p>'
      + `<div style="margin-top:14px">${button('Erase everything on this phone', 'wipe-data',
        { cls: 'btn-danger btn-block' })}</div>`
      + '<p style="margin-top:8px"><small>Export first. This cannot be undone.</small></p>');
  },

  actions: {
    // UX-26/27 — the Owner's switch, and nobody else's.
    'trial-signoff': async (ctx) => {
      if (!maySignOff(ctx.user)) { toast('Only the Owner can sign off the trial', true); return; }
      const ok = await confirmSheet('Sign off the field trial?',
        'Two Greenhouse Hands have used the field screens in real work with the training '
        + 'consultant watching, what slowed them down has been fixed, and it has been '
        + 're-checked. After this, the spray and gate screens no longer ask for the Field '
        + 'Supervisor or Farm Manager.', 'Yes, the round is done');
      if (!ok) return;
      await ctx.store.dispatch('settings.update', signOffPayload(ctx.user, { signedOff: true }));
      toast('Field trial signed off. Supervised use has ended.');
    },
    'trial-reopen': async (ctx) => {
      if (!maySignOff(ctx.user)) { toast('Only the Owner can change this', true); return; }
      const ok = await confirmSheet('Put supervised use back on?',
        'The spray and gate screens will ask for the Field Supervisor or Farm Manager again.',
        'Yes, supervise them again');
      if (!ok) return;
      await ctx.store.dispatch('settings.update', signOffPayload(ctx.user, { signedOff: false }));
      toast('Supervised use is back on');
    },
    'sync-setup': (ctx) => openSyncSetup(ctx),
    'sync-save': (ctx, form) => saveSyncSetup(ctx, form),
    'sync-run': async () => {
      toast('Syncing…');
      const r = await syncNow();
      toast(r.ok ? `Up to date. Sent ${r.sent}, received ${r.received}.` : r.reason, !r.ok);
    },
    'sync-signout': async (ctx) => {
      const ok = await confirmSheet('Sign this phone out?',
        'This phone stops sending and receiving, and whoever uses it next signs in with their own '
        + 'sign-in name and password. Records already on the server stay there.', 'Sign out');
      if (!ok) return;
      await signOutDevice();
      await setMeta('devicePin', null);
      await forgetDeviceLock();
      sessionStorage.removeItem('douvalue.user');
      ctx.store.setUser(null);
      closeSheet();
      toast('This phone is signed out');
    },

    'open-spend-cap': async () => {
      let s;
      try { s = await getSpendCap(); } catch (err) { toast(err.message || 'Could not reach the farm server', true); return; }
      if (!s) { toast('This phone is not connected to the farm server', true); return; }
      openSheet('<h2>Outside advice this month</h2>'
        + note(s.over ? 'danger' : 'info', `$${s.spentUsd} spent in ${esc(s.month)}`,
          `<small>${s.capUsd == null ? 'No monthly limit is set.' : `The limit is $${s.capUsd}.`} `
          + 'Worked out from what each answer used, at list prices.</small>')
        + '<form data-act="save-spend-cap">'
        + field('Monthly limit (US dollars)', input('monthlyUsd', {
          type: 'number', min: 0, step: '1', value: s.capUsd ?? '', placeholder: 'empty for no limit' }))
        + '<button class="btn-block btn-lg" type="submit">Save limit</button></form>');
    },
    'save-spend-cap': async (ctx, form) => {
      const raw = readForm(form).monthlyUsd;
      try {
        const s = await setSpendCap(raw === '' || raw == null ? null : Number(raw));
        closeSheet();
        toast(s && s.capUsd != null ? `Limit set: $${s.capUsd} a month` : 'No monthly limit');
      } catch (err) {
        toast(err.message || 'Could not save the limit', true);
      }
    },

    'save-rates': async (ctx, form) => {
      const data = readForm(form);
      const events = [];
      for (const r of ROLE_LIST) {
        const raw = data[`rate_${r.id}`];
        if (raw === '' || raw == null) continue;
        const perDay = Math.max(0, Number(raw) || 0);
        if (perDay !== dailyRateFor(ctx.state, r.id)) events.push({ type: 'rate.set', payload: { role: r.id, perDay } });
      }
      if (!events.length) { toast('No rate changed'); return; }
      await ctx.store.dispatchMany(events);
      toast('Rates saved');
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
    // The dashboard's "Connect the farm" (UX-28) opens the form straight away;
    // the Sync card is otherwise a long scroll down this screen.
    if (params().connect) {
      history.replaceState(null, '', '#/settings');
      if (!isConnected() && can(ctx.user, 'manageSync')) openSyncSetup(ctx);
    }
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

// --- The field trial — UX-26, UX-27, §9a ----------------------------------
//
// One switch, held by the Owner. Until it is thrown, the spray and gate screens
// ask for the Field Supervisor or Farm Manager; after it, they behave normally.
//
// It is in Settings rather than buried in the gate screens because it is a
// statement about the farm, not about a screen: the trial round happened, what
// it found was fixed, and the app is signed off for unsupervised use.
function trialCard(ctx) {
  const trial = trialRecord(ctx.state);
  const owner = maySignOff(ctx.user);
  const by = trial.by ? (ctx.state.people[trial.by] || {}).name : null;

  return card(
    cardHead('Field trial', trial.signedOff
      ? badge('signed off', 'ok') : badge('supervised use', 'warn'))
    + (trial.signedOff
      ? `<p><small>Signed off${by ? ` by ${esc(by)}` : ''}`
        + `${trial.at ? ` on ${esc(friendlyDate(trial.at.slice(0, 10)))}` : ''}. `
        + 'The spray and gate screens are used normally.</small></p>'
        + (owner
          ? button('Put supervised use back on', 'trial-reopen', { cls: 'btn-ghost btn-block' })
          : '')
      : '<p><small>Until the after-build round is done, the spray and gate screens are used '
        + 'only with the Field Supervisor or Farm Manager present — signed in, or confirming '
        + 'on the spot (UX-27). Everything else works normally.</small></p>'
        + '<p><small><b>The round:</b> two Greenhouse Hands use the field screens in real work '
        + 'with the training consultant watching, anything that slows them down is written '
        + 'down, and it is fixed and re-checked in one revision round (UX-26).</small></p>'
        + (owner
          ? button('Sign off the field trial', 'trial-signoff', { cls: 'btn-block btn-lg', icon: '✅' })
          : note('info', 'The Owner signs this off',
            '<small>It is deliberately not the Farm Manager\'s switch: the person who finds the '
            + 'confirmation tedious is the person who must not be able to turn it off.</small>'))),
  );
}

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
        ? '<p><small>You need a server of your own first. It is free and it is one tap: the '
          + 'setup page below opens Deno with everything already filled in. Press Deploy, wait '
          + 'about a minute, copy the address it gives you, then come back here and paste it.</small></p>'
          + link('Get a server', 'server/', { cls: 'btn-block btn-lg', icon: '🚀', newTab: true })
          + button('I have the address', 'sync-setup', { cls: 'btn-block btn-lg', icon: '🔗' })
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
    + note('warn', 'Already connected it on another phone or computer?',
      '<small>Do not connect again here: that makes a second, empty farm. On the device that is '
      + 'connected, open People, tap your own name and set your sign-in. Then sign in here with it.</small>')
    + button('Sign in to my connected farm', 'go', { cls: 'btn-ghost btn-block', data: { to: '#/signin' } })
    + '<h3 style="margin-top:16px">First time: connect this farm</h3>'
    + '<p><small>This creates the farm on your server and makes you its first account. '
    + 'From then on you create everyone else here, and each of them signs in as themselves.</small></p>'
    + '<form data-act="sync-save">'
    + field('Server address', input('url', { required: true, placeholder: 'https://your-farm.deno.net' }),
      'The address your server gave you. Use https.')
    + field('Your PIN', input('password', { type: 'password', required: true, inputmode: 'numeric', placeholder: '0000' }),
      `${PIN_MIN} to ${PIN_MAX} digits. This is what you type to sign in on this phone.`)
    + field('Type it again', input('password2', { type: 'password', inputmode: 'numeric', placeholder: '0000' }))
    + '<button class="btn-block btn-lg" type="submit">Create the farm</button>'
    + '</form>'
    + note('info', 'What the server protects',
      '<small>Each person gets their own account and the server decides what their role may see. '
      + 'A farm hand\'s phone is never sent costs or sales at all, so there is nothing on it to '
      + 'read. Losing a phone means revoking that one device, not changing everyone\'s password.</small>'));
}

async function saveSyncSetup(ctx, form) {
  const data = readForm(form);
  const url = String(data.url || '').trim().replace(/\/+$/, '');
  const password = String(data.password || '');
  if (!/^https?:\/\//.test(url)) { toast('The address must start with http or https', true); return; }
  if (!isPin(password)) { toast(`Your PIN must be ${PIN_MIN} to ${PIN_MAX} digits`, true); return; }
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
    await forgetDeviceLock();
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
