// Phase 2 (client netplay) tests — grows task by task.
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Game = require('../js/game.js');
const Game = globalThis.Game;

function freshInput(over = {}) {
  return {
    keys: Object.assign({ w: false, a: false, s: false, d: false, space: false }, over.keys),
    pressed: new Set(over.pressed || []),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// ---- Task 1: prediction parity ----

test('Game.predictMovement moves a player identically to Game.update (no rubber-band)', () => {
  // Two lone players from the same seed/floor: one advanced by the full sim, one by the
  // client predictor. Their positions must stay bit-identical, or reconciliation snaps.
  const sim = Game.newRun(101);
  sim.monsters.length = 0;
  const predicted = Game.newRun(101);
  predicted.monsters.length = 0;

  const grid = predicted.dungeon.grid;
  const pp = predicted.player;

  for (let i = 0; i < 60; i++) {
    const held = freshInput({ keys: { d: true } });
    Game.update(sim, { p0: held }, 1 / 30);
    const stats = Entities.effectiveStats(pp);
    Game.predictMovement(grid, pp, freshInput({ keys: { d: true } }), 1 / 30, stats);
  }

  assert.equal(pp.x, sim.player.x, 'predicted x matches the authoritative sim exactly');
  assert.equal(pp.y, sim.player.y, 'predicted y matches');
  assert.equal(pp.facing, sim.player.facing, 'facing matches');
});

test('Game.predictMovement reproduces a dodge roll', () => {
  const state = Game.newRun(102);
  state.monsters.length = 0;
  const p = state.player;
  const grid = state.dungeon.grid;
  const stats = Entities.effectiveStats(p);
  const x0 = p.x;

  const dodged = Game.predictMovement(grid, p, freshInput({ keys: { d: true }, pressed: ['dodge'] }), 1 / 30, stats);
  assert.equal(dodged, true, 'predictMovement reports that a dodge started (so the server can emit its juice)');
  assert.ok(p.dodgeCdT > 0, 'dodge armed the cooldown');
  assert.ok(p.dodgeT > 0, 'dodge is in progress');
  // A dodge dashes far faster than a walk: one frame of roll clears real ground.
  assert.ok(p.x - x0 > 10, 'the roll dashed the player this frame');
});

test('Game.predictMovement only touches movement — no attacks, pickups, or world rebuild', () => {
  const state = Game.newRun(103);
  const p = state.player;
  const grid = state.dungeon.grid;
  const stats = Entities.effectiveStats(p);
  const monstersBefore = state.monsters.length;
  const eventsBefore = state.events.length;

  // Space is the attack-held flag; predictMovement must ignore it.
  Game.predictMovement(grid, p, freshInput({ keys: { d: true, space: true } }), 1 / 30, stats);

  assert.equal(state.monsters.length, monstersBefore, 'no monster was harmed');
  assert.equal(state.events.length, eventsBefore, 'movement emits no sim events (dodge sfx is a sim concern, not prediction)');
});

// ---- Task 2: Net core (snapshot buffer, interpolation, reconciliation) ----

const Net = require('../js/net.js');

// A fake WebSocket: records every frame sent, and lets a test push inbound frames.
function fakeSocket() {
  const sock = {
    sent: [],
    readyState: 1, // OPEN
    OPEN: 1,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1000 });
    },
  };
  return sock;
}

// A Net connection wired to a mutable clock and a fake socket, already welcomed.
function connectedNet(over = {}) {
  const clock = { t: 1000 };
  const sock = fakeSocket();
  const net = Net.create({ now: () => clock.t, socket: sock });
  net.onServerMessage({ t: 'welcome', v: 1, code: 'ABCD', seed: 777, you: 'p0', tickHz: 30 });
  return { net, sock, clock };
}

function snap(tick, over = {}) {
  return Object.assign(
    { t: 'snapshot', tick, you: 'p0', ack: -1, floor: 1, players: [], monsters: [], projectiles: [], groundItems: [], events: [] },
    over
  );
}

test('welcome primes the connection with the room seed and local id', () => {
  const { net } = connectedNet();
  assert.equal(net.you, 'p0');
  assert.equal(net.seed, 777);
  assert.equal(net.code, 'ABCD');
  assert.equal(net.status, 'open');
});

test('interpolatedAt lerps an entity halfway between two snapshots', () => {
  const { net, clock } = connectedNet();
  clock.t = 1000;
  net.onServerMessage(snap(1, { monsters: [{ id: 5, x: 0, y: 0, facing: 0 }] }));
  clock.t = 1100;
  net.onServerMessage(snap(2, { monsters: [{ id: 5, x: 100, y: 40, facing: 0 }] }));

  // Render 100ms in the past: at now=1150, target=1050, the midpoint of [1000,1100].
  const view = net.interpolatedAt(1150);
  const m = view.monsters.find((e) => e.id === 5);
  assert.ok(Math.abs(m.x - 50) < 0.001, `x lerped to ~50, got ${m.x}`);
  assert.ok(Math.abs(m.y - 20) < 0.001, `y lerped to ~20, got ${m.y}`);
});

