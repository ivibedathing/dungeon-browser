// render/player.js — the hero sprite: dodge afterimages, swing arcs, the held
// weapon by kind, and equipped gear re-dressing the body.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  // Draws one hero. `p` defaults to the local player (solo/prediction), but any
  // party member from a snapshot can be passed — allies arrive without an `equip`
  // map, so every gear block below is guarded and a lean ally renders as the base
  // cloaked body in its own shirt colour.
  R.drawPlayer = function drawPlayer(ctx, state, p) {
    if (!p) p = state.player;
    const t = state.time;
    const bob = Math.sin(t * 8) * 1.2;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 9, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dodge-roll afterimages.
    if (p.dodgeT > 0 && p.dodgeDir) {
      for (let g = 1; g <= 2; g++) {
        ctx.globalAlpha = 0.18 / g;
        ctx.fillStyle = p.shirt || '#4a5578';
        ctx.beginPath();
        ctx.arc(p.x - p.dodgeDir.x * 14 * g, p.y - p.dodgeDir.y * 14 * g, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Healing aura.
    if (p.healPool > 0) {
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 22);
      g.addColorStop(0, 'rgba(111,208,111,0.25)');
      g.addColorStop(1, 'rgba(111,208,111,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Swing arc sweep (melee weapons only).
    if (p.swing && !p.swing.ranged) {
      const arcW = p.swing.arc || Game.ARC_WIDTH;
      const q = Math.min(1, p.swing.t / p.swing.dur);
      const a0 = p.swing.facing - arcW / 2;
      const a1 = a0 + arcW * q;
      const grad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, p.swing.radius);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.7, `rgba(255,244,200,${0.28 * (1 - q * 0.6)})`);
      grad.addColorStop(1, 'rgba(255,244,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, p.swing.radius, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(255,250,230,${0.5 * (1 - q)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.swing.radius - 2, Math.max(a0, a1 - 0.7), a1);
      ctx.stroke();
    }

    const by = p.y + bob * 0.3;

    // Held weapon, styled by kind (sword sweeps, bow aims, wand glows). Allies from
    // a snapshot carry no equipment, so default the whole map to empty.
    const eq = p.equip || {};
    const weaponItem = eq.weapon;
    const wkind = (weaponItem && weaponItem.kind) || 'melee';
    const heldArc = p.swing && p.swing.arc && !p.swing.ranged ? p.swing.arc : Game.ARC_WIDTH;
    const swordAngle = p.swing
      ? p.swing.ranged
        ? p.swing.facing
        : p.swing.facing - heldArc / 2 + heldArc * Math.min(1, p.swing.t / p.swing.dur)
      : p.facing + 0.5;
    const hx = p.x + Math.cos(swordAngle) * 8;
    const hy = by + Math.sin(swordAngle) * 8;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(swordAngle);
    if (wkind === 'bow') {
      ctx.strokeStyle = '#8a6b3a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, 9, -1.15, 1.15);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,225,205,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(-1.15) * 9, Math.sin(-1.15) * 9);
      ctx.lineTo(Math.cos(1.15) * 9, Math.sin(1.15) * 9);
      ctx.stroke();
    } else if (wkind === 'wand') {
      ctx.fillStyle = '#5e4470';
      ctx.fillRect(0, -1.3, 12, 2.6);
      const wg = ctx.createRadialGradient(13, 0, 0.5, 13, 0, p.swing ? 8 : 5);
      wg.addColorStop(0, '#fff3c0');
      wg.addColorStop(0.5, '#ff9a3d');
      wg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(13, 0, p.swing ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#cfd6dd';
      ctx.fillRect(0, -1.6, 17, 3.2);
      ctx.beginPath();
      ctx.moveTo(17, -1.6);
      ctx.lineTo(21, 0);
      ctx.lineTo(17, 1.6);
      ctx.fill();
      ctx.fillStyle = '#7a5b2e';
      ctx.fillRect(-1, -4, 2.5, 8);
    }
    ctx.restore();

    // Equipped pieces re-dress the sprite; magic+ pieces take on their rarity tint.
    const piece = (item, base) => (item && item.rarity !== 'common' ? R.mix(base, item.color, 0.45) : base);

    // Boots: feet poking out under the cloak.
    if (eq.boots) {
      ctx.fillStyle = piece(eq.boots, eq.boots.tone || '#8a93a2');
      ctx.fillRect(p.x - 6.5, by + 7.5, 5, 4);
      ctx.fillRect(p.x + 1.5, by + 7.5, 5, 4);
    }

    // Pants: lower-body wrap above the feet.
    if (eq.pants) {
      ctx.fillStyle = piece(eq.pants, eq.pants.tone || '#6e6552');
      ctx.beginPath();
      ctx.ellipse(p.x, by + 5.5, 7.2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body: shirt-colored cloak, or a cuirass in the armor's weight-class tone.
    const shirt = p.shirt || '#4a5578';
    ctx.fillStyle = eq.armor ? R.shade(eq.armor.tone || '#5d6675', 0.78) : R.shade(shirt, 0.78);
    ctx.beginPath();
    ctx.ellipse(p.x, by + 2, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = eq.armor ? piece(eq.armor, eq.armor.tone || '#7b8494') : shirt;
    ctx.beginPath();
    ctx.ellipse(p.x, by - 1, 7.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (eq.armor) {
      ctx.fillStyle = piece(eq.armor, eq.armor.tone || '#98a2b0');
      ctx.beginPath();
      ctx.arc(p.x - 7, by - 3, 3, 0, Math.PI * 2);
      ctx.arc(p.x + 7, by - 3, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gloves: armored hand on the sword grip.
    if (eq.gloves) {
      ctx.fillStyle = piece(eq.gloves, eq.gloves.tone || '#9aa4b2');
      ctx.beginPath();
      ctx.arc(hx, hy, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head.
    ctx.fillStyle = '#d8b58f';
    ctx.beginPath();
    ctx.arc(p.x, by - 8, 5.2, 0, Math.PI * 2);
    ctx.fill();
    // Helmet replaces the cloth hood.
    if (eq.helmet) {
      ctx.fillStyle = piece(eq.helmet, eq.helmet.tone || '#98a2b0');
      ctx.beginPath();
      ctx.arc(p.x, by - 9, 5.6, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
      ctx.fillRect(p.x - 1, by - 9, 2, 5.5);
      ctx.fillStyle = piece(eq.helmet, '#c9a15a');
      ctx.fillRect(p.x - 0.8, by - 15.5, 1.6, 3);
    } else {
      ctx.fillStyle = '#2c3350';
      ctx.beginPath();
      ctx.arc(p.x, by - 9.5, 5.4, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
    }

    // Hurt flash.
    if (p.hurtT > 0) {
      ctx.globalAlpha = (p.hurtT / 0.3) * 0.55;
      ctx.fillStyle = '#ff2b1e';
      ctx.beginPath();
      ctx.arc(p.x, by - 2, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
})();
