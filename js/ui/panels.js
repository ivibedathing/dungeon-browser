// ui/panels.js — the pausing overlays: inventory (paper-doll, grid, character
// stats), Grizzle's vendor stall, and the skill tree.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS, BRANCH_COLORS } = I;

  function statLines(state) {
    const s = Entities.effectiveStats(state.player);
    const lines = [
      ['Damage', `${Math.round(s.damage)}`],
      ['Attack Speed', `${s.speed.toFixed(1)}/s`],
      ['Swing Radius', `${Math.round(s.radius)}`],
      ['Defense', `${s.defense}`],
      ['Mana', `${Math.round(s.maxMana)}`],
      ['Mana Regen', `${s.manaRegen.toFixed(1)}/s`],
    ];
    if (s.lifePerKill) lines.push(['Life per Kill', `+${s.lifePerKill}`]);
    if (s.xpMult > 1) lines.push(['Experience', `+${Math.round((s.xpMult - 1) * 100)}%`]);
    if (Math.abs(s.moveMult - 1) > 0.001) {
      const pct = Math.round((s.moveMult - 1) * 100);
      lines.push(['Move Speed', `${pct > 0 ? '+' : ''}${pct}%`]);
    }
    return lines;
  }

  I.drawInventory = function drawInventory(ctx, state, view, L) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.96);

    ctx.font = `bold 22px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.textAlign = 'center';
    ctx.fillText('Inventory', L.panel.x + L.panel.w / 2, L.panel.y + 36);
    ctx.textAlign = 'left';

    // Equipment slots (paper-doll).
    const labels = { weapon: 'WEAPON', helmet: 'HEAD', armor: 'CHEST', gloves: 'HANDS', pants: 'LEGS', boots: 'FEET', ring: 'RING' };
    for (const slot of Items.EQUIP_SLOTS) {
      const r = L.equip[slot];
      ctx.fillStyle = '#1d1712';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const item = state.player.equip[slot];
      ctx.strokeStyle = item ? item.color : '#3a2f26';
      ctx.lineWidth = item && item.rarity !== 'common' ? 2 : 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (item) {
        Render.drawItemIcon(ctx, item, r.x + r.w / 2, r.y + r.h / 2, 1.5);
      } else {
        ctx.fillStyle = 'rgba(200,180,150,0.15)';
        ctx.font = `9px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(labels[slot].toLowerCase(), r.x + r.w / 2, r.y + r.h / 2 + 3);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = '#8a795c';
      ctx.font = `bold 9px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(labels[slot], r.x + r.w / 2, r.y + r.h + 12);
      ctx.textAlign = 'left';
    }

    // Potion box: belt overflow lives here, one row per kind.
    ctx.font = `bold 9px ${SANS}`;
    ctx.fillStyle = '#8a795c';
    ctx.fillText('POTION BOX', L.potionBox.health[0].x, L.potionBox.health[0].y - 6);
    const boxRows = [
      { key: 'health', tint: 'rgba(200,53,59,0.5)', countColor: '#e5807a' },
      { key: 'mana', tint: 'rgba(74,157,224,0.5)', countColor: '#7fa8ff' },
    ];
    for (const row of boxRows) {
      const rects = L.potionBox[row.key];
      const stock = state.bag.potions[row.key];
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const potion = stock[i];
        ctx.fillStyle = '#1d1712';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = potion ? 'rgba(120,100,70,0.7)' : '#332a22';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        if (potion) {
          Render.drawItemIcon(ctx, potion, r.x + r.w / 2, r.y + r.h / 2 + 1, 0.85);
        } else {
          ctx.fillStyle = row.tint;
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const last = rects[rects.length - 1];
      ctx.font = `bold 9px ${SANS}`;
      ctx.fillStyle = row.countColor;
      ctx.fillText(`${stock.length}/${Items.POTION_BOX_SIZE}`, last.x + last.w + 6, last.y + 15);
    }

    // Grid.
    for (let i = 0; i < L.grid.length; i++) {
      const r = L.grid[i];
      const item = state.bag.slots[i];
      ctx.fillStyle = '#1d1712';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = item ? 'rgba(120,100,70,0.7)' : '#332a22';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (item) {
        Render.drawItemIcon(ctx, item, r.x + r.w / 2, r.y + r.h / 2, 1.35);
        if (item.rarity && item.rarity !== 'common') {
          ctx.fillStyle = item.color;
          ctx.fillRect(r.x + r.w - 7, r.y + 3, 4, 4);
        }
      }
      if (state.hover && state.hover.context === 'bag' && state.bag.slots[i] === state.hover.item) {
        ctx.strokeStyle = '#d9c06a';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
    }

    // Character stats: two columns under the grid.
    ctx.font = `bold 12px ${SERIF}`;
    ctx.fillStyle = '#c9a15a';
    ctx.fillText((state.player.name || 'CHARACTER').toUpperCase(), L.panel.x + 210, L.panel.y + 292);
    ctx.font = `11px ${SANS}`;
    const lines = statLines(state);
    for (let i = 0; i < lines.length; i++) {
      const colX = L.panel.x + 210 + (i % 2) * 215;
      const sy = L.panel.y + 312 + Math.floor(i / 2) * 17;
      ctx.fillStyle = 'rgba(215,200,175,0.75)';
      ctx.fillText(lines[i][0], colX, sy);
      ctx.fillStyle = '#efe6d2';
      ctx.textAlign = 'right';
      ctx.fillText(lines[i][1], colX + 175, sy);
      ctx.textAlign = 'left';
    }

    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(200,180,150,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(
      state.trading
        ? 'Click your item: SELL · Right-click: drop · hold CTRL: compare · I or ESC: close'
        : 'Click: equip / drink · Right-click: drop · hold CTRL: compare · I or ESC: close',
      L.panel.x + 200 + 218,
      L.panel.y + L.panel.h - 16
    );
    ctx.textAlign = 'left';
  };

  I.drawShop = function drawShop(ctx, state, L) {
    const sp = L.shopPanel;
    I.panelBg(ctx, sp, 0.96);
    ctx.font = `bold 15px ${SERIF}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText("GRIZZLE'S GOODS", sp.x + 24, sp.y + 22);

    for (let i = 0; i < L.shopSlots.length; i++) {
      const r = L.shopSlots[i];
      const entry = state.shop && state.shop[i];
      ctx.fillStyle = '#1d1712';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = entry ? entry.item.color : '#332a22';
      ctx.lineWidth = entry && entry.item.rarity !== 'common' ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.textAlign = 'center';
      if (entry) {
        Render.drawItemIcon(ctx, entry.item, r.x + r.w / 2, r.y + r.h / 2, 1.35);
        ctx.font = `bold 10px ${SANS}`;
        ctx.fillStyle = '#ffd84d';
        ctx.fillText(`${entry.price}g`, r.x + r.w / 2, r.y + r.h + 12);
      } else {
        ctx.font = `9px ${SANS}`;
        ctx.fillStyle = 'rgba(200,180,150,0.3)';
        ctx.fillText('sold', r.x + r.w / 2, r.y + r.h / 2 + 3);
      }
      ctx.textAlign = 'left';
    }

    // Bottomless potion barrels (health and mana).
    ctx.fillStyle = 'rgba(200,160,90,0.25)';
    ctx.fillRect(L.shopPotion.x - 21, L.shopPotion.y, 1, L.shopPotion.h);
    const barrels = [
      { rect: L.shopPotion, kind: 'health' },
      { rect: L.shopPotionMana, kind: 'mana' },
    ];
    for (const b of barrels) {
      const pr = b.rect;
      ctx.fillStyle = '#1d1712';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = '#4a3b28';
      ctx.lineWidth = 1;
      ctx.strokeRect(pr.x + 0.5, pr.y + 0.5, pr.w - 1, pr.h - 1);
      const potion = Items.makePotion(Math.max(1, state.floor), Math.random, b.kind);
      Render.drawItemIcon(ctx, potion, pr.x + pr.w / 2, pr.y + pr.h / 2, 1.35);
      ctx.textAlign = 'center';
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = '#ffd84d';
      ctx.fillText(`${Items.buyPrice(potion)}g`, pr.x + pr.w / 2, pr.y + pr.h + 12);
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = 'rgba(215,200,175,0.55)';
      ctx.fillText(b.kind === 'mana' ? 'mana' : 'healing', pr.x + pr.w / 2, pr.y - 6);
      ctx.textAlign = 'left';
    }

    // Buy-back shelf: the last few sales, recoverable at the price paid.
    const shelf = L.shopBuyback;
    ctx.fillStyle = 'rgba(200,160,90,0.25)';
    ctx.fillRect(shelf[0].x - 17, shelf[0].y, 1, shelf[0].h);
    ctx.textAlign = 'center';
    ctx.font = `9px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.55)';
    ctx.fillText('BUY BACK', (shelf[0].x + shelf[shelf.length - 1].x + shelf[0].w) / 2, shelf[0].y - 6);
    for (let i = 0; i < shelf.length; i++) {
      const r = shelf[i];
      const entry = state.buyback && state.buyback[i];
      ctx.fillStyle = '#1d1712';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = entry ? entry.item.color : '#332a22';
      ctx.lineWidth = entry && entry.item.rarity !== 'common' ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (entry) {
        Render.drawItemIcon(ctx, entry.item, r.x + r.w / 2, r.y + r.h / 2, 1.35);
        ctx.font = `bold 10px ${SANS}`;
        ctx.fillStyle = '#ffd84d';
        ctx.fillText(`${entry.price}g`, r.x + r.w / 2, r.y + r.h + 12);
        ctx.font = `9px ${SANS}`;
      }
    }

    // Sell-all button, price-tagged with the haul's total value.
    const sa = L.shopSellAll;
    let haul = 0;
    for (const it of state.bag.slots) {
      if (it && it.slot !== 'potion') haul += Items.sellPrice(it);
    }
    ctx.fillStyle = haul ? '#241a10' : '#1a1410';
    ctx.fillRect(sa.x, sa.y, sa.w, sa.h);
    ctx.strokeStyle = haul ? '#c9a15a' : '#3a2f26';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sa.x + 0.5, sa.y + 0.5, sa.w - 1, sa.h - 1);
    ctx.font = `bold 8px ${SANS}`;
    ctx.fillStyle = haul ? '#ffd84d' : '#8a795c';
    ctx.fillText('SELL ALL', sa.x + sa.w / 2, sa.y + sa.h / 2 + 3);
    if (haul) {
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = '#ffd84d';
      ctx.fillText(`${haul}g`, sa.x + sa.w / 2, sa.y + sa.h + 12);
    }
    ctx.textAlign = 'left';
  };

  // One notice: title, the ask, a progress bar, and what it pays. Offers show
  // what the work is worth; charter entries show how far along you are.
  function questCard(ctx, state, r, q, active) {
    const complete = active && Quests.isComplete(q);
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (complete) {
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 5);
      ctx.strokeStyle = `rgba(255,216,77,${0.45 + pulse * 0.4})`;
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = active ? '#5d4a2c' : '#332a22';
      ctx.lineWidth = 1;
    }
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = `bold 13px ${SANS}`;
    ctx.fillStyle = complete ? '#ffd84d' : '#e8dfc8';
    ctx.fillText(q.title, r.x + 12, r.y + 21);

    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.7)';
    const descLines = I.wrapText(ctx, q.desc, r.w - 24);
    for (let i = 0; i < Math.min(2, descLines.length); i++) {
      ctx.fillText(descLines[i], r.x + 12, r.y + 38 + i * 13);
    }

    if (active) {
      const bw = r.w - 24;
      ctx.fillStyle = '#241a10';
      ctx.fillRect(r.x + 12, r.y + 68, bw, 8);
      ctx.fillStyle = complete ? '#8fe89a' : '#c9a15a';
      ctx.fillRect(r.x + 12, r.y + 68, bw * Quests.fraction(q), 8);
      ctx.strokeStyle = 'rgba(140,120,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 12.5, r.y + 68.5, bw - 1, 7);
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = complete ? '#8fe89a' : 'rgba(215,200,175,0.8)';
      ctx.fillText(Quests.progressText(q), r.x + 12, r.y + 92);
    }

    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#ffd84d';
    ctx.textAlign = 'right';
    ctx.fillText(`${q.reward.gold}g · ${q.reward.xp} xp`, r.x + r.w - 12, r.y + 92);
    ctx.textAlign = 'left';

    if (!active) {
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = 'rgba(200,180,150,0.45)';
      ctx.fillText('click to take', r.x + 12, r.y + 92);
    } else if (complete) {
      ctx.font = `bold 9px ${SANS}`;
      ctx.fillStyle = '#8fe89a';
      ctx.textAlign = 'center';
      ctx.fillText('CLAIM', r.x + r.w / 2, r.y + 92);
      ctx.textAlign = 'left';
    }
  }

  I.drawBoard = function drawBoard(ctx, state, view, L) {
    const bp = L.boardPanel;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, bp, 0.96);

    ctx.font = `bold 22px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.textAlign = 'center';
    ctx.fillText('Notice Board', bp.x + bp.w / 2, bp.y + 34);
    ctx.textAlign = 'right';
    ctx.font = `bold 13px ${SANS}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(`${state.bag.gold} gold`, bp.x + bp.w - 24, bp.y + 34);
    ctx.textAlign = 'left';

    const active = state.quests || [];
    const headers = [
      { text: 'PINNED NOTICES', rect: L.boardOffers[0] },
      { text: `YOUR CHARTER — ${active.length}/${Quests.MAX_ACTIVE}`, rect: L.boardActive[0] },
    ];
    ctx.font = `bold 11px ${SERIF}`;
    ctx.fillStyle = '#c9a15a';
    for (const h of headers) ctx.fillText(h.text, h.rect.x, h.rect.y - 12);

    for (let i = 0; i < L.boardOffers.length; i++) {
      const q = state.board && state.board[i];
      if (q) {
        questCard(ctx, state, L.boardOffers[i], q, false);
        continue;
      }
      const r = L.boardOffers[i];
      ctx.fillStyle = '#15100c';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#332a22';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = 'rgba(200,180,150,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText('taken', r.x + r.w / 2, r.y + r.h / 2 + 3);
      ctx.textAlign = 'left';
    }

    for (let i = 0; i < L.boardActive.length; i++) {
      const q = active[i];
      if (q) {
        questCard(ctx, state, L.boardActive[i], q, true);
        continue;
      }
      const r = L.boardActive[i];
      ctx.fillStyle = '#15100c';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#332a22';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = 'rgba(200,180,150,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText('no quest taken', r.x + r.w / 2, r.y + r.h / 2 + 3);
      ctx.textAlign = 'left';
    }

    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(200,180,150,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('Click a notice to take it · click a finished quest to claim · right-click to abandon · E or ESC: close', bp.x + bp.w / 2, bp.y + bp.h - 14);
    ctx.textAlign = 'left';
  };

  I.drawTree = function drawTree(ctx, state, view, L) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.treePanel, 0.96);

    ctx.font = `bold 22px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.textAlign = 'center';
    ctx.fillText('Skill Tree', L.treePanel.x + L.treePanel.w / 2, L.treePanel.y + 34);
    ctx.textAlign = 'left';
    const pts = state.player.skillPoints || 0;
    const pulse = pts > 0 ? 0.6 + 0.4 * Math.sin(state.time * 5) : 0.55;
    ctx.font = `bold 13px ${SANS}`;
    ctx.fillStyle = `rgba(255,216,77,${pulse})`;
    ctx.textAlign = 'right';
    ctx.fillText(`Skill points: ${pts}`, L.treePanel.x + L.treePanel.w - 24, L.treePanel.y + 34);
    ctx.textAlign = 'left';

    for (let c = 0; c < L.branchOrder.length; c++) {
      const branch = L.branchOrder[c];
      ctx.font = `bold 13px ${SERIF}`;
      ctx.fillStyle = BRANCH_COLORS[branch];
      ctx.textAlign = 'center';
      ctx.fillText(Skills.BRANCHES[branch].toUpperCase(), L.treePanel.x + 24 + c * 224 + 102, L.treePanel.y + 74);
      ctx.textAlign = 'left';
    }

    for (const id of Object.keys(Skills.SKILLS)) {
      const s = Skills.SKILLS[id];
      const r = L.treeCards[id];
      const rank = Skills.rank(state.player, id);
      const prev = Skills.prevInBranch(id);
      const locked = prev && Skills.rank(state.player, prev) < 1;
      const learnable = Skills.canLearn(state.player, id);

      // Connector to the tier above.
      if (s.tier > 1) {
        ctx.strokeStyle = locked ? 'rgba(90,75,55,0.4)' : BRANCH_COLORS[s.branch];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(r.x + r.w / 2, r.y - 16);
        ctx.lineTo(r.x + r.w / 2, r.y);
        ctx.stroke();
      }

      ctx.fillStyle = locked ? '#15100c' : '#1d1712';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (learnable) {
        const lp = 0.5 + 0.5 * Math.sin(state.time * 5);
        ctx.strokeStyle = `rgba(255,216,77,${0.45 + lp * 0.4})`;
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = rank > 0 ? BRANCH_COLORS[s.branch] : '#332a22';
        ctx.lineWidth = rank > 0 ? 1.5 : 1;
      }
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

      ctx.globalAlpha = locked ? 0.45 : 1;
      ctx.font = `bold 13px ${SANS}`;
      ctx.fillStyle = rank > 0 ? BRANCH_COLORS[s.branch] : '#e8dfc8';
      ctx.fillText(s.name, r.x + 12, r.y + 20);
      if (s.active) {
        ctx.font = `bold 10px ${SANS}`;
        ctx.fillStyle = '#c9a15a';
        ctx.textAlign = 'right';
        ctx.fillText(`[${s.active.hotkey}]`, r.x + r.w - 10, r.y + 20);
        ctx.textAlign = 'left';
      }
      // Rank pips.
      for (let i = 0; i < s.max; i++) {
        ctx.beginPath();
        ctx.arc(r.x + 16 + i * 13, r.y + 34, 3.4, 0, Math.PI * 2);
        if (i < rank) {
          ctx.fillStyle = BRANCH_COLORS[s.branch];
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(140,120,90,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.font = `10px ${SANS}`;
      ctx.fillStyle = 'rgba(215,200,175,0.7)';
      const descLines = I.wrapText(ctx, s.desc(Math.max(1, rank)), r.w - 24);
      for (let i = 0; i < Math.min(3, descLines.length); i++) {
        ctx.fillText(descLines[i], r.x + 12, r.y + 52 + i * 13);
      }
      if (locked) {
        ctx.font = `italic 9px ${SANS}`;
        ctx.fillStyle = 'rgba(229,128,122,0.8)';
        ctx.fillText(`Requires ${Skills.SKILLS[prev].name}`, r.x + 12, r.y + r.h - 8);
      }
      ctx.globalAlpha = 1;
    }

    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(200,180,150,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('Click a skill to spend a point · K or ESC: close', L.treePanel.x + L.treePanel.w / 2, L.treePanel.y + L.treePanel.h - 14);
    ctx.textAlign = 'left';
  };
})();
