// game/inventory.js — item pickups, potions, and bag/equip actions.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { PICKUP_RANGE } = G;

  // A player may only claim unowned (shared/solo) loot or its own instanced drops.
  G.canClaim = (g, p) => g.ownerId == null || g.ownerId === p.id;

  G.tryPickup = function tryPickup(state, p = state.player) {
    let best = null;
    let bestD = PICKUP_RANGE * PICKUP_RANGE;
    for (const g of state.groundItems) {
      if (g.kind !== 'item') continue;
      if (!G.canClaim(g, p)) continue;
      const d = U.dist2(p.x, p.y, g.x, g.y);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best) return;
    if (Items.addItem(p.bag, best.item)) {
      state.groundItems.splice(state.groundItems.indexOf(best), 1);
      G.message(state, `Picked up ${best.item.name}.`, best.item.color);
      G.floatText(state, p.x, p.y - 26, best.item.name, best.item.color, 13);
      G.sfx(state, 'pickup');
    } else {
      G.message(state, best.item.slot === 'potion' ? 'Your potion box is full.' : 'Your inventory is full.', '#ff5c4d');
      G.sfx(state, 'error');
    }
  };

  function applyPotion(state, potion) {
    const p = state.player;
    const stats = Entities.effectiveStats(p);
    if (potion.kind === 'mana') {
      p.mana = Math.min(stats.maxMana, (p.mana || 0) + potion.mana);
      G.burst(state, p.x, p.y, '#5b8ee8', 10, 80);
      G.floatText(state, p.x, p.y - 26, potion.name, '#8fb4ff', 13);
    } else {
      p.healPool += potion.heal;
      p.healRate = potion.heal / 1.2;
      G.burst(state, p.x, p.y, '#e5534b', 10, 80);
      G.floatText(state, p.x, p.y - 26, potion.name, '#ff8d85', 13);
      if (p.hp >= stats.maxHP) G.message(state, 'You are already at full health.', '#9aa');
    }
    G.sfx(state, 'drink');
  }

  Game.useBelt = function (state, i) {
    if (state.dead) return;
    const potion = Items.useBeltPotion(state.bag, i);
    if (!potion) return;
    applyPotion(state, potion);
  };

  Game.bagClick = function (state, index) {
    const item = state.bag.slots[index];
    if (!item) return;
    if (item.slot === 'potion') {
      state.bag.slots[index] = null;
      applyPotion(state, item);
      G.message(state, `Drank ${item.name}.`, item.kind === 'mana' ? '#8fb4ff' : '#ff8d85');
    } else {
      Items.equipFromBag(state.player, state.bag, index);
      G.message(state, `Equipped ${item.name}.`, item.color);
      const maxHP = Entities.effectiveStats(state.player).maxHP;
      state.player.hp = Math.min(state.player.hp, maxHP);
      G.sfx(state, 'equip');
    }
  };

  Game.bagDrop = function (state, index) {
    const item = Items.removeItem(state.bag, index);
    if (!item) return;
    const p = state.player;
    const a = state.srand() * Math.PI * 2;
    state.groundItems.push({ id: state.nextId++, kind: 'item', item, x: p.x + Math.cos(a) * 24, y: p.y + Math.sin(a) * 24 });
    G.message(state, `Dropped ${item.name}.`, '#9aa');
    G.sfx(state, 'drop');
  };

  // ---- Potion box ----

  // Click: drink — or sell to the vendor while trading (stocks the buy-back
  // shelf like any sale). Right-click: drop.
  Game.potionBoxClick = function (state, kind, index) {
    const row = Items.potionRow(state.bag, kind);
    const potion = row[index];
    if (!potion) return false;
    if (state.trading) {
      row.splice(index, 1);
      const price = Items.sellPrice(potion);
      state.bag.gold += price;
      G.stockBuyback(state, potion, price);
      G.sfx(state, 'gold');
      G.message(state, `Sold ${potion.name} for ${price} gold.`, '#ffd84d');
      return true;
    }
    row.splice(index, 1);
    applyPotion(state, potion);
    G.message(state, `Drank ${potion.name}.`, potion.kind === 'mana' ? '#8fb4ff' : '#ff8d85');
    return true;
  };

  Game.potionBoxDrop = function (state, kind, index) {
    const row = Items.potionRow(state.bag, kind);
    const potion = row[index];
    if (!potion) return false;
    row.splice(index, 1);
    const p = state.player;
    const a = state.srand() * Math.PI * 2;
    state.groundItems.push({ id: state.nextId++, kind: 'item', item: potion, x: p.x + Math.cos(a) * 24, y: p.y + Math.sin(a) * 24 });
    G.message(state, `Dropped ${potion.name}.`, '#9aa');
    G.sfx(state, 'drop');
    return true;
  };
})();
