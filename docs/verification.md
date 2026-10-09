# DouValue Farm App — Verification Specification

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Draft for build |
| Depends on | docs/requirements.md, rules/douvalue_rules_rev5_1.json |
| Save as | `docs/verification.md` |

---

## 1. Purpose

The farm's records are only worth what their truthfulness is worth. Every gate, alert and KPI in this app assumes the records describe what actually happened in the houses. If they don't, the app produces confident reports about a farm that doesn't exist.

This spec adds two layers, in order of value:

- **Part A — record cross-checks.** Records that test each other. Costs nothing, runs on data already collected, works backwards over the season, and is far harder to fake than any single record.
- **Part B — the daily walk.** A short, randomly-prompted video or photo set per zone, proving someone was physically there and showing the state of the crop.

Part A first. It will tell you within a week whether there is a real problem, and it needs no new behaviour from anyone.

### What this is not

A flag is **a question, not an accusation**. Every check below has innocent explanations — a phone that synced late, a crate sold at the gate, a tired person entering a day's work in one sitting. The output is "these records don't fit together, ask about them", never "this person is lying". Anything built here must be written in that voice, or it will be wrong about people and resented besides.

### Who sees it

- **FR-VER-01 (MUST):** Cross-check findings are visible to the Owner only. They do not appear on the Farm Manager's screens, the team views, or anyone's end-of-shift summary.
- **FR-VER-02 (MUST):** Nothing in Part A or B changes a person's task list, blocks their work, or is shown to them as a score.
- **FR-VER-03 (MUST):** The daily walk is required of **every** position that holds zones, including the Field Supervisor and the Farm Manager. It is proof of work, not surveillance of one person.

---

## Part A — Record cross-checks

Each check compares two records that should agree. Each runs on existing data, each produces a finding with the specific records attached, and each has a stated innocent explanation so the Owner can judge rather than assume.

### 2.1 The checks

| ID | Check | What it compares | What a gap may mean | Innocent explanation |
|---|---|---|---|---|
| **XC-01** | Harvest against sales | Crates or kg harvested per zone per cycle, against sold + graded-out + recorded waste | Produce leaving unrecorded | Gate sales, staff take, spoilage nobody logged |
| **XC-02** | Sprays against stock | Each treatment should draw down its product by the calculated dose × area | Sprays logged that didn't happen, or stock leaving another way | Partial tanks, spillage, dose rounding |
| **XC-03** | Stock against sprays | Stock that falls with no treatment recorded | Unrecorded spraying — the dangerous one, because PHI and rotation are then both wrong | Re-measuring, breakage, use on the nursery |
| **XC-04** | Task time against photo time | The time a task was marked done, against the capture time of its proof photo | Work ticked off that was done later, or not at all | Poor signal, phone clock, genuine late entry |
| **XC-05** | Batch entry | Several tasks across different zones all marked done within a few minutes, or a whole day entered in one sitting after dark | Recalled rather than observed | A phone that was offline all day and synced at once |
| **XC-06** | Walking time | Two tasks in distant zones completed closer together than it takes to walk between them | One person covering for another, or neither done | Two people on one phone |
| **XC-07** | Flat trap counts | Counts that repeat exactly day after day, or move too smoothly | Numbers written rather than counted | A genuinely quiet house |
| **XC-08** | Digit patterns | Harvest weights clustering on round numbers, or an unnatural leading-digit spread over a season | Estimated rather than weighed | Crates really do come in standard sizes — weigh this check carefully before trusting it |
| **XC-09** | Alert to action | Threshold crossed, treatment logged, but the follow-up count doesn't move | The treatment didn't happen, or the wrong product went on | Resistance, re-infestation, a genuinely bad spray |
| **XC-10** | Scouting coverage | Zones scouted per week against zones assigned | Houses being skipped, likely the furthest ones | Reassignment, absence |
| **XC-11** | Gate evidence age | Soil, pH and lab results reused across cycles or back-dated | Evidence recycled rather than re-taken | A test genuinely covering two cycles |
| **XC-12** | Self-confirmation rate | Diagnoses self-confirmed as a share of all diagnoses, per person | Approval being routed around | Working alone, which is normal and expected |

### 2.2 Requirements

- **FR-XCHK-01 (MUST):** Each check runs on the server over stored records, nightly, and writes findings. No check depends on a phone being online at a particular moment.
- **FR-XCHK-02 (MUST):** A finding carries: which check, the zone, the date range, the specific record IDs on both sides, the size of the gap, and the innocent explanation from the table above.
- **FR-XCHK-03 (MUST):** Findings are ranked by size of gap, not by how many fired. Twelve small findings matter less than one large one.
- **FR-XCHK-04 (MUST):** Thresholds are set by the Owner per check, with a sensible default, and are **not** visible to anyone else. A check whose threshold is known is a check that can be stayed just under.
- **FR-XCHK-05 (MUST):** The Owner gets a weekly summary, not a daily one. Daily noise trains you to ignore it. XC-03 (unrecorded spraying) is the exception and reports as soon as it fires, because PHI and rotation are both wrong from that moment.
- **FR-XCHK-06 (MUST):** Every finding can be marked **explained**, with a note, and does not re-fire for the same records. The explanations accumulate into the picture.
- **FR-XCHK-07 (SHOULD):** A season view per check, so a pattern that is steady is distinguishable from one that started.
- **FR-XCHK-08 (MUST):** Running the checks changes no record and creates no task.
- **FR-XCHK-09 (SHOULD):** The checks run retrospectively over all history on demand, so the season to date can be examined at once.
- **FR-XCHK-10 (MUST):** No check names a person in its headline. It names records and zones. Who entered them is visible on the records themselves, one tap away.

