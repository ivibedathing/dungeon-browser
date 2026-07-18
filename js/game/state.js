// game/state.js — run lifecycle: new runs, per-floor state, and save restore.
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const Props = typeof window !== 'undefined' ? window.Props : require('../props.js');
  const G = Game._;
  const { TS } = G;

  function makeFloorState(state) {
    // Seeded sim RNG: all gameplay-affecting rolls draw from this stream so a
    // room's outcome is a pure function of (runSeed, floor, inputs). Cosmetic
    // randomness (particle scatter, shake jitter) stays on Math.random.
    state.srand = U.mulberry32((((state.runSeed >>> 0) ^ Math.imul(state.floor, 2654435761)) >>> 0) + 1);
    const dungeon = Dungeon.generateDungeon(state.runSeed, state.floor);
    state.dungeon = dungeon;
    state.explored = Array.from({ length: dungeon.height }, () => new Array(dungeon.width).fill(false));
    state.monsters = dungeon.spawns.map((s) => ({
      ...Entities.makeMonster(s.type, state.floor, s.champion),
      id: state.nextId++,
      x: (s.x + 0.5) * TS,
      y: (s.y + 0.5) * TS,
      attackT: state.srand() * 0.5,
      hitT: 0,
      lungeT: 0,
      wanderT: state.srand() * 2,
      wandA: state.srand() * Math.PI * 2,
      aggroed: false,
      kbx: 0,
      kby: 0,
    }));
    if (dungeon.boss) {
      state.monsters.push({
        ...Entities.makeBoss(state.floor),
        id: state.nextId++,
        x: (dungeon.boss.x + 0.5) * TS,
        y: (dungeon.boss.y + 0.5) * TS,
        attackT: 0.5,
        hitT: 0,
        lungeT: 0,
        wanderT: 9,
        wandA: NaN,
        aggroed: false,
        kbx: 0,
        kby: 0,
      });
    }
    state.bossFight = false;
    // Live breakable decorations: one smashable object per placed prop, with its
    // own hp and hit-flash timer (mirrors how monsters instantiate from spawns).
    state.props = (dungeon.props || []).map((d) => {
      const hp = Props.hp(d.type);
      return {
        id: state.nextId++,
        type: d.type,
        x: (d.x + 0.5) * TS,
        y: (d.y + 0.5) * TS,
        size: (Props.TYPES[d.type] || {}).size || 11,
        hp,
        maxHP: hp,
        hitT: 0,
      };
    });
    state.groundItems = [];
    state.particles = [];
    state.floatTexts = [];
    state.projectiles = [];
    state.portals = [];
    state.stash = null;
    state.inTown = false;
    state.shop = null;
    state.trading = false;
    state.smithing = false;
    // The board's offers are town furniture; the charter (state.quests) is the
    // hero's own and outlives any floor.
    state.board = null;
    state.questing = false;
    state.boardOpen = false;
    state.flow = { field: null, t: 0 };
    const p = state.player;
    p.x = (dungeon.entry.x + 0.5) * TS;
    p.y = (dungeon.entry.y + 0.5) * TS;
    state.cam = { x: p.x, y: p.y };
    state.fade = { t: 0, dur: 1.6, label: `Floor ${state.floor} — ${dungeon.theme.name}` };
  }
  G.makeFloorState = makeFloorState;

  Game.newRun = function (seed, opts) {
    const player = Entities.newPlayer(opts);
    player.id = 'p0';
    player.dead = false;
    player.facing = 0;
    player.attackT = 0;
    player.swing = null;
    player.hurtT = 0;
    player.healPool = 0;
    player.healRate = 0;
    player.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
    player.dodgeT = 0;
    player.dodgeCdT = 0;
    player.dodgeDir = { x: 1, y: 0 };
    const state = {
      runSeed: seed >>> 0,
      floor: 1,
      nextId: 1,
      player,
      players: [player],
      bag: Items.createBag(),
      monsters: [],
      props: [],
      groundItems: [],
      particles: [],
      floatTexts: [],
      messages: [],
      kills: 0,
      time: 0,
      shake: 0,
      dead: false,
      deathT: 0,
      invOpen: false,
      treeOpen: false,
      hover: null,
      portals: [],
      portalCdT: 0,
      inTown: false,
      stash: null,
      shop: null,
      buyback: [],
      trading: false,
      smithing: false,
      board: null,
      quests: [],
      questing: false,
      boardOpen: false,
      milestones: [],
      events: [],
    };
    makeFloorState(state);
    G.message(state, 'The dungeon hungers. Descend. (WASD to move, SPACE to swing)');
    return state;
  };

  // Rebuild a live state from a Save.load() snapshot. The dungeon regenerates
  // deterministically from (runSeed, floor); the current floor restarts fresh.
  Game.fromSave = function (data) {
    const state = Game.newRun(data.runSeed);
    state.floor = Math.max(1, data.floor | 0);
    state.kills = data.kills || 0;
    state.time = data.time || 0;
    state.milestones = Array.isArray(data.milestones) ? data.milestones : [];
    state.quests = Quests.fromSave(data.quests);
    const p = state.player;
    const sp = data.player || {};
    p.id = 'p0';
    p.dead = false;
    p.name = sp.name || 'Wanderer';
    p.shirt = sp.shirt || '#4a5578';
    p.level = sp.level || 1;
    p.xp = sp.xp || 0;
    p.baseMaxHP = sp.baseMaxHP || 100;
    p.baseMaxMana = sp.baseMaxMana || 40;
    p.baseDamage = sp.baseDamage || 0;
    p.skillPoints = sp.skillPoints || 0;
    p.skills = sp.skills || {};
    if (sp.equip) {
      for (const key of Object.keys(p.equip)) {
        p.equip[key] = sp.equip[key] || null;
      }
      if (!p.equip.weapon) p.equip.weapon = Entities.starterWeapon();
    }
    if (data.bag && Array.isArray(data.bag.slots)) {
      state.bag.slots = Array.from({ length: Items.BAG_SIZE }, (_, i) => data.bag.slots[i] || null);
      state.bag.belt = Array.from({ length: Items.BELT_SIZE }, (_, i) => (data.bag.belt ? data.bag.belt[i] : null) || null);
      state.bag.gold = data.bag.gold || 0;
      const savedBox = data.bag.potions || {};
      for (const kind of ['health', 'mana']) {
        state.bag.potions[kind] = (Array.isArray(savedBox[kind]) ? savedBox[kind] : [])
          .filter(Boolean)
          .slice(0, Items.POTION_BOX_SIZE);
      }
      // Legacy saves kept potions in the grid — migrate them into the box
      // until its rows fill; any overflow stays in the grid and remains usable.
      for (let i = 0; i < state.bag.slots.length; i++) {
        const it = state.bag.slots[i];
        if (!it || it.slot !== 'potion') continue;
        const row = Items.potionRow(state.bag, it);
        if (row.length >= Items.POTION_BOX_SIZE) continue;
        row.push(it);
        state.bag.slots[i] = null;
      }
    }
    makeFloorState(state);
    const fullStats = Entities.effectiveStats(p);
    p.hp = Math.min(typeof sp.hp === 'number' ? sp.hp : fullStats.maxHP, fullStats.maxHP);
    p.mana = Math.min(typeof sp.mana === 'number' ? sp.mana : fullStats.maxMana, fullStats.maxMana);
    state.messages = [];
    G.message(state, `Welcome back, ${p.name} — Floor ${state.floor} awaits.`, '#c9b37e');
    return state;
  };
})();
