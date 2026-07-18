// game/ai.js — monster behavior: shared upkeep (wander, aggro, flow-field chase,
// status, knockback) plus the per-type combat dispatch. A monster's `behavior`
// field selects an entry in G.BEHAVIORS; the registry is seeded here with melee,
// the shared movement helpers (chaseStep/moveAway), and the per-archetype specials
// (ranged, exploder, charger, summoner). Boss behaviors live in js/game/behaviors.js.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const Balance = typeof window !== 'undefined' ? window.Balance : require('../balance.js');
  const G = Game._;
  const { TS, PLAYER_R } = G;

  function nearestPlayer(state, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const pl of state.players) {
      if (pl.dead) continue;
      const d = U.dist2(x, y, pl.x, pl.y);
      if (d < bestD) {
        bestD = d;
        best = pl;
      }
    }
    return best;
  }

  G.monsterUpdate = function monsterUpdate(state, m, dt) {
    const p = nearestPlayer(state, m.x, m.y);
    if (!p) return;
    G.statusUpdate(state, m, dt);
    m.attackT = Math.max(0, m.attackT - dt);
    m.hitT = Math.max(0, m.hitT - dt);
    m.lungeT = Math.max(0, m.lungeT - dt);
    m.tel = 0; // telegraph charge (0..1); specials raise it while winding up

    // Collision radius is capped so oversized champions still fit 1-tile corridors.
    const mr = Math.min(13, m.size * 0.8);

    // Knockback decays quickly.
    if (m.kbx || m.kby) {
      const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, m.kbx * dt, m.kby * dt);
      m.x = moved.x;
      m.y = moved.y;
      m.kbx *= Math.max(0, 1 - 9 * dt);
      m.kby *= Math.max(0, 1 - 9 * dt);
      if (Math.abs(m.kbx) < 2) m.kbx = 0;
      if (Math.abs(m.kby) < 2) m.kby = 0;
    }

    // Stunned: knockback still applies above, but it cannot act or steer.
    if (Entities.hasStatus(m, 'stun')) return;

    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    const mtx = Math.floor(m.x / TS);
    const mty = Math.floor(m.y / TS);
    const flow = state.flow.field;
    const flowDist = Dungeon.flowAt(flow, mtx, mty);

    // Leash: a chase that has dragged a monster too far from where it lives is
    // abandoned, and it walks home. This is what stops a conga line forming
    // across a 65,536-px map as every monster you run past joins the train.
    // `returning` is the hysteresis — without it a monster at the leash edge
    // would re-aggro on the same frame it gave up.
    if (m.home) {
      const leashPx = (m.leash || Balance.world.leashTiles) * TS;
      const fromHome = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      if (m.returning) {
        if (fromHome <= leashPx * 0.35) {
          m.returning = false;
          m.wp = null;
        }
      } else if (m.aggroed && fromHome > leashPx) {
        m.returning = true;
        m.aggroed = false;
      }
    }

    if (!m.aggroed && !m.returning && flowDist * TS <= m.aggro) m.aggroed = true;

    if (!m.aggroed) {
      G.wanderStep(state, m, dt, mr);
      return;
    }

    // Per-type behavior. Everything above is shared upkeep every monster needs
    // (timers, knockback, stun, aggro, idle wander); everything below is how this
    // particular monster fights. A monster with no `behavior` — which is every
    // regular monster in the game — takes the melee path unchanged.
    const ctx = { p, dist, mr, flow, flowDist, mtx, mty };
    const behave = (m.behavior && G.BEHAVIORS[m.behavior]) || G.BEHAVIORS.melee;
    behave(state, m, dt, ctx);
  };

  // Idle movement. A floor spawn has no `home` and keeps the original
  // random-angle jitter verbatim — including its exact draws from state.srand,
  // which the dungeon traces are pinned against. A world resident has a home,
  // and drifts between waypoints inside its leash instead: at overworld
  // distances, jittering on the spot reads as a broken animation, and a monster
  // that never moves more than a few pixels from its spawn tile makes the
  // country feel staged rather than lived in.
  G.wanderStep = function wanderStep(state, m, dt, mr) {
    if (!m.home) {
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 1 + state.srand() * 2.2;
        m.wandA = state.srand() * Math.PI * 2;
        if (state.srand() < 0.4) m.wandA = NaN; // stand still
      }
      if (!Number.isNaN(m.wandA)) {
        const v = m.speed * Entities.statusMoveMult(m) * (m.speedMult || 1) * 0.35 * dt;
        const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, Math.cos(m.wandA) * v, Math.sin(m.wandA) * v);
        m.x = moved.x;
        m.y = moved.y;
      }
      return;
    }

    const leashPx = (m.leash || Balance.world.leashTiles) * TS;
    m.wanderT -= dt;
    if (m.returning) {
      m.wp = m.home;
    } else if (!m.wp || m.wanderT <= 0) {
      m.wanderT = 2 + state.srand() * 3;
      if (state.srand() < 0.75) {
        const a = state.srand() * Math.PI * 2;
        const r = state.srand() * leashPx * 0.8;
        m.wp = { x: m.home.x + Math.cos(a) * r, y: m.home.y + Math.sin(a) * r };
      } else {
        m.wp = null; // stand and watch a while
      }
    }
    if (!m.wp) return;

    const dx = m.wp.x - m.x;
    const dy = m.wp.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      m.wp = null;
      m.wanderT = Math.min(m.wanderT, 0.5 + state.srand() * 1.5);
      return;
    }
    // Heading home is a purposeful walk; drifting between waypoints is a stroll.
    const pace = m.returning ? 0.6 : 0.35;
    const v = m.speed * Entities.statusMoveMult(m) * (m.speedMult || 1) * pace * dt;
    const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, (dx / d) * v, (dy / d) * v);
    // Walked into a cliff or a shoreline: this waypoint is unreachable, so drop
    // it and pick another rather than grinding against the terrain forever.
    if (moved.x === m.x && moved.y === m.y) {
      m.wp = null;
      m.wanderT = 0;
    }
    m.x = moved.x;
    m.y = moved.y;
  };

  G.BEHAVIORS = {};

  // The original chase-and-melee, extracted so there is exactly one chase
  // implementation rather than a copy that drifts from it. The hit itself is routed
  // through hurtPlayer, the single door where dodge, defense, the run's tally sheet,
  // and thorns retaliation all apply — bypassing it silently dropped thorns.
  G.BEHAVIORS.melee = function melee(state, m, dt, ctx) {
    const { p, dist } = ctx;

    // Attack if in range.
    const range = m.attackRange + PLAYER_R;
    if (dist <= range) {
      if (m.attackT <= 0) {
        m.attackT = m.attackCd;
        m.lungeT = 0.18;
        // Thunk so the damage-variance roll only fires on a landed hit — a dodge
        // short-circuits it, keeping the RNG stream identical to the pre-seam path.
        G.hurtPlayer(state, p, () => m.dmg * (0.9 + state.srand() * 0.2), { attacker: m });
      }
      return;
    }

    G.chaseStep(state, m, dt, ctx);
  };

  // The shared approach step: descend the BFS flow field toward the target,
  // steering straight once adjacent, with boid separation so packs don't stack.
  // Every behavior that needs to close distance goes through this one copy.
  G.chaseStep = function chaseStep(state, m, dt, ctx) {
    const { p, dist, mr, flow, flowDist, mtx, mty } = ctx;
    // Chase: descend the BFS flow field; steer straight when adjacent-tile close.
    let targetX = null;
    let targetY = null;
    if (flowDist !== Infinity && flowDist <= 2) {
      targetX = p.x;
      targetY = p.y;
    } else if (flow && flowDist !== Infinity) {
      let best = flowDist;
      let bx = mtx;
      let by = mty;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = mtx + dx;
        const ny = mty + dy;
        const v = Dungeon.flowAt(flow, nx, ny);
        if (v < best) {
          best = v;
          bx = nx;
          by = ny;
        }
      }
      targetX = (bx + 0.5) * TS;
      targetY = (by + 0.5) * TS;
    } else if (dist < m.aggro * 1.5) {
      targetX = p.x;
      targetY = p.y;
    }
    if (targetX === null) return;

    let ax = targetX - m.x;
    let ay = targetY - m.y;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len;
    ay /= len;

    // Separation from other monsters so packs don't stack.
    for (const o of state.monsters) {
      if (o === m) continue;
      const d2 = U.dist2(m.x, m.y, o.x, o.y);
      const rr = (m.size + o.size) * 0.9;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        ax += ((m.x - o.x) / d) * 0.6;
        ay += ((m.y - o.y) / d) * 0.6;
      }
    }
    const alen = Math.hypot(ax, ay) || 1;
    const v = (m.speed * Entities.statusMoveMult(m) * (m.speedMult || 1) * dt) / alen;
    const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, ax * v, ay * v);
    m.x = moved.x;
    m.y = moved.y;
  };

  // The back-away counterpart to chaseStep: kiters and chargers use it to open
  // distance. Same separation and status-aware speed, just aimed away from the hero.
  G.moveAway = function moveAway(state, m, dt, ctx) {
    const { p, mr } = ctx;
    let ax = m.x - p.x;
    let ay = m.y - p.y;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len;
    ay /= len;
    for (const o of state.monsters) {
      if (o === m) continue;
      const d2 = U.dist2(m.x, m.y, o.x, o.y);
      const rr = (m.size + o.size) * 0.9;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        ax += ((m.x - o.x) / d) * 0.5;
        ay += ((m.y - o.y) / d) * 0.5;
      }
    }
    const alen = Math.hypot(ax, ay) || 1;
    const v = (m.speed * Entities.statusMoveMult(m) * (m.speedMult || 1) * dt) / alen;
    const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, ax * v, ay * v);
    m.x = moved.x;
    m.y = moved.y;
  };

  // ---- Per-archetype specials. Each assumes the monster is aggroed and reads its
  // tuning from Balance.behaviors so the numbers live in one place. ----

  G.BEHAVIORS.ranged = function ranged(state, m, dt, ctx) {
    const { p, dist } = ctx;
    const B = Balance.behaviors.ranged;
    if (m.castT > 0) {
      // Charging: hold still, telegraph, and loose the bolt at the locked aim point.
      m.castT -= dt;
      m.tel = 1 - Math.max(0, m.castT) / B.castTime;
      if (m.castT <= 0) {
        m.castT = 0;
        G.spawnHostileBolt(state, m, m.aimX, m.aimY, B.boltSpeed, m.dmg);
      }
      return;
    }
    const los = G.lineOfSight(state.dungeon.grid, m.x, m.y, p.x, p.y);
    if (dist < B.kiteRange) G.moveAway(state, m, dt, ctx);
    else if (dist > B.fireRange || !los) G.chaseStep(state, m, dt, ctx);
    if (m.attackT <= 0 && dist <= B.fireRange && los) {
      m.castT = B.castTime;
      m.attackT = m.attackCd;
      m.aimX = p.x; // aim locks at cast start ⇒ the shot is dodgeable
      m.aimY = p.y;
    }
  };

  G.BEHAVIORS.exploder = function exploder(state, m, dt, ctx) {
    const { dist } = ctx;
    const B = Balance.behaviors.exploder;
    if ((m.fuseT || 0) > 0) {
      m.fuseT -= dt;
      m.tel = 1 - Math.max(0, m.fuseT) / B.fuseTime;
      G.chaseStep(state, m, dt, ctx); // lurch on while burning
      if (m.fuseT <= 0) G.explodeMonster(state, m, B.blastRadius, m.dmg, B.blastKb);
      return;
    }
    if (dist <= m.attackRange + PLAYER_R) {
      m.fuseT = B.fuseTime;
      m.lungeT = 0.18;
      return;
    }
    G.chaseStep(state, m, dt, ctx);
  };

  G.BEHAVIORS.charger = function charger(state, m, dt, ctx) {
    const { p, dist, mr } = ctx;
    const B = Balance.behaviors.charger;
    if ((m.dashT || 0) > 0) {
      // Dashing: fly straight, deal one heavy contact hit, stop on wall or on contact.
      m.dashT -= dt;
      const step = B.dashSpeed * dt;
      const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, m.dashVX * step, m.dashVY * step);
      if (moved.x === m.x && moved.y === m.y) m.dashT = 0; // hit a wall
      m.x = moved.x;
      m.y = moved.y;
      for (const pl of state.players) {
        if (pl.dead || pl.down) continue;
        const reach = m.size + PLAYER_R;
        if (U.dist2(m.x, m.y, pl.x, pl.y) < reach * reach) {
          G.hurtPlayer(state, pl, m.dmg, { attacker: m, shake: 3 });
          m.dashT = 0;
          break;
        }
      }
      return;
    }
    if ((m.windupT || 0) > 0) {
      m.windupT -= dt;
      m.tel = 1 - Math.max(0, m.windupT) / B.windupTime;
      if (m.windupT <= 0) {
        const a = Math.atan2(m.aimY - m.y, m.aimX - m.x);
        m.dashVX = Math.cos(a);
        m.dashVY = Math.sin(a);
        m.dashT = B.dashTime;
      }
      return;
    }
    const los = G.lineOfSight(state.dungeon.grid, m.x, m.y, p.x, p.y);
    if (m.attackT <= 0 && dist <= B.triggerRange && dist >= B.minRange && los) {
      m.windupT = B.windupTime;
      m.attackT = m.attackCd;
      m.aimX = p.x;
      m.aimY = p.y;
      return;
    }
    if (dist < B.minRange) G.moveAway(state, m, dt, ctx);
    else G.chaseStep(state, m, dt, ctx);
  };

  G.BEHAVIORS.summoner = function summoner(state, m, dt, ctx) {
    const { dist } = ctx;
    const B = Balance.behaviors.summoner;
    if (m.castT > 0) {
      m.castT -= dt;
      m.tel = 1 - Math.max(0, m.castT) / B.castTime;
      if (m.castT <= 0) {
        m.castT = 0;
        const alive = state.monsters.filter((o) => o.summonerId === m.id).length;
        const n = Math.min(Math.max(0, B.cap - alive), B.minionsPerCast);
        for (let i = 0; i < n; i++) G.spawnMinion(state, m, B.minionType);
      }
      return;
    }
    if (dist < B.kiteRange) G.moveAway(state, m, dt, ctx);
    else G.chaseStep(state, m, dt, ctx);
    if (m.attackT <= 0) {
      const alive = state.monsters.filter((o) => o.summonerId === m.id).length;
      if (alive < B.cap) {
        m.castT = B.castTime;
        m.attackT = m.attackCd;
      } else {
        m.attackT = 1; // at the cap — recheck shortly
      }
    }
  };
})();
