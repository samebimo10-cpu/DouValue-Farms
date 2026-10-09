# Simplification pass 3 of 8 — Sick-plant report

Report a sick plant (`#/sick-plant`, `web/js/ui/sickplant.js`). It was built short (FR-DIAG-07): zone, photos, where on the plant, how many, send — no triage rows, cards, confirm tests or look-alikes. Almost everything on it is category 1 or 2, so the pass changes little. Main action: **Next** on each step, **Send** on the last, and **Back to My work** once sent.

| Element | Rating | Where it went |
|---|---|---|
| Step dots (four steps) | 2 | Stays |
| Which zone? — a picture tile per zone, yours first and marked "(yours)" | 1 | Stays |
| Take a photo, with the count of photos taken | 1 | Stays |
| "Get close to the sick part. Take more than one if you can." | 2 | Stays: it is how to take the photo |
| Photo of the plant, Add this photo, the thumbnails with Remove | 1 | Stays |
| Where on the plant? — picture tiles, "Tap every one that looks wrong" | 1 | Stays |
| How many plants? — picture tiles | 1 | Stays |
| Is it on the plants next to them too? — picture tiles | 1 | Stays (FR-DIAG-09 reads it) |
| Back | 2 | Stays |
| Next / Send | 1 | Stays, held at the foot of the screen — main action |
| Sent: "Report sent", and who it went to by name (FR-DIAG-08) | 1 | Stays |
| Sent: "Alert raised", and why (wilting, spreading, more than five) | 1 | Stays |
| Sent: how the alert climbs — 4 h to the Field Supervisor, 12 h to the Owner | 3 | One tap: "What happens next" (`sick-plant.ladder`) |
| Sent: "They will look at the plant… you will see the answer on My work" | 3 | One tap: "What happens next" (`sick-plant.next`), which now also names "Your sick-plant reports" (pass 1) |
| Back to My work | 1 | Stays — main action once sent |
| Report another | 2 | Stays |

No record changed: the report still files zone, photos, where, how many, spreading and the names it went to. `tests/simplify-03-sick-plant-360.test.mjs` walks the four steps in Chrome at 360 × 740, checks Next or Send is in reach on each, sends a serious report and reads the record back.
