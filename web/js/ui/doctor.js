// The Farm Doctor — one screen, shared with the adviser (FR-DOC-11).
//
// Staff should not have to decide, before they know what is wrong, whether
// this is a question for "the adviser" or "the Doctor". So there is one
// address with one set of tabs: ask, photos, gates, checks, lab, records. The
// adviser's own screen is the first tab, unchanged, and #/adviser lands here.
//
// Two rules run through every panel below.
//
//   Nothing here decides anything. Every output ends with the name of the
//   person who has to confirm or approve it, and the button that does it is
//   only shown to somebody senior enough to press it.
//
//   Every refusal says what would change it. "No spinosad in the store" is
//   useful; "cannot recommend" is how people learn to ignore a screen.

import {
  badge, button, card, cardHead, empty, esc, field, input, note, readForm, select, textarea, toast,
} from './kit.js';
import { adviserView } from './adviser.js';
import { photoThumb } from './photo.js';
import { captureEvidence } from '../db.js';
import {
  CONFIDENCE, LIMITS, WORKED, approvePlan, awaitingConfirmation, confirmOutput,
  doctorRecords, draftCycleReview, followUpBoard, followUpRecord, gateEvidence,
  labSamples, normalisePhotoReview, openLabSamples, ownerNotifications, photoReviewRequest,
  treatmentPlan,
} from '../domain/doctor.js';
import { getRules } from '../rules.js';
import { PROBLEM_BY_ID } from '../domain/pests.js';
import { activeCycles, can, cycleLabel } from '../store.js';
import { reviewPhotos } from '../sync.js';
import { friendlyDate, isoDate, uid } from '../util.js';
import { params } from './shell.js';

const TABS = [
  { id: 'ask', label: 'Ask', icon: '🧠' },
  { id: 'photo', label: 'Photos', icon: '📷' },
  { id: 'plan', label: 'Plan', icon: '💊' },
  { id: 'gates', label: 'Gates', icon: '🚧' },
  { id: 'checks', label: 'Checks', icon: '🔁' },
  { id: 'lab', label: 'Lab', icon: '🧪' },
  { id: 'records', label: 'Records', icon: '📋' },
];

// Per-session working state. None of it is a record until somebody saves it.
let tab = null;
let photoShots = [];        // photos queued for review
let evidenceShot = null;    // the one photo attached to a gate-evidence form
let reviewing = false;
let review = null;          // the last normalised photo review
let reviewProblem = '';
let gateZone = '';
let planFor = null;         // { cycleId, problemId, plan }

function currentTab() {
  const wanted = params().tab || tab;
  return TABS.some((t) => t.id === wanted) ? wanted : 'ask';
}

