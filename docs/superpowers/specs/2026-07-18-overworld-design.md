# The Overworld — a Bounded Open World

**Date:** 2026-07-18
**Goal:** Give the game a second kind of place. Today every level is a 120×120 room-and-corridor floor and the town is a 34×26 plaza you reach by portal. After this, the game opens onto a **2048×2048-tile continent** — 65,536 px on a side, walled by cliffs to the north and east and by open water to the south and west — that you roam freely, with monsters that live out there rather than waiting in rooms. Ashfall Camp sits at its centre and the dungeons become mouths in the ground you find by exploring.

## Design

**Scale and shape.** The world is 32×32 **chunks** of 64×64 tiles: 2048×2048 tiles, 65,536 px square, ~6½ minutes of walking corner-to-centre at `MOVE_SPEED`. It is bounded, not endless — the outermost ~24 tiles resolve to `CLIFF` along the north and east edges and to `WATER` along the south and west, so the map has a coastline on two sides and a mountain wall on the other two, and the player is stopped by terrain rather than by an invisible box.

**Terrain is a pure function of world coordinates, not of chunk index.** This is the load-bearing rule. Anything that crosses a chunk boundary — coastlines, rivers, cliff ridges, biome edges — is sampled from hash-based value noise over *world* tile coords (`U.hash2/noise2/fbm2`, new in `js/util.js`), so two chunks generated at different times in different orders still agree on the tile they share. A per-chunk `mulberry32(hash2(worldSeed, cx, cy))` is used **only** for point features that fit inside one chunk: prop scatter, monster spawn tiles, POI placement. Getting this backwards is the classic chunked-world seam bug, and the tests assert it directly.

**The grid is allocated once, in full, and filled lazily.** `2048` rows of `Uint8Array(2048)` is ~4.2 MB — cheap enough to just pay up front, and it means `grid[y][x]` keeps working verbatim in `G.moveCircle`, `D.flowFieldMulti`, and the whole renderer, with world tile coords as *the* coordinate system. No sliding origin, no offset math threaded through every consumer, no chunk eviction and regeneration flicker. A `Uint8Array(1024)` marks which chunks have had their terrain written. What *does* stream is chunk **content** — monsters, props, torches — which is instantiated on activation and dropped on deactivation.

**Tiles and biomes.** Three new tile kinds: `WATER = 4` and `CLIFF = 5` (both non-walkable, so collision and the flow field route around them for free) and `ROAD = 6` (walkable). Palette is chosen per tile from a `biomeAt(x, y)` derived from elevation × moisture — Ashen Plains, Thornwood, Marshfen, Bone Barrens, Frostcrag Highlands, Emberwaste — each an entry shaped like the existing `D.THEMES` entries plus `water`, `cliff`, and `grass` colours. The overworld is daylight: it keeps the `explored` bitmap for the map panel but drops the dim out-of-sight veil, and sight radius becomes a per-level `sightTiles` (dungeon `9`, overworld `18`) instead of the hard-coded `9` in `R.isVisible`.

**Connectivity is guaranteed by roads, not by a flood fill.** Noise-carved cliffs and lakes will strand regions, and a lazily-generated world can never run a global reachability check. Instead, each chunk is a node in a deterministic spanning tree rooted at the town chunk, and every chunk carves a `ROAD` toward its parent — bridging over water and cutting a pass through cliff where it crosses one. The tree is a pure function of `(worldSeed, cx, cy)`, so any chunk can carve its own link with no knowledge of its neighbours, and every POI is reachable from town on foot by construction.

**Flow fields become windowed.** `D.flowFieldMulti` allocates a full `h × w` field of `Infinity` per rebuild; on a 2048² grid that is 4.2 M cells every 0.18 s, which is fatal. New `D.flowFieldWindow(grid, sources, maxDist, rect)` returns `{ field, x0, y0, w, h }` over the bounding box of the living players expanded by `maxDist + 2`, and `D.flowAt(flow, x, y)` reads it, returning `Infinity` outside. The four consumers switch to the accessor: `js/game/ai.js:46`, `js/render/core.js:31`, `js/game/update.js:314`, `js/net.js:545`. `flowFieldMulti` stays as the whole-grid wrapper so dungeon floors are unaffected. The explored-marking loop in `updateWorld` becomes bounded by the same rect instead of scanning the grid.

