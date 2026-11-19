# Yamaha CS-80 architecture, as needed for cs80v2

This note collects what the engine has to reproduce, with a source for each claim. Where sources disagree, or where only an emulation documents a value, I say so. Ranges marked "(Arturia)" come from the Arturia CS-80 V4 manual, which states numeric ranges for every control. They are a modeller's calibration of the original, not Yamaha figures, but they are the best published numbers.

## Sources

| Tag | Source | Kind |
|-|-|-|
| [OM] | Yamaha CS-80 Owner's/Operating Manual, as indexed at https://www.manualslib.com/manual/1150423/Yamaha-Cs-80.html (pages 46 to 53). Manualslib blocks automated fetches; the quotes below come from its search excerpts. | primary |
| [SOS95] | Richard Clewes, "Yamaha CS80 (Retro)", Sound On Sound, July 1995: https://www.soundonsound.com/reviews/yamaha-cs80 | retrospective |
| [GR] | Gordon Reid, "The Yamaha CS80", Gordon Reid's Vintage Synths, 2013: https://web.archive.org/web/20140917022815/http://www.gordonreid.co.uk/vintage/cs80.html | retrospective |
| [HS] | Hollow Sun, "Yamaha CS80": https://hollowsun.com/nostalgia/contributors/cs80/index.html | retrospective |
| [GX] | Cherry Audio GX-80 User Guide (PDF): https://docs.cherryaudio.com/pdf/GX-80%20User%20Guide.pdf, plus https://docs.cherryaudio.com/cherry-audio/instruments/gx-80/perf and .../left. Written from the CS-80 and GX-1 schematics. | emulation, detailed |
| [AR] | Arturia CS-80 V4 manual: https://dl.arturia.net/products/cs-80v/manual/cs-80-v_Manual_4_0_1_EN.pdf | emulation, numeric ranges |
| [XL] | XILS-lab The Eighty manual: https://www.xils-lab.com/download_files/TheEighty/TheEighty_user_manual.pdf | emulation |
| [RM] | Reverb Machine, "Exploring the Yamaha CS-80": https://reverbmachine.com/blog/exploring-the-yamaha-cs-80/ | patch recipes |
| [WP] | Wikipedia, "Yamaha CS-80": https://en.wikipedia.org/wiki/Yamaha_CS-80 | summary |
| [YG] | Yamaha CS80 group archive (synth-diy.org), via search excerpt: "the whole CS-80 is mono until it gets to the chorus ... the OE2 board" | service lore |

I could not retrieve the service manual PDF itself (matrixsynth links point to a dead mirror). Nothing below depends on component values.

## Top level

