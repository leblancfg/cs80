# cs80v2: remaining limitations

What still differs from a real Yamaha CS-80, and from the preset library in `presets/presets.json`, after the November 2026 round. Each item lists its audible impact, what a fix would cost, and whether the fix fits the ESP32-S3 budget (REPORT-v2.md section 6: an estimated 40 to 63% of both cores, never measured on a board).

Impact: **high** = most presets or the CS-80's signature playing; **medium** = some presets or some gestures; **low** = edge cases or hard to hear.

## Fixed in this round

| Item | What changed |
|-|-|
| Saw and square were on/off switches | Continuous 0..1 levels per channel, smoothed at the 1.5 kHz control rate (about 4 ms), so slider moves do not click. The translator keeps the source's saw/square/noise ratios and puts the overall level in VCF Level. The audio loop is unchanged; the cost is a few instructions per control tick (REPORT-v2.md section 10). |
| No aftertouch on the Oxygen 49 MKV | The MKV guide never mentions aftertouch and the keyboard sends none, so After Brilliance, After Level and aftertouch vibrato, the heart of CS-80 playing, were unreachable. Slider 9 now sends channel pressure by default ("Aftertouch (swell)"), re-sent after each new note so fresh voices pick it up. Zero engine cost. |

## Versus the real CS-80

| # | Limitation | Impact | Fix cost | ESP32-S3 |
|-|-|-|-|-|
| 1 | **No per-key (polyphonic) aftertouch from ordinary keyboards.** The engine handles poly pressure per voice, but the Oxygen sends none and most keyboards send at most channel pressure. Channel pressure goes to every held voice (Mono) or the newest note (Last). A slider can stand in (above) but swells every held note at once. | High | Needs MPE or poly-AT hardware; the engine side is done. | Fits (already in) |
| 2 | **Panel calibration is estimated.** The 5-octave IL/AL scale, key tracking, the ±3-octave Brilliance range, HPF tracking at half the LPF's octaves, BBD chorus depths and bandwidth, voice-card tolerances and the initial-bend speed are educated guesses, not measurements of a CS-80. | Medium | Needs measurements from a working CS-80 (service manual voltages plus recordings). | Fits (constants only) |
| 3 | **Envelope shapes.** ADSR segments are exponential with fixed curvature; the CS-80's VCF and VCA envelope curvature and the exact slider-to-time laws are not sourced. | Medium | Low code cost, but needs reference recordings. | Fits |
| 4 | **Ribbon.** It is mapped to the pitch wheel. A real ribbon starts at zero wherever you touch it and slides relative to that point; a wheel springs back to the centre. | Medium | Low: a "relative from first touch" mode for a learned slider. | Fits (UI side) |
| 5 | **Ring modulator** runs on the mono mix with one AD envelope on its speed, triggered when a key goes down after all keys were up (legato does not retrigger). Whether the original's ring mod sits after the voice sum is likely but not confirmed. | Low to medium | Per-voice ring mod would cost about 12 cycles per voice-sample. | Per-voice: tight, about +4% load |
| 6 | **Control rate.** Pitch, PWM and filter targets update at 1.5 kHz with linear coefficient ramps. Sub-oscillator FM above about 100 Hz turns into steps. | Low | Medium: audio-rate FM path. | Does not fit at 8 voices |
| 7 | **No oversampling.** The saturated LPF and a resonant HPF near 19 kHz can alias a little on high notes. | Low | 2x oversampling of pass 2. | Does not fit |
| 8 | **Keyboard size.** 49 keys on the Oxygen against the CS-80's 61; the octave buttons cover the range but not both ends at once. | Low | Hardware. | n/a |
| 9 | **Not modelled:** BBD clock noise, the four-memory panel and card reader behaviour, voice-card hum and crosstalk. | Low | Medium each. | Noise: fits; memories: n/a |
| 10 | **Voice count** is 8, as on the CS-80. Echo in "voices" mode replays extra voices (up to 24). The 9th held note steals the oldest voice; the CS-80 simply plays no 9th note. | Low | Trivial to switch to "no steal". | Fits |
| 11 | **Velocity stands in for initial touch.** The CS-80 senses key travel speed with its own curve; MIDI velocity and the Oxygen's velocity curve set its feel here. | Low to medium | Low: a velocity-curve option. | Fits |

## Versus `presets/presets.json`

