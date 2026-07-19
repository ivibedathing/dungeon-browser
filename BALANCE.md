# Dungeon Browser Balance Sheet

> **Generated file — do not edit.** The source of truth is `js/balance.js`;
> regenerate with `node tool/balance-report.mjs > BALANCE.md`.

## Player

| stat | value |
| --- | --- |
| Base life / mana | 100 / 40 |
| Per level | +12 life · +6 mana · +2 damage · +1 skill point · full heal |
| Move speed | 170 px/s |
| Mana regen | 2.5/s base |

## Experience curve

XP to next level = round(100 × level^1.62); monster XP × (1 + 0.22·(floor−1)).

| level | xp to next | cumulative |
| ---: | ---: | ---: |
| 1 | 100 | 100 |
| 2 | 307 | 407 |
| 3 | 593 | 1000 |
| 4 | 945 | 1945 |
| 5 | 1356 | 3301 |
| 6 | 1822 | 5123 |
| 7 | 2339 | 7462 |
| 8 | 2904 | 10366 |
| 9 | 3515 | 13881 |
| 10 | 4169 | 18050 |
| 15 | 8040 | 50123 |
| 20 | 12814 | 104306 |
| 25 | 18393 | 184804 |
| 30 | 24714 | 295447 |

## Monsters per floor

Scaling: HP ×(1 + 0.3·(f−1) + 0.006·(f−1)²) · damage ×(1 + 0.42·(f−1)).
Champions: ×2.6 HP, ×1.5 damage, ×3 XP (12% of spawns, min 1 from floor 3).
Generic guardians (arena floors 2/6/10/14/18/22 and every even floor past 24, brute stock): ×8 HP, ×2 damage, ×10 XP, knockback ×0.15.

### Act bosses (the main quest)

Six named bosses close the six acts. All scale from brute stock on their floor and share the guardian combat feel (aggro, reach, knockback resist); escalation across acts is carried by damage and mechanics rather than by HP.

| act | title | floor | boss | HP | damage | XP | phases |
| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | The Crypts | 4 | Gravemaw | ×8.2 | ×2.1 | ×14 | 1 |
| 2 | The Caverns | 8 | The Hollow Choir | ×8.4 | ×2.2 | ×16 | 2 |
| 3 | The Warrens | 12 | The Warden of Ash | ×8.6 | ×2.3 | ×18 | 2 |
| 4 | The Deep | 16 | Thessaly Coldspine | ×8.8 | ×2.4 | ×20 | 2 |
| 5 | The Under-Deep | 20 | Vexis the Unmourned | ×9.2 | ×2.5 | ×24 | 3 |
| 6 | The Sanctum | 24 (final) | Duromar | ×11 | ×2.7 | ×40 | 4 |

### zombie — base 38 hp / 8 dmg / 14 xp · speed 55 · aggro 265px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 38 | 8 | 14 | 99 / 12 |
| 2 | 50 | 11 | 17 | 130 / 17 |
| 4 | 74 | 18 | 23 | 192 / 27 |
| 6 | 101 | 25 | 29 | 263 / 38 |
| 8 | 129 | 32 | 36 | 335 / 48 |
| 10 | 159 | 38 | 42 | 413 / 57 |
| 12 | 191 | 45 | 48 | 497 / 68 |
| 15 | 242 | 55 | 57 | 629 / 83 |
| 20 | 337 | 72 | 73 | 876 / 108 |

### skeleton — base 27 hp / 7 dmg / 12 xp · speed 78 · aggro 300px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 27 | 7 | 12 | 70 / 11 |
| 2 | 35 | 10 | 15 | 91 / 15 |
| 4 | 53 | 16 | 20 | 138 / 24 |
| 6 | 72 | 22 | 25 | 187 / 33 |
| 8 | 92 | 28 | 30 | 239 / 42 |
| 10 | 113 | 33 | 36 | 294 / 50 |
| 12 | 136 | 39 | 41 | 354 / 59 |
| 15 | 172 | 48 | 49 | 447 / 72 |
| 20 | 239 | 63 | 62 | 621 / 95 |

