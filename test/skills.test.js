const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const E = Entities;

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

function placeMonster(state, dx, dy) {
  const m = {
    ...E.makeMonster('zombie', 1, false),
    x: state.player.x + dx,
    y: state.player.y + dy,
    attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0,
  };
  state.monsters.push(m);
  return m;
}

test('the skill table has three branches of three, with hotkeyed actives', () => {
  const ids = Object.keys(Skills.SKILLS);
  assert.equal(ids.length, 9);
  for (const branch of ['war', 'sorcery', 'faith']) {
    const inBranch = ids.filter((id) => Skills.SKILLS[id].branch === branch);
    assert.equal(inBranch.length, 3, `${branch} has 3 skills`);
    for (const tier of [1, 2, 3]) {
      assert.ok(inBranch.some((id) => Skills.SKILLS[id].tier === tier), `${branch} tier ${tier}`);
    }
  }
  assert.deepEqual(Skills.ACTIVE_ORDER, ['whirlwind', 'nova', 'prayer']);
  for (const id of Skills.ACTIVE_ORDER) {
    const s = Skills.SKILLS[id];
    assert.equal(s.tier, 1, 'actives sit at tier 1');
    assert.ok(s.active.mana > 0 && s.active.cd > 0 && s.active.hotkey, `${id} active config`);
  }
});

test('learning respects points, tier gates, and max ranks', () => {
  const p = E.newPlayer();
  assert.equal(p.skillPoints, 0);
  assert.equal(Skills.canLearn(p, 'whirlwind'), false, 'no points, no learning');

  p.skillPoints = 3;
  assert.equal(Skills.canLearn(p, 'rage'), false, 'tier 2 gated until tier 1 learned');
  assert.equal(Skills.learn(p, 'whirlwind'), true);
  assert.equal(Skills.rank(p, 'whirlwind'), 1);
  assert.equal(p.skillPoints, 2);
  assert.equal(Skills.canLearn(p, 'rage'), true, 'tier 2 open after tier 1');
  assert.equal(Skills.learn(p, 'rage'), true);
  assert.equal(Skills.canLearn(p, 'tempo'), true, 'tier 3 open after tier 2');

  p.skillPoints = 99;
  for (let i = 0; i < 10; i++) Skills.learn(p, 'whirlwind');
  assert.equal(Skills.rank(p, 'whirlwind'), 5, 'capped at max rank');
});

test('passives feed effectiveStats: damage, speed, defense, life, mana', () => {
  const p = E.newPlayer();
  const base = E.effectiveStats(p);
  assert.equal(base.maxMana, 40, 'base mana pool');
  assert.ok(base.manaRegen >= 2, 'base regen');

  p.skillPoints = 99;
  Skills.learn(p, 'whirlwind');
  Skills.learn(p, 'rage');
  Skills.learn(p, 'rage'); // rank 2 → +16% damage
  Skills.learn(p, 'tempo'); // +5% attack speed
  Skills.learn(p, 'nova');
  Skills.learn(p, 'focus'); // +12 mana, +0.5 regen
  Skills.learn(p, 'prayer');
  Skills.learn(p, 'stoneskin'); // +2 defense
  Skills.learn(p, 'vigor'); // +14 life

  const s = E.effectiveStats(p);
  assert.ok(Math.abs(s.damage - base.damage * 1.16) < 0.01, `rage damage (got ${s.damage})`);
  assert.ok(Math.abs(s.speed - base.speed * 1.05) < 0.01, 'tempo speed');
  assert.equal(s.defense, base.defense + 2, 'stone skin');
  assert.equal(s.maxHP, base.maxHP + 14, 'vigor');
  assert.equal(s.maxMana, 52, 'arcane focus mana');
  assert.ok(s.manaRegen > base.manaRegen, 'arcane focus regen');
});

test('leveling grants a skill point and +6 mana, and refills mana', () => {
  const p = E.newPlayer();
  p.mana = 5;
  E.gainXP(p, E.xpForLevel(1));
  assert.equal(p.level, 2);
  assert.equal(p.skillPoints, 1);
  assert.equal(p.baseMaxMana, 46);
  assert.equal(p.mana, E.effectiveStats(p).maxMana, 'mana refilled on level');
});

test('mana regenerates during play up to the cap', () => {
  let state = Game.newRun(60);
  state.monsters.length = 0;
  state.player.mana = 0;
  const input = freshInput();
  state = run(state, input, 300); // 5 seconds
  assert.ok(state.player.mana >= 10, `regen ticked (${state.player.mana})`);
  state = run(state, input, 1800);
  assert.equal(state.player.mana, E.effectiveStats(state.player).maxMana, 'capped at max');
});

