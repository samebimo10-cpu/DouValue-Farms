// The farm server's brain: who may join, who may read what, and who may write it.
//
// Runtime-agnostic on purpose. It takes a Request and a storage adapter and
// returns a Response, so the same code runs behind node:http and behind
// Deno.serve with nothing but a thin shim on either side.
//
// WHY THIS EXISTS
//
// The first version of sync used one shared farm key. It kept the books off the
// open internet, but anyone holding the join code could read everything, wages
// included, and roles were only enforced in the app, which is to say not
// enforced at all: a curl command with the key could do anything.
//
// This version fixes that properly.
//
//   * Every person has their own account. There is no shared key.
//   * A device is enrolled by a single-use invite that expires. A PIN on its own
//     never gets you in from a new phone, so a shouted-across-the-yard PIN is
//     useless to anyone who was not given an invite.
//   * The server decides what each role may read and write. The app's role
//     checks are now a convenience for the person using it; this is the fence.
//   * Events are stamped with the authenticated author, so nobody can file work
//     under someone else's name.

// --- Roles ----------------------------------------------------------------
// Mirrors web/js/store.js. The app's copy shapes the screens; this copy decides.

export const ROLES = {
  hand: {
    rank: 10,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose'],
  },
  supervisor: {
    rank: 50,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout'],
  },
  agronomist: {
    rank: 60,
    can: ['viewOwnTasks', 'viewGuide', 'diagnose', 'scout', 'logSpray', 'prescribe', 'manageCycles',
      'viewTeam', 'viewReports', 'assignTasks'],
  },
  manager: {
    rank: 80,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings'],
  },
  ceo: {
    rank: 100,
    can: ['clockIn', 'logWork', 'logHarvest', 'reportProblem', 'viewOwnTasks', 'viewGuide', 'diagnose',
      'assignTasks', 'verifyHarvest', 'logSpray', 'logInputs', 'viewTeam', 'manageCycles', 'scout',
      'prescribe', 'viewReports', 'manageMoney', 'managePeople', 'settings',
      'manageOwners', 'manageSync', 'viewAudit', 'wipeFarm'],
  },
};

export const can = (role, permission) => !!ROLES[role] && ROLES[role].can.includes(permission);
export const rankOf = (role) => (ROLES[role] ? ROLES[role].rank : -1);

/** Which roles a person may hand out: the CEO anyone, everyone else below themselves. */
export function assignableRoles(role) {
  if (!can(role, 'managePeople')) return [];
  if (can(role, 'manageOwners')) return Object.keys(ROLES);
  return Object.keys(ROLES).filter((r) => rankOf(r) < rankOf(role));
}

// --- What each kind of record is, and who may touch it ---------------------

const ANY = 'viewGuide';   // every role holds this, so it means "everyone on the farm"

/**
 * write: the permission needed to file this kind of record.
 * read:  the permission needed to receive it at all.
 * redact: strips fields the reader has no business seeing.
 */
