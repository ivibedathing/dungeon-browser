# Phase 4.5 — Client Preload & Server Authority Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-16-dungeon-browser-design.md` (zero-asset constraint),
> `docs/superpowers/specs/2026-07-16-multiplayer-design.md`
> Roadmap: `docs/superpowers/plans/2026-07-16-multiplayer-roadmap.md`
> Predecessor: Phase 3 (accounts & server saves) landed 2026-07-18. This phase slots
> **after Phase 4** (co-op rules) and before Phase 5 (hardening & deploy), because Track C
> depends on Phase 4's attacker-aware combat refactor.
> **For agentic workers:** implement task-by-task, test-first. Every task keeps the full
> `node --test test/*.test.js` suite green; browser-only tasks add a manual verification
> step against a live server instead of a node test.

**Goal:** Move all per-frame presentation cost to a client boot phase that happens *once*,
give the client an optional real-asset upgrade path that never breaks the offline artifact,
serve the client over HTTP with proper caching, and — critically — draw a hard line so that
none of that client-side data can influence a server-authoritative number. Solo play stays
byte-for-byte the offline game it is today, and the game must remain fully playable from
`file://` with zero network.

**Architecture:** Three independent tracks that share one organizing idea: **client-side data
splits into two categories, and that split is a security boundary.**

- **Presentation data** — offscreen canvas caches, audio buffers, sprite files, colors,
  icon geometry, display labels. The server never reads it. Tampering with it changes only
  the cheater's own screen. Preload it freely; Tracks A and B are about doing that well.
- **Simulation data** — `js/balance.js`, item base stats, affix roll ranges, skill
  coefficients. The server loads its *own* copy from its own disk (`server/sim.js:12-17`)
  and treats the client's copy as a prediction convenience only. Track C makes this true
  where it currently isn't.

The load-bearing insight for Track C: the tables being shared is **not** the vulnerability.
`server/sim.js` already loads `js/*.js` into Node globals, so there is exactly one copy of
every table and the server reads it from disk it controls. The actual hole is that
progression never reaches the server at all — equip, buy, sell, blacksmith upgrade, and
`Skills.learn` run purely in client UI (`js/ui/input.js:57-136`), their edges are filtered
off the wire (`js/net.js:31`, `server/protocol.js:26-40`), and so the server's copy of an
online player runs `effectiveStats` on the starter loadout forever. The fix must be
**intents, not stats**: the client sends "equip bag slot 3", never "my damage is 47".

**Deliberately NOT in Phase 4.5** (owned elsewhere):
- **Attacker-aware combat** (`js/game/combat.js:66` `playerAttack` reads `state.player`
  rather than the acting player; same in `explode()` at `:107`) — **owned by Phase 4**,
  and a hard prerequisite for Track C. Do not fix it here; if Phase 4 has not landed,
  stop and land it first.
- **Deploy, TLS, process supervision, rate-limit tuning** — Phase 5. Track B adds an HTTP
  listener and cache headers, not a deployment.
- **Per-player quests, party UX, revive** — Phase 4.
- **Any new art direction.** Track A Task 4 builds the *loader*; it ships with an empty
  manifest and zero asset files. Actually authoring sprites is a separate, later concern.

**Tech Stack:** Plain browser JS + `node --test`. No new client dependencies and no client
build step. Track B's HTTP handler uses `node:http` + `node:fs` only — no Express, no
static-server package. `ws` and `pg` stay server-only.

## Global Constraints

- The full suite passes after **every** task.
- **The game must stay playable with zero network and zero asset files.** Every preload
  step has a procedural fallback that is the current behavior. If `fetch` throws, if the
  page is on `file://`, if the manifest is empty or missing — the game boots and plays
  exactly as it does today, just without the upgraded visuals. A test pins this.
- **Solo play must be indistinguishable before/after**, including boot time. The loading
  screen may not add a perceptible pause for solo-from-`file://`.
- **No client-supplied number may ever reach a server stat.** Track C's tests assert this
  directly, not incidentally.
