// server/store.js — the persistence layer, behind one async interface.
//
// Two implementations share it: PgStore (real Postgres, the production path,
// multi-writer/multi-process) and MemStore (in-memory, for the fast test suite and
// for running the server with no DB during local dev). createStore picks by whether
// a DATABASE_URL is present. Everything is async; the 30 Hz game loop must never
// await it — saves are fire-and-forget from the room/server.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hashPassword, verifyPassword, mintToken } = require('./crypto.js');

const MAX_CHARACTERS = 8;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function defaultExpiry() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

// ---- In-memory store ----------------------------------------------------------

class MemStore {
  constructor() {
    this._accounts = new Map(); // id -> {id, username, username_lc, pw_hash}
    this._byName = new Map(); // username_lc -> account
    this._sessions = new Map(); // token -> {token, accountId, expiresAt}
    this._chars = new Map(); // `${accountId}:${slot}` -> {slot, name, data, imported, updatedAt}
    this._seq = 1;
  }

  async init() {}
  async close() {}
  async __resetForTests() {
    this._accounts.clear();
    this._byName.clear();
    this._sessions.clear();
    this._chars.clear();
    this._seq = 1;
  }

  async createAccount(username, password) {
    const lc = String(username).toLowerCase();
    if (this._byName.has(lc)) throw new Error('TAKEN');
    const pw_hash = await hashPassword(password);
    const acc = { id: this._seq++, username, username_lc: lc, pw_hash };
    this._accounts.set(acc.id, acc);
    this._byName.set(lc, acc);
    return { id: acc.id, username: acc.username };
  }

  async verifyLogin(username, password) {
    const acc = this._byName.get(String(username).toLowerCase());
    if (!acc) return null;
    return (await verifyPassword(password, acc.pw_hash)) ? { id: acc.id, username: acc.username } : null;
  }

  async createSession(accountId, expiresAt) {
    const token = mintToken();
    const exp = expiresAt || defaultExpiry();
    this._sessions.set(token, { token, accountId, expiresAt: exp });
    return { token, expiresAt: exp };
  }