**Monsters live in chunks, and danger grows with distance from home.** Each chunk owns a population budget seeded from its coords and its **ring** — Chebyshev chunk distance from the town chunk (0–15). Ring drives an *effective floor* (`Balance.world.floorPerRing * ring`) that feeds straight into the existing `E.makeMonster(type, floor, champion, partyN)`, so hp/dmg/xp scaling, champion rolls, and the `minFloor` type pool all come along unchanged — no second balance curve to maintain. The town chunk and its eight neighbours are a hard safe ring with zero spawns. Champion chance rises with ring; from ring 8 outward a chunk can roll a **world boss** (`E.makeBoss` at the effective floor), pinned on the map once seen. A cleared chunk stays cleared in `state.world.visited[key]` and repopulates after `Balance.world.respawnSeconds`.

**Roaming is two additive changes to the existing uniform AI.** `G.monsterUpdate` today aggros when `flowDist * TS <= m.aggro` and otherwise wanders at random. First: when the flow window doesn't cover a monster its distance reads `Infinity`, which already falls through to the wander branch — that branch becomes a **waypoint walk** toward a point picked within `leashTiles` of `m.home`, so distant monsters drift purposefully instead of jittering in place. Second: a chase is abandoned and the monster walks home once it exceeds `leashTiles` from `m.home`, which is what stops a conga line forming across a 65k-px map. No per-type dispatch is introduced, so this stays compatible with the `behaviors.js` layer the main-quest plan adds.

**Only active chunks tick.** Activation radius is 2 chunks around any player (5×5 = 320×320 tiles, comfortably past the ~40×23-tile viewport), giving roughly 150 live monsters — the same order as a dungeon floor, so the per-frame sim budget does not move.

**The town and the dungeons become places in the world.** Ashfall Camp is stamped into the world grid at the centre chunk by `D.stampTown(grid, ox, oy, seed)`, which reuses the plaza layout of `D.generateTown` and returns `well`/`vendor`/`smith`/`board` in world tile coords — so the proximity flags in `updatePlayerActions` (`state.trading`, `state.smithing`, `state.questing`) and the whole vendor/smith/board UI work untouched. **Dungeon mouths** are POIs scattered one-per-chunk on a roll, each a `STAIRS_DOWN` tile whose dungeon seed is `hash2(worldSeed, cx, cy)` and whose starting floor scales with ring. Entering one uses `G.travel`'s existing **stash** machinery exactly as the town trip does today: the overworld is stashed whole, dungeon floors churn beneath it, and portalling out (`T`) restores it and puts you back at the mouth. Because the overworld holds the outer level and dungeon floors are the inner churn, the single-slot stash is still sufficient.

**Waystones.** A 65k-px world cannot be crossed on foot every trip. Waystone POIs are scattered a few per ring; touching one unlocks it, and any unlocked waystone can be warped to from any other. This replaces the town-portal-only travel model as the world's fast travel; milestone waypoints for dungeon floors are untouched.

**Map.** The minimap in `js/ui/hud.js:177` currently draws the whole grid and must become a window around the player. `M` opens a full-world panel drawn from the explored data downsampled 8:1 to 256×256 px, pinned with the town, discovered mouths, unlocked waystones, and seen world bosses.

**Save.** `Save.snapshot` gains `worldSeed`, `inWorld`, `worldPos`, and the discovered-POI and unlocked-waystone key lists. Explored is persisted at **chunk** granularity — a 1024-bit set, 128 bytes — not per tile; per-tile fog at 2048² would be ~700 KB of base64 in localStorage, which is not a reasonable thing to write every 4 seconds. The consequence, accepted deliberately: the world map fills in chunk by chunk across sessions rather than tile by tile.

