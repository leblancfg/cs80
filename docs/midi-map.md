# cs80v2 MIDI map

The browser build (`web/`) plays from any controller through a learned layout and a performance map. The fixed CC tables further down are still in the engine (`cs80v2/midimap.hpp`) for the ESP32 build and for keyboards programmed to those numbers.

## Performance map (browser default)

Hardware controls drive performance macros. A macro moves several panel fields at once, relative to the loaded preset: when a preset loads, each control's current position becomes the preset's own value, and the travel left on each side covers the macro's range ("value scaling" soft takeover; each side gets at least a quarter of the travel so a control parked near an end does not jump). "Both" means channels I and II together.

| Control | Macro | Fields and range |
|-|-|-|
| Slider 1 | Brilliance | global `brilliance`, toward -3 / +3 oct |
| Slider 2 | LPF cutoff (both) | `lpf_hz`, preset x 2^(+-4 oct), 37 Hz to 20 kHz |
| Slider 3 | LPF resonance (both) | `lpf_res`, toward 0 / 0.97 |
| Slider 4 | HPF cutoff (both) | `hpf_hz`, +-4 oct, 27 Hz to 16 kHz |
| Slider 5 | Filter envelope depth (both) | `il` and `al`, toward 0 / 5 oct |
| Slider 6 | Attack (VCA and filter env, both) | `a`, `fa`, +-4 oct in time |
| Slider 7 | Release (both) | `r`, `fr`, +-3 oct in time |
| Slider 8 | Channel I/II balance | `mix`, toward I only / II only |
| Slider 9 | Aftertouch (swell) | absolute channel pressure 0..127, re-sent after each new note. The Oxygen MKV has no aftertouch, so this is the only way to reach the CS-80's After Brilliance, After Level and aftertouch vibrato. Vibrato depth (`sub_vco`, toward 0 / 1.5 st) is still a macro; the mod wheel also adds vibrato. |
| Knob 1 | Chorus depth | `chorus_depth`, toward 0 / 1; switches the chorus on if the preset had it off |
| Knob 2 | Chorus/tremolo speed | `chorus_hz` and `trem_hz`, +-2 oct |
| Knob 3 | Echo mix | `echo_mix`, toward 0 / 1; switches echo on (line mode) if it was off |
| Knob 4 | Echo time | `echo_time`, +-1.5 oct; longer times lower the feedback (up to -35%) so tails stay sensible |
| Knob 5 | Reverb mix | `reverb_mix`, toward 0 / 1 |
| Knob 6 | Detune I/II | `detune_cents` on channel II, toward -30 / +30 ct |
| Knob 7 | Ring mod mix | `ring_mod`, toward 0 / 1 |
| Knob 8 | MASTER VOLUME | absolute, post-effects gain (squared taper); 0 is silent |
| Pads 1 / 2 | Previous / next preset | |
| Pads 3 / 4 | Previous / next bank | |
| Pads 5 to 8 | Favourites 1 to 4 | shift-click or long-press a favourite button in the page to store |
| Buttons under sliders 1 to 8 | Unassigned | Individually learnable and assignable from the Controls tab. The Oxygen MKV's button under slider 9 is hard-wired to DAW BUTTON MODE and sends nothing usable, so Learn skips it on an Oxygen (with a one-line note) and the legend hides it. Other controllers get a ninth step. |
| Loop (optional) | Reset preset | every panel field back to the loaded preset's stored values; held notes keep playing and macros pick up again. Also the Reset preset button by the preset name, or double-click the name. |
| Stop (optional) | Panic | Play and Rec are learnable but unassigned. The Oxygen 49 MKV has no dedicated Track or Rewind/Fast-forward buttons. Its < / > buttons change keyboard presets in Preset mode or track banks in DAW mode. |
| Mod wheel (CC 1) | Vibrato | engine `wheel * wheel_vco`; presets with less than 0.6 st of wheel vibrato are raised to 0.6 |
| Pitch wheel | Pitch bend | +-2 semitones (set on every preset load) |
| Channel / poly aftertouch | Touch | engine routing: per-channel After Brilliance and After Level, plus `at_sub_vco` vibrato |
| Sustain (CC 64) | CS-80 sustain | |

