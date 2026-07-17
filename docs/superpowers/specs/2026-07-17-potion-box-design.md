# Potion Box

**Date:** 2026-07-17
**Goal:** Potions stop competing with loot for bag-grid space. A dedicated potion box holds up to **5 healing + 5 mana potions**, drawn as its own two-row section in the inventory panel.

## Design

**Storage.** `bag.potions = { health: [], mana: [] }`, each capped at `Items.POTION_BOX_SIZE = 5`. `Items.addItem` routes potions belt-first (unchanged quick-use), then into the box row for their kind; when belt and that row are full the pickup **fails** — potions never occupy bag-grid slots again. Gear routing is untouched.

**Belt refill.** Drinking from the belt refills from the box — healing potions first, then mana, then (legacy) any potions still sitting in the grid from old saves.

**Actions.** Click a box potion to drink it; while trading it sells instead (and lands on the buy-back shelf, like any sale); right-click drops it. The pickup-failure message says the potion box is full. `SELL ALL` continues to ignore potions entirely.

**Saves.** `Save.snapshot` already serializes the whole bag, so the box persists for free. `Game.fromSave` restores it (kind-filtered, cap-enforced) and **migrates legacy saves**: grid potions move into the box until the caps fill; overflow stays in the grid, where the old click-to-drink path still works.

**UI.** A `POTION BOX` section fills the inventory panel's bottom-left, under the paper-doll: healing row on top, mana row below, five 24px slots each with an `n/5` count beside, red/blue hints in empty slots. Hover context `box`: "Click to drink", or the sell price while trading.

## Surfaces

`js/items.js` (box storage, routing, refill) · `js/game/state.js` (fromSave restore + migration) · `js/game/inventory.js` (`Game.potionBoxClick`, `Game.potionBoxDrop`, pickup message) · `js/ui/core.js` (rects) · `js/ui/input.js` (hover/click) · `js/ui/panels.js` (drawing) · `js/ui/tooltip.js` (box context) · `verify.html` inv scene stocks the box · README.

## Verification

`test/potionbox.test.js` (routing, caps, refill order, drink/sell/drop actions, save round-trip, legacy migration, full-box pickup message) plus `test/ui.test.js` layout/draw/tooltip checks; full suite and headless-Chrome inv scene.
