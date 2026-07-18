// game/behaviors.js — how a monster fights, as opposed to the shared upkeep in
// ai.js. Registered into G.BEHAVIORS and selected by a monster's `behavior`
// field; anything without one keeps the melee path (ai.js) untouched.
//
// These are written for bosses but are deliberately generic — an elite regular
// monster can take any of them by setting one field.
//
// Determinism rule: every random draw goes through state.srand(). Math.random()
// here would desync the server sim from the client and break same-seed replays.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { PLAYER_R } = G;

  // ---- slam: a telegraphed ground pound the player can walk out of ----
  // The wind-up is the whole point. Damage that lands without a readable tell is
  // damage the player experiences as unfair, so the telegraph is broadcast state
  // (m.telegraph) that renderers and net snapshots can both see.
  G.BEHAVIORS.slam = function slam(state, m, dt, ctx) {
    const { p, dist, mr } = ctx;
    m.slamCdT = Math.max(0, (m.slamCdT || 0) - dt);

    // Mid-windup: rooted, committed, and aimed at where the player *was*.
    if (m.telegraphT > 0) {
      m.telegraphT -= dt;
      if (m.telegraphT <= 0) {
        const tg = m.telegraph || { x: m.x, y: m.y };
        const radius = m.slamRadius || 90;
        G.burst(state, tg.x, tg.y, '#ff9a3d', 24, 190);
        state.shake = Math.min(10, state.shake + 5);
        G.sfx(state, 'explode');
        for (const pl of state.players) {
          if (pl.dead || pl.down) continue;
          const reach = radius + PLAYER_R;
          if (U.dist2(tg.x, tg.y, pl.x, pl.y) >= reach * reach) continue;
          if (pl.dodgeT > 0) {
            G.floatText(state, pl.x, pl.y - 24, 'dodged!', '#c9c2b2', 13);
            continue;
          }
          const dmg = Entities.damageAfterDefense(m.slamDmg || m.dmg, Entities.effectiveStats(pl).defense);
          pl.hp -= dmg;
          pl.hurtT = 0.3;
          G.floatText(state, pl.x, pl.y - 24, `-${dmg}`, '#ff5c4d', 16);
          G.burst(state, pl.x, pl.y, '#c03a2b', 8, 120);
          G.sfx(state, 'hurt');
          if (m.slamStun > 0) G.applyStatus(pl, 'stun', m.slamStun);
        }
        m.telegraph = null;
        m.slamCdT = m.slamCd || 3;
      }
      return;
    }

    // In range and off cooldown: commit to a spot and wind up.
    if (dist <= (m.slamRange || 120) && m.slamCdT <= 0) {
      m.telegraphT = m.slamWindup || 0.8;
      m.telegraph = { x: p.x, y: p.y, r: m.slamRadius || 90 };
      G.sfx(state, 'hit');
      return;
    }

    // Otherwise close the distance like anything else.
    G.chaseStep(state, m, dt, ctx);
    void mr;
  };

  // ---- caster: keeps its distance and throws ----
  G.BEHAVIORS.caster = function caster(state, m, dt, ctx) {
    const { p, dist, mr } = ctx;
    m.castCdT = Math.max(0, (m.castCdT || 0) - dt);
    const keepAway = m.keepAway || 200;
    const range = m.castRange || 400;

    if (dist < keepAway) {
      // Too close — back off along the straight line away from the hero. No flow
      // field in reverse, so this can corner itself; that is a fair weakness.
      const a = Math.atan2(m.y - p.y, m.x - p.x);
      const v = m.speed * Entities.statusMoveMult(m) * 0.9 * dt;
      const moved = G.moveCircle(state.dungeon.grid, m.x, m.y, mr, Math.cos(a) * v, Math.sin(a) * v);
      m.x = moved.x;
      m.y = moved.y;
    } else if (dist > range) {
      G.chaseStep(state, m, dt, ctx);
    }

    if (m.castCdT <= 0 && dist <= range && G.lineOfSight(state.dungeon.grid, m.x, m.y, p.x, p.y)) {
      m.castCdT = m.castCd || 1.6;
      const a = Math.atan2(p.y - m.y, p.x - m.x);
      const speed = m.castSpeed || 260;
      state.projectiles.push({
        id: state.nextId++,
        ownerId: m.id,
        hostile: true, // targets heroes, not monsters
        x: m.x + Math.cos(a) * 14,
        y: m.y + Math.sin(a) * 14,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        dmg: m.castDmg || m.dmg,
        kind: m.castKind || 'bolt',
        aoe: 0,
        ttl: 2.4,
        angle: a,
        burn: m.castBurn || 0,
      });
      G.sfx(state, 'fireball');
    }
  };

  // ---- summon: calls adds, up to a cap ----
  // Capped and tagged with summonedBy so a long fight cannot flood the room and
  // so phase logic can count what is still standing.
  G.BEHAVIORS.summon = function summon(state, m, dt, ctx) {
    m.summonCdT = Math.max(0, (m.summonCdT || 0) - dt);
    if (m.summonCdT <= 0) {
      m.summonCdT = m.summonCd || 8;
      G.summonAdds(state, m, m.summonType || 'skeleton', m.summonCount || 2, m.summonCap || 6);
    }
    // Summoners still fight in melee between calls.
    G.BEHAVIORS.melee(state, m, dt, ctx);
  };

  // Shared by the summon behavior and by phase transitions (Task 3), which call
  // it directly for a one-shot wave on entering a phase.
  G.summonAdds = function summonAdds(state, m, type, count, cap) {
    const alive = state.monsters.filter((x) => x.summonedBy === m.id).length;
    const room = Math.max(0, (cap === undefined ? 6 : cap) - alive);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const a = state.srand() * Math.PI * 2;
      const r = 40 + state.srand() * 40;
      const x = m.x + Math.cos(a) * r;
      const y = m.y + Math.sin(a) * r;
      if (G.collides(state.dungeon.grid, x, y, 10)) continue; // don't birth adds inside rock
      const add = Entities.makeMonster(type, state.floor, false, state.players.length);
      add.id = state.nextId++;
      add.x = x;
      add.y = y;
      add.attackT = 0;
      add.hitT = 0;
      add.lungeT = 0;
      add.wanderT = 0;
      add.wandA = 0;
      add.aggroed = true;
      add.kbx = 0;
      add.kby = 0;
      add.summonedBy = m.id;
      state.monsters.push(add);
      G.burst(state, x, y, '#8a5cff', 10, 110);
    }
    if (n > 0) G.sfx(state, 'fireball');
  };

  if (typeof module !== 'undefined') module.exports = Game;
})();
