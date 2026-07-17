// Headless UI checks: weapon-tooltip lines per weapon kind (through the real
// UI.draw path with a text-recording context) and HUD layout geometry.
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

const VIEW = { w: 1280, h: 800 };

function makeRecordingCtx(texts) {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') return (s) => texts.push(String(s));
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

function drawnTexts(item, context) {
  const state = Game.newRun(42);
  state.invOpen = true;
  state.hover = { item, x: 400, y: 300, context: context || 'bag' };
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  return texts;
}

test('melee weapon tooltip shows its swing radius', () => {
  const item = Items.makeItem(1, U.mulberry32(5), { slot: 'weapon', kind: 'melee' });
  const texts = drawnTexts(item);
  assert.ok(texts.includes(`Radius ${item.stats.radius}`), `expected "Radius ${item.stats.radius}" in ${JSON.stringify(texts)}`);
});

test('starter weapon (no kind field) still counts as melee in the tooltip', () => {
  const item = Entities.starterWeapon();
  const texts = drawnTexts(item, 'equipped');
  assert.ok(texts.includes(`Radius ${item.stats.radius}`), 'starter sword keeps its Radius line');
});

test('wand tooltip shows blast radius, never "Radius undefined"', () => {
  const item = Items.makeItem(1, U.mulberry32(6), { slot: 'weapon', kind: 'wand' });
  assert.equal(item.kind, 'wand');
  const texts = drawnTexts(item);
  assert.ok(!texts.some((s) => s.includes('undefined')), `undefined leaked into ${JSON.stringify(texts.filter((s) => s.includes('undefined')))}`);
  assert.ok(texts.includes(`Blast radius ${item.stats.aoe}`), 'wand shows its explosion radius');
});

test('bow tooltip has no radius line at all', () => {
  const item = Items.makeItem(1, U.mulberry32(7), { slot: 'weapon', kind: 'bow' });
  assert.equal(item.kind, 'bow');
  const texts = drawnTexts(item);
  assert.ok(!texts.some((s) => s.includes('undefined')), 'no undefined in bow tooltip');
  assert.ok(!texts.some((s) => /^(Blast )?[Rr]adius\b/.test(s)), 'no swing/blast radius line for bows');
});

test('HUD: skill bar is centered with the XP bar tucked under it, clear of the gold readout', () => {
  const L = UI._.layout(VIEW);
  const first = L.skillBtns[0];
  const last = L.skillBtns[L.skillBtns.length - 1];
  const barCenter = (first.x + last.x + last.w) / 2;
  assert.ok(Math.abs(barCenter - VIEW.w / 2) <= 1, `skill bar centered (center ${barCenter})`);
  const xpCenter = L.xp.x + L.xp.w / 2;
  assert.ok(Math.abs(xpCenter - VIEW.w / 2) <= 1, `xp bar centered (center ${xpCenter})`);
  assert.ok(L.xp.y > first.y + first.h, 'xp bar sits below the skill buttons');
  assert.ok(L.xp.x + L.xp.w < L.belt[0].x, 'xp bar stays clear of the belt/gold column');
});

test('shop layout reserves buy-back slots and a sell-all button inside the strip', () => {
  const L = UI._.layout(VIEW);
  assert.equal(L.shopBuyback.length, Game.BUYBACK_SIZE);
  const within = (r, p) => r.x >= p.x && r.x + r.w <= p.x + p.w && r.y >= p.y && r.y + r.h <= p.y + p.h;
  for (const r of L.shopBuyback) assert.ok(within(r, L.shopPanel), 'shelf slot inside the shop strip');
  assert.ok(within(L.shopSellAll, L.shopPanel), 'sell-all button inside the shop strip');
  const barrel = L.shopPotionMana;
  assert.ok(L.shopBuyback[0].x > barrel.x + barrel.w, 'shelf sits right of the potion barrels');
  const lastSlot = L.shopBuyback[L.shopBuyback.length - 1];
  assert.ok(L.shopSellAll.x >= lastSlot.x + lastSlot.w, 'button clear of the shelf');
});

test('the shop strip draws the buy-back shelf and sell-all button, with a buy-back tooltip', () => {
  const item = Items.makeItem(2, U.mulberry32(21), { slot: 'armor' });
  const state = Game.newRun(42);
  state.invOpen = true;
  state.trading = true;
  state.buyback = [{ item, price: 42 }];
  state.hover = { item, x: 400, y: 300, context: 'buyback', price: 42 };
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(texts.some((s) => /BUY BACK/i.test(s)), 'shelf caption drawn');
  assert.ok(texts.some((s) => /SELL ALL/i.test(s)), 'sell-all button drawn');
  assert.ok(texts.includes('Buy back for 42 gold'), 'buy-back tooltip line');
});

test('inventory layout reserves a two-row potion box in the left column', () => {
  const L = UI._.layout(VIEW);
  assert.equal(L.potionBox.health.length, Items.POTION_BOX_SIZE);
  assert.equal(L.potionBox.mana.length, Items.POTION_BOX_SIZE);
  const within = (r, p) => r.x >= p.x && r.x + r.w <= p.x + p.w && r.y >= p.y && r.y + r.h <= p.y + p.h;
  for (const row of [L.potionBox.health, L.potionBox.mana]) {
    for (const r of row) {
      assert.ok(within(r, L.panel), 'box slot inside the inventory panel');
      assert.ok(r.x + r.w < L.grid[0].x, 'box stays left of the bag grid');
    }
  }
  const boots = L.equip.boots;
  assert.ok(L.potionBox.health[0].y > boots.y + boots.h, 'box sits under the paper-doll');
  assert.ok(L.potionBox.mana[0].y > L.potionBox.health[0].y, 'mana row under the healing row');
});

test('the inventory draws the potion box with counts, and box tooltips offer a drink', () => {
  const state = Game.newRun(43);
  const r = U.mulberry32(31);
  state.bag.potions.health.push(Items.makePotion(1, r, 'health'), Items.makePotion(1, r, 'health'));
  state.bag.potions.mana.push(Items.makePotion(1, r, 'mana'));
  state.invOpen = true;
  state.hover = { item: state.bag.potions.health[0], x: 400, y: 500, context: 'box' };
  const texts = [];
  UI.draw(makeRecordingCtx(texts), state, VIEW);
  assert.ok(texts.some((s) => /POTION BOX/i.test(s)), 'box caption drawn');
  assert.ok(texts.includes('2/5'), 'healing count drawn');
  assert.ok(texts.includes('1/5'), 'mana count drawn');
  assert.ok(texts.includes('Click to drink'), 'drink hint in tooltip');
});
