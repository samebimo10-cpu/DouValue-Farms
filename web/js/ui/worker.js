// Screens for the farm hand: what to do today, what was picked, what is wrong.
// Everything here assumes one hand, bright sun, and no time for typing.

import {
  badge, button, card, cardHead, closeSheet, empty, esc, field, input, note, openSheet,
  readForm, select, stat, textarea, toast, tick,
} from './kit.js';
import { t, local, getLang } from '../i18n.js';
import { activeCycles, can, cycleLabel, isClockedIn, openTasks } from '../store.js';
import { getCrop, stageAt } from '../domain/crops.js';
import { SPRAY_RULES } from '../domain/safety.js';
import { harvestCheck, reentryCheck } from '../domain/onboarding.js';
import { forecastHeadline, seasonOn } from '../domain/climate.js';
import { daysBetween, friendlyDate, isoDate, kg, naira, round, sum, timeOfDay, uid } from '../util.js';
import { bindPhoto, photoField, photoPayload, photoThumb, resetPhoto } from './photo.js';
import { canComplete, judgeZoneStart, stampFor, zoneStamp } from '../domain/proof.js';
import { scanSupported, scanZone, zoneListSheet, zonePicker } from './scan.js';
import { dayProgress, howTo } from '../domain/schedule.js';
import {
  bigNumber, buzz, callSupervisor, dayProgressBar, phraseChips, tag, taskStatus,
} from './field-kit.js';

/**
 * FR-PROOF-03 / UX-12 — the zone confirmed at the start of a task.
 *
 * Kept in memory rather than in the log: a confirmation that never turns into a
 * completed task is not a record of anything. It lands in the log when the task
 * closes, as part of the completion, which is where it is evidence.
 */
const zoneConfirmations = new Map();
export function confirmationFor(taskId) { return zoneConfirmations.get(taskId) || null; }
export function clearConfirmations() { zoneConfirmations.clear(); }

let weather = null; // filled in by app.js when a forecast is available
export function setWeather(w) { weather = w; }
/** The adviser screen needs the same forecast this one is drawn from. */
export function getWeather() { return weather; }

function bedOptions(state) {
  return activeCycles(state).map((c) => ({ value: c.id, label: cycleLabel(state, c.id) }));
}

// FR-TREAT-02 with FR-ONB-04/05: the PHI and re-entry read backfilled sprays
// too, and a zone onboarded without its spray history cannot be picked.
function cycleSafety(state, cycleId, at = new Date()) {
  return {
    harvest: harvestCheck(state, cycleId, at),
    reentry: reentryCheck(state, cycleId, at),
  };
}

// --- Today ----------------------------------------------------------------

