// game/ai.js — monster behavior: wander, aggro, flow-field chase, and attacks.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
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
    const stats = Entities.effectiveStats(p);
    G.statusUpdate(state, m, dt);
    m.attackT = Math.max(0, m.attackT - dt);
    m.hitT = Math.max(0, m.hitT - dt);
    m.lungeT = Math.max(0, m.lungeT - dt);

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
        const v = m.speed * Entities.statusMoveMult(m) * 0.35 * dt;
        const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, Math.cos(m.wandA) * v, Math.sin(m.wandA) * v);
        m.x = moved.x;
        m.y = moved.y;
      }
      return;
    }

    // Attack if in range.
    const range = m.attackRange + PLAYER_R;
    if (dist <= range) {
      if (m.attackT <= 0) {
        m.attackT = m.attackCd;
        m.lungeT = 0.18;
        if (p.dodgeT > 0) {
          // Rolled clean through the swing.
          G.floatText(state, p.x, p.y - 24, 'dodged!', '#c9c2b2', 13);
        } else {
          const dmg = Entities.damageAfterDefense(m.dmg * (0.9 + state.srand() * 0.2), stats.defense);
          p.hp -= dmg;
          p.hurtT = 0.3;
          state.shake = Math.min(8, state.shake + 2.5);
          G.floatText(state, p.x, p.y - 24, `-${dmg}`, '#ff5c4d', 15);
          G.burst(state, p.x, p.y, '#c03a2b', 6, 100);
          G.sfx(state, 'hurt');
        }
      }
      return;
    }

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
    const v = (m.speed * Entities.statusMoveMult(m) * dt) / alen;
    const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, ax * v, ay * v);
    m.x = moved.x;
    m.y = moved.y;
  };
})();
