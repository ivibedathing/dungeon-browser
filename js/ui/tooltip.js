// ui/tooltip.js — hover tooltips for items and skills, including the
// CTRL-compare panel showing the equipped counterpart alongside.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SANS, BRANCH_COLORS } = I;

  function tooltipFor(state, hover) {
    if (hover.skill) {
      const s = Skills.SKILLS[hover.skill];
      const rank = Skills.rank(state.player, hover.skill);
      const lines = [];
      lines.push({ text: s.name, color: BRANCH_COLORS[s.branch], font: `bold 13px ${SANS}` });
      lines.push({ text: `Rank ${rank} / ${s.max}`, color: '#9a8f7c' });
      if (rank > 0) lines.push({ text: s.desc(rank), color: '#efe6d2' });
      if (rank < s.max) lines.push({ text: `${rank > 0 ? 'Next' : 'First rank'}: ${s.desc(rank + 1)}`, color: 'rgba(215,200,175,0.65)' });
      if (s.active) lines.push({ text: `Mana ${s.active.mana} · Cooldown ${s.active.cd}s · Hotkey ${s.active.hotkey}`, color: '#7fa8ff' });
      if (Skills.canLearn(state.player, hover.skill) && state.treeOpen) {
        lines.push({ text: 'Click to learn', color: '#ffd84d' });
      }
      return lines;
    }
    const item = hover.item;
    const lines = [];
    lines.push({ text: Items.displayName(item), color: item.color || '#e8e2d6', font: `bold 13px ${SANS}` });
    if (item.slot === 'potion') {
      lines.push({ text: 'Potion', color: '#9a8f7c' });
      if (item.kind === 'mana') {
        lines.push({ text: `Restores ${item.mana} Mana instantly`, color: '#7fa8ff' });
      } else {
        lines.push({ text: `Heals ${item.heal} Life over 1.2s`, color: '#efe6d2' });
      }
    } else {
      const typeName = item.slot === 'weapon' ? item.base : item.slot === 'armor' ? item.base : 'Ring';
      lines.push({ text: `${typeName} — ${item.rarity}`, color: '#9a8f7c' });
      const equipped = state.player.equip[item.slot];
      const cmp = hover.context === 'bag' && equipped && equipped !== item;
      if (item.slot === 'weapon') {
        const eff = Items.weaponDamage(item);
        let dmg = `Damage ${eff}`;
        if (cmp) {
          const d = eff - Items.weaponDamage(equipped);
          dmg += `  (${d >= 0 ? '+' : ''}${d})`;
        }
        lines.push({ text: dmg, color: cmp && eff < Items.weaponDamage(equipped) ? '#e5807a' : '#efe6d2' });
        lines.push({ text: `Speed ${item.stats.speed.toFixed(1)} swings/s`, color: '#efe6d2' });
        // Swing radius only means something on melee weapons (items without a
        // kind, like the starter sword, are melee); wands show their blast instead.
        const kind = item.kind || 'melee';
        if (kind === 'melee') lines.push({ text: `Radius ${item.stats.radius}`, color: '#efe6d2' });
        if (kind === 'wand') lines.push({ text: `Blast radius ${item.stats.aoe}`, color: '#efe6d2' });
      }
      if (['armor', 'helmet', 'gloves', 'pants', 'boots'].includes(item.slot)) {
        const eff = Items.armorDefense(item);
        let def = `Defense ${Items.formatDefense(eff)}`;
        if (cmp) {
          const d = Math.round((eff - Items.armorDefense(equipped)) * 10) / 10;
          def += `  (${d >= 0 ? '+' : ''}${Items.formatDefense(d)})`;
        }
        lines.push({ text: def, color: cmp && eff < Items.armorDefense(equipped) ? '#e5807a' : '#efe6d2' });
        if (item.stats.maxHP) lines.push({ text: `+${item.stats.maxHP} to Life`, color: '#efe6d2' });
        if (item.stats.maxMana) lines.push({ text: `+${item.stats.maxMana} to Mana`, color: '#7fa8ff' });
        if (item.stats.speedMult) lines.push({ text: `+${Math.round(item.stats.speedMult * 100)}% Attack Speed`, color: '#efe6d2' });
        if (item.stats.moveMult) {
          const pct = Math.round(item.stats.moveMult * 100);
          lines.push({ text: `${pct > 0 ? '+' : ''}${pct}% Move Speed`, color: pct < 0 ? '#e5807a' : '#efe6d2' });
        }
      }
      for (const a of item.affixes || []) {
        lines.push({ text: a.label, color: '#8f9bff' });
      }
    }
    if (hover.context === 'equipped') lines.push({ text: 'Equipped', color: '#c9a15a' });
    if (hover.context === 'belt') lines.push({ text: `Press ${state.bag.belt.indexOf(item) + 1} to drink`, color: '#c9a15a' });
    if (hover.context === 'box') {
      if (state.trading) lines.push({ text: `Sell for ${Items.sellPrice(item)} gold`, color: '#ffd84d' });
      else lines.push({ text: 'Click to drink', color: '#c9a15a' });
    }
    if (hover.context === 'shop') lines.push({ text: `Costs ${hover.price} gold`, color: '#ffd84d' });
    if (hover.context === 'buyback') lines.push({ text: `Buy back for ${hover.price} gold`, color: '#ffd84d' });
    if (hover.context === 'shopPotion') lines.push({ text: `Costs ${Items.buyPrice(item)} gold`, color: '#ffd84d' });
    if (hover.context === 'bag' && state.trading) lines.push({ text: `Sell for ${Items.sellPrice(item)} gold`, color: '#ffd84d' });
    if (state.smithing && Items.isSmithable(item) && (hover.context === 'bag' || hover.context === 'equipped')) {
      if ((item.plus || 0) >= Items.MAX_PLUS) {
        lines.push({ text: 'Fully honed (+10)', color: '#c9a15a' });
      } else {
        lines.push({ text: `Click to upgrade to +${(item.plus || 0) + 1}: ${Items.upgradeCost(item)} gold`, color: '#ffd84d' });
      }
    }
    return lines;
  }

  function measureTooltip(ctx, lines) {
    let w = 0;
    for (const l of lines) {
      ctx.font = l.font || `11px ${SANS}`;
      w = Math.max(w, ctx.measureText(l.text).width);
    }
    return { w: w + 22, h: lines.length * 16 + 14 };
  }

  function drawTooltipPanel(ctx, lines, x, y, dim, borderColor) {
    ctx.fillStyle = 'rgba(10,7,6,0.94)';
    ctx.fillRect(x, y, dim.w, dim.h);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, dim.w - 1, dim.h - 1);
    let ly = y + 18;
    for (const l of lines) {
      ctx.font = l.font || `11px ${SANS}`;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x + 11, ly);
      ly += 16;
    }
  }

  I.drawTooltip = function drawTooltip(ctx, state, view) {
    const hover = state.hover;
    if (!hover) return;
    const lines = tooltipFor(state, hover);
    const dim = measureTooltip(ctx, lines);
    let x = hover.x + 16;
    let y = hover.y - dim.h - 8;
    if (x + dim.w > view.w - 8) x = view.w - dim.w - 8;
    if (y < 8) y = hover.y + 20;
    const borderColor = hover.skill
      ? BRANCH_COLORS[Skills.SKILLS[hover.skill].branch]
      : (hover.item && hover.item.color) || '#5d4a2c';
    drawTooltipPanel(ctx, lines, x, y, dim, borderColor);

    // Hold CTRL over a bag item: show the equipped counterpart alongside.
    if (hover.compare && hover.item && Items.EQUIP_SLOTS.includes(hover.item.slot)) {
      const equipped = state.player.equip[hover.item.slot];
      if (equipped && equipped !== hover.item) {
        const eqLines = [{ text: 'CURRENTLY EQUIPPED', color: '#c9a15a', font: `bold 10px ${SANS}` }].concat(
          tooltipFor(state, { item: equipped, context: 'equipped', x: hover.x, y: hover.y })
        );
        const eqDim = measureTooltip(ctx, eqLines);
        let ex = x - eqDim.w - 10;
        if (ex < 8) ex = x + dim.w + 10;
        let ey = y;
        if (ey + eqDim.h > view.h - 8) ey = view.h - eqDim.h - 8;
        drawTooltipPanel(ctx, eqLines, ex, ey, eqDim, equipped.color || '#5d4a2c');
      }
    }
  };
})();
