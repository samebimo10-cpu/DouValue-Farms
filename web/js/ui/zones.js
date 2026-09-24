// Zones and positions — requirements 6.1 and section 4.
//
// Two lists that belong together, because the question a Farm Manager actually
// has in the morning is one question: is every house being looked after today?
// That is a fact about zones and a fact about people at the same time, and
// splitting it across two screens is how it stops being asked.
//
// The cover board is the top of this screen for that reason. A gap in it — a
// house with nobody on it — is the thing the Owner could not see from anywhere
// else, and it is above the tidy list of who holds what.

import {
  badge, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, note, openSheet, readForm, select, textarea, toast,
} from './kit.js';
import { can } from '../store.js';
import { coverBoard, POSITION_TEMPLATE } from '../domain/positions.js';
import { qrSvg, zoneCode } from '../domain/qr.js';
import { gatesForZone, isBlocking } from '../domain/gates.js';
import { isNursery, zoneTypeLabel } from '../domain/farm.js';
import { BARRIERS, barrierLabel, isBagZone } from '../domain/media.js';
import { tasksFor } from '../domain/schedule.js';
import { isoDate, uid } from '../util.js';

export const zonesView = {
  perm: 'viewTeam',

  render(ctx) {
    const today = isoDate();
    const now = new Date();
    const board = coverBoard(ctx.state, { today, now });
    const zones = Object.values(ctx.state.plots || {});

    return head(ctx, board)
      + coverBlock(board)
      + zoneList(ctx, zones, today)
      + positionList(ctx, board);
  },

  actions: {
    'open-zone': (ctx, el) => openZoneSheet(ctx, el.dataset.id),
    'save-zone': saveZone,
    'retire-zone': retireZone,
    'restore-zone': async (ctx, el) => {
      await ctx.store.dispatch('plot.restore', { id: el.dataset.id });
      toast('Zone back in use');
    },
    'open-position': (ctx, el) => openPositionSheet(ctx, el.dataset.id),
    'save-position': savePosition,
    'seed-positions': seedPositions,
    'open-absence': (ctx) => openAbsenceSheet(ctx),
    'save-absence': saveAbsence,
  },
};

function head(ctx, board) {
  const gaps = board.filter((r) => r.unassigned).length;
  const covering = board.filter((r) => r.covering).length;

  return card(
    cardHead('Zones and positions', gaps
      ? badge(`${gaps} not covered`, 'danger')
      : covering ? badge(`${covering} on cover`, 'warn') : badge('all covered', 'ok'))
    + '<p><small>A job belongs to a position, not to a person. When somebody is off, their zone '
    + 'moves to whoever holds it as a backup — automatically, including when nobody told the '
    + 'app.</small></p>'
    + `<div class="row wrap" style="margin-top:10px">${
      can(ctx.user, 'manageCycles') ? button('Add a zone', 'open-zone', { icon: '📍' }) : ''
    }${button('Report an absence', 'open-absence', { cls: 'btn-ghost', icon: '🏠' })
    }${button('Door codes to print', 'go', {
      cls: 'btn-ghost', icon: '🔳', data: { to: '#/zones/codes' } })}</div>`,
    { tight: true },
  );
}

/** FR-ROLE-02 made visible: who is actually doing what today. */
function coverBlock(board) {
  if (!board.length) return '';
  const notable = board.filter((r) => r.unassigned || r.covering);
  if (!notable.length) {
    return card(`<p class="gate-row ok"><b>✓ Every position covered today</b> `
      + `<small>All ${board.length} holders are in.</small></p>`, { tight: true });
  }

  return `<h2 class="section">Today's cover</h2>${notable.map((r) => card(
    cardHead(r.position.title, r.unassigned
      ? badge('nobody on it', 'danger') : badge('on cover', 'warn'))
    + (r.unassigned
      ? note('danger', r.why || 'Nobody is doing this today',
        '<small>Put somebody on it or the zone goes unchecked. An unchecked house is how a '
        + 'pest gets a week\'s head start.</small>')
      : `<p class="why"><b>${esc(r.doing.name)}</b> is covering`
        + `${r.holder ? ` for ${esc(r.holder.name)}` : ''}. <small>${esc(r.why || '')}</small></p>`),
  )).join('')}`;
}

