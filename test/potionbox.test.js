// Potion box: dedicated 5+5 potion storage separate from the bag grid.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Save = require('../js/save.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;
const rng = () => U.mulberry32(77);

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

function atVendor(seed) {
  let state = Game.newRun(seed);
  state.monsters.length = 0;
  const input = freshInput();
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  state.player.x = state.portals[0].x;
  state.player.y = state.portals[0].y;
  state = run(state, input, 60);
  state.player.x = (state.dungeon.vendor.x + 0.5) * TS + 20;
  state.player.y = (state.dungeon.vendor.y + 0.5) * TS;
  state = run(state, input, 2);
  assert.equal(state.trading, true, 'trade mode near the vendor');
  return state;
}

test('potions route belt-first, then into the box by kind, never the bag grid', () => {
  const bag = Items.createBag();
  const r = rng();
  for (let i = 0; i < 4; i++) assert.equal(Items.addItem(bag, Items.makePotion(1, r, 'health')), true);
  assert.ok(bag.belt.every(Boolean), 'first four potions fill the belt');

  for (let i = 0; i < 5; i++) assert.equal(Items.addItem(bag, Items.makePotion(1, r, 'health')), true);
  assert.equal(bag.potions.health.length, 5, 'healing row filled');
  assert.ok(bag.slots.every((s) => s === null), 'grid untouched by potions');

  assert.equal(Items.addItem(bag, Items.makePotion(1, r, 'health')), false, 'healing row full');
  assert.ok(bag.slots.every((s) => s === null), 'overflow never lands in the grid');

  for (let i = 0; i < 5; i++) assert.equal(Items.addItem(bag, Items.makePotion(1, r, 'mana')), true);
  assert.equal(bag.potions.mana.length, 5, 'mana row filled');
  assert.equal(Items.addItem(bag, Items.makePotion(1, r, 'mana')), false, 'mana row full');

  assert.equal(Items.addItem(bag, Items.makeItem(2, r, { slot: 'weapon' })), true, 'gear still goes to the grid');
  assert.equal(bag.slots.filter(Boolean).length, 1);
});

test('the belt refills from the box: healing first, then mana', () => {
  const bag = Items.createBag();
  const r = rng();
  const h = Items.makePotion(1, r, 'health');
  const m1 = Items.makePotion(1, r, 'mana');
  const m2 = Items.makePotion(1, r, 'mana');
  bag.potions.health.push(h);
  bag.potions.mana.push(m1, m2);
  Items.refillBelt(bag);
  assert.equal(bag.belt[0], h, 'healing pulled first');
  assert.equal(bag.belt[1], m1, 'then mana');
  assert.equal(bag.belt[2], m2);
  assert.equal(bag.belt[3], null, 'nothing left to pull');
  assert.equal(bag.potions.health.length, 0);
  assert.equal(bag.potions.mana.length, 0);
});

test('clicking a box potion drinks it', () => {
  const state = Game.newRun(51);
  const potion = Items.makePotion(1, rng(), 'health');
  state.bag.potions.health.push(potion);
  state.player.hp = 10;
  assert.equal(Game.potionBoxClick(state, 'health', 0), true);
  assert.equal(state.bag.potions.health.length, 0, 'potion consumed');
  assert.ok(state.player.healPool > 0, 'healing over time started');
});

test('while trading, clicking a box potion sells it and stocks the buy-back shelf', () => {
  const state = atVendor(52);
  const potion = Items.makePotion(1, rng(), 'mana');
  state.bag.potions.mana.push(potion);
  const goldBefore = state.bag.gold;
  assert.equal(Game.potionBoxClick(state, 'mana', 0), true);
  assert.equal(state.bag.potions.mana.length, 0, 'potion sold');
  assert.equal(state.bag.gold, goldBefore + Items.sellPrice(potion), 'paid the sell price');
  assert.equal(state.buyback[0].item, potion, 'recoverable from the shelf');
});

test('right-clicking a box potion drops it on the ground', () => {
  const state = Game.newRun(53);
  const potion = Items.makePotion(1, rng(), 'health');
  state.bag.potions.health.push(potion);
  assert.equal(Game.potionBoxDrop(state, 'health', 0), true);
  assert.equal(state.bag.potions.health.length, 0);
  assert.ok(state.groundItems.some((g) => g.item === potion), 'potion on the ground');
});

test('picking up with belt and box full reports the potion box, not the bag', () => {
  let state = Game.newRun(54);
  state.monsters.length = 0;
  const r = rng();
  for (let i = 0; i < 9; i++) Items.addItem(state.bag, Items.makePotion(1, r, 'health'));
  assert.equal(state.bag.potions.health.length, 5, 'box full');
  state.groundItems.push({ id: 999, kind: 'item', item: Items.makePotion(1, r, 'health'), x: state.player.x, y: state.player.y });
  const input = freshInput();
  input.pressed.add('interact');
  state = Game.update(state, input, 1 / 60);
  const events = Game.drainEvents(state);
  assert.ok(
    events.some((e) => e.type === 'message' && /potion box is full/i.test(e.text)),
    `expected a potion-box-full message in ${JSON.stringify(events.filter((e) => e.type === 'message'))}`
  );
});

test('the potion box survives a save round-trip', () => {
  const state = Game.newRun(55);
  const r = rng();
  state.bag.potions.health.push(Items.makePotion(2, r, 'health'), Items.makePotion(2, r, 'health'));
  state.bag.potions.mana.push(Items.makePotion(2, r, 'mana'));
  const restored = Game.fromSave(Save.snapshot(state));
  assert.equal(restored.bag.potions.health.length, 2, 'healing row restored');
  assert.equal(restored.bag.potions.mana.length, 1, 'mana row restored');
  assert.ok(restored.bag.potions.health.every((p) => p.kind !== 'mana'), 'kinds preserved');
});

test('legacy saves with grid potions migrate them into the box', () => {
  const state = Game.newRun(56);
  const r = rng();
  const snap = Save.snapshot(state);
  delete snap.bag.potions;
  snap.bag.slots = new Array(Items.BAG_SIZE).fill(null);
  snap.bag.slots[0] = Items.makePotion(2, r, 'health');
  snap.bag.slots[5] = Items.makePotion(2, r, 'mana');
  snap.bag.slots[7] = Items.makeItem(2, r, { slot: 'boots' });
  const restored = Game.fromSave(snap);
  assert.equal(restored.bag.potions.health.length, 1, 'grid healing potion moved to the box');
  assert.equal(restored.bag.potions.mana.length, 1, 'grid mana potion moved to the box');
  assert.equal(restored.bag.slots[0], null, 'grid slot freed');
  assert.equal(restored.bag.slots[5], null, 'grid slot freed');
  assert.ok(restored.bag.slots[7], 'gear stays in the grid');
});
