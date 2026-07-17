# Module Breakdown — splitting game.js, ui.js, render.js

**Date:** 2026-07-17
**Goal:** Break the three oversized files (`js/game.js` 1232 lines, `js/ui.js` 1194, `js/render.js` 908 — 62% of all source) into small, single-purpose modules that are easier to read, hold in an LLM context window, and maintain. Zero behavior change; zero test churn.

## Constraints

- **No build step, no dependencies** (core project ethos). `index.html` must keep working when opened straight from `file://`.
- **Dual-mode modules**: every file is an IIFE that works both as a browser `<script>` (globals) and as a CommonJS module (`node --test` suite sets `globalThis.U/Items/...` then `require`s entry files).
- Tests import only the public namespaces (`Game.*`, `UI.*`, `Render.*`) via `require('../js/game.js')` etc. — those paths and that API must survive unchanged.
- `verify.html` (screenshot harness) loads the same scripts as `index.html`.

## Approaches considered

1. **ES-module migration** — cleanest long-term (`import`/`export`, explicit deps), but ES modules do not load over `file://`, breaking the documented "open index.html directly" flow; it would also force rewriting all 17 test files and `verify.html`. Big-bang risk for zero behavior payoff. Rejected.
2. **Keep monoliths as source, add a bundler/concat step** — violates the no-build-step ethos outright. Rejected.
3. **Namespace-preserving folder split** *(chosen)* — each big file becomes a folder of focused part files using the exact same dual-mode IIFE pattern. Part files attach to the shared namespace; cross-part helpers live on an internal context object (`Game._`, `UI._`, `Render._`). The old paths (`js/game.js` …) remain as tiny node-entry aggregators, so **every test keeps passing unmodified**. The browser loads part files via ordered `<script>` tags, exactly like the existing inter-module ordering. Code moves verbatim; only cross-file helper calls gain an internal-namespace prefix.

## Mechanism

Anchor file per folder (`core.js`) creates the namespace plus its internal context:

```js
// js/game/core.js
(function () {
  const Game = {};
  const G = (Game._ = {});   // internal context shared by js/game/ parts; not public API
  ...
  if (typeof window !== 'undefined') window.Game = Game;
  if (typeof module !== 'undefined') module.exports = Game;
})();
```

Every other part resolves the namespace the same dual-mode way and attaches:

```js
// js/game/ai.js
(function () {
  const Game = typeof window !== 'undefined' ? window.Game : require('./core.js');
  const G = Game._;
  function monsterUpdate(state, m, dt) { ... }   // body unchanged
  G.monsterUpdate = monsterUpdate;
})();
```

Old entry path becomes a node-only aggregator (browser pages list the parts directly):

```js
// js/game.js — node entry; the browser loads js/game/*.js via <script> tags instead.
if (typeof window === 'undefined') {
  require('./game/core.js'); require('./game/state.js'); /* ...in order... */
  module.exports = require('./game/core.js');
}
```

Node's module cache makes `core.js` a singleton, so parts and the entry all see one namespace object. No require cycles: parts require only `core.js`; the entry requires the parts.

## File plan

`js/game/` (sim; load order):
- `core.js` — namespace + `Game._`, tuning constants, event emit/drain/apply (`message`, `sfx`, `floatText`, `burst`), collision (`collides`, `moveCircle`), save helper.
- `state.js` — `makeFloorState`, `Game.newRun`, `Game.fromSave`.
- `combat.js` — `dropLoot`, `hitMonster`, `rollDamage`, `playerAttack`, `explode`, `updateProjectiles`, `killMonster`, `Game.castSkill`.
- `ai.js` — `nearestPlayer`, `monsterUpdate`.
- `inventory.js` — `tryPickup`, `applyPotion`, `Game.useBelt`, `Game.bagClick`, `Game.bagDrop`.
- `town.js` — `castPortal`, `rollShop`, `travel`, `descend`, `Game.buyPotion`, `Game.sellFromBag`, `Game.buyShopItem`, `Game.smithUpgrade`, `Game.upgradeEquipped`.
- `update.js` — `Game.EMPTY_INPUT`, `updatePlayerAlways`, `Game.update`, `updatePlayerActions`, `updateWorld`, `Game.stepFixed`.

`js/render/` (world drawing):
- `core.js` — namespace + `Render._`, `tileHash`, `mix`, `shade`, `isVisible`.
- `tiles.js` — `drawTile`, `drawTorch`, `torchGlow`.
- `icons.js` — `drawItemIcon` (public as `Render.drawItemIcon`), `drawGroundItem`.
- `fixtures.js` — `drawPortal`, `drawTownFixtures`.
- `monster.js` — `drawMonster`.
- `player.js` — `drawPlayer`.
- `draw.js` — `Render.draw` scene composition.

`js/ui/` (HUD & panels):
- `core.js` — namespace + `UI._`, fonts, `layout`, `inRect`, `panelBg`, `wrapText`, `BRANCH_COLORS`.
- `input.js` — `UI.update` (mouse/keyboard interaction with HUD, panels, shop, tree).
- `orbs.js` — `drawOrb`, `drawManaOrb`.
- `hud.js` — `drawSkillGlyph`, `drawSkillBar`, `drawXP`, `drawBelt`, `drawMinimap`.
- `panels.js` — `statLines`, `drawInventory`, `drawShop`, `drawTree`.
- `tooltip.js` — `tooltipFor`, `measureTooltip`, `drawTooltipPanel`, `drawTooltip`.
- `creation.js` — `UI.SHIRTS`, `UI.creationLayout`, `UI.drawCreation`.
- `draw.js` — `UI.draw` (HUD composition, boss bar, messages, fade, death overlay).

Every part lands in the 50–350 line range. `items.js` (409) stays: single cohesive concern (item generation/pricing), already comfortably readable.

## Public API (unchanged)

`Game`: `newRun, fromSave, update, stepFixed, TICK, EMPTY_INPUT, drainEvents, applyEvents, message, sfx, burst, useBelt, bagClick, bagDrop, castSkill, buyPotion, sellFromBag, buyShopItem, smithUpgrade, upgradeEquipped, dropLoot, PORTAL_CD, PLAYER_R, ARC_WIDTH` · `UI`: `update, draw, SHIRTS, creationLayout, drawCreation` · `Render`: `draw, drawItemIcon`.

## Verification

1. `node --test test/*.test.js` — full suite green after each module's split (tests unchanged).
2. Headless Chrome against `verify.html` scenes (`#combat #inv #death #town #trade #fireball #save`): `window.__errors` empty, screenshots eyeballed against pre-refactor captures.
3. README Development section gains a code-layout map.
