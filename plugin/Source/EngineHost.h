/*
 * The cs80v2 engine behind a narrow interface, so that the engine compiles in
 * its own translation unit with the flags it was tuned with (-ffast-math),
 * apart from JUCE. Owns the per-instance echo and plate memory.
 */
#pragma once

#include <memory>
#include <vector>

#include "../../cs80v2/cs80v2.hpp"

namespace cs80p {

class EngineHost {
  public:
    static constexpr int TICK = cs80v2::CTRL; /* the engine renders whole 32-frame ticks */

    EngineHost();
    ~EngineHost();

    /* not real-time: allocates for this sample rate and starts the engine on patch p */
    void prepare(double sample_rate, cs80v2::Patch const& p);
    bool prepared() const { return ready; }

    /* real-time safe from here on */
    cs80v2::Patch& patch();
    void set_patch(cs80v2::Patch const& p);
    void refresh_fx();
    void midi(uint8_t const* data, int size);
    void all_notes_off();
    void render_tick(float* l, float* r);
    int latency() const;

  private:
    std::unique_ptr<cs80v2::Engine> engine;
    std::vector<int16_t> echo_l, echo_r;
    std::vector<float> plate;
    bool ready = false;
};

}  // namespace cs80p
