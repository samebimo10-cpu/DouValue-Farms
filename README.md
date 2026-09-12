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

## Farm check: is it working, and can I believe it?

The CEO and manager get a **Farm check** screen with three tabs. It exists to
answer two questions that the rest of the app assumes away.

### Analysis: is the farm working?

The test for anything on this tab is whether it would change a decision.

- **Picking trend**, last twelve weeks, with the last four compared against the four before.
- **What a kilo costs against what it fetches.** Inputs and labour over what was
  actually picked, against what sales actually realised. This is the number that
  says whether the season is paying, and it is blunt when it is not.
- **Which beds are pulling their weight**, judged against the part of each bed's
  *own* forecast that has already passed, so a young bed is not marked down for
  being young.
- **Who is doing what**: hours, pickings and kilos per hour, with the caveat
  printed on the screen that picking rate depends on the crop and the bed as
  much as the person.
- **Grade mix**, because rejects are where the price goes.

### Record checks: can I believe the books?

Eleven checks run over every record. Each finding answers three questions,
because one that cannot is just noise: what specifically looks wrong in numbers,
what the innocent explanation is, and what would settle it.

| Check | What it catches |
|---|---|
| Late entry | Work written up days after the day it claims |
| Future-dated | A record dated ahead of when it was made |
| Bulk backfill | A week of records entered in one sitting |
| Clock skew | A phone whose clock is adrift, making its times unreliable |
| Possible duplicate | Same bed, same day, same weight, twice |
| Unusual weight | A picking far outside what that bed normally gives |
| No matching shift | Work recorded for a day that person never clocked in |
| Sold more than picked | More left the farm than was ever recorded as picked |
| Silent bed | A bed in full picking that nobody has touched for days |
| Estimated weights | Weights that are always round numbers |
| Old photo | Evidence attached long after it was taken |

**It never says anyone is dishonest.** On a real farm most of these turn out to
be a dead phone or a paper book written up on Friday, and an app that cried theft
every time would be switched off within a week. Each card leads with the innocent
explanation. The per-person table is explicitly labelled as measuring
record-keeping, not honesty, with a note that someone working the back field
with no signal will always look worse than someone at the office, and that this
is about the network rather than about them.

**Repeated findings collapse.** Thirty cards saying the same thing is a screen
nobody reads, so the same question about the same person becomes one finding with
a count and a few examples.

**The headline score** measures how records were *made*, not whether people are
honest: recorded on the day, backed by a photo, checked by a second person. A
record made at the bed with a picture, checked by someone else, is one you can
stand behind at a bank or a buyer. One remembered on Friday is not, however
truthful.

**Sold more than picked** is the one worth chasing first. Either crates are
leaving unrecorded or the picking book is incomplete, and both cost real money.

### Evidence: the pictures

Photos can be attached to pickings, scouting rounds, sprays and problem reports,
and they collect here newest first with who took them and when.

Provenance is recorded, not just the image. A photo taken at the bed at the time
is evidence; one picked out of the gallery days later is a claim, and the app
labels it as such using the file's own timestamp. A picture of a spray
container's label is the record that settles any later argument about what
actually went on the crop and how long the waiting period really was.

Pictures are compressed hard, because a farm phone on a data bundle cannot
afford otherwise, and the sync batches by byte size so a run of photos cannot
jam the outbox.

## Timestamps

Every record carries three times, and the Farm check screen compares them:

- **The day it claims**, which the person picks.
- **When it was entered**, stamped by the phone.
- **When it reached the server**, stamped by the server, which is the one that
  cannot be argued with.

Lists show when a record was entered, and say so explicitly when that differs
from the day it claims.

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
- **Record checks**: eleven tests over the farm's own books, described under
  Farm check above.

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

Once the CEO connects the farm, each phone keeps an **outbox** of what it has not
yet handed over. Whenever it has signal it pushes that outbox and pulls whatever
the other phones recorded, then rebuilds itself. Nobody has to remember to send
anything.

A sync runs when the phone comes back online, a few seconds after anything is
recorded, when the app returns to the foreground, and on a slow background tick.
Failures back off (5s, 15s, 45s, 2m, 5m) instead of hammering a bad connection,
and overlapping triggers share one exchange. A line across the top of every
screen says where the phone stands; tapping it forces an exchange.

### Accounts, and who can read what

**There is no shared password.** Every person has their own account, and the
server decides what their role may see. This is the part that matters, so it is
worth being exact about it.

**Joining takes two things, and both come from the CEO.** You create the account
in the app, and it hands you a link and a six-character password. The person taps
the link, types the password once, chooses their own PIN, and that phone is
theirs. The link says *which account*; the password proves *it is them*. Both work
exactly once and expire after two weeks.

**A PIN alone gets nobody in.** Enrolling a device requires an invite. Someone who
watches a farm hand type their PIN cannot use it on another phone, because that
phone was never invited. Six wrong tries locks the account for fifteen minutes.

**The role is enforced on the server, not in the app.** A farm hand's phone is not
sent the sales, the costs or anybody else's wages. Not hidden on the screen:
never transmitted. Open that phone's storage and the figures are not there,
because the server filtered them before they left it. The app's own role checks
are a convenience for the person using it; the server is the fence.

What each role receives:

| | Beds, crops, harvest, sprays, tasks | Colleagues' names | Colleagues' wages | Sales and costs |
|---|---|---|---|---|
| CEO | yes | yes | yes | yes |
| Farm manager | yes | yes | yes | yes |
| Agronomist | yes | yes | no | no |
| Supervisor | yes | yes | no | no |
| Farm hand | yes | yes | no | no |

Everyone always sees their own pay. Nobody, at any level, receives anybody's PIN
digest: it stays on the server.

