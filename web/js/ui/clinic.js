// The clinic: work out what is wrong, say how sure the app is, say how to check,
// and say what to do about it today.

import {
  badge, bar, button, card, cardHead, closeSheet, empty, esc, field, input, note,
  openSheet, readForm, select, table, textarea, tick, toast,
} from './kit.js';
import {
  canConfirm, cardFor, cardPhoto, cardSlot, CARDS, CARD_TO_PROBLEM, CUES, FARM_DOCTOR_ROLE,
  lookalikesFor, matchTriage, nameCause, namingGate, photoCoverage, photoCues,
  PHOTO_SLOT_BY_ID, PHOTO_SLOTS, readDiagnosis, referencePhoto, riskForecast, RISK_DRIVER_TEXT, ROOT_READ,
  rowPhoto, rowsForCard, rowSlot, RULES_VERSION, searchCards, separatingSymptom, TRIAGE_BY_N,
} from '../domain/diagnose.js';
import { PROBLEM_BY_ID, PROBLEM_TYPES } from '../domain/pests.js';
import { discouragedFor, productsFor } from '../domain/safety.js';
import { buildCatalogue, canUseActive, resolveActive } from '../domain/catalogue.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { activeCycles, can, cycleLabel, openReports } from '../store.js';
import { t } from '../i18n.js';
import { daysBetween, friendlyDate, isoDate, uid } from '../util.js';
import {
  bindPhoto, bindReferencePhoto, photoField, photoPayload, photoThumb, referencePhotoField,
  referencePhotoPayload, resetPhoto,
} from './photo.js';
import { navigate, params } from './shell.js';

// The guided flow, in the rules' own order: symptom -> triage rows -> card ->
// confirm test. Nothing about the plant lives here; it all comes off the rules.
let wiz = null;
function resetWizard(ctx) {
  const cycles = activeCycles(ctx.state);
  wiz = {
    step: 1,
    cycleId: cycles.length ? cycles[0].id : '',
    cropId: cycles.length ? cycles[0].cropId : 'habanero',
    search: '',
    text: '',
    cues: new Set(),
    match: null,
    rowN: null,
    photos: [],
    confirmResult: '',
    reasoning: '',
    named: null,
  };
  resetPhoto();
}

/** The draft as the domain layer wants it, so one gate decides what is missing. */
function draftOf() {
  return {
    triageRow: wiz.rowN,
    photos: wiz.photos,
    confirmTest: wiz.rowN != null ? (TRIAGE_BY_N.get(wiz.rowN) || {}).confirm : '',
    confirmResult: wiz.confirmResult,
    reasoning: wiz.reasoning,
  };
}

// --- Clinic home ----------------------------------------------------------

