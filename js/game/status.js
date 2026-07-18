// game/status.js — timed conditions (slow, stun, burn) carried by heroes and
// monsters alike, so a boss can slow you and your Nova can slow a boss with the
// same three verbs. Modelled on the healPool/healRate precedent: a small amount
// of state on the entity, advanced once per frame from one place.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;

  const KINDS = ['slow', 'stun', 'burn'];
  G.STATUS_KINDS = KINDS;

  // Refresh-longest. Re-applying a condition never shortens it and never weakens
  // it, so a stream of weak chip-slows cannot dilute a boss's big one, and the
  // player never watches a debuff get *better* because they were hit again.
  G.applyStatus = function applyStatus(ent, kind, dur, opts) {
    if (!ent || !KINDS.includes(kind) || !(dur > 0)) return false;
    const o = opts || {};
    if (!ent.status) ent.status = {};
    const cur = ent.status[kind];
    const next = {
      t: dur,
      mag: typeof o.mag === 'number' ? o.mag : 1,
      dps: typeof o.dps === 'number' ? o.dps : 0,
      acc: cur ? cur.acc : 0,
      src: o.src || null,
    };
    if (cur) {
      next.t = Math.max(cur.t, dur);
      next.mag = Math.max(cur.mag, next.mag);
      next.dps = Math.max(cur.dps, next.dps);
      next.src = next.src || cur.src;
    }
    ent.status[kind] = next;
    return true;
  };

  // The read side lives in Entities so effectiveStats can fold slow into
  // moveMult without reaching up into game/. These are aliases, not copies.
  G.hasStatus = (ent, kind) => Entities.hasStatus(ent, kind);
  G.statusMoveMult = (ent) => Entities.statusMoveMult(ent);

  G.clearStatus = function clearStatus(ent) {
    if (ent) ent.status = undefined;
  };

  // Advance every condition on one entity. `state` may be null for pure timer
  // tests; burn needs it to route damage through the real combat paths.
  G.statusUpdate = function statusUpdate(state, ent, dt) {
    if (!ent || !ent.status) return;
    for (const kind of KINDS) {
      const st = ent.status[kind];
      if (!st) continue;
      st.t -= dt;

      // Burn accumulates fractional damage and spends it a whole point at a
      // time, so a 10 dps burn over 2s deals 20 — not 120 rounding-up ticks of 1.
      if (kind === 'burn' && st.dps > 0 && state) {
        st.acc += st.dps * Math.min(dt, Math.max(0, st.t + dt));
        const whole = Math.floor(st.acc);
        if (whole > 0) {
          st.acc -= whole;
          G.applyBurnTick(state, ent, whole, st.src);
        }
      }

      if (st.t <= 0) delete ent.status[kind];
    }
  };

  // Burn damage goes through the same doors as everything else: monsters via
  // hitMonster (so it can trigger boss phase transitions and credit the kill),
  // heroes via a direct deduction that respects nothing — fire ignores armor.
  G.applyBurnTick = function applyBurnTick(state, ent, dmg, src) {
    if (dmg <= 0) return;
    const isMonster = state.monsters && state.monsters.indexOf(ent) !== -1;
    if (isMonster) {
      const killer = src && src.hp !== undefined && !src.type ? src : state.player;
      G.hitMonster(state, ent, dmg, Entities.effectiveStats(killer), 0, 0, killer);
    } else {
      ent.hp -= dmg;
      ent.hurtT = Math.max(ent.hurtT || 0, 0.15);
    }
    G.floatText(state, ent.x, ent.y - 20, `-${dmg}`, '#ff8c3d', 12);
  };

  if (typeof module !== 'undefined') module.exports = Game;
})();
