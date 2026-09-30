# DouValue Farm App — Knowledge Layer Specification

| Field | Value |
|---|---|
| Version | 1.1 |
| Status | Draft for build |
| Depends on | requirements.md v1.9, rules-1.4 |
| Save as | `docs/knowledge-layer.md` |

---

## 1. Purpose

Every rule in the app is already sound agronomy, but it arrives as an instruction: *spray after 4 PM*, *don't repeat IRAC 5*, *plant blocked, pH 4.8*. A person who follows instructions for a season learns the instructions. A person who learns **why** starts catching problems the app hasn't been told about.

So the knowledge layer has one job: **turn each encounter with the app into a small piece of learning, without slowing the work down.** It is not a library bolted on the side. Nobody opens a library at 6 AM in a greenhouse.

Three rules govern everything below:

1. **Knowledge appears where the work happens** — at the block, the alert, the spray screen — not in a separate section.
2. **It is never mandatory.** No quiz gates a task. A person in a hurry taps past it.
3. **It works offline.** The whole point is the field.

---

## 2. Licensing — read before gathering anything

This decides what can be bundled and what can only be linked. DouValue is commercial, and EBIMS more so, which rules out non-commercial content.

| Source | Licence | What we may do |
|---|---|---|
| CABI Pest Management Decision Guides; Plantwise Factsheets for Farmers | CC BY-SA 4.0 | **Bundle in full.** Attribute CABI, and any adaptation we ship must carry the same licence |
| CABI Technical factsheets; Compendium; distribution data | CC BY-NC-SA 4.0 | **Do not bundle.** Commercial use excluded. Link only |
| WorldVeg / AVRDC crop guides | Per publication — check each | Link until the licence on that specific PDF is confirmed |
| NAERLS / NIHORT extension bulletins | Government publication, licence not stated | Link; ask NAERLS for written permission before bundling |
| HortiFresh Sweet Pepper guide (Ghana) | Not stated | Link; ask the programme before bundling |
| FAO publications | Usually CC BY-NC-SA for many titles — check each | Link unless the specific title allows commercial reuse |
| Farm's own photos and notes | DouValue owns | Bundle freely |

**Rules for the build:**

- **FR-KNOW-00 (MUST):** Every bundled item records its source, licence and URL. An item with no licence recorded cannot be bundled, only linked.
- **FR-KNOW-01 (MUST):** A CC BY-SA item we adapt (shortened, translated, re-illustrated) ships with CABI attribution and the same licence stated on the item.
- **FR-KNOW-02 (MUST):** Non-commercial-licensed content is never bundled into the app or copied into the rules file. A build check fails if an item marked `NC` has bundled content.
- **FR-KNOW-03 (MUST):** Anything written in Claude's or a staff member's own words, from reading a source, is DouValue's own content and is attributed as "summarised from [source]".

When in doubt, write it in our own words and cite. That is always allowed and avoids the whole question.

---

## 3. Source registry

A new file, `rules/sources.json`, listing every source once.

```
{
  "id": "cabi-pmdg-pepper-mosaic-gh",
  "title": "Mosaic disease on pepper — Ghana",
  "publisher": "CABI PlantwisePlus",
  "kind": "decision-guide",
  "region": "West Africa",
  "licence": "CC BY-SA 4.0",
  "url": "https://...",
  "bundled": true,
  "retrieved": "2026-09-29",
  "covers": ["mosaic_virus"]
}
```

- **FR-KNOW-04 (MUST):** Rules entries, triage rows and diagnosis cards each carry a `sources` array of these IDs.
- **FR-KNOW-05 (MUST):** The Farm Doctor's "show what it looked at" lists the sources behind an answer, with the licence line for bundled ones.
- **FR-KNOW-06 (MUST):** `docs/references.md` is generated from this file, so the reading list and the app can't drift apart.

**Priority for gathering, highest value first:**