export const doctorView = {
  perm: 'viewGuide',

  render(ctx) {
    const active = currentTab();
    let body = head(ctx, active) + tabBar(active);

    switch (active) {
      case 'photo': body += photoPanel(ctx); break;
      case 'plan': body += planPanel(ctx); break;
      case 'gates': body += gatePanel(ctx); break;
      case 'checks': body += checksPanel(ctx); break;
      case 'lab': body += labPanel(ctx); break;
      case 'records': body += recordsPanel(ctx); break;
      default: body += adviserView.render(ctx); break;
    }
    return body;
  },

  // The camera. Several forms on this screen can take a photo, so each file
  // input is wired to the preview inside its own form rather than to a single
  // one on the page (UX-13: one tap to the camera, wherever you are).
  mounted(ctx) {
    for (const el of document.querySelectorAll('.photo-input')) {
      el.onchange = async () => {
        const file = el.files && el.files[0];
        if (!file) return;
        try {
          const shot = await captureEvidence(file);
          if (el.dataset.role === 'evidence') {
            evidenceShot = shot;
            const preview = el.closest('form, .field').querySelector('.photo-preview');
            if (preview) preview.innerHTML = photoThumb(shot, { small: true });
          } else {
            photoShots.push(shot);
            ctx.refresh();
          }
        } catch (err) {
          toast(err.message || 'Could not use that picture', true);
        }
      };
    }
    if (adviserView.mounted) adviserView.mounted(ctx);
  },

  actions: {
    // The adviser's own buttons keep working, because its panel is its screen.
    ...adviserView.actions,

    'doctor-tab': (ctx, el) => { tab = el.dataset.tab; ctx.refresh(); },

    // --- FR-DOC-03 ------------------------------------------------------
    // The shared handler in worker.js reaches for an enclosing sheet; these
    // forms sit on the page itself, so this screen opens its own camera.
    'pick-photo': (ctx, el) => {
      const file = el.closest('form, .field, .card').querySelector('input[type=file]');
      if (file) file.click();
    },
    'doctor-drop-photo': (ctx, el) => {
      photoShots.splice(Number(el.dataset.i), 1);
      ctx.refresh();
    },
    'doctor-review': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      reviewProblem = data.problemId || '';
      const cycleId = data.cycleId || '';
      const cycle = ctx.state.cycles[cycleId];
      const request = photoReviewRequest({
        photos: photoShots.map((p) => p.dataUrl),
        cycleId,
        zoneId: cycle ? cycle.plotId : null,
        problemShortlist: reviewProblem ? [{ id: reviewProblem }] : [],
        note: data.note || '',
        online: navigator.onLine,
        today: isoDate(),
      });
      if (!request.ok || request.mode === 'offline') { review = request; ctx.refresh(); return; }

      reviewing = true;
      review = null;
      ctx.refresh();
      const answer = await reviewPhotos({ ...request.payload, note: data.note || '' });
      reviewing = false;
      review = answer && answer.ok
        ? normalisePhotoReview(answer.review, {
          state: ctx.state, cycleId, zoneId: cycle ? cycle.plotId : null,
          photos: photoShots, today: isoDate(),
        })
        : { mode: 'failed', ...answer };
      ctx.refresh();
    },

    // --- FR-DOC-04 / FR-DOC-08: the treatment plan ----------------------
    'doctor-plan': (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      if (!data.problemId || !data.cycleId) { toast('Pick a bed and a problem', true); return; }
      const cycle = ctx.state.cycles[data.cycleId];
      planFor = {
        cycleId: data.cycleId,
        problemId: data.problemId,
        plan: treatmentPlan(ctx.state, {
          problemId: data.problemId,
          cycleId: data.cycleId,
          zoneId: cycle ? cycle.plotId : null,
          diagnosisId: latestConfirmedDiagnosis(ctx.state, data.cycleId),
          today: isoDate(),
        }),
      };
      ctx.refresh();
    },

    // --- FR-DOC-10: saving an output ------------------------------------
    'doctor-save': async (ctx, el) => {
      const payload = pendingOutput(ctx, el.dataset.what);
      if (!payload) { toast('Nothing to save', true); return; }
      await ctx.store.dispatch('doctor.record', payload);
      if (payload.lab) await recommendLab(ctx, payload);
      toast('Saved. It is waiting for someone to confirm it.');
      ctx.refresh();
    },

    'doctor-confirm': async (ctx, el) => {
      const output = ctx.state.doctorOutputs.find((o) => o.id === el.dataset.id);
      const verdict = confirmOutput(output, ctx.user);
      if (!verdict.ok) { toast(verdict.why, true); return; }
      await ctx.store.dispatch('doctor.confirm', { id: output.id, note: el.dataset.note || '' });
      toast('Confirmed');
    },

    'doctor-approve': async (ctx, el) => {
      const output = ctx.state.doctorOutputs.find((o) => o.id === el.dataset.id);
      const verdict = approvePlan(output, ctx.user);
      if (!verdict.ok) { toast(verdict.why, true); return; }
      await ctx.store.dispatch('doctor.approve', { id: output.id });
      toast('Approved');
    },

    // --- FR-DOC-06 ------------------------------------------------------
    'doctor-zone': (ctx, el) => { gateZone = el.dataset.zone; ctx.refresh(); },
    'doctor-evidence': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      if (!data.gate || !data.itemId || !data.zoneId) { toast('Say which gate line this is', true); return; }
      await ctx.store.dispatch('gate.evidence', {
        id: uid('ev'), gate: data.gate, itemId: data.itemId, zoneId: data.zoneId,
        cycleId: data.cycleId || null, date: isoDate(), note: data.note || '',
        count: data.count ? Number(data.count) : undefined,
        batchId: data.batchId || undefined,
        photo: evidenceShot,
      });
      evidenceShot = null;
      toast('Evidence recorded');
    },

    // --- FR-DOC-07 ------------------------------------------------------
    'doctor-followup': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      const spray = ctx.state.sprays.find((s) => s.id === data.sprayId);
      if (!spray || !WORKED[data.worked]) { toast('Say whether it worked', true); return; }
      const record = followUpRecord(ctx.state, {
        spray, worked: data.worked, note: data.note || '', person: ctx.user,
        pestId: spray.targetProblem || null, today: isoDate(),
      });
      await ctx.store.dispatch('doctor.record', record);
      const task = ctx.state.tasks[`fd_follow_${spray.id}`];
      if (task && task.status === 'open') {
        await ctx.store.dispatch('task.complete', { id: task.id, note: record.summary });
      }
      toast('Check recorded');
    },

    'doctor-cycle-review': async (ctx, el) => {
      const draft = draftCycleReview(ctx.state, el.dataset.cycle, { today: isoDate() });
      await ctx.store.dispatch('doctor.record', draft);
      toast('Draft saved for Gate 4');
    },

    // --- FR-DOC-09 / FR-DIAG-05 -----------------------------------------
    'doctor-lab-send': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      if (!data.lab) { toast('Say which lab', true); return; }
      await ctx.store.dispatch('lab.send', { id: data.id, lab: data.lab, sentDate: data.sentDate || isoDate() });
      toast('Sample marked as sent');
    },
    'doctor-lab-result': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      if (!data.result) { toast('Say what the lab reported', true); return; }
      await ctx.store.dispatch('lab.result', { id: data.id, result: data.result, resultDate: isoDate() });
      toast('Result recorded');
    },
    'doctor-owner-seen': async (ctx, el) => {
      await ctx.store.dispatch('doctor.owner-seen', { id: el.dataset.id });
    },
  },
};

