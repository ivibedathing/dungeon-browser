const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Balance = require('../js/balance.js');
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
// Place an aggroed monster of `type` at an offset that's been verified walkable
// (the +150/+40 lanes along +x are open with line-of-sight on these seeds — the
// existing weapons tests fire arrows down them).
function place(state, type, dx, dy, extra = {}) {
  const m = {
    ...Entities.makeMonster(type, 5, false),
    x: state.player.x + dx,
    y: state.player.y + dy,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
    ...extra,
  };
  const tile = state.dungeon.grid[Math.floor(m.y / TS)][Math.floor(m.x / TS)];
  assert.ok(Dungeon.isWalkable(tile), `${type} at +${dx},${dy} must stand on open floor`);
  state.monsters.push(m);
  return m;
}

test('a ranged caster looses a hostile bolt that damages the player, not monsters', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  const cultist = place(state, 'cultist', 150, 0);
  const bystander = place(state, 'zombie', 80, 0, { attackT: 999, aggroed: false, hp: 500, maxHP: 500 });
  const hp0 = state.player.hp;
  const input = freshInput();
  // Let the cast wind up and the bolt fly back to the hero.
  let sawBolt = false;
  for (let i = 0; i < 120; i++) {
    state = Game.update(state, input, 1 / 60);
    if (state.projectiles.some((pr) => pr.hostile && pr.kind === 'bolt')) sawBolt = true;
  }
  assert.ok(sawBolt, 'the caster spawned a hostile bolt');
  assert.ok(state.player.hp < hp0, `bolt hurt the hero (${hp0} -> ${state.player.hp})`);
  assert.equal(bystander.hp, 500, 'a hostile bolt never damages monsters');
  assert.ok(cultist.hp > 0, 'the caster is unharmed by its own bolt');
});

test('an exploder fuses on contact and detonates an AoE, removing itself', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  const bomber = place(state, 'bomber', 40, 0);
  const hp0 = state.player.hp;
  const input = freshInput();
  state = run(state, input, 120);
  assert.ok(state.player.hp < hp0, `the blast hurt the hero (${hp0} -> ${state.player.hp})`);
  assert.ok(!state.monsters.includes(bomber), 'the exploder consumed itself in the blast');
});

test('a charger winds up then dashes across ground and lands a contact hit', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  const gargoyle = place(state, 'gargoyle', 150, 0);
  const startDist = Math.hypot(gargoyle.x - state.player.x, gargoyle.y - state.player.y);
  const hp0 = state.player.hp;
  const input = freshInput();
  state = run(state, input, 90);
  const endDist = Math.hypot(gargoyle.x - state.player.x, gargoyle.y - state.player.y);
  assert.ok(endDist < startDist - 40, `the charger closed the gap (${startDist.toFixed(0)} -> ${endDist.toFixed(0)})`);
  assert.ok(state.player.hp < hp0, 'the dash landed a contact hit');
});

test('a summoner raises minions up to its cap and no further', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  const necro = place(state, 'necromancer', 150, 0);
  // Make the hero unkillable so minions persist and the cap is what bounds the count.
  state.player.baseMaxHP = 1e6;
  state.player.hp = 1e6;
  const cap = Balance.behaviors.summoner.cap;
  let maxConcurrent = 0;
  const input = freshInput();
  for (let i = 0; i < 1800; i++) {
    state = Game.update(state, input, 1 / 60);
    const summoned = state.monsters.filter((m) => m.summonerId === necro.id).length;
    if (summoned > maxConcurrent) maxConcurrent = summoned;
  }
  assert.ok(maxConcurrent >= 1, 'the summoner raised at least one minion');
  assert.ok(maxConcurrent <= cap, `never exceeds the cap (${maxConcurrent} <= ${cap})`);
});

test('summoning is deterministic for a given seed', () => {
  const raise = () => {
    let state = Game.newRun(41);
    state.monsters.length = 0;
    const necro = place(state, 'necromancer', 150, 0);
    state.player.baseMaxHP = 1e6;
    state.player.hp = 1e6;
    const input = freshInput();
    state = run(state, input, 300);
    return state.monsters.filter((m) => m.summonerId === necro.id).length;
  };
  assert.equal(raise(), raise(), 'same seed → same minion count');
});

// ---- The shared hurt path (unit) ----

test('hurtPlayer respects dodge and subtracts defense', () => {
  const hurt = Game._.hurtPlayer;
  // Dodging negates the hit entirely.
  let state = Game.newRun(41);
  const dodger = state.player;
  dodger.dodgeT = 1;
  const dodgerHp = dodger.hp;
  assert.equal(hurt(state, dodger, 30, {}), 0, 'a dodge takes no damage');
  assert.equal(dodger.hp, dodgerHp);
  // Defense reduces the landed hit.
  state = Game.newRun(42);
  const p = state.player;
  p.dodgeT = 0;
  p.equip.armor = { slot: 'armor', stats: { defense: 5 }, affixes: [] };
  const before = p.hp;
  const dealt = hurt(state, p, 20, {});
  assert.equal(dealt, 15, 'defense 5 turns a 20 hit into 15');
  assert.equal(p.hp, before - 15);
});
