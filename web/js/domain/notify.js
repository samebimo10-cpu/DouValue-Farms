// What goes to the Owner's WhatsApp, and when — FR-REP-02.
//
// The channel is WhatsApp, text first: a few hundred bytes of plain text that
// arrive on one bar of signal, with the photos left in the app for when the
// Owner asks for them. Two kinds of message:
//
//   * The daily digest (FR-REP-01), once a day from DIGEST_HOUR farm time.
//   * Straight-to-Owner items — the rules' `escalation.immediate_to_owner`
//     list, plus a treatment that went ahead before its approval
//     (FR-ROLE-13). These go when they happen, not the next morning: by the
//     time a tospovirus waits for a digest the house is gone.
//
// This file decides only WHAT and WHEN, and it is pure, so the sync loop, the
// Alerts screen and the tests get the same answer. Sending is the farm
// server's job, because the WhatsApp key lives there and never on a phone.
//
// Every message has a stable key. Any number of phones may offer the same
// one; the server sends each key once. That is what lets whichever phone has
// signal first be the one that raises the alarm.

import { straightToOwner } from './alerts.js';
import { digestText } from './digest.js';
import { FARM_UTC_OFFSET_HOURS } from './selfcheck.js';

/** The digest goes from 7 AM farm time. */
export const DIGEST_HOUR = 7;

/**
 * How recent a straight-to-Owner item must be to go on its own. Anything older
 * has been in a digest already, and connecting a farm for the first time must
 * not send the Owner a week of history in one burst.
 */
export const IMMEDIATE_WITHIN_HOURS = 48;

/** Whose phones offer the digest: the people who see the whole farm. Anyone raises an alarm. */
export const DIGEST_ROLES = new Set(['supervisor', 'agronomist', 'manager', 'ceo']);

/** WhatsApp's own ceiling on a text body. */
export const MAX_MESSAGE_CHARS = 4096;

/** The farm's calendar day and hour for an instant. */
export function farmClock(iso) {
  const t = new Date(Date.parse(iso) + FARM_UTC_OFFSET_HOURS * 3600000);
  return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

const fit = (text) => (text.length <= MAX_MESSAGE_CHARS
  ? text
  : `${text.slice(0, MAX_MESSAGE_CHARS - 40).trimEnd()}\n…more in the app.`);

/** One straight-to-Owner item: a line for the lock screen, then what to do. */
export function immediateText(state, item) {
  const farm = (state.settings || {}).farmName || 'The farm';
  const urgent = item.kind === 'virus' || item.kind === 'bacterial_wilt';
  return fit([
    `${farm} — straight to you`,
    `${urgent ? '!!' : '!'} ${item.line}`,
    item.detail || '',
    'Photos in the app.',
  ].filter(Boolean).join('\n'));
}

/**
 * Everything this phone should offer the farm server now: `[{ key, kind, text }]`,
 * straight-to-Owner items first, then the digest once it is due. `role` is the
 * signed-in person's. Keys are the same on every phone, every time.
 */
export function ownerMessages(state, { now = new Date().toISOString(), role = null, digestHour = DIGEST_HOUR } = {}) {
  const out = [];
  const since = new Date(Date.parse(now) - IMMEDIATE_WITHIN_HOURS * 3600000).toISOString();
  for (const item of straightToOwner(state, { now })) {
    const at = item.at || '';
    if (!at || at < since || at > now) continue;
    out.push({ key: `now:${item.kind}:${item.id || at}`, kind: 'immediate', text: immediateText(state, item) });
  }
  const clock = farmClock(now);
  if (DIGEST_ROLES.has(role) && clock.hour >= digestHour) {
    out.push({ key: `digest:${clock.day}`, kind: 'digest', text: fit(digestText(state, { now })) });
  }
  return out;
}
