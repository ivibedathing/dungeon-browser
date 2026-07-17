// main.js — boot, canvas sizing, input capture, and the requestAnimationFrame loop.
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

  // Character creation overlay: shown for new heroes; gates all game input while open.
  let creation = null;
  function openCreation(prefill) {
    creation = { name: (prefill && prefill.name) || '', shirtIdx: 0, t: 0 };
    if (prefill && prefill.shirt) {
      const idx = UI.SHIRTS.indexOf(prefill.shirt);
      if (idx !== -1) creation.shirtIdx = idx;
    }
  }
  function confirmCreation() {
    const name = creation.name.trim() || 'Wanderer';
    state = Game.newRun((Math.random() * 0x7fffffff) | 0, { name, shirt: UI.SHIRTS[creation.shirtIdx] });
    Save.write(state);
    creation = null;
  }
  function creationKey(e) {
    if (e.key === 'Enter') confirmCreation();
    else if (e.key === 'Backspace') creation.name = creation.name.slice(0, -1);
    else if (e.key === 'ArrowLeft') creation.shirtIdx = (creation.shirtIdx + UI.SHIRTS.length - 1) % UI.SHIRTS.length;
    else if (e.key === 'ArrowRight') creation.shirtIdx = (creation.shirtIdx + 1) % UI.SHIRTS.length;
    else if (e.key.length === 1 && /[\w '\-]/.test(e.key) && creation.name.length < 14) creation.name += e.key;
  }

  window.addEventListener('keydown', (e) => {
    if (creation) {
      creationKey(e);
      e.preventDefault();
      return;
    }
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
  canvas.addEventListener('mousedown', (e) => {
    if (creation) {
      const L = UI.creationLayout(view);
      for (let i = 0; i < L.swatches.length; i++) {
        const r = L.swatches[i];
        if (e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) {
          creation.shirtIdx = i;
          return;
        }
      }
      const b = L.begin;
      if (e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) {
        confirmCreation();
      }
      return;
    }
    if (e.button === 0) input.mouse.click = true;
    if (e.button === 2) input.mouse.rclick = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Resume a saved run when one exists; otherwise a fresh hero starts at character creation
  // (a placeholder run renders frozen behind the panel until the player confirms).
  const savedRun = Save.load();
  let state = savedRun ? Game.fromSave(savedRun) : Game.newRun((Math.random() * 0x7fffffff) | 0);
  if (!savedRun) openCreation();
  Sfx.setMuted(Save.getMuted());

  // Audio can only start after a user gesture.
  const unlockAudio = () => Sfx.unlock();
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });

  // Keep progress on tab close / reload (death wipes the save elsewhere).
  window.addEventListener('beforeunload', () => {
    if (state && !state.dead) Save.write(state);
  });

  // Debug/verification handles.
  window.__state = () => state;
  window.__setState = (s) => {
    state = s;
  };
  window.__creation = () => creation;
  window.__input = input;
  window.__view = view;
  window.__mods = { Game, Items, Entities, Dungeon, U, Save, Sfx, Skills, Quests };

  let last = performance.now();
  let frames = 0;
  window.__frames = () => frames;
  function frame(now) {
    frames++;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (creation) {
      // The world waits, frozen, behind the creation panel.
      creation.t += dt;
      Render.draw(ctx, state, view);
      UI.drawCreation(ctx, view, creation);
      input.pressed.clear();
      input.mouse.click = false;
      input.mouse.rclick = false;
      requestAnimationFrame(frame);
      return;
    }
    // Death → R rolls a new hero through creation (identity prefilled).
    if (state.dead && input.pressed.has('restart')) {
      input.pressed.clear();
      openCreation({ name: state.player.name, shirt: state.player.shirt });
      requestAnimationFrame(frame);
      return;
    }
    state = Game.update(state, input, dt);
    Game.applyEvents(state, Game.drainEvents(state));
    UI.update(state, input, view);
    Render.draw(ctx, state, view);
    UI.draw(ctx, state, view);
    input.pressed.clear();
    input.mouse.click = false;
    input.mouse.rclick = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
