# Walkthrough — a plant-bag zone

Requirements: `FR-GATE-08`, `FR-GATE-09`, `FR-GATE-10`, `FR-DOC-05` (bags) · Rules: `soil_and_water.plant_bag_media`, decision C-19.

A zone is grown either in **bed soil** or in **plant bags**. Bed zones work exactly as before: Gate 0 tests the bed. For a bag zone, Gate 0 tests the **media batch**, which is the heap each bag was filled from. The app records every fill as batch → bags → zone. If a batch fails, even after planting, the app names every zone its bags went to.

Every step below is also checked by `tests/bag-zone.test.mjs`, in the same order.

Use practice mode for this (**Try it on an example farm** on the sign-in screen, or **Practice mode** in Settings). Nothing done in practice mode is saved. Sign in as **Ada Briggs** (Farm manager, PIN 1234) unless a step says otherwise. Recording gate evidence needs the Field Supervisor or Farm Manager present (`UX-27`), so confirm them when asked.

---

## Part A: set up a bag zone and clear Gate 0 on its batch

**A1. Make the zone a bag zone.**
Go to **Field → Zones and cover → Add a zone**. Name it `GH-06`, choose **Greenhouse**, and set **Growing media** to **Plant bags**. Set **Litres per bag** to `20`, then **Save the zone**.
The zone list shows `Greenhouse · plant bags (0 in)`.

**A2. Log the heap as a media batch.**
On **Field**, open the gates (**See the gates**, or the Gates card), then press **Log a media batch**. Enter the supplier and the date it was delivered or mixed, then save. The solarisation dates can be added later with **Solarisation dates** on the batch's card.
The batch appears under **Media batches** as *not cleared*, with three lines to fix: supplier and solarisation, three-point pH, and nematode.

**A3. Fill bags.**
Go to **Gates → Fill bags**. Pick the batch (marked *NOT cleared*), choose **GH-06**, enter `200` bags, and save.
The fill is recorded even though the batch has not cleared, so the bags can be traced. The toast says the zone stays blocked until the batch clears.

**A4. Try to plant: blocked.**
Go to **Field → Start a crop cycle** and choose GH-06. The save is refused, and all three gates read the batch:
- *Soil pH tested:* no pH reading for the media batch.
- *Nematode clear:* no nematode assay for the media batch.
- *Media batch traced:* no solarisation dates for the heap.

A soil test recorded against GH-06's floor does **not** help. A bag zone ignores tests taken on its ground.

**A5. First reading of the heap is acid.**
Go to **Gates → Record a soil test**. Under **Where**, choose **Media batch — (your supplier)**. Enter the three points `5.0`, `5.1` and `5.0`, and tick **Taken before liming**.
The pH gate stays blocked, because a pre-lime reading does not open it.

**A6. Lime by volume.**
Go to **Clinic → Farm Doctor → Lime calculator**. Enter the three points and choose **Sandy loam**. Set **Growing in** to **Plant bags — dose by media volume** and enter either **Heap volume** `4` m³ or **Number of bags** `200` × **Litres per bag** `20`. Leave **Already under solarisation plastic** unticked.
The answer is **Route A: 3.3–4.7 kg** of dolomitic lime through the 4 m³ of media. That is 0.825–1.175 kg per m³, or **17–24 g per bag**. The route rate per 100 m² is spread through the rules' 20 cm incorporation depth, which is 20 m³ of soil. The 5.2–5.49 hold and the half and quarter doses work the same as they do for beds.

**A7. Solarise, re-test, assay.**
On the batch's card, choose **Solarisation dates** and record at least 21 days under plastic. After the plastic comes off, go to **Record a soil test** against the batch again. Enter three points (for example `6.0`, `6.2`, `6.1`), set **Nematode result** to **Clean**, and enter the **Lab**.
The batch shows **cleared**. GH-06 moves to **Cleared**, and each gate names the batch it was cleared on.

**A8. Gate 0 sign-off.**
Go to **Clinic → Farm Doctor → Gate evidence** and choose GH-06. For G0, the lab report line reads the batch's assay. The three-point line needs a meter photo: use **Record one of these**, choose the line *soil pH 5.5-7.0 from a three-point test on file (with meter photo)*, and take the photo. Then press **Save this gate check**. The Farm Manager confirms it and the Owner (Ebimo Sam) approves it (`FR-GATE-00`). The Farm Doctor never clears it itself.

**A9. Plant.**
**Start a crop cycle** on GH-06 now saves.

If GH-06 later gets bags from a second heap that has not been tested, the zone is blocked again. Every batch with bags in a zone has to pass.

---

## Part B: a batch that fails after planting

The sample farm already has this set up. **Bag house A** (300 bags, planted with bell pepper) and **Bag house B** (150 bags, empty) were both filled from one heap, *Rumuokoro topsoil and cocopeat yard*. That heap was solarised for 26 days and assayed clean. A second heap, *Eleme Road nursery supplies*, has just arrived with nothing on record yet.

**B1. Before.**
On the **Gates** screen, both bag houses are under **Cleared**. Under **Media batches**, the Rumuokoro heap is **cleared** and lists *Bag house A: 300 bags in · planted* and *Bag house B: 150 bags in*.

**B2. The lab re-assay comes back dirty.**
Go to **Gates → Record a soil test**. Under **Where**, choose **Media batch — Rumuokoro topsoil and cocopeat yard**. Set **Nematode result** to **Root-knot nematode found**, enter the lab, and save.

**B3. Every zone it reached is named.**
- Both bag houses move to **Blocked**. The nematode gate on each reads *"came back root-knot detected … Its bags are in: Bag house A (300 bags, planted), Bag house B (150 bags)."*
- Bag house A shows **Planted, and its media batch has since failed**.
- Under **Media batches**, the heap shows **FAILED — reached 2 zones**, with a **Pull these bags** button on each zone.
- Bed zones are not affected.

**B4. The Owner hears about it in one line.**
The daily digest (**Dashboard → Today's digest**) carries a critical line: *"Media batch from Rumuokoro topsoil and cocopeat yard (…) failed: root-knot detected on …"*, followed by *"Bags from it are in Bag house A (300 bags, planted), Bag house B (150 bags). Pull them all and do not reuse the media."*

**B5. The failed batch goes nowhere else.**
**Fill bags** no longer offers the Rumuokoro heap. Recording a later *Clean* result does not clear it either: a failed batch stays failed. Only an Owner override, with a reason, opens a zone on it (`FR-GATE-07`), and the override applies to one zone only.

**B6. Pull the bags.**
Press **Pull these bags** on Bag house B and confirm. The bags are marked pulled, not deleted, so the batch's card now reads *Bag house B: 0 bags in · 150 pulled*. The digest line then names only the zones that still hold bags from the batch. Bag house B has no bags left, so it is blocked until it is refilled.

**B7. The crop in Bag house A.**
Follow the root-knot nematode card (**Clinic**). There is no rescue, so the Farm Doctor drafts the plan and the Owner approves it. Then pull those bags as well.

**B8. Refill from a cleared batch.**
Clear the Eleme Road heap the same way as A2–A7: supplier, at least 21 days of solarisation, a three-point pH and a clean assay. Then **Fill bags** into Bag house B. The zone clears on the new batch.
