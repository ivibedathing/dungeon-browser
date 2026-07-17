// game/core.js — Game namespace, tuning constants, sim events, and collision.
// Anchor of the js/game/ modules: creates window.Game / module.exports and the
// internal context (Game._) the other game/ parts share. Load this first.
(function () {
  const Balance = typeof window !== 'undefined' ? window.Balance : require('../balance.js');

  const TS = Dungeon.TILE_SIZE;
  const PLAYER_R = 11;
  const ARC_WIDTH = (170 * Math.PI) / 180;

  const Game = {};
  // Internal context shared by the js/game/ parts. Not public API — tests and
  // the browser shell use only the Game.* surface.
  const G = (Game._ = {});

  G.TS = TS;
  G.PLAYER_R = PLAYER_R;
  G.ARC_WIDTH = ARC_WIDTH;
  G.MOVE_SPEED = Balance.player.moveSpeed;
  G.PICKUP_RANGE = 48;
  G.GOLD_MAGNET = 26;
  G.DROPS = Balance.drops;

  Game.PLAYER_R = PLAYER_R;
  Game.ARC_WIDTH = ARC_WIDTH;

  // ---- Sim events ----
  // The sim never touches presentation arrays directly: it emits events, and the
  // presentation side (local play today, network clients in Phase 2) applies them.

  function message(state, text, color) {
    state.events.push({ type: 'message', text, color: color || '#d8cfc0' });
  }
  Game.message = message;
  G.message = message;

  function sfx(state, name) {
    state.events.push({ type: 'sfx', name });
  }
  Game.sfx = sfx;
  G.sfx = sfx;

  function floatText(state, x, y, text, color, size) {
    state.events.push({ type: 'float', x, y, text, color, size: size || 14 });
  }
  G.floatText = floatText;

  function burst(state, x, y, color, n, speed) {
    state.events.push({ type: 'burst', x, y, color, n, speed: speed || 90 });
  }
  Game.burst = burst;
  G.burst = burst;

  Game.drainEvents = function (state) {
    const events = state.events;
    state.events = [];
    return events;
  };

  Game.applyEvents = function (state, events) {
    for (const e of events) {
      if (e.type === 'float') {
        state.floatTexts.push({ x: e.x, y: e.y, text: e.text, color: e.color, size: e.size, t: 0 });
      } else if (e.type === 'burst') {
        for (let i = 0; i < e.n; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = (0.3 + Math.random() * 0.7) * e.speed;
          state.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            t: 0,
            life: 0.35 + Math.random() * 0.4,
            color: e.color,
            size: 1.5 + Math.random() * 2.5,
          });
        }
      } else if (e.type === 'message') {
        state.messages.push({ text: e.text, t: 0, color: e.color });
        if (state.messages.length > 5) state.messages.shift();
      } else if (e.type === 'sfx' && typeof Sfx !== 'undefined') {
        Sfx.play(e.name);
      }
    }
  };

  // Optional-module helper: Save exists in the browser but not in bare node tests.
  G.save = function save(state) {
    if (typeof Save !== 'undefined') Save.write(state);
  };

  // ---- Collision ----

  function collides(grid, x, y, r) {
    const minX = Math.floor((x - r) / TS);
    const maxX = Math.floor((x + r) / TS);
    const minY = Math.floor((y - r) / TS);
    const maxY = Math.floor((y + r) / TS);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (ty < 0 || tx < 0 || ty >= grid.length || tx >= grid[0].length) return true;
        if (Dungeon.isWalkable(grid[ty][tx])) continue;
        const nx = U.clamp(x, tx * TS, tx * TS + TS);
        const ny = U.clamp(y, ty * TS, ty * TS + TS);
        if (U.dist2(x, y, nx, ny) < r * r) return true;
      }
    }
    return false;
  }
  G.collides = collides;

  // Can (x1,y1) reach (x2,y2) without crossing something solid? Sampled in ~8px steps,
  // the same granularity as the projectile sweep, so a swing and an arrow agree on what
  // a wall blocks. Walls are a full tile thick, so a step this fine cannot skip one.
  // The origin's own tile is exempt: a fireball bursts flush against a wall, and that
  // blast must still reach the monsters standing in the open beside it.
  function lineOfSight(grid, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.ceil(Math.hypot(dx, dy) / 8);
    const originTx = Math.floor(x1 / TS);
    const originTy = Math.floor(y1 / TS);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x1 + dx * t) / TS);
      const ty = Math.floor((y1 + dy * t) / TS);
      if (tx === originTx && ty === originTy) continue;
      if (ty < 0 || tx < 0 || ty >= grid.length || tx >= grid[0].length) return false;
      if (!Dungeon.isWalkable(grid[ty][tx])) return false;
    }
    return true;
  }
  G.lineOfSight = lineOfSight;
  Game.lineOfSight = lineOfSight; // exported for tests and the future server

  G.moveCircle = function moveCircle(grid, x, y, r, dx, dy) {
    if (dx !== 0 && !collides(grid, x + dx, y, r)) x += dx;
    if (dy !== 0 && !collides(grid, x, y + dy, r)) y += dy;
    return { x, y };
  };

  if (typeof window !== 'undefined') window.Game = Game;
  if (typeof module !== 'undefined') module.exports = Game;
})();