export const EVENT_POLICY = {
  'settings.update':   { write: 'settings',      read: ANY, redact: redactSettings },
  'person.upsert':     { write: 'managePeople',  read: ANY, redact: redactPerson, guard: guardPersonWrite },
  'person.deactivate': { write: 'managePeople',  read: ANY, guard: guardPersonWrite },
  'plot.upsert':       { write: 'manageCycles',  read: ANY },
  'plot.remove':       { write: 'manageCycles',  read: ANY },
  'cycle.start':       { write: 'manageCycles',  read: ANY },
  'cycle.update':      { write: 'manageCycles',  read: ANY },
  'cycle.close':       { write: 'manageCycles',  read: ANY },
  'task.create':       { write: 'assignTasks',   read: ANY },
  'task.update':       { write: 'assignTasks',   read: ANY },
  'task.complete':     { write: 'viewOwnTasks',  read: ANY },
  'task.cancel':       { write: 'assignTasks',   read: ANY },
  'attendance.in':     { write: 'clockIn',       read: ANY },
  'attendance.out':    { write: 'clockIn',       read: ANY },
  'work.log':          { write: 'logWork',       read: ANY },
  'harvest.record':    { write: 'logHarvest',    read: ANY },
  'harvest.verify':    { write: 'verifyHarvest', read: ANY },
  'spray.record':      { write: 'logSpray',      read: ANY },
  'scout.record':      { write: 'scout',         read: ANY },
  'diagnosis.record':  { write: 'diagnose',      read: ANY },
  'report.record':     { write: 'reportProblem', read: ANY },
  'report.resolve':    { write: 'assignTasks',   read: ANY },
  'input.upsert':      { write: 'logInputs',     read: ANY, guard: guardInputUpsert },
  // FR-STOCK-06/09 — the catalogue. Adding an active ingredient is the Owner's
  // alone (`manageOwners` is the CEO and nobody else); attaching a brand label
  // to an active that is already in the catalogue is the Farm Manager's.
  //
  // Every phone builds the catalogue from rules/douvalue_rules_rev5_1.json and
  // drops a banned active on the way in, so an `active.add` naming carbofuran
  // never becomes a catalogue entry anywhere. The server refuses it as well,
  // because the phone is the thing an attacker controls and five handsets
  // merging a log is how a bad record would otherwise arrive. See
  // BANNED_ACTIVES below for why the names are repeated here and what stops
  // that copy going stale.
  'active.add':        { write: 'manageOwners',  read: ANY, guard: guardActiveAdd },
  'label.add':         { write: 'settings',      read: ANY, guard: guardLabelAdd },
  'label.retire':      { write: 'settings',      read: ANY },
  'input.receive':     { write: 'logInputs',     read: ANY },
  'input.issue':       { write: 'logInputs',     read: ANY },
  'weather.record':    { write: 'logWork',       read: ANY },

  // Gates (requirements 6.2). These decide whether planting and spraying are
  // allowed at all, so who may write them matters more than most.
  //
  // A soil test is evidence, and evidence is recorded by whoever took the
  // sample — but only somebody who runs cycles may say a batch of bought-in
  // topsoil is now filling a particular house.
  'soiltest.record':   { write: 'scout',         read: ANY },
  'topsoil.receive':   { write: 'logInputs',     read: ANY },
  'topsoil.assign':    { write: 'manageCycles',  read: ANY },
  // FR-DIAG-03: a hand may start a diagnosis, only a senior may confirm one,
  // and a confirmed diagnosis is what unlocks a treatment.
  'diagnosis.confirm': { write: 'verifyHarvest', read: ANY },
  // FR-GATE-07: the Owner alone may override a gate, and the reason is part of
  // the record. `manageOwners` is held by the CEO and nobody else.
  'gate.override':        { write: 'manageOwners', read: ANY, guard: guardOverride },
  'gate.override.revoke': { write: 'manageOwners', read: ANY },

  // The Farm Doctor (requirements 6.14). It is not a person and holds no
  // account, so every one of its outputs is filed by whoever was holding the
  // phone — and confirmed, separately, by somebody senior enough to be worth
  // asking. FR-DOC-08 is the reason confirm and approve are three different
  // record types rather than three fields on one.
  'doctor.record':     { write: 'diagnose',      read: ANY },
  'doctor.confirm':    { write: 'verifyHarvest', read: ANY, guard: guardDoctorConfirm },
  'doctor.approve':    { write: 'prescribe',     read: ANY, guard: guardDoctorConfirm },
  'doctor.owner-seen': { write: 'viewReports',   read: ANY },
  // FR-DOC-06: one line of a gate's evidence, recorded by whoever did the work.
  'gate.evidence':     { write: 'scout',         read: ANY, guard: guardGateEvidence },
  // FR-DIAG-05: a sample, from recommendation to result.
  'lab.record':        { write: 'scout',         read: ANY },
  'lab.send':          { write: 'scout',         read: ANY, guard: guardLabSend },
  'lab.result':        { write: 'verifyHarvest', read: ANY, guard: guardLabResult },

  // Alerts (requirements 6.5). Anyone in the field may say they have picked
  // one up; deciding NOT to treat is a management call and needs a reason,
  // because "we looked at it and left it" is what Season 1 was made of.
  'alert.ack':         { write: 'viewOwnTasks',  read: ANY },
  'alert.decide':      { write: 'assignTasks',   read: ANY, guard: guardNoTreat },

  // Zones and positions (6.1, section 4). Retiring a zone or moving somebody
  // between jobs is management work, so it sits with managePeople and
  // manageCycles rather than with whoever happens to be holding a phone.
  'plot.retire':       { write: 'manageCycles',  read: ANY },
  'plot.restore':      { write: 'manageCycles',  read: ANY },
  'position.upsert':   { write: 'managePeople',  read: ANY },
  'position.assign':   { write: 'managePeople',  read: ANY },
  'position.retire':   { write: 'managePeople',  read: ANY },
  // Anyone may say they are not coming in. Being able to report your own
  // absence is the thing that makes the cover mechanism work at six in the
  // morning; needing a manager to record it is how it fails.
  'absence.record':    { write: 'viewOwnTasks',  read: ANY },
  'absence.cancel':    { write: 'viewOwnTasks',  read: ANY },

  // The money. Only roles that run the books ever receive these.
  'sale.record':       { write: 'manageMoney',   read: 'manageMoney' },
  'expense.record':    { write: 'manageMoney',   read: 'manageMoney' },
};

/**
 * Wages are the sharp edge. Everyone needs the names and roles of their
 * colleagues for tasks and harvest to make sense, so the record still travels,
 * but what someone earns goes only to the books and to that person themselves.
 */
function redactPerson(event, reader) {
  const p = event.payload || {};
  const out = { ...p };
  delete out.pinHash;                                  // never leaves the server
  // Readers arrive either as a stored member record (id) or as a session
  // (memberId). Accepting both is what stops "show me my own pay" quietly
  // failing on the one path that matters, the live server.
  const readerId = reader.memberId || reader.id;
  const ownRecord = p.id && p.id === readerId;
  if (!ownRecord && !can(reader.role, 'manageMoney')) {
    delete out.dailyRate;
    delete out.phone;
  }
  return { ...event, payload: out };
}

/** Prices and the wage bill are commercial; crate weights and rates are not. */
function redactSettings(event, reader) {
  if (can(reader.role, 'manageMoney')) return event;
  const p = { ...(event.payload || {}) };
  delete p.prices;
  delete p.seasonality;
  delete p.defaultDailyWage;
  delete p.overtimeRatePerHour;
  return { ...event, payload: p };
}

/**
 * Nobody may promote themselves, and nobody may reach upwards.
 *
 * Checking only the role being granted is not enough, and getting that wrong is
 * how a manager quietly unseats the owner: "make this person a farm hand" is a
 * role a manager may grant, so pointing it at the CEO's own account would pass.
 * Every app works out who you are from this log, so the owner's next sign-in
 * would hand them a farm hand's screens. The target's *current* standing has to
 * be checked as well, which needs the server's own record of them, not the
 * client's claim. That check lives in mayWritePerson below.
 */
function guardPersonWrite(event, author) {
  const payload = event.payload || {};
  const granting = payload.role;
  if (!granting) return { ok: true };                  // deactivate and the like

  // Correcting your own details while keeping the role you already hold is
  // ordinary housekeeping. Without this, a manager could not fix their own
  // phone number, because "manager" is not a role a manager may hand out.
  if (payload.id && payload.id === author.id && granting === author.role) return { ok: true };

  if (!assignableRoles(author.role).includes(granting)) {
    return { ok: false, why: `A ${author.role} cannot create or change a ${granting}` };
  }
  return { ok: true };
}

/**
 * The half of the check that needs to look the target up.
 *
 * You may always edit your own details, but never your own role. You may only
 * touch somebody else if you could have appointed them in the first place, which
 * is what stops anyone reaching over their own head. And the farm must never be
 * left without an owner.
 */
