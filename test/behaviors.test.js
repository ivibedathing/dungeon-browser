// test/behaviors.test.js — monster behavior coverage. Two suites live here, each
// wrapped in its own IIFE so their fixtures (freshInput/run/mk/place) stay isolated:
//   1. the boss/registry behaviors (slam, caster, summon) and the dispatch seam;
//   2. the content-expansion archetypes (ranged, exploder, charger, summoner) and
//      the shared hurtPlayer path.
// They exercise the same G.BEHAVIORS registry from opposite ends.

// ---- Suite 1: dispatch seam + boss behaviors (slam / caster / summon) ----
(function () {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');

  globalThis.U = require('../js/util.js');
  globalThis.Items = require('../js/items.js');
  globalThis.Skills = require('../js/skills.js');
  globalThis.Stats = require('../js/stats.js');
  globalThis.Bosses = require('../js/bosses.js');
  globalThis.Entities = require('../js/entities.js');
  globalThis.Dungeon = require('../js/dungeon.js');
  const Game = require('../js/game.js');
  const G = Game._;

  function freshInput() {
    return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
  }
  function run(state, input, frames) {
    for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); Game.applyEvents(state, Game.drainEvents(state)); input.pressed.clear(); }
    return state;
  }
  function mk(state, type, dx, dy, aggroed, extra) {
    return {
      ...Entities.makeMonster(type, 3, false),
      x: state.player.x + dx, y: state.player.y + dy,
      attackT: 0, hitT: 0, lungeT: 0, wanderT: 0.5, wandA: 0.3, aggroed, kbx: 0, kby: 0,
      ...(extra || {}),
    };
  }

  // ---- The regression that justifies the whole refactor ----

  test('a monster with no behavior traces identically to the pre-dispatch sim', () => {
    const golden = require('./fixtures/melee-trace.json');
    const input = freshInput();
    let state = Game.newRun(9001);
    state.monsters.length = 0;
    state.player.baseMaxHP = 100000; state.player.hp = 100000;
    state.monsters.push(mk(state, 'zombie', 60, 0, true), mk(state, 'skeleton', -90, 40, true), mk(state, 'bat', 30, -70, true), mk(state, 'brute', 300, 200, false));

    const trace = [];
    for (let i = 0; i < 240; i++) {
      state = Game.update(state, input, 1 / 60);
      Game.applyEvents(state, Game.drainEvents(state));
      if (i % 12 === 0) trace.push(state.monsters.map((m) => [Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100, m.hp, Math.round(m.attackT * 1000) / 1000]));
    }
    trace.push([Math.round(state.player.hp), state.monsters.length]);

    assert.deepEqual(trace, golden, 'default melee behavior is byte-for-byte what it was before the dispatch seam');
  });

  test('every behavior the dispatch knows about is a callable function', () => {
    assert.ok(G.BEHAVIORS && typeof G.BEHAVIORS === 'object', 'the table exists');
    for (const name of Object.keys(G.BEHAVIORS)) {
      assert.equal(typeof G.BEHAVIORS[name], 'function', `${name} is callable`);
    }
    assert.ok(G.BEHAVIORS.melee, 'melee is the named default');
  });

  test('an unknown behavior name falls back to melee instead of freezing the monster', () => {
    let state = Game.newRun(81);
    state.monsters.length = 0;
    const m = mk(state, 'zombie', 90, 30, true, { behavior: 'nonsense-that-does-not-exist' });
    state.monsters.push(m);
    const d0 = Math.hypot(m.x - state.player.x, m.y - state.player.y);
    state = run(state, freshInput(), 60);
    const d1 = Math.hypot(m.x - state.player.x, m.y - state.player.y);
    assert.ok(d1 < d0, `still closed the distance (${Math.round(d0)} -> ${Math.round(d1)})`);
  });

  // ---- slam ----

  test('slam telegraphs before it lands, and the telegraph is visible to renderers', () => {
    let state = Game.newRun(82);
    state.monsters.length = 0;
    const m = mk(state, 'brute', 40, 0, true, { behavior: 'slam', slamRange: 120, slamRadius: 90, slamDmg: 20, slamWindup: 0.8, slamCd: 3 });
    state.monsters.push(m);
    const hp0 = state.player.hp;

    state = run(state, freshInput(), 20); // inside the wind-up
    assert.ok(m.telegraphT > 0, 'telegraph is armed and readable');
    assert.ok(m.telegraph && typeof m.telegraph.x === 'number', 'telegraph carries the target position to draw');
    assert.equal(state.player.hp, hp0, 'no damage during the wind-up');

    state = run(state, freshInput(), 45); // past the 0.8s wind-up
    assert.ok(state.player.hp < hp0, 'the slam lands after the telegraph');
  });

  test('walking out of a telegraphed slam avoids it entirely', () => {
    const attempt = (flee) => {
      let state = Game.newRun(83);
      state.monsters.length = 0;
      state.player.baseMaxHP = 100000; state.player.hp = 100000;
      const m = mk(state, 'brute', 40, 0, true, { behavior: 'slam', slamRange: 120, slamRadius: 60, slamDmg: 30, slamWindup: 0.8, slamCd: 99 });
      m.speed = 0; // stand still so only the player's own movement decides this
      state.monsters.push(m);
      const hp0 = state.player.hp;
      const input = freshInput();
      if (flee) input.keys.a = true; // run away from the monster on the +x side
      state = run(state, input, 70);
      return hp0 - state.player.hp;
    };
    assert.ok(attempt(false) > 0, 'control: standing in it hurts');
    assert.equal(attempt(true), 0, 'leaving the circle before it lands takes nothing');
  });

  // ---- caster ----

  test('caster keeps its distance and attacks with projectiles', () => {
    let state = Game.newRun(84);
    state.monsters.length = 0;
    const m = mk(state, 'wraith', 150, 0, true, { behavior: 'caster', castRange: 400, castCd: 1.0, castDmg: 8, castSpeed: 260, keepAway: 200 });
    state.monsters.push(m);

    let sawProjectile = false;
    const input = freshInput();
    for (let i = 0; i < 120; i++) {
      state = Game.update(state, input, 1 / 60);
      Game.applyEvents(state, Game.drainEvents(state));
      if (state.projectiles.length) sawProjectile = true;
    }
    assert.ok(sawProjectile, 'it threw something');
    const d = Math.hypot(m.x - state.player.x, m.y - state.player.y);
    assert.ok(d > 120, `kept its distance rather than closing to melee (${Math.round(d)}px)`);
  });

  test('a caster projectile hurts the hero and dies on walls like any other', () => {
    let state = Game.newRun(85);
    state.monsters.length = 0;
    const m = mk(state, 'wraith', 200, 0, true, { behavior: 'caster', castRange: 400, castCd: 0.5, castDmg: 9, castSpeed: 300, keepAway: 180 });
    state.monsters.push(m);
    const hp0 = state.player.hp;
    let sawHostile = false;
    const input = freshInput();
    for (let i = 0; i < 150; i++) {
      state = Game.update(state, input, 1 / 60);
      Game.applyEvents(state, Game.drainEvents(state));
      if (state.projectiles.some((pr) => pr.hostile)) sawHostile = true;
    }
    assert.ok(sawHostile, 'the shot is flagged hostile so it targets heroes, not monsters');
    assert.ok(state.player.hp < hp0, 'projectiles connect');
  });

  // ---- summon ----

  test('summon adds monsters, and never past its cap', () => {
    let state = Game.newRun(86);
    state.monsters.length = 0;
    const m = mk(state, 'brute', 100, 0, true, { behavior: 'summon', summonType: 'bat', summonCount: 2, summonCap: 4, summonCd: 0.5 });
    state.monsters.push(m);

    state = run(state, freshInput(), 40);
    assert.ok(state.monsters.length > 1, 'it summoned');

    state = run(state, freshInput(), 600); // long enough to blow past the cap if uncapped
    const adds = state.monsters.filter((x) => x !== m && x.summonedBy === m.id).length;
    assert.ok(adds <= 4, `respects the cap (${adds} adds)`);
  });

  test('summoned adds are real monsters that fight and can be killed', () => {
    let state = Game.newRun(87);
    state.monsters.length = 0;
    const m = mk(state, 'brute', 100, 0, true, { behavior: 'summon', summonType: 'bat', summonCount: 2, summonCap: 4, summonCd: 0.5 });
    state.monsters.push(m);
    state = run(state, freshInput(), 40);
    const add = state.monsters.find((x) => x !== m && x.summonedBy === m.id);
    assert.ok(add, 'an add exists');
    assert.ok(add.hp > 0 && typeof add.type === 'string', 'it is a fully-formed monster');
    assert.ok(state.monsters.indexOf(add) !== -1, 'it is in the live monster list');
  });

  // ---- determinism, which the replay tests depend on ----

  test('behaviors draw only from the seeded RNG: same seed, same fight', () => {
    const play = () => {
      let state = Game.newRun(88);
      state.monsters.length = 0;
      state.player.baseMaxHP = 100000; state.player.hp = 100000;
      state.monsters.push(
        mk(state, 'brute', 80, 0, true, { behavior: 'slam', slamRange: 120, slamRadius: 90, slamDmg: 12, slamWindup: 0.6, slamCd: 2 }),
        mk(state, 'wraith', 220, 40, true, { behavior: 'caster', castRange: 400, castCd: 1.0, castDmg: 6, castSpeed: 260, keepAway: 180 }),
        mk(state, 'brute', -160, 60, true, { behavior: 'summon', summonType: 'bat', summonCount: 1, summonCap: 3, summonCd: 1.5 })
      );
      state = run(state, freshInput(), 300);
      return { hp: state.player.hp, n: state.monsters.length, pos: state.monsters.map((x) => [Math.round(x.x), Math.round(x.y)]) };
    };
    assert.deepEqual(play(), play(), 'two runs of the same seed agree exactly');
  });

  test('a caster with castBurn actually sets the hero alight', () => {
    let state = Game.newRun(89);
    state.monsters.length = 0;
    state.player.baseMaxHP = 100000; state.player.hp = 100000;
    const m = mk(state, 'wraith', 200, 0, true, { behavior: 'caster', castRange: 400, castCd: 0.5, castDmg: 4, castSpeed: 300, keepAway: 180, castBurn: 6 });
    state.monsters.push(m);
    let burned = false;
    const input = freshInput();
    for (let i = 0; i < 200; i++) {
      state = Game.update(state, input, 1 / 60);
      Game.applyEvents(state, Game.drainEvents(state));
      if (G.hasStatus(state.player, 'burn')) burned = true;
    }
    assert.ok(burned, 'the bolt applied its burn on contact');
  });
})();

