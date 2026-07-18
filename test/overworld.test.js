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
const Save = require('../js/save.js');
globalThis.Save = Save;
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

// ---- Phase 3: free-roaming monsters ----

test('ring maps to an effective floor, monotonically, with a hard safe ring at home', () => {
  const B = Balance.world;
  assert.equal(World.effectiveFloor(0), 0, 'the town chunk is safe');
  for (let r = 1; r <= B.safeRing; r++) assert.equal(World.effectiveFloor(r), 0, `ring ${r} must be safe`);
  let prev = 0;
  for (let r = B.safeRing + 1; r <= 16; r++) {
    const f = World.effectiveFloor(r);
    assert.ok(f >= 1, `ring ${r} produced floor ${f}`);
    assert.ok(f >= prev, `floor went backwards at ring ${r}: ${prev} -> ${f}`);
    prev = f;
  }
  assert.ok(prev > 10, 'the far corner should be genuinely deep');
});

test('the safe ring spawns nothing at all', () => {
  const seed = 4242;
  for (let cy = 0; cy < World.CHUNKS; cy++) {
    for (let cx = 0; cx < World.CHUNKS; cx++) {
      if (World.ringOf(cx, cy) > Balance.world.safeRing) continue;
      const b = World.budgetOf(seed, cx, cy);
      assert.equal(b.count, 0, `chunk ${cx},${cy} in the safe ring rolled ${b.count} monsters`);
      assert.equal(b.boss, false);
    }
  }
});

test('danger reads as a gradient outward: density and champions rise with ring, capped', () => {
  const seed = 4242;
  const B = Balance.world;
  const avg = (ring) => {
    let tot = 0;
    let n = 0;
    let champ = 0;
    for (let cy = 0; cy < World.CHUNKS; cy++) {
      for (let cx = 0; cx < World.CHUNKS; cx++) {
        if (World.ringOf(cx, cy) !== ring) continue;
        const b = World.budgetOf(seed, cx, cy);
        tot += b.count;
        champ += b.championChance;
        n++;
      }
    }
    return { count: tot / n, champ: champ / n };
  };
  const near = avg(2);
  const mid = avg(8);
  const far = avg(15);
  assert.ok(mid.count > near.count, `density did not rise: ${near.count} -> ${mid.count}`);
  assert.ok(far.count >= mid.count, `density fell off at the rim: ${mid.count} -> ${far.count}`);
  assert.ok(far.count <= B.densityCap, 'the density cap is not holding');
  assert.ok(mid.champ > near.champ && far.champ > mid.champ, 'champion chance must climb with ring');
  assert.ok(far.champ <= B.championCap + 1e-9, 'the champion cap is not holding');
});

test('world bosses appear only from bossMinRing outward', () => {
  const seed = 4242;
  let inner = 0;
  let outer = 0;
  for (let cy = 0; cy < World.CHUNKS; cy++) {
    for (let cx = 0; cx < World.CHUNKS; cx++) {
      const b = World.budgetOf(seed, cx, cy);
      if (!b.boss) continue;
      if (World.ringOf(cx, cy) < Balance.world.bossMinRing) inner++;
      else outer++;
    }
  }
  assert.equal(inner, 0, 'a world boss spawned inside the safe half of the map');
  assert.ok(outer > 0, 'no world boss anywhere in the outer rings');
});

test('a chunk rolls the same content every time it is generated', () => {
  const w = World.create(4242);
  World.ensureAround(w, 20, 20, 1);
  const a = World.rollChunkContent(w, 20, 20);
  const b = World.rollChunkContent(w, 20, 20);
  assert.deepEqual(a, b, 'chunk content is not deterministic');
  assert.ok(a.monsters.length > 0, 'ring 4 should hold monsters');
  // Every spawn tile must be standable, or monsters arrive stuck inside terrain.
  for (const m of a.monsters) assert.ok(D.isWalkable(w.grid[m.y][m.x]), `spawn at ${m.x},${m.y} is not walkable`);
  for (const p of a.props) assert.equal(w.grid[p.y][p.x], D.TILE.FLOOR, 'props must sit on open ground, clear of roads');
});

