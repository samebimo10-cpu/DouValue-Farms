// Offline cache.
//
// A farm hand on Bed 4 has no signal and no data left. The app must open anyway,
// so every file it needs is cached on first visit and served from the cache
// first. Network is only ever used to look for a newer copy in the background.

const CACHE = 'douvalue-v9';

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
  './js/ui/manage.js',
  './js/ui/photo.js',
  './js/ui/adviser.js',
  './js/ui/gates.js',
  './js/ui/alerts.js',
  './js/ui/zones.js',
  './js/domain/adviser.js',
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
  './js/domain/safety.js',
  './js/domain/integrity.js',
  './js/domain/predict.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
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
