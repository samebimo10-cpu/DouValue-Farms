# Simplification pass 6 of 8 — End-of-shift report

End of shift (`#/shifts`, `web/js/ui/shift.js`), opened from My work. The person's own report, and below it the Farm Manager's board of everybody's (FR-TASK-05). Main action: **Write today's report**, then **Send it to the farm manager**, held at the foot of the sheet.

### The screen

| Element | Rating | Where it went |
|---|---|---|
| End of shift, today's date (or "*n* of *m* in" for the manager) | 2 | Stays |
| What the report is for: not a problem report, the day itself, the manager answers it | 3 | One tap at the top: "What this report is for" (`shift.purpose`). Pass 1 sent Home's version of this here |
| Your report for today — the prompt "What did you see, and what did you do about it?" (UX-09) | 1 | Stays |
| "A few words is enough… the only record of the day in your own words… read first tomorrow" | 3 | One tap: "What this report is for" (`shift.purpose`) |
| Write today's report | 1 | Stays — main action |
| Filed: your report, the time, any comment from the manager | 1 | Stays |
| Filed: your earlier reports, with read / answered | 3 | One tap: "Your earlier reports (*n*)" (`shift.earlier`) |
| Manager: Not in yet — who clocked in and has not filed | 1 | Stays |
| Manager: "Only people who clocked in are listed…" | 3 | One tap: "Who is listed" (`shift.missing-who`) |
| Manager: today's reports, answered or not, with Comment | 1 | Stays |

### Writing it

| Element | Rating | Where it went |
|---|---|---|
| End-of-shift report, the prompt | 1 | Stays |
| Your day | 1 | Stays |
| "At least 5 words." | 2 | Stays |
| "This is the record of your day in your own words." | 3 | One tap on the screen behind: "What this report is for" |
| Phrase chips, Which zone were you mostly on?, Anything else | 2 | Stays |
| Send it to the farm manager | 1 | Stays, held at the foot of the sheet — main action |
| Something actually wrong? Send a problem report as well | 2 | Stays, under the form: it keeps problems out of the shift report |

### The manager's answer

| Element | Rating | Where it went |
|---|---|---|
| Answer *name*, their report, Your comment, its hint, Send the comment | 1–2 | Unchanged: a Farm Manager's sheet, not a field screen |

No record changed: a report still files person, day, observation, zone, note and when it was entered; a draft is still kept if the sheet is interrupted (UX-16). `tests/simplify-06-shift-360.test.mjs` files a real report in Chrome at 360 × 740 and reads every field back; `tests/simplify-06-shift.test.mjs` renders the moved elements.
