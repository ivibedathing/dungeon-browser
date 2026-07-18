// render/props.js — breakable decorations: barrels, crates, pots, tables, chairs,
// weapon stands, and treasure chests. Hand-drawn Canvas 2D like the monster/tile
// sprites, with a ground shadow, a white hit-flash, and cracks once damaged.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  // Wood/stone/metal palettes per type: [base, dark, light].
  const TONES = {
    barrel: ['#8a6a3e', '#5f4728', '#a9824c'],
    crate: ['#a9824c', '#775a34', '#c49a5e'],
    pot: ['#9a7250', '#6b4d35', '#b98f68'],
    table: ['#7a5636', '#523821', '#996f47'],
    chair: ['#7a5636', '#523821', '#996f47'],
    stand: ['#8b8b93', '#5c5c63', '#b7b7bf'],
    chest: ['#8a5a2c', '#5f3c1c', '#c9a14a'],
  };

  function shadow(ctx, x, y, w) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + 9, w, w * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawShape(ctx, type, x, y, s) {
    const [base, dark, light] = TONES[type] || TONES.crate;
    ctx.lineWidth = 1.5;
    if (type === 'barrel') {
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.8, y - s);
      ctx.quadraticCurveTo(x - s * 1.05, y, x - s * 0.8, y + s);
      ctx.lineTo(x + s * 0.8, y + s);
      ctx.quadraticCurveTo(x + s * 1.05, y, x + s * 0.8, y - s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      for (const yy of [-s * 0.5, s * 0.1, s * 0.7]) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.98, y + yy);
        ctx.lineTo(x + s * 0.98, y + yy);
        ctx.stroke();
      }
      ctx.strokeStyle = light;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, y - s * 0.9);
      ctx.lineTo(x - s * 0.4, y + s * 0.9);
      ctx.stroke();
    } else if (type === 'crate') {
      ctx.fillStyle = base;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
      ctx.strokeStyle = dark;
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      ctx.strokeStyle = light;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    } else if (type === 'pot') {
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.55, y - s);
      ctx.lineTo(x + s * 0.55, y - s);
      ctx.lineTo(x + s * 0.45, y - s * 0.7);
      ctx.quadraticCurveTo(x + s, y - s * 0.1, x + s * 0.55, y + s);
      ctx.lineTo(x - s * 0.55, y + s);
      ctx.quadraticCurveTo(x - s, y - s * 0.1, x - s * 0.45, y - s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.beginPath();
      ctx.ellipse(x, y - s, s * 0.55, s * 0.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.beginPath();
      ctx.arc(x - s * 0.15, y, s * 0.55, Math.PI * 0.7, Math.PI * 1.15);
      ctx.stroke();
    } else if (type === 'table') {
      ctx.fillStyle = dark;
      ctx.fillRect(x - s * 0.85, y - s * 0.2, s * 0.18, s * 1.1);
      ctx.fillRect(x + s * 0.67, y - s * 0.2, s * 0.18, s * 1.1);
      ctx.fillStyle = base;
      ctx.fillRect(x - s, y - s * 0.5, s * 2, s * 0.5);
      ctx.fillStyle = light;
      ctx.fillRect(x - s, y - s * 0.5, s * 2, s * 0.14);
    } else if (type === 'chair') {
      ctx.fillStyle = dark;
      ctx.fillRect(x - s * 0.6, y - s, s * 0.16, s * 1.9);
      ctx.fillStyle = base;
      ctx.fillRect(x - s * 0.6, y - s, s * 0.7, s * 0.16); // backrest top
      ctx.fillRect(x - s * 0.6, y + s * 0.1, s * 1.2, s * 0.2); // seat
      ctx.fillStyle = dark;
      ctx.fillRect(x - s * 0.55, y + s * 0.3, s * 0.14, s * 0.6);
      ctx.fillRect(x + s * 0.45, y + s * 0.3, s * 0.14, s * 0.6);
    } else if (type === 'stand') {
      // A weapon rack: a stone post with a sword propped against it.
      ctx.fillStyle = base;
      ctx.fillRect(x - s * 0.2, y - s, s * 0.4, s * 2);
      ctx.fillStyle = dark;
      ctx.fillRect(x - s * 0.5, y + s * 0.75, s, s * 0.3);
      ctx.strokeStyle = light;
      ctx.beginPath(); // blade
      ctx.moveTo(x + s * 0.15, y + s);
      ctx.lineTo(x + s * 0.55, y - s * 0.9);
      ctx.stroke();
      ctx.strokeStyle = '#c9a14a';
      ctx.beginPath(); // crossguard
      ctx.moveTo(x - s * 0.05, y + s * 0.55);
      ctx.lineTo(x + s * 0.45, y + s * 0.45);
      ctx.stroke();
    } else if (type === 'chest') {
      ctx.fillStyle = base;
      ctx.fillRect(x - s, y - s * 0.2, s * 2, s * 1.1);
      ctx.fillStyle = dark;
      ctx.beginPath(); // domed lid
      ctx.moveTo(x - s, y - s * 0.2);
      ctx.quadraticCurveTo(x, y - s * 1.1, x + s, y - s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = light; // gold bands + lock
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s * 0.2);
      ctx.lineTo(x + s, y - s * 0.2);
      ctx.stroke();
      ctx.fillStyle = light;
      ctx.fillRect(x - s * 0.18, y - s * 0.15, s * 0.36, s * 0.4);
    }
  }

  R.drawProp = function drawProp(ctx, state, prop) {
    const s = prop.size || 11;
    const x = prop.x;
    const y = prop.y;
    shadow(ctx, x, y, s * 0.9);

    // Treasure chests glimmer so they read as worth the trip across the room.
    if (prop.type === 'chest') {
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);
      const g = ctx.createRadialGradient(x, y, 2, x, y, s * 2.4);
      g.addColorStop(0, `rgba(255,220,120,${0.14 + pulse * 0.12})`);
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawShape(ctx, prop.type, x, y, s);

    // Cracks once chipped: a couple of dark jagged strokes scaled to the damage.
    if (prop.hp < prop.maxHP) {
      ctx.strokeStyle = 'rgba(20,12,8,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.3, y - s * 0.6);
      ctx.lineTo(x - s * 0.05, y - s * 0.1);
      ctx.lineTo(x - s * 0.25, y + s * 0.4);
      ctx.moveTo(x + s * 0.35, y - s * 0.3);
      ctx.lineTo(x + s * 0.1, y + s * 0.2);
      ctx.stroke();
    }

    // White hit-flash, same feedback language as monsters.
    if (prop.hitT > 0) {
      ctx.globalAlpha = Math.min(0.7, (prop.hitT / 0.12) * 0.7);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, s * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1;
  };
})();
