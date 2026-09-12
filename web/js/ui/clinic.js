// The clinic: work out what is wrong, say how sure the app is, say how to check,
// and say what to do about it today.

import {
  badge, bar, button, card, cardHead, closeSheet, empty, esc, field, input, note,
  openSheet, readForm, select, stat, table, textarea, tick, toast,
} from './kit.js';
import { diagnose, riskForecast, RISK_DRIVER_TEXT, searchProblems } from '../domain/diagnose.js';
import { PARTS, PROBLEM_BY_ID, PROBLEM_TYPES, PROBLEMS, symptomsForPart } from '../domain/pests.js';
import { discouragedFor, productsFor, PRODUCT_BY_ID } from '../domain/safety.js';
import { CROP_LIST, getCrop, stageAt } from '../domain/crops.js';
import { activeCycles, cycleLabel, openReports } from '../store.js';
import { getLang, local, t } from '../i18n.js';
import { daysBetween, friendlyDate, isoDate, round, uid } from '../util.js';
import { navigate, params } from './shell.js';

let wiz = null;
function resetWizard(ctx) {
  const cycles = activeCycles(ctx.state);
  wiz = {
    step: 1,
    cycleId: cycles.length ? cycles[0].id : '',
    cropId: cycles.length ? cycles[0].cropId : 'habanero',
    parts: [],
    symptoms: new Set(),
    result: null,
  };
}

// --- Clinic home ----------------------------------------------------------

export const clinicView = {
  perm: 'diagnose',
  render(ctx) {
    const { state } = ctx;
    const today = isoDate();
    const cycles = activeCycles(state).map((c) => ({
      cropId: c.cropId,
      stage: stageAt(c.cropId, daysBetween(c.transplantDate, today)).id,
      label: cycleLabel(state, c.id),
      id: c.id,
    }));
    const risks = riskForecast(cycles, today);
    const reports = openReports(state);
    const recent = [...state.diagnoses].reverse().slice(0, 5);

    let out = card(
      cardHead('Crop clinic')
      + '<p><small>Start with what you can see. The app narrows it down, tells you how to confirm it, '
      + 'and what to do today.</small></p>'
      + '<div class="row wrap">'
      + button('Check a sick plant', 'go', { cls: 'btn-lg', icon: '🔍', data: { to: '#/diagnose' } })
      + button('Browse the guide', 'go', { cls: 'btn-lg btn-ghost', icon: '📖', data: { to: '#/guide' } })
      + '</div>'
      // The clinic answers "what is wrong with this plant". The adviser answers
      // "what should the farm do this week", which is the question people ask
      // next, so it belongs one tap from here.
      + `<div style="margin-top:10px">${button('Ask the farm adviser', 'go',
        { cls: 'btn-block', icon: '🧠', data: { to: '#/adviser' } })}</div>`
      + '<p style="margin:8px 0 0"><small>Reads your own records and says what to do about '
      + 'them — beds, water, sprays, stock and money. Works with no network.</small></p>',
      { tight: true },
    );

    if (reports.length) {
      out += card(
        cardHead('Reported from the field', badge(`${reports.length}`, 'warn'))
        + '<ul class="list">' + reports.slice(0, 6).map((r) => {
          const who = state.people[r.by];
          return '<li><div class="grow">'
            + `<b>${esc(r.note)}</b><small>${esc(r.cycleId ? cycleLabel(state, r.cycleId) : 'General')} — `
            + `${esc(who ? who.name : 'someone')}, ${esc(friendlyDate(r.date))}</small>`
            + (r.photo ? `<img src="${r.photo}" alt="Reported problem" style="max-width:160px;border-radius:10px;margin-top:6px">` : '')
            + '</div>'
            + badge(r.severity, r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warn' : '')
            + button('Resolve', 'resolve-report', { cls: 'btn-sm btn-ghost', data: { id: r.id } })
            + '</li>';
        }).join('') + '</ul>',
      );
    }

    out += card(
      cardHead('What the weather makes likely now')
      + (risks.length
        ? risks.slice(0, 6).map((r) => `<div style="margin-bottom:12px">`
          + `<div class="row between"><b>${esc(r.problem.name)}</b>`
          + badge(`${Math.round(r.risk * 100)}%`, r.risk > 0.7 ? 'danger' : r.risk > 0.5 ? 'warn' : '') + '</div>'
          + bar(r.risk, 'risk')
          + `<small>Driven by ${esc(RISK_DRIVER_TEXT[r.driver] || r.driver)}. `
          + `At risk: ${esc([...new Set(r.beds)].join(', '))}. `
          + `<a href="#/guide/item?id=${esc(r.problem.id)}">What to do</a></small></div>`).join('')
        : empty('🌤️', 'Nothing pressing', 'Either nothing is planted, or the weather is not favouring anything in particular.'))
      + '<p style="margin:6px 0 0"><small>This is the weather and the crop stage talking, not a report from the '
      + 'field. It tells you where to walk first, not what is definitely there.</small></p>',
    );

    if (recent.length) {
      out += card(
        cardHead('Recent diagnoses')
        + '<ul class="list">' + recent.map((d) => {
          const problem = PROBLEM_BY_ID[d.problemId];
          return `<li><div class="grow"><b>${esc(problem ? problem.name : d.problemId)}</b>`
            + `<small>${esc(d.cycleId ? cycleLabel(state, d.cycleId) : 'No bed recorded')} — `
            + `${esc(friendlyDate(d.date))}, ${esc(d.confidence)}</small></div>`
            + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(d.problemId)}">Open</a></li>`;
        }).join('') + '</ul>',
      );
    }

    return out;
  },

  actions: {
    'resolve-report': async (ctx, el) => {
      await ctx.store.dispatch('report.resolve', { id: el.dataset.id, note: 'Handled' });
      toast('Report closed');
    },
  },
};

