// server/static.js — a tiny static file handler so `npm start` serves the client on
// the same origin as the WebSocket (no more out-of-band `python3 -m http.server`, no
// hardcoded port split). node:http + node:fs only. Rejects traversal before touching
// the filesystem; serves only an allowlist of extensions; sets cache headers that make
// a deploy visible (never ships stale unhashed JS as immutable).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};
const ALLOWED = new Set(Object.keys(MIME));

// A path segment carrying a content hash (…-<8+hex>.js) may be cached immutably.
const HASHED = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;

function createStatic(opts = {}) {
  const root = path.resolve(opts.root || process.cwd());

  // Returns true if it handled the request (served, 403, or 404 for a static path),
  // false if the caller should handle it (e.g. a non-GET, so a ws upgrade can proceed).
  return function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('bad request');
      return true;
    }
    if (pathname === '/') pathname = '/index.html';
    // Reject null bytes and obvious traversal before resolving.
    if (pathname.indexOf('\0') !== -1) { res.writeHead(400).end('bad request'); return true; }

    const resolved = path.resolve(root, '.' + pathname);
    // The resolved path MUST stay under root (catches ../, encoded variants, absolute).
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden');
      return true;
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!ALLOWED.has(ext)) { res.writeHead(404).end('not found'); return true; }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      res.writeHead(404).end('not found');
      return true;
    }
    if (!stat.isFile()) { res.writeHead(404).end('not found'); return true; }

    const base = path.basename(resolved);
    const headers = { 'Content-Type': MIME[ext], 'Content-Length': stat.size };
    if (base === 'index.html' || base === 'manifest.json') {
      headers['Cache-Control'] = 'no-cache'; // must revalidate so a deploy is picked up
    } else if (HASHED.test(base)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      // Unhashed asset: revalidate with an ETag; never immutable (would ship a stale client).
      headers['Cache-Control'] = 'no-cache, max-age=0, must-revalidate';
      headers['ETag'] = '"' + crypto.createHash('sha1').update(`${stat.size}-${stat.mtimeMs}`).digest('hex').slice(0, 16) + '"';
    }

    if (headers['ETag'] && req.headers['if-none-match'] === headers['ETag']) {
      res.writeHead(304, headers).end();
      return true;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(resolved).pipe(res);
    return true;
  };
}

module.exports = { createStatic };
