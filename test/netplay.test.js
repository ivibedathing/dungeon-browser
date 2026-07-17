// Phase 2 (client netplay) tests — grows task by task.
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
const Game = require('../js/game.js');

function freshInput(over = {}) {
  return {
    keys: Object.assign({ w: false, a: false, s: false, d: false, space: false }, over.keys),
    pressed: new Set(over.pressed || []),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// ---- Task 1: prediction parity ----

test('Game.predictMovement moves a player identically to Game.update (no rubber-band)', () => {
  // Two lone players from the same seed/floor: one advanced by the full sim, one by the
  // client predictor. Their positions must stay bit-identical, or reconciliation snaps.
  const sim = Game.newRun(101);
  sim.monsters.length = 0;
  const predicted = Game.newRun(101);
  predicted.monsters.length = 0;

  const grid = predicted.dungeon.grid;
  const pp = predicted.player;

  for (let i = 0; i < 60; i++) {
    const held = freshInput({ keys: { d: true } });
    Game.update(sim, { p0: held }, 1 / 30);
    const stats = Entities.effectiveStats(pp);
    Game.predictMovement(grid, pp, freshInput({ keys: { d: true } }), 1 / 30, stats);
  }

  assert.equal(pp.x, sim.player.x, 'predicted x matches the authoritative sim exactly');
  assert.equal(pp.y, sim.player.y, 'predicted y matches');
  assert.equal(pp.facing, sim.player.facing, 'facing matches');
});

test('Game.predictMovement reproduces a dodge roll', () => {
  const state = Game.newRun(102);
  state.monsters.length = 0;
  const p = state.player;
  const grid = state.dungeon.grid;
  const stats = Entities.effectiveStats(p);
  const x0 = p.x;

  const dodged = Game.predictMovement(grid, p, freshInput({ keys: { d: true }, pressed: ['dodge'] }), 1 / 30, stats);
  assert.equal(dodged, true, 'predictMovement reports that a dodge started (so the server can emit its juice)');
  assert.ok(p.dodgeCdT > 0, 'dodge armed the cooldown');
  assert.ok(p.dodgeT > 0, 'dodge is in progress');
  // A dodge dashes far faster than a walk: one frame of roll clears real ground.
  assert.ok(p.x - x0 > 10, 'the roll dashed the player this frame');
});

test('Game.predictMovement only touches movement — no attacks, pickups, or world rebuild', () => {
  const state = Game.newRun(103);
  const p = state.player;
  const grid = state.dungeon.grid;
  const stats = Entities.effectiveStats(p);
  const monstersBefore = state.monsters.length;
  const eventsBefore = state.events.length;

  // Space is the attack-held flag; predictMovement must ignore it.
  Game.predictMovement(grid, p, freshInput({ keys: { d: true, space: true } }), 1 / 30, stats);

  assert.equal(state.monsters.length, monstersBefore, 'no monster was harmed');
  assert.equal(state.events.length, eventsBefore, 'movement emits no sim events (dodge sfx is a sim concern, not prediction)');
});
