// The overworld's generation contract. The chunked-world failure mode is
// terrain that disagrees with itself across a chunk border depending on which
// chunk happened to generate first, so the seam and determinism tests here are
// the load-bearing ones — everything else in the world leans on them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const World = require('../js/world.js');
const D = require('../js/dungeon.js');

const SEED = 20260718;

// Generate a square block of chunks and hand back the world.
function blockAround(cx, cy, radius, seed) {
  const w = World.create(seed === undefined ? SEED : seed);
  World.ensureAround(w, cx, cy, radius);
  return w;
}

test('the world is 32x32 chunks of 64 tiles and allocates the whole grid up front', () => {
  const w = World.create(SEED);
  assert.equal(World.CHUNK, 64);
  assert.equal(World.CHUNKS, 32);
  assert.equal(World.SIZE, 2048);
  assert.equal(w.grid.length, 2048);
  assert.equal(w.grid[0].length, 2048);
  assert.equal(w.gen.length, 1024);
  // Nothing is generated yet, and ungenerated ground is impassable rather than
  // an invisible walkable void.
  assert.equal(w.gen[World.chunkKey(0, 0)], 0);
  assert.equal(D.isWalkable(w.grid[100][100]), false);
});

test('regenerating a chunk is bit-identical', () => {
  const w = World.create(SEED);
  World.ensureChunk(w, 7, 21);
  const before = [];
  for (let y = 21 * 64; y < 22 * 64; y++) before.push(Uint8Array.from(w.grid[y].subarray(7 * 64, 8 * 64)));
  World.ensureChunk(w, 7, 21, true); // force a rewrite
  for (let y = 21 * 64; y < 22 * 64; y++) {
    assert.deepEqual(Uint8Array.from(w.grid[y].subarray(7 * 64, 8 * 64)), before[y - 21 * 64], `row ${y} changed`);
  }
});

test('two adjacent chunks agree on their shared border in either generation order', () => {
  // This is the test the whole "sample by world coordinate, never by chunk
  // index" rule exists to satisfy.
  for (const [ax, ay, bx, by] of [[10, 10, 11, 10], [10, 10, 10, 11], [3, 28, 3, 29]]) {
    const first = World.create(SEED);
    World.ensureChunk(first, ax, ay);
    World.ensureChunk(first, bx, by);
    const second = World.create(SEED);
    World.ensureChunk(second, bx, by);
    World.ensureChunk(second, ax, ay);
    const x0 = Math.min(ax, bx) * 64;
    const y0 = Math.min(ay, by) * 64;
    for (let y = y0; y < y0 + 128 && y < World.SIZE; y++) {
      for (let x = x0; x < x0 + 128 && x < World.SIZE; x++) {
        assert.equal(first.grid[y][x], second.grid[y][x], `order-dependent tile at ${x},${y}`);
      }
    }
  }
});

test('terrain is a pure function of world coordinates, not of chunk index', () => {
  // The same tile sampled directly must equal the tile its chunk wrote — with no
  // chunk ever having been generated to prime it.
  const w = World.create(SEED);
  World.ensureChunk(w, 5, 9);
  for (const [x, y] of [[5 * 64, 9 * 64], [5 * 64 + 63, 9 * 64 + 63], [5 * 64 + 30, 9 * 64 + 17]]) {
    const base = World.baseTileAt(SEED, x, y);
    const written = w.grid[y][x];
    // Roads are stamped over the base terrain, so a road tile is the one allowed
    // difference; everything else must match exactly.
    assert.ok(written === base || written === D.TILE.ROAD, `tile ${x},${y}: wrote ${written}, base says ${base}`);
  }
});

test('the border bands wall the world: cliff north and east, water south and west', () => {
  const S = World.SIZE;
  // Sampled clear of the corners, where the two bands overlap and one has to win.
  for (const y of [400, 1000, 1600]) {
    assert.equal(World.baseTileAt(SEED, 1, y), D.TILE.WATER, `west edge at y=${y}`);
    assert.equal(World.baseTileAt(SEED, S - 2, y), D.TILE.CLIFF, `east edge at y=${y}`);
  }
  for (const x of [400, 1000, 1600]) {
    assert.equal(World.baseTileAt(SEED, x, 1), D.TILE.CLIFF, `north edge at x=${x}`);
    assert.equal(World.baseTileAt(SEED, x, S - 2), D.TILE.WATER, `south edge at x=${x}`);
  }
});

