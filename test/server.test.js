// Phase 1 exit test — a real server on loopback, driven by scripted ws clients.
// This is the integration proof the roadmap calls for: two clients co-exist in
// one room, move, one kills a monster, both receive consistent snapshots, and
// abusive clients get kicked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');

const PORT = 0; // let the OS pick a free port

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer({ port: PORT, tickHz: 30 });
    srv.wss.on('listening', () => resolve(srv));
  });
}

// A scripted client: connects, records every message by type, and exposes the
// latest snapshot for assertions.
class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.byType = {};
    this.snapshots = [];
    this.welcome = null;
    this.errors = [];
    this.closed = null;
    this.seq = 0;
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      (this.byType[msg.t] ||= []).push(msg);
      if (msg.t === 'snapshot') this.snapshots.push(msg);
      if (msg.t === 'welcome') this.welcome = msg;
      if (msg.t === 'error') this.errors.push(msg);
    });
    this.ws.on('close', (code) => {
      this.closed = code;
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  sendRaw(text) {
    this.ws.send(text);
  }
  join(name, code) {
    this.send({ t: 'join', name, code: code || undefined });
  }
  // A held-key input frame with an auto-incrementing seq.
  move(keys, pressed) {
    this.seq += 1;
    this.send({
      t: 'input',
      seq: this.seq,
      keys: Object.assign({ w: false, a: false, s: false, d: false, space: false }, keys),
      pressed: pressed || [],
      mouse: { x: 0, y: 0, click: false, rclick: false },
    });
  }
  get latest() {
    return this.snapshots[this.snapshots.length - 1] || null;
  }
  close() {
    this.ws.close();
  }
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

test('two clients share a room by code, move independently, and both see the world', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = new Client(url);
  await host.open();
  host.join('Ash'); // no code → host a new room
  assert.ok(await until(() => host.welcome), 'host got a welcome');
  const code = host.welcome.code;
  assert.match(code, /^[A-Z0-9]{4,6}$/, 'welcome carries a join code');
  assert.equal(host.welcome.you, 'p0', 'host is p0');

  const guest = new Client(url);
  await guest.open();
  guest.join('Bo', code);
  assert.ok(await until(() => guest.welcome), 'guest got a welcome');
  assert.equal(guest.welcome.code, code, 'guest joined the same room');
  assert.notEqual(guest.welcome.you, host.welcome.you, 'distinct player ids');

  // Both should start receiving snapshots that list two players.
  assert.ok(await until(() => host.latest && host.latest.players.length === 2), 'host sees both players');
  assert.ok(await until(() => guest.latest && guest.latest.players.length === 2), 'guest sees both players');

  // Drive them apart: host holds right, guest holds left, for ~0.7s.
  const hostP0 = host.latest.players.find((p) => p.id === host.welcome.you);
  const x0 = hostP0.x;
  const t1 = Date.now();
  while (Date.now() - t1 < 700) {
    host.move({ d: true });
    guest.move({ a: true });
    await wait(1000 / 30);
  }
  await wait(100);

  const hostNow = host.latest.players.find((p) => p.id === host.welcome.you);
  assert.ok(hostNow.x > x0 + 20, 'host moved right in its own view');

  // Consistency: the guest's snapshot agrees on where the host is (within a tick
  // of travel — the two clients read from the same authoritative sim).
  const hostInGuestView = guest.latest.players.find((p) => p.id === host.welcome.you);
  assert.ok(hostInGuestView, 'guest sees the host as a party member');
  assert.ok(Math.abs(hostInGuestView.x - hostNow.x) < 40, 'both clients agree on the host position');

  // The server acks the client's own input seq for Phase 2 reconciliation.
  assert.ok(host.latest.ack >= 1, 'snapshot acks the latest processed input seq');
});

test('one client kills a monster and both clients observe the death consistently', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = new Client(url);
  await host.open();
  host.join('Ash');
  assert.ok(await until(() => host.welcome), 'host welcomed');
  const code = host.welcome.code;
  const room = srv.rooms.get(code);
  assert.ok(room, 'room exists in the registry');

  const guest = new Client(url);
  await guest.open();
  guest.join('Bo', code);
  assert.ok(await until(() => guest.welcome), 'guest welcomed');
  assert.ok(await until(() => room.playerCount === 2), 'server room has two players');

  // Plant a single, almost-dead monster right on top of the host and clear the
  // rest so the kill is unambiguous. (Reaching into room.state is the test being
  // the authority the sim otherwise is.)
  const p = room.state.players[0];
  room.state.monsters.length = 0;
  room.state.monsters.push({
    ...Entities.makeMonster('bat', 1, false),
    id: 40404,
    x: p.x + 18,
    y: p.y,
    hp: 1,
    attackT: 99,
    hitT: 0,
    lungeT: 0,
    wanderT: 99,
    wandA: 0,
    aggroed: false,
    kbx: 0,
    kby: 0,
  });

  assert.ok(await until(() => (host.latest && host.latest.monsters.some((m) => m.id === 40404))), 'both see the monster before the kill');

  // Host swings (held attack is keys.space) until the monster is gone.
  assert.ok(
    await until(() => {
      host.move({ space: true });
      return !room.state.monsters.some((m) => m.id === 40404);
    }, 3000),
    'the monster died on the server'
  );

  // The kill propagates to both snapshots.
  assert.ok(await until(() => host.latest && !host.latest.monsters.some((m) => m.id === 40404)), 'host snapshot drops the dead monster');
  assert.ok(await until(() => guest.latest && !guest.latest.monsters.some((m) => m.id === 40404)), 'guest snapshot drops it too');
  assert.equal(room.state.kills, 1, 'the server counted exactly one kill');
});

