// UX-28 — the CEO makes the sign-in; the person signs in on their own phone.
//
// Run for real: the farm server, the app served from the repository, and a
// real Chrome standing in for the manager's brand-new phone. The phone knows
// nothing but the link in the CEO's message; the sign-in name and password are
// all it takes to land on the screens of the job the CEO gave.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDir } from './helpers/site.mjs';
import { findChrome, launchChrome } from './helpers/browser.mjs';

const PORT = 8794;
const SERVER = `http://127.0.0.1:${PORT}`;
const FARM = 'farm_signin_test';

const call = async (path, { token = null, body = null } = {}) => {
  const res = await fetch(`${SERVER}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let server = null;
let dataDir = null;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'douvalue-signin-'));
  const entry = new URL('../server/node-sync.mjs', import.meta.url).pathname;
  server = spawn(process.execPath, [entry, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${SERVER}/`)).ok) return; } catch { /* still coming up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('farm server did not start');
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('UX-28: the app has a sign-in page, and the farm address can be set once for every phone', () => {
  const shell = readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /Welcome to the DouValue farm management app/);
  assert.match(shell, /Kindly sign in\./);
  assert.match(shell, /if \(!people\.length\) return signInScreen\(state\);/,
    'a phone nobody has used opens on sign-in, not on setting up a farm');
  const address = readFileSync(new URL('../web/js/farm-address.js', import.meta.url), 'utf8');
  assert.match(address, /export const FARM_SERVER = '/);
});

const chrome = findChrome();
const skip = !chrome && !process.env.CI ? 'no Chrome or Chromium on this machine (set CHROME_PATH)' : false;

test('UX-28: a manager signs in on a new phone and lands on the manager\'s screens', { skip, timeout: 120000 }, async () => {
  // The CEO's side, through the same API the CEO's phone uses.
  const ceo = await call(`/api/farms/${FARM}/bootstrap`, {
    body: { name: 'Ebimo Sam', password: '4821', farmName: 'DouValue Farms Limited', memberId: 'person_ceo' },
  });
  assert.equal(ceo.status, 200);
  const made = await call(`/api/farms/${FARM}/account`, {
    token: ceo.body.token, body: { name: 'Chidi Okafor', role: 'manager', login: 'chidi', password: '482913' },
  });
  assert.equal(made.status, 200);

  const site = await serveDir();
  const browser = await launchChrome(chrome);
  try {
    const page = await browser.newPage();
    // The link in the CEO's message: the app, with the farm's address filled in.
    await page.goto(`${site.url}web/#/signin?s=${encodeURIComponent(SERVER)}`);
    await page.waitFor("!!document.querySelector('form[data-act=\"do-signin\"]')", { what: 'the sign-in page' });

    const page1 = await page.evaluate("document.getElementById('app').textContent");
    assert.match(page1, /Welcome to the DouValue farm management app/);
    assert.equal(await page.evaluate("document.querySelector('input[name=url]').value"), SERVER,
      'the address came from the link');

    const submit = (login, password) => page.evaluate(`(() => {
      const form = document.querySelector('form[data-act="do-signin"]');
      form.querySelector('input[name=login]').value = ${JSON.stringify(login)};
      form.querySelector('input[name=password]').value = ${JSON.stringify(password)};
      form.requestSubmit();
      return true;
    })()`);

    await submit('chidi', '000000');
    await page.waitFor("(document.querySelector('.toast') || {}).textContent?.includes('not right')",
      { what: 'a wrong password to be refused' });

    await submit('Chidi', '482913');
    await page.waitFor("window.__douvalueCtx && window.__douvalueCtx.user && location.hash === '#/dashboard'",
      { what: 'the manager to land on their home screen', timeout: 60000 });
    const user = await page.evaluate('({ name: __douvalueCtx.user.name, role: __douvalueCtx.user.role })');
    assert.deepEqual(user, { name: 'Chidi Okafor', role: 'manager' });

    // Next morning: the phone remembers them, and asks only for the password.
    await page.evaluate("sessionStorage.removeItem('douvalue.user'); window.__beforeReload = true");
    await page.reload();
    await page.waitFor("!window.__beforeReload && document.getElementById('app').textContent.includes('Enter your password')",
      { what: 'the phone to open on its own person\'s lock screen' });
    const lock = await page.evaluate("document.getElementById('app').textContent");
    assert.match(lock, /Chidi Okafor/);
    assert.doesNotMatch(lock, /Who are you\?/, 'not a list of everyone on the farm');
  } finally {
    await browser.close();
    await site.stop();
  }
});