// --- Shared furniture -----------------------------------------------------

function head(ctx, active) {
  const owed = ownerNotifications(ctx.state, { today: isoDate() });
  const waiting = awaitingConfirmation(ctx.state);
  return card(
    cardHead('Farm Doctor',
      getRules() ? badge('rules loaded', 'ok') : badge('rules not loaded', 'warn'))
    + '<p><small>Diagnosis, treatment plans, gate evidence and follow-up checks — and the '
    + 'farm adviser, in the same place. It advises; people decide. It never clears a gate, '
    + 'confirms its own diagnosis, approves its own plan, or names a product that is not in '
    + 'the catalogue and in the store.</small></p>'
    + (owed.length && can(ctx.user, 'viewReports')
      ? note('warn', `${owed.length} thing${owed.length === 1 ? '' : 's'} for the Owner`,
        `<small>${esc(owed.slice(0, 3).map((o) => o.why).join(' · '))}</small>`)
      : '')
    + (waiting.length
      ? note('info', `${waiting.length} output${waiting.length === 1 ? '' : 's'} waiting to be confirmed`,
        '<small>Nothing the Farm Doctor says takes effect until a person confirms it.</small>')
      : ''),
    { tight: true },
  );
}

function tabBar(active) {
  return '<div class="card tight"><div class="row wrap">'
    + TABS.map((t) => `<button class="chip ${t.id === active ? 'on' : ''}" data-act="doctor-tab" `
      + `data-tab="${t.id}">${t.icon} ${esc(t.label)}</button>`).join(' ')
    + '</div></div>';
}

