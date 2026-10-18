# DouValue Farms — Adjustment Gap Analysis

| Field | Value |
|---|---|
| Written | 18 October 2026, against `main` at `2e00d6a` |
| Evidence | Source code, the test suite (972 of 972 pass), a real Deno 2.9 runtime for the KV checks. The live deployment was **not** available to this audit; no claim below depends on it unless marked *requires verification*. |
| Status key | **Complete** — works and is tested · **Partial** — some of it works · **Missing** · **Verify** — code exists but working behaviour could not be confirmed here |

## 0. About the specification

The brief asked for this analysis against `DouValue_Farms_Adjustment_Spec.md`. **That file is not in the repository, on any branch, or anywhere on the build machine.** This analysis therefore uses:

1. the requirements stated in the master implementation prompt itself (product vision, role experiences, onboarding, field usability and offline, intelligence, commercial readiness, engineering rules, testing), referred to below as **ADJ-** sections; and
2. the repository's own requirements (`docs/requirements.md` v1.17, `docs/verification.md`, `docs/simplify.md`), which are far more detailed and already carry IDs.

If the adjustment spec exists, add it to `docs/` and this analysis should be re-run against it. Nothing below assumes content from it.

## 1. Headline

The app is much further along than "a collection of dashboards". It is an event-sourced, offline-first PWA with a real server-side permission fence, gate judging on the server using the app's own code, honest refusal handling, and a large test suite that attacks the server rather than trusting it. The agronomic safety model (gates, PHI/REI, rotation, Farm Doctor limits, self-confirmation approvals) is the strongest part of the codebase and is enforced three times (domain code, replay, server).

The weaknesses are **operational plumbing**, not features:

- **G-01 (critical):** on the recommended Deno Deploy server, any record carrying a normal photo is larger than Deno KV's 64 KiB value limit. The server crashes on it, returns HTTP 500 for the whole batch, and that phone's outbox never drains again. Records stay on the phone (not lost) but never reach the farm, so a lost phone after that point loses them. Reproduced against a real Deno runtime.
- **G-03 (high):** anyone who knows the server address can create farms on it and spend the server's Anthropic key and WhatsApp quota. The address is sent to every staff member in their sign-in link.
- **G-02 / G-04 (high):** two paths where the phone says "saved" or "erased" without protecting unsynced records.
- **Onboarding** covers mid-season crops and backfilled sprays/harvest/stock well, but there is **no bulk import** of staff, history, sales or expenses.
- **Commercial readiness**: the server is already multi-farm by namespace, but has no farm-creation control, no backups for Deno KV, no per-farm WhatsApp/Owner configuration, no monitoring and no account lifecycle beyond revoke.

## 2. Engineering rules (ADJ §4)

