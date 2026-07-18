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
