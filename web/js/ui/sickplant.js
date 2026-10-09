// Report a sick plant — the short flow (FR-DIAG-07 to FR-DIAG-09).
//
// Zone, photos, where on the plant, how many plants, send. Every answer is a
// big picture tile, and nothing on this screen names a cause: no triage rows,
// no cards, no confirm tests, no look-alikes. That is the Field Supervisor's
// and the Farm Manager's work, and it opens from the report this sends
// (clinic.js). The last screen says, by name, who the report went to.

import { badge, button, card, cardHead, empty, esc, more, note, toast } from './kit.js';
import { bindPhoto, photoField, photoPayload, photoThumb, resetPhoto } from './photo.js';
import { zonesHeldBy } from '../domain/assignments.js';
import {
  composeReport, HOW_MANY, namesLine, reportGaps, SPREADING, WHERE_ON_PLANT,
} from '../domain/sickplant.js';
import { isoDate, uid } from '../util.js';

const STEPS = ['zone', 'photos', 'where', 'howMany'];

let rep = null;
function resetReport(ctx) {
  const mine = ctx && ctx.user ? zonesHeldBy(ctx.state, ctx.user.id) : [];
  rep = {
    step: 0,
    zoneId: mine.length ? mine[0].zone.id : '',
    photos: [],
    where: new Set(),
    howMany: '',
    spreading: '',
    sent: null,
  };
  resetPhoto();
}

/** The payload exactly as it will be filed, so one check decides what is missing. */
function draft() {
  return {
    zoneId: rep.zoneId, photos: rep.photos, where: [...rep.where],
    howMany: rep.howMany, spreading: rep.spreading || 'unsure',
  };
}

/** One picture tile. The words are always there; the picture only helps. */
function tile(act, id, pic, label, on) {
  return `<button type="button" class="pic-tile ${on ? 'on' : ''}" data-act="${esc(act)}" `
    + `data-id="${esc(id)}" aria-pressed="${on ? 'true' : 'false'}">`
    + `<span class="pic" aria-hidden="true">${pic}</span><span class="lbl">${esc(label)}</span></button>`;
}

function stepDots() {
  return `<div class="wizard-steps">${STEPS.map((_, i) =>
    `<i class="${rep.step >= i ? 'on' : ''}"></i>`).join('')}</div>`;
}

function footer(nextLabel) {
  return '<div class="sticky-actions">'
    + (rep.step > 0 ? button('Back', 'sp-back', { cls: 'btn-ghost' }) : '')
    + button(nextLabel, 'sp-next', { cls: 'btn-block btn-lg', data: { 'main-action': 'sick-plant' } })
    + '</div>';
}

function stepZone(ctx) {
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired);
  const mine = new Set(zonesHeldBy(ctx.state, ctx.user.id).map((z) => z.zone.id));
  zones.sort((a, b) => (mine.has(a.id) === mine.has(b.id)
    ? String(a.name).localeCompare(String(b.name)) : mine.has(a.id) ? -1 : 1));
  return card(
    cardHead('Which zone?')
    + (zones.length
      ? '<div class="pic-grid">' + zones.map((z) => tile('sp-zone', z.id,
        z.type === 'field' ? '🌾' : '🏠', z.name + (mine.has(z.id) ? ' (yours)' : ''),
        rep.zoneId === z.id)).join('') + '</div>'
      : empty('🏠', 'No zones yet', 'Ask the Farm Manager to set up the zones.'))
    + footer('Next'),
  );
}

function stepPhotos() {
  return card(
    cardHead('Take a photo', rep.photos.length ? badge(`${rep.photos.length}`, 'ok') : '')
    + '<p><small>Get close to the sick part. Take more than one if you can.</small></p>'
    + photoField('Photo of the plant')
    + button('Add this photo', 'sp-add-photo', { cls: 'btn-ghost btn-block' })
    + (rep.photos.length
      ? '<div class="row wrap" style="margin-top:10px">' + rep.photos.map((ph, i) =>
        `<div style="margin-right:8px">${photoThumb(ph, { small: true })}`
        + button('Remove', 'sp-drop-photo', { cls: 'btn-sm btn-quiet', data: { i } })
        + '</div>').join('') + '</div>'
      : '')
    + footer('Next'),
  );
}

function stepWhere() {
  return card(
    cardHead('Where on the plant?')
    + '<p><small>Tap every one that looks wrong.</small></p>'
    + '<div class="pic-grid">' + WHERE_ON_PLANT.map((w) =>
      tile('sp-where', w.id, w.pic, w.label, rep.where.has(w.id))).join('') + '</div>'
    + footer('Next'),
  );
}

