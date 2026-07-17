const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const Items = require('../js/items.js');

const ARMOR_SLOTS = ['armor', 'helmet', 'gloves', 'pants', 'boots'];

function rollBases(slot, floor, n) {
  const rng = U.mulberry32(slot.length * 1000 + floor);
  const seen = new Set();
  for (let i = 0; i < n; i++) seen.add(Items.makeItem(floor, rng, { slot }).base);
  return seen;
}

test('every armor slot has at least four base variants at depth, two at the surface', () => {
  for (const slot of ARMOR_SLOTS) {
    assert.ok(rollBases(slot, 9, 400).size >= 4, `${slot}: ${[...rollBases(slot, 9, 400)]} at floor 9`);
    assert.ok(rollBases(slot, 1, 400).size >= 2, `${slot} variety at floor 1`);
  }
});

test('deep bases never drop on floor 1', () => {
  const surface = new Set();
  for (const slot of ARMOR_SLOTS) {
    for (const base of rollBases(slot, 1, 500)) surface.add(base);
  }
  for (const deepName of ['Full Plate', 'Swift Striders', 'War Gauntlets', 'Horned Crown', 'Plated Cuisses']) {
    assert.ok(!surface.has(deepName), `${deepName} dropped on floor 1`);
  }
  // ...but they exist deep down.
  const deep = new Set();
  for (const slot of ARMOR_SLOTS) {
    for (const base of rollBases(slot, 9, 600)) deep.add(base);
  }
  assert.ok(deep.has('Full Plate'), 'Full Plate drops deep');
  assert.ok(deep.has('Swift Striders'), 'Swift Striders drop deep');
});

test('all armor pieces carry a weight-class tone for rendering', () => {
  const rng = U.mulberry32(77);
  for (let i = 0; i < 200; i++) {
    const item = Items.makeItem(1 + (i % 9), rng, { slot: ARMOR_SLOTS[i % ARMOR_SLOTS.length] });
    assert.ok(typeof item.tone === 'string' && item.tone.startsWith('#'), `${item.base} has tone`);
  }
});

test('base mana on caster helms and base move penalties on plate feed aggregateStats', () => {
  const equip = {
    helmet: { slot: 'helmet', stats: { defense: 2, maxMana: 8 }, affixes: [] },
    armor: { slot: 'armor', stats: { defense: 6, moveMult: -0.04 }, affixes: [] },
  };
  const s = Items.aggregateStats(equip);
  assert.equal(s.maxMana, 8, 'base mana counts');
  assert.ok(Math.abs(s.moveMult - 0.96) < 1e-9, `plate slows you down (got ${s.moveMult})`);
});

test('glove and boot bonuses stay within sane bounds across all bases and depths', () => {
  const rng = U.mulberry32(31);
  for (let i = 0; i < 400; i++) {
    const gloves = Items.makeItem(1 + (i % 9), rng, { slot: 'gloves' });
    assert.ok(gloves.stats.speedMult >= 0.02 && gloves.stats.speedMult <= 0.15, `${gloves.base} spd ${gloves.stats.speedMult}`);
    const boots = Items.makeItem(1 + (i % 9), rng, { slot: 'boots' });
    assert.ok(boots.stats.moveMult >= 0.02 && boots.stats.moveMult <= 0.15, `${boots.base} mv ${boots.stats.moveMult}`);
  }
});
