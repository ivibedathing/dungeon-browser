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

function bossOn(state, hp, phases) {
  const m = {
    ...Entities.makeMonster('brute', 4, false),
    id: state.nextId++,
    x: state.player.x + 120, y: state.player.y,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
    boss: true, name: 'Test Guardian',
    behavior: 'melee',
    hp, maxHP: hp,
    phases,
  };
  state.monsters.push(m);
  return m;
}
const twoPhases = () => ([
  { at: 0.66, behavior: 'slam', slamRange: 200, slamRadius: 80, slamDmg: 5, slamWindup: 0.5, slamCd: 3 },
  { at: 0.33, behavior: 'caster', castRange: 400, castCd: 1, castDmg: 5, speedMult: 1.4 },
]);

test('crossing two thresholds in a single hit fires both, in order, exactly once', () => {
  let state = Game.newRun(91);
  state.monsters.length = 0;
  const m = bossOn(state, 1000, twoPhases());
  const stats = Entities.effectiveStats(state.player);

  // One burst from 100% straight down to 20% — past both gates at once. A phase
  // checked in the AI tick instead of here would silently skip the first one.
  G.hitMonster(state, m, 800, stats, 0, 0, state.player);

  assert.equal(m.phaseIdx, 2, 'both transitions fired');
  assert.equal(m.behavior, 'caster', 'landed on the LAST phase crossed, not the first');
  assert.equal(m.speedMult, 1.4, 'the last phase\'s on-entry effects are the ones in force');
});

test('phases fire one at a time as damage arrives gradually', () => {
  let state = Game.newRun(92);
  state.monsters.length = 0;
  const m = bossOn(state, 1000, twoPhases());
  const stats = Entities.effectiveStats(state.player);

  G.hitMonster(state, m, 100, stats, 0, 0, state.player); // 90% — nothing yet
  assert.equal(m.phaseIdx, 0, 'still phase 0 above the first gate');
  assert.equal(m.behavior, 'melee', 'behavior untouched');

  G.hitMonster(state, m, 300, stats, 0, 0, state.player); // 60% — first gate
  assert.equal(m.phaseIdx, 1, 'first transition fired');
  assert.equal(m.behavior, 'slam');

  G.hitMonster(state, m, 300, stats, 0, 0, state.player); // 30% — second gate
  assert.equal(m.phaseIdx, 2, 'second transition fired');
  assert.equal(m.behavior, 'caster');
});

test('a phase never re-fires, however many hits land inside its band', () => {
  let state = Game.newRun(93);
  state.monsters.length = 0;
  const m = bossOn(state, 1000, twoPhases());
  const stats = Entities.effectiveStats(state.player);

  G.hitMonster(state, m, 400, stats, 0, 0, state.player); // 60% — crosses gate 1
  for (let i = 0; i < 5; i++) G.hitMonster(state, m, 10, stats, 0, 0, state.player); // chip inside the band
  assert.equal(m.phaseIdx, 1, 'still exactly one transition fired');
});

test('an on-entry summon wave arrives once, on the transition', () => {
  let state = Game.newRun(94);
  state.monsters.length = 0;
  const m = bossOn(state, 1000, [{ at: 0.5, behavior: 'melee', onEnterSummon: { type: 'bat', count: 3, cap: 6 } }]);
  const stats = Entities.effectiveStats(state.player);

  G.hitMonster(state, m, 100, stats, 0, 0, state.player); // above the gate
  assert.equal(state.monsters.filter((x) => x.summonedBy === m.id).length, 0, 'no wave before the gate');

  G.hitMonster(state, m, 500, stats, 0, 0, state.player); // crosses 50%
  const wave = state.monsters.filter((x) => x.summonedBy === m.id).length;
  assert.ok(wave > 0, `a wave arrived (${wave})`);

  G.hitMonster(state, m, 50, stats, 0, 0, state.player); // more damage, same band
  assert.equal(state.monsters.filter((x) => x.summonedBy === m.id).length, wave, 'no second wave');
});

