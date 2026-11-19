# Arturia CS-80V / CS-80 V2 preset chunk: index map

The 768 Logic `.aupreset` files are Apple plists with `name`, `data` and (in 345 files) `manufacturer` 1098011765 ("Artu"), `type` "aumu", `subtype` 1131624498 ("CS82"), `version` 0. There are no AU parameter dictionaries; everything is in `data`.

`data` is a raw little-endian float32 array with no header:

| Bytes | Words | Content |
|-|-|-|
| 0 to 4543 | 0 to 1135 | 8 patches of 142 words (568 bytes). Patch n starts at word 142 n |
| 4544 to 5191 | 1136 to 1297 | voices, keyboard zones, performance panel, effects, arpeggiator |
| 5192 to 5255 | | preset path as text, e.g. `(new_V2)_C.Giudicelli/Basses/Acc-Basstone` |
| 5256 to end | 1314 to 1348 | performance state, poly card count, CS-80 tuning trims, ring mod switch |

5,392-byte files (423) come from the first CS-80V; 5,396-byte files (345) from CS-80 V2, which appends one word (the editor's selection).

## Evidence and confidence

The word names below come from a public decoder: `abletoolz/plugins/state/data/cs-80-v.json` in https://github.com/elixirbeats/abletoolz (MPL-2.0). Its author read the offsets off CS-80 V2 2.7.0.76's native parameter getter/setter, cross-checked them against Arturia's own CS-80 V3 ports of the same factory patches, and states that switches are stored as 0.25 (off) / 0.75 (on) and read as on from 0.5. I checked the names against the corpus:

- Patch period: words 0..141 repeat every 142 words; patches 5 to 8 are identical init patches in all 768 files, and each voice's `NUM_PATCH_VOIE` points at the patch that holds the sound (28 files keep their sound in patch 2, with patch 1 left at init).
- Channel II is channel I + 39 words: the diagnostic `Waveforms` presets change exactly the paired words (`saw`, `Square`, `Sinusoid`, `Noise`, `PWM`, `Triangle`, `two_osc`).
- Switch words hold only 0, 0.25, 0.75, 1; item words hold integers; zone ends hold MIDI notes 24 to 120.

So the **names** are high confidence. The **scaling** of each value (how 0..1 becomes Hz, seconds or octaves in Arturia's engine) is not published for V2. I used the curves in `cs80v2/midimap.hpp`, which follow the CS-80 V4 manual's printed ranges (abletoolz reports V3 runs V2's scalar curves, and V4 is V3's successor). Where a scaling was inferred from data rather than documentation, the table says so.

Confidence: **H** = name from the decoder and behaviour confirmed by the corpus; **M** = name from the decoder, scaling or direction inferred; **L** = meaning partly unknown.

## Per channel (channel I word; channel II = +39)

| Word | Arturia name | CS-80 control | cs80v2 field | Mapping | Conf. |
|-|-|-|-|-|-|
| 0 | RANGE1 | Feet | `feet_I` / `feet_II` | 6-step knob stored as lever position: round((1 - x) * 5) gives 0 = 16', 1 = 8', 2 = 5 1/3', 3 = 4', 4 = 2 2/3', 5 = 2'. Evidence: init 0.8 = 8'; Basses median 0.91 (lower); differences between the channels cluster at 0.2 (one step) and 0.4; V4 manual lists exactly six Feet settings. Values between steps (sync sweeps, 0.74/0.77 in basses) are snapped | M |
| 1 | OSC1_WIDTH | PW | `pw` | 0.4 x (50 % to 90 %) | H |
| 2 | OSC1_SINUS | Sine level | `sine_level` | x, forced to 0 when word 35 is off | H |
| 3 | OSC1_NOISE | Noise | `noise` | x | H |
| 4 | OSC1_ACCORD | channel tuning | none | 0.5 in 766 files, ignored | M |
| 5, 6 | CUTOFF_HIGHT1, RES_HIGHT1 | HPF, Res H | `hpf_hz`, `hpf_res` | 26.8 Hz to 16.2 kHz exponential; 0.97 x | H |
| 7, 8 | CUTOFF_LOW1, RES_LOW1 | LPF, Res L | `lpf_hz`, `lpf_res` | 37.1 Hz to 20 kHz exponential; 0.97 x | H |
| 9 | LEVEL_VCF1 | VCF level | `vcf_level` | x | H |
| 10 | VOLUME_VCA1 | channel Level (touch-response floor) | `level` | x; 0 mutes the channel (66 files mute channel II) | H |
| 11 to 14 | INITIAL_BRILLANCE1, INITIAL_LEVEL1, AFTER_BRILLANCE1, AFTER_LEVEL1 | touch response | `init_bril`, `init_level`, `after_bril`, `after_level` | 3 x octaves, x, 3 x octaves, x | H |
| 15 | LFO1_SPEED | PWM speed | `pwm_hz` | 0.1 to 40 Hz exponential | H name, M scale |
| 16 | LFO1_DEPTH_PWM | PWM depth | `pwm_depth` | 0.4 x | H |
| 17 | LFO1_WAVE | PWM LFO wave (Arturia extra; CS-80 is sine only) | dropped | values mostly 1.0 or 0; item order unknown | L |
| 18 | LFO1_TRIGG | PWM LFO key retrigger (extra) | dropped | | M |
| 19 | LFO1_SYNC | PWM LFO tempo sync (extra) | flagged | | M |
| 20, 21, 23 | ATTACK/DECAY/RELEASE_TEMPS_VCF1 | VCF EG A, D, R | `fa`, `fd`, `fr` | 2 to 580 ms, 2 ms to 8.75 s, 2 ms to 11 s, through `egtmap` (lo + (hi − lo)(100^x − 1)/99) | H name, M scale |
| 22 | (unnamed) | | none | always 0 | |
| 24, 25 | INIT_LEVEL_VCF1, ATTACK_LEVEL_VCF1 | IL, AL | `il`, `al` | 5 x | H |
| 26 to 29 | ATTACK/DECAY_TEMPS_VCA1, SUSTAIN_LEVEL_VCA1, RELEASE_TEMPS_VCA1 | VCA A, D, S, R | `a`, `d`, `s`, `r` | 2 to 885 ms, 2 ms to 7.35 s, x, 2 ms to 11.5 s; times through `egtmap` | H name, M scale |
| 30, 31 | (unnamed) | | none | constant 0 and 1 | |
| 32 | OSC1_SAW_TRI | Saw switch, plus Arturia's triangle | `saw` | three items stored at 1/6 off, 1/2 triangle, 5/6 saw (the `saw` and `Triangle` demo presets) | H |
| 33 | OSC1_SQR | Square switch | `square` | on from 0.5 | H |
| 34 | OSC1_KEYB | keyboard tracking off (extra) | none | always 0 | M |
| 35 | OSC1_ON_SIN | sine on/off (Arturia; V3 hides it) | gates `sine_level` | | H |
| 36, 37 | ON_HIGHT1, ON_LOW1 | HPF / LPF in or out (extra) | `hpf_hz` 26.8, `lpf_hz` 20 k when out | the CS-80 has no bypass; out = fully open | H |
| 38 | FILTRE1_TYPE | Arturia filter-type switch | ignored, noted | meaning unconfirmed | L |

## Per patch, shared

| Word | Arturia name | Meaning | cs80v2 field | Conf. |
|-|-|-|-|-|
| 78 | OSC1_SYNCHRO | oscillator sync (extra) | dropped, flagged | H |
| 79 | OSC2_DERIVE | unknown switch ("drift"?) | ignored | L |
| 80 | DETUNE | Channel II detune, bipolar around 0.5 | `detune_cents` = −15·sign(2x−1)·(2x−1)²: ±15 ct at the ends, 0.6 ct for the V2 init value 0.6034. Raw x kept in metadata. Inferred from the chart and corpus anchors in [CALIBRATION.md](CALIBRATION.md) | H name, M curve, L sign |
| 81 | MIXE | balance I / II | `mix` = 1 - 2x. MIXE 1.0 is channel I only: files that mute channel II sit at 0.5 to 1.0 and files that mute channel I sit at 0 | M |
| 82 + 3k, 83 + 3k, 84 + 3k (k = 0..9) | MODULATIONnn_OUTPUT, _INPUT, _AMOUNT | Arturia modulation matrix: output 0..38 (38 = none), input 0..13 (13 or 14 = none), amount bipolar around 0.5 | not translated; counted. The source and destination labels are not public | H layout, L labels |
| 112 to 141 | (unnamed) | 10 more slots in the same pattern, unused in all files | | |

## Global

### Detune re-audit (November 2026)

Arturia's [CS-80V 2.6 manual](https://downloads.arturia.com/products/cs-80v/manual/CS80V_Manual_2_6_0_EN.pdf), p. 41, identifies DETUNE as the tuning of the second synthesis line, but gives no cents range or response curve. The per-voice DET values on pp. 20 and 65 are **different controls**. The [V4 manual](https://dl.arturia.net/products/cs-80v/manual/cs-80-v_Manual_4_0_0_EN.pdf) gives a ±100-cent range for *Stereo Detune*; that does not calibrate V2's stored DETUNE word. The abletoolz decoder establishes field identity, not its sign or scale.

Across 768 V2 files, stored x has q10/median/q90 of 0.278/0.484/0.735. The former `100(1−2x)` rule put 206 above 40 cents absolute, including 164 of 603 patches with both channels audible. It placed the two-channel `Matrix_init` at −20.7 cents. Exact 0.5 is common (106 files), but the neutral point and direction are not measured. The old rule was therefore not defensible as a faithful translation.

The interim pass used 0 cents. The chart pass (see [CALIBRATION.md](CALIBRATION.md)) restores the control with a compressed curve, `−15·sign(t)·t²` cents with t = 2x − 1. Anchors: the CS-80's lever is ±1 semitone and linear (owner's manual p. 49), yet Porcaro's Brass 1 + Brass 2 runs with it at the centre. The V2 init patches (x = 0.6034) come out at 0.6 ct, the M.L organs (0.655) at 1.4 ct, the C.L pianos (0.200) at 5.4 ct and `C.L_DetuneYo` (1.0) at the full 15 ct. Across the 603 two-channel patches, none now exceed 15 ct. The sign follows the old rule and is still unmeasured. A host readout of V2's knob would replace the inference.

### Control-by-control sanity check

The [V2 manual](https://downloads.arturia.com/products/cs-80v/manual/CS80V_Manual_2_6_0_EN.pdf) identifies the panel functions; the [V4 manual](https://dl.arturia.net/products/cs-80v/manual/cs-80-v_Manual_4_0_0_EN.pdf) supplies several endpoint ranges. Neither publishes V2's stored-value curves. Quantiles below are from all 768 files in [field-distribution.md](field-distribution.md), and refer to raw values, not physical units. “Provisional” means the mapping needs a V2 parameter readout or an Arturia audio comparison.

| Controls | CS-80 function and source evidence | Raw distribution / sanity check | Verdict |
|---|---|---|---|
| Waveform, PW, PWM | Two tone-generator lines with saw, square, noise and sine; Arturia also has triangle and PWM extras. The `Waveforms` patches identify switch encodings. | Switch words cluster on discrete values; PW and PWM depth span the interval. Triangle is substituted and flagged. | Field identity solid; gain and PWM-rate curves provisional. |
| Feet I/II | Six footage positions, from 16′ to 2′. V2 manual p. 41 lists the steps. | Both channels' raw median is 0.8, decoding to the common 8′ setting; values between steps are snapped. | Plausible direction, not independently calibrated. |
| Detune | Fine tuning of line II relative to I, V2 manual p. 41. | Raw q10/median/q90 0.278/0.484/0.735; the former ±100-cent rule put 164 audible two-channel patches above 40 cents. | **Former scale rejected.** Compressed ±15-cent curve fitted to the chart and corpus anchors (CALIBRATION.md); inference, medium confidence. |
| Mix I/II | Balance between the two lines. | Raw median 0.516; source patches with line II muted cluster toward the line-I end. | Direction inferred from muting; check with V2 audio. |
| HPF/LPF cutoff and resonance | Separate resonant filters on each line. Endpoints are taken from V4, not V2. | Line-I LPF cutoff q10/median/q90 0.195/0.540/0.875; LPF resonance 0/0.350/0.785. No wholesale endpoint saturation. | Names solid; frequency and Q curves provisional. |
| VCF A/D/R, IL/AL; VCA A/D/S/R | Filter contour and amplitude contour. Times use V4's end points through `egtmap`, fitted to Yamaha's preset releases (CALIBRATION.md); IL and AL use five octaves. | Line-I IL is zero in 474 files; AL median 0.414. This is compatible with an opening filter contour, but does not prove five octaves. | Time and contour scaling provisional. |
| Initial/after touch, keyboard control | Velocity/aftertouch change brightness, level, pitch or sub-osc speed; keyboard levers affect low/high registers. | TOUCH_VCO is 1.0 in 483 files, consistent with “none” at that end. KB_BRIL_LOW median 0.415 and exact 0.5 occurs 237 times. | Touch direction has corpus support; magnitude and keyboard signs provisional. |
| Sub oscillator | LFO wave, speed and pitch/filter/amplitude depth. | VIB_VCO is 1.0 in 651 files; S&H demos require an inverted wave index. Wave and amount direction pass the separate render audit below. | Direction supported; Hz and depth curves provisional. |
| Ring modulator | A/D envelope, depth, rate and enable switch. | The switch and voice gate determine whether the route is audible. Amounts alone do not establish knob direction. | Gate supported; rate/depth curves provisional. |
| Brilliance, Resonance | Global timbre controls on top of each line's filter settings. | Both raw medians are 0.5; brilliance q10/q90 0.380/0.551, resonance 0.437/0.586. That suggests a centre but does not prove sign or scale. | Provisional. The former blanket inversion claim was unsound. |
| Portamento/glissando/sustain | Glide and pedal behaviour; V2 has pedal gates that cs80v2 does not reproduce. | PORTAMENTO is zero in 583 files; the direct “off” direction is credible. | Direction supported; time curve and pedal behaviour approximate. |
| Chorus/tremolo, delay | Arturia effects, not original CS-80 voice controls. | CHORUS_DEPTH median 0.739 and maximum 1.100, so “normalized 0..1” is not universally true. DELAY_MIX median 0.191. | Type and enable switches plausible; depth, speed and delay-time curves provisional. |
| Reverb, level and velocity | V2 has no reverb. cs80v2's master gain is measured on rendered chords; velocity response is its own engine model. | The earlier translator added 12% reverb to every patch. The old +10 dBFS pre-limiter guard also allowed over 9 dB reduction on 24 of 137 curated patches. | Reverb removed; lower peak guard preserves transients. Level match is not source calibration. |

The sub-oscillator wave and depth words, and several touch amounts, have evidence for an inverted lever position: 1.0 is the minimum. This **does not establish the direction or physical scale** of Detune, Feet, Mix, Brilliance, Resonance, keyboard control or ring modulation. They must be checked separately. The V4 manual's lever convention and the abletoolz field names are clues, not a calibration of V2's stored values. The left-hand panel knobs are different again: portamento is 0 in 583 files. Raw distributions for every decoded field are in [field-distribution.md](field-distribution.md).

**Sub-oscillator audit, November 2026: the inversion holds for those words only.** `tools/subosc_audit.py` renders the 56 presets whose names promise motion (vibrato, S&H, LFO, ring, swarm, sweep, sequence) plus the Waveforms demo patches twice, as translated and with the sub-oscillator and ring-mod words read upright, and measures amplitude spread and pitch wobble on a held note (output in `audit_subosc.txt`). Three results decide the sub-oscillator direction:

- **The wave word.** All three presets named S&H (`S&H`, `GTD_S&H1`, `K.U_S&H`) store VIB_WAVE = 0.00. Inverted, that is item 5, sample and hold; upright it would be sine. No other reading makes the names fit.
- **Init patches.** Read upright, every Waveforms demo patch (`Sinusoid`, `Square`, `saw`, `two_osc`, `Matrix_init` and others) gets a full 12-semitone sub-oscillator vibrato, measured at 170 to 270 cents of pitch wobble. Inverted, they are steady (0 to 4 cents), as an init patch should be.
- **Named motion.** Inverted, `K.U_S&H` wobbles 179 cents (S&H on pitch and filter at 16.6 Hz), `Sub` 190 cents and `RingModBass` / `K.U_Ring` show the deepest amplitude motion in the set (0.27 to 1.5). Upright, `K.U_S&H` gets no sub-oscillator pitch depth at all and its wave turns into a sine.

Some motion names stay quiet when translated, and that is not the lever direction. `GTD_S&H1`, `Vibrators` and `HS_Eight-Strings` route the sub oscillator through the mod wheel (MODUL_TO_VIB), and cs80v2's wheel only reaches pitch, so the depth waits on the wheel. `Ring_Mod_Lead`, `RingThisBass` and `J.M.B_Magical_Ring` have the ring modulator switched off for voice 1. The `*_sequence` patches get their motion from Arturia's step sequencer and arpeggiator, which are not translated.

| Word | Arturia name | cs80v2 field | Mapping | Conf. |
|-|-|-|-|-|
| 1136 to 1143 | NUM_PATCH_VOIE1..8 | which patch each voice plays; the translator takes the patch most voices play | | H |
| 1144 to 1151 | AFFECTE_VOIE1..8 | voice to keyboard zone (4 = none) | split detection | H |
| 1152 to 1175 | PORTAMENTO_VOIE, RING_MOD_VOIE, EFFETS_VOIE (per voice) | gate portamento, ring mod and effects for voice 1 | | H |
| 1176 to 1207 | PANORAMIQUE, VOLUME, DETUNE, TRANSPOSE (per voice) | not translated; transpose not 0.5 is flagged | | H |
| 1209 | MODULATION_WHEEL_CONTROL | saved wheel position, ignored | | H |
| 1211 to 1230 | ZONEn_INPUT / INF / SUP / MODE / ARP | four keyboard zones | split detection only | H |
| 1231 | VIB_RATE | `sub_hz` | 0.5 to 100 Hz exponential of (1 - x) | M |
| 1232 to 1234 | VIB_AMOUNT_VCO / VCF / VCA | `sub_vco`, `sub_vcf`, `sub_vca` | 12 (1-x)^2 semitones, 3 (1-x) octaves, (1-x) | M |
| 1235 | VIB_WAVE | `sub_wave` | round((1-x) 5), Arturia order sine, saw down, saw up, square, noise, S&H mapped to cs80v2's order | M |
| 1236 to 1240 | RING_ATTACK, RING_DECAY, RING_DEPTH, RING_SPEED, RING_MODULATION | `ring_a`, `ring_d`, `ring_depth`, `ring_hz`, `ring_mod` | V4 ranges of (1 - x) | M |
| 1345 | ON_RINGMOD | ring modulator on (with RING_MOD_VOIE1) | | H |
| 1241, 1242 | BRILLANCE, RESONANCE | `brilliance` = 3 (1 - 2x) octaves; `resonance` = max(0, 1 - 2x) | bipolar | M |
| 1243 | TOUCH_INITIAL | `init_bend` | 2 (1 - x) semitones | M |
| 1244 to 1246 | TOUCH_SPEED, TOUCH_AMOUNT_VCO, TOUCH_AMOUNT_VCF | `at_sub_speed`, `at_sub_vco`, `at_sub_vcf` | 3 (1-x), 2 (1-x)^2, 2 (1-x) | M |
| 1247 to 1250 | KEYB_BRILLANCE_LOW / HIGHT, KEYB_LEVEL_LOW / HIGHT | `kbd_bril_low/high` = 2 (1 - 2x); `kbd_level_low/high` = 1 - 2x | bipolar | M (sign follows the lever rule, not separately confirmed) |
| 1251 | VOLUME | not used; `master` is level-matched instead | | H |
| 1252 | PORTAMENTO | `porta_time` = 2 x^2 s per octave | | H name, M scale |
| 1267 | GLISSENDO | `gliss` | | H |
| 1253, 1254 | SPEED_CHORUS, DEPTH_CHORUS | `chorus.chorus_hz` 0.4 to 5 Hz, `chorus.trem_hz` 1.18 to 16.3 Hz, depths = x | | M |
| 1255, 1256 | ON_CHORUS, TYPE_CHORUS | `chorus.chorus_on` or `chorus.trem_on` (TYPE on = tremolo) | | M (type polarity inferred) |
| 1257 to 1261 | SPEED_DELAI, DEPTH_DELAI, DRY_WET_DELAI, ON_DELAI, SYNC_DELAI | `fx.echo_mode` 1 (line), `fx.echo_time` 30 ms to 1.3 s, `fx.echo_fb` 0.9 x, `fx.echo_mix` x capped at 0.5 | | L (time curve and direction unknown) |
| 1262 to 1266 | PEDALE_SUSTAIN_ON, PEDALE_PORTAMENTO_ON, SUSTAIN_TIME, MODUL_TO_VIB, SUSTAIN_MODE | `sustain_time` 9 x^2 s, `sustain_mode`; MODUL_TO_VIB moves the sub-oscillator pitch depth to `wheel_vco` | | M |
| 1268, 1269 | PEDALE_EXPRESSION, PEDALE_WHA | ignored | | H |
| 1270 to 1276 | ARP_* | arpeggiator; ARP_PLAY on marks the preset skip | | H |
| 1277 to 1280 | TRAPPE_MODUL, TRAPPE_MULTI, PITCH_BEND_* | editor panel state, bend range; ignored | | H |
| 1335 to 1344 | NBR_POLY_CARTE, CS_80_TUNE, CS_80_DETUNE1..8 | voice-card trims; cs80v2 has its own `drift` | | H |

## Known gaps

- Arturia's exact curves for times, rates and the delay are not published for V2. Envelope times use V4's end points with the `egtmap` curve fitted to Yamaha's own preset settings (CALIBRATION.md); rates and the delay use exponential travel.
- Modulation matrix source and destination names are unknown, so no slot is translated. Presets that use 1 to 3 slots are `approximate`, 4 or more are `skip`.
- The filter-type switch (word 38) and OSC2_DERIVE (79) are ignored.
