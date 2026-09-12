// The CEO's two questions, on one screen.
//
//   Is the farm working?      -> Analysis
//   Can I believe the books?  -> Record checks
//
// The second half is written carefully. It never says anyone is dishonest. It
// says a record deserves a question, gives the innocent explanation first, and
// says what would settle it. On a real farm most of these turn out to be a dead
// phone or a paper book written up on Friday, and an app that cried theft every
// time would be switched off within a week.

import {
  badge, bar, button, card, cardHead, empty, esc, note, spark, stat, table,
} from './kit.js';
import { analyse } from '../domain/analysis.js';
import { audit, timing } from '../domain/integrity.js';
import { cycleLabel } from '../store.js';
import { photoThumb } from './photo.js';
import { friendlyDate, isoDate, kg, naira, round } from '../util.js';

let tab = 'analysis';

const when = (iso) => (iso
  ? `${friendlyDate(iso.slice(0, 10))} at ${new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`
  : 'time not recorded');

export const auditView = {
  perm: 'viewReports',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();

    const head = card(
      cardHead('Farm check')
      + '<div class="row wrap">'
      + `<button class="chip ${tab === 'analysis' ? 'on' : ''}" data-act="audit-tab" data-tab="analysis">📈 Analysis</button>`
      + `<button class="chip ${tab === 'integrity' ? 'on' : ''}" data-act="audit-tab" data-tab="integrity">🔎 Record checks</button>`
      + `<button class="chip ${tab === 'evidence' ? 'on' : ''}" data-act="audit-tab" data-tab="evidence">📷 Evidence</button>`
      + '</div>',
      { tight: true },
    );

    if (tab === 'integrity') return head + integritySection(ctx, today);
    if (tab === 'evidence') return head + evidenceSection(ctx);
    return head + analysisSection(ctx, today);
  },

  actions: {
    'audit-tab': (ctx, el) => { tab = el.dataset.tab; ctx.refresh(); },
  },
};

// --- Analysis -------------------------------------------------------------