test('a killing blow does not fire the phases it passes through on the way down', () => {
  let state = Game.newRun(95);
  state.monsters.length = 0;
  const m = bossOn(state, 500, [{ at: 0.5, behavior: 'melee', onEnterSummon: { type: 'bat', count: 3, cap: 6 } }]);
  const stats = Entities.effectiveStats(state.player);

  G.hitMonster(state, m, 9999, stats, 0, 0, state.player);
  assert.equal(state.monsters.indexOf(m), -1, 'the boss is dead');
  assert.equal(state.monsters.filter((x) => x.summonedBy === m.id).length, 0, 'a corpse summons nothing');
});

test('a monster with no phases is completely unaffected', () => {
  let state = Game.newRun(96);
  state.monsters.length = 0;
  const m = {
    ...Entities.makeMonster('zombie', 3, false), id: state.nextId++,
    x: state.player.x + 60, y: state.player.y,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
  };
  state.monsters.push(m);
  const stats = Entities.effectiveStats(state.player);
  G.hitMonster(state, m, 1, stats, 0, 0, state.player);
  assert.equal(m.phaseIdx, undefined, 'no phase bookkeeping appears');
  assert.equal(m.behavior, 'melee', 'plain melee, the default — no special archetype');
});

test('burn damage can trigger a phase — every damage source goes through one door', () => {
  let state = Game.newRun(97);
  state.monsters.length = 0;
  const m = bossOn(state, 100, [{ at: 0.5, behavior: 'slam' }]);
  m.x = state.player.x + 500; // out of melee reach; only the burn is acting
  G.applyStatus(m, 'burn', 5, { dps: 30, src: state.player });

  const input = { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
  for (let i = 0; i < 180; i++) { state = Game.update(state, input, 1 / 60); Game.applyEvents(state, Game.drainEvents(state)); }

  assert.equal(m.phaseIdx, 1, 'the burn crossed the gate and the phase fired');
});

test("a phase's speedMult is actually read, not just written onto the boss", () => {
  const travel = (withPhase) => {
    let state = Game.newRun(98);
    state.monsters.length = 0;
    state.player.baseMaxHP = 100000; state.player.hp = 100000;
    // This test measures phase speed, not the generated layout, so put the hero at a
    // fixed interior tile with room to the right and carve a straight open lane to the
    // boss. (The organic layout may spawn the hero near an edge or leave no 420px shot,
    // which would push the boss off-grid or make it path around walls.)
    const TS = Dungeon.TILE_SIZE;
    const laneY = Math.floor(state.dungeon.grid.length / 2);
    state.player.x = 6.5 * TS;
    state.player.y = (laneY + 0.5) * TS;
    const m = bossOn(state, 1000, [{ at: 0.9, behavior: 'melee', speedMult: 2.5 }]);
    m.x = state.player.x + 420; // far enough that the whole window is spent closing
    m.y = state.player.y;
    const x0 = Math.floor(state.player.x / TS);
    const x1 = Math.floor(m.x / TS);
    for (let tx = x0 - 1; tx <= x1 + 1; tx++) {
      for (let ry = laneY - 1; ry <= laneY + 1; ry++) {
        if (state.dungeon.grid[ry] && state.dungeon.grid[ry][tx] !== undefined) state.dungeon.grid[ry][tx] = Dungeon.TILE.FLOOR;
      }
    }
    state.flow.field = null; // force a recompute over the freshly carved lane
    const stats = Entities.effectiveStats(state.player);
    if (withPhase) G.hitMonster(state, m, 200, stats, 0, 0, state.player); // trip the gate
    const d0 = Math.hypot(m.x - state.player.x, m.y - state.player.y);
    const input = { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
    for (let i = 0; i < 45; i++) { state = Game.update(state, input, 1 / 60); Game.applyEvents(state, Game.drainEvents(state)); }
    return d0 - Math.hypot(m.x - state.player.x, m.y - state.player.y);
  };
  const slow = travel(false);
  const fast = travel(true);
  assert.ok(slow > 0, 'control: the boss closes distance at all');
  assert.ok(fast > slow * 1.4, `the enraged phase is visibly faster (${Math.round(fast)} vs ${Math.round(slow)}px)`);
});