function cyclePicker(state, name = 'cycleId', value = '') {
  const options = activeCycles(state).map((c) => ({ value: c.id, label: cycleLabel(state, c.id) }));
  if (!options.length) return note('warn', 'No bed has a crop in it', '<small>Start a cycle first.</small>');
  return field('Which bed', select(name, options, value));
}

function confidenceBadge(confidence) {
  if (!confidence) return '';
  const tone = confidence === 'high' ? 'ok' : confidence === 'medium' ? 'warn' : 'danger';
  return badge(CONFIDENCE[confidence].label, tone);
}

/** Who still has to sign, said in the record's own words. */
function signatureLine(output) {
  const bits = [];
  if (output.needsConfirming) bits.push(`${output.confirmedBy ? '✓ confirmed' : `waiting on the ${output.needsConfirming}`}`);
  if (output.needsApproval) bits.push(`${output.approvedBy ? '✓ approved' : `waiting on the ${output.needsApproval}`}`);
  return bits.length ? `<p><small>${esc(bits.join(' · '))}</small></p>` : '';
}

function readList(output) {
  if (!output.read || !output.read.length) return '';
  return '<details><summary><small>What it looked at</small></summary><ul class="list">'
    + output.read.map((r) => `<li><small>${esc(r.what)}${r.id ? ` (${esc(r.id)})` : ''}</small></li>`).join('')
    + '</ul></details>';
}

function limitNote(limitId) {
  const limit = LIMITS[limitId];
  if (!limit) return '';
  return note('info', limit.rule, `<small>${esc(limit.who)}</small>`);
}

// --- FR-DOC-03: photos ----------------------------------------------------

function photoPanel(ctx) {
  const shots = photoShots.map((p, i) => '<div class="row">'
    + photoThumb(p, { small: true })
    + button('Remove', 'doctor-drop-photo', { cls: 'btn-sm btn-ghost', data: { i } })
    + '</div>').join('');

  let out = card(
    cardHead('Photo review', navigator.onLine ? badge('online', 'ok') : badge('offline', 'warn'))
    + '<p><small>Take a close photo of the damage and one of the whole plant. Online, the '
    + 'photos are read and a confidence is stated. Offline, the guided diagnosis answers '
    + 'instead — and it is the guided flow that names a cause either way.</small></p>'
    + '<form data-act="doctor-review">'
    + cyclePicker(ctx.state)
    + field('What do you think it is (optional)', select('problemId',
      [{ value: '', label: 'Not sure' },
        ...Object.values(PROBLEM_BY_ID).map((p) => ({ value: p.id, label: p.name }))], reviewProblem))
    + field('What you can see', textarea('note', { rows: 2, placeholder: 'e.g. tips curling on the end row since the rain' }))
    + '<div class="field"><label>Photos</label>'
    + '<input type="file" accept="image/*" capture="environment" name="photo" class="photo-input" data-role="review">'
    + button('📷 Take a photo', 'pick-photo', { cls: 'btn-ghost btn-block' })
    + '<div class="hint">Each photo is added as you take it. FR-PROOF-02: taken here, not from the gallery.</div>'
    + '</div>'
    + (shots || '')
    + `<button class="btn-block btn-lg" type="submit"${reviewing || !photoShots.length ? ' disabled' : ''}>`
    + `${reviewing ? 'Reading the photos…' : `Review ${photoShots.length || ''} photo${photoShots.length === 1 ? '' : 's'}`}</button>`
    + '</form>',
  );

  if (reviewing) out += card(note('info', 'Reading', '<small>This needs a connection and can take a minute.</small>'));
  if (review) out += reviewBlock(ctx, review);
  return out;
}

