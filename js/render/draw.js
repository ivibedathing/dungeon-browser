// render/draw.js — Render.draw: camera, culling, and scene composition
// (tiles → torches → drops → portals/fixtures → actors → projectiles →
// particles → float text → vignettes). Loads last among js/render/ parts.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;
  const TS = Dungeon.TILE_SIZE;

  Render.draw = function (ctx, state, view) {
    const theme = state.dungeon.theme;
    ctx.fillStyle = theme.fog;
    ctx.fillRect(0, 0, view.w, view.h);

    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const camX = state.cam.x - view.w / 2 + shakeX;
    const camY = state.cam.y - view.h / 2 + shakeY;

    ctx.save();
    ctx.translate(-camX, -camY);

    const x0 = Math.max(0, Math.floor(camX / TS) - 1);
    const y0 = Math.max(0, Math.floor(camY / TS) - 1);
    const x1 = Math.min(state.dungeon.width - 1, Math.ceil((camX + view.w) / TS) + 1);
    const y1 = Math.min(state.dungeon.height - 1, Math.ceil((camY + view.h) / TS) + 1);

    // Tiles (explored only) + dim veil on out-of-sight tiles.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!state.explored[y][x]) continue;
        R.drawTile(ctx, state, x, y);
        if (!R.isVisible(state, x, y)) {
          ctx.fillStyle = 'rgba(8,5,10,0.6)';
          ctx.fillRect(x * TS, y * TS, TS, TS);
        }
      }
    }

    // Torch glows + flames (visible tiles only).
    for (const t of state.dungeon.torches) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      if (!state.explored[t.y][t.x] || !R.isVisible(state, t.x, t.y)) continue;
      R.torchGlow(ctx, state, t);
      R.drawTorch(ctx, state, t);
    }

    // Breakable decorations sit on the floor beneath actors and loot.
    if (state.props) {
      for (const prop of state.props) {
        const px = Math.floor(prop.x / TS);
        const py = Math.floor(prop.y / TS);
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        if (!state.explored[py] || !state.explored[py][px] || !R.isVisible(state, px, py)) continue;
        R.drawProp(ctx, state, prop);
      }
    }

    // Ground items.
    const p = state.player;
    for (const g of state.groundItems) {
      const gx = Math.floor(g.x / TS);
      const gy = Math.floor(g.y / TS);
      if (gx < x0 || gx > x1 || gy < y0 || gy > y1) continue;
      if (!state.explored[gy] || !state.explored[gy][gx] || !R.isVisible(state, gx, gy)) continue;
      const near = U.dist2(p.x, p.y, g.x, g.y) < 110 * 110;
      R.drawGroundItem(ctx, state, g, near);
    }

    // Portals and town fixtures sit on the floor beneath actors.
    for (const po of state.portals) R.drawPortal(ctx, state, po);
    if (state.dungeon.town) R.drawTownFixtures(ctx, state);

    // Monsters (visible only), painter-sorted with every living party member.
    const drawables = [];
    for (const m of state.monsters) {
      const mx = Math.floor(m.x / TS);
      const my = Math.floor(m.y / TS);
      if (mx < x0 || mx > x1 || my < y0 || my > y1) continue;
      if (!R.isVisible(state, mx, my)) continue;
      drawables.push({ y: m.y, fn: () => R.drawMonster(ctx, state, m) });
    }
    // Solo has one hero in `state.players`; co-op has the whole party. A dead hero
    // is skipped (in solo that matches the old `!state.dead` guard, since the lone
    // player's `dead` flips exactly when the run ends).
    const party = state.players && state.players.length ? state.players : [p];
    for (const pl of party) {
      if (pl.dead) continue;
      drawables.push({ y: pl.y, fn: () => R.drawPlayer(ctx, state, pl) });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

    // Projectiles in flight.
    for (const pr of state.projectiles) {
      if (pr.kind === 'arrow') {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.angle);
        ctx.fillStyle = '#c9b37e';
        ctx.fillRect(-8, -1, 12, 2);
        ctx.fillStyle = '#e8e2d6';
        ctx.beginPath();
        ctx.moveTo(4, -2.5);
        ctx.lineTo(8.5, 0);
        ctx.lineTo(4, 2.5);
        ctx.fill();
        ctx.restore();
      } else {
        const fg = ctx.createRadialGradient(pr.x, pr.y, 1, pr.x, pr.y, 11);
        fg.addColorStop(0, '#fff3c0');
        fg.addColorStop(0.4, '#ff9a3d');
        fg.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 11, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Particles.
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // Floating combat text.
    for (const ft of state.floatTexts) {
      const a = Math.max(0, 1 - ft.t / 0.9);
      ctx.globalAlpha = a;
      ctx.font = `bold ${ft.size}px Verdana, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(ft.text, ft.x, ft.y - ft.t * 34);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y - ft.t * 34);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // Player-centered light vignette (screen space).
    const px = p.x - camX;
    const py = p.y - camY;
    const vr = Math.max(view.w, view.h) * 0.62;
    const grad = ctx.createRadialGradient(px, py, vr * 0.28, px, py, vr);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(4,2,6,0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, view.w, view.h);

    // Hurt vignette.
    if (p.hurtT > 0) {
      const a = (p.hurtT / 0.3) * 0.4;
      const hg = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.3, view.w / 2, view.h / 2, view.h * 0.75);
      hg.addColorStop(0, 'rgba(180,20,10,0)');
      hg.addColorStop(1, `rgba(180,20,10,${a})`);
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  };
})();
