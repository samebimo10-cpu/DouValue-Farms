// The Gates screen — FR-GATE-06.
//
// One screen showing, for every zone, whether it may be planted and what is
// standing in the way. The requirements call gates the most important part of
// the app, so this is the screen that says whether the most important part is
// doing anything.
//
// It is written to be read in the order a person actually needs it: what is
// blocked, why, and what would clear it. A zone that is fine takes one line,
// because a screen that gives equal space to good news gets skimmed.

import {
  badge, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, note, openSheet, readForm, select, textarea, toast,
} from './kit.js';
import { can } from '../store.js';
import {
  canPlant, gateBoard, GATE_RULES, GATE_STATE, latestSoilTest, mediaBatchStanding,
} from '../domain/gates.js';
import { batchLabel, describeZones, isBagZone } from '../domain/media.js';
import { mediaRules } from '../rules.js';
import { requireSupervision, supervisionBanner, supervisionStamp } from './supervise.js';
import { friendlyDate, isoDate, uid } from '../util.js';

export const gatesView = {
  perm: 'viewGuide',        // everyone may see what is blocked; only the Owner may clear it

  render(ctx) {
    const board = gateBoard(ctx.state, { today: isoDate() });
    const blocked = board.filter((r) => !r.ok);
    const overridden = board.filter((r) => r.ok && r.overridden.length);

    if (!board.length) {
      return card(empty('🚧', 'No zones yet',
        'Add your greenhouses and fields under Field, and this screen starts checking them.'));
    }

    return head(ctx, board, blocked)
      + (blocked.length ? `<h2 class="section">Blocked</h2>${blocked.map(zoneCard).join('')}` : '')
      + (overridden.length
        ? `<h2 class="section">Open on an override</h2>${overridden.map(zoneCard).join('')}` : '')
      + clearList(board.filter((r) => r.ok && !r.overridden.length))
      + mediaBoard(ctx)
      + evidence(ctx);
  },

  actions: {
    // UX-27: the gate screens are not used alone until the Owner signs off the
    // field trial. Reading them is open to everybody; recording the evidence
    // the gates are decided on is what needs somebody beside you.
    'open-soiltest': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openSoilTest(ctx, el.dataset.plotId || '', watched);
    },
    'save-soiltest': saveSoilTest,
    'open-topsoil': async (ctx) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openTopsoil(ctx, watched);
    },
    'save-topsoil': saveTopsoil,
    // FR-GATE-08 to 10 — plant-bag media.
    'open-media': async (ctx) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openMedia(ctx, watched);
    },
    'save-media': saveMedia,
    'open-solarise': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openSolarise(ctx, el.dataset.batch, watched);
    },
    'save-solarise': saveSolarise,
    'open-fill': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openFill(ctx, el.dataset.batch || '', watched);
    },
    'save-fill': saveFill,
    'pull-bags': pullBags,
    'open-override': (ctx, el) => openOverride(ctx, el.dataset.plotId, el.dataset.gate),
    'save-override': saveOverride,
    'revoke-override': revokeOverride,
  },
};

function head(ctx, board, blocked) {
  return card(
    cardHead('Gates', blocked.length
      ? badge(`${blocked.length} blocked`, 'danger')
      : badge('all clear', 'ok'))
    + '<p><small>Nothing is planted into ground that has not passed these checks, and nothing is '
    + 'sprayed without a confirmed diagnosis behind it. These are the four things that cost '
    + 'Season 1.</small></p>'
    + supervisionBanner(ctx.state, 'gate')
    + `<div class="row wrap" style="margin-top:10px">${
      button('Record a soil test', 'open-soiltest', { icon: '🧪' })
    }${button('Log a topsoil delivery', 'open-topsoil', { icon: '🚚' })
    }${button('Log a media batch', 'open-media', { icon: '🪴' })
    }${button('Fill bags', 'open-fill', { cls: 'btn-ghost', icon: '🛍' })}</div>`,
    { tight: true },
  );
}