function reviewBlock(ctx, r) {
  if (r.mode === 'offline') {
    return card(
      cardHead('No signal — the guided flow still works')
      + note('info', r.why, `<small>${esc(r.fix)}</small>`)
      + '<ul class="list">' + (r.stillWorks || []).map((s) => `<li><small>${esc(s)}</small></li>`).join('') + '</ul>'
      + button('Open the guided diagnosis', 'go', { cls: 'btn-block btn-lg', data: { to: '#/diagnose' } }),
    );
  }
  if (r.mode === 'failed' || r.ok === false) {
    return card(
      cardHead('Photo review could not answer')
      + note('warn', r.message || 'It could not be reached.',
        '<small>The guided diagnosis, the calculators and the plan checks all work with no signal.</small>')
      + button('Open the guided diagnosis', 'go', { cls: 'btn-block btn-lg', data: { to: '#/diagnose' } }),
    );
  }

  const top = r.candidates && r.candidates[0];
  return card(
    cardHead('What the photos suggest', confidenceBadge(r.confidence))
    + (top
      ? `<p><b>${esc(top.name)}</b> — <small>${esc(top.why || '')}</small></p>`
      : '<p>Nothing could be named from these photos.</p>')
    + (r.candidates.length > 1
      ? '<ul class="list">' + r.candidates.slice(1).map((c) => `<li><small>${esc(c.name)} — `
        + `${esc(CONFIDENCE[c.confidence].label.toLowerCase())}</small></li>`).join('') + '</ul>'
      : '')
    + `<p><small>${esc(CONFIDENCE[r.confidence].hint)}</small></p>`
    + (r.photoAlone ? limitNote('photo') : '')
    + (r.confirmTest.length
      ? '<p><b>Confirm it like this:</b></p><ul class="list">'
        + r.confirmTest.map((c) => `<li><small>${esc(c)}</small></li>`).join('') + '</ul>'
      : '')
    + (r.labAdvice && r.labAdvice.needed
      ? note('warn', 'A sample should go to a lab',
        `<small>${esc(r.labAdvice.reasons.join(' '))} The Owner is told.</small>`)
      : '')
    + (r.droppedActives && r.droppedActives.length
      ? note('info', 'Products it mentioned that this farm cannot use',
        `<small>${esc(r.droppedActives.map((d) => `${d.name}: ${d.violations[0].why}`).join(' · '))}</small>`)
      : '')
    + signatureLine(r)
    + readList(r)
    + button('Save this reading', 'doctor-save', { cls: 'btn-block', data: { what: 'photo' } }),
  );
}

// --- FR-DOC-04 / FR-DOC-08: the treatment plan ----------------------------

function planPanel(ctx) {
  let out = card(
    cardHead('Treatment plan')
    + '<p><small>Only what the rules and the store both allow: in the catalogue, in stock, not '
    + 'banned, a dose on file, rotation respected, and after Week 10 organics only. Anything '
    + 'that fails is listed with the reason, because "nothing you can use" is an answer the '
    + 'manager has to act on.</small></p>'
    + '<form data-act="doctor-plan">'
    + cyclePicker(ctx.state, 'cycleId', planFor ? planFor.cycleId : '')
    + field('What is wrong', select('problemId',
      Object.values(PROBLEM_BY_ID).map((p) => ({ value: p.id, label: p.name })),
      planFor ? planFor.problemId : ''))
    + '<button class="btn-block btn-lg" type="submit">Work out the plan</button>'
    + '</form>',
    { tight: true },
  );

  if (!planFor) return out;
  const plan = planFor.plan;

  out += card(
    cardHead(plan.problem ? plan.problem.name : 'Plan',
      plan.options.length ? badge(`${plan.options.length} allowed`, 'ok') : badge('nothing allowed', 'danger'))
    + `<p>${esc(plan.summary)}</p>`
    + (plan.options.length
      ? plan.options.map((o) => '<div class="rec">'
        + `<b>${esc(o.entry.ai)}</b> ${badge(o.entry.group, '')}`
        + `<p><small>${esc(o.dose.amounts.map((a) => a.text).join(' · '))} `
        + `— from the ${esc(o.dose.source)}.</small></p>`
        + `<p><small>In store: ${esc(String(o.stock.qty))} ${esc(o.stock.unit || '')}. `
        + `No picking that bed until ${esc(o.harvestBlockedUntil)} (PHI ${o.phiDays} days), `
        + `nobody back in for ${o.reiHours} hours.</small></p></div>`).join('')
      : '')
    + (plan.rejected.length
      ? '<details><summary>What was ruled out, and why</summary><ul class="list">'
        + plan.rejected.map((r) => `<li><div class="grow"><b>${esc(r.active.ai)}</b>`
          + `<small>${esc(r.violations.map((v) => v.why).join(' '))}</small>`
          + `<small>${esc(r.violations.map((v) => v.fix).filter(Boolean).join(' '))}</small>`
          + '</div></li>').join('')
        + '</ul></details>'
      : '')
    + limitNote('catalogue')
    + signatureLine(plan)
    + readList(plan)
    + button('Save this plan', 'doctor-save', { cls: 'btn-block', data: { what: 'plan' } }),
  );
  return out;
}

