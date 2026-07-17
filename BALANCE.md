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

Scaling: HP ×(1 + 0.38·(f−1) + 0.035·(f−1)²) · damage ×(1 + 0.28·(f−1)).
Champions: ×2.6 HP, ×1.5 damage, ×3 XP (12% of spawns, min 1 from floor 3).
Bosses (every 2nd floor, brute stock): ×8 HP, ×2 damage, ×10 XP, knockback ×0.15.

### zombie — base 38 hp / 8 dmg / 14 xp · speed 55 · aggro 265px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 38 | 8 | 14 | 99 / 12 |
| 2 | 54 | 10 | 17 | 140 / 15 |
| 4 | 93 | 15 | 23 | 242 / 23 |
| 6 | 143 | 19 | 29 | 372 / 29 |
| 8 | 204 | 24 | 36 | 530 / 36 |
| 10 | 276 | 28 | 42 | 718 / 42 |
| 12 | 358 | 33 | 48 | 931 / 50 |
| 15 | 501 | 39 | 57 | 1303 / 59 |
| 20 | 792 | 51 | 73 | 2059 / 77 |

### skeleton — base 27 hp / 7 dmg / 12 xp · speed 78 · aggro 300px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 27 | 7 | 12 | 70 / 11 |
| 2 | 38 | 9 | 15 | 99 / 14 |
| 4 | 66 | 13 | 20 | 172 / 20 |
| 6 | 102 | 17 | 25 | 265 / 26 |
| 8 | 145 | 21 | 30 | 377 / 32 |
| 10 | 196 | 25 | 36 | 510 / 38 |
| 12 | 254 | 29 | 41 | 660 / 44 |
| 15 | 356 | 34 | 49 | 926 / 51 |
| 20 | 563 | 44 | 62 | 1464 / 66 |

### bat — base 15 hp / 5 dmg / 9 xp · speed 108 · aggro 345px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 15 | 5 | 9 | 39 / 8 |
| 2 | 21 | 6 | 11 | 55 / 9 |
| 4 | 37 | 9 | 15 | 96 / 14 |
| 6 | 57 | 12 | 19 | 148 / 18 |
| 8 | 81 | 15 | 23 | 211 / 23 |
| 10 | 109 | 18 | 27 | 283 / 27 |
| 12 | 141 | 20 | 31 | 367 / 30 |
| 15 | 198 | 25 | 37 | 515 / 38 |
| 20 | 313 | 32 | 47 | 814 / 48 |

### brute — base 68 hp / 15 dmg / 26 xp · speed 48 · aggro 255px

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 68 | 15 | 26 | 177 / 23 |
| 2 | 96 | 19 | 32 | 250 / 29 |
| 4 | 167 | 28 | 43 | 434 / 42 |
| 6 | 257 | 36 | 55 | 668 / 54 |
| 8 | 366 | 44 | 66 | 952 / 66 |
| 10 | 493 | 53 | 77 | 1282 / 80 |
| 12 | 640 | 61 | 89 | 1664 / 92 |
| 15 | 896 | 74 | 106 | 2330 / 111 |
| 20 | 1418 | 95 | 135 | 3687 / 143 |

### wraith — base 24 hp / 11 dmg / 20 xp · speed 95 · aggro 370px · from floor 3

| floor | hp | dmg | xp | champion hp/dmg |
| ---: | ---: | ---: | ---: | --- |
| 1 | 24 | 11 | 20 | 62 / 17 |
| 2 | 34 | 14 | 24 | 88 / 21 |
| 4 | 59 | 20 | 33 | 153 / 30 |
| 6 | 91 | 26 | 42 | 237 / 39 |
| 8 | 129 | 33 | 51 | 335 / 50 |
| 10 | 174 | 39 | 60 | 452 / 59 |
| 12 | 226 | 45 | 68 | 588 / 68 |
| 15 | 316 | 54 | 82 | 822 / 81 |
| 20 | 501 | 70 | 104 | 1303 / 105 |

### Boss (Floor Guardian) per boss floor

| floor | hp | dmg | xp |
| ---: | ---: | ---: | ---: |
| 2 | 768 | 38 | 320 |
| 4 | 1336 | 56 | 430 |
| 6 | 2056 | 72 | 550 |
| 8 | 2928 | 88 | 660 |
| 10 | 3944 | 106 | 770 |
| 12 | 5120 | 122 | 890 |
| 16 | 7928 | 156 | 1120 |
| 20 | 11344 | 190 | 1350 |

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
