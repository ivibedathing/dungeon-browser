# Dungeon Browser Multiplayer — Co-op, Server Saves, Server-Validated Combat — Design Spec

Date: 2026-07-16
Status: Proposed — awaiting decisions on the Open Questions, then phase plans execute in order.

## Goal

Turn Dungeon Browser into an online co-op ARPG in the closed-realm mold:

1. **Co-op** — 2–4 players share a dungeon run in real time.
2. **Server saves** — characters live server-side under an account; clients can't edit them.
3. **Server damage validation** — the server is authoritative over all combat math; clients send *intent*, never outcomes.

## Authority model — the load-bearing decision

Three candidate architectures:

1. **Peer-hosted co-op (WebRTC, one client simulates).** Cheapest to run, but the host client computes damage — that is client trust, not server validation. Fails requirement 3 outright, still needs a signaling+save server, and adds host-migration pain. **Rejected.**
2. **Client simulation + server auditing (trust-but-verify).** Clients simulate; the server spot-replays combat events and bans on divergence. Lower server CPU, but the validator ends up re-implementing the whole sim, co-op needs state sync anyway, and guarantees are probabilistic. **Rejected — costs almost as much as full authority and delivers less.**
3. **Server-authoritative simulation** *(chosen)*. A Node server runs `Game.update()` at a fixed tick per game room. Clients send inputs and discrete intents; the server broadcasts snapshots and events; clients render, interpolate, and predict only their own movement.

Why 3 is cheap for *this* codebase: the simulation already runs headless in Node — the existing test suite drives `Game.update` for thousands of frames with no browser (`test/smoke.test.js`, `test/render.test.js`). The sim/presentation split we need is mostly already true. Measured cost: the smoke suite steps ~1,200 frames in ~26 ms on this machine ≈ **46,000 updates/sec/core** → a 30 Hz room costs ~0.07% of a core; hundreds of concurrent rooms per core before optimization.

## Topology

```
browser client ── wss ──┐
browser client ── wss ──┤   Node server process
browser client ── wss ──┼──   Room = one co-op run: seed, floor, players[], tick loop (30 Hz)
                        │     Rooms registry (join codes)
                        │     Account/session/character store (SQLite)
                        └──   Snapshot broadcaster (15–20 Hz, AOI-filtered)
```

- **Room** = one run: `(runSeed, floor, players, monsters, groundItems, projectiles, portals/town)`. Created by "New Game", joined via a 5-char join code (classic game-name vibes). Room dies after all players disconnect + grace period.
- **Solo online play is a 1-player room** — one code path. Offline mode (current localStorage game) remains, with **separate characters that never mix with server characters** (the open/closed realm split).
- The dungeon map is never transmitted: clients regenerate it from `(runSeed, floor)` — generation is already deterministic and test-pinned. Snapshots carry only dynamic entities.

## Protocol (JSON first; binary later only if measured necessary)

Client → server (validated against a strict schema, rate-limited, sequence-numbered):

| message | payload | server validation |
|---|---|---|
| `input` | `{seq, keys, facing}` @30 Hz | speed clamp — server integrates movement itself; teleporting impossible |
| `attack` | `{}` (space held is in `keys`) | server checks `attackT` cooldown, computes arc hits + damage |
| `castSkill` | `{idx}` | rank learned, mana, cooldown — all server-held |
| `useBelt` / `bagClick` / `bagDrop` / `equip` | `{slot|index}` | item exists in server-held bag; effects computed server-side |
| `pickup` | `{}` | nearest-item range check server-side |
| `learnSkill` | `{id}` | `Skills.canLearn` on server state |
| `buy` / `sell` / `buyPotion` | `{index}` / `{index}` / `{kind}` | trading flag, gold, stock — server-held |
| `portal` / `descendVote` | `{}` | cooldown / party rules |

Server → client:

| message | payload |
|---|---|
| `welcome` | `{playerId, roomCode, runSeed, floor, character}` |
| `snapshot` | @15–20 Hz: AOI-filtered entities `{id, x, y, hp, anim}`, own player authoritative block `{x, y, hp, mana, xp, cooldowns, lastAckedSeq}` |
| `event` | damage numbers, kills, level-ups, drops, pickups, sfx cues, chat/log lines — juice is event-driven |
| `bag` / `equip` | full small-object sync on change only |
| `floor` | `{floor, runSeed}` → client regenerates map, shows title card |

Client prediction: **own movement only** (apply input locally, reconcile against `lastAckedSeq` position, blend on small error / snap on large). Combat is *not* predicted — swing animations play immediately; damage numbers arrive as events. At co-op-typical RTTs (20–100 ms) this is the standard ARPG feel.

## What the server validates (requirement 3, concretely)

Because the server owns the sim, "validation" means: **clients cannot express illegal outcomes, only intents.**

- Damage: computed from server-held stats via server-side `pointInArc` / projectile sim. A hacked client can spam `attack` — the server's `attackT` gate makes it a no-op.
- Movement: server integrates positions from clamped velocities; collision server-side.
- Items: item objects exist only server-side with server-assigned ids; clients reference by id/index. Minting/duplicating items client-side is impossible.
- Economy: gold, prices, stock checks server-side.
- Progression: XP, levels, skill points, ranks — server-side; `learnSkill` runs `canLearn`.
- Transport hygiene: schema validation on every message, per-type rate limits, kick + log on malformed floods.

