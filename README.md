# Dungeon Browser

A 2D top-down action RPG for the browser in the classic loot-and-dungeon-crawl mold. No dependencies, no build step — plain Canvas 2D and Web Audio.

## Run

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8321
# → http://localhost:8321
```

Progress is saved automatically (localStorage) — close the tab and pick up where you left off. Death wipes the save; only your best-run record survives.

## Multiplayer (co-op)

Up to four heroes can share one dungeon. A co-op server lives under `server/` (the only part of the project with npm dependencies — `ws` and `pg`); it runs the same simulation the browser does, one instance per room. It's entirely optional — solo play needs nothing but the static files.

```sh
npm install        # one-time: fetches ws + pg (both pure JS, no compiler needed)
npm start          # ws://0.0.0.0:8080 by default (PORT to override)
npm test           # node --test over the whole suite (client + server)
```

Serve the game (`python3 -m http.server 8321`) and open it in a browser — **Play Solo** is the offline game as ever; **Host Game** opens a room and shows a share code; **Join Game** takes a friend's code. The client predicts your own hero for instant response and interpolates everyone else for smooth motion; the server is authoritative. The Host/Join client connects to `ws://<host>:8080`, so run the server on the machine you're hosting from.

### Accounts & saved characters

Online play uses accounts: register or log in, then pick from up to eight characters that live **on the server** (a session token in `localStorage` logs you back in automatically). Progress saves on the roguelite triggers — level-up, descending a floor, disconnect — and **death wipes the run** (the slot stays, the hero resets), same as solo. You can play as a guest without an account, but a guest's run isn't saved.

Persistence uses **Postgres**. Without a database the server still runs, but accounts and characters are held in memory only (a startup line warns you). To persist, point `DATABASE_URL` at a Postgres instance — the schema is created on boot:

```sh
docker run -d --name db-dungeon -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
npm start
```

The default `npm test` needs no database (it uses an in-memory store). To also run the Postgres-backed tests, set `DATABASE_URL` and run them serially (they share one database):

```sh
DATABASE_URL=… node --test --test-concurrency=1 test/*.test.js
```

The hosted claude.ai artifact build is **offline-only**: its content-security policy blocks outbound sockets, so the menu's online options are unavailable there. Online play requires running the game from these files against your own server.

## Host your own server

`npm start` runs one process that serves **both** the static client and the WebSocket on the same origin (default port `8080`) — no more out-of-band static server. The client, when loaded over HTTP(S), connects back to the same host/port and upgrades to `wss://` automatically under HTTPS.

```bash
npm start                 # http + ws on :8080  →  http://localhost:8080
```

**Docker (with Postgres persistence):**

```bash
docker compose up         # db + server; characters persist in a volume
# → http://localhost:8080
```

The image is `node:20-slim`, runs as a **non-root** user, installs only `ws`+`pg` (`--omit=dev`), and ships a `HEALTHCHECK` hitting `/healthz`.

**Environment:**

| Var | Meaning |
| --- | --- |
| `PORT` | http + ws port (default `8080`) |
| `DATABASE_URL` | Postgres URL; **unset ⇒ in-memory store** (accounts/characters are NOT persisted) |
| `MAX_ROOMS` / `MAX_CONNECTIONS` | capacity caps; over-cap joins get a clean `server_full` kick |

**Observability:** `GET /healthz` → `200 ok`; `GET /metrics` → JSON (`rooms`, `players`, `ticksTotal`, `tickMs {last,avg,max,p95}`, `msgsIn`, `msgsDropped`, `snapshotsDropped`, `kicks{…}`, `uptimeSec`, `rss`). Logs are single-line JSON to stdout with **no secrets**. SIGTERM drains a final save for every live player before exit.

**TLS termination:** the server speaks plain `ws://`/`http://`; put a reverse proxy (Caddy/nginx) in front to terminate TLS and forward to the server, serving the client over the **same** HTTPS origin so the client upgrades to `wss://` on `:443` with no port constant. Minimal Caddy example:

```
your.domain {
    reverse_proxy 127.0.0.1:8080   # proxies both the static GETs and the ws upgrade
}
```

**Pre-deploy checks:** `node tool/fuzz.mjs` (protocol/room fuzz — no frame crashes a room) and `node --expose-gc tool/soak.mjs 50 4 10` (50 rooms × 4 bots × 10 min — memory flat, tick under budget).

## Controls

