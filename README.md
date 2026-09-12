# DouValue Farms Limited

A farm management app for **DouValue Farms Limited, Port Harcourt** — bell pepper (*tatashe*),
chili (*shombo*) and habanero (*ata rodo*).

It is built for everyone on the farm, not just the office: a farm hand records what they
picked, a supervisor assigns the day's work and logs sprays, an agronomist works out what
is wrong with a plant, and the manager sees the money, the forecasts and the plan.

**It works with no network.** That is the first design constraint, not an afterthought.
Everything runs on the phone, records save instantly offline, and phones merge with each
other later. There is no server to pay for and no account to create.

---

## Open it

**https://samebimo10-cpu.github.io/Stock-/farm/**

That is the permanent address. Open it on a phone and use **Add to home screen**; it
then launches like any other app and keeps working with the data switched off. A workflow
in this repository republishes it whenever anything under `douvalue/web/` changes.

The page is public, because GitHub Pages on a public repository is. **The farm's records
are not**: everything anyone enters is stored in their own browser on their own phone and
never leaves it. A stranger who opens the link gets an empty app, not your farm.

To run it locally instead:

```bash
cd douvalue/web
python3 -m http.server 8000     # or, from douvalue/:  npm start
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

## Who is who

Accounts come from the top down. The first account created on a new farm is the
**CEO**, the owner. The CEO appoints the farm manager; the manager takes on
supervisors, agronomists and farm hands. Nobody can appoint their own level or
above, so a manager cannot create a second manager or touch the owner's account,
and the last remaining CEO account cannot be deleted.

| Role | Appoints | Sees |
|---|---|---|
| **CEO** | Everyone, including managers and co-owners | Everything, plus the sync link and the audit trail |
| **Farm manager** | Agronomists, supervisors, farm hands | Work, money, people, planning and reports |
| **Agronomist** | Nobody | The clinic, the beds, the risk board, reports |
| **Supervisor** | Nobody | The day's work, harvest checking, sprays and inputs |
| **Farm hand** | Nobody | Today's jobs, their own harvest and reports |

The CEO is not a separate reporting view bolted on the side. They hold every
operational permission as well, so they can pick a crate, run a diagnosis or log
a spray when they are in the field, and still be the only one who can change the
sync link or appoint a manager.

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

That makes merging trivial and safe: two logs join by set union. There is no
last-writer-wins, no field-level conflict, and no way for one phone to overwrite
another's morning. Two hands can record harvests all day with no signal between
them and lose nothing.

### Automatic sync

Once the CEO switches sync on, each phone keeps an **outbox** of what it has not
yet handed over. Whenever it has signal it pushes that outbox and pulls whatever
the other phones have recorded, then rebuilds itself. Nobody has to remember to
send anything.

A sync runs when the phone comes back online, a few seconds after anything is
recorded, when the app is brought back to the foreground, and on a slow
background tick. Failures back off (5s, 15s, 45s, 2m, 5m) instead of hammering a
bad connection, and overlapping triggers share one exchange rather than sending
the same batch three times.

A line across the top of every screen always says where the phone stands: *All
phones up to date*, *No network, 3 records waiting to send*, or the error if
there is one. Tapping it forces an exchange.

**Setting it up.** The server is one file and free to run:

1. Open **dash.deno.com**, create a new Playground.
2. Paste in `douvalue/server/deno-sync.ts`, press Save & Deploy.
3. Copy the address it gives you into the app under **Settings → Sync**.

To add a phone, the CEO presses **Add a phone** and sends the join code. On that
phone, **Join with a code**, paste, done: it pulls the whole farm down and stays
in step from then on.

Prefer your own machine? `douvalue/server/node-sync.mjs` serves the same contract
and keeps each farm in one append-only JSON-lines file, so a backup is a file
copy.

**What the sync protects, and what it does not.** One shared farm key guards one
farm. It keeps the books off the open internet, which is the thing that matters
here. It is not a password per person: anyone holding the join code can read and
write everything, wages and sales included. Give it only to phones you trust, and
send it directly rather than posting it in a group chat.

### Without a server

Sync is optional. Export a backup from a hand's phone, send it over WhatsApp or
Bluetooth, and merge it into the manager's phone: the two logs are joined and
anything already held is skipped.

Timestamps are not trusted to give causal order, because farm phones drift and paper notes
get typed up days later. An event about something that does not exist yet is **parked and
replayed** the moment its subject turns up, so a task completed at 07:00 against a task
created at 09:00 still counts. Anything still waiting at the end is reported as an orphan
rather than silently dropped — it is usually the other half of a merge that has not
arrived yet.

**Back up anyway.** With sync on, the server holds a copy and a lost phone costs
nothing. Without it, everything lives on that one handset: Settings → *Export a
backup file*, weekly.

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
│     ├─ sync.js         outbox, push/pull, backoff, join codes
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
├─ server/
│  ├─ deno-sync.ts      the sync server, for Deno Deploy (free, no CLI)
│  └─ node-sync.mjs     the same contract, self-hosted
└─ tests/               domain, roles and sync
```

No framework, no build step, no dependencies. The whole app is plain ES modules, which is
why it fits in a service-worker cache and opens on a cheap phone with no signal.

## Tests

```bash
node --test "douvalue/tests/**/*.test.mjs"
# or, from the douvalue directory:  npm test
```

85 tests covering the diagnosis engine against known field cases, pre-harvest and re-entry
blocking, resistance warnings, yield and revenue forecasting, held-out accuracy, the
planting-window optimiser, event-log replay including out-of-order merges, the account
hierarchy, and the sync server run for real: push, pull, de-duplication, two phones offline
at once, a wrong key, restart durability, and a replay of what came back off the wire.

## Limits worth knowing

- **One farm per phone.** There is no central server. Merging is manual and deliberate.
- **The weather forecast is optional.** It uses Open-Meteo when there is a signal and falls
  back to the built-in Port Harcourt climate table when there is not. The app never waits
  on the network.
- **Photos are compressed to 640 px.** Enough to diagnose a leaf spot, small enough to
  export over a data bundle.
- **Forecasts are estimates.** The app says how confident it is and what it assumed. With
  no closed cycles it is running on book figures and says so.
