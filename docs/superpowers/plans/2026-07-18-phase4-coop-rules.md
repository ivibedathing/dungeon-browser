# Phase 4 — Co-op Rules & Party UX Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Roadmap: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md`
> Predecessor: Phase 2 (client netplay) landed 2026-07-18. Phase 3 (accounts &
> server saves) is in flight on `phase3-accounts-saves` and **unmerged**; the
> dependency graph is 2 → 4, so this phase builds on `main` (Phase 2), not Phase 3.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the
> full `node --test test/*.test.js` suite green; browser-only tasks add a manual
> verification step against a live server instead of a node test.

**Goal:** Turn the "everyone's in one room and can see each other" of Phase 2 into an
actual co-op *game*: monsters that scale to the party, kills that pay every nearby
hero, loot that belongs to the player who earned it, downed players who can be revived
instead of instantly ending the run, a descent the party takes together, and a HUD that
shows the party. Solo play stays byte-for-byte the offline game it is today.

**Architecture:** Phase 4 is mostly *sim* work in `js/game/` + `js/entities.js` +
`js/balance.js`, projected out through `server/room.js`'s `snapshotFor`, and consumed by
`js/net.js` + `js/ui/` on the client. The load-bearing change is making the combat path
**attacker-aware** — `playerAttack`/`castSkill`/projectiles/`killMonster` currently
assume `state.player`, so today only `players[0]` can fight. Once the acting player is
threaded through, per-member XP (Task 3) and per-owner loot (Task 4) fall out naturally.
The second structural change is **per-player bags** (`p.bag`), with `state.bag` kept as an
alias of `state.player.bag` so all solo/town/inventory code is untouched.

**Deliberately NOT in Phase 4** (owned elsewhere):
- **Accounts, persistence, character load/save** — Phase 3. Phase 4 online heroes remain
  *fresh starters* (empty bag, 0 gold, level 1) built per room, exactly as Phase 2 left
  them. Per-player bags here are live-only; Phase 3 reconciles them with stored characters
  when it merges (both phases touch `Room.join`/`state.bag` — expect a merge there).
- **Per-player quests.** The notice-board charter stays a single shared charter tied to
  the local player (`state.quests`); kill credit for quests is unchanged. Per-player
  quests are a later concern.
- **New client→server intents / any client authority.** Descent (stand-on-stairs
  countdown) and revive (proximity) are derived server-side from existing `input`; no
  `descendVote`/`revive` message is added. The client stays a renderer.
- **Separate per-player town instances.** One room = one shared floor / one AOI world
  (the descent design depends on this). Portals become party-travel + owner-tagged, not
  independent town instances (see Task 6 and Open Questions).

**Tech Stack:** Plain browser JS + `node --test`. No new client dependencies; `ws`
(and, post-Phase-3-merge, `pg`) stay server-only. Client stays zero-build.

## Global Constraints

- The full suite passes after **every** task. New sim rules arrive test-first as node
  tests; browser-only UX (party bar, minimap dots, banners) gets a manual step plus a
  light node test for any pure layout/derivation helper.
- **Solo play must be indistinguishable before/after.** Solo is a 1-player room
  (`state.players.length === 1`). Every co-op rule degrades to today's behavior at n=1:
  party multipliers = 1, `state.bag` aliases `state.player.bag`, loot is unowned, a solo
  death ends the run immediately (no self-revive), descent is instant (no countdown). A
  regression test pins each degrade path; the Phase 0 same-seed replay test (solo) stays
  green.
- Online mode still never writes localStorage; the server owns online state.
- The claude.ai artifact stays offline-only.

---

### Task 0: Branch

**Files:** none (branch only).

- [ ] Worktree `../dungeon-browser-phase4` on branch `phase4-coop-rules`, based on `main`
  at the Phase 2 merge (`19feb0c`). All Phase 4 commits land here; **merge to `main`** on
  exit (per the base decision — Phase 3 lands independently and reconciles the bag seam).
- [ ] **Confirm green baseline:** `node --test test/*.test.js 2>&1 | tail -3` → `pass 210`.

