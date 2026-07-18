// server/crypto.js — password hashing and session tokens, on node:crypto only.
//
// scrypt is a memory-hard KDF built into node; no native dependency, no argon2
// toolchain. Hashing runs off the async scrypt so a burst of logins doesn't block
// the event loop (and never touches the 30 Hz game loop, which lives elsewhere).
'use strict';

const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');

// Cost parameters. N=2^14 is the node default and a sensible interactive-login
// cost; encoded into the digest so they can be raised later without breaking
// existing hashes.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, params, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

// Returns `scrypt$N$r$p$saltB64$hashB64`. The salt is unique per password.
async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

// Timing-safe verify. Re-derives with the stored salt+params and compares. Any
// malformed stored value returns false rather than throwing.
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  let derived;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// Opaque, URL-safe session token. 256 bits of entropy — unguessable, no structure.
function mintToken() {
  return randomBytes(32).toString('base64url');
}

module.exports = { hashPassword, verifyPassword, mintToken };
