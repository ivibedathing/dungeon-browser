const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;
const WALKABLE = (t) => t === Dungeon.TILE.FLOOR || t === Dungeon.TILE.ENTRY;

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

function enterTown(state, input) {
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  const portal = state.portals[0];
  assert.ok(portal, 'portal opened');
  state.player.x = portal.x;
  state.player.y = portal.y;
  state = run(state, input, 60);
  assert.equal(state.inTown, true, 'arrived in town');
  return state;
}

test('generateTown produces a safe, connected map with a well and a vendor', () => {
  const t = Dungeon.generateTown(5);
  assert.equal(t.town, true);
  assert.equal(t.spawns.length, 0, 'no monsters in town');
  for (let y = 0; y < t.height; y++) {
    assert.equal(t.grid[y][0], Dungeon.TILE.WALL);
    assert.equal(t.grid[y][t.width - 1], Dungeon.TILE.WALL);
    for (let x = 0; x < t.width; x++) {
      assert.notEqual(t.grid[y][x], Dungeon.TILE.STAIRS_DOWN, 'no stairs in town');
    }
  }
  for (const spot of [t.entry, t.well, t.vendor]) {
    assert.ok(WALKABLE(t.grid[spot.y][spot.x]), `spot ${spot.x},${spot.y} walkable`);
  }
  const field = Dungeon.flowField(t.grid, t.entry.x, t.entry.y, Infinity);
  assert.ok(field[t.well.y][t.well.x] !== Infinity, 'well reachable');
  assert.ok(field[t.vendor.y][t.vendor.x] !== Infinity, 'vendor reachable');
});

test('T opens a portal, travel leads to town, and the return trip restores the dungeon exactly', () => {
  let state = Game.newRun(9);
  state.monsters.length = 0;
  const originalDungeon = state.dungeon;
  const originalGround = state.groundItems;
  const input = freshInput();

  state = enterTown(state, input);
  assert.equal(state.dungeon.town, true);
  assert.equal(state.monsters.length, 0, 'town is safe');
  assert.ok(state.shop && state.shop.length >= 3, 'shop stocked on arrival');
  const ret = state.portals.find((po) => po.kind === 'return');
  assert.ok(ret, 'return portal waits in town');

  const castSpot = { x: state.stash.portalPos.x, y: state.stash.portalPos.y };
  state.player.x = ret.x;
  state.player.y = ret.y;
  state = run(state, input, 90);
  assert.equal(state.inTown, false, 'back in the dungeon');
  assert.equal(state.dungeon, originalDungeon, 'dungeon restored by reference');
  assert.equal(state.groundItems, originalGround, 'ground items restored');
  assert.ok(Math.hypot(state.player.x - castSpot.x, state.player.y - castSpot.y) < 80, 'returned near the cast spot');
  assert.equal(state.portals.length, 0, 'portal consumed after the round trip');
  assert.equal(state.stash, null);
});

test('portal recast is blocked by cooldown, then replaces the old portal', () => {
  let state = Game.newRun(10);
  state.monsters.length = 0;
  const input = freshInput();
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.portals.length, 1);
  assert.ok(state.portalCdT > 10, 'cooldown armed');
  const first = state.portals[0];

  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.portals[0], first, 'cooldown blocks recast');

  state.portalCdT = 0;
  state.player.x += 64;
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.portals.length, 1, 'recast replaces, never stacks');
  assert.notEqual(state.portals[0], first, 'new portal after cooldown');
});

test('casting in town fizzles', () => {
  let state = Game.newRun(11);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.portalCdT = 0;
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.portals.filter((po) => po.kind === 'town').length, 0, 'no town portal inside town');
});

test('the healing well restores the player to full', () => {
  let state = Game.newRun(12);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.player.hp = 20;
  state.player.x = (state.dungeon.well.x + 0.5) * TS;
  state.player.y = (state.dungeon.well.y + 0.5) * TS;
  state = run(state, input, 30);
  assert.equal(state.player.hp, Entities.effectiveStats(state.player).maxHP, 'healed to full');
});