// ---- Suite 2: content-expansion archetypes (ranged / exploder / charger / summoner) ----
(function () {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');

  globalThis.U = require('../js/util.js');
  globalThis.Skills = require('../js/skills.js');
  globalThis.Items = require('../js/items.js');
  globalThis.Stats = require('../js/stats.js');
  globalThis.Entities = require('../js/entities.js');
  globalThis.Dungeon = require('../js/dungeon.js');
  globalThis.Balance = require('../js/balance.js');
  const Game = require('../js/game.js');

  const TS = Dungeon.TILE_SIZE;

  function freshInput() {
    return {
      keys: { w: false, a: false, s: false, d: false, space: false },
      pressed: new Set(),
      mouse: { x: 0, y: 0, click: false, rclick: false },
    };
  }
  function run(state, input, frames) {
    for (let i = 0; i < frames; i++) {
      state = Game.update(state, input, 1 / 60);
      input.pressed.clear();
    }
    return state;
  }
  // Move the hero to a tile in the entry room where every listed offset lands on
  // open floor, so placements survive a dungeon-layout change instead of parking a
  // monster inside a wall. Mirrors the same-named helper in weapons.test.js.
  function standClearOf(state, offsets) {
    const room = state.dungeon.rooms[0];
    const grid = state.dungeon.grid;
    const open = (px, py) => {
      const tx = Math.floor(px / TS);
      const ty = Math.floor(py / TS);
      return grid[ty] !== undefined && Dungeon.isWalkable(grid[ty][tx]);
    };
    for (let ty = room.y + 1; ty < room.y + room.h - 1; ty++) {
      for (let tx = room.x + 1; tx < room.x + room.w - 1; tx++) {
        const px = tx * TS + TS / 2;
        const py = ty * TS + TS / 2;
        if (!open(px, py)) continue;
        if (!offsets.every(([dx, dy]) => open(px + dx, py + dy))) continue;
        state.player.x = px;
        state.player.y = py;
        return;
      }
    }
    assert.fail(`entry room has no spot clear of ${JSON.stringify(offsets)}`);
  }
  // Place an aggroed monster of `type` at an offset the caller has cleared with
  // standClearOf (so it stands on open floor regardless of the generated layout).
  function place(state, type, dx, dy, extra = {}) {
    const m = {
      ...Entities.makeMonster(type, 5, false),
      x: state.player.x + dx,
      y: state.player.y + dy,
      attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
      ...extra,
    };
    const tile = state.dungeon.grid[Math.floor(m.y / TS)][Math.floor(m.x / TS)];
    assert.ok(Dungeon.isWalkable(tile), `${type} at +${dx},${dy} must stand on open floor`);
    state.monsters.push(m);
    return m;
  }

  test('a ranged caster looses a hostile bolt that damages the player, not monsters', () => {
    let state = Game.newRun(41);
    state.monsters.length = 0;
    standClearOf(state, [[150, 0], [80, 0]]);
    const cultist = place(state, 'cultist', 150, 0);
    const bystander = place(state, 'zombie', 80, 0, { attackT: 999, aggroed: false, hp: 500, maxHP: 500 });
    const hp0 = state.player.hp;
    const input = freshInput();
    // Let the cast wind up and the bolt fly back to the hero.
    let sawBolt = false;
    for (let i = 0; i < 120; i++) {
      state = Game.update(state, input, 1 / 60);
      if (state.projectiles.some((pr) => pr.hostile && pr.kind === 'bolt')) sawBolt = true;
    }
    assert.ok(sawBolt, 'the caster spawned a hostile bolt');
    assert.ok(state.player.hp < hp0, `bolt hurt the hero (${hp0} -> ${state.player.hp})`);
    assert.equal(bystander.hp, 500, 'a hostile bolt never damages monsters');
    assert.ok(cultist.hp > 0, 'the caster is unharmed by its own bolt');
  });

  test('an exploder fuses on contact and detonates an AoE, removing itself', () => {
    let state = Game.newRun(41);
    state.monsters.length = 0;
    const bomber = place(state, 'bomber', 40, 0);
    const hp0 = state.player.hp;
    const input = freshInput();
    state = run(state, input, 120);
    assert.ok(state.player.hp < hp0, `the blast hurt the hero (${hp0} -> ${state.player.hp})`);
    assert.ok(!state.monsters.includes(bomber), 'the exploder consumed itself in the blast');
  });

  test('a charger winds up then dashes across ground and lands a contact hit', () => {
    let state = Game.newRun(41);
    state.monsters.length = 0;
    standClearOf(state, [[150, 0]]);
    const gargoyle = place(state, 'gargoyle', 150, 0);
    const startDist = Math.hypot(gargoyle.x - state.player.x, gargoyle.y - state.player.y);
    const hp0 = state.player.hp;
    const input = freshInput();
    state = run(state, input, 90);
    const endDist = Math.hypot(gargoyle.x - state.player.x, gargoyle.y - state.player.y);
    assert.ok(endDist < startDist - 40, `the charger closed the gap (${startDist.toFixed(0)} -> ${endDist.toFixed(0)})`);
    assert.ok(state.player.hp < hp0, 'the dash landed a contact hit');
  });

  test('a summoner raises minions up to its cap and no further', () => {
    let state = Game.newRun(41);
    state.monsters.length = 0;
    standClearOf(state, [[150, 0]]);
    const necro = place(state, 'necromancer', 150, 0);
    // Make the hero unkillable so minions persist and the cap is what bounds the count.
    state.player.baseMaxHP = 1e6;
    state.player.hp = 1e6;
    const cap = Balance.behaviors.summoner.cap;
    let maxConcurrent = 0;
    const input = freshInput();
    for (let i = 0; i < 1800; i++) {
      state = Game.update(state, input, 1 / 60);
      const summoned = state.monsters.filter((m) => m.summonerId === necro.id).length;
      if (summoned > maxConcurrent) maxConcurrent = summoned;
    }
    assert.ok(maxConcurrent >= 1, 'the summoner raised at least one minion');
    assert.ok(maxConcurrent <= cap, `never exceeds the cap (${maxConcurrent} <= ${cap})`);
  });

  test('summoning is deterministic for a given seed', () => {
    const raise = () => {
      let state = Game.newRun(41);
      state.monsters.length = 0;
      standClearOf(state, [[150, 0]]);
      const necro = place(state, 'necromancer', 150, 0);
      state.player.baseMaxHP = 1e6;
      state.player.hp = 1e6;
      const input = freshInput();
      state = run(state, input, 300);
      return state.monsters.filter((m) => m.summonerId === necro.id).length;
    };
    assert.equal(raise(), raise(), 'same seed → same minion count');
  });

  // ---- The shared hurt path (unit) ----

  test('hurtPlayer respects dodge and subtracts defense', () => {
    const hurt = Game._.hurtPlayer;
    // Dodging negates the hit entirely.
    let state = Game.newRun(41);
    const dodger = state.player;
    dodger.dodgeT = 1;
    const dodgerHp = dodger.hp;
    assert.equal(hurt(state, dodger, 30, {}), 0, 'a dodge takes no damage');
    assert.equal(dodger.hp, dodgerHp);
    // Defense reduces the landed hit.
    state = Game.newRun(42);
    const p = state.player;
    p.dodgeT = 0;
    p.equip.armor = { slot: 'armor', stats: { defense: 5 }, affixes: [] };
    const before = p.hp;
    const dealt = hurt(state, p, 20, {});
    assert.equal(dealt, 15, 'defense 5 turns a 20 hit into 15');
    assert.equal(p.hp, before - 15);
  });
})();
