// game/update.js — the frame update: input handling, player actions, world
// systems (flow field, boss arenas, deaths, camera), and the fixed-step driver.
// Loads last: it stitches together the other game/ parts.
(function () {
  const Skills = typeof window !== 'undefined' ? window.Skills : require('../skills.js');
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { TS, PLAYER_R, MOVE_SPEED, GOLD_MAGNET } = G;

  Game.EMPTY_INPUT = Object.freeze({
    keys: Object.freeze({ w: false, a: false, s: false, d: false, space: false }),
    pressed: new Set(),
    mouse: Object.freeze({ x: -1, y: -1, click: false, rclick: false }),
  });

  // Per-player upkeep that runs even while menus pause the world.
  function updatePlayerAlways(state, p, dt) {
    const stats = Entities.effectiveStats(p);
    if (p.healPool > 0 && p.hp < stats.maxHP) {
      const heal = Math.min(p.healPool, p.healRate * dt, stats.maxHP - p.hp);
      p.hp += heal;
      p.healPool -= heal;
      if (Math.random() < dt * 20) G.burst(state, p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16, '#6fd06f', 1, 30);
    } else if (p.hp >= stats.maxHP) {
      p.healPool = 0;
    }
    p.mana = Math.min(stats.maxMana, (p.mana || 0) + stats.manaRegen * dt);
    for (const k of Object.keys(p.skillCd)) p.skillCd[k] = Math.max(0, p.skillCd[k] - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.attackT = Math.max(0, p.attackT - dt);
    p.dodgeT = Math.max(0, p.dodgeT - dt);
    p.dodgeCdT = Math.max(0, p.dodgeCdT - dt);
    if (p.swing) {
      p.swing.t += dt;
      if (p.swing.t >= p.swing.dur) p.swing = null;
    }
  }

  Game.update = function (state, input, dt) {
    dt = Math.min(dt, 0.05);
    // Accept the legacy single-input form or a per-player map {playerId: input}.
    const inputs = input && input.keys ? { [state.players[0].id]: input } : input || {};
    const localIn = inputs[state.players[0].id] || Game.EMPTY_INPUT;
    state.time += dt;
    state.shake = Math.max(0, state.shake - dt * 14);
    if (state.fade && state.fade.t < state.fade.dur) state.fade.t += dt;

    const p = state.player;

    // Decay transient text/particles even when paused or dead.
    for (const ft of state.floatTexts) ft.t += dt;
    state.floatTexts = state.floatTexts.filter((ft) => ft.t < 0.9);
    for (const pt of state.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 1 - 3 * dt;
      pt.vy *= 1 - 3 * dt;
    }
    state.particles = state.particles.filter((pt) => pt.t < pt.life);
    if (state.props) for (const prop of state.props) prop.hitT = Math.max(0, prop.hitT - dt);
    for (const msg of state.messages) msg.t += dt;
    state.messages = state.messages.filter((msg) => msg.t < 7);

    // Sound toggle works everywhere, even on the death screen. (Local-player UI concern.)
    if (localIn.pressed.has('mute') && typeof Sfx !== 'undefined') {
      const m = Sfx.toggle();
      if (typeof Save !== 'undefined') Save.setMuted(m);
      G.message(state, m ? 'Sound muted. (N to unmute)' : 'Sound on.', '#9aa');
    }

    if (state.dead) {
      state.deathT += dt;
      if (localIn.pressed.has('restart')) {
        // Headless restart keeps the identity; the browser opens character creation instead.
        return Game.newRun((Math.random() * 0x7fffffff) | 0, { name: p.name, shirt: p.shirt });
      }
      return state;
    }

    // Menu toggles and belt keys are local-player UI concerns (clients own these in Phase 2).
    if (localIn.pressed.has('inv')) {
      state.invOpen = !state.invOpen;
      if (state.invOpen) state.treeOpen = state.boardOpen = false;
    }
    if (localIn.pressed.has('tree')) {
      state.treeOpen = !state.treeOpen;
      if (state.treeOpen) state.invOpen = state.boardOpen = false;
    }
    for (let i = 0; i < 4; i++) {
      if (localIn.pressed.has('belt' + i)) Game.useBelt(state, i);
    }
    if (localIn.pressed.has('drink')) {
      const idx = state.bag.belt.findIndex((b) => b);
      if (idx !== -1) Game.useBelt(state, idx);
    }

    for (const pl of state.players) {
      if (!pl.dead) updatePlayerAlways(state, pl, dt);
    }

    if (state.invOpen || state.treeOpen || state.boardOpen) {
      // Game world pauses while rummaging through bags, pondering the tree, or
      // reading the notices. Returning here also freezes the proximity flags
      // below, so the board stays live while you read it.
      if (state.boardOpen && localIn.pressed.has('interact')) state.boardOpen = false;
      return state;
    }

    state.trading = false;
    state.smithing = false;
    state.questing = false;
    for (const pl of state.players) {
      if (pl.dead) continue;
      const worldRebuilt = updatePlayerActions(state, pl, inputs[pl.id] || Game.EMPTY_INPUT, dt);
      if (worldRebuilt) return state;
    }

    return updateWorld(state, dt);
  };

  // Advance ONE player's position for a frame: the committed dodge dash while it
  // lasts, otherwise WASD steering, plus facing. Pure w.r.t. the rest of the world
  // — no attacks, pickups, or events — and takes `grid`/`stats` rather than reading
  // `state`, so the network client can run this identical code to predict its own
  // hero (Phase 2) and reconcile against the server without rubber-banding. Returns
  // true when this call started a new dodge, so the authoritative sim can emit the
  // dodge juice that the client instead receives as a server event.
  Game.predictMovement = function (grid, p, input, dt, stats) {
    // Mouse-look: when the client supplies an aim angle, the hero faces the cursor
    // every frame — independent of which way it walks. Absent an aim (headless sim,
    // tests, a pointer that hasn't moved), facing falls back to the travel direction
    // below. Set before the dodge so a standing-still roll dashes toward the cursor.
    const aimed = typeof input.aim === 'number' && Number.isFinite(input.aim);
    if (aimed) p.facing = input.aim;

    let dodgeStarted = false;
    if (input.pressed.has('dodge') && p.dodgeCdT <= 0 && p.dodgeT <= 0) {
      const dmx = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0);
      const dmy = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0);
      const dlen = Math.hypot(dmx, dmy);
      p.dodgeDir = dlen ? { x: dmx / dlen, y: dmy / dlen } : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      p.dodgeT = 0.22;
      p.dodgeCdT = 0.9;
      dodgeStarted = true;
    }

    // The roll overrides steering while it lasts.
    if (p.dodgeT > 0) {
      const moved = G.moveCircle(grid, p.x, p.y, PLAYER_R, p.dodgeDir.x * 560 * dt, p.dodgeDir.y * 560 * dt);
      p.x = moved.x;
      p.y = moved.y;
    } else {
      const mx = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0);
      const my = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0);
      if (mx || my) {
        const len = Math.hypot(mx, my);
        const speed = MOVE_SPEED * stats.moveMult;
        const moved = G.moveCircle(grid, p.x, p.y, PLAYER_R, (mx / len) * speed * dt, (my / len) * speed * dt);
        if (!aimed && (moved.x !== p.x || moved.y !== p.y)) {
          p.facing = Math.atan2(my, mx);
        }
        p.x = moved.x;
        p.y = moved.y;
      }
    }
    return dodgeStarted;
  };

  // Input-driven actions for one player. Returns true when the world was rebuilt
  // (stairs or portal travel) and the frame must stop.
  function updatePlayerActions(state, p, input, dt) {
    const stats = Entities.effectiveStats(p);

    // Movement + dodge, shared verbatim with client-side prediction. The sim owns
    // the juice the client can't: a newly-started roll kicks up dust and a sound.
    if (Game.predictMovement(state.dungeon.grid, p, input, dt, stats)) {
      G.burst(state, p.x, p.y, '#c9c2b2', 8, 70);
      G.sfx(state, 'dodge');
    }

    // Attack (hold the left mouse button to keep swinging) — never mid-roll. The
    // sim reads the held flag as `keys.space` for historical reasons; the client
    // now drives it from the mouse. Swings/shots fly along `p.facing` — the cursor.
    if (input.keys.space && p.attackT <= 0 && p.dodgeT <= 0) G.playerAttack(state, p);

    // Active skills (F / G / H).
    for (let i = 0; i < Skills.ACTIVE_ORDER.length; i++) {
      if (input.pressed.has('skill' + i)) Game.castSkill(state, p, i);
    }

    // Town portal skill (cooldown/arming ticks live in updateWorld).
    if (input.pressed.has('portal')) G.castPortal(state);
    const gate = state.portals.find((po) => po.armT <= 0 && U.dist2(p.x, p.y, po.x, po.y) < 20 * 20);
    if (gate) {
      G.travel(state, gate);
      return true;
    }

    // Town comforts: the healing well and the vendor's trade range.
    if (state.inTown) {
      const d = state.dungeon;
      const wx = (d.well.x + 0.5) * TS;
      const wy = (d.well.y + 0.5) * TS;
      if (p.hp < stats.maxHP && U.dist2(p.x, p.y, wx, wy) < 30 * 30) {
        p.hp = stats.maxHP;
        p.healPool = 0;
        G.burst(state, p.x, p.y, '#6fd0d0', 20, 120);
        G.sfx(state, 'heal');
        G.message(state, 'The waters of the well mend your wounds.', '#8fd4e8');
      }
      const vx = (d.vendor.x + 0.5) * TS;
      const vy = (d.vendor.y + 0.5) * TS;
      if (p === state.player && U.dist2(p.x, p.y, vx, vy) < 85 * 85) state.trading = true;
      const sx = (d.smith.x + 0.5) * TS;
      const sy = (d.smith.y + 0.5) * TS;
      if (p === state.player && U.dist2(p.x, p.y, sx, sy) < 85 * 85) state.smithing = true;
      const qx = (d.board.x + 0.5) * TS;
      const qy = (d.board.y + 0.5) * TS;
      if (p === state.player && U.dist2(p.x, p.y, qx, qy) < 70 * 70) state.questing = true;
    }

    // Ground pickups — or a quick vendor purchase / anvil strike / read of the
    // notices in town.
    if (input.pressed.has('interact')) {
      if (state.trading && p === state.player) Game.buyPotion(state);
      else if (state.smithing && p === state.player) Game.upgradeEquipped(state);
      else if (state.questing && p === state.player) state.boardOpen = true;
      else G.tryPickup(state);
    }
    for (const g of [...state.groundItems]) {
      if (g.kind === 'gold' && U.dist2(p.x, p.y, g.x, g.y) < GOLD_MAGNET * GOLD_MAGNET) {
        state.bag.gold += g.amount;
        state.groundItems.splice(state.groundItems.indexOf(g), 1);
        G.floatText(state, p.x, p.y - 22, `+${g.amount} gold`, '#ffd84d', 12);
        G.sfx(state, 'gold');
      }
    }

    // Stairs.
    const ptx = Math.floor(p.x / TS);
    const pty = Math.floor(p.y / TS);
    if (state.dungeon.grid[pty] && state.dungeon.grid[pty][ptx] === Dungeon.TILE.STAIRS_DOWN) {
      G.descend(state);
      return true;
    }

    return false;
  }

  // World systems: everything that runs once per frame regardless of player count.
  function updateWorld(state, dt) {
    state.portalCdT = Math.max(0, state.portalCdT - dt);
    for (const po of state.portals) po.armT = Math.max(0, po.armT - dt);

    // Flow field for AI + fog-of-war visibility (recomputed a few times per second),
    // seeded from every living player so monsters route to whoever is closest.
    state.flow.t -= dt;
    if (!state.flow.field || state.flow.t <= 0) {
      state.flow.t = 0.18;
      state.flow.field = Dungeon.flowFieldMulti(
        state.dungeon.grid,
        state.players
          .filter((pl) => !pl.dead)
          .map((pl) => ({ x: Math.floor(pl.x / TS), y: Math.floor(pl.y / TS) })),
        30
      );
      // Mark explored tiles (wall-aware visibility from the flow field).
      const f = state.flow.field;
      for (let y = 0; y < state.dungeon.height; y++) {
        for (let x = 0; x < state.dungeon.width; x++) {
          if (f[y][x] <= 9) {
            state.explored[y][x] = true;
            // Explored walls: mark walls adjacent to visible floor.
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
              const ny = y + dy;
              const nx = x + dx;
              if (state.explored[ny] !== undefined && state.explored[ny][nx] !== undefined) {
                state.explored[ny][nx] = true;
              }
            }
          }
        }
      }
    }

    // Ambush swarms: the first player to reach a rigged room's center springs it,
    // and a pack of swarmlings bursts in from the edges already hunting.
    if (state.ambushes) {
      for (const amb of state.ambushes) {
        if (amb.triggered) continue;
        const trigX = (amb.cx + 0.5) * TS;
        const trigY = (amb.cy + 0.5) * TS;
        const rPx = amb.radius * TS;
        const sprung = state.players.some((pl) => !pl.dead && U.dist2(pl.x, pl.y, trigX, trigY) <= rPx * rPx);
        if (!sprung) continue;
        amb.triggered = true;
        const partyN = state.partyN || (state.players && state.players.length) || 1;
        for (const cell of amb.spawns) {
          state.monsters.push({
            ...Entities.makeMonster('swarmling', state.floor, false, partyN),
            id: state.nextId++,
            x: (cell.x + 0.5) * TS,
            y: (cell.y + 0.5) * TS,
            attackT: state.srand() * 0.3,
            hitT: 0,
            lungeT: 0,
            wanderT: 0,
            wandA: NaN,
            aggroed: true, // commit instantly — this is the "react now" moment
            kbx: 0,
            kby: 0,
          });
        }
        G.message(state, 'A swarm pours from the shadows!', '#ff7a3d');
        G.sfx(state, 'roar');
        state.shake = Math.min(9, state.shake + 4);
      }
    }

    // Monsters, then projectiles in flight.
    for (const m of [...state.monsters]) G.monsterUpdate(state, m, dt);
    G.updateProjectiles(state, dt);

    // Boss arena: any player stepping inside wakes the guardian and locks the camera.
    const bossDef = state.dungeon.boss;
    if (bossDef) {
      const bossMon = state.monsters.find((m) => m.boss);
      const br = bossDef.room;
      const inside = state.players.some((pl) => {
        if (pl.dead) return false;
        const btx = Math.floor(pl.x / TS);
        const bty = Math.floor(pl.y / TS);
        return btx >= br.x && btx < br.x + br.w && bty >= br.y && bty < br.y + br.h;
      });
      const fighting = !!bossMon && inside;
      if (fighting && !state.bossFight) {
        bossMon.aggroed = true;
        G.message(state, `${bossMon.name} bars your way!`, '#ff9a3d');
        G.sfx(state, 'roar');
        state.shake = Math.min(8, state.shake + 4);
      }
      state.bossFight = fighting;
    } else {
      state.bossFight = false;
    }

    // Deaths: players fall individually; the run ends when everyone is down.
    for (const pl of state.players) {
      if (!pl.dead && pl.hp <= 0) {
        pl.hp = 0;
        pl.dead = true;
        G.burst(state, pl.x, pl.y, '#8e2731', 40, 200);
        G.sfx(state, 'death');
      }
    }
    if (!state.dead && state.players.every((pl) => pl.dead)) {
      state.dead = true;
      state.deathT = 0;
      state.shake = 10;
      if (typeof Save !== 'undefined') {
        Save.updateRecords(state);
        Save.clear();
      }
    }

    // Periodic autosave so progress survives crashes and tab closes.
    state.autosaveT = (state.autosaveT || 0) + dt;
    if (state.autosaveT > 4) {
      state.autosaveT = 0;
      G.save(state);
    }

    // Camera: follows the local player, but centers the arena during a boss fight.
    let camX = state.player.x;
    let camY = state.player.y;
    if (state.bossFight && state.dungeon.boss) {
      const br = state.dungeon.boss.room;
      camX = (br.x + br.w / 2) * TS;
      camY = (br.y + br.h / 2) * TS;
    }
    state.cam.x = U.lerp(state.cam.x, camX, Math.min(1, dt * 7));
    state.cam.y = U.lerp(state.cam.y, camY, Math.min(1, dt * 7));

    return state;
  }

  // Fixed-timestep driver for the server loop (Phase 1): banks real elapsed time
  // and advances the sim in whole 30 Hz ticks. Clamps runaway gaps to 0.25 s so a
  // stalled process doesn't spiral into a catch-up storm.
  Game.TICK = 1 / 30;

  Game.stepFixed = function (state, inputs, elapsedSec) {
    let acc = (state._acc || 0) + Math.min(elapsedSec, 0.25);
    let s = state;
    while (acc >= Game.TICK) {
      acc -= Game.TICK;
      s = Game.update(s, inputs, Game.TICK);
    }
    s._acc = acc; // survives restart-returned states too
    return s;
  };
})();