test('activated monsters are chunk-tagged and know where they live', () => {
  let s = worldRun();
  const c = World.chunkCenter(22, 22);
  const spot = G.findOpenTile(s.world.world, c.x, c.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  assert.ok(s.monsters.length > 0, 'the outer world is empty');
  for (const m of s.monsters) {
    assert.ok(m.chunk !== undefined, 'a world monster has no chunk tag');
    assert.ok(m.home && Number.isFinite(m.home.x), 'a world monster has no home');
    assert.ok(s.world.active.has(m.chunk), 'a monster is live in a chunk that is not');
  }
  // Walking away drops them all.
  const townSpot = G.findOpenTile(s.world.world, s.dungeon.entry.x, s.dungeon.entry.y);
  s.player.x = (townSpot.x + 0.5) * TS;
  s.player.y = (townSpot.y + 0.5) * TS;
  s = pump(s, 3);
  for (const m of s.monsters) assert.ok(s.world.active.has(m.chunk), 'a deactivated chunk left monsters behind');
});

test('an idle world monster drifts between waypoints instead of jittering on the spot', () => {
  let s = worldRun();
  const c = World.chunkCenter(22, 22);
  const spot = G.findOpenTile(s.world.world, c.x, c.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  // Take a monster well out of aggro range and let it wander.
  const m = s.monsters.find((o) => Math.hypot(o.x - s.player.x, o.y - s.player.y) > 600 && !o.worldBoss);
  assert.ok(m, 'expected a monster far from the hero');
  const start = { x: m.x, y: m.y };
  s = pump(s, 120);
  assert.equal(m.aggroed, false, 'it should never have noticed the hero');
  const moved = Math.hypot(m.x - start.x, m.y - start.y);
  assert.ok(moved > 12, `an idle resident barely moved (${moved.toFixed(1)}px)`);
  // And it stays inside its leash.
  assert.ok(Math.hypot(m.x - m.home.x, m.y - m.home.y) <= Balance.world.leashTiles * TS * 1.2, 'it wandered past its leash');
});

test('a monster dragged past its leash gives up the chase and walks home', () => {
  let s = worldRun();
  const c = World.chunkCenter(22, 22);
  const spot = G.findOpenTile(s.world.world, c.x, c.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  const m = s.monsters.find((o) => !o.worldBoss);
  assert.ok(m, 'no resident to test');
  m.aggroed = true;
  // Haul it far beyond its leash, as a long chase across open country would —
  // onto real standable ground, since a monster can never legitimately end up
  // inside a cliff and nothing can move once it is.
  const leashPx = Balance.world.leashTiles * TS;
  const far = G.findOpenTile(
    s.world.world,
    Math.floor(m.home.x / TS) + Balance.world.leashTiles * 2,
    Math.floor(m.home.y / TS)
  );
  m.x = (far.x + 0.5) * TS;
  m.y = (far.y + 0.5) * TS;
  s.player.x = m.x + 40;
  s.player.y = m.y;
  G.monsterUpdate(s, m, 1 / 30);
  assert.equal(m.aggroed, false, 'it should have broken off past the leash');
  assert.equal(m.returning, true, 'and be heading home');

  // While returning it ignores the hero standing right next to it — otherwise it
  // would re-aggro on the very next frame and never actually leave.
  for (let i = 0; i < 20; i++) {
    s.player.x = m.x + 40;
    s.player.y = m.y;
    G.monsterUpdate(s, m, 1 / 30);
  }
  assert.equal(m.aggroed, false, 'it re-aggroed while walking home');
  const away = Math.hypot(m.x - m.home.x, m.y - m.home.y);
  assert.ok(away < leashPx * 2, `it made no progress home (${away.toFixed(0)}px out)`);
});

test('a dungeon monster keeps the original wander — no home, no leash', () => {
  const s = Game.newRun(11);
  const m = s.monsters[0];
  assert.equal(m.home, undefined, 'a floor spawn must not gain a home');
  assert.equal(m.chunk, undefined);
  const start = { x: m.x, y: m.y };
  for (let i = 0; i < 60; i++) G.monsterUpdate(s, m, 1 / 30);
  assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
  void start;
});

test('clearing a chunk keeps it clear until its respawn timer is up', () => {
  let s = worldRun();
  const c = World.chunkCenter(22, 22);
  const spot = G.findOpenTile(s.world.world, c.x, c.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  const victim = s.monsters.find((m) => !m.worldBoss);
  const chunk = victim.chunk;
  const doomed = s.monsters.filter((m) => m.chunk === chunk);
  for (const m of doomed) {
    s.monsters.splice(s.monsters.indexOf(m), 1);
    G.worldMonsterKilled(s, m);
  }
  assert.equal(s.world.cleared[chunk], true, 'the chunk was not marked cleared');
  assert.ok(s.world.respawn[chunk] > s.time, 'no respawn was scheduled');

  // Leaving and coming straight back must not restock it.
  const away = World.chunkCenter(10, 10);
  const awaySpot = G.findOpenTile(s.world.world, away.x, away.y);
  s.player.x = (awaySpot.x + 0.5) * TS;
  s.player.y = (awaySpot.y + 0.5) * TS;
  s = pump(s, 3);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  assert.equal(s.monsters.filter((m) => m.chunk === chunk).length, 0, 'a cleared chunk restocked immediately');

  // Once the timer passes, it comes back.
  s.time = s.world.respawn[chunk] + 1;
  s = pump(s, 3);
  assert.equal(s.world.cleared[chunk], false, 'the chunk never came off the cleared list');
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  assert.ok(s.monsters.filter((m) => m.chunk === chunk).length > 0, 'the chunk never repopulated');
});

test('props and roadside braziers stream in and out with their chunk', () => {
  let s = worldRun();
  const c = World.chunkCenter(24, 20);
  const spot = G.findOpenTile(s.world.world, c.x, c.y);
  s.player.x = (spot.x + 0.5) * TS;
  s.player.y = (spot.y + 0.5) * TS;
  s = pump(s, 3);
  assert.ok(s.props.length > 0, 'the world has no scenery at all');
  for (const pr of s.props) assert.ok(s.world.active.has(pr.chunk), 'a prop outlived its chunk');
  for (const t of s.dungeon.torches) assert.ok(s.world.active.has(t.chunk), 'a brazier outlived its chunk');
  const before = s.props.length;
  const away = World.chunkCenter(8, 8);
  const awaySpot = G.findOpenTile(s.world.world, away.x, away.y);
  s.player.x = (awaySpot.x + 0.5) * TS;
  s.player.y = (awaySpot.y + 0.5) * TS;
  s = pump(s, 3);
  for (const pr of s.props) assert.ok(s.world.active.has(pr.chunk), 'a prop survived deactivation');
  void before;
});

// ---- Phase 4: places — town, mouths, waystones ----

test('Ashfall Camp is stamped into the middle chunk with all four fixtures', () => {
  const w = World.create(4242);
  const camp = World.town(w);
  for (const key of ['entry', 'well', 'vendor', 'smith', 'board']) {
    assert.ok(camp[key], `camp is missing ${key}`);
    assert.ok(D.isWalkable(w.grid[camp[key].y][camp[key].x]) || w.grid[camp[key].y][camp[key].x] === D.TILE.ENTRY,
      `${key} stands on impassable ground`);
  }
  // It is where the town chunk is, not at the origin.
  const c = World.chunkOf(camp.well.x, camp.well.y);
  assert.equal(c.cx, World.TOWN_CX);
  assert.equal(c.cy, World.TOWN_CY);
  // The stamped plaza matches the standalone town's layout exactly — same
  // generator, so the vendor/smith/board UI carries over untouched.
  const solo = D.generateTown(4242);
  assert.equal(camp.vendor.x - camp.well.x, solo.vendor.x - solo.well.x);
  assert.equal(camp.board.y - camp.well.y, solo.board.y - solo.well.y);
});

test('the camp services fire from proximity out in the world, exactly as in town', () => {
  let s = worldRun();
  const camp = World.town(s.world.world);
  s.player.x = (camp.vendor.x + 0.5) * TS;
  s.player.y = (camp.vendor.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.trading, true, 'standing at the stall does not open trade');
  assert.ok(s.shop && s.shop.length === 3, 'Grizzle has no stock out here');

  s.player.x = (camp.smith.x + 0.5) * TS;
  s.player.y = (camp.smith.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.smithing, true, 'the anvil is cold');

  s.player.x = (camp.board.x + 0.5) * TS;
  s.player.y = (camp.board.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.questing, true, 'the notice board is unreadable');
  assert.ok(s.board, 'no notices are posted');

  // And the well still mends you.
  s.player.x = (camp.well.x + 0.5) * TS;
  s.player.y = (camp.well.y + 0.5) * TS;
  s.player.hp = 5;
  s = pump(s, 2);
  assert.ok(s.player.hp > 5, 'the well did not heal');
});

test('mouths carry their own dungeon seed and a ring-scaled starting floor', () => {
  const w = World.create(4242);
  for (let cy = 0; cy < World.CHUNKS; cy++) {
    for (let cx = 0; cx < World.CHUNKS; cx++) World.ensureChunk(w, cx, cy);
  }
  const pois = Object.values(w.pois);
  const mouths = pois.filter((p) => p.kind === 'mouth');
  const stones = pois.filter((p) => p.kind === 'waystone');
  assert.ok(mouths.length > 20, `only ${mouths.length} mouths in the whole world`);
  assert.ok(stones.length > 5, `only ${stones.length} waystones in the whole world`);

  const seeds = new Set(mouths.map((m) => m.dungeonSeed));
  assert.ok(seeds.size > mouths.length * 0.9, 'mouths are sharing dungeon seeds');
  for (const m of mouths) {
    assert.equal(w.grid[m.y][m.x], D.TILE.STAIRS_DOWN, 'a mouth did not write its tile');
    assert.ok(m.floor >= 1, 'a mouth has no starting floor');
    // A mouth is never deeper than its ring warrants. The safe ring is the one
    // exception: it spawns no monsters, but a hole there is a starter dungeon.
    assert.ok(m.floor <= Math.max(1, World.effectiveFloor(m.ring)), 'a mouth is deeper than its ring');
  }
  // Deeper mouths lie further out.
  const near = mouths.filter((m) => m.ring <= 4);
  const far = mouths.filter((m) => m.ring >= 12);
  const avg = (a) => a.reduce((t, m) => t + m.floor, 0) / a.length;
  assert.ok(avg(far) > avg(near), 'mouth depth does not scale with distance from home');
});

test('a mouth roll never lands on the same tile as anything else in its chunk', () => {
  const w = World.create(4242);
  World.ensureAround(w, 20, 20, 2);
  for (let cy = 18; cy <= 22; cy++) {
    for (let cx = 18; cx <= 22; cx++) {
      const poi = w.pois[World.chunkKey(cx, cy)];
      if (!poi) continue;
      const content = World.rollChunkContent(w, cx, cy);
      for (const m of content.monsters) assert.ok(!(m.x === poi.x && m.y === poi.y), 'a monster spawned on a POI tile');
      for (const p of content.props) assert.ok(!(p.x === poi.x && p.y === poi.y), 'a prop spawned on a POI tile');
    }
  }
});

test('stepping into a mouth dives, and the portal home restores the world intact', () => {
  let s = worldRun();
  // Find a mouth and stand on it.
  const world = s.world.world;
  World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, 4);
  const entry = Object.entries(world.pois).find(([, p]) => p.kind === 'mouth');
  assert.ok(entry, 'no mouth near the camp to dive into');
  const mouth = entry[1];
  s.player.x = (mouth.x + 0.5) * TS;
  s.player.y = (mouth.y + 0.5) * TS;
  // Remember what the world looked like so the round trip can be checked.
  const worldRef = s.world;
  const exploredRef = s.explored;

  s = pump(s, 2);
  assert.equal(s.inWorld, false, 'the hero never went down');
  assert.equal(s.floor, mouth.floor, 'arrived on the wrong floor');
  assert.equal(s.dungeonSeed, mouth.dungeonSeed, 'the mouth’s dungeon seed was not used');
  assert.ok(s.stash && s.stash.overworld, 'the overworld was not stashed');
  assert.equal(s.dungeon.overworld, undefined, 'still standing on the overworld level');
  assert.ok(s.dungeon.width === 120, 'a real dungeon floor should have been generated');

  // Descend a few floors — the stash must survive the churn beneath it.
  for (let i = 0; i < 3; i++) G.descend(s);
  assert.ok(s.stash && s.stash.overworld, 'the stash was lost descending');

  // Portal out.
  G.travel(s, { kind: 'town' });
  assert.equal(s.inWorld, true, 'the portal did not return us to the surface');
  assert.equal(s.world, worldRef, 'the world object was replaced');
  assert.equal(s.explored, exploredRef, 'the explored map was lost');
  assert.equal(s.stash, null);
  // And we are standing back at the mouth we went down.
  assert.ok(Math.hypot(s.player.x - (mouth.x + 0.5) * TS, s.player.y - (mouth.y + 0.5) * TS) < 3 * TS,
    'did not surface at the mouth');
});

test('two different mouths lead to two different dungeons', () => {
  const w = World.create(4242);
  for (let cy = 10; cy < 24; cy++) {
    for (let cx = 10; cx < 24; cx++) World.ensureChunk(w, cx, cy);
  }
  const mouths = Object.values(w.pois).filter((p) => p.kind === 'mouth');
  const a = D.generateDungeon(mouths[0].dungeonSeed, 3);
  const b = D.generateDungeon(mouths[1].dungeonSeed, 3);
  assert.notDeepEqual(a.entry, b.entry, 'two mouths generated the same floor');
  // And the same mouth always leads to the same place.
  assert.deepEqual(D.generateDungeon(mouths[0].dungeonSeed, 3).entry, a.entry);
});

test('a waystone unlocks on touch, not on sight, and then warps', () => {
  let s = worldRun();
  const world = s.world.world;
  World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, 6);
  const found = Object.entries(world.pois).filter(([, p]) => p.kind === 'waystone');
  assert.ok(found.length >= 2, 'need two waystones near home for this test');
  const [keyA, stoneA] = found[0];
  const [, stoneB] = found[1];

  // Seen from a distance: found, but still asleep.
  s.player.x = (stoneA.x + 0.5) * TS + 10 * TS;
  s.player.y = (stoneA.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.world.pois[keyA].found, true, 'the waystone was not spotted');
  assert.equal(s.world.pois[keyA].unlocked, false, 'it woke without being touched');
  assert.equal(G.unlockedWaystones(s).length, 0);

  // Walk onto it.
  s.player.x = (stoneA.x + 0.5) * TS;
  s.player.y = (stoneA.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.world.pois[keyA].unlocked, true, 'touching it did not wake it');
  assert.equal(G.unlockedWaystones(s).length, 1);

  // Warping to a stone that is merely discovered is refused.
  s.player.x = (stoneB.x + 0.5) * TS;
  s.player.y = (stoneB.y + 0.5) * TS;
  s = pump(s, 2);
  const recB = G.unlockedWaystones(s).find((p) => p.x === stoneB.x && p.y === stoneB.y);
  assert.ok(recB, 'the second stone should now be unlocked too');

  // Warp back to the first, keeping the map and the discoveries.
  const exploredRef = s.explored;
  const ok = Game.useWaystone(s, s.world.pois[keyA]);
  assert.equal(ok, true, 'the warp was refused');
  assert.ok(Math.hypot(s.player.x - (stoneA.x + 0.5) * TS, s.player.y - (stoneA.y + 0.5) * TS) < 4 * TS,
    'the warp did not land at the stone');
  assert.equal(s.explored, exploredRef, 'the warp wiped the map');
  assert.equal(s.world.pois[keyA].unlocked, true, 'the warp forgot the discoveries');
  assert.equal(s.inWorld, true);
});

test('a locked waystone cannot be warped to', () => {
  const s = worldRun();
  assert.equal(Game.useWaystone(s, { kind: 'waystone', x: 100, y: 100, unlocked: false }), false);
  assert.equal(Game.useWaystone(s, null), false);
});

test('the map pins what has been found, and only what has been found', () => {
  const UI = require('../js/ui.js');
  const I = UI._;
  let s = worldRun();
  // Nothing discovered yet beyond the camp itself.
  let pins = I.worldMapPins(s);
  assert.equal(pins.filter((p) => p.kind === 'mouth').length, 0);
  assert.equal(pins.filter((p) => p.kind === 'town').length, 1);

  const world = s.world.world;
  World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, 4);
  const mouth = Object.values(world.pois).find((p) => p.kind === 'mouth');
  s.player.x = (mouth.x + 0.5) * TS;
  s.player.y = (mouth.y + 0.5) * TS - 6 * TS;
  s = pump(s, 2);
  pins = I.worldMapPins(s);
  const pin = pins.find((p) => p.kind === 'mouth');
  assert.ok(pin, 'a mouth we are standing next to is not on the map');
  assert.equal(pin.x, mouth.x);
  assert.equal(pin.y, mouth.y);
});

test('the town portal fizzles under open sky — the camp is a place you walk to', () => {
  const s = worldRun();
  G.castPortal(s, s.player);
  assert.equal(s.portals.length, 0, 'a portal opened in the overworld');
});

test('a new solo run begins outside Ashfall Camp, not on a dungeon floor', () => {
  const s = Game.newSoloRun(1234);
  assert.equal(s.inWorld, true, 'a new run must start on the continent');
  assert.equal(s.dungeon.overworld, true);
  const tx = Math.floor(s.player.x / TS);
  const ty = Math.floor(s.player.y / TS);
  assert.ok(D.isWalkable(s.dungeon.grid[ty][tx]), 'the hero starts inside terrain');
  const camp = World.town(s.world.world);
  const fromCamp = Math.hypot(tx - camp.entry.x, ty - camp.entry.y);
  assert.ok(fromCamp < 12, `started ${fromCamp.toFixed(0)} tiles from camp — that is not "outside Ashfall"`);
  assert.ok(fromCamp > 0, 'started on top of the camp entry');
});

// ---- Phase 5: persistence ----

function memStorage() {
  const box = {};
  return {
    getItem: (k) => (k in box ? box[k] : null),
    setItem: (k, v) => {
      box[k] = String(v);
    },
    removeItem: (k) => {
      delete box[k];
    },
  };
}

test('the explored map packs to a 1024-bit chunk set and back', () => {
  const set = { 0: true, 1: true, 63: true, 512: true, 1023: true, 77: false };
  const packed = Save.packChunks(set);
  // 1024 bits = 128 bytes, which base64 encodes in 172 characters. Per-tile fog
  // at 2048^2 would be ~700 KB — the whole reason this is chunk-granular.
  assert.ok(packed.length < 200, `packed to ${packed.length} chars`);
  const back = Save.unpackChunks(packed);
  for (const k of [0, 1, 63, 512, 1023]) assert.equal(back[k], true, `chunk ${k} was lost`);
  assert.equal(back[77], undefined, 'a false chunk came back set');
  assert.equal(back[500], undefined);
  assert.equal(Object.keys(back).length, 5);
});

test('unpackChunks survives a corrupt blob rather than failing the load', () => {
  assert.deepEqual(Save.unpackChunks(''), {});
  assert.deepEqual(Save.unpackChunks(null), {});
  assert.deepEqual(Save.unpackChunks('!!!not base64!!!'), {});
});

test('the world round-trips: seed, position, explored chunks, and every discovery', () => {
  Save._storage = memStorage();
  let s = Game.newSoloRun(31337);
  const world = s.world.world;
  World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, 5);

  // Find something, wake something, and walk around a little.
  const mouthEntry = Object.entries(world.pois).find(([, p]) => p.kind === 'mouth');
  const stoneEntry = Object.entries(world.pois).find(([, p]) => p.kind === 'waystone');
  assert.ok(mouthEntry && stoneEntry, 'need a mouth and a waystone near home');
  s.player.x = (mouthEntry[1].x + 0.5) * TS;
  s.player.y = (mouthEntry[1].y + 0.5) * TS - 5 * TS;
  s = pump(s, 2);
  s.player.x = (stoneEntry[1].x + 0.5) * TS;
  s.player.y = (stoneEntry[1].y + 0.5) * TS;
  s = pump(s, 2);
  s.bag.gold = 412;
  Entities.gainXP(s.player, Entities.xpForLevel(1));

  const visitedBefore = Object.keys(s.world.visited).length;
  assert.ok(visitedBefore > 0);
  const posBefore = { x: s.player.x, y: s.player.y };

  Save.write(s);
  const restored = Game.fromSave(Save.load());

  assert.equal(restored.inWorld, true);
  assert.equal(restored.worldSeed, s.worldSeed, 'world seed lost');
  assert.equal(restored.bag.gold, 412);
  assert.ok(Math.hypot(restored.player.x - posBefore.x, restored.player.y - posBefore.y) < 3 * TS,
    'resumed somewhere other than where the save was written');
  assert.equal(Object.keys(restored.world.visited).length, visitedBefore, 'the explored chunk set was lost');
  assert.equal(restored.world.pois[mouthEntry[0]].found, true, 'a found mouth was forgotten');
  assert.equal(restored.world.pois[stoneEntry[0]].unlocked, true, 'an unlocked waystone was forgotten');
  assert.equal(G.unlockedWaystones(restored).length, G.unlockedWaystones(s).length);

  // And the restored world is the same world, tile for tile.
  const rw = restored.world.world;
  for (const [tx, ty] of [[1030, 1030], [1100, 990], [900, 1200]]) {
    const c = World.chunkOf(tx, ty);
    World.ensureChunk(rw, c.cx, c.cy);
    World.ensureChunk(world, c.cx, c.cy);
    assert.equal(rw.grid[ty][tx], world.grid[ty][tx], `tile ${tx},${ty} regenerated differently`);
  }
});

