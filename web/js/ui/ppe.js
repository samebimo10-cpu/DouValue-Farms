// FR-TREAT-04 — the gear, shown as pictures, confirmed with a tap.
//
// The requirement is specific about the pictures, and it is right to be. A
// list of English words is a poster; a row of drawings the size of a thumb is
// something somebody actually looks at while pulling gloves on. They are drawn
// here as inline SVG rather than photographs because they have to survive a
// 2 GB phone with no signal and no data left, and because a line drawing reads
// in direct sun where a photograph does not.
//
// The tap matters too. Nobody is asked to agree to a policy — they are asked
// to confirm they are wearing the things on the screen, and that confirmation
// is stored on the spray record with their name against it.

import { closeSheet, esc, note, openSheet } from './kit.js';

/** One pictogram per item. Stroke only, so they take the text colour. */
const ART = {
  mask: '<path d="M7 19c0-3 5-5 17-5s17 2 17 5v5c0 8-7 14-17 14S7 32 7 24z"/>'
    + '<path d="M7 21H3v6h4M41 21h4v6h-4"/><path d="M13 23h22M15 29h18"/>',
  gloves: '<path d="M15 43V23a2.5 2.5 0 0 1 5 0v-4a2.5 2.5 0 0 1 5 0v-3a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1 5 0v10'
    + 'c0 6-2 8-2 14z"/><path d="M15 33h5"/>',
  goggles: '<rect x="5" y="17" width="15" height="13" rx="6.5"/><rect x="28" y="17" width="15" height="13" rx="6.5"/>'
    + '<path d="M20 23h8M5 20H1M43 20h4"/>',
  sleeves: '<path d="M18 7l6 5 6-5 11 6-4 9-5-2v23H16V20l-5 2-4-9z"/><path d="M24 12v8"/>',
  boots: '<path d="M13 5h11v23l12 6v11H13z"/><path d="M13 37h23"/><path d="M24 5v23"/>',
};

export function ppeIcon(id, size = 44) {
  const art = ART[id] || ART.mask;
  return `<svg class="ppe-art" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" `
    + 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
    + art + '</svg>';
}

/** The row of pictures, with what each one is for underneath. */
export function ppeGrid(kit) {
  return '<div class="ppe-grid">' + kit.items.map((item) =>
    `<figure class="ppe-item">${ppeIcon(item.icon)}`
    + `<figcaption><b>${esc(item.label)}</b><small>${esc(item.why)}</small></figcaption></figure>`).join('')
    + '</div>';
}

/**
 * Show the gear and wait for the tap. Resolves true only if they confirm.
 *
 * Opened before the spray form, not after it, because "before the task starts"
 * is the whole requirement: gear confirmed once the tank is already mixed is a
 * tick box, not protection.
 */
export function confirmPpe(kit, { title = 'Put this on first' } = {}) {
  return new Promise((resolve) => {
    const el = openSheet(
      `<h2>${esc(title)}</h2>`
      + `<p><small>${esc(kit.rule)}</small></p>`
      + ppeGrid(kit)
      + (kit.extra ? note('warn', 'Also', `<small>${esc(kit.extra)}</small>`) : '')
      + (kit.briefing
        ? note('danger', 'Team briefing first',
          `<small>${esc(kit.briefingText)}</small>`)
        : '')
      + (kit.after ? note('info', 'When you finish', `<small>${esc(kit.after)}</small>`) : '')
      + '<div class="row" style="margin-top:14px">'
      + '<button class="btn-ghost btn-block" data-role="no">Not yet</button>'
      + '<button class="btn-block btn-lg" data-role="yes">I am wearing all of this</button></div>',
    );
    el.querySelector('[data-role="yes"]').onclick = () => { closeSheet(); resolve(true); };
    el.querySelector('[data-role="no"]').onclick = () => { closeSheet(); resolve(false); };
  });
}
