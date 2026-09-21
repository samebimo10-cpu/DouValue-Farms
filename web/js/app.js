// Boot: build the store, wire the screens, start the shell, and — only if there
// is a network to spare — go and fetch a real forecast.

import { can, createStore, setPractice } from './store.js';
import { registerRoute, startShell } from './ui/shell.js';
import { todayView, setWeather } from './ui/worker.js';
import { fieldView, cycleView } from './ui/field.js';
import { clinicView, diagnoseView, guideView, guideItemView } from './ui/clinic.js';
import {
  dashboardView, planView, reportsView, peopleView, storeView, moneyView, settingsView,
} from './ui/manage.js';
import { auditView } from './ui/audit.js';
import { doctorView } from './ui/doctor.js';
import { gatesView } from './ui/gates.js';
import { alertsView, digestView } from './ui/alerts.js';
import { zonesView } from './ui/zones.js';
import { fetchForecast, summariseObserved } from './domain/climate.js';
import { buildCatalogue, migrateStockToActives } from './domain/catalogue.js';
import { missingTasks } from './domain/schedule.js';
import { missingFollowUps } from './domain/doctor.js';
import { loadRules } from './rules.js';
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
// FR-DOC-11 — one entry point. The Farm Doctor and the farm adviser are tabs
// on one screen, so nobody has to decide which of them their question is for
// before they know what is wrong. Both addresses land in the same place.
registerRoute('#/doctor', doctorView);
registerRoute('#/adviser', doctorView);
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
  const today = isoDate();
  // FR-DOC-07: the three-day check after every treatment is generated the same
  // way, from the spray it belongs to, so it is on the board whether or not
  // anybody remembered to write it down.
  const due = [
    ...missingTasks(ctx.store.state, { date: today }),
    ...missingFollowUps(ctx.store.state, { today }),
  ];
  if (!due.length) return;

  for (const task of due) {
    await ctx.store.dispatch('task.create', task, { eventId: `ev_${task.id}` });
  }
  ctx.refresh();
}

/**
 * FR-STOCK-05 — put the store's existing items onto active ingredients.
 *
 * The farm has a store full of items typed in by name: "Mancozeb 80% WP",
 * "Neem oil". The catalogue works on actives, so each item is matched to one
 * and the match is recorded — as an `input.upsert` carrying the active id,
 * because the log is append-only and nothing here rewrites history. Past
 * treatments are not touched at all; they are read through the catalogue, so
 * the count before and the count after are the same records.
 *
 * Runs on every open, writes only the first time: each event has a fixed id,
 * so five phones produce the same events and the merge is a no-op.
 */
async function migrateCatalogue(ctx) {
  if (!ctx.user || !can(ctx.user, 'logInputs')) return;
  const result = await migrateStockToActives(ctx.store, buildCatalogue(ctx.store.state));
  if (result.written) ctx.refresh();
}

async function main() {
  // UX-25 has to be decided before anything is loaded: a practice session must
  // never open the real log at all.
  let practising = false;
  try { practising = sessionStorage.getItem('douvalue.practice') === '1'; } catch { /* off */ }
  setPractice(practising);

  // The rules file is the source of truth for the gates, the rotation and the
  // active-ingredient catalogue. Nothing that reads it is safe to guess at, so
  // it is loaded before the app has a screen and a failure stops the boot
  // rather than quietly running on no agronomy at all.
  await loadRules();

  const store = await createStore();

  if (practising) {
    const { seedSampleFarm } = await import('./sample.js');
    await seedSampleFarm(store);
  }
  const ctx = await startShell(store);
  window.__douvalueCtx = ctx;              // the guide's search box reaches back for this

  // Sync runs itself from here: it pushes and pulls whenever the phone has
  // signal, and quietly queues everything when it does not. Never in practice
  // mode — a training session that reached the server would put an invented
  // harvest on everybody else's phone.
  if (!practising) await startSync(store);

  if (!practising) await generateToday(ctx).catch((err) => {
    // A farm that cannot generate its schedule still has to be usable: every
    // screen works on what is already recorded.
    console.error('Could not generate today\'s tasks', err);
  });

  // Practice included: in practice mode the events are applied to the screen
  // and thrown away, so a trainee sees the store on its actives like everybody
  // else and nothing is written.
  await migrateCatalogue(ctx).catch((err) => {
    console.error('Could not match the store to the catalogue', err);
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
