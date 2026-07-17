// Phase 1 — the room: membership, input buffering, tick, and AOI-filtered snapshots.
// No sockets here; server.test.js drives the same room over real ws.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Protocol = require('../server/protocol.js');
const { Room } = require('../server/room.js');

function input(over = {}) {
  const msg = Object.assign(
    {
      t: 'input',
      seq: 1,
      keys: { w: false, a: false, s: false, d: false, space: false },
      pressed: [],
      mouse: { x: 0, y: 0, click: false, rclick: false },
    },
    over
  );
  const res = Protocol.validateClient(msg);
  assert.equal(res.ok, true, `test helper built an invalid input: ${res.error}`);
  return res.msg;
}

// Advance a room by `seconds` of simulated time in 30 Hz steps from a fixed clock.
function advance(room, seconds, t0 = 0) {
  const stepMs = 1000 / 30;
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    t += stepMs;
    room.tick(t);
  }
  return t;
}

test('players join, get distinct ids, and land at the floor entry', () => {
  const room = new Room({ code: 'ABCD', seed: 21 });
  const a = room.join({ name: 'Ash', shirt: '#4a5578' });
  const b = room.join({ name: 'Bo', shirt: '#7a5578' });

  assert.notEqual(a.id, b.id, 'ids are distinct');
  assert.equal(room.state.players.length, 2);
  assert.equal(room.state.players[0].id, a.id, 'first joiner is players[0] (the sim treats it as local)');
  assert.equal(room.playerCount, 2);

  const entry = room.state.dungeon.entry;
  for (const p of room.state.players) {
    const tx = Math.floor(p.x / 32);
    const ty = Math.floor(p.y / 32);
    assert.ok(Math.abs(tx - entry.x) <= 2 && Math.abs(ty - entry.y) <= 2, `${p.id} spawned near the entry`);
    assert.equal(p.dead, false);
    assert.ok(p.hp > 0, 'joined alive');
  }
  assert.equal(room.state.players[1].name, 'Bo', 'join name carried onto the player');
});

test('a full room refuses further joins', () => {
  const room = new Room({ code: 'ABCD', seed: 21 });
  for (let i = 0; i < Room.MAX_PLAYERS; i++) assert.ok(room.join({ name: `p${i}` }), `joiner ${i} admitted`);
  assert.equal(room.isFull, true);
  assert.equal(room.join({ name: 'latecomer' }), null, 'join past capacity is refused, not thrown');
  assert.equal(room.playerCount, Room.MAX_PLAYERS);
});

test('inputs route to their own player and nobody else', () => {
  const room = new Room({ code: 'ABCD', seed: 22 });
  const a = room.join({ name: 'Ash' });
  const b = room.join({ name: 'Bo' });
  room.state.monsters.length = 0; // isolate movement from combat

  const pa = room.state.players[0];
  const pb = room.state.players[1];
  const a0 = { x: pa.x, y: pa.y };
  const b0 = { x: pb.x, y: pb.y };

  room.setInput(a.id, input({ seq: 1, keys: { w: false, a: false, s: false, d: true, space: false } }));
  room.setInput(b.id, input({ seq: 1, keys: { w: false, a: false, s: true, d: false, space: false } }));
  advance(room, 1);

  assert.ok(pa.x > a0.x + 20, 'p0 walked right');
  assert.ok(Math.abs(pa.y - a0.y) < 1, 'p0 did not drift down');
  assert.ok(pb.y > b0.y + 20, 'p1 walked down');
  assert.ok(Math.abs(pb.x - b0.x) < 1, 'p1 did not drift right');
});

test('held keys persist across ticks; edge actions fire exactly once', () => {
  const room = new Room({ code: 'ABCD', seed: 23 });
  const a = room.join({ name: 'Ash' });
  room.state.monsters.length = 0;

  room.tick(0); // establish the clock baseline; no step runs on the first call

  // One dodge edge, then many ticks: the roll must trigger a single time.
  room.setInput(a.id, input({ seq: 1, pressed: ['dodge'] }));
  assert.equal(room.tick(1000 / 30), 1, 'one step ran');
  assert.equal(room.inputs.get(a.id).pressed.size, 0, 'edges are consumed by the tick that sees them');

  const p = room.state.players[0];
  const cd = p.dodgeCdT;
  assert.ok(cd > 0, 'the dodge fired');
  advance(room, 0.2, 1000 / 30);
  assert.ok(p.dodgeCdT < cd, 'cooldown ticked down rather than being re-triggered');
  assert.ok(p.dodgeCdT > 0, 'and the single press did not re-arm the roll every tick');
});

test('stale and duplicate seq numbers are ignored; ack reports the newest', () => {
  const room = new Room({ code: 'ABCD', seed: 24 });
  const a = room.join({ name: 'Ash' });

  assert.equal(room.setInput(a.id, input({ seq: 5, keys: { d: true } })), true);
  assert.equal(room.ack(a.id), 5);
  assert.equal(room.setInput(a.id, input({ seq: 3, keys: { a: true } })), false, 'older seq dropped');
  assert.equal(room.setInput(a.id, input({ seq: 5, keys: { a: true } })), false, 'duplicate seq dropped');
  assert.equal(room.ack(a.id), 5, 'ack unmoved by stale traffic');
  assert.equal(room.inputs.get(a.id).keys.d, true, 'the stale packet did not overwrite live input');
  assert.equal(room.setInput(a.id, input({ seq: 6, keys: { a: true } })), true, 'newer seq accepted');
  assert.equal(room.ack(a.id), 6);
});

