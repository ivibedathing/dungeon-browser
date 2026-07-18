// Phase 4.5 Track C — progression intents applied server-side. The load-bearing
// property: only indices/ids cross the wire, the server reads its OWN tables, and a
// forged stat field is rejected — never a trusted number.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Props = require('../js/props.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const Intents = require('../server/intents.js');
const Protocol = require('../server/protocol.js');

function freshState() {
  const state = Game.newRun(1234);
  return state;
}

test('equip: applying an intent changes the server-side effectiveStats', () => {
  const state = freshState();
  const p = state.player;
  // Put a strong weapon in bag slot 0.
  const better = Items.makeItem(5, U.mulberry32(3), { slot: 'weapon', rarity: 'rare' });
  p.bag.slots[0] = better;
  const before = Entities.effectiveStats(p).damage;
  const res = Intents.apply(state, p, { intent: 'equip', slot: 0 });
  assert.equal(res.ok, true);
  assert.equal(p.equip.weapon, better, 'the server equipped the bag item');
  assert.notEqual(Entities.effectiveStats(p).damage, before, 'server stats recomputed');
});

test('a forged stat field on an intent is rejected by the protocol (not silently ignored)', () => {
  const good = Protocol.validateClient({ t: 'intent', intent: 'equip', slot: 2 });
  assert.equal(good.ok, true);
  const forged = Protocol.validateClient({ t: 'intent', intent: 'equip', slot: 2, damage: 999 });
  assert.equal(forged.ok, false, 'an unexpected key is a hard reject');
  const forged2 = Protocol.validateClient({ t: 'intent', intent: 'buy', index: 0, price: 0, stats: { damage: 1 } });
  assert.equal(forged2.ok, false);
});

test('equip at an empty or out-of-range slot is rejected without throwing', () => {
  const state = freshState();
  const p = state.player;
  assert.equal(Intents.apply(state, p, { intent: 'equip', slot: 3 }).ok, false, 'empty slot');
  assert.equal(Intents.apply(state, p, { intent: 'equip', slot: 999 }).ok, false, 'out of range');
  assert.doesNotThrow(() => Intents.apply(state, p, { intent: 'equip', slot: -1 }));
});

test('learn with no skill point is rejected and skills are unchanged', () => {
  const state = freshState();
  const p = state.player;
  p.skillPoints = 0;
  const anId = Skills.ACTIVE_ORDER[0] || Object.keys(Skills.SKILLS)[0];
  const res = Intents.apply(state, p, { intent: 'learn', skillId: anId });
  assert.equal(res.ok, false);
  assert.equal(Skills.rank(p, anId), 0, 'no rank was granted');
});

test('learn with a point spends it and grants a rank', () => {
  const state = freshState();
  const p = state.player;
  p.skillPoints = 1;
  // find a learnable root skill
  const id = Object.keys(Skills.SKILLS).find((k) => Skills.canLearn(p, k));
  assert.ok(id, 'a learnable skill exists at rank 0 with a point');
  const res = Intents.apply(state, p, { intent: 'learn', skillId: id });
  assert.equal(res.ok, true);
  assert.equal(p.skillPoints, 0, 'the point was spent');
  assert.equal(Skills.rank(p, id), 1);
});

test('upgrade deducts server-priced gold and raises the weapon plus', () => {
  const state = freshState();
  const p = state.player;
  const cost = Items.upgradeCost(p.equip.weapon);
  p.bag.gold = cost + 5;
  const res = Intents.apply(state, p, { intent: 'upgrade', slotName: 'weapon' });
  assert.equal(res.ok, true);
  assert.equal(p.equip.weapon.plus, 1);
  assert.equal(p.bag.gold, 5, 'exactly the server cost was charged');
});

test('upgrade hones equipped armour too, but never a ring', () => {
  const state = freshState();
  const p = state.player;
  const rng = U.mulberry32(11);
  p.equip.boots = Items.makeItem(2, rng, { slot: 'boots' });
  p.equip.ring = Items.makeItem(2, rng, { slot: 'ring' });
  p.bag.gold = 100000;

  assert.equal(Intents.apply(state, p, { intent: 'upgrade', slotName: 'boots' }).ok, true);
  assert.equal(p.equip.boots.plus, 1);

  const res = Intents.apply(state, p, { intent: 'upgrade', slotName: 'ring' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_smithable');
  assert.equal(p.equip.ring.plus, undefined, 'ring took no plus');
});

test('upgrade with insufficient gold is rejected and nothing changes', () => {
  const state = freshState();
  const p = state.player;
  p.bag.gold = 0;
  const plus0 = p.equip.weapon.plus || 0;
  const res = Intents.apply(state, p, { intent: 'upgrade', slotName: 'weapon' });
  assert.equal(res.ok, false);
  assert.equal(p.equip.weapon.plus || 0, plus0, 'weapon unchanged');
  assert.equal(p.bag.gold, 0, 'gold unchanged');
});

test('buy with insufficient gold or bad index is rejected; gold unchanged', () => {
  const state = freshState();
  const p = state.player;
  const item = Items.makeItem(3, U.mulberry32(1), { slot: 'armor' });
  state.shop = [{ item, price: Items.buyPrice(item) }];
  p.bag.gold = 0;
  assert.equal(Intents.apply(state, p, { intent: 'buy', index: 0 }).ok, false, 'too poor');
  assert.equal(p.bag.gold, 0);
  assert.equal(Intents.apply(state, p, { intent: 'buy', index: 9 }).ok, false, 'bad index');
  assert.doesNotThrow(() => Intents.apply(state, p, { intent: 'buy', index: 0 }));
});

test('sell adds the server sell price and clears the slot', () => {
  const state = freshState();
  const p = state.player;
  const item = Items.makeItem(2, U.mulberry32(1), { slot: 'boots' });
  p.bag.slots[1] = item;
  p.bag.gold = 0;
  const res = Intents.apply(state, p, { intent: 'sell', slot: 1 });
  assert.equal(res.ok, true);
  assert.equal(p.bag.slots[1], null);
  assert.equal(p.bag.gold, Items.sellPrice(item));
});
