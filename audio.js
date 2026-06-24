/* audio.js — Web Audio synth engine + drum machine.
 * Instrument-based additive synthesis (piano, e-piano, organ, accordion,
 * harmonica, strings, synth lead) + a percussion synth for the pads.
 * window.AudioEngine; AudioEngine.INSTRUMENTS holds the preset table.
 */
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); }

  // ---------- Instrument presets ----------
  // partials: harmonics relative to fundamental {r: ratio, g: gain, t: wave}
  // env: {a, d, s, r} attack/decay/sustain(0..1)/release seconds
  // inharm: piano-style partial stretch; vib: {rate, depth(cents)}
  // cutoff: 0..1 base brightness; reso: 0..1; breath: harmonica noise; hammer: piano click
  const INSTRUMENTS = {
    piano: {
      name: 'Grand Piano',
      partials: [
        { r: 1, g: 1.0, t: 'triangle' }, { r: 2, g: 0.5, t: 'sine' },
        { r: 3, g: 0.24, t: 'sine' }, { r: 4, g: 0.13, t: 'sine' },
        { r: 5, g: 0.07, t: 'sine' }, { r: 6, g: 0.035, t: 'sine' }
      ],
      inharm: 0.0006, detune: 1.5, gain: 1.05, velTrack: 0.55,
      env: { a: 0.003, d: 2.2, s: 0.0, r: 0.28 },
      cutoff: 0.8, reso: 0, hammer: 0.04
    },
    epiano: {
      name: 'Electric Piano',
      partials: [
        { r: 1, g: 1.0, t: 'sine' }, { r: 2, g: 0.28, t: 'sine' },
        { r: 4, g: 0.6, t: 'sine' }, { r: 6, g: 0.18, t: 'sine' }, { r: 11, g: 0.05, t: 'sine' }
      ],
      inharm: 0.0003, detune: 1, gain: 1.1, velTrack: 0.7,
      env: { a: 0.004, d: 1.8, s: 0.0, r: 0.32 },
      tremolo: { rate: 4.5, depth: 0.12 },
      cutoff: 0.72, reso: 0, hammer: 0.015
    },
    organ: {
      name: 'Organ',
      partials: [
        { r: 1, g: 1.0, t: 'sine' }, { r: 2, g: 0.6, t: 'sine' },
        { r: 3, g: 0.5, t: 'sine' }, { r: 4, g: 0.3, t: 'sine' },
        { r: 5.04, g: 0.18, t: 'sine' }, { r: 8, g: 0.14, t: 'sine' }
      ],
      detune: 0, gain: 0.85,
      env: { a: 0.008, d: 0.05, s: 1.0, r: 0.05 },
      vib: { rate: 6.4, depth: 3 },
      cutoff: 0.85, reso: 0
    },
    accordion: {
      name: 'Accordion',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.006, g: 0.8, t: 'sawtooth' },
        { r: 2, g: 0.35, t: 'sawtooth' }, { r: 3, g: 0.16, t: 'sawtooth' }
      ],
      detune: 5, gain: 0.8,
      env: { a: 0.05, d: 0.08, s: 0.85, r: 0.12 },
      vib: { rate: 5, depth: 7 },
      cutoff: 0.6, reso: 0.1
    },
    harmonica: {
      name: 'Harmonica',
      partials: [
        { r: 1, g: 1.0, t: 'square' }, { r: 2, g: 0.4, t: 'sine' },
        { r: 3, g: 0.22, t: 'square' }, { r: 4, g: 0.08, t: 'sine' }
      ],
      detune: 4, gain: 0.7,
      env: { a: 0.04, d: 0.06, s: 0.8, r: 0.1 },
      vib: { rate: 6, depth: 9 }, breath: 0.04,
      cutoff: 0.55, reso: 0.15
    },
    strings: {
      name: 'Strings',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.007, g: 0.8, t: 'sawtooth' },
        { r: 0.994, g: 0.7, t: 'sawtooth' }, { r: 2, g: 0.2, t: 'sawtooth' }
      ],
      detune: 8, gain: 0.85, velTrack: 0.5,
      env: { a: 0.22, d: 0.1, s: 0.88, r: 0.5 },
      vib: { rate: 4.8, depth: 5 },
      cutoff: 0.5, reso: 0.04
    },
    synth: {
      name: 'Synth Lead',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.01, g: 0.7, t: 'sawtooth' },
        { r: 0.99, g: 0.7, t: 'sawtooth' }, { r: 2, g: 0.25, t: 'square' }
      ],
      detune: 10, gain: 0.8, velTrack: 0.5,
      env: { a: 0.008, d: 0.25, s: 0.75, r: 0.3 },
      cutoff: 0.66, reso: 0.18
    },

    // --- Guitars (Karplus-Strong plucked string) ---
    acoustic: {
      name: 'Acoustic Guitar', type: 'karplus',
      decay: 0.945, damp: 2600, drive: 0, makeup: 1.7, body: true, velTrack: 0.6,
      env: { a: 0.002, d: 0.1, s: 1.0, r: 0.18 },
      cutoff: 0.78, reso: 0
    },
    eguitar: {
      name: 'Electric Guitar', type: 'karplus',
      decay: 0.958, damp: 3000, drive: 2.5, makeup: 1.5, velTrack: 0.55,
      env: { a: 0.002, d: 0.1, s: 1.0, r: 0.2 },
      cutoff: 0.7, reso: 0.04
    },
    rockguitar: {
      name: 'Rock Guitar (Dist)', type: 'karplus',
      decay: 0.966, damp: 2700, drive: 9, makeup: 1.15,
      env: { a: 0.002, d: 0.1, s: 1.0, r: 0.22 },
      cutoff: 0.64, reso: 0.06
    },
    postrock: {
      name: 'Post-Rock Guitar', type: 'karplus',
      decay: 0.96, damp: 3100, drive: 2.5, makeup: 1.5,
      tremolo: { rate: 5.5, depth: 0.3 },
      env: { a: 0.003, d: 0.1, s: 1.0, r: 0.45 },
      cutoff: 0.72, reso: 0.02
    },

    // --- Sci-fi / math-rock flavoured synths ---
    scifipad: {
      name: 'Sci-Fi Pad',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.006, g: 0.85, t: 'sawtooth' },
        { r: 0.994, g: 0.85, t: 'sawtooth' }, { r: 2, g: 0.28, t: 'sawtooth' },
        { r: 3, g: 0.1, t: 'sine' }
      ],
      detune: 16, gain: 0.7,
      env: { a: 0.6, d: 0.5, s: 0.85, r: 1.6 },
      vib: { rate: 2.5, depth: 8 },
      cutoff: 0.48, reso: 0.1
    },
    hyperlead: {
      name: 'Hyperspace Lead',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.01, g: 0.7, t: 'sawtooth' },
        { r: 2, g: 0.28, t: 'square' }, { r: 3, g: 0.12, t: 'sawtooth' }
      ],
      detune: 12, drive: 1.5, gain: 0.78, velTrack: 0.5,
      env: { a: 0.015, d: 0.25, s: 0.7, r: 0.5 },
      vib: { rate: 5.5, depth: 14 },
      cutoff: 0.7, reso: 0.24
    },
    warpbass: {
      name: 'Warp Bass',
      partials: [
        { r: 0.5, g: 0.7, t: 'sine' }, { r: 1, g: 1.0, t: 'sawtooth' },
        { r: 1.01, g: 0.5, t: 'sawtooth' }, { r: 2, g: 0.2, t: 'square' }
      ],
      detune: 6, drive: 3, gain: 0.95,
      env: { a: 0.006, d: 0.3, s: 0.6, r: 0.22 },
      cutoff: 0.42, reso: 0.2
    },
    crystal: {
      name: 'Crystal Bells',
      partials: [
        { r: 1, g: 1.0, t: 'sine' }, { r: 3.0, g: 0.4, t: 'sine' },
        { r: 5.4, g: 0.2, t: 'sine' }, { r: 8.9, g: 0.08, t: 'sine' }
      ],
      inharm: 0.001, gain: 0.95,
      env: { a: 0.003, d: 1.8, s: 0.0, r: 0.6 },
      vib: { rate: 3.5, depth: 3 },
      cutoff: 0.85, reso: 0
    }
  };

  // ---------- Drum kits ----------
  const DRUM_KITS = {
    real: {
      name: 'Real Drums',
      kick: { f0: 140, f1: 50, dec: 0.34 }, snare: { tone: 185, nz: 0.16, tdec: 0.09, bright: 1400 },
      hat: { c: 0.045, o: 0.32, hp: 7500 }, clapDec: 0.08, tom: { dec: 0.28 }, cym: { dec: 0.9, hp: 5500 }
    },
    acoustic: {
      name: 'Acoustic',
      kick: { f0: 150, f1: 45, dec: 0.32 }, snare: { tone: 180, nz: 0.18, tdec: 0.1, bright: 1200 },
      hat: { c: 0.05, o: 0.35, hp: 7000 }, clapDec: 0.08, tom: { dec: 0.25 }, cym: { dec: 0.7, hp: 6000 }
    },
    eight08: {
      name: '808',
      kick: { f0: 120, f1: 36, dec: 0.7 }, snare: { tone: 200, nz: 0.13, tdec: 0.08, bright: 1800 },
      hat: { c: 0.04, o: 0.3, hp: 9000 }, clapDec: 0.1, tom: { dec: 0.32 }, cym: { dec: 0.85, hp: 7500 }
    },
    nine09: {
      name: '909',
      kick: { f0: 175, f1: 52, dec: 0.26 }, snare: { tone: 190, nz: 0.24, tdec: 0.09, bright: 1500 },
      hat: { c: 0.035, o: 0.26, hp: 8500 }, clapDec: 0.07, tom: { dec: 0.2 }, cym: { dec: 0.95, hp: 6800 }
    },
    lofi: {
      name: 'Lo-Fi',
      kick: { f0: 110, f1: 42, dec: 0.4 }, snare: { tone: 155, nz: 0.16, tdec: 0.12, bright: 900 },
      hat: { c: 0.06, o: 0.4, hp: 5000 }, clapDec: 0.12, tom: { dec: 0.3 }, cym: { dec: 0.55, hp: 4500 }
    }
  };

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.synthBus = null;
    this.drumBus = null;
    this.delay = null; this.delayGain = null;
    this.reverb = null; this.reverbGain = null;
    this.voices = {};
    this.instrument = 'piano';
    this.drumKit = 'real';
    this.params = {
      cutoff: 0.5,        // brightness trim around the instrument's natural tone
      resonance: 0.1,
      attack: 0.0,        // added to instrument attack
      release: 0.15,      // added to instrument release
      reverb: 0.0,        // dry by default
      delay: 0.0,         // dry by default
      vibrato: 0.0,       // added vibrato depth (mod wheel)
      volume: 0.8
    };
  }

  AudioEngine.INSTRUMENTS = INSTRUMENTS;
  AudioEngine.DRUM_KITS = DRUM_KITS;

  AudioEngine.prototype.ensure = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.params.volume;
    this.master.connect(ctx.destination);

    this.synthBus = ctx.createGain(); this.synthBus.gain.value = 0.9;
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 1.0;
    this.synthBus.connect(this.master);
    this.drumBus.connect(this.master);

    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delayGain = ctx.createGain(); this.delayGain.gain.value = this.params.delay;
    this.delay.connect(this.delayGain); this.delayGain.connect(this.master);
    this.synthBus.connect(this.delay);   // drums stay dry — no delay send

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.8, 2.5);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = this.params.reverb;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    this.synthBus.connect(this.reverb);  // drums stay dry — no reverb send
  };

  AudioEngine.prototype._makeImpulse = function (seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  };

  AudioEngine.prototype.setInstrument = function (id) {
    if (INSTRUMENTS[id]) this.instrument = id;
  };

  AudioEngine.prototype.setDrumKit = function (id) {
    if (DRUM_KITS[id]) this.drumKit = id;
  };

  AudioEngine.prototype._distCurve = function (amount) {
    const k = amount, n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return curve;
  };

  AudioEngine.prototype.setParam = function (name, value) {
    this.params[name] = value;
    if (!this.ctx) return;
    if (name === 'volume') this.master.gain.value = value;
    if (name === 'reverb') this.reverbGain.gain.value = value;
    if (name === 'delay') this.delayGain.gain.value = value;
    if (name === 'cutoff' || name === 'resonance') {
      Object.keys(this.voices).forEach((k) => {
        const v = this.voices[k];
        if (v && v.filter) {
          v.filter.frequency.setTargetAtTime(this._cutHz(v.instr) * (v.velBright || 1), this.ctx.currentTime, 0.02);
          v.filter.Q.setTargetAtTime(this._q(v.instr), this.ctx.currentTime, 0.02);
        }
      });
    }
  };

  AudioEngine.prototype._cutHz = function (instr) {
    const eff = Math.min(1, Math.max(0.02, instr.cutoff + (this.params.cutoff - 0.5) * 0.6));
    return 80 * Math.pow(160, eff);
  };
  AudioEngine.prototype._q = function (instr) {
    return 0.7 + (this.params.resonance + (instr.reso || 0)) * 16;
  };

  // noteOn(note, velocity, instrumentId?, key?)
  //  instrumentId — play this voice with a specific instrument (defaults to the
  //                 globally selected one). Lets loop-machine tracks keep their sound.
  //  key          — voice id (defaults to the note). Pass a per-track key so two
  //                 tracks can sound the same note simultaneously without cutting off.
  AudioEngine.prototype.noteOn = function (note, velocity, instrumentId, key) {
    this.ensure();
    const k = (key == null) ? note : key;
    if (this.voices[k]) this.noteOff(k, true);
    const ctx = this.ctx, now = ctx.currentTime;
    const instr = INSTRUMENTS[instrumentId || this.instrument] || INSTRUMENTS.piano;
    const vel = (velocity == null ? 100 : velocity) / 127;
    const baseFreq = midiToFreq(note);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const velTrack = instr.velTrack || 0;
    const velBright = (1 - velTrack) + velTrack * (0.4 + 0.6 * vel); // harder hit = brighter
    filter.frequency.value = this._cutHz(instr) * velBright;
    filter.Q.value = this._q(instr);

    const voiceGain = ctx.createGain();
    filter.connect(voiceGain);

    // Output chain (optional tremolo on the way to the bus)
    let trem = null;
    if (instr.tremolo) {
      const tg = ctx.createGain();
      const depth = instr.tremolo.depth;
      tg.gain.value = 1 - depth / 2;
      const tlfo = ctx.createOscillator(); tlfo.type = 'sine';
      tlfo.frequency.value = instr.tremolo.rate;
      const tdg = ctx.createGain(); tdg.gain.value = depth / 2;
      tlfo.connect(tdg); tdg.connect(tg.gain); tlfo.start(now);
      voiceGain.connect(tg); tg.connect(this.synthBus);
      trem = tlfo;
    } else {
      voiceGain.connect(this.synthBus);
    }

    // Optional distortion (rock guitar, leads)
    let shaper = null;
    if (instr.drive) {
      shaper = ctx.createWaveShaper();
      shaper.curve = this._distCurve(instr.drive);
      shaper.oversample = '2x';
      shaper.connect(filter);
    }
    const srcDest = shaper || filter;

    // Vibrato LFO (additive voices only)
    let lfo = null;
    const vibDepth = (instr.vib ? instr.vib.depth : 0) + this.params.vibrato * 18;
    if (vibDepth > 0.5 && instr.type !== 'karplus') {
      lfo = ctx.createOscillator();
      lfo.frequency.value = instr.vib ? instr.vib.rate : 5;
      const lg = ctx.createGain(); lg.gain.value = vibDepth;
      lfo.connect(lg);
      lfo._gain = lg;
      lfo.start(now);
    }

    const oscs = [];
    let ks = null;
    if (instr.type === 'karplus') {
      // Karplus-Strong plucked string: filtered noise burst into a tuned feedback delay
      const period = 1 / baseFreq;
      const dl = ctx.createDelay(0.5); dl.delayTime.value = period;
      const damp = ctx.createBiquadFilter(); damp.type = 'lowpass';
      damp.frequency.value = (instr.damp || 3000) * (0.6 + 0.7 * vel);
      damp.Q.value = 0.2;
      const fbg = ctx.createGain(); fbg.gain.value = instr.decay || 0.96;
      dl.connect(damp); damp.connect(fbg); fbg.connect(dl);   // feedback loop
      const makeup = ctx.createGain(); makeup.gain.value = instr.makeup || 1.4;
      dl.connect(makeup);
      if (instr.body) {
        const body = ctx.createBiquadFilter(); body.type = 'peaking';
        body.frequency.value = 220; body.Q.value = 1.0; body.gain.value = 6;
        makeup.connect(body); body.connect(srcDest);
      } else {
        makeup.connect(srcDest);
      }
      // excitation: short, low-passed noise burst ~ one period long
      const burst = this._noiseSource(period + 0.006);
      const bf = ctx.createBiquadFilter(); bf.type = 'lowpass';
      bf.frequency.value = (instr.damp || 3000) * 1.5;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.5 * vel, now);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
      burst.connect(bf); bf.connect(bg); bg.connect(dl);
      burst.start(now); burst.stop(now + 0.05);
      ks = { dl, damp, fbg, makeup };
    } else {
      instr.partials.forEach((p) => {
        const o = ctx.createOscillator();
        o.type = p.t;
        const stretch = instr.inharm ? Math.sqrt(1 + instr.inharm * p.r * p.r) : 1;
        o.frequency.value = baseFreq * p.r * stretch;
        if (instr.detune) o.detune.value = (Math.random() * 2 - 1) * instr.detune;
        if (lfo) lfo._gain.connect(o.detune);
        const pg = ctx.createGain(); pg.gain.value = p.g;
        o.connect(pg); pg.connect(srcDest);
        o.start(now);
        oscs.push(o);
      });
    }

    // Envelope
    const peak = 0.22 * vel * (instr.gain || 1);
    const a = (instr.env.a || 0.005) + this.params.attack * 1.2;
    const d = instr.env.d || 0.2;
    const s = instr.env.s;
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peak, now + a);
    voiceGain.gain.setTargetAtTime(Math.max(peak * s, 0.00001), now + a, Math.max(0.02, d * 0.35));

    // Hammer click (piano-ish attack transient)
    if (instr.hammer) {
      const n = this._noiseSource(0.04);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(instr.hammer * vel, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      n.connect(hp); hp.connect(ng); ng.connect(this.synthBus);
      n.start(now); n.stop(now + 0.06);
    }

    // Breath (harmonica)
    let breath = null;
    if (instr.breath) {
      const n = this._noiseSource(2.0); n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(instr.breath * vel, now + a + 0.03);
      n.connect(bp); bp.connect(ng); ng.connect(voiceGain);
      n.start(now);
      breath = { src: n, gain: ng };
    }

    const relTime = (instr.env.r || 0.2) + this.params.release * 1.5;
    this.voices[k] = { oscs, voiceGain, filter, lfo, breath, relTime, instr, trem, ks, shaper, velBright };
  };

  AudioEngine.prototype.noteOff = function (key, immediate) {
    const v = this.voices[key];
    if (!v) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const r = immediate ? 0.02 : v.relTime;
    v.voiceGain.gain.cancelScheduledValues(now);
    v.voiceGain.gain.setValueAtTime(Math.max(v.voiceGain.gain.value, 0.00001), now);
    v.voiceGain.gain.linearRampToValueAtTime(0.0001, now + r);
    const stopAt = now + r + 0.03;
    v.oscs.forEach((o) => { try { o.stop(stopAt); } catch (e) {} });
    if (v.lfo) { try { v.lfo.stop(stopAt); } catch (e) {} }
    if (v.breath) {
      v.breath.gain.gain.cancelScheduledValues(now);
      v.breath.gain.gain.linearRampToValueAtTime(0.0001, now + r);
      try { v.breath.src.stop(stopAt); } catch (e) {}
    }
    if (v.trem) { try { v.trem.stop(stopAt); } catch (e) {} }
    if (v.ks) {
      // mute the string, then disconnect the feedback loop so it frees up
      v.ks.fbg.gain.cancelScheduledValues(now);
      v.ks.fbg.gain.setValueAtTime(v.ks.fbg.gain.value, now);
      v.ks.fbg.gain.linearRampToValueAtTime(0, now + r);
      const n = v.ks, vg = v.voiceGain;
      setTimeout(() => {
        try { n.dl.disconnect(); n.damp.disconnect(); n.fbg.disconnect(); n.makeup.disconnect(); vg.disconnect(); } catch (e) {}
      }, (r + 0.2) * 1000);
    }
    delete this.voices[key];
  };

  AudioEngine.prototype.allNotesOff = function () {
    Object.keys(this.voices).forEach((k) => this.noteOff(k, true));
  };

  // ---------- Drums ----------
  AudioEngine.prototype.triggerDrum = function (padIndex, velocity) {
    this.ensure();
    const now = this.ctx.currentTime;
    const vel = (velocity == null ? 110 : velocity) / 127;
    const out = this.drumBus;
    const kit = DRUM_KITS[this.drumKit] || DRUM_KITS.acoustic;
    switch (padIndex) {
      case 0: this._kick(now, vel, out, kit.kick); break;
      case 1: this._snare(now, vel, out, kit.snare); break;
      case 2: this._hat(now, vel, out, kit.hat.c, kit.hat.hp); break;
      case 3: this._hat(now, vel, out, kit.hat.o, kit.hat.hp); break;
      case 4: this._clap(now, vel, out, kit.clapDec); break;
      case 5: this._tom(now, vel, out, 180, kit.tom.dec); break;
      case 6: this._tom(now, vel, out, 320, kit.tom.dec); break;
      case 7: this._cymbal(now, vel, out, kit.cym); break;
      default: this._hat(now, vel, out, kit.hat.c, kit.hat.hp);
    }
  };

  AudioEngine.prototype._env = function (gain, now, peak, a, d) {
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  };
  AudioEngine.prototype._kick = function (now, vel, out, p) {
    const ctx = this.ctx;
    // body — pitch-swept sine
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.setValueAtTime(p.f0 * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(p.f1, now + Math.min(0.16, p.dec * 0.4));
    this._env(g, now, 0.95 * vel, 0.002, p.dec);
    osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + p.dec + 0.1);
    // beater click
    const n = this._noiseSource(0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const ng = ctx.createGain(); this._env(ng, now, 0.35 * vel, 0.0004, 0.02);
    n.connect(hp); hp.connect(ng); ng.connect(out); n.start(now); n.stop(now + 0.04);
  };
  AudioEngine.prototype._snare = function (now, vel, out, p) {
    const ctx = this.ctx;
    // bright snare buzz
    const n1 = this._noiseSource(p.nz + 0.05);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.bright;
    const g1 = ctx.createGain(); this._env(g1, now, 0.5 * vel, 0.001, p.nz);
    n1.connect(hp); hp.connect(g1); g1.connect(out); n1.start(now); n1.stop(now + p.nz + 0.06);
    // mid-band snap
    const n2 = this._noiseSource(p.nz * 0.7 + 0.03);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.bright * 0.55; bp.Q.value = 0.6;
    const g2 = ctx.createGain(); this._env(g2, now, 0.3 * vel, 0.001, p.nz * 0.7);
    n2.connect(bp); bp.connect(g2); g2.connect(out); n2.start(now); n2.stop(now + p.nz);
    // tonal shell (two partials)
    [[p.tone, 0.26], [p.tone * 1.5, 0.13]].forEach((pr) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = pr[0];
      const og = ctx.createGain(); this._env(og, now, pr[1] * vel, 0.001, p.tdec);
      o.connect(og); og.connect(out); o.start(now); o.stop(now + p.tdec + 0.05);
    });
  };
  AudioEngine.prototype._hat = function (now, vel, out, decay, hp) {
    const ctx = this.ctx;
    const noise = this._noiseSource(decay + 0.05);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 7000;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (hp || 7000) * 1.4; bp.Q.value = 0.7;
    const g = ctx.createGain(); this._env(g, now, 0.32 * vel, 0.001, decay);
    noise.connect(f); f.connect(bp); bp.connect(g); g.connect(out); noise.start(now); noise.stop(now + decay + 0.1);
  };
  AudioEngine.prototype._clap = function (now, vel, out, dec) {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.012;
      const noise = this._noiseSource(dec + 0.04);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
      const g = ctx.createGain(); this._env(g, t, 0.4 * vel, 0.001, dec);
      noise.connect(bp); bp.connect(g); g.connect(out); noise.start(t); noise.stop(t + dec + 0.04);
    }
  };
  AudioEngine.prototype._tom = function (now, vel, out, freq, dec) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.2, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + dec * 0.8);
    const g = ctx.createGain(); this._env(g, now, 0.6 * vel, 0.002, dec);
    osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + dec + 0.08);
    // attack thud
    const n = this._noiseSource(0.03);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2;
    const ng = ctx.createGain(); this._env(ng, now, 0.15 * vel, 0.001, 0.03);
    n.connect(bp); bp.connect(ng); ng.connect(out); n.start(now); n.stop(now + 0.05);
  };
  AudioEngine.prototype._cymbal = function (now, vel, out, p) {
    const ctx = this.ctx;
    const noise = this._noiseSource(p.dec + 0.1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hp;
    const g = ctx.createGain(); this._env(g, now, 0.28 * vel, 0.002, p.dec);
    noise.connect(hp); hp.connect(g); g.connect(out); noise.start(now); noise.stop(now + p.dec + 0.1);
    // shimmer band
    const n2 = this._noiseSource(p.dec + 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.hp * 1.6; bp.Q.value = 0.5;
    const g2 = ctx.createGain(); this._env(g2, now, 0.14 * vel, 0.002, p.dec * 0.85);
    n2.connect(bp); bp.connect(g2); g2.connect(out); n2.start(now); n2.stop(now + p.dec + 0.1);
  };
  AudioEngine.prototype._noiseSource = function (seconds) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; return src;
  };

  window.AudioEngine = AudioEngine;
  window.MidiUtil = { midiToFreq, noteName, NOTE_NAMES };
})();
