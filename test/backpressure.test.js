// Phase 5 Task 4 — capacity caps and graceful drain.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');
const { createStore } = require('../server/store.js');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const c = { ws, errors: [], authed: null, characters: null, selected: null, welcome: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'error') c.errors.push(m);
    if (m.t === 'authed') { c.authed = m; c.characters = m.characters; }
    if (m.t === 'characters') c.characters = m.characters;
    if (m.t === 'selected') c.selected = m;
    if (m.t === 'welcome') c.welcome = m;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await wait(15); }
  return false;
}

test('opening a room past maxRooms is a clean server_full kick, not an OOM', async () => {
  const srv = createServer({ port: 0, serveStatic: false, maxRooms: 1 });
  await srv.ready;
  try {
    const a = client(srv.port);
    await a.open();
    a.send({ t: 'join', name: 'A' }); // creates room 1
    assert.ok(await until(() => a.welcome), 'first host got in');

    const b = client(srv.port);
    await b.open();
    b.send({ t: 'join', name: 'B' }); // would open room 2 → over cap
    assert.ok(await until(() => b.errors.length), 'second host was answered');
    assert.equal(b.errors[0].reason, 'server_full');
  } finally {
    await srv.close();
  }
});

test('SIGTERM-style drain flushes a final save for a live authenticated player', async () => {
  // Wrap MemStore in a spy that counts saveCharacter calls (Proxy delegates the rest).
  const mem = createStore({});
  let saves = 0;
  const spy = new Proxy(mem, {
    get(t, k) {
      if (k === 'saveCharacter') return (...a) => { saves++; return t.saveCharacter(...a); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });

  const srv = createServer({ port: 0, serveStatic: false, store: spy });
  await srv.ready;
  try {
    const c = client(srv.port);
    await c.open();
    c.send({ t: 'register', username: 'drainhero', password: 'a good password', name: 'Drain', shirt: '#4a5578' });
    assert.ok(await until(() => c.authed), 'registered');
    c.send({ t: 'createChar', slot: 0, name: 'Drain', shirt: '#4a5578' });
    assert.ok(await until(() => (c.characters || []).some((ch) => ch.slot === 0)), 'character created');
    c.send({ t: 'selectChar', slot: 0 });
    assert.ok(await until(() => c.selected), 'selected');
    c.send({ t: 'join', name: 'Drain' });
    assert.ok(await until(() => c.welcome), 'joined');
    await wait(80); // let a few ticks run

    const before = saves;
    await srv.drain({ timeoutMs: 2000 }); // graceful shutdown
    assert.ok(saves > before, 'drain flushed a final save for the live player');
  } finally {
    try { await srv.close(); } catch {}
  }
});
