# DouValue Farm Manager

A farm management app for **DouValue Farm, Port Harcourt** — bell pepper (*tatashe*),
chili (*shombo*) and habanero (*ata rodo*).

It is built for everyone on the farm, not just the office: a farm hand records what they
picked, a supervisor assigns the day's work and logs sprays, an agronomist works out what
is wrong with a plant, and the manager sees the money, the forecasts and the plan.

**It works with no network.** That is the first design constraint, not an afterthought.
Everything runs on the phone, records save instantly offline, and phones merge with each
other later. There is no server to pay for and no account to create.

---

## Open it

```bash
cd douvalue/web
python3 -m http.server 8000     # or: npx http-server -p 8000
```

Then open `http://localhost:8000` and press **Load a sample farm** to look around.
Every sample person signs in with PIN **1234**:

| Person | Role | Lands on |
|---|---|---|
| Ada Briggs | Farm manager | Dashboard |
| Tamuno George | Supervisor | Field |
| Chidi Nwosu | Agronomist | Clinic |
| Emeka Okoro / Blessing Amadi | Farm hands | Today |

On a phone, open the URL and use **Add to home screen**. It then launches like any other
app and keeps working with the data switched off.

To start a real farm instead, skip the sample and create the manager account.

---

## What each person gets

### Farm hand — *Today*
Clock in and out, see the jobs assigned to them, record a harvest in crates or kilograms,
report a problem with a photo, and log the hours they worked. Large buttons, almost no
typing, and a **Pidgin** toggle in the header, because an app only the manager can read
becomes an app only the manager uses.

### Supervisor — *Field*
Every bed with its crop, its stage, how many days since transplant, what it has given and
what is still to come. Start a cycle, scout a bed, log a spray, feed the crop on schedule.

### Agronomist — *Clinic*
Work out what is wrong with a plant, see what the weather makes likely this week, and
answer the problem reports coming in from the field.

### Manager — *Dashboard, Plan, Reports, Money, People, Store*
What was picked and sold, what it cost, what is coming, who worked, what the store is
running out of, and when to plant next season.

---

## The four things this app is actually for

### 1. Recording work, with the safety rule enforced

When a spray is logged, the app knows the product's **pre-harvest interval** and refuses
to record a harvest from that bed until it has passed. A hand who opens the harvest screen
on a bed sprayed two days ago with mancozeb does not get a form; they get:

> **Do not pick this bed yet.** Mancozeb 80% WP was applied on 2026-09-09. Fruit from this
> bed is not safe to pick or sell until 2026-09-16. **5 more days.**

It does the same for **re-entry intervals** — nobody is sent into a bed sprayed four hours
ago with a pyrethroid without gloves and boots — and it warns when one resistance group has
been used three times running, which is how a product stops working.

The guide also names the products that should not be on this farm at all, and says why:
carbofuran, paraquat, chlorpyrifos, dimethoate. A buyer who tests for residues will find
them, and two of them have killed farm workers.

### 2. Diagnosis support

Thirty-two problems that hit pepper in the Niger Delta, from Phytophthora blight and
bacterial wilt through anthracnose, pepper veinal mottle virus, broad mite and the
variegated grasshopper, to blossom-end rot and acid soil. Sixty-seven symptoms written as
things you can see, in English and Pidgin.

The wizard asks which parts of the plant you looked at, you tick what you can see, and it
ranks the candidates. It is deliberately transparent about three things:

- **How sure it is.** "Strong match", "Likely", "Possible", "Long shot", with the reason.
- **How to confirm it.** The streaming test for bacterial wilt. Turning the leaf over for
  powdery mildew. Washing a root to tell nematode galls from nitrogen nodules.
- **What would settle it.** When the top two are close, it names the single observation
  that separates them: *"Look for dark wet rot on the stem at soil level. If it is there,
  this is Phytophthora blight. If not, it points to waterlogging."*

Two rules stop it from bluffing. A symptom that fits a third of the guide, like "started
after heavy rain", counts for far less than one that fits a single problem. And a problem
whose tell-tale signs are all on a part nobody inspected cannot win the ranking — it goes
into "go and check these" instead.

It says plainly that it is a field guide and not a laboratory, and points at the Rivers
State ADP extension service for anything that could take a whole bed.

### 3. Predictions

- **Harvest forecast** per bed: first picking, peak, and a week-by-week curve in kilograms,
  adjusted for disease incidence, missed fertiliser splits, water stress and gaps in the stand.
- **Learning from your own farm.** Close a finished cycle and the app measures what it
  really yielded per plant, then calibrates every future forecast to that. Book figures are
  only the starting point.
- **Honest accuracy.** The Reports screen scores each finished cycle using a calibration
  fitted on the *other* cycles only. Fitting and grading on the same cycle would report
  near-perfect accuracy no matter how wrong the model was.