| ID | Requirement | Current implementation and evidence | Status | Risk | Recommended change | Dependencies |
|---|---|---|---|---|---|---|
| G-01 | Never silently discard unsynchronized records; idempotent retries; explicit recovery | Push is idempotent by event id (`node-sync.mjs appendEvents`, Deno adapter `check(versionstamp:null)`). **But** the Deno KV adapter stores each event as one value; Deno KV refuses values ≥ 65,536 bytes (`Value too large`, verified on Deno 2.9.6). Photos are inline data URLs (`db.js captureEvidence`, 560 px JPEG ≈ 40–90 KB base64; reference photos allowed up to 200 KB by `guardReferencePhoto`). The throw is not caught → `writeEvents` → 500 → `sync.js push()` retries the same batch forever. The test KV stand-in (`tests/deno-bundle.test.mjs memoryKv`) has no size limit, so CI cannot see it. | **Missing** on Deno; Complete on the node server | Critical: proof photos, diagnoses and sick-plant reports never reach the farm; every later record from that phone is stuck behind them; the Owner sees a farm that looks quiet | Store large events in chunks in KV; make one unstorable record a refusal for that record, not a 500 for the batch; give the KV test stand-in Deno's real limits | None — Phase 1 |
| G-02 | Do not show success when data was not saved | `db.js appendEvents` catches any IndexedDB failure and falls back to an in-memory list mirrored to `localStorage`; `lsWrite` returns `false` on quota failure and the caller ignores it. `store.dispatch` then shows the record and the UI toasts "Saved". `loadEvents` reads the fallback only when IndexedDB is absent, so fallback records written during a transient IndexedDB failure are never read back or synced once IndexedDB works again. | **Partial** | High: a full phone (photos fill storage) loses records while saying "Saved" | Throw when nothing durable was written so the screen says so; read and re-home fallback records whenever the log loads | None — Phase 1 |
| G-04 | Never discard unsynchronized records | Settings → *Erase everything on this phone* (`ui/manage.js wipe-data`, Farm Manager and CEO) clears the log after a generic "export first" confirmation. It does not count or mention records that have not reached the server. | **Partial** | High: a manager tidying a shared phone deletes a hand's unsent harvests | Refuse erase while unsent records exist unless a backup is exported first in the same flow, and say how many | None — Phase 1 |
| G-05 | Authorship cannot be falsified; records corrected, never silently deleted (NFR-SEC-05) | Server stamps `by` with the authenticated member (`writeEvents`). A backup merged on another phone (`importBundle`) has no `synced` stamp, so that phone pushes it and the server files it under the merger. The original author is lost. | **Partial** | Medium: accountability and integrity checks name the wrong person | Server keeps the claimed author as `claimedBy` when it differs and marks the record as relayed; the record checks read it | Phase 3 |
| G-06 | Safe, reversible migrations; back up before risk | No schema migrations exist (event log; new fields are additive and old records are read with defaults — e.g. legacy diagnoses, legacy `agronomist` role). IndexedDB is at version 1. | **Complete** for the current design | Low | Keep additive-only event changes; add a migration test whenever `DB_VERSION` changes | — |

## 3. Security (ADJ §4 "Enforce real security")

