const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Save = require('../js/save.js');
globalThis.Save = Save;
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); input.pressed.clear(); }
  return state;
}
function enterTown(state, input) {
  state.portalCdT = 0;
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  const portal = state.portals.find((po) => po.kind === 'town');
  state.player.x = portal.x;
  state.player.y = portal.y;
  return run(state, input, 60);
}

test('weapons level up: +8% damage per plus, capped at +10, named +N', () => {
  const weapon = { slot: 'weapon', kind: 'melee', base: 'Short Sword', name: 'Short Sword', rarity: 'common', ilvl: 1, stats: { damage: 10, radius: 78, speed: 2.4, arc: 2.97, kb: 130 }, affixes: [] };
  assert.equal(Items.weaponDamage(weapon), 10, 'unupgraded damage is the base roll');
  assert.equal(Items.displayName(weapon), 'Short Sword');

  assert.equal(Items.upgradeItem(weapon), true);
  assert.equal(weapon.plus, 1);
  assert.equal(Items.weaponDamage(weapon), Math.round(10 * 1.08));
  assert.equal(Items.displayName(weapon), '+1 Short Sword');

  for (let i = 0; i < 20; i++) Items.upgradeItem(weapon);
  assert.equal(weapon.plus, 10, 'hard cap at +10');
  assert.equal(Items.upgradeItem(weapon), false, 'no upgrades past the cap');
  assert.equal(Items.weaponDamage(weapon), Math.round(10 * 1.8));

  const equip = { weapon };
  assert.equal(Items.aggregateStats(equip).damage, Math.round(10 * 1.8), 'aggregate uses upgraded damage');
});

test('upgrade costs rise with plus, item level, and rarity; sell value rises with plus', () => {
  const mk = (rarity, ilvl, plus) => ({ slot: 'weapon', base: 'Short Sword', name: 'x', rarity, ilvl, plus, stats: { damage: 10 }, affixes: [] });
  const c0 = Items.upgradeCost(mk('common', 1, 0));
  const c3 = Items.upgradeCost(mk('common', 1, 3));
  assert.ok(c0 > 0);
  assert.ok(c3 > c0 * 2, `escalates with plus (${c0} → ${c3})`);
  assert.ok(Items.upgradeCost(mk('unique', 1, 0)) > Items.upgradeCost(mk('common', 1, 0)) * 2, 'uniques cost more');
  assert.ok(Items.upgradeCost(mk('common', 8, 0)) > Items.upgradeCost(mk('common', 1, 0)), 'deep items cost more');
  assert.ok(Items.sellPrice(mk('common', 3, 4)) > Items.sellPrice(mk('common', 3, 0)), 'upgrades add sell value');
});

test('the town has a blacksmith on a walkable, reachable tile', () => {
  const t = Dungeon.generateTown(5);
  assert.ok(t.smith, 'smith exists');
  assert.ok(Dungeon.isWalkable(t.grid[t.smith.y][t.smith.x]), 'smith spot walkable');
  const field = Dungeon.flowField(t.grid, t.entry.x, t.entry.y, Infinity);
  assert.ok(field[t.smith.y][t.smith.x] !== Infinity, 'smith reachable');
  const dWell = Math.hypot(t.smith.x - t.well.x, t.smith.y - t.well.y);
  const dVendor = Math.hypot(t.smith.x - t.vendor.x, t.smith.y - t.vendor.y);
  assert.ok(dWell > 4 && dVendor > 4, 'smith keeps his own corner');
});

test('standing at the anvil enables smithing; E hammers the equipped weapon for gold', () => {
  let state = Game.newRun(81);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  assert.equal(state.smithing, false, 'not smithing from the entry');

  state.player.x = (state.dungeon.smith.x + 0.5) * TS + 20;
  state.player.y = (state.dungeon.smith.y + 0.5) * TS;
  state = run(state, input, 2);
  assert.equal(state.smithing, true, 'in range of the anvil');

  const weapon = state.player.equip.weapon;
  const cost = Items.upgradeCost(weapon);
  state.bag.gold = cost + 5;
  input.pressed.add('interact');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(weapon.plus, 1, 'equipped weapon upgraded');
  assert.equal(state.bag.gold, 5, 'exact cost charged');

  // Broke: no upgrade.
  state.bag.gold = 0;
  input.pressed.add('interact');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(weapon.plus, 1, 'no gold, no hammering');
});