| Key | Action |
| --- | --- |
| **WASD** / arrows | Move |
| **Mouse** | Aim — your hero always faces the cursor; attacks fly that way regardless of which way you walk |
| **Left-click** (hold) | Attack — melee weapons swing an arc toward the cursor; bows and crossbows loose arrows/bolts; wands and staves hurl exploding fireballs; thrown weapons spin out. Hold to keep swinging |
| **Space** | Dodge roll — a quick dash with invulnerability frames (0.9 s cooldown) |
| **F / G / H** | Cast skills: Whirlwind / Fire Nova / Healing Prayer (cost mana, short cooldowns) |
| **K** | Skill tree — spend skill points (1 per level) across War, Sorcery, and Faith |
| **E** | Pick up the nearest item (or buy a potion at the vendor, or read the notice board); gold is picked up by walking over it |
| **T** | Town Portal — opens a portal to Ashfall Camp (15 s cooldown); step in to travel, return the same way |
| **1–4** | Drink a potion from the belt |
| **Q** | Drink the first available belt potion |
| **I** / Tab / B | Toggle inventory (game pauses) |
| Mouse | Inventory: hover for tooltips (**hold CTRL to compare against your equipped item**), click to equip/drink, right-click to drop. At the vendor: click wares to buy, click your items to **sell**, **SELL ALL** to liquidate the haul (potions stay), and the **buy-back shelf** returns your last three sales at the price paid. At the anvil: click weapons to **upgrade**. At the notice board: click a notice to **take** it, click a finished quest to **claim** it, right-click to abandon |
| **N** | Mute / unmute sound |
| **R** | Rise again after death (fresh run) |

## The game

- **Procedural dungeons** — rooms + corridors, regenerated every floor; find the glowing stairs to descend. Themes shift every 4 floors (Catacombs → Cold Caves → Burning Depths), with fog of war, torch light, and a minimap. **Past floor 10 the dungeon changes character**: mazier warrens of small chambers in new palettes (Fungal Hollows → Frozen Abyss → Obsidian Warrens).
- **Character creation** — name your hero and pick a shirt color; both persist through saves and show in-game.
- **Waypoints** — every 5th floor you reach by stairs adds a labeled shortcut portal to Ashfall Camp for the rest of that run.
- **Monsters get stronger every floor** (HP/damage/XP scale up, packs get bigger). Champions (orange ring, named) are rarer, much tougher, and always drop loot. Alongside the melee horde (zombies, skeletons, brutes, ghouls, hounds, spiders, armored skeletons, ogres…) deeper floors add **special foes with their own tricks** — spellcasters that kite and lob dodgeable bolts, exploders that rush in and detonate, chargers that wind up and dash, and necromancers that raise minions. Each telegraphs its wind-up, so every special is dodgeable.
- **Boss arenas every 2nd floor** — a named Floor Guardian (huge, ~8× champion-class health, knockback-resistant) holds the farthest room and guards the stairs. Entering locks the camera on the arena and raises a boss health bar; the kill pays 10× XP and guaranteed magic-or-better double loot.
- **Level ups** — XP from kills; each level: +14 max life, +6 max mana, +2 damage, **+1 skill point**, full heal.
- **Mana & skills** — blue mana orb with passive regeneration; a nine-skill tree in three branches (actives at tier 1, passives deeper — tiers unlock by investing in the branch). Mana potions drop and are sold in town.
<<<<<<< HEAD
- **Loot** — six sword classes (Short Sword → Falchion → Broad Sword → Estoc → Claymore → Runeblade) plus axes, maces, spears, bows, and fireball wands; armor in **leather / mail / plate weight classes** (~26 armor bases: caster helms with +mana, glass-cannon duelist gloves, heavy plate that slows you) across helmet/chest/gloves/pants/boots/ring slots and four rarities. Better bases only drop deeper. Equipped pieces **show on your character in their material's tone**.
- **Town** — cast a Town Portal to visit Ashfall Camp: a healing well, Grizzle the Trader (**E** in range opens his stall, **E** again closes it) who sells potions and gear and **buys anything you haul back** (one click or **SELL ALL**; mis-sells sit on a three-slot **buy-back shelf**, returnable at the price paid), and **Borin the Blacksmith**, who hammers weapons up to **+10** (+8% damage per level, costs escalate with rarity and depth — E strikes your equipped blade, or click any weapon with the inventory open at his anvil). The dungeon waits exactly as you left it.
=======
- **Loot** — ~28 weapon bases across a dozen visual families, each drawn distinctly in your hand and in the bag: swords, greatswords, daggers, axes, maces, flails, and spears/polearms for melee; bows, crossbows, fireball wands, arcane staves, and spinning thrown axes/javelins for range. Armor in **leather / mail / plate weight classes** (~35 armor bases: caster helms with +mana, glass-cannon duelist gloves, heavy plate that slows you) across helmet/chest/gloves/pants/boots/ring slots and four rarities, with rarity-coloured icons at a glance. Affixes span damage, life/mana, defense, attack/move speed, **critical strike, thorns, life regen, and mana-per-kill**. Better bases only drop deeper. Equipped pieces **show on your character in their material's tone**.
- **Town** — cast a Town Portal to visit Ashfall Camp: a healing well, Grizzle the Trader who sells potions and gear and **buys anything you haul back** (one click or **SELL ALL**; mis-sells sit on a three-slot **buy-back shelf**, returnable at the price paid), and **Borin the Blacksmith**, who hammers weapons up to **+10** (+8% damage per level, costs escalate with rarity and depth — E strikes your equipped blade, or click any weapon with the inventory open at his anvil). The dungeon waits exactly as you left it.
>>>>>>> feat/content-expansion
- **Quests** — the camp's **notice board** (press **E** to read it) posts three notices, rolled fresh each visit and scaled to your depth: *hunts* ("slay 10 bats" — only for monsters that spawn that deep), *champion bounties*, and *delves* ("descend to floor 8"). Carry up to three at once; progress tracks under the minimap as you play, a gold **!** over the board means a payout is waiting, and claiming pays gold **and** experience. Right-click tears one up. The charter survives saves.
- **Potions** — five tiers scaling with depth, healing gradually over 1.2 s. The belt holds four for quick keys; overflow fills a **potion box** (5 healing + 5 mana) in the inventory that auto-refills the belt — potions never crowd your bag. Click a boxed potion to drink it (right-click drops it).
- **Sound** — procedurally synthesized effects (Web Audio, no asset files).
- **Death is permanent** — a new run starts from Floor 1. How deep can you go?

