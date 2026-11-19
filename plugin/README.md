# CS80 plugin (v0.2)

The cs80v2 engine as a JUCE 9 plugin: an AUv2 instrument for GarageBand and Logic, plus VST3 and Standalone. Hosts list it as **leblancfg > CS80** (`aumu Cs80 Lbfg`, bundle ID `sh.leblanc.cs80`). It uses JUCE under the free Starter licence. JUCE 9.0.5 is fetched by CMake as a release tarball with a pinned sha256.

v0.1 was "Vile: CS80v2" (`aumu Cs8v Vile`). The codes changed in v0.2, so songs saved with v0.1 do not find it; re-insert CS80 on those tracks.

What it has:
- 109 parameters, one per Patch field, in engine units. The parameter ID is the field name (`I.lpf_hz`, `fx.echo_time`) and must never change, because songs store it. Labels, scaling and units come from `web/app.js`; ranges are the app's, widened where a library preset goes past them.
- The 160-sound library as factory programs, named "Bank / Name", in the host's own preset menu (AU factory presets in Logic and GarageBand). `-DCS80_SHARED_PRESETS=ON` drops the 34 Arturia CS-80V translations. Release builds have all 160.
- Exact preset loads. A program or saved state reaches the engine as a whole patch; the parameters are only updated for the host and the UI.
- State is a versioned XML map of field name to value, so songs survive new fields.
- MIDI: notes and velocity, pitch bend, mod wheel (CC1), volume (CC7), expression (CC11), sustain (CC64), channel and poly aftertouch, all-notes-off. Omni.
- Any host block size through a 32-frame carry buffer, with no added latency. MIDI applies at the start of the tick it falls in. The reported latency is the output limiter's 1.5 ms look-ahead (71 frames at 48 kHz).
- Continuous parameters ramp over about 10 ms. Echo-time changes glide over about 60 ms; that glide is opt-in in the engine, so the web and ESP32 builds keep their behaviour.
- Any sample rate. Each instance allocates its own echo and plate memory (`CS80_NO_STATIC_FX`).

## Faceplate

The editor is the web page's CS-80 panel in a WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), served from the binary with no network access. `plugin/ui/` holds the page: `face-defs.js` is the layout block of `web/app.js` (FACE, the lever scalings and value formats), copied verbatim by `gen_plugin_data.py`, so sections, lever order, cap colours, channel I/II rows and the Mix lever (up = channel I) match the web page. `face.css` is the faceplate part of `web/style.css`; `face.js` is `buildPanel`/`buildControl`/`fitPanel` from `app.js` with the worklet replaced by the plugin bridge.