export async function mayWritePerson(event, author, farmId, store) {
  if (event.type !== 'person.upsert' && event.type !== 'person.deactivate') return { ok: true };

  const payload = event.payload || {};
  const targetId = payload.id;
  if (!targetId) return { ok: false, why: 'That record names nobody' };

  const existing = await store.getMember(farmId, targetId);

  if (targetId === author.id) {
    if (event.type === 'person.deactivate') {
      return { ok: false, why: 'You cannot remove your own account' };
    }
    if (payload.role && existing && payload.role !== existing.role) {
      return { ok: false, why: 'You cannot change your own role' };
    }
    return { ok: true };
  }

  // Somebody the server has never heard of is a new account, already covered by
  // the check on the role being granted.
  if (!existing) return { ok: true };

  if (!assignableRoles(author.role).includes(existing.role)) {
    return { ok: false, why: `A ${author.role} cannot change a ${existing.role}` };
  }

  if (event.type === 'person.deactivate' && existing.role === 'ceo') {
    const owners = (await store.listMembers(farmId)).filter((m) => m.role === 'ceo' && m.status === 'active');
    if (owners.length <= 1) return { ok: false, why: 'That is the only CEO account' };
  }

  return { ok: true };
}

export function mayWrite(event, author) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return { ok: false, why: `Unknown record type ${event.type}` };
  if (!can(author.role, policy.write)) {
    return { ok: false, why: `A ${author.role} may not file ${event.type}` };
  }
  if (policy.guard) return policy.guard(event, author);
  return { ok: true };
}

export function visibleTo(event, reader) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return null;                            // unknown types are not relayed
  if (!can(reader.role, policy.read)) return null;
  return policy.redact ? policy.redact(event, reader) : event;
}

// --- Secrets --------------------------------------------------------------

const PBKDF2_ROUNDS = 210000;                          // OWASP guidance for PBKDF2-SHA256
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

/** A short code a person can read out over the phone without confusion. */
export function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I, O, 0, 1
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  return [...a].map((n) => alphabet[n % alphabet.length]).join('');
}

export async function hashSecret(secret, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    key, 256,
  );
  return { salt, hash: toHex(bits) };
}

export async function verifySecret(secret, salt, expected) {
  if (!salt || !expected) return false;
  const { hash } = await hashSecret(secret, salt);
  return timingSafeEqualHex(hash, expected);
}

/** Compare without leaking where two strings first differ. */
export function timingSafeEqualHex(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Device tokens are stored only as a digest, so a stolen database grants nothing. */
export async function tokenDigest(token) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(String(token))));
}

/**
 * A fast digest of a join code, used only to find which account it belongs to.
 *
 * The slow hash stays on the password, which is what actually proves identity.
 * Making the lookup fast matters: verifying a code against every pending invite
 * with PBKDF2 would take a second per invite, which is both slow for the person
 * joining and an easy way for a stranger to tie the server in knots.
 */
export async function codeDigest(farmId, code) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(`${farmId}:${String(code).toUpperCase()}`)));
}

// --- Guessing defence -----------------------------------------------------

// NFR-SEC-02: five wrong tries, then the account is locked for a quarter of an hour.
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function lockoutState(member, now = Date.now()) {
  const fails = member.failedAttempts || 0;
  const until = member.lockedUntil || 0;
  if (until > now) return { locked: true, seconds: Math.ceil((until - now) / 1000) };
  return { locked: false, fails: until ? 0 : fails };
}

export function afterFailure(member, now = Date.now()) {
  const fails = (lockoutState(member, now).fails || 0) + 1;
  return fails >= LOCKOUT_AFTER
    ? { failedAttempts: 0, lockedUntil: now + LOCKOUT_MS }
    : { failedAttempts: fails, lockedUntil: 0 };
}

export const afterSuccess = () => ({ failedAttempts: 0, lockedUntil: 0 });

// --- HTTP -----------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

const MAX_BODY = 5_000_000;
const MAX_PUSH = 1000;
const MAX_PULL = 1000;
const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;
const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  try { return JSON.parse(text); } catch { throw new Error('bad json'); }
}

/**
 * The whole API.
 *
 *   POST /api/farms/:id/bootstrap   create the farm and its CEO (once only)
 *   POST /api/farms/:id/invite      issue a single-use invite for a new person
 *   POST /api/farms/:id/join        redeem an invite, enrol this device
 *   POST /api/farms/:id/unlock      exchange a PIN for a fresh token on an enrolled device
 *   POST /api/farms/:id/revoke      cut off a person or a device
 *   GET  /api/farms/:id/me          who this token belongs to
 *   GET  /api/farms/:id/members     names and roles
 *   GET  /api/farms/:id/events      everything this role may see since a cursor
 *   POST /api/farms/:id/events      file records, each checked against the author
 *   POST /api/farms/:id/advise      the wider adviser: live weather, and the web if a key is set
 *   POST /api/farms/:id/photo-review  the Farm Doctor's photo review (FR-DOC-03)
 */
export async function handleRequest(req, store) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (!parts.length) {
    return new Response('DouValue farm server is running.\n\nPut this address into the app.\n',
      { status: 200, headers: { 'Content-Type': 'text/plain', ...CORS } });
  }
  if (parts[0] !== 'api' || parts[1] !== 'farms' || !parts[2]) return json({ error: 'Not found' }, 404);

  const farmId = decodeURIComponent(parts[2]);
  if (!safeId(farmId)) return json({ error: 'Bad farm id' }, 400);
  const action = parts[3] || '';

  let body = {};
  if (req.method === 'POST') {
    try { body = await readJson(req); }
    catch (e) { return json({ error: e.message === 'too large' ? 'That batch is too large' : 'Body was not valid JSON' }, e.message === 'too large' ? 413 : 400); }
  }

  if (action === 'bootstrap' && req.method === 'POST') return bootstrap(farmId, body, store);
  if (action === 'join' && req.method === 'POST') return join(farmId, body, store);

  // Everything below needs a token.
  const auth = await authenticate(farmId, req, store);
  if (!auth.ok) return auth.response;
  const me = auth.member;

  if (action === 'me' && req.method === 'GET') {
    return json({ ok: true, member: publicMember(me), farm: publicFarm(await store.getFarm(farmId)) });
  }
  if (action === 'members' && req.method === 'GET') {
    const members = await store.listMembers(farmId);
    return json({ members: members.map(publicMember) });
  }
  if (action === 'invite' && req.method === 'POST') return invite(farmId, body, me, store);
  if (action === 'revoke' && req.method === 'POST') return revoke(farmId, body, me, store);
  if (action === 'unlock' && req.method === 'POST') return unlock(farmId, body, me, store, auth.token);
  if (action === 'events' && req.method === 'GET') return readEvents(farmId, url, me, store);
  if (action === 'events' && req.method === 'POST') return writeEvents(farmId, body, me, store);
  if (action === 'advise' && req.method === 'POST') return advise(farmId, body, me, store);
  // FR-DOC-03: photo review. Online only, by design — the app's guided
  // diagnosis is what answers when this cannot be reached.
  if (action === 'photo-review' && req.method === 'POST') return photoReview(farmId, body, me, store);

  return json({ error: 'Not found' }, 404);
}

