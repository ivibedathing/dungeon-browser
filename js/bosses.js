// bosses.js — the main quest's spine: six acts, each ending in a named Act Boss,
// the last of them the final boss on floor 24. Pure and node-testable, in the
// same shape as quests.js; every stat multiplier lives in js/balance.js.
//
// Act-boss floors are a SUBSET of the existing `floor % 2 === 0` arena floors, so
// the dungeon generator needs no new placement logic. The arena floors an act
// does not claim (2, 6, 10, 14, 18, 22) keep the unnamed generic guardian.
(function () {
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;

  const Bosses = {};

  Bosses.ACT_SPAN = 4; // floors per act
  Bosses.FINAL_FLOOR = 24;

  // Each act: the floors it covers, the boss that closes it, and the flavor the
  // banner and the notice board read (Task 6). `behavior` and `phases` are handed
  // straight to the monster — see js/game/behaviors.js for what they mean.
  Bosses.ACTS = [
    {
      act: 1, title: 'The Crypts', from: 1, to: 4, bossFloor: 4,
      boss: {
        name: 'Gravemaw', epithet: 'the First Hunger', color: '#7d4a4a',
        behavior: 'slam',
        slamRange: 150, slamRadius: 88, slamWindup: 0.85, slamCd: 3.4, slamDmgMult: 1.15,
        phases: [
          { at: 0.5, slamCd: 2.4, slamWindup: 0.7, speedMult: 1.15, message: 'Gravemaw howls and quickens!' },
        ],
      },
      board: 'Something under the crypts is eating the dead before we can burn them.',
      done: 'The crypts are quiet since you put Gravemaw down.',
    },
    {
      act: 2, title: 'The Caverns', from: 5, to: 8, bossFloor: 8,
      boss: {
        name: 'The Hollow Choir', epithet: 'Many Voices', color: '#4a6a7d',
        behavior: 'summon',
        summonType: 'skeleton', summonCount: 2, summonCap: 6, summonCd: 7,
        phases: [
          { at: 0.6, summonCd: 5, summonCount: 3, onEnterSummon: { type: 'skeleton', count: 3, cap: 6 }, message: 'The Choir swells — more voices answer!' },
          { at: 0.3, behavior: 'slam', slamRange: 140, slamRadius: 80, slamWindup: 0.6, slamCd: 2.6, speedMult: 1.2, message: 'The Choir falls silent, and charges.' },
        ],
      },
      board: 'Grizzle says the singing in the caverns is not the wind.',
      done: 'The caverns have gone silent. Good.',
    },
    {
      act: 3, title: 'The Warrens', from: 9, to: 12, bossFloor: 12,
      boss: {
        name: 'The Warden of Ash', epithet: 'Keeper of the Third Gate', color: '#7d6a4a',
        behavior: 'caster',
        castRange: 420, castCd: 1.5, castSpeed: 280, keepAway: 210, castBurn: 5, castDmgMult: 0.8,
        phases: [
          { at: 0.66, castCd: 1.1, keepAway: 240, message: 'The Warden retreats and burns brighter!' },
          { at: 0.33, behavior: 'summon', summonType: 'wraith', summonCount: 2, summonCap: 4, summonCd: 6, onEnterSummon: { type: 'wraith', count: 2, cap: 4 }, message: 'The Warden calls the cold to its side.' },
        ],
      },
      board: 'They say the Warden keeps the third key, and never sleeps.',
      done: 'The Warden of Ash is ash. The way down is open.',
    },
    {
      act: 4, title: 'The Deep', from: 13, to: 16, bossFloor: 16,
      boss: {
        name: 'Thessaly Coldspine', epithet: 'the Drowned Lady', color: '#4a5a7d',
        behavior: 'slam',
        slamRange: 170, slamRadius: 100, slamWindup: 0.7, slamCd: 3, slamDmgMult: 1.1, slamStun: 0.5,
        phases: [
          { at: 0.66, behavior: 'caster', castRange: 420, castCd: 1.3, castSpeed: 300, keepAway: 200, message: 'Coldspine gives ground and starts to sing.' },
          { at: 0.33, behavior: 'slam', slamCd: 2.2, slamWindup: 0.55, speedMult: 1.25, onEnterSummon: { type: 'wraith', count: 3, cap: 5 }, message: 'Coldspine surges forward with the drowned at her back!' },
        ],
      },
      board: 'No one who walked past the sixteenth floor has walked back.',
      done: 'Coldspine is broken. The deep is a little less deep.',
    },
    {
      act: 5, title: 'The Under-Deep', from: 17, to: 20, bossFloor: 20,
      boss: {
        name: 'Vexis the Unmourned', epithet: 'Last of the Wardens', color: '#6a4a7d',
        behavior: 'summon',
        summonType: 'wraith', summonCount: 2, summonCap: 6, summonCd: 6,
        phases: [
          { at: 0.7, behavior: 'caster', castRange: 440, castCd: 1.2, castSpeed: 320, keepAway: 220, castBurn: 7, message: 'Vexis rises out of reach!' },
          { at: 0.4, behavior: 'slam', slamRange: 160, slamRadius: 95, slamWindup: 0.6, slamCd: 2.4, slamStun: 0.4, speedMult: 1.2, message: 'Vexis drops back down, furious.' },
          { at: 0.15, behavior: 'summon', summonCd: 3.5, summonCount: 3, summonCap: 8, speedMult: 1.35, onEnterSummon: { type: 'wraith', count: 3, cap: 8 }, message: 'Vexis empties the Under-Deep at you!' },
        ],
      },
      board: 'The last Warden waits at twenty. Grizzle will not say how he knows.',
      done: 'Vexis is unmourned indeed. One gate remains.',
    },
    {
      act: 6, title: 'The Sanctum', from: 21, to: 24, bossFloor: 24, final: true,
      boss: {
        name: 'Duromar', epithet: 'the Last Gate', color: '#8e3b3b',
        behavior: 'slam',
        slamRange: 180, slamRadius: 110, slamWindup: 0.75, slamCd: 2.8, slamDmgMult: 1.2, slamStun: 0.5,
        // The only four-phase ladder in the game, and the only boss that cycles
        // all three behaviors rather than introducing a fourth.
        phases: [
          { at: 0.8, behavior: 'summon', summonType: 'brute', summonCount: 2, summonCap: 4, summonCd: 8, onEnterSummon: { type: 'brute', count: 2, cap: 4 }, message: 'Duromar calls his guard.' },
          { at: 0.55, behavior: 'caster', castRange: 460, castCd: 1.1, castSpeed: 330, keepAway: 230, castBurn: 8, message: 'Duromar opens the gate, and it burns.' },
          { at: 0.3, behavior: 'slam', slamCd: 2, slamWindup: 0.55, speedMult: 1.3, onEnterSummon: { type: 'wraith', count: 3, cap: 6 }, message: 'Duromar comes down from the gate himself!' },
          { at: 0.12, behavior: 'slam', slamCd: 1.5, slamWindup: 0.45, slamRadius: 130, speedMult: 1.5, message: 'Duromar is dying — and will not go alone!' },
        ],
      },
      board: 'The Sanctum is the last of it. Whatever holds the gate, it is the end.',
      done: 'You closed the last gate. The dungeon has a bottom after all.',
    },
  ];

  Bosses.COUNT = Bosses.ACTS.length;

  // The per-character main-quest record. Lives here rather than in quests.js
  // because entities.js needs it in newPlayer and quests.js already requires
  // entities.js — this is the one module below both. Quests.newMain delegates.
  Bosses.newProgress = () => ({ act: 1, slain: [], complete: false });

  // The act a floor belongs to, or null past the end of the main quest. EVERY
  // caller must handle null: floors past 24 are still generated and still
  // playable, they simply have no act.
  Bosses.actForFloor = function (floor) {
    const f = floor | 0;
    return Bosses.ACTS.find((a) => f >= a.from && f <= a.to) || null;
  };

  Bosses.actByNumber = function (n) {
    return Bosses.ACTS.find((a) => a.act === (n | 0)) || null;
  };

  // The act-boss spec for a floor, or null — including on the arena floors an
  // act does not claim, which keep the generic guardian.
  Bosses.bossForFloor = function (floor) {
    const act = Bosses.actForFloor(floor);
    return act && act.bossFloor === (floor | 0) ? act.boss : null;
  };

  Bosses.isActBossFloor = (floor) => !!Bosses.bossForFloor(floor);
  Bosses.isFinalFloor = (floor) => (floor | 0) === Bosses.FINAL_FLOOR;

  // ---- Presentation derivations (pure; the renderers just print these) ----

  // What the floor-entry banner says, given the floor and the LOCAL hero's
  // progress. Acts announce themselves on their first floor; a boss floor names
  // the boss instead, because that is the more urgent fact. Null means "nothing
  // to add" and the caller keeps the plain floor label.
  Bosses.bannerFor = function (floor, mq) {
    const a = Bosses.actForFloor(floor);
    if (!a) return null; // past the main quest: no act, plain floor label
    if (a.bossFloor === (floor | 0)) {
      const slain = mq && Array.isArray(mq.slain) && mq.slain.includes(a.act);
      if (slain) return null; // already beaten; do not re-announce a cleared boss
      return a.final ? `${a.boss.name} — ${a.boss.epithet}` : `${a.boss.name} waits below`;
    }
    if (a.from === (floor | 0)) return `Act ${ROMAN[a.act]} — ${a.title}`;
    return null;
  };

  // The notice board's rotating line, reacting to how far the hero has got.
  Bosses.boardLineFor = function (mq) {
    if (!mq) return Bosses.ACTS[0].board;
    if (mq.complete) return Bosses.ACTS[Bosses.ACTS.length - 1].done;
    const a = Bosses.actByNumber(mq.act);
    if (!a) return Bosses.ACTS[0].board;
    // Lead with the last victory when one exists, then the current job.
    const prev = Bosses.actByNumber(a.act - 1);
    return prev ? `${prev.done} ${a.board}` : a.board;
  };

  const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' };
  Bosses.ROMAN = ROMAN;

  // Every act boss still standing, in order — the main quest's checklist.
  Bosses.allBossFloors = () => Bosses.ACTS.map((a) => a.bossFloor);

  if (typeof window !== 'undefined') window.Bosses = Bosses;
  if (typeof module !== 'undefined') module.exports = Bosses;
})();
