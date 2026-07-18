// Full-pipeline headless test: runs Render.draw + UI.draw against a stub 2D context.
// Catches reference errors / null derefs in every draw path (visuals are checked via
// headless-Chrome screenshots; this guards the code paths).
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.U = require('../js/util.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Items = require('../js/items.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
globalThis.Game = require('../js/game.js');
globalThis.Render = require('../js/render.js');
globalThis.UI = require('../js/ui.js');

const TS = Dungeon.TILE_SIZE;

function makeCtx() {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (typeof t[prop] !== 'undefined') return t[prop];
      const fn = () => {};
      t[prop] = fn;
      return fn;
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

function freshInput() {
  return {
    keys: { w: false, a: false, s: false, d: false, space: false, ctrl: false },
    pressed: new Set(),
    mouse: { x: 0, y: 0, click: false, rclick: false },
  };
}

test('full frame pipeline draws every entity/UI state without crashing', () => {
  const ctx = makeCtx();
  const view = { w: 1280, h: 800 };
  let state = Game.newRun(12);
  const input = freshInput();

  // Surround the player with one of every monster type (+ a champion) so all
  // draw branches run, and scatter one of every ground item kind.
  const p = state.player;
  const types = Object.keys(Entities.MONSTER_TYPES);
  types.forEach((type, i) => {
    const m = {
      ...Entities.makeMonster(type, 3, i === 0),
      x: p.x + 40 + i * 25,
      y: p.y + (i % 2 ? 30 : -30),
      attackT: 0, hitT: 0.1, lungeT: 0.1, wanderT: 1, wandA: 0, aggroed: i % 2 === 0, kbx: 0, kby: 0,
      __gauntlet: true, // draw-coverage props; cleared after the combat phase below
    };
    m.hp = Math.ceil(m.maxHP / 2); // wounded → HP bars draw
    state.monsters.push(m);
  });
  for (const [i, slot] of ['weapon', 'armor', 'ring'].entries()) {
    state.groundItems.push({ kind: 'item', item: Items.makeItem(4, Math.random, { slot }), x: p.x + 20 + i * 18, y: p.y + 50 });
  }
  state.groundItems.push({ kind: 'item', item: Items.makePotion(2, Math.random), x: p.x - 30, y: p.y + 40 });
  state.groundItems.push({ kind: 'gold', amount: 25, x: p.x - 45, y: p.y + 55 });

  // Bag contents for the inventory panel + tooltips.
  Items.addItem(state.bag, Items.makeItem(5, Math.random, { slot: 'weapon', rarity: 'unique' }));
  Items.addItem(state.bag, Items.makeItem(5, Math.random, { slot: 'armor', rarity: 'rare' }));
  Items.addItem(state.bag, Items.makeItem(5, Math.random, { slot: 'ring', rarity: 'magic' }));
  Items.addItem(state.bag, Items.makePotion(3, Math.random));

  const frame = () => {
    state = Game.update(state, input, 1 / 60);
    Game.applyEvents(state, Game.drainEvents(state));
    UI.update(state, input, view);
    Render.draw(ctx, state, view);
    UI.draw(ctx, state, view);
    input.pressed.clear();
    input.mouse.click = false;
    input.mouse.rclick = false;
  };

  // 1) Combat frames: hold space, swing through monsters, potions, pickups.
  input.keys.space = true;
  for (let i = 0; i < 120; i++) frame();
  input.keys.space = false;
  assert.ok(state.kills > 0, 'swinging killed at least one adjacent monster');
  // The manual gauntlet has served its draw purpose (every sprite branch ran
  // above). Clear it so the survival-dependent UI phases below aren't racing a
  // fast rusher's attacks — the real dungeon spawns still populate every draw.
  state.monsters = state.monsters.filter((m) => !m.__gauntlet);

  // 2) Belt potion + heal aura frames.
  state.player.hp = Math.max(1, state.player.hp - 30);
  input.pressed.add('belt0');
  for (let i = 0; i < 30; i++) frame();

  // 3) Inventory open + hover tooltip over the first bag cell and equip slot.
  input.pressed.add('inv');
  frame();
  assert.equal(state.invOpen, true);
  const panelX = (view.w - 660) / 2;
  const panelY = (view.h - 440) / 2 - 14;
  input.mouse.x = panelX + 200 + 26; // first grid cell
  input.mouse.y = panelY + 84 + 26;
  for (let i = 0; i < 10; i++) frame();
  assert.ok(state.hover, 'tooltip hover detected over bag item');
  // CTRL-compare: the equipped counterpart's tooltip draws alongside.
  input.keys.ctrl = true;
  for (let i = 0; i < 5; i++) frame();
  assert.equal(state.hover.compare, true, 'ctrl flags the hover for comparison');
  input.keys.ctrl = false;
  frame();
  assert.equal(state.hover.compare, false, 'released ctrl clears it');
  input.mouse.x = panelX + 40 + 30; // equipped weapon slot
  input.mouse.y = panelY + 76 + 30;
  for (let i = 0; i < 10; i++) frame();
  input.pressed.add('esc');
  frame();
  assert.equal(state.invOpen, false);

  // 4) Floor transition (fade + title card frames).
  state.player.x = (state.dungeon.stairs.x + 0.5) * TS;
  state.player.y = (state.dungeon.stairs.y + 0.5) * TS;
  for (let i = 0; i < 40; i++) frame();
  assert.equal(state.floor, 2);

  // 5) Death + overlay + restart.
  state.player.hp = 0.0001;
  const killer = { ...Entities.makeMonster('brute', 2, false), x: state.player.x + 20, y: state.player.y, attackT: 0, hitT: 0, lungeT: 0, wanderT: 1, wandA: 0, aggroed: true, kbx: 0, kby: 0 };
  state.monsters.push(killer);
  for (let i = 0; i < 120 && !state.dead; i++) frame();
  assert.equal(state.dead, true, 'player died to adjacent brute');
  for (let i = 0; i < 30; i++) frame(); // death overlay frames
  input.pressed.add('restart');
  frame();
  assert.equal(state.dead, false);
  assert.equal(state.floor, 1);
});

test('pipeline covers town, portals, trading, ranged weapons and the dressed player', () => {
  const ctx = makeCtx();
  const view = { w: 1280, h: 800 };
  let state = Game.newRun(77);
  const input = freshInput();
  state.monsters.length = 0;
  const p = state.player;
  const rng = U.mulberry32(99);

  // Full wardrobe with rarity tints.
  for (const slot of ['helmet', 'armor', 'gloves', 'pants', 'boots']) {
    p.equip[slot] = Items.makeItem(3, rng, { slot, rarity: 'rare' });
  }

  const frame = () => {
    state = Game.update(state, input, 1 / 60);
    Game.applyEvents(state, Game.drainEvents(state));
    UI.update(state, input, view);
    Render.draw(ctx, state, view);
    UI.draw(ctx, state, view);
    input.pressed.clear();
    input.mouse.click = false;
    input.mouse.rclick = false;
  };

  // Ranged weapons: wand fireballs, then bow arrows (held-weapon + projectile draws).
  p.equip.weapon = Items.makeItem(2, rng, { slot: 'weapon', kind: 'wand' });
  input.keys.space = true;
  for (let i = 0; i < 40; i++) frame();
  p.equip.weapon = Items.makeItem(2, rng, { slot: 'weapon', kind: 'bow' });
  for (let i = 0; i < 40; i++) frame();
  input.keys.space = false;

  // Cast a portal and step through to town.
  input.pressed.add('portal');
  frame();
  assert.equal(state.portals.length, 1);
  p.x = state.portals[0].x;
  p.y = state.portals[0].y;
  for (let i = 0; i < 90 && !state.inTown; i++) frame();
  assert.equal(state.inTown, true, 'reached town');
  for (let i = 0; i < 10; i++) frame(); // fixtures + return portal frames

  // Trade: shop panel, buy, sell.
  const d = state.dungeon;
  p.x = (d.vendor.x + 0.5) * 32 + 20;
  p.y = (d.vendor.y + 0.5) * 32;
  for (let i = 0; i < 3; i++) frame();
  assert.equal(state.trading, true);
  for (let i = 0; i < 5; i++) frame(); // the "press E to trade" prompt
  input.pressed.add('interact');
  frame();
  assert.equal(state.invOpen, true, 'E opened the stall');
  const panelX = (view.w - 660) / 2;
  const panelY = (view.h - 440) / 2 - 14;
  input.mouse.x = panelX + 24 + 26;
  input.mouse.y = panelY - 108 + 32 + 26;
  for (let i = 0; i < 6; i++) frame();
  assert.ok(state.hover && state.hover.context === 'shop', 'shop tooltip hover');
  state.bag.gold = 100000;
  input.mouse.click = true;
  frame();
  const idx = state.bag.slots.findIndex(Boolean);
  assert.ok(idx !== -1, 'bought the shop item into the bag');
  input.mouse.x = panelX + 200 + (idx % 8) * 55 + 26;
  input.mouse.y = panelY + 84 + Math.floor(idx / 8) * 55 + 26;
  frame();
  const goldBefore = state.bag.gold;
  input.mouse.click = true;
  frame();
  assert.ok(state.bag.gold > goldBefore, 'sold it back for gold');

  input.pressed.add('esc');
  frame();

  // Quest board: read the notices, take one by click, claim it once finished,
  // and abandon another by right-click — every card state draws along the way.
  p.x = (d.board.x + 0.5) * 32;
  p.y = (d.board.y + 0.5) * 32 + 20;
  for (let i = 0; i < 3; i++) frame();
  assert.equal(state.questing, true, 'in reading range');
  for (let i = 0; i < 5; i++) frame(); // the "press E" prompt + pinned parchments
  input.pressed.add('interact');
  frame();
  assert.equal(state.boardOpen, true, 'the notices opened');
  const boardX = (view.w - 640) / 2;
  const boardY = (view.h - 460) / 2 - 8;
  input.mouse.x = boardX + 24 + 40; // first pinned notice
  input.mouse.y = boardY + 92 + 40;
  input.mouse.click = true;
  frame();
  assert.equal(state.quests.length, 1, 'took the notice by click');
  for (let i = 0; i < 5; i++) frame(); // charter card mid-progress + "taken" slot
  state.quests[0].count = state.quests[0].need; // finish it → claim chip + gold bar
  for (let i = 0; i < 5; i++) frame();
  input.mouse.x = boardX + 328 + 40; // the finished quest on the charter
  input.mouse.y = boardY + 92 + 40;
  input.mouse.click = true;
  frame();
  assert.equal(state.quests.length, 0, 'claimed by click');
  input.mouse.x = boardX + 24 + 40;
  input.mouse.y = boardY + 92 + 116 + 40; // second notice
  input.mouse.click = true;
  frame();
  assert.equal(state.quests.length, 1, 'took another');
  input.mouse.x = boardX + 328 + 40;
  input.mouse.y = boardY + 92 + 40;
  input.mouse.rclick = true;
  frame();
  assert.equal(state.quests.length, 0, 'right-click tore it up');
  input.mouse.x = -1;
  input.mouse.y = -1;
  input.pressed.add('interact');
  frame();
  assert.equal(state.boardOpen, false, 'closed the notices');

  // Return home through the portal.
  const ret = state.portals.find((po) => po.kind === 'return');
  p.x = ret.x;
  p.y = ret.y;
  for (let i = 0; i < 90 && state.inTown; i++) frame();
  assert.equal(state.inTown, false, 'returned to the dungeon');

  // Skill tree: open, hover a card, learn by click, draw every card state.
  p.skillPoints = 3;
  input.pressed.add('tree');
  frame();
  assert.equal(state.treeOpen, true);
  const card = (view.w - 700) / 2 + 24; // war column, tier 1 (whirlwind)
  const cardY = (view.h - 480) / 2 - 8 + 92;
  input.mouse.x = card + 30;
  input.mouse.y = cardY + 30;
  frame();
  assert.ok(state.hover && state.hover.skill === 'whirlwind', 'skill tooltip hover');
  input.mouse.click = true;
  frame();
  assert.equal(Skills.rank(p, 'whirlwind'), 1, 'learned by click');
  for (let i = 0; i < 5; i++) frame(); // tree with a learned rank + pips
  input.pressed.add('tree');
  frame();
  assert.equal(state.treeOpen, false);

  // Cast Whirlwind and Fire Nova through the HUD frames (mana orb, cooldown veils).
  p.skillPoints = 1;
  Skills.learn(p, 'nova');
  input.pressed.add('skill0');
  frame();
  assert.ok(p.skillCd.whirlwind > 0, 'whirlwind cast from key');
  input.pressed.add('skill1');
  frame();
  assert.ok(state.projectiles.length >= 12, 'nova ring in flight');
  for (let i = 0; i < 40; i++) frame();
});
