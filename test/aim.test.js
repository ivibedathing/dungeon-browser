// Mouse-look aiming: the hero faces the cursor (input.aim, a world-space angle),
// independent of which way WASD walks, and every attack flies along that facing.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

function freshInput(over) {
  return Object.assign(
    {
      keys: { w: false, a: false, s: false, d: false, space: false },
      pressed: new Set(),
      mouse: { x: 0, y: 0, click: false, rclick: false },
    },
    over
  );
}

test('aim sets facing every frame, overriding the walk direction', () => {
  let state = Game.newRun(7);
  state.player.facing = 0;
  // Walk hard right (+x) while aiming straight up (-y, angle -PI/2).
  const input = freshInput({ keys: { w: false, a: false, s: false, d: true, space: false }, aim: -Math.PI / 2 });
  state = Game.update(state, input, 1 / 60);
  assert.ok(Math.abs(state.player.facing - -Math.PI / 2) < 1e-9, 'facing follows the aim, not the movement');
});

test('aim steers facing even while standing still', () => {
  let state = Game.newRun(7);
  state.player.facing = 0;
  const input = freshInput({ aim: Math.PI }); // face west, no keys held
  state = Game.update(state, input, 1 / 60);
  assert.ok(Math.abs(state.player.facing - Math.PI) < 1e-9, 'a motionless hero still turns to the cursor');
});

test('without an aim, facing falls back to the travel direction', () => {
  let state = Game.newRun(7);
  state.player.facing = 0;
  // No `aim` field at all — the headless/legacy path.
  const input = freshInput({ keys: { w: false, a: true, s: false, d: false, space: false } });
  state = Game.update(state, input, 1 / 60);
  assert.ok(Math.abs(Math.abs(state.player.facing) - Math.PI) < 1e-6, 'walking west faces west (~±PI)');
});

test('a ranged attack flies toward the aim, not the movement', () => {
  let state = Game.newRun(7);
  const rng = U.mulberry32(3);
  state.player.equip.weapon = Items.makeItem(1, rng, { slot: 'weapon', kind: 'bow' });
  state.player.attackT = 0;
  // Aim straight down (+y, +PI/2) while walking up (-y): the arrow must go down.
  const input = freshInput({ keys: { w: true, a: false, s: false, d: false, space: true }, aim: Math.PI / 2 });
  state = Game.update(state, input, 1 / 60);
  const arrow = state.projectiles.find((pr) => pr.kind === 'arrow');
  assert.ok(arrow, 'the bow loosed an arrow');
  assert.ok(arrow.vy > 0 && Math.abs(arrow.vx) < 1, 'arrow travels along the aim (downward), not the walk (upward)');
});
