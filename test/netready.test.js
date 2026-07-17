// Phase 0 (netcode-ready refactor) tests — grows task by task.
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); input.pressed.clear(); }
  return state;
}

test('monsters, projectiles and drops carry unique, stable, never-reused ids', () => {
  let state = Game.newRun(21);
  const ids = state.monsters.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'monster ids unique');
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 0));
  const firstId = state.monsters[0].id;
  state = run(state, freshInput(), 30);
  assert.equal(state.monsters[0].id, firstId, 'ids stable across updates');

  // Ranged attack produces an id-carrying projectile.
  state.monsters.length = 0;
  state.player.equip.weapon = Items.makeItem(1, U.mulberry32(1), { slot: 'weapon', kind: 'bow' });
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.ok(state.projectiles[0].id > 0, 'projectile has id');

  // Descending must not reuse ids from the previous floor.
  const oldIds = new Set(ids);
  state.player.x = (state.dungeon.stairs.x + 0.5) * 32;
  state.player.y = (state.dungeon.stairs.y + 0.5) * 32;
  state = run(state, freshInput(), 3);
  assert.equal(state.floor, 2);
  for (const m of state.monsters) {
    assert.ok(m.id > 0, 'floor-2 monster has id');
    assert.ok(!oldIds.has(m.id), `id ${m.id} reused`);
  }
});

test('sim emits events; applyEvents turns them into presentation state', () => {
  let state = Game.newRun(22);
  state.monsters.length = 0;
  const m = { ...Entities.makeMonster('bat', 1, false), id: 999, x: state.player.x + 30, y: state.player.y, attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0 };
  m.hp = 1;
  state.monsters.push(m);
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);

  const events = Game.drainEvents(state);
  assert.ok(events.some((e) => e.type === 'float'), 'damage number event');
  assert.ok(events.some((e) => e.type === 'sfx' && e.name === 'kill'), 'kill sound event');
  assert.ok(events.some((e) => e.type === 'kill' && e.monsterId === 999), 'structured kill event');
  assert.equal(state.events.length, 0, 'drain clears the buffer');
  assert.equal(state.floatTexts.length, 0, 'sim itself no longer writes presentation arrays');

  Game.applyEvents(state, events);
  assert.ok(state.floatTexts.length > 0, 'applier materializes floaties');
  assert.ok(state.particles.length > 0, 'applier materializes blood');
});

function addSecondPlayer(state, dx, dy) {
  const p2 = Entities.newPlayer();
  p2.id = 'p1';
  Object.assign(p2, {
    facing: 0, attackT: 0, swing: null, hurtT: 0, healPool: 0, healRate: 0, dead: false,
    skillCd: { whirlwind: 0, nova: 0, prayer: 0 },
    dodgeT: 0, dodgeCdT: 0, dodgeDir: { x: 1, y: 0 },
    x: state.player.x + dx, y: state.player.y + dy,
  });
  state.players.push(p2);
  return p2;
}

test('two players receive independent inputs in one update', () => {
  let state = Game.newRun(23);
  state.monsters.length = 0;
  addSecondPlayer(state, 40, 0);

  const right = freshInput();
  right.keys.d = true;
  const down = freshInput();
  down.keys.s = true;
  const x0 = [state.players[0].x, state.players[1].x];
  const y0 = [state.players[0].y, state.players[1].y];
  for (let i = 0; i < 30; i++) state = Game.update(state, { p0: right, p1: down }, 1 / 60);
  assert.ok(state.players[0].x > x0[0] + 20, 'p0 moved right');
  assert.ok(Math.abs(state.players[0].y - y0[0]) < 1, 'p0 did not drift down');
  assert.ok(state.players[1].y > y0[1] + 20, 'p1 moved down');
  assert.equal(state.player, state.players[0], 'legacy alias intact');
  assert.equal(state.player.id, 'p0');
  assert.equal(state.dead, false, 'nobody died just from walking');
});

