// render/monster.js — monster sprites: body shapes per type, auras, eyes,
// hit flashes, health bars, and champion nameplates.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  R.drawMonster = function drawMonster(ctx, state, m) {
    const t = state.time;
    let ox = 0;
    let oy = 0;
    if (m.lungeT > 0) {
      const p = state.player;
      const a = Math.atan2(p.y - m.y, p.x - m.x);
      const k = Math.sin((m.lungeT / 0.18) * Math.PI) * 7;
      ox = Math.cos(a) * k;
      oy = Math.sin(a) * k;
    }
    const x = m.x + ox;
    const y = m.y + oy;
    const s = m.size;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.75, s * 0.85, s * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    if (m.boss) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.strokeStyle = `rgba(190,45,45,${0.4 + pulse * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y + s * 0.6, s + 8, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.champion) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = `rgba(255,154,61,${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y + s * 0.6, s + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    if (m.type === 'wraith') ctx.globalAlpha = 0.72;

    const bodyBob = Math.sin(t * 5 + m.x * 0.1) * 1.5;
    const by = y + bodyBob * 0.4;

    if (m.type === 'bat') {
      const flap = Math.sin(t * 16 + m.x) * 0.7;
      ctx.fillStyle = m.color;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, by);
        ctx.quadraticCurveTo(x + side * s * 1.6, by - s * (0.8 + flap), x + side * s * 2, by + s * 0.2);
        ctx.quadraticCurveTo(x + side * s * 1.1, by + s * 0.3, x, by + s * 0.25);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, by, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.type === 'swarmling') {
      // A skittering blob: low round body, quick twitchy legs, beady glint.
      const scuttle = Math.sin(t * 22 + m.x * 0.4);
      ctx.strokeStyle = R.shade(m.color, 0.6);
      ctx.lineWidth = 1.6;
      for (let i = -1; i <= 1; i++) {
        const legY = by + s * 0.2;
        const kick = scuttle * (i === 0 ? 0.6 : 1) * s * 0.35;
        ctx.beginPath();
        ctx.moveTo(x + i * s * 0.4, legY);
        ctx.lineTo(x + i * s * 0.9, legY + s * 0.5 + kick);
        ctx.moveTo(x + i * s * 0.4, legY);
        ctx.lineTo(x + i * s * 0.9, legY + s * 0.5 - kick);
        ctx.stroke();
      }
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.ellipse(x, by, s * 0.95, s * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = R.shade(m.color, 1.25);
      ctx.beginPath();
      ctx.ellipse(x - s * 0.2, by - s * 0.25, s * 0.35, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.type === 'wraith') {
      const wob = Math.sin(t * 6 + m.y * 0.08) * 2.5;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, by - s * 0.25, s * 0.75, Math.PI, 0);
      ctx.quadraticCurveTo(x + s * 0.9, by + s * 0.6, x + s * 0.45 + wob, by + s * 1.05);
      ctx.quadraticCurveTo(x, by + s * 0.5, x - s * 0.45 + wob, by + s * 1.05);
      ctx.quadraticCurveTo(x - s * 0.9, by + s * 0.6, x - s * 0.75, by - s * 0.25);
      ctx.fill();
    } else {
      // Grounded humanoids: zombie / skeleton / brute.
      ctx.fillStyle = R.shade(m.color, 0.8);
      ctx.beginPath();
      ctx.ellipse(x, by + s * 0.15, s * 0.8, s * 0.66, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, by - s * 0.35, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      if (m.type === 'brute') {
        ctx.fillStyle = R.shade(m.color, 1.15);
        ctx.beginPath();
        ctx.ellipse(x - s * 0.7, by - s * 0.15, s * 0.32, s * 0.42, 0.3, 0, Math.PI * 2);
        ctx.ellipse(x + s * 0.7, by - s * 0.15, s * 0.32, s * 0.42, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8e0d0';
        ctx.beginPath();
        ctx.moveTo(x - s * 0.3, by - s * 0.1);
        ctx.lineTo(x - s * 0.45, by - s * 0.5);
        ctx.lineTo(x - s * 0.15, by - s * 0.2);
        ctx.moveTo(x + s * 0.3, by - s * 0.1);
        ctx.lineTo(x + s * 0.45, by - s * 0.5);
        ctx.lineTo(x + s * 0.15, by - s * 0.2);
        ctx.fill();
      }
      if (m.type === 'skeleton') {
        ctx.strokeStyle = 'rgba(60,60,70,0.8)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - s * 0.45, by - s * 0.05 + i * 4);
          ctx.lineTo(x + s * 0.45, by - s * 0.05 + i * 4);
          ctx.stroke();
        }
      }
      if (m.type === 'zombie') {
        // Reaching stub arms.
        ctx.fillStyle = R.shade(m.color, 0.9);
        const armSwing = Math.sin(t * 6 + m.y) * 2;
        ctx.fillRect(x - s * 0.95, by - s * 0.2 + armSwing, s * 0.5, s * 0.28);
        ctx.fillRect(x + s * 0.45, by - s * 0.2 - armSwing, s * 0.5, s * 0.28);
      }
    }

    // Eyes: dim when idle, burning when aggroed.
    const eyeY = m.type === 'bat' || m.type === 'swarmling' ? by - 1 : by - s * 0.4;
    ctx.fillStyle = m.aggroed ? '#ff3b30' : 'rgba(20,10,10,0.85)';
    ctx.beginPath();
    ctx.arc(x - s * 0.2, eyeY, m.aggroed ? 2.2 : 1.7, 0, Math.PI * 2);
    ctx.arc(x + s * 0.2, eyeY, m.aggroed ? 2.2 : 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Hit flash.
    if (m.hitT > 0) {
      ctx.globalAlpha = (m.hitT / 0.16) * 0.75;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, by - s * 0.1, s * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // HP bar when wounded.
    if (m.hp < m.maxHP) {
      const w = Math.max(22, s * 2);
      const hx = x - w / 2;
      const hy = y - s - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = m.champion ? '#ff9a3d' : '#c62828';
      ctx.fillRect(hx, hy, (w * m.hp) / m.maxHP, 3);
    }

    if (m.champion) {
      ctx.font = 'bold 11px Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,5,8,0.7)';
      const tw = ctx.measureText(m.name).width;
      ctx.fillRect(x - tw / 2 - 4, y - s - 27, tw + 8, 14);
      ctx.fillStyle = '#ff9a3d';
      ctx.fillText(m.name, x, y - s - 16);
      ctx.textAlign = 'left';
    }
  };
})();