---

### Task 1: Party monster scaling

**Why:** The roadmap's headline co-op rule and the cheapest to pin: constants in
`balance.js`, pure math in `entities.js`, tests that lock the multipliers.

**Files:**
- Modify: `js/balance.js` (new `coop` block), `js/entities.js` (`partyHpMult`/`partyXpMult`,
  `makeMonster`/`makeBoss` take `partyN`), `js/game/state.js` (`makeFloorState` samples
  `state.partyN`), `server/room.js` (maintain `state.partyN`; regenerate the pristine
  entry floor on join).
- Test: `test/balance.test.js` (wiring), `test/entities.test.js` or new `test/coop.test.js`
  (scaling math), `test/room.test.js` (party-N sampling).

**Interfaces:**
- `Balance.coop = { partyMax: 4, hpPerPlayer: 0.5, xpPerPlayer: 0.35, /* Task 4/5 add loot & revive knobs */ }`.
- `Entities.partyHpMult(n) = 1 + coop.hpPerPlayer*(n-1)`; `partyXpMult(n) = 1 + coop.xpPerPlayer*(n-1)`.
- `Entities.makeMonster(type, floor, champion=false, partyN=1)` scales `hp`/`maxHP` by
  `partyHpMult(partyN)` and `xp` by `partyXpMult(partyN)`. `makeBoss(floor, partyN=1)`
  likewise. **n=1 ⇒ ×1 ⇒ byte-identical to today** (default arg keeps every existing
  caller and test unchanged).
- `makeFloorState(state)` reads `const n = state.partyN || state.players.length || 1` and
  threads it into every `makeMonster`/`makeBoss` call.
- **When is n sampled?** At floor generation, and locked for that floor. The room owns it:
  `Room` sets `state.partyN` on join/leave, and when the party size changes *while the
  current floor is still pristine* (no kills, all monsters at full HP, no player damaged)
  it re-runs `makeFloorState` so the entry floor scales to the assembled party. Once a blow
  has landed, the floor is locked; late joiners get the current (already-scaled) floor.
  (Rationale + the rejected "rescale live HP mid-fight" alternative → Open Questions.)

- [ ] **Step 1: Failing tests** — (a) `makeMonster('bat',1,false,4).hp` ≈ `makeMonster('bat',1).hp * 2.5`
  and `.xp` ≈ base `* 2.05`; n=1 is identical to the no-arg call. (b) A `Room` with 4 seats
  filled *before any kill* has 4-scaled floor-1 monsters; killing one then seating a 4th
  leaves the survivors' HP untouched (locked). (c) `balance.test.js` pins `Balance.coop`
  wiring rather than magic numbers.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Keep default args so solo/existing callers are untouched.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit:
  `feat(coop): party-scaled monster HP/XP with pristine-floor sampling`

---

### Task 2: Attacker-aware combat

**Why first among the combat tasks:** `playerAttack(state)`, `castSkill(state, idx)`,
`explode(state, pr)`, and `killMonster(state, m, stats)` all read `state.player`. In a
party the update loop already iterates every player, but every attack is credited to
`players[0]`. Per-member XP (Task 3) and per-owner loot (Task 4) both need to know *who*
swung and *who* landed the kill. Thread the actor through; add no behavior.

**Files:**
- Modify: `js/game/combat.js` (`playerAttack(state, p)`, `castSkill(state, p, idx)`,
  `explode` resolves owner via `pr.ownerId`, `hitMonster` carries `attacker`,
  `killMonster(state, m, stats, killer)`), `js/game/update.js` (call sites pass the
  iterated `pl`).
- Test: `test/netplay.test.js` or `test/coop.test.js`.

**Interfaces:**
- `G.playerAttack(state, p = state.player)` — melee arc / projectile spawn use `p`, not
  `state.player`; projectiles already carry `ownerId` — set it from `p.id`.