/** The confirmed diagnosis a plan hangs off — Gate 3 (FR-GATE-04). */
function latestConfirmedDiagnosis(state, cycleId) {
  const found = state.diagnoses
    .filter((d) => d.cycleId === cycleId && d.confirmedBy)
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))[0];
  return found ? found.id : null;
}

// --- FR-DOC-06: gates -----------------------------------------------------

function gatePanel(ctx) {
  const zones = Object.values(ctx.state.plots).filter((z) => !z.retired);
  if (!zones.length) return card(empty('🚧', 'No zones yet', 'Add a zone before checking its gates.'));
  const zoneId = gateZone || zones[0].id;
  const cycle = Object.values(ctx.state.cycles).find((c) => c.plotId === zoneId && c.status === 'active');
  const reviewOut = gateEvidence(ctx.state, { zoneId, cycleId: cycle ? cycle.id : null, today: isoDate() });

  let out = card(
    cardHead('Gate evidence', reviewOut.complete ? badge('nothing missing', 'ok') : badge(`${reviewOut.missing.length} missing`, 'danger'))
    + '<div class="row wrap">' + zones.map((z) => `<button class="chip ${z.id === zoneId ? 'on' : ''}" `
      + `data-act="doctor-zone" data-zone="${esc(z.id)}">${esc(z.name)}</button>`).join(' ') + '</div>'
    + limitNote('gate'),
    { tight: true },
  );

  for (const gate of reviewOut.gates) {
    out += card(
      cardHead(`${gate.id} — ${gate.name}`, gate.complete ? badge('complete', 'ok') : badge(`${gate.missing.length} missing`, 'warn'))
      + (gate.when ? `<p><small>${esc(gate.when)}${gate.blocksAction ? ` · blocks ${esc(gate.blocksAction)}` : ''}</small></p>` : '')
      + '<ul class="list">' + gate.items.map((it) => '<li><div class="grow">'
        + `<b>${it.state === 'have' ? '✓' : '✕'} ${esc(it.label)}</b>`
        + `<small>${esc(it.why || it.fix || '')}</small></div></li>`).join('') + '</ul>'
      + (gate.missing.length ? evidenceForm(gate, zoneId, cycle) : ''),
    );
  }

  out += card(
    signatureLine(reviewOut)
    + readList(reviewOut)
    + button('Save this gate check', 'doctor-save', { cls: 'btn-block', data: { what: 'gates' } }),
    { tight: true },
  );
  return out;
}

function evidenceForm(gate, zoneId, cycle) {
  return '<details><summary>Record one of these</summary>'
    + '<form data-act="doctor-evidence">'
    + `<input type="hidden" name="gate" value="${esc(gate.id)}">`
    + `<input type="hidden" name="zoneId" value="${esc(zoneId)}">`
    + `<input type="hidden" name="cycleId" value="${esc(cycle ? cycle.id : '')}">`
    + field('Which line', select('itemId', gate.missing.map((m) => ({ value: m.id, label: m.label }))))
    + field('What was done', textarea('note', { rows: 2, placeholder: 'e.g. drip run at 1.2 bar, no blocked emitters' }))
    + field('Count, if it is a count', input('count', { type: 'number', inputmode: 'numeric' }),
      'Traps, for instance. Leave blank otherwise.')
    + field('Batch ID, for a seedling release', input('batchId'))
    + '<input type="file" accept="image/*" capture="environment" name="photo" class="photo-input" data-role="evidence">'
    + button('📷 Photo', 'pick-photo', { cls: 'btn-ghost btn-block' })
    + '<div class="photo-preview"></div>'
    + '<button class="btn-block" type="submit">Record this evidence</button>'
    + '</form></details>';
}