| ID | Requirement | Current implementation and evidence | Status | Risk | Recommended change | Dependencies |
|---|---|---|---|---|---|---|
| G-03 | Protect sensitive operations; no insecure shortcuts; sustainable cost | `POST /api/farms/:id/bootstrap` needs no credential and accepts any unused farm id (`core.mjs bootstrap`). Each new farm's CEO can then call `/advise` and `/photo-review` on the server's `ANTHROPIC_API_KEY` (25 calls/person/day; **no monthly cap unless that farm's Owner sets one**) and `/notify`, which sends to the server-wide `OWNER_WHATSAPP`. The server address is in every staff sign-in link and may be in the public `web/js/farm-address.js`. | **Missing** | High: unbounded spend on the farm's API key; WhatsApp spam to the Owner; junk farms in storage | Once a server holds a farm, creating another needs a setup key set on the deployment (`FARM_SETUP_KEY`); the first farm on an empty server still needs none, so a fresh setup is unchanged | None — Phase 1 |
| G-07 | Users cannot see records they should not (FR-ROLE-03: hands never see other people's records) — **done 18 Oct 2026, see §11** | Server read policy sends money only to money roles, rates and findings only to the Owner — **Complete** and tested (`tests/security.test.mjs`, `simplify-money.test.mjs`). Shift reports, work logs, attendance, problem reports and comments of every person go to every role. Some of this is needed on a hand's phone (attendance drives cover; sprays drive PHI blocks), some is not (other people's shift reports and the manager's comments on them). | **Partial** | Medium: privacy between staff; manager comments visible to peers | Withhold `shift.record` / `shift.comment` of other people from hands. Needs an Owner decision on what else counts as "other people's records" | Owner decision D-A |
| G-08 | Shared-phone PINs are not sufficient protection on their own; lockout after 5 tries (NFR-SEC-02) | Server lockout: **Complete** (5 tries, 15 min, tested). Local pad (`ui/shell.js pin-ok`): unlimited attempts against a digest in IndexedDB. Unconnected farms keep `SHA-256("douvalue:"+PIN)` in the shared event log. README says so plainly. | **Partial** | Medium: a 4-digit PIN on a shared phone can be found in minutes | Local attempt counter with the same 5/15 rule; salted PBKDF2 for local digests; keep recommending a connected farm | Phase 1b |
| G-09 | Session handling (NFR-SEC-06 auto sign-out after 10 min idle) | Not implemented (`sessionStorage` user persists until the tab closes). | **Missing** | Medium: next person on a shared phone works as the previous one | Idle timer returning to the PIN pad; keep drafts | Phase 1b |
| G-10 | Server tokens | Random 256-bit, stored as digest, revocable per person and device; never expire. | **Partial** | Low | Expire tokens unused for 90 days | Phase 5 |
| G-11 | Injection (NFR-SEC-04) | `esc()` used throughout; injection tests exist (`security.test.mjs`). | **Complete** | Low | — | — |
| G-12 | Secrets out of the repo (NFR-SEC-03) | Keys read from env on the server only. | **Complete** | — | — | — |

## 4. Never fake success (ADJ §4) and offline reliability (ADJ §7)

| ID | Requirement | Current implementation and evidence | Status | Risk | Recommended change | Dependencies |
|---|---|---|---|---|---|---|
| G-13 | Distinguish saved locally / awaiting sync / synced / rejected / conflicting | A status line on every screen (`sync.js statusLine`) and a refusal list for rejected records (`domain/refusals.js`, NFR-OFF-06, tested). Records do not carry their own badge; a hand's *My work* does not say which of *their* records are still on the phone. Conflicts: the event model has no overwrite conflicts on creates; concurrent `*.update` events resolve by replay order (`at`), silently. | **Partial** | Medium: "Has my report been saved and synchronized?" is answerable only farm-wide | Per-person "waiting to send" on My work; a sync detail sheet listing unsent records; detect same-field concurrent updates and show them to the Farm Manager (NFR-OFF-04) | G-01 |
| G-14 | Offline operation tested | `tests/offline-site.test.mjs` installs the service worker in headless Chrome, stops the server, reopens the app. Domain flows are tested without a network. There is **no end-to-end test** that records offline, reconnects and confirms the record reached a server and another phone. | **Partial** | Medium | Add a sync round-trip test against the real node server and the Deno bundle with photo-sized records | G-01 |
| G-15 | Autosave drafts (UX-16) | Notes drafts in `ui/field-kit.js` and the shift report (`ui/shift.js`). Harvest, spray and scouting forms do not keep a draft. | **Partial** | Low | Extend the field-kit draft helper to the other field forms | Phase 3 |
| G-16 | Performance on low-end phones (NFR-PERF-01/02) | Every write replays the whole log (`reduce`) and every write scans the whole log to count unsent records. Not measured on a 2 GB phone. | **Verify** | Medium, grows with the season | Measure with a season-sized log; index-based unsent count; incremental reduce if needed | Phase 3 |
| G-17 | Server backups (NFR-DATA-01) | Node: append-only file, backup is a copy (manual). Deno KV: none. Phones: manual export. | **Missing** for Deno | High once the farm relies on the server | Owner-only full export endpoint; documented scheduled backup | Phase 5 (export endpoint earlier) |

## 5. Agronomic safety (ADJ §4 "Keep agronomy safe")

| ID | Requirement | Evidence | Status |
|---|---|---|---|
| G-18 | Preserve treatment gates, approvals, withholding periods | Gates 0–4, diagnose-before-treat, rotation, PHI/REI from the server catalogue, Week 10 rule, self-confirmation approvals: domain code + replay + `server/judge.mjs`. about 240 tests across `gates`, `gatemodel`, `server-gates`, `self-confirm`, `doctor`, `catalogue`. | **Complete** |
| G-19 | Do not invent labels, rates, diagnoses | `doctor.js` limits (FR-DOC-08), one test per limit; rates only from schedule or entered label (FR-STOCK-08). | **Complete** |
| G-20 | Distinguish observation, possible diagnosis, recommendation, confirmed outcome | Sick-plant report (observation) → guided diagnosis → confirmation by a second person → treatment; photo review returns a stated confidence and never confirms virus/bacterial on a photo. | **Complete** |
| G-21 | Version agronomic rules; test changes against safety cases | Rules in one JSON (`rev5_1`), sources registry, drift tests for every server-side copy. | **Complete** |

## 6. Role experiences (ADJ §5)

| ID | Requirement | Current implementation | Status | Recommended change |
|---|---|---|---|---|
| G-22 | Farm hand — My Work: now / where / how / record / saved? | `ui/worker.js`: ordered task cards with zone, due time, status colour, progress "4 of 7 done" (UX-23/24), steps, QR zone confirm, proof photo, Learn cards. Simplification pass done for 8 screens with 360 px tests. Missing: the hand's own sync state (G-13). | **Partial** (one gap) | Add "your records: all sent / N waiting / N refused" to My work |
| G-23 | Supervisor — Check and resolve | *The farm* view, overdue escalation, alerts board, diagnosis confirmations, harvest verification, shift board. | **Complete**, verify in the field |  — |
| G-24 | Farm manager — Run the farm | Dashboard, Plan, Store, People, approvals, stock alerts, forecasts per FR-SIMP-04. | **Complete**, verify in the field | — |
| G-25 | Owner — Business performance | KPIs (FR-REP-03), digest, profit per zone, record checks (Owner-only, nightly on server), Farm check. No surfacing of sync/data-quality health per phone (who has unsent or refused records). | **Partial** | Owner "data health" card: phones not synced for > 24 h, refused records, held records |
| G-26 | Metrics have definitions and sources | KPIs map to requirement IDs; Farm check cards state innocent explanation and settling evidence. | **Complete** | — |

## 7. Existing-farm onboarding (ADJ §6)

| ID | Item | Current implementation | Status |
|---|---|---|---|
| G-27 | Farm, zones, greenhouses | Real zone register seeded (`domain/farm.js`), zones add/retire/change type. | Complete |
| G-28 | Current crops, planting dates, stages | Setup flow FR-ONB-01/02 (`ui/setup.js`), stage derived from transplant date. | Complete |
| G-29 | Staff and roles | One at a time via *Add a person* (UX-28). No bulk entry. | Partial |
| G-30 | Opening stock | Opening count, backfilled, not usage (FR-ONB-07). | Complete |
| G-31 | Treatment history | Last insecticide/fungicide and 21-day sprays, backfilled; missing history blocks spraying (FR-ONB-05). Older history not captured. | Partial (by design) |
| G-32 | Harvest history | Harvest to date as a backfill total. No per-picking history import. | Partial |
| G-33 | Sales and expenses history — **imported as history, 18 Oct 2026; not yet in the reports** | Not supported as history; can only be entered as ordinary records dated in the past, which the record checks then flag as late entry. | **Missing** |
| G-34 | Outstanding tasks | One-off tasks (FR-TASK-04) can be written by hand. | Partial |
| G-35 | Import: column mapping, preview, validation, duplicates, confirmation, report, reversal — **done for harvest, sales and expenses history, 18 Oct 2026** | No CSV import. The only import is merging a full app backup file, which has none of these steps. | **Missing** |
| G-36 | Historical vs new distinguished; unknown stays unknown | Backfilled entries are marked and kept apart; "none" must be declared explicitly (FR-ONB-05). | Complete for what exists |

## 8. Intelligence and alerts (ADJ §8)

| Alert | Current | Status |
|---|---|---|
| Missed scouting / overdue inspections | Overdue escalation ladder (FR-TASK-03, FR-SCOUT-04), KPI-02 | Complete |
| Rising pest or disease | Threshold alerts; yellow warning on a rising trend (FR-SCOUT-07) | Complete |
| Repeated symptoms / abnormal mortality | Sick-plant serious reports alert (FR-DIAG-09); no cross-report pattern detection | Partial |
| Overdue interventions | Alert 24 h deadline, 3-day follow-up checks (FR-DOC-07) | Complete |
| Stock shortages / unexplained movements | Low stock (FR-STOCK-02); XC-02/03 unrecorded spraying (Owner) | Complete |
| Missed tasks / repeated failures | Escalation; failed follow-ups flagged | Partial |
| Unusual harvest or sales | Record checks: outliers, sold more than picked | Complete (Owner-only) |
| Record-keeping anomalies | 10+ record checks, server nightly | Complete |
| Each alert says observed / why / action / urgency / human confirmation | Alerts and findings carry these fields in most cases | Partial — verify per alert type |

## 9. Commercial readiness (ADJ §9)

| ID | Item | Current | Status | Path |
|---|---|---|---|---|
| G-37 | Tenant isolation | Every server key namespaced by `farmId`; tokens farm-bound and checked; a test tries one farm reaching into another. | Complete for data | Keep |
| G-38 | Tenant creation control | None (G-03). | Missing | Phase 1 setup key; later an operator console |
| G-39 | Customer-specific configuration | Rules JSON, zone register, crop list and sample farm are DouValue's. Owner WhatsApp and API key are per server. | Missing | Per-farm rules file and notification settings; Phase 5 |
| G-40 | Backups, export | G-17 | Missing on Deno | Phase 5 |
| G-41 | Audit trail | The event log is the audit trail (who, device, phone time, server time). | Complete |
| G-42 | Account lifecycle | Create, change role, revoke, sign out devices. No farm closure, data export for a departing customer, or deletion. | Partial | Phase 5 |
| G-43 | Monitoring, support | Console logs only; no health endpoint beyond `/`; no error reporting. | Missing | Phase 5 |
| G-44 | Operating cost | Free tiers (Pages, Deno Deploy); paid API capped per farm only if the Owner sets it. | Partial | Default cap; Phase 1 closes the open spend |

## 10. Testing (ADJ §11)

| Area | Status |
|---|---|
| Role and permission enforcement | Complete (server attacked in tests) |
| Farm isolation | Complete |
| Tasks: create, assign, complete, approval | Complete |
| Scouting and treatment safety | Complete |
| Inventory and duplicate prevention | Complete for drawdown and idempotent ids |
| Harvest and sales | Complete |
| Import validation and recovery | Missing (no import) |
| Offline then sync | Partial (G-14) |
| Rejected records | Complete (NFR-OFF-06) |
| Conflicts | Partial (no detection to test) |
| Migration safety | N/A today |
| Session and authentication | Server complete; local lockout and idle missing |
| Storage limits of the real Deno KV | **Missing** — the stand-in hides G-01 |

## 11. Owner decisions

Answered by the Owner on 18 October 2026 and built the same day.

| # | Question | Decision | Where it is enforced |
|---|---|---|---|
| D-A | What may each person see? (G-07) | "Each person should only see what concerns them based on the login they have." | Farm server read scope (`server/core.mjs → readScope`); `FR-ROLE-03` |
| D-B | Is the server live with staff? | Only the CEO's own account exists so far. No staff phones hold records from before the Phase 1a fixes. | — |
| D-C | Who may use outside advice (AI)? | "Limited to the CEO for now; the CEO can unlock it for the managers and supervisors." | Farm server `/ai-access`, checked before any paid call; `FR-ADV-07`, `FR-DOC-03` |
| D-D | Import from what? (G-35) | "From spreadsheet, normal paper reports, and can also be hand-filled." | Setup → Bring in existing records (`web/js/domain/importer.js`) |

Still open: whether the monthly outside-advice cap should default to a figure rather than none.
