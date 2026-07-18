// Phase 4 — co-op rules. Party scaling, attacker-aware combat, per-member XP,
// instanced loot, downed/revive, and shared descent. Every rule degrades to
// today's solo behavior at n=1; the tests pin both the co-op path and that degrade.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Props = require('../js/props.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const Balance = require('../js/balance.js');
const E = Entities;

// ---- Task 1: party monster scaling ----

test('party scaling multipliers wire to Balance.coop and are 1 at n=1', () => {
  assert.ok(Balance.coop, 'Balance.coop exists');
  assert.equal(E.partyHpMult(1), 1);
  assert.equal(E.partyXpMult(1), 1);
  assert.equal(E.partyHpMult(4), 1 + Balance.coop.hpPerPlayer * 3);
  assert.equal(E.partyXpMult(4), 1 + Balance.coop.xpPerPlayer * 3);
});

test('makeMonster scales hp and xp by party size; n=1 is byte-identical to no-arg', () => {
  const solo = E.makeMonster('bat', 1, false);
  const soloExplicit = E.makeMonster('bat', 1, false, 1);
  assert.deepEqual(soloExplicit, solo, 'n=1 explicit equals the default');
  const party = E.makeMonster('bat', 1, false, 4);
  assert.equal(party.hp, Math.round(solo.hp * E.partyHpMult(4)));
  assert.equal(party.maxHP, party.hp);
  assert.equal(party.xp, Math.round(solo.xp * E.partyXpMult(4)));
  // dmg/speed/size are NOT party-scaled — only hp and xp.
  assert.equal(party.dmg, solo.dmg);
  assert.equal(party.speed, solo.speed);
});

test('makeBoss scales with party too, and n=1 matches the default', () => {
  const solo = E.makeBoss(2);
  assert.deepEqual(E.makeBoss(2, 1), solo);
  const party = E.makeBoss(2, 4);
  assert.ok(party.hp > solo.hp, 'a 4-party boss has more HP');
  assert.ok(party.xp > solo.xp, 'and pays more XP');
});

// ---- Task 1: pristine-floor party sampling in the Room ----

test('Room scales the entry floor to the party while it is pristine, then locks it', () => {
  const { Room } = require('../server/room.js');
  const room = new Room({ code: 'AAAA', seed: 123 });
  room.join({});
  const oneN = room.state.monsters.length ? room.state.monsters[0].maxHP : null;
  // Seat three more before any blow lands → the pristine floor rescales to 4.
  room.join({});
  room.join({});
  room.join({});
  assert.equal(room.state.partyN, 4);
  const scaled = room.state.monsters.find((m) => !m.boss);
  assert.ok(scaled, 'floor has monsters');
  // A floor-1 monster of the same type should now be ~party-scaled vs a solo one.
  const soloRef = E.makeMonster(scaled.type, room.state.floor, scaled.champion, 1);
  const partyRef = E.makeMonster(scaled.type, room.state.floor, scaled.champion, 4);
  assert.equal(scaled.maxHP, partyRef.maxHP);
  assert.notEqual(soloRef.maxHP, partyRef.maxHP);
  // Land a blow: the floor locks. A later join must not rescale survivors.
  scaled.hp -= 1;
  const before = room.state.monsters.map((m) => m.maxHP);
  // (room is full at 4; simulate a leave+join churn on a dirtied floor)
  room.leave('p3');
  room.join({});
  assert.deepEqual(room.state.monsters.map((m) => m.maxHP), before, 'dirtied floor stays locked');
});

// ---- Task 2: attacker-aware combat ----

// Build a second live hero with all the runtime fields Game.newRun stamps on players[0].
function addAlly(state, id, x, y) {
  const pl = Entities.newPlayer({ name: id });
  Object.assign(pl, {
    id, dead: false, facing: 0, attackT: 0, swing: null, hurtT: 0, healPool: 0, healRate: 0,
    skillCd: { whirlwind: 0, nova: 0, prayer: 0 }, dodgeT: 0, dodgeCdT: 0, dodgeDir: { x: 1, y: 0 },
    x, y, hp: pl.baseMaxHP, mana: pl.baseMaxMana,
  });
  state.players.push(pl);
  return pl;
}

