// ui/party.js — co-op party UX: the ally roster bar (top-left), the shared-descent
// countdown banner, and the pure selectors behind them (node-tested). Solo shows
// nothing extra: a one-player party renders no bar.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS } = I;
  const Ent = typeof window !== 'undefined' ? window.Entities : require('../entities.js');
  const Bal = typeof window !== 'undefined' ? window.Balance : require('../balance.js');

  // One row per player for the party bar. Pure — reads only the render state, so it
  // works off a solo state (own player) or a net render state (snapshot players[]).
  // Returns [] for a solo (single-player) run so nothing is drawn.
  UI.partyRows = function partyRows(state) {
    const players = state.players && state.players.length ? state.players : [state.player];
    if (players.length <= 1) return [];
    const you = state.player;
    return players.map((p) => {
      // maxHP may not ride the wire for allies; fall back to their reported maxHP.
      const maxHP = p.maxHP || (p.equip ? Ent.effectiveStats(p).maxHP : p.hp) || 1;
      const reviveT = p.reviveT || 0;
      return {
        id: p.id,
        name: p.name || 'Ally',
        shirt: p.shirt || '#4a5578',
        isYou: p === you || p.id === (you && you.id),
        level: p.level || 1,
        hpFrac: Math.max(0, Math.min(1, (p.hp || 0) / maxHP)),
        down: !!p.down,
        dead: !!p.dead,
        reviveFrac: reviveT > 0 ? Math.max(0, Math.min(1, reviveT / Bal.coop.reviveTime)) : 0,
      };
    });
  };

  // "Descending in N…" while a shared descent is counting down, else null.
  UI.descentBannerText = function descentBannerText(descendT) {
    if (typeof descendT !== 'number' || descendT <= 0) return null;
    return `Descending in ${Math.ceil(descendT)}…`;
  };

  I.drawPartyBar = function drawPartyBar(ctx, state, L) {
    const rows = UI.partyRows(state);
    if (!rows.length) return;
    const x = 12;
    let y = 44;
    const w = 168;
    const rowH = 34;
    for (const r of rows) {
      ctx.fillStyle = 'rgba(8,6,5,0.72)';
      ctx.fillRect(x, y, w, rowH - 4);
      // shirt swatch
      ctx.fillStyle = r.down || r.dead ? 'rgba(120,120,130,0.6)' : r.shirt;
      ctx.fillRect(x + 4, y + 4, 8, rowH - 12);
      // name + level
      ctx.font = `bold 11px ${SANS}`;
      ctx.fillStyle = r.isYou ? '#ffd84d' : r.down || r.dead ? '#8a8a92' : '#e8e2d6';
      ctx.textAlign = 'left';
      ctx.fillText(`${r.name}  L${r.level}`, x + 18, y + 14);
      // hp bar (or DOWN state)
      const bx = x + 18;
      const bw = w - 26;
      ctx.fillStyle = '#2a0d10';
      ctx.fillRect(bx, y + 18, bw, 6);
      if (r.down) {
        // revive progress fills green over the downed bar
        ctx.fillStyle = 'rgba(143,232,154,0.9)';
        ctx.fillRect(bx, y + 18, bw * r.reviveFrac, 6);
        ctx.font = `bold 9px ${SANS}`;
        ctx.fillStyle = '#ff8d85';
        ctx.textAlign = 'right';
        ctx.fillText('DOWN', x + w - 4, y + 14);
      } else {
        const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        hg.addColorStop(0, '#7e1420');
        hg.addColorStop(1, '#c2202e');
        ctx.fillStyle = hg;
        ctx.fillRect(bx, y + 18, bw * r.hpFrac, 6);
      }
      y += rowH;
    }
    ctx.textAlign = 'left';
  };

  I.drawDescentBanner = function drawDescentBanner(ctx, state, view) {
    const text = UI.descentBannerText(state.descendT);
    if (!text) return;
    ctx.font = `bold 22px ${SERIF}`;
    ctx.textAlign = 'center';
    const pulse = 0.7 + 0.3 * Math.sin((state.time || 0) * 6);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(text, view.w / 2 + 2, view.h * 0.2 + 2);
    ctx.fillStyle = `rgba(150,200,255,${pulse})`;
    ctx.fillText(text, view.w / 2, view.h * 0.2);
    ctx.textAlign = 'left';
  };

  if (typeof module !== 'undefined') module.exports = UI;
})();