- The claude.ai artifact stays offline-only (CSP blocks sockets). The service worker in
  Task 8 registers only under `http:`/`https:` and is a no-op on `file://`.

**Sizing note:** this is larger than the roadmap's usual ~1-session phase — roughly two.
Track C is separable and could land as its own Phase 4.6 if you want a smaller unit; the
tracks share no files except `server/server.js` (Tasks 7 and 9).

---

### Task 0: Branch

- [ ] Worktree at `../dungeon-browser-phase4_5`, branch `phase4_5-preload-authority`,
      based on `main` **after Phase 4 has merged**.
- [ ] **Confirm green baseline:** `node --test test/*.test.js 2>&1 | tail -3` → `pass NNN`
- [ ] **Confirm prerequisite:** `js/game/combat.js` `playerAttack` takes an acting player
      rather than reading `state.player`. If it does not, Phase 4 has not landed — stop.

---

## Track A — Client preload

### Task 1: Boot sequence and the `loading` screen

**Why first:** every other Track A task needs somewhere to run. Today there is no boot
phase at all — `js/main.js:52-53` calls `Save.load()` and `Game.newRun()` at module scope,
synchronously, unconditionally building a full run state (dungeon generation included)
even when the player is headed online. That work becomes step one of a real boot.

**Files:**
- Create: `js/boot.js` — the boot runner. Loaded early in `index.html` (after `js/util.js`,
  before `js/main.js`).
- Modify: `js/main.js` (`:38` add `'loading'` to the screen union and make it the initial
  screen; `:52-53` move `Save.load()`/`Game.newRun()` into a boot step; `:349-350` guard
  the `Render.draw(ctx, state, view)` backdrop, which dereferences `state` and will throw
  while `state` is still null; `:382` gate the first `requestAnimationFrame`).
- Modify: `index.html` (add the `js/boot.js` script tag in load order).
- Test: `test/boot.test.js` — step registration, ordering, progress accounting, and that
  a throwing step is non-fatal.

**Interfaces:**
- `Boot.step(name, fn, {weight = 1, required = false})` — register. `fn` may return a
  promise. Steps run in registration order.
- `Boot.run(onProgress)` → `Promise<{ok, failed: [{name, error}]}>`. `onProgress(frac, name)`
  fires per step. **A non-`required` step that throws is caught, recorded in `failed`, and
  does not reject** — this is the fallback guarantee, so a broken cache warm or a missing
  asset can never brick boot.
- `Boot.reset()` — test seam.

**Notes on the loading screen:** draw it with the existing UI primitives (`js/ui/draw.js`),
not DOM — the canvas is the only surface. Keep it to a progress bar and the step name. It
must not flash: if `Boot.run` resolves in under ~120ms (the solo-from-`file://` case), skip
rendering the screen entirely and go straight to `menu`.

