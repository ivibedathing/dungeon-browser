// game/combat.js — dealing damage: player attacks, projectiles, kills, loot drops,
// and the damaging/healing active skills.
(function () {
  const Skills = typeof window !== 'undefined' ? window.Skills : require('../skills.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const Props = typeof window !== 'undefined' ? window.Props : require('../props.js');
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { DROPS } = G;

  // ---- Loot ----

  function dropLoot(state, m) {
    const f = state.floor;
    const scatter = () => (state.srand() - 0.5) * 30;
    if (m.boss) {
      // Bosses always shower loot: two magic-or-better items plus a fat gold pile.
      for (let i = 0; i < 2; i++) {
        const item = Items.makeItem(f, state.srand, { guaranteeMagic: true });
        state.groundItems.push({ id: state.nextId++, kind: 'item', item, x: m.x + scatter() * 1.6, y: m.y + scatter() * 1.6 });
      }
      const amount = Math.round(U.randInt(state.srand, 25, 45) * (1 + 0.3 * (f - 1)));
      state.groundItems.push({ id: state.nextId++, kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
      return;
    }
    const roll = state.srand();
    if (m.champion || roll < DROPS.item) {
      const item = Items.makeItem(f, state.srand, { guaranteeMagic: m.champion });
      state.groundItems.push({ id: state.nextId++, kind: 'item', item, x: m.x + scatter(), y: m.y + scatter() });
    } else if (roll < DROPS.item + DROPS.potion) {
      const item = Items.makePotion(f, state.srand, state.srand() < DROPS.manaShare ? 'mana' : 'health');
      state.groundItems.push({ id: state.nextId++, kind: 'item', item, x: m.x + scatter(), y: m.y + scatter() });
    } else if (roll < DROPS.item + DROPS.potion + DROPS.gold) {
      const amount = Math.round(U.randInt(state.srand, 4, 9) * (1 + 0.3 * (f - 1)));
      state.groundItems.push({ id: state.nextId++, kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
    }
    if (m.champion && state.srand() < DROPS.championGold) {
      const amount = Math.round(U.randInt(state.srand, 10, 20) * (1 + 0.3 * (f - 1)));
      state.groundItems.push({ id: state.nextId++, kind: 'gold', amount, x: m.x + scatter(), y: m.y + scatter() });
    }
  }
  Game.dropLoot = dropLoot; // exported for balance wiring tests and the future server

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

  function hitMonster(state, m, dmg, stats, kbAngle, kbForce) {
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
    if (m.hp <= 0) killMonster(state, m, stats);
  }

  function rollDamage(state, stats) {
    return Math.max(1, Math.round(stats.damage * (0.85 + state.srand() * 0.3)));
  }

  function playerAttack(state) {
    const p = state.player;
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
        hitMonster(state, m, rollDamage(state, stats), stats, Math.atan2(m.y - p.y, m.x - p.x), stats.kb);
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

  function explode(state, pr) {
    const stats = Entities.effectiveStats(state.player);
    G.burst(state, pr.x, pr.y, '#ff9a3d', 18, 160);
    G.burst(state, pr.x, pr.y, '#ffd84d', 10, 100);
    state.shake = Math.min(6, state.shake + 1.5);
    G.sfx(state, 'explode');
    for (const m of [...state.monsters]) {
      const reach = pr.aoe + m.size;
      if (U.dist2(pr.x, pr.y, m.x, m.y) >= reach * reach) continue;
      if (!G.lineOfSight(state.dungeon.grid, pr.x, pr.y, m.x, m.y)) continue;
      hitMonster(state, m, pr.dmg, stats, Math.atan2(m.y - pr.y, m.x - pr.x), 140);
    }
    G.damagePropsInRadius(state, pr.x, pr.y, pr.aoe, pr.dmg);
  }

  G.updateProjectiles = function updateProjectiles(state, dt) {
    const p = state.player;
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
              hitMonster(state, m, pr.dmg, Entities.effectiveStats(p), Math.atan2(pr.vy, pr.vx), 90);
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

  function killMonster(state, m, stats) {
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
    if (stats.lifePerKill > 0) {
      state.player.hp = Math.min(Entities.effectiveStats(state.player).maxHP, state.player.hp + stats.lifePerKill);
    }
    const xp = Math.round(m.xp * stats.xpMult);
    const levels = Entities.gainXP(state.player, xp);
    if (levels > 0) {
      G.floatText(state, state.player.x, state.player.y - 30, 'LEVEL UP!', '#ffd84d', 22);
      G.message(state, `You are now level ${state.player.level}. (+14 Life, +2 Damage)`, '#ffd84d');
      G.burst(state, state.player.x, state.player.y, '#ffd84d', 26, 170);
      G.sfx(state, 'levelup');
      if (typeof Save !== 'undefined') Save.updateRecords(state);
      G.save(state);
    }
    dropLoot(state, m);
  }

  // ---- Active skills ----

  Game.castSkill = function (state, idx) {
    const id = Skills.ACTIVE_ORDER[idx];
    const p = state.player;
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
