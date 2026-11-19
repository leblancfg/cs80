/*
 * cs80v2 host harness.
 *
 *   cs80v2 render <preset> in.mid out.wav|- [echo_mode]   render a MIDI file at 48 kHz
 *   cs80v2 bench [seconds]                                component timings
 *   cs80v2 clock                                          effective CPU GHz
 *   cs80v2 sizes                                          RAM map
 *
 * Events are applied on 32-sample boundaries (0.67 ms), as the MCU would.
 */
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "../cs80lite/smf.hpp"
#include "midimap.hpp"
#include "presets.hpp"

using namespace cs80v2;
using clk = std::chrono::steady_clock;

static Engine engine; /* static, no heap, like on the MCU */

static double measure_ghz()
{
    volatile uint64_t seed = 1;
    uint64_t x = seed;
    long const n = 400000000;
    auto t0 = clk::now();
    for (long i = 0; i != n; ++i) __asm__ volatile("add $1, %0" : "+r"(x));
    auto t1 = clk::now();
    seed = x;
    return n / std::chrono::duration<double>(t1 - t0).count() / 1e9;
}

static void write_wav(char const* path, std::vector<int16_t> const& pcm, int rate)
{
    FILE* f = fopen(path, "wb");
    uint32_t data = pcm.size() * 2, riff = 36 + data, fmt = 16, sr = rate, br = rate * 4;
    uint16_t tag = 1, ch = 2, align = 4, bits = 16;
    fwrite("RIFF", 1, 4, f); fwrite(&riff, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f);
    fwrite(&fmt, 4, 1, f); fwrite(&tag, 2, 1, f); fwrite(&ch, 2, 1, f);
    fwrite(&sr, 4, 1, f); fwrite(&br, 4, 1, f); fwrite(&align, 2, 1, f); fwrite(&bits, 2, 1, f);
    fwrite("data", 1, 4, f); fwrite(&data, 4, 1, f);
    fwrite(pcm.data(), 2, pcm.size(), f);
    fclose(f);
}

static int find_preset(char const* s)
{
    if (s[0] >= '0' && s[0] <= '9') return atoi(s);
    for (int i = 0; i != preset_count(); ++i)
        if (strcasestr(preset(i).name, s)) return i;
    return -1;
}

static void midi(Engine& e, Ev const& ev)
{
    switch (ev.st & 0xf0) {
        case 0x90: e.note_on(ev.d1, ev.d2); break;
        case 0x80: e.note_off(ev.d1); break;
        case 0xa0: e.poly_pressure(ev.d1, ev.d2); break;
        case 0xb0: e.control_change(ev.d1, ev.d2); break;
        case 0xd0: e.channel_pressure(ev.d1); break;
        case 0xe0: e.pitch_bend(ev.d1 | (ev.d2 << 7)); break;
    }
}

static int render(int argc, char** argv)
{
    int const pi = find_preset(argv[2]);
    if (pi < 0) { fprintf(stderr, "unknown preset\n"); return 2; }
    Patch p = preset(pi);
    if (argc > 5) p.fx.echo_mode = (uint8_t)atoi(argv[5]);
    /* bisection switches */
    if (getenv("NOREV")) p.fx.reverb_mix = 0;
    if (getenv("NOECHO")) p.fx.echo_mode = ECHO_OFF;
    if (getenv("NOCHORUS")) p.perf.chorus.chorus_on = p.perf.chorus.trem_on = false;
    if (getenv("NORING")) p.perf.ring_mod = 0;
    if (getenv("NOSINE")) p.ch[0].sine_level = p.ch[1].sine_level = 0;
    int const rate = 48000;
    std::vector<Ev> evs;
    double end_s;
    if (!read_smf(argv[3], evs, end_s)) return 3;
    end_s += 4.0; /* release, echo and reverb tails */
    engine.init(rate, p);
    size_t const ticks = (size_t)(end_s * rate / CTRL) + 1;
    std::vector<int16_t> pcm;
    pcm.reserve(ticks * CTRL * 2);
    float l[CTRL], r[CTRL];
    size_t ei = 0;
    double vsum = 0, esum = 0, peak = 0, ss = 0;
    long clipped = 0;
    int vmax = 0, emax = 0;
    auto t0 = clk::now();
    for (size_t b = 0; b != ticks; ++b) {
        double const t_end = (double)((b + 1) * CTRL) / rate;
        for (; ei < evs.size() && evs[ei].t < t_end; ++ei) midi(engine, evs[ei]);
        engine.process(l, r, CTRL);
        int const av = engine.active_voices(), ae = engine.active_echo_voices();
        vsum += av; esum += ae;
        vmax = std::max(vmax, av); emax = std::max(emax, ae);
        for (int i = 0; i != CTRL; ++i) {
            double const a = std::max(fabsf(l[i]), fabsf(r[i]));
            peak = std::max(peak, a);
            clipped += a > 1.0;
            ss += 0.5 * (l[i] * l[i] + r[i] * r[i]);
            pcm.push_back((int16_t)(std::max(-1.0f, std::min(1.0f, l[i])) * 32767));
            pcm.push_back((int16_t)(std::max(-1.0f, std::min(1.0f, r[i])) * 32767));
        }
    }
    double const wall = std::chrono::duration<double>(clk::now() - t0).count();
    double const audio = (double)ticks * CTRL / rate;
    if (std::string(argv[4]) != "-") write_wav(argv[4], pcm, rate);
    printf("render preset=\"%s\" echo_mode=%d audio_s=%.2f wall_s=%.4f realtime_x=%.1f avg_voices=%.2f max_voices=%d "
           "avg_echo_voices=%.2f max_echo_voices=%d peak=%.3f rms_dbfs=%.1f clipped=%ld\n",
           p.name, p.fx.echo_mode, audio, wall, audio / wall, vsum / ticks, vmax, esum / ticks, emax, peak,
           10 * log10(ss / (ticks * CTRL) + 1e-20), clipped);
    return 0;
}