test('a save written underground surfaces at the mouth it went down', () => {
  Save._storage = memStorage();
  let s = Game.newSoloRun(31337);
  const world = s.world.world;
  World.ensureAround(world, World.TOWN_CX, World.TOWN_CY, 5);
  const mouth = Object.values(world.pois).find((p) => p.kind === 'mouth');
  s.player.x = (mouth.x + 0.5) * TS;
  s.player.y = (mouth.y + 0.5) * TS;
  s = pump(s, 2);
  assert.equal(s.inWorld, false, 'never went down');

  Save.write(s);
  const restored = Game.fromSave(Save.load());
  assert.equal(restored.inWorld, true, 'a reload should surface, not strand you underground');
  const dist = Math.hypot(restored.player.x - (mouth.x + 0.5) * TS, restored.player.y - (mouth.y + 0.5) * TS);
  assert.ok(dist < 4 * TS, `surfaced ${(dist / TS).toFixed(1)} tiles from the mouth`);
});

test('a legacy dungeon save — written before the world existed — walks out of Ashfall', () => {
  Save._storage = memStorage();
  // Exactly the shape Save.snapshot produced before this feature: no worldSeed,
  // no worldPos, no world block at all.
  const legacy = {
    version: 1,
    runSeed: 4242,
    floor: 7,
    kills: 88,
    time: 900,
    milestones: [5],
    quests: [],
    player: {
      name: 'Oldtimer',
      shirt: '#4a5578',
      level: 6,
      xp: 40,
      baseMaxHP: 160,
      baseMaxMana: 70,
      baseDamage: 10,
      hp: 120,
      mana: 30,
      skillPoints: 2,
      skills: {},
      equip: {},
      stats: null,
    },
    bag: { slots: [], belt: [], gold: 999, potions: {} },
  };
  const restored = Game.fromSave(legacy);
  // The hero is the durable thing and survives intact.
  assert.equal(restored.player.name, 'Oldtimer');
  assert.equal(restored.player.level, 6);
  assert.equal(restored.bag.gold, 999);
  assert.equal(restored.kills, 88);
  assert.deepEqual(restored.milestones, [5]);
  // And they resume on the continent, standing at Ashfall.
  assert.equal(restored.inWorld, true, 'a legacy save must migrate into the overworld');
  const camp = World.town(restored.world.world);
  const tx = Math.floor(restored.player.x / TS);
  const ty = Math.floor(restored.player.y / TS);
  assert.ok(Math.hypot(tx - camp.entry.x, ty - camp.entry.y) < 12, 'a legacy save did not land at Ashfall');
  assert.ok(D.isWalkable(restored.dungeon.grid[ty][tx]), 'landed inside terrain');
  assert.equal(Object.keys(restored.world.pois).length, 0, 'a legacy save has nothing discovered yet');
});

