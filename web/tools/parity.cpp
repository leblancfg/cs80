/* Native build of the same wrapper, rendering test_render.mjs's chord test
   (preset 0, C3 E3 G3 C4 at velocity 100 for 1.5 s, 2.5 s total) as raw
   interleaved float32 on stdout. */
#include <stdio.h>

#include "../src/cs80_wasm.cpp"

int main()
{
    cs80_init(48000.0f);
    cs80_load_preset(0);
    int const notes[4] = {48, 52, 55, 60};
    int const blocks = (int)(2.5 * 48000 / 128 + 0.999);
    bool off = false;
    for (int b = 0; b != blocks; ++b) {
        if (b == 0) for (int n : notes) cs80_note_on(n, 100);
        if (!off && b * 128 / 48000.0 >= 1.5) { for (int n : notes) cs80_note_off(n); off = true; }
        cs80_render_block();
        float const* l = cs80_out_l();
        float const* r = cs80_out_r();
        for (int i = 0; i != 128; ++i) { fwrite(l + i, 4, 1, stdout); fwrite(r + i, 4, 1, stdout); }
    }
}
