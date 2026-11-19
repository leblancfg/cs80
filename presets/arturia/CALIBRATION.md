# Calibrating the Arturia CS-80V translation against known CS-80 settings

Working notes, November 2026. A cut-off run should leave this file usable: each section says what is established, what is inferred and what is still open.

## Why

François played the translated library and found it bad. Detune came out at ±40 cents or more, which showed that the V2 value curves had never been calibrated. The previous pass set detune to 0 cents and labelled every other curve "provisional". This pass anchors on published real-CS-80 panel settings (Steve Porcaro's Toto sounds, Vangelis, Yamaha's own sheets) and compares them control by control with the stored Arturia values and with cs80v2's own panel scaling.

## State at the start of this pass

- Translator: `detune_cents = 0`, raw value kept as `detune_raw`, two-channel patches with |x − 0.5| ≥ 0.2 kept out of the curated banks; reverb removed; names unshortened.
- Library: 8 Core (own bank) + 95 scouted + 128 Arturia = 231 sounds. The brief asks for 128 to 160 in total, with Core and scouted assigned to the banks that fit them.

## Local evidence on DETUNE (word 80), before any chart

All 768 files, dominant patch.

| Observation | Raw x | Old ±100-cent reading | Comment |
|---|---:|---:|---|
| Exact centre, most common value | 0.500 (107 files) | 0 | designers who never touched it, and the V1 default |
| V2 init patches (`two_osc`, `Matrix_init`, `EG_Synchro`, `Static_Synchro`, the `vca EG` and `Filtr` demos) | 0.6034 (25 files) | −20.7 ct | an init patch should be in tune or barely detuned |
| All seven `M.L_ORGAN-01..07`, both channels sounding, 16′ with 2 2/3′, 4′ or 2′ | 0.655 | −31 ct | an organ with a 31-cent sour layer is not credible from a professional designer |
| `C.L_Piano1`, `C.L_PianoPlus`, `C.L_SteelDrums` | 0.200 | +60 ct | same objection |
| `C.L_Rhodesesque` | 0.830 | −66 ct | same |
| `C.L_DetuneYo`, `C.L_ColdShower` (effects named for detune) | 1.000 | −100 ct | the designer's "full detune" |
| Unison leads (`J.M.B_Unisson_1/2/3`, `4Notes_unisson`, `4Voices_Unisson`) | 0.17 to 0.35 | +30 to +66 ct | big, deliberate detune |

Per designer, the medians differ a lot: C.L 0.752, M.L 0.500, J.M.B 0.406, K.U 0.405, GTD 0.528, C.P 0.585. A linear reading puts whole designers' banks 25 to 50 cents out of tune. Either the V2 range is far smaller than ±100 cents, or its curve is strongly compressed near the centre, or both. The ordering is still informative: the patches named for detune sit at the extremes, and the in-tune instruments sit within about 0.3 of the centre.

## Charts

Every chart is in `presets/charts/charts.json` (written by `presets/charts/tools/make_charts.py`), built into cs80v2 presets by `presets/charts/chart_presets.mjs` through the engine's own panel curves. Source scans and frames are in `presets/arturia/charts/sources/`. The three largest files are kept out of git (`.gitignore` there); fetch them from the URLs below.

