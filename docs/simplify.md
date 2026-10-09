# DouValue Farm App — Simplification Pass

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Draft for build |
| Save as | `docs/simplify.md` |

---

## 1. The rule

**Every element on a screen a field worker uses must change what they do next.** If it doesn't, it moves — to the record, to a supervising view, or one tap behind a link.

Nothing is deleted. Every number, note and history stays in the app and stays queryable. This is about what is *in front of someone at 6 AM in a greenhouse*, not about what the app knows.

The test for any element on a field screen, in order:

1. **Do I act on this now?** → keep it, make it the largest thing on the screen
2. **Do I need it to finish this task?** → keep it, smaller
3. **Would I go looking for it?** → one tap away, behind a link, not on the screen
4. **Is it here because the app knows it?** → move it off the field screens entirely

Most of what accumulates in an app is category 4. It is not wrong information; it is information shown at the wrong moment to the wrong person.

- **FR-SIMP-01 (MUST):** No information is deleted or made unreachable by this pass. Everything moves; nothing is lost.
- **FR-SIMP-02 (MUST):** Nothing moves out of a *record*. A scouting record, a treatment, a harvest keeps every field it has. This pass changes screens, not data.

---

## 2. What each role sees

| Role | Their screens should answer |
|---|---|
| Greenhouse Hand | What do I do next, in which house, and did it save? |
| Field Supervisor | What's late, what's wrong, and what needs my confirmation? Plus their own task list. |
| Farm Manager | The same, plus what needs approving and what's short. |
| Owner | Everything else. |

- **FR-SIMP-03 (MUST):** Anything that answers none of a role's questions does not appear on that role's screens.
- **FR-SIMP-04 (MUST):** Money, pay, costs, prices, forecasts and verification findings appear on Owner screens only.
- **FR-SIMP-05 (SHOULD):** Where a role genuinely needs an occasional look at something that isn't theirs day to day, it lives behind a single clearly-named link, not on the screen.

---

## 3. Known candidates

From the readiness audit of 1 October, these exist in the app and no requirement describes them. Each needs a decision: **keep and own it, move it to the Owner, or remove it.**

| Feature | Recommendation |
|---|---|
| Hours, pay, daily rates, wage redaction | **Remove.** Payroll is out of scope in §2, it is untested surface area, and it holds sensitive data on phones people share. |
| Harvest, revenue, labour, stock and cashflow forecasts | **Owner only.** Forecasts change nothing a hand does today. |
| Planting-window price planner | **Owner only**, or remove if unused this season. |
| Live weather (Open-Meteo) | **Keep, but only where it changes an action** — the spray screen, where rain within 4 hours triggers a re-spray task (SR-04). Nowhere else. |
| The eleven "Farm check" record checks | **Fold into the verification spec** (Part A) and make them Owner-only. |
| The Agronomist role and sample agronomist | **Remove.** FR-GATE-00 says there is no agronomist; the Farm Doctor replaced it. Leaving the role in invites someone to use it. |
| The carbofuran "avoid" row in `pests.js` | **Remove.** FR-STOCK-09 says not even flagged as avoid. |

---

## 4. The pass itself

Done one screen at a time, not as a single sweep. For each screen a field worker uses:

- **FR-SIMP-06 (MUST):** List every element. Mark each 1 to 4 against the test in §1. Move everything in 3 and 4.
- **FR-SIMP-07 (MUST):** State where each moved element went. A moved element that lands nowhere is a deleted element, and FR-SIMP-01 forbids that.
- **FR-SIMP-08 (SHOULD):** After the pass, a field screen should fit on a phone without scrolling to reach its main action.

Screen order, most-used first:

1. Home / today's tasks
2. Trap check and scouting
3. Sick-plant report
4. Harvest entry
5. Spray screen — **most care needed here.** Safety information is category 1, not clutter. PPE, re-entry, pre-harvest and dose stay prominent. What goes is everything else.
6. End-of-shift report
7. The Learn area
8. The gates screen

---

## 5. Tests

- Every element moved by this pass is reachable somewhere, proven by a test naming its new location
- No record lost a field
- Money, pay, cost, forecast and verification elements are absent from every non-Owner view, in the app and in the server's responses to a non-Owner token
- Every safety element on the spray screen is still present and prominent
- A field screen's main action is reachable without scrolling at 360 px width

---

## 6. Open decisions

| # | Decision | Owner |
|---|---|---|
| S-1 | Payroll: remove, or keep and write requirements for it? | Owner |
| S-2 | Is the price planner used? | Owner |
| S-3 | Does the Farm Manager keep cost visibility, or is it Owner-only? | Owner |
