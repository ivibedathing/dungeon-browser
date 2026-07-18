// Phase 4.5 Track C — the trust boundary, encoded as executable rules.
//
// The load-bearing statement (read this before changing anything here): CLIENT-SIDE
// INTEGRITY IS NOT A SECURITY BOUNDARY. A determined client controls its own process.
// The only real boundary is that the SERVER recomputes every authoritative number from
// its OWN tables and never stores a value the client sent. These tests assert exactly
// that, so the next feature can't quietly erode it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.U = require('../js/util.js');
globalThis.Items = require('../js/items.js');
globalThis.Props = require('../js/props.js');
globalThis.Skills = require('../js/skills.js');
globalThis.Entities = require('../js/entities.js');
globalThis.Quests = require('../js/quests.js');
globalThis.Dungeon = require('../js/dungeon.js');
const Game = require('../js/game.js');
const Intents = require('../server/intents.js');
const Protocol = require('../server/protocol.js');
const Character = require('../server/character.js');

// ---- No presentation import in sim or server ----

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('no simulation or server file references a presentation module (Render/Assets)', () => {
  const roots = [path.join(__dirname, '..', 'js', 'game'), path.join(__dirname, '..', 'server')];
  const offenders = [];
  for (const root of roots) {
    for (const file of jsFiles(root)) {
      const src = fs.readFileSync(file, 'utf8');
      // Strip line comments so a mention in prose doesn't trip the scan.
      const code = src.replace(/\/\/.*$/gm, '');
      if (/\bRender\b/.test(code) || /\bAssets\b/.test(code)) offenders.push(path.relative(path.join(__dirname, '..'), file));
    }
  }
  assert.deepEqual(offenders, [], `presentation leaked into sim/server: ${offenders.join(', ')}`);
});

// ---- Forged stat fields never land ----

test('every intent rejects an injected damage/price/stats/gold/level field', () => {
  const injections = [{ damage: 999 }, { price: 0 }, { stats: { damage: 1 } }, { gold: 1e9 }, { level: 99 }];
  const bases = [
    { intent: 'equip', slot: 0 },
    { intent: 'unequip', slotName: 'weapon' },
    { intent: 'sell', slot: 0 },
    { intent: 'upgrade', slotName: 'weapon' },
    { intent: 'learn', skillId: 'whirlwind' },
    { intent: 'buy', index: 0 },
  ];
  for (const base of bases) {
    assert.equal(Protocol.validateClient({ t: 'intent', ...base }).ok, true, `${base.intent} clean is accepted`);
    for (const inj of injections) {
      const res = Protocol.validateClient({ t: 'intent', ...base, ...inj });
      assert.equal(res.ok, false, `${base.intent} + ${Object.keys(inj)[0]} must be rejected`);
    }
  }
});

test('buy uses the SERVER price, not any client-claimed value', () => {
  const state = Game.newRun(1);
  const p = state.player;
  const item = Items.makeItem(4, U.mulberry32(2), { slot: 'armor', rarity: 'rare' });
  state.shop = [{ item, price: 1 /* a lie the server never reads */ }];
  const serverPrice = Items.buyPrice(item);
  // One gold short of the SERVER price ⇒ rejected, proving the client's price:1 is ignored.
  p.bag.gold = serverPrice - 1;
  assert.equal(Intents.apply(state, p, { intent: 'buy', index: 0 }).ok, false, 'server price enforced');
  assert.equal(p.bag.gold, serverPrice - 1, 'gold untouched on reject');
  // Exactly the server price ⇒ succeeds and charges exactly that.
  p.bag.gold = serverPrice;
  assert.equal(Intents.apply(state, p, { intent: 'buy', index: 0 }).ok, true);
  assert.equal(p.bag.gold, 0, 'charged exactly the server price');
});

// ---- No client message can set an authoritative number directly ----

test('the accepted client protocol has no message that sets a stat, gold, or level', () => {
  // Enumerate the accepted message types; none may be a "set my stats" backdoor.
  const forbidden = ['setStats', 'setGold', 'setLevel', 'grant', 'stats'];
  for (const t of forbidden) {
    assert.equal(Protocol.validateClient({ t, damage: 1, gold: 1 }).ok, false, `${t} is not an accepted message`);
  }
});

test('a persisted character blob carries only server-side player values', () => {
  // characterBlob copies from the live (server-owned) player; the client never writes
  // these fields — they change only through server code (gainXP, Intents, dropLoot).
  const state = Game.newRun(7);
  state.player.level = 5; // as if the server leveled it
  state.player.bag.gold = 42;
  const blob = Character.characterBlob(state, state.player, state.player.bag);
  assert.equal(blob.player.level, 5);
  assert.equal(blob.bag.gold, 42);
  // And a load re-sanitizes: an inflated field in a hypothetically-tampered blob is clamped.
  blob.player.level = 999999;
  const loaded = Character.playerFromCharacter(blob, 'p0');
  assert.ok(loaded.level <= require('../server/schema.js').MAX_LEVEL, 'a tampered level is clamped on load');
});
