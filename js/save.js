// save.js — localStorage persistence: run snapshot, best-run records, prefs. Pure; node-testable
// via the injectable Save._storage. All storage access is failure-safe (private mode, quotas).
(function () {
  const Stats = typeof require === 'function' ? require('./stats.js') : window.Stats;
  const Save = {};

  Save.KEY = 'dungeon-browser.save.v1';
  Save.RECORDS_KEY = 'dungeon-browser.records.v1';
  Save.PREFS_KEY = 'dungeon-browser.prefs.v1';
  Save.STATS_KEY = 'dungeon-browser.stats.v1';

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
        // The run's tally sheet rides with the character; the lifetime total
        // lives under its own key and only absorbs this on death.
        stats: p.stats || null,
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

  // ---- Lifetime tally ----
  // Kept apart from the run save because it must survive Save.clear() on death —
  // that is precisely the moment the finished run is folded in.

  Save.lifetime = function () {
    try {
      return Stats.sanitize(JSON.parse(get(Save.STATS_KEY) || 'null'));
    } catch {
      return Stats.create();
    }
  };

  // Fold a finished run's sheet into the lifetime total. Called once per run, at
  // the death transition — calling it twice would double-count the run.
  Save.addLifetime = function (runStats) {
    const total = Stats.merge(Save.lifetime(), Stats.sanitize(runStats));
    set(Save.STATS_KEY, JSON.stringify(total));
    return total;
  };

  Save.clearLifetime = () => remove(Save.STATS_KEY);

  // Prefs is a single blob with more than one flag in it now, so writes have to
  // merge — a setter that stringifies its own field alone would drop the others.
  function prefs() {
    try {
      const d = JSON.parse(get(Save.PREFS_KEY) || 'null');
      return d && typeof d === 'object' ? d : {};
    } catch {
      return {};
    }
  }
  function setPref(key, value) {
    const d = prefs();
    d[key] = value;
    set(Save.PREFS_KEY, JSON.stringify(d));
  }

  Save.getMuted = () => !!prefs().muted;
  Save.setMuted = (muted) => setPref('muted', !!muted);

  // Music mutes separately from effects. Absent (a save from before music
  // existed) means "on" — new players should hear the score.
  Save.getMusicMuted = () => !!prefs().musicMuted;
  Save.setMusicMuted = (muted) => setPref('musicMuted', !!muted);

  if (typeof window !== 'undefined') window.Save = Save;
  if (typeof module !== 'undefined') module.exports = Save;
})();
