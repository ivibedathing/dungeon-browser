// Renders js/balance.js as human-readable markdown tables.
// Usage: node tool/balance-report.mjs > BALANCE.md
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.U = require(join(root, 'js/util.js'));
const Balance = require(join(root, 'js/balance.js'));
globalThis.Items = require(join(root, 'js/items.js'));
globalThis.Skills = require(join(root, 'js/skills.js'));
const E = require(join(root, 'js/entities.js'));
const Quests = require(join(root, 'js/quests.js'));

const out = [];
const line = (s = '') => out.push(s);

line('# Dungeon Browser Balance Sheet');
line();
line('> **Generated file — do not edit.** The source of truth is `js/balance.js`;');
line('> regenerate with `node tool/balance-report.mjs > BALANCE.md`.');
line();

line('## Player');
line();
const P = Balance.player;
line('| stat | value |');
line('| --- | --- |');
line(`| Base life / mana | ${P.baseHP} / ${P.baseMana} |`);
line(`| Per level | +${P.hpPerLevel} life · +${P.manaPerLevel} mana · +${P.dmgPerLevel} damage · +${P.skillPointsPerLevel} skill point · full heal |`);
line(`| Move speed | ${P.moveSpeed} px/s |`);
line(`| Mana regen | ${P.manaRegenBase}/s base |`);
line();

line('## Experience curve');
line();
line(`XP to next level = round(${Balance.xpCurve.base} × level^${Balance.xpCurve.exponent}); monster XP × (1 + ${Balance.scaling.xpLin}·(floor−1)).`);
line();
line('| level | xp to next | cumulative |');
line('| ---: | ---: | ---: |');
let cum = 0;
for (let n = 1; n <= 30; n++) {
  cum += E.xpForLevel(n);
  if (n <= 10 || n % 5 === 0) line(`| ${n} | ${E.xpForLevel(n)} | ${cum} |`);
}
line();

line('## Monsters per floor');
line();
line(`Scaling: HP ×(1 + ${Balance.scaling.hpLin}·(f−1) + ${Balance.scaling.hpQuad}·(f−1)²) · damage ×(1 + ${Balance.scaling.dmgLin}·(f−1)).`);
line(`Champions: ×${Balance.champion.hp} HP, ×${Balance.champion.dmg} damage, ×${Balance.champion.xp} XP (${Math.round(Balance.spawns.championChance * 100)}% of spawns, min 1 from floor 3).`);
line(`Bosses (every 2nd floor, brute stock): ×${Balance.boss.hp} HP, ×${Balance.boss.dmg} damage, ×${Balance.boss.xp} XP, knockback ×${Balance.boss.kbResist}.`);
line();
for (const type of Object.keys(Balance.monsters)) {
  const b = Balance.monsters[type];
  line(`### ${type} — base ${b.hp} hp / ${b.dmg} dmg / ${b.xp} xp · speed ${b.speed} · aggro ${b.aggro}px${b.minFloor > 1 ? ` · from floor ${b.minFloor}` : ''}`);
  line();
  line('| floor | hp | dmg | xp | champion hp/dmg |');
  line('| ---: | ---: | ---: | ---: | --- |');
  for (const f of [1, 2, 4, 6, 8, 10, 12, 15, 20]) {
    const m = E.makeMonster(type, f, false);
    const c = E.makeMonster(type, f, true);
    line(`| ${f} | ${m.hp} | ${m.dmg} | ${m.xp} | ${c.hp} / ${c.dmg} |`);
  }
  line();
}

line('### Boss (Floor Guardian) per boss floor');
line();
line('| floor | hp | dmg | xp |');
line('| ---: | ---: | ---: | ---: |');
for (const f of [2, 4, 6, 8, 10, 12, 16, 20]) {
  const b = E.makeBoss(f);
  line(`| ${f} | ${b.hp} | ${b.dmg} | ${b.xp} |`);
}
line();

line('## Dungeon population');
line();
const S = Balance.spawns;
line('| floor | monsters per room (min–max) |');
line('| ---: | --- |');
for (const f of [1, 3, 5, 7, 10, 13, 20]) {
  const bonus = Math.min(S.depthCap, Math.floor((f - 1) * S.depthRate));
  line(`| ${f} | ${S.base + bonus}–${S.base + S.rand + bonus} |`);
}
line();

