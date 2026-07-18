// Phase 1 — wire protocol: framing, hand-rolled validation, rate limits, seq numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Protocol = require('../server/protocol.js');

function goodInput(over) {
  return Object.assign(
    {
      t: 'input',
      seq: 1,
      keys: { w: false, a: false, s: false, d: true, space: false },
      pressed: ['interact'],
      mouse: { x: 10, y: 20, click: false, rclick: false },
    },
    over
  );
}

test('decode rejects junk, oversized frames, and non-object payloads', () => {
  assert.equal(Protocol.decode('not json').ok, false);
  assert.equal(Protocol.decode('').ok, false);
  assert.equal(Protocol.decode('null').ok, false);
  assert.equal(Protocol.decode('42').ok, false);
  assert.equal(Protocol.decode('"a string"').ok, false);
  assert.equal(Protocol.decode('[1,2,3]').ok, false, 'arrays are not messages');
  const huge = JSON.stringify({ t: 'join', name: 'x'.repeat(Protocol.MAX_MSG_BYTES) });
  assert.equal(Protocol.decode(huge).ok, false, 'oversized frame rejected before JSON.parse');
  assert.deepEqual(Protocol.decode('{"t":"ping","ts":5}'), { ok: true, msg: { t: 'ping', ts: 5 } });
});

test('validateClient accepts a well-formed input and normalizes it', () => {
  const res = Protocol.validateClient(goodInput());
  assert.equal(res.ok, true);
  assert.equal(res.msg.seq, 1);
  assert.equal(res.msg.keys.d, true);
  assert.deepEqual(res.msg.pressed, ['interact']);
});

test('validateClient accepts an optional mouse-look aim and defaults it to null', () => {
  const withAim = Protocol.validateClient(goodInput({ aim: -Math.PI / 2 }));
  assert.equal(withAim.ok, true);
  assert.equal(withAim.msg.aim, -Math.PI / 2, 'a finite aim rides through untouched');

  const noAim = Protocol.validateClient(goodInput());
  assert.equal(noAim.ok, true);
  assert.equal(noAim.msg.aim, null, 'an absent aim normalizes to null, not undefined');

  assert.equal(Protocol.toSimInput(withAim.msg).aim, -Math.PI / 2, 'aim survives into the sim input');
  assert.equal('aim' in Protocol.toSimInput(noAim.msg), false, 'no aim means the sim faces the travel direction');
});

test('validateClient rejects malformed inputs field by field', () => {
  const bad = [
    [goodInput({ aim: NaN }), 'NaN aim'],
    [goodInput({ aim: Infinity }), 'infinite aim'],
    [goodInput({ aim: 'north' }), 'non-numeric aim'],
    [{ t: 'nope' }, 'unknown type'],
    [{}, 'missing type'],
    [goodInput({ seq: -1 }), 'negative seq'],
    [goodInput({ seq: 1.5 }), 'fractional seq'],
    [goodInput({ seq: 'x' }), 'non-numeric seq'],
    [goodInput({ seq: Number.MAX_SAFE_INTEGER + 10 }), 'seq beyond safe range'],
    [goodInput({ keys: null }), 'null keys'],
    [goodInput({ keys: { w: 'yes' } }), 'non-boolean key'],
    [goodInput({ pressed: 'interact' }), 'pressed not an array'],
    [goodInput({ pressed: ['fly'] }), 'unknown edge action'],
    [goodInput({ pressed: new Array(64).fill('interact') }), 'pressed flood'],
    [goodInput({ mouse: { x: NaN, y: 0 } }), 'NaN mouse coord'],
    [goodInput({ mouse: { x: Infinity, y: 0 } }), 'infinite mouse coord'],
    [goodInput({ mouse: 'over there' }), 'non-object mouse'],
    [{ t: 'join', code: 'not-a-code!' }, 'bad join code charset'],
    [{ t: 'join', code: 'AB' }, 'join code too short'],
    [{ t: 'join', name: 42 }, 'non-string name'],
  ];
  for (const [msg, why] of bad) {
    assert.equal(Protocol.validateClient(msg).ok, false, `should reject: ${why}`);
  }
});

test('validateClient sanitizes join fields rather than trusting them', () => {
  const res = Protocol.validateClient({ t: 'join', name: '  Bo\u0000b\n  ', shirt: '#4a5578', code: 'abcd' });
  assert.equal(res.ok, true);
  assert.equal(res.msg.name, 'Bob', 'control chars stripped and trimmed');
  assert.equal(res.msg.code, 'ABCD', 'codes normalize to uppercase');
  assert.equal(res.msg.shirt, '#4a5578');

  const long = Protocol.validateClient({ t: 'join', name: 'x'.repeat(200) });
  assert.equal(long.ok, true);
  assert.ok(long.msg.name.length <= Protocol.MAX_NAME, 'name clamped, not rejected');

  const evilShirt = Protocol.validateClient({ t: 'join', shirt: 'javascript:alert(1)' });
  assert.equal(evilShirt.ok, true);
  assert.equal(evilShirt.msg.shirt, null, 'non hex-colour shirt falls back to the default');

  const anon = Protocol.validateClient({ t: 'join' });
  assert.equal(anon.ok, true);
  assert.equal(anon.msg.code, null, 'no code means host a fresh room');
});

test('toSimInput turns a validated wire input into the sim input shape', () => {
  const { msg } = Protocol.validateClient(goodInput({ pressed: ['interact', 'dodge'] }));
  const input = Protocol.toSimInput(msg);
  assert.ok(input.pressed instanceof Set, 'sim wants a Set of edges');
  assert.ok(input.pressed.has('dodge'));
  assert.equal(input.keys.d, true);
  assert.equal(input.keys.w, false, 'absent keys default to not-held');
  assert.equal(input.mouse.click, false);
});

test('rate limiter drains under a flood and refills over time', () => {
  // capacity 10, one token every 500ms.
  const rl = new Protocol.RateLimiter({ capacity: 10, refillPerSec: 2 });
  const t = 1000;
  for (let i = 0; i < 10; i++) assert.equal(rl.allow(t), true, `burst message ${i} allowed`);
  assert.equal(rl.allow(t), false, 'burst beyond capacity is denied');
  assert.equal(rl.allow(t + 500), true, 'one token back after 0.5s');
  assert.equal(rl.allow(t + 500), false, 'and only one');

  // A long silence must not bank unlimited credit: the bucket caps at capacity.
  let granted = 0;
  while (rl.allow(t + 3_600_000)) granted++;
  assert.equal(granted, 10, 'an hour of silence buys exactly one bucket, not an hour of messages');
});

test('rate limiter sustains a 30 Hz input stream indefinitely', () => {
  const rl = new Protocol.RateLimiter(Protocol.INPUT_LIMIT);
  let t = 0;
  for (let i = 0; i < 600; i++) {
    assert.equal(rl.allow(t), true, `tick ${i} of a normal 30 Hz client must not be limited`);
    t += 1000 / 30;
  }
});
