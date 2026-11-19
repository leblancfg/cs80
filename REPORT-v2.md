# cs80v2: a fuller CS-80 for the ESP32-S3

cs80v2 is a new engine in `cs80v2/`. It keeps CS80-lite's design rules (float32, no heap, control-rate modulation, 32-sample ticks with per-sample ramps), but models the CS-80 far more completely. Each of the 16 voice-channels now has the IL/AL filter envelope on both filters, the impure sine, the three-part dynamics VCA, initial and after touch, and its own trimmed tolerances. On top of that come the global sub oscillator, ring modulator, tremolo/chorus, sustain, portamento, glissando and keyboard scaling, plus a stereo echo and a plate reverb.

The estimated ESP32-S3 load for 8 voices x 2 channels with chorus, echo and reverb at 48 kHz is 40 to 63% of both cores combined. Split across the cores, that is 42 to 67% on the busier one. It does not fit on one core in the pessimistic case. RAM use is 116 KB of internal SRAM and 256 KB of PSRAM.

Labels: **measured** means timed on fl1 or counted in the Xtensa disassembly; **estimated** means derived from a measurement plus a stated assumption. Nothing here ran on ESP32 hardware.

## 1. What the CS-80 is, briefly

The full write-up, with sources, is in `docs/cs80-architecture.md`. Two findings shaped the engine most. First, the filter envelope is relative: IL and AL sit below and above the cutoff slider, the decay returns to the cutoff, and the same envelope moves the HPF at about half the LPF's depth. Cherry Audio calls this "always be bandpassing" (GX-80 and Arturia manuals). Second, the ring modulator and the tremolo/chorus are global, on the mono mix; the chorus board is where the CS-80 becomes stereo (owner's manual; CS80 group archive).

## 2. PM-80 and MIDI

The PM-80 has no public CC map: it is in pre-order, ships "towards the end of 2026", its firmware will be open source, and GLT expects owners to MIDI-learn each fader. I transcribed the faceplate from GLT's image PDF and mapped it one fader at a time: channel I on CC 12 to 31 and 102 to 109, channel II on 41 to 60 and 110 to 117, the bottom row on 70 to 90 plus 2 to 5, 8 and 9, a shift layer on 91 to 95, 118 and 119, the ribbon as pitch bend and sustain on CC 64. The engine reads a 128-entry table, so adopting GLT's numbers later is a table edit. An Oxygen 49 map (9 faders, 8 knobs) is included. Details: `docs/midi-map.md`, `cs80v2/midimap.hpp`.

## 3. The engine

### Signal path, per voice-channel (16 per engine)

| Stage | Implementation | CS-80 feature |
|-|-|-|
| VCO | PolyBLEP saw, plus a PolyBLEP pulse built as the difference of two saws; noise from a per-voice xorshift | saw and square switches, noise level, PW from 50 to 90% |
| PWM | one sine LFO per channel, shared by the voices | VCO Speed, PWM |
| HPF | 12 dB TPT state-variable filter, resonant, coefficients ramped per sample | HPF, Res H |
| LPF | 12 dB TPT SVF with a soft-saturated input, coefficients ramped | LPF, Res L |
| Filter EG | RC envelope, A to AL, D to 0, R to -IL, in octaves around the cutoff; HPF at half depth; optional invert | IL, AL, A, D, R (INV comes from the GX-1 and PM-80) |
| Filter modifiers | Brilliance, key tracking (0.7 oct/oct, estimated), keyboard control low/high, initial and after brilliance, sub osc VCF, card tolerance | all of them, on both filters |
| Sine | parabolic sine plus 2nd and 3rd harmonics at about -40 dB, after the filters | Sine level |
| VCA | ADSR, times dynamics (Level + Initial Level x velocity + After Level x pressure), keyboard level, mix, sub osc VCA | VCF Level, Sine, A, D, S, R, touch response |

### Shared controls

Feet (16' to 2'), channel II detune, and the ribbon as pitch bend with separate up and down ranges. An initial-touch bend swoops up at a fixed 40 semitones per second. Each voice inherits the sub oscillator's phase at note-on, so aftertouch can speed it up for one key. Portamento and glissando are polyphonic, from the last note played. Sustain mode I adds an extra release while the pedal is down, mode II also cuts fading notes on a new note, and a MIDI hold mode is there for compatibility. Aftertouch has poly, mono and "last" modes. The ring modulator acts on the mid and side buses. A 7 Hz DC blocker stands in for the AC coupling; the saturated saw plus pulse mix is asymmetric and produced DC before I added it.

