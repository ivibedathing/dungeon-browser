// main.js — boot, canvas sizing, input capture, and the requestAnimationFrame loop.
// A small screen machine gates play: menu → (creation | join) → playing. SOLO play
// is exactly the offline game; ONLINE play talks to the Phase 1 server through Net,
// predicting the local hero and interpolating everyone else.
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0 };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const input = {
    keys: { w: false, a: false, s: false, d: false, space: false, ctrl: false },
    pressed: new Set(),
    mouse: { x: -1, y: -1, click: false, rclick: false },
  };

  // `keys.space` is the attack-held flag (named for its original binding); it now lives on M.
  const HELD = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd', KeyM: 'space' };
  const EDGE = {
    Space: 'dodge',
    KeyE: 'interact',
    KeyI: 'inv',
    Tab: 'inv',
    KeyB: 'inv',
    KeyR: 'restart',
    KeyQ: 'drink',
    KeyT: 'portal',
    KeyN: 'mute',
    KeyK: 'tree',
    KeyF: 'skill0',
    KeyG: 'skill1',
    KeyH: 'skill2',
    Digit1: 'belt0',
    Digit2: 'belt1',
    Digit3: 'belt2',
    Digit4: 'belt3',
    Escape: 'esc',
  };

  // ---- Screen machine ----
  // 'menu'     — solo/host/join chooser
  // 'join'     — room-code entry
  // 'creation' — name/shirt (then starts solo, hosts, or joins per pendingMode)
  // 'playing'  — the game; mode is 'solo' or 'online'
  let screen = 'menu';
  let mode = 'solo';
  let pendingMode = 'solo'; // what a creation confirm should launch
  let joinCode = '';
  let netError = '';

  // ONLINE runtime.
  let net = null;
  let netState = null;
  const SERVER_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + (location.hostname || '127.0.0.1') + ':8080';

  // The frozen backdrop shown behind the front-end panels.
  const savedRun = Save.load();
  let state = savedRun ? Game.fromSave(savedRun) : Game.newRun((Math.random() * 0x7fffffff) | 0);

  // Character creation overlay.
  let creation = null;
  function openCreation(prefill) {
    creation = { name: (prefill && prefill.name) || '', shirtIdx: 0, t: 0 };
    if (prefill && prefill.shirt) {
      const idx = UI.SHIRTS.indexOf(prefill.shirt);
      if (idx !== -1) creation.shirtIdx = idx;
    }
    screen = 'creation';
  }
  function confirmCreation() {
    const name = creation.name.trim() || 'Wanderer';
    const shirt = UI.SHIRTS[creation.shirtIdx];
    creation = null;
    if (pendingMode === 'host') startOnline(name, shirt, null);
    else if (pendingMode === 'join') startOnline(name, shirt, joinCode);
    else {
      state = Game.newRun((Math.random() * 0x7fffffff) | 0, { name, shirt });
      Save.write(state);
      mode = 'solo';
      screen = 'playing';
    }
  }
  function creationKey(e) {
    if (e.key === 'Enter') confirmCreation();
    else if (e.key === 'Escape') {
      creation = null;
      screen = 'menu';
    } else if (e.key === 'Backspace') creation.name = creation.name.slice(0, -1);
    else if (e.key === 'ArrowLeft') creation.shirtIdx = (creation.shirtIdx + UI.SHIRTS.length - 1) % UI.SHIRTS.length;
    else if (e.key === 'ArrowRight') creation.shirtIdx = (creation.shirtIdx + 1) % UI.SHIRTS.length;
    else if (e.key.length === 1 && /[\w '\-]/.test(e.key) && creation.name.length < 14) creation.name += e.key;
  }

  // ---- Online lifecycle ----
  function startOnline(name, shirt, code) {
    netError = '';
    net = Net.create({ now: () => performance.now() });
    net.connect(SERVER_URL, window.WebSocket);
    if (net.status === 'error') {
      // e.g. the offline artifact build: WebSocket blocked by CSP.
      netError = friendlyError(net.error);
      net = null;
      screen = 'menu';
      return;
    }
    net.onOpen = () => net.join(name, shirt, code);
    netState = net.freshRenderState({ name, shirt });
    mode = 'online';
    screen = 'playing';
  }
  function teardownNet() {
    if (net && net._ws && net._ws.close) {
      try {
        net._ws.close();
      } catch (e) {
        /* already gone */
      }
    }
    net = null;
    netState = null;
  }
  function backToMenu() {
    teardownNet();
    mode = 'solo';
    screen = 'menu';
  }
  function friendlyError(code) {
    switch (code) {
      case 'no_room':
        return 'No room with that code.';
      case 'room_full':
        return 'That room is full.';
      case 'rate_limit':
        return 'Disconnected — too many messages.';
      case 'bad_message':
        return 'Disconnected — protocol error.';
      case 'no_websocket':
        return 'Online play is unavailable in this build.';
      default:
        return 'Connection lost.';
    }
  }

  // ---- Input listeners (branch on screen) ----
  window.addEventListener('keydown', (e) => {
    if (screen === 'creation') {
      creationKey(e);
      e.preventDefault();
      return;
    }
    if (screen === 'join') {
      if (e.key === 'Enter') doConnectFromJoin();
      else if (e.key === 'Escape') screen = 'menu';
      else if (e.key === 'Backspace') joinCode = joinCode.slice(0, -1);
      else if (/^[a-zA-Z0-9]$/.test(e.key) && joinCode.length < 6) joinCode += e.key.toUpperCase();
      e.preventDefault();
      return;
    }
    if (screen !== 'playing') return;
    if (e.key === 'Control') input.keys.ctrl = true;
    if (HELD[e.code]) {
      input.keys[HELD[e.code]] = true;
      e.preventDefault();
    }
    if (EDGE[e.code]) {
      if (!e.repeat) input.pressed.add(EDGE[e.code]);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') input.keys.ctrl = false;
    if (HELD[e.code]) input.keys[HELD[e.code]] = false;
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(input.keys)) input.keys[k] = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });

  function inRect(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  canvas.addEventListener('mousedown', (e) => {
    const x = e.clientX;
    const y = e.clientY;

    if (screen === 'menu') {
      const L = UI.menuLayout(view);
      if (inRect(L.solo, x, y)) {
        const saved = Save.load();
        if (saved) {
          state = Game.fromSave(saved);
          mode = 'solo';
          screen = 'playing';
        } else {
          pendingMode = 'solo';
          openCreation();
        }
      } else if (inRect(L.host, x, y)) {
        pendingMode = 'host';
        openCreation();
      } else if (inRect(L.join, x, y)) {
        joinCode = '';
        netError = '';
        screen = 'join';
      }
      return;
    }

    if (screen === 'join') {
      const L = UI.joinLayout(view);
      if (inRect(L.back, x, y)) screen = 'menu';
      else if (inRect(L.connect, x, y)) doConnectFromJoin();
      return;
    }

    if (screen === 'creation') {
      const L = UI.creationLayout(view);
      for (let i = 0; i < L.swatches.length; i++) {
        if (inRect(L.swatches[i], x, y)) {
          creation.shirtIdx = i;
          return;
        }
      }
      if (inRect(L.begin, x, y)) confirmCreation();
      return;
    }

    // playing
    if (e.button === 0) input.mouse.click = true;
    if (e.button === 2) input.mouse.rclick = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function doConnectFromJoin() {
    if (joinCode.length < 4) {
      netError = 'Codes are 4–6 characters.';
      return;
    }
    pendingMode = 'join';
    openCreation();
  }

  Sfx.setMuted(Save.getMuted());
  const unlockAudio = () => Sfx.unlock();
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });

  // Keep solo progress on tab close (online state lives on the server).
  window.addEventListener('beforeunload', () => {
    if (mode === 'solo' && state && !state.dead) Save.write(state);
  });

  // Debug/verification handles.
  window.__state = () => (mode === 'online' ? netState : state);
  window.__setState = (s) => {
    state = s;
  };
  window.__creation = () => creation;
  window.__screen = () => screen;
  window.__net = () => net;
  window.__rtt = (ms) => {
    if (net) net.latencyMs = ms | 0;
  };
  window.__input = input;
  window.__view = view;
  window.__mods = { Game, Items, Entities, Dungeon, U, Save, Sfx, Skills, Quests, Net };

  function clearEdges() {
    input.pressed.clear();
    input.mouse.click = false;
    input.mouse.rclick = false;
  }

  // ---- Frame ----
  let last = performance.now();
  let frames = 0;
  window.__frames = () => frames;

  function soloFrame(dt) {
    if (state.dead && input.pressed.has('restart')) {
      pendingMode = 'solo';
      openCreation({ name: state.player.name, shirt: state.player.shirt });
      clearEdges();
      return;
    }
    state = Game.update(state, input, dt);
    Game.applyEvents(state, Game.drainEvents(state));
    UI.update(state, input, view);
    Render.draw(ctx, state, view);
    UI.draw(ctx, state, view);
    clearEdges();
  }

  function onlineFrame(nowMs) {
    // Bail to the menu on a disconnect or a server-side kick.
    if (net.status === 'error' || net.status === 'closed') {
      netError = friendlyError(net.error);
      backToMenu();
      clearEdges();
      return;
    }
    // Esc leaves the room.
    if (input.pressed.has('esc')) {
      backToMenu();
      clearEdges();
      return;
    }

    net.sendInput(input, nowMs);
    Game.applyEvents(netState, net.takeEvents());
    net.reconcileLocal(netState, nowMs);
    net.buildRenderState(netState, nowMs);

    Render.draw(ctx, netState, view);
    UI.draw(ctx, netState, view);

    if (net.status !== 'open') UI.drawNetBanner(ctx, view, 'Connecting…', 'info');
    else UI.drawNetBanner(ctx, view, 'Room ' + (net.code || '????') + '  ·  Esc to leave', 'info');
    clearEdges();
  }

  function frame(now) {
    frames++;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // The world (a placeholder solo run) sits frozen behind the front-end panels.
    if (screen === 'menu' || screen === 'join' || screen === 'creation') {
      Render.draw(ctx, state, view);
      if (screen === 'menu') {
        UI.drawMenu(ctx, view, input.mouse);
        if (netError) UI.drawNetBanner(ctx, view, netError, 'error');
      } else if (screen === 'join') {
        UI.drawJoin(ctx, view, joinCode, netError, input.mouse);
      } else {
        creation.t += dt;
        UI.drawCreation(ctx, view, creation);
      }
      clearEdges();
      requestAnimationFrame(frame);
      return;
    }

    if (mode === 'online') onlineFrame(now);
    else soloFrame(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
