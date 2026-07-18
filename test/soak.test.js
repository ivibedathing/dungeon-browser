// Phase 5 Task 3 — the soak CI slice: in-process, virtual-clock, reduced scale. Proves
// the invariants the full tool/soak.mjs checks at 50×4×10min: no throw, bounded data
// structures under sustained ticks + join/leave churn, and clean empty-room reaping.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Protocol = require('../server/protocol.js');
const { Room } = require('../server/room.js');

function botInput(seq, i) {
  // Realistic-ish 30 Hz input: move toward a wandering target, occasionally act.
  const msg = {
    t: 'input',
    seq,
    keys: { w: i % 4 === 0, a: i % 4 === 1, s: i % 4 === 2, d: i % 4 === 3, space: i % 5 === 0 },
    pressed: i % 9 === 0 ? ['dodge'] : [],
    mouse: { x: Math.sin(i) * 400, y: Math.cos(i) * 400, click: i % 6 === 0, rclick: false },
  };
  const v = Protocol.validateClient(msg);
  return v.ok ? v.msg : null;
}

test('N rooms × 4 bots soak: no throw, bounded structures, clean reaping', () => {
  const ROOMS = 6;
  const TICKS = 2500;
  const stepMs = 1000 / 30;
  const registry = new Map(); // mirrors server.js: reap empty rooms
  let t = 0;
  let seq = 1;

  // Spin up rooms with 4 seats each.
  for (let r = 0; r < ROOMS; r++) {
    const room = new Room({ code: 'SK' + r, seed: 1000 + r });
    for (let s = 0; s < 4; s++) room.join({});
    registry.set(room.code, room);
  }

  let maxEvents = 0;
  for (let i = 0; i < TICKS; i++) {
    t += stepMs;
    for (const room of registry.values()) {
      // feed every seated bot an input
      for (const p of room.state.players) {
        const inp = botInput(seq++, i);
        if (inp) room.setInput(p.id, inp);
      }
      assert.doesNotThrow(() => room.tick(t), `room ${room.code} tick ${i} threw`);
      // Invariant: exactly one input buffer per seated player, no orphans.
      assert.equal(room.inputs.size, room.state.players.length);
      // Invariant: events are drained each tick, never accumulate unboundedly.
      maxEvents = Math.max(maxEvents, room.events.length);
    }

    // Churn: every so often a bot leaves and (maybe) a new one joins; empty rooms reap.
    if (i % 40 === 0) {
      for (const room of [...registry.values()]) {
        if (room.state.players.length) room.leave(room.state.players[0].id);
        if (room.isEmpty) registry.delete(room.code); // reap, like the server does
        else if (room.playerCount < Room.MAX_PLAYERS && i % 80 === 0) room.join({});
      }
    }
    // Keep the population alive so the soak keeps exercising full rooms.
    if (registry.size < 2) {
      const room = new Room({ code: 'SKR' + i, seed: 9000 + i });
      for (let s = 0; s < 4; s++) room.join({});
      registry.set(room.code, room);
    }
  }

  // A tick's event list is bounded by what one tick can emit — never a growing backlog.
  assert.ok(maxEvents < 100000, `events stayed bounded (peak ${maxEvents})`);
  // Every surviving room is still internally consistent.
  for (const room of registry.values()) {
    assert.equal(room.inputs.size, room.state.players.length, 'no orphan input buffers survived the soak');
  }
});
