// The photo controls — FR-PROOF-01, FR-PROOF-02, FR-DIAG-01.
//
// These run without a browser, so they cover the wiring rather than the
// pixels: that the camera button can actually reach its own file input, and
// that the proof path and the reference path stay different from each other.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const photo = await import(new URL('ui/photo.js', base).href);

/** Just enough of an element for bindPhoto to wire itself to. */
function fakeInput(className) {
  const listeners = {};
  return {
    className,
    files: [],
    onchange: null,
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, event) { for (const fn of listeners[type] || []) fn(event); },
  };
}

const container = (input) => ({ querySelector: (sel) => (sel.includes(input.className) ? input : null) });

/**
 * The bug this guards against: the file input is display:none, so the button is
 * the only way in, and the button's handler calls input.click(). That click
 * bubbles to shell.js's delegate, which calls preventDefault() on any click
 * with a [data-act] ancestor — and nearly every photo control sits inside a
 * <form data-act="save-something">. The chooser never opened, and the form's
 * save handler ran instead. Every proof photo in the app was affected.
 */
for (const [name, bind, cls] of [
  ['proof', photo.bindPhoto, 'photo-input'],
  ['reference', photo.bindReferencePhoto, 'reference-input'],
]) {
  test(`the ${name} file input keeps its own click, so the chooser opens inside a form`, () => {
    const input = fakeInput(cls);
    bind(container(input));
    assert.ok((input.listeners.click || []).length, `${name}: nothing is guarding the click`);
    let stopped = false;
    let prevented = false;
    input.fire('click', {
      stopPropagation: () => { stopped = true; },
      preventDefault: () => { prevented = true; },
    });
    assert.equal(stopped, true, `${name}: the click must not reach the page delegate`);
    assert.equal(prevented, false, `${name}: cancelling it would close the chooser too`);
  });
}

test('binding a container with no input of its kind does nothing', () => {
  assert.doesNotThrow(() => photo.bindPhoto({ querySelector: () => null }));
  assert.doesNotThrow(() => photo.bindReferencePhoto({ querySelector: () => null }));
});

test('the two controls do not share an input or a pending picture', () => {
  // FR-PROOF-02 forbids a gallery upload as proof; a reference photo is
  // teaching material and may come from anywhere. Keeping the markup separate
  // is what stops that allowance leaking into the proof path.
  const proof = photo.photoField('Photo');
  const reference = photo.referencePhotoField('Reference');
  assert.match(proof, /capture="environment"/, 'proof photos are taken live');
  assert.doesNotMatch(reference, /capture=/, 'a reference photo may come from the gallery');
  assert.match(proof, /class="photo-input"/);
  assert.match(reference, /class="reference-input"/);
  assert.doesNotMatch(reference, /class="photo-input"/);
  // Different actions, so one button can never pick up the other's input.
  assert.match(proof, /data-act="pick-photo"/);
  assert.match(reference, /data-act="pick-reference"/);
});

test('nothing is pending until a picture is chosen', () => {
  photo.resetPhoto();
  photo.resetReferencePhoto();
  assert.equal(photo.photoPayload(), null);
  assert.equal(photo.referencePhotoPayload(), null);
});

test('a photo shows how old it was when it was attached', () => {
  assert.equal(photo.describeAge(null), 'unknown age');
  assert.equal(photo.describeAge(5), '5 min');
  assert.equal(photo.describeAge(120), '2 hours');
  assert.equal(photo.describeAge(4320), '3 days');
  assert.match(photo.photoThumb({ dataUrl: 'data:,x', fresh: false, ageMinutes: 4320 }), /3 days/);
  assert.match(photo.photoThumb({ dataUrl: 'data:,x', fresh: true }), /Taken at the time/);
  assert.equal(photo.photoThumb(null), '');
});
