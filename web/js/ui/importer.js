// Bringing existing records in — the screen for domain/importer.js.
//
// The Owner's decision of 18 October 2026: from a spreadsheet, from paper
// reports, and from sheets filled in by hand. Every way in goes through the
// same steps: match the columns, check every row, see it before it is saved,
// confirm, keep the report, and undo the whole import if it was wrong.

import {
  badge, button, card, cardHead, closeSheet, confirmSheet, empty, esc, field, input, note, openSheet,
  readForm, select, table, textarea, toast,
} from './kit.js';
import { params } from './shell.js';
import {
  checkRows, historyRows, IMPORT_KINDS, IMPORT_SOURCES, importEvents, importReportCsv, importsList,
  parseTable, suggestMapping, templateCsv,
} from '../domain/importer.js';
import { can } from '../store.js';
import { getMeta, setMeta } from '../db.js';
import { isoDate, uid } from '../util.js';

const DRAFT_KEY = 'importTyped';
const SHOWN_ROWS = 300;
/** One landscape page of rows tall enough to write in. */
export const SHEET_ROWS = 14;
let draft = fresh();

function fresh() {
  return { step: 'start', kind: 'harvest', source: null, headers: [], rows: [], mapping: {},
    check: null, includeDuplicates: false, fileName: null, result: null };
}

const kindsFor = (user) => Object.entries(IMPORT_KINDS).filter(([, k]) => can(user, k.perm));
const fieldsOf = (kind) => IMPORT_KINDS[kind].fields;

