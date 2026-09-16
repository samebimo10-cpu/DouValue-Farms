// The field-conditions kit — section 5 of the requirements.
//
// "If a feature conflicts with this section on a field screen, this section
// wins." So these are not decorations. Every helper here exists because of a
// specific condition: wet hands, bright sun, time pressure, a shared phone, and
// a person who has been bending over plants since six.
//
// The one rule that shapes all of it: colour is never the only signal. UX-07
// fixes four meanings across the whole app, and every one of them carries a
// shape as well as a hue, because hue is the first thing direct sunlight takes
// and roughly one man in twelve cannot separate the red from the green anyway.

import { esc } from '../util.js';

/**
 * UX-07 — the four states, and nothing else.
 *
 * green = done/safe, yellow = check soon, red = act now, grey = not yet.
 * Anywhere in the app that wants to say "this is fine" or "deal with this"
 * comes through here, so the meaning cannot drift between screens.
 */
export const STATUS = {
  done: { key: 'done', icon: '✓', label: 'Done', tone: 'ok' },
  soon: { key: 'soon', icon: '!', label: 'Check soon', tone: 'warn' },
  now: { key: 'now', icon: '✕', label: 'Act now', tone: 'danger' },
  notyet: { key: 'notyet', icon: '·', label: 'Not yet', tone: 'muted' },
};

/** A state as text with its icon, for inline use. */
export function status(key, label) {
  const s = STATUS[key] || STATUS.notyet;
  return `<span class="status status-${s.key}"><span class="ic" aria-hidden="true">${s.icon}</span>`
    + `<span>${esc(label || s.label)}</span></span>`;
}

/** The same state as a filled chip, for a card corner. */
export function tag(key, label) {
  const s = STATUS[key] || STATUS.notyet;
  return `<span class="tag tag-${s.key}"><span aria-hidden="true">${s.icon}</span>`
    + `<span>${esc(label || s.label)}</span></span>`;
}

/**
 * Which of the four a task is in, from its own timing.
 *
 * Kept here rather than in each screen so a task looks the same colour on the
 * hand's home screen, the supervisor's list and the manager's board.
 */
export function taskStatus(task, now = new Date()) {
  if (!task) return 'notyet';
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return 'notyet';
  if (!task.due) return 'soon';

  const due = new Date(task.due);
  if (Number.isNaN(due.getTime())) return 'soon';
  if (due < now) return 'now';
  // Inside two hours is "soon"; anything further out is simply later today.
  if (due - now < 2 * 3600 * 1000) return 'soon';
  return 'notyet';
}

/** UX-04 — the figure someone came to the screen to read. */
export function bigNumber(value, label = '') {
  return `<div class="big-number">${esc(value)}</div>`
    + (label ? `<small>${esc(label)}</small>` : '');
}

/**
 * UX-24 — "4 of 7 done".
 *
 * The count is stated in words as well as drawn as a bar, because a bar on its
 * own is a shape and a shape is not an answer to "how much is left".
 */
export function dayProgressBar(progress) {
  const pct = Math.round((progress.fraction || 0) * 100);
  return '<div class="day-progress">'
    + `<span class="count">${esc(progress.text)}</span>`
    + `<span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>`
    + '</div>';
}

/**
 * UX-15 — phrases to tap instead of typing.
 *
 * Chosen from what actually gets written on a farm: the same dozen
 * observations, typed slowly, one-handed, standing up. Tapping one drops it
 * into the field and leaves it editable, so it is a head start rather than a
 * fixed list.
 */
export const QUICK_PHRASES = {
  scout: ['Nothing found', 'Aphids on young leaves', 'Thrips on the flowers',
    'Whitefly under the leaves', 'Leaves curling', 'Spots on the fruit'],
  trap: ['Traps replaced', 'Trap full', 'Trap missing', 'Card still clean'],
  irrigate: ['Watered as normal', 'Drip line blocked', 'Tank was empty', 'Ground still wet'],
  fertigate: ['Fed as planned', 'Line blocked, flushed it', 'Ran short of mix'],
  prune: ['Pruned and tied', 'Lower leaves off', 'Some plants bending'],
  harvest: ['Picked as normal', 'Plenty ripe', 'Some fruit spoiled', 'Rain stopped picking'],
  sanitation: ['Cleaned down', 'Footbath refilled', 'Fallen fruit cleared'],
  report: ['Plants wilting', 'Leaves yellow', 'Something eating the fruit',
    'Water not reaching', 'Fence or door damaged'],
};

