// game/ai.js — monster behavior: wander, aggro, flow-field chase, and per-archetype
// specials (melee lunge, ranged casting, exploder fuse, charger dash, summoning).
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

  // Descend the BFS flow field toward the nearest player (with pack separation) and
  // take one movement step. Returns true if it found a target to pursue.
  function chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist) {
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
        const v = flow[ny] ? flow[ny][nx] : Infinity;
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
    if (targetX === null) return false;
    steer(state, m, dt, mr, targetX - m.x, targetY - m.y, 0.6);
    return true;
  }

  // Back away from the player (kiters and chargers at too-close range).
  function moveAway(state, m, p, dt, mr) {
    steer(state, m, dt, mr, m.x - p.x, m.y - p.y, 0.5);
  }

  // Normalize a desired direction, add pack separation, and move by one speed step.
  function steer(state, m, dt, mr, dx, dy, sep) {
    let ax = dx;
    let ay = dy;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len;
    ay /= len;
    for (const o of state.monsters) {
      if (o === m) continue;
      const d2 = U.dist2(m.x, m.y, o.x, o.y);
      const rr = (m.size + o.size) * 0.9;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        ax += ((m.x - o.x) / d) * sep;
        ay += ((m.y - o.y) / d) * sep;
      }
    }
    const alen = Math.hypot(ax, ay) || 1;
    const v = (m.speed * dt) / alen;
    const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, ax * v, ay * v);
    m.x = moved.x;
    m.y = moved.y;
  }

  // ---- Per-archetype specials. Each assumes the monster is aggroed. ----

  function meleeBehavior(state, m, p, dt, mr, stats, dist, mtx, mty, flow, flowDist) {
    const range = m.attackRange + PLAYER_R;
    if (dist <= range) {
      if (m.attackT <= 0) {
        m.attackT = m.attackCd;
        m.lungeT = 0.18;
        // Thunk so the damage-variance roll only fires on a landed hit — a dodge
        // short-circuits it, keeping the RNG stream identical to the pre-refactor path.
        G.hurtPlayer(state, p, () => m.dmg * (0.9 + state.srand() * 0.2), { attacker: m });
      }
      return;
    }
    chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
  }

  function rangedBehavior(state, m, p, dt, mr, dist, los, mtx, mty, flow, flowDist) {
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
    if (dist < B.kiteRange) moveAway(state, m, p, dt, mr);
    else if (dist > B.fireRange || !los) chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
    if (m.attackT <= 0 && dist <= B.fireRange && los) {
      m.castT = B.castTime;
      m.attackT = m.attackCd;
      m.aimX = p.x; // aim locks at cast start ⇒ the shot is dodgeable
      m.aimY = p.y;
    }
  }

  function exploderBehavior(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist) {
    const B = Balance.behaviors.exploder;
    if ((m.fuseT || 0) > 0) {
      m.fuseT -= dt;
      m.tel = 1 - Math.max(0, m.fuseT) / B.fuseTime;
      chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist); // lurch on while burning
      if (m.fuseT <= 0) G.explodeMonster(state, m, B.blastRadius, m.dmg, B.blastKb);
      return;
    }
    if (dist <= m.attackRange + PLAYER_R) {
      m.fuseT = B.fuseTime;
      m.lungeT = 0.18;
      return;
    }
    chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
  }

  function chargerBehavior(state, m, p, dt, mr, dist, los, mtx, mty, flow, flowDist) {
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
    if (m.attackT <= 0 && dist <= B.triggerRange && dist >= B.minRange && los) {
      m.windupT = B.windupTime;
      m.attackT = m.attackCd;
      m.aimX = p.x;
      m.aimY = p.y;
      return;
    }
    if (dist < B.minRange) moveAway(state, m, p, dt, mr);
    else chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
  }

  function summonerBehavior(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist) {
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
    if (dist < B.kiteRange) moveAway(state, m, p, dt, mr);
    else chaseStep(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
    if (m.attackT <= 0) {
      const alive = state.monsters.filter((o) => o.summonerId === m.id).length;
      if (alive < B.cap) {
        m.castT = B.castTime;
        m.attackT = m.attackCd;
      } else {
        m.attackT = 1; // at the cap — recheck shortly
      }
    }
  }

  G.monsterUpdate = function monsterUpdate(state, m, dt) {
    const p = nearestPlayer(state, m.x, m.y);
    if (!p) return;
    const stats = Entities.effectiveStats(p);
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

    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    const mtx = Math.floor(m.x / TS);
    const mty = Math.floor(m.y / TS);
    const flow = state.flow.field;
    const flowDist = flow && flow[mty] ? flow[mty][mtx] : Infinity;

    if (!m.aggroed && flowDist * TS <= m.aggro) m.aggroed = true;

    if (!m.aggroed) {
      // Idle wander.
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 1 + state.srand() * 2.2;
        m.wandA = state.srand() * Math.PI * 2;
        if (state.srand() < 0.4) m.wandA = NaN; // stand still
      }
      if (!Number.isNaN(m.wandA)) {
        const v = m.speed * 0.35 * dt;
        const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, Math.cos(m.wandA) * v, Math.sin(m.wandA) * v);
        m.x = moved.x;
        m.y = moved.y;
      }
      return;
    }

    // Aggroed: run the archetype's behavior. Line-of-sight is only needed by the
    // ranged/charger specials, so compute it once up front for those.
    const behavior = m.behavior || 'melee';
    switch (behavior) {
      case 'ranged':
        rangedBehavior(state, m, p, dt, mr, dist, G.lineOfSight(state.dungeon.grid, m.x, m.y, p.x, p.y), mtx, mty, flow, flowDist);
        break;
      case 'exploder':
        exploderBehavior(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
        break;
      case 'charger':
        chargerBehavior(state, m, p, dt, mr, dist, G.lineOfSight(state.dungeon.grid, m.x, m.y, p.x, p.y), mtx, mty, flow, flowDist);
        break;
      case 'summoner':
        summonerBehavior(state, m, p, dt, mr, dist, mtx, mty, flow, flowDist);
        break;
      default:
        meleeBehavior(state, m, p, dt, mr, stats, dist, mtx, mty, flow, flowDist);
    }
  };
})();
