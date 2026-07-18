const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Bosses = require('../js/bosses.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
const Quests = globalThis.Quests;
const Bosses = globalThis.Bosses;
const Game = require('../js/game.js');
const G = Game._;
const TS = Dungeon.TILE_SIZE;

const freshInput = () => ({ keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } });

// ---- pure state ----

test('a new hero starts on act I with nothing slain', () => {
  const mq = Quests.newMain();
  assert.equal(mq.act, 1);
  assert.deepEqual(mq.slain, []);
  assert.equal(mq.complete, false);
});

test('the current main quest reads as a quest the HUD can render like any other', () => {
  const mq = Quests.newMain();
  const q = Quests.mainQuest(mq);
  assert.equal(q.kind, 'main');
  assert.ok(Quests.KINDS.includes('main'), 'main is a recognized kind');
  assert.equal(q.act, 1);
  assert.equal(q.need, 1);
  assert.equal(q.count, 0);
  assert.ok(q.title.includes('The Crypts'), 'titled with its act');
  assert.ok(q.desc.includes('Gravemaw'), 'names the quarry');
  assert.ok(q.reward.gold > 0 && q.reward.xp > 0, 'pays out');
  assert.equal(Quests.fraction(q), 0);
  assert.ok(typeof Quests.progressText(q) === 'string');
});

test('killing the act boss advances exactly one act', () => {
  const mq = Quests.newMain();
  const boss = Entities.makeBoss(4);
  assert.equal(Quests.recordBossKill(mq, boss, 4), true, 'it counted');
  assert.equal(mq.act, 2, 'moved to act II');
  assert.deepEqual(mq.slain, [1], 'act I recorded');
  assert.equal(mq.complete, false);
});

test('the wrong boss does not advance the quest', () => {
  const mq = Quests.newMain();
  assert.equal(Quests.recordBossKill(mq, Entities.makeBoss(6), 6), false, 'a generic guardian is not an act boss');
  assert.equal(Quests.recordBossKill(mq, Entities.makeMonster('brute', 4, true), 4), false, 'nor is a champion');
  assert.equal(mq.act, 1, 'still act I');
});

test('killing a later act boss early does not skip the acts before it', () => {
  const mq = Quests.newMain();
  const deepBoss = Entities.makeBoss(16); // act IV, while the hero is on act I
  assert.equal(Quests.recordBossKill(mq, deepBoss, 16), false, 'out-of-order kill is not credit');
  assert.equal(mq.act, 1, 'still act I');
  assert.deepEqual(mq.slain, []);
});

test('re-killing the same act boss never double-advances', () => {
  const mq = Quests.newMain();
  const boss = Entities.makeBoss(4);
  Quests.recordBossKill(mq, boss, 4);
  assert.equal(Quests.recordBossKill(mq, Entities.makeBoss(4), 4), false, 'replaying floor 4 pays nothing');
  assert.equal(mq.act, 2);
  assert.deepEqual(mq.slain, [1]);
});

test('walking the whole quest completes it on the final boss and stops there', () => {
  const mq = Quests.newMain();
  for (const a of Bosses.ACTS) {
    assert.equal(mq.complete, false, `not complete before act ${a.act}`);
    assert.equal(Quests.recordBossKill(mq, Entities.makeBoss(a.bossFloor), a.bossFloor), true, `act ${a.act} credited`);
  }
  assert.equal(mq.complete, true, 'the main quest is done');
  assert.deepEqual(mq.slain, [1, 2, 3, 4, 5, 6]);
  assert.equal(Quests.mainQuest(mq), null, 'no act VII to roll over into');
  assert.equal(mq.act, Bosses.COUNT, 'the act counter does not run past the last act');
});

test('a completed main quest ignores further boss kills', () => {
  const mq = Quests.newMain();
  for (const a of Bosses.ACTS) Quests.recordBossKill(mq, Entities.makeBoss(a.bossFloor), a.bossFloor);
  assert.equal(Quests.recordBossKill(mq, Entities.makeBoss(24), 24), false, 'nothing left to credit');
});

// ---- save round trip ----

test('main quest state survives a save round trip', () => {
  const mq = Quests.newMain();
  Quests.recordBossKill(mq, Entities.makeBoss(4), 4);
  Quests.recordBossKill(mq, Entities.makeBoss(8), 8);
  const restored = Quests.mainFromSave(JSON.parse(JSON.stringify(mq)));
  assert.deepEqual(restored, mq);
});

test('a missing or corrupt main quest degrades to a fresh act I rather than throwing', () => {
  for (const bad of [undefined, null, 'nonsense', 42, {}, { act: 99, slain: 'no' }, { act: -3, slain: [1, 2] }]) {
    const mq = Quests.mainFromSave(bad);
    assert.ok(mq && mq.act >= 1 && mq.act <= Bosses.COUNT, `act in range for ${JSON.stringify(bad)}`);
    assert.ok(Array.isArray(mq.slain), 'slain is always a list');
  }
  assert.equal(Quests.mainFromSave(undefined).act, 1, 'a pre-quest save starts at act I');
});

