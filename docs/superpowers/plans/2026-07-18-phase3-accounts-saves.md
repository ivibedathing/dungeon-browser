# Phase 3 — Accounts & Server Saves Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Roadmap: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md`
> Predecessors: Phase 1 (server/protocol) and Phase 2 (client netplay) landed.
> **For agentic workers:** implement task-by-task, test-first. The default suite
> (`node --test test/*.test.js`) must stay green with **zero external services**;
> the real-Postgres path is proven by a Docker-backed integration test run during
> development and gated behind `DATABASE_URL` so normal runs skip it.

**Goal:** Persist heroes on the server so a character survives a server restart and
follows the player across sessions — register/login, character select (max 8), and
server-side saves on the roguelite triggers — while solo play stays the offline,
localStorage game it is today.

**Storage decision (chosen by the project owner):** Postgres (client-server,
multi-writer), designed for horizontal scale from day one, not SQLite. Driver is
`pg` (pure JS — no native build; install stays toolchain-free). Password hashing is
**scrypt via `node:crypto`** (no native dep; argon2 avoided to keep the toolchain
clean). This is a deliberate deviation from the roadmap's better-sqlite3 note.

**Architecture.** All persistence lives behind one async module, `server/store.js`,
which exposes a small interface and two implementations:
- `PgStore` — real Postgres via a `pg` pool; the production path.
- `MemStore` — in-memory, same interface; powers the fast test suite and lets the
  server run with no DB for local dev (with a loud "non-persistent" startup warning).

`createStore({ databaseUrl })` returns `PgStore` when a URL is set, else `MemStore`.
A single **parametrized store test** runs the identical behavioral suite against
`MemStore` always, and against `PgStore` when `DATABASE_URL` points at a reachable
Postgres — so the two backends can never drift, and the real SQL is covered whenever
a DB is available (I boot one via Docker during implementation to prove it green).

The store is **async**; the 30 Hz simulation loop must never await it. Save triggers
are fire-and-forget (`store.saveCharacter(...).catch(logSaveError)`); auth/character
messages are awaited in the connection's message handler, before the player joins a
room. The join flow gains a precondition: a connection must be authenticated **and**
have a selected character before `join`; the room then builds that player from the
stored character blob instead of a fresh starter.

**Character blob.** Exactly today's `Save.snapshot(state)` shape (versioned JSON):
runSeed, floor, kills, time, milestones, quests, player{...}, bag. Stored as `jsonb`.
Phase 2's online hero was a fresh starter; Phase 3 replaces `freshPlayer` with
`playerFromCharacter(blob)` on join.

**Tech Stack:** server adds `pg`. Client stays zero-build (login/select screens are
canvas UI like the menu). Tests: `node --test`, plus a Docker-Postgres integration
run that is skipped without `DATABASE_URL`.

## Global Constraints

- Default `node --test test/*.test.js` passes with **no external services** (MemStore).
- Solo play unchanged: localStorage remains the solo save; online uses the server.
- The 30 Hz loop never blocks on I/O — every save is fire-and-forget.
- Passwords are never logged, never sent back, and stored only as a scrypt digest.
- Session tokens are opaque random bytes, server-stored with an expiry; the client
  keeps its token in localStorage to auto-resume.
- The claude.ai artifact stays offline-only (no sockets → login screen simply isn't
  reachable there; the menu already reports online is unavailable).

---

### Task 0: Branch & dependency

**Files:** `package.json`, `package-lock.json`.

- [x] Worktree `../dungeon-browser-phase3` on `phase3-accounts-saves` from `main`.
- [ ] `npm install pg` (pure JS). Confirm no native build in the install log.
- [ ] Baseline: `node --test test/*.test.js` → `pass 210`.
- [ ] Commit: `chore(net): add pg for server-side persistence`.

---

### Task 1: `server/store.js` — interface, MemStore, PgStore, hashing, tokens

**Files:**
- Create: `server/store.js`, `server/store.sql` (schema), `server/crypto.js` (scrypt
  hash/verify + token mint).
- Test: `test/store.test.js` (parametrized over MemStore + optional PgStore).

**Interfaces** (all async, Promise-returning):
- `createStore({ databaseUrl }) -> store`
- `store.init()` — MemStore: no-op; PgStore: ensure schema (run `store.sql`), set WAL-
  equivalent tuning is N/A for PG; create pool.
- `store.close()` — release the pool.
- Accounts: `createAccount(username, password) -> {id, username}` (throws
  `TAKEN` on dup, case-insensitive); `verifyLogin(username, password) -> account|null`.
- Sessions: `createSession(accountId) -> {token, expiresAt}`;
  `resolveSession(token) -> account|null` (null if expired/unknown);
  `destroySession(token)`.
