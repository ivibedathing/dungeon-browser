// ui/account.js — the account screen (login/register) and character select. Pure
// layout + draw, like ui/menu.js; main.js owns the form state and click routing.
(function () {
  const UI = typeof window !== 'undefined' ? window.UI : require('./core.js');
  const I = UI._;
  const { SERIF, SANS } = I;

  // ---- Account (login / register) ----

  UI.accountLayout = function (view) {
    const w = 460;
    const h = 420;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2 - 16;
    return {
      panel: { x, y, w, h },
      userBox: { x: x + 60, y: y + 118, w: w - 120, h: 40 },
      passBox: { x: x + 60, y: y + 190, w: w - 120, h: 40 },
      submit: { x: x + w / 2 - 105, y: y + 258, w: 210, h: 44 },
      toggle: { x: x + w / 2 - 105, y: y + 318, w: 210, h: 30 },
      back: { x: x + 20, y: y + 20, w: 64, h: 30 },
    };
  };

  function field(ctx, box, label, value, masked, focused, caretOn) {
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${SANS}`;
    ctx.fillStyle = '#8a795c';
    ctx.fillText(label, box.x, box.y - 8);
    ctx.fillStyle = '#14100b';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = focused ? '#ffd84d' : '#c9a15a';
    ctx.lineWidth = focused ? 2 : 1.3;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.font = `15px ${SANS}`;
    const shown = masked ? '•'.repeat(value.length) : value;
    ctx.fillStyle = value ? '#efe6d2' : 'rgba(215,200,175,0.3)';
    ctx.fillText(value ? shown : label === 'USERNAME' ? 'name' : '', box.x + 12, box.y + 26);
    if (focused && caretOn) {
      const cw = ctx.measureText(shown).width;
      ctx.fillStyle = '#ffd84d';
      ctx.fillRect(box.x + 13 + cw, box.y + 9, 2, 22);
    }
  }

  function chip(ctx, r, text, hot) {
    ctx.fillStyle = hot ? '#2c2011' : '#241a10';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = hot ? 'rgba(255,216,77,0.9)' : 'rgba(201,161,90,0.5)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.textAlign = 'center';
    ctx.font = `bold 13px ${SANS}`;
    ctx.fillStyle = '#ffd84d';
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 4);
    ctx.textAlign = 'left';
  }

  const hit = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  // form: { mode:'login'|'register', username, password, focus, t, error, busy }
  UI.drawAccount = function (ctx, view, form, mouse) {
    const L = UI.accountLayout(view);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.97);

    ctx.textAlign = 'center';
    ctx.font = `bold 26px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.fillText(form.mode === 'register' ? 'Create an Account' : 'Welcome Back', L.panel.x + L.panel.w / 2, L.panel.y + 60);

    const caretOn = Math.sin((form.t || 0) * 5) > 0;
    field(ctx, L.userBox, 'USERNAME', form.username || '', false, form.focus === 'username', caretOn);
    field(ctx, L.passBox, 'PASSWORD', form.password || '', true, form.focus === 'password', caretOn);

    const mx = mouse ? mouse.x : -1;
    const my = mouse ? mouse.y : -1;
    chip(ctx, L.submit, form.busy ? 'Connecting…' : form.mode === 'register' ? 'Register' : 'Log In', hit(L.submit, mx, my));
    chip(ctx, L.toggle, form.mode === 'register' ? 'Have an account? Log in' : 'New here? Register', hit(L.toggle, mx, my));

    if (form.error) {
      ctx.textAlign = 'center';
      ctx.font = `12px ${SANS}`;
      ctx.fillStyle = '#e0776b';
      ctx.fillText(form.error, L.panel.x + L.panel.w / 2, L.submit.y - 14);
    }

    chip(ctx, L.back, '‹ Back', hit(L.back, mx, my));
    ctx.textAlign = 'left';
  };

  // ---- Character select ----

  UI.MAX_SLOTS = 8;

  UI.charSelectLayout = function (view) {
    const w = 720;
    const h = 480;
    const x = (view.w - w) / 2;
    const y = (view.h - h) / 2 - 8;
    const cols = 4;
    const cw = 156;
    const chh = 150;
    const gapX = 16;
    const gapY = 18;
    const gridW = cols * cw + (cols - 1) * gapX;
    const gx = x + (w - gridW) / 2;
    const gy = y + 96;
    const slots = [];
    for (let i = 0; i < UI.MAX_SLOTS; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({ x: gx + col * (cw + gapX), y: gy + row * (chh + gapY), w: cw, h: chh });
    }
    return {
      panel: { x, y, w, h },
      slots,
      enter: { x: x + w / 2 - 120, y: y + h - 64, w: 240, h: 38 },
      back: { x: x + 20, y: y + 20, w: 64, h: 30 },
    };
  };

  // characters: [{slot,name,level,imported}]; selectedSlot: number|null
  UI.drawCharSelect = function (ctx, view, characters, selectedSlot, mouse, canImport) {
    const L = UI.charSelectLayout(view);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, view.w, view.h);
    I.panelBg(ctx, L.panel, 0.97);

    ctx.textAlign = 'center';
    ctx.font = `bold 24px ${SERIF}`;
    ctx.fillStyle = '#d9c06a';
    ctx.fillText('Choose Your Hero', L.panel.x + L.panel.w / 2, L.panel.y + 54);

    const bySlot = new Map((characters || []).map((c) => [c.slot, c]));
    const mx = mouse ? mouse.x : -1;
    const my = mouse ? mouse.y : -1;

    for (let i = 0; i < L.slots.length; i++) {
      const r = L.slots[i];
      const c = bySlot.get(i);
      const hot = hit(r, mx, my);
      const chosen = selectedSlot === i && c;
      ctx.fillStyle = chosen ? '#2a2213' : '#191410';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = chosen ? '#ffd84d' : hot ? 'rgba(201,161,90,0.9)' : 'rgba(201,161,90,0.4)';
      ctx.lineWidth = chosen ? 2.5 : 1.2;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

      ctx.textAlign = 'center';
      if (c) {
        // Simple hero bust.
        const cx = r.x + r.w / 2;
        const cy = r.y + 60;
        ctx.fillStyle = '#d8b58f';
        ctx.beginPath();
        ctx.arc(cx, cy - 8, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a5578';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 12, 18, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold 15px ${SERIF}`;
        ctx.fillStyle = '#efe6d2';
        ctx.fillText(c.name, cx, r.y + r.h - 34);
        ctx.font = `11px ${SANS}`;
        ctx.fillStyle = '#c9b37e';
        ctx.fillText('Level ' + (c.level || 1) + (c.imported ? ' · imported' : ''), cx, r.y + r.h - 16);
      } else {
        ctx.font = `28px ${SERIF}`;
        ctx.fillStyle = 'rgba(201,161,90,0.5)';
        ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2 - 4);
        ctx.font = `11px ${SANS}`;
        ctx.fillStyle = 'rgba(215,200,175,0.4)';
        ctx.fillText('New Hero', r.x + r.w / 2, r.y + r.h / 2 + 20);
      }
    }

    // Enter button, live only when a character is selected.
    const canEnter = selectedSlot != null && bySlot.has(selectedSlot);
    const b = L.enter;
    ctx.fillStyle = canEnter ? (hit(b, mx, my) ? '#2c2011' : '#241a10') : '#171310';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = canEnter ? 'rgba(255,216,77,0.9)' : 'rgba(201,161,90,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.textAlign = 'center';
    ctx.font = `bold 15px ${SERIF}`;
    ctx.fillStyle = canEnter ? '#ffd84d' : 'rgba(215,200,175,0.35)';
    ctx.fillText('Enter the Dungeon', b.x + b.w / 2, b.y + 26);

    ctx.font = `10px ${SANS}`;
    ctx.fillStyle = 'rgba(215,200,175,0.4)';
    ctx.fillText('Click a hero to select · click an empty slot to create · right-click to delete' + (canImport ? ' · a local hero can be imported into an empty slot' : ''), L.panel.x + L.panel.w / 2, L.panel.y + L.panel.h - 14);

    chip(ctx, L.back, '‹ Back', hit(L.back, mx, my));
    ctx.textAlign = 'left';
  };
})();