Any slot can be reassigned to another macro, an action, or any raw panel field. Raw fields are absolute with classic pickup: the control does nothing until it reaches the field's current value.

## Oxygen 49: run Learn, there is no factory table

M-Audio does not publish the CC numbers the Oxygen 49 faders and knobs send in its factory presets. The 4th-generation (MK IV) guide (https://cdn.inmusicbrands.com/m-audio/maudio_documentation/Oxygen49-UserGuide-v1.3.pdf) says only that the faders "send different types of standard MIDI CC messages ... based on the parameter they are assigned to or the active preset", and its appendix lists the assignable CC numbers, not the defaults. The MKV guide (https://cdn.inmusicbrands.com/m-audio/maudio_documentation/Oxygen%20Series%20MKV%20-%20User%20Guide%20-%20v1.2.pdf) is the same; its factory presets are named after AIR instruments ("1. MPC PI", "2. Hybrid 3" ... "9. General MIDI"). Both guides agree that the pads send on channel 10.

So the page does not guess. On first MIDI connect without a stored layout, it asks you to run Learn. The earlier guess (faders on CC 20-28, knobs on 102-109) only reached faders 7 and 8 on François's unit.

## Oxygen MKV

Learn listens to every MIDI input, DAW ports included, so any of these setups works. Pick one and run Learn once in it; a layout learned in one mode does not carry over to another.

1. **N2 profile (plain CCs).** Press DAW/PRESET until its DAW light is on. Hold SHIFT and DAW/PRESET, use the < and > buttons beside the display to choose N2, then release. The guide gives both this sequence ("press and hold the SHIFT button and the DAW/PRESET button", in the controls overview) and, in "DAW and Preset Mode", holding DAW/PRESET alone; the setup guide mentions both. The MKV guide lists "Factory Reset" in its contents but never describes one, so the page does not suggest a reset. The DAW profiles are NC1/NC2 (Mackie), M|h (Mackie/HUI) and N1/N2/N3 (plain MIDI CC) (MKV guide pp. 3, 9).
2. **Preset mode, preset 9 "General MIDI".** Press DAW/PRESET so DAW is unlit, then select preset 9 (MKV guide p. 9). Faders, knobs and pads send plain CCs and notes on the "USB MIDI" port.
3. **Mackie/HUI (M|h, NC1, NC2) now works too.** The controls arrive on the "Oxygen 49 MKV Mackie/HUI" port as Mackie Control messages:
   - faders: 14-bit pitch bend, one channel per fader (fader 1 = ch 1). Mapped 0..16383 to 0..1.
   - knobs: V-pots, CC 16 to 23 on ch 1, relative (1..63 clockwise ticks, 65..127 counterclockwise). Each tick moves 1% of the travel. A V-pot has no position, so on every preset load it restarts in the middle (= the preset's value).
   - buttons and pads: notes; they fire on press.
   - fader touch notes (104 to 112) and SysEx are ignored, so Learn captures the fader and not its touch sensor.
   - HUI faders (CC 0-7 plus LSB on CC 32-39) learn as CC 0-7, refined by the LSB. HUI V-pots and HUI switch messages (CC 15/47) are not supported.

**Pads in N2 or General MIDI** may send ordinary notes on the same channel as the keys. MIDI cannot identify whether a note on that port and channel came from a pad or a key, and the note number does not help either: the 49-key keybed reaches every note through its octave buttons. So the page records the keybed's channel and input (the first Learn step, or the setup guide's key check) and stores it in the layout as `keybed`. A learned pad or button note fires its action only if it differs from the keybed by channel or by input, or if the user pressed "Use anyway" for it in Learn (stored as `shared: true`). Otherwise the note plays, note-off included. The same rule runs on every incoming note, so old saved layouts and imported files cannot take keys either; imported files lose any `shared` flag. A layout without `keybed` assumes channel 1.

When Learn meets a pad on the keybed's channel it stops and offers **Skip pads** (pads keep playing notes) or the fix: hit a pad, hold SHIFT and press the CHANNEL UP key until the display shows 10, release, then hit the pad again. The wizard re-checks by itself (the MKV guide's Channel Selection section: the last control touched is the one whose channel changes). The guided setup ("Set up my controller") does the same check before Learn by asking for a pad hit and then a key press.

