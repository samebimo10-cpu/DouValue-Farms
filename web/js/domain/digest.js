// The Owner's daily digest — FR-REP-01 and FR-REP-02.
//
// Root cause three: oversight the owner could not see remotely. The fix is not
// a dashboard, because a dashboard has to be visited, and the whole problem was
// that nobody was there. The fix is a short message that arrives.
//
// Two rules shape everything here.
//
// EXCEPTIONS ONLY. If nothing is wrong it says so in one line and stops. A
// digest that lists what went right teaches its reader to skim, and a skimmed
// digest is the same as no digest. The day it matters, the one red line has to
// be the only line.
//
// SMALL ENOUGH TO RECEIVE. FR-REP-02: text first, photos on request, over a
// weak and expensive connection. So this produces plain text, measured in
// hundreds of bytes, that can go by WhatsApp, SMS or email without the Owner
// paying to download pictures of sticky traps.

import { isoDate } from '../util.js';
import { alerts, kpis, risingWarnings } from './alerts.js';
import { gateBoard } from './gates.js';
import { stockForecast } from './predict.js';
import { inputUsage, inputsList } from '../store.js';

/**
 * Everything wrong on the farm right now, in priority order.
 *
 * Each item is `{severity, line, detail}`. Severity decides ordering and
 * whether the digest is worth sending at all.
 */
export function exceptions(state, { now = new Date().toISOString(), settings = null } = {}) {
  const today = now.slice(0, 10);
  const config = settings || state.settings || {};
  const out = [];

  // 1. Suspected virus. FR-DIAG-04 sends this straight to the Owner, and it
  //    outranks everything because by the time it is certain it is too late.
  for (const d of state.diagnoses || []) {
    if ((d.date || '') !== today) continue;
    const problem = String(d.problemId || '');
    if (!/virus|tospo|pvmv|cmv|leaf_curl/i.test(problem)) continue;
    out.push({
      severity: 'critical',
      line: `VIRUS SUSPECTED: ${d.problemName || problem} on ${zoneOf(state, d.cycleId)}`,
      detail: 'Isolate those plants, do not move tools or hands between houses, pull and burn '
        + 'the affected ones. Confirm before replanting.',
    });
  }

  // 2. Open alerts that have climbed to the Owner. These are the ones the
  //    ladder has already tried to hand to two other people.
  const open = alerts(state, { now, settings: config }).filter((a) => a.status === 'open');
  for (const a of open.filter((x) => x.level === 'owner')) {
    out.push({
      severity: 'critical',
      line: `${a.pestName} on ${a.zoneName} — ${Math.round(a.hoursOpen)}h open, still not closed`,
      detail: `Counted ${a.count} against a threshold of ${a.limit}.`
        + (a.vector ? ' This one carries virus.' : ''),
    });
  }
  for (const a of open.filter((x) => x.level !== 'owner')) {
    out.push({
      severity: 'warn',
      line: `${a.pestName} on ${a.zoneName} — ${Math.round(a.hoursOpen)}h, with the ${
        a.level === 'supervisor' ? 'Field Supervisor' : 'Farm Manager'}`,
      detail: `Counted ${a.count} against ${a.limit}.`,
    });
  }

  // 3. Gate overrides. Somebody decided to go ahead without a check passing,
  //    and FR-GATE-07 says the Owner sees every one.
  for (const row of gateBoard(state, { today })) {
    for (const g of row.overridden) {
      out.push({
        severity: 'warn',
        line: `${row.zone.name} open on an override — ${g.name}`,
        detail: `Reason given: ${g.override.reason}`,
      });
    }
    if (row.planted && row.blocking.length) {
      out.push({
        severity: 'critical',
        line: `${row.zone.name} is planted with checks not passed: ${row.blocking.map((g) => g.name).join(', ')}`,
        detail: 'Test it now — the result decides what happens to the next cycle in that ground.',
      });
    }
  }

  // 4. Missed work. A scouting round nobody did is the gap Season 1 fell into.
  const overdue = Object.values(state.tasks || {})
    .filter((t) => t.status === 'open' && t.due && t.due.slice(0, 10) < today);
  if (overdue.length) {
    const scouting = overdue.filter((t) => t.kind === 'scout').length;
    out.push({
      severity: scouting ? 'critical' : 'warn',
      line: `${overdue.length} task${overdue.length === 1 ? '' : 's'} overdue`
        + (scouting ? `, ${scouting} of them scouting` : ''),
      detail: overdue.slice(0, 4).map((t) => `${t.title} (${t.due})`).join('; '),
    });
  }

  // 5. Rising counts. Yellow before red, so a spray can be planned.
  for (const r of risingWarnings(state, { today, settings: config }).slice(0, 3)) {
    out.push({
      severity: 'watch',
      line: `${r.pestName} climbing on ${r.zoneName} — about ${r.checksToThreshold} check${
        r.checksToThreshold === 1 ? '' : 's'} from threshold`,
      detail: r.why,
    });
  }

  // 6. Low stock, before it stops work rather than after.
  const usage = inputUsage(state);
  for (const item of inputsList(state)) {
    const f = stockForecast(item, usage, new Date(now));
    if (f.status !== 'critical' && f.status !== 'low') continue;
    out.push({
      severity: f.status === 'critical' ? 'warn' : 'watch',
      line: `${item.name} runs out in ${f.daysLeft} days`,
      detail: f.text,
    });
  }

  const rank = { critical: 0, warn: 1, watch: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function zoneOf(state, cycleId) {
  const cycle = (state.cycles || {})[cycleId];
  const zone = cycle ? (state.plots || {})[cycle.plotId] : null;
  return zone ? zone.name : 'a zone';
}

/**
 * The digest as plain text — FR-REP-02.
 *
 * Text only. No photos, no markup, nothing that costs money to receive. It is
 * built to be pasted into WhatsApp or sent as an SMS and read on a phone with
 * one bar, which is the situation it was designed for.
 */
export function digestText(state, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const items = exceptions(state, { ...opts, now });
  const farm = (state.settings || {}).farmName || 'The farm';
  const date = new Date(now).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  const head = `${farm} — ${date}`;

  if (!items.length) {
    // The one-line nothing-wrong case, which FR-REP-01 asks for by name.
    return `${head}\nNothing needs you today. No open alerts, no overdue work, no overrides.`;
  }

  const critical = items.filter((i) => i.severity === 'critical');
  const lines = [head, ''];
  if (critical.length) lines.push(`${critical.length} thing${critical.length === 1 ? '' : 's'} need you today.`, '');

  for (const i of items) {
    lines.push(`${i.severity === 'critical' ? '!!' : i.severity === 'warn' ? '!' : '-'} ${i.line}`);
    if (i.detail) lines.push(`   ${i.detail}`);
  }

  lines.push('', 'Open the app for the detail and the photos.');
  return lines.join('\n');
}

/** How big the message is, since FR-REP-02 is a size requirement as much as a content one. */
export function digestSize(state, opts = {}) {
  const text = digestText(state, opts);
  return { text, bytes: new TextEncoder().encode(text).length };
}

/** The digest plus the KPI table, for the screen rather than the message. */
export function digest(state, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const items = exceptions(state, { ...opts, now });
  return {
    generatedAt: now,
    items,
    counts: {
      critical: items.filter((i) => i.severity === 'critical').length,
      warn: items.filter((i) => i.severity === 'warn').length,
      watch: items.filter((i) => i.severity === 'watch').length,
    },
    allWell: items.length === 0,
    kpis: kpis(state, { now, settings: opts.settings }),
    text: digestText(state, { ...opts, now }),
  };
}
