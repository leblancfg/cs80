/*
 * cs80v2 WebAssembly wrapper: a small C API over the unmodified engine in
 * ../../cs80v2/ (same headers as the ESP32 and host builds).
 *
 * Patch access goes two ways:
 *   - cs80_set_param(id, x): a midimap.hpp Param with x in 0..1, scaled by
 *     apply_param() exactly as a MIDI CC would be.
 *   - cs80_field_*: every Patch field by name, in engine units. The page
 *     uses these for display, "Copy settings", and blob loading.
 */
#include <stddef.h>

#include "../../cs80v2/midimap.hpp"
#include "../../cs80v2/presets.hpp"

#define API extern "C" __attribute__((used, visibility("default")))

using namespace cs80v2;

static Engine engine;
static bool ready;
static CCMap const* ccmap;
static float out_l[128], out_r[128];
static float blob[2048];

enum Kind : uint8_t { K_F, K_B, K_U };
struct Field { char const* name; uint32_t off; uint8_t kind; };

#define CHF(c, pre, f, k) {pre #f, (uint32_t)(offsetof(Patch, ch) + (c) * sizeof(ChannelParams) + offsetof(ChannelParams, f)), k}
#define CH(c, pre) \
    CHF(c, pre, pwm_hz, K_F), CHF(c, pre, pwm_depth, K_F), CHF(c, pre, pw, K_F), CHF(c, pre, square, K_F), \
    CHF(c, pre, saw, K_F), CHF(c, pre, noise, K_F), CHF(c, pre, hpf_hz, K_F), CHF(c, pre, hpf_res, K_F), \
    CHF(c, pre, lpf_hz, K_F), CHF(c, pre, lpf_res, K_F), CHF(c, pre, il, K_F), CHF(c, pre, al, K_F), \
    CHF(c, pre, fa, K_F), CHF(c, pre, fd, K_F), CHF(c, pre, fr, K_F), CHF(c, pre, inv, K_B), \
    CHF(c, pre, vcf_level, K_F), CHF(c, pre, sine_level, K_F), CHF(c, pre, a, K_F), CHF(c, pre, d, K_F), \
    CHF(c, pre, s, K_F), CHF(c, pre, r, K_F), CHF(c, pre, level, K_F), CHF(c, pre, init_level, K_F), \
    CHF(c, pre, after_level, K_F), CHF(c, pre, init_bril, K_F), CHF(c, pre, after_bril, K_F)
#define PF(f, k) {#f, (uint32_t)(offsetof(Patch, perf) + offsetof(PerfParams, f)), k}
#define CF(f, k) {"chorus." #f, (uint32_t)(offsetof(Patch, perf) + offsetof(PerfParams, chorus) + offsetof(ChorusParams, f)), k}
#define FF(f, k) {"fx." #f, (uint32_t)(offsetof(Patch, fx) + offsetof(FxParams, f)), k}
#define PL(f) {"plate." #f, (uint32_t)(offsetof(Patch, fx) + offsetof(FxParams, plate) + offsetof(PlateParams, f)), K_F}

static Field const FIELDS[] = {
    CH(0, "I."), CH(1, "II."),
    {"feet_I", (uint32_t)(offsetof(Patch, perf) + offsetof(PerfParams, feet)), K_U},
    {"feet_II", (uint32_t)(offsetof(Patch, perf) + offsetof(PerfParams, feet) + 1), K_U},
    PF(detune_cents, K_F), PF(mix, K_F), PF(pan_spread, K_F), PF(brilliance, K_F), PF(resonance, K_F),
    PF(key_track, K_F), PF(sub_wave, K_U), PF(sub_hz, K_F), PF(sub_vco, K_F), PF(sub_vcf, K_F), PF(sub_vca, K_F),
    PF(wheel_vco, K_F), PF(init_bend, K_F), PF(at_sub_speed, K_F), PF(at_sub_vco, K_F), PF(at_sub_vcf, K_F),
    PF(at_mode, K_U), PF(kbd_bril_low, K_F), PF(kbd_bril_high, K_F), PF(kbd_level_low, K_F), PF(kbd_level_high, K_F),
    PF(ring_a, K_F), PF(ring_d, K_F), PF(ring_depth, K_F), PF(ring_hz, K_F), PF(ring_mod, K_F),
    PF(sustain_mode, K_U), PF(sustain_time, K_F), PF(porta_time, K_F), PF(gliss, K_B), PF(bend_up, K_F), PF(bend_down, K_F),
    CF(chorus_on, K_B), CF(trem_on, K_B), CF(chorus_hz, K_F), CF(chorus_depth, K_F), CF(trem_hz, K_F), CF(trem_depth, K_F),
    PF(drift, K_F), PF(master, K_F),
    FF(echo_mode, K_U), FF(echo_time, K_F), FF(echo_fb, K_F), FF(echo_mix, K_F), FF(echo_damp_hz, K_F),
    FF(echo_taps, K_U), FF(echo_pan, K_F), FF(echo_darken, K_F), FF(reverb_mix, K_F),
    PL(decay), PL(damp), PL(bandwidth), PL(predelay_s),
};
constexpr int NFIELDS = sizeof FIELDS / sizeof FIELDS[0];

