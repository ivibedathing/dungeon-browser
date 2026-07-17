const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
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

function equipWeapon(state, kind) {
  const rng = U.mulberry32(11);
  const w = Items.makeItem(1, rng, { slot: 'weapon', kind });
  state.player.equip.weapon = w;
  return w;
}

function placeMonster(state, dx, dy) {
  const m = {
    ...Entities.makeMonster('zombie', 1, false),
    x: state.player.x + dx,
    y: state.player.y + dy,
    attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0,
  };
  // Offsets are hand-picked against a seed's room shape; a monster parked inside a wall
  // is unreachable by design, so a test built on one would be asserting nothing.
  const tile = state.dungeon.grid[Math.floor(m.y / TS)][Math.floor(m.x / TS)];
  assert.ok(Dungeon.isWalkable(tile), `monster at +${dx},${dy} must stand on open floor`);
  state.monsters.push(m);
  return m;
}

test('weapon kinds: melee has arc/radius/knockback, bow and wand are ranged', () => {
  const rng = U.mulberry32(21);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const w = Items.makeItem(2, rng, { slot: 'weapon' });
    assert.ok(['melee', 'bow', 'wand'].includes(w.kind), `kind ${w.kind}`);
    seen.add(w.kind);
    if (w.kind === 'melee') {
      assert.ok(w.stats.radius >= 60, 'melee has swing radius');
      assert.ok(w.stats.arc > 1.5 && w.stats.arc < 4, `melee arc ${w.stats.arc}`);
      assert.ok(w.stats.kb > 0, 'melee has knockback');
    } else {
      assert.ok(w.stats.projSpeed >= 200, `${w.kind} projSpeed ${w.stats.projSpeed}`);
      assert.equal(w.stats.radius, undefined, 'ranged has no swing radius');
      assert.ok(!(w.affixes || []).some((a) => a.key === 'radius'), 'no radius affix on ranged');
      if (w.kind === 'wand') assert.ok(w.stats.aoe >= 40, `wand aoe ${w.stats.aoe}`);
    }
    assert.ok(w.stats.damage > 0 && w.stats.speed > 0);
  }
  assert.deepEqual([...seen].sort(), ['bow', 'melee', 'wand'], 'all three kinds drop');
});

test('makeItem honors an explicit kind request', () => {
  const rng = U.mulberry32(5);
  assert.equal(Items.makeItem(1, rng, { slot: 'weapon', kind: 'bow' }).kind, 'bow');
  assert.equal(Items.makeItem(1, rng, { slot: 'weapon', kind: 'wand' }).kind, 'wand');
  assert.equal(Items.makeItem(1, rng, { slot: 'weapon', kind: 'melee' }).kind, 'melee');
});

test('a bow fires an arrow that kills a monster down the line', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  equipWeapon(state, 'bow');
  const m = placeMonster(state, 150, 0);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.ok(state.projectiles.length >= 1, 'arrow spawned');
  const arrow = state.projectiles[0];
  assert.ok(arrow.vx > 0 && Math.abs(arrow.vy) < 1, 'arrow flies along facing');
  state = run(state, input, 500);
  assert.ok(state.kills >= 1, `arrows killed the zombie (kills=${state.kills})`);
  assert.ok(!state.monsters.includes(m));
});

test('a wand fireball explodes and hurts the whole pack', () => {
  let state = Game.newRun(42);
  state.monsters.length = 0;
  equipWeapon(state, 'wand');
  placeMonster(state, 160, 0);
  placeMonster(state, 150, 18);
  placeMonster(state, 150, -18);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = run(state, input, 700);
  assert.equal(state.kills, 3, `fireballs cleared the pack (kills=${state.kills})`);
});

test('projectiles vanish when they hit a wall', () => {
  let state = Game.newRun(43);
  state.monsters.length = 0;
  equipWeapon(state, 'bow');
  state.player.facing = Math.PI; // straight into the room's wall eventually
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  input.keys.space = false;
  assert.ok(state.projectiles.length >= 1);
  state = run(state, input, 240);
  assert.equal(state.projectiles.length, 0, 'arrow gone after hitting the wall');
});

test('effectiveStats exposes the weapon kind and ranged parameters', () => {
  const p = Entities.newPlayer();
  const s0 = Entities.effectiveStats(p);
  assert.equal(s0.kind, 'melee');
  assert.ok(s0.arc > 1.5 && s0.kb > 0);
  const rng = U.mulberry32(6);
  p.equip.weapon = Items.makeItem(1, rng, { slot: 'weapon', kind: 'wand' });
  const s1 = Entities.effectiveStats(p);
  assert.equal(s1.kind, 'wand');
  assert.ok(s1.projSpeed >= 200);
  assert.ok(s1.aoe >= 40);
});