// --- Diagnosis wizard -----------------------------------------------------

export const diagnoseView = {
  perm: 'diagnose',
  enter(ctx) { resetWizard(ctx); },

  render(ctx) {
    if (!wiz) resetWizard(ctx);
    const lang = getLang();
    const steps = `<div class="wizard-steps">${[1, 2, 3, 4].map((n) =>
      `<i class="${wiz.step >= n ? 'on' : ''}"></i>`).join('')}</div>`;

    if (wiz.step === 1) return steps + stepCrop(ctx);
    if (wiz.step === 2) return steps + stepParts(ctx, lang);
    if (wiz.step === 3) return steps + stepSymptoms(ctx, lang);
    return steps + stepResults(ctx);
  },

  actions: {
    'wiz-crop': (ctx, el) => {
      wiz.cycleId = el.dataset.id || '';
      const cycle = ctx.state.cycles[wiz.cycleId];
      if (cycle) wiz.cropId = cycle.cropId;
      ctx.refresh();
    },
    'wiz-crop-only': (ctx, el) => { wiz.cropId = el.dataset.crop; wiz.cycleId = ''; ctx.refresh(); },
    'wiz-next': (ctx) => {
      if (wiz.step === 2 && !wiz.parts.length) { toast('Pick at least one part of the plant', true); return; }
      if (wiz.step === 3 && !wiz.symptoms.size) { toast('Tick what you can see', true); return; }
      wiz.step = Math.min(4, wiz.step + 1);
      if (wiz.step === 4) wiz.result = runDiagnosis(ctx);
      window.scrollTo(0, 0);
      ctx.refresh();
    },
    'wiz-back': (ctx) => { wiz.step = Math.max(1, wiz.step - 1); ctx.refresh(); },
    'wiz-restart': (ctx) => { resetWizard(ctx); ctx.refresh(); },
    'toggle-part': (ctx, el) => {
      const id = el.dataset.id;
      wiz.parts = wiz.parts.includes(id) ? wiz.parts.filter((p) => p !== id) : [...wiz.parts, id];
      ctx.refresh();
    },
    'toggle-tick': (ctx, el) => {
      const id = el.dataset.id;
      if (wiz.symptoms.has(id)) wiz.symptoms.delete(id); else wiz.symptoms.add(id);
      ctx.refresh();
    },
    'add-check-part': (ctx, el) => {
      if (!wiz.parts.includes(el.dataset.part)) wiz.parts.push(el.dataset.part);
      wiz.step = 3;
      ctx.refresh();
    },
    'save-diagnosis': (ctx, el) => saveDiagnosis(ctx, el.dataset.id),
    'make-task': (ctx, el) => openTaskSheet(ctx, el.dataset.id),
    'save-task': (ctx, form) => saveTask(ctx, form),
  },
};

