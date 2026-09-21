// End-of-shift reports — FR-TASK-05 and UX-09.
//
// One screen with two jobs, because they are the same conversation from two
// ends: a person writes their day, and the Farm Manager reads it and answers.
//
// It is kept away from the problem reports on purpose (see domain/shift.js).
// The Clinic holds what is wrong. This holds what happened.

import {
  badge, button, card, cardHead, closeSheet, empty, esc, field, note, openSheet,
  readForm, select, textarea, toast,
} from './kit.js';
import { can } from '../store.js';
import {
  judgeObservation, MIN_OBSERVATION_WORDS, OBSERVATION_PROMPT, shiftBoard, shiftFiled,
  shiftHistory, shiftReports,
} from '../domain/shift.js';
import { bindDraft, phraseChips } from './field-kit.js';
import { friendlyDate, isoDate, timeOfDay, uid } from '../util.js';

export const shiftView = {
  perm: 'viewOwnTasks',

  render(ctx) {
    const today = isoDate();
    const board = shiftBoard(ctx.state, { date: today });
    const manages = can(ctx.user, 'assignTasks');

    return head(ctx, board, manages)
      + mine(ctx, today)
      + (manages ? managerBoard(ctx, board) : '');
  },

  actions: {
    'open-shift': (ctx) => openShiftSheet(ctx),
    'save-shift': saveShift,
    'open-shift-comment': (ctx, el) => openCommentSheet(ctx, el.dataset.id),
    'save-shift-comment': saveComment,
  },

  mounted() { /* the draft binder runs when the sheet opens */ },
};

function head(ctx, board, manages) {
  return card(
    cardHead('End of shift', manages
      ? badge(`${board.counts.filed} of ${board.counts.worked} in`,
        board.counts.missing ? 'warn' : 'ok')
      : badge(friendlyDate(board.date), 'muted'))
    + '<p><small>A line at the end of the day: what you saw, what you did. It is not a problem '
    + 'report — anything wrong still goes in as a problem so it gets chased. This is the day '
    + 'itself, and the farm manager reads and answers it.</small></p>',
    { tight: true },
  );
}

/** The person's own report: file it, or read it back with any answer on it. */
function mine(ctx, today) {
  const filed = shiftReports(ctx.state, { date: today, personId: ctx.user.id })[0];
  if (!filed) {
    return card(
      cardHead('Your report for today')
      + note('info', OBSERVATION_PROMPT,
        '<small>A few words is enough. It is the only record of the day that is in your own '
        + 'words, and it is what the manager reads first tomorrow morning.</small>')
      + button('Write today\'s report', 'open-shift', { cls: 'btn-block btn-lg', icon: '📝' }),
    );
  }

  const past = shiftHistory(ctx.state, ctx.user.id, { today }).filter((s) => s.date !== today);
  return card(
    cardHead('Your report for today', badge('filed', 'ok'))
    + reportBody(ctx, filed, { own: true })
    + (past.length
      ? '<p style="margin-top:12px"><small><b>Earlier</b></small></p><ul class="list">'
        + past.slice(0, 5).map((s) => `<li><div class="grow"><b>${esc(friendlyDate(s.date))}</b>`
          + `<small>${esc(s.observation)}</small></div>`
          + badge(s.commented ? 'answered' : 'read', s.commented ? 'ok' : 'muted') + '</li>').join('')
        + '</ul>'
      : ''),
  );
}

function reportBody(ctx, s, { own = false } = {}) {
  return `<p class="why">${esc(s.observation)}</p>`
    + `<p><small>${esc(s.person ? s.person.name : 'Someone')}`
    + `${s.zone ? ` · ${esc(s.zone.name)}` : ''}`
    + `${s.at ? ` · ${esc(timeOfDay(s.at))}` : ''}</small></p>`
    + (s.note ? `<p><small>${esc(s.note)}</small></p>` : '')
    + (s.comments.length
      ? '<div class="note info" style="margin-top:10px"><b>From the farm manager</b>'
        + s.comments.map((c) => `<p style="margin:6px 0 0"><small>${esc(c.note)} — `
          + `${esc(nameOf(ctx, c.by))}, ${esc(timeOfDay(c.at))}</small></p>`).join('')
        + '</div>'
      : own ? '' : '');
}

function nameOf(ctx, id) {
  const p = (ctx.state.people || {})[id];
  return p ? p.name : 'someone';
}

