# Changelog

## v0.1.0 (2026-11-19)

First public release.

- cs80v2 engine: two CS-80 channels per voice, each with its own VCO, high-pass and low-pass filters and envelopes, plus sub-oscillator, ring modulator, touch response (initial and after), echo, plate and chorus. Builds for the host, WebAssembly and the ESP32-S3.
- Web app at https://leblancfg.com/cs80/: AudioWorklet player, Web MIDI with a Learn wizard tuned for the M-Audio Oxygen 49, performance macros and an on-screen keyboard.
- 160-sound library, level-matched: 23 chart presets from Yamaha's manual and Vangelis and Porcaro panels, the earlier translated sounds, and translations of Arturia's CS-80V factory presets.
- Translators and audit tools for the preset libraries (`presets/`).
