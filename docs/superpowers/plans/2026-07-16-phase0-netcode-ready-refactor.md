# Phase 0 — Netcode-Ready Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the simulation so a server can run it per-room (entity ids, multiple players, event-driven juice, multi-source AI, fixed tick, seeded sim RNG) with zero behavior change to solo play.

**Architecture:** All changes live inside the existing pure-JS modules (`js/game.js`, `js/dungeon.js`, plus one-line hooks in `js/main.js` and two test helpers). No server, no new files except tests. The sim emits events; presentation consumes them — locally today, over the wire in Phase 2.

**Tech Stack:** Plain browser JS + `node --test`. No new dependencies.

## Global Constraints

- The full existing suite (`node --test test/*.test.js`, 81 tests) must pass after **every** task.
- Client stays zero-build: plain script tags, node-require guards, no npm deps.
- Solo gameplay must be indistinguishable before/after (same controls, same juice).
- New sim-visible randomness must come from `state.srand` (Task 6); cosmetic randomness stays `Math.random`.
- All work happens on a git branch created in Task 0.

---

### Task 0: Initialize version control

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Produces: a git repo with a tagged baseline every later task commits into.

- [ ] **Step 1: Init repo and ignore junk**

```bash
cd ~/Projects/dungeon-browser
git init
printf 'node_modules/\n.DS_Store\n' > .gitignore
```

- [ ] **Step 2: Verify the suite is green before baseline**

Run: `node --test test/*.test.js 2>&1 | tail -4`
Expected: `pass 81` / `fail 0`

- [ ] **Step 3: Baseline commit and phase branch**

```bash
git add -A
git commit -m "chore: baseline before multiplayer phase 0"
git checkout -b phase0-netcode-refactor
```

---

### Task 1: Stable entity ids

**Files:**
- Modify: `js/game.js` (`Game.newRun`, `makeFloorState`, `dropLoot`, `Game.bagDrop`, `playerAttack` ranged branch, `Game.castSkill` nova branch, `travel` town-entry groundItems stay empty — no change)
- Test: `test/netready.test.js` (new file, grows through Phase 0)

**Interfaces:**
- Produces: every monster, projectile, and ground item has `id` (positive int, unique per run, never reused); `state.nextId` counter on the run state.

- [ ] **Step 1: Write the failing test**

```js
// test/netready.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');

function freshInput() {
  return { keys: { w: false, a: false, s: false, d: false, space: false }, pressed: new Set(), mouse: { x: 0, y: 0, click: false, rclick: false } };
}
function run(state, input, frames) {
  for (let i = 0; i < frames; i++) { state = Game.update(state, input, 1 / 60); input.pressed.clear(); }
  return state;
}

test('monsters, projectiles and drops carry unique, stable, never-reused ids', () => {
  let state = Game.newRun(21);
  const ids = state.monsters.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'monster ids unique');
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 0));
  const firstId = state.monsters[0].id;
  state = run(state, freshInput(), 30);
  assert.equal(state.monsters[0].id, firstId, 'ids stable across updates');

  // Ranged attack produces an id-carrying projectile.
  state.monsters.length = 0;
  state.player.equip.weapon = Items.makeItem(1, U.mulberry32(1), { slot: 'weapon', kind: 'bow' });
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);
  assert.ok(state.projectiles[0].id > 0, 'projectile has id');

  // Descending must not reuse ids from the previous floor.
  const oldIds = new Set(ids);
  state.player.x = (state.dungeon.stairs.x + 0.5) * 32;
  state.player.y = (state.dungeon.stairs.y + 0.5) * 32;
  state = run(state, freshInput(), 3);
  assert.equal(state.floor, 2);
  for (const m of state.monsters) assert.ok(!oldIds.has(m.id), `id ${m.id} reused`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js`
Expected: FAIL — `m.id` is `undefined`.

- [ ] **Step 3: Implement ids**

In `js/game.js`:

```js
// In Game.newRun's state literal, add:
      nextId: 1,

// In makeFloorState, the monster mapping gains an id:
    state.monsters = dungeon.spawns.map((s) => ({
      ...Entities.makeMonster(s.type, state.floor, s.champion),
      id: state.nextId++,
      // ...existing fields unchanged
    }));

// Every state.groundItems.push({...}) in dropLoot and Game.bagDrop gains:
      id: state.nextId++,

// Every state.projectiles.push({...}) (playerAttack ranged branch and the
// castSkill nova loop) gains:
      id: state.nextId++,
```

