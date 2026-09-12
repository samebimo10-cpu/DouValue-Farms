/**
 * DouValue farm sync server.
 *
 * Paste this one file into a new project at https://dash.deno.com (New Playground),
 * press Save & Deploy, and copy the URL it gives you. That URL is what goes into
 * the app under Settings -> Sync. Nothing to install, no card, free tier.
 *
 * What it does is deliberately small. The farm's data model is an append-only
 * log of events with unique ids, so the server never merges, never resolves a
 * conflict and never edits anything. It takes events it has not seen, hands back
 * events a device has not seen, and stays out of the way.
 *
 * Storage is Deno KV, which is built in and persistent.
 *
 * Security model, stated plainly: one shared farm key guards one farm. Anyone
 * holding the join code can read and write that farm's records, so treat it like
 * the key to the store room. It is not per-person authentication. What it does
 * do is keep the farm's books off the open internet, which is the thing that
 * actually matters here.
 */

const kv = await Deno.openKv();

const MAX_EVENTS_PER_PUSH = 1000;
const MAX_BODY_BYTES = 5_000_000;
const MAX_PULL = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare, so a wrong key cannot be found one character at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Meta = { keyHash: string; seq: number; created: string; events: number };

/**
 * Check the bearer key against the farm.
 *
 * A farm that does not exist yet is claimed by the first key presented. The farm
 * id is random and only ever travels inside a join code, so this is the usual
 * trust-on-first-use: whoever sets the farm up owns it, and nobody else can join
 * without the code.
 */
async function authorise(farmId: string, req: Request): Promise<
  { ok: true; meta: Meta } | { ok: false; response: Response }
> {
  const header = req.headers.get("authorization") || "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key || key.length < 8) {
    return { ok: false, response: json({ error: "Missing farm key" }, 401) };
  }

  const metaKey = ["farm", farmId, "meta"];
  const found = await kv.get<Meta>(metaKey);
  const keyHash = await sha256(key);

  if (!found.value) {
    const meta: Meta = { keyHash, seq: 0, created: new Date().toISOString(), events: 0 };
    const claimed = await kv.atomic().check({ key: metaKey, versionstamp: null }).set(metaKey, meta).commit();
    if (!claimed.ok) {
      const again = await kv.get<Meta>(metaKey);
      if (!again.value || !sameSecret(again.value.keyHash, keyHash)) {
        return { ok: false, response: json({ error: "Wrong farm key" }, 403) };
      }
      return { ok: true, meta: again.value };
    }
    return { ok: true, meta };
  }

  if (!sameSecret(found.value.keyHash, keyHash)) {
    return { ok: false, response: json({ error: "Wrong farm key" }, 403) };
  }
  return { ok: true, meta: found.value };
}

async function readMeta(farmId: string): Promise<Meta | null> {
  return (await kv.get<Meta>(["farm", farmId, "meta"])).value;
}

/** Store events the server has not seen, each with the next sequence number. */
async function storeEvents(farmId: string, events: unknown[]) {
  const metaKey = ["farm", farmId, "meta"];
  let accepted = 0, skipped = 0;

  for (const event of events) {
    const e = event as { id?: string };
    if (!e || typeof e.id !== "string" || !e.id) { skipped++; continue; }

    // Read the counter once, with its versionstamp, so the commit below fails if
    // another phone pushed in between. Retry only for that lost race: a commit
    // that failed because the event is already held is a duplicate, not a race.
    let placed = false;
    for (let attempt = 0; attempt < 5 && !placed; attempt++) {
      const current = await kv.get<Meta>(metaKey);
      const meta = current.value;
      if (!meta) break;
      const seq = meta.seq + 1;
      const result = await kv.atomic()
        .check({ key: ["farm", farmId, "ev", e.id], versionstamp: null })   // not already held
        .check({ key: metaKey, versionstamp: current.versionstamp })        // counter unchanged
        .set(["farm", farmId, "ev", e.id], seq)
        .set(["farm", farmId, "seq", seq], event)
        .set(metaKey, { ...meta, seq, events: meta.events + 1 })
        .commit();
      if (result.ok) { accepted++; placed = true; break; }

      const existing = await kv.get(["farm", farmId, "ev", e.id]);
      if (existing.value !== null) { skipped++; placed = true; break; }
    }
    if (!placed) skipped++;
  }
  return { accepted, skipped };
}

/** Hand back events after a sequence number, oldest first. */
async function listEvents(farmId: string, since: number, limit: number) {
  const out: unknown[] = [];
  let cursor = since;
  const iter = kv.list<unknown>({
    start: ["farm", farmId, "seq", since + 1],
    end: ["farm", farmId, "seq", Number.MAX_SAFE_INTEGER],
  }, { limit });
  for await (const entry of iter) {
    out.push(entry.value);
    cursor = Number(entry.key[3]);
  }
  return { events: out, cursor, more: out.length === limit };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);   // api farms :id ...

  if (parts.length === 0) {
    return new Response(
      "DouValue farm sync server is running.\n\n"
        + "Put this URL into the app under Settings, Sync.\n",
      { status: 200, headers: { "Content-Type": "text/plain", ...CORS } },
    );
  }

  if (parts[0] !== "api" || parts[1] !== "farms" || !parts[2]) {
    return json({ error: "Not found" }, 404);
  }
  const farmId = decodeURIComponent(parts[2]);
  const action = parts[3] || "";

  const auth = await authorise(farmId, req);
  if (!auth.ok) return auth.response;

  if (action === "health" && req.method === "GET") {
    const meta = await readMeta(farmId);
    return json({ ok: true, farmId, events: meta?.events ?? 0, cursor: meta?.seq ?? 0, since: meta?.created });
  }

  if (action === "events" && req.method === "GET") {
    const since = Math.max(0, Number(url.searchParams.get("since") || 0) || 0);
    const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get("limit") || 500) || 500));
    const page = await listEvents(farmId, since, limit);
    const meta = await readMeta(farmId);
    return json({ ...page, total: meta?.events ?? 0 });
  }

  if (action === "events" && req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "That batch is too large" }, 413);
    let body: { events?: unknown[] };
    try { body = JSON.parse(raw); } catch { return json({ error: "Body was not valid JSON" }, 400); }
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length > MAX_EVENTS_PER_PUSH) return json({ error: "Too many events in one push" }, 413);

    const result = await storeEvents(farmId, events);
    const meta = await readMeta(farmId);
    return json({ ...result, total: meta?.events ?? 0, cursor: meta?.seq ?? 0 });
  }

  return json({ error: "Not found" }, 404);
});
