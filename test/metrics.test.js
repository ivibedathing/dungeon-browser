// Phase 5 Task 2 — metrics collector + structured logger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMetrics, RING } = require('../server/metrics.js');
const { createLogger } = require('../server/logger.js');

test('metrics snapshot reflects scripted counters, gauges, and tick math', () => {
  let t = 1000;
  const m = createMetrics({ now: () => t });
  m.setGauge('rooms', 3);
  m.setGauge('players', 9);
  m.incr('msgsIn', 5);
  m.incr('ticksTotal');
  m.incr('ticksTotal');
  m.kick('bad_message');
  m.kick('bad_message');
  m.kick('rate_limit');
  for (const ms of [10, 20, 30, 40, 100]) m.observeTick(ms);
  t = 6000; // 5s later
  const s = m.snapshot();
  assert.equal(s.rooms, 3);
  assert.equal(s.players, 9);
  assert.equal(s.msgsIn, 5);
  assert.equal(s.ticksTotal, 2);
  assert.deepEqual(s.kicks, { bad_message: 2, rate_limit: 1 });
  assert.equal(s.tickMs.last, 100);
  assert.equal(s.tickMs.max, 100);
  assert.equal(s.tickMs.avg, 40); // (10+20+30+40+100)/5
  assert.equal(s.tickMs.p95, 40); // sorted[floor(0.95*4)] = sorted[3] = 40
  assert.equal(s.uptimeSec, 5);
});

test('the tick ring is bounded (avg/max stay finite over many samples)', () => {
  const m = createMetrics();
  for (let i = 0; i < RING * 5; i++) m.observeTick(i % 50);
  const s = m.snapshot();
  assert.equal(s.tickSamples, RING, 'the ring caps at its bound');
  assert.ok(s.tickMs.max <= 49 && s.tickMs.avg >= 0);
});

test('logger emits one JSON line per event with the right level/event/fields', () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(l), now: () => '2026-07-18T00:00:00Z' });
  log.info('room_open', { code: 'AAAA', players: 1 });
  log.error('store_error', { msg: 'boom' });
  assert.equal(lines.length, 2);
  const a = JSON.parse(lines[0]);
  assert.deepEqual(a, { ts: '2026-07-18T00:00:00Z', level: 'info', event: 'room_open', code: 'AAAA', players: 1 });
  assert.equal(JSON.parse(lines[1]).level, 'error');
});

test('logger NEVER emits a secret field even when handed one', () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(l), now: () => 'T' });
  log.info('login', { accountId: 7, username: 'bob', password: 'hunter2', token: 'deadbeef', Authorization: 'Bearer x' });
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.accountId, 7);
  assert.equal(rec.username, 'bob');
  assert.ok(!('password' in rec), 'password dropped');
  assert.ok(!('token' in rec), 'token dropped');
  assert.ok(!('Authorization' in rec), 'authorization dropped (case-insensitive)');
  assert.ok(!lines[0].includes('hunter2') && !lines[0].includes('deadbeef'), 'no secret leaked into the raw line');
});

// ---- Live endpoints over a real server ----
const http = require('node:http');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('the server exposes /metrics (JSON) and /healthz over its http listener', async () => {
  const srv = createServer({ port: 0, serveStatic: false });
  await srv.ready;
  try {
    const port = srv.port;
    // A healthz probe.
    const health = await get(port, '/healthz');
    assert.equal(health.status, 200);
    assert.equal(health.body, 'ok');

    // Read the live room gauge while connected, THEN send a bad frame (which kicks and
    // reaps the room) and read again for the cumulative kick tally.
    let live, after;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'join', name: 'Bot' }));
        setTimeout(async () => {
          live = JSON.parse((await get(port, '/metrics')).body); // room still open
          ws.send('this is not json {{{'); // → kick + reap
          setTimeout(async () => {
            after = JSON.parse((await get(port, '/metrics')).body);
            resolve();
          }, 80);
        }, 90);
      });
      ws.on('error', reject);
    });
    assert.ok(live.ticksTotal > 0, 'ticks were counted');
    assert.ok(live.rooms >= 1, 'a room was open at read time');
    assert.ok(live.msgsIn >= 1, 'the join was counted');
    assert.ok(after.kicks.bad_message >= 1, 'the malformed frame was kicked and tallied');
    assert.ok(after.msgsDropped >= 1, 'the drop was counted');
  } finally {
    await srv.close();
  }
});
