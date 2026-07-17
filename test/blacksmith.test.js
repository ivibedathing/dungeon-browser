const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
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

  assert.equal(Items.upgradeWeapon(weapon), true);
  assert.equal(weapon.plus, 1);
  assert.equal(Items.weaponDamage(weapon), Math.round(10 * 1.08));
  assert.equal(Items.displayName(weapon), '+1 Short Sword');

  for (let i = 0; i < 20; i++) Items.upgradeWeapon(weapon);
  assert.equal(weapon.plus, 10, 'hard cap at +10');
  assert.equal(Items.upgradeWeapon(weapon), false, 'no upgrades past the cap');
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

test('smithUpgrade works on bag weapons and refuses non-weapons and the cap', () => {
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
  Items.addItem(state.bag, bow);
  Items.addItem(state.bag, boots);
  state.bag.gold = 100000;

  const bowIdx = state.bag.slots.indexOf(bow);
  assert.equal(Game.smithUpgrade(state, 'bag', bowIdx), true, 'bag bow upgraded');
  assert.equal(bow.plus, 1);
  assert.equal(Game.smithUpgrade(state, 'bag', state.bag.slots.indexOf(boots)), false, 'boots are not smithable');

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
