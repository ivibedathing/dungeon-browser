// Headless integration smoke: drives the real Game.update loop with no canvas.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;

function freshInput() {
  return {
    keys: { w: false, a: false, s: false, d: false, space: false },
    pressed: new Set(),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

function run(state, input, frames) {
  for (let i = 0; i < frames; i++) {
    state = Game.update(state, input, 1 / 60);
    input.pressed.clear();
  }
  return state;
}

test('random-walk survives 1200 frames without leaving walkable space', () => {
  let state = Game.newRun(1234);
  const input = freshInput();
  for (let i = 0; i < 1200; i++) {
    if (i % 20 === 0) {
      input.keys.w = Math.random() < 0.5;
      input.keys.a = Math.random() < 0.5;
      input.keys.s = Math.random() < 0.5;
      input.keys.d = Math.random() < 0.5;
      input.keys.space = Math.random() < 0.6;
    }
    if (i % 90 === 0) input.pressed.add('interact');
    state = Game.update(state, input, 1 / 60);
    input.pressed.clear();
  }
  const p = state.player;
  const tx = Math.floor(p.x / TS);
  const ty = Math.floor(p.y / TS);
  assert.ok(Dungeon.isWalkable(state.dungeon.grid[ty][tx]), 'player ended on a walkable tile');
  assert.ok(p.hp <= Entities.effectiveStats(p).maxHP);
});

test('standing on the stairs descends to the next floor', () => {
  let state = Game.newRun(99);
  const input = freshInput();
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  state = run(state, input, 3);
  assert.equal(state.floor, 2);
  const e = state.dungeon.entry;
  assert.ok(Math.hypot(state.player.x - (e.x + 0.5) * TS, state.player.y - (e.y + 0.5) * TS) < TS, 'player at new entry');
  assert.ok(state.monsters.length > 0, 'new floor repopulated');
});

test('holding space next to a monster kills it and grants XP', () => {
  let state = Game.newRun(7);
  const input = freshInput();
  // Move a zombie right next to the player and face it.
  const m = state.monsters[0];
  m.x = state.player.x + 30;
  m.y = state.player.y;
  state.player.facing = 0;
  input.keys.space = true;
  const before = state.monsters.length;
  const xpBefore = state.player.xp + state.player.level * 1000;
  state = run(state, input, 600);
  assert.ok(state.kills >= 1, `killed something (kills=${state.kills})`);
  assert.ok(state.monsters.length < before || state.player.level > 1);
  assert.ok(state.player.xp + state.player.level * 1000 > xpBefore, 'xp or level increased');
});

test('belt potion heals the player over time', () => {
  let state = Game.newRun(55);
  const input = freshInput();
  // Clear all monsters so nothing interferes.
  state.monsters.length = 0;
  Items.addItem(state.bag, Items.makePotion(1, Math.random));
  state.player.hp = 20;
  Game.useBelt(state, 0);
  assert.ok(state.player.healPool > 0, 'heal pool charged');
  state = run(state, input, 120); // 2s > 1.2s heal duration
  assert.ok(state.player.hp >= 59, `healed to ${state.player.hp} (expected ~60)`);
  assert.equal(state.bag.belt[0], null, 'potion consumed');
});

test('player death and restart produce a fresh run', () => {
  let state = Game.newRun(31);
  const input = freshInput();
  const brute = state.monsters.find((m) => m.attackRange) || state.monsters[0];
  brute.x = state.player.x + 20;
  brute.y = state.player.y;
  brute.aggroed = true;
  state.player.hp = 1;
  state.player.equip.armor = null;
  state = run(state, input, 300);
  assert.equal(state.dead, true, 'player died');
  input.pressed.add('restart');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.dead, false);
  assert.equal(state.floor, 1);
  assert.equal(state.player.level, 1);
  assert.ok(state.player.hp > 0);
});

test('monster AI chases the player through the flow field', () => {
  let state = Game.newRun(2);
  const input = freshInput();
  const m = state.monsters[0];
  // Drop the monster ~5 tiles from the player on a walkable path and let it aggro.
  const p = state.player;
  const field = Dungeon.flowField(state.dungeon.grid, Math.floor(p.x / TS), Math.floor(p.y / TS), 30);
  outer: for (let y = 0; y < state.dungeon.height; y++) {
    for (let x = 0; x < state.dungeon.width; x++) {
      if (field[y][x] >= 4 && field[y][x] <= 8) {
        m.x = (x + 0.5) * TS;
        m.y = (y + 0.5) * TS;
        break outer;
      }
    }
  }
  m.aggroed = true;
  const d0 = Math.hypot(m.x - state.player.x, m.y - state.player.y);
  state = run(state, input, 240); // 4 seconds standing still
  const m2 = state.monsters.find((x) => x === m);
  if (m2) {
    const d1 = Math.hypot(m2.x - state.player.x, m2.y - state.player.y);
    assert.ok(
      d1 < d0 || d1 <= m2.attackRange + 20,
      `monster closed distance (${Math.round(d0)} -> ${Math.round(d1)})`
    );
    // If it reached the player, the player should have taken hits.
    if (d1 <= m2.attackRange + 20) assert.ok(state.player.hp < 100);
  }
});
