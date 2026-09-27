// "Install this app" — NFR-DEV-01.
//
// The app is required to run as an installable web app, and installable is not
// installed: a link tapped in WhatsApp opens a browser tab, and without a clear
// step it stays one. These tests pin the step to first open in a tab, the
// instructions to the phone in hand, and the rule that none of it can stop the
// app from opening.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  captureInstallPrompt, detectPlatform, installBarHtml, installPromptAvailable, installState,
  installStepHtml, isStandalone, mountInstallPrompt, promptInstall, resetInstallPrompt, STEPS,
} = await import(new URL('../web/js/ui/install.js', import.meta.url).href);

const swSource = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.38.109]',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 10; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
};

beforeEach(() => resetInstallPrompt());

// --- Which phone is this? ---------------------------------------------------

test('each browser gets its own instructions', () => {
  assert.equal(detectPlatform({ userAgent: UA.iphone }), 'ios-safari');
  assert.equal(detectPlatform({ userAgent: UA.ipadOs, maxTouchPoints: 5 }), 'ios-safari',
    'an iPad says it is a Mac; the touch screen gives it away');
  assert.equal(detectPlatform({ userAgent: UA.ipadOs, maxTouchPoints: 0 }), 'other', 'a real Mac is not an iPad');
  assert.equal(detectPlatform({ userAgent: UA.iphoneChrome }), 'ios-other');
  assert.equal(detectPlatform({ userAgent: UA.androidChrome }), 'android-chrome');
  assert.equal(detectPlatform({ userAgent: UA.samsung }), 'samsung');
  assert.equal(detectPlatform({ userAgent: UA.firefoxAndroid }), 'firefox-android');
  assert.equal(detectPlatform({ userAgent: UA.desktopChrome }), 'desktop');
  assert.equal(detectPlatform({ userAgent: UA.desktopFirefox }), 'other');
  assert.equal(detectPlatform({}), 'other', 'no user agent at all still gets general steps');
});

test('a link opened inside WhatsApp or Facebook is told to open a real browser first', () => {
  for (const ua of [UA.androidWebView, UA.iphoneFacebook, UA.iphoneWebView]) {
    assert.equal(detectPlatform({ userAgent: ua }), 'in-app', ua);
  }
  const html = installStepHtml('in-app');
  assert.match(html, /Open in Chrome/);
  assert.match(html, /data-act="install-copy"/, 'and a way to take the link with them');
});

// --- Installed, or a tab? ---------------------------------------------------

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

function scopeFor({ standalone = false, mode = null, storage = fakeStorage(), ua = UA.androidChrome, referrer = '' } = {}) {
  return {
    matchMedia: (q) => ({ matches: mode !== null && q === `(display-mode: ${mode})` }),
    navigator: { userAgent: ua, standalone },
    document: { referrer },
    localStorage: storage,
  };
}

test('running from the home screen is recognised on every phone', () => {
  assert.equal(isStandalone(scopeFor({ mode: 'standalone' })), true, 'Android and desktop');
  assert.equal(isStandalone(scopeFor({ standalone: true })), true, 'iPhone');
  assert.equal(isStandalone(scopeFor({ referrer: 'android-app://com.example' })), true, 'packaged APK');
  assert.equal(isStandalone(scopeFor()), false, 'a browser tab');
  assert.equal(isStandalone({}), false, 'a browser that says nothing is treated as a tab');
});

test('the step shows on first open in a tab, then a reminder, and never inside the app', () => {
  assert.equal(installState(scopeFor()), 'first');
  assert.equal(installState(scopeFor({ storage: fakeStorage({ 'douvalue.install.seen': 'x' }) })), 'reminder');
  assert.equal(installState(scopeFor({ mode: 'standalone' })), 'app');
  assert.equal(installState(scopeFor({ mode: 'standalone', storage: fakeStorage() })), 'app');
});

test('blocked storage still shows the step rather than breaking', () => {
  const s = scopeFor();
  s.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(installState(s), 'first');
});

// --- What it says -----------------------------------------------------------

test('the step is titled "Install this app" and names the phone\'s own menu items', () => {
  const ios = installStepHtml('ios-safari');
  assert.match(ios, /<h1[^>]*>Install this app<\/h1>/);
  assert.match(ios, /Add to Home Screen/);
  assert.match(ios, /stays in Safari/, 'the iPhone warning: a tab\'s records do not move into the app');
  assert.match(ios, /data-act="install-later"/, 'there is always a way past it');

  assert.match(installStepHtml('android-chrome'), /Install app/);
  assert.match(installStepHtml('samsung'), /Add page to/);
  assert.match(installStepHtml('nonsense'), /Install app/, 'an unknown platform gets the general steps');
  for (const [key, guide] of Object.entries(STEPS)) {
    assert.ok(guide.steps.length >= 3, `${key} has real steps`);
  }
});

test('where the browser can install it, the step is one button', () => {
  const html = installStepHtml('android-chrome', { canPrompt: true });
  assert.match(html, /data-act="install-now"/);
  assert.ok(html.indexOf('install-now') < html.indexOf('<ol'), 'the button comes before the by-hand steps');
  assert.doesNotMatch(installStepHtml('android-chrome'), /install-now/, 'and no dead button where it cannot');
  assert.match(installStepHtml('android-chrome', { installedBefore: true }), /already installed/);
});

