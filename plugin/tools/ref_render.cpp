/* Reference render through the web wrapper (web/src/cs80_wasm.cpp) built
   natively: ref_render <preset.txt> <score.txt> <seconds> <out.f32>.
   preset.txt: "core N", or "blob" then "field value" lines over patch_init.
   48 kHz, 128-frame blocks, events before each block, like wasm.mjs. Output:
   interleaved float32 L R. */
#include <stdlib.h>
#include <string>
#include <map>

#include "../../web/src/cs80_wasm.cpp"
#include "score.h"

static int field_index(char const* name)
{
    for (int i = 0; i != NFIELDS; ++i) if (!strcmp(FIELDS[i].name, name)) return i;
    return -1;
}

int main(int argc, char** argv)
{
    if (argc < 5) { fprintf(stderr, "usage: ref_render preset.txt score.txt seconds out.f32\n"); return 2; }
    if (!cs80_init(48000.0f)) return 3;
    FILE* pf = fopen(argv[1], "r");
    if (!pf) return 4;
    char kind[16];
    int core = 0;
    if (fscanf(pf, "%15s", kind) != 1) return 5;
    if (!strcmp(kind, "core")) { if (fscanf(pf, "%d", &core) != 1) return 5; cs80_load_preset(core); }
    else {
        char name[64]; float v; int n = 0;
        while (fscanf(pf, "%63s %f", name, &v) == 2) {
            int const i = field_index(name);
            if (i < 0) { fprintf(stderr, "unknown field %s\n", name); return 6; }
            blob[2 * n] = (float)i; blob[2 * n + 1] = v; ++n;
        }
        cs80_load_blob(n, 1);
    }
    fclose(pf);
    auto score = load_score(argv[2]);
    int const blocks = (int)(atof(argv[3]) * 48000 / 128);
    FILE* out = fopen(argv[4], "wb");
    size_t si = 0;
    static float l[128], r[128];
    for (int b = 0; b != blocks; ++b) {
        for (; si < score.size() && score[si].block <= b; ++si) {
            ScoreEv const& e = score[si];
            if (!strcmp(e.kind, "on")) cs80_note_on(e.a, e.b);
            else if (!strcmp(e.kind, "off")) cs80_note_off(e.a);
            else if (!strcmp(e.kind, "bend")) cs80_pitch_bend(e.a);
            else if (!strcmp(e.kind, "cc")) cs80_cc(e.a, e.b);
            else if (!strcmp(e.kind, "cp")) cs80_channel_pressure(e.a);
            else if (!strcmp(e.kind, "pp")) cs80_poly_pressure(e.a, e.b);
        }
        cs80_render(l, r, 128);
        for (int i = 0; i != 128; ++i) { fwrite(l + i, 4, 1, out); fwrite(r + i, 4, 1, out); }
    }
    fclose(out);
    return 0;
}
