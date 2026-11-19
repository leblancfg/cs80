/*
 * cs80v2 DSP building blocks: cheap math, envelopes, and the three effects
 * (CS-80 tremolo/chorus, ping-pong echo line, Dattorro plate).
 *
 * Rules for everything in this file: no heap, no doubles, no libm in a
 * per-sample loop. Per-sample loops live in CS80_NOINLINE functions so the
 * ESP32-S3 build can count their instructions one by one.
 */
#pragma once

#include <math.h>
#include <stdint.h>
#include <string.h>

#ifndef CS80_IRAM
#define CS80_IRAM
#endif
#ifndef CS80_PSRAM /* EXT_RAM_BSS_ATTR on the S3 */
#define CS80_PSRAM
#endif
#define CS80_NOINLINE __attribute__((noinline))

namespace cs80v2 {

constexpr int CTRL = 32; /* samples per control tick: 1.5 kHz at 48 kHz */

/* ---- cheap math (control rate unless noted) ----------------------------- */

static inline int fast_floor(float x)
{
    int i = (int)x;
    return x < (float)i ? i - 1 : i;
}

static inline float fast_exp2(float x) /* |rel err| < 2e-4 */
{
    if (x < -30.0f) x = -30.0f;
    if (x > 30.0f) x = 30.0f;
    int const fl = fast_floor(x);
    float const f = x - (float)fl;
    union { float f; int32_t i; } u;
    u.f = 1.0f + f * (0.6951786f + f * (0.2262379f + f * 0.0790209f));
    u.i += fl << 23;
    return u.f;
}

/* 1/x on the FPU: magic-constant seed + 2 Newton steps, |rel err| < 2e-5 for
   x > 0. The S3 has no single-instruction divide; GCC calls __divsf3. */
static inline float fast_recip(float x)
{
    union { float f; int32_t i; } u;
    u.f = x;
    u.i = 0x7EF311C7 - u.i;
    float y = u.f;
    y = y * (2.0f - x * y);
    y = y * (2.0f - x * y);
    return y * (2.0f - x * y);
}

static inline float tan_pade(float x) { float const x2 = x * x; return x * (15.0f - x2) * fast_recip(15.0f - 6.0f * x2); }
static inline float tri(float ph) { return 4.0f * (ph < 0.5f ? ph : 1.0f - ph) - 1.0f; }

static inline float sin_par(float ph) /* ph in [0,1) -> ~sin(2 pi ph), per-sample safe */
{
    float const x = 1.0f - 2.0f * ph;
    float const y = 4.0f * x * (1.0f - fabsf(x));
    return y + 0.225f * y * (fabsf(y) - 1.0f);
}

static inline float wrap1(float ph) { return ph >= 1.0f ? ph - 1.0f : ph; }

static inline uint32_t xorshift(uint32_t& r) { r ^= r << 13; r ^= r >> 17; r ^= r << 5; return r; }
static inline float rnd_bip(uint32_t& r) { return (float)(int32_t)xorshift(r) * 4.656613e-10f; }

static inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }

/* ---- one-pole RC envelope, evaluated once per tick ---------------------- */

struct Env {
    float v, target, coef, goal;
    uint8_t stage; /* 0 off, 1 attack, 2 decay, 3 sustain, 4 release */
    bool rising;

    /* rate = control ticks per second. The RC reaches 'goal' in about 'seconds'. */
    void set(uint8_t st, float g, float seconds, float rate)
    {
        stage = st;
        goal = g;
        rising = g >= v;
        target = st == 1 ? g + 0.3f * (g - v) : g; /* attack overshoots, like a CS/GX AR */
        float const ticks = seconds * rate;
        coef = ticks < 1.0f ? 1.0f : 1.0f - expf(-1.0f / (ticks * 0.3f));
    }
    /* returns true when the attack just ended */
    bool tick()
    {
        if (stage == 0) return false;
        v += (target - v) * coef;
        if (stage == 1 && (rising ? v >= goal : v <= goal)) { v = goal; return true; }
        return false;
    }
};

