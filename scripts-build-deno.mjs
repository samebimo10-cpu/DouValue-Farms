// Builds server/deno-sync.ts: core.mjs with a Deno KV adapter welded on.
//
// Deno Deploy's Playground takes one pasted file, so the core cannot be an
// import. Generating the file keeps a single source of truth and makes the
// paste-one-file setup honest: the test suite fails if it drifts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(join(here, 'server/core.mjs'), 'utf8')
  .replace(/^export (const|function|async function|class) /gm, '$1 ')
  .replace(/^export \{[^}]*\};?$/gm, '');

const header = `// DouValue farm server, for Deno Deploy.
//
// GENERATED FILE. Do not edit here: change server/core.mjs and run
//   node scripts-build-deno.mjs
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

// Opened on the first request, not at boot. If the database cannot be opened
// (no Deno KV database assigned to the app, or KV not switched on), a crash at
// boot fails the deploy with nothing to see. This way the deploy succeeds and
// every request answers 503 with the reason, readable in a phone's browser.
let kv = null;

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

Deno.serve(async (req) => {
  if (!kv) {
    try {
      kv = await Deno.openKv();
    } catch (err) {
      return json({
        error: 'The farm server cannot open its database, so it is not storing anything yet.',
        detail: String((err && err.message) || err),
        fix: 'In Deno Deploy, open this app, go to Databases, create a Deno KV database and assign it to this app. '
          + 'Also check that deno.json with "unstable": ["kv"] sits next to main.ts.',
      }, 503);
    }
  }
  return handleRequest(req, store);
});
`;

const built = header + core + adapter;
writeFileSync(join(here, 'server/deno-sync.ts'), built);

// A second copy under deploy/, named main.ts, so Deno Deploy's "clone this
// folder" flow finds it by convention with nothing to configure. That folder
// holds only the server on purpose: pointed at it, the clone produces a small
// repository containing the server and nothing else.
mkdirSync(join(here, 'server/deploy'), { recursive: true });
writeFileSync(join(here, 'server/deploy/main.ts'), built);
// Deno.openKv is still behind the kv unstable flag in Deno 2. The Playground
// turns it on by itself; a repository deploy does not, and without this file
// the server dies at boot with "Deno.openKv is not a function".
writeFileSync(join(here, 'server/deploy/deno.json'), `{
  "unstable": ["kv"]
}
`);
writeFileSync(join(here, 'server/deploy/README.md'), `# DouValue farm sync server

GENERATED. Do not edit \`main.ts\` here: change \`../core.mjs\` and run

    node scripts-build-deno.mjs

This folder exists so it can be deployed on its own. \`main.ts\` is the whole
server and the entry point. \`deno.json\` turns on Deno KV, which the server
stores everything in; without it the deploy fails at boot with
"Deno.openKv is not a function". Keep both files together.

On Deno Deploy, also create a Deno KV database under Databases and assign it
to the app.

The farm app then connects to whatever address the deployment is given, under
Settings, Sync, Connect the farm.
`);

console.log('server/deno-sync.ts and server/deploy/{main.ts,deno.json} rebuilt from server/core.mjs');