export const todayView = {
  perm: 'viewOwnTasks',
  render(ctx) {
    const { state, user } = ctx;
    const lang = getLang();
    const today = isoDate();
    const clockedIn = isClockedIn(state, user.id);
    const mine = openTasks(state, user.id, today);
    const head = forecastHeadline(weather);
    const season = seasonOn(today);

    const blocked = activeCycles(state)
      .map((c) => ({ cycle: c, safety: cycleSafety(state, c.id) }))
      .filter((x) => !x.safety.harvest.safe || !x.safety.reentry.safe);

    let out = '';

    out += card(
      `<div class="row between"><div><b>${esc(user.name)}</b><br><small>${esc(friendlyDate(today))} — `
      + `${esc(season.label)}</small></div>`
      + (clockedIn
        ? button(t('today.clockOut'), 'clock-out', { cls: 'btn-ghost' })
        : button(t('today.clockIn'), 'clock-in', {}))
      + '</div>'
      + (clockedIn ? note('ok', t('today.clockedIn'), `<small>Since ${esc(clockInTime(state, user.id))}</small>`) : '')
      + `<div class="note info" style="margin-bottom:0"><b>${esc(head.text)}</b>`
      + `<small>${head.live ? 'Live forecast' : 'From the Port Harcourt seasonal average, no network needed'}</small></div>`,
      { tight: true },
    );

    if (blocked.length) {
      out += card(
        cardHead('Safety first')
        + blocked.map(({ cycle, safety }) => {
          const parts = [];
          if (!safety.harvest.safe) {
            parts.push(note('danger', safety.harvest.historyMissing
              ? `${cycleLabel(state, cycle.id)}: do not pick — spray history missing`
              : `${cycleLabel(state, cycle.id)}: do not pick until ${safety.harvest.clearOn}`,
              `<small>${esc(safety.harvest.reason)}</small>`));
          }
          if (!safety.reentry.safe) {
            parts.push(note('warn', `${cycleLabel(state, cycle.id)}: keep out for ${safety.reentry.hoursLeft} more hours`,
              `<small>${esc(safety.reentry.reason)}</small>`));
          }
          return parts.join('');
        }).join(''),
      );
    }

    // UX-23/24: the day as a list of cards in order, each with its zone, its
    // time and its colour — and the count said in words, because a bar on its
    // own is a shape, and a shape is not an answer to "how much is left".
    const progress = dayProgress(state, { date: today, personId: user.id });
    const dayTasks = Object.values(state.tasks || {})
      .filter((x) => (x.due || '').slice(0, 10) === today)
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const board = dayTasks.length ? dayTasks : mine;

    out += card(
      cardHead(t('today.tasks'))
      + (board.length ? dayProgressBar(progress) : ''),
      { tight: true },
    );

    out += board.length
      ? board.map((task) => taskCard(state, task)).join('')
      : card(empty('✅', t('today.noTasks'), 'Anything you do can still be recorded below.'));

    out += card(
      cardHead('Record something')
      + '<div class="grid">'
      + button(t('today.logHarvest'), 'open-harvest', { cls: 'btn-lg', icon: '🧺' })
      + button(t('today.reportProblem'), 'open-report', { cls: 'btn-lg btn-ghost', icon: '⚠️' })
      + button(t('today.logWork'), 'open-work', { cls: 'btn-lg btn-ghost', icon: '🛠️' })
      + button(t('today.checkPlant'), 'go', { cls: 'btn-lg btn-ghost', icon: '🔍', data: { to: '#/diagnose' } })
      + '</div>',
    );

    // FR-TASK-05 / UX-09 — the end of the day, in their own words. Its own
    // card at the bottom of the screen, where the shift ends.
    const filedToday = (state.shifts || [])
      .some((sh) => (sh.personId || sh.by) === user.id && sh.date === today);
    out += card(
      cardHead('End of shift', filedToday ? badge('sent', 'ok') : badge('not yet', 'warn'))
      + (filedToday
        ? '<p><small>Today\'s report is in. The farm manager reads it and can comment on '
          + 'it.</small></p>'
        : '<p><small>Before you go: what did you see, and what did you do about it? A line is '
          + 'enough, and it is the only record of the day in your own words.</small></p>')
      + button(filedToday ? 'Read what you wrote' : 'Write today\'s report', 'go',
        { cls: filedToday ? 'btn-ghost btn-block' : 'btn-block btn-lg', icon: '📝',
          data: { to: '#/shifts' } }),
    );

    const myHarvest = state.harvests.filter((h) => h.by === user.id && h.date === today);
    if (myHarvest.length) {
      out += card(
        cardHead('What you picked today')
        + '<ul class="list">' + myHarvest.map((h) => `<li><div class="grow">`
          + `<b>${esc(kg(h.kg))}</b><small>${esc(cycleLabel(state, h.cycleId))}</small>`
          + `<small>Recorded ${esc(timeOfDay(h.at))}${h.date !== isoDate() ? ` for ${esc(h.date)}` : ''}</small>`
          + photoThumb(h.photo, { small: true, alt: 'Photo of this picking' })
          + `</div>${h.verified ? badge('checked', 'ok') : badge('waiting', 'warn')}</li>`).join('') + '</ul>'
        // UX-04: the figure a hand actually came to this screen to read.
        + `<div style="margin-top:12px">${bigNumber(kg(sum(myHarvest, (h) => h.kg)), 'picked today')}</div>`,
      );
    }
    return out;
  },

  actions: {
    'clock-in': async (ctx) => {
      await ctx.store.dispatch('attendance.in', { personId: ctx.user.id, date: isoDate() });
      toast(getLang() === 'pcm' ? 'You don clock in' : 'Clocked in');
    },
    'clock-out': async (ctx) => {
      await ctx.store.dispatch('attendance.out', { personId: ctx.user.id, date: isoDate() });
      toast(getLang() === 'pcm' ? 'Safe journey' : 'Clocked out');
    },
    // FR-PROOF-01. A scouting round or a trap check is not done because
    // somebody tapped a button — it is done when there is a picture of it.
    // Every other kind of task closes on the tap, as before.
    'task-done': async (ctx, el) => {
      const task = ctx.state.tasks[el.dataset.id];
      const verdict = canComplete(task, null);
      if (!verdict.ok) { openProofSheet(ctx, task, verdict); return; }
      const stamp = zoneConfirmations.get(task.id) || null;
      const zoneVerdict = judgeZoneStart(task, stamp);
      if (!zoneVerdict.ok) { toast(zoneVerdict.why, true); return; }
      await ctx.store.dispatch('task.complete', { id: el.dataset.id, zoneCheck: stamp });
      zoneConfirmations.delete(task.id);
      toast(getLang() === 'pcm' ? 'Well done' : 'Marked done');
    },
    'save-proof': saveProof,

    // FR-PROOF-03: the door code, at the start of the job.
    'scan-zone': async (ctx, el) => {
      const task = ctx.state.tasks[el.dataset.id];
      if (!task) return;
      const result = await scanZone(ctx.state, { expectZoneId: task.zoneId });
      if (!result.ok) {
        // Cancelled, or the wrong door. scanZone has already said which.
        if (result.reason === 'cancelled') openZonePicker(ctx, task, true);
        return;
      }
      zoneConfirmations.set(task.id, zoneStamp({
        zone: result.zone, method: 'qr', by: ctx.user.id,
      }));
      buzz();
      toast(`${result.zone.name} confirmed`);
      ctx.refresh();
    },
    'pick-zone': (ctx, el) => openZonePicker(ctx, ctx.state.tasks[el.dataset.id], false),
    'choose-zone': (ctx, el) => {
      const task = ctx.state.tasks[pickingFor];
      const zone = ctx.state.plots[el.dataset.id];
      if (!task || !zone) { closeSheet(); return; }
      zoneConfirmations.set(task.id, zoneStamp({
        zone, method: 'list', by: ctx.user.id,
      }));
      closeSheet();
      toast(`${zone.name} chosen`);
      ctx.refresh();
    },
    'open-harvest': (ctx) => openHarvestSheet(ctx),
    'open-report': (ctx) => openReportSheet(ctx),
    'open-work': (ctx) => openWorkSheet(ctx),
    'harvest-bed-change': (ctx, el) => {
      const wrap = el.closest('.sheet');
      renderHarvestBody(ctx, wrap, el.value);
    },
    'save-harvest': (ctx, form) => saveHarvest(ctx, form),
    'save-report': (ctx, form) => saveReport(ctx, form),
    'save-work': (ctx, form) => saveWork(ctx, form),
    // 'pick-photo' is a shell action now, so every screen gets it.
  },
};

