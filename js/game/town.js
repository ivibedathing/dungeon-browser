// game/town.js — leaving and re-entering the dungeon: town portals, waypoints,
// floor descent, and Ashfall Camp services (trading, blacksmith).
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const G = Game._;
  const { TS } = G;

  Game.PORTAL_CD = 15;

  // Fan the whole party around a point (so a party teleport never stacks heroes).
  function placeParty(state, cx, cy) {
    const roster = state.players && state.players.length ? state.players : [state.player];
    roster.forEach((pl, i) => {
      const spread = roster.length > 1 ? 16 : 0;
      const a = (i / Math.max(1, roster.length)) * Math.PI * 2;
      pl.x = cx + Math.cos(a) * spread;
      pl.y = cy + Math.sin(a) * spread;
    });
  }

  G.castPortal = function castPortal(state, p = state.player) {
    if (state.inTown || state.inWorld) {
      // Out on the continent there is nowhere to portal TO: the camp is a place
      // in the world, reached on foot or by waystone.
      G.message(state, 'The portal magic fizzles here — you are already under open sky.', '#8fa8d0');
      return;
    }
    if (state.portalCdT > 0) {
      G.message(state, `The portal is not ready (${Math.ceil(state.portalCdT)}s).`, '#8fa8d0');
      return;
    }
    state.portalCdT = Game.PORTAL_CD;
    let x = p.x + Math.cos(p.facing) * 40;
    let y = p.y + Math.sin(p.facing) * 40;
    if (G.collides(state.dungeon.grid, x, y, 12)) {
      x = p.x;
      y = p.y;
    }
    // Owner-tagged so the UI can show whose gate it is; any player may cast one.
    state.portals = [{ x, y, kind: 'town', armT: 0.5, ownerId: p.id }];
    G.burst(state, x, y, '#7fb8ff', 22, 130);
    G.sfx(state, 'portal');
    G.message(state, 'A shimmering portal to town tears open.', '#7fb8ff');
  };

  function rollShop(state) {
    const stock = [];
    for (let i = 0; i < 3; i++) {
      const item = Items.makeItem(Math.max(1, state.floor), state.srand, { guaranteeMagic: i === 2 });
      stock.push({ item, price: Items.buyPrice(item) });
    }
    return stock;
  }

  G.travel = function travel(state, portal) {
    const p = state.player;
    G.sfx(state, 'travel');
    // A dungeon entered from the overworld portals back to its mouth, not to a
    // separate town level — the camp is a place IN the world now, so the surface
    // is where the shops are. The stash machinery is the same one the town trip
    // has always used; only the level it holds is different.
    if (state.stash && state.stash.overworld) {
      G.leaveMouth(state);
      return;
    }
    if (!state.inTown) {
      state.stash = {
        dungeon: state.dungeon,
        monsters: state.monsters,
        groundItems: state.groundItems,
        explored: state.explored,
        flow: state.flow,
        portalPos: { x: portal.x, y: portal.y },
      };
      const town = Dungeon.generateTown(state.runSeed);
      state.dungeon = town;
      state.monsters = [];
      state.groundItems = [];
      state.projectiles = [];
      state.explored = Array.from({ length: town.height }, () => new Array(town.width).fill(true));
      state.flow = { field: null, t: 0 };
      state.inTown = true;
      state.shop = rollShop(state);
      state.board = Quests.rollBoard(Math.max(1, state.floor), state.srand, state.quests);
      state.portals = [{ x: (town.entry.x + 0.5) * TS, y: (town.entry.y + 0.5) * TS, kind: 'return', armT: 1.0 }];
      // Waypoints: one shortcut portal per naturally-reached milestone floor.
      state.milestones.forEach((wpFloor, i) => {
        const n = state.milestones.length;
        state.portals.push({
          x: (town.entry.x + (i - (n - 1) / 2) * 3 + 0.5) * TS,
          y: (town.entry.y - 5 + 0.5) * TS,
          kind: 'waypoint',
          floor: wpFloor,
          armT: 1.0,
        });
      });
      placeParty(state, (town.entry.x + 0.5) * TS, (town.entry.y + 2.5) * TS);
      state.cam = { x: p.x, y: p.y };
      state.fade = { t: 0, dur: 1.4, label: 'Ashfall Camp' };
      G.message(state, 'You step through into the quiet of Ashfall Camp.', '#c9b37e');
      G.save(state);
    } else if (portal.kind === 'waypoint') {
      // Shortcut jump: the stashed floor is abandoned for a fresh copy of the milestone floor.
      state.floor = portal.floor;
      G.makeFloorState(state);
      G.questDepth(state);
      G.message(state, `The waypoint carries you to floor ${state.floor}.`, '#7fb8ff');
      G.save(state);
    } else {
      const st = state.stash;
      state.dungeon = st.dungeon;
      state.monsters = st.monsters;
      state.groundItems = st.groundItems;
      state.explored = st.explored;
      state.flow = st.flow;
      state.projectiles = [];
      state.inTown = false;
      state.trading = false;
      state.stash = null;
      state.portals = [];
      placeParty(state, st.portalPos.x, st.portalPos.y);
      state.cam = { x: p.x, y: p.y };
      state.fade = { t: 0, dur: 1.4, label: `Floor ${state.floor}` };
      G.message(state, 'The portal snaps shut behind you.', '#7fb8ff');
    }
  };

  G.descend = function descend(state) {
    state.floor++;
    for (const pl of state.players) Stats.bump(pl, 'floors');
    G.makeFloorState(state);
    G.questDepth(state);
    G.message(state, `You descend to floor ${state.floor}. The air grows heavier...`, '#c9b37e');
    if (state.floor % 5 === 0 && !state.milestones.includes(state.floor)) {
      state.milestones.push(state.floor);
      // Inside a mouth there is no town level to hang a waypoint portal in — the
      // mouth itself remembers your depth and drops you back here next time. Say
      // that, rather than promising a portal that will never appear.
      G.message(
        state,
        state.stash && state.stash.overworld
          ? `Floor ${state.floor} marked — this mouth will remember how deep you got.`
          : `A waypoint to floor ${state.floor} shimmers into Ashfall Camp.`,
        '#7fb8ff'
      );
    }
    G.sfx(state, 'stairs');
    if (typeof Save !== 'undefined') Save.updateRecords(state);
    G.save(state);
  };

  // ---- Trading ----

  Game.buyPotion = function (state, kind) {
    const potion = Items.makePotion(Math.max(1, state.floor), state.srand, kind || 'health');
    const price = Items.buyPrice(potion);
    if (state.bag.gold < price) {
      G.message(state, `You need ${price} gold for a ${potion.name}.`, '#ff5c4d');
      return false;
    }
    if (!Items.addItem(state.bag, potion)) {
      G.message(state, 'You have nowhere to put it.', '#ff5c4d');
      return false;
    }
    state.bag.gold -= price;
    G.sfx(state, 'gold');
    G.message(state, `Bought ${potion.name} for ${price} gold.`, '#ffd84d');
    return true;
  };

  // Every sale lands on the buy-back shelf (newest first) so mis-sells are
  // recoverable at exactly the price paid. Session-only: not written to saves.
  Game.BUYBACK_SIZE = 3;

  function stockBuyback(state, item, price) {
    state.buyback.unshift({ item, price });
    if (state.buyback.length > Game.BUYBACK_SIZE) state.buyback.length = Game.BUYBACK_SIZE;
  }
  G.stockBuyback = stockBuyback; // potion-box sales stock the shelf too

  Game.sellFromBag = function (state, index) {
    if (!state.trading) return false;
    const item = state.bag.slots[index];
    if (!item) return false;
    state.bag.slots[index] = null;
    const price = Items.sellPrice(item);
    state.bag.gold += price;
    stockBuyback(state, item, price);
    G.sfx(state, 'gold');
    G.message(state, `Sold ${item.name} for ${price} gold.`, '#ffd84d');
    return true;
  };

  // Liquidate the whole loot haul. Potions stay: bag potions are the belt's
  // refill reserve (Items.refillBelt), so "sell all" must never drain healing.
  Game.sellAll = function (state) {
    if (!state.trading) return false;
    let count = 0;
    let total = 0;
    for (let i = 0; i < state.bag.slots.length; i++) {
      const item = state.bag.slots[i];
      if (!item || item.slot === 'potion') continue;
      state.bag.slots[i] = null;
      const price = Items.sellPrice(item);
      total += price;
      count++;
      stockBuyback(state, item, price);
    }
    if (!count) {
      G.message(state, 'Nothing to sell — potions stay in your bag.', '#9aa');
      return false;
    }
    state.bag.gold += total;
    G.sfx(state, 'gold');
    G.message(state, `Sold ${count} item${count > 1 ? 's' : ''} for ${total} gold (potions kept).`, '#ffd84d');
    return true;
  };

  Game.buyBack = function (state, index) {
    if (!state.trading) return false;
    const entry = state.buyback[index];
    if (!entry) return false;
    if (state.bag.gold < entry.price) {
      G.message(state, `Not enough gold (${entry.price} needed).`, '#ff5c4d');
      return false;
    }
    if (!Items.addItem(state.bag, entry.item)) {
      G.message(state, 'Your bag is full.', '#ff5c4d');
      return false;
    }
    state.bag.gold -= entry.price;
    state.buyback.splice(index, 1);
    G.sfx(state, 'gold');
    G.message(state, `Bought back ${Items.displayName(entry.item)} for ${entry.price} gold.`, '#ffd84d');
    return true;
  };

  Game.buyShopItem = function (state, index) {
    if (!state.trading || !state.shop) return false;
    const entry = state.shop[index];
    if (!entry) return false;
    if (state.bag.gold < entry.price) {
      G.message(state, `Not enough gold (${entry.price} needed).`, '#ff5c4d');
      return false;
    }
    if (!Items.addItem(state.bag, entry.item)) {
      G.message(state, 'Your bag is full.', '#ff5c4d');
      return false;
    }
    state.bag.gold -= entry.price;
    state.shop[index] = null;
    G.sfx(state, 'gold');
    G.message(state, `Bought ${entry.item.name} for ${entry.price} gold.`, '#ffd84d');
    return true;
  };

  // ---- Blacksmith ----

  Game.smithUpgrade = function (state, source, key) {
    if (!state.smithing) return false;
    const item = source === 'bag' ? state.bag.slots[key] : state.player.equip[key];
    if (!Items.isSmithable(item)) return false;
    if ((item.plus || 0) >= Items.MAX_PLUS) {
      G.message(state, `${Items.displayName(item)} cannot be honed any further.`, '#9aa');
      return false;
    }
    const cost = Items.upgradeCost(item);
    if (state.bag.gold < cost) {
      G.message(state, `Borin needs ${cost} gold to work on ${Items.displayName(item)}.`, '#ff5c4d');
      G.sfx(state, 'error');
      return false;
    }
    state.bag.gold -= cost;
    Items.upgradeItem(item);
    G.message(state, `${Items.displayName(item)} rings true on the anvil!`, '#ffd84d');
    G.sfx(state, 'anvil');
    G.burst(state, state.player.x, state.player.y - 10, '#ffd84d', 10, 90);
    G.save(state);
    return true;
  };

  Game.upgradeEquipped = (state) => Game.smithUpgrade(state, 'equip', 'weapon');

  // ---- Quest board ----

  // Run every active quest through `step`, announcing each completion once. The
  // sim calls this from wherever quest-worthy things happen (kills, descents);
  // only the board itself pays out.
  G.questProgress = function questProgress(state, step) {
    for (const q of state.quests || []) {
      const was = Quests.isComplete(q);
      if (!step(q) || was || !Quests.isComplete(q)) continue;
      G.message(state, `Quest complete: ${q.title} — claim it at the notice board.`, '#ffd84d');
      G.sfx(state, 'levelup');
    }
  };

  G.questDepth = (state) => G.questProgress(state, (q) => Quests.recordDepth(q, state.floor));

  Game.acceptQuest = function (state, index) {
    if (!state.questing || !state.board) return false;
    const q = state.board[index];
    if (!q) return false;
    if (state.quests.length >= Quests.MAX_ACTIVE) {
      G.message(state, `Your charter is full — ${Quests.MAX_ACTIVE} quests at a time.`, '#ff5c4d');
      G.sfx(state, 'error');
      return false;
    }
    state.board[index] = null;
    state.quests.push(q);
    G.message(state, `Quest taken — ${q.title}: ${q.desc}`, '#c9b37e');
    G.sfx(state, 'gold');
    G.save(state);
    return true;
  };

  Game.claimQuest = function (state, index) {
    if (!state.questing) return false;
    const q = state.quests[index];
    if (!q || !Quests.isComplete(q)) return false;
    const p = state.player;
    state.quests.splice(index, 1);
    state.bag.gold += q.reward.gold;
    Stats.bump(p, 'quests');
    Stats.bump(p, 'gold', q.reward.gold);
    G.message(state, `${q.title} — paid ${q.reward.gold} gold and ${q.reward.xp} experience.`, '#ffd84d');
    G.floatText(state, p.x, p.y - 30, `+${q.reward.gold} gold`, '#ffd84d', 14);
    G.burst(state, p.x, p.y, '#ffd84d', 18, 120);
    G.sfx(state, 'gold');
    if (Entities.gainXP(p, q.reward.xp) > 0) {
      G.floatText(state, p.x, p.y - 48, 'LEVEL UP!', '#ffd84d', 22);
      G.message(state, `You are now level ${p.level}.`, '#ffd84d');
      G.sfx(state, 'levelup');
      if (typeof Save !== 'undefined') Save.updateRecords(state);
    }
    G.save(state);
    return true;
  };

  // Tearing up a notice frees a charter slot; the work done on it is lost.
  Game.abandonQuest = function (state, index) {
    if (!state.questing) return false;
    const q = state.quests[index];
    if (!q) return false;
    state.quests.splice(index, 1);
    G.message(state, `Abandoned ${q.title}.`, '#9aa');
    G.save(state);
    return true;
  };
})();