function zoneList(ctx, zones, today) {
  const live = zones.filter((z) => !z.retired);
  const retired = zones.filter((z) => z.retired);

  if (!live.length && !retired.length) {
    return card(empty('📍', 'No zones yet',
      'Add your greenhouses and fields. Everything else in the app hangs off them — the gates, '
      + 'the daily work, and the money per house.'));
  }

  const today_tasks = tasksFor(ctx.state, { date: today });
  const counts = new Map();
  for (const t of today_tasks) counts.set(t.zoneId, (counts.get(t.zoneId) || 0) + 1);

  return `<h2 class="section">Zones</h2>${card(
    '<ul class="list">' + live.map((z) => {
      const gates = gatesForZone(ctx.state, z.id, { today });
      const blocked = isNursery(z) ? 0 : gates.filter(isBlocking).length;
      const due = counts.get(z.id) || 0;
      return `<li data-act="open-zone" data-id="${esc(z.id)}"><div class="grow">`
        + `<b>${esc(z.name)}</b><small>${esc(zoneTypeLabel(z))}`
        + `${isBagZone(z) ? ' · plant bags' : ''}`
        + `${z.areaM2 ? ` · ${esc(z.areaM2)} m²` : ''}`
        + ` · ${due} job${due === 1 ? '' : 's'} today</small></div>`
        + (isNursery(z) ? badge('nursery', 'muted')
          : badge(blocked ? `${blocked} to clear` : 'clear', blocked ? 'danger' : 'ok'))
        + '</li>';
    }).join('') + '</ul>',
  )}${retired.length ? card(
    cardHead('Retired', badge(`${retired.length}`, 'muted'))
    + '<p><small>Kept rather than deleted, so their history is still there when you decide '
    + 'whether to use them again.</small></p>'
    + '<ul class="list">' + retired.map((z) => `<li><div class="grow"><b>${esc(z.name)}</b>`
      + `<small>${esc(z.retiredReason || 'Retired')}</small></div>`
      + (can(ctx.user, 'manageCycles')
        ? button('Bring back', 'restore-zone', { cls: 'btn-ghost btn-sm', data: { id: z.id } })
        : '') + '</li>').join('') + '</ul>',
  ) : ''}`;
}

function positionList(ctx, board) {
  if (!board.length) {
    return card(
      cardHead('Positions')
      + '<p><small>A position is the job — Greenhouse Hand for GH-02, Field Supervisor. People '
      + 'are put into them and can be moved between them without touching any of the work.</small></p>'
      + (can(ctx.user, 'managePeople')
        ? button('Set up the standard positions', 'seed-positions', { cls: 'btn-block btn-lg', icon: '👥' })
        : ''),
    );
  }

  return `<h2 class="section">Positions</h2>${card(
    '<ul class="list">' + board.map((r) => `<li data-act="open-position" data-id="${esc(r.position.id)}">`
      + `<div class="grow"><b>${esc(r.position.title)}</b><small>`
      + `${r.holder ? esc(r.holder.name) : 'nobody assigned'}`
      + `${r.zone ? ` · ${esc(r.zone.name)}` : ''}`
      + `${r.backupZone ? ` · backs up ${esc(r.backupZone.name)}` : ''}</small></div>`
      + (r.holder ? '' : badge('vacant', 'warn'))
      + '</li>').join('') + '</ul>'
    + (can(ctx.user, 'managePeople')
      ? `<div style="margin-top:10px">${button('Add a position', 'open-position', { cls: 'btn-ghost btn-block' })}</div>`
      : ''),
  )}`;
}

