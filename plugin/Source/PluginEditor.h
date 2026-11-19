#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <bitset>
#include <map>

#include "PluginProcessor.h"

namespace cs80p {

/* The faceplate: plugin/ui (the web page's panel) in a WebView, served from
   the binary. Every lever is bound to its parameter both ways: the editor
   polls the parameters and sends changes to the page, and the page's edits
   come back as host gestures. Programs are left to the host's preset menu. */
class CS80Editor : public juce::AudioProcessorEditor, private juce::Timer {
  public:
    explicit CS80Editor(CS80Processor&);
    ~CS80Editor() override;
    void paint(juce::Graphics&) override;
    void resized() override;

  private:
    void timerCallback() override;
    void onPageEvent(juce::var const&);
    std::optional<juce::WebBrowserComponent::Resource> resource(juce::String const& url);

    CS80Processor& proc;
    bool const selftest; /* CS80_UI_SELFTEST set: the page moves a lever itself and logs to stderr */
    juce::WebBrowserComponent web;
    std::map<juce::String, int> index; /* field name -> parameter index */
    float sent[NUM_PARAMS];            /* values the page has; NaN = not yet */
    std::bitset<NUM_PARAMS> gesture;   /* parameters inside a begin/end gesture from the page */
    bool pageReady = false;
    int shownProgram = -1;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CS80Editor)
};

}  // namespace cs80p
