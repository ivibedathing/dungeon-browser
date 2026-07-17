// render/icons.js — item icons (also used by the inventory UI) and ground drops.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  function drawItemIcon(ctx, item, x, y, scale) {
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (item.slot === 'potion') {
      ctx.fillStyle = '#31171a';
      ctx.fillRect(-3, -9, 6, 4);
      ctx.fillStyle = item.color || '#c8353b';
      ctx.beginPath();
      ctx.arc(0, 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(-2, -1, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.slot === 'weapon') {
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#b9c2c9';
      ctx.fillRect(-2, -12, 4, 17);
      ctx.beginPath();
      ctx.moveTo(-2, -12);
      ctx.lineTo(0, -16);
      ctx.lineTo(2, -12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7a5b2e';
      ctx.fillRect(-6, 5, 12, 3);
      ctx.fillRect(-1.5, 8, 3, 5);
    } else if (item.slot === 'armor') {
      ctx.fillStyle = item.tone || '#8a94a0';
      ctx.beginPath();
      ctx.moveTo(-8, -8);
      ctx.lineTo(8, -8);
      ctx.lineTo(6, 2);
      ctx.lineTo(4, 10);
      ctx.lineTo(-4, 10);
      ctx.lineTo(-6, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-8, -8, 16, 3);
    } else if (item.slot === 'helmet') {
      ctx.fillStyle = item.tone || '#98a2b0';
      ctx.beginPath();
      ctx.arc(0, 0, 8, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-9, -1, 18, 3);
      ctx.fillRect(-1.5, 2, 3, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-6, -1, 4, 2);
      ctx.fillRect(2, -1, 4, 2);
    } else if (item.slot === 'gloves') {
      ctx.fillStyle = item.tone || '#8f97a5';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 5, 0);
        ctx.rotate(side * 0.25);
        ctx.fillRect(-3, -7, 6, 11);
        ctx.beginPath();
        ctx.arc(0, 4, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (item.slot === 'pants') {
      ctx.fillStyle = item.tone || '#7d7463';
      ctx.fillRect(-7, -8, 14, 5);
      ctx.fillRect(-7, -4, 5.5, 13);
      ctx.fillRect(1.5, -4, 5.5, 13);
    } else if (item.slot === 'boots') {
      ctx.fillStyle = item.tone || '#6f665a';
      for (const side of [-1, 1]) {
        const bx = side * 5 - 2.5;
        ctx.fillRect(bx, -7, 5, 10);
        ctx.fillRect(bx, 1, side > 0 ? 8 : 5, 4.5);
      }
    } else {
      // ring
      ctx.strokeStyle = '#d9c06a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 1, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#9adfff';
      ctx.beginPath();
      ctx.arc(0, -6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  Render.drawItemIcon = drawItemIcon;

  R.drawGroundItem = function drawGroundItem(ctx, state, g, playerNear) {
    const bob = Math.sin(state.time * 3 + g.x) * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 8, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (g.kind === 'gold') {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? '#ffe084' : '#e3b23c';
        ctx.beginPath();
        ctx.arc(g.x + (i - 1) * 5, g.y + (i % 2) * 3, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    drawItemIcon(ctx, g.item, g.x, g.y + bob * 0.4, 0.9);
    if (playerNear) {
      const label = Items.displayName(g.item);
      ctx.font = 'bold 11px Verdana, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,5,8,0.82)';
      ctx.fillRect(g.x - tw / 2 - 5, g.y - 30, tw + 10, 15);
      ctx.fillStyle = g.item.color;
      ctx.textAlign = 'center';
      ctx.fillText(label, g.x, g.y - 19);
      ctx.textAlign = 'left';
    }
  };
})();
