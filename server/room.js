// server/room.js — one dungeon run, shared by up to four players.
//
// The room owns a sim state and is the only thing allowed to mutate it. Sockets
// never reach the sim: server.js validates a frame, hands the room a plain
// message, and the room decides what the next tick sees. Everything the room
// sends back out is a projection built here — never a live sim object — so a
// client can't be handed a reference to server-side AI state.
'use strict';

const { Game } = require('./sim.js');
const Protocol = require('./protocol.js');

const TS = 32; // Dungeon.TILE_SIZE — the sim's world units per tile.

// Runtime fields Game.newRun stamps onto its player beyond Entities.newPlayer's
// base stats. Joiners need the identical shape or the first tick reads
// undefined timers. Kept here rather than exported from the sim because Phase 3
// replaces this whole function with "load the character from the store".
function freshPlayer(id, opts) {
  const p = Entities.newPlayer(opts);
  p.id = id;
  p.dead = false;
  p.facing = 0;
  p.attackT = 0;
  p.swing = null;
  p.hurtT = 0;
  p.healPool = 0;
  p.healRate = 0;
  p.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
  p.dodgeT = 0;
  p.dodgeCdT = 0;
  p.dodgeDir = { x: 1, y: 0 };
  return p;
}

// A buffered input starts as "standing still": a player who has joined but not
// yet sent a packet must not read as undefined to the sim.
function idleInput() {
  const keys = {};
  for (const k of Protocol.KEYS) keys[k] = false;
  return { keys, pressed: new Set(), mouse: { x: -1, y: -1, click: false, rclick: false }, seq: -1 };
}

class Room {
  constructor({ code, seed }) {
    this.code = code;
    this.seed = seed >>> 0;
    this.state = Game.newRun(this.seed);
    // newRun always builds a solo hero; the room's seats are filled by join().
    // Dropping it here keeps one code path for every player, host included.
    this.state.players = [];
    this.inputs = new Map(); // playerId -> buffered input (held keys + accumulated edges)
    this.tick_ = 0;
    this.lastMs = null;
    this.seat = 0; // monotonic: a leaver's id is never handed to the next joiner
    this.events = []; // this tick's drained sim events, awaiting per-player filtering
  }

  get playerCount() {
    return this.state.players.length;
  }

  get isFull() {
    return this.playerCount >= Room.MAX_PLAYERS;
  }

  get isEmpty() {
    return this.playerCount === 0;
  }

  // Returns {id, player}, or null when the room is full — a full room is an
  // ordinary outcome the server reports, not an exception.
  join(opts) {
    if (this.isFull) return null;
    const id = `p${this.seat++}`;
    const p = freshPlayer(id, opts);
    const entry = this.state.dungeon.entry;
    // Fan joiners around the entry tile so two players never occupy one point.
    const a = (this.playerCount / Room.MAX_PLAYERS) * Math.PI * 2;
    const spread = this.playerCount === 0 ? 0 : 14;
    p.x = (entry.x + 0.5) * TS + Math.cos(a) * spread;
    p.y = (entry.y + 0.5) * TS + Math.sin(a) * spread;
    this.state.players.push(p);
    this.syncLocalAlias();
    this.inputs.set(id, idleInput());
    return { id, player: p };
  }

  leave(id) {
    const i = this.state.players.findIndex((p) => p.id === id);
    if (i === -1) return false;
    this.state.players.splice(i, 1);
    this.inputs.delete(id);
    this.syncLocalAlias();
    return true;
  }

  // The sim still has a notion of "the local player" (players[0]): the camera
  // follows it and the town vendor/smith/board only answer to it. Until Phase 2
  // moves those concerns client-side, players[0] must always be a player who is
  // actually here — otherwise a host leaving would leave the sim steering a ghost.
  syncLocalAlias() {
    if (this.state.players.length) this.state.player = this.state.players[0];
  }

  // Buffer one validated input. Returns false for stale/duplicate packets — UDP-ish
  // reordering is normal over a real network and must never rewind a player.
  setInput(id, msg) {
    const buf = this.inputs.get(id);
    if (!buf) return false;
    if (msg.seq <= buf.seq) return false;
    buf.seq = msg.seq;
    buf.keys = { ...msg.keys };
    buf.mouse = { ...msg.mouse };
    // Edges accumulate: several packets can land between two ticks and every
    // press must survive to be consumed exactly once.
    for (const a of msg.pressed) buf.pressed.add(a);
    return true;
  }

  ack(id) {
    const buf = this.inputs.get(id);
    return buf ? buf.seq : -1;
  }