export const clinicView = {
  perm: 'diagnose',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();
    const cycles = activeCycles(state).map((c) => ({
      cropId: c.cropId,
      stage: stageAt(c.cropId, daysBetween(c.transplantDate, today)).id,
      label: cycleLabel(state, c.id),
      id: c.id,
    }));
    const risks = riskForecast(cycles, today);
    const reports = openReports(state);
    const recent = [...state.diagnoses].reverse().slice(0, 5);

    let out = card(
      cardHead('Crop clinic')
      + '<p><small>Start with what you can see. The app narrows it down, tells you how to confirm it, '
      + 'and what to do today.</small></p>'
      + '<div class="row wrap">'
      + button('Check a sick plant', 'go', { cls: 'btn-lg', icon: '🔍', data: { to: '#/diagnose' } })
      + button('Browse the guide', 'go', { cls: 'btn-lg btn-ghost', icon: '📖', data: { to: '#/guide' } })
      + '</div>'
      // The clinic answers "what is wrong with this plant". The Farm Doctor
      // answers what to do about it and what the gates are still missing, and
      // the adviser answers "what should the farm do this week" — FR-DOC-11
      // puts those two behind one door, so this is one button, not two.
      + `<div style="margin-top:10px">${button('Alerts', 'go',
        { cls: 'btn-block', icon: '🚨', data: { to: '#/alerts' } })}</div>`
      + `<div style="margin-top:10px">${button('Farm Doctor and adviser', 'go',
        { cls: 'btn-block btn-ghost', icon: '🩺', data: { to: '#/doctor' } })}</div>`
      + '<p style="margin:8px 0 0"><small>Photo review, treatment plans that already pass the '
      + 'rules, gate evidence, the three-day check after a spray — and the adviser that reads '
      + 'your own records. The rules-based half works with no network.</small></p>',
      { tight: true },
    );

    if (reports.length) {
      out += card(
        cardHead('Reported from the field', badge(`${reports.length}`, 'warn'))
        + '<ul class="list">' + reports.slice(0, 6).map((r) => {
          const who = state.people[r.by];
          return '<li><div class="grow">'
            + `<b>${esc(r.note)}</b><small>${esc(r.cycleId ? cycleLabel(state, r.cycleId) : 'General')} — `
            + `${esc(who ? who.name : 'someone')}, ${esc(friendlyDate(r.date))}</small>`
            + (r.photo ? `<img src="${r.photo}" alt="Reported problem" style="max-width:160px;border-radius:10px;margin-top:6px">` : '')
            + '</div>'
            + badge(r.severity, r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warn' : '')
            + button('Resolve', 'resolve-report', { cls: 'btn-sm btn-ghost', data: { id: r.id } })
            + '</li>';
        }).join('') + '</ul>',
      );
    }

    out += card(
      cardHead('What the weather makes likely now')
      + (risks.length
        ? risks.slice(0, 6).map((r) => `<div style="margin-bottom:12px">`
          + `<div class="row between"><b>${esc(r.problem.name)}</b>`
          + badge(`${Math.round(r.risk * 100)}%`, r.risk > 0.7 ? 'danger' : r.risk > 0.5 ? 'warn' : '') + '</div>'
          + bar(r.risk, 'risk')
          + `<small>Driven by ${esc(RISK_DRIVER_TEXT[r.driver] || r.driver)}. `
          + `At risk: ${esc([...new Set(r.beds)].join(', '))}.`
          // Only the problems the rules have a card for get a link; the rest
          // are local field-guide entries with no card behind them.
          + (r.cardId ? ` <a href="#/guide/item?id=${esc(r.cardId)}">What to do</a>` : '')
          + '</small></div>').join('')
        : empty('🌤️', 'Nothing pressing', 'Either nothing is planted, or the weather is not favouring anything in particular.'))
      + '<p style="margin:6px 0 0"><small>This is the weather and the crop stage talking, not a report from the '
      + 'field. It tells you where to walk first, not what is definitely there.</small></p>',
    );

    // FR-DIAG-03 — a hand starts a diagnosis, a Field Supervisor or Farm Manager
    // performs the confirm test and confirms it. Nothing can be sprayed until
    // that happens, so the queue belongs on the front of the clinic.
    const senior = can(ctx.user, 'verifyHarvest');
    const waiting = state.diagnoses.map(readDiagnosis)
      .filter((d) => !d.confirmed && !d.legacy)
      .reverse();
    if (waiting.length) {
      out += card(
        cardHead('Waiting to be confirmed', badge(`${waiting.length}`, 'warn'))
        + '<ul class="list">' + waiting.slice(0, 6).map((d) => `<li><div class="grow">`
          + `<b>${esc(d.label)}</b><small>${esc(d.cycleId ? cycleLabel(state, d.cycleId) : 'No bed recorded')} — `
          + `${esc(friendlyDate(d.date))}<br>Confirm test: ${esc(d.confirmTest || 'none recorded')}</small></div>`
          + (senior
            ? button('Confirm', 'open-confirm', { cls: 'btn-sm', data: { id: d.id } })
            : badge('Supervisor', ''))
          + '</li>').join('') + '</ul>'
        + (senior ? '' : '<p><small>A Field Supervisor or Farm Manager confirms these.</small></p>'),
      );
    }

    if (recent.length) {
      out += card(
        cardHead('Recent diagnoses')
        + '<ul class="list">' + recent.map(readDiagnosis).map((d) => `<li><div class="grow">`
          + `<b>${esc(d.label)}</b>`
          + `<small>${esc(d.cycleId ? cycleLabel(state, d.cycleId) : 'No bed recorded')} — `
          + `${esc(friendlyDate(d.date))}, ${esc(d.confidence || 'no confidence recorded')}`
          + (d.legacy ? ` · ${d.mapping === 'mapped' ? 'legacy, read as a card' : 'legacy record'}` : '')
          + (d.confirmed ? ' · confirmed' : ' · not confirmed') + '</small></div>'
          + (d.cardId
            ? `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(d.cardId)}">Open</a>`
            : badge('legacy', ''))
          + '</li>').join('') + '</ul>'
        + (recent.some((d) => readDiagnosis(d).legacy)
          ? '<p><small>Records from before the rules engine are marked legacy. Where the old name matches '
            + 'a card exactly they are read as that card; the rest are left as they were written, because '
            + 'nobody did the rules\' confirm test on them.</small></p>'
          : ''),
      );
    }

    return out;
  },

  actions: {
    'resolve-report': async (ctx, el) => {
      await ctx.store.dispatch('report.resolve', { id: el.dataset.id, note: 'Handled' });
      toast('Report closed');
    },
    'open-confirm': (ctx, el) => openConfirmSheet(ctx, el.dataset.id),
    'save-confirm': (ctx, form) => saveConfirm(ctx, form),
  },
};

/**
 * The rules: "Field Supervisor or Farm Manager performs the confirm test and
 * confirms". Performing it is the point, so the sheet asks what the test
 * showed rather than offering a bare Confirm button.
 */
function openConfirmSheet(ctx, id) {
  const record = readDiagnosis(ctx.state.diagnoses.find((d) => d.id === id));
  if (!record) { toast('That diagnosis is gone', true); return; }
  const verdict = canConfirm(record, { by: ctx.user && ctx.user.id, senior: true });
  const row = record.triageRow != null ? TRIAGE_BY_N.get(Number(record.triageRow)) : null;

  openSheet(`<h2>Confirm: ${esc(record.label)}</h2>`
    + `<p><small>${esc(record.cycleId ? cycleLabel(ctx.state, record.cycleId) : 'No bed recorded')} — `
    + `recorded ${esc(friendlyDate(record.date))}</small></p>`
    + (record.reasoning ? note('info', 'What they wrote', `<small>${esc(record.reasoning)}</small>`) : '')
    + (record.photos || []).map((ph) => photoThumb(ph, { small: true })).join('')
    + (verdict.ok
      ? `<p><b>Do this test yourself:</b><br>${esc(row ? row.confirm : record.confirmTest)}</p>`
        + '<form data-act="save-confirm">'
        + `<input type="hidden" name="id" value="${esc(record.id)}">`
        + `<input type="hidden" name="confirmTest" value="${esc(row ? row.confirm : record.confirmTest)}">`
        + field('What did it show?', textarea('confirmResult', { rows: 3, placeholder: 'What you saw when you did the test' }))
        + field('Anything to add?', textarea('note', { rows: 2 }))
        + '<button class="btn-block btn-lg" type="submit">Confirm this diagnosis</button></form>'
      : note('danger', 'This cannot be confirmed',
        `<small>${esc(verdict.why)}${verdict.fix ? `<br>${esc(verdict.fix)}` : ''}</small>`)));
}

async function saveConfirm(ctx, form) {
  const data = readForm(form);
  if (!String(data.confirmResult || '').trim()) { toast('Say what the test showed', true); return; }
  await ctx.store.dispatch('diagnosis.confirm', {
    id: data.id,
    confirmTest: data.confirmTest,
    confirmResult: data.confirmResult,
    note: data.note || '',
  });
  closeSheet();
  toast('Confirmed — treatment can now be planned');
}

