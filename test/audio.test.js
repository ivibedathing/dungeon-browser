// Phase 4.5 Track A — audio buffer pre-warm. The one expensive allocation (the noise
// buffer) is created once at boot, safely, with a suspended context.
const { test } = require('node:test');
const assert = require('node:assert/strict');

// A minimal suspended AudioContext stub, counting buffer allocations globally.
let bufferCount = 0;
let resumed = false;
class StubAC {
  constructor() {
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
  }
  createGain() { return { gain: {}, connect() {} }; }
  createDynamicsCompressor() { return { connect() {} }; }
  createBuffer(_ch, len) { bufferCount++; return { getChannelData: () => new Float32Array(len) }; }
  resume() { resumed = true; }
}

// audio.js reads window.AudioContext lazily inside ensure(), so set it before warming.
globalThis.window = { AudioContext: StubAC };
const Sfx = require('../js/audio.js');

test('warm() creates the noise buffer exactly once, idempotently', async () => {
  bufferCount = 0;
  await Sfx.warm();
  assert.equal(bufferCount, 1, 'one buffer created');
  await Sfx.warm();
  assert.equal(bufferCount, 1, 'warming again allocates nothing');
});

test('warm() does not resume a suspended context (no pre-gesture audio start)', async () => {
  resumed = false;
  await Sfx.warm();
  assert.equal(resumed, false, 'the context stays suspended until a real user gesture');
});

test('warm() resolves to a promise', () => {
  const r = Sfx.warm();
  assert.ok(r && typeof r.then === 'function');
});