| Chart | Source | Panel positions (as read) | Nearest Arturia preset |
|---|---|---|---|
| Yamaha preset tones ×22 (Strings 1–4, Brass 1–3, Flute, Electric Piano, Bass, Clavichord 1–2, Harpsichord 1–2, Organ 1–2, Guitar 1–2, Funky 1–4) | [CS-80 owner's manual](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) pp. 28–30, "Using the programmable panels to duplicate the preset patches" | 24 sliders + 2 switches per tone, read by image analysis against each slider's tick ladder, ±0.3 step. `presets/charts/yamaha_preset_tones.json`, CSV beside the scans | No Arturia channel reproduces any tone (`match_arturia.py`: best RMS residual 0.6–3.0 steps, all with large single-control misses). Not recreations. |
| Yamaha step-by-step examples: Clarinet, Trumpet, Flute, Solo Violin, Oboe, Multiple Strings, Clavichord, Bells & Gongs, Timpani, Pizzicato | same manual, pp. 24–27 | track-end measurement, ±0.4; globals from the text (Multiple Strings: Feet 16′/8′, "detuning channel II slightly") | Clarinet ~ `M.L_REED-0x`, Flute ~ `M.L_FLUTE-0x`, Trumpet ~ `C.L_MeekTrumpets` (category matches only) |
| Mellow Strings | same manual, p. 50, felt-pen example on the blank diagram | ±0.5; detune mark slightly flat of centre; tremolo on | `K.U_GentleSyn` (category) |
| Porcaro brass ("Africa", "Human Nature") | Porcaro on CS-80 V4, [MusicTech video at 1:47](https://www.youtube.com/watch?v=EgDsAAtG5jk&t=107s); Anthony Marinelli's hardware CS-80 "Africa" [at 0:24](https://www.youtube.com/watch?v=GQyRf92gUKA&t=24s) | Tone selector BRA 1 (I) + BRA 2 (II) lit on both; V4: Detune and Pan at centre, Feet 8′/8′, sub osc and ring mod off. Hardware: same two buttons lit, Feet 8′/8′; Detune lever under an overlay, near the centre | `JMB2_Africa` (x = 0.697), `* J.M.B_Brass1`, `J.M.B_Brass2` (x = 0.500) |
| Vangelis "Tears in Rain" swell | Reverb Machine, [Tears in Rain article](https://reverbmachine.com/blog/vangelis-tears-in-rain-blade-runner/), CS-80 V4 patch "Tears in Rain Swell I" | I: saw, LPF 4.4, IL 10, AL 10, VCF A 10, D 8.3, R 6.3; VCA A 10, D 9.4, S 5.7, R 7.2; init bril 10, init level 10, after bril 4. II: saw, LPF 10, VCA D 6.4, S 10. Detune centre, Feet 8′/8′, Mix near I, sub sine speed 3 VCO 1.5, touch VCO 6, chorus on | `K.U_VG_FIRE`, `GTD_WEDCotF` (category) |
| Vangelis "Chariots of Fire" horn | Caustic on the [lookmumnocomputer forum](https://lookmumnocomputer.discourse.group/t/vangelis-brass-how-to/3365), CS-80 V3 screenshot | I: saw, Res H 2.1, LPF 4.5, Res L 6.8, IL 3.5, AL 8, VCF A 6.5, D 8, R 5.9, sine 2.9, VCA A 3.3, D 7.3, S 10, R 2.9, level 4.1, touch ~3.9 each. II similar (LPF 4.5, IL 3.3, AL 7.1). Detune just off centre, Feet 8′/8′, sub and ring off | `M.L_CHARIOT-01` (x = 0.620), `M.L_CHARIOT-02a/b` |

## Fitted relations

The Yamaha tones give real panel positions for every channel slider, but no Arturia factory patch is a recreation of one, so no control can be fitted point by point. The evidence is of three kinds: unit agreement (the Yamaha transcription and cs80v2's panel use the same printed scales), category statistics (`fit/cat_compare.py` in scratch: Arturia brass, strings and keys medians against Yamaha's), and the named patches above.

| Control | Old rule | New rule | Evidence | Confidence |
|---|---|---|---|---|
| Detune (word 80) | ±100 ct linear, then 0 ct | −15 ct × sign(2x−1)·(2x−1)², so ±15 ct at the ends | Hardware lever ±1 semitone (manual p. 49) but Porcaro's brass runs at the centre; V2 init, organs and pianos must be in tune; order kept (named-detune patches at 0 and 1). Inference | low–medium |
| Feet (RANGE) | 5 steps from the top, inverted | unchanged | the 223 files at x = 1.0 are 16′, the most common footage on Yamaha's own patches; init patches 8′ | high |
| HPF/LPF cutoff | exp 26.8 Hz–16.2 kHz / 37.1 Hz–20 kHz, identity | unchanged | Arturia LPF medians (brass 5.5, strings 8.1, keys 5.5) sit 0.3–1.6 steps above Yamaha's (3.9, 7.8, 3.8): same direction and order, no inversion | medium |
| Resonance H/L | 0.97·x | unchanged | 517/543 exact zeros, as on Yamaha's tones (most at 0) | medium |
| IL / AL | 5·x octaves below / above cutoff | unchanged | Yamaha prints IL 0…−5, AL 0…+5, and cs80v2 uses the same numbers; Arturia AL medians 5.9 (brass) vs Yamaha 7.0. An inverted IL would put 474 patches 5 octaves below cutoff | high (direction), medium (octave scale) |
| VCF/VCA A, D, R | pure exponential from 2 ms to 0.58/8.75/11 s and 0.885/7.35/11.5 s | same end points, t = lo + (hi − lo)(100^x − 1)/99 (engine `egtmap`, translator, web panel) | Yamaha sets R ≈ 2 on every string, wind and brass tone and R ≈ 4 on bells, pizzicato and clavichord. The old curve made those 11 ms and 60 ms, so strings and bells were choked; the electric piano's D 4.2 decayed in 63 ms. New: R 2 → 0.18 s, R 4 → 0.62 s, timpani R 6.6 → 2.3 s, E-piano D 4.2 → 0.44 s. Arturia's string releases (median 4.4) move from 0.09 s to 0.77 s. No inversion pattern in the category medians | medium |
| VCA S, levels | identity | unchanged | S medians 10/10 strings, 8.1/10 brass | high |
| Brilliance / Resonance (global) | inverted lever, ±3 oct / 0..1 | unchanged | lever-inversion audit (mapping.md); Yamaha's examples leave both centred / up | medium |
| Initial / after-touch brilliance and level | identity, 3 oct / 1.0 | unchanged | same printed 0–10 scales. Arturia's AFTER_LEVEL is 0 in 679 files (max 0.57) where Yamaha's brass and strings use 7–10: a designer habit (no after-touch keyboard), not a scale error | medium |
| Sub osc speed / VCO / VCF / VCA | inverted lever; 0.5–100 Hz, 12·x² st, 3 oct, x | unchanged | inversion audit; Yamaha examples use "slightly down" for vibrato, which gives 0.1 st here | medium |
| Touch response (bend, speed, VCO, VCF) | inverted lever | unchanged | inversion audit | medium |

## Chart presets in cs80v2

`node presets/charts/chart_presets.mjs` builds 23 presets named "… (chart)", in their banks ahead of the legacy and Arturia sounds. Porcaro Brass (chart) is the Brass 1 + Brass 2 tones with the detune at the centre, as on Porcaro's panel.

## Results (milestone: translator, engine and library rebuilt)

Detune across the 603 two-channel files (absolute cents):

| Rule | ≤ 1 | 1–3 | 3–6 | 6–12 | 12–25 | > 25 |
|---|---:|---:|---:|---:|---:|---:|
| old linear ±100 | 66 | 4 | 48 | 122 | 91 | 272 |
| interim (0) | 603 | 0 | 0 | 0 | 0 | 0 |
| new −15·sign(t)·t² | 340 | 136 | 101 | 18 | 8 | 0 |

All 768: median |detune| 19.0 → 0.5 ct, 90th percentile 51.4 → 4.0 ct, maximum 100 → 15 ct. With the detune known, the curated banks no longer exclude far-from-centre patches.

Engine change: the six envelope time sliders now go through `egtmap` (cs80v2/midimap.hpp, mirrored in translate.py and the web panel's `egt` mapping). End points are unchanged; the web panel and MIDI map feel slower in the lower half of travel. The wasm was rebuilt and copied to `tools/cs80v2.wasm`.

The Yamaha Organ 1 and Funky 1 tones put both resonances at 10 (Q ≈ 17 in cs80v2), so their chord test starts deep in the limiter. The library builder's level loop stopped after two refinements and left them 3–4 dB hot. It now iterates until every sound settles within 0.2 dB. Whether the CS-80's resonance really reaches Q 17 at 10 is open; the chart organ is dark (centroid 215 Hz), but it does not whistle.

Spot audit (22 sounds, `spot-audit.md`): Arturia detune beats on A4 are 0.7–1.7 Hz. Chart strings beat at 2 Hz (±8 ct from the manual's "slightly"). Releases moved to 0.45 s (strings), 0.6–1.05 s (pads) and 0.95 s (timpani), where they had been 0.05–0.1 s. Vibrato from "slightly down" sub-osc VCO reads 8–19 ct of wobble, about a player's vibrato. Porcaro Brass reaches its level in about 0.2 s; the t90 column's 2.25 s reflects a flat sustain, not a slow swell.

Library: 160 sounds = 23 chart + 8 Core + 95 scouted + 34 Arturia. All sit at −13 dBFS RMS, except plucks and clavs that the limiter guard holds lower (down to −24.8 dBFS for the scouted Honky Clav).

Still open: detune sign (follows the old rule); CS-80 resonance Q at 10; whether V3/V4 screenshots share V2's detune curve. Charts from Arturia screenshots enter their detune as centre.