Note: `makeFloorState` must NOT reset `nextId` (monotonic across floors). `Game.fromSave` is safe: it builds on `newRun`, and ids are transient (never serialized).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS.

- [ ] **Step 5: Full suite, then commit**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 82` / `fail 0`

```bash
git add js/game.js test/netready.test.js
git commit -m "feat(net): stable entity ids for snapshot addressing"
```

---

### Task 2: Event-driven juice (floats, bursts, messages, sfx)

**Files:**
- Modify: `js/game.js` (helpers `floatText`, `burst`, `message`, `sfx`; new `Game.drainEvents`, `Game.applyEvents`), `js/main.js` (one line in `frame()`), `js/ui.js` (`Game.sfx` call site), `test/render.test.js` (both `frame()` helpers)
- Test: `test/netready.test.js`

**Interfaces:**
- Produces: `state.events: Array` — entries `{type:'float'|'burst'|'message'|'sfx'|'kill', ...}`;
  `Game.drainEvents(state) -> events[]` (returns and clears);
  `Game.applyEvents(state, events)` — converts events into `state.floatTexts` / `state.particles` / `state.messages` and `Sfx.play`;
  internal `sfx(state, name)` (signature gains `state`); public `Game.sfx(state, name)`.
- Consumes: nothing new. Server (Phase 1) will relay `drainEvents` output instead of applying it.

- [ ] **Step 1: Write the failing test**

```js
test('sim emits events; applyEvents turns them into presentation state', () => {
  let state = Game.newRun(22);
  state.monsters.length = 0;
  const m = { ...Entities.makeMonster('bat', 1, false), id: 999, x: state.player.x + 30, y: state.player.y, attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: false, kbx: 0, kby: 0 };
  m.hp = 1;
  state.monsters.push(m);
  const input = freshInput();
  input.keys.space = true;
  state = Game.update(state, input, 1 / 60);

  const events = Game.drainEvents(state);
  assert.ok(events.some((e) => e.type === 'float'), 'damage number event');
  assert.ok(events.some((e) => e.type === 'sfx' && e.name === 'kill'), 'kill sound event');
  assert.ok(events.some((e) => e.type === 'kill' && e.monsterId === 999), 'structured kill event');
  assert.equal(state.events.length, 0, 'drain clears the buffer');
  assert.equal(state.floatTexts.length, 0, 'sim itself no longer writes presentation arrays');

  Game.applyEvents(state, events);
  assert.ok(state.floatTexts.length > 0, 'applier materializes floaties');
  assert.ok(state.particles.length > 0, 'applier materializes blood');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js` — Expected: FAIL (`Game.drainEvents` undefined).

- [ ] **Step 3: Convert the helpers**

In `js/game.js` — replace the bodies (signatures noted!):

```js
  function message(state, text, color) {
    state.events.push({ type: 'message', text, color: color || '#d8cfc0' });
  }

  function floatText(state, x, y, text, color, size) {
    state.events.push({ type: 'float', x, y, text, color, size: size || 14 });
  }

  function burst(state, x, y, color, n, speed) {
    state.events.push({ type: 'burst', x, y, color, n, speed: speed || 90 });
  }

  function sfx(state, name) {
    state.events.push({ type: 'sfx', name });
  }
  Game.sfx = sfx;

  Game.drainEvents = function (state) {
    const events = state.events;
    state.events = [];
    return events;
  };

  Game.applyEvents = function (state, events) {
    for (const e of events) {
      if (e.type === 'float') {
        state.floatTexts.push({ x: e.x, y: e.y, text: e.text, color: e.color, size: e.size, t: 0 });
      } else if (e.type === 'burst') {
        for (let i = 0; i < e.n; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = (0.3 + Math.random() * 0.7) * e.speed;
          state.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + Math.random() * 0.4, color: e.color, size: 1.5 + Math.random() * 2.5 });
        }
      } else if (e.type === 'message') {
        state.messages.push({ text: e.text, t: 0, color: e.color });
        if (state.messages.length > 5) state.messages.shift();
      } else if (e.type === 'sfx' && typeof Sfx !== 'undefined') {
        Sfx.play(e.name);
      }
    }
  };
