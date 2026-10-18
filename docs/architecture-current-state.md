# DouValue Farms — Current Architecture

| Field | Value |
|---|---|
| Written | 18 October 2026, from the code on `main` at `2e00d6a` |
| Method | Source read end to end for the sync, storage, auth and server paths; test suite run (972 of 972 pass); Deno KV behaviour checked against a real Deno 2.9 runtime |
| Companion docs | `docs/adjustment-gap-analysis.md`, `docs/implementation-roadmap.md` |

This describes what the code does today, not what the README or the requirements say it should do. Where the two differ, the gap analysis records it.

---

## 1. Shape of the system

```
 Phones (PWA, offline-first)                         Farm server (one of two runtimes)
 ┌──────────────────────────────┐                    ┌────────────────────────────────────┐
 │ web/index.html + sw.js cache │                    │ server/core.mjs  — the fence        │
 │ ui/*  → store.dispatch()     │                    │   auth, roles, EVENT_POLICY,        │
 │ store.js reduce(log) → state │   HTTPS + Bearer   │   guards, §4.2 log checks           │
 │ db.js IndexedDB event log    │ ─────────────────► │ server/judge.mjs — gates, PHI/REI,  │
 │ sync.js outbox push / pull   │ ◄───────────────── │   proof photos, using the app's     │
 │ rules.js ← rules/*.json      │                    │   own reduce() and gate code        │
 └──────────────────────────────┘                    │ storage adapter:                    │
        ▲   GitHub Pages (static)                    │   Deno KV  (server/deno-sync.ts,    │
        │   scripts/assemble_site.sh                 │             deploy/main.ts)         │
        │                                            │   files    (server/node-sync.mjs)   │
 rules/douvalue_rules_rev5_1.json (single copy)      │ outbound: Anthropic API, WhatsApp   │
                                                     │   Cloud API, Open-Meteo             │
                                                     └────────────────────────────────────┘
```

- **No framework, no build step, no dependencies.** Plain ES modules. ~35,000 lines of hand-written JS (`web/js` ≈ 30k, `server` ≈ 2.6k), plus two generated 17k-line Deno bundles.
- **Hosting.** The app is a static site on GitHub Pages (`.github/workflows/publish-site.yml`). The server is either Deno Deploy (recommended in the README, storage on Deno KV) or `node server/node-sync.mjs` (storage in JSON/JSONL files).
- **One server can hold several farms**: every key is namespaced by `farmId`, and tokens are bound to one farm.

## 2. Data model: an event log

Every action is an immutable event: `{ id, type, at, by, device, payload }` (`store.js → dispatch`). There are 80+ event types (`server/core.mjs → EVENT_POLICY`). Nothing is updated in place; corrections are new events.

- **State is derived.** `reduce(events)` (`web/js/store.js:239`) sorts by `at`, replays, and *parks* events whose subject has not arrived yet (e.g. a `task.complete` before its `task.create`), replaying them when it does. Leftovers are reported as orphans, not dropped.
- **Merging is set union by event id.** Two phones, a backup file, or the server all merge the same way. This is why there is no last-writer-wins conflict on create-type records.
- **Idempotency by id.** Generated tasks use deterministic ids (`gen_<day>_<zone>_<kind>`) so five phones generating the day's schedule produce one task. The server skips an id it already holds.
- **Photos are inline** as JPEG data URLs inside the event payload (`db.js → captureEvidence`, ~560–720 px). There is no separate blob store.
- **Three timestamps**: the day the record claims (`payload.date`), the phone's `at`, and the server's `serverAt` (authoritative).

## 3. Client storage (`web/js/db.js`)

- IndexedDB database `douvalue`, store `events` keyed by `id`, plus a `meta` store (auth token, sync cursor, device PIN digest, refusals, drafts).
- Unsynced events are those without a `synced` stamp. `unsyncedEvents()` and `countUnsynced()` load **the whole log** and filter in memory.
- Fallback: if IndexedDB is missing or a write throws, events go to an in-memory array mirrored to `localStorage`. **See gap G-02**: this fallback reports success even when the `localStorage` write also fails, and once IndexedDB works again the fallback copy is never read back.
- Export/import: a JSON bundle of the full local log (`exportBundle` / `importBundle`).