/* ---- int16 / float storage for delay memory ----------------------------- */

template <typename S> struct Store;
template <> struct Store<float> {
    static inline float load(float x) { return x; }
    static inline float save(float x) { return x; }
};
template <> struct Store<int16_t> { /* Q14: headroom to +-2.0 */
    static inline float load(int16_t x) { return (float)x * (1.0f / 16384.0f); }
    static inline int16_t save(float x)
    {
        x *= 16384.0f;
        x = x > 32767.0f ? 32767.0f : (x < -32768.0f ? -32768.0f : x);
        return (int16_t)(int)x;
    }
};

/* ======================================================================== */
/* CS-80 tremolo/chorus (OE2 board model)                                    */
/* ======================================================================== */
/*
 * One mono input (the CS-80 is mono up to here) becomes a stereo pair:
 *  - a BBD-style delay, modulated in antiphase for L and R (doppler),
 *    band-limited and lightly saturated like a bucket brigade;
 *  - a pair of VCAs driven in antiphase (the "volume" part).
 * Chorus and tremolo are the same circuit at two LFO speed ranges; both can
 * be on, as on the Arturia model. A 'side' input carries the optional
 * I/II pan spread around the effect untouched.
 */
constexpr int CHORUS_LEN = 1024; /* 21 ms at 48 kHz, power of 2 */

struct ChorusParams {
    bool chorus_on, trem_on;
    float chorus_hz, chorus_depth; /* 0.4..5 Hz, 0..1 */
    float trem_hz, trem_depth;     /* 1.2..16 Hz, 0..1 */
};

struct Chorus {
    float buf[CHORUS_LEN];
    uint32_t w;
    float cph, tph;
    float dl, dr, gl, gr, lp_l, lp_r;
    float ddl, ddr, dgl, dgr;   /* per-sample ramps for this tick */
    float wet, dry, lp_k;

    void init() { memset(this, 0, sizeof *this); w = CHORUS_LEN; dl = dr = 240.0f; gl = gr = 1.0f; }

    /* once per tick */
    void tick(ChorusParams const& p, float sr)
    {
        float const rate = sr / CTRL;
        cph = wrap1(cph + p.chorus_hz / rate);
        tph = wrap1(tph + p.trem_hz / rate);
        float const lc = sin_par(cph), lt = sin_par(tph);
        /* delay in samples: 5 ms centre, chorus +-3 ms, tremolo +-0.6 ms */
        float const cd = p.chorus_on ? p.chorus_depth * 0.003f * sr * lc : 0.0f;
        float const td = p.trem_on ? p.trem_depth * 0.0006f * sr * lt : 0.0f;
        float const base = 0.005f * sr;
        float const tdl = base + cd + td, tdr = base - cd - td;
        /* VCAs: tremolo up to +-0.5, chorus adds a faint +-0.08 swell */
        float const am = (p.trem_on ? 0.5f * p.trem_depth * lt : 0.0f) + (p.chorus_on ? 0.08f * p.chorus_depth * lc : 0.0f);
        float const tgl = 1.0f + am, tgr = 1.0f - am;
        ddl = (tdl - dl) * (1.0f / CTRL); ddr = (tdr - dr) * (1.0f / CTRL);
        dgl = (tgl - gl) * (1.0f / CTRL); dgr = (tgr - gr) * (1.0f / CTRL);
        bool const any = p.chorus_on || p.trem_on;
        wet = any ? 0.62f : 0.0f;
        dry = any ? 0.78f : 1.0f;
        lp_k = 1.0f - expf(-6.2831853f * 7000.0f / sr); /* BBD reconstruction filter, about 7 kHz */
    }

    /* per sample: mid -> L/R, side added L, subtracted R */
    CS80_NOINLINE inline CS80_IRAM void process(float const* mid, float const* side, float* out_l, float* out_r);
};

