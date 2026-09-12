// Screens for the farm hand: what to do today, what was picked, what is wrong.
// Everything here assumes one hand, bright sun, and no time for typing.

import {
  badge, button, card, cardHead, closeSheet, empty, esc, field, input, note, openSheet,
  readForm, select, stat, textarea, toast, tick,
} from './kit.js';
import { t, local, getLang } from '../i18n.js';
import { activeCycles, can, cycleLabel, isClockedIn, openTasks, spraysForCycle } from '../store.js';
import { getCrop, stageAt } from '../domain/crops.js';
import { harvestClearance, reentryClearance, SPRAY_RULES } from '../domain/safety.js';
import { forecastHeadline, seasonOn } from '../domain/climate.js';
import { daysBetween, friendlyDate, isoDate, kg, naira, round, sum, timeOfDay, uid } from '../util.js';
import { bindPhoto, photoField, photoPayload, photoThumb, resetPhoto } from './photo.js';

let weather = null; // filled in by app.js when a forecast is available
export function setWeather(w) { weather = w; }

function bedOptions(state) {
  return activeCycles(state).map((c) => ({ value: c.id, label: cycleLabel(state, c.id) }));
}

function cycleSafety(state, cycleId, at = new Date()) {
  const sprays = spraysForCycle(state, cycleId);
  return {
    harvest: harvestClearance(sprays, at),
    reentry: reentryClearance(sprays, at),
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
            parts.push(note('danger', `${cycleLabel(state, cycle.id)}: do not pick until ${safety.harvest.clearOn}`,
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

    out += card(
      cardHead(t('today.tasks'), mine.length ? badge(`${mine.length}`, 'warn') : '')
      + (mine.length
        ? '<ul class="list">' + mine.map((task) => `<li>`
          + `<div class="grow"><b>${esc(task.title)}</b>`
          + `<small>${esc(task.cycleId ? cycleLabel(state, task.cycleId) : 'General')}`
          + `${task.priority === 'high' ? ' — urgent' : ''}</small></div>`
          + button(t('today.done'), 'task-done', { cls: 'btn-sm', data: { id: task.id } })
          + '</li>').join('') + '</ul>'
        : empty('✅', t('today.noTasks'), 'Anything you do can still be recorded below.')),
    );

    out += card(
      cardHead('Record something')
      + '<div class="grid">'
      + button(t('today.logHarvest'), 'open-harvest', { cls: 'btn-lg', icon: '🧺' })
      + button(t('today.reportProblem'), 'open-report', { cls: 'btn-lg btn-ghost', icon: '⚠️' })
      + button(t('today.logWork'), 'open-work', { cls: 'btn-lg btn-ghost', icon: '🛠️' })
      + button(t('today.checkPlant'), 'go', { cls: 'btn-lg btn-ghost', icon: '🔍', data: { to: '#/diagnose' } })
      + '</div>',
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
        + `<p style="margin:10px 0 0"><small>Total today: <b>${esc(kg(sum(myHarvest, (h) => h.kg)))}</b></small></p>`,
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
    'task-done': async (ctx, el) => {
      await ctx.store.dispatch('task.complete', { id: el.dataset.id });
      toast(getLang() === 'pcm' ? 'Well done' : 'Marked done');
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
    'pick-photo': (ctx, el) => {
      const fileInput = el.closest('.sheet').querySelector('input[type=file]');
      if (fileInput) fileInput.click();
    },
  },
};

function clockInTime(state, personId) {
  const open = [...state.attendance].reverse().find((a) => a.personId === personId && !a.out);
  return open ? timeOfDay(open.in) : '';
}

// --- Harvest --------------------------------------------------------------

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
  if (!safety.harvest.safe) { toast('That bed is still inside its spray waiting period', true); return; }

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
