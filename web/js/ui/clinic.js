// The clinic: work out what is wrong, say how sure the app is, say how to check,
// and say what to do about it today.

import {
  badge, bar, button, card, cardHead, closeSheet, empty, esc, field, input, note,
  openSheet, readForm, select, table, textarea, tick, toast,
} from './kit.js';
import {
  canConfirm, cardFor, CARDS, CARD_TO_PROBLEM, CUES, FARM_DOCTOR_ROLE, lookalikesFor,
  matchTriage, nameCause, namingGate, readDiagnosis, riskForecast, RISK_DRIVER_TEXT,
  ROOT_READ, rowsForCard, RULES_VERSION, searchCards, separatingSymptom, TRIAGE_BY_N,
} from '../domain/diagnose.js';
import { PROBLEM_BY_ID, PROBLEM_TYPES } from '../domain/pests.js';
import { discouragedFor, productsFor } from '../domain/safety.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { activeCycles, can, cycleLabel, openReports } from '../store.js';
import { t } from '../i18n.js';
import { daysBetween, friendlyDate, isoDate, uid } from '../util.js';
import { bindPhoto, photoField, photoPayload, photoThumb, resetPhoto } from './photo.js';
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
      // The clinic answers "what is wrong with this plant". The adviser answers
      // "what should the farm do this week", which is the question people ask
      // next, so it belongs one tap from here.
      + `<div style="margin-top:10px">${button('Alerts', 'go',
        { cls: 'btn-block', icon: '🚨', data: { to: '#/alerts' } })}</div>`
      + `<div style="margin-top:10px">${button('Ask the farm adviser', 'go',
        { cls: 'btn-block btn-ghost', icon: '🧠', data: { to: '#/adviser' } })}</div>`
      + '<p style="margin:8px 0 0"><small>Reads your own records and says what to do about '
      + 'them — beds, water, sprays, stock and money. Works with no network.</small></p>',
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

/** Step 2 — what you can see, in the rules' own words. */
function stepSeen() {
  const q = wiz.search.trim().toLowerCase();
  const list = (q ? CUES.filter((c) => c.text.toLowerCase().includes(q)) : CUES);
  return card(
    cardHead('What can you see?')
    + `<p><small>Tick everything that matches, or write it in your own words. These are the `
    + `${CUES.length} things the ${TRIAGE_BY_N.size} triage rows describe.</small></p>`
    + `<div class="field">${input('cue-search', { placeholder: 'Search: galls, wilt, spots, curl...', value: wiz.search })}</div>`
    + (list.length
      ? '<div class="ticks">' + list.map((c) =>
        tick(c.id, c.text, '', wiz.cues.has(c.id))
          .replace('data-act="toggle-tick"', 'data-act="toggle-cue"')).join('') + '</div>'
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
function stepTriage() {
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

let guideFilter = { category: '', query: '' };

export const guideView = {
  perm: 'viewGuide',
  render() {
    const list = searchCards(guideFilter.query)
      .filter((c) => !guideFilter.category || c.category === guideFilter.category);
    const categories = [...new Set(CARDS.map((c) => c.category))].sort();

    return card(
      cardHead('Farm Doctor cards', badge(`${CARDS.length}`))
      + `<p><small>The ${CARDS.length} diagnosis cards and ${TRIAGE_BY_N.size} triage rows from the rules `
      + `(${esc(RULES_VERSION)}). This is the same table the clinic diagnoses from.</small></p>`
      + `<div class="field">${input('q', { placeholder: 'Search: galls, wilt, borer, boron...', value: guideFilter.query })}</div>`
      + '<div class="row wrap">'
      + `<button class="chip ${!guideFilter.category ? 'on' : ''}" data-act="guide-type" data-type="">All</button>`
      + categories.map((id) =>
        `<button class="chip ${guideFilter.category === id ? 'on' : ''}" data-act="guide-type" data-type="${esc(id)}">`
        + `${esc(id)}</button>`).join(' ')
      + '</div>',
      { tight: true },
    ) + card(
      list.length
        ? '<ul class="list">' + list.map((c) => `<li><div class="grow">`
          + `<b>${esc(c.name)}</b><small>${esc(c.category)} — from triage row${c.rows.length > 1 ? 's' : ''} `
          + `${c.rows.join(', ')}</small></div>`
          + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(c.id)}">Open</a></li>`).join('') + '</ul>'
        : empty('🔎', 'Nothing matched', 'Try a different word, or browse by kind.'),
    );
  },

  actions: {
    'guide-type': (ctx, el) => { guideFilter.category = el.dataset.type; guideFilter.query = ''; ctx.refresh(); },
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

export const guideItemView = {
  perm: 'viewGuide',
  render() {
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
    + card(cardHead('How it shows') + `<p>${esc(c.detection)}</p>`)
    + card(cardHead('Triage rows that reach this card')
      + '<ul class="list">' + rows.map((r) => `<li><div class="grow"><b>${esc(r.see)}</b>`
        + `<small>Row ${r.n} · confirm: ${esc(r.confirm)}</small></div></li>`).join('') + '</ul>')
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
        + table([{ label: 'Product' }, { label: 'Example' }, { label: 'Wait', num: true }, { label: 'Group' }],
          safe.map((x) => [x.name, x.examples, `${x.phiDays} d`, x.group]))
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
};
