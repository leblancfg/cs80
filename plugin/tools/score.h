/* the shared test score: lines "block kind a b", blocks of 128 frames */
#pragma once
#include <stdio.h>
#include <string.h>
#include <vector>

struct ScoreEv { int block; char kind[8]; int a, b; };

static std::vector<ScoreEv> load_score(char const* path)
{
    std::vector<ScoreEv> v;
    FILE* f = fopen(path, "r");
    if (!f) return v;
    char line[256];
    while (fgets(line, sizeof line, f)) {
        if (line[0] == '#' || line[0] == '\n') continue;
        ScoreEv e{};
        if (sscanf(line, "%d %7s %d %d", &e.block, e.kind, &e.a, &e.b) >= 3) v.push_back(e);
    }
    fclose(f);
    return v;
}
