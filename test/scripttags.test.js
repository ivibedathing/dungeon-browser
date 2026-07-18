// The two HTML entry points keep their own hand-maintained <script> lists, and
// nothing checked they stayed in sync with js/ or with each other. Adding
// js/bosses.js broke verify.html silently — it loads entities.js, which now
// needs window.Bosses — and no test noticed. These guard that class of break.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tagsIn = (html) => [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((m) => m[1]);

// Node entry points that assemble the browser part-files; never script-tagged.
const NODE_ENTRIES = new Set(['js/game.js', 'js/render.js', 'js/ui.js']);
// index.html only: online play and the account/menu screens the harness skips.
const INDEX_ONLY = new Set(['js/net.js', 'js/ui/menu.js', 'js/ui/account.js', 'js/main.js']);

function allModules() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.js')) out.push(rel);
    }
  };
  walk('js');
  return out;
}

test('index.html script-tags every browser module in js/', () => {
  const tagged = new Set(tagsIn(read('index.html')));
  const missing = allModules().filter((m) => !NODE_ENTRIES.has(m) && !tagged.has(m));
  assert.deepEqual(missing, [], `index.html is missing: ${missing.join(', ')}`);
});

test('verify.html carries the same sim/render/ui modules as index.html', () => {
  const idx = tagsIn(read('index.html'));
  const ver = new Set(tagsIn(read('verify.html')));
  const missing = idx.filter((s) => !INDEX_ONLY.has(s) && !ver.has(s));
  assert.deepEqual(missing, [], `verify.html is missing: ${missing.join(', ')}`);
});

test('neither page script-tags a file that does not exist', () => {
  for (const page of ['index.html', 'verify.html']) {
    for (const src of tagsIn(read(page))) {
      assert.ok(fs.existsSync(path.join(ROOT, src)), `${page} references missing ${src}`);
    }
  }
});

test('dependencies load before their dependents', () => {
  // bosses.js defines window.Bosses, which entities.js reads at definition time;
  // status.js and behaviors.js hang off game/core.js and game/ai.js respectively.
  const order = [
    ['js/bosses.js', 'js/entities.js'],
    ['js/game/core.js', 'js/game/status.js'],
    ['js/game/ai.js', 'js/game/behaviors.js'],
  ];
  for (const page of ['index.html', 'verify.html']) {
    const tags = tagsIn(read(page));
    for (const [before, after] of order) {
      const i = tags.indexOf(before);
      const j = tags.indexOf(after);
      assert.ok(i !== -1 && j !== -1, `${page} has both ${before} and ${after}`);
      assert.ok(i < j, `${page} loads ${before} before ${after}`);
    }
  }
});