- `Game.castSkill(state, p, idx)` — mana/cooldown/skills read from `p`; whirlwind/nova/prayer
  act around `p`. (Legacy `castSkill(state, idx)` call sites in `update.js` become
  `castSkill(state, pl, i)`.)
- `explode(state, pr)` — attacker stats come from the projectile's owner
  (`state.players.find(id===pr.ownerId)`), falling back to `state.player` when the owner
  has left. Damage/kb unchanged.
- `killMonster(state, m, stats, killer)` — `killer` is the player credited (lifePerKill
  heal, loot ownership in Task 4). XP distribution moves to Task 3.

- [ ] **Step 1: Failing tests** — two players in one state, both issue `space`; assert both
  arcs deal damage to a monster each faces (today only `players[0]`'s would); a projectile
  fired by `players[1]` carries `ownerId === players[1].id` and its kill credits `players[1]`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Thread the actor through. **Solo call path unchanged** via default arg;
  `test/room.test.js`/`smoke` are the safety net for the extraction.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit:
  `feat(coop): thread the acting player through attacks, skills, and kills`

---

### Task 3: Per-member XP + kill credit

**Files:**
- Modify: `js/game/combat.js` (`killMonster` XP distribution + per-player level-up juice),
  `js/balance.js` if an XP-range constant is wanted (reuse AOI otherwise).
- Test: `test/coop.test.js`.

**Interfaces:**
- On a kill, **every living player within XP range of the monster** gains the full
  `Math.round(m.xp * effectiveStats(pl).xpMult)` (each hero's own `xpMult` applies).
  Range = a `Balance.coop.xpRange` (default = `Room.AOI_RADIUS` in world units) so it
  matches "within AOI of the kill" from the spec. Solo: the one player is always in range
  ⇒ identical to today.
- Level-up floaty/message/burst/sfx fire **per player who levels** (not just `state.player`),
  positioned at that player. `Save.updateRecords`/`G.save` stay guarded on the local player
  (online skips saves; solo saves as before).
- `lifePerKill` heals the **killer** only (Task 2's `killer`), matching a "you kill, you
  leech" reading; document the choice.

- [ ] **Step 1: Failing tests** — kill a monster with two living players in range → both
  `xp` increase by the scaled amount; move one player far away → only the near one gains.
  A kill that levels a non-`players[0]` player emits a `levelup`-flavored event/juice for
  *that* player (assert via `state.events`/floatTexts owner position).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement the in-range loop.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(coop): full XP to every in-range party member`

---

### Task 4: Instanced loot, per-player bags, pickup validation

**The big one.** Drops become per-owner; bags become per-player; pickup checks ownership.

**Files:**
- Modify: `js/game/combat.js` (`dropLoot` rolls per in-range player, tags `ownerId`),
  `js/game/state.js`/`js/entities.js` (`p.bag`; `state.bag` alias), `js/game/inventory.js`
  + `js/game/town.js` (bag references → the acting player's bag; `tryPickup(state, p)`),
  `js/game/update.js` (gold magnet + pickup use `pl.bag`), `server/room.js`
  (`snapshotFor` filters `groundItems` by ownership; `self.gold` from `me.bag.gold`),
  `js/net.js` (render-state `bag`/`gold` already per-`self`; ground-item owner is
  pre-filtered server-side so no client change beyond rendering everything it receives).
- Test: `test/coop.test.js`, `test/room.test.js` (owner filter), `test/items.test.js`
  (bag alias invariants), `test/save.test.js` (solo save/load bag unchanged).

**Interfaces:**
- **Per-player bag:** each player gets `p.bag = Items.createBag()` (online: fresh/empty).
  `state.bag` becomes an alias of `state.player.bag`, re-pointed in `syncLocalAlias` and
  after save-restore. All existing `state.bag` reads (vendor, smith, potion box, HUD) keep
  working for the local player untouched. Solo `Save.snapshot`/`fromSave` read/write
  `state.player.bag` via the alias — **no save-format change**, pinned by `save.test.js`.
- **Instanced drops:** `dropLoot(state, m, killer)` rolls **once per living player within
  loot range** of `m` (each roll independent, using `state.srand` in a fixed player order
  for determinism), pushing a ground item tagged `ownerId: pl.id`. Gold piles are owned too.
  Bosses shower per-owner. **Solo (n=1) ⇒ one unowned roll ⇒ identical drop behavior.**
  (`ownerId` omitted/`null` = shared/solo item, visible to and grabbable by anyone — the
  legacy path.)
- **Visibility:** `snapshotFor(id)` filters `groundItems` to `ownerId == null || ownerId === id`.
  A player never sees another's instanced drops.
- **Pickup validation:** `tryPickup(state, p)` and the gold-magnet loop only claim items
  with `ownerId == null || ownerId === p.id`; gold credits `p.bag.gold`. A hacked client
  can't grab a teammate's drop — the server owns the check.

- [ ] **Step 1: Failing tests** — (a) kill near 2 players ⇒ up to 2 ground items, one
  `ownerId` each; `snapshotFor(p0)` shows only p0's, `snapshotFor(p1)` only p1's; a shared
  (null-owner) item shows to both. (b) `tryPickup(state, p1)` refuses p0's item and accepts
  p1's; gold magnet routes to the right `bag.gold`. (c) Solo: one unowned drop; `state.bag`
  is `state.player.bag`; a save→load round-trips the bag identically (existing test still
  green). 
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement bag-per-player + alias, owner-tagged drops, owner filter,
  pickup validation. Keep the null-owner legacy path so solo is untouched.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; **manual solo check** (loot, pick up, gold, vendor buy/sell,
  potion belt all behave as before). Commit:
  `feat(coop): instanced per-owner loot, per-player bags, pickup validation`

---

### Task 5: Ghost / revive / respawn death rules

**Files:**
- Modify: `js/game/update.js` (down/revive/respawn in `updateWorld`; wipe condition),
  `js/balance.js` (`coop` revive knobs), `server/room.js` (`snapshotFor` players carry
  `down`/`respawnT`/`reviveT`), `js/net.js` + `js/ui/` (down/revive rendering — Task 7).
- Test: `test/coop.test.js`.

**Interfaces:**
- `Balance.coop` gains `{ reviveRadius, reviveTime, respawnTime: 10, respawnHpFrac: 0.5 }`.
- **Down, not dead (party only, n>1):** at `hp<=0`, a player enters `down` (`pl.down=true`,
  `pl.hp=0`, ghost at their spot), `pl.downT=0` counting up. They can't act; existing
  `!pl.dead` gates extend to `!pl.down`.
- **Revive:** a *living* player within `reviveRadius` of a downed ally for `reviveTime`
  (accumulated in `pl.reviveT`, reset when no reviver is near) clears `down` and restores
  `respawnHpFrac * maxHP`. Proximity-derived — **no client message**.
- **Respawn:** if `downT >= respawnTime` and the party is not fully wiped, the ghost
  respawns at the **floor entry** with `respawnHpFrac * maxHP`, `down` cleared.
- **Wipe / run end:** unchanged condition — `state.players.every(down-or-dead)` while
  simultaneously down ⇒ `state.dead`, save wipe (existing `update.js:313` logic, retargeted
  from `dead` to the down flag). **Solo keeps permadeath:** at n=1, a down *is* death
  immediately (no self-revive, no respawn) ⇒ today's behavior exactly.
- Terminology: keep `pl.dead` meaning "out of the run" (solo death / post-wipe); add
  `pl.down` for the revivable co-op state so nothing existing reinterprets `dead`.

- [ ] **Step 1: Failing tests** — 2-player state: drive one to `hp<=0` ⇒ `down`, not
  `state.dead`; park the ally within `reviveRadius` for `reviveTime` ⇒ revived at
  `respawnHpFrac`; alternatively let `downT` pass `respawnTime` alone ⇒ respawn at entry;
  down *both* simultaneously ⇒ `state.dead`. 1-player state: `hp<=0` ⇒ immediate
  `state.dead` (permadeath unchanged).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement in `updateWorld`; project `down`/`downT`/`reviveT` in snapshots.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(coop): downed ghosts, proximity revive, respawn, wipe-on-full-down`

---

### Task 6: Shared floor transitions — descent banner + party teleport (+ portals)

**Why:** Today one player touching the stairs calls `G.descend`, which rebuilds the floor
and **only repositions `players[0]`** (`makeFloorState` moves `state.player`) — other
players land on the new grid at stale coordinates. Descent must move the *whole party*, and
gains the spec's 10 s party banner.

**Files:**
- Modify: `js/game/update.js` (stairs → arm a descent countdown, not instant), `js/game/state.js`
  (`makeFloorState` fans **all** players around the entry, like `Room.join`), `js/game/town.js`
  (`descend` triggered by the countdown; `castPortal`/`travel` reposition the party & tag
  gates with `ownerId`), `js/balance.js` (`coop.descendCountdown`), `server/room.js` (project
  `state.descendT`/banner for the client).
- Test: `test/coop.test.js`, existing `test/waypoints.test.js`/`town` as safety net.

**Interfaces:**
- **Descent countdown (party only):** while ≥1 living player stands on the stairs tile,
  `state.descendT` counts down from `Balance.coop.descendCountdown` (10 s); at 0 (or instantly
  if *all* living players are on the stairs) `G.descend` runs. No one on the stairs ⇒ timer
  resets. **Solo (n=1) descends instantly** (countdown skipped) ⇒ current feel preserved.
- **Party teleport:** `makeFloorState` positions **every** player at the entry (reuse the
  `Room.join` fan so they don't stack). `descend` then repositions all; the shared floor
  invariant (one grid / one flow field / one AOI world) holds.
- **Portals — party-travel + owner-tagged:** any player (not just the host/`players[0]`) may
  cast a town portal; the gate is tagged `ownerId` for rendering, and travelling through
  moves the **whole party** to/from town (town is one shared instance in the room). This
  delivers "any player can portal" without the one-world-breaking cost of independent town
  instances (deferred — see Open Questions). Town service gating (`p === state.player`) stays
  local-player-only for now; multi-player vendor/smith is out of scope.

- [ ] **Step 1: Failing tests** — 2-player: one on stairs arms `descendT`; it doesn't
  descend until the countdown elapses (or both stand on stairs → instant); after descent
  **both** players are at the new floor's entry (distinct, non-stacked). 1-player: stepping
  on stairs descends immediately, positioned at entry (unchanged). A portal cast by
  `players[1]` produces an `ownerId`-tagged gate and, on travel, moves both players to town.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement countdown + party reposition + portal owner-tagging.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(coop): shared descent countdown, party teleport, party portals`

---

### Task 7: Party UX — bar, minimap dots, banners, join code

**Files:**
- Modify: `js/net.js` (expose `players[]` down/revive flags + `descendT` in the render
  state — mostly already flowing from Task 5/6 snapshots), `js/ui/hud.js` (party bar:
  names/HP/level/down state), `js/ui/core.js` or minimap draw (ally dots), `js/ui/menu.js`
  or `hud` (persistent join-code display for guests too), a descent-countdown banner.
- Test: manual (browser) + light node tests for any pure derivation/layout helper
  (e.g. a `partyRows(state)` selector).

**Interfaces:**
- **Party bar:** top-left stack of ally rows — name, HP bar, level, and a greyed/ghost
  treatment when `down`, a revive progress pip when `reviveT>0`. Reads snapshot `players[]`.
- **Minimap ally dots:** each party member drawn as a coloured dot (shirt tone) on the
  existing minimap; the local hero already marked.
- **Join code:** shown persistently in the online HUD (not just the host's Phase 2 banner)
  so any player can read/share it.
- **Descent banner:** a centered "Descending in N…" countdown while `descendT>0`, plus the
  existing floor title card on arrival.
- Down/ghost rendering: a downed ally draws as a ghost (Task 5 flag) rather than vanishing;
  the local player sees a "revive nearby ally" hint when in range.

- [ ] **Step 1:** Node test any pure helper (`partyRows`, `descentBannerText`). Build the UI.
- [ ] **Step 2: Manual verification** against a live server (`npm start`, 2 browser
  windows): party bar shows both heroes and updates HP; ally dot tracks on the minimap; the
  join code is visible to the guest; down one hero → ghost + party-bar ghost state, revive
  by proximity restores it; stepping on stairs shows the countdown banner and both descend
  together.
- [ ] **Step 3:** Full suite green (UI helpers only add node tests); commit:
  `feat(coop): party bar, ally minimap dots, join-code HUD, descent banner`

---

### Task 8: Exit proof — 4-bot floor clear + death/revive round-trip

**Files:**
- Test: `test/netplay.test.js` / `test/server.test.js` (integration), reusing the Phase 2
  real-`Net`-vs-real-server harness.

- [ ] **Step 1:** Integration test — 4 scripted ws clients join one room, the floor is
  party-scaled (assert monster HP), they cooperatively clear a floor (all reach the stairs,
  descent countdown fires, party teleports together), XP is credited to nearby members, and
  each client sees only its own instanced drops.
- [ ] **Step 2:** Integration test — a bot is driven to `hp<=0` → `down` (run not ended);
  another bot revives it by proximity; assert both alive and the run continues; then wipe
  both simultaneously → run ends. Round-trips over the wire.
- [ ] **Step 3:** Full suite green; commit: `test(coop): 4-bot floor clear and death/revive round-trip`

---

### Exit criteria (from the roadmap)

- 4 scripted bots clear a floor together in the integration harness; death/revive
  round-trips (Task 8).
- Monster HP/XP party scaling is constants-test-pinned; full XP reaches every in-range
  member; loot is instanced per owner with server-side pickup validation; downed players
  ghost/revive/respawn and the run ends only on a simultaneous full wipe; descent is a
  shared party teleport; the HUD shows the party (bar, dots, join code) and the descent
  banner.
- Solo play unchanged — every co-op rule degrades to today's behavior at n=1, pinned by
  regression tests and a manual solo pass.
- Full `node --test test/*.test.js` green throughout; new sim/UX logic arrived test-first.
- Then merge `phase4-coop-rules` → `main` and mark Phase 4 landed in the roadmap, with a
  crib for Phase 5 (hardening & deploy). Note the Phase 3 bag-seam reconciliation for
  whoever merges second.

## Open questions to resolve during implementation

1. **When party size is sampled for scaling.** Recommended: lock at floor generation,
   re-roll the *pristine* entry floor on join (Task 1). Rejected alternative: rescale live
   monster HP mid-fight on join/leave — jarring (a monster's bar jumps) and hard to make
   deterministic. If mid-run joins into an already-fought floor feel too easy/hard, revisit.
2. **Revive model.** Spec says "instant teammate revive within 3 s radius" — ambiguous
   between an instant proximity revive and a short channel. Plan uses a `reviveTime` channel
   (hold proximity) as the safer default; drop `reviveTime` to ~0 for instant if it feels
   clunky in the manual pass. Decide from feel.
3. **Per-player town instances.** Deferred: true independent town-while-others-fight breaks
   the one-shared-floor / one-AOI-world invariant the descent design relies on. Phase 4
   ships party-travel portals (any player initiates; the party moves together). If solo-town
   trips are desired mid-co-op, it needs a per-player sub-world — a larger design change.
4. **lifePerKill in a party.** Plan heals the killer only. Alternative: heal every in-range
   member (matches XP). Killer-only is simpler and avoids a party of leech-built heroes being
   unkillable; revisit if it feels bad.
5. **Bag seam with Phase 3.** Both phases touch `Room.join`/`state.bag`. Phase 4 (on main)
   introduces `p.bag` with `state.bag` aliasing the local player; Phase 3 loads a stored bag
   into the (currently shared) room bag. Whoever merges second reconciles: the natural end
   state is each seat's `p.bag` seeded from its loaded character. Flag it in the merge.
```
