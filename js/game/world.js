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
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
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
    if (!w.killed) w.killed = {}; // a world restored by an older save has none
    const content = World.rollChunkContent(w.world, cx, cy);
    const partyN = state.partyN || (state.players && state.players.length) || 1;

    // A chunk you half-cleared stays half-cleared. `killed` counts how many of
    // this chunk's deterministic roll are already dead; without it, killing seven
    // of eight and stepping over a chunk border and back restocked all eight,
    // which is an unlimited XP and loot pump.
    const dead = w.killed[k] || 0;
    if (!w.cleared[k]) {
      for (let i = dead; i < content.monsters.length; i++) {
        const sp = content.monsters[i];
        state.monsters.push(G.spawnWorldMonster(state, Entities.makeMonster(sp.type, content.floor, sp.champion, partyN), sp, k));
      }
      if (content.boss) {
        const boss = G.spawnWorldMonster(state, Entities.makeBoss(content.floor, partyN), content.boss, k);
        // A world boss holds its ground rather than roaming: it is a landmark,
        // and one that wanders is one you cannot pin on a map.
        boss.worldBoss = true;
        boss.leash = 6;
        state.monsters.push(boss);
        // Merge, never overwrite: `seen` and `slain` are player history that the
        // save persists, and this runs again every time the chunk re-activates.
        w.bosses = w.bosses || {};
        const prev = w.bosses[k] || {};
        w.bosses[k] = {
          x: content.boss.x,
          y: content.boss.y,
          name: boss.name,
          seen: !!prev.seen,
          slain: !!prev.slain,
        };
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
  };

  // A resident died. When the last one in a chunk falls the chunk counts as
  // cleared and stops restocking until respawnSeconds have passed — so a cleared
  // stretch of country stays cleared while you loot it, and is dangerous again
  // by the time you come back through.
  G.worldMonsterKilled = function worldMonsterKilled(state, m) {
    const w = state.world;
    if (!w || m.chunk === undefined) return;
    if (m.worldBoss && w.bosses && w.bosses[m.chunk]) w.bosses[m.chunk].slain = true;
    if (!m.worldBoss) w.killed[m.chunk] = (w.killed[m.chunk] || 0) + 1;
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
    // Loot left on the ground goes with its chunk. On a dungeon floor the drop
    // pile is bounded by the floor; out here it is bounded by nothing, and a
    // long roam leaves thousands of items scattered across the continent that
    // are iterated (and array-copied) every frame by the gold magnet and the
    // renderer. Walk away from your loot and you have left it behind.
    if (state.groundItems) state.groundItems = state.groundItems.filter((g) => g.chunk !== k);
  };

  // Tag a dropped item with the chunk it fell in, so deactivation can reclaim it.
  // Called from the drop paths; a no-op anywhere but the overworld.
  G.tagWorldDrop = function tagWorldDrop(state, item) {
    if (!state.inWorld || !state.world) return item;
    const c = World.chunkOf(Math.floor(item.x / TS), Math.floor(item.y / TS));
    if (World.inBounds(c.cx, c.cy)) item.chunk = World.chunkKey(c.cx, c.cy);
    return item;
  };

  // One frame of world upkeep: move the activation set, keep the terrain ahead of
  // the player written, and let cleared chunks come back after their cooldown.
  G.worldUpdate = function worldUpdate(state, dt) {
    const w = state.world;
    if (!w) return;

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

    G.discoverPOIs(state);

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

    // Cleared chunks come back once their timer is up — but ONLY while they are
    // out of the live set. Deactivating a live chunk here would take the player's
    // dropped loot with it (drops are chunk-tagged) and then respawn a full
    // population on top of them a frame later. A chunk that comes due while you
    // are standing in it simply stays empty until you leave and return.
    const rs = w.respawn;
    for (const k of Object.keys(rs)) {
      if (rs[k] > state.time) continue;
      if (want.has(Number(k))) continue;
      delete rs[k];
      w.cleared[k] = false;
      delete w.killed[k];
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
      visited: {}, // chunks the party has stood in — what the map is drawn from
      pois: {}, // discovery record: which mouths are found, which waystones woken
      bosses: {}, // world bosses laid eyes on, and whether they still stand
      cleared: {},
      killed: {}, // chunkKey -> how many of that chunk's roll are already dead
      respawn: {},
    };
    state.world.world = world;
    // The entity lists are reset below, so the live set has to reset with them —
    // keeping it would leave chunks flagged active whose contents no longer
    // exist, and activation would never rebuild them.
    state.world.active = new Set();
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

    // Grizzle's stock and the notice board are camp furniture; they refresh on
    // arrival out here exactly as they did on every trip through the portal.
    state.shop = G.rollWorldShop(state);
    state.board = Quests.rollBoard(Math.max(1, state.floor), state.srand, state.quests);

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

  // ---- Places ----

  // Grizzle's three-slot stock. Priced off the deepest floor the run has
  // reached, so the stall keeps pace with the hero rather than with wherever
  // they happen to be standing on the map.
  G.rollWorldShop = function rollWorldShop(state) {
    const stock = [];
    for (let i = 0; i < 3; i++) {
      const item = Items.makeItem(Math.max(1, state.floor), state.srand, { guaranteeMagic: i === 2 });
      stock.push({ item, price: Items.buyPrice(item) });
    }
    return stock;
  };

  // Discover the POIs the party is standing near. A mouth only has to be seen to
  // be remembered; a waystone has to be touched to be unlocked, which is what
  // makes finding one an event rather than a map update.
  G.discoverPOIs = function discoverPOIs(state) {
    const w = state.world;
    const pois = w.world.pois;
    const seePx = state.dungeon.sightTiles * TS;
    const touchPx = 2.2 * TS;
    for (const k of Object.keys(pois)) {
      const poi = pois[k];
      const px = (poi.x + 0.5) * TS;
      const py = (poi.y + 0.5) * TS;
      let nearest = Infinity;
      for (const pl of state.players) {
        if (pl.dead) continue;
        nearest = Math.min(nearest, U.dist2(pl.x, pl.y, px, py));
      }
      if (nearest === Infinity) continue;
      const rec = w.pois[k] || (w.pois[k] = { ...poi, found: false, unlocked: false });
      if (!rec.found && nearest <= seePx * seePx) {
        rec.found = true;
        if (poi.kind === 'mouth') {
          G.message(state, `You find the ${poi.name} — a way down (floor ${poi.floor}).`, '#c66bff');
        } else {
          G.message(state, `A waystone stands here: the ${poi.name}.`, '#7fb8ff');
        }
        G.sfx(state, 'portal');
      }
      if (poi.kind === 'waystone' && !rec.unlocked && nearest <= touchPx * touchPx) {
        rec.unlocked = true;
        G.message(state, `The ${poi.name} wakes to your touch. You may travel here.`, '#7fb8ff');
        G.sfx(state, 'levelup');
        G.burst(state, px, py, '#7fb8ff', 24, 140);
        G.save(state);
      }
    }
  };

  // The mouth standing on a given tile, if any.
  G.mouthAt = function mouthAt(state, tx, ty) {
    const w = state.world;
    if (!w) return null;
    const c = World.chunkOf(tx, ty);
    const poi = w.world.pois[World.chunkKey(c.cx, c.cy)];
    return poi && poi.kind === 'mouth' && poi.x === tx && poi.y === ty ? poi : null;
  };

  G.unlockedWaystones = function unlockedWaystones(state) {
    const w = state.world;
    if (!w || !w.pois) return [];
    return Object.keys(w.pois)
      .map((k) => w.pois[k])
      .filter((p) => p.kind === 'waystone' && p.unlocked)
      .sort((a, b) => a.ring - b.ring || a.x - b.x || a.y - b.y);
  };

  // Step into a hole in the ground. The overworld is stashed whole and dungeon
  // floors churn beneath it — the same single-slot stash the town trip has always
  // used, which still suffices because the world is the OUTER level here and the
  // floors are the inner churn.
  Game.enterMouth = function enterMouth(state, poi) {
    // A mouth remembers how deep you got. Portalling out and climbing back in
    // used to reset you to its base floor, throwing away every descent — the
    // town round-trip it replaced always put you back where you left off.
    const mkey = poi.x + ',' + poi.y;
    state.world.depth = state.world.depth || {};
    const stash = {
      overworld: true,
      dungeon: state.dungeon,
      monsters: state.monsters,
      props: state.props,
      groundItems: state.groundItems,
      explored: state.explored,
      flow: state.flow,
      world: state.world,
      mouth: { x: poi.x, y: poi.y, name: poi.name, key: mkey },
      portalPos: { x: (poi.x + 0.5) * TS, y: (poi.y + 0.5) * TS + TS },
    };
    state.dungeonSeed = poi.dungeonSeed;
    state.floor = Math.max(poi.floor, state.world.depth[mkey] || 0);
    state.mouthKey = mkey;
    state.mapOpen = false;
    state.stash = stash; // makeFloorState keeps an overworld stash across floors
    G.makeFloorState(state);
    state.inWorld = false;
    for (const pl of state.players) Stats.bump(pl, 'floors');
    G.questDepth(state);
    G.message(state, `You climb down into the ${poi.name}. Floor ${state.floor}.`, '#c9b37e');
    G.sfx(state, 'stairs');
    if (typeof Save !== 'undefined') Save.updateRecords(state);
    G.save(state);
    return state;
  };

  // Come back up. Restores the stashed continent and stands the party at the
  // mouth they went down.
  G.leaveMouth = function leaveMouth(state) {
    const st = state.stash;
    if (!st || !st.overworld) return false;
    // Bank the depth reached before the world comes back, so the same hole
    // resumes where you left it.
    if (st.mouth && st.mouth.key && st.world) {
      st.world.depth = st.world.depth || {};
      st.world.depth[st.mouth.key] = Math.max(st.world.depth[st.mouth.key] || 0, state.floor);
    }
    state.dungeon = st.dungeon;
    state.monsters = st.monsters;
    state.props = st.props;
    state.groundItems = st.groundItems;
    state.explored = st.explored;
    state.flow = st.flow;
    state.world = st.world;
    state.projectiles = [];
    state.portals = [];
    state.stash = null;
    state.inWorld = true;
    state.inTown = false;
    state.trading = false;
    state.dungeonSeed = null;
    state.mouthKey = null;
    // A trip underground and back is a trip away from camp: restock the stall
    // and repost the board, the same as returning through the portal used to.
    state.shop = G.rollWorldShop(state);
    state.board = Quests.rollBoard(Math.max(1, state.floor), state.srand, state.quests);
    const spot = st.portalPos;
    const roster = state.players && state.players.length ? state.players : [state.player];
    roster.forEach((pl, i) => {
      const spread = roster.length > 1 ? 16 : 0;
      const a = (i / Math.max(1, roster.length)) * Math.PI * 2;
      pl.x = spot.x + Math.cos(a) * spread;
      pl.y = spot.y + Math.sin(a) * spread;
    });
    state.cam = { x: state.player.x, y: state.player.y };
    state.fade = { t: 0, dur: 1.4, label: st.mouth ? `The ${st.mouth.name}` : 'The open world' };
    G.message(state, 'You climb back into the daylight.', '#c9b37e');
    G.save(state);
    return true;
  };

  // Warp between unlocked waystones. This is a move, not a re-entry: the world,
  // the explored map, and every discovery survive it — only the live chunks are
  // dropped, because the party is somewhere else entirely now.
  Game.useWaystone = function useWaystone(state, target) {
    if (!state.inWorld || !target || !target.unlocked) return false;
    const spot = G.findOpenTile(state.world.world, target.x, target.y + 1);
    for (const k of [...state.world.active]) G.deactivateChunk(state, k);
    const cx = (spot.x + 0.5) * TS;
    const cy = (spot.y + 0.5) * TS;
    const roster = state.players && state.players.length ? state.players : [state.player];
    roster.forEach((pl, i) => {
      const spread = roster.length > 1 ? 16 : 0;
      const a = (i / Math.max(1, roster.length)) * Math.PI * 2;
      pl.x = cx + Math.cos(a) * spread;
      pl.y = cy + Math.sin(a) * spread;
    });
    state.projectiles = [];
    state.flow = { field: null, t: 0 };
    state.mapOpen = false;
    state.cam = { x: state.player.x, y: state.player.y };
    state.fade = { t: 0, dur: 1.4, label: target.name };
    G.message(state, `The waystones carry you to the ${target.name}.`, '#7fb8ff');
    G.sfx(state, 'travel');
    G.burst(state, cx, cy, '#7fb8ff', 26, 150);
    G.save(state);
    return true;
  };

  // A fresh solo run. The hero begins on the road just outside Ashfall Camp,
  // with the whole continent in front of them and the dungeons somewhere in it —
  // holes in the ground you find by walking, rather than a staircase you start
  // on. `Game.newRun` stays the plain run constructor (and the dungeon-floor
  // fixture the sim tests are written against); this is the game's front door.
  Game.newSoloRun = function newSoloRun(seed, opts) {
    const state = Game.newRun(seed, opts);
    const world = World.create(state.worldSeed);
    World.ensureChunk(world, World.TOWN_CX, World.TOWN_CY);
    const camp = World.town(world);
    state.world = {
      world,
      seed: state.worldSeed,
      active: new Set(),
      visited: {},
      pois: {},
      bosses: {},
      cleared: {},
      killed: {}, // chunkKey -> how many of that chunk's roll are already dead
      respawn: {},
    };
    // Just inside the camp's south gate. Placing the hero beyond the plaza edge
    // drops them wherever the terrain happens to be — on some seeds that is the
    // 3-tile road chute through a cliff field, which is a claustrophobic way to
    // open a game about an open world. Inside the plaza is guaranteed clear, and
    // the road out is a few steps south.
    Game.enterWorld(state, { x: camp.entry.x, y: camp.entry.y + 2 });
    state.messages = [];
    state.fade = {
      t: 0,
      dur: 2.4,
      label: 'The Ashen Reach',
      sub: 'Ashfall Camp at its heart, and the dark beneath it',
    };
    G.message(state, 'The road runs out from Ashfall Camp in every direction. (WASD to move, M for your map)');
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
