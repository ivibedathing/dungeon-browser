// server/metrics.js — a tiny zero-dep metrics collector: counters, gauges, a bounded
// tick-duration ring (avg/max/p95), and per-reason kick tallies. Injectable so tests
// stay deterministic; reading state never mutates the sim.
'use strict';

const RING = 300; // bounded — the soak (Task 3) checks this doesn't grow

function createMetrics(opts = {}) {
  const now = opts.now || (() => Date.now());
  const start = now();
  const counters = Object.create(null);
  const gauges = Object.create(null);
  const kicks = Object.create(null);
  const ticks = []; // rolling window of tick durations (ms)

  function incr(name, n = 1) { counters[name] = (counters[name] || 0) + n; }
  function kick(reason) { const r = reason || 'unknown'; kicks[r] = (kicks[r] || 0) + 1; }
  function setGauge(name, v) { gauges[name] = v; }
  function observeTick(ms) {
    ticks.push(ms);
    if (ticks.length > RING) ticks.shift();
  }

  function pct(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
    return sorted[idx];
  }

  function snapshot() {
    const sorted = ticks.slice().sort((a, b) => a - b);
    const sum = ticks.reduce((s, v) => s + v, 0);
    return {
      rooms: gauges.rooms || 0,
      players: gauges.players || 0,
      ticksTotal: counters.ticksTotal || 0,
      tickMs: {
        last: ticks.length ? ticks[ticks.length - 1] : 0,
        avg: ticks.length ? sum / ticks.length : 0,
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        p95: pct(sorted, 0.95),
      },
      tickSamples: ticks.length,
      msgsIn: counters.msgsIn || 0,
      msgsDropped: counters.msgsDropped || 0,
      snapshotsDropped: counters.snapshotsDropped || 0,
      kicks: { ...kicks },
      uptimeSec: Math.round((now() - start) / 1000),
      rss: typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage().rss : 0,
    };
  }

  return { incr, kick, setGauge, observeTick, snapshot };
}

module.exports = { createMetrics, RING };
