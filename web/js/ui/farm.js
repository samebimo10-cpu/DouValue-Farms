// The farm, the week, and who holds which zone — §4.1, FR-ROLE-06 to 08 and 11.
//
// A Field Supervisor or Farm Manager has two jobs on one phone: their own
// rounds, and everybody else's. Switching accounts to see one or the other is
// how the second job gets done and the first gets forgotten, so both are one
// tap apart on the same sign-in: My work (the Today screen, the same one a
// Greenhouse Hand gets) and The farm (this screen). A Greenhouse Hand has no
// switch and cannot open this one.

import {
  badge, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field, note,
  openSheet, readForm, select, toast,
} from './kit.js';
import { navigate, params } from './shell.js';
import {
  checkAssignment, farmWork, hasFarmView, liveAssignments, mayAssignZones, weekSpread, weekStart,
  zoneHolders,
} from '../domain/assignments.js';
import { shiftBoard } from '../domain/shift.js';
import { addDays, isoDate, uid } from '../util.js';
import { tag } from './field-kit.js';

/**
 * FR-ROLE-08 — the two views, one tap apart. Nothing at all for a role that
 * only has My work, so a Greenhouse Hand's screen is exactly what it was.
 */
export function workSwitch(user, here) {
  if (!hasFarmView(user)) return '';
  return `<div class="card tight work-switch">${workTabs(user, here)}</div>`;
}

/** The two tabs on their own, for a screen that sets them inside another card. */
export function workTabs(user, here) {
  if (!hasFarmView(user)) return '';
  const tab = (hash, label) => `<button class="chip ${here === hash ? 'on' : ''}" data-act="go" `
    + `data-to="${hash}" aria-pressed="${here === hash}">${esc(label)}</button>`;
  return `<span class="work-switch" role="group" aria-label="Which view">`
    + tab('#/today', 'My work') + ' ' + tab('#/farm', 'The farm') + '</span>';
}

const holdersLine = (h) => {
  const names = (list) => list.map((x) => esc(x.person.name)).join(', ');
  return (h.primary.length ? `<b>${names(h.primary)}</b>` : '<b>nobody</b>')
    + (h.backup.length ? ` <small>· backup ${names(h.backup)}</small>` : '');
};

// --- The farm --------------------------------------------------------------