line('## Ambush swarms');
line();
const SW = Balance.swarm;
line(`From floor ${SW.minFloor} on, each eligible room (non-entry, non-boss, ≥ ${SW.minRoomTiles} interior tiles) has a ${Math.round(SW.roomChance * 100)}% chance to hide a swarm, up to ${SW.maxRooms} per floor. Step within ${SW.triggerTiles} tiles of the room center and a pack of swarmlings bursts in from a ${SW.ringMinTiles}–${SW.ringMaxTiles}-tile ring and sprints at you.`);
line();
line(`Pack size = min(${SW.packCap}, ${SW.packBase} + rand(0..${SW.packRand}) + floor(${SW.packRate}·(floor−${SW.minFloor}))).`);
line();
line('| floor | pack size (min–max) |');
line('| ---: | --- |');
for (const f of [Balance.swarm.minFloor, 3, 5, 7, 10, 13, 20]) {
  const bonus = Math.max(0, Math.floor((f - SW.minFloor) * SW.packRate));
  line(`| ${f} | ${Math.min(SW.packCap, SW.packBase + bonus)}–${Math.min(SW.packCap, SW.packBase + SW.packRand + bonus)} |`);
}
line();

line('## Loot luck');
line();
const D = Balance.drops;
line('Per ordinary kill (exclusive rolls, in order):');
line();
line('| outcome | chance |');
line('| --- | ---: |');
line(`| item | ${Math.round(D.item * 100)}% |`);
line(`| potion | ${Math.round(D.potion * 100)}% (of which ${Math.round(D.manaShare * 100)}% mana) |`);
line(`| gold | ${Math.round(D.gold * 100)}% |`);
line(`| nothing | ${Math.round((1 - D.item - D.potion - D.gold) * 100)}% |`);
line();
line(`Champions always drop a magic-or-better item, plus ${Math.round(D.championGold * 100)}% chance of bonus gold. Bosses always drop two magic-or-better items and a large gold pile.`);
line();

line('## Item rarity luck');
line();
const total = Object.values(Balance.rarity).reduce((a, b) => a + b, 0);
line('| rarity | weight | chance |');
line('| --- | ---: | ---: |');
for (const [tier, w] of Object.entries(Balance.rarity)) {
  line(`| ${tier} | ${w} | ${((w / total) * 100).toFixed(1)}% |`);
}
line();
line('Champion/boss drops re-roll with common excluded.');
line();

line('## Blacksmith upgrades');
line();
line(`+${Math.round(Balance.upgrade.dmgPerPlus * 100)}% weapon damage per level, max +${Balance.upgrade.maxPlus}.`);
line('Cost = round((15 + ilvl·5) × rarityMult × 1.5^plus), rarityMult common 1 / magic 1.6 / rare 2.4 / unique 4.');
line();
line('| weapon | +0→+1 | +4→+5 | +9→+10 |');
line('| --- | ---: | ---: | ---: |');
for (const [rarity, ilvl] of [['common', 1], ['rare', 5], ['unique', 10]]) {
  const mk = (plus) => Items.upgradeCost({ slot: 'weapon', rarity, ilvl, plus, stats: { damage: 10 }, affixes: [] });
  line(`| ${rarity} (floor ${ilvl}) | ${mk(0)}g | ${mk(4)}g | ${mk(9)}g |`);
}
line();

line('## Quest board');
line();
const Q = Balance.quests;
line(`${Q.boardSize} notices pinned at a time; the charter holds ${Q.maxActive}. Notices are rolled fresh on each visit to town, never duplicating a quest you already carry.`);
line();
line(`Rewards are priced in **work units** (1 unit ≈ one floor-1 skeleton, ${Q.huntXpBaseline} base XP):`);
line();
line(`> reward = units × (${Q.goldPerUnit} gold / ${Q.xpPerUnit} xp) × (1 + ${Q.rewardFloorRate}·(postedFloor−1))`);
line();
line('| quest | asks for | units |');
line('| --- | --- | --- |');
line(`| Hunt | ${Q.huntCounts.join(' / ')} of one monster kind (only kinds that spawn at that depth) | count × (quarry base xp ÷ ${Q.huntXpBaseline}) |`);
line(`| Champions | ${Q.championCounts.join(' / ')} champion heads (from floor ${Q.championMinFloor}) | count × ${Q.championUnits} |`);
line(`| Delve | descend ${Q.delveDepth.join(' / ')} floors deeper | floors × ${Q.delveUnits} |`);
line();
line('Payouts by posting floor (shortest ask of each kind):');
line();
line('| floor | bat hunt | brute hunt | champions | delve |');
line('| ---: | --- | --- | --- | --- |');
const shortest = () => 0; // an rng that always picks the first (smallest) option
for (const f of [1, 3, 5, 8, 12, 20]) {
  const cell = (kind, target) => {
    if (kind === 'hunt' && Balance.monsters[target].minFloor > f) return '—';
    if (kind === 'champion' && f < Q.championMinFloor) return '—';
    const q = Quests.makeQuest(kind, target, f, shortest);
    return `${q.reward.gold}g · ${q.reward.xp}xp`;
  };
  line(`| ${f} | ${cell('hunt', 'bat')} | ${cell('hunt', 'brute')} | ${cell('champion', null)} | ${cell('delve', null)} |`);
}

console.log(out.join('\n'));
