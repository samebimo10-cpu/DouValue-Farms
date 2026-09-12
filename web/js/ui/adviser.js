// Ask the farm.
//
// The screen is deliberately two layers deep, and the order matters.
//
// The built-in adviser runs first and always. It is on the phone, it needs no
// signal and no account, and it has already read every record on this handset
// by the time the screen paints. That is what a farm in Rivers State can rely
// on at seven in the morning in a field.
//
// The wider adviser is the second layer. It runs on the farm's own server,
// reads current knowledge off the internet, and answers a typed question. It
// needs signal, and it needs the CEO to have switched it on. When it is not
// there the screen says so plainly and the first layer still stands — it never
// pretends the advice is missing.

import {
  badge, button, card, cardHead, empty, esc, note, readForm, textarea,
} from './kit.js';
import { buildBrief, briefToText } from '../domain/brief.js';
import { advise, URGENCY } from '../domain/adviser.js';
import { askAdviser } from '../sync.js';
import { getWeather } from './worker.js';
import { isoDate } from '../util.js';

// Per-session, not stored: advice is about today and should not be read back
// tomorrow as though it still holds.
let wider = null;          // the last answer from the server
let asking = false;
let question = '';
let showWorking = false;

const AREA_ICON = {
  safety: '⚠️', water: '💧', disease: '🍂', yield: '🌶️', quality: '📦',
  money: '💰', market: '📈', store: '🧰', labour: '👥', records: '📋', planning: '🗓️',
};

function localAdvice(ctx) {
  const weather = getWeather();
  return advise(buildBrief(ctx.state, ctx.user, {
    today: isoDate(),
    weatherDays: weather && weather.days,
  }));
}

export const adviserView = {
  perm: 'viewGuide',       // everyone on the farm; the brief is cut to their role

  render(ctx) {
    const result = localAdvice(ctx);
    return head(result)
      + urgentBlock(result)
      + restBlock(result)
      + widerBlock(ctx)
      + workingBlock(ctx);
  },

  actions: {
    // Submitted from a form, so the handler's second argument is the form itself.
    'adviser-ask': async (ctx, form) => {
      const data = form && form.tagName === 'FORM' ? readForm(form) : {};
      question = String(data.question != null ? data.question : question).trim();
      asking = true;
      wider = null;
      ctx.refresh();

      const result = localAdvice(ctx);
      wider = await askAdviser({
        brief: buildBrief(ctx.state, ctx.user, {
          today: isoDate(),
          weatherDays: (getWeather() || {}).days,
        }),
        question,
        // Telling it what has already been said is what stops the two advisers
        // repeating each other back at the farm.
        alreadySaid: result.recommendations.map((r) => r.title),
      });
      asking = false;
      ctx.refresh();
    },

    'adviser-clear': (ctx) => { wider = null; question = ''; ctx.refresh(); },
    'adviser-working': (ctx) => { showWorking = !showWorking; ctx.refresh(); },
  },
};

// --- The built-in adviser -------------------------------------------------

function head(result) {
  const urgent = result.counts.now;
  return card(
    cardHead('Ask the farm',
      urgent ? badge(`${urgent} for today`, 'danger') : badge('nothing urgent', 'ok'))
    + '<p><small>Everything below is worked out on this phone from your own records, '
    + 'so it is here with the network off. Ask a question at the bottom to send it to '
    + 'the farm server, which can also read what is current on the internet.</small></p>',
    { tight: true },
  );
}

function recCard(r) {
  const u = URGENCY[r.urgency];
  return card(
    cardHead(`${AREA_ICON[r.area] || '•'} ${r.title}`, badge(u.label, u.tone))
    + `<p class="why"><b>Why:</b> ${esc(r.because)}</p>`
    + (r.cost ? `<p class="cost"><b>If it is left:</b> ${esc(r.cost)}</p>` : '')
    + `<p class="do"><b>Do this:</b> ${esc(r.action)}</p>`
    + `<p><small class="basis">${esc(r.basis)}</small></p>`,
  );
}

function urgentBlock(result) {
  const urgent = result.recommendations.filter((r) => r.urgency === 'now' || r.urgency === 'week');
  if (!urgent.length) return '';
  return `<h2 class="section">Act on these</h2>${urgent.map(recCard).join('')}`;
}

function restBlock(result) {
  const rest = result.recommendations.filter((r) => r.urgency === 'soon' || r.urgency === 'watch');
  if (!rest.length && !result.nothingToSay) return '';
  if (result.nothingToSay) {
    return card(empty('🌱', 'Nothing to advise on yet',
      'Record some pickings, a bed or two and what you spend, and this screen fills itself in. '
      + 'It works from your records, so it is only as useful as they are.'));
  }
  return `<h2 class="section">Worth knowing</h2>${rest.map(recCard).join('')}`;
}

