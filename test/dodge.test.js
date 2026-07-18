const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); Game.applyEvents(state, Game.drainEvents(state)); input.pressed.clear(); }
  return state;
}

test('dodge dashes ~120px toward facing when standing still, then cools down', () => {
  let state = Game.newRun(51);
  state.monsters.length = 0;
  state.player.facing = 0;
  const x0 = state.player.x;
  const input = freshInput();
  input.pressed.add('dodge');
  state = run(state, input, 20); // 0.33s > 0.22s roll
  const dx = state.player.x - x0;
  assert.ok(dx > 70 && dx < 200, `dashed right (${Math.round(dx)}px)`);
  assert.ok(state.player.dodgeCdT > 0, 'cooldown armed');
});

test('dodge follows the held movement direction', () => {
  let state = Game.newRun(52);
  state.monsters.length = 0;
  const y0 = state.player.y;
  const input = freshInput();
  input.keys.s = true;
  input.pressed.add('dodge');
  state = run(state, input, 4);
  input.keys.s = false;
  state = run(state, input, 16);
  assert.ok(state.player.y - y0 > 70, `dashed down (${Math.round(state.player.y - y0)}px)`);
});

test('cooldown blocks an immediate second dodge', () => {
  let state = Game.newRun(53);
  state.monsters.length = 0;
  state.player.facing = 0;
  const input = freshInput();
  input.pressed.add('dodge');
  state = run(state, input, 20); // roll done, cd still hot
  const x1 = state.player.x;
  input.pressed.add('dodge');
  state = run(state, input, 10);
  assert.ok(Math.abs(state.player.x - x1) < 20, 'no second dash during cooldown');
});

test('rolling grants i-frames: attacks during the dodge miss', () => {
  const setup = () => {
    let state = Game.newRun(54);
    state.monsters.length = 0;
    const m = { ...Entities.makeMonster('zombie', 1, false), x: state.player.x + 20, y: state.player.y, attackT: 0, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0 };
    state.monsters.push(m);
    state.player.equip.armor = null;
    return state;
  };

  // Control: without dodging, the zombie connects.
  let hitState = setup();
  hitState = run(hitState, freshInput(), 6);
  assert.ok(hitState.player.hp < 100, 'control: undodged attack lands');

  // Dodging through the same attack: unharmed, with a "dodged!" floatie.
  let state = setup();
  const input = freshInput();
  input.pressed.add('dodge');
  state = run(state, input, 6); // still inside the 0.22s roll
  assert.equal(state.player.hp, 100, 'i-frames: no damage while rolling');
  assert.ok(state.floatTexts.some((ft) => /dodge/i.test(ft.text)), 'shows a dodged! floatie');
});

test('you cannot swing mid-roll; the attack key works again after it', () => {
  let state = Game.newRun(55);
  state.monsters.length = 0;
  const input = freshInput();
  input.keys.space = true; // attack held (M key in the browser)
  input.pressed.add('dodge');
  state = Game.update(state, input, 1 / 60);
  input.pressed.clear();
  assert.equal(state.player.swing, null, 'no swing while rolling');
  state = run(state, input, 30); // roll over, attack still held
  assert.ok(state.player.attackT > 0 || state.player.swing, 'attack resumes after the roll');
});
