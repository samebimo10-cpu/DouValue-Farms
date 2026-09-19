# DouValue Farms — Farm Management App
## Core Requirements Specification

| Field | Value |
|---|---|
| Document | Core Requirements |
| Version | 1.4 (draft for restructuring) |
| Owner | DouValue Farms Limited |
| Platform context | Live testbed for EBIMS |
| Status | Draft |

**Priority key:** **MUST** = required for launch · **SHOULD** = high value, next release · **COULD** = later

**How to use this document:** Every requirement has an ID (e.g. `FR-GATE-01`). Keep the IDs when you move sections around, so tests, tasks and code comments can point back to them.

---

## 1. Purpose

The app exists to **prevent crop loss**, not to record it. Season 1 was lost to four root causes:

1. Planting into untested, nematode-contaminated soil
2. Thrips (tospovirus vector) controlled too late
3. Oversight the owner could not see remotely
4. Treatment by guesswork instead of diagnosis

**Design test for every feature:** *Would this have stopped Season 1?* A feature must do at least one of these: **block** a wrong action, **alert** someone in time, **prove** work was done, or **show** money made or lost. Features that only record should be simplified or removed.

## 2. Scope

**In scope:** five greenhouse bell pepper houses (GH-01 to GH-05), open-field habanero (OF-01, OF-03), the Rukpokwu extension (RUK-01), the nursery (OF-02), daily field work, scouting, diagnosis, treatment, soil and planting gates, inputs, harvest, sales, costs, owner oversight, the farm adviser, offline use and sync.

**Out of scope for v1:** payroll, full accounting, buyer marketplace, hardware beyond optional climate loggers.

## 3. Success measures

The app is working only if these improve against Season 1. The app must calculate and show them (see `FR-REP-03`).

| ID | Measure | Target |
|---|---|---|
| KPI-01 | Hours from pest threshold breach to treatment done | ≤ 24 h |
| KPI-02 | Scheduled scouting actually completed, with photo | ≥ 95% |
| KPI-03 | Treatments logged without a diagnosis | 0 |
| KPI-04 | Plantings logged without passing soil gates | 0 |
| KPI-05 | Open alerts older than 48 h | 0 |
| KPI-06 | Profit or loss known for each house and field | Every cycle |

---

## 4. Users and roles

Roles are **positions, not people**. A person can be moved between positions without changing the app.

| Role | What they do in the app |
|---|---|
| Owner | Sees everything, receives digest, sets thresholds, approves overrides |
| Farm Manager | Plans work, assigns zones, closes alerts, approves treatments |
| Field Supervisor (2IC) | Checks work, performs confirm tests, confirms diagnoses, covers for Farm Manager |
| Farm Doctor (in-app) | Not a person. Diagnoses, plans treatments and checks gate evidence in place of a site agronomist; every output is confirmed by a person (§6.14) |
| Greenhouse Hand (×4, rising to more) | Does tasks in one primary zone and one backup zone |

- **FR-ROLE-01 (MUST):** Each position has one primary zone and one backup zone.
- **FR-ROLE-02 (MUST):** When a person is absent, their tasks move to the backup holder automatically.
- **FR-ROLE-03 (MUST):** Each role sees only the screens and buttons it needs. Greenhouse Hands never see settings, costs or other people's records.
- **FR-ROLE-04 (SHOULD):** The Farm Manager can reassign a position to a different person in under one minute.

---

## 5. Ease of use for field staff

Field staff are trained to use the app, including writing notes and reports. The goal of this section is **speed and clarity in real field conditions**: wet or dirty hands, bright sun, time pressure, and shared phones. If a feature conflicts with this section on a field screen, this section wins.

### 5.1 Principles

1. **Fast for routine, full for detail.** Common entries (counts, pest type, zone, grade) take a tap or two. Written notes are available on every record for anything that needs explaining.
2. **Clear at a glance.** Labels are plain and short. Icons and colours support the words so status is readable in a second.
3. **One screen, one job.** Each screen covers one task, so nothing gets missed.
4. **Hard to get lost.** A Home button is always visible, and nothing is more than three taps from Home.
5. **Mistakes are safe.** Entries can be corrected the same day, and important actions are confirmed before saving.

### 5.2 Requirements