test('E opens and closes the vendor stall, which sells potions and buys items', () => {
  let state = Game.newRun(13);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.bag.gold = 500;

  state.player.x = (state.dungeon.vendor.x + 0.5) * TS + 20;
  state.player.y = (state.dungeon.vendor.y + 0.5) * TS;
  state = run(state, input, 2);
  assert.equal(state.trading, true, 'trade mode near the vendor');

  input.pressed.add('interact');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.invOpen, true, 'E opened the stall');
  assert.equal(state.trading, true, 'trade range stays frozen while the stall is open');

  // Buying the potion is now the stall's job, not the E key's.
  assert.equal(Game.buyPotion(state), true);
  assert.ok(state.bag.belt[0] && state.bag.belt[0].slot === 'potion', 'bought a potion into the belt');
  assert.ok(state.bag.gold < 500, 'gold spent');

  input.pressed.add('interact');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.invOpen, false, 'a second E closed the stall');

  // Selling from the bag.
  const goldBefore = state.bag.gold;
  const rng = U.mulberry32(3);
  const item = Items.makeItem(3, rng, { slot: 'armor', rarity: 'rare' });
  Items.addItem(state.bag, item);
  const idx = state.bag.slots.indexOf(item);
  assert.equal(Game.sellFromBag(state, idx), true);
  assert.equal(state.bag.slots[idx], null, 'item gone');
  assert.equal(state.bag.gold, goldBefore + Items.sellPrice(item), 'paid the sell price');

  // Buying from the shop stock.
  const entry = state.shop.find(Boolean);
  state.bag.gold = entry.price + 10;
  assert.equal(Game.buyShopItem(state, state.shop.indexOf(entry)), true);
  assert.equal(state.bag.gold, 10, 'stock price charged');
  assert.ok(state.bag.slots.includes(entry.item), 'stock item in the bag');

  state.bag.gold = 0;
  const entry2 = state.shop.find(Boolean);
  if (entry2) {
    assert.equal(Game.buyShopItem(state, state.shop.indexOf(entry2)), false, 'no gold, no goods');
  }
});

test('sell prices scale with rarity and item level', () => {
  const rng = U.mulberry32(4);
  const common = Items.makeItem(2, rng, { slot: 'armor', rarity: 'common' });
  const unique = Items.makeItem(2, rng, { slot: 'armor', rarity: 'unique' });
  assert.ok(Items.sellPrice(unique) > Items.sellPrice(common) * 4, 'uniques fetch far more');
  const shallow = Items.makeItem(1, rng, { slot: 'weapon', rarity: 'magic' });
  const deep = Items.makeItem(9, rng, { slot: 'weapon', rarity: 'magic' });
  assert.ok(Items.sellPrice(deep) > Items.sellPrice(shallow), 'deeper items are worth more');
  assert.ok(Items.buyPrice(common) > Items.sellPrice(common), 'the house always wins');
});

test('descending the stairs collapses any open portal', () => {
  let state = Game.newRun(14);
  state.monsters.length = 0;
  const input = freshInput();
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.portals.length, 1);
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  state = run(state, input, 3);
  assert.equal(state.floor, 2);
  assert.equal(state.portals.length, 0, 'portal collapsed on descent');
  assert.equal(state.stash, null);
});

function atVendor(seed) {
  let state = Game.newRun(seed);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.player.x = (state.dungeon.vendor.x + 0.5) * TS + 20;
  state.player.y = (state.dungeon.vendor.y + 0.5) * TS;
  state = run(state, input, 2);
  assert.equal(state.trading, true, 'trade mode near the vendor');
  return state;
}

