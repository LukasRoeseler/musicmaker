# MusicMaker — Virtual AKAI MPK mini Play MK3

A browser-based recreation of the **AKAI Professional MPK mini Play MK3**: a 25-key
synth keyboard, 8 drum pads, and 8 assignable knobs — plus a **loop machine**,
**MIDI file import/export**, and full **Web MIDI** support so it works with real
MIDI hardware on desktop and on phones.

No build step, no dependencies — just static files.

## Features

- **Two tabs:** **🎹 Instrument** (the live controller + loop machine) and **🎼 Sequencer** (a piano-roll "DAW lite" for writing music).
- **25-key keyboard** — play with mouse/touch, your computer keyboard, or a MIDI device.
- **Instrument sounds** — choose from **Grand Piano** (default, additive-synthesis piano with hammer attack and inharmonic partials), Electric Piano, Organ, Accordion, Harmonica, Strings, and Synth Lead.
- **8 drum pads** — synthesized kick, snare, hats, clap, toms, crash. Trigger with keys `1`–`8` or MIDI channel 10.
- **8 knobs** — filter cutoff/resonance, attack/release, reverb, delay, vibrato (mod wheel), volume. Drag, scroll, or send MIDI CC (1, 7, 70–93).
- **Loop machine** — multi-track recorder with tempo, bars, metronome, quantize, mute, and a moving playhead. Layer tracks to build a groove.
- **Sequencer (piano roll)** — click to draw notes, drag a note's right edge to lengthen, click a note to delete; a separate 8-pad drum-step grid; selectable bars and grid resolution (1/4–1/16); play/loop with a moving playhead; export the sequence to MIDI.
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
