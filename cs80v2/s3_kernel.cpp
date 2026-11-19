/* ESP32-S3 compile target for instruction counting (not a full firmware).
   Big buffers would carry EXT_RAM_BSS_ATTR in an ESP-IDF build. */
#include "cs80v2.hpp"
#include "presets.hpp"

using namespace cs80v2;
Engine engine;
float out_l[128], out_r[128];
Plate<float, 1> plate_f1;
Plate<int16_t, 1> plate_i1;
Plate<float, 2> plate_f2;
float in[CTRL];

extern "C" void cs80_init(void) { engine.init(48000.0f, blade_runner_brass()); plate_f1.init(48000); plate_i1.init(48000); plate_f2.init(48000); }
extern "C" void cs80_render_block(void) { engine.process(out_l, out_r, 128); }
extern "C" void cs80_note_on(int n, int v) { engine.note_on(n, v); }
extern "C" void plates(void) { plate_f1.process(in, out_l, out_r, 0.3f); plate_i1.process(in, out_l, out_r, 0.3f); plate_f2.process(in, out_l, out_r, 0.3f); }
/* output limiter alone, for counting: one 32-sample stereo block */
OutLimiter lim;
extern "C" void lim_block(void) { lim.process<CTRL>(out_l, out_r); }