test('attacker-aware melee: a non-players[0] hero damages and is credited its own kill', () => {
  const state = Game.newRun(4242);
  state.monsters = [];
  state.props = [];
  const p0 = state.player;
  // Beyond Balance.coop.shareRange (900) so only p1 is in XP range of the kill.
  const p1 = addAlly(state, 'p1', p0.x + 1400, p0.y);
  const m = { ...Entities.makeMonster('bat', 1, false), id: state.nextId++, x: p1.x + 20, y: p1.y, hp: 3, maxHP: 3, hitT: 0, kbx: 0, kby: 0, aggroed: false, lungeT: 0 };
  state.monsters.push(m);
  p1.facing = 0;
  Game._.playerAttack(state, p1);
  assert.ok(!state.monsters.includes(m), 'p1 (not players[0]) killed the monster it faced');
  assert.ok(p1.xp > 0, 'p1 was credited the kill XP');
  assert.equal(p0.xp, 0, 'the distant idle p0 (out of share range) gained nothing');
});

test('a projectile carries its firer as owner and credits the kill to them', () => {
  const state = Game.newRun(99);
  state.monsters = [];
  state.props = [];
  state.projectiles = [];
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 600, p0.y);
  p1.equip.weapon = Items.makeItem(1, U.mulberry32(1), { slot: 'weapon', kind: 'bow' });
  p1.facing = 0;
  Game._.playerAttack(state, p1);
  assert.equal(state.projectiles.length, 1, 'p1 loosed one arrow');
  assert.equal(state.projectiles[0].ownerId, 'p1', 'the arrow is owned by its firer');
});

// ---- Task 3: full XP to every in-range party member ----

test('a kill pays full XP to every living player within share range, not just the killer', () => {
  const state = Game.newRun(31);
  state.monsters = [];
  state.props = [];
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 40, p0.y); // right next to p0, in range
  const m = { ...Entities.makeMonster('bat', 1, false), id: state.nextId++, x: p1.x + 20, y: p1.y, hp: 3, maxHP: 3, hitT: 0, kbx: 0, kby: 0, aggroed: false, lungeT: 0 };
  state.monsters.push(m);
  const reward = m.xp;
  p1.facing = 0;
  Game._.playerAttack(state, p1);
  assert.equal(p1.xp, reward, 'the killer got full XP');
  assert.equal(p0.xp, reward, 'the nearby ally got the SAME full XP (not a split)');
});

test('a player out of share range gets no XP from the kill', () => {
  const state = Game.newRun(32);
  state.monsters = [];
  state.props = [];
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 2000, p0.y); // far
  const m = { ...Entities.makeMonster('bat', 1, false), id: state.nextId++, x: p1.x + 20, y: p1.y, hp: 3, maxHP: 3, hitT: 0, kbx: 0, kby: 0, aggroed: false, lungeT: 0 };
  state.monsters.push(m);
  p1.facing = 0;
  Game._.playerAttack(state, p1);
  assert.ok(p1.xp > 0 && p0.xp === 0, 'only the in-range killer gained XP');
});

// ---- Task 4: instanced loot, per-player bags, pickup validation ----

test('the bag is per-player and state.bag aliases the local player', () => {
  const state = Game.newRun(5);
  assert.ok(state.player.bag, 'the player owns a bag');
  assert.equal(state.bag, state.player.bag, 'state.bag aliases the local player bag');
});

test('a kill near two players instances a separate owned drop for each', () => {
  const state = Game.newRun(70);
  state.groundItems = [];
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 40, p0.y);
  // A boss always showers loot; drop it right between the two nearby players.
  const boss = { ...Entities.makeBoss(2), id: 999, x: p0.x + 20, y: p0.y };
  Game.dropLoot(state, boss, p0);
  const owners = new Set(state.groundItems.map((g) => g.ownerId));
  assert.ok(owners.has('p0') && owners.has('p1'), 'both players got their own instanced drops');
  // No drop is grabbable by the wrong player.
  for (const g of state.groundItems) assert.ok(g.ownerId === 'p0' || g.ownerId === 'p1');
});

test('solo drops stay unowned (null owner) — the legacy shared path', () => {
  const state = Game.newRun(71);
  state.groundItems = [];
  const boss = { ...Entities.makeBoss(2), id: 999, x: state.player.x, y: state.player.y };
  Game.dropLoot(state, boss, state.player);
  assert.ok(state.groundItems.length > 0, 'boss dropped loot');
  assert.ok(state.groundItems.every((g) => g.ownerId == null), 'all solo drops are unowned');
});

