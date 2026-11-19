/* Headless render through the built plugin binary (VST3, or AU on macOS):
     cs80_vst3_render <plugin> <program> <score.txt> <seconds> <out.f32> [sr] [block|rand]
   Plays the shared score (blocks of 128 frames at 48 kHz, scaled to sr) into
   the plugin and writes interleaved float32 L R. "rand" uses random block
   sizes (1..700) to exercise the 32-frame carry buffer.
     cs80_vst3_render <plugin> --state <program> <score> <seconds> <out.f32>
   renders after a getState -> new instance -> setState round trip. */
#include <juce_audio_processors/juce_audio_processors.h>

#include "score.h"

static std::unique_ptr<juce::AudioPluginInstance> load(juce::String const& path, double sr, int bs)
{
    juce::AudioPluginFormatManager fm;
    juce::addDefaultFormatsToManager(fm);
    juce::OwnedArray<juce::PluginDescription> found;
    for (auto* f : fm.getFormats()) {
        if (!f->fileMightContainThisPluginType(path)) continue;
        f->findAllTypesForFile(found, path);
        if (!found.isEmpty()) break;
    }
    if (found.isEmpty()) { fprintf(stderr, "no plugin in %s\n", path.toRawUTF8()); return nullptr; }
    juce::String err;
    auto inst = fm.createPluginInstance(*found[0], sr, bs, err);
    if (!inst) fprintf(stderr, "load failed: %s\n", err.toRawUTF8());
    return inst;
}

int main(int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI gui;
    if (argc < 6) { fprintf(stderr, "usage: see source\n"); return 2; }
    juce::String const path = juce::File::getCurrentWorkingDirectory().getChildFile(argv[1]).getFullPathName();
    bool const viaState = juce::String(argv[2]) == "--state";
    int const a = viaState ? 3 : 2;
    int const program = atoi(argv[a]);
    auto score = load_score(argv[a + 1]);
    double const seconds = atof(argv[a + 2]);
    char const* outPath = argv[a + 3];
    double const sr = argc > a + 4 ? atof(argv[a + 4]) : 48000.0;
    juce::String const bmode = argc > a + 5 ? argv[a + 5] : "128";
    bool const rnd = bmode == "rand";
    int const bs = rnd ? 700 : bmode.getIntValue();

    auto inst = load(path, sr, bs);
    if (!inst) return 3;
    inst->setPlayConfigDetails(0, 2, sr, bs);
    inst->setCurrentProgram(program);
    if (viaState) {
        juce::MemoryBlock st;
        inst->getStateInformation(st);
        inst = load(path, sr, bs);
        inst->setPlayConfigDetails(0, 2, sr, bs);
        inst->setCurrentProgram((program + 7) % inst->getNumPrograms()); /* something else first */
        inst->setStateInformation(st.getData(), (int)st.getSize());
    }
    inst->prepareToPlay(sr, bs);
    fprintf(stderr, "plugin %s program %d \"%s\" latency %d sr %.0f\n", inst->getName().toRawUTF8(), inst->getCurrentProgram(),
            inst->getProgramName(inst->getCurrentProgram()).toRawUTF8(), inst->getLatencySamples(), sr);

    juce::int64 const total = (juce::int64)(seconds * sr);
    double const scale = sr / 48000.0;
    juce::AudioBuffer<float> buf(2, bs);
    juce::MidiBuffer midi;
    juce::Random rng(1234);
    FILE* out = fopen(outPath, "wb");
    size_t si = 0;
    std::vector<float> inter;
    for (juce::int64 t = 0; t < total;) {
        int const n = (int)juce::jmin<juce::int64>(rnd ? 1 + rng.nextInt(bs) : bs, total - t);
        midi.clear();
        for (; si < score.size(); ++si) {
            /* events sharing a block get consecutive frames, so that VST3, which
               carries CCs, bend and pressure as parameter changes, keeps the
               score's order; all still land on the same 32-frame tick */
            int k = 0;
            while (si > (size_t)k && score[si - 1 - (size_t)k].block == score[si].block) ++k;
            juce::int64 const at = (juce::int64)std::llround(score[si].block * 128 * scale) + k;
            if (at >= t + n) break;
            ScoreEv const& e = score[si];
            int const off = (int)(at - t);
            juce::MidiMessage m;
            if (!strcmp(e.kind, "on")) m = juce::MidiMessage::noteOn(1, e.a, (juce::uint8)e.b);
            else if (!strcmp(e.kind, "off")) m = juce::MidiMessage::noteOff(1, e.a);
            else if (!strcmp(e.kind, "bend")) m = juce::MidiMessage::pitchWheel(1, e.a);
            else if (!strcmp(e.kind, "cc")) m = juce::MidiMessage::controllerEvent(1, e.a, e.b);
            else if (!strcmp(e.kind, "cp")) m = juce::MidiMessage::channelPressureChange(1, e.a);
            else if (!strcmp(e.kind, "pp")) m = juce::MidiMessage::aftertouchChange(1, e.a, e.b);
            midi.addEvent(m, off);
        }
        buf.setSize(2, n, false, false, true);
        buf.clear();
        inst->processBlock(buf, midi);
        inter.resize((size_t)n * 2);
        for (int i = 0; i != n; ++i) { inter[2 * i] = buf.getSample(0, i); inter[2 * i + 1] = buf.getSample(1, i); }
        fwrite(inter.data(), sizeof(float), inter.size(), out);
        t += n;
    }
    fclose(out);
    inst->releaseResources();
    return 0;
}
