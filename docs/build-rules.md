# DouValue Farms — Build Rules Extract (Rev 5 + Rev 5.1)
| Field | Value |
|---|---|
| Sources | Farm Operations Schedule Rev 5 (July 2026); Rev 5.1 Acid Soil Correction |
| Precedence | Rev 5.1 wins where the two disagree |
| Machine-readable copy | `douvalue_rules_rev5_1.json` (same content) |
| Rules version | rules-1.2 (decisions C-1 to C-18 applied) |
This extract turns the schedule into rules the app can enforce. It covers gates, thresholds, rotations, spray and mixing rules, soil and water targets, triage, and diagnosis cards. **Section 1 records how each gap or contradiction in the source was settled.** Rules below already reflect those decisions.

---
## 1. Decisions on source gaps and contradictions

| # | Issue | Decision | Reason | Status |
|---|---|---|---|---|
| C-1 | Scouting: daily (Gate 2) vs weekly Day 2 (tables) | **Trap counts daily** in every zone; **full 10-plant round weekly on Day 2**; GH-04/05 get a second round on Day 5 for the first 3 weeks. A missing count turns yellow at end of day and red to the Owner after 2 days. | A trap count takes minutes and is what catches a thrips build-up; the full round is the deeper check. Matches the ">2 days gapped" red flag. | Settled |
| C-2 | Week counting | **Transplant day = Day 1 of Week 0**; Week 1 = days 8–14. Pre-plant tasks are scheduled as days before transplant (T−n). Rev 5 p2 "Week 1 = days 2–8" is an error. | Matches the week headers and the formula. Counting backwards from transplant stops pre-plant work drifting. | Settled |
| C-3 | Response time | **Thrips: same day's spray window. Others: next window, max 24 h.** | Tospovirus is the Season 1 killer; "tomorrow" is too late for thrips. | Settled |
| C-4 | Rain window 3 h vs 4 h | **4 h.** Rain >15 mm within 4 h of spraying → re-spray task. | The longer window also covers the 3 h case. | Settled |
| C-5 | Soil pH 5.2–5.49 | **Hold; re-test after 10 days. Still below 5.5 → quarter rate, 10 days, re-test.** | Route A lime may still be reacting; a small top-up avoids over-liming, which is harder to reverse. | Settled — Farm Doctor checks, Owner approves |
| C-6 | Missing IRAC/FRAC groups | Abamectin **IRAC 6**; wettable sulphur **FRAC M2**; Copper Hydroxide **FRAC M1**; Bt **IRAC 11A**. **Punch / Vanguish / Lion Seal: not selectable until the active ingredient and group are entered from each label.** | Groups are standard. The three brand names don't identify an active ingredient reliably, and a guessed group would defeat the rotation gate. | Superseded by C-18 |
| C-7 | Wound copper and rotation | **Logged as "wound care", excluded from the rotation check.** | At 2 g/L on cuts it is sanitation, not a crop spray; counting it would block the scheduled Copper Oxychloride. | Settled |
| C-8 | No REI; partial PHI | **Default REI 24 h** for all synthetics and copper; **4 h minimum** (and until dry) for organics. **Default PHI 14 days** for any synthetic without a label value, 21 for export. A label value is used only if longer. | Conservative until labels are entered; a default is shown and marked, never blank. | Settled — enter label values |
| C-9 | Mite thresholds | **Broad mite: any confirmed presence → red alert, 24 h. Spider mite: webbing or >5% of plants → alert; isolated specks → re-check in 3 days.** | Broad mite spreads fast through young canopy; spider mite builds more slowly. | Settled |
| C-10 | Bacterial spot card; acid-soil triage | **Bacterial spot card written; acid-soil triage row added (#23).** | Every triage result now links to a card. | Settled — review at Gate 4 cycle review |
| C-11 | Zone IDs | **GH-01–05, OF-01, OF-03, RUK-01.** | Follows the Rev 5.1 block register. | Settled by C-16 |
| C-12 | Escalation timings | **Farm Manager at once → Field Supervisor if not acknowledged in 4 h → Owner if not closed in 12 h → KPI breach at 24 h.** Virus, bacterial wilt, gate overrides, pod borer >10 plants, and any synthetic from Week 10 go straight to the Owner. | Leaves time for the Owner to act inside the 24 h target. | Settled |
| C-13 | Rukpokwu spacing | **40 cm.** | The document's own recommendation for a new open site. | Settled |
| C-14 | *New:* neem cake at "2 weeks before" falls mid-solarisation, and can land within 10 days of lime | **Neem cake at plastic lift (T−7). Route A lime at T−35 to T−28.** | Lifting plastic mid-cycle weakens solarisation; this keeps a 21–28 day lime gap. | Settled |
| C-15 | *New:* from Week 10, Copper Hydroxide (M1) is the only PHI-0 fungicide, which breaks "never the same FRAC twice" | **Repeated M1 allowed from Week 10 at 10–14 day intervals.** | Multi-site M groups carry low resistance risk, and the only alternative is a synthetic inside the PHI. | Settled |
| C-16 | OF-02 status | **OF-02 is the nursery**, not a cropping block. Nursery hygiene rules added, and a seedling release check is now part of Gate 1. | Seedlings are the first route for thrips, virus and damping-off into every block. | Settled |
| C-17 | No site agronomist | **The Farm Doctor takes the agronomist's day-to-day role.** It diagnoses, plans and checks gate evidence; people confirm. Gate 0 and Gate 4 need Farm Manager confirmation and Owner approval. | Keeps a human accountable for every gate and treatment. The nematode assay still needs a lab. | Settled |
| C-18 | Brand labels unknown | **Treatments are chosen by active ingredient** from a fixed catalogue with groups built in. Managers attach brand labels (rate, PHI, REI, photo) to an active. Punch, Vanguish and Lion Seal are removed until entered this way. | The rotation gate works on groups, which the active ingredient fixes; brands can follow later. | Settled |

---

## 2. Zones

| ID | Type | Crop | Spacing (cm) | Note |
|---|---|---|---|---|
| GH-01 | greenhouse | bell pepper | 30 | — |
| GH-02 | greenhouse | bell pepper | 30 | — |
| GH-03 | greenhouse | bell pepper | 30 | — |
| GH-04 | greenhouse | bell pepper | 30 | — |
| GH-05 | greenhouse | bell pepper | 30 | — |
| OF-01 | open_field | habanero | 30 | — |
| OF-02 | nursery | seedlings (bell pepper, habanero) | — | former open field, now the nursery; not a cropping block |
| OF-03 | open_field | habanero | 30 | — |
| RUK-01 | open_field_ridge | habanero | 40 | Rukpokwu extension; 40 cm single row on ridges |

IDs follow the Rev 5.1 block register. OF-02 is now the nursery.

## 3. Gates

### G0 · Ground Clearance

**When:** before planting · **Blocks:** RC1 · **Stops:** transplant

**Pass only when all are true:**
- soil + nematode lab report returned CLEAR
- soil pH 5.5-7.0 from a three-point test on file (with meter photo)
- Farm Doctor check passed, confirmed by Farm Manager and approved by Owner

*On fail:* remediate (solarise / biofumigant / re-site / lime) and re-test

*Source:* Rev 5.1 p5 (replaces Rev 5 p3)

### G1 · Establishment Readiness

**When:** before transplant · **Blocks:** RC2 · **Stops:** transplant

**Pass only when all are true:**
- full input list on-site incl. thrips controls
- drip pressure-tested
- spacing pegged and photographed
- yellow sticky traps installed (1 per 6 m2)
- SOPs live
- scout roster set (covers all zones)
- Route B blocks: 14+ days since hydrated lime
- seedling batch passed the nursery release check (OF-02)

*Evidence:* signed Establishment Checklist

*Source:* Rev 5 p3, p17, p20; Rev 5.1 p3

### G2 · Standing Controls

**When:** continuous from Week 1 · **Blocks:** RC2, RC3

**Pass only when all are true:**
- scouting logged against trap thresholds
- escalation triggers live
- owner verifying daily/weekly

*Evidence:* daily logs, dashboard, escalation register

*Source:* Rev 5 p3

### G3 · Diagnosis before Treatment

**When:** any symptom · **Blocks:** RC4 · **Stops:** treatment

**Pass only when all are true:**
- a diagnosis entry exists and precedes any spray entry

*Flow:* symptom -> diagnostic protocol -> confirmed cause -> matched remedy

*Unconfirmed:* route to Farm Doctor photo review; if still unconfirmed or a lab-only cause is suspected, send a lab sample and notify Owner

*Source:* Rev 5 p3, p24

### G4 · Cycle Close & Learn

**When:** end of cycle · **Blocks:** drift

**Pass only when all are true:**
- root inspection of sample plants
- control audit
- SOPs updated

*Evidence:* Cycle Review document

*Source:* Rev 5 p3

## 4. Recurrence test (KPIs)

| Cause | Proof it works | Red flag |
|---|---|---|
| RC1 | cleared lab report (and pH, per 5.1) on file before any transplant | planting started with no soil report |
| RC2 | daily trap counts logged; threshold-cross to spray under 24 h | trap counts gapped >2 days, or thrips reach 'heavy' with no prior alert |
| RC3 | scouting compliance >95%; dashboard fresh daily | owner learns of a problem from a dead plant, not an alert |
| RC4 | every treatment has a diagnosis recorded before it | a spray logged with no preceding diagnosis |

## 5. Pest thresholds

| Pest | Trigger | Action | Escalate | Watch | Scope |
|---|---|---|---|---|---|
| whitefly | >5 per trap OR >2 per leaf | Thiamethoxam (IRAC 4A) or next group in rotation at the next spray window (max 24 h) | — | — | greenhouse + field |
| thrips | >10 per trap OR >3 per growing tip | same-day rotation spray, Spinosad (IRAC 5) preferred, after 4 PM; re-count to confirm knockdown | — | — | greenhouse + field |
| aphids | colonies on >5% of plants | spray + rotate IRAC; neem/soap for light pressure; cut infested tips | — | — | greenhouse + field |
| helicoverpa pod borer | any 3 plants with active entry | Chlorantraniliprole (IRAC 28) 0.5 ml/L, 4-7 PM; log 'IRAC 28 - pod-borer threshold' | >10 plants with entry holes -> spray whole field today | — | open field, perimeter plants, from Week 3 |
| trend rule | trap counts rising week-on-week | advance the scheduled spray; do not wait for the threshold | — | — | all |
| broad mite | any presence confirmed with a 10x loupe | red alert; Abamectin (IRAC 6) or wettable sulphur on tips within 24 h; bag worst tips | — | — | all |
| spider mite | webbing seen, OR mites confirmed on >5% of plants | alert; rotate miticide within 24 h; fix drought/dust stress | — | isolated specks -> yellow watch, re-check in 3 days | all |

**Scouting round:** 10 plants per house (leaf undersides, growing tips, stem base). Record pest, count, location, sticky trap count per trap. Trap counts: daily, every zone, every trap. Full round: weekly on Day 2 (10 plants per house; field perimeter first). Extra watch: GH-04 and GH-05: full round twice weekly (Day 2 and Day 5) for the first 3 weeks after replant. Missed count: not logged by end of day -> yellow to Field Supervisor; 2 consecutive days missed -> red to Owner. Traps: yellow sticky, 1 per 6 m2 at plant height, installed before transplant. Field: perimeter and windward edge first; pod-borer check weekly from Week 3; crown check for Phytophthora.

## 6. Insecticide rotation (IRAC)

never the same IRAC group twice in a row; check last group before mixing

| # | Product | IRAC | Rate | Time | Targets |
|---|---|---|---|---|---|
| 1 | Cypermethrin 10EC | 3A | 1 ml/L | 4-7 PM | general insects |
| 2 | Thiamethoxam 25WG | 4A | 0.2 g/L | 4-7 PM | whitefly, aphids |
| 3 | Spinosad 45SC | 5 | 0.3 ml/L | after 4 PM only (UV degrades) | thrips |
| 4 | Chlorantraniliprole 200SC | 28 | 0.5 ml/L | 4-7 PM | caterpillars, pod borer, thrips |

Then restart at 3A.

**Other products named in the source:**

| Product | IRAC | FRAC | Rate | Use | Rule |
|---|---|---|---|---|---|
| Lambda-cyhalothrin | 3A | — | 0.5 ml/L | — | — |
| Abamectin | 6 | — | — | broad mite, tips | — |
| Wettable sulphur | UN (miticide use) | M2 | — | broad mite, powdery mildew | — |
| Bt | 11A | — | — | young caterpillars | — |

## 7. Fungicide rotation (FRAC)

never the same FRAC group twice in a row; Metalaxyl-M only in rotation, max every 3rd

| # | Product | FRAC | Rate | Interval (d) | Controls | Note |
|---|---|---|---|---|---|---|
| 1 | Mancozeb 80WP | M3 | 2.5 g/L | 10-14 | broad-spectrum fungal | dry leaves; needs 2 dry hours to bind |
| 2 | Copper Oxychloride 50WP | M1 | 3 g/L | 10-14 | Phytophthora, bacterial | — |
| 3 | Metalaxyl-M + Mancozeb | 4+M3 | 2.5 g/L | 10-14 | Phytophthora (systemic); foliage + soil drench | — |

Then restart at M3. Rainy season (Jun–Sep): 10-day interval.

**Week 10 exception:** From Week 10, Copper Hydroxide (M1) is the only PHI-0 fungicide, so repeated M1 is allowed at 10-14 day intervals. Multi-site M groups carry low resistance risk. This is the only exception to 'never the same FRAC twice'.

**Product rule:** Any product without an IRAC or FRAC group on file cannot be selected for a treatment. Groups are entered once, from the label, when the product is added to stock.

**Other products named:**

| Product | FRAC | Rate | Note | Rotation |
|---|---|---|---|---|
| Copper Hydroxide 50WP | M1 | 2 g/L | — | — |
| Copper (wound spray) | — | 2 g/L | after pruning | logged as 'wound care'; excluded from the FRAC rotation check and interval count |

## 8. Spray rules

| ID | Rule |
|---|---|
| SR-01 | Spray window 4-7 PM (fungicide pre-plant 4-6 PM). |
| SR-02 | Flowering onward: spray only after 5 PM; never onto open flowers; never in wind through the nets. |
| SR-03 | Postpone if leaves are wet; Mancozeb needs 2 dry hours to bind. |
| SR-04 | Open field: if more than 15 mm of rain falls within 4 h after a spray, create a re-spray task for the next dry window. |
| SR-05 | Microbial inoculant (Trichoderma etc.) never within 48 h of any fungicide; never in the same tank. |
| SR-06 | PPE: mask + gloves for sprays; hydrated lime requires goggles, gloves, dust mask, long sleeves, and a logged team briefing. |
| SR-07 | Rinse knapsack 3x after insecticide. |
| SR-08 | From Week 10 (both crops): organics only - neem oil, garlic-chilli, Copper Hydroxide. No synthetic insecticide within 14 days of harvest; keep a 21-day buffer for export. Stop Metalaxyl-M. |

## 9. Pre-harvest and re-entry intervals

| Product | PHI (d) | Export buffer (d) | REI default |
|---|---|---|---|
| Garlic-chilli, Neem oil, Trichoderma | 0 | — | until spray has dried, minimum 4 h (garlic-chilli: eye/skin irritant) |
| Copper Hydroxide | 0 | — | 24 h until label value entered |
| Cypermethrin, Thiamethoxam, Chlorantraniliprole | 14 | 21 | 24 h until label value entered |
| Any other synthetic (Mancozeb, Copper Oxychloride, Metalaxyl-M, Spinosad, Abamectin, sulphur, etc.) | 14 (default until label value entered) | 21 | 24 h until label value entered |

Label value, once entered, is used only if it is longer than the default. The spray screen shows every PHI/REI; a missing label value shows the default marked 'default — check label'. Harvest: harvest tasks in a zone are blocked until the longest PHI of any product applied there has passed. From week 10, synthetics cannot be selected at all (rev 5).

## 10. Mixing rules — never combine

| Never | Do instead |
|---|---|
| Ca Nitrate + K Nitrate in the same tank | separate passes; flush between (white precipitate blocks emitters) |
| Ca Nitrate + Mg Sulphate | different days / separate passes |
| Ca Nitrate + Phosphate | separate passes; flush between |
| Neem oil without soap | premix 150 ml oil + 30 ml soap; use within 8 h |
| Borax above 1.5 g/L | exactly 1 g/L, weighed; tips only |
| Metalaxyl-M consecutively | rotation only, max every 3rd |
| Foliar Ca after first open flower | drench-only Ca |
| Boron within 4 h of Ca | keep 4 h apart |
| Zinc above 2 g/L if grey sheen appears | drop to 1.5 g/L |

## 11. Soil, water and lime

**Soil pH gate:** 5.5–7.0. Test: three points per block; meter calibrated that morning at pH 4.0 and 7.0; 1:1 soil to distilled water, stirred, 10 min; photo of meter. Below 5.2: apply half the original rate again, add 10 days; never stack a full dose. From 5.2 to 5.49: block HELD; re-test after 10 days (Route A lime may still be reacting). Still below 5.5 -> apply one-quarter of the original rate, wait 10 days, re-test. Farm Doctor checks the plan; Owner approves.. Area: greenhouse: bed area only; open field: full cropped area.

**Irrigation water pH:** 5.8–6.5; above 7.0 add citric acid 5 g / 10 L.

| EC measure | Target (mS/cm) |
|---|---|
| Plain water | 0.3–0.8 |
| Fertigation, vegetative | 1.8–2.8 |
| Fertigation, fruiting | 2.0–3.0 |
| Above 3.5 | Stop; flush 60 min before fertigating |

**Lime — Route A (preferred):** block not yet under solarisation plastic. dolomitic agricultural lime, finest grade; with compost at start of solarisation; incorporate 15-20 cm; irrigate. two-thirds of full requirement; re-test at end of solarisation; balance after harvest.

**Lime — Route B (fast):** already solarised and transplant <3 weeks away. hydrated lime Ca(OH)2; target pH 5.8; transplant no sooner than 14 days; 21-day nitrogen blackout — replace Wk1 Day6 NPK 20-10-10 and Wk2 Day6 NPK 15-15-15 with Calcium Nitrate 2-3 g/L; resume NPK Week 3.

| Texture | Route A ag lime (kg / 100 m²) | Route B hydrated lime (kg / 100 m²) |
|---|---|---|
| loamy sand | 10-13.5 | 8-10 |
| sandy loam | 16.5-23.5 | 12-15 |
| loam / clay loam | 26.5-33.5 | 18-22 |

**Neem cake:** Neem cake goes in when the solarisation plastic is lifted (T-7), not mid-solarisation. Route A lime at T-35 to T-28 gives a 21-28 day gap. Route B: at least 10 days after the hydrated lime.

**Timing locks:** neem cake at least 10 days after lime; urea only if 21+ days since any lime (otherwise Calcium Nitrate).

**Nitrogen at planting:** urea in the planting hole is DELETED (Rev 5.1); starter P placed near root zone; Calcium Nitrate 2-3 g/L weekly from Day 10-14 after transplant.

**Do not buy:** gypsum (no pH effect), charcoal, compost alone, liquid pH 'soil conditioners'. Fallback: hardwood ash only, max 150 g/m2, counted as ~1/3 strength of hydrated lime. Open field re-limes a season sooner than houses.

## 11a. Week counting and pre-plant offsets

Transplant day = T = Day 1 of Week 0. Week n covers days 7n+1 to 7n+7 (Week 0 = days 1-7, Week 1 = days 8-14). week = floor((date - T) / 7). Pre-plant tasks are scheduled as days before transplant (T-n), not as week days. Rev 5 p2 'Week 1 = days 2-8' is an error and is superseded.

| Greenhouse task | When |
|---|---|
| lime + compost + clear plastic (Route A) | T-35 to T-28 |
| lift plastic, air 2 days | T-7 |
| neem cake | T-7 (at plastic lift) |
| soil final prep + pH gate | T-5 |
| pre-plant fungicide | T-3 |
| pre-plant insecticide | T-1 |
| transplant | T |
| water + day-1 check | T+1 |

| Field task | When |
|---|---|
| lime + compost + clear plastic (Route A) | T-35 to T-28 |
| lift plastic | T-7 |
| neem cake | T-7 |
| land prep + pH gate + mulch | T-4 to T-2 |
| transplant | T |
| watering + day-1 care | T+1 to T+2 |

## 11b. Alerts and escalation

**Deadlines:** thrips — treat at the same day's spray window (4-7 PM); if the breach is logged after 7 PM, the next day's window; other thresholds — next spray window, never later than 24 h.

| Time | Goes to |
|---|---|
| 0 h | Farm Manager |
| 4 h not acknowledged | Field Supervisor |
| 12 h not closed | Owner |
| 24 h not closed | Owner, marked KPI breach |

**Straight to the Owner:** suspected virus (tospovirus, mosaic); bacterial wilt; gate override; pod borer >10 plants; any synthetic logged from Week 10.

## 11c. Farm Doctor (replaces site agronomist)

In-app diagnostic and planning assistant that takes the place of the site agronomist for day-to-day decisions. It advises; people decide.

**It does:**

- Guided diagnosis: symptom -> triage row -> card -> confirm test, asking for photos and the confirm step before naming a cause.
- Differentials: names look-alikes and the test that separates them (e.g. nematode galls vs acid-soil stubby roots; Fusarium vs bacterial wilt water test).
- Photo review when online, with a stated confidence (high / medium / low).
- Treatment plan that already passes every rule: Gate 3, IRAC/FRAC rotation, PHI, REI, mixing rules, spray timing, Week 10 organics-only, product in stock.
- Dose calculator: label or schedule rate -> amount per 16 L knapsack and per 500 L / 1,000 L tank.
- Lime calculator: pH readings + texture + bed area -> route, product and kg.
- Gate reviews: checks the evidence for Gates 0, 1 and 4 against the rules and lists anything missing.
- Follow-up: schedules a check 3 days after each treatment and records whether it worked.
- Cycle review draft for Gate 4 from the season's records.

**It never:**

- Clears a gate, confirms its own diagnosis, or approves its own plan.
- Recommends a product that is not in the active-ingredient catalogue, not in stock, or blocked by rotation/PHI.
- Recommends banned products (e.g. carbofuran / Furadan).
- Invents a dose where neither the schedule nor an entered label gives one.
- Names a virus or bacterial disease as confirmed on a photo alone.

| Decision | Who confirms |
|---|---|
| diagnosis | Field Supervisor or Farm Manager performs the confirm test and confirms |
| treatment plan | Farm Manager approves |
| gate 0 and gate 4 | Farm Manager confirms; Owner approves |
| virus, bacterial wilt, nematode, or confidence low | Owner notified; lab sample recommended |

**Lab still required for:** Gate 0 soil + nematode assay (cannot be replaced by the app); suspected tospovirus or other virus when the pattern is unclear; bacterial wilt if the water test is inconclusive; any diagnosis the Farm Doctor rates low confidence twice.

**Offline:** Rules-based guided diagnosis, calculators and plan checks work with no signal; photo review needs a connection. Every Farm Doctor output is saved with what it read, its confidence, and who confirmed it.

## 11d. Active-ingredient catalogue and labels

Treatments are chosen by active ingredient. Brand products are optional labels attached to an active ingredient.

| Active ingredient | Type | Group | Schedule rate | PHI (d) |
|---|---|---|---|---|
| Cypermethrin | insecticide | IRAC 3A | 1 ml/L (10EC) | — |
| Lambda-cyhalothrin | insecticide | IRAC 3A | 0.5 ml/L | — |
| Thiamethoxam | insecticide | IRAC 4A | 0.2 g/L (25WG) | — |
| Imidacloprid | insecticide | IRAC 4A | — | — |
| Acetamiprid | insecticide | IRAC 4A | — | — |
| Spinosad | insecticide | IRAC 5 | 0.3 ml/L (45SC), after 4 PM | — |
| Spinetoram | insecticide | IRAC 5 | — | — |
| Abamectin | insecticide/miticide | IRAC 6 | — | — |
| Emamectin benzoate | insecticide | IRAC 6 | — | — |
| Bacillus thuringiensis (Bt) | biological insecticide | IRAC 11A | — | — |
| Chlorantraniliprole | insecticide | IRAC 28 | 0.5 ml/L (200SC) | — |
| Azadirachtin / neem oil | botanical | IRAC UN | 150 ml cold-pressed oil + 30 ml soap / 16 L | 0 |
| Garlic-chilli extract (farm-made) | botanical | none | see prep table | 0 |
| Sulphur (wettable) | fungicide/miticide | FRAC M2 | — | — |
| Copper oxychloride | fungicide/bactericide | FRAC M1 | 3 g/L (50WP) | — |
| Copper hydroxide | fungicide/bactericide | FRAC M1 | 2 g/L (50WP) | 0 |
| Mancozeb | fungicide | FRAC M3 | 2.5 g/L (80WP) | — |
| Metalaxyl-M + Mancozeb | fungicide | FRAC 4 + M3 | 2.5 g/L | — |
| Trichoderma harzianum | biological | BM02 | 5 g/L GH; 2.5 g/L field | 0 |
| Bacillus subtilis | biological | BM02 | per label | — |

**A manager adding a label enters:** select one or more active ingredients from the catalogue (group fills in automatically); brand name and formulation (e.g. 45SC, 80WP) and concentration; label rate; label PHI and REI (blank allowed: defaults apply); photo of the label.

**Dose rule:** Dose comes from the schedule rate for that active and formulation, or from an entered label. If neither exists, the product cannot be used until a label rate is entered.

Punch, Vanguish and Lion Seal are removed until a manager enters them as labels against their active ingredients. An active ingredient not in the catalogue can only be added by the Owner, with its IRAC/FRAC group. Banned: Carbofuran (Furadan).

**Thrips programme:** Rotate thrips treatments by group, never the same group twice running. IRAC 5: spinosad (preferred) or spinetoram; IRAC 6: abamectin or emamectin benzoate; IRAC 28: chlorantraniliprole; IRAC 4A: thiamethoxam. Actives without a schedule rate need a label entered before use.

## 11e. Nursery (OF-02)

Seedlings carry thrips, tospovirus and damping-off into every block; the nursery is the first green bridge.

- Nursery media must be clean: sterilised, solarised or bought-in; never raw soil from a cropping block.
- Daily trap count and a twice-weekly seedling check (thrips, damping-off, virus symptoms).
- No old crop debris, culls or volunteer peppers within 5 m of the nursery; crop waste is burned or buried far from it (Rev 5).
- Staff move nursery first, cropping blocks after; never from a block back into the nursery the same day without washing hands and changing over-clothes.
- Damping-off, virus or thrips above threshold in the nursery opens an alert like any other zone.

**Seedling release check:** hardened 7+ days; no virus symptoms (ring/line patterns, mottling); no thrips on a tap test; no damping-off in the batch; batch ID recorded against the block it goes to. Seedling release check is added to Gate 1; a block cannot log transplant without a released seedling batch.

## 12. Irrigation

| Crop | Session | Skip if |
|---|---|---|
| GH bell | 6:30 AM 20 min | never |
| GH bell | 1 PM 15 min | net-wall condensation AND soil moist 5 cm deep |
| GH bell | 5 PM 20 min | never |
| Field habanero | 6:30 AM 30 min dry / 20 min rainy | >25 mm rain previous day |
| Field habanero | 5 PM 20 min | >15 mm rain today |
| All | water 7 days a week | never skip Day 7 |

## 13. Harvest grading

| Grade | Criteria | Market |
|---|---|---|
| A | uniform, full colour, firm, no marks; bell 70-90 mm, habanero 35-50 mm | export / hotels |
| B | minor cosmetic marks; full size and colour | local retail |
| C | undersized / irregular, no rot | processors - always sell |
| Reject | rot, disease, insect through flesh, soft | remove far from crop |

## 14. Field triage (23 entries)

| # | What you see | Likely cause (card ID) | Quick confirm | First action |
|---|---|---|---|---|
| 1 | Silvery flecks/streaks on leaves and tips; tiny slivers that jump | thrips | Tap a tip over white paper; check trap count | Rotate thrips spray (Spinosad IRAC 5) if over threshold; log and re-count |
| 2 | Leaves curl down, tips distort, bronze/greasy sheen, no insect visible | broad_mite | 10x loupe on youngest tips: glassy oval mites/eggs | Abamectin or wettable sulphur on tips; remove worst tips |
| 3 | Fine webbing under leaves; pale stippling; leaves dry out | spider_mite | Webbing + moving dots under leaves | Miticide (rotate); raise humidity slightly; remove worst leaves |
| 4 | Sticky honeydew + sooty mould; tiny white flies rise when disturbed | whitefly | Trap >5 or >2/leaf | Thiamethoxam (IRAC 4A) / rotate; traps; sanitation |
| 5 | Curled new leaves; soft green/black insect clusters on shoots | aphids | Colonies on >5% of plants | Spray + rotate; remove infested tips |
| 6 | Ring/line patterns, mottling, bronzing; stunted one-sided growth | tospovirus | Pattern + thrips history; lab if unsure | No cure: rogue and bag; control thrips hard |
| 7 | Yellow-green mosaic; puckered distorted growth | mosaic_virus | Spreads along a row after pruning | Rogue and bag; sanitise blade between every plant; wash hands; control aphids |
| 8 | Sudden whole-plant wilt; dark lesion at soil-line crown; roots rot | phytophthora | Cut crown: brown streak; wet soil history | Improve drainage; Metalaxyl-M drench plant + 4 neighbours; remove dead |
| 9 | Wilts by day, recovers at night, then dies; one-sided yellowing | fusarium_wilt | Cut lower stem: brown vascular ring | No cure: remove; rotate; solarise |
| 10 | Rapid wilt, leaves still green, stem base oozes | bacterial_wilt | Cut stem in clear water: milky ooze streams | No cure: remove and bag; stop water spread; no peppers there again |
| 11 | Dark water-soaked scabby spots on leaves and fruit | bacterial_spot | Yellow halo; worse after rain | Copper sprays; remove worst leaves; don't work wet plants |
| 12 | Sunken dark concentric spots on fruit; salmon spore ooze | anthracnose | Spots enlarge with rings | Remove fruit; rotate fungicide; tighten harvest interval |
| 13 | Grey fuzzy mould on stems/fruit in humid corners | botrytis | Grey spores on dead/wounded tissue | Airflow (prune); remove affected parts; rotate fungicide |
| 14 | White powdery patches under leaves; yellow blotches on top | powdery_mildew | Powder wipes off | Sulphur / rotate fungicide; airflow |
| 15 | Seedlings topple at soil line; thin water-soaked stem | damping_off | Stem pinched and brown at base | Reduce water; Trichoderma; clean media; discard collapsed |
| 16 | Dark sunken leathery patch at fruit bottom | blossom_end_rot | Position + Ca-drench history | Ca drench 1.8 kg/1,000 L; regular irrigation |
| 17 | Hollow light misshapen pods; poor set; flower drop | boron_deficiency | Check boron programme | Borax 1 g/L weekly on tips (max 1.5) |
| 18 | Pale sunken papery patch on sun-facing side of fruit | sunscald | Fruit exposed after heavy leaf strip | Keep fruit-shading canopy |
| 19 | Ring or radial cracks on ripening fruit | fruit_cracking | Dry spell then heavy water | Regular irrigation; steady Ca; harvest promptly in wet spells |
| 20 | Chewed pods, entry holes with dark frass; caterpillar inside | helicoverpa | Cut a suspect pod: larva + frass | IRAC 28 at threshold (3 plants); scout perimeter weekly |
| 21 | Roots knotted with galls; stunted, wilting, starved | root_knot_nematode | Pull a plant: beaded galls | No rescue: Gate 0 next cycle; rogue severe plants |
| 22 | Seedlings cut off at soil line overnight | cutworm | Grey curled larva in soil nearby | Neem cake; hand-collect at dusk; collars |
| 23 | Stunted pale starved plants; stubby thickened roots with dead tips, NO galls; purpling older leaves | acid_soil | Three-point pH test (below 5.5) | Hold with nitrate nutrition + Ca Nitrate; place P; lime post-harvest (Rev 5.1) |

**Root read** (any plant still collapsed by 6 PM from Day 3): white firm = water only · brown slimy = rot · red/brown galls = nematode · stubby, thickened, dead-tipped, no galls = acid soil.

## 15. Diagnosis cards (22)

| ID | Type | Cause | Prevention | Detection | Treatment | Status |
|---|---|---|---|---|---|---|
| thrips | pest | Slender insects rasping leaf/flower; key threat is carrying tospovirus (RC2). | Traps from day one; IPM; thrips inputs pre-stocked (G1); remove weeds/volunteers. | Trap counts vs threshold (>10/trap or >3/tip); tap tips over white paper; rising trend. | Same-day rotation spray after threshold, rotating by group (see thrips programme; Spinosad IRAC 5 preferred), after 4 PM; re-count. | — |
| broad_mite | pest | Microscopic mites on youngest tips; damage looks like virus/herbicide injury. | Loupe scouting of tips; don't carry mites between plants; reduce stress. | Down-curled bronzed tips with no visible insect; loupe shows glassy mites/eggs. | Abamectin or wettable sulphur on tips (rotate, observe PHI); bag worst tips; treat early. | — |
| whitefly | pest | Sap-sucking flies; honeydew -> sooty mould; transmit begomoviruses. | Yellow traps; net-wall vigilance; remove infested lower leaves; weeds. | Clouds when disturbed; >5/trap or >2/leaf; honeydew + mould. | Thiamethoxam (4A) or next group; undersides 4-7 PM; never repeat a group. | — |
| aphids | pest | Soft insects on shoots/undersides; efficient virus vectors. | Scouting; keep natural enemies; remove infested tips; control ants. | Curled new growth, honeydew, colonies; threshold >5% of plants. | Spray + rotate IRAC; neem/soap if light; cut infested tips. | — |
| spider_mite | pest | Tiny mites in hot dry dusty conditions. | Avoid dust/drought stress; scout undersides in dry spells. | Fine webbing, moving specks; stippled then bronzed upper surface. | Miticide (rotate actives); remove worst leaves; fix the stress. | — |
| helicoverpa | pest | Helicoverpa armigera bores buds/pods; can take 40-60% of habanero. | Weekly perimeter scouting from Week 3; pheromone/light monitoring; Bt for young larvae. | Cream/brown caterpillars; entry holes with frass; pod damage hidden. | At 3 plants: IRAC 28 0.5 ml/L 4-7 PM; whole field if >10 plants. | — |
| cutworm | pest | Night-feeding caterpillars severing seedlings at soil line. | Neem cake in holes; clean beds; collars. | Seedlings cut overnight; grey curled larva nearby. | Hand-collect at dusk; neem cake; bait only if severe. | — |
| root_knot_nematode | soil | Roundworms gall roots; plant can't take up water/nutrients (RC1). | Gate 0 soil + nematode assay; solarisation 3-4 wks; neem cake; rotation; never replant untested beds. | Stunting, mid-day wilt no spray fixes; beaded galls on pulled roots. | No rescue: isolate sub-zone; nematode protocol within PHI (Farm Doctor plan, Owner approval); if severe terminate + solarise; fix at Gate 0. | — |
| phytophthora | disease | P. capsici in wet, poorly drained soil; crown/root rot, sudden collapse. | Drainage and ridging; 12 cm mulch; avoid waterlogging; Trichoderma; copper in rotation. | Sudden wilt; dark crown lesion; brown streak in cut crown; deaths in wettest spots. | Fix drainage now; Metalaxyl-M drench plant + 4 neighbours (rotation only); remove dead plants. | — |
| fusarium_wilt | disease | Soil fungus blocking water vessels; persists for years. | Clean/tested soil; solarisation; rotation; resistant varieties. | Day wilt, night recovery, then death; brown vascular ring. | No cure: remove; no peppers there without solarisation/rotation. | — |
| bacterial_wilt | disease | Ralstonia; rapid wilt with green leaves; spreads in water/soil. | Clean soil; drainage; rotation; tool sanitation; stop water movement. | Fast wilt, green leaves; cut stem in water shows milky threads. | No cure: remove and bag; stop water spread; solarise; no solanaceous crops there. | — |
| anthracnose | disease | Colletotrichum; sunken rotting fruit spots; major market loss. | Airflow; fungicide rotation; remove infected fruit; avoid overhead wetting. | Sunken dark concentric spots; salmon spore ooze. | Destroy infected fruit; rotate to effective fungicide; tighten interval; harvest promptly. | — |
| botrytis | disease | Grey mould on wounded/senescing tissue in humid still air. | 5 cm gap + door ventilation; remove debris; don't leave wounds wet. | Grey fuzz on stems/flowers/fruit, esp. under large fruit. | Improve airflow; remove affected parts; rotate fungicide. | — |
| powdery_mildew | disease | White powder fungus reducing photosynthesis. | Airflow; avoid dense canopy; sulphur in programme. | White patches (undersides first), yellow blotches on top; wipes off. | Sulphur or rotate fungicide; remove worst leaves; open canopy. | — |
| damping_off | disease | Soil fungi collapsing seedlings in wet crowded nurseries. | Clean media/trays; don't over-water; airflow; Trichoderma media. | Seedlings topple; pinched brown stem base. | Cut watering; airflow; discard collapsed; Trichoderma drench. | — |
| tospovirus | virus | Thrips-borne TSWV (RC2); incurable once systemic. | Control thrips from day one (G1/G2); remove weed hosts; rogue early. | Ring/line patterns, bronzing, one-sided stunting; match thrips history; lab if unsure. | No cure: rogue and bag; hit thrips hard (same-day). | — |
| mosaic_virus | virus | Sap-transmitted on blades and hands during pruning. | Sanitise blade between every plant; wash hands; rogue; control aphids; avoid tobacco. | Mosaic/mottle, puckered leaves; affected line follows pruning direction. | No cure: rogue and bag; reinforce sanitation; remove source plants. | — |
| blossom_end_rot | disorder | Calcium gap or irregular water during fruit fill. | Never miss Ca drench; regular irrigation; split Ca Day 1/Day 4. | Dark sunken leathery patch at blossom end. | Ca Nitrate drench 1.8 kg/1,000 L; regularise water. | — |
| boron_deficiency | disorder | Endemic Niger Delta deficiency. | Borax 1 g/L weekly on tips through set; 4 h from Ca. | Hollow deformed pods; poor set; flower drop despite good pest control. | Borax exactly 1 g/L weekly; never >1.5 g/L. | — |
| sunscald_cracking | disorder | Sunscald: exposed fruit burns. Cracking: dry spell then flood. | Keep fruit-shading canopy; steady irrigation; steady Ca. | Pale papery sun-side patch; ring/radial splits. | Restore canopy; regular irrigation; harvest promptly in wet spells. | — |
| acid_soil | soil | pH <5.5: Al/Mn toxic to root tips; P locked; Ca/Mg leached (Rev 5.1). | Gate 0 pH test; lime in solarisation window; re-test every cycle. | Stunted, pale; stubby thickened roots, dead tips, NO galls; purpling older leaves; pH test. | No mid-cycle fix: nitrate nutrition + Ca Nitrate; place P; lime post-harvest. | — |
| bacterial_spot | disease | Bacteria (Xanthomonas) spread by rain splash, wet handling, tools and infected transplants; worst in warm wet weather. | Clean seedlings; copper in the fungicide rotation; drip not overhead water; don't work plants when wet; sanitise tools; remove crop debris. | Small water-soaked leaf spots turning dark and scabby with a yellow halo; raised scabby spots on fruit; spreads after rain. | Copper sprays (M1) in rotation; remove worst leaves; stop handling wet plants. Infected tissue does not recover. | drafted from Rev 5 triage + standard agronomy; review at the Gate 4 cycle review |