**Sign-in**
- **UX-01 (MUST):** Sign-in shows each person's face photo and name. The person taps their own, then enters a 4-digit PIN.
- **UX-02 (MUST):** Field staff sign in without emails or long passwords.

**Layout and reading**
- **UX-03 (MUST):** Buttons are at least 56 × 56 dp with space between them, usable with dirty or gloved hands.
- **UX-04 (MUST):** Body text at least 16 sp; key numbers at least 28 sp.
- **UX-05 (MUST):** High-contrast mode readable in direct sunlight.
- **UX-06 (MUST):** Labels and instructions use plain, direct wording that matches the terms used in training and the operations schedule.
- **UX-07 (MUST):** A fixed colour meaning across the whole app: **green = done/safe**, **yellow = check soon**, **red = act now**, **grey = not yet**. Colour is always paired with an icon (✓, !, ✕) so it also works for colour-blind users.

**Writing and entering information**
- **UX-08 (MUST):** Every task, scouting record, diagnosis, treatment and harvest has a **written notes field**.
- **UX-09 (MUST):** Scouting and end-of-shift reports include a short written observation ("what did you see, what did you do").
- **UX-10 (MUST):** Counts use a number field with **+ and − buttons** beside it, so small changes are quick and large numbers can be typed.
- **UX-11 (MUST):** Pests, diseases and grades can be chosen from **photo cards or a searchable list by name**, whichever the person prefers.
- **UX-12 (MUST):** Zone is chosen from a list or farm map, or by scanning a QR code on the greenhouse door. Scanning is quickest and is offered first.
- **UX-13 (MUST):** The camera opens in one tap. Proof photos are taken inside the app (see `FR-PROOF-02`).
- **UX-14 (SHOULD):** Voice notes are available as an extra option when hands are busy, alongside written notes.
- **UX-15 (SHOULD):** Frequently used phrases (e.g. "traps replaced", "drip line blocked") can be inserted with one tap and then edited.
- **UX-16 (SHOULD):** Unfinished entries are saved as drafts automatically, so an interrupted note is not lost.

**Language**
- **UX-17 (MUST):** Interface in English at launch, with Nigerian Pidgin available per person.
- **UX-18 (COULD):** Instructions can be read aloud for use while working.

**Guidance and feedback**
- **UX-19 (MUST):** Each task shows its steps (1, 2, 3) with reference photos. These match the laminated role cards and the consultant's training material.
- **UX-20 (MUST):** After saving, the app shows a clear confirmation (tick and short vibration). Failures show what to do next ("Take photo first"), not technical error text.
- **UX-21 (MUST):** Before saving anything that triggers spending or spraying, the app shows a summary ("GH-03 · thrips · spray · product · dose") for confirmation.
- **UX-22 (SHOULD):** A "Call supervisor" button on field screens dials the current Field Supervisor.

**Home screen for a Greenhouse Hand**
- **UX-23 (MUST):** Home shows **today's tasks** as a list of cards in order, each with zone, due time, and status colour.
- **UX-24 (MUST):** A progress bar shows "4 of 7 done".

**Training and testing**
- **UX-25 (MUST):** A practice mode uses the sample farm, so staff can train without touching real records.
- **UX-26 (MUST):** Once the app is built, field screens are tried in real use by at least two Greenhouse Hands, with the training consultant observing. Anything that slows them down is logged and fixed in a dedicated revision round after the trial.
- **UX-27 (MUST):** Until that round is complete, spray and gate screens are used only with the Field Supervisor or Farm Manager present.

---

## 6. Functional requirements

### 6.1 Farm structure
- **FR-FARM-01 (MUST):** Zones: GH-01 to GH-05, OF-01, OF-03, RUK-01, and the nursery OF-02. Zones can be added, retired or change type (as OF-02 did).
- **FR-FARM-04 (MUST):** The nursery (OF-02) is a zone with its own tasks: daily trap count, twice-weekly seedling check, and hygiene rules (Build Rules §11e).
- **FR-FARM-05 (MUST):** Seedlings are tracked in batches. A batch must pass the release check before a block can log transplant, and each batch is linked to the block it goes to.
- **FR-FARM-02 (MUST):** Each zone has a crop cycle: crop, variety, planting date, expected harvest window, status.
- **FR-FARM-03 (SHOULD):** Each zone has a printable QR code for its door or marker post.

