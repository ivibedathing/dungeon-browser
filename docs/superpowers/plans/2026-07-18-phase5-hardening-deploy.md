# Phase 5 — Hardening & Deploy Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Roadmap: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md`
> Predecessor: Phase 3 (accounts & server saves) landed 2026-07-18. **Phase 4
> (co-op rules & party UX) is planned but NOT yet implemented** — see the ordering
> note below.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the
> full `node --test test/*.test.js` suite green; deploy/infra tasks that can't be a
> node test get a documented manual verification step instead.

**Goal:** Take the co-op server from "works on my machine, in the test harness" to
"survives hostile input, holds up under a full lobby for a sustained run, tells you
what it's doing, and ships as a container someone else can host." No new gameplay —
this phase is about *durability, observability, and deployability* of what Phases
0–4 built. Solo play is untouched: none of this code runs offline.

## Ordering note — Phase 5 nominally follows Phase 4

The roadmap dependency graph is `0 → 1 → 2 → 4 → 5`, and the convention is to write
each phase's plan when its predecessor lands. This plan is being written **ahead of
Phase 4** at the owner's request, so it is grounded in the server as it exists at the
Phase 3 merge (`065865a`, 222 tests). That is deliberate and safe, because everything
Phase 5 hardens — the framing/validation in `server/protocol.js`, the room lifecycle
in `server/room.js`, the socket front door and tick loop in `server/server.js`, the
persistence seam in `server/store.js` — **already exists today** and is not
restructured by Phase 4. Phase 4 *extends* these surfaces (new `Protocol.EDGES`, new
snapshot fields like `down`/`descendT`, a `state.partyN`); it does not replace them.

**Two execution paths, pick at Task 0:**
- **If Phase 4 has landed** (the intended order): baseline is Phase 4's exit test
  count; the fuzz corpus seeds and soak bots exercise the co-op message set and
  derived states (revive proximity, descent countdown). Nothing structural changes
  in this plan — only the input corpus grows.
- **If executing against current `main` (Phase 3, 222 tests)**: every task below runs
  as written; the fuzzer and soak bots cover the Phase 1–3 message set. Leave a
  `// Phase 4:` TODO at the two seams the corpus touches (edge list, snapshot fields)
  so the co-op inputs get added when Phase 4 merges. No task is blocked.

This plan is written to be correct either way; where a task's *inputs* depend on
Phase 4, that is called out inline.

## Architecture

Phase 5 is almost entirely **server-side** (`server/`) plus **tooling** (`tool/`,
Dockerfile) and **docs** (README). The client (`js/`) is touched in exactly one small
place if at all — the connection URL is already TLS-aware (`js/main.js:50` picks
`wss://` under HTTPS), so deploy needs no client change beyond serving the static
files over HTTPS behind the same proxy.

The load-bearing seams this phase leans on already exist and were left as hooks by
earlier phases:
- **`Protocol.decode` / `Protocol.validateClient`** (`server/protocol.js`) — the
  single gate every inbound frame passes. The fuzzer (Task 1) pounds this and the
  Room behind it.
- **`Room.tick(nowMs)`** (`server/room.js`) — the injectable-clock stepper. Both the
  metrics timing (Task 2) and the accelerated soak (Task 3) drive it directly with
  synthetic timestamps instead of the wall clock. `server/server.js:73` already
  flags `now()` as "the seam a deterministic soak test (Phase 5) will drive."
- **`createServer(opts)`** (`server/server.js`) — already accepts injected `store`,
  `rng`, `onError`, `port: 0`. Task 2 adds injectable metrics + logger the same way,
  so the test suite stays service-free and deterministic.

## Deliberately NOT in Phase 5 (owned elsewhere or out of scope)

- **New gameplay, balance, or co-op rules** — those are Phases ≤4. Phase 5 adds no
  sim behavior; a hardening change that alters a single tick's outcome is a bug.
- **Horizontal scale / multi-process room sharding.** One server process, many rooms,
  as today. Postgres is already multi-writer (Phase 3 chose it for this), so a second
  process *could* be run against the same DB, but a room registry is per-process and
  a shared-room-across-processes design is a future concern. The metrics/soak here
  characterize a single process.
