// render/monster.js — monster sprites: body shapes per type, auras, eyes,
// hit flashes, health bars, and champion nameplates.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  // The slam telegraph. Drawn on the GROUND, under every monster body, so a boss
  // standing in its own circle never hides it. Without this the wind-up is
  // invisible and the hit reads as unfair damage rather than a dodgeable attack —
  // which is the whole point of the mechanic.
  R.drawTelegraph = function drawTelegraph(ctx, state, m) {
    if (!(m.telegraphT > 0) || !m.telegraph) return;
    const tg = m.telegraph;
    const r = tg.r || m.slamRadius || 90;
    const windup = m.slamWindup || 0.8;
    const fill = Math.max(0, Math.min(1, 1 - m.telegraphT / windup)); // 0 -> 1 as it closes
    const pulse = 0.55 + 0.45 * Math.sin(state.time * 18);

    ctx.save();
    // Danger zone.
    ctx.fillStyle = `rgba(200,40,30,${0.14 + 0.12 * fill})`;
    ctx.beginPath();
    ctx.arc(tg.x, tg.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Rim, brightening as impact approaches.
    ctx.strokeStyle = `rgba(255,120,60,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2 + 2 * fill;
    ctx.stroke();
    // A filling disc is the actual countdown: when it reaches the rim, it lands.
    ctx.fillStyle = `rgba(255,154,61,${0.20 + 0.25 * fill})`;
    ctx.beginPath();
    ctx.arc(tg.x, tg.y, r * fill, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

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

    // Telegraph: a wind-up cue rendered whenever a special is charging (m.tel 0..1).
    // Colour reads by archetype so casts, fuses, and charges are distinguishable.
    if (m.tel > 0) {
      const TEL_COLOR = { cultist: '180,107,255', necromancer: '111,208,111', bomber: '255,138,61', gargoyle: '220,225,235' };
      const rgb = TEL_COLOR[m.type] || '255,220,120';
      const rr = s + 4 + m.tel * 6;
      ctx.strokeStyle = `rgba(${rgb},${0.35 + m.tel * 0.45})`;
      ctx.lineWidth = 2 + m.tel * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.tel);
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
    } else if (m.type === 'hound') {
      // Low quadruped: four trotting legs, elongated body, snouted head.
      const gait = Math.sin(t * 12 + m.x * 0.3) * s * 0.28;
      ctx.strokeStyle = R.shade(m.color, 0.55);
      ctx.lineWidth = 2.4;
      const legs = [[-0.55, gait], [-0.2, -gait], [0.3, gait], [0.65, -gait]];
      for (const [lx, ph] of legs) {
        ctx.beginPath();
        ctx.moveTo(x + lx * s, by);
        ctx.lineTo(x + lx * s + ph, by + s * 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.ellipse(x, by - s * 0.05, s * 1.05, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath(); // head forward-right
      ctx.arc(x + s * 0.95, by - s * 0.25, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = R.shade(m.color, 0.8);
      ctx.fillRect(x + s * 1.2, by - s * 0.35, s * 0.6, s * 0.35); // snout
      ctx.beginPath(); // pointed ear
      ctx.moveTo(x + s * 0.8, by - s * 0.6);
      ctx.lineTo(x + s * 0.7, by - s * 1.0);
      ctx.lineTo(x + s * 1.05, by - s * 0.65);
      ctx.fill();
    } else if (m.type === 'spider') {
      // Round abdomen + small head, eight bent legs skittering.
      const twitch = Math.sin(t * 20 + m.x * 0.5);
      ctx.strokeStyle = R.shade(m.color, 0.7);
      ctx.lineWidth = 1.5;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const ay = by - s * 0.3 + i * s * 0.28;
          const kick = twitch * (i % 2 ? 1 : -1) * s * 0.2;
          ctx.beginPath();
          ctx.moveTo(x, ay);
          ctx.lineTo(x + side * s * 0.9, ay - s * 0.15 + kick);
          ctx.lineTo(x + side * s * 1.3, ay + s * 0.25 + kick);
          ctx.stroke();
        }
      }
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.ellipse(x, by + s * 0.15, s * 0.7, s * 0.6, 0, 0, Math.PI * 2); // abdomen
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, by - s * 0.5, s * 0.38, 0, Math.PI * 2); // head
      ctx.fill();
    } else if (m.type === 'bomber') {
      // A bloated round body with a lit fuse that flares as it primes.
      ctx.fillStyle = R.shade(m.color, 0.85);
      ctx.beginPath();
      ctx.arc(x, by, s * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = R.shade(m.color, 1.2);
      ctx.beginPath();
      ctx.arc(x - s * 0.25, by - s * 0.25, s * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6b5330'; // fuse
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, by - s * 0.9);
      ctx.lineTo(x + s * 0.2, by - s * 1.3);
      ctx.stroke();
      const spark = 1.4 + (m.fuseT ? Math.sin(t * 40) * 1 : Math.sin(t * 12) * 0.5);
      ctx.fillStyle = m.fuseT ? '#ffd84d' : '#ff9a3d';
      ctx.beginPath();
      ctx.arc(x + s * 0.2, by - s * 1.3, spark + 1, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.type === 'gargoyle') {
      // Stone humanoid with a pair of spread wings.
      const flap = Math.sin(t * 6 + m.x * 0.1) * 0.25;
      ctx.fillStyle = R.shade(m.color, 0.7);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + side * s * 0.3, by - s * 0.2);
        ctx.quadraticCurveTo(x + side * s * 1.3, by - s * (0.9 + flap), x + side * s * 1.2, by + s * 0.3);
        ctx.quadraticCurveTo(x + side * s * 0.7, by - s * 0.1, x + side * s * 0.3, by + s * 0.1);
        ctx.fill();
      }
      ctx.fillStyle = R.shade(m.color, 0.85);
      ctx.beginPath();
      ctx.ellipse(x, by + s * 0.1, s * 0.6, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, by - s * 0.5, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = R.shade(m.color, 1.15); // horns
      ctx.beginPath();
      ctx.moveTo(x - s * 0.3, by - s * 0.7);
      ctx.lineTo(x - s * 0.45, by - s * 1.05);
      ctx.lineTo(x - s * 0.15, by - s * 0.75);
      ctx.moveTo(x + s * 0.3, by - s * 0.7);
      ctx.lineTo(x + s * 0.45, by - s * 1.05);
      ctx.lineTo(x + s * 0.15, by - s * 0.75);
      ctx.fill();
    } else {
      // Grounded humanoids: zombie / skeleton / brute / ghoul / skeleton_knight / ogre
      // and the robed casters (cultist / necromancer).
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
      if (m.type === 'zombie' || m.type === 'ghoul') {
        // Reaching stub arms (longer and lankier on the ghoul).
        ctx.fillStyle = R.shade(m.color, 0.9);
        const armSwing = Math.sin(t * 6 + m.y) * 2;
        const armLen = m.type === 'ghoul' ? 0.62 : 0.5;
        ctx.fillRect(x - s * (0.45 + armLen), by - s * 0.2 + armSwing, s * armLen, s * 0.26);
        ctx.fillRect(x + s * 0.45, by - s * 0.2 - armSwing, s * armLen, s * 0.26);
      }
      if (m.type === 'ghoul') {
        // Sunken pale brow ridge.
        ctx.fillStyle = R.shade(m.color, 1.3);
        ctx.beginPath();
        ctx.arc(x, by - s * 0.5, s * 0.3, Math.PI, 0);
        ctx.fill();
      }
      if (m.type === 'skeleton_knight') {
        // Ribs plus a plated helm and pauldrons.
        ctx.strokeStyle = 'rgba(60,60,70,0.8)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - s * 0.4, by - s * 0.05 + i * 4);
          ctx.lineTo(x + s * 0.4, by - s * 0.05 + i * 4);
          ctx.stroke();
        }
        ctx.fillStyle = R.shade(m.color, 1.1);
        ctx.beginPath(); // helm
        ctx.arc(x, by - s * 0.42, s * 0.6, Math.PI * 0.95, Math.PI * 2.05);
        ctx.fill();
        ctx.fillRect(x - s * 0.08, by - s * 0.5, s * 0.16, s * 0.4); // noseguard
        ctx.beginPath(); // pauldrons
        ctx.arc(x - s * 0.75, by - s * 0.1, s * 0.28, 0, Math.PI * 2);
        ctx.arc(x + s * 0.75, by - s * 0.1, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.type === 'ogre') {
        // Heavy belly and a pair of jutting tusks.
        ctx.fillStyle = R.shade(m.color, 0.7);
        ctx.beginPath();
        ctx.ellipse(x, by + s * 0.35, s * 0.7, s * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8e0d0';
        ctx.beginPath();
        ctx.moveTo(x - s * 0.22, by - s * 0.22);
        ctx.lineTo(x - s * 0.3, by - s * 0.55);
        ctx.lineTo(x - s * 0.1, by - s * 0.28);
        ctx.moveTo(x + s * 0.22, by - s * 0.22);
        ctx.lineTo(x + s * 0.3, by - s * 0.55);
        ctx.lineTo(x + s * 0.1, by - s * 0.28);
        ctx.fill();
      }
      if (m.type === 'cultist' || m.type === 'necromancer') {
        // A pointed hood pulled low over the head, with a shadowed face.
        ctx.fillStyle = R.shade(m.color, 0.7);
        ctx.beginPath();
        ctx.moveTo(x - s * 0.55, by - s * 0.3);
        ctx.quadraticCurveTo(x, by - s * 1.15, x + s * 0.55, by - s * 0.3);
        ctx.quadraticCurveTo(x, by - s * 0.55, x - s * 0.55, by - s * 0.3);
        ctx.fill();
        ctx.fillStyle = 'rgba(10,8,14,0.75)';
        ctx.beginPath();
        ctx.arc(x, by - s * 0.34, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
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
