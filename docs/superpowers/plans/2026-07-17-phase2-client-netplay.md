# Phase 2 — Client Netplay Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Roadmap: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md`
> Predecessor: Phase 1 (server skeleton & protocol) landed 2026-07-17.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the
> full `node --test test/*.test.js` suite green; browser-only tasks add a manual
> verification step in `verify.html` / a live server instead of a node test.

**Goal:** Let two or more browsers play one dungeon together over the Phase 1 server —
responsive local movement (client-side prediction + reconciliation), smooth remote
entities (100 ms snapshot interpolation), allies drawn on screen, and server events
driving the existing juice — while solo play stays byte-for-byte the offline game it
is today.

**Architecture:** One new client module, `js/net.js` (`window.Net`), owns the socket,
the outbound intent stream, the inbound snapshot buffer, prediction/reconciliation,
and an artificial-latency switch for testing. `js/main.js` gains a **mode**: SOLO runs
the local sim exactly as today; ONLINE skips the local world sim and instead renders a
**render-state** that `Net` assembles from interpolated snapshots, with only the local
player advanced by prediction. `Render.draw` is generalized to draw every player in
`state.players`, not just `state.player`. One small, pure movement helper
(`Game.predictMovement`) is extracted from the sim so the client predicts the local
player through the *identical* code the server steps it with — the precondition for
reconciliation to converge. A main menu (Play Solo / Host / Join by code) gates entry.

**What Phase 2 deliberately excludes** (later phases own these):
- **Inventory / vendor / smith / bag / equip while online.** Snapshots carry no bag or
  equipment, and the server has no character store yet — online inventory is meaningless
  until Phase 3 (server saves). Online mode disables the bag/tree/vendor UI; the HUD shows
  only what the snapshot carries plus a `self` block (Task 3). Solo inventory is untouched.
- **Party scaling, instanced loot, ghost/revive, party bar, minimap dots** — Phase 4.
- **Accounts, persistence, character select** — Phase 3.

**Tech Stack:** Plain browser JS + `node --test`. No new client dependencies (the socket
is the browser-native `WebSocket`). `ws` remains server-only.

## Global Constraints

- The full suite must pass after **every** task. Phase 2 adds node tests for the
  pure/logic parts of `net.js` (against a fake socket + injected clock) and for the
  generalized renderer; browser-only parts (menu, live play) get a manual step.
- Client stays zero-build: `js/net.js` is a plain `<script>` with a `typeof module`
  export guard for its node-testable core, like every other `js/*.js`.
- **Solo play must be indistinguishable before/after.** SOLO mode is the current code
  path, reached with zero network calls. A regression test pins that `Game.update`'s
  local movement is bit-identical to `Game.predictMovement` (Task 1).
- Online mode never writes localStorage (`Save.write` is a solo-only concern; the server
  owns online state). Guard the autosave and `beforeunload` paths on mode.
- The claude.ai artifact stays offline-only: the menu's Play Online path must fail
  gracefully (a clear "offline build" message) when `WebSocket` construction is blocked
  by CSP, never a dead UI.

---

### Task 0: Branch

**Files:** none (branch only).

- [x] Worktree `../dungeon-browser-phase2` on branch `phase2-client-netplay`, based on
  `main` at the Phase 1 merge. All Phase 2 commits land here; merge to `main` on exit.

- [ ] **Confirm green baseline:** `node --test test/*.test.js 2>&1 | tail -3` → `pass 191`.

---

### Task 1: Shared movement helper + prediction-convergence pin

**Why first:** prediction and reconciliation are the load-bearing risk of the whole
phase. If the client moves the local player through different code than the server, the
player will rubber-band on every snapshot. Extracting one helper and pinning it with a
test removes that risk before any socket code exists.

**Files:**
- Modify: `js/game/update.js` (extract the movement/dodge block of `updatePlayerActions`
  into `Game.predictMovement`; call it from both `updatePlayerActions` and — later — the
  client).
- Test: `test/netplay.test.js` (new; grows through Phase 2).