Accepted v1 limitations (documented, not hidden): map knowledge (maphack) is inherent to seed-sharing — mitigable later by streaming explored tiles instead of the seed; aim assistance is inherent to facing-as-intent. Both are PvE-only concerns here.

## Server saves

- **Store:** SQLite via `better-sqlite3` (single file, zero ops, fits self-hosting; storage behind a thin interface so Postgres is a swap, not a rewrite).
- **Schema:** `accounts(id, username, pass_hash argon2id, created_at)` · `sessions(token, account_id, expires_at)` · `characters(id, account_id, name, data JSON, updated_at, version)` — `data` is the existing `Save.snapshot()` shape (already versioned), gaining a server-side integrity pass on load.
- **Save triggers** (server-side): level-up, floor change, item/gold change (debounced 5 s), disconnect, room close. Death applies the roguelite rule server-side (wipe run save, keep records).
- One-time **import of a localStorage character** to the account, marked `imported: true` (trust caveat: pre-import progress was client-editable; imported characters could be cosmetically flagged, open-character style).

## Co-op rules (defaults — see Open Questions)

- Party size **4**; join by code; late join lands at current floor's entry.
- Monster scaling: HP ×(1 + 0.5·(n−1)), XP ×(1 + 0.35·(n−1)) — constants pinned by tests, tuned in play.
- **Instanced loot** (recommended): drops roll per player and are visible only to their owner — kills loot-stealing friction and simplifies pickup validation.
- XP: full XP to every party member within AOI range of the kill.
- Death: dead player drops to a ghost at floor entry after 10 s (or instant teammate revive within 3 s radius); **run ends (and server save wipes) only if all players are dead simultaneously**. Solo keeps its harder permadeath.
- Descent: stairs start a 10 s party banner; everyone teleports together (keeps one shared floor per room — one flow field, one AOI world).
- Town portals are per-player; town is part of the same room instance. Player-to-player trading: out of scope v1.
- Ally UI: party bar with names/HP, minimap ally dots, join-code display.

## Client/codebase refactor inventory (drives Phase 0)

1. **Entity ids** — monsters/projectiles/ground items need stable ids for snapshots (currently array refs).
2. **`state.players[]`** — replace the singular `state.player` in the sim (`Game.update(state, inputsById, dt)`); client keeps a "my player" view. Back-compat shim keeps all 81 existing tests green during the transition.
3. **Event buffer** — `floatText/burst/sfx/message` become emitted events (`state.events`); a client-side applier turns events into particles/floaties/sounds. Single-player consumes its own events locally — **local play becomes "a local room", one code path**.
4. **Multi-source flow field** — BFS seeded from all player positions; monsters chase the nearest player.
5. **Fixed tick** — `Game.stepFixed(state, inputs, elapsedMs)` accumulator at 30 Hz for the server; the browser keeps rAF+interpolation.
6. **Injectable sim RNG** — `state.rng` replaces bare `Math.random` in sim code paths (combat rolls, drops), enabling replay/golden tests and server determinism; cosmetic randomness stays local.

## Tech stack

- Server: **Node ≥ 20**, `ws` (WebSocket), `better-sqlite3`, `argon2`. First npm dependencies in the project — server-only; **the client stays zero-build, plain script tags**.
- Tests: `node --test` throughout; server integration tests run a real server on a loopback port with scripted ws clients; bot rooms for soak tests.
- Deploy: any Node host (VPS, fly.io). A ticking sim disqualifies serverless/edge (needs a persistent loop). Dockerfile provided in the hardening phase.
- **Artifact caveat:** the claude.ai artifact build cannot use online mode — artifact pages block all external network (CSP), so the artifact permanently ships offline/solo mode only. Online play requires the self-hosted client+server.

## Rollout phases (each independently shippable — see roadmap doc)

0. Netcode-ready refactor (no server; all tests stay green; solo unchanged)
1. Server skeleton: rooms, join codes, protocol, validation, server loop
2. Client netplay: net.js, menu (Online/Solo), interpolation, prediction
3. Accounts + server saves (+ optional local-character import)
4. Co-op rules: scaling, instanced loot, revive, shared descent, party UI
5. Hardening: rate limits, fuzzing, soak tests, metrics, deploy story

## Open Questions (defaults chosen so work can start; overrides welcome)

1. **Loot**: instanced per player *(recommended)* vs shared FFA drops?
2. **Co-op death**: ghost + revive/respawn, run ends on full wipe *(recommended)* vs hardcore shared permadeath?
3. **Accounts**: username+password *(recommended)* vs anonymous character-key tokens?
4. **Hosting target**: self-managed VPS/fly.io Node process *(recommended)* — any constraint here?
5. **Party size**: 4 *(recommended)*?
6. **Offline mode**: keep, with separate characters *(recommended)* — or online-only?
7. **Version control**: the project has no git repo; Phase 0 Task 0 initializes one (multi-phase work without VCS is reckless). OK?
