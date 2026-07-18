// music.js — procedural 8-bit soundtrack via Web Audio. No asset files, matching
// audio.js: the score is composed here as note data and synthesised at runtime.
//
// The voice layout is the NES APU's, which is what gives the era its sound:
//   pulse1  — lead melody (square wave, duty-cycled)
//   pulse2  — harmony / arpeggiated accompaniment
//   tri     — bass line (the NES triangle channel, no volume control, so it reads
//             as a steady woody bass rather than a dynamic one)
//   noise   — percussion (filtered white noise: kick, snare, hat)
//
// Songs are original compositions written in the idiom of the era's JRPG and
// adventure scores — arpeggio preludes, lyrical major-key town themes, minor-key
// dungeon ostinatos, driving battle music. Note data, not samples.
(function () {
  const Music = {};

  // ---- Note names → frequency (A4 = 440, twelve-tone equal temperament) ----
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const freqCache = Object.create(null);
  function freq(name) {
    const cached = freqCache[name];
    if (cached) return cached;
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    let semitone = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    const midi = (Number(m[3]) + 1) * 12 + semitone;
    return (freqCache[name] = 440 * Math.pow(2, (midi - 69) / 12));
  }

  // `rep('D2', 16)` — sixteen sixteenth-notes of D2. Battle bass lines are mostly
  // this, and spelling them out note by note buries the melody in the noise.
  const rep = (note, count, dur) => Array.from({ length: count }, () => [note, dur || 1]);
  // Joins groups of notes (each group already a list of pairs) into one track.
  // Takes groups, never bare pairs — a bare pair would flatten into loose scalars.
  const seq = (...groups) => [].concat(...groups);

  // ================================================================
  // The score
  // ================================================================
  // Durations are in sixteenth notes; 16 = one 4/4 bar. `null` is a rest.
  // Drum tracks are one character per sixteenth, looped: k=kick s=snare h=hat.

  const SONGS = {
    // Slow arpeggiated prelude over a rising Am–F–C–G turn. Plays under the
    // title, character creation, and the other front-end screens.
    title: {
      bpm: 92,
      lead: [
        [null, 8], ['E5', 8],
        ['F5', 12], ['E5', 4],
        ['G5', 8], ['E5', 8],
        ['D5', 16],
        ['C5', 8], ['B4', 8],
        ['A4', 8], ['C5', 8],
        ['D5', 8], ['F5', 8],
        ['E5', 12], [null, 4],
      ],
      leadDuty: 0.25,
      leadVibrato: 5,
      harm: [
        ['A2', 2], ['E3', 2], ['A3', 2], ['C4', 2], ['E4', 2], ['C4', 2], ['A3', 2], ['E3', 2],
        ['F2', 2], ['C3', 2], ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2], ['F3', 2], ['C3', 2],
        ['C3', 2], ['G3', 2], ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2], ['C4', 2], ['G3', 2],
        ['G2', 2], ['D3', 2], ['G3', 2], ['B3', 2], ['D4', 2], ['B3', 2], ['G3', 2], ['D3', 2],
        ['A2', 2], ['E3', 2], ['A3', 2], ['C4', 2], ['E4', 2], ['C4', 2], ['A3', 2], ['E3', 2],
        ['F2', 2], ['C3', 2], ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2], ['F3', 2], ['C3', 2],
        ['D3', 2], ['A3', 2], ['D4', 2], ['F4', 2], ['A4', 2], ['F4', 2], ['D4', 2], ['A3', 2],
        ['E3', 2], ['B3', 2], ['E4', 2], ['G#4', 2], ['B4', 2], ['G#4', 2], ['E4', 2], ['B3', 2],
      ],
      harmDuty: 0.125,
      harmGain: 0.5,
      bass: [
        ['A1', 16], ['F1', 16], ['C2', 16], ['G1', 16],
        ['A1', 16], ['F1', 16], ['D2', 16], ['E2', 16],
      ],
    },

    // Warm, walking C-major tune for the town: jaunty broken-chord accompaniment
    // under a singable lead, the register these games use for a safe place.
    town: {
      bpm: 132,
      lead: [
        ['E5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['D5', 4], ['E5', 4],
        ['D5', 2], ['B4', 2], ['D5', 2], ['G5', 2], ['F#5', 4], ['D5', 4],
        ['A4', 2], ['C5', 2], ['E5', 2], ['A5', 2], ['G5', 4], ['E5', 4],
        ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 2], ['A4', 8],
        ['C5', 2], ['E5', 2], ['G5', 2], ['C6', 2], ['B5', 4], ['G5', 4],
        ['A5', 2], ['G5', 2], ['F#5', 2], ['G5', 2], ['D5', 8],
        ['F5', 4], ['E5', 4], ['D5', 4], ['C5', 4],
        ['C5', 8], [null, 8],
      ],
      leadDuty: 0.5,
      leadVibrato: 4,
      harm: [
        ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2], ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2],
        ['B3', 2], ['D4', 2], ['G4', 2], ['D4', 2], ['B3', 2], ['D4', 2], ['G4', 2], ['D4', 2],
        ['A3', 2], ['C4', 2], ['E4', 2], ['C4', 2], ['A3', 2], ['C4', 2], ['E4', 2], ['C4', 2],
        ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2], ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2],
        ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2], ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2],
        ['B3', 2], ['D4', 2], ['G4', 2], ['D4', 2], ['B3', 2], ['D4', 2], ['G4', 2], ['D4', 2],
        ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2], ['F3', 2], ['A3', 2], ['C4', 2], ['A3', 2],
        ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2], ['C4', 2], ['G4', 2], ['E4', 2], ['C4', 2],
      ],
      harmDuty: 0.25,
      harmGain: 0.42,
      bass: [
        ['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4],
        ['G1', 4], ['D2', 4], ['G1', 4], ['D2', 4],
        ['A1', 4], ['E2', 4], ['A1', 4], ['E2', 4],
        ['F1', 4], ['C2', 4], ['F1', 4], ['C2', 4],
        ['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4],
        ['G1', 4], ['D2', 4], ['G1', 4], ['D2', 4],
        ['F1', 4], ['C2', 4], ['F1', 4], ['C2', 4],
        ['C2', 8], ['G1', 4], ['G2', 4],
      ],
      drums: 'k--hs--hk--hs--h',
    },

    // D minor, held pads over a rolling bass figure, melody entering late and
    // sparsely. The floor should feel occupied rather than scored.
    dungeon: {
      bpm: 104,
      lead: [
        [null, 16],
        ['D5', 4], ['F5', 4], ['E5', 8],
        [null, 8], ['Bb4', 4], ['C5', 4],
        ['A4', 16],
        ['D5', 4], ['A4', 4], ['F5', 8],
        ['G5', 8], ['F5', 4], ['E5', 4],
        ['D5', 4], ['C5', 4], ['Bb4', 8],
        ['A4', 12], [null, 4],
      ],
      leadDuty: 0.125,
      leadGain: 0.8,
      leadVibrato: 5.5,
      harm: [
        ['A3', 16], ['A3', 16], ['F3', 16], ['E3', 16],
        ['A3', 16], ['D3', 16], ['F3', 16], ['E3', 16],
      ],
      harmDuty: 0.5,
      harmGain: 0.3,
      bass: [
        ['D2', 2], ['D2', 2], ['D3', 2], ['D2', 2], ['A2', 2], ['A2', 2], ['D3', 2], ['D2', 2],
        ['D2', 2], ['D2', 2], ['D3', 2], ['D2', 2], ['A2', 2], ['A2', 2], ['D3', 2], ['D2', 2],
        ['Bb1', 2], ['Bb1', 2], ['Bb2', 2], ['Bb1', 2], ['F2', 2], ['F2', 2], ['Bb2', 2], ['Bb1', 2],
        ['A1', 2], ['A1', 2], ['A2', 2], ['A1', 2], ['E2', 2], ['E2', 2], ['A2', 2], ['A1', 2],
        ['D2', 2], ['D2', 2], ['D3', 2], ['D2', 2], ['A2', 2], ['A2', 2], ['D3', 2], ['D2', 2],
        ['G1', 2], ['G1', 2], ['G2', 2], ['G1', 2], ['D2', 2], ['D2', 2], ['G2', 2], ['G1', 2],
        ['Bb1', 2], ['Bb1', 2], ['Bb2', 2], ['Bb1', 2], ['F2', 2], ['F2', 2], ['Bb2', 2], ['Bb1', 2],
        ['A1', 2], ['A1', 2], ['A2', 2], ['A1', 2], ['E2', 2], ['E2', 2], ['E2', 2], ['A1', 2],
      ],
      drums: 'k-------s-------',
    },

    // Battle music: a sixteenth-note bass that never lets up, a Phrygian lift to
    // Eb for the turn, and a lead that runs rather than sings.
    boss: {
      bpm: 172,
      lead: [
        ['D5', 2], ['E5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 2], ['D5', 4],
        ['A5', 2], ['G5', 2], ['F5', 2], ['E5', 2], ['D5', 8],
        ['Eb5', 2], ['F5', 2], ['G5', 2], ['F5', 2], ['Eb5', 2], ['D5', 2], ['Eb5', 4],
        ['Bb5', 4], ['A5', 4], ['G5', 4], ['F5', 4],
        ['D5', 2], ['E5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 2], ['D5', 4],
        ['A5', 2], ['G5', 2], ['F5', 2], ['E5', 2], ['D5', 8],
        ['A5', 2], ['Bb5', 2], ['A5', 2], ['G5', 2], ['F5', 2], ['E5', 2], ['D5', 4],
        ['A4', 8], [null, 8],
      ],
      leadDuty: 0.25,
      leadVibrato: 6,
      harm: [
        ['A4', 8], ['F4', 8], ['A4', 8], ['D4', 8],
        ['G4', 8], ['Eb4', 8], ['G4', 8], ['Bb4', 8],
        ['A4', 8], ['F4', 8], ['A4', 8], ['D4', 8],
        ['E4', 8], ['C#4', 8], ['E4', 16],
      ],
      harmDuty: 0.5,
      harmGain: 0.3,
      bass: seq(
        rep('D2', 12), rep('D3', 2), rep('D2', 2),
        rep('D2', 12), rep('C3', 2), rep('Bb2', 2),
        rep('Eb2', 12), rep('Eb3', 2), rep('Eb2', 2),
        rep('Eb2', 10), rep('D3', 2), rep('C3', 2), rep('Bb2', 2),
        rep('D2', 12), rep('D3', 2), rep('D2', 2),
        rep('D2', 12), rep('C3', 2), rep('Bb2', 2),
        rep('A2', 12), rep('A3', 2), rep('A2', 2),
        rep('A2', 8), rep('E3', 4), rep('A2', 2), rep('A3', 2)
      ),
      drums: 'k-h-s-h-k-h-s-hs',
    },
  };

  // ================================================================
  // Engine
  // ================================================================
  let ctx = null;
  let bus = null; // our own gain under Sfx's music bus — the mute/fade handle
  let noiseBuf = null;
  const waveCache = Object.create(null);

  let current = null; // name of the playing song
  let compiled = null; // compiled event list for it
  let timer = null; // lookahead scheduler handle
  let nextTime = 0; // context time of the next event to fire
  let cursor = 0; // index into compiled.events
  let loopBase = 0; // context time the current pass through the loop started at
  let muted = false;
  let pending = null; // song queued behind a crossfade

  const LOOKAHEAD_MS = 25; // how often the scheduler wakes
  const HORIZON = 0.2; // how far ahead of the clock it schedules
  const FADE = 0.7; // crossfade seconds between tracks

  // A pulse wave of the given duty cycle, built from its Fourier series. This is
  // the sound of the era: duty 0.5 is hollow and square, 0.125 is thin and reedy.
  function pulseWave(duty) {
    const key = String(duty);
    if (waveCache[key]) return waveCache[key];
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
    return (waveCache[key] = ctx.createPeriodicWave(real, imag, { disableNormalization: false }));
  }

  function ensureNoise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // ---- Voices. Each schedules itself at an absolute context time and self-stops. ----

  function playPulse(t, note, dur, duty, gain, vibratoHz) {
    const f = freq(note);
    if (!f) return;
    const o = ctx.createOscillator();
    o.setPeriodicWave(pulseWave(duty));
    o.frequency.setValueAtTime(f, t);

    // Vibrato only after the note has had time to speak — an immediate wobble
    // sounds seasick, a delayed one sounds like a chiptune lead.
    if (vibratoHz && dur > 0.25) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibratoHz;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.22, dur * 0.5));
      lfo.connect(depth);
      depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }

    const g = ctx.createGain();
    const body = Math.max(0.03, dur - 0.03); // gap between notes, so repeats articulate
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + body * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + body);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function playBass(t, note, dur) {
    const f = freq(note);
    if (!f) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    const body = Math.max(0.04, dur - 0.02);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.42, t + body * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + body);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function playDrum(t, kind) {
    if (kind === 'k') {
      // Kick: a fast pitch drop is the whole sound.
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = ensureNoise();
    const flt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === 's') {
      flt.type = 'bandpass';
      flt.frequency.value = 1900;
      flt.Q.value = 0.9;
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    } else {
      flt.type = 'highpass';
      flt.frequency.value = 7000;
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    }
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + 0.25);
  }

  // ---- Compile: note lists → one time-ordered event stream ----

  function compile(song) {
    const events = [];
    let len = 0;

    const lay = (seq, emit) => {
      let t = 0;
      for (const [note, dur] of seq) {
        if (note) emit(t, note, dur);
        t += dur;
      }
      len = Math.max(len, t);
    };

    lay(song.lead || [], (t, note, dur) =>
      events.push({ t, kind: 'pulse', note, dur, duty: song.leadDuty || 0.5, gain: 0.22 * (song.leadGain || 1), vib: song.leadVibrato || 0 })
    );
    lay(song.harm || [], (t, note, dur) =>
      events.push({ t, kind: 'pulse', note, dur, duty: song.harmDuty || 0.25, gain: 0.22 * (song.harmGain || 0.5), vib: 0 })
    );
    lay(song.bass || [], (t, note, dur) => events.push({ t, kind: 'bass', note, dur }));

    // Drums are a repeating one-bar pattern, stretched over the whole loop.
    if (song.drums) {
      const pat = song.drums;
      for (let i = 0; i < len; i++) {
        const c = pat[i % pat.length];
        if (c && c !== '-') events.push({ t: i, kind: 'drum', drum: c });
      }
    }

    events.sort((a, b) => a.t - b.t);
    return { events, len, step: 60 / song.bpm / 4 };
  }

  const COMPILED = Object.create(null);
  function compiledFor(name) {
    return COMPILED[name] || (COMPILED[name] = compile(SONGS[name]));
  }

  // ---- Scheduler: the standard Web Audio lookahead loop. setInterval is only
  // accurate enough to *decide* what to schedule; the audio clock does the timing. ----

  // The scheduler runs off a timer and Music.play runs inside the frame loop, so
  // neither may ever throw into its caller — a broken bar must cost the score, not
  // the game. (Same contract as Sfx.play.)
  function guard(fn) {
    try {
      fn();
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('music:', e);
      stopScheduler();
    }
  }

  function scheduleAhead() {
    if (!ctx || !compiled) return;
    const until = ctx.currentTime + HORIZON;
    while (nextTime < until) {
      const ev = compiled.events[cursor];
      if (!ev) break;
      const at = loopBase + ev.t * compiled.step;
      if (at >= until) break;
      if (at >= ctx.currentTime - 0.05) {
        const dur = (ev.dur || 1) * compiled.step;
        if (ev.kind === 'pulse') playPulse(at, ev.note, dur, ev.duty, ev.gain, ev.vib);
        else if (ev.kind === 'bass') playBass(at, ev.note, dur);
        else playDrum(at, ev.drum);
      }
      cursor++;
      if (cursor >= compiled.events.length) {
        // Wrap to the top of the loop and keep going seamlessly.
        cursor = 0;
        loopBase += compiled.len * compiled.step;
      }
      nextTime = loopBase + compiled.events[cursor].t * compiled.step;
    }
  }

  function startScheduler() {
    stopScheduler();
    timer = setInterval(() => guard(scheduleAhead), LOOKAHEAD_MS);
    guard(scheduleAhead);
  }
  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function ensure() {
    if (bus) return true;
    if (typeof Sfx === 'undefined' || !Sfx.context) return false;
    ctx = Sfx.context();
    if (!ctx) return false;
    bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(Sfx.musicBus());
    return true;
  }

  function beginSong(name) {
    current = name;
    compiled = compiledFor(name);
    cursor = 0;
    loopBase = ctx.currentTime + 0.06; // a beat of headroom before the first note
    nextTime = loopBase;
    const target = muted ? 0 : 1;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(target, ctx.currentTime + FADE);
    startScheduler();
  }

  // ---- Public API ----

  // Switch tracks. Safe to call every frame with the same name — a repeat is a
  // no-op, which is what lets main.js just describe the scene each frame.
  Music.play = function (name) {
    guard(() => playImpl(name));
  };

  function playImpl(name) {
    if (!SONGS[name]) return;
    if (!ensure()) return;
    if (ctx.state !== 'running') {
      // Pre-gesture: remember the intent and start on unlock.
      pending = name;
      return;
    }
    if (current === name || pending === name) return;
    if (!current) {
      beginSong(name);
      return;
    }
    // Crossfade: duck the old track out, then swap. Notes already scheduled ride
    // the fade down, so the handover is smooth rather than a hard cut.
    pending = name;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + FADE);
    setTimeout(() => {
      const next = pending;
      pending = null;
      if (!next) return;
      stopScheduler();
      beginSong(next);
    }, FADE * 1000);
  };

  Music.stop = function () {
    if (!bus || !current) return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + FADE);
    const wasPlaying = current;
    current = null;
    pending = null;
    setTimeout(() => {
      if (current === null && wasPlaying) stopScheduler();
    }, FADE * 1000);
  };

  // The first user gesture unlocks the shared AudioContext; anything Music.play
  // asked for before that starts here.
  Music.unlock = function () {
    if (!ensure()) return;
    if (ctx.state === 'running' && pending && !current) {
      const next = pending;
      pending = null;
      beginSong(next);
    }
  };

  Music.setMuted = function (m) {
    muted = !!m;
    if (!bus || !ctx) return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, ctx.currentTime + 0.25);
  };
  Music.isMuted = () => muted;
  Music.toggle = function () {
    Music.setMuted(!muted);
    return muted;
  };
  Music.current = () => current;
  Music.tracks = () => Object.keys(SONGS);

  // Which track a given moment calls for. Kept here with the score rather than in
  // main.js, so adding a track is a one-file change.
  Music.trackFor = function (screen, state) {
    if (screen !== 'playing' || !state) return 'title';
    if (state.dead) return 'title';
    if (state.bossFight) return 'boss';
    if (state.inTown) return 'town';
    return 'dungeon';
  };

  if (typeof window !== 'undefined') window.Music = Music;
  if (typeof module !== 'undefined') module.exports = Music;
})();
