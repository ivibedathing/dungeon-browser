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
const Character = require('./character.js');
const { createStore } = require('./store.js');

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

  // Persistence: an injected store (tests), else one built from DATABASE_URL — real
  // Postgres when set, otherwise an in-memory store (dev; non-persistent).
  const store = opts.store || createStore({ databaseUrl: opts.databaseUrl || process.env.DATABASE_URL });
  const ready = Promise.resolve(store.init ? store.init() : undefined);
  const onError = opts.onError || ((err) => console.error('[server]', err && err.message ? err.message : err));

  const wss = new WebSocketServer({ port, maxPayload: Protocol.MAX_MSG_BYTES });
  const rooms = new Map(); // code -> Room

  // Per-connection state hangs off the socket. Auth fields are null until a
  // successful register/login/resume; id/room are null until join.
  function attach(ws) {
    ws._peer = {
      id: null,
      room: null,
      accountId: null, // set once authenticated
      token: null,
      selectedSlot: null, // the character chosen for the next join
      selectedBlob: null,
      isHost: false, // owns the room's shared bag (Phase 3)
      inputLimit: new Protocol.RateLimiter(Protocol.INPUT_LIMIT),
      controlLimit: new Protocol.RateLimiter(Protocol.CONTROL_LIMIT),
      authLimit: new Protocol.RateLimiter(Protocol.AUTH_LIMIT),
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

  // ---- Auth & characters (async; awaited off the message handler) ----

  async function afterAuth(ws, peer, account) {
    peer.accountId = account.id;
    const session = await store.createSession(account.id);
    peer.token = session.token;
    const characters = await store.listCharacters(account.id);
    send(ws, { t: 'authed', token: session.token, username: account.username, characters });
  }

  async function handleRegister(ws, msg) {
    const peer = ws._peer;
    let account;
    try {
      account = await store.createAccount(msg.username, msg.password);
    } catch (e) {
      if (e && e.message === 'TAKEN') return send(ws, { t: 'authError', reason: 'taken' });
      throw e;
    }
    await afterAuth(ws, peer, account);
  }

  async function handleLogin(ws, msg) {
    const account = await store.verifyLogin(msg.username, msg.password);
    // One message for both unknown-user and wrong-password: don't leak which.
    if (!account) return send(ws, { t: 'authError', reason: 'bad_credentials' });
    await afterAuth(ws, ws._peer, account);
  }

  async function handleResume(ws, msg) {
    const account = await store.resolveSession(msg.token);
    if (!account) return send(ws, { t: 'authError', reason: 'bad_session' });
    ws._peer.accountId = account.id;
    ws._peer.token = msg.token;
    const characters = await store.listCharacters(account.id);
    send(ws, { t: 'authed', token: msg.token, username: account.username, characters });
  }

  async function sendCharacters(ws) {
    const characters = await store.listCharacters(ws._peer.accountId);
    send(ws, { t: 'characters', characters });
  }

  async function handleCreateChar(ws, msg) {
    const peer = ws._peer;
    if (!peer.accountId) return kick(ws, Protocol.ERR.NOT_AUTHED);
    const blob = Character.starterBlob(msg.name, msg.shirt);
    if (msg.imported) blob.imported = true;
    try {
      await store.createCharacter(peer.accountId, msg.slot, blob);
    } catch (e) {
      const reason = e && (e.message === 'SLOT_TAKEN' || e.message === 'TOO_MANY') ? e.message.toLowerCase() : 'char_error';
      return send(ws, { t: 'charError', reason });
    }
    await sendCharacters(ws);
  }

  async function handleDeleteChar(ws, msg) {
    const peer = ws._peer;
    if (!peer.accountId) return kick(ws, Protocol.ERR.NOT_AUTHED);
    await store.deleteCharacter(peer.accountId, msg.slot);
    if (peer.selectedSlot === msg.slot) {
      peer.selectedSlot = null;
      peer.selectedBlob = null;
    }
    await sendCharacters(ws);
  }

  async function handleSelectChar(ws, msg) {
    const peer = ws._peer;
    if (!peer.accountId) return kick(ws, Protocol.ERR.NOT_AUTHED);
    const blob = await store.loadCharacter(peer.accountId, msg.slot);
    if (!blob) return send(ws, { t: 'charError', reason: 'no_char' });
    peer.selectedSlot = msg.slot;
    peer.selectedBlob = blob;
    send(ws, { t: 'selected', slot: msg.slot });
  }

  function handleJoin(ws, msg) {
    const peer = ws._peer;
    if (peer.room) return; // already seated; a second join is a no-op, not a reseat
    // Two ways to play: authenticated (a chosen character loads and is saved) or as
    // a guest (a fresh starter, no persistence — the Phase 1/2 behavior). A logged-in
    // client that hasn't picked a character yet is told to, rather than silently guested.
    if (peer.accountId && !peer.selectedBlob) return send(ws, { t: 'charError', reason: 'no_selection' });

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
      room.onSave = onSaveHandler(room);
      rooms.set(code, room);
    }

    const seat = room.join({ character: peer.selectedBlob || undefined, name: msg.name, shirt: msg.shirt });
    if (!seat) return kick(ws, Protocol.ERR.ROOM_FULL); // lost a race for the last seat

    peer.id = seat.id;
    peer.room = room;
    peer.isHost = seat.isHost;
    // Per-player bag (Phase 4): the seat's p.bag is seeded from the loaded blob in
    // Room.join, and saveForPlayer persists that live bag — no host/frozen split.
    ws._room = room; // for the broadcast sweep
    // `seed` lets the client regenerate each floor's grid deterministically
    // (Dungeon.generateDungeon(seed, floor)) instead of us re-sending the map
    // every tick — snapshots carry only the moving contents plus `floor`.
    send(ws, { t: 'welcome', v: Protocol.PROTOCOL_VERSION, code: room.code, seed: room.seed, you: seat.id, slot: peer.selectedSlot, tickHz });
  }

  function handleInput(ws, msg) {
    const peer = ws._peer;
    if (!peer.room) return kick(ws, Protocol.ERR.NOT_JOINED);
    peer.room.setInput(peer.id, msg);
  }

  // ---- Save triggers (fire-and-forget; never awaited on the tick path) ----

  function peerFor(room, playerId) {
    for (const ws of wss.clients) {
      const p = ws._peer;
      if (p && p.room === room && p.id === playerId) return { ws, peer: p };
    }
    return null;
  }

  // Persist one player's character on a roguelite trigger. Guests (no account) are
  // skipped. Death wipes the run: the slot survives, its blob resets to a starter —
  // the server-side equivalent of solo's Save.clear() on death.
  function saveForPlayer(room, playerId, reason) {
    const found = peerFor(room, playerId);
    if (!found) return;
    const { peer } = found;
    if (!peer.accountId || peer.selectedSlot == null) return; // guest — nothing to persist
    const player = room.state.players.find((p) => p.id === playerId);
    if (!player) return;

    let blob;
    if (reason === 'death') {
      blob = Character.starterBlob(player.name, player.shirt);
    } else {
      // Per-player bag (Phase 4): each seat persists its OWN live bag, so co-op loot is
      // instanced end-to-end and a teammate can never overwrite another's stored loot.
      blob = Character.characterBlob(room.state, player, player.bag);
    }
    store.saveCharacter(peer.accountId, peer.selectedSlot, blob).catch(onError);
  }

  const onSaveHandler = (room) => (playerId, reason) => saveForPlayer(room, playerId, reason);

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

      // Three budgets: a fast one for the 30 Hz input stream, a strict one for
      // control messages, and the strictest for auth attempts (each costs a scrypt).
      // Exceeding any is a kick — a flooding client is broken or hostile.
      const t = now();
      let ok;
      if (msg.t === 'input') ok = peer.inputLimit.allow(t);
      else if (Protocol.AUTH_TYPES.has(msg.t)) ok = peer.authLimit.allow(t) && peer.controlLimit.allow(t);
      else ok = peer.controlLimit.allow(t);
      if (!ok) return kick(ws, Protocol.ERR.RATE_LIMIT);

      // Sync gameplay messages stay sync; auth/character messages are async and
      // funnel through one catch so a store error kicks rather than crashes the room.
      if (msg.t === 'input') return handleInput(ws, msg);
      if (msg.t === 'join') return handleJoin(ws, msg);
      if (msg.t === 'ping') return send(ws, { t: 'pong', ts: msg.ts });

      const async =
        msg.t === 'register' ? handleRegister
        : msg.t === 'login' ? handleLogin
        : msg.t === 'resume' ? handleResume
        : msg.t === 'listChars' ? (w) => sendCharacters(w)
        : msg.t === 'createChar' ? handleCreateChar
        : msg.t === 'selectChar' ? handleSelectChar
        : msg.t === 'deleteChar' ? handleDeleteChar
        : null;
      if (!async) return;
      if ((msg.t === 'listChars') && !peer.accountId) return kick(ws, Protocol.ERR.NOT_AUTHED);
      Promise.resolve(async(ws, msg)).catch((err) => {
        // Never leak internals; the store failing is our fault, not the client's.
        try {
          send(ws, { t: 'authError', reason: 'server_error' });
        } catch {}
        if (onError) onError(err);
      });
    });

    ws.on('close', () => {
      const peer = ws._peer;
      if (peer.room && peer.id) {
        // Flush the leaving player's progress before removing them (a live player
        // who isn't dead — a dead one already had its run wiped on death).
        const player = peer.room.state.players.find((p) => p.id === peer.id);
        if (player && !player.dead) saveForPlayer(peer.room, peer.id, 'leave');
        peer.room.leave(peer.id);
        // An empty room is reaped immediately: no lingering sim, no code squatting.
        if (peer.room.isEmpty) rooms.delete(peer.room.code);
      }
      // The session token deliberately survives a disconnect so the client can
      // auto-resume; it expires only by TTL or explicit logout.
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

  async function close() {
    clearInterval(loop);
    clearInterval(ping);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (store.close) await store.close();
  }

  const api = { wss, rooms, store, ready, close, tickHz, get port() { return wss.address() ? wss.address().port : port; } };
  return api;
}

module.exports = { createServer };

// Run as a script.
if (require.main === module) {
  const srv = createServer();
  const persistent = !!(process.env.DATABASE_URL);
  srv.wss.on('listening', () => {
    const addr = srv.wss.address();
    console.log(`Dungeon Browser server listening on ws://0.0.0.0:${addr.port} (${srv.tickHz} Hz)`);
    console.log(persistent ? '[store] Postgres persistence enabled (DATABASE_URL)' : '[store] in-memory store — accounts and characters are NOT persisted (set DATABASE_URL for Postgres)');
  });
  const shutdown = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
