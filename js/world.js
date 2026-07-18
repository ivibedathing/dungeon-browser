// world.js — the overworld: a bounded 2048x2048-tile continent generated chunk by
// chunk. Pure and node-testable like dungeon.js; it produces terrain and the
// deterministic rolls (roads, biomes, rings) that everything else reads.
//
// The load-bearing rule, and the one the tests pin hardest: TERRAIN IS A PURE
// FUNCTION OF WORLD COORDINATES, NOT OF CHUNK INDEX. Anything that crosses a
// chunk boundary — coastlines, cliff ridges, biome edges — is sampled from
// U.fbm2 over world tile coords, so two chunks generated in different orders
// still agree on the tile they share. A per-chunk mulberry32 is used ONLY for
// point features that fit inside one chunk (prop scatter, spawn tiles, POI
// placement). Getting that backwards is the classic chunked-world seam bug.
(function () {
  const U = typeof require === 'function' ? require('./util.js') : window.U;
  const D = typeof require === 'function' ? require('./dungeon.js') : window.Dungeon;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;
  const Entities = typeof require === 'function' ? require('./entities.js') : window.Entities;
  const Props = typeof require === 'function' ? require('./props.js') : window.Props;

  const World = {};

  World.CHUNK = 64;
  World.CHUNKS = 32;
  World.SIZE = World.CHUNK * World.CHUNKS; // 2048 tiles = 65,536 px on a side

  // Ashfall Camp sits at the middle chunk; every ring and every road is measured
  // from here, so "distance from home" is the game's one difficulty axis.
  World.TOWN_CX = World.CHUNKS >> 1;
  World.TOWN_CY = World.CHUNKS >> 1;

  // Noise salts. Distinct constants so elevation, moisture, and the border jitter
  // are independent fields rather than scaled copies of one another.
  const S_ELEV = 0x1a2b3c;
  const S_MOIST = 0x5d6e7f;
  const S_EDGE = 0x2f8a11;
  const S_ROAD = 0x70ad51;

  // Feature size, in tiles per noise lattice unit. Elevation is the coarser of
  // the two so a biome band is wider than the lakes and ridges inside it.
  const ELEV_SCALE = 120;
  const MOIST_SCALE = 190;

  // Terrain thresholds, applied to the contrast-stretched elevation below. These
  // are placed on measured quantiles of the field rather than guessed: they cut
  // the world at roughly 15% water / 18% cliff / 67% walkable, before the border
  // bands add their coastline and mountain wall on top.
  const WATER_LEVEL = 0.27;
  const CLIFF_LEVEL = 0.70;

  // The world is bounded by terrain, not by an invisible box: cliffs walling the
  // north and east, open water off the south and west. BAND is where the push
  // begins, HARD is the outermost ring that is forced impassable no matter what
  // the noise says.
  const BAND = 26;
  const HARD = 4;

  World.chunkKey = (cx, cy) => cy * World.CHUNKS + cx;
  World.chunkOf = (tileX, tileY) => ({ cx: Math.floor(tileX / World.CHUNK), cy: Math.floor(tileY / World.CHUNK) });
  World.chunkCenter = (cx, cy) => ({ x: cx * World.CHUNK + (World.CHUNK >> 1), y: cy * World.CHUNK + (World.CHUNK >> 1) });
  World.inBounds = (cx, cy) => cx >= 0 && cy >= 0 && cx < World.CHUNKS && cy < World.CHUNKS;

  // Chebyshev chunk distance from the town chunk: 0 at home, 16 at the far corner.
  // This is the difficulty dial — Balance.world maps it to an effective floor.
  World.ringOf = (cx, cy) => Math.max(Math.abs(cx - World.TOWN_CX), Math.abs(cy - World.TOWN_CY));

  // ---- Raw fields ----

  // Contrast-stretched so the fbm's clustering around 0.5 doesn't collapse the
  // world into one endless plain. Pure in (seed, x, y).
  World.elevationAt = function (seed, x, y) {
    const raw = U.fbm2((seed ^ S_ELEV) | 0, x / ELEV_SCALE, y / ELEV_SCALE, 5);
    return U.clamp((raw - 0.5) * 1.6 + 0.5, 0, 1);
  };

  World.moistureAt = function (seed, x, y) {
    const raw = U.fbm2((seed ^ S_MOIST) | 0, x / MOIST_SCALE, y / MOIST_SCALE, 4);
    return U.clamp((raw - 0.5) * 1.6 + 0.5, 0, 1);
  };

  // How hard the border bands push this tile, and which way. Returns a signed
  // number: positive shoves elevation up toward CLIFF (north/east), negative down
  // toward WATER (south/west). The two sides compete rather than summing, so a
  // corner resolves to whichever wall is nearer instead of cancelling out.
  function borderPush(seed, x, y) {
    const S = World.SIZE;
    // A little noise on the distance keeps the coastline and the ridge line
    // ragged rather than reading as a rectangle drawn around the map.
    const jitter = (U.noise2((seed ^ S_EDGE) | 0, x / 34, y / 34) - 0.5) * 14;
    const dN = y + jitter;
    const dE = S - 1 - x + jitter;
    const dS = S - 1 - y + jitter;
    const dW = x + jitter;
    const cliffF = Math.max(U.clamp(1 - dN / BAND, 0, 1), U.clamp(1 - dE / BAND, 0, 1));
    const waterF = Math.max(U.clamp(1 - dS / BAND, 0, 1), U.clamp(1 - dW / BAND, 0, 1));
    if (cliffF <= 0 && waterF <= 0) return 0;
    return cliffF >= waterF ? cliffF * 0.6 : -waterF * 0.6;
  }
  World._borderPush = borderPush;

  // The terrain kind of a single world tile, before roads and town are stamped
  // over it. This is THE function that must never depend on chunk index.
  World.baseTileAt = function (seed, x, y) {
    const S = World.SIZE;
    // The hard clamp: the outermost ring is impassable on all four sides, so the
    // player is stopped by a mountain or a shore rather than by a wall of nothing.
    if (y < HARD || x >= S - HARD) return D.TILE.CLIFF;
    if (y >= S - HARD || x < HARD) return D.TILE.WATER;
    const e = U.clamp(World.elevationAt(seed, x, y) + borderPush(seed, x, y), 0, 1);
    if (e < WATER_LEVEL) return D.TILE.WATER;
    if (e > CLIFF_LEVEL) return D.TILE.CLIFF;
    return D.TILE.FLOOR;
  };

  // ---- Biomes ----
  // Shaped like D.THEMES (so the renderer and the fade banner read them the same
  // way) plus the three colours only the overworld needs.
  World.BIOMES = [
    {
      name: 'Ashen Plains',
      wall: '#4a4438', wallEdge: '#2b2720', floorA: '#6b6450', floorB: '#635c49', torch: '#ffc26e', fog: '#0e0c09',
      grass: '#6b6450', water: '#2f4a58', cliff: '#4a4438', road: '#7d745c',
    },
    {
      name: 'Thornwood',
      wall: '#2c3f2c', wallEdge: '#182417', floorA: '#3e5a3a', floorB: '#375233', torch: '#9fe08a', fog: '#0a1009',
      grass: '#3e5a3a', water: '#27444a', cliff: '#2c3f2c', road: '#6a6a48',
    },
    {
      name: 'Marshfen',
      wall: '#2e3a3a', wallEdge: '#192323', floorA: '#425049', floorB: '#3b4842', torch: '#8fe8c0', fog: '#080f0e',
      grass: '#425049', water: '#2a4442', cliff: '#2e3a3a', road: '#5f6350',
    },
    {
      name: 'Bone Barrens',
      wall: '#4a4340', wallEdge: '#2a2624', floorA: '#736a5e', floorB: '#6b6256', torch: '#ffe0a8', fog: '#100d0a',
      grass: '#736a5e', water: '#3a4a52', cliff: '#4a4340', road: '#877c68',
    },
    {
      name: 'Frostcrag Highlands',
      wall: '#3a4658', wallEdge: '#212a38', floorA: '#5d6a7d', floorB: '#556174', torch: '#a8dfff', fog: '#090e16',
      grass: '#5d6a7d', water: '#2e4a66', cliff: '#3a4658', road: '#6e7a8c',
    },
    {
      name: 'Emberwaste',
      wall: '#4d3228', wallEdge: '#2b1a14', floorA: '#7a4f3a', floorB: '#714833', torch: '#ff8a4d', fog: '#130805',
      grass: '#7a4f3a', water: '#3f3a3a', cliff: '#4d3228', road: '#8a6247',
    },
  ];

  // Which biome a world tile belongs to. Derived from the same elevation and
  // moisture fields as the terrain, so a coastline sits in a wet biome and a
  // ridge sits in a cold one without any extra bookkeeping.
  World.biomeIndexAt = function (seed, x, y) {
    const e = World.elevationAt(seed, x, y);
    const m = World.moistureAt(seed, x, y);
    // Elevation claims the two extremes; the broad middle is split four ways by
    // moisture. Cuts sit on measured quantiles so all six biomes get real area.
    if (e > 0.72) return 4; // Frostcrag Highlands — the cold tops
    if (e < 0.30) return 2; // Marshfen — the wet lowlands, hugging the water
    if (m < 0.39) return 5; // Emberwaste
    if (m < 0.53) return 3; // Bone Barrens
    if (m < 0.66) return 0; // Ashen Plains
    return 1; // Thornwood
  };

  World.biomeAt = (seed, x, y) => World.BIOMES[World.biomeIndexAt(seed, x, y)];

  // ---- Roads ----
  // Connectivity is guaranteed by construction, not by a flood fill: a lazily
  // generated world can never run a global reachability check, and noise-carved
  // cliffs and lakes WILL strand regions. Every chunk is a node in a spanning
  // tree rooted at the town chunk and carves a road toward its parent, bridging
  // water and cutting a pass through cliff. The tree is a pure function of
  // (seed, cx, cy), so a chunk can carve its own link knowing nothing about its
  // neighbours — and every point on the tree reaches town on foot.

  World.parentOf = function (seed, cx, cy) {
    const dx = Math.sign(World.TOWN_CX - cx);
    const dy = Math.sign(World.TOWN_CY - cy);
    if (!dx && !dy) return null; // the town chunk is the root
    if (!dx) return { cx, cy: cy + dy };
    if (!dy) return { cx: cx + dx, cy };
    // Both axes are open: the hash picks one, which is what gives the road network
    // its irregular, branching look instead of two straight spokes.
    return U.hash2((seed ^ S_ROAD) | 0, cx, cy) % 2 === 0 ? { cx: cx + dx, cy } : { cx, cy: cy + dy };
  };

  const ROAD_HALF = 1; // 3 tiles wide

  // Paint the straight run between two chunk centres, clipped to [x0,x1]x[y0,y1].
  // Parent chunks are always orthogonally adjacent, so this is one axis-aligned
  // segment. Roads overwrite water and cliff — that IS the bridge and the pass.
  function carveSegment(world, ax, ay, bx, by, x0, y0, x1, y1) {
    const grid = world.grid;
    const S = World.SIZE;
    const lo = (v, w) => Math.min(v, w);
    const hi = (v, w) => Math.max(v, w);
    if (ay === by) {
      for (let x = lo(ax, bx); x <= hi(ax, bx); x++) {
        for (let y = ay - ROAD_HALF; y <= ay + ROAD_HALF; y++) {
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (x < HARD || y < HARD || x >= S - HARD || y >= S - HARD) continue;
          grid[y][x] = D.TILE.ROAD;
        }
      }
    } else {
      for (let y = lo(ay, by); y <= hi(ay, by); y++) {
        for (let x = ax - ROAD_HALF; x <= ax + ROAD_HALF; x++) {
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (x < HARD || y < HARD || x >= S - HARD || y >= S - HARD) continue;
          grid[y][x] = D.TILE.ROAD;
        }
      }
    }
  }

  // ---- Generation ----

  World.create = function (worldSeed) {
    // 2048 rows of Uint8Array(2048) is ~4.2 MB — cheap enough to just pay up
    // front, and it means grid[y][x] keeps working verbatim in G.moveCircle, the
    // flow field, and the whole renderer, with world tile coords as *the*
    // coordinate system. No sliding origin, no offset math, no eviction flicker.
    // Ungenerated tiles read as WALL (0), which is impassable — a safe default.
    return {
      seed: worldSeed >>> 0,
      width: World.SIZE,
      height: World.SIZE,
      grid: Array.from({ length: World.SIZE }, () => new Uint8Array(World.SIZE)),
      gen: new Uint8Array(World.CHUNKS * World.CHUNKS),
    };
  };

  World.isGenerated = (world, cx, cy) => World.inBounds(cx, cy) && !!world.gen[World.chunkKey(cx, cy)];

  // Write one chunk's terrain. Idempotent and bit-identical on a regenerate:
  // every tile comes from baseTileAt, and the roads come from the pure spanning
  // tree. `force` re-runs a chunk that was already written (the regeneration test).
  World.ensureChunk = function (world, cx, cy, force) {
    if (!World.inBounds(cx, cy)) return false;
    const key = World.chunkKey(cx, cy);
    if (world.gen[key] && !force) return false;
    const C = World.CHUNK;
    const x0 = cx * C;
    const y0 = cy * C;
    const x1 = x0 + C - 1;
    const y1 = y0 + C - 1;
    const seed = world.seed;

    for (let y = y0; y <= y1; y++) {
      const row = world.grid[y];
      for (let x = x0; x <= x1; x++) row[x] = World.baseTileAt(seed, x, y);
    }

    // Roads: this chunk's link to its parent, plus every neighbour's link, clipped
    // to our own tiles. A neighbour's segment can only ever reach one chunk beyond
    // itself, so the 3x3 block around us covers every road that touches our tiles
    // — and carving them here means a chunk written later never erases a road a
    // chunk written earlier already put down.
    for (let ny = cy - 1; ny <= cy + 1; ny++) {
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        if (!World.inBounds(nx, ny)) continue;
        const parent = World.parentOf(seed, nx, ny);
        if (!parent) continue;
        const a = World.chunkCenter(nx, ny);
        const b = World.chunkCenter(parent.cx, parent.cy);
        carveSegment(world, a.x, a.y, b.x, b.y, x0, y0, x1, y1);
      }
    }

    if (World.onChunk) World.onChunk(world, cx, cy, { x0, y0, x1, y1 });

    world.gen[key] = 1;
    return true;
  };

  // Generate every chunk in a square radius around one, which is what activation
  // and any "look at the map" path actually want.
  World.ensureAround = function (world, cx, cy, radius) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) World.ensureChunk(world, x, y);
    }
  };

  // ---- Population ----
  // Ring drives an EFFECTIVE FLOOR that feeds straight into the dungeon's own
  // E.makeMonster, so hp/dmg/xp scaling, champion rolls, and the minFloor type
  // pool all come along unchanged — there is no second balance curve here, only
  // a mapping from "how far from home" to "how deep this would be".
  World.effectiveFloor = function (ring) {
    const B = Balance.world;
    if (ring <= B.safeRing) return 0;
    return Math.max(1, Math.round(B.floorPerRing * ring));
  };

  // The per-chunk RNG. Used ONLY for point features that fit inside this chunk —
  // never for anything that crosses its border. See the note at the top.
  World.chunkRng = (seed, cx, cy) => U.mulberry32(U.hash2((seed ^ 0x9051) | 0, cx, cy));

  // How much lives here, before any tiles are picked. Pure in (seed, cx, cy), so
  // the server and every client agree on a chunk's budget without talking.
  World.budgetOf = function (seed, cx, cy) {
    const B = Balance.world;
    const ring = World.ringOf(cx, cy);
    const floor = World.effectiveFloor(ring);
    if (!floor) return { ring, floor: 0, count: 0, championChance: 0, boss: false };
    const rng = World.chunkRng(seed, cx, cy);
    const count = Math.min(
      B.densityCap,
      Math.round(B.densityBase + B.densityPerRing * ring) + U.randInt(rng, 0, B.densityJitter)
    );
    const championChance = Math.min(B.championCap, B.championBase + B.championPerRing * ring);
    const boss = ring >= B.bossMinRing && rng() < B.bossChance;
    return { ring, floor, count, championChance, boss };
  };

  // The full content of one chunk: where each monster, prop and brazier stands.
  // Requires the chunk's terrain to be written already (spawn tiles are chosen
  // from it), and is deterministic given the same terrain.
  World.rollChunkContent = function (world, cx, cy) {
    const seed = world.seed;
    const budget = World.budgetOf(seed, cx, cy);
    const out = { ...budget, monsters: [], boss: null, props: [], torches: [] };
    const C = World.CHUNK;
    const x0 = cx * C;
    const y0 = cy * C;
    const grid = world.grid;
    // A second, independent stream from the budget roll, so tuning the density
    // curve doesn't reshuffle where everything stands.
    const rng = U.mulberry32(U.hash2((seed ^ 0x7115) | 0, cx, cy));
    const taken = new Set();

    // Pick a tile inside this chunk passing `ok`, or null after 24 tries.
    const pick = (ok) => {
      for (let t = 0; t < 24; t++) {
        const x = x0 + U.randInt(rng, 1, C - 2);
        const y = y0 + U.randInt(rng, 1, C - 2);
        const k = y * World.SIZE + x;
        if (taken.has(k)) continue;
        if (!ok(x, y)) continue;
        taken.add(k);
        return { x, y };
      }
      return null;
    };
    const walkable = (x, y) => D.isWalkable(grid[y][x]);
    // Props and braziers stay off the roads — a road you cannot walk down
    // without smashing furniture is not a road.
    const openGround = (x, y) => grid[y][x] === D.TILE.FLOOR;

    if (budget.floor) {
      for (let i = 0; i < budget.count; i++) {
        const cell = pick(walkable);
        if (!cell) break;
        out.monsters.push({
          x: cell.x,
          y: cell.y,
          type: Entities.pickMonsterType(rng, budget.floor),
          champion: rng() < budget.championChance,
        });
      }
      if (budget.boss) {
        const cell = pick(walkable);
        if (cell) out.boss = { x: cell.x, y: cell.y };
      }
    }

    const P = Balance.world.propsPerChunk;
    const nProps = U.randInt(rng, P.min, P.max);
    for (let i = 0; i < nProps; i++) {
      const cell = pick(openGround);
      if (!cell) break;
      out.props.push({ x: cell.x, y: cell.y, type: Props.pickType(rng, Math.max(1, budget.floor)) });
    }

    // A roadside brazier: found by looking for open ground beside a road, so the
    // light marks the route rather than landing in empty wilderness.
    if (rng() < Balance.world.torchChance) {
      const cell = pick((x, y) => {
        if (grid[y][x] !== D.TILE.FLOOR) return false;
        return (
          grid[y][x + 1] === D.TILE.ROAD ||
          grid[y][x - 1] === D.TILE.ROAD ||
          (grid[y + 1] && grid[y + 1][x] === D.TILE.ROAD) ||
          (grid[y - 1] && grid[y - 1][x] === D.TILE.ROAD)
        );
      });
      if (cell) out.torches.push({ x: cell.x, y: cell.y });
    }

    return out;
  };

  if (typeof window !== 'undefined') window.World = World;
  if (typeof module !== 'undefined') module.exports = World;
})();
