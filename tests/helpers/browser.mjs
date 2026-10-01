// A real browser, driven over the Chrome DevTools Protocol.
//
// The repository has no dependencies and CI runs `npm test` without an install
// step, so this does not pull in Playwright or Puppeteer. Node 22 has
// WebSocket built in, and the protocol is a few JSON messages: start a
// headless Chrome, open a tab, evaluate in it, reload it. That is all a service
// worker test needs.
//
// Which Chrome: $CHROME_PATH if set, then the Playwright copy some machines
// carry, then whatever Chrome or Chromium is on the PATH (GitHub's Ubuntu
// runners ship Google Chrome).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KNOWN = [
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const path of KNOWN) if (existsSync(path)) return path;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchChrome(executable = findChrome()) {
  if (!executable) throw new Error('No Chrome or Chromium found; set CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'douvalue-chrome-'));
  const proc = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-background-networking', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise((resolve, reject) => {
    let err = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${err}`)), 30000);
    proc.stderr.on('data', (chunk) => {
      err += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}):\n${err}`)); });
  });

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(`${data.error.message} ${data.error.data || ''}`.trim()));
      else resolve(data.result);
    } else {
      for (const fn of listeners) fn(data);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return {
    send,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async newPage() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const page = pageOn(this, sessionId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Log.enable');
      return page;
    },
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(3000)]); } catch { /* already gone */ }
      try { ws.close(); } catch { /* closed */ }
      // Chrome is still writing into its profile as it shuts down, so wait for
      // it to go before taking the folder away — removing it underneath a live
      // process fails with ENOTEMPTY, which is the test failing for a reason
      // that has nothing to do with the app.
      const running = () => proc.exitCode === null && proc.signalCode === null;
      const exited = () => new Promise((resolve) => { if (!running()) resolve(); else proc.once('exit', resolve); });
      await Promise.race([exited(), sleep(5000)]);
      if (running()) {
        proc.kill('SIGKILL');
        await Promise.race([exited(), sleep(2000)]);
      }
      // Helper processes can outlive the browser by a moment; retry, then leave
      // a temporary folder to the OS rather than fail a test over it.
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* tmp */ }
    },
  };
}

function pageOn(browser, sessionId) {
  const send = (method, params) => browser.send(method, params, sessionId);
  const consoleLines = [];
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    }
    // A module that failed to load is reported here, not as an exception.
    if (msg.method === 'Log.entryAdded') {
      consoleLines.push(`${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
    }
  });

  const page = {
    send,
    console: consoleLines,
    /** Evaluate an expression in the page, awaiting a promise if it returns one. */
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    },
    /**
     * Poll until `expression` is truthy. A navigation in between destroys the
     * context the last poll ran in; that is retried, not reported.
     */
    async waitFor(expression, { timeout = 30000, what = expression } = {}) {
      const until = Date.now() + timeout;
      let last = null;
      while (Date.now() < until) {
        try {
          const value = await page.evaluate(expression);
          if (value) return value;
        } catch (err) { last = err; }
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${what}${last ? ` (last error: ${last.message})` : ''}`
        + `\nPage console:\n${consoleLines.join('\n') || '(nothing)'}`);
    },
    goto: (url) => send('Page.navigate', { url }),
    reload: () => send('Page.reload', { ignoreCache: false }),
  };
  return page;
}