void Chorus::process(float const* mid, float const* side, float* out_l, float* out_r)
{
    uint32_t wp = w;
    float l = dl, r = dr, a = gl, b = gr, fl = lp_l, fr = lp_r;
    float const k = lp_k, we = wet, dr_ = dry;
    for (int i = 0; i != CTRL; ++i) {
        float const x = mid[i];
        buf[wp & (CHORUS_LEN - 1)] = x - 0.08f * x * x * x; /* BBD input stage saturation */
        float const pl = (float)wp - l, pr = (float)wp - r;
        int const il = (int)pl, ir = (int)pr; /* pl, pr > 0 is ensured by wp >= CHORUS_LEN at start-up */
        float const tl = pl - (float)il, tr = pr - (float)ir;
        float const a0 = buf[il & (CHORUS_LEN - 1)], a1 = buf[(il + 1) & (CHORUS_LEN - 1)];
        float const b0 = buf[ir & (CHORUS_LEN - 1)], b1 = buf[(ir + 1) & (CHORUS_LEN - 1)];
        fl += k * (a0 + tl * (a1 - a0) - fl);
        fr += k * (b0 + tr * (b1 - b0) - fr);
        float const s = side[i];
        out_l[i] = (dr_ * x + we * fl) * a + s;
        out_r[i] = (dr_ * x + we * fr) * b - s;
        wp = wp + 1;
        l += ddl; r += ddr; a += dgl; b += dgr;
    }
    /* keep wp in [CHORUS_LEN, 2*CHORUS_LEN) so wp - delay never goes negative */
    w = (wp & (CHORUS_LEN - 1)) + CHORUS_LEN;
    dl = l; dr = r; gl = a; gr = b; lp_l = fl; lp_r = fr;
}

/* ======================================================================== */
/* Echo, approach (a): stereo ping-pong delay line, int16 in PSRAM           */
/* ======================================================================== */
constexpr int ECHO_LEN = 65536; /* 1.37 s at 48 kHz per side */
CS80_PSRAM inline int16_t g_echo_l[ECHO_LEN];
CS80_PSRAM inline int16_t g_echo_r[ECHO_LEN];

/* log2 for the limiter's gain computer: exponent bits plus a quadratic on the
   mantissa, |err| < 0.005 (0.03 dB) */
static inline float fast_log2(float x)
{
    union { float f; int32_t i; } u;
    u.f = x;
    float const e = (float)(((u.i >> 23) & 255) - 128);
    u.i = (u.i & 0x007FFFFF) | 0x3F800000;
    return e + (-0.34484843f * u.f + 2.02466578f) * u.f - 0.67487759f;
}

/* Output stage, after the effects: a stereo-linked look-ahead peak limiter,
   ceiling -1 dBFS, then a tanh-shaped safety clip that only a missed peak
   reaches.
     - gain computer: soft knee 4 dB wide around the ceiling (gain reduction
       starts near -3 dBFS and is ratio infinity above the ceiling), on the louder
       of the two channels;
     - look-ahead: the audio is delayed D - 1 samples (D = 1.5 ms, 72 at
       48 kHz). The gain is the minimum of the computer's gain over the last D
       samples, averaged over D samples, so every peak is met by a smooth
       1.5 ms ramp that has already reached it, instead of a jump;
     - program-dependent release: a fast follower (50 ms) and a slow one
       (attack 100 ms, release 700 ms), and the lower of the two applies. A
       lone transient barely moves the slow follower and recovers in about
       50 ms; sustained limiting drags it down, so the gain stays steady
       instead of pumping on every waveform peak and recovers gently;
     - safety clip: linear up to -0.5 dBFS, then tanh up to 0 dBFS. The
       limiter aims at -1.05 dBFS, so the 0.03 dB error of the log approximation
       still leaves its output under -1 dBFS and the clip is a last resort only.
   With quiet input and no limiting in the last D samples the stage only
   delays the audio. g is the gain applied last, gmin and peak_in are meters
   (lowest gain and highest input since the host last reset them). */