The Learn wizard shows a tip, not a block, when it sees Mackie traffic. Notes, the pitch wheel and pressure from a DAW port never play the synth (the keys arrive on the USB MIDI port too, so playing both would double every note); only learned controls answer from a DAW port. Each learned control remembers the input it came from, so Mackie fader 1 (pitch bend ch 1 on the DAW port) does not take over the pitch wheel (pitch bend ch 1 on the USB port).

Any other CC that only ever sends values near 1/127 or 63/65 (three equal values in four, or a back-and-forth around one centre) is treated as a relative encoder: two's complement (1 = +1, 127 = -1) or offset (65 = +1, 63 = -1). The first value outside those bands marks the CC as absolute for good.

## Fixed Oxygen 49 CC map (`oxygen49_map()`, "Oxygen fixed CCs" in the page)

Used by the ESP32 build, and in the page when "Control" is set to the fixed Oxygen map. The keyboard must be programmed to these CC numbers first (control-assign mode or the Preset Editor); a factory-preset Oxygen does not send them. The 4th-generation Oxygen 49 sends no aftertouch, as far as I can tell; the Oxygen Pro 49 sends channel pressure. The engine spreads channel pressure to all held voices (mode Mono) or only to the newest note (mode Last), following the GX-80's "Last" idea of faking poly aftertouch. Check what your unit actually sends before choosing a mode.

| Control | CC | Function | Note |
|-|-|-|-|
| Fader F1 | 20 | Brilliance | |
| Fader F2 | 21 | Resonance | |
| Fader F3 | 22 | Mix I/II | |
| Fader F4 | 23 | VCF EG IL | channels I and II together |
| Fader F5 | 24 | VCF EG AL | I and II together |
| Fader F6 | 25 | VCA Attack | I and II together |
| Fader F7 | 26 | VCA Release | I and II together |
| Fader F8 | 27 | Sustain time | |
| Fader F9 | 28 | Master | |
| Knob K1 | 102 | Sub osc Speed | |
| Knob K2 | 103 | Sub osc VCF | |
| Knob K3 | 104 | Ring mod amount | |
| Knob K4 | 105 | Ring mod speed | |
| Knob K5 | 106 | Detune | |
| Knob K6 | 107 | Chorus depth | |
| Knob K7 | 108 | Echo mix | |
| Knob K8 | 109 | Reverb mix | |
| Mod wheel | 1 | sub osc vibrato depth (`wheel_vco`) | the CS-80 had no wheel; Arturia added the same routing |
| Pitch wheel | bend | ribbon pitch | |
| Sustain pedal | 64 | CS-80 sustain | |

`handle_cc()` in `midimap.hpp` routes a CC through whichever map is active. CCs that are not in the map fall through to the engine's built-in handling: 1, 7, 11, 64, 120 and 123.

## PM-80 (not the default)

Kept for reference and as a selectable fixed map; nobody here plans to buy one.

### What is public

