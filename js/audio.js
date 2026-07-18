// audio.js — procedural sound effects via Web Audio. No asset files; browser-only
// (Game guards every call, so headless/node runs simply skip sound).
(function () {
  const Sfx = {};

  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;
  const lastPlay = {};

  function ensure() {
    if (ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
  }

  // Browsers require a user gesture before audio starts; main.js calls this on the first one.
  Sfx.unlock = function () {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };

  Sfx.setMuted = function (m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.5;
  };
  Sfx.isMuted = () => muted;
  Sfx.toggle = function () {
    Sfx.setMuted(!muted);
    return muted;
  };

  function noiseSource() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  function env(t0, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(master);
    return g;
  }

  function tone(type, f0, f1, t0, dur, peak, attack) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    o.connect(env(t0, peak, attack === undefined ? 0.005 : attack, dur));
    o.start(t0);
    o.stop(t0 + dur + 0.08);
  }

  function noiseHit(t0, opts) {
    const src = noiseSource();
    const flt = ctx.createBiquadFilter();
    flt.type = opts.type || 'lowpass';
    flt.frequency.setValueAtTime(opts.freq || 800, t0);
    if (opts.f1) flt.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t0 + (opts.decay || 0.15));
    flt.Q.value = opts.q || 1;
    src.connect(flt);
    flt.connect(env(t0, opts.peak || 0.3, opts.attack || 0.004, opts.decay || 0.15));
    src.start(t0);
    src.stop(t0 + (opts.attack || 0.004) + (opts.decay || 0.15) + 0.08);
  }

  const DEFS = {
    swing: (t) => noiseHit(t, { peak: 0.16, decay: 0.1, type: 'bandpass', freq: 900, f1: 2600, q: 1.4 }),
    hit: (t) => {
      noiseHit(t, { peak: 0.32, decay: 0.09, freq: 900 });
      tone('sine', 150, 60, t, 0.1, 0.38);
    },
    kill: (t) => {
      noiseHit(t, { peak: 0.38, decay: 0.22, freq: 600, f1: 150 });
      tone('sine', 120, 38, t, 0.26, 0.45);
    },
    smash: (t) => {
      noiseHit(t, { peak: 0.34, attack: 0.002, decay: 0.16, freq: 1300, f1: 220 });
      tone('square', 220, 80, t, 0.08, 0.16, 0.004);
    },
    hurt: (t) => {
      tone('sawtooth', 190, 90, t, 0.16, 0.26);
      noiseHit(t, { peak: 0.12, decay: 0.12, freq: 700 });
    },
    drink: (t) => {
      [320, 250, 200].forEach((f, i) => tone('sine', f, f * 0.8, t + i * 0.09, 0.08, 0.22, 0.01));
    },
    pickup: (t) => tone('triangle', 520, 720, t, 0.09, 0.2),
    gold: (t) => {
      tone('square', 1900, 1900, t, 0.05, 0.1, 0.002);
      tone('square', 2500, 2500, t + 0.05, 0.06, 0.1, 0.002);
    },
    equip: (t) => {
      noiseHit(t, { peak: 0.18, decay: 0.05, freq: 2000, type: 'highpass' });
      tone('triangle', 300, 260, t + 0.02, 0.07, 0.16);
    },
    drop: (t) => noiseHit(t, { peak: 0.18, decay: 0.08, freq: 500 }),
    error: (t) => {
      tone('square', 120, 110, t, 0.12, 0.16);
      tone('square', 100, 95, t + 0.13, 0.12, 0.14);
    },
    levelup: (t) => {
      [392, 494, 587, 784].forEach((f, i) => tone('triangle', f, f, t + i * 0.09, 0.26, 0.2, 0.01));
    },
    stairs: (t) => noiseHit(t, { peak: 0.38, decay: 0.6, freq: 220, f1: 60 }),
    death: (t) => {
      tone('sawtooth', 220, 35, t, 1.1, 0.38, 0.01);
      noiseHit(t, { peak: 0.28, decay: 0.9, freq: 400, f1: 80 });
    },
    bow: (t) => {
      noiseHit(t, { peak: 0.14, attack: 0.002, decay: 0.06, type: 'bandpass', freq: 1400, q: 3 });
      tone('triangle', 700, 250, t, 0.07, 0.18, 0.002);
    },
    fireball: (t) => noiseHit(t, { peak: 0.22, decay: 0.25, type: 'bandpass', freq: 500, f1: 1500 }),
    explode: (t) => {
      noiseHit(t, { peak: 0.45, decay: 0.35, freq: 500, f1: 90 });
      tone('sine', 100, 40, t, 0.3, 0.4);
    },
    portal: (t) => {
      tone('sine', 200, 800, t, 0.5, 0.18, 0.05);
      noiseHit(t, { peak: 0.1, decay: 0.5, type: 'bandpass', freq: 900, f1: 2400, q: 2 });
    },
    travel: (t) => {
      tone('sine', 700, 90, t, 0.6, 0.28, 0.02);
      noiseHit(t, { peak: 0.18, decay: 0.55, freq: 800, f1: 120 });
    },
    heal: (t) => {
      [523, 659, 784].forEach((f, i) => tone('sine', f, f * 1.02, t + i * 0.07, 0.3, 0.14, 0.02));
    },
    roar: (t) => {
      tone('sawtooth', 90, 38, t, 0.55, 0.38, 0.02);
      noiseHit(t, { peak: 0.3, decay: 0.5, freq: 300, f1: 80 });
    },
    dodge: (t) => {
      noiseHit(t, { peak: 0.14, attack: 0.003, decay: 0.12, type: 'bandpass', freq: 700, f1: 2200, q: 1.2 });
    },
    anvil: (t) => {
      tone('square', 1200, 900, t, 0.07, 0.2, 0.002);
      noiseHit(t, { peak: 0.22, attack: 0.002, decay: 0.1, type: 'highpass', freq: 2500 });
      tone('square', 1500, 1100, t + 0.12, 0.09, 0.16, 0.002);
    },
  };

  Sfx.play = function (name) {
    if (muted) return;
    ensure();
    if (!ctx || ctx.state !== 'running') return;
    const now = (typeof performance !== 'undefined' ? performance : Date).now();
    if (lastPlay[name] && now - lastPlay[name] < 45) return; // de-spam identical sounds
    lastPlay[name] = now;
    const def = DEFS[name];
    if (!def) return;
    try {
      def(ctx.currentTime);
    } catch {
      /* a failed blip must never break the game */
    }
  };

  if (typeof window !== 'undefined') window.Sfx = Sfx;
  if (typeof module !== 'undefined') module.exports = Sfx;
})();
