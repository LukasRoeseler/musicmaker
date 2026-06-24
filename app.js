/* app.js — Virtual AKAI MPK mini Play MK3
 * Wires the on-screen controller, computer keyboard, Web MIDI I/O,
 * the loop machine / recorder, and MIDI file import/export.
 */
(function () {
  'use strict';

  const engine = new AudioEngine();
  const { noteName } = window.MidiUtil;

  // ---------- State ----------
  const state = {
    baseNote: 48,            // C3 — leftmost key of the 25-key bed
    numKeys: 25,
    octaveOffset: 0,         // applied via octave buttons (in semitone *12)
    padBank: 0,              // 0 = A, 1 = B
    sustain: false,
    midiAccess: null,
    midiInputs: [],
    midiOutputs: [],
    activeOutput: null,
    midiThru: false
  };

  // GM drum note for each pad index (bank A). Used for MIDI export/import map.
  const PAD_GM = [36, 38, 42, 46, 39, 45, 50, 49];
  const PAD_LABELS = ['Kick', 'Snare', 'Hat', 'Open Hat', 'Clap', 'Lo Tom', 'Hi Tom', 'Crash'];

  // Knob -> param mapping
  const KNOBS = [
    { param: 'cutoff', label: 'Cutoff', cc: 70 },
    { param: 'resonance', label: 'Reso', cc: 71 },
    { param: 'attack', label: 'Attack', cc: 73 },
    { param: 'release', label: 'Release', cc: 72 },
    { param: 'reverb', label: 'Reverb', cc: 91 },
    { param: 'delay', label: 'Delay', cc: 93 },
    { param: 'vibrato', label: 'Vibrato', cc: 1 },  // mod wheel
    { param: 'volume', label: 'Volume', cc: 7 }
  ];

  // Computer-keyboard -> key offset (semitones from leftmost visible key).
  // Keyed by event.code (PHYSICAL key position) so the layout is identical on
  // US-QWERTY and German-QWERTZ keyboards — Y and Z swap their printed letters
  // between those layouts, but the physical codes (KeyY/KeyZ) do not.
  const KEYMAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16
  };
  const PADKEYS = {
    Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7,
    Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad7: 6, Numpad8: 7
  };

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const keysEl = $('keys');
  const padsEl = $('pads');
  const knobsEl = $('knobs');
  const logEl = $('log');

  function log(msg) {
    if (!logEl) return;
    const t = new Date().toLocaleTimeString();
    logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
  }

  // ======================================================================
  // Build the keyboard
  // ======================================================================
  const WHITE_SET = [0, 2, 4, 5, 7, 9, 11];
  const keyEls = {}; // note -> element

  function buildKeyboard() {
    keysEl.innerHTML = '';
    const start = state.baseNote + state.octaveOffset;
    // First pass: count white keys for layout
    const whiteWidth = 100 / countWhite(start, state.numKeys);
    let whiteIndex = 0;
    for (let i = 0; i < state.numKeys; i++) {
      const note = start + i;
      const isWhite = WHITE_SET.indexOf(note % 12) !== -1;
      const el = document.createElement('div');
      el.className = 'key ' + (isWhite ? 'white' : 'black');
      el.dataset.note = note;
      if (isWhite) {
        el.style.left = (whiteIndex * whiteWidth) + '%';
        el.style.width = whiteWidth + '%';
        const lbl = document.createElement('span');
        lbl.className = 'klabel';
        lbl.textContent = noteName(note);
        el.appendChild(lbl);
        whiteIndex++;
      } else {
        el.style.left = (whiteIndex * whiteWidth - whiteWidth * 0.32) + '%';
        el.style.width = (whiteWidth * 0.64) + '%';
      }
      attachKeyHandlers(el, note);
      keysEl.appendChild(el);
      keyEls[note] = el;
    }
  }
  function countWhite(start, n) {
    let c = 0;
    for (let i = 0; i < n; i++) if (WHITE_SET.indexOf((start + i) % 12) !== -1) c++;
    return c;
  }

  function attachKeyHandlers(el, note) {
    const down = (e) => { e.preventDefault(); playNote(note, 100, 'screen'); };
    const up = (e) => { e.preventDefault(); stopNote(note, 'screen'); };
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', (e) => { if (e.buttons) stopNote(note, 'screen'); });
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
  }

  // ======================================================================
  // Build pads
  // ======================================================================
  const padEls = [];
  function buildPads() {
    padsEl.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'pad';
      el.dataset.pad = i;
      el.innerHTML = `<span class="pad-num">${i + 1}</span><span class="pad-name">${PAD_LABELS[i]}</span>`;
      const hit = (e) => { e.preventDefault(); triggerPad(i, 115, 'screen'); };
      el.addEventListener('mousedown', hit);
      el.addEventListener('touchstart', hit, { passive: false });
      padsEl.appendChild(el);
      padEls.push(el);
    }
  }

  // ======================================================================
  // Build knobs
  // ======================================================================
  const knobState = []; // {value 0..1}
  function buildKnobs() {
    knobsEl.innerHTML = '';
    KNOBS.forEach((k, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'knob-wrap';
      const dial = document.createElement('div');
      dial.className = 'knob';
      const ind = document.createElement('div');
      ind.className = 'knob-ind';
      dial.appendChild(ind);
      const label = document.createElement('div');
      label.className = 'knob-label';
      const valEl = document.createElement('div');
      valEl.className = 'knob-val';
      wrap.appendChild(dial);
      wrap.appendChild(label);
      wrap.appendChild(valEl);
      knobsEl.appendChild(wrap);

      const initVal = engine.params[k.param];
      knobState[i] = { value: initVal, dial, ind, valEl, label, def: k };
      label.textContent = k.label;
      renderKnob(i);
      attachKnobDrag(i);
    });
  }

  function renderKnob(i) {
    const ks = knobState[i];
    const angle = -135 + ks.value * 270;
    ks.ind.style.transform = `rotate(${angle}deg)`;
    ks.valEl.textContent = Math.round(ks.value * 100);
  }

  function applyKnob(i) {
    const ks = knobState[i];
    engine.setParam(ks.def.param, ks.value);
    renderKnob(i);
  }

  function attachKnobDrag(i) {
    const ks = knobState[i];
    let startY = 0, startVal = 0, dragging = false;
    const move = (clientY) => {
      const dy = startY - clientY;
      ks.value = Math.min(1, Math.max(0, startVal + dy / 200));
      applyKnob(i);
    };
    const onMouseMove = (e) => dragging && move(e.clientY);
    const onMouseUp = () => { dragging = false; window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    ks.dial.addEventListener('mousedown', (e) => {
      e.preventDefault(); dragging = true; startY = e.clientY; startVal = ks.value;
      window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
    });
    ks.dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      ks.value = Math.min(1, Math.max(0, ks.value - Math.sign(e.deltaY) * 0.04));
      applyKnob(i);
    }, { passive: false });
    ks.dial.addEventListener('touchstart', (e) => {
      dragging = true; startY = e.touches[0].clientY; startVal = ks.value;
    }, { passive: false });
    ks.dial.addEventListener('touchmove', (e) => {
      e.preventDefault(); if (dragging) move(e.touches[0].clientY);
    }, { passive: false });
    ks.dial.addEventListener('touchend', () => { dragging = false; });
  }

  function setKnobByCC(controller, value) {
    const idx = KNOBS.findIndex((k) => k.cc === controller);
    if (idx === -1) return;
    knobState[idx].value = value / 127;
    applyKnob(idx);
  }

  // ======================================================================
  // Sound triggering (with visual feedback + recording)
  // ======================================================================
  function playNote(note, velocity, source) {
    engine.noteOn(note, velocity);
    if (keyEls[note]) keyEls[note].classList.add('active');
    if (source !== 'midi-thru' && state.midiThru) sendMidiOut([0x90, note, velocity]);
    recorder.record({ type: 'noteOn', note, velocity });
  }
  function stopNote(note, source) {
    if (state.sustain) { // hold until sustain released; mark pending
      sustainPending[note] = true;
      return;
    }
    engine.noteOff(note);
    if (keyEls[note]) keyEls[note].classList.remove('active');
    if (source !== 'midi-thru' && state.midiThru) sendMidiOut([0x80, note, 0]);
    recorder.record({ type: 'noteOff', note, velocity: 0 });
  }
  const sustainPending = {};
  function setSustain(on) {
    state.sustain = on;
    if (!on) {
      Object.keys(sustainPending).forEach((n) => { delete sustainPending[n]; stopNote(+n); });
    }
  }

  function triggerPad(i, velocity, source) {
    engine.triggerDrum(i, velocity);
    if (padEls[i]) {
      padEls[i].classList.add('active');
      setTimeout(() => padEls[i].classList.remove('active'), 120);
    }
    if (source !== 'midi-thru' && state.midiThru) {
      sendMidiOut([0x99, PAD_GM[i], velocity]);
      sendMidiOut([0x89, PAD_GM[i], 0]);
    }
    recorder.record({ type: 'drum', padIndex: i, velocity });
  }

  // ======================================================================
  // Computer keyboard
  // ======================================================================
  const heldKeys = {};
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    engine.ensure();
    const code = e.code; // physical key position — layout independent
    if (code in KEYMAP) {
      const note = state.baseNote + state.octaveOffset + KEYMAP[code];
      if (!heldKeys[code]) { heldKeys[code] = note; playNote(note, 100, 'kbd'); }
    } else if (code in PADKEYS) {
      triggerPad(PADKEYS[code], 115, 'kbd');
    } else if (code === 'KeyZ') { shiftOctave(-1); }
    else if (code === 'KeyX') { shiftOctave(1); }
    else if (code === 'Space') { e.preventDefault(); recorder.togglePlay(); }
    else if (code === 'KeyR') { recorder.toggleRecord(); }
  });
  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code in KEYMAP && heldKeys[code] != null) {
      stopNote(heldKeys[code], 'kbd');
      delete heldKeys[code];
    }
  });

  function shiftOctave(dir) {
    state.octaveOffset = Math.max(-24, Math.min(24, state.octaveOffset + dir * 12));
    engine.allNotesOff();
    Object.keys(heldKeys).forEach((k) => delete heldKeys[k]);
    buildKeyboard();
    $('octaveLabel').textContent = (state.octaveOffset >= 0 ? '+' : '') + (state.octaveOffset / 12);
  }

  // ======================================================================
  // Web MIDI
  // ======================================================================
  function initMidi() {
    if (!navigator.requestMIDIAccess) {
      log('Web MIDI not supported in this browser. Use Chrome/Edge on desktop or Android.');
      $('midiStatus').textContent = 'Web MIDI: unavailable';
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      state.midiAccess = access;
      refreshMidiPorts();
      access.onstatechange = refreshMidiPorts;
      $('midiStatus').textContent = 'Web MIDI: ready';
      log('Web MIDI ready.');
    }).catch((err) => {
      log('MIDI access denied: ' + err);
      $('midiStatus').textContent = 'Web MIDI: denied';
    });
  }

  function refreshMidiPorts() {
    const access = state.midiAccess;
    if (!access) return;
    state.midiInputs = Array.from(access.inputs.values());
    state.midiOutputs = Array.from(access.outputs.values());

    const inSel = $('midiIn');
    const outSel = $('midiOut');
    inSel.innerHTML = '<option value="all">All inputs</option>';
    state.midiInputs.forEach((inp, i) => {
      inSel.innerHTML += `<option value="${i}">${inp.name}</option>`;
      inp.onmidimessage = handleMidiMessage;
    });
    outSel.innerHTML = '<option value="">None</option>';
    state.midiOutputs.forEach((o, i) => {
      outSel.innerHTML += `<option value="${i}">${o.name}</option>`;
    });
    log(`MIDI ports: ${state.midiInputs.length} in, ${state.midiOutputs.length} out.`);
  }

  function handleMidiMessage(e) {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    const ch = status & 0x0f;
    engine.ensure();
    if (cmd === 0x90 && d2 > 0) {
      if (ch === 9) { const p = PAD_GM.indexOf(d1); if (p !== -1) triggerPad(p, d2, 'midi'); }
      else playNote(d1, d2, 'midi');
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      if (ch !== 9) stopNote(d1, 'midi');
    } else if (cmd === 0xb0) {
      if (d1 === 64) setSustain(d2 >= 64);
      else setKnobByCC(d1, d2);
    }
  }

  function sendMidiOut(bytes) {
    if (state.activeOutput) {
      try { state.activeOutput.send(bytes); } catch (err) { /* ignore */ }
    }
  }

  // ======================================================================
  // Loop machine / recorder
  // ======================================================================
  const recorder = {
    bpm: 120,
    bars: 4,
    beatsPerBar: 4,
    quantize: 0,             // 0 = off, else grid in beats (e.g. 0.25 = 1/16)
    tracks: [],              // [{name, events:[{time, ...}], muted, color}]
    activeTrack: 0,
    playing: false,
    recording: false,
    metronome: false,
    startTime: 0,            // ctx time when loop position 0 occurred
    lastPos: 0,
    timer: null,
    lastBeat: -1,

    loopLength() { return (60 / this.bpm) * this.beatsPerBar * this.bars; },
    pos() {
      if (!this.playing) return 0;
      return (engine.ctx.currentTime - this.startTime) % this.loopLength();
    },

    ensureTrack() {
      if (this.tracks.length === 0) this.addTrack();
      if (this.activeTrack >= this.tracks.length) this.activeTrack = 0;
    },
    addTrack(name) {
      const colors = ['#ff5d73', '#ffd166', '#06d6a0', '#4cc9f0', '#b794f6', '#f78c6b'];
      this.tracks.push({
        name: name || ('Track ' + (this.tracks.length + 1)),
        events: [], muted: false, color: colors[this.tracks.length % colors.length]
      });
      this.activeTrack = this.tracks.length - 1;
      renderTracks();
    },
    clearTrack(i) {
      if (this.tracks[i]) { this.tracks[i].events = []; renderTracks(); }
    },
    removeTrack(i) {
      this.tracks.splice(i, 1);
      if (this.activeTrack >= this.tracks.length) this.activeTrack = Math.max(0, this.tracks.length - 1);
      renderTracks();
    },

    record(ev) {
      if (!this.recording || !this.playing) return;
      this.ensureTrack();
      let time = this.pos();
      if (this.quantize > 0 && (ev.type === 'noteOn' || ev.type === 'drum')) {
        const grid = (60 / this.bpm) * this.quantize;
        time = Math.round(time / grid) * grid;
        if (time >= this.loopLength()) time = 0;
      }
      this.tracks[this.activeTrack].events.push(Object.assign({ time }, ev));
    },

    togglePlay() {
      if (this.playing) this.stop(); else this.play();
    },
    play() {
      engine.ensure();
      this.playing = true;
      this.startTime = engine.ctx.currentTime;
      this.lastPos = 0;
      this.lastBeat = -1;
      this.timer = setInterval(() => this.tick(), 20);
      updateTransportUI();
    },
    stop() {
      this.playing = false;
      this.recording = false;
      clearInterval(this.timer);
      engine.allNotesOff();
      Object.keys(keyEls).forEach((n) => keyEls[n].classList.remove('active'));
      updateTransportUI();
      $('playhead').style.left = '0%';
    },
    toggleRecord() {
      this.recording = !this.recording;
      if (this.recording && !this.playing) this.play();
      this.ensureTrack();
      updateTransportUI();
    },

    tick() {
      const len = this.loopLength();
      const pos = this.pos();
      const from = this.lastPos;
      // playhead
      $('playhead').style.left = (pos / len * 100) + '%';

      const fireRange = (a, b) => {
        // metronome
        if (this.metronome) {
          const beatLen = 60 / this.bpm;
          let beat = Math.floor(a / beatLen);
          while ((beat + 1) * beatLen <= b) {
            beat++;
            const click = (beat % this.beatsPerBar === 0);
            engine.triggerDrum(click ? 6 : 2, click ? 90 : 50);
          }
        }
        this.tracks.forEach((tr) => {
          if (tr.muted) return;
          tr.events.forEach((ev) => {
            if (ev.time >= a && ev.time < b) this.fire(ev);
          });
        });
      };

      if (pos < from) { // wrapped
        fireRange(from, len + 0.0001);
        fireRange(0, pos);
      } else {
        fireRange(from, pos);
      }
      this.lastPos = pos;
    },

    fire(ev) {
      if (ev.type === 'noteOn') { engine.noteOn(ev.note, ev.velocity); flashKey(ev.note, true); if (state.midiThru) sendMidiOut([0x90, ev.note, ev.velocity]); }
      else if (ev.type === 'noteOff') { engine.noteOff(ev.note); flashKey(ev.note, false); if (state.midiThru) sendMidiOut([0x80, ev.note, 0]); }
      else if (ev.type === 'drum') { engine.triggerDrum(ev.padIndex, ev.velocity); if (padEls[ev.padIndex]) { padEls[ev.padIndex].classList.add('active'); setTimeout(() => padEls[ev.padIndex].classList.remove('active'), 100); } }
    }
  };

  function flashKey(note, on) {
    if (!keyEls[note]) return;
    keyEls[note].classList.toggle('active', on);
  }

  function renderTracks() {
    const el = $('trackList');
    el.innerHTML = '';
    recorder.tracks.forEach((tr, i) => {
      const row = document.createElement('div');
      row.className = 'track-row' + (i === recorder.activeTrack ? ' active' : '');
      row.innerHTML = `
        <span class="track-dot" style="background:${tr.color}"></span>
        <span class="track-name">${tr.name}</span>
        <span class="track-count">${tr.events.length} ev</span>
        <button class="mini ${tr.muted ? 'on' : ''}" data-act="mute" data-i="${i}">M</button>
        <button class="mini" data-act="clear" data-i="${i}">⌫</button>
        <button class="mini" data-act="del" data-i="${i}">✕</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.dataset.act) return;
        recorder.activeTrack = i; renderTracks();
      });
      el.appendChild(row);
    });
    el.querySelectorAll('button.mini').forEach((b) => {
      b.addEventListener('click', (e) => {
        const i = +b.dataset.i, act = b.dataset.act;
        if (act === 'mute') recorder.tracks[i].muted = !recorder.tracks[i].muted;
        else if (act === 'clear') recorder.clearTrack(i);
        else if (act === 'del') recorder.removeTrack(i);
        renderTracks();
      });
    });
  }

  function updateTransportUI() {
    $('playBtn').classList.toggle('on', recorder.playing);
    $('playBtn').textContent = recorder.playing ? '⏸ Stop' : '▶ Play';
    $('recBtn').classList.toggle('on', recorder.recording);
  }

  // ======================================================================
  // MIDI import / export
  // ======================================================================
  function exportMidi() {
    recorder.ensureTrack();
    const tpb = 480;
    const secPerBeat = 60 / recorder.bpm;
    const toTick = (t) => Math.round(t / secPerBeat * tpb);
    const tracks = recorder.tracks.map((tr) => {
      const events = [];
      tr.events.forEach((ev) => {
        if (ev.type === 'noteOn') events.push({ tick: toTick(ev.time), type: 'noteOn', note: ev.note, velocity: ev.velocity, channel: 0 });
        else if (ev.type === 'noteOff') events.push({ tick: toTick(ev.time), type: 'noteOff', note: ev.note, velocity: 0, channel: 0 });
        else if (ev.type === 'drum') {
          const t = toTick(ev.time);
          events.push({ tick: t, type: 'noteOn', note: PAD_GM[ev.padIndex], velocity: ev.velocity, channel: 9 });
          events.push({ tick: t + tpb / 8, type: 'noteOff', note: PAD_GM[ev.padIndex], velocity: 0, channel: 9 });
        }
      });
      return { name: tr.name, events };
    });
    const bytes = MidiFile.build({ ticksPerBeat: tpb, tempo: Math.round(secPerBeat * 1e6), tracks });
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'musicmaker-loop.mid';
    a.click();
    URL.revokeObjectURL(url);
    log('Exported MIDI (' + tracks.length + ' tracks).');
  }

  function importMidi(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = MidiFile.parse(reader.result);
        loadParsedMidi(parsed, file.name);
      } catch (err) {
        log('Import failed: ' + err.message);
        alert('Could not parse MIDI file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function loadParsedMidi(parsed, name) {
    const tpb = parsed.ticksPerBeat || 480;
    const bpm = Math.round(60000000 / parsed.tempo);
    recorder.bpm = bpm;
    $('bpm').value = bpm;

    const secPerTick = (parsed.tempo / 1e6) / tpb;
    let maxTime = 0;
    // Separate melodic and drum notes into two tracks
    const melodic = { name: name + ' (notes)', events: [], muted: false, color: '#4cc9f0' };
    const drums = { name: name + ' (drums)', events: [], muted: false, color: '#ff5d73' };
    parsed.notes.forEach((n) => {
      const start = n.startTick * secPerTick;
      const end = n.endTick * secPerTick;
      maxTime = Math.max(maxTime, end);
      if (n.channel === 9) {
        const p = PAD_GM.indexOf(n.note);
        if (p !== -1) drums.events.push({ time: start, type: 'drum', padIndex: p, velocity: n.velocity });
        else drums.events.push({ time: start, type: 'drum', padIndex: nearestPad(n.note), velocity: n.velocity });
      } else {
        melodic.events.push({ time: start, type: 'noteOn', note: n.note, velocity: n.velocity });
        melodic.events.push({ time: end, type: 'noteOff', note: n.note, velocity: 0 });
      }
    });

    // Fit loop length to the song (round up to whole bars)
    const beatLen = 60 / bpm;
    const barLen = beatLen * recorder.beatsPerBar;
    recorder.bars = Math.max(1, Math.ceil(maxTime / barLen));
    $('bars').value = recorder.bars;

    recorder.tracks = [];
    if (melodic.events.length) recorder.tracks.push(melodic);
    if (drums.events.length) recorder.tracks.push(drums);
    if (recorder.tracks.length === 0) recorder.addTrack();
    recorder.activeTrack = 0;
    renderTracks();
    log(`Imported "${name}": ${parsed.notes.length} notes, ${bpm} BPM, ${recorder.bars} bars.`);
  }
  function nearestPad(note) {
    let best = 0, bd = 1e9;
    PAD_GM.forEach((g, i) => { const d = Math.abs(g - note); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ======================================================================
  // Wire up controls
  // ======================================================================
  function wireControls() {
    $('playBtn').addEventListener('click', () => recorder.togglePlay());
    $('recBtn').addEventListener('click', () => recorder.toggleRecord());
    $('addTrackBtn').addEventListener('click', () => recorder.addTrack());
    $('metroBtn').addEventListener('click', (e) => {
      recorder.metronome = !recorder.metronome;
      e.target.classList.toggle('on', recorder.metronome);
    });
    $('panicBtn').addEventListener('click', () => { engine.allNotesOff(); Object.keys(keyEls).forEach((n) => keyEls[n].classList.remove('active')); });

    $('bpm').addEventListener('change', (e) => { recorder.bpm = Math.max(40, Math.min(300, +e.target.value || 120)); });
    $('bars').addEventListener('change', (e) => { recorder.bars = Math.max(1, Math.min(32, +e.target.value || 4)); });
    $('quantize').addEventListener('change', (e) => { recorder.quantize = +e.target.value; });

    $('octUp').addEventListener('click', () => shiftOctave(1));
    $('octDown').addEventListener('click', () => shiftOctave(-1));

    $('sustainBtn').addEventListener('mousedown', () => { setSustain(true); $('sustainBtn').classList.add('on'); });
    $('sustainBtn').addEventListener('mouseup', () => { setSustain(false); $('sustainBtn').classList.remove('on'); });
    $('sustainBtn').addEventListener('mouseleave', () => { if (state.sustain) { setSustain(false); $('sustainBtn').classList.remove('on'); } });

    $('exportBtn').addEventListener('click', exportMidi);
    $('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importMidi(e.target.files[0]); e.target.value = ''; });

    $('midiOut').addEventListener('change', (e) => {
      const v = e.target.value;
      state.activeOutput = v === '' ? null : state.midiOutputs[+v];
    });
    $('thruChk').addEventListener('change', (e) => { state.midiThru = e.target.checked; });

    // Instrument selectors (device + sequencer stay in sync via setInstrument)
    populateInstruments($('instrument'));
    $('instrument').value = engine.instrument;
    $('instrument').addEventListener('change', (e) => setInstrument(e.target.value));
    $('instPrev').addEventListener('click', () => stepInstrument(-1));
    $('instNext').addEventListener('click', () => stepInstrument(1));

    // Tabs
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    document.body.addEventListener('mousedown', () => engine.ensure(), { once: false });
  }

  function populateInstruments(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const list = AudioEngine.INSTRUMENTS;
    Object.keys(list).forEach((id) => {
      sel.innerHTML += `<option value="${id}">${list[id].name}</option>`;
    });
  }

  function setInstrument(id) {
    engine.setInstrument(id);
    const name = AudioEngine.INSTRUMENTS[id] ? AudioEngine.INSTRUMENTS[id].name : id;
    const a = $('instrument'), b = $('seqInstrument'), nm = $('instName');
    if (a) a.value = id;
    if (b) b.value = id;
    if (nm) nm.textContent = name;
    log('Instrument: ' + name);
  }

  function stepInstrument(dir) {
    const ids = Object.keys(AudioEngine.INSTRUMENTS);
    let i = ids.indexOf(engine.instrument);
    i = (i + dir + ids.length) % ids.length;
    setInstrument(ids[i]);
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    // Stop transports when leaving a tab to avoid two players at once
    if (name !== 'instrument') recorder.stop();
    if (name !== 'sequencer' && window.Sequencer) window.Sequencer.stop();
  }

  // ======================================================================
  // Init
  // ======================================================================
  // Shared API for the sequencer module (sequencer.js)
  window.MM = {
    engine,
    setInstrument,
    flashKey,
    flashPad: (i) => { if (padEls[i]) { padEls[i].classList.add('active'); setTimeout(() => padEls[i].classList.remove('active'), 100); } },
    padLabels: PAD_LABELS,
    padGM: PAD_GM,
    sendMidiOut: (b) => sendMidiOut(b),
    get midiThru() { return state.midiThru; },
    log,
    stopLoopMachine: () => recorder.stop()
  };

  function init() {
    buildKeyboard();
    buildPads();
    buildKnobs();
    wireControls();
    recorder.addTrack('Track 1');
    initMidi();
    if (window.Sequencer) window.Sequencer.init();
    setInstrument(engine.instrument); // sync name display + both dropdowns
    log('Ready. Tap/click anywhere to enable audio. Keys: A–; row plays notes, 1–8 trigger pads, Z/X shift octave, Space = play, R = record.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
