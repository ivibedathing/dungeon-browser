# Content Expansion — Items, Weapons & Enemy Types Implementation Plan

> Spec: none (greenfield content work grounded in the existing data tables).
> Roadmap: standalone; not part of the multiplayer roadmap (`0 → 1 → 2 → 4 → 5`).
> Baseline: `main` @ `71a823d` — full suite **337 tests** green.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the
> full `node --test test/*.test.js` suite green. Rendering tasks that can't be a node
> assertion get a documented manual verification step (open `verify.html`) instead.

**Goal:** Substantially widen the game's content — *many* more weapons (and new weapon
*kinds*), *many* more items with far richer procedural visuals, and *many* more enemy
types **including genuinely new behaviors** (ranged casters, exploders, chargers,
summoners) that work in both solo and co-op. No new equipment *slots* — the save
format, equip UI, and `aggregateStats` shape are held stable on purpose. All visuals
stay **procedural Canvas 2D**: the assets-optional guarantee (`js/assets.js`) is not
touched, and nothing in this plan requires a single image file to ship.

## Scope decisions (locked at kickoff)

- **Enemies:** new *behaviors* + netcode, not just reskins. New AI archetypes and the
  first-ever **hostile projectiles** land in the shared sim (`js/game/`), so they run
  identically on the co-op server and serialize into snapshots.
- **Items/weapons:** expand *within* the existing slots and add new weapon *kinds*
  (dagger, spear→polearm, crossbow, staff, thrown). **No new equipment slots** — no
  amulet/off-hand/charm. This keeps `Items.EQUIP_SLOTS`, the bag/equip UI, the save
  blob, and the player snapshot byte-compatible.
- **Visuals:** procedural only. "Better visuals" = better draw code (per-base weapon
  icons, per-kind held sprites, per-archetype monster bodies, rarity ornament), never
  sprite assets.

## Architecture — the seams this plan leans on

The codebase is **data-driven for stats, hand-coded for visuals and behavior**. That
split defines every task below.

- **Weapon/armor stats are pure data.** `WEAPON_BASES` / `ARMOR_BASES` / `HELMET_BASES`
  / … in `js/items.js` and `Balance.monsters` in `js/balance.js`. Adding *entries* is
  cheap and node-testable. `js/game/` and `server/` read these directly.
- **Item icons are generic-per-slot.** `render/icons.js#drawItemIcon` switches on
  `item.slot` — **every weapon draws one diagonal sword**; armor pieces are generic
  tone-filled shapes. This is the single biggest "better visuals" lever.
- **Held weapon has 3 styles.** `render/player.js` switches on `wkind`
  (`melee`/`bow`/`wand`) only. New kinds need new held-sprite branches.
- **Monster bodies are a hand-written `if/else` on `m.type`.** `render/monster.js`.
  A new type with no branch falls into the generic humanoid `else` — functional but
  bland. Each new archetype gets a body branch.
- **AI is melee-only.** `js/game/ai.js#monsterUpdate` is one uniform chase-and-lunge.
  There are **no monster projectiles anywhere** — `state.projectiles` is player-only,
  and `projectileOwner` falls back to `state.player`. New behaviors extend this file
  and add a hostile-projectile update path in `js/game/combat.js`.
- **Netcode whitelists fields** (`server/room.js#snapshotFor`, ~L280–298):
  - monsters send `id, type, name, x, y, hp, maxHP, r, facing, hitT, champion, boss`
  - projectiles send `id, x, y, kind, angle`
  A **new hostile projectile `kind` rides the existing projectile wire for free**
  (client just needs a draw branch for it). But **any new monster telegraph/wind-up
  state that must render in co-op has to be added to the monster whitelist** — that is
  the one deliberate netcode edit, called out in Phase 4.
- **Determinism is load-bearing.** Monster/loot generation runs off `state.srand()` and
  deterministic champion naming so co-op host & client (and replays/tests) agree. Any
  new random choice in generation must use the seeded RNG, never `Math.random()`.
  (`Math.random()` is fine in *render*/particle code, which is client-local cosmetic.)

## Phasing overview

Phases are ordered cheapest-and-safest first, so value ships early and the risky
netcode change lands last against a stable base.

