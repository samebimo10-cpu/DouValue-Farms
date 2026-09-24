// The Gates screen — FR-GATE-06, FR-GATE-00, FR-FARM-04/05.
//
// One screen, one zone at a time: Gate 0 to Gate 4 from the rules, each with
// its pass conditions, what the app found for each, and what would clear it.
// GH-04 and GH-05 also show the clean-restart protocol, and the nursery shows
// its seedling batches and the release check, because a released batch is
// what Gate 1 reads for every block.
//
// It is written to be read in the order a person actually needs it: which
// zones are blocked, then for the zone in front of you, what is blocking it
// and the button that records the missing piece. A zone that is fine takes one
// line on the board, because a screen that gives equal space to good news gets
// skimmed.

import {
  badge, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field,
  input, note, openSheet, readForm, select, textarea, toast,
} from './kit.js';
import { can } from '../store.js';
import { peekRules } from '../rules.js';
import {
  canPlant, gateBoard, gateModel, GATE_RULES, GATE_STATE, isBlocking,
} from '../domain/gates.js';
import { confirmOutput, draftCycleReview, gateEvidence } from '../domain/doctor.js';
import { isNursery, zoneTypeLabel } from '../domain/farm.js';
import {
  batchList, CLEAN_MEDIA, growingIn, hygieneRules, releaseCheck, releaseLabels,
} from '../domain/nursery.js';
import { CROP_LIST } from '../domain/crops.js';
import { bindPhoto, photoField, photoPayload, resetPhoto } from './photo.js';
import { requireSupervision, supervisionBanner, supervisionStamp } from './supervise.js';
import { friendlyDate, isoDate, uid } from '../util.js';

let openZone = null;     // which zone the screen is showing
let gateWatch = null;    // UX-27: who is standing over the record being made

const opts = () => ({ today: isoDate(), now: new Date().toISOString() });

export const gatesView = {
  perm: 'viewGuide',        // everyone may see what is blocked; only the Owner may override

  render(ctx) {
    const board = gateBoard(ctx.state, opts()).filter((r) => !r.zone.retired);
    if (!board.length) {
      return card(empty('🚧', 'No zones yet',
        'Add your greenhouses and fields under Zones, and this screen starts checking them.'));
    }
    const blocked = board.filter((r) => !r.ok && !isNursery(r.zone));
    if (!openZone || !board.some((r) => r.zone.id === openZone)) {
      openZone = (blocked[0] || board[0]).zone.id;
    }
    const row = board.find((r) => r.zone.id === openZone);

    return head(ctx, blocked)
      + boardCard(board)
      + (isNursery(row.zone) ? nurseryPanel(ctx, row.zone) : zonePanel(ctx, row))
      + evidence(ctx, row.zone.id);
  },

  actions: {
    'gates-zone': (ctx, el) => { openZone = el.dataset.id; ctx.refresh(); },

    // UX-27: the gate screens are not used alone until the Owner signs off the
    // field trial. Reading them is open to everybody; recording the evidence
    // the gates are decided on is what needs somebody beside you.
    'open-soiltest': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openSoilTest(ctx, el.dataset.plotId || openZone || '', watched);
    },
    'save-soiltest': saveSoilTest,
    'open-topsoil': async (ctx) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openTopsoil(ctx, watched);
    },
    'save-topsoil': saveTopsoil,
    'open-evidence': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openEvidence(ctx, el.dataset, watched);
    },
    'save-evidence': saveEvidence,

    // FR-GATE-00: the Farm Doctor checks; the Farm Manager confirms; the Owner approves.
    'gates-doctor-check': saveDoctorCheck,
    'gates-cycle-review': async (ctx, el) => {
      const draft = draftCycleReview(ctx.state, el.dataset.cycle, { today: isoDate() });
      await ctx.store.dispatch('doctor.record', draft);
      toast('Cycle review drafted. The Farm Manager confirms it, then the Owner approves.');
    },
    'gates-confirm': async (ctx, el) => {
      const output = ctx.state.doctorOutputs.find((o) => o.id === el.dataset.id);
      const verdict = confirmOutput(output, ctx.user);
      if (!verdict.ok) { toast(verdict.why, true); return; }
      await ctx.store.dispatch('doctor.confirm', { id: output.id });
      toast('Confirmed. The Owner approves next.');
    },
    'gates-approve': async (ctx, el) => {
      if (!can(ctx.user, 'manageOwners')) { toast('The Owner approves Gate 0 and Gate 4', true); return; }
      const output = ctx.state.doctorOutputs.find((o) => o.id === el.dataset.id);
      if (!output || !output.confirmedBy) { toast('The Farm Manager confirms it first', true); return; }
      const ok = await confirmSheet('Approve this gate check?',
        'Your approval is what clears the gate (FR-GATE-00). It stays on the record under your name.',
        'Yes, approve');
      if (!ok) return;
      await ctx.store.dispatch('doctor.approve', { id: output.id });
      toast('Approved');
    },

    // FR-FARM-04/05: the nursery.
    'open-sow': (ctx) => openSow(ctx),
    'save-sow': saveSow,
    'open-seedcheck': (ctx, el) => openSeedCheck(ctx, el.dataset.id),
    'save-seedcheck': saveSeedCheck,
    'seed-harden': async (ctx, el) => {
      await ctx.store.dispatch('seedling.harden', { batchId: el.dataset.id, date: isoDate() });
      toast('Hardening started today');
    },
    'open-release': async (ctx, el) => {
      const watched = await requireSupervision(ctx, 'gate');
      if (!watched.ok) return;
      openRelease(ctx, el.dataset.id, watched);
    },
    'save-release': saveRelease,
    'seed-discard': async (ctx, el) => {
      const ok = await confirmSheet('Discard this batch?', 'It stays on the record as discarded.', 'Discard it');
      if (!ok) return;
      await ctx.store.dispatch('seedling.discard', { batchId: el.dataset.id, reason: 'discarded in the nursery' });
      toast('Batch discarded');
    },

    'open-override': (ctx, el) => openOverride(ctx, el.dataset.plotId, el.dataset.gate),
    'save-override': saveOverride,
    'revoke-override': revokeOverride,
  },
};

