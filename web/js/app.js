// Boot: build the store, wire the screens, start the shell, and — only if there
// is a network to spare — go and fetch a real forecast.

import { can, createStore } from './store.js';
import { registerRoute, startShell } from './ui/shell.js';
import { todayView, setWeather } from './ui/worker.js';
import { fieldView, cycleView } from './ui/field.js';
import { clinicView, diagnoseView, guideView, guideItemView } from './ui/clinic.js';
import {
  dashboardView, planView, reportsView, peopleView, storeView, moneyView, settingsView,
} from './ui/manage.js';
import { auditView } from './ui/audit.js';
import { adviserView } from './ui/adviser.js';
import { gatesView } from './ui/gates.js';
import { alertsView, digestView } from './ui/alerts.js';
import { zonesView } from './ui/zones.js';
import { fetchForecast, summariseObserved } from './domain/climate.js';
import { missingTasks } from './domain/schedule.js';
import { startSync } from './sync.js';
import { getMeta, setMeta } from './db.js';
import { isoDate } from './util.js';

registerRoute('#/today', todayView);
registerRoute('#/field', fieldView);
registerRoute('#/field/cycle', cycleView);
registerRoute('#/clinic', clinicView);
registerRoute('#/diagnose', diagnoseView);
registerRoute('#/guide', guideView);
registerRoute('#/guide/item', guideItemView);
registerRoute('#/dashboard', dashboardView);
registerRoute('#/plan', planView);
registerRoute('#/reports', reportsView);
registerRoute('#/audit', auditView);
registerRoute('#/adviser', adviserView);
registerRoute('#/gates', gatesView);
registerRoute('#/alerts', alertsView);
registerRoute('#/digest', digestView);
registerRoute('#/zones', zonesView);
registerRoute('#/people', peopleView);
registerRoute('#/store', storeView);
registerRoute('#/money', moneyView);
registerRoute('#/settings', settingsView);

async function warmWeather(ctx) {
  // Use yesterday's answer first so the screen never waits on the network.
  const cached = await getMeta('forecast');
  if (cached && cached.days) {
    setWeather(cached);
    ctx.refresh();
  }

  if (!navigator.onLine) return;
  const stale = !cached || (Date.now() - new Date(cached.fetchedAt).getTime()) > 6 * 3600 * 1000;
  if (!stale) return;

  const fresh = await fetchForecast();
  if (!fresh) return;                       // offline, blocked, or the service is down
  fresh.observed = summariseObserved(fresh.days);
  await setMeta('forecast', fresh);
  setWeather(fresh);
  ctx.refresh();
}

/**
 * FR-TASK-01 — put today's work on the board.
 *
 * Runs on every open. Safe to run five times on five phones, because every
 * generated task carries a deterministic id: IndexedDB keys events by id and
 * the sync merge is a set union, so the same Tuesday lands once however many
 * handsets produced it.
 *
 * Only the people who run the work generate it. A farm hand opening the app
 * should not be quietly writing the day's plan.
 */
async function generateToday(ctx) {
  if (!ctx.user || !can(ctx.user, 'assignTasks')) return;
  const due = missingTasks(ctx.store.state, { date: isoDate() });
  if (!due.length) return;

  for (const task of due) {
    await ctx.store.dispatch('task.create', task, { eventId: `ev_${task.id}` });
  }
  ctx.refresh();
}

async function main() {
  const store = await createStore();
  const ctx = await startShell(store);
  window.__douvalueCtx = ctx;              // the guide's search box reaches back for this

  // Sync runs itself from here: it pushes and pulls whenever the phone has
  // signal, and quietly queues everything when it does not.
  await startSync(store);

  await generateToday(ctx).catch((err) => {
    // A farm that cannot generate its schedule still has to be usable: every
    // screen works on what is already recorded.
    console.error('Could not generate today\'s tasks', err);
  });

  warmWeather(ctx).catch(() => { /* climatology carries the app without it */ });

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch {
      // No offline cache. The app still runs; it just needs the network to load.
    }
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML =
    '<div style="padding:24px;font-family:system-ui">'
    + '<h1>DouValue could not start</h1>'
    + `<p>${String(err && err.message ? err.message : err)}</p>`
    + '<p>Your records are still stored on this phone. Close the app and open it again. '
    + 'If it keeps failing, tell the manager before clearing anything.</p></div>';
});
