# DouValue Farms — Implementation Roadmap

| Field | Value |
|---|---|
| Written | 18 October 2026 |
| Based on | `docs/adjustment-gap-analysis.md` (gap IDs `G-nn`), `docs/architecture-current-state.md` (debt IDs `T-n`) |
| Principle | Small, verifiable steps. Extend, never rewrite. Every gate, rotation, PHI/REI and Farm Doctor limit stays exactly as strong (CLAUDE.md). |

## Sequence and why it differs slightly from the brief

The brief's five phases stand. One change: **Phase 1 is split into 1a and 1b.** The audit found that the most urgent risks are not in field screens but in the plumbing under them — a record that cannot reach the server, a server anyone can create farms on, and two places where the phone claims to have protected data it has not. Those are fixed first (1a), because no amount of field usability helps if the records never arrive. Local PIN lockout, idle sign-out and per-person sync state (1b) follow.

Phase 2 (onboarding imports) is smaller than the brief assumes: mid-season crops, backfilled sprays, harvest-to-date and opening stock already exist and are gate-safe. What is missing is bulk import and sales/expense history.

---

## Phase 1a — Records must reach the farm, and spend must be bounded

| Item | Gap | Change | Files |
|---|---|---|---|
| 1a.1 | G-01 / T-1 | Deno KV adapter stores an event larger than one KV value in chunks, read back transparently; a record that still cannot be stored is **refused with a reason** for that record only, never a 500 for the batch. The KV test stand-in enforces Deno's real 64 KiB value limit. | `scripts-build-deno.mjs` (adapter source), regenerated `server/deno-sync.ts`, `server/deploy/main.ts`; `server/core.mjs writeEvents`; `tests/deno-bundle.test.mjs` |
| 1a.2 | G-03 / T-2 | A server that already holds a farm creates another only with `FARM_SETUP_KEY` (deployment env var). Empty server: first farm unchanged. | `server/core.mjs bootstrap`, `server/node-sync.mjs` (env), README, setup page; tests |
| 1a.3 | G-02 / T-3 | `appendEvents` throws when nothing durable was written; screens show the failure, not "Saved". Fallback records are merged back into IndexedDB the next time the log loads. | `web/js/db.js`, `web/js/store.js`; tests |
| 1a.4 | G-04 / T-4 | *Erase everything on this phone* counts unsent records and refuses while any exist, unless a backup file is exported in the same step. | `web/js/ui/manage.js`; tests |

**Acceptance criteria**
- A push containing a 200 KB-photo record to the generated Deno server (real Deno where available, a size-faithful stand-in in CI) stores it, and every phone pulls it back byte-identical.
- One record the server cannot store is listed in `refused` with a reason; the rest of the batch is accepted; the outbox drains.
- `POST /bootstrap` for a second farm without the key → 403 with an explanation; with the key → created; on an empty server → created without a key.
- A simulated IndexedDB + localStorage failure makes `dispatch` reject; no "Saved" toast; the record is not shown as recorded.
- A record written to the fallback while IndexedDB failed is present in IndexedDB after the next load and is pushed.
- Erase with unsent records is refused with the count.
- Full suite green; Deno bundle regenerated with no drift; site assembles.

**Status (18 October 2026): 1a.1–1a.4 done.** Each fix has tests that fail on the old code and pass on the new. Suite 989/989, clock-shifted suite green, Deno bundle regenerated with no drift, site assembles. 1a.1 also checked against a real Deno 2.9 server (photo-sized, non-ASCII and over-limit records; a tampered resend cannot overwrite). Not verified here: a live Deno Deploy instance, and the erase-time backup download on iOS Safari, which may need the person to choose *Save to Files*.

## Phase 1b — Shared-phone security and "did it send?"

| Item | Gap | Change |
|---|---|---|
| 1b.1 | G-08 | Local unlock: 5 wrong tries lock the pad 15 minutes (same rule as the server); salted PBKDF2 for local PIN digests, accepting old digests once and upgrading them. |
| 1b.2 | G-09 | 10-minute idle sign-out back to the pad (NFR-SEC-06); drafts preserved. |
| 1b.3 | G-13, G-22 | *My work* shows the person's own records: all sent / N waiting / N refused, with a sheet listing them. |
| 1b.4 | G-25 | Owner "data health": phones not synced for 24 h, held and refused records. |
| 1b.5 | G-07 | Withhold other people's shift reports and comments from hands — **after Owner decision D-A.** |

**Acceptance**: tests for lockout timing (fake clock), idle timer, per-person counts; 360 px screenshot of My work with the new line above the fold (FR-SIMP-08).

