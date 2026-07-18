// boot.js — the client boot runner: a small ordered list of weighted preload steps
// run once before the first playable frame. The load-bearing rule is the FALLBACK
// GUARANTEE: a non-required step that throws is caught and recorded, never fatal —
// so a broken cache warm, a missing asset, or a fetch on file:// can't brick boot.
// Dual-mode: attaches window.Boot in the browser, exports for node tests.
(function () {
  const Boot = {};
  let steps = [];

  // Register a preload step. `fn` may return a promise; steps run in registration
  // order. weight scales its share of the progress bar; required steps fail the run.
  Boot.step = function step(name, fn, opts) {
    opts = opts || {};
    steps.push({ name, fn, weight: opts.weight == null ? 1 : opts.weight, required: !!opts.required });
  };

  // Run every step in order. Returns {ok, failed:[{name,error}]}. `onProgress(frac,name)`
  // fires after each step with the weighted fraction complete (ending at exactly 1).
  Boot.run = async function run(onProgress) {
    const total = steps.reduce((s, st) => s + st.weight, 0) || 1;
    let done = 0;
    const failed = [];
    let ok = true;
    for (const st of steps) {
      try {
        await st.fn();
      } catch (error) {
        failed.push({ name: st.name, error });
        if (st.required) ok = false;
      }
      done += st.weight;
      if (onProgress) {
        try { onProgress(done / total, st.name); } catch (e) { /* a progress callback must never break boot */ }
      }
    }
    return { ok, failed };
  };

  Boot.reset = function reset() { steps = []; };
  Boot.count = () => steps.length;

  if (typeof window !== 'undefined') window.Boot = Boot;
  if (typeof module !== 'undefined') module.exports = Boot;
})();