export const importView = {
  perm: 'settings',

  render(ctx) {
    if (!kindsFor(ctx.user).some(([k]) => k === draft.kind)) draft.kind = (kindsFor(ctx.user)[0] || ['harvest'])[0];
    const body = {
      start: startStep, spreadsheet: spreadsheetStep, typed: typedStep, map: mapStep, preview: previewStep, done: doneStep,
    }[draft.step] || startStep;
    return body(ctx) + (draft.step === 'start' ? pastImports(ctx) : '');
  },

  async mounted() {
    // UX-16: rows typed in from a paper book survive the app being closed.
    if (draft.step === 'typed' && !draft.rows.length) {
      const saved = await getMeta(DRAFT_KEY, null);
      if (saved && saved.kind === draft.kind && saved.source === draft.source && saved.rows.length) {
        draft.rows = saved.rows;
        const host = document.getElementById('typed-rows');
        if (host) host.innerHTML = typedRowsTable();
      }
    }
  },

  actions: {
    'imp-kind': (ctx, el) => { draft.kind = el.dataset.kind; ctx.refresh(); },
    'imp-spreadsheet': (ctx) => { draft = { ...fresh(), kind: draft.kind, source: 'spreadsheet', step: 'spreadsheet' }; ctx.refresh(); },
    'imp-typed': (ctx, el) => {
      draft = { ...fresh(), kind: draft.kind, source: el.dataset.source, step: 'typed' };
      draft.headers = fieldsOf(draft.kind).map((f) => f.label);
      draft.mapping = Object.fromEntries(fieldsOf(draft.kind).map((f, i) => [f.key, i]));
      ctx.refresh();
    },
    'imp-template': () => download(`douvalue-${draft.kind}-template.csv`, templateCsv(draft.kind), 'text/csv'),
    'imp-restart': (ctx) => { draft = { ...fresh(), kind: draft.kind }; ctx.refresh(); },
    'imp-back-map': (ctx) => { draft.step = draft.source === 'spreadsheet' ? 'map' : 'typed'; ctx.refresh(); },

    'imp-read': async (ctx) => {
      const fileEl = document.getElementById('imp-file');
      const file = fileEl && fileEl.files && fileEl.files[0];
      let text = '';
      if (file) {
        if (/\.xlsx?$/i.test(file.name)) {
          toast('Save the spreadsheet as CSV first, or copy the cells and paste them here', true);
          return;
        }
        text = await file.text();
        draft.fileName = file.name;
      } else {
        text = (document.querySelector('textarea[name="pasted"]') || {}).value || '';
        draft.fileName = null;
      }
      const table = parseTable(text);
      if (!table.headers.length || !table.rows.length) {
        toast('Nothing to read. The first line should be the column headings, then one line per record.', true);
        return;
      }
      draft.headers = table.headers;
      draft.rows = table.rows;
      draft.mapping = suggestMapping(table.headers, draft.kind);
      draft.step = 'map';
      ctx.refresh();
    },

    'imp-map': (ctx, form) => {
      const data = readForm(form);
      draft.mapping = Object.fromEntries(fieldsOf(draft.kind)
        .map((f) => [f.key, data[`col_${f.key}`] === '' || data[`col_${f.key}`] == null ? null : Number(data[`col_${f.key}`])]));
      const missing = fieldsOf(draft.kind).filter((f) => f.need && draft.mapping[f.key] == null);
      if (missing.length) { toast(`Choose the column for ${missing.map((f) => f.label).join(', ')}`, true); return; }
      runCheck(ctx);
    },

    'imp-add-row': async (ctx, form) => {
      const data = readForm(form);
      const row = fieldsOf(draft.kind).map((f) => String(data[`f_${f.key}`] ?? '').trim());
      if (row.every((c) => !c)) { toast('That row is empty', true); return; }
      draft.rows.push(row);
      await saveTypedDraft();
      form.reset();
      ctx.refresh();
      toast(`Row ${draft.rows.length} added — check them all before importing`);
    },
    'imp-remove-row': async (ctx, el) => {
      draft.rows.splice(Number(el.dataset.i), 1);
      await saveTypedDraft();
      ctx.refresh();
    },
    'imp-check-typed': (ctx) => {
      if (!draft.rows.length) { toast('Add at least one row first', true); return; }
      runCheck(ctx);
    },

    'imp-dups': (ctx) => { draft.includeDuplicates = !draft.includeDuplicates; ctx.refresh(); },

    'imp-confirm': async (ctx) => {
      const c = draft.check;
      const leaving = c.error + (draft.includeDuplicates ? 0 : c.rows.filter((r) => r.status !== 'error' && r.duplicate).length);
      const going = c.rows.length - leaving;
      if (!going) { toast('No rows to import', true); return; }
      const ok = await confirmSheet(`Import ${going} row${going === 1 ? '' : 's'}?`,
        `${IMPORT_KINDS[draft.kind].label} · ${IMPORT_SOURCES[draft.source]}`
        + (draft.fileName ? ` · ${draft.fileName}` : '') + '. '
        + (leaving ? `${leaving} row${leaving === 1 ? '' : 's'} left out (shown in the report). ` : '')
        + 'They are kept as history, apart from what the app records live. You can undo the whole import later.',
        'Import');
      if (!ok) return;
      const importId = uid('imp');
      const list = importEvents(c, {
        kind: draft.kind, importId, source: draft.source, fileName: draft.fileName,
        includeDuplicates: draft.includeDuplicates, today: isoDate(),
      });
      await ctx.store.dispatchMany(list.map(({ type, payload, eventId }) => ({ type, payload, eventId })));
      if (draft.source !== 'spreadsheet') await setMeta(DRAFT_KEY, null);
      draft.result = { importId, imported: list.length - 1, left: leaving };
      draft.step = 'done';
      ctx.refresh();
      toast(`Imported ${list.length - 1} rows`);
    },

    'imp-report': () => download(`douvalue-import-report-${isoDate()}.csv`,
      importReportCsv(draft.check, { includeDuplicates: draft.includeDuplicates }), 'text/csv'),

    'imp-undo': (ctx, el) => {
      openSheet('<h2>Undo this import?</h2>'
        + '<p><small>Every row it brought in is taken out of the history and the reports. Nothing is deleted: '
        + 'the rows stay in the farm\'s log, marked as undone, with your reason.</small></p>'
        + `<form data-act="imp-undo-save" data-id="${esc(el.dataset.id)}">`
        + field('Why', input('reason', { required: true, placeholder: 'e.g. wrong file, wrong year' }))
        + '<button class="btn-block btn-lg btn-danger" type="submit">Undo the import</button></form>');
    },
    'imp-undo-save': async (ctx, form) => {
      const reason = String(readForm(form).reason || '').trim();
      if (reason.length < 4) { toast('Say why it is being undone', true); return; }
      await ctx.store.dispatch('import.revert', { id: form.dataset.id, reason });
      closeSheet();
      ctx.refresh();
      toast('Import undone');
    },
  },
};

