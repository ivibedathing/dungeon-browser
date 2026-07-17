// dungeon.js — procedural rooms-and-corridors generation plus BFS flow fields. Pure; node-testable.
(function () {
  const U = typeof require === 'function' ? require('./util.js') : window.U;
  const Entities = typeof require === 'function' ? require('./entities.js') : window.Entities;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;

  const D = {};

  D.TILE = { WALL: 0, FLOOR: 1, ENTRY: 2, STAIRS_DOWN: 3 };
  D.TILE_SIZE = 32;

  const WALKABLE = (t) => t === D.TILE.FLOOR || t === D.TILE.ENTRY || t === D.TILE.STAIRS_DOWN;
  D.isWalkable = WALKABLE;

  D.THEMES = [
    { name: 'Catacombs', wall: '#3a3244', wallEdge: '#221c2e', floorA: '#4b4252', floorB: '#443c4b', torch: '#ffb04d', fog: '#0d0a12' },
    { name: 'Cold Caves', wall: '#2e3d48', wallEdge: '#1b262e', floorA: '#3d4d58', floorB: '#374650', torch: '#8fd4ff', fog: '#080d11' },
    { name: 'Burning Depths', wall: '#4d2a25', wallEdge: '#2e1714', floorA: '#5a352e', floorB: '#523029', torch: '#ff7a3d', fog: '#120806' },
  ];
  // Below floor 10 the dungeon changes character: new palettes, mazier warrens.
  D.DEEP_THEMES = [
    { name: 'Fungal Hollows', wall: '#2e4436', wallEdge: '#182a1e', floorA: '#3a5244', floorB: '#344a3d', torch: '#8fe8a0', fog: '#071009' },
    { name: 'Frozen Abyss', wall: '#33445c', wallEdge: '#1c2940', floorA: '#41546e', floorB: '#3a4d66', torch: '#a8dfff', fog: '#080e18' },
    { name: 'Obsidian Warrens', wall: '#33283e', wallEdge: '#191227', floorA: '#251d31', floorB: '#2c2339', torch: '#c66bff', fog: '#0a0612' },
  ];
  D.themeFor = (floor) =>
    floor > 10
      ? D.DEEP_THEMES[Math.floor((floor - 11) / 4) % D.DEEP_THEMES.length]
      : D.THEMES[Math.floor((floor - 1) / 4) % D.THEMES.length];

  D.TOWN_THEME = { name: 'Ashfall Camp', wall: '#403a32', wallEdge: '#262019', floorA: '#55503f', floorB: '#4d4839', torch: '#ffc26e', fog: '#0b0a08' };

  // The safe hub reached through a town portal: open plaza, healing well, vendor. No monsters.
  D.generateTown = function (seed) {
    const W = 34;
    const H = 26;
    const rng = U.mulberry32(((seed >>> 0) ^ 0x7a3f) >>> 0);
    const grid = Array.from({ length: H }, () => new Array(W).fill(D.TILE.WALL));
    const plaza = { x: 5, y: 5, w: W - 10, h: H - 10 };
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) {
      for (let x = plaza.x; x < plaza.x + plaza.w; x++) {
        grid[y][x] = D.TILE.FLOOR;
      }
    }
    const entry = { x: Math.floor(W / 2), y: Math.floor(H / 2) + 4 };
    const well = { x: plaza.x + 4, y: Math.floor(H / 2) };
    const vendor = { x: plaza.x + plaza.w - 5, y: Math.floor(H / 2) };
    const smith = { x: plaza.x + 7, y: plaza.y + plaza.h - 4 };
    // The notice board hangs well clear of the stall: their interaction ranges
    // must never overlap, or one E press would try to serve both.
    const board = { x: plaza.x + plaza.w - 7, y: plaza.y + 3 };
    grid[entry.y][entry.x] = D.TILE.ENTRY;

    // Scattered ruined pillars for flavor — single tiles can never split an open plaza.
    for (let k = 0; k < 7; k++) {
      const px = U.randInt(rng, plaza.x + 2, plaza.x + plaza.w - 3);
      const py = U.randInt(rng, plaza.y + 2, plaza.y + plaza.h - 3);
      const nearSpot = [entry, well, vendor, smith, board].some((s) => Math.hypot(px - s.x, py - s.y) < 3.5);
      if (!nearSpot) grid[py][px] = D.TILE.WALL;
    }

    const torches = [];
    for (let x = plaza.x; x < plaza.x + plaza.w; x++) {
      if ((x - plaza.x) % 5 === 2) {
        torches.push({ x, y: plaza.y - 1 });
        torches.push({ x, y: plaza.y + plaza.h });
      }
    }
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) {
      if ((y - plaza.y) % 5 === 2) {
        torches.push({ x: plaza.x - 1, y });
        torches.push({ x: plaza.x + plaza.w, y });
      }
    }

    return {
      grid,
      width: W,
      height: H,
      rooms: [{ ...plaza, cx: entry.x, cy: entry.y }],
      entry,
      stairs: null,
      spawns: [],
      torches,
      theme: D.TOWN_THEME,
      floor: 0,
      town: true,
      well,
      vendor,
      smith,
      board,
    };
  };

  function carveRoom(grid, r) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        grid[y][x] = D.TILE.FLOOR;
      }
    }
  }

  function carveH(grid, x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) grid[y][x] = D.TILE.FLOOR;
  }

  function carveV(grid, y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) grid[y][x] = D.TILE.FLOOR;
  }

  function carveCorridor(grid, a, b, rng) {
    if (rng() < 0.5) {
      carveH(grid, a.cx, b.cx, a.cy);
      carveV(grid, a.cy, b.cy, b.cx);
    } else {
      carveV(grid, a.cy, b.cy, a.cx);
      carveH(grid, a.cx, b.cx, b.cy);
    }
  }

  const overlaps = (a, b) =>
    a.x - 1 < b.x + b.w + 1 &&
    a.x + a.w + 1 > b.x - 1 &&
    a.y - 1 < b.y + b.h + 1 &&
    a.y + a.h + 1 > b.y - 1;

  D.generateDungeon = function (seed, floor) {
    const W = 60;
    const H = 60;
    const rng = U.mulberry32(((seed >>> 0) * 100003 + floor * 7919) >>> 0);
    const grid = Array.from({ length: H }, () => new Array(W).fill(D.TILE.WALL));

    // Place non-overlapping rooms (1-tile gap, 2-tile border margin).
    // Past floor 10 the layout turns into a warren: many small chambers, extra loops.
    const deep = floor > 10;
    const rooms = [];
    const TARGET = deep ? 19 : 13;
    for (let attempt = 0; attempt < (deep ? 360 : 260) && rooms.length < TARGET; attempt++) {
      const w = U.randInt(rng, deep ? 4 : 5, deep ? 7 : 11);
      const h = U.randInt(rng, deep ? 4 : 5, deep ? 6 : 9);
      const x = U.randInt(rng, 2, W - w - 3);
      const y = U.randInt(rng, 2, H - h - 3);
      const room = { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) };
      if (rooms.some((r) => overlaps(room, r))) continue;
      carveRoom(grid, room);
      rooms.push(room);
    }

    // Connect each room to the previous one, then add loop corridors.
    for (let i = 1; i < rooms.length; i++) carveCorridor(grid, rooms[i], rooms[i - 1], rng);
    for (let k = 0; k < (deep ? 6 : 3) && rooms.length > 3; k++) {
      const i = U.randInt(rng, 0, rooms.length - 1);
      const j = U.randInt(rng, 0, rooms.length - 1);
      if (i !== j) carveCorridor(grid, rooms[i], rooms[j], rng);
    }

    // Entry in the first room; stairs down in the BFS-farthest room.
    const entry = { x: rooms[0].cx, y: rooms[0].cy };
    const dist = D.flowField(grid, entry.x, entry.y, Infinity);
    let stairs = null;
    let best = -1;
    for (let i = 1; i < rooms.length; i++) {
      const d = dist[rooms[i].cy][rooms[i].cx];
      if (d !== Infinity && d > best) {
        best = d;
        stairs = { x: rooms[i].cx, y: rooms[i].cy };
      }
    }
    if (!stairs) stairs = { x: rooms[rooms.length - 1].cx, y: rooms[rooms.length - 1].cy };
    grid[entry.y][entry.x] = D.TILE.ENTRY;
    grid[stairs.y][stairs.x] = D.TILE.STAIRS_DOWN;

    // Every second floor, the farthest room becomes a boss arena guarding the stairs.
    let boss = null;
    if (floor % 2 === 0) {
      const bossRoom = rooms.find((r) => r.cx === stairs.x && r.cy === stairs.y) || rooms[rooms.length - 1];
      grid[stairs.y][stairs.x] = D.TILE.FLOOR;
      stairs = { x: bossRoom.x + bossRoom.w - 2, y: bossRoom.cy };
      grid[stairs.y][stairs.x] = D.TILE.STAIRS_DOWN;
      boss = {
        x: bossRoom.cx,
        y: bossRoom.cy,
        room: { x: bossRoom.x, y: bossRoom.y, w: bossRoom.w, h: bossRoom.h },
      };
    }

    // Torches on walls hugging room perimeters.
    const torches = [];
    for (const r of rooms) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (grid[r.y - 1][x] === D.TILE.WALL && rng() < 0.12) torches.push({ x, y: r.y - 1 });
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        if (grid[y][r.x - 1] === D.TILE.WALL && rng() < 0.08) torches.push({ x: r.x - 1, y });
        if (grid[y][r.x + r.w] === D.TILE.WALL && rng() < 0.08) torches.push({ x: r.x + r.w, y });
      }
    }

    // Monster spawns: every room but the entry room; more of them on deeper floors.
    const SP = Balance.spawns;
    const spawns = [];
    const depthBonus = Math.min(SP.depthCap, Math.floor((floor - 1) * SP.depthRate));
    for (let ri = 1; ri < rooms.length; ri++) {
      const room = rooms[ri];
      if (boss && room.x === boss.room.x && room.y === boss.room.y) continue; // the arena belongs to the boss
      const count = SP.base + U.randInt(rng, 0, SP.rand) + depthBonus;
      for (let k = 0; k < count; k++) {
        for (let t = 0; t < 20; t++) {
          const x = U.randInt(rng, room.x + 1, room.x + room.w - 2);
          const y = U.randInt(rng, room.y + 1, room.y + room.h - 2);
          if (grid[y][x] !== D.TILE.FLOOR) continue;
          if (Math.hypot(x - entry.x, y - entry.y) <= 6.5) continue;
          if (spawns.some((s) => s.x === x && s.y === y)) continue;
          spawns.push({
            x,
            y,
            type: Entities.pickMonsterType(rng, floor),
            champion: rng() < SP.championChance,
          });
          break;
        }
      }
    }
    if (floor >= 3 && spawns.length && !spawns.some((s) => s.champion)) {
      spawns[U.randInt(rng, 0, spawns.length - 1)].champion = true;
    }

    return {
      grid,
      width: W,
      height: H,
      rooms,
      entry,
      stairs,
      spawns,
      torches,
      theme: D.themeFor(floor),
      floor,
      boss,
    };
  };

  // BFS distance field toward one or more sources. Walls and tiles beyond maxDist
  // stay Infinity. Monsters chase by descending this gradient, which routes them
  // around walls — with several players, toward whichever is closest by path.
  D.flowFieldMulti = function (grid, sources, maxDist) {
    const h = grid.length;
    const w = grid[0].length;
    const field = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    const q = [];
    for (const s of sources) {
      if (s.y < 0 || s.x < 0 || s.y >= h || s.x >= w || !WALKABLE(grid[s.y][s.x])) continue;
      if (field[s.y][s.x] === 0) continue;
      field[s.y][s.x] = 0;
      q.push([s.x, s.y]);
    }
    let head = 0;
    while (head < q.length) {
      const [x, y] = q[head++];
      const d = field[y][x];
      if (d >= maxDist) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!WALKABLE(grid[ny][nx]) || field[ny][nx] !== Infinity) continue;
        field[ny][nx] = d + 1;
        q.push([nx, ny]);
      }
    }
    return field;
  };

  D.flowField = (grid, tx, ty, maxDist) => D.flowFieldMulti(grid, [{ x: tx, y: ty }], maxDist);

  if (typeof window !== 'undefined') window.Dungeon = D;
  if (typeof module !== 'undefined') module.exports = D;
})();
