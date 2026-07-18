// server/protocol.js — the wire contract between browser and server.
//
// Everything crossing the socket is hostile until proven otherwise: validators are
// hand-rolled (no schema dep), reject rather than coerce for anything the sim will
// act on, and clamp rather than reject for cosmetics like names. A client that
// sends something this file rejects is kicked — there is no partial acceptance.
//
// Message types (t):
//   client -> server:  join, input, ping
//   server -> client:  welcome, snapshot, events, pong, error
'use strict';

const P = {};

// A join message with a max-length name is ~200 bytes; inputs are ~120. 4 KB is
// generous headroom that still makes a memory-exhaustion frame impossible.
P.MAX_MSG_BYTES = 4096;
P.MAX_NAME = 16;
P.PROTOCOL_VERSION = 1;

// Held keys the sim reads each tick, and the edge-triggered actions it consumes
// once. Mirrors js/main.js's HELD/EDGE tables — the client's `ctrl` and the
// pure-UI edges (inv, tree, esc, mute) are client-side concerns and are not
// accepted here: the server sim has no menus to open.
P.KEYS = Object.freeze(['w', 'a', 's', 'd', 'space']);
// `restart` is deliberately absent. Game.update honours it by returning a brand
// new run state built from players[0] alone — in a room that would silently
// delete everyone else. Co-op death and run-end rules are Phase 4's job; until
// then the server has no message that can rebuild a room's world.
P.EDGES = Object.freeze([
  'dodge',
  'interact',
  'drink',
  'portal',
  'skill0',
  'skill1',
  'skill2',
  'belt0',
  'belt1',
  'belt2',
  'belt3',
]);

const KEY_SET = new Set(P.KEYS);
const EDGE_SET = new Set(P.EDGES);

// Budgets are per connection. Inputs get 30 Hz plus burst slack for jitter and
// catch-up; everything else is a control message and should be rare. Auth is the
// strictest — a login/register attempt is deliberately expensive server-side
// (scrypt), so a flood of them is throttled hardest.
P.INPUT_LIMIT = Object.freeze({ capacity: 90, refillPerSec: 45 });
P.CONTROL_LIMIT = Object.freeze({ capacity: 20, refillPerSec: 2 });
P.AUTH_LIMIT = Object.freeze({ capacity: 8, refillPerSec: 0.2 });

// Account/character bounds.
P.MAX_SLOT = 7; // eight character slots, 0..7
P.MAX_PASSWORD = 128;
P.MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

P.ERR = Object.freeze({
  BAD_MESSAGE: 'bad_message',
  RATE_LIMIT: 'rate_limit',
  NO_ROOM: 'no_room',
  ROOM_FULL: 'room_full',
  NOT_JOINED: 'not_joined',
  NOT_AUTHED: 'not_authed',
  SERVER_FULL: 'server_full', // over the process's room/connection cap (Phase 5)
});

// Which message types are authentication attempts (the strict bucket).
P.AUTH_TYPES = Object.freeze(new Set(['register', 'login', 'resume']));

// ---- Framing ----

// Parse a raw frame into a plain object. Length is checked before JSON.parse so a
// huge payload costs us a byte count, not a parse.
P.decode = function (raw) {
  const text = typeof raw === 'string' ? raw : String(raw);
  if (text.length === 0) return { ok: false, error: 'empty frame' };
  if (Buffer.byteLength(text, 'utf8') > P.MAX_MSG_BYTES) return { ok: false, error: 'frame too large' };
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, error: 'malformed json' };
  }
  // Arrays are objects; messages are not arrays.
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return { ok: false, error: 'not an object' };
  return { ok: true, msg };
};

P.encode = function (msg) {
  return JSON.stringify(msg);
};

// ---- Field validators ----

const fail = (error) => ({ ok: false, error });

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Finite, real numbers only: NaN and ±Infinity poison every downstream comparison
// in the sim, so they never get past this line.
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Names are display-only, so they clamp instead of rejecting: a client with an
// over-long name is careless, not hostile. Control characters are stripped so a
// name can't smuggle newlines into logs or the chat-less HUD.
function cleanName(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined; // signals a reject to the caller
  // eslint-disable-next-line no-control-regex
  const stripped = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, P.MAX_NAME);
  return stripped.length ? stripped : null;
}

