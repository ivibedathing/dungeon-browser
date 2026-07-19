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

    // Tiles (explored only) + dim veil on out-of-sight tiles. The overworld is
    // daylight: it keeps `explored` for the map panel, but nothing you have
    // walked past is greyed out — a veil over open country reads as fog, not as
    // memory, and at a 18-tile sight radius it would cover most of the screen.
    const daylight = !!state.dungeon.overworld;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!state.explored[y][x]) continue;
        R.drawTile(ctx, state, x, y);
        if (!daylight && !R.isVisible(state, x, y)) {
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
    else if (state.dungeon.overworld && state.world) {
      // Ashfall is a place in the world now: its fixtures and the landmarks
      // scattered across the continent draw on the same ground layer.
      const camp = state.world.world.town;
      if (camp && camp.well.x >= x0 - 24 && camp.well.x <= x1 + 24 && camp.well.y >= y0 - 24 && camp.well.y <= y1 + 24) {
        R.drawTownFixtures(ctx, state, camp);
      }
      R.drawWorldPOIs(ctx, state, x0, y0, x1, y1);
    }

    // Telegraphs are a GROUND layer: painted before every body so a boss can
    // never stand on top of its own warning. Culled by the telegraph's own tile,
    // not the caster's — the circle lands where it was aimed, not where it lives.
    for (const m of state.monsters) {
      if (!(m.telegraphT > 0) || !m.telegraph) continue;
      const tx = Math.floor(m.telegraph.x / TS);
      const ty = Math.floor(m.telegraph.y / TS);
      if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
      if (!R.isVisible(state, tx, ty)) continue;
      R.drawTelegraph(ctx, state, m);
    }

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
      } else if (pr.kind === 'bolt') {
        // Hostile caster bolt: a violet mote with a short tail.
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.angle);
        ctx.fillStyle = 'rgba(180,107,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(0, -2.5);
        ctx.lineTo(0, 2.5);
        ctx.fill();
        const bg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 6);
        bg.addColorStop(0, '#f0e0ff');
        bg.addColorStop(0.5, '#b46bff');
        bg.addColorStop(1, 'rgba(120,60,200,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (pr.kind === 'thrown') {
        // A tumbling steel weapon: spins independent of flight angle.
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(state.time * 18 + pr.x * 0.05);
        ctx.fillStyle = '#8a6b3a';
        ctx.fillRect(-1.3, -7, 2.6, 14);
        ctx.fillStyle = '#cfd6dd';
        ctx.beginPath();
        ctx.moveTo(-1.3, -7);
        ctx.lineTo(5, -6);
        ctx.lineTo(4, -1);
        ctx.lineTo(-1.3, -2);
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

    // Player-centered light vignette (screen space). Underground it is the
    // torchlight falloff and carries most of the mood; outdoors it survives only
    // as a faint corner darkening, or the continent would look like a cave.
    const px = p.x - camX;
    const py = p.y - camY;
    const vr = Math.max(view.w, view.h) * (daylight ? 0.95 : 0.62);
    const grad = ctx.createRadialGradient(px, py, vr * (daylight ? 0.55 : 0.28), px, py, vr);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, daylight ? 'rgba(10,8,14,0.34)' : 'rgba(4,2,6,0.88)');
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
