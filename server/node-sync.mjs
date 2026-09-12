#!/usr/bin/env node
/**
 * DouValue farm sync server, self-hosted edition.
 *
 * The same contract as server/deno-sync.ts, for anyone who would rather run it
 * on their own box, a VPS, or a Raspberry Pi in the farm office. Events are held
 * in one append-only JSON-lines file per farm, which means a backup is a file
 * copy and a recovery is putting the file back.
 *
 *   node douvalue/server/node-sync.mjs --port 8787 --data ./farm-data
 *
 * Security model, stated plainly: one shared farm key guards one farm. Anyone
 * holding the join code can read and write that farm's records. Put it behind
 * HTTPS before exposing it beyond the farm's own network.
 */

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg('port', process.env.PORT || 8787));
const DATA_DIR = resolve(arg('data', process.env.DATA_DIR || './farm-data'));
const MAX_EVENTS_PER_PUSH = 1000;
const MAX_BODY_BYTES = 5_000_000;
const MAX_PULL = 1000;

mkdirSync(DATA_DIR, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function sameSecret(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** In-memory view of a farm, loaded from disk once and kept current on write. */
const farms = new Map();

function farmPaths(farmId) {
  return { meta: join(DATA_DIR, `${farmId}.meta.json`), log: join(DATA_DIR, `${farmId}.events.jsonl`) };
}

function loadFarm(farmId) {
  if (farms.has(farmId)) return farms.get(farmId);
  const paths = farmPaths(farmId);
  if (!existsSync(paths.meta)) return null;

  const meta = JSON.parse(readFileSync(paths.meta, 'utf8'));
  const events = [];
  const ids = new Set();
  if (existsSync(paths.log)) {
    for (const line of readFileSync(paths.log, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && event.id && !ids.has(event.id)) { ids.add(event.id); events.push(event); }
      } catch { /* a torn last line after a power cut: skip it, keep the rest */ }
    }
  }
  const farm = { meta, events, ids, paths };
  farms.set(farmId, farm);
  return farm;
}

function createFarm(farmId, keyHash) {
  const paths = farmPaths(farmId);
  const meta = { keyHash, created: new Date().toISOString() };
  writeFileSync(paths.meta, JSON.stringify(meta, null, 2));
  const farm = { meta, events: [], ids: new Set(), paths };
  farms.set(farmId, farm);
  return farm;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (!parts.length) {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS });
    res.end('DouValue farm sync server is running.\n\nPut this URL into the app under Settings, Sync.\n');
    return;
  }
  if (parts[0] !== 'api' || parts[1] !== 'farms' || !parts[2]) return send(res, 404, { error: 'Not found' });

  const farmId = decodeURIComponent(parts[2]);
  if (!safeId(farmId)) return send(res, 400, { error: 'Bad farm id' });
  const action = parts[3] || '';

  const header = req.headers.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key || key.length < 8) return send(res, 401, { error: 'Missing farm key' });
  const keyHash = sha256(key);

  // A farm that does not exist yet is claimed by the first key presented. The
  // farm id is random and only travels inside a join code, so whoever sets the
  // farm up owns it and nobody else can join without that code.
  let farm = loadFarm(farmId) || createFarm(farmId, keyHash);
  if (!sameSecret(farm.meta.keyHash, keyHash)) return send(res, 403, { error: 'Wrong farm key' });

  if (action === 'health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true, farmId, events: farm.events.length, cursor: farm.events.length, since: farm.meta.created,
    });
  }

  if (action === 'events' && req.method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0) || 0);
    const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit') || 500) || 500));
    const slice = farm.events.slice(since, since + limit);
    return send(res, 200, {
      events: slice,
      cursor: since + slice.length,
      more: since + slice.length < farm.events.length,
      total: farm.events.length,
    });
  }

  if (action === 'events' && req.method === 'POST') {
    let raw;
    try { raw = await readBody(req); }
    catch { return send(res, 413, { error: 'That batch is too large' }); }

    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Body was not valid JSON' }); }
    const incoming = Array.isArray(body.events) ? body.events : [];
    if (incoming.length > MAX_EVENTS_PER_PUSH) return send(res, 413, { error: 'Too many events in one push' });

    let accepted = 0, skipped = 0;
    const lines = [];
    for (const event of incoming) {
      if (!event || typeof event.id !== 'string' || !event.id || farm.ids.has(event.id)) { skipped++; continue; }
      farm.ids.add(event.id);
      farm.events.push(event);
      lines.push(JSON.stringify(event));
      accepted++;
    }
    // One append, then the write is durable before the client is told it landed.
    if (lines.length) appendFileSync(farm.paths.log, lines.join('\n') + '\n');

    return send(res, 200, { accepted, skipped, total: farm.events.length, cursor: farm.events.length });
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`DouValue sync server listening on http://localhost:${PORT}`);
  console.log(`Storing farm data in ${DATA_DIR}`);
});
