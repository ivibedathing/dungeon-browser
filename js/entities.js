// entities.js — player progression and monster archetypes with per-floor scaling. Pure; node-testable.
(function () {
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
    };
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
      moveMult: g.moveMult,
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

  const CHAMP_A = ['Gore', 'Ash', 'Fell', 'Rot', 'Vile', 'Black', 'Iron', 'Blight'];
  const CHAMP_B = ['maw', 'fang', 'claw', 'gnash', 'hide', 'horn', 'shade', 'tusk'];

  E.makeMonster = function (type, floor, champion = false) {
    const base = E.MONSTER_TYPES[type];
    const C = Balance.champion;
    const hp0 = Math.round(base.hp * E.hpScale(floor));
    const dmg0 = Math.max(1, Math.round(base.dmg * E.dmgScale(floor)));
    const xp0 = Math.round(base.xp * E.xpScale(floor));
    const hp = champion ? Math.round(hp0 * C.hp) : hp0;
    const m = {
      type,
      champion,
      hp,
      maxHP: hp,
      dmg: champion ? Math.round(dmg0 * C.dmg) : dmg0,
      xp: champion ? xp0 * C.xp : xp0,
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

  const BOSS_NAMES = ['Morgra the Warden', 'Ashmaw the Devourer', 'Kargul Flamehide', 'Vexis the Unmourned', 'Duromar Gravehorn'];

  // Floor guardians: hulking arena bosses on every second floor.
  E.makeBoss = function (floor) {
    const base = E.makeMonster('brute', floor, false);
    const B = Balance.boss;
    const idx = Math.max(0, Math.floor(floor / 2) - 1) % BOSS_NAMES.length;
    const hp = Math.round(base.hp * B.hp);
    return {
      ...base,
      boss: true,
      champion: false,
      name: BOSS_NAMES[idx],
      hp,
      maxHP: hp,
      dmg: Math.round(base.dmg * B.dmg),
      xp: base.xp * B.xp,
      speed: base.speed * B.speed,
      size: base.size * B.size,
      aggro: B.aggro,
      attackRange: B.attackRange,
      attackCd: B.attackCd,
      kbResist: B.kbResist,
      color: '#8e3b3b',
    };
  };

  E.pickMonsterType = function (rng, floor) {
    const pool = Object.entries(E.MONSTER_TYPES).filter(([, t]) => t.minFloor <= floor);
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
