// Phase 4.5 Track A — the optional asset loader. The guarantee: every failure mode
// falls back to procedural, load() never rejects, and file:// never fetches.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Assets = require('../js/assets.js');

const okFetch = (json) => async () => ({ json: async () => json });

test('an empty manifest → nothing available, load resolves', async () => {
  Assets.reset();
  const r = await Assets.load('/assets/manifest.json', { protocol: 'https:', fetch: okFetch({ version: 1, entries: {} }) });
  assert.equal(r.loaded, 0);
  assert.equal(Assets.available(), false);
  assert.equal(Assets.get('anything'), null, 'get falls back to null (⇒ procedural)');
});

test('a 404 on one entry falls back; others still load', async () => {
  Assets.reset();
  const manifest = { version: 1, entries: { good: { url: '/a.png' }, bad: { url: '/missing.png' } } };
  const loadImage = (url) => (url === '/missing.png' ? Promise.reject(new Error('404')) : Promise.resolve({ img: url }));
  const r = await Assets.load('/m.json', { protocol: 'https:', fetch: okFetch(manifest), loadImage });
  assert.equal(r.loaded, 1);
  assert.equal(r.failed, 1);
  assert.ok(Assets.get('good'), 'the good asset loaded');
  assert.equal(Assets.get('bad'), null, 'the failed asset falls back');
});

test('a malformed manifest resolves (never rejects)', async () => {
  Assets.reset();
  await assert.doesNotReject(async () => {
    const r = await Assets.load('/m.json', { protocol: 'https:', fetch: okFetch('not an object') });
    assert.equal(r.loaded, 0);
  });
});

test('a thrown fetch resolves to a pure-procedural result', async () => {
  Assets.reset();
  const r = await Assets.load('/m.json', { protocol: 'https:', fetch: async () => { throw new Error('offline'); } });
  assert.equal(r.loaded, 0);
  assert.equal(Assets.available(), false);
});

test('file:// skips the fetch entirely', async () => {
  Assets.reset();
  let fetched = false;
  const r = await Assets.load('/m.json', { protocol: 'file:', fetch: async () => { fetched = true; return { json: async () => ({}) }; } });
  assert.equal(fetched, false, 'no fetch attempted on file://');
  assert.equal(r.skipped, true);
});

test('the shipped manifest is empty (assets are opt-in)', () => {
  const m = require('../assets/manifest.json');
  assert.deepEqual(m.entries, {}, 'ships with no assets so the game is fully procedural');
});
