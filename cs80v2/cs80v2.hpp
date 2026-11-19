/*
 * cs80v2: an 8 voice x 2 channel Yamaha CS-80 recreation for the ESP32-S3.
 *
 * Signal path per channel (I and II), per voice, as on the CS-80:
 *   VCO (PolyBLEP saw + PolyBLEP pulse with its own sine PWM LFO + noise)
 *   -> 12 dB resonant HPF -> 12 dB resonant LPF (soft-saturated input)
 *   -> VCF level, plus an impure sine that bypasses the filters
 *   -> VCA (ADSR x dynamics from Level / Initial Level / After Level)
 * Filter EG: IL / AL / A / D / R relative to the cutoff sliders, moving the
 * HPF by half as many octaves as the LPF. Both filters also follow global
 * Brilliance, key tracking, Keyboard Control, initial and after brilliance,
 * and the sub oscillator.
 *
 * Shared: sub oscillator (6 waves) to pitch / filters / amplitude with
 * per-key aftertouch on speed and depth, initial-touch pitch bend, ribbon
 * (pitch bend), polyphonic portamento and glissando, CS-80 sustain (extra
 * release time, modes I and II) or MIDI hold, ring modulator with its AD
 * speed envelope on the mono mix, then the stereo tremolo/chorus.
 * Gravy: ping-pong echo (delay line or replayed voices) and a plate reverb.
 *
 * Analog feel: every voice slot has its own static pitch, cutoff, time and
 * level tolerances (like 16 hand-trimmed voice cards) and a slow pitch drift.
 *
 * Real-time rules: no heap, no doubles, no libm in per-sample code; all
 * modulation runs every CTRL = 32 samples with per-sample ramps on gains and
 * filter coefficients.
 */
#pragma once

#include "dsp.hpp"

namespace cs80v2 {

constexpr int MAX_VOICES = 8;
#ifndef CS80_ECHO_VOICES
#define CS80_ECHO_VOICES 24
#endif
constexpr int ECHO_VOICES = CS80_ECHO_VOICES;
constexpr int MAX_EVENTS = 512;

enum SubWave : uint8_t { SUB_SINE, SUB_SAW_DOWN, SUB_SAW_UP, SUB_SQUARE, SUB_SH, SUB_NOISE };
enum SustainMode : uint8_t { SUS_CS80_I, SUS_CS80_II, SUS_HOLD };
enum AtMode : uint8_t { AT_POLY, AT_MONO, AT_LAST };
enum EchoMode : uint8_t { ECHO_OFF, ECHO_LINE, ECHO_VOICES_MODE };

/* footages 16', 8', 5 1/3', 4', 2 2/3', 2' as semitones from 8' */
static constexpr float FEET_SEMIS[6] = {-12.0f, 0.0f, 7.0f, 12.0f, 19.0f, 24.0f};

struct ChannelParams {
    /* VCO */
    float pwm_hz, pwm_depth, pw;     /* PW 0 = square .. 0.4 = 90 % pulse; PWM depth 0..0.4 */
    float square, saw;               /* independent oscillator levels, 0..1 */
    float noise;
    /* VCF */
    float hpf_hz, hpf_res, lpf_hz, lpf_res;
    float il, al;                    /* octaves below / above the cutoff, 0..5 */
    float fa, fd, fr;                /* seconds */
    bool inv;                        /* GX-1 / PM-80 invert switch */
    /* VCA */
    float vcf_level, sine_level;
    float a, d, s, r;
    /* touch response */
    float level, init_level, after_level; /* dynamics VCA: floor + velocity + aftertouch */
    float init_bril, after_bril;          /* octaves at full velocity / pressure */
};

struct PerfParams {
    uint8_t feet[2];
    float detune_cents;              /* channel II only */
    float mix;                       /* -1 = only I, +1 = only II */
    float pan_spread;                /* 0 = mono like the original, 1 = I left, II right */
    float brilliance, resonance;     /* octaves; resonance offset 0..1 */
    float key_track;                 /* built-in filter tracking, octaves per octave */
    /* sub oscillator */
    uint8_t sub_wave;
    float sub_hz, sub_vco, sub_vcf, sub_vca;   /* semitones, octaves, 0..1 */
    float wheel_vco;                 /* mod wheel adds to sub_vco (no wheel on a CS-80) */
    /* touch response, shared */
    float init_bend;                 /* semitones below pitch at full velocity */
    float at_sub_speed, at_sub_vco, at_sub_vcf;
    uint8_t at_mode;
    /* keyboard control: octaves / gain change at 2 octaves from the centre */
    float kbd_bril_low, kbd_bril_high, kbd_level_low, kbd_level_high;
    /* ring modulator */
    float ring_a, ring_d, ring_depth, ring_hz, ring_mod;
    /* left-hand panel */
    uint8_t sustain_mode;
    float sustain_time;
    float porta_time;                /* seconds per octave, 0 = off */
    bool gliss;
    float bend_up, bend_down;        /* ribbon range, semitones */
    ChorusParams chorus;
    float drift;                     /* 0 = perfect, 1 = default voice-card spread */
    float master;
};

struct FxParams {
    uint8_t echo_mode;
    float echo_time, echo_fb, echo_mix, echo_damp_hz;
    uint8_t echo_taps;               /* replayed-voice echoes per note */
    float echo_pan, echo_darken;     /* replay: stereo spread, octaves darker per repeat */
    float reverb_mix;
    PlateParams plate;
};

struct Patch {
    char name[32];
    ChannelParams ch[2];
    PerfParams perf;
    FxParams fx;
};

/* ---- voice state ---------------------------------------------------------- */

struct Line {
    float ph, dph, inv_dph, pw;
    float saw, pulse, noise;         /* oscillator levels, smoothed per control tick */
    float hp1, hp2, ha1, ha2, ha3, hk, dha1, dha2, dha3;
    float lp1, lp2, la1, la2, la3, lk, dla1, dla2, dla3;
    float gv, dgv, gs, dgs;          /* VCF path gain and sine gain ramps */
    Env fe, ae;
    float tol_cents, tol_oct, tol_time, tol_gain;
    float drift;
};

struct Voice {
    Line line[2];
    uint32_t rng, age;
    float vel, at;
    float glide, bend0;              /* portamento position (notes), initial bend (semitones) */
    float sub_ph, sub_val;
    float kbd_lo, kbd_hi;
    float gain_scale, extra_oct, pan_l, pan_r;  /* used by replayed echo voices */
    uint16_t tag;
    uint8_t echo_k;
    int8_t note;
    bool gate, sustained, active, long_rel, fresh;
};

struct Event { uint32_t t; uint16_t tag; uint8_t type, k, note, vel; };

class Engine {
  public:
    Patch patch;

