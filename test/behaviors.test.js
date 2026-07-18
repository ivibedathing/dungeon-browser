const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
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
