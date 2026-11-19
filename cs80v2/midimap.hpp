/*
 * cs80v2 MIDI control map.
 *
 * Every panel control is a Param. A CCMap is a 128-entry table from CC
 * number to Param, so supporting a new controller (or the PM-80's final
 * firmware defaults, once published) is a table edit. See docs/midi-map.md.
 * Values arrive as 0..127 and are scaled here to the engine's physical units.
 */
#pragma once

#include "cs80v2.hpp"

namespace cs80v2 {

enum Param : uint8_t {
    P_NONE = 0,
    /* per channel block: add CH_STRIDE for channel II */
    P_PWM_SPEED, P_PWM, P_PW, P_NOISE, P_SQUARE, P_SAW, P_TRIANGLE,
    P_HPF, P_RES_H, P_LPF, P_RES_L, P_IL, P_AL, P_FA, P_FD, P_FR, P_INV,
    P_VCF_LEVEL, P_SINE, P_A, P_D, P_S, P_R, P_LEVEL,
    P_INIT_BRIL, P_INIT_LEVEL, P_AFTER_BRIL, P_AFTER_LEVEL,
    P_CH_END,
    CH_STRIDE = P_CH_END - P_PWM_SPEED,
    P_CH2_FIRST = P_PWM_SPEED + CH_STRIDE,
    /* shared panel */
    P_RING_A = P_CH2_FIRST + CH_STRIDE, P_RING_D, P_RING_DEPTH, P_RING_SPEED, P_RING_MOD,
    P_SUB_FUNCTION, P_SUB_SPEED, P_SUB_VCO, P_SUB_VCF, P_SUB_VCA,
    P_FEET_I, P_FEET_II, P_MIX, P_PAN, P_DETUNE,
    P_BRILLIANCE, P_RESONANCE, P_ECHO_MIX, P_REVERB_MIX,
    P_INIT_BEND, P_AT_SUB_SPEED, P_AT_SUB_VCO, P_AT_SUB_VCF,
    P_KBD_BRIL_LOW, P_KBD_BRIL_HIGH, P_KBD_LEVEL_LOW, P_KBD_LEVEL_HIGH,
    /* left-hand panel and gravy */
    P_SUSTAIN_TIME, P_SUSTAIN_MODE, P_PORTA_TIME, P_GLISS,
    P_CHORUS_ON, P_CHORUS_SPEED, P_CHORUS_DEPTH, P_TREM_ON, P_TREM_SPEED, P_TREM_DEPTH,
    P_ECHO_TIME, P_ECHO_FB, P_REVERB_DECAY, P_DRIFT, P_MASTER,
    P_COUNT
};

static inline float expmap(float x, float lo, float hi) { return lo * fast_exp2(x * log2f(hi / lo)); }
static inline float bip(float x) { return 2.0f * x - 1.0f; }
/* Envelope time sliders: V4's end points, but exponential above a linear start,
   t = lo + (hi - lo) (100^x - 1) / 99. A pure 2 ms-based exponential gave Yamaha's own
   presets (release 2 on strings, winds and brass; 4 on bells and pizzicato) 11 ms and 60 ms
   releases; this curve gives 0.15 s and 0.6 s. See presets/arturia/CALIBRATION.md. */
static inline float egtmap(float x, float lo, float hi) { return lo + (hi - lo) * (fast_exp2(x * 6.643856f) - 1.0f) * (1.0f / 99.0f); }

/* x in 0..1. Ranges follow the Arturia CS-80 V4 manual where it gives them. */
inline void apply_param(Patch& p, int id, float x)
{
    if (id >= P_PWM_SPEED && id < P_CH2_FIRST + CH_STRIDE) {
        int const c = id >= P_CH2_FIRST;
        ChannelParams& ch = p.ch[c];
        switch (id - c * CH_STRIDE) {
            case P_PWM_SPEED: ch.pwm_hz = expmap(x, 0.1f, 40.0f); break;
            case P_PWM: ch.pwm_depth = 0.4f * x; break;
            case P_PW: ch.pw = 0.4f * x; break;
            case P_NOISE: ch.noise = x; break;
            case P_SQUARE: ch.square = x; break;
            case P_SAW: ch.saw = x; break;
            case P_TRIANGLE: break; /* PM-80 extra; the CS-80 has none */
            case P_HPF: ch.hpf_hz = expmap(x, 26.8f, 16155.0f); break;
            case P_RES_H: ch.hpf_res = 0.97f * x; break;
            case P_LPF: ch.lpf_hz = expmap(x, 37.1f, 20000.0f); break;
            case P_RES_L: ch.lpf_res = 0.97f * x; break;
            case P_IL: ch.il = 5.0f * x; break;
            case P_AL: ch.al = 5.0f * x; break;
            case P_FA: ch.fa = egtmap(x, 0.002f, 0.58f); break;
            case P_FD: ch.fd = egtmap(x, 0.002f, 8.75f); break;
            case P_FR: ch.fr = egtmap(x, 0.002f, 11.0f); break;
            case P_INV: ch.inv = x >= 0.5f; break;
            case P_VCF_LEVEL: ch.vcf_level = x; break;
            case P_SINE: ch.sine_level = x; break;
            case P_A: ch.a = egtmap(x, 0.002f, 0.885f); break;
            case P_D: ch.d = egtmap(x, 0.002f, 7.35f); break;
            case P_S: ch.s = x; break;
            case P_R: ch.r = egtmap(x, 0.002f, 11.5f); break;
            case P_LEVEL: ch.level = x; break;
            case P_INIT_BRIL: ch.init_bril = 3.0f * x; break;
            case P_INIT_LEVEL: ch.init_level = x; break;
            case P_AFTER_BRIL: ch.after_bril = 3.0f * x; break;
            case P_AFTER_LEVEL: ch.after_level = x; break;
        }
        return;
    }
    PerfParams& q = p.perf;
    FxParams& f = p.fx;
    switch (id) {
        case P_RING_A: q.ring_a = expmap(x, 0.003f, 0.53f); break;
        case P_RING_D: q.ring_d = expmap(x, 0.007f, 4.5f); break;
        case P_RING_DEPTH: q.ring_depth = x; break;
        case P_RING_SPEED: q.ring_hz = expmap(x, 0.25f, 205.0f); break;
        case P_RING_MOD: q.ring_mod = x; break;
        case P_SUB_FUNCTION: q.sub_wave = (uint8_t)(x * 5.99f); break;
        case P_SUB_SPEED: q.sub_hz = expmap(x, 0.5f, 100.0f); break;
        case P_SUB_VCO: q.sub_vco = 12.0f * x * x; break;
        case P_SUB_VCF: q.sub_vcf = 3.0f * x; break;
        case P_SUB_VCA: q.sub_vca = x; break;
        case P_FEET_I: q.feet[0] = (uint8_t)(x * 5.99f); break;
        case P_FEET_II: q.feet[1] = (uint8_t)(x * 5.99f); break;
        case P_MIX: q.mix = bip(x); break;
        case P_PAN: q.pan_spread = x; break;
        case P_DETUNE: q.detune_cents = 100.0f * bip(x); break;
        case P_BRILLIANCE: q.brilliance = 3.0f * bip(x); break;
        case P_RESONANCE: q.resonance = x; break;
        case P_ECHO_MIX: f.echo_mix = x; break;
        case P_REVERB_MIX: f.reverb_mix = x; break;
        case P_INIT_BEND: q.init_bend = 2.0f * x; break;
        case P_AT_SUB_SPEED: q.at_sub_speed = 3.0f * x; break;
        case P_AT_SUB_VCO: q.at_sub_vco = 2.0f * x * x; break;
        case P_AT_SUB_VCF: q.at_sub_vcf = 2.0f * x; break;
        case P_KBD_BRIL_LOW: q.kbd_bril_low = 2.0f * bip(x); break;
        case P_KBD_BRIL_HIGH: q.kbd_bril_high = 2.0f * bip(x); break;
        case P_KBD_LEVEL_LOW: q.kbd_level_low = bip(x); break;
        case P_KBD_LEVEL_HIGH: q.kbd_level_high = bip(x); break;
        case P_SUSTAIN_TIME: q.sustain_time = 9.0f * x * x; break;
        case P_SUSTAIN_MODE: q.sustain_mode = (uint8_t)(x * 2.99f); break;
        case P_PORTA_TIME: q.porta_time = 2.0f * x * x; break;
        case P_GLISS: q.gliss = x >= 0.5f; break;
        case P_CHORUS_ON: q.chorus.chorus_on = x >= 0.5f; break;
        case P_CHORUS_SPEED: q.chorus.chorus_hz = expmap(x, 0.4f, 5.0f); break;
        case P_CHORUS_DEPTH: q.chorus.chorus_depth = x; break;
        case P_TREM_ON: q.chorus.trem_on = x >= 0.5f; break;
        case P_TREM_SPEED: q.chorus.trem_hz = expmap(x, 1.18f, 16.3f); break;
        case P_TREM_DEPTH: q.chorus.trem_depth = x; break;
        case P_ECHO_TIME: f.echo_time = expmap(x, 0.03f, 1.3f); break;
        case P_ECHO_FB: f.echo_fb = 0.9f * x; break;
        case P_REVERB_DECAY: f.plate.decay = 0.3f + 0.67f * x; break;
        case P_DRIFT: q.drift = 2.0f * x; break;
        case P_MASTER: q.master = x; break;
    }
}

struct CCMap { char const* name; uint8_t param[128]; };

/* Proposed PM-80 default map (GLT has not published one; see docs/midi-map.md).
   Channel I row: CC 12-31 then 102-109. Channel II row: CC 41-60 then 110-117.
   Bottom row: CC 70-90 and 2-5, 8, 9. Left-hand panel: CC 64, 65, 91-95, 118, 119. */
inline CCMap const& pm80_map()
{
    static CCMap m = [] {
        CCMap t{"PM-80 (proposed)", {}};
        uint8_t const row[20] = {P_PWM_SPEED, P_PWM, P_PW, P_NOISE, P_HPF, P_RES_H, P_LPF, P_RES_L, P_IL, P_AL,
                                 P_FA, P_FD, P_FR, P_VCF_LEVEL, P_SINE, P_A, P_D, P_S, P_R, P_LEVEL};
        uint8_t const row2[8] = {P_INIT_BRIL, P_INIT_LEVEL, P_AFTER_BRIL, P_AFTER_LEVEL, P_SQUARE, P_SAW, P_TRIANGLE, P_INV};
        for (int i = 0; i != 20; ++i) { t.param[12 + i] = row[i]; t.param[41 + i] = row[i] + CH_STRIDE; }
        for (int i = 0; i != 8; ++i) { t.param[102 + i] = row2[i]; t.param[110 + i] = row2[i] + CH_STRIDE; }
        uint8_t const bottom[27] = {P_RING_A, P_RING_D, P_RING_DEPTH, P_RING_SPEED, P_RING_MOD,
                                    P_SUB_FUNCTION, P_SUB_SPEED, P_SUB_VCO, P_SUB_VCF, P_SUB_VCA,
                                    P_FEET_I, P_FEET_II, P_MIX, P_PAN, P_DETUNE,
                                    P_BRILLIANCE, P_RESONANCE, P_ECHO_MIX, P_REVERB_MIX,
                                    P_INIT_BEND, P_AT_SUB_SPEED, P_AT_SUB_VCO, P_AT_SUB_VCF,
                                    P_KBD_BRIL_LOW, P_KBD_BRIL_HIGH, P_KBD_LEVEL_LOW, P_KBD_LEVEL_HIGH};
        uint8_t const bcc[27] = {70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
                                 2, 3, 4, 5, 8, 9};
        for (int i = 0; i != 27; ++i) t.param[bcc[i]] = bottom[i];
        /* CC 64 stays the sustain pedal; the PM-80 sustain toggle sends it too */
        t.param[65] = P_GLISS;          /* glide toggle: porta / gliss */
        t.param[91] = P_REVERB_DECAY;
        t.param[92] = P_TREM_DEPTH;
        t.param[93] = P_CHORUS_DEPTH;
        t.param[94] = P_CHORUS_SPEED;
        t.param[95] = P_TREM_SPEED;
        t.param[118] = P_SUSTAIN_TIME;
        t.param[119] = P_PORTA_TIME;
        /* switches and settings with no PM-80 control: free CCs 33-37, 39 */
        t.param[33] = P_CHORUS_ON;
        t.param[34] = P_TREM_ON;
        t.param[35] = P_SUSTAIN_MODE;
        t.param[36] = P_ECHO_TIME;
        t.param[37] = P_ECHO_FB;
        t.param[39] = P_DRIFT;
        return t;
    }();
    return m;
}

/* M-Audio Oxygen 49: 9 faders, 8 knobs, mod wheel, pitch bend, sustain.
   Program these CC numbers into the Oxygen (Edit > Control Assign). */
inline CCMap const& oxygen49_map()
{
    static CCMap m = [] {
        CCMap t{"Oxygen 49", {}};
        /* faders F1-F9: CC 20-28 */
        uint8_t const f[9] = {P_BRILLIANCE, P_RESONANCE, P_MIX, P_IL, P_AL, P_A, P_R, P_SUSTAIN_TIME, P_MASTER};
        /* knobs K1-K8: CC 102-109 */
        uint8_t const k[8] = {P_SUB_SPEED, P_SUB_VCF, P_RING_MOD, P_RING_SPEED, P_DETUNE, P_CHORUS_DEPTH, P_ECHO_MIX, P_REVERB_MIX};
        for (int i = 0; i != 9; ++i) t.param[20 + i] = f[i];
        for (int i = 0; i != 8; ++i) t.param[102 + i] = k[i];
        return t;
    }();
    return m;
}

/* Faders that act on "both channels" in the Oxygen map: IL, AL, A and R are
   applied to I and II together. */
inline void handle_cc(Engine& e, CCMap const& map, int cc, int value)
{
    int const id = map.param[cc & 127];
    if (id == P_NONE) { e.control_change(cc, value); return; }
    float const x = value / 127.0f;
    apply_param(e.patch, id, x);
    if (&map == &oxygen49_map() && id >= P_PWM_SPEED && id < P_CH_END) apply_param(e.patch, id + CH_STRIDE, x);
    e.refresh_fx();
}

}  // namespace cs80v2
