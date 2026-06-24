# MIDI Maker and Loop Machine

A browser-based MIDI workstation: a 25-key synth keyboard, 8 drum pads, and 8
assignable knobs — plus a **loop machine**, a **piano-roll sequencer**, an
**arpeggiator**, **MIDI file import/export**, and full **Web MIDI** support so it
works with real MIDI hardware on desktop and on phones.

No build step, no dependencies — just static files.

## Features

- **Two tabs:** **🎹 Instrument** (the live controller + loop machine) and **🎼 Sequencer** (a piano-roll "DAW lite" for writing music).
- **25-key keyboard** — play with mouse/touch, your computer keyboard, or a MIDI device.
- **15 instrument sounds** — pianos (additive synthesis with hammer attack + inharmonic partials), Electric Piano, Organ, Accordion, Harmonica, Strings, Synth Lead; **guitars** via Karplus-Strong physical modelling (Acoustic, Electric, Rock w/ distortion, Post-Rock w/ tremolo); and **sci-fi / math-rock** synths (Sci-Fi Pad, Hyperspace Lead, Warp Bass, Crystal Bells).
- **8 drum pads with switchable kits** — Real Drums (default, layered/realistic), Acoustic, 808, 909, Lo-Fi. Trigger with keys `1`–`8` or MIDI channel 10.
- **Arpeggiator / note-repeat** — independent for keys and pads, with Up / Down / Up-Down / Random / As-Played / Chord (pads: + All) modes, tempo-synced rate. Recordable into the loop machine.
- **Loop machine on top** — always visible above the Instrument/Sequencer tabs; records keys, pads, MIDI and arpeggios. **⤴ Send to Loop** copies a sequence in as tracks.
- **Dry by default** — reverb and delay start at 0 and are never applied to drums.
- **Themes** — Dark, Light, Retro, Futuristic (remembered via localStorage).
- **8 knobs** — filter cutoff/resonance, attack/release, reverb, delay, vibrato (mod wheel), volume. Drag, scroll, or send MIDI CC (1, 7, 70–93).
- **Loop machine** — multi-track recorder with tempo, bars, metronome, quantize, mute, and a moving playhead. Layer tracks to build a groove.
- **Sequencer (piano roll)** — click to draw notes, drag a note's right edge to lengthen, click a note to delete; a separate 8-pad drum-step grid with a **🎲 Randomize** button; selectable bars and grid resolution (1/4–1/16); play/loop with a moving playhead; export the sequence to MIDI.
- **MIDI import** — load a `.mid` file; notes go to a melodic track, drum channel maps to the pads.
- **MIDI export** — save your loop as a Standard MIDI File.
- **Web MIDI I/O** — pick an input and output; enable **MIDI Thru** to drive external gear.
- **Works on phones** — responsive layout; connect a MIDI controller via USB/Bluetooth in a Web MIDI–capable browser (Chrome on Android).

## Keyboard shortcuts

| Action | Keys |
|--------|------|
| Play notes | `A W S E D F T G Y H U J K O L P ;` |
| Trigger pads | `1` – `8` |
| Octave down / up | `Z` / `X` |
| Play / Stop loop | `Space` |
| Arm / disarm record | `R` |

## Run locally

Because browsers restrict `file://` access, serve the folder over HTTP:

```bash
cd musicmaker
python -m http.server 8000
# open http://localhost:8000
```

Web MIDI requires a **secure context** (`https://` or `localhost`).

## Host on GitHub Pages

1. Create a repository and put these files in it (either at the repo root or in a
   `musicmaker/` subfolder).
2. Commit and push:
   ```bash
   git add .
   git commit -m "Add MusicMaker virtual MPK mini"
   git push
   ```
3. On GitHub: **Settings → Pages → Build and deployment**, set **Source =
   "Deploy from a branch"**, choose your branch (e.g. `main`) and folder
   (`/root` or `/docs`), then save.
4. Your app appears at `https://<username>.github.io/<repo>/`
   (append `/musicmaker/` if the files live in that subfolder).

GitHub Pages serves over HTTPS, so Web MIDI works out of the box.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout & structure |
| `style.css` | Styling / device look |
| `audio.js` | Web Audio instrument engine (piano/organ/…) + drum synth |
| `midifile.js` | Standard MIDI File parser & writer |
| `sequencer.js` | Piano-roll + drum-grid sequencer |
| `app.js` | Controller, MIDI I/O, loop machine, import/export, tabs |

## Browser support

Best in **Chrome / Edge** (desktop and Android) for full Web MIDI. Audio,
keyboard, and the loop machine work in any modern browser; only live MIDI
device I/O depends on Web MIDI (not available in Safari/iOS).