export const farmView = {
  perm: 'viewTeam',
  allow: hasFarmView,

  render(ctx) {
    const today = isoDate();
    const now = new Date();
    const work = farmWork(ctx.state, { date: today, now });
    const assign = mayAssignZones(ctx.state, ctx.user, { today, now });
    const shifts = shiftBoard(ctx.state, { date: today });
    const gaps = work.zones.filter((z) => z.gap && z.tasks.length);

    let out = workSwitch(ctx.user, '#/farm');

    out += card(
      cardHead('The farm today', gaps.length
        ? badge(`${gaps.length} zone${gaps.length === 1 ? '' : 's'} with nobody on`, 'danger')
        : work.late.length ? badge(`${work.late.length} late`, 'warn') : badge('on track', 'ok'))
      + '<p><small>Every zone, who holds it, and how its day is going. Your own rounds are under '
      + 'My work, with the same photos, the same late rules and the same end-of-shift report as '
      + 'everybody else\'s.</small></p>'
      + `<div class="row wrap" style="margin-top:10px">${
        button('How the week is spread', 'go', { cls: 'btn-ghost', icon: '📅', data: { to: '#/week' } })
      }${assign.ok ? button('Assign a zone', 'open-assign', { icon: '👤' }) : ''}</div>`
      + (assign.ok && assign.how === 'covering' ? note('warn', 'You are covering', `<small>${esc(assign.why)}</small>`) : ''),
      { tight: true },
    );

    if (work.late.length) {
      out += `<h2 class="section">Late, and where it went</h2>` + card('<ul class="list">'
        + work.late.map(({ task, owners, escalation }) => `<li><div class="grow"><b>${esc(task.title || 'Task')}</b>`
          + `<small>${owners.length ? esc(owners.map((o) => o.name).join(', ')) : 'nobody'}`
          + ` · due ${esc((task.due || '').slice(0, 16).replace('T', ' '))}</small>`
          + `<small>${escalation && escalation.to.length
            ? `Now with ${esc(escalation.to.map((p) => p.name).join(', '))} (${esc(escalation.title || 'Owner')})`
            : esc(escalation ? escalation.why : '')}</small></div>`
          + tag('now', 'Late') + '</li>').join('') + '</ul>');
    }

    out += `<h2 class="section">Zones</h2>`;
    out += work.zones.length
      ? card('<ul class="list">' + work.zones.map((z) => `<li data-act="open-assign" data-zone="${esc(z.zone.id)}">`
        + `<div class="grow"><b>${esc(z.zone.name)}</b>`
        + `<small>${holdersLine(z.holders)}</small>`
        + (z.covering ? `<small>${esc(z.why)}</small>` : '')
        + (z.gap && z.tasks.length ? `<small>${esc(z.why || 'Nobody on it today')}</small>` : '')
        + '</div>'
        + (z.tasks.length
          ? badge(`${z.done} of ${z.tasks.length}`, z.gap ? 'danger' : z.done === z.tasks.length ? 'ok' : 'warn')
          : badge('no work', 'muted'))
        + '</li>').join('') + '</ul>')
      : card(empty('📍', 'No zones yet', 'Add zones under Field → Zones first.'));

    out += `<h2 class="section">End of shift</h2>` + card(
      `<p>${esc(shifts.counts.filed)} filed · ${esc(shifts.counts.missing)} still to come</p>`
      + (shifts.missing.length
        ? `<p><small>Waiting on ${esc(shifts.missing.map((p) => p.name).join(', '))}</small></p>` : '')
      + button('Read the reports', 'go', { cls: 'btn-ghost btn-block', data: { to: '#/shifts' } }),
    );

    const live = liveAssignments(ctx.state);
    if (live.length) {
      out += `<h2 class="section">Field assignments</h2>` + card('<ul class="list">'
        + live.map((a) => {
          const person = ctx.state.people[a.personId];
          const zone = ctx.state.plots[a.zoneId];
          return `<li><div class="grow"><b>${esc(person ? person.name : a.personId)}</b>`
            + `<small>${esc(zone ? zone.name : a.zoneId)} · ${esc(a.holding)}`
            + `${a.covering ? ' · set while covering' : ''}</small></div>`
            + (assign.ok ? button('Remove', 'end-assign', { cls: 'btn-ghost btn-sm', data: { id: a.id } }) : '')
            + '</li>';
        }).join('') + '</ul>');
    }
    return out;
  },

  actions: {
    'open-assign': (ctx, el) => openAssignSheet(ctx, el.dataset.zone || ''),
    'save-assign': saveAssign,
    'end-assign': endAssign,
  },
};

function openAssignSheet(ctx, zoneId) {
  const today = isoDate();
  const verdict = mayAssignZones(ctx.state, ctx.user, { today, now: new Date() });
  if (!verdict.ok) { toast(verdict.why, true); return; }
  const people = Object.values(ctx.state.people || {})
    .filter((p) => p.active !== false)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired);
  const holders = zoneId ? zoneHolders(ctx.state, zoneId) : null;

  openSheet('<h2>Assign a zone</h2>'
    + '<p><small>By name, to anybody on the farm — yourself included. A zone can have several '
    + 'people on it and a person several zones. Primary holders do the zone\'s work; backups '
    + 'pick it up when every primary is off.</small></p>'
    + (holders ? `<p>${holdersLine(holders)}</p>` : '')
    + '<form data-act="save-assign">'
    + field('Who?', select('personId', people.map((p) => ({
      value: p.id, label: p.id === ctx.user.id ? `${p.name} (me)` : p.name })), '', { required: true }))
    + field('Which zone?', select('zoneId', zones.map((z) => ({ value: z.id, label: z.name })),
      zoneId, { required: true }))
    + field('Holding it as', select('holding', [
      { value: 'primary', label: 'Primary — the zone\'s daily work is theirs' },
      { value: 'backup', label: 'Backup — theirs when the primary holders are off' },
    ], 'primary'))
    + '<button class="btn-block btn-lg" type="submit">Assign</button>'
    + '</form>');
}

async function saveAssign(ctx, form) {
  const data = readForm(form);
  const now = new Date();
  const payload = { id: uid('as'), personId: data.personId, zoneId: data.zoneId, holding: data.holding || 'primary' };
  const verdict = checkAssignment(ctx.state, payload, ctx.user, { today: isoDate(now), now });
  if (!verdict.ok) { toast(verdict.why, true); return; }
  if (verdict.how === 'covering') payload.covering = true;
  await ctx.store.dispatch('zone.assign', payload);
  closeSheet();
  toast(`${verdict.zone.name} assigned to ${verdict.person.name}`);
}

