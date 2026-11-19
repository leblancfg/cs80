/*
 * cs80v2 presets. The CS-80's 22 tones are resistor networks that nobody has
 * published as numbers, so these are reconstructions: tone pairs and
 * performance settings from documented recipes (Reverb Machine's CS-80
 * articles, the CS-80 V / GX-80 manuals) and the CS-80 voice architecture,
 * then set by ear and by spectral checks. The source of each is noted.
 */
#pragma once

#include <stdio.h>

#include "cs80v2.hpp"

namespace cs80v2 {

inline ChannelParams ch_init()
{
    ChannelParams c;
    memset(&c, 0, sizeof c);
    c.saw = true;
    c.hpf_hz = 40.0f; c.lpf_hz = 2000.0f; c.lpf_res = 0.1f;
    c.fa = 0.01f; c.fd = 0.3f; c.fr = 0.3f;
    c.vcf_level = 0.6f;
    c.a = 0.005f; c.d = 0.5f; c.s = 1.0f; c.r = 0.3f;
    c.level = 1.0f;
    return c;
}

inline Patch patch_init(char const* name)
{
    Patch p;
    memset(&p, 0, sizeof p);
    snprintf(p.name, sizeof p.name, "%s", name);
    p.ch[0] = p.ch[1] = ch_init();
    PerfParams& q = p.perf;
    q.feet[0] = q.feet[1] = 1;
    q.key_track = 0.7f;
    q.sub_wave = SUB_SINE; q.sub_hz = 5.0f;
    q.wheel_vco = 0.35f;
    q.ring_a = 0.05f; q.ring_d = 0.5f; q.ring_hz = 30.0f;
    q.sustain_mode = SUS_CS80_I; q.sustain_time = 1.5f;
    q.bend_up = 2.0f; q.bend_down = 2.0f;
    q.chorus = {false, false, 0.8f, 0.5f, 6.0f, 0.3f};
    q.drift = 1.0f;
    q.master = 0.5f;
    FxParams& f = p.fx;
    f.echo_mode = ECHO_OFF;
    f.echo_time = 0.469f; f.echo_fb = 0.35f; f.echo_mix = 0.25f; f.echo_damp_hz = 3500.0f;
    f.echo_taps = 3; f.echo_pan = 0.6f; f.echo_darken = 0.5f;
    f.reverb_mix = 0.2f;
    f.plate = {0.7f, 0.25f, 0.7f, 0.02f};
    return p;
}

/* Levels: each preset's master puts a held C major chord (C3 E3 G3 C4,
   velocity 100) at -13 dBFS RMS over the frames that sound. The engine's output
   limiter (ceiling -1 dBFS) takes the peaks, so short sounds such as the clav
   sit as loud as the pads. */

/* 1. Blade Runner brass ("Memories of Green" / "Tears in Rain" swells).
   Brass 1 + Brass 2 style pair: IL/AL swell, strong after-touch brilliance
   and level, after-touch vibrato through the sub oscillator, initial-touch
   bend, slow chorus, long plate. [RM Tears in Rain: touch response doing the
   work; GX-80 manual: IL+AL brass shapes] */
inline Patch blade_runner_brass()
{
    Patch p = patch_init("Blade Runner Brass");
    ChannelParams& a = p.ch[0];
    a.hpf_hz = 110.0f; a.hpf_res = 0.15f; a.lpf_hz = 380.0f; a.lpf_res = 0.3f;
    a.il = 1.0f; a.al = 2.2f; a.fa = 0.35f; a.fd = 1.6f; a.fr = 0.9f;
    a.a = 0.09f; a.d = 2.0f; a.s = 0.85f; a.r = 1.2f;
    a.level = 0.35f; a.init_level = 0.45f; a.after_level = 0.4f;
    a.init_bril = 1.0f; a.after_bril = 1.6f;
    a.vcf_level = 0.75f;
    ChannelParams& b = p.ch[1];
    b = a;
    b.square = true; b.pw = 0.15f; b.pwm_depth = 0.1f; b.pwm_hz = 0.6f;
    b.hpf_hz = 90.0f; b.lpf_hz = 560.0f; b.lpf_res = 0.2f;
    b.il = 0.8f; b.al = 1.7f; b.fa = 0.5f; b.fd = 2.2f;
    b.a = 0.14f; b.sine_level = 0.12f; b.vcf_level = 0.55f;
    PerfParams& q = p.perf;
    q.detune_cents = 6.0f;
    q.sub_hz = 5.2f; q.at_sub_vco = 0.35f; q.at_sub_speed = 0.3f;
    q.init_bend = 0.7f;
    q.kbd_level_high = -0.2f;
    q.sustain_time = 2.0f;
    q.chorus = {true, false, 0.7f, 0.6f, 6.0f, 0.0f};
    q.master = 0.608f;
    p.fx.echo_mode = ECHO_LINE; p.fx.echo_mix = 0.15f; p.fx.echo_fb = 0.3f;
    p.fx.reverb_mix = 0.35f; p.fx.plate = {0.85f, 0.3f, 0.65f, 0.03f};
    return p;
}

/* 2. Chariots-style brass lead: bright, resonant attack peak (AL with a
   short decay), line II an octave up, initial-touch bend, big plate.
   [Vangelis used CS-80 brass with heavy reverb; SOS95 on resonance and
   brilliance; settings by ear] */
inline Patch chariots()
{
    Patch p = patch_init("Chariots");
    ChannelParams& a = p.ch[0];
    a.hpf_hz = 150.0f; a.hpf_res = 0.2f; a.lpf_hz = 900.0f; a.lpf_res = 0.45f;
    a.il = 0.5f; a.al = 2.5f; a.fa = 0.04f; a.fd = 0.9f; a.fr = 0.6f;
    a.a = 0.02f; a.d = 1.5f; a.s = 0.8f; a.r = 1.4f;
    a.level = 0.5f; a.init_level = 0.5f; a.init_bril = 0.8f; a.after_bril = 1.0f; a.after_level = 0.2f;
    a.vcf_level = 0.7f;
    ChannelParams& b = p.ch[1];
    b = a;
    b.lpf_hz = 1300.0f; b.lpf_res = 0.3f; b.al = 1.8f; b.fa = 0.06f;
    b.vcf_level = 0.32f; b.sine_level = 0.05f;
    PerfParams& q = p.perf;
    q.feet[1] = 3; /* 4' */
    q.detune_cents = 4.0f;
    q.init_bend = 0.5f;
    q.sub_hz = 5.5f; q.sub_vco = 0.04f; q.at_sub_vco = 0.25f;
    q.sustain_time = 2.5f;
    q.chorus = {true, false, 0.5f, 0.35f, 6.0f, 0.0f};
    q.master = 0.745f;
    p.fx.reverb_mix = 0.42f; p.fx.plate = {0.9f, 0.25f, 0.7f, 0.04f};
    return p;
}

/* 3. Strings 1 + Strings 4 ("Africa"): mix 75 % line I, Brilliance down,
   Resonance up, a little chorus. [RM "Exploring the Yamaha CS-80": Toto IV] */
inline Patch africa_strings()
{
    Patch p = patch_init("Strings 1+4 (Africa)");
    ChannelParams& a = p.ch[0];
    a.square = true; a.pw = 0.1f; a.pwm_depth = 0.2f; a.pwm_hz = 4.5f;
    a.hpf_hz = 260.0f; a.hpf_res = 0.1f; a.lpf_hz = 3200.0f; a.lpf_res = 0.2f;
    a.il = 1.2f; a.al = 0.0f; a.fa = 0.5f; a.fd = 1.0f; a.fr = 1.0f;
    a.a = 0.3f; a.d = 1.0f; a.s = 1.0f; a.r = 1.1f;
    a.level = 0.6f; a.init_level = 0.4f; a.init_bril = 0.5f; a.after_bril = 1.0f;
    a.vcf_level = 0.6f;
    ChannelParams& b = p.ch[1];
    b = a;
    b.saw = false; b.pw = 0.25f; b.pwm_hz = 5.6f; b.pwm_depth = 0.12f;
    b.lpf_hz = 2400.0f; b.a = 0.45f;
    PerfParams& q = p.perf;
    q.mix = -0.5f;
    q.brilliance = -0.8f; q.resonance = 0.35f;
    q.detune_cents = -7.0f;
    q.chorus = {true, false, 0.9f, 0.35f, 6.0f, 0.0f};
    q.master = 0.365f;
    p.fx.reverb_mix = 0.22f;
    return p;
}

/* 4. Strings 1 + Brass 2 ("Human Nature" / "Billie Jean" vamp): 50/50 mix,
   Brilliance at -0.32 of full travel, Resonance at minimum, line I release
   longer, thick chorus. [RM "Exploring the Yamaha CS-80": Thriller] */
inline Patch human_nature()
{
    Patch p = patch_init("Strings 1+Brass 2");
    ChannelParams& a = p.ch[0];
    a.square = true; a.pw = 0.05f; a.pwm_depth = 0.15f; a.pwm_hz = 5.0f;
    a.hpf_hz = 200.0f; a.lpf_hz = 3000.0f; a.lpf_res = 0.15f;
    a.il = 1.0f; a.fa = 0.2f; a.fr = 1.8f;
    a.a = 0.12f; a.d = 1.0f; a.s = 1.0f; a.r = 1.8f;
    a.level = 0.6f; a.init_level = 0.4f; a.init_bril = 0.6f; a.after_bril = 0.8f;
    ChannelParams& b = p.ch[1];
    b.hpf_hz = 120.0f; b.lpf_hz = 650.0f; b.lpf_res = 0.25f;
    b.il = 0.6f; b.al = 2.0f; b.fa = 0.08f; b.fd = 0.7f; b.fr = 0.4f;
    b.a = 0.03f; b.d = 1.2f; b.s = 0.75f; b.r = 0.5f;
    b.level = 0.5f; b.init_level = 0.5f; b.init_bril = 1.0f;
    PerfParams& q = p.perf;
    q.brilliance = -0.32f * 3.0f;
    q.detune_cents = 5.0f;
    q.chorus = {true, false, 1.2f, 0.9f, 6.0f, 0.0f};
    q.master = 0.5f;
    p.fx.reverb_mix = 0.18f;
    return p;
}

/* 5. Organ 1 + Organ 2, one an octave up, chorus and tremolo for movement,
   Brilliance and Resonance up. [RM: Don Airey, "Mr Crowley"] */
inline Patch organ()
{
    Patch p = patch_init("Organ 1+2");
    ChannelParams& a = p.ch[0];
    a.square = true; a.saw = false; a.pw = 0.0f;
    a.hpf_hz = 60.0f; a.lpf_hz = 2600.0f; a.lpf_res = 0.1f;
    a.a = 0.004f; a.d = 0.1f; a.s = 1.0f; a.r = 0.08f;
    a.sine_level = 0.35f; a.vcf_level = 0.4f;
    ChannelParams& b = p.ch[1];
    b = a;
    b.square = false; b.saw = true; b.lpf_hz = 3500.0f; b.vcf_level = 0.22f; b.sine_level = 0.25f;
    PerfParams& q = p.perf;
    q.feet[1] = 3;
    q.brilliance = 0.4f; q.resonance = 0.25f;
    q.key_track = 1.0f;
    q.sustain_time = 0.6f;
    q.chorus = {true, true, 1.0f, 0.5f, 6.4f, 0.35f};
    q.master = 0.612f;
    p.fx.reverb_mix = 0.2f;
    return p;
}

/* 6. Funky / Clavichord: narrow pulse, bright pluck from AL with a short
   filter decay, velocity to brilliance and level, line II a 4' saw click.
   [GX-80 manual: AL with zero IL gives attack/decay; settings by ear] */
inline Patch funky_clav()
{
    Patch p = patch_init("Funky Clav");
    ChannelParams& a = p.ch[0];
    a.square = true; a.saw = false; a.pw = 0.3f;
    a.hpf_hz = 280.0f; a.hpf_res = 0.3f; a.lpf_hz = 650.0f; a.lpf_res = 0.55f;
    a.al = 3.0f; a.fa = 0.002f; a.fd = 0.18f; a.fr = 0.1f;
    a.a = 0.002f; a.d = 0.7f; a.s = 0.25f; a.r = 0.12f;
    a.level = 0.4f; a.init_level = 0.6f; a.init_bril = 1.2f;
    a.vcf_level = 0.8f;
    ChannelParams& b = p.ch[1];
    b.hpf_hz = 600.0f; b.lpf_hz = 1500.0f; b.lpf_res = 0.3f;
    b.al = 2.0f; b.fa = 0.002f; b.fd = 0.1f;
    b.a = 0.002f; b.d = 0.25f; b.s = 0.0f; b.r = 0.08f;
    b.level = 0.4f; b.init_level = 0.6f; b.vcf_level = 0.35f;
    PerfParams& q = p.perf;
    q.feet[1] = 3;
    q.sustain_time = 0.4f;
    q.master = 2.48f;
    p.fx.reverb_mix = 0.1f;
    return p;
}

/* 7. "Wonderful Christmastime": line II Bass tone only (Mix fully to II),
   sub oscillator saw-down at 2.85 Hz into the filters, Resonance up,
   Brilliance up. [RM "Exploring the Yamaha CS-80": Paul McCartney] */
inline Patch christmastime()
{
    Patch p = patch_init("Bass + Sub Saw");
    ChannelParams& b = p.ch[1];
    b.square = true; b.pw = 0.1f;
    b.hpf_hz = 50.0f; b.lpf_hz = 320.0f; b.lpf_res = 0.35f;
    b.al = 1.5f; b.fa = 0.005f; b.fd = 0.25f; b.fr = 0.2f;
    b.a = 0.004f; b.d = 0.4f; b.s = 0.7f; b.r = 0.25f;
    b.init_bril = 0.6f; b.level = 0.6f; b.init_level = 0.4f;
    b.sine_level = 0.2f; b.vcf_level = 0.7f;
    PerfParams& q = p.perf;
    q.mix = 1.0f;
    q.sub_wave = SUB_SAW_DOWN; q.sub_hz = 2.85f; q.sub_vcf = 0.9f;
    q.resonance = 0.45f; q.brilliance = 0.7f;
    q.sustain_time = 0.5f;
    q.master = 0.369f;
    p.fx.reverb_mix = 0.12f;
    return p;
}

/* 8. Blade Runner pad: slow PWM strings with a filter that opens from below
   (IL), after-touch brilliance, impure sine body, slow ring modulation for
   the "breathing" SOS describes, slow chorus, echo and a long plate.
   [SOS95 ring mod; RM Blade Runner reverb; settings by ear] */
inline Patch blade_runner_pad()
{
    Patch p = patch_init("Blade Runner Pad");
    ChannelParams& a = p.ch[0];
    a.square = true; a.pw = 0.1f; a.pwm_depth = 0.25f; a.pwm_hz = 0.3f;
    a.hpf_hz = 90.0f; a.lpf_hz = 800.0f; a.lpf_res = 0.25f;
    a.il = 1.5f; a.al = 0.5f; a.fa = 2.0f; a.fd = 3.0f; a.fr = 3.0f;
    a.a = 1.5f; a.d = 3.0f; a.s = 0.9f; a.r = 3.5f;
    a.level = 0.6f; a.after_level = 0.3f; a.after_bril = 1.2f; a.init_bril = 0.4f;
    a.vcf_level = 0.55f;
    ChannelParams& b = p.ch[1];
    b = a;
    b.saw = false; b.pw = 0.2f; b.pwm_hz = 0.45f; b.pwm_depth = 0.15f;
    b.hpf_hz = 200.0f; b.lpf_hz = 1100.0f;
    b.a = 2.0f; b.sine_level = 0.15f; b.vcf_level = 0.45f;
    PerfParams& q = p.perf;
    q.detune_cents = -8.0f;
    q.sub_hz = 4.5f; q.at_sub_vco = 0.2f;
    q.ring_mod = 0.25f; q.ring_hz = 0.6f;
    q.sustain_time = 3.0f;
    q.chorus = {true, false, 0.5f, 0.8f, 6.0f, 0.0f};
    q.master = 0.883f;
    p.fx.echo_mode = ECHO_LINE; p.fx.echo_mix = 0.25f; p.fx.echo_fb = 0.4f; p.fx.echo_time = 0.625f;
    p.fx.reverb_mix = 0.5f; p.fx.plate = {0.9f, 0.35f, 0.6f, 0.05f};
    return p;
}

inline int preset_count() { return 8; }
inline Patch preset(int i)
{
    switch (i) {
        case 0: return blade_runner_brass();
        case 1: return chariots();
        case 2: return africa_strings();
        case 3: return human_nature();
        case 4: return organ();
        case 5: return funky_clav();
        case 6: return christmastime();
        default: return blade_runner_pad();
    }
}

}  // namespace cs80v2