function head(ctx, blocked) {
  return card(
    cardHead('Gates', blocked.length
      ? badge(`${blocked.length} blocked`, 'danger')
      : badge('all clear', 'ok'))
    + '<p><small>Gate 0 to Gate 4 from the rules, zone by zone. Nothing is transplanted into ground '
    + 'that has not passed Gate 0 and Gate 1, and nothing is sprayed without a confirmed diagnosis '
    + 'behind it. These are the four things that cost Season 1.</small></p>'
    + supervisionBanner(ctx.state, 'gate'),
    { tight: true },
  );
}

const icon = (s) => (GATE_STATE[s] || GATE_STATE.unknown).icon;
const tone = (s) => (GATE_STATE[s] || GATE_STATE.unknown).tone;

/** Every zone, one line each, with a chip per gate. Tap to open it. */
function boardCard(board) {
  return card(
    '<ul class="list">' + board.map((r) => {
      const chips = r.model
        ? r.model.gates.map((g) => badge(`${icon(g.state)} ${g.id}`, tone(g.state))).join(' ')
        : badge('nursery', 'muted');
      const state = isNursery(r.zone) ? '' : r.ok ? badge('clear to plant', 'ok')
        : badge(`${r.blocking.length} to clear`, 'danger');
      return `<li data-act="gates-zone" data-id="${esc(r.zone.id)}"${r.zone.id === openZone ? ' class="on"' : ''}>`
        + `<div class="grow"><b>${esc(r.zone.name)}</b><small>${esc(zoneTypeLabel(r.zone))}`
        + `${r.planted ? ' · planted' : ' · empty'}</small><div>${chips}</div></div>${state}</li>`;
    }).join('') + '</ul>',
  );
}

// --- One zone ---------------------------------------------------------------

function zonePanel(ctx, row) {
  const model = row.model || gateModel(ctx.state, row.zone.id, opts());
  const owner = can(ctx.user, 'manageOwners');
  let out = `<h2 class="section">${esc(row.zone.name)}</h2>`;

  if (row.planted && !row.ok) {
    out += card(note('danger', 'Already planted behind a closed gate',
      '<small>This went in without every transplant condition passing. Treat what is in the ground as '
      + 'at risk and record what is missing now, so the next cycle is not the same.</small>'), { tight: true });
  }

  for (const g of model.gates) {
    out += card(
      cardHead(`${g.id} — ${esc(g.name)}`, badge(`${icon(g.state)} ${(GATE_STATE[g.state] || {}).label || g.state}`, tone(g.state)))
      + `<p><small>${esc(g.when || '')}${g.blocksAction ? ` · stops ${esc(g.blocksAction)}` : ''}`
      + `${g.evidence ? ` · evidence: ${esc(g.evidence)}` : ''}${g.source ? ` · ${esc(g.source)}` : ''}</small></p>`
      + (g.why ? `<p><small>${esc(g.why)}</small></p>` : '')
      + (g.subject && g.id === 'G4' ? `<p><small>About the cycle planted ${esc(g.subject.transplantDate || '?')}`
        + `${g.subject.closedAt ? `, closed ${esc(g.subject.closedAt)}` : ''}.</small></p>` : '')
      + g.conditions.map((c) => conditionRow(c, row.zone.id, g, owner)).join('')
      + gateActions(ctx, g, row, model)
      + (g.note ? `<p><small>${esc(g.note)}</small></p>` : ''),
    );
  }
  return out;
}

