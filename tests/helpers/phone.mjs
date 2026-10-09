// A phone, for FR-SIMP-08: the app served from the repository, opened in a
// real Chrome at 360 px wide as an installed app, with the sample farm loaded
// and one person signed in.
//
// 360 × 740 CSS pixels is the screen of the low-cost Androids the farm buys
// (NFR-DEV-01): 360 wide is the narrowest common width, and 740 tall is what is
// left of it once the phone's own status and navigation bars are drawn.

import assert from 'node:assert/strict';
import { serveDir } from './site.mjs';
import { findChrome, launchChrome } from './browser.mjs';

export const PHONE = { width: 360, height: 740 };

export const chrome = findChrome();
export const skip = !chrome && !process.env.CI ? 'no Chrome or Chromium on this machine (set CHROME_PATH)' : false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPhone() {
  const site = await serveDir();
  const browser = await launchChrome(chrome);
  const page = await browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: PHONE.width, height: PHONE.height, deviceScaleFactor: 1, mobile: true,
  });
  // Installed, not a tab: the install step never covers an installed app.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'const mm = window.matchMedia.bind(window); window.matchMedia = (q) => '
      + '/display-mode: standalone/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q);',
  });
  await page.goto(`${site.url}web/`);
  await page.waitFor('window.__douvalueCtx', { what: 'the app to start' });
  await page.evaluate(`(async () => {
    const m = await import('./js/sample.js');
    await m.seedSampleFarm(window.__douvalueCtx.store);
    return true;
  })()`);

  return {
    page,
    /** Sign in as `personId` and open `hash`, as a fresh start of the app. */
    async as(personId, hash) {
      await page.evaluate(`sessionStorage.setItem('douvalue.user', ${JSON.stringify(personId)}); true`);
      await page.goto(`${site.url}web/${hash}`);
      await page.reload();
      await page.waitFor(`window.__douvalueCtx && window.__douvalueCtx.user && window.__douvalueCtx.user.id === ${JSON.stringify(personId)}`,
        { what: `${personId} to be signed in` });
      // Today's work is generated on open; let it land, then go to the screen
      // the way a tap on a link does (signing in lands on the role's home).
      await sleep(500);
      await page.evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
      await page.waitFor(`document.querySelector('#app .card')`, { what: 'the screen' });
      await sleep(400);
    },
    /** Fire a data-act on the page, as a tap would. */
    async tap(selector) {
      await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('nothing at ' + ${JSON.stringify(selector)}); el.click(); return true; })()`);
      await sleep(400);
    },
    /**
     * Where the main action is, without scrolling: on the screen, and not
     * under the tab bar or anything else drawn on top of it.
     */
    async mainAction(selector = '[data-main-action]') {
      return page.evaluate(`(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('.sheet').forEach((s) => { s.scrollTop = 0; });
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = all.find((e) => e.offsetParent !== null) || all[0];
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + Math.min(r.height / 2, 20);
        const hit = document.elementFromPoint(x, y);
        return {
          found: true, label: el.textContent.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom),
          height: innerHeight, width: innerWidth,
          onTop: !!hit && (hit === el || el.contains(hit)),
          inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      })()`);
    },
    /** Run an expression in the page and return its value. */
    evaluate: (expression) => page.evaluate(expression),
    /** The control names of the open sheet's form, in order. */
    async sheetControls() {
      return page.evaluate(`[...document.querySelectorAll('.sheet form input, .sheet form select, .sheet form textarea')]
        .map((e) => e.name).filter(Boolean)`);
    },
    /** Attach a picture to the photo control on screen, as the camera would. */
    async attachPhoto(scope = 'document') {
      await page.evaluate(`(async () => {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 64, 64);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
        const file = new File([blob], 'leaf.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        const input = ${scope}.querySelector('.photo-input');
        const dt = new DataTransfer(); dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
        return true;
      })()`);
      await page.waitFor(`!!${scope}.querySelector('#photo-preview img')`, { what: 'the photo to attach' });
    },
    async close() { await browser.close(); await site.stop(); },
  };
}

/** FR-SIMP-08: the main action is drawn on the screen, uncovered, with no sideways scroll. */
export function assertReachable(where, at) {
  assert.ok(at.found, `${where}: no main action on the screen`);
  assert.ok(at.inView, `${where}: "${at.label}" is at ${at.top}–${at.bottom} px; the screen is ${at.height} px tall`);
  assert.ok(at.onTop, `${where}: "${at.label}" is covered by something drawn over it`);
  assert.equal(at.width, PHONE.width);
  assert.ok(at.scrollWidth <= PHONE.width, `${where}: the page scrolls sideways (${at.scrollWidth} px)`);
}
