// Scanning a zone code — UX-12, FR-PROOF-03.
//
// "Zone is chosen from a list or farm map, or by scanning a QR code on the
// greenhouse door. Scanning is quickest and is offered first."
//
// Offered first, not required. The phones this runs on are cheap Android
// handsets, and BarcodeDetector is missing on plenty of them; the camera can
// also be refused, broken, or pointed at a label somebody has peeled off. Every
// one of those is an ordinary Tuesday, so the list is always there underneath,
// one tap away, and the app never tells somebody standing in a greenhouse that
// it cannot get on with the job.
//
// The decision of which to offer is separated from the camera work below so it
// can be tested without one.

import { badge, button, closeSheet, esc, note, openSheet, toast } from './kit.js';
import { matchZone, parseZoneCode } from '../domain/qr.js';

/** Can this phone read a code at all? */
export function scanSupported(scope = globalThis) {
  return typeof scope !== 'undefined'
    && 'BarcodeDetector' in scope
    && !!(scope.navigator && scope.navigator.mediaDevices
      && scope.navigator.mediaDevices.getUserMedia);
}

/**
 * What to put in front of somebody who has to choose a zone.
 *
 * Scanning first where it works, the list first where it does not, and the
 * other one always reachable. The reason is carried so the screen can say
 * "this phone cannot scan" rather than silently offering less.
 */
export function zonePicker({ supported = scanSupported(), reason = null } = {}) {
  if (supported) {
    return {
      offer: 'scan',
      primary: { act: 'scan-zone', label: 'Scan the code on the door', icon: '📷' },
      fallback: { act: 'pick-zone', label: 'Choose from the list', icon: '📋' },
      why: 'Scanning is quickest, and it proves which house you are standing in.',
    };
  }
  return {
    offer: 'list',
    primary: { act: 'pick-zone', label: 'Choose the zone', icon: '📋' },
    fallback: null,
    why: reason || 'This phone cannot scan codes, so the list is the way in.',
  };
}

/**
 * Open the camera and wait for a zone code.
 *
 * Resolves with the scanned text, or null if the person closed it or the camera
 * would not start. Never throws at the caller: a failed scan falls back to the
 * list, which is a worse answer, not an error.
 */
export async function scanOnce({ scope = globalThis, timeoutMs = 30000 } = {}) {
  if (!scanSupported(scope)) return null;
  let stream = null;
  let stop = null;

  try {
    stream = await scope.navigator.mediaDevices.getUserMedia({
      // The back camera, and nothing more: no audio, no high resolution, no
      // torch. NFR-DEV-03 — this runs on a phone somebody needs all day.
      video: { facingMode: 'environment' },
    });
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    await video.play();

    const detector = new scope.BarcodeDetector({ formats: ['qr_code'] });
    const sheet = openSheet('<h2>Scan the door code</h2>'
      + '<div class="scan-box" id="scan-box"></div>'
      + '<p><small>Hold the phone about a hand\'s width from the code. It reads itself — there '
      + 'is nothing to press.</small></p>'
      + button('Choose from the list instead', 'close-scan', { cls: 'btn-ghost btn-block' }));
    sheet.querySelector('#scan-box').appendChild(video);

    return await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(bell);
        resolve(value);
      };
      stop = finish;

      const timer = setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((c) => parseZoneCode(c.rawValue));
          if (hit) finish(hit.rawValue);
        } catch {
          // A frame that will not decode is the normal case, not a failure.
        }
      }, 400);
      const bell = setTimeout(() => finish(null), timeoutMs);

      sheet.querySelector('[data-act="close-scan"]').onclick = () => finish(null);
      sheet.addEventListener('click', (e) => { if (e.target === sheet) finish(null); });
    });
  } catch {
    return null;
  } finally {
    if (stop) stop(null);
    if (stream) for (const track of stream.getTracks()) track.stop();
    closeSheet();
  }
}

/**
 * Scan, then say what was scanned — the whole gesture, for a caller that just
 * wants a zone.
 *
 * `expectZoneId` turns it into the check FR-PROOF-03 asks for: scanning the
 * wrong door comes back as a refusal naming both houses rather than as a quiet
 * substitution.
 */
export async function scanZone(state, { expectZoneId = null, scope = globalThis } = {}) {
  const text = await scanOnce({ scope });
  if (text == null) return { ok: false, reason: 'cancelled' };
  const result = matchZone(state, text, { expectZoneId });
  if (!result.ok) toast(result.why, true);
  return result;
}

/** The zone list, for the fallback and for anybody who prefers it (UX-12). */
export function zoneListSheet(state, { title = 'Which zone?', act = 'choose-zone', why = null } = {}) {
  const zones = Object.values(state.plots || {}).filter((z) => !z.retired);
  return `<h2>${esc(title)}</h2>`
    + (why ? note('info', why, '') : '')
    + (zones.length
      ? '<ul class="list big">' + zones.map((z) => `<li data-act="${esc(act)}" data-id="${esc(z.id)}">`
        + `<div class="grow"><b>${esc(z.name)}</b>`
        + `<small>${esc(z.type === 'field' ? 'Open field' : 'Greenhouse')}</small></div>`
        + badge('choose', 'muted') + '</li>').join('') + '</ul>'
      : '<p>No zones have been added yet.</p>');
}
