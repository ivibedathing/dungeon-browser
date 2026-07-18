const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Props = require('../js/props.js');
const Stats = require('../js/stats.js');
globalThis.Stats = Stats;
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Quests = require('../js/quests.js');
const Save = require('../js/save.js');
globalThis.Save = Save;
const Game = require('../js/game.js');

function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

beforeEach(() => {
  Save._storage = mockStorage();
});

// A frame of input the sim accepts, with only the named edge-keys pressed.
function input(keys, pressed) {
  return {
    keys: Object.assign({ w: false, a: false, s: false, d: false, space: false }, keys),
    pressed: new Set(pressed || []),
    mouse: { x: -1, y: -1, click: false, rclick: false },
  };
}

// ---- The sheet itself ----

test('a fresh sheet has every declared key at zero', () => {
  const s = Stats.create();
  assert.deepEqual(Object.keys(s).sort(), Stats.KEYS.slice().sort());
  for (const k of Stats.KEYS) assert.equal(s[k], 0);
});

test('bump grows a counter, defaults to 1, and ignores nonsense', () => {
  const owner = {};
  Stats.bump(owner, 'kills');
  Stats.bump(owner, 'kills', 4);
  assert.equal(owner.stats.kills, 5);
  Stats.bump(owner, 'kills', 0);
  Stats.bump(owner, 'kills', -3);
  Stats.bump(owner, 'kills', NaN);
  assert.equal(owner.stats.kills, 5, 'zero, negative, and NaN never move a tally');
  assert.doesNotThrow(() => Stats.bump(null, 'kills'), 'a missing owner is a no-op');
});

test('sanitize drops unknown keys, junk values, and clamps at the cap', () => {
  const s = Stats.sanitize({ kills: 7, bogus: 99, gold: 'lots', tiles: -5, dealt: 1e30 });
  assert.equal(s.kills, 7);
  assert.equal(s.bogus, undefined);
  assert.equal(s.gold, 0);
  assert.equal(s.tiles, 0);
  assert.equal(s.dealt, Stats.CAP);
  assert.deepEqual(Stats.sanitize(null), Stats.create());
  assert.deepEqual(Stats.sanitize([1, 2]), Stats.create());
});

test('merge sums two sheets key by key', () => {
  const m = Stats.merge({ kills: 3, gold: 10 }, { kills: 4 });
  assert.equal(m.kills, 7);
  assert.equal(m.gold, 10);
  assert.equal(m.tiles, 0);
});

test('format groups thousands and rounds fractional damage', () => {
  assert.equal(Stats.format(0), '0');
  assert.equal(Stats.format(842), '842');
  assert.equal(Stats.format(19204), '19,204');
  assert.equal(Stats.format(1234567), '1,234,567');
  assert.equal(Stats.format(12.6), '13');
});

// ---- Sim hooks ----

test('a new player starts with a zeroed sheet', () => {
  const state = Game.newRun(1);
  assert.deepEqual(state.player.stats, Stats.create());
});

test('swinging counts a swing; loosing a shot counts a shot', () => {
  const state = Game.newRun(3);
  const p = state.player;
  Game._.playerAttack(state, p);
  assert.equal(p.stats.swings, 1);
  assert.equal(p.stats.shots, 0, 'a melee weapon fires nothing');

  const rng = U.mulberry32(9);
  p.equip.weapon = Items.makeItem(3, rng, { slot: 'weapon', kind: 'bow' });
  p.attackT = 0;
  Game._.playerAttack(state, p);
  assert.equal(p.stats.shots, 1);
  assert.equal(p.stats.swings, 1, 'a bow shot is not a sword swing');
});

test('a kill is credited to the killer, and a boss also counts as a boss', () => {
  const state = Game.newRun(5);
  const p = state.player;
  const stats = Entities.effectiveStats(p);
  const mob = Object.assign(Entities.makeMonster('zombie', 1, false, 1), { id: 99, x: p.x, y: p.y, hp: 1 });
  state.monsters.push(mob);
  Game._.hitMonster(state, mob, 50, stats, 0, 0, p);
  assert.equal(p.stats.kills, 1);
  assert.equal(p.stats.bosses, 0);

  const boss = Object.assign(Entities.makeBoss(1, 1), { id: 100, x: p.x, y: p.y, hp: 1 });
  state.monsters.push(boss);
  Game._.hitMonster(state, boss, 999, stats, 0, 0, p);
  assert.equal(p.stats.kills, 2);
  assert.equal(p.stats.bosses, 1);
});

