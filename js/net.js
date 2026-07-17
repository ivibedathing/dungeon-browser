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

  function createNet(opts = {}) {
    const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

    const net = {
      you: null,
      seed: null,
      code: null,
      tickHz: 30,
      status: 'idle', // idle | connecting | open | error | closed
      error: null,
      latencyMs: 0, // artificial one-way delay for LAN-RTT testing; 0 in production

      _now: now,
      _ws: opts.socket || null,
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
          net._ingest(msg);
          break;
        case 'error':
          net.status = 'error';
          net.error = msg.reason || 'error';
          break;
        default:
          break; // pong etc. — nothing to buffer
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
        pressed: [...input.pressed],
        mouse: { x: input.mouse.x, y: input.mouse.y, click: !!input.mouse.click, rclick: !!input.mouse.rclick },
      };
      // Keep a replayable copy (keys + pressed are all reconciliation needs).
      net._unacked.push({ seq: net._seq, input: { keys: { ...wire.keys }, pressed: new Set(wire.pressed) } });
      net._send(wire);
      return net._seq;
    };

    net.ping = function (nowMs) {
      net._send({ t: 'ping', ts: nowMs != null ? nowMs : net._now() });
    };

    net._send = function (obj) {
      const ws = net._ws;
      if (!ws || ws.readyState !== (ws.OPEN != null ? ws.OPEN : 1)) return;
      const text = JSON.stringify(obj);
      if (net.latencyMs > 0 && typeof setTimeout !== 'undefined') {
        setTimeout(() => {
          if (ws.readyState === (ws.OPEN != null ? ws.OPEN : 1)) ws.send(text);
        }, net.latencyMs);
      } else {
        ws.send(text);
      }
    };

    // ---- Interpolation (remote entities) ----

    net.interpolatedAt = function (nowMs) {
      const s = net._snaps;
      const empty = { players: [], monsters: [], projectiles: [], groundItems: [], floor: 1, events: [] };
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
        portals: [], // town portals are a Phase 4 co-op concern; empty keeps the renderer happy
        particles: [],
        floatTexts: [],
        messages: [],
        shake: 0,
        dead: false,
        floor: 0,
        dungeon: null,
        explored: null,
        flow: { field: null, t: 0 },
        cam: null,
        time: 0,
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
      rs.flow.field = Dungeon.flowFieldMulti(grid, [{ x: Math.floor(rs.player.x / TS), y: Math.floor(rs.player.y / TS) }], 30);
      const f = rs.flow.field;
      for (let y = 0; y < rs.dungeon.height; y++) {
        for (let x = 0; x < rs.dungeon.width; x++) {
          if (f[y][x] <= 9) {
            rs.explored[y][x] = true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
              const ny = y + dy;
              const nx = x + dx;
              if (rs.explored[ny] !== undefined && rs.explored[ny][nx] !== undefined) rs.explored[ny][nx] = true;
            }
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

      // Splice the predicted local hero over its interpolated twin: everyone else
      // renders from interpolation (smooth), the local hero from prediction (immediate).
      const others = interp.players.filter((pl) => pl.id !== net.you);
      rs.players = [rs.player, ...others];

      refreshFog(rs);

      // Camera eases toward the local hero, same feel as the solo updateWorld.
      if (!rs.cam) rs.cam = { x: rs.player.x, y: rs.player.y };
      rs.cam.x = U.lerp(rs.cam.x, rs.player.x, 0.2);
      rs.cam.y = U.lerp(rs.cam.y, rs.player.y, 0.2);

      // A local clock for sprite bob/animation and float/particle decay.
      rs.time += 1 / 30;
      rs.shake = Math.max(0, rs.shake - (1 / 30) * 14);
      return rs;
    };

    return net;
  }

  const Net = { create: createNet, INTERP_DELAY };

  if (typeof window !== 'undefined') window.Net = Net;
  if (typeof module !== 'undefined') module.exports = Net;
})();
