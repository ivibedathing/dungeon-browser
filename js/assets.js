// assets.js — optional real-asset loader with a PROCEDURAL FALLBACK. Assets are an
// upgrade, never a requirement: the loader tries the manifest, and every entry that
// fails resolves to null so the render site falls back to the procedural draw it uses
// today. On file:// (or with no fetch) it doesn't even try — the game is exactly the
// current one. Assets are presentation-category data: nothing in js/game/ or server/
// may import this (pinned by test/authority.test.js).
(function () {
  const Assets = {};
  const store = new Map(); // id -> Image/ImageBitmap
  let didLoad = false;

  // Load a manifest and its entries. NEVER rejects — a failure just means fewer upgrades.
  // opts.fetch / opts.loadImage / opts.protocol are injectable for tests.
  Assets.load = async function load(manifestUrl, opts) {
    opts = opts || {};
    const protocol = opts.protocol || (typeof location !== 'undefined' ? location.protocol : 'file:');
    const result = { loaded: 0, failed: 0, skipped: false };
    // file:// (and the claude.ai artifact) can't fetch — skip silently, no console error.
    if (protocol === 'file:') { result.skipped = true; return result; }
    const fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) { result.skipped = true; return result; }

    let manifest;
    try {
      const res = await fetchFn(manifestUrl);
      manifest = await res.json();
    } catch (e) {
      return result; // unreachable manifest ⇒ pure procedural, no throw
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.entries || typeof manifest.entries !== 'object') {
      return result; // malformed/empty manifest ⇒ nothing loaded, still resolves
    }

    const loadImage = opts.loadImage || defaultLoadImage;
    const ids = Object.keys(manifest.entries);
    await Promise.all(ids.map(async (id) => {
      const entry = manifest.entries[id];
      if (!entry || typeof entry.url !== 'string') { result.failed++; return; }
      try {
        const img = await loadImage(entry.url);
        store.set(id, img);
        result.loaded++;
      } catch (e) {
        result.failed++; // this asset falls back to procedural; others still load
      }
    }));
    didLoad = true;
    return result;
  };

  function defaultLoadImage(url) {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') return reject(new Error('no Image'));
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('load failed'));
      img.src = url;
    });
  }

  // The rendering upgrade point: a loaded asset, or null ⇒ caller draws procedurally.
  Assets.get = (id) => store.get(id) || null;
  Assets.available = () => store.size > 0;
  Assets.reset = () => { store.clear(); didLoad = false; };

  if (typeof window !== 'undefined') window.Assets = Assets;
  if (typeof module !== 'undefined') module.exports = Assets;
})();