function runCheck(ctx) {
  draft.check = checkRows(draft.rows, draft.mapping, draft.kind, ctx.state, { today: isoDate() });
  draft.step = 'preview';
  ctx.refresh();
}

async function saveTypedDraft() {
  await setMeta(DRAFT_KEY, { kind: draft.kind, source: draft.source, rows: draft.rows });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --- Steps ---------------------------------------------------------------------

function kindChips(ctx) {
  return '<div class="row wrap">' + kindsFor(ctx.user).map(([k, spec]) =>
    `<button type="button" class="chip ${draft.kind === k ? 'on' : ''}" data-act="imp-kind" data-kind="${esc(k)}">`
    + `${esc(spec.label)}</button>`).join(' ') + '</div>';
}

function startStep(ctx) {
  return card(cardHead('Bring in existing records')
    + '<p><small>Harvests, sales and expenses from before the app, kept as history: they show in the '
    + 'farm\'s history and reports, never as live work, and they never change a gate or a waiting period. '
    + 'Spray history goes in through Setup instead, where the rotation and waiting periods read it.</small></p>'
    + '<h3>1. What are you bringing in?</h3>' + kindChips(ctx)
    + '<h3 style="margin-top:14px">2. Where is it?</h3>'
    + button('From a spreadsheet', 'imp-spreadsheet', { cls: 'btn-block', icon: '📊' })
    + '<p><small>A .csv file, or the cells copied out of Excel or Google Sheets and pasted.</small></p>'
    + button('Type in from a paper report', 'imp-typed', { cls: 'btn-block btn-ghost', icon: '📒', data: { source: 'paper' } })
    + button('Type in from a hand-filled sheet', 'imp-typed', { cls: 'btn-block btn-ghost', icon: '✍️', data: { source: 'handfilled' } })
    + '<h3 style="margin-top:14px">Blank sheets</h3>'
    + '<p><small>For records kept by hand from now on: print the sheet, fill it in the field, and type it in '
    + 'here, or fill the spreadsheet template on a computer and bring the file in.</small></p>'
    + '<div class="row wrap">'
    + `<a class="btn btn-ghost" href="#/import/sheet?kind=${esc(draft.kind)}">🖨️ Print a blank sheet</a>`
    + button('Spreadsheet template', 'imp-template', { cls: 'btn-ghost', icon: '⬇️' })
    + '</div>');
}

function spreadsheetStep() {
  return card(cardHead(`${IMPORT_KINDS[draft.kind].label}: from a spreadsheet`)
    + note('info', 'The first line must be the column headings',
      '<small>Then one line per record. An Excel file (.xlsx): save it as CSV first, or select the cells '
      + 'including the headings, copy, and paste them below. Dates day first: 14/03/2026.</small>')
    + field('A .csv file', '<input type="file" id="imp-file" accept=".csv,.txt,.tsv,text/csv,text/plain">')
    + field('Or paste the cells here', textarea('pasted', { rows: 8, placeholder: 'Date\tHouse\tKg\n14/03/2026\tGH-01\t42' }))
    + '<div class="row wrap">' + button('Read it', 'imp-read', { icon: '➡️' })
    + button('Back', 'imp-restart', { cls: 'btn-ghost' }) + '</div>');
}

function typedRowsTable() {
  if (!draft.rows.length) return '<p><small>No rows yet.</small></p>';
  const fields = fieldsOf(draft.kind);
  return table(['#', ...fields.map((f) => f.label), ''], draft.rows.map((r, i) => [
    String(i + 1), ...r,
    { __raw: button('✕', 'imp-remove-row', { cls: 'btn-quiet btn-sm', data: { i } }) },
  ]));
}

function typedStep(ctx) {
  const zones = Object.values(ctx.state.plots || {}).filter((z) => !z.retired)
    .map((z) => ({ value: z.name || z.id, label: z.name || z.id }));
  const control = (f) => {
    if (f.type === 'zone') return select(`f_${f.key}`, zones, '', { placeholder: '— not written on the sheet —' });
    if (f.type === 'paid') {
      return select(`f_${f.key}`, [{ value: 'paid', label: 'Paid' }, { value: 'not paid', label: 'Not paid' },
        { value: 'part paid', label: 'Part paid' }], '', { placeholder: '— not written —' });
    }
    if (f.type === 'date') return input(`f_${f.key}`, { type: 'date', max: isoDate() });
    if (f.type === 'number') return input(`f_${f.key}`, { inputmode: 'decimal', placeholder: f.need ? '' : 'leave empty if not written' });
    return input(`f_${f.key}`, { placeholder: f.need ? '' : 'leave empty if not written' });
  };
  return card(cardHead(`${IMPORT_KINDS[draft.kind].label}: ${IMPORT_SOURCES[draft.source]}`)
    + '<p><small>One line of the paper at a time. Type what is written and nothing more: '
    + 'a box left empty on paper stays empty here. Rows are kept on this phone until you import them.</small></p>'
    + '<form data-act="imp-add-row">'
    + fieldsOf(draft.kind).map((f) => field(f.label + (f.need ? ' *' : ''), control(f))).join('')
    + '<button class="btn-block" type="submit">Add this row</button></form>')
    + card(cardHead(`Rows so far: ${draft.rows.length}`) + `<div id="typed-rows">${typedRowsTable()}</div>`
      + '<div class="row wrap" style="margin-top:10px">'
      + button('Check these rows', 'imp-check-typed', { icon: '➡️' })
      + button('Back', 'imp-restart', { cls: 'btn-ghost' }) + '</div>');
}

function mapStep() {
  const cols = draft.headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }));
  const sample = draft.rows.slice(0, 3);
  return card(cardHead('Match the columns')
    + `<p><small>${draft.rows.length} rows read${draft.fileName ? ` from ${esc(draft.fileName)}` : ''}. `
    + 'The app has guessed which column is which; check every one. A field your sheet does not have stays '
    + 'empty — it is never filled in for you.</small></p>'
    + '<form data-act="imp-map">'
    + fieldsOf(draft.kind).map((f) => field(f.label + (f.need ? ' *' : ''),
      select(`col_${f.key}`, cols, draft.mapping[f.key] ?? '', { placeholder: '— not in this sheet —' }))).join('')
    + '<h3>The first rows, as read</h3>'
    + table(draft.headers.map((h, i) => h || `Column ${i + 1}`), sample)
    + '<div class="row wrap" style="margin-top:10px"><button type="submit">Check the rows</button>'
    + button('Start again', 'imp-restart', { cls: 'btn-ghost' }) + '</div></form>');
}