struct OutLimiter {
    static constexpr float CEIL_DB = -1.05f;    /* aimed 0.05 dB under -1 dBFS: the log approximation's margin */
    static constexpr float KNEE_DB = 4.0f;
    static constexpr float KNEE_LO = 0.703882f; /* -3.05 dBFS = CEIL_DB - KNEE_DB / 2 */
    static constexpr float SAFE = 0.944061f;    /* -0.5 dBFS: the safety clip starts here */
    static constexpr int DMAX = 128;            /* ring size (power of 2) */
    float dl[DMAX], dr[DMAX], box[DMAX], dq_v[DMAX];
    uint32_t dq_i[DMAX];
    uint32_t n, since;
    int D, pos, dq_h, dq_c;
    float sum, inv_d, gf, gs, kf, ksa, ksr;
    float g, gmin, peak_in;
    bool bypass;

    void init(float sr, int)
    {
        int d = (int)(0.0015f * sr + 0.5f);
        D = d < 8 ? 8 : (d > 96 ? 96 : d);
        inv_d = 1.0f / (float)D;
        kf = 1.0f - expf(-1.0f / (0.05f * sr));
        ksa = 1.0f - expf(-1.0f / (0.10f * sr));
        ksr = 1.0f - expf(-1.0f / (0.70f * sr));
        for (int i = 0; i != DMAX; ++i) { dl[i] = dr[i] = 0.0f; box[i] = 1.0f; }
        n = 0; since = (uint32_t)D; pos = 0; dq_h = dq_c = 0;
        sum = (float)D; gf = gs = g = gmin = 1.0f; peak_in = 0.0f;
        bypass = false;
    }
    int latency() const { return D - 1; }

    /* gain that brings a peak of a (linear) to the knee curve */
    static inline float computer(float a)
    {
        float const x = 6.0206f * fast_log2(a) - CEIL_DB; /* dB over the ceiling */
        float const gr = x >= 0.5f * KNEE_DB ? x : (x + 0.5f * KNEE_DB) * (x + 0.5f * KNEE_DB) * (0.5f / KNEE_DB);
        return fast_exp2(gr * -0.1660964f);
    }
    static inline float safety(float x)
    {
        float const a = fabsf(x);
        if (a <= SAFE) return x;
        float const u = (a - SAFE) * (1.0f / (1.0f - SAFE));
        float const t = u >= 3.0f ? 1.0f : u * (27.0f + u * u) / (27.0f + 9.0f * u * u); /* tanh, Pade */
        return copysignf(SAFE + (1.0f - SAFE) * t, x);
    }

    template <int N> CS80_IRAM void process(float* l, float* r)
    {
        if (bypass) return;
        float p = 0.0f;
        for (int i = 0; i != N; ++i) { float const a = fabsf(l[i]), b = fabsf(r[i]); p = a > p ? a : p; p = b > p ? b : p; }
        peak_in = p > peak_in ? p : peak_in;
        int const mask = DMAX - 1, lag = D - 1;
        if (p <= KNEE_LO && dq_c == 0 && since >= (uint32_t)D && gf == 1.0f && gs == 1.0f) {
            /* idle: nothing to limit in this block or the look-ahead window, just the delay */
            for (int i = 0; i != N; ++i) {
                int const w = (int)(n + i) & mask, rd = (int)(n + i - lag) & mask;
                dl[w] = l[i]; dr[w] = r[i];
                l[i] = dl[rd]; r[i] = dr[rd];
            }
            n += N;
            return;
        }
        float gm = gmin;
        for (int i = 0; i != N; ++i, ++n) {
            float const xl = l[i], xr = r[i];
            float const a = fabsf(xl) > fabsf(xr) ? fabsf(xl) : fabsf(xr);
            /* running minimum of the computer's gain over the last D samples (monotonic queue;
               a gain of 1 never becomes the minimum, so it is not queued) */
            while (dq_c && dq_i[dq_h] + (uint32_t)D <= n) { dq_h = (dq_h + 1) & mask; --dq_c; }
            if (a > KNEE_LO) {
                float const t = computer(a);
                if (t < 1.0f) {
                    while (dq_c && dq_v[(dq_h + dq_c - 1) & mask] >= t) --dq_c;
                    int const k = (dq_h + dq_c) & mask;
                    dq_v[k] = t; dq_i[k] = n; ++dq_c;
                }
            }
            float const h = dq_c ? dq_v[dq_h] : 1.0f;
            /* D-sample average of the held minimum: a ramp that reaches each peak's gain by the
               time the delayed peak comes out */
            sum += h - box[pos];
            box[pos] = h;
            if (++pos == D) {
                pos = 0;
                float s = 0.0f;
                for (int j = 0; j != D; ++j) s += box[j]; /* re-sum once per window against drift */
                sum = s;
            }
            since = h < 1.0f ? 0 : since + 1;
            float b = sum * inv_d;
            b = b > 1.0f ? 1.0f : b;
            gf = b < gf ? b : gf + (b - gf) * kf;
            gs += (b - gs) * (b < gs ? ksa : ksr);
            if (gf > 0.99999f) gf = 1.0f;
            if (gs > 0.9999f && since >= (uint32_t)D) gs = 1.0f;
            float const gg = gf < gs ? gf : gs;
            gm = gg < gm ? gg : gm;
            int const w = (int)n & mask, rd = (int)(n - lag) & mask;
            dl[w] = xl; dr[w] = xr;
            l[i] = safety(dl[rd] * gg);
            r[i] = safety(dr[rd] * gg);
            g = gg;
        }
        gmin = gm;
    }
};