function conditionRow(c, zoneId, g, owner) {
  const lines = c.lines && c.lines.length
    ? `<ul>${c.lines.map((l) => `<li><small>${esc(l)}</small></li>`).join('')}</ul>` : '';
  if (c.state === 'pass') {
    return `<p class="gate-row ok"><b>${icon('pass')} ${esc(c.label || c.name)}</b> <small>${esc(c.why)}</small></p>`;
  }
  if (c.state === 'waiting' || c.state === 'na') {
    return `<p class="gate-row"><b>${icon(c.state)} ${esc(c.label || c.name)}</b> <small>${esc(c.why)}</small></p>`;
  }
  if (c.state === 'overridden') {
    return note('warn', `${icon('overridden')} ${c.label || c.name} — overridden`,
      `<small><b>${esc(c.blockedWhy)}</b><br>Reason given: “${esc(c.override.reason)}”<br>`
      + `${button('Put this gate back', 'revoke-override', { cls: 'btn-ghost btn-sm', data: { id: c.override.id } })}`
      + '</small>');
  }
  return note(c.state === 'held' ? 'warn' : 'danger', `${icon(c.state)} ${c.label || c.name}`,
    `<small><b>${esc(c.why)}</b><br>${esc(c.fix || '')}</small>${lines}`
    + (owner && g.blocksTransplant && !c.noOverride
      ? button('Override', 'open-override', { cls: 'btn-ghost btn-sm', data: { plotId: zoneId, gate: c.id } }) : ''));
}

/** The buttons that record what a gate is missing. */
function gateActions(ctx, g, row, model) {
  const zoneId = row.zone.id;
  const btns = [];
  const missing = g.conditions.filter(isBlocking);
  const record = (c, gateId, extra = {}) => button(`Record: ${c.label || c.name}`.slice(0, 60), 'open-evidence', {
    cls: 'btn-ghost btn-block', data: { gate: gateId, item: c.itemId || c.id, zone: zoneId, ...extra } });

  if (g.id === 'G0') {
    if (g.conditions.some((c) => (c.id === 'ph' || c.id === 'nematode') && isBlocking(c))) {
      btns.push(button('Record a soil test', 'open-soiltest', { cls: 'btn-block', icon: '🧪', data: { plotId: zoneId } }));
    }
    btns.push(button('Log a topsoil delivery', 'open-topsoil', { cls: 'btn-ghost btn-block', icon: '🚚' }));
    btns.push(signoffButtons(ctx, g.conditions.find((c) => c.id === 'doctor_check'), zoneId, 'G0'));
  }
  if (g.id === 'CR' || g.id === 'G1') {
    for (const c of missing) {
      if (c.id === 'seedling_release') {
        btns.push('<p><small>Released from the nursery, on the nursery zone\'s own gate screen.</small></p>');
      } else {
        btns.push(record(c, g.id));
      }
    }
  }
  if (g.id === 'G4' && g.subject && g.blocksTransplant) {
    for (const c of missing.filter((x) => x.id !== 'g4_signoff')) btns.push(record(c, 'G4', { cycle: g.subject.cycleId }));
    btns.push(signoffButtons(ctx, g.conditions.find((c) => c.id === 'g4_signoff'), zoneId, 'G4', g.subject.cycleId));
  }
  const html = btns.filter(Boolean).join('');
  return html ? `<div style="margin-top:10px">${html}</div>` : '';
}