test('a save can never resurrect a landmark the generator no longer places', () => {
  Save._storage = memStorage();
  const s = Game.newSoloRun(31337);
  // A discovery record for a chunk that holds no POI at all.
  const snap = Save.snapshot(s);
  snap.world = { visited: '', pois: [{ k: World.chunkKey(5, 5), f: true, u: true }], bosses: [] };
  const restored = Game.fromSave(snap);
  assert.equal(restored.world.pois[World.chunkKey(5, 5)], undefined, 'a phantom landmark was restored');
});

// ---- Phase 5: co-op ----

test('a room is a shared continent, and joining does not replace it with a floor', () => {
  const { Game: SimGame } = require('../server/sim.js');
  const RoomMod = require('../server/room.js');
  const Room = RoomMod.Room || RoomMod;
  const room = new Room({ code: 'WRLD', seed: 777 });
  assert.equal(room.state.inWorld, true, 'a fresh room should be on the continent');

  const a = room.join({ name: 'A' });
  const b = room.join({ name: 'B' });
  // refreshPartyScaling used to regenerate the floor on every join, which out
  // here would swap the whole continent for a 120x120 dungeon.
  assert.equal(room.state.inWorld, true, 'joining replaced the world with a dungeon floor');
  assert.equal(room.state.dungeon.overworld, true);
  assert.equal(room.state.players.length, 2);

  let ms = 0;
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      ms += 1000 / 30;
      if (room.step) room.step(ms);
      else room.tick(ms);
    }
  };
  step(30);
  for (const p of room.state.players) {
    const tx = Math.floor(p.x / TS);
    const ty = Math.floor(p.y / TS);
    assert.ok(D.isWalkable(room.state.dungeon.grid[ty][tx]), `${p.id} joined inside terrain`);
    const c = World.chunkOf(tx, ty);
    assert.equal(World.ringOf(c.cx, c.cy), 0, `${p.id} did not arrive at Ashfall`);
  }
  assert.ok(room.state.world.active.size > 0, 'the room activated no chunks');

  // The snapshot tells the client which kind of level to build.
  const snap = room.snapshotFor(a.id);
  assert.equal(snap.inWorld, true);
  assert.equal(snap.worldSeed, room.state.worldSeed >>> 0);
  void b;
  void SimGame;
});

