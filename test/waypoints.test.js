const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Save = require('../js/save.js');
globalThis.Save = Save;
const Game = require('../js/game.js');

const TS = Dungeon.TILE_SIZE;

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); input.pressed.clear(); }
  return state;
}
function descend(state, input) {
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  return run(state, input, 3);
}
function enterTown(state, input) {
  state.portalCdT = 0;
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  const portal = state.portals.find((po) => po.kind === 'town');
  state.player.x = portal.x;
  state.player.y = portal.y;
  return run(state, input, 60);
}

test('reaching every 5th floor by stairs records a milestone', () => {
  let state = Game.newRun(71);
  state.monsters.length = 0;
  const input = freshInput();
  assert.deepEqual(state.milestones, []);
  for (let i = 0; i < 4; i++) {
    state = descend(state, input);
    state.monsters.length = 0; // keep the trip safe
  }
  assert.equal(state.floor, 5);
  assert.deepEqual(state.milestones, [5], 'floor 5 milestone recorded');
  for (let i = 0; i < 5; i++) {
    state = descend(state, input);
    state.monsters.length = 0;
  }
  assert.equal(state.floor, 10);
  assert.deepEqual(state.milestones, [5, 10]);
});

test('town offers one labeled waypoint per milestone; stepping in jumps to a fresh floor', () => {
  let state = Game.newRun(72);
  state.monsters.length = 0;
  state.floor = 7;
  state.milestones = [5];
  const input = freshInput();
  state = enterTown(state, input);
  assert.equal(state.inTown, true);
  const wps = state.portals.filter((po) => po.kind === 'waypoint');
  assert.equal(wps.length, 1, 'one waypoint for one milestone');
  assert.equal(wps[0].floor, 5);
  assert.ok(state.portals.some((po) => po.kind === 'return'), 'return portal still there');

  state.player.x = wps[0].x;
  state.player.y = wps[0].y;
  state = run(state, input, 60);
  assert.equal(state.inTown, false, 'left town through the waypoint');
  assert.equal(state.floor, 5, 'arrived on floor 5');
  assert.equal(state.stash, null, 'stashed floor abandoned');
  assert.equal(state.dungeon.floor, 5, 'floor 5 dungeon generated');
  assert.ok(state.monsters.length > 0, 'floor repopulated');
  assert.deepEqual(state.milestones, [5], 'waypoint travel grants no milestones');
});

test('no milestones, no waypoints', () => {
  let state = Game.newRun(73);
  state.monsters.length = 0;
  state = enterTown(state, freshInput());
  assert.equal(state.portals.filter((po) => po.kind === 'waypoint').length, 0);
});

test('milestones persist through the save round trip', () => {
  const map = new Map();
  Save._storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  let state = Game.newRun(74);
  state.milestones = [5, 10];
  state.floor = 11;
  Save.write(state);
  const restored = Game.fromSave(Save.load());
  assert.deepEqual(restored.milestones, [5, 10]);
});

test('character identity: name and shirt flow through creation, saves, and headless restarts', () => {
  const map = new Map();
  Save._storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  let state = Game.newRun(75, { name: 'Borys', shirt: '#7a3b3b' });
  assert.equal(state.player.name, 'Borys');
  assert.equal(state.player.shirt, '#7a3b3b');
  Save.write(state);
  const restored = Game.fromSave(Save.load());
  assert.equal(restored.player.name, 'Borys');
  assert.equal(restored.player.shirt, '#7a3b3b');

  // Headless death-restart keeps the identity (the browser shows creation instead).
  state.player.hp = 0;
  const input = freshInput();
  state = run(state, input, 2);
  assert.equal(state.dead, true);
  input.pressed.add('restart');
  state = Game.update(state, input, 1 / 60);
  assert.equal(state.player.name, 'Borys', 'restart keeps the name');
  assert.equal(state.player.shirt, '#7a3b3b');

  // Defaults still apply.
  const plain = Game.newRun(76);
  assert.equal(plain.player.name, 'Wanderer');
  assert.ok(plain.player.shirt.startsWith('#'));
});