test('the corners resolve to one wall or the other, never to a gap', () => {
  // Where a cliff band meets a water band the two must not cancel out and leave
  // walkable ground — that would be a hole in the edge of the world. The rule is
  // that the nearer wall wins outright, with north/east taking the tie.
  const S = World.SIZE;
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2], [3, 5], [S - 4, S - 6]]) {
    const t = World.baseTileAt(SEED, x, y);
    assert.ok(t === D.TILE.CLIFF || t === D.TILE.WATER, `corner ${x},${y} resolved to ${t}`);
    assert.equal(D.isWalkable(t), false, `corner ${x},${y} is walkable`);
  }
});

test('the outer ring is impassable on all four sides', () => {
  const S = World.SIZE;
  let walkable = 0;
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) {
      if (D.isWalkable(World.baseTileAt(SEED, x, y))) walkable++;
    }
  }
  assert.equal(walkable, 0, 'the player must be stopped by terrain, never by an invisible box');
});

test('the terrain mix leaves the continent mostly walkable', () => {
  const w = blockAround(16, 16, 3);
  const count = {};
  for (let y = 13 * 64; y < 20 * 64; y++) {
    for (let x = 13 * 64; x < 20 * 64; x++) count[w.grid[y][x]] = (count[w.grid[y][x]] || 0) + 1;
  }
  const total = 7 * 64 * 7 * 64;
  const frac = (t) => (count[t] || 0) / total;
  // A world that is mostly cliff is a maze, not a continent; one with no water or
  // cliff at all is a featureless plain. Both are generation bugs.
  assert.ok(frac(D.TILE.FLOOR) > 0.5, `walkable floor ${frac(D.TILE.FLOOR)} too low`);
  assert.ok(frac(D.TILE.WATER) > 0.02 && frac(D.TILE.WATER) < 0.3, `water ${frac(D.TILE.WATER)}`);
  assert.ok(frac(D.TILE.CLIFF) > 0.05 && frac(D.TILE.CLIFF) < 0.35, `cliff ${frac(D.TILE.CLIFF)}`);
  assert.ok(frac(D.TILE.ROAD) > 0.01, `road ${frac(D.TILE.ROAD)} — the network is missing`);
});

// ---- Roads and connectivity ----

test('the road spanning tree reaches town from every chunk', () => {
  // Connectivity is guaranteed by construction, so it is provable without
  // generating (or flood-filling) the whole 4.2M-tile world: every chunk's
  // parent chain must terminate at the town chunk.
  for (let cy = 0; cy < World.CHUNKS; cy++) {
    for (let cx = 0; cx < World.CHUNKS; cx++) {
      let node = { cx, cy };
      let steps = 0;
      while (node && steps <= World.CHUNKS * 2) {
        const parent = World.parentOf(SEED, node.cx, node.cy);
        if (!parent) break;
        assert.ok(World.inBounds(parent.cx, parent.cy), `parent of ${cx},${cy} left the map`);
        // Each hop must be one orthogonal step that strictly closes the distance,
        // or the "tree" has a cycle and nothing reaches home.
        const step = Math.abs(parent.cx - node.cx) + Math.abs(parent.cy - node.cy);
        assert.equal(step, 1, `parent hop from ${node.cx},${node.cy} is not one step`);
        assert.ok(
          World.ringOf(parent.cx, parent.cy) <= World.ringOf(node.cx, node.cy),
          `hop from ${node.cx},${node.cy} moved away from town`
        );
        node = parent;
        steps++;
      }
      assert.ok(steps <= World.CHUNKS * 2, `chunk ${cx},${cy} never reached town`);
      assert.equal(node.cx, World.TOWN_CX);
      assert.equal(node.cy, World.TOWN_CY);
    }
  }
});