## 4. Sync (`web/js/sync.js`)

- **Push**: up to 400 unsynced events, trimmed to 3 MB (`fitBatch`), `POST /api/farms/:id/events`. The server answers `accepted / skipped / refused / held`. Everything except `held` is stamped synced. Refused records are kept on the phone and listed to their maker (`domain/refusals.js`, NFR-OFF-06).
- **Pull**: `GET /events?since=<cursor>` in pages of 500; the cursor counts all server events, including ones withheld from this role.
- **Triggers**: coming online, 4 s after any write, returning to the foreground, a 2-minute poll; exponential backoff 5 s → 5 min; concurrent triggers share one run.
- **Failure handling**: 401/403 stops sync and tells the person to sign in again. Any other error retries the *same* batch. **See gap G-01**: a single record the server cannot store returns HTTP 500 for the whole batch, so the batch is retried forever.
- **Status**: one line across every screen (`statusLine`) — saved on this phone only / offline with N waiting / syncing / error / up to date / held. There is no per-record sync badge.

## 5. Authentication and authorization

### Accounts (server)
- **Bootstrap** (`POST /api/farms/:id/bootstrap`) creates a farm and its CEO. **Unauthenticated**, works once per farm id, any farm id. See gap G-03.
- **Accounts (UX-28)**: the CEO/manager creates `login` + 6–12 digit password. Passwords are PBKDF2-SHA256, 210,000 rounds, per-account salt. Five failures lock the account for 15 minutes (`lockoutState`). Unknown login and wrong password get the same answer.
- **Tokens**: 32 random bytes, stored only as SHA-256 digest, bound to `farmId` and `memberId`, no expiry; revoked per person (`/revoke`, `devicesOnly`). Status of the member is checked on every request.
- **Legacy invite flow** (`/invite`, `/join`) still exists alongside UX-28.

### Roles
- `hand (10) < supervisor (50) < manager (80) < ceo (100)`. The legacy `agronomist` maps to `supervisor`. Permission lists exist **twice**, in `web/js/store.js` (screens) and `server/core.mjs` (enforcement). Tests check they agree.
- Nobody can appoint at or above their own rank (CEO excepted); nobody changes their own role; the last CEO cannot be removed (`mayWritePerson`, `account`, `revoke`).

