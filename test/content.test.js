// Phase 5 — the expanded content flows through drops, pricing, and upgrades.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const Items = require('../js/items.js');
const Entities = require('../js/entities.js');

const ALL_KINDS = ['melee', 'bow', 'crossbow', 'wand', 'staff', 'thrown'];

test('every weapon kind is priceable and sells for a positive amount', () => {
  const rng = U.mulberry32(2026);
  for (const kind of ALL_KINDS) {
    for (const rarity of ['common', 'magic', 'rare', 'unique']) {
      const w = Items.makeItem(9, rng, { slot: 'weapon', kind, rarity });
      const sell = Items.sellPrice(w);
      const buy = Items.buyPrice(w);
      assert.ok(sell > 0, `${kind}/${rarity} sells for ${sell}`);
      assert.ok(buy > sell, `${kind}/${rarity} buys higher than it sells`);
    }
  }
});

test('every weapon kind upgrades at the anvil and its damage/price climb', () => {
  const rng = U.mulberry32(99);
  for (const kind of ALL_KINDS) {
    const w = Items.makeItem(6, rng, { slot: 'weapon', kind, rarity: 'rare' });
    const dmg0 = Items.weaponDamage(w);
    const cost0 = Items.upgradeCost(w);
    assert.equal(Items.upgradeWeapon(w), true, `${kind} accepts an upgrade`);
    assert.equal(w.plus, 1);
    assert.ok(Items.weaponDamage(w) > dmg0, `${kind} damage rises with +1`);
    assert.ok(Items.upgradeCost(w) > cost0, `${kind} next upgrade costs more`);
  }
});

test('drops surface the full weapon-kind spread at depth', () => {
  const rng = U.mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 6000; i++) {
    const it = Items.makeItem(9, rng, { slot: 'weapon' });
    seen.add(it.kind);
  }
  for (const kind of ALL_KINDS) assert.ok(seen.has(kind), `${kind} should drop at floor 9`);
});

test('the display name carries the +N upgrade prefix on any weapon', () => {
  const w = Items.makeItem(3, U.mulberry32(3), { slot: 'weapon', kind: 'crossbow' });
  Items.upgradeWeapon(w);
  Items.upgradeWeapon(w);
  assert.ok(Items.displayName(w).startsWith('+2 '), `display name was "${Items.displayName(w)}"`);
});

test('behavior monsters are priced into the world as normal foes (loot on kill path)', () => {
  // makeMonster produces coherent, positive rewards for the special archetypes so the
  // XP/loot pipeline treats them like any other kill.
  for (const type of ['cultist', 'bomber', 'gargoyle', 'necromancer']) {
    const m = Entities.makeMonster(type, 6, false);
    assert.ok(m.xp > 0 && m.hp > 0, `${type} rewards`);
    assert.equal(m.behavior, { cultist: 'ranged', bomber: 'exploder', gargoyle: 'charger', necromancer: 'summoner' }[type]);
  }
  // A plain melee type reports the default behavior.
  assert.equal(Entities.makeMonster('zombie', 1, false).behavior, 'melee');
});