**Interfaces:**
- Produces: `Game.predictMovement(grid, p, input, dt, stats)` — advances **only** `p.x`,
  `p.y`, `p.facing`, and the dodge timers/`dodgeDir` for one player, using `G.moveCircle`
  and `MOVE_SPEED * stats.moveMult`. Pure w.r.t. the rest of the world (no attacks, no
  pickups, no world rebuild). Returns nothing; mutates `p`. Both the authoritative sim
  and the client predictor call it, so they can never diverge.
- Consumes: Phase 0 `Entities.effectiveStats`, `G.moveCircle`.

- [ ] **Step 1: Failing test** — assert that stepping a lone player with a right-held
  input through `Game.update` (monsters cleared) yields the same `x/y/facing` as calling
  `Game.predictMovement` directly for the same frames from the same start. Also pin dodge:
  a `pressed:['dodge']` edge sets `dodgeCdT>0` and moves along `dodgeDir`.

- [ ] **Step 2:** Run — FAIL (`Game.predictMovement` undefined).

- [ ] **Step 3:** Extract the movement/dodge lines (currently `updatePlayerActions` lines
  handling dodge trigger, roll-move, and WASD move+facing) into `Game.predictMovement`;
  have `updatePlayerActions` call it. Nothing else moves. **Server/Room behavior must be
  unchanged** — the extraction is a pure refactor; `test/room.test.js` and `netready`
  movement tests are the safety net.

- [ ] **Step 4:** Run — PASS.

- [ ] **Step 5:** Full suite (`pass 192`+), commit:
  `feat(net): extract Game.predictMovement so client and server move players identically`

---

### Task 2: `Net` core — snapshot buffer, interpolation, reconciliation (headless)

The socket-free heart of `net.js`, driven in node by a fake socket and an injected clock.
No browser, no real `WebSocket`.

**Files:**
- Create: `js/net.js` (`window.Net`; `module.exports` under the node guard).
- Test: `test/netplay.test.js`.

**Interfaces:**
- Produces `Net` with an injectable transport for testing:
  - `Net.connect(url, { WebSocketImpl, now })` — stores a socket (real or fake) and a
    clock; defaults to `window.WebSocket` and `performance.now`.
  - `Net.onServerMessage(msg)` — routes `welcome` / `snapshot` / `pong` / `error`.
    Buffers snapshots by `tick`, keeps the last ~1 s, records `welcome.seed`/`you`/`code`.
  - `Net.sendInput(input, nowMs)` — assigns the next `seq`, records it in an unacked ring,
    ships `Protocol`-shaped `{t:'input',seq,keys,pressed,mouse}` (pressed as an array),
    honoring the artificial-latency switch.
  - `Net.interpolatedAt(nowMs)` — returns entities positioned at `nowMs - INTERP_DELAY`
    (100 ms) by lerping between the two bracketing snapshots (nearest-clamp at the ends).
    Angles lerp shortest-arc. Entities present in only the newer snapshot pop in; ones
    only in the older fade out at their last position for one frame then drop.
  - `Net.reconcileLocal(predState, nowMs)` — sets the local player from the newest
    snapshot's `players[you]`, then re-applies every input still unacked (seq > `ack`)
    via `Game.predictMovement`, so the predicted position reflects the authoritative base
    plus in-flight moves. Updates `Net.lastAckedSeq`.
  - `Net.LATENCY_MS` (get/set) — artificial one-way delay applied to *both* send and
    receive in tests and the LAN RTT demo; 0 in production.
- Consumes: Task 1 `Game.predictMovement`; `Protocol` shape (client mirrors it without
  importing the server file — a tiny inline `EDGES`/`KEYS` allow-list, or it simply sends
  and trusts the server to validate. Prefer send-and-trust: the client isn't the security
  boundary).

- [ ] **Step 1: Failing tests** (fake socket records sent frames; `now` is a mutable
  number):
  - Two snapshots 100 ms apart with a monster at x=0 then x=100; `interpolatedAt` at the
    midpoint (accounting for `INTERP_DELAY`) returns x≈50.
  - Before two snapshots exist, `interpolatedAt` returns the only/último snapshot's
    positions (no crash, no NaN).
  - `sendInput` increments `seq` and records unacked; after a snapshot with `ack=3`,
    entries ≤3 are dropped from the unacked ring.
  - `reconcileLocal`: given a base snapshot putting the local player at x=100 and two
    unacked right-move inputs, the reconciled `predState` player x > 100 (moves replayed),
    and equals a direct double-`predictMovement` from x=100.
  - Angle interpolation across the ±π seam takes the short way (e.g. 3.0→-3.0 passes
    through ±π, not through 0).

