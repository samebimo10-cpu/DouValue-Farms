// Builds server/deno-sync.ts: core.mjs with a Deno KV adapter welded on.
//
// Deno Deploy's Playground takes one pasted file, so the core cannot be an
// import. Generating the file keeps a single source of truth and makes the
// paste-one-file setup honest: the test suite fails if it drifts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(join(here, 'server/core.mjs'), 'utf8')
  .replace(/^export (const|function|async function|class) /gm, '$1 ')
  .replace(/^export \{[^}]*\};?$/gm, '');

const header = `// DouValue farm server, for Deno Deploy.
//
// GENERATED FILE. Do not edit here: change server/core.mjs and run
//   node douvalue/scripts-build-deno.mjs
//
// To run it, with no command line and no card:
//   1. Open https://dash.deno.com and create a new Playground.
//   2. Paste this whole file in.
//   3. Press Save & Deploy and copy the address it gives you.
//   4. Put that address into the app when the CEO sets the farm up.
//
// Storage is Deno KV, which is built in and persistent.
`;

const adapter = `

// --- Storage on Deno KV ----------------------------------------------------

const kv = await Deno.openKv();

const store = {
  async getFarm(farmId) { return (await kv.get(["farm", farmId, "meta"])).value; },
  async setFarm(farmId, farm) { await kv.set(["farm", farmId, "meta"], farm); },

  async getMember(farmId, memberId) { return (await kv.get(["farm", farmId, "member", memberId])).value; },
  async listMembers(farmId) {
    const out = [];
    for await (const e of kv.list({ prefix: ["farm", farmId, "member"] })) out.push(e.value);
    return out;
  },
  async setMember(farmId, member) { await kv.set(["farm", farmId, "member", member.id], member); },

  async getInviteIndex(lookup) { return (await kv.get(["invite", lookup])).value; },
  async setInviteIndex(lookup, rec) { await kv.set(["invite", lookup], rec); },
  async deleteInviteIndex(lookup) { await kv.delete(["invite", lookup]); },

  async getToken(digest) { return (await kv.get(["token", digest])).value; },
  async setToken(digest, rec) { await kv.set(["token", digest], rec); },
  async touchToken(digest, at) {
    const cur = (await kv.get(["token", digest])).value;
    if (cur) await kv.set(["token", digest], { ...cur, lastSeen: at });
  },
  async deleteTokensFor(farmId, memberId) {
    for await (const e of kv.list({ prefix: ["token"] })) {
      const rec = e.value;
      if (rec && rec.farmId === farmId && rec.memberId === memberId) await kv.delete(e.key);
    }
  },

  async appendEvents(farmId, events) {
    const countKey = ["farm", farmId, "count"];
    let accepted = 0, skipped = 0;
    for (const event of events) {
      let placed = false;
      for (let attempt = 0; attempt < 5 && !placed; attempt++) {
        const current = await kv.get(countKey);
        const seq = (current.value || 0) + 1;
        const result = await kv.atomic()
          .check({ key: ["farm", farmId, "ev", event.id], versionstamp: null })
          .check({ key: countKey, versionstamp: current.versionstamp })
          .set(["farm", farmId, "ev", event.id], seq)
          .set(["farm", farmId, "seq", seq], event)
          .set(countKey, seq)
          .commit();
        if (result.ok) { accepted++; placed = true; break; }
        if ((await kv.get(["farm", farmId, "ev", event.id])).value !== null) { skipped++; placed = true; }
      }
      if (!placed) skipped++;
    }
    return { accepted, skipped, cursor: (await kv.get(countKey)).value || 0 };
  },

  async listEvents(farmId, since, limit) {
    const out = [];
    let cursor = since;
    const iter = kv.list({
      start: ["farm", farmId, "seq", since + 1],
      end: ["farm", farmId, "seq", Number.MAX_SAFE_INTEGER],
    }, { limit });
    for await (const entry of iter) { out.push(entry.value); cursor = Number(entry.key[3]); }
    return { events: out, cursor, more: out.length === limit };
  },

  async countEvents(farmId) { return (await kv.get(["farm", farmId, "count"])).value || 0; },
};

Deno.serve((req) => handleRequest(req, store));
`;

writeFileSync(join(here, 'server/deno-sync.ts'), header + core + adapter);
console.log('server/deno-sync.ts rebuilt from server/core.mjs');