const publicMember = (m) => ({
  id: m.id, name: m.name, role: m.role, status: m.status,
  joinedAt: m.joinedAt || null, invitedAt: m.invitedAt || null,
});
const publicFarm = (f) => (f ? { id: f.id, name: f.name, created: f.created } : null);

async function authenticate(farmId, req, store) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, response: json({ error: 'Sign in first' }, 401) };

  const rec = await store.getToken(await tokenDigest(token));
  if (!rec || rec.farmId !== farmId) return { ok: false, response: json({ error: 'That sign-in has expired' }, 401) };

  const member = await store.getMember(farmId, rec.memberId);
  if (!member || member.status !== 'active') {
    return { ok: false, response: json({ error: 'That account is no longer active' }, 403) };
  }
  await store.touchToken(rec.digest, new Date().toISOString());
  return { ok: true, member, token: rec };
}

/**
 * FR-SCOUT-05 — deciding not to treat is a decision, not a dismissal.
 *
 * An alert closes on a treatment or on this. Letting it close on a bare tap
 * would make the board clearable by whoever finds it annoying, which is the
 * failure mode this whole section exists to prevent.
 */
function guardNoTreat(event) {
  const p = event.payload || {};
  if (!p.cycleId || !p.pestId) return { ok: false, why: 'Say which zone and which pest' };
  if (String(p.reason || '').trim().length < 10) {
    return { ok: false, why: 'Say why no treatment is needed — a sentence someone can check later' };
  }
  return { ok: true };
}

/**
 * FR-GATE-07 — an override is a decision on the record, not a switch.
 *
 * The permission table already limits this to the Owner. This adds the part
 * that makes the record worth having: it must name which gate, which zone, and
 * why. An override with an empty reason is refused, because a year later
 * "someone turned it off" is not an answer anybody can act on.
 */
function guardOverride(event, author) {
  const p = event.payload || {};
  if (!p.gate || !p.zoneId) return { ok: false, why: 'An override must name the gate and the zone' };
  const reason = String(p.reason || '').trim();
  if (reason.length < 10) {
    return { ok: false, why: 'An override needs a reason saying why it is safe to go ahead' };
  }
  return { ok: true };
}

/**
 * FR-DOC-08 — the Farm Doctor never confirms its own diagnosis or approves its
 * own plan.
 *
 * The app enforces this too, and the app's copy is the one people see. This is
 * the one that holds when the record arrives from something that is not the
 * app: a replayed request, another phone's queue, a curl command.
 */
function guardDoctorConfirm(event, author) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which Farm Doctor output this is about' };
  const who = author.memberId || author.id;
  if (who === 'farm-doctor') {
    return { ok: false, why: 'The Farm Doctor does not confirm or approve its own work (FR-DOC-08)' };
  }
  return { ok: true };
}

/** FR-DOC-06 — evidence has to say which gate and which line of it. */
function guardGateEvidence(event) {
  const p = event.payload || {};
  if (!p.gate || !p.itemId) return { ok: false, why: 'Evidence must name the gate and which line of it' };
  if (!p.zoneId) return { ok: false, why: 'Evidence must name the zone it is about' };
  return { ok: true };
}

/** FR-DIAG-05 — a sample is tracked by where it went and when. */
function guardLabSend(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which sample' };
  if (!String(p.lab || '').trim()) return { ok: false, why: 'Say which lab it went to' };
  return { ok: true };
}

function guardLabResult(event) {
  const p = event.payload || {};
  if (!p.id) return { ok: false, why: 'Say which sample' };
  if (!String(p.result || '').trim()) return { ok: false, why: 'Say what the lab reported' };
  return { ok: true };
}

/**
 * The actives this farm will not hold, whatever anybody types.
 *
 * rules/douvalue_rules_rev5_1.json → labels.banned is the source of truth and
 * every phone reads it from there. This file is different: it is pasted into
 * Deno Deploy as one file with no rules beside it, so it cannot read them and
 * carries the names instead. That copy is the kind CLAUDE.md warns about, so
 * it has a tripwire — tests/catalogue.test.mjs fails if the two ever drift,
 * the same way the suite fails when the generated Deno build drifts from this
 * file.
 *
 * FR-STOCK-09: banned actives can never be added and must not ship in the
 * catalogue at all. Carbofuran has killed farm workers and poisoned whole
 * flocks of birds, and residues in pepper fail any buyer's test.
 */
export const BANNED_ACTIVES = ['Carbofuran (Furadan)'];

const BANNED_WORDS = new Set(
  BANNED_ACTIVES.flatMap((entry) => String(entry).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)),
);

/** Does this name reach a banned active by any spelling on the label? */
export function namesBannedActive(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
    .some((word) => BANNED_WORDS.has(word));
}

/**
 * FR-STOCK-09 — a new active arrives with its resistance group, or not at all.
 *
 * "Any product without an IRAC or FRAC group on file cannot be selected for a
 * treatment", so an active without one is a row that could never be used and a
 * rotation the gate could never check.
 */