function clockInTime(state, personId) {
  const open = [...state.attendance].reverse().find((a) => a.personId === personId && !a.out);
  return open ? timeOfDay(open.in) : '';
}

// --- Harvest --------------------------------------------------------------

/**
 * The camera, opened because a task cannot close without it.
 *
 * Phrased as the next step rather than as a refusal. "Take the photo" is a job;
 * "you cannot do that" is an argument with the app, and people win arguments
 * with apps by not using them.
 */
/**
 * One task, one card — UX-23.
 *
 * Zone, time and state, in that order, because that is the order somebody
 * standing in a field needs them: where, by when, and is it done. The colour is
 * repeated as a stripe and as an icon (UX-07), so it survives sunlight and
 * colour blindness alike.
 */
function taskCard(state, task) {
  const state_ = taskStatus(task);
  const zone = task.zoneId ? (state.plots || {})[task.zoneId] : null;
  const where = zone ? zone.name : (task.cycleId ? cycleLabel(state, task.cycleId) : 'General');
  const at = task.due ? task.due.slice(11, 16) : null;
  const steps = howTo(task.kind);
  const label = { done: 'Done', now: 'Late', soon: 'Due soon', notyet: 'Later' }[state_];

  return card(
    `<div class="row between"><div class="grow"><b>${esc(task.title)}</b>`
    + `<small>${esc(where)}${at ? ` · by ${esc(at)}` : ''}</small></div>`
    + tag(state_, label) + '</div>'
    + (steps
      // UX-19: the steps, numbered, matching the laminated role cards.
      ? `<ol class="steps">${steps.how.map((line) => `<li>${esc(line)}</li>`).join('')}</ol>`
        + `<p><small>${esc(steps.why)}</small></p>`
      : '')
    + (task.status === 'done'
      ? `<p class="gate-row ok"><b>✓ Done</b> <small>${esc(task.doneNote || 'Recorded')}</small></p>`
        + (task.zoneCheck
          ? `<p><small>${esc(task.zoneCheck.label)}: ${esc(task.zoneCheck.zoneName)}</small></p>`
          : '')
      : startBlock(task)
        + `<div style="margin-top:10px">${button(t('today.done'), 'task-done',
          { cls: 'btn-block btn-lg', data: { id: task.id } })}</div>`),
    { cls: `task-card is-${state_}` },
  );
}

