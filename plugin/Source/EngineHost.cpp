#include "EngineHost.h"

namespace cs80p {

EngineHost::EngineHost() : engine(new cs80v2::Engine) {}
EngineHost::~EngineHost() = default;

void EngineHost::prepare(double sample_rate, cs80v2::Patch const& p)
{
    float const sr = (float)sample_rate;
    uint32_t const n = cs80v2::Engine::echo_len_for(sr);
    echo_l.assign(n, 0);
    echo_r.assign(n, 0);
    plate.assign((size_t)cs80v2::Engine::plate_len_for(sr) + 64, 0.0f);
    cs80v2::Engine::FxMem const mem{echo_l.data(), echo_r.data(), n, plate.data()};
    engine->init(sr, p, &mem);
    engine->set_echo_glide(true);
    ready = true;
}

cs80v2::Patch& EngineHost::patch() { return engine->patch; }
void EngineHost::set_patch(cs80v2::Patch const& p) { engine->set_patch(p); }
void EngineHost::refresh_fx() { engine->refresh_fx(); }
int EngineHost::latency() const { return engine->limiter.latency(); }
void EngineHost::render_tick(float* l, float* r) { engine->process(l, r, TICK); }

void EngineHost::all_notes_off()
{
    engine->control_change(123, 0);
    engine->control_change(120, 0);
}

void EngineHost::midi(uint8_t const* d, int size)
{
    if (size < 1) return;
    int const st = d[0] & 0xf0;
    int const a = size > 1 ? d[1] & 127 : 0, b = size > 2 ? d[2] & 127 : 0;
    cs80v2::Engine& e = *engine;
    switch (st) {
        case 0x90: e.note_on(a, b); break;   /* velocity 0 is a note off */
        case 0x80: e.note_off(a); break;
        case 0xa0: e.poly_pressure(a, b); break;
        case 0xb0: e.control_change(a, b); break; /* 1 wheel, 7 volume, 11 expression, 64 sustain, 120/123 */
        case 0xd0: e.channel_pressure(a); break;
        case 0xe0: e.pitch_bend(a | (b << 7)); break;
    }
}

}  // namespace cs80p