function guardActiveAdd(event) {
  const p = event.payload || {};
  const name = String(p.name || p.ai || '').trim();
  if (!name) return { ok: false, why: 'An active ingredient needs a name' };
  if (namesBannedActive(name)) {
    return { ok: false, why: `${name} is banned and cannot be added to the catalogue` };
  }
  const group = String(p.group || '').trim();
  if (!group || /^none$/i.test(group)) {
    return { ok: false, why: 'An active needs its IRAC or FRAC group, read off the label' };
  }
  return { ok: true };
}

/**
 * FR-STOCK-06 — a label hangs off actives that are already in the catalogue.
 * The group is never on the label record, so a new brand name cannot restart a
 * rotation by claiming a group of its own.
 */
function guardLabelAdd(event) {
  const p = event.payload || {};
  const brand = String(p.brand || '').trim();
  if (!brand) return { ok: false, why: 'A label needs the brand name on the container' };
  if (namesBannedActive(brand)) return { ok: false, why: `${brand} is a banned product` };
  if (!Array.isArray(p.activeIds) || !p.activeIds.length) {
    return { ok: false, why: 'A label must name at least one active ingredient from the catalogue' };
  }
  if (p.activeIds.some((id) => namesBannedActive(id))) {
    return { ok: false, why: 'That label names a banned active ingredient' };
  }
  if (p.group) return { ok: false, why: 'A label does not carry its own group — the group comes from the active' };
  return { ok: true };
}

/**
 * Naming what a store item is made of (FR-STOCK-05). The item's history — its
 * movements, its cost, the sprays that came out of it — is not touched, and a
 * banned active cannot be the answer.
 */
function guardInputUpsert(event) {
  const p = event.payload || {};
  if (p.activeId && namesBannedActive(p.activeId)) {
    return { ok: false, why: 'That is a banned active ingredient' };
  }
  if (namesBannedActive(p.name)) {
    return { ok: false, why: `${p.name} is banned and does not belong in this farm's store` };
  }
  return { ok: true };
}

/** Create the farm and its first account. Works exactly once per farm. */
async function bootstrap(farmId, body, store) {
  const existing = await store.getFarm(farmId);
  if (existing) return json({ error: 'That farm already exists. Ask the CEO for an invite.' }, 409);

  const name = String(body.name || '').trim();
  const password = String(body.password || '');
  if (!name) return json({ error: 'A name is needed' }, 400);
  if (password.length < 4) return json({ error: 'The password is too short' }, 400);

  const memberId = String(body.memberId || 'person_ceo');
  if (!safeId(memberId)) return json({ error: 'Bad member id' }, 400);

  const { salt, hash } = await hashSecret(password);
  const now = new Date().toISOString();
  await store.setFarm(farmId, {
    id: farmId, name: String(body.farmName || 'DouValue Farms Limited'), created: now,
  });
  const member = {
    id: memberId, name, role: 'ceo', status: 'active',
    passSalt: salt, passHash: hash, joinedAt: now, failedAttempts: 0, lockedUntil: 0,
  };
  await store.setMember(farmId, member);

  const token = randomHex(32);
  await store.setToken(await tokenDigest(token), {
    digest: await tokenDigest(token), farmId, memberId, device: String(body.device || 'unknown'),
    created: now, lastSeen: now,
  });
  return json({ ok: true, token, member: publicMember(member), farm: publicFarm(await store.getFarm(farmId)) });
}

/** The CEO or a manager creates an account and gets a one-time code for it. */
async function invite(farmId, body, me, store) {
  if (!can(me.role, 'managePeople')) return json({ error: 'You cannot create accounts' }, 403);

  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  if (!name) return json({ error: 'A name is needed' }, 400);
  if (!assignableRoles(me.role).includes(role)) {
    return json({ error: `A ${me.role} cannot appoint a ${role}` }, 403);
  }

  const memberId = String(body.memberId || `person_${randomHex(6)}`);
  if (!safeId(memberId)) return json({ error: 'Bad member id' }, 400);

  const existing = await store.getMember(farmId, memberId);
  if (existing && existing.status === 'active') {
    return json({ error: 'That person already has an account' }, 409);
  }

  const code = randomCode(6);
  const password = randomCode(6);
  const { salt: passSalt, hash: passHash } = await hashSecret(password);
  const now = new Date().toISOString();
  const lookup = await codeDigest(farmId, code);

  // Any earlier unredeemed invite for this person is dropped, so re-inviting
  // someone invalidates the code they were sent before.
  if (existing && existing.invite) await store.deleteInviteIndex(existing.invite.lookup);

  await store.setMember(farmId, {
    id: memberId, name, role, status: 'invited',
    invite: { lookup, passSalt, passHash, expiresAt: Date.now() + INVITE_TTL_MS },
    invitedBy: me.id, invitedAt: now, failedAttempts: 0, lockedUntil: 0,
  });
  await store.setInviteIndex(lookup, { farmId, memberId });

  // The plain code and password are returned once and never stored.
  return json({ ok: true, memberId, name, role, joinCode: code, joinPassword: password,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() });
}

/** Redeem an invite: this enrols one device and sets that person's own PIN. */
async function join(farmId, body, store) {
  const farm = await store.getFarm(farmId);
  if (!farm) return json({ error: 'No such farm' }, 404);

  const code = String(body.joinCode || '').trim().toUpperCase();
  const password = String(body.joinPassword || '').trim().toUpperCase();
  const pin = String(body.pin || '');
  if (!code || !password) return json({ error: 'Enter the code and the password you were given' }, 400);
  if (!/^\d{4,12}$/.test(pin)) return json({ error: 'Choose a PIN of at least 4 digits' }, 400);

  const lookup = await codeDigest(farmId, code);
  const pointer = await store.getInviteIndex(lookup);
  const member = pointer && pointer.farmId === farmId
    ? await store.getMember(farmId, pointer.memberId) : null;

  if (!member || member.status !== 'invited' || !member.invite || member.invite.lookup !== lookup) {
    return json({ error: 'That code is not valid, or it has already been used' }, 403);
  }

  const now = Date.now();
  const lock = lockoutState(member, now);
  if (lock.locked) return json({ error: `Too many tries. Wait ${lock.seconds} seconds.` }, 429);

  if (member.invite.expiresAt < now) {
    return json({ error: 'That invite has expired. Ask for a new one.' }, 410);
  }
  if (!(await verifySecret(password, member.invite.passSalt, member.invite.passHash))) {
    await store.setMember(farmId, { ...member, ...afterFailure(member, now) });
    return json({ error: 'That password does not match the code' }, 403);
  }

  const { salt, hash } = await hashSecret(pin);
  const joined = {
    ...member, status: 'active', passSalt: salt, passHash: hash,
    joinedAt: new Date().toISOString(), ...afterSuccess(),
  };
  delete joined.invite;                                 // single use, gone once redeemed
  await store.setMember(farmId, joined);
  await store.deleteInviteIndex(lookup);

  const token = randomHex(32);
  const digest = await tokenDigest(token);
  await store.setToken(digest, {
    digest, farmId, memberId: member.id, device: String(body.device || 'unknown'),
    created: new Date().toISOString(), lastSeen: new Date().toISOString(),
  });
  return json({ ok: true, token, member: publicMember(joined), farm: publicFarm(farm) });
}