### Analogue feel

Each voice slot has a fixed pitch offset (up to ±2.5 cents), a cutoff offset (±0.08 octave), envelope time (±6%) and level (±5%), drawn once like trimmed voice cards. On top of that, each channel gets a slow random-walk pitch drift of about ±1.5 cents. The oscillators free-run and are never reset at note-on. These magnitudes are estimates; I found no measurements of a real CS-80. They are scaled by one `drift` control.

### Tremolo/chorus (OE2 model)

The mono mix goes into a 1024-sample line with two taps modulated in antiphase (±3 ms for chorus, ±0.6 ms for tremolo, around 5 ms), a 7 kHz one-pole low-pass and gentle saturation standing in for the bucket brigade, and L/R VCAs driven in antiphase (±50% tremolo, ±8% chorus). Both can be on, as in the Arturia model. The optional I/II pan spread, which the CS-80 lacks, travels as a side signal around the effect. The delay depths and BBD bandwidth are my estimates, not from a schematic.

### Changes from v1

| v1 (`cs80lite`) | v2 |
|-|-|
| Filter EG on the LPF only, IL to AL to 0, depth set separately | Relative IL/AL on both filters, HPF at half depth (the v1 gap) |
| No HPF envelope or modifiers | Every filter modifier moves both filters |
| Ring mod per voice | Global on the mix, with its AD speed envelope, as on the CS-80 |
| One vibrato LFO | 6-wave sub osc to pitch, filters and amp, with per-key aftertouch speed and depth |
| No portamento, keyboard scaling, initial bend, dynamics VCA, drift | All present |
| Chorus: two taps in quadrature | Antiphase BBD taps plus antiphase VCAs, chorus and tremolo ranges |
| No echo or reverb | Ping-pong echo (two ways) and a Dattorro plate |
| 5 soft-float divides per line per tick | Newton reciprocal on the FPU; `__divsf3` is gone from the per-line path (measured in the disassembly) |

I also found and fixed a bug while checking renders. Pass 1 never stored the oscillator phase back, so every oscillator restarted each tick and buzzed at 1.5 kHz. A small DC offset and a centroid that was too high gave it away.

## 4. Echo two ways, and why reverb cannot be voices

**(a) Delay line.** A stereo ping-pong line in Q14 int16, 65,536 samples per side (1.37 s at 48 kHz), with a one-pole damping filter in the feedback path. It uses 256 KB, which goes in PSRAM.

**(b) Echoes as replayed voices.** Each note-on schedules N replays at t + kT, at level fb^k, alternating pan, and k x 0.5 octave darker through the voice's own filter. The matching note-offs are scheduled when the source voice releases, so sustain-pedal timing carries over. Replays draw from a separate 24-voice pool, so they never steal from the 8 played voices. The cost is a fixed 512-entry event queue.

| | Delay line | Replayed voices |
|-|-|-|
| x86, per output sample (measured) | 8.9 ns, 20 cycles | 68 ns, 154 cycles per active echo voice |
| Cost in voice equivalents (measured) | 0.13 | 1.01 per echo voice (8, 16 and 24 echo voices cost 8.1, 16.2 and 24.3) |
| S3 instructions (measured, static) | 47 per sample | about 291 per sample per echo voice |
| S3 load (estimated) | 1.9 to 3.2% of a core, PSRAM cache misses included | 8.4 to 13.4% of a core per echo voice |
| 8-note chord, 3 repeats | same cost | 24 extra voices, 2 to 3.2 cores' worth: does not fit |
| RAM | 256 KB PSRAM | 420 B per echo voice plus 6 KB of queue, all SRAM |
| Repeats follow later ribbon moves, filter sweeps and pressure | yes, it records audio | no: it replays notes, so continuous gestures are lost (pitch bend applies live) |
| Per-repeat tone and pan, no quantisation | damping only, Q14 | free: each repeat is re-synthesised darker and panned |

**Verdict.** The delay line wins on CPU every time a played note produces more than about a quarter of an echo voice on average, which is almost always. Replayed voices win in two cases: a board without PSRAM, and sparse monophonic lines (1 or 2 repeats of a lead) where spare voices exist anyway. A sensible policy is to use replayed voices only while the echo pool has idle voices and the voice load is low, and otherwise use the line. Listen to the A/B in `padat-blade-runner-brass.mp3` (line) against `padat-blade-runner-brass-echovoices.mp3` (voices).

