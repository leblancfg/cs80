#include "PluginProcessor.h"

#include "PluginEditor.h"

namespace cs80p {

namespace {

juce::String valueText(ParamSpec const& s, float v)
{
    juce::String const u(s.unit);
    if (u == "Hz") return v >= 1000.0f ? juce::String(v / 1000.0f, 2) + " kHz" : juce::String(v, v < 10.0f ? 2 : 0) + " Hz";
    if (u == "s") return v < 1.0f ? juce::String(juce::roundToInt(v * 1000.0f)) + " ms" : juce::String(v, 2) + " s";
    if (u == "s/oct") return v == 0.0f ? juce::String("off") : juce::String(v, 2) + " s/oct";
    if (u == "oct") return (v >= 0.0f ? "+" : "") + juce::String(v, 2) + " oct";
    if (u == "st") return juce::String(v, 2) + " st";
    if (u == "ct") return juce::String(v, 1) + " ct";
    if (u == "pw") return juce::String(juce::roundToInt(50.0f + 100.0f * v)) + "%";
    if (u == "dB") return v <= 0.0f ? juce::String("off") : (v >= 1.0f ? "+" : "") + juce::String(20.0f * std::log10(v), 1) + " dB";
    return juce::String(v, 3);
}

float textValue(ParamSpec const& s, juce::String const& t)
{
    juce::String const u(s.unit);
    if (t.trim().equalsIgnoreCase("off")) return 0.0f;
    float x = t.retainCharacters("0123456789.-+eE").getFloatValue();
    if (t.containsIgnoreCase("khz")) x *= 1000.0f;
    else if (t.containsIgnoreCase("ms")) x *= 0.001f;
    if (u == "pw") x = (x - 50.0f) / 100.0f;
    if (u == "dB") x = std::pow(10.0f, x / 20.0f);
    return x;
}

juce::String groupId(juce::String const& name)
{
    return name.retainCharacters("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ").replaceCharacter(' ', '_');
}

Patch patchFrom(float const* values, char const* name)
{
    Patch p;
    memset(&p, 0, sizeof p);
    for (int i = 0; i != NUM_PARAMS; ++i) field_write(p, PARAMS[i], values[i]);
    snprintf(p.name, sizeof p.name, "%s", name);
    return p;
}

}  // namespace

CS80Processor::CS80Processor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    for (int i = 0; i != NUM_LIBRARY_PRESETS; ++i) {
#if CS80_SHARED_PRESETS
        if (LIBRARY[i].arturia) continue; /* Arturia CS-80V translations stay out of shared builds */
#endif
        programs.push_back(i);
    }

    std::vector<std::unique_ptr<juce::AudioProcessorParameterGroup>> groups;
    std::map<juce::String, juce::AudioProcessorParameterGroup*> byName;
    for (int i = 0; i != NUM_PARAMS; ++i) {
        ParamSpec const& s = PARAMS[i];
        juce::ParameterID const pid{s.id, 1};
        std::unique_ptr<juce::RangedAudioParameter> p;
        if (s.map == M_BOOL) {
            p = std::make_unique<juce::AudioParameterBool>(pid, s.name, s.def >= 0.5f);
        } else if (s.map == M_CHOICE) {
            p = std::make_unique<juce::AudioParameterChoice>(pid, s.name, juce::StringArray::fromTokens(s.choices, "|", ""),
                                                             juce::roundToInt(s.def));
        } else if (s.map == M_INT) {
            p = std::make_unique<juce::AudioParameterInt>(pid, s.name, (int)s.lo, (int)s.hi, juce::roundToInt(s.def));
        } else {
            Map const m = s.map;
            juce::NormalisableRange<float> range(
                s.lo, s.hi, [m](float a, float b, float x) { return spec_from01(m, a, b, x); },
                [m](float a, float b, float v) { return spec_to01(m, a, b, v); });
            auto attrs = juce::AudioParameterFloatAttributes()
                             .withStringFromValueFunction([&s](float v, int) { return valueText(s, v); })
                             .withValueFromStringFunction([&s](juce::String const& t) { return textValue(s, t); });
            p = std::make_unique<juce::AudioParameterFloat>(pid, s.name, range, s.def, attrs);
        }
        params[i] = p.get();
        juce::String const g(s.group);
        if (!byName.count(g)) {
            groups.push_back(std::make_unique<juce::AudioProcessorParameterGroup>(groupId(g), g, " / "));
            byName[g] = groups.back().get();
        }
        byName[g]->addChild(std::move(p));
    }
    for (auto& g : groups) addParameterGroup(std::move(g));

