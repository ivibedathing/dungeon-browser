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
  };

  // Per-floor scaling: hp ×(1 + hpLin·(f−1) + hpQuad·(f−1)²), dmg ×(1 + dmgLin·(f−1)),
  // xp ×(1 + xpLin·(f−1)).
  Balance.scaling = { hpLin: 0.38, hpQuad: 0.035, dmgLin: 0.28, xpLin: 0.22 };

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
