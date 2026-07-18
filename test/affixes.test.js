const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;

function ringWith(affixes) {
  return { slot: 'ring', base: 'Test Ring', rarity: 'rare', color: '#ffd84d', ilvl: 1, stats: {}, affixes };
}

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
function placeMonster(state, dx, dy, extra = {}) {
  const m = {
    ...Entities.makeMonster('zombie', 1, false),
    x: state.player.x + dx,
    y: state.player.y + dy,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
    ...extra,
  };
  const tile = state.dungeon.grid[Math.floor(m.y / TS)][Math.floor(m.x / TS)];
  assert.ok(Dungeon.isWalkable(tile), `monster at +${dx},${dy} must stand on open floor`);
  state.monsters.push(m);
  return m;
}

// ---- Pure aggregation: every new affix flows through aggregateStats + effectiveStats ----

test('new affixes aggregate and surface in effectiveStats', () => {
  const p = Entities.newPlayer();
  p.equip.ring = ringWith([
    { key: 'critChance', val: 0.2, label: '' },
    { key: 'thorns', val: 7, label: '' },
    { key: 'lifeRegen', val: 3.5, label: '' },
    { key: 'manaPerKill', val: 4, label: '' },
  ]);
  const s = Entities.effectiveStats(p);
  assert.ok(Math.abs(s.critChance - 0.2) < 1e-9, `critChance ${s.critChance}`);
  assert.equal(s.thorns, 7);
  assert.ok(Math.abs(s.lifeRegen - 3.5) < 1e-9, `lifeRegen ${s.lifeRegen}`);
  assert.equal(s.manaPerKill, 4);
});

test('affixes with the same key stack additively across pieces', () => {
  const equip = {
    ring: ringWith([{ key: 'thorns', val: 3, label: '' }]),
    gloves: { slot: 'gloves', stats: {}, affixes: [{ key: 'thorns', val: 5, label: '' }] },
  };
  assert.equal(Items.aggregateStats(equip).thorns, 8);
});

test('a fresh hero has zero of every new stat', () => {
  const s = Entities.effectiveStats(Entities.newPlayer());
  assert.equal(s.critChance, 0);
  assert.equal(s.thorns, 0);
  assert.equal(s.lifeRegen, 0);
  assert.equal(s.manaPerKill, 0);
});

// ---- Crit: deterministic via the exported rollDamage ----

test('critChance multiplies a hit by 1.5x, and never fires without crit gear', () => {
  // A scripted srand: first draw is the damage variance, second is the crit roll.
  const scripted = (vals) => {
    let i = 0;
    return { srand: () => vals[i++] };
  };
  const roll = Game._.rollDamage; // exported for this determinism check
  // variance 0.5 -> factor 1.0 (0.85 + 0.5*0.3 = 1.0), then crit roll 0.0 < critChance.
  assert.equal(roll(scripted([0.5, 0.0]), { damage: 100, critChance: 1 }), 150, 'guaranteed crit is 1.5x');
  // Same variance, no crit gear: the crit branch never draws, so it's the plain hit.
  assert.equal(roll(scripted([0.5]), { damage: 100, critChance: 0 }), 100, 'no crit gear = base hit');
  // Crit roll above the chance: no crit.
  assert.equal(roll(scripted([0.5, 0.9]), { damage: 100, critChance: 0.2 }), 100, 'unlucky roll = base hit');
});

// ---- Behavioral hooks in the live sim ----

test('lifeRegen heals the hero over time up to max life', () => {
  let state = Game.newRun(7);
  state.monsters.length = 0;
  const p = state.player;
  p.equip.ring = ringWith([{ key: 'lifeRegen', val: 6, label: '' }]);
  p.healPool = 0;
  const max = Entities.effectiveStats(p).maxHP;
  p.hp = max - 50;
  state = run(state, freshInput(), 120); // 2s @ 60fps, ~12 HP
  assert.ok(p.hp > max - 50, `regen raised hp (${p.hp})`);
  assert.ok(p.hp <= max, 'regen never overheals');
  p.hp = max;
  state = run(state, freshInput(), 30);
  assert.equal(p.hp, max, 'regen holds at full');
});

test('manaPerKill restores mana to the credited killer on a kill', () => {
  let state = Game.newRun(8);
  state.monsters.length = 0;
  const p = state.player;
  p.equip.ring = ringWith([{ key: 'manaPerKill', val: 10, label: '' }]);
  p.mana = 0;
  const m = placeMonster(state, 30, 0, { hp: 1, maxHP: 1 });
  p.facing = Math.atan2(m.y - p.y, m.x - p.x);
  const input = freshInput();
  input.keys.space = true;
  state = run(state, input, 30);
  assert.ok(state.kills >= 1, 'killed the target');
  assert.ok(p.mana >= 10, `mana restored on kill (${p.mana})`);
});

test('thorns reflects damage back at an attacker and can slay it', () => {
  let state = Game.newRun(9);
  state.monsters.length = 0;
  const p = state.player;
  p.equip.ring = ringWith([{ key: 'thorns', val: 40, label: '' }]);
  p.dodgeT = 0;
  const m = placeMonster(state, 26, 0, { hp: 30, maxHP: 30 });
  const input = freshInput(); // player never swings; only thorns damages the monster
  state = run(state, input, 90);
  assert.ok(m.hp < 30 || !state.monsters.includes(m), 'attacker took reflected damage');
  assert.ok(p.hp > 0, 'hero survived the exchange');
});