- [ ] **Step 1: Failing tests** — (a) steps run in registration order; (b) `onProgress`
      reports weighted fractions ending at exactly 1; (c) a non-required step that throws
      is reported in `failed` and the run still resolves `ok: true`; (d) a `required` step
      that throws resolves `ok: false`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `js/boot.js`, then rewire `js/main.js`. Register the existing
      `Save.load()`/`Game.newRun()` work as the first step so behavior is unchanged.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(boot): boot runner and loading screen state`

---

### Task 2: Warm the procedural render caches

**Why:** all art is drawn per-frame from scratch — walls are beveled `fillRect` stacks
(`js/render/tiles.js:14-35`), floors run a per-tile hash (`js/render/core.js:8`), and every
item icon is hand-drawn vector geometry re-executed on every inventory frame
(`js/render/icons.js:6-47`). These outputs are pure functions of a small key, so they are
exactly what a cache is for, and warming them at boot removes the first-render hitch.

**Files:**
- Modify: `js/render/core.js` — add the cache registry.
- Modify: `js/render/tiles.js`, `js/render/icons.js` — draw through the cache.
- Test: `test/rendercache.test.js` — key derivation, hit/miss, memory bound, and that a
  cached draw is pixel-identical to an uncached one.

**Interfaces:**
- `Render.cached(key, w, h, drawFn)` → an `OffscreenCanvas`/`<canvas>` drawn once and
  reused. On a miss, allocates, runs `drawFn(ctx, w, h)`, stores, returns.
- `Render.warm()` — enumerate the finite key space (tile kinds × the small variant set,
  item kinds × rarities at inventory icon size) and populate. Registered as a `Boot.step`.
- `Render.cacheStats()` → `{entries, bytes}` — test seam and the memory bound.

**Notes:** key on everything the draw reads, including rarity color and DPR — a DPR change
on monitor switch must invalidate. Cap the registry (LRU or a hard ceiling with a warn);
an unbounded canvas cache is a memory leak. `Render.warm()` must be non-`required` so a
browser without `OffscreenCanvas` falls through to today's direct-draw path.

- [ ] **Step 1: Failing tests** — (a) same key returns the identical canvas object;
      (b) differing rarity/DPR produce distinct entries; (c) `cacheStats().bytes` stays
      under the ceiling after warming the full key space; (d) a cached icon and a direct
      draw produce identical `getImageData` for a fixed key.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Keep the direct-draw path intact as the fallback.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `perf(render): offscreen caches for tiles and icons, warmed at boot`

---

### Task 3: Pre-generate audio buffers

**Why:** `js/audio.js:42-45` builds noise buffers with `Math.random()` on demand — the
first time a given SFX fires, mid-combat. Buffer creation is the one genuinely expensive
part of an otherwise cheap oscillator path.

**Files:**
- Modify: `js/audio.js` (`:42-45` extract buffer creation behind a cache; add `Audio.warm()`).
- Test: `test/audio.test.js` — buffer reuse and idempotent warm. (New file; audio currently
  has no test.)

**Interfaces:**
- `Audio.warm()` → `Promise` — pre-creates every noise buffer. Registered as a `Boot.step`.
- Buffers keyed by `(kind, seconds)`; reused thereafter.

**Notes:** the `AudioContext` cannot start before a user gesture, and the existing code
already unlocks on first gesture. `Audio.warm()` must therefore be **safe to call with a
suspended context** — create buffers (which is legal while suspended) without resuming it.
Do not move the unlock into boot; that would either fail or require a click to reach the
menu.

- [ ] **Step 1: Failing tests** — (a) `warm()` then a play call allocates no new buffer;
      (b) `warm()` twice allocates once; (c) `warm()` with a suspended stub context
      resolves and does not resume it.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `perf(audio): pre-generate noise buffers at boot`

---

### Task 4: Optional real assets with procedural fallback

**Why:** this is the task that reconciles "we want real assets" with the standing design
constraint that the game ships as a single offline artifact with **no external assets**
(`docs/superpowers/specs/2026-07-16-dungeon-browser-design.md:40`). The resolution is that
assets are an **upgrade, never a requirement**: the loader tries the manifest, and every
entry that fails to load resolves to the procedural draw function that renders it today.
A player on `file://` with no server sees exactly the current game.

**Files:**
- Create: `js/assets.js` — manifest loader and the fallback resolver.
- Create: `assets/manifest.json` — **ships empty** (`{"version": 1, "entries": {}}`).
- Modify: `js/render/icons.js`, `js/render/tiles.js` — consult `Assets.get(id)` first,
  fall through to procedural.
- Modify: `index.html` — script tag.
- Test: `test/assets.test.js` — fallback on every failure mode.

**Interfaces:**
- `Assets.load(manifestUrl)` → `Promise<{loaded, failed}>`. Registered as a **non-required**
  `Boot.step`. Never rejects.
- `Assets.get(id)` → an `Image`/`ImageBitmap`, or `null` if unavailable.
- `Assets.available()` → boolean, for the one-time decision of which render path to take.
- Manifest entry: `{id, url, w, h, sha256}` (the hash is for Task 8's cache busting, not
  for security — see Task 10).

**Notes:** detect `location.protocol === 'file:'` and skip the fetch entirely rather than
generating a console error on every boot. Every render site must read `Assets.get(id)`
through a single helper so there is exactly one place the fallback branch lives. Assets are
**presentation-category** data by definition — nothing in `js/game/` or `server/` may ever
import from `js/assets.js`, and Task 10 pins that with a test.

