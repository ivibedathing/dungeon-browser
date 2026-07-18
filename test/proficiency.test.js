// proficiency.test.js — weapon mastery: earned per weapon KIND from killing blows,
// logarithmic and hard-capped, persisted across saves, and never client-injectable.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Balance = require('../js/balance.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Save = require('../js/save.js');
const Game = require('../js/game.js');

const P = Balance.proficiency;

function player() {
  return Entities.newPlayer({ name: 'Test' });
}

test('a new player starts with zero proficiency in every kind', () => {
  const p = player();
  for (const kind of Entities.PROF_KINDS) {
    assert.equal(p.prof[kind], 0);
    assert.equal(Entities.profBonus(p, kind), 0);
  }
});

test('proficiency grows with use but decelerates — each bonus point costs more', () => {
  const p = player();
  const at = (xp) => {
    p.prof.melee = xp;
    return Entities.profBonus(p, 'melee');
  };
  const early = at(2000) - at(1000);
  const late = at(20000) - at(19000);
  assert.ok(early > 0, 'proficiency must actually increase with use');
  assert.ok(late > 0, 'proficiency must keep increasing, just slower');
  assert.ok(early > late * 5, `the curve must flatten hard (early ${early} vs late ${late})`);
});

test('the bonus is hard-capped no matter how much XP is banked', () => {
  const p = player();
  p.prof.melee = 1e12;
  assert.equal(Entities.profBonus(p, 'melee'), P.maxBonus);
  // And the cap is reachable: PROF_XP_CAP is exactly where it saturates.
  p.prof.melee = Entities.PROF_XP_CAP;
  assert.ok(Math.abs(Entities.profBonus(p, 'melee') - P.maxBonus) < 1e-9);
});

test('gainProficiency clamps banked XP so overflow cannot be stockpiled', () => {
  const p = player();
  Entities.gainProficiency(p, 'melee', 1e15);
  assert.equal(p.prof.melee, Entities.PROF_XP_CAP);
  assert.equal(Entities.gainProficiency(p, 'melee', 1e15), 0, 'a capped kind gains nothing further');
});

test('proficiency is per kind — sword practice does not level your bow', () => {
  const p = player();
  Entities.gainProficiency(p, 'melee', 5000);
  assert.ok(Entities.profBonus(p, 'melee') > 0);
  assert.equal(Entities.profBonus(p, 'bow'), 0);
  assert.equal(Entities.profBonus(p, 'wand'), 0);
});

test('unknown kinds earn nothing and never appear on the player', () => {
  const p = player();
  assert.equal(Entities.gainProficiency(p, 'laser', 9999), 0);
  assert.equal(p.prof.laser, undefined);
  assert.equal(Entities.profBonus(p, 'laser'), 0);
});

test('mastery raises the damage stat, and only within the cap', () => {
  const p = player();
  const base = Entities.effectiveStats(p).damage;
  p.prof.melee = 1e12;
  const mastered = Entities.effectiveStats(p);
  assert.ok(mastered.damage > base, 'mastery must make the hero stronger');
  assert.ok(
    mastered.damage <= base * (1 + P.maxBonus) + 1e-9,
    `mastery must never exceed +${P.maxBonus * 100}% (got ${mastered.damage / base})`
  );
  assert.ok(Math.abs(mastered.profBonus - P.maxBonus) < 1e-9);
});

test('a bow equipped reads bow mastery, not the melee bank', () => {
  const p = player();
  p.prof.melee = Entities.PROF_XP_CAP;
  p.equip.weapon = Items.makeItem(1, U.mulberry32(11), { slot: 'weapon', kind: 'bow' });
  assert.equal(Entities.effectiveStats(p).profBonus, 0, 'swordsmanship must not carry over to a bow');
});

test('killing a monster credits the killing weapon kind', () => {
  const state = Game.newRun(7);
  const p = state.player;
  const m = { ...Entities.makeMonster('zombie', 1, false), x: p.x + 20, y: p.y, hp: 1 };
  state.monsters.push(m);
  const stats = Entities.effectiveStats(p);
  Game._.hitMonster(state, m, 999, stats, 0, 0, p);
  assert.ok(p.prof.melee > 0, 'the killing blow must bank melee proficiency');
  assert.equal(p.prof.bow, 0);
});

test('a stronger monster is worth more proficiency than a weak one', () => {
  const state = Game.newRun(7);
  const p = state.player;
  const stats = Entities.effectiveStats(p);
  const kill = (type) => {
    const before = p.prof.melee;
    const m = { ...Entities.makeMonster(type, 1, false), x: p.x + 20, y: p.y, hp: 1 };
    state.monsters.push(m);
    Game._.hitMonster(state, m, 999, stats, 0, 0, p);
    return p.prof.melee - before;
  };
  assert.ok(kill('brute') > kill('bat'), 'proficiency should track the quality of the kill');
});

test('proficiency survives a save/load round trip', () => {
  const state = Game.newRun(7);
  state.player.prof.bow = 4321;
  const restored = Game.fromSave(Save.snapshot(state));
  assert.equal(restored.player.prof.bow, 4321);
  assert.equal(restored.player.prof.melee, 0);
});

test('a pre-proficiency save loads at zero instead of breaking', () => {
  const state = Game.newRun(7);
  const snap = Save.snapshot(state);
  delete snap.player.prof; // a save written before this feature existed
  const restored = Game.fromSave(snap);
  for (const kind of Entities.PROF_KINDS) assert.equal(restored.player.prof[kind], 0);
  assert.equal(Entities.effectiveStats(restored.player).profBonus, 0);
});

// ---- Trust boundary: the stored blob is attacker-controlled input. ----

test('server load clamps an inflated proficiency and drops unknown kinds', () => {
  const Schema = require('../server/schema.js');
  const { starterBlob } = require('../server/character.js');
  const blob = starterBlob('Cheater');
  blob.player.prof = { melee: 1e15, laser: 1e15 };
  const v = Schema.validateCharacter(blob);
  assert.ok(v.ok);
  assert.equal(v.sanitized.player.prof.melee, Entities.PROF_XP_CAP);
  assert.equal(v.sanitized.player.prof.laser, undefined, 'unknown kinds must not survive load');
  assert.ok(v.errors.some((e) => /prof melee clamped/.test(e)));
  assert.ok(v.errors.some((e) => /unknown prof kind laser/.test(e)));
});

test('a clamped cheater is no stronger than an honest master', () => {
  const Schema = require('../server/schema.js');
  const { starterBlob, playerFromCharacter } = require('../server/character.js');
  const blob = starterBlob('Cheater');
  blob.player.prof = { melee: 1e15 };
  const cheater = playerFromCharacter(Schema.validateCharacter(blob).sanitized, 'p1');
  const honest = playerFromCharacter(Schema.validateCharacter(starterBlob('Honest')).sanitized, 'p2');
  honest.prof.melee = Entities.PROF_XP_CAP;
  assert.equal(Entities.effectiveStats(cheater).damage, Entities.effectiveStats(honest).damage);
});

test('a legitimate blob round-trips through validation unchanged', () => {
  const Schema = require('../server/schema.js');
  const { starterBlob } = require('../server/character.js');
  const blob = starterBlob('Honest');
  blob.player.prof.melee = 1234;
  assert.deepEqual(Schema.validateCharacter(blob).sanitized.player.prof, blob.player.prof);
});
