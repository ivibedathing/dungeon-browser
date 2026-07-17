// render/fixtures.js — portals and the Ashfall Camp fixtures (well, vendor, smith).
(function () {
  const Render = typeof window !== 'undefined' ? window.Render : require('./core.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const R = Render._;
  const TS = Dungeon.TILE_SIZE;

  R.drawPortal = function drawPortal(ctx, state, po) {
    const t = state.time;
    const scale = po.armT > 0 ? 1 - po.armT * 0.8 : 1;
    const g = ctx.createRadialGradient(po.x, po.y, 2, po.x, po.y, 26 * scale);
    g.addColorStop(0, 'rgba(210,235,255,0.85)');
    g.addColorStop(0.5, 'rgba(90,150,255,0.45)');
    g.addColorStop(1, 'rgba(60,90,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(po.x, po.y, 26 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(po.x, po.y);
    for (let i = 0; i < 3; i++) {
      const a = t * (2.2 - i * 0.5) + i * 2.1;
      ctx.strokeStyle = `rgba(160,205,255,${(0.55 - i * 0.13) * scale})`;
      ctx.lineWidth = 2.2 - i * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, (8 + i * 5) * scale, a, a + 2.1);
      ctx.stroke();
    }
    ctx.restore();
    // Waypoints wear their destination on a little sign.
    if (po.kind === 'waypoint' && po.floor) {
      ctx.font = 'bold 10px Verdana, sans-serif';
      ctx.textAlign = 'center';
      const label = `Floor ${po.floor}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,5,8,0.75)';
      ctx.fillRect(po.x - tw / 2 - 4, po.y - 41, tw + 8, 13);
      ctx.fillStyle = '#8fc6ff';
      ctx.fillText(label, po.x, po.y - 31);
      ctx.textAlign = 'left';
    }
  };

  R.drawTownFixtures = function drawTownFixtures(ctx, state) {
    const d = state.dungeon;
    const t = state.time;
    // Healing well.
    const wx = (d.well.x + 0.5) * TS;
    const wy = (d.well.y + 0.5) * TS;
    ctx.fillStyle = '#635d4e';
    ctx.beginPath();
    ctx.arc(wx, wy, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#736c5b';
    ctx.beginPath();
    ctx.arc(wx, wy, 13.5, 0, Math.PI * 2);
    ctx.fill();
    const wg = ctx.createRadialGradient(wx, wy, 1, wx, wy, 11);
    wg.addColorStop(0, '#9fe8f5');
    wg.addColorStop(1, '#155e75');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(wx, wy, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(200,245,255,${0.3 + 0.25 * Math.sin(t * 2.5)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(wx, wy, 5.5 + Math.sin(t * 2.5) * 2, 0, Math.PI * 2);
    ctx.stroke();

    // Vendor.
    const vx = (d.vendor.x + 0.5) * TS;
    const vy = (d.vendor.y + 0.5) * TS;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(vx, vy + 9, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (state.trading) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = `rgba(255,216,77,${0.25 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(vx, vy + 4, 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#6e4f30';
    ctx.beginPath();
    ctx.ellipse(vx, vy + 1, 8.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8b58f';
    ctx.beginPath();
    ctx.arc(vx, vy - 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3520';
    ctx.beginPath();
    ctx.arc(vx, vy - 9.5, 5.2, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.font = 'bold 11px Verdana, sans-serif';
    ctx.textAlign = 'center';
    const label = 'Grizzle the Trader';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(8,5,8,0.7)';
    ctx.fillRect(vx - tw / 2 - 4, vy - 33, tw + 8, 14);
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(label, vx, vy - 22);
    ctx.textAlign = 'left';

    // Blacksmith: Borin, his anvil, and a smithing glow when you're in range.
    const bx = (d.smith.x + 0.5) * TS;
    const by2 = (d.smith.y + 0.5) * TS;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(bx, by2 + 9, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (state.smithing) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = `rgba(255,216,77,${0.25 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by2 + 4, 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Anvil beside him.
    ctx.fillStyle = '#3a3d44';
    ctx.fillRect(bx + 14, by2 - 2, 16, 7);
    ctx.fillRect(bx + 18, by2 + 5, 8, 6);
    ctx.beginPath();
    ctx.ellipse(bx + 14, by2 + 1, 4, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Borin: broad, aproned, hammer in hand.
    ctx.fillStyle = '#6e4530';
    ctx.beginPath();
    ctx.ellipse(bx, by2 + 1, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3524';
    ctx.fillRect(bx - 5, by2 - 1, 10, 9);
    ctx.fillStyle = '#d8b58f';
    ctx.beginPath();
    ctx.arc(bx, by2 - 8, 5, 0, Math.PI * 2);
    ctx.fill();
    const swing = Math.sin(t * 3) * 0.4;
    ctx.save();
    ctx.translate(bx + 8, by2 - 6);
    ctx.rotate(0.6 + swing);
    ctx.fillStyle = '#7a5b2e';
    ctx.fillRect(-1, -8, 2.5, 9);
    ctx.fillStyle = '#8a94a2';
    ctx.fillRect(-3.5, -11, 7, 4);
    ctx.restore();
    ctx.font = 'bold 11px Verdana, sans-serif';
    ctx.textAlign = 'center';
    const sLabel = 'Borin the Blacksmith';
    const stw = ctx.measureText(sLabel).width;
    ctx.fillStyle = 'rgba(8,5,8,0.7)';
    ctx.fillRect(bx - stw / 2 - 4, by2 - 33, stw + 8, 14);
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(sLabel, bx, by2 - 22);
    ctx.textAlign = 'left';

    // Notice board: a plank wall of pinned parchments, with a gold mark when
    // finished work is waiting to be claimed.
    const qx = (d.board.x + 0.5) * TS;
    const qy = (d.board.y + 0.5) * TS;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(qx, qy + 11, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (state.questing) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = `rgba(255,216,77,${0.25 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(qx, qy + 2, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#4a3524'; // legs
    ctx.fillRect(qx - 12, qy + 2, 3.5, 9);
    ctx.fillRect(qx + 8.5, qy + 2, 3.5, 9);
    ctx.fillStyle = '#5e442c'; // planks
    ctx.fillRect(qx - 16, qy - 18, 32, 22);
    ctx.strokeStyle = 'rgba(30,20,12,0.55)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(qx - 16, qy - 18 + i * 7.3);
      ctx.lineTo(qx + 16, qy - 18 + i * 7.3);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(qx - 16, qy - 18, 32, 22);
    // Pinned parchments — one per notice still on the board.
    const pinned = (state.board || []).filter(Boolean).length;
    for (let i = 0; i < Math.min(3, pinned); i++) {
      ctx.save();
      ctx.translate(qx - 10 + i * 10, qy - 8);
      ctx.rotate((i - 1) * 0.12);
      ctx.fillStyle = '#e2d3ac';
      ctx.fillRect(-4, -7, 8, 11);
      ctx.fillStyle = 'rgba(90,70,45,0.55)';
      for (let k = 0; k < 3; k++) ctx.fillRect(-2.5, -4.5 + k * 3, 5, 1);
      ctx.fillStyle = '#8a2b2b'; // wax pin
      ctx.beginPath();
      ctx.arc(0, -7, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const claimable = (state.quests || []).some(Quests.isComplete);
    if (claimable) {
      const bob = Math.sin(t * 4) * 2;
      ctx.font = 'bold 18px Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,5,8,0.7)';
      ctx.fillText('!', qx + 1, qy - 36 + bob + 1);
      ctx.fillStyle = '#ffd84d';
      ctx.fillText('!', qx, qy - 36 + bob);
      ctx.textAlign = 'left';
    }
    ctx.font = 'bold 11px Verdana, sans-serif';
    ctx.textAlign = 'center';
    const qLabel = 'Notice Board';
    const qtw = ctx.measureText(qLabel).width;
    ctx.fillStyle = 'rgba(8,5,8,0.7)';
    ctx.fillRect(qx - qtw / 2 - 4, qy - 33, qtw + 8, 14);
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(qLabel, qx, qy - 22);
    ctx.textAlign = 'left';
  };
})();
