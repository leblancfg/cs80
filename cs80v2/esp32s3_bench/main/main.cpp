/*
 * First hardware step for cs80v2: measure it on a real ESP32-S3 (N8R8 board).
 * ESP-IDF app: idf.py create-project, drop this in main/, add ../.. to the
 * include path, enable PSRAM (CONFIG_SPIRAM, "Allow .bss in PSRAM").
 * Not built here: no ESP-IDF on fl1.
 *
 * Prints cycles per 128-sample block for each configuration with all audio
 * code in IRAM. 48 kHz budget: 240e6 * 128 / 48000 = 640000 cycles per
 * block per core. The dual-core split (voices 0-3 on core 1, 4-7 plus
 * effects on core 0) is a second step: call Engine::render_voices() from
 * two tasks and join on a semaphore per 32-sample tick.
 */
#include <stdio.h>
#include "esp_attr.h"
#include "esp_cpu.h"

#define CS80_IRAM IRAM_ATTR
#define CS80_PSRAM EXT_RAM_BSS_ATTR
#include "cs80v2.hpp"
#include "presets.hpp"

using namespace cs80v2;
static DRAM_ATTR Engine engine;
static DRAM_ATTR float out_l[128], out_r[128];

static void run(char const* name, Patch p, int nv)
{
    p.ch[0].s = p.ch[1].s = 1.0f;
    engine.init(48000.0f, p);
    for (int v = 0; v != nv; ++v) engine.note_on(48 + 3 * v, 100);
    for (int b = 0; b != 400; ++b) engine.process(out_l, out_r, 128);
    uint32_t worst = 0;
    uint64_t total = 0;
    int const blocks = 3750; /* 10 s */
    for (int b = 0; b != blocks; ++b) {
        uint32_t const t0 = esp_cpu_get_cycle_count();
        engine.process(out_l, out_r, 128);
        uint32_t const dt = esp_cpu_get_cycle_count() - t0;
        total += dt;
        if (dt > worst) worst = dt;
    }
    printf("%-28s voices=%d avg_cycles_per_block=%llu worst=%lu load_one_core=%.1f%%\n", name, nv,
           total / blocks, (unsigned long)worst, 100.0 * (total / blocks) / 640000.0);
}

extern "C" void app_main(void)
{
    Patch dry = blade_runner_brass();
    dry.perf.chorus.chorus_on = false; dry.fx.echo_mode = ECHO_OFF; dry.fx.reverb_mix = 0;
    for (int nv : {0, 1, 4, 8}) run("dry", dry, nv);
    Patch ch = dry; ch.perf.chorus.chorus_on = true;
    run("chorus", ch, 8);
    Patch el = ch; el.fx.echo_mode = ECHO_LINE;
    run("chorus+echo_line(PSRAM)", el, 8);
    Patch all = el; all.fx.reverb_mix = 0.3f; all.perf.ring_mod = 0.3f;
    run("chorus+echo+plate+ring", all, 8);
    Patch ev = ch; ev.fx.echo_mode = ECHO_VOICES_MODE; ev.fx.echo_taps = 1; ev.fx.echo_time = 0.05f;
    run("chorus+echo_voices x1", ev, 8);
}