/** Re-issue a token on a device that is already enrolled, using the person's PIN. */
async function unlock(farmId, body, me, store, currentToken) {
  const pin = String(body.pin || '');
  const lock = lockoutState(me);
  if (lock.locked) return json({ error: `Too many tries. Wait ${lock.seconds} seconds.` }, 429);

  if (!(await verifySecret(pin, me.passSalt, me.passHash))) {
    await store.setMember(farmId, { ...me, ...afterFailure(me) });
    return json({ error: 'Wrong PIN' }, 403);
  }
  await store.setMember(farmId, { ...me, ...afterSuccess() });

  if (body.newPin) {
    if (!/^\d{4,12}$/.test(String(body.newPin))) return json({ error: 'A PIN must be at least 4 digits' }, 400);
    const { salt, hash } = await hashSecret(String(body.newPin));
    await store.setMember(farmId, { ...me, passSalt: salt, passHash: hash, ...afterSuccess() });
  }
  return json({ ok: true, member: publicMember(me), token: currentToken ? undefined : null });
}

/** Cut off a person, or just one lost handset. */
async function revoke(farmId, body, me, store) {
  const targetId = String(body.memberId || '');
  const target = await store.getMember(farmId, targetId);
  if (!target) return json({ error: 'No such person' }, 404);
  if (target.id === me.id) return json({ error: 'You cannot revoke your own access' }, 400);
  if (!can(me.role, 'managePeople')) return json({ error: 'You cannot change accounts' }, 403);
  if (!assignableRoles(me.role).includes(target.role)) {
    return json({ error: `A ${me.role} cannot revoke a ${target.role}` }, 403);
  }
  if (target.role === 'ceo') {
    const owners = (await store.listMembers(farmId)).filter((m) => m.role === 'ceo' && m.status === 'active');
    if (owners.length <= 1) return json({ error: 'That is the only CEO account' }, 400);
  }

  await store.deleteTokensFor(farmId, targetId);
  if (body.devicesOnly) return json({ ok: true, signedOutOfEveryDevice: true });

  await store.setMember(farmId, { ...target, status: 'revoked' });
  return json({ ok: true, revoked: targetId });
}

async function readEvents(farmId, url, me, store) {
  const since = Math.max(0, Number(url.searchParams.get('since') || 0) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit') || 500) || 500));
  const page = await store.listEvents(farmId, since, limit);

  const visible = [];
  for (const event of page.events) {
    const shaped = visibleTo(event, me);
    if (shaped) visible.push(shaped);
  }
  return json({
    events: visible, cursor: page.cursor, more: page.more,
    total: await store.countEvents(farmId),
    // The cursor counts everything, so a role that sees less still advances.
    withheld: page.events.length - visible.length,
  });
}

async function writeEvents(farmId, body, me, store) {
  const incoming = Array.isArray(body.events) ? body.events : [];
  if (incoming.length > MAX_PUSH) return json({ error: 'Too many records in one push' }, 413);

  const allowed = [];
  const refused = [];
  for (const event of incoming) {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.type !== 'string') {
      refused.push({ id: event && event.id, why: 'Malformed record' });
      continue;
    }
    const verdict = mayWrite(event, me);
    if (!verdict.ok) { refused.push({ id: event.id, why: verdict.why }); continue; }

    // Account records need the target's standing on the server, not the claim
    // in the record, so this check cannot be folded into the table above.
    const overPerson = await mayWritePerson(event, me, farmId, store);
    if (!overPerson.ok) { refused.push({ id: event.id, why: overPerson.why }); continue; }
    // Authorship is the server's to decide, never the client's claim.
    allowed.push({ ...event, by: me.id, serverAt: new Date().toISOString() });
  }

  const stored = await store.appendEvents(farmId, allowed);
  return json({
    accepted: stored.accepted, skipped: stored.skipped, refused,
    total: await store.countEvents(farmId), cursor: stored.cursor,
  });
}

// --- The wider adviser ----------------------------------------------------
//
// The app already has an adviser of its own that works with the network off.
// This adds the part that offline reasoning cannot do: read what is true this
// week rather than what was true when the app was written — an advisory on a
// pest moving through the region, a product deregistered, what pepper is
// actually fetching now.
//
// Three things make this safe to expose:
//
//   1. The key never leaves the server. It is set once on the deployment by the
//      CEO and no phone ever holds it, so a lost handset cannot spend money.
//   2. The server redacts before it sends. Whatever the app puts in the brief,
//      a role without manageMoney gets the money stripped here, because the app
//      making that decision correctly is a convenience, not a guarantee.
//   3. Every account has a daily cap. A token in the wrong hands can run up a
//      bill; this bounds it and the bound is per person, not per farm, so one
//      person cannot spend everyone else's share.

const ADVICE_PER_DAY = 25;
// Long enough for a few web searches and a considered answer; short enough that
// a phone on a weak signal gives up rather than hanging with a spinner.
const ADVICE_TIMEOUT_MS = 90_000;
const ADVICE_MODEL = 'claude-opus-5';

