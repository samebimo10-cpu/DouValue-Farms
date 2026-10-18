// Bringing the farm's existing records in — Phase 2 of the roadmap, and the
// Owner's decision of 18 October 2026: "The import should be from
// spreadsheet, normal paper reports and can also be hand-filled."
//
// Three ways in, one path through:
//
//   * a spreadsheet — a .csv file, or cells copied out of Excel or Google
//     Sheets and pasted (they arrive tab-separated);
//   * a paper report, typed in row by row;
//   * a blank sheet printed from here, filled in by hand in the field, then
//     typed in the same way.
//
// Whatever the source, every row goes through the same steps: its columns are
// matched to the app's fields, every row is checked and shown before anything
// is saved, possible duplicates are set aside unless the person says
// otherwise, nothing is saved until they confirm, the import is reported, and
// a whole import can be undone.
//
// What comes in is history, and is kept apart from what the app records live
// (FR-ONB-03): its own record types (history.harvest, history.sale,
// history.expense), marked with the import and where it came from. It never
// becomes a live harvest, spray or treatment, so it cannot be used to get
// round a gate, a waiting period or a rotation, and the record checks do not
// read twenty months of paper books as "late entry". Spray history is not
// imported here at all: it goes through Setup, where the rotation and the
// pre-harvest interval read it (FR-ONB-04).
//
// Unknown stays unknown. An empty cell is not a zero, a missing grade is not
// grade A, and a date that cannot be read is an error, not today.

import { isoDate } from '../util.js';

/** What can be imported, and the fields of each. `need` is required; `oneOf` needs at least one of the group. */
export const IMPORT_KINDS = {
  harvest: {
    label: 'Harvest history',
    record: 'history.harvest',
    perm: 'settings',
    fields: [
      { key: 'date', label: 'Date', need: true, type: 'date', aliases: ['date', 'day', 'harvest date', 'picked on', 'date picked'] },
      { key: 'zone', label: 'Zone', type: 'zone', aliases: ['zone', 'house', 'greenhouse', 'gh', 'bed', 'field', 'block', 'plot'] },
      { key: 'kg', label: 'Kilograms', type: 'number', oneOf: 'amount', aliases: ['kg', 'kgs', 'kilograms', 'weight', 'weight kg', 'quantity kg', 'qty kg'] },
      { key: 'crates', label: 'Crates', type: 'number', oneOf: 'amount', aliases: ['crates', 'crate', 'baskets', 'no of crates', 'number of crates'] },
      { key: 'grade', label: 'Grade', type: 'text', aliases: ['grade', 'quality', 'class'] },
      { key: 'crop', label: 'Crop', type: 'text', aliases: ['crop', 'variety', 'pepper', 'type'] },
      { key: 'picker', label: 'Picked by', type: 'text', aliases: ['picker', 'picked by', 'worker', 'name', 'staff'] },
      { key: 'note', label: 'Notes', type: 'text', aliases: ['note', 'notes', 'remark', 'remarks', 'comment', 'comments'] },
    ],
  },
  sale: {
    label: 'Sales history',
    record: 'history.sale',
    perm: 'manageMoney',
    fields: [
      { key: 'date', label: 'Date', need: true, type: 'date', aliases: ['date', 'day', 'sale date', 'date sold'] },
      { key: 'buyer', label: 'Buyer', need: true, type: 'text', aliases: ['buyer', 'customer', 'sold to', 'client', 'name'] },
      { key: 'kg', label: 'Kilograms', type: 'number', oneOf: 'amount', aliases: ['kg', 'kgs', 'kilograms', 'weight', 'quantity', 'qty', 'quantity kg'] },
      { key: 'crates', label: 'Crates', type: 'number', oneOf: 'amount', aliases: ['crates', 'crate', 'baskets'] },
      { key: 'pricePerKg', label: 'Price per kg (₦)', type: 'number', oneOf: 'money', aliases: ['price per kg', 'price/kg', 'unit price', 'rate', 'price'] },
      { key: 'total', label: 'Total (₦)', type: 'number', oneOf: 'money', aliases: ['total', 'amount', 'value', 'total amount', 'naira', 'total naira'] },
      { key: 'paid', label: 'Paid?', type: 'paid', aliases: ['paid', 'payment', 'payment status', 'status'] },
      { key: 'grade', label: 'Grade', type: 'text', aliases: ['grade', 'quality'] },
      { key: 'zone', label: 'Zone', type: 'zone', aliases: ['zone', 'house', 'greenhouse', 'bed', 'field'] },
      { key: 'note', label: 'Notes', type: 'text', aliases: ['note', 'notes', 'remark', 'remarks', 'comment'] },
    ],
  },
  expense: {
    label: 'Expenses history',
    record: 'history.expense',
    perm: 'manageMoney',
    fields: [
      { key: 'date', label: 'Date', need: true, type: 'date', aliases: ['date', 'day', 'date paid'] },
      { key: 'item', label: 'What it was for', need: true, type: 'text', aliases: ['item', 'description', 'details', 'for', 'what', 'expense', 'particulars', 'narration'] },
      { key: 'amount', label: 'Amount (₦)', need: true, type: 'number', aliases: ['amount', 'cost', 'total', 'naira', 'value', 'paid'] },
      { key: 'category', label: 'Category', type: 'text', aliases: ['category', 'type', 'head', 'account'] },
      { key: 'supplier', label: 'Supplier', type: 'text', aliases: ['supplier', 'vendor', 'paid to', 'seller'] },
      { key: 'zone', label: 'Zone', type: 'zone', aliases: ['zone', 'house', 'greenhouse', 'bed', 'field'] },
      { key: 'note', label: 'Notes', type: 'text', aliases: ['note', 'notes', 'remark', 'remarks', 'comment'] },
    ],
  },
};

