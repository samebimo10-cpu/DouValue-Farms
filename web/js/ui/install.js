// "Install this app" — NFR-DEV-01.
//
// The requirement says the app runs on the farm's phones as an installable web
// app. Installable is not the same as installed. Somebody taps the link in
// WhatsApp, it opens in a browser tab, and it stays there: behind twenty other
// tabs, one swipe away from being closed, with the browser's own address bar
// eating a fifth of a small screen. On an iPhone it is worse — a Safari tab and
// the home-screen app keep separate storage, so a week of records typed into the
// tab never appear in the app installed afterwards.
//
// So the first time the app is opened in a browser, before anybody signs in or
// types anything, it stops and says: install this first. It names the steps for
// the phone in the person's hand, in the words that phone's own menus use —
// "Add to Home Screen" on an iPhone, "Install app" in Chrome — because generic
// advice ("add it to your home screen") is exactly the advice nobody follows.
// Where the browser offers its own install dialog, the step is one big button.
//
// It is a step, not a wall. "Use in the browser for now" is always there: a
// manager at an office laptop, a browser that cannot install anything, a phone
// with no room left. After that, a slim bar keeps saying the app is not
// installed, every time it is opened in a tab, until it is.
//
// The step quotes the phone's own menu labels, which are English on these
// phones whatever the app's language, so it is written in English (UX-17).
//
// Nothing here may stop the app opening. No storage, no matchMedia, an unknown
// browser: the step either shows the general instructions or does not show.

const SEEN_KEY = 'douvalue.install.seen';
const INSTALLED_KEY = 'douvalue.install.done';

// The browser's own install dialog, if it offered one. Chrome, Edge and Samsung
// Internet fire beforeinstallprompt once, early, and only to a page that is
// listening — so this is captured at module load, before the rules file or the
// store have been read, and kept until someone taps "Install".
let deferred = null;
const promptListeners = new Set();

/**
 * Start listening for the browser's install offer. Called once, as the app's
 * first line, so the event cannot fire before anybody is listening.
 */
export function captureInstallPrompt(scope = globalThis) {
  if (!scope || typeof scope.addEventListener !== 'function') return;
  scope.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's mini-infobar from appearing on top of the step; the step
    // has its own, larger button that calls the same dialog.
    event.preventDefault();
    deferred = event;
    for (const fn of promptListeners) fn(event);
  });
  scope.addEventListener('appinstalled', () => {
    deferred = null;
    remember(scope, INSTALLED_KEY);
  });
}

export function installPromptAvailable() { return Boolean(deferred); }

/** Show the browser's own install dialog. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall(scope = globalThis) {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;                          // the event can only be used once
  try {
    await event.prompt();
    const choice = await event.userChoice;
    const outcome = choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    if (outcome === 'accepted') remember(scope, INSTALLED_KEY);
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/** Test seam: forget any captured offer. */
export function resetInstallPrompt() { deferred = null; promptListeners.clear(); }

/**
 * Is the app already running as an installed app rather than in a tab?
 *
 * Three signals, because there is no one signal every phone gives: the display
 * mode from the manifest, Safari's own navigator.standalone, and the referrer an
 * Android launcher leaves when it starts a web app that was packaged as an APK.
 */
export function isStandalone(scope = globalThis) {
  try {
    const mm = scope.matchMedia;
    if (typeof mm === 'function') {
      for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
        if (mm.call(scope, `(display-mode: ${mode})`).matches) return true;
      }
    }
  } catch { /* old browser: fall through */ }
  const nav = scope.navigator || {};
  if (nav.standalone === true) return true;
  const ref = scope.document && scope.document.referrer;
  return typeof ref === 'string' && ref.startsWith('android-app://');
}

/**
 * Which set of instructions fits this browser.
 *
 * Order matters. An in-app browser (WhatsApp's, Facebook's, Instagram's) looks
 * like Chrome or Safari in its user agent but cannot install anything, so it is
 * checked first: the only useful step there is "open this in your browser".
 */
