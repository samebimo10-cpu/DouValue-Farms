// DouValue farm server, for Deno Deploy.
//
// GENERATED FILE. Do not edit here: change server/core.mjs and run
//   node douvalue/scripts-build-deno.mjs
//
// To run it, with no command line and no card:
//   1. Open https://dash.deno.com and create a new Playground.
//   2. Paste this whole file in.
//   3. Press Save & Deploy and copy the address it gives you.
//   4. Put that address into the app when the CEO sets the farm up.
//
// Storage is Deno KV, which is built in and persistent.
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

const ROLES = {
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

const can = (role, permission) => !!ROLES[role] && ROLES[role].can.includes(permission);
const rankOf = (role) => (ROLES[role] ? ROLES[role].rank : -1);

/** Which roles a person may hand out: the CEO anyone, everyone else below themselves. */
function assignableRoles(role) {
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
const EVENT_POLICY = {
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
  'input.upsert':      { write: 'logInputs',     read: ANY },
  'input.receive':     { write: 'logInputs',     read: ANY },
  'input.issue':       { write: 'logInputs',     read: ANY },
  'weather.record':    { write: 'logWork',       read: ANY },

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
async function mayWritePerson(event, author, farmId, store) {
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

function mayWrite(event, author) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return { ok: false, why: `Unknown record type ${event.type}` };
  if (!can(author.role, policy.write)) {
    return { ok: false, why: `A ${author.role} may not file ${event.type}` };
  }
  if (policy.guard) return policy.guard(event, author);
  return { ok: true };
}

function visibleTo(event, reader) {
  const policy = EVENT_POLICY[event.type];
  if (!policy) return null;                            // unknown types are not relayed
  if (!can(reader.role, policy.read)) return null;
  return policy.redact ? policy.redact(event, reader) : event;
}

// --- Secrets --------------------------------------------------------------

const PBKDF2_ROUNDS = 210000;                          // OWASP guidance for PBKDF2-SHA256
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

/** A short code a person can read out over the phone without confusion. */
function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I, O, 0, 1
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  return [...a].map((n) => alphabet[n % alphabet.length]).join('');
}

async function hashSecret(secret, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    key, 256,
  );
  return { salt, hash: toHex(bits) };
}

async function verifySecret(secret, salt, expected) {
  if (!salt || !expected) return false;
  const { hash } = await hashSecret(secret, salt);
  return timingSafeEqualHex(hash, expected);
}

/** Compare without leaking where two strings first differ. */
function timingSafeEqualHex(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Device tokens are stored only as a digest, so a stolen database grants nothing. */
async function tokenDigest(token) {
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
async function codeDigest(farmId, code) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(`${farmId}:${String(code).toUpperCase()}`)));
}

// --- Guessing defence -----------------------------------------------------

const LOCKOUT_AFTER = 6;
const LOCKOUT_MS = 15 * 60 * 1000;

function lockoutState(member, now = Date.now()) {
  const fails = member.failedAttempts || 0;
  const until = member.lockedUntil || 0;
  if (until > now) return { locked: true, seconds: Math.ceil((until - now) / 1000) };
  return { locked: false, fails: until ? 0 : fails };
}

function afterFailure(member, now = Date.now()) {
  const fails = (lockoutState(member, now).fails || 0) + 1;
  return fails >= LOCKOUT_AFTER
    ? { failedAttempts: 0, lockedUntil: now + LOCKOUT_MS }
    : { failedAttempts: fails, lockedUntil: 0 };
}

const afterSuccess = () => ({ failedAttempts: 0, lockedUntil: 0 });

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
 */
async function handleRequest(req, store) {
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




// --- Storage on Deno KV ----------------------------------------------------

const kv = await Deno.openKv();

const store = {
  async getFarm(farmId) { return (await kv.get(["farm", farmId, "meta"])).value; },
  async setFarm(farmId, farm) { await kv.set(["farm", farmId, "meta"], farm); },

  async getMember(farmId, memberId) { return (await kv.get(["farm", farmId, "member", memberId])).value; },
  async listMembers(farmId) {
    const out = [];
    for await (const e of kv.list({ prefix: ["farm", farmId, "member"] })) out.push(e.value);
    return out;
  },
  async setMember(farmId, member) { await kv.set(["farm", farmId, "member", member.id], member); },

  async getInviteIndex(lookup) { return (await kv.get(["invite", lookup])).value; },
  async setInviteIndex(lookup, rec) { await kv.set(["invite", lookup], rec); },
  async deleteInviteIndex(lookup) { await kv.delete(["invite", lookup]); },

  async getToken(digest) { return (await kv.get(["token", digest])).value; },
  async setToken(digest, rec) { await kv.set(["token", digest], rec); },
  async touchToken(digest, at) {
    const cur = (await kv.get(["token", digest])).value;
    if (cur) await kv.set(["token", digest], { ...cur, lastSeen: at });
  },
  async deleteTokensFor(farmId, memberId) {
    for await (const e of kv.list({ prefix: ["token"] })) {
      const rec = e.value;
      if (rec && rec.farmId === farmId && rec.memberId === memberId) await kv.delete(e.key);
    }
  },

  async appendEvents(farmId, events) {
    const countKey = ["farm", farmId, "count"];
    let accepted = 0, skipped = 0;
    for (const event of events) {
      let placed = false;
      for (let attempt = 0; attempt < 5 && !placed; attempt++) {
        const current = await kv.get(countKey);
        const seq = (current.value || 0) + 1;
        const result = await kv.atomic()
          .check({ key: ["farm", farmId, "ev", event.id], versionstamp: null })
          .check({ key: countKey, versionstamp: current.versionstamp })
          .set(["farm", farmId, "ev", event.id], seq)
          .set(["farm", farmId, "seq", seq], event)
          .set(countKey, seq)
          .commit();
        if (result.ok) { accepted++; placed = true; break; }
        if ((await kv.get(["farm", farmId, "ev", event.id])).value !== null) { skipped++; placed = true; }
      }
      if (!placed) skipped++;
    }
    return { accepted, skipped, cursor: (await kv.get(countKey)).value || 0 };
  },

  async listEvents(farmId, since, limit) {
    const out = [];
    let cursor = since;
    const iter = kv.list({
      start: ["farm", farmId, "seq", since + 1],
      end: ["farm", farmId, "seq", Number.MAX_SAFE_INTEGER],
    }, { limit });
    for await (const entry of iter) { out.push(entry.value); cursor = Number(entry.key[3]); }
    return { events: out, cursor, more: out.length === limit };
  },

  async countEvents(farmId) { return (await kv.get(["farm", farmId, "count"])).value || 0; },
};

Deno.serve((req) => handleRequest(req, store));
