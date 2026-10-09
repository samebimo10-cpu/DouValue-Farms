# Simplification pass 4 of 8 — Harvest entry

Log harvest, from Record something on My work (`openHarvestSheet` and `renderHarvestBody`, `web/js/ui/worker.js`). Main action: **Save**, held at the foot of the sheet.

| Element | Rating | Where it went |
|---|---|---|
| Title, "Log harvest" | 2 | Stays |
| Which bed? | 1 | Stays. It now redraws the form when a bed is chosen on a phone; see the fix below |
| Spray history missing: no picking, and what clears it | 1 | Stays |
| Inside the PHI: "Not safe to pick", the product and date, *n* more days, "Tell the supervisor" | 1 | Stays |
| Inside the PHI: picking early puts the buyer and the market at risk | 3 | One tap: "Why it matters" (`harvest.phi-why`) |
| Inside re-entry: "Wear your gloves and boots" | 1 | Stays |
| Inside re-entry: which spray, and how many hours | 3 | One tap: "Why" (`harvest.reentry-why`) |
| Crop, local name and stage of the bed (e.g. "Habanero (ata rodo) — Picking") | 4 | One tap: "About this bed and the crates" (`harvest.about`) — the bed's name and variety are already in Which bed? |
| Crates | 1 | Stays |
| "One crate is counted as 12 kg. Change that in Settings…" | 3 | One tap: "About this bed and the crates" |
| Kilograms (if you weighed it) | 2 | Stays |
| "Leave this empty and the app works it out from the crates." | 3 | The box's placeholder, "empty: worked out from the crates", and in full under "About this bed and the crates" |
| Grade — first, second, reject | 1 | Stays |
| Note | 2 | Stays (UX-08), two lines instead of three |
| Photo of the crates | 2 | Stays; the label says "(if you can)" |
| "Not required, but a picture taken at the bed settles any question later." | 3 | One tap: "About this bed and the crates" |
| Save | 1 | Stays, held at the foot of the sheet — main action |
| What you picked today (moved here in pass 1) | 3 | Stays here, behind "What you picked today: *n* kg" (`home.picked-today`) |

No record changed: a picking still files bed, kilograms, crates, grade, note, photo, the day and when it was entered. `tests/simplify-04-harvest-360.test.mjs` checks the form's controls against the list before the pass, saves a real picking in Chrome and reads every field back, and opens the PHI block. At 360 × 740 Save sits at 656–720 px on the open sheet; before the pass it was at about 913 px.

**Fix found on the way** (its own commit, before this one): choosing a bed on a phone did nothing, because a select's action ran only on a click and a phone's picker sends none after the choice. The form stayed on the first bed, so a picking from a second bed was saved against the first — and a bed still inside its PHI was never checked. Selects now act on change (`web/js/ui/shell.js`, `tests/select-change.test.mjs`). The same fix makes the spray form's dose and waiting-period hints follow the product chosen.
