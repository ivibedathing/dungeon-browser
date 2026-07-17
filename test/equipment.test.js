const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const Items = require('../js/items.js');
const E = require('../js/entities.js');

const ARMOR_SLOTS = ['helmet', 'armor', 'gloves', 'pants', 'boots'];

test('EQUIP_SLOTS lists all seven wearable slots', () => {
  assert.deepEqual(Items.EQUIP_SLOTS, ['weapon', 'helmet', 'armor', 'gloves', 'pants', 'boots', 'ring']);
});

test('newPlayer has every equipment slot, only the weapon filled', () => {
  const p = E.newPlayer();
  for (const slot of Items.EQUIP_SLOTS) {
    assert.ok(slot in p.equip, `equip has ${slot}`);
  }
  assert.ok(p.equip.weapon);
  for (const slot of ['helmet', 'gloves', 'pants', 'boots', 'armor', 'ring']) {
    assert.equal(p.equip[slot], null);
  }
});

test('new armor pieces roll defense; gloves add attack speed, boots add move speed', () => {
  const rng = U.mulberry32(42);
  for (let i = 0; i < 200; i++) {
    for (const slot of ARMOR_SLOTS) {
      const item = Items.makeItem(1 + (i % 8), rng, { slot });
      assert.equal(item.slot, slot);
      assert.ok(item.stats.defense >= 1, `${slot} defense ${item.stats.defense}`);
      if (slot === 'gloves') {
        assert.ok(item.stats.speedMult >= 0.02 && item.stats.speedMult <= 0.15, `gloves speedMult ${item.stats.speedMult}`);
      }
      if (slot === 'boots') {
        assert.ok(item.stats.moveMult >= 0.02 && item.stats.moveMult <= 0.15, `boots moveMult ${item.stats.moveMult}`);
      }
      assert.ok(typeof item.name === 'string' && item.name.length > 0);
    }
  }
});

test('unconstrained drops roll every slot eventually', () => {
  const rng = U.mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(Items.makeItem(3, rng).slot);
  for (const slot of Items.EQUIP_SLOTS) {
    assert.ok(seen.has(slot), `slot ${slot} never dropped`);
  }
});

test('aggregateStats sums defense across all pieces and applies base speed/move bonuses', () => {
  const equip = {
    weapon: { slot: 'weapon', stats: { damage: 10, radius: 80, speed: 2 }, affixes: [] },
    helmet: { slot: 'helmet', stats: { defense: 2, maxHP: 10 }, affixes: [] },
    armor: { slot: 'armor', stats: { defense: 4 }, affixes: [] },
    gloves: { slot: 'gloves', stats: { defense: 1, speedMult: 0.1 }, affixes: [] },
    pants: { slot: 'pants', stats: { defense: 2 }, affixes: [] },
    boots: { slot: 'boots', stats: { defense: 1, moveMult: 0.05 }, affixes: [] },
    ring: { slot: 'ring', stats: {}, affixes: [{ key: 'speedMult', val: 0.1, label: '+10% Attack Speed' }] },
  };
  const s = Items.aggregateStats(equip);
  assert.equal(s.defense, 10, 'defense from all five pieces');
  assert.equal(s.maxHP, 10);
  assert.ok(Math.abs(s.speed - 2 * (1 + 0.1 + 0.1)) < 1e-9, `glove base + ring affix speed (got ${s.speed})`);
  assert.ok(Math.abs(s.moveMult - 1.05) < 1e-9, `boots move bonus (got ${s.moveMult})`);
});

test('equipFromBag equips each new slot type', () => {
  const rng = U.mulberry32(9);
  const player = E.newPlayer();
  const bag = Items.createBag();
  for (const slot of ARMOR_SLOTS) {
    const item = Items.makeItem(2, rng, { slot });
    Items.addItem(bag, item);
    const idx = bag.slots.indexOf(item);
    assert.equal(Items.equipFromBag(player, bag, idx), true, `equips ${slot}`);
    assert.equal(player.equip[slot], item);
  }
  const s = E.effectiveStats(player);
  assert.ok(s.defense >= 5, `all pieces contribute defense (got ${s.defense})`);
});
