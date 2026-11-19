# Arturia CS-80V factory presets for cs80v2

`cs80v2_presets.json` is a preset library for the cs80v2 engine, translated from the 768 Arturia CS-80V / CS-80 V2 factory presets in `Arturia CS80V Factory Presets for Logic - All/`. It keeps only what a real Yamaha CS-80 has (plus cs80v2's echo, plate and chorus where Arturia's settings map onto them) and says, preset by preset, what was left out.

## Files

| File | What it is |
|-|-|
| `cs80v2_presets.json` | `presets`: the banked library. `extra`: every other preset, translated, with its fidelity and a `bank_hint` |
| `mapping.md` | the chunk layout: each word, its Arturia name, the cs80v2 field it feeds, the scaling and a confidence grade |
| `translate.py` | decoder and translator; writes the JSON and `decoded.json` (per-preset metrics and matrix slots) |
| `tools/engine.mjs` | Node render helper on a snapshot of `web/cs80v2.wasm` (`tools/cs80v2.wasm`) |
| `audition.py`, `audition/` | renders presets over `../../test.mid` and `audition/slow_chords.mid` to MP3, with `report.json` |

Rerun with `python3 translate.py` (add `--refresh-wasm` to pick up a new engine build), then `uv run --with lameenc --with numpy python3 audition.py [arturia names]`.

## Entry format

```json
{"bank": "Brass", "slot": 1, "name": "D.D SatNiteHorns", "arturia_name": "D.D_SatNiteHorns",
 "arturia_category": "Horns", "arturia_file": "Horns/D.D_SatNiteHorns.aupreset", "generation": "CS-80 V2",
 "fidelity": "faithful", "dropped_features": [], "notes": [...],
 "params": {"I.saw": 1.0, "I.lpf_hz": 1180.0, "feet_I": 1.0, "mix": -0.2, "master": 0.31, ...},
 "level_dbfs": -19.0, "centroid_hz": 1319}
```

`params` uses the engine's field names (`cs80_field_name` in `web/cs80v2.wasm`, the same keys as `web/presets-library.json`) in physical units: Hz, seconds, octaves, semitones, cents, 0..1 levels, and item indices for `feet_I`, `feet_II`, `sub_wave`, `sustain_mode`, `fx.echo_mode`. `saw` and `square` are always 0 or 1, as the CS-80's switches were, so they work whether the engine treats them as switches or as levels. Every preset sets the full field list, so it does not depend on `patch_init()` defaults, except `drift`, `key_track`, `bend_*`, `at_mode` and the plate's inner settings, which Arturia does not store.

## Method

1. **Decode.** `data` in each plist is a raw float32 array: eight 142-word patches, then voices, zones, the performance panel and effects. Word names come from the public abletoolz decoder (elixirbeats/abletoolz, MPL-2.0), which was read off CS-80 V2's own parameter getter. I checked it against the corpus (patch period, channel II at +39 words, switch and item encodings, the `Waveforms` demo presets). Details and evidence are in `mapping.md`.
2. **Pick the sounding patch.** Each voice names the patch it plays; the translator takes the patch most voices play (patch 2 in 28 files).
3. **Map onto cs80v2.** The translator uses the engine's control units, but many V2-to-engine curves remain estimates based on the V4 manual. The sub-oscillator inversion has its own evidence; it does not establish the direction of adjacent controls. DETUNE uses a compressed ±15-cent curve and the envelope times a curve fitted to Yamaha's own preset settings, both from the chart calibration in `CALIBRATION.md`. See also `mapping.md` and `field-distribution.md`.
4. **Grade route coverage.** `faithful` means no known Arturia-only route was omitted, **not** that the sound matches Arturia. `approximate` means a route or setting was dropped or substituted (listed in `dropped_features`). `skip` means major missing behavior or no audible channel.
5. **Level-match and rank.** Every preset is rendered in cs80v2 (4-note chord, 3 s hold). `master` is set so the sounding frames sit at -13 dBFS RMS, the Core presets' target. A second pass makes up what the engine's output limiter (ceiling -1 dBFS) took. `master` is lowered only where a 6-note low chord at full velocity would exceed about +4 dBFS before the limiter. The "Sub Osc and Motion" bank is picked first, from every category, out of presets whose sub oscillator, ring modulator or tremolo can be heard (amplitude spread over 0.3 or pitch wobble over 12 cents on a held note). Each bank then takes up to 16 usable presets (faithful or approximate, not too dark, bright or slow, few dropped features), the best-scoring one first, then each next one trading score against distance to the ones already in. Distance covers brightness, attack, sustain, tail, motion, and the sub-osc, ring mod, PWM, noise and touch traits, so a bank does not fill up with near-copies. Arturia's single-control demo patches ("vca EG short Decay", "Ring mod slow") and exact duplicates stay in `extra`.
6. **Audition.** The current 20-sound measurement pass is in `spot-audit.md`. Four new MP3s are rendered separately for listening; earlier auditions remain under `audition/`.

