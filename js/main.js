// main.js — boot, canvas sizing, input capture, and the requestAnimationFrame loop.
// A screen machine gates play: menu → (solo creation | online account → character
// select → host/join) → playing. SOLO play is the offline localStorage game; ONLINE
// play authenticates, loads a server-saved character, then joins a room.
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

  // `keys.space` is the attack-held flag (named for its original M binding). Attack
  // now lives on the left mouse button — see the mousedown/mouseup handlers below —
  // so it's no longer in the keyboard HELD table; WASD/arrows still steer.
  const HELD = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd' };
  const EDGE = {
    Space: 'dodge', KeyE: 'interact', KeyI: 'inv', Tab: 'inv', KeyB: 'inv', KeyR: 'restart',
    KeyQ: 'drink', KeyT: 'portal', KeyN: 'mute', KeyJ: 'music', KeyM: 'map', KeyK: 'tree', KeyC: 'stats',
    KeyF: 'skill0', KeyG: 'skill1', KeyH: 'skill2',
    Digit1: 'belt0', Digit2: 'belt1', Digit3: 'belt2', Digit4: 'belt3', Escape: 'esc',
  };

  // ---- Screen machine ----
  // 'menu' | 'creation' (solo or online-create) | 'account' | 'charselect' | 'join' | 'playing'
  let screen = 'menu';
  let mode = 'solo';
  let pendingMode = 'solo'; // what a creation confirm launches: 'solo' | 'createChar'
  let pendingCreateSlot = null; // the slot an online create fills
  let onlineIntent = null; // 'host' | 'join' — what to do once a character is chosen
  let joinCode = '';
  let netError = '';
  let accountForm = null; // { mode, username, password, focus, t, error, busy }

  // ONLINE runtime.
  let net = null;
  let netState = null;
  // Same-origin when the page was served by our server (Phase 4.5 Track B: http + ws
  // share one port), so an HTTPS deploy behind a proxy upgrades to wss:// on :443 with
  // no port constant. Falls back to :8080 for dev where the client is served out-of-band
  // (python http on another port) or from file://.
  const wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const servedByUs = (location.protocol === 'http:' || location.protocol === 'https:') && location.host;
  const SERVER_URL = servedByUs ? wsProto + location.host : wsProto + (location.hostname || '127.0.0.1') + ':8080';

  const savedRun = Save.load();
  let state = savedRun ? Game.fromSave(savedRun) : Game.newSoloRun((Math.random() * 0x7fffffff) | 0);

  // ---- Character creation (solo start, or online character create) ----
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
    if (pendingMode === 'createChar' && net) {
      net.createChar(pendingCreateSlot, name, shirt);
      pendingCreateSlot = null;
      screen = 'charselect'; // the new character appears when the server replies
    } else {
      state = Game.newSoloRun((Math.random() * 0x7fffffff) | 0, { name, shirt });
      Save.write(state);
      mode = 'solo';
      screen = 'playing';
    }
  }
  function creationKey(e) {
    if (e.key === 'Enter') confirmCreation();
    else if (e.key === 'Escape') { creation = null; screen = net ? 'charselect' : 'menu'; }
    else if (e.key === 'Backspace') creation.name = creation.name.slice(0, -1);
    else if (e.key === 'ArrowLeft') creation.shirtIdx = (creation.shirtIdx + UI.SHIRTS.length - 1) % UI.SHIRTS.length;
    else if (e.key === 'ArrowRight') creation.shirtIdx = (creation.shirtIdx + 1) % UI.SHIRTS.length;
    else if (e.key.length === 1 && /[\w '\-]/.test(e.key) && creation.name.length < 14) creation.name += e.key;
  }

  // ---- Online lifecycle ----
  function startConnect(intent) {
    onlineIntent = intent;
    netError = '';
    net = Net.create({ now: () => performance.now() });
    net.connect(SERVER_URL, window.WebSocket);
    if (net.status === 'error') {
      netError = friendlyError(net.error); // e.g. offline artifact build (no WebSocket)
      net = null;
      screen = 'menu';
      return;
    }
    // Auto-resume a stored session the moment the socket opens; if it's dead the
    // server replies authError and we fall to the login form.
    net.onOpen = () => {
      const tok = net.storedToken();
      if (tok) net.resume(tok);
    };
    accountForm = { mode: 'login', username: '', password: '', focus: 'username', t: 0, error: '', busy: false };
    screen = 'account';
  }
  function teardownNet() {
    if (net && net._ws && net._ws.close) {
      try { net._ws.close(); } catch (e) { /* already gone */ }
    }
    net = null;
    netState = null;
    accountForm = null;
    onlineIntent = null;
  }
  function backToMenu() {
    teardownNet();
    mode = 'solo';
    screen = 'menu';
  }
  function friendlyError(code) {
    switch (code) {
      case 'no_room': return 'No room with that code.';
      case 'room_full': return 'That room is full.';
      case 'rate_limit': return 'Disconnected — too many messages.';
      case 'bad_message': return 'Disconnected — protocol error.';
      case 'no_websocket': return 'Online play is unavailable in this build.';
      case 'taken': return 'That username is taken.';
      case 'bad_credentials': return 'Wrong username or password.';
      case 'bad_session': return 'Your session expired — please log in.';
      default: return 'Connection lost.';
    }
  }
  function selectedChar() {
    if (!net || net.selectedSlot == null || !net.characters) return null;
    return net.characters.find((c) => c.slot === net.selectedSlot) || null;
  }
  function enterRoom(code) {
    const c = selectedChar();
    const name = (c && c.name) || (net.account && net.account.username) || 'Wanderer';
    net.join(name, '#4a5578', code || undefined);
    netState = net.freshRenderState({ name, shirt: '#4a5578' });
    mode = 'online';
    screen = 'playing';
  }
  function submitAccount() {
    const f = accountForm;
    if (!f.username || f.password.length < 8) {
      f.error = 'A username and an 8+ character password, please.';
      return;
    }
    f.busy = true;
    f.error = '';
    if (f.mode === 'register') net.register(f.username, f.password, f.username);
    else net.login(f.username, f.password);
  }

  // ---- Input listeners (branch on screen) ----
  window.addEventListener('keydown', (e) => {
    if (screen === 'creation') { creationKey(e); e.preventDefault(); return; }
    if (screen === 'account') {
      const f = accountForm;
      if (e.key === 'Enter') submitAccount();
      else if (e.key === 'Escape') backToMenu();
      else if (e.key === 'Tab') f.focus = f.focus === 'username' ? 'password' : 'username';
      else if (e.key === 'Backspace') f[f.focus] = f[f.focus].slice(0, -1);
      else if (e.key.length === 1 && f[f.focus].length < 64 && /\S|.| /.test(e.key)) f[f.focus] += e.key;
      e.preventDefault();
      return;
    }
    if (screen === 'join') {
      if (e.key === 'Enter') doConnectFromJoin();
      else if (e.key === 'Escape') screen = 'charselect';
      else if (e.key === 'Backspace') joinCode = joinCode.slice(0, -1);
      else if (/^[a-zA-Z0-9]$/.test(e.key) && joinCode.length < 6) joinCode += e.key.toUpperCase();
      e.preventDefault();
      return;
    }
    if (screen !== 'playing') return;
    if (e.key === 'Control') input.keys.ctrl = true;
    if (HELD[e.code]) { input.keys[HELD[e.code]] = true; e.preventDefault(); }
    if (EDGE[e.code]) { if (!e.repeat) input.pressed.add(EDGE[e.code]); e.preventDefault(); }
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

  const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  canvas.addEventListener('mousedown', (e) => {
    const x = e.clientX, y = e.clientY;

    if (screen === 'menu') {
      const L = UI.menuLayout(view);
      if (inRect(L.solo, x, y)) {
        const saved = Save.load();
        if (saved) { state = Game.fromSave(saved); mode = 'solo'; screen = 'playing'; }
        else { pendingMode = 'solo'; openCreation(); }
      } else if (inRect(L.host, x, y)) startConnect('host');
      else if (inRect(L.join, x, y)) startConnect('join');
      return;
    }

    if (screen === 'account') {
      const L = UI.accountLayout(view);
      const f = accountForm;
      if (inRect(L.userBox, x, y)) f.focus = 'username';
      else if (inRect(L.passBox, x, y)) f.focus = 'password';
      else if (inRect(L.submit, x, y)) submitAccount();
      else if (inRect(L.toggle, x, y)) { f.mode = f.mode === 'register' ? 'login' : 'register'; f.error = ''; }
      else if (inRect(L.back, x, y)) backToMenu();
      return;
    }

    if (screen === 'charselect') {
      const L = UI.charSelectLayout(view);
      if (inRect(L.back, x, y)) { backToMenu(); return; }
      if (inRect(L.enter, x, y)) {
        if (net.selectedSlot != null && selectedChar()) {
          if (onlineIntent === 'join') { joinCode = ''; netError = ''; screen = 'join'; }
          else enterRoom(null);
        }
        return;
      }
      for (let i = 0; i < L.slots.length; i++) {
        if (!inRect(L.slots[i], x, y)) continue;
        const has = net.characters && net.characters.some((c) => c.slot === i);
        if (e.button === 2 && has) net.deleteChar(i); // right-click deletes
        else if (has) net.selectChar(i);
        else { pendingMode = 'createChar'; pendingCreateSlot = i; openCreation(); }
        return;
      }
      return;
    }

    if (screen === 'join') {
      const L = UI.joinLayout(view);
      if (inRect(L.back, x, y)) screen = 'charselect';
      else if (inRect(L.connect, x, y)) doConnectFromJoin();
      return;
    }

    if (screen === 'creation') {
      const L = UI.creationLayout(view);
      for (let i = 0; i < L.swatches.length; i++) {
        if (inRect(L.swatches[i], x, y)) { creation.shirtIdx = i; return; }
      }
      if (inRect(L.begin, x, y)) confirmCreation();
      return;
    }

    // playing — left button is both a HUD click (belt/skill/inventory, one shot)
    // and the held attack; right button stays the HUD's drop/abandon click.
    if (e.button === 0) {
      input.mouse.click = true;
      input.keys.space = true;
    }
    if (e.button === 2) input.mouse.rclick = true;
  });
  // Release the attack wherever the button comes up — even off-canvas, so a drag
  // that leaves the window doesn't leave the hero swinging forever.
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.keys.space = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function doConnectFromJoin() {
    if (joinCode.length < 4) { netError = 'Codes are 4–6 characters.'; return; }
    enterRoom(joinCode);
  }

  Sfx.setMuted(Save.getMuted());
  Music.setMuted(Save.getMusicMuted());
  const unlockAudio = () => {
    Sfx.unlock();
    Music.unlock(); // starts whatever track the menu already asked for
  };
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });

  // Preload (Phase 4.5 Track A): warm the noise buffer and try optional real assets in
  // the background while the menu is up. Every step is non-required with a procedural
  // fallback (Boot's guarantee), so a failure — or file:// with no fetch — changes nothing.
  if (typeof Boot !== 'undefined') {
    Boot.step('audio', () => Sfx.warm());
    if (typeof Assets !== 'undefined') Boot.step('assets', () => Assets.load('assets/manifest.json'));
    Boot.run().catch(() => {});
  }

  window.addEventListener('beforeunload', () => {
    if (mode === 'solo' && state && !state.dead) Save.write(state);
  });

  // Debug/verification handles.
  window.__state = () => (mode === 'online' ? netState : state);
  window.__setState = (s) => { state = s; };
  window.__creation = () => creation;
  window.__screen = () => screen;
  window.__net = () => net;
  window.__rtt = (ms) => { if (net) net.latencyMs = ms | 0; };
  window.__input = input;
  window.__view = view;
  window.__mods = { Game, Items, Entities, Dungeon, World, U, Save, Sfx, Skills, Quests, Net };

  function clearEdges() {
    input.pressed.clear();
    input.mouse.click = false;
    input.mouse.rclick = false;
  }

  // Mouse-look: turn the pointer's screen position into a world-space angle from the
  // local hero and stash it on `input.aim`. Screen→world inverts the render camera
  // (render/draw.js: camX = cam.x - view.w/2), so this must run on the same render
  // state the frame will draw. Skipped until the camera exists and the pointer has
  // moved; the sim then faces the hero at the cursor and attacks fly that way.
  function updateAim(rs) {
    if (!rs || !rs.cam || !rs.player || input.mouse.x < 0) return;
    const worldX = input.mouse.x + rs.cam.x - view.w / 2;
    const worldY = input.mouse.y + rs.cam.y - view.h / 2;
    input.aim = Math.atan2(worldY - rs.player.y, worldX - rs.player.x);
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
    updateAim(state);
    state = Game.update(state, input, dt);
    Game.applyEvents(state, Game.drainEvents(state));
    UI.update(state, input, view);
    Render.draw(ctx, state, view);
    UI.draw(ctx, state, view);
    clearEdges();
  }

  function onlineFrame(nowMs) {
    if (net.status === 'error' || net.status === 'closed') {
      netError = friendlyError(net.error);
      backToMenu();
      clearEdges();
      return;
    }
    if (input.pressed.has('esc')) { backToMenu(); clearEdges(); return; }

    updateAim(netState);
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

  // Music toggle lives out here rather than in Game.update so it also works on the
  // menu and the death screen, where the sim isn't ticking. (Same reason the score
  // is chosen from `screen`: the front-end has music too.)
  function updateMusic() {
    if (input.pressed.has('music')) {
      const m = Music.toggle();
      Save.setMusicMuted(m);
      const s = screen === 'playing' ? (mode === 'online' ? netState : state) : null;
      if (s) Game._.message(s, m ? 'Music off. (M to restore)' : 'Music on.', '#9aa');
    }
    const world = screen === 'playing' ? (mode === 'online' ? netState : state) : null;
    Music.play(Music.trackFor(screen, world));
  }

  function frame(now) {
    frames++;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    updateMusic();

    // Front-end screens draw over a frozen world backdrop.
    if (screen !== 'playing') {
      Render.draw(ctx, state, view);
      if (screen === 'menu') {
        UI.drawMenu(ctx, view, input.mouse);
        if (netError) UI.drawNetBanner(ctx, view, netError, 'error');
      } else if (screen === 'account') {
        accountForm.t += dt;
        // Advance to character select once authenticated (incl. a silent auto-resume).
        if (net && net.authStatus === 'authed') { screen = 'charselect'; }
        else {
          if (net && net.authStatus === 'error' && net.authError) { accountForm.error = friendlyError(net.authError); accountForm.busy = false; net.authError = null; }
          UI.drawAccount(ctx, view, accountForm, input.mouse);
          if (net && net.status !== 'open' && !accountForm.error) UI.drawNetBanner(ctx, view, 'Connecting…', 'info');
        }
      } else if (screen === 'charselect') {
        const canImport = !!Save.load();
        UI.drawCharSelect(ctx, view, net ? net.characters : [], net ? net.selectedSlot : null, input.mouse, canImport);
        if (net && net.charError) UI.drawNetBanner(ctx, view, net.charError === 'too_many' ? 'All 8 slots are full.' : 'Could not do that.', 'error');
      } else if (screen === 'join') {
        UI.drawJoin(ctx, view, joinCode, netError, input.mouse);
      } else if (screen === 'creation') {
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
