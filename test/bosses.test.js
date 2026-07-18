const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Bosses = require('../js/bosses.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const G = Game._;
const Balance = require('../js/balance.js');

// ---- the act table ----

test('six acts tile floors 1-24 with no gap and no overlap', () => {
  assert.equal(Bosses.ACTS.length, 6);
  let expected = 1;
  for (const a of Bosses.ACTS) {
    assert.equal(a.from, expected, `act ${a.act} starts where the last ended`);
    assert.equal(a.to - a.from + 1, Bosses.ACT_SPAN, `act ${a.act} is ${Bosses.ACT_SPAN} floors`);
    assert.ok(a.bossFloor >= a.from && a.bossFloor <= a.to, 'its boss floor is inside it');
    assert.equal(a.bossFloor, a.to, 'the boss closes the act');
    expected = a.to + 1;
  }
  assert.equal(expected - 1, Bosses.FINAL_FLOOR, 'the last act ends on the final floor');
});

test('actForFloor is total for floors 1-24 and null past the end', () => {
  for (let f = 1; f <= 24; f++) {
    assert.ok(Bosses.actForFloor(f), `floor ${f} belongs to an act`);
  }
  for (const f of [25, 26, 30, 47, 100]) {
    assert.equal(Bosses.actForFloor(f), null, `floor ${f} is past the main quest`);
  }
});

test('act boss floors are a subset of the existing even-floor arenas', () => {
  for (const f of Bosses.allBossFloors()) {
    assert.equal(f % 2, 0, `floor ${f} is an arena floor the generator already makes`);
    assert.ok(Bosses.isActBossFloor(f));
  }
  // The arena floors no act claims keep the generic guardian.
  for (const f of [2, 6, 10, 14, 18, 22]) {
    assert.equal(Bosses.bossForFloor(f), null, `floor ${f} is a miniboss floor`);
  }
});

test('exactly one act is final, and it is the floor-24 one', () => {
  const finals = Bosses.ACTS.filter((a) => a.final);
  assert.equal(finals.length, 1, 'one ending');
  assert.equal(finals[0].bossFloor, Bosses.FINAL_FLOOR);
  assert.ok(Bosses.isFinalFloor(24));
  assert.ok(!Bosses.isFinalFloor(20));
});

// This is the test that earns its keep: content data is where typos actually
// happen, and a phase naming a behavior that does not exist would otherwise
// only surface as a boss standing still in the arena on floor 20.
test('every behavior named anywhere in the act table actually exists', () => {
  const known = Object.keys(G.BEHAVIORS);
  for (const a of Bosses.ACTS) {
    assert.ok(known.includes(a.boss.behavior), `act ${a.act} opener "${a.boss.behavior}" is a real behavior`);
    for (const ph of a.boss.phases || []) {
      if (ph.behavior === undefined) continue; // a phase may retune without switching
      assert.ok(known.includes(ph.behavior), `act ${a.act} phase behavior "${ph.behavior}" is a real behavior`);
    }
  }
});

test('every act has the flavor Task 6 needs and a balance row', () => {
  for (const a of Bosses.ACTS) {
    assert.ok(a.title && a.title.length > 3, `act ${a.act} has a title`);
    assert.ok(a.board && a.board.length > 10, `act ${a.act} has a notice board line`);
    assert.ok(a.done && a.done.length > 10, `act ${a.act} has a completed line`);
    assert.ok(a.boss.name && a.boss.epithet, `act ${a.act} boss is named`);
    assert.ok(Balance.actBoss[a.act], `act ${a.act} has a balance row`);
  }
});

test('phase thresholds descend, so the ladder can never fire out of order', () => {
  for (const a of Bosses.ACTS) {
    const ats = (a.boss.phases || []).map((p) => p.at);
    for (let i = 1; i < ats.length; i++) {
      assert.ok(ats[i] < ats[i - 1], `act ${a.act} phase ${i} triggers below phase ${i - 1}`);
    }
    for (const at of ats) assert.ok(at > 0 && at < 1, `act ${a.act} threshold ${at} is a real fraction`);
  }
});

// ---- makeBoss ----

test('act boss floors build the named boss with its behavior and phases', () => {
  for (const a of Bosses.ACTS) {
    const b = Entities.makeBoss(a.bossFloor);
    assert.ok(b.boss, `floor ${a.bossFloor} is a boss`);
    assert.ok(b.name.startsWith(a.boss.name), `named ${a.boss.name}`);
    assert.equal(b.actBoss, a.act, 'tagged with its act');
    assert.equal(b.behavior, a.boss.behavior, 'carries its opening behavior');
    assert.equal(b.phases.length, (a.boss.phases || []).length, 'carries its phase ladder');
    assert.equal(b.phaseIdx, 0, 'starts at phase 0');
  }
});

test('the final boss is flagged, and only it', () => {
  assert.equal(Entities.makeBoss(24).final, true);
  for (const f of [4, 8, 12, 16, 20]) assert.ok(!Entities.makeBoss(f).final, `floor ${f} is not the end`);
});

test('non-act arena floors keep a plain generic guardian', () => {
  for (const f of [2, 6, 10, 14, 18, 22]) {
    const b = Entities.makeBoss(f);
    assert.ok(b.boss, 'still a boss');
    assert.equal(b.actBoss, undefined, 'not an act boss');
    assert.equal(b.behavior, undefined, 'plain melee, as it always was');
    assert.equal(b.phases, undefined, 'no phase ladder');
    assert.ok(b.name.length > 3, 'still named');
  }
});

test('guardian names no longer run out — the old list repeated from floor 12', () => {
  const seen = new Map();
  for (let f = 2; f <= 60; f += 2) {
    const n = Entities.makeBoss(f).name;
    assert.ok(!seen.has(n), `floor ${f} reuses the name from floor ${seen.get(n)} ("${n}")`);
    seen.set(n, f);
  }
});

test('an act boss is the hardest thing on its own floor', () => {
  for (const a of Bosses.ACTS) {
    const boss = Entities.makeBoss(a.bossFloor);
    const champ = Entities.makeMonster('brute', a.bossFloor, true);
    assert.ok(boss.hp > champ.hp * 2, `act ${a.act}: outlasts a champion`);
    assert.ok(boss.dmg > champ.dmg, `act ${a.act}: hits harder than a champion`);
    // ...and than the generic guardian two floors above it, which it follows.
    if (a.bossFloor > 2) {
      const prevGuard = Entities.makeBoss(a.bossFloor - 2);
      assert.ok(boss.hp > prevGuard.hp, `act ${a.act}: tougher than the guardian below it`);
      assert.ok(boss.dmg > prevGuard.dmg, `act ${a.act}: deadlier than the guardian below it`);
    }
  }
});

// Each class scales monotonically within itself. ACROSS classes the curve is a
// deliberate sawtooth: an act boss is the spike that closes its act, so the
// generic guardian two floors later hits for less than the boss just beaten.
// That is the intended shape of the run, not a regression.
test('generic guardians scale monotonically with depth', () => {
  let lastHp = 0;
  let lastDmg = 0;
  for (const f of [2, 6, 10, 14, 18, 22, 26, 30]) {
    const b = Entities.makeBoss(f);
    assert.ok(b.hp > lastHp, `floor ${f} guardian hp ${b.hp} exceeds the previous ${lastHp}`);
    assert.ok(b.dmg > lastDmg, `floor ${f} guardian dmg ${b.dmg} exceeds the previous ${lastDmg}`);
    lastHp = b.hp;
    lastDmg = b.dmg;
  }
});

test('act bosses scale monotonically across acts', () => {
  let lastHp = 0;
  let lastDmg = 0;
  for (const a of Bosses.ACTS) {
    const b = Entities.makeBoss(a.bossFloor);
    assert.ok(b.hp > lastHp, `act ${a.act} hp ${b.hp} exceeds the previous ${lastHp}`);
    assert.ok(b.dmg > lastDmg, `act ${a.act} dmg ${b.dmg} exceeds the previous ${lastDmg}`);
    lastHp = b.hp;
    lastDmg = b.dmg;
  }
});

test('the difficulty sawtooth is bounded: a guardian never trails the act boss before it by much', () => {
  for (const a of Bosses.ACTS) {
    const next = a.bossFloor + 2;
    if (next > 30) continue;
    const boss = Entities.makeBoss(a.bossFloor);
    const guard = Entities.makeBoss(next);
    assert.ok(guard.dmg > boss.dmg * 0.75, `floor ${next} guardian (${guard.dmg}) is not a cliff after act ${a.act} (${boss.dmg})`);
  }
});

test('party scaling still applies on top of act scaling', () => {
  const solo = Entities.makeBoss(12, 1);
  const party = Entities.makeBoss(12, 4);
  assert.ok(party.hp > solo.hp, 'a four-player act boss is tougher');
  assert.ok(party.xp > solo.xp, 'and worth more');
});

test('makeBoss is deterministic for a given floor and party size', () => {
  for (const f of [4, 12, 24, 26]) {
    assert.deepEqual(Entities.makeBoss(f, 2), Entities.makeBoss(f, 2), `floor ${f} reproduces exactly`);
  }
});

test('floors past the main quest still produce a working boss', () => {
  for (const f of [26, 30, 48]) {
    const b = Entities.makeBoss(f);
    assert.ok(b.boss && b.hp > 0 && b.name, `floor ${f} guardian is well-formed`);
    assert.equal(Bosses.actForFloor(f), null, 'with no act');
  }
});