// --- Reference photos (FR-DIAG-01, UX-11) --------------------------------
//
// One slot per triage row and one per diagnosis card. The Owner and the Farm
// Manager hold `settings`, and they are the only two who may fill one. Everyone
// else sees the pictures; nobody is ever stopped by an empty slot, because the
// rules' own wording is what the app matches on and what the tick-list shows.

const canEditPhotos = (ctx) => can(ctx.user, 'settings');

/** The picture for a slot, or the words and an invitation to add one. */
function referenceBlock(ctx, slot, { title = 'Reference photo' } = {}) {
  const meta = PHOTO_SLOT_BY_ID.get(slot);
  if (!meta) return '';
  const held = referencePhoto(ctx.state, slot);
  const who = held && ctx.state.people[held.by];
  const editor = canEditPhotos(ctx);

  if (held) {
    return `<div class="ref-shot"><img src="${held.photo.dataUrl}" `
      + `alt="Reference photo: ${esc(meta.label)}" loading="lazy"></div>`
      + `<p><small>${held.caption ? `${esc(held.caption)} — ` : ''}`
      + `added by ${esc(who ? who.name : 'a manager')}, ${esc(friendlyDate((held.at || '').slice(0, 10)))}`
      + '</small></p>'
      + (editor
        ? '<div class="row wrap">'
          + button('Replace', 'open-reference', { cls: 'btn-sm btn-ghost', data: { slot } })
          + button('Remove', 'remove-reference', { cls: 'btn-sm btn-quiet', data: { slot } })
          + '</div>'
        : '');
  }

  return note('info', `No ${title.toLowerCase()} yet`,
    `<small>The words below are what the app matches on, so nothing is missing from the `
    + `diagnosis. A picture would make it faster to recognise.</small>`)
    + (editor
      ? button('Add a reference photo', 'open-reference', { cls: 'btn-sm', data: { slot } })
      : '');
}

/** Shared by every screen that can attach one. */
const referenceActions = {
  // 'pick-reference' is a shell action, alongside 'pick-photo'.
  'open-reference': (ctx, el) => openReferenceSheet(ctx, el.dataset.slot),
  'save-reference': (ctx, form) => saveReference(ctx, form),
  'remove-reference': (ctx, el) => openRemoveReferenceSheet(ctx, el.dataset.slot),
  'confirm-remove-reference': (ctx, form) => removeReference(ctx, form),
};

function openReferenceSheet(ctx, slot) {
  const meta = PHOTO_SLOT_BY_ID.get(slot);
  if (!meta) { toast('That slot is not in the rules', true); return; }
  if (!canEditPhotos(ctx)) { toast('Only the Owner or the Farm Manager adds these', true); return; }
  const held = referencePhoto(ctx.state, slot);

  openSheet(`<h2>${held ? 'Replace' : 'Add'} a reference photo</h2>`
    + `<p><small><b>${esc(meta.where)}</b><br>${esc(meta.label)}</small></p>`
    + note('info', 'What this picture is for', `<small>${esc(meta.shows)}</small>`)
    + '<form data-act="save-reference">'
    + `<input type="hidden" name="slot" value="${esc(slot)}">`
    + referencePhotoField(held ? 'Choose a new picture' : 'Choose a picture')
    + field('Caption', input('caption', {
      placeholder: 'e.g. GH-03, week 6 — the bronzing on the youngest tips',
      value: held ? held.caption : '',
    }), 'Optional. Say where and when it was taken, so people can judge it.')
    + '<button class="btn-block btn-lg" type="submit">Save this picture</button></form>');
  bindReferencePhoto(document);
}

async function saveReference(ctx, form) {
  const data = readForm(form);
  const photo = referencePhotoPayload();
  if (!photo) { toast('Choose a picture first', true); return; }
  await ctx.store.dispatch('reference.photo.set', {
    slot: data.slot,
    photo,
    caption: (data.caption || '').trim(),
  });
  closeSheet();
  toast('Reference photo saved — every phone gets it on the next sync');
}

function openRemoveReferenceSheet(ctx, slot) {
  const meta = PHOTO_SLOT_BY_ID.get(slot);
  if (!meta) return;
  openSheet(`<h2>Remove this picture?</h2>`
    + `<p><small>${esc(meta.where)} — ${esc(meta.label)}</small></p>`
    + '<p><small>The words stay, so the diagnosis is unaffected. Say why it is coming off: '
    + 'a reference photo that turns out to show the wrong thing is worth recording.</small></p>'
    + '<form data-act="confirm-remove-reference">'
    + `<input type="hidden" name="slot" value="${esc(slot)}">`
    + field('Why?', input('reason', { placeholder: 'e.g. it was actually spider mite' }))
    + '<button class="btn-block btn-lg" type="submit">Remove it</button></form>');
}

async function removeReference(ctx, form) {
  const data = readForm(form);
  if (String(data.reason || '').trim().length < 4) { toast('Say why it is coming off', true); return; }
  await ctx.store.dispatch('reference.photo.clear', { slot: data.slot, reason: data.reason.trim() });
  closeSheet();
  toast('Picture removed');
}

/** "42 of 45 slots have a picture", with the gaps named. */
function coverageLine(cov) {
  return `<p><small><b>${cov.have} of ${cov.total}</b> slots have a reference photo `
    + `— ${cov.cards.have}/${cov.cards.total} cards, ${cov.rows.have}/${cov.rows.total} triage rows`
    + (cov.bytes ? ` · ${Math.round(cov.bytes / 1024)} KB carried by every phone` : '')
    + '</small></p>' + bar(cov.percent);
}

// --- Diagnosis wizard -----------------------------------------------------
//
// FR-DOC-01: symptom -> matching triage rows -> card -> confirm test, and the
// cause is not named until the photos and the confirm step are on the record.
// Step 3 deliberately shows the triage row's WORDS and its confirm test, not
// the cause it points at: naming it there would invite the person to agree
// with the app instead of going and looking.

