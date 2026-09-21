// The KPI screen — FR-REP-03.
//
// "A KPI screen shows the measures in section 3, per week and per zone."
//
// Section 3 opens with the sentence this screen exists to answer: "The app is
// working only if these improve against Season 1." So the screen is built to be
// read as a verdict rather than as a dashboard — each measure with its target
// beside it, and a tick or a cross, because a number without its target is
// trivia.
//
// Per week and per zone are not two extra views bolted on; they are how you
// tell a farm that is improving from one that is not, and which house is
// dragging. All three are computed by the same kpis() the digest uses, so the
// screen and the message can never disagree.

import { badge, button, card, cardHead, empty, esc, note, table } from './kit.js';
import { kpis, kpisByWeek, kpisByZone, zoneTrends } from '../domain/alerts.js';
import { trendChart } from './chart.js';
import { isoDate } from '../util.js';

const mark = (row) => (row.value == null ? '—' : (row.ok ? '✓' : '✕'));

export const kpiView = {
  perm: 'viewReports',

  render(ctx) {
    const now = new Date().toISOString();
    const today = isoDate();
    const rows = kpis(ctx.state, { now });
    const weeks = kpisByWeek(ctx.state, { now, weeks: 6 });
    const zones = kpisByZone(ctx.state, { now });

    return head(rows)
      + nowBlock(rows)
      + weekBlock(weeks)
      + zoneBlock(ctx, zones, today);
  },
};

function head(rows) {
  const met = rows.filter((r) => r.ok).length;
  const measured = rows.filter((r) => r.value != null).length;
  return card(
    cardHead('Success measures', badge(`${met} of ${rows.length} met`,
      met === rows.length ? 'ok' : met >= rows.length - 1 ? 'warn' : 'danger'))
    + '<p><small>Section 3 of the requirements: the app is working only if these improve against '
    + 'Season 1. Every one is read straight off the records — nobody reports them, and nobody '
    + `can flatter them.${measured < rows.length ? ' A dash means there is nothing to measure yet.' : ''}`
    + '</small></p>'
    + `<div class="row wrap" style="margin-top:10px">${
      button('Today\'s digest', 'go', { cls: 'btn-ghost btn-sm', icon: '📨', data: { to: '#/digest' } })
    }${button('Alerts', 'go', { cls: 'btn-ghost btn-sm', icon: '🚨', data: { to: '#/alerts' } })}</div>`,
    { tight: true },
  );
}

/** The whole farm, last four weeks — the headline. */
function nowBlock(rows) {
  return card(
    cardHead('The whole farm, last 28 days')
    + table(['', 'Measure', 'Target', 'Now'], rows.map((r) => [
      mark(r),
      { __raw: `<b>${esc(r.measure)}</b><br><small>${esc(r.basis)}</small>` },
      r.target,
      { __raw: `<b>${esc(r.display)}</b>` },
    ])),
  );
}

/**
 * Week by week — FR-REP-03.
 *
 * One column per measure, one row per week, so the question "is it getting
 * better" is answered by reading downwards rather than by remembering what last
 * week said.
 */
function weekBlock(weeks) {
  const ids = weeks[0] ? weeks[0].rows.map((r) => r.id) : [];
  if (!ids.length) return '';

  return card(
    cardHead('Week by week', badge(`${weeks.length} weeks`, 'muted'))
    + table(['Week', ...ids.map((id) => ({ label: id.replace('KPI-', 'K'), num: true }))],
      weeks.map((w) => [
        { __raw: `<b>${esc(w.label)}</b><br><small>${esc(w.from)}</small>` },
        ...w.rows.map((r) => ({
          __raw: r.value == null
            ? '<small>—</small>'
            : `<b class="${r.ok ? 'kpi-ok' : 'kpi-bad'}">${r.ok ? '✓' : '✕'}</b>`
              + `<br><small>${esc(r.display)}</small>`,
        })),
      ]))
    + '<p><small>'
    + ids.map((id, i) => `<b>${esc(id.replace('KPI-', 'K'))}</b> ${esc(shortName(weeks[0].rows[i]))}`)
      .join(' · ')
    + '</small></p>',
  );
}

function shortName(row) {
  return {
    'KPI-01': 'breach to treatment',
    'KPI-02': 'scouting done with photo',
    'KPI-03': 'sprays with no diagnosis',
    'KPI-04': 'plantings past the gates',
    'KPI-05': 'alerts left open',
    'KPI-06': 'money known per zone',
  }[row.id] || row.measure;
}

/**
 * Per zone — FR-REP-03 — with that zone's trap-count trend under it (FR-SCOUT-06).
 *
 * The two belong on one card. "GH-04 is failing KPI-01" and "here is GH-04's
 * thrips count climbing through the threshold line" are the same sentence said
 * twice, and putting them a screen apart is how one of them gets missed.
 */
function zoneBlock(ctx, zones, today) {
  if (!zones.length) {
    return card(empty('📍', 'No zones yet',
      'Add your greenhouses and fields and these measures start splitting by zone.'));
  }

  return `<h2 class="section">By zone</h2>${zones.map(({ zone, rows }) => {
    const failed = rows.filter((r) => !r.ok && r.value != null);
    const trends = zoneTrends(ctx.state, { today, zoneId: zone.id });

    return card(
      cardHead(zone.name, failed.length
        ? badge(`${failed.length} not met`, 'danger') : badge('on target', 'ok'))
      + table(['', 'Measure', 'Target', 'Now'], rows.map((r) => [
        mark(r), r.measure, r.target, { __raw: `<b>${esc(r.display)}</b>` },
      ]))
      + (trends.length
        ? `<h3 style="margin-top:14px">Trap counts</h3>${trends.slice(0, 4).map((t) =>
          trendChart(t.trend, { pestName: t.pestName })).join('')}`
        : note('info', 'No counts recorded for this zone yet',
          '<small>The trend chart appears as soon as there are two checks to join up.</small>')),
    );
  }).join('')}`;
}
