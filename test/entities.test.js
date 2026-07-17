const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util.js');
const E = require('../js/entities.js');

test('xpForLevel follows the Balance curve and grows monotonically', () => {
  const Balance = require('../js/balance.js');
  assert.equal(E.xpForLevel(1), Balance.xpCurve.base, 'level 1 cost is the curve base');
  for (let n = 1; n < 30; n++) {
    assert.equal(E.xpForLevel(n), Math.round(Balance.xpCurve.base * Math.pow(n, Balance.xpCurve.exponent)), `wired to Balance at level ${n}`);
    assert.ok(E.xpForLevel(n + 1) > E.xpForLevel(n), `level ${n + 1} curve dipped`);
  }
});

test('newPlayer starts at level 1 with 100 HP and a starter weapon', () => {
  const p = E.newPlayer();
  assert.equal(p.level, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.baseMaxHP, 100);
  assert.equal(p.hp, 100);
  assert.ok(p.equip.weapon, 'has starter weapon');
  assert.equal(p.equip.weapon.stats.damage, 8);
  const s = E.effectiveStats(p);
  assert.equal(s.damage, 8, 'level 1 damage comes from the starter weapon');
  assert.equal(s.maxHP, 100);
});

test('gainXP levels up with the Balance per-level gains and fully heals', () => {
  const Balance = require('../js/balance.js');
  const P = Balance.player;
  const p = E.newPlayer();
  p.hp = 40;
  const levels = E.gainXP(p, E.xpForLevel(1));
  assert.equal(levels, 1);
  assert.equal(p.level, 2);
  assert.equal(p.baseMaxHP, P.baseHP + P.hpPerLevel);
  const s = E.effectiveStats(p);
  assert.equal(s.maxHP, P.baseHP + P.hpPerLevel);
  assert.equal(p.hp, s.maxHP, 'level up fully heals');
  assert.equal(s.damage, 8 + P.dmgPerLevel, 'starter weapon 8 + per-level damage');
});

test('gainXP can cross multiple levels at once', () => {
  const p = E.newPlayer();
  const levels = E.gainXP(p, E.xpForLevel(1) + E.xpForLevel(2) + 5);
  assert.equal(levels, 2);
  assert.equal(p.level, 3);
  assert.equal(p.xp, 5, 'leftover xp preserved');
});

test('monster stats scale monotonically with floor depth', () => {
  for (const type of ['zombie', 'skeleton', 'bat', 'brute', 'wraith']) {
    let prev = null;
    for (let floor = 1; floor <= 12; floor++) {
      const m = E.makeMonster(type, floor, false);
      assert.ok(m.hp > 0 && m.dmg > 0 && m.xp > 0 && m.speed > 0);
      assert.equal(m.maxHP, m.hp);
      if (prev) {
        assert.ok(m.hp >= prev.hp, `${type} hp dipped on floor ${floor}`);
        assert.ok(m.dmg >= prev.dmg, `${type} dmg dipped on floor ${floor}`);
        assert.ok(m.xp >= prev.xp, `${type} xp dipped on floor ${floor}`);
      }
      prev = m;
    }
    const f1 = E.makeMonster(type, 1, false);
    const f10 = E.makeMonster(type, 10, false);
    assert.ok(f10.hp >= f1.hp * 3, `${type} should at least triple HP by floor 10`);
  }
});

test('champions are markedly stronger and named', () => {
  const base = E.makeMonster('skeleton', 4, false);
  const champ = E.makeMonster('skeleton', 4, true);
  assert.equal(champ.champion, true);
  assert.ok(Math.abs(champ.hp - Math.round(base.hp * 2.6)) <= 1, `champ hp ${champ.hp} vs base ${base.hp}`);
  assert.ok(champ.dmg > base.dmg);
  assert.ok(champ.xp >= base.xp * 3 - 1);
  assert.ok(typeof champ.name === 'string' && champ.name.length > 0);
});

test('wraiths only appear in the spawn pool from floor 3', () => {
  const rng1 = U.mulberry32(1);
  for (let i = 0; i < 400; i++) {
    assert.notEqual(E.pickMonsterType(rng1, 1), 'wraith');
  }
  const rng5 = U.mulberry32(2);
  let sawWraith = false;
  for (let i = 0; i < 400; i++) {
    if (E.pickMonsterType(rng5, 5) === 'wraith') sawWraith = true;
  }
  assert.ok(sawWraith, 'wraith should appear on floor 5 within 400 rolls');
});

test('damageAfterDefense subtracts defense with a floor of 1', () => {
  assert.equal(E.damageAfterDefense(10, 4), 6);
  assert.equal(E.damageAfterDefense(3, 10), 1);
  assert.equal(E.damageAfterDefense(7.6, 0), 8, 'rounds to integer');
});