/** FR-GATE-00: save the Doctor's check, then confirm, then approve — each by the right person. */
function signoffButtons(ctx, c, zoneId, gateId, cycleId = null) {
  if (!c || c.state === 'pass' || c.state === 'overridden') return '';
  const output = c.from && ctx.state.doctorOutputs.find((o) => o.id === c.from.id);
  if (output && !output.confirmedBy && !/incomplete|does not show/.test(c.why)) {
    return can(ctx.user, 'settings')
      ? button('Confirm the Farm Doctor check', 'gates-confirm', { cls: 'btn-block', data: { id: output.id } })
      : '<p><small>Waiting for the Farm Manager to confirm.</small></p>';
  }
  if (output && output.confirmedBy && !output.approvedBy) {
    return can(ctx.user, 'manageOwners')
      ? button('Approve (Owner)', 'gates-approve', { cls: 'btn-block', data: { id: output.id } })
      : '<p><small>Waiting for the Owner to approve.</small></p>';
  }
  return gateId === 'G0'
    ? button('Run and save the Farm Doctor check', 'gates-doctor-check', { cls: 'btn-block', icon: '🩺', data: { zone: zoneId } })
    : button('Draft the cycle review', 'gates-cycle-review', { cls: 'btn-block', icon: '🩺', data: { cycle: cycleId } });
}

async function saveDoctorCheck(ctx, el) {
  const zoneId = el.dataset.zone;
  const cycle = Object.values(ctx.state.cycles).find((c) => c.plotId === zoneId && c.status === 'active');
  const review = gateEvidence(ctx.state, { zoneId, cycleId: cycle ? cycle.id : null, today: isoDate() });
  await ctx.store.dispatch('doctor.record', review);
  const g0 = review.gates.find((g) => g.id === 'G0');
  const gaps = g0 ? g0.missing.filter((m) => m.id !== 'doctor_check') : [];
  toast(gaps.length
    ? `Saved. Gate 0 still has ${gaps.length} thing${gaps.length === 1 ? '' : 's'} missing, so it cannot be signed off yet.`
    : 'Saved. The Farm Manager confirms it, then the Owner approves.');
}

