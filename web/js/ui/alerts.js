// The alert board and the Owner's digest — requirements 6.5 and 6.11.
//
// Two screens, one file, because they answer the same question at two
// distances: what needs doing about a pest right now, and what the Owner needs
// to know without being here.
//
// The board is deliberately unpleasant to look at when it is not empty. An
// alert climbing towards the Owner should feel like something is wrong, because
// something is. The digest is the opposite: one line when the farm is fine.

import {
  badge, bar, button, card, cardHead, closeSheet, empty, esc, field,
  input, note, openSheet, readForm, select, spark, table, textarea, toast,
} from './kit.js';
import { can, cycleLabel } from '../store.js';
import { alerts, ALERT_LEVEL, DEFAULT_LADDER, risingWarnings, trend } from '../domain/alerts.js';
import { digest } from '../domain/digest.js';
import { friendlyDate, isoDate, uid } from '../util.js';

const hoursWord = (h) => (h < 1 ? 'under an hour' : `${Math.round(h)}h`);

export const alertsView = {
  perm: 'viewGuide',

  render(ctx) {
    const now = new Date().toISOString();
    const all = alerts(ctx.state, { now });
    const open = all.filter((a) => a.status === 'open');
    const closed = all.filter((a) => a.status === 'closed').slice(0, 6);
    const rising = risingWarnings(ctx.state, { today: isoDate() });

    return head(open)
      + (open.length
        ? open.map((a) => openCard(ctx, a)).join('')
        : card(empty('✓', 'No open alerts',
          'Every count recorded is under its threshold, and anything that crossed one has been '
          + 'dealt with. This is the screen you want to be boring.')))
      + risingBlock(rising)
      + closedBlock(closed);
  },

  actions: {
    'alert-ack': async (ctx, el) => {
      await ctx.store.dispatch('alert.ack', {
        id: uid('ak'), cycleId: el.dataset.cycle, pestId: el.dataset.pest,
      });
      toast('Marked as picked up. It still counts against the 24 hours.');
    },
    'alert-notreat': (ctx, el) => openNoTreat(ctx, el.dataset.cycle, el.dataset.pest, el.dataset.name),
    'save-notreat': saveNoTreat,
  },
};

function head(open) {
  const worst = open.find((a) => a.level === 'owner');
  return card(
    cardHead('Alerts', open.length
      ? badge(`${open.length} open`, worst ? 'danger' : 'warn')
      : badge('all clear', 'ok'))
    + '<p><small>A count over its threshold opens an alert with a 24-hour clock. It closes when a '
    + 'treatment goes on, or when someone records a decision not to treat — and nothing else '
    + 'closes it.</small></p>',
    { tight: true },
  );
}

function openCard(ctx, a) {
  const level = ALERT_LEVEL[a.level];
  const clock = Math.min(1, a.hoursOpen / DEFAULT_LADDER.ownerAfterHours);

  return card(
    cardHead(`${a.pestName} on ${a.zoneName}`, badge(`with the ${level.label}`, level.tone))
    + (a.vector
      ? note('danger', 'This one carries virus',
        `<small>${esc(a.note || '')} Waiting for the damage to look serious is waiting too long.</small>`)
      : '')
    + `<p class="why"><b>Counted:</b> ${esc(a.count)} ${a.countKind === 'trap' ? 'on the trap' : 'per plant'}`
    + `, against a threshold of ${esc(a.limit)}`
    + (a.overPct > 0 ? ` — ${esc(a.overPct)}% over` : '') + '.</p>'
    + `<p class="why"><b>Open:</b> ${esc(hoursWord(a.hoursOpen))} of 24`
    + (a.ack ? `, picked up by ${esc(nameOf(ctx, a.ack.by))}` : ', nobody has picked it up yet') + '.</p>'
    + bar(clock, a.overdue ? 'danger' : clock > 0.5 ? 'warn' : '')
    + (a.sightings.length > 1
      ? `<p><small>Seen ${a.sightings.length} times since — worst count ${esc(a.worst)}.</small></p>`
      : '')
    + '<div class="row wrap" style="margin-top:10px">'
    + (a.ack ? '' : button('I am on it', 'alert-ack',
      { icon: '👍', data: { cycle: a.cycleId, pest: a.pestId } }))
    + button('Diagnose it', 'go', { cls: 'btn-ghost', icon: '🔍', data: { to: '#/diagnose' } })
    + (can(ctx.user, 'assignTasks')
      ? button('No treatment needed', 'alert-notreat', {
        cls: 'btn-ghost', data: { cycle: a.cycleId, pest: a.pestId, name: a.pestName },
      })
      : '')
    + '</div>'
    + '<p style="margin-top:8px"><small>Raised by ' + esc(nameOf(ctx, a.raisedBy))
    + ` on ${esc(friendlyDate(a.date))}. Treating it is what closes this.</small></p>`,
  );
}

function nameOf(ctx, id) {
  const p = (ctx.state.people || {})[id];
  return p ? p.name : 'someone';
}

/** FR-SCOUT-07 — the yellow list, before anything is over the line. */
function risingBlock(rising) {
  if (!rising.length) return '';
  return `<h2 class="section">Climbing, not yet over</h2>${
    rising.map((r) => card(
      cardHead(`${r.pestName} on ${r.zoneName}`, badge('watch', 'warn'))
      + `<p class="why">${esc(r.why)}</p>`
      + '<p class="do"><b>Do this:</b> plan the spray now rather than scrambling for it. '
      + 'Check the rotation and make sure the product is in the store.</p>',
    )).join('')}`;
}