  async resolveSession(token) {
    const s = this._sessions.get(token);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() <= Date.now()) {
      this._sessions.delete(token);
      return null;
    }
    const acc = this._accounts.get(s.accountId);
    return acc ? { id: acc.id, username: acc.username } : null;
  }

  async destroySession(token) {
    this._sessions.delete(token);
  }

  async listCharacters(accountId) {
    const out = [];
    for (const [key, c] of this._chars) {
      if (key.startsWith(accountId + ':')) out.push({ slot: c.slot, name: c.name, level: (c.data.player && c.data.player.level) || 1, imported: c.imported, updatedAt: c.updatedAt });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  async createCharacter(accountId, slot, blob) {
    const key = `${accountId}:${slot}`;
    if (this._chars.has(key)) throw new Error('SLOT_TAKEN');
    const count = (await this.listCharacters(accountId)).length;
    if (count >= MAX_CHARACTERS) throw new Error('TOO_MANY');
    const c = { slot, name: (blob.player && blob.player.name) || 'Wanderer', data: blob, imported: !!blob.imported, updatedAt: new Date() };
    this._chars.set(key, c);
    return { slot, name: c.name };
  }

  async loadCharacter(accountId, slot) {
    const c = this._chars.get(`${accountId}:${slot}`);
    return c ? c.data : null;
  }

  async saveCharacter(accountId, slot, blob) {
    const key = `${accountId}:${slot}`;
    const existing = this._chars.get(key);
    this._chars.set(key, {
      slot,
      name: (blob.player && blob.player.name) || (existing && existing.name) || 'Wanderer',
      data: blob,
      imported: existing ? existing.imported : !!blob.imported,
      updatedAt: new Date(),
    });
  }

  async deleteCharacter(accountId, slot) {
    this._chars.delete(`${accountId}:${slot}`);
  }
}

// ---- Postgres store -----------------------------------------------------------

class PgStore {
  constructor(databaseUrl) {
    // Require pg lazily so MemStore-only runs never touch the driver.
    const { Pool } = require('pg');
    this._pool = new Pool({ connectionString: databaseUrl });
  }

  async init() {
    const sql = fs.readFileSync(path.join(__dirname, 'store.sql'), 'utf8');
    await this._pool.query(sql);
  }

  async close() {
    await this._pool.end();
  }

  async __resetForTests() {
    await this._pool.query('TRUNCATE characters, sessions, accounts RESTART IDENTITY CASCADE');
  }

  async createAccount(username, password) {
    const lc = String(username).toLowerCase();
    const pw_hash = await hashPassword(password);
    try {
      const { rows } = await this._pool.query(
        'INSERT INTO accounts (username, username_lc, pw_hash) VALUES ($1, $2, $3) RETURNING id, username',
        [username, lc, pw_hash]
      );
      return { id: rows[0].id, username: rows[0].username };
    } catch (e) {
      if (e && e.code === '23505') throw new Error('TAKEN'); // unique_violation
      throw e;
    }
  }

  async verifyLogin(username, password) {
    const { rows } = await this._pool.query('SELECT id, username, pw_hash FROM accounts WHERE username_lc = $1', [String(username).toLowerCase()]);
    if (!rows.length) return null;
    return (await verifyPassword(password, rows[0].pw_hash)) ? { id: rows[0].id, username: rows[0].username } : null;
  }

  async createSession(accountId, expiresAt) {
    const token = mintToken();
    const exp = expiresAt || defaultExpiry();
    await this._pool.query('INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, $3)', [token, accountId, exp]);
    return { token, expiresAt: exp };
  }

  async resolveSession(token) {
    const { rows } = await this._pool.query(
      'SELECT a.id, a.username FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1 AND s.expires_at > now()',
      [token]
    );
    return rows.length ? { id: rows[0].id, username: rows[0].username } : null;
  }

  async destroySession(token) {
    await this._pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async listCharacters(accountId) {
    const { rows } = await this._pool.query(
      "SELECT slot, name, imported, updated_at, (data->'player'->>'level')::int AS level FROM characters WHERE account_id = $1 ORDER BY slot",
      [accountId]
    );
    return rows.map((r) => ({ slot: r.slot, name: r.name, level: r.level || 1, imported: r.imported, updatedAt: r.updated_at }));
  }

  async createCharacter(accountId, slot, blob) {
    const count = (await this._pool.query('SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [accountId])).rows[0].n;
    if (count >= MAX_CHARACTERS) throw new Error('TOO_MANY');
    const name = (blob.player && blob.player.name) || 'Wanderer';
    try {
      await this._pool.query('INSERT INTO characters (account_id, slot, name, data, imported) VALUES ($1, $2, $3, $4, $5)', [accountId, slot, name, blob, !!blob.imported]);
    } catch (e) {
      if (e && e.code === '23505') throw new Error('SLOT_TAKEN');
      throw e;
    }
    return { slot, name };
  }

  async loadCharacter(accountId, slot) {
    const { rows } = await this._pool.query('SELECT data FROM characters WHERE account_id = $1 AND slot = $2', [accountId, slot]);
    return rows.length ? rows[0].data : null;
  }

  async saveCharacter(accountId, slot, blob) {
    const name = (blob.player && blob.player.name) || 'Wanderer';
    await this._pool.query(
      `INSERT INTO characters (account_id, slot, name, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (account_id, slot) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
      [accountId, slot, name, blob]
    );
  }

  async deleteCharacter(accountId, slot) {
    await this._pool.query('DELETE FROM characters WHERE account_id = $1 AND slot = $2', [accountId, slot]);
  }
}

function createStore(opts = {}) {
  const url = opts.databaseUrl || opts.DATABASE_URL || null;
  return url ? new PgStore(url) : new MemStore();
}

module.exports = { createStore, MemStore, PgStore, MAX_CHARACTERS };