**Reverb as voices is not feasible.** A reverb needs echo density, not a few repeats. Schroeder's classic figure is over 1000 reflections per second, and later work puts it nearer 10,000 for smooth tails. A 2 s tail at 1000 per second means about 2000 overlapping copies of every note. Even 8 early reflections per note would turn an 8-note chord into 64 voices. A feedback delay network or allpass tank gets that density by circulating one signal: the echo count multiplies on each pass, for constant cost.

I implemented Dattorro's plate (JAES 1997): 4 input diffusers, a two-branch tank with modulated allpasses, the paper's 14 output taps and a DC blocker. It comes in four variants:

| Plate variant | x86 cycles/sample (measured) | S3 instr/sample (measured, static) | RAM |
|-|-|-|-|
| float, full rate | 143 | 390 + loop | 165 KB |
| Q14 int16, full rate | 229 | 534 + loop | 82 KB |
| float, tank at 24 kHz | 75 | 217 | 82 KB |
| Q14 int16, tank at 24 kHz | 123 | 289 | 41 KB |

The default is float storage at half rate, in internal SRAM. On both CPUs int16 costs more instructions than float, because of the convert and clamp, so int16 only pays off when SRAM is short. PSRAM would hold it easily, but the tank reads 26 streams. I estimate about 1.6 cache misses per output sample, roughly 240 cycles, so the tank stays in SRAM. The half-rate tank removes plate shimmer above about 10 kHz, which a CS-80 recording through a 1980 reverb rarely had.

## 5. Presets

These are reconstructions. The real tones are resistor networks with no published values, so I built them from documented recipes, mostly Reverb Machine's CS-80 articles, then checked them by spectrum and level. All are matched to -18 dBFS RMS on `test.mid`, with peaks at or below 0.8.

| # | Preset | Basis |
|-|-|-|
| 0 | Blade Runner Brass | Brass pair; IL/AL swell; after brilliance and level; aftertouch vibrato; initial bend; slow chorus; long plate |
| 1 | Chariots | Bright resonant brass, line II at 4', big plate |
| 2 | Strings 1+4 (Africa) | Mix 75% I, Brilliance down, Resonance up, light chorus (Toto IV recipe) |
| 3 | Strings 1+Brass 2 | 50/50, Brilliance -0.32, Resonance minimum, long I release, thick chorus ("Human Nature" recipe) |
| 4 | Organ 1+2 | One row up an octave, chorus plus tremolo ("Mr Crowley") |
| 5 | Funky Clav | Narrow pulse, AL pluck, velocity brilliance |
| 6 | Bass + Sub Saw | Line II only, sub osc saw-down at 2.85 Hz to the filters ("Wonderful Christmastime") |
| 7 | Blade Runner Pad | Slow PWM strings opening from below; slow ring mod "breathing"; echo; long plate |

A functional check on one C4 note (measured): the Blade Runner Brass centroid rises from 440 Hz to 870 Hz over the 0.3 s filter attack and then decays. Full aftertouch at 1 s brightens it by about 30% and lifts the level by about 6 dB. The clav plucks from 1500 Hz to 690 Hz in 100 ms.

## 6. Measurements

### x86 (measured)

fl1, GCC 14.2, `-O2 -ffast-math -fno-tree-vectorize`, under `./lim`, best of 3. One caveat: today the add-chain clock probe reads 1.2 to 1.35 GHz instead of v1's 2.27 GHz, but cs80lite's own benchmark reproduces its v1 wall times within 4% (489 to 508 ns against 487 ns for 8 voices). I therefore convert time to cycles at v1's 2.27 GHz, so the two reports are comparable. The raw data is in `results/v2/`.

| Case | ns/sample | Cycles/sample |
|-|-|-|
| 0 voices, effects off | 22.5 | 51 |
| 8 voices, effects off | 563 | 1278 |
| Per voice-sample (2 channels) | 67.6 | 153 (v1: 135) |
| of which control tick | 9.6 | 22 |
| Chorus/tremolo (isolated) | 14.1 | 32 |
| Echo line (isolated) | 8.9 | 20 |
| Ring mod | 5.2 | 12 |
| Plate, float, half rate (isolated) | 32.9 | 75 |
| 8 voices, all effects and ring | 623 | 1413, so 33x real time |
| test.mid, per preset | | 32 to 34x real time; with replayed-voice echo, 12.6x |

