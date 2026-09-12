// Attaching a picture to a record, and showing it back honestly.
//
// One helper rather than four copies, because every place that takes a photo
// needs the same three things: a button big enough for a thumb, a preview so
// people know it worked, and the provenance that lets the CEO tell a picture
// taken at the bed from one pulled out of the gallery a week later.

import { captureEvidence } from '../db.js';
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

/** Wire the hidden file input inside a container. Call after opening the sheet. */
export function bindPhoto(container = document) {
  const input = container.querySelector('.photo-input');
  if (!input) return;
  resetPhoto();
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
