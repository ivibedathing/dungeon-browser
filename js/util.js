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