function closedBlock(closed) {
  if (!closed.length) return '';
  return `<h2 class="section">Recently closed</h2>${card(
    '<ul class="list">' + closed.map((a) => '<li><div class="grow">'
      + `<b>${esc(a.pestName)} on ${esc(a.zoneName)}</b>`
      + `<small>${esc(a.closure.what)} — ${esc(hoursWord(a.hoursToClose))} after it opened</small>`
      + '</div>' + badge(a.withinDeadline ? 'in time' : 'late', a.withinDeadline ? 'ok' : 'warn')
      + '</li>').join('') + '</ul>',
  )}`;
}

function openNoTreat(ctx, cycleId, pestId, pestName) {
  openSheet(`<h2>No treatment for ${esc(pestName || 'this')}?</h2>`
    + note('warn', 'This closes the alert',
      '<small>It is a decision on the record with your name on it, not a way of clearing the '
      + 'screen. Say what makes it safe to leave — a year from now that sentence is the only '
      + 'thing anyone will have.</small>')
    + '<form data-act="save-notreat">'
    + `<input type="hidden" name="cycleId" value="${esc(cycleId)}">`
    + `<input type="hidden" name="pestId" value="${esc(pestId)}">`
    + field('Why is no treatment needed?',
      textarea('reason', { rows: 3, placeholder: 'e.g. Predatory mites released Monday, giving '
        + 'them the week before deciding' }))
    + '<button class="btn-block btn-lg" type="submit">Record the decision</button>'
    + '</form>');
}

async function saveNoTreat(ctx, form) {
  const data = readForm(form);
  const reason = String(data.reason || '').trim();
  // Mirrors the server guard, so the refusal lands here rather than as a
  // rejected record after a sync the person has walked away from.
  if (reason.length < 10) { toast('Say why, in a sentence someone can check later', true); return; }

  await ctx.store.dispatch('alert.decide', {
    id: uid('ad'), cycleId: data.cycleId, pestId: data.pestId, reason,
  });
  closeSheet();
  toast('Decision recorded. The alert is closed.');
}

// --- The Owner's digest — FR-REP-01/02/03 ---------------------------------

export const digestView = {
  perm: 'viewReports',

  render(ctx) {
    const d = digest(ctx.state, { now: new Date().toISOString() });
    return digestHead(d) + digestBody(d) + sendBlock(d) + kpiBlock(d.kpis);
  },

  actions: {
    'digest-copy': async (ctx) => {
      const d = digest(ctx.state, { now: new Date().toISOString() });
      try {
        await navigator.clipboard.writeText(d.text);
        toast('Copied. Paste it into WhatsApp.');
      } catch {
        // Clipboard is blocked on some Android browsers, so show it instead of
        // failing silently — the point is to get the text to the Owner.
        openSheet('<h2>Today\'s digest</h2>'
          + '<p><small>Press and hold to select all, then copy.</small></p>'
          + `<pre class="working">${esc(d.text)}</pre>`);
      }
    },
  },
};

function digestHead(d) {
  return card(
    cardHead('Today\'s digest', d.allWell
      ? badge('nothing needs you', 'ok')
      : badge(`${d.counts.critical} need${d.counts.critical === 1 ? 's' : ''} you`,
        d.counts.critical ? 'danger' : 'warn'))
    + '<p><small>Exceptions only. If nothing is wrong this says so in one line — a digest that '
    + 'lists what went right gets skimmed, and the day it matters the one red line has to be the '
    + 'only line.</small></p>',
    { tight: true },
  );
}

function digestBody(d) {
  if (d.allWell) {
    return card(empty('✓', 'Nothing needs you today',
      'No open alerts, no overdue work, no overrides, nothing running out.'));
  }
  const tone = { critical: 'danger', warn: 'warn', watch: 'info' };
  return d.items.map((i) => note(tone[i.severity], i.line,
    i.detail ? `<small>${esc(i.detail)}</small>` : '')).join('');
}

/** FR-REP-02: text first, small enough for a weak and expensive connection. */
function sendBlock(d) {
  const bytes = new TextEncoder().encode(d.text).length;
  return card(
    cardHead('Send it')
    + `<pre class="working">${esc(d.text)}</pre>`
    + `<p><small>${bytes} bytes — text only, no photos, so it goes over one bar of signal without `
    + 'costing anything to receive.</small></p>'
    + `<div class="row wrap">${button('Copy for WhatsApp', 'digest-copy', { icon: '📋' })}</div>`,
  );
}

/** FR-REP-03 — the success measures from section 3, computed from the records. */
function kpiBlock(rows) {
  return `<h2 class="section">How the app is doing</h2>${card(
    cardHead('Success measures', badge(`${rows.filter((r) => r.ok).length} of ${rows.length} met`,
      rows.every((r) => r.ok) ? 'ok' : 'warn'))
    // table() escapes every cell unless it is handed {__raw}, which is what
    // keeps the measure and its basis on two lines.
    + table(['', 'Measure', 'Target', 'Now'], rows.map((r) => [
      r.value == null ? '—' : (r.ok ? '✓' : '✕'),
      { __raw: `<b>${esc(r.measure)}</b><br><small>${esc(r.basis)}</small>` },
      r.target,
      { __raw: `<b>${esc(r.display)}</b>` },
    ]))
    + '<p><small>Every one of these is read straight off the records. Nobody reports them.</small></p>',
  )}`;
}