`-O3 -march=native` is no faster (158 cycles per voice-sample, within noise). The extra realism costs 13% over v1 per voice.

### ESP32-S3 instruction counts (measured, Espressif GCC 16.2, `-O2 -ffast-math`)

From `cs80v2/s3_kernel.S`, via `s3_count.sh`; the output is in `results/v2/s3_counts.txt`. All loops are zero-overhead `loop` bodies unless noted.

| Loop, per sample | Instructions | FP ops |
|-|-|-|
| Pass 1: oscillators, noise, HPF with coefficient ramps | 59 common path, 85 static (26 are PolyBLEP arms) | 56 static |
| Pass 2: saturated LPF, impure sine, two gain ramps | 73 | 46 |
| Mix to mid/side with DC blockers (global) | 19 | 10 |
| Ring mod (global) | 24 | 18 |
| Chorus/tremolo (global; branch loop) | 74 | 32 |
| Echo line (global) | 47 | 25 |
| Plate tank step, float (no branches) | 390 per tank sample, 217 per output sample at half rate | 61 |

There are no `__divsf3` calls left in the per-line control path. `expf` runs only at envelope stage changes. The audio path code is 10 KB, so it fits in IRAM.

### ESP32-S3 load (estimated)

I use the same two CPI calibration points as v1: 1.44 from Espressif's published biquad benchmark, and 2.3 from ESP32Synth's own reported voice cost. Instruction totals:

- **Per voice-sample: 291.** That is 2 x (59 + 73), plus 4.5 of call overhead, plus about 23 for the control tick. The control figure is estimated from its x86 share and its code size.
- **Effects per output sample: about 400.** Mix 19, ring 24, chorus 74, echo 47 plus 25 to 50 cycles of PSRAM misses, plate 217, and glue.

| | CPI 1.44 | CPI 2.3 |
|-|-|-|
| Cycles per voice-sample | 419 | 670 |
| 8 voices x 2 channels at 48 kHz | 161 M cycles/s | 257 M cycles/s |
| Chorus, echo, plate, ring | 29 M cycles/s | 47 M cycles/s |
| Total, as a share of both cores (480 M cycles/s) | 40% | 63% |
| Core 1: voices 0 to 4 | 42% | 67% |
| Core 0: voices 5 to 7, effects, MIDI | 37% | 60% |
| One core only | 79% | 127%: does not fit |
| Same, at 44.1 kHz, both cores | 37% | 58% |

### RAM map (measured from the S3 object file, except DMA)

| Item | Bytes | Where |
|-|-|-|
| Engine: 8 voices, 24 echo voices, 512-event queue, chorus line | 24,624 | SRAM |
| (Engine without replayed-voice echo) | about 9,000 | SRAM |
| Plate, float, half rate | 82,660 | SRAM (int16: 41,330) |
| Output blocks | 1,024 | SRAM |
| I2S DMA, 4 x 256 frames (estimated) | 8,192 | SRAM |
| Audio code | 10,000 | IRAM |
| Echo line, 2 x 64 K int16 | 262,144 | PSRAM |
| **Total** | **about 116 KB SRAM + 10 KB IRAM, 256 KB PSRAM** | of 512 KB SRAM and 8 MB PSRAM |

## 7. Listening files

All files are 192 kbps MP3 at 48 kHz, 0.62 to 0.74 MB each, in `out/v2/`. `test.mid` is v1's 22 s file. `pad_at.mid` is new (`make_midi2.py`): four slow chords in which single chord tones swell with poly aftertouch, one chord swelled by channel pressure, a slow lead with aftertouch vibrato, and a ribbon fall.

| File | Preset | MIDI |
|-|-|-|
| test-blade-runner-brass.mp3 | 0 | test.mid |
| test-blade-runner-pad.mp3 | 7 | test.mid |
| test-strings1-brass2.mp3 | 3 | test.mid |
| test-chariots.mp3 | 1 | test.mid |
| padat-blade-runner-brass.mp3 | 0, echo line | pad_at.mid |
| padat-blade-runner-brass-echovoices.mp3 | 0, replayed-voice echo | pad_at.mid |
| padat-blade-runner-pad.mp3 | 7 | pad_at.mid |

For A/B, v1's `out/js80p-brass.mp3` and `out/js80p-pad.mp3` play the same `test.mid`, so I did not re-render them. Measured with the same script (`analysis/v2_stats.py`):

