// Phase 3 — the persistence layer. One behavioral suite runs against MemStore
// always, and against PgStore when DATABASE_URL points at a reachable Postgres, so
// the two backends can never drift and the real SQL is covered whenever a DB exists.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/store.js');
const { hashPassword, verifyPassword, mintToken } = require('../server/crypto.js');

function starterBlob(name, over = {}) {
  return Object.assign(
    {
      version: 1,
      runSeed: 12345,
      floor: 1,
      kills: 0,
      time: 0,
      milestones: [],
      quests: [],
      player: { name, shirt: '#4a5578', level: 1, xp: 0, baseMaxHP: 100, baseMaxMana: 40, baseDamage: 0, hp: 100, mana: 40, skillPoints: 0, skills: {}, equip: {} },
      bag: { gold: 0, slots: [], belt: [], potions: { health: [], mana: [] } },
    },
    over
  );
}

// The shared suite. `makeStore` returns a fresh, initialized store.
function runStoreSuite(label, makeStore) {
  test(`[${label}] accounts: create, duplicate (case-insensitive), and login`, async () => {
    const store = await makeStore();
    try {
      const acc = await store.createAccount('Ashfall', 'correct horse');
      assert.ok(acc.id, 'account has an id');
      assert.equal(acc.username, 'Ashfall', 'display name preserved');

      await assert.rejects(() => store.createAccount('ASHFALL', 'other'), /TAKEN/, 'username is unique case-insensitively');

      const good = await store.verifyLogin('ashfall', 'correct horse');
      assert.ok(good && String(good.id) === String(acc.id), 'login by any case with the right password');
      assert.equal(await store.verifyLogin('ashfall', 'wrong'), null, 'wrong password rejected');
      assert.equal(await store.verifyLogin('nobody', 'x'), null, 'unknown user rejected');
    } finally {
      await store.close();
    }
  });

  test(`[${label}] sessions: create, resolve, expire, destroy`, async () => {
    const store = await makeStore();
    try {
      const acc = await store.createAccount('Bo', 'hunter2hunter2');
      const s = await store.createSession(acc.id);
      assert.ok(s.token && s.expiresAt, 'session has a token and expiry');

      const resolved = await store.resolveSession(s.token);
      assert.ok(resolved && String(resolved.id) === String(acc.id), 'resolves to the account');
      assert.equal(await store.resolveSession('garbage'), null, 'unknown token → null');

      // An expired session must not resolve.
      const past = await store.createSession(acc.id, new Date(Date.now() - 1000));
      assert.equal(await store.resolveSession(past.token), null, 'expired token → null');

      await store.destroySession(s.token);
      assert.equal(await store.resolveSession(s.token), null, 'destroyed token → null');
    } finally {
      await store.close();
    }
  });

  test(`[${label}] characters: slots, cap of 8, upsert, load, delete`, async () => {
    const store = await makeStore();
    try {
      const acc = await store.createAccount('Cleric', 'passphrase!!');
      assert.deepEqual(await store.listCharacters(acc.id), [], 'no characters yet');

      const c0 = await store.createCharacter(acc.id, 0, starterBlob('Aldric'));
      assert.equal(c0.slot, 0);
      await assert.rejects(() => store.createCharacter(acc.id, 0, starterBlob('Dup')), /SLOT_TAKEN/, 'slot uniqueness');

      for (let s = 1; s < 8; s++) await store.createCharacter(acc.id, s, starterBlob('H' + s));
      await assert.rejects(() => store.createCharacter(acc.id, 8, starterBlob('Overflow')), /TOO_MANY|SLOT/, 'cap at 8');

      const list = await store.listCharacters(acc.id);
      assert.equal(list.length, 8, 'eight characters listed');
      assert.ok(list.every((c) => typeof c.name === 'string' && typeof c.slot === 'number'), 'summaries have name+slot');

      // Upsert bumps the blob and updated_at.
      const before = (await store.listCharacters(acc.id)).find((c) => c.slot === 0).updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      await store.saveCharacter(acc.id, 0, starterBlob('Aldric', { floor: 4, player: starterBlob('Aldric').player }));
      const loaded = await store.loadCharacter(acc.id, 0);
      assert.equal(loaded.floor, 4, 'saved blob round-trips');
      const after = (await store.listCharacters(acc.id)).find((c) => c.slot === 0).updatedAt;
      assert.ok(new Date(after) >= new Date(before), 'updated_at advanced');

      assert.equal(await store.loadCharacter(acc.id, 3) && true, true, 'existing slot loads');
      assert.equal(await store.loadCharacter(acc.id, 99), null, 'missing slot → null');

      await store.deleteCharacter(acc.id, 0);
      assert.equal(await store.loadCharacter(acc.id, 0), null, 'deleted slot gone');
      assert.equal((await store.listCharacters(acc.id)).length, 7, 'seven remain');
    } finally {
      await store.close();
    }
  });

  test(`[${label}] characters are isolated per account`, async () => {
    const store = await makeStore();
    try {
      const a = await store.createAccount('One', 'passwordone');
      const b = await store.createAccount('Two', 'passwordtwo');
      await store.createCharacter(a.id, 0, starterBlob('Mine'));
      assert.equal((await store.listCharacters(b.id)).length, 0, 'B sees none of A');
      assert.equal(await store.loadCharacter(b.id, 0), null, "B can't load A's slot");
    } finally {
      await store.close();
    }
  });
}

test('scrypt hashing verifies the right password and rejects the wrong one', async () => {
  const h = await hashPassword('a good long password');
  assert.match(h, /^scrypt\$/, 'stored in the labelled scrypt format');
  assert.notEqual(h, 'a good long password', 'not stored in the clear');
  assert.equal(await verifyPassword('a good long password', h), true);
  assert.equal(await verifyPassword('a good long passwerd', h), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false, 'malformed digest → false, not throw');
  assert.notEqual(mintToken(), mintToken(), 'tokens are unique');
  assert.ok(mintToken().length >= 40, 'tokens carry real entropy');
});

runStoreSuite('mem', async () => {
  const store = createStore({});
  await store.init();
  return store;
});

// Real Postgres, only when a DB is provided (Docker in dev; skipped in plain CI).
if (process.env.DATABASE_URL) {
  runStoreSuite('pg', async () => {
    const store = createStore({ databaseUrl: process.env.DATABASE_URL });
    await store.init();
    await store.__resetForTests();
    return store;
  });
}