| # | Limitation | Impact | Fix cost | ESP32-S3 |
|-|-|-|-|-|
| 12 | **The preset values are estimates.** The file's own `field_confidence` says most numbers are inferred by ear; the 95 presets name their sources but few values are documented. This bounds every other fidelity claim. | High | Needs documented patch sheets. | n/a |
| 13 | **Envelope time curve mapping.** The source gives envelope times as "normalized log 0..1" without a range. Through the engine's panel curves its slow pads would all sit under 0.3 s, so the translator uses 10 ms to 3 s (attack), 8 s (decay) and 10 s (release) on a log scale. The real range is unknown, so pad swells and plucks may be too slow or too fast. | High | Zero CPU; needs one confirmed reference time per stage to calibrate. | Fits |
| 14 | **Sub oscillator to PWM** has no route in cs80v2 (nor on the CS-80, which has a PWM LFO per channel). For 3 presets the translator moves the sub-osc speed and depth onto both channels' own PWM LFOs, so the PWM is no longer in sync with any sub-osc vibrato. | Low | Small: a `sub_pwm` depth, 2 multiplies per channel per control tick. | Fits |
| 15 | **Sub oscillator to ring mod** has no route. For 1 preset its speed becomes the ring mod speed. | Low | Small, as above. | Fits |
| 16 | **Per-channel brilliance averaged.** Brilliance is global in cs80v2; the source's per-channel values are averaged. No preset in the current file sets them differently, so nothing changes today. | Low | Zero CPU: fold the difference into each channel's cutoff. | Fits |
| 17 | **Per-channel keyboard level and brilliance averaged** into the global Keyboard Control. No current preset differs per channel. | Low | Small. | Fits |
| 18 | **Touch response is shared.** The source gives one initial-touch and after-touch set for both channels, so both get the same; the CS-80 has them per channel. | Low | Source limitation. | n/a |
| 19 | **No PWM speed in the source.** Presets with PWM depth get 0.8 Hz. | Low to medium | Source limitation. | n/a |
| 20 | **Gain curves are approximate.** Waveform levels are mapped linearly and their maximum sets VCF Level (0.75 x level); sine level is 0.75 x sine. The CS-80's slider tapers are not sourced. | Medium | Needs measurements. | Fits |
| 21 | **Level matching** puts the chord test (C3 E3 G3 C4 at velocity 100) at -13 dBFS RMS over the frames that sound, the same target as the Core presets. Master may go up to 8 and the engine's output limiter (ceiling -1 dBFS) takes the peaks, so plucks and clavs sit as loud as pads. A preset is turned down only if a six-note low chord at velocity 127 would make the limiter take more than about 11.5 dB. Percussive patches whose chord test already hits the limiter (toms, snare, some pianos) land 1 to 5 dB short; pushing them further would only squash them. | Low | Done (November 2026). | Fits |
| 22 | **Feet** other than 16', 8' and 4' fall back to 8' (none in the current file). | Low | Trivial. | Fits |

## Browser and controller

| # | Limitation | Impact | Fix cost | ESP32-S3 |
|-|-|-|-|-|
| 23 | **Pads on the keybed's channel cannot be actions.** MIDI notes carry no source identity, and the 49-key keybed reaches every note through its octave buttons. Pads must move to another channel (10) or input, or stay playable notes; "Use anyway" binds them only after a confirmation. | Medium (setup step) | Hardware setting; nothing to fix in software. | n/a |
| 24 | **A stale keybed channel.** If the keys later move to the channel the pads were learned on, the guard still uses the old keybed channel until Learn runs again. | Low | Small: re-run Learn, or Reset controller setup. | n/a |
| 25 | **The ESP32-S3 numbers are estimates.** Instruction counts are measured from Xtensa disassembly and x86 times are measured, but no real board has run the audio, USB MIDI and dual-core split together. | n/a | Run `cs80v2/esp32s3_bench`. | Unverified |

## Top five by audible impact

1. Preset values are estimates (12).
2. Envelope time mapping for the source presets (13).
3. Per-key aftertouch needs hardware the Oxygen lacks (1); the slider stand-in is now in.
4. Panel calibration constants are estimated (2).
5. Approximate gain curves for wave levels, VCF Level and sine (20).

The cheap high-impact fix, an aftertouch slider for keyboards without aftertouch, is done. The others need source data (12, 13, 2, 20) or hardware (1) rather than code or CPU.