1. **REI and PHI values** for every active in the catalogue — closes C-8, which is currently running on 24 h / 14 d defaults
2. **IRAC / FRAC groups** for any active still missing one — closes C-6
3. **Nigeria-registered status** for each active (NAFDAC list), recorded per active as registered, not registered, or unknown
4. **West African pest pressure notes** — pod borer, whitefly, thrips, bacterial wilt — where local guidance differs from the northern-hemisphere sources already cited
5. **Nursery practice** for OF-02
6. **Hot-wet season practice** — grafting, humidity management — from WorldVeg

---

## 4. The learning layer — five mechanisms

### 4.1 "Why this?" on every rule the app enforces

- **FR-KNOW-10 (MUST):** Every block, alert, threshold and gate message carries a **Why** link. One tap opens two or three sentences in plain words, plus the source.
- The text answers *what happens if you don't*, not *what the rule says*. "Same group twice and the thrips that survive breed a population the spray no longer touches. That is how a product stops working on this farm for good."
- **FR-KNOW-11 (MUST):** Offline. This is plain text bundled with the app.
- **FR-KNOW-12 (SHOULD):** Once a person has opened the same Why three times, it stops appearing prominently for them and becomes a small link. They've learned it.

### 4.2 Field cards — the offline pocket guide

- **FR-KNOW-13 (MUST):** Each diagnosis card gains a **learn** section: what causes it, how to spot it early, what it is confused with, what prevents it. Built from the gathered sources, in our own words, cited.
- **FR-KNOW-14 (MUST):** Reachable two ways: from the diagnosis flow, and from a browsable list for reading during a break.
- **FR-KNOW-15 (MUST):** Fully offline, with the farm's own reference photos.
- **FR-KNOW-16 (SHOULD):** Bundled CC BY-SA decision guides attach as "read the full guide" on the relevant card.
- **Hand-level card text (K4):** the text a Farm hand sees on a card is authored explicitly for each of the 22 cards, not derived from the full card by filtering out steps a hand may not take. The derived filter is retired as the source of that text. It stays as a backstop test: no crop-removal instruction (pull, uproot, destroy or burn plants) ever reaches a hand's card.

### 4.3 One thing a day

- **FR-KNOW-17 (SHOULD):** The task list ends with a single card: one fact, under 30 words, tied to what is actually happening in that person's zones this week. Thrips rising in GH-03 gives the thrips fact, not a random one.
- **FR-KNOW-18 (MUST):** Dismissible, never blocking, never repeated to the same person within 60 days.

### 4.4 Learning from their own records

The most persuasive teacher on the farm is the farm.

- **FR-KNOW-19 (SHOULD):** When a treatment's 3-day follow-up records that it worked, show the person who scouted it: "You found this on the 4th, it was treated on the 5th, and the count is down. That is what catching it early looks like."
- **FR-KNOW-20 (SHOULD):** When a threshold is crossed in a zone whose trap counts were rising for a week, show the trend afterwards with the earlier point marked.
- **FR-KNOW-21 (MUST):** Never used to blame a person for a miss. If a step was missed, the message is about the pattern, not the individual. A learning tool that punishes gets gamed, and then the records stop being true.

### 4.5 Ask the card, not the API

- **FR-KNOW-22 (MUST):** A search box over the bundled knowledge — cards, Why texts, guides — that works offline and finds by symptom words a hand would actually use ("leaf curling", "white flies", "soft fruit bottom").
- **FR-KNOW-23 (MUST):** This is the first thing offered when someone asks a question, before any online adviser call. Free, instant, and works in a greenhouse with no signal.

---

## 4a. Registration status — flag, don't block

Unregistered does not mean unsafe. A product may be sound agronomy and simply not on the NAFDAC list, or the list may be out of date. Blocking would push people to log sprays as something else, and a record that lies is worse than one that flags.

