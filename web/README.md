# cs80v2 in the browser

A test build of the cs80v2 engine: the same headers as the ESP32 and host builds, compiled to WebAssembly and run in an AudioWorklet at 48 kHz.

- `src/cs80_wasm.cpp`: the C API (init, note on/off, pitch bend, CC through the Oxygen 49 or PM-80 map, channel and poly pressure, presets, `set_param`, per-field access, param blobs, render).
- `cs80-worklet.js`: loads the wasm inside the AudioWorkletProcessor and renders 128-frame blocks.
- `index.html`, `app.js`, `style.css`: the page. No framework, no build step.
- `perf.js`: the controller layer (Learn wizard, performance macros, pickup). No DOM, so node tests can drive it.
- `presets-scouted.json`: the earlier 95 sounds, translated and level-matched from `presets/presets.json`.
- `presets-library.json`: the public bank list, with the earlier sounds first and corrected Arturia translations after them (`tools/build_library.py`). The eight built-in Core sounds remain in their own bank.

Build and check:

    ../setup.sh                 # installs emsdk into ../toolchain/emsdk
    ./build.sh                  # -> cs80v2.wasm
    node tools/translate_presets.mjs
    python3 ../presets/arturia/translate.py --refresh-wasm
    python3 tools/build_library.py
    node tools/test_render.mjs  # add --parity FILE to compare with tools/parity.cpp
    node tools/test_perf.mjs    # controller layer -> worklet -> wasm, simulated CCs
    node tools/test_browser.mjs [URL] # headless Chromium, fake Web MIDI (SHOT=dir saves PNGs)

Deploy: the page is static. Serve `index.html`, `app.js`, `perf.js`, `style.css`, `cs80-worklet.js`, `cs80v2.wasm` and `presets-library.json` from one directory over HTTPS (or localhost), with `.wasm` served as `application/wasm`. The public copy is at https://leblancfg.com/cs80/.

## Translating presets.json

Each panel field goes through the engine's `apply_param()` where the scales agree. The exceptions, all interpretations:

- Saw, square and noise keep their relative levels. Their maximum sets VCF level (0.75 x level); sine level is 0.75 x sine. The source-to-engine gain curves remain an approximation.
- Envelope times use 10 ms to 3 s (attack), 8 s (decay) and 10 s (release) on a log scale, because the panel curves put the source's slow pads under 0.3 s. IL and AL use 3 octaves at full travel.
- Per-channel brilliance and keyboard level/brilliance are averaged into cs80v2's global controls (no preset in presets.json sets them differently).

Every remaining simplification is listed in `../docs/limitations.md`.
- Detune is read as an amount: 1.0 = 25 cents on channel II.
- Touch: the dynamics floor (Level) is 1 - 0.5 x (initial amp + after amp), clamped to 0.2 .. 1.
- Sub osc to PWM moves to the channel PWM LFOs; sub osc to ring mod sets the ring mod speed. Neither route exists in cs80v2.
- Ring mod "depth" is the Mod amount; the envelope-to-speed depth is 0.
- Level matching: master is scaled so the loudest 100 ms of a four-note chord matches the Core bank's median. Seven plucks hit master = 1 and stay 1 to 7 dB quieter.

## The page

The window has three fixed parts. The header holds Start audio, the MIDI input, "Set up my controller" and the Advanced drop-down. The middle is the preset list on the left with Copy settings / Load settings, and the full CS-80 panel filling the rest. The bottom strip spans the full width down to the window edge, with two tabs: Keyboard and Controls (the hardware legend). Advanced is collapsed and holds only technical tools: the fixed CC maps (Oxygen firmware, PM-80), Assign, the last MIDI message, on-screen bend/mod/aftertouch/sustain, Stop all notes, the CPU meter with sample rate and latency, and the translation notes for the current preset.

### The faceplate

Every panel control is on screen at once, drawn in HTML/CSS as a CS-80 faceplate: black panel, engraved small-caps labels, long vertical levers with coloured caps, grouped in bracketed sections.

- Left block: Sub oscillator (Function lever with six detents, Speed, VCO, VCF, VCA) and Ring modulator (Attack, Decay, Depth, Speed, Mod); below them Chorus / tremolo (on/off rockers, speed, depth), Brilliance (Mix, Brilliance, Resonance) and Volume (the post-effects level that knob 8 drives).
- Channel I and Channel II rows, each in panel order: VCO (Speed, PWM, PW, Square, Saw, Noise), VCF (HPF, Res, LPF, Res, IL, AL, A, D, R, plus our Invert rocker), VCA (VCF level, Sine, A, D, S, R, Level), Touch response (initial and after brilliance and level).
- Performance strip: Feet I and II (detented levers) and Detune, Touch response (pitch bend, after-touch sub speed, VCO, VCF, AT mode), Keyboard control (brilliance and level, low and high), Sustain / portamento.
- Extras, in a dashed cyan box with cyan caps because the CS-80 has none of them: Echo, Reverb, and Master (pan spread, drift, bend range, master level).

Square and Saw are continuous 0 to 1 levels, so they are levers with heavy ticks at 0 and 1 (the original has on/off rocker tabs there). Real booleans (chorus, tremolo, glissando, filter invert) are rocker tabs.