**Status (18 October 2026): 1b.1–1b.4 done; 1b.5 done as the Owner's decision D-A (Phase 1a/decisions round).** PIN pad lockout and PBKDF2 device digest with upgrade-on-sign-in; idle sign-out that swallows the waking tap; *Your records* line on My work; the Owner's *Are all the records in?* card fed by the server's new Owner-only `/devices`. Tested in the domain, against the node server, and in Chrome at 360 px (lockout across a reload; another person unaffected; 9 vs 10 idle minutes). Known limit: a lock kept on the phone can be got round by someone who rewinds its clock or edits its storage; the server's lock and read scope remain the fence. Unconnected farms keep the old quick PIN digest in the shared log (README says so).

## Phase 2 — Existing-farm onboarding and history

| Item | Gap | Change |
|---|---|---|
| 2.1 | G-35 | CSV import framework: column mapping, preview, per-row validation, duplicate detection against existing records, explicit confirmation, import report, and reversal by an `import.revert` event that voids every record of that import id (records are voided, not deleted — NFR-SEC-05). |
| 2.2 | G-33 | Sales and expense history as `backfilled` records, excluded from late-entry record checks, included in profit history. |
| 2.3 | G-32 | Per-picking harvest history, backfilled. |
| 2.4 | G-29 | Bulk staff entry from a list (names, roles), generating sign-ins in one sheet. |
| 2.5 | G-34 | Outstanding tasks list during setup. |

**Rules**: import never writes `spray.record` as live; imported sprays go through the existing backfill path so rotation and PHI read them (FR-ONB-04) and they never count as gated treatments (FR-ONB-03). Unknown cells stay empty; no defaults are invented.
**Dependency**: Owner decision D-D (sources and formats).

**Status (18 October 2026): 2.1–2.3 built for harvest, sales and expenses history.** The Owner chose three sources: spreadsheets, paper reports and hand-filled sheets. Setup → *Bring in existing records* (`#/import`, Farm Manager and Owner) takes a .csv file or cells pasted from Excel or Google Sheets, or rows typed in from a paper report or a hand-filled sheet (kept on the phone until imported). Every way in goes through the same steps: column matching (guessed, every guess changeable), per-row checks with the reason in words, possible duplicates left out unless chosen, a confirmation summary, a downloadable per-line report, and undo of a whole import (`import.revert`: rows stay in the log, marked undone). A blank sheet prints on one landscape page, and a spreadsheet template downloads. Imported rows are their own records (`history.harvest`, `history.sale`, `history.expense`): never a live harvest, spray or treatment, never judged as one, never sent to a hand, and money history only to the roles that run the books. Spray history is not imported here; it stays in Setup, where the rotation and the waiting periods read it.

Since added: **Reports → Farm history** shows imported history beside live records, year by year and zone by zone, with the imported share of each figure; the KPIs, forecasts and record checks deliberately still read live records only. Not done yet: .xlsx files must be saved as CSV or copied and pasted; reading a photographed paper report is not built (it would use the paid AI, which is the Owner's alone); bulk staff entry (2.4) and outstanding tasks (2.5).

## Phase 3 — Operational control

- Authorship of relayed records (G-05): server keeps `claimedBy` and marks relayed; record checks read it.
- Concurrent-update detection (G-13, NFR-OFF-04): two `*.update` events on the same field from different devices without one seeing the other → a conflict card for the Farm Manager.
- Drafts on harvest, spray and scouting forms (G-15).
- Performance (G-16): unsent count from the `synced` index; measure reduce time on a season-sized log on a 2 GB phone; incremental reduce only if measurements demand it.
- Sync round-trip end-to-end test (G-14): offline record → reconnect → server → second phone.

## Phase 4 — Reporting and decision support

- Pattern alerts across sick-plant reports (repeated symptom in one zone, rising plant counts).
- Every alert type audited for observed / why / action / urgency / needs-confirmation fields; a test per type.
- Repeated task failures per zone surfaced to the supervisor.

## Phase 5 — Commercial readiness

- Owner full export endpoint (server), and a documented daily backup for Deno KV and node (G-17, NFR-DATA-01).
- Per-farm configuration: rules file, crop list, zone register, Owner WhatsApp number (G-39).
- Operator controls: farm creation, suspension, closure with export (G-38, G-42).
- Token expiry (G-10), health endpoint and error reporting (G-43), default spend cap (D-C).
- Pilot-customer checklist.

---

## Test plan (every phase)

1. `npm test` (all suites) and `npm run test:clock`.
2. `node scripts-build-deno.mjs && git diff --exit-code -- server/deno-sync.ts server/deploy/` whenever server code changes.
3. `./scripts/assemble_site.sh _site`.
4. Where available, the generated Deno server under a real Deno runtime for storage changes.
5. Screens touched: 360 px and desktop render check.

## Completion checklist (per phase)

- [ ] Problem stated with evidence
- [ ] Smallest change made; no gate, rotation, PHI/REI or Farm Doctor limit weakened
- [ ] Tests added that fail before and pass after
- [ ] Suite, clock-shifted suite, Deno drift check, site assembly all green
- [ ] Docs updated (README, requirements change log where behaviour changes)
- [ ] Report: done / passed / failed / outstanding / manual checks