Left out of the plugin page: the preset browser (the host's preset menu has the programs), the on-screen keyboard, Web MIDI and controller learning, the meter, and the web page's own Volume lever (the host's channel fader does that). Fields the web page has no lever for (key track, wheel VCO, echo damp/taps/pan/darken, reverb damp/bandwidth/predelay) stay host parameters.

Binding: the editor polls the 109 parameters at 30 Hz and sends changed values to the page, so automation and preset changes move the levers. A lever drag on the page is one host gesture (begin, values, end), so Logic records it as automation; wheel, arrow keys and rocker clicks are one gesture per step. Double-click puts a lever back to the current program's value. The page zooms to fit the window, and spare height goes to longer levers. The editor opens at 1240 × 500 and resizes from 760 × 320 to 2600 × 1300.

## Build

Linux (Debian or Ubuntu): `apt install cmake ninja-build pkg-config libasound2-dev libfreetype-dev libfontconfig1-dev libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libxext-dev libxcomposite-dev libxi-dev libwebkit2gtk-4.1-dev libgtk-3-dev`, then:

```sh
cmake -S plugin -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCS80_BUILD_TESTS=ON
ninja -C build
```

macOS (Xcode and cmake), universal arm64 + x86_64, ad-hoc signed:

```sh
cmake -S plugin -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build build --target CS80_AU CS80_VST3 -j 8
codesign --force --deep -s - build/CS80_artefacts/Release/AU/CS80.component
codesign --force --deep -s - build/CS80_artefacts/Release/VST3/CS80.vst3
cp -R build/CS80_artefacts/Release/AU/CS80.component ~/Library/Audio/Plug-Ins/Components/
killall -9 AudioComponentRegistrar; auval -v aumu Cs80 Lbfg
```

Windows (Visual Studio with the Clang tools, cmake, nuget): the editor uses WebView2, and the WebView2 loader is linked statically, so the plug-in needs no extra DLLs. The WebView2 runtime ships with Windows 10 and 11.

```sh
nuget install Microsoft.Web.WebView2 -Version 1.0.3485.44 -OutputDirectory %TEMP%\nuget
cmake -S plugin -B build -A x64 -T ClangCL -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DJUCE_WEBVIEW2_PACKAGE_LOCATION=%TEMP%\nuget
cmake --build build --config Release --target CS80_VST3
```

`.github/workflows/plugin.yml` builds the Windows and Linux VST3s (Linux on Ubuntu 22.04) and runs pluginval on them. `dist/` has the install notes that go in the release zips.

Regenerate the parameter table, presets and `ui/face-defs.js` after changing `web/app.js`, the library or the Patch fields: `python3 plugin/tools/gen_plugin_data.py`. Changes to the faceplate rules in `web/style.css` need copying into `ui/face.css` by hand.

## Tests

- `tools/ref_render.cpp` renders through the web wrapper built natively. `tools/wasm_render.mjs` renders through a `cs80v2.wasm`. `tools/vst3_render.cpp` (built with `CS80_BUILD_TESTS=ON`) renders through the plugin binary (VST3, or AU on macOS), with fixed or random block sizes, or after a state round trip. All three play `tools/score.txt`: chords, poly and channel aftertouch, bend, wheel and sustain, over 8 s. `tools/mkpreset.py N` writes library preset N in the format the renderers read.
- `tools/editor_check.cpp` opens the editor in a window, prints every parameter change and gesture the editor sends the host, and sets parameters from the host side (`"I LPF=300"`). With `CS80_UI_SELFTEST=1` the page reports what it receives and moves I LPF itself through its wheel handler.
- v0.1 results, 2026-11-19. The engine refactor is bit-exact against the previous engine, natively and as wasm, on 7 patches covering the echo line, replayed echo voices, the plate, the ring modulator and chorus. Plugin against the web wasm on library presets 4, 20, 40 and 109: −86 to −98 dB relative (VST3, x86) and −90 to −101 dB (AU, arm64). That matches the floor between native and wasm builds of the same code, which comes from float rounding. Random host block sizes are bit-exact with 128-frame blocks. A state round trip comes within −102 to −108 dB. 44.1, 48, 88.2 and 96 kHz renders match in level within 0.2 dB, with matching reverb tails.
- v0.2 results, 2026-11-19. Audio is bit-identical to v0.1 on presets 4, 20, 40 and 109 (AU universal on an M2 Mac, VST3 on Linux x86_64; random block sizes on Linux too); the AU state round trip is at −105 dB, as before. auval passes with no warnings and lists the 160 factory presets. pluginval 1.0.4 at strictness 10 passes on the Linux VST3, editor tests included (WebKitGTK prints non-fatal GTK criticals when pluginval opens and closes editors quickly). editor_check: on macOS (WKWebView, AU) the page received all 109 values, a wheel step on I LPF reached the host as gesture begin, value, end, and a host-side change to 300 Hz moved the lever; on Linux (WebKitGTK, VST3) the page loaded showing the host's 300 Hz, the wheel step arrived as one gesture, and a real mouse drag on I HPF (xdotool) arrived as one gesture with three values.

## Known limits

- In VST3, CCs, bend and channel pressure travel as parameter changes. Hosts can reorder them against notes that land on the same sample. AU is not affected.
- Not yet: MPE, AUv3, notarisation, Windows code signing, an installer.
