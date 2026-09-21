// The UX-27 check, at the two screens that need it.
//
// One helper, used by the spray screen and the gate screens, so the rule is
// enforced the same way in both places and there is one thing to change when
// the trial is signed off.
//
// The tone matters. This is not a refusal — the person is allowed to do the
// job, with somebody beside them — so the sheet asks a question rather than
// throwing up a wall, and names the people who can answer it.

import { badge, button, closeSheet, esc, note, openSheet } from './kit.js';
import { checkSupervision, SUPERVISED_SCREENS, trialSignedOff } from '../domain/supervision.js';

/**
 * Ask for the supervisor, when UX-27 needs one.
 *
 * Resolves with `{ok, how, by}` — ok and already satisfied when the trial is
 * signed off or a supervisor is the one signed in, ok with the confirming
 * person's id when somebody taps their own name, and not ok when the sheet is
 * closed.
 */
export function requireSupervision(ctx, screen = 'spray') {
  const first = checkSupervision(ctx.state, ctx.user, { screen });
  if (first.ok) return Promise.resolve(first);

  const what = SUPERVISED_SCREENS[screen] || SUPERVISED_SCREENS.spray;
  return new Promise((resolve) => {
    const el = openSheet(`<h2>${esc(what.label)}</h2>`
      + note('warn', first.why, `<small>${esc(first.detail || '')} ${esc(first.fix)}</small>`)
      + (first.candidates.length
        ? '<p><small><b>Tap your name to confirm you are here.</b> It goes on the record with '
          + 'the job.</small></p>'
          + '<ul class="list big">' + first.candidates.map((p) => `<li data-id="${esc(p.id)}" `
            + 'data-role="confirm"><div class="grow">'
            + `<b>${esc(p.name)}</b><small>${esc(p.role === 'supervisor' ? 'Field Supervisor'
              : p.role === 'manager' ? 'Farm Manager' : 'Owner')}</small></div>`
            + badge('confirm', 'warn') + '</li>').join('') + '</ul>'
        : '')
      + '<p><small>This ends when the Owner signs off the field trial in Settings '
      + '(UX-26).</small></p>'
      + button('Not now', 'cancel-supervision', { cls: 'btn-ghost btn-block' }));

    const finish = (value) => { closeSheet(); resolve(value); };
    for (const row of el.querySelectorAll('[data-role="confirm"]')) {
      row.onclick = () => {
        const verdict = checkSupervision(ctx.state, ctx.user,
          { screen, confirmedBy: row.dataset.id });
        finish(verdict.ok ? verdict : { ok: false, reason: verdict.reason });
      };
    }
    el.querySelector('[data-act="cancel-supervision"]').onclick =
      () => finish({ ok: false, reason: 'cancelled' });
    el.addEventListener('click', (e) => { if (e.target === el) finish({ ok: false, reason: 'cancelled' }); });
  });
}

/** The banner that says the rule is in force, for the screens it applies to. */
export function supervisionBanner(state, screen = 'spray') {
  if (trialSignedOff(state)) return '';
  const what = SUPERVISED_SCREENS[screen] || SUPERVISED_SCREENS.spray;
  return note('warn', 'Field trial: supervised use',
    `<small>${esc(what.label)} needs the Field Supervisor or Farm Manager present until the `
    + 'Owner signs off the trial round (UX-26/27).</small>');
}

/** What to put on the record about who was watching. */
export function supervisionStamp(verdict) {
  if (!verdict || !verdict.ok) return null;
  return { how: verdict.how, by: verdict.by || null, byName: verdict.byName || null };
}
