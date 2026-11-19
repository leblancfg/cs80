# Changelog

## v0.1.1 (2026-11-19)

- Level: the library sits at -18.5 dBFS RMS on the chord test instead of -13, so a brass chord peaks near -6.5 dBFS and raising a level slider has room. The old builder allowed 8 dB of limiting on that chord, which left half the library in the limiter. The level sliders themselves were not mis-scaled: they are linear everywhere, and a log taper does not balance Yamaha's preset tones any better (REPORT-v2.md section 13).
- Limiter: a stereo-linked look-ahead peak limiter (1.5 ms, 4 dB soft knee, release that adapts to how long it has been limiting) replaces the block-rate gain and soft clip. A gentle tanh clip above -0.5 dBFS is the last resort and did not act in any test render. Across the 160 presets on the chord test, the presets with more than 1% of samples above 1 dB of gain reduction went from 78 to 0. The output meter stays.
- Brilliance Mix follows the faceplate: lever up is channel I, down is channel II. The fixed CC maps and the Balance macro follow, and every preset sounds as before.
- User bank: 16 slots saved in the browser. Save and Save as… sit under the preset name (Ctrl+S saves), with overwrite confirmation, Rename, Delete, Undo, and Export / Import as JSON. "Save to current user slot" is a learnable controller action (on Record by default). Program change, with bank select on CC 0, now loads presets from any bank, User slots included.
- The panel no longer marks Echo, Reverb and Master as "not on the CS-80".
- Favicon: a purple circle.

## v0.1.0 (2026-11-19)

First public release.

- cs80v2 engine: two CS-80 channels per voice, each with its own VCO, high-pass and low-pass filters and envelopes, plus sub-oscillator, ring modulator, touch response (initial and after), echo, plate and chorus. Builds for the host, WebAssembly and the ESP32-S3.
- Web app at https://leblancfg.com/cs80/: AudioWorklet player, Web MIDI with a Learn wizard tuned for the M-Audio Oxygen 49, performance macros and an on-screen keyboard.
- 160-sound library, level-matched: 23 chart presets from Yamaha's manual and Vangelis and Porcaro panels, the earlier translated sounds, and translations of Arturia's CS-80V factory presets.
- Translators and audit tools for the preset libraries (`presets/`).