### 2.3 Tests

- Each check fires on a constructed failing case and stays silent on a constructed clean one
- A finding resolves to real record IDs on both sides
- Marking a finding explained stops it re-firing for those records
- No check writes to any record
- Findings are not present in any non-Owner view, in the app or in the server's responses to a non-Owner token

---

## Part B — The daily walk

### 3.1 How it works

Each morning, the app gives every person holding zones a short filming prompt per zone. The prompt is generated that day and cannot be known in advance.

> **GH-03 — walk row 4 from the west door to the far end, slowly. About 45 seconds.**

The prompt varies by row, direction, start point and what to show: the canopy, the bed or bag surface, a sticky trap, the drip line, the crown of a sample plant. Randomising which row and which direction is what makes old footage useless.

### 3.2 Requirements

- **FR-WALK-01 (MUST):** One prompt per assigned zone per day, generated server-side that morning, different from the previous few days for that zone.
- **FR-WALK-02 (MUST):** Capture is live in the app. No gallery uploads, for video or stills, exactly as FR-PROOF-02 requires for scouting.
- **FR-WALK-03 (MUST):** One continuous take per prompt, 30 to 60 seconds. A stills fallback of 4 to 6 live photos exists for phones that struggle with video, and is marked as the fallback.
- **FR-WALK-04 (MUST):** Each clip records: zone, prompt text, person, device, capture start and end time, and the server's own received time. The server's time is authoritative.
- **FR-WALK-05 (MUST):** The zone is confirmed by scanning the QR at the door at the start of the walk, where a code exists (FR-FARM-03).
- **FR-WALK-06 (SHOULD):** GPS is recorded where available, and its absence is noted rather than treated as failure. Greenhouse structures and Port Harcourt coverage both make it unreliable.
- **FR-WALK-07 (MUST):** Works offline. Clips queue and upload when signal returns, and the queue is visible so nobody wonders whether it sent.
- **FR-WALK-08 (MUST):** Video is compressed hard — 480p is enough to see a canopy — with a target under 8 MB per clip. Data cost is a real constraint and will quietly kill this feature if ignored.
- **FR-WALK-09 (MUST):** The Owner sees today's walks as a strip of thumbnails per zone, and can play any one. That is the main daily value; nothing else needs to happen for it to be worth having.
- **FR-WALK-10 (SHOULD):** A zone view showing the same prompt's footage week on week, so change over time is visible.
- **FR-WALK-11 (MUST):** A missed walk shows as missed, with the zone and the person's position. It escalates like any other overdue task (FR-TASK-03, FR-ROLE-10) rather than through a separate path.
- **FR-WALK-12 (MUST):** Clips are kept for the season, then archived. Storage is sized and reported so it doesn't surprise anyone.

### 3.3 Analysis, kept cheap

- **FR-WALK-20 (SHOULD):** Weekly, not daily. One model pass per zone per week summarises what the footage shows — canopy condition, weed cover, visible damage, whether traps are present and loaded, anything that looks wrong.
- **FR-WALK-21 (MUST):** The summary states what it could not tell, and never produces a count, a diagnosis or a treatment recommendation from footage. It feeds the Farm Doctor's existing flow as an observation, nothing more.
- **FR-WALK-22 (MUST):** Analysis is Owner-triggered or scheduled weekly, never per clip, and respects the API spending cap and the role restriction already set for photo review.
- **FR-WALK-23 (SHOULD):** Where a cross-check finding and a walk cover the same zone and week, they are shown together. A gap in the books next to footage of that house is the whole point.

### 3.4 Tests

- A prompt for the same zone differs across consecutive days
- A gallery upload is refused for both video and stills
- A clip carries zone, prompt, person, both timestamps and the QR confirmation
- Capture and queueing work with the network disabled
- A missed walk escalates through the normal overdue path
- The weekly summary produces no count, diagnosis or treatment recommendation

---

## 4. What this cannot do

Stated plainly so it isn't relied on for more than it is:

- Footage shows a house was visited and roughly how it looks. It does not verify trap counts, doses, pH, whether a spray went on, or grading.
- A person who wants to misreport can still walk the right row and film it honestly while writing down a number that isn't true. XC-07 and XC-09 are what catch that, not the video.
- Cross-checks raise questions. They do not establish intent, and they will sometimes be wrong about a perfectly honest week.

---

## 5. Build order

| Session | Work |
|---|---|
| V1 | XC-01, 02, 03, 04, 09 — the five that matter most, server-side, with the weekly summary and the Owner view. Run retrospectively over the season to date. |
| V2 | The rest of the cross-checks, thresholds, explain-and-dismiss, season view. |
| V3 | Daily walk: prompts, capture, upload, Owner thumbnail strip, missed-walk escalation. |
| V4 | Weekly analysis and the combined view with cross-check findings. |

V1 alone answers the question you actually have, using records you already hold.

---

## 6. Open decisions

| # | Decision | Owner |
|---|---|---|
| V-1 | Does the team get told the cross-checks exist? Telling them deters; not telling them detects. | Owner |
| V-2 | Video or stills as the default for the walk, given data costs on the team's phones | Owner / Farm Manager |
| V-3 | How long clips are kept before archiving | Owner |
| V-4 | Whether the Field Supervisor also sees walk footage for zones he supervises | Owner |
