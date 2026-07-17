const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/dungeon.js');

const WALKABLE = (t) => t === D.TILE.FLOOR || t === D.TILE.ENTRY || t === D.TILE.STAIRS_DOWN;

function bfsReachable(grid, sx, sy) {
  const h = grid.length;
  const w = grid[0].length;
  const seen = Array.from({ length: h }, () => new Array(w).fill(false));
  const q = [[sx, sy]];
  seen[sy][sx] = true;
  let count = 0;
  while (q.length) {
    const [x, y] = q.shift();
    count++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (seen[ny][nx] || !WALKABLE(grid[ny][nx])) continue;
      seen[ny][nx] = true;
      q.push([nx, ny]);
    }
  }
  return { seen, count };
}

test('generateDungeon produces a bordered grid of expected size', () => {
  const d = D.generateDungeon(1, 1);
  assert.equal(d.grid.length, d.height);
  assert.equal(d.grid[0].length, d.width);
  for (let x = 0; x < d.width; x++) {
    assert.equal(d.grid[0][x], D.TILE.WALL, 'top border sealed');
    assert.equal(d.grid[d.height - 1][x], D.TILE.WALL, 'bottom border sealed');
  }
  for (let y = 0; y < d.height; y++) {
    assert.equal(d.grid[y][0], D.TILE.WALL, 'left border sealed');
    assert.equal(d.grid[y][d.width - 1], D.TILE.WALL, 'right border sealed');
  }
});

test('generateDungeon is deterministic for the same seed and floor', () => {
  const a = D.generateDungeon(77, 3);
  const b = D.generateDungeon(77, 3);
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(a.spawns, b.spawns);
  const c = D.generateDungeon(78, 3);
  assert.notDeepEqual(a.grid, c.grid);
});

test('dungeon has exactly one entry and one stairs-down, both placed apart', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = D.generateDungeon(seed, 1);
    let entries = 0;
    let stairs = 0;
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (d.grid[y][x] === D.TILE.ENTRY) entries++;
        if (d.grid[y][x] === D.TILE.STAIRS_DOWN) stairs++;
      }
    }
    assert.equal(entries, 1, `seed ${seed}: one entry`);
    assert.equal(stairs, 1, `seed ${seed}: one stairs`);
    assert.equal(d.grid[d.entry.y][d.entry.x], D.TILE.ENTRY);
    assert.equal(d.grid[d.stairs.y][d.stairs.x], D.TILE.STAIRS_DOWN);
    const far = Math.hypot(d.stairs.x - d.entry.x, d.stairs.y - d.entry.y);
    assert.ok(far > 10, `seed ${seed}: stairs far from entry (was ${far.toFixed(1)})`);
  }
});

test('every walkable tile is reachable from the entry (fully connected)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const d = D.generateDungeon(seed, 2);
    const { seen } = bfsReachable(d.grid, d.entry.x, d.entry.y);
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (WALKABLE(d.grid[y][x])) {
          assert.ok(seen[y][x], `seed ${seed}: orphan walkable tile at ${x},${y}`);
        }
      }
    }
  }
});

test('dungeon has a reasonable number of rooms', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = D.generateDungeon(seed, 1);
    assert.ok(d.rooms.length >= 6, `seed ${seed}: got ${d.rooms.length} rooms`);
  }
});

test('monster spawns sit on walkable tiles away from the entry', () => {
  for (const seed of [1, 2, 3]) {
    for (const floor of [1, 4]) {
      const d = D.generateDungeon(seed, floor);
      assert.ok(d.spawns.length > 0, 'has spawns');
      for (const s of d.spawns) {
        assert.ok(WALKABLE(d.grid[s.y][s.x]), `spawn on walkable at ${s.x},${s.y}`);
        const dist = Math.hypot(s.x - d.entry.x, s.y - d.entry.y);
        assert.ok(dist > 5, `spawn too close to entry (${dist.toFixed(1)})`);
        assert.ok(typeof s.type === 'string');
        assert.equal(typeof s.champion, 'boolean');
      }
    }
  }
});

test('floors 3+ always include at least one champion spawn', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const floor of [3, 5, 8]) {
      const d = D.generateDungeon(seed, floor);
      const champs = d.spawns.filter((s) => s.champion);
      assert.ok(champs.length >= 1, `seed ${seed} floor ${floor}: no champion`);
    }
  }
});

test('deeper floors spawn more monsters on average', () => {
  let shallow = 0;
  let deep = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    shallow += D.generateDungeon(seed, 1).spawns.length;
    deep += D.generateDungeon(seed, 7).spawns.length;
  }
  assert.ok(deep > shallow, `deep=${deep} shallow=${shallow}`);
});

test('flowField measures BFS distance toward a target', () => {
  const d = D.generateDungeon(11, 1);
  const field = D.flowField(d.grid, d.entry.x, d.entry.y, 40);
  assert.equal(field[d.entry.y][d.entry.x], 0);
  let checked = 0;
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const v = field[y][x];
      if (!WALKABLE(d.grid[y][x])) {
        assert.equal(v, Infinity, `wall at ${x},${y} must be Infinity`);
        continue;
      }
      if (v === 0 || v === Infinity) continue;
      // Every reached tile must have a strictly closer 4-neighbor (gradient descent works)
      const best = Math.min(
        field[y - 1] ? field[y - 1][x] : Infinity,
        field[y + 1] ? field[y + 1][x] : Infinity,
        field[y][x - 1] !== undefined ? field[y][x - 1] : Infinity,
        field[y][x + 1] !== undefined ? field[y][x + 1] : Infinity
      );
      assert.equal(best, v - 1, `tile ${x},${y} dist ${v} lacks a closer neighbor`);
      checked++;
    }
  }
  assert.ok(checked > 50, 'field covered a meaningful area');
});

test('flowField respects the maxDist cap', () => {
  const d = D.generateDungeon(11, 1);
  const field = D.flowField(d.grid, d.entry.x, d.entry.y, 6);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const v = field[y][x];
      assert.ok(v === Infinity || v <= 6, `dist ${v} exceeds cap`);
    }
  }
});
