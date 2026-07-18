// Phase 4.5 Track C — the character blob boundary. A stored blob is sanitized on
// load: injected stats are clamped/dropped, junk is removed, a broken blob becomes a
// fresh starter — and a legitimate blob passes through unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
const Schema = require('../server/schema.js');
const Character = require('../server/character.js');

const starter = () => Character.starterBlob('Hero', '#4a5578');

test('an inflated level is clamped to the Balance-derived ceiling', () => {
  const b = starter();
  b.player.level = 9999;
  const { ok, sanitized } = Schema.validateCharacter(b);
  assert.equal(ok, true);
  assert.equal(sanitized.player.level, Schema.MAX_LEVEL);
});

test('unknown top-level keys are dropped', () => {
  const b = starter();
  b.evil = { damage: 1e9 };
  b.player.injectedStat = 999;
  const { sanitized } = Schema.validateCharacter(b);
  assert.ok(!('evil' in sanitized), 'unknown top key gone');
  assert.ok(!('injectedStat' in sanitized.player), 'unknown player key gone');
});

test('an equip item with inflated stats is dropped', () => {
  const b = starter();
  b.player.equip.weapon = { slot: 'weapon', base: 'Hackblade', name: 'CHEAT', rarity: 'common', stats: { damage: 999999 }, affixes: [] };
  const { sanitized } = Schema.validateCharacter(b);
  assert.equal(sanitized.player.equip.weapon, null, 'the inflated weapon was rejected');
});

test('a skills key not in the skill tree is dropped; an inflated rank is clamped', () => {
  const b = starter();
  b.player.skills = { whirlwind: 99, notARealSkill: 3 };
  const { sanitized } = Schema.validateCharacter(b);
  assert.equal(sanitized.player.skills.whirlwind, Skills.SKILLS.whirlwind.max, 'rank clamped to max');
  assert.ok(!('notARealSkill' in sanitized.player.skills), 'bogus skill dropped');
});

test('a structurally broken blob loads as a fresh starter (not a throw)', () => {
  assert.equal(Schema.validateCharacter(null).ok, false);
  assert.equal(Schema.validateCharacter({}).ok, false);
  assert.equal(Schema.validateCharacter([1, 2, 3]).ok, false);
  // playerFromCharacter must still yield a usable level-1 hero.
  let p;
  assert.doesNotThrow(() => { p = Character.playerFromCharacter({ garbage: true }, 'p0'); });
  assert.equal(p.level, 1);
  assert.ok(p.equip.weapon, 'a fresh starter has a weapon');
  assert.ok(p.bag, 'and a bag');
});

test('a legitimate blob round-trips unchanged (existing characters unaffected)', () => {
  const b = starter();
  const { ok, sanitized, errors } = Schema.validateCharacter(b);
  assert.equal(ok, true);
  assert.equal(errors.length, 0, 'a clean starter produces no sanitize errors');
  assert.deepEqual(sanitized.player.equip.weapon, b.player.equip.weapon, 'the starter weapon is preserved');
  assert.deepEqual(sanitized.player.skills, {});
  assert.equal(sanitized.player.level, 1);
  assert.equal(sanitized.player.name, 'Hero');
});

test('a huge injected gold value is clamped', () => {
  const b = starter();
  b.bag.gold = 1e18;
  const { sanitized } = Schema.validateCharacter(b);
  assert.ok(sanitized.bag.gold <= Schema.CAP.gold, 'gold clamped to the ceiling');
});
