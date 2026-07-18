// dungeon.js — procedural rooms-and-corridors generation plus BFS flow fields. Pure; node-testable.
(function () {
  const U = typeof require === 'function' ? require('./util.js') : window.U;
  const Entities = typeof require === 'function' ? require('./entities.js') : window.Entities;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;
  const Props = typeof require === 'function' ? require('./props.js') : window.Props;

  const D = {};

  // WATER and CLIFF are the overworld's two impassable kinds — being non-walkable
  // is the whole trick: collision, the flow field, and monster pathing all route
  // around them with no new code. ROAD is walkable and is what guarantees the
  // continent stays connected across noise-carved lakes and ridges.
  D.TILE = { WALL: 0, FLOOR: 1, ENTRY: 2, STAIRS_DOWN: 3, WATER: 4, CLIFF: 5, ROAD: 6 };
  D.TILE_SIZE = 32;

  const WALKABLE = (t) => t === D.TILE.FLOOR || t === D.TILE.ENTRY || t === D.TILE.STAIRS_DOWN || t === D.TILE.ROAD;
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

  // A stair-stepped diagonal run from a to b. Each step is orthogonally adjacent to
  // the last, so the corridor stays passable for circle-vs-tile collision even though
  // it reads as a diagonal; whatever axis distance is left over is carved straight.
  function carveDiag(grid, a, b) {
    const sx = Math.sign(b.cx - a.cx) || 1;
    const sy = Math.sign(b.cy - a.cy) || 1;
    let x = a.cx;
    let y = a.cy;
    grid[y][x] = D.TILE.FLOOR;
    while (x !== b.cx && y !== b.cy) {
      x += sx;
      grid[y][x] = D.TILE.FLOOR;
      y += sy;
      grid[y][x] = D.TILE.FLOOR;
    }
    carveH(grid, x, b.cx, y);
    carveV(grid, y, b.cy, b.cx);
  }

  function carveCorridor(grid, a, b, rng) {
    // Most links run diagonal now — pure L-bends everywhere are what made each floor
    // read as a grid of right angles.
    const roll = rng();
    if (roll < 0.55) {
      carveDiag(grid, a, b);
    } else if (roll < 0.775) {
      carveH(grid, a.cx, b.cx, a.cy);
      carveV(grid, a.cy, b.cy, b.cx);
    } else {
      carveV(grid, a.cy, b.cy, a.cx);
      carveH(grid, a.cx, b.cx, b.cy);
    }
  }

  // An irregular open cavern: lobes overlapping one central core, so it is always
  // internally connected and its centre is always floor. Flagged `cavern` and kept
  // out of the stairs and boss-arena picks, which assume a plain rectangle.
  function cavernBox(rng, W, H) {
    const w = U.randInt(rng, 14, 22);
    const h = U.randInt(rng, 11, 17);
    const x = U.randInt(rng, 3, W - w - 4);
    const y = U.randInt(rng, 3, H - h - 4);
    return { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2), cavern: true };
  }

  function carveCavern(grid, rng, box) {
    const { x, y, w, h } = box;
    const core = { x: box.cx - 3, y: box.cy - 2, w: 7, h: 5 };
    carveRoom(grid, core);
    for (let k = 0; k < 5; k++) {
      const lw = U.randInt(rng, 6, w - 2);
      const lh = U.randInt(rng, 5, h - 2);
      const lx = U.randInt(rng, x + 1, x + w - lw - 1);
      const ly = U.randInt(rng, y + 1, y + h - lh - 1);
      // Only lobes that actually touch the core get carved, or the cavern fragments.
      if (lx > core.x + core.w || lx + lw < core.x || ly > core.y + core.h || ly + lh < core.y) continue;
      carveRoom(grid, { x: lx, y: ly, w: lw, h: lh });
    }
  }

  const overlaps = (a, b) =>
    a.x - 1 < b.x + b.w + 1 &&
    a.x + a.w + 1 > b.x - 1 &&
    a.y - 1 < b.y + b.h + 1 &&
    a.y + a.h + 1 > b.y - 1;

  const centerDist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const edgeKey = (n, i, j) => Math.min(i, j) * n + Math.max(i, j);

  // Link every room to a geometric neighbour via a minimum spanning tree over room
  // centres (Prim, O(n²) — fine for <100 rooms). Rooms used to be chained in
  // *placement* order, which is random, so consecutive rooms sat at opposite ends of
  // the map and each link carved a corridor clean across the floor. Dozens of those
  // slashes is what made a floor read as noise with no sense of direction. An MST
  // keeps every corridor short and local, so the floor grows as a connected web of
  // neighbourhoods, and its leaves become honest dead ends.
  //
  // Weights get mild per-edge jitter so two seeds don't converge on the same skeleton.
  // Returns the adjacency list, which the caller walks to find the critical path.
  function spanRooms(grid, rooms, rng) {
    const n = rooms.length;
    const adj = Array.from({ length: n }, () => []);
    if (n < 2) return adj;
    const inTree = new Array(n).fill(false);
    const best = new Array(n).fill(Infinity);
    const parent = new Array(n).fill(-1);
    best[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      inTree[u] = true;
      if (parent[u] >= 0) {
        carveCorridor(grid, rooms[u], rooms[parent[u]], rng);
        adj[u].push(parent[u]);
        adj[parent[u]].push(u);
      }
      for (let v = 0; v < n; v++) {
        if (inTree[v]) continue;
        const w = centerDist(rooms[u], rooms[v]) * (0.85 + 0.3 * rng());
        if (w < best[v]) {
          best[v] = w;
          parent[v] = u;
        }
      }
    }
    return adj;
  }

  // Extra links so the floor isn't a pure tree. Only rooms that are already close
  // qualify: a loop should be a shortcut you notice between two neighbouring
  // chambers, not another corridor teleporting across the map.
  function addLoops(grid, rooms, adj, rng, count, radius) {
    const n = rooms.length;
    const linked = new Set();
    for (let i = 0; i < n; i++) for (const j of adj[i]) linked.add(edgeKey(n, i, j));
    const cands = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (linked.has(edgeKey(n, i, j))) continue;
        if (centerDist(rooms[i], rooms[j]) <= radius) cands.push([i, j]);
      }
    }
    const want = Math.min(count, cands.length);
    for (let k = 0; k < want; k++) {
      const [i, j] = cands.splice(U.randInt(rng, 0, cands.length - 1), 1)[0];
      carveCorridor(grid, rooms[i], rooms[j], rng);
      adj[i].push(j);
      adj[j].push(i);
    }
  }

  // BFS over the room graph from room 0 (the entry). `depth` is how many rooms deep
  // each chamber sits along the shortest route in — the floor's sense of progression
  // hangs off this: the stairs go at the deepest room, and the chain of rooms leading
  // there gets flagged as the critical path.
  function roomDepths(adj, n) {
    const depth = new Array(n).fill(Infinity);
    const from = new Array(n).fill(-1);
    depth[0] = 0;
    const q = [0];
    for (let head = 0; head < q.length; head++) {
      const u = q[head];
      for (const v of adj[u]) {
        if (depth[v] !== Infinity) continue;
        depth[v] = depth[u] + 1;
        from[v] = u;
        q.push(v);
      }
    }
    return { depth, from };
  }

  D.generateDungeon = function (seed, floor) {
    // 120x120 — four times the area of the old 60x60 floors.
    const W = 120;
    const H = 120;
    const rng = U.mulberry32(((seed >>> 0) * 100003 + floor * 7919) >>> 0);
    const grid = Array.from({ length: H }, () => new Array(W).fill(D.TILE.WALL));

    // Place non-overlapping rooms (1-tile gap, 2-tile border margin).
    // Past floor 10 the layout turns into a warren: many small chambers, extra loops.
    const deep = floor > 10;
    const rooms = [];

    // A handful of big open caverns first, so they get the uncontested space and the
    // rectangular rooms pack around them.
    for (let k = 0, tries = 0; k < (deep ? 3 : 5) && tries < 40; tries++) {
      const box = cavernBox(rng, W, H);
      if (rooms.some((r) => overlaps(box, r))) continue;
      carveCavern(grid, rng, box);
      rooms.push(box);
      k++;
    }

    const TARGET = deep ? 76 : 52;
    for (let attempt = 0; attempt < (deep ? 1400 : 1040) && rooms.length < TARGET; attempt++) {
      const w = U.randInt(rng, deep ? 4 : 5, deep ? 7 : 13);
      const h = U.randInt(rng, deep ? 4 : 5, deep ? 6 : 11);
      const x = U.randInt(rng, 2, W - w - 3);
      const y = U.randInt(rng, 2, H - h - 3);
      const room = { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) };
      if (rooms.some((r) => overlaps(room, r))) continue;
      carveRoom(grid, room);
      rooms.push(room);
    }

    // The floor starts in a corner rather than wherever the placement loop happened to
    // put its first room, so the run has a direction: you enter at one edge and work
    // inward. The entry room is moved to index 0 — the spawn, prop and ambush passes
    // below all skip index 0 to keep the arrival chamber quiet.
    const corner = [
      { cx: 6, cy: 6 },
      { cx: W - 7, cy: 6 },
      { cx: 6, cy: H - 7 },
      { cx: W - 7, cy: H - 7 },
    ][U.randInt(rng, 0, 3)];
    // Arrival wants a proper hall, not whichever closet happens to sit nearest the
    // corner: a room with at least 4 tiles of clear floor around its centre, so you
    // can see and move before anything reaches you. Deep floors are built from small
    // chambers and may have nothing that roomy, so the bar drops to the largest rooms
    // on offer, then to anything at all.
    const roomy = (min) => rooms.filter((r) => !r.cavern && r.w >= min && r.h >= min);
    let pool = roomy(9);
    if (!pool.length) {
      const plain = rooms.filter((r) => !r.cavern);
      pool = (plain.length ? plain : rooms).slice().sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 8);
    }
    let entryRoom = pool[0];
    let entryBest = Infinity;
    for (const r of pool) {
      const d = centerDist(r, corner);
      if (d < entryBest) {
        entryBest = d;
        entryRoom = r;
      }
    }
    const entryIdx = rooms.indexOf(entryRoom);
    [rooms[0], rooms[entryIdx]] = [rooms[entryIdx], rooms[0]];

    // Connect neighbours into a spanning web, then thread in a few local shortcuts.
    const adj = spanRooms(grid, rooms, rng);
    addLoops(grid, rooms, adj, rng, deep ? 24 : 12, deep ? 18 : 24);

    const { depth, from } = roomDepths(adj, rooms.length);
    for (let i = 0; i < rooms.length; i++) rooms[i].depth = depth[i] === Infinity ? 0 : depth[i];

    // Stairs go at the room that is deepest along the room graph — the far end of the
    // longest route in, not merely the farthest tile. Ties break on straight-line
    // distance, and we insist on real distance from the entry so a compact floor can
    // never open the stairs next door.
    const entry = { x: rooms[0].cx, y: rooms[0].cy };
    let stairsIdx = -1;
    let bestScore = -1;
    for (const minGap of [18, 0]) {
      for (let i = 1; i < rooms.length; i++) {
        if (rooms[i].cavern) continue; // stairs and the arena need a true rectangle
        if (depth[i] === Infinity) continue;
        const gap = centerDist(rooms[i], rooms[0]);
        if (gap < minGap) continue;
        const score = depth[i] * 1000 + gap;
        if (score > bestScore) {
          bestScore = score;
          stairsIdx = i;
        }
      }
      if (stairsIdx >= 0) break;
    }
    if (stairsIdx < 0) stairsIdx = rooms.length - 1;
    let stairs = { x: rooms[stairsIdx].cx, y: rooms[stairsIdx].cy };

    // Walk the BFS parents back from the stairs: these are the rooms the player must
    // pass through. Lighting leans on this below, so the route out reads as a route.
    for (let i = stairsIdx; i >= 0; i = from[i]) {
      rooms[i].onPath = true;
      if (from[i] < 0) break;
    }

    grid[entry.y][entry.x] = D.TILE.ENTRY;
    grid[stairs.y][stairs.x] = D.TILE.STAIRS_DOWN;

    // Every second floor, the farthest room becomes a boss arena guarding the stairs.
    let boss = null;
    if (floor % 2 === 0) {
      const bossRoom = rooms[stairsIdx];
      grid[stairs.y][stairs.x] = D.TILE.FLOOR;
      stairs = { x: bossRoom.x + bossRoom.w - 2, y: bossRoom.cy };
      grid[stairs.y][stairs.x] = D.TILE.STAIRS_DOWN;
      boss = {
        x: bossRoom.cx,
        y: bossRoom.cy,
        room: { x: bossRoom.x, y: bossRoom.y, w: bossRoom.w, h: bossRoom.h },
      };
    }

    // Torches on walls hugging room perimeters. Rooms on the critical path are lit
    // roughly twice as densely, so brightness is a soft breadcrumb toward the stairs
    // and the unlit branches read as side rooms worth a detour.
    const torches = [];
    for (const r of rooms) {
      const lit = r.onPath ? 2 : 1;
      for (let x = r.x; x < r.x + r.w; x++) {
        if (grid[r.y - 1][x] === D.TILE.WALL && rng() < 0.12 * lit) torches.push({ x, y: r.y - 1 });
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        if (grid[y][r.x - 1] === D.TILE.WALL && rng() < 0.08 * lit) torches.push({ x: r.x - 1, y });
        if (grid[y][r.x + r.w] === D.TILE.WALL && rng() < 0.08 * lit) torches.push({ x: r.x + r.w, y });
      }
    }

    // Monster spawns: every room but the entry room; more of them on deeper floors.
    const SP = Balance.spawns;
    const spawns = [];
    const depthBonus = Math.min(SP.depthCap, Math.floor((floor - 1) * SP.depthRate));
    for (let ri = 1; ri < rooms.length; ri++) {
      const room = rooms[ri];
      if (boss && room.x === boss.room.x && room.y === boss.room.y) continue; // the arena belongs to the boss
      const roomBonus = Math.min(SP.roomCap, Math.floor(room.depth * SP.roomRate));
      const count = SP.base + U.randInt(rng, 0, SP.rand) + depthBonus + roomBonus;
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

    // Breakable clutter: furniture, pots, barrels, and the occasional chest. Placed
    // like spawns (random interior FLOOR tiles, clear of the entry) but non-blocking,
    // so they never disturb collision or the flow field. Tiles already holding a
    // spawn or another prop are skipped, keeping one smashable per tile.
    const props = [];
    const taken = new Set(spawns.map((s) => s.x + ',' + s.y));
    const placeOn = (room, type) => {
      for (let t = 0; t < 20; t++) {
        const x = U.randInt(rng, room.x + 1, room.x + room.w - 2);
        const y = U.randInt(rng, room.y + 1, room.y + room.h - 2);
        if (grid[y][x] !== D.TILE.FLOOR) continue;
        if (Math.hypot(x - entry.x, y - entry.y) <= 5) continue;
        const key = x + ',' + y;
        if (taken.has(key)) continue;
        taken.add(key);
        props.push({ x, y, type });
        return;
      }
    };
    const PR = Balance.props;
    for (let ri = 1; ri < rooms.length; ri++) {
      const room = rooms[ri];
      if (boss && room.x === boss.room.x && room.y === boss.room.y) continue; // keep the arena clear
      const count = U.randInt(rng, PR.perRoom.min, PR.perRoom.max);
      for (let k = 0; k < count; k++) placeOn(room, Props.pickType(rng, floor));
      if (rng() < PR.chestChance) placeOn(room, 'chest');
    }

    // Ambush swarms: from SW.minFloor on, a few roomy chambers hide a pack that
    // bursts in when the hero reaches the middle. Spawn tiles are precomputed here
    // so triggering is a pure lookup — solo and server produce the same swarm.
    const SW = Balance.swarm;
    const ambushes = [];
    if (floor >= SW.minFloor) {
      const packBonus = Math.max(0, Math.floor((floor - SW.minFloor) * SW.packRate));
      for (let ri = 1; ri < rooms.length && ambushes.length < SW.maxRooms; ri++) {
        const room = rooms[ri];
        if (boss && room.x === boss.room.x && room.y === boss.room.y) continue;
        if ((room.w - 2) * (room.h - 2) < SW.minRoomTiles) continue;
        if (rng() >= SW.roomChance) continue;
        // Candidate spawn tiles: a tight ring around the room center. Keyed off the
        // center (not the walls) so on the big post-bigger-maps rooms the pack still
        // spawns close and converges together instead of trickling in from afar.
        const ring = [];
        for (let y = room.y; y < room.y + room.h; y++) {
          for (let x = room.x; x < room.x + room.w; x++) {
            if (grid[y][x] !== D.TILE.FLOOR) continue;
            const dTiles = Math.hypot(x - room.cx, y - room.cy);
            if (dTiles >= SW.ringMinTiles && dTiles <= SW.ringMaxTiles) ring.push({ x, y });
          }
        }
        if (ring.length < 3) continue;
        const count = Math.min(SW.packCap, SW.packBase + U.randInt(rng, 0, SW.packRand) + packBonus);
        const swSpawns = [];
        const picked = new Set();
        for (let k = 0; k < count; k++) {
          // Sample with replacement across the ring, skipping exact dupes; a few
          // collisions on a small ring just mean a slightly tighter pack.
          let cell = null;
          for (let t = 0; t < 8; t++) {
            const c = ring[U.randInt(rng, 0, ring.length - 1)];
            const key = c.y * W + c.x;
            if (picked.has(key)) continue;
            picked.add(key);
            cell = c;
            break;
          }
          if (cell) swSpawns.push(cell);
        }
        if (!swSpawns.length) continue;
        ambushes.push({
          cx: room.cx,
          cy: room.cy,
          radius: SW.triggerTiles,
          spawns: swSpawns,
        });
      }
    }

    return {
      grid,
      width: W,
      height: H,
      rooms,
      entry,
      stairs,
      spawns,
      ambushes,
      torches,
      props,
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

  // The same BFS, but allocated only over `rect` — a whole-grid field is fine on a
  // 120x120 floor and fatal on the 2048x2048 overworld, where it would be 4.2M
  // cells rebuilt several times a second. Returns a window descriptor read through
  // D.flowAt; anything outside reads Infinity.
  //
  // A window sized to the sources' bounding box expanded by maxDist + 2 loses
  // nothing: no path of at most maxDist steps from a source can reach a tile
  // outside it, so the clipped BFS agrees with the whole-grid one everywhere the
  // window covers. `D.flowWindowRect` builds exactly that rect.
  D.flowWindowRect = function (grid, sources, maxDist) {
    const h = grid.length;
    const w = grid[0].length;
    if (!sources.length) return { x0: 0, y0: 0, x1: -1, y1: -1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of sources) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
    const pad = maxDist + 2;
    return {
      x0: Math.max(0, Math.floor(minX) - pad),
      y0: Math.max(0, Math.floor(minY) - pad),
      x1: Math.min(w - 1, Math.ceil(maxX) + pad),
      y1: Math.min(h - 1, Math.ceil(maxY) + pad),
    };
  };

  D.flowFieldWindow = function (grid, sources, maxDist, rect) {
    const gh = grid.length;
    const gw = grid[0].length;
    const r = rect || D.flowWindowRect(grid, sources, maxDist);
    const x0 = Math.max(0, r.x0 | 0);
    const y0 = Math.max(0, r.y0 | 0);
    const x1 = Math.min(gw - 1, r.x1 | 0);
    const y1 = Math.min(gh - 1, r.y1 | 0);
    const w = Math.max(0, x1 - x0 + 1);
    const h = Math.max(0, y1 - y0 + 1);
    const field = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    const flow = { field, x0, y0, w, h };
    if (!w || !h) return flow;
    const q = [];
    for (const s of sources) {
      const lx = s.x - x0;
      const ly = s.y - y0;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
      if (!WALKABLE(grid[s.y][s.x])) continue;
      if (field[ly][lx] === 0) continue;
      field[ly][lx] = 0;
      q.push([lx, ly]);
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
        if (field[ny][nx] !== Infinity) continue;
        if (!WALKABLE(grid[ny + y0][nx + x0])) continue;
        field[ny][nx] = d + 1;
        q.push([nx, ny]);
      }
    }
    return flow;
  };

  // The one way to read a flow field. Accepts either a windowed field from
  // flowFieldWindow or a plain whole-grid array from flowFieldMulti, so dungeon
  // floors and the overworld share every consumer.
  D.flowAt = function (flow, x, y) {
    if (!flow) return Infinity;
    if (flow.field) {
      const lx = x - flow.x0;
      const ly = y - flow.y0;
      if (lx < 0 || ly < 0 || lx >= flow.w || ly >= flow.h) return Infinity;
      return flow.field[ly][lx];
    }
    const row = flow[y];
    if (!row) return Infinity;
    const v = row[x];
    return v === undefined ? Infinity : v;
  };

  if (typeof window !== 'undefined') window.Dungeon = D;
  if (typeof module !== 'undefined') module.exports = D;
})();