```

Then the mechanical sweep, all inside `js/game.js`:
1. `state.events = [];` added to the `newRun` state literal (before `makeFloorState` runs).
2. Every internal `sfx('name')` call becomes `sfx(state, 'name')` (sites: descend, killMonster, level-up block, monster-hit block, tryPickup ×2, applyPotion, bagClick equip branch, bagDrop, gold pickup, death block, mute toggle, castPortal, travel, buyPotion, sellFromBag, buyShopItem, playerAttack ×3, updateProjectiles ×2, explode, castSkill ×4, town well).
3. In `killMonster`, after the splice add: `state.events.push({ type: 'kill', monsterId: m.id, x: m.x, y: m.y, champion: m.champion });`
4. `message(...)` bodies that trimmed `state.messages` no longer do — the applier trims.

In `js/ui.js`: `Game.sfx('levelup')` → `Game.sfx(state, 'levelup')`.

In `js/main.js` `frame()`, right after `state = Game.update(state, input, dt);`:

```js
    Game.applyEvents(state, Game.drainEvents(state));
```

In `test/render.test.js`, add the same line to **both** `frame()` helpers (the two tests each define one) so pipeline coverage keeps exercising the juice arrays.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS.

- [ ] **Step 5: Full suite + a manual solo sanity check, then commit**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 83` / `fail 0`.
Manual: open `index.html`, kill one monster — damage numbers, blood, sounds, log lines all present.

```bash
git add js/game.js js/ui.js js/main.js test/render.test.js test/netready.test.js
git commit -m "feat(net): sim emits events; presentation applies them locally"
```

---

### Task 3: `state.players[]` and per-player input routing

**Files:**
- Modify: `js/game.js` (`Game.newRun`, `Game.update` restructure, `Game.fromSave`, death block)
- Test: `test/netready.test.js`

**Interfaces:**
- Produces: `state.players: [player]`; `player.id: 'p0'` (server assigns `'p1'…` later); `player.dead: bool`;
  `Game.update(state, inputOrInputsById, dt)` — accepts the legacy single input object (auto-wrapped as `{p0: input}`) **or** a map `{[playerId]: input}`;
  internal `updatePlayer(state, p, input, dt)` containing all input-driven per-player logic;
  `Game.EMPTY_INPUT` (frozen no-op input) for disconnected players.
- Consumes: Task 2 events (all helpers already take `state`).

- [ ] **Step 1: Write the failing test**

```js
test('two players receive independent inputs in one update', () => {
  let state = Game.newRun(23);
  state.monsters.length = 0;
  // Manually add a second player next to the first (server does this properly in Phase 1).
  const p2 = Entities.newPlayer();
  p2.id = 'p1';
  Object.assign(p2, { facing: 0, attackT: 0, swing: null, hurtT: 0, healPool: 0, healRate: 0, dead: false, skillCd: { whirlwind: 0, nova: 0, prayer: 0 }, x: state.player.x + 40, y: state.player.y });
  state.players.push(p2);

  const right = freshInput(); right.keys.d = true;
  const down = freshInput(); down.keys.s = true;
  const x0 = [state.players[0].x, state.players[1].x];
  const y0 = [state.players[0].y, state.players[1].y];
  for (let i = 0; i < 30; i++) state = Game.update(state, { p0: right, p1: down }, 1 / 60);
  assert.ok(state.players[0].x > x0[0] + 20, 'p0 moved right');
  assert.ok(Math.abs(state.players[0].y - y0[0]) < 1, 'p0 did not drift down');
  assert.ok(state.players[1].y > y0[1] + 20, 'p1 moved down');
  assert.equal(state.player, state.players[0], 'legacy alias intact');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js` — Expected: FAIL (`state.players` undefined).

- [ ] **Step 3: Restructure update**

In `js/game.js`:

```js
// newRun: after building `player`, add:
    player.id = 'p0';
    player.dead = false;
// and in the state literal:
      players: [player],
// keep `player: player` as the legacy alias (same object).

  Game.EMPTY_INPUT = Object.freeze({
    keys: Object.freeze({ w: false, a: false, s: false, d: false, space: false }),
    pressed: new Set(),
    mouse: Object.freeze({ x: -1, y: -1, click: false, rclick: false }),
  });
```

`Game.update(state, input, dt)` becomes a thin conductor:

