// Being in the overworld: the level object that makes a continent look like a
// dungeon floor to everything downstream, and the chunk activation set that
// decides which slice of it actually ticks.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Props = require('../js/props.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.World = require('../js/world.js');
const Game = require('../js/game.js');
const Balance = require('../js/balance.js');
const World = globalThis.World;
const D = globalThis.Dungeon;
const G = Game._;
const TS = D.TILE_SIZE;

function worldRun(seed) {
  const state = Game.newRun(seed === undefined ? 4242 : seed);
  Game.enterWorld(state);
  return state;
}

const EMPTY = () => ({
  keys: { w: false, a: false, s: false, d: false, space: false },
  pressed: new Set(),
  mouse: { x: -1, y: -1, click: false, rclick: false },
});

// Advance the sim without any input.
function pump(state, frames, input) {
  let s = state;
  for (let i = 0; i < frames; i++) s = Game.update(s, input || EMPTY(), 1 / 30);
  return s;
}

test('the overworld level is duck-compatible with a dungeon floor', () => {
  const s = worldRun();
  const d = s.dungeon;
  for (const key of ['grid', 'width', 'height', 'rooms', 'entry', 'spawns', 'torches', 'props', 'theme', 'floor']) {
    assert.ok(d[key] !== undefined, `overworld level is missing ${key}`);
  }
  assert.equal(d.width, World.SIZE);
  assert.equal(d.height, World.SIZE);
  assert.equal(d.overworld, true);
  assert.equal(d.stairs, null);
  assert.equal(d.boss, null);
  assert.equal(s.inWorld, true);
  assert.equal(s.inTown, false);
  // The theme still has everything the renderer reads off a dungeon theme.
  for (const key of ['name', 'wall', 'wallEdge', 'floorA', 'floorB', 'torch', 'fog']) {
    assert.ok(d.theme[key], `overworld theme is missing ${key}`);
  }
});

test('the hero starts on standable ground at Ashfall Camp', () => {
  const s = worldRun();
  const tx = Math.floor(s.player.x / TS);
  const ty = Math.floor(s.player.y / TS);
  assert.ok(D.isWalkable(s.dungeon.grid[ty][tx]), 'spawned inside terrain');
  const c = World.chunkOf(tx, ty);
  assert.equal(World.ringOf(c.cx, c.cy), 0, 'and in the town chunk');
});

test('sight is a per-level radius: daylight outdoors, torchlight underground', () => {
  const Render = require('../js/render.js');
  const R = Render._;
  const world = worldRun();
  assert.equal(R.sightTiles(world), Balance.world.sightTiles);
  assert.ok(Balance.world.sightTiles > 9, 'the overworld must see further than a dungeon');
  const floor = Game.newRun(7);
  assert.equal(R.sightTiles(floor), 9, 'dungeon floors keep the original radius');
});

test('walking the world activates chunks near the hero and drops the ones left behind', () => {
  let s = worldRun();
  s = pump(s, 3);
  const w = s.world;
  const r = Balance.world.activeRadius;
  const expected = (2 * r + 1) * (2 * r + 1);
  assert.equal(w.active.size, expected, `activation radius ${r} should light ${expected} chunks`);

  const before = new Set(w.active);
  // Teleport several chunks east and let activation catch up.
  const startChunk = World.chunkOf(Math.floor(s.player.x / TS), Math.floor(s.player.y / TS));
  const target = World.chunkCenter(startChunk.cx + 6, startChunk.cy);
  const spot = G.findOpenTile(w.world, target.x, target.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);

  assert.equal(w.active.size, expected, 'the live set stays the same size');
  let shared = 0;
  for (const k of w.active) if (before.has(k)) shared++;
  assert.equal(shared, 0, 'none of the old chunks are still live six chunks away');
});

test('the active set is capped, so a scattered party cannot grow it without bound', () => {
  const s = worldRun();
  const cap = Balance.world.activeChunkCap;
  // Stand a crowd of heroes far apart from one another.
  const extras = [];
  for (let i = 0; i < 8; i++) {
    const c = World.chunkCenter(3 + i * 3, 3 + i * 3);
    extras.push({ ...s.player, id: 'x' + i, x: (c.x + 0.5) * TS, y: (c.y + 0.5) * TS, dead: false });
  }
  s.players = [s.player, ...extras];
  const want = G.desiredChunks(s);
  assert.ok(want.size <= cap, `desired set ${want.size} exceeded the cap ${cap}`);
});

test('terrain is written ahead of the hero, so the edge of sight is never ungenerated', () => {
  let s = worldRun();
  s = pump(s, 3);
  const w = s.world.world;
  const pc = World.chunkOf(Math.floor(s.player.x / TS), Math.floor(s.player.y / TS));
  const r = Balance.world.activeRadius + 1;
  for (let cy = pc.cy - r; cy <= pc.cy + r; cy++) {
    for (let cx = pc.cx - r; cx <= pc.cx + r; cx++) {
      if (!World.inBounds(cx, cy)) continue;
      assert.ok(World.isGenerated(w, cx, cy), `chunk ${cx},${cy} was never written`);
    }
  }
});

