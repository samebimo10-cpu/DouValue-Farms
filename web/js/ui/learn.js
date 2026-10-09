// Learn — the problem cards, browsed from My work (FR-LEARN-01 to 05).
//
// Reachable from the home screen and nowhere else. Never inside a task: a hand
// halfway through a scouting round or a report is doing the job, and a
// reference library opening in the middle of it is how a job goes unfinished.
//
// A hand's card: how to recognise it, how to catch it early, what it is
// confused with, what to do first. Doses, rotation groups and the treatment
// plan are on the supervising view of the same card (#/guide/item), which this
// screen links to only for a role that may open it.

import { badge, button, card, cardHead, empty, esc, more, note } from './kit.js';
import { can } from '../store.js';
import { learnCard, LEARN_KINDS, learnSearch } from '../domain/learn.js';
import { cardPhoto, rowsForCard } from '../domain/diagnose.js';
import { params } from './shell.js';

let filter = { query: '', kind: '' };

const kindOf = (id) => LEARN_KINDS.find((k) => k.id === id) || { label: id, pic: '🌿' };

/** A picture, or the kind's pictogram when nobody has added one yet. */
function picture(held, kind, alt) {
  return held
    ? `<span class="tick-img"><img src="${held.photo.dataUrl}" alt="${esc(alt)}" loading="lazy"></span>`
    : `<span class="learn-pic" aria-hidden="true">${kindOf(kind).pic}</span>`;
}

export const learnView = {
  perm: 'viewGuide',
  render(ctx) {
    const list = learnSearch(filter.query, { category: filter.kind });
    return card(
      cardHead('Learn', badge(`${list.length}`))
      + '<p><small>The problems that hit pepper on this farm: what they look like, how to catch '
      + 'them early, and what to do first. Works with no signal.</small></p>'
      // FR-LEARN-03: the search is the way in — the screen's main action.
      + `<div class="field"><input name="learn-q" type="search" data-main-action="learn" placeholder="Search: yellow leaves, wilt, holes in fruit..." value="${esc(filter.query)}" autocomplete="off"></div>`
      + '<div class="row wrap">'
      + `<button class="chip ${!filter.kind ? 'on' : ''}" data-act="learn-kind" data-kind="">All</button> `
      + LEARN_KINDS.map((k) => `<button class="chip ${filter.kind === k.id ? 'on' : ''}" `
        + `data-act="learn-kind" data-kind="${esc(k.id)}">${k.pic} ${esc(k.label)}</button>`).join(' ')
      + '</div>',
      { tight: true },
    ) + card(
      list.length
        ? '<ul class="list">' + list.map((c) => `<li>${picture(cardPhoto(ctx.state, c.id), c.category, c.name)}`
          + `<div class="grow"><b>${esc(c.name)}</b><small>${esc(kindOf(c.category).label)} — `
          + `${esc(rowsForCard(c.id)[0] ? rowsForCard(c.id)[0].see : c.detection)}</small></div>`
          + `<a class="btn btn-sm btn-ghost" href="#/learn/card?id=${esc(c.id)}">Open</a></li>`).join('') + '</ul>'
        : empty('🔎', 'Nothing matched', 'Try fewer words, or a different kind.'),
    );
  },
  actions: {
    'learn-kind': (ctx, el) => { filter.kind = el.dataset.kind; ctx.refresh(); },
  },
  mounted() {
    const box = document.querySelector('input[name=learn-q]');
    if (!box) return;
    box.oninput = () => {
      filter.query = box.value;
      const ctx = window.__douvalueCtx;
      const pos = box.selectionStart;
      if (!ctx) return;
      ctx.refresh();
      const again = document.querySelector('input[name=learn-q]');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    };
  },
};

const bullets = (items) => (items.length
  ? '<ul>' + items.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '');

export const learnCardView = {
  perm: 'viewGuide',
  render(ctx) {
    const c = learnCard(ctx.state, params().id);
    if (!c) {
      return card(empty('📖', 'Not one of the cards', 'Go back and pick from the list.')
        + button('Back to Learn', 'go', { cls: 'btn-block', data: { to: '#/learn' } }));
    }
    const kind = kindOf(c.category);

    // docs/simplify-pass/07-learn.md: the one thing a hand does from a card —
    // report the plant in front of them — is at the top, not under the last
    // section. Learn links to the report; the report never links here
    // (FR-LEARN-01).
    let out = card(
      `<div class="card-head"><h2>${esc(c.name)}</h2>${badge(`${kind.pic} ${esc(kind.label)}`)}</div>`
      // Above the reference photo, so a tall picture never pushes it off the screen.
      + button('Seen this? Report a sick plant', 'go',
        { cls: 'btn-block', icon: '🌿', data: { to: '#/sick-plant', 'main-action': 'learn-card' } })
      + (c.photo
        ? `<div class="ref-shot"><img src="${c.photo.photo.dataUrl}" alt="${esc(c.name)}" loading="lazy"></div>`
        : '')
      + (c.drafted ? note('warn', 'Not yet reviewed',
        more('Why', `<small>${esc(c.drafted)}</small>`, { id: 'learn.drafted' })) : ''),
      { tight: true },
    );

    out += card(
      cardHead('How to recognise it')
      + `<p>${esc(c.recognise.detection)}</p>`
      + c.recognise.signs.map((s) => '<div class="row" style="align-items:flex-start;margin-bottom:10px">'
        + (s.photo ? picture(s.photo, c.category, s.see) : '')
        + `<div class="grow"><b>${esc(s.see)}</b></div></div>`).join('')
      + (c.recognise.checks.length
        ? `<h3>Check it by</h3>${bullets(c.recognise.checks)}` : ''),
    );

    if (c.catchEarly.length) {
      out += card(cardHead('How to catch it early') + bullets(c.catchEarly));
    }

    if (c.lookalikes.length) {
      out += card(
        cardHead('Often confused with')
        + '<ul class="list">' + c.lookalikes.map((l) => `<li>${picture(l.photo, l.category, l.name)}`
          + `<div class="grow"><b>${esc(l.name)}</b>`
          + (l.tellApart
            ? `<small>Tell them apart: ${esc(l.tellApart.test)} → ${esc(l.tellApart.pointsTo)}</small>`
            : '')
          + `</div><a class="btn btn-sm btn-ghost" href="#/learn/card?id=${esc(l.cardId)}">Open</a></li>`).join('')
        + '</ul>',
      );
    }

    out += card(
      cardHead('What to do first')
      + '<ol>' + c.firstSteps.map((s) => `<li>${esc(s)}</li>`).join('') + '</ol>'
      + button('Report a sick plant', 'go', { cls: 'btn-block btn-ghost', icon: '🌿', data: { to: '#/sick-plant' } }),
    );

    // FR-LEARN-02: the supervising view of the same card, for those who hold it.
    if (can(ctx.user, 'viewTreatment')) {
      out += card(
        button('Open the full card: doses, groups, treatment plan', 'go',
          { cls: 'btn-block btn-ghost', data: { to: `#/guide/item?id=${c.id}` } })
        + more('Why they are not here', '<small>Doses, rotation groups and the treatment plan are kept '
          + 'off this view, which is what a Greenhouse Hand sees. The full card has them.</small>',
        { id: 'learn.full-card-why' }),
        { tight: true },
      );
    }

    return out;
  },
};
