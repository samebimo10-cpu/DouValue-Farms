// Attaching a picture to a record, and showing it back honestly.
//
// One helper rather than four copies, because every place that takes a photo
// needs the same three things: a button big enough for a thumb, a preview so
// people know it worked, and the provenance that lets the CEO tell a picture
// taken at the bed from one pulled out of the gallery a week later.

import { captureEvidence, compressImage } from '../db.js';
import { button, esc, toast } from './kit.js';

let pending = null;

export function resetPhoto() { pending = null; }
export function takenPhoto() { return pending; }

/** The photo control, to drop into any sheet. */
export function photoField(label = 'Add a photo', hint = '') {
  return '<div class="field"><label>' + esc(label) + '</label>'
    + '<input type="file" accept="image/*" capture="environment" name="photo" class="photo-input">'
    + button('📷 ' + label, 'pick-photo', { cls: 'btn-ghost btn-block' })
    + '<div class="photo-preview" id="photo-preview"></div>'
    + (hint ? `<div class="hint">${esc(hint)}</div>` : '')
    + '</div>';
}

/**
 * Keep the synthetic click inside the file input.
 *
 * The camera button is the only way in — the input itself is display:none — so
 * the button's handler calls input.click(). That click bubbles like any other,
 * and shell.js's delegate calls preventDefault() on every click that has a
 * [data-act] ancestor. Almost every photo control sits inside a
 * <form data-act="save-something">, so the delegate was cancelling the file
 * chooser before it opened and running the form's save handler instead: the
 * button appeared to do nothing but scold you for not taking a photo.
 *
 * Stopping propagation at the input is the narrowest fix. The input carries no
 * data-act of its own, so nothing else wants this click.
 */
function keepClickLocal(input) {
  input.addEventListener('click', (e) => e.stopPropagation());
}

/** Wire the hidden file input inside a container. Call after opening the sheet. */
export function bindPhoto(container = document) {
  const input = container.querySelector('.photo-input');
  if (!input) return;
  resetPhoto();
  keepClickLocal(input);
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      pending = await captureEvidence(file);
      const preview = container.querySelector('#photo-preview');
      if (preview) preview.innerHTML = previewMarkup(pending);
    } catch (err) {
      toast(err.message || 'Could not use that picture', true);
    }
  };
}

function previewMarkup(photo) {
  const note = photo.fresh === true
    ? '<span class="badge ok">taken just now</span>'
    : photo.fresh === false
      ? `<span class="badge warn">from the gallery, ${describeAge(photo.ageMinutes)} old</span>`
      : '';
  return `<img src="${photo.dataUrl}" alt="Attached photo" class="photo-shot">`
    + `<div class="photo-meta">${note}<small>${Math.round(photo.bytes / 1024)} KB</small></div>`;
}

export function describeAge(minutes) {
  if (minutes == null) return 'unknown age';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 36) return `${Math.round(minutes / 60)} hours`;
  return `${Math.round(minutes / 1440)} days`;
}

/** The shape stored on a record. Null when nobody attached anything. */
export function photoPayload() {
  if (!pending) return null;
  return {
    dataUrl: pending.dataUrl,
    takenAt: pending.takenAt,
    attachedAt: pending.attachedAt,
    fresh: pending.fresh,
    ageMinutes: pending.ageMinutes,
    bytes: pending.bytes,
  };
}

// --- Reference photos ----------------------------------------------------
//
// A reference photo is a different kind of picture from everything else here,
// and needs a different control.
//
// A proof photo is evidence: FR-PROOF-02 says it is taken live in the app and a
// gallery upload is not accepted, and the freshness stamp above exists to catch
// one that was not. A reference photo is teaching material — the picture of
// what broad-mite damage looks like that sits beside the triage row. It may
// well come off the training deck or the consultant's phone, so the gallery is
// allowed and there is no freshness to judge. Keeping the two controls apart is
// what stops that allowance leaking into the proof path.
//
// It is also a little larger: this one has to be good enough to recognise a
// mite by, not just to show that a trap was checked.

let pendingReference = null;

export function resetReferencePhoto() { pendingReference = null; }

export function referencePhotoField(label = 'Choose a reference photo') {
  return '<div class="field"><label>' + esc(label) + '</label>'
    + '<input type="file" accept="image/*" name="reference" class="reference-input">'
    + button('🖼 ' + label, 'pick-reference', { cls: 'btn-ghost btn-block' })
    + '<div class="photo-preview" id="reference-preview"></div>'
    + '<div class="hint">Camera or gallery. It is kept at 720 px so every phone on the farm '
    + 'can carry all of them.</div></div>';
}

export function bindReferencePhoto(container = document) {
  const input = container.querySelector('.reference-input');
  if (!input) return;
  resetReferencePhoto();
  keepClickLocal(input);
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 720, 0.72);
      pendingReference = { dataUrl, bytes: Math.round((dataUrl.length * 3) / 4) };
      const preview = container.querySelector('#reference-preview');
      if (preview) {
        preview.innerHTML = `<img src="${dataUrl}" alt="Reference photo" class="photo-shot">`
          + `<div class="photo-meta"><small>${Math.round(pendingReference.bytes / 1024)} KB</small></div>`;
      }
    } catch (err) {
      toast(err.message || 'Could not use that picture', true);
    }
  };
}

export function referencePhotoPayload() {
  if (!pendingReference) return null;
  return { dataUrl: pendingReference.dataUrl, bytes: pendingReference.bytes };
}

/** A thumbnail with its provenance, for lists and the evidence board. */
export function photoThumb(photo, opts = {}) {
  if (!photo) return '';
  const src = typeof photo === 'string' ? photo : photo.dataUrl;
  if (!src) return '';
  const meta = typeof photo === 'string' ? null : photo;
  return `<figure class="photo-figure ${opts.small ? 'small' : ''}">`
    + `<img src="${src}" alt="${esc(opts.alt || 'Photo attached to this record')}" loading="lazy">`
    + (meta && meta.fresh === false
      ? `<figcaption class="warn-text">Taken ${describeAge(meta.ageMinutes)} before it was attached</figcaption>`
      : meta && meta.fresh === true
        ? '<figcaption>Taken at the time</figcaption>' : '')
    + '</figure>';
}
