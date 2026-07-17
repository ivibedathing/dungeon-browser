// ui/draw.js — UI.draw: composes the HUD each frame (bottom panel, widgets,
// location title, boss bar, messages, panels, tooltip, fade, death overlay).
// Loads last among the js/ui/ parts.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS } = I;

  UI.draw = function (ctx, state, view) {
    const L = I.layout(view);

    // Bottom HUD panel.
    const hudY = view.h - 100;
    const g = ctx.createLinearGradient(0, hudY, 0, view.h);
    g.addColorStop(0, 'rgba(12,9,8,0)');
    g.addColorStop(0.35, 'rgba(12,9,8,0.88)');
    g.addColorStop(1, 'rgba(8,6,5,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, hudY, view.w, 100);
    ctx.fillStyle = 'rgba(200,160,90,0.28)';
    ctx.fillRect(0, hudY + 26, view.w, 1);

    I.drawXP(ctx, state, L);
    I.drawBelt(ctx, state, L);
    I.drawSkillBar(ctx, state, L);
    I.drawOrb(ctx, state, L);
    I.drawManaOrb(ctx, state, L);
    I.drawMinimap(ctx, state, L);
    I.drawQuestLog(ctx, state, L);

    // Location title (top center).
    const locLabel = state.inTown
      ? 'Ashfall Camp — Town'
      : `Floor ${state.floor} — ${state.dungeon.theme.name}`;
    ctx.font = `bold 15px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(locLabel, view.w / 2 + 1, 25);
    ctx.fillStyle = '#c9b37e';
    ctx.fillText(locLabel, view.w / 2, 24);
    ctx.textAlign = 'left';

    // Controls hint (top left) + portal status.
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.45)';
    ctx.fillText('WASD move · M attack · SPACE dodge · F/G/H skills · K skill tree · E pick up / buy / read · 1-4 potions · T town portal · I inventory · N sound', 12, 20);
    if (state.portalCdT > 0) {
      ctx.fillStyle = 'rgba(140,175,230,0.7)';
      ctx.fillText(`Portal ready in ${Math.ceil(state.portalCdT)}s`, 12, 35);
    } else if (state.portals.length > 0) {
      ctx.fillStyle = 'rgba(150,200,255,0.85)';
      ctx.fillText(state.inTown ? 'Return portal open' : 'Town portal open', 12, 35);
    }

    // Boss health bar (top center during an arena fight).
    if (state.bossFight) {
      const boss = state.monsters.find((m) => m.boss);
      if (boss) {
        const bw = Math.min(560, view.w - 320);
        const bx = (view.w - bw) / 2;
        const by = 58;
        ctx.font = `bold 17px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(boss.name, view.w / 2 + 1, by - 8 + 1);
        ctx.fillStyle = '#ff9a3d';
        ctx.fillText(boss.name, view.w / 2, by - 8);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(8,5,8,0.8)';
        ctx.fillRect(bx - 4, by - 4, bw + 8, 22);
        ctx.fillStyle = '#2a0d10';
        ctx.fillRect(bx, by, bw, 14);
        const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        bg.addColorStop(0, '#7e1420');
        bg.addColorStop(1, '#c2202e');
        ctx.fillStyle = bg;
        ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHP), 14);
        ctx.strokeStyle = '#6e5433';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx - 2, by - 2, bw + 4, 18);
      }
    }

    // Message log.
    ctx.font = `11px ${SANS}`;
    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i];
      const alpha = msg.t > 5 ? Math.max(0, 1 - (msg.t - 5) / 2) : 1;
      ctx.globalAlpha = alpha;
      const y = view.h - 118 - (state.messages.length - 1 - i) * 17;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(msg.text).width;
      ctx.fillRect(10, y - 11, tw + 10, 15);
      ctx.fillStyle = msg.color;
      ctx.fillText(msg.text, 15, y);
    }
    ctx.globalAlpha = 1;

    // The board is the one town fixture you must open by hand — say so.
    if (state.questing && !state.boardOpen) {
      const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
      ctx.font = `bold 12px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,216,77,${pulse})`;
      ctx.fillText('Press E to read the notices', view.w / 2, view.h - 140);
      ctx.textAlign = 'left';
    }

    if (state.invOpen) {
      I.drawInventory(ctx, state, view, L);
      if (state.trading) I.drawShop(ctx, state, L);
      if (state.smithing) {
        const sp = { x: L.panel.x, y: L.panel.y - 64, w: L.panel.w, h: 54 };
        I.panelBg(ctx, sp, 0.96);
        ctx.font = `bold 15px ${SERIF}`;
        ctx.fillStyle = '#ffd84d';
        ctx.fillText("BORIN'S ANVIL", sp.x + 24, sp.y + 23);
        ctx.font = `10px ${SANS}`;
        ctx.fillStyle = 'rgba(215,200,175,0.65)';
        ctx.fillText('Click any weapon to hammer it: +8% damage per level, up to +10. E strikes your equipped blade.', sp.x + 24, sp.y + 40);
      }
    }
    if (state.treeOpen) I.drawTree(ctx, state, view, L);
    if (state.boardOpen) I.drawBoard(ctx, state, view, L);
    I.drawTooltip(ctx, state, view);

    // Floor-transition fade + title card.
    if (state.fade && state.fade.t < state.fade.dur) {
      const t = state.fade.t;
      const black = Math.max(0, 1 - t / 0.55);
      if (black > 0) {
        ctx.fillStyle = `rgba(0,0,0,${black})`;
        ctx.fillRect(0, 0, view.w, view.h);
      }
      const titleA = t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 1.0) / 0.6);
      if (titleA > 0) {
        ctx.globalAlpha = Math.min(1, titleA);
        ctx.font = `bold 34px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(state.fade.label, view.w / 2 + 2, view.h * 0.38 + 2);
        ctx.fillStyle = '#d9c06a';
        ctx.fillText(state.fade.label, view.w / 2, view.h * 0.38);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    }

    // Death overlay.
    if (state.dead) {
      const a = Math.min(0.78, state.deathT * 0.8);
      ctx.fillStyle = `rgba(20,2,4,${a})`;
      ctx.fillRect(0, 0, view.w, view.h);
      if (state.deathT > 0.5) {
        ctx.textAlign = 'center';
        ctx.font = `bold 52px ${SERIF}`;
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillText('YOU HAVE DIED', view.w / 2 + 3, view.h * 0.42 + 3);
        ctx.fillStyle = '#a31c22';
        ctx.fillText('YOU HAVE DIED', view.w / 2, view.h * 0.42);
        ctx.font = `15px ${SERIF}`;
        ctx.fillStyle = '#c9b37e';
        ctx.fillText(
          `Level ${state.player.level}  ·  Floor ${state.floor}  ·  ${state.kills} kills  ·  ${state.bag.gold} gold`,
          view.w / 2,
          view.h * 0.42 + 38
        );
        if (typeof Save !== 'undefined') {
          const rec = Save.records();
          if (rec.bestFloor > 0) {
            ctx.font = `13px ${SERIF}`;
            ctx.fillStyle = 'rgba(201,179,126,0.75)';
            ctx.fillText(`Deepest venture: Floor ${rec.bestFloor} · Level ${rec.bestLevel}`, view.w / 2, view.h * 0.42 + 58);
          }
        }
        const pulse = 0.55 + 0.45 * Math.sin(state.time * 3);
        ctx.globalAlpha = pulse;
        ctx.font = `bold 15px ${SANS}`;
        ctx.fillStyle = '#efe6d2';
        ctx.fillText('Press R to rise again', view.w / 2, view.h * 0.42 + 76);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
      }
    }
  };
})();