test('the world records where it has been at chunk granularity', () => {
  let s = worldRun();
  s = pump(s, 3);
  const pc = World.chunkOf(Math.floor(s.player.x / TS), Math.floor(s.player.y / TS));
  assert.ok(s.world.visited[World.chunkKey(pc.cx, pc.cy)], 'the hero’s own chunk is unvisited');
});

test('the palette follows the ground underfoot', () => {
  let s = worldRun();
  s = pump(s, 2);
  const tx = Math.floor(s.player.x / TS);
  const ty = Math.floor(s.player.y / TS);
  assert.equal(s.dungeon.theme, World.biomeAt(s.world.world.seed, tx, ty));
  assert.equal(s.dungeon.biomeAt(tx, ty), s.dungeon.theme, 'the renderer asks the level and gets the same answer');
});

// ---- The map surfaces ----

test('the minimap windows around the hero out in the world, and shows a floor whole', () => {
  const UI = require('../js/ui.js');
  const I = UI._;
  const floor = Game.newRun(7);
  const fr = I.minimapRect(floor);
  assert.equal(fr.x0, 0);
  assert.equal(fr.y0, 0);
  assert.equal(fr.span, Math.max(floor.dungeon.width, floor.dungeon.height), 'a dungeon floor still fits whole');

  const s = worldRun();
  const r = I.minimapRect(s);
  assert.equal(r.span, I.MINIMAP_SPAN);
  assert.ok(r.span < s.dungeon.width, 'the overworld minimap must be a window, not the whole grid');
  // The window is centred on the hero and clamped inside the map.
  const ptx = s.player.x / TS;
  assert.ok(Math.abs(r.x0 + r.span / 2 - ptx) < 1, 'window is not centred on the hero');
  assert.ok(r.x0 >= 0 && r.x0 + r.span <= s.dungeon.width);
  assert.ok(r.y0 >= 0 && r.y0 + r.span <= s.dungeon.height);
});

test('the minimap window clamps at the edges of the world rather than running off it', () => {
  const UI = require('../js/ui.js');
  const I = UI._;
  const s = worldRun();
  s.player.x = 4 * TS;
  s.player.y = 4 * TS;
  let r = I.minimapRect(s);
  assert.equal(r.x0, 0);
  assert.equal(r.y0, 0);
  s.player.x = (World.SIZE - 4) * TS;
  s.player.y = (World.SIZE - 4) * TS;
  r = I.minimapRect(s);
  assert.equal(r.x0, World.SIZE - r.span);
  assert.equal(r.y0, World.SIZE - r.span);
});

test('the world map panel maps world tiles into its rect, and pins the town', () => {
  const UI = require('../js/ui.js');
  const I = UI._;
  const s = worldRun();
  const view = { w: 1280, h: 720 };
  const L = I.worldMapLayout(view);
  assert.ok(L.map.w > 0 && L.map.h > 0);
  // Corners of the world land on corners of the map rect.
  const nw = I.worldMapPoint(L, 0, 0, World.SIZE);
  assert.ok(Math.abs(nw.x - L.map.x) < 0.001 && Math.abs(nw.y - L.map.y) < 0.001);
  const se = I.worldMapPoint(L, World.SIZE, World.SIZE, World.SIZE);
  assert.ok(Math.abs(se.x - (L.map.x + L.map.w)) < 0.001);
  assert.ok(Math.abs(se.y - (L.map.y + L.map.h)) < 0.001);

  const pins = I.worldMapPins(s);
  const town = pins.find((p) => p.kind === 'town');
  assert.ok(town, 'the town is always on the map');
  const c = World.chunkCenter(World.TOWN_CX, World.TOWN_CY);
  assert.equal(town.x, c.x);
  assert.equal(town.y, c.y);
});

test('M opens the world map only out in the world, and pauses the sim while it is up', () => {
  const press = (k) => {
    const i = EMPTY();
    i.pressed.add(k);
    return i;
  };
  // Underground the key does nothing — the minimap already shows the whole floor.
  let floor = Game.newRun(7);
  floor = Game.update(floor, press('map'), 1 / 30);
  assert.equal(!!floor.mapOpen, false);

  let s = worldRun();
  s = Game.update(s, press('map'), 1 / 30);
  assert.equal(s.mapOpen, true);
  // Paused: a monster placed by hand must not get a chance to move.
  s.monsters.push({
    ...Entities.makeMonster('zombie', 3, false, 1),
    id: 999,
    x: s.player.x + 60,
    y: s.player.y,
    attackT: 0, hitT: 0, lungeT: 0, wanderT: 0, wandA: 0, aggroed: true, kbx: 0, kby: 0,
  });
  const before = { x: s.monsters[0].x, y: s.monsters[0].y };
  s = pump(s, 10);
  assert.equal(s.monsters[0].x, before.x, 'the world ticked while the map was open');
  assert.equal(s.monsters[0].y, before.y);
  s = Game.update(s, press('map'), 1 / 30);
  assert.equal(s.mapOpen, false);
});