test('a flow field from town walks the roads to every chunk centre around it', () => {
  // The structural test above proves the tree; this proves the carve — that the
  // roads are actually walkable tiles joined end to end across chunk borders.
  const R = 3;
  const w = blockAround(World.TOWN_CX, World.TOWN_CY, R);
  const town = World.chunkCenter(World.TOWN_CX, World.TOWN_CY);
  assert.ok(D.isWalkable(w.grid[town.y][town.x]), 'the town chunk centre must be standable');
  const rect = {
    x0: (World.TOWN_CX - R) * 64,
    y0: (World.TOWN_CY - R) * 64,
    x1: (World.TOWN_CX + R + 1) * 64 - 1,
    y1: (World.TOWN_CY + R + 1) * 64 - 1,
  };
  const flow = D.flowFieldWindow(w.grid, [town], 100000, rect);
  const unreached = [];
  for (let cy = World.TOWN_CY - R; cy <= World.TOWN_CY + R; cy++) {
    for (let cx = World.TOWN_CX - R; cx <= World.TOWN_CX + R; cx++) {
      const c = World.chunkCenter(cx, cy);
      if (D.flowAt(flow, c.x, c.y) === Infinity) unreached.push(`${cx},${cy}`);
    }
  }
  assert.deepEqual(unreached, [], `chunk centres stranded from town: ${unreached.join(' ')}`);
});

test('roads bridge water and cut passes through cliff', () => {
  const w = blockAround(16, 16, 2);
  let bridged = 0;
  let cut = 0;
  for (let y = 14 * 64; y < 19 * 64; y++) {
    for (let x = 14 * 64; x < 19 * 64; x++) {
      if (w.grid[y][x] !== D.TILE.ROAD) continue;
      const base = World.baseTileAt(SEED, x, y);
      if (base === D.TILE.WATER) bridged++;
      if (base === D.TILE.CLIFF) cut++;
    }
  }
  assert.ok(bridged + cut > 0, 'roads never crossed hostile terrain — connectivity is untested by luck');
  for (let y = 14 * 64; y < 19 * 64; y++) {
    for (let x = 14 * 64; x < 19 * 64; x++) {
      if (w.grid[y][x] === D.TILE.ROAD) assert.ok(D.isWalkable(w.grid[y][x]), 'roads must be walkable');
    }
  }
});

// ---- Rings and biomes ----

test('ringOf is Chebyshev chunk distance from the town chunk', () => {
  assert.equal(World.ringOf(World.TOWN_CX, World.TOWN_CY), 0);
  assert.equal(World.ringOf(World.TOWN_CX + 1, World.TOWN_CY), 1);
  assert.equal(World.ringOf(World.TOWN_CX - 1, World.TOWN_CY + 1), 1);
  assert.equal(World.ringOf(World.TOWN_CX + 3, World.TOWN_CY - 5), 5);
  assert.equal(World.ringOf(0, 0), 16);
  assert.equal(World.ringOf(31, 31), 15);
});

test('every biome claims real area and carries the palette the renderer needs', () => {
  assert.equal(World.BIOMES.length, 6);
  for (const b of World.BIOMES) {
    for (const key of ['name', 'wall', 'wallEdge', 'floorA', 'floorB', 'torch', 'fog', 'grass', 'water', 'cliff', 'road']) {
      assert.ok(b[key], `biome ${b.name} is missing ${key}`);
    }
  }
  const seen = new Map();
  const N = 12000;
  for (let i = 0; i < N; i++) {
    const x = (i * 137) % World.SIZE;
    const y = (i * 263) % World.SIZE;
    const idx = World.biomeIndexAt(SEED, x, y);
    seen.set(idx, (seen.get(idx) || 0) + 1);
  }
  assert.equal(seen.size, 6, 'some biome never appears anywhere in the world');
  for (const [idx, n] of seen) {
    assert.ok(n / N > 0.05, `${World.BIOMES[idx].name} covers only ${((100 * n) / N).toFixed(1)}% of the world`);
  }
});

test('biomeAt is deterministic and seed-dependent', () => {
  assert.equal(World.biomeIndexAt(SEED, 900, 1200), World.biomeIndexAt(SEED, 900, 1200));
  let differs = 0;
  for (let i = 0; i < 500; i++) {
    const x = (i * 331) % World.SIZE;
    const y = (i * 577) % World.SIZE;
    if (World.biomeIndexAt(SEED, x, y) !== World.biomeIndexAt(SEED + 1, x, y)) differs++;
  }
  assert.ok(differs > 100, 'a different world seed must produce a different map');
});