- **Revenue** at the price the crop will meet in the month it actually lands, not today's price.
- **Disease risk board** from rainfall, humidity, waterlogging and crop stage: where to walk first.
- **Labour**: how many pickers are needed next week for the weight expected.
- **Stock**: how many days of each input are left at the rate it is actually being used.
- **Cashflow** month by month, and the break-even weight at the current price.

### 4. Planting to hit the price

The single highest-value screen. Pepper prices in the South-South swing by nearly two to
one across the year: irrigated dry-season supply comes down from Kano, Kaduna and Sokoto
from about November and softens the market, then thins out from June while the rains run.

The planner walks a candidate sowing date through every week of the year, forecasts the
whole crop, prices each week of picking at that month's index, penalises dates whose
flowering falls in the worst disease weather, and ranks them. Same land, same work,
same seed — and roughly **twice the revenue** between the best week to sow and the worst.

It also states the catch out loud: the best-paying windows need a nursery or a young crop
through the dry months, so without reliable irrigation those dates are fiction.

---

## How data moves between phones

Every action is an **event** appended to a log: who, what, when, on which device. Nothing
is overwritten. State is rebuilt by replaying the log, so replaying the same events always
gives the same farm.

That makes merging trivial and safe. Export a backup from a hand's phone, send it over
WhatsApp or Bluetooth, and merge it into the manager's phone: the two logs are joined and
anything already held is skipped. Two people can record harvests all day with no signal
between them and lose nothing.

Timestamps are not trusted to give causal order, because farm phones drift and paper notes
get typed up days later. An event about something that does not exist yet is **parked and
replayed** the moment its subject turns up, so a task completed at 07:00 against a task
created at 09:00 still counts. Anything still waiting at the end is reported as an orphan
rather than silently dropped — it is usually the other half of a merge that has not
arrived yet.

**Backup is manual and it matters.** Everything lives on the phone. A lost phone is a lost
farm record unless it was exported. Settings → *Export a backup file*, weekly.

## About the PIN

The PIN separates roles on a shared farm phone so entries land under the right name and
payroll is not open to everyone. It is a workplace control, **not security**: anyone who
can open the browser's storage on that handset can read the log. Keep the money screens on
the manager's own phone.

---

## Where the numbers come from

Crop timings, yields per plant, spacing, fertiliser rates, pre-harvest intervals and the
Port Harcourt climate table are ordinary extension-service figures for Capsicum in a
tropical monsoon climate. They are starting points, not measurements from this farm, and
every one of them is either editable in Settings or replaced automatically once the farm
has its own records.

Two numbers deserve particular suspicion and are labelled as such in the app:

- **The seasonal price index.** Directionally right and worth planning around, but check
  Mile 3 and Creek Road before committing to a buyer. Replace it with your own sales after
  a season. The twelve months average to exactly 1.00 by construction — an index that
  averaged high would quietly mark up every forecast in the app.
- **Pre-harvest intervals.** Typical label values. Labels differ by country, formulation
  and concentration. **The label on the container in your store is the one that counts.**

---

## Layout

```
douvalue/
├─ web/
│  ├─ index.html, manifest.webmanifest, sw.js, icon.svg
│  ├─ css/app.css
│  └─ js/
│     ├─ app.js          boot and routing table
│     ├─ store.js        event log → farm state, roles, selectors
│     ├─ db.js           IndexedDB log, merge, export/import, photo compression
│     ├─ util.js         dates, naira, HTML escaping
│     ├─ i18n.js         English and Pidgin
│     ├─ sample.js       the worked example farm
│     ├─ domain/
│     │  ├─ crops.js     the three peppers: stages, spacing, feeding, water
│     │  ├─ climate.js   Port Harcourt climatology, live forecast, price seasonality
│     │  ├─ pests.js     32 problems, 67 symptoms, management for each
│     │  ├─ diagnose.js  symptom scoring, next checks, risk board
│     │  ├─ safety.js    products, PHI, re-entry, resistance rotation
│     │  └─ predict.js   yield, revenue, planting window, labour, stock, cashflow
│     └─ ui/             shell, kit, worker, field, clinic, manage
└─ tests/domain.test.mjs
```

No framework, no build step, no dependencies. The whole app is plain ES modules, which is
why it fits in a service-worker cache and opens on a cheap phone with no signal.

## Tests

```bash
node --test "douvalue/tests/**/*.test.mjs"
# or, from the douvalue directory:  npm test
```

61 tests covering the diagnosis engine against known field cases, pre-harvest and re-entry
blocking, resistance warnings, yield and revenue forecasting, held-out accuracy, the
planting-window optimiser, and event-log replay including out-of-order merges.

## Limits worth knowing

- **One farm per phone.** There is no central server. Merging is manual and deliberate.
- **The weather forecast is optional.** It uses Open-Meteo when there is a signal and falls
  back to the built-in Port Harcourt climate table when there is not. The app never waits
  on the network.
- **Photos are compressed to 640 px.** Enough to diagnose a leaf spot, small enough to
  export over a data bundle.
- **Forecasts are estimates.** The app says how confident it is and what it assumed. With
  no closed cycles it is running on book figures and says so.
