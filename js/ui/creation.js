// ui/creation.js — the character-creation screen: name field, shirt swatches,
// live hero preview, and the begin button. Driven by main.js's creation form.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS } = I;

  UI.SHIRTS = ['#4a5578', '#7a3b3b', '#3b6e4f', '#6e5a2e', '#5a3b6e', '#2e5a6e', '#6e6e6e', '#8a5c3a'];

  UI.creationLayout = function (view) {
    const w = 470;
    const h = 400;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2 - 16;
    const swatches = [];
    for (let i = 0; i < UI.SHIRTS.length; i++) {
      swatches.push({ x: x + 65 + i * 43, y: y + 210, w: 34, h: 34 });
    }
    return {
      panel: { x, y, w, h },
      nameBox: { x: x + 95, y: y + 104, w: w - 190, h: 36 },
      swatches,
      begin: { x: x + w / 2 - 105, y: y + h - 64, w: 210, h: 40 },
    };
  };

  UI.drawCreation = function (ctx, view, form) {
    const L = UI.creationLayout(view);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.97);

    ctx.textAlign = 'center';
    ctx.font = `bold 26px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.fillText('Create Your Hero', L.panel.x + L.panel.w / 2, L.panel.y + 46);

    // Name field.
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#8a795c';
    ctx.fillText('NAME', L.nameBox.x, L.nameBox.y - 8);
    ctx.fillStyle = '#14100b';
    ctx.fillRect(L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h);
    ctx.strokeStyle = '#c9a15a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(L.nameBox.x + 0.5, L.nameBox.y + 0.5, L.nameBox.w - 1, L.nameBox.h - 1);
    ctx.font = `15px ${SANS}`;
    const typed = form.name.length > 0;
    ctx.fillStyle = typed ? '#efe6d2' : 'rgba(215,200,175,0.35)';
    const shown = typed ? form.name : 'Wanderer';
    ctx.fillText(shown, L.nameBox.x + 12, L.nameBox.y + 24);
    if (Math.sin(form.t * 5) > 0) {
      const cw = ctx.measureText(typed ? form.name : '').width;
      ctx.fillStyle = '#ffd84d';
      ctx.fillRect(L.nameBox.x + 13 + cw, L.nameBox.y + 8, 2, 20);
    }

    // Shirt swatches.
    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#8a795c';
    ctx.fillText('SHIRT COLOR', L.swatches[0].x, L.swatches[0].y - 10);
    for (let i = 0; i < L.swatches.length; i++) {
      const r = L.swatches[i];
      ctx.fillStyle = UI.SHIRTS[i];
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (i === form.shirtIdx) {
        ctx.strokeStyle = '#ffd84d';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
    }

    // Live hero preview.
    const px = L.panel.x + L.panel.w / 2;
    const py = L.panel.y + 296;
    const shirt = UI.SHIRTS[form.shirtIdx];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(px, py + 14, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1.6, 1.6);
    ctx.fillStyle = '#cfd6dd';
    ctx.fillRect(5, -3, 13, 2.6);
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(0, 2, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8b58f';
    ctx.beginPath();
    ctx.arc(0, -8, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c3350';
    ctx.beginPath();
    ctx.arc(0, -9.5, 5.4, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.restore();

    // Begin button.
    const b = L.begin;
    ctx.fillStyle = '#241a10';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const pulse = 0.6 + 0.4 * Math.sin(form.t * 4);
    ctx.strokeStyle = `rgba(255,216,77,${pulse})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.textAlign = 'center';
    ctx.font = `bold 14px ${SERIF}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText('Begin the Descent', b.x + b.w / 2, b.y + 25);
    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.5)';
    ctx.fillText('Type a name · pick a shirt (or ←/→) · ENTER or click to begin', L.panel.x + L.panel.w / 2, L.panel.y + L.panel.h - 14);
    ctx.textAlign = 'left';
  };
})();