/** FR-TASK-05 — the Farm Manager reads them and comments. */
function managerBoard(ctx, board) {
  const out = [];

  if (board.missing.length) {
    out.push(card(
      cardHead('Not in yet', badge(String(board.missing.length), 'warn'))
      + '<ul class="list">' + board.missing.map((p) => '<li><div class="grow">'
        + `<b>${esc(p.name)}</b><small>Worked today, no report yet</small></div>`
        + badge('waiting', 'warn') + '</li>').join('') + '</ul>'
      + '<p><small>Only people who clocked in are listed. Somebody who was not here today does '
      + 'not owe a report.</small></p>',
    ));
  }

  if (!board.reports.length) {
    out.push(card(empty('📝', 'No reports yet today',
      'They arrive as people finish. Yesterday\'s are still on each person\'s own screen.')));
    return out.join('');
  }

  out.push(`<h2 class="section">Today's reports</h2>` + board.reports.map((s) => card(
    cardHead(s.person ? s.person.name : 'Someone',
      badge(s.commented ? 'answered' : 'not answered yet', s.commented ? 'ok' : 'warn'))
    + reportBody(ctx, s)
    + `<div style="margin-top:10px">${button(s.commented ? 'Add a comment' : 'Comment',
      'open-shift-comment', { cls: 'btn-ghost', icon: '💬', data: { id: s.id } })}</div>`,
  )).join(''));

  return out.join('');
}

// --- Writing one ----------------------------------------------------------

function openShiftSheet(ctx) {
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired);
  const el = openSheet('<h2>End-of-shift report</h2>'
    + `<p><small>${esc(OBSERVATION_PROMPT)}</small></p>`
    + '<form data-act="save-shift">'
    + field('Your day', textarea('observation', { rows: 4,
      placeholder: 'e.g. Scouted GH-02 and GH-03, traps replaced in both. Drip line on bench 3 '
        + 'still blocked, flushed it twice.' }),
      `At least ${MIN_OBSERVATION_WORDS} words. This is the record of your day in your own words.`)
    + phraseChips('scout', 'observation')
    + field('Which zone were you mostly on?', select('zoneId',
      zones.map((z) => ({ value: z.id, label: z.name })), '', { placeholder: 'More than one' }))
    + field('Anything else', textarea('note', { rows: 2, placeholder: 'optional' }))
    + '<button class="btn-block btn-lg" type="submit">Send it to the farm manager</button>'
    + '</form>'
    + note('warn', 'Something actually wrong?',
      '<small>Send a problem report as well. This one is read in the morning; a problem report '
      + 'is chased until somebody closes it.</small>'));
  // UX-16: an interrupted report is not lost.
  bindDraft(el, 'shift');
}

async function saveShift(ctx, form) {
  const data = readForm(form);
  const verdict = judgeObservation(data.observation);
  if (!verdict.ok) { toast(verdict.why, true); return; }
  if (shiftFiled(ctx.state, ctx.user.id, isoDate())) {
    toast('You have already filed today. Add it to tomorrow\'s, or tell the manager.', true);
    return;
  }

  await ctx.store.dispatch('shift.record', {
    id: uid('sh'),
    personId: ctx.user.id,
    date: isoDate(),
    observation: String(data.observation).trim(),
    zoneId: data.zoneId || null,
    note: data.note || '',
    enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast('Report sent. The farm manager reads it tomorrow morning.');
}

function openCommentSheet(ctx, shiftId) {
  const s = (ctx.state.shifts || []).find((x) => x.id === shiftId);
  if (!s) { toast('That report is not on this phone', true); return; }
  const who = (ctx.state.people || {})[s.personId || s.by];

  openSheet(`<h2>Answer ${esc(who ? who.name : 'this report')}</h2>`
    + `<p class="why">${esc(s.observation)}</p>`
    + '<form data-act="save-shift-comment">'
    + `<input type="hidden" name="shiftId" value="${esc(shiftId)}">`
    + field('Your comment', textarea('note', { rows: 3,
      placeholder: 'e.g. Good catch on the drip line — I have put a fitting on the list for '
        + 'Thursday.' }),
      'They see this on their own screen. Somebody who writes the same thing three evenings '
      + 'running should be able to see that it was read.')
    + '<button class="btn-block btn-lg" type="submit">Send the comment</button>'
    + '</form>');
}

async function saveComment(ctx, form) {
  const data = readForm(form);
  const note_ = String(data.note || '').trim();
  // Mirrors the server guard, so the refusal lands here rather than after a sync.
  if (!note_) { toast('An empty comment says nothing', true); return; }

  await ctx.store.dispatch('shift.comment', {
    id: uid('shc'), shiftId: data.shiftId, note: note_,
  });
  closeSheet();
  toast('Comment sent');
}