/** The tests and deliveries the gates are reading, so the verdicts can be checked. */
function evidence(ctx, zoneId) {
  const tests = [...(ctx.state.soilTests || [])].filter((t) => !zoneId || t.zoneId === zoneId || t.batchId)
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const batches = Object.values(ctx.state.topsoilBatches || {});
  if (!tests.length && !batches.length) return '';

  return card(
    cardHead('What the gates are reading')
    + (tests.length
      ? '<ul class="list">' + tests.map((t) => {
        const zone = ctx.state.plots[t.zoneId];
        const where = zone ? zone.name : (t.batchId ? `topsoil batch ${t.batchId.slice(-4)}` : 'unknown');
        const points = Array.isArray(t.readings) && t.readings.length ? ` (${t.readings.join(', ')})` : '';
        return '<li><div class="grow">'
          + `<b>${esc(where)}</b><small>${t.ph != null ? `pH ${esc(t.ph)}${esc(points)}` : 'no pH'}`
          + `${t.calibrated ? ' · meter calibrated' : ''}${t.photo ? ' · photo' : ''}`
          + `${t.nematode ? ` · nematode: ${esc(t.nematode)}` : ''}${t.lab ? ` · ${esc(t.lab)}` : ''}`
          + `${t.beforeCorrection ? ' · taken before liming' : ''}`
          + ` · ${esc(friendlyDate(t.date))}</small></div></li>`;
      }).join('') + '</ul>'
      : '<p><small>No soil tests recorded for this zone yet.</small></p>')
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

function openSoilTest(ctx, plotId, watched = null) {
  gateWatch = watched;
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired && !isNursery(z));
  const batches = Object.values(ctx.state.topsoilBatches || {});
  const rules = (((peekRules() || {}).soil_and_water || {}).soil_ph_gate || {});

  const el = openSheet('<h2>Record a soil test</h2>'
    + (watched && watched.how === 'confirmed'
      ? note('info', `${watched.byName} is confirmed as present`, '') : '')
    + '<p><small>A test is about one place on one day. Record it as it came back, including a '
    + 'result you do not like — a bad result recorded now is a cheaper season than a good one '
    + 'assumed.</small></p>'
    + '<form data-act="save-soiltest">'
    + field('Where', select('target', [
      ...zones.map((z) => ({ value: `zone:${z.id}`, label: z.name })),
      ...batches.map((b) => ({ value: `batch:${b.id}`, label: `Topsoil — ${b.supplier || b.id.slice(-4)}` })),
    ], plotId ? `zone:${plotId}` : '', { required: true, placeholder: 'Choose a zone or a topsoil batch' }))
    + field('Date of the test', input('date', { type: 'date', value: isoDate(), required: true }))
    + '<p><small><b>pH — three points per block (FR-GATE-01).</b> '
    + `${esc(rules.test || '')}</small></p>`
    + '<div class="row wrap">'
    + ['1', '2', '3'].map((n) => input(`ph${n}`, { type: 'number', step: '0.01', min: '3', max: '10', placeholder: `Point ${n}` })).join('')
    + '</div>'
    + `<p><small>Peppers need every point between ${GATE_RULES.phMin} and ${GATE_RULES.phMax}. `
    + `Below ${GATE_RULES.phHoldBelow} or from ${GATE_RULES.phHoldBelow} to 5.49 puts the block on hold. `
    + 'Leave the three blank if this was a nematode test only.</small></p>'
    + '<label class="tick" style="margin:10px 0"><input type="checkbox" name="calibrated" value="1">'
    + '<span class="txt"><b>Meter calibrated this morning at pH 4.0 and 7.0</b></span></label>'
    + photoField('Photo of the meter', 'Gate 0 wants the meter reading photographed.')
    + field('Nematode result', select('nematode', [
      { value: '', label: 'Not tested for nematodes' },
      { value: 'clean', label: 'Clean — no nematodes found' },
      { value: 'root-knot detected', label: 'Root-knot nematode found' },
      { value: 'other nematodes detected', label: 'Other nematodes found' },
    ]), 'This is the check Season 1 was lost for.')
    + field('Lab', input('lab', { placeholder: 'Which lab gave the report' }),
      'Gate 0 asks for a lab report. A clean result with no lab named does not clear it.')
    + '<label class="tick" style="margin:10px 0"><input type="checkbox" name="beforeCorrection" value="1">'
    + '<span class="txt"><b>Taken before liming</b><span class="pid">A reading from before the lime went '
    + 'on does not open the gate</span></span></label>'
    + field('Notes', textarea('note', { rows: 2, placeholder: 'Sample depth, anything unusual' }))
    + '<button class="btn-block btn-lg" type="submit">Save the test</button>'
    + '</form>');
  bindPhoto(el || document);
}

async function saveSoilTest(ctx, form) {
  const data = readForm(form);
  const target = String(data.target || '');
  if (!target) { toast('Say which zone or batch this test is for', true); return; }
  const readings = [data.ph1, data.ph2, data.ph3].filter((v) => v !== '' && v != null).map(Number)
    .filter(Number.isFinite);
  if (!readings.length && !data.nematode) { toast('A test needs pH readings or a nematode result', true); return; }
  if (readings.length && readings.length < 3) { toast('Record all three pH points', true); return; }
  const photo = photoPayload();
  if (readings.length && !photo) { toast('Take the photo of the meter first', true); return; }

  const [kind, id] = target.split(':');
  const mean = readings.length ? Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 100) / 100 : null;
  await ctx.store.dispatch('soiltest.record', {
    id: uid('st'),
    zoneId: kind === 'zone' ? id : null,
    batchId: kind === 'batch' ? id : null,
    date: data.date || isoDate(),
    ph: mean,
    readings: readings.length ? readings : undefined,
    points: readings.length || undefined,
    calibrated: !!data.calibrated,
    photo: photo || undefined,
    nematode: data.nematode || null,
    lab: String(data.lab || '').trim() || null,
    beforeCorrection: !!data.beforeCorrection,
    note: data.note || '',
    supervision: supervisionStamp(gateWatch),
    enteredAt: new Date().toISOString(),
  });
  resetPhoto();
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
      Object.values(ctx.state.plots || {}).filter((z) => !isNursery(z)).map((z) => ({ value: z.id, label: z.name })),
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

/** One line of Gate 1, Gate 4 or a clean-restart step, recorded by whoever did it. */
function openEvidence(ctx, d, watched = null) {
  gateWatch = watched;
  const zone = ctx.state.plots[d.zone];
  const model = gateModel(ctx.state, d.zone, opts());
  const g = model.gates.find((x) => x.id === d.gate);
  const c = g && g.conditions.find((x) => (x.itemId || x.id) === d.item);
  if (!zone || !c) { toast('That line is not on this zone', true); return; }

  const el = openSheet(`<h2>${esc(d.gate)} · ${esc(zone.name)}</h2>`
    + `<p><b>${esc(c.label || c.name)}</b></p>`
    + (c.lines && c.lines.length ? `<ul>${c.lines.map((l) => `<li><small>${esc(l)}</small></li>`).join('')}</ul>` : '')
    + (c.fix ? `<p><small>${esc(c.fix)}</small></p>` : '')
    + '<form data-act="save-evidence">'
    + `<input type="hidden" name="gate" value="${esc(d.gate)}">`
    + `<input type="hidden" name="itemId" value="${esc(d.item)}">`
    + `<input type="hidden" name="zoneId" value="${esc(d.zone)}">`
    + `<input type="hidden" name="cycleId" value="${esc(d.cycle || '')}">`
    + field('Date done', input('date', { type: 'date', value: isoDate(), required: true }))
    + (d.item === 'traps_installed'
      ? field('How many traps are up', input('count', { type: 'number', inputmode: 'numeric', required: true }),
        'One per 6 m² at plant height.') : '')
    + (d.item === 'solarise'
      ? field('Plastic went on', input('coverFrom', { type: 'date', required: true }))
        + field('Plastic lifted', input('coverTo', { type: 'date' }),
          'Leave blank while it is still on. One continuous span of 21 to 28 days; the date above '
          + 'is the day you record this.') : '')
    + (d.item === 'pre_plant_knockdown'
      ? note('warn', 'Within 48 h before transplant',
        '<small>Spray the day before transplant, or the day before that, and keep the doors shut '
        + 'overnight. A knockdown sprayed earlier, or on transplant day, does not count.</small>') : '')
    + (d.item === 'route_b_wait'
      ? field('Lime route used', select('route', [{ value: 'A', label: 'Route A — ag lime' }, { value: 'B', label: 'Route B — hydrated lime' }], 'A'),
        'For Route B, set the date above to the day the hydrated lime went on.') : '')
    + field('What was done', textarea('note', { rows: 2, required: true, placeholder: 'What, where, and anything unusual' }))
    + photoField('Photo', 'Take it at the zone.')
    + '<button class="btn-block btn-lg" type="submit">Record it</button>'
    + '</form>');
  bindPhoto(el || document);
}

async function saveEvidence(ctx, form) {
  const data = readForm(form);
  if (!data.gate || !data.itemId || !data.zoneId) { toast('Say which gate line this is', true); return; }
  if (!String(data.note || '').trim()) { toast('Say what was done', true); return; }
  if (data.itemId === 'solarise' && !data.coverFrom) { toast('Say the day the plastic went on', true); return; }
  if (data.coverFrom && data.coverTo && data.coverTo < data.coverFrom) {
    toast('The plastic cannot come off before it went on', true); return;
  }
  await ctx.store.dispatch('gate.evidence', {
    id: uid('ev'), gate: data.gate, itemId: data.itemId, zoneId: data.zoneId,
    cycleId: data.cycleId || null, date: data.date || isoDate(), note: data.note,
    count: data.count ? Number(data.count) : undefined,
    route: data.route || undefined,
    coverFrom: data.coverFrom || undefined,
    coverTo: data.coverTo || undefined,
    photo: photoPayload() || undefined,
    supervision: supervisionStamp(gateWatch),
  });
  resetPhoto();
  closeSheet();
  toast('Evidence recorded');
}

// --- The nursery (FR-FARM-04, FR-FARM-05) ------------------------------------

function nurseryPanel(ctx, zone) {
  const rules = peekRules();
  const growing = growingIn(ctx.state, zone.id);
  const done = batchList(ctx.state).filter((b) => b.nurseryZoneId === zone.id && b.status !== 'growing')
    .sort((a, b) => ((a.sownDate || '') < (b.sownDate || '') ? 1 : -1)).slice(0, 8);
  const senior = can(ctx.user, 'scout');

  return `<h2 class="section">${esc(zone.name)} — nursery</h2>`
    + card(
      cardHead('Hygiene rules', badge('Build Rules §11e', 'muted'))
      + '<p><small>Not a cropping block: nothing is transplanted here. Seedlings are raised, checked twice a '
      + 'week, and leave only when a batch passes the release check.</small></p>'
      + `<ul>${hygieneRules(rules).map((r) => `<li><small>${esc(r)}</small></li>`).join('')}</ul>`,
    )
    + card(
      cardHead('Seedling batches', badge(`${growing.length} growing`, growing.length ? 'ok' : 'muted'))
      + (senior ? button('Sow a new batch', 'open-sow', { cls: 'btn-block', icon: '🌱' }) : '')
      + (growing.length ? '<ul class="list">' + growing.map((b) => batchRow(ctx, b, senior)).join('') + '</ul>'
        : '<p><small>No batches growing.</small></p>'),
    )
    + (done.length ? card(cardHead('Released and discarded')
      + '<ul class="list">' + done.map((b) => '<li><div class="grow">'
        + `<b>${esc(b.label || b.id)}</b><small>${esc(b.cropId || '')} ${esc(b.variety || '')} · `
        + (b.status === 'released'
          ? `released ${esc(b.release.date)} to ${esc((ctx.state.plots[b.release.zoneId] || {}).name || b.release.zoneId)}`
            + (b.usedByCycleId ? ' · planted' : '')
          : esc(b.discardReason || 'discarded'))
        + '</small></div></li>').join('') + '</ul>') : '');
}

function batchRow(ctx, b, senior) {
  const last = [...(b.checks || [])].sort((x, y) => ((x.date || '') < (y.date || '') ? 1 : -1))[0];
  const found = last ? ['thrips', 'virus', 'dampingOff'].filter((k) => last[k]) : [];
  return '<li><div class="grow">'
    + `<b>${esc(b.label || b.id)}</b><small>${esc(b.cropId || '')} ${esc(b.variety || '')} · sown ${esc(b.sownDate || '?')}`
    + ` · ${esc(b.media || 'media not recorded')}`
    + (b.hardenedFrom ? ` · hardening since ${esc(b.hardenedFrom)}` : '')
    + (last ? ` · last check ${esc(last.date)}${found.length ? ` found ${esc(found.join(', '))}` : ' clean'}` : ' · not checked yet')
    + '</small>'
    + (b.releaseRefused ? note('danger', 'Release refused', `<small>${esc(b.releaseRefused.why)}</small>`) : '')
    + (senior ? '<div class="row wrap">'
      + button('Seedling check', 'open-seedcheck', { cls: 'btn-ghost btn-sm', data: { id: b.id } })
      + (b.hardenedFrom ? '' : button('Start hardening', 'seed-harden', { cls: 'btn-ghost btn-sm', data: { id: b.id } }))
      + (can(ctx.user, 'verifyHarvest') ? button('Release check', 'open-release', { cls: 'btn-sm', data: { id: b.id } }) : '')
      + button('Discard', 'seed-discard', { cls: 'btn-ghost btn-sm', data: { id: b.id } })
      + '</div>' : '')
    + '</div></li>';
}

function openSow(ctx) {
  openSheet('<h2>Sow a seedling batch</h2>'
    + '<form data-act="save-sow">'
    + field('Batch label', input('label', { required: true, placeholder: 'e.g. N-2026-09-A' }),
      'Written on the trays, so the batch can be followed to its block.')
    + field('Crop', select('cropId', CROP_LIST.map((c) => ({ value: c.id, label: c.name })), 'bell'))
    + field('Variety', input('variety', { placeholder: 'e.g. Nikita' }))
    + field('Sown on', input('sownDate', { type: 'date', value: isoDate(), required: true }))
    + field('How many seedlings', input('count', { type: 'number', inputmode: 'numeric' }))
    + field('Media', select('media', CLEAN_MEDIA, 'sterilised'),
      'Clean media only — never raw soil from a cropping block.')
    + '<button class="btn-block btn-lg" type="submit">Save the batch</button>'
    + '</form>');
}

async function saveSow(ctx, form) {
  const data = readForm(form);
  if (!String(data.label || '').trim()) { toast('Give the batch a label', true); return; }
  await ctx.store.dispatch('seedling.sow', {
    id: uid('sb'), label: data.label.trim(), nurseryZoneId: openZone, cropId: data.cropId,
    variety: data.variety || '', sownDate: data.sownDate || isoDate(), count: Number(data.count) || null,
    media: data.media,
  });
  closeSheet();
  toast('Batch sown');
}

function openSeedCheck(ctx, batchId) {
  const b = ctx.state.seedlingBatches[batchId];
  const el = openSheet(`<h2>Seedling check — ${esc(b ? b.label || b.id : '')}</h2>`
    + '<form data-act="save-seedcheck">'
    + `<input type="hidden" name="batchId" value="${esc(batchId)}">`
    + '<p><small>Tick what you <b>found</b>. Leave a box empty only if you looked and it was not there.</small></p>'
    + ['thrips|Thrips on a tap test', 'virus|Virus symptoms (ring/line patterns, mottling)', 'dampingOff|Damping-off (collapsed seedlings)']
      .map((x) => { const [k, l] = x.split('|'); return `<label class="tick"><input type="checkbox" name="${k}" value="1"><span class="txt"><b>${esc(l)}</b></span></label>`; }).join('')
    + field('What you saw', textarea('note', { rows: 2, required: true }))
    + photoField('Photo')
    + '<button class="btn-block btn-lg" type="submit">Record the check</button>'
    + '</form>');
  bindPhoto(el || document);
}

async function saveSeedCheck(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('seedling.check', {
    id: uid('sc'), batchId: data.batchId, date: isoDate(),
    thrips: !!data.thrips, virus: !!data.virus, dampingOff: !!data.dampingOff,
    note: data.note || '', photo: photoPayload() || undefined,
  });
  resetPhoto();
  closeSheet();
  toast(data.virus || data.dampingOff || data.thrips
    ? 'Recorded. This batch cannot be released until a later check is clean.' : 'Recorded');
}

function openRelease(ctx, batchId, watched = null) {
  gateWatch = watched;
  const b = ctx.state.seedlingBatches[batchId];
  const blocks = Object.values(ctx.state.plots || {}).filter((z) => !z.retired && !isNursery(z));
  const preview = releaseCheck(ctx.state, b, { date: isoDate(), zoneId: blocks[0] && blocks[0].id,
    answers: { noVirus: true, noThrips: true, noDampingOff: true }, rules: peekRules() });
  const blockers = preview.items.filter((i) => i.state !== 'have' && ['clean_media', 'hardened', 'no_virus', 'no_thrips', 'no_damping_off'].includes(i.id));

  openSheet(`<h2>Release check — ${esc(b ? b.label || b.id : '')}</h2>`
    + '<p><small>FR-FARM-05: a batch leaves only when every line passes, and it is recorded against '
    + 'the block it goes to. Gate 1 on that block reads this.</small></p>'
    + (blockers.length ? note('danger', 'This batch cannot pass today',
      `<small>${blockers.map((i) => `${esc(i.why)} ${esc(i.fix)}`).join('<br>')}</small>`) : '')
    + '<form data-act="save-release">'
    + `<input type="hidden" name="id" value="${esc(batchId)}">`
    + `<ul>${releaseLabels(peekRules()).map((l) => `<li><small>${esc(l.label)}</small></li>`).join('')}</ul>`
    + ['noVirus|No virus symptoms today (ring/line patterns, mottling)', 'noThrips|No thrips on a tap test today',
      'noDampingOff|No damping-off in the batch']
      .map((x) => { const [k, l] = x.split('|'); return `<label class="tick"><input type="checkbox" name="${k}" value="1"><span class="txt"><b>${esc(l)}</b></span></label>`; }).join('')
    + field('Block it goes to', select('zoneId', blocks.map((z) => ({ value: z.id, label: z.name })), '',
      { required: true, placeholder: 'Choose the block' }))
    + field('Notes', textarea('note', { rows: 2 }))
    + '<button class="btn-block btn-lg" type="submit">Release the batch</button>'
    + '</form>');
}

async function saveRelease(ctx, form) {
  const data = readForm(form);
  if (!data.zoneId) { toast('Name the block the batch goes to', true); return; }
  await ctx.store.dispatch('seedling.release', {
    id: data.id, zoneId: data.zoneId, date: isoDate(), note: data.note || '',
    answers: { noVirus: !!data.noVirus, noThrips: !!data.noThrips, noDampingOff: !!data.noDampingOff },
    supervision: supervisionStamp(gateWatch),
  });
  closeSheet();
  const b = ctx.store.state.seedlingBatches[data.id];
  if (b && b.status === 'released') toast('Released. Gate 1 on that block can now see it.');
  else toast((b && b.releaseRefused && b.releaseRefused.why) || 'Release check not passed', true);
}

// --- Overrides (FR-GATE-07) -----------------------------------------------

function openOverride(ctx, plotId, gateId) {
  if (!can(ctx.user, 'manageOwners')) { toast('Only the Owner can override a gate', true); return; }
  const zone = ctx.state.plots[plotId];
  if (!zone) { toast('That zone is not on record', true); return; }

  const verdict = canPlant(ctx.state, plotId, opts());
  const choices = (verdict.blocking.length ? verdict.blocking : verdict.gates).filter((g) => !g.noOverride);

  openSheet(`<h2>Override a gate on ${esc(zone.name)}</h2>`
    + note('warn', 'This is on your name',
      '<small>The gate stays on the record with what it found, your reason sits beside it, and it '
      + 'appears in the daily digest. Anyone can see later what was decided and why.</small>')
    + '<form data-act="save-override">'
    + `<input type="hidden" name="zoneId" value="${esc(plotId)}">`
    + field('Which condition', select('gate',
      choices.map((g) => ({ value: g.id, label: `${g.gate || ''} ${g.label || g.name} — ${g.why}` })),
      gateId || '', { required: true, placeholder: 'Choose the condition' }))
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
