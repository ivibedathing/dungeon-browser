const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
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

// Stand the player somewhere in the entry room with open floor at every offset the
// test is about to place a monster on. Beats hand-picking offsets against one seed's
// room shape: a layout change then re-solves here instead of failing the suite.
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

// Every weapon kind, split by the combat traits its category must carry.
const MELEE_KINDS = ['melee'];
const RANGED_KINDS = ['bow', 'crossbow', 'wand', 'staff', 'thrown'];
const AOE_KINDS = ['wand', 'staff']; // ranged kinds whose projectile explodes
const ALL_KINDS = [...MELEE_KINDS, ...RANGED_KINDS];

test('weapon kinds: melee carries arc/radius/kb; ranged kinds fire projectiles', () => {
  const rng = U.mulberry32(21);
  const seenKinds = new Set();
  const seenFamilies = new Set();
  // Deep floor so every minFloor-gated base is eligible and all kinds can appear.
  for (let i = 0; i < 4000; i++) {
    const w = Items.makeItem(9, rng, { slot: 'weapon' });
    assert.ok(ALL_KINDS.includes(w.kind), `unexpected kind ${w.kind}`);
    assert.ok(typeof w.family === 'string' && w.family.length > 0, 'weapon has a family');
    seenKinds.add(w.kind);
    seenFamilies.add(w.family);
    if (MELEE_KINDS.includes(w.kind)) {
      assert.ok(w.stats.radius >= 55, `melee swing radius ${w.stats.radius}`);
      assert.ok(w.stats.arc > 1.5 && w.stats.arc < 4, `melee arc ${w.stats.arc}`);
      assert.ok(w.stats.kb > 0, 'melee has knockback');
    } else {
      assert.ok(w.stats.projSpeed >= 200, `${w.kind} projSpeed ${w.stats.projSpeed}`);
      assert.equal(w.stats.radius, undefined, 'ranged has no swing radius');
      assert.ok(!(w.affixes || []).some((a) => a.key === 'radius'), 'no radius affix on ranged');
      if (AOE_KINDS.includes(w.kind)) assert.ok(w.stats.aoe >= 40, `${w.kind} aoe ${w.stats.aoe}`);
      else assert.ok(!w.stats.aoe, `${w.kind} should not have aoe`);
    }
    assert.ok(w.stats.damage > 0 && w.stats.speed > 0);
  }
  assert.deepEqual([...seenKinds].sort(), [...ALL_KINDS].sort(), 'every weapon kind drops');
  // The expansion should surface a broad spread of visual families.
  assert.ok(seenFamilies.size >= 10, `only ${seenFamilies.size} families seen`);
});

test('makeItem honors an explicit kind request for every kind', () => {
  const rng = U.mulberry32(5);
  for (const kind of ALL_KINDS) {
    // Floor 9 so kinds whose only base is minFloor-gated (e.g. staff/crossbow) exist.
    const w = Items.makeItem(9, rng, { slot: 'weapon', kind });
    assert.equal(w.kind, kind, `requested ${kind}`);
    assert.ok(w.family, `${kind} has a family`);
  }
});

test('weapon generation is deterministic for a given seed', () => {
  const a = Items.makeItem(6, U.mulberry32(1234), { slot: 'weapon' });
  const b = Items.makeItem(6, U.mulberry32(1234), { slot: 'weapon' });
  assert.equal(a.base, b.base, 'same seed → same base');
  assert.equal(a.family, b.family, 'same seed → same family');
  assert.equal(a.kind, b.kind);
});

test('a bow fires an arrow that kills a monster down the line', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  equipWeapon(state, 'bow');
  standClearOf(state, [[150, 0]]);
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
  standClearOf(state, [[120, 0], [110, 18], [110, -18]]);
  placeMonster(state, 120, 0);
  placeMonster(state, 110, 18);
  placeMonster(state, 110, -18);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = run(state, input, 700);
  assert.equal(state.kills, 3, `fireballs cleared the pack (kills=${state.kills})`);
});

test('a staff hurls an exploding blast like a wand', () => {
  let state = Game.newRun(42);
  state.monsters.length = 0;
  equipWeapon(state, 'staff');
  placeMonster(state, 120, 0);
  placeMonster(state, 110, 18);
  placeMonster(state, 110, -18);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.equal(state.projectiles[0].kind, 'fireball', 'staff fires a fireball (AoE)');
  state = run(state, input, 700);
  assert.equal(state.kills, 3, `staff blasts cleared the pack (kills=${state.kills})`);
});

test('a thrown weapon flies as a non-splash projectile and kills', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  standClearOf(state, [[150, 0]]);
  equipWeapon(state, 'thrown');
  const m = placeMonster(state, 150, 0);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.ok(state.projectiles.length >= 1, 'thrown weapon spawned');
  assert.equal(state.projectiles[0].kind, 'thrown', 'thrown projectile kind');
  assert.ok(!state.projectiles[0].aoe, 'thrown has no splash');
  state = run(state, input, 500);
  assert.ok(state.kills >= 1, `thrown weapons killed the zombie (kills=${state.kills})`);
  assert.ok(!state.monsters.includes(m));
});

test('a crossbow looses a bolt down the line', () => {
  let state = Game.newRun(41);
  state.monsters.length = 0;
  standClearOf(state, [[150, 0]]);
  equipWeapon(state, 'crossbow');
  const m = placeMonster(state, 150, 0);
  state.player.facing = 0;
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.equal(state.projectiles[0].kind, 'arrow', 'crossbow fires an arrow-type bolt');
  state = run(state, input, 500);
  assert.ok(state.kills >= 1, `crossbow killed the zombie (kills=${state.kills})`);
  assert.ok(!state.monsters.includes(m));
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
