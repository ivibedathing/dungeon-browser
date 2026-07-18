# The Overworld — Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-18-overworld-design.md`
> Predecessor: none. This runs alongside the main-quest phase; the only shared file is
> `js/game/ai.js`, and the changes there are additive (home/leash fields, waypoint wander)
> rather than the per-type dispatch that plan introduces.
> **For agentic workers:** implement phase-by-phase, test-first. Every phase leaves the full
> `node --test test/*.test.js` suite green and the existing dungeon game fully playable —
> the overworld is dark behind a flag until Phase 4. Browser-only work (tile art, map panel,
> POI markers) adds a `verify.html` scene and a manual check instead of a node test.

**Goal:** ship a 2048×2048-tile bounded continent with free-roaming monsters, with Ashfall
Camp at its centre and the dungeons as mouths you find by walking.

---

## Phase 0 — Pure foundations (no gameplay change)

Nothing user-visible. Both pieces are pure and land with tests before anything consumes them.

| Task | Surface |
| --- | --- |
| 0.1 | `U.hash2/noise2/fbm2` in `js/util.js` — integer-hash value noise, stateless, deterministic across Node and browser. Tests: same input → same output, range bounds, no seams across integer boundaries. |
| 0.2 | `D.flowFieldWindow(grid, sources, maxDist, rect)` + `D.flowAt(flow, x, y)` in `js/dungeon.js`. Test it agrees with `flowFieldMulti` everywhere inside the window and reads `Infinity` outside. |
| 0.3 | Move the four flow consumers onto `D.flowAt` — `js/game/ai.js:46`, `js/render/core.js:31`, `js/game/update.js:314`, `js/net.js:545` — while dungeons still pass a whole-grid rect. Behaviour must be identical; the dungeon suite is the proof. |
| 0.4 | Window the explored-marking loop in `updateWorld` to the flow rect. |

**Exit:** suite green, dungeon play unchanged, `git diff` shows no behavioural delta.

---

## Phase 1 — Terrain

| Task | Surface |
| --- | --- |
| 1.1 | `js/world.js`: `World.create(worldSeed)` allocating `2048` × `Uint8Array(2048)` plus the `Uint8Array(1024)` chunk-generated flags. `World.CHUNK = 64`, `World.CHUNKS = 32`. |
| 1.2 | `TILE.WATER/CLIFF/ROAD` in `js/dungeon.js`; `WALKABLE` accepts `ROAD`. Confirm nothing else switches exhaustively on the tile enum. |
| 1.3 | `World.ensureChunk` — elevation/moisture fBm over **world** coords → floor / water / cliff. Test: regenerating a chunk is bit-identical, and two adjacent chunks agree on their shared border column in either generation order. |
| 1.4 | Border bands: cliff N+E, water S+W, blended corners, hard clamp at the edge. Test the outer ring is impassable on all four sides. |
| 1.5 | `World.biomeAt` + `World.BIOMES` palettes (six, shaped like `D.THEMES` plus `water`/`cliff`/`grass`). |
| 1.6 | Deterministic road spanning tree rooted at the town chunk; each chunk carves toward its parent, bridging water and cutting cliff passes. Test: `flowField` from the town tile reaches a sample of 20 far-flung chunk centres. |

**Exit:** a walkable, connected, empty continent behind a debug flag.

---

## Phase 2 — Being in it

| Task | Surface |
| --- | --- |
| 2.1 | `js/game/world.js`: activation set (radius 2 chunks around any player), activate/deactivate, entity chunk tagging, `state.world.visited`. Wired from `updateWorld`. |
| 2.2 | Level-object shape for the overworld so `state.dungeon` stays duck-compatible (`grid/width/height/entry/theme/…`). |
| 2.3 | Render: water, cliff, road tiles + biome palettes in `js/render/tiles.js`; per-level `sightTiles` (dungeon 9, overworld 18) and no dim veil in `js/render/core.js`. |
| 2.4 | Windowed minimap in `js/ui/hud.js` (it draws the whole grid today and cannot at this scale). |
| 2.5 | `M` world-map panel — explored downsampled 8:1 to 256×256, no pins yet. |