- [ ] **Step 2:** Run — FAIL (`Net` undefined).

- [ ] **Step 3:** Implement `js/net.js`. Keep it transport-injected and clock-injected;
  the browser wiring (Task 4) supplies the real `WebSocket` and `performance.now`.

- [ ] **Step 4:** Run — PASS (run twice; interpolation math must be deterministic).

- [ ] **Step 5:** Full suite, commit:
  `feat(net): client Net core — snapshot interpolation, prediction, reconciliation`

---

### Task 3: Render every player + assemble the remote render-state

**Files:**
- Modify: `js/render/player.js` (`R.drawPlayer(ctx, state, p)` — take the player; default
  to `state.player` for the solo call site), `js/render/draw.js` (push every
  `state.players` entry into the painter-sorted `drawables`, not just `state.player`).
- Modify: `js/net.js` (`Net.buildRenderState(nowMs)`).
- Test: `test/netplay.test.js` (render-state shape); `test/render.test.js` (allies drawn).

**Interfaces:**
- `R.drawPlayer(ctx, state, p = state.player)` — same visuals; allies pass a lean player
  (snapshot fields: `x,y,facing,shirt,hp,maxHP,level,dead,swing,dodgeT,hurtT`, `equip`
  absent → the `eq.*` gear blocks simply skip, drawing the base cloaked body). A dead ally
  is not drawn (matches how the local dead player is skipped).
- `Render.draw` draws all non-dead `state.players`, painter-sorted by `y` with monsters.
- `Net.buildRenderState(nowMs)` — returns a **sim-shaped** object `Render.draw`/`UI.draw`
  can consume without ever having run the sim:
  - `dungeon`: `Dungeon.generateDungeon(welcome.seed, snapshot.floor)` — memoized per floor.
  - `players`: interpolated remote players + the **predicted** local player spliced in at
    its reconciled position; `player` alias = the local one.
  - `monsters`, `projectiles`, `groundItems`: from `interpolatedAt(nowMs)`.
  - `explored`: client-side fog recomputed from the local player via the existing
    `Dungeon.flowFieldMulti` seed (single source = me), so the veil/vignette still work.
  - `particles`, `floatTexts`, `messages`, `shake`: materialized locally by
    `Game.applyEvents` from the snapshot's `events` (juice is client-side; Phase 0 made
    the sim event-driven precisely for this).
  - `cam`: eased toward the local predicted player (reuse the lerp from `updateWorld`).
  - `time`: a locally advancing clock for sprite bob/animation.

- [ ] **Step 1: Failing tests** — (a) a headless `Render.draw` over a state with two
  `players` calls the player-draw path twice (spy/counter), and dead allies are skipped;
  (b) `Net.buildRenderState` returns an object with a `dungeon.grid`, a `player` alias
  equal to `players[youIndex]`, and finite `cam.x/cam.y` given one buffered snapshot.

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3:** Generalize `drawPlayer`/`draw`; implement `buildRenderState`. Verify the
  solo call path is unchanged (the default-arg keeps `Render.draw` solo behavior identical).

- [ ] **Step 4:** Run — PASS.

- [ ] **Step 5:** Full suite; **manual solo check** (open `index.html`, confirm the hero,
  gear, swing, dodge afterimages all render exactly as before). Commit:
  `feat(net): draw all party members and assemble the remote render-state`

---

### Task 4: Main menu + mode wiring in `main.js`

**Files:**
- Modify: `js/main.js` (mode state: `SOLO` | `ONLINE`; menu gates the frame loop),
  `js/ui/creation.js` or a new `js/ui/menu.js` (menu layout + draw), `index.html` (script
  tag if a new UI file), `css/style.css` (only if needed).
- Test: manual (browser); a light node test for any pure menu-layout helper.

**Interfaces:**
- A start menu shown before play: **Play Solo** (→ current flow: resume save or creation),
  **Host Game** (→ creation, then `Net.connect`, `join` with no code; on `welcome`, show
  the room code), **Join Game** (→ code entry field, then `Net.connect` + `join` with code).
