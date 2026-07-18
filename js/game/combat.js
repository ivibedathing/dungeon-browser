// game/combat.js — dealing damage: player attacks, projectiles, kills, loot drops,
// and the damaging/healing active skills.
(function () {
  const Skills = typeof window !== 'undefined' ? window.Skills : require('../skills.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const Props = typeof window !== 'undefined' ? window.Props : require('../props.js');
  const Balance = typeof window !== 'undefined' ? window.Balance : require('../balance.js');
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { DROPS } = G;

  // ---- Loot ----

  // Instanced loot: a kill rolls drops independently for every living player within
  // share range, each pile tagged with its owner's id (only that player sees/grabs it).
  // Solo — or any kill with a single player in range — rolls ONCE with a null owner
  // (the legacy shared path), so solo drop behavior is byte-identical (same srand usage).
  function dropLoot(state, m, killer = state.player) {
    const range = (Balance.coop && Balance.coop.shareRange) || 900;
    const r2 = range * range;
    let recipients = (state.players || []).filter((pl) => !pl.dead && !pl.down && U.dist2(pl.x, pl.y, m.x, m.y) <= r2);
    if (recipients.length === 0) recipients = [killer]; // the killer always earns a roll (also the no-players test path)
    const shared = recipients.length <= 1;
    for (const who of recipients) rollDropsFor(state, m, shared ? null : who.id);
  }
  Game.dropLoot = dropLoot; // exported for balance wiring tests and the future server

  // One player's roll off a fallen monster, tagged with `ownerId` (null = shared/solo).
  function rollDropsFor(state, m, ownerId) {
    const f = state.floor;
    const scatter = () => (state.srand() - 0.5) * 30;
    const push = (o) => state.groundItems.push({ id: state.nextId++, ownerId, ...o });
    if (m.boss) {
      // Bosses always shower loot: two magic-or-better items plus a fat gold pile.
      for (let i = 0; i < 2; i++) {
        const item = Items.makeItem(f, state.srand, { guaranteeMagic: true });
        push({ kind: 'item', item, x: m.x + scatter() * 1.6, y: m.y + scatter() * 1.6 });
      }
      const amount = Math.round(U.randInt(state.srand, 25, 45) * (1 + 0.3 * (f - 1)));
      push({ kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
      return;
    }
    const roll = state.srand();
    if (m.champion || roll < DROPS.item) {
      const item = Items.makeItem(f, state.srand, { guaranteeMagic: m.champion });
      push({ kind: 'item', item, x: m.x + scatter(), y: m.y + scatter() });
    } else if (roll < DROPS.item + DROPS.potion) {
      const item = Items.makePotion(f, state.srand, state.srand() < DROPS.manaShare ? 'mana' : 'health');
      push({ kind: 'item', item, x: m.x + scatter(), y: m.y + scatter() });
    } else if (roll < DROPS.item + DROPS.potion + DROPS.gold) {
      const amount = Math.round(U.randInt(state.srand, 4, 9) * (1 + 0.3 * (f - 1)));
      push({ kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
    }
    if (m.champion && state.srand() < DROPS.championGold) {
      const amount = Math.round(U.randInt(state.srand, 10, 20) * (1 + 0.3 * (f - 1)));
      push({ kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
    }
  }

  // ---- Breakable decorations ----

  // Palette for the shatter burst, keyed by prop type. Chests glint gold.
  const PROP_DEBRIS = {
    pot: '#9a7250', crate: '#a9824c', barrel: '#8a6a3e', table: '#7a5636',
    chair: '#7a5636', stand: '#8b8b93', chest: '#d8b24a',
  };

  function dropPropLoot(state, prop) {
    const scatter = () => (state.srand() - 0.5) * 22;
    for (const d of Props.rollLoot(prop.type, state.floor, state.srand)) {
      if (d.kind === 'gold') {
        state.groundItems.push({ id: state.nextId++, kind: 'gold', amount: d.amount, x: prop.x + scatter(), y: prop.y + scatter() });
      } else {
        state.groundItems.push({ id: state.nextId++, kind: 'item', item: d.item, x: prop.x + scatter(), y: prop.y + scatter() });
      }
    }
  }

  function breakProp(state, prop) {
    const i = state.props.indexOf(prop);
    if (i === -1) return; // already shattered this frame (e.g. a fireball's overlapping hits)
    state.props.splice(i, 1);
    const debris = PROP_DEBRIS[prop.type] || '#9a824c';
    G.burst(state, prop.x, prop.y, debris, Props.isChest(prop.type) ? 22 : 14, 130);
    G.sfx(state, 'smash');
    if (Props.isChest(prop.type)) {
      G.floatText(state, prop.x, prop.y - prop.size - 6, 'Chest!', '#ffd84d', 15);
      state.shake = Math.min(6, state.shake + 2);
    }
    dropPropLoot(state, prop);
  }

  // Chip a prop's hp; shatter it at zero. Cosmetic damage numbers stay off props
  // (they'd clutter the screen mid-swing) — the hit flash and debris read as feedback.
  function hitProp(state, prop, dmg) {
    prop.hp -= dmg;
    prop.hitT = 0.12;
    G.burst(state, prop.x, prop.y, PROP_DEBRIS[prop.type] || '#9a824c', 3, 70);
    if (prop.hp <= 0) breakProp(state, prop);
  }

  // `dmg` may be a number or a thunk; the thunk is called only on an actual hit, so
  // a whiffed swing never draws from the loot RNG and leaves monster drops untouched.
  const rollDmg = (dmg) => (typeof dmg === 'function' ? dmg() : dmg);

  // Props caught inside an explosion/whirl radius. Returns true if any was hit,
  // so callers can fold prop smashing into their existing "did I connect?" juice.
  G.damagePropsInRadius = function (state, x, y, radius, dmg) {
    let any = false;
    for (const prop of [...state.props]) {
      const reach = radius + prop.size;
      if (U.dist2(x, y, prop.x, prop.y) >= reach * reach) continue;
      if (!G.lineOfSight(state.dungeon.grid, x, y, prop.x, prop.y)) continue;
      hitProp(state, prop, rollDmg(dmg));
      any = true;
    }
    return any;
  };

  // Props swept by a melee arc (or the 360° whirl, as an arc of width 2π).
  G.damagePropsInArc = function (state, px, py, facing, arc, radius, dmg) {
    let any = false;
    for (const prop of [...state.props]) {
      const reach = radius + prop.size * 0.5;
      if (!U.pointInArc(prop.x, prop.y, px, py, facing, arc, reach)) continue;
      if (!G.lineOfSight(state.dungeon.grid, px, py, prop.x, prop.y)) continue;
      hitProp(state, prop, rollDmg(dmg));
      any = true;
    }
    return any;
  };

  G.hitProp = hitProp; // exported for the projectile sweep and tests

  // ---- Combat ----

  function hitMonster(state, m, dmg, stats, kbAngle, kbForce, killer) {
    m.hp -= dmg;
    m.hitT = 0.16;
    m.aggroed = true;
    if (kbForce) {
      const f = kbForce * (m.kbResist || 1);
      m.kbx += Math.cos(kbAngle) * f;
      m.kby += Math.sin(kbAngle) * f;
    }
    G.floatText(state, m.x, m.y - m.size - 6, `${dmg}`, '#ffe9b0', m.champion ? 16 : 14);
    G.burst(state, m.x, m.y, '#a3232e', 7, 110);
    if (m.hp <= 0) killMonster(state, m, stats, killer || state.player);
  }

  G.hitMonster = hitMonster; // exported for the skill paths and tests

  function rollDamage(state, stats) {
    return Math.max(1, Math.round(stats.damage * (0.85 + state.srand() * 0.3)));
  }

  function playerAttack(state, p = state.player) {
    const stats = Entities.effectiveStats(p);
    p.attackT = 1 / stats.speed;

    if (stats.kind === 'melee') {
      p.swing = { t: 0, dur: Math.min(0.24, 0.8 / stats.speed), facing: p.facing, radius: stats.radius, arc: stats.arc };
      G.sfx(state, 'swing');
      let hitAny = false;
      for (const m of [...state.monsters]) {
        const reach = stats.radius + m.size * 0.5;
        if (!U.pointInArc(m.x, m.y, p.x, p.y, p.facing, stats.arc, reach)) continue;
        if (!G.lineOfSight(state.dungeon.grid, p.x, p.y, m.x, m.y)) continue;
        hitAny = true;
        hitMonster(state, m, rollDamage(state, stats), stats, Math.atan2(m.y - p.y, m.x - p.x), stats.kb, p);
      }
      if (G.damagePropsInArc(state, p.x, p.y, p.facing, stats.arc, stats.radius, () => rollDamage(state, stats))) hitAny = true;
      if (hitAny) {
        state.shake = Math.min(6, state.shake + 2);
        G.sfx(state, 'hit');
      }
      return;
    }

    // Ranged: bows loose arrows, wands hurl exploding fireballs.
    p.swing = { t: 0, dur: 0.15, facing: p.facing, radius: 24, arc: 0.8, ranged: true };
    const a = p.facing;
    state.projectiles.push({
      id: state.nextId++,
      ownerId: p.id,
      x: p.x + Math.cos(a) * 14,
      y: p.y + Math.sin(a) * 14,
      vx: Math.cos(a) * stats.projSpeed,
      vy: Math.sin(a) * stats.projSpeed,
      dmg: rollDamage(state, stats),
      kind: stats.kind === 'wand' ? 'fireball' : 'arrow',
      aoe: stats.aoe,
      ttl: 1.8,
      angle: a,
    });
    G.sfx(state, stats.kind === 'wand' ? 'fireball' : 'bow');
  }
  G.playerAttack = playerAttack;

  // The projectile's owner (the hero who fired it) carries the kill credit and the
  // stats the blast is computed against — falling back to the local player if that
  // hero has since left the room.
  function projectileOwner(state, pr) {
    return state.players.find((pl) => pl.id === pr.ownerId) || state.player;
  }

  function explode(state, pr) {
    const owner = projectileOwner(state, pr);
    const stats = Entities.effectiveStats(owner);
    G.burst(state, pr.x, pr.y, '#ff9a3d', 18, 160);
    G.burst(state, pr.x, pr.y, '#ffd84d', 10, 100);
    state.shake = Math.min(6, state.shake + 1.5);
    G.sfx(state, 'explode');
    for (const m of [...state.monsters]) {
      const reach = pr.aoe + m.size;
      if (U.dist2(pr.x, pr.y, m.x, m.y) >= reach * reach) continue;
      if (!G.lineOfSight(state.dungeon.grid, pr.x, pr.y, m.x, m.y)) continue;
      hitMonster(state, m, pr.dmg, stats, Math.atan2(m.y - pr.y, m.x - pr.x), 140, owner);
    }
    G.damagePropsInRadius(state, pr.x, pr.y, pr.aoe, pr.dmg);
  }

  G.updateProjectiles = function updateProjectiles(state, dt) {
    for (const pr of [...state.projectiles]) {
      pr.ttl -= dt;
      let dead = pr.ttl <= 0;
      // Swept movement in ~8px steps so fast projectiles can't tunnel through walls.
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 8));
      for (let s = 0; s < steps && !dead; s++) {
        pr.x += (pr.vx * dt) / steps;
        pr.y += (pr.vy * dt) / steps;
        if (G.collides(state.dungeon.grid, pr.x, pr.y, 3)) {
          dead = true;
          if (pr.kind === 'fireball') explode(state, pr);
          else G.burst(state, pr.x, pr.y, '#9a9a9a', 4, 60);
          break;
        }
        for (const m of state.monsters) {
          const reach = m.size + 4;
          if (U.dist2(pr.x, pr.y, m.x, m.y) < reach * reach) {
            dead = true;
            if (pr.kind === 'fireball') {
              explode(state, pr);
            } else {
              const owner = projectileOwner(state, pr);
              hitMonster(state, m, pr.dmg, Entities.effectiveStats(owner), Math.atan2(pr.vy, pr.vx), 90, owner);
              G.sfx(state, 'hit');
            }
            break;
          }
        }
        // Arrows shatter a prop on contact; fireballs burst against it (the blast
        // then smashes it and anything else in radius via explode's prop pass).
        if (!dead) {
          for (const prop of state.props) {
            const reach = prop.size + 4;
            if (U.dist2(pr.x, pr.y, prop.x, prop.y) >= reach * reach) continue;
            dead = true;
            if (pr.kind === 'fireball') {
              explode(state, pr);
            } else {
              G.hitProp(state, prop, pr.dmg);
              G.sfx(state, 'hit');
            }
            break;
          }
        }
      }
      // Fireballs shed embers as they fly.
      if (!dead && pr.kind === 'fireball' && Math.random() < dt * 45) {
        state.particles.push({
          x: pr.x, y: pr.y,
          vx: -pr.vx * 0.05 + (Math.random() - 0.5) * 25,
          vy: -pr.vy * 0.05 + (Math.random() - 0.5) * 25,
          t: 0,
          life: 0.3,
          color: Math.random() < 0.5 ? '#ff9a3d' : '#ffd84d',
          size: 1.5 + Math.random() * 2,
        });
      }
      if (dead) state.projectiles.splice(state.projectiles.indexOf(pr), 1);
    }
  };

  // Grant a level-up's juice to `who` (positioned at them). Save/records stay guarded
  // on the local player — online skips saves, solo saves as before.
  function levelUpJuice(state, who, levels) {
    if (levels <= 0) return;
    G.floatText(state, who.x, who.y - 30, 'LEVEL UP!', '#ffd84d', 22);
    G.message(state, `${who === state.player ? 'You are' : who.name + ' is'} now level ${who.level}. (+14 Life, +2 Damage)`, '#ffd84d');
    G.burst(state, who.x, who.y, '#ffd84d', 26, 170);
    G.sfx(state, 'levelup');
    if (who === state.player) {
      if (typeof Save !== 'undefined') Save.updateRecords(state);
      G.save(state);
    }
  }
  G.levelUpJuice = levelUpJuice;

  function killMonster(state, m, stats, killer = state.player) {
    state.kills++;
    state.monsters.splice(state.monsters.indexOf(m), 1);
    G.questProgress(state, (q) => Quests.recordKill(q, m));
    state.events.push({ type: 'kill', monsterId: m.id, x: m.x, y: m.y, champion: !!m.champion, boss: !!m.boss });
    G.burst(state, m.x, m.y, '#7e1b24', 16, 140);
    G.sfx(state, 'kill');
    if (m.boss) {
      state.shake = 10;
      state.bossFight = false;
      G.message(state, `${m.name} has fallen! The way below is open.`, '#ffd84d');
    } else if (m.champion) {
      state.shake = 7;
      G.message(state, `${m.name} has been slain!`, '#ff9a3d');
    }
    // "You kill, you leech": lifePerKill heals the credited killer only.
    if (stats.lifePerKill > 0) {
      killer.hp = Math.min(Entities.effectiveStats(killer).maxHP, killer.hp + stats.lifePerKill);
    }
    // Weapon proficiency, unlike XP, is NOT shared: it goes to the hero who landed the
    // killing blow, for the kind of weapon that landed it (`stats` is the attacker's
    // own stat blob, so skill kills credit whatever they had equipped).
    awardProficiency(state, m, stats, killer);
    // XP goes to every living player within share range of the kill (Task 3). Solo:
    // the one player is always in range ⇒ identical to the old single-player grant.
    awardKillXP(state, m, killer);
    dropLoot(state, m, killer);
  }

  // Credits the killing weapon's kind. Silent by design — proficiency is a slow
  // background curve — except when the bonus crosses a whole percent, which is the
  // smallest change a player can actually read off the character sheet.
  function awardProficiency(state, m, stats, killer) {
    if (!killer || !stats || !stats.kind) return;
    const P = Balance.proficiency;
    if (!P) return;
    const before = Entities.profBonus(killer, stats.kind);
    Entities.gainProficiency(killer, stats.kind, (m.xp || 0) * P.xpPerKill);
    const after = Entities.profBonus(killer, stats.kind);
    if (Math.floor(after * 100) > Math.floor(before * 100)) {
      G.floatText(state, killer.x, killer.y - 34, `${stats.kind} +${Math.floor(after * 100)}%`, '#c9b37e', 13);
      if (killer === state.player) G.save(state);
    }
  }

  // Full XP (each hero's own xpMult) to every living player within Balance.coop.shareRange
  // of the fallen monster. Solo degrades to a single in-range grant.
  function awardKillXP(state, m, killer) {
    const range = (Balance.coop && Balance.coop.shareRange) || 900;
    const r2 = range * range;
    for (const pl of state.players) {
      if (pl.dead || pl.down) continue;
      if (pl !== killer && U.dist2(pl.x, pl.y, m.x, m.y) > r2) continue;
      const xp = Math.round(m.xp * Entities.effectiveStats(pl).xpMult);
      levelUpJuice(state, pl, Entities.gainXP(pl, xp));
    }
  }
  G.awardKillXP = awardKillXP;

  // ---- Active skills ----

  Game.castSkill = function (state, p, idx) {
    // Back-compat: legacy callers pass (state, idx) for the local player.
    if (typeof idx === 'undefined') { idx = p; p = state.player; }
    const id = Skills.ACTIVE_ORDER[idx];
    const rank = Skills.rank(p, id);
    if (rank <= 0) {
      G.message(state, 'You have not learned that skill. (K opens the skill tree)', '#9aa');
      G.sfx(state, 'error');
      return false;
    }
    if (p.skillCd[id] > 0) return false;
    const def = Skills.SKILLS[id];
    if ((p.mana || 0) < def.active.mana) {
      G.message(state, `Not enough mana for ${def.name}.`, '#7fa8ff');
      G.sfx(state, 'error');
      return false;
    }
    const stats = Entities.effectiveStats(p);
    p.mana -= def.active.mana;
    p.skillCd[id] = def.active.cd;

    if (id === 'whirlwind') {
      const reachBase = stats.radius * 1.15;
      p.swing = { t: 0, dur: 0.35, facing: p.facing, radius: reachBase, arc: Math.PI * 2, whirl: true };
      G.sfx(state, 'swing');
      let hitAny = false;
      for (const m of [...state.monsters]) {
        const reach = reachBase + m.size * 0.5;
        if (U.dist2(p.x, p.y, m.x, m.y) > reach * reach) continue;
        if (!G.lineOfSight(state.dungeon.grid, p.x, p.y, m.x, m.y)) continue;
        const dmg = Math.max(1, Math.round(stats.damage * (0.8 + 0.15 * rank) * (0.85 + state.srand() * 0.3)));
        hitAny = true;
        hitMonster(state, m, dmg, stats, Math.atan2(m.y - p.y, m.x - p.x), stats.kb * 1.2);
      }
      if (G.damagePropsInArc(state, p.x, p.y, p.facing, Math.PI * 2, reachBase, () => Math.max(1, Math.round(stats.damage * (0.8 + 0.15 * rank) * (0.85 + state.srand() * 0.3))))) hitAny = true;
      if (hitAny) {
        state.shake = Math.min(8, state.shake + 3);
        G.sfx(state, 'hit');
      }
    } else if (id === 'nova') {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        state.projectiles.push({
          id: state.nextId++,
          ownerId: p.id,
          x: p.x + Math.cos(a) * 12,
          y: p.y + Math.sin(a) * 12,
          vx: Math.cos(a) * 260,
          vy: Math.sin(a) * 260,
          dmg: Math.max(1, Math.round(stats.damage * (0.5 + 0.1 * rank) * stats.projMult)),
          kind: 'fireball',
          aoe: 45 + rank * 3,
          ttl: 1.2,
          angle: a,
        });
      }
      state.shake = Math.min(6, state.shake + 2);
      G.sfx(state, 'fireball');
    } else if (id === 'prayer') {
      const heal = stats.maxHP * (0.18 + 0.04 * rank);
      p.healPool += heal;
      p.healRate = heal / 0.8;
      G.burst(state, p.x, p.y, '#8fe89a', 22, 120);
      G.floatText(state, p.x, p.y - 30, 'Healing Prayer', '#8fe89a', 14);
      G.sfx(state, 'heal');
    }
    return true;
  };
})();