test('server activation runs over the union of the party’s radii, and stays capped', () => {
  const { Game: SimGame } = require('../server/sim.js');
  const RoomMod = require('../server/room.js');
  const Room = RoomMod.Room || RoomMod;
  const room = new Room({ code: 'WRL2', seed: 777 });
  room.join({ name: 'A' });
  room.join({ name: 'B' });
  let ms = 0;
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      ms += 1000 / 30;
      if (room.step) room.step(ms);
      else room.tick(ms);
    }
  };
  step(10);
  const together = room.state.world.active.size;

  // Send one player to the far side of the map.
  const c = World.chunkCenter(24, 24);
  const spot = SimGame._.findOpenTile(room.state.world.world, c.x, c.y);
  room.state.players[1].x = (spot.x + 0.5) * TS;
  room.state.players[1].y = (spot.y + 0.5) * TS;
  step(10);
  const scattered = room.state.world.active.size;

  assert.ok(scattered > together, 'a scattered party should light more of the map');
  assert.ok(scattered <= Balance.world.activeChunkCap, `active set ${scattered} broke the cap`);
});

test('the client rebuilds the same continent from the seed alone, streaming no tiles', () => {
  // The projection carries absolute world pixels and a seed — never a tile, and
  // never a chunk-local coordinate — which is what lets prediction run unchanged
  // across a chunk boundary.
  const RoomMod = require('../server/room.js');
  const Room = RoomMod.Room || RoomMod;
  const room = new Room({ code: 'WRL3', seed: 777 });
  const a = room.join({ name: 'A' });
  const snap = room.snapshotFor(a.id);
  const json = JSON.stringify(snap);
  assert.ok(!/"grid"/.test(json), 'the snapshot is shipping terrain');
  assert.ok(json.length < 20000, `snapshot is ${json.length} bytes — terrain has leaked in`);

  // A client building from the seed lands on byte-identical ground.
  const clientWorld = World.create(snap.worldSeed);
  const serverWorld = room.state.world.world;
  for (const [cx, cy] of [[16, 16], [17, 16], [14, 19]]) {
    World.ensureChunk(clientWorld, cx, cy);
    World.ensureChunk(serverWorld, cx, cy);
    for (let y = cy * 64; y < cy * 64 + 64; y += 7) {
      for (let x = cx * 64; x < cx * 64 + 64; x += 7) {
        assert.equal(clientWorld.grid[y][x], serverWorld.grid[y][x], `client/server disagree at ${x},${y}`);
      }
    }
  }
});