async function endAssign(ctx, el) {
  const a = ctx.state.assignments[el.dataset.id];
  if (!a) return;
  const verdict = mayAssignZones(ctx.state, ctx.user, { today: isoDate(), now: new Date() });
  if (!verdict.ok) { toast(verdict.why, true); return; }
  const person = ctx.state.people[a.personId];
  const zone = ctx.state.plots[a.zoneId];
  const ok = await confirmSheet(`Take ${zone ? zone.name : 'this zone'} off ${person ? person.name : 'them'}?`,
    'Its work stops landing on their list from now. What they already did stays on the record.', 'Take it off');
  if (!ok) return;
  await ctx.store.dispatch('zone.unassign', { id: a.id, ...(verdict.how === 'covering' ? { covering: true } : {}) });
  toast('Assignment removed');
}

// --- The week — FR-ROLE-11 ------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const weekView = {
  perm: 'viewTeam',
  allow: hasFarmView,

  render(ctx) {
    const start = weekStart(params().start || isoDate());
    const spread = weekSpread(ctx.state, { start, now: new Date() });
    const cell = (c) => (c.total
      ? { __raw: `${esc(c.total)}${c.late ? ` ${tag('now', `${c.late} late`)}` : ''}` }
      : '·');

    let out = workSwitch(ctx.user, '');
    out += card(
      cardHead(`Week of ${esc(start)}`, spread.gapTotal
        ? badge(`${spread.gapTotal} with nobody on`, 'danger') : badge('all held', 'ok'))
      + '<p><small>How many jobs land on each person each day, from the schedule and the log. A job '
      + 'two people hold counts for both. Done jobs count for whoever did them.</small></p>'
      + `<div class="row between" style="margin-top:10px">${
        button('← Last week', 'week-go', { cls: 'btn-ghost btn-sm', data: { start: isoDate(addDays(start, -7)) } })
      }${button('Next week →', 'week-go', { cls: 'btn-ghost btn-sm', data: { start: isoDate(addDays(start, 7)) } })}</div>`,
      { tight: true },
    );

    if (!spread.rows.length && !spread.totals.some(Boolean)) {
      return out + card(empty('📅', 'No work this week',
        'Nothing is growing, or nobody holds a zone yet. Assign zones from The farm.'));
    }

    // A table nine columns wide does not fit a phone, so each person is one
    // line: name and zones, then a strip of seven days, then the week.
    const strip = (cells, cls = '') => `<div class="week-cells ${cls}">${cells.join('')}</div>`;
    const dayCell = (c) => `<span class="${c.late ? 'late' : c.total ? 'on' : ''}" `
      + `title="${esc(c.total)} jobs${c.late ? `, ${esc(c.late)} late` : ''}">${c.total || '·'}</span>`;
    const line = (who, cells, total, cls = '') => `<div class="week-row ${cls}"><div class="who">${who}</div>`
      + `${strip(cells)}<b class="sum">${esc(total)}</b></div>`;

    let grid = line('', spread.days.map((d, i) => `<span class="head">${DAY_NAMES[i].slice(0, 2)}<br>${d.slice(8)}</span>`), '', 'week-head');
    for (const r of spread.rows) {
      grid += line(`<b>${esc(r.person.name)}</b>${r.heavy ? ` ${tag('soon', 'heavy')}` : ''}`
        + `<small>${esc(r.zones.map((z) => `${z.zone.name}${z.holding === 'backup' ? ' (backup)' : ''}`).join(', ') || 'no zones')}</small>`,
      r.perDay.map(dayCell), r.total);
    }
    grid += line('<b>Nobody on it</b>', spread.gaps.map((n) => `<span class="${n ? 'late' : ''}">${n || '·'}</span>`),
      spread.gapTotal, 'week-gap');
    grid += line('<b>All jobs</b>', spread.totals.map((n) => `<span>${n}</span>`),
      spread.totals.reduce((s, n) => s + n, 0), 'week-total');

    out += card(`<div class="week-grid">${grid}</div>`);
    const heavy = spread.rows.filter((r) => r.heavy);
    if (heavy.length) {
      out += card(note('warn', `${heavy.map((r) => r.person.name).join(', ')} carr${heavy.length === 1 ? 'ies' : 'y'} `
        + 'half as much again as the average this week',
      '<small>Move a zone, or add a backup, before the late work piles up on one list.</small>'));
    }
    return out;
  },

  actions: {
    'week-go': (ctx, el) => navigate(`#/week?start=${el.dataset.start}`),
  },
};
