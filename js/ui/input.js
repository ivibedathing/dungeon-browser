// ui/input.js — UI.update: mouse/keyboard interaction with the HUD, inventory,
// vendor stall, and skill tree. Sets state.hover for the tooltip pass.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;

  UI.update = function (state, input, view) {
    const L = I.layout(view);
    const mx = input.mouse.x;
    const my = input.mouse.y;
    state.hover = null;

    if (input.pressed.has('esc')) {
      state.invOpen = false;
      state.treeOpen = false;
      state.boardOpen = false;
    }
    if (state.dead) return;

    // Quest board: take a notice, claim a finished one, tear up the rest.
    if (state.boardOpen) {
      for (let i = 0; i < L.boardOffers.length; i++) {
        const q = state.board && state.board[i];
        if (!q || !I.inRect(mx, my, L.boardOffers[i])) continue;
        if (input.mouse.click) Game.acceptQuest(state, i);
      }
      for (let i = 0; i < L.boardActive.length; i++) {
        const q = state.quests[i];
        if (!q || !I.inRect(mx, my, L.boardActive[i])) continue;
        if (input.mouse.click && Quests.isComplete(q)) Game.claimQuest(state, i);
        if (input.mouse.rclick) Game.abandonQuest(state, i);
      }
      return;
    }

    // Belt is always live.
    for (let i = 0; i < L.belt.length; i++) {
      if (I.inRect(mx, my, L.belt[i])) {
        if (state.bag.belt[i]) state.hover = { item: state.bag.belt[i], x: mx, y: my, context: 'belt' };
        if (input.mouse.click) Game.useBelt(state, i);
      }
    }

    // Skill bar (F/G/H buttons).
    for (let i = 0; i < L.skillBtns.length; i++) {
      if (I.inRect(mx, my, L.skillBtns[i])) {
        state.hover = { skill: Skills.ACTIVE_ORDER[i], x: mx, y: my };
        if (input.mouse.click && !state.invOpen && !state.treeOpen) Game.castSkill(state, i);
      }
    }

    // Skill tree interactions.
    if (state.treeOpen) {
      for (const id of Object.keys(L.treeCards)) {
        if (!I.inRect(mx, my, L.treeCards[id])) continue;
        state.hover = { skill: id, x: mx, y: my };
        if (input.mouse.click && Skills.learn(state.player, id)) {
          Game.message(state, `Learned ${Skills.SKILLS[id].name} (rank ${Skills.rank(state.player, id)}).`, '#ffd84d');
          Game.sfx(state, 'levelup');
          if (typeof Save !== 'undefined') Save.write(state);
        }
      }
      return;
    }

    if (!state.invOpen) return;

    // Vendor stall (only rendered/interactive while trading in town).
    if (state.trading) {
      for (let i = 0; i < L.shopSlots.length; i++) {
        if (!I.inRect(mx, my, L.shopSlots[i])) continue;
        const entry = state.shop && state.shop[i];
        if (entry) {
          state.hover = { item: entry.item, x: mx, y: my, context: 'shop', price: entry.price };
          if (input.mouse.click) Game.buyShopItem(state, i);
        }
      }
      if (I.inRect(mx, my, L.shopPotion)) {
        const preview = Items.makePotion(Math.max(1, state.floor), Math.random, 'health');
        state.hover = { item: preview, x: mx, y: my, context: 'shopPotion' };
        if (input.mouse.click) Game.buyPotion(state, 'health');
      }
      if (I.inRect(mx, my, L.shopPotionMana)) {
        const preview = Items.makePotion(Math.max(1, state.floor), Math.random, 'mana');
        state.hover = { item: preview, x: mx, y: my, context: 'shopPotion' };
        if (input.mouse.click) Game.buyPotion(state, 'mana');
      }
      for (let i = 0; i < L.shopBuyback.length; i++) {
        if (!I.inRect(mx, my, L.shopBuyback[i])) continue;
        const entry = state.buyback && state.buyback[i];
        if (entry) {
          state.hover = { item: entry.item, x: mx, y: my, context: 'buyback', price: entry.price };
          if (input.mouse.click) Game.buyBack(state, i);
        }
      }
      if (I.inRect(mx, my, L.shopSellAll) && input.mouse.click) Game.sellAll(state);
    }

    for (let i = 0; i < L.grid.length; i++) {
      if (!I.inRect(mx, my, L.grid[i])) continue;
      const item = state.bag.slots[i];
      if (item) state.hover = { item, x: mx, y: my, context: 'bag', compare: !!input.keys.ctrl };
      if (input.mouse.click && item) {
        if (state.trading) Game.sellFromBag(state, i);
        else if (state.smithing && Items.isSmithable(item)) Game.smithUpgrade(state, 'bag', i);
        else Game.bagClick(state, i);
      }
      if (input.mouse.rclick && item) Game.bagDrop(state, i);
    }

    // Potion box: click drinks (sells while trading), right-click drops.
    for (const kind of ['health', 'mana']) {
      const row = L.potionBox[kind];
      for (let i = 0; i < row.length; i++) {
        if (!I.inRect(mx, my, row[i])) continue;
        const potion = state.bag.potions[kind][i];
        if (!potion) continue;
        state.hover = { item: potion, x: mx, y: my, context: 'box' };
        if (input.mouse.click) Game.potionBoxClick(state, kind, i);
        if (input.mouse.rclick) Game.potionBoxDrop(state, kind, i);
      }
    }

    for (const slot of Items.EQUIP_SLOTS) {
      if (!I.inRect(mx, my, L.equip[slot])) continue;
      const item = state.player.equip[slot];
      if (item) state.hover = { item, x: mx, y: my, context: 'equipped' };
      if (input.mouse.click && item) {
        // At the anvil a click hones the piece instead of stripping it off — the
        // ring is the one worn slot Borin won't touch, so it still unequips.
        if (state.smithing && Items.isSmithable(item)) {
          Game.smithUpgrade(state, 'equip', slot);
        } else if (slot !== 'weapon') {
          // Unequip into the bag (weapon stays — you always need something to swing).
          if (state.bag.slots.indexOf(null) !== -1) {
            state.player.equip[slot] = null;
            Items.addItem(state.bag, item);
            Game.message(state, `Unequipped ${item.name}.`, '#9aa');
            const maxHP = Entities.effectiveStats(state.player).maxHP;
            state.player.hp = Math.min(state.player.hp, maxHP);
          } else {
            Game.message(state, 'No room in your inventory.', '#ff5c4d');
          }
        }
      }
    }
  };
})();
