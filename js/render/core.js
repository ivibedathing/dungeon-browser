// render/core.js — Render namespace plus color/visibility helpers shared by the
// js/render/ parts (internal context on Render._). Load this first.
(function () {
  const Render = {};
  // Internal context shared by the js/render/ parts; not public API.
  const R = (Render._ = {});

  R.tileHash = (x, y, salt) => {
    const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
    return (h % 1000) / 1000;
  };

  R.mix = function mix(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
    const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
    const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return `rgb(${r},${g},${bl})`;
  };

  R.shade = function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  };

  // How far the hero sees, in tiles. Dungeon floors are lit by torchlight; the
  // overworld is daylight and carries its own, much larger radius on the level.
  R.sightTiles = (state) => (state.dungeon && state.dungeon.sightTiles) || 9;

  R.isVisible = function isVisible(state, x, y) {
    const f = state.flow.field;
    if (!f) return false;
    const sight = R.sightTiles(state);
    if (Dungeon.flowAt(f, x, y) <= sight) return true;
    // Walls glow when any neighboring floor is visible.
    const row = state.dungeon.grid[y];
    if (row && row[x] !== undefined && !Dungeon.isWalkable(row[x])) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Dungeon.flowAt(f, x + dx, y + dy) <= sight) return true;
        }
      }
    }
    return false;
  };

  if (typeof window !== 'undefined') window.Render = Render;
  if (typeof module !== 'undefined') module.exports = Render;
})();