struct EchoLine {
    uint32_t pos;
    int32_t dsamp;
    float fb, damp_k, lp_l, lp_r;

    void init() { pos = 0; dsamp = 1000; fb = 0; damp_k = 1; lp_l = lp_r = 0; memset(g_echo_l, 0, sizeof g_echo_l); memset(g_echo_r, 0, sizeof g_echo_r); }
    void set(float seconds, float feedback, float damp_hz, float sr)
    {
        int d = (int)(seconds * sr);
        dsamp = d < 1 ? 1 : (d > ECHO_LEN - 1 ? ECHO_LEN - 1 : d);
        fb = feedback;
        damp_k = 1.0f - expf(-6.2831853f * damp_hz / sr);
    }
    /* adds wet * echo to out_l/out_r; input is the stereo dry signal */
    CS80_NOINLINE inline CS80_IRAM void process(float const* in_l, float const* in_r, float* out_l, float* out_r, float wet);
};

void EchoLine::process(float const* in_l, float const* in_r, float* out_l, float* out_r, float wet)
{
    typedef Store<int16_t> S;
    uint32_t p = pos;
    uint32_t const d = (uint32_t)dsamp;
    float a = lp_l, b = lp_r;
    float const k = damp_k, g = fb;
    for (int i = 0; i != CTRL; ++i) {
        uint32_t const rp = (p - d) & (ECHO_LEN - 1);
        float const yl = S::load(g_echo_l[rp]), yr = S::load(g_echo_r[rp]);
        a += k * (yl - a);
        b += k * (yr - b);
        float const x = 0.5f * (in_l[i] + in_r[i]);
        g_echo_l[p] = S::save(x + g * b); /* ping-pong: L feeds R feeds L */
        g_echo_r[p] = S::save(g * a);
        out_l[i] += wet * yl;
        out_r[i] += wet * yr;
        p = (p + 1) & (ECHO_LEN - 1);
    }
    pos = p; lp_l = a; lp_r = b;
}

/* ======================================================================== */
/* Reverb: Dattorro plate (J. Dattorro, "Effect Design Part 1", JAES 1997)   */
/* ======================================================================== */
/*
 * Template on storage type (float or Q14 int16) and on decimation (1 = full
 * rate, 2 = run the tank at sr/2 with a 2-tap average in and linear
 * interpolation out). Lengths are the paper's, scaled from 29761 Hz.
 */
struct PlateParams { float decay, damp, bandwidth, predelay_s; };

