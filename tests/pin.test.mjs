// The sign-in pad takes a PIN of 4 to 12 digits. UX-01, UX-02, NFR-SEC-02.
//
// The join screen, the sync setup and the server have always accepted 4 to 12
// digits, but the pad stopped at four and submitted on the fourth press. A
// person who chose a six-digit PIN when they joined was then locked out of
// their own phone for good: the pad sent the first four digits, the check
// failed, and there was no way to type the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { isPin, pinDotsHtml, PIN_MAX, PIN_MIN, pressPinKey } = await import(
  new URL('../web/js/ui/shell.js', import.meta.url).href);

const shellSource = readFileSync(new URL('../web/js/ui/shell.js', import.meta.url), 'utf8');
const manageSource = readFileSync(new URL('../web/js/ui/manage.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');

function type(digits) {
  let pin = '';
  const presses = [];
  for (const d of digits) {
    const r = pressPinKey(pin, d);
    presses.push(r);
    pin = r.pin;
  }
  return { pin, presses };
}

test('the pad does not submit at four digits, or at any count, until ✓', () => {
  const { pin, presses } = type('123456');
  assert.equal(pin, '123456', 'the fifth and sixth digits are kept');
  assert.ok(presses.every((p) => !p.submit), 'no digit press ever submits');
  assert.deepEqual(pressPinKey(pin, 'ok'), { pin: '123456', submit: true });
});

test('4 to 12 digits submit on ✓; fewer are refused with what to do next', () => {
  for (let n = PIN_MIN; n <= PIN_MAX; n++) {
    const pin = '9'.repeat(n);
    assert.equal(pressPinKey(pin, 'ok').submit, true, `${n} digits`);
    assert.equal(isPin(pin), true);
  }
  const short = pressPinKey('123', 'ok');
  assert.equal(short.submit, false);
  assert.match(short.why, /4 to 12 digits/, 'UX-20: says what to do, not a technical error');
  assert.equal(pressPinKey('', 'ok').submit, false);
});

test('the pad stops taking digits at twelve, and ⌫ takes one off', () => {
  const { pin } = type('1234567890123');
  assert.equal(pin, '123456789012');
  assert.equal(pressPinKey(pin, 'back').pin, '12345678901');
  assert.equal(pressPinKey('', 'back').pin, '');
  assert.equal(pressPinKey('12', 'x').pin, '12', 'only digits are typed');
});

test('the dots start at four and grow with what is typed', () => {
  const count = (html) => (html.match(/<span/g) || []).length;
  const on = (html) => (html.match(/class="on"/g) || []).length;
  assert.equal(count(pinDotsHtml(0)), 4);
  assert.equal(on(pinDotsHtml(2)), 2);
  assert.equal(count(pinDotsHtml(7)), 7);
  assert.equal(on(pinDotsHtml(7)), 7);
  assert.equal(count(pinDotsHtml(12)), 12);
});

test('the pad\'s digit handler never calls sign-in itself', () => {
  // The bug was one line in the handler — `if (length === 4) pin-ok` — so the
  // handler itself is what this pins down.
  const handler = /'pin-key': \(c, el\) => \{[^\n]*\}/.exec(shellSource);
  assert.ok(handler, 'the pin-key handler is a single line');
  assert.doesNotMatch(handler[0], /pin-ok/);
  assert.match(shellSource, /'pin-ok': async \(c\) => \{\s*const press = pressPinKey\(pending\.pin, 'ok'\);/);
});

test('every screen that sets a PIN takes the same 4 to 12 the server does', () => {
  assert.match(serverSource, /\/\^\\d\{4,12\}\$\/\.test\(pin\)/, 'join');
  assert.match(serverSource, /\/\^\\d\{4,12\}\$\/\.test\(String\(body\.newPin\)\)/, 'PIN change');
  assert.equal(PIN_MIN, 4);
  assert.equal(PIN_MAX, 12);
  for (const [name, src] of [['shell.js', shellSource], ['manage.js', manageSource]]) {
    assert.doesNotMatch(src, /\\d\{4\}\$/, `${name} still insists on exactly four digits somewhere`);
  }
});
