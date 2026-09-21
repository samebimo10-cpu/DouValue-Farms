// "New version — tap to update" — NFR-OFF-05.
//
// The requirement is two sentences: a new version reaches phones without staff
// clearing data, and the app says "New version — tap to update".
//
// The second sentence is the interesting one, because the easy way to satisfy
// the first is skipWaiting() in the service worker — take over the moment the
// new files are cached. That is what this app used to do, and on this farm it
// is the wrong behaviour. A hand is standing in GH-03 with a half-typed
// scouting note and one bar of signal; a silent takeover reloads the page under
// them and the note is gone. Worse, it happens for no reason they can see, so
// the app becomes a thing that loses your work at random.
//
// So the new version waits. It sits installed and idle until somebody taps a
// bar that says so, at a moment they choose — and because it waits, the tap is
// the only point at which anything reloads.
//
// Nothing here is allowed to fail loudly. A phone with no service worker, a
// browser that has blocked it, a registration that never updates: the app still
// opens and still works offline from whatever it cached last time.

export const UPDATE_PROMPT = 'New version — tap to update';

/** The bar itself. Plain, unmissable, and dismissible — it is not an alarm. */
export function updateBanner() {
  return '<div class="update-bar" role="status">'
    + `<b>${UPDATE_PROMPT}</b>`
    + '<button type="button" data-act="apply-update">Update</button>'
    + '<button type="button" class="later" data-act="dismiss-update" '
    + 'aria-label="Not now">Later</button>'
    + '</div>';
}

/**
 * Watch a registration for a version that is installed and waiting.
 *
 * `onReady` is called with the waiting worker, once, whenever one appears —
 * including the case where it was already waiting when the app opened, which is
 * the common one: the download finished while the phone was in somebody's
 * pocket.
 */
export function watchForUpdate(registration, onReady, { scope = globalThis } = {}) {
  if (!registration || typeof onReady !== 'function') return () => {};
  let told = false;
  const ready = (worker) => {
    if (told || !worker) return;
    told = true;
    onReady(worker);
  };

  if (registration.waiting) ready(registration.waiting);

  const onUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // "installed" with something already controlling the page means this is a
      // new version rather than the first ever install. On a first install
      // there is nothing to tell anybody about.
      const controller = scope.navigator && scope.navigator.serviceWorker
        && scope.navigator.serviceWorker.controller;
      if (installing.state === 'installed' && controller) {
        ready(registration.waiting || installing);
      }
    });
  };

  registration.addEventListener('updatefound', onUpdateFound);
  return () => registration.removeEventListener('updatefound', onUpdateFound);
}

/**
 * Take the update: tell the waiting worker to take over, and reload once it has.
 *
 * The reload is driven by controllerchange rather than by a timer, so the page
 * comes back on the new version rather than racing it.
 */
export function applyUpdate(worker, scope = globalThis) {
  if (!worker) return false;
  const sw = scope.navigator && scope.navigator.serviceWorker;
  if (sw) {
    sw.addEventListener('controllerchange', () => {
      scope.location.reload();
    }, { once: true });
  }
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/**
 * Ask the browser to look for a new version.
 *
 * On its own schedule a browser may not check for a day. This checks when the
 * app is brought back to the front and once an hour after that, which on a farm
 * phone means the new version arrives the next time somebody picks it up in
 * signal — and still never installs itself over anybody's work.
 */
export function pollForUpdate(registration, { scope = globalThis, everyMs = 3600000 } = {}) {
  if (!registration) return () => {};
  const check = () => { try { registration.update(); } catch { /* offline: try later */ } };
  const onVisible = () => { if (scope.document && !scope.document.hidden) check(); };

  const timer = setInterval(check, everyMs);
  if (scope.document) scope.document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    if (scope.document) scope.document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * The whole thing, wired to the page: watch, show the bar, and act on the tap.
 *
 * Returns the element so a caller can take it away again.
 */
export function mountUpdatePrompt(registration, { scope = globalThis } = {}) {
  let bar = null;
  const stop = watchForUpdate(registration, (worker) => {
    if (bar) return;
    bar = scope.document.createElement('div');
    bar.className = 'update-host';
    bar.innerHTML = updateBanner();
    bar.querySelector('[data-act="apply-update"]').onclick = () => {
      bar.querySelector('[data-act="apply-update"]').textContent = 'Updating…';
      applyUpdate(worker, scope);
    };
    bar.querySelector('[data-act="dismiss-update"]').onclick = () => {
      bar.remove();
      bar = null;
    };
    scope.document.body.appendChild(bar);
  }, { scope });
  const stopPoll = pollForUpdate(registration, { scope });
  return () => { stop(); stopPoll(); if (bar) bar.remove(); };
}