template <typename S> struct DLine {
    S* b;
    int n, w;
    void init(S* mem, int len) { b = mem; n = len; w = 0; memset(mem, 0, sizeof(S) * len); }
    inline float tap(int d) const { int i = w - d; if (i < 0) i += n; return Store<S>::load(b[i]); }
    inline float oldest() const { return Store<S>::load(b[w]); }
    inline void push(float x) { b[w] = Store<S>::save(x); if (++w == n) w = 0; }
    /* pure delay of n samples */
    inline float delay(float x) { float const y = oldest(); push(x); return y; }
    /* Schroeder allpass, delay n, gain g */
    inline float allpass(float x, float g) { float const z = oldest(); float const v = x + g * z; push(v); return z - g * v; }
    /* allpass with a modulated fractional delay d (< n - 1) */
    inline float allpass_mod(float x, float g, float d)
    {
        int const id = (int)d;
        float const f = d - (float)id;
        float const z0 = tap(id), z1 = tap(id + 1);
        float const z = z0 + f * (z1 - z0);
        float const v = x + g * z;
        push(v);
        return z - g * v;
    }
};

constexpr int PLATE_EXC = 16; /* modulation excursion at 29761 Hz, as in the paper */
constexpr int plate_len(int len29761, int sr) { return (int)((long long)len29761 * sr / 29761) + 2; }
constexpr int PLATE_TOTAL_48K =
    plate_len(142, 48000) + plate_len(107, 48000) + plate_len(379, 48000) + plate_len(277, 48000)
    + plate_len(672 + 2 * PLATE_EXC, 48000) + plate_len(4453, 48000) + plate_len(1800, 48000) + plate_len(3720, 48000)
    + plate_len(908 + 2 * PLATE_EXC, 48000) + plate_len(4217, 48000) + plate_len(2656, 48000) + plate_len(3163, 48000)
    + 48000 / 10; /* up to 100 ms predelay */

template <typename S, int D> struct PlateMem { static S mem[PLATE_TOTAL_48K / D + 64]; };
template <typename S, int D> S PlateMem<S, D>::mem[PLATE_TOTAL_48K / D + 64];

