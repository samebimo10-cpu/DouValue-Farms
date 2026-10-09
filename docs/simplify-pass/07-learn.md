# Simplification pass 7 of 8 — The Learn area

Learn (`#/learn` and `#/learn/card`, `web/js/ui/learn.js`), opened from My work only (FR-LEARN-01). Learn is the place a hand goes looking, so by design almost everything on it is what they came for: what FR-LEARN-02 says a card shows stays on the screen. Main action: the **search** on the list, and **Seen this? Report a sick plant** on a card.

### The list

| Element | Rating | Where it went |
|---|---|---|
| Learn, and how many cards match | 2 | Stays |
| "The problems that hit pepper on this farm… Works with no signal." | 2 | Stays: it says Learn works offline. Pass 1 sent Home's version of it here |
| Search (FR-LEARN-03) | 1 | Stays — main action |
| Kind chips: all, pests, diseases, … | 2 | Stays |
| Each card: picture, name, kind, its first sign, Open | 1 | Stays |
| Nothing matched | 2 | Stays |

### A card

| Element | Rating | Where it went |
|---|---|---|
| Name and kind | 1 | Stays |
| Seen this? Report a sick plant | 1 | Moved up from the foot of the card to under its name — main action. Learn links to the report; the report never links to Learn (FR-LEARN-01) |
| Reference photo (FR-LEARN-04) | 1 | Stays |
| Not yet reviewed | 2 | Stays |
| Why it is not yet reviewed | 3 | One tap: "Why" (`learn.drafted`) |
| How to recognise it: what it looks like, each sign with its photo | 1 | Stays |
| Check it by | 2 | Stays |
| How to catch it early | 1 | Stays |
| Often confused with, and the check that tells them apart | 1 | Stays |
| What to do first | 1 | Stays |
| Report a sick plant, under What to do first | 2 | Stays, as a quieter button now the main one is at the top |
| Supervisor: Open the full card | 2 | Stays, labelled with what it holds: "doses, groups, treatment plan" |
| Supervisor: "Doses, rotation groups and the treatment plan are kept off this view…" | 3 | One tap: "Why they are not here" (`learn.full-card-why`) |

No record is written on Learn. The hand's card is unchanged in what it shows and what it leaves out (FR-LEARN-02; `tests/learn.test.mjs` is untouched and passes). `tests/simplify-07-learn.test.mjs` renders the moved elements; `tests/simplify-07-learn-360.test.mjs` checks the search and the card's button are in reach at 360 × 740.
