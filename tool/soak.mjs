// tool/soak.mjs — full-scale soak driver. Spins ROOMS rooms × BOTS bots, drives the
// authoritative Room.tick at 30 Hz over MINUTES of simulated time, and samples heap +
// per-tick cost. Exits non-zero if heap grows beyond a slope threshold or tick p95
// exceeds budget. Run before a deploy:
//   node --expose-gc tool/soak.mjs [rooms] [bots] [minutes]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Protocol = require('../server/protocol.js');
const { Room } = require('../server/room.js');
const { createMetrics } = require('../server/metrics.js');

const ROOMS = Number(process.argv[2]) || 50;
const BOTS = Number(process.argv[3]) || 4;
const MINUTES = Number(process.argv[4]) || 10;
const STEP = 1000 / 30;
const TICKS = Math.round((MINUTES * 60 * 1000) / STEP);
const BUDGET_MS = STEP; // all-rooms tick work should stay well under one 30 Hz step

const metrics = createMetrics();
const registry = new Map();
for (let r = 0; r < ROOMS; r++) {
  const room = new Room({ code: 'SOAK' + r, seed: 1000 + r });
  for (let s = 0; s < BOTS; s++) room.join({});
  registry.set(room.code, room);
}

function input(seq, i) {
  const v = Protocol.validateClient({
    t: 'input', seq,
    keys: { w: i % 4 === 0, a: i % 4 === 1, s: i % 4 === 2, d: i % 4 === 3, space: i % 5 === 0 },
    pressed: i % 9 === 0 ? ['dodge'] : [],
    mouse: { x: Math.sin(i) * 400, y: Math.cos(i) * 400, click: i % 6 === 0, rclick: false },
  });
  return v.ok ? v.msg : null;
}

const heapSamples = [];
let seq = 1;
let t = 0;
const started = process.hrtime.bigint();
for (let i = 0; i < TICKS; i++) {
  t += STEP;
  const t0 = performance.now();
  for (const room of registry.values()) {
    for (const p of room.state.players) { const inp = input(seq++, i); if (inp) room.setInput(p.id, inp); }
    room.tick(t);
  }
  metrics.observeTick(performance.now() - t0);
  // Churn a little so leave/reap/rejoin paths run.
  if (i % 60 === 0) {
    for (const room of registry.values()) {
      if (room.state.players.length) room.leave(room.state.players[0].id);
      if (room.isEmpty) registry.delete(room.code);
    }
    while (registry.size < ROOMS) {
      const room = new Room({ code: 'SOAKR' + i + '_' + registry.size, seed: 7000 + registry.size });
      for (let s = 0; s < BOTS; s++) room.join({});
      registry.set(room.code, room);
    }
  }
  if (i % 900 === 0) {
    if (global.gc) global.gc();
    const heap = process.memoryUsage().heapUsed / 1e6;
    heapSamples.push(heap);
    const s = metrics.snapshot();
    console.log(`t=${(i * STEP / 1000).toFixed(0)}s heap=${heap.toFixed(1)}MB tickMs{avg=${s.tickMs.avg.toFixed(2)} p95=${s.tickMs.p95.toFixed(2)} max=${s.tickMs.max.toFixed(2)}} rooms=${registry.size}`);
  }
}

const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
const snap = metrics.snapshot();
// Heap slope: last sample vs the median of the first few — a real leak trends up hard.
const early = heapSamples.slice(0, 3).sort((a, b) => a - b)[Math.min(1, heapSamples.length - 1)] || 0;
const late = heapSamples[heapSamples.length - 1] || 0;
const growthMB = late - early;
let bad = false;
console.log(`\n${ROOMS} rooms × ${BOTS} bots × ${MINUTES}min (${TICKS} ticks) in ${(wallMs / 1000).toFixed(1)}s wall`);
console.log(`tick p95=${snap.tickMs.p95.toFixed(2)}ms max=${snap.tickMs.max.toFixed(2)}ms (budget ${BUDGET_MS.toFixed(1)}ms)`);
console.log(`heap early≈${early.toFixed(1)}MB late=${late.toFixed(1)}MB growth=${growthMB.toFixed(1)}MB`);
if (snap.tickMs.p95 > BUDGET_MS) { console.error(`FAIL: tick p95 over budget`); bad = true; }
if (global.gc && growthMB > 100) { console.error(`FAIL: heap grew ${growthMB.toFixed(1)}MB — possible leak`); bad = true; }
if (!global.gc) console.log('(run with --expose-gc for the heap-slope check)');
console.log(bad ? 'SOAK FAILED' : 'SOAK OK — memory flat, tick under budget');
process.exit(bad ? 1 : 0);
