/* Dump the engine's field table, patch_init() and the 8 Core presets as JSON,
   for gen_plugin_data.py. Built and run by that script. */
#include "../../web/src/cs80_wasm.cpp"

static void row(void)
{
    printf("[");
    for (int i = 0; i != NFIELDS; ++i) printf("%s%.9g", i ? "," : "", cs80_field_get(i));
    printf("]");
}

int main()
{
    cs80_init(48000.0f);
    printf("{\"fields\":[");
    for (int i = 0; i != NFIELDS; ++i) printf("%s[\"%s\",%d]", i ? "," : "", FIELDS[i].name, FIELDS[i].kind);
    printf("],\n\"init\":");
    cs80_reset_patch();
    row();
    printf(",\n\"core\":[");
    for (int c = 0; c != preset_count(); ++c) {
        cs80_load_preset(c);
        printf("%s{\"name\":\"%s\",\"values\":", c ? ",\n" : "", cs80_patch_name());
        row();
        printf("}");
    }
    printf("]}\n");
}
