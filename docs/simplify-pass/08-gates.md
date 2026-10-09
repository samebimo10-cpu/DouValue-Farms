# Simplification pass 8 of 8 — The gates screen

Gates (`#/gates`, `web/js/ui/gates.js`): Gate 0 to Gate 4 for every zone, the nursery's batches and the plant-bag media. **No gate changed.** The screen is drawn from the same `gateBoard` and `gateModel` as before; what moved is how much of it is on the screen at once. Overrides are still the Owner's only (FR-GATE-07), from the screen, and UX-27's supervised use still guards every recording. Main action: the first thing that can be recorded for the open zone, now repeated under the heading as **Next for *zone*** — before the pass, on the sample farm, it was the 4th card down at about 2,280 px.

### The heading and the board

| Element | Rating | Where it went |
|---|---|---|
| Gates, *n* blocked / all clear | 1 | Stays |
| Field trial: supervised use (UX-27) | 1 | Stays |
| "Gate 0 to Gate 4 from the rules… the four things that cost Season 1" | 3 | One tap: "What the gates are" (`gates.about`) |
| Next for *zone*: its first condition still blocking, and the button that records it | 1 | New line under the heading — main action. The same button stays on its gate |
| Board: a zone that is blocked, on an override, or open — name, type, planted, a chip per gate, *n* to clear | 1 | Stays |
| Board: a zone with nothing to clear | 3 | One tap: "*n* zones clear" (`gates.clear-zones`) |

### One zone

| Element | Rating | Where it went |
|---|---|---|
| Zone name | 2 | Stays |
| Media batch failed, and every zone it filled | 1 | Stays |
| Planted before the gates — the label, the transplant date, "not a violation, needs no override" (FR-ONB-06) | 1 | Stays |
| Planted before the gates — what it means, and the evidence entered on setup | 3 | One tap: "What this means, and the evidence entered" (`gates.pre-gates`) |
| Already planted behind a closed gate | 1 | Stays |
| Each gate: id, name, state | 1 | Stays. The name was escaped twice ("Cycle Close &amp;amp; Learn"); fixed |
| Each gate: why it is in this state; the G4 cycle it is about | 2 | Stays |
| Each gate: when it applies, what it stops, its evidence, its rules source, its note | 4 | One tap: "About this gate" (`gates.gate-about`) |
| Each condition still to clear — blocked, held, waiting, overridden, planted before the gates — with why and the fix | 1 | Stays |
| Override (Owner only), Put this gate back | 1 | Stays |
| Each condition that has passed | 3 | One tap: "*n* passed" (`gates.passed`) |
| Record a soil test, Log a topsoil delivery, Record: …, Fill bags, Log a media batch | 1 | Stays on its gate |
| Run and save the Farm Doctor check, Confirm, Approve (Owner), Draft the cycle review, waiting for… (FR-GATE-00) | 1 | Stays on its gate |
| Media batches: each batch, its state, what it filled, Correct / Reject / Record a failure, Log a media batch | 1 | Stays |
| Media batches: why batches are tracked (C-19) | 3 | One tap: "Why batches are tracked" (`gates.media-why`) |
| What the gates are reading: soil and media tests, with pH, readings, meter, lab, date | 3 | One tap: "Soil and media tests (*n*)" (`gates.tests`) |
| What the gates are reading: topsoil batches, tested or not, Put it into a zone | 1 | Stays: it has something to do |

### The nursery

| Element | Rating | Where it went |
|---|---|---|
| Hygiene rules (Build Rules §11e) | 1 | Stays |
| "Not a cropping block: nothing is transplanted here…" | 3 | One tap: "What the nursery is" (`gates.nursery-about`) |
| Seedling batches growing, Sow a new batch, each batch with Seedling check / Start hardening / Release check / Discard, release refused | 1 | Stays |
| Released and discarded batches | 3 | One tap: "Released and discarded (*n*)" (`gates.nursery-done`) |

### The sheets

The soil test, topsoil delivery, topsoil assignment, gate evidence, media batch, fill, media end, sow, seedling check, release check and override sheets are unchanged: each records gate evidence, and every box on them is something a gate reads (rating 1–2).

No record changed. `tests/simplify-08-gates.test.mjs` checks that every zone is still on the board and every blocked one on the screen, that every condition of the open zone is still drawn (those still to clear on the screen), that the Owner alone still has Override and UX-27's banner is still shown, and renders each moved element. `tests/simplify-08-gates-360.test.mjs` checks that the main action is in reach at 360 × 740 and that the same button is still on its gate. `tests/gates.test.mjs`, `gatemodel.test.mjs` and `server-gates.test.mjs` are untouched and pass.