test('the reminder bar says it is a browser tab, offers the step again, and cannot be hidden', () => {
  const html = installBarHtml();
  assert.match(html, /browser tab/);
  assert.match(html, /data-act="install-show"/);
  assert.doesNotMatch(html, /install-hide/, 'persistent until the app is installed');
});

test('the reminder takes its own space instead of floating over the page', () => {
  const css = readFileSync(new URL('../web/css/app.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.install-(?:host|bar)[^{}]*)\{([^}]*)\}/g)]
    .filter(([, sel]) => !/@media|print/.test(sel));
  assert.ok(rules.length >= 2, 'the bar is styled');
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /position:\s*(fixed|absolute|sticky)/, `${sel.trim()} must stay in the page flow`);
  }
  assert.doesNotMatch(css, /\.install-host\s*~/, 'nothing needs moving out of its way');
});

// --- The browser's own install dialog --------------------------------------

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => handlers.set(type, fn),
    fire: (type, event) => handlers.get(type)(event),
  };
}

test('the browser\'s install offer is caught, held, and used once', async () => {
  const scope = { ...eventTarget(), localStorage: fakeStorage() };
  captureInstallPrompt(scope);
  assert.equal(installPromptAvailable(), false);

  let prevented = false;
  let prompted = 0;
  scope.fire('beforeinstallprompt', {
    preventDefault: () => { prevented = true; },
    prompt: async () => { prompted += 1; },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });
  assert.equal(prevented, true, 'the mini-infobar is held back in favour of the step\'s button');
  assert.equal(installPromptAvailable(), true);

  assert.equal(await promptInstall(scope), 'accepted');
  assert.equal(prompted, 1);
  assert.ok(scope.localStorage.data.get('douvalue.install.done'), 'remembered, so the tab can say "already installed"');
  assert.equal(await promptInstall(scope), 'unavailable', 'the event cannot be replayed');
});

test('appinstalled from the browser menu is remembered too', () => {
  const scope = { ...eventTarget(), localStorage: fakeStorage() };
  captureInstallPrompt(scope);
  scope.fire('appinstalled', {});
  assert.ok(scope.localStorage.data.get('douvalue.install.done'));
});

// --- On the page ------------------------------------------------------------

function fakeDom() {
  const nodes = [];
  const make = () => {
    const el = {
      className: '', innerHTML: '', textContent: '',
      buttons: new Map(),
      querySelector(sel) {
        const act = /data-act="([^"]+)"/.exec(sel)[1];
        if (!this.innerHTML.includes(`data-act="${act}"`)) return null;
        if (!this.buttons.has(act)) this.buttons.set(act, { onclick: null, textContent: '' });
        return this.buttons.get(act);
      },
      remove() { const i = nodes.indexOf(el); if (i >= 0) nodes.splice(i, 1); },
    };
    const set = Object.getOwnPropertyDescriptor(el, 'innerHTML');
    let html = set.value;
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => { html = v; el.buttons.clear(); },
    });
    return el;
  };
  return {
    nodes,
    document: {
      referrer: '',
      createElement: make,
      body: {
        firstChild: null,
        appendChild: (el) => nodes.push(el),
        insertBefore: (el, before) => { assert.equal(before, null, 'ahead of everything else'); nodes.unshift(el); },
      },
    },
  };
}

test('first open in a tab: the full step goes up; "later" swaps it for the bar', () => {
  const dom = fakeDom();
  const storage = fakeStorage();
  const scope = { ...scopeFor({ storage, ua: UA.iphone }), document: dom.document };
  mountInstallPrompt({ scope });

  assert.equal(dom.nodes.length, 1);
  assert.equal(dom.nodes[0].className, 'install-back');
  assert.match(dom.nodes[0].innerHTML, /Add to Home Screen/);

  dom.nodes[0].querySelector('[data-act="install-later"]').onclick();
  assert.ok(storage.data.get('douvalue.install.seen'));
  assert.equal(dom.nodes.length, 1);
  assert.equal(dom.nodes[0].className, 'install-host');

  dom.nodes[0].querySelector('[data-act="install-show"]').onclick();
  assert.equal(dom.nodes[0].className, 'install-back', 'the bar brings the step back');
});

test('opened from the home screen: nothing goes up at all', () => {
  const dom = fakeDom();
  mountInstallPrompt({ scope: { ...scopeFor({ mode: 'standalone' }), document: dom.document } });
  assert.equal(dom.nodes.length, 0);
});

test('a later open in a tab gets the bar, not the full step', () => {
  const dom = fakeDom();
  const storage = fakeStorage({ 'douvalue.install.seen': 'x' });
  mountInstallPrompt({ scope: { ...scopeFor({ storage }), document: dom.document } });
  assert.equal(dom.nodes.length, 1);
  assert.equal(dom.nodes[0].className, 'install-host');
});

// --- Wiring -----------------------------------------------------------------

test('the app listens for the offer at load and shows the step before sign-in', () => {
  assert.match(appSource, /import \{ captureInstallPrompt, mountInstallPrompt \} from '\.\/ui\/install\.js'/);
  const capture = appSource.indexOf('captureInstallPrompt();');
  const main = appSource.indexOf('async function main()');
  assert.ok(capture > 0 && capture < main, 'captured at module load, not after the store opens');
  const body = appSource.slice(main);
  assert.ok(body.indexOf('mountInstallPrompt()') < body.indexOf('startShell('),
    'the step goes up before the sign-in screen');
});

test('the install step is in the offline cache', () => {
  assert.ok(swSource.includes("'./js/ui/install.js'"));
});