```js
  Game.update = function (state, input, dt) {
    dt = Math.min(dt, 0.05);
    const inputs = input && input.keys ? { p0: input } : input || {};
    state.time += dt;
    // ...existing global decay blocks (shake, fade, floatTexts, particles, messages) unchanged...

    const anyInput = inputs[state.players[0].id] || Game.EMPTY_INPUT;
    // mute toggle + dead/restart + inv/tree/belt toggles remain keyed to the LOCAL
    // player's input (anyInput) exactly as today — Phase 1 moves per-player UI
    // concerns client-side; comment them as such.

    if (state.dead) { /* unchanged, uses anyInput */ }

    for (const p of state.players) {
      if (p.dead) continue;
      updatePlayer(state, p, inputs[p.id] || Game.EMPTY_INPUT, dt);
    }

    // Global systems (unchanged bodies, but they already iterate/target players
    // via Task 4's helpers): flow field, monsters, projectiles, camera, autosave.
    // Death check per player, then:
    state.dead = state.players.every((p) => p.dead);
    return state;
  };
```

`updatePlayer(state, p, input, dt)` receives, verbatim-moved from the old body: stats compute, mana regen + skill cooldowns, potion healing, hurt/attack/swing timers, movement + facing, attack, skill casts, portal cast + travel contact check, town well/vendor proximity, pickups + gold magnet, stairs contact. Each moved block changes `state.player` → `p` and `input.…` stays. The per-player death branch sets `p.dead = true` (drop the old `state.dead = true` there; the conductor derives it).

`Game.fromSave`: after restoring fields, ensure `p.id = 'p0'; p.dead = false;` (it mutates `state.players[0]` via the alias — assert with the existing save tests).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS.

