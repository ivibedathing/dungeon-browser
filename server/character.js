// server/character.js — translate between stored character blobs (the Save.snapshot
// shape) and live room players. One place owns that mapping so createChar, join, and
// the save triggers can't drift on what a character's fields are.
'use strict';

require('./sim.js'); // ensures Entities/Items globals are loaded in node
const Schema = require('./schema.js');

// A brand-new character: a starter hero, empty bag, floor 1. Mirrors what
// Save.snapshot(Game.newRun(...)) would produce, without spinning a whole run.
function starterBlob(name, shirt) {
  const p = Entities.newPlayer({ name, shirt });
  return {
    version: 1,
    runSeed: 1, // replaced by the room's seed on join; only meaningful for a solo resume
    floor: 1,
    kills: 0,
    time: 0,
    milestones: [],
    quests: [],
    player: {
      name: p.name,
      shirt: p.shirt,
      level: 1,
      xp: 0,
      baseMaxHP: p.baseMaxHP,
      baseMaxMana: p.baseMaxMana,
      baseDamage: 0,
      hp: p.hp,
      mana: p.mana,
      mainQuest: Quests.newMain(),
      skillPoints: 0,
      skills: {},
      equip: p.equip,
      stats: Stats.create(),
    },
    bag: Items.createBag(),
  };
}

// Build a live room player from a stored blob. Overlays the character's progression
// (level/xp/base stats/equip/skills) onto a fresh player carrying the runtime timers
// the sim expects — the same shape Room.freshPlayer produces, so the sim can't tell
// a loaded hero from a new one apart from its stats. Mirrors Game.fromSave's restore.
function playerFromCharacter(blob, id) {
  // Defensive load: sanitize/clamp the blob (drop injected stats, junk items, unknown
  // skills). A structurally broken blob becomes a fresh starter rather than a crash or
  // a partially-trusted character. A legitimate blob passes through unchanged.
  const v = Schema.validateCharacter(blob);
  const clean = v.ok ? v.sanitized : Schema.validateCharacter(starterBlob('Wanderer')).sanitized;
  const sp = clean.player;
  const p = Entities.newPlayer({ name: sp.name, shirt: sp.shirt });
  p.id = id;
  p.dead = false;
  p.facing = 0;
  p.attackT = 0;
  p.swing = null;
  p.hurtT = 0;
  p.healPool = 0;
  p.healRate = 0;
  p.mainQuest = Quests.mainFromSave(sp.mainQuest);
  p.skillCd = { whirlwind: 0, nova: 0, prayer: 0 };
  p.dodgeT = 0;
  p.dodgeCdT = 0;
  p.dodgeDir = { x: 1, y: 0 };

  p.level = sp.level || 1;
  p.xp = sp.xp || 0;
  p.baseMaxHP = sp.baseMaxHP || 100;
  p.baseMaxMana = sp.baseMaxMana || 40;
  p.baseDamage = sp.baseDamage || 0;
  p.skillPoints = sp.skillPoints || 0;
  p.skills = sp.skills || {};
  p.stats = Stats.sanitize(sp.stats);
  if (sp.equip) {
    for (const key of Object.keys(p.equip)) p.equip[key] = sp.equip[key] || null;
    if (!p.equip.weapon) p.equip.weapon = Entities.starterWeapon();
  }
  const stats = Entities.effectiveStats(p);
  p.hp = Math.min(typeof sp.hp === 'number' ? sp.hp : stats.maxHP, stats.maxHP);
  p.mana = Math.min(typeof sp.mana === 'number' ? sp.mana : stats.maxMana, stats.maxMana);
  // Per-player bag (Phase 4): each seat carries its own sanitized bag. The save path
  // persists p.bag directly, so co-op no longer needs the host/frozen-bag split.
  p.bag = clean.bag;
  return p;
}

// The inverse: a persistable blob from a live room state + one of its players.
// `bag` is passed explicitly because a room's bag is shared in Phase 3 (the host's),
// so the save path decides which bag belongs to which character (see server saves).
function characterBlob(state, player, bag) {
  const p = player;
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
      mainQuest: p.mainQuest || Quests.newMain(),
      stats: p.stats || Stats.create(),
    },
    bag: bag || state.bag,
  };
}

module.exports = { starterBlob, playerFromCharacter, characterBlob };
