// Task 6: the main quest's presentation. The pure derivations (which banner,
// which board line) are asserted directly; the drawing is asserted through the
// real UI.draw path with a text-recording context, the same trick ui.test.js uses.
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Items = require('../js/items.js');
globalThis.Bosses = require('../js/bosses.js');
globalThis.Stats = require('../js/stats.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Game = require('../js/game.js');
globalThis.Render = require('../js/render.js');
globalThis.UI = require('../js/ui.js');
const Bosses = globalThis.Bosses;
const Quests = globalThis.Quests;

const VIEW = { w: 1280, h: 800 };

function makeRecordingCtx(texts) {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') return (s) => texts.push(String(s));
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'canvas') return { width: VIEW.w, height: VIEW.h };
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}
const progressed = (acts) => {
  const mq = Quests.newMain();
  for (let i = 0; i < acts; i++) {
    const a = Bosses.ACTS[i];
    Quests.recordBossKill(mq, Entities.makeBoss(a.bossFloor), a.bossFloor);
  }
  return mq;
};

// ---- pure: the banner ----

test('an act announces itself on its first floor', () => {
  for (const a of Bosses.ACTS) {
    const b = Bosses.bannerFor(a.from, Quests.newMain());
    if (a.from === a.bossFloor) continue; // a one-floor act would name the boss instead
    assert.ok(b && b.includes(a.title), `floor ${a.from} announces "${a.title}" (got ${b})`);
  }
});

test('a boss floor names the boss rather than the act', () => {
  const b = Bosses.bannerFor(4, Quests.newMain());
  assert.ok(b.includes('Gravemaw'), `names the quarry (got ${b})`);
  assert.ok(!b.includes('Act'), 'and does not repeat the act header');
});

test('the mid-act floors stay quiet', () => {
  for (const f of [2, 3, 6, 7, 10, 11]) {
    if (Bosses.isActBossFloor(f)) continue;
    if (Bosses.actForFloor(f).from === f) continue;
    assert.equal(Bosses.bannerFor(f, Quests.newMain()), null, `floor ${f} adds nothing`);
  }
});

test('a boss already slain is not re-announced on a repeat visit', () => {
  assert.ok(Bosses.bannerFor(4, Quests.newMain()), 'announced the first time');
  assert.equal(Bosses.bannerFor(4, progressed(1)), null, 'silent once it is dead');
});

test('the final boss gets its epithet, and floors past 24 get no banner at all', () => {
  const b = Bosses.bannerFor(24, progressed(5));
  assert.ok(b.includes('Duromar') && b.includes('Last Gate'), `the ending is announced (got ${b})`);
  for (const f of [25, 30, 99]) {
    assert.equal(Bosses.bannerFor(f, progressed(6)), null, `floor ${f} has no act to announce`);
  }
});

// ---- pure: the notice board ----

test('the board line reacts to how far the hero has got', () => {
  const first = Bosses.boardLineFor(Quests.newMain());
  const later = Bosses.boardLineFor(progressed(2));
  assert.ok(first.length > 10, 'act I has a rumor');
  assert.notEqual(first, later, 'the board changes as the quest advances');
  assert.ok(later.includes(Bosses.ACTS[2].board), 'it names the current job');
  assert.ok(later.includes(Bosses.ACTS[1].done), 'and credits the last victory');
});

test('a finished main quest gets the closing line, and nothing throws', () => {
  const done = Bosses.boardLineFor(progressed(6));
  assert.ok(done && done.length > 10, 'there is an ending line');
  assert.ok(Bosses.boardLineFor(null).length > 10, 'a missing record still reads');
  assert.ok(Bosses.boardLineFor(undefined).length > 10, 'so does an absent one');
});

// ---- drawn ----

test('the act banner is actually painted on the floor-entry fade', () => {
  const state = Game.newRun(4242);
  state.floor = 3;
  Game._.descend(state); // -> floor 4, the act I boss floor
  assert.ok(state.fade.sub, 'the sim put a banner on the fade');
  state.fade.t = 0.5; // the title card fades in over 0.3s; at t=0 nothing is drawn yet
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(texts.some((t) => t.includes('Gravemaw')), `the banner reached the screen: ${JSON.stringify(texts.slice(0, 8))}`);
});

test('the main quest is drawn in the HUD above the charter', () => {
  const state = Game.newRun(4242);
  state.quests = [];
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(texts.some((t) => /Act I —/.test(t)), 'the main quest shows even with an empty charter');
});

test('a hero who finished the quest sees no main quest entry', () => {
  const state = Game.newRun(4242);
  state.quests = [];
  state.player.mainQuest = progressed(6);
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(!texts.some((t) => /^Act /.test(t)), 'nothing left to show');
});

test('the notice board paints the rumor line', () => {
  const state = Game.newRun(4242);
  state.questing = true;
  state.boardOpen = true; // drawBoard is gated on boardOpen, not questing
  state.board = [];
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  const rumor = Bosses.boardLineFor(state.player.mainQuest);
  assert.ok(texts.some((t) => t === rumor), `the board shows "${rumor}"`);
});

test('the boss bar names the act boss during the fight', () => {
  const state = Game.newRun(4242);
  state.floor = 3;
  Game._.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  state.bossFight = true;
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(texts.some((t) => t.includes('Gravemaw')), 'the boss bar carries the name');
  assert.ok(boss.phases.length > 0, 'and it has pips to draw');
});

test('drawing a mid-telegraph boss does not throw', () => {
  const state = Game.newRun(4242);
  state.floor = 3;
  Game._.descend(state);
  const boss = state.monsters.find((m) => m.boss);
  boss.telegraphT = 0.4;
  boss.telegraph = { x: boss.x, y: boss.y, r: 88 };
  state.bossFight = true;
  const texts = [];
  assert.doesNotThrow(() => UI.draw(makeRecordingCtx(texts), state, VIEW));
  assert.doesNotThrow(() => Render.draw(makeRecordingCtx([]), state, VIEW));
});