export const diagnoseView = {
  perm: 'diagnose',
  enter(ctx) { resetWizard(ctx); },

  render(ctx) {
    if (!wiz) resetWizard(ctx);
    const steps = `<div class="wizard-steps">${[1, 2, 3, 4].map((n) =>
      `<i class="${wiz.step >= n ? 'on' : ''}"></i>`).join('')}</div>`;

    if (wiz.step === 1) return steps + stepCrop(ctx);
    if (wiz.step === 2) return steps + stepSeen(ctx);
    if (wiz.step === 3) return steps + stepTriage(ctx);
    return steps + stepCard(ctx);
  },

  actions: {
    'wiz-crop': (ctx, el) => {
      wiz.cycleId = el.dataset.id || '';
      const cycle = ctx.state.cycles[wiz.cycleId];
      if (cycle) wiz.cropId = cycle.cropId;
      ctx.refresh();
    },
    'wiz-crop-only': (ctx, el) => { wiz.cropId = el.dataset.crop; wiz.cycleId = ''; ctx.refresh(); },
    'toggle-cue': (ctx, el) => {
      const id = el.dataset.id;
      if (wiz.cues.has(id)) wiz.cues.delete(id); else wiz.cues.add(id);
      ctx.refresh();
    },
    'pick-row': (ctx, el) => {
      readStep();
      wiz.rowN = Number(el.dataset.n);
      ctx.refresh();
    },
    'add-photo': (ctx) => {
      const shot = photoPayload();
      if (!shot) { toast('Take the photo first', true); return; }
      wiz.photos = [...wiz.photos, shot];
      resetPhoto();
      readStep();
      ctx.refresh();
    },
    'drop-photo': (ctx, el) => {
      wiz.photos = wiz.photos.filter((_, i) => i !== Number(el.dataset.i));
      ctx.refresh();
    },
    'wiz-next': (ctx) => {
      readStep();
      if (wiz.step === 2) {
        const observation = { cues: [...wiz.cues], text: wiz.text };
        wiz.match = matchTriage(observation);
        if (!wiz.match.rows.length) {
          toast('Nothing in the triage table matches that. Try the words on the cards.', true);
          return;
        }
        wiz.rowN = wiz.match.rows[0].row.n;
      }
      if (wiz.step === 3) {
        const gate = namingGate(draftOf());
        if (!gate.ok) { toast(gate.missing[0].need, true); return; }
        wiz.named = nameCause(draftOf());
      }
      wiz.step = Math.min(4, wiz.step + 1);
      window.scrollTo(0, 0);
      ctx.refresh();
    },
    'wiz-back': (ctx) => { readStep(); wiz.step = Math.max(1, wiz.step - 1); ctx.refresh(); },
    'wiz-restart': (ctx) => { resetWizard(ctx); ctx.refresh(); },
    'save-diagnosis': (ctx) => saveDiagnosis(ctx),
    'make-task': (ctx, el) => openTaskSheet(ctx, el.dataset.id),
    'save-task': (ctx, form) => saveTask(ctx, form),
    ...referenceActions,
  },

  mounted() {
    bindPhoto(document);
    const box = document.querySelector('input[name=cue-search]');
    if (box) {
      box.oninput = () => {
        wiz.search = box.value;
        const ctx = window.__douvalueCtx;
        const pos = box.selectionStart;
        if (!ctx) return;
        ctx.refresh();
        const again = document.querySelector('input[name=cue-search]');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      };
    }
  },
};

/**
 * One rendering of a separating test, so step 3 and step 4 say it the same way.
 * Every line of it is the rules' own wording.
 */
function separatorNote(sep, title = 'These two are told apart by one test') {
  if (!sep) return '';
  const lines = sep.tests.map((x, i) =>
    `<b>${i === 0 ? 'Do this' : 'If not, then'}:</b> ${esc(x.test)}<br>`
    + `→ if it shows, it is <b>${esc(x.points_to.name)}</b>.`).join('<br>');
  return note('info', title,
    `<small>${lines}<br><i>From the ${esc(sep.source)}.</i></small>`);
}

/** Pull the free-text fields off the screen before the view is thrown away. */
function readStep() {
  const seen = document.querySelector('textarea[name=seen]');
  if (seen) wiz.text = seen.value;
  const result = document.querySelector('textarea[name=confirmResult]');
  if (result) wiz.confirmResult = result.value;
  const why = document.querySelector('textarea[name=reasoning]');
  if (why) wiz.reasoning = why.value;
}