function zoneCard(row) {
  const planted = row.planted
    ? badge('planted', row.ok ? 'ok' : 'danger')
    : badge('empty', 'muted');

  return card(
    cardHead(row.zone.name + (isBagZone(row.zone) ? ' · plant bags' : ''), planted)
    + (row.planted && !row.ok && row.gates.some((g) => g.condemned)
      ? note('danger', 'Planted, and its media batch has since failed',
        '<small>The crop went in on a cleared batch, and that batch has now failed its nematode assay. '
        + 'See Media batches below for every zone it reached, and pull the bags.</small>')
      : row.planted && !row.ok
      ? note('danger', 'Already planted behind a closed gate',
        '<small>This went in without the checks passing. Treat what is in the ground as at risk and '
        + 'test now, so the next cycle is not the same.</small>')
      : '')
    + row.gates.map(gateRow).join('')
    + (!row.ok && isBagZone(row.zone)
      ? `<div style="margin-top:10px">${button('Test a media batch', 'open-soiltest',
        { cls: 'btn-block', icon: '🧪' })}</div>`
      : !row.ok
        ? `<div style="margin-top:10px">${button('Record a soil test', 'open-soiltest',
          { cls: 'btn-block', icon: '🧪', data: { plotId: row.zone.id } })}</div>`
        : ''),
  );
}

function gateRow(g) {
  const s = GATE_STATE[g.state];
  if (g.state === 'pass') {
    return `<p class="gate-row ok"><b>${s.icon} ${esc(g.name)}</b> <small>${esc(g.why)}</small></p>`;
  }
  if (g.state === 'overridden') {
    return note('warn', `${s.icon} ${g.name} — overridden`,
      `<small><b>${esc(g.blockedWhy)}</b><br>`
      + `Reason given: “${esc(g.override.reason)}”<br>`
      + `${button('Put this gate back', 'revoke-override', { cls: 'btn-ghost btn-sm', data: { id: g.override.id } })}`
      + '</small>');
  }
  return note('danger', `${s.icon} ${g.name}`,
    `<small><b>${esc(g.why)}</b><br>${esc(g.fix || '')}</small>`);
}

/** Cleared zones, one line each. Good news does not need a card. */
function clearList(rows) {
  if (!rows.length) return '';
  return card(
    cardHead('Cleared', badge(`${rows.length}`, 'ok'))
    + '<ul class="list">' + rows.map((r) => '<li><div class="grow">'
      + `<b>✓ ${esc(r.zone.name)}</b><small>${esc(r.gates.map((g) => g.why).join(' · '))}</small>`
      + '</div></li>').join('') + '</ul>',
  );
}