### bat — base 15 hp / 5 dmg / 9 xp · speed 108 · aggro 345px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 15 | 5 | 9 | 39 / 8 |
| 2 | 20 | 7 | 11 | 52 / 11 |
| 4 | 29 | 11 | 15 | 75 / 17 |
| 6 | 40 | 16 | 19 | 104 / 24 |
| 8 | 51 | 20 | 23 | 133 / 30 |
| 10 | 63 | 24 | 27 | 164 / 36 |
| 12 | 75 | 28 | 31 | 195 / 42 |
| 15 | 96 | 34 | 37 | 250 / 51 |
| 20 | 133 | 45 | 47 | 346 / 68 |

### brute — base 68 hp / 15 dmg / 26 xp · speed 48 · aggro 255px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 68 | 15 | 26 | 177 / 23 |
| 2 | 89 | 21 | 32 | 231 / 32 |
| 4 | 133 | 34 | 43 | 346 / 51 |
| 6 | 180 | 47 | 55 | 468 / 71 |
| 8 | 231 | 59 | 66 | 601 / 89 |
| 10 | 285 | 72 | 77 | 741 / 108 |
| 12 | 342 | 84 | 89 | 889 / 126 |
| 15 | 434 | 103 | 106 | 1128 / 155 |
| 20 | 603 | 135 | 135 | 1568 / 203 |

### wraith — base 24 hp / 11 dmg / 20 xp · speed 95 · aggro 370px · from floor 3

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 24 | 11 | 20 | 62 / 17 |
| 2 | 31 | 16 | 24 | 81 / 24 |
| 4 | 47 | 25 | 33 | 122 / 38 |
| 6 | 64 | 34 | 42 | 166 / 51 |
| 8 | 81 | 43 | 51 | 211 / 65 |
| 10 | 100 | 53 | 60 | 260 / 80 |
| 12 | 121 | 62 | 68 | 315 / 93 |
| 15 | 153 | 76 | 82 | 398 / 114 |
| 20 | 213 | 99 | 104 | 554 / 149 |

### ghoul — base 56 hp / 11 dmg / 21 xp · speed 62 · aggro 275px · from floor 2

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 56 | 11 | 21 | 146 / 17 |
| 2 | 73 | 16 | 26 | 190 / 24 |
| 4 | 109 | 25 | 35 | 283 / 38 |
| 6 | 148 | 34 | 44 | 385 / 51 |
| 8 | 190 | 43 | 53 | 494 / 65 |
| 10 | 234 | 53 | 63 | 608 / 80 |
| 12 | 281 | 62 | 72 | 731 / 93 |
| 15 | 357 | 76 | 86 | 928 / 114 |
| 20 | 496 | 99 | 109 | 1290 / 149 |

### hound — base 22 hp / 8 dmg / 13 xp · speed 132 · aggro 340px · from floor 2

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 22 | 8 | 13 | 57 / 12 |
| 2 | 29 | 11 | 16 | 75 / 17 |
| 4 | 43 | 18 | 22 | 112 / 27 |
| 6 | 58 | 25 | 27 | 151 / 38 |
| 8 | 75 | 32 | 33 | 195 / 48 |
| 10 | 92 | 38 | 39 | 239 / 57 |
| 12 | 111 | 45 | 44 | 289 / 68 |
| 15 | 140 | 55 | 53 | 364 / 83 |
| 20 | 195 | 72 | 67 | 507 / 108 |

### spider — base 17 hp / 7 dmg / 11 xp · speed 118 · aggro 330px · from floor 3

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 17 | 7 | 11 | 44 / 11 |
| 2 | 22 | 10 | 13 | 57 / 15 |
| 4 | 33 | 16 | 18 | 86 / 24 |
| 6 | 45 | 22 | 23 | 117 / 33 |
| 8 | 58 | 28 | 28 | 151 / 42 |
| 10 | 71 | 33 | 33 | 185 / 50 |
| 12 | 85 | 39 | 38 | 221 / 59 |
| 15 | 108 | 48 | 45 | 281 / 72 |
| 20 | 151 | 63 | 57 | 393 / 95 |