// --- Zones ----------------------------------------------------------------

function openZoneSheet(ctx, id) {
  const zone = id ? ctx.state.plots[id] : null;
  openSheet(`<h2>${zone ? esc(zone.name) : 'Add a zone'}</h2>`
    + '<form data-act="save-zone">'
    + `<input type="hidden" name="id" value="${esc(zone ? zone.id : '')}">`
    + field('Name', input('name', { value: zone ? zone.name : '', required: true,
      placeholder: 'e.g. GH-01, or Field A' }),
      'Use the name painted on the door, so the app and the farm say the same thing.')
    + field('What is it?', select('type', [
      { value: 'greenhouse', label: 'Greenhouse' },
      { value: 'field', label: 'Open field' },
      { value: 'nursery', label: 'Nursery (seedlings, not a cropping block)' },
    ], zone ? zone.type || 'greenhouse' : 'greenhouse'),
      'A greenhouse is held to tighter pest thresholds — a closed room compounds a population '
      + 'that open field would shrug off. A nursery raises seedlings and is never planted as a block '
      + '(FR-FARM-04).')
    + field('Area in square metres', input('areaM2', {
      type: 'number', value: zone ? zone.areaM2 || '' : '', placeholder: 'e.g. 300' }))
    + field('Drainage', select('drainage', [
      { value: 'raised', label: 'Raised beds' },
      { value: 'ridged', label: 'Ridged' },
      { value: 'flat', label: 'Flat ground' },
    ], zone ? zone.drainage || 'raised' : 'raised'),
      'Flat ground in this rainfall is where Phytophthora starts.')
    + field('What the crop grows in', select('media', [
      { value: 'bed', label: 'Bed soil' },
      { value: 'bag', label: 'Plant bags' },
    ], zone && isBagZone(zone) ? 'bag' : 'bed'),
      'Plant bags: Gate 0 clears on the media batch that fills the bags, not on the bed. '
      + 'A crop already planted keeps the media it went in with.')
    + field('Plant bags stand on', select('barrier', BARRIERS, zone ? zone.barrier || '' : '',
      { placeholder: 'Not recorded' }),
      'For plant bags only. Bags on bare ground can root through the drainage holes into bed soil nobody tested.'
      + (zone && zone.barrier ? ` Now: ${barrierLabel(zone.barrier)}.` : ''))
    + '<button class="btn-block btn-lg" type="submit">Save the zone</button>'
    + '</form>'
    + (zone && !zone.retired && can(ctx.user, 'manageCycles')
      ? `<div style="margin-top:14px">${button('Retire this zone', 'retire-zone',
        { cls: 'btn-ghost btn-block', data: { id: zone.id } })}</div>`
        + '<p><small>Retiring keeps everything ever recorded against it. Nothing is deleted.</small></p>'
      : ''));
}

async function saveZone(ctx, form) {
  const data = readForm(form);
  if (!String(data.name || '').trim()) { toast('Give the zone a name', true); return; }
  const before = data.id ? ctx.state.plots[data.id] : null;
  const type = data.type || 'greenhouse';
  if (before && before.type !== type && type === 'nursery' && Object.values(ctx.state.cycles || {})
    .some((c) => c.plotId === before.id && c.status === 'active')) {
    toast('Close the cycle growing in it before it becomes the nursery', true);
    return;
  }
  await ctx.store.dispatch('plot.upsert', {
    id: data.id || uid('zone'),
    name: data.name.trim(),
    type,
    // A zone that changes type (as OF-02 did) stops carrying the rules type it was seeded with.
    ...(before && before.type !== type ? { rulesType: null } : {}),
    areaM2: Number(data.areaM2) || 0,
    drainage: data.drainage || 'raised',
    // C-19. Only a zone set to bags carries a media type, so a bed zone's
    // record is exactly what it was before media types existed.
    ...(data.media === 'bag' || (before && before.media) ? { media: data.media === 'bag' ? 'bag' : 'bed' } : {}),
    ...(data.barrier ? { barrier: data.barrier } : {}),
  });
  closeSheet();
  toast(data.id ? 'Zone saved' : 'Zone added. Test its soil before anything goes in.');
}