test('armour levels up: +8% defense per plus, leaving its other rolls alone', () => {
  const boots = { slot: 'boots', base: 'Leather Boots', name: 'Leather Boots', rarity: 'common', ilvl: 2, stats: { defense: 20, maxHP: 15, moveMult: 0.1 }, affixes: [] };
  assert.equal(Items.armorDefense(boots), 20, 'unupgraded defense is the base roll');

  assert.equal(Items.upgradeItem(boots), true);
  assert.equal(boots.plus, 1);
  assert.ok(Math.abs(Items.armorDefense(boots) - 20 * 1.08) < 1e-9);
  assert.equal(Items.displayName(boots), '+1 Leather Boots');

  for (let i = 0; i < 20; i++) Items.upgradeItem(boots);
  assert.equal(boots.plus, 10, 'hard cap at +10');
  assert.ok(Math.abs(Items.armorDefense(boots) - 20 * 1.8) < 1e-9);
  assert.equal(boots.stats.maxHP, 15, 'Life roll untouched by honing');
  assert.equal(boots.stats.moveMult, 0.1, 'move roll untouched by honing');

  const agg = Items.aggregateStats({ boots });
  assert.equal(agg.defense, Math.round(20 * 1.8), 'aggregate uses upgraded defense');
  assert.equal(agg.maxHP, 15);
});

// Base defense rolls are 1–9, so per-piece rounding would eat whole upgrade
// levels. Honing a full set of low-defense commons must still move the number.
test('honing low-defense pieces accumulates instead of rounding away', () => {
  const piece = (slot) => ({ slot, name: slot, rarity: 'common', ilvl: 1, stats: { defense: 1 }, affixes: [] });
  const equip = {};
  for (const slot of ['helmet', 'armor', 'gloves', 'pants', 'boots']) equip[slot] = piece(slot);
  assert.equal(Items.aggregateStats(equip).defense, 5, 'five def-1 pieces');

  for (const slot of Object.keys(equip)) for (let i = 0; i < 10; i++) Items.upgradeItem(equip[slot]);
  assert.equal(Items.aggregateStats(equip).defense, 9, 'a fully honed set of def-1 commons: 5 → 9');

  const one = piece('boots');
  Items.upgradeItem(one);
  assert.equal(Items.formatDefense(Items.armorDefense(one)), '1.1', 'the tooltip shows the fraction it bought');
});

test('every worn slot but the ring is smithable', () => {
  assert.deepEqual(Items.SMITHABLE_SLOTS, ['weapon', 'helmet', 'armor', 'gloves', 'pants', 'boots']);
  for (const slot of Items.SMITHABLE_SLOTS) {
    assert.equal(Items.isSmithable({ slot, stats: {} }), true, `${slot} is smithable`);
  }
  const ring = { slot: 'ring', name: 'Band', stats: { defense: 5 }, affixes: [] };
  assert.equal(Items.isSmithable(ring), false, 'Borin will not work a ring');
  assert.equal(Items.upgradeItem(ring), false, 'rings take no plus');
  assert.equal(ring.plus, undefined);
  assert.equal(Items.isSmithable({ slot: 'potion' }), false, 'potions are not gear');
  assert.equal(Items.isSmithable(null), false);
});

test('smithUpgrade works on bag gear, and refuses rings and the cap', () => {
  let state = Game.newRun(82);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.player.x = (state.dungeon.smith.x + 0.5) * TS + 20;
  state.player.y = (state.dungeon.smith.y + 0.5) * TS;
  state = run(state, input, 2);

  const rng = U.mulberry32(4);
  const bow = Items.makeItem(2, rng, { slot: 'weapon', kind: 'bow' });
  const boots = Items.makeItem(2, rng, { slot: 'boots' });
  const ring = Items.makeItem(2, rng, { slot: 'ring' });
  Items.addItem(state.bag, bow);
  Items.addItem(state.bag, boots);
  Items.addItem(state.bag, ring);
  state.bag.gold = 100000;

  const bowIdx = state.bag.slots.indexOf(bow);
  assert.equal(Game.smithUpgrade(state, 'bag', bowIdx), true, 'bag bow upgraded');
  assert.equal(bow.plus, 1);
  assert.equal(Game.smithUpgrade(state, 'bag', state.bag.slots.indexOf(boots)), true, 'bag boots upgraded');
  assert.equal(boots.plus, 1);
  assert.equal(Game.smithUpgrade(state, 'bag', state.bag.slots.indexOf(ring)), false, 'rings are not smithable');

  bow.plus = 10;
  assert.equal(Game.smithUpgrade(state, 'bag', bowIdx), false, 'cap respected');

  assert.equal(Game.smithUpgrade(state, 'equip', 'weapon'), true, 'equipped path works too');
  assert.equal(state.player.equip.weapon.plus, 1);

  // Out of smithing range → refused.
  state.player.x = (state.dungeon.entry.x + 0.5) * TS;
  state.player.y = (state.dungeon.entry.y + 0.5) * TS;
  state = run(state, input, 2);
  assert.equal(Game.smithUpgrade(state, 'equip', 'weapon'), false, 'no anvil, no upgrade');
});

test('weapon plus survives the save round trip', () => {
  const map = new Map();
  Save._storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  let state = Game.newRun(83);
  state.player.equip.weapon.plus = 4;
  Save.write(state);
  const restored = Game.fromSave(Save.load());
  assert.equal(restored.player.equip.weapon.plus, 4);
  assert.equal(Items.displayName(restored.player.equip.weapon), '+4 Rusty Sword');
});