    void init(float sample_rate, Patch const& p)
    {
        memset(this, 0, sizeof *this);
        grng = 0x1234567u;
        volume = 1.0f;
        sr = sample_rate;
        inv_sr = 1.0f / sr;
        rate = sr / CTRL;
        chorus.init();
        echo_line.init();
        plate.init((int)sr);
        limiter.init(sr, CTRL);
        set_patch(p);
        uint32_t seed = 0x2545f491u;
        for (int v = 0; v != MAX_VOICES; ++v) seed_voice(voices[v], v, seed);
        for (int v = 0; v != ECHO_VOICES; ++v) seed_voice(echo[v], v & 7, seed);
        last_note = -1;
        expression = 1.0f;
    }

    void set_patch(Patch const& p) { patch = p; refresh_fx(); }

    /* call after editing patch.fx */
    void refresh_fx()
    {
        echo_line.set(patch.fx.echo_time, patch.fx.echo_fb, patch.fx.echo_damp_hz, sr);
        plate.set(patch.fx.plate);
    }

    /* ---- MIDI-level input ------------------------------------------------ */

    void note_on(int note, int velocity)
    {
        if (velocity == 0) { note_off(note); return; }
        PerfParams const& pp = patch.perf;
        if (pp.sustain_mode == SUS_CS80_II) /* a new note cuts the fading ones */
            for (auto& vo : voices) if (vo.active && !vo.gate) cut(vo);
        if (keys_down == 0) ring_trigger();
        ++keys_down;
        Voice& vo = voices[alloc(voices, MAX_VOICES)];
        if (vo.gate) schedule_echo_offs(vo); /* stolen while held */
        start_voice(vo, note, velocity / 127.0f, 1.0f, 0.0f, 0.0f, 1.0f, 1.0f);
        vo.tag = ++tag_clock;
        last_voice = &vo;
        last_note = note;
        if (patch.fx.echo_mode == ECHO_VOICES_MODE) schedule_echo_ons(vo);
    }

    void note_off(int note)
    {
        for (auto& vo : voices) {
            if (!(vo.active && vo.gate && vo.note == note)) continue;
            vo.gate = false;
            if (keys_down > 0) --keys_down;
            if (sustain && patch.perf.sustain_mode == SUS_HOLD) { vo.sustained = true; continue; }
            release(vo, sustain);
        }
    }

