#include "PluginEditor.h"

#include "BinaryData.h"

namespace cs80p {

namespace {

juce::String mimeOf(juce::String const& path)
{
    /* without the charset WebKit reads scripts as Latin-1 and the lever glyphs (⊓ ∿ −) break */
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    return "application/octet-stream";
}

/* Windows needs WebView2 (Edge) asked for by name, or JUCE falls back to Internet
   Explorer. Its profile goes in the temp folder; the default sits next to the
   host's .exe, often under Program Files. macOS and Linux take the default. */
juce::WebBrowserComponent::Options platformOptions()
{
    juce::WebBrowserComponent::Options o;
#if JUCE_WINDOWS
    o = o.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
             .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                 .withUserDataFolder(juce::File::getSpecialLocation(juce::File::tempDirectory)
                     .getChildFile("CS80-WebView2"))
                 .withBackgroundColour(juce::Colour(0xff2f1e2e))
                 .withStatusBarDisabled());
#endif
    return o;
}

}  // namespace

CS80Editor::CS80Editor(CS80Processor& p)
    : AudioProcessorEditor(p),
      proc(p),
      selftest(juce::SystemStats::getEnvironmentVariable("CS80_UI_SELFTEST", {}).isNotEmpty()),
      web(platformOptions()
              .withNativeIntegrationEnabled()
              .withInitialisationData("selftest", selftest ? 1 : 0)
              .withKeepPageLoadedWhenBrowserIsHidden()
              .withResourceProvider([this](juce::String const& url) { return resource(url); })
              .withEventListener("cs80", [this](juce::var const& v) { onPageEvent(v); }))
{
    for (int i = 0; i != NUM_PARAMS; ++i) {
        index[PARAMS[i].id] = i;
        sent[i] = std::numeric_limits<float>::quiet_NaN();
    }
    addAndMakeVisible(web);
    web.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    /* the panel's natural size is about 1460 x 540; it zooms to fit the window */
    setResizable(true, true);
    setResizeLimits(760, 320, 2600, 1300);
    setSize(1240, 500);
    startTimerHz(30);
}

CS80Editor::~CS80Editor()
{
    stopTimer();
    for (int i = 0; i != NUM_PARAMS; ++i)
        if (gesture[(size_t)i]) proc.parameter(i)->endChangeGesture();
}

void CS80Editor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(0xff2f1e2e)); }

void CS80Editor::resized() { web.setBounds(getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> CS80Editor::resource(juce::String const& url)
{
    juce::String path = url.upToFirstOccurrenceOf("?", false, false).trimCharactersAtStart("/");
    if (path.isEmpty()) path = "index.html";
    for (int k = 0; k != BinaryData::namedResourceListSize; ++k) {
        char const* name = BinaryData::namedResourceList[k];
        if (path != BinaryData::getNamedResourceOriginalFilename(name)) continue;
        int size = 0;
        auto const* data = reinterpret_cast<std::byte const*>(BinaryData::getNamedResource(name, size));
        return juce::WebBrowserComponent::Resource{std::vector<std::byte>(data, data + size), mimeOf(path)};
    }
    return std::nullopt;
}

/* message thread: {t: 'ready'} | {t: 'begin'|'end', id} | {t: 'set', id, v} */
void CS80Editor::onPageEvent(juce::var const& e)
{
    juce::String const t = e["t"].toString();
    if (t == "ready") { /* (re)loaded page: send it everything */
        pageReady = true;
        shownProgram = -1;
        for (float& s : sent) s = std::numeric_limits<float>::quiet_NaN();
        timerCallback();
        return;
    }
    if (t == "log") {
        if (selftest) fprintf(stderr, "[cs80 page] %s\n", e["msg"].toString().toRawUTF8());
        return;
    }
    auto const it = index.find(e["id"].toString());
    if (it == index.end()) return;
    int const i = it->second;
    auto* const prm = proc.parameter(i);
    size_t const b = (size_t)i;
    if (t == "begin") {
        if (!gesture[b]) { prm->beginChangeGesture(); gesture[b] = true; }
    } else if (t == "end") {
        if (gesture[b]) { prm->endChangeGesture(); gesture[b] = false; }
    } else if (t == "set") {
        float const v = (float)(double)e["v"];
        bool const own = !gesture[b];
        if (own) prm->beginChangeGesture();
        prm->setValueNotifyingHost(prm->convertTo0to1(v));
        if (own) prm->endChangeGesture();
        sent[i] = proc.paramValue(i); /* the page already shows it */
    }
}

void CS80Editor::timerCallback()
{
    if (!pageReady || !web.isShowing()) return; /* events only reach a showing page */
    juce::DynamicObject::Ptr changed = new juce::DynamicObject;
    bool any = false;
    for (int i = 0; i != NUM_PARAMS; ++i) {
        float const v = proc.paramValue(i);
        if (v == sent[i]) continue;
        sent[i] = v;
        changed->setProperty(PARAMS[i].id, v);
        any = true;
    }
    int const cur = proc.getCurrentProgram();
    if (cur != shownProgram) {
        shownProgram = cur;
        juce::DynamicObject::Ptr vals = new juce::DynamicObject;
        if (cur >= 0 && cur < (int)proc.programList().size()) {
            FactoryPreset const& fp = LIBRARY[proc.programList()[(size_t)cur]];
            for (int i = 0; i != NUM_PARAMS; ++i) vals->setProperty(PARAMS[i].id, fp.v[i]);
        }
        juce::DynamicObject::Ptr prog = new juce::DynamicObject;
        prog->setProperty("name", proc.getProgramName(cur));
        prog->setProperty("values", juce::var(vals.get()));
        web.emitEventIfBrowserIsVisible("cs80program", juce::var(prog.get()));
    }
    if (any) web.emitEventIfBrowserIsVisible("cs80values", juce::var(changed.get()));
}

}  // namespace cs80p
