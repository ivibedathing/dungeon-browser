// Task 7: player.mainQuest must round-trip through ALL THREE storage paths, and
// they must agree. The dangerous failure is asymmetric — a field that saves
// locally but is stripped by the server whitelist means online heroes silently
// lose act progress on every reconnect, with no error anywhere. So these tests
// go through the REAL schema validator, not a shape assertion on the blob.
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
const Save = require('../js/save.js');
const { validateCharacter } = require('../server/schema.js');
const character = require('../server/character.js');

function midQuestState(acts) {
  const state = Game.newRun(555);
  state.floor = 9;
  for (let i = 0; i < acts; i++) {
    const a = Bosses.ACTS[i];
    Quests.recordBossKill(state.player.mainQuest, Entities.makeBoss(a.bossFloor), a.bossFloor);
  }
  return state;
}

// ---- path 1: localStorage (solo) ----

test('the local save carries the main quest', () => {
  const state = midQuestState(2);
  const snap = Save.snapshot(state);
  assert.ok(snap.player.mainQuest, 'present in the blob');
  assert.equal(snap.player.mainQuest.act, 3);
  assert.deepEqual(snap.player.mainQuest.slain, [1, 2]);
});

test('a solo save round trip restores the act intact', () => {
  const state = midQuestState(3);
  const restored = Game.fromSave(JSON.parse(JSON.stringify(Save.snapshot(state))));
  assert.equal(restored.player.mainQuest.act, 4);
  assert.deepEqual(restored.player.mainQuest.slain, [1, 2, 3]);
  assert.equal(restored.player.mainQuest.complete, false);
});

test('a completed main quest survives the round trip as complete', () => {
  const state = midQuestState(6);
  const restored = Game.fromSave(JSON.parse(JSON.stringify(Save.snapshot(state))));
  assert.equal(restored.player.mainQuest.complete, true);
  assert.deepEqual(restored.player.mainQuest.slain, [1, 2, 3, 4, 5, 6]);
});

test('a save written before the main quest existed loads on act I', () => {
  const state = midQuestState(2);
  const old = JSON.parse(JSON.stringify(Save.snapshot(state)));
  delete old.player.mainQuest; // exactly what every existing save looks like
  const restored = Game.fromSave(old);
  assert.ok(restored.player.mainQuest, 'derived rather than left undefined');
  assert.equal(restored.player.mainQuest.act, 1);
  assert.deepEqual(restored.player.mainQuest.slain, []);
});

// ---- path 2+3: the server blob and its whitelist ----

test('the server character blob carries the main quest', () => {
  const state = midQuestState(4);
  const blob = character.characterBlob(state, state.player);
  assert.ok(blob.player.mainQuest, 'present in the stored blob');
  assert.equal(blob.player.mainQuest.act, 5);
});

test('the schema whitelist does NOT strip the main quest', () => {
  const state = midQuestState(4);
  const blob = character.characterBlob(state, state.player);
  const { ok, sanitized } = validateCharacter(JSON.parse(JSON.stringify(blob)));
  assert.equal(ok, true);
  assert.ok(sanitized.player.mainQuest, 'survived validation — an unlisted field would vanish here');
  assert.equal(sanitized.player.mainQuest.act, 5);
  assert.deepEqual(sanitized.player.mainQuest.slain, [1, 2, 3, 4]);
});

test('a legitimate blob still validates to itself, main quest included', () => {
  const state = midQuestState(3);
  const blob = JSON.parse(JSON.stringify(character.characterBlob(state, state.player)));
  const { sanitized } = validateCharacter(blob);
  assert.deepEqual(sanitized.player.mainQuest, blob.player.mainQuest, 'identity for a legit blob');
});

test('the full server round trip preserves the act: blob -> validate -> live player', () => {
  const state = midQuestState(5);
  const blob = character.characterBlob(state, state.player);
  const { sanitized } = validateCharacter(JSON.parse(JSON.stringify(blob)));
  const live = character.playerFromCharacter(sanitized, 'p1');
  assert.ok(live.mainQuest, 'the live player carries it');
  assert.equal(live.mainQuest.act, 6);
  assert.deepEqual(live.mainQuest.slain, [1, 2, 3, 4, 5]);
});

test('a fresh server character starts on act I', () => {
  const blob = character.starterBlob('Testy', '#4a5578');
  const { sanitized } = validateCharacter(blob);
  const live = character.playerFromCharacter(sanitized, 'p2');
  assert.equal(live.mainQuest.act, 1);
  assert.equal(live.mainQuest.complete, false);
});

test('a stored character predating the main quest loads on act I, not undefined', () => {
  const state = midQuestState(2);
  const blob = JSON.parse(JSON.stringify(character.characterBlob(state, state.player)));
  delete blob.player.mainQuest;
  const { ok, sanitized } = validateCharacter(blob);
  assert.equal(ok, true, 'an old blob still loads');
  assert.equal(sanitized.player.mainQuest.act, 1);
  const live = character.playerFromCharacter(sanitized, 'p3');
  assert.equal(live.mainQuest.act, 1);
});

// ---- the schema is a security boundary, not just a shape check ----

test('an inflated or forged main quest is clamped, not trusted', () => {
  const state = midQuestState(1);
  const blob = JSON.parse(JSON.stringify(character.characterBlob(state, state.player)));
  blob.player.mainQuest = { act: 9999, slain: [1, 2, 3, 4, 5, 6, 7, 8, 99], complete: 'yes' };
  const { sanitized } = validateCharacter(blob);
  const mq = sanitized.player.mainQuest;
  assert.ok(mq.act >= 1 && mq.act <= Bosses.COUNT, `act clamped into range (got ${mq.act})`);
  assert.ok(mq.slain.every((n) => n >= 1 && n <= Bosses.COUNT), 'bogus act numbers dropped');
  assert.equal(typeof mq.complete, 'boolean', 'complete is coerced to a real boolean');
});

test('a junk main quest of the wrong type does not crash the loader', () => {
  const state = midQuestState(1);
  for (const junk of ['nope', 42, [], null, { act: {}, slain: {} }]) {
    const blob = JSON.parse(JSON.stringify(character.characterBlob(state, state.player)));
    blob.player.mainQuest = junk;
    const { ok, sanitized } = validateCharacter(blob);
    assert.equal(ok, true, `loads despite ${JSON.stringify(junk)}`);
    assert.ok(sanitized.player.mainQuest.act >= 1, 'lands on a usable act');
  }
});