test('Whirlwind hits everything around, spends mana, and respects cooldown', () => {
  let state = Game.newRun(61);
  state.monsters.length = 0;
  const p = state.player;
  p.skillPoints = 1;
  Skills.learn(p, 'whirlwind');
  const around = [placeMonster(state, 50, 0), placeMonster(state, -50, 10), placeMonster(state, 0, -55)];
  const input = freshInput();
  input.pressed.add('skill0');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.ok(around.every((m) => m.hp < m.maxHP), 'all three struck in a full circle');
  const cost = Skills.SKILLS.whirlwind.active.mana;
  assert.ok(Math.abs(p.mana - (40 - cost)) < 1, `mana spent (${p.mana})`);
  assert.ok(p.skillCd.whirlwind > 0, 'cooldown running');

  const hpAfter = around.map((m) => m.hp);
  const manaAfter = p.mana;
  input.pressed.add('skill0');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.deepEqual(around.map((m) => m.hp), hpAfter, 'cooldown blocks the second spin');
  assert.ok(p.mana >= manaAfter, 'no mana burned while on cooldown');
});

test('unlearned or unaffordable skills do not fire', () => {
  let state = Game.newRun(62);
  state.monsters.length = 0;
  const p = state.player;
  const m = placeMonster(state, 40, 0);
  const input = freshInput();
  input.pressed.add('skill0');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(m.hp, m.maxHP, 'unlearned skill does nothing');

  p.skillPoints = 1;
  Skills.learn(p, 'whirlwind');
  p.mana = 2;
  input.pressed.add('skill0');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(m.hp, m.maxHP, 'no mana, no whirlwind');
});

test('Fire Nova rings the player with twelve fireballs that hurt the pack', () => {
  let state = Game.newRun(63);
  state.monsters.length = 0;
  const p = state.player;
  p.skillPoints = 1;
  Skills.learn(p, 'nova');
  const pack = [placeMonster(state, 110, 0), placeMonster(state, -110, 0), placeMonster(state, 0, 110)];
  const input = freshInput();
  input.pressed.add('skill1');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.projectiles.length, 12, 'twelve fireballs launched');
  state = run(state, input, 90);
  assert.ok(pack.every((m) => m.hp < m.maxHP), 'the ring caught every direction');
});

test('Healing Prayer restores health for mana', () => {
  let state = Game.newRun(64);
  state.monsters.length = 0;
  const p = state.player;
  p.skillPoints = 1;
  Skills.learn(p, 'prayer');
  p.hp = 30;
  const input = freshInput();
  input.pressed.add('skill2');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  state = run(state, input, 90);
  assert.ok(p.hp > 45, `prayer healed (${p.hp})`);
  assert.ok(p.mana < 40, 'prayer cost mana');
});

test('mana potions exist, drop into the belt, and restore mana instantly', () => {
  const rng = U.mulberry32(8);
  const mp = Items.makePotion(3, rng, 'mana');
  assert.equal(mp.kind, 'mana');
  assert.ok(mp.mana > 0);
  assert.ok(mp.name.includes('Mana'));
  const hp = Items.makePotion(3, rng);
  assert.equal(hp.kind || 'health', 'health', 'default stays a healing potion');

  let state = Game.newRun(65);
  state.monsters.length = 0;
  state.player.mana = 0;
  Items.addItem(state.bag, mp);
  Game.useBelt(state, 0);
  const cap = E.effectiveStats(state.player).maxMana;
  assert.ok(state.player.mana >= Math.min(mp.mana, cap) - 0.01, `mana restored to ${state.player.mana} (cap ${cap})`);
  assert.equal(state.bag.belt[0], null, 'potion consumed');
});

test('skills and mana survive a save/load round trip', () => {
  const Save = require('../js/save.js');
  globalThis.Save = Save;
  const map = new Map();
  Save._storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  let state = Game.newRun(66);
  const p = state.player;
  p.skillPoints = 5;
  Skills.learn(p, 'whirlwind');
  Skills.learn(p, 'whirlwind');
  Skills.learn(p, 'rage');
  p.mana = 17;
  p.baseMaxMana = 58;
  Save.write(state);
  const restored = Game.fromSave(Save.load());
  assert.equal(Skills.rank(restored.player, 'whirlwind'), 2);
  assert.equal(Skills.rank(restored.player, 'rage'), 1);
  assert.equal(restored.player.skillPoints, 2);
  assert.equal(restored.player.mana, 17);
  assert.equal(restored.player.baseMaxMana, 58);
});