### 6.2 Gates (blocking rules)
Gates stop wrong actions. They are the most important part of the app.

- **FR-GATE-00 (MUST):** There is no site agronomist. Gate 0 and Gate 4 are cleared by Farm Manager confirmation plus Owner approval, after the Farm Doctor check. The nematode assay still comes from a lab.
- **FR-GATE-01 (MUST):** **Soil pH gate.** Planting cannot be logged unless a pH reading between **5.5 and 7.0** has been recorded for that zone, from a three-point test, after any lime correction (rules C-5, C-14).
- **FR-GATE-02 (MUST):** **Nematode gate.** Planting cannot be logged unless a soil or topsoil test marked clean has been recorded for that zone or that topsoil batch.
- **FR-GATE-03 (MUST):** **Purchased topsoil.** Each topsoil delivery is logged as a batch with supplier, date and test result. Untested batches are marked red and cannot be assigned to a zone.
- **FR-GATE-04 (MUST):** **Diagnose before treat.** A treatment cannot be logged without a linked diagnosis (see 6.5).
- **FR-GATE-05 (MUST):** **Spray rotation.** The app blocks a product if it breaks the rotation rules for that pest and zone (Build Rules Extract §6–7).
- **FR-GATE-06 (MUST):** All gates from Farm Operations Schedule Rev 5 / 5.1 (Gate 0 to Gate 4, clean-restart protocol for GH-04 and GH-05) are carried over from GateField and listed on one Gates screen with their current state per zone.
- **FR-GATE-07 (MUST):** Only the Owner can override a gate. Every override needs a reason (voice or text) and is shown in the digest.

### 6.3 Daily tasks
- **FR-TASK-01 (MUST):** Tasks are generated daily from the operations schedule for each zone: scouting, trap checks, irrigation, fertigation, pruning, harvest, sanitation.
- **FR-TASK-02 (MUST):** Each task has an owner position, a due time, a status, and notes.
- **FR-TASK-05 (MUST):** Each person submits a short written end-of-shift report, which the Farm Manager can read and comment on.
- **FR-TASK-03 (MUST):** Overdue tasks turn red and move to the Field Supervisor's list.
- **FR-TASK-04 (SHOULD):** The Farm Manager can add a one-off task from a template or by writing it.

### 6.4 Proof of work
Fixes blind oversight.

- **FR-PROOF-01 (MUST):** Scouting and trap-check tasks cannot be marked done without at least one photo.
- **FR-PROOF-02 (MUST):** Photos are taken live in the app and stamped with date, time, zone, and person. Gallery uploads are not accepted for proof tasks.
- **FR-PROOF-03 (SHOULD):** The zone is confirmed by QR scan at the start of the task.
- **FR-PROOF-04 (MUST):** Photos are compressed to keep phone storage and data use low (target under 200 KB each) while still showing insects on a sticky trap.

### 6.5 Scouting, thresholds and alerts
Fixes late thrips control.

- **FR-SCOUT-01 (MUST):** Scouting records pest or disease, count or level, zone, location within the zone, and a written observation.
- **FR-SCOUT-02 (MUST):** Each pest has an action threshold per zone type (Build Rules Extract §5), editable only by the Owner.
- **FR-SCOUT-03 (MUST):** When a count crosses its threshold, the app opens an **Alert** with a 24-hour deadline.
- **FR-SCOUT-04 (MUST):** Escalation ladder: Farm Manager at once → Field Supervisor if not acknowledged in 4 h → Owner if not closed in 12 h → KPI breach at 24 h (rules C-12).
- **FR-SCOUT-05 (MUST):** An alert closes only when a diagnosis and a treatment (or a recorded decision not to treat, with reason) are logged.
- **FR-SCOUT-06 (MUST):** A trend chart per zone shows trap counts over time, with the threshold line drawn.
- **FR-SCOUT-07 (SHOULD):** Rising trends raise a yellow warning before the threshold is crossed.

### 6.6 Diagnosis
Fixes treatment by guesswork.

