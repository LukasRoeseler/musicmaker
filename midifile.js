/* midifile.js — Standard MIDI File (SMF) parser & writer (format 0/1)
 * No dependencies. Exposes window.MidiFile = { parse, build }.
 *
 * parse(arrayBuffer) -> {
 *   format, ticksPerBeat,
 *   tempo,                       // microseconds per quarter note (first found, default 500000)
 *   tracks: [ { name, events: [ {tick, type, ...} ] } ],
 *   notes: [ {note, velocity, startTick, endTick, channel, track} ]  // flattened, merged on/off
 * }
 *
 * build({ ticksPerBeat, tempo, tracks }) -> Uint8Array
 *   tracks: [ { name?, events: [ {tick, type:'noteOn'|'noteOff'|'cc', ...} ] } ]
 */
(function () {
  'use strict';

  // ---------- Reader ----------
  function Reader(buf) {
    this.dv = new DataView(buf);
    this.pos = 0;
  }
  Reader.prototype.u8 = function () { return this.dv.getUint8(this.pos++); };
  Reader.prototype.u16 = function () { const v = this.dv.getUint16(this.pos); this.pos += 2; return v; };
  Reader.prototype.u32 = function () { const v = this.dv.getUint32(this.pos); this.pos += 4; return v; };
  Reader.prototype.str = function (n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  };
  Reader.prototype.bytes = function (n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u8();
    return out;
  };
  Reader.prototype.varint = function () {
    let value = 0, byte;
    do {
      byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value >>> 0;
  };

  function parse(buffer) {
    const r = new Reader(buffer);
    if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd)');
    r.u32(); // header length (6)
    const format = r.u16();
    const numTracks = r.u16();
    const division = r.u16();
    const ticksPerBeat = division & 0x8000 ? 480 : division; // SMPTE not fully handled -> fallback

    const tracks = [];
    let tempo = 500000;
    let tempoFound = false;

    for (let t = 0; t < numTracks; t++) {
      if (r.str(4) !== 'MTrk') throw new Error('Expected MTrk');
      const len = r.u32();
      const end = r.pos + len;
      let tick = 0;
      let runningStatus = 0;
      const events = [];
      let trackName = '';

      while (r.pos < end) {
        tick += r.varint();
        let status = r.u8();
        if (status < 0x80) { // running status
          r.pos--;
          status = runningStatus;
        } else {
          runningStatus = status;
        }
        const type = status & 0xf0;
        const channel = status & 0x0f;

        if (status === 0xff) { // meta
          const metaType = r.u8();
          const dlen = r.varint();
          const data = r.bytes(dlen);
          if (metaType === 0x51 && dlen === 3) {
            tempo = (data[0] << 16) | (data[1] << 8) | data[2];
            tempoFound = true;
            events.push({ tick, type: 'tempo', tempo });
          } else if (metaType === 0x03) {
            trackName = String.fromCharCode.apply(null, data);
          } else if (metaType === 0x2f) {
            events.push({ tick, type: 'endOfTrack' });
          }
        } else if (status === 0xf0 || status === 0xf7) { // sysex
          const dlen = r.varint();
          r.bytes(dlen);
        } else {
          switch (type) {
            case 0x80: { // note off
              const note = r.u8(), vel = r.u8();
              events.push({ tick, type: 'noteOff', note, velocity: vel, channel });
              break;
            }
            case 0x90: { // note on
              const note = r.u8(), vel = r.u8();
              events.push({ tick, type: vel === 0 ? 'noteOff' : 'noteOn', note, velocity: vel, channel });
              break;
            }
            case 0xa0: r.u8(); r.u8(); break; // aftertouch
            case 0xb0: { // cc
              const ctrl = r.u8(), val = r.u8();
              events.push({ tick, type: 'cc', controller: ctrl, value: val, channel });
              break;
            }
            case 0xc0: r.u8(); break; // program change
            case 0xd0: r.u8(); break; // channel pressure
            case 0xe0: r.u8(); r.u8(); break; // pitch bend
            default: r.u8(); break;
          }
        }
      }
      r.pos = end;
      tracks.push({ name: trackName, events });
    }

    // Flatten notes (merge note on/off across all tracks)
    const notes = [];
    tracks.forEach((track, ti) => {
      const open = {}; // key: channel*128+note -> {startTick, velocity}
      track.events.forEach((ev) => {
        if (ev.type === 'noteOn') {
          open[ev.channel * 128 + ev.note] = { startTick: ev.tick, velocity: ev.velocity };
        } else if (ev.type === 'noteOff') {
          const key = ev.channel * 128 + ev.note;
          const o = open[key];
          if (o) {
            notes.push({ note: ev.note, velocity: o.velocity, startTick: o.startTick, endTick: ev.tick, channel: ev.channel, track: ti });
            delete open[key];
          }
        }
      });
    });
    notes.sort((a, b) => a.startTick - b.startTick);

    return { format, ticksPerBeat, tempo: tempoFound ? tempo : 500000, tracks, notes };
  }

  // ---------- Writer ----------
  function writeVarint(value) {
    const bytes = [];
    let buffer = value & 0x7f;
    while ((value >>= 7)) {
      buffer <<= 8;
      buffer |= ((value & 0x7f) | 0x80);
    }
    while (true) {
      bytes.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    return bytes;
  }

  function build(opts) {
    const ticksPerBeat = opts.ticksPerBeat || 480;
    const tempo = opts.tempo || 500000;
    const tracksIn = opts.tracks || [];

    function pushU16(arr, v) { arr.push((v >> 8) & 0xff, v & 0xff); }
    function pushU32(arr, v) { arr.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff); }

    const header = [];
    header.push(0x4d, 0x54, 0x68, 0x64); // MThd
    pushU32(header, 6);
    pushU16(header, 1); // format 1
    pushU16(header, tracksIn.length + 1); // +1 tempo track
    pushU16(header, ticksPerBeat);

    const chunks = [header];

    // Tempo / conductor track
    {
      const body = [];
      // tempo meta at tick 0
      body.push(...writeVarint(0), 0xff, 0x51, 0x03,
        (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
      // time signature 4/4
      body.push(...writeVarint(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);
      body.push(...writeVarint(0), 0xff, 0x2f, 0x00); // end
      const trk = [0x4d, 0x54, 0x72, 0x6b];
      pushU32(trk, body.length);
      chunks.push(trk.concat(body));
    }

    // Music tracks
    tracksIn.forEach((track) => {
      const evs = (track.events || []).slice().sort((a, b) => a.tick - b.tick);
      const body = [];
      if (track.name) {
        const nm = track.name;
        body.push(...writeVarint(0), 0xff, 0x03, ...writeVarint(nm.length));
        for (let i = 0; i < nm.length; i++) body.push(nm.charCodeAt(i) & 0x7f);
      }
      let last = 0;
      evs.forEach((ev) => {
        const delta = ev.tick - last;
        last = ev.tick;
        const ch = (ev.channel || 0) & 0x0f;
        if (ev.type === 'noteOn') {
          body.push(...writeVarint(delta), 0x90 | ch, ev.note & 0x7f, (ev.velocity == null ? 100 : ev.velocity) & 0x7f);
        } else if (ev.type === 'noteOff') {
          body.push(...writeVarint(delta), 0x80 | ch, ev.note & 0x7f, (ev.velocity || 0) & 0x7f);
        } else if (ev.type === 'cc') {
          body.push(...writeVarint(delta), 0xb0 | ch, ev.controller & 0x7f, ev.value & 0x7f);
        } else if (ev.type === 'program') {
          body.push(...writeVarint(delta), 0xc0 | ch, ev.program & 0x7f);
        }
      });
      body.push(...writeVarint(0), 0xff, 0x2f, 0x00);
      const trk = [0x4d, 0x54, 0x72, 0x6b];
      pushU32(trk, body.length);
      chunks.push(trk.concat(body));
    });

    // Flatten to Uint8Array
    let total = 0;
    chunks.forEach((c) => (total += c.length));
    const out = new Uint8Array(total);
    let off = 0;
    chunks.forEach((c) => { out.set(c, off); off += c.length; });
    return out;
  }

  window.MidiFile = { parse, build };
})();
