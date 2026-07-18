# Main Quest — Acts, Act Bosses & the Final Boss

> Spec: `docs/superpowers/specs/2026-07-16-dungeon-browser-design.md`
> Predecessor: the multiplayer roadmap (Phases 0–5) is **landed and closed**. This is the
> first phase of *content* work rather than netcode, and the first plan that is not part
> of that roadmap.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the full
> `node --test test/*.test.js` suite green. Browser-only tasks (banners, codex-free notice
> board lines, boss telegraph rendering) add a manual verification step against a live
> server instead of a node test.

**Goal:** Give the dungeon a spine. Today the game is an endless descent with an
interchangeable brute every second floor and a 5-entry name list that runs dry at floor 10.
After this phase the run is a **six-act main quest**: each act is one dungeon theme, ends
in a named Act Boss with its own fight mechanics, and the sixth ends at floor 24 against
the final boss — a real ending the player can reach and beat.

**Architecture:** Three separable layers, in dependency order.

1. **A behavior layer** (`js/game/behaviors.js` + a minimal `js/game/status.js`). Today
   `G.monsterUpdate` is one uniform chase-and-melee with no per-type dispatch and there is
   no status-effect system anywhere. This is the load-bearing change and the bulk of the
   work — but it is *generic*, not boss-specific, and elite/caster regular monsters fall
   out of it later for free.
2. **A boss content layer** (`js/bosses.js`, new; pure and node-testable like `quests.js`).
   A table of six acts — name, theme, boss floor, behavior set, phase thresholds, loot.
   `E.makeBoss` stops being "scaled brute + name from an array" and consults this table.
3. **A quest-state layer** (extends `js/quests.js`). A `main` quest kind living at
   `player.mainQuest`, advanced by act-boss kills, surfaced through the existing HUD,
   notice board, and floor-entry banner. No new UI panels, no dialogue system.

**Structure — one act per theme.** Themes already rotate every 4 floors, so acts inherit a
distinct look for free. Act-boss floors are a **subset of the existing `floor % 2 === 0`
arena floors**, so the arena generator needs a tier flag, not new placement logic. Odd
arena floors (2, 6, 10, 14, 18, 22) keep today's unnamed generic guardian as a miniboss.

| Act | Floors | Boss floor | Miniboss floors |
| --- | --- | --- | --- |
| I — the Crypts | 1–4 | **4** | 2 |
| II — the Caverns | 5–8 | **8** | 6 |
| III — the Warrens | 9–12 | **12** | 10 |
| IV — the Deep | 13–16 | **16** | 14 |
| V — the Under-Deep | 17–20 | **20** | 18 |
| VI — the Sanctum | 21–24 | **24 (FINAL)** | 22 |

**Co-op model — per-character.** `player.mainQuest` lives on the hero and rides in the save
blob, matching how `state.quests` and `Save.snapshot` already work; `server/character.js`
already persists a `quests` field, so the storage path exists. A guest who helps kill an act
boss banks that act on *their* character and keeps it when they leave. Consequence accepted:
a party can be at mixed acts, so the floor-entry banner is driven by **the local player's**
act, not the room's.

**Deliberately NOT in this phase:**
- **Lore items / codex panel.** Narrative is flavor text on surfaces that already exist
  (act banner, notice board line, quest entry). No new item kind, no new UI panel.
- **Dialogue, cutscenes, NPC conversation trees.** Grizzle and the notice board stay
  one-liners.
- **Post-24 content.** Beating the final boss shows a victory screen and unlocks continued
  descent (floors 25+ stay generated, minibosses only, no further acts). "New Game+",
  scaling past 24, and an endless-mode leaderboard are a later concern — Task 9 only
  guarantees the run does not break when you walk down the stairs at floor 24.
- **Room-shared quest state.** Explicitly rejected above; do not add main-quest fields to
  `Room.snapshotFor` beyond what Task 8 needs for rendering other players' boss telegraphs.
- **Rebalancing the existing 6 regular monster archetypes.** Act bosses may *summon* them
  but their stats are untouched.

**Tech Stack:** Plain browser JS + `node --test`. No new dependencies; client stays
zero-build. Every new module is a dual-mode IIFE (browser global + `require`-able) and gets
registered in `index.html` in load order, matching every existing module.

## Global Constraints

