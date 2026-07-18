// entities.js — player progression and monster archetypes with per-floor scaling. Pure; node-testable.
(function () {
  const Bosses = typeof require === 'function' ? require('./bosses.js') : window.Bosses;
  const Items = typeof require === 'function' ? require('./items.js') : window.Items;
  const Skills = typeof require === 'function' ? require('./skills.js') : window.Skills;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;

  const E = {};

  const P = Balance.player;

  E.xpForLevel = (n) => Math.round(Balance.xpCurve.base * Math.pow(n, Balance.xpCurve.exponent));

  E.starterWeapon = () => ({
    slot: 'weapon',
    base: 'Short Sword',
    name: 'Rusty Sword',
    rarity: 'common',
    color: Items.RARITIES.common.color,
    ilvl: 1,
    stats: { damage: 8, radius: 78, speed: 2.4 },
    affixes: [],
  });

  E.newPlayer = function (opts) {
    const equip = {};
    for (const slot of Items.EQUIP_SLOTS) equip[slot] = null;
    equip.weapon = E.starterWeapon();
    return {
      name: (opts && opts.name) || 'Wanderer',
      shirt: (opts && opts.shirt) || '#4a5578',
      level: 1,
      xp: 0,
      baseMaxHP: P.baseHP,
      baseDamage: 0,
      hp: P.baseHP,
      baseMaxMana: P.baseMana,
      mana: P.baseMana,
      skillPoints: 0,
      skills: {},
      equip,
      // Each hero owns their bag (co-op: instanced loot goes to p.bag). Solo/local
      // play reads it through the state.bag alias, so the save format is unchanged.
      bag: Items.createBag(),
    };
  };

  // Timed conditions live on the entity (see js/game/status.js, which owns
  // applying and ticking them). The *read* side lives here because effectiveStats
  // has to fold slow into moveMult, and Entities loads before any game/ part.
  E.SLOW_FLOOR = 0.25; // slow never fully immobilizes; that is stun's job

  E.hasStatus = function (ent, kind) {
    return !!(ent && ent.status && ent.status[kind] && ent.status[kind].t > 0);
  };

  E.statusMoveMult = function (ent) {
    if (!E.hasStatus(ent, 'slow')) return 1;
    return Math.max(E.SLOW_FLOOR, 1 - ent.status.slow.mag);
  };

  E.effectiveStats = function (player) {
    const g = Items.aggregateStats(player.equip);
    const sk = Skills.passives(player);
    return {
      damage: (player.baseDamage + g.damage) * sk.dmgMult,
      radius: g.radius,
      kind: g.kind,
      arc: g.arc,
      kb: g.kb,
      projSpeed: g.projSpeed,
      aoe: g.aoe,
      projMult: sk.projMult,
      speed: g.speed * sk.speedMult,
      maxHP: player.baseMaxHP + g.maxHP + sk.maxHP,
      maxMana: (player.baseMaxMana || P.baseMana) + (g.maxMana || 0) + sk.maxMana,
      manaRegen: P.manaRegenBase + sk.manaRegen,
      defense: g.defense + sk.defense,
      lifePerKill: g.lifePerKill,
      xpMult: g.xpMult,
      moveMult: g.moveMult * E.statusMoveMult(player),
    };
  };

  // Grants xp, applies any level-ups (gains per Balance.player: max HP, max mana,
  // base damage, skill points, full heal/mana refill). Returns levels gained.
  E.gainXP = function (player, amount) {
    player.xp += amount;
    let levels = 0;
    while (player.xp >= E.xpForLevel(player.level)) {
      player.xp -= E.xpForLevel(player.level);
      player.level++;
      player.baseMaxHP += P.hpPerLevel;
      player.baseMaxMana = (player.baseMaxMana || P.baseMana) + P.manaPerLevel;
      player.baseDamage += P.dmgPerLevel;
      player.skillPoints = (player.skillPoints || 0) + P.skillPointsPerLevel;
      levels++;
    }
    if (levels > 0) {
      const s = E.effectiveStats(player);
      player.hp = s.maxHP;
      player.mana = s.maxMana;
    }
    return levels;
  };

  // speed in px/s; aggro & attack ranges in px; size is draw radius in px.
  // All values live in js/balance.js — tune there, not here.
  E.MONSTER_TYPES = Balance.monsters;

  E.hpScale = (f) => 1 + Balance.scaling.hpLin * (f - 1) + Balance.scaling.hpQuad * (f - 1) * (f - 1);
  E.dmgScale = (f) => 1 + Balance.scaling.dmgLin * (f - 1);
  E.xpScale = (f) => 1 + Balance.scaling.xpLin * (f - 1);

  // Party (co-op) scaling: bigger party ⇒ tougher, more rewarding monsters. n=1 ⇒ ×1,
  // so every existing caller and solo play are byte-identical (default arg keeps it so).
  E.partyHpMult = (n) => 1 + Balance.coop.hpPerPlayer * (Math.max(1, n) - 1);
  E.partyXpMult = (n) => 1 + Balance.coop.xpPerPlayer * (Math.max(1, n) - 1);

  const CHAMP_A = ['Gore', 'Ash', 'Fell', 'Rot', 'Vile', 'Black', 'Iron', 'Blight'];
  const CHAMP_B = ['maw', 'fang', 'claw', 'gnash', 'hide', 'horn', 'shade', 'tusk'];

  E.makeMonster = function (type, floor, champion = false, partyN = 1) {
    const base = E.MONSTER_TYPES[type];
    const C = Balance.champion;
    const pHp = E.partyHpMult(partyN);
    const pXp = E.partyXpMult(partyN);
    const hp0 = Math.round(base.hp * E.hpScale(floor));
    const dmg0 = Math.max(1, Math.round(base.dmg * E.dmgScale(floor)));
    const xp0 = Math.round(base.xp * E.xpScale(floor));
    // Party scaling applies on top of champion scaling; at n=1 both mults are 1, so the
    // Math.round is a no-op on the already-integer values ⇒ identical to the old result.
    const hp = Math.round((champion ? hp0 * C.hp : hp0) * pHp);
    const m = {
      type,
      champion,
      hp,
      maxHP: hp,
      dmg: champion ? Math.round(dmg0 * C.dmg) : dmg0,
      xp: Math.round((champion ? xp0 * C.xp : xp0) * pXp),
      speed: base.speed * (champion ? C.speed : 1),
      size: base.size * (champion ? C.size : 1),
      color: base.color,
      aggro: base.aggro,
      attackRange: base.attackRange,
      attackCd: base.attackCd,
    };
    if (champion) {
      // Deterministic name (no rng needed) so generation stays reproducible.
      const a = CHAMP_A[(floor * 7 + type.length * 3) % CHAMP_A.length];
      const b = CHAMP_B[(floor * 11 + type.length * 5) % CHAMP_B.length];
      m.name = `${a}${b} the ${type[0].toUpperCase()}${type.slice(1)}`;
    }
    return m;
  };

  // Guardian names for the arena floors no act claims. Generated the same way
  // champions are named, so they never run out — the old fixed 5-entry list did,
  // repeating from floor 12 onward.
  const GUARD_A = ['Mor', 'Ash', 'Kar', 'Vex', 'Dur', 'Grim', 'Hald', 'Ser'];
  const GUARD_B = ['gra', 'maw', 'gul', 'is', 'omar', 'ek', 'voth']; // 7
  const GUARD_T = ['the Warden', 'the Devourer', 'Flamehide', 'the Unmourned', 'Gravehorn', 'the Patient']; // 6
  // Lengths 8/7/6 are pairwise near-coprime, so names cycle every lcm(8,7,6)=168
  // floors rather than every 8 — the old fixed list repeated from floor 12.

  function guardianName(floor) {
    const a = GUARD_A[(floor * 5) % GUARD_A.length];
    const b = GUARD_B[(floor * 3) % GUARD_B.length];
    const t = GUARD_T[(floor * 7) % GUARD_T.length];
    return `${a}${b} ${t}`;
  }

  // Floor guardians. On an act-boss floor (4, 8, 12, 16, 20, 24) this is the
  // named main-quest boss with its own behavior and phase ladder; on every other
  // even floor it is the generic guardian the game has always had.
  E.makeBoss = function (floor, partyN = 1) {
    const base = E.makeMonster('brute', floor, false, partyN);
    const spec = Bosses.bossForFloor(floor);
    const act = Bosses.actForFloor(floor);
    const B = spec ? Balance.actBoss[act.act] : Balance.boss;
    const G = Balance.boss; // generic combat feel, shared by both
    const hp = Math.round(base.hp * B.hp);
    const m = {
      ...base,
      boss: true,
      champion: false,
      name: spec ? `${spec.name}, ${spec.epithet}` : guardianName(floor),
      hp,
      maxHP: hp,
      dmg: Math.round(base.dmg * B.dmg),
      xp: Math.round(base.xp * B.xp),
      speed: base.speed * G.speed,
      size: base.size * B.size,
      aggro: G.aggro,
      attackRange: G.attackRange,
      attackCd: G.attackCd,
      kbResist: G.kbResist,
      color: spec ? spec.color : '#8e3b3b',
    };
    if (!spec) return m;

    // Act bosses carry their behavior, its tuning, and their phase ladder. The
    // damage-scaling fields are resolved here so behaviors read plain numbers.
    m.actBoss = act.act;
    m.final = !!act.final;
    m.behavior = spec.behavior;
    for (const k of Object.keys(spec)) {
      if (['name', 'epithet', 'color', 'behavior', 'phases'].includes(k)) continue;
      m[k] = spec[k];
    }
    m.slamDmg = Math.round(m.dmg * (spec.slamDmgMult || 1));
    m.castDmg = Math.round(m.dmg * (spec.castDmgMult || 0.75));
    m.phases = (spec.phases || []).map((ph) => ({ ...ph }));
    m.phaseIdx = 0;
    return m;
  };

  E.pickMonsterType = function (rng, floor) {
    const pool = Object.entries(E.MONSTER_TYPES).filter(([, t]) => t.minFloor <= floor && t.weight > 0);
    const total = pool.reduce((s, [, t]) => s + t.weight, 0);
    let roll = rng() * total;
    for (const [name, t] of pool) {
      roll -= t.weight;
      if (roll < 0) return name;
    }
    return pool[pool.length - 1][0];
  };

  E.damageAfterDefense = (dmg, defense) => Math.max(1, Math.round(dmg - defense));

  if (typeof window !== 'undefined') window.Entities = E;
  if (typeof module !== 'undefined') module.exports = E;
})();