| File | Spectral centroid | Side/mid |
|-|-|-|
| JS80P brass | 1189 Hz | 0.34 |
| Blade Runner Brass | 1516 Hz | 0.61 |
| Strings 1+Brass 2 | 1460 Hz | 0.52 |
| JS80P pad | 3395 Hz (with a DC offset of -0.031 in its file) | 0.19 |
| Blade Runner Pad | 1163 Hz | 0.75 |

Expect cs80v2 to sound darker and wider than JS80P. The width comes from the antiphase chorus plus the plate. If it sounds too wide, lower the chorus depth (CC 93) or the reverb mix (CC 88).

## 8. Corners still cut

- **Control rate.** Pitch, PWM and the filter targets update at 1.5 kHz, and the filter coefficients ramp linearly in between. This is inaudible for vibrato and envelopes, but sub-oscillator FM above about 100 Hz turns into steps. The ring mod and chorus LFOs are per sample or ramped.
- **No oversampling.** The saturated LPF and a resonant HPF near 19 kHz can alias a little on high notes.
- **Estimated rather than sourced:** the 5 V to 5-octave IL/AL scale, key tracking, BBD depths and bandwidth, tolerance magnitudes, the initial-bend speed, the ring-mod speed envelope depth (up to 6 octaves), and every preset value.
- **Not modelled:** the wah, BBD clock noise, the analogue memory panel, and the ribbon's touch-down-is-zero behaviour (left to the controller).
- **Replayed echoes** do not carry later pressure or filter gestures.

## 9. Verdict

The fullest CS-80 recreation here fits an ESP32-S3 N8R8 with both cores in use: an estimated 40 to 63% of the chip, 116 KB of SRAM and 256 KB of PSRAM. It does not fit on one core under the pessimistic CPI, so plan the dual-core split from day one: 5 voices on core 1, and 3 voices, effects and MIDI on core 0.

For echo, use the delay line. Replayed voices cost about one full voice per repeat per note, so they are for PSRAM-less boards and sparse leads. Reverb has to be a tank; a float Dattorro plate at half rate costs less than one voice.

The next step is the same as v1's, and it is ready: `cs80v2/esp32s3_bench/main/main.cpp` times each configuration on a real board and turns every estimate above into a measurement.

## Files

- `docs/cs80-architecture.md`, `docs/midi-map.md`
- `cs80v2/`: `cs80v2.hpp` (engine), `dsp.hpp` (math, chorus, echo, plate), `presets.hpp`, `midimap.hpp`, `host.cpp` (render, bench, sizes), `s3_kernel.cpp`, `s3_count.sh`, `s3_kernel.S`, `esp32s3_bench/`
- `make_midi2.py`, `pad_at.mid`, `make_mp3_v2.py`, `analysis/v2_stats.py`
- `results/v2/`: benchmarks and S3 counts; `out/v2/`: MP3s and both MIDI files

## 10. Continuous saw and pulse levels (November 2026)

The saw and square switches became 0..1 level sliders per channel, as on the CS-80. The PolyBLEP saw and pulse already share one phase accumulator, and the old switches were already gains (0 or 0.5) in the oscillator's multiply-add, so independent levels need no extra oscillator, table or voice. The new part is smoothing: a level that jumps would click.

I tried two placements and measured both against the switch version (commit fe7dea0), built and run the same way as section 6 (`./lim`, best of 3 interleaved runs, 3 s each, cycles at 2.27 GHz; raw output in `results/v2/sawlevels/`):

| Variant | Xtensa pass 1, common path per line-sample | x86 per voice-sample | x86 control tick per voice-sample |
|-|-|-|-|
| Switches (before) | 59 instr (85 static) | 153.0 cycles | 21.8 cycles |
| Per-sample ramps in the audio loop (tried, dropped) | 67 instr (93 static): 2 adds plus 6 FP spills, and the loop body outgrows the short `loop` form | 156.7 cycles (best of 3) | 22.2 cycles |
| **One-pole smoothing at the control tick (kept)** | **59 instr: render_p1 disassembly byte-identical to before** | **150.3 cycles** (noise: runs ranged 150 to 158 for both) | **22.3 cycles** |