### skeleton_knight — base 64 hp / 13 dmg / 26 xp · speed 54 · aggro 260px · from floor 4

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 64 | 13 | 26 | 166 / 20 |
| 2 | 84 | 18 | 32 | 218 / 27 |
| 4 | 125 | 29 | 43 | 325 / 44 |
| 6 | 170 | 40 | 55 | 442 / 60 |
| 8 | 217 | 51 | 66 | 564 / 77 |
| 10 | 268 | 62 | 77 | 697 / 93 |
| 12 | 322 | 73 | 89 | 837 / 110 |
| 15 | 408 | 89 | 106 | 1061 / 134 |
| 20 | 567 | 117 | 135 | 1474 / 176 |

### ogre — base 118 hp / 23 dmg / 42 xp · speed 44 · aggro 250px · from floor 5

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 118 | 23 | 42 | 307 / 35 |
| 2 | 154 | 33 | 51 | 400 / 50 |
| 4 | 231 | 52 | 70 | 601 / 78 |
| 6 | 313 | 71 | 88 | 814 / 107 |
| 8 | 400 | 91 | 107 | 1040 / 137 |
| 10 | 494 | 110 | 125 | 1284 / 165 |
| 12 | 593 | 129 | 144 | 1542 / 194 |
| 15 | 752 | 158 | 171 | 1955 / 237 |
| 20 | 1046 | 207 | 218 | 2720 / 311 |

### cultist — base 26 hp / 10 dmg / 22 xp · speed 70 · aggro 380px · from floor 4 · behavior: ranged

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 26 | 10 | 22 | 68 / 15 |
| 2 | 34 | 14 | 27 | 88 / 21 |
| 4 | 51 | 23 | 37 | 133 / 35 |
| 6 | 69 | 31 | 46 | 179 / 47 |
| 8 | 88 | 39 | 56 | 229 / 59 |
| 10 | 109 | 48 | 66 | 283 / 72 |
| 12 | 131 | 56 | 75 | 341 / 84 |
| 15 | 166 | 69 | 90 | 432 / 104 |
| 20 | 231 | 90 | 114 | 601 / 135 |

### bomber — base 30 hp / 24 dmg / 18 xp · speed 92 · aggro 360px · from floor 5 · behavior: exploder

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 30 | 24 | 18 | 78 / 36 |
| 2 | 39 | 34 | 22 | 101 / 51 |
| 4 | 59 | 54 | 30 | 153 / 81 |
| 6 | 80 | 74 | 38 | 208 / 111 |
| 8 | 102 | 95 | 46 | 265 / 143 |
| 10 | 126 | 115 | 54 | 328 / 173 |
| 12 | 151 | 135 | 62 | 393 / 203 |
| 15 | 191 | 165 | 73 | 497 / 248 |
| 20 | 266 | 216 | 93 | 692 / 324 |

### gargoyle — base 46 hp / 18 dmg / 26 xp · speed 60 · aggro 340px · from floor 6 · behavior: charger

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 46 | 18 | 26 | 120 / 27 |
| 2 | 60 | 26 | 32 | 156 / 39 |
| 4 | 90 | 41 | 43 | 234 / 62 |
| 6 | 122 | 56 | 55 | 317 / 84 |
| 8 | 156 | 71 | 66 | 406 / 107 |
| 10 | 193 | 86 | 77 | 502 / 129 |
| 12 | 231 | 101 | 89 | 601 / 152 |
| 15 | 293 | 124 | 106 | 762 / 186 |
| 20 | 408 | 162 | 135 | 1061 / 243 |