#define PN(x) {#x, x}
struct ParamName { char const* name; int id; };
static ParamName const PARAMS[] = {
    PN(P_PWM_SPEED), PN(P_PWM), PN(P_PW), PN(P_NOISE), PN(P_SQUARE), PN(P_SAW), PN(P_TRIANGLE),
    PN(P_HPF), PN(P_RES_H), PN(P_LPF), PN(P_RES_L), PN(P_IL), PN(P_AL), PN(P_FA), PN(P_FD), PN(P_FR), PN(P_INV),
    PN(P_VCF_LEVEL), PN(P_SINE), PN(P_A), PN(P_D), PN(P_S), PN(P_R), PN(P_LEVEL),
    PN(P_INIT_BRIL), PN(P_INIT_LEVEL), PN(P_AFTER_BRIL), PN(P_AFTER_LEVEL),
    PN(P_RING_A), PN(P_RING_D), PN(P_RING_DEPTH), PN(P_RING_SPEED), PN(P_RING_MOD),
    PN(P_SUB_FUNCTION), PN(P_SUB_SPEED), PN(P_SUB_VCO), PN(P_SUB_VCF), PN(P_SUB_VCA),
    PN(P_FEET_I), PN(P_FEET_II), PN(P_MIX), PN(P_PAN), PN(P_DETUNE),
    PN(P_BRILLIANCE), PN(P_RESONANCE), PN(P_ECHO_MIX), PN(P_REVERB_MIX),
    PN(P_INIT_BEND), PN(P_AT_SUB_SPEED), PN(P_AT_SUB_VCO), PN(P_AT_SUB_VCF),
    PN(P_KBD_BRIL_LOW), PN(P_KBD_BRIL_HIGH), PN(P_KBD_LEVEL_LOW), PN(P_KBD_LEVEL_HIGH),
    PN(P_SUSTAIN_TIME), PN(P_SUSTAIN_MODE), PN(P_PORTA_TIME), PN(P_GLISS),
    PN(P_CHORUS_ON), PN(P_CHORUS_SPEED), PN(P_CHORUS_DEPTH), PN(P_TREM_ON), PN(P_TREM_SPEED), PN(P_TREM_DEPTH),
    PN(P_ECHO_TIME), PN(P_ECHO_FB), PN(P_REVERB_DECAY), PN(P_DRIFT), PN(P_MASTER),
};
constexpr int NPARAMS = sizeof PARAMS / sizeof PARAMS[0];

/* ---- lifecycle and audio ---------------------------------------------------- */

/* The plate's static memory is sized for 48 kHz, so higher rates are refused. */
API int cs80_init(float sample_rate)
{
    if (sample_rate < 8000.0f || sample_rate > 48000.0f) return 0;
    engine.init(sample_rate, preset(0));
    ccmap = &oxygen49_map();
    ready = true;
    return 1;
}

API float* cs80_out_l() { return out_l; }
API float* cs80_out_r() { return out_r; }

/* n must be a multiple of 32 and at most 128 when using the built-in buffers */
API void cs80_render(float* l, float* r, int n)
{
    if (!ready) { memset(l, 0, n * sizeof(float)); memset(r, 0, n * sizeof(float)); return; }
    engine.process(l, r, n);
}
API void cs80_render_block() { cs80_render(out_l, out_r, 128); }
/* output limiter meters since the last call (then reset): lowest gain (1 = no
   reduction) and the highest peak before the limiter */
