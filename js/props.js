// props.js — breakable room decorations: type tables, weighted picks, and loot
// rolls. Pure and node-testable, like items.js/entities.js. Placement lives in
// dungeon.js (next to spawns/torches, which own the grid); this module owns what
// a prop IS and what it drops. Stats read from Balance.props so the balance sheet
// stays the single source of truth.
(function () {
  const U = typeof require === 'function' ? require('./util.js') : window.U;
  const Balance = typeof require === 'function' ? require('./balance.js') : window.Balance;
  const Items = typeof require === 'function' ? require('./items.js') : window.Items;

  const Props = {};

  Props.TYPES = Balance.props.types;

  Props.hp = (type) => (Props.TYPES[type] || Props.TYPES.crate).hp;
  Props.isChest = (type) => !!(Props.TYPES[type] && Props.TYPES[type].chest);

  // Weighted draw over the ordinary clutter (weight > 0) available on this floor.
  // Chests are never rolled here — the dungeon places them by their own chance.
  Props.pickType = function (rng, floor) {
    const pool = Object.entries(Props.TYPES).filter(([, t]) => t.weight > 0 && (t.minFloor || 1) <= floor);
    const total = pool.reduce((s, [, t]) => s + t.weight, 0);
    let roll = rng() * total;
    for (const [name, t] of pool) {
      roll -= t.weight;
      if (roll < 0) return name;
    }
    return pool[pool.length - 1][0];
  };

  // What tumbles out when a prop shatters. Gold / item / potion are independent
  // rolls (a chest can yield all three), and gold scales with floor exactly like
  // monster gold. Returns an array of drop descriptors the sim scatters as
  // groundItems: { kind:'gold', amount } | { kind:'item', item }.
  Props.rollLoot = function (type, floor, srand) {
    const def = Props.TYPES[type] || Props.TYPES.crate;
    const scale = 1 + Balance.props.goldFloorScale * (floor - 1);
    const drops = [];
    if (def.goldChance >= 1 || srand() < def.goldChance) {
      const amount = Math.max(1, Math.round(U.randInt(srand, def.gold[0], def.gold[1]) * scale));
      drops.push({ kind: 'gold', amount });
    }
    if (srand() < def.itemChance) {
      drops.push({ kind: 'item', item: Items.makeItem(floor, srand, { guaranteeMagic: !!def.guaranteeMagic }) });
    }
    if (srand() < def.potionChance) {
      const kind = srand() < 0.3 ? 'mana' : 'health';
      drops.push({ kind: 'item', item: Items.makePotion(floor, srand, kind) });
    }
    return drops;
  };

  if (typeof window !== 'undefined') window.Props = Props;
  if (typeof module !== 'undefined') module.exports = Props;
})();
