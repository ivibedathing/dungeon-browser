// Phase 4.5 Track A — the boot runner: ordered, weighted steps whose failures are
// non-fatal unless a step is marked required. The fallback guarantee for preload.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Boot = require('../js/boot.js');

test('steps run in registration order', async () => {
  Boot.reset();
  const order = [];
  Boot.step('a', () => order.push('a'));
  Boot.step('b', () => order.push('b'));
  Boot.step('c', () => order.push('c'));
  await Boot.run();
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('onProgress reports weighted fractions ending at exactly 1', async () => {
  Boot.reset();
  Boot.step('light', () => {}, { weight: 1 });
  Boot.step('heavy', () => {}, { weight: 3 });
  const fracs = [];
  await Boot.run((f) => fracs.push(f));
  assert.equal(fracs[0], 0.25, 'after the weight-1 step, 1/4 done');
  assert.equal(fracs[fracs.length - 1], 1, 'ends at exactly 1');
});

test('a non-required step that throws is recorded but the run still resolves ok', async () => {
  Boot.reset();
  let ran = false;
  Boot.step('boom', () => { throw new Error('cache miss'); });
  Boot.step('after', () => { ran = true; });
  const res = await Boot.run();
  assert.equal(res.ok, true, 'a non-required failure never bricks boot');
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].name, 'boom');
  assert.equal(ran, true, 'later steps still run');
});

test('a required step that throws resolves ok:false', async () => {
  Boot.reset();
  Boot.step('critical', () => { throw new Error('no'); }, { required: true });
  const res = await Boot.run();
  assert.equal(res.ok, false);
  assert.equal(res.failed[0].name, 'critical');
});

test('async step functions are awaited', async () => {
  Boot.reset();
  let done = false;
  Boot.step('slow', () => new Promise((r) => setTimeout(() => { done = true; r(); }, 5)));
  await Boot.run();
  assert.equal(done, true, 'run waited for the promise');
});