### necromancer — base 40 hp / 8 dmg / 30 xp · speed 66 · aggro 360px · from floor 6 · behavior: summoner

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 40 | 8 | 30 | 104 / 12 |
| 2 | 52 | 11 | 37 | 135 / 17 |
| 4 | 78 | 18 | 50 | 203 / 27 |
| 6 | 106 | 25 | 63 | 276 / 38 |
| 8 | 136 | 32 | 76 | 354 / 48 |
| 10 | 167 | 38 | 89 | 434 / 57 |
| 12 | 201 | 45 | 103 | 523 / 68 |
| 15 | 255 | 55 | 122 | 663 / 83 |
| 20 | 355 | 72 | 155 | 923 / 108 |

### swarmling — base 8 hp / 4 dmg / 4 xp · speed 165 · aggro 1400px · from floor 2

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 8 | 4 | 4 | 21 / 6 |
| 2 | 10 | 6 | 5 | 26 / 9 |
| 4 | 16 | 9 | 7 | 42 / 14 |
| 6 | 21 | 12 | 8 | 55 / 18 |
| 8 | 27 | 16 | 10 | 70 / 24 |
| 10 | 33 | 19 | 12 | 86 / 29 |
| 12 | 40 | 22 | 14 | 104 / 33 |
| 15 | 51 | 28 | 16 | 133 / 42 |
| 20 | 71 | 36 | 21 | 185 / 54 |

### Behavior tuning (special archetypes)

Telegraph windows are deliberately generous so every special is dodgeable.

- **ranged** — fireRange: 340 · castTime: 0.45 · boltSpeed: 300 · kiteRange: 150
- **exploder** — fuseTime: 0.7 · blastRadius: 74 · blastKb: 220
- **charger** — windupTime: 0.5 · dashTime: 0.26 · dashSpeed: 540 · triggerRange: 240 · minRange: 60
- **summoner** — castTime: 0.6 · cap: 4 · minionsPerCast: 2 · minionType: skeleton · kiteRange: 170

### Boss (Floor Guardian) per boss floor

| floor | hp | dmg | xp |
| ---: | ---: | ---: | ---: |
| 2 | 712 | 42 | 320 |
| 4 | 1091 | 71 | 602 |
| 6 | 1440 | 94 | 550 |
| 8 | 1940 | 130 | 1056 |
| 10 | 2280 | 144 | 770 |
| 12 | 2941 | 193 | 1602 |
| 16 | 4101 | 264 | 2240 |
| 20 | 5548 | 338 | 3240 |

## Dungeon population

| floor | monsters per room (min–max) |
| ---: | --- |
| 1 | 2–4 |
| 3 | 3–5 |
| 5 | 4–6 |
| 7 | 6–8 |
| 10 | 6–8 |
| 13 | 6–8 |
| 20 | 6–8 |

## Ambush swarms

From floor 2 on, each eligible room (non-entry, non-boss, ≥ 30 interior tiles) has a 32% chance to hide a swarm, up to 2 per floor. Step within 3.4 tiles of the room center and a pack of swarmlings bursts in from a 3.6–7-tile ring and sprints at you.

Pack size = min(18, 6 + rand(0..3) + floor(0.8·(floor−2))).

| floor | pack size (min–max) |
| ---: | --- |
| 2 | 6–9 |
| 3 | 6–9 |
| 5 | 8–11 |
| 7 | 10–13 |
| 10 | 12–15 |
| 13 | 14–17 |
| 20 | 18–18 |

## Loot luck

Per ordinary kill (exclusive rolls, in order):

| outcome | chance |
| --- | ---: |
| item | 12% |
| potion | 18% (of which 30% mana) |
| gold | 30% |
| nothing | 40% |

Champions always drop a magic-or-better item, plus 80% chance of bonus gold. Bosses always drop two magic-or-better items and a large gold pile.

## Item rarity luck

| rarity | weight | chance |
| --- | ---: | ---: |
| common | 66 | 66.0% |
| magic | 24 | 24.0% |
| rare | 8 | 8.0% |
| unique | 2 | 2.0% |

Champion/boss drops re-roll with common excluded.

## Blacksmith upgrades

+8% weapon damage per level, max +10.
Cost = round((15 + ilvl·5) × rarityMult × 1.5^plus), rarityMult common 1 / magic 1.6 / rare 2.4 / unique 4.