test('a joins-by-unknown-code client is told the room does not exist', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());
  const c = new Client(url);
  await c.open();
  c.join('Nobody', 'ZZZZ');
  assert.ok(await until(() => c.errors.length > 0 || c.closed !== null), 'server responded to a bad code');
  assert.ok(c.errors.some((e) => e.reason === 'no_room') || c.closed !== null, 'unknown room is rejected');
});

test('a fifth player cannot join a full room', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = new Client(url);
  await host.open();
  host.join('Ash');
  assert.ok(await until(() => host.welcome), 'host welcomed');
  const code = host.welcome.code;

  const others = [];
  for (let i = 0; i < 3; i++) {
    const c = new Client(url);
    await c.open();
    c.join(`p${i}`, code);
    others.push(c);
  }
  assert.ok(await until(() => others.every((c) => c.welcome)), 'seats 2-4 filled');

  const fifth = new Client(url);
  await fifth.open();
  fifth.join('Overflow', code);
  assert.ok(await until(() => fifth.errors.length > 0 || fifth.closed !== null), 'fifth handled');
  assert.ok(fifth.errors.some((e) => e.reason === 'room_full') || fifth.closed !== null, 'room full is signalled');
  assert.equal(fifth.welcome, null, 'no welcome for the fifth player');
});

test('malformed frames and floods get the sender kicked without harming the room', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = new Client(url);
  await host.open();
  host.join('Ash');
  assert.ok(await until(() => host.welcome), 'host welcomed');
  const code = host.welcome.code;
  const room = srv.rooms.get(code);

  // A well-behaved bystander whose experience must survive the abuser.
  const bystander = new Client(url);
  await bystander.open();
  bystander.join('Bo', code);
  assert.ok(await until(() => bystander.welcome), 'bystander joined');
  const goodSnaps = () => bystander.snapshots.length;
  const snapsBefore = goodSnaps();

  // The abuser: valid handshake, then garbage.
  const abuser = new Client(url);
  await abuser.open();
  abuser.join('Griefer', code);
  assert.ok(await until(() => abuser.welcome), 'abuser handshook');
  abuser.sendRaw('}{ not json at all');
  assert.ok(await until(() => abuser.closed !== null), 'the malformed-frame sender was disconnected');

  // A second abuser floods valid inputs far faster than 30 Hz.
  const flooder = new Client(url);
  await flooder.open();
  flooder.join('Flood', code);
  assert.ok(await until(() => flooder.welcome), 'flooder handshook');
  for (let i = 0; i < 500; i++) flooder.move({ d: true });
  assert.ok(await until(() => flooder.closed !== null), 'the flooder was rate-limited and dropped');

  // The room and the bystander are unharmed.
  assert.ok(room.playerCount >= 1, 'the room survived the abuse');
  assert.ok(await until(() => goodSnaps() > snapsBefore + 3), 'the bystander kept receiving snapshots throughout');
  assert.equal(bystander.closed, null, 'the well-behaved client was never disconnected');
});

test('a leaving client is removed and its empty room is reaped', async (t) => {
  const srv = await startServer();
  const url = `ws://127.0.0.1:${srv.port}`;
  t.after(() => srv.close());

  const host = new Client(url);
  await host.open();
  host.join('Ash');
  assert.ok(await until(() => host.welcome), 'host welcomed');
  const code = host.welcome.code;
  assert.ok(srv.rooms.has(code), 'room registered');

  host.close();
  assert.ok(await until(() => !srv.rooms.has(code), 4000), 'the empty room was reaped after the last player left');
});
