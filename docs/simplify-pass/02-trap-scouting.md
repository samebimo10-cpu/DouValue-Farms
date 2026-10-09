# Simplification pass 2 of 8 — Trap check and scouting

Three sheets: the **trap count** (Count a trap on Home, and a trap-check task's Done — `openTrapSheet`, `web/js/ui/worker.js`), the **scouting round** a photo-proof task opens (`openProofSheet`, same file), and the supervisor's **scouting record** (Scout, on Field — `openScoutSheet`, `web/js/ui/field.js`). Main action: the save button of each, now held at the foot of the sheet (`.sheet .sticky-actions`) so it is in reach however long the form is.

Every count box stays open. A trap count left behind a tap is an alert that never opens (FR-SCOUT-03), so aphids and fruit fly were rated 2, not 3 — only the reasoning around the boxes moved.

### Trap count

| Element | Rating | Where it went |
|---|---|---|
| Title (the task, or "Count a trap") | 2 | Stays |
| Which zone is the trap in? (no task, or a task without a zone) | 2 | Stays |
| Thrips and whitefly on the trap, with + and − (UX-10) | 1 | Stays |
| "Count them on one card. None? Put 0." | 2 | Stays |
| Aphids and fruit fly (if any) | 2 | Stays, open: each has a trap threshold |
| "Leave empty if you did not count them." | 2 | Stays, shortened to "Empty if not counted." |
| Photo of the trap | 1 on a task (FR-PROOF-01), 2 on its own | Stays; on its own the label says "(if you can)" |
| Why the photo (taken now, not the gallery / settles questions later) | 3 | One tap: "Why a photo" (`trap.photo-why`) |
| What did you see? and the phrase chips (UX-09, UX-15) | 2 | Stays |
| Save the count | 1 | Stays, held at the foot of the sheet — main action |
| Call the supervisor (UX-22) | 2 | Stays, under the form |

### Scouting round (photo proof)

| Element | Rating | Where it went |
|---|---|---|
| Title, and what the photo is needed for (FR-PROOF-01) | 1 | Stays |
| Photograph what you checked | 1 | Stays |
| What the photo should show, and why the gallery is not accepted | 3 | One tap: "Why a photo taken now" (`scout.photo-why`) |
| What did you see? and the phrase chips | 2 | Stays |
| "A line is enough. It goes on the record with the picture." | 3 | The box's own placeholder, "A line is enough, e.g. …" |
| Done | 1 | Stays, held at the foot of the sheet — main action |
| Call the supervisor | 2 | Stays |

### Scouting record (Field Supervisor and up)

| Element | Rating | Where it went |
|---|---|---|
| How to scout: walk a diagonal, ten plants, where to look | 3 | One tap: "How to scout a bed" (`scout.method`) |
| Which pest? and its hint (only threshold pests listed; the rest in notes) | 1 | Stays |
| Count on the sticky trap, and its hint | 1 | Stays |
| Average per plant | 1 | Stays; the label now says "counted on ten plants" |
| "Count on ten plants and put the average here." | 4 | Said by the label above |
| What did you find? and its hint | 2 | Stays |
| How many of the ten plants were affected? | 2 | Stays |
| Plants with entry holes, and "over ten goes straight to the Owner" | 2 | Stays |
| Anything else, phrase chips | 2 | Stays |
| Photo of what you found | 2 | Stays |
| "A picture of the leaf or the fruit is worth more than a description." | 3 | One tap: "Why a photo" (`scout.photo-why`) |
| Save scouting | 1 | Stays, held at the foot of the sheet — main action |
| "Not sure what you are looking at? Use the Clinic." | 3 | A button under the form, "Not sure what it is? Open the Clinic" (`scout.clinic`), which goes there |

No record changed: the trap count still writes one `scout.record` per pest counted and the scouting record the same nine fields; `tests/simplify-02-trap-scouting-360.test.mjs` checks the controls of each form against the list before the pass and saves a real trap count.

At 360 × 740 each save button sits at 656–720 px on the open sheet. Before the pass the trap count's was at about 1,090 px and the scouting record's lower still.
