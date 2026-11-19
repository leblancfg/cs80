# cs80

A polyphonic synth modelled on the Yamaha CS-80, meant to be tiny enough to fit in an ESP32-S3 with 8MB PSRAM. The C++ engine can also:
1. run in the browser as WebAssembly in an AudioWorklet with Web MIDI
2. run as VST or AU plug-ins into your favourite DAW

Play it at https://leblancfg.com/cs80 with your own MIDI controller.

The controls are currently tuned specifically for an M-Audio Oxygen 49 (MKV): in the web app, the Learn wizard maps its knobs, sliders and pads, and slider 9 stands in for the aftertouch it lacks. Other controllers will also work through Learn too, but the 'tutorial' won't make sense.

The library has 160 sounds: Yamaha manual patches, Vangelis and Porcaro panels, and translations of popular presets. Your own sounds go in the User bank (Save, under the preset name), which stays in the browser and exports to JSON.

MIT licensed.