/* ---- benchmarks ----------------------------------------------------------- */

template <typename F> static double best_ns_per_sample(F&& f, double secs, int reps = 3)
{
    size_t const ticks = (size_t)(secs * 48000 / CTRL);
    double best = 1e30;
    for (int r = 0; r != reps; ++r) {
        auto t0 = clk::now();
        for (size_t b = 0; b != ticks; ++b) f();
        double const w = std::chrono::duration<double>(clk::now() - t0).count();
        best = std::min(best, w * 1e9 / (ticks * CTRL));
    }
    return best;
}

static Patch bench_patch(bool chorus, uint8_t echo, int taps, float reverb)
{
    Patch p = blade_runner_brass();
    p.ch[0].s = p.ch[1].s = 1.0f; /* held notes never decay away */
    p.perf.chorus.chorus_on = chorus;
    p.perf.chorus.trem_on = false;
    p.fx.echo_mode = echo;
    p.fx.echo_taps = (uint8_t)taps;
    p.fx.echo_fb = 0.6f;
    p.fx.echo_time = 0.05f;
    p.fx.reverb_mix = reverb;
    return p;
}

static float sinkf;

static int bench(double secs)
{
    /* The add-chain probe reads 1.2-1.3 GHz on fl1 today while cs80lite's
       stress test reproduces its 2.27 GHz-era wall times within 4 %, so
       cycles are reported at the 2.27 GHz calibration (override: GHZ env). */
    double const probe = measure_ghz();
    double const ghz = getenv("GHZ") ? atof(getenv("GHZ")) : 2.27;
    printf("probe_ghz=%.3f using_ghz=%.3f\n", probe, ghz);
    float l[CTRL], r[CTRL];
    auto run = [&](char const* name, Patch const& p, int nv, double extra_s = 0.3) {
        engine.init(48000, p);
        for (int v = 0; v != nv; ++v) engine.note_on(48 + v * 3, 100);
        /* let echo voices start */
        for (int i = 0; i < (int)(extra_s * 48000 / CTRL); ++i) engine.process(l, r, CTRL);
        double const ns = best_ns_per_sample([&] { engine.process(l, r, CTRL); sinkf += l[3]; }, secs);
        printf("%-34s voices=%d echo_voices=%2d ns_per_sample=%8.2f cycles_per_sample=%7.1f\n", name,
               engine.active_voices(), engine.active_echo_voices(), ns, ns * ghz);
        return ns;
    };
    double const v0 = run("voices0_fxoff", bench_patch(false, ECHO_OFF, 0, 0), 0);
    run("voices1_fxoff", bench_patch(false, ECHO_OFF, 0, 0), 1);
    double const v8 = run("voices8_fxoff", bench_patch(false, ECHO_OFF, 0, 0), 8);
    double const c8 = run("voices8_chorus", bench_patch(true, ECHO_OFF, 0, 0), 8);
    double const e8 = run("voices8_chorus_echoline", bench_patch(true, ECHO_LINE, 0, 0), 8);
    double t8[4] = {0};
    for (int taps = 1; taps <= 3; ++taps) {
        char name[64];
        snprintf(name, sizeof name, "voices8_chorus_echovoices_taps%d", taps);
        t8[taps] = run(name, bench_patch(true, ECHO_VOICES_MODE, taps, 0), 8);
    }
    double const rv = run("voices8_chorus_echoline_reverb", bench_patch(true, ECHO_LINE, 0, 0.3f), 8);
    Patch ringp = bench_patch(true, ECHO_LINE, 0, 0.3f);
    ringp.perf.ring_mod = 0.5f;
    double const all8 = run("voices8_all_fx_ring", ringp, 8);
    Patch ring0 = bench_patch(false, ECHO_OFF, 0, 0);
    ring0.perf.ring_mod = 0.5f;
    double const r0 = run("voices0_ring_only", ring0, 0);
    printf("summary: ring_ns=%.2f all_fx_8voices_ns=%.2f cycles=%.1f\n", r0 - v0, all8, all8 * ghz);
    {
        engine.init(48000, bench_patch(false, ECHO_OFF, 0, 0));
        for (int v = 0; v != 8; ++v) engine.note_on(48 + v * 3, 100);
        double const ns = best_ns_per_sample([&] { engine.bench_control_tick(); }, secs) ;
        printf("%-34s ns_per_tick=%8.2f ns_per_voice_sample=%6.2f cycles_per_voice_sample=%6.1f\n", "control_tick_8voices",
               ns * CTRL, ns / 8.0, ns / 8.0 * ghz);
    }
    double const per_voice = (v8 - v0) / 8.0;
    printf("summary: per_voice_ns=%.2f per_voice_cycles=%.1f (2 channels) chorus_ns=%.2f echo_line_ns=%.2f "
           "reverb_plate_int16_half_ns=%.2f\n", per_voice, per_voice * ghz, c8 - v8, e8 - c8, rv - e8);
    for (int taps = 1; taps <= 3; ++taps)
        printf("summary: echo_voices taps=%d extra_ns=%.2f (=%.1f voice equivalents)\n", taps, t8[taps] - c8,
               (t8[taps] - c8) / per_voice);

    /* effects in isolation, on white noise */
    float in[CTRL], in2[CTRL];
    uint32_t rng = 1;
    for (auto& x : in) x = 0.3f * rnd_bip(rng);
    for (auto& x : in2) x = 0.1f * rnd_bip(rng);
    {
        static Chorus ch;
        ch.init();
        ChorusParams cp{true, true, 0.8f, 0.6f, 6.0f, 0.3f};
        double const ns = best_ns_per_sample([&] { ch.tick(cp, 48000); ch.process(in, in2, l, r); sinkf += l[7]; }, secs, 5);
        printf("%-34s ns_per_sample=%8.2f cycles_per_sample=%7.1f mem_bytes=%zu\n", "chorus_trem_isolated", ns, ns * ghz, sizeof ch.buf);
        static EchoLine el;
        el.init();
        el.set(0.47f, 0.4f, 3500, 48000);
        double const ne = best_ns_per_sample([&] { el.process(in, in2, l, r, 0.3f); sinkf += l[9]; }, secs, 5);
        printf("%-34s ns_per_sample=%8.2f cycles_per_sample=%7.1f mem_bytes=%zu\n", "echo_line_isolated", ne, ne * ghz,
               sizeof g_echo_l + sizeof g_echo_r);
    }
    auto rb = [&](char const* name, auto& pl) {
        pl.init(48000);
        pl.set({0.85f, 0.3f, 0.65f, 0.03f});
        double const ns = best_ns_per_sample([&] { pl.process(in, l, r, 0.3f); sinkf += l[5]; }, secs);
        printf("%-34s ns_per_sample=%8.2f cycles_per_sample=%7.1f mem_bytes=%d\n", name, ns, ns * ghz, pl.bytes());
    };
    static Plate<float, 1> pf1;
    static Plate<int16_t, 1> pi1;
    static Plate<float, 2> pf2;
    static Plate<int16_t, 2> pi2;
    rb("plate_float_full", pf1);
    rb("plate_int16_full", pi1);
    rb("plate_float_half", pf2);
    rb("plate_int16_half", pi2);
    printf("sink %g\n", (double)sinkf);
    return 0;
}