- **FR-DIAG-01 (MUST):** The 22 triage entries and 20 diagnosis cards from Rev 5 are built in as guided questions with reference photos ("Leaves curled? Yes / No").
- **FR-DIAG-02 (MUST):** A diagnosis records the card used, answers given, photos, written reasoning, and who confirmed it.
- **FR-DIAG-03 (MUST):** A Greenhouse Hand can start a diagnosis, but only the Field Supervisor or Farm Manager can confirm it.
- **FR-DIAG-04 (MUST):** Suspected virus (e.g. tospovirus) triggers a red alert straight to the Owner, with isolation and removal steps.
- **FR-DIAG-05 (MUST):** Samples sent to a lab are tracked with send date, lab, and result. The Farm Doctor recommends a lab sample in the cases listed in §6.14.
- **FR-DIAG-06 (MUST):** Diagnoses are run through the Farm Doctor (§6.14).

### 6.7 Treatments and sprays
- **FR-TREAT-01 (MUST):** A treatment records diagnosis link, product, dose, zone, date, time, person, and weather or greenhouse condition.
- **FR-TREAT-02 (MUST):** The app shows **re-entry interval** and **pre-harvest interval** for each product and blocks harvest tasks in that zone until the interval has passed.
- **FR-TREAT-03 (MUST):** Dose is shown in ml or g per litre and as a practical measure for the sprayer in use (e.g. "3 caps per 16 L knapsack").
- **FR-TREAT-04 (MUST):** Protective equipment required for the product is shown as pictures before the task starts, and the person confirms with a tap.
- **FR-TREAT-05 (SHOULD):** A follow-up check task is created automatically 3 days after each treatment to confirm it worked.

### 6.8 Inputs and stock
- **FR-STOCK-01 (MUST):** Stock of chemicals, fertiliser, lime, seed, and sticky traps is tracked; using an input in a task reduces stock.
- **FR-STOCK-02 (MUST):** Low stock (below a set level) alerts the Farm Manager, before the input is needed.
- **FR-STOCK-03 (SHOULD):** Each purchase records supplier, quantity, cost, batch, and expiry.
- **FR-STOCK-04 (SHOULD):** Expired products cannot be selected for treatment.
- **FR-STOCK-05 (MUST):** Treatments are chosen by **active ingredient** from a fixed catalogue with IRAC/FRAC groups built in (Build Rules §11d).
- **FR-STOCK-06 (MUST):** The Farm Manager can add a brand label by selecting one or more active ingredients from the catalogue, then entering brand name, formulation, concentration, label rate, PHI, REI and a label photo. The group fills in automatically.
- **FR-STOCK-07 (MUST):** Blank PHI or REI on a label uses the defaults (24 h REI; 14-day PHI for synthetics). An entered value is used only if longer.
- **FR-STOCK-08 (MUST):** An active with no schedule rate and no entered label rate cannot be used.
- **FR-STOCK-09 (MUST):** Only the Owner can add a new active ingredient to the catalogue, with its group. Banned actives (carbofuran / Furadan) can never be added.

### 6.9 Harvest and sales
- **FR-HARV-01 (MUST):** Harvest records zone, date, crates or weight, grade, person, and notes.
- **FR-HARV-02 (MUST):** Sales record buyer, quantity, grade, price, payment status.
- **FR-HARV-03 (SHOULD):** Rejected or spoiled produce is recorded with a reason.

### 6.10 Costs and profit per unit
- **FR-COST-01 (MUST):** Every input use, labour day, and sale is tied to a zone.
- **FR-COST-02 (MUST):** The Owner sees cost, revenue, and profit or loss per zone per cycle.
- **FR-COST-03 (SHOULD):** Cost per kg and yield per plant compared across zones and seasons.
- **FR-COST-04 (MUST):** Cost and sales screens are hidden from Greenhouse Hands.

### 6.11 Owner oversight
- **FR-REP-01 (MUST):** **Exceptions-only daily digest** for the Owner: missed tasks, open alerts, gate overrides, virus suspicions, low stock. If nothing is wrong, it says so in one line.
- **FR-REP-02 (MUST):** The digest is small enough to receive over a weak or expensive connection (text first, photos on request) and can be sent by WhatsApp or email **[choose channel]**.
- **FR-REP-03 (MUST):** A KPI screen shows the measures in section 3, per week and per zone.
- **FR-REP-04 (SHOULD):** A weekly summary per zone with photo highlights.
- **FR-REP-05 (SHOULD):** Records can be exported for EBIMS, funders, and audits.