| Phase | Theme | Touches netcode? | Risk |
|------|-------|-----------------|------|
| 1 | Weapon bases + kinds (data + icons + held sprites) | no | low |
| 2 | Armor bases + affixes + richer icons/rarity ornament | no | low |
| 3 | Enemy *variants* (stats + bodies, existing melee AI) | no | low |
| 4 | Enemy *behaviors* (ranged/exploder/charger/summoner) + hostile projectiles | **yes** | med-high |
| 5 | Balance pass, drop-table wiring, docs (`BALANCE.md`), polish | no | low |

Each phase is independently shippable and leaves the suite green.

---

## Phase 1 — Weapons: more bases, new kinds, per-base visuals

**Outcome:** roughly 3× the weapon bases, several new weapon *kinds*, and every base
draws a distinct icon + held sprite instead of the universal sword.

### Data (`js/items.js`)

- **Add a `family` (a.k.a. icon key) to every `WEAPON_BASES` entry.** This is the visual
  discriminator the icon/held code switches on, decoupled from `kind` (which stays the
  combat discriminator: `melee`/`bow`/`wand` + new ranged kinds). Example families:
  `sword`, `axe`, `mace`, `dagger`, `spear`, `greatsword`, `bow`, `crossbow`, `wand`,
  `staff`, `thrown`.
- **New melee bases** across the existing `minFloor` tiering: e.g. Dagger (fast/short,
  high crit-feel via speed), Rapier, War Hammer, Halberd, Glaive, Flail, Katana,
  Scimitar, Morning Star, Great Axe. Keep `dmg/radius/speed/arc/kb` in the same shape
  and units already used — no combat-code change, purely more rows.
- **New weapon kinds** (combat behavior, all already supported by the projectile path or
  a tiny extension):
  - `crossbow` — like `bow` but slower + higher projSpeed + higher dmg (arrow visuals,
    heavier). Reuses the `arrow` projectile kind.
  - `staff` — like `wand` (AoE fireball) but slower/bigger `aoe`. Reuses `fireball`.
  - `thrown` (axes/javelins) — a projectile kind `thrown` that flies and hits like an
    arrow but no explosion; add the tiny `kind === 'thrown'` render branch. Combat-wise
    it is the non-AoE projectile branch already in `updateProjectiles`.
  - Optionally `spellblade`/hybrids are **out of scope** (would need dual-attack logic).
- **`E.starterWeapon()`** stays exactly as-is (Rusty Sword, `family: 'sword'` added).

### Visuals

- **`render/icons.js#drawItemIcon`** — replace the single `slot === 'weapon'` branch with
  a `switch (item.family)` that draws each family distinctly (blade length/shape, axe
  head, mace flanges, bow curve, crossbow stock, staff orb, dagger, spear tip). Fall
  back to the current sword draw when `family` is missing (older saves / robustness).
- **`render/player.js`** — extend the held-weapon block: the `wkind` switch becomes a
  `family`-aware switch so a held axe/mace/dagger/spear/staff/crossbow each read
  differently in-hand. Bow/wand keep their current draws as two of the families.
- **Rarity glint** (shared with Phase 2): magic+ weapons get a subtle colored edge
  highlight in the icon, keyed off `item.color`.

### Tests

- Extend `test/weapons.test.js` / `test/items.test.js`:
  - every `WEAPON_BASES` entry has a `family`, a valid `kind`, and the stat fields its
    kind requires (melee ⇒ radius/arc/kb; ranged ⇒ projSpeed; AoE kinds ⇒ aoe).
  - `Items.makeItem(floor, rng, {kind})` still returns a coherent item for each new
    kind; ranged kinds never roll the `radius` affix (existing rule, now covered for
    new kinds).
  - deterministic: same seed ⇒ same base/family (guards against `Math.random()` creeping
    into generation).
- `test/render.test.js`: `drawItemIcon` and `drawPlayer` run without throwing for one
  item of every `family` against the headless canvas stub.

**Manual verify:** open `verify.html`, spawn one of each weapon family, confirm icons
and held sprites are visually distinct. Commit: `feat(items): weapon families — new
bases, kinds, and per-family icons/held sprites`.

---

## Phase 2 — Items: more armor bases, new affixes, richer icons

**Outcome:** more depth per existing slot, a wider affix pool, and armor/ring icons
that read by base and rarity — no new slots.

### Data (`js/items.js`)

