const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Stats = require('../js/stats.js');
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
// A bare entity is enough for the pure timer/stacking rules — no dungeon needed.
const ent = () => ({ x: 0, y: 0, hp: 100 });

// ---- Pure rules ----

test('a condition expires on its own clock', () => {
  const e = ent();
  G.applyStatus(e, 'slow', 2, { mag: 0.5 });
  assert.ok(G.hasStatus(e, 'slow'), 'applied');
  G.statusUpdate(null, e, 1.0);
  assert.ok(G.hasStatus(e, 'slow'), 'still running at 1.0s of 2s');
  G.statusUpdate(null, e, 1.2);
  assert.ok(!G.hasStatus(e, 'slow'), 'gone past 2s');
});

test('refresh-longest: re-applying never shortens or weakens a condition', () => {
  const e = ent();
  G.applyStatus(e, 'slow', 4, { mag: 0.5 });
  G.applyStatus(e, 'slow', 1, { mag: 0.2 }); // weaker and shorter — must not dilute
  assert.equal(e.status.slow.t, 4, 'keeps the longer duration');
  assert.equal(e.status.slow.mag, 0.5, 'keeps the stronger magnitude');

  G.applyStatus(e, 'slow', 6, { mag: 0.3 }); // longer but weaker
  assert.equal(e.status.slow.t, 6, 'extends to the longer duration');
  assert.equal(e.status.slow.mag, 0.5, 'still keeps the stronger magnitude');
});

test('an unknown condition or a non-positive duration is rejected outright', () => {
  const e = ent();
  assert.equal(G.applyStatus(e, 'petrify', 3), false, 'unknown kind');
  assert.equal(G.applyStatus(e, 'slow', 0), false, 'zero duration');
  assert.equal(G.applyStatus(e, 'slow', -2), false, 'negative duration');
  assert.deepEqual(e.status, undefined, 'nothing was written');
});

test('slow scales movement but never fully immobilizes — that is what stun is for', () => {
  const e = ent();
  assert.equal(G.statusMoveMult(e), 1, 'unafflicted is full speed');
  G.applyStatus(e, 'slow', 2, { mag: 0.5 });
  assert.equal(G.statusMoveMult(e), 0.5, 'half speed at mag 0.5');
  G.applyStatus(e, 'slow', 2, { mag: 5 }); // absurd magnitude
  assert.ok(G.statusMoveMult(e) >= 0.25, 'clamped to a floor, never zero');
});

// ---- Wired into the sim ----

test('slow folds into effectiveStats.moveMult and actually slows the hero down', () => {
  const walk = (slowed) => {
    let state = Game.newRun(71);
    state.monsters.length = 0;
    if (slowed) G.applyStatus(state.player, 'slow', 99, { mag: 0.5 });
    const x0 = state.player.x;
    const input = freshInput();
    input.keys.d = true;
    state = run(state, input, 30);
    return Math.abs(state.player.x - x0);
  };
  const free = walk(false);
  const slow = walk(true);
  assert.ok(free > 0, 'control: the hero moves at all');
  assert.ok(slow < free * 0.75, `slowed hero covers less ground (${Math.round(slow)} vs ${Math.round(free)})`);
});

test('a stunned hero neither moves nor swings', () => {
  let state = Game.newRun(72);
  state.monsters.length = 0;
  G.applyStatus(state.player, 'stun', 99);
  const x0 = state.player.x;
  const input = freshInput();
  input.keys.d = true;
  input.keys.space = true;
  state = run(state, input, 20);
  assert.ok(Math.abs(state.player.x - x0) < 2, 'pinned in place');
  assert.equal(state.player.swing, null, 'no swing while stunned');
});

test('a stunned monster neither closes nor attacks', () => {
  let state = Game.newRun(73);
  state.monsters.length = 0;
  const m = { ...Entities.makeMonster('zombie', 1, false), x: state.player.x + 20, y: state.player.y, attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0 };
  state.monsters.push(m);
  G.applyStatus(m, 'stun', 99);
  const hp0 = state.player.hp;
  state = run(state, freshInput(), 20);
  assert.equal(state.player.hp, hp0, 'stunned monster lands no hit');
});

test('burn deals its damage over time, not all at once', () => {
  let state = Game.newRun(74);
  state.monsters.length = 0;
  const m = { ...Entities.makeMonster('zombie', 1, false), x: state.player.x + 400, y: state.player.y, attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0 };
  state.monsters.push(m);
  const hp0 = m.hp;
  G.applyStatus(m, 'burn', 2, { dps: 10, src: state.player });

  state = run(state, freshInput(), 12); // ~0.2s in
  assert.ok(m.hp > hp0 - 10, 'has not dumped the whole pool immediately');
  assert.ok(m.hp < hp0, 'but is already ticking');

  state = run(state, freshInput(), 150); // well past 2s
  const dealt = hp0 - m.hp;
  assert.ok(dealt >= 17 && dealt <= 23, `~20 damage total over the burn (got ${dealt})`);
  assert.ok(!G.hasStatus(m, 'burn'), 'burn burned out');
});

test('burn can kill, and the kill is credited to whoever lit the fire', () => {
  let state = Game.newRun(75);
  state.monsters.length = 0;
  const m = { ...Entities.makeMonster('zombie', 1, false), x: state.player.x + 400, y: state.player.y, attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0 };
  m.hp = 5;
  state.monsters.push(m);
  const kills0 = state.kills;
  const xp0 = state.player.xp;
  G.applyStatus(m, 'burn', 3, { dps: 10, src: state.player });
  state = run(state, freshInput(), 120);
  assert.equal(state.monsters.length, 0, 'burn finished it off');
  assert.equal(state.kills, kills0 + 1, 'counted as a kill');
  assert.ok(state.player.xp > xp0, 'XP credited to the source');
});

test('conditions clear on a fresh floor rather than riding the stairs down', () => {
  let state = Game.newRun(76);
  G.applyStatus(state.player, 'burn', 99, { dps: 5 });
  G.applyStatus(state.player, 'slow', 99, { mag: 0.5 });
  G.descend(state);
  assert.ok(!G.hasStatus(state.player, 'burn'), 'burn does not follow you down');
  assert.ok(!G.hasStatus(state.player, 'slow'), 'neither does slow');
});
