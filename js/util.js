// util.js — seeded RNG and math helpers. Pure; loaded first in the browser, requireable in Node.
(function () {
  const U = {};

  // Deterministic 32-bit RNG (mulberry32). Returns a function yielding floats in [0, 1).
  U.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  U.randRange = (rng, lo, hi) => lo + rng() * (hi - lo);
  U.pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  U.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist2 = (x1, y1, x2, y2) => (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);

  // ---- Value noise over integer lattices ----
  // Stateless and integer-hash based, so a sample is a pure function of
  // (seed, x, y) with no generation order dependency. This is what lets the
  // overworld generate chunk-by-chunk and still agree on shared borders: two
  // chunks sampling the same world tile always read the same number, whichever
  // one was written first.

  // 32-bit integer hash of two coordinates. Returns a uint32.
  U.hash2 = function (seed, x, y) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed | 0);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2d);
    h ^= h >>> 16;
    return h >>> 0;
  };

  // hash2 as a float in [0, 1).
  U.hash2f = (seed, x, y) => U.hash2(seed, x, y) / 4294967296;

  // Smooth value noise in [0, 1) at fractional (x, y): bilinear blend of the four
  // surrounding lattice hashes, eased with the classic smoothstep so the field is
  // C1 continuous and shows no lattice-aligned creases.
  U.noise2 = function (seed, x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = U.hash2f(seed, xi, yi);
    const b = U.hash2f(seed, xi + 1, yi);
    const c = U.hash2f(seed, xi, yi + 1);
    const d = U.hash2f(seed, xi + 1, yi + 1);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  };

  // Fractional Brownian motion: `octaves` noise2 layers, each double the frequency
  // and `gain` the amplitude. Normalized back into [0, 1).
  U.fbm2 = function (seed, x, y, octaves, gain) {
    const oct = octaves || 4;
    const g = gain === undefined ? 0.5 : gain;
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      // Each octave gets its own seed so layers are independent rather than
      // scaled copies of one field.
      sum += amp * U.noise2((seed ^ Math.imul(i + 1, 0x9e3779b9)) | 0, x * freq, y * freq);
      norm += amp;
      amp *= g;
      freq *= 2;
    }
    return sum / norm;
  };

  // Signed smallest difference between two angles, in [-PI, PI].
  U.angleDiff = function (a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };

  // Is point (px,py) inside the swing arc centered at (cx,cy), pointing at `facing`,
  // spanning `arcWidth` radians total, reaching `radius` pixels?
  U.pointInArc = function (px, py, cx, cy, facing, arcWidth, radius) {
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy > radius * radius) return false;
    const ang = Math.atan2(dy, dx);
    return Math.abs(U.angleDiff(ang, facing)) <= arcWidth / 2;
  };

  if (typeof window !== 'undefined') window.U = U;
  if (typeof module !== 'undefined') module.exports = U;
})();