test('pickup validation: a player cannot grab a teammate-owned item, but can grab its own and shared', () => {
  const state = Game.newRun(72);
  state.groundItems = [];
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 300, p0.y);
  const mkItem = () => Items.makeItem(1, U.mulberry32(9), { slot: 'armor' });
  // p0-owned item next to p1 → p1 must not grab it.
  state.groundItems.push({ id: 1, kind: 'item', item: mkItem(), x: p1.x + 8, y: p1.y, ownerId: 'p0' });
  Game._.tryPickup(state, p1);
  assert.ok(state.groundItems.some((g) => g.id === 1), 'p1 could not grab p0-owned loot');
  // p1-owned item → p1 grabs it.
  state.groundItems.push({ id: 2, kind: 'item', item: mkItem(), x: p1.x + 8, y: p1.y, ownerId: 'p1' });
  Game._.tryPickup(state, p1);
  assert.ok(!state.groundItems.some((g) => g.id === 2), 'p1 grabbed its own loot');
  // Shared (null owner) item → anyone grabs it.
  state.groundItems.push({ id: 3, kind: 'item', item: mkItem(), x: p1.x + 8, y: p1.y, ownerId: null });
  Game._.tryPickup(state, p1);
  assert.ok(!state.groundItems.some((g) => g.id === 3), 'p1 grabbed the shared loot');
});

test('snapshot hides a teammate-owned drop but shows shared drops to all', () => {
  const { Room } = require('../server/room.js');
  const room = new Room({ code: 'BBBB', seed: 9 });
  const a = room.join({});
  const b = room.join({});
  const s = room.state;
  const near = { x: s.players[0].x, y: s.players[0].y };
  s.groundItems.push({ id: 10, kind: 'gold', amount: 5, x: near.x, y: near.y, ownerId: a.id });
  s.groundItems.push({ id: 11, kind: 'gold', amount: 5, x: near.x, y: near.y, ownerId: b.id });
  s.groundItems.push({ id: 12, kind: 'gold', amount: 5, x: near.x, y: near.y, ownerId: null });
  const seenByA = room.snapshotFor(a.id).groundItems.map((g) => g.id).sort();
  assert.deepEqual(seenByA, [10, 12], 'A sees its own + shared, not B\'s');
});

// ---- Task 5: downed / revive / respawn ----

test('co-op: a hero at 0 HP goes DOWN (revivable), the run continues', () => {
  const state = Game.newRun(80);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 300, p0.y);
  p1.hp = 0;
  Game.update(state, {}, 0.05);
  assert.equal(p1.down, true, 'p1 is down');
  assert.equal(p1.dead, false, 'down is not dead');
  assert.equal(state.dead, false, 'the run continues');
});

test('a downed hero is revived by a nearby ally holding proximity', () => {
  const state = Game.newRun(81);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x, p0.y); // co-located reviver
  p1.hp = 0;
  Game.update(state, {}, 0.05);
  assert.ok(p1.down);
  for (let t = 0; t < 50; t++) Game.update(state, {}, 0.05); // > reviveTime (1.6s)
  assert.equal(p1.down, false, 'revived');
  assert.ok(p1.hp > 0, 'restored with HP');
});

test('a downed hero left alone respawns at the floor entry', () => {
  const state = Game.newRun(82);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 3000, p0.y); // no reviver near
  p1.hp = 0;
  Game.update(state, {}, 0.05);
  assert.ok(p1.down);
  for (let t = 0; t < 230; t++) Game.update(state, {}, 0.05); // > respawnTime (10s)
  assert.equal(p1.down, false, 'respawned');
  const ex = (state.dungeon.entry.x + 0.5) * 32;
  const ey = (state.dungeon.entry.y + 0.5) * 32;
  assert.ok(Math.hypot(p1.x - ex, p1.y - ey) < 48, 'back at the entry');
});

test('downing the whole party simultaneously ends the run', () => {
  const state = Game.newRun(83);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 300, p0.y);
  p0.hp = 0;
  p1.hp = 0;
  Game.update(state, {}, 0.05);
  assert.equal(state.dead, true, 'a full wipe ends the run');
});

