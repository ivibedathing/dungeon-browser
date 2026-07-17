// save.js — localStorage persistence: run snapshot, best-run records, prefs. Pure; node-testable
// via the injectable Save._storage. All storage access is failure-safe (private mode, quotas).
(function () {
  const Save = {};

  Save.KEY = 'dungeon-browser.save.v1';
  Save.RECORDS_KEY = 'dungeon-browser.records.v1';
  Save.PREFS_KEY = 'dungeon-browser.prefs.v1';

  Save._storage = typeof localStorage !== 'undefined' ? localStorage : null;

  function get(key) {
    try {
      return Save._storage ? Save._storage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function set(key, val) {
    try {
      if (Save._storage) Save._storage.setItem(key, val);
    } catch {
      /* storage denied or full — play on without persistence */
    }
  }
  function remove(key) {
    try {
      if (Save._storage) Save._storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  // Only durable progress is saved. The dungeon itself regenerates deterministically
  // from (runSeed, floor); monsters respawn on load — the floor restarts fresh.
  Save.snapshot = function (state) {
    const p = state.player;
    return {
      version: 1,
      runSeed: state.runSeed,
      floor: state.floor,
      kills: state.kills,
      time: state.time,
      milestones: state.milestones || [],
      quests: state.quests || [],
      player: {
        name: p.name,
        shirt: p.shirt,
        level: p.level,
        xp: p.xp,
        baseMaxHP: p.baseMaxHP,
        baseMaxMana: p.baseMaxMana,
        baseDamage: p.baseDamage,
        hp: p.hp,
        mana: p.mana,
        skillPoints: p.skillPoints,
        skills: p.skills,
        equip: p.equip,
      },
      bag: state.bag,
    };
  };

  Save.write = function (state) {
    try {
      set(Save.KEY, JSON.stringify(Save.snapshot(state)));
    } catch {
      /* unserializable state should never block the game */
    }
  };

  Save.load = function () {
    const raw = get(Save.KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && data.version === 1 ? data : null;
    } catch {
      return null;
    }
  };

  Save.clear = () => remove(Save.KEY);

  Save.records = function () {
    try {
      const d = JSON.parse(get(Save.RECORDS_KEY) || 'null');
      return {
        bestFloor: (d && d.bestFloor) || 0,
        bestLevel: (d && d.bestLevel) || 0,
      };
    } catch {
      return { bestFloor: 0, bestLevel: 0 };
    }
  };

  Save.updateRecords = function (state) {
    const r = Save.records();
    r.bestFloor = Math.max(r.bestFloor, state.floor || 0);
    r.bestLevel = Math.max(r.bestLevel, (state.player && state.player.level) || 0);
    set(Save.RECORDS_KEY, JSON.stringify(r));
    return r;
  };

  Save.getMuted = function () {
    try {
      const d = JSON.parse(get(Save.PREFS_KEY) || 'null');
      return !!(d && d.muted);
    } catch {
      return false;
    }
  };

  Save.setMuted = function (muted) {
    set(Save.PREFS_KEY, JSON.stringify({ muted: !!muted }));
  };

  if (typeof window !== 'undefined') window.Save = Save;
  if (typeof module !== 'undefined') module.exports = Save;
})();
