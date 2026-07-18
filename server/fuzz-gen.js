// server/fuzz-gen.js — seeded, structure-aware payload generators shared by the CI
// fuzz test (test/fuzz.test.js) and the manual deep driver (tool/fuzz.mjs). Node-only,
// no deps, no Math.random — a failing seed reproduces exactly.
'use strict';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One well-formed message per accepted client type — the mutation seeds.
function validSeeds() {
  return [
    { t: 'join', name: 'Bot', shirt: '#4a5578' },
    { t: 'input', seq: 1, keys: { w: false, a: false, s: false, d: false, space: false }, pressed: [], mouse: { x: 0, y: 0, click: false, rclick: false } },
    { t: 'ping', ts: 123 },
    { t: 'register', username: 'user01', password: 'password1', name: 'User' },
    { t: 'login', username: 'user01', password: 'password1' },
    { t: 'resume', token: 'sometoken' },
    { t: 'listChars' },
    { t: 'createChar', slot: 0, name: 'Hero', shirt: '#4a5578' },
    { t: 'selectChar', slot: 0 },
    { t: 'deleteChar', slot: 0 },
    { t: 'intent', intent: 'equip', slot: 0 },
    { t: 'intent', intent: 'buy', index: 0 },
    { t: 'intent', intent: 'learn', skillId: 'whirlwind' },
  ];
}

const WEIRD = ['number', 'string', 'bool', 'null', 'array', 'object', 'nan', 'inf', 'negzero', 'huge'];
function weird(rng) {
  switch (WEIRD[Math.floor(rng() * WEIRD.length)]) {
    case 'number': return rng() * 1e9 - 5e8;
    case 'string': return 'x'.repeat(Math.floor(rng() * 40));
    case 'bool': return rng() < 0.5;
    case 'null': return null;
    case 'array': return [1, 'two', { three: 3 }];
    case 'object': return { nested: { deep: [1, 2, 3] } };
    case 'nan': return NaN;
    case 'inf': return rng() < 0.5 ? Infinity : -Infinity;
    case 'negzero': return -0;
    case 'huge': return Number.MAX_SAFE_INTEGER * (rng() < 0.5 ? 1 : -1);
    default: return null;
  }
}

// Structure-aware mutation of a valid message: drop/retype/inject/flip/flood a field.
function mutate(msg, rng) {
  const clone = JSON.parse(JSON.stringify(msg)); // NaN/Inf became null here; re-inject below
  const keys = Object.keys(clone);
  const op = Math.floor(rng() * 7);
  if (op === 0 && keys.length) {
    delete clone[keys[Math.floor(rng() * keys.length)]];
  } else if (op === 1 && keys.length) {
    clone[keys[Math.floor(rng() * keys.length)]] = weird(rng);
  } else if (op === 2) {
    clone['inj' + Math.floor(rng() * 100)] = weird(rng);
  } else if (op === 3) {
    const seeds = validSeeds();
    clone.t = seeds[Math.floor(rng() * seeds.length)].t;
  } else if (op === 4) {
    clone.pressed = Array.from({ length: 10 + Math.floor(rng() * 60) }, () => 'junk' + Math.floor(rng() * 100));
  } else if (op === 5) {
    clone.seq = weird(rng);
  } else {
    clone.slot = weird(rng);
    clone.mouse = weird(rng);
  }
  return clone;
}

// Wholly random frames (and some raw non-JSON strings) to hit decode() directly.
function randomFrame(rng) {
  const r = rng();
  if (r < 0.25) return 'x'.repeat(Math.floor(rng() * 200)); // raw non-JSON
  if (r < 0.35) return ''; // empty
  if (r < 0.45) return '{' + 'a'.repeat(Math.floor(rng() * 50)); // truncated json
  const obj = {};
  const n = Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) obj['k' + i] = weird(rng);
  if (rng() < 0.6) obj.t = rng() < 0.5 ? 't' + Math.floor(rng() * 30) : validSeeds()[Math.floor(rng() * 13)].t;
  try { return JSON.stringify(obj); } catch { return '{}'; }
}

module.exports = { mulberry32, validSeeds, mutate, randomFrame, weird };