/**
 * UX-12 and FR-PROOF-03 — confirm the zone before the job, not after it.
 *
 * Scanning is offered first where the phone can do it, and the list is always
 * underneath. Nothing here blocks the work: a job with no confirmation still
 * closes, it is simply worth less on the record.
 */
function startBlock(task) {
  if (!task.zoneId) return '';
  const done = zoneConfirmations.get(task.id);
  if (done) {
    return `<p class="gate-row ok"><b>✓ ${esc(done.zoneName)}</b> `
      + `<small>${esc(done.label)}</small></p>`;
  }
  const picker = zonePicker();
  return '<div class="row wrap" style="margin-top:10px">'
    + button(picker.primary.label, picker.primary.act,
      { cls: 'btn-ghost btn-sm', icon: picker.primary.icon, data: { id: task.id } })
    + (picker.fallback
      ? button(picker.fallback.label, picker.fallback.act,
        { cls: 'btn-quiet btn-sm', icon: picker.fallback.icon, data: { id: task.id } })
      : '')
    + '</div>'
    + `<p><small>${esc(picker.why)}</small></p>`;
}

function openProofSheet(ctx, task, verdict) {
  const el = openSheet(`<h2>${esc(task.title || 'This check')}</h2>`
    + note('info', verdict.why, `<small>${esc(verdict.fix)}</small>`)
    + '<form data-act="save-proof">'
    + `<input type="hidden" name="taskId" value="${esc(task.id)}">`
    + photoField('Photograph what you checked',
      'The trap, or the plants you looked at. Taken now, in the app — a picture from the gallery '
      + 'proves the bed was fine earlier, not that it is fine now.')
    + field('What did you see?', textarea('note', { rows: 2,
      placeholder: 'e.g. traps replaced, a few thrips on the GH-01 trap' }),
      'A line is enough. It goes on the record with the picture.')
    + phraseChips(task.kind, 'note')
    + '<button class="btn-block btn-lg" type="submit">Done</button>'
    + '</form>'
    // UX-22: somebody to ask, from the screen you are standing on.
    + `<div style="margin-top:12px">${callSupervisor(ctx.state)}</div>`);
  bindPhoto(el);
}

