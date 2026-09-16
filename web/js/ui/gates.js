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
import { canPlant, gateBoard, GATE_RULES, GATE_STATE, latestSoilTest } from '../domain/gates.js';
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

    return head(board, blocked)
      + (blocked.length ? `<h2 class="section">Blocked</h2>${blocked.map(zoneCard).join('')}` : '')
      + (overridden.length
        ? `<h2 class="section">Open on an override</h2>${overridden.map(zoneCard).join('')}` : '')
      + clearList(board.filter((r) => r.ok && !r.overridden.length))
      + evidence(ctx);
  },

  actions: {
    'open-soiltest': (ctx, el) => openSoilTest(ctx, el.dataset.plotId || ''),
    'save-soiltest': saveSoilTest,
    'open-topsoil': (ctx) => openTopsoil(ctx),
    'save-topsoil': saveTopsoil,
    'open-override': (ctx, el) => openOverride(ctx, el.dataset.plotId, el.dataset.gate),
    'save-override': saveOverride,
    'revoke-override': revokeOverride,
  },
};

function head(board, blocked) {
  return card(
    cardHead('Gates', blocked.length
      ? badge(`${blocked.length} blocked`, 'danger')
      : badge('all clear', 'ok'))
    + '<p><small>Nothing is planted into ground that has not passed these checks, and nothing is '
    + 'sprayed without a confirmed diagnosis behind it. These are the four things that cost '
    + 'Season 1.</small></p>'
    + `<div class="row wrap" style="margin-top:10px">${
      button('Record a soil test', 'open-soiltest', { icon: '🧪' })
    }${button('Log a topsoil delivery', 'open-topsoil', { icon: '🚚' })}</div>`,
    { tight: true },
  );
}

function zoneCard(row) {
  const planted = row.planted
    ? badge('planted', row.ok ? 'ok' : 'danger')
    : badge('empty', 'muted');

  return card(
    cardHead(row.zone.name, planted)
    + (row.planted && !row.ok
      ? note('danger', 'Already planted behind a closed gate',
        '<small>This went in without the checks passing. Treat what is in the ground as at risk and '
        + 'test now, so the next cycle is not the same.</small>')
      : '')
    + row.gates.map(gateRow).join('')
    + (!row.ok
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
        const where = zone ? zone.name : (t.batchId ? `topsoil batch ${t.batchId.slice(-4)}` : 'unknown');
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

// --- Recording the evidence -----------------------------------------------

function openSoilTest(ctx, plotId) {
  const zones = Object.values(ctx.state.plots || {});
  const batches = Object.values(ctx.state.topsoilBatches || {});

  openSheet('<h2>Record a soil test</h2>'
    + '<p><small>A test is about one place on one day. Record it as it came back, including a '
    + 'result you do not like — a bad result recorded now is a cheaper season than a good one '
    + 'assumed.</small></p>'
    + '<form data-act="save-soiltest">'
    + field('Where', select('target', [
      ...zones.map((z) => ({ value: `zone:${z.id}`, label: z.name })),
      ...batches.map((b) => ({ value: `batch:${b.id}`, label: `Topsoil — ${b.supplier || b.id.slice(-4)}` })),
    ], plotId ? `zone:${plotId}` : '', { required: true, placeholder: 'Choose a zone or a topsoil batch' }))
    + field('Date of the test', input('date', { type: 'date', value: isoDate(), required: true }))
    + field('pH', input('ph', { type: 'number', step: '0.1', min: '3', max: '10', placeholder: 'e.g. 6.2' }),
      `Peppers need ${GATE_RULES.phMin} to ${GATE_RULES.phMax}. Leave blank if this was a nematode test only.`)
    + field('Nematode result', select('nematode', [
      { value: '', label: 'Not tested for nematodes' },
      { value: 'clean', label: 'Clean — no nematodes found' },
      { value: 'root-knot detected', label: 'Root-knot nematode found' },
      { value: 'other nematodes detected', label: 'Other nematodes found' },
    ]), 'This is the check Season 1 was lost for.')
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
  if (!data.ph && !data.nematode) { toast('A test needs a pH reading or a nematode result', true); return; }

  const [kind, id] = target.split(':');
  await ctx.store.dispatch('soiltest.record', {
    id: uid('st'),
    zoneId: kind === 'zone' ? id : null,
    batchId: kind === 'batch' ? id : null,
    date: data.date || isoDate(),
    ph: data.ph ? Number(data.ph) : null,
    nematode: data.nematode || null,
    beforeCorrection: !!data.beforeCorrection,
    note: data.note || '',
    enteredAt: new Date().toISOString(),
  });
  closeSheet();
  toast('Soil test recorded');
}

function openTopsoil(ctx) {
  openSheet('<h2>Log a topsoil delivery</h2>'
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
    quantity: data.quantity || '', enteredAt: new Date().toISOString(),
  });
  if (data.zoneId) await ctx.store.dispatch('topsoil.assign', { zoneId: data.zoneId, batchId: id });
  closeSheet();
  toast(data.zoneId ? 'Delivery logged and assigned. Test it before planting.' : 'Delivery logged');
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
