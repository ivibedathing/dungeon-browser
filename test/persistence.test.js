// Phase 3 exit proof — a character survives a server restart against real Postgres.
// Gated on DATABASE_URL (Docker in dev; skipped in the default service-free suite):
//   docker run -d --name db-dungeon -e POSTGRES_PASSWORD=dev -p 5433:5432 postgres:16
//   DATABASE_URL=postgres://postgres:dev@localhost:5433/postgres node --test test/persistence.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Game = require('../js/game.js');

const Net = require('../js/net.js');
const { createServer } = require('../server/server.js');
const { createStore } = require('../server/store.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await wait(20);
  }
  return false;
}
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function startServer(databaseUrl) {
  const srv = createServer({ port: 0, tickHz: 30, databaseUrl });
  return new Promise((resolve) => srv.wss.on('listening', () => resolve(srv)));
}
function connectClient(url, storage) {
  const net = Net.create({ now: () => Date.now(), storage });
  net.connect(url, WebSocket);
  return net;
}

if (process.env.DATABASE_URL) {
  const DB = process.env.DATABASE_URL;

  test('a character resumes at its saved level after a full server restart', async (t) => {
    // Start from a clean schema.
    const seed = createStore({ databaseUrl: DB });
    await seed.init();
    await seed.__resetForTests();
    await seed.close();

    // ---- Session 1: register, create, play, level up (persists) ----
    const srv1 = await startServer(DB);
    await srv1.ready;
    t.after(() => srv1.close().catch(() => {}));
    const net1 = connectClient(`ws://127.0.0.1:${srv1.port}`, fakeStorage());
    net1.onOpen = () => net1.register('resumer', 'a good password', 'Resumer');
    assert.ok(await until(() => net1.authStatus === 'authed'), 'registered on server 1');

    net1.createChar(0, 'Resumer');
    assert.ok(await until(() => net1.characters && net1.characters.length === 1), 'character created');
    net1.selectChar(0);
    assert.ok(await until(() => net1.selectedSlot === 0), 'selected');
    net1.join('Resumer', '#4a5578', null);
    assert.ok(await until(() => net1.you && net1.code), 'joined a room');
    const token = net1.token;

    const room = srv1.rooms.get(net1.code);
    assert.ok(await until(() => room.state.players.length === 1), 'seated on the server');
    // Let the room tick a few times so the save tracker is seeded at level 1, then
    // level up: the next tick fires a 'level' save.
    assert.ok(await until(() => room.tick_ > 3), 'room is ticking');
    room.state.players[0].level = 9;
    room.state.players[0].xp = 250;

    const account = await srv1.store.verifyLogin('resumer', 'a good password');
    assert.ok(
      await until(async () => {
        const blob = await srv1.store.loadCharacter(account.id, 0);
        return blob && blob.player.level === 9;
      }),
      'the level-up was persisted to Postgres'
    );

    net1.close();
    await srv1.close(); // the crash: process gone, DB intact

    // ---- Session 2: a brand-new server on the same DB, resume by token ----
    const srv2 = await startServer(DB);
    await srv2.ready;
    t.after(() => srv2.close().catch(() => {}));
    const net2 = connectClient(`ws://127.0.0.1:${srv2.port}`, fakeStorage());
    net2.onOpen = () => net2.resume(token);
    assert.ok(await until(() => net2.authStatus === 'authed'), 'resumed the session on server 2');
    assert.ok(
      net2.characters.some((c) => c.slot === 0 && c.level === 9),
      'the resumed session lists the level-9 character'
    );

    net2.selectChar(0);
    assert.ok(await until(() => net2.selectedSlot === 0), 'selected on server 2');
    net2.join('Resumer', '#4a5578', null);
    assert.ok(await until(() => net2.you && net2.code), 'rejoined');
    const room2 = srv2.rooms.get(net2.code);
    assert.ok(await until(() => room2.state.players.length === 1), 'seated again');
    assert.equal(room2.state.players[0].level, 9, 'the hero resumed at its saved level — persistence survived the restart');
    assert.equal(room2.state.players[0].xp, 250, 'and its xp');

    net2.close();
  });
}