function analysisSection(ctx, today) {
  const { state } = ctx;
  const a = analyse(state, { today });
  const money = ctx.user && ['ceo', 'manager'].includes(ctx.user.role);

  if (!state.harvests.length) {
    return card(empty('📈', 'Nothing to analyse yet',
      'Once pickings are recorded against a bed, this screen shows what is working and what is not.'));
  }

  let out = card(
    cardHead('Picking, last 12 weeks',
      badge(a.trend.direction === 'up' ? `up ${a.trend.changePct}%`
        : a.trend.direction === 'down' ? `down ${Math.abs(a.trend.changePct)}%` : 'steady',
      a.trend.direction === 'up' ? 'ok' : a.trend.direction === 'down' ? 'warn' : ''))
    + spark(a.trend.rows.map((r) => ({ value: r.kg, label: `${r.week}: ${r.kg} kg` })),
      { caption: `Last four weeks ${kg(a.trend.recentTotal, 0)} against ${kg(a.trend.previousTotal, 0)} the four before.` }),
  );

  if (money) {
    const e = a.economics;
    out += card(
      cardHead('What a kilo costs, and what it fetches')
      + (e.costPerKg == null || e.pricePerKg == null
        ? note('info', 'Not enough recorded yet',
          '<small>Record some sales and costs and this works out whether the season is paying.</small>')
        : '<div class="grid">'
          + stat('Cost to grow', `${naira(e.costPerKg)}/kg`, 'inputs and labour')
          + stat('Sold for', `${naira(e.pricePerKg)}/kg`, 'actual sales')
          + stat('Margin', `${naira(e.marginPerKg)}/kg`, e.marginPerKg > 0 ? 'per kilo picked' : 'losing money per kilo')
          + stat('Not yet sold', kg(e.unsoldKg, 0), 'picked but unsold')
          + '</div>'
          + note(e.marginPerKg > 0 ? 'ok' : 'danger', e.verdict,
            `<small>Over 90 days: ${kg(e.pickedKg, 0)} picked, ${kg(e.soldKg, 0)} sold for `
            + `${naira(e.revenue, true)}, against ${naira(e.totalCost, true)} of cost.</small>`)),
    );
  }

  out += card(
    cardHead('Which beds are pulling their weight')
    + '<p><small>Measured against the part of each bed\'s own forecast that has already passed, '
    + 'so a young bed is not marked down for being young.</small></p>'
    + table(
      [{ label: 'Bed' }, { label: 'Picked', num: true }, { label: 'Expected by now', num: true }, { label: 'Verdict' }],
      a.beds.filter((b) => b.status === 'active').map((b) => [
        `${b.crop.emoji} ${b.plot ? b.plot.name : 'Bed'}`,
        kg(b.pickedKg, 0),
        b.dueByNowKg > 0 ? kg(b.dueByNowKg, 0) : 'too early',
        b.verdict,
      ]),
    ),
  );

  const behind = a.beds.filter((b) => b.status === 'active' && (b.verdict === 'behind' || b.verdict === 'well behind'));
  if (behind.length) {
    out += card(note('warn', `${behind.length} bed${behind.length === 1 ? ' is' : 's are'} behind`,
      '<small>' + behind.map((b) => `${b.plot ? b.plot.name : 'A bed'}: ${kg(b.pickedKg, 0)} against `
        + `${kg(b.dueByNowKg, 0)} expected${b.lastPick ? `, last picked ${friendlyDate(b.lastPick)}` : ', never picked'}.`)
        .join('<br>') + '</small>'));
  }

  if (a.labour.length) {
    out += card(
      cardHead('Who is doing what')
      + table(
        [{ label: 'Person' }, { label: 'Days', num: true }, { label: 'Hours', num: true },
          { label: 'Picked', num: true }, { label: 'Per hour', num: true }],
        a.labour.map((r) => [r.person.name, r.days, r.hours, kg(r.kg, 0),
          r.kgPerHour == null ? '—' : `${r.kgPerHour} kg`]),
      )
      + '<p style="margin:8px 0 0"><small>Picking rate depends on the crop and the bed as much as the person. '
      + 'Use it to spot somebody struggling, not to rank people.</small></p>',
    );
  }

  if (a.grades.total) {
    out += card(
      cardHead('Grade mix', a.grades.rejectShare > 15 ? badge(`${a.grades.rejectShare}% reject`, 'danger') : '')
      + table([{ label: 'Grade' }, { label: 'Weight', num: true }, { label: 'Share', num: true }],
        a.grades.grades.map((g) => [g.grade, kg(g.kg, 0), `${g.share}%`]))
      + (a.grades.rejectShare > 15
        ? note('warn', 'Rejects are high',
          '<small>More than one kilo in seven is not making grade. That is usually anthracnose or '
          + 'fruit left too long on the plant. Worth a walk through the beds with the clinic.</small>')
        : ''),
    );
  }

  return out;
}

// --- Record checks --------------------------------------------------------