function stepHowMany() {
  return card(
    cardHead('How many plants?')
    + '<div class="pic-grid">' + HOW_MANY.map((h) =>
      tile('sp-howmany', h.id, h.pic, h.label, rep.howMany === h.id)).join('') + '</div>'
    + '<h3 style="margin-top:16px">Is it on the plants next to them too?</h3>'
    + '<div class="pic-grid">' + SPREADING.map((s) =>
      tile('sp-spreading', s.id, s.pic, s.label, rep.spreading === s.id)).join('') + '</div>'
    + footer('Send'),
  );
}

/**
 * The last screen: who it went to, by name, and whether it raised an alert.
 * docs/simplify-pass/03-sick-plant.md: how the alert climbs, and where the
 * answer will appear, are one tap away; the names and the alert are not.
 */
function sentScreen() {
  const s = rep.sent;
  return card(
    empty(s.serious ? '🚨' : '✅', 'Report sent', `Sent to ${s.names}.`)
    + (s.serious
      ? note('danger', 'Alert raised', `<small>Because of ${esc(s.reasons.join(', '))}.</small>`
        + more('What happens next', '<small>This went up as an alert at once. The Farm Manager has it '
          + 'now. If nobody picks it up in 4 hours it goes to the Field Supervisor, and if it is not '
          + 'closed in 12 hours, to the Owner.</small>', { id: 'sick-plant.ladder' }))
      : more('What happens next', '<p><small>They will look at the plant and work out what it is. '
        + 'You will see the answer on My work, next to your photo, and every report you sent under '
        + '"Your sick-plant reports".</small></p>', { id: 'sick-plant.next' }))
    + '<div class="row wrap">'
    + button('Back to My work', 'go', { cls: 'btn-block btn-lg', data: { to: '#/today', 'main-action': 'sick-plant-sent' } })
    + button('Report another', 'sp-restart', { cls: 'btn-ghost btn-block' })
    + '</div>',
  );
}

export const sickPlantView = {
  perm: 'reportProblem',
  enter(ctx) { resetReport(ctx); },

  render(ctx) {
    if (!rep) resetReport(ctx);
    if (rep.sent) return sentScreen();
    const body = [stepZone, stepPhotos, stepWhere, stepHowMany][rep.step];
    return stepDots() + body(ctx);
  },

  actions: {
    'sp-zone': (ctx, el) => { rep.zoneId = el.dataset.id; ctx.refresh(); },
    'sp-add-photo': (ctx) => {
      const shot = photoPayload();
      if (!shot) { toast('Take the photo first', true); return; }
      rep.photos = [...rep.photos, shot];
      resetPhoto();
      ctx.refresh();
    },
    'sp-drop-photo': (ctx, el) => {
      rep.photos = rep.photos.filter((_, i) => i !== Number(el.dataset.i));
      ctx.refresh();
    },
    'sp-where': (ctx, el) => {
      const id = el.dataset.id;
      if (rep.where.has(id)) rep.where.delete(id); else rep.where.add(id);
      ctx.refresh();
    },
    'sp-howmany': (ctx, el) => { rep.howMany = el.dataset.id; ctx.refresh(); },
    'sp-spreading': (ctx, el) => { rep.spreading = el.dataset.id; ctx.refresh(); },
    'sp-back': (ctx) => { rep.step = Math.max(0, rep.step - 1); ctx.refresh(); },
    'sp-restart': (ctx) => { resetReport(ctx); ctx.refresh(); },
    'sp-next': async (ctx) => {
      const gap = reportGaps(draft()).find((g) => g.id === STEPS[rep.step]);
      if (gap) { toast(gap.need, true); return; }
      if (rep.step < STEPS.length - 1) {
        rep.step += 1;
        window.scrollTo(0, 0);
        ctx.refresh();
        return;
      }
      await sendReport(ctx);
    },
  },

  mounted() { bindPhoto(document); },
};

async function sendReport(ctx) {
  const sent = composeReport(ctx.state, ctx.user.id, draft(), { id: uid('r'), today: isoDate() });
  if (sent.gaps.length) { toast(sent.gaps[0].need, true); return; }
  await ctx.store.dispatch('report.record', sent.payload);
  rep.sent = { names: namesLine(sent.recipients), serious: sent.reasons.length > 0, reasons: sent.reasons };
  resetPhoto();
  window.scrollTo(0, 0);
  ctx.refresh();
}