const STATUS = { ok: badge('✓ ok', 'ok'), warn: badge('! check', 'warn'), error: badge('✕ not imported', 'danger') };

function summary(kind, v) {
  if (kind === 'harvest') return [v.date, v.zoneText || '—', v.kg != null ? `${v.kg} kg` : '', v.crates != null ? `${v.crates} crates` : '', v.grade || ''].filter(Boolean).join(' · ');
  if (kind === 'sale') return [v.date, v.buyer, v.kg != null ? `${v.kg} kg` : '', v.crates != null ? `${v.crates} crates` : '', v.total != null ? `₦${v.total.toLocaleString('en-NG')}` : v.pricePerKg != null ? `₦${v.pricePerKg}/kg` : ''].filter(Boolean).join(' · ');
  return [v.date, v.item, v.amount != null ? `₦${v.amount.toLocaleString('en-NG')}` : ''].filter(Boolean).join(' · ');
}

function previewStep() {
  const c = draft.check;
  const dups = c.rows.filter((r) => r.status !== 'error' && r.duplicate).length;
  const going = c.rows.length - c.error - (draft.includeDuplicates ? 0 : dups);
  const shown = c.rows.slice(0, SHOWN_ROWS);
  return card(cardHead('Check before importing')
    + `<p><b>${c.ok}</b> ready · <b>${c.warn}</b> to check · <b>${c.error}</b> with problems · `
    + `<b>${dups}</b> possible duplicate${dups === 1 ? '' : 's'}</p>`
    + (c.error ? note('warn', `${c.error} row${c.error === 1 ? '' : 's'} will not be imported`,
      '<small>Each says why below. Fix them in the sheet and bring it in again, or go back and change the columns.</small>') : '')
    + (dups ? '<p><small>Possible duplicates are left out unless you say otherwise.</small></p>'
      + button(draft.includeDuplicates ? '☑ Possible duplicates: importing them' : '☐ Possible duplicates: leaving them out',
        'imp-dups', { cls: 'btn-ghost btn-block' }) : '')
    // A list, not a table: at 360 px a table hides the "why" off to the right.
    + '<ul class="import-rows" style="list-style:none;padding:0;margin:12px 0">' + shown.map((r) => {
      const why = [...r.problems, ...r.warnings];
      return '<li style="padding:10px 0;border-top:1px solid var(--line)">'
        + `<div class="row" style="justify-content:space-between"><b>Line ${r.line}</b>${STATUS[r.status]}</div>`
        + `<div>${esc(summary(draft.kind, r.values) || '—')}</div>`
        + (why.length ? `<div><small>${why.map(esc).join('<br>')}</small></div>` : '')
        + '</li>';
    }).join('') + '</ul>'
    + (c.rows.length > SHOWN_ROWS ? `<p><small>The first ${SHOWN_ROWS} of ${c.rows.length} rows are shown; the report lists every one.</small></p>` : '')
    + '<div class="row wrap" style="margin-top:10px">'
    + button(`Import ${going} row${going === 1 ? '' : 's'}`, 'imp-confirm', { icon: '✓' })
    + button('Download the report', 'imp-report', { cls: 'btn-ghost', icon: '⬇️' })
    + button('Back', 'imp-back-map', { cls: 'btn-ghost' }) + '</div>');
}

