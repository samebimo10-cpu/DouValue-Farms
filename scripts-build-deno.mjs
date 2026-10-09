// Builds server/deno-sync.ts: core.mjs, the app modules it judges records
// with, and a Deno KV adapter, in one file.
//
// Deno Deploy's Playground takes one pasted file, so nothing can be an import.
// Generating the file keeps a single source of truth and makes the
// paste-one-file setup honest: the test suite fails if it drifts.
//
// The farm server judges the gates with the app's own code (server/judge.mjs),
// so the app modules that code reaches come along. No bundler package: this
// repository has no dependencies. The modules are plain ES modules written one
// way — named imports, `export function` / `export const`, `export { x }` — and
// each becomes a function with its exports as getters, evaluated in the order
// ES modules evaluate them. Two of them import each other; the getters, and a
// second binding pass once everything has loaded, are what make that work.
// tests/deno-bundle.test.mjs loads the result and runs the gates through it.
//
// The rules JSON is not bundled: CLAUDE.md allows one copy. The server loads
// it at boot from beside the file, from RULES_URL, or from the farm's site.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, 'server/core.mjs');
const PUBLISHED_RULES = 'https://samebimo10-cpu.github.io/DouValue-Farms/rules/douvalue_rules_rev5_1.json';

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)';?[ \t]*$/gm;
const ANY_IMPORT = /^import\b/m;
const name = (file) => relative(here, file).split('\\').join('/');

function parse(file) {
  const source = readFileSync(file, 'utf8');
  const imports = [];
  const body = source.replace(IMPORT, (_, names, spec) => {
    imports.push({
      from: resolve(dirname(file), spec),
      names: names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => {
        const [imported, local = imported] = n.split(/\s+as\s+/).map((x) => x.trim());
        return { imported, local };
      }),
    });
    return '';
  });
  if (ANY_IMPORT.test(body)) throw new Error(`${name(file)}: an import this builder cannot read`);
  return { file, source: body, imports };
}

/** Every module the entry reaches, in the order ES modules evaluate them. */
function graph(entry) {
  const done = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (file) => {
    if (done.has(file) || visiting.has(file)) return;   // visiting: a cycle, as in ESM
    visiting.add(file);
    const mod = parse(file);
    for (const dep of mod.imports) visit(dep.from);
    visiting.delete(file);
    done.add(file);
    order.push(mod);
  };
  visit(entry);
  return order;
}

/** Take `export` off the declarations and say which names it was on. */
function unexport(source) {
  const names = [];
  let out = source.replace(/^export (async function|function|const|let|class) ([A-Za-z_$][\w$]*)/gm, (_, kind, id) => {
    names.push({ exported: id, local: id });
    return `${kind} ${id}`;
  });
  out = out.replace(/^export \{([^}]*)\};?[ \t]*$/gm, (_, list) => {
    for (const n of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, exported = local] = n.split(/\s+as\s+/).map((x) => x.trim());
      names.push({ exported, local });
    }
    return '';
  });
  if (/^export\b/m.test(out)) throw new Error('an export this builder cannot read');
  return { body: out, names };
}

function bindings(mod) {
  return mod.imports.map(({ from, names }) => {
    const locals = names.map((n) => n.local);
    const assigns = names.map((n) => `(m) => { ${n.local} = m.${n.imported}; }`).join(', ');
    return { decl: `let ${locals.join(', ')};`, bind: `__dvImport(${JSON.stringify(name(from))}, ${assigns});` };
  });
}

function wrap(mod) {
  const { body, names } = unexport(mod.source);
  const getters = names.map((n) => `  ${JSON.stringify(n.exported)}: { enumerable: true, get: () => ${n.local} },`).join('\n');
  const links = bindings(mod);
  // Async and awaited in turn, because a module may await at its top level
  // (domain/diagnose.js reads the rules as it loads), exactly as in ESM.
  return `
// ─── ${name(mod.file)} ${'─'.repeat(Math.max(0, 70 - name(mod.file).length))}
await (async function (__dvExports) {
Object.defineProperties(__dvExports, {
${getters}
});
${links.map((l) => l.decl).join('\n')}
${links.map((l) => l.bind).join('\n')}
${body.trim()}
})(__dvModule(${JSON.stringify(name(mod.file))}));
__dvBindAll();
${name(mod.file) === 'web/js/rules.js' ? RULES_PRELOAD : ''}`;
}

// The rule book has to be in before domain/diagnose.js loads, because that
// module builds its cards from it as it loads. Node's file read covers a
// repository deploy; the addresses cover the copy imported from the farm's
// site, RULES_URL and the paste-one-file route. Without it the server does
// not start, rather than starting with gates that pass everything.
const RULES_PRELOAD = `
// ─── the rule book, before anything reads it ─────────────────────────────
await (async () => {
  const rules = __dvModule("web/js/rules.js");
  if (rules.rulesLoaded()) return;
  try { await rules.loadRules(); return; } catch { /* not on disk beside this file */ }
  let fromEnv = null;
  try { fromEnv = Deno.env.get("RULES_URL") || null; } catch { /* no env access */ }
  for (const url of [fromEnv, new URL("../rules/douvalue_rules_rev5_1.json", import.meta.url).href, ${JSON.stringify(PUBLISHED_RULES)}]) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) { rules.setRules(await res.json()); return; }
    } catch { /* the next address */ }
  }
  throw new Error("The farm server could not read its rule book (rules/douvalue_rules_rev5_1.json). "
    + "Set RULES_URL to where it is published, then deploy again.");
})();
`;