**Writes are checked the same way.** A farm hand who pushes a sale, or pushes a
record making themselves CEO, gets it refused and told why. A manager cannot mint
another manager or an owner. Every record is filed under whoever actually sent it,
not whoever the sending app claimed, so work cannot be attributed to someone else.

**Lost phone?** The CEO presses *Sign out their phones*. That device is dead on
its next exchange, within seconds. Nobody else has to change anything, because
nobody else shared a password with them.

**Setting the server up.** One file, free to run:

1. Open **dash.deno.com**, create a new Playground.
2. Paste in `douvalue/server/deno-sync.ts`, press Save & Deploy.
3. In the app: Settings → Sync → Connect the farm, and paste the address.

Prefer your own machine? `douvalue/server/node-sync.mjs` serves the same contract
and keeps each farm in an append-only JSON-lines file, so a backup is a file copy.
Put either behind HTTPS: tokens and PINs travel in the request, and plain HTTP
puts them on the wire in clear.

`server/core.mjs` holds all the rules; the two servers are only storage and
plumbing. `server/deno-sync.ts` is generated from it by
`node douvalue/scripts-build-deno.mjs`, and a test fails if the two drift apart.

### Why not Google Drive or Gmail?

A fair question, and the short answer is that email is not a database.

Mailing records to yourself gives you no way for two phones to write at the same
time, no way to ask "what changed since Tuesday", and no way to send a farm hand
the beds without also sending them the wage bill. The moment two people record a
harvest while out of signal, you have two attachments and no way to merge them.

Google Drive is closer, but it still has no field-level permissions, so the
filtering above would be impossible: either a phone can read the farm file or it
cannot. On top of that every worker would need a Google account, the setup needs
a Google Cloud project and a consent screen, and refresh tokens on a phone that
has been offline for a week are a reliable source of mystery sign-outs.

Signing in **with** Google is a different and more reasonable idea, and it would
suit the CEO and manager. It is a poor fit for farm hands sharing cheap handsets
with patchy data, which is why the app uses invites and a PIN instead.

If what you want is a copy in your own hands, use **Settings → Export a backup
file** and mail that to yourself. It is one file, it holds everything, and merging
it back in later is one button.

### Without a server### Without a server

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

On a **connected** farm the PIN unlocks one enrolled phone, and the account behind it is
real: the server decides what that person may read and write, and their phone is never
sent anything else. The PIN is not what protects the data; the enrolment is. That is why a
PIN copied over someone's shoulder is worthless on another handset.

On a farm running **without a server**, the PIN is only a workplace control: it keeps
entries landing under the right name on a shared phone, but anyone who can open the
browser's storage on that handset can read what is on it. If wages and sales matter to
you, connect the farm.

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
│     ├─ sync.js         outbox, push/pull, backoff, invites and enrolment
│     ├─ store.js        event log → farm state, roles, selectors
│     ├─ db.js           IndexedDB log, merge, export/import, photo compression
│     ├─ util.js         dates, naira, HTML escaping
│     ├─ i18n.js         English and Pidgin
│     ├─ sample.js       the worked example farm
│     ├─ domain/
│     │  ├─ analysis.js  trend, bed performance, labour, unit economics, grades
│     │  ├─ integrity.js the eleven record checks and the scoring behind them
│     │  ├─ crops.js     the three peppers: stages, spacing, feeding, water
│     │  ├─ climate.js   Port Harcourt climatology, live forecast, price seasonality
│     │  ├─ pests.js     32 problems, 67 symptoms, management for each
│     │  ├─ diagnose.js  symptom scoring, next checks, risk board
│     │  ├─ safety.js    products, PHI, re-entry, resistance rotation
│     │  └─ predict.js   yield, revenue, planting window, labour, stock, cashflow
│     └─ ui/             shell, kit, worker, field, clinic, manage, audit, photo
├─ server/
│  ├─ core.mjs          the rules: accounts, roles, what each may read and write
│  ├─ deno-sync.ts      generated single file for Deno Deploy (free, no CLI)
│  └─ node-sync.mjs     the same core, self-hosted, storing to files
└─ tests/               domain, roles and sync
```

No framework, no build step, no dependencies. The whole app is plain ES modules, which is
why it fits in a service-worker cache and opens on a cheap phone with no signal.

## Tests

```bash
node --test "douvalue/tests/**/*.test.mjs"
# or, from the douvalue directory:  npm test
```

123 tests covering the diagnosis engine against known field cases, pre-harvest and re-entry
blocking, resistance warnings, yield and revenue forecasting, held-out accuracy, the
planting-window optimiser, event-log replay including out-of-order merges, the account
hierarchy, and the server run for real and attacked rather than trusted: a farm hand's own
token trying to pull the wage bill, a hand pushing a sale, a hand pushing a record that
promotes themselves, a manager trying to mint another manager, a reused invite, a wrong
password, one farm reaching into another, and a revoked phone. The record checks are tested both ways: that they fire on late
entry, bulk backfill, duplicates, outliers, clock skew and selling more than was
picked, and that they stay silent on a clean week, a young bed, a farm that does
not use clock-in, and ordinary sync delay.

## Limits worth knowing

- **One farm per phone.** There is no central server. Merging is manual and deliberate.
- **The weather forecast is optional.** It uses Open-Meteo when there is a signal and falls
  back to the built-in Port Harcourt climate table when there is not. The app never waits
  on the network.
- **Photos are compressed to 640 px.** Enough to diagnose a leaf spot, small enough to
  export over a data bundle.
- **Forecasts are estimates.** The app says how confident it is and what it assumed. With
  no closed cycles it is running on book figures and says so.
