# Multiplayer Roadmap — phase index

> Spec: `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Each phase is an independently shippable plan. Phase 0's full plan exists
> (`2026-07-16-phase0-netcode-ready-refactor.md`); write each later phase's plan
> when its predecessor lands, so decisions stay fresh and tested reality feeds forward.

## Phase 0 — Netcode-ready refactor ✅ *(landed 2026-07-17, branch `phase0-netcode-refactor` merged to `main`)*

No server, no behavior change; solo play equivalent in feel. Entity ids,
`state.players[]` + per-player input maps, event-buffer juice (`drainEvents`/`applyEvents`),
multi-source flow field + nearest-player AI, `Game.stepFixed` 30 Hz stepper,
seeded sim RNG (`state.srand`) with a same-seed-same-outcome replay test.
Exit met: 112/112 tests (7 new), solo verified in-browser, six TDD commits.

## Phase 1 — Server skeleton & protocol ✅ *(landed 2026-07-17, branch `phase1-server-protocol` merged to `main`)*

- `server/protocol.js` — hand-rolled validators (no dep), a pre-parse size cap, seq numbers, and a token-bucket rate limiter sized to pass 30 Hz input but drain under a flood. Rejects (never coerces) anything the sim acts on; clamps cosmetics like names. `restart` deliberately not an accepted edge — it rebuilds the run from players[0] alone, which would delete a shared room (Phase 4 owns co-op death/run-end).
- `server/room.js` — one sim state per room, its sole mutator: seat management (max 4, monotonic ids so a leaver's slot never aliases a joiner), input buffering (held keys persist, edges accumulate and fire once, stale/duplicate seq dropped), `tick(nowMs)` drives `Game.stepFixed` then drains events, and outbound snapshots/events are per-player projections filtered to an AOI radius — never live sim objects.
- `server/server.js` — `WebSocketServer`, room registry, confusable-free join codes (room seed derived from the code), one heartbeat interval ticking every room and fanning out AOI snapshots, ping/pong liveness, kick-on-abuse. `server/sim.js` bootstraps the browser sim into node.
- `package.json` + `ws` arrived; client untouched (still zero-build, plain script tags). README gained a Multiplayer section restating the offline-only artifact constraint.
- Exit met: 191/191 tests (24 new — 7 protocol, 11 room, 6 loopback integration). Two scripted ws clients co-exist in one room, move independently, one kills a monster both observe consistently; malformed/flood senders get kicked without harming the room; empty rooms are reaped. Four TDD commits.

### Notes for Phase 2 (client netplay)

- `welcome` carries `{v, code, seed, you, tickHz}`; `snapshot` carries `{tick, you, ack, floor, players[], monsters[], projectiles[], groundItems[], events[]}`. `ack` is the newest input seq the server has processed for that client — reconciliation reads it.
- The server accepts only `join`/`input`/`ping`; the client must send held keys every tick and edges as a `pressed[]` list (they fire once server-side). Menu/UI edges (`inv`, `tree`, `esc`, `mute`) stay client-side and are not in `Protocol.EDGES`.
- Snapshots omit the dungeon grid: the client regenerates each floor with `Dungeon.generateDungeon(welcome.seed, snapshot.floor)` (a server test pins that this reproduces the room's grid). Server-only AI fields are stripped too. AOI radius is 900 world units; party members are never culled.
- Positions are rounded to 2 dp, angles to 3 — the client should interpolate, not treat them as exact.

## Phase 2 — Client netplay ✅ *(landed 2026-07-18, branch `phase2-client-netplay` merged to `main`)*

> Plan: `docs/superpowers/plans/2026-07-17-phase2-client-netplay.md`

- `Game.predictMovement` — the dodge+WASD movement block, extracted pure from the sim so client prediction and server stepping move the local hero through identical code (parity test pins bit-equality).
- `js/net.js` — a transport/clock-injected connection: snapshot buffer with 100 ms interpolation (shortest-arc angles, clamp when thin, stale ticks dropped), own-movement prediction + reconciliation off `ack`, `takeEvents` for juice, and `buildRenderState`/`freshRenderState` assembling a sim-shaped render state (predicted hero spliced over interpolated remotes, floor grid regenerated from the seed, single-source fog, HUD `self` block). An artificial `latencyMs` switch delays both directions for RTT testing.
- Rendering draws the whole party: `R.drawPlayer(ctx, state, p)` and `Render.draw` paint every living `state.players` member; lean allies (no equipment) render as the base body. Solo rendering unchanged.
- Start menu (`js/ui/menu.js`): Play Solo (byte-identical offline game) / Host (opens a room, banners the code) / Join by code. `main.js` gained a screen machine and an online frame branch; Esc or any disconnect drops cleanly back to the menu, and a WebSocket-less build reports "offline" instead of hanging.
- Server refinements surfaced by real ally rendering: projectiles ride as `angle` (was an always-zero `a`); the players[] swing carries `facing/radius/arc/ranged`; snapshots gained a `self` block for the HUD's private fields.
- Exit met: 210 tests (all node), incl. real-`Net`-client-vs-real-server integration (host+move, two clients seeing each other, combat juice over the wire, prediction converging with no backward snap under a simulated 100 ms one-way delay). Verified in a real browser: menu renders clean; two headless Chrome clients joined one room and both heroes rendered from live snapshots (screenshot). Six TDD commits.

### Notes for Phase 3 (accounts & server saves)

- The online hero is currently a **fresh starter** built client- and server-side per room (`freshPlayer`/`freshRenderState`) — Phase 3 replaces both with a loaded character. The `self` block already carries per-player private state; extend it (or the welcome) with the loaded bag/equip once the store exists.
- `bag.gold` and `kills` are **shared** run state in Phase 2 (single `state.bag`); per-player loot/gold is Phase 4. Don't build save semantics assuming per-player bags yet.
- Client identity (name/shirt) is sent on `join`; there's no auth. Phase 3 adds register/login messages ahead of `join` and an opaque session token.

## Phase 3 — Accounts & server saves ✅ *(landed 2026-07-18, branch `phase3-accounts-saves` merged to `main`)*

> Plan: `docs/superpowers/plans/2026-07-18-phase3-accounts-saves.md`
> **Storage deviation:** the owner chose **Postgres** (multi-writer, built for
> horizontal scale) over the roadmap's original better-sqlite3 note. Driver is `pg`
> (pure JS, no native build); password hashing is scrypt via `node:crypto` (no argon2).

- `server/store.js` — one async persistence interface, two implementations: `PgStore`
  (real Postgres via a `pg` pool, the production path) and `MemStore` (in-memory, for
  the service-free test suite and DB-less dev). `createStore` picks by `DATABASE_URL`.
  `server/crypto.js` = scrypt hash/verify + opaque 256-bit tokens. `server/store.sql` =
  accounts / sessions / characters (character = the `Save.snapshot` blob as `jsonb`).
- Protocol + server: register/login/resume → session token + character list; listChars/
  createChar/selectChar/deleteChar (max 8 slots). Auth gets the strictest rate bucket.
  Join is dual-mode — authenticated players load their selected character (and are saved),
  guests get a fresh starter (Phase 1/2 behavior, no persistence).
- `server/character.js` maps blobs ↔ live room players. Save triggers (fire-and-forget,
  never on the tick path): level-up, floor change, a periodic catch-all, disconnect;
  **death wipes the run** (slot survives, blob resets to a starter). Host owns the shared
  room bag; guest bags are frozen server-side so co-op can't clobber them.
- Client: `js/net.js` auth senders + localStorage token for auto-resume; `js/ui/account.js`
  login/register + 8-slot character select; `main.js` flow menu → account → select → host/
  join → playing. Solo play untouched.
- Exit met: 222 tests service-free (MemStore); the gated Postgres suite (store parity +
  the restart-resume integration proof) passes against Docker Postgres — a level-9 hero
  persisted on one server resumes by token on a fresh server pointed at the same DB. Six
  TDD commits.

### Notes for Phase 4 (co-op rules & party UX)

- **Per-player loot is the big one.** Bag/gold is still shared room state (host owns it,
  guest bags frozen). Phase 4's instanced loot makes each player's bag its own; then the
  save path saves each player's live bag instead of the host/frozen split.
- The **local online hero renders as a starter** (client builds it from `Entities.newPlayer`;
  the server has the real character). Movement prediction may drift slightly for a character
  with move-speed gear (reconcile corrects it in ~100 ms). To render/predict the real hero,
  send the selected character's equip in `welcome` or the `self` block.
- **One character, one live session:** nothing yet stops the same (account, slot) joining two
  rooms at once (last-write-wins on save). Add a "character already active" guard.
- Session tokens have a 30-day TTL, refreshed on resume; no logout-elsewhere / revocation UI.

## Phase 4 — Co-op rules & party UX (~1 session)

- Monster HP/XP party scaling (constants test-pinned), full XP to in-range members.
- Instanced loot (per-owner drops), pickup validation.
- Ghost/revive/respawn death rules; run ends on full wipe.
- Shared descent banner; per-player portals; party bar UI + ally minimap dots + join-code display.
- Exit: 4 scripted bots clear a floor together in the integration harness; death/revive round-trips.

## Phase 5 — Hardening & deploy (~1 session)

- Fuzz the protocol (random/mutated payloads must never crash a room).
- Soak: 50 rooms × 4 bots × 10 min, memory flat, tick under budget.
- Metrics endpoint (rooms, players, tick ms, dropped msgs), structured logs.
- Dockerfile + run instructions; TLS termination notes; README "Host your own server".

## Dependency graph

Phase 0 → 1 → 2 → 4 → 5, with 3 parallel-safe after 1 (2 and 3 don't touch the same files).

## Standing constraints (all phases)

- Client stays zero-build, plain script tags; server-only npm deps.
- Every phase keeps the full `node --test test/*.test.js` suite green; new systems arrive test-first.
- The claude.ai artifact remains offline-only (CSP blocks sockets); README must say so.