API float cs80_lim_gain() { float const g = engine.limiter.gmin; engine.limiter.gmin = engine.limiter.g; return g; }
API float cs80_lim_peak_in() { float const p = engine.limiter.peak_in; engine.limiter.peak_in = 0.0f; return p; }
/* the limiter's look-ahead delay in samples, and a bypass for level surveys (tools only) */
API int cs80_lim_latency() { return engine.limiter.latency(); }
API void cs80_lim_bypass(int on) { engine.limiter.bypass = on != 0; }

/* ---- MIDI ------------------------------------------------------------------- */

API void cs80_note_on(int note, int vel) { engine.note_on(note & 127, vel & 127); }
API void cs80_note_off(int note) { engine.note_off(note & 127); }
API void cs80_pitch_bend(int value14) { engine.pitch_bend(value14); }
API void cs80_channel_pressure(int v) { engine.channel_pressure(v & 127); }
API void cs80_poly_pressure(int note, int v) { engine.poly_pressure(note & 127, v & 127); }
/* routed through the active CCMap (Oxygen 49 by default), as on the MCU */
API void cs80_cc(int num, int val) { handle_cc(engine, *ccmap, num & 127, val & 127); }
API void cs80_set_map(int which) { ccmap = which == 1 ? &pm80_map() : &oxygen49_map(); }
API void cs80_all_notes_off() { engine.control_change(123, 0); engine.control_change(120, 0); }
API int cs80_active_voices() { return engine.active_voices(); }
API int cs80_active_echo_voices() { return engine.active_echo_voices(); }

/* ---- presets and params ---------------------------------------------------- */

API int cs80_preset_count() { return preset_count(); }
API void cs80_load_preset(int i) { if (i >= 0 && i < preset_count()) engine.set_patch(preset(i)); }
API char const* cs80_preset_name(int i) { static Patch p; p = preset(i); return p.name; }
API char const* cs80_patch_name() { return engine.patch.name; }

/* patch_init() defaults, the base that blobs and the JSON library build on */
API void cs80_reset_patch() { engine.set_patch(patch_init("Init")); }

API int cs80_param_count() { return NPARAMS; }
API char const* cs80_param_name(int i) { return i >= 0 && i < NPARAMS ? PARAMS[i].name : ""; }
API int cs80_param_id(int i) { return i >= 0 && i < NPARAMS ? PARAMS[i].id : 0; }
API void cs80_set_param(int id, float x)
{
    apply_param(engine.patch, id, clampf(x, 0.0f, 1.0f));
    engine.refresh_fx();
}

API int cs80_field_count() { return NFIELDS; }
API char const* cs80_field_name(int i) { return i >= 0 && i < NFIELDS ? FIELDS[i].name : ""; }
API int cs80_field_kind(int i) { return i >= 0 && i < NFIELDS ? FIELDS[i].kind : -1; }
API float cs80_field_get(int i)
{
    if (i < 0 || i >= NFIELDS) return 0.0f;
    char const* p = (char const*)&engine.patch + FIELDS[i].off;
    switch (FIELDS[i].kind) {
        case K_B: return *(bool const*)p ? 1.0f : 0.0f;
        case K_U: return (float)*(uint8_t const*)p;
        default: return *(float const*)p;
    }
}
static void field_put(int i, float v)
{
    if (i < 0 || i >= NFIELDS) return;
    char* p = (char*)&engine.patch + FIELDS[i].off;
    switch (FIELDS[i].kind) {
        case K_B: *(bool*)p = v >= 0.5f; break;
        case K_U: {
            int u = (int)(v + 0.5f);
            if (FIELDS[i].name[0] == 'f' && FIELDS[i].name[1] == 'e') u = u < 0 ? 0 : (u > 5 ? 5 : u); /* feet index */
            *(uint8_t*)p = (uint8_t)(u < 0 ? 0 : (u > 255 ? 255 : u));
            break;
        }
        default: *(float*)p = v;
    }
}
API void cs80_field_set(int i, float v) { field_put(i, v); engine.refresh_fx(); }

/* Param blob: n (field index, value) pairs in cs80_blob(), applied over
   patch_init() defaults when reset != 0, else over the current patch. */
API float* cs80_blob() { return blob; }
API void cs80_load_blob(int n, int reset)
{
    if (reset) engine.set_patch(patch_init("Blob"));
    if (n > 1024) n = 1024;
    for (int k = 0; k != n; ++k) field_put((int)blob[2 * k], blob[2 * k + 1]);
    engine.refresh_fx();
}
