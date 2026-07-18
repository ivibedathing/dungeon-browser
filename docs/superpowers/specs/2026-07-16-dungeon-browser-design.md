# Dungeon Browser — 2D Top-Down Action RPG — Design Spec

Date: 2026-07-16
Status: Approved for implementation (autonomous session — decisions made with classic action-RPG conventions as defaults; user requirements taken verbatim from the request)

## Goal

A playable, self-contained 2D top-down action RPG in the browser with:

- **Level ups** (XP from kills, growing stats)
- **Inventory management** (grid inventory, equipment slots, item rarities)
- **Health points** (HP orb) and **potions** (belt, hotkeys)
- **Controls: WASD** to move, **Space** to swing the equipped weapon in a defined radius/arc
- **Monsters that get gradually stronger** (per-floor scaling + champions)
- **Procedural dungeon generation** (rooms + corridors, stairs down, endless descent)

## Approaches considered

1. **Single inline HTML file** — trivially runnable, but ~4k lines in one file is unmaintainable and untestable.
2. **Plain `<script>` tags, multiple JS files, zero dependencies/build** *(chosen)* — opens directly via `file://` or any static server; pure-logic modules export under Node via a `module` guard, so core systems are unit-testable with `node --test`.
3. **ES modules + dev server/bundler** — cleanest imports, but breaks plain `file://` usage and adds tooling for no gameplay benefit.

Choice: **2** — best runnability/maintainability/testability trade-off with no dependencies.

## Architecture

```
index.html                 canvas + ordered script includes
js/util.js                 seeded RNG (mulberry32), math helpers, ring/arc tests
js/dungeon.js              procedural generation (pure, testable)
js/items.js                item + affix generation, rarity rolls (pure, testable)
js/entities.js             player/monster archetypes, XP curve, floor scaling (pure, testable)
js/game.js                 game state, update loop: input, movement/collision, AI, combat, loot, potions, floors
js/render.js               world rendering: tiles, fog of war, entities, particles, swing arcs
js/ui.js                   HUD (HP orb, XP bar, belt, minimap, floor), inventory panel, tooltips, mouse
js/main.js                 boot, canvas sizing, input listeners, requestAnimationFrame loop
test/*.test.js             node --test suites for the pure modules
```

All rendering is Canvas 2D with programmatic art (no external assets — works offline). UI is drawn on the same canvas; mouse hit-testing drives the inventory.

## Core systems

### Dungeon generation (`dungeon.js`)
- Tile grid (default 60×60 of 32px tiles): `WALL`, `FLOOR`, `STAIRS_DOWN`, `ENTRY`.
- Place 9–14 non-overlapping rooms (random size 5–11), connect each new room to the previous with L-shaped corridors, add 2 extra random room-to-room corridors for loops. Connectivity holds by construction; a BFS test asserts it.
- Entry in the first room; stairs down in the room whose center is farthest (BFS distance) from entry.
- Decor: torch positions on walls adjacent to floor (light flicker), per-tile visual variation from the seed.
- Monster spawns: every room except the entry room gets `2 + floor(rand*3)` spawns scaled by floor; ~12% champion chance (min 1 champion from floor 3 on).
- Theme palette lerps with depth (stone crypt → cold blue caves → hellish red) every 4 floors.

### Items & inventory (`items.js`, game state)
- Equipment slots: **Weapon, Armor, Ring**. Inventory: **24 slots (8×3 grid)**, one item per slot.
- Rarities (classic ARPG colors): Common (white), Magic (blue, 1 affix), Rare (yellow, 2–3 affixes), Unique (orange, 3–4 affixes + name). Roll: 60/27/10/3, champions guarantee Magic+.
- Bases scale with item level (= floor): Weapons (Sword/Axe/Mace/Spear — damage, swing radius, attack speed), Armor (defense = flat damage reduction, +maxHP), Rings (any affixes).
- Affixes: +damage, +% attack speed, +swing radius, +maxHP, +defense, +life per kill, +% XP gain, +% move speed.
- Drops: on kill — 35% gold, 22% potion, 16% item; champions always drop an item. Ground items show name labels; **E** picks up the nearest (gold auto-pickup on touch).
- Potions: Minor/Light/Standard/Greater/Super healing tiers by floor; belt holds 4 (keys **1–4**), auto-refilled from inventory; healing applies over ~1.2s (gradual orb fill).