const ADVISER_BRIEF = `You are the farm adviser for a commercial pepper farm in Port Harcourt,
Rivers State, Nigeria. It grows bell pepper (tatashe), chili (shombo) and habanero (ata rodo)
in open field.

You are given that farm's own records as JSON. Your job is to add what the records cannot
contain: current outside knowledge. Search the web for anything time-sensitive that changes the
answer — pest and disease advisories for southern Nigeria, prices in Nigerian markets, product
registration and ban changes, weather beyond the forecast supplied.

Rules, in order of importance:

1. Never invent a number. If you looked it up, say where from and when it was published. If you
   could not find it, say you could not find it. A made-up price does more harm here than silence.
2. Safety outranks everything. Pre-harvest and re-entry intervals are not advice, and no
   commercial pressure moves them.
3. Be specific to what is in the records. "Monitor your crop" is worthless. "Bed 3 is 40kg behind
   and its pH is 4.9" is worth reading.
4. Every recommendation needs: what you saw in the records, what it costs to ignore, what to do
   this week, and who says so.
5. Write for a farm manager in Nigeria, not for an agronomy journal. Short sentences. Naira, kg,
   hectares and millimetres. No jargon you do not immediately explain.
6. Do not repeat what the built-in adviser already said unless you are correcting it or adding
   outside evidence to it. You are told what it said.

Answer in plain prose with short headed sections. No preamble about being an AI.`;

/** Today's date in the farm's own timezone, which is what a daily cap should turn over on. */
const farmDay = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);  // WAT, UTC+1

/**
 * Live weather from Open-Meteo. Free, no key, no account — which is why it is
 * the one outside source the adviser can always reach.
 */
async function liveWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=4.82&longitude=7.04'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean'
    + '&past_days=14&forecast_days=7&timezone=Africa%2FLagos';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()).daily;
    if (!d || !Array.isArray(d.time)) return null;
    return d.time.map((t, i) => ({
      date: t,
      tmax: d.temperature_2m_max[i],
      tmin: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i],
      rh: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null,
    }));
  } catch {
    return null;
  }
}

/** Strip anything the reader's role is not entitled to, whatever the client sent. */
function redactBrief(brief, role) {
  if (can(role, 'manageMoney')) return brief;
  const { economics, ...rest } = brief || {};
  if (rest.farm && rest.farm.askedBy) rest.farm.askedBy = { ...rest.farm.askedBy, seesMoney: false };
  return rest;
}

/** Deno and Node keep environment variables in different places, and neither exists in the other. */
function envVar(name) {
  try {
    if (typeof Deno !== 'undefined' && Deno.env) return Deno.env.get(name) || '';
  } catch { /* not Deno */ }
  try {
    if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  } catch { /* not Node */ }
  return '';
}

/** Count one use against this person's day, and refuse once they are over. */
async function spendAdviceBudget(farmId, me, store) {
  const today = farmDay();
  const used = me.adviceUsed && me.adviceUsed.day === today ? me.adviceUsed.count : 0;
  if (used >= ADVICE_PER_DAY) return { ok: false, used };
  await store.setMember(farmId, { ...me, adviceUsed: { day: today, count: used + 1 } });
  return { ok: true, used: used + 1, left: ADVICE_PER_DAY - used - 1 };
}

