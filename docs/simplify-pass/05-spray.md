# Simplification pass 5 of 8 — Spray screen

Log spray, from a bed on Field (`openSpraySheet`, `openSprayForm`, `updateSprayHints` and `saveSpray`, `web/js/ui/field.js`; the gear in `web/js/ui/ppe.js`; the UX-27 check in `web/js/ui/supervise.js`). Main action: **Save spray**, held at the foot of the form.

`docs/simplify.md` §4: safety information is category 1, not clutter. **PPE, re-entry, pre-harvest interval and dose stay prominent; only what surrounds them goes.** So nothing safety-related moved behind a tap, and the safety notes moved *up*: before the pass they sat under the litres, area, target and operator boxes, at about 1,030 px; now they sit straight under the active ingredient they belong to, at about 390 px, on the first screen of the form. No gate, rotation, PHI/REI, Week 10 rule or Farm Doctor limit changed.

### Before the form: who is there, and the gear

| Element | Rating | Where it went |
|---|---|---|
| UX-27 supervised use: who must be present, tap your name, Not now | 1 | Unchanged — it is a rule, not clutter |
| Gear pictures, each with what it is for (FR-TREAT-04) | 1 | Unchanged, every item on the sheet |
| The rule line ("PPE: mask + gloves for sprays…") | 1 | Unchanged |
| Also / Team briefing first / When you finish | 1 | Unchanged |
| Not yet / I am wearing all of this | 1 | Unchanged. Deliberately not held in reach like a save button: the confirmation comes after the last picture |

### The form

| Element | Rating | Where it went |
|---|---|---|
| Log a spray, and the bed | 2 | Stays |
| Supervisor confirmed as present / Field trial: supervised use | 1 | Stays |
| Rain forecast for the next hours, and "Hold the spray" (SR-04, open field) | 1 | Stays |
| SR-04 rule text: more than 15 mm within 4 h washes it off, re-spray added | 3 | One tap: "About rain and spraying (SR-04)" (`spray.sr04-rule`) |
| Active ingredient, with its resistance group | 1 | Stays |
| **Waiting period: *n* days before picking, safe to pick from *date*** (FR-TREAT-02) | 1 | Stays, moved up under the active ingredient |
| **Nobody goes back in without protective gear for *n* hours** (FR-TREAT-02) | 1 | Stays, same note |
| Resistance group | 2 | Stays, same note |
| **Rate** (FR-TREAT-03) | 1 | Stays, moved up |
| Where the rate comes from (schedule, or the label entered for a brand) | 3 | One tap: "Where this rate comes from" (`spray.rate-source`) |
| Week 10: organics only | 1 | Stays, moved up |
| Rotation / Week 10 / thrips-programme refusal for the product chosen | 1 | Stays, moved up |
| Which rules file entry refused it ("Read from rules/…json#/…") | 4 | One tap: "Which rule" (`spray.refusal-source`) |
| Expired stock | 1 | Stays, moved up |
| **Mixing: litres, knapsack loads, ml of product per load** (FR-TREAT-03) | 1 | Stays, moved up |
| Spray safety rules (gear, wind, time of day, eating, mixing, containers, pregnant or under 18) | 1 | Already behind "Spray safety rules" before the pass; unchanged |
| Brand used, Date | 2 | Stays |
| Litres of mix sprayed, Area treated, with their hints (FR-TREAT-01) | 1 | Stays |
| What were you treating?, Who sprayed? | 2 | Stays |
| Note | 2 | Stays, two lines instead of three |
| Photo of the container | 2 | Stays |
| Why a photo of the container (the label carries the real PHI and rate) | 3 | One tap: "Why a photo of the container" (`spray.photo-why`) |
| Save spray | 1 | Stays, held at the foot of the sheet — main action |
| Actives not offered because no rate is entered (FR-STOCK-08) | 3 | One tap under the form: "Not in the list" (`spray.not-offered`) |

### After Save

| Element | Rating | Where it went |
|---|---|---|
| Spray history missing / Waiting on approval / Not this product / Diagnose it first, with what to do | 1 | Stays |
| Rotation refused: "Resistance does not wear off…" | 3 | One tap: "Why rotation matters" (`spray.rotation-why`) |
| Refused on the product: which rules it was read from | 4 | One tap: "Which rule" (`spray.refusal-source`) |
| Check the plant now / Report a sick plant | 1 | Stays |
| Record this spray? — zone, against, active, brand, group, rate, mix, **no picking until, keep people out for** (UX-21) | 1 | Unchanged |
| Treated before approval (FR-ROLE-13) | 1 | Unchanged |

No record changed: a spray still files every field it did, the gear confirmation time among them. `tests/simplify-05-spray.test.mjs` holds the record, the UX-21 summary and the gear sheet from the source; `tests/simplify-05-spray-360.test.mjs` opens the gear and the form in Chrome at 360 × 740 and checks that every gear item is a picture on the sheet, that the waiting period, re-entry, rate and mixing are on the first screen of the form and behind no tap, that they follow the product chosen, and that Save spray is in reach (it was at about 2,280 px).