- The full suite passes after **every** task. New sim rules arrive test-first.
- **Determinism is non-negotiable.** `D.generateDungeon(seed, floor)` is pure and the Phase 0
  same-seed replay test pins it. Boss behavior must draw randomness from `state.srand()`
  only — never `Math.random()` — or replays and server/client agreement break.
- **Solo and co-op must both stay correct.** Every new rule degrades to today's behavior at
  `state.players.length === 1`. Party scaling (`E.partyHpMult`/`partyXpMult`) applies to act
  bosses exactly as it does to the current boss.
- **A character with no `mainQuest` field must load cleanly** — old localStorage saves and
  old Postgres blobs both predate this phase. `Game.fromSave` and `server/schema.js` derive a
  fresh act-I state rather than rejecting the character.
- `server/schema.js` silently drops unlisted fields. Any new persisted field must be added
  there or it will vanish on the next server save — check this explicitly in Task 7.
- **`BALANCE.md` is generated** from `balance.js` via `tool/balance-report.mjs`. Regenerate it
  in any task that adds a balance knob.

---

### Task 0: Branch

**Files:** none (branch only).

Cut a worktree off the agreed base branch. Confirm `node --test test/*.test.js` is green
before the first change — the baseline is what every later task is measured against.

---

### Task 1: Status effects (`js/game/status.js`)

**Files:** `js/game/status.js` (new), `js/balance.js`, `js/game/combat.js`, `index.html`,
`test/status.test.js` (new).

The smallest layer that makes telegraphed attacks readable. Three effects, applied uniformly
to players *and* monsters so a boss can slow you and your Nova can slow a boss:

- `slow` — multiplies effective move speed for a duration.
- `stun` — suppresses attack and movement input for a duration.
- `burn` — damage over time at a tick rate.

Model it on the one existing gradual-effect precedent: `healPool`/`healRate`, which potions
and Prayer already use. Store as `ent.status = { slow: {t, mag}, ... }` and advance it from a
single `G.statusUpdate(state, ent, dt)` called at the top of both the player update and
`G.monsterUpdate`. Keep it data-only and pure enough to unit-test without a dungeon.

Wire the *readers*, not just the writers: `Entities.effectiveStats` must fold `slow` into
`moveMult`, and the attack paths must respect `stun`. A status layer nothing reads is the
classic way this task passes its tests and does nothing in the game.

**Verify:** node tests for stacking (refresh vs. add — pick refresh-longest, document it),
expiry, burn tick accounting, and that a stunned entity neither moves nor attacks.

---

### Task 2: Behavior dispatch (`js/game/behaviors.js`)

**Files:** `js/game/behaviors.js` (new), `js/game/ai.js`, `index.html`,
`test/behaviors.test.js` (new).

Add the seam. In `G.monsterUpdate` (`js/game/ai.js:21`), after the shared preamble
(timers, knockback decay, aggro check), dispatch:

```js
if (m.behavior && G.BEHAVIORS[m.behavior]) return G.BEHAVIORS[m.behavior](state, m, dt, ctx);
```

where `ctx` carries the already-computed `{p, stats, dist, flow, flowDist, mr}` so a behavior
never recomputes the flow-field lookup. Monsters with no `behavior` field take today's path
**byte-for-byte** — that is the regression test for this task.

Extract the current chase-and-attack body into `G.BEHAVIORS.melee` and make the default
delegate to it, so there is exactly one chase implementation rather than a copy that drifts.

Ship these behaviors:

- **`slam`** — wind-up telegraph (`m.telegraphT`, a broadcast state so the renderer can draw
  it), then a radial AoE at the telegraphed position. Dodgeable by leaving the circle, which
  is what makes it a fight rather than a damage race.
- **`caster`** — keeps distance, lobs projectiles into `state.projectiles` exactly as
  `combat.js` does. The first ranged monster in the game.
- **`summon`** — spawns adds from the existing archetype pool at phase thresholds, capped.

**Verify:** each behavior gets a headless node test driving `stepFixed` on a synthetic state.
Critically: a test that a no-`behavior` monster produces an identical position/HP trace to the
pre-change implementation over N ticks.

---

### Task 3: Boss phases

**Files:** `js/game/behaviors.js`, `js/entities.js`, `js/game/combat.js`,
`test/bossphase.test.js` (new).