## Counts

All 768 source files: 153 route-complete, 376 approximate, 239 skipped. The translator ranks 149 candidates in 10 banks (below). The public library (`web/presets-library.json`, built by `web/tools/build_library.py`) holds 160 sounds: in each bank the 23 chart presets come first, then the 8 Core and 95 earlier scouted sounds, then the best 34 of these Arturia translations.

| Bank | Arturia candidates | In the public library |
|---|---:|---:|
| Brass | 16 | 2 |
| Strings | 11 | 2 |
| Pads | 16 | 2 |
| Leads | 16 | 3 |
| Keys and Organs | 16 | 2 |
| Bass | 16 | 4 |
| Bells and Plucks | 16 | 2 |
| Woodwinds | 10 | 6 |
| FX | 16 | 2 |
| Sub Osc and Motion | 16 | 9 |

The route grades do not certify V2-to-cs80v2 acoustic fidelity. The raw-value distributions and remaining scale uncertainties are in `mapping.md` and `field-distribution.md`.

## Dropped Arturia features

Counted over all 768 presets (a preset can have several):

| Feature | Presets | Handling |
|-|-|-|
| Modulation matrix | 451 | not translated (labels unknown); 1 to 3 active slots = approximate, 4 or more = skip |
| Triangle wave (CS-80 V2 saw/triangle switch) | 281 | square with the LPF 1.5 octaves lower when the square was off; dropped when the square was already on |
| Per-voice transposition | 203 | dropped (chord and unison tricks across the 8 voices) |
| Oscillator sync | 103 | dropped; Range sweeps between footages are snapped |
| Arpeggiator | 100 | skip |
| Multi mode (voices playing different patches) | 49 | the patch most voices play is translated |
| Tempo-synced PWM speed | 52 | knob position used as free-running Hz |
| Mod wheel to sub-osc VCF/VCA depth | 34 | only the pitch depth moves to `wheel_vco` |
| Keyboard split | 22 | approximate; skip when the zones play different patches |

Also ignored without changing the grade: HPF/LPF bypass switches (bypass becomes a fully open filter), the filter-type switch, the PWM LFO wave and retrigger, per-voice pan/volume/detune, the delay's tempo sync, pedal-gated portamento, expression and wah pedal settings, and the stored master volume.

## Auditions

Rendered with `audition.py` on the current `web/cs80v2.wasm` snapshot. `*_test.mp3` plays `../../test.mid`, `*_chords.mp3` plays four slow chords (Am7, Fmaj7, Dm9, E7sus4, 4 s each). RMS is over the frames within 20 dB of the loudest.

