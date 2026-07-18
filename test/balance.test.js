// Wiring tests: the sim must read its numbers from js/balance.js, so tuning the
// balance sheet never breaks the suite — only breaks in wiring do.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
const Balance = require('../js/balance.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

test('monster stats derive from the Balance table and scaling curves', () => {
  for (const type of Object.keys(Balance.monsters)) {
    const b = Balance.monsters[type];
    for (const f of [1, 4, 9, 14]) {
      const m = Entities.makeMonster(type, f, false);
      const hpScale = 1 + Balance.scaling.hpLin * (f - 1) + Balance.scaling.hpQuad * (f - 1) * (f - 1);
      const dmgScale = 1 + Balance.scaling.dmgLin * (f - 1);
      const xpScale = 1 + Balance.scaling.xpLin * (f - 1);
      assert.equal(m.hp, Math.round(b.hp * hpScale), `${type} hp wired at floor ${f}`);
      assert.equal(m.dmg, Math.max(1, Math.round(b.dmg * dmgScale)), `${type} dmg wired at floor ${f}`);
      assert.equal(m.xp, Math.round(b.xp * xpScale), `${type} xp wired at floor ${f}`);
    }
    const champ = Entities.makeMonster(type, 5, true);
    const plain = Entities.makeMonster(type, 5, false);
    assert.equal(champ.hp, Math.round(plain.hp * Balance.champion.hp), `${type} champion multiplier wired`);
  }
  // Two boss classes now read two tables: named act bosses (floors 4/8/12/16/20/24)
  // scale from Balance.actBoss[act], the generic guardians on the other arena
  // floors from Balance.boss. Both share the guardian's combat feel (kbResist).
  const actBoss = Entities.makeBoss(4);
  const actStock = Entities.makeMonster('brute', 4, false);
  assert.equal(actBoss.hp, Math.round(actStock.hp * Balance.actBoss[1].hp), 'act boss hp wired');
  assert.equal(actBoss.kbResist, Balance.boss.kbResist, 'act boss knockback wired');

  const guard = Entities.makeBoss(6);
  const guardStock = Entities.makeMonster('brute', 6, false);
  assert.equal(guard.hp, Math.round(guardStock.hp * Balance.boss.hp), 'generic guardian hp wired');
  assert.equal(guard.kbResist, Balance.boss.kbResist, 'generic guardian knockback wired');
});

test('dropLoot honors the Balance drop rates statistically', () => {
  const state = { floor: 1, srand: U.mulberry32(99), groundItems: [], nextId: 1, events: [] };
  const m = { x: 0, y: 0, champion: false, boss: false };
  const counts = { item: 0, potion: 0, gold: 0, nothing: 0 };
  const N = 6000;
  for (let i = 0; i < N; i++) {
    state.groundItems.length = 0;
    Game.dropLoot(state, m);
    const g = state.groundItems[0];
    if (!g) counts.nothing++;
    else if (g.kind === 'gold') counts.gold++;
    else if (g.item.slot === 'potion') counts.potion++;
    else counts.item++;
  }
  assert.ok(Math.abs(counts.item / N - Balance.drops.item) < 0.02, `item rate ${counts.item / N} vs ${Balance.drops.item}`);
  assert.ok(Math.abs(counts.potion / N - Balance.drops.potion) < 0.02, `potion rate ${counts.potion / N} vs ${Balance.drops.potion}`);
  assert.ok(Math.abs(counts.gold / N - Balance.drops.gold) < 0.02, `gold rate ${counts.gold / N} vs ${Balance.drops.gold}`);
});

test('spawn counts follow Balance.spawns', () => {
  const S = Balance.spawns;
  for (const floor of [1, 6]) {
    const d = Dungeon.generateDungeon(3, floor);
    const bonus = Math.min(S.depthCap, Math.floor((floor - 1) * S.depthRate));
    const rooms = d.rooms.length - 1 - (d.boss ? 1 : 0); // entry room and boss arena spawn nothing
    assert.ok(d.spawns.length >= rooms * (S.base + bonus) * 0.7, `enough spawns on floor ${floor} (${d.spawns.length})`);
    assert.ok(d.spawns.length <= rooms * (S.base + S.rand + bonus), `not too many on floor ${floor}`);
  }
});
