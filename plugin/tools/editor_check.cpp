/* Opens the plugin's editor in a window and checks its parameter binding:
     cs80_editor_check <plugin> <program> <seconds> [field=value ...]
   Loads the plugin (VST3, or AU on macOS), selects a program, opens the
   editor and runs the message loop. Every parameter change and gesture the
   editor sends to the host is printed. After 3 s each field=value (engine
   units, through the parameter's text) is set from the host side, so the
   faceplate should move. Fields are parameter IDs (VST3) or names ("I LPF", AU).
   With CS80_UI_SELFTEST=1 the page also moves I LPF itself and logs.
   Prints the window's bounds for screenshots. */
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

struct Watch : juce::AudioProcessorParameter::Listener {
    void parameterValueChanged(int i, float v) override
    {
        auto* p = params[i];
        if (v == last[i]) return; /* AU hosts repeat notifications */
        last.set(i, v);
        printf("host <- editor: %s = %s (%.4f)\n", p->getName(40).toRawUTF8(), p->getText(v, 40).toRawUTF8(), (double)v);
        fflush(stdout);
    }
    void parameterGestureChanged(int i, bool starting) override
    {
        printf("host <- editor: %s gesture %s\n", params[i]->getName(40).toRawUTF8(), starting ? "begin" : "end");
        fflush(stdout);
    }
    juce::Array<juce::AudioProcessorParameter*> params;
    juce::Array<float> last;
};

int main(int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI gui;
    if (argc < 4) { fprintf(stderr, "usage: see source\n"); return 2; }
    juce::String const path = juce::File::getCurrentWorkingDirectory().getChildFile(argv[1]).getFullPathName();
    juce::AudioPluginFormatManager fm;
    juce::addDefaultFormatsToManager(fm);
    juce::OwnedArray<juce::PluginDescription> found;
    for (auto* f : fm.getFormats())
        if (f->fileMightContainThisPluginType(path)) { f->findAllTypesForFile(found, path); if (!found.isEmpty()) break; }
    if (found.isEmpty()) { fprintf(stderr, "no plugin in %s\n", path.toRawUTF8()); return 3; }
    juce::String err;
    auto inst = fm.createPluginInstance(*found[0], 48000.0, 256, err);
    if (!inst) { fprintf(stderr, "load failed: %s\n", err.toRawUTF8()); return 3; }
    inst->setPlayConfigDetails(0, 2, 48000.0, 256);
    inst->setCurrentProgram(atoi(argv[2]));
    inst->prepareToPlay(48000.0, 256);

    Watch watch;
    watch.params = inst->getParameters();
    for (auto* p : watch.params) { watch.last.add(p->getValue()); p->addListener(&watch); }

    std::unique_ptr<juce::AudioProcessorEditor> ed(inst->createEditorIfNeeded());
    if (!ed) { fprintf(stderr, "no editor\n"); return 4; }
    juce::DocumentWindow win(inst->getName() + " editor check", juce::Colours::black, 0);
    win.setUsingNativeTitleBar(true);
    win.setContentNonOwned(ed.get(), true);
    win.setTopLeftPosition(40, 60);
    win.setVisible(true);
    printf("editor %d x %d, program \"%s\"\n", ed->getWidth(), ed->getHeight(),
           inst->getProgramName(inst->getCurrentProgram()).toRawUTF8());
    auto const sb = win.getScreenBounds();
    printf("window %d %d %d %d\n", sb.getX(), sb.getY(), sb.getWidth(), sb.getHeight());
    fflush(stdout);

    juce::MessageManager::getInstance()->runDispatchLoopUntil(3000);
    for (int a = 4; a < argc; ++a) {
        juce::String const s(argv[a]);
        juce::String const id = s.upToFirstOccurrenceOf("=", false, false), val = s.fromFirstOccurrenceOf("=", false, false);
        for (auto* p : watch.params) {
            auto* hp = dynamic_cast<juce::HostedAudioProcessorParameter*>(p);
            if (!hp || (hp->getParameterID() != id && p->getName(64) != id)) continue;
            float const v = p->getValueForText(val);
            watch.last.set(watch.params.indexOf(p), v);
            p->setValueNotifyingHost(v);
            printf("host -> editor: %s = %s\n", id.toRawUTF8(), p->getCurrentValueAsText().toRawUTF8());
        }
    }
    fflush(stdout);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(juce::jmax(0, (int)(atof(argv[3]) * 1000.0) - 3000));
    for (auto* p : watch.params) p->removeListener(&watch);
    win.clearContentComponent();
    ed.reset();
    puts("closed");
    return 0;
}