    void control_change(int cc, int value)
    {
        float const x = value / 127.0f;
        if (cc == 1) wheel = x;
        else if (cc == 7) volume = x;
        else if (cc == 11) expression = x;
        else if (cc == 64) set_sustain(value >= 64);
        else if (cc == 120 || cc == 123) all_off(cc == 120);
    }

    void pitch_bend(int value14) { bend = (value14 - 8192) / 8192.0f; }

    void channel_pressure(int value)
    {
        float const x = value / 127.0f;
        if (patch.perf.at_mode == AT_LAST) { if (last_voice && last_voice->gate) last_voice->at = x; return; }
        for (auto& vo : voices) if (vo.gate) vo.at = x;
    }

    void poly_pressure(int note, int value)
    {
        for (auto& vo : voices) if (vo.gate && vo.note == note) vo.at = value / 127.0f;
    }

    void set_sustain(bool on)
    {
        if (on == sustain) return;
        sustain = on;
        if (on) return;
        for (auto& vo : voices) {
            if (vo.sustained) { vo.sustained = false; release(vo, false); }
            else if (vo.active && !vo.gate && vo.long_rel) release(vo, false); /* pedal up shortens the tail */
        }
    }

    int active_voices() const { int n = 0; for (auto const& v : voices) n += v.active; return n; }
    int active_echo_voices() const { int n = 0; for (auto const& v : echo) n += v.active; return n; }

    /* ---- audio ------------------------------------------------------------ */

    /* n must be a multiple of CTRL. On the S3, voices 0..3 and 4..7 can be
       rendered on separate cores with render_voices(); see REPORT-v2.md. */
    CS80_IRAM void process(float* out_l, float* out_r, int n)
    {
        for (int off = 0; off < n; off += CTRL) {
            run_events();
            control_tick();
            float b1[CTRL], b2[CTRL];
            memset(b1, 0, sizeof b1);
            memset(b2, 0, sizeof b2);
            render_voices(0, MAX_VOICES, b1, b2);
            post(b1, b2, out_l + off, out_r + off);
            now += CTRL;
        }
    }

    CS80_IRAM void render_voices(int v0, int v1, float* b1, float* b2)
    {
        float tmp[CTRL];
        for (int v = v0; v != v1; ++v) {
            Voice& vo = voices[v];
            if (!vo.active) continue;
            render_p1(vo.line[0], vo.rng, tmp);
            render_p2(vo.line[0], tmp, b1);
            render_p1(vo.line[1], vo.rng, tmp);
            render_p2(vo.line[1], tmp, b2);
        }
    }

    float sr, inv_sr, rate;
    void bench_control_tick() { control_tick(); }

  private:
    /* ---- voices ----------------------------------------------------------- */

    static void seed_voice(Voice& vo, int slot, uint32_t& seed)
    {
        /* voice-card tolerances: fixed per slot, like trimmed hardware */
        for (int l = 0; l != 2; ++l) {
            Line& ln = vo.line[l];
            ln.tol_cents = 2.5f * rnd_bip(seed);
            ln.tol_oct = 0.08f * rnd_bip(seed);
            ln.tol_time = 1.0f + 0.06f * rnd_bip(seed);
            ln.tol_gain = 1.0f + 0.05f * rnd_bip(seed);
            ln.ph = 0.5f + 0.5f * rnd_bip(seed);
        }
        vo.rng = 0x9e3779b9u * (slot + 1) + seed;
    }

    template <int N> static int alloc_impl(Voice (&pool)[N])
    {
        int best = -1;
        uint32_t best_age = 0xffffffffu;
        for (int pass = 0; pass != 3 && best < 0; ++pass) {
            for (int v = 0; v != N; ++v) {
                Voice const& vo = pool[v];
                bool const ok = pass == 0 ? !vo.active : pass == 1 ? (!vo.gate && !vo.sustained) : true;
                if (ok && vo.age < best_age) { best = v; best_age = vo.age; }
            }
        }
        return best;
    }
    int alloc(Voice (&pool)[MAX_VOICES], int) { return alloc_impl(pool); }
    int alloc_echo() { return alloc_impl(echo); }