- Mode lives in `main.js`. In ONLINE:
  - The frame loop calls `Net.sendInput(input, now)` each frame (held keys every frame,
    edges once), `Net.reconcileLocal` on each snapshot, and draws `Net.buildRenderState(now)`.
  - `Game.update` is **not** called on a world sim; only `Game.predictMovement` runs (inside
    reconcile/predict). Menu/bag/tree/vendor edges are ignored online (disabled UI).
  - `Save.write`, autosave, and `beforeunload` save are **skipped**.
  - On `error`/socket close, drop back to the menu with a message (`no_room`, `room_full`,
    `rate_limit`, or a generic disconnect).
- Solo path is exactly today's `main.js` behavior, reached via Play Solo.

- [ ] **Step 1:** Build the menu + mode switch. Keep SOLO the literal current code path.
- [ ] **Step 2:** **Manual verification** against a live server:
  - `npm start` in one terminal.
  - Open two browser windows on `index.html` (served, not `file://`), Host in one, Join by
    the shown code in the other.
  - Confirm: both heroes visible and moving; melee/skills hit shared monsters; kills, blood,
    damage numbers, and sounds fire on both; a monster chases the nearer hero.
- [ ] **Step 3:** Commit: `feat(net): main menu with solo/host/join and online mode wiring`

---

### Task 5: Prediction feel under latency + LAN RTT proof

**Files:**
- Modify: `js/net.js` (ensure `LATENCY_MS` delays both directions), `js/main.js` (a dev
  toggle to set `Net.LATENCY_MS`, e.g. `window.__rtt(ms)`).
- Test: manual (the roadmap's exit criterion) + a node test that reconciliation converges
  under simulated delay.

- [ ] **Step 1: Node test** — feed `Net` snapshots that lag the inputs by N frames (via
  the injected clock + latency), drive a straight-line run, and assert the reconciled
  local player never jumps backward frame-to-frame (monotonic along the move axis) and
  ends within a small epsilon of the pure-server position. This pins "smooth, no
  rubber-band" without a human.

- [ ] **Step 2: Manual exit check** — set `Net.LATENCY_MS = 100` (→ ~200 ms RTT), run the
  two-window test from Task 4, and confirm the local hero feels immediate (prediction) while
  remote entities move smoothly (interpolation), with no visible snapping on the local
  player. This is the roadmap's Phase 2 exit.

- [ ] **Step 3:** Full suite green; commit:
  `feat(net): artificial-latency switch and reconciliation-under-delay proof`

---

### Exit criteria (from the roadmap)

- Two browsers on LAN fight the same pack smoothly at a simulated 100 ms RTT; local
  movement is immediate, remote motion is smooth, no rubber-banding.
- Solo play unchanged (same controls, same juice) — pinned by the movement-parity test and
  a manual solo pass.
- Full `node --test test/*.test.js` green throughout; new net/render logic arrived test-first.
- Then merge `phase2-client-netplay` → `main` and mark Phase 2 landed in the roadmap, with
  a crib for Phase 3 (accounts & server saves) / Phase 4 (co-op rules & party UX).

## Open questions to resolve during implementation

1. **HUD `self` block.** The HUD needs the local player's mana/xp/skill-cooldowns, which
   snapshots don't carry. Cheapest fix: the server adds a small `self` object to each
   client's snapshot (its own mana/maxMana/xp/level/skillCd/bag.gold/belt). This is a
   one-file server change (`room.snapshotFor`) — do it in Task 3 if the HUD looks bare,
   and add a room test. Keep it to HUD-display fields; full bag/equip stays Phase 3.
2. **Predicting attacks/skills.** Phase 2 predicts movement only; attacks/skills resolve
   server-side and appear via the next snapshot (a ~100 ms delay on your own swing visual).
   If that feels bad in the manual pass, predict the local swing *animation* (not damage)
   from the local input — cosmetic only, no authority. Decide from feel, not up front.
3. **Interpolation vs. prediction seam for the local player.** The local player renders
   from prediction; everyone else from interpolation. Confirm the splice in
   `buildRenderState` never double-counts or drops the local player when it also appears
   in the snapshot's `players[]`.
