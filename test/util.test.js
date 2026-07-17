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
