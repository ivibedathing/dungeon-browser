// quests.js — the Ashfall Camp notice board: quest generation, progress, and
// rewards. Pure; node-testable. Every tuning knob lives in js/balance.js.
(function () {
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;
  const Entities = typeof require === 'function' ? require('./entities.js') : window.Entities;
  const Bosses = typeof require === 'function' ? require('./bosses.js') : window.Bosses;

  const Quests = {};
  const Q = Balance.quests;

  Quests.KINDS = ['hunt', 'champion', 'delve', 'main'];
  Quests.BOARD_SIZE = Q.boardSize;
  Quests.MAX_ACTIVE = Q.maxActive;

  // One notice per huntable monster type. The plural and the flavor line are all
  // the board needs to write the posting; the quarry's stats come from Balance.
  const HUNTS = {
    bat: { plural: 'bats', title: 'Cull the Swarm', line: 'They have been fouling the camp cistern.' },
    skeleton: { plural: 'skeletons', title: 'Bones to Dust', line: 'Old bones walk again. Put them down.' },
    zombie: { plural: 'zombies', title: 'The Restless Dead', line: 'The dead are wandering up toward the gate.' },
    brute: { plural: 'brutes', title: 'Break the Brutes', line: 'They smashed the last supply caravan.' },
    wraith: { plural: 'wraiths', title: 'Banish the Cold', line: 'Where they drift, the torches gutter out.' },
  };
  Quests.HUNTS = HUNTS;

  // Work units: one unit ≈ killing a floor-1 skeleton. Everything a notice can
  // ask for is priced in these, so rewards stay comparable across quest kinds.
  function workUnits(kind, target, need, floor) {
    if (kind === 'hunt') return need * (Entities.MONSTER_TYPES[target].xp / Q.huntXpBaseline);
    if (kind === 'champion') return need * Q.championUnits;
    return (need - floor) * Q.delveUnits;
  }

  function rewardFor(units, floor) {
    const scale = 1 + Q.rewardFloorRate * (floor - 1);
    return {
      gold: Math.max(1, Math.round(units * Q.goldPerUnit * scale)),
      xp: Math.max(1, Math.round(units * Q.xpPerUnit * scale)),
    };
  }
  Quests.rewardFor = rewardFor;

  // What a quest asks for, in one line — the board and the HUD both print this.
  Quests.progressText = (q) =>
    q.kind === 'delve' ? `Floor ${q.count} / ${q.need}`
      : q.kind === 'main' ? (q.count >= q.need ? 'Slain' : `Floor ${q.floor}`)
        : `${Math.min(q.count, q.need)} / ${q.need}`;

  Quests.isComplete = (q) => !!q && q.count >= q.need;

  // 0..1, for the board's progress bar. A delve's bar spans only the floors it
  // asked for, not the whole dungeon.
  Quests.fraction = function (q) {
    const span = q.kind === 'delve' ? q.need - q.floor : q.need;
    const done = q.kind === 'delve' ? q.count - q.floor : q.count;
    return span <= 0 ? 1 : Math.max(0, Math.min(1, done / span));
  };

  // Identity for "already taken" checks: the board must never post a bat hunt
  // while a bat hunt is on the charter, but a *fresh* bat hunt after turning the
  // old one in is fair game.
  Quests.key = (q) => (q.kind === 'hunt' ? `hunt:${q.target}` : q.kind === 'main' ? `main:${q.act}` : q.kind);

  Quests.makeQuest = function (kind, target, floor, rng) {
    const f = Math.max(1, floor | 0);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const id = `${kind}:${target || '-'}:${f}:${Math.floor(rng() * 1e9).toString(36)}`;

    if (kind === 'hunt') {
      const h = HUNTS[target];
      const need = pick(Q.huntCounts);
      return {
        id, kind, target, need, count: 0, floor: f,
        title: h.title,
        desc: `Slay ${need} ${h.plural}. ${h.line}`,
        reward: rewardFor(workUnits(kind, target, need, f), f),
      };
    }
    if (kind === 'champion') {
      const need = pick(Q.championCounts);
      return {
        id, kind, target: null, need, count: 0, floor: f,
        title: 'Bounty: Champions',
        desc: `Slay ${need} champion${need > 1 ? 's' : ''} — the named ones, ringed in orange.`,
        reward: rewardFor(workUnits(kind, target, need, f), f),
      };
    }
    // Delve: `need` is an absolute floor and `count` starts at the posting floor,
    // so progress reads "Floor 5 / 8" and a hero who is already deeper is done.
    const need = f + pick(Q.delveDepth);
    return {
      id, kind, target: null, need, count: f, floor: f,
      title: 'Into the Deep',
      desc: `Descend to floor ${need}. Grizzle wants to know what is down there.`,
      reward: rewardFor(workUnits(kind, target, need, f), f),
    };
  };

  // Pin a fresh set of notices. `exclude` holds the quests already on the
  // charter — the board never offers what you are already carrying.
  Quests.rollBoard = function (floor, rng, exclude) {
    const f = Math.max(1, floor | 0);
    const taken = new Set((exclude || []).map(Quests.key));
    const pool = [];
    for (const type of Object.keys(HUNTS)) {
      const base = Entities.MONSTER_TYPES[type];
      if (!base || base.minFloor > f) continue; // no bounty on what cannot spawn yet
      if (!taken.has(`hunt:${type}`)) pool.push({ kind: 'hunt', target: type });
    }
    if (!taken.has('champion') && f >= Q.championMinFloor) pool.push({ kind: 'champion', target: null });
    if (!taken.has('delve')) pool.push({ kind: 'delve', target: null });

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Q.boardSize).map((c) => Quests.makeQuest(c.kind, c.target, f, rng));
  };

  // ---- Progress ----
  // Each recorder returns true when it moved a quest forward, so the caller can
  // announce the change once.

  Quests.recordKill = function (q, monster) {
    if (!q || Quests.isComplete(q)) return false;
    if (q.kind === 'hunt') {
      if (!monster || monster.type !== q.target) return false;
    } else if (q.kind === 'champion') {
      if (!monster || !monster.champion) return false;
    } else {
      return false;
    }
    q.count++;
    return true;
  };

  Quests.recordDepth = function (q, floor) {
    if (!q || q.kind !== 'delve' || Quests.isComplete(q)) return false;
    if (floor <= q.count) return false;
    q.count = floor;
    return true;
  };

  // ---- The main quest ----
  // Six acts, each closed by killing that act's boss. This is NOT one of the
  // three charter slots: it lives at player.mainQuest, is per-character, and
  // dies with the character (death clears the save — a pure roguelike run).
  //
  // The record is deliberately tiny — an act counter and the acts already
  // slain — and the displayable quest is derived from Bosses.ACTS rather than
  // stored, so content edits never need a save migration.

  Quests.newMain = () => Bosses.newProgress();

  // The current act as a quest object the HUD can render exactly like a notice.
  // Null once the whole thing is done — every caller must handle that.
  Quests.mainQuest = function (mq) {
    if (!mq || mq.complete) return null;
    const a = Bosses.actByNumber(mq.act);
    if (!a) return null;
    const units = Q.mainUnitsPerAct * a.act;
    return {
      id: `main:${a.act}`,
      kind: 'main',
      act: a.act,
      target: null,
      need: 1,
      count: 0,
      floor: a.bossFloor,
      title: `Act ${ROMAN[a.act]} — ${a.title}`,
      desc: `Descend to floor ${a.bossFloor} and slay ${a.boss.name}, ${a.boss.epithet}. ${a.board}`,
      reward: rewardFor(units, a.bossFloor),
    };
  };

  const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' };
  Quests.ROMAN = ROMAN;

  // Credit an act-boss kill. Only the boss of the act the hero is CURRENTLY on
  // counts: killing a deeper act's boss early is not a shortcut, and replaying a
  // floor already cleared pays nothing.
  Quests.recordBossKill = function (mq, monster, floor) {
    if (!mq || mq.complete) return false;
    if (!monster || !monster.boss || !monster.actBoss) return false;
    const a = Bosses.actByNumber(mq.act);
    if (!a || monster.actBoss !== a.act) return false;
    if (floor !== undefined && floor !== a.bossFloor) return false;
    if (mq.slain.includes(a.act)) return false;
    mq.slain.push(a.act);
    if (a.act >= Bosses.COUNT) mq.complete = true;
    else mq.act = a.act + 1;
    return true;
  };

  // A character predating the main quest, or one with a corrupt record, starts a
  // fresh act I rather than failing to load.
  Quests.mainFromSave = function (v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return Quests.newMain();
    const slain = Array.isArray(v.slain)
      ? v.slain.filter((n) => Number.isInteger(n) && n >= 1 && n <= Bosses.COUNT)
      : [];
    let act = Number.isInteger(v.act) ? v.act : 1;
    act = Math.max(1, Math.min(Bosses.COUNT, act));
    return { act, slain, complete: !!v.complete };
  };

  // Saves round-trip quests as plain data. Drop anything unrecognizable rather
  // than letting one corrupt entry break the board.
  Quests.fromSave = function (list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((q) => q && Quests.KINDS.includes(q.kind) && typeof q.need === 'number' && q.reward)
      .slice(0, Q.maxActive)
      .map((q) => ({ ...q, count: q.count || 0 }));
  };

  if (typeof window !== 'undefined') window.Quests = Quests;
  if (typeof module !== 'undefined') module.exports = Quests;
})();