    startPatch = patchFrom(INIT_VALUES, "Init");
    setCurrentProgram(0);
}

CS80Processor::~CS80Processor() = default;

/* ---- parameters ------------------------------------------------------------ */

float CS80Processor::paramValue(int i) const
{
    switch (PARAMS[i].map) {
        case M_BOOL: return static_cast<juce::AudioParameterBool*>(params[i])->get() ? 1.0f : 0.0f;
        case M_CHOICE: return (float)static_cast<juce::AudioParameterChoice*>(params[i])->getIndex();
        case M_INT: return (float)static_cast<juce::AudioParameterInt*>(params[i])->get();
        default: return static_cast<juce::AudioParameterFloat*>(params[i])->get();
    }
}

void CS80Processor::setParamValue(int i, float v)
{
    params[i]->setValueNotifyingHost(params[i]->convertTo0to1(v));
}

void CS80Processor::pushPatch(Patch const& p)
{
    juce::SpinLock::ScopedLockType lock(pendingLock);
    pending = p;
    startPatch = p;
    hasPending.store(true);
}

/* Programs and saved state load as an exact patch: the parameters are set for
   the host and the UI, and the audio thread then takes the patch itself, so
   no value goes through a 0..1 round trip. */
void CS80Processor::loadValues(float const* values, char const* name, int program)
{
    for (int i = 0; i != NUM_PARAMS; ++i) setParamValue(i, values[i]);
    pushPatch(patchFrom(values, name));
    currentProgram.store(program);
}

void CS80Processor::setCurrentProgram(int index)
{
    if (index < 0 || index >= (int)programs.size()) return;
    FactoryPreset const& fp = LIBRARY[programs[(size_t)index]];
    loadValues(fp.v, fp.name, index);
    updateHostDisplay(ChangeDetails().withProgramChanged(true));
}

juce::String const CS80Processor::getProgramName(int index)
{
    if (index < 0 || index >= (int)programs.size()) return {};
    int const k = programs[(size_t)index];
    return bankOf(k) + " / " + nameOf(k);
}

/* audio thread, once per block: take a pending patch, then move every changed
   parameter into the engine patch. Continuous parameters ramp over about
   10 ms in control ticks; switches and selectors step. */
void CS80Processor::applyParamChanges()
{
    if (hasPending.load()) {
        juce::SpinLock::ScopedTryLockType lock(pendingLock);
        if (lock.isLocked()) {
            host.set_patch(pending);
            hasPending.store(false);
            for (int i = 0; i != NUM_PARAMS; ++i) { applied[i] = paramValue(i); ramps[i].left = 0; }
        }
    }
    bool fx = false;
    Patch& p = host.patch();
    for (int i = 0; i != NUM_PARAMS; ++i) {
        float const v = paramValue(i);
        if (v == applied[i]) continue;
        applied[i] = v;
        ParamSpec const& s = PARAMS[i];
        if (s.kind == K_FLOAT && rampTicks > 1) {
            ramps[i].step = (v - field_read(p, s)) / (float)rampTicks;
            ramps[i].left = rampTicks;
        } else {
            field_write(p, s, v);
            fx |= is_fx_field(s);
        }
    }
    if (fx) host.refresh_fx();
}

void CS80Processor::tickRamps()
{
    bool fx = false;
    Patch& p = host.patch();
    for (int i = 0; i != NUM_PARAMS; ++i) {
        Ramp& r = ramps[i];
        if (r.left == 0) continue;
        ParamSpec const& s = PARAMS[i];
        float const v = --r.left == 0 ? applied[i] : field_read(p, s) + r.step;
        field_write(p, s, v);
        fx |= is_fx_field(s);
    }
    if (fx) host.refresh_fx();
}

/* ---- audio ------------------------------------------------------------------ */