### 6.12 Farm adviser
- **FR-ADV-01 (MUST):** The adviser reads the farm's own records and ranks actions, **safety above money**.
- **FR-ADV-02 (MUST):** Core ranking works with no internet.
- **FR-ADV-03 (MUST):** "Show what it looked at" lists every record used for an answer.
- **FR-ADV-04 (MUST):** Adviser suggestions never bypass gates. A suggested treatment still needs a confirmed diagnosis.
- **FR-ADV-05 (MUST):** All external links and text shown by the adviser are sanitised (see `NFR-SEC-04`).
- **FR-ADV-06 (SHOULD):** Staff can ask the adviser by typing, and optionally by voice.
- **FR-ADV-07 (SHOULD):** Online use has a monthly spending cap set by the Owner.

### 6.14 Farm Doctor (in place of a site agronomist)
- **FR-DOC-01 (MUST):** Guided diagnosis from symptom to triage row, card and confirm test. It asks for photos and the confirm step before naming a cause.
- **FR-DOC-02 (MUST):** Names look-alike causes and the test that tells them apart (e.g. nematode galls vs acid-soil roots).
- **FR-DOC-03 (MUST):** Online photo review with a stated confidence (high / medium / low). Offline, the rules-based diagnosis, calculators and plan checks still work.
- **FR-DOC-04 (MUST):** Treatment plans already pass Gate 3, rotation, PHI, REI, mixing, timing, the Week 10 organics rule, and stock on hand.
- **FR-DOC-05 (MUST):** Dose calculator (per 16 L knapsack, 500 L and 1,000 L tank) and lime calculator (pH, texture, bed area → route and kg).
- **FR-DOC-06 (MUST):** Checks Gate 0, 1 and 4 evidence and lists anything missing.
- **FR-DOC-07 (MUST):** Schedules a follow-up check 3 days after each treatment and records whether it worked. Drafts the Gate 4 cycle review from the season's records.
- **FR-DOC-08 (MUST):** Never clears a gate, confirms its own diagnosis or approves its own plan. Never recommends a product outside the catalogue or stock, a banned product, or an invented dose. Never confirms a virus or bacterial disease on a photo alone.
- **FR-DOC-09 (MUST):** Recommends a lab sample and notifies the Owner for suspected virus, bacterial wilt, nematodes, or a second low-confidence result.
- **FR-DOC-10 (MUST):** Every output is saved with what it read, its confidence, and who confirmed it.
- **FR-DOC-11 (SHOULD):** The Farm Doctor and the farm adviser (§6.12) share one entry point, so staff don't have to choose between them.

### 6.13 Climate monitoring (optional hardware)
- **FR-CLIM-01 (COULD):** Import temperature and humidity from low-cost loggers in each greenhouse.
- **FR-CLIM-02 (COULD):** Raise disease-risk warnings when humidity stays above a set level for a set time.

---

## 7. Non-functional requirements

### 7.1 Offline and sync
- **NFR-OFF-01 (MUST):** Every field task works fully with no signal.
- **NFR-OFF-02 (MUST):** Records sync automatically when a connection returns, with no action by staff.
- **NFR-OFF-03 (MUST):** A clear icon shows sync state: green cloud = saved online, grey cloud = waiting.
- **NFR-OFF-04 (MUST):** If two phones edit the same record, no entry is lost; the Farm Manager resolves conflicts.
- **NFR-OFF-05 (MUST):** A new app version reaches phones without staff needing to clear data. The app shows "New version — tap to update".

### 7.2 Devices
- **NFR-DEV-01 (MUST):** Runs on low-cost Android phones (2 GB RAM, Android 9 or newer) as an installable web app.
- **NFR-DEV-02 (MUST):** Shared-phone use: several staff on one phone, each with their own sign-in.
- **NFR-DEV-03 (SHOULD):** Battery-friendly: no constant GPS or background activity.

### 7.3 Performance
- **NFR-PERF-01 (MUST):** Any field screen opens in under 2 seconds on the target phone.
- **NFR-PERF-02 (MUST):** Saving a task takes under 1 second offline.

