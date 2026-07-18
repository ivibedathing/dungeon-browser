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

// ---- Task 9: the ending ----

test('slaying the final boss completes the quest and arms the victory card', () => {
  let state = Game.newRun(4242);
  state.floor = 23;
  G.descend(state); // floor 24
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss && boss.final, 'the final boss is here');
  // Stand the hero on act VI so the kill is the one that ends it.
  state.player.mainQuest = Quests.newMain();
  for (let i = 0; i < 5; i++) {
    const a = Bosses.ACTS[i];
    Quests.recordBossKill(state.player.mainQuest, Entities.makeBoss(a.bossFloor), a.bossFloor);
  }
  assert.equal(state.player.mainQuest.act, 6, 'on the last act');

  G.hitMonster(state, boss, 1e9, Entities.effectiveStats(state.player), 0, 0, state.player);
  // Messages are queued as events; they only reach state.messages on a drain.
  Game.applyEvents(state, Game.drainEvents(state));

  assert.equal(state.player.mainQuest.complete, true, 'the quest is done');
  assert.ok(state.victory, 'the victory card is armed');
  assert.ok(state.messages.some((m) => /main quest is complete/i.test(m.text || m)), 'and announced');
});

test('the victory card times out instead of blocking the run', () => {
  let state = Game.newRun(4242);
  state.victory = { t: 0, dur: 7 };
  const input = freshInput();
  for (let i = 0; i < 60 * 9; i++) {
    state = Game.update(state, input, 1 / 60);
    Game.applyEvents(state, Game.drainEvents(state));
  }
  assert.ok(state.victory.t > 7, 'its clock ran past the duration');
});

test('the final boss carries the deepest phase ladder in the game', () => {
  const final = Entities.makeBoss(24);
  for (const a of Bosses.ACTS) {
    if (a.final) continue;
    assert.ok(final.phases.length >= Entities.makeBoss(a.bossFloor).phases.length, `deeper than act ${a.act}`);
  }
  assert.equal(final.phases.length, 4, 'four phases');
  // It cycles the existing behaviors rather than introducing a fourth.
  const used = new Set([final.behavior, ...final.phases.map((p) => p.behavior).filter(Boolean)]);
  for (const b of used) assert.ok(G.BEHAVIORS[b], `${b} is an existing behavior`);
});

test('the run keeps going past 24: floors generate, guardians spawn, nothing throws', () => {
  let state = Game.newRun(4242);
  state.floor = 24;
  for (let i = 0; i < 8; i++) {
    assert.doesNotThrow(() => G.descend(state), `descending to floor ${state.floor + 1}`);
    assert.ok(state.dungeon && state.dungeon.grid, `floor ${state.floor} generated`);
    assert.equal(Bosses.actForFloor(state.floor), null, `floor ${state.floor} has no act`);
  }
  assert.equal(state.floor, 32, 'reached floor 32');
});

test('an arena floor past 24 still gets a working guardian with no act tagging', () => {
  let state = Game.newRun(4242);
  state.floor = 25;
  G.descend(state); // floor 26 — an even floor, so an arena
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss, 'a guardian spawned past the main quest');
  assert.equal(boss.actBoss, undefined, 'not tagged to any act');
  assert.equal(boss.final, undefined, 'and not a second ending');
});

test('a victorious hero descending past 24 banks nothing further and does not throw', () => {
  let state = Game.newRun(4242);
  for (const a of Bosses.ACTS) Quests.recordBossKill(state.player.mainQuest, Entities.makeBoss(a.bossFloor), a.bossFloor);
  state.floor = 25;
  G.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  assert.doesNotThrow(() => G.hitMonster(state, boss, 1e9, Entities.effectiveStats(state.player), 0, 0, state.player));
  assert.equal(state.player.mainQuest.complete, true, 'still complete, not rolled over');
  assert.equal(state.player.mainQuest.act, Bosses.COUNT, 'no phantom act VII');
});

// ---- the boss-skip guard ----
// Found by playing the whole quest end to end, not by unit tests: the stairs sit
// INSIDE the boss arena, and nothing stopped a hero walking onto them mid-fight.
// A retreating caster boss actively lures you there while you chase it, so acts
// III onward were unfinishable in practice.

test('you cannot ride the stairs out of a live boss fight', () => {
  let state = Game.newRun(4242);
  state.floor = 11;
  G.descend(state); // floor 12 — the act III arena
  const boss = state.monsters.find((m) => m.boss);
  assert.ok(boss && boss.actBoss === 3, 'the act III boss is here');

  // Stand on the stairs, inside the arena, with the boss untouched.
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  const before = state.floor;
  state = Game.update(state, freshInput(), 1 / 60);
  Game.applyEvents(state, Game.drainEvents(state));

  assert.equal(state.bossFight, true, 'the fight is on');
  assert.equal(state.floor, before, 'the stairs refuse while the guardian lives');
  assert.equal(boss.hp, boss.maxHP, 'and the boss is still at full health');
});

test('killing the boss opens the way down again', () => {
  let state = Game.newRun(4242);
  state.floor = 11;
  G.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  state = Game.update(state, freshInput(), 1 / 60); // blocked
  assert.equal(state.floor, 12, 'still on the boss floor');

  G.hitMonster(state, boss, 1e9, Entities.effectiveStats(state.player), 0, 0, state.player);
  Game.applyEvents(state, Game.drainEvents(state));
  state = Game.update(state, freshInput(), 1 / 60);
  assert.equal(state.floor, 13, 'the stairs work once the arena is clear');
});

test('stairs outside an arena are unaffected — normal floors descend as always', () => {
  let state = Game.newRun(4242);
  state.floor = 1; // odd floor: no arena at all
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  state = Game.update(state, freshInput(), 1 / 60);
  assert.equal(state.floor, 2, 'ordinary descent is untouched');
});

test('the whole main quest is completable: six acts, floor 1 to 24', () => {
  let state = Game.newRun(777);
  state.player.baseMaxHP = 500000;
  state.player.hp = 500000;
  state.player.baseDamage = 900;
  const input = freshInput();
  input.keys.space = true;

  for (let i = 0; i < 30 && !state.player.mainQuest.complete; i++) {
    if (state.floor < 24) G.descend(state);
    const boss = state.monsters.find((m) => m.boss);
    if (!boss) continue;
    state.player.x = boss.x - 50;
    state.player.y = boss.y;
    for (let t = 0; t < 3000 && state.monsters.indexOf(boss) !== -1; t++) {
      state.player.facing = Math.atan2(boss.y - state.player.y, boss.x - state.player.x);
      const d = Math.hypot(boss.x - state.player.x, boss.y - state.player.y);
      input.keys.d = boss.x > state.player.x && d > 40;
      input.keys.a = boss.x < state.player.x && d > 40;
      input.keys.s = boss.y > state.player.y && d > 40;
      input.keys.w = boss.y < state.player.y && d > 40;
      state = Game.update(state, input, 1 / 60);
      Game.applyEvents(state, Game.drainEvents(state));
      state.player.hp = 500000; // testing quest flow, not balance
    }
  }
  const mq = state.player.mainQuest;
  assert.deepEqual(mq.slain, [1, 2, 3, 4, 5, 6], 'every act boss fell, in order');
  assert.equal(mq.complete, true, 'the quest completed');
  assert.ok(state.victory, 'the ending fired');
});