    void start_voice(Voice& vo, int note, float vel, float gain_scale, float extra_oct, float pan, float, float)
    {
        PerfParams const& pp = patch.perf;
        bool const was_active = vo.active;
        vo.note = (int8_t)note;
        vo.vel = vel;
        vo.at = 0.0f;
        vo.gate = true;
        vo.sustained = vo.long_rel = false;
        vo.active = true;
        vo.age = ++age_clock;
        vo.gain_scale = gain_scale;
        vo.extra_oct = extra_oct;
        vo.pan_l = 1.0f - pan;
        vo.pan_r = 1.0f + pan;
        float const lo = (60.0f - note) / 24.0f, hi = (note - 72.0f) / 24.0f;
        vo.kbd_lo = clampf(lo, 0.0f, 1.5f);
        vo.kbd_hi = clampf(hi, 0.0f, 1.5f);
        vo.bend0 = -pp.init_bend * vel * vel;
        vo.glide = (pp.porta_time > 0.0f && last_note >= 0) ? (float)last_note : (float)note;
        vo.sub_ph = sub_ph;
        vo.sub_val = sub_val;
        vo.fresh = !was_active;
        for (int l = 0; l != 2; ++l) {
            Line& ln = vo.line[l];
            ChannelParams const& cp = patch.ch[l];
            if (!was_active) {
                ln.hp1 = ln.hp2 = ln.lp1 = ln.lp2 = 0.0f;
                ln.gv = ln.gs = 0.0f;
                ln.fe.v = -cp.il;
                ln.ae.v = 0.0f;
            }
            ln.fe.set(1, cp.al, cp.fa * ln.tol_time, rate);
            ln.ae.set(1, 1.0f, cp.a * ln.tol_time, rate);
        }
    }

    void release(Voice& vo, bool pedal)
    {
        float const extra = pedal ? patch.perf.sustain_time : 0.0f;
        vo.long_rel = pedal && extra > 0.0f;
        for (int l = 0; l != 2; ++l) {
            ChannelParams const& cp = patch.ch[l];
            Line& ln = vo.line[l];
            ln.fe.set(4, -cp.il, (cp.fr + extra) * ln.tol_time, rate);
            ln.ae.set(4, 0.0f, (cp.r + extra) * ln.tol_time, rate);
        }
        if (&vo >= voices && &vo < voices + MAX_VOICES) schedule_echo_offs(vo);
    }

    void cut(Voice& vo)
    {
        for (auto& ln : vo.line) { ln.ae.set(4, 0.0f, 0.008f, rate); }
        vo.long_rel = false;
    }

    void all_off(bool hard)
    {
        sustain = false;
        keys_down = 0;
        nevents = 0;
        for (auto& vo : voices) { if (hard) vo.active = false; else if (vo.active) { vo.gate = vo.sustained = false; release(vo, false); } }
        for (auto& vo : echo) vo.active = false;
    }

    /* ---- echo as replayed voices ---------------------------------------- */

    void push_event(uint32_t t, uint8_t type, uint16_t tag, uint8_t k, int note, int vel)
    {
        if (nevents == MAX_EVENTS) return;
        events[nevents++] = {t, tag, type, k, (uint8_t)note, (uint8_t)vel};
    }

    void schedule_echo_ons(Voice const& vo)
    {
        FxParams const& fx = patch.fx;
        uint32_t const d = (uint32_t)(fx.echo_time * sr);
        for (int k = 1; k <= fx.echo_taps; ++k)
            push_event(now + k * d, 1, vo.tag, (uint8_t)k, vo.note, (int)(vo.vel * 127.0f + 0.5f));
    }

    void schedule_echo_offs(Voice const& vo)
    {
        FxParams const& fx = patch.fx;
        if (fx.echo_mode != ECHO_VOICES_MODE) return;
        uint32_t const d = (uint32_t)(fx.echo_time * sr);
        for (int k = 1; k <= fx.echo_taps; ++k) push_event(now + k * d, 0, vo.tag, (uint8_t)k, vo.note, 0);
    }

    void run_events()
    {
        int j = 0;
        uint32_t const horizon = now + CTRL;
        for (int i = 0; i != nevents; ++i) {
            Event const& e = events[i];
            if ((int32_t)(e.t - horizon) >= 0) { events[j++] = e; continue; }
            if (e.type == 1) {
                FxParams const& fx = patch.fx;
                float g = 1.0f;
                for (int k = 0; k != e.k; ++k) g *= fx.echo_fb;
                Voice& ev = echo[alloc_echo()];
                float const pan = (e.k & 1) ? -fx.echo_pan : fx.echo_pan;
                start_voice(ev, e.note, e.vel / 127.0f, g, -fx.echo_darken * e.k, pan, 0, 0);
                ev.tag = e.tag;
                ev.echo_k = e.k;
            } else {
                for (auto& ev : echo)
                    if (ev.active && ev.gate && ev.tag == e.tag && ev.echo_k == e.k) { ev.gate = false; release(ev, false); }
            }
        }
        nevents = j;
    }