test('prediction carries a hero across a chunk boundary with no seam', () => {
  // The one thing a chunked world can get wrong in netcode: movement that
  // behaves differently on either side of a chunk edge. Nothing in the movement
  // path is chunk-aware — the grid is one array in world tile coords — so this
  // pins that it stays that way.
  const s = worldRun();
  const world = s.world.world;
  // Stand just west of a chunk border on open ground.
  const border = 20 * World.CHUNK;
  const spot = G.findOpenTile(world, border - 2, 20 * World.CHUNK + 32);
  World.ensureAround(world, World.chunkOf(spot.x, spot.y).cx, World.chunkOf(spot.x, spot.y).cy, 2);
  const p = { ...s.player, x: (spot.x + 0.5) * TS, y: (spot.y + 0.5) * TS };
  const stats = Entities.effectiveStats(p);
  const input = { keys: { w: false, a: false, s: false, d: true }, pressed: new Set(), mouse: { x: -1, y: -1 } };

  const steps = [];
  for (let i = 0; i < 90; i++) {
    const before = p.x;
    Game.predictMovement(world.grid, p, input, 1 / 30, stats);
    steps.push(p.x - before);
  }
  const moving = steps.filter((d) => d > 0.01);
  assert.ok(moving.length > 30, 'the hero never got moving');
  // No step is wildly different from its neighbours — a seam would show up as a
  // stall or a jump exactly at the boundary.
  const maxStep = Math.max(...moving);
  const minStep = Math.min(...moving);
  assert.ok(maxStep - minStep < 0.5, `movement stuttered across the boundary (${minStep} … ${maxStep})`);
});
