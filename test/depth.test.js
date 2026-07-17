const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const Items = require('../js/items.js');
globalThis.U = U;
globalThis.Items = Items;
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
const Dungeon = require('../js/dungeon.js');

test('sword variety: more blades unlock with depth', () => {
  const bases = (floor, n) => {
    const rng = U.mulberry32(floor * 7);
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const w = Items.makeItem(floor, rng, { slot: 'weapon', kind: 'melee' });
      seen.add(w.base);
    }
    return seen;
  };
  const deep = bases(9, 600);
  assert.ok(deep.size >= 7, `deep melee variety (got ${[...deep].join(', ')})`);
  for (const blade of ['Falchion', 'Broad Sword', 'Estoc', 'Claymore', 'Runeblade']) {
    assert.ok(deep.has(blade), `${blade} drops deep`);
  }
  const surface = bases(1, 500);
  for (const blade of ['Claymore', 'Runeblade', 'Estoc']) {
    assert.ok(!surface.has(blade), `${blade} must not drop on floor 1`);
  }
  assert.ok(surface.size >= 3, 'floor 1 still has melee variety');
});

test('floors past 10 switch to the deep color schemes', () => {
  const shallowNames = new Set([1, 3, 5, 8, 10].map((f) => Dungeon.themeFor(f).name));
  for (const f of [11, 13, 15, 19, 23]) {
    assert.ok(!shallowNames.has(Dungeon.themeFor(f).name), `floor ${f} uses a deep theme (${Dungeon.themeFor(f).name})`);
  }
  const deepNames = new Set([11, 15, 19].map((f) => Dungeon.themeFor(f).name));
  assert.ok(deepNames.size >= 2, 'deep themes rotate too');
});

test('floors past 10 become mazier: more, smaller rooms', () => {
  let shallowRooms = 0;
  let deepRooms = 0;
  let shallowArea = 0;
  let deepArea = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = Dungeon.generateDungeon(seed, 3);
    const d = Dungeon.generateDungeon(seed, 13);
    shallowRooms += s.rooms.length;
    deepRooms += d.rooms.length;
    shallowArea += s.rooms.reduce((a, r) => a + r.w * r.h, 0) / s.rooms.length;
    deepArea += d.rooms.reduce((a, r) => a + r.w * r.h, 0) / d.rooms.length;
  }
  assert.ok(deepRooms > shallowRooms * 1.2, `more rooms deep (${deepRooms} vs ${shallowRooms})`);
  assert.ok(deepArea < shallowArea * 0.7, `smaller rooms deep (avg ${Math.round(deepArea / 6)} vs ${Math.round(shallowArea / 6)})`);
});

test('deep floors stay deterministic and fully connected', () => {
  const a = Dungeon.generateDungeon(42, 12);
  const b = Dungeon.generateDungeon(42, 12);
  assert.deepEqual(a.grid, b.grid, 'deterministic at depth');
  const WALK = (t) => t === Dungeon.TILE.FLOOR || t === Dungeon.TILE.ENTRY || t === Dungeon.TILE.STAIRS_DOWN;
  const field = Dungeon.flowField(a.grid, a.entry.x, a.entry.y, Infinity);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (WALK(a.grid[y][x])) assert.ok(field[y][x] !== Infinity, `orphan tile ${x},${y}`);
    }
  }
  assert.ok(a.boss, 'floor 12 still has its boss');
});