    /* ---- control rate ----------------------------------------------------- */

    void ring_trigger() { ring_stage = 1; } /* attack restarts from the current level */

    float sub_wave(float ph, float held) const
    {
        switch (patch.perf.sub_wave) {
            case SUB_SAW_DOWN: return 1.0f - 2.0f * ph;
            case SUB_SAW_UP: return 2.0f * ph - 1.0f;
            case SUB_SQUARE: return ph < 0.5f ? 1.0f : -1.0f;
            case SUB_SH: case SUB_NOISE: return held;
            default: return sin_par(ph);
        }
    }

    CS80_IRAM void control_tick()
    {
        PerfParams const& pp = patch.perf;
        float const ticks = rate, inv_ticks = 1.0f / rate;

        /* global sub oscillator; voices keep their own phase for aftertouch speed */
        float const sub_inc = pp.sub_hz * inv_ticks;
        sub_ph += sub_inc;
        if (sub_ph >= 1.0f) { sub_ph -= 1.0f; sub_val = rnd_bip(grng); }
        if (pp.sub_wave == SUB_NOISE) sub_val = rnd_bip(grng);

        for (int c = 0; c != 2; ++c) pwm_ph[c] = wrap1(pwm_ph[c] + patch.ch[c].pwm_hz * inv_ticks);
        float const pwm_lfo[2] = {sin_par(pwm_ph[0]), sin_par(pwm_ph[1])};

        float const bend_semi = bend >= 0.0f ? bend * pp.bend_up : bend * pp.bend_down;
        float const glide_step = pp.porta_time > 0.0f ? 12.0f * inv_ticks / pp.porta_time : 1000.0f;
        float const bend0_step = 40.0f * inv_ticks; /* initial-touch swoop: fixed 40 semitones/s */
        float const mixg[2] = {clampf(1.0f - pp.mix, 0.0f, 1.0f), clampf(1.0f + pp.mix, 0.0f, 1.0f)};
        float const out_gain = pp.master * volume * expression;
        float const drift_k = pp.drift;

        for (int pool = 0; pool != 2; ++pool) {
            Voice* vs = pool == 0 ? voices : echo;
            int const nv = pool == 0 ? MAX_VOICES : ECHO_VOICES;
            for (int v = 0; v != nv; ++v) {
                Voice& vo = vs[v];
                if (!vo.active) continue;
                /* per-voice sub oscillator (aftertouch can speed it up per key) */
                float const at = vo.at;
                vo.sub_ph += sub_inc * (1.0f + pp.at_sub_speed * at);
                if (vo.sub_ph >= 1.0f) { vo.sub_ph -= 1.0f; vo.sub_val = rnd_bip(vo.rng); }
                if (pp.sub_wave == SUB_NOISE) vo.sub_val = sub_val;
                float const lfo = sub_wave(vo.sub_ph, vo.sub_val);
                float const vib = lfo * (pp.sub_vco + wheel * pp.wheel_vco + pp.at_sub_vco * at);
                float const lfo_oct = lfo * (pp.sub_vcf + pp.at_sub_vcf * at);
                float const trem = 1.0f - pp.sub_vca * (0.5f - 0.5f * lfo);

                /* portamento / glissando and the initial-touch bend */
                float const tgt = (float)vo.note;
                if (vo.glide < tgt) { vo.glide += glide_step; if (vo.glide > tgt) vo.glide = tgt; }
                else if (vo.glide > tgt) { vo.glide -= glide_step; if (vo.glide < tgt) vo.glide = tgt; }
                float const gl = pp.gliss ? (float)fast_floor(vo.glide + 0.5f) : vo.glide;
                if (vo.bend0 < 0.0f) { vo.bend0 += bend0_step; if (vo.bend0 > 0.0f) vo.bend0 = 0.0f; }

                float const key_oct = (vo.note - 60) * (1.0f / 12.0f);
                float const kbd_oct = pp.kbd_bril_low * vo.kbd_lo + pp.kbd_bril_high * vo.kbd_hi;
                float const kbd_gain = clampf(1.0f + pp.kbd_level_low * vo.kbd_lo + pp.kbd_level_high * vo.kbd_hi, 0.0f, 2.0f);

                bool alive = false;
                for (int l = 0; l != 2; ++l) {
                    Line& ln = vo.line[l];
                    ChannelParams const& cp = patch.ch[l];
                    if (ln.fe.tick()) ln.fe.set(2, 0.0f, cp.fd * ln.tol_time, ticks);
                    if (ln.ae.tick()) ln.ae.set(2, cp.s, cp.d * ln.tol_time, ticks);

                    /* slow random-walk drift, about +-1.5 cents at drift = 1 */
                    ln.drift += 0.02f * (1.5f * rnd_bip(vo.rng) - ln.drift);
                    float const cents = drift_k * (ln.tol_cents + ln.drift) + (l ? pp.detune_cents : 0.0f);
                    float const semis = gl - 69.0f + FEET_SEMIS[pp.feet[l]] + bend_semi + vo.bend0 + vib + cents * 0.01f;
                    float const f = 440.0f * fast_exp2(semis * (1.0f / 12.0f));
                    float dph = f * inv_sr;
                    if (dph > 0.45f) dph = 0.45f;
                    ln.dph = dph;
                    ln.inv_dph = fast_recip(dph);

                    float const pw = 0.5f - cp.pw - cp.pwm_depth * pwm_lfo[l];
                    ln.pw = clampf(pw, 0.06f, 0.94f);
                    /* independent saw and pulse levels: one-pole smoothing at the control
                       boundary (about 4 ms), constant inside the block, so the audio loop
                       costs the same as fixed levels */
                    glide_level(ln.saw, 0.5f * clampf(cp.saw, 0.0f, 1.0f), vo.fresh);
                    glide_level(ln.pulse, 0.5f * clampf(cp.square, 0.0f, 1.0f), vo.fresh);
                    ln.noise = cp.noise * 0.5f * 4.656613e-10f;

                    /* everything that moves the filters, in octaves */
                    float const env = cp.inv ? -ln.fe.v : ln.fe.v;
                    float const mod = pp.brilliance + pp.key_track * key_oct + kbd_oct + cp.init_bril * vo.vel
                                      + cp.after_bril * at + lfo_oct + drift_k * ln.tol_oct + vo.extra_oct;
                    float a1, a2, a3, k;
                    svf_coefs(cp.hpf_hz * fast_exp2(0.5f * (env + mod)), cp.hpf_res + pp.resonance, a1, a2, a3, k);
                    ramp(ln.ha1, ln.dha1, a1, vo.fresh); ramp(ln.ha2, ln.dha2, a2, vo.fresh); ramp(ln.ha3, ln.dha3, a3, vo.fresh);
                    ln.hk = k;
                    svf_coefs(cp.lpf_hz * fast_exp2(env + mod), cp.lpf_res + pp.resonance, a1, a2, a3, k);
                    ramp(ln.la1, ln.dla1, a1, vo.fresh); ramp(ln.la2, ln.dla2, a2, vo.fresh); ramp(ln.la3, ln.dla3, a3, vo.fresh);
                    ln.lk = k;

                    /* dynamics VCA x envelope x keyboard level x mix */
                    float const dyn = clampf(cp.level + cp.init_level * vo.vel + cp.after_level * at, 0.0f, 1.5f);
                    float const g = ln.ae.v * dyn * kbd_gain * trem * mixg[l] * ln.tol_gain * vo.gain_scale * out_gain;
                    ln.dgv = (g * cp.vcf_level - ln.gv) * (1.0f / CTRL);
                    ln.dgs = (g * cp.sine_level - ln.gs) * (1.0f / CTRL);

                    if (ln.ae.stage != 4 || ln.ae.v > 2e-5f) alive = true;
                }
                vo.fresh = false;
                if (!alive) { vo.active = false; vo.gate = false; }
            }
        }

        /* ring modulator AD envelope on carrier speed (monophonic) */
        if (ring_stage == 1) {
            ring_env += inv_ticks / (pp.ring_a + 1e-3f);
            if (ring_env >= 1.0f) { ring_env = 1.0f; ring_stage = 2; }
        } else if (ring_stage == 2) {
            ring_env -= inv_ticks / (pp.ring_d + 1e-3f);
            if (ring_env <= 0.0f) { ring_env = 0.0f; ring_stage = 0; }
        }
        ring_inc = pp.ring_hz * fast_exp2(6.0f * pp.ring_depth * ring_env) * inv_sr;
        if (ring_inc > 0.45f) ring_inc = 0.45f;

        chorus.tick(pp.chorus, sr);
    }

