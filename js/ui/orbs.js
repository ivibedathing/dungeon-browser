// ui/orbs.js — the life and mana globes flanking the bottom HUD.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SANS } = I;

  I.drawOrb = function drawOrb(ctx, state, L) {
    const { cx, cy, r } = L.orb;
    const p = state.player;
    const stats = Entities.effectiveStats(p);
    const frac = Math.max(0, Math.min(1, p.hp / stats.maxHP));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1c0709';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const top = cy + r - 2 * r * frac;
    const wave = Math.sin(state.time * 2.2) * 1.6;
    const g = ctx.createLinearGradient(0, top, 0, cy + r);
    g.addColorStop(0, '#e04a3a');
    g.addColorStop(0.25, '#a31c22');
    g.addColorStop(1, '#5e0d14');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, top + wave, r * 2, r * 2);
    ctx.fillRect(cx - r, top + 2, r * 2, r * 2);
    // Glass shine.
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.45, r * 0.42, r * 0.25, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#6e5433';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#2a2018';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
    ctx.stroke();

    if (p.healPool > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 8);
      ctx.strokeStyle = `rgba(111,208,111,${0.3 + pulse * 0.4})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = `bold 16px ${SANS}`;
    ctx.fillStyle = '#ffe9e2';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    const hpText = `${Math.ceil(p.hp)}`;
    ctx.strokeText(hpText, cx, cy + 1);
    ctx.fillText(hpText, cx, cy + 1);
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(255,220,210,0.75)';
    ctx.fillText(`of ${stats.maxHP}`, cx, cy + 14);
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#c9a15a';
    ctx.textAlign = 'center';
    ctx.fillText('LIFE', cx, cy - r - 8);
    ctx.textAlign = 'left';
  };

  I.drawManaOrb = function drawManaOrb(ctx, state, L) {
    const { cx, cy, r } = L.manaOrb;
    const p = state.player;
    const stats = Entities.effectiveStats(p);
    const frac = Math.max(0, Math.min(1, (p.mana || 0) / stats.maxMana));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#060d1f';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const top = cy + r - 2 * r * frac;
    const wave = Math.sin(state.time * 2.6 + 1) * 1.6;
    const g = ctx.createLinearGradient(0, top, 0, cy + r);
    g.addColorStop(0, '#4a9de0');
    g.addColorStop(0.25, '#1f56b0');
    g.addColorStop(1, '#0c2a66');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, top + wave, r * 2, r * 2);
    ctx.fillRect(cx - r, top + 2, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.45, r * 0.42, r * 0.25, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#6e5433';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#2a2018';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `bold 16px ${SANS}`;
    ctx.fillStyle = '#dcedff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    const text = `${Math.floor(p.mana || 0)}`;
    ctx.strokeText(text, cx, cy + 1);
    ctx.fillText(text, cx, cy + 1);
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(210,230,255,0.75)';
    ctx.fillText(`of ${Math.round(stats.maxMana)}`, cx, cy + 14);
    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#7fa8ff';
    ctx.fillText('MANA', cx, cy - r - 8);
    ctx.textAlign = 'left';
  };
})();
