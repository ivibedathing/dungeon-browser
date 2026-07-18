// Phase 5 Task 5 — a lint-weight guard that the deploy files exist and reference the
// expected entrypoint/ports. Not a Docker build (that's manual) — just anti-drift.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Dockerfile exists, is non-root, healthchecked, and runs the server entrypoint', () => {
  const df = read('Dockerfile');
  assert.match(df, /FROM node:\d+/, 'pinned node base image');
  assert.match(df, /USER node/, 'runs as a non-root user');
  assert.match(df, /HEALTHCHECK/, 'has a healthcheck');
  assert.match(df, /\/healthz/, 'healthcheck hits /healthz');
  assert.match(df, /--omit=dev/, 'installs prod deps only');
  assert.match(df, /CMD \[.*server\/server\.js.*\]/, 'runs server/server.js');
});

test('docker-compose provides db + server with DATABASE_URL wired', () => {
  const dc = read('docker-compose.yml');
  assert.match(dc, /postgres:\d+/, 'a pinned postgres service');
  assert.match(dc, /DATABASE_URL:\s*postgres:\/\//, 'server points at the db');
  assert.match(dc, /depends_on/, 'server waits for the db');
});

test('.dockerignore keeps tests/docs/node_modules out of the image', () => {
  const di = read('.dockerignore');
  for (const p of ['node_modules', 'test', 'docs', '.git']) assert.ok(di.includes(p), `${p} ignored`);
});

test('README documents hosting: npm start, env vars, metrics, and TLS', () => {
  const r = read('README.md');
  assert.match(r, /Host your own server/);
  assert.match(r, /DATABASE_URL/);
  assert.match(r, /\/metrics/);
  assert.match(r, /TLS termination/);
});