function stepCrop(ctx) {
  const cycles = activeCycles(ctx.state);
  return card(
    cardHead(t('dx.start'))
    + '<p><small>Which crop are you looking at? If it is one of the beds, pick that so the advice '
    + 'can use the crop stage and the spray history.</small></p>'
    + (cycles.length
      ? '<div class="ticks">' + cycles.map((c) => `<label class="tick ${wiz.cycleId === c.id ? 'on' : ''}" `
        + `data-act="wiz-crop" data-id="${esc(c.id)}"><span class="box">✓</span><span class="txt">`
        + `<b>${esc(cycleLabel(ctx.state, c.id))}</b><span class="pid">${esc(getCrop(c.cropId).name)} — day `
        + `${daysBetween(c.transplantDate, isoDate())}</span></span></label>`).join('') + '</div>'
      : '')
    + '<p style="margin-top:14px"><small>Or just the crop, with no bed:</small></p>'
    + '<div class="row wrap">' + CROP_LIST.map((c) => `<button class="chip ${wiz.cropId === c.id && !wiz.cycleId ? 'on' : ''}" `
      + `data-act="wiz-crop-only" data-crop="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join(' ') + '</div>'
    + '<div class="sticky-actions">' + button(t('common.next'), 'wiz-next', { cls: 'btn-block btn-lg' }) + '</div>',
  );
}

/** Step 2 — what you can see, in the rules' own words, with the pictures we have. */
function stepSeen(ctx) {
  const q = wiz.search.trim().toLowerCase();
  // UX-11: photo cards or a searchable list by name, whichever the person
  // prefers. Here it is both at once — a cue whose triage row has a reference
  // photo shows it; a cue whose slot is empty is the same tick it always was.
  const cues = photoCues(ctx.state);
  const list = (q ? cues.filter((c) => c.text.toLowerCase().includes(q)) : cues);
  const withPhotos = cues.filter((c) => c.photo).length;
  return card(
    cardHead('What can you see?')
    + `<p><small>Tick everything that matches, or write it in your own words. These are the `
    + `${CUES.length} things the ${TRIAGE_BY_N.size} triage rows describe`
    + (withPhotos ? `, ${withPhotos} of them with a reference photo` : '')
    + '.</small></p>'
    + `<div class="field">${input('cue-search', { placeholder: 'Search: galls, wilt, spots, curl...', value: wiz.search })}</div>`
    + (list.length
      ? '<div class="ticks">' + list.map((c) => tick(
        c.id, c.text, c.caption || '', wiz.cues.has(c.id),
        { act: 'toggle-cue', img: c.photo ? c.photo.dataUrl : '' },
      )).join('') + '</div>'
      : empty('🔎', 'No wording matched', 'Clear the search, or type what you see below.'))
    + field('In your own words', textarea('seen', {
      value: wiz.text, rows: 3, placeholder: 'e.g. stunted plants, no galls on the roots',
    }), 'Written notes count as evidence too (UX-08).')
    + '<div class="sticky-actions">'
    + button(t('common.back'), 'wiz-back', { cls: 'btn-ghost' })
    + button(`${t('common.next')} (${wiz.cues.size})`, 'wiz-next', { cls: 'btn-block btn-lg' })
    + '</div>',
  );
}

/** Step 3 — the matching triage rows, the confirm test, the photos. No cause yet. */
function stepTriage(ctx) {
  const match = wiz.match;
  const rows = match.rows;
  const chosen = TRIAGE_BY_N.get(wiz.rowN);
  const gate = namingGate(draftOf());

  let out = card(
    cardHead('What it could be')
    + `<p><small>${rows.length} of the ${TRIAGE_BY_N.size} triage rows match "${esc(match.observation)}". `
    + 'Pick the one that reads like the plant in front of you.</small></p>'
    + separatorNote(match.separator, 'The top two are told apart by one test'),
    { tight: true },
  );

  out += card('<ul class="list">' + rows.map((r) => {
    const on = r.row.n === wiz.rowN;
    return `<li class="${on ? 'on' : ''}"><div class="grow"><b>${esc(r.row.see)}</b>`
      + `<small>Row ${r.row.n} · match ${Math.round(r.score * 100)}% · confidence ${esc(r.confidence.label)}`
      + (r.contradicted.length
        ? ` · argues against: ${esc(r.contradicted.map((c) => c.term).join(', '))}` : '')
      + '</small></div>'
      + button(on ? 'Picked' : 'Pick', 'pick-row', { cls: on ? 'btn-sm' : 'btn-sm btn-ghost', data: { n: r.row.n } })
      + '</li>';
  }).join('') + '</ul>');

  if (chosen) {
    out += card(
      cardHead('Now confirm it', badge(`Row ${chosen.n}`))
      + referenceBlock(ctx, rowSlot(chosen.n), { title: 'Reference photo' })
      + note('warn', 'The Farm Doctor will not name a cause yet',
        '<small>Photos and the confirm test come first. That is the whole difference between a '
        + 'diagnosis and a guess.</small>')
      + `<h3>The confirm test</h3><p><b>${esc(chosen.confirm)}</b></p>`
      + photoField('Photo of the plant', 'Taken in the app, stamped with time and zone (FR-PROOF-02).')
      + button('Attach this photo', 'add-photo', { cls: 'btn-ghost btn-block' })
      + (wiz.photos.length
        ? '<div class="row wrap" style="margin-top:10px">' + wiz.photos.map((ph, i) =>
          `<div style="margin-right:8px">${photoThumb(ph)}`
          + button('Remove', 'drop-photo', { cls: 'btn-sm btn-quiet', data: { i } })
          + '</div>').join('') + '</div>'
        : '')
      + field('What did the test show?', textarea('confirmResult', {
        value: wiz.confirmResult, rows: 2, placeholder: 'e.g. pulled three plants, roots stubby with dead tips, no galls',
      }))
      + field('Why do you think it is this?', textarea('reasoning', {
        value: wiz.reasoning, rows: 3, placeholder: 'What you saw, where, and what it rules out',
      }), 'FR-DIAG-02 — the written reasoning is part of the record.')
      + (gate.ok ? '' : note('danger', 'Still needed',
        '<ul>' + gate.missing.map((m) => `<li>${esc(m.need)}</li>`).join('') + '</ul>')),
    );
  }

  out += '<div class="sticky-actions">'
    + button(t('common.back'), 'wiz-back', { cls: 'btn-ghost' })
    + button('Name the cause', 'wiz-next', { cls: 'btn-block btn-lg' })
    + '</div>';
  return out;
}

/** Step 4 — the card, the look-alikes and the test that separates them. */
function stepCard(ctx) {
  const named = wiz.named;
  if (!named || !named.card) {
    return card(empty('🤔', 'Not named yet', 'Go back and finish the confirm step.')
      + button('Back', 'wiz-back', { cls: 'btn-block' }));
  }
  const c = named.card;
  const legacy = CARD_TO_PROBLEM[c.id];
  const problem = legacy ? PROBLEM_BY_ID[legacy] : null;

  let out = card(
    `<div class="card-head"><h2>${esc(c.name)}</h2>${badge(esc(c.category))}</div>`
    + `<p><small>From triage row ${named.row.n}, confirmed by test. Rules ${esc(RULES_VERSION)}.</small></p>`
    + referenceBlock(ctx, cardSlot(c.id))
    + `<h3>Cause</h3><p><small>${esc(c.cause)}</small></p>`
    + `<h3>How it shows</h3><p><small>${esc(c.detection)}</small></p>`
    + `<h3>Do this now</h3><p><small>${esc(named.firstAction)}</small></p>`
    + `<h3>Treatment</h3><p><small>${esc(c.treatment)}</small></p>`
    + '<details><summary><b>Stop it coming back</b></summary>'
    + `<p><small>${esc(c.prevention)}</small></p></details>`
    + (named.labRecommended
      ? note('danger', 'Send a sample to the lab',
        '<small>The rules require a lab for this one, and the Owner is notified '
        + '(FR-DOC-09, FR-DIAG-05).</small>')
      : ''),
  );

  if (named.lookalikes.length) {
    out += card(
      cardHead('Could be confused with')
      + '<ul class="list">' + named.lookalikes.map((l) => {
        const sep = separatingSymptom(c.id, l.cardId);
        return `<li><div class="grow"><b>${esc(l.card.name)}</b>`
          + `<small>${sep
            ? `${esc(sep.test)} → ${esc(sep.points_to.name)}`
            : 'Check both'}</small></div>`
          + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(l.cardId)}">Open</a></li>`;
      }).join('') + '</ul>'
      + separatorNote(named.separator, 'The closest one is told apart by this test')
      + (named.separator && named.separator.kind === 'root_read'
        ? note('info', `${ROOT_READ.test} — all four readings`,
          `<small>${ROOT_READ.readings.map((r) => `<b>${esc(r.sign)}</b> → ${esc(r.reading)}`).join('<br>')}`
          + `<br><i>${esc(ROOT_READ.when)}</i></small>`)
        : ''),
    );
  }

  out += card(
    cardHead('Record it')
    + '<p><small>This saves the card, your answers, the photos, the written reasoning and your name. '
    + 'A Field Supervisor or Farm Manager still has to do the confirm test and confirm it before '
    + 'anything can be sprayed (FR-DIAG-03, FR-GATE-04).</small></p>'
    + '<div class="row wrap">'
    + button('Record this diagnosis', 'save-diagnosis', { cls: 'btn-lg' })
    + button('Make it a job', 'make-task', { cls: 'btn-ghost', data: { id: legacy || c.id } })
    + '</div>'
    + (problem
      ? `<p style="margin-top:10px"><small>Product, PHI and spray detail for this one: `
        + `<a href="#/guide/item?id=${esc(c.id)}">open the card</a>.</small></p>`
      : ''),
  );

  out += card(
    note('info', 'The Farm Doctor advises; people decide',
      `<small>${esc(FARM_DOCTOR_ROLE)}</small>`)
    + '<div class="row wrap">'
    + button('Start again', 'wiz-restart', { cls: 'btn-ghost' })
    + button('Back to clinic', 'go', { cls: 'btn-quiet', data: { to: '#/clinic' } })
    + '</div>',
    { tight: true },
  );

  return out;
}