- **More bases per armor table** (`ARMOR_BASES`, `HELMET_BASES`, `GLOVE_BASES`,
  `PANTS_BASES`, `BOOTS_BASES`) across the `minFloor` tiers, each with its `tone` and
  the same stat shape. Add an optional `family`/`motif` string per base for the icon to
  vary silhouette (e.g. `hood` vs `greathelm` vs `crown` for helmets).
- **More `RING_BASES`** (they carry only affixes today — add a few names + an optional
  `gem` color for the icon).
- **New affixes** in `AFFIXES` (each a `{roll, label}` pair, value scaling gently with
  floor like the existing ones). Candidates, all wired through
  `Items.aggregateStats` and `Entities.effectiveStats`:
  - `thorns` (reflect a flat amount on being hit) — needs a hook in the monster-attack
    damage step in `js/game/ai.js`.
  - `critChance` / `critMult` — needs a roll in `rollDamage` (`js/game/combat.js`).
  - `manaPerKill` (mirror of `lifePerKill`, already has a kill hook).
  - `projectilePierce` (ranged) — a small extension in `updateProjectiles`.
  - Keep any affix whose hook doesn't exist yet **out** of this phase unless its hook is
    trivial; prefer affixes that plug into existing aggregation first (pure stat adds:
    e.g. `+% AoE`, `+ knockback`, `+ life regen`).
  - **Rule:** every new affix must be summed in `Items.aggregateStats` *and* consumed
    somewhere, or a test will (rightly) fail to find its effect.

### Visuals

- **`render/icons.js`** — armor branches vary by `family`/`motif` (helmet crown vs hood
  vs visor; plate vs robe body; gauntlet vs mitt). Rings render their `gem` color.
- **Rarity ornament (shared):** a small corner pip / edge tint per rarity on every icon,
  driven by `Items.RARITIES[rarity].color`, so a rare reads as rare at a glance in the
  bag grid and on the ground. Applies to weapons from Phase 1 too.

### Tests

- `test/armorvariety.test.js` / `test/equipment.test.js`:
  - every armor base across every table has a `tone` and coherent stat ranges.
  - each new affix: `Items.aggregateStats` reflects it, and `effectiveStats` (or the
    combat/AI hook) consumes it — a focused unit test per affix proving the number moves.
  - `Items.EQUIP_SLOTS` is **unchanged** (explicit assertion — guards the "no new slots"
    contract and the save format).
- `test/render.test.js`: an icon of every armor `family` + a ring draws without throwing.

**Manual verify:** `verify.html` — drop several rarities of each slot, confirm rarity
ornament and per-base silhouettes read clearly. Commit: `feat(items): armor variety,
new affixes, and rarity-aware icons`.

---

## Phase 3 — Enemies: new *variants* on the existing melee AI

**Outcome:** many more monster types that differ by stats, size, and **procedural body**,
all reusing the current chase-and-lunge AI. Zero combat/netcode change — safe warm-up
for Phase 4.

### Data (`js/balance.js`)

- **Add monster entries** to `Balance.monsters` following the exact documented shape
  (`hp/dmg/speed/xp/minFloor/weight/size/color/aggro/attackRange/attackCd`). Ideas that
  need no new behavior: `ghoul` (tanky zombie), `hound` (fast pack melee), `spider`
  (fast, small, low HP), `slime` (slow, high HP, splits later in Phase 4),
  `cultist` (baseline for Phase 4's caster), `armored skeleton` (high defense-feel via
  HP), `giant bat`, `rat swarm` variant. Tune `weight`/`minFloor` so floors stay
  readable (see Phase 5 balance pass).
- Keep `swarmling`'s `weight: 0` pattern for any type that should only spawn via a
  special path, not the random pool.

### Visuals (`render/monster.js`)

- **Add a body branch per new type** in the `m.type` switch (or a small lookup of
  draw-fns keyed by type). Reuse the existing shading/eye/HP-bar/champion scaffolding —
  only the body silhouette differs. Types without a bespoke branch still render via the
  generic humanoid `else`, so this can land incrementally.

### Tests

- `test/entities.test.js`: extend the "scales monotonically with floor" loop to cover
  **every** key in `Balance.monsters` (not the hardcoded 5), so new types are auto-tested
  for sane scaling. `pickMonsterType` respects `minFloor`/`weight` for the new set.