async function retireZone(ctx, el) {
  const zone = ctx.state.plots[el.dataset.id];
  const planted = Object.values(ctx.state.cycles || {})
    .some((c) => c.plotId === el.dataset.id && c.status === 'active');
  if (planted) { toast('Close the cycle growing in it first', true); return; }

  const ok = await confirmSheet(`Retire ${zone ? zone.name : 'this zone'}?`,
    'It stops generating work and cannot be planted, but everything ever recorded against it '
    + 'stays. You can bring it back at any time.', 'Retire it');
  if (!ok) return;

  await ctx.store.dispatch('plot.retire', { id: el.dataset.id, reason: '' });
  closeSheet();
  toast('Zone retired');
}

// --- Positions ------------------------------------------------------------

function openPositionSheet(ctx, id) {
  const position = id ? ctx.state.positions[id] : null;
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired);
  const people = Object.values(ctx.state.people || {}).filter((p) => p.active !== false);

  openSheet(`<h2>${position ? esc(position.title) : 'Add a position'}</h2>`
    + '<p><small>The job, not the person. Moving somebody into it is one change here rather than '
    + 'a rewrite of everything they were assigned.</small></p>'
    + '<form data-act="save-position">'
    + `<input type="hidden" name="id" value="${esc(position ? position.id : '')}">`
    + field('What is the job called?', input('title', {
      value: position ? position.title : '', required: true,
      placeholder: 'e.g. Greenhouse Hand — GH-03' }))
    + field('Which role?', select('role', [
      { value: 'hand', label: 'Greenhouse Hand' },
      { value: 'supervisor', label: 'Field Supervisor (2IC)' },
      { value: 'agronomist', label: 'Agronomist' },
      { value: 'manager', label: 'Farm Manager' },
      { value: 'ceo', label: 'Owner' },
    ], position ? position.role : 'hand'))
    + field('Who holds it now?', select('holderId',
      people.map((p) => ({ value: p.id, label: `${p.name} (${p.role})` })),
      position ? position.holderId || '' : '', { placeholder: 'Nobody yet' }))
    + field('Primary zone', select('primaryZoneId',
      zones.map((z) => ({ value: z.id, label: z.name })),
      position ? position.primaryZoneId || '' : '', { placeholder: 'No particular zone' }),
      'The zone whose daily work lands on this position.')
    + field('Backup zone', select('backupZoneId',
      zones.map((z) => ({ value: z.id, label: z.name })),
      position ? position.backupZoneId || '' : '', { placeholder: 'No backup zone' }),
      'The zone this position covers when its own hand is off. Every zone should be somebody\'s '
      + 'backup, or a day off leaves a house unchecked.')
    + '<button class="btn-block btn-lg" type="submit">Save the position</button>'
    + '</form>');
}

async function savePosition(ctx, form) {
  const data = readForm(form);
  if (!String(data.title || '').trim()) { toast('Give the position a title', true); return; }

  const id = data.id || uid('pos');
  await ctx.store.dispatch('position.upsert', {
    id,
    title: data.title.trim(),
    role: data.role || 'hand',
    primaryZoneId: data.primaryZoneId || null,
    backupZoneId: data.backupZoneId || null,
  });
  // Assignment is its own record, so the history reads as "who held this job
  // and when" rather than as a series of edits.
  await ctx.store.dispatch('position.assign', { id, holderId: data.holderId || null });
  closeSheet();
  toast('Position saved');
}