test('damage dealt counts what actually landed, not overkill', () => {
  const state = Game.newRun(6);
  const p = state.player;
  const stats = Entities.effectiveStats(p);
  const mob = Object.assign(Entities.makeMonster('zombie', 1, false, 1), { id: 42, x: p.x, y: p.y, hp: 10 });
  state.monsters.push(mob);
  Game._.hitMonster(state, mob, 1000, stats, 0, 0, p);
  assert.equal(p.stats.dealt, 10, 'a 1000-damage blow to a 10hp monster deals 10');
});

test('damage taken is counted after defense, and a dodge counts nothing', () => {
  const state = Game.newRun(7);
  const p = state.player;
  const dealt = Game._.hurtPlayer(state, p, 20);
  assert.ok(dealt > 0);
  assert.equal(p.stats.taken, dealt);

  p.dodgeT = 0.2;
  Game._.hurtPlayer(state, p, 20);
  assert.equal(p.stats.taken, dealt, 'a dodged blow never lands, so it never tallies');
});

test('walking tallies squares, and standing still tallies none', () => {
  const state = Game.newRun(11);
  const p = state.player;
  const before = p.stats.tiles;

  Game.update(state, { p0: input({}, []) }, 1 / 60);
  assert.equal(p.stats.tiles, before, 'a frame without input walks nowhere');

  // Walk far enough that at least one tile boundary is certainly crossed.
  for (let i = 0; i < 240; i++) Game.update(state, { p0: input({ d: true }, []) }, 1 / 60);
  const walked = p.stats.tiles;
  assert.ok(walked > 0, `expected squares walked, got ${walked}`);
});

test('gold and items tally on pickup', () => {
  const state = Game.newRun(13);
  const p = state.player;
  state.groundItems.push({ kind: 'gold', amount: 25, x: p.x, y: p.y, ownerId: null });
  Game.update(state, { p0: input({}, []) }, 1 / 60);
  assert.equal(p.stats.gold, 25);
  assert.equal(p.bag.gold, 25);

  const sword = Items.makeItem(2, U.mulberry32(4), { slot: 'weapon' });
  state.groundItems.push({ kind: 'item', item: sword, x: p.x, y: p.y, ownerId: null });
  Game._.tryPickup(state, p);
  assert.equal(p.stats.items, 1);
});

test('descending tallies a floor for every hero', () => {
  const state = Game.newRun(17);
  Game._.descend(state);
  assert.equal(state.player.stats.floors, 1);
  assert.equal(state.floor, 2);
});

// ---- Persistence ----

test('the run sheet survives a save round trip', () => {
  const state = Game.newRun(21);
  Stats.bump(state.player, 'kills', 9);
  Stats.bump(state.player, 'tiles', 400);
  Save.write(state);

  const restored = Game.fromSave(Save.load());
  assert.equal(restored.player.stats.kills, 9);
  assert.equal(restored.player.stats.tiles, 400);
});

test('a pre-stats save restores a zeroed sheet rather than undefined', () => {
  const state = Game.newRun(22);
  Save.write(state);
  const blob = Save.load();
  delete blob.player.stats;
  const restored = Game.fromSave(blob);
  assert.deepEqual(restored.player.stats, Stats.create());
});

test('lifetime totals accumulate across runs and survive Save.clear', () => {
  assert.deepEqual(Save.lifetime(), Stats.create(), 'no history reads as all zeroes');

  Save.addLifetime({ kills: 5, gold: 100 });
  Save.addLifetime({ kills: 3, gold: 50 });
  const total = Save.lifetime();
  assert.equal(total.kills, 8);
  assert.equal(total.gold, 150);

  Save.clear();
  assert.equal(Save.lifetime().kills, 8, 'clearing the run save leaves the lifetime tally intact');
});

test('lifetime storage ignores an inflated hand-edited blob', () => {
  Save._storage.setItem(Save.STATS_KEY, JSON.stringify({ kills: 1e30, junk: 'x' }));
  const total = Save.lifetime();
  assert.equal(total.kills, Stats.CAP);
  assert.equal(total.junk, undefined);
});

test('a fatal blow banks the run into the lifetime total exactly once', () => {
  const state = Game.newRun(31);
  Stats.bump(state.player, 'kills', 6);
  state.player.hp = -1;

  Game.update(state, { p0: input({}, []) }, 1 / 60);
  assert.equal(state.dead, true);
  assert.equal(state.statsBanked, true);
  assert.equal(state.player.stats.deaths, 1);
  assert.equal(Save.lifetime().kills, 6);

  // Further frames on a dead run must not bank the sheet again.
  Game.update(state, { p0: input({}, []) }, 1 / 60);
  Game.update(state, { p0: input({}, []) }, 1 / 60);
  assert.equal(Save.lifetime().kills, 6, 'the run folds into the lifetime once, not once per frame');
});