Phases are HP-threshold transitions on the boss entity: `m.phases = [{at: 0.66, ...}, {at: 0.33, ...}]`,
each naming a behavior and optional one-shot on-entry effect (summon a wave, a shockwave, a
speed buff). `hitMonster` in `js/game/combat.js` is the single place HP drops, so evaluate
transitions there — not in the AI tick — so a phase can never be skipped by a burst that
crosses two thresholds in one frame. Fire each threshold **at most once** and in order.

**Verify:** a boss taking a single lethal-adjacent hit from 100% to 20% must pass through both
transitions' on-entry effects, once each. This is the bug this task exists to prevent.

---

### Task 4: The act table (`js/bosses.js`)

**Files:** `js/bosses.js` (new), `js/balance.js`, `js/entities.js`, `index.html`,
`test/bosses.test.js` (new), `BALANCE.md` (regenerate).

A pure module in the shape of `quests.js`. `Bosses.ACTS` is the six-entry table above: act
number, title, floor range, boss floor, boss name, behavior + phase spec, stat multipliers,
loot spec, and the flavor lines Task 6 reads.

Then:
- `Bosses.actForFloor(floor)` → the act a floor belongs to (`null` past 24).
- `Bosses.bossForFloor(floor)` → the act-boss spec, or `null` if the floor is a miniboss arena.
- `E.makeBoss(floor, partyN)` (`js/entities.js:146`) consults it: an act-boss floor builds the
  named boss with its behavior and phases; every other `floor % 2 === 0` floor keeps today's
  generic guardian. Retire the `BOSS_NAMES` 5-entry array — generic minibosses get a
  deterministically generated name from the same generator champions already use.

Stats scale from a `Balance.bosses` table keyed by act, sitting alongside the existing
`Balance.boss` (which stays as the miniboss baseline). Keep party scaling applied on top,
unchanged.

**Verify:** act/floor mapping is exhaustive and total for floors 1–30; boss determinism for a
given `(floor, partyN)`; every act's phase spec names a behavior that actually exists in
`G.BEHAVIORS` (a table-driven test — this catches typos in content data, which is where they
will actually happen).

---

### Task 5: Main quest state (`js/quests.js`)

**Files:** `js/quests.js`, `js/game/town.js`, `js/game/combat.js`, `js/game/state.js`,
`test/quests.test.js`, `test/mainquest.test.js` (new).

Extend the existing quest module rather than forking a parallel system:

- Add `'main'` to `Quests.KINDS` and whitelist it in `Quests.fromSave`, `Quests.key`,
  `Quests.progressText`, and `Quests.fraction` — all four branch on kind and all four will
  silently mishandle an unknown kind otherwise.
- `Quests.makeMain(act)` builds the act's quest object from `Bosses.ACTS`.
- `Quests.recordBossKill(mq, monster, floor)` advances it, mirroring `recordKill`'s
  "return true if it moved" contract so the caller can announce once.
- The main quest does **not** occupy one of the 3 charter slots — it lives at
  `player.mainQuest`, not in `state.quests`.

Wire progress at the site that already exists: `killMonster` (`js/game/combat.js:299`)
already emits `{type:'kill', boss:true}`. Call the main-quest stepper from the same funnel
`G.questProgress` uses (`js/game/town.js:270`), so completion announcements go through one
path. Kill credit follows the existing XP `shareRange` rule — if you were close enough to
earn XP from the boss, you banked the act.

**Verify:** killing the act-IV boss while on act III does not skip act III; killing an act
boss twice (replay a floor) does not double-advance; a `main` quest survives a
`fromSave` round trip.

---

### Task 6: Presentation — banner, notice board, HUD

**Files:** `js/game/state.js`, `js/game/town.js`, `js/ui/draw.js`, `js/render/monster.js`,
`test/ui.test.js`.

- **Act banner** on floor entry, reusing the existing fade banner in `G.makeFloorState`
  (`js/game/state.js:8`). Shows the act title on the first floor of each act; on a boss floor
  it names the boss instead.
- **Notice board line** in town, chosen from the current act's flavor set in `Bosses.ACTS` and
  reacting to `player.mainQuest`. Pure derivation → unit-testable; no new UI surface.
- **Main quest entry** pinned above the charter in the existing quest HUD, visually distinct.
- **Boss telegraph rendering** — `slam`'s wind-up circle must be drawn in `js/render/`, or the
  mechanic is invisible and reads as unfair damage. Extend the boss health bar
  (`js/ui/draw.js:58`) with the boss name and phase pips.

**Verify:** node tests for the pure derivations (which banner, which board line, given act +
floor). Manual browser check for the telegraph, the banner, and the health bar.