async function saveDiagnosis(ctx) {
  const named = wiz.named;
  if (!named || !named.card) { toast('Finish the confirm step first', true); return; }
  const draft = draftOf();
  await ctx.store.dispatch('diagnosis.record', {
    id: uid('dx'),
    engine: RULES_VERSION,
    cardId: named.card.id,
    problemId: CARD_TO_PROBLEM[named.card.id] || named.card.id,
    problemName: named.card.name,
    triageRow: named.row.n,
    cycleId: wiz.cycleId || null,
    cropId: wiz.cropId,
    observation: wiz.match ? wiz.match.observation : '',
    cues: [...wiz.cues],
    photos: wiz.photos,
    confirmTest: draft.confirmTest,
    confirmResult: draft.confirmResult,
    reasoning: draft.reasoning,
    lookalikes: named.lookalikes.map((l) => l.cardId),
    labRecommended: named.labRecommended,
    confidence: wiz.match && wiz.match.rows.length ? wiz.match.rows[0].confidence.label : 'Medium',
    date: isoDate(),
  });
  toast('Diagnosis recorded — a supervisor confirms it next');
  navigate('#/clinic');
}

/**
 * Turn a diagnosis into a job. The job list comes from the rules' first_action
 * for the card, and from the local field guide for a legacy record that has no
 * card, so both kinds of record can still raise work.
 */
function openTaskSheet(ctx, problemId) {
  const hit = cardFor(problemId);
  const legacy = PROBLEM_BY_ID[problemId];
  const name = (hit && hit.name) || (legacy && legacy.name) || problemId;
  const jobs = hit ? rowsForCard(hit.id).map((r) => r.firstAction) : (legacy ? legacy.manage.now : []);
  if (!jobs.length) { toast('Nothing to turn into a job for this one', true); return; }
  const urgent = hit
    ? ['virus', 'disease', 'soil'].includes(hit.category)
    : Boolean(legacy && legacy.severity >= 4);
  const cycles = activeCycles(ctx.state);

  openSheet(`<h2>Make it a job</h2><p><small>${esc(name)}</small></p>`
    + '<form data-act="save-task">'
    + `<input type="hidden" name="problemId" value="${esc(problemId)}">`
    + field('What must be done?', select('title', jobs.map((n) => ({ value: n, label: n })), jobs[0]))
    + field('On which bed?', select('cycleId',
      cycles.map((c) => ({ value: c.id, label: cycleLabel(ctx.state, c.id) })), wiz ? wiz.cycleId : ''))
    + field('Who does it?', select('assignedTo',
      Object.values(ctx.state.people).filter((x) => x.active !== false)
        .map((x) => ({ value: x.id, label: x.name })), '', { placeholder: 'Anyone' }))
    + field('When?', input('dueDate', { type: 'date', value: isoDate() }))
    + field('How urgent?', select('priority', [
      { value: 'high', label: 'Urgent — today' },
      { value: 'normal', label: 'Normal' },
    ], urgent ? 'high' : 'normal'))
    + '<button class="btn-block btn-lg" type="submit">Create job</button></form>');
}