- **A full auth/abuse dashboard or WAF.** Metrics are counters + a JSON endpoint, not
  a UI. Structured logs are JSON lines to stdout, not a shipping pipeline.
- **Managed TLS in-process.** The server speaks `ws://`; TLS is terminated by a
  reverse proxy (documented in Task 5), which is the standard and simplest posture.
- **Client changes** beyond confirming the existing `wss://` selection works behind
  the proxy. No new client dependency; client stays zero-build.

## Tech Stack

Plain Node.js (`>=18`, built-ins only for new code — `node:http`, `node:perf_hooks`,
`node:crypto`) + `node --test`. **No new npm dependencies**: `ws` and `pg` stay the
only two, both server-only. The metrics endpoint uses `node:http`, not express. The
Dockerfile uses the official `node` image. Client stays zero-build, plain script tags.

## Global Constraints

- The full `node --test test/*.test.js` suite passes after **every** task. New
  hardening/observability logic arrives test-first as node tests; infra that can't be
  a node test (Docker build/run, the full-scale soak) gets a documented manual step.
- **Service-free by default.** New tests must run with no Postgres and no real
  sockets where possible (drive `Room`/`createServer({port:0})` in-process). The soak's
  fast CI variant is in-process and virtual-clock; the full-scale soak is a `tool/`
  script, not part of the default suite.
- **Determinism.** No `Math.random`/`Date.now` leaks into anything asserted: fuzz uses
  a seeded PRNG passed in; soak drives synthetic timestamps into `Room.tick`. (Server
  runtime may use `Date.now()`/`Math.random` as it does today — the *tests* inject.)
- **No behavior drift.** Instrumentation must not change what a tick computes. A metrics
  counter reads state; it never mutates sim state. Pin this with an existing
  same-seed replay/room test staying green.
- The claude.ai artifact stays offline-only; README continues to say so.

---

### Task 0: Branch & baseline

**Files:** none (branch only).

- [ ] Worktree `../dungeon-browser-phase5` on branch `phase5-hardening-deploy`. Base:
  **`main` at the Phase 4 merge if Phase 4 has landed; otherwise `main` at the Phase 3
  merge (`065865a`)** — confirm with the owner which, per the ordering note. All
  Phase 5 commits land here; **merge to `main`** on exit.
- [ ] **Confirm green baseline:** `node --test test/*.test.js 2>&1 | tail -6` →
  record the pass count (222 on Phase 3 `main`; higher if Phase 4 landed). Every task
  below must keep this green and grow it.

---

### Task 1: Protocol & room fuzzer

**Why first:** it's pure, service-free, and it hardens the exact surface every other
task's traffic flows through. The invariant is simple and strong: **no attacker-shaped
frame may crash a room or the validator.** Rejection is fine (kick); a throw that
escapes the message handler is not.

**Files:**
- Add: `tool/fuzz.mjs` (a runnable, longer/seeded fuzz driver for manual deep runs),
  `test/fuzz.test.js` (a bounded, seeded CI slice of the same generators).
- Add (small): `server/fuzz-gen.js` — a dual-mode module exporting seeded payload
  generators (`randomFrame(rng)`, `mutate(validMsg, rng)`, `validSeeds()`), so the
  tool and the test share one corpus. (Keeps the generator testable and node-only.)
