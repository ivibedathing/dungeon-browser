// items.js — item generation, affixes, rarities, and bag/equipment operations. Pure; node-testable.
(function () {
  const U = typeof require === 'function' ? require('./util.js') : window.U;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;

  const Items = {};

  Items.RARITIES = {
    common: { weight: Balance.rarity.common, color: '#e8e2d6', affixes: [0, 0] },
    magic: { weight: Balance.rarity.magic, color: '#8f9bff', affixes: [1, 1] },
    rare: { weight: Balance.rarity.rare, color: '#ffd84d', affixes: [2, 3] },
    unique: { weight: Balance.rarity.unique, color: '#ff9a3d', affixes: [3, 4] },
  };

  Items.rollRarity = function (rng, guaranteeMagic = false) {
    const entries = Object.entries(Items.RARITIES).filter(
      ([name]) => !(guaranteeMagic && name === 'common')
    );
    const total = entries.reduce((s, [, r]) => s + r.weight, 0);
    let roll = rng() * total;
    for (const [name, r] of entries) {
      roll -= r.weight;
      if (roll < 0) return name;
    }
    return entries[entries.length - 1][0];
  };

  // arc in radians (total swing width), kb = knockback impulse; ranged bases fire projectiles.
  // minFloor gates better bases to deeper floors (normal/exceptional/elite tiering).
  // `family` is the VISUAL archetype (icon + held sprite), decoupled from `kind` (the
  // combat behavior). Many families share one `kind` — every melee weapon is kind 'melee'
  // and differs only by stats and family; ranged kinds each fire a projectile variant.
  const WEAPON_BASES = [
    // ---- Swords (family: sword) ----
    { base: 'Short Sword', family: 'sword', kind: 'melee', dmg: [6, 9], radius: [72, 82], speed: [2.2, 2.6], arc: 2.97, kb: 130 },
    { base: 'Scimitar', family: 'sword', kind: 'melee', dmg: [8, 11], radius: [72, 82], speed: [2.3, 2.6], arc: 3.05, kb: 130, minFloor: 2 },
    { base: 'Falchion', family: 'sword', kind: 'melee', dmg: [8, 11], radius: [70, 80], speed: [2.0, 2.3], arc: 3.14, kb: 140, minFloor: 2 },
    { base: 'Broad Sword', family: 'sword', kind: 'melee', dmg: [9, 13], radius: [74, 84], speed: [1.9, 2.2], arc: 2.97, kb: 140, minFloor: 3 },
    { base: 'Estoc', family: 'sword', kind: 'melee', dmg: [6, 9], radius: [86, 96], speed: [2.6, 3.0], arc: 2.27, kb: 100, minFloor: 4 },
    { base: 'Katana', family: 'sword', kind: 'melee', dmg: [12, 16], radius: [82, 92], speed: [2.2, 2.5], arc: 2.8, kb: 130, minFloor: 6 },
    { base: 'Runeblade', family: 'sword', kind: 'melee', dmg: [12, 16], radius: [76, 86], speed: [2.2, 2.5], arc: 2.97, kb: 150, minFloor: 8 },
    // ---- Greatswords (family: greatsword) ----
    { base: 'Claymore', family: 'greatsword', kind: 'melee', dmg: [14, 19], radius: [80, 92], speed: [1.4, 1.7], arc: 3.84, kb: 190, minFloor: 6 },
    // ---- Daggers (family: dagger) — fast, short reach ----
    { base: 'Dagger', family: 'dagger', kind: 'melee', dmg: [4, 6], radius: [58, 66], speed: [2.8, 3.2], arc: 2.44, kb: 80 },
    { base: 'Dirk', family: 'dagger', kind: 'melee', dmg: [6, 9], radius: [60, 68], speed: [2.7, 3.1], arc: 2.44, kb: 90, minFloor: 4 },
    // ---- Axes (family: axe) ----
    { base: 'Battle Axe', family: 'axe', kind: 'melee', dmg: [10, 14], radius: [68, 78], speed: [1.6, 1.9], arc: 3.58, kb: 150 },
    { base: 'Great Axe', family: 'axe', kind: 'melee', dmg: [16, 21], radius: [78, 88], speed: [1.3, 1.6], arc: 3.72, kb: 200, minFloor: 5 },
    // ---- Maces & hammers (family: mace) — heavy knockback ----
    { base: 'Iron Mace', family: 'mace', kind: 'melee', dmg: [8, 12], radius: [64, 74], speed: [1.9, 2.2], arc: 2.62, kb: 250 },
    { base: 'War Hammer', family: 'mace', kind: 'melee', dmg: [15, 20], radius: [66, 76], speed: [1.3, 1.6], arc: 2.79, kb: 300, minFloor: 5 },
    // ---- Flails (family: flail) ----
    { base: 'Flail', family: 'flail', kind: 'melee', dmg: [9, 13], radius: [66, 76], speed: [1.8, 2.1], arc: 2.71, kb: 220, minFloor: 2 },
    { base: 'Morning Star', family: 'flail', kind: 'melee', dmg: [11, 15], radius: [70, 80], speed: [1.7, 2.0], arc: 2.88, kb: 240, minFloor: 4 },
    // ---- Polearms (family: spear) — long reach, narrow arc ----
    { base: 'Spear', family: 'spear', kind: 'melee', dmg: [7, 10], radius: [88, 102], speed: [1.8, 2.1], arc: 2.09, kb: 110 },
    { base: 'Halberd', family: 'spear', kind: 'melee', dmg: [12, 16], radius: [92, 104], speed: [1.6, 1.9], arc: 2.44, kb: 150, minFloor: 5 },
    { base: 'Glaive', family: 'spear', kind: 'melee', dmg: [13, 17], radius: [90, 100], speed: [1.7, 2.0], arc: 2.62, kb: 140, minFloor: 7 },
    // ---- Bows (family: bow) ----
    { base: 'Hunting Bow', family: 'bow', kind: 'bow', dmg: [5, 8], speed: [1.7, 2.1], projSpeed: [400, 460] },
    { base: 'War Bow', family: 'bow', kind: 'bow', dmg: [8, 12], speed: [1.5, 1.9], projSpeed: [440, 500], minFloor: 5 },
    // ---- Crossbows (family: crossbow) — slow, hard-hitting bolts ----
    { base: 'Crossbow', family: 'crossbow', kind: 'crossbow', dmg: [9, 13], speed: [1.2, 1.5], projSpeed: [520, 600], minFloor: 3 },
    { base: 'Arbalest', family: 'crossbow', kind: 'crossbow', dmg: [13, 18], speed: [1.0, 1.3], projSpeed: [560, 640], minFloor: 7 },
    // ---- Wands (family: wand) — quick small blasts ----
    { base: 'Ember Wand', family: 'wand', kind: 'wand', dmg: [6, 10], speed: [1.3, 1.6], projSpeed: [280, 330], aoe: [50, 62] },
    // ---- Staves (family: staff) — slow, big blasts ----
    { base: "Sorcerer's Staff", family: 'staff', kind: 'staff', dmg: [9, 14], speed: [1.1, 1.4], projSpeed: [300, 350], aoe: [64, 80], minFloor: 4 },
    // ---- Thrown (family: thrown) — spinning weapons, no splash ----
    { base: 'Throwing Axe', family: 'thrown', kind: 'thrown', dmg: [7, 10], speed: [2.0, 2.4], projSpeed: [380, 440], minFloor: 2 },
    { base: 'Javelin', family: 'thrown', kind: 'thrown', dmg: [9, 13], speed: [1.8, 2.1], projSpeed: [420, 480], minFloor: 4 },
  ];
  // tone = weight-class color painted onto the sprite and icons (leather/mail/plate/bone).
  const ARMOR_BASES = [
    { base: 'Quilted Armor', def: [1, 2], hp: [0, 6], tone: '#8a6f4d' },
    { base: 'Leather Armor', def: [1, 2], hp: [0, 8], tone: '#8a6f4d' },
    { base: 'Chain Mail', def: [2, 4], hp: [4, 12], tone: '#8a94a2', minFloor: 2 },
    { base: 'Scale Mail', def: [3, 5], hp: [6, 14], tone: '#8a94a2', minFloor: 4 },
    { base: 'Gothic Plate', def: [4, 6], hp: [8, 18], mv: [-0.04, -0.02], tone: '#b8c2cf', minFloor: 5 },
    { base: 'Full Plate', def: [6, 9], hp: [12, 22], mv: [-0.05, -0.03], tone: '#b8c2cf', minFloor: 7 },
  ];
  const HELMET_BASES = [
    { base: 'Leather Cap', def: [1, 2], hp: [0, 5], tone: '#8a6f4d' },
    { base: 'Skull Cap', def: [1, 3], hp: [2, 6], tone: '#8a94a2' },
    { base: 'Full Helm', def: [2, 3], hp: [3, 8], tone: '#8a94a2', minFloor: 3 },
    { base: 'Bone Visage', def: [2, 4], hp: [3, 8], mana: [4, 10], tone: '#d8d2c2', minFloor: 4 },
    { base: 'Great Helm', def: [3, 5], hp: [6, 12], tone: '#b8c2cf', minFloor: 5 },
    { base: 'Horned Crown', def: [3, 5], hp: [8, 14], mana: [4, 8], tone: '#c9a15a', minFloor: 6 },
  ];
  const GLOVE_BASES = [
    { base: 'Hide Mitts', def: [1, 2], spd: [0.03, 0.07], tone: '#8a6f4d' },
    { base: 'Leather Gloves', def: [1, 2], spd: [0.04, 0.08], tone: '#8a6f4d' },
    { base: 'Chain Gauntlets', def: [2, 3], spd: [0.03, 0.06], tone: '#8a94a2', minFloor: 2 },
    { base: 'Duelist Gloves', def: [1, 2], spd: [0.07, 0.11], tone: '#5a5568', minFloor: 4 },
    { base: 'War Gauntlets', def: [3, 5], spd: [0.02, 0.05], tone: '#b8c2cf', minFloor: 6 },
  ];
  const PANTS_BASES = [
    { base: 'Quilted Trousers', def: [1, 2], hp: [2, 6], tone: '#8a6f4d' },
    { base: 'Leather Greaves', def: [1, 3], tone: '#8a6f4d' },
    { base: 'Mail Leggings', def: [2, 4], tone: '#8a94a2', minFloor: 2 },
    { base: 'Shadow Breeches', def: [1, 3], mv: [0.02, 0.04], tone: '#5a5568', minFloor: 4 },
    { base: 'Plated Cuisses', def: [3, 6], mv: [-0.03, -0.02], tone: '#b8c2cf', minFloor: 5 },
  ];
  const BOOTS_BASES = [
    { base: 'Rough Boots', def: [1, 1], mv: [0.03, 0.06], tone: '#8a6f4d' },
    { base: 'Worn Boots', def: [1, 2], mv: [0.03, 0.07], tone: '#8a6f4d' },
    { base: 'Chain Boots', def: [2, 3], mv: [0.02, 0.05], tone: '#8a94a2', minFloor: 2 },
    { base: 'Swift Striders', def: [1, 2], mv: [0.07, 0.11], tone: '#5a5568', minFloor: 4 },
    { base: 'Greaved Sabatons', def: [3, 4], mv: [0.02, 0.04], tone: '#b8c2cf', minFloor: 6 },
  ];
  const RING_BASES = [{ base: 'Bone Ring' }, { base: 'Iron Loop' }, { base: 'Occult Band' }];

  Items.EQUIP_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'pants', 'boots', 'ring'];

  // Affix generators: value scales gently with item level (= dungeon floor).
  const AFFIXES = {
    damage: {
      roll: (rng, f) => Math.max(1, Math.round(1 + rng() * 2 + f * 0.8)),
      label: (v) => `+${v} Damage`,
    },
    radius: {
      roll: (rng, f) => Math.round(4 + rng() * 8 + f),
      label: (v) => `+${v} Swing Radius`,
    },
    speedMult: {
      roll: (rng) => Math.round((0.08 + rng() * 0.17) * 100) / 100,
      label: (v) => `+${Math.round(v * 100)}% Attack Speed`,
    },
    maxHP: {
      roll: (rng, f) => Math.round(8 + rng() * 10 + f * 3),
      label: (v) => `+${v} to Life`,
    },
    maxMana: {
      roll: (rng, f) => Math.round(6 + rng() * 8 + f * 2),
      label: (v) => `+${v} to Mana`,
    },
    defense: {
      roll: (rng, f) => Math.max(1, Math.round(1 + rng() * 2 + f * 0.5)),
      label: (v) => `+${v} Defense`,
    },
    lifePerKill: {
      roll: (rng, f) => Math.max(1, Math.round(1 + rng() * 2 + f * 0.4)),
      label: (v) => `+${v} Life per Kill`,
    },
    xpMult: {
      roll: (rng) => Math.round((0.05 + rng() * 0.15) * 100) / 100,
      label: (v) => `+${Math.round(v * 100)}% Experience`,
    },
    moveMult: {
      roll: (rng) => Math.round((0.04 + rng() * 0.1) * 100) / 100,
      label: (v) => `+${Math.round(v * 100)}% Move Speed`,
    },
  };

  const MAGIC_PREFIXES = ['Keen', 'Stout', 'Vicious', 'Blessed', 'Cruel', 'Swift', 'Grim'];
  const NAME_A = ['Doom', 'Blood', 'Storm', 'Grim', 'Bone', 'Soul', 'Dread', 'Raven', 'Wraith', 'Hate'];
  const NAME_B = ['Fang', 'Ward', 'Bite', 'Song', 'Cleaver', 'Grasp', 'Brand', 'Howl', 'Coil', 'Edge'];

  const ARMOR_TABLES = {
    armor: ARMOR_BASES,
    helmet: HELMET_BASES,
    gloves: GLOVE_BASES,
    pants: PANTS_BASES,
    boots: BOOTS_BASES,
  };

  function rollSlot(rng) {
    const r = rng();
    if (r < 0.3) return 'weapon';
    if (r < 0.48) return 'armor';
    if (r < 0.58) return 'helmet';
    if (r < 0.68) return 'gloves';
    if (r < 0.78) return 'pants';
    if (r < 0.88) return 'boots';
    return 'ring';
  }

  Items.makeItem = function (floor, rng, opts = {}) {
    const slot = opts.slot || rollSlot(rng);
    const rarity = opts.rarity || Items.rollRarity(rng, opts.guaranteeMagic);
    const dmgScale = 1 + 0.22 * (floor - 1);

    let baseDef;
    let stats;
    let kind;
    if (slot === 'weapon') {
      let pool = (opts.kind ? WEAPON_BASES.filter((b) => b.kind === opts.kind) : WEAPON_BASES).filter(
        (b) => (b.minFloor || 1) <= floor
      );
      if (!pool.length) pool = opts.kind ? WEAPON_BASES.filter((b) => b.kind === opts.kind) : WEAPON_BASES;
      baseDef = U.pick(rng, pool);
      kind = baseDef.kind;
      stats = {
        damage: Math.max(1, Math.round(U.randRange(rng, ...baseDef.dmg) * dmgScale)),
        speed: Math.round(U.randRange(rng, ...baseDef.speed) * 100) / 100,
      };
      if (kind === 'melee') {
        stats.radius = Math.round(U.randRange(rng, ...baseDef.radius) + Math.min(20, floor - 1));
        stats.arc = baseDef.arc;
        stats.kb = baseDef.kb;
      } else {
        stats.projSpeed = Math.round(U.randRange(rng, ...baseDef.projSpeed));
        if (baseDef.aoe) stats.aoe = Math.round(U.randRange(rng, ...baseDef.aoe));
      }
    } else if (ARMOR_TABLES[slot]) {
      const pool = ARMOR_TABLES[slot].filter((b) => (b.minFloor || 1) <= floor);
      baseDef = U.pick(rng, pool.length ? pool : ARMOR_TABLES[slot]);
      stats = {
        defense: Math.max(1, Math.round(U.randRange(rng, ...baseDef.def) * (1 + 0.18 * (floor - 1)))),
      };
      if (baseDef.hp) {
        const hp = Math.round(U.randRange(rng, ...baseDef.hp) * (1 + 0.12 * (floor - 1)));
        if (hp > 0) stats.maxHP = hp;
      }
      if (baseDef.mana) {
        const mana = Math.round(U.randRange(rng, ...baseDef.mana) * (1 + 0.1 * (floor - 1)));
        if (mana > 0) stats.maxMana = mana;
      }
      // Slot signatures: gloves swing faster, boots run faster; heavy plate can slow you.
      if (baseDef.spd) {
        stats.speedMult = Math.min(0.15, Math.round((U.randRange(rng, ...baseDef.spd) + Math.min(0.04, floor * 0.005)) * 100) / 100);
      }
      if (baseDef.mv) {
        const bonus = slot === 'boots' ? Math.min(0.04, floor * 0.005) : 0;
        const v = U.randRange(rng, ...baseDef.mv) + bonus;
        stats.moveMult = slot === 'boots' ? Math.min(0.15, Math.round(v * 100) / 100) : Math.round(v * 100) / 100;
      }
    } else {
      baseDef = U.pick(rng, RING_BASES);
      stats = {};
    }

    const [lo, hi] = Items.RARITIES[rarity].affixes;
    const n = U.randInt(rng, lo, hi);
    // Swing-radius affixes are meaningless on projectile weapons.
    const pool = Object.keys(AFFIXES).filter((k) => !(kind && kind !== 'melee' && k === 'radius'));
    const affixes = [];
    for (let i = 0; i < n && pool.length; i++) {
      const key = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const val = AFFIXES[key].roll(rng, floor);
      affixes.push({ key, val, label: AFFIXES[key].label(val) });
    }

    let name = baseDef.base;
    if (rarity === 'magic') name = `${U.pick(rng, MAGIC_PREFIXES)} ${baseDef.base}`;
    if (rarity === 'rare' || rarity === 'unique') {
      name = `${U.pick(rng, NAME_A)} ${U.pick(rng, NAME_B)}`;
    }

    const item = {
      slot,
      base: baseDef.base,
      name,
      rarity,
      color: Items.RARITIES[rarity].color,
      ilvl: floor,
      stats,
      affixes,
    };
    if (kind) item.kind = kind;
    if (baseDef.family) item.family = baseDef.family;
    if (baseDef.tone) item.tone = baseDef.tone;
    return item;
  };

  const POTION_TIERS = [
    { name: 'Minor Healing Potion', heal: 40 },
    { name: 'Light Healing Potion', heal: 70 },
    { name: 'Healing Potion', heal: 110 },
    { name: 'Greater Healing Potion', heal: 170 },
    { name: 'Super Healing Potion', heal: 260 },
  ];
  const MANA_TIERS = [
    { name: 'Minor Mana Potion', mana: 30 },
    { name: 'Light Mana Potion', mana: 50 },
    { name: 'Mana Potion', mana: 80 },
    { name: 'Greater Mana Potion', mana: 120 },
    { name: 'Super Mana Potion', mana: 180 },
  ];

  Items.makePotion = function (floor, rng, kind = 'health') {
    const tier = U.clamp(Math.floor((floor - 1) / 2), 0, POTION_TIERS.length - 1);
    if (kind === 'mana') {
      const t = MANA_TIERS[tier];
      return { slot: 'potion', kind: 'mana', name: t.name, mana: t.mana, tier, color: '#5b8ee8' };
    }
    const t = POTION_TIERS[tier];
    return { slot: 'potion', kind: 'health', name: t.name, heal: t.heal, tier, color: '#e5534b' };
  };

  const UNARMED = { damage: 3, radius: 60, speed: 2.0, arc: 2.97, kb: 100 };

  // Effective combined stats from the full equipment map.
  Items.aggregateStats = function (equip) {
    const w = equip && equip.weapon;
    const s = {
      damage: w ? Items.weaponDamage(w) : UNARMED.damage,
      radius: w && w.stats.radius ? w.stats.radius : UNARMED.radius,
      kind: (w && w.kind) || 'melee',
      arc: (w && w.stats.arc) || UNARMED.arc,
      kb: (w && w.stats.kb) || UNARMED.kb,
      projSpeed: (w && w.stats.projSpeed) || 0,
      aoe: (w && w.stats.aoe) || 0,
      maxHP: 0,
      maxMana: 0,
      defense: 0,
      lifePerKill: 0,
    };
    let baseSpeed = w ? w.stats.speed : UNARMED.speed;
    let speedAdd = 0;
    let xpAdd = 0;
    let moveAdd = 0;
    for (const key of Items.EQUIP_SLOTS) {
      const item = equip && equip[key];
      if (!item) continue;
      if (key !== 'weapon') {
        s.defense += item.stats.defense || 0;
        s.maxHP += item.stats.maxHP || 0;
        s.maxMana += item.stats.maxMana || 0;
        speedAdd += item.stats.speedMult || 0;
        moveAdd += item.stats.moveMult || 0;
      }
      for (const a of item.affixes || []) {
        if (a.key === 'damage') s.damage += a.val;
        else if (a.key === 'radius') s.radius += a.val;
        else if (a.key === 'maxHP') s.maxHP += a.val;
        else if (a.key === 'maxMana') s.maxMana += a.val;
        else if (a.key === 'defense') s.defense += a.val;
        else if (a.key === 'lifePerKill') s.lifePerKill += a.val;
        else if (a.key === 'speedMult') speedAdd += a.val;
        else if (a.key === 'xpMult') xpAdd += a.val;
        else if (a.key === 'moveMult') moveAdd += a.val;
      }
    }
    s.speed = baseSpeed * (1 + speedAdd);
    s.xpMult = 1 + xpAdd;
    s.moveMult = 1 + moveAdd;
    return s;
  };

  // ---- Weapon upgrade levels (the Blacksmith's trade) ----

  Items.MAX_PLUS = Balance.upgrade.maxPlus;
  Items.PLUS_DMG = Balance.upgrade.dmgPerPlus;

  Items.weaponDamage = (item) => Math.round(item.stats.damage * (1 + Items.PLUS_DMG * (item.plus || 0)));

  Items.displayName = (item) => (item.plus ? `+${item.plus} ${item.name}` : item.name);

  Items.upgradeWeapon = function (item) {
    if (!item || item.slot !== 'weapon') return false;
    if ((item.plus || 0) >= Items.MAX_PLUS) return false;
    item.plus = (item.plus || 0) + 1;
    return true;
  };

  Items.upgradeCost = function (item) {
    const rarityMult = { common: 1, magic: 1.6, rare: 2.4, unique: 4 }[item.rarity] || 1;
    return Math.round((15 + (item.ilvl || 1) * 5) * rarityMult * Math.pow(1.5, item.plus || 0));
  };

  // ---- Trade values ----

  const RARITY_VALUE = { common: 1, magic: 2.2, rare: 4.5, unique: 9 };

  Items.sellPrice = function (item) {
    if (item.slot === 'potion') return 3 + (item.tier || 0) * 4;
    let price = Math.max(1, Math.round((4 + (item.ilvl || 1) * 3) * (RARITY_VALUE[item.rarity] || 1)));
    if (item.plus) price = Math.round(price * (1 + 0.25 * item.plus));
    return price;
  };

  Items.buyPrice = function (item) {
    if (item.slot === 'potion') return 12 + (item.tier || 0) * 10;
    return Items.sellPrice(item) * 3;
  };

  // ---- Bag (inventory + potion belt + gold) ----

  Items.BAG_SIZE = 24;
  Items.BELT_SIZE = 4;
  Items.POTION_BOX_SIZE = 5;

  Items.createBag = function () {
    return {
      slots: new Array(Items.BAG_SIZE).fill(null),
      belt: new Array(Items.BELT_SIZE).fill(null),
      potions: { health: [], mana: [] },
      gold: 0,
    };
  };

  // Potions live in the belt (quick use) and the potion box (one row per
  // kind) — never in the bag grid, which is reserved for gear.
  Items.potionRow = (bag, kindOrItem) => {
    const kind = typeof kindOrItem === 'string' ? kindOrItem : kindOrItem.kind;
    return bag.potions[kind === 'mana' ? 'mana' : 'health'];
  };

  Items.addItem = function (bag, item) {
    if (item.slot === 'potion') {
      const b = bag.belt.indexOf(null);
      if (b !== -1) {
        bag.belt[b] = item;
        return true;
      }
      const row = Items.potionRow(bag, item);
      if (row.length < Items.POTION_BOX_SIZE) {
        row.push(item);
        return true;
      }
      return false;
    }
    const i = bag.slots.indexOf(null);
    if (i === -1) return false;
    bag.slots[i] = item;
    return true;
  };

  Items.removeItem = function (bag, index) {
    const item = bag.slots[index] || null;
    bag.slots[index] = null;
    return item;
  };

  Items.refillBelt = function (bag) {
    for (let b = 0; b < bag.belt.length; b++) {
      if (bag.belt[b]) continue;
      // Box first (healing before mana), then any legacy grid potions.
      if (bag.potions.health.length) {
        bag.belt[b] = bag.potions.health.shift();
        continue;
      }
      if (bag.potions.mana.length) {
        bag.belt[b] = bag.potions.mana.shift();
        continue;
      }
      const i = bag.slots.findIndex((it) => it && it.slot === 'potion');
      if (i === -1) return;
      bag.belt[b] = bag.slots[i];
      bag.slots[i] = null;
    }
  };

  Items.useBeltPotion = function (bag, beltIndex) {
    const p = bag.belt[beltIndex] || null;
    if (!p) return null;
    bag.belt[beltIndex] = null;
    Items.refillBelt(bag);
    return p;
  };

  Items.equipFromBag = function (player, bag, index) {
    const item = bag.slots[index];
    if (!item || !Items.EQUIP_SLOTS.includes(item.slot)) return false;
    const old = player.equip[item.slot] || null;
    player.equip[item.slot] = item;
    bag.slots[index] = old;
    return true;
  };

  if (typeof window !== 'undefined') window.Items = Items;
  if (typeof module !== 'undefined') module.exports = Items;
})();