### Write enforcement (server)
For every pushed event: `EVENT_POLICY[type].write` permission → per-type `guard` (shape and content rules) → `mayWritePerson` (target's stored standing) → §4.2 log checks for confirmations/approvals/sprays (`mayWriteFromLog`) → gate judging for `cycle.start`, `topsoil.assign`, `spray.record`, `harvest.record`, `task.complete` (`judge.mjs`, using the app's own `reduce()` and gate functions and the server's catalogue PHI/REI). The server **overwrites `by`** with the authenticated member.

### Read enforcement (server)
`visibleTo(event, reader)`: sales, expenses → `manageMoney`; position rates → `manageRates` (Owner); record-check findings → `viewAudit` (Owner); everything else to every role, with `person` records stripped of `pinHash`, `dailyRate` and other people's phone numbers, and `settings` stripped of prices for non-money roles. **Operational records of other people (shift reports, work logs, attendance, problem reports) reach every role.** See gap G-07.

### On the phone
- A **connected** phone belongs to one member; the daily unlock compares `SHA-256(memberId:PIN)` with a digest in IndexedDB. There is **no attempt limit** on this local pad and no idle sign-out. See gaps G-08, G-09.
- An **unconnected** farm uses per-person `pinHash = SHA-256("douvalue:" + PIN)` stored *in the event log* — readable by anyone with the phone and brute-forceable in milliseconds. The README states this honestly as a workplace control only.
- Role checks in the UI (`can(user, perm)`) are convenience; the server is the fence.

## 6. Domain logic (web/js/domain, ~16k lines)

Gates 0–4 and the GH-04/05 clean restart (`gates.js`), PHI/REI and rotation (`safety.js`, `catalogue.js`), Farm Doctor limits and treatment plans (`doctor.js`), triage and diagnosis cards from the rules JSON (`diagnose.js`), self-confirmation and approvals (`selfcheck.js`), alert thresholds and the 4-rung escalation ladder (`alerts.js`), daily task generation (`schedule.js`, `generate.js`), assignments and cover (`assignments.js`), nursery release (`nursery.js`), plant-bag media (`media.js`), mid-season onboarding and backfill (`onboarding.js`), stock drawdown (`stock.js`, `drawdown.js`), forecasting (`predict.js`), record checks (`integrity.js`), digest and WhatsApp items (`digest.js`, `notify.js`). The rules JSON is the single source; the server bundles the same modules.

## 7. Outbound services (server only)

- **Anthropic** (`ANTHROPIC_API_KEY`): wider adviser and photo review. Bounded per person (25/day) and by an optional Owner monthly cap — **no cap by default**.
- **WhatsApp Cloud API** (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `OWNER_WHATSAPP`): one Owner number per *server*, not per farm. 60 messages/day/farm.
- **Open-Meteo**: weather, optional.

## 8. Deployment and CI

- CI (`.github/workflows/ci.yml`): `npm test` (Node 22 test runner, 972 tests including a headless-Chrome offline test), checks the generated Deno bundle has not drifted (`node scripts-build-deno.mjs && git diff --exit-code`), assembles the site; a second job reruns the suite with the clock shifted 1, 60 and 400 days.
- `server/deno-sync.ts` and `server/deploy/main.ts` are **generated** from `core.mjs` + the app modules + the Deno storage adapter in `scripts-build-deno.mjs`. Edit the sources, then regenerate.
- The service-worker cache name is versioned by hand (`sw.js`).

## 9. Backups and recovery

- Node server: append-only `events.jsonl` per farm; a backup is a file copy. No automated schedule in the repo.
- Deno KV: no export or backup endpoint, no scheduled backup. Recovery of a Deno-hosted farm depends on the CEO's phone holding the full log (it receives everything) and on manual exports.
- Phones: manual *Export a backup file*; no reminder tied to unsynced data.

## 10. Known technical debt and security concerns

| # | Concern | Where | Severity |
|---|---|---|---|
| T-1 | Deno KV rejects values ≥ 64 KiB; events with photos exceed it; the error is uncaught → HTTP 500 for the whole push batch → that phone's outbox never drains | `scripts-build-deno.mjs` storage adapter | **Critical** (if Deno Deploy is in use) |
| T-2 | Unauthenticated farm creation on a server that holds a paid API key and the Owner's WhatsApp number; no default spending cap | `core.mjs → bootstrap`, `advise`, `notifyOwner` | **High** |
| T-3 | Local save fallback reports success when nothing durable was written; fallback copy invisible once IndexedDB recovers | `db.js → appendEvents / loadEvents` | **High** |
| T-4 | "Erase everything on this phone" deletes unsynced records with no warning about them | `ui/manage.js → wipe-data` | **High** |
| T-5 | Merging a backup file then syncing files other people's unsynced records under the merger's name | `db.importBundle` + server `by` stamp | Medium |
| T-6 | No local unlock attempt limit; unconnected-farm PIN digests are unsalted and in the log | `ui/shell.js` | Medium |
| T-7 | No idle sign-out (NFR-SEC-06) | `ui/shell.js` | Medium |
| T-8 | Every role receives other people's shift reports, work logs and reports (FR-ROLE-03) | `core.mjs → EVENT_POLICY read` | Medium (needs Owner decision) |
| T-9 | Whole-log scans on every write (`countUnsynced` after each dispatch, `reduce` of the full log on every event) — will slow on low-end phones as the log and photos grow | `db.js`, `store.js` | Medium (performance) |
| T-10 | Role tables duplicated client/server; rules constants (spray window, banned actives, task kinds) duplicated in the server with drift tests | `core.mjs` | Low (guarded by tests) |
| T-11 | Tokens never expire; `deleteTokensFor` scans every token on the server | `core.mjs`, adapters | Low |
| T-12 | Client-supplied `at` is trusted for some server guards (e.g. onboarding "planted before setup") | `core.mjs → guardOnboard` | Low |
| T-13 | No server-side backup/export for Deno KV (NFR-DATA-01) | adapters | Medium |
