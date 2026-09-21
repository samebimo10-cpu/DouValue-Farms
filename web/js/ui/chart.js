// The trap-count trend chart — FR-SCOUT-06.
//
// "A trend chart per zone shows trap counts over time, with the threshold line
// drawn."
//
// The threshold line is the whole point. A row of numbers climbing from 3 to 8
// means nothing on its own; the same row with a line at 10 drawn across it is a
// sentence — "two more checks like that and we are spraying". FR-SCOUT-07 acts
// on the same fact in words; this is the same fact in a shape, for the person
// who takes it in faster that way.
//
// Drawn as inline SVG rather than with a charting library: the app has no build
// step and has to open on a 2 GB phone with no signal, so a 40 KB dependency to
// draw eight dots is not a trade worth making.
//
// Two rules from section 5 shape how it looks. Strokes are heavy and the dots
// are large, because this is read in direct sun (UX-05). And the chart carries
// its own sentence as an aria-label and a caption (UX-07: never colour alone),
// so a person who cannot separate the red from the green, or who is using a
// screen reader, still gets the answer.

import { esc } from '../util.js';

const PAD = { left: 30, right: 10, top: 12, bottom: 24 };

/** dd/mm, which is how the dates are read out loud on this farm. */
const shortDate = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;

/**
 * The chart as a sentence.
 *
 * Written first, drawn second. If this cannot be said, the picture is not
 * worth drawing either.
 */
export function trendSummary(t, { pestName = null } = {}) {
  const what = pestName || t.pestId || 'the count';
  if (!t.points.length) return `No counts recorded for ${what} yet.`;

  const last = t.points[t.points.length - 1];
  const kind = last.kind === 'trap' ? 'on the trap' : 'per plant';
  const head = `${what}: ${last.count} ${kind} on ${shortDate(last.date)}`
    + `, from ${t.points.length} check${t.points.length === 1 ? '' : 's'}`;

  if (t.line == null) return `${head}. No threshold set for this one.`;
  if (last.count >= t.line) return `${head}. Over the threshold of ${t.line}.`;
  if (t.rising) return `${head}. Threshold ${t.line}, about ${t.rising.checksToThreshold} checks away.`;
  return `${head}. Threshold ${t.line}, not crossed.`;
}

/**
 * One zone, one pest, over time, with the threshold drawn across it.
 *
 * `t` is what domain/alerts.js trend() returns: points, the threshold line, and
 * the rising warning if there is one.
 */
export function trendChart(t, {
  pestName = null, zoneName = null, width = 320, height = 150,
} = {}) {
  const summary = trendSummary(t, { pestName });
  const title = [pestName, zoneName].filter(Boolean).join(' — ');

  if (t.points.length < 2) {
    return '<div class="trend">'
      + (title ? `<div class="trend-head"><b>${esc(title)}</b></div>` : '')
      + `<p class="trend-empty"><small>${esc(t.points.length
        ? 'One check so far. A trend needs at least two.'
        : 'No counts recorded yet, so there is nothing to draw.')}</small></p>`
      + '</div>';
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const counts = t.points.map((p) => p.count);
  // The threshold must always be inside the picture: a chart that crops the
  // line off the top is a chart that says everything is fine.
  const top = Math.max(1, ...counts, t.line == null ? 0 : t.line * 1.15);
  const x = (i) => PAD.left + (t.points.length === 1 ? plotW / 2
    : (i / (t.points.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;

  const path = t.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
  const over = (v) => t.line != null && v >= t.line;

  const dots = t.points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.count).toFixed(1)}" `
    + `r="${over(p.count) ? 5 : 4}" class="${over(p.count) ? 'over' : ''}">`
    + `<title>${esc(`${shortDate(p.date)}: ${p.count} ${p.kind === 'trap' ? 'on the trap' : 'per plant'}`)}</title>`
    + '</circle>').join('');

  const lineY = t.line == null ? null : y(t.line);
  const threshold = lineY == null ? '' : `<line class="threshold" x1="${PAD.left}" y1="${lineY.toFixed(1)}" `
    + `x2="${(width - PAD.right).toFixed(1)}" y2="${lineY.toFixed(1)}"></line>`
    + `<text class="threshold-label" x="${PAD.left + 2}" y="${(lineY - 4).toFixed(1)}">`
    + `${esc(`threshold ${t.line}`)}</text>`;

  return '<div class="trend">'
    + (title ? `<div class="trend-head"><b>${esc(title)}</b></div>` : '')
    + `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" `
    + `role="img" aria-label="${esc(summary)}">`
    // The axis, drawn faintly: the numbers matter, the furniture does not.
    + `<line class="axis" x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${width - PAD.right}" y2="${PAD.top + plotH}"></line>`
    + `<text class="tick" x="2" y="${(PAD.top + 8).toFixed(1)}">${esc(Math.round(top))}</text>`
    + `<text class="tick" x="2" y="${(PAD.top + plotH).toFixed(1)}">0</text>`
    + threshold
    + `<path class="trend-line" d="${path}"></path>`
    + dots
    + `<text class="tick" x="${PAD.left}" y="${height - 6}">${esc(shortDate(t.points[0].date))}</text>`
    + `<text class="tick end" x="${width - PAD.right}" y="${height - 6}" text-anchor="end">`
    + `${esc(shortDate(t.points[t.points.length - 1].date))}</text>`
    + '</svg>'
    // UX-07 again: the same answer in words, under the picture.
    + `<p class="trend-caption"><small>${esc(summary)}</small></p>`
    + '</div>';
}