The GLT Audio PM-80 (https://www.gijsleijdekkers.nl/gltaudio/) is still in pre-order; the site says it should ship towards the end of 2026. I found no published CC or NRPN map. The product page, the high-resolution image PDF (https://www.gijsleijdekkers.nl/gltaudio/img/GLT-Audio_PM-80_highres_images.pdf) and the press coverage (Synth Anatomy, Sound On Sound news, Synthtopia, MATRIXSYNTH) agree on these points:

- 75 faders, 6 waveform toggles, 2 filter-envelope INV switches, 3 toggles for sustain, glide and ribbon behaviour, and one "shift" switch that sends an extra CC or "alternative CCs for all controls while holding down the switch".
- The ribbon sends 14-bit pitch bend. GLT plans to do the CS-80 "touch-down point is zero" behaviour in firmware.
- The expression pedal input is converted to a MIDI CC.
- It is send-only. Its firmware will be open source, so users can change CC numbers.
- No CC numbers are printed on the faceplate. GLT expects owners to MIDI-learn each fader in their plugin.

So I designed the map below to follow the PM-80 faceplate one to one, in its left-to-right order. The engine looks controls up in a 128-entry table (`CCMap` in `cs80v2/midimap.hpp`). If GLT publishes default CCs, or an owner reflashes custom ones, supporting them means editing that table and nothing else.

#### PM-80 faceplate, as transcribed from the image PDF

| Row | Section | Controls, left to right |
|-|-|-|
| I and II (identical) | VCO | Speed, PWM, PW, Noise, continuous pulse/saw levels; triangle is a proposed PM-80 control without a v2 oscillator |
| | VCF | HPF, Res, LPF, Res, IL, AL, A, D, R, plus INV switch |
| | VCA | VCF Level, Sine, A, D, S, R, L |
| | Touch response | Initial: Brilliance, Level. After: Brilliance, Level |
| Bottom | Ring modulator | Attack, Decay, Depth, Speed, Mod |
| | Sub oscillator | Function, Speed, VCO, VCF, VCA |
| | Layer | Feet I, Feet II, Mix, Pan, Detune |
| | Sound | Bril, Res, Delay, Reverb |
| | Touch response | Init Bend; Sub Osc After Speed, VCO; After VCF |
| | Keyboard control | Brilliance Low, High; Level Low, High |
| | Switches | Sustain, plus glide and ribbon toggles |

### Proposed PM-80 map (`pm80_map()`)

Everything is on MIDI channel 1. Values 0 to 127 are scaled to the ranges in the last column, which follow the Arturia CS-80 V4 manual wherever it gives one.

#### Channel I row (Channel II: add 29 to CCs 12 to 31, add 8 to CCs 102 to 109)

| CC I | CC II | Control | Range |
|-|-|-|-|
| 12 | 41 | VCO Speed (PWM rate) | 0.1 to 40 Hz, exponential |
| 13 | 42 | PWM depth | 0 to 40% width swing |
| 14 | 43 | PW | 50% to 90% |
| 15 | 44 | Noise | 0 to 1 |
| 16 | 45 | HPF cutoff | 26.8 Hz to 16.2 kHz |
| 17 | 46 | HPF resonance | 0 to 0.97 |
| 18 | 47 | LPF cutoff | 37.1 Hz to 20 kHz |
| 19 | 48 | LPF resonance | 0 to 0.97 |
| 20 | 49 | IL | 0 to 5 octaves below the cutoff |
| 21 | 50 | AL | 0 to 5 octaves above the cutoff |
| 22 | 51 | VCF EG Attack | 2 to 580 ms |
| 23 | 52 | VCF EG Decay | 2 ms to 8.75 s |
| 24 | 53 | VCF EG Release | 2 ms to 11 s |
| 25 | 54 | VCF Level | 0 to 1 |
| 26 | 55 | Sine level | 0 to 1 |
| 27 | 56 | VCA Attack | 2 to 885 ms |
| 28 | 57 | VCA Decay | 2 ms to 7.35 s |
| 29 | 58 | VCA Sustain | 0 to 1 |
| 30 | 59 | VCA Release | 2 ms to 11.5 s |
| 31 | 60 | Level (dynamics floor) | 0 to 1 |
| 102 | 110 | Initial Brilliance | 0 to 3 octaves at full velocity |
| 103 | 111 | Initial Level | 0 to 1 |
| 104 | 112 | After Brilliance | 0 to 3 octaves at full pressure |
| 105 | 113 | After Level | 0 to 1 |
| 106 | 114 | Pulse toggle | off below 64 |
| 107 | 115 | Saw toggle | off below 64 |
| 108 | 116 | Triangle toggle | ignored: the CS-80 has no triangle |
| 109 | 117 | INV (filter EG invert) | off below 64 |

PM-80 note: GLT says its IL and AL faders move the same way, while on the CS-80 IL is reversed. Both map here as "more is a bigger envelope".

#### Bottom row

| CC | Control | Range |
|-|-|-|
| 70 | Ring mod Attack | 3 to 530 ms |
| 71 | Ring mod Decay | 7 ms to 4.5 s |
| 72 | Ring mod Depth (envelope to speed) | up to +6 octaves of carrier speed |
| 73 | Ring mod Speed | 0.25 to 205 Hz |
| 74 | Ring mod Mod (amount) | 0 to 1 |
| 75 | Sub osc Function | sine, saw down, saw up, square, S&H, noise (6 zones) |
| 76 | Sub osc Speed | 0.5 to 100 Hz |
| 77 | Sub osc VCO | 0 to 12 semitones (squared taper) |
| 78 | Sub osc VCF | 0 to 3 octaves |
| 79 | Sub osc VCA | 0 to 1 |
| 80 | Feet I | 16', 8', 5 1/3', 4', 2 2/3', 2' (6 zones) |
| 81 | Feet II | same |
| 82 | Mix I/II | I only at 0, II only at 127 |
| 83 | Pan spread (not on the CS-80) | 0 = mono, 127 = I left, II right |
| 84 | Detune (channel II) | -100 to +100 cents |
| 85 | Brilliance | -3 to +3 octaves on all four filters |
| 86 | Resonance | adds 0 to 1 |
| 87 | Delay (echo mix) | 0 to 1 |
| 88 | Reverb mix | 0 to 1 |
| 89 | Initial pitch bend | 0 to 2 semitones below at full velocity |
| 90 | After: sub osc Speed | up to 4 times speed at full pressure |
| 2 | After: sub osc VCO | 0 to 2 semitones |
| 3 | After: sub osc VCF | 0 to 2 octaves |
| 4 | Keyboard Brilliance Low | -2 to +2 octaves, 2 octaves below the centre |
| 5 | Keyboard Brilliance High | -2 to +2 octaves, 2 octaves above |
| 8 | Keyboard Level Low | -1 to +1 gain |
| 9 | Keyboard Level High | -1 to +1 gain |

#### Switches, pedal, ribbon and the shift layer

| Source | Message | Function |
|-|-|-|
| Ribbon | pitch bend (14 bit) | pitch; range set per patch (`bend_up`, `bend_down`) |
| Sustain toggle / pedal | CC 64 | CS-80 sustain: adds the Sustain time to the release (mode I or II), or MIDI hold |
| Glide toggle | CC 65 | portamento below 64, glissando at 64 and above |
| Expression pedal | CC 11 | volume |
| Shift + Reverb fader | CC 91 | reverb decay |
| Shift + fader | CC 92, 93, 94, 95 | tremolo depth, chorus depth, chorus speed, tremolo speed |
| Shift + fader | CC 118, 119 | sustain time (0 to 9 s), portamento time (0 to 2 s per octave) |
| Any controller | CC 33, 34, 35 | chorus on, tremolo on, sustain mode (I, II, hold) |
| Any controller | CC 36, 37, 39 | echo time (30 ms to 1.3 s), echo feedback, voice-card drift (0 to 2) |

Left free on purpose: CC 0 and 32 (bank select), 1 (mod wheel, which adds sub-osc vibrato), 6 and 38 (data entry), 7 (volume), 10, 64 to 69 (pedals), 96 to 101 (RPN/NRPN), 120 to 127 (channel mode). The PM-80 shift layer assignments are my proposal; GLT has not described how its alternative CCs are numbered.

NRPN is not needed: every control fits in 7 bits. The steps are audible only on cutoff, and the engine already smooths cutoff over a 32-sample ramp.
