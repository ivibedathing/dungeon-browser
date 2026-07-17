// server/server.js — the ws front door: one process, many rooms.
//
// Responsibilities kept deliberately thin. The server owns sockets, the room
// registry, and the per-room tick loop; it validates every inbound frame through
// Protocol and never lets an unvalidated field reach a Room. All game logic lives
// in the Room and the sim below it.
//
// Run directly:  node server/server.js   (PORT env var, default 8080)
// Embed in tests: createServer({ port: 0 }) → { wss, rooms, port, close }.
'use strict';

const { WebSocketServer } = require('ws');
const Protocol = require('./protocol.js');
const { Room } = require('./room.js');

// Join codes are drawn from a confusable-free alphabet (see protocol) so a code
// read aloud round-trips. Collisions are re-rolled against the live registry.
function makeCode(rooms, rng) {
  const A = Protocol.CODE_ALPHABET;
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < Protocol.CODE_LEN; i++) code += A[Math.floor(rng() * A.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('room-code space exhausted'); // ~1M codes; this is a real outage, not a retry
}

function createServer(opts = {}) {
  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8080;
  const tickHz = opts.tickHz || 30;
  const rng = opts.rng || Math.random;

  const wss = new WebSocketServer({ port, maxPayload: Protocol.MAX_MSG_BYTES });
  const rooms = new Map(); // code -> Room

  // Per-connection state hangs off the socket. `id`/`room` are null until join.
  function attach(ws) {
    ws._peer = {
      id: null,
      room: null,
      inputLimit: new Protocol.RateLimiter(Protocol.INPUT_LIMIT),
      controlLimit: new Protocol.RateLimiter(Protocol.CONTROL_LIMIT),
      alive: true,
    };
  }

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(Protocol.encode(msg));
  }

  // A kick is a courtesy error frame then a close; the close code tells a client
  // library it was policy, not a network fault.
  function kick(ws, reason) {
    send(ws, { t: 'error', reason, fatal: true });
    ws.close(4000, reason);
  }

  function now() {
    // Real wall clock for the loop; injectable for nothing yet, but the room's
    // tick(nowMs) is the seam a deterministic soak test (Phase 5) will drive.
    return Date.now();
  }

  function handleJoin(ws, msg) {
    const peer = ws._peer;
    if (peer.room) return; // already seated; a second join is a no-op, not a reseat

    let room;
    if (msg.code) {
      room = rooms.get(msg.code);
      if (!room) return kick(ws, Protocol.ERR.NO_ROOM);
      if (room.isFull) return kick(ws, Protocol.ERR.ROOM_FULL);
    } else {
      const code = makeCode(rooms, rng);
      // Seed from the code so a room's dungeon is reproducible from its name alone.
      let seed = 0;
      for (let i = 0; i < code.length; i++) seed = (Math.imul(seed, 31) + code.charCodeAt(i)) >>> 0;
      room = new Room({ code, seed });
      rooms.set(code, room);
    }

    const seat = room.join({ name: msg.name, shirt: msg.shirt });
    if (!seat) return kick(ws, Protocol.ERR.ROOM_FULL); // lost a race for the last seat

    peer.id = seat.id;
    peer.room = room;
    ws._room = room; // for the broadcast sweep
    send(ws, { t: 'welcome', v: Protocol.PROTOCOL_VERSION, code: room.code, you: seat.id, tickHz });
  }

  function handleInput(ws, msg) {
    const peer = ws._peer;
    if (!peer.room) return kick(ws, Protocol.ERR.NOT_JOINED);
    peer.room.setInput(peer.id, msg);
  }

  wss.on('connection', (ws) => {
    attach(ws);
    ws.on('pong', () => {
      ws._peer.alive = true;
    });

    ws.on('message', (raw) => {
      const peer = ws._peer;
      const decoded = Protocol.decode(raw);
      if (!decoded.ok) return kick(ws, Protocol.ERR.BAD_MESSAGE);
      const valid = Protocol.validateClient(decoded.msg);
      if (!valid.ok) return kick(ws, Protocol.ERR.BAD_MESSAGE);
      const msg = valid.msg;

      // Two budgets: a fast one for the 30 Hz input stream, a strict one for
      // everything else. Exceeding either is a kick — a client that floods is
      // either broken or hostile, and a room can't carry it.
      const t = now();
      const limited = msg.t === 'input' ? !peer.inputLimit.allow(t) : !peer.controlLimit.allow(t);
      if (limited) return kick(ws, Protocol.ERR.RATE_LIMIT);

      if (msg.t === 'join') handleJoin(ws, msg);
      else if (msg.t === 'input') handleInput(ws, msg);
      else if (msg.t === 'ping') send(ws, { t: 'pong', ts: msg.ts });
    });

    ws.on('close', () => {
      const peer = ws._peer;
      if (peer.room && peer.id) {
        peer.room.leave(peer.id);
        // An empty room is reaped immediately: no lingering sim, no code squatting.
        if (peer.room.isEmpty) rooms.delete(peer.room.code);
      }
      peer.room = null;
    });

    ws.on('error', () => {
      // A socket-level error will be followed by 'close'; nothing to do but not throw.
    });
  });

  // ---- The heartbeat: one interval ticks every room and fans out snapshots. ----
  const stepMs = 1000 / tickHz;
  const loop = setInterval(() => {
    const t = now();
    for (const room of rooms.values()) room.tick(t);
    // Send each connected, joined peer its own AOI-filtered snapshot.
    for (const ws of wss.clients) {
      const peer = ws._peer;
      if (!peer || !peer.room || !peer.id || ws.readyState !== ws.OPEN) continue;
      const snap = peer.room.snapshotFor(peer.id);
      if (snap) ws.send(Protocol.encode(snap));
    }
  }, stepMs);
  if (loop.unref) loop.unref(); // the tick loop must not keep a test process alive

  // ---- Liveness: ping every few seconds, drop peers that stop ponging. ----
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      const peer = ws._peer;
      if (!peer) continue;
      if (!peer.alive) {
        ws.terminate();
        continue;
      }
      peer.alive = false;
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, 10_000);
  if (ping.unref) ping.unref();

  function close() {
    clearInterval(loop);
    clearInterval(ping);
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => wss.close(resolve));
  }

  const api = { wss, rooms, close, tickHz, get port() { return wss.address() ? wss.address().port : port; } };
  return api;
}

module.exports = { createServer };

// Run as a script.
if (require.main === module) {
  const srv = createServer();
  srv.wss.on('listening', () => {
    const addr = srv.wss.address();
    console.log(`Dungeon Browser server listening on ws://0.0.0.0:${addr.port} (${srv.tickHz} Hz)`);
  });
  const shutdown = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
