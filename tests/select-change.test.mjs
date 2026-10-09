// A <select data-act> acts when the choice is made — FR-TREAT-02, FR-STOCK-01.
//
// On a phone the picker sends no click after the choice, and the app used to
// run a select's action only on click. Choosing a second bed on Log harvest
// left the form under the first bed: the picking was saved against the first
// bed, and a bed still inside its PHI was never checked. The spray form's
// dose and waiting-period hints stayed on the first product the same way.
//
// Real Chrome, the sample farm: choose the bed with a spray on it, the way the
// picker does (a change event and nothing else), and the PHI block is shown.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openPhone, skip } from './helpers/phone.mjs';

let phone = null;
before(async () => { if (!skip) phone = await openPhone(); });
after(async () => { if (phone) await phone.close(); });

test('FR-TREAT-02: choosing a bed inside its PHI on Log harvest blocks the picking', { skip, timeout: 120000 }, async () => {
  await phone.as('sp_emeka', '#/today');
  await phone.tap('[data-act="open-harvest"]');
  const first = await phone.evaluate(`document.querySelector('.sheet select[name=cycleId]').value`);
  assert.notEqual(first, 'sp_c2', 'the sample opens on a bed that may be picked');
  await phone.evaluate(`(() => {
    const sel = document.querySelector('.sheet select[name=cycleId]');
    sel.value = 'sp_c2';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await phone.page.waitFor(`!document.querySelector('.sheet form[data-act="save-harvest"]')`,
    { what: 'the form to give way to the PHI block', timeout: 5000 });
  assert.match(await phone.evaluate(`document.querySelector('#harvest-body').innerText`), /more days?\./);
});