test('interpolatedAt clamps to the only snapshot before a pair exists — no NaN', () => {
  const { net, clock } = connectedNet();
  clock.t = 1000;
  net.onServerMessage(snap(1, { monsters: [{ id: 7, x: 12, y: 34, facing: 0 }] }));
  const view = net.interpolatedAt(1200);
  const m = view.monsters.find((e) => e.id === 7);
  assert.ok(m && Number.isFinite(m.x) && Number.isFinite(m.y), 'positions are finite');
  assert.equal(m.x, 12);
  assert.equal(m.y, 34);
});

test('interpolatedAt takes the short way around the ±π seam', () => {
  const { net, clock } = connectedNet();
  clock.t = 1000;
  net.onServerMessage(snap(1, { monsters: [{ id: 9, x: 0, y: 0, facing: 3.0 }] }));
  clock.t = 1100;
  net.onServerMessage(snap(2, { monsters: [{ id: 9, x: 0, y: 0, facing: -3.0 }] }));
  const m = net.interpolatedAt(1150).monsters.find((e) => e.id === 9);
  // 3.0 → -3.0 the short way passes through ±π (~3.14), never through 0.
  assert.ok(Math.abs(m.facing) > 3.0, `facing stayed near the seam, got ${m.facing}`);
});

test('sendInput numbers frames and tracks them until the server acks', () => {
  const { net, sock } = connectedNet();
  const mk = () => freshInput({ keys: { d: true } });
  net.sendInput(mk(), 2000);
  net.sendInput(mk(), 2033);
  net.sendInput(mk(), 2066);
  net.sendInput(mk(), 2099);

  assert.deepEqual(sock.sent.filter((m) => m.t === 'input').map((m) => m.seq), [1, 2, 3, 4], 'seq increments per frame');
  assert.ok(Array.isArray(sock.sent[0].pressed), 'pressed rides as an array on the wire');
  assert.equal(net.unackedCount, 4, 'all four are in flight');

  net.onServerMessage(snap(10, { ack: 3 }));
  assert.equal(net.lastAckedSeq, 3);
  assert.equal(net.unackedCount, 1, 'acked frames dropped; only seq 4 remains in flight');
});

test('reconcileLocal rebases on the server then replays in-flight inputs', () => {
  const { net } = connectedNet();
  const predState = Game.newRun(777);
  predState.monsters.length = 0;
  const grid = predState.dungeon.grid;

  // Two right-move frames are sent but not yet acked.
  net.sendInput(freshInput({ keys: { d: true } }), 2000);
  net.sendInput(freshInput({ keys: { d: true } }), 2033);

  // The server's authoritative base puts the local player at a known point.
  const baseX = 500;
  const baseY = 300;
  net.onServerMessage(
    snap(10, {
      ack: -1, // neither input acked yet
      players: [{ id: 'p0', x: baseX, y: baseY, facing: 0, hp: 100, maxHP: 100, dodgeT: 0, dodgeCdT: 0 }],
    })
  );

  net.reconcileLocal(predState, 2100);

  // Independently replay the same two rights from the same base to get the oracle.
  const oracle = Game.newRun(777);
  oracle.monsters.length = 0;
  const op = oracle.player;
  op.x = baseX;
  op.y = baseY;
  op.facing = 0;
  op.dodgeT = 0;
  op.dodgeCdT = 0;
  const stats = Entities.effectiveStats(op);
  Game.predictMovement(grid, op, freshInput({ keys: { d: true } }), 1 / 30, stats);
  Game.predictMovement(grid, op, freshInput({ keys: { d: true } }), 1 / 30, stats);

  assert.ok(predState.player.x > baseX, 'the two in-flight rights were replayed forward');
  assert.ok(Math.abs(predState.player.x - op.x) < 1e-9, 'reconciled position equals the replay oracle');
  assert.ok(Math.abs(predState.player.y - op.y) < 1e-9, 'y matches the oracle too');
});

test('a stale snapshot never rewinds the acked seq or the buffer', () => {
  const { net } = connectedNet();
  net.onServerMessage(snap(20, { ack: 5 }));
  net.onServerMessage(snap(19, { ack: 2 })); // arrives late, lower tick
  assert.equal(net.lastAckedSeq, 5, 'ack only moves forward');
  assert.equal(net.latestTick, 20, 'the newest tick is retained despite the reorder');
});

