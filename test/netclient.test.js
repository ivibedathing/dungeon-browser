// Phase 2 integration — the REAL js/net.js client against the REAL server over
// loopback ws. This exercises the whole client netcode loop (sendInput → server
// sim → snapshot → interpolate → reconcile → buildRenderState) end to end; only
// the literal canvas draw and menu clicks are left to the manual browser pass.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

// The sim/render globals the client and server both reach for.
globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Game = require('../js/game.js');

const Net = require('../js/net.js');
const { createServer } = require('../server/server.js');

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer({ port: 0, tickHz: 30 });
    srv.wss.on('listening', () => resolve(srv));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await wait(15);
  }
  return false;
}

function freshInput(over = {}) {
  return {
    keys: Object.assign({ w: false, a: false, s: false, d: false, space: false }, over.keys),
    pressed: new Set(over.pressed || []),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// Connect a real Net client, wait for its welcome, and return it.
async function connectClient(url, name, code) {
  const net = Net.create({ now: () => Date.now() });
  net.connect(url, WebSocket);
  net.onOpen = () => net.join(name, '#4a5578', code);
  const ok = await until(() => net.status === 'open' || net.status === 'error');
  assert.ok(ok, `${name} settled its handshake`);
  return net;
}

test('a real Net client hosts, moves, and its render-state reflects the server world', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const net = await connectClient(url, 'Ash', null);
  assert.equal(net.status, 'open');
  assert.equal(net.you, 'p0');
  const code = net.code;
  assert.match(code, /^[A-Z0-9]{4,6}$/);

  // Wait for the first snapshots to arrive.
  assert.ok(await until(() => net.newestSnapshot() && net.newestSnapshot().players.length === 1), 'snapshots flowing');

  const rs = net.freshRenderState({ name: 'Ash', shirt: '#4a5578' });
  // Seed the predicted hero at the server's reported spawn before moving.
  net.reconcileLocal(rs, Date.now());
  const startX = rs.player.x;

  // Drive right for ~0.6s: send input every frame, reconcile on the way.
  const t0 = Date.now();
  while (Date.now() - t0 < 600) {
    net.sendInput(freshInput({ keys: { d: true } }), Date.now());
    net.reconcileLocal(rs, Date.now());
    await wait(1000 / 30);
  }
  await wait(120);
  net.reconcileLocal(rs, Date.now());
  net.buildRenderState(rs, Date.now());

  assert.ok(rs.player.x > startX + 20, `the predicted hero advanced right (${startX} → ${rs.player.x})`);
  // The authoritative server agrees the hero moved.
  const serverP = srv.rooms.get(code).state.players[0];
  assert.ok(Math.abs(serverP.x - rs.player.x) < 25, 'prediction stays close to the server position (no divergence)');
  assert.ok(rs.dungeon && rs.dungeon.grid, 'render-state regenerated the floor grid from the seed');
});

test('two real clients share a room; each sees the other move, and combat juice crosses the wire', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = await connectClient(url, 'Ash', null);
  const code = host.code;
  const guest = await connectClient(url, 'Bo', code);
  assert.equal(guest.status, 'open');
  assert.notEqual(guest.you, host.you);
  const room = srv.rooms.get(code);
  assert.ok(await until(() => room && room.playerCount === 2), 'both seated on the server');

  // Both clients should see two players in their interpolated view.
  assert.ok(
    await until(() => {
      const v = host.interpolatedAt(Date.now());
      return v.players.length === 2;
    }),
    'host interpolation lists both players'
  );

  // Guest walks down for a while; the host's view of the guest must move down too.
  const guestId = guest.you;
  const before = host.interpolatedAt(Date.now()).players.find((p) => p.id === guestId);
  const t0 = Date.now();
  while (Date.now() - t0 < 700) {
    guest.sendInput(freshInput({ keys: { s: true } }), Date.now());
    host.sendInput(freshInput(), Date.now());
    await wait(1000 / 30);
  }
  await wait(150);
  const after = host.interpolatedAt(Date.now()).players.find((p) => p.id === guestId);
  assert.ok(after.y > before.y + 20, `host sees the guest move down (${Math.round(before.y)} → ${Math.round(after.y)})`);

  // Plant a near-dead monster on the host and let it swing: a kill event must reach
  // the client as juice via takeEvents (blood/sound), proving events cross the wire.
  const hp0 = room.state.players[0];
  room.state.monsters.length = 0;
  room.state.monsters.push({
    ...Entities.makeMonster('bat', 1, false),
    id: 55555, x: hp0.x + 18, y: hp0.y, hp: 1,
    attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: 0, aggroed: false, kbx: 0, kby: 0,
  });

  let sawKillJuice = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 2000 && !sawKillJuice) {
    host.sendInput(freshInput({ keys: { space: true } }), Date.now());
    for (const e of host.takeEvents()) {
      if (e.type === 'kill' || (e.type === 'sfx' && e.name === 'kill') || e.type === 'burst') sawKillJuice = true;
    }
    await wait(1000 / 30);
  }
  assert.ok(sawKillJuice, 'the host received kill/blood juice as server events');
  assert.equal(room.state.monsters.some((m) => m.id === 55555), false, 'the monster is gone server-side');
});

test('prediction converges under a simulated 100ms one-way delay (no rubber-band)', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const net = await connectClient(url, 'Laggy', null);
  net.latencyMs = 100; // ~200ms RTT both directions
  const room = srv.rooms.get(net.code);
  room.state.monsters.length = 0;

  const rs = net.freshRenderState({ name: 'Laggy', shirt: '#4a5578' });
  assert.ok(await until(() => net.newestSnapshot()), 'first snapshot arrived despite the delay');
  net.reconcileLocal(rs, Date.now());

  // March right for a full second; record the predicted x after each reconcile.
  const xs = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 1000) {
    net.sendInput(freshInput({ keys: { d: true } }), Date.now());
    net.reconcileLocal(rs, Date.now());
    xs.push(rs.player.x);
    await wait(1000 / 30);
  }

  // No frame-to-frame backward jump beyond a hair: prediction + replay keeps the
  // local hero moving forward smoothly even though acks lag ~200ms behind.
  let maxBackstep = 0;
  for (let i = 1; i < xs.length; i++) maxBackstep = Math.max(maxBackstep, xs[i - 1] - xs[i]);
  assert.ok(maxBackstep < 3, `local motion never snaps backward (worst backstep ${maxBackstep.toFixed(2)}px)`);
  assert.ok(xs[xs.length - 1] > xs[0] + 40, 'and it actually made forward progress');
});