- [ ] **Step 5: Full suite + manual solo check, then commit**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 84` / `fail 0` (all legacy tests exercise the wrap path).
Manual: solo run still plays identically (move, fight, potion, portal, descend, die, restart).

```bash
git add js/game.js test/netready.test.js
git commit -m "feat(net): players array with per-player input routing"
```

---

### Task 4: Multi-source flow field and nearest-player AI

**Files:**
- Modify: `js/dungeon.js` (`flowFieldMulti`, back-compat `flowField`), `js/game.js` (flow recompute, `monsterUpdate` targeting, `nearestPlayer` helper)
- Test: `test/netready.test.js`

**Interfaces:**
- Produces: `Dungeon.flowFieldMulti(grid, sources, maxDist)` where `sources = [{x,y}, …]` (tile coords); `Dungeon.flowField(grid, x, y, maxDist)` preserved as a 1-source wrapper; internal `nearestPlayer(state, x, y) -> player|null` (alive players only).
- Consumes: Task 3 `state.players`.

- [ ] **Step 1: Write the failing test**

```js
test('monsters chase the nearest of several players', () => {
  let state = Game.newRun(24);
  state.monsters.length = 0;
  const p2 = Entities.newPlayer();
  p2.id = 'p1';
  Object.assign(p2, { facing: 0, attackT: 0, swing: null, hurtT: 0, healPool: 0, healRate: 0, dead: false, skillCd: { whirlwind: 0, nova: 0, prayer: 0 }, x: state.player.x + 200, y: state.player.y });
  state.players.push(p2);

  const m = { ...Entities.makeMonster('skeleton', 1, false), id: 1000, x: state.player.x + 150, y: state.player.y, attackT: 99, hitT: 0, lungeT: 0, wanderT: 99, wandA: NaN, aggroed: true, kbx: 0, kby: 0 };
  state.monsters.push(m);

  const idle = freshInput();
  for (let i = 0; i < 120; i++) state = Game.update(state, { p0: idle, p1: idle }, 1 / 60);
  const dP0 = Math.hypot(m.x - state.players[0].x, m.y - state.players[0].y);
  const dP1 = Math.hypot(m.x - state.players[1].x, m.y - state.players[1].y);
  assert.ok(dP1 < dP0, `skeleton went for the closer player (p1 ${Math.round(dP1)} vs p0 ${Math.round(dP0)})`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js` — Expected: FAIL (monster still steers toward `state.player` = p0).

- [ ] **Step 3: Implement**

In `js/dungeon.js` — rename the BFS body and add the wrapper:

```js
  D.flowFieldMulti = function (grid, sources, maxDist) {
    const h = grid.length, w = grid[0].length;
    const field = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    const q = [];
    for (const s of sources) {
      if (s.y < 0 || s.x < 0 || s.y >= h || s.x >= w || !WALKABLE(grid[s.y][s.x])) continue;
      if (field[s.y][s.x] === 0) continue;
      field[s.y][s.x] = 0;
      q.push([s.x, s.y]);
    }
    let head = 0;
    while (head < q.length) { /* identical BFS body as today */ }
    return field;
  };

  D.flowField = (grid, tx, ty, maxDist) => D.flowFieldMulti(grid, [{ x: tx, y: ty }], maxDist);
```

In `js/game.js`:

```js
  function nearestPlayer(state, x, y) {
    let best = null, bestD = Infinity;
    for (const p of state.players) {
      if (p.dead) continue;
      const d = U.dist2(x, y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
```

- Flow recompute block: seed from all alive players' tiles via `flowFieldMulti` (explored marking loop unchanged — it reads the merged field, which is exactly "visible to anyone", correct for co-op fog).
- `monsterUpdate`: replace every `state.player`/`p` reference with `const target = nearestPlayer(state, m.x, m.y); if (!target) return;` — distance, aggro, attack damage (`target.hp -= …`, `target.hurtT`), and the close-range steering all use `target`.
- `updateProjectiles`/`explode` already take stats from the shooter — they keep using the casting player captured at fire time; add `ownerId: p.id` to every projectile push (one-line each, used by Phase 4 loot/XP attribution).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS.

- [ ] **Step 5: Full suite (flow-field regression tests exercise the wrapper), then commit**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 85` / `fail 0`.

```bash
git add js/dungeon.js js/game.js test/netready.test.js
git commit -m "feat(net): multi-source flow field and nearest-player AI"
```

---

### Task 5: Fixed-tick stepper

**Files:**
- Modify: `js/game.js`
- Test: `test/netready.test.js`

**Interfaces:**
- Produces: `Game.TICK = 1/30`; `Game.stepFixed(state, inputs, elapsedSec) -> state` — accumulates real elapsed time, runs whole 1/30 s updates, carries the remainder in `state._acc`, clamps runaway elapsed at 0.25 s. The server loop (Phase 1) calls only this.
- Consumes: Task 3 input-map form.

- [ ] **Step 1: Write the failing test**

```js
test('stepFixed runs whole 30 Hz ticks and banks the remainder', () => {
  let state = Game.newRun(25);
  state.monsters.length = 0;
  const inputs = { p0: freshInput() };
  const t0 = state.time;
  state = Game.stepFixed(state, inputs, 0.1);           // 3 ticks, 0.1 - 3/30 banked
  assert.ok(Math.abs(state.time - t0 - 3 / 30) < 1e-9, `ticked 3 (${state.time - t0})`);
  state = Game.stepFixed(state, inputs, 0.004);          // banks to ~0.0373 → 1 tick
  state = Game.stepFixed(state, inputs, 0.03);
  assert.ok(Math.abs(state.time - t0 - 4 / 30) < 1e-9, 'remainder carried across calls');
  const big = Game.stepFixed(state, inputs, 10);         // clamped: at most 0.25s of catch-up
  assert.ok(big.time - t0 <= 4 / 30 + 0.25 + 1e-9, 'runaway elapsed clamped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js` — Expected: FAIL (`Game.stepFixed` undefined).

- [ ] **Step 3: Implement**

```js
  Game.TICK = 1 / 30;

  Game.stepFixed = function (state, inputs, elapsedSec) {
    let acc = (state._acc || 0) + Math.min(elapsedSec, 0.25);
    let s = state;
    while (acc >= Game.TICK) {
      acc -= Game.TICK;
      s = Game.update(s, inputs, Game.TICK);
    }
    s._acc = acc; // survives restart-returned states too
    return s;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS.

- [ ] **Step 5: Full suite, then commit**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 86` / `fail 0`.

```bash
git add js/game.js test/netready.test.js
git commit -m "feat(net): fixed 30Hz stepper for the server loop"
```

---

### Task 6: Injectable simulation RNG

**Files:**
- Modify: `js/game.js` (all sim-visible `Math.random` sites)
- Test: `test/netready.test.js`

**Interfaces:**
- Produces: `state.srand()` — mulberry32 stream seeded in `makeFloorState` from `(runSeed, floor)`; **all gameplay-affecting randomness** draws from it. Cosmetic randomness (particle scatter in `applyEvents`, camera shake jitter in render) stays `Math.random`. Two identically-seeded, identically-driven states produce identical outcomes.
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

```js
test('same seed + same inputs → identical outcomes (replayable sim)', () => {
  const script = (state) => {
    const input = freshInput();
    input.keys.space = true;
    input.keys.d = true;
    for (let i = 0; i < 600; i++) {
      if (i % 90 === 0) input.pressed.add('interact');
      state = Game.update(state, { p0: input }, 1 / 30);
      input.pressed.clear();
    }
    return state;
  };
  const a = script(Game.newRun(777));
  const b = script(Game.newRun(777));
  assert.equal(a.kills, b.kills, 'kills match');
  assert.equal(a.bag.gold, b.bag.gold, 'gold matches');
  assert.deepEqual(JSON.parse(JSON.stringify(a.bag.slots)), JSON.parse(JSON.stringify(b.bag.slots)), 'loot matches');
  assert.deepEqual(a.monsters.map((m) => Math.round(m.hp)), b.monsters.map((m) => Math.round(m.hp)), 'monster hp matches');
  const c = script(Game.newRun(778));
  assert.notEqual(JSON.stringify([a.kills, a.bag.gold]), JSON.stringify([c.kills, c.bag.gold]), 'different seed diverges');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/netready.test.js` — Expected: FAIL on one of the deepEquals (Math.random drift).

- [ ] **Step 3: Implement**

In `makeFloorState`, before spawning monsters:

```js
    state.srand = U.mulberry32((((state.runSeed >>> 0) ^ Math.imul(state.floor, 2654435761)) >>> 0) + 1);
```

Then replace `Math.random` with `state.srand` at every **sim-visible** site in `js/game.js` (complete list — grep confirms no others):
1. `makeFloorState` monster field jitter (`attackT`, `wanderT`, `wandA`).
2. `rollDamage` — change signature to `rollDamage(state, stats)`; update its three callers (melee loop, ranged push, whirlwind).
3. Monster damage variance in `monsterUpdate` (`0.9 + srand()*0.2`), wander re-rolls (`wanderT`, `wandA`, stand-still roll).
4. `dropLoot` — every roll, scatter offsets, and the `Items.makeItem/makePotion/U.randInt` calls get `state.srand` as their rng.
5. Champion bonus gold roll.
6. `rollShop` — `Items.makeItem(…, state.srand, …)`.
7. `Game.buyPotion` — `Items.makePotion(…, state.srand, kind)`.
8. `Game.bagDrop` scatter angle.
9. `updateProjectiles` fireball ember gate → **cosmetic; move the ember-particle push into an `{type:'burst'…}`-style event or leave as-is with `Math.random` and add the comment `// cosmetic`** (leave; it only spawns particles).
10. `Game.newRun`'s restart seed (`Math.random()*0x7fffffff`) stays `Math.random` — new runs *should* differ.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/netready.test.js` — Expected: PASS (run it twice to be sure).

- [ ] **Step 5: Full suite + manual solo check, then commit and merge**

Run: `node --test test/*.test.js 2>&1 | tail -3` — Expected: `pass 87` / `fail 0`.
Manual: one full solo floor — loot variety, combat feel unchanged.

```bash
git add js/game.js test/netready.test.js
git commit -m "feat(net): seeded sim RNG for replayable, server-verifiable outcomes"
git checkout master 2>/dev/null || git checkout main
git merge phase0-netcode-refactor
```

---

## Self-review notes

- Spec coverage: ids (snapshots) ✓, players[] (co-op) ✓, events (wire juice) ✓, multi-source AI (co-op) ✓, fixed tick (server loop) ✓, seeded RNG (validation/replay) ✓. Phase 0 deliberately excludes: snapshot encoder, party rules, any networking — those are Phases 1–4 by design.
- Type consistency: `sfx(state, name)`, `rollDamage(state, stats)`, `flowFieldMulti(grid, sources, maxDist)`, `nearestPlayer(state, x, y)`, `Game.stepFixed(state, inputs, elapsedSec)` are used with those exact signatures throughout.
- Placeholders: none — every step carries code or an exact command.