The kept version smooths each level once per 32-sample control tick (coefficient 0.15, about 4 ms) and holds it constant inside the block. A slider moved over MIDI changes the level by at most 1/127 per message, far below a click; an instant on-screen jump is spread over about 6 ticks. `control_tick` grows from 1304 to 1329 static Xtensa instructions; spread over its 32 samples that is under 1 instruction per voice-sample, so the estimate in section 6 stays at about 291 instructions per voice-sample and the 40 to 63% dual-core load is unchanged. The per-sample ramp would have cost 16 more per voice-sample (+5.5%).

The translator now keeps each source preset's saw, square and noise levels relative to the loudest of the three and puts the overall level into VCF Level; all 95 presets were re-translated and re-level-matched (`web/tools/translate_presets.mjs`; the library regenerated byte-for-byte the same after the smoothing change). The eight Core presets keep their old sound because `true`/`false` become levels 1 and 0. `test_render.mjs` renders one patch at pulse levels 0, 0.25 and 1 and checks that 0.25 differs from both ends and sits closer to the saw-only sound.

Remaining differences from the CS-80 and from the preset library are in `docs/limitations.md`.

## 11. Output limiter and level re-targeting (November 2026)

Presets used to be level-matched so that their peaks stayed clear of full scale. A pluck or clav, whose attack peaks well above its body, ended up 5 to 10 dB quieter than a pad. The engine now has an output limiter after the effects (`OutLimiter` in `cs80v2/dsp.hpp`, called at the end of `Engine::process`). With that in place, every preset is matched on loudness instead.

**Design.** Block-rate gain plus a soft clip, ceiling -1 dBFS. Each 32-sample control block is already rendered when the limiter sees it. It takes the block's stereo peak; if that peak is above -1.5 dBFS, it ramps the gain down to bring the peak to -1.5 dBFS within the first 8 samples, so there is no lookahead and no added latency. It recovers over about 120 ms. The soft clip after it catches what the ramp misses: linear up to -3 dBFS, quadratic above, and it never passes -1 dBFS. One divide per block computes the target gain. When the block peak stays under -3 dBFS and the gain is back at 1, the stage only measures and returns, and the output is bit-identical (checked in `web/tools/test_render.mjs`).

**Cost on the ESP32-S3 (measured, static, Espressif GCC 16.2 `-O2 -ffast-math`, `cs80v2/s3_kernel.S`, function `OutLimiter::process<32>`, timed alone by `lim_block` in `s3_kernel.cpp`):**

| Path | Per stereo sample | Per 32-sample block | Total per output sample |
|-|-|-|-|
| Idle (peak under -3 dBFS, gain 1) | peak scan: 10 instructions, 6 FP | about 30 glue | **about 11 instructions** |
| Limiting or recovering | peak scan 10, gain ramp and clip 44 to 45 (22 per channel, 27 FP) | about 40 glue plus one `__divsf3` call (soft-float divide, est. 60 to 100 cycles) | **about 57 instructions plus 2 to 3 cycles** |

At the section 6 CPI points (1.44 and 2.3) and 48 kHz on a 240 MHz core, that is 0.3 to 0.5% of one core idle and 1.6 to 2.7% while limiting. Since the presets now run near the ceiling, budget the limiting figure: about 14% on top of the roughly 400 instructions per output sample for the effects, and well under one voice (about 291 per voice-sample). The dual-core estimate in section 9 goes from 40 to 63% to about 41 to 64% of the chip. `text` grows by 656 bytes plus 40 of literals, and the state is 16 bytes.

**Re-targeting.** All three preset sets now aim for the same chord test: C3 E3 G3 C4 at velocity 100, held 3 s. The level is RMS over the frames within 20 dB of the loudest, so a decaying pluck is judged on the part that sounds, and the target is -13 dBFS. The Core presets' `master` values in `cs80v2/presets.hpp` were set by measurement. `presets/arturia/translate.py` matches the Arturia library in two passes, the second making up for what the limiter took. `web/tools/translate_presets.mjs` follows the Core median for the public library. A preset is turned down only if a six-note low chord (D2 F3 A3 C4 E4 G4) at velocity 127 would hit the limiter at more than +10 dBFS, about 11.5 dB of gain reduction. That is as hard as the Core clav pushes it. The master default (the performance Volume) stays at 0 dB.

**Headroom, before and after** (`presets/arturia/tools/levels.py`, chord test, medians with ranges; peak6 is the six-note velocity-127 worst case at the output; before = commit 363abeb, no limiter):