- [ ] **Step 1: Failing tests** — (a) empty manifest → `Assets.available()` false and every
      icon still renders; (b) a 404 on one entry → that entry falls back, others load;
      (c) a malformed manifest → `load` resolves, does not reject; (d) `file:` protocol →
      no fetch attempted; (e) no module under `js/game/` or `server/` references `Assets`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(assets): optional asset manifest with procedural fallback`

---

## Track B — Serving and caching

### Task 5: HTTP server alongside the WebSocket server

**Why:** the server currently serves nothing. `server/server.js:41` calls
`new WebSocketServer({ port })`, which binds the port directly — there is no
`http.createServer` anywhere in the repo, and the README tells you to serve the client
out-of-band with `python3 -m http.server 8321`. That also explains the awkward hardcoded
port split at `js/main.js:50` (`ws://host:8080` while the page came from :8321). One
origin fixes both.

**Files:**
- Modify: `server/server.js` (`:41` construct `http.createServer` and pass `{ server }` to
  `WebSocketServer` instead of `{ port }`; add the static handler; `:353-363` script entry).
- Create: `server/static.js` — path resolution, MIME map, cache headers.
- Modify: `js/main.js:50` — derive the WS URL from `location` including port, so same-origin
  deployment needs no port constant.
- Modify: `README.md` — document `npm start` serving both.
- Test: `test/static.test.js` — MIME, headers, and traversal rejection.

**Interfaces:**
- `createStatic({root})` → `(req, res) => handled: boolean`.
- Cache policy: `index.html` and `assets/manifest.json` → `no-cache` (must revalidate, so a
  deploy is picked up); everything else → `Cache-Control: immutable, max-age=31536000`
  **only when the URL carries a content hash**, otherwise `max-age=0, must-revalidate` with
  an `ETag`. Never serve unhashed JS as immutable — that ships a stale client that then
  desyncs against a new protocol.

**Notes:** reject `..` and absolute paths before touching the filesystem; resolve and then
verify the result is still under `root`. Serve only an allowlist of extensions. This must
not change the `{ port: 0 }` hermetic-test path — `createServer` still returns an object
whose `close()` tears down both listeners.

- [ ] **Step 1: Failing tests** — (a) `GET /index.html` → 200 + `text/html` + `no-cache`;
      (b) `GET /js/main.js` → 200 + `application/javascript` + `ETag`; (c) `GET /../../etc/passwd`
      and encoded variants → 403, no filesystem read; (d) `GET /nope.png` → 404; (e) a WS
      client still connects on the same port; (f) `{port: 0}` still works for tests.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(server): serve the client over HTTP on the ws port`

---

### Task 6: Service worker offline shell

**Why:** with Track B serving over HTTP, a service worker makes the online client boot
from cache and survive a flaky connection. It is also the only piece of Track A that
persists across sessions.

**Files:**
- Create: `sw.js` — precache the script list + manifest, cache-first for hashed URLs,
  network-first with cache fallback for `index.html`.
- Modify: `js/boot.js` — register the worker as a non-required boot step.
- Test: `test/sw.test.js` — the precache list matches `index.html`'s script tags.

**Notes:** register **only** when `location.protocol` is `http:`/`https:` and
`'serviceWorker' in navigator` — on `file://` and inside the claude.ai artifact this is a
silent no-op, per the global constraint. Version the cache name and delete old caches on
`activate`, or a stale worker outlives a protocol change.

The precache list is the one real maintenance hazard: `index.html:11-45` is 35 hand-ordered
script tags, and a worker that precaches a drifted list will serve a half-updated client.
The test must parse `index.html` and assert the lists match exactly, so adding a script tag
without updating `sw.js` fails the suite.