test('monsters chase the nearest of several players', () => {
  let state = Game.newRun(24);
  state.monsters.length = 0;
  addSecondPlayer(state, 200, 0);

  const m = {
    ...Entities.makeMonster('skeleton', 1, false),
    id: 1000,
    x: state.player.x + 150,
    y: state.player.y,
    attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
  };
  state.monsters.push(m);

  const idle = freshInput();
  for (let i = 0; i < 120; i++) state = Game.update(state, { p0: idle, p1: idle }, 1 / 60);
  const dP0 = Math.hypot(m.x - state.players[0].x, m.y - state.players[0].y);
  const dP1 = Math.hypot(m.x - state.players[1].x, m.y - state.players[1].y);
  assert.ok(dP1 < dP0, `skeleton went for the closer player (p1 ${Math.round(dP1)} vs p0 ${Math.round(dP0)})`);
});

test('flowFieldMulti reaches a target from either source; the 1-source wrapper still works', () => {
  const d = Dungeon.generateDungeon(11, 1);
  const single = Dungeon.flowField(d.grid, d.entry.x, d.entry.y, Infinity);
  assert.equal(single[d.entry.y][d.entry.x], 0, 'wrapper intact');
  const multi = Dungeon.flowFieldMulti(d.grid, [
    { x: d.entry.x, y: d.entry.y },
    { x: d.stairs.x, y: d.stairs.y },
  ], Infinity);
  assert.equal(multi[d.entry.y][d.entry.x], 0);
  assert.equal(multi[d.stairs.y][d.stairs.x], 0, 'both sources are distance zero');
  let improved = 0;
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (multi[y][x] !== Infinity && single[y][x] !== Infinity) {
        assert.ok(multi[y][x] <= single[y][x], 'multi-source never farther than single');
        if (multi[y][x] < single[y][x]) improved++;
      }
    }
  }
  assert.ok(improved > 10, 'the second source actually pulls distances down');
});

test('stepFixed runs whole 30 Hz ticks and banks the remainder', () => {
  let state = Game.newRun(25);
  state.monsters.length = 0;
  const inputs = { p0: freshInput() };
  const t0 = state.time;
  state = Game.stepFixed(state, inputs, 0.1); // 3 ticks, remainder banked
  assert.ok(Math.abs(state.time - t0 - 3 / 30) < 1e-9, `ticked 3 (got ${state.time - t0})`);
  state = Game.stepFixed(state, inputs, 0.004); // banks up, no tick yet
  state = Game.stepFixed(state, inputs, 0.03); // pushes past one more tick
  assert.ok(Math.abs(state.time - t0 - 4 / 30) < 1e-9, 'remainder carried across calls');
  const before = state.time;
  state = Game.stepFixed(state, inputs, 10); // runaway elapsed clamped to 0.25s of catch-up
  assert.ok(state.time - before <= 0.25 + 1e-9, 'clamped catch-up');
  assert.ok(state.time - before >= 0.2, 'still caught up most of the clamp window');
});

test('same seed + same inputs → identical outcomes (replayable sim)', () => {
  const script = (state) => {
    const input = freshInput();
    input.keys.space = true;
    input.keys.d = true;
    for (let i = 0; i < 600; i++) {
      if (i % 90 === 0) input.pressed.add('interact');
      state = Game.update(state, { p0: input }, 1 / 30);
      input.pressed.clear();
    }
    return state;
  };
  const a = script(Game.newRun(777));
  const b = script(Game.newRun(777));
  assert.equal(a.kills, b.kills, 'kills match');
  assert.equal(a.bag.gold, b.bag.gold, 'gold matches');
  assert.deepEqual(JSON.parse(JSON.stringify(a.bag.slots)), JSON.parse(JSON.stringify(b.bag.slots)), 'loot matches');
  assert.deepEqual(
    a.monsters.map((m) => [m.id, Math.round(m.hp), Math.round(m.x), Math.round(m.y)]),
    b.monsters.map((m) => [m.id, Math.round(m.hp), Math.round(m.x), Math.round(m.y)]),
    'monster hp and positions match'
  );
  assert.deepEqual(
    a.groundItems.map((g) => [g.id, g.kind, Math.round(g.x)]),
    b.groundItems.map((g) => [g.id, g.kind, Math.round(g.x)]),
    'ground drops match'
  );
  const c = script(Game.newRun(778));
  assert.notEqual(
    JSON.stringify(a.monsters.map((m) => [Math.round(m.x), Math.round(m.y)])),
    JSON.stringify(c.monsters.map((m) => [Math.round(m.x), Math.round(m.y)])),
    'different seed diverges (different world, different wandering)'
  );
});
