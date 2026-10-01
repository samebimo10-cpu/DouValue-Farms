// The site as GitHub Pages publishes it, served from this machine.
//
// scripts/assemble_site.sh builds the directory Pages uploads. Pages then serves
// it under the repository's name, not at the root of a host:
//
//   https://samebimo10-cpu.github.io/DouValue-Farms/          the app
//   https://samebimo10-cpu.github.io/DouValue-Farms/rules/    the rules
//
// so "../rules/" from the app is /rules/ — another site, and a 404. Serving the
// assembled folder under the same /DouValue-Farms/ prefix is what makes a path
// that only works in the repository fail here the way it fails on a phone.
//
// Nothing is cached by HTTP (no-store), so when the server stops, the only
// thing that can open the app is the service worker.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = '/DouValue-Farms/';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ts': 'text/plain; charset=utf-8',
};

/** Run the real assembly script into a fresh folder. Returns that folder. */
export function assembleSite() {
  const out = mkdtempSync(join(tmpdir(), 'douvalue-site-'));
  const run = spawnSync('bash', [join(ROOT, 'scripts/assemble_site.sh'), out], { encoding: 'utf8' });
  if (run.status !== 0) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`scripts/assemble_site.sh failed:\n${run.stdout}\n${run.stderr}`);
  }
  return out;
}

/**
 * Serve `dir` under `base`. `dir` defaults to the repository itself, which is
 * the developer's layout (app at /web/, rules at /rules/).
 */
export async function serveDir(dir = ROOT, base = '/') {
  const served = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    served.push(path);
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (`${path}/` === base) { res.writeHead(301, { Location: base }); res.end(); return; }
    if (!path.startsWith(base)) return send(404, 'Not on this site');
    let rel = path.slice(base.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(normalize(dir + sep)) && file !== normalize(dir)) return send(404, 'Not on this site');
    try {
      if (!statSync(file).isFile()) return send(404, 'Not a file');
      send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
    } catch {
      send(404, 'Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: `${origin}${base}`,
    served,
    /** Stop answering at all — the phone's signal gone, not a 404. */
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * The lists the service worker caches, read out of web/sw.js itself so the test
 * checks the file that ships rather than a copy of its contents.
 */
export function workerLists(source = readFileSync(join(ROOT, 'web/sw.js'), 'utf8')) {
  const list = (name) => {
    const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`).exec(source);
    if (!m) throw new Error(`web/sw.js has no ${name} list`);
    // eslint-disable-next-line no-new-func
    return new Function(`return ${m[1]};`)();
  };
  return { SHELL: list('SHELL'), RULES: list('RULES'), SOURCES: list('SOURCES') };
}
