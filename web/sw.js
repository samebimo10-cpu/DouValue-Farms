// Offline cache.
//
// A farm hand on Bed 4 has no signal and no data left. The app must open anyway,
// so every file it needs is cached on first visit and served from the cache
// first. Network is only ever used to look for a newer copy in the background.

// Bumped whenever the shell changes. A phone holding an older cache discards it
// on activate rather than serving half of one version and half of another. The
// rules file is cached with it: the plan checks, the gate checks and both
// calculators are required to work with no signal (FR-DOC-03), and they cannot
// do that if their own rule book needs a network.
const CACHE = 'douvalue-v17';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './img/logo.jpg',
  './img/logo.webp',
  './img/mark.jpg',
  './img/mark-192.png',
  './css/app.css',
  './js/app.js',
  './js/sync.js',
  './js/store.js',
  './js/db.js',
  './js/util.js',
  './js/i18n.js',
  './js/sample.js',
  './js/ui/shell.js',
  './js/ui/kit.js',
  './js/ui/worker.js',
  './js/ui/field.js',
  './js/ui/audit.js',
  './js/ui/clinic.js',
  './js/ui/doctor.js',
  './js/ui/ppe.js',
  './js/ui/manage.js',
  './js/ui/photo.js',
  './js/ui/adviser.js',
  './js/ui/gates.js',
  './js/ui/alerts.js',
  './js/ui/zones.js',
  './js/ui/field-kit.js',
  './js/ui/chart.js',
  './js/ui/kpis.js',
  './js/ui/scan.js',
  './js/ui/shift.js',
  './js/ui/update.js',
  './js/rules.js',
  './js/domain/adviser.js',
  './js/domain/doctor.js',
  './js/domain/analysis.js',
  './js/domain/brief.js',
  './js/domain/gates.js',
  './js/domain/alerts.js',
  './js/domain/digest.js',
  './js/domain/proof.js',
  './js/domain/readiness.js',
  './js/domain/schedule.js',
  './js/domain/positions.js',
  './js/domain/crops.js',
  './js/domain/climate.js',
  './js/domain/pests.js',
  './js/domain/diagnose.js',
  // The source of truth itself. NFR-OFF-01: the clinic has to work on a
  // phone with no signal, and it cannot diagnose anything without this.
  '../rules/douvalue_rules_rev5_1.json',
  './js/domain/safety.js',
  './js/domain/catalogue.js',
  './js/domain/rotation.js',
  './js/domain/calc.js',
  './js/domain/integrity.js',
  './js/domain/predict.js',
  './js/domain/qr.js',
  './js/domain/shift.js',
  './js/domain/stock.js',
  './js/domain/supervision.js',
  './js/domain/farm.js',
  './js/domain/nursery.js',
];

// NFR-OFF-05 — a new version waits to be asked.
//
// skipWaiting() used to be called here, which took the new version live the
// moment it finished downloading. On this farm that means the page reloading
// under somebody halfway through a scouting note, in a greenhouse, for no
// reason they can see. So the new version installs, caches everything it needs,
// and then sits still. The app notices it waiting and shows "New version — tap
// to update"; the tap sends the message below, and only then does it take over.

// The single copy of the rules, published beside the app by
// scripts/assemble_site.sh. One file, one answer (CLAUDE.md).
//
// Two addresses, for the same reason web/js/rules.js tries two: on the
// published site the app is at the root and the rules one level below it, and
// in the repository the app is under web/ and the rules a level further up.
// Cached apart from the shell on purpose — if it is missing the app must still
// install and run, and the Farm Doctor says it has no rule book, which is a far
// better failure than no offline app at all.
const RULES = ['./rules/douvalue_rules_rev5_1.json', '../rules/douvalue_rules_rev5_1.json'];

/** Cache the rules from whichever address answers. Never fails the install. */
async function cacheRules(cache) {
  for (const url of RULES) {
    try {
      await cache.add(url);
      return;
    } catch { /* try the other address */ }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).then(() => cacheRules(cache))));
});

// The tap. Nothing else may trigger a takeover.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The weather service is the one thing worth going to the network for first.
  // If it fails, callers fall back to the built-in Port Harcourt climatology.
  if (url.hostname.endsWith('open-meteo.com')) {
    event.respondWith(fetch(request).catch(() => new Response('{}', {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })));
    return;
  }

  // The sync server lives on another origin and must always go to the network:
  // a cached reply would hand the app stale events or a stale acknowledgement.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || fromNetwork;
    }),
  );
});