const modules = graph(ENTRY);
const entry = modules.pop();
const entryLinks = bindings(entry);
const entryBody = unexport(entry.source).body;

const header = `// DouValue farm server, for Deno Deploy.
//
// GENERATED FILE. Do not edit here: change server/core.mjs (or the app modules
// it judges with) and run
//   node scripts-build-deno.mjs
//
// To run it, with no command line and no card:
//   1. Open https://dash.deno.com and create a new Playground.
//   2. Paste this whole file in.
//   3. Press Save & Deploy and copy the address it gives you.
//   4. Put that address into the app when the CEO sets the farm up.
//
// Storage is Deno KV, which is built in and persistent. The rules are read at
// boot from beside this file, from the RULES_URL environment variable, or from
// the farm's published site (${PUBLISHED_RULES}).
//
// Contents: the app modules the farm server judges records with
// (server/judge.mjs: the gates, the waiting periods, the proof photos), each
// in its own scope, then server/core.mjs, then the storage adapter.
`;

const prelude = `
// --- The app's modules, one scope each --------------------------------------
const __dvModules = new Map();
const __dvBinders = [];
function __dvModule(id) {
  if (!__dvModules.has(id)) __dvModules.set(id, {});
  return __dvModules.get(id);
}
function __dvImport(id, ...assigns) {
  const m = __dvModule(id);
  for (const assign of assigns) {
    __dvBinders.push(() => assign(m));
    try { assign(m); } catch { /* a module still loading: bound again below */ }
  }
}
function __dvBindAll() {
  for (const bind of __dvBinders) { try { bind(); } catch { /* still loading */ } }
}
`;

const core = `
// ─── server/core.mjs ───────────────────────────────────────────────────────
${entryLinks.map((l) => l.decl).join('\n')}
${entryLinks.map((l) => l.bind).join('\n')}
__dvBindAll();
${entryBody.trim()}
`;

const adapter = `

// --- Storage on Deno KV ----------------------------------------------------

const kv = await Deno.openKv();

const store = {
  async getFarm(farmId) { return (await kv.get(["farm", farmId, "meta"])).value; },
  async setFarm(farmId, farm) {
    await kv.set(["farm", farmId, "meta"], farm);
    await kv.set(["farms", farmId], true);
  },
  // Every farm this server holds, for the nightly record checks. The index is
  // written on setFarm and on every push, so farms made before it existed join
  // it the first time a phone syncs.
  async listFarms() {
    const out = [];
    for await (const e of kv.list({ prefix: ["farms"] })) out.push(e.key[1]);
    return out;
  },

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

  async getLoginIndex(login) { return (await kv.get(["login", login])).value; },
  async setLoginIndex(login, rec) { await kv.set(["login", login], rec); },
  async deleteLoginIndex(login) { await kv.delete(["login", login]); },

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
    if (events.length) await kv.set(["farms", farmId], true);
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

// --- The rule book ----------------------------------------------------------
// Beside this file on a repository deploy, beside it again when imported from
// the farm's site (server/deno-entry.js sits next to rules/), then RULES_URL,
// then the published copy. Loaded now so the first push does not wait for it.
let rulesUrl = null;
try { rulesUrl = Deno.env.get("RULES_URL") || null; } catch { /* no env access */ }
rulesFrom(rulesUrl, new URL("../rules/douvalue_rules_rev5_1.json", import.meta.url).href, ${JSON.stringify(PUBLISHED_RULES)});
await serverRules();

// FR-XCHK-01: the record checks, once a night per farm, from 02:00 farm time.
// Hourly, so a missed run is caught up. Deno Deploy runs Deno.cron; elsewhere
// it needs the cron unstable flag, which deno.json turns on.
if (typeof Deno.cron === "function") {
  Deno.cron("record checks", "5 * * * *", async () => {
    await runDueChecks(store, await store.listFarms());
  });
}

Deno.serve((req) => handleRequest(req, store));
`;

const built = header + prelude + modules.map(wrap).join('') + core + adapter;
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
  "unstable": ["kv", "cron"]
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

The server judges plantings, sprays, harvests and proof photos against the
farm's rule book, which it reads at boot from the farm's published site
(${PUBLISHED_RULES}). Set the environment variable RULES_URL to read it from
somewhere else. Until it has the rules, those records wait on the phones.

The farm app then connects to whatever address the deployment is given, under
Settings, Sync, Connect the farm.
`);

console.log(`server/deno-sync.ts and server/deploy/{main.ts,deno.json} rebuilt from server/core.mjs `
  + `and ${modules.length} app modules`);