**Multiplayer.** The server runs the identical chunk activation over the **union** of its players' radii, and chunk content is authoritative there as monsters already are; projections and the netcode are unchanged in shape. A scattered party multiplies the active-chunk count, so the total active set is capped and the cap is what the sim budget is sized against.

## Approaches considered

1. **Full-grid allocation with lazily-written chunks** *(chosen)* — 4.2 MB bought once, world tile coords everywhere, `grid[y][x]` untouched downstream. Streaming applies to entities only.
2. **LRU chunk cache with a sliding window grid.** Rejected. Saves a few MB we can afford, and in exchange the grid origin moves under the entities, so every collision, render, flow-field and AI call site needs offset math — and evicted terrain regenerates, which must be bit-exact or the world visibly changes behind you.
3. **One 512×512 pregenerated grid.** Rejected: only ~8 dungeon floors of area, not the "very big" the brief asks for, and it still pays a whole-grid flow field.
4. **Independent per-chunk levels joined by edge transitions.** Rejected — that is a zone map, not free roaming; the seam is a loading screen.

## Surfaces

- Noise (`js/util.js`): `U.hash2`, `U.noise2`, `U.fbm2` — seeded, integer-hash based, no state.
- World gen (`js/world.js`, new; pure and node-testable like `dungeon.js`): `World.CHUNK = 64`, `World.CHUNKS = 32`, `World.create(worldSeed)`, `World.ensureChunk(world, cx, cy)`, `World.biomeAt`, `World.ringOf`, `World.BIOMES`, road spanning-tree carve, border cliff/water bands, POI rolls.
- Tiles (`js/dungeon.js`): `TILE.WATER/CLIFF/ROAD`, `WALKABLE` accepts `ROAD`, `D.flowFieldWindow` + `D.flowAt`, `D.stampTown`.
- Balance (`js/balance.js`): `Balance.world` — `floorPerRing`, chunk density curve, champion/boss chance by ring, `respawnSeconds`, `leashTiles`, `activeRadius`, `sightTiles`.
- Sim (`js/game/world.js`, new): chunk activate/deactivate, entity tagging by chunk, visited/respawn bookkeeping. Wired from `updateWorld` (`js/game/update.js`).
- AI (`js/game/ai.js`): home/leash fields on monsters, waypoint wander, flow reads via `D.flowAt`.
- Travel (`js/game/town.js`): dungeon mouths and waystones join `G.travel`'s stash path; town portal target becomes the overworld.
- State/save (`js/game/state.js`, `js/save.js`): world fields in `newRun`/`fromSave`/`snapshot`, chunk-granular explored set.
- Render (`js/render/tiles.js`, `js/render/core.js`, `js/render/fixtures.js`): water/cliff/road tiles, biome palettes, per-level `sightTiles`, no veil in the overworld, POI markers.
- UI (`js/ui/hud.js`, `js/ui/panels.js`, `js/ui/core.js`, `js/ui/input.js`): windowed minimap, `M` world-map panel with POI pins.
- Net (`js/net.js`, `server/room.js`): union-of-players activation, active-chunk cap.

## Verification

New `test/world.test.js`: chunk regeneration is bit-identical; two adjacent chunks agree on their shared border column both generation orders; the border bands are cliff/water on the right sides; a `flowField` from town reaches N sampled POI tiles (road connectivity); per-ring spawn budgets and the safe ring; leash and waypoint behaviour. `test/dungeon.test.js` gains `flowFieldWindow` ≡ `flowFieldMulti` inside the window and `Infinity` outside. `test/save.test.js` covers the world fields and the chunk-explored round trip; `test/ui.test.js` covers the map panel rects and pins. Full `node --test test/*.test.js` stays green, plus a `verify.html` overworld scene for coastline, cliff, road, and biome-edge screenshots.
