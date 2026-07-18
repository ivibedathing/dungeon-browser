// game/world.js — being in the overworld: the level object that makes the
// continent duck-compatible with a dungeon floor, and the chunk activation set
// that decides which slice of it is actually simulated.
//
// Terrain is allocated whole and written lazily (js/world.js). What streams here
// is chunk CONTENT — monsters, props, torches — instantiated when a chunk comes
// within the activation radius of a player and dropped when it leaves. Only
// active chunks tick, which is what keeps a 4.2M-tile world inside the
// per-frame budget of a 120x120 dungeon floor.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const Balance = typeof window !== 'undefined' ? window.Balance : require('../balance.js');
  const World = typeof window !== 'undefined' ? window.World : require('../world.js');
  const G = Game._;
  const { TS } = G;

  const B = () => Balance.world;

  // ---- The level object ----

  // The overworld pretends to be a dungeon floor: same field names, same shapes,
  // so G.moveCircle, the flow field, the renderer, and every UI panel keep
  // working with no idea they are looking at a continent. `overworld: true` is
  // the only thing that distinguishes it, and only the few places that must.
  G.makeOverworldLevel = function makeOverworldLevel(world) {
    const entry = World.chunkCenter(World.TOWN_CX, World.TOWN_CY);
    return {
      grid: world.grid,
      width: world.width,
      height: world.height,
      rooms: [],
      entry,
      stairs: null,
      spawns: [],
      ambushes: [],
      torches: [],
      props: [],
      theme: World.BIOMES[0],
      floor: 0,
      boss: null,
      overworld: true,
      // Per-level sight radius: the dungeon's hard-coded 9 becomes a field, and
      // out here it is daylight.
      sightTiles: B().sightTiles,
      world,
      // The renderer picks a palette per tile rather than one per level. Handing
      // it a closure keeps js/render/ free of any dependency on the World module
      // — it just asks the level what colour the ground is here.
      biomeAt: (x, y) => World.biomeAt(world.seed, x, y),
    };
  };

  // A 2048x2048 explored map as arrays-of-booleans would be millions of boxed
  // values; as Uint8Array rows it is 4 MB flat, and `explored[y][x] = true`
  // still reads and writes exactly the same way everywhere else in the codebase.
  G.makeWorldExplored = function makeWorldExplored() {
    return Array.from({ length: World.SIZE }, () => new Uint8Array(World.SIZE));
  };

  // ---- Activation ----

  const key = World.chunkKey;

  // Every chunk within activeRadius of any living player, capped. The cap matters
  // in co-op: a party scattered across the map would otherwise multiply the live
  // set without bound. Nearest-to-a-player chunks win the budget.
  G.desiredChunks = function desiredChunks(state) {
    const r = B().activeRadius;
    const want = new Map(); // key -> best (smallest) distance to any player
    const living = state.players.filter((pl) => !pl.dead);
    const roster = living.length ? living : [state.player];
    for (const pl of roster) {
      const pc = World.chunkOf(Math.floor(pl.x / TS), Math.floor(pl.y / TS));
      for (let cy = pc.cy - r; cy <= pc.cy + r; cy++) {
        for (let cx = pc.cx - r; cx <= pc.cx + r; cx++) {
          if (!World.inBounds(cx, cy)) continue;
          const d = Math.max(Math.abs(cx - pc.cx), Math.abs(cy - pc.cy));
          const k = key(cx, cy);
          if (!want.has(k) || d < want.get(k)) want.set(k, d);
        }
      }
    }
    const cap = B().activeChunkCap;
    if (want.size <= cap) return new Set(want.keys());
    // Over budget: keep the closest chunks. Ties break on key so the choice is
    // deterministic and the server and client agree.
    const ordered = [...want.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return new Set(ordered.slice(0, cap).map((e) => e[0]));
  };

  // Instantiate a chunk's content. Terrain is already written by ensureChunk;
  // this is the streaming half.
  G.activateChunk = function activateChunk(state, cx, cy) {
    const w = state.world;
    World.ensureChunk(w.world, cx, cy);
    const k = key(cx, cy);
    if (w.active.has(k)) return;
    w.active.add(k);
    G.populateChunk(state, cx, cy);
  };

  // Stand up one chunk's monsters, props and braziers. A chunk the party has
  // already cleared stays empty until its respawn timer is up.
  G.populateChunk = function populateChunk(state, cx, cy) {
    const w = state.world;
    const k = key(cx, cy);
    const content = World.rollChunkContent(w.world, cx, cy);
    const partyN = state.partyN || (state.players && state.players.length) || 1;
    const rnd = state.srand || Math.random;

    if (!w.cleared[k]) {
      for (const s of content.monsters) {
        state.monsters.push(G.spawnWorldMonster(state, Entities.makeMonster(s.type, content.floor, s.champion, partyN), s, k));
      }
      if (content.boss) {
        const boss = G.spawnWorldMonster(state, Entities.makeBoss(content.floor, partyN), content.boss, k);
        // A world boss holds its ground rather than roaming: it is a landmark,
        // and one that wanders is one you cannot pin on a map.
        boss.worldBoss = true;
        boss.leash = 6;
        state.monsters.push(boss);
        w.bosses = w.bosses || {};
        w.bosses[k] = { x: content.boss.x, y: content.boss.y, name: boss.name, seen: false, slain: false };
      }
    }

    // Props and braziers are scenery: they come back with the chunk regardless of
    // whether its monsters have been cleared.
    for (const d of content.props) {
      const hp = Props.hp(d.type);
      state.props.push({
        id: state.nextId++,
        chunk: k,
        type: d.type,
        x: (d.x + 0.5) * TS,
        y: (d.y + 0.5) * TS,
        size: (Props.TYPES[d.type] || {}).size || 11,
        hp,
        maxHP: hp,
        hitT: 0,
      });
    }
    for (const t of content.torches) state.dungeon.torches.push({ x: t.x, y: t.y, chunk: k });
    void rnd;
  };

  // A resident died. When the last one in a chunk falls the chunk counts as
  // cleared and stops restocking until respawnSeconds have passed — so a cleared
  // stretch of country stays cleared while you loot it, and is dangerous again
  // by the time you come back through.
  G.worldMonsterKilled = function worldMonsterKilled(state, m) {
    const w = state.world;
    if (!w || m.chunk === undefined) return;
    if (m.worldBoss && w.bosses && w.bosses[m.chunk]) w.bosses[m.chunk].slain = true;
    if (state.monsters.some((o) => o.chunk === m.chunk)) return;
    w.cleared[m.chunk] = true;
    w.respawn[m.chunk] = state.time + Balance.world.respawnSeconds;
  };

  // The shared shape of a monster standing in the world. `home` and `chunk` are
  // what make it a resident rather than a floor spawn: home anchors its leash,
  // chunk is what deactivation and clear-tracking key off.
  G.spawnWorldMonster = function spawnWorldMonster(state, base, cell, chunkKey) {
    const x = (cell.x + 0.5) * TS;
    const y = (cell.y + 0.5) * TS;
    const rnd = state.srand || Math.random;
    return {
      ...base,
      id: state.nextId++,
      chunk: chunkKey,
      home: { x, y },
      wp: null,
      x,
      y,
      attackT: rnd() * 0.5,
      hitT: 0,
      lungeT: 0,
      wanderT: rnd() * 2,
      wandA: NaN,
      aggroed: false,
      kbx: 0,
      kby: 0,
    };
  };

  // Drop a chunk's content. Anything tagged with this chunk goes; terrain stays
  // written, so walking back in regenerates nothing and nothing flickers.
  G.deactivateChunk = function deactivateChunk(state, k) {
    const w = state.world;
    if (!w.active.has(k)) return;
    w.active.delete(k);
    state.monsters = state.monsters.filter((m) => m.chunk !== k);
    if (state.props) state.props = state.props.filter((pr) => pr.chunk !== k);
    if (state.dungeon.torches) state.dungeon.torches = state.dungeon.torches.filter((t) => t.chunk !== k);
  };

  // One frame of world upkeep: move the activation set, keep the terrain ahead of
  // the player written, and let cleared chunks come back after their cooldown.
  G.worldUpdate = function worldUpdate(state, dt) {
    const w = state.world;
    if (!w) return;
    w.t = (w.t || 0) + dt;

    const want = G.desiredChunks(state);
    for (const k of [...w.active]) {
      if (!want.has(k)) G.deactivateChunk(state, k);
    }
    for (const k of want) {
      if (!w.active.has(k)) G.activateChunk(state, k % World.CHUNKS, Math.floor(k / World.CHUNKS));
    }

    // Write terrain one ring beyond the live set, so the edge of vision is never
    // a wall of ungenerated ground the player can watch pop in.
    const p = state.player;
    const pc = World.chunkOf(Math.floor(p.x / TS), Math.floor(p.y / TS));
    World.ensureAround(w.world, pc.cx, pc.cy, B().activeRadius + 1);

    // Record where we've been at chunk granularity — this is what the save
    // persists and what the world map draws from across sessions.
    if (World.inBounds(pc.cx, pc.cy)) w.visited[key(pc.cx, pc.cy)] = true;

    // The palette follows the ground underfoot, so the background wash, the
    // torch tone, and the HUD's place-name all read as one biome.
    const biome = World.biomeAt(w.world.seed, Math.floor(p.x / TS), Math.floor(p.y / TS));
    if (state.dungeon.theme !== biome) state.dungeon.theme = biome;

    // A world boss you have laid eyes on gets pinned on the map, so finding one
    // is a discovery you can come back to rather than a thing you must fight now.
    if (w.bosses) {
      const sightPx = state.dungeon.sightTiles * TS;
      for (const m of state.monsters) {
        if (!m.worldBoss) continue;
        const rec = w.bosses[m.chunk];
        if (!rec || rec.seen) continue;
        const spotted = state.players.some((pl) => !pl.dead && U.dist2(pl.x, pl.y, m.x, m.y) < sightPx * sightPx);
        if (!spotted) continue;
        rec.seen = true;
        rec.x = Math.floor(m.x / TS);
        rec.y = Math.floor(m.y / TS);
        G.message(state, `${m.name} prowls here — marked on your map.`, '#ff5c4d');
        G.sfx(state, 'roar');
      }
    }

    // Cleared chunks repopulate once their timer is up — but only while they are
    // out of the live set, so a chunk never restocks in front of the player.
    const rs = w.respawn;
    for (const k of Object.keys(rs)) {
      if (rs[k] > state.time) continue;
      delete rs[k];
      w.cleared[k] = false;
      // If it came due while still live, drop it properly — clearing the active
      // flag alone would leave its old entities behind and the next activation
      // pass would stack a second population on top of them.
      G.deactivateChunk(state, Number(k));
    }
  };

  // ---- Entering ----

  // Build (or rebuild) the overworld as the current level and stand the party on
  // it. `at` is a world tile coord; it defaults to the town chunk centre.
  Game.enterWorld = function enterWorld(state, at) {
    const worldSeed = state.worldSeed >>> 0;
    const world = (state.world && state.world.world) || World.create(worldSeed);
    state.world = state.world || {
      world,
      seed: worldSeed,
      active: new Set(),
      visited: {},
      cleared: {},
      respawn: {},
      t: 0,
    };
    state.world.world = world;
    state.inWorld = true;
    state.inTown = false;
    // The world has no floor number to key its RNG on, so it draws from the run
    // seed. Every gameplay-affecting roll out here still comes off one stream.
    if (!state.srand) state.srand = U.mulberry32((((state.runSeed >>> 0) ^ 0x0517) >>> 0) + 1);

    const level = G.makeOverworldLevel(world);
    state.dungeon = level;
    state.explored = G.makeWorldExplored();
    state.monsters = [];
    state.props = [];
    state.groundItems = [];
    state.projectiles = [];
    state.portals = [];
    state.ambushes = [];
    state.bossFight = false;
    state.flow = { field: null, t: 0 };
    state.stash = null;

    const spot = at || level.entry;
    World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, B().activeRadius + 1);
    const placed = G.findOpenTile(world, spot.x, spot.y);
    const roster = state.players && state.players.length ? state.players : [state.player];
    roster.forEach((pl, i) => {
      const spread = roster.length > 1 ? 16 : 0;
      const a = (i / Math.max(1, roster.length)) * Math.PI * 2;
      pl.x = (placed.x + 0.5) * TS + Math.cos(a) * spread;
      pl.y = (placed.y + 0.5) * TS + Math.sin(a) * spread;
      pl.down = false;
      pl.downT = 0;
      pl.reviveT = 0;
      G.clearStatus(pl);
    });
    state.cam = { x: state.player.x, y: state.player.y };
    return state;
  };

  // Nearest standable tile to a target, spiralling outward. Roads and terrain are
  // noise-carved, so any nominated point — a town door, a dungeon mouth, a
  // waystone — can land on water or a cliff face and must be nudged clear.
  G.findOpenTile = function findOpenTile(world, tx, ty) {
    const grid = world.grid;
    const ok = (x, y) => {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
      const c = World.chunkOf(x, y);
      World.ensureChunk(world, c.cx, c.cy);
      return Dungeon.isWalkable(grid[y][x]);
    };
    if (ok(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r < 64; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ok(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
        }
      }
    }
    return { x: tx, y: ty };
  };
})();
