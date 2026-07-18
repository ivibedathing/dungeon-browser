// Quest board: notice generation, progress tracking through the real kill/descend
// paths, and the board's accept/claim/abandon services.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const Balance = require('../js/balance.js');

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

function enterTown(state, input) {
  input.pressed.add('portal');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  const portal = state.portals[0];
  state.player.x = portal.x;
  state.player.y = portal.y;
  state = run(state, input, 60);
  assert.equal(state.inTown, true, 'arrived in town');
  return state;
}

// Walk to the notice board and stand in its range.
function atBoard(seed) {
  let state = Game.newRun(seed);
  state.monsters.length = 0;
  const input = freshInput();
  state = enterTown(state, input);
  state.player.x = (state.dungeon.board.x + 0.5) * TS;
  state.player.y = (state.dungeon.board.y + 0.5) * TS + 20;
  state = run(state, input, 2);
  assert.equal(state.questing, true, 'in reading range of the board');
  return state;
}

// ---- Generation ----

test('the board pins distinct, floor-appropriate notices with real rewards', () => {
  const board = Quests.rollBoard(1, U.mulberry32(3), []);
  assert.equal(board.length, Quests.BOARD_SIZE, 'a full board');
  const keys = board.map(Quests.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate notices');
  for (const q of board) {
    assert.ok(Quests.KINDS.includes(q.kind));
    assert.ok(q.need > 0 && q.title && q.desc);
    assert.ok(q.reward.gold > 0 && q.reward.xp > 0, 'every notice pays');
    if (q.kind === 'hunt') {
      assert.ok(Entities.MONSTER_TYPES[q.target].minFloor <= 1, 'no bounty on what cannot spawn yet');
    }
  }
});

test('a wraith bounty only appears once wraiths do', () => {
  const shallow = [];
  const deep = [];
  for (let s = 0; s < 40; s++) {
    shallow.push(...Quests.rollBoard(1, U.mulberry32(s), []));
    deep.push(...Quests.rollBoard(5, U.mulberry32(s), []));
  }
  assert.ok(!shallow.some((q) => q.target === 'wraith'), 'floor 1 board has no wraith hunt');
  assert.ok(deep.some((q) => q.target === 'wraith'), 'floor 5 board can post one');
  assert.equal(Balance.monsters.wraith.minFloor, 3, 'wraiths gate the bounty (pinned to balance)');
});

test('the board never re-offers what is already on the charter', () => {
  const active = [Quests.makeQuest('hunt', 'bat', 4, U.mulberry32(1))];
  for (let s = 0; s < 30; s++) {
    const board = Quests.rollBoard(4, U.mulberry32(s), active);
    assert.ok(!board.some((q) => Quests.key(q) === 'hunt:bat'), 'bat hunt withheld');
  }
});

test('rewards scale with the quarry, the count, and the depth', () => {
  const rng = () => 0; // the shortest count, every time
  const bats = Quests.makeQuest('hunt', 'bat', 1, rng);
  const brutes = Quests.makeQuest('hunt', 'brute', 1, rng);
  assert.ok(brutes.reward.gold > bats.reward.gold, 'brutes pay more than bats, head for head');

  const deep = Quests.makeQuest('hunt', 'bat', 9, rng);
  assert.ok(deep.reward.gold > bats.reward.gold, 'the same hunt pays more when posted deeper');
  const scale = 1 + Balance.quests.rewardFloorRate * 8;
  assert.equal(deep.reward.gold, Math.round(bats.reward.gold * scale), 'scaled by the balance rate');
});

test('a delve asks for floors below where it was posted and starts there', () => {
  const q = Quests.makeQuest('delve', null, 6, U.mulberry32(2));
  assert.ok(q.need > 6, 'it points downward');
  assert.equal(q.count, 6, 'progress starts at the posting floor');
  assert.equal(Quests.fraction(q), 0, 'an empty bar');
  assert.equal(Quests.progressText(q), `Floor 6 / ${q.need}`);
});

// ---- Progress ----

test('a hunt counts only its own quarry, and stops at the number asked for', () => {
  const q = Quests.makeQuest('hunt', 'bat', 1, U.mulberry32(4));
  q.need = 2;
  assert.equal(Quests.recordKill(q, { type: 'skeleton' }), false, 'wrong quarry does not count');
  assert.equal(Quests.recordKill(q, { type: 'bat' }), true);
  assert.equal(Quests.recordKill(q, { type: 'bat' }), true);
  assert.equal(Quests.isComplete(q), true);
  assert.equal(Quests.recordKill(q, { type: 'bat' }), false, 'a finished quest stops counting');
  assert.equal(q.count, 2, 'and never overshoots');
});

test('a champion bounty counts any named head, whatever its kind', () => {
  const q = Quests.makeQuest('champion', null, 4, U.mulberry32(5));
  q.need = 2;
  assert.equal(Quests.recordKill(q, { type: 'bat', champion: false }), false, 'ordinary bats are not bounty');
  assert.equal(Quests.recordKill(q, { type: 'bat', champion: true }), true);
  assert.equal(Quests.recordKill(q, { type: 'zombie', champion: true }), true);
  assert.equal(Quests.isComplete(q), true);
});

test('a delve tracks the deepest floor reached, never a shallower one', () => {
  const q = Quests.makeQuest('delve', null, 5, U.mulberry32(6));
  q.need = 8;
  assert.equal(Quests.recordDepth(q, 6), true);
  assert.equal(Quests.recordDepth(q, 5), false, 'backtracking does not count');
  assert.equal(q.count, 6, 'progress holds at the deepest');
  assert.equal(Quests.recordDepth(q, 8), true);
  assert.equal(Quests.isComplete(q), true);
});

test('killing a bat in the real combat path advances a bat hunt', () => {
  const state = Game.newRun(21);
  state.monsters.length = 0;
  state.quests = [Quests.makeQuest('hunt', 'bat', 1, U.mulberry32(7))];
  const q = state.quests[0];
  q.need = 1;

  const bat = {
    ...Entities.makeMonster('bat', 1, false),
    id: 999, x: state.player.x + 20, y: state.player.y,
    attackT: 9, hitT: 0, lungeT: 0, wanderT: 9, wandA: NaN, aggroed: true, kbx: 0, kby: 0,
  };
  bat.hp = 1;
  state.monsters.push(bat);
  state.player.facing = 0;

  const input = freshInput();
  input.keys.space = true;
  run(state, input, 4);
  assert.equal(state.monsters.length, 0, 'the bat is dead');
  assert.equal(q.count, 1, 'the hunt counted it');
  assert.ok(
    state.events.some((e) => e.type === 'message' && /Quest complete/.test(e.text)),
    'and the sim announced the completion'
  );
});

test('descending the stairs advances a delve', () => {
  let state = Game.newRun(22);
  state.monsters.length = 0;
  state.quests = [Quests.makeQuest('delve', null, 1, U.mulberry32(8))];
  const q = state.quests[0];
  q.need = 2;
  const input = freshInput();
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  state = run(state, input, 3);
  assert.equal(state.floor, 2);
  assert.equal(q.count, 2, 'the delve followed us down');
  assert.equal(Quests.isComplete(q), true);
});

// ---- The board's services ----

test('taking a notice moves it from the board to the charter', () => {
  const state = atBoard(23);
  const offer = state.board[0];
  assert.equal(Game.acceptQuest(state, 0), true);
  assert.equal(state.board[0], null, 'unpinned from the board');
  assert.deepEqual(state.quests, [offer], 'and onto the charter');
  assert.equal(Game.acceptQuest(state, 0), false, 'the empty slot offers nothing');
});

test('the charter holds only so many quests', () => {
  const state = atBoard(24);
  const rng = U.mulberry32(15);
  state.quests = [
    Quests.makeQuest('hunt', 'bat', 1, rng),
    Quests.makeQuest('hunt', 'zombie', 1, rng),
    Quests.makeQuest('hunt', 'brute', 1, rng),
  ];
  assert.equal(state.quests.length, Quests.MAX_ACTIVE, 'full charter (pinned to balance)');
  assert.equal(Game.acceptQuest(state, 0), false, 'no room for another');
  assert.ok(state.board[0], 'the notice stays pinned');
});

test('claiming a finished quest pays gold and experience, and clears the slot', () => {
  const state = atBoard(25);
  Game.acceptQuest(state, 0);
  const q = state.quests[0];
  q.count = q.need;
  state.player.level = 10; // a level far out of reach, so the XP lands as a plain sum
  const goldBefore = state.bag.gold;
  const xpBefore = state.player.xp;

  assert.equal(Game.claimQuest(state, 0), true);
  assert.equal(state.bag.gold, goldBefore + q.reward.gold, 'paid the purse');
  assert.equal(state.player.xp, xpBefore + q.reward.xp, 'paid the experience');
  assert.equal(state.quests.length, 0, 'off the charter');
});

test('an unfinished quest cannot be claimed, and neither can anything away from the board', () => {
  const state = atBoard(26);
  Game.acceptQuest(state, 0);
  const q = state.quests[0];
  q.count = q.need - 1;
  assert.equal(Game.claimQuest(state, 0), false, 'not finished, not paid');
  assert.equal(state.quests.length, 1, 'still on the charter');

  q.count = q.need;
  state.questing = false;
  assert.equal(Game.claimQuest(state, 0), false, 'the board pays; the dungeon does not');
  assert.equal(Game.acceptQuest(state, 1), false, 'and notices are taken at the board too');
});

test('a claim big enough to level the hero levels them', () => {
  const state = atBoard(27);
  Game.acceptQuest(state, 0);
  const q = state.quests[0];
  q.count = q.need;
  q.reward.xp = Entities.xpForLevel(state.player.level) + 5;
  const level = state.player.level;
  assert.equal(Game.claimQuest(state, 0), true);
  assert.equal(state.player.level, level + 1, 'the payout leveled us');
});

test('abandoning tears up the notice and frees the slot', () => {
  const state = atBoard(28);
  Game.acceptQuest(state, 0);
  assert.equal(state.quests.length, 1);
  assert.equal(Game.abandonQuest(state, 0), true);
  assert.equal(state.quests.length, 0, 'slot freed');
  assert.equal(Game.abandonQuest(state, 0), false, 'nothing left to abandon');
});

// ---- Reading the board ----

test('E opens the board, pauses the world, and E closes it again', () => {
  const state = atBoard(29);
  const input = freshInput();
  input.pressed.add('interact');
  let s = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(s.boardOpen, true, 'the notices open');

  // Paused: the clock ticks, but the hero cannot walk away from the board.
  const { x, y } = s.player;
  input.keys.a = true;
  s = run(s, input, 30);
  assert.equal(s.player.x, x, 'the world is paused');
  assert.equal(s.player.y, y);
  assert.equal(s.questing, true, 'and the board stays live while you read');

  input.keys.a = false;
  input.pressed.add('interact');
  s = Game.update(s, input, 1 / 60);
  input.pressed.clear();
  assert.equal(s.boardOpen, false, 'E closes the notices');
});

test('the board only opens in town, and never opens the inventory instead', () => {
  const state = Game.newRun(30);
  state.monsters.length = 0;
  const input = freshInput();
  input.pressed.add('interact');
  const s = Game.update(state, input, 1 / 60);
  assert.equal(s.questing, false, 'no board in the dungeon');
  assert.equal(s.boardOpen, false);
});

test('the trader and the board are never both in reach', () => {
  const t = Dungeon.generateTown(31);
  const gap = Math.hypot(t.board.x - t.vendor.x, t.board.y - t.vendor.y) * TS;
  assert.ok(gap > 85 + 70, `board stands clear of the stall (${Math.round(gap)}px apart)`);
  assert.ok(
    Dungeon.isWalkable(t.grid[t.board.y][t.board.x]),
    'and you can walk up to it'
  );
});

// ---- Persistence ----

test('the charter survives a save round trip; a corrupt one does not break the board', () => {
  const state = atBoard(32);
  Game.acceptQuest(state, 0);
  state.quests[0].count = 1;
  const Save = require('../js/save.js');
  const data = JSON.parse(JSON.stringify(Save.snapshot(state)));

  const restored = Game.fromSave(data);
  assert.equal(restored.quests.length, 1, 'the quest came back');
  assert.deepEqual(restored.quests[0], state.quests[0], 'intact, progress and all');

  const junk = Game.fromSave({ ...data, quests: [null, { kind: 'nonsense' }, { kind: 'hunt' }] });
  assert.deepEqual(junk.quests, [], 'unrecognizable entries are dropped, not crashed on');
});
