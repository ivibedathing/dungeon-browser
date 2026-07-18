// Phase 5 Task 1 — the protocol + room fuzzer (seeded CI slice). The invariant:
// NO attacker-shaped frame may crash a room or the validator. Rejection (a kick) is
// fine; a throw that escapes is not. A failing seed reproduces exactly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Protocol = require('../server/protocol.js');
const { Room } = require('../server/room.js');
const FuzzGen = require('../server/fuzz-gen.js');

test('Protocol.decode never throws for any raw input', () => {
  const rng = FuzzGen.mulberry32(0xC0FFEE);
  for (let i = 0; i < 3000; i++) {
    const raw = FuzzGen.randomFrame(rng);
    let res;
    assert.doesNotThrow(() => { res = Protocol.decode(raw); }, `decode threw on seed frame ${i}`);
    assert.ok(res && typeof res.ok === 'boolean', 'decode always returns {ok}');
  }
  // Also the pathological direct inputs.
  for (const raw of ['', '\0\0', 'null', '[]', '"str"', '123', Buffer.from([0xff, 0xfe]), 'x'.repeat(200000)]) {
    assert.doesNotThrow(() => Protocol.decode(raw));
  }
});

test('Protocol.validateClient never throws for any object', () => {
  const rng = FuzzGen.mulberry32(42);
  const seeds = FuzzGen.validSeeds();
  for (let i = 0; i < 4000; i++) {
    const seed = seeds[i % seeds.length];
    const m = FuzzGen.mutate(seed, rng);
    let res;
    assert.doesNotThrow(() => { res = Protocol.validateClient(m); }, `validateClient threw (seed ${i}): ${JSON.stringify(m).slice(0, 120)}`);
    assert.ok(res && typeof res.ok === 'boolean');
  }
  // Random non-message objects too.
  for (const bad of [null, undefined, 42, 'x', [], {}, { t: null }, { t: 123 }, { t: {} }]) {
    assert.doesNotThrow(() => Protocol.validateClient(bad));
  }
});

test('a Room fed decoded+validated fuzz frames never throws and stays consistent', () => {
  const rng = FuzzGen.mulberry32(7);
  const room = new Room({ code: 'FUZZ', seed: 1 });
  const seat = room.join({});
  const seeds = FuzzGen.validSeeds();
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    const raw = i % 3 === 0 ? FuzzGen.randomFrame(rng) : JSON.stringify(FuzzGen.mutate(seeds[i % seeds.length], rng));
    const dec = Protocol.decode(raw);
    if (dec.ok) {
      const v = Protocol.validateClient(dec.msg);
      if (v.ok && v.msg.t === 'input') assert.doesNotThrow(() => room.setInput(seat.id, v.msg));
    }
    if (i % 50 === 0) { t += 34; assert.doesNotThrow(() => room.tick(t)); }
  }
  // Consistency invariants: no orphan input buffers, seat still present.
  assert.equal(room.inputs.size, room.state.players.length, 'one input buffer per seated player');
  assert.ok(room.state.players.some((p) => p.id === seat.id), 'the seat survived the barrage');
});

test('a Room under valid-but-adversarial input + join/leave churn ticks cleanly', () => {
  const room = new Room({ code: 'ADVR', seed: 2 });
  const ids = [];
  let t = 0;
  const everyEdge = Array.from(Protocol.EDGES);
  for (let i = 0; i < 500; i++) {
    // churn seats
    if (room.playerCount < Room.MAX_PLAYERS && i % 3 === 0) {
      const s = room.join({});
      if (s) ids.push(s.id);
    }
    if (ids.length && i % 7 === 0) {
      const gone = ids.shift();
      room.leave(gone);
    }
    // hammer every seated player with max seq + every edge + teleporting mouse
    for (const id of room.state.players.map((p) => p.id)) {
      const msg = Protocol.validateClient({
        t: 'input',
        seq: Number.MAX_SAFE_INTEGER - i,
        keys: { w: true, a: true, s: true, d: true, space: true },
        pressed: everyEdge,
        mouse: { x: (i % 2 ? 1 : -1) * 1e6, y: (i % 2 ? -1 : 1) * 1e6, click: true, rclick: true },
      });
      assert.equal(msg.ok, true, 'the adversarial-but-legal input validates');
      room.setInput(id, msg.msg);
    }
    t += 34;
    assert.doesNotThrow(() => room.tick(t), `tick ${i} threw`);
    // no orphan input buffers ever
    assert.equal(room.inputs.size, room.state.players.length);
  }
});