// --- The wider adviser ----------------------------------------------------

function widerBlock(ctx) {
  const body = [
    '<p><small>Ask anything about this farm. The question and a summary of your '
    + 'records go to your own farm server, which searches the internet for what is '
    + 'current and answers from both. Nothing goes anywhere else.</small></p>',
    '<form data-act="adviser-ask">',
    textarea('question', {
      value: question,
      rows: 3,
      placeholder: 'e.g. Bed 3 keeps falling behind. What would you check first?',
    }),
    `<button class="btn-block btn-lg" type="submit"${asking ? ' disabled' : ''}>`
      + `${asking ? 'Thinking…' : 'Ask'}</button>`,
    '</form>',
  ].join('');

  if (asking) {
    return card(cardHead('Ask a question') + body
      + note('info', 'Searching', '<small>It is reading your records and looking things up. '
        + 'This can take up to a minute on a weak signal.</small>'));
  }

  if (!wider) return card(cardHead('Ask a question') + body);

  if (wider.ok) {
    return card(
      cardHead('Answer', badge('read online', 'info'))
      + `<div class="prose">${prose(wider.text)}</div>`
      + sourceList(wider.sources)
      + (wider.questionsLeftToday != null
        ? `<p><small>${wider.questionsLeftToday} more questions on your account today.</small></p>`
        : '')
      + `<div style="margin-top:10px">${button('Ask something else', 'adviser-clear', { cls: 'btn-ghost btn-block' })}</div>`,
    ) + card(cardHead('Ask a question') + body);
  }

  // Every failure is explained in the server's own words, and every one of them
  // ends the same way: the advice above still stands.
  const tone = wider.reason === 'no-key' ? 'info' : 'warn';
  const title = {
    'no-key': 'The wider adviser is not switched on',
    'daily-limit': 'That is enough questions for today',
    offline: 'This phone is not connected to a farm server',
    timeout: 'It took too long',
    declined: 'It would not answer that',
  }[wider.reason] || 'It could not answer just now';

  return card(
    cardHead('Ask a question')
    + note(tone, title, `<small>${esc(wider.message || '')}</small>`)
    + (wider.reason === 'no-key'
      ? '<p><small>Everything above still holds — it is worked out from your own records '
        + 'and does not need the internet.</small></p>'
      : '')
    + body,
  );
}

/** Markdown is overkill here. Headings and paragraphs are all the answer uses. */
function prose(text) {
  return String(text || '').split(/\n{2,}/).map((para) => {
    const line = para.trim();
    if (!line) return '';
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) return `<h3>${esc(heading[1])}</h3>`;
    if (/^[-*]\s+/m.test(line)) {
      const items = line.split('\n').filter((l) => /^[-*]\s+/.test(l.trim()));
      if (items.length) {
        return `<ul>${items.map((l) => `<li>${esc(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
    }
    return `<p>${esc(line)}</p>`;
  }).join('');
}

/**
 * Only ever link to a web address.
 *
 * esc() stops a value breaking out of the attribute, but it says nothing about
 * what the value *means*, and `javascript:` in an href is dangerous while
 * perfectly well-formed. These URLs come back from a web search, which is to
 * say from pages nobody here controls, so the scheme is checked rather than
 * assumed. Anything else is shown as plain text: the reader still sees what it
 * claimed to be, and cannot tap it.
 */
function safeUrl(url) {
  try {
    const parsed = new URL(String(url), location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function sourceList(sources) {
  if (!sources || !sources.length) return '';
  return '<p><small><b>Read from:</b></small></p><ul class="sources">'
    + sources.map((s) => {
      const href = safeUrl(s.url);
      // The host is shown beside the title so a convincing name over an
      // unfamiliar address is visible before anybody taps it.
      const host = href ? new URL(href).hostname : null;
      const label = `<small>${esc(s.title)}</small>`;
      return '<li>'
        + (href
          ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
            + ` <small class="src-host">${esc(host)}</small>`
          : `${label} <small class="src-host">not a web address</small>`)
        + '</li>';
    }).join('')
    + '</ul>';
}

// --- What it actually looked at -------------------------------------------

function workingBlock(ctx) {
  const control = card(
    button(showWorking ? 'Hide what it looked at' : 'Show what it looked at',
      'adviser-working', { cls: 'btn-quiet btn-block' }),
    { tight: true },
  );
  if (!showWorking) return control;

  const brief = buildBrief(ctx.state, ctx.user, {
    today: isoDate(),
    weatherDays: (getWeather() || {}).days,
  });
  return control + card(
    cardHead('What it looked at')
    + '<p><small>Exactly this, and nothing else. No advice here is coming from anywhere '
    + 'but your own records and the weather.</small></p>'
    + `<pre class="working">${esc(briefToText(brief))}</pre>`,
  );
}