// --- FR-DOC-07: follow-up checks and the cycle review ---------------------

function checksPanel(ctx) {
  const board = followUpBoard(ctx.state, { today: isoDate() });
  let out = card(
    cardHead('Three-day checks', board.some((b) => b.overdue) ? badge('some overdue', 'danger') : '')
    + '<p><small>Every treatment gets a check three days later, and the answer is kept. '
    + 'A treatment nobody checked is one nobody can learn from.</small></p>',
    { tight: true },
  );

  if (!board.length) {
    out += card(empty('🔁', 'No treatments yet', 'Checks appear here three days after a spray is logged.'));
  }

  for (const row of board.slice(0, 12)) {
    out += card(
      cardHead(row.spray.productName || 'Treatment',
        row.answered
          ? badge(WORKED[row.worked] ? WORKED[row.worked].label : 'answered', WORKED[row.worked] ? WORKED[row.worked].tone : '')
          : row.overdue ? badge(`${row.daysLate} days late`, 'danger') : badge(`due ${row.due}`, 'warn'))
      + `<p><small>Sprayed ${esc(friendlyDate(row.spray.date))} on ${esc(cycleLabel(ctx.state, row.spray.cycleId))}.</small></p>`
      + (row.answered
        ? `<p><small>${esc(row.record.summary)}${row.record.nextStep ? ` — ${esc(row.record.nextStep)}` : ''}</small></p>`
        : '<form data-act="doctor-followup">'
          + `<input type="hidden" name="sprayId" value="${esc(row.spray.id)}">`
          + field('Did it work', select('worked', Object.values(WORKED).map((w) => ({ value: w.id, label: w.label }))))
          + field('What you saw', textarea('note', { rows: 2, placeholder: 'Counted the same ten plants…' }))
          + '<button class="btn-block" type="submit">Record the check</button>'
          + '</form>'),
    );
  }

  const cycles = activeCycles(ctx.state);
  if (cycles.length && can(ctx.user, 'manageCycles')) {
    out += card(
      cardHead('Gate 4 cycle review')
      + '<p><small>Drafted from this season\'s own records — yield, treatments, what worked, what '
      + 'was never checked. A draft only: the Farm Manager confirms it and the Owner approves.</small></p>'
      + cycles.map((c) => button(`Draft for ${cycleLabel(ctx.state, c.id)}`, 'doctor-cycle-review',
        { cls: 'btn-block btn-ghost', data: { cycle: c.id } })).join(''),
    );
  }
  return out;
}

// --- FR-DOC-09 / FR-DIAG-05: the lab --------------------------------------

