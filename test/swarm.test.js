// Ambush swarms: weak, fast swarmlings that burst in when a player reaches a
// rigged room's center. Pure-sim coverage — no rendering, no server.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Game = require('../js/game.js');
const Balance = require('../js/balance.js');

const TS = Dungeon.TILE_SIZE;

function noopInput() {
  return {
    keys: { w: false, a: false, s: false, d: false, space: false, ctrl: false },
    pressed: new Set(),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// Regenerate `state` onto a given floor (deterministic from runSeed + floor).
function toFloor(state, floor) {
  state.floor = floor;
  Game._.makeFloorState(state);
  return state;
}

test('swarmling never appears in the random spawn pool', () => {
  const rng = U.mulberry32(4);
  for (let f = 1; f <= 12; f++) {
    for (let i = 0; i < 500; i++) {
      assert.notEqual(Entities.pickMonsterType(rng, f), 'swarmling', `floor ${f}`);
    }
  }
});

test('swarmlings are frail but faster than any pooled monster', () => {
  const sw = Entities.makeMonster('swarmling', 1, false);
  const bat = Entities.makeMonster('bat', 1, false);
  assert.ok(sw.hp < bat.hp, 'swarmling is frailer than a bat');
  const pooled = Object.entries(Balance.monsters).filter(([, t]) => t.weight > 0);
  for (const [name, t] of pooled) {
    assert.ok(Balance.monsters.swarmling.speed > t.speed, `outpaces ${name}`);
  }
});

test('no ambushes below the swarm minFloor; they appear at and beyond it', () => {
  const minFloor = Balance.swarm.minFloor;
  for (let f = 1; f < minFloor; f++) {
    const d = Dungeon.generateDungeon(999, f);
    assert.equal(d.ambushes.length, 0, `floor ${f} has no ambush`);
    assert.ok(d.ambushes.length <= Balance.swarm.maxRooms);
  }
  // Across seeds, deeper floors do produce ambushes (probabilistic per room).
  let found = 0;
  for (let seed = 1; seed <= 40 && found === 0; seed++) {
    const d = Dungeon.generateDungeon(seed, minFloor + 1);
    found += d.ambushes.length;
    for (const a of d.ambushes) {
      assert.ok(a.spawns.length > 0, 'ambush has spawn tiles');
      assert.ok(a.spawns.length <= Balance.swarm.packCap, 'respects the pack cap');
    }
  }
  assert.ok(found > 0, 'ambushes generate on deeper floors');
});

test('a swarm springs only when a player reaches the room center, and only once', () => {
  // Find a run whose current floor carries at least one ambush.
  let state = null;
  for (let seed = 1; seed <= 60; seed++) {
    const s = Game.newRun(seed);
    toFloor(s, Balance.swarm.minFloor + 2);
    if (s.ambushes.length > 0) { state = s; break; }
  }
  assert.ok(state, 'found a floor with an ambush');
  const amb = state.ambushes[0];
  const input = noopInput();

  // Park the hero far from the trigger: stepping the world must not spring it.
  state.player.x = (state.dungeon.entry.x + 0.5) * TS;
  state.player.y = (state.dungeon.entry.y + 0.5) * TS;
  const before = state.monsters.length;
  for (let i = 0; i < 5; i++) state = Game.update(state, input, 1 / 30);
  assert.equal(amb.triggered, false, 'stays dormant while the hero is away');
  assert.equal(state.monsters.filter((m) => m.type === 'swarmling').length, 0, 'no swarm yet');

  // Teleport onto the trigger center; the pack must burst in on the next tick.
  state.player.x = (amb.cx + 0.5) * TS;
  state.player.y = (amb.cy + 0.5) * TS;
  state = Game.update(state, input, 1 / 30);
  const swarm = state.monsters.filter((m) => m.type === 'swarmling');
  assert.equal(amb.triggered, true, 'the ambush fires');
  assert.equal(swarm.length, amb.spawns.length, 'the whole pack spawns');
  assert.ok(state.monsters.length > before, 'monster count grew');
  assert.ok(swarm.every((m) => m.aggroed), 'swarmlings commit instantly');

  // Re-entering the same room must not spawn a second pack.
  const afterFirst = state.monsters.filter((m) => m.type === 'swarmling').length;
  for (let i = 0; i < 5; i++) state = Game.update(state, input, 1 / 30);
  const stillSpawning = state.monsters.filter((m) => m.type === 'swarmling').length;
  assert.ok(stillSpawning <= afterFirst, 'the ambush does not re-arm');
});