- Modify (only if a crash is found): `server/protocol.js` / `server/room.js` to fix
  whatever the fuzzer surfaces (harden, don't loosen).

**Interfaces:**
- `FuzzGen.validSeeds()` → an array of well-formed messages, one per accepted `t`
  (`join`, `input`, `ping`, `register`, `login`, `resume`, `listChars`, `createChar`,
  `selectChar`, `deleteChar`). **Phase 4:** add any new client message types here.
- `FuzzGen.mutate(msg, rng)` → structure-aware mutation: drop a field, retype a field
  (number↔string↔bool↔null↔array↔object), inject `NaN`/`Infinity`/`-0`, oversize
  strings/arrays, deeply nest, flip `t`, duplicate keys via re-serialization, splice
  control chars into names, push `pressed` past `EDGES.length`, out-of-range `seq`/
  `slot`. **Phase 4:** include the new `EDGES` actions in the `pressed` mutator.
- `FuzzGen.randomFrame(rng)` → wholly random JSON (and some non-JSON raw strings) to
  hit `decode` directly.
- The seeded PRNG is a small `mulberry32`-style function in `fuzz-gen.js` (no dep, no
  `Math.random`), so a failing seed reproduces exactly.

**Invariants asserted:**
1. `Protocol.decode(raw)` never throws for **any** input (string, Buffer, empty, huge,
   binary, non-JSON) — it returns `{ok:false}` or `{ok:true,msg}`.
2. `Protocol.validateClient(msg)` never throws for any object; it returns `{ok:...}`.
3. Feeding a fresh `createServer({port:0})` a stream of fuzzed frames over a real
   in-process socket **kicks or ignores** every bad one and **never** throws out of
   the connection handler, never corrupts a room, never leaves a room un-reaped.
4. A `Room` fed only *valid-but-adversarial* inputs (max `seq`, every edge every tick,
   teleporting mouse coords within finite bounds, join/leave churn) ticks N times
   without throwing and with `players[]`/`inputs` staying consistent (no orphan input
   buffers, monotonic seat ids).

- [ ] **Step 1: Failing/undecided tests** — write `test/fuzz.test.js` running a fixed
  seed set (e.g. 2000 mutated + 2000 random frames, and 500 ticks of adversarial-valid
  room churn). It *should* pass immediately if the code is already robust — the point
  is it becomes a regression net. If it throws, you've found a real bug: **Step 1 is
  then a genuine red.**
- [ ] **Step 2:** Run. Investigate any throw.
- [ ] **Step 3:** If a crash surfaced, harden `protocol.js`/`room.js` (reject/clamp
  the input; never widen acceptance). Re-run until green and the failing seed is
  captured as an explicit regression case.
- [ ] **Step 4:** Run full suite — PASS. `tool/fuzz.mjs` runs a longer unseeded/seeded
  sweep for manual soak (documented: `node tool/fuzz.mjs [seed] [iterations]`).
- [ ] **Step 5:** Commit: `test(net): protocol + room fuzzer, no frame crashes a room`

---

### Task 2: Metrics + structured logging

**Why:** you can't operate what you can't see. Today the server logs two lines at boot
and `console.error`s store failures; there's no way to know room count, tick health, or
how many frames are being dropped. This task adds a counters object, a tiny JSON
metrics endpoint, and a structured logger — all injectable so tests stay deterministic.

**Files:**
- Add: `server/metrics.js` — a dual-mode `Metrics` collector (counters + gauges +
  a tick-duration rolling window), zero-dep.
- Add: `server/logger.js` — a dual-mode structured logger: `log(level, event, fields)`
  emits one JSON line (`{ts, level, event, ...fields}`) to a sink (default
  `process.stdout`, injectable for tests). Replaces the ad-hoc `console.*` calls.
- Modify: `server/server.js` — instantiate `Metrics`/`Logger` (injectable via `opts`),
  instrument: room create/reap, join/leave (`rooms`, `players` gauges), the tick loop
  (`tickMs` via `perf_hooks.performance.now()` around the `for (room of rooms) tick`
  + fan-out; `ticksTotal`), message drops (`msgsIn`, `kicks` by reason: bad_message /
  rate_limit / ...), and store errors. Stand up an optional `node:http` server on
  `METRICS_PORT` serving `GET /metrics` (JSON) and `GET /healthz` (200 `ok`).
- Modify: `README.md` — document `METRICS_PORT` and the endpoint shape (finished in
  Task 5's deploy section).
- Test: `test/metrics.test.js`, plus assertions folded into `test/server.test.js`.

**Interfaces:**
- `Metrics()` → `{ incr(name, n=1), setGauge(name, v), observeTick(ms), snapshot() }`.
  `snapshot()` returns `{ rooms, players, ticksTotal, tickMs: {last, avg, max, p95},
  msgsIn, msgsDropped, kicks: {bad_message, rate_limit, ...}, uptimeSec, rss }`.
  Tick-duration keeps a bounded ring buffer (e.g. last 300 samples) for avg/max/p95 —
  **bounded memory**, which the soak (Task 3) checks doesn't grow.
- `Logger({sink, now})` → `{ info(event, f), warn(event, f), error(event, f) }`. All
  output is single-line JSON; **passwords/tokens are never fields** (reuse Phase 3's
  no-echo discipline — log `accountId`, never credentials or raw tokens).
- `createServer` gains `opts.metrics`, `opts.logger`, `opts.metricsPort`. Default
  (no `metricsPort`) → **no** http listener (tests and embedders don't want a port);
  set it (env `METRICS_PORT`) to expose the endpoint. The `port:0` metrics server is
  used in the test to read `/metrics` over a real socket.
- The metrics HTTP server is **separate** from the ws server and must also `unref()`
  so it never keeps a test process alive (mirror the existing loop/ping `unref`).

**Instrumentation points (exact):**
- Room registry `set`/`delete` in `handleJoin`/`close` → `setGauge('rooms', rooms.size)`.
- `room.join`/`room.leave` success → recompute and set `players` gauge (sum of
  `room.playerCount`).
- Tick loop (`server.js:310`): wrap the room-tick + fan-out in `performance.now()`
  deltas → `observeTick(ms)`, `incr('ticksTotal')`.
- Message handler: `incr('msgsIn')` per validated frame; every `kick(...)` path →
  `incr('kicks', 1)` tagged by reason; the two `return kick(... RATE_LIMIT)` and
  `BAD_MESSAGE` paths are the "dropped msgs" the roadmap names.
- `onError` (store failures) → `logger.error('store_error', {msg})` + a counter.

- [ ] **Step 1: Failing tests** — (a) `Metrics.snapshot()` reflects a scripted
  sequence of `incr`/`observeTick`/gauge calls (avg/max/p95 math pinned; ring buffer
  caps at its bound). (b) `Logger` emits parseable JSON lines to an injected sink with
  the right level/event/fields and **no secret fields** even when handed a token. (c)
  `createServer({port:0, metricsPort:0, ...})`: connect a client, drive a few
  join+input+bad-frame cycles, `GET /metrics` → JSON with `rooms>=1`, `ticksTotal>0`,
  `kicks.bad_message>=1`; `GET /healthz` → 200.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `metrics.js`, `logger.js`, wire into `server.js`; replace
  the boot `console.log` and `onError` `console.error` with structured logs (keep a
  human-readable boot line too — ops still reads the terminal).
- [ ] **Step 4:** Run — PASS; confirm an existing room/replay test still green (no
  behavior drift from instrumentation).
- [ ] **Step 5:** Commit: `feat(net): metrics endpoint + structured JSON logging`

---

### Task 3: Soak harness — memory-flat, tick-under-budget

**Why:** the roadmap's headline hardening bar — *50 rooms × 4 bots × 10 min, memory
flat, tick under budget.* Split into a **fast in-process CI soak** (a node test that
proves the invariants at reduced scale on a virtual clock) and a **full-scale manual
soak tool** (real sockets, real clock, the actual 50×4×10min figure) run before a
deploy.

**Files:**
- Add: `tool/soak.mjs` — the full-scale driver. Spins `ROOMS` rooms (default 50),
  `BOTS` bots each (default 4), over real in-process ws sockets against one
  `createServer`, for `MINUTES` (default 10). Bots send realistic 30 Hz input (move
  toward monsters, occasional edges). Samples `process.memoryUsage().heapUsed`/`rss`
  and the metrics `tickMs` every few seconds; prints a table; **exits non-zero** if
  tick p95 exceeds budget or heap grows beyond a slope threshold across the run.
  Documented: `node tool/soak.mjs [rooms] [bots] [minutes]`.
- Add: `test/soak.test.js` — the CI slice: **in-process, virtual-clock**. Build
  several rooms directly (`new Room`), seat 4 bots each, drive `room.tick(t)` with
  synthetic monotonically-advancing `t` for a few thousand ticks with scripted bot
  inputs. Assert: no throw; `metrics`/room state bounded; empty-room churn reaps
  cleanly; **heap flat** across the run (sample `heapUsed` with `global.gc?.()` between
  samples — run the test file with `--expose-gc`, or fall back to asserting no
  unbounded array/Map growth: `room.events`, `inputs`, `_saveTrack` stay bounded).
- Modify (only if soak surfaces a leak/slowness): `server/room.js` /
  `server/server.js` (e.g. bound a growing structure, drop snapshots to a
  backpressured socket — see Task 4).
- Test: `test/soak.test.js`; `tool/soak.mjs` is manual (not in the default glob if it
  would slow CI — it lives in `tool/`, which `test/*.test.js` doesn't match).

**Interfaces / invariants:**
- **Tick budget:** at 30 Hz, `stepMs ≈ 33.3`. The CI soak asserts single-room and
  aggregate tick work leaves headroom (e.g. all-rooms tick p95 well under `stepMs` at
  CI scale); the full tool asserts p95 under budget at 50 rooms on the target box and
  reports the number rather than hard-failing on a slow laptop (threshold via env).
- **Memory flat:** across the run, `heapUsed` sampled after GC shows no upward slope
  beyond a small tolerance; the metrics ring buffer, per-room `inputs`/`_saveTrack`,
  and `events` are all bounded by design — the soak proves it empirically. A leak
  (e.g. an input buffer never deleted on leave, a room never reaped) fails the test.
- **Churn:** the soak includes join/leave/disconnect churn so `leave`, empty-room
  reaping, and `_saveTrack`/`inputs` cleanup are all exercised, not just steady state.
- The full tool reuses the **real-`Net`-vs-real-server** harness pattern from Phase 2
  (`test/netplay.test.js`) for its bots so the traffic is representative.
  **Phase 4:** bots should cooperatively fight/descend (party-scaled monsters, revive,
  descent countdown) so the soak covers co-op code paths; pre-Phase-4 they move and
  fight solo-style in a shared room.

- [ ] **Step 1: Failing tests** — `test/soak.test.js` driving N rooms × 4 bots for K
  virtual ticks with churn; assert no throw, bounded structures, flat heap. (Likely
  green first try; if a structure grows unboundedly, that's a real find → red.)
- [ ] **Step 2:** Run — investigate any growth/throw.
- [ ] **Step 3:** Fix any leak/slowness found (bound the structure, reap correctly).
  Build `tool/soak.mjs` for the full-scale run.
- [ ] **Step 4:** Run full suite — PASS. **Manual:** run `node tool/soak.mjs 50 4 10`
  once; record heap-flat + tick p95 in the commit message / roadmap crib.
- [ ] **Step 5:** Commit: `test(net): soak harness — 50×4×10min flat memory, tick under budget`

---

### Task 4: Backpressure & lifecycle hardening (soak-driven)

**Why:** the soak's "memory flat" bar is only defensible if a **slow or stalled
client** can't make the server queue snapshots without bound, and if the process
**drains cleanly** on shutdown (so a deploy rollover doesn't drop saves). Scope is
strictly what the soak/deploy require — no gameplay.

**Files:**
- Modify: `server/server.js` — (a) **outbound backpressure:** in the fan-out loop,
  skip (drop) a peer's snapshot when `ws.bufferedAmount` exceeds a cap (a stale
  snapshot is worthless anyway — the next tick supersedes it); count drops in metrics.
  (b) **caps:** `MAX_ROOMS` / `MAX_CONNECTIONS` guards — a join past the cap is a clean
  kick (`ERR` reason), not an OOM. (c) **graceful shutdown:** on SIGTERM, stop
  accepting, flush a final save for every live non-dead player (reuse `saveForPlayer`),
  then `close()`. Bound the drain with a timeout.
- Modify: `server/protocol.js` — add the new `ERR` reasons (`server_full`) if used.
- Test: `test/server.test.js` (backpressure drop path with a fake slow socket; cap
  kick; SIGTERM-drain flushes saves via an injected store spy).

**Interfaces:**
- `createServer` gains `opts.maxRooms` / `opts.maxConnections` (env
  `MAX_ROOMS`/`MAX_CONNECTIONS`, sane defaults). Over cap → `kick(ws, 'server_full')`.
- Backpressure cap `opts.sendBufferCap` (bytes, default generous — several snapshots).
  Over cap → skip this tick's snapshot for that peer, `metrics.incr('snapshotsDropped')`.
- `close()` already terminates sockets; add a `drain()` that saves-then-closes for the
  SIGTERM path (the existing `if (require.main) shutdown` wires it).

- [ ] **Step 1: Failing tests** — a peer whose socket reports a huge `bufferedAmount`
  is skipped in fan-out (spy the send); a join past `maxRooms`/`maxConnections` is
  kicked with `server_full`; SIGTERM-drain calls `saveForPlayer` for each live player
  before close (injected store spy sees the writes).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement caps, backpressure skip, graceful drain.
- [ ] **Step 4:** Run — PASS; re-run `tool/soak.mjs` with a deliberately throttled bot
  to confirm memory stays flat under a slow client.
- [ ] **Step 5:** Commit: `feat(net): outbound backpressure, connection caps, graceful drain`

---

### Task 5: Dockerfile, compose, and "Host your own server" docs

**Why:** the deliverable is something a stranger can run. Ship a container, a one
command Postgres-included stack, and the docs that connect it to a real domain over
TLS.

**Files:**
- Add: `Dockerfile` — official `node:20-slim` (or `-alpine`); `WORKDIR /app`; copy
  `package*.json`; `npm ci --omit=dev` (only `ws`+`pg`); copy `server/` and the client
  (`js/`, `css/`, `index.html`, `verify.html`) so one image can both serve the static
  game and run the ws server if desired; run as a **non-root** user; `EXPOSE 8080`
  (+ `METRICS_PORT`); `HEALTHCHECK` hitting `/healthz`; `CMD ["node","server/server.js"]`.
- Add: `.dockerignore` — `node_modules`, `.git`, `test`, `docs`, `*.log`, editor dirs
  (keep the image lean; tests/docs don't ship).
- Add: `docker-compose.yml` — two services: `db` (`postgres:16`, volume-backed) and
  `server` (build `.`, `DATABASE_URL` wired to `db`, `PORT`/`METRICS_PORT` set,
  `depends_on` db). One `docker compose up` → a persistent co-op server.
- Modify: `README.md` — a **"Host your own server"** section:
  - env vars: `PORT`, `DATABASE_URL`, `METRICS_PORT`, `MAX_ROOMS`/`MAX_CONNECTIONS`.
  - the metrics/health endpoints and what they report.
  - **TLS termination:** the server speaks `ws://`; put a reverse proxy (Caddy/nginx)
    in front to terminate TLS and forward to the ws port, and **serve the static
    client over the same HTTPS origin** — the client already upgrades to `wss://`
    automatically when loaded over HTTPS (`js/main.js:50`), and connects to port 8080
    on the page's hostname, so the proxy must expose the ws upstream accordingly (or
    the client's `:8080` assumption is revisited — note it explicitly). Give a minimal
    Caddyfile/nginx snippet.
  - restate the **offline-only artifact** constraint (unchanged).
- Test: none automated for the image itself (Docker isn't in the node suite);
  **manual verification** is the exit step. Optionally a tiny `test/` check that
  `Dockerfile`/`docker-compose.yml` exist and reference the expected entrypoint/ports
  (a cheap guard against drift) — keep it lint-weight, not a real build.

**Interfaces / decisions:**
- **Client-serving in the image is optional but included:** the same static files that
  are `python3 -m http.server`'d in dev are copied in, so a host can front them with
  the proxy from one image. The ws server itself does not need to serve them; document
  both (proxy serves static + ws upstream, OR static served separately).
- **Non-root, healthcheck, `--omit=dev`, pinned base tag** are the hardening musts.
- The `:8080` in the client URL is the one deploy sharp edge — the docs must either
  tell the proxy to expose ws on `<origin>:8080` or note that a single-origin deploy
  wants the client's port assumption made configurable (a follow-up if it bites).

- [ ] **Step 1:** Write `Dockerfile`, `.dockerignore`, `docker-compose.yml`, README
  section. (Optional lint-weight existence test.)
- [ ] **Step 2: Manual verification** — `docker build -t dungeon .` builds clean;
  `docker compose up` brings up db+server; register/login/select/host/join works from
  a browser against the container; a character survives a `docker compose restart
  server` (Postgres volume persists — the Phase 3 restart-resume proof, now over a
  container); `/healthz` and `/metrics` respond.
- [ ] **Step 3:** Full suite green (unchanged by infra); commit:
  `feat(deploy): Dockerfile, compose stack, and host-your-own-server docs`

---

### Task 6: Exit proof & roadmap close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md` (mark Phase 5
  landed with the results crib), `README.md` (final polish of the host section).
- Test: the whole suite; the two manual runs (full soak, Docker stack).

- [ ] **Step 1:** Confirm the exit criteria below are all met; capture the soak
  numbers (heap slope, tick p95 at 50×4×10min) and the Docker restart-resume result.
- [ ] **Step 2:** Update the roadmap: Phase 5 ✅, with the numbers and any follow-ups
  (e.g. the client `:8080`/single-origin note, multi-process sharding as future work).
- [ ] **Step 3:** Full suite green; commit:
  `docs(net): mark Phase 5 landed; hardening + deploy results`

---

### Exit criteria (from the roadmap)

- **Fuzz:** random/mutated payloads never crash a room — a seeded fuzz suite is in CI
  and a longer manual driver exists; `decode`/`validateClient` proven throw-free;
  every bad frame is kicked or ignored, never fatal to the room (Task 1).
- **Soak:** 50 rooms × 4 bots × 10 min runs with memory flat and tick under budget —
  the full `tool/soak.mjs` run is recorded, and a fast in-process virtual-clock slice
  guards it in CI (Tasks 3–4).
- **Observability:** a `/metrics` endpoint reports rooms, players, tick ms
  (avg/max/p95), messages in, dropped/kicked frames; logs are structured JSON with no
  secrets; `/healthz` for liveness (Task 2).
- **Deploy:** a non-root, healthchecked `Dockerfile` builds; `docker compose up` gives
  a persistent server + Postgres; README "Host your own server" covers env vars,
  metrics, and TLS termination; the artifact-is-offline note stands (Task 5).
- **No gameplay drift & solo untouched** — instrumentation changes no tick's outcome;
  the existing sim/room/replay tests stay green; solo play never touches this code.
- Full `node --test test/*.test.js` green throughout; new hardening/observability
  logic arrived test-first.
- Then merge `phase5-hardening-deploy` → `main` and mark Phase 5 landed. **This closes
  the multiplayer roadmap** (Phases 0–5 all shipped) — note any deliberate follow-ups
  (multi-process sharding, per-player town instances from Phase 4's open questions,
  the client single-origin port assumption) as future work rather than open phases.

## Open questions to resolve during implementation

1. **Soak in CI vs. manual.** The true 50×4×10min run is minutes of wall-clock and
   too slow for the default suite. Plan: a fast **in-process, virtual-clock** slice in
   `test/soak.test.js` (proves the invariants at reduced scale in <1s) + the full
   `tool/soak.mjs` as a documented pre-deploy manual run. Revisit if CI infra can
   afford a nightly full soak.
2. **Memory-flat measurement.** GC-timing makes `heapUsed` slopes noisy. Prefer
   asserting **bounded data structures** (no unbounded `Map`/array growth across
   churn) as the deterministic signal, with an optional `--expose-gc` heap-slope check
   as corroboration in the tool. Decide the primary signal during Task 3.
3. **Metrics format.** JSON is the plan (zero-dep, easy to assert). If Prometheus
   scraping is wanted later, add a `text/plain; version=0.0.4` rendering of the same
   snapshot — a formatting addition, not a redesign. Ship JSON first.
4. **Client `:8080` under a single-origin proxy.** The client hardcodes port 8080 on
   the page hostname. A clean single-origin HTTPS deploy (game + ws on `443`) wants
   this configurable. Task 5 documents the proxy workaround; making the port/path
   configurable is a small client follow-up flagged in the close-out, not blocking.
5. **Graceful-drain scope (Task 4).** Draining saves on SIGTERM is clearly right;
   whether to also refuse-new-joins-then-wait-for-empty (a "lame duck" rollover) is a
   nicety — plan does the save-flush-then-close minimum; escalate only if zero-downtime
   rollover is a real requirement.
