// skills.js — skill tree definitions, learning rules, and passive bonuses. Pure; node-testable.
(function () {
  const Skills = {};

  // Three branches, three tiers each. Tier 1 is an active skill with a fixed hotkey;
  // deeper tiers unlock once the previous skill in the branch has at least one rank.
  Skills.SKILLS = {
    whirlwind: {
      branch: 'war', tier: 1, name: 'Whirlwind', max: 5,
      active: { mana: 12, cd: 3, hotkey: 'F' },
      desc: (r) => `Spin in a deadly circle, striking every nearby enemy for ${Math.round((0.8 + 0.15 * Math.max(1, r)) * 100)}% weapon damage.`,
    },
    rage: {
      branch: 'war', tier: 2, name: 'Battle Rage', max: 5,
      desc: (r) => `+${8 * Math.max(1, r)}% damage.`,
    },
    tempo: {
      branch: 'war', tier: 3, name: 'Iron Tempo', max: 5,
      desc: (r) => `+${5 * Math.max(1, r)}% attack speed.`,
    },
    nova: {
      branch: 'sorcery', tier: 1, name: 'Fire Nova', max: 5,
      active: { mana: 18, cd: 5, hotkey: 'G' },
      desc: (r) => `Hurl twelve fireballs in a ring, each dealing ${Math.round((0.5 + 0.1 * Math.max(1, r)) * 100)}% weapon damage.`,
    },
    focus: {
      branch: 'sorcery', tier: 2, name: 'Arcane Focus', max: 5,
      desc: (r) => `+${12 * Math.max(1, r)} to mana, +${(0.5 * Math.max(1, r)).toFixed(1)} mana regeneration.`,
    },
    ember: {
      branch: 'sorcery', tier: 3, name: 'Ember Mastery', max: 5,
      desc: (r) => `+${10 * Math.max(1, r)}% projectile and fireball damage.`,
    },
    prayer: {
      branch: 'faith', tier: 1, name: 'Healing Prayer', max: 5,
      active: { mana: 15, cd: 8, hotkey: 'H' },
      desc: (r) => `Mend ${Math.round((0.18 + 0.04 * Math.max(1, r)) * 100)}% of your maximum life.`,
    },
    stoneskin: {
      branch: 'faith', tier: 2, name: 'Stone Skin', max: 5,
      desc: (r) => `+${2 * Math.max(1, r)} defense.`,
    },
    vigor: {
      branch: 'faith', tier: 3, name: 'Vigor', max: 5,
      desc: (r) => `+${14 * Math.max(1, r)} to life.`,
    },
  };

  Skills.ACTIVE_ORDER = ['whirlwind', 'nova', 'prayer'];
  Skills.BRANCHES = { war: 'The Art of War', sorcery: 'Sorcery', faith: 'Faith' };

  Skills.rank = (player, id) => (player.skills && player.skills[id]) || 0;

  Skills.prevInBranch = function (id) {
    const s = Skills.SKILLS[id];
    if (!s || s.tier === 1) return null;
    return Object.keys(Skills.SKILLS).find(
      (k) => Skills.SKILLS[k].branch === s.branch && Skills.SKILLS[k].tier === s.tier - 1
    );
  };

  Skills.canLearn = function (player, id) {
    const s = Skills.SKILLS[id];
    if (!s || (player.skillPoints || 0) <= 0) return false;
    if (Skills.rank(player, id) >= s.max) return false;
    const prev = Skills.prevInBranch(id);
    if (prev && Skills.rank(player, prev) < 1) return false;
    return true;
  };

  Skills.learn = function (player, id) {
    if (!Skills.canLearn(player, id)) return false;
    if (!player.skills) player.skills = {};
    player.skills[id] = Skills.rank(player, id) + 1;
    player.skillPoints--;
    return true;
  };

  // Aggregate passive bonuses; consumed by Entities.effectiveStats.
  Skills.passives = function (player) {
    const r = (id) => Skills.rank(player, id);
    return {
      dmgMult: 1 + 0.08 * r('rage'),
      speedMult: 1 + 0.05 * r('tempo'),
      defense: 2 * r('stoneskin'),
      maxHP: 14 * r('vigor'),
      maxMana: 12 * r('focus'),
      manaRegen: 0.5 * r('focus'),
      projMult: 1 + 0.1 * r('ember'),
    };
  };

  if (typeof window !== 'undefined') window.Skills = Skills;
  if (typeof module !== 'undefined') module.exports = Skills;
})();