## Balance

Every tuning knob — monster stats, per-floor scaling, XP curve, drop and rarity luck, spawn counts, upgrade costs — lives in **`js/balance.js`**. The human-readable balance sheet is [`BALANCE.md`](BALANCE.md), regenerated with:

```sh
node tool/balance-report.mjs > BALANCE.md
```

Tests pin the *wiring* to the balance table rather than magic numbers, so retuning never breaks the suite.

## Development

Pure logic (RNG, dungeon + town generation, items, trade prices, quests, entities, progression, saves) is unit-tested; the game loop, combat, projectiles, portals, and rendering are covered by a headless integration suite.

```sh
node --test test/*.test.js
```

`verify.html` is a test harness for headless-Chrome screenshot verification (scenes: `#combat`, `#inv`, `#death`, `#town`, `#trade`, `#board`, `#fireball`, `#save`).

### Code layout

Every file is a dual-mode IIFE: a browser `<script>` (globals, loaded in `index.html` order) that is also `require`-able from node. The three big subsystems are folders whose parts extend one shared namespace; `js/game.js`, `js/render.js`, and `js/ui.js` stay behind as node entry points, and parts share internals through `Game._` / `Render._` / `UI._` (not public API).

| Path | What lives there |
| --- | --- |
| `js/util.js` · `js/balance.js` | RNG/geometry helpers · every tuning knob |
| `js/save.js` · `js/audio.js` | localStorage saves · synthesized sound |
| `js/skills.js` · `js/items.js` · `js/entities.js` | skill tree · item generation & pricing · monster/player stats |
| `js/quests.js` | notice-board quest generation, progress, and rewards |
| `js/dungeon.js` | procedural dungeon + town generation |
| `js/game/` | simulation — `core` (events, collision), `state` (runs/floors/save restore), `combat`, `ai`, `inventory`, `town` (services + quest board), `update` (frame step) |
| `js/render/` | world drawing — `core` (color/visibility), `tiles`, `icons`, `fixtures`, `monster`, `player`, `draw` (scene composition) |
| `js/ui/` | HUD & panels — `core` (layout), `input`, `orbs`, `hud`, `panels`, `tooltip`, `creation`, `draw` (HUD composition) |
| `js/main.js` | boot, canvas sizing, input capture, rAF loop |

Design spec: `docs/superpowers/specs/2026-07-16-dungeon-browser-design.md` (with addendum). Module layout: `docs/superpowers/specs/2026-07-17-module-breakdown-design.md`.