- `test/render.test.js`: `drawMonster` runs without throwing for one instance of every
  `Balance.monsters` type (catches a missing/typo'd render branch).

**Manual verify:** `verify.html` — spawn one of each type across floors, confirm each
reads distinctly. Commit: `feat(enemies): new melee variants — stats and bodies`.

---

## Phase 4 — Enemies: new *behaviors* + hostile projectiles (netcode)

**Outcome:** the first non-melee monster behaviors, in the shared authoritative sim, in
solo **and** co-op. This is the one phase that edits `js/game/combat.js`,
`js/game/ai.js`, and the netcode whitelist. Land it against a stable base.

### Behavior model (`js/game/ai.js`)

- **Add a `behavior` tag** to monster archetypes (in `Balance.monsters`, e.g.
  `behavior: 'ranged' | 'exploder' | 'charger' | 'summoner'`; absent ⇒ `'melee'`, so
  every existing and Phase-3 type is byte-identical). `monsterUpdate` branches on it:
  - **`ranged`** (cultist/archer): keeps distance (kite), and on cooldown fires a
    **hostile projectile** toward the nearest player instead of lunging. Uses a short
    telegraph (`castT`) so it's fair to dodge.
  - **`exploder`** (bomb-slime): rushes, and on reaching attack range starts a fuse
    (`fuseT`); on expiry deals AoE damage to nearby players and dies (self-destruct via
    the existing burst + a radial damage call). No projectile.
  - **`charger`** (hound/boar): winds up (`windupT`), then dashes in a straight line at
    high speed, dealing contact damage; overshoots and recovers. Reuses knockback math.
  - **`summoner`** (necromancer): on cooldown spawns 1–2 weak melee minions (respecting a
    per-summoner cap) via the existing `makeMonster` + spawn plumbing. Deterministic:
    spawn choices use `state.srand()`.
- All timers decay in `monsterUpdate` alongside `attackT/hitT/lungeT`. All new random
  choices use `state.srand()`.

### Hostile projectiles (`js/game/combat.js`)

- **`state.projectiles` gains hostile entries.** Add a `hostile: true` (and `ownerId:
  null` or a monster id) so the update path knows to damage **players**, not monsters.
- **`updateProjectiles` split by target:** friendly projectiles hit monsters/props
  (today's path); hostile projectiles hit **players** (respect `dodgeT`, apply
  `damageAfterDefense`, hurt flash, shake — mirror the melee hit block in `ai.js`).
  Factor the shared "hit a player" logic so ai.js melee and hostile projectiles agree.
- New projectile `kind`s: e.g. `bolt` (magic bolt), `venom` (spit). AoE kinds reuse the
  `explode` path but must resolve their blast against **players** when hostile.
- `projectileOwner` must not fall back to `state.player` for hostile projectiles (that
  would mis-credit stats/kills). Give hostile projectiles a fixed `dmg` at spawn time so
  they don't need an owner lookup at all.

### Netcode (`server/room.js` + client render)

- **Projectiles:** a new hostile `kind` already serializes (`id, x, y, kind, angle`).
  Add the client draw branches for `bolt`/`venom`/etc. in the projectile render path.
  **Verify** hostile projectiles are included in the AOI filter (they are — same array).
- **Monster telegraphs:** to render wind-ups/casts/fuses in co-op, **add the needed
  timers to the monster whitelist** in `snapshotFor` (e.g. `castT`, `windupT`, `fuseT`,
  or a single compact `tel` field). This is the deliberate netcode edit. Keep it minimal
  — one or two rounded numbers. Update `js/net.js` render consumers if they read them.
- **Behavior tag** does not need to be on the wire if the client can derive telegraph
  visuals purely from the timer fields + `type`. Prefer that (less wire, `type` already
  sent).

### Tests

- `test/entities.test.js` / a new `test/behaviors.test.js`:
  - each behavior tag is honored: a `ranged` monster at distance fires a projectile into
    `state.projectiles` with `hostile` set; an `exploder` damages a nearby player on
    fuse expiry; a `charger` covers ground on its dash; a `summoner` adds minions up to
    its cap and no further.
  - **hostile projectiles damage players, never monsters**, and respect `dodgeT` and
    defense (mirror assertions from `test/dodge.test.js`).
  - determinism: same seed ⇒ same summon/fire pattern (guards `state.srand()` usage).
- **Netcode tests** (`test/netplay.test.js` / `test/protocol.test.js` /
  `test/authority.test.js`):
  - a hostile projectile survives a `snapshotFor` → client-interp round-trip and is
    drawn (no throw).
  - the added monster telegraph fields appear in the snapshot and interpolate.
  - `authority.test.js` still passes — `js/game/` must not import `js/assets.js`; new
    behavior code stays presentation-free.
  - fuzz/soak (`test/fuzz.test.js`, `test/soak.test.js`) still green with the new entity
    kinds in the corpus.

**Manual verify:** host a co-op room (per README), confirm a client sees a caster's
telegraph and its bolt, an exploder's fuse, a charger's dash, and a summoner's minions —
and that they damage the *player*. Commit: `feat(enemies): ranged/exploder/charger/
summoner behaviors + hostile projectiles (solo + co-op)`.

> **Solo-first fallback:** if the netcode round-trip proves fiddly, ship behaviors
> **solo-only first** — everything in `js/game/` works offline immediately; gate the
> snapshot whitelist edit + client telegraph draw into a small follow-up commit. The
> behaviors themselves are identical; only the *rendering of telegraphs for remote
> monsters* is deferred. (This mirrors the "Behaviors but solo-only first" option.)

---

## Phase 5 — Balance, drop wiring, docs & polish

**Outcome:** the expanded content is *tuned*, discoverable, and documented.

- **Drop tables:** confirm new weapon kinds/bases and armor bases flow through
  `Items.makeItem`'s slot/kind rolls at sane rates; adjust `rollSlot`/kind weighting if
  a category is over/under-represented. New affixes appear at intended rarities.
- **Monster pool balance:** tune `weight`/`minFloor`/stats in `Balance.monsters` so each
  floor band has a readable mix and the new behaviors arrive at fair depths (casters not
  before the player can dodge-roll reliably, etc.). Sanity-check with
  `test/balance.test.js` and the `tool/balance-report.mjs` output.
- **Regenerate `BALANCE.md`:** `node tool/balance-report.mjs > BALANCE.md` so the balance
  sheet reflects every new entry (the report is the human-readable mirror of
  `balance.js`).
- **Sell/buy/upgrade values:** verify `sellPrice`/`buyPrice`/`upgradeCost` behave for new
  bases and kinds (they key off `slot`/`rarity`/`ilvl`/`plus`, so should just work —
  add a coverage assertion).
- **Full-suite + smoke/soak** green; update `README.md`'s feature blurb if it enumerates
  content counts.

Commit: `feat(balance): tune expanded content, wire drops, regenerate BALANCE.md`.

---

## Cross-cutting rules (every phase)

1. **Test-first, suite stays green.** Baseline 337 tests; each task adds tests and never
   leaves a red suite. `node --test test/*.test.js` after every task.
2. **Procedural visuals only.** No new asset files; `js/assets.js` and
   `assets/manifest.json` are untouched. `test/authority.test.js` (js/game ↛ assets)
   must stay green.
3. **Determinism in generation.** Seeded `state.srand()` / stable naming only; never
   `Math.random()` in generation or sim. (`Math.random()` stays allowed in client-local
   particle/render cosmetics.)
4. **No new equipment slots.** `Items.EQUIP_SLOTS`, the save blob
   (`server/character.js` ↔ `Save.snapshot`), the equip UI, and the player snapshot
   stay shape-compatible. An explicit test pins `EQUIP_SLOTS`.
5. **Backward-compatible data.** New fields on items/monsters are additive and optional;
   render/aggregate code falls back gracefully so existing localStorage saves and stored
   characters still load.
6. **Netcode edits are minimal and whitelisted.** Only Phase 4 touches
   `server/room.js#snapshotFor`, and only to add a couple of rounded telegraph numbers.

## Risks & mitigations

- **Snapshot bloat / desync from new monster fields** → keep telegraph state to one or
  two rounded numbers; lean on existing `lerpList` id-matching; cover with a round-trip
  test. Fall back to solo-first if needed.
- **Hostile-projectile friendly-fire bugs** (hitting monsters, or mis-crediting kills) →
  fixed `dmg` at spawn + a hard `hostile`/target split in `updateProjectiles`, pinned by
  tests asserting hostile projectiles never touch monsters.
- **Visual overload / unreadable floors** → Phase 5 balance pass gates behaviors by
  `minFloor`; procedural bodies reuse the shared silhouette scaffolding so they stay
  legible at game zoom.
- **Save compatibility** → additive optional fields + render fallbacks; a load test
  against a pre-expansion save blob.