| weapon | +0→+1 | +4→+5 | +9→+10 |
| --- | ---: | ---: | ---: |
| common (floor 1) | 20g | 101g | 769g |
| rare (floor 5) | 96g | 486g | 3691g |
| unique (floor 10) | 260g | 1316g | 9995g |

## Quest board

3 notices pinned at a time; the charter holds 3. Notices are rolled fresh on each visit to town, never duplicating a quest you already carry.

Rewards are priced in **work units** (1 unit ≈ one floor-1 skeleton, 12 base XP):

> reward = units × (7 gold / 6 xp) × (1 + 0.35·(postedFloor−1))

| quest | asks for | units |
| --- | --- | --- |
| Hunt | 8 / 10 / 12 of one monster kind (only kinds that spawn at that depth) | count × (quarry base xp ÷ 12) |
| Champions | 2 / 3 champion heads (from floor 2) | count × 8 |
| Delve | descend 2 / 3 floors deeper | floors × 12 |

Payouts by posting floor (shortest ask of each kind):

| floor | bat hunt | brute hunt | champions | delve |
| ---: | --- | --- | --- | --- |
| 1 | 42g · 36xp | 121g · 104xp | — | 168g · 144xp |
| 3 | 71g · 61xp | 206g · 177xp | 190g · 163xp | 286g · 245xp |
| 5 | 101g · 86xp | 291g · 250xp | 269g · 230xp | 403g · 346xp |
| 8 | 145g · 124xp | 419g · 359xp | 386g · 331xp | 580g · 497xp |
| 12 | 204g · 175xp | 588g · 504xp | 543g · 466xp | 815g · 698xp |
| 20 | 321g · 275xp | 928g · 796xp | 857g · 734xp | 1285g · 1102xp |

## The overworld

A 2048×2048-tile continent — 32×32 chunks of 64 —
with Ashfall Camp at its centre. Danger runs along ONE axis: `ring`, the
Chebyshev chunk distance from camp. Ring maps to an **effective floor** that
feeds straight into the same `E.makeMonster` the dungeon uses, so hp/dmg/xp
scaling, champion rolls and the `minFloor` type pool all come along unchanged —
there is no second balance curve here.

> effective floor = max(1, round(1.6 × ring)), and 0 inside the safe ring (ring ≤ 1)
> monsters per chunk = min(8, round(2 + 0.45·ring) + rand(0..2))
> champion chance = min(0.4, 0.05 + 0.022·ring)

| ring | effective floor | monsters/chunk | champion | world boss | zombie hp | zombie dmg |
| ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 0 | — (safe) | 0 | — | no | — | — |
| 1 | — (safe) | 0 | — | no | — | — |
| 2 | 3 | 3–5 | 9.4% | no | 62 | 15 |
| 4 | 6 | 4–6 | 13.8% | no | 101 | 25 |
| 6 | 10 | 5–7 | 18.2% | no | 159 | 38 |
| 8 | 13 | 6–8 | 22.6% | 7%/chunk | 208 | 48 |
| 10 | 16 | 7–9 | 27.0% | 7%/chunk | 260 | 58 |
| 12 | 19 | 7–9 | 31.4% | 7%/chunk | 317 | 68 |
| 14 | 22 | 8–10 | 35.8% | 7%/chunk | 378 | 79 |
| 16 | 26 | 8–10 | 40.0% | 7%/chunk | 466 | 92 |

| knob | value | why |
| --- | --- | --- |
| activeRadius | 2 chunks | a 5×5 live block (320² tiles), comfortably past the viewport |
| activeChunkCap | 60 | a scattered party multiplies the live set; this is what the sim budget is sized against |
| sightTiles | 18 | daylight, against a dungeon floor's 9 |
| leashTiles | 16 | past this a chase is abandoned — without it a conga line forms across the map |
| respawnSeconds | 240 | how long a cleared chunk stays cleared |
| mouthChance | 0.16 | dungeon mouths per chunk (one POI roll per chunk) |
| waystoneChance | 0.05 | waystones per chunk — the world's fast travel |