- Characters: `listCharacters(accountId) -> [{slot,name,level,updatedAt,imported}]`;
  `createCharacter(accountId, slot, blob) -> char` (throws `SLOT_TAKEN`, `TOO_MANY`
  at 8); `loadCharacter(accountId, slot) -> blob|null`;
  `saveCharacter(accountId, slot, blob) -> void` (upsert by (account,slot), bumps
  `updated_at`); `deleteCharacter(accountId, slot)`.
- `server/crypto.js`: `hashPassword(pw) -> string` (format `scrypt$N$r$p$b64salt$b64hash`),
  `verifyPassword(pw, stored) -> bool` (timing-safe), `mintToken() -> string`
  (`randomBytes(32).base64url`).

**Schema** (`server/store.sql`, Postgres):
```sql
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,      -- lower(username), the uniqueness key
  pw_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  imported BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, slot)
);
```

- [ ] **Step 1: Failing tests** — a `runStoreSuite(makeStore)` function asserting:
  register then duplicate (case-insensitive) → TAKEN; login right/wrong password;
  session create/resolve/expire/destroy; character create up to 8 then TOO_MANY;
  slot uniqueness; save (upsert) round-trips the blob and bumps updatedAt; load of a
  missing slot → null; delete. Call it once with `MemStore`. Guard a second call with
  `PgStore` behind `if (process.env.DATABASE_URL)`.
- [ ] **Step 2:** Run — FAIL (`store.js` undefined).
- [ ] **Step 3:** Implement `crypto.js`, then `MemStore`, then `PgStore` (same
  interface; parametrized queries only — never string-interpolate user input).
- [ ] **Step 4:** Run — PASS against MemStore. Then **boot Docker Postgres** and run
  with `DATABASE_URL` set to prove `PgStore` green (see Task 6 harness for the exact
  `docker run` line; the same command serves here).
- [ ] **Step 5:** Full suite; commit:
  `feat(net): store.js — Postgres/in-memory accounts, sessions, characters`.

---

### Task 2: Protocol — auth & character messages

**Files:** `server/protocol.js`; `test/protocol.test.js`.