async function saveTask(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('task.create', {
    id: uid('t'), title: data.title, cycleId: data.cycleId || null,
    assignedTo: data.assignedTo || null, dueDate: data.dueDate, priority: data.priority,
    source: 'clinic', problemId: data.problemId,
  });
  closeSheet();
  toast('Job created');
}

// --- Guide ----------------------------------------------------------------
//
// The guide is now the rules' 22 diagnosis cards. Where a card also has an
// entry in the local field guide (pests.js), that entry is shown underneath
// for the product, PHI and weather detail the rules do not carry.

let guideFilter = { category: '', query: '', noPhoto: false };

export const guideView = {
  perm: 'viewGuide',
  render(ctx) {
    const cov = photoCoverage(ctx.state);
    const gaps = new Set(cov.cards.missing.map((m) => m.cardId));
    const list = searchCards(guideFilter.query)
      .filter((c) => !guideFilter.category || c.category === guideFilter.category)
      .filter((c) => !guideFilter.noPhoto || gaps.has(c.id));
    const categories = [...new Set(CARDS.map((c) => c.category))].sort();

    return card(
      cardHead('Farm Doctor cards', badge(`${CARDS.length}`))
      + `<p><small>The ${CARDS.length} diagnosis cards and ${TRIAGE_BY_N.size} triage rows from the rules `
      + `(${esc(RULES_VERSION)}). This is the same table the clinic diagnoses from.</small></p>`
      + `<div class="field">${input('q', { placeholder: 'Search: galls, wilt, borer, boron...', value: guideFilter.query })}</div>`
      + '<div class="row wrap">'
      + `<button class="chip ${!guideFilter.category && !guideFilter.noPhoto ? 'on' : ''}" data-act="guide-type" data-type="">All</button>`
      + categories.map((id) =>
        `<button class="chip ${guideFilter.category === id ? 'on' : ''}" data-act="guide-type" data-type="${esc(id)}">`
        + `${esc(id)}</button>`).join(' ')
      + ` <button class="chip ${guideFilter.noPhoto ? 'on' : ''}" data-act="guide-nophoto">`
      + `📷 No photo yet (${cov.cards.missing.length})</button>`
      + '</div>',
      { tight: true },
    ) + card(
      cardHead('Reference photos')
      + coverageLine(cov)
      + `<div style="margin-top:10px">${button('See every slot', 'go',
        { cls: 'btn-block btn-ghost', icon: '🖼', data: { to: '#/guide/photos' } })}</div>`,
      { tight: true },
    ) + card(
      list.length
        ? '<ul class="list">' + list.map((c) => {
          const held = cardPhoto(ctx.state, c.id);
          return `<li>${held
            ? `<span class="tick-img"><img src="${held.photo.dataUrl}" alt="" loading="lazy"></span>`
            : ''}<div class="grow">`
            + `<b>${esc(c.name)}</b><small>${esc(c.category)} — from triage row${c.rows.length > 1 ? 's' : ''} `
            + `${c.rows.join(', ')}${held ? '' : ' · no photo yet'}</small></div>`
            + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(c.id)}">Open</a></li>`;
        }).join('') + '</ul>'
        : empty('🔎', 'Nothing matched', 'Try a different word, or browse by kind.'),
    );
  },

  actions: {
    'guide-type': (ctx, el) => {
      guideFilter.category = el.dataset.type; guideFilter.query = ''; guideFilter.noPhoto = false;
      ctx.refresh();
    },
    'guide-nophoto': (ctx) => {
      guideFilter.noPhoto = !guideFilter.noPhoto; guideFilter.category = ''; ctx.refresh();
    },
  },

  mounted() {
    const box = document.querySelector('input[name=q]');
    if (!box) return;
    box.oninput = () => {
      guideFilter.query = box.value;
      const ctx = window.__douvalueCtx;
      const pos = box.selectionStart;
      if (ctx) { ctx.refresh(); const again = document.querySelector('input[name=q]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); } }
    };
  },
};

/**
 * What the guide suggests, checked against what the farm can actually spray.
 *
 * The guide is written for pepper anywhere; the catalogue is this farm's, out
 * of the rules file. Saying which is which here stops the clinic recommending
 * something the spray screen will then refuse to offer.
 */
function catalogueStanding(state, product) {
  const catalogue = buildCatalogue(state);
  const active = resolveActive(catalogue, product.id) || resolveActive(catalogue, product.name);
  if (!active) return 'not in the catalogue';
  const usable = canUseActive(catalogue, active.id);
  return usable.ok ? `${active.group}` : 'needs a label rate';
}

export const guideItemView = {
  perm: 'viewGuide',
  render(ctx) {
    const c = cardFor(params().id);
    if (!c) return card(empty('📖', 'Not in the rules', 'Go back and pick from the list.'));
    const rows = rowsForCard(c.id);
    const lookalikes = lookalikesFor(c.id);
    const legacyId = CARD_TO_PROBLEM[c.id];
    const problem = legacyId ? PROBLEM_BY_ID[legacyId] : null;
    const safe = problem ? productsFor(problem.id) : [];
    const avoid = problem ? discouragedFor(problem.id) : [];

    let out = card(
      `<div class="card-head"><h2>${esc(c.name)}</h2>${badge(esc(c.category))}</div>`
      + `<p><small>${esc(c.cause)}</small></p>`
      + (c.status ? note('warn', 'Drafted, not yet reviewed', `<small>${esc(c.status)}</small>`) : ''),
      { tight: true },
    )
    + card(cardHead('How it shows')
      + referenceBlock(ctx, cardSlot(c.id))
      + `<p>${esc(c.detection)}</p>`)
    + card(cardHead('Triage rows that reach this card')
      + rows.map((r) => {
        const held = rowPhoto(ctx.state, r.n);
        return `<div class="${held ? '' : 'ref-missing'}" style="margin-bottom:14px">`
          + `<b>${esc(r.see)}</b>`
          + `<p><small>Row ${r.n} · confirm: ${esc(r.confirm)}</small></p>`
          + referenceBlock(ctx, rowSlot(r.n), { title: 'Photo of this symptom' })
          + '</div>';
      }).join(''))
    + card(cardHead('Do this now')
      + '<ul>' + rows.map((r) => `<li>${esc(r.firstAction)}</li>`).join('') + '</ul>'
      + `<h3>Treatment</h3><p>${esc(c.treatment)}</p>`)
    + card(cardHead('Stop it coming back') + `<p>${esc(c.prevention)}</p>`);

    if (lookalikes.length) {
      out += card(cardHead('Could be confused with')
        + '<ul class="list">' + lookalikes.map((l) => {
          const sep = separatingSymptom(c.id, l.cardId);
          return `<li><div class="grow"><b>${esc(l.card.name)}</b>`
            + `<small>${sep ? `${esc(sep.test)} → ${esc(sep.points_to.name)}` : ''}</small></div>`
            + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(l.cardId)}">Open</a></li>`;
        }).join('') + '</ul>');
    }

    if (safe.length) {
      out += card(cardHead('If you spray')
        + table([{ label: 'Product' }, { label: 'Example' }, { label: 'Wait', num: true },
          { label: 'On this farm' }],
          safe.map((x) => [x.name, x.examples, `${x.phiDays} d`, catalogueStanding(ctx.state, x)]))
        + '<p><small>The wait is the days between spraying and picking. Rotate groups so the product keeps '
        + 'working. The label on the container beats anything written here.</small></p>');
    }
    if (avoid.length) {
      out += card(note('danger', 'Do not use these on pepper',
        '<small>' + avoid.map((a) => `<b>${esc(a.name)}</b>: ${esc(a.note)}`).join('<br><br>') + '</small>'));
    }
    if (problem) {
      out += card(cardHead('Local field guide')
        + `<p><small>Locally: ${esc(problem.local)} · ${esc(PROBLEM_TYPES[problem.type].label)} · `
        + `severity ${problem.severity}/5 · spreads ${esc(problem.spread)}</small></p>`
        + note('warn', 'What it costs you', `<small>${esc(problem.loss)}</small>`)
        + '<details><summary><b>Without chemicals</b></summary><ul>'
        + problem.manage.organic.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul></details>');
    }

    return out + card(button('Back to the cards', 'go', { cls: 'btn-ghost', data: { to: '#/guide' } }), { tight: true });
  },

  actions: { ...referenceActions },
  mounted() { bindReferencePhoto(document); },
};

// --- Reference photo desk --------------------------------------------------
//
// Every slot in one place, gaps first, so "which cards still have no photo" is
// a screen rather than a memory. Anyone may read it — a hand who can see what
// is missing is a hand who can go and photograph it — but only the Owner and
// the Farm Manager get the buttons.

export const photoDeskView = {
  perm: 'viewGuide',
  render(ctx) {
    const cov = photoCoverage(ctx.state);
    const editor = canEditPhotos(ctx);
    const row = (slot) => {
      const held = referencePhoto(ctx.state, slot.slot);
      return `<li class="${held ? '' : 'ref-missing'}">`
        + (held ? `<span class="tick-img"><img src="${held.photo.dataUrl}" alt="" loading="lazy"></span>` : '')
        + `<div class="grow"><b>${esc(slot.where)}</b>`
        + `<small>${esc(slot.label)}</small></div>`
        + (editor
          ? button(held ? 'Replace' : 'Add', 'open-reference',
            { cls: held ? 'btn-sm btn-ghost' : 'btn-sm', data: { slot: slot.slot } })
          : badge(held ? 'has photo' : 'none', held ? 'ok' : ''))
        + '</li>';
    };

    let out = card(
      cardHead('Reference photos', badge(`${cov.have}/${cov.total}`, cov.have === cov.total ? 'ok' : 'warn'))
      + coverageLine(cov)
      + '<p><small>One slot for each triage row and each diagnosis card. The rules JSON is the '
      + 'source of truth and the app never writes to it, so the pictures live in the farm\'s own '
      + 'log and reach every phone on the next sync.</small></p>'
      + (editor
        ? ''
        : '<p><small>The Owner and the Farm Manager add these. If you have a good picture of '
          + 'one of the gaps below, show it to them.</small></p>'),
      { tight: true },
    );

    if (cov.missing.length) {
      out += card(
        cardHead('Still missing', badge(`${cov.missing.length}`, 'warn'))
        + '<p><small>Nothing here is broken. The app diagnoses from the words either way; '
        + 'a picture just makes the row quicker to recognise in the house.</small></p>'
        + '<ul class="list">' + cov.missing.map(row).join('') + '</ul>',
      );
    } else {
      out += card(empty('✅', 'Every slot has a picture',
        'All 23 triage rows and all 22 cards. Replace any that turn out to show the wrong thing.'));
    }

    const filled = PHOTO_SLOTS.filter((s) => referencePhoto(ctx.state, s.slot));
    if (filled.length) {
      out += card(
        cardHead('Have a picture', badge(`${filled.length}`, 'ok'))
        + '<ul class="list">' + filled.map(row).join('') + '</ul>',
      );
    }

    return out + card(button('Back to the cards', 'go',
      { cls: 'btn-ghost', data: { to: '#/guide' } }), { tight: true });
  },

  actions: { ...referenceActions },
  mounted() { bindReferencePhoto(document); },
};