### Character & progression (`entities.js`)
- Player: starts Level 1, 100 HP, Rusty Sword (8 dmg, 78px radius, 2.4 swings/s).
- XP to next level: `round(90 · n^1.55)`. On level up: **+14 max HP, +2 base damage, full heal**, burst effect.
- Monsters (base HP/dmg/speed/XP): Zombie 34/7/slow/14, Skeleton 24/6/med/12, Bat 13/4/fast/9, Brute 60/13/slow/26. From floor 3+, Wraith 20/9/fast/20 (semi-transparent).
- **Floor scaling**: HP ×(1 + 0.32·(f−1) + 0.03·(f−1)²), damage ×(1 + 0.20·(f−1)), XP ×(1 + 0.25·(f−1)). Champions: ×2.6 HP, ×1.5 dmg, ×3 XP, larger sprite, named.
- Monster AI: idle wander → aggro on sight radius (or when hit) → chase via BFS distance field from the player (recomputed ~5×/s, radius-limited), attack on contact range with per-monster cooldown and windup flash.

### Combat
- **Space**: swing = 170° arc in facing direction with the weapon's radius; hits every monster in the arc; cooldown from attack speed. Visual arc sweep + hit particles + floating damage numbers + slight knockback + screen shake on champion kills.
- Monster hit on player: damage minus defense (min 1), red flash + orb shake; brief 0.35s per-monster attack cooldown.
- Death: dark overlay, stats, **R** restarts at Floor 1 keeping nothing (fresh run — roguelite loop).

### HUD (all canvas)
- Bottom bar (classic ARPG layout): red **HP orb** (left), **XP bar** with level, **potion belt** ×4 (right), gold counter.
- Minimap (top-right, explored tiles + stairs), floor label, controls hint, message log (pickups, level ups).
- **I/Tab** toggles inventory panel: grid + equipment silhouette, hover tooltips with affix lines and equip-comparison, click to equip/use, right-click to drop.

## Error handling
- Generation is seeded (`floor` + run seed) and validated by construction; if a spawn/placement can't find space in N tries it degrades gracefully (fewer monsters, never a crash).
- Game loop clamps `dt` (tab-switch safe). No network, no storage — no external failure modes.

## Testing
- `node --test test/` covers: dungeon connectivity (entry→stairs BFS, sealed border, min room count), item generation validity across 1k rolls (rarity distribution sanity, affix ranges), XP curve monotonicity, floor scaling monotonicity, inventory add/remove/equip/swap/potion-belt logic.
- Manual/browser verification: serve, play — move, swing, kill, loot, drink, level, descend; console must be clean.

## Out of scope (YAGNI, future ideas)
Multi-cell tetris inventory, mana/skill tree.

## Addendum (2026-07-16, second session) — requested extensions

All of the following were requested after v1 shipped and are implemented on the same architecture:

- **Sound** (`js/audio.js`): procedurally synthesized Web Audio SFX (swing/hit/kill/hurt/drink/pickup/gold/equip/level-up/stairs/death/bow/fireball/explosion/portal/travel/heal/error). Unlocks on first user gesture; **M** mutes, preference persisted.
- **Saves** (`js/save.js`): localStorage snapshot of durable progress (player, equipment, bag, floor, seed, kills). The floor regenerates deterministically from `(runSeed, floor)` on resume — monsters respawn, layout is identical. Autosaves on descend/level-up/every 4 s/tab close; death wipes the save and keeps best-run records (shown on the death screen).
- **Equipment slots**: helmet / gloves / pants / boots join weapon / chest / ring. Each rolls defense (helmets +life, gloves +attack speed, boots +move speed). All pieces render on the player sprite, tinted by rarity; inventory panel is a 7-slot paper-doll.
- **Weapon kinds**: melee bases differ (sword 170° arc, battle axe 205°, iron mace 150° + heavy knockback, spear 120° long reach); **Hunting Bow** fires arrows (single target); **Ember Wand** hurls fireballs that explode in an AoE. Projectiles use swept collision against walls.
- **Town + Town Portal (T)**: 15 s-cooldown skill opens a portal; it leads to Ashfall Camp (healing well, torches, no monsters) while the dungeon state is stashed by reference and restored exactly on return. Descending collapses portals.
- **Store**: Grizzle the Trader — E buys a potion; with the inventory open in trade range, a shop strip sells 3 rolled items + potions, and clicking your own bag items **sells** them (prices scale with rarity/item level; tooltips show buy/sell prices). Gold finally has a sink.
- **Boss arenas**: every even floor turns the BFS-farthest room into an arena — the stairs move off-center inside it, trash spawns are excluded, and a Floor Guardian (`Entities.makeBoss`: brute base ×8 HP, ×2 damage, ×10 XP, ×2.1 size, 0.15 knockback multiplier, named per depth) spawns at its center. `state.bossFight` is true while a living boss and the player share the room: the camera lerps to the room center instead of the player, the UI draws a top-center boss health bar with the name, entry plays a roar and a warning message. Boss death always drops two magic-or-better items plus a large gold pile.
- **Dodge & attack remap**: Space is a dodge roll — 0.22 s committed dash (~120 px, 560 px/s) toward held movement (or facing when still), 0.9 s cooldown, full i-frames (monster hits during the roll show "dodged!" and deal nothing), afterimage trail + dust + whoosh. Attacking is impossible mid-roll. Attack moved to **M** (held), mute moved to **N**.
- **Armor & sword variety**: base tables expanded to ~26 armor bases and 6 sword classes with `minFloor` depth gating; weight-class `tone` colors (leather/mail/plate/bone) paint icons and the sprite; new base stats — helm `+mana`, glove `spd`, boot/pants `mv` (plate can be negative = move penalty) — all flowing through `aggregateStats`, tooltips, and the stat sheet with signed formatting.
- **Deep floors (11+)**: `Dungeon.DEEP_THEMES` (Fungal Hollows, Frozen Abyss, Obsidian Warrens) and a warren profile — target 19 rooms of 4–7×4–6 with 6 loop corridors (vs 13 of 5–11×5–9 with 3) — same connectivity guarantees, verified by tests.
- **Character creation**: new-hero screen (name field with caret, 8 shirt swatches, live preview, Enter/click to begin) shown when no save exists and after death-restart (identity prefilled); `newPlayer(opts)` carries `name`/`shirt`, persisted in saves; the shirt colors the sprite, the name heads the character sheet and welcome message.
- **Waypoints**: `state.milestones` records floors 5/10/15… reached via `descend()` only (never via waypoint travel), persisted in saves, wiped on death with the run; entering town spawns one labeled `kind:'waypoint'` portal per milestone in a row above the entry; stepping in abandons the stashed floor and regenerates the milestone floor fresh.
- **Blacksmith & gear levels**: `item.plus` 0–10 on every worn slot but the ring (`Items.SMITHABLE_SLOTS` / `Items.isSmithable`, `Items.upgradeItem`) — +8% damage per level on weapons (`Items.weaponDamage`), +8% defense per level on armour (`Items.armorDefense`), other rolls and affixes unscaled. Names render as "+N …" (`Items.displayName`), sell value +25%/plus; `Items.upgradeCost = round((15 + ilvl·5) × rarityMult × 1.5^plus)`. Borin the Blacksmith + anvil in town (`dungeon.smith`); `state.smithing` within 85px; E hammers the equipped weapon, inventory clicks upgrade any smithable piece, and at the anvil clicking an equipped piece hones it instead of unequipping (the ring still unequips); tooltips show cost; anvil sfx.
- **Balance table**: `js/balance.js` is the single source of truth for player gains, XP curve, monster bases + scaling, champion/boss multipliers, drop/rarity luck, spawn counts, and upgrade knobs. `tool/balance-report.mjs` renders `BALANCE.md`. Tuned harder: monster damage scaling 0.20→0.28/floor, HP 0.32/0.03→0.38/0.035 with higher bases, XP curve 90·n^1.55→100·n^1.62, drops 16/22/35→12/18/30%, rarity 60/27/10/3→66/24/8/2, level-up life +14→+12, aggro +15%. Tests assert wiring against Balance, not literals.
- **CTRL-compare**: holding Ctrl over a bag item renders a second tooltip panel with the equipped item of that slot ("CURRENTLY EQUIPPED"), placed beside the main tooltip.
- **Mana & skill tree** (`js/skills.js`): blue mana orb (base 40, +6/level, regen 2.5/s + bonuses), mana potions (drops + vendor barrel), `+1 skill point per level`, K opens a 3×3 tree — War (Whirlwind [F]: 360° spin), Sorcery (Fire Nova [G]: 12-fireball ring; Arcane Focus; Ember Mastery), Faith (Healing Prayer [H]; Stone Skin; Vigor). Tier N requires a rank in tier N-1 of the branch; actives cost mana with short cooldowns (HUD skill bar shows costs + cooldown veils). All persisted in saves.