- 8 voices, each made of two complete, independent synthesizer "channels" (Yamaha's term; also called lines, ranks or layers): 16 VCOs, 32 filters, 32 envelopes on 35 boards [GR]. Each channel of each voice is a separate circuit, which is where the note-to-note variation comes from [HS] [GR].
- 61-note weighted keyboard with velocity ("initial touch") and true polyphonic aftertouch ("after touch") [WP] [SOS95].
- One ribbon controller with no centre: the touch-down point is zero, about +1 octave up and several octaves down [SOS95] [HS].
- Global sub oscillator (LFO), ring modulator, tremolo/chorus, portamento/glissando, sustain [OM] [GX].
- The signal is mono until the tremolo/chorus board (OE2), which makes it stereo [YG] [OM].
- 22 fixed presets (11 per channel) and 4 analogue memories made of miniature sliders under a hinged panel [GX] [WP]. [SOS95] says 26 presets and some sources say 6 user patches; Arturia, XILS and Cherry agree on 22 plus 4.

## Per channel (identical for I and II)

Order on the panel, left to right [GX] [AR] [RM]:

| Section | Controls | Notes |
|-|-|-|
| VCO | Speed, PWM, PW; Square (pulse) on/off, Saw on/off; Noise level | Each channel has its own PWM sub oscillator (sine only on the original) [GX] [AR]. PW from 50% to about 90% (Arturia: 0.5 to 0.9). Saw and pulse sound together [HS]. |
| VCF | HPF cutoff, Res H, LPF cutoff, Res L | 12 dB/oct high-pass then low-pass, both resonant; together a band-pass [HS] [GX]. Arturia: HPF 26.8 Hz to 16.2 kHz, LPF 37.1 Hz to 22.3 kHz. GX: the CS-80 filter is "distortion-free". |
| VCF EG | IL, AL, A, D, R | See below. Arturia: A 2 to 580 ms, D 2 ms to 8.75 s, R 2 ms to 11 s. |
| VCA | VCF level, Sine level, A, D, S, R | The sine is added after the filters and has "a few harmonics" [GX] [AR] [RM]. Arturia: A 2 to 885 ms, D 2 ms to 7.35 s, R 2 ms to 11.5 s. |
| Touch response | Level, Initial Brilliance, Initial Level, After Brilliance, After Level | Velocity and poly aftertouch to filter cutoff and loudness, per channel [GX] [RM]. |

### The filter envelope (IL/AL)

The VCF EG is an A, D, R generator whose resting level is the cutoff slider position. IL sets how far below the cutoff the envelope starts and returns to on release (0 to -5 V); AL sets how far above the cutoff it peaks at the end of the attack (0 to +5 V). Decay always returns to the cutoff, so the "sustain" is the cutoff slider itself [GX] [AR]. IL up with AL at zero gives an attack/release shape; AL up with IL at zero gives attack/decay. On the original the IL slider has inverted travel [RM] [GX].

The same envelope moves both filters. The HPF moves about half as many octaves as the LPF, which keeps the band-pass "always open" and is, per Cherry, the defining character of the CS sound [GX]. All other filter modifiers (Brilliance, touch, sub oscillator, keyboard control, key tracking) also move both filters [GX].

v1 (`cs80lite`) had a filter envelope but treated it as IL to AL to 0 on the LPF only, with depth in a separate parameter, and never moved the HPF. v2 implements the relative IL/AL scheme on both filters.

### VCA and level dynamics

Three level controls feed a separate dynamics VCA: Level is the floor, Initial Level adds velocity, After Level adds aftertouch. With Level at full there are no dynamics [GX]. The Brilliance pair works the same way on cutoff.

## Performance (shared) controls

| Control | Function | Source |
|-|-|-|
| Feet I, Feet II | 16', 8', 5 1/3', 4', 2 2/3', 2' (Cherry lists two extra GX-1 footages) | [GX] [AR] |
| Detune | Moves channel II only, about a half step either way | [AR] [GX] |
| Mix | Balance I against II | [GX] [AR] |
| Brilliance, Resonance | Offsets added to both filters of both channels; Resonance adds to both Res H and Res L | [GX] [AR] [SOS95] |
| Touch response: Pitch bend (initial) | Harder notes start lower and swoop up at a fixed speed | [GX] [AR] [SOS95] |
| Touch response: Sub osc After Speed, VCO, VCF | Aftertouch raises sub oscillator speed and its pitch and filter depth, per key | [GX] [AR] |
| Keyboard control: Brilliance Low/High, Level Low/High | Scaling "out from the centre": no effect on the middle octave, increasing toward the ends | [GX] [AR] |
| Sub oscillator: Function, Speed, VCO, VCF, VCA | One global LFO. Waves: sine, saw down, saw up, square, sample and hold, noise. Arturia: 0.5 to 100 Hz | [GX] [AR] [OM] |
| Ring modulator: Attack, Decay, Depth, Speed, Mod | A sine carrier (Arturia 0.25 to 205 Hz) multiplies the summed output of both channels. Mod sets amount. Depth sets how far an AD envelope raises the carrier speed (A 3 to 530 ms, D 7 ms to 4.5 s). One envelope, monophonic, retriggered when a note starts after all keys were up | [SOS95] [GX] [AR] [OM] |

## Left-hand panel

| Control | Function | Source |
|-|-|-|
| Sustain time (+ pedal) | An extra release time added to the VCA release while the pedal is down; released notes always decay, there is no infinite hold. Mode I: each note fades on its own. Mode II: the last note or chord carries the sustain and a new note cuts the fading ones | [GX] [AR] [XL] |
| Portamento / Glissando, time | Polyphonic glide from the last note played to the new one; glissando steps in semitones. Arturia: 0 to 2 s per octave. Can be pedal-gated | [GX] [AR] [HS] |
| Tremolo / Chorus, Speed, Depth | One sub oscillator feeds a pair of VCAs (volume) and a phase shifter. Chorus uses a slow range (about 0.5 to 5 Hz [OM]; Arturia 0.4 to 1.55 Hz), tremolo a faster one (Arturia 1.18 to 16.3 Hz). Together they simulate a rotating speaker in stereo | [OM] [AR] |
| Expression pedal | Volume and/or a wah | [GX] |

Is the chorus global or per voice? Global. It sits on the OE2 board after the mono mix and produces the stereo pair [YG] [OM]. The ring modulator is also global and mono, before the chorus [YG] [GX]. v1 had the ring modulator per voice; v2 moves it to the mix bus, which is both more faithful and cheaper.

## Presets

Channel I row: Strings 1, Strings 3, Brass 1, Flute 1, Electric Piano, Clavichord 1, Harpsichord 1, Organ 1, Guitar 1, Funky 1, Funky 3.
Channel II row: Strings 2, Strings 4, Brass 2, Brass 3, Bass, Clavichord 2, Harpsichord 2, Organ 2, Guitar 2, Funky 2, Funky 4 [AR] [XL].

Each preset is a single-channel setting, so a sound is a pair (one from each row) plus the shared performance controls. Arturia notes that the tones "much resembled" nothing they were named for, and were used in combinations [AR]. The preset values are fixed resistor networks; no source publishes them as numbers, so v2's presets are reconstructions from recipes ([RM] gives several) and the descriptions above.

## What v2 models, and the gaps

| Feature | v2 | Note |
|-|-|-|
| Two channels per voice, all controls above | yes | |
| IL/AL filter EG on both filters, HPF at half depth | yes | fixes the v1 gap |
| Sine after the filters, slightly impure | yes | 2nd and 3rd harmonic at -34 and -40 dB |
| Poly aftertouch per voice, channel pressure fallback, "last note" mode | yes | GX-80 "Last" mode idea |
| Voice card tolerances and drift | yes | per slot static offsets plus slow random walk; estimated magnitudes, not measured from a CS-80 |
| Ribbon | as pitch bend with asymmetric range | the touch-down-is-zero logic belongs in the controller; the PM-80 plans to do it in firmware |
| Ring mod on the mix bus with AD speed envelope | yes | |
| Tremolo/chorus as stereo BBD + antiphase VCAs | yes | delay range and BBD bandwidth are estimates |
| Analogue memories, preset matrix | as a preset table | |
| Wah | no | |
| OTA/transistor nonlinearity in detail | approximate | a soft clipper at the LPF input |
