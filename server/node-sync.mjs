#!/usr/bin/env node
/**
 * DouValue farm server, self-hosted edition.
 *
 *   node douvalue/server/node-sync.mjs --port 8787 --data ./farm-data
 *
 * All the rules live in core.mjs. This file is only storage and plumbing: it
 * keeps each farm in a folder, with its records in one append-only JSON-lines
 * file, so a backup is a file copy and a recovery is putting the file back.
 *
 * Put it behind HTTPS before exposing it beyond the farm's own network. Tokens
 * and PINs travel in the request, and plain HTTP puts them on the wire in clear.
 */

import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { handleRequest } from './core.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg('port', process.env.PORT || 8787));
const DATA_DIR = resolve(arg('data', process.env.DATA_DIR || './farm-data'));
mkdirSync(DATA_DIR, { recursive: true });

const readJsonFile = (path, fallback) => {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; }
  catch { return fallback; }
};
const writeJsonFile = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));

const farmDir = (farmId) => {
  const dir = join(DATA_DIR, farmId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Loaded once per farm and kept current on write; the log is the source of truth.
const cache = new Map();

function farmState(farmId) {
  if (cache.has(farmId)) return cache.get(farmId);
  const dir = farmDir(farmId);
  const state = {
    dir,
    meta: readJsonFile(join(dir, 'farm.json'), null),
    members: readJsonFile(join(dir, 'members.json'), {}),
    events: [],
    ids: new Set(),
  };
  const logPath = join(dir, 'events.jsonl');
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && event.id && !state.ids.has(event.id)) { state.ids.add(event.id); state.events.push(event); }
      } catch { /* a torn last line after a power cut: keep the rest */ }
    }
  }
  cache.set(farmId, state);
  return state;
}

const TOKENS_PATH = join(DATA_DIR, 'tokens.json');
let tokens = readJsonFile(TOKENS_PATH, {});
const saveTokens = () => writeJsonFile(TOKENS_PATH, tokens);

// Pending invites, keyed by a digest of the code so redeeming one is a single
// lookup rather than a scan through everyone who has ever been invited.
const INVITES_PATH = join(DATA_DIR, 'invites.json');
let invites = readJsonFile(INVITES_PATH, {});
const saveInvites = () => writeJsonFile(INVITES_PATH, invites);

const store = {
  async getFarm(farmId) { return farmState(farmId).meta; },
  async setFarm(farmId, farm) {
    const s = farmState(farmId);
    s.meta = farm;
    writeJsonFile(join(s.dir, 'farm.json'), farm);
  },

  async getMember(farmId, memberId) { return farmState(farmId).members[memberId] || null; },
  async listMembers(farmId) { return Object.values(farmState(farmId).members); },
  async setMember(farmId, member) {
    const s = farmState(farmId);
    s.members[member.id] = member;
    writeJsonFile(join(s.dir, 'members.json'), s.members);
  },

  async getInviteIndex(lookup) { return invites[lookup] || null; },
  async setInviteIndex(lookup, rec) { invites[lookup] = rec; saveInvites(); },
  async deleteInviteIndex(lookup) { if (invites[lookup]) { delete invites[lookup]; saveInvites(); } },

  async getToken(digest) { return tokens[digest] || null; },
  async setToken(digest, rec) { tokens[digest] = rec; saveTokens(); },
  async touchToken(digest, at) { if (tokens[digest]) { tokens[digest].lastSeen = at; saveTokens(); } },
  async deleteTokensFor(farmId, memberId) {
    let changed = false;
    for (const [digest, rec] of Object.entries(tokens)) {
      if (rec.farmId === farmId && rec.memberId === memberId) { delete tokens[digest]; changed = true; }
    }
    if (changed) saveTokens();
  },

  async appendEvents(farmId, events) {
    const s = farmState(farmId);
    const lines = [];
    let accepted = 0, skipped = 0;
    for (const event of events) {
      if (s.ids.has(event.id)) { skipped++; continue; }
      s.ids.add(event.id);
      s.events.push(event);
      lines.push(JSON.stringify(event));
      accepted++;
    }
    // One append, and it is on disk before the phone is told the work landed.
    if (lines.length) appendFileSync(join(s.dir, 'events.jsonl'), lines.join('\n') + '\n');
    return { accepted, skipped, cursor: s.events.length };
  },

  async listEvents(farmId, since, limit) {
    const s = farmState(farmId);
    const slice = s.events.slice(since, since + limit);
    return { events: slice, cursor: since + slice.length, more: since + slice.length < s.events.length };
  },

  async countEvents(farmId) { return farmState(farmId).events.length; },
};

const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });

  let response;
  try {
    response = await handleRequest(request, store);
  } catch (err) {
    console.error('Request failed:', err);
    response = new Response(JSON.stringify({ error: 'Something went wrong on the server' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, () => {
  console.log(`DouValue farm server listening on http://localhost:${PORT}`);
  console.log(`Farm data in ${DATA_DIR}`);
  const farms = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  console.log(farms.length ? `Farms held: ${farms.join(', ')}` : 'No farms yet. The app will create one.');
});
