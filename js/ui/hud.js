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
    if (!quests.length) return;
    const r = L.questLog;
    ctx.font = `bold 9px ${SANS}`;
    ctx.fillStyle = 'rgba(201,161,90,0.75)';
    ctx.fillText('QUESTS', r.x, r.y);
    for (let i = 0; i < quests.length; i++) {
      const q = quests[i];
      const done = Quests.isComplete(q);
      const y = r.y + 16 + i * 30;
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

  I.drawMinimap = function drawMinimap(ctx, state, L) {
    const mm = L.minimap;
    const d = state.dungeon;
    const s = mm.size / d.width;
    ctx.fillStyle = 'rgba(8,6,10,0.65)';
    ctx.fillRect(mm.x, mm.y, mm.size, mm.size);
    ctx.strokeStyle = '#4a3b28';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mm.x + 0.5, mm.y + 0.5, mm.size - 1, mm.size - 1);
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (!state.explored[y][x]) continue;
        const t = d.grid[y][x];
        if (t === Dungeon.TILE.WALL) continue;
        if (t === Dungeon.TILE.STAIRS_DOWN) {
          const blink = 0.5 + 0.5 * Math.sin(state.time * 4);
          ctx.fillStyle = `rgba(255,216,77,${0.5 + blink * 0.5})`;
          ctx.fillRect(mm.x + x * s - 1, mm.y + y * s - 1, s + 2, s + 2);
        } else {
          ctx.fillStyle = 'rgba(190,180,205,0.42)';
          ctx.fillRect(mm.x + x * s, mm.y + y * s, Math.max(1, s), Math.max(1, s));
        }
      }
    }
    for (const m of state.monsters) {
      if (!m.aggroed) continue;
      ctx.fillStyle = m.champion ? '#ff9a3d' : '#e5534b';
      ctx.fillRect(mm.x + (m.x / Dungeon.TILE_SIZE) * s - 1, mm.y + (m.y / Dungeon.TILE_SIZE) * s - 1, 3, 3);
    }
    // Party allies as coloured dots (their shirt tone); the local hero pulses white.
    const p = state.player;
    const party = state.players && state.players.length ? state.players : [p];
    for (const pl of party) {
      if (pl === p || pl.id === p.id) continue;
      if (pl.dead) continue;
      ctx.fillStyle = pl.down ? 'rgba(150,150,160,0.85)' : pl.shirt || '#8fd4ff';
      ctx.fillRect(mm.x + (pl.x / Dungeon.TILE_SIZE) * s - 1.5, mm.y + (pl.y / Dungeon.TILE_SIZE) * s - 1.5, 4, 4);
    }
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 6);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.fillRect(mm.x + (p.x / Dungeon.TILE_SIZE) * s - 1.5, mm.y + (p.y / Dungeon.TILE_SIZE) * s - 1.5, 4, 4);
  };
})();
