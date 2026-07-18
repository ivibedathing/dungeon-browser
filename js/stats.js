// stats.js — the hero's tally sheet. Every counter exists twice: a per-run sheet
// carried on the player (p.stats, saved with the character) and a lifetime total
// kept in localStorage. The panel prints `lifetime + run` for the lifetime column,
// so a tally is never double-counted mid-run — the run only folds into the
// lifetime once, when the run ends (see Save.addLifetime).
//
// Pure and node-testable: no DOM, no storage, no sim access.
(function () {
  const Stats = {};

  // Declaration order is the panel's row order. `gold` marks the one counter the
  // panel prints in coin colour; `group` draws a hairline above the first row of
  // each new group.
  Stats.FIELDS = [
    { key: 'tiles', label: 'Squares walked', group: 'Wandering' },
    { key: 'floors', label: 'Floors descended' },
    { key: 'kills', label: 'Monsters slain', group: 'Slaughter' },
    { key: 'bosses', label: 'Bosses felled' },
    { key: 'swings', label: 'Sword swings' },
    { key: 'shots', label: 'Shots loosed' },
    { key: 'casts', label: 'Skills cast' },
    { key: 'dealt', label: 'Damage dealt' },
    { key: 'taken', label: 'Damage taken' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'gold', label: 'Gold gathered', group: 'Spoils', gold: true },
    { key: 'items', label: 'Items picked up' },
    { key: 'potions', label: 'Potions drunk' },
    { key: 'quests', label: 'Quests completed' },
  ];

  Stats.KEYS = Stats.FIELDS.map((f) => f.key);

  // A tally can only ever grow, so this ceiling is both the save-load clamp and
  // the overflow guard. Well above anything real play reaches.
  Stats.CAP = 1e12;

  Stats.create = function create() {
    const s = {};
    for (const key of Stats.KEYS) s[key] = 0;
    return s;
  };

  // The single mutation point. Tolerates a missing sheet so no call site has to
  // null-check: a player restored from a pre-stats save grows one on first bump.
  Stats.bump = function bump(owner, key, amount) {
    if (!owner) return;
    const sheet = owner.stats || (owner.stats = Stats.create());
    const n = amount === undefined ? 1 : amount;
    if (!Number.isFinite(n) || n <= 0) return;
    sheet[key] = Math.min(Stats.CAP, (sheet[key] || 0) + n);
  };

  // Coerce anything — an old save, a hand-edited localStorage blob, a hostile
  // character payload — into a clean sheet. Unknown keys are dropped, so the
  // sheet's shape is always exactly Stats.KEYS.
  Stats.sanitize = function sanitize(raw) {
    const out = Stats.create();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of Stats.KEYS) {
      const v = raw[key];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = Math.min(Stats.CAP, v);
    }
    return out;
  };

  Stats.merge = function merge(a, b) {
    const out = Stats.create();
    for (const key of Stats.KEYS) {
      out[key] = Math.min(Stats.CAP, ((a && a[key]) || 0) + ((b && b[key]) || 0));
    }
    return out;
  };

  // 19204 → "19,204". Damage accumulates fractional; the sheet reads whole. The
  // grouping is done by hand rather than toLocaleString so the panel renders the
  // same in every locale and in the headless UI tests.
  Stats.format = function format(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  if (typeof window !== 'undefined') window.Stats = Stats;
  if (typeof module !== 'undefined') module.exports = Stats;
})();
