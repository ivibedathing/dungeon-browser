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

## Phase 1 — Server skeleton & protocol (~1–2 sessions)

- `server/server.js` — ws listener, room registry, join codes, 30 Hz loop per room calling `Game.stepFixed`.
- `server/protocol.js` — message schemas (hand-rolled validators, no dep), rate limits, seq numbers.
- `server/room.js` — player join/leave, input buffering, snapshot/event broadcast with AOI filter.
- `package.json` arrives (server-only deps: `ws`).
- Tests: real server on loopback; two scripted ws clients join a room, move, one attacks a monster, both receive consistent snapshots; malformed/flood messages get kicked. Exit: two node test clients co-exist in one room.

## Phase 2 — Client netplay (~2 sessions)

- `js/net.js` — connection, intent senders, snapshot buffer (100 ms interpolation), own-movement prediction + reconciliation (`lastAckedSeq`).
- Main menu: Play Solo (local room, unchanged) / Play Online (host or join by code).
- Event applier drives juice from server events (already event-driven after Phase 0).
- Remote mode: sim skipped locally except prediction; render reads interpolated entities.
- Exit: two browsers on LAN fight the same pack smoothly at simulated 100 ms RTT (artificial delay switch in net.js for testing).

## Phase 3 — Accounts & server saves (~1 session)

- `server/store.js` — better-sqlite3; accounts (argon2id), opaque session tokens, characters (Save.snapshot JSON, versioned).
- Register/login messages + client screens; character select (max 8 per account).
- Server-side save triggers (level/floor/item-debounce/disconnect/room-close); death wipes run per roguelite rule.
- Optional one-time localStorage character import, flagged `imported`.
- Exit: kill server mid-run, restart, character resumes from server exactly like today's localStorage proof.

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