// Shirt colours are echoed to other clients and drawn into a canvas fill, so only
// a literal hex triple is allowed through; anything else silently becomes the
// server default rather than a kick (an old client sending a named colour is
// harmless, not an attack).
function cleanShirt(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

// Join codes are the room's whole access-control story in Phase 1, so the charset
// is pinned tight: unambiguous uppercase alphanumerics, fixed length band.
P.CODE_LEN = 4;
P.CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — they misread aloud
const CODE_RE = /^[A-Z0-9]{4,6}$/;

function cleanCode(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const up = v.trim().toUpperCase();
  if (!CODE_RE.test(up)) return undefined;
  return up;
}

// ---- Client message validation ----

function validateInput(msg) {
  // seq drives reconciliation; a client that can't count gets no benefit of the doubt.
  if (!Number.isInteger(msg.seq) || msg.seq < 0 || msg.seq > Number.MAX_SAFE_INTEGER) {
    return fail('bad seq');
  }
  if (!isPlainObject(msg.keys)) return fail('bad keys');

  const keys = {};
  for (const k of P.KEYS) keys[k] = false;
  for (const k of Object.keys(msg.keys)) {
    if (!KEY_SET.has(k)) continue; // unknown keys (e.g. a newer client's) are ignored, not fatal
    if (typeof msg.keys[k] !== 'boolean') return fail(`key ${k} is not a boolean`);
    keys[k] = msg.keys[k];
  }

  if (!Array.isArray(msg.pressed)) return fail('pressed is not an array');
  // One tick cannot legitimately carry more edges than there are actions.
  if (msg.pressed.length > P.EDGES.length) return fail('pressed flood');
  const pressed = [];
  for (const a of msg.pressed) {
    if (typeof a !== 'string' || !EDGE_SET.has(a)) return fail(`unknown action ${String(a).slice(0, 16)}`);
    if (!pressed.includes(a)) pressed.push(a);
  }

  if (!isPlainObject(msg.mouse)) return fail('bad mouse');
  if (!isFiniteNumber(msg.mouse.x) || !isFiniteNumber(msg.mouse.y)) return fail('bad mouse coords');
  const mouse = {
    x: msg.mouse.x,
    y: msg.mouse.y,
    click: msg.mouse.click === true,
    rclick: msg.mouse.rclick === true,
  };

  // Mouse-look aim: a world-space facing angle the client derives from its camera.
  // Optional (older clients omit it → the sim faces the travel direction), but a
  // present value drives facing and thus attack direction, so NaN/Infinity — which
  // would poison every downstream angle — are rejected, not coerced.
  let aim = null;
  if (msg.aim !== undefined && msg.aim !== null) {
    if (!isFiniteNumber(msg.aim)) return fail('bad aim');
    aim = msg.aim;
  }

  return { ok: true, msg: { t: 'input', seq: msg.seq, keys, pressed, mouse, aim } };
}

function validateJoin(msg) {
  const name = cleanName(msg.name);
  if (name === undefined) return fail('bad name');
  const shirt = cleanShirt(msg.shirt);
  if (shirt === undefined) return fail('bad shirt');
  const code = cleanCode(msg.code);
  if (code === undefined) return fail('bad code');
  return { ok: true, msg: { t: 'join', name, shirt, code } };
}

// Usernames are the account key: a tight charset, case preserved for display but
// uniqueness enforced case-insensitively downstream.
function cleanUsername(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v)) return undefined;
  return v;
}

// Passwords are validated but NEVER echoed, logged, or normalized beyond a length
// check — the raw bytes go straight to scrypt.
function checkPassword(v) {
  return typeof v === 'string' && v.length >= P.MIN_PASSWORD && v.length <= P.MAX_PASSWORD;
}

function checkSlot(v) {
  return Number.isInteger(v) && v >= 0 && v <= P.MAX_SLOT;
}

function validateRegister(msg) {
  const username = cleanUsername(msg.username);
  if (username === undefined) return fail('bad username');
  if (!checkPassword(msg.password)) return fail('bad password');
  const name = cleanName(msg.name);
  if (name === undefined) return fail('bad name');
  const shirt = cleanShirt(msg.shirt);
  if (shirt === undefined) return fail('bad shirt');
  return { ok: true, msg: { t: 'register', username, password: msg.password, name, shirt } };
}