/** The phrase chips for a kind of record. `target` is the field they fill. */
export function phraseChips(kind, target = 'note') {
  const list = QUICK_PHRASES[kind];
  if (!list) return '';
  return '<div class="phrases">'
    + list.map((text) => '<button type="button" class="btn-ghost" data-act="phrase" '
      + `data-target="${esc(target)}" data-text="${esc(text)}">${esc(text)}</button>`).join('')
    + '</div>';
}

/** Drop a phrase into its field, appending rather than replacing. */
export function applyPhrase(el) {
  const form = el.closest('form') || document;
  const field = form.querySelector(`[name="${el.dataset.target}"]`);
  if (!field) return;
  const existing = String(field.value || '').trim();
  field.value = existing ? `${existing}. ${el.dataset.text}` : el.dataset.text;
  field.focus();
}

/**
 * UX-21 — what you are about to commit to, before you commit to it.
 *
 * Shown before anything that spends money or puts chemical on a crop. The
 * requirement gives the shape: "GH-03 · thrips · spray · product · dose".
 */
export function confirmSummary(rows) {
  return '<dl class="confirm-summary">'
    + rows.filter((r) => r && r[1] != null && r[1] !== '')
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')
    + '</dl>';
}

/**
 * UX-20 — the app answering back.
 *
 * A tick and a short buzz on success. The buzz matters more than it looks:
 * somebody wearing gloves, in sun, with the phone at arm's length often cannot
 * read a toast, but they can feel it.
 */
export function buzz(pattern = 20) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // A phone that will not vibrate still shows the toast.
  }
}

/**
 * UX-16 — an interrupted note is not lost.
 *
 * Drafts are per-form and per-device, in localStorage rather than the event
 * log: a half-typed observation is not a record of anything and has no business
 * syncing to everyone else's phone.
 */
const DRAFT_PREFIX = 'douvalue.draft.';

export function saveDraft(key, form) {
  try {
    const data = {};
    for (const el of form.querySelectorAll('input, textarea, select')) {
      if (!el.name || el.type === 'file' || el.type === 'password') continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    if (Object.values(data).every((v) => v === '' || v === false)) {
      localStorage.removeItem(DRAFT_PREFIX + key);
      return;
    }
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(data));
  } catch {
    // A phone with storage blocked simply has no drafts.
  }
}

export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  try { localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nothing to clear */ }
}

/** Wire a form so it saves itself as it is typed, and restores what was there. */
export function bindDraft(container, key) {
  const form = container.querySelector ? container.querySelector('form') : null;
  if (!form) return;

  const saved = loadDraft(key);
  if (saved) {
    for (const [name, value] of Object.entries(saved)) {
      const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    }
  }

  let timer = null;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveDraft(key, form), 400);
  });
  form.addEventListener('submit', () => clearDraft(key));
}

/**
 * UX-22 — the Field Supervisor, one tap away.
 *
 * A hand who finds something they do not understand should be able to ask
 * somebody, from the screen they found it on, without leaving the app to hunt
 * through contacts.
 */
export function callSupervisor(state) {
  const supervisor = Object.values(state.people || {})
    .filter((p) => p.active !== false && p.phone)
    .sort((a, b) => {
      const rank = { supervisor: 0, manager: 1, agronomist: 2 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
    })[0];
  if (!supervisor) return '';

  return `<a class="btn btn-ghost btn-block" href="tel:${esc(supervisor.phone)}">`
    + `<span aria-hidden="true">📞</span>Call ${esc(supervisor.name)}</a>`;
}

/**
 * UX-17 — the language this person reads, remembered per person.
 *
 * On a shared phone the setting cannot belong to the handset: two people using
 * one phone read different languages, and making the second person change it
 * back every morning is how a feature becomes an annoyance.
 */
export function languageFor(person) {
  return (person && person.language) || null;
}
