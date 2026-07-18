const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;
const center = (t) => t * TS + TS / 2;

function freshInput() {
  return {
    keys: { w: false, a: false, s: false, d: false, space: false },
    pressed: new Set(),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// A known-shape arena replaces whatever the seed generated: floor across tiles
// (8..16, 8..12), so a test can place its own wall and know nothing else is in the way.
function carveArena(state) {
  const grid = state.dungeon.grid;
  for (let ty = 8; ty <= 12; ty++) {
    for (let tx = 8; tx <= 16; tx++) grid[ty][tx] = Dungeon.TILE.FLOOR;
  }
  state.monsters.length = 0;
  state.projectiles.length = 0;
  state.player.x = center(10);
  state.player.y = center(10);
  state.player.facing = 0; // +x, toward the monsters these tests place
  return grid;
}

function placeMonsterAt(state, tx, ty) {
  const m = {
    ...Entities.makeMonster('zombie', 1, false),
    x: center(tx),
    y: center(ty),
    attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0,
  };
  state.monsters.push(m);
  return m;
}

function equipWeapon(state, kind) {
  state.player.equip.weapon = Items.makeItem(1, U.mulberry32(11), { slot: 'weapon', kind });
}

function attackOnce(state) {
  const input = freshInput();
  input.keys.space = true;
  return Game.update(state, input, 1 / 60);
}

test('lineOfSight: clear across floor, blocked by a wall tile, forgiving at the origin', () => {
  const state = Game.newRun(77);
  const grid = carveArena(state);

  assert.ok(Game.lineOfSight(grid, center(10), center(10), center(12), center(10)), 'open floor is clear');

  grid[10][11] = Dungeon.TILE.WALL;
  assert.ok(!Game.lineOfSight(grid, center(10), center(10), center(12), center(10)), 'a wall between blocks');
  assert.ok(Game.lineOfSight(grid, center(10), center(10), center(10), center(12)), 'a wall off to the side does not');

  // A blast that bursts flush against a wall still reaches the open floor beside it.
  assert.ok(Game.lineOfSight(grid, center(11), center(11), center(10), center(11)), 'origin tile is exempt');
});

test('melee swings do not reach through a wall', () => {
  const state = Game.newRun(77);
  const grid = carveArena(state);
  equipWeapon(state, 'melee');
  grid[10][11] = Dungeon.TILE.WALL;
  const m = placeMonsterAt(state, 12, 10); // 64px away — well inside the ~84px reach

  const after = attackOnce(state);
  assert.equal(after.monsters.length, 1, 'monster survives');
  assert.equal(m.hp, m.maxHP, 'walled-off monster takes no damage');
});

test('melee swings still land at the same range with no wall in between', () => {
  const state = Game.newRun(77);
  carveArena(state);
  equipWeapon(state, 'melee');
  const m = placeMonsterAt(state, 12, 10);

  attackOnce(state);
  assert.ok(m.hp < m.maxHP, 'monster in the open is hit — line of sight did not over-block');
});

test('a fireball blast does not carry through a wall', () => {
  const state = Game.newRun(77);
  const grid = carveArena(state);
  equipWeapon(state, 'wand');
  grid[10][12] = Dungeon.TILE.WALL;
  // Just past the wall: within the 56px blast, but the blast has to cross the wall to land.
  const m = placeMonsterAt(state, 13, 10);

  let s = attackOnce(state);
  const input = freshInput();
  for (let i = 0; i < 60 && s.projectiles.length; i++) s = Game.update(s, input, 1 / 60);

  assert.equal(s.projectiles.length, 0, 'fireball burst on the wall');
  assert.equal(m.hp, m.maxHP, 'monster behind the wall is untouched');
});
