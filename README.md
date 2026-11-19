# cs80

A polyphonic synth modelled on the Yamaha CS-80, meant to be tiny enough to fit in an ESP32-S3 with 8MB PSRAM. The C++ engine can also:
1. run in the browser as WebAssembly in an AudioWorklet with Web MIDI
2. run as VST or AU plug-ins into your favourite DAW

Play it at https://leblancfg.com/cs80 with your own MIDI controller.

The controls are currently tuned specifically for an M-Audio Oxygen 49 (MKV): in the web app, the Learn wizard maps its knobs, sliders and pads, and slider 9 stands in for the aftertouch it lacks. Other controllers will also work through Learn too, but the 'tutorial' won't make sense.

The library has 160 sounds: Yamaha manual patches, Vangelis and Porcaro panels, and translations of popular presets. Your own sounds go in the User bank (Save, under the preset name), which stays in the browser and exports to JSON.

## Download

The plug-ins are on the [latest release](https://github.com/leblancfg/cs80/releases/latest): AU and VST3 for macOS (Apple silicon and Intel), VST3 for Windows and Linux. Logic and GarageBand use the AU; Ableton Live, Cubase, FL Studio, Reaper, Bitwig and Studio One use the VST3. Your DAW lists it as leblancfg > CS80.

- macOS: copy `CS80.component` to `~/Library/Audio/Plug-Ins/Components/` and `CS80.vst3` to `~/Library/Audio/Plug-Ins/VST3/`. The build is ad-hoc signed, not notarized, so clear the quarantine flag once: `xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/Components/CS80.component ~/Library/Audio/Plug-Ins/VST3/CS80.vst3`
- Windows: copy the `CS80.vst3` folder to `C:\Program Files\Common Files\VST3\`.
- Linux: copy the `CS80.vst3` folder to `~/.vst3/`. The faceplate needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`).

The plug-in source and build notes are in [plugin/](plugin/).

MIT licensed. The plug-ins are built with [JUCE](https://juce.com), which CMake downloads at build time; JUCE has its own licence (AGPLv3 or the JUCE licence), and these builds use the free JUCE Starter licence.
