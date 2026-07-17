const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Save = require('../js/save.js');
globalThis.Save = Save;
const Game = require('../js/game.js');

// In-memory localStorage stand-in.
function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

beforeEach(() => {
  Save._storage = mockStorage();
});

test('write/load round-trips a run and fromSave rebuilds the same world', () => {
  let state = Game.newRun(777);
  state.floor = 4;
  state.kills = 12;
  state.bag.gold = 55;
  Entities.gainXP(state.player, Entities.xpForLevel(1) + Entities.xpForLevel(2));
  state.player.hp = 61;
  const rng = U.mulberry32(1);
  const sword = Items.makeItem(4, rng, { slot: 'weapon', rarity: 'rare' });
  Items.addItem(state.bag, sword);
  Items.addItem(state.bag, Items.makePotion(4, rng));

  Save.write(state);
  const data = Save.load();
  assert.ok(data, 'save loads back');

  const restored = Game.fromSave(data);
  assert.equal(restored.floor, 4);
  assert.equal(restored.kills, 12);
  assert.equal(restored.bag.gold, 55);
  assert.equal(restored.player.level, 3);
  assert.equal(restored.player.hp, 61);
  assert.equal(restored.player.baseMaxHP, state.player.baseMaxHP);
  assert.equal(restored.player.baseDamage, state.player.baseDamage);
  assert.equal(restored.player.equip.weapon.name, state.player.equip.weapon.name);
  const restoredSword = restored.bag.slots.find((i) => i && i.slot === 'weapon');
  assert.deepEqual(restoredSword, JSON.parse(JSON.stringify(sword)));
  assert.ok(restored.bag.belt.some((p) => p && p.slot === 'potion'), 'belt potion survives');

  // Dungeon must regenerate identically from (runSeed, floor).
  const expected = Dungeon.generateDungeon(777, 4);
  assert.deepEqual(restored.dungeon.grid, expected.grid);
  const expectedCount = expected.spawns.length + (expected.boss ? 1 : 0);
  assert.equal(restored.monsters.length, expectedCount, 'monsters repopulated (boss included on even floors)');
  // Player stands at the entry of the regenerated floor.
  const ts = Dungeon.TILE_SIZE;
  assert.equal(Math.floor(restored.player.x / ts), expected.entry.x);
  assert.equal(Math.floor(restored.player.y / ts), expected.entry.y);
  // Transient combat fields are rebuilt fresh.
  assert.equal(restored.player.healPool, 0);
  assert.equal(restored.player.swing, null);
  assert.equal(restored.dead, false);
});

test('load returns null for corrupt or missing data', () => {
  assert.equal(Save.load(), null, 'missing → null');
  Save._storage.setItem(Save.KEY, '{not json');
  assert.equal(Save.load(), null, 'corrupt → null');
  Save._storage.setItem(Save.KEY, JSON.stringify({ version: 999 }));
  assert.equal(Save.load(), null, 'wrong version → null');
});

test('clear removes the save', () => {
  const state = Game.newRun(5);
  Save.write(state);
  assert.ok(Save.load());
  Save.clear();
  assert.equal(Save.load(), null);
});

test('records keep the best floor and level across runs', () => {
  assert.deepEqual(Save.records(), { bestFloor: 0, bestLevel: 0 });
  Save.updateRecords({ floor: 5, player: { level: 4 } });
  assert.deepEqual(Save.records(), { bestFloor: 5, bestLevel: 4 });
  Save.updateRecords({ floor: 3, player: { level: 9 } });
  assert.deepEqual(Save.records(), { bestFloor: 5, bestLevel: 9 }, 'each best tracked independently');
});

test('mute preference persists independently of the run save', () => {
  assert.equal(Save.getMuted(), false, 'default unmuted');
  Save.setMuted(true);
  assert.equal(Save.getMuted(), true);
  Save.clear();
  assert.equal(Save.getMuted(), true, 'survives run reset');
});

test('storage failures never throw (private mode safety)', () => {
  Save._storage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  assert.doesNotThrow(() => Save.write(Game.newRun(1)));
  assert.equal(Save.load(), null);
  assert.doesNotThrow(() => Save.clear());
  assert.deepEqual(Save.records(), { bestFloor: 0, bestLevel: 0 });
  assert.doesNotThrow(() => Save.setMuted(true));
  assert.equal(Save.getMuted(), false);
});