- [ ] **Step 1:** Write the precache-parity test (parse `index.html` script `src`s, compare
      to `sw.js`'s list) — FAIL until `sw.js` exists.
- [ ] **Step 2:** Implement `sw.js` + registration.
- [ ] **Step 3: Manual verification** — `npm start`, load, confirm the worker activates in
      devtools, go offline, reload, confirm the client still boots and reaches the menu.
      Then confirm `file://` still boots with no worker and no console error.
- [ ] **Step 4:** Full suite green; commit: `feat(sw): offline shell for the http-served client`

---

## Track C — Server authority

> Track C is where "client-side tables cannot be used to cheat" actually gets enforced.
> Read the Architecture note above first: the shared tables are fine; the missing
> progression path is not.

### Task 7: Progression intents on the wire

**Why:** this is the phase's most important task. Today equip / bag-click / buy / sell /
blacksmith-upgrade / learn-skill are client-only (`js/ui/input.js:57,75,96,104-108,119-136`),
their edges are stripped outbound (`js/net.js:31`) and rejected inbound
(`server/protocol.js:26-40`). So an online player's server-side character never changes
gear and never learns a skill — `Entities.effectiveStats` runs on the starter loadout for
the whole session. Online progression is effectively broken, and the tempting fix (let the
client report its computed stats) is precisely the cheat vector to avoid.

**The rule: intents, not stats.** The client sends `{equip, slot: 3}`. The server looks up
slot 3 in *its own* copy of that player's bag, validates the item exists and is equippable,
applies it, and recomputes stats from *its own* `Balance`/`Items` tables. No number from the
client is ever stored or trusted. The client keeps applying the change locally too, for
prediction; the next snapshot corrects it if the server disagreed.

**Files:**
- Modify: `server/protocol.js` (`:26-40` add the intent messages to the validated set with
  strict shape + bounds; add a rate-limit bucket alongside the existing three at `:57-59`).
- Modify: `server/server.js` (`:267-284` dispatch table) and `server/room.js` — apply intents
  against room state.
- Create: `server/intents.js` — validate-and-apply, one function per intent, each returning
  `{ok, reason}` and mutating nothing on failure.
- Modify: `js/net.js:31` — send intents; `js/ui/input.js` — emit intents in online mode
  while keeping the local apply for prediction.
- Test: `test/intents.test.js` — the authority suite.

**Interfaces:**
- `equip {slot}` / `unequip {slotName}` / `buy {index}` / `sell {slot}` / `upgrade {slotName}` /
  `learn {skillId}`.
- Every payload carries **only indices and ids** — never stats, prices, damage, or item
  objects. Enforce this at the protocol layer: reject any intent message carrying an
  unexpected key rather than ignoring extras, so a forged stat field is a kick, not a no-op.
- `Intents.apply(state, player, msg, {rng})` → `{ok, reason}`.

**Notes:** prices come from the server's `RARITY_VALUE` (`js/items.js:333`) against the
server's copy of the shop roll (`js/game/town.js:34-41`), never from the client. `learn`
must re-check skill-point cost and prerequisites against `js/skills.js:7` server-side.
Rejected intents need to reach the client (a `reject {seq, reason}` frame) or prediction
will silently diverge and the player will see an item flicker back with no explanation.

- [ ] **Step 1: Failing tests** — (a) `equip {slot}` changes server-side `effectiveStats`;
      (b) an intent carrying an extra `damage`/`price`/`stats` key is **rejected**, and the
      server's numbers are unchanged; (c) `buy` with insufficient gold is rejected and gold
      is unchanged; (d) `buy` at an out-of-range index is rejected without throwing;
      (e) `learn` with no skill point is rejected; (f) `equip` at an empty or out-of-range
      slot is rejected; (g) intents are rate-limited like other client messages;
      (h) after a rejected intent the next snapshot restores the client's view.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement server side first, then the client emit path.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `feat(net): progression intents validated server-side`

---

### Task 8: Harden the character blob boundary

**Why:** `server/character.js:41-78` (`playerFromCharacter`) copies `sp.level`,
`sp.baseMaxHP`, `sp.baseDamage`, `sp.skills`, and `sp.equip` straight in with `||` defaults
and no bounds or schema check; only `hp`/`mana` are clamped (`:75-76`). That is safe *today*
only because the blob's sole writer is the server (`server/server.js:230`). It is a direct
stat-injection vector the moment any import path exists — and `imported` is already a
client-supplied flag (`server/protocol.js:199`, consumed at `server/server.js:126`). Task 7
adds the first write path that touches gear; this task makes the read path defensive before
that happens.

**Files:**
- Modify: `server/character.js` — validate and clamp on load.
- Create: `server/schema.js` — the blob schema and bounds, derived from `js/balance.js` so
  bounds cannot drift from the balance sheet.
- Test: `test/charschema.test.js`.

**Interfaces:**
- `Schema.validateCharacter(blob)` → `{ok, errors, sanitized}`. Unknown keys dropped,
  numeric fields clamped to Balance-derived ranges, `equip` entries re-validated against
  `Items` bases, `skills` keys checked against `Skills.SKILLS`.
- A blob that fails validation loads as a **fresh starter** with a logged error — never a
  partially-trusted character, and never a hard crash that locks the account out.

**Notes:** derive bounds from `Balance` rather than hardcoding, matching the convention in
`test/balance.test.js` of asserting the *wiring* to Balance rather than literal numbers.

- [ ] **Step 1: Failing tests** — (a) a blob with `level: 9999` clamps; (b) unknown keys are
      dropped; (c) an `equip` entry with an unknown base is rejected; (d) a `skills` key not
      in `Skills.SKILLS` is dropped; (e) a structurally broken blob yields a fresh starter,
      not a throw; (f) a legitimate round-trip (save → load) is byte-identical, so existing
      characters are unaffected.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `fix(net): validate and clamp character blobs on load`

---

### Task 9: Dereference ground items in snapshots

**Why:** `server/room.js:275-277` embeds a full item object in every `groundItems` entry —
measured at ~314 bytes for a rare, including denormalized affix `label` strings and
`color`/`tone` hex that the client can derive itself from tables it already has. Monsters
already ride as a `type` reference (`server/room.js:259`); items should too. This is both
the remaining bandwidth win and a concrete demonstration of the presentation/simulation
split: the *stats* stay server-side, only the *rendering inputs* are client-derived.

**Files:**
- Modify: `server/room.js:275-277` — project a reference.
- Modify: `js/net.js:432-462` (`interpolatedAt` copies ground items) and the render path —
  rehydrate display fields from local tables.
- Test: `test/snapshot.test.js` — round-trip fidelity and size.

**Interfaces:**
- Ground item on the wire: `{id, kind, x, y, amount, ref}` where `ref` is
  `{base, rarity, affixes: [{key, val}], tier}` — ids and rolled values only. `label`,
  `color`, `tone`, and computed display stats are regenerated client-side from
  `js/items.js`'s `AFFIXES` label functions (`js/items.js:86`) and `RARITIES` (`:8`).

**Notes:** `AFFIXES` values are **functions** (`roll`, `label`), which is why the key is the
stable id and `label` was denormalized in the first place — the client can call `label(val)`
locally, so only `{key, val}` needs to travel. Potion tiers are index-keyed
(`js/items.js:235,242`), so the index is already a valid ref. Item bases are keyed by their
display string (`'Short Sword'`) rather than a numeric id — acceptable as a ref, but note in
the Open Questions that renaming a base is now a wire break as well as a save break.

- [ ] **Step 1: Failing tests** — (a) a rehydrated ground item renders labels identical to
      the previously embedded object across all rarities and every affix key; (b) snapshot
      bytes for a floor with 10 ground items drop by a meaningful margin; (c) an unknown
      `base` or affix `key` in a ref renders a safe placeholder rather than throwing.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Full suite; commit: `perf(net): send ground items as refs, rehydrate client-side`

---

### Task 10: Pin the trust boundary with tests

**Why:** Tasks 7-9 establish the boundary; without tests asserting it *directly*, the next
feature quietly erodes it. This task encodes the architecture as executable rules.

**Files:**
- Test: `test/authority.test.js`.

**The assertions:**
- **No presentation import in sim or server.** No file under `js/game/` or `server/`
  references `Assets`, `Render`, or `Audio`. (Static source scan — crude, but it is the
  check that would actually have caught the mistake.)
- **Forged stat fields never land.** For each intent, send a payload with injected
  `damage`/`maxHP`/`price`/`gold`/`level` keys; assert rejection and that the server's
  numbers are byte-identical to a clean run.
- **A tampered client table changes nothing server-side.** Mutate the client's `Balance`
  copy in a test harness, drive a full combat exchange, and assert server damage/XP/loot
  match the untampered baseline. This is the literal statement of the requirement.
- **Snapshot refs are not trusted inbound.** The server must never accept a ground-item
  ref from a client as authoritative; pickup remains position-derived server-side.
- **Every stat the server stores is server-computed.** Enumerate the persisted character
  fields and assert each traces to a server-side computation, not a received value.

**Notes:** be explicit in the test file's header comment that **client-side integrity
checks are not a security boundary** — the `sha256` in the asset manifest (Task 4) is for
cache busting only. A determined client controls its own process; the only real boundary is
that the server recomputes from its own tables. Anyone reading these tests later needs to
know which line is load-bearing.

- [ ] **Step 1:** Write all assertions. Expect some to fail if Tasks 7-9 left gaps — that
      is the point of writing them last.
- [ ] **Step 2:** Fix whatever they surface.
- [ ] **Step 3:** Run — PASS.
- [ ] **Step 4:** Full suite; commit: `test(authority): pin the client/server trust boundary`

---

### Exit criteria

- The client boots through a real preload phase: caches warm, audio buffers ready, assets
  resolved-or-fallen-back, before the first playable frame.
- The game still boots and plays fully from `file://` with no server, no assets, and no
  service worker — verified manually, not just asserted.
- `npm start` serves the client and the WebSocket on one origin with correct cache headers.
- An online player can equip, buy, sell, upgrade, and learn skills, and the **server's**
  copy of their character reflects every one of those changes.
- A tampered client table demonstrably cannot change a server-side number (Task 10).
- Full `node --test test/*.test.js` green throughout; new logic arrived test-first.
- Then merge `phase4_5-preload-authority` → `main` and mark Phase 4.5 landed in the
  roadmap, with a crib for Phase 5.

## Open questions to resolve during implementation

1. **Should Track C be its own phase?** Recommended default: keep it here, because Task 9
   (snapshot refs) is the seam where the presentation/simulation split becomes concrete and
   it wants to be adjacent to Track A's reasoning. Split it into Phase 4.6 if Track A+B
   alone already fills a session. Revisit at the end of Task 6.
2. **Do item bases need numeric ids?** Bases are keyed by display string (`'Short Sword'`,
   `js/items.js:30`). Task 9 puts that string on the wire, so renaming a base becomes a wire
   break *and* a save break. Recommended default: keep strings — the table is small, the
   churn is low, and numeric ids add a migration for no present benefit. Revisit if a rename
   is ever actually needed, or if snapshot size becomes the binding constraint again.
3. **How much does prediction diverge once intents are rejected?** Task 7 keeps the local
   apply for responsiveness, so a rejected `buy` shows the player an item they do not own
   until the next snapshot. Recommended default: apply locally and correct, with the
   `reject` frame driving a UI message. If rejections turn out to be common rather than
   adversarial-only, switch equip/buy to server-confirmed (no local apply) and accept the
   round-trip latency.
4. **Does `Save.load()` belong before or after the network attempt?** It currently runs at
   module scope (`js/main.js:52`) and builds a full run state even for online play — wasted
   dungeon generation on the online path. Recommended default: keep it as boot step one to
   avoid behavior change, and file the online-path skip as a follow-up. Revisit if boot
   time is measurably bad on mobile.
5. **What is the memory ceiling for the render cache?** Task 2 caps it, but the right number
   depends on the real key space once rarity × DPR × tile variants are enumerated.
   Recommended default: start at 32 MB with a warn-on-evict, measure with `cacheStats()`,
   and tighten. Revisit if mobile Safari evicts canvases under pressure.
