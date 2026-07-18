const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const Items = require('../js/items.js');

const AFFIX_KEYS = ['damage', 'radius', 'speedMult', 'maxHP', 'maxMana', 'defense', 'lifePerKill', 'xpMult', 'moveMult'];

test('rollRarity matches the Balance rarity weights', () => {
  const Balance = require('../js/balance.js');
  const rng = U.mulberry32(2024);
  const counts = { common: 0, magic: 0, rare: 0, unique: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) counts[Items.rollRarity(rng)]++;
  const total = Object.values(Balance.rarity).reduce((a, b) => a + b, 0);
  for (const tier of Object.keys(counts)) {
    const expected = Balance.rarity[tier] / total;
    assert.ok(Math.abs(counts[tier] / N - expected) < 0.05, `${tier}: got ${counts[tier] / N}, expected ~${expected}`);
  }
});

test('rollRarity with magic guarantee never returns common', () => {
  const rng = U.mulberry32(7);
  for (let i = 0; i < 300; i++) {
    assert.notEqual(Items.rollRarity(rng, true), 'common');
  }
});

test('makeItem produces valid items with rarity-appropriate affix counts', () => {
  const rng = U.mulberry32(555);
  const expected = { common: [0, 0], magic: [1, 1], rare: [2, 3], unique: [3, 4] };
  for (let i = 0; i < 600; i++) {
    const item = Items.makeItem(1 + (i % 9), rng);
    assert.ok(Items.EQUIP_SLOTS.includes(item.slot), `slot ${item.slot}`);
    assert.ok(typeof item.name === 'string' && item.name.length > 0);
    assert.ok(['common', 'magic', 'rare', 'unique'].includes(item.rarity));
    const [lo, hi] = expected[item.rarity];
    assert.ok(
      item.affixes.length >= lo && item.affixes.length <= hi,
      `${item.rarity} rolled ${item.affixes.length} affixes`
    );
    for (const a of item.affixes) {
      assert.ok(AFFIX_KEYS.includes(a.key), `affix key ${a.key}`);
      assert.ok(a.val > 0);
      assert.ok(typeof a.label === 'string' && a.label.includes('+'));
    }
    if (item.slot === 'weapon') {
      assert.ok(item.stats.damage > 0);
      assert.ok(item.stats.speed > 0);
      assert.ok(typeof item.family === 'string' && item.family.length > 0, 'weapon has a family');
      if (item.kind === 'melee') {
        assert.ok(item.stats.radius >= 55, `radius ${item.stats.radius}`); // daggers reach ~58
      } else {
        assert.ok(item.stats.projSpeed >= 200, `projSpeed ${item.stats.projSpeed}`);
      }
    }
    if (['armor', 'helmet', 'gloves', 'pants', 'boots'].includes(item.slot)) {
      assert.ok(item.stats.defense >= 1);
    }
  }
});

test('weapon damage scales up with floor', () => {
  const rng = U.mulberry32(31337);
  const avg = (floor) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const it = Items.makeItem(floor, rng, { slot: 'weapon' });
      sum += it.stats.damage;
      n++;
    }
    return sum / n;
  };
  const a1 = avg(1);
  const a8 = avg(8);
  assert.ok(a8 > a1 * 1.5, `floor8 avg ${a8.toFixed(1)} vs floor1 avg ${a1.toFixed(1)}`);
});

test('potions heal more on deeper floors and never heal zero', () => {
  const rng = U.mulberry32(9);
  let prev = 0;
  for (let floor = 1; floor <= 9; floor += 2) {
    const p = Items.makePotion(floor, rng);
    assert.equal(p.slot, 'potion');
    assert.ok(p.heal > 0);
    assert.ok(p.heal >= prev, `floor ${floor} heal ${p.heal} < previous ${prev}`);
    assert.ok(typeof p.name === 'string' && p.name.length > 0);
    prev = p.heal;
  }
});

test('aggregateStats combines base stats and affixes across equipment', () => {
  const equip = {
    weapon: {
      slot: 'weapon',
      stats: { damage: 10, radius: 80, speed: 2 },
      affixes: [{ key: 'damage', val: 3, label: '+3 Damage' }],
    },
    armor: {
      slot: 'armor',
      stats: { defense: 4 },
      affixes: [{ key: 'maxHP', val: 20, label: '+20 to Life' }],
    },
    ring: {
      slot: 'ring',
      stats: {},
      affixes: [
        { key: 'lifePerKill', val: 2, label: '+2 Life per Kill' },
        { key: 'speedMult', val: 0.2, label: '+20% Attack Speed' },
        { key: 'xpMult', val: 0.15, label: '+15% Experience' },
      ],
    },
  };
  const s = Items.aggregateStats(equip);
  assert.equal(s.damage, 13);
  assert.equal(s.radius, 80);
  assert.ok(Math.abs(s.speed - 2.4) < 1e-9);
  assert.equal(s.maxHP, 20);
  assert.equal(s.defense, 4);
  assert.equal(s.lifePerKill, 2);
  assert.ok(Math.abs(s.xpMult - 1.15) < 1e-9);
  assert.equal(s.moveMult, 1);
});