**New client messages** (validated like the rest — reject, don't coerce):
- `register {username, password, name, shirt}`
- `login {username, password}`
- `resume {token}`
- `listChars {}`
- `createChar {slot, name, shirt}`
- `deleteChar {slot}`
- `selectChar {slot}`

**Constraints:** username `^[a-zA-Z0-9_]{3,20}$`; password length 8..128 (bytes bounded
by `MAX_MSG_BYTES`); slot integer 0..7; name reuses the existing name-clean. Password
is validated but **never** echoed. `register`/`login` are control-rate-limited (a
stricter bucket than gameplay; add `AUTH_LIMIT`).

**New server messages** (documented, produced in Task 3): `authed {token, characters}`,
`authError {reason}`, `characters {list}`, `charError {reason}`.

- [ ] Steps 1–5 as usual: failing validator tests (good/bad username, short password,
  out-of-range slot, missing token), implement, green, commit
  `feat(net): protocol for register/login/resume and character select`.

---

### Task 3: Server auth, sessions, and character-gated join

**Files:** `server/server.js`; `test/server.test.js` (extend with auth flow).

**Connection state (`ws._peer`) gains:** `accountId`, `token`, `characters` cache,
`selectedSlot`. A connection is `authed` when `accountId` is set.

**Message handling (async now):**
- `register` → `store.createAccount` → `createSession` → reply `authed` + empty list
  (or with any existing chars). Dup → `authError {reason:'taken'}`.
- `login` → `verifyLogin` → session → `authed` + `listCharacters`. Bad creds →
  `authError {reason:'bad_credentials'}` (do not distinguish user-vs-pass).
- `resume {token}` → `resolveSession` → `authed` + list, or `authError`.
- `createChar {slot,name,shirt}` → build a starter blob (Save-shape via a small
  server helper mirroring `Game.newRun` + `Save.snapshot`) → `store.createCharacter`
  → reply `characters`. `selectChar {slot}` → load blob, cache on peer.
- `join` now requires authed + selected; otherwise `error {reason:'not_authed'}`.
  The room join uses the loaded character blob.

**Room change:** `Room.join(opts)` accepts an optional `character` blob; when present it
builds the player via `playerFromCharacter(blob)` (position still set to the entry).
`freshPlayer` remains the fallback for anonymous/testing.

- [ ] Steps 1–5: extend `server.test.js` with a scripted ws client that registers,
  creates a character, selects it, joins, and sees the loaded stats (e.g. a non-starter
  level round-trips). Bad-auth and join-before-auth paths rejected. Commit
  `feat(net): server auth, sessions, and character-loaded room join`.

---

### Task 4: Save triggers & roguelite wipe

**Files:** `server/room.js`, `server/server.js`; `test/room.test.js` / `server.test.js`.

**Triggers (all fire-and-forget, never awaited in the tick):**
- Level-up and floor-change: the room detects the transition for a player and calls
  `onCharacterProgress(player)` → server persists that player's blob.
- Item-change debounce: on bag/equip change, schedule a save at most every ~5 s.
- Disconnect: flush the leaving player's blob synchronously-scheduled (fire-and-forget).
- Room close (last leave): already reaped; ensure any pending debounced save flushes.
- **Death wipes the run** (roguelite): when a player dies, the character's stored blob
  is reset to a fresh starter of the same name/shirt (not deleted — the slot persists),
  matching today's `Save.clear()` on death.

The room emits progress via a callback the server sets (`room.onSave = (playerId, blob)
=> ...`), keeping the room ignorant of the store. Blob is built by a shared
`characterBlob(state, player)` helper (server-side Save.snapshot equivalent that reads
one player rather than `state.player`).

- [ ] Steps 1–5: tests that a level-up schedules a save with the new level, a death
  resets the stored blob to a starter, and a disconnect flushes. Use MemStore + a spy.
  Commit `feat(net): server-side save triggers and death-wipes-run`.

---

### Task 5: Client screens & main.js wiring

**Files:** `js/net.js` (auth senders + token storage), `js/ui/menu.js` or new
`js/ui/account.js` (login/register + character-select screens), `js/main.js`, `index.html`.

- Online now routes: menu → **Account** (login/register; auto-`resume` if a stored
  token exists) → **Character Select** (up to 8 slots; create/pick/delete) → Host/Join
  → playing. The Host/Join buttons move behind character-select.
- `Net` gains: `register/login/resume/createChar/selectChar/deleteChar` senders,
  `net.token` persisted to localStorage (`dungeon-browser.token.v1`), and handlers for
  `authed`/`characters`/`authError` updating `net.account`/`net.characters`.
- **Optional localStorage import:** on character select, if a solo localStorage save
  exists and no server character occupies a slot, offer "Import your local hero" once;
  it uploads the blob flagged `imported`. One-time (guarded by a prefs flag).
- Node-testable bits (senders, token persistence via injected storage) get a test;
  the screens are manual + a headless Chrome smoke like Phase 2.

- [ ] Steps: implement, syntax-check, headless-Chrome smoke (register → create → select
  → host → play), commit `feat(net): account and character-select client screens`.

---

### Task 6: Exit — persistence across restart (real Postgres) + docs

**Files:** `test/persistence.test.js` (gated), roadmap + README.

**The exit proof** (the roadmap's Phase 3 criterion): a Docker-Postgres-backed test,
skipped unless `DATABASE_URL` is set:
1. Boot server with the DB, register, create+select a character, join, play until a
   save trigger fires (level or floor), capture the stored level/floor.
2. Close the server (simulating a crash), reopen a new server on the same DB.
3. `resume {token}` (or login) + `selectChar` + `join` → the character resumes at the
   saved level/floor, exactly like today's localStorage proof.

**Docker harness** (documented in the test + README "Host your own server"):
```
docker run -d --name db-dungeon -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
npm start           # server auto-runs store.init()
node --test test/*.test.js   # now also runs the gated PgStore + persistence tests
```

- [ ] Boot Docker Postgres, run the full gated suite green (I do this during dev).
- [ ] Mark Phase 3 landed in the roadmap with a Phase 4 crib; README gains "Host your
  own server" with the Postgres/Docker setup and the offline-artifact caveat restated.
- [ ] Merge `phase3-accounts-saves` → `main`.

---

## Exit criteria

- Kill the server mid-run, restart against the same Postgres, character resumes from
  the server exactly like today's localStorage proof (gated integration test).
- Register/login/character-select work in a real browser (headless smoke + manual).
- Default `node --test test/*.test.js` stays green with no external services (MemStore);
  the PgStore + persistence paths pass against Docker Postgres.
- Solo play unchanged.

## Open questions to resolve during implementation

1. **pg pure-JS confirmation.** Verify `npm install pg` pulls no native build. If a
   transitive native dep sneaks in, pin around it (pg core is pure JS).
2. **Session TTL & refresh.** Start with a 30-day token; refresh `expires_at` on
   `resume`. Revisit if it feels wrong.
3. **Shared-bag reality.** Phase 2 left `state.bag`/gold shared per room; a character's
   saved bag is its own `bag` blob, but co-op loot attribution is Phase 4. For Phase 3,
   save each player's *own* character fields; the shared bag is saved to whoever the
   sim attributes it to — flag this seam for Phase 4 to make loot per-player.
4. **Concurrent logins of one character.** Guard against the same (account,slot) being
   live in two rooms at once (last-write-wins would corrupt). Simplest: refuse `join`
   if that character is already active on the server; note it if deferred to Phase 4.