test('takeEvents yields each snapshot\'s juice exactly once', () => {
  const { net } = connectedNet();
  net.onServerMessage(snap(1, { events: [{ type: 'message', text: 'hi' }] }));
  net.onServerMessage(snap(2, { events: [{ type: 'sfx', name: 'kill' }] }));
  const first = net.takeEvents();
  assert.equal(first.length, 2, 'both fresh snapshots\' events drained');
  assert.equal(net.takeEvents().length, 0, 'nothing re-delivered');
  net.onServerMessage(snap(3, { events: [{ type: 'float', x: 0, y: 0, text: '5' }] }));
  assert.equal(net.takeEvents().length, 1, 'only the new snapshot\'s events');
});

// ---- Task 3: render all players + remote render-state ----

globalThis.Render = require('../js/render.js');
const Render = globalThis.Render;

function makeCtx() {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (typeof t[prop] !== 'undefined') return t[prop];
      const fn = () => {};
      t[prop] = fn;
      return fn;
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

test('Render.draw draws every living party member, skipping the dead', () => {
  const state = Game.newRun(210);
  state.monsters.length = 0;
  const p0 = state.player;
  // A lean ally, snapshot-shaped (no equip), beside the host, plus a dead one.
  const ally = { id: 'p1', name: 'Bo', shirt: '#7a5578', x: p0.x + 30, y: p0.y, facing: 0, hp: 80, maxHP: 100, level: 1, dead: false, swing: null, dodgeT: 0, hurtT: 0, equip: {} };
  const ghost = { ...ally, id: 'p2', x: p0.x - 30, dead: true };
  state.players.push(ally, ghost);

  const R = Render._;
  const drawn = [];
  const orig = R.drawPlayer;
  R.drawPlayer = (ctx, st, pl) => drawn.push((pl || st.player).id);
  try {
    Render.draw(makeCtx(), state, { w: 800, h: 600 });
  } finally {
    R.drawPlayer = orig;
  }
  assert.ok(drawn.includes('p0'), 'the local hero drew');
  assert.ok(drawn.includes('p1'), 'the living ally drew');
  assert.ok(!drawn.includes('p2'), 'the dead ally was not drawn');
});

test('drawing a lean ally (no equipment) does not crash', () => {
  const state = Game.newRun(211);
  state.monsters.length = 0;
  const ally = { id: 'p1', name: 'Bo', shirt: '#7a5578', x: state.player.x + 24, y: state.player.y, facing: 1, hp: 50, maxHP: 100, level: 2, dead: false, swing: { t: 0.02, dur: 0.2, facing: 1, arc: 2, radius: 60, ranged: false }, dodgeT: 0, hurtT: 0.1, equip: {} };
  state.players.push(ally);
  assert.doesNotThrow(() => Render.draw(makeCtx(), state, { w: 800, h: 600 }));
});

test('Net.buildRenderState yields a sim-shaped object Render.draw can consume', () => {
  const { net, clock } = connectedNet();
  const you = 'p0';
  clock.t = 1000;
  net.onServerMessage(
    snap(1, {
      you,
      floor: 1,
      players: [
        { id: 'p0', x: 400, y: 300, facing: 0, hp: 100, maxHP: 100, dead: false, dodgeT: 0, hurtT: 0 },
        { id: 'p1', x: 460, y: 300, facing: 3, hp: 90, maxHP: 100, dead: false, dodgeT: 0, hurtT: 0 },
      ],
      monsters: [{ id: 5, type: 'bat', name: 'Bat', x: 500, y: 300, hp: 8, maxHP: 10, facing: 0, r: 8 }],
    })
  );

  // The persistent client render-state, seeded with a predicted local hero.
  const netState = net.freshRenderState();
  netState.player.x = 402; // prediction has nudged the local hero a hair past the server base
  netState.player.y = 300;

  net.buildRenderState(netState, 1000);

  assert.ok(netState.dungeon && netState.dungeon.grid, 'grid regenerated from the room seed');
  assert.equal(netState.floor, 1);
  assert.equal(netState.player, netState.players.find((pl) => pl.id === 'p0'), 'local slot is the predicted hero, spliced over interpolation');
  assert.equal(netState.player.x, 402, 'the predicted local position is kept, not the interpolated one');
  assert.ok(netState.players.some((pl) => pl.id === 'p1'), 'the ally is present from interpolation');
  assert.equal(netState.monsters.length, 1, 'remote monster carried in');
  assert.ok(Number.isFinite(netState.cam.x) && Number.isFinite(netState.cam.y), 'camera is finite');
  assert.ok(netState.flow && netState.flow.field, 'fog field computed from the local hero so isVisible works');
  assert.doesNotThrow(() => Render.draw(makeCtx(), netState, { w: 800, h: 600 }), 'the assembled state renders');
});