test('aggregateStats provides sane unarmed fallbacks', () => {
  const s = Items.aggregateStats({});
  assert.ok(s.damage > 0);
  assert.ok(s.radius >= 50);
  assert.ok(s.speed > 0);
  assert.equal(s.defense, 0);
});

test('bag stores potions in the belt first, then overflow into the potion box', () => {
  const rng = U.mulberry32(3);
  const bag = Items.createBag();
  assert.equal(bag.belt.length, 4);
  assert.equal(bag.slots.length, 24);
  assert.equal(bag.gold, 0);
  for (let i = 0; i < 5; i++) {
    assert.equal(Items.addItem(bag, Items.makePotion(1, rng)), true);
  }
  assert.ok(bag.belt.every((p) => p && p.slot === 'potion'), 'belt full of potions');
  assert.equal(bag.potions.health.length, 1, 'fifth potion overflows into the box');
  assert.equal(bag.slots[0], null, 'the bag grid stays reserved for gear');
});

test('useBeltPotion consumes a potion and refills from the potion box', () => {
  const rng = U.mulberry32(4);
  const bag = Items.createBag();
  for (let i = 0; i < 5; i++) Items.addItem(bag, Items.makePotion(1, rng));
  const used = Items.useBeltPotion(bag, 0);
  assert.ok(used && used.heal > 0);
  assert.ok(bag.belt[0] && bag.belt[0].slot === 'potion', 'belt slot refilled from the box');
  assert.equal(bag.potions.health.length, 0, 'box potion moved into belt');
  assert.equal(Items.useBeltPotion(bag, 0) !== null, true);
  // Drain everything
  Items.useBeltPotion(bag, 0);
  Items.useBeltPotion(bag, 0);
  Items.useBeltPotion(bag, 1);
  Items.useBeltPotion(bag, 2);
  Items.useBeltPotion(bag, 3);
  assert.equal(Items.useBeltPotion(bag, 0), null, 'empty belt returns null');
});

test('addItem returns false when the bag is full', () => {
  const rng = U.mulberry32(5);
  const bag = Items.createBag();
  let added = 0;
  for (let i = 0; i < 40; i++) {
    if (Items.addItem(bag, Items.makeItem(1, rng, { slot: 'ring' }))) added++;
  }
  assert.equal(added, 24, 'non-potions fill only the 24 slots');
  assert.equal(Items.addItem(bag, Items.makeItem(1, rng, { slot: 'ring' })), false);
});

test('removeItem clears the slot and returns the item', () => {
  const rng = U.mulberry32(6);
  const bag = Items.createBag();
  const item = Items.makeItem(2, rng, { slot: 'weapon' });
  Items.addItem(bag, item);
  const got = Items.removeItem(bag, 0);
  assert.equal(got, item);
  assert.equal(bag.slots[0], null);
  assert.equal(Items.removeItem(bag, 0), null);
});

test('equipFromBag swaps bag item with currently equipped item', () => {
  const rng = U.mulberry32(8);
  const oldWeapon = Items.makeItem(1, rng, { slot: 'weapon' });
  const newWeapon = Items.makeItem(3, rng, { slot: 'weapon' });
  const player = { equip: { weapon: oldWeapon, armor: null, ring: null } };
  const bag = Items.createBag();
  Items.addItem(bag, newWeapon);
  assert.equal(Items.equipFromBag(player, bag, 0), true);
  assert.equal(player.equip.weapon, newWeapon);
  assert.equal(bag.slots[0], oldWeapon, 'old weapon returned to the bag slot');

  const armor = Items.makeItem(1, rng, { slot: 'armor' });
  Items.addItem(bag, armor);
  const armorIdx = bag.slots.indexOf(armor);
  assert.equal(Items.equipFromBag(player, bag, armorIdx), true);
  assert.equal(player.equip.armor, armor);
  assert.equal(bag.slots[armorIdx], null, 'nothing was equipped before, slot now empty');

  assert.equal(Items.equipFromBag(player, bag, 20), false, 'empty slot is a no-op');
});
