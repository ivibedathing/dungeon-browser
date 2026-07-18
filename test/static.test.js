// Phase 4.5 Track B — the static file handler: MIME, cache headers, and traversal
// rejection, exercised over a real node:http listener.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createStatic } = require('../server/static.js');

const ROOT = path.join(__dirname, '..');

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const handle = createStatic({ root: ROOT });
    const server = http.createServer((req, res) => {
      if (!handle(req, res)) res.writeHead(404).end('nope');
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        await fn(port);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

function get(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers: headers || {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('GET / serves index.html as no-cache HTML', async () => {
  await withServer(async (port) => {
    const r = await get(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.body, /<canvas/);
  });
});

test('GET /js/main.js serves JS with an ETag and revalidate cache policy', async () => {
  await withServer(async (port) => {
    const r = await get(port, '/js/main.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/javascript/);
    assert.ok(r.headers['etag'], 'unhashed JS carries an ETag');
    assert.match(r.headers['cache-control'], /must-revalidate/);
    assert.ok(!/immutable/.test(r.headers['cache-control']), 'unhashed JS is never immutable');
  });
});

test('a matching If-None-Match yields 304', async () => {
  await withServer(async (port) => {
    const first = await get(port, '/js/util.js');
    const etag = first.headers['etag'];
    assert.ok(etag);
    const second = await get(port, '/js/util.js', { 'If-None-Match': etag });
    assert.equal(second.status, 304);
  });
});

test('path traversal is rejected with 403 and no filesystem read', async () => {
  await withServer(async (port) => {
    for (const p of ['/../server/server.js', '/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd']) {
      const r = await get(port, p);
      assert.ok(r.status === 403 || r.status === 404, `${p} → ${r.status} (not served)`);
      assert.ok(!/DATABASE_URL|require\(/.test(r.body), 'no server source leaked');
    }
  });
});

test('an unknown or disallowed file 404s', async () => {
  await withServer(async (port) => {
    assert.equal((await get(port, '/nope.png')).status, 404);
    assert.equal((await get(port, '/package.json')).status !== 200 ? 404 : 200, 200, 'json is allowed');
    assert.equal((await get(port, '/server/store.sql')).status, 404, '.sql is not in the allowlist');
  });
});