/** The tests and deliveries the gates are reading, so the verdicts can be checked. */
function evidence(ctx) {
  const tests = [...(ctx.state.soilTests || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const batches = Object.values(ctx.state.topsoilBatches || {});
  if (!tests.length && !batches.length) return '';

  return card(
    cardHead('What the gates are reading')
    + (tests.length
      ? '<ul class="list">' + tests.map((t) => {
        const zone = ctx.state.plots[t.zoneId];
        const mb = t.mediaBatchId ? (ctx.state.mediaBatches || {})[t.mediaBatchId] : null;
        const where = zone ? zone.name : t.batchId ? `topsoil batch ${t.batchId.slice(-4)}`
          : t.mediaBatchId ? `media batch (${batchLabel(mb, t.mediaBatchId)})` : 'unknown';
        return '<li><div class="grow">'
          + `<b>${esc(where)}</b><small>${t.ph != null ? `pH ${esc(t.ph)}` : 'no pH'}`
          + `${t.nematode ? ` · nematode: ${esc(t.nematode)}` : ''}`
          + `${t.beforeCorrection ? ' · taken before liming' : ''}`
          + ` · ${esc(friendlyDate(t.date))}</small></div></li>`;
      }).join('') + '</ul>'
      : '<p><small>No soil tests recorded yet.</small></p>')
    + (batches.length
      ? '<p style="margin-top:12px"><small><b>Topsoil batches</b></small></p><ul class="list">'
        + batches.map((b) => {
          const clean = (ctx.state.soilTests || []).some((t) => t.batchId === b.id && t.nematode === 'clean');
          return '<li><div class="grow">'
            + `<b>${esc(b.supplier || 'Supplier not named')}</b>`
            + `<small>${esc(friendlyDate(b.date))}</small></div>`
            + badge(clean ? 'tested clean' : 'untested', clean ? 'ok' : 'danger') + '</li>';
        }).join('') + '</ul>'
      : ''),
  );
}

/**
 * FR-GATE-09/10 — every media batch, whether bags from it may go anywhere, and
 * where they already went. A failed batch comes first and names every zone
 * still holding its bags, with the button that pulls them.
 */
function mediaBoard(ctx) {
  const ids = Object.keys(ctx.state.mediaBatches || {});
  if (!ids.length) return '';
  const today = isoDate();
  const rows = ids.map((id) => mediaBatchStanding(ctx.state, id, { today }))
    .sort((a, b) => (Number(b.condemned) - Number(a.condemned)) || (Number(a.ok) - Number(b.ok)));
  const puller = can(ctx.user, 'manageCycles');

  return `<h2 class="section">Media batches</h2>${rows.map((r) => {
    const b = r.batch || {};
    const tone = r.condemned ? 'danger' : r.ok ? 'ok' : 'warn';
    const status = r.condemned ? 'FAILED' : r.ok ? 'cleared' : 'not cleared';
    const reached = r.zones.length
      ? '<ul class="list">' + r.zones.map((z) => '<li><div class="grow">'
        + `<b>${esc(z.name)}</b><small>${z.bags} bag${z.bags === 1 ? '' : 's'} in`
        + `${z.pulled ? ` · ${z.pulled} pulled` : ''}${z.planted ? ' · planted' : ''}</small></div>`
        + (r.condemned && z.bags && puller
          ? button('Pull these bags', 'pull-bags', { cls: 'btn-danger btn-sm',
            data: { batch: r.batchId, zone: z.zoneId } })
          : '')
        + '</li>').join('') + '</ul>'
      : '<p><small>No bags filled from it yet.</small></p>';

    return card(
      cardHead(b.supplier || 'Supplier not named', badge(status, tone))
      + `<p><small>${esc(friendlyDate(b.date))}${b.volume ? ` · ${esc(b.volume)}` : ''}`
      + `${b.solarisedFrom && b.solarisedTo ? ` · solarised ${esc(b.solarisedFrom)} to ${esc(b.solarisedTo)}` : ''}`
      + '</small></p>'
      + (r.condemned
        ? note('danger', `Failed — reached ${r.zones.filter((z) => z.bags).length} zone`
          + `${r.zones.filter((z) => z.bags).length === 1 ? '' : 's'}`,
          `<small><b>${esc(r.checks.find((c) => c.id === 'nematode').why)}</b><br>`
          + `${esc(r.checks.find((c) => c.id === 'nematode').fix)}</small>`)
        : r.checks.filter((c) => c.state !== 'pass').map((c) => note('warn', `${GATE_STATE[c.state].icon} ${c.name}`,
          `<small><b>${esc(c.why)}</b><br>${esc(c.fix || '')}</small>`)).join(''))
      + reached
      + `<div class="row wrap" style="margin-top:10px">${
        r.condemned ? '' : button('Fill bags from it', 'open-fill', { cls: 'btn-ghost btn-sm', data: { batch: r.batchId } })
      }${button('Solarisation dates', 'open-solarise', { cls: 'btn-ghost btn-sm', data: { batch: r.batchId } })}</div>`,
    );
  }).join('')}`;
}

// --- Recording the evidence -----------------------------------------------

let gateWatch = null;   // UX-27: who is standing over this one

function openSoilTest(ctx, plotId, watched = null) {
  gateWatch = watched;
  const zones = Object.values(ctx.state.plots || {});
  const batches = Object.values(ctx.state.topsoilBatches || {});
  const media = Object.values(ctx.state.mediaBatches || {});

  openSheet('<h2>Record a soil test</h2>'
    + (watched && watched.how === 'confirmed'
      ? note('info', `${watched.byName} is confirmed as present`, '') : '')
    + '<p><small>A test is about one place on one day. Record it as it came back, including a '
    + 'result you do not like — a bad result recorded now is a cheaper season than a good one '
    + 'assumed.</small></p>'
    + '<form data-act="save-soiltest">'
    + field('Where', select('target', [
      ...zones.map((z) => ({ value: `zone:${z.id}`, label: z.name })),
      ...batches.map((b) => ({ value: `batch:${b.id}`, label: `Topsoil — ${b.supplier || b.id.slice(-4)}` })),
      ...media.map((b) => ({ value: `media:${b.id}`, label: `Media batch — ${batchLabel(b, b.id)}` })),
    ], plotId ? `zone:${plotId}` : '', { required: true, placeholder: 'Choose a zone or a batch' }),
    'A plant-bag zone is tested through its media batch, not its ground.')
    + field('Date of the test', input('date', { type: 'date', value: isoDate(), required: true }))
    + field('pH', input('ph', { type: 'number', step: '0.1', min: '3', max: '10', placeholder: 'e.g. 6.2' }),
      `Peppers need ${GATE_RULES.phMin} to ${GATE_RULES.phMax}. Leave blank if this was a nematode test only.`)
    + field('Three-point readings', '<div class="row">'
      + input('ph1', { type: 'number', step: '0.01', min: '3', max: '10', placeholder: 'Point 1' })
      + input('ph2', { type: 'number', step: '0.01', min: '3', max: '10', placeholder: 'Point 2' })
      + input('ph3', { type: 'number', step: '0.01', min: '3', max: '10', placeholder: 'Point 3' })
      + '</div>', 'A media batch needs all three. If you enter them, the pH above can be left blank.')
    + field('Nematode result', select('nematode', [
      { value: '', label: 'Not tested for nematodes' },
      { value: 'clean', label: 'Clean — no nematodes found' },
      { value: 'root-knot detected', label: 'Root-knot nematode found' },
      { value: 'other nematodes detected', label: 'Other nematodes found' },
    ]), 'This is the check Season 1 was lost for.')
    + field('Lab', input('lab', { placeholder: 'Which lab ran the nematode assay' }))
    + '<label class="tick" style="margin:10px 0"><input type="checkbox" name="beforeCorrection" value="1">'
    + '<span class="txt"><b>Taken before liming</b><span class="pid">A reading from before the lime went '
    + 'on does not open the gate</span></span></label>'
    + field('Notes', textarea('note', { rows: 2, placeholder: 'Lab, sample depth, anything unusual' }))
    + '<button class="btn-block btn-lg" type="submit">Save the test</button>'
    + '</form>');
}

async function saveSoilTest(ctx, form) {
  const data = readForm(form);
  const target = String(data.target || '');
  if (!target) { toast('Say which zone or batch this test is for', true); return; }
  const points = [data.ph1, data.ph2, data.ph3].filter((v) => v !== '' && v != null).map(Number);
  if (points.length && points.length < 3) { toast('Enter all three points, or none', true); return; }
  const mean = points.length ? Math.round((points.reduce((a, b) => a + b, 0) / 3) * 100) / 100 : null;
  if (!data.ph && mean == null && !data.nematode) {
    toast('A test needs a pH reading or a nematode result', true); return;
  }

  const [kind, id] = target.split(':');
  await ctx.store.dispatch('soiltest.record', {
    id: uid('st'),
    zoneId: kind === 'zone' ? id : null,
    batchId: kind === 'batch' ? id : null,
    mediaBatchId: kind === 'media' ? id : null,
    date: data.date || isoDate(),
    ph: data.ph ? Number(data.ph) : mean,
    ...(points.length ? { readings: points, points: 3 } : {}),
    lab: data.lab || '',
    nematode: data.nematode || null,
    beforeCorrection: !!data.beforeCorrection,
    note: data.note || '',
    supervision: supervisionStamp(gateWatch),
    enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast('Soil test recorded');
}

function openTopsoil(ctx, watched = null) {
  gateWatch = watched;
  openSheet('<h2>Log a topsoil delivery</h2>'
    + (watched && watched.how === 'confirmed'
      ? note('info', `${watched.byName} is confirmed as present`, '') : '')
    + '<p><small>Bought-in soil is the quickest way to move nematodes onto clean ground. Each load is '
    + 'a batch, and a batch goes nowhere until it has been tested.</small></p>'
    + '<form data-act="save-topsoil">'
    + field('Supplier', input('supplier', { required: true, placeholder: 'Who it came from' }))
    + field('Date delivered', input('date', { type: 'date', value: isoDate(), required: true }))
    + field('How much', input('quantity', { placeholder: 'e.g. 2 tipper loads' }))
    + field('Which zone is it going into?', select('zoneId',
      Object.values(ctx.state.plots || {}).map((z) => ({ value: z.id, label: z.name })),
      '', { placeholder: 'Not assigned yet' }),
      'You can leave this blank. Assigning it makes that zone depend on this batch passing its test.')
    + '<button class="btn-block btn-lg" type="submit">Save the delivery</button>'
    + '</form>');
}

async function saveTopsoil(ctx, form) {
  const data = readForm(form);
  const id = uid('ts');
  await ctx.store.dispatch('topsoil.receive', {
    id, supplier: data.supplier, date: data.date || isoDate(),
    quantity: data.quantity || '', supervision: supervisionStamp(gateWatch),
    enteredAt: new Date().toISOString(),
  });
  if (data.zoneId) await ctx.store.dispatch('topsoil.assign', { zoneId: data.zoneId, batchId: id });
  closeSheet();
  toast(data.zoneId ? 'Delivery logged and assigned. Test it before planting.' : 'Delivery logged');
}

// --- Plant-bag media (FR-GATE-08 to 10) --------------------------------------

function openMedia(ctx, watched = null) {
  gateWatch = watched;
  const spec = mediaRules();
  openSheet('<h2>Log a media batch</h2>'
    + (watched && watched.how === 'confirmed'
      ? note('info', `${watched.byName} is confirmed as present`, '') : '')
    + '<p><small>One heap is one batch. Every bag filled from it is traced back to it, so if it fails '
    + 'later the app can name every zone it reached.</small></p>'
    + '<form data-act="save-media">'
    + field('Supplier', input('supplier', { required: true, placeholder: 'Who supplied or mixed it' }))
    + field('Date delivered or mixed', input('date', { type: 'date', value: isoDate(), required: true }))
    + field('How much', input('volume', { placeholder: 'e.g. 6 m³, or 2 tipper loads' }))
    + field('Solarisation started', input('solarisedFrom', { type: 'date' }))
    + field('Solarisation ended', input('solarisedTo', { type: 'date' }),
      `The heap needs ${spec ? spec.solarisation_min_days : 21} days or more under plastic. `
      + 'You can add these later.')
    + '<button class="btn-block btn-lg" type="submit">Save the batch</button>'
    + '</form>');
}

async function saveMedia(ctx, form) {
  const data = readForm(form);
  if (!String(data.supplier || '').trim()) { toast('Name the supplier', true); return; }
  if (data.solarisedFrom && data.solarisedTo && data.solarisedTo < data.solarisedFrom) {
    toast('Solarisation cannot end before it starts', true); return;
  }
  await ctx.store.dispatch('media.receive', {
    id: uid('mb'), supplier: data.supplier.trim(), date: data.date || isoDate(),
    volume: data.volume || '',
    solarisedFrom: data.solarisedFrom || null, solarisedTo: data.solarisedTo || null,
    supervision: supervisionStamp(gateWatch), enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast('Batch logged. Test three points and send a nematode sample before bagging.');
}

function openSolarise(ctx, batchId, watched = null) {
  gateWatch = watched;
  const b = (ctx.state.mediaBatches || {})[batchId];
  if (!b) { toast('That batch is not on record', true); return; }
  openSheet(`<h2>Solarisation — ${esc(batchLabel(b, batchId))}</h2>`
    + '<form data-act="save-solarise">'
    + `<input type="hidden" name="batchId" value="${esc(batchId)}">`
    + field('Went under plastic', input('from', { type: 'date', value: b.solarisedFrom || '', required: true }))
    + field('Came off', input('to', { type: 'date', value: b.solarisedTo || '', required: true }))
    + '<button class="btn-block btn-lg" type="submit">Save the dates</button>'
    + '</form>');
}

async function saveSolarise(ctx, form) {
  const data = readForm(form);
  if (!data.from || !data.to) { toast('Both dates are needed', true); return; }
  if (data.to < data.from) { toast('Solarisation cannot end before it starts', true); return; }
  await ctx.store.dispatch('media.solarise', { batchId: data.batchId, from: data.from, to: data.to });
  closeSheet();
  toast('Solarisation recorded');
}

function openFill(ctx, batchId = '', watched = null) {
  gateWatch = watched;
  const today = isoDate();
  const batches = Object.keys(ctx.state.mediaBatches || {})
    .map((id) => mediaBatchStanding(ctx.state, id, { today }))
    .filter((r) => !r.condemned);
  const zones = Object.values(ctx.state.plots || {}).filter((z) => isBagZone(z) && !z.retired);
  if (!batches.length) { toast('Log a media batch first', true); return; }
  if (!zones.length) { toast('No plant-bag zones. Set a zone\'s media to plant bags first.', true); return; }

  openSheet('<h2>Fill bags</h2>'
    + (watched && watched.how === 'confirmed'
      ? note('info', `${watched.byName} is confirmed as present`, '') : '')
    + '<p><small>Record every fill, even from a batch still waiting on its tests. The zone stays blocked '
    + 'until the batch clears, and if the batch ever fails, these are the bags that get pulled.</small></p>'
    + '<form data-act="save-fill">'
    + field('From which batch', select('batchId', batches.map((r) => ({
      value: r.batchId,
      label: `${batchLabel(r.batch, r.batchId)} — ${r.ok ? 'cleared' : 'NOT cleared'}`,
    })), batchId, { required: true, placeholder: 'Choose the batch' }))
    + field('Into which zone', select('zoneId', zones.map((z) => ({ value: z.id, label: z.name })),
      '', { required: true, placeholder: 'Choose a plant-bag zone' }))
    + field('How many bags', input('bags', { type: 'number', min: '1', step: '1', required: true, placeholder: 'e.g. 120' }))
    + field('Date filled', input('date', { type: 'date', value: today, required: true }))
    + '<button class="btn-block btn-lg" type="submit">Save the fill</button>'
    + '</form>');
}

async function saveFill(ctx, form) {
  const data = readForm(form);
  const bags = Number(data.bags);
  if (!data.batchId || !data.zoneId) { toast('Say which batch and which zone', true); return; }
  if (!Number.isInteger(bags) || bags < 1) { toast('Say how many bags', true); return; }
  const standing = mediaBatchStanding(ctx.state, data.batchId, { today: isoDate() });
  // A failed batch goes nowhere. The rules say do not reuse the media.
  if (standing.condemned) { toast('This batch failed its nematode assay. Do not bag it.', true); return; }

  await ctx.store.dispatch('media.fill', {
    id: uid('fill'), batchId: data.batchId, zoneId: data.zoneId, bags, date: data.date || isoDate(),
    supervision: supervisionStamp(gateWatch), enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast(standing.ok ? 'Fill recorded' : 'Fill recorded. The zone stays blocked until this batch clears.');
}

/** FR-GATE-10: pull every standing bag from a failed batch out of one zone. */
async function pullBags(ctx, el) {
  if (!can(ctx.user, 'manageCycles')) { toast('Ask the Field Supervisor or Farm Manager', true); return; }
  const { batch: batchId, zone: zoneId } = el.dataset;
  const fills = (ctx.state.mediaFills || []).filter((f) => f.batchId === batchId && f.zoneId === zoneId && !f.pulledAt);
  const zone = ctx.state.plots[zoneId];
  const n = fills.reduce((a, f) => a + (Number(f.bags) || 0), 0);
  if (!fills.length) { toast('No bags from this batch are left there'); return; }

  const ok = await confirmSheet(`Pull ${n} bag${n === 1 ? '' : 's'} from ${zone ? zone.name : 'this zone'}?`,
    'They are marked pulled, not deleted, so the record of where this batch went stays. '
    + 'Do not reuse the media.', 'Yes, they are pulled');
  if (!ok) return;
  for (const f of fills) {
    await ctx.store.dispatch('media.pull', { id: f.id, date: isoDate(), reason: 'batch failed nematode assay' });
  }
  toast('Bags marked pulled');
}

// --- Overrides (FR-GATE-07) -----------------------------------------------

function openOverride(ctx, plotId, gateId) {
  if (!can(ctx.user, 'manageOwners')) { toast('Only the Owner can override a gate', true); return; }
  const zone = ctx.state.plots[plotId];
  if (!zone) { toast('That zone is not on record', true); return; }

  const verdict = canPlant(ctx.state, plotId, { today: isoDate() });
  const choices = verdict.blocking.length ? verdict.blocking : verdict.gates;

  openSheet(`<h2>Override a gate on ${esc(zone.name)}</h2>`
    + note('warn', 'This is on your name',
      '<small>The gate stays on the record with what it found, your reason sits beside it, and it '
      + 'appears in the daily digest. Anyone can see later what was decided and why.</small>')
    + '<form data-act="save-override">'
    + `<input type="hidden" name="zoneId" value="${esc(plotId)}">`
    + field('Which gate', select('gate',
      choices.map((g) => ({ value: g.id, label: `${g.name} — ${g.why}` })),
      gateId || '', { required: true, placeholder: 'Choose the gate' }))
    + field('Why is it safe to go ahead?',
      textarea('reason', { rows: 3, placeholder: 'e.g. Lab lost the slip, resample sent Monday, '
        + 'result expected before transplant' }),
      'At least a sentence. "Urgent" is not a reason anyone can check a year from now.')
    + '<button class="btn-block btn-lg btn-danger" type="submit">Override this gate</button>'
    + '</form>');
}

async function saveOverride(ctx, form) {
  const data = readForm(form);
  const reason = String(data.reason || '').trim();
  if (!data.gate) { toast('Choose which gate', true); return; }
  // Mirrors the server's guard, so the refusal happens here rather than as a
  // rejected record after a sync the person has already walked away from.
  if (reason.length < 10) { toast('Give a reason someone could check later', true); return; }

  const zone = ctx.state.plots[data.zoneId];
  const ok = await confirmSheet('Override this gate?',
    `${zone ? zone.name : 'This zone'} will be plantable even though the check has not passed. `
    + 'Your name and reason stay on the record.', 'Yes, override it');
  if (!ok) return;

  await ctx.store.dispatch('gate.override', {
    id: uid('ov'), gate: data.gate, zoneId: data.zoneId, reason,
    enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast('Override recorded. It shows in the digest.');
}

async function revokeOverride(ctx, el) {
  const ok = await confirmSheet('Put the gate back?',
    'The zone goes back to blocked until the check passes properly.', 'Yes, put it back');
  if (!ok) return;
  await ctx.store.dispatch('gate.override.revoke', { id: el.dataset.id });
  toast('Gate restored');
}
