/* sequencer.js — a lightweight piano-roll + drum-grid "DAW lite".
 * Uses the shared engine via window.MM. Exposes window.Sequencer.
 */
(function () {
  'use strict';

  const CELL_W = 26;   // px per step
  const ROW_H = 14;    // px per semitone row
  const TOP_NOTE = 84; // C6 at the top
  const BOT_NOTE = 36; // C2 at the bottom
  const ROWS = TOP_NOTE - BOT_NOTE + 1;
  const WHITE_SET = [0, 2, 4, 5, 7, 9, 11];

  const $ = (id) => document.getElementById(id);

  const seq = {
    bpm: 120,
    bars: 2,
    beatsPerBar: 4,
    stepsPerBeat: 4,         // 4 = 1/16
    notes: [],               // {pitch, start, len}  (steps)
    drums: [],               // drums[pad][step] = bool
    playing: false,
    startTime: 0,
    lastPos: 0,
    timer: null,
    events: [],
    velocity: 100,
    grid: null, drumGrid: null, playhead: null, drumPlayhead: null
  };

  function steps() { return seq.bars * seq.beatsPerBar * seq.stepsPerBeat; }
  function secPerStep() { return (60 / seq.bpm) / seq.stepsPerBeat; }
  function loopLen() { return steps() * secPerStep(); }
  function gridWidth() { return steps() * CELL_W; }

  // ---------------- Build DOM ----------------
  function init() {
    buildToolbar();
    rebuild();
    // start scrolled to ~C4
    const body = $('seqRollBody');
    if (body) body.scrollTop = (TOP_NOTE - 64) * ROW_H - 60;
  }

  function buildToolbar() {
    $('seqPlay').addEventListener('click', togglePlay);
    $('seqClear').addEventListener('click', () => {
      seq.notes = []; resetDrums(); renderNotes(); renderDrums();
    });
    $('seqExport').addEventListener('click', exportMidi);
    $('seqRandom').addEventListener('click', randomizeDrums);
    $('seqToLoop').addEventListener('click', sendToLoop);

    const bpmEl = $('seqBpm'); bpmEl.value = seq.bpm;
    bpmEl.addEventListener('change', (e) => { seq.bpm = Math.max(40, Math.min(300, +e.target.value || 120)); });

    const barsEl = $('seqBars'); barsEl.value = seq.bars;
    barsEl.addEventListener('change', (e) => { seq.bars = Math.max(1, Math.min(8, +e.target.value || 2)); rebuild(); });

    const resEl = $('seqRes');
    resEl.addEventListener('change', (e) => { seq.stepsPerBeat = +e.target.value; clampNotes(); rebuild(); });

    // instrument select synced through MM.setInstrument
    const inst = $('seqInstrument');
    const list = window.MM.engine.constructor.INSTRUMENTS;
    inst.innerHTML = '';
    Object.keys(list).forEach((id) => { inst.innerHTML += `<option value="${id}">${list[id].name}</option>`; });
    inst.value = window.MM.engine.instrument;
    inst.addEventListener('change', (e) => window.MM.setInstrument(e.target.value));
  }

  function resetDrums() {
    seq.drums = [];
    for (let p = 0; p < 8; p++) seq.drums[p] = new Array(steps()).fill(false);
  }
  function clampNotes() {
    const n = steps();
    seq.notes = seq.notes.filter((nt) => nt.start < n);
    seq.notes.forEach((nt) => { if (nt.start + nt.len > n) nt.len = Math.max(1, n - nt.start); });
  }

  function rebuild() {
    if (!seq.drums.length || seq.drums[0].length !== steps()) {
      const old = seq.drums;
      resetDrums();
      // preserve overlapping drum hits
      for (let p = 0; p < 8; p++) {
        if (old[p]) for (let s = 0; s < Math.min(old[p].length, steps()); s++) seq.drums[p][s] = old[p][s];
      }
    }
    buildRoll();
    buildDrumGrid();
    renderNotes();
    renderDrums();
  }

  function buildRoll() {
    const body = $('seqRollBody');
    body.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'roll-inner';

    // left key gutter
    const keys = document.createElement('div');
    keys.className = 'roll-keys';
    keys.style.height = (ROWS * ROW_H) + 'px';
    for (let i = 0; i < ROWS; i++) {
      const note = TOP_NOTE - i;
      const k = document.createElement('div');
      const isWhite = WHITE_SET.indexOf(((note % 12) + 12) % 12) !== -1;
      k.className = 'roll-key ' + (isWhite ? 'w' : 'b');
      k.style.height = ROW_H + 'px';
      if (note % 12 === 0) k.textContent = window.MidiUtil.noteName(note);
      keys.appendChild(k);
    }

    // grid
    const grid = document.createElement('div');
    grid.className = 'roll-grid';
    grid.style.width = gridWidth() + 'px';
    grid.style.height = (ROWS * ROW_H) + 'px';
    // row stripes
    for (let i = 0; i < ROWS; i++) {
      const note = TOP_NOTE - i;
      const isWhite = WHITE_SET.indexOf(((note % 12) + 12) % 12) !== -1;
      const row = document.createElement('div');
      row.className = 'roll-row ' + (isWhite ? 'w' : 'b');
      row.style.height = ROW_H + 'px';
      grid.appendChild(row);
    }
    // vertical beat/bar lines overlay
    const vlines = document.createElement('div');
    vlines.className = 'roll-vlines';
    vlines.style.backgroundImage = buildVlineGradient();
    vlines.style.backgroundSize = CELL_W + 'px 100%';
    grid.appendChild(vlines);

    const ph = document.createElement('div');
    ph.className = 'roll-playhead';
    grid.appendChild(ph);
    seq.playhead = ph;

    grid.addEventListener('mousedown', onGridMouseDown);
    seq.grid = grid;

    inner.appendChild(keys);
    inner.appendChild(grid);
    body.appendChild(inner);
  }

  function buildVlineGradient() {
    // step lines every cell; brighter every beat; brightest every bar
    const beat = CELL_W * seq.stepsPerBeat;
    const bar = beat * seq.beatsPerBar;
    return [
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0 1px, transparent 1px ${bar}px)`,
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 1px, transparent 1px ${beat}px)`,
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${CELL_W}px)`
    ].join(',');
  }

  function buildDrumGrid() {
    const wrap = $('seqDrums');
    wrap.innerHTML = '';
    const labels = window.MM.padLabels;
    for (let p = 0; p < 8; p++) {
      const row = document.createElement('div');
      row.className = 'drum-row';
      const lab = document.createElement('div');
      lab.className = 'drum-label';
      lab.textContent = labels[p];
      row.appendChild(lab);
      const cells = document.createElement('div');
      cells.className = 'drum-cells';
      cells.style.width = gridWidth() + 'px';
      for (let s = 0; s < steps(); s++) {
        const c = document.createElement('div');
        c.className = 'drum-cell' + ((Math.floor(s / seq.stepsPerBeat)) % 2 === 0 ? ' beat-a' : ' beat-b');
        if (s % (seq.stepsPerBeat * seq.beatsPerBar) === 0) c.classList.add('bar');
        c.style.width = CELL_W + 'px';
        c.dataset.pad = p; c.dataset.step = s;
        c.addEventListener('mousedown', () => {
          seq.drums[p][s] = !seq.drums[p][s];
          c.classList.toggle('on', seq.drums[p][s]);
          if (seq.drums[p][s]) { window.MM.engine.triggerDrum(p, 115); window.MM.flashPad(p); }
          updateInfo();
        });
        cells.appendChild(c);
      }
      row.appendChild(cells);
      wrap.appendChild(row);
    }
    // drum playhead
    const ph = document.createElement('div');
    ph.className = 'drum-playhead';
    wrap.appendChild(ph);
    seq.drumPlayhead = ph;
  }

  // ---------------- Note editing ----------------
  function noteAt(pitch, step) {
    return seq.notes.find((n) => n.pitch === pitch && step >= n.start && step < n.start + n.len);
  }

  function onGridMouseDown(e) {
    window.MM.engine.ensure();
    const rect = seq.grid.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = Math.floor(x / CELL_W);
    const pitch = TOP_NOTE - Math.floor(y / ROW_H);
    if (step < 0 || step >= steps() || pitch < BOT_NOTE || pitch > TOP_NOTE) return;

    const existing = noteAt(pitch, step);
    if (existing) {
      const rightEdge = (existing.start + existing.len) * CELL_W;
      if (rightEdge - x <= 7) {
        startResize(existing, e);
      } else {
        seq.notes = seq.notes.filter((n) => n !== existing);
        renderNotes();
      }
      return;
    }

    // create
    const note = { pitch, start: step, len: 1 };
    seq.notes.push(note);
    renderNotes();
    previewNote(pitch);
    startResize(note, e, true);
  }

  function startResize(note, e, isNew) {
    const rect = seq.grid.getBoundingClientRect();
    const move = (ev) => {
      const x = ev.clientX - rect.left;
      const curStep = Math.floor(x / CELL_W);
      note.len = Math.max(1, Math.min(steps() - note.start, curStep - note.start + 1));
      renderNotes();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function previewNote(pitch) {
    window.MM.engine.noteOn(pitch, seq.velocity);
    setTimeout(() => window.MM.engine.noteOff(pitch), 180);
  }

  function renderNotes() {
    if (!seq.grid) return;
    seq.grid.querySelectorAll('.roll-note').forEach((n) => n.remove());
    seq.notes.forEach((n) => {
      const el = document.createElement('div');
      el.className = 'roll-note';
      el.style.left = (n.start * CELL_W) + 'px';
      el.style.width = (n.len * CELL_W - 1) + 'px';
      el.style.top = ((TOP_NOTE - n.pitch) * ROW_H) + 'px';
      el.style.height = (ROW_H - 1) + 'px';
      seq.grid.appendChild(el);
    });
    updateInfo();
  }
  function renderDrums() {
    const wrap = $('seqDrums');
    if (!wrap) return;
    wrap.querySelectorAll('.drum-cell').forEach((c) => {
      const on = seq.drums[+c.dataset.pad][+c.dataset.step];
      c.classList.toggle('on', !!on);
    });
    updateInfo();
  }
  function updateInfo() {
    const el = $('seqInfo');
    if (el) el.textContent = `${seq.notes.length} notes · ${drumCount()} hits · ${seq.bars} bars`;
  }
  function drumCount() {
    let c = 0; seq.drums.forEach((r) => r.forEach((v) => { if (v) c++; })); return c;
  }

  // ---------------- Randomize ----------------
  function randomizeDrums() {
    window.MM.engine.ensure();
    resetDrums();
    const sp = seq.stepsPerBeat;
    const total = steps();
    const half = Math.max(1, Math.floor(sp / 2));
    for (let s = 0; s < total; s++) {
      const beat = Math.floor(s / sp);
      const inBeat = s % sp;
      const downbeat = inBeat === 0;
      const backbeat = downbeat && (beat % 2 === 1);   // beats 2 & 4
      // Kick — strong on even downbeats, light syncopation elsewhere
      if (downbeat && beat % 2 === 0) { if (Math.random() < 0.92) seq.drums[0][s] = true; }
      else if (Math.random() < 0.12) seq.drums[0][s] = true;
      // Snare — backbeats
      if (backbeat) { if (Math.random() < 0.9) seq.drums[1][s] = true; }
      else if (downbeat && Math.random() < 0.05) seq.drums[1][s] = true;
      // Closed hat — steady 8ths with occasional extras
      if (s % half === 0) { if (Math.random() < 0.8) seq.drums[2][s] = true; }
      else if (Math.random() < 0.22) seq.drums[2][s] = true;
      // Open hat — offbeat colour
      if (inBeat === half && Math.random() < 0.18) seq.drums[3][s] = true;
      // Clap — reinforce some backbeats
      if (backbeat && Math.random() < 0.3) seq.drums[4][s] = true;
    }
    // Crash on the very first beat
    if (Math.random() < 0.6) seq.drums[7][0] = true;
    // Tom fill across the final beat
    if (Math.random() < 0.45) {
      const start = total - sp;
      for (let i = 0; i < sp; i++) if (Math.random() < 0.5) seq.drums[5 + (i % 2)][start + i] = true;
    }
    renderDrums();
    window.MM.log('Randomized drum pattern.');
  }

  // ---------------- Send to Loop Machine ----------------
  function sendToLoop() {
    const sps = secPerStep();
    window.MM.setLoopTempo(seq.bpm, seq.bars);  // match loop tempo/length to the sequence
    let added = 0;
    if (seq.notes.length) {
      const mel = [];
      seq.notes.forEach((n) => {
        mel.push({ time: n.start * sps, type: 'noteOn', note: n.pitch, velocity: seq.velocity });
        mel.push({ time: (n.start + n.len) * sps, type: 'noteOff', note: n.pitch, velocity: 0 });
      });
      window.MM.addLoopTrack('Seq notes', mel, window.MM.engine.instrument);
      added++;
    }
    const dr = [];
    for (let p = 0; p < 8; p++) for (let s = 0; s < steps(); s++) if (seq.drums[p][s]) dr.push({ time: s * sps, type: 'drum', padIndex: p, velocity: 115 });
    if (dr.length) { window.MM.addLoopTrack('Seq drums', dr, window.MM.engine.instrument); added++; }
    if (!added) { window.MM.log('Nothing to send — draw notes or drums first.'); return; }
    window.MM.log('Sent sequence to the Loop Machine (' + added + ' track' + (added > 1 ? 's' : '') + ').');
  }

  // ---------------- Playback ----------------
  function buildEvents() {
    const sps = secPerStep();
    const evs = [];
    seq.notes.forEach((n) => {
      evs.push({ t: n.start * sps, type: 'on', pitch: n.pitch });
      evs.push({ t: (n.start + n.len) * sps, type: 'off', pitch: n.pitch });
    });
    for (let p = 0; p < 8; p++) for (let s = 0; s < steps(); s++) if (seq.drums[p][s]) evs.push({ t: s * sps, type: 'drum', pad: p });
    evs.sort((a, b) => a.t - b.t);
    seq.events = evs;
  }

  function togglePlay() { seq.playing ? stop() : play(); }

  function play() {
    const eng = window.MM.engine;
    eng.ensure();
    window.MM.stopLoopMachine();
    buildEvents();
    seq.playing = true;
    seq.startTime = eng.ctx.currentTime;
    seq.lastPos = 0;
    seq.timer = setInterval(tick, 18);
    $('seqPlay').classList.add('on');
    $('seqPlay').textContent = '⏸ Stop';
  }

  function stop() {
    seq.playing = false;
    clearInterval(seq.timer);
    window.MM.engine.allNotesOff();
    $('seqPlay').classList.remove('on');
    $('seqPlay').textContent = '▶ Play';
    if (seq.playhead) seq.playhead.style.left = '0px';
    if (seq.drumPlayhead) seq.drumPlayhead.style.opacity = '0';
  }

  function tick() {
    const eng = window.MM.engine;
    const len = loopLen();
    const pos = (eng.ctx.currentTime - seq.startTime) % len;
    const from = seq.lastPos;

    if (seq.playhead) seq.playhead.style.left = (pos / len * gridWidth()) + 'px';
    if (seq.drumPlayhead) {
      seq.drumPlayhead.style.opacity = '1';
      const labelW = 60;
      seq.drumPlayhead.style.left = (labelW + pos / len * gridWidth()) + 'px';
    }

    const fireRange = (a, b) => {
      seq.events.forEach((ev) => { if (ev.t >= a && ev.t < b) fire(ev); });
    };
    if (pos < from) { fireRange(from, len + 0.0001); fireRange(0, pos); }
    else fireRange(from, pos);
    seq.lastPos = pos;
  }

  function fire(ev) {
    const eng = window.MM.engine;
    if (ev.type === 'on') { eng.noteOn(ev.pitch, seq.velocity); window.MM.flashKey(ev.pitch, true); if (window.MM.midiThru) window.MM.sendMidiOut([0x90, ev.pitch, seq.velocity]); }
    else if (ev.type === 'off') { eng.noteOff(ev.pitch); window.MM.flashKey(ev.pitch, false); if (window.MM.midiThru) window.MM.sendMidiOut([0x80, ev.pitch, 0]); }
    else if (ev.type === 'drum') { eng.triggerDrum(ev.pad, 115); window.MM.flashPad(ev.pad); }
  }

  // ---------------- MIDI export ----------------
  function exportMidi() {
    const tpb = 480;
    const tickPerStep = tpb / seq.stepsPerBeat;
    const noteTrack = { name: 'Sequence', events: [] };
    noteTrack.events.push({ tick: 0, type: 'program', program: window.MM.gmProgram(window.MM.engine.instrument), channel: 0 });
    seq.notes.forEach((n) => {
      noteTrack.events.push({ tick: Math.round(n.start * tickPerStep), type: 'noteOn', note: n.pitch, velocity: seq.velocity, channel: 0 });
      noteTrack.events.push({ tick: Math.round((n.start + n.len) * tickPerStep), type: 'noteOff', note: n.pitch, velocity: 0, channel: 0 });
    });
    const drumTrack = { name: 'Drums', events: [] };
    for (let p = 0; p < 8; p++) for (let s = 0; s < steps(); s++) if (seq.drums[p][s]) {
      const t = Math.round(s * tickPerStep);
      drumTrack.events.push({ tick: t, type: 'noteOn', note: window.MM.padGM[p], velocity: 115, channel: 9 });
      drumTrack.events.push({ tick: t + tickPerStep / 2, type: 'noteOff', note: window.MM.padGM[p], velocity: 0, channel: 9 });
    }
    const tracks = [];
    if (noteTrack.events.length) tracks.push(noteTrack);
    if (drumTrack.events.length) tracks.push(drumTrack);
    if (!tracks.length) { window.MM.log('Nothing to export — draw some notes first.'); return; }

    const bytes = MidiFile.build({ ticksPerBeat: tpb, tempo: Math.round((60 / seq.bpm) * 1e6), tracks });
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'musicmaker-sequence.mid'; a.click();
    URL.revokeObjectURL(url);
    window.MM.log('Exported sequence as MIDI.');
  }

  window.Sequencer = { init, stop, play: togglePlay };
})();