// ---- wired into the sim ----

test('a new run gives the hero a main quest', () => {
  const state = Game.newRun(101);
  assert.ok(state.player.mainQuest, 'the hero carries one');
  assert.equal(state.player.mainQuest.act, 1);
});

test('slaying the act I boss in a real fight advances the act and announces it', () => {
  let state = Game.newRun(4242);
  state.floor = 3;
  G.descend(state); // floor 4 — the act I arena
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss && boss.actBoss === 1, 'the act I boss is here');
  assert.equal(state.player.mainQuest.act, 1);

  state.player.x = boss.x - 40;
  state.player.y = boss.y;
  state.player.baseDamage = 100000;
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  for (let i = 0; i < 60 && state.monsters.indexOf(boss) !== -1; i++) {
    state.player.facing = Math.atan2(boss.y - state.player.y, boss.x - state.player.x);
    state = Game.update(state, input, 1 / 60);
    Game.applyEvents(state, Game.drainEvents(state));
  }
  assert.equal(state.monsters.indexOf(boss), -1, 'boss slain');
  assert.equal(state.player.mainQuest.act, 2, 'the act advanced');
  assert.deepEqual(state.player.mainQuest.slain, [1]);
  assert.ok(state.messages.some((m) => /act/i.test(m.text || m)), 'the completion was announced');
});

test('a generic guardian kill leaves the main quest alone', () => {
  let state = Game.newRun(4242);
  state.floor = 1;
  G.descend(state); // floor 2 — a guardian floor, not an act floor
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss && boss.actBoss === undefined, 'a generic guardian');
  state.player.x = boss.x - 40;
  state.player.y = boss.y;
  state.player.baseDamage = 100000;
  const input = freshInput();
  input.keys.space = true;
  for (let i = 0; i < 60 && state.monsters.indexOf(boss) !== -1; i++) {
    state.player.facing = Math.atan2(boss.y - state.player.y, boss.x - state.player.x);
    state = Game.update(state, input, 1 / 60);
    Game.applyEvents(state, Game.drainEvents(state));
  }
  assert.equal(state.monsters.indexOf(boss), -1, 'guardian slain');
  assert.equal(state.player.mainQuest.act, 1, 'main quest untouched');
});

// ---- co-op: per-character credit, share range ----

test('every hero in share range banks the act on their own character', () => {
  let state = Game.newRun(4242);
  state.floor = 3;
  G.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  // A second hero standing next to the first.
  const ally = Entities.newPlayer();
  ally.id = 'p1';
  ally.mainQuest = Quests.newMain();
  ally.x = boss.x - 60;
  ally.y = boss.y;
  ally.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
  ally.dodgeDir = { x: 1, y: 0 };
  state.players.push(ally);

  G.killMonster
    ? G.killMonster(state, boss, Entities.effectiveStats(state.player), state.player)
    : G.hitMonster(state, boss, 1e9, Entities.effectiveStats(state.player), 0, 0, state.player);

  assert.equal(state.player.mainQuest.act, 2, 'the killer banked it');
  assert.equal(ally.mainQuest.act, 2, 'so did the ally who was in range');
});

test('a hero far from the kill banks nothing — credit follows the XP share rule', () => {
  let state = Game.newRun(4242);
  state.floor = 3;
  G.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  const far = Entities.newPlayer();
  far.id = 'p1';
  far.mainQuest = Quests.newMain();
  far.x = boss.x + 9000; // nowhere near it
  far.y = boss.y + 9000;
  far.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
  far.dodgeDir = { x: 1, y: 0 };
  state.players.push(far);

  G.hitMonster(state, boss, 1e9, Entities.effectiveStats(state.player), 0, 0, state.player);

  assert.equal(state.player.mainQuest.act, 2, 'the killer banked it');
  assert.equal(far.mainQuest.act, 1, 'the absent hero did not');
});

// ---- past the end ----

test('floors past 24 have no act and break nothing', () => {
  const mq = Quests.newMain();
  for (const a of Bosses.ACTS) Quests.recordBossKill(mq, Entities.makeBoss(a.bossFloor), a.bossFloor);
  let state = Game.newRun(4242);
  state.player.mainQuest = mq;
  state.floor = 25;
  for (let i = 0; i < 6; i++) G.descend(state); // 26..31, all past the quest
  assert.ok(state.floor > 24, `still descending (floor ${state.floor})`);
  assert.equal(Bosses.actForFloor(state.floor), null, 'no act down here');
  assert.equal(state.player.mainQuest.complete, true, 'the quest stays complete');
});
