// Unlocking a phone with a PIN — NFR-SEC-02, Phase 1b.
//
// The farm server already locks an account for 15 minutes after five wrong
// passwords. The PIN pad on the phone had no limit at all: a four-digit PIN on
// a shared handset could be found by trying, a few minutes' work. This is the
// same rule on the phone — five wrong tries, then 15 minutes — counted per
// person and kept in the phone's storage, so closing and reopening the app
// does not reset it.
//
// And the digest a connected phone keeps of its owner's PIN is made slow and
// salted (PBKDF2), so copying it off the phone does not give the PIN away in a
// second. A phone still holding the old quick digest is moved to the new one
// the next time its owner signs in with the right PIN; nobody has to do
// anything.
//
// What this cannot do: someone with the phone and the skill to rewind its
// clock or edit its storage can get round a lock kept on the phone. The farm
// server's own lock, and its decision of what each person is sent, are the
// fence; this stops guessing at the pad.

export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ROUNDS = 100000;   // slow enough to matter, quick enough on a 2 GB phone (NFR-DEV-01)

/** Where one person stands at the pad: { locked, seconds } or { locked: false, left }. */
export function padState(rec, now = Date.now()) {
  const r = rec || {};
  if (r.lockedUntil && r.lockedUntil > now) return { locked: true, seconds: Math.ceil((r.lockedUntil - now) / 1000) };
  const fails = r.lockedUntil ? 0 : (r.fails || 0);
  return { locked: false, left: LOCK_AFTER - fails };
}

/** After a wrong PIN: count it, and lock on the fifth. */
export function afterWrongPin(rec, now = Date.now()) {
  const st = padState(rec, now);
  if (st.locked) return { ...rec };
  const fails = LOCK_AFTER - st.left + 1;
  return fails >= LOCK_AFTER ? { fails: 0, lockedUntil: now + LOCK_MS } : { fails, lockedUntil: 0 };
}

/** What the person is told after a wrong PIN, or when the pad is locked. */
export function padMessage(st) {
  if (st.locked) {
    const min = Math.ceil(st.seconds / 60);
    return `Too many wrong tries. Wait ${min} minute${min === 1 ? '' : 's'}, or ask the CEO.`;
  }
  return st.left <= 2 ? `Wrong. ${st.left} tr${st.left === 1 ? 'y' : 'ies'} left before the pad locks for 15 minutes.` : null;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(pin, salt, rounds) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: rounds, hash: 'SHA-256' }, key, 256));
}

/** The digest a connected phone keeps of its owner's PIN: pbkdf2$rounds$salt$hash. */
export async function devicePinDigest(pin, memberId, { rounds = ROUNDS } = {}) {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  const salt = `${memberId}:${hex(a)}`;
  return `pbkdf2$${rounds}$${salt}$${await pbkdf2(pin, salt, rounds)}`;
}

/**
 * Does this PIN match what the phone holds? `legacy` is the old quick digest
 * function (ui/shell.js hashPin), for a phone set up before this. Returns
 * { ok, upgrade } — upgrade is the new digest to store in place of an old one.
 */
export async function checkDevicePin(pin, memberId, stored, legacy) {
  if (!stored) return { ok: false, upgrade: null };
  if (String(stored).startsWith('pbkdf2$')) {
    const [, rounds, ...rest] = String(stored).split('$');
    const hash = rest.pop();
    const salt = rest.join('$');
    const got = await pbkdf2(pin, salt, Number(rounds));
    let diff = got.length ^ hash.length;
    for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
    return { ok: diff === 0, upgrade: null };
  }
  const ok = (await legacy(pin, memberId)) === stored;
  return { ok, upgrade: ok ? await devicePinDigest(pin, memberId) : null };
}

// --- Signing out a phone nobody is using — NFR-SEC-06 ------------------------
//
// Ten minutes with no tap or key and the phone goes back to the PIN pad, so
// the next person to pick up a shared handset does not work under the last
// one's name. Measured from the last tap, and checked when the app comes back
// to the front, so a phone left in a pocket for an hour asks again.

export const IDLE_MS = 10 * 60 * 1000;

/** Has this phone been left long enough to sign out? */
export function idleExpired(lastActiveMs, now = Date.now(), limit = IDLE_MS) {
  return Number.isFinite(lastActiveMs) && now - lastActiveMs >= limit;
}
