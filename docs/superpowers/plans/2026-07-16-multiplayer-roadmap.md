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

## Phase 4 — Co-op rules & party UX ✅ *(landed 2026-07-18, branch `phase4-coop-rules` merged to `main`)*

> Plan: `docs/superpowers/plans/2026-07-18-phase4-coop-rules.md`
> Built on current `main` (post-Phase-3 + bigger-maps/mouse-aim/swarms/props), not the
> stale Phase 2 base the plan originally assumed — see the plan's AUDIT note.

- **Party scaling:** `Balance.coop` + `Entities.partyHpMult/partyXpMult`; `makeMonster`/
  `makeBoss` take `partyN` (default 1 ⇒ byte-identical solo). The room stamps `state.partyN`
  and regenerates the floor while pristine so the assembled party is scaled to.
- **Attacker-aware combat:** the acting player threads through `playerAttack`/`castSkill`/
  `explode`(via `ownerId`)/projectiles/`killMonster`. Kills pay full XP (each hero's own
  `xpMult`) to every living player within `Balance.coop.shareRange`; `lifePerKill` heals the killer.
- **Instanced loot + per-player bags:** each hero owns `p.bag` (`state.bag` aliases the local
  player); `dropLoot` rolls per in-range owner (`ownerId`), solo stays one unowned roll;
  `tryPickup`/gold-magnet + `snapshotFor` enforce ownership. Reconciled the Phase 3 bag seam
  (per-seat bag load + save).
- **Downed/revive/respawn:** party heroes go DOWN (revivable ghost) at 0 HP; a nearby ally
  revives (proximity channel) or they respawn at the entry; run ends only on a simultaneous
  full wipe. Solo keeps permadeath.
- **Shared descent + party UX:** stairs arm a party countdown (`state.descendT`), instant when
  all are on / when solo; `makeFloorState` fans the whole party at the entry; portals are
  owner-tagged party-travel. Party bar, ally minimap dots, descent banner, downed ghosts;
  join code already shown.
- Exit met: **269 tests** (28 new co-op, incl. a 4-seat room exit proof: party scaling,
  in-range XP, per-owner instanced drops, down→revive→continue, full-wipe→end). Solo pinned
  byte-identical (n=1 degrade paths + headless solo drive). Test-first throughout.

### Notes for Phase 4.5 (client preload & server authority)

- **Attacker-aware combat has landed** — `playerAttack(state, p)` / `explode` resolve the actor,
  so Track C's prerequisite is met.
- **Per-player bags exist** (`p.bag`, `state.bag` alias). Track C's equip/buy/sell intents apply
  against the acting player's `p.bag` server-side.