| Set | RMS before | RMS after | Chord peak before | Chord peak after | Worst-case peak6 before | after | Limiter on the worst case, after |
|-|-|-|-|-|-|-|-|
| Core (8) | -19.8 dBFS (-24.7 to -18.8) | -13.0 (all) | -7.2 (-7.9 to -4.7) | -1.7 (-2.0 to -1.2) | -4.1 (-7.3 to -3.2) | -1.5 (max -1.0) | 3.8 dB (3.1 to 11.6) |
| Arturia library (104 before, 149 after) | -20.5 (-30.6 to -18.6) | -13.1 (-18.0 to -12.9) | -6.8 (-10.6 to -4.2) | -1.7 (-4.1 to -1.0) | -4.4 (-8.6 to -4.1) | -1.5 (max -1.0) | 4.1 dB (0 to 12.0) |
| Public library (95) | -19.7 (-36.6 to -17.7) | -13.0 (-24.7 to -10.1) | -7.8 (-12.1 to -4.0) | -1.8 (-5.5 to -1.2) | -5.2 (-11.3 to +1.2; 6 presets over -1 dBFS) | -1.6 (max -1.0; none over) | 2.8 dB (0 to 13.2) |

The median preset is about 7 dB louder, and the chord's crest factor stays about 11 dB: the limiter takes only the peaks. The quietest sounds gained the most. The Core clav went from -24.7 to -13.0 dBFS RMS. In the Arturia library, Bells and Plucks went from a median of -22.5 to -14.7 dBFS and Keys and Organs from -22.3 to -13.1. Before, six public presets clipped on the worst-case chord. Now nothing passes -1 dBFS. A few percussive Arturia patches (toms, snare, EvansPiano) stop 1 to 5 dB short of the target, because their chord test already drives the limiter.

**Meter.** The page header shows the output as heard, after the Volume: an RMS bar, a peak tick held for 1.2 s, both in dBFS, and a LIM tag that lights with the gain reduction whenever the limiter is working. The worklet posts it about 20 times per second from `cs80_lim_gain()`, the deepest reduction since the last read.

## 12. Arturia preset re-audit (November 2026)

François's listening test exposed a translation error: the Arturia V2 DETUNE word had been treated as a linear ±100-cent control without a V2 calibration. Among 768 source files, 206 mapped beyond 40 cents; 164 of those used both channels. The two-channel `Matrix_init` mapped to −20.7 cents. Arturia's V2 manual identifies this as channel-II tuning but does not publish its stored-value curve. The V4 Stereo Detune range is not evidence for V2's curve. Imported patches now retain the raw value and use neutral detune until V2 can be measured; far-from-centre two-channel patches are excluded from curated banks. Details and the raw 117-field distribution are in `presets/arturia/mapping.md` and `presets/arturia/field-distribution.md`.

Two other choices were removed: the translator added 12% reverb to every preset even though Arturia V2 has no reverb, and it cut original names to 31 characters. The public library now keeps the Arturia names, after the earlier 95 scouted sounds in each semantic bank; the eight Core sounds remain in their own bank. Selection also keeps snares and kicks out of Bells and Plucks and rejects near-instant-release pads.

The old level guard allowed a six-note stress chord about +10 dBFS before the limiter. In the first corrected 137-patch selection, 55 required more than 6 dB of gain reduction and 24 exceeded 9 dB. With a +4 dBFS pre-limiter guard, the final 128 Arturia patches have a median 4.3 dB reduction on that stress chord, a maximum 6.4 dB, and none above 9 dB. The quieter percussive sounds keep more of their attack. `presets/arturia/spot-audit.md` has measurements for two sounds per bank, and `audition/v3/` has four MP3s.

The rest of the V2-to-cs80v2 curves are still estimates, not an acoustic comparison with Arturia's plugin. “Faithful” in the data means no known route was omitted; it does not certify a sound match. The v0.1 release stays on hold until François listens.

## 13. Level and limiter, v0.1.1 (November 2026)

**What went wrong.** Played live, the library was too hot: raising any VCO's level slider usually meant pulling it back to about 60%, and the limiter often clipped audibly. The panel's level curves were not the cause. The VCF level, Sine and Level sliders are linear on the page, in the engine (`apply_param`) and in both translators, so they agree with each other. A log taper does not fit the hardware evidence better either: Yamaha's 22 preset tones from the owner's manual, played through channel I alone, spread by 11.2 dB (standard deviation) with linear sliders, 11.6 dB with x², and 12.3 dB with a 40 dB audio taper. The spread comes from the resonance-10 tones (Organ 1, Funky 1), not from the levels. The cause was the level budget set in section 11. The library builder put the chord test at -13 dBFS RMS, which with the chord's 12 dB crest factor already peaks at about -1 dBFS, and it allowed up to 8 dB of limiting on that chord (the guard `GR4_MAX`). Half the library was in the limiter at velocity 100 before anyone touched a slider. A harder chord, more notes or a raised slider went straight into a block-rate gain stage whose soft clip starts bending at -3 dBFS.