let pickingFor = null;

/** UX-12's fallback: the zone list, always one tap away. */
function openZonePicker(ctx, task, afterScan) {
  if (!task) return;
  pickingFor = task.id;
  openSheet(zoneListSheet(ctx.state, {
    title: 'Which zone are you in?',
    why: afterScan
      ? 'No code read. Choose the house you are standing in.'
      : (scanSupported() ? null : 'This phone cannot scan codes, so choose from the list.'),
  }));
}

async function saveProof(ctx, form) {
  const data = readForm(form);
  const task = ctx.state.tasks[data.taskId];
  const photo = photoPayload();
  const verdict = canComplete(task, photo);
  if (!verdict.ok) { toast(verdict.why, true); return; }

  // FR-PROOF-03: a confirmation for a different house is refused outright —
  // it is the one case this whole check exists to catch.
  const stamp = zoneConfirmations.get(task.id) || null;
  const zoneVerdict = judgeZoneStart(task, stamp);
  if (!zoneVerdict.ok) { toast(zoneVerdict.why, true); return; }

  const cycle = task.cycleId ? ctx.state.cycles[task.cycleId] : null;
  const zone = cycle ? ctx.state.plots[cycle.plotId] : null;
  await ctx.store.dispatch('task.complete', {
    id: task.id,
    photo,
    note: data.note || '',
    // FR-PROOF-03: where they were, and how sure the app is about it.
    zoneCheck: stamp,
    // FR-PROOF-02: date, time, zone and person, in one shape everywhere.
    stamp: stampFor(photo, {
      zoneName: zone ? zone.name : null,
      personName: ctx.user.name,
      taskKind: task.kind,
    }),
  });
  zoneConfirmations.delete(task.id);
  resetPhoto();
  closeSheet();
  toast(verdict.unverifiedTime
    ? 'Done. This phone did not stamp the picture with a time.'
    : (getLang() === 'pcm' ? 'Well done' : 'Marked done'));
}

function openHarvestSheet(ctx) {
  const beds = bedOptions(ctx.store.state);
  if (!beds.length) {
    openSheet(`<h2>${esc(t('today.logHarvest'))}</h2>`
      + empty('🌱', 'No beds planted yet', 'A supervisor has to start a crop cycle before harvest can be recorded.'));
    return;
  }
  const el = openSheet(
    `<h2>${esc(t('today.logHarvest'))}</h2>`
    + field(t('harvest.which'),
      `<select name="cycleId" data-act="harvest-bed-change">${beds.map((b) =>
        `<option value="${esc(b.value)}">${esc(b.label)}</option>`).join('')}</select>`)
    + '<div id="harvest-body"></div>',
  );
  renderHarvestBody(ctx, el, beds[0].value);
}

