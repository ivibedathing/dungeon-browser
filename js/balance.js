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

  Balance.champion = { hp: 2.6, dmg: 1.5, xp: 3, size: 1.35, speed: 1.05 };

  Balance.boss = { hp: 8, dmg: 2, xp: 10, size: 2.1, speed: 0.95, aggro: 420, attackRange: 46, attackCd: 1.5, kbResist: 0.15 };

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
  // Monsters per room: base + rand(0..rand) + min(depthCap, floor(depthRate·(f−1))).
  Balance.spawns = { base: 2, rand: 2, depthRate: 0.7, depthCap: 4, championChance: 0.12 };

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
  Balance.upgrade = { dmgPerPlus: 0.08, maxPlus: 10 };

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
    delveDepth: [2, 3], // floors below the posting floor a delve asks for
    delveUnits: 12, // work units per floor descended
  };

  if (typeof window !== 'undefined') window.Balance = Balance;
  if (typeof module !== 'undefined') module.exports = Balance;
})();