static int sizes()
{
    printf("sizeof(Engine)=%zu sizeof(Voice)=%zu sizeof(Line)=%zu voices=%d echo_voices=%d sizeof(events)=%zu\n",
           sizeof(Engine), sizeof(Voice), sizeof(Line), MAX_VOICES, ECHO_VOICES, sizeof(Event) * MAX_EVENTS);
    printf("chorus_buf=%zu echo_line_psram=%zu plate_int16_half=%zu plate_int16_full=%zu plate_float_full=%zu\n",
           sizeof(float) * CHORUS_LEN, sizeof(g_echo_l) + sizeof(g_echo_r),
           sizeof(PlateMem<int16_t, 2>::mem), sizeof(PlateMem<int16_t, 1>::mem), sizeof(PlateMem<float, 1>::mem));
    return 0;
}

int main(int argc, char** argv)
{
    if (argc < 2) return 1;
    std::string const mode = argv[1];
    if (mode == "clock") { printf("effective_ghz=%.3f\n", measure_ghz()); return 0; }
    if (mode == "render" && argc >= 5) return render(argc, argv);
    if (mode == "bench") return bench(argc > 2 ? atof(argv[2]) : 5.0);
    if (mode == "sizes") return sizes();
    if (mode == "presets") { for (int i = 0; i != preset_count(); ++i) printf("%d %s\n", i, preset(i).name); return 0; }
    return 1;
}
