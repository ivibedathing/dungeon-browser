// ui/hud.js — always-on HUD widgets: skill bar, XP bar, potion belt, minimap.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SANS } = I;

  function drawSkillGlyph(ctx, id, cx, cy, size, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (id === 'whirlwind') {
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0.4, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.95, cy + size * 0.55);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
      ctx.lineTo(cx + size * 1.05, cy - size * 0.05);
      ctx.closePath();
      ctx.fill();
    } else if (id === 'nova') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * size * 0.35, cy + Math.sin(a) * size * 0.35);
        ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // prayer cross
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx, cy + size);
      ctx.moveTo(cx - size * 0.7, cy - size * 0.25);
      ctx.lineTo(cx + size * 0.7, cy - size * 0.25);
      ctx.stroke();
    }
  }

  I.drawSkillBar = function drawSkillBar(ctx, state, L) {
    const p = state.player;
    for (let i = 0; i < L.skillBtns.length; i++) {
      const id = Skills.ACTIVE_ORDER[i];
      const def = Skills.SKILLS[id];
      const r = L.skillBtns[i];
      const rank = Skills.rank(p, id);
      const learned = rank > 0;
      ctx.fillStyle = 'rgba(20,14,10,0.92)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = learned ? 1 : 0.35;
      drawSkillGlyph(ctx, id, r.x + r.w / 2, r.y + r.h / 2, 11, learned ? '#e8d9b0' : '#8a795c');
      // Cooldown veil rises from the bottom.
      if (learned && p.skillCd[id] > 0) {
        const frac = p.skillCd[id] / def.active.cd;
        ctx.fillStyle = 'rgba(5,3,2,0.72)';
        ctx.fillRect(r.x, r.y + r.h * (1 - frac), r.w, r.h * frac);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = learned ? '#6e5433' : '#3a2f26';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.font = `bold 9px ${SANS}`;
      ctx.fillStyle = '#c9a15a';
      ctx.fillText(def.active.hotkey, r.x + 3, r.y + 10);
      if (learned) {
        ctx.fillStyle = (p.mana || 0) >= def.active.mana ? '#7fa8ff' : '#e5807a';
        ctx.textAlign = 'right';
        ctx.fillText(`${def.active.mana}`, r.x + r.w - 3, r.y + r.h - 4);
        ctx.textAlign = 'left';
      }
    }
    // A nudge when points wait to be spent.
    if ((p.skillPoints || 0) > 0) {
      const pulse = 0.6 + 0.4 * Math.sin(state.time * 5);
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = `rgba(255,216,77,${pulse})`;
      ctx.fillText(`${p.skillPoints} skill point${p.skillPoints > 1 ? 's' : ''} — press K`, L.skillBtns[0].x, L.skillBtns[0].y - 6);
    }
  };

  I.drawXP = function drawXP(ctx, state, L) {
    const p = state.player;
    const need = Entities.xpForLevel(p.level);
    const frac = Math.max(0, Math.min(1, p.xp / need));
    const r = L.xp;
    ctx.fillStyle = '#14100b';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
    g.addColorStop(0, '#7a6128');
    g.addColorStop(1, '#ffd84d');
    ctx.fillStyle = g;
    ctx.fillRect(r.x + 1, r.y + 1, (r.w - 2) * frac, r.h - 2);
    ctx.strokeStyle = '#4a3b22';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    for (let i = 1; i < 10; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(r.x + (r.w * i) / 10, r.y + 1, 1, r.h - 2);
    }
    ctx.font = `bold 12px ${SANS}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(`Level ${p.level}`, r.x, r.y - 6);
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(230,215,180,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(p.xp)} / ${need} XP`, r.x + r.w, r.y - 6);
    ctx.textAlign = 'left';
  };

  I.drawBelt = function drawBelt(ctx, state, L) {
    ctx.font = `bold 9px ${SANS}`;
    for (let i = 0; i < L.belt.length; i++) {
      const r = L.belt[i];
      ctx.fillStyle = 'rgba(20,14,10,0.92)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#4a3b28';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      const p = state.bag.belt[i];
      if (p) {
        Render.drawItemIcon(ctx, p, r.x + r.w / 2, r.y + r.h / 2 + 2, 1.35);
      }
      ctx.fillStyle = '#c9a15a';
      ctx.fillText(`${i + 1}`, r.x + 4, r.y + 11);
    }
    // Gold + floor, right-aligned above belt.
    const right = L.belt[3].x + L.belt[3].w;
    ctx.textAlign = 'right';
    ctx.font = `bold 12px ${SANS}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(`${state.bag.gold} gold`, right, L.belt[0].y - 10);
    ctx.textAlign = 'left';
  };

  // Active quests, tucked under the minimap: what you took, and how far along.
  I.drawQuestLog = function drawQuestLog(ctx, state, L) {
    const quests = state.quests || [];
    const main = Quests.mainQuest(state.player && state.player.mainQuest);
    if (!quests.length && !main) return;
    const r = L.questLog;
    ctx.font = `bold 9px ${SANS}`;
    ctx.fillStyle = 'rgba(201,161,90,0.75)';
    ctx.fillText('QUESTS', r.x, r.y);

    // The main quest sits above the charter and is visually distinct — it is not
    // one of the three slots and cannot be abandoned.
    let top = r.y;
    if (main) {
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = '#ff9a3d';
      ctx.fillText(main.title, r.x, top + 16);
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = 'rgba(215,200,175,0.7)';
      ctx.textAlign = 'right';
      ctx.fillText(`Floor ${main.floor}`, r.x + r.w, top + 16);
      ctx.textAlign = 'left';
      top += 24;
    }
    for (let i = 0; i < quests.length; i++) {
      const q = quests[i];
      const done = Quests.isComplete(q);
      const y = top + 16 + i * 30;
      ctx.font = `bold 10px ${SANS}`;
      ctx.fillStyle = done ? '#ffd84d' : 'rgba(232,223,200,0.9)';
      ctx.fillText(q.title, r.x, y);
      ctx.font = `9px ${SANS}`;
      ctx.fillStyle = done ? '#8fe89a' : 'rgba(215,200,175,0.7)';
      ctx.textAlign = 'right';
      ctx.fillText(done ? 'claim it' : Quests.progressText(q), r.x + r.w, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(20,14,10,0.85)';
      ctx.fillRect(r.x, y + 5, r.w, 4);
      ctx.fillStyle = done ? '#8fe89a' : '#c9a15a';
      ctx.fillRect(r.x, y + 5, r.w * Quests.fraction(q), 4);
    }
  };

  // The minimap window in TILE coords: which slice of the level it shows. A
  // dungeon floor fits whole, as it always did; the 2048-tile overworld gets a
  // window that scrolls with the player and clamps at the map edges. Exported so
  // the tests can pin the rect without a canvas.
  I.minimapRect = function minimapRect(state) {
    const d = state.dungeon;
    const span = d.overworld ? Math.min(I.MINIMAP_SPAN, d.width) : Math.max(d.width, d.height);
    if (!d.overworld) return { x0: 0, y0: 0, span };
    const TS = Dungeon.TILE_SIZE;
    const half = span / 2;
    return {
      x0: U.clamp(state.player.x / TS - half, 0, Math.max(0, d.width - span)),
      y0: U.clamp(state.player.y / TS - half, 0, Math.max(0, d.height - span)),
      span,
    };
  };
  I.MINIMAP_SPAN = 112; // tiles across the overworld minimap window

  I.drawMinimap = function drawMinimap(ctx, state, L) {
    const mm = L.minimap;
    const d = state.dungeon;
    const TS = Dungeon.TILE_SIZE;
    const rect = I.minimapRect(state);
    const s = mm.size / rect.span;
    ctx.fillStyle = 'rgba(8,6,10,0.65)';
    ctx.fillRect(mm.x, mm.y, mm.size, mm.size);
    ctx.strokeStyle = '#4a3b28';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mm.x + 0.5, mm.y + 0.5, mm.size - 1, mm.size - 1);

    // Screen position of a tile, and whether it lands inside the box at all.
    const sx = (tx) => mm.x + (tx - rect.x0) * s;
    const sy = (ty) => mm.y + (ty - rect.y0) * s;
    const inside = (tx, ty) => tx >= rect.x0 && ty >= rect.y0 && tx < rect.x0 + rect.span && ty < rect.y0 + rect.span;

    const yA = Math.max(0, Math.floor(rect.y0));
    const yB = Math.min(d.height - 1, Math.ceil(rect.y0 + rect.span));
    const xA = Math.max(0, Math.floor(rect.x0));
    const xB = Math.min(d.width - 1, Math.ceil(rect.x0 + rect.span));
    const cell = Math.max(1, s);
    for (let y = yA; y <= yB; y++) {
      const erow = state.explored[y];
      if (!erow) continue;
      for (let x = xA; x <= xB; x++) {
        if (!erow[x]) continue;
        const t = d.grid[y][x];
        if (t === Dungeon.TILE.WALL || t === Dungeon.TILE.CLIFF) continue;
        if (t === Dungeon.TILE.STAIRS_DOWN) {
          const blink = 0.5 + 0.5 * Math.sin(state.time * 4);
          ctx.fillStyle = `rgba(255,216,77,${0.5 + blink * 0.5})`;
          ctx.fillRect(sx(x) - 1, sy(y) - 1, cell + 2, cell + 2);
          continue;
        }
        if (t === Dungeon.TILE.WATER) ctx.fillStyle = 'rgba(90,140,175,0.5)';
        else if (t === Dungeon.TILE.ROAD) ctx.fillStyle = 'rgba(220,205,160,0.6)';
        else ctx.fillStyle = 'rgba(190,180,205,0.42)';
        ctx.fillRect(sx(x), sy(y), cell, cell);
      }
    }
    for (const m of state.monsters) {
      if (!m.aggroed) continue;
      const tx = m.x / TS;
      const ty = m.y / TS;
      if (!inside(tx, ty)) continue;
      ctx.fillStyle = m.champion ? '#ff9a3d' : '#e5534b';
      ctx.fillRect(sx(tx) - 1, sy(ty) - 1, 3, 3);
    }
    // Party allies as coloured dots (their shirt tone); the local hero pulses white.
    const p = state.player;
    const party = state.players && state.players.length ? state.players : [p];
    for (const pl of party) {
      if (pl === p || pl.id === p.id) continue;
      if (pl.dead) continue;
      const tx = pl.x / TS;
      const ty = pl.y / TS;
      if (!inside(tx, ty)) continue;
      ctx.fillStyle = pl.down ? 'rgba(150,150,160,0.85)' : pl.shirt || '#8fd4ff';
      ctx.fillRect(sx(tx) - 1.5, sy(ty) - 1.5, 4, 4);
    }
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 6);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.fillRect(sx(p.x / TS) - 1.5, sy(p.y / TS) - 1.5, 4, 4);
  };
})();