function labPanel(ctx) {
  const samples = labSamples(ctx.state);
  const open = openLabSamples(ctx.state);
  let out = card(
    cardHead('Lab samples', open.length ? badge(`${open.length} waiting`, 'warn') : badge('none open', 'ok'))
    + '<p><small>A sample goes off for a suspected virus, bacterial wilt, nematodes, or a second '
    + 'low-confidence reading. The Owner is told at the same time.</small></p>',
    { tight: true },
  );

  if (!samples.length) {
    out += card(empty('🧪', 'No samples yet',
      'The Farm Doctor recommends one when a photo or a guided diagnosis cannot settle it.'));
  }

  for (const sample of samples.slice(0, 12)) {
    const problem = PROBLEM_BY_ID[sample.problemId];
    out += card(
      cardHead(problem ? problem.name : 'Sample',
        sample.result ? badge('result in', 'ok') : sample.sentDate ? badge('sent', 'warn') : badge('recommended', 'danger'))
      + `<p><small>${esc(sample.reason || '')}</small></p>`
      + (sample.sentDate ? `<p><small>Sent ${esc(sample.sentDate)} to ${esc(sample.lab || 'a lab')}.</small></p>` : '')
      + (sample.result ? `<p><b>${esc(sample.result)}</b> <small>${esc(sample.resultDate || '')}</small></p>` : '')
      + (!sample.sentDate
        ? '<form data-act="doctor-lab-send">'
          + `<input type="hidden" name="id" value="${esc(sample.id)}">`
          + field('Which lab', input('lab', { placeholder: 'e.g. NRCRI Umudike' }))
          + field('Date sent', input('sentDate', { type: 'date', value: isoDate() }))
          + '<button class="btn-block" type="submit">Mark as sent</button></form>'
        : !sample.result
          ? '<form data-act="doctor-lab-result">'
            + `<input type="hidden" name="id" value="${esc(sample.id)}">`
            + field('What came back', textarea('result', { rows: 2 }))
            + '<button class="btn-block" type="submit">Record the result</button></form>'
          : ''),
    );
  }
  return out;
}

// --- FR-DOC-10: the records -----------------------------------------------

function recordsPanel(ctx) {
  const records = doctorRecords(ctx.state, { limit: 40 });
  if (!records.length) {
    return card(empty('📋', 'Nothing saved yet',
      'Every Farm Doctor output is saved here with what it read, how sure it was, and who confirmed it.'));
  }
  return records.map((o) => card(
    cardHead(`${kindLabel(o.kind)} — ${esc(friendlyDate((o.at || '').slice(0, 10)))}`, confidenceBadge(o.confidence))
    + `<p>${esc(o.summary || '')}</p>`
    + `<p><small>${o.confirmedBy
      ? `Confirmed by ${esc((ctx.state.people[o.confirmedBy] || {}).name || o.confirmedBy)}`
      : `Not confirmed — waiting on the ${esc(o.needsConfirming || 'Field Supervisor or Farm Manager')}`}`
    + `${o.approvedBy ? `, approved by ${esc((ctx.state.people[o.approvedBy] || {}).name || o.approvedBy)}` : ''}`
    + '</small></p>'
    + readList(o)
    + (!o.confirmedBy && can(ctx.user, 'verifyHarvest')
      ? button('Confirm this', 'doctor-confirm', { cls: 'btn-block', data: { id: o.id } }) : '')
    + (o.confirmedBy && !o.approvedBy && can(ctx.user, 'prescribe')
      ? button('Approve this', 'doctor-approve', { cls: 'btn-block btn-ghost', data: { id: o.id } }) : ''),
  )).join('');
}

const kindLabel = (kind) => ({
  photo: 'Photo review', plan: 'Treatment plan', 'gate-review': 'Gate check',
  'cycle-review': 'Cycle review', followup: 'Three-day check', diagnosis: 'Diagnosis',
}[kind] || kind);

/** The thing on screen that the save button is about. */
function pendingOutput(ctx, what) {
  if (what === 'photo') return review && review.kind ? review : null;
  if (what === 'gates') {
    const zones = Object.values(ctx.state.plots).filter((z) => !z.retired);
    const zoneId = gateZone || (zones[0] && zones[0].id);
    if (!zoneId) return null;
    const cycle = Object.values(ctx.state.cycles).find((c) => c.plotId === zoneId && c.status === 'active');
    return gateEvidence(ctx.state, { zoneId, cycleId: cycle ? cycle.id : null, today: isoDate() });
  }
  if (what === 'plan' && planFor) return planFor.plan;
  return null;
}

/** FR-DOC-09 — a recommended sample becomes a tracked one the moment it is saved. */
async function recommendLab(ctx, output) {
  const existing = openLabSamples(ctx.state).some((s) => s.problemId === (output.subject || {}).problemId
    && s.cycleId === (output.subject || {}).cycleId);
  if (existing) return;
  await ctx.store.dispatch('lab.record', { id: uid('lab'), ...output.lab, fromOutput: output.id });
}