template <typename S, int DECIM> struct Plate {
    DLine<S> pre, in1, in2, in3, in4, apl1, dl1, apl2, dl2, apr1, dr1, apr2, dr2;
    float bw_state, damp_l, damp_r, fb_l, fb_r;
    float decay, damp, bw;
    float lfo_ph, lfo_inc, exc, base_l, base_r;
    float last_l, last_r, dc_x, dc_y;
    int sr_eff, predelay;
    int t_dl1[3], t_dl2[2], t_apl2[2], t_dr1[3], t_dr2[2], t_apr2[2]; /* output taps */

    int bytes() const { return used * (int)sizeof(S); }
    int used;

    void init(int sr)
    {
        sr_eff = sr / DECIM;
        S* m = PlateMem<S, DECIM>::mem;
        int off = 0;
        auto mk = [&](DLine<S>& d, int len29) { int const n = plate_len(len29, sr_eff); d.init(m + off, n); off += n; };
        pre.init(m, sr_eff / 10); off = sr_eff / 10;
        mk(in1, 142); mk(in2, 107); mk(in3, 379); mk(in4, 277);
        mk(apl1, 672 + 2 * PLATE_EXC); mk(dl1, 4453); mk(apl2, 1800); mk(dl2, 3720);
        mk(apr1, 908 + 2 * PLATE_EXC); mk(dr1, 4217); mk(apr2, 2656); mk(dr2, 3163);
        used = off;
        auto sc = [&](int t) { return (int)((long long)t * sr_eff / 29761); };
        t_dr1[0] = sc(266); t_dr1[1] = sc(2974); t_dr1[2] = sc(2111);
        t_apr2[0] = sc(1913); t_apr2[1] = sc(335);
        t_dr2[0] = sc(1996); t_dr2[1] = sc(121);
        t_dl1[0] = sc(1990); t_dl1[1] = sc(353); t_dl1[2] = sc(3627);
        t_apl2[0] = sc(187); t_apl2[1] = sc(1228);
        t_dl2[0] = sc(1066); t_dl2[1] = sc(2673);
        base_l = (float)sc(672); base_r = (float)sc(908);
        exc = (float)sc(PLATE_EXC);
        lfo_inc = 1.0f / sr_eff; /* 1 Hz, advanced per tick below */
        bw_state = damp_l = damp_r = fb_l = fb_r = last_l = last_r = dc_x = dc_y = 0.0f;
        lfo_ph = 0.0f;
        set({0.5f, 0.0005f, 0.9995f, 0.02f});
    }
    void set(PlateParams const& p)
    {
        decay = p.decay; damp = p.damp; bw = p.bandwidth;
        int pd = (int)(p.predelay_s * sr_eff);
        predelay = pd < 1 ? 1 : (pd > pre.n - 1 ? pre.n - 1 : pd);
    }
    /* mono in, adds wet * stereo out */
    CS80_NOINLINE CS80_IRAM void process(float const* in, float* out_l, float* out_r, float wet);

  private:
    inline void step(float x, float m1, float m2, float& yl, float& yr)
    {
        dc_y = x - dc_x + 0.995f * dc_y; /* DC blocker: the tank has gain at 0 Hz */
        dc_x = x;
        pre.push(dc_y);
        float const xd = pre.tap(predelay);
        bw_state += bw * (xd - bw_state);
        float t = in1.allpass(bw_state, 0.75f);
        t = in2.allpass(t, 0.75f);
        t = in3.allpass(t, 0.625f);
        t = in4.allpass(t, 0.625f);
        /* left half of the tank */
        float a = apl1.allpass_mod(t + fb_r, -0.70f, m1);
        a = dl1.delay(a);
        damp_l += (1.0f - damp) * (a - damp_l);
        a = apl2.allpass(damp_l * decay, 0.50f);
        float const el = dl2.delay(a);
        /* right half */
        float b = apr1.allpass_mod(t + fb_l, -0.70f, m2);
        b = dr1.delay(b);
        damp_r += (1.0f - damp) * (b - damp_r);
        b = apr2.allpass(damp_r * decay, 0.50f);
        float const er = dr2.delay(b);
        fb_l = el * decay;
        fb_r = er * decay;
        yl = 0.6f * (dr1.tap(t_dr1[0]) + dr1.tap(t_dr1[1]) - apr2.tap(t_apr2[0]) + dr2.tap(t_dr2[0])
                     - dl1.tap(t_dl1[0]) - apl2.tap(t_apl2[0]) - dl2.tap(t_dl2[0]));
        yr = 0.6f * (dl1.tap(t_dl1[1]) + dl1.tap(t_dl1[2]) - apl2.tap(t_apl2[1]) + dl2.tap(t_dl2[1])
                     - dr1.tap(t_dr1[2]) - apr2.tap(t_apr2[1]) - dr2.tap(t_dr2[1]));
    }
};

template <typename S, int DECIM>
void Plate<S, DECIM>::process(float const* in, float* out_l, float* out_r, float wet)
{
    /* the tank LFO moves at control rate; the fractional delay is per sample */
    lfo_ph = wrap1(lfo_ph + lfo_inc * (CTRL / DECIM));
    float const s = sin_par(lfo_ph);
    float const m1 = base_l + exc * (1.0f + s), m2 = base_r + exc * (1.0f - s);
    if (DECIM == 1) {
        for (int i = 0; i != CTRL; ++i) {
            float yl, yr;
            step(in[i], m1, m2, yl, yr);
            out_l[i] += wet * yl;
            out_r[i] += wet * yr;
        }
    } else {
        float pl = last_l, pr = last_r;
        for (int i = 0; i != CTRL; i += 2) {
            float yl, yr;
            step(0.5f * (in[i] + in[i + 1]), m1, m2, yl, yr);
            out_l[i] += wet * 0.5f * (pl + yl);
            out_r[i] += wet * 0.5f * (pr + yr);
            out_l[i + 1] += wet * yl;
            out_r[i + 1] += wet * yr;
            pl = yl; pr = yr;
        }
        last_l = pl; last_r = pr;
    }
}

}  // namespace cs80v2