function stepCrop(ctx) {
  const cycles = activeCycles(ctx.state);
  return card(
    cardHead(t('dx.start'))
    + '<p><small>Which crop are you looking at? If it is one of the beds, pick that so the advice '
    + 'can use the crop stage and the spray history.</small></p>'
    + (cycles.length
      ? '<div class="ticks">' + cycles.map((c) => `<label class="tick ${wiz.cycleId === c.id ? 'on' : ''}" `
        + `data-act="wiz-crop" data-id="${esc(c.id)}"><span class="box">✓</span><span class="txt">`
        + `<b>${esc(cycleLabel(ctx.state, c.id))}</b><span class="pid">${esc(getCrop(c.cropId).name)} — day `
        + `${daysBetween(c.transplantDate, isoDate())}</span></span></label>`).join('') + '</div>'
      : '')
    + '<p style="margin-top:14px"><small>Or just the crop, with no bed:</small></p>'
    + '<div class="row wrap">' + CROP_LIST.map((c) => `<button class="chip ${wiz.cropId === c.id && !wiz.cycleId ? 'on' : ''}" `
      + `data-act="wiz-crop-only" data-crop="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join(' ') + '</div>'
    + '<div class="sticky-actions">' + button(t('common.next'), 'wiz-next', { cls: 'btn-block btn-lg' }) + '</div>',
  );
}

function stepParts(ctx, lang) {
  return card(
    cardHead(t('dx.where'))
    + '<p><small>Pick every part where something looks wrong. Only tick a part if you actually looked at it: '
    + 'the app treats "I looked and saw nothing" as evidence too.</small></p>'
    + '<div class="ticks">' + PARTS.map((p) => {
      const on = wiz.parts.includes(p.id);
      const label = lang === 'pcm' ? p.pidgin : p.name;
      const sub = lang === 'pcm' ? p.name : p.pidgin;
      return `<label class="tick ${on ? 'on' : ''}" data-act="toggle-part" data-id="${esc(p.id)}">`
        + `<span class="box">✓</span><span class="txt"><b>${esc(p.emoji)} ${esc(label)}</b>`
        + `<span class="pid">${esc(sub)}</span></span></label>`;
    }).join('') + '</div>'
    + '<div class="sticky-actions">'
    + button(t('common.back'), 'wiz-back', { cls: 'btn-ghost' })
    + button(t('common.next'), 'wiz-next', { cls: 'btn-block btn-lg' })
    + '</div>',
  );
}

function stepSymptoms(ctx, lang) {
  let out = '';
  for (const partId of wiz.parts) {
    const part = PARTS.find((p) => p.id === partId);
    const list = symptomsForPart(partId);
    out += card(
      cardHead(`${part.emoji} ${lang === 'pcm' ? part.pidgin : part.name}`)
      + `<p><small>${esc(t('dx.pick'))}</small></p>`
      + '<div class="ticks">' + list.map((s) => {
        const label = lang === 'pcm' ? s.pidgin : s.label;
        const sub = lang === 'pcm' ? s.label : s.pidgin;
        return tick(s.id, label, sub, wiz.symptoms.has(s.id));
      }).join('') + '</div>',
    );
  }
  out += `<div class="sticky-actions">`
    + button(t('common.back'), 'wiz-back', { cls: 'btn-ghost' })
    + button(`${t('common.next')} (${wiz.symptoms.size})`, 'wiz-next', { cls: 'btn-block btn-lg' })
    + '</div>';
  return out;
}

function runDiagnosis(ctx) {
  const cycle = ctx.state.cycles[wiz.cycleId];
  const dat = cycle ? daysBetween(cycle.transplantDate, isoDate()) : null;
  return diagnose({
    symptoms: [...wiz.symptoms],
    parts: wiz.parts,
    cropId: wiz.cropId,
    dat,
    date: isoDate(),
  });
}

function stepResults(ctx) {
  const res = wiz.result;
  if (!res || !res.results.length) {
    return card(empty('🤔', t('dx.none'), '')
      + button('Start again', 'wiz-restart', { cls: 'btn-block' }));
  }

  let out = card(
    cardHead(t('dx.result'))
    + `<p><small>From ${res.asked} observation${res.asked === 1 ? '' : 's'} on `
    + `${esc(getCrop(wiz.cropId).name)}. Most likely first.</small></p>`
    + (res.separator
      ? note('info', 'One check would settle this',
        `<small>Go and look for: <b>${esc(res.separator.symptom.label)}</b>. If it is there, this is `
        + `${esc(res.separator.points_to.name)}. If not, it points to ${esc(res.separator.away_from.name)}.</small>`)
      : '')
    , { tight: true },
  );

  for (const r of res.results.slice(0, 3)) {
    const p = r.problem;
    const type = PROBLEM_TYPES[p.type];
    const safe = productsFor(p.id);
    const avoid = discouragedFor(p.id);

    out += card(
      `<div class="card-head"><h2>${esc(p.name)}</h2>`
      + badge(r.confidence.label, r.confidence.id === 'strong' ? 'ok' : r.confidence.id === 'likely' ? 'warn' : '')
      + '</div>'
      + bar(r.score)
      + `<p style="margin-top:8px"><small>${esc(type.label)} · ${esc(p.cause)}<br>`
      + `Severity ${p.severity} of 5 · spreads ${esc(p.spread)} · locally: ${esc(p.local)}</small></p>`
      + `<p><small>${esc(r.confidence.hint)}</small></p>`
      + note('warn', 'What it costs you', `<small>${esc(p.loss)}</small>`)
      + `<h3>${esc(t('dx.confirm'))}</h3><ul>${p.confirm.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      + `<h3>${esc(t('dx.doNow'))}</h3><ul>${p.manage.now.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      + '<details><summary><b>Stop it coming back</b></summary><ul>'
      + p.manage.cultural.map((c) => `<li>${esc(c)}</li>`).join('') + '</ul></details>'
      + (safe.length
        ? '<details><summary><b>If you spray</b></summary>'
          + table([{ label: 'Product' }, { label: 'Wait before picking', num: true }, { label: 'Group' }],
            safe.map((s) => [s.name, `${s.phiDays} d`, s.group]))
          + '<p><small>Rotate resistance groups. Two sprays from the same group in a row is how a product '
          + 'stops working. Always check the label for the rate.</small></p></details>'
        : '')
      + (avoid.length
        ? note('danger', 'Do not use these', '<small>' + avoid.map((a) => `<b>${esc(a.name)}</b>: ${esc(a.note)}`).join('<br>') + '</small>')
        : '')
      + '<details><summary><b>Could be confused with</b></summary><p><small>'
      + p.lookalikes.map((l) => PROBLEM_BY_ID[l] ? `<a href="#/guide/item?id=${esc(l)}">${esc(PROBLEM_BY_ID[l].name)}</a>` : '').filter(Boolean).join(', ')
      + '</small></p></details>'
      + '<div class="row wrap" style="margin-top:12px">'
      + button('This is it — record it', 'save-diagnosis', { cls: 'btn-sm', data: { id: p.id } })
      + button('Make it a job', 'make-task', { cls: 'btn-sm btn-ghost', data: { id: p.id } })
      + '</div>',
    );
  }

  if (res.nextChecks.length) {
    out += card(
      cardHead('Not sure? Go and check these')
      + '<ul class="list">' + res.nextChecks.map((n) => `<li><div class="grow">`
        + `<b>${esc(n.symptom.label)}</b><small>Would help confirm ${esc(n.forProblem)}</small></div>`
        + button('Add', 'add-check-part', { cls: 'btn-sm btn-ghost', data: { part: n.part } })
        + '</li>').join('') + '</ul>',
    );
  }

  out += card(
    note('info', 'This is a field guide, not a laboratory',
      '<small>It narrows the list from what you can see. Before spending real money on chemicals, '
      + 'do the confirming checks, and for anything that could take a whole bed, get a second opinion from '
      + 'the Rivers State ADP extension officer or a plant clinic.</small>')
    + '<div class="row wrap">'
    + button('Start again', 'wiz-restart', { cls: 'btn-ghost' })
    + button('Back to clinic', 'go', { cls: 'btn-quiet', data: { to: '#/clinic' } })
    + '</div>',
    { tight: true },
  );

  return out;
}

async function saveDiagnosis(ctx, problemId) {
  const r = wiz.result.results.find((x) => x.id === problemId);
  await ctx.store.dispatch('diagnosis.record', {
    id: uid('dx'),
    problemId,
    cycleId: wiz.cycleId || null,
    cropId: wiz.cropId,
    symptoms: [...wiz.symptoms],
    parts: wiz.parts,
    score: round(r ? r.score : 0, 2),
    confidence: r ? r.confidence.label : 'unknown',
    date: isoDate(),
  });
  toast('Diagnosis recorded against the bed');
}

function openTaskSheet(ctx, problemId) {
  const p = PROBLEM_BY_ID[problemId];
  const cycles = activeCycles(ctx.state);
  openSheet(`<h2>Make it a job</h2><p><small>${esc(p.name)}</small></p>`
    + '<form data-act="save-task">'
    + `<input type="hidden" name="problemId" value="${esc(problemId)}">`
    + field('What must be done?', select('title', p.manage.now.map((n) => ({ value: n, label: n })), p.manage.now[0]))
    + field('On which bed?', select('cycleId',
      cycles.map((c) => ({ value: c.id, label: cycleLabel(ctx.state, c.id) })), wiz.cycleId))
    + field('Who does it?', select('assignedTo',
      Object.values(ctx.state.people).filter((x) => x.active !== false)
        .map((x) => ({ value: x.id, label: x.name })), '', { placeholder: 'Anyone' }))
    + field('When?', input('dueDate', { type: 'date', value: isoDate() }))
    + field('How urgent?', select('priority', [
      { value: 'high', label: 'Urgent — today' },
      { value: 'normal', label: 'Normal' },
    ], p.severity >= 4 ? 'high' : 'normal'))
    + '<button class="btn-block btn-lg" type="submit">Create job</button></form>');
}

async function saveTask(ctx, form) {
  const data = readForm(form);
  await ctx.store.dispatch('task.create', {
    id: uid('t'), title: data.title, cycleId: data.cycleId || null,
    assignedTo: data.assignedTo || null, dueDate: data.dueDate, priority: data.priority,
    source: 'clinic', problemId: data.problemId,
  });
  closeSheet();
  toast('Job created');
}

// --- Guide ----------------------------------------------------------------

let guideFilter = { type: '', query: '' };

export const guideView = {
  perm: 'viewGuide',
  render(ctx) {
    const list = guideFilter.query
      ? searchProblems(guideFilter.query)
      : PROBLEMS.filter((p) => !guideFilter.type || p.type === guideFilter.type);

    return card(
      cardHead('Pepper field guide')
      + `<p><small>${PROBLEMS.length} problems that hit bell pepper, shombo and ata rodo around Port Harcourt.</small></p>`
      + `<div class="field">${input('q', { placeholder: 'Search: wilt, rot, ata rodo, aphid...', value: guideFilter.query })}</div>`
      + '<div class="row wrap">'
      + `<button class="chip ${!guideFilter.type ? 'on' : ''}" data-act="guide-type" data-type="">All</button>`
      + Object.entries(PROBLEM_TYPES).map(([id, meta]) =>
        `<button class="chip ${guideFilter.type === id ? 'on' : ''}" data-act="guide-type" data-type="${esc(id)}">`
        + `${esc(meta.label)}</button>`).join(' ')
      + '</div>',
      { tight: true },
    ) + card(
      list.length
        ? '<ul class="list">' + list.map((p) => `<li><div class="grow">`
          + `<b>${esc(p.name)}</b><small>${esc(p.local)} — ${esc(PROBLEM_TYPES[p.type].label)}, severity ${p.severity}/5</small></div>`
          + `<a class="btn btn-sm btn-ghost" href="#/guide/item?id=${esc(p.id)}">Open</a></li>`).join('') + '</ul>'
        : empty('🔎', 'Nothing matched', 'Try a different word, or browse by type.'),
    );
  },

  actions: {
    'guide-type': (ctx, el) => { guideFilter.type = el.dataset.type; guideFilter.query = ''; ctx.refresh(); },
  },

  mounted() {
    const box = document.querySelector('input[name=q]');
    if (!box) return;
    box.oninput = () => {
      guideFilter.query = box.value;
      const ctx = window.__douvalueCtx;
      const pos = box.selectionStart;
      if (ctx) { ctx.refresh(); const again = document.querySelector('input[name=q]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); } }
    };
  },
};

export const guideItemView = {
  perm: 'viewGuide',
  render(ctx) {
    const p = PROBLEM_BY_ID[params().id];
    if (!p) return card(empty('📖', 'Not in the guide', 'Go back and pick from the list.'));
    const safe = productsFor(p.id);
    const avoid = discouragedFor(p.id);

    return card(
      `<div class="card-head"><h2>${esc(p.name)}</h2>${badge(PROBLEM_TYPES[p.type].label)}</div>`
      + `<p><small>Locally: ${esc(p.local)}<br>${esc(p.cause)}<br>`
      + `Severity ${p.severity}/5 · spreads ${esc(p.spread)} · hits ${p.crops.map((c) => getCrop(c).name).join(', ')}</small></p>`
      + note('warn', 'What it costs you', `<small>${esc(p.loss)}</small>`),
      { tight: true },
    )
    + card(cardHead('How to be sure') + `<ul>${p.confirm.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
    + card(cardHead('Do this now') + `<ul>${p.manage.now.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
    + card(cardHead('Stop it coming back') + `<ul>${p.manage.cultural.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
    + card(cardHead('Without chemicals') + `<ul>${p.manage.organic.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
    + (safe.length ? card(cardHead('If you spray')
      + table([{ label: 'Product' }, { label: 'Example' }, { label: 'Wait', num: true }, { label: 'Group' }],
        safe.map((s) => [s.name, s.examples, `${s.phiDays} d`, s.group]))
      + '<p><small>The wait is the days between spraying and picking. Rotate groups so the product keeps working. '
      + 'The label on the container beats anything written here.</small></p>') : '')
    + (avoid.length ? card(note('danger', 'Do not use these on pepper',
      '<small>' + avoid.map((a) => `<b>${esc(a.name)}</b>: ${esc(a.note)}`).join('<br><br>') + '</small>')) : '')
    + card('<b>Could be confused with</b><p>'
      + p.lookalikes.map((l) => PROBLEM_BY_ID[l]
        ? `<a href="#/guide/item?id=${esc(l)}">${esc(PROBLEM_BY_ID[l].name)}</a>` : '').filter(Boolean).join(' · ')
      + '</p>' + button('Back to the guide', 'go', { cls: 'btn-ghost', data: { to: '#/guide' } }), { tight: true });
  },
};