function renderHarvestBody(ctx, sheetEl, cycleId) {
  const state = ctx.store.state;
  const body = sheetEl.querySelector('#harvest-body');
  const cycle = state.cycles[cycleId];
  const safety = cycleSafety(state, cycleId);
  const crop = getCrop(cycle.cropId);
  const crateKg = state.settings.crateKg || 12;

  if (!safety.harvest.safe && safety.harvest.historyMissing) {
    body.innerHTML = note('danger', 'Spray history missing',
      `<p>${esc(safety.harvest.reason)}</p>`
      + '<p>Nobody picks this zone until the Farm Manager or Owner enters its spray history on the Setup screen.</p>')
      + button('Close', 'close-sheet-btn', { cls: 'btn-ghost btn-block' });
    body.querySelector('[data-act="close-sheet-btn"]').onclick = () => closeSheet();
    return;
  }
  if (!safety.harvest.safe) {
    body.innerHTML = note('danger', t('harvest.blocked'),
      `<p>${esc(safety.harvest.reason)}</p>`
      + `<p><b>${esc(safety.harvest.daysLeft)} more day${safety.harvest.daysLeft === 1 ? '' : 's'}.</b> `
      + 'Picking it early puts the buyer and whoever eats it at risk, and it can lose the farm its market. '
      + 'Tell the supervisor if this bed must be picked.</p>')
      + button('Close', 'close-sheet-btn', { cls: 'btn-ghost btn-block' });
    body.querySelector('[data-act="close-sheet-btn"]').onclick = () => closeSheet();
    return;
  }

  const reentryWarning = safety.reentry.safe ? ''
    : note('warn', 'Wear your gloves and boots', `<small>${esc(safety.reentry.reason)}</small>`);

  body.innerHTML = `<form data-act="save-harvest">`
    + `<input type="hidden" name="cycleId" value="${esc(cycleId)}">`
    + reentryWarning
    + `<p><small>${esc(crop.emoji)} ${esc(crop.name)} (${esc(crop.localName)}) — `
    + `${esc(stageAt(cycle.cropId, daysBetween(cycle.transplantDate, isoDate())).name)}</small></p>`
    + field(t('harvest.crates'), input('crates', { type: 'number', min: 0, step: '0.5', inputmode: 'decimal', placeholder: '0' }),
      `One crate is counted as ${crateKg} kg. Change that in Settings if your crates differ.`)
    + field(`${t('harvest.kg')} (if you weighed it)`, input('kg', { type: 'number', min: 0, step: '0.1', inputmode: 'decimal', placeholder: 'optional' }),
      'Leave this empty and the app works it out from the crates.')
    + field('Grade', select('grade', [
      { value: 'first', label: 'First grade — clean, good size' },
      { value: 'second', label: 'Second grade — small or marked' },
      { value: 'reject', label: 'Reject — rotten or spoiled' },
    ], 'first'))
    + field(t('common.note'), textarea('note', { placeholder: 'Anything the supervisor should know' }))
    + photoField('Photo of the crates', 'Not required, but a picture taken at the bed settles any question later.')
    + '<button class="btn-block btn-lg" type="submit">' + esc(t('common.save')) + '</button>'
    + '</form>';
  bindPhoto(sheetEl);
}

async function saveHarvest(ctx, form) {
  const data = readForm(form);
  const state = ctx.store.state;
  const crateKg = state.settings.crateKg || 12;
  const kgValue = Number(data.kg) || (Number(data.crates) || 0) * crateKg;
  if (kgValue <= 0) { toast('Enter crates or kilograms', true); return; }

  const safety = cycleSafety(state, data.cycleId);
  if (!safety.harvest.safe) {
    toast(safety.harvest.historyMissing ? 'That zone has no spray history on record yet'
      : 'That bed is still inside its spray waiting period', true);
    return;
  }

  await ctx.store.dispatch('harvest.record', {
    id: uid('h'),
    cycleId: data.cycleId,
    kg: round(kgValue, 1),
    crates: Number(data.crates) || null,
    grade: data.grade,
    note: data.note || '',
    photo: photoPayload(),
    // The day the work is claimed for. When it was actually entered is stamped
    // on the event itself, and the two are compared on the Farm check screen.
    date: isoDate(),
    enteredAt: new Date().toISOString(),
  });
  resetPhoto();
  closeSheet();
  toast(`${t('harvest.saved')}: ${kg(kgValue)}`);
}

// --- Problem report -------------------------------------------------------