function validateLogin(msg) {
  const username = cleanUsername(msg.username);
  if (username === undefined) return fail('bad username');
  if (!checkPassword(msg.password)) return fail('bad password');
  return { ok: true, msg: { t: 'login', username, password: msg.password } };
}

function validateResume(msg) {
  // Tokens are base64url of 32 bytes (~43 chars); bound generously and reject junk.
  if (typeof msg.token !== 'string' || msg.token.length < 20 || msg.token.length > 200) return fail('bad token');
  return { ok: true, msg: { t: 'resume', token: msg.token } };
}

function validateCreateChar(msg) {
  if (!checkSlot(msg.slot)) return fail('bad slot');
  const name = cleanName(msg.name);
  if (name === undefined) return fail('bad name');
  const shirt = cleanShirt(msg.shirt);
  if (shirt === undefined) return fail('bad shirt');
  return { ok: true, msg: { t: 'createChar', slot: msg.slot, name, shirt, imported: msg.imported === true } };
}

// The single gate every client frame passes through.
P.validateClient = function (msg) {
  if (!isPlainObject(msg)) return fail('not an object');
  switch (msg.t) {
    case 'input':
      return validateInput(msg);
    case 'join':
      return validateJoin(msg);
    case 'ping':
      return isFiniteNumber(msg.ts) ? { ok: true, msg: { t: 'ping', ts: msg.ts } } : fail('bad ping ts');
    case 'register':
      return validateRegister(msg);
    case 'login':
      return validateLogin(msg);
    case 'resume':
      return validateResume(msg);
    case 'listChars':
      return { ok: true, msg: { t: 'listChars' } };
    case 'createChar':
      return validateCreateChar(msg);
    case 'selectChar':
      return checkSlot(msg.slot) ? { ok: true, msg: { t: 'selectChar', slot: msg.slot } } : fail('bad slot');
    case 'deleteChar':
      return checkSlot(msg.slot) ? { ok: true, msg: { t: 'deleteChar', slot: msg.slot } } : fail('bad slot');
    case 'intent':
      return validateIntent(msg);
    default:
      return fail('unknown message type');
  }
};

// Progression intents (Phase 4.5 Track C). Each intent carries ONLY the indices/ids
// it needs — never stats, prices, or item objects. We reject any intent carrying an
// unexpected key (a forged `damage`/`price`/`stats` field is a kick, not a no-op), so
// a client cannot smuggle a number the server would trust.
const INTENT_FIELDS = Object.freeze({
  equip: ['slot'],
  unequip: ['slotName'],
  sell: ['slot'],
  upgrade: ['slotName'],
  learn: ['skillId'],
  buy: ['index'],
});
const STRING_FIELDS = new Set(['slotName', 'skillId']);

function validateIntent(msg) {
  const fields = INTENT_FIELDS[msg.intent];
  if (!fields) return fail('unknown intent');
  const allowed = new Set(['t', 'intent', ...fields]);
  for (const k of Object.keys(msg)) {
    if (!allowed.has(k)) return fail(`unexpected intent key ${String(k).slice(0, 24)}`);
  }
  const out = { t: 'intent', intent: msg.intent };
  for (const f of fields) {
    const v = msg[f];
    if (STRING_FIELDS.has(f)) {
      if (typeof v !== 'string' || v.length > 40) return fail(`bad ${f}`);
      out[f] = v;
    } else {
      if (!Number.isInteger(v) || v < 0 || v > 1000) return fail(`bad ${f}`);
      out[f] = v;
    }
  }
  return { ok: true, msg: out };
}

// Validated wire input -> the exact shape js/game expects (pressed as a Set).
P.toSimInput = function (msg) {
  const keys = {};
  for (const k of P.KEYS) keys[k] = msg.keys[k] === true;
  const input = { keys, pressed: new Set(msg.pressed), mouse: { ...msg.mouse } };
  if (typeof msg.aim === 'number') input.aim = msg.aim;
  return input;
};

// ---- Rate limiting ----

// Token bucket. Time is passed in rather than read from the clock so tests are
// deterministic and the room can drive it from its own tick timestamp.
P.RateLimiter = class RateLimiter {
  constructor({ capacity, refillPerSec }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = null;
  }

  allow(nowMs) {
    if (this.last === null) this.last = nowMs;
    const elapsed = Math.max(0, nowMs - this.last) / 1000;
    this.last = nowMs;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
};

module.exports = P;
