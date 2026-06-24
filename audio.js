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
        { r: 1, g: 1.0, t: 'triangle' }, { r: 2, g: 0.55, t: 'sine' },
        { r: 3, g: 0.30, t: 'sine' }, { r: 4, g: 0.18, t: 'sine' },
        { r: 5, g: 0.10, t: 'sine' }, { r: 6, g: 0.06, t: 'sine' }
      ],
      inharm: 0.0007, detune: 2,
      env: { a: 0.004, d: 1.8, s: 0.0, r: 0.22 },
      cutoff: 0.82, reso: 0, hammer: 0.05
    },
    epiano: {
      name: 'Electric Piano',
      partials: [
        { r: 1, g: 1.0, t: 'sine' }, { r: 2, g: 0.4, t: 'sine' },
        { r: 4, g: 0.5, t: 'sine' }, { r: 7, g: 0.12, t: 'sine' }
      ],
      inharm: 0.0004, detune: 1,
      env: { a: 0.005, d: 1.4, s: 0.0, r: 0.28 },
      cutoff: 0.7, reso: 0, hammer: 0.02
    },
    organ: {
      name: 'Organ',
      partials: [
        { r: 1, g: 1.0, t: 'sine' }, { r: 2, g: 0.7, t: 'sine' },
        { r: 3, g: 0.55, t: 'sine' }, { r: 4, g: 0.4, t: 'sine' },
        { r: 6, g: 0.28, t: 'sine' }, { r: 8, g: 0.18, t: 'sine' }
      ],
      detune: 0,
      env: { a: 0.01, d: 0.05, s: 1.0, r: 0.06 },
      vib: { rate: 6.2, depth: 4 },
      cutoff: 0.88, reso: 0
    },
    accordion: {
      name: 'Accordion',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.004, g: 0.85, t: 'sawtooth' },
        { r: 2, g: 0.45, t: 'square' }, { r: 3, g: 0.2, t: 'sawtooth' }
      ],
      detune: 4,
      env: { a: 0.04, d: 0.08, s: 0.85, r: 0.14 },
      vib: { rate: 5, depth: 6 },
      cutoff: 0.62, reso: 0.12
    },
    harmonica: {
      name: 'Harmonica',
      partials: [
        { r: 1, g: 1.0, t: 'square' }, { r: 2, g: 0.5, t: 'sine' },
        { r: 3, g: 0.32, t: 'square' }, { r: 4, g: 0.12, t: 'sine' }
      ],
      detune: 3,
      env: { a: 0.03, d: 0.06, s: 0.8, r: 0.1 },
      vib: { rate: 6, depth: 8 }, breath: 0.05,
      cutoff: 0.58, reso: 0.18
    },
    strings: {
      name: 'Strings',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.006, g: 0.7, t: 'sawtooth' },
        { r: 0.997, g: 0.6, t: 'sawtooth' }, { r: 2, g: 0.25, t: 'sawtooth' }
      ],
      detune: 6,
      env: { a: 0.18, d: 0.1, s: 0.85, r: 0.45 },
      vib: { rate: 5, depth: 5 },
      cutoff: 0.56, reso: 0.05
    },
    synth: {
      name: 'Synth Lead',
      partials: [
        { r: 1, g: 1.0, t: 'sawtooth' }, { r: 1.01, g: 0.6, t: 'sawtooth' }
      ],
      detune: 8,
      env: { a: 0.01, d: 0.2, s: 0.75, r: 0.3 },
      cutoff: 0.7, reso: 0.15
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
    this.params = {
      cutoff: 0.5,        // brightness trim around the instrument's natural tone
      resonance: 0.1,
      attack: 0.0,        // added to instrument attack
      release: 0.15,      // added to instrument release
      reverb: 0.18,
      delay: 0.08,
      vibrato: 0.0,       // added vibrato depth (mod wheel)
      volume: 0.8
    };
  }

  AudioEngine.INSTRUMENTS = INSTRUMENTS;

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
    this.synthBus.connect(this.delay); this.drumBus.connect(this.delay);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.8, 2.5);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = this.params.reverb;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    this.synthBus.connect(this.reverb); this.drumBus.connect(this.reverb);
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
          v.filter.frequency.setTargetAtTime(this._cutHz(v.instr), this.ctx.currentTime, 0.02);
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

  AudioEngine.prototype.noteOn = function (note, velocity) {
    this.ensure();
    if (this.voices[note]) this.noteOff(note, true);
    const ctx = this.ctx, now = ctx.currentTime;
    const instr = INSTRUMENTS[this.instrument] || INSTRUMENTS.piano;
    const vel = (velocity == null ? 100 : velocity) / 127;
    const baseFreq = midiToFreq(note);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this._cutHz(instr);
    filter.Q.value = this._q(instr);

    const voiceGain = ctx.createGain();
    filter.connect(voiceGain);
    voiceGain.connect(this.synthBus);

    // Vibrato LFO (shared across this voice's oscillators)
    let lfo = null;
    const vibDepth = (instr.vib ? instr.vib.depth : 0) + this.params.vibrato * 18;
    if (vibDepth > 0.5) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = instr.vib ? instr.vib.rate : 5;
      const lg = ctx.createGain(); lg.gain.value = vibDepth;
      lfo.connect(lg);
      lfo._gain = lg;
      lfo.start(now);
    }

    const oscs = [];
    instr.partials.forEach((p) => {
      const o = ctx.createOscillator();
      o.type = p.t;
      const stretch = instr.inharm ? Math.sqrt(1 + instr.inharm * p.r * p.r) : 1;
      o.frequency.value = baseFreq * p.r * stretch;
      if (instr.detune) o.detune.value = (Math.random() * 2 - 1) * instr.detune;
      if (lfo) lfo._gain.connect(o.detune);
      const pg = ctx.createGain(); pg.gain.value = p.g;
      o.connect(pg); pg.connect(filter);
      o.start(now);
      oscs.push(o);
    });

    // Envelope
    const peak = 0.22 * vel;
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
    this.voices[note] = { oscs, voiceGain, filter, lfo, breath, relTime, instr };
  };

  AudioEngine.prototype.noteOff = function (note, immediate) {
    const v = this.voices[note];
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
    delete this.voices[note];
  };

  AudioEngine.prototype.allNotesOff = function () {
    Object.keys(this.voices).forEach((n) => this.noteOff(+n, true));
  };

  // ---------- Drums ----------
  AudioEngine.prototype.triggerDrum = function (padIndex, velocity) {
    this.ensure();
    const now = this.ctx.currentTime;
    const vel = (velocity == null ? 110 : velocity) / 127;
    const out = this.drumBus;
    switch (padIndex) {
      case 0: this._kick(now, vel, out); break;
      case 1: this._snare(now, vel, out); break;
      case 2: this._hat(now, vel, out, 0.05); break;
      case 3: this._hat(now, vel, out, 0.35); break;
      case 4: this._clap(now, vel, out); break;
      case 5: this._tom(now, vel, out, 180); break;
      case 6: this._tom(now, vel, out, 320); break;
      case 7: this._cymbal(now, vel, out); break;
      default: this._hat(now, vel, out, 0.05);
    }
  };

  AudioEngine.prototype._env = function (gain, now, peak, a, d) {
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  };
  AudioEngine.prototype._kick = function (now, vel, out) {
    const ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
    this._env(g, now, 0.9 * vel, 0.002, 0.32);
    osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.4);
  };
  AudioEngine.prototype._snare = function (now, vel, out) {
    const ctx = this.ctx;
    const noise = this._noiseSource(0.2);
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1200;
    const ng = ctx.createGain(); this._env(ng, now, 0.55 * vel, 0.001, 0.18);
    noise.connect(nf); nf.connect(ng); ng.connect(out); noise.start(now); noise.stop(now + 0.25);
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 180;
    const og = ctx.createGain(); this._env(og, now, 0.3 * vel, 0.001, 0.1);
    osc.connect(og); og.connect(out); osc.start(now); osc.stop(now + 0.15);
  };
  AudioEngine.prototype._hat = function (now, vel, out, decay) {
    const ctx = this.ctx;
    const noise = this._noiseSource(decay + 0.05);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); this._env(g, now, 0.35 * vel, 0.001, decay);
    noise.connect(hp); hp.connect(g); g.connect(out); noise.start(now); noise.stop(now + decay + 0.1);
  };
  AudioEngine.prototype._clap = function (now, vel, out) {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.012;
      const noise = this._noiseSource(0.1);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
      const g = ctx.createGain(); this._env(g, t, 0.4 * vel, 0.001, 0.08);
      noise.connect(bp); bp.connect(g); g.connect(out); noise.start(t); noise.stop(t + 0.12);
    }
  };
  AudioEngine.prototype._tom = function (now, vel, out, freq) {
    const ctx = this.ctx, osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.2);
    const g = ctx.createGain(); this._env(g, now, 0.6 * vel, 0.002, 0.25);
    osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + 0.3);
  };
  AudioEngine.prototype._cymbal = function (now, vel, out) {
    const ctx = this.ctx;
    const noise = this._noiseSource(0.8);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); this._env(g, now, 0.3 * vel, 0.002, 0.7);
    noise.connect(hp); hp.connect(g); g.connect(out); noise.start(now); noise.stop(now + 0.9);
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