- New snapshot fields for the authority/ref work: `down`/`downT`/`reviveT`, `descendT`, and
  ground items already carry `ownerId` (Task 9's ref rework must preserve it).

## Phase 4.5 — Client preload & server authority ✅ *(landed 2026-07-18, branch `phase4_5-preload-authority` merged to `main`)*

> Plan: `docs/superpowers/plans/2026-07-18-phase4_5-client-preload-and-authority.md`

**Track B (serving) + Track C (server authority) landed in full; Track A landed the boot
infrastructure + audio/asset preload.** The phase's core value — *one origin, and the
client can't cheat a server number* — is delivered and test-pinned.

- **Track A — preload (boot + audio + assets):** `js/boot.js` — ordered weighted steps with
  the fallback guarantee (a non-required failure is recorded, never fatal). `Sfx.warm()`
  pre-creates the noise buffer safely on a suspended context. `js/assets.js` — optional
  manifest loader that never rejects; every failure mode (empty/malformed/unreachable
  manifest, a 404 entry, `file://`) falls back to procedural. Ships `assets/manifest.json`
  empty. Wired as background boot steps in `main.js`.
- **Track B — serving:** `server/static.js` — a `node:http` static handler (MIME, cache
  headers — `no-cache` for index/manifest, `immutable` only for content-hashed URLs, ETag
  revalidate otherwise, pre-filesystem traversal rejection). `server.js` now runs one HTTP
  server with the ws server on its `upgrade` events, so client + socket share one origin;
  `main.js` derives the ws URL from the page origin with a `:8080` dev fallback.
- **Track C — server authority (the headline):** `server/intents.js` applies
  equip/unequip/sell/upgrade/learn/buy against the SERVER's copy of the player's
  bag/equip/skills, recomputing stats from server tables. `protocol.js` validates intents as
  indices/ids only and **rejects any forged `damage`/`price`/`stats` key** (a kick, not a
  no-op). `server/schema.js` sanitizes stored blobs on load (clamp/drop inflated stats & junk;
  broken blob ⇒ fresh starter; legit blob unchanged). `test/authority.test.js` pins the whole
  boundary (no presentation import in sim/server; forged fields never land; server prices
  enforced; persisted values are server-computed).
- Exit met: **309 tests** (+40 across boot/audio/assets/static/intents/charschema/authority),
  test-first, solo/offline untouched (all preload is non-required with procedural fallback).
- **Deferred as perf/bandwidth follow-ups** (no user-facing correctness impact; documented so
  they aren't forgotten): Task 2 render-cache *draw-through* wiring into tiles/icons
  (`Render.cached` infra pattern is straightforward but browser-only to verify), Task 6 the
  service worker offline shell, and Task 9 sending ground items as refs. The client-side
  intent *emit* path (online equip/buy UI → `net.sendIntent`) is likewise a browser wiring
  follow-up; the authoritative server side is complete.

## Phase 5 — Hardening & deploy ✅ *(landed 2026-07-18, branch `phase5-hardening-deploy` merged to `main`)*

> Plan: `docs/superpowers/plans/2026-07-18-phase5-hardening-deploy.md`

- **Fuzz:** `server/fuzz-gen.js` seeded generators shared by `test/fuzz.test.js` (CI slice)
  and `tool/fuzz.mjs` (manual sweep). `decode`/`validateClient` proven throw-free over
  thousands of mutated/random frames; a Room fed fuzz frames + valid-but-adversarial input
  with join/leave churn ticks cleanly with no orphan input buffers.
- **Observability:** `server/metrics.js` (counters/gauges + bounded tick ring avg/max/p95 +
  per-reason kicks; reads never mutate sim) and `server/logger.js` (one JSON line per event,
  **secrets never echoed**). `GET /metrics` (JSON) + `GET /healthz` on the http listener.
- **Soak:** `test/soak.test.js` (in-process virtual-clock CI slice) + `tool/soak.mjs` (full
  50×4×10min, heap slope + tick-p95 budget). Measured 20×4×1min: tick p95 ≈ 4 ms (budget
  33 ms), heap flat.
- **Backpressure & lifecycle:** fan-out drops a backed-up peer's snapshot (metered);
  `maxRooms`/`maxConnections` → clean `server_full` kick; `srv.drain()` flushes a final save
  for every live player on SIGTERM before close.
- **Deploy:** non-root, healthchecked `Dockerfile` (`--omit=dev`); `docker-compose.yml`
  (Postgres + server, volume-persisted); README **"Host your own server"** (one-origin serving,
  env vars, `/metrics`+`/healthz`, TLS-termination proxy). `test/deploy.test.js` guards drift.
- Exit met: **325 tests** (+16), test-first, no gameplay drift, solo untouched.

**This closes the multiplayer roadmap — Phases 0–5 all shipped.** Deliberate future work
(not open phases): Phase 4.5 follow-ups (render-cache draw-through, service worker, snapshot
refs, client intent-emit UI), multi-process room sharding, per-player town instances, and
making the client's port assumption configurable for a single-origin `:443` deploy.

## Dependency graph

Phase 0 → 1 → 2 → 4 → 4.5 → 5, with 3 parallel-safe after 1 (2 and 3 don't touch the same
files). Phase 4.5's Track C built on Phase 4's attacker-aware combat.

## Standing constraints (all phases)

- Client stays zero-build, plain script tags; server-only npm deps.
- Every phase keeps the full `node --test test/*.test.js` suite green; new systems arrive test-first.
- The claude.ai artifact remains offline-only (CSP blocks sockets); README must say so.
- **Assets are always optional.** Phase 4.5's asset loader gives every asset a procedural
  fallback: the game stays fully playable from `file://` with zero network and zero asset
  files. No feature may hard-depend on a loaded file.