function openReportSheet(ctx) {
  const beds = bedOptions(ctx.store.state);
  const el = openSheet(
    `<h2>${esc(t('today.reportProblem'))}</h2>`
    + '<form data-act="save-report">'
    + field(t('common.bed'), select('cycleId', beds, '', { placeholder: 'Not about one bed' }))
    + field('What is wrong?', textarea('note', {
      placeholder: getLang() === 'pcm'
        ? 'Talk wetin you see. Example: leaf for bed 3 dey yellow and dey fall.'
        : 'Say what you can see. For example: leaves on bed 3 turning yellow and dropping.',
    }))
    + field('How bad is it?', select('severity', [
      { value: 'low', label: 'Just noticed it — a few plants' },
      { value: 'medium', label: 'Spreading — a patch' },
      { value: 'high', label: 'Serious — call somebody now' },
    ], 'medium'))
    + photoField(t('common.photo'), 'A picture of the plant helps more than any description.')
    + '<button class="btn-block btn-lg" type="submit">Send report</button>'
    + '</form>'
    + note('info', 'Not sure what it is?',
      'The Clinic can walk you through it question by question and tell you what to do. '
      + 'You can still send the report first.'),
  );
  bindPhoto(el);
}

async function saveReport(ctx, form) {
  const data = readForm(form);
  if (!data.note || !data.note.trim()) { toast('Say what you can see', true); return; }
  await ctx.store.dispatch('report.record', {
    id: uid('r'),
    cycleId: data.cycleId || null,
    note: data.note.trim(),
    severity: data.severity,
    photo: photoPayload(),
    date: isoDate(),
    enteredAt: new Date().toISOString(),
  });
  resetPhoto();
  closeSheet();
  toast(getLang() === 'pcm' ? 'Dem don hear you' : 'Report sent to the supervisor');
}

// --- Work log -------------------------------------------------------------

export const WORK_TYPES = [
  { value: 'weeding', label: 'Weeding', pidgin: 'Clear grass' },
  { value: 'watering', label: 'Watering / irrigation', pidgin: 'Water di crop' },
  { value: 'transplanting', label: 'Transplanting', pidgin: 'Plant seedling' },
  { value: 'nursery', label: 'Nursery work', pidgin: 'Nursery work' },
  { value: 'fertiliser', label: 'Fertiliser application', pidgin: 'Put fertiliser' },
  { value: 'spraying', label: 'Spraying', pidgin: 'Spray' },
  { value: 'staking', label: 'Staking / pruning', pidgin: 'Stake and cut' },
  { value: 'mulching', label: 'Mulching', pidgin: 'Cover ground' },
  { value: 'harvesting', label: 'Harvesting', pidgin: 'Pick pepper' },
  { value: 'sorting', label: 'Sorting and packing', pidgin: 'Sort and pack' },
  { value: 'drainage', label: 'Drains and beds', pidgin: 'Drain and bed' },
  { value: 'other', label: 'Other', pidgin: 'Another thing' },
];

function openWorkSheet(ctx) {
  const lang = getLang();
  openSheet(
    `<h2>${esc(t('today.logWork'))}</h2>`
    + '<form data-act="save-work">'
    + field('What did you do?', select('activity',
      WORK_TYPES.map((w) => ({ value: w.value, label: lang === 'pcm' ? w.pidgin : w.label })), 'weeding'))
    + field(t('common.bed'), select('cycleId', bedOptions(ctx.store.state), '', { placeholder: 'Not a specific bed' }))
    + field('How many hours?', input('hours', { type: 'number', min: 0, max: 16, step: '0.5', inputmode: 'decimal', value: 4 }))
    + field(t('common.note'), textarea('note', { placeholder: 'optional' }))
    + '<button class="btn-block btn-lg" type="submit">' + esc(t('common.save')) + '</button>'
    + '</form>',
  );
}

async function saveWork(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('work.log', {
    id: uid('w'),
    activity: data.activity,
    cycleId: data.cycleId || null,
    hours: Number(data.hours) || 0,
    note: data.note || '',
    date: isoDate(),
  });
  closeSheet();
  toast(getLang() === 'pcm' ? 'Dem don record am' : 'Work recorded');
}