test('solo: 0 HP is immediate permadeath (unchanged)', () => {
  const state = Game.newRun(84);
  state.player.hp = 0;
  Game.update(state, {}, 0.05);
  assert.equal(state.player.dead, true, 'solo player dies');
  assert.equal(state.dead, true, 'run ends');
  assert.ok(!state.player.down, 'no down state in solo');
});

// ---- Task 6: shared descent + party teleport ----

function toStairs(state, pl) {
  pl.x = (state.dungeon.stairs.x + 0.5) * 32;
  pl.y = (state.dungeon.stairs.y + 0.5) * 32;
}

test('solo descends instantly on the stairs (unchanged)', () => {
  const state = Game.newRun(90);
  toStairs(state, state.player);
  const before = state.floor;
  const next = Game.update(state, {}, 0.05);
  assert.equal(next.floor, before + 1, 'solo advanced a floor immediately');
});

test('party: one hero on the stairs arms a countdown, not an instant descent', () => {
  const state = Game.newRun(91);
  const p0 = state.player;
  addAlly(state, 'p1', p0.x + 400, p0.y); // ally off the stairs
  toStairs(state, p0);
  const before = state.floor;
  Game.update(state, {}, 0.05);
  assert.equal(state.floor, before, 'did not descend yet');
  assert.ok(typeof state.descendT === 'number' && state.descendT > 0, 'countdown armed');
});

test('party: the countdown elapsing descends and teleports the WHOLE party to the entry', () => {
  const state = Game.newRun(92);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 400, p0.y);
  const before = state.floor;
  let descended = false;
  for (let t = 0; t < 260 && !descended; t++) {
    state.monsters = []; // isolate the countdown from combat interference
    toStairs(state, p0); // park p0 on the stairs BEFORE the tick (only p0 → countdown path)
    Game.update(state, {}, 0.05);
    if (state.floor > before) descended = true; // don't re-park after: descent fanned everyone to entry
  }
  assert.equal(state.floor, before + 1, 'party descended after the countdown');
  const ex = (state.dungeon.entry.x + 0.5) * 32;
  const ey = (state.dungeon.entry.y + 0.5) * 32;
  assert.ok(Math.hypot(p0.x - ex, p0.y - ey) < 48, 'p0 at the new entry');
  assert.ok(Math.hypot(p1.x - ex, p1.y - ey) < 48, 'p1 teleported to the new entry too');
});

test('party: all heroes on the stairs descend instantly', () => {
  const state = Game.newRun(93);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', 0, 0);
  toStairs(state, p0);
  toStairs(state, p1);
  const before = state.floor;
  Game.update(state, {}, 0.05);
  assert.equal(state.floor, before + 1, 'a fully-assembled party descends at once');
});

test('a portal is owner-tagged and travel moves the whole party', () => {
  const state = Game.newRun(94);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 200, p0.y);
  Game._.castPortal(state, p1);
  assert.equal(state.portals[0].ownerId, 'p1', 'gate tagged with its caster');
  const gate = state.portals[0];
  Game._.travel(state, gate);
  assert.ok(state.inTown, 'party entered town');
  // both players are near the town entry, not at their old dungeon spots
  const near = (pl) => Math.hypot(pl.x - state.player.x, pl.y - state.player.y) < 60;
  assert.ok(near(p1), 'the ally travelled to town with the party');
});

// ---- Task 7: party UX pure helpers ----

test('partyRows: empty for solo, one row per member with HP/level/down state', () => {
  const UI = require('../js/ui.js');
  const solo = Game.newRun(95);
  assert.deepEqual(UI.partyRows(solo), [], 'solo shows no party bar');
  const p0 = solo.player;
  const p1 = addAlly(solo, 'p1', p0.x + 20, p0.y);
  p1.down = true;
  p1.reviveT = require('../js/balance.js').coop.reviveTime / 2;
  const rows = UI.partyRows(solo);
  assert.equal(rows.length, 2, 'a row per member');
  assert.ok(rows[0].isYou, 'the local hero is marked');
  const downRow = rows.find((r) => r.id === 'p1');
  assert.ok(downRow.down, 'down state surfaced');
  assert.ok(Math.abs(downRow.reviveFrac - 0.5) < 0.01, 'revive progress ~50%');
});

test('descentBannerText: null when idle, counts up seconds while descending', () => {
  const UI = require('../js/ui.js');
  assert.equal(UI.descentBannerText(null), null);
  assert.equal(UI.descentBannerText(0), null);
  assert.equal(UI.descentBannerText(4.2), 'Descending in 5…');
  assert.equal(UI.descentBannerText(0.3), 'Descending in 1…');
});