test('selling stocks the buy-back shelf; buying back round-trips item and gold', () => {
  const state = atVendor(31);
  const item = Items.makeItem(3, U.mulberry32(9), { slot: 'armor', rarity: 'rare' });
  Items.addItem(state.bag, item);
  const idx = state.bag.slots.indexOf(item);
  const goldBefore = state.bag.gold;
  assert.equal(Game.sellFromBag(state, idx), true);
  assert.equal(state.buyback.length, 1, 'sale landed on the shelf');
  assert.equal(state.buyback[0].item, item, 'the exact item is recoverable');
  assert.equal(state.buyback[0].price, Items.sellPrice(item), 'shelf remembers the payout');

  assert.equal(Game.buyBack(state, 0), true);
  assert.equal(state.bag.gold, goldBefore, 'round trip costs nothing');
  assert.ok(state.bag.slots.includes(item), 'item back in the bag');
  assert.equal(state.buyback.length, 0, 'shelf slot freed');
});

test('the buy-back shelf keeps only the last three sales, newest first', () => {
  const state = atVendor(32);
  const rng = U.mulberry32(10);
  const items = [];
  for (let i = 0; i < 4; i++) {
    const it = Items.makeItem(2, rng, { slot: 'weapon' });
    items.push(it);
    Items.addItem(state.bag, it);
    assert.equal(Game.sellFromBag(state, state.bag.slots.indexOf(it)), true);
  }
  assert.equal(state.buyback.length, Game.BUYBACK_SIZE, 'capped at the shelf size');
  assert.equal(state.buyback[0].item, items[3], 'newest sale in front');
  assert.ok(!state.buyback.some((e) => e.item === items[0]), 'oldest sale fell off');
});

test('buy-back refuses without gold, bag space, or trading range', () => {
  const state = atVendor(33);
  const item = Items.makeItem(3, U.mulberry32(11), { slot: 'armor', rarity: 'rare' });
  Items.addItem(state.bag, item);
  assert.equal(Game.sellFromBag(state, state.bag.slots.indexOf(item)), true);

  state.bag.gold = 0;
  assert.equal(Game.buyBack(state, 0), false, 'no gold, no goods');
  assert.equal(state.buyback.length, 1, 'item stays on the shelf');

  state.bag.gold = 9999;
  state.bag.slots.fill(state.buyback[0].item === item ? Items.makeItem(1, U.mulberry32(12), { slot: 'ring' }) : null);
  assert.equal(Game.buyBack(state, 0), false, 'no bag space');
  assert.equal(state.buyback.length, 1, 'item still on the shelf');

  state.bag.slots.fill(null);
  state.trading = false;
  assert.equal(Game.buyBack(state, 0), false, 'must be at the vendor');
});

test('sell all liquidates the gear, keeps potions, and pays the summed prices', () => {
  const state = atVendor(34);
  const rng = U.mulberry32(13);
  const gear = [
    Items.makeItem(2, rng, { slot: 'weapon' }),
    Items.makeItem(2, rng, { slot: 'armor', rarity: 'magic' }),
    Items.makeItem(2, rng, { slot: 'boots' }),
  ];
  for (const it of gear) Items.addItem(state.bag, it);
  const potion = Items.makePotion(2, rng);
  state.bag.belt.fill(potion); // belt full so the spare potion lands in the box
  const spare = Items.makePotion(2, rng);
  Items.addItem(state.bag, spare);
  assert.ok(state.bag.potions.health.includes(spare), 'spare potion sits in the potion box');

  const goldBefore = state.bag.gold;
  const expected = gear.reduce((sum, it) => sum + Items.sellPrice(it), 0);
  assert.equal(Game.sellAll(state), true);
  assert.equal(state.bag.gold, goldBefore + expected, 'paid for every piece of gear');
  assert.ok(gear.every((it) => !state.bag.slots.includes(it)), 'gear gone');
  assert.ok(state.bag.potions.health.includes(spare), 'potions are kept');
  assert.equal(state.buyback[0].item, gear[2], 'sell-all stocks the shelf too');

  assert.equal(Game.sellAll(state), false, 'nothing left to sell');
});

test('sell all does nothing away from the vendor', () => {
  const state = atVendor(35);
  state.trading = false;
  Items.addItem(state.bag, Items.makeItem(2, U.mulberry32(14), { slot: 'weapon' }));
  assert.equal(Game.sellAll(state), false);
  assert.equal(state.buyback.length, 0);
});
