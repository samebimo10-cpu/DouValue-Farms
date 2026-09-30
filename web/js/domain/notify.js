// What goes to the Owner's phone, and when — FR-REP-02, with D-1 settled.
//
// The channel is WhatsApp, text first, with an email copy if the farm server
// has one set up. Two kinds of message:
//
//   * The daily digest (FR-REP-01), once a day from DIGEST_HOUR farm time.
//   * Straight-to-Owner items — rules `escalation.immediate_to_owner`, plus a
//     treatment that went ahead before its approval (FR-ROLE-13). These go
//     the moment a phone that has seen them has signal, not the next morning.
//     By the time a tospovirus waits for a digest the house is gone.
//
// This file only decides WHAT and WHEN. It is pure, so the screens, the sync
// loop and the tests all get the same answer. Sending is the farm server's
// job, because the WhatsApp and email keys live there and never on a phone
// (NFR-SEC-03).
//
// Every message has a key. Any number of phones may offer the same one; the
// server sends each key once. That is what makes it safe for whichever phone
// happens to have signal first to be the one that raises the alarm.

import { straightToOwner } from './alerts.js';
import { digestText } from './digest.js';

/** The digest goes from 7 AM farm time (West Africa Time, UTC+1). */
export const DIGEST_HOUR = 7;

/**
 * How recent a straight-to-Owner item must be to go as its own message.
 * Anything older has already been in a digest, and connecting a farm for the
 * first time must not send the Owner a week of history in one burst.
 */
export const IMMEDIATE_WITHIN_HOURS = 48;

/**
 * Whose phones build and offer the daily digest. The people who run the work:
 * a hand's phone offers straight-to-Owner items (anyone may raise the alarm),
 * but the digest comes from somebody who sees the whole farm.
 */
export const DIGEST_ROLES = new Set(['supervisor', 'agronomist', 'manager', 'ceo']);

/** WhatsApp's own ceiling on a text message body. */
export const MAX_MESSAGE_CHARS = 4096;

const FARM_UTC_OFFSET_HOURS = 1;

/** The farm's calendar day and hour for an instant. */
export function farmNow(iso) {
  const t = new Date(new Date(iso).getTime() + FARM_UTC_OFFSET_HOURS * 3600000);
  return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

const fit = (text) => (text.length <= MAX_MESSAGE_CHARS
  ? text
  : `${text.slice(0, MAX_MESSAGE_CHARS - 40).trimEnd()}\n…more in the app.`);

/** One straight-to-Owner item as a message: a line to read on the lock screen, then what to do. */
export function immediateText(state, item) {
  const farm = (state.settings || {}).farmName || 'The farm';
  const urgent = item.kind === 'virus' || item.kind === 'bacterial_wilt';
  return fit([
    `${farm} — straight to you`,
    `${urgent ? '!!' : '!'} ${item.line}`,
    item.detail || '',
    'Open the app for the detail and the photos.',
  ].filter(Boolean).join('\n'));
}

/**
 * Everything this phone should offer the server right now.
 *
 * `role` is the signed-in person's. Returns `[{ key, kind, text }]`, newest
 * straight-to-Owner items first, then the digest. Keys are stable: the same
 * record gives the same key on every phone, every time.
 */
export function ownerMessages(state, { now = new Date().toISOString(), role = null, digestHour = DIGEST_HOUR } = {}) {
  const out = [];
  const since = new Date(new Date(now).getTime() - IMMEDIATE_WITHIN_HOURS * 3600000).toISOString();

  for (const item of straightToOwner(state, { now })) {
    const at = item.at || '';
    if (!at || at < since || at > now) continue;
    out.push({
      key: `now:${item.kind}:${item.id || at}`,
      kind: 'immediate',
      text: immediateText(state, item),
    });
  }

  const clock = farmNow(now);
  if (DIGEST_ROLES.has(role) && clock.hour >= digestHour) {
    out.push({ key: `digest:${clock.day}`, kind: 'digest', text: fit(digestText(state, { now })) });
  }
  return out;
}