- **FR-KNOW-31 (MUST):** Each active carries a registration status: registered, not registered, or unknown. Unknown is the default until checked, and is shown as unknown rather than assumed either way.
- **FR-KNOW-32 (MUST):** Choosing an active that is not registered, or unknown, shows a clear notice before the spray is confirmed, with a Why link explaining what registration means and why it matters for selling to hotels and for export. The person can proceed.
- **FR-KNOW-33 (MUST):** The choice is recorded on the treatment, so the season's records show which sprays used unregistered products. This is the number that matters if a buyer ever asks.
- **FR-KNOW-34 (SHOULD):** The Owner digest counts them: "3 sprays this week used products not on the NAFDAC list." Not an alert, just visible.
- **FR-KNOW-35 (MUST):** This is separate from the banned list. Carbofuran stays blocked outright and is never in the catalogue.

## 5. Size and delivery

- **NFR-KNOW-01 (MUST):** The bundled knowledge, text and images together, stays under 8 MB. It downloads once per phone and lives in the offline cache.
- **NFR-KNOW-02 (MUST):** Text is bundled with the app. Guide PDFs and images load on demand and are cached after first view, so a phone that never opens them never pays for them.
- **NFR-KNOW-03 (MUST):** The knowledge bundle has its own version, so it can be updated without a full app release, and the person sees "New field guide content" rather than a silent change.
- **NFR-KNOW-04 (SHOULD):** A "download everything for offline" button, so the Farm Manager can prepare a phone on wifi before it goes to the field.

---

## 6. Language

- **FR-KNOW-24 (MUST):** English at launch, same as the rest of the app.
- **FR-KNOW-25 (SHOULD):** Learn text is written at the shortest reading level that stays accurate — short sentences, everyday words, no jargon without a gloss. This matters more here than anywhere else in the app, because it is the part people read rather than tap.
- **FR-KNOW-26 (COULD):** Pidgin versions of the Why texts and field cards, recorded or written by someone on the farm. Higher value than translating the interface, because this is the content that carries meaning.

---

## 7. Governance — how it stays true

The risk of a knowledge layer is that it becomes a pile of half-remembered facts nobody owns.

- **FR-KNOW-27 (MUST):** No agronomy value in the rules file changes because of a source without the Owner approving it. The gathering step proposes; the Owner decides.
- **FR-KNOW-28 (MUST):** Every learn text and Why text carries its source ID. A text with no source is marked "farm practice" and attributed to DouValue.
- **FR-KNOW-29 (MUST):** Where two sources disagree — and they will, on thresholds and doses — both are recorded, and the one the app enforces is marked with the reason for choosing it.
- **FR-KNOW-30 (SHOULD):** The Gate 4 cycle review asks one question: did anything this season contradict what the cards say? That is how the farm's own experience enters the knowledge base.

---

## 8. Tests

- Every bundled item has a licence recorded, and no `NC` item has bundled content
- Every rules entry, triage row and diagnosis card resolves its `sources` IDs to real entries
- `docs/references.md` matches `rules/sources.json`
- Every enforced block has a Why text
- The whole knowledge layer renders and searches with the network disabled
- The bundle is under the size cap
- A Why text never blocks the action it explains
- No crop-removal instruction reaches a hand's card (backstop for the authored hand-level text, K4)

---

## 9. Build order

| Session | Work |
|---|---|
| K1 | Source registry, `sources` fields, references generation, licence tests. No content yet. |
| K2 | Gather and enter data: REI/PHI, missing groups, NAFDAC registered status. Owner approves each change. |
| K3 | Why texts for every enforced rule, offline. |
| K4 | Learn sections on all 22 cards, with hand-level text authored explicitly (§4.2), plus the offline search. |
| K5 | One-thing-a-day, and learning from their own records. |

K1 and K2 are worth doing before the team starts week 1, because they close real safety gaps. K3 to K5 can land during the season.

---

## 10. Open decisions

| # | Decision | Owner |
|---|---|---|
| K-1 | Ask NAERLS and HortiFresh for written permission to bundle their guides? | Owner |
| K-2 | Who gathers the REI/PHI and NAFDAC data — Farm Manager, consultant, or you? | Owner |
| K-3 | Pidgin field cards this season or next? | Owner / Farm Manager |
| K-4 | ~~Unregistered active: block or flag?~~ Settled: flagged, not blocked (FR-KNOW-31 to 34) | Done |