async function seedPositions(ctx) {
  const ok = await confirmSheet('Set up the standard positions?',
    'Owner, Farm Manager, Field Supervisor and four Greenhouse Hands, as listed in the '
    + 'requirements. You put people into them afterwards.', 'Create them');
  if (!ok) return;

  for (const template of POSITION_TEMPLATE) {
    await ctx.store.dispatch('position.upsert', {
      id: template.id, title: template.title, role: template.role,
      primaryZoneId: null, backupZoneId: null,
    });
  }
  toast('Positions created. Now give each one a zone and a holder.');
}

// --- Absence --------------------------------------------------------------

function openAbsenceSheet(ctx) {
  const people = Object.values(ctx.state.people || {}).filter((p) => p.active !== false);
  const mine = can(ctx.user, 'managePeople');

  openSheet('<h2>Report an absence</h2>'
    + '<p><small>The work moves to whoever backs up that zone, straight away. Without this it '
    + 'still moves once the morning is out — this just makes it happen before anyone is standing '
    + 'in an unchecked house.</small></p>'
    + '<form data-act="save-absence">'
    + (mine
      ? field('Who is off?', select('personId',
        people.map((p) => ({ value: p.id, label: p.name })), ctx.user.id, { required: true }))
      : `<input type="hidden" name="personId" value="${esc(ctx.user.id)}">`)
    + field('Which day?', input('date', { type: 'date', value: isoDate(), required: true }))
    + field('Why?', input('reason', { placeholder: 'e.g. sick, travelling — optional' }))
    + '<button class="btn-block btn-lg" type="submit">Record it</button>'
    + '</form>');
}

async function saveAbsence(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('absence.record', {
    id: uid('ab'),
    personId: data.personId || ctx.user.id,
    date: data.date || isoDate(),
    reason: data.reason || '',
  });
  closeSheet();
  toast('Recorded. Their zone moves to the backup holder.');
}

// --- Printable door codes — FR-FARM-03 ------------------------------------
//
// "Each zone has a printable QR code for its door or marker post."
//
// One page, one code per zone, cut up and taped to the doors. The code is
// generated here rather than fetched, so this page prints in a shed with no
// signal, which is where it will actually be printed.
//
// What is on the label matters as much as the code. A square of dots taped to a
// door with nothing else on it gets peeled off by somebody who does not know
// what it is, so the zone name is printed large underneath — big enough to be
// read from the path — and one line says what it is for.

export const zoneCodesView = {
  perm: 'viewGuide',

  render(ctx) {
    const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired);
    const farmName = (ctx.state.settings || {}).farmName || 'DouValue Farms';

    if (!zones.length) {
      return card(empty('🔳', 'No zones to label yet',
        'Add your greenhouses and fields first; each one gets its own code.'));
    }

    return card(
      cardHead('Door codes', button('Print', 'print', { cls: 'btn-sm', icon: '🖨️' }))
      + '<p><small>Print this page, cut along the lines and tape one to each door or marker '
      + 'post. Scanning it is the quickest way to choose a zone, and it is what confirms which '
      + 'house somebody is standing in when a job starts.</small></p>'
      + '<p><small><b>Laminate them, or put them behind clear tape.</b> These live outside in '
      + 'Port Harcourt rain. The codes carry enough error correction to survive splashes and a '
      + 'torn corner, but not a week of weather.</small></p>',
      { tight: true, cls: 'no-print' },
    )
      + `<div class="qr-sheet">${zones.map((z) => `<figure class="qr-card">`
        + qrSvg(zoneCode(z), { moduleSize: 6, label: `Zone code for ${z.name}` })
        + `<figcaption><b>${esc(z.name)}</b>`
        + `<small>${esc(zoneTypeLabel(z))}`
        + `${z.areaM2 ? ` · ${esc(z.areaM2)} m²` : ''}</small>`
        + `<small>${esc(farmName)} — scan at the start of every job here</small>`
        + '</figcaption></figure>').join('')}</div>`;
  },
};