**Exit:** you can walk the continent, see it, and read the map. Still empty.

---

## Phase 3 — Free-roaming monsters

| Task | Surface |
| --- | --- |
| 3.1 | `Balance.world`: `floorPerRing`, density-by-ring curve, champion/boss chance, `respawnSeconds`, `leashTiles`, `activeRadius`, `sightTiles`. |
| 3.2 | `World.ringOf(cx, cy)` and the per-chunk population roll feeding the existing `E.makeMonster(type, floor, champion, partyN)` at the ring's effective floor. Safe ring (town chunk + 8 neighbours) spawns nothing. Tests on budgets, safe ring, and ring→floor monotonicity. |
| 3.3 | `m.home` / `m.wp` in `js/game/ai.js`; the existing wander branch becomes a leashed waypoint walk; a chase breaks and returns home past `leashTiles`. |
| 3.4 | Chunk clear/respawn bookkeeping in `state.world.visited`. |
| 3.5 | World bosses from ring 8 (`E.makeBoss` at the effective floor), pinned on the map when seen. |
| 3.6 | Props and torches per chunk, instantiated and dropped with activation. |

**Exit:** the world is dangerous, and danger reads as a gradient outward from home.

---

## Phase 4 — Places: town, mouths, waystones

This is the phase that turns the flag on.

| Task | Surface |
| --- | --- |
| 4.1 | `D.stampTown(grid, ox, oy, seed)` — the Ashfall plaza written into the centre chunk, returning `well`/`vendor`/`smith`/`board` in world tile coords. Verify `state.trading/smithing/questing` in `updatePlayerActions` still fire and the vendor, smith, and board UI are untouched. |
| 4.2 | Dungeon mouth POIs: one-per-chunk roll, `STAIRS_DOWN` tile, seed `hash2(worldSeed, cx, cy)`, ring-scaled starting floor. |
| 4.3 | Entering a mouth via `G.travel`'s stash path; `T` from a dungeon returns to the overworld at that mouth. Test the stash round-trips the overworld intact across several dungeon floors. |
| 4.4 | Waystones: placement per ring, unlock on touch, warp between unlocked stones. |
| 4.5 | POI pins on the world-map panel; markers in `js/render/fixtures.js`. |
| 4.6 | Remove the flag; a new run starts in the overworld outside Ashfall Camp. |

**Exit:** a complete single-player loop — roam, find a mouth, dive, portal out, sell, roam further.

---

## Phase 5 — Persistence, co-op, balance

| Task | Surface |
| --- | --- |
| 5.1 | `Save.snapshot`/`Game.fromSave`: `worldSeed`, `inWorld`, `worldPos`, discovered-POI and waystone lists, chunk-granular explored bitset (128 bytes). Round-trip test. |
| 5.2 | Legacy-save migration — an existing dungeon save loads into the overworld at Ashfall. |
| 5.3 | Server-side activation over the union of players' radii in `server/room.js`, with the total active-chunk cap. |
| 5.4 | `js/net.js` client prediction across chunk boundaries; check the projection path carries no chunk-local references. |
| 5.5 | Balance pass on the ring curve; regenerate `BALANCE.md` via `node tool/balance-report.mjs`. |
| 5.6 | `verify.html` overworld scenes: coastline, cliff wall, road bridge, biome edge, town approach. |

---

## Deliberately NOT in this phase

- **Day/night, weather, seasons.** The lighting model is one more axis than the biome palettes already need.
- **Mounts and travel speed.** Waystones solve the traversal problem; a second solution muddies the tuning.
- **Biome-specific monster species.** Ring scaling over the five existing types only — new species belong with the `behaviors.js` layer, not here.
- **Settlements beyond Ashfall, NPC dialogue, world PvP, building or farming.**
- **Per-tile persistent fog of war.** Chunk granularity across sessions, per-tile within one.