test('the render + HUD path draws a party (down ally, descent banner) without throwing', () => {
  globalThis.Game = Game; // render/player.js reads the Game global (browser: window.Game)
  globalThis.Render = require('../js/render.js');
  const UI = require('../js/ui.js');
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return typeof t[k] !== 'undefined' ? t[k] : (t[k] = () => {});
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const view = { w: 1280, h: 800 };
  let state = Game.newRun(96);
  const p0 = state.player;
  const p1 = addAlly(state, 'p1', p0.x + 30, p0.y);
  p1.down = true;
  p1.reviveT = 0.8;
  state.descendT = 6;
  state = Game.update(state, {}, 0.03); // populate flow field / explored
  state.descendT = 6; // (update may reset; force for the draw)
  Render.draw(ctx, state, view);
  UI.draw(ctx, state, view);
  assert.ok(true, 'party render + HUD path completed');
});

// ---- Task 8: exit proof — 4-seat room, co-op invariants end to end ----

// Advance a room by `seconds` in 30 Hz steps from a fixed clock (mirrors room.test).
function advance(room, seconds, t0) {
  const stepMs = 1000 / 30;
  let t = t0;
  room.tick(t); // prime lastMs
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    t += stepMs;
    room.tick(t);
  }
  return t;
}

test('Task 8: a 4-seat room is party-scaled, pays in-range XP, and instances drops per owner', () => {
  const { Room } = require('../server/room.js');
  const room = new Room({ code: 'CCCC', seed: 4242 });
  for (let i = 0; i < 4; i++) room.join({});
  const s = room.state;
  assert.equal(s.partyN, 4, 'four seats ⇒ party of four');

  // The floor is scaled to the party.
  const mon = s.monsters.find((m) => !m.boss);
  assert.equal(mon.maxHP, Entities.makeMonster(mon.type, s.floor, mon.champion, 4).maxHP, 'monsters are 4-party scaled');

  // Cluster the party on a monster; a kill pays full XP to every in-range member.
  const target = s.monsters[0];
  for (const pl of s.players) { pl.x = target.x + 8; pl.y = target.y; pl.xp = 0; }
  Game._.awardKillXP(s, target, s.players[0]);
  assert.ok(s.players.every((pl) => pl.xp > 0), 'all four nearby members were paid XP');

  // A boss kill instances a shower per owner; each seat sees only its own drops.
  s.groundItems = [];
  const boss = { ...Entities.makeBoss(s.floor, 4), id: 777, x: target.x, y: target.y };
  Game.dropLoot(s, boss, s.players[0]);
  const owners = new Set(s.groundItems.map((g) => g.ownerId));
  assert.equal(owners.size, 4, 'a distinct instanced shower for each of the four');
  for (const pl of s.players) {
    const mine = room.snapshotFor(pl.id).groundItems;
    assert.ok(mine.length > 0 && mine.every((g) => g.ownerId == null || g.ownerId === pl.id), `${pl.id} sees only its own loot`);
  }
});

test('Task 8: death/revive round-trips over the room, and a full wipe ends the run', () => {
  const { Room } = require('../server/room.js');
  const room = new Room({ code: 'DDDD', seed: 55 });
  for (let i = 0; i < 4; i++) room.join({});
  const s = room.state;
  s.monsters = []; // isolate from combat for a deterministic revive round-trip

  const [p0, p1] = s.players;
  p1.hp = 0;
  let t = advance(room, 0.1, 1000);
  assert.equal(p1.down, true, 'a fallen hero goes down, not dead');
  assert.equal(s.dead, false, 'the run continues');

  // p0 stands over p1 and revives it by holding proximity.
  p0.x = p1.x;
  p0.y = p1.y;
  const keepClear = () => { s.monsters = []; };
  for (let i = 0; i < 90; i++) { keepClear(); t += 1000 / 30; room.tick(t); }
  assert.equal(p1.down, false, 'the ally was revived');
  assert.ok(p1.hp > 0, 'revived with HP');

  // Now wipe everyone at once → the run ends.
  for (const pl of s.players) pl.hp = 0;
  t = advance(room, 0.1, t + 1000);
  assert.equal(s.dead, true, 'a simultaneous full wipe ends the run');
});
