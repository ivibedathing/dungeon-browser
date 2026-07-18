// net.js — the client half of multiplayer (Phase 2).
//
// One Net connection owns the socket, the outbound intent stream, and the inbound
// snapshot buffer. It answers two questions the render loop asks every frame:
//   - interpolatedAt(now): where is every remote entity right now? (100 ms behind
//     the newest snapshot, lerped between the two that bracket that moment — smooth
//     motion despite discrete 30 Hz updates)
//   - reconcileLocal(pred, now): where is MY hero right now? (the server's last
//     authoritative position, plus every input still in flight replayed through the
//     same Game.predictMovement the server uses — immediate, and it converges)
//
// The module is transport- and clock-injected so its whole logic core runs under
// node --test with a fake socket and a mutable clock. The browser (main.js) hands
// it a real WebSocket and performance.now.
(function () {
  const U = typeof window !== 'undefined' ? window.U : require('./util.js');
  const Game = typeof window !== 'undefined' ? window.Game : require('./game.js');
  const Entities = typeof window !== 'undefined' ? window.Entities : require('./entities.js');
  const Dungeon = typeof window !== 'undefined' ? window.Dungeon : require('./dungeon.js');
  const TS = Dungeon.TILE_SIZE;

  // The edge actions the server accepts (mirrors server Protocol.EDGES). The client
  // filters its outbound pressed set to these so pure-UI edges (inv, tree, esc,
  // mute) — which live client-side — never reach the server and trip its validator.
  const SEND_EDGES = new Set(['dodge', 'interact', 'drink', 'portal', 'skill0', 'skill1', 'skill2', 'belt0', 'belt1', 'belt2', 'belt3']);

  // Render this far behind the newest snapshot so there are almost always two
  // snapshots bracketing the render time to interpolate between. One tick of slack
  // (33 ms) plus headroom for jitter.
  const INTERP_DELAY = 100;
  // Keep ~1 s of snapshots — far more than interpolation needs, cheap to hold, and
  // enough for a late packet to still find its place.
  const BUFFER_MS = 1000;
  const TICK_DT = 1 / 30;

  function lerpEntity(a, b, f) {
    const out = Object.assign({}, b);
    out.x = U.lerp(a.x, b.x, f);
    out.y = U.lerp(a.y, b.y, f);
    if (typeof a.facing === 'number' && typeof b.facing === 'number') {
      // Shortest-arc: walk from a toward b by the signed smallest difference so a
      // sprite turning past ±π doesn't spin the long way through 0.
      out.facing = a.facing + U.angleDiff(b.facing, a.facing) * f;
    }
    return out;
  }

  // Interpolate one array of entities (matched by id) from snapshot `a` to `b`.
  // Entities present only in `b` just appeared — show them at b. Entities only in
  // `a` are gone in b and simply drop (not carried forward).
  function lerpList(a, b, f) {
    const byId = new Map();
    for (const e of a) byId.set(e.id, e);
    return b.map((e) => {
      const prev = byId.get(e.id);
      return prev ? lerpEntity(prev, e, f) : Object.assign({}, e);
    });
  }

  const TOKEN_KEY = 'dungeon-browser.token.v1';

  function createNet(opts = {}) {
    const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    // Injectable so tests drive token persistence without a real localStorage.
    const storage = opts.storage !== undefined ? opts.storage : typeof localStorage !== 'undefined' ? localStorage : null;

    const net = {
      you: null,
      seed: null,
      code: null,
      tickHz: 30,
      self: null, // the local player's private HUD state, from each snapshot's `self`
      status: 'idle', // idle | connecting | open | error | closed
      error: null,
      latencyMs: 0, // artificial one-way delay for LAN-RTT testing; 0 in production

      // Account state (Phase 3).
      account: null, // { username }
      token: null, // opaque session token, persisted for auto-resume
      characters: null, // [{slot,name,level,updatedAt,imported}]
      selectedSlot: null,
      authStatus: 'anon', // anon | authed | error
      authError: null,
      charError: null,

      onOpen: null, // caller hook fired once the socket is connected
      _storage: storage,
      _now: now,
      _ws: opts.socket || null,
      _outbox: [], // frames queued while the socket is still connecting
      _snaps: [], // buffered snapshots, ascending by receive time _rt
      _seq: 0,
      _unacked: [], // {seq, input} still in flight
      lastAckedSeq: -1,

      get unackedCount() {
        return this._unacked.length;
      },
      get latestTick() {
        return this._snaps.length ? this._snaps[this._snaps.length - 1].tick : -1;
      },
    };

    // ---- Connection ----

    net.connect = function (url, WebSocketImpl) {
      const Impl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
      if (!Impl) {
        net.status = 'error';
        net.error = 'no_websocket'; // e.g. the offline artifact build (CSP blocks sockets)
        return net;
      }
      net.status = 'connecting';
      try {
        net._ws = new Impl(url);
      } catch (e) {
        net.status = 'error';
        net.error = 'connect_failed';
        return net;
      }
      net._ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        net._deliver(msg);
      };
      net._ws.onopen = () => {
        // Flush anything queued before the socket finished connecting (the join
        // almost always lands here), then hand control to the caller.
        const q = net._outbox;
        net._outbox = [];
        for (const text of q) net._rawSend(text);
        if (net.onOpen) net.onOpen();
      };
      net._ws.onclose = () => {
        if (net.status !== 'error') net.status = 'closed';
      };
      net._ws.onerror = () => {
        net.status = 'error';
        net.error = net.error || 'socket_error';
      };
      return net;
    };

    net.join = function (name, shirt, code) {
      net._send({ t: 'join', name, shirt: shirt || undefined, code: code || undefined });
    };

    net.close = function () {
      if (net._ws && net._ws.close) {
        try {
          net._ws.close();
        } catch {
          /* already gone */
        }
      }
    };

    // ---- Account & character senders (Phase 3) ----
    net.register = function (username, password, name, shirt) {
      net.authError = null;
      net._send({ t: 'register', username, password, name: name || username, shirt: shirt || undefined });
    };
    net.login = function (username, password) {
      net.authError = null;
      net._send({ t: 'login', username, password });
    };
    net.resume = function (token) {
      net.authError = null;
      net._send({ t: 'resume', token: token || net.storedToken() });
    };
    net.logout = function () {
      net._persistToken(null);
      net.authStatus = 'anon';
      net.account = null;
      net.characters = null;
      net.selectedSlot = null;
    };
    net.listChars = function () {
      net._send({ t: 'listChars' });
    };
    net.createChar = function (slot, name, shirt, imported) {
      net.charError = null;
      net._send({ t: 'createChar', slot, name, shirt: shirt || undefined, imported: !!imported });
    };
    net.selectChar = function (slot) {
      net.charError = null;
      net._send({ t: 'selectChar', slot });
    };
    net.deleteChar = function (slot) {
      net._send({ t: 'deleteChar', slot });
    };

    // Progression intents (Phase 4.5): the client sends indices/ids only; the server
    // applies against its own tables and the next snapshot corrects any local mis-apply.
    net.lastReject = null;
    net.sendIntent = function (intent, fields) {
      net._send(Object.assign({ t: 'intent', intent }, fields || {}));
    };

    // Receive path with the artificial-latency switch. Real arrivals are delayed by
    // latencyMs so a test / the RTT demo sees the same lag both directions.
    net._deliver = function (msg) {
      if (net.latencyMs > 0 && typeof setTimeout !== 'undefined') {
        setTimeout(() => net.onServerMessage(msg), net.latencyMs);
      } else {
        net.onServerMessage(msg);
      }
    };

    net.onServerMessage = function (msg) {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'welcome':
          net.you = msg.you;
          net.seed = msg.seed >>> 0;
          net.code = msg.code;
          net.tickHz = msg.tickHz || 30;
          net.status = 'open';
          break;
        case 'snapshot':
          if (msg.self) net.self = msg.self; // latest wins; HUD reads the freshest
          net._ingest(msg);
          break;
        case 'reject':
          // The server refused an intent; the next snapshot restores the truth. Stash
          // it so the HUD can explain the item flickering back.
          net.lastReject = { intent: msg.intent, reason: msg.reason };
          break;
        case 'error':
          net.status = 'error';
          net.error = msg.reason || 'error';
          break;
        case 'authed':
          net.authStatus = 'authed';
          net.authError = null;
          net.account = { username: msg.username };
          net.characters = msg.characters || [];
          net.token = msg.token;
          net._persistToken(msg.token);
          break;
        case 'characters':
          net.characters = msg.characters || [];
          break;
        case 'selected':
          net.selectedSlot = msg.slot;
          break;
        case 'authError':
          net.authStatus = 'error';
          net.authError = msg.reason || 'auth_error';
          // A dead session must not keep auto-resuming; forget the bad token.
          if (msg.reason === 'bad_session') net._persistToken(null);
          break;
        case 'charError':
          net.charError = msg.reason || 'char_error';
          break;
        default:
          break; // pong etc. — nothing to buffer
      }
    };

    net._persistToken = function (token) {
      net.token = token || null;
      if (!net._storage) return;
      try {
        if (token) net._storage.setItem(TOKEN_KEY, token);
        else net._storage.removeItem(TOKEN_KEY);
      } catch {
        /* private mode / quota — non-fatal */
      }
    };

    net.storedToken = function () {
      if (!net._storage) return null;
      try {
        return net._storage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    };

    net._ingest = function (msg) {
      // The server ticks monotonically and the transport is ordered (TCP), so a
      // snapshot no newer than the newest we hold is stale — drop it rather than
      // let it masquerade as current for reconciliation or interpolation.
      if (net._snaps.length && msg.tick <= net.latestTick) return;

      msg._rt = net._now();
      net._snaps.push(msg);
      // Prune anything older than the buffer window (keep at least two to bracket).
      const cutoff = msg._rt - BUFFER_MS;
      const s = net._snaps;
      while (s.length > 2 && s[0]._rt < cutoff) s.shift();

      // Advance the ack monotonically and drop in-flight inputs the server has seen.
      if (typeof msg.ack === 'number' && msg.ack > net.lastAckedSeq) {
        net.lastAckedSeq = msg.ack;
        net._unacked = net._unacked.filter((u) => u.seq > net.lastAckedSeq);
      }
    };

    // ---- Outbound intents ----

    net.sendInput = function (input, nowMs) {
      net._seq += 1;
      const wire = {
        t: 'input',
        seq: net._seq,
        keys: {
          w: !!input.keys.w,
          a: !!input.keys.a,
          s: !!input.keys.s,
          d: !!input.keys.d,
          space: !!input.keys.space,
        },
        pressed: [...input.pressed].filter((a) => SEND_EDGES.has(a)),
        mouse: { x: input.mouse.x, y: input.mouse.y, click: !!input.mouse.click, rclick: !!input.mouse.rclick },
      };
      // Mouse-look aim rides along when present so the server faces the hero at the
      // cursor; omitted (not null) when the pointer hasn't moved, so an older/idle
      // client simply reads as "no aim" on the wire.
      if (typeof input.aim === 'number' && Number.isFinite(input.aim)) wire.aim = input.aim;
      // Keep a replayable copy — keys, pressed, and aim are all reconciliation needs
      // (aim so the predicted hero turns to the cursor immediately, not a round-trip later).
      net._unacked.push({ seq: net._seq, input: { keys: { ...wire.keys }, pressed: new Set(wire.pressed), aim: wire.aim } });
      net._send(wire);
      return net._seq;
    };

    net.ping = function (nowMs) {
      net._send({ t: 'ping', ts: nowMs != null ? nowMs : net._now() });
    };

    net._send = function (obj) {
      const ws = net._ws;
      if (!ws) return;
      const text = JSON.stringify(obj);
      const OPEN = ws.OPEN != null ? ws.OPEN : 1;
      const CONNECTING = ws.CONNECTING != null ? ws.CONNECTING : 0;
      if (ws.readyState === CONNECTING) {
        net._outbox.push(text); // queued; onopen flushes it
        return;
      }
      if (ws.readyState !== OPEN) return;
      net._rawSend(text);
    };

    net._rawSend = function (text) {
      const ws = net._ws;
      const OPEN = ws.OPEN != null ? ws.OPEN : 1;
      if (net.latencyMs > 0 && typeof setTimeout !== 'undefined') {
        setTimeout(() => {
          if (ws && ws.readyState === OPEN) ws.send(text);
        }, net.latencyMs);
      } else {
        ws.send(text);
      }
    };

    // ---- Interpolation (remote entities) ----

    net.interpolatedAt = function (nowMs) {
      const s = net._snaps;
      const empty = { players: [], monsters: [], projectiles: [], groundItems: [], props: [], floor: 1, events: [] };
      if (!s.length) return empty;

      const target = nowMs - INTERP_DELAY;
      const newest = s[s.length - 1];

      // Not enough history, or the buffer has starved: hold the nearest snapshot
      // rather than extrapolate into a guess.
      if (s.length === 1 || target <= s[0]._rt) return project(s[0]);
      if (target >= newest._rt) return project(newest);

      // Find the pair [a,b] bracketing the render time.
      let a = s[0];
      let b = s[1];
      for (let i = 1; i < s.length; i++) {
        if (s[i]._rt >= target) {
          a = s[i - 1];
          b = s[i];
          break;
        }
      }
      const span = b._rt - a._rt;
      const f = span > 0 ? U.clamp((target - a._rt) / span, 0, 1) : 0;
      return {
        floor: b.floor,
        players: lerpList(a.players, b.players, f),
        monsters: lerpList(a.monsters, b.monsters, f),
        projectiles: lerpList(a.projectiles, b.projectiles, f),
        groundItems: b.groundItems.map((g) => Object.assign({}, g)), // items don't move; no lerp
        props: (b.props || []).map((pr) => Object.assign({}, pr)), // static; no lerp
        events: [],
      };
    };

    function project(snapshot) {
      return {
        floor: snapshot.floor,
        players: snapshot.players.map((e) => Object.assign({}, e)),
        monsters: snapshot.monsters.map((e) => Object.assign({}, e)),
        projectiles: snapshot.projectiles.map((e) => Object.assign({}, e)),
        groundItems: snapshot.groundItems.map((e) => Object.assign({}, e)),
        props: (snapshot.props || []).map((e) => Object.assign({}, e)),
        events: [],
      };
    }

    // ---- Reconciliation (local hero) ----

    // Rebase the predicted hero on the server's latest authoritative position, then
    // replay every input the server hasn't acked yet — through the exact movement
    // code the server runs — so the local player is both authoritative and immediate.
    net.reconcileLocal = function (predState, nowMs) {
      const newest = net._snaps[net._snaps.length - 1];
      if (!newest) return;
      const base = newest.players.find((pl) => pl.id === net.you);
      if (!base) return;

      // Replaying inputs needs the floor grid for collision; ensure it here so
      // reconcile works on the very first frame, before buildRenderState has run.
      ensureFloor(predState, newest.floor);

      const p = predState.player;
      p.x = base.x;
      p.y = base.y;
      if (typeof base.facing === 'number') p.facing = base.facing;
      if (typeof base.hp === 'number') p.hp = base.hp;
      p.dodgeT = base.dodgeT || 0;
      p.dodgeCdT = base.dodgeCdT || 0;

      const grid = predState.dungeon.grid;
      const stats = Entities.effectiveStats(p);
      for (const u of net._unacked) {
        Game.predictMovement(grid, p, u.input, TICK_DT, stats);
      }
    };

    net.newestSnapshot = function () {
      return net._snaps.length ? net._snaps[net._snaps.length - 1] : null;
    };

    // ---- Juice (events) ----

    // Return every event from snapshots newer than the last drain, once. The caller
    // feeds these to Game.applyEvents so blood, damage numbers, and sounds fire on
    // the client exactly as they do in solo — the sim was made event-driven in
    // Phase 0 precisely so they could cross the wire.
    net._lastEventTick = -1;
    net.takeEvents = function () {
      const out = [];
      for (const s of net._snaps) {
        if (s.tick > net._lastEventTick && s.events && s.events.length) out.push(...s.events);
      }
      net._lastEventTick = net.latestTick;
      return out;
    };

    // ---- Render-state assembly ----

    // The persistent client-side render state: a sim-shaped object the renderer and
    // HUD read, holding a predicted local hero and the juice arrays. Created once on
    // entering online play; buildRenderState refreshes its moving contents each frame.
    net.freshRenderState = function (opts) {
      const player = Entities.newPlayer(opts);
      player.id = net.you || 'p0';
      player.dead = false;
      // Safe defaults until the first reconcile drops the hero at the server spawn;
      // 0,0 is a border wall, so the fog field just finds nothing rather than NaN.
      player.x = 0;
      player.y = 0;
      player.facing = 0;
      player.attackT = 0;
      player.swing = null;
      player.hurtT = 0;
      player.healPool = 0;
      player.healRate = 0;
      player.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
      player.dodgeT = 0;
      player.dodgeCdT = 0;
      player.dodgeDir = { x: 1, y: 0 };
      return {
        online: true,
        player,
        players: [player],
        monsters: [],
        projectiles: [],
        groundItems: [],
        props: [], // server-authoritative breakables, refreshed from each snapshot
        portals: [], // town portals are a Phase 4 co-op concern; empty keeps the renderer happy
        particles: [],
        floatTexts: [],
        messages: [],
        // Bag is shared run state in Phase 2; only gold and belt slots feed the HUD.
        bag: { gold: 0, belt: [null, null, null, null], slots: [], potions: { health: [], mana: [] } },
        kills: 0,
        shake: 0,
        dead: false,
        deathT: 0,
        floor: 0,
        dungeon: null,
        explored: null,
        flow: { field: null, t: 0 },
        cam: null,
        time: 0,
        // UI flags the HUD/draw path reads. Online has no menus, town, or boss lock
        // yet (Phase 4), so these stay at their neutral values — present so UI.draw
        // never dereferences an undefined field or iterates a missing array.
        invOpen: false,
        treeOpen: false,
        boardOpen: false,
        statsOpen: false,
        trading: false,
        smithing: false,
        questing: false,
        inTown: false,
        bossFight: false,
        portalCdT: 0,
        fade: null,
        hover: null,
        shop: null,
        stash: null,
        buyback: [],
        quests: [],
        milestones: [],
      };
    };

    function ensureFloor(rs, floor) {
      if (rs.dungeon && rs.floor === floor) return;
      rs.floor = floor;
      rs.dungeon = Dungeon.generateDungeon(net.seed, floor);
      rs.explored = Array.from({ length: rs.dungeon.height }, () => new Array(rs.dungeon.width).fill(false));
      rs.flow = { field: null, t: 0 };
    }

    // Recompute the fog field from the local hero only (single-source): the veil,
    // vignette, and R.isVisible all read rs.flow.field, and co-op fog is "what I can
    // see", so one source is correct here.
    function refreshFog(rs) {
      const grid = rs.dungeon.grid;
      const sources = [{ x: Math.floor(rs.player.x / TS), y: Math.floor(rs.player.y / TS) }];
      const MAX = 30;
      const rect = Dungeon.flowWindowRect(grid, sources, MAX);
      rs.flow.field = Dungeon.flowFieldWindow(grid, sources, MAX, rect);
      const f = rs.flow.field;
      const sight = (rs.dungeon.sightTiles || 9) + 0;
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          if (Dungeon.flowAt(f, x, y) > sight) continue;
          rs.explored[y][x] = true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const ny = y + dy;
            const nx = x + dx;
            if (rs.explored[ny] !== undefined && rs.explored[ny][nx] !== undefined) rs.explored[ny][nx] = true;
          }
        }
      }
    }

    net.buildRenderState = function (rs, nowMs) {
      const interp = net.interpolatedAt(nowMs);
      ensureFloor(rs, interp.floor);

      rs.monsters = interp.monsters;
      rs.projectiles = interp.projectiles;
      rs.groundItems = interp.groundItems;
      rs.props = interp.props;

      // Fold the server's authoritative private state into the local hero + HUD.
      // (Position/hp came from reconcileLocal; these are the fields not in the
      // entity lists.) maxHP/maxMana aren't sent — effectiveStats already matches.
      if (net.self) {
        rs.player.mana = net.self.mana;
        rs.player.healPool = net.self.healPool;
        rs.player.xp = net.self.xp;
        rs.player.level = net.self.level;
        if (net.self.skillCd) rs.player.skillCd = net.self.skillCd;
        rs.bag.gold = net.self.gold;
        rs.kills = net.self.kills;
        // The main quest drives the HUD entry and the act banner. It was the
        // last thing still hardcoded empty online — the server persisted it all
        // along, but never sent it and the client never read it.
        if (net.self.mainQuest) rs.player.mainQuest = Quests.mainFromSave(net.self.mainQuest);
        // Same story for the run tally sheet: the server owns it (the online client
        // never runs the sim that bumps it), so mirror the authoritative copy in so
        // the stats panel reads real numbers instead of the zeroed local sheet.
        if (net.self.stats) rs.player.stats = Stats.sanitize(net.self.stats);
      }

      // Splice the predicted local hero over its interpolated twin: everyone else
      // renders from interpolation (smooth), the local hero from prediction (immediate).
      const others = interp.players.filter((pl) => pl.id !== net.you);
      rs.players = [rs.player, ...others];

      refreshFog(rs);

      // Camera eases toward the local hero, same feel as the solo updateWorld.
      if (!rs.cam) rs.cam = { x: rs.player.x, y: rs.player.y };
      rs.cam.x = U.lerp(rs.cam.x, rs.player.x, 0.2);
      rs.cam.y = U.lerp(rs.cam.y, rs.player.y, 0.2);

      // A local clock for sprite bob/animation, and decay of the juice arrays that
      // Game.applyEvents fills — solo does this inside Game.update, but online no
      // world sim runs, so without it floaties and blood would accumulate forever.
      const dt = 1 / 30;
      rs.time += dt;
      rs.shake = Math.max(0, rs.shake - dt * 14);
      for (const ft of rs.floatTexts) ft.t += dt;
      rs.floatTexts = rs.floatTexts.filter((ft) => ft.t < 0.9);
      for (const pt of rs.particles) {
        pt.t += dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 1 - 3 * dt;
        pt.vy *= 1 - 3 * dt;
      }
      rs.particles = rs.particles.filter((pt) => pt.t < pt.life);
      for (const msg of rs.messages) msg.t += dt;
      rs.messages = rs.messages.filter((msg) => msg.t < 7);
      return rs;
    };

    return net;
  }

  const Net = { create: createNet, INTERP_DELAY };

  if (typeof window !== 'undefined') window.Net = Net;
  if (typeof module !== 'undefined') module.exports = Net;
})();
