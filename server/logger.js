// server/logger.js — a zero-dep structured logger: one JSON line per event to a sink
// (default stdout, injectable for tests). Secrets are NEVER logged: password/token-ish
// fields are dropped even if a caller passes one, reusing Phase 3's no-echo discipline.
'use strict';

const SECRET = new Set(['password', 'token', 'passwordHash', 'hash', 'secret', 'authorization']);

function createLogger(opts = {}) {
  const sink = opts.sink || ((line) => process.stdout.write(line + '\n'));
  const clock = opts.now || (() => new Date().toISOString());

  function emit(level, event, fields) {
    const rec = { ts: clock(), level, event };
    if (fields && typeof fields === 'object') {
      for (const k of Object.keys(fields)) {
        if (SECRET.has(k.toLowerCase())) continue; // never echo a credential
        rec[k] = fields[k];
      }
    }
    let line;
    try {
      line = JSON.stringify(rec);
    } catch {
      line = JSON.stringify({ ts: rec.ts, level, event, note: 'unserializable fields' });
    }
    sink(line);
  }

  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

module.exports = { createLogger, SECRET };
