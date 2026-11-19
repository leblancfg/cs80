# cs80

A polyphonic synth modelled on the Yamaha CS-80. The C++ engine runs in the browser as WebAssembly in an AudioWorklet, and the same headers build for the host and an ESP32-S3.

Play it at https://leblancfg.com/cs80/ in a browser with Web MIDI.

The controls are tuned for an M-Audio Oxygen 49 (MKV): the Learn wizard maps its knobs, sliders and pads, and slider 9 stands in for the aftertouch it lacks. Other controllers work through Learn too.

The library has 160 sounds: Yamaha manual patches, Vangelis and Porcaro panels, and translations of Arturia's CS-80V factory presets under their original names.

MIT licensed.
