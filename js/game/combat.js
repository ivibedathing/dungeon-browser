// game/combat.js — dealing damage: player attacks, projectiles, kills, loot drops,
// and the damaging/healing active skills.
(function () {
  const Skills = typeof window !== 'undefined' ? window.Skills : require('../skills.js');
  const Quests = typeof window !== 'undefined' ? window.Quests : require('../quests.js');
  const Props = typeof window !== 'undefined' ? window.Props : require('../props.js');
  const Balance = typeof window !== 'undefined' ? window.Balance : require('../balance.js');
  const Bosses = typeof window !== 'undefined' ? window.Bosses : require('../bosses.js');
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  const { DROPS, PLAYER_R } = G;

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
    // Damage dealt is credited to whoever swung; monster-on-monster splash has no
    // killer, and Stats.bump no-ops on a missing owner.
    Stats.bump(killer, 'dealt', Math.min(dmg, Math.max(0, m.hp)));
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
    if (m.hp <= 0) {
      killMonster(state, m, stats, killer || state.player);
      return;
    }
    // Phase transitions are evaluated HERE, at the one place HP ever drops, and
    // not in the AI tick. A burst that crosses two thresholds in a single frame
    // must fire both; an AI-tick check would only ever see the final HP and
    // silently skip the phases in between.
    if (m.phases) G.advancePhases(state, m);
  }
  G.hitMonster = hitMonster; // exported for thorns reflection (and Phase 4 behaviors)

  // The single "a monster hurts a player" path, shared by melee lunges (ai.js),
  // hostile projectiles, and exploder blasts. `rawDmgOrFn` may be a thunk so a
  // random damage roll only fires when the hit actually lands (dodge short-circuits
  // it, preserving the RNG stream for the existing melee path). Pass opts.attacker
  // (the monster) to enable thorns retaliation; ranged/blast sources omit it.
  function hurtPlayer(state, p, rawDmgOrFn, opts) {
    opts = opts || {};
    if (p.dodgeT > 0 && !opts.ignoreDodge) {
      G.floatText(state, p.x, p.y - 24, 'dodged!', '#c9c2b2', 13);
      return 0;
    }
    const stats = Entities.effectiveStats(p);
    const raw = typeof rawDmgOrFn === 'function' ? rawDmgOrFn() : rawDmgOrFn;
    const dmg = Entities.damageAfterDefense(raw, stats.defense);
    Stats.bump(p, 'taken', dmg);
    p.hp -= dmg;
    p.hurtT = 0.3;
    state.shake = Math.min(8, state.shake + (opts.shake || 2.5));
    G.floatText(state, p.x, p.y - 24, `-${dmg}`, '#ff5c4d', 15);
    G.burst(state, p.x, p.y, '#c03a2b', 6, 100);
    G.sfx(state, 'hurt');
    // Thorns: melee retaliation only (a projectile/blast has no attacker to bite).
    if (opts.attacker && stats.thorns > 0) G.hitMonster(state, opts.attacker, stats.thorns, stats, 0, 0, p);
    return dmg;
  }
  G.hurtPlayer = hurtPlayer;

  // A caster's bolt: a hostile, fixed-damage projectile aimed at (tx, ty).
  G.spawnHostileBolt = function spawnHostileBolt(state, m, tx, ty, speed, dmg) {
    const a = Math.atan2(ty - m.y, tx - m.x);
    state.projectiles.push({
      id: state.nextId++,
      hostile: true,
      x: m.x + Math.cos(a) * (m.size + 4),
      y: m.y + Math.sin(a) * (m.size + 4),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      dmg: Math.max(1, Math.round(dmg)),
      kind: 'bolt',
      ttl: 2.2,
      angle: a,
    });
    G.sfx(state, 'fireball');
  };

  // An exploder's self-destruct: AoE damage to players in radius, then it removes
  // itself (no kill credit / XP — it died on its own terms).
  G.explodeMonster = function explodeMonster(state, m, radius, dmg, kb) {
    G.burst(state, m.x, m.y, '#ff9a3d', 20, 180);
    G.burst(state, m.x, m.y, '#d98b3f', 12, 120);
    state.shake = Math.min(9, state.shake + 3);
    G.sfx(state, 'explode');
    for (const pl of state.players) {
      if (pl.dead || pl.down) continue;
      const reach = radius + G.PLAYER_R;
      if (U.dist2(m.x, m.y, pl.x, pl.y) >= reach * reach) continue;
      if (!G.lineOfSight(state.dungeon.grid, m.x, m.y, pl.x, pl.y)) continue;
      hurtPlayer(state, pl, dmg, { shake: 3 });
    }
    G.damagePropsInRadius(state, m.x, m.y, radius, dmg);
    const i = state.monsters.indexOf(m);
    if (i !== -1) state.monsters.splice(i, 1);
  };

  // A summoner raises a minion beside itself (deterministic via state.srand). Returns
  // the minion, or null if the roll landed it in a wall.
  G.spawnMinion = function spawnMinion(state, summoner, type) {
    const partyN = state.partyN || (state.players && state.players.length) || 1;
    const ang = state.srand() * Math.PI * 2;
    const d = summoner.size + 14;
    const x = summoner.x + Math.cos(ang) * d;
    const y = summoner.y + Math.sin(ang) * d;
    if (G.collides(state.dungeon.grid, x, y, 8)) return null;
    const minion = {
      ...Entities.makeMonster(type, state.floor, false, partyN),
      id: state.nextId++,
      x,
      y,
      attackT: 0.3,
      hitT: 0,
      lungeT: 0,
      wanderT: 0,
      wandA: 0,
      aggroed: true, // raised already hostile
      kbx: 0,
      kby: 0,
      summonerId: summoner.id,
    };
    state.monsters.push(minion);
    G.burst(state, x, y, '#6f8f6f', 8, 90);
    return minion;
  };

  // Fire every threshold the boss has dropped past, in order, at most once each.
  G.advancePhases = function advancePhases(state, m) {
    const frac = m.hp / (m.maxHP || m.hp);
    if (m.phaseIdx === undefined) m.phaseIdx = 0;
    while (m.phaseIdx < m.phases.length && frac <= m.phases[m.phaseIdx].at) {
      const ph = m.phases[m.phaseIdx];
      m.phaseIdx++;
      // Behavior and its tuning fields are copied onto the monster so the
      // dispatch in ai.js needs to know nothing about phases.
      for (const k of Object.keys(ph)) {
        if (k === 'at' || k === 'onEnterSummon' || k === 'message') continue;
        m[k] = ph[k];
      }
      m.telegraphT = 0;
      m.telegraph = null;
      if (ph.onEnterSummon) {
        G.summonAdds(state, m, ph.onEnterSummon.type, ph.onEnterSummon.count, ph.onEnterSummon.cap);
      }
      state.shake = Math.min(12, state.shake + 6);
      G.burst(state, m.x, m.y, '#ffd84d', 22, 180);
      G.sfx(state, 'levelup');
      if (ph.message) G.message(state, ph.message, '#ff9a3d');
      else if (m.name) G.message(state, `${m.name} changes its stance!`, '#ff9a3d');
    }
  };

  function rollDamage(state, stats) {
    let dmg = Math.max(1, Math.round(stats.damage * (0.85 + state.srand() * 0.3)));
    // Critical strike: a 1.5× hit. The srand() draw is guarded on critChance so gear
    // without crit never perturbs the RNG stream (byte-identical to the old roll).
    if (stats.critChance && state.srand() < stats.critChance) dmg = Math.round(dmg * 1.5);
    return dmg;
  }
  G.rollDamage = rollDamage; // exported for tests (crit determinism)

  function playerAttack(state, p = state.player) {
    const stats = Entities.effectiveStats(p);
    p.attackT = 1 / stats.speed;

    if (stats.kind === 'melee') {
      p.swing = { t: 0, dur: Math.min(0.24, 0.8 / stats.speed), facing: p.facing, radius: stats.radius, arc: stats.arc };
      Stats.bump(p, 'swings');
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

    // Ranged: AoE weapons (wand/staff) hurl exploding fireballs; thrown weapons
    // spin a non-splash projectile; bows/crossbows loose arrows/bolts. The blast is
    // driven by `stats.aoe`, so any AoE weapon kind explodes without special-casing.
    p.swing = { t: 0, dur: 0.15, facing: p.facing, radius: 24, arc: 0.8, ranged: true };
    const a = p.facing;
    const projKind = stats.aoe ? 'fireball' : stats.kind === 'thrown' ? 'thrown' : 'arrow';
    state.projectiles.push({
      id: state.nextId++,
      ownerId: p.id,
      x: p.x + Math.cos(a) * 14,
      y: p.y + Math.sin(a) * 14,
      vx: Math.cos(a) * stats.projSpeed,
      vy: Math.sin(a) * stats.projSpeed,
      dmg: rollDamage(state, stats),
      kind: projKind,
      aoe: stats.aoe,
      ttl: 1.8,
      angle: a,
    });
    Stats.bump(p, 'shots');
    G.sfx(state, projKind === 'fireball' ? 'fireball' : 'bow');
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

  // Monster-fired projectiles (e.g. caster bolts). They damage PLAYERS, never
  // monsters, carry a fixed spawn-time damage (no owner lookup), and shatter on the
  // first wall or hero they reach. Serialization is free — they live in the same
  // state.projectiles array and carry the same wire fields (id/x/y/kind/angle).
  function updateHostileProjectile(state, pr, dt) {
    pr.ttl -= dt;
    let dead = pr.ttl <= 0;
    const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 8));
    for (let s = 0; s < steps && !dead; s++) {
      pr.x += (pr.vx * dt) / steps;
      pr.y += (pr.vy * dt) / steps;
      if (G.collides(state.dungeon.grid, pr.x, pr.y, 3)) {
        dead = true;
        G.burst(state, pr.x, pr.y, '#b46bff', 5, 70);
        break;
      }
      for (const pl of state.players) {
        if (pl.dead || pl.down) continue;
        const reach = G.PLAYER_R + 4;
        if (U.dist2(pr.x, pr.y, pl.x, pl.y) < reach * reach) {
          dead = true;
          const dealt = hurtPlayer(state, pl, pr.dmg, { shake: 2 });
          G.burst(state, pr.x, pr.y, '#b46bff', 6, 90);
          // A boss caster's bolt can carry a burn (see js/game/behaviors.js); apply
          // it only on a landed hit, never through a dodge.
          if (dealt > 0 && pr.burn > 0) G.applyStatus(pl, 'burn', pr.burnDur || 3, { dps: pr.burn, src: null });
          break;
        }
      }
    }
    if (dead) state.projectiles.splice(state.projectiles.indexOf(pr), 1);
  }
  G.updateHostileProjectile = updateHostileProjectile;

  G.updateProjectiles = function updateProjectiles(state, dt) {
    for (const pr of [...state.projectiles]) {
      if (pr.hostile) {
        updateHostileProjectile(state, pr, dt);
        continue;
      }
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
        // Hostile shots (monster casters) are handled entirely by
        // updateHostileProjectile above; everything reaching here is hero-fired and
        // looks for monsters.
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

  G.hitMonster = hitMonster;

  function killMonster(state, m, stats, killer = state.player) {
    state.kills++;
    Stats.bump(killer, 'kills');
    if (m.boss) Stats.bump(killer, 'bosses');
    state.monsters.splice(state.monsters.indexOf(m), 1);
    G.questProgress(state, (q) => Quests.recordKill(q, m));
    G.mainQuestKill(state, m, killer || state.player);
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
    // "You kill, you leech": lifePerKill heals and manaPerKill restores mana to the
    // credited killer only.
    if (stats.lifePerKill > 0) {
      killer.hp = Math.min(Entities.effectiveStats(killer).maxHP, killer.hp + stats.lifePerKill);
    }
    if (stats.manaPerKill > 0) {
      killer.mana = Math.min(Entities.effectiveStats(killer).maxMana, (killer.mana || 0) + stats.manaPerKill);
    }
    // XP goes to every living player within share range of the kill (Task 3). Solo:
    // the one player is always in range ⇒ identical to the old single-player grant.
    awardKillXP(state, m, killer);
    dropLoot(state, m, killer);
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

  // Act-boss credit, per character, following the SAME share rule as XP: if you
  // were close enough to earn experience from the kill, you banked the act. A
  // party can therefore sit on different acts, which is the accepted consequence
  // of per-character progress — the banner reads the local hero's act, not the
  // room's.
  G.mainQuestKill = function mainQuestKill(state, m, killer) {
    if (!m.boss || !m.actBoss) return;
    const range = (Balance.coop && Balance.coop.shareRange) || 900;
    const r2 = range * range;
    for (const pl of state.players) {
      if (pl.dead || pl.down) continue;
      if (pl !== killer && U.dist2(pl.x, pl.y, m.x, m.y) > r2) continue;
      if (!pl.mainQuest) pl.mainQuest = Quests.newMain();
      const act = Bosses.actByNumber(pl.mainQuest.act);
      if (!Quests.recordBossKill(pl.mainQuest, m, state.floor)) continue;
      if (pl === state.player) {
        G.message(state, `Act ${Quests.ROMAN[act.act]} complete — ${act.done}`, '#ffd84d');
        if (pl.mainQuest.complete) {
          G.message(state, 'The main quest is complete. You have reached the bottom.', '#ffd84d');
          // A timed card, not a modal: the run stays playable and the hero can
          // keep descending past 24 if they want to.
          state.victory = { t: 0, dur: 7 };
        }
        G.sfx(state, 'levelup');
      }
    }
  };

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
    // Past every early return above: the cast is committed and paid for.
    Stats.bump(p, 'casts');

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