/** Where a row came from. Kept on every record, so a figure can always be traced to its book. */
export const IMPORT_SOURCES = {
  spreadsheet: 'Spreadsheet',
  paper: 'Paper report, typed in',
  handfilled: 'Hand-filled sheet, typed in',
};

// --- Reading a table ---------------------------------------------------------

/**
 * A table out of text: a .csv file, or cells pasted from a spreadsheet (tabs).
 * Quoted cells may hold the separator, doubled quotes and line breaks. Blank
 * lines are dropped. Returns { headers, rows } with rows as arrays of strings.
 */
export function parseTable(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n').find((l) => l.trim()) || '';
  const counts = { '\t': 0, ',': 0, ';': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const sep = counts['\t'] ? '\t' : counts[';'] > counts[','] ? ';' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { cell = ''; inQuotes = true; }
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  const kept = rows.filter((r) => r.some((c) => c !== ''));
  const [headers = [], ...body] = kept;
  return { headers: headers.map((h) => String(h)), rows: body };
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();

/**
 * Which column holds which field, guessed from the headings. The person sees
 * the guess and can change every one of it before anything is checked.
 * Returns { fieldKey: columnIndex | null }.
 */
export function suggestMapping(headers, kind) {
  const spec = IMPORT_KINDS[kind];
  const taken = new Set();
  const out = {};
  const heads = headers.map(squash);
  for (const f of spec.fields) {
    let hit = null;
    for (const alias of f.aliases) {
      const i = heads.findIndex((h, n) => !taken.has(n) && h === squash(alias));
      if (i >= 0) { hit = i; break; }
    }
    if (hit == null) {
      for (const alias of f.aliases) {
        const a = squash(alias);
        if (a.length < 3) continue;
        const i = heads.findIndex((h, n) => !taken.has(n) && h.includes(a));
        if (i >= 0) { hit = i; break; }
      }
    }
    if (hit != null) taken.add(hit);
    out[f.key] = hit;
  }
  return out;
}

// --- Reading one cell -------------------------------------------------------

/**
 * A day, from what Nigerian farm books and spreadsheets actually hold:
 * 2026-03-14, 14/03/2026, 14-3-26, 14.03.2026, 14 Mar 2026, March 14 2026,
 * or a spreadsheet's own day number (45730). Day before month, as written in
 * Nigeria; a date that cannot be one (31/02) is refused rather than guessed.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function readDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  const ok = (y, m, d) => {
    const year = y < 100 ? 2000 + y : y;
    const t = new Date(Date.UTC(year, m - 1, d));
    if (t.getUTCFullYear() !== year || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
      return { error: `"${s}" is not a real date` };
    }
    return { value: t.toISOString().slice(0, 10) };
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,})\.?,?[\s-]+(\d{2}|\d{4})$/);
  if (m && MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) >= 0) {
    return ok(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) >= 0) {
    return ok(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  }
  if (/^\d{5}$/.test(s) && +s > 30000 && +s < 60000) {
    // A spreadsheet's day number: days since 30 December 1899.
    return { value: new Date(Date.UTC(1899, 11, 30) + +s * 86400000).toISOString().slice(0, 10) };
  }
  return { error: `"${s}" is not a date the app can read. Write it like 14/03/2026` };
}

/** A number as people write one: 1,200 · ₦45,000 · 12.5kg · N3500. Empty is unknown, not zero. */
export function readNumber(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  const cleaned = s.replace(/[₦\s,]/g, '').replace(/^(ngn|n)(?=\d)/i, '').replace(/(kg|kgs|crates?)$/i, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { error: `"${s}" is not a number` };
  const n = Number(cleaned);
  if (n < 0) return { error: `"${s}" is less than nothing` };
  return { value: n };
}

/** Paid, not paid, part paid — or unknown. */
export function readPaid(raw) {
  const s = squash(raw);
  if (!s) return { value: null };
  if (['yes', 'y', 'paid', 'full', 'fully paid', 'cash', 'done'].includes(s)) return { value: 'paid' };
  if (['no', 'n', 'unpaid', 'not paid', 'owing', 'credit', 'debt', 'pending'].includes(s)) return { value: 'unpaid' };
  if (['part', 'part paid', 'partly paid', 'partial', 'deposit', 'balance'].includes(s)) return { value: 'part' };
  return { error: `"${raw}" — write paid, not paid or part paid` };
}

/** "GH-01", "gh1", "GH 01", "Greenhouse 1" and the zone's own name all find GH-01. */
const zoneKey = (s) => {
  const t = String(s || '').toLowerCase().replace(/greenhouse/g, 'gh').replace(/[^a-z0-9]+/g, '');
  return t.replace(/([a-z]+)0*(\d+)$/, '$1$2');
};
export function findZone(state, raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  const want = zoneKey(s);
  const zones = Object.values((state && state.plots) || {});
  const hit = zones.find((z) => zoneKey(z.id) === want || zoneKey(z.name) === want || zoneKey(z.code) === want);
  if (hit) return { value: hit.id };
  return { error: `No zone called "${s}" on this farm` };
}

// --- Checking every row -------------------------------------------------------

/** What makes two rows the same record, per kind. */
function dupKey(kind, r) {
  if (kind === 'harvest') return ['h', r.date, r.zoneId || '', r.kg ?? '', r.crates ?? ''].join('|');
  if (kind === 'sale') return ['s', r.date, squash(r.buyer), r.kg ?? '', r.crates ?? '', r.total ?? r.pricePerKg ?? ''].join('|');
  return ['e', r.date, r.amount ?? '', squash(r.item)].join('|');
}

/** Keys of what the farm already holds, live and imported, for spotting duplicates. */
function heldKeys(state, kind) {
  const keys = new Set();
  for (const r of historyRows(state, kind)) keys.add(dupKey(kind, r));
  const live = kind === 'harvest' ? (state.harvests || []).map((h) => ({
    date: h.date, zoneId: (state.cycles[h.cycleId] || {}).plotId || h.zoneId || null, kg: h.kg ?? null, crates: h.crates ?? null,
  })) : kind === 'sale' ? (state.sales || []).map((x) => ({
    date: x.date, buyer: x.buyer, kg: x.kg ?? null, crates: x.crates ?? null, total: x.total ?? x.amount ?? null,
  })) : (state.expenses || []).map((x) => ({ date: x.date, amount: x.amount ?? null, item: x.item || x.description || x.note }));
  for (const r of live) keys.add(dupKey(kind, r));
  return keys;
}

/**
 * Check every row against the mapping. Returns one entry per row:
 * { line, values, problems: [..], warnings: [..], status: 'ok'|'warn'|'error', duplicate }
 * and totals. `line` is the row's number as the person sees it in their sheet
 * (the heading is line 1).
 */
export function checkRows(rows, mapping, kind, state, { today = isoDate() } = {}) {
  const spec = IMPORT_KINDS[kind];
  const held = heldKeys(state || {}, kind);
  const seen = new Map();
  const out = rows.map((cells, i) => {
    const values = {};
    const problems = [];
    const warnings = [];
    for (const f of spec.fields) {
      const col = mapping[f.key];
      const raw = col == null ? '' : String(cells[col] ?? '').trim();
      let read;
      if (f.type === 'date') read = readDate(raw);
      else if (f.type === 'number') read = readNumber(raw);
      else if (f.type === 'paid') read = readPaid(raw);
      else if (f.type === 'zone') read = findZone(state, raw);
      else read = { value: raw || null };
      if (read.error) problems.push(`${f.label}: ${read.error}`);
      if (f.type === 'zone') { values.zoneId = read.value ?? null; values.zoneText = raw || null; } else values[f.key] = read.value ?? null;
      if (f.need && !raw) problems.push(`${f.label} is empty`);
    }
    const groups = new Set(spec.fields.filter((f) => f.oneOf).map((f) => f.oneOf));
    for (const g of groups) {
      const members = spec.fields.filter((f) => f.oneOf === g);
      if (members.every((f) => values[f.key] == null)) {
        problems.push(`Give at least one of: ${members.map((f) => f.label).join(' or ')}`);
      }
    }
    if (values.date && values.date > today) problems.push('The date is after today');
    if (kind === 'harvest' && !values.zoneId && !values.zoneText) {
      warnings.push('No zone: it counts in the farm\'s totals, not in any zone\'s');
    }
    if (kind === 'sale' && values.kg != null && values.pricePerKg != null && values.total != null) {
      const expect = values.kg * values.pricePerKg;
      if (Math.abs(expect - values.total) > Math.max(1, expect * 0.02)) {
        warnings.push(`Price × kg is ₦${Math.round(expect).toLocaleString('en-NG')}, but the total says ₦${values.total.toLocaleString('en-NG')}. Both are kept as written`);
      }
    }
    let duplicate = null;
    if (!problems.length) {
      const key = dupKey(kind, values);
      if (held.has(key)) duplicate = 'already on the farm';
      else if (seen.has(key)) duplicate = `same as line ${seen.get(key)}`;
      else seen.set(key, i + 2);
      if (duplicate) warnings.push(`Possible duplicate: ${duplicate}`);
    }
    const status = problems.length ? 'error' : warnings.length ? 'warn' : 'ok';
    return { line: i + 2, values, problems, warnings, status, duplicate };
  });
  const count = (s) => out.filter((r) => r.status === s).length;
  return {
    rows: out,
    ok: count('ok'), warn: count('warn'), error: count('error'),
    duplicates: out.filter((r) => r.duplicate).length,
  };
}

/**
 * The records an import files. Rows with problems never go in; possible
 * duplicates go in only when the person has said so. Ids are derived from the
 * import and the line, so saving the same import twice files nothing new.
 */
export function importEvents(check, { kind, importId, source, fileName = null, includeDuplicates = false, today = isoDate() }) {
  const spec = IMPORT_KINDS[kind];
  const taken = check.rows.filter((r) => r.status !== 'error' && (includeDuplicates || !r.duplicate));
  const rows = taken.map((r) => ({
    type: spec.record,
    eventId: `ev_hist_${importId}_${r.line}`,
    payload: { id: `hist_${importId}_${r.line}`, importId, line: r.line, source, ...r.values },
  }));
  const batch = {
    type: 'import.batch',
    eventId: `ev_import_${importId}`,
    payload: {
      id: importId, kind, source, fileName, importedOn: today,
      rows: check.rows.length, imported: rows.length,
      skippedErrors: check.error,
      skippedDuplicates: check.rows.filter((r) => r.status !== 'error' && r.duplicate && !includeDuplicates).length,
    },
  };
  return [batch, ...rows];
}

/** One line per row, as a .csv the person can keep: what happened to each line and why. */
export function importReportCsv(check, { includeDuplicates = false } = {}) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Line', 'Result', 'Why'].join(',')];
  for (const r of check.rows) {
    const result = r.status === 'error' ? 'Not imported'
      : r.duplicate && !includeDuplicates ? 'Not imported (possible duplicate)' : 'Imported';
    lines.push([r.line, q(result), q([...r.problems, ...r.warnings].join('; '))].join(','));
  }
  return lines.join('\n');
}

/** A blank sheet's columns, for printing or as a spreadsheet template. */
export function templateCsv(kind) {
  return IMPORT_KINDS[kind].fields.map((f) => f.label).join(',') + '\n';
}

/** Past imports, newest first, with what each brought in. */
export function importsList(state) {
  return Object.values((state && state.imports) || {})
    .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1));
}

/** Imported rows of one kind, leaving out any import that was undone. */
export function historyRows(state, kind) {
  const imports = (state && state.imports) || {};
  return ((state && state.history && state.history[kind]) || [])
    .filter((r) => !(imports[r.importId] && imports[r.importId].reverted));
}