### 7.4 Security and privacy
- **NFR-SEC-01 (MUST):** The sample farm and its shared PIN must be erased before real use. The app warns if real data exists alongside sample data.
- **NFR-SEC-02 (MUST):** Real PINs are unique per person. The phone locks after 5 wrong tries for **[X]** minutes.
- **NFR-SEC-03 (MUST):** API keys live only on the server, never in the app or the code repository.
- **NFR-SEC-04 (MUST):** All user text (notes, voice transcripts, scouting comments) is treated as untrusted and escaped before display. Tests cover script injection through notes and adviser links.
- **NFR-SEC-05 (MUST):** Every change records who made it and when. Records are corrected, never silently deleted.
- **NFR-SEC-06 (SHOULD):** The app auto-signs out after **[X]** minutes idle on shared phones.

### 7.5 Data safety
- **NFR-DATA-01 (MUST):** Daily automatic server backup; the Owner can download a full export.
- **NFR-DATA-02 (MUST):** A lost phone loses nothing that has synced.
- **NFR-DATA-03 (SHOULD):** Records are kept for at least **[5]** seasons for trend analysis.

---

## 8. Core data (outline)

| Entity | Key fields |
|---|---|
| Person | name, face photo, PIN, language, position |
| Position | role, primary zone, backup zone |
| Zone | ID, type (greenhouse/field), QR code, status |
| Crop cycle | zone, crop, variety, planting date, harvest window |
| Soil test | zone or topsoil batch, pH, nematode result, date |
| Topsoil batch | supplier, date, test result, zones used |
| Task | type, zone, position, due, status, photos |
| Scouting record | zone, pest, count, grid location, photos, person |
| Alert | trigger, zone, deadline, escalation level, status |
| Diagnosis | card, answers, photos, confirmed by |
| Treatment | diagnosis, product, dose, intervals, PPE confirmed |
| Stock item | product, quantity, batch, expiry, cost |
| Harvest | zone, weight/crates, grade |
| Sale | buyer, quantity, price, payment status |
| Override | gate, reason, Owner, time |

---

## 9. Acceptance checklist before launch

- [ ] Every MUST requirement passes its test
- [ ] Planting blocked when pH is outside 5.5–7.0 (`FR-GATE-01`)
- [ ] Treatment blocked without a diagnosis (`FR-GATE-04`)
- [ ] Threshold breach escalates correctly with times shortened for testing (`FR-SCOUT-04`)
- [ ] All field screens work in airplane mode, then sync (`NFR-OFF-01/02`)
- [ ] Sample farm erased and real PINs set (`NFR-SEC-01/02`)
- [ ] Owner digest received on the chosen channel (`FR-REP-02`)
- [ ] Injection tests pass (`NFR-SEC-04`)

---

## 9a. After build

- [ ] Two Greenhouse Hands use the field screens in real work, with the training consultant observing (`UX-26`)
- [ ] Problems logged, fixed in one revision round, and re-checked
- [ ] Supervised use of spray and gate screens ends once that round is signed off (`UX-27`)

---

## 10. Open decisions

| # | Decision | Owner |
|---|---|---|
| D-1 | Digest channel: WhatsApp, email, or both | Owner |
| D-2 | ~~Pest thresholds and rotation rules~~ Settled in Build Rules Extract rules-1.1 | Done |
| D-3 | Whether to add Pidgin and other languages at launch | Farm Manager |
| D-4 | ~~Escalation timings~~ Settled: 4 h / 12 h / 24 h (C-12) | Done |
| D-5 | Whether to buy greenhouse climate loggers | Owner |
| D-6 | Which GateField features are already carried over | Owner |
| D-7 | Brand labels for thrips products (Punch, Vanguish, Lion Seal) and others, entered against active ingredients | Farm Manager |
| D-8 | Which lab handles soil/nematode assays and virus samples | Owner |

---

## 11. Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 16 Sep 2026 | First draft |
| 1.4 | 16 Sep 2026 | Field usability trial moved to after build, with a fix round (UX-26, UX-27, §9a) |
| 1.3 | 16 Sep 2026 | OF-02 is the nursery; Farm Doctor replaces site agronomist; active-ingredient catalogue with manager-added labels |
| 1.2 | 16 Sep 2026 | Rev 5/5.1 rules linked; thresholds and escalation filled in; D-2 and D-4 closed |
| 1.1 | 16 Sep 2026 | Section 5 reframed as ease of use for trained staff; written notes and end-of-shift reports added throughout |