test('edges from several packets in one tick window accumulate', () => {
  const room = new Room({ code: 'ABCD', seed: 25 });
  const a = room.join({ name: 'Ash' });
  room.setInput(a.id, input({ seq: 1, pressed: ['interact'] }));
  room.setInput(a.id, input({ seq: 2, pressed: ['dodge'] }));
  const buffered = room.inputs.get(a.id).pressed;
  assert.ok(buffered.has('interact') && buffered.has('dodge'), 'no edge is lost between ticks');
});

test('leaving removes the player and the room reports empty', () => {
  const room = new Room({ code: 'ABCD', seed: 26 });
  const a = room.join({ name: 'Ash' });
  const b = room.join({ name: 'Bo' });

  room.leave(a.id);
  assert.equal(room.playerCount, 1);
  assert.equal(room.state.players.some((p) => p.id === a.id), false, 'gone from the sim');
  assert.equal(room.inputs.has(a.id), false, 'input buffer released');
  assert.equal(room.isEmpty, false);

  // The sim must keep stepping with the survivor — a leave mid-tick cannot wedge the loop.
  room.setInput(b.id, input({ seq: 1, keys: { d: true } }));
  assert.doesNotThrow(() => advance(room, 0.5));

  room.leave(b.id);
  assert.equal(room.isEmpty, true, 'server reaps rooms on this flag');
});

test('snapshots are per-player and filtered to the area of interest', () => {
  const room = new Room({ code: 'ABCD', seed: 27 });
  const a = room.join({ name: 'Ash' });
  room.join({ name: 'Bo' });
  room.state.monsters.length = 0;
  room.state.groundItems.length = 0;

  const p = room.state.players[0];
  const near = { id: 9001, type: 'bat', name: 'Bat', hp: 10, maxHP: 10, x: p.x + 50, y: p.y, r: 8, facing: 0, hitT: 0 };
  const far = { ...near, id: 9002, x: p.x + Room.AOI_RADIUS + 400, y: p.y };
  room.state.monsters.push(near, far);
  room.state.groundItems.push(
    { id: 9100, kind: 'gold', amount: 5, x: p.x + 20, y: p.y },
    { id: 9101, kind: 'gold', amount: 5, x: p.x + Room.AOI_RADIUS + 400, y: p.y }
  );

  const snap = room.snapshotFor(a.id);
  assert.equal(snap.t, 'snapshot');
  assert.equal(snap.you, a.id);
  assert.ok(Number.isInteger(snap.tick));
  assert.equal(snap.floor, 1);

  const ids = snap.monsters.map((m) => m.id);
  assert.deepEqual(ids, [9001], 'only the in-range monster is sent');
  assert.deepEqual(snap.groundItems.map((g) => g.id), [9100], 'distant loot withheld');
  assert.equal(snap.players.length, 2, 'party members are always sent — the HUD needs them');

  // The wire carries a projection, not the live objects.
  assert.equal(snap.monsters[0].hp, 10);
  assert.ok(!('aggroed' in snap.monsters[0]), 'server-only AI fields stay server-side');
  assert.ok(!('grid' in snap), 'the dungeon grid is not re-sent every tick');
  assert.ok(JSON.stringify(snap).length < 8000, 'a snapshot stays small enough to send at 30 Hz');
});

test('events are delivered to the players near them and no one else', () => {
  const room = new Room({ code: 'ABCD', seed: 28 });
  const a = room.join({ name: 'Ash' });
  const b = room.join({ name: 'Bo' });
  const pa = room.state.players[0];
  const pb = room.state.players[1];
  // Put Bo far away, then emit a burst at Ash's feet.
  pb.x = pa.x + Room.AOI_RADIUS + 500;

  room.tick(0); // clock baseline
  room.state.events.push({ type: 'burst', x: pa.x, y: pa.y, color: '#fff', n: 3, speed: 90 });
  room.state.events.push({ type: 'message', text: 'a global notice' });
  assert.equal(room.tick(1000 / 30), 1, 'a step ran and drained the events');

  const forA = room.snapshotFor(a.id).events;
  const forB = room.snapshotFor(b.id).events;
  assert.ok(forA.some((e) => e.type === 'burst'), 'Ash sees the burst at her feet');
  assert.ok(!forB.some((e) => e.type === 'burst'), 'Bo does not get juice from across the map');
  assert.ok(forB.some((e) => e.type === 'message'), 'placeless events (messages) reach everyone');
});

test('tick advances the sim in whole 30 Hz steps and reports how many ran', () => {
  const room = new Room({ code: 'ABCD', seed: 29 });
  room.join({ name: 'Ash' });
  room.state.monsters.length = 0;

  assert.equal(room.tick(0), 0, 'first tick establishes the clock baseline');
  assert.equal(room.tick(10), 0, '10ms is less than one 30Hz step: nothing runs yet');
  assert.equal(room.tick(40), 1, 'crossing 1/30s runs exactly one step');
  const t0 = room.state.time;
  assert.equal(room.tick(40 + 100), 3, '100ms banks three steps');
  assert.ok(Math.abs(room.state.time - t0 - 3 / 30) < 1e-9, 'sim time advanced by exactly three ticks');

  const before = room.state.time;
  const ran = room.tick(40 + 100 + 60_000); // a stalled process comes back
  assert.ok(ran <= 8, `runaway catch-up is clamped (ran ${ran})`);
  assert.ok(room.state.time - before <= 0.25 + 1e-9, 'at most 0.25s of sim time per tick call');
});

test('an empty room still ticks without players', () => {
  const room = new Room({ code: 'ABCD', seed: 30 });
  assert.doesNotThrow(() => advance(room, 0.5), 'the loop must not crash between the last leave and the reap');
});