---

### Task 7: Persistence — three places that must agree

**Files:** `js/save.js`, `js/game/state.js`, `server/character.js`, `server/schema.js`,
`test/save.test.js`, `test/charschema.test.js`, `test/persistence.test.js`.

`player.mainQuest` must round-trip through **all three** storage paths, and they must agree:

1. `Save.snapshot` (`js/save.js`) — add the field to the localStorage blob.
2. `Game.fromSave` (`js/game/state.js`) — restore it, **deriving a fresh act-I state when the
   field is absent** (every existing save).
3. `server/character.js` `characterBlob`/`playerFromCharacter` **and** `server/schema.js`
   `validateCharacter` — the schema is a whitelist and will silently drop an unlisted field.

The failure mode this task guards against is asymmetric: a field that saves locally but is
stripped server-side means online players lose main-quest progress on every reconnect, with
no error anywhere. Test it as a round trip through the real schema validator, not a shape
assertion on the blob.

**Verify:** a pre-phase save blob (fixture, no `mainQuest`) loads and lands on act I;
a mid-quest character survives snapshot → validate → load with its act intact.

---

### Task 8: Co-op — stop hardcoding quests to empty

**Files:** `js/net.js`, `server/room.js`, `test/netplay.test.js`, `test/room.test.js`.

`js/net.js:518` currently hardcodes `questing: false, quests: [], milestones: []` in the
online render state, and `Room.snapshotFor` never sends quest data — which is why quests are
solo-only today. The local player's own main quest and charter must reach their own client.

Scope discipline: send **the receiving player's own** quest state in their snapshot. Do not
broadcast every player's quest state to everyone — it is per-character by design, it is not
needed to render anyone else, and it would grow every snapshot for nothing.

Separately, boss `telegraphT`/phase **do** need to be in the monster snapshot so all four
clients can see and dodge the wind-up.

**Verify:** a two-client room test where each client sees its own act and not the other's;
an AOI test that boss telegraph state reaches every client in range.

---

### Task 9: The final boss and the ending

**Files:** `js/bosses.js`, `js/game/town.js`, `js/ui/`, `test/mainquest.test.js`,
`test/depth.test.js`.

The floor-24 boss is the only one with a multi-stage phase ladder (4 phases) and should
combine all three behaviors rather than introduce a fourth. Killing it:

- completes the main quest and marks the character a victor (persisted — see Task 7's
  paths; this is a second field and needs the same three-way treatment);
- shows a victory screen;
- **leaves the run playable.** `G.descend` past 24 must keep working: floors 25+ generate
  normally, `Bosses.actForFloor` returns `null`, arena floors produce generic minibosses, and
  no code path assumes an act exists. This is the regression risk of the whole phase — every
  `actForFloor` caller needs a null branch.

**Verify:** descend to floor 30 headlessly with no act defined and assert no throw; victory
flag round-trips; the main quest reports complete rather than rolling over to act VII.

---

## Open Questions

1. **Death mid-quest.** Death currently calls `Save.clear()` — the run is roguelike and the
   character is gone. Does main-quest progress die with the character (pure roguelike) or
   persist across runs on the account (metaprogression)? This changes what "reach floor 24"
   costs and should be settled before Task 5, since it decides whether `mainQuest` lives on
   the character blob or one level up on the account.
2. **Act-boss skipping.** Stairs are pushed to the arena's edge but the boss is not gated —
   a fast player can run past. Should act-boss arenas get a gate that locks until the boss
   dies? That is a dungeon-generation change (a new tile) and is currently out of scope, but
   without it the "main quest" is optional in practice.
3. **Miniboss identity.** With named act bosses every 4 floors, do the odd-floor generic
   guardians still earn their arena, or should `floor % 2` become `floor % 4` and make every
   arena an act boss? Fewer, bigger fights may read better.
4. **Difficulty curve to 24.** The current XP curve (`100 * level^1.62`) and floor scaling
   were never tuned for a 24-floor run with a defined end. Task 4 sets act boss stats blind;
   expect a tuning pass once the run is playable end to end.

---

## Task Order & Parallelism

Tasks 1 → 2 → 3 are a strict chain (status → dispatch → phases). Task 4 depends on 2 and 3.
Tasks 5, 6, 7 depend on 4 but are independent **of each other** and can run in parallel
worktrees. Task 8 depends on 7. Task 9 is last.