**Level.** The target is now -18.5 dBFS RMS: a brass chord peaks at -6.7 dBFS (median of the Brass bank) before the limiter. The limiter is a safety net, not part of the level: the chord test may peak at most -0.5 dBFS before it (under 1 dB of gain reduction, inside the soft knee), and the six-note velocity-127 stress chord at most +3 dBFS (+10 before). The Core masters in `cs80v2/presets.hpp` and the init patch moved by the same 5.5 dB; plucks and clavs that a guard holds lower stay the same distance below the target as before.

**Limiter.** `OutLimiter` in `cs80v2/dsp.hpp`, still at the end of `Engine::post`:

- stereo-linked gain computer with a 4 dB soft knee around a -1.05 dBFS ceiling (log2 from the exponent bits plus a quadratic, 0.03 dB error, so the output stays under -1 dBFS);
- 1.5 ms look-ahead (72 samples at 48 kHz, 71 of added latency): the gain is the running minimum of the computer's gain over the window (a monotonic queue), averaged over the same window, so each peak meets a smooth ramp that has already reached its gain;
- program-dependent release: a fast follower (50 ms) and a slow one (attack 100 ms, release 700 ms), the lower applies. A lone transient recovers in about 50 ms; sustained limiting holds a steady gain instead of pumping on every waveform peak;
- a tanh-shaped safety clip from -0.5 dBFS to 0 dBFS. The limiter keeps its output under -1 dBFS, so the clip never acted in any of the renders below;
- when the block, the look-ahead window and both followers are idle, it only runs the delay.

**Before and after** (all 160 presets; chord test = C3 E3 G3 C4 at velocity 100, stress = D2 F3 A3 C4 E4 G4 at velocity 127; each rendered with the limiter bypassed and on, gain reduction per sample on the louder channel, over samples above -60 dBFS):

| | Chord before | Chord after | Stress before | Stress after |
|-|-|-|-|-|
| Median RMS / loudness | -13.0 dBFS / -11.2 LUFS | -18.5 dBFS / -16.7 LUFS | -11.8 dBFS / -9.7 LUFS | -16.6 dBFS / -14.7 LUFS |
| Median peak before the limiter | -0.2 dBFS | -5.9 dBFS | +2.3 dBFS | -3.3 dBFS |
| 90th percentile peak before the limiter | +7.0 dBFS | -1.3 dBFS | +9.5 dBFS | +1.0 dBFS |
| Presets with any sample above 1 dB of gain reduction | 88 | 0 | 159 | 29 |
| Presets with more than 1% of samples above 1 dB | 78 | 0 | 151 | 22 |
| Mean share of samples above 1 dB | 7.2% | 0.0% | 27.1% | 0.4% |
| Deepest gain reduction | 10.4 dB | 0.8 dB | 11.9 dB | 4.0 dB |

The edit that prompted this: on every preset, both channels' VCF level pushed to full (where the channel sounds at all). Before, 121 presets spent more than 1% of the chord test above 1 dB of gain reduction (median 18.3% of samples, deepest 25.6 dB). After, 30 do (median 0%, deepest 10.7 dB).

With the old library and only the new limiter, the chord test already went from 78 to 68 presets above 1%, and the stress chord's median share from 21.1% to 8.3%, because gain reduction now arrives as a ramp instead of a quarter-block step plus clipping.

**Cost.** WebAssembly: 8 voices with every effect run 27.6x real time (26.4x with the old limiter; the difference is noise). ESP32-S3, static (`cs80v2/s3_count.sh`): the idle path is 10 instructions of peak scan plus 16 of delay per stereo sample, 26 in all (11 before). The limiting path has branches, so it was not counted as a loop. Its code is 345 instructions, but each sample runs only part of it: the gain computer only above the knee, the queue only when the gain changes. It has not been timed on hardware. The state grew from 16 bytes to about 2.6 KB (delay, average and queue rings of 128).
