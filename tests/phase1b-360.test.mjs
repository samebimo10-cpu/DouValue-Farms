// Phase 1b in a real Chrome at 360 px: the PIN pad locks after five wrong
// tries (NFR-SEC-02), an idle phone signs out and the waking tap presses
// nothing (NFR-SEC-06), and My work says whether your records are in.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

const opts = { skip, timeout: 120000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastToast = () => phone.evaluate(`(document.querySelector('.toast') || {}).textContent || ''`);

async function typePin(pin) {
  for (const k of pin) await phone.tap(`[data-act="pin-key"][data-key="${k}"]`);
  await phone.tap('[data-act="pin-ok"]');
  await sleep(300);
}

test('five wrong PINs lock the pad; the right PIN is then refused too, until the lock ends', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.evaluate(`(async () => { (await import('./js/db.js')).setMeta('pinTries', {}); return true; })()`);
  await phone.tap('[data-act="open-account"]');
  await phone.tap('.sheet [data-act="sign-out"]');
  await phone.tap('[data-act="pick-person"][data-id="sp_blessing"]');
  for (let i = 0; i < 4; i++) await typePin('9999');
  assert.match(await lastToast(), /1 try left/);
  await typePin('9999');
  assert.match(await lastToast(), /Too many wrong tries\. Wait 15 minutes/);
  await typePin('1234');
  assert.match(await lastToast(), /Too many wrong tries/, 'the right PIN does not open a locked pad');
  assert.equal(await phone.evaluate('!!(__douvalueCtx.user)'), false);

  // Reopening the app does not reset it.
  await phone.page.reload();
  await phone.page.waitFor('window.__douvalueCtx', { what: 'the app' });
  await sleep(400);
  await phone.tap('[data-act="pick-person"][data-id="sp_blessing"]');
  await typePin('1234');
  assert.match(await lastToast(), /Too many wrong tries/);

  // Another person on the same shared phone is not locked out by it.
  await phone.tap('[data-act="pin-cancel"]');
  await phone.tap('[data-act="pick-person"][data-id="sp_emeka"]');
  await typePin('1234');
  assert.equal(await phone.evaluate('__douvalueCtx.user && __douvalueCtx.user.id'), 'sp_emeka');
});

test('ten idle minutes: the next tap signs the phone out and does not press the button under it', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.evaluate(`sessionStorage.setItem('douvalue.lastActive', String(Date.now() - 11 * 60000)); true`);
  // A listener where the app's own tap handler listens: the waking tap must
  // never reach it, whatever button it landed on.
  await phone.evaluate(`window.__reached = 0; document.addEventListener('click', () => { window.__reached++; }); true`);
  // A real finger, through Chrome's own input: press on the button, lift.
  // Chrome drops a click whose pressed button was removed mid-tap, so this
  // passes in Chrome with or without the app's own guard; the guard is for
  // browsers that do deliver it, and tests/phase1b.test.mjs holds it in place.
  const at = await phone.evaluate(`(() => { const b = document.querySelector('[data-act="open-harvest"]');
    b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await phone.page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  await sleep(400);
  assert.equal(await phone.evaluate('window.__reached'), 0, 'the waking tap reached no tap handler');
  assert.equal(await phone.evaluate('!!(__douvalueCtx.user)'), false, 'signed out');
  assert.match(await lastToast(), /Signed out after 10 minutes/);
  assert.equal(await phone.evaluate(`!!document.querySelector('.sheet form')`), false, 'the harvest sheet did not open');
});

test('nine idle minutes: the tap works as normal', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.evaluate(`sessionStorage.setItem('douvalue.lastActive', String(Date.now() - 9 * 60000)); true`);
  await phone.tap('[data-act="open-harvest"]');
  assert.equal(await phone.evaluate('__douvalueCtx.user && __douvalueCtx.user.id'), 'sp_emeka');
  assert.ok(await phone.evaluate(`!!document.querySelector('.sheet form')`), 'the harvest sheet opened');
});

test('My work says where the person\'s own records stand', opts, async () => {
  await phone.as('sp_emeka', '#/today');
  const line = await phone.evaluate(`(document.querySelector('[data-moved="home.my-records"]') || {}).textContent || ''`);
  assert.match(line, /Your records are saved on this phone\. This farm has no server/);
});
