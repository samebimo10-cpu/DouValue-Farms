// Small helpers shared by every module. No dependencies, no network.

export const DAY_MS = 86400000;

let idCounter = 0;
/** Sortable, collision-resistant id: time prefix + counter + randomness. */
export function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 4096;
  const t = Date.now().toString(36);
  const c = idCounter.toString(36).padStart(3, '0');
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${c}${r}`;
}

/** YYYY-MM-DD for a Date or ISO string, in local farm time. */
export function isoDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(v);
}

export function addDays(d, n) {
  const x = parseDate(d);
  return new Date(x.getTime() + n * DAY_MS);
}

/** Whole days from a to b (b - a). Calendar days, not hours. */
export function daysBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  const ax = Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const by = Date.UTC(y.getFullYear(), y.getMonth(), y.getDate());
  return Math.round((by - ax) / DAY_MS);
}

export function monthOf(d) { return parseDate(d).getMonth() + 1; } // 1-12

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function sum(list, pick = (x) => x) {
  return list.reduce((t, x) => t + (Number(pick(x)) || 0), 0);
}

export function groupBy(list, key) {
  const out = new Map();
  for (const item of list) {
    const k = typeof key === 'function' ? key(item) : item[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/** Naira with thousands separators. Big numbers get k/m suffixes when short=true. */
export function naira(n, short = false) {
  const v = Number(n) || 0;
  if (short && Math.abs(v) >= 1e6) return `₦${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}m`;
  if (short && Math.abs(v) >= 1e4) return `₦${Math.round(v / 1e3)}k`;
  return `₦${Math.round(v).toLocaleString('en-NG')}`;
}

export function kg(n, dp = 1) {
  const v = Number(n) || 0;
  return `${v >= 100 ? Math.round(v).toLocaleString('en-NG') : v.toFixed(dp)} kg`;
}

export function pct(n, dp = 0) { return `${(Number(n) || 0).toFixed(dp)}%`; }

/** "Today", "Yesterday", "Mon 4 Aug" — short and readable on a phone. */
export function friendlyDate(d, today = new Date()) {
  const diff = daysBetween(d, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const x = parseDate(d);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (x.getFullYear() !== parseDate(today).getFullYear()) opts.year = 'numeric';
  return x.toLocaleDateString('en-NG', opts);
}

export function timeOfDay(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Escape for safe insertion into innerHTML. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolated value. Arrays are joined. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (Array.isArray(v) ? v.join('') : v && v.__raw ? v.__raw : esc(v)) + strings[i + 1];
  }
  return out;
}

/** Mark a string as already-safe HTML for use inside html``. */
export function raw(s) { return { __raw: String(s) }; }

export function round(n, dp = 0) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Linear interpolation between stops: [[x,y],...] sorted by x. */
export function interpolate(stops, x) {
  if (!stops.length) return 0;
  if (x <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i - 1], [x2, y2] = stops[i];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1 || 1);
  }
  return last[1];
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Stable sort helper: sortBy(list, x => x.date, 'desc') */
export function sortBy(list, pick, dir = 'asc') {
  const s = [...list].sort((a, b) => {
    const av = pick(a), bv = pick(b);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return dir === 'desc' ? s.reverse() : s;
}

export function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Crates and baskets are how the field counts; kg is how the books count. */
export function unitsToKg(qty, unit, unitWeights) {
  const w = unitWeights[unit];
  return w ? Number(qty) * w : Number(qty);
}