export function detectPlatform(nav = {}) {
  const ua = String(nav.userAgent || '');
  const touchMac = /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;   // iPadOS 13+
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const android = /Android/.test(ua);

  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter/i.test(ua)) return 'in-app';
  if (android && /; wv\)/.test(ua)) return 'in-app';
  if (ios && !/Safari\//.test(ua)) return 'in-app';           // WKWebView inside another app

  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (android) {
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox/.test(ua)) return 'firefox-android';
    if (/Chrome\//.test(ua)) return 'android-chrome';          // Chrome, and Edge/Opera built on it
    return 'other';
  }
  if (/Edg\/|Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'desktop';
  return 'other';
}

// The phone's own icons, drawn small, so "tap this" can show what "this" is.
const ICON = {
  share: '<svg class="inst-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dots: '<span class="inst-key" aria-hidden="true">⋮</span>',
  lines: '<span class="inst-key" aria-hidden="true">≡</span>',
  plus: '<span class="inst-key" aria-hidden="true">＋</span>',
};

/** The numbered steps for each browser, in the words its own menus use. */
export const STEPS = {
  'ios-safari': {
    name: 'iPhone or iPad (Safari)',
    steps: [
      `Tap the Share button ${ICON.share} — at the bottom of the screen on an iPhone, at the top on an iPad.`,
      'Scroll down the list and tap <b>Add to Home Screen</b>.',
      'Tap <b>Add</b> in the top corner.',
      'Close Safari and open <b>DouValue</b> from your home screen.',
    ],
    note: 'Do this before you sign in. On an iPhone, anything typed into this Safari tab stays in Safari and does not move into the app.',
  },
  'ios-other': {
    name: 'iPhone or iPad',
    steps: [
      `Tap the Share button ${ICON.share} beside the address bar.`,
      'Tap <b>Add to Home Screen</b>, then <b>Add</b>.',
      'If you do not see <b>Add to Home Screen</b>, copy this link, open it in <b>Safari</b> and do it there.',
      'Open <b>DouValue</b> from your home screen.',
    ],
    note: 'Do this before you sign in. On an iPhone, anything typed into a browser tab stays in that browser and does not move into the app.',
  },
  'android-chrome': {
    name: 'Android (Chrome)',
    steps: [
      `Tap the menu ${ICON.dots} at the top right.`,
      'Tap <b>Install app</b> (on some phones it says <b>Add to Home screen</b>).',
      'Tap <b>Install</b>.',
      'Close this tab and open <b>DouValue</b> from your home screen.',
    ],
  },
  samsung: {
    name: 'Samsung Internet',
    steps: [
      `Tap the menu ${ICON.lines} at the bottom right.`,
      'Tap <b>Add page to</b>, then <b>Home screen</b>.',
      'Tap <b>Add</b>.',
      'Close this tab and open <b>DouValue</b> from your home screen.',
    ],
  },
  'firefox-android': {
    name: 'Android (Firefox)',
    steps: [
      `Tap the menu ${ICON.dots}.`,
      'Tap <b>Install</b> (on some phones it says <b>Add to Home screen</b>).',
      'Tap <b>Add</b>.',
      'Close this tab and open <b>DouValue</b> from your home screen.',
    ],
  },
  'in-app': {
    name: 'Opened inside another app',
    steps: [
      'This page opened inside WhatsApp, Facebook or another app, which cannot install it.',
      `Tap the menu ${ICON.dots} at the top right and choose <b>Open in Chrome</b> or <b>Open in browser</b> (on an iPhone, <b>Open in Safari</b>).`,
      'Or tap <b>Copy link</b> below and paste it into Chrome (Safari on an iPhone).',
      'Then install it from there — this screen will show the steps again.',
    ],
    copy: true,
  },
  desktop: {
    name: 'Computer (Chrome or Edge)',
    steps: [
      `Click the install icon ${ICON.plus} at the right end of the address bar.`,
      'Or open the browser menu and choose <b>Install DouValue</b> (under <b>Cast, save and share</b> or <b>Apps</b>).',
      'Click <b>Install</b>.',
    ],
  },
  other: {
    name: 'This browser',
    steps: [
      'Open the browser menu.',
      'Look for <b>Install app</b> or <b>Add to Home screen</b> and tap it.',
      'If there is neither, open this link in Chrome (Android) or Safari (iPhone) instead.',
      'Open <b>DouValue</b> from your home screen.',
    ],
    copy: true,
  },
};

/**
 * Whether to show the full step, the reminder bar, or nothing.
 *
 *  - Installed and running as an app: nothing, ever.
 *  - First open in a tab: the full step.
 *  - Every later open in a tab: the bar, until it is installed.
 */
export function installState(scope = globalThis) {
  if (isStandalone(scope)) return 'app';
  return recall(scope, SEEN_KEY) ? 'reminder' : 'first';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** The full step. `canPrompt` puts the browser's own install button first. */
export function installStepHtml(platform, { canPrompt = false, installedBefore = false } = {}) {
  const guide = STEPS[platform] || STEPS.other;
  const lead = installedBefore
    ? '<p class="inst-lead">DouValue is already installed on this phone. Close this tab and open <b>DouValue</b> from your home screen.</p>'
    : '<p class="inst-lead">Put DouValue on this phone\'s home screen first. It then opens like any other app, full screen, and works with no network. Do not use it as a browser tab.</p>';
  const button = canPrompt
    ? '<button type="button" class="btn inst-go" data-act="install-now">Install DouValue</button>'
      + `<p class="inst-or">or do it by hand (${esc(guide.name)}):</p>`
    : `<p class="inst-or">${esc(guide.name)}:</p>`;
  return '<div class="inst-step" role="dialog" aria-modal="true" aria-labelledby="inst-title">'
    + '<img class="inst-mark" src="img/mark-192.png" alt="" width="72" height="72">'
    + '<h1 id="inst-title">Install this app</h1>'
    + lead
    + button
    + `<ol class="inst-list">${guide.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`
    + (guide.note ? `<p class="inst-note"><b>!</b> ${esc(guide.note)}</p>` : '')
    + (guide.copy ? '<button type="button" class="btn btn-ghost inst-copy" data-act="install-copy">Copy link</button>' : '')
    + '<button type="button" class="inst-later" data-act="install-later">Use in the browser for now</button>'
    + '</div>';
}

/** The reminder on every later open in a tab. */
export function installBarHtml() {
  return '<div class="install-bar" role="status">'
    + '<b>Not installed — you are in a browser tab</b>'
    + '<button type="button" data-act="install-show">Install</button>'
    + '<button type="button" class="later" data-act="install-hide" aria-label="Hide for now">✕</button>'
    + '</div>';
}

function remember(scope, key) {
  try { scope.localStorage.setItem(key, new Date().toISOString()); } catch { /* private window */ }
}
function recall(scope, key) {
  try { return scope.localStorage.getItem(key); } catch { return null; }
}

/**
 * Wire it to the page. Called once at boot, before sign-in; returns a function
 * that takes whatever it put up down again.
 */
export function mountInstallPrompt({ scope = globalThis } = {}) {
  const doc = scope.document;
  if (!doc || !doc.body) return () => {};
  const state = installState(scope);
  if (state === 'app') return () => {};

  const platform = detectPlatform(scope.navigator || {});
  let host = null;

  const close = () => { if (host) { host.remove(); host = null; } };

  const showStep = () => {
    close();
    host = doc.createElement('div');
    host.className = 'install-back';
    const render = () => {
      host.innerHTML = installStepHtml(platform, {
        canPrompt: installPromptAvailable(),
        installedBefore: Boolean(recall(scope, INSTALLED_KEY)),
      });
      wireStep();
    };
    const wireStep = () => {
      const on = (act, fn) => { const el = host.querySelector(`[data-act="${act}"]`); if (el) el.onclick = fn; };
      on('install-now', async () => {
        // Accepted: the step now says "open it from your home screen". Anything
        // else: the offer is spent, so the step falls back to the by-hand steps.
        await promptInstall(scope);
        render();
      });
      on('install-copy', async () => {
        const btn = host.querySelector('[data-act="install-copy"]');
        const url = String(scope.location && scope.location.href || '').split('#')[0];
        try {
          await scope.navigator.clipboard.writeText(url);
          btn.textContent = 'Link copied';
        } catch {
          btn.textContent = url;                       // nothing to copy with: show it to copy by hand
        }
      });
      on('install-later', () => {
        remember(scope, SEEN_KEY);
        close();
        showBar();
      });
    };
    render();
    // The browser's offer can arrive after the step is up; swap in the button.
    promptListeners.add(render);
    doc.body.appendChild(host);
  };

  const showBar = () => {
    close();
    promptListeners.clear();
    host = doc.createElement('div');
    host.className = 'install-host';
    host.innerHTML = installBarHtml();
    host.querySelector('[data-act="install-show"]').onclick = showStep;
    host.querySelector('[data-act="install-hide"]').onclick = close;
    // Before the update bar, so the CSS can stack the two rather than overlap them.
    doc.body.insertBefore(host, doc.body.firstChild);
  };

  if (state === 'first') showStep(); else showBar();

  return () => { promptListeners.clear(); close(); };
}