| Preset | File | RMS dBFS | Peak dBFS | Centroid Hz |
|-|-|-|-|-|
| C.L_Rhodesesque | `Keys_and_Organs_C_L_Rhodesesque_test.mp3` | -16.9 | -2.3 | 1943 |
| C.L_Rhodesesque | `Keys_and_Organs_C_L_Rhodesesque_chords.mp3` | -17.8 | -4.9 | 1559 |
| D.D_WatermelonClav | `Keys_and_Organs_D_D_WatermelonClav_test.mp3` | -25.9 | -4.2 | 3386 |
| D.D_WatermelonClav | `Keys_and_Organs_D_D_WatermelonClav_chords.mp3` | -27.5 | -3.9 | 3082 |
| M.L_EL-PIANO-01 | `Keys_and_Organs_M_L_EL_PIANO_01_test.mp3` | -25.1 | -8.0 | 1664 |
| M.L_EL-PIANO-01 | `Keys_and_Organs_M_L_EL_PIANO_01_chords.mp3` | -24.2 | -6.2 | 1261 |
| K.U_CP40 | `Keys_and_Organs_K_U_CP40_test.mp3` | -19.8 | -3.0 | 1385 |
| K.U_CP40 | `Keys_and_Organs_K_U_CP40_chords.mp3` | -19.4 | -3.4 | 906 |
| J.M.B_Pianorgan | `Keys_and_Organs_J_M_B_Pianorgan_test.mp3` | -19.8 | -3.5 | 1449 |
| J.M.B_Pianorgan | `Keys_and_Organs_J_M_B_Pianorgan_chords.mp3` | -22.4 | -3.1 | 995 |
| D.D_SatNiteHorns | `Brass_D_D_SatNiteHorns_test.mp3` | -18.3 | -3.0 | 2982 |
| D.D_SatNiteHorns | `Brass_D_D_SatNiteHorns_chords.mp3` | -19.2 | -4.5 | 2636 |
| K.U_PWMchorus | `Strings_K_U_PWMchorus_test.mp3` | -16.3 | -2.4 | 1864 |
| K.U_PWMchorus | `Strings_K_U_PWMchorus_chords.mp3` | -17.9 | -5.4 | 1696 |
| J.M.B_Soft_5th_Pad | `Pads_J_M_B_Soft_5th_Pad_test.mp3` | -16.5 | -0.9 | 1373 |
| J.M.B_Soft_5th_Pad | `Pads_J_M_B_Soft_5th_Pad_chords.mp3` | -17.5 | -3.9 | 1377 |
| C.L_LiftOff | `Leads_C_L_LiftOff_test.mp3` | -16.8 | -2.5 | 2096 |
| C.L_LiftOff | `Leads_C_L_LiftOff_chords.mp3` | -17.8 | -4.4 | 1832 |
| K.U_SynFat | `Bass_K_U_SynFat_test.mp3` | -16.1 | -2.6 | 1469 |
| K.U_SynFat | `Bass_K_U_SynFat_chords.mp3` | -17.6 | -4.7 | 1149 |
| D.D_EWFKalimba | `Bells_and_Plucks_D_D_EWFKalimba_test.mp3` | -26.6 | -6.9 | 1706 |
| D.D_EWFKalimba | `Bells_and_Plucks_D_D_EWFKalimba_chords.mp3` | -29.0 | -1.8 | 1722 |
| M.L_FLUTE-01 | `Woodwinds_M_L_FLUTE_01_test.mp3` | -16.7 | -4.0 | 2206 |
| M.L_FLUTE-01 | `Woodwinds_M_L_FLUTE_01_chords.mp3` | -18.2 | -4.7 | 1654 |

No file clips; none is silent. Sustained sounds land at -16 to -19 dBFS RMS. Plucked and percussive sounds (WatermelonClav, EL-PIANO-01, EWFKalimba) sit at -21 to -29 dBFS RMS. Their crest factor is 20 to 27 dB (a 30 ms decay with an AL filter burst), so the peak guard, not the RMS target, sets their level. A limiter on the engine output would let them sit louder.

### v2, with the output limiter (November 2026)

`audition.py --out audition/v2 "Sub Osc and Motion/4@chords" "Keys and Organs/6@test" "Bells and Plucks/1@test" "Brass/1@chords"`:

| Preset | File | RMS dBFS | Peak dBFS | Before (table above) |
|-|-|-|-|-|
| K.U_S&H (sample and hold on pitch and filter, 16.6 Hz) | `v2/Sub_Osc_and_Motion_K_U_S_H_chords.mp3` | -14.2 | -1.1 | not banked |
| D.D_WatermelonClav | `v2/Keys_and_Organs_D_D_WatermelonClav_test.mp3` | -13.1 | -1.0 | -25.9 RMS, -4.2 peak |
| D.D_EWFKalimba | `v2/Bells_and_Plucks_D_D_EWFKalimba_test.mp3` | -13.5 | -1.3 | -26.6 RMS, -6.9 peak |
| C.L_Funfare | `v2/Brass_C_L_Funfare_chords.mp3` | -13.3 | -1.3 | not banked |

