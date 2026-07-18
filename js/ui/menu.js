// ui/menu.js — the start menu (Play Solo / Host Game / Join Game) and the
// join-code entry screen. Pure layout + draw, like ui/creation.js; main.js owns
// the state (which screen, the typed code) and the click routing.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS } = I;

  UI.menuLayout = function (view) {
    const w = 460;
    const h = 380;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2 - 16;
    const bw = 300;
    const bx = x + (w - bw) / 2;
    return {
      panel: { x, y, w, h },
      solo: { x: bx, y: y + 120, w: bw, h: 54 },
      host: { x: bx, y: y + 188, w: bw, h: 54 },
      join: { x: bx, y: y + 256, w: bw, h: 54 },
    };
  };

  function button(ctx, r, title, subtitle, hot) {
    ctx.fillStyle = hot ? '#2c2011' : '#241a10';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = hot ? 'rgba(255,216,77,0.95)' : 'rgba(201,161,90,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.textAlign = 'left';
    ctx.font = `bold 17px ${SERIF}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(title, r.x + 18, r.y + 24);
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.6)';
    ctx.fillText(subtitle, r.x + 18, r.y + 42);
    ctx.textAlign = 'left';
  }

  function hit(r, mx, my) {
    return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
  }

  UI.drawMenu = function (ctx, view, mouse) {
    const L = UI.menuLayout(view);
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.97);

    ctx.textAlign = 'center';
    ctx.font = `bold 30px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.fillText('Dungeon Browser', L.panel.x + L.panel.w / 2, L.panel.y + 62);
    ctx.font = `12px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.5)';
    ctx.fillText('Descend alone, or together.', L.panel.x + L.panel.w / 2, L.panel.y + 86);

    const mx = mouse ? mouse.x : -1;
    const my = mouse ? mouse.y : -1;
    button(ctx, L.solo, 'Play Solo', 'Your saved hero, offline as ever', hit(L.solo, mx, my));
    button(ctx, L.host, 'Host Game', 'Open a room and share the code', hit(L.host, mx, my));
    button(ctx, L.join, 'Join Game', 'Enter a friend’s room code', hit(L.join, mx, my));
    ctx.textAlign = 'left';
  };

  UI.joinLayout = function (view) {
    const w = 460;
    const h = 300;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2 - 16;
    return {
      panel: { x, y, w, h },
      codeBox: { x: x + 80, y: y + 116, w: w - 160, h: 48 },
      connect: { x: x + w / 2 - 105, y: y + h - 74, w: 210, h: 44 },
      back: { x: x + 20, y: y + 20, w: 64, h: 30 },
    };
  };

  UI.drawJoin = function (ctx, view, code, error, mouse) {
    const L = UI.joinLayout(view);
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.97);

    ctx.textAlign = 'center';
    ctx.font = `bold 24px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.fillText('Join a Room', L.panel.x + L.panel.w / 2, L.panel.y + 58);

    // Code field (shows the typed code, uppercased, with a blinking caret).
    ctx.fillStyle = '#14100b';
    ctx.fillRect(L.codeBox.x, L.codeBox.y, L.codeBox.w, L.codeBox.h);
    ctx.strokeStyle = '#c9a15a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(L.codeBox.x + 0.5, L.codeBox.y + 0.5, L.codeBox.w - 1, L.codeBox.h - 1);
    ctx.font = `bold 26px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = code ? '#efe6d2' : 'rgba(215,200,175,0.3)';
    ctx.fillText(code || 'CODE', L.codeBox.x + L.codeBox.w / 2, L.codeBox.y + 34);

    if (error) {
      ctx.font = `12px ${SANS}`;
      ctx.fillStyle = '#e0776b';
      ctx.fillText(error, L.panel.x + L.panel.w / 2, L.codeBox.y + 74);
    }

    const mx = mouse ? mouse.x : -1;
    const my = mouse ? mouse.y : -1;
    button(ctx, L.connect, 'Connect', 'Type the code · ENTER to join', hit(L.connect, mx, my));

    // Back chip.
    ctx.fillStyle = hit(L.back, mx, my) ? '#2c2011' : '#241a10';
    ctx.fillRect(L.back.x, L.back.y, L.back.w, L.back.h);
    ctx.strokeStyle = 'rgba(201,161,90,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L.back.x + 0.5, L.back.y + 0.5, L.back.w - 1, L.back.h - 1);
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('‹ Back', L.back.x + L.back.w / 2, L.back.y + 19);
    ctx.textAlign = 'left';
  };

  // A transient banner for connection status / errors during online play.
  UI.drawNetBanner = function (ctx, view, text, tone) {
    ctx.save();
    ctx.font = `bold 13px ${SANS}`;
    ctx.textAlign = 'center';
    const w = Math.max(220, ctx.measureText(text).width + 48);
    const x = view.w / 2 - w / 2;
    const y = 16;
    ctx.fillStyle = 'rgba(20,14,9,0.9)';
    ctx.fillRect(x, y, w, 34);
    ctx.strokeStyle = tone === 'error' ? 'rgba(224,119,107,0.9)' : 'rgba(201,161,90,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 33);
    ctx.fillStyle = tone === 'error' ? '#e0776b' : '#e8dcc0';
    ctx.fillText(text, view.w / 2, y + 22);
    ctx.restore();
    ctx.textAlign = 'left';
  };
})();