Using the levers: drag (grab the cap to move it relative to where it is, or click the slot to jump; Shift for fine moves), scroll wheel (1% per notch, Shift 0.2%), arrow keys / Page Up / Page Down / Home / End once focused with Tab, double-click to reset it to the preset as loaded. A tooltip shows the value. A lever that a learned hardware control moves (directly or through a macro such as Cutoff) lights up yellow. Double-clicking a label starts Assign for that control.

The faceplate is laid out at its natural size and zoomed to fit the space above the bottom strip (it fits 1440x900 at about 0.75), with longer levers when there is spare height. Below about 62% zoom, the rows wrap instead and the panel scrolls vertically.

Reference for section order, labels and cap colours:

- Photo of a CS-80 panel, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Yamaha_CS-80.jpg (cap colours per section: white speeds, green PWM/PW, HPF, LPF and brilliance, red resonance, black IL/AL/A/D and switches, yellow release, grey levels; no blue levers on the original, blue and other colours are the tone selector buttons).
- Panel diagrams in Reverb Machine, "Exploring the Yamaha CS-80": https://reverbmachine.com/blog/exploring-the-yamaha-cs-80/ (VCO, VCA, ring modulator, touch response and performance sections with their labels and scale legends such as FAST/SLOW and LONG/SHORT).
- Control lists and order from `../docs/cs80-architecture.md` (Arturia, Cherry Audio GX-80).

Deviations: the left block mixes the left-hand panel and the lower performance strip of the original to keep everything on one screen; the IL lever uses normal travel; Volume is a lever, not the original's round knob.

## MIDI controller: Learn and the performance map

The page drives the synth through performance macros, not raw CC numbers. It learns which CC, Mackie fader (pitch bend) or note each physical control sends, and on which input, then maps each control to a macro. Details, the default map and the reasoning are in `../docs/midi-map.md`.

- **Set up my controller** (header button; also offered on the first MIDI connect without a saved layout) is a five-step guide with Back, Skip and Next. Each step checks live MIDI and shows green checks or red crosses: (1) DAW mode with profile N2, or Preset mode preset 9 (turn a knob: a plain CC passes, a Mackie V-pot fails); (2) the USB MIDI input, not the Mackie one (press a key: shows its channel); (3) pads on channel 10 (hit a pad, then a key: they must differ by channel or input; "Skip pads" leaves pads as notes); (4) Learn; (5) the learned map. Other controllers get generic text. The MKV guide documents no factory reset, so the guide never suggests one.
- **Learn controller** (Controls tab): one key press first, to record the keybed's channel and input, then sliders, knobs, pads, the optional buttons under the sliders, then optional transport buttons. On an Oxygen MKV, Learn asks for eight of those buttons and says why: the button under slider 9 is hard-wired to DAW BUTTON MODE and sends nothing usable. Other controllers get all nine. "Skip all pads" (or sliders, knobs, buttons) skips a group. Learn listens to every input, DAW ports included. Fader touch notes and SysEx are ignored. CCs that send relative ticks (Mackie V-pots, or values near 1/127 or 63/65) are detected and accumulate 1% per tick.
- **Keys are never hijacked.** A learned pad or button note fires only if it differs from the keybed by channel or input. A pad on the keybed's channel stops Learn with a one-sentence explanation and two ways out: Skip pads, or move the pads to channel 10 (exact Oxygen steps shown), after which the next pad hit is detected by itself. "Use anyway" binds a shared note only after a confirmation and marks it `shared`. The guard runs on every note at runtime, so old saved layouts and imported files (which lose `shared`) cannot take keys.
- **Controls tab**: what each control does; click a row to change it. Save to file / Load from file move the layout, map changes and favourites as JSON. **Reset controller setup** wipes the saved layout, map, favourites and control mode from localStorage and puts the page back to defaults.
- **Ports**: notes, wheels and pressure play only from the selected music input. Inputs named like "Mackie", "DAW" or "HUI" are DAW-control ports: they never play notes (no doubled notes), but learned controls work from them whatever input is selected.
- **Macros are relative.** When a preset loads, every macro picks up where its control sits, so that position means "the preset's own value". Moving away scales the travel left on each side over the macro's full range (at least a quarter of the travel per side, so a control parked near an end does not jump).
- **Volume** (knob 8) is absolute: a post-effects gain in the worklet with an audio taper. At 0 it is silent, echo and reverb tails included.
- **Aftertouch** (slider 9) sends channel pressure, re-sent after each new note. The Oxygen MKV has no aftertouch, and the CS-80's touch expression depends on it.
- **Reset preset** puts every panel control back to the loaded preset's stored values and discards live tweaks. Held notes keep playing, and macros pick up where their controls sit, so nothing jumps on the next move. Three ways: the Reset preset button beside the preset name (top of the preset list), a double-click on the name, or the Loop transport button (default map; Loop was free, pads 1 to 8 all have jobs and Stop is Stop all notes). Any learned button or pad can take it from the Controls tab or Assign.
- **Favourites**: pads 5 to 8 and the four buttons in the Controls tab. Shift-click or long-press a button to store the current preset.
- Advanced still offers the fixed CC maps (`oxygen49_map()` on CCs 20-28 and 102-109, and the proposed PM-80 map) for keyboards programmed to those numbers.