Those v2 loudness figures are historical. The old six-note peak guard allowed heavy limiter reduction, and the DETUNE scale was uncalibrated; neither is used to judge the current library.

### v3, after the mapping and bank audit (November 2026)

Four new MP3s are in `audition/v3/`. The six-note peak guard is about +4 dBFS before the limiter, leaving at most 6.4 dB measured gain reduction in the 128 curated Arturia patches. Detune is neutral until V2 can be measured, and no reverb is added. The earlier 95 sounds remain ahead of these imports in the public banks.

| Sound | MP3 | RMS | Peak |
|---|---|---:|---:|
| K.U PWMchorus, strings | `v3/Strings_K_U_PWMchorus_chords.mp3` | −12.0 dBFS | −1.6 dBFS |
| J.M.B HPF Pad2 | `v3/Pads_J_M_B_HPF_Pad2_chords.mp3` | −13.5 dBFS | −1.0 dBFS |
| GTD HarpiSynth | `v3/Bells_and_Plucks_GTD_HarpiSynth_test.mp3` | −16.6 dBFS | −1.0 dBFS |
| K.U S&H, sub-oscillator motion | `v3/Sub_Osc_and_Motion_K_U_S_H_chords.mp3` | −14.8 dBFS | −1.2 dBFS |

The HarpiSynth is quieter because its attack would otherwise drive the limiter too hard. This is a deliberate tradeoff, not an acoustic match to Arturia. The 20-preset measurement pass is in `spot-audit.md`.

## Caveats

- Word names are solid; scalings are not. Envelope times, LFO and delay rates use the V4 manual ranges with exponential travel. Arturia's real V2 curves may differ at mid travel. Feet, Mix direction and the inverted bottom-panel levers were inferred from corpus statistics (see `mapping.md`). If a preset sounds an octave off, or its vibrato looks backwards, check those first.
- The modulation matrix is not translated at all. 451 presets use it, and the source and destination lists are not public. Hosting CS-80 V2 and stepping each item would settle it.
- Nothing here was compared by ear against Arturia's plugin. The checks are the cs80v2 renders: level, peak, spectral centroid, attack time, silence.
- `fx.reverb_mix` is zero because Arturia V2 has no reverb. The delay maps to `fx.echo_mode` 1 (line) with a guessed time curve, and the mix is capped at 0.5.
- Per-channel keyboard tracking (OSC KEYB) is always on in the corpus, so nothing is lost there. cs80v2's own `key_track` stays at its default.
- `tools/cs80v2.wasm` is a snapshot. After any engine change, rerun `python3 translate.py --refresh-wasm` to re-level against the new build (about 10 minutes on fl1).
- Arturia's factory files are not in this repository. `translate.py` reads them from `Arturia CS80V Factory Presets for Logic - All/`, so re-running it needs your own copy of the CS-80V presets. The translated library and Arturia's preset names are published; the raw files, `decoded.json` and the per-preset audition MP3s are not.

### v4, after the chart calibration (November 2026)

Detune now follows the fitted ±15-cent curve and envelope times the `egtmap` curve (see `CALIBRATION.md`). Four MP3s in `audition/v4/`, slow chords:

| Sound | MP3 | RMS | Peak |
|---|---|---:|---:|
| Porcaro Brass (chart): Yamaha Brass 1 + Brass 2, detune centred | `v4/Brass_Porcaro_Brass__chart_chords.mp3` | −11.8 dBFS | −1.3 dBFS |
| C.L_Funfare (Arturia brass, −4.2 ct) | `v4/Brass_C_L_Funfare_chords.mp3` | −13.1 dBFS | −1.5 dBFS |
| K.U_HPFsine (Arturia pad, −2.7 ct) | `v4/Pads_K_U_HPFsine_chords.mp3` | −13.5 dBFS | −1.4 dBFS |
| C.L_Rhodesesque (Arturia keys, −6.5 ct) | `v4/Keys_and_Organs_C_L_Rhodesesque_chords.mp3` | −12.2 dBFS | −1.0 dBFS |

