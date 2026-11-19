#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <map>

#include "EngineHost.h"
#include "Generated/Presets.h"

namespace cs80p {

class CS80Processor : public juce::AudioProcessor {
  public:
    CS80Processor();
    ~CS80Processor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void reset() override;
    bool isBusesLayoutSupported(BusesLayout const& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    juce::String const getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 8.0; }

    int getNumPrograms() override { return (int)programs.size(); }
    int getCurrentProgram() override { return currentProgram.load(); }
    void setCurrentProgram(int index) override;
    juce::String const getProgramName(int index) override;
    void changeProgramName(int, juce::String const&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(void const* data, int sizeInBytes) override;

    /* factory programs: indices into LIBRARY (all 160, or the non-Arturia ones) */
    std::vector<int> const& programList() const { return programs; }
    static juce::String bankOf(int libraryIndex) { return LIBRARY[libraryIndex].bank; }
    static juce::String nameOf(int libraryIndex) { return LIBRARY[libraryIndex].name; }

    /* parameter i (PARAMS order) and its value in engine units */
    juce::RangedAudioParameter* parameter(int i) const { return params[i]; }
    float paramValue(int i) const;

  private:
    struct Ramp { float step; int left; };

    void loadValues(float const* values, char const* name, int program);
    void pushPatch(Patch const& p);
    void setParamValue(int i, float v);
    void applyParamChanges();
    void tickRamps();

    EngineHost host;
    std::vector<int> programs;
    std::atomic<int> currentProgram{0};
    std::atomic<bool> wantReset{false};

    juce::RangedAudioParameter* params[NUM_PARAMS] = {};

    /* message/host thread -> audio thread: an exact patch (program or state load) */
    juce::SpinLock pendingLock;
    Patch pending{};
    std::atomic<bool> hasPending{false};
    Patch startPatch{};              /* what prepareToPlay starts the engine on */

    /* audio thread only */
    float applied[NUM_PARAMS] = {};  /* parameter values already in the engine patch */
    Ramp ramps[NUM_PARAMS] = {};
    int rampTicks = 15;
    float carryL[EngineHost::TICK] = {}, carryR[EngineHost::TICK] = {};
    int carryPos = EngineHost::TICK;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CS80Processor)
};

}  // namespace cs80p
