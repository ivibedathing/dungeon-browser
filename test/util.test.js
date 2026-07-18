const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');

test('mulberry32 is deterministic per seed', () => {
  const a = U.mulberry32(1234);
  const b = U.mulberry32(1234);
  const c = U.mulberry32(9999);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  const seqC = [c(), c(), c(), c()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, `value ${v} out of [0,1)`);
  }
});

test('randInt returns integers within inclusive bounds', () => {
  const rng = U.mulberry32(42);
  for (let i = 0; i < 500; i++) {
    const v = U.randInt(rng, 3, 7);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 3 && v <= 7, `value ${v} out of [3,7]`);
  }
  // Degenerate range
  assert.equal(U.randInt(rng, 5, 5), 5);
});

test('angleDiff wraps to [-PI, PI]', () => {
  assert.ok(Math.abs(U.angleDiff(0.1, -0.1) - 0.2) < 1e-9);
  // Across the ±PI seam: from just below PI to just above -PI is a small step
  const d = U.angleDiff(-Math.PI + 0.05, Math.PI - 0.05);
  assert.ok(Math.abs(d - 0.1) < 1e-9, `seam diff was ${d}`);
  assert.ok(Math.abs(U.angleDiff(Math.PI, -Math.PI)) < 1e-9);
});

test('pointInArc detects hits inside radius and arc', () => {
  // Facing right (0 rad), 170° arc, radius 80
  const arc = (px, py) => U.pointInArc(px, py, 0, 0, 0, (170 * Math.PI) / 180, 80);
  assert.equal(arc(50, 0), true, 'straight ahead');
  assert.equal(arc(40, 30), true, 'diagonal within arc');
  assert.equal(arc(100, 0), false, 'beyond radius');
  assert.equal(arc(-50, 0), false, 'behind');
  assert.equal(arc(0, 79), false, '90° off-axis is outside a 170° arc');
});

test('pointInArc works across the ±PI seam when facing left', () => {
  const arc = (px, py) => U.pointInArc(px, py, 0, 0, Math.PI, (170 * Math.PI) / 180, 80);
  assert.equal(arc(-50, 0), true, 'straight left');
  assert.equal(arc(-40, -20), true, 'upper-left');
  assert.equal(arc(-40, 20), true, 'lower-left');
  assert.equal(arc(50, 0), false, 'behind (right)');
});

test('clamp and dist2 helpers', () => {
  assert.equal(U.clamp(5, 0, 3), 3);
  assert.equal(U.clamp(-1, 0, 3), 0);
  assert.equal(U.clamp(2, 0, 3), 2);
  assert.equal(U.dist2(0, 0, 3, 4), 25);
});

// ---- Value noise (overworld foundations) ----
// These are the properties the chunked world leans on: a sample must be a pure
// function of (seed, x, y) with no lattice seams, or terrain disagrees with
// itself across a chunk border depending on which chunk generated first.

test('hash2 is deterministic and spreads across the uint32 range', () => {
  assert.equal(U.hash2(7, 12, 34), U.hash2(7, 12, 34), 'same input, same output');
  assert.notEqual(U.hash2(7, 12, 34), U.hash2(8, 12, 34), 'seed matters');
  assert.notEqual(U.hash2(7, 12, 34), U.hash2(7, 34, 12), 'x and y are not symmetric');
  const seen = new Set();
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 40; y++) seen.add(U.hash2(1, x, y));
  }
  assert.ok(seen.size > 1550, `expected near-unique hashes over 1600 cells, got ${seen.size}`);
});

test('noise2 and fbm2 stay in [0,1) and are deterministic', () => {
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 0.37;
    const y = Math.floor(i / 20) * 0.53;
    const n = U.noise2(99, x, y);
    const f = U.fbm2(99, x, y, 4);
    assert.ok(n >= 0 && n < 1, `noise2 out of range: ${n}`);
    assert.ok(f >= 0 && f < 1, `fbm2 out of range: ${f}`);
    assert.equal(U.noise2(99, x, y), n);
    assert.equal(U.fbm2(99, x, y, 4), f);
  }
});

test('noise2 has no seam across integer lattice boundaries', () => {
  // Approaching an integer from below must converge on the value AT the integer.
  // A hash read straight off floor(x) — the naive implementation — jumps here.
  for (const k of [1, 5, 17, -3]) {
    const at = U.noise2(4242, k, 2.5);
    const just = U.noise2(4242, k - 1e-6, 2.5);
    assert.ok(Math.abs(at - just) < 1e-4, `seam at x=${k}: ${just} vs ${at}`);
    const atY = U.noise2(4242, 2.5, k);
    const justY = U.noise2(4242, 2.5, k - 1e-6);
    assert.ok(Math.abs(atY - justY) < 1e-4, `seam at y=${k}: ${justY} vs ${atY}`);
  }
});