function integritySection(ctx, today) {
  const { state } = ctx;
  const result = audit(state, { today });
  const q = result.records;

  let out = card(
    cardHead('How solid are the records?',
      q.band ? badge(q.band.label, q.band.tone) : '')
    + (q.total === 0
      ? '<p><small>No pickings recorded yet.</small></p>'
      : '<div class="grid">'
        + stat('Recorded same day', `${q.sameDay}%`, 'not written up later')
        + stat('With a photo', `${q.withPhoto}%`, 'evidence attached')
        + stat('Checked by a supervisor', `${q.verified}%`, 'second pair of eyes')
        + stat('Questions raised', String(result.findings.length),
          result.rawCount > result.findings.length
            ? `covering ${result.rawCount} records`
            : `${result.counts.high} worth chasing`)
        + '</div>'
        + '<div style="margin-top:12px">' + bar((q.score || 0) / 100) + '</div>'
        + '<p style="margin-top:8px"><small>This measures how the records were <b>made</b>, not whether '
        + 'people are honest. A record made at the bed, with a photo, checked by someone else, is one you '
        + 'can stand behind at a bank or a buyer. One remembered on Friday is not, however truthful.</small></p>'),
  );

  if (!result.findings.length) {
    out += card(empty('✅', 'Nothing to question',
      'Every check passed. As more work is recorded this screen will flag anything that needs a second look.'));
  }

  for (const f of result.findings.slice(0, 25)) {
    const who = f.who ? state.people[f.who] : null;
    out += card(
      `<div class="card-head"><h3>${esc(f.title)}</h3>`
      + (f.grouped ? badge(`${f.grouped} records`, 'warn') : '')
      + badge(f.severity === 'high' ? 'chase this' : f.severity === 'medium' ? 'ask about it' : 'note',
        f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warn' : '')
      + '</div>'
      + `<p>${esc(f.detail)}</p>`
      + `<p><small>${who ? `${esc(who.name)} · ` : ''}`
      + `${f.cycleId ? `${esc(cycleLabel(state, f.cycleId))} · ` : ''}`
      + `${f.when ? esc(when(f.when)) : 'no time recorded'}</small></p>`
      + note('info', 'Most likely explanation', `<small>${esc(f.innocent)}</small>`)
      + note(f.severity === 'high' ? 'warn' : 'ok', 'What would settle it', `<small>${esc(f.settle)}</small>`),
    );
  }

  if (result.people.length) {
    out += card(
      cardHead('Record-keeping by person')
      + table(
        [{ label: 'Person' }, { label: 'Records', num: true }, { label: 'Same day', num: true },
          { label: 'With photo', num: true }, { label: 'Questions', num: true }, { label: '' }],
        result.people.map((r) => [
          r.person.name, r.records,
          r.sameDayShare == null ? '—' : `${r.sameDayShare}%`,
          r.photoShare == null ? '—' : `${r.photoShare}%`,
          r.questions,
          { __raw: badge(r.grade.label, r.grade.tone) },
        ]),
      )
      + note('info', 'Read this fairly',
        '<small>Somebody working the back field with no signal will always look worse than somebody at '
        + 'the office, and that is about the network, not about them. Use it to find who needs a better '
        + 'phone or a paper form, before you use it for anything else.</small>'),
    );
  }

  return out;
}

// --- Evidence -------------------------------------------------------------

function evidenceSection(ctx) {
  const { state } = ctx;
  const items = [
    ...state.reports.map((r) => ({ ...r, what: 'Problem report', label: r.note })),
    ...state.harvests.filter((h) => h.photo).map((h) => ({ ...h, what: 'Picking', label: `${round(h.kg, 1)} kg` })),
    ...state.scouts.filter((s) => s.photo).map((s) => ({ ...s, what: 'Scouting', label: s.finding || 'Checked' })),
    ...state.sprays.filter((s) => s.photo).map((s) => ({ ...s, what: 'Spray', label: s.productName || 'Spray' })),
  ].filter((x) => x.photo).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  if (!items.length) {
    return card(empty('📷', 'No pictures yet',
      'Photos attached to pickings, scouting, sprays and problem reports collect here, newest first, '
      + 'each with who took it and when.'));
  }

  return card(
    cardHead('Pictures from the field', badge(`${items.length}`, ''))
    + '<p><small>Newest first. A picture taken at the bed at the time is evidence; one picked out of '
    + 'the gallery later is a claim, and is labelled as such.</small></p>'
    + '<div class="evidence-grid">'
    + items.slice(0, 40).map((item) => {
      const who = state.people[item.by];
      return '<div class="evidence-item">'
        + photoThumb(item.photo, { alt: `${item.what}: ${item.label || ''}` })
        + `<b>${esc(item.what)}</b>`
        + `<small>${esc(String(item.label || '').slice(0, 60))}</small>`
        + `<small>${esc(who ? who.name : 'someone')} · ${esc(when(item.at))}</small>`
        + (item.cycleId ? `<small>${esc(cycleLabel(state, item.cycleId))}</small>` : '')
        + '</div>';
    }).join('')
    + '</div>',
  );
}
