/*
 * One plugin parameter per cs80v2 Patch field, in engine units. The table
 * itself is generated (Generated/Params.h); this file holds its types, the
 * 0..1 mappings (the same as web/app.js) and field access.
 */
#pragma once

#include <math.h>
#include <stddef.h>
#include <stdint.h>

#include "../../cs80v2/cs80v2.hpp"

namespace cs80p {

using cs80v2::Patch;

enum Kind : uint8_t { K_FLOAT, K_BOOL, K_U8 };
enum Map : uint8_t { M_LIN, M_SQ, M_EXP, M_EGT, M_INT, M_BOOL, M_CHOICE };

struct ParamSpec {
    char const* id;      /* the Patch field name; also the stable host parameter ID */
    char const* name;
    char const* group;
    Kind kind;
    Map map;
    float lo, hi, def;
    char const* unit;
    char const* choices; /* '|'-separated, for M_CHOICE */
    uint32_t offset;     /* into Patch */
};

/* in double, so that value -> 0..1 -> value comes back to the same float */
inline float spec_from01(Map m, float lo_, float hi_, float x_)
{
    double const lo = lo_, hi = hi_, x = x_;
    switch (m) {
        case M_SQ: return (float)(lo + (hi - lo) * x * x);
        case M_EXP: return (float)(lo * pow(hi / lo, x));
        case M_EGT: return (float)(lo + (hi - lo) * (pow(100.0, x) - 1.0) / 99.0);
        default: return (float)(lo + (hi - lo) * x);
    }
}

inline float spec_to01(Map m, float lo_, float hi_, float v_)
{
    double const lo = lo_, hi = hi_, v = v_;
    double x;
    switch (m) {
        case M_SQ: x = sqrt(fmax(0.0, (v - lo) / (hi - lo))); break;
        case M_EXP: x = log(fmax(v, 1e-9) / lo) / log(hi / lo); break;
        case M_EGT: x = log(1.0 + fmax(0.0, v - lo) * 99.0 / (hi - lo)) / log(100.0); break;
        default: x = (v - lo) / (hi - lo);
    }
    return (float)(x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x));
}

inline void field_write(Patch& p, ParamSpec const& s, float v)
{
    char* f = (char*)&p + s.offset;
    switch (s.kind) {
        case K_BOOL: *(bool*)f = v >= 0.5f; break;
        case K_U8: {
            int u = (int)(v + 0.5f);
            *(uint8_t*)f = (uint8_t)(u < 0 ? 0 : (u > 255 ? 255 : u));
            break;
        }
        default: *(float*)f = v;
    }
}

inline float field_read(Patch const& p, ParamSpec const& s)
{
    char const* f = (char const*)&p + s.offset;
    switch (s.kind) {
        case K_BOOL: return *(bool const*)f ? 1.0f : 0.0f;
        case K_U8: return (float)*(uint8_t const*)f;
        default: return *(float const*)f;
    }
}

/* fx.* and plate.* fields only take effect through Engine::refresh_fx() */
inline bool is_fx_field(ParamSpec const& s)
{
    return s.offset >= offsetof(Patch, fx) && s.offset < offsetof(Patch, fx) + sizeof(cs80v2::FxParams);
}

}  // namespace cs80p