void CS80Processor::prepareToPlay(double sampleRate, int)
{
    Patch p;
    {
        juce::SpinLock::ScopedLockType lock(pendingLock);
        p = hasPending.load() || !host.prepared() ? startPatch : host.patch();
        hasPending.store(false);
    }
    /* parameters the host changed since the last patch load win over the patch */
    for (int i = 0; i != NUM_PARAMS; ++i) {
        float const v = paramValue(i);
        float const f = field_read(p, PARAMS[i]);
        if (params[i]->convertFrom0to1(params[i]->convertTo0to1(f)) != v) field_write(p, PARAMS[i], v);
        applied[i] = v;
        ramps[i].left = 0;
    }
    host.prepare(sampleRate, p);
    rampTicks = juce::jmax(1, juce::roundToInt(0.010 * sampleRate / EngineHost::TICK));
    carryPos = EngineHost::TICK;
    setLatencySamples(host.latency());
}

void CS80Processor::reset()
{
    wantReset.store(true);
}

bool CS80Processor::isBusesLayoutSupported(BusesLayout const& layouts) const
{
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() && layouts.getMainInputChannelSet().isDisabled();
}

void CS80Processor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    int const n = buffer.getNumSamples();
    if (!host.prepared() || buffer.getNumChannels() < 2) { buffer.clear(); return; }
    if (wantReset.exchange(false)) { host.all_notes_off(); carryPos = EngineHost::TICK; }
    applyParamChanges();

    float* const outL = buffer.getWritePointer(0);
    float* const outR = buffer.getWritePointer(1);
    auto it = midi.cbegin();
    auto const end = midi.cend();
    constexpr int T = EngineHost::TICK;
    /* The engine renders 32-frame ticks into a carry buffer that is drained
       across host blocks of any size: no added latency. MIDI events apply at
       the start of the tick they fall in (at most 31 frames early) or, if that
       tick began in the previous block, at the next one. */
    for (int pos = 0; pos < n;) {
        if (carryPos == T) {
            for (; it != end && (*it).samplePosition < pos + T; ++it) {
                auto const m = (*it).getMessage();
                host.midi(m.getRawData(), m.getRawDataSize());
            }
            tickRamps();
            host.render_tick(carryL, carryR);
            carryPos = 0;
        }
        int const k = juce::jmin(T - carryPos, n - pos);
        memcpy(outL + pos, carryL + carryPos, sizeof(float) * (size_t)k);
        memcpy(outR + pos, carryR + carryPos, sizeof(float) * (size_t)k);
        carryPos += k;
        pos += k;
    }
    for (; it != end; ++it) { /* only reachable for n == 0 */
        auto const m = (*it).getMessage();
        host.midi(m.getRawData(), m.getRawDataSize());
    }
    for (int c = 2; c < buffer.getNumChannels(); ++c) buffer.clear(c, 0, n);
}

/* ---- state: a versioned map of field name -> value -------------------------- */

void CS80Processor::getStateInformation(juce::MemoryBlock& destData)
{
    juce::XmlElement xml("CS80v2");
    xml.setAttribute("version", 1);
    xml.setAttribute("program", currentProgram.load());
    for (int i = 0; i != NUM_PARAMS; ++i) {
        auto* e = xml.createNewChildElement("p");
        e->setAttribute("id", PARAMS[i].id);
        e->setAttribute("v", juce::String::formatted("%.9g", (double)paramValue(i)));
    }
    copyXmlToBinary(xml, destData);
}

void CS80Processor::setStateInformation(void const* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary(data, sizeInBytes);
    if (!xml || !xml->hasTagName("CS80v2")) return;
    float values[NUM_PARAMS];
    memcpy(values, INIT_VALUES, sizeof values); /* fields missing from older saves keep their defaults */
    for (auto* e : xml->getChildWithTagNameIterator("p")) {
        juce::String const id = e->getStringAttribute("id");
        for (int i = 0; i != NUM_PARAMS; ++i)
            if (id == PARAMS[i].id) { values[i] = (float)e->getDoubleAttribute("v", values[i]); break; }
    }
    int const prog = juce::jlimit(0, juce::jmax(0, (int)programs.size() - 1), xml->getIntAttribute("program", 0));
    loadValues(values, "Saved", prog);
    updateHostDisplay(ChangeDetails().withProgramChanged(true));
}

juce::AudioProcessorEditor* CS80Processor::createEditor() { return new CS80Editor(*this); }

}  // namespace cs80p

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new cs80p::CS80Processor(); }
