const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); input.pressed.clear(); }
  return state;
}
const inRoom = (r, tx, ty) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;

test('even floors get a boss room; odd floors do not', () => {
  for (const seed of [1, 2, 3]) {
    for (const floor of [1, 3, 5]) {
      assert.ok(!Dungeon.generateDungeon(seed, floor).boss, `no boss on floor ${floor}`);
    }
    for (const floor of [2, 4, 6]) {
      const d = Dungeon.generateDungeon(seed, floor);
      assert.ok(d.boss, `boss on floor ${floor}`);
      assert.ok(Dungeon.isWalkable(d.grid[d.boss.y][d.boss.x]), 'boss spawn walkable');
      assert.ok(inRoom(d.boss.room, d.boss.x, d.boss.y), 'boss inside its room');
      assert.ok(inRoom(d.boss.room, d.stairs.x, d.stairs.y), 'boss guards the stairs');
      assert.ok(d.stairs.x !== d.boss.x || d.stairs.y !== d.boss.y, 'stairs not under the boss');
      for (const s of d.spawns) {
        assert.ok(!inRoom(d.boss.room, s.x, s.y), 'no trash mobs inside the boss room');
      }
    }
  }
});

test('a boss dwarfs a champion of the same floor', () => {
  const boss = Entities.makeBoss(4);
  const champ = Entities.makeMonster('brute', 4, true);
  assert.equal(boss.boss, true);
  assert.ok(boss.hp > champ.hp * 2, `boss hp ${boss.hp} vs champ ${champ.hp}`);
  assert.ok(boss.dmg > champ.dmg, 'hits harder than a champion');
  assert.ok(boss.xp > champ.xp * 2, 'worth far more xp');
  assert.ok(boss.size > champ.size, 'physically bigger');
  assert.ok(boss.kbResist < 1, 'shrugs off knockback');
  assert.ok(typeof boss.name === 'string' && boss.name.length > 3, 'named');
  const deeper = Entities.makeBoss(8);
  assert.ok(deeper.hp > boss.hp, 'bosses scale with depth');
});

test('boss floors spawn the boss; entering its room starts the fight and centers the camera', () => {
  let state = Game.newRun(31);
  // Descend to floor 2.
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  const input = freshInput();
  state = run(state, input, 3);
  assert.equal(state.floor, 2);
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss, 'boss present on floor 2');
  assert.equal(state.bossFight, false, 'fight not started yet');

  // Step into the boss room, off-center.
  const r = state.dungeon.boss.room;
  state.player.x = (r.x + 1.5) * TS;
  state.player.y = (r.y + 1.5) * TS;
  state = run(state, input, 5);
  assert.equal(state.bossFight, true, 'fight begins on entry');
  assert.equal(boss.aggroed, true, 'boss wakes');

  // Camera settles on the room center, not on the player.
  state = run(state, input, 180);
  const cx = (r.x + r.w / 2) * TS;
  const cy = (r.y + r.h / 2) * TS;
  assert.ok(Math.hypot(state.cam.x - cx, state.cam.y - cy) < 24, 'camera centered on the room');
  assert.ok(Math.hypot(state.cam.x - state.player.x, state.cam.y - state.player.y) > 40, 'camera is not glued to the player');

  // Leaving the room releases the camera lock.
  state.player.x = (state.dungeon.entry.x + 0.5) * TS;
  state.player.y = (state.dungeon.entry.y + 0.5) * TS;
  state = run(state, input, 10);
  assert.equal(state.bossFight, false, 'fight flag clears outside the room');
});

test('bosses resist knockback', () => {
  let state = Game.newRun(32);
  state.monsters.length = 0;
  const boss = { ...Entities.makeBoss(2), x: state.player.x + 40, y: state.player.y, attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0 };
  const zombie = { ...Entities.makeMonster('zombie', 2, false), x: state.player.x + 40, y: state.player.y + 60, attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0 };
  state.monsters.push(boss, zombie);
  const input = freshInput();
  input.keys.space = true;
  state.player.facing = 0;
  state = Game.update(state, input, 1 / 60);
  assert.ok(Math.abs(boss.kbx) < Math.abs(zombie.kbx) * 0.5 || zombie.kbx === 0, `boss kb ${boss.kbx} vs zombie ${zombie.kbx}`);
});

test('killing the boss showers loot and ends the fight', () => {
  let state = Game.newRun(33);
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  const input = freshInput();
  state = run(state, input, 3);
  const boss = state.monsters.find((m) => m.boss);
  const r = state.dungeon.boss.room;
  // Fight it point-blank with an almost-dead boss.
  state.player.x = boss.x - 30;
  state.player.y = boss.y;
  state.player.facing = 0;
  boss.hp = 1;
  state = run(state, input, 2); // entering starts the fight
  assert.equal(state.bossFight, true);
  input.keys.space = true;
  state = run(state, input, 30);
  assert.ok(!state.monsters.some((m) => m.boss), 'boss slain');
  assert.equal(state.bossFight, false, 'fight over');
  const items = state.groundItems.filter((g) => g.kind === 'item');
  const gold = state.groundItems.filter((g) => g.kind === 'gold');
  assert.ok(items.length >= 2, `boss drops at least two items (got ${items.length})`);
  assert.ok(items.every((g) => g.item.rarity !== 'common'), 'boss loot is never common');
  assert.ok(gold.length >= 1 || state.bag.gold > 0, 'boss gold dropped (may already be magnet-collected)');
  assert.ok(state.player.xp > 0 || state.player.level > 1, 'boss xp granted');
});