    static inline void glide_level(float& cur, float target, bool fresh)
    {
        cur = fresh ? target : cur + 0.15f * (target - cur);
    }

    static inline void ramp(float& cur, float& d, float target, bool fresh)
    {
        if (fresh) { cur = target; d = 0.0f; }
        else d = (target - cur) * (1.0f / CTRL);
    }

    void svf_coefs(float hz, float res, float& a1, float& a2, float& a3, float& k) const
    {
        float const fmax = 0.40f * sr;
        hz = clampf(hz, 12.0f, fmax);
        float const g = tan_pade(3.14159265f * hz * inv_sr);
        res = clampf(res, 0.0f, 0.97f);
        k = 2.0f - 2.0f * res;
        a1 = fast_recip(1.0f + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
    }

    /* ---- audio rate ------------------------------------------------------- */

    static inline float blep(float t, float dt, float inv_dt)
    {
        if (t < dt) { t *= inv_dt; return t + t - t * t - 1.0f; }
        if (t > 1.0f - dt) { t = (t - 1.0f) * inv_dt; return t * t + t + t + 1.0f; }
        return 0.0f;
    }

    /* pass 1: oscillators + noise + HPF (TPT SVF, high-pass output) into tmp */
    CS80_NOINLINE CS80_IRAM static void render_p1(Line& ln, uint32_t& rng, float* tmp)
    {
        float ph = ln.ph;
        float const dph = ln.dph, inv_dph = ln.inv_dph, pw = ln.pw;
        float const saw = ln.saw, pulse = ln.pulse, noise = ln.noise;
        float hp1 = ln.hp1, hp2 = ln.hp2;
        float a1 = ln.ha1, a2 = ln.ha2, a3 = ln.ha3;
        float const d1 = ln.dha1, d2 = ln.dha2, d3 = ln.dha3, hk = ln.hk;
        uint32_t r = rng;
        for (int i = 0; i != CTRL; ++i) {
            ph += dph;
            if (ph >= 1.0f) ph -= 1.0f;
            float ph2 = ph + pw;
            if (ph2 >= 1.0f) ph2 -= 1.0f;
            float const s1 = 2.0f * ph - 1.0f - blep(ph, dph, inv_dph);
            float const s2 = 2.0f * ph2 - 1.0f - blep(ph2, dph, inv_dph);
            r ^= r << 13; r ^= r >> 17; r ^= r << 5;
            float const x = saw * s1 + pulse * (s1 - s2) + noise * (float)(int32_t)r;
            float const v3 = x - hp2;
            float const v1 = a1 * hp1 + a2 * v3;
            float const v2 = hp2 + a2 * hp1 + a3 * v3;
            hp1 = 2.0f * v1 - hp1;
            hp2 = 2.0f * v2 - hp2;
            tmp[i] = x - hk * v1 - v2;
            a1 += d1; a2 += d2; a3 += d3;
        }
        ln.ph = ph; ln.hp1 = hp1; ln.hp2 = hp2; ln.ha1 = a1; ln.ha2 = a2; ln.ha3 = a3;
        rng = r;
    }

    /* pass 2: saturated LPF + impure sine + VCA, accumulated into the channel bus.
       The sine re-derives the oscillator phase of this tick from ln.ph. */
    CS80_NOINLINE CS80_IRAM static void render_p2(Line& ln, float const* tmp, float* acc)
    {
        float lp1 = ln.lp1, lp2 = ln.lp2;
        float a1 = ln.la1, a2 = ln.la2, a3 = ln.la3;
        float const d1 = ln.dla1, d2 = ln.dla2, d3 = ln.dla3;
        float gv = ln.gv, gs = ln.gs;
        float const dgv = ln.dgv, dgs = ln.dgs, dph = ln.dph;
        float sph = ln.ph - CTRL * dph;   /* phase at the start of this tick */
        while (sph < 0.0f) sph += 1.0f;
        for (int i = 0; i != CTRL; ++i) {
            float x = tmp[i];
            x = x > 1.5f ? 1.5f : (x < -1.5f ? -1.5f : x);
            x = x - 0.14815f * x * x * x;
            float const v3 = x - lp2;
            float const v1 = a1 * lp1 + a2 * v3;
            float const v2 = lp2 + a2 * lp1 + a3 * v3;
            lp1 = 2.0f * v1 - lp1;
            lp2 = 2.0f * v2 - lp2;
            sph += dph;
            if (sph >= 1.0f) sph -= 1.0f;
            float const s = sin_par(sph);
            float const si = s + 0.02f * s * s - 0.01f + 0.01f * s * s * s; /* a few harmonics, like the CS-80 sine */
            acc[i] += v2 * gv + si * gs;
            gv += dgv; gs += dgs;
            a1 += d1; a2 += d2; a3 += d3;
        }
        ln.lp1 = lp1; ln.lp2 = lp2;
        ln.la1 = a1; ln.la2 = a2; ln.la3 = a3;
        ln.gv = gv; ln.gs = gs;
    }

    /* sum the channel buses to mid/side through an AC-coupling DC blocker
       (about 7 Hz): the saturated saw + pulse mix is asymmetric and makes DC */
    CS80_NOINLINE CS80_IRAM void mix_bus(float const* b1, float const* b2, float* mid, float* side, float sp)
    {
        float xm = dcm_x, ym = dcm_y, xs = dcs_x, ys = dcs_y;
        for (int i = 0; i != CTRL; ++i) {
            float const m = b1[i] + b2[i], s = sp * (b1[i] - b2[i]);
            ym = m - xm + 0.999f * ym; xm = m;
            ys = s - xs + 0.999f * ys; xs = s;
            mid[i] = ym; side[i] = ys;
        }
        dcm_x = xm; dcm_y = ym; dcs_x = xs; dcs_y = ys;
    }

    /* ring modulator on the mono mix (and on the side signal when panned) */
    CS80_NOINLINE CS80_IRAM void ring(float* mid, float* side)
    {
        float const m = patch.perf.ring_mod;
        float ph = ring_ph;
        float const inc = ring_inc, dry = 1.0f - m;
        for (int i = 0; i != CTRL; ++i) {
            ph += inc;
            if (ph >= 1.0f) ph -= 1.0f;
            float const g = dry + m * sin_par(ph);
            mid[i] *= g;
            side[i] *= g;
        }
        ring_ph = ph;
    }

    /* echo voices: render both channels into a mono temp, then pan */
    CS80_NOINLINE CS80_IRAM void render_echo_voices(float* el, float* er)
    {
        float tmp[CTRL], vb[CTRL];
        for (auto& vo : echo) {
            if (!vo.active) continue;
            memset(vb, 0, sizeof vb);
            render_p1(vo.line[0], vo.rng, tmp);
            render_p2(vo.line[0], tmp, vb);
            render_p1(vo.line[1], vo.rng, tmp);
            render_p2(vo.line[1], tmp, vb);
            float const pl = vo.pan_l, pr = vo.pan_r;
            for (int i = 0; i != CTRL; ++i) { el[i] += pl * vb[i]; er[i] += pr * vb[i]; }
        }
    }

    CS80_IRAM void post(float* b1, float* b2, float* out_l, float* out_r)
    {
        PerfParams const& pp = patch.perf;
        FxParams const& fx = patch.fx;
        float mid[CTRL], side[CTRL];
        float const sp = 0.5f * pp.pan_spread;
        mix_bus(b1, b2, mid, side, sp);
        if (pp.ring_mod > 0.0f) ring(mid, side);
        chorus.process(mid, side, out_l, out_r);

        if (fx.echo_mode == ECHO_VOICES_MODE) {
            float el[CTRL], er[CTRL];
            memset(el, 0, sizeof el);
            memset(er, 0, sizeof er);
            render_echo_voices(el, er);
            float const w = fx.echo_mix;
            for (int i = 0; i != CTRL; ++i) { out_l[i] += w * el[i]; out_r[i] += w * er[i]; }
        } else if (fx.echo_mode == ECHO_LINE) {
            float dl[CTRL], dr[CTRL];
            memcpy(dl, out_l, sizeof dl);
            memcpy(dr, out_r, sizeof dr);
            echo_line.process(dl, dr, out_l, out_r, fx.echo_mix);
        }
        if (fx.reverb_mix > 0.0f) {
            float m[CTRL];
            for (int i = 0; i != CTRL; ++i) m[i] = 0.5f * (out_l[i] + out_r[i]);
            plate.process(m, out_l, out_r, fx.reverb_mix);
        }
        limiter.process<CTRL>(out_l, out_r);
    }

    /* ---- state ------------------------------------------------------------ */

    Voice voices[MAX_VOICES];
    Voice echo[ECHO_VOICES];
    Event events[MAX_EVENTS];
    int nevents;
    Voice* last_voice;
    Chorus chorus;
    EchoLine echo_line;

  public:
    OutLimiter limiter; /* output ceiling -1 dBFS; limiter.gmin / peak_in are meters */
    Plate<float, 2> plate; /* float storage, tank at sr/2: 82 KB of SRAM; Plate<int16_t, 2> halves that, see REPORT-v2.md */

  private:
    uint32_t now, age_clock, grng;
    uint16_t tag_clock;
    int keys_down, last_note;
    float pwm_ph[2], sub_ph, sub_val;
    float ring_ph, ring_inc, ring_env;
    float dcm_x, dcm_y, dcs_x, dcs_y;
    uint8_t ring_stage;
    float bend, wheel, volume, expression;
    bool sustain;
};

}  // namespace cs80v2