  // Advance the sim to `nowMs`. Returns how many 30 Hz steps actually ran.
  tick(nowMs) {
    if (this.lastMs === null) {
      this.lastMs = nowMs;
      return 0;
    }
    const elapsed = Math.max(0, nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    // An empty room burns no CPU and, more importantly, never enters Game.update
    // with an empty players[] — the sim indexes players[0] unconditionally.
    if (this.isEmpty) return 0;

    const inputs = {};
    for (const [id, buf] of this.inputs) inputs[id] = buf;

    const before = this.tick_;
    const t0 = this.state.time;
    this.state = Game.stepFixed(this.state, inputs, elapsed);
    this.syncLocalAlias();
    const ran = Math.round((this.state.time - t0) / Game.TICK);
    this.tick_ += ran;

    // Edges are one-shot: whatever the steps above saw is now spent. Held keys
    // stay until the client says otherwise.
    if (ran > 0) for (const buf of this.inputs.values()) buf.pressed.clear();

    this.events = Game.drainEvents(this.state);
    return this.tick_ - before;
  }

  // ---- Outbound projections ----

  inAOI(p, x, y) {
    const dx = x - p.x;
    const dy = y - p.y;
    return dx * dx + dy * dy <= Room.AOI_RADIUS * Room.AOI_RADIUS;
  }

  // Events with a position only go to players who could see them; placeless ones
  // (messages, sfx) are broadcast. Cheap, and it keeps a fight across the floor
  // from spraying juice into everyone's client.
  eventsFor(p) {
    return this.events.filter((e) => (typeof e.x === 'number' && typeof e.y === 'number' ? this.inAOI(p, e.x, e.y) : true));
  }

  snapshotFor(id) {
    const me = this.state.players.find((pl) => pl.id === id);
    if (!me) return null;
    const s = this.state;
    const myStats = Entities.effectiveStats(me);
    return {
      t: 'snapshot',
      tick: this.tick_,
      you: id,
      ack: this.ack(id),
      floor: s.floor,
      // The requesting player's own private state — the fields the HUD reads that
      // aren't in the shared entity lists and that the client can't derive (its
      // predicted maxHP/maxMana already match, since its render hero is a starter
      // like the server's). Bag gold and kills are shared run state in Phase 2;
      // per-player loot is Phase 4.
      self: {
        mana: round2(me.mana || 0),
        maxMana: Math.round(myStats.maxMana),
        healPool: round2(me.healPool || 0),
        xp: me.xp,
        level: me.level,
        skillCd: { whirlwind: round3(me.skillCd.whirlwind), nova: round3(me.skillCd.nova), prayer: round3(me.skillCd.prayer) },
        gold: s.bag.gold,
        kills: s.kills,
      },
      // Party members are never AOI-culled: the HUD and (Phase 4) the minimap
      // need every ally every tick, and there are at most three of them. The swing
      // carries exactly the fields R.drawPlayer reads to sweep an arc.
      players: s.players.map((pl) => ({
        id: pl.id,
        name: pl.name,
        shirt: pl.shirt,
        x: round2(pl.x),
        y: round2(pl.y),
        facing: round3(pl.facing),
        hp: Math.round(pl.hp),
        maxHP: Math.round(Entities.effectiveStats(pl).maxHP),
        level: pl.level,
        dead: !!pl.dead,
        swing: pl.swing
          ? { t: round3(pl.swing.t), dur: round3(pl.swing.dur), facing: round3(pl.swing.facing), radius: pl.swing.radius, arc: round3(pl.swing.arc), ranged: !!pl.swing.ranged }
          : null,
        dodgeT: round3(pl.dodgeT),
        hurtT: round3(pl.hurtT),
      })),
      monsters: s.monsters
        .filter((m) => this.inAOI(me, m.x, m.y))
        .map((m) => ({
          id: m.id,
          type: m.type,
          name: m.name,
          x: round2(m.x),
          y: round2(m.y),
          hp: Math.round(m.hp),
          maxHP: Math.round(m.maxHP),
          r: m.r,
          facing: round3(m.facing || 0),
          hitT: round3(m.hitT),
          champion: !!m.champion,
          boss: !!m.boss,
        })),
      projectiles: s.projectiles
        .filter((pr) => this.inAOI(me, pr.x, pr.y))
        .map((pr) => ({ id: pr.id, x: round2(pr.x), y: round2(pr.y), kind: pr.kind, angle: round3(pr.angle || 0) })),
      groundItems: s.groundItems
        .filter((g) => this.inAOI(me, g.x, g.y))
        .map((g) => ({ id: g.id, kind: g.kind, x: round2(g.x), y: round2(g.y), amount: g.amount, item: g.item || null })),
      events: this.eventsFor(me),
    };
  }
}

// Four seats: the party size Phase 4's scaling rules are written against.
Room.MAX_PLAYERS = 4;
// Generous enough to cover a 1080p viewport corner-to-corner with margin, so an
// entity is on the wire well before it could be drawn.
Room.AOI_RADIUS = 900;

// Positions ride the wire 30 times a second; sub-pixel precision is noise. This
// is the cheap half of bandwidth control (the other half is the AOI filter).
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { Room };
