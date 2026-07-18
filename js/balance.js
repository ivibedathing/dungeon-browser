// balance.js — every tuning knob in one place. This file IS the balance sheet:
// modules read from it, tests pin their wiring against it, and
// `node tool/balance-report.mjs > BALANCE.md` renders it as human-readable tables.
(function () {
  const Balance = {};

  // ---- The hero ----
  Balance.player = {
    baseHP: 100,
    baseMana: 40,
    hpPerLevel: 12,
    manaPerLevel: 6,
    dmgPerLevel: 2,
    skillPointsPerLevel: 1,
    moveSpeed: 170,
    manaRegenBase: 2.5,
  };

  // XP to reach the next level: round(base * level^exponent).
  Balance.xpCurve = { base: 100, exponent: 1.62 };

  // ---- Monsters: base stats at floor 1 ----
  // speed px/s · aggro/attackRange px · attackCd s · weight = spawn-pool share.
  Balance.monsters = {
    zombie: { hp: 38, dmg: 8, speed: 55, xp: 14, minFloor: 1, weight: 26, size: 13, color: '#7a9e5a', aggro: 265, attackRange: 30, attackCd: 1.1 },
    skeleton: { hp: 27, dmg: 7, speed: 78, xp: 12, minFloor: 1, weight: 30, size: 12, color: '#cdd4d4', aggro: 300, attackRange: 30, attackCd: 0.9 },
    bat: { hp: 15, dmg: 5, speed: 108, xp: 9, minFloor: 1, weight: 22, size: 9, color: '#9a7ab8', aggro: 345, attackRange: 24, attackCd: 0.7 },
    brute: { hp: 68, dmg: 15, speed: 48, xp: 26, minFloor: 1, weight: 12, size: 16, color: '#b5624d', aggro: 255, attackRange: 34, attackCd: 1.4 },
    wraith: { hp: 24, dmg: 11, speed: 95, xp: 20, minFloor: 3, weight: 18, size: 12, color: '#8fd0e8', aggro: 370, attackRange: 28, attackCd: 0.8 },
    // ---- Melee variants (Phase 3): all reuse the chase-and-lunge AI ----
    // Ghoul: a tankier, meaner zombie that shows up a floor or two down.
    ghoul: { hp: 56, dmg: 11, speed: 62, xp: 21, minFloor: 2, weight: 16, size: 14, color: '#6f8f74', aggro: 275, attackRange: 30, attackCd: 1.2 },
    // Hound: fast quadruped that hunts in loose packs and snaps quickly.
    hound: { hp: 22, dmg: 8, speed: 132, xp: 13, minFloor: 2, weight: 18, size: 10, color: '#9a6b48', aggro: 340, attackRange: 26, attackCd: 0.8 },
    // Spider: skittering ambusher — low HP, fast, quick bite.
    spider: { hp: 17, dmg: 7, speed: 118, xp: 11, minFloor: 3, weight: 15, size: 9, color: '#5a4a6a', aggro: 330, attackRange: 24, attackCd: 0.7 },
    // Armored skeleton: a slow, heavily-plated line-holder with real HP.
    skeleton_knight: { hp: 64, dmg: 13, speed: 54, xp: 26, minFloor: 4, weight: 12, size: 13, color: '#b8c2cf', aggro: 260, attackRange: 32, attackCd: 1.3 },
    // Ogre: a bigger, deadlier brute for the deeper floors.
    ogre: { hp: 118, dmg: 23, speed: 44, xp: 42, minFloor: 5, weight: 8, size: 20, color: '#8a7a4d', aggro: 250, attackRange: 38, attackCd: 1.6 },
    // ---- Behavior archetypes (Phase 4): non-melee AI + hostile projectiles ----
    // `behavior` selects the AI branch; `attackCd` is that behavior's action cooldown.
    // Ranged caster: kites and lobs a magic bolt after a short, dodgeable cast.
    cultist: { hp: 26, dmg: 10, speed: 70, xp: 22, minFloor: 4, weight: 14, size: 11, color: '#b57edc', aggro: 380, attackRange: 30, attackCd: 2.0, behavior: 'ranged' },
    // Exploder: rushes in, lights a fuse on contact, and detonates in an AoE.
    bomber: { hp: 30, dmg: 24, speed: 92, xp: 18, minFloor: 5, weight: 12, size: 12, color: '#d98b3f', aggro: 360, attackRange: 30, attackCd: 1.0, behavior: 'exploder' },
    // Charger: winds up, then dashes in a straight line for heavy contact damage.
    gargoyle: { hp: 46, dmg: 18, speed: 60, xp: 26, minFloor: 6, weight: 12, size: 13, color: '#8a8f98', aggro: 340, attackRange: 30, attackCd: 3.0, behavior: 'charger' },
    // Summoner: hangs back and raises weak skeletal minions up to a cap.
    necromancer: { hp: 40, dmg: 8, speed: 66, xp: 30, minFloor: 6, weight: 10, size: 12, color: '#6f8f6f', aggro: 360, attackRange: 30, attackCd: 5.0, behavior: 'summoner' },
    // Swarmling: never in the random pool (weight 0) — only ambush swarms spawn it.
    // Frail and cheap, but faster than anything else and hits quick, so a pack
    // that reaches you drains HP in a hurry. Huge aggro: it commits on sight.
    swarmling: { hp: 8, dmg: 4, speed: 165, xp: 4, minFloor: 2, weight: 0, size: 7, color: '#d76b3f', aggro: 1400, attackRange: 20, attackCd: 0.55 },
  };

  // Per-floor scaling: hp ×(1 + hpLin·(f−1) + hpQuad·(f−1)²), dmg ×(1 + dmgLin·(f−1)),
  // xp ×(1 + xpLin·(f−1)).
  //
  // Depth difficulty rides on DAMAGE, not HP. The player's own damage grows
  // roughly linearly (weapon ×(1 + 0.22·(f−1)), +2 base/level, skill mults capped
  // at ×1.4), so an HP curve steeper than that only stretches time-to-kill — deep
  // floors read as tedious rather than dangerous. hpQuad stays small so depth
  // still compounds a little without outrunning the player's clear rate; dmgLin
  // carries the threat, outpacing the armor curve (×(1 + 0.18·(f−1))) so defense
  // softens hits at depth without neutralizing them.
  Balance.scaling = { hpLin: 0.3, hpQuad: 0.006, dmgLin: 0.42, xpLin: 0.22 };

  // ---- Behavior tuning (Phase 4) ----
  // Telegraph windows are deliberately generous so every special is dodgeable. All
  // ranges/speeds are px or px/s; times are seconds. `tel` (0..1 telegraph charge) is
  // derived from these and rendered as a wind-up cue in solo and co-op alike.
  Balance.behaviors = {
    ranged: { fireRange: 340, castTime: 0.45, boltSpeed: 300, kiteRange: 150 },
    exploder: { fuseTime: 0.7, blastRadius: 74, blastKb: 220 },
    charger: { windupTime: 0.5, dashTime: 0.26, dashSpeed: 540, triggerRange: 240, minRange: 60 },
    summoner: { castTime: 0.6, cap: 4, minionsPerCast: 2, minionType: 'skeleton', kiteRange: 170 },
  };

  Balance.champion = { hp: 2.6, dmg: 1.5, xp: 3, size: 1.35, speed: 1.05 };

  // The unnamed guardian on arena floors no act claims (2, 6, 10, 14, 18, 22).
  Balance.boss = { hp: 8, dmg: 2, xp: 10, size: 2.1, speed: 0.95, aggro: 420, attackRange: 46, attackCd: 1.5, kbResist: 0.15 };

  // Named act bosses, indexed by act (1-6). HP sits just above the generic
  // guardian's ×8 — an act boss must be the hardest thing on its own floor — but
  // the *escalation* across acts is deliberately carried by damage and mechanics
  // (telegraphs, phase ladders, adds) rather than by hp. A boss with triple hp
  // and one wind-up attack is a boss you dodge correctly for four minutes, which
  // reads as tedium rather than threat. Same reasoning as the hpQuad/dmgLin
  // split in Balance.scaling: depth rides on damage, not on time-to-kill.
  Balance.actBoss = {
    1: { hp: 8.2, dmg: 2.1, xp: 14, size: 2.0 },
    2: { hp: 8.4, dmg: 2.2, xp: 16, size: 2.05 },
    3: { hp: 8.6, dmg: 2.3, xp: 18, size: 2.1 },
    4: { hp: 8.8, dmg: 2.4, xp: 20, size: 2.15 },
    5: { hp: 9.2, dmg: 2.5, xp: 24, size: 2.2 },
    6: { hp: 11.0, dmg: 2.7, xp: 40, size: 2.5 }, // the final boss earns its sponge
  };

  // ---- Loot luck ----
  // Per kill: gold / potion / item are exclusive rolls in that order; the rest drop nothing.
  Balance.drops = {
    gold: 0.3,
    potion: 0.18,
    item: 0.12,
    manaShare: 0.3, // share of potion drops that are mana potions
    championGold: 0.8, // champions' extra gold pile chance (plus their guaranteed item)
  };

  // Rarity weights (relative). Champions and bosses never roll common.
  Balance.rarity = { common: 66, magic: 24, rare: 8, unique: 2 };

  // ---- Dungeon population ----
  // Monsters per room: base + rand(0..rand) + min(depthCap, floor(depthRate·(f−1)))
  // + min(roomCap, floor(roomRate·roomDepth)), where roomDepth is how many rooms deep
  // the chamber sits along the route in. The last term makes one floor escalate as you
  // push toward the stairs instead of being uniformly dangerous everywhere.
  Balance.spawns = { base: 2, rand: 2, depthRate: 0.7, depthCap: 4, roomRate: 0.25, roomCap: 3, championChance: 0.12 };

  // ---- Breakable decorations (furniture, pots, barrels, chests) ----
  // Smashable clutter that dresses rooms and coughs up minor loot. Non-blocking:
  // they never touch collision or pathing. Each non-entry room gets rand(min..max)
  // props; `chestChance` rolls a rarer treasure chest on top. Per break, gold /
  // item / potion are INDEPENDENT rolls (a chest can yield several at once), and
  // gold scales with floor like monster gold: amount ×(1 + goldFloorScale·(f−1)).
  Balance.props = {
    perRoom: { min: 1, max: 4 },
    chestChance: 0.14,
    goldFloorScale: 0.3,
    // hp = damage to shatter · size = draw radius (px) · weight = spawn-pool share
    // (0 = never rolled by pickType; placed only by chestChance) · gold = pre-scale
    // range · *Chance = independent per-break drop odds · guaranteeMagic excludes
    // common when an item drops.
    types: {
      pot: { hp: 4, size: 9, weight: 26, minFloor: 1, gold: [2, 6], goldChance: 0.3, itemChance: 0.02, potionChance: 0.05 },
      crate: { hp: 10, size: 12, weight: 20, minFloor: 1, gold: [3, 8], goldChance: 0.34, itemChance: 0.05, potionChance: 0.05 },
      barrel: { hp: 10, size: 11, weight: 20, minFloor: 1, gold: [3, 8], goldChance: 0.34, itemChance: 0.05, potionChance: 0.06 },
      table: { hp: 12, size: 14, weight: 14, minFloor: 1, gold: [2, 5], goldChance: 0.2, itemChance: 0.04, potionChance: 0.03 },
      chair: { hp: 6, size: 10, weight: 12, minFloor: 1, gold: [1, 4], goldChance: 0.12, itemChance: 0.02, potionChance: 0.02 },
      stand: { hp: 12, size: 12, weight: 8, minFloor: 2, gold: [2, 6], goldChance: 0.18, itemChance: 0.14, potionChance: 0.02 },
      chest: { hp: 20, size: 13, weight: 0, minFloor: 1, gold: [8, 18], goldChance: 1, itemChance: 0.85, potionChance: 0.3, guaranteeMagic: true, chest: true },
    },
  };

  // ---- Ambush swarms ----
  // From minFloor on, some rooms hide a swarm: step past the trigger radius and a
  // pack of swarmlings bursts in from the room's edges and sprints at you. Pack
  // size grows a little each floor (packRate per floor, capped by packCap).
  Balance.swarm = {
    minFloor: 2,
    roomChance: 0.32, // chance an eligible (non-entry, non-boss) room is an ambush
    maxRooms: 2, // at most this many ambush rooms per floor
    packBase: 6, // swarmlings at minFloor
    packRand: 3, // + rand(0..packRand)
    packRate: 0.8, // + floor(packRate·(f−minFloor)) more per deeper floor
    packCap: 18, // hard ceiling on a single pack
    triggerTiles: 3.4, // player within this many tiles of the room center springs it
    ringMinTiles: 3.6, // pack spawns in a ring this far from center (just clear of the hero)…
    ringMaxTiles: 7, // …out to here — close enough to rush in together on any room size
    minRoomTiles: 30, // rooms smaller than this (w·h interior) never host a swarm
  };

  // ---- Co-op (party) rules ----
  // Every co-op rule degrades to solo behavior at n=1 (all multipliers = 1). Monster
  // HP/XP scale with party size; loot instances one roll per in-range player; downed
  // players revive within a radius or respawn; descent is a shared countdown.
  Balance.coop = {
    partyMax: 4,
    hpPerPlayer: 0.5, // monster maxHP ×(1 + hpPerPlayer·(n−1))
    xpPerPlayer: 0.35, // monster xp    ×(1 + xpPerPlayer·(n−1)); paid to each in-range member
    shareRange: 900, // XP + loot reach every living player within this world-unit radius (≈ AOI)
    reviveRadius: 44, // a living ally this close revives a downed player…
    reviveTime: 1.6, // …after holding proximity this long (seconds)
    respawnTime: 10, // a ghost left alone this long respawns at the floor entry
    respawnHpFrac: 0.5, // revived/respawned players return with this fraction of maxHP
    descendCountdown: 10, // seconds standing on the stairs before the party descends
  };

  // ---- Blacksmith ----
  Balance.upgrade = { dmgPerPlus: 0.08, defPerPlus: 0.08, maxPlus: 10 };

  // ---- Weapon proficiency ----
  // Kill things with a weapon class and you get better with it. Proficiency XP is
  // credited to the KILLING BLOW's weapon kind only (melee/bow/wand) and is worth
  // `xpPerKill` × the monster's own XP — so it inherits floor/champion/boss scaling
  // for free, and plinking at a tanky monster earns nothing until it dies.
  //
  // Bonus is a damage multiplier: dmg ×(1 + min(maxBonus, k·log2(1 + xp/scale))).
  // Logarithmic on purpose — the first hundred kills feel good, then it flattens hard
  // on its own, and `maxBonus` is the hard guarantee that mastery stays a garnish
  // rather than a second power curve. For scale: the cap is worth about 7 hero levels
  // of baseDamage, and costs ~90k proficiency XP (thousands of kills) to reach.
  Balance.proficiency = {
    kinds: ['melee', 'bow', 'wand'],
    xpPerKill: 1, // proficiency XP = xpPerKill × monster xp
    k: 0.02, // curve steepness (bonus per doubling past `scale`)
    scale: 500, // XP where the curve starts to bite
    maxBonus: 0.15, // hard ceiling: +15% weapon damage, never more
  };

  // ---- Quest board ----
  // Rewards are priced in "work units", where one unit ≈ killing a floor-1
  // skeleton: reward = units × perUnit × (1 + rewardFloorRate·(postedFloor−1)).
  // A hunt's units scale with the quarry's base XP, so brutes pay more than bats.
  Balance.quests = {
    boardSize: 3, // notices pinned to the board at once
    maxActive: 3, // quests the charter can hold
    goldPerUnit: 7,
    xpPerUnit: 6,
    rewardFloorRate: 0.35,
    huntCounts: [8, 10, 12], // "slay N of a kind"
    huntXpBaseline: 12, // base XP that defines one work unit (a skeleton)
    championCounts: [2, 3],
    championUnits: 8, // work units per champion head
    championMinFloor: 2,
    mainUnitsPerAct: 60, // main-quest payout per act, in the same work units
    delveDepth: [2, 3], // floors below the posting floor a delve asks for
    delveUnits: 12, // work units per floor descended
  };

  if (typeof window !== 'undefined') window.Balance = Balance;
  if (typeof module !== 'undefined') module.exports = Balance;
})();
