// render/tiles.js — dungeon tiles (walls, floors, entry, stairs) and torches.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;
  const TS = Dungeon.TILE_SIZE;

  // The palette for one tile. Dungeon floors have a single theme; the overworld
  // asks the level, which answers from the biome under that tile — so a coastline
  // and a ridge a screen apart are coloured differently without the renderer
  // knowing anything about biomes or noise.
  R.paletteAt = function paletteAt(state, x, y) {
    const d = state.dungeon;
    return d.biomeAt ? d.biomeAt(x, y) : d.theme;
  };

  R.drawTile = function drawTile(ctx, state, x, y) {
    const t = state.dungeon.grid[y][x];
    const theme = R.paletteAt(state, x, y);
    const px = x * TS;
    const py = y * TS;
    const h = R.tileHash(x, y, state.floor);

    // Open water: impassable, so it reads as a hard edge to the walkable world.
    if (t === Dungeon.TILE.WATER) {
      ctx.fillStyle = theme.water;
      ctx.fillRect(px, py, TS, TS);
      // Slow ripples, offset per tile so the surface never pulses in lockstep.
      const ph = state.time * 0.8 + h * 6.28;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px + 3, py + 8 + Math.sin(ph) * 2, TS - 10, 1.5);
      ctx.fillRect(px + 8, py + 20 + Math.sin(ph + 1.7) * 2, TS - 14, 1.5);
      // Foam where the water meets standable ground — the shoreline.
      const grid = state.dungeon.grid;
      const shore = (row, xx) => row && Dungeon.isWalkable(row[xx]);
      ctx.fillStyle = 'rgba(220,235,240,0.22)';
      if (shore(grid[y - 1], x)) ctx.fillRect(px, py, TS, 2.5);
      if (shore(grid[y + 1], x)) ctx.fillRect(px, py + TS - 2.5, TS, 2.5);
      if (shore(grid[y], x - 1)) ctx.fillRect(px, py, 2.5, TS);
      if (shore(grid[y], x + 1)) ctx.fillRect(px + TS - 2.5, py, 2.5, TS);
      return;
    }

    // Cliffs are walls by another name: same bevel, biome rock colour.
    if (t === Dungeon.TILE.WALL || t === Dungeon.TILE.CLIFF) {
      ctx.fillStyle = theme.wallEdge;
      ctx.fillRect(px, py, TS, TS);
      const grid = state.dungeon.grid;
      const below = grid[y + 1] && Dungeon.isWalkable(grid[y + 1][x]);
      // Wall "face" where it meets floor beneath — a cheap 3/4-view bevel.
      ctx.fillStyle = R.shade(theme.wall, 0.92 + h * 0.16);
      ctx.fillRect(px, py, TS, below ? TS - 5 : TS);
      if (below) {
        ctx.fillStyle = R.shade(theme.wallEdge, 0.7);
        ctx.fillRect(px, py + TS - 5, TS, 5);
      }
      if (grid[y - 1] && Dungeon.isWalkable(grid[y - 1][x])) {
        ctx.fillStyle = R.shade(theme.wall, 1.25);
        ctx.fillRect(px, py, TS, 3);
      }
      // Occasional brick seams.
      if (h > 0.55) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(px + 3 + h * 10, py + 8 + h * 12, 10, 1.5);
      }
      return;
    }

    // Floor — or a road, which is the same ground packed down and paler.
    const road = t === Dungeon.TILE.ROAD;
    const base = road ? theme.road : (x + y) % 2 === 0 ? theme.floorA : theme.floorB;
    ctx.fillStyle = R.shade(base, 0.94 + h * 0.12);
    ctx.fillRect(px, py, TS, TS);
    if (road) {
      // Loose grit rather than a tile grid: a road should read as worn, not laid.
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.fillRect(px + h * 22, py + (1 - h) * 20 + 3, 4, 3);
      ctx.fillRect(px + (1 - h) * 18 + 4, py + h * 24, 3, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px + h * 16 + 6, py + h * 12 + 8, 5, 2);
      return;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TS - 1, TS - 1);
    if (h > 0.9) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(px + h * 20, py + (1 - h) * 22 + 4, 5, 2);
      ctx.fillRect(px + h * 14 + 3, py + (1 - h) * 22 + 6, 2, 2);
    } else if (h < 0.06) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px + 6, py + 10, 8, 3);
    }

    if (t === Dungeon.TILE.ENTRY) {
      ctx.strokeStyle = 'rgba(190,170,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + TS / 2, py + TS / 2, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px + TS / 2, py + TS / 2, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (t === Dungeon.TILE.STAIRS_DOWN) {
      // Dark descending stairwell.
      ctx.fillStyle = '#0a0708';
      ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = R.shade('#5a4a3a', 1 - i * 0.22);
        ctx.fillRect(px + 4 + i * 3, py + 4 + i * 6, TS - 8 - i * 6, 5);
      }
      const glow = 0.5 + 0.5 * Math.sin(state.time * 3);
      ctx.strokeStyle = `rgba(255,216,77,${0.25 + glow * 0.3})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py + 1.5, TS - 3, TS - 3);
    }
  };

  R.drawTorch = function drawTorch(ctx, state, t) {
    const cx = t.x * TS + TS / 2;
    const cy = t.y * TS + TS / 2;
    const flick = Math.sin(state.time * 9 + t.x * 7 + t.y * 13) * 0.5 + 0.5;
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(cx - 2, cy - 1, 4, 10);
    const fh = 7 + flick * 4;
    const grad = ctx.createRadialGradient(cx, cy - 4, 1, cx, cy - 4, fh);
    grad.addColorStop(0, '#fff3c0');
    grad.addColorStop(0.45, state.dungeon.theme.torch);
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, fh, 0, Math.PI * 2);
    ctx.fill();
  };

  R.torchGlow = function torchGlow(ctx, state, t) {
    const cx = t.x * TS + TS / 2;
    const cy = t.y * TS + TS / 2;
    const flick = Math.sin(state.time * 9 + t.x * 7 + t.y * 13) * 0.5 + 0.5;
    const r = 55 + flick * 10;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,180,80,0.16)');
    grad.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
})();
