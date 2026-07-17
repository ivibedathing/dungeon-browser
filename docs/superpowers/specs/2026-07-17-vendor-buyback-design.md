# Vendor Buy-Back & Sell All

**Date:** 2026-07-17
**Goal:** Two vendor conveniences at Grizzle's stall: recover mis-sold items (buy-back) and liquidate a loot haul in one click (sell all).

## Design

**Buy-back shelf.** Every sale (single-click or sell-all) pushes `{ item, price }` onto `state.buyback`, newest first, capped at 3 — the shelf's visible slot count. Buying back costs exactly the gold the vendor paid, so a mis-sell round-trips for free. The shelf lives on the run state: it survives floor changes and town trips, is empty on a new run, and is deliberately **not** written to the save (a session convenience, not progression). Clicking a shelf item requires trading range, enough gold, and bag space — same guards and messages as the shop wares.

**Sell all.** A `SELL ALL` button in the shop strip sells every **non-potion** item in the bag grid in one click, crediting the summed `sellPrice` and stocking the buy-back shelf (only the last 3 remain recoverable). Potions are kept on purpose: bag potions are the belt's refill reserve (`Items.refillBelt` drains the bag when you drink), so "sell everything" would silently strip healing; the result message says potions were kept. Belt and equipped gear are untouched. Single-item selling (click an item while trading) still sells anything, potions included.

## Surfaces

- Sim (`js/game/town.js`): `Game.BUYBACK_SIZE = 3`, `Game.sellFromBag` stocks the shelf, new `Game.sellAll(state)`, new `Game.buyBack(state, index)`. `state.buyback: []` init in `Game.newRun`.
- Layout (`js/ui/core.js`): `shopBuyback` (3 slots) and `shopSellAll` (button) rects in the shop strip, right of the potion barrels behind a divider.
- Interaction (`js/ui/input.js`): hover + click on shelf slots (context `buyback`) and the sell-all button, inside the trading block.
- Drawing (`js/ui/panels.js`): shelf slots with price tags under a `BUY BACK` caption; `SELL ALL` button with the haul's total value as its price tag.
- Tooltip (`js/ui/tooltip.js`): `buyback` context line — "Buy back for N gold".
- `verify.html` trade scene stages one sold item so screenshots exercise the shelf.

## Verification

Sim tests in `test/town.test.js` (shelf stocking/cap, round-trip pricing, gold/space guards, sell-all semantics); UI tests in `test/ui.test.js` (layout rects inside the strip, drawn captions, buyback tooltip). Full suite + headless-Chrome trade scene.
