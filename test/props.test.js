// Breakable decorations: generation, the pure props tables, live-state wiring,
// and the smash → loot pipeline through melee swings and projectiles.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Props = require('../js/props.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const Balance = require('../js/balance.js');

const TS = Dungeon.TILE_SIZE;
const G = Game._;

function freshInput(over = {}) {
  return {
    keys: { w: false, a: false, s: false, d: false, space: false, ...over.keys },
    pressed: new Set(),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

// ---- Generation ----

test('every non-town floor is dressed with breakable props on open floor', () => {
  for (const floor of [1, 2, 4, 7, 12]) {
    const d = Dungeon.generateDungeon(1234, floor);
    assert.ok(Array.isArray(d.props), `floor ${floor} has a props array`);
    assert.ok(d.props.length > 0, `floor ${floor} placed at least one prop`);
    const spawnKeys = new Set(d.spawns.map((s) => s.x + ',' + s.y));
    const seen = new Set();
    for (const pr of d.props) {
      assert.equal(d.grid[pr.y][pr.x], Dungeon.TILE.FLOOR, 'props sit on FLOOR tiles');
      assert.ok(Balance.props.types[pr.type], `known prop type ${pr.type}`);
      assert.ok(Math.hypot(pr.x - d.entry.x, pr.y - d.entry.y) > 5, 'props keep clear of the entry');
      const key = pr.x + ',' + pr.y;
      assert.ok(!spawnKeys.has(key), 'a prop never shares a tile with a spawn');
      assert.ok(!seen.has(key), 'one prop per tile');
      seen.add(key);
    }
  }
});

test('prop placement is deterministic per (seed, floor)', () => {
  const a = Dungeon.generateDungeon(99, 3).props;
  const b = Dungeon.generateDungeon(99, 3).props;
  assert.deepEqual(a, b);
  const c = Dungeon.generateDungeon(100, 3).props;
  assert.notDeepEqual(a, c); // a different seed dresses rooms differently
});

// ---- Pure props tables ----

test('pickType honours weights and floor gates, never rolling chests', () => {
  const rng = U.mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(Props.pickType(rng, 1));
  assert.ok(!seen.has('chest'), 'chests are placed by chance, not the weighted pool');
  assert.ok(!seen.has('stand'), 'stand is gated to floor >= 2');
  assert.ok(seen.has('pot') && seen.has('barrel'), 'common clutter appears on floor 1');
  const deep = new Set();
  for (let i = 0; i < 2000; i++) deep.add(Props.pickType(rng, 5));
  assert.ok(deep.has('stand'), 'stand unlocks on deeper floors');
});

test('rollLoot: chests always cough up gold and scale it with depth', () => {
  const shallow = Props.rollLoot('chest', 1, U.mulberry32(3));
  const deep = Props.rollLoot('chest', 10, U.mulberry32(3));
  const gold = (drops) => drops.filter((d) => d.kind === 'gold').reduce((s, d) => s + d.amount, 0);
  assert.ok(gold(shallow) > 0, 'a chest always yields gold');
  assert.ok(gold(deep) > gold(shallow), 'floor 10 chest gold beats floor 1 for the same rolls');
  for (const d of deep) {
    if (d.kind === 'gold') assert.ok(d.amount >= 1);
    else assert.equal(d.kind, 'item'), assert.ok(d.item && d.item.name);
  }
});

// ---- Live state ----

test('makeFloorState instantiates live props with full hp', () => {
  const state = Game.newRun(555);
  assert.ok(state.props.length > 0, 'a fresh run has standing props');
  for (const prop of state.props) {
    assert.equal(prop.hp, prop.maxHP);
    assert.equal(prop.maxHP, Props.hp(prop.type));
    assert.ok(prop.size > 0 && prop.id > 0);
  }
});

test('props do not block movement (walk-through decorations)', () => {
  const state = Game.newRun(42);
  const prop = state.props[0];
  // Collision reads only wall tiles; a prop's own tile stays passable.
  assert.equal(G.collides(state.dungeon.grid, prop.x, prop.y, 11), false);
});

// ---- Smashing ----

test('a melee swing shatters an adjacent prop', () => {
  const state = Game.newRun(2024);
  state.monsters = [];
  const p = state.player;
  p.facing = 0; // face +x
  const pot = { id: 9001, type: 'pot', x: p.x + 20, y: p.y, size: Props.TYPES.pot.size, hp: Props.hp('pot'), maxHP: Props.hp('pot'), hitT: 0 };
  state.props = [pot];
  Game.update(state, freshInput({ keys: { space: true } }), 1 / 60);
  assert.ok(!state.props.includes(pot), 'the pot is gone after a swing lands');
});

test('breaking a chest drops loot onto the floor', () => {
  const state = Game.newRun(2025);
  state.groundItems = [];
  const p = state.player;
  const chest = { id: 9002, type: 'chest', x: p.x + 10, y: p.y, size: Props.TYPES.chest.size, hp: Props.hp('chest'), maxHP: Props.hp('chest'), hitT: 0 };
  state.props = [chest];
  G.hitProp(state, chest, 999); // one lethal blow
  assert.ok(!state.props.includes(chest), 'the chest shattered');
  const gold = state.groundItems.filter((g) => g.kind === 'gold');
  assert.ok(gold.length > 0, 'a chest always spills gold');
  assert.ok(gold[0].amount > 0);
});

test('a non-lethal hit chips a prop and flags it damaged', () => {
  const state = Game.newRun(7);
  const table = { id: 9003, type: 'table', x: 0, y: 0, size: Props.TYPES.table.size, hp: Props.hp('table'), maxHP: Props.hp('table'), hitT: 0 };
  state.props = [table];
  G.hitProp(state, table, 3);
  assert.ok(state.props.includes(table), 'a light hit does not destroy a sturdy table');
  assert.ok(table.hp < table.maxHP, 'hp dropped');
  assert.ok(table.hitT > 0, 'hit flash armed');
});

test('an arrow shatters a prop in its path', () => {
  const state = Game.newRun(88);
  state.monsters = [];
  const p = state.player;
  const barrel = { id: 9004, type: 'barrel', x: p.x + 40, y: p.y, size: Props.TYPES.barrel.size, hp: Props.hp('barrel'), maxHP: Props.hp('barrel'), hitT: 0 };
  state.props = [barrel];
  state.projectiles = [{ id: state.nextId++, ownerId: p.id, x: p.x + 40, y: p.y, vx: 0, vy: 0, dmg: 999, kind: 'arrow', aoe: 0, ttl: 1, angle: 0 }];
  G.updateProjectiles(state, 1 / 60);
  assert.ok(!state.props.includes(barrel), 'the arrow broke the barrel');
});