async function advise(farmId, body, me, store) {
  const key = envVar('ANTHROPIC_API_KEY');
  const weather = await liveWeather();

  if (!key) {
    // Not an error: the farm simply has not turned this on. The app keeps its
    // own adviser either way, and the live weather is still worth returning.
    return json({
      ok: false,
      reason: 'no-key',
      weather,
      message: 'The wider adviser is not switched on for this farm. The CEO turns it on by '
        + 'setting ANTHROPIC_API_KEY on the farm server, in the Deno dashboard under Settings, '
        + 'Environment Variables. Until then the app advises from its own knowledge.',
    });
  }

  const budget = await spendAdviceBudget(farmId, me, store);
  if (!budget.ok) {
    return json({
      ok: false, reason: 'daily-limit', weather,
      message: `That is ${ADVICE_PER_DAY} questions today on this account. It resets at midnight.`,
    }, 429);
  }

  const brief = redactBrief(body.brief, me.role);
  const question = String(body.question || '').slice(0, 2000).trim();
  const alreadySaid = Array.isArray(body.alreadySaid)
    ? body.alreadySaid.slice(0, 20).map((t) => String(t).slice(0, 200))
    : [];

  const prompt = [
    'THE FARM\'S OWN RECORDS:',
    JSON.stringify(brief),
    '',
    weather ? `LIVE WEATHER (Open-Meteo, 14 days back and 7 forward):\n${JSON.stringify(weather)}` : '',
    '',
    alreadySaid.length
      ? `THE BUILT-IN ADVISER HAS ALREADY SAID:\n- ${alreadySaid.join('\n- ')}`
      : '',
    '',
    question
      ? `THE QUESTION, from the farm's ${me.role}:\n${question}`
      : `No specific question. Give this farm's ${me.role} the most useful reading of these `
        + 'records you can, with whatever current outside information changes the answer.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(ADVICE_TIMEOUT_MS),
      body: JSON.stringify({
        // Overridable, because the farm is the one paying for each question and
        // a cheaper model is a legitimate choice for a farm making many of them.
        model: envVar('ANTHROPIC_MODEL') || ADVICE_MODEL,
        // Thinking is on by default and is billed against this, so the ceiling
        // has to leave room for it or a good answer gets cut off mid-sentence.
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: ADVISER_BRIEF,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({
        ok: false, reason: 'upstream', weather,
        message: res.status === 401
          ? 'The farm server\'s ANTHROPIC_API_KEY was refused. Check it in the Deno dashboard.'
          : 'The wider adviser could not be reached just now. The app\'s own advice still stands.',
        detail: detail.slice(0, 300),
      }, 502);
    }

    const answer = await res.json();
    if (answer.stop_reason === 'refusal') {
      return json({
        ok: false, reason: 'declined', weather,
        message: 'The wider adviser would not answer that one. Ask it about the farm.',
      });
    }
    const text = (answer.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    // Citations are URLs the model produced after reading pages nobody here
    // controls. The app checks them again before it makes a link of one, but
    // the server should not hand out an address it would not follow itself.
    const sources = [];
    for (const block of answer.content || []) {
      for (const c of block.citations || []) {
        if (!c.url || !/^https?:\/\//i.test(String(c.url))) continue;
        if (sources.some((s) => s.url === c.url)) continue;
        sources.push({ url: String(c.url), title: String(c.title || c.url).slice(0, 200) });
      }
    }

    return json({
      ok: true,
      text,
      sources,
      weather,
      askedAt: new Date().toISOString(),
      questionsLeftToday: budget.left,
    });
  } catch (err) {
    return json({
      ok: false, reason: 'timeout', weather,
      message: 'The wider adviser took too long to answer. Try again when the signal is better.',
      detail: String(err && err.message || err).slice(0, 200),
    }, 504);
  }
}

// --- The Farm Doctor's photo review (FR-DOC-03) ----------------------------
//
// The one thing the offline app cannot do: look at a picture. Everything else
// the Farm Doctor does — guided diagnosis, the calculators, the plan and gate
// checks — runs on the phone with no signal, and this is added to that rather
// than depended on by it.
//
// The limits in FR-DOC-08 are stated in the prompt AND applied again by the
// app when the answer lands (normalisePhotoReview in web/js/domain/doctor.js).
// Asking a model to be careful is not a control. The app rebuilding the answer
// from fields it decides the meaning of is.

const PHOTO_MAX = 4;
const PHOTO_TIMEOUT_MS = 60_000;

const PHOTO_BRIEF = `You are the Farm Doctor for a pepper farm in Port Harcourt, Nigeria. You are
looking at photos taken in a greenhouse or open field, with a phone, in bad light, by a farm hand.

You take the place of a visiting agronomist for day-to-day decisions. You advise; people decide.

Hard limits, which the app enforces again after you answer:
1. You never call a virus or a bacterial disease confirmed from a photo. You may say it is
   suspected, and then the sample goes to a lab.
2. You never name a product. The app chooses products from the farm's own catalogue and store.
3. You state a confidence of exactly "high", "medium" or "low", and you are honest about it. Low
   is the right answer for a blurred photo of a leaf with no context.

Answer with JSON only, no prose around it:
{"confidence":"high|medium|low",
 "candidates":[{"problemId":"<id from the shortlist if it fits>","name":"...","confidence":"...","why":"what in the photo"}],
 "whatYouSee":"one or two plain sentences",
 "nextCheck":"the single test that would settle it in the field"}`;

function imageBlocks(photos) {
  const out = [];
  for (const photo of photos.slice(0, PHOTO_MAX)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(photo || ''));
    if (!m) continue;
    if (m[2].length > 2_000_000) continue;              // a photo nobody compressed
    out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  return out;
}

/** Pull the JSON object out of an answer, without trusting it to be the whole reply. */
function firstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function photoReview(farmId, body, me, store) {
  const key = envVar('ANTHROPIC_API_KEY');
  if (!key) {
    return json({
      ok: false, reason: 'no-key',
      message: 'Photo review is not switched on for this farm. The guided diagnosis, the '
        + 'calculators and the plan checks all still work without it.',
    });
  }

  const images = imageBlocks(Array.isArray(body.photos) ? body.photos : []);
  if (!images.length) {
    return json({ ok: false, reason: 'no-photos', message: 'No usable photos came through.' }, 400);
  }

  const budget = await spendAdviceBudget(farmId, me, store);
  if (!budget.ok) {
    return json({
      ok: false, reason: 'daily-limit',
      message: `That is ${ADVICE_PER_DAY} questions today on this account. It resets at midnight.`,
    }, 429);
  }

  const shortlist = Array.isArray(body.shortlist) ? body.shortlist.slice(0, 12) : [];
  const context = [
    body.zoneId ? `Zone: ${String(body.zoneId).slice(0, 40)}` : '',
    body.date ? `Date: ${String(body.date).slice(0, 10)}` : '',
    body.note ? `What the person wrote: ${String(body.note).slice(0, 600)}` : '',
    Array.isArray(body.symptoms) && body.symptoms.length
      ? `Ticked in the guided flow: ${body.symptoms.map((x) => String(x).slice(0, 40)).join(', ')}`
      : '',
    shortlist.length
      ? `The app's own shortlist (use these ids where one fits): ${shortlist.map((p) => `${p.id} (${p.name})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
      body: JSON.stringify({
        model: envVar('ANTHROPIC_MODEL') || ADVICE_MODEL,
        max_tokens: 4000,
        system: PHOTO_BRIEF,
        messages: [{
          role: 'user',
          content: [...images, { type: 'text', text: context || 'No extra context was given.' }],
        }],
      }),
    });

    if (!res.ok) {
      return json({
        ok: false, reason: 'upstream',
        message: res.status === 401
          ? 'The farm server\'s ANTHROPIC_API_KEY was refused. Check it in the Deno dashboard.'
          : 'Photo review could not be reached. Use the guided diagnosis; it needs no signal.',
      }, 502);
    }

    const answer = await res.json();
    if (answer.stop_reason === 'refusal') {
      return json({ ok: false, reason: 'declined', message: 'Photo review would not answer that one.' });
    }
    const text = (answer.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const parsed = firstJsonObject(text) || {};

    // Deliberately thin: the app applies FR-DOC-08 to whatever comes back, so
    // the server's job is to pass it on honestly rather than to interpret it.
    return json({
      ok: true,
      review: {
        confidence: parsed.confidence || 'low',
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5) : [],
        text: String(parsed.whatYouSee || text || '').slice(0, 2000),
        nextCheck: String(parsed.nextCheck || '').slice(0, 500),
        photoCount: images.length,
      },
      askedAt: new Date().toISOString(),
      questionsLeftToday: budget.left,
    });
  } catch (err) {
    return json({
      ok: false, reason: 'timeout',
      message: 'Photo review took too long. The guided diagnosis works with no signal at all.',
      detail: String((err && err.message) || err).slice(0, 200),
    }, 504);
  }
}

export { json, CORS, redactBrief };