function doneStep() {
  const r = draft.result;
  return card(cardHead('Imported')
    + note('ok', `${r.imported} row${r.imported === 1 ? '' : 's'} brought in as history`,
      `<small>${r.left ? `${r.left} left out — the report says why. ` : ''}`
      + 'They reach the farm server on the next sync. If this was the wrong file, undo it below.</small>')
    + '<div class="row wrap">'
    + button('Download the report', 'imp-report', { icon: '⬇️' })
    + button('Bring in more', 'imp-restart', { cls: 'btn-ghost' }) + '</div>');
}

function pastImports(ctx) {
  const list = importsList(ctx.state).filter((i) => can(ctx.user, (IMPORT_KINDS[i.kind] || {}).perm || 'settings'));
  if (!list.length) return '';
  const people = ctx.state.people || {};
  return card(cardHead('Past imports')
    + table(['Date', 'What', 'From', 'Rows', ''], list.map((i) => [
      i.importedOn || String(i.at || '').slice(0, 10),
      (IMPORT_KINDS[i.kind] || {}).label || i.kind,
      `${IMPORT_SOURCES[i.source] || i.source}${i.fileName ? ` · ${i.fileName}` : ''} · ${(people[i.by] || {}).name || i.by}`,
      i.reverted ? `undone: ${i.revertReason || ''}` : `${historyRows(ctx.state, i.kind).filter((x) => x.importId === i.id).length}`,
      i.reverted ? '' : { __raw: button('Undo', 'imp-undo', { cls: 'btn-quiet btn-sm', data: { id: i.id } }) },
    ])));
}

// --- The blank sheet, to print and fill in by hand -------------------------------

export const importSheetView = {
  perm: 'settings',
  render(ctx) {
    const kind = IMPORT_KINDS[params().kind] ? params().kind : 'harvest';
    const fields = fieldsOf(kind);
    const blank = Array.from({ length: SHEET_ROWS }, () => fields.map(() => ''));
    return '<div class="print-head"><b>' + esc(ctx.state.settings.farmName || 'DouValue Farms') + '</b></div>'
      + card(cardHead(`${IMPORT_KINDS[kind].label} — record sheet`)
        + '<p><small>Write dates day first (14/03/2026). Leave a box empty if you do not know it — do not guess. '
        + 'Type it into the app under Setup → Bring in existing records → Type in from a hand-filled sheet.</small></p>'
        + '<p><small>Filled in by: ____________________ &nbsp; Checked by: ____________________</small></p>'
        + `<div class="import-sheet">${table(fields.map((f) => f.label), blank)}</div>`
        + `<div class="row wrap no-print" style="margin-top:12px">`
        + button('Print', 'imp-print', { icon: '🖨️' })
        + `<a class="btn btn-ghost" href="#/import">Back</a></div>`, { cls: 'import-sheet-card' })
      + (kindsFor(ctx.user).length ? '' : card(empty('🔒', 'Not for this account')));
  },
  actions: { 'imp-print': () => window.print() },
};
