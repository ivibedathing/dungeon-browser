// render/icons.js — item icons (also used by the inventory UI) and ground drops.
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const R = Render._;

  // Per-family weapon icons. Each draws around the origin; the caller has already
  // translated/scaled. Unknown families fall back to 'sword' so old saves still draw.
  const STEEL = '#b9c2c9';
  const DARK_STEEL = '#8f98a0';
  const WOOD = '#7a5b2e';
  const GOLD = '#d9c06a';

  function drawWeaponIcon(ctx, family) {
    switch (family) {
      case 'greatsword':
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = STEEL;
        ctx.fillRect(-3, -15, 6, 22);
        ctx.beginPath();
        ctx.moveTo(-3, -15);
        ctx.lineTo(0, -20);
        ctx.lineTo(3, -15);
        ctx.fill();
        ctx.fillStyle = GOLD;
        ctx.fillRect(-9, 6, 18, 3);
        ctx.fillStyle = WOOD;
        ctx.fillRect(-2, 9, 4, 7);
        break;
      case 'dagger':
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = STEEL;
        ctx.fillRect(-1.6, -8, 3.2, 12);
        ctx.beginPath();
        ctx.moveTo(-1.6, -8);
        ctx.lineTo(0, -12);
        ctx.lineTo(1.6, -8);
        ctx.fill();
        ctx.fillStyle = WOOD;
        ctx.fillRect(-4.5, 4, 9, 2.5);
        ctx.fillRect(-1.2, 6.5, 2.4, 4);
        break;
      case 'axe':
        ctx.fillStyle = WOOD; // haft
        ctx.fillRect(-1.5, -13, 3, 26);
        ctx.fillStyle = DARK_STEEL; // blade
        ctx.beginPath();
        ctx.moveTo(1.5, -12);
        ctx.quadraticCurveTo(13, -9, 11, -1);
        ctx.quadraticCurveTo(6, -4, 1.5, -3);
        ctx.fill();
        ctx.fillStyle = STEEL;
        ctx.beginPath();
        ctx.moveTo(1.5, -12);
        ctx.quadraticCurveTo(11, -9, 10, -3);
        ctx.lineTo(1.5, -4);
        ctx.fill();
        break;
      case 'mace':
        ctx.fillStyle = WOOD;
        ctx.fillRect(-1.5, -4, 3, 18);
        ctx.fillStyle = DARK_STEEL;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 5, -9 + Math.sin(a) * 5);
          ctx.lineTo(Math.cos(a) * 8, -9 + Math.sin(a) * 8);
          ctx.lineTo(Math.cos(a + 0.5) * 5, -9 + Math.sin(a + 0.5) * 5);
          ctx.fill();
        }
        ctx.fillStyle = STEEL;
        ctx.beginPath();
        ctx.arc(0, -9, 5.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'flail':
        ctx.fillStyle = WOOD;
        ctx.fillRect(-1.4, 0, 2.8, 14);
        ctx.strokeStyle = DARK_STEEL; // chain
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-5, -8);
        ctx.stroke();
        ctx.fillStyle = STEEL; // spiked ball
        ctx.beginPath();
        ctx.arc(-7, -10, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = DARK_STEEL;
        for (const [dx, dy] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) {
          ctx.fillRect(-7 + dx * 1.1 - 0.8, -10 + dy * 1.1 - 0.8, 1.6, 1.6);
        }
        break;
      case 'spear':
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = WOOD;
        ctx.fillRect(-1.2, -8, 2.4, 22);
        ctx.fillStyle = STEEL; // leaf blade
        ctx.beginPath();
        ctx.moveTo(0, -17);
        ctx.quadraticCurveTo(3.5, -12, 0, -8);
        ctx.quadraticCurveTo(-3.5, -12, 0, -17);
        ctx.fill();
        break;
      case 'bow':
        ctx.strokeStyle = WOOD;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(3, 0, 12, Math.PI * 0.55, Math.PI * 1.45);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230,225,205,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(3 + Math.cos(Math.PI * 0.55) * 12, Math.sin(Math.PI * 0.55) * 12);
        ctx.lineTo(3 + Math.cos(Math.PI * 1.45) * 12, Math.sin(Math.PI * 1.45) * 12);
        ctx.stroke();
        ctx.strokeStyle = '#c9b37e'; // nocked arrow
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(9, 0);
        ctx.stroke();
        break;
      case 'crossbow':
        ctx.fillStyle = WOOD; // stock
        ctx.fillRect(-2, -3, 4, 15);
        ctx.strokeStyle = DARK_STEEL; // limbs
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, -3, 10, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230,225,205,0.9)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(Math.cos(Math.PI * 1.15) * 10, -3 + Math.sin(Math.PI * 1.15) * 10);
        ctx.lineTo(Math.cos(Math.PI * 1.85) * 10, -3 + Math.sin(Math.PI * 1.85) * 10);
        ctx.stroke();
        ctx.fillStyle = '#c9b37e';
        ctx.fillRect(-0.8, -12, 1.6, 9);
        break;
      case 'wand':
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = '#5e4470';
        ctx.fillRect(-1.4, -2, 2.8, 15);
        ctx.fillStyle = '#ff9a3d';
        ctx.beginPath();
        ctx.arc(0, -5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff3c0';
        ctx.beginPath();
        ctx.arc(-1, -6, 1.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'staff':
        ctx.rotate(-Math.PI / 8);
        ctx.fillStyle = WOOD;
        ctx.fillRect(-1.5, -10, 3, 24);
        ctx.fillStyle = '#6fd0ff';
        ctx.beginPath();
        ctx.arc(0, -13, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(-1.6, -14.5, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'thrown':
        ctx.rotate(-0.4);
        ctx.fillStyle = WOOD;
        ctx.fillRect(-1.2, -6, 2.4, 16);
        ctx.fillStyle = DARK_STEEL;
        ctx.beginPath();
        ctx.moveTo(1.2, -6);
        ctx.quadraticCurveTo(9, -3, 7, 3);
        ctx.lineTo(1.2, 0);
        ctx.fill();
        break;
      case 'sword':
      default:
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = STEEL;
        ctx.fillRect(-2, -12, 4, 17);
        ctx.beginPath();
        ctx.moveTo(-2, -12);
        ctx.lineTo(0, -16);
        ctx.lineTo(2, -12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = WOOD;
        ctx.fillRect(-6, 5, 12, 3);
        ctx.fillRect(-1.5, 8, 3, 5);
        break;
    }
  }

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
      drawWeaponIcon(ctx, item.family || 'sword');
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
